// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **No Delivery target reaches the ride record, an export or a sync payload**
 * — #1817, holding ADR 0059 D-4 items 2 to 4 (the owner's ruling DL11 of
 * 2026-10-27, epic #1803).
 *
 * A Delivery round's targets are real mapped houses, so "a parcel went to
 * this house" beside a ride is a pointer to a real address (CLAUDE.md §6,
 * location data). The rule: which house, its point, its place on the round
 * and the seed that picked it are held in the ride's memory and dropped; the
 * week's counts are the only thing kept.
 *
 * ## One real ride, read back the way each consumer reads it
 *
 * #1816's recorded ride (`game/delivery-wiring.test.tsx`): the real
 * `GameView` with a round on, over a synthetic town whose houses stand off
 * round numbers (`delivery-town-testing.ts` §`DeliveryTownLayout`), recorded
 * by the real ride controller against the #44 simulator and saved into the
 * store harness. The seed is stubbed to a distinctive value, so the targets
 * the ride picks are known, and throws are scripted against a shadow of the
 * ride so the round has deliveries in it. Then, through the paths a real
 * consumer reads (CLAUDE.md §5):
 *
 * - the ride, its stream set and its laps through the store's own reads, on a
 *   fresh connection, and every row of every table in the database;
 * - every value the ride left in the device's `localStorage`, and the week's
 *   progress value, which holds the three counts and nothing else;
 * - the Files screen's own `exportEverything` in FIT, GPX and TCX, and the
 *   single-ride export in each, every file read raw, decoded through
 *   `readActivityFile` (the import path), and with every base64 string in it
 *   decoded too;
 * - every request `instance/sync.ts` sends a scripted instance for the ride,
 *   its base64 FIT decoded as well.
 *
 * Each is scanned for a target's point and distances as JSON spells them, as
 * float64 and float32 bytes, and rounded or cut to fewer places; its latitude
 * and longitude to three places and finer and as FIT semicircles; the seed in
 * decimal, hex and as bytes; and Delivery's own words. The last block plants
 * each kind of trace, so the scan is seen to go red.
 *
 * `privacy/delivery-targets-never-sent.test.ts` holds the source half: no
 * module that builds an export, a recording or an instance's traffic imports
 * Delivery, and nothing in Delivery logs or formats a coordinate.
 */

import { act } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seconds, unixSeconds, watts } from '@onyourleft/domain';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import {
  activityId,
  ensureDeviceSigningKey,
  lapId,
  recordingSessionId,
  webCryptoSha256,
  webCryptoVerifier,
} from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { riderMassFor } from '../athlete/mass';
import { DELIVERY_PROGRESS_STORAGE_KEY } from '../game/delivery/delivery-progress';
import { deliveryTown, DISTINCTIVE_TOWN_LAYOUT } from '../game/delivery/delivery-town-testing';
import { startDeliveryRide } from '../game/delivery/ride-round';
import type { WeekProgress } from '../game/delivery/round';
import type { DeliveryTarget } from '../game/delivery/targets';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  type ThrowSide,
} from '../game/delivery/throw';
import { FOOTPRINT_MAX_VERTICES, footprintPlans } from '../game/footprint-buildings';
import { GameView, type GamePort, type RidableRoute } from '../game/GameView';
import { landClassMask } from '../game/land-class';
import { mappedBuildingsOf } from '../game/mapped-buildings';
import type { GameRenderer, SceneFrame } from '../game/port';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../game/rider';
import { GameSimulation } from '../game/simulation';
import { corridorOrigin, type CorridorOrigin } from '../game/terrain';
import { gameTrainerPortOver } from '../game/trainer-port';
import { urbanClassMap } from '../game/urban-class';
import { athleteKeysFrom, syncWithInstance, type SyncTransport } from '../instance/sync';
import { rideSummaryOf, type RideSummaryStore } from '../ride-analysis/ride-summary';
import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { exportActivity } from './export-activity';
import { exportEverything } from './export-everything';
import type { ActivityFileFormat } from './file-format';
import { readActivityFile } from './read-activity-file';
import type { DownloadableFile } from './store-port';

// ---------------------------------------------------------------------------
// The town, the seed and the ride.
// ---------------------------------------------------------------------------

/** Houses off round numbers, so a target's point is digits nothing else in the ride spells. */
const town = deliveryTown('delivery-targets', DISTINCTIVE_TOWN_LAYOUT);
const ROUTE: RidableRoute = {
  id: 'delivery-targets',
  name: 'Delivery town',
  profile: town.profile,
  attempts: 0,
};
const ORIGIN = corridorOrigin(town.profile);

/** The round's seed: distinctive, so its digits are a marker. Under 2³². */
const SEED = 3_141_592_653;

