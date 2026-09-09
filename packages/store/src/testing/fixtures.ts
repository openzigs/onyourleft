// SPDX-License-Identifier: Apache-2.0

/**
 * Fixtures for the round-trip harness: athletes, rides, and stream sets.
 *
 * ## Three athletes, not one, and not two
 *
 * CLAUDE.md section 6: a query matching on an entity id without also filtering
 * on the owning athlete "passes every single-athlete test in the suite". So a
 * one-athlete fixture is not a fixture.
 *
 * **Two is not enough either**, and #28's revision block says why: two athletes
 * cannot distinguish "scoped correctly" from "returns everything the requester
 * is connected to" — with two, those two behaviours produce the same answer as
 * soon as the pair is related. Three separates them, which is what #34, #68 and
 * #79-#83 will need. Phase 1 has one local athlete and no relationships (owner
 * decision D6), so those assertions belong with #34; the *fixture* is here now
 * because building it in later is a rewrite of every test that used two.
 *
 * ## Both directions of scoping are one call away
 *
 * Review of #26's PR found that a two-athlete **read** fixture is blind to a
 * **write**-path scoping hole: `put` is keyed on the primary key alone, so a
 * second athlete writing the same id destroys the first's row and then owns it.
 * `seedAthletes` therefore returns the ids as an ordered tuple, and
 * `rideFor`/`streamSetFor` take an owner, so writing "athlete B tries to
 * overwrite athlete A's record" is as short as writing the read.
 *
 * ## The stream fixture is grid-aligned, on purpose and not for convenience
 *
 * `stream-codec.ts` declares a resolution per channel, and a value on that grid
 * round-trips exactly. The generators below produce values on the grid — not by
 * rounding a pretty number, but by generating from the stored representation
 * outward: latitude and longitude are walked in **FIT semicircles** and then
 * converted to degrees, altitude in FIT's `uint16` units, speed in mm/s. That
 * is exactly the shape #30's FIT decoder will hand this store, so the
 * four-hour fixture is a realistic ride rather than a test tuned to its own
 * encoding. `stream-codec.test.ts` covers the other half — values placed
 * deliberately between grid points, and the bound on what they lose.
 */

import {
  contentHashOf,
  signActivityRecord,
  SIGNATURE_ALGORITHM,
  toHex,
  type ActivityClaims,
  type SigningKey,
} from '@onyourleft/domain';

import {
  altitudeMetres,
  beatsPerMinute,
  createSegment,
  degreesCelsius,
  degreesLatitude,
  degreesLatitudeToSemicircles,
  degreesLongitude,
  degreesLongitudeToSemicircles,
  effortId,
  fitAltitudeToMetres,
  kilograms,
  latitudeSemicircles,
  longitudeSemicircles,
  metres,
  metresPerSecond,
  metresToFitAltitude,
  revolutionsPerMinute,
  routeProfile,
  seconds,
  semicirclesToDegreesLatitude,
  semicirclesToDegreesLongitude,
  geographicPosition,
  thresholdShare,
  unixSeconds,
  watts,
  type EffortVisibility,
  type ElevationSource,
  type RoutePoint,
  type SegmentVisibility,
  type UnixSeconds,
  type WorkoutBlock,
} from '@onyourleft/domain';

import {
  activityId,
  athleteId,
  lapId,
  recordingSessionId,
  routeId,
  segmentEffortId,
  segmentId,
  workoutId,
  type ActivityId,
  type AthleteId,
  type LapId,
  type RecordingSessionId,
  type SegmentId,
} from '../ids';
import type { DeviceKeyRecord, StoredActivityRecord } from '../identity';
import type {
  AthleteRecord,
  NewActivity,
  NewLap,
  RouteRecord,
  SegmentEffortRecord,
  SegmentRecord,
  WorkoutRecord,
} from '../records';
import type { NewRecordingChunk, NewRecordingSession } from '../recording';
import { STREAM_CHANNELS, type NewStreamSet, type Samples, type StreamChannel } from '../streams';
import { signingKeyFor, webCryptoSha256 } from '../web-crypto';

