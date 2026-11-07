// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A cadence cue (#2302) through the read path the app uses: a tailored drill
 * saved through the workouts store port into the REAL store, read back with
 * `getWorkout` from a FRESH connection (`@onyourleft/store/testing`'s harness
 * discards every handle before it reads), started on the real ride controller
 * over the #44 simulator's trainer, and rendered on the ride screen's workout
 * panel — where the cue's words must be in the document.
 *
 * So what is asserted is what a reload would show and a rider would read,
 * not the object the test built.
 */

import { CADENCE_WORKOUTS, seconds, tailorWorkout, unixSeconds, watts } from '@onyourleft/domain';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { recordingSessionId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createRideController, type RideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { WorkoutPanel } from '../ride/WorkoutPanel';
import { mount, settle, type Mounted } from '../testing/mount';
import type { WorkoutStore } from '../workouts/store-port';
import { workoutStub } from '../workouts/testing';

const THRESHOLD = watts(250);

const cleanups: (() => Promise<void>)[] = [];
let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The five-minute strength drill, twice: a cue on every main-set stretch. */
function drill(): WorkoutRecord {
  const template = CADENCE_WORKOUTS.find((each) => each.id === 'cadence-low-strength-5min');
  if (template === undefined) throw new Error('no strength drill in the library');
  const workout = tailorWorkout(template, { repeats: 2 });
  return {
    id: workoutId('drill'),
    createdBy: ATHLETE_A,
    name: workout.name,
    workout,
    createdAt: unixSeconds(1_800_000_000),
    updatedAt: unixSeconds(1_800_000_000),
  };
}

/** Saved through the port and read back through it, on a connection that did not write. */
async function savedAndReadBack(harness: StoreHarness): Promise<WorkoutRecord> {
  const record = drill();
  await harness.write(async (store) => {
    const port: WorkoutStore = store;
    await port.putWorkout(record);
  });
  const read = await harness.read(async (store) => {
    const port: WorkoutStore = store;
    return port.getWorkout(ATHLETE_A, record.id);
  });
  if (read === undefined) throw new Error('the saved drill did not read back');
  return read;
}

/** The ride controller `main.tsx` builds, over the simulator's FTMS trainer, with control. */
async function onTheBench(harness: StoreHarness) {
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
  });
  cleanups.push(() => {
    controller.dispose();
    return Promise.resolve();
  });
  await controller.pair('trainer');
  await controller.requestTrainerControl();
  await controller.start();
  /** Ride until the workout's own clock reads `elapsed`, a second at a time. */
  const rideTo = async (elapsed: number): Promise<void> => {
    while ((controller.getSnapshot().workout?.elapsedSeconds ?? Infinity) < elapsed) {
      bench.advance(seconds(1));
      await controller.tick(bench.now);
    }
  };
  return { controller, rideTo };
}

async function panelFor(controller: RideController): Promise<HTMLElement> {
  mounted?.unmount();
  const snapshot = controller.getSnapshot();
  mounted = await mount(
    <WorkoutPanel
      trainer={snapshot.trainer}
      workout={snapshot.workout}
      port={workoutStub(ATHLETE_A, [])}
      thresholdPower={THRESHOLD}
      onStart={() => undefined}
      onEnd={() => undefined}
    />,
  );
  await settle();
  return mounted.container;
}

const cueLine = (root: HTMLElement): string | undefined =>
  root.querySelector('[data-oyl-cadence-cue]')?.textContent ?? undefined;

describe('a cadence cue, saved, read back and ridden (#2302)', () => {
  it('is on the ride screen for the stretch that names it, from the row a reload reads', async () => {
    const harness = createStoreHarness();
    cleanups.push(() => harness.destroy());
    await seedAthletes(harness);
    const record = await savedAndReadBack(harness);

    const { controller, rideTo } = await onTheBench(harness);
    expect(controller.startWorkout(record, THRESHOLD)).toBe(true);

    // The warm-up names no cue, so there is no line.
    // Ten minutes of warm-up, then a minute into the gear, five minutes of
    // effort and three of easy spinning.
    await rideTo(30);
    expect(controller.getSnapshot().workout?.status).toBe('running');
    expect(cueLine(await panelFor(controller))).toBeUndefined();

    // Into the gear: the ramp's cue, between the easy spin and the effort.
    await rideTo(630);
    expect(cueLine(await panelFor(controller))).toBe('Cadence cue: 70–80 rpm');

    // The effort itself, and then the easy spin after it.
    await rideTo(690);
    const effort = await panelFor(controller);
    expect(cueLine(effort)).toBe('Cadence cue: 60–65 rpm');
    expect(effort.textContent).toContain('Now: 5 min at 85%');
    await rideTo(990);
    expect(cueLine(await panelFor(controller))).toBe('Cadence cue: 85–95 rpm');
  });
});