/** A short week's round, so the ride covers it whole: three houses, on day 2. */
const WEEK: WeekProgress = { day: 2, houses: 3, score: 4 };

const FRAME_MS = 200;
const START_MS = 1_000_000;
/** 66 s of riding: past the round's last house and its window. */
const FRAMES = 330;
const RIDE_ID = activityId('the-ride');

function powerAt(nowMs: number): number {
  return 290 + 70 * Math.sin((nowMs - START_MS) / 6_000);
}

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

function port(): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    loadWorldCorridor: () => Promise.resolve({ kind: 'ready', corridor: town.corridor }),
    readSensors: () => ({
      rider: { power: watts(powerAt(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** The round's seed, as `drawRoundSeed` will draw it. */
function stubSeed(): void {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1) array[0] = SEED;
      return array;
    },
  );
}

/** `GameView`'s own plans of the town, as it makes them at the press. */
function gameViewBuildings() {
  const mask = landClassMask(town.corridor);
  const urban = urbanClassMap(town.corridor, mask, town.profile);
  const { plans } = footprintPlans(
    town.corridor,
    mask,
    town.profile,
    ORIGIN,
    FOOTPRINT_MAX_VERTICES,
    urban,
  );
  return mappedBuildingsOf(plans);
}

/** The round the ride will pick under {@link SEED}: the same pure start `GameView` calls. */
function theRound() {
  stubSeed();
  const store = new Map([[DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK)]]);
  const ride = startDeliveryRide({
    buildings: gameViewBuildings(),
    profile: town.profile,
    origin: ORIGIN,
    riderDistance: 0,
    storage: { getItem: (key) => store.get(key) ?? null, setItem: () => undefined },
  });
  vi.restoreAllMocks();
  if (ride === undefined) throw new Error('the town gave the round no house');
  return ride;
}

/**
 * After which frame to press which throw: the frame on which a shadow of the
 * ride — a `GameSimulation` built as `GameView` builds one, on the same clock
 * and power — is nearest the place a parcel lands on each house's step from.
 */
function throwScript(round: ReturnType<typeof theRound>): ReadonlyMap<number, ThrowSide> {
  const simulation = new GameSimulation({
    profile: town.profile,
    conditions: rideConditionsFor(riderMassFor(undefined).mass, DEFAULT_RIDING_POSITION),
  });
  const shadow: { along: number; speed: number }[] = [];
  for (let frame = 1; frame <= FRAMES; frame += 1) {
    const at = START_MS + frame * FRAME_MS;
    simulation.advanceTo(at, { power: watts(powerAt(at)), live: true });
    shadow.push({ along: simulation.state.ride.distance, speed: simulation.state.ride.speed });
  }
  const throws = new Map<number, ThrowSide>();
  for (const target of round.throwTargets) {
    const across = CARRIAGEWAY_HALF_WIDTH_METRES + target.clear;
    let best = 0;
    let bestGap = Infinity;
    shadow.forEach((frame, index) => {
      const from = target.along - frame.speed * (across / PARCEL_THROW_SPEED_METRES_PER_SECOND);
      const gap = Math.abs(frame.along - from);
      if (gap < bestGap) {
        best = index;
        bestGap = gap;
      }
    });
    throws.set(best, target.side);
  }
  return throws;
}

async function pump(): Promise<void> {
  const next = pending.shift();
  if (next === undefined) throw new Error('the ride asked for no frame');
  nowMs += FRAME_MS;
  await act(async () => {
    next(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function pressThrow(side: ThrowSide): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: side === 'left' ? 'ArrowLeft' : 'ArrowRight',
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

function buttonStarting(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith(words),
  );
}

/** The HUD's Houses field: its value, and the phrase under it. */
function housesField(): { readonly value: string; readonly detail: string } | undefined {
  const items = queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-hud__field--delivery');
  const found = items.find((each) => (each.textContent ?? '').startsWith('Houses'));
  if (found === undefined) return undefined;
  return {
    value: found.querySelector('.oyl-hud__value')?.firstChild?.textContent ?? '',
    detail: (found.querySelector('.oyl-hud__detail')?.textContent ?? '').trim(),
  };
}

/** What the ride left: the store it was saved in, and what it drew and showed. */
interface Ridden {
  readonly harness: ReturnType<typeof createStoreHarness>;
  readonly targets: readonly DeliveryTarget[];
  readonly drawn: readonly SceneFrame[];
  readonly houses: ReturnType<typeof housesField>;
}

/** The ride, recorded and saved: #1816's `recordedRide`, with the round's throws pressed. */
async function rideAndSave(): Promise<Ridden> {
  const round = theRound();
  const script = throwScript(round);
  const harness = createStoreHarness();
  await seedAthletes(harness);
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  let laps = 0;
  const controller = createRideController({
    transport,
    store: {
      putRecordingSession: async (record) =>
        harness.write(async (store) => store.putRecordingSession(record)),
      appendRecordingChunk: async (chunk) =>
        harness.write(async (store) => store.appendRecordingChunk(chunk)),
      readRecordingSessions: async (owner) =>
        harness.write(async (store) => store.readRecordingSessions(owner)),
      recoverRecording: async (owner, id) =>
        harness.write(async (store) => store.recoverRecording(owner, id)),
      deleteRecordingSession: async (owner, id) =>
        harness.write(async (store) => store.deleteRecordingSession(owner, id)),
    },
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-1'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written: [], refuseControl: false }),
    rideSave: {
      newActivityId: () => RIDE_ID,
      newLapId: () => lapId(`lap-${String((laps += 1))}`),
      timeZone: 'Europe/London',
      store: {
        putFinishedRide: (ride) => harness.write(async (store) => store.putFinishedRide(ride)),
      },
    },
  });
  await controller.pair('trainer');
  await controller.start();

  // The week the round is ridden in; nothing resets it after, so a case reads what the ride kept.
  localStorage.clear();
  localStorage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK));
  stubSeed();
  const drawn: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={port()}
      trainer={gameTrainerPortOver(controller)}
      renderer={() => Promise.resolve(capturingRenderer(drawn))}
      now={() => nowMs}
      delivery
    />,
  );
  await settle();
  await act(async () => {
    buttonStarting('Ride ')?.click();
    await Promise.resolve();
  });
  await settle();
  for (let index = 0; index < FRAMES; index += 1) {
    await pump();
    // The bench keeps whole seconds; five of the game's frames are one.
    if (index % 5 === 4) {
      await act(async () => {
        bench.advance(seconds(1));
        await controller.tick(bench.now);
      });
    }
    const side = script.get(index);
    if (side !== undefined) await pressThrow(side);
  }
  await settle();
  const houses = housesField();
  await act(async () => {
    controller.armStop();
    await controller.confirmStop();
  });
  for (let index = 0; index < 10; index += 1) await settle();
  expect(controller.getSnapshot().saveState).toBe('saved');
  controller.dispose();
  mounted?.unmount();
  mounted = undefined;
  return { harness, targets: round.targets, drawn, houses };
}

let ridden: Promise<Ridden> | undefined;
/** The one ride every case reads, ridden by the first that asks. */
const theRide = (): Promise<Ridden> => (ridden ??= rideAndSave());

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (ridden !== undefined) await (await ridden).harness.destroy();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// The scan.
// ---------------------------------------------------------------------------

/** One thing a trace of the round would be, named so a failure says which. */
interface Marker {
  readonly label: string;
  /** Found anywhere in the text: a spelling long enough that only the round spells it. */
  readonly text?: string;
  /** Found only as a whole number in the text, sign aside: a rounded spelling (see {@link roundedMarkers}). */
  readonly number?: string;
  readonly bytes?: Uint8Array;
}

/** Delivery's own words: a field name, a kind of step, a round place ("the 1st house"). */
const DELIVERY_WORDS = [
  'deliver',
  'parcel',
  'doorstep',
  'porch',
  'house',
  'throwtarget',
  'fromroad',
] as const;

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** A local point's latitude and longitude: `terrain.ts` §`localGroundPosition`, inverted. */
function geographicOf(origin: CorridorOrigin, x: number, z: number): [number, number] {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
  return [
    origin.latitude + z / METRES_PER_DEGREE_LATITUDE,
    origin.longitude - x / perDegreeLongitude,
  ];
}

/**
 * A degree value cut, not rounded, to six decimals (11 cm): what a writer
 * spelling it to six or more decimals starts with, where a rounded marker
 * would miss one that rounds at the seventh.
 */
function sixDecimals(degrees: number): string {
  const [whole, fraction = ''] = String(degrees).split('.');
  return `${whole ?? ''}.${fraction.padEnd(6, '0').slice(0, 6)}`;
}

/** `value` cut, not rounded, to `places` decimals, as `toFixed` would spell it. */
function cut(value: number, places: number): string {
  const [whole, fraction = ''] = String(Math.abs(value)).split('.');
  return places === 0
    ? (whole ?? '')
    : `${whole ?? ''}.${fraction.padEnd(places, '0').slice(0, places)}`;
}

/** How a writer rounding or cutting `value` to `places` decimals spells it, sign aside. */
function spellings(value: number, places: number): string[] {
  return [...new Set([Math.abs(value).toFixed(places), cut(value, places)])];
}

/**
 * A local point or distance in whole metres is matched only from 100 m up. A
 * one- or two-digit whole number is spelled by every ride (a cadence, a
 * second, a lap count, any two digit bytes in a FIT file), and a target's `x`
 * and `fromRoad` are under 25 m by rule (`targets.ts`
 * §`TARGET_MOST_FROM_ROAD_METRES`), so no fixture can make theirs a number
 * nothing else spells: for those the coarsest marker is a decimetre.
 */
const WHOLE_METRES_FROM = 100;

/** Metres to 0 to 6 places: past that, the full spelling's own marker finds it as a prefix. */
const METRE_PLACES = [0, 1, 2, 3, 4, 5, 6] as const;
/** Degrees to 3 places (110 m) and finer, rounded or cut; {@link sixDecimals} adds the cut prefix. */
const DEGREE_PLACES = [3, 4, 5, 6, 7, 8] as const;

/**
 * A target written at reduced precision — #1817's review: a debug label or
 * a lap note with `x.toFixed(2)` in it is still the house — as whole numbers
 * in the text, rounded or cut: metres to 0 to 6 places, degrees to 3 to 8.
 *
 * A rounded spelling is a prefix of real readings (the rider passes every
 * house, so the distance stream holds `120.50…` beside a target at
 * `120.51`), which is why these are matched as **whole numbers** rather
 * than substrings: a stream's `120.5071…` is not `120.51`. What still could
 * collide is a reading written at the same coarse precision; the fixture's
 * houses stand off round numbers (`DISTINCTIVE_TOWN_LAYOUT`, 50.3719 m along
 * and 12.4683 m out), so a target's centimetres are not a sample's, and the
 * first case asserts the ride's own exports, rows and payload carry none of
 * these numbers before any leak is planted.
 */
function roundedMarkers(name: string, target: DeliveryTarget): Marker[] {
  const markers: Marker[] = [];
  for (const field of ['distance', 'fromRoad', 'x', 'z'] as const) {
    const value = target[field];
    for (const places of METRE_PLACES) {
      if (places === 0 && Math.abs(value) < WHOLE_METRES_FROM) continue;
      for (const number of spellings(value, places)) {
        markers.push({ label: `${name} ${field} to ${String(places)} places`, number });
      }
    }
  }
  const [latitude, longitude] = geographicOf(ORIGIN, target.x, target.z);
  for (const [field, degrees] of [
    ['latitude', latitude],
    ['longitude', longitude],
  ] as const) {
    for (const places of DEGREE_PLACES) {
      for (const number of spellings(degrees, places)) {
        markers.push({ label: `${name} ${field} to ${String(places)} places`, number });
      }
    }
    // A FIT position field: degrees as int32 semicircles, which `readActivityFile` may not decode back.
    markers.push({ label: `${name} ${field} as semicircles`, bytes: semicircleBytes(degrees) });
  }
  return markers;
}

function semicircleBytes(degrees: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, Math.round((degrees * 2 ** 31) / 180), true);
  return bytes;
}