import type { StoreHarness } from './harness';
import { DEFAULT_VISIBILITY, type Visibility } from '../visibility';

/** The three athletes every fixture has. See the note at the top of this file. */
export const ATHLETE_A: AthleteId = athleteId('athlete-a');
export const ATHLETE_B: AthleteId = athleteId('athlete-b');
export const ATHLETE_C: AthleteId = athleteId('athlete-c');

/** All three, in order, so a test can iterate or destructure. */
export const ATHLETES: readonly [AthleteId, AthleteId, AthleteId] = [
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
];

/** A fixed instant, so nothing in a fixture depends on when the suite runs. */
export const FIXTURE_EPOCH: UnixSeconds = unixSeconds(1_700_000_000);

/** Four hours at 1 Hz — the size #27's round-trip criterion names. */
export const FOUR_HOUR_SAMPLE_COUNT = 4 * 60 * 60;

export function athleteRecord(id: AthleteId, displayName = id): AthleteRecord {
  return { id, displayName, createdAt: FIXTURE_EPOCH };
}

/**
 * Writes all three athletes through the harness's **public** path.
 *
 * Through `write`, not through a raw Dexie handle, so a seeding step that fails
 * to persist fails the test that needed it rather than producing an empty
 * database nobody looked at.
 */
export async function seedAthletes(
  harness: StoreHarness,
  athletes: readonly AthleteId[] = ATHLETES,
): Promise<readonly AthleteId[]> {
  await harness.write(async (store) => {
    for (const id of athletes) {
      await store.putAthlete(athleteRecord(id));
    }
  });
  return athletes;
}

let rideCounter = 0;

/** Resets the id counter, so a test's ids do not depend on what ran before it. */
export function resetFixtureIds(): void {
  rideCounter = 0;
  recordingCounter = 0;
  segmentCounter = 0;
  routeCounter = 0;
  workoutCounter = 0;
}

/**
 * An indoor trainer ride — no position data at all.
 *
 * The default rather than the exception: `hasPosition: false` is the common
 * Phase 1 case and half the product, and a fixture set whose default has a
 * track quietly makes the trainer case the one nobody tests.
 */
export function rideFor(owner: AthleteId, overrides: Partial<NewActivity> = {}): NewActivity {
  rideCounter += 1;
  return {
    id: activityId(`activity-${String(rideCounter)}`),
    athleteId: owner,
    name: 'Zwift Watopia',
    startedAt: unixSeconds(FIXTURE_EPOCH + 100_000),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(FOUR_HOUR_SAMPLE_COUNT),
    movingTime: seconds(FOUR_HOUR_SAMPLE_COUNT - 200),
    distance: metres(120_000),
    hasPosition: false,
    createdAt: unixSeconds(FIXTURE_EPOCH + 200_000),
    ...overrides,
  };
}

export function lapFor(
  ride: NewActivity,
  ordinal: number,
  overrides: Partial<NewLap> = {},
): NewLap {
  return {
    id: lapId(`lap-${ride.id}-${String(ordinal)}`),
    activityId: ride.id,
    ordinal,
    startedAt: unixSeconds(FIXTURE_EPOCH + 100_000 + ordinal * 600),
    elapsedTime: seconds(600),
    movingTime: seconds(590),
    distance: metres(5_000),
    ...overrides,
  };
}

/** Seeds an athlete's ride through the public path, and returns it. */
export async function seedRide(
  harness: StoreHarness,
  owner: AthleteId,
  overrides: Partial<NewActivity> = {},
): Promise<NewActivity> {
  const ride = rideFor(owner, overrides);
  await harness.write(async (store) => store.putActivity(ride));
  return ride;
}

/** A run of absent samples in one channel — the dropped-strap case. */
export interface StreamGap {
  readonly channel: StreamChannel;
  /** First absent sample, zero-based. */
  readonly from: number;
  /** How many consecutive samples are absent. */
  readonly count: number;
}

