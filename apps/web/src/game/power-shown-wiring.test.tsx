// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2420's wiring: the HUD's power is a 3-second average by default and the
 * reading as it arrives once the rider chooses instant — and **the ride itself
 * is the same in both**.
 *
 * One noisy but steady effort — a steady 250 W ridden as 200 and 300 by turns,
 * a reading a second — ridden twice through the production path: the #44
 * simulator's trainer, the real ride controller recording it, `gameSensors`
 * over the controller's snapshot (`main.tsx` §`readSensors`), the real
 * `GameView`, simulation, gradient driver and HUD, and the trainer written
 * through `gameTrainerPortOver(controller)`. The only doubles are the store
 * (`createStoreHarness`), the GL context and the clock.
 *
 * What is read is what each consumer was handed: the input the simulation was
 * advanced with, every octet written to the trainer's control point, the ride
 * the store kept (every stream, the distance, the times, the average power)
 * and the ride's totals on the HUD — identical in both views — and the power
 * the HUD drew each frame, which is not.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seconds, watts } from '@onyourleft/domain';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { activityId, recordingSessionId } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type RidableRoute } from './GameView';
import {
  DEFAULT_HUD_LAYOUT,
  HUD_LAYOUT_STORAGE_KEY,
  writeHudLayout,
  type HudPowerView,
} from './hud/hud-layout-preference';
import type { GameRenderer } from './port';
import { northRoute } from './route-fixtures-testing';
import { gameSensors } from './sensors';
import { GameSimulation, type RiderInput } from './simulation';
import { gameTrainerPortOver } from './trainer-port';

const START_MS = 1_000_000;
/** Four frames a second of the game's clock; the bench keeps whole seconds. */
const FRAME_MS = 250;
const FRAMES_PER_SECOND = 1000 / FRAME_MS;
/** Twenty seconds of ride. */
const FRAMES = 80;

/** A steady 250 W as the pedal stroke delivers it: 200 and 300 by turns, a second each. */
function powerInSecond(second: number): number {
  return second % 2 === 0 ? 200 : 300;
}

const ROUTE: RidableRoute = {
  id: 'north',
  name: 'North road',
  profile: northRoute(2_000, (along) => along * 0.03),
  attempts: 0,
};

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

function renderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: () => undefined,
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
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
  localStorage.clear();
});

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