/** Every whole number in `text`, sign aside: a run of digits with at most one fraction, not inside a longer one. */
function numbersIn(text: string): Set<string> {
  return new Set(text.match(/(?<![\d.])\d+(?:\.\d+)?(?!\.?\d)/g) ?? []);
}

function float64Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return bytes;
}

function float32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

/** Every trace a round under {@link SEED} over `targets` would leave. */
function markersOf(targets: readonly DeliveryTarget[]): Marker[] {
  const markers: Marker[] = [
    { label: 'the seed', text: String(SEED) },
    { label: 'the seed in hex', text: SEED.toString(16) },
    { label: 'the seed in upper-case hex', text: SEED.toString(16).toUpperCase() },
    { label: 'the seed as bytes', bytes: new Uint8Array(new Uint32Array([SEED]).buffer) },
    { label: 'the seed as float64', bytes: float64Bytes(SEED) },
  ];
  for (const target of targets) {
    const name = `target ${String(target.position)}`;
    for (const field of ['distance', 'fromRoad', 'x', 'y', 'z'] as const) {
      const value = target[field];
      markers.push(
        { label: `${name} ${field}`, text: JSON.stringify(Math.abs(value)) },
        { label: `${name} ${field} as float64`, bytes: float64Bytes(value) },
        { label: `${name} ${field} as float32`, bytes: float32Bytes(value) },
      );
    }
    const [latitude, longitude] = geographicOf(ORIGIN, target.x, target.z);
    markers.push(
      { label: `${name} latitude`, text: sixDecimals(latitude) },
      { label: `${name} longitude`, text: sixDecimals(longitude) },
      ...roundedMarkers(name, target),
    );
  }
  return markers;
}