/** @see streamSetFor */
export interface StreamFixtureOptions {
  readonly sampleCount?: number;
  /** Defaults to all eight. Pass a subset for the no-position case. */
  readonly channels?: readonly StreamChannel[];
  readonly gaps?: readonly StreamGap[];
  readonly startedAt?: UnixSeconds;
}

/**
 * The base point the position channels walk away from: central London, on the
 * semicircle grid.
 */
const BASE_LATITUDE_SEMICIRCLES = degreesLatitudeToSemicircles(degreesLatitude(51.5074));
const BASE_LONGITUDE_SEMICIRCLES = degreesLongitudeToSemicircles(degreesLongitude(-0.1278));

/** ~35 m of altitude, on FIT's `uint16` grid. */
const BASE_ALTITUDE_RAW = metresToFitAltitude(altitudeMetres(35));

/**
 * One sample of one channel, at index `i`.
 *
 * Every generator is deterministic and produces a value **on the channel's
 * stored grid** — see the note at the top of this file.
 */
const GENERATORS: {
  readonly [C in StreamChannel]: (index: number) => NonNullable<Samples<C>[number]>;
} = {
  // A ride with intervals: a base and a sawtooth, both whole watts.
  power: (index) => watts(140 + ((index * 7) % 180)),
  heartRate: (index) => beatsPerMinute(96 + (index % 62)),
  cadence: (index) => revolutionsPerMinute(72 + (index % 26)),
  // Generated in mm/s, the stored unit, then divided — so it lands on the grid.
  speed: (index) => metresPerSecond((7_000 + ((index * 13) % 4_000)) / 1_000),
  // Walked in semicircles: ~0.9 m per sample north, which is a plausible pace.
  latitude: (index) =>
    semicirclesToDegreesLatitude(latitudeSemicircles(BASE_LATITUDE_SEMICIRCLES + index * 100)),
  longitude: (index) =>
    semicirclesToDegreesLongitude(longitudeSemicircles(BASE_LONGITUDE_SEMICIRCLES + index * 160)),
  // Walked in FIT's raw units: a rolling profile within +-40 m.
  altitude: (index) => fitAltitudeToMetres(BASE_ALTITUDE_RAW + ((index * 3) % 400)),
  temperature: (index) => degreesCelsius(9 + (index % 11)),
};

/**
 * A four-hour, 1 Hz, eight-channel stream set — #27's round-trip fixture.
 *
 * Not shrunk to make the test fast. #27 asks for 14,400 samples across eight
 * channels precisely because a smaller set does not exercise the thing that
 * costs: if it is slow, that *is* the retrieval-latency measurement the next
 * criterion asks for.
 */
export function streamSetFor(ride: NewActivity, options: StreamFixtureOptions = {}): NewStreamSet {
  const sampleCount = options.sampleCount ?? FOUR_HOUR_SAMPLE_COUNT;
  const wanted = options.channels ?? STREAM_CHANNELS;
  const gaps = options.gaps ?? [];

  const channels: { -readonly [C in StreamChannel]?: Samples<C> } = {};
  for (const channel of STREAM_CHANNELS) {
    if (!wanted.includes(channel)) {
      continue;
    }
    const absent = absentIndexes(gaps, channel);
    const generate = GENERATORS[channel];
    const samples = new Array<ReturnType<typeof generate> | undefined>(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = absent.has(index) ? undefined : generate(index);
    }
    // The channel name is only known at run time; the generator table is keyed
    // by the same name, so the samples are that channel's own quantity.
    (channels as Record<StreamChannel, readonly unknown[]>)[channel] = samples;
  }

  return {
    activityId: ride.id,
    athleteId: ride.athleteId,
    startedAt: options.startedAt ?? ride.startedAt,
    sampleInterval: seconds(1),
    sampleCount,
    channels,
  };
}

function absentIndexes(gaps: readonly StreamGap[], channel: StreamChannel): ReadonlySet<number> {
  const absent = new Set<number>();
  for (const gap of gaps) {
    if (gap.channel !== channel) {
      continue;
    }
    for (let index = gap.from; index < gap.from + gap.count; index += 1) {
      absent.add(index);
    }
  }
  return absent;
}