/** One animation frame. */
async function pump(): Promise<void> {
  const due = pending;
  if (due.length === 0) throw new Error('the ride asked for no frame');
  pending = [];
  nowMs += FRAME_MS;
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The HUD field whose term is `label`, as a rider reads it: its term and its value. */
function field(label: RegExp): { readonly term: string; readonly value: string } | undefined {
  const row = queryAll(mounted?.container ?? document, '.oyl-hud__field').find((each) =>
    label.test(each.querySelector('dt')?.textContent ?? ''),
  );
  if (row === undefined) return undefined;
  return {
    term: row.querySelector('dt')?.textContent ?? '',
    value: row.querySelector('dd')?.textContent ?? '',
  };
}

/** Everything one ride left, in each consumer. */
interface Ridden {
  /** The power the HUD drew each frame, in watts, `undefined` for a dash. */
  readonly shown: readonly (number | undefined)[];
  /** The power field's term, as the last frame drew it. */
  readonly term: string;
  /** The controller's power each frame — the raw reading. */
  readonly raw: readonly (number | undefined)[];
  /** Every input the simulation was advanced with. */
  readonly simulated: readonly RiderInput[];
  /** Every write to the trainer's control point, as octets. */
  readonly written: readonly (readonly number[])[];
  /** The HUD's *Avg power* each frame: the recorder's totals. */
  readonly totals: readonly string[];
  /** What the store kept. */
  readonly recorded: unknown;
}

/** The scripted ride under `view`, recorded by the real controller against the #44 simulator. */
async function ride(view: HudPowerView): Promise<Ridden> {
  pending = [];
  nowMs = START_MS;
  writeHudLayout(localStorage, { ...DEFAULT_HUD_LAYOUT, power: view });
  const harness = createStoreHarness();
  await seedAthletes(harness);
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  const written: number[][] = [];
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
    openTrainer: simulatedOpenTrainer(bench, { written, refuseControl: false }),
    rideSave: {
      newActivityId: () => activityId('the-ride'),
      newLapId: () => {
        throw new Error('this ride has no laps');
      },
      timeZone: 'Europe/London',
      store: {
        putFinishedRide: (finished) =>
          harness.write(async (store) => store.putFinishedRide(finished)),
      },
    },
  });
  await controller.pair('trainer');
  await controller.start();

  // Every input the simulation is advanced with: the spy calls through.
  const advanced = vi.spyOn(GameSimulation.prototype, 'advanceTo');

  mounted = await mount(
    <GameView
      port={{
        listRoutes: () => Promise.resolve([ROUTE]),
        loadGhost: () => Promise.resolve(undefined),
        // The production port: the controller's snapshot, through `gameSensors`.
        readSensors: () => gameSensors(controller.getSnapshot()),
      }}
      trainer={gameTrainerPortOver(controller)}
      renderer={() => Promise.resolve(renderer())}
      now={() => nowMs}
    />,
  );
  await settle();
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );

  const shown: (number | undefined)[] = [];
  const raw: (number | undefined)[] = [];
  const totals: string[] = [];
  let term = '';
  for (let frame = 0; frame < FRAMES; frame += 1) {
    if (frame % FRAMES_PER_SECOND === 0) {
      await act(async () => {
        bench.rider.set({ power: watts(powerInSecond(frame / FRAMES_PER_SECOND)) });
        bench.advance(seconds(1));
        await controller.tick(bench.now);
      });
    }
    await pump();
    const power = field(/^Power\b/);
    term = power?.term ?? '';
    const digits = /^(\d+)/.exec(power?.value ?? '')?.[1];
    shown.push(digits === undefined ? undefined : Number(digits));
    const reading = gameSensors(controller.getSnapshot()).rider;
    raw.push(reading.live ? reading.power : undefined);
    totals.push(field(/^Avg power$/)?.value ?? '');
  }
  await settle();
  await act(async () => {
    controller.armStop();
    await controller.confirmStop();
  });
  for (let index = 0; index < 10; index += 1) await settle();
  const simulated = advanced.mock.calls.map(([, input]) => input);
  expect(controller.getSnapshot().saveState).toBe('saved');
  const [activity, streams] = await harness.read(async (store) => [
    await store.getActivity(ATHLETE_A, activityId('the-ride')),
    await store.getStreamSet(ATHLETE_A, activityId('the-ride')),
  ]);
  controller.dispose();
  await harness.destroy();
  mounted?.unmount();
  mounted = undefined;
  vi.restoreAllMocks();
  localStorage.removeItem(HUD_LAYOUT_STORAGE_KEY);
  if (activity === undefined || streams === undefined) throw new Error('the ride was not saved');
  return {
    shown,
    term,
    raw,
    simulated,
    written,
    totals,
    recorded: { activity, channels: streams.channels },
  };
}

/** The difference between the largest and the smallest of `values`. */
function spread(values: readonly (number | undefined)[]): number {
  const numbers = values.filter((value): value is number => value !== undefined);
  return Math.max(...numbers) - Math.min(...numbers);
}

/** Two recorded rides: well under a second each on an M-series Mac without coverage. */
const TWO_RIDES = { timeout: 15_000 } as const;

describe('power as a 3 s average or instant, on the ride — #2420', () => {
  it(
    'draws a steadier power in 3 s than instant, and the simulation, the trainer, the recording and the totals are the same in both',
    TWO_RIDES,
    async () => {
      const average = await ride('average');
      const instant = await ride('instant');

      // The term says which, as a rider and a screen reader read it.
      expect(average.term).toBe('Power (3 s)');
      expect(instant.term).toBe('Power (instant)');

      // Instant is the reading as it arrives, frame by frame, as before #2420.
      expect(instant.shown).toEqual(instant.raw);
      // Non-vacuity: the readings really were noisy, 200 and 300 by turns.
      const settled = (values: readonly (number | undefined)[]) =>
        values.slice(5 * FRAMES_PER_SECOND);
      expect(spread(settled(instant.shown))).toBe(100);
      // The 3 s average, once three seconds are in it, stays close to 250.
      expect(spread(settled(average.shown))).toBeLessThanOrEqual(34);
      for (const value of settled(average.shown)) {
        expect(value).toBeGreaterThanOrEqual(232);
        expect(value).toBeLessThanOrEqual(268);
      }

      // The ride itself, the same in both views. Non-vacuity first: it was
      // simulated, written, recorded and totalled.
      expect(average.simulated.length).toBeGreaterThan(FRAMES / 2);
      expect(average.simulated.some((input) => input.power === watts(300))).toBe(true);
      expect(average.written.length).toBeGreaterThan(1);
      expect(average.totals.at(-1)).toMatch(/^\d+ W$/);
      expect(instant.simulated).toStrictEqual(average.simulated);
      expect(instant.written).toStrictEqual(average.written);
      expect(instant.recorded).toStrictEqual(average.recorded);
      expect(instant.totals).toStrictEqual(average.totals);
      // And the raw readings the two rides were fed are the same readings.
      expect(instant.raw).toStrictEqual(average.raw);
    },
  );
});