/** Whether `needle` occurs in `haystack` as a run of bytes. */
function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * A value as JSON, typed arrays spelled as arrays of their numbers — except
 * raw bytes, whose 0 to 255 are no reading's numbers and would match a
 * whole-metre marker by chance: {@link bytesWithin} scans those as bytes.
 */
function jsonOf(value: unknown): string {
  return JSON.stringify(value, (_key, each: unknown) => {
    // By tag, not `instanceof`: a Blob read back in jsdom gives another realm's Uint8Array.
    if (Object.prototype.toString.call(each) === '[object Uint8Array]') return 'bytes';
    return ArrayBuffer.isView(each) && !(each instanceof DataView)
      ? Array.from(each as unknown as ArrayLike<number>)
      : each;
  });
}

const BASE64 = /^[A-Za-z0-9+/]{16,}={0,2}$/;

/** Every string in `value` that reads as base64, decoded. */
function base64Within(value: unknown): Uint8Array[] {
  const found: Uint8Array[] = [];
  JSON.parse(jsonOf(value) ?? 'null', (_key, each: unknown) => {
    if (typeof each === 'string' && each.length % 4 === 0 && BASE64.test(each)) {
      found.push(Uint8Array.from(atob(each), (char) => char.charCodeAt(0)));
    }
    return each;
  });
  return found;
}