/** The thirty-second heart-rate dropout #27 names, starting at ten minutes in. */
export const DROPPED_STRAP: StreamGap = { channel: 'heartRate', from: 600, count: 30 };

let recordingCounter = 0;

/**
 * A recording in progress, for one athlete.
 *
 * Takes an owner for `rideFor`'s reason: the write-path scoping case — athlete
 * B appending to athlete A's recording — has to be as short to write as the
 * read-path one, or it does not get written.
 */
export function recordingFor(
  owner: AthleteId,
  overrides: Partial<NewRecordingSession> = {},
): NewRecordingSession {
  recordingCounter += 1;
  return {
    id: recordingSessionId(`recording-${String(recordingCounter)}`),
    athleteId: owner,
    startedAt: unixSeconds(FIXTURE_EPOCH + 100_000),
    sampleInterval: seconds(1),
    state: 'recording',
    updatedAt: unixSeconds(FIXTURE_EPOCH + 100_000),
    pauses: [],
    ...overrides,
  };
}

/** Writes a recording header through the public path, and returns it. */
export async function seedRecording(
  harness: StoreHarness,
  owner: AthleteId,
  overrides: Partial<NewRecordingSession> = {},
): Promise<NewRecordingSession> {
  const recording = recordingFor(owner, overrides);
  await harness.write(async (store) => store.putRecordingSession(recording));
  return recording;
}

/**
 * Slices a stream set into the flushes a recorder would have written.
 *
 * Built from `streamSetFor`'s output rather than from fresh generators, so a
 * recording fixture and a stream-set fixture carry **the same samples and the
 * same gaps** — which is what makes "the recovered recording equals the ride
 * that was ridden" a comparison against something independent of the recording
 * path rather than against the recording path's own output.
 *
 * The last window is short when `chunkSamples` does not divide the set, which
 * is the normal case: a ride ends when the rider stops, not on a flush
 * boundary.
 */
export function chunksOf(
  recording: NewRecordingSession,
  set: NewStreamSet,
  chunkSamples: number,
): NewRecordingChunk[] {
  const chunks: NewRecordingChunk[] = [];
  let seq = 0;
  for (let from = 0; from < set.sampleCount; from += chunkSamples) {
    const count = Math.min(chunkSamples, set.sampleCount - from);
    const channels: { -readonly [C in StreamChannel]?: Samples<C> } = {};
    for (const channel of STREAM_CHANNELS) {
      const samples = set.channels[channel];
      if (samples === undefined) {
        continue;
      }
      (channels as Record<StreamChannel, readonly unknown[]>)[channel] = samples.slice(
        from,
        from + count,
      );
    }
    chunks.push({
      sessionId: recording.id,
      athleteId: recording.athleteId,
      seq,
      fromIndex: from,
      sampleCount: count,
      channels,
    });
    seq += 1;
  }
  return chunks;
}

/** Everything but the two position channels — the indoor trainer case. */
export const CHANNELS_WITHOUT_POSITION: readonly StreamChannel[] = STREAM_CHANNELS.filter(
  (channel) => channel !== 'latitude' && channel !== 'longitude',
);

export type { ActivityId, AthleteId, LapId, RecordingSessionId };

// --- Identity and signed records (#61) --------------------------------------

/**
 * The bytes a fixture record vouches for, standing in for an activity file.
 *
 * Deliberately not a real FIT file: what a signed record references is a
 * SHA-256 of some bytes, and the format of those bytes is `packages/fit`'s
 * business and not this record's. Using a short array keeps the tampering case
 * — flip one byte, watch the content hash stop matching — legible.
 */
export const FIXTURE_FILE_BYTES = new Uint8Array([0x2e, 0x46, 0x49, 0x54, 0x01, 0x02, 0x03, 0x04]);

/**
 * The claims a record makes about a ride.
 *
 * A projection of the activity, and a **narrowing** one: it carries the summary
 * fields and nothing that could locate the ride. `ActivityClaims` has no
 * coordinate member, so this function could not add one if it tried.
 */
export function claimsFor(ride: NewActivity): ActivityClaims {
  return {
    activityId: ride.id,
    name: ride.name,
    startedAt: ride.startedAt,
    startedAtTimeZone: ride.startedAtTimeZone,
    elapsedTime: ride.elapsedTime,
    movingTime: ride.movingTime,
    distance: ride.distance,
    hasPosition: ride.hasPosition,
    ...(ride.averagePower === undefined ? {} : { averagePower: ride.averagePower }),
  };
}

/** A signed record for a ride, ready to hand to `putActivityRecord`. */
export async function signedRecordFor(
  ride: NewActivity,
  key: SigningKey,
  fileBytes: Uint8Array = FIXTURE_FILE_BYTES,
): Promise<StoredActivityRecord> {
  return {
    athleteId: ride.athleteId,
    activityId: ride.id,
    record: await signActivityRecord(
      { claims: claimsFor(ride), contentHash: await contentHashOf(fileBytes, webCryptoSha256) },
      key,
    ),
  };
}

/**
 * A keypair whose private half **can** be exported, and its bytes.
 *
 * ⚠️ **Test-only, and the production keystore cannot produce one.**
 * `generateDeviceKey` passes `extractable: false` and takes no option that
 * would change it; this function calls `generateKey` itself.
 *
 * It exists for one test — the grep #61's second acceptance criterion asks for.
 * "No exported file, log line or error report contains the private key" is only
 * a checkable statement if the private key has bytes to search for, and the
 * production key deliberately has none. So the grep runs against a key whose
 * bytes are known, through the same store rows, the same serialisation and the
 * same error paths. `identity-safety.test.ts` asserts the *stronger* property
 * separately, on a real production key: that exporting it rejects at all.
 */