/**
 * The markers found in `text` and `bytes`, each prefixed with `where`, and
 * Delivery's words unless `words` is false: for Delivery's own preference
 * values, whose keys are its words.
 */
function scan(
  where: string,
  markers: readonly Marker[],
  text: string,
  bytes?: Uint8Array,
  words = true,
) {
  const found: string[] = [];
  const lower = text.toLowerCase();
  const numbers = numbersIn(text);
  for (const word of words ? DELIVERY_WORDS : []) {
    if (lower.includes(word)) found.push(`${where}: the word ${word}`);
  }
  for (const marker of markers) {
    if (marker.text !== undefined && text.includes(marker.text)) {
      found.push(`${where}: ${marker.label}`);
    }
    if (marker.number !== undefined && numbers.has(marker.number)) {
      found.push(`${where}: ${marker.label}`);
    }
    if (marker.bytes !== undefined && bytes !== undefined && containsBytes(bytes, marker.bytes)) {
      found.push(`${where}: ${marker.label}`);
    }
  }
  // A rounded and a cut spelling can be one number: say it once.
  return [...new Set(found)];
}

/** An activity file decoded as the import path decodes one, or `undefined` if it is not one. */
function decoded(fileName: string, bytes: Uint8Array): string | undefined {
  try {
    return jsonOf(readActivityFile(fileName, bytes));
  } catch {
    return undefined;
  }
}

/** Whether `bytes` are a FIT file: `.FIT` at offset 8. */
const isFit = (bytes: Uint8Array): boolean =>
  bytes.length > 12 && String.fromCharCode(...bytes.subarray(8, 12)) === '.FIT';

/** Every trace in one file: its name, its bytes raw and decoded, and every base64 string in it decoded. */
function tracesInFile(file: DownloadableFile, markers: readonly Marker[]): string[] {
  const raw = new TextDecoder('latin1').decode(file.bytes);
  const found = [
    ...scan(`${file.fileName}, its name`, markers, file.fileName),
    ...scan(file.fileName, markers, raw, file.bytes),
  ];
  const read = decoded(file.fileName, file.bytes);
  if (read !== undefined) found.push(...scan(`${file.fileName}, decoded`, markers, read));
  if (file.fileName.endsWith('.json')) {
    for (const inner of base64Within(JSON.parse(raw) as unknown)) {
      found.push(...tracesInBytes(`${file.fileName}, base64`, inner, markers));
    }
  }
  return found;
}

/** Every trace in bytes that came out of base64: raw, and decoded when they are a FIT file. */
function tracesInBytes(where: string, bytes: Uint8Array, markers: readonly Marker[]): string[] {
  const found = scan(where, markers, new TextDecoder('latin1').decode(bytes), bytes);
  const read = isFit(bytes) ? decoded('inner.fit', bytes) : undefined;
  if (read !== undefined) found.push(...scan(`${where}, decoded`, markers, read));
  return found;
}