export async function extractableDeviceKey(owner: AthleteId): Promise<{
  readonly record: DeviceKeyRecord;
  readonly key: SigningKey;
  readonly privateKeyHex: string;
}> {
  const pair = await crypto.subtle.generateKey({ name: SIGNATURE_ALGORITHM }, true, [
    'sign',
    'verify',
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const record: DeviceKeyRecord = {
    athleteId: owner,
    algorithm: SIGNATURE_ALGORITHM,
    publicKey: toHex(publicKey),
    privateKey: pair.privateKey,
    createdAt: FIXTURE_EPOCH,
  };
  return { record, key: signingKeyFor(record), privateKeyHex: toHex(privateKey) };
}

// --- Segments (#64) ----------------------------------------------------------

let segmentCounter = 0;

/**
 * Metres per degree of latitude on the sphere `@onyourleft/domain` uses, so a
 * fixture can say "50 m apart" without a magic number.
 */
const METRES_PER_DEGREE_LATITUDE = 111_194.9;

/**
 * A due-north segment of `positions` points, `spacingMetres` apart.
 *
 * The default is 21 points 50 m apart — about a kilometre, comfortably over
 * `MINIMUM_SEGMENT_LENGTH_METRES`, and enough points that
 * `thinnedGeometryStoreFactory` produces a visibly different path.
 *
 * Built through `createSegment`, never by hand, so a fixture cannot carry an
 * endpoint or a distance that disagrees with its own geometry — which is the
 * one way a round-trip test could pass while the model was wrong.
 */
export function segmentFor(
  owner: AthleteId,
  overrides: {
    readonly positions?: number;
    readonly spacingMetres?: number;
    readonly altitudes?: readonly number[];
    readonly elevationSource?: ElevationSource;
    readonly elevationResolutionMetres?: number;
    readonly visibility?: SegmentVisibility;
    readonly name?: string;
    readonly originLatitude?: number;
  } = {},
): SegmentRecord {
  segmentCounter += 1;
  const positions = overrides.positions ?? 21;
  const spacing = (overrides.spacingMetres ?? 50) / METRES_PER_DEGREE_LATITUDE;
  const originLatitude = overrides.originLatitude ?? 51.5;
  const geometry = Array.from({ length: positions }, (_unused, index) =>
    geographicPosition(degreesLatitude(originLatitude + index * spacing), degreesLongitude(-0.12)),
  );

  const built = createSegment({
    id: `segment-${String(segmentCounter)}`,
    createdBy: owner,
    name: overrides.name ?? `Segment ${String(segmentCounter)}`,
    sport: 'ride',
    geometry,
    ...(overrides.altitudes === undefined ? {} : { altitudes: overrides.altitudes }),
    elevationSource: overrides.elevationSource ?? 'none',
    ...(overrides.elevationResolutionMetres === undefined
      ? {}
      : { elevationResolutionMetres: overrides.elevationResolutionMetres }),
    visibility: overrides.visibility ?? 'private',
    createdAt: FIXTURE_EPOCH,
  });

  // `createSegment` returns the domain shape, whose `id` and `createdBy` are
  // plain strings — this package cannot ask it for its brands, because the
  // dependency points the other way. Re-entering them through the id
  // constructors is where the brand is applied, and it validates at the same
  // time.
  return { ...built, id: segmentId(built.id), createdBy: athleteId(built.createdBy) };
}

/**
 * An effort fixture whose id is **derived**, exactly as the matcher derives it.
 *
 * ⚠️ Built through `@onyourleft/domain`'s `effortId` rather than by writing the
 * three parts here, so that a fixture cannot disagree with the production key
 * — which is the one field whose shape #66's idempotence criterion rests on.
 */
export function effortFor(
  owner: AthleteId,
  segment: SegmentId,
  activity: ActivityId,
  overrides: {
    readonly startedAt?: UnixSeconds;
    readonly elapsedSeconds?: number;
    readonly deviationMetres?: number;
    readonly visibility?: EffortVisibility;
    readonly riderMassKilograms?: number;
  } = {},
): SegmentEffortRecord {
  const startedAt = overrides.startedAt ?? FIXTURE_EPOCH;
  return {
    id: segmentEffortId(effortId(segment, activity, startedAt)),
    athleteId: owner,
    segmentId: segment,
    activityId: activity,
    startedAt,
    elapsed: seconds(overrides.elapsedSeconds ?? 90),
    deviation: metres(overrides.deviationMetres ?? 6),
    visibility: overrides.visibility ?? 'public',
    attributes:
      overrides.riderMassKilograms === undefined
        ? {}
        : { riderMass: kilograms(overrides.riderMassKilograms) },
  };
}

let workoutCounter = 0;
let routeCounter = 0;

/**
 * A saved route: a closed square loop, climbing over the first half and
 * descending over the second so its two ends agree in height as well as place.
 *
 * A **loop by default**, which is the opposite of how one would pick a default
 * for convenience and is deliberate: `loop` is the one-bit field with no
 * structural redundancy behind it, `openedLoopStoreFactory` is the fake that
 * loses it, and a fixture that defaulted to `false` would make that fake
 * indistinguishable from a correct store.
 *
 * Built through `routeProfile`, never by hand, so a fixture cannot carry a
 * distance, an ascent or a gradient that disagrees with its own geometry —
 * which is the one way a round-trip test could pass while the model was wrong.
 */
export function routeFor(
  owner: AthleteId,
  overrides: {
    readonly loop?: boolean;
    readonly name?: string;
    readonly visibility?: Visibility;
    readonly updatedAt?: number;
    readonly sideMetres?: number;
    readonly spacingMetres?: number;
    readonly originLatitude?: number;
  } = {},
): RouteRecord {
  routeCounter += 1;
  const loop = overrides.loop ?? true;
  const side = overrides.sideMetres ?? 400;
  const spacing = overrides.spacingMetres ?? 20;
  const originLatitude = overrides.originLatitude ?? 51.5;
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((originLatitude * Math.PI) / 180);

  const corners: [number, number][] = [
    [0, 0],
    [0, side],
    [side, side],
    [side, 0],
  ];
  const points: RoutePoint[] = [];
  const legs = loop ? corners.length : corners.length - 1;
  for (let leg = 0; leg < legs; leg += 1) {
    const from = corners[leg] as [number, number];
    const to = corners[(leg + 1) % corners.length] as [number, number];
    const steps = Math.max(1, Math.round(side / spacing));
    for (let step = 0; step < steps; step += 1) {
      const north = from[0] + ((to[0] - from[0]) * step) / steps;
      const east = from[1] + ((to[1] - from[1]) * step) / steps;
      points.push({
        position: geographicPosition(
          degreesLatitude(originLatitude + north / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(-0.12 + east / perDegreeLongitude),
        ),
        elevation: altitudeMetres(
          40 + 20 * Math.sin((2 * Math.PI * (leg * steps + step)) / (legs * steps)),
        ),
      });
    }
  }
  if (loop) {
    // The closing point IS the first, so the loop closes to the last bit rather
    // than to a tolerance.
    points.push(points[0] as RoutePoint);
  }

  return {
    id: routeId(`route-${String(routeCounter)}`),
    createdBy: owner,
    name: overrides.name ?? `Route ${String(routeCounter)}`,
    profile: routeProfile(points, { loop }),
    // ⚠️ Private unless a test says otherwise, which is the fixture equivalent
    // of ADR 0004 decision A. A fixture defaulting to `public` would make
    // `publishedRouteStoreFactory` indistinguishable from a correct store.
    visibility: overrides.visibility ?? DEFAULT_VISIBILITY,
    createdAt: unixSeconds(FIXTURE_EPOCH),
    updatedAt: unixSeconds(overrides.updatedAt ?? FIXTURE_EPOCH),
  };
}

/**
 * A saved workout with **every block kind in it**, which is the point.
 *
 * A fixture of three steady blocks would round-trip through a store that
 * forgot how to persist a ramp's two endpoints or an intervals block's
 * repeats, and say nothing. This one carries a steady, a ramp, an intervals
 * block and a free ride, so the round trip covers the whole discriminated
 * union rather than its easiest member.
 */
export function workoutFor(
  owner: AthleteId,
  overrides: {
    readonly name?: string;
    readonly description?: string;
    readonly updatedAt?: number;
    readonly blocks?: readonly WorkoutBlock[];
  } = {},
): WorkoutRecord {
  workoutCounter += 1;
  const name = overrides.name ?? `Workout ${String(workoutCounter)}`;
  const blocks: readonly WorkoutBlock[] = overrides.blocks ?? [
    { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6), label: 'Warm up' },
    { kind: 'ramp', seconds: seconds(300), from: thresholdShare(0.6), to: thresholdShare(1.05) },
    {
      kind: 'intervals',
      repeats: 4,
      hardSeconds: seconds(180),
      hardTarget: thresholdShare(1.1),
      easySeconds: seconds(120),
      easyTarget: thresholdShare(0.5),
      label: '4 × 3',
    },
    { kind: 'free-ride', seconds: seconds(420), label: 'Spin down' },
  ];
  return {
    id: workoutId(`workout-${String(workoutCounter)}`),
    createdBy: owner,
    name,
    // ⚠️ No description by DEFAULT, deliberately: it is an optional field, so
    // the default fixture is the "absent stays absent" case and every existing
    // assertion goes on covering it. A test that wants the other case asks.
    workout: {
      name,
      ...(overrides.description === undefined ? {} : { description: overrides.description }),
      blocks,
    },
    createdAt: unixSeconds(FIXTURE_EPOCH),
    updatedAt: unixSeconds(overrides.updatedAt ?? FIXTURE_EPOCH),
  };
}

/** Writes a workout for `owner` and returns it. The athlete must already exist. */
export async function seedWorkout(
  harness: StoreHarness,
  owner: AthleteId,
  overrides: Parameters<typeof workoutFor>[1] = {},
): Promise<WorkoutRecord> {
  const workout = workoutFor(owner, overrides);
  await harness.write(async (store) => store.putWorkout(workout));
  return workout;
}

/** Writes a route for `owner` and returns it. The athlete must already exist. */
export async function seedRoute(
  harness: StoreHarness,
  owner: AthleteId,
  overrides: Parameters<typeof routeFor>[1] = {},
): Promise<RouteRecord> {
  const route = routeFor(owner, overrides);
  await harness.write(async (store) => store.putRoute(route));
  return route;
}