/** Every typed array in `value`, as its own bytes: a stream's samples, or a stored Blob's. */
function bytesWithin(value: unknown): Uint8Array[] {
  if (ArrayBuffer.isView(value)) {
    return [new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(bytesWithin);
}

/** Every trace in a value: its JSON, its typed arrays' bytes, and every base64 string in it decoded. */
function tracesInValue(where: string, value: unknown, markers: readonly Marker[]): string[] {
  const found = scan(where, markers, jsonOf(value) ?? '');
  for (const inner of bytesWithin(value)) {
    found.push(...tracesInBytes(`${where}, bytes`, inner, markers));
  }
  for (const inner of base64Within(value)) {
    found.push(...tracesInBytes(`${where}, base64`, inner, markers));
  }
  return found;
}

/** Every row of every table in the database, read past the store, Blobs as their bytes. */
async function everyRow(databaseName: string): Promise<{ table: string; rows: unknown[] }[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the database did not open'));
  });
  try {
    const tables: { table: string; rows: unknown[] }[] = [];
    for (const table of Array.from(database.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction(table, 'readonly').objectStore(table).getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error ?? new Error('the table did not read'));
      });
      tables.push({ table, rows: await Promise.all(rows.map(blobsAsBytes)) });
    }
    return tables;
  } finally {
    database.close();
  }
}

/** `value` with every Blob in it replaced by its bytes. */
async function blobsAsBytes(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (Array.isArray(value)) return Promise.all(value.map(blobsAsBytes));
  if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, each] of Object.entries(value)) out[key] = await blobsAsBytes(each);
    return out;
  }
  return value;
}

/** A sync instance that holds nothing and takes everything, keeping every request it was sent. */
function scriptedInstance(): { readonly sealed: SyncTransport; readonly sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    sealed: {
      json: (method, path, body) => {
        sent.push({ method, path, body });
        if (method === 'GET' && path.startsWith('/v1/sync/manifest')) {
          return Promise.resolve({ status: 200, body: { items: [], next: null } });
        }
        if (method === 'GET' && path === '/v1/auth/devices') {
          return Promise.resolve({ status: 200, body: { devices: [] } });
        }
        if (method === 'GET') return Promise.resolve({ status: 404, body: {} });
        return Promise.resolve({ status: 200, body: {} });
      },
      bytes: (path) => {
        sent.push({ method: 'GET', path });
        return Promise.resolve({ status: 404, bytes: new Uint8Array() });
      },
    },
  };
}

const NOW = unixSeconds(1_790_000_000);
const FORMATS = ['fit', 'gpx', 'tcx'] as const satisfies readonly ActivityFileFormat[];

// ---------------------------------------------------------------------------

/** Ridden once, under coverage too: about three times the ride's own few seconds. */
const RIDE = { timeout: 20_000 } as const;

describe('a Delivery ride keeps no target — #1817, ADR 0059 D-4', () => {
  it('rides a round with deliveries in it over the targets the scan looks for', RIDE, async () => {
    const ride = await theRide();
    expect(ride.targets).toHaveLength(WEEK.houses);
    // The round ran over these houses: their markers were drawn on the ride's first frame.
    const drawnMarkers = ride.drawn[0]?.delivery?.markers ?? [];
    expect(drawnMarkers.length).toBe(WEEK.houses);
    // And the scan looks for the houses the ride drew, not a re-run that could pick others.
    for (const marker of drawnMarkers) {
      expect(ride.targets.some(({ x, z }) => x === marker.x && z === marker.z)).toBe(true);
    }
    // Settled, with deliveries: a parcel did go to a house.
    expect(ride.houses?.value).toBe('0');
    const delivered = Number(/^(\d+)/.exec(ride.houses?.detail ?? '')?.[1] ?? '0');
    expect(delivered).toBeGreaterThan(0);
    // The fixture's digits are distinctive: every point and distance has a fraction.
    for (const target of ride.targets) {
      for (const value of [target.distance, target.x, target.z]) {
        expect(Number.isInteger(value)).toBe(false);
      }
    }
  });

  it('stores none of it with the ride, its streams or its laps', RIDE, async () => {
    const ride = await theRide();
    const markers = markersOf(ride.targets);
    const [activity, streams, laps, summaries] = await ride.harness.read(async (store) => [
      await store.getActivity(ATHLETE_A, RIDE_ID),
      await store.getStreamSet(ATHLETE_A, RIDE_ID),
      await store.listLaps(ATHLETE_A, RIDE_ID),
      await store.listActivitySummaries(ATHLETE_A, {
        orderBy: 'startedAt',
        direction: 'ascending',
        limit: 10,
      }),
    ]);
    // Not vacuous: the ride is there, with its samples.
    expect(activity?.movingTime).toBeGreaterThan(20);
    expect(streams?.sampleCount).toBeGreaterThan(20);
    expect(summaries.map((each) => each.id)).toEqual([RIDE_ID]);
    expect([
      ...tracesInValue('the ride', activity, markers),
      ...tracesInValue('its streams', streams, markers),
      ...tracesInValue('its laps', laps, markers),
      ...tracesInValue('the library', summaries, markers),
    ]).toStrictEqual([]);
  });

  it('keeps only the week’s counts on the device', RIDE, async () => {
    const ride = await theRide();
    const stored = JSON.parse(
      localStorage.getItem(DELIVERY_PROGRESS_STORAGE_KEY) ?? 'null',
    ) as Record<string, unknown> | null;
    // The round ended and was kept: the next day.
    expect(stored?.['day']).toBe(WEEK.day + 1);
    expect(Object.keys(stored ?? {}).sort()).toEqual(['day', 'houses', 'score']);
    for (const value of Object.values(stored ?? {})) {
      expect(Number.isInteger(value)).toBe(true);
    }
    // And nothing else the ride left on the device names the round's houses or seed.
    const markers = markersOf(ride.targets);
    const kept: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null) continue;
      // Delivery's own values (the week, the assist) are named in its words: their numbers are scanned.
      const own = key.startsWith('oyl.game.delivery.');
      kept.push(
        ...scan(`localStorage ${key}`, markers, localStorage.getItem(key) ?? '', undefined, !own),
      );
    }
    expect(kept).toStrictEqual([]);
  });

  it.each(FORMATS)(
    'exports none of it in an account export, %s',
    async (format) => {
      const ride = await theRide();
      const files: DownloadableFile[] = [];
      const report = await ride.harness.read((store) =>
        exportEverything({
          store,
          athleteId: ATHLETE_A,
          format,
          onFile: (file) => {
            files.push(file);
          },
        }),
      );
      expect(report.exported).toBe(1);
      // Not vacuous: the ride's file is there and decodes, beside the manifest.
      const rideFile = files.find((file) => file.fileName.endsWith(`.${format}`));
      expect(rideFile && decoded(rideFile.fileName, rideFile.bytes)).toBeDefined();
      const markers = markersOf(ride.targets);
      expect(files.flatMap((file) => tracesInFile(file, markers))).toStrictEqual([]);
    },
    RIDE.timeout,
  );

  it.each(FORMATS)(
    'exports none of it in the single-ride export, %s',
    async (format) => {
      const ride = await theRide();
      const { file } = await ride.harness.read((store) =>
        exportActivity({ store, athleteId: ATHLETE_A, activityId: RIDE_ID, format }),
      );
      expect(decoded(file.fileName, file.bytes)).toBeDefined();
      expect(tracesInFile(file, markersOf(ride.targets))).toStrictEqual([]);
    },
    RIDE.timeout,
  );

  it('sends none of it in the payload sync builds for the ride', RIDE, async () => {
    const ride = await theRide();
    const instance = scriptedInstance();
    const report = await ride.harness.write((store) =>
      syncWithInstance({
        sealed: instance.sealed,
        store,
        athleteId: ATHLETE_A,
        signingKey: () => ensureDeviceSigningKey(store, ATHLETE_A, { now: () => NOW }),
        sha256: webCryptoSha256,
        verifier: webCryptoVerifier,
        now: () => NOW,
        timeZone: 'Europe/London',
        rideSummary: rideSummaryOf(store as unknown as RideSummaryStore, ATHLETE_A),
        athleteKeys: () => athleteKeysFrom(instance.sealed),
        newDocumentId: () => crypto.randomUUID(),
      }),
    );
    // Not vacuous: the ride was pushed, its FIT inside the request.
    expect(report.pushed).toBe(1);
    expect(report.failures).toStrictEqual([]);
    const pushes = instance.sent.filter(
      (each) => (each as { path: string }).path === '/v1/sync/records',
    );
    expect(pushes).toHaveLength(1);
    expect(base64Within(pushes).some(isFit)).toBe(true);
    expect(tracesInValue('sync', instance.sent, markersOf(ride.targets))).toStrictEqual([]);
  });
  // Last of the ride's cases, and in file order (Vitest's default, never shuffled here): sync
  // has written its key and state into the same store, so the walk reads those rows too.
  it('stores none of it in any table of the database', RIDE, async () => {
    const ride = await theRide();
    await ride.harness.discard();
    const tables = await everyRow(ride.harness.databaseName);
    // Not vacuous: the walk read the ride's own tables, with rows in them.
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.reduce((sum, each) => sum + each.rows.length, 0)).toBeGreaterThan(2);
    const markers = markersOf(ride.targets);
    expect(
      tables.flatMap(({ table, rows }) => tracesInValue(`table ${table}`, rows, markers)),
    ).toStrictEqual([]);
  });
});

describe('the scan can go red — #1817', () => {
  /** Two targets with the fixture's kind of digits, not a ride's. */
  const planted: DeliveryTarget[] = [
    {
      position: 0,
      distance: 120.37189658710258,
      side: 1,
      fromRoad: 7.968299865722656,
      kind: 'doorstep',
      x: -7.968299865722656,
      y: 8.113395395124208,
      z: 120.50712585449219,
      yaw: Math.PI / 2,
    },
  ];
  const markers = markersOf(planted);

  it('finds a target’s point and the seed in a stored value', () => {
    expect(
      tracesInValue('ride', { name: 'Ride', note: { x: -7.968299865722656 } }, markers),
    ).toEqual(['ride: target 0 fromRoad', 'ride: target 0 x']);
    expect(scan('progress', markers, JSON.stringify({ day: 2, seed: SEED }))).toEqual([
      'progress: the seed',
    ]);
    expect(tracesInValue('ride', { name: 'The 1st house' }, markers)).toEqual([
      'ride: the word house',
    ]);
  });

  it('finds a point in a typed array, in base64, in raw bytes, and in a decoded file', () => {
    expect(tracesInValue('streams', { z: Float64Array.of(120.50712585449219) }, markers)).toEqual([
      'streams: target 0 z',
      'streams, bytes: target 0 z as float64',
    ]);
    // A stored Blob, read back as its bytes: a channel of float32 samples.
    const blob = new Uint8Array(Float32Array.of(1, 120.37189658710258, 2).buffer);
    expect(tracesInValue('streamBlobs', [{ bytes: blob }], markers)).toEqual([
      'streamBlobs, bytes: target 0 distance as float32',
    ]);
    const bytes = float64Bytes(120.37189658710258);
    const wrapped = btoa(String.fromCharCode(...new Uint8Array(32), ...bytes));
    expect(tracesInValue('sync', { file: wrapped }, markers)).toEqual([
      'sync, base64: target 0 distance as float64',
    ]);
    const [latitude, longitude] = geographicOf(ORIGIN, planted[0]!.x, planted[0]!.z);
    const gpx = new TextEncoder().encode(
      `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>` +
        `<trkpt lat="${latitude.toFixed(7)}" lon="${longitude.toFixed(7)}"><time>2026-10-29T10:00:00Z</time></trkpt>` +
        `<trkpt lat="${latitude.toFixed(7)}" lon="${longitude.toFixed(7)}"><time>2026-10-29T10:00:01Z</time></trkpt>` +
        `</trkseg></trk></gpx>`,
    );
    const found = tracesInFile(
      { fileName: 'ride.gpx', mediaType: 'application/gpx+xml', bytes: gpx },
      markers,
    );
    expect(found).toContain('ride.gpx: target 0 latitude');
    expect(found).toContain('ride.gpx: target 0 longitude');
    expect(found).toContain('ride.gpx, decoded: target 0 latitude');
  });

  it('finds a target written at reduced precision, and no reading that only starts like one', () => {
    const [target] = planted;
    if (target === undefined) throw new Error('no planted target');
    // The review's leak: centimetres in a ride's name.
    const name = `Ride ${target.x.toFixed(2)},${target.z.toFixed(2)}`;
    expect(tracesInValue('ride', { name }, markers)).toEqual([
      'ride: target 0 fromRoad to 2 places',
      'ride: target 0 x to 2 places',
      'ride: target 0 z to 2 places',
    ]);
    expect(tracesInValue('ride', { name: `Ride ${target.z.toFixed(0)}` }, markers)).toEqual([
      'ride: target 0 z to 0 places',
    ]);
    const [latitude, longitude] = geographicOf(ORIGIN, target.x, target.z);
    const note = `at ${latitude.toFixed(5)} ${longitude.toFixed(3)}`;
    expect(tracesInValue('lap', { note }, markers)).toEqual([
      'lap: target 0 latitude to 5 places',
      'lap: target 0 longitude to 3 places',
    ]);
    const fit = new Uint8Array(Int32Array.of(Math.round((latitude * 2 ** 31) / 180)).buffer);
    expect(tracesInValue('streamBlobs', [{ bytes: fit }], markers)).toEqual([
      'streamBlobs, bytes: target 0 latitude as semicircles',
    ]);
    // A reading that starts with a target's rounded digits is not one: the rider passes every house.
    expect(
      tracesInValue('streams', { distance: Float64Array.of(120.5049, 120.3749), y: 7.8 }, markers),
    ).toStrictEqual([]);
  });

  it('finds the seed spelled in upper-case hex and as float64 bytes', () => {
    expect(scan('note', markers, `seed 0x${SEED.toString(16).toUpperCase()}`)).toEqual([
      'note: the seed in upper-case hex',
    ]);
    expect(tracesInValue('streams', { seed: Float64Array.of(SEED) }, markers)).toEqual([
      'streams: the seed',
      'streams, bytes: the seed as float64',
    ]);
  });
});
