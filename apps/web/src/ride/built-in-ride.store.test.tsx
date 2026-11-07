// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A tailored built-in ridden to its end and saved, then its ride's page read
 * from a FRESH store — #2306's defect shape, closed.
 *
 * ⚠️ **The defect this file exists for**: a ride of a built-in that records
 * correctly but whose page cannot show its blocks afterwards, because the
 * per-block view looked up a workout row that was never saved. So the ride is
 * driven through the real controller against the simulated trainer
 * (`simulated-trainer-testing.ts`), saved through the real store, and the
 * page is opened on a connection nothing wrote on — the read a rider makes
 * the next day — and the blocks are read from its table, not from the record
 * that was written.
 *
 * The workout is the built-in at 30 minutes, from the address *Ride it*
 * links to: the shortest a built-in can be made, so the ride is 1,800 ticks.
 */

import {
  BUILT_IN_WORKOUTS,
  seconds,
  tailorWorkout,
  watts,
  workoutBlockText,
  type WorkoutTemplate,
} from '@onyourleft/domain';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { activityId, lapId, openActivityStore, recordingSessionId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { matchHash } from '../shell/routes';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { READING_RIDE_TEXT, ActivityDetailView } from '../views/ActivityDetailView';
import {
  builtInRideFromQuery,
  hrefForRidingBuiltIn,
  offeredWorkout,
} from '../workouts/built-in-ride';
import { EMPTY_TAILOR_DRAFT } from '../workouts/tailor';
import { createRideController, type RideController } from './controller';
import { simulatedOpenTrainer } from './simulated-trainer-testing';

const THRESHOLD = watts(250);
const RIDE = 'the-built-in-ride';

let harness: StoreHarness;
let mounted: Mounted | undefined;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness.destroy();
});

function template(id: string): WorkoutTemplate {
  const found = BUILT_IN_WORKOUTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no built-in ${id}`);
  return found;
}

const EASY_SPIN = template('recovery-easy-spin');
const DRAFT = { ...EMPTY_TAILOR_DRAFT, length: '30' };

function rig(): { readonly controller: RideController; readonly advance: () => Promise<void> } {
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
    newSessionId: () => recordingSessionId('ride-session'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written: [] }),
    rideSave: {
      newActivityId: () => activityId(RIDE),
      newLapId: () => lapId(`lap-${String((laps += 1))}`),
      timeZone: 'Europe/London',
      store: {
        putFinishedRide: (ride) => harness.write(async (store) => store.putFinishedRide(ride)),
      },
    },
  });
  return {
    controller,
    advance: async () => {
      bench.advance(seconds(1));
      await controller.tick(bench.now);
    },
  };
}

describe('a built-in ridden to its end shows its blocks on its ride’s page — #2306', () => {
  it('lists every tailored block, with its target, read from a fresh store; and saves no workout', async () => {
    const ride = builtInRideFromQuery(matchHash(hrefForRidingBuiltIn(EASY_SPIN, DRAFT)).query);
    if (ride === undefined) throw new Error('the address asks for no built-in');
    const offered = offeredWorkout(ride, ATHLETE_A, undefined, 1_800_000_000);
    if (offered.status !== 'offered') throw new Error(offered.message);
    const tailored = tailorWorkout(EASY_SPIN, { targetMinutes: 30 });
    expect(offered.record.workout.blocks).toStrictEqual(tailored.blocks);

    const { controller, advance } = rig();
    await controller.pair('trainer');
    await controller.requestTrainerControl();
    await controller.start();
    expect(controller.startWorkout(offered.record, THRESHOLD)).toBe(true);
    for (let guard = 0; controller.getSnapshot().workout?.status !== 'finished'; guard += 1) {
      if (guard > 2_400) throw new Error('the workout never finished');
      await advance();
    }
    await advance();
    controller.armStop();
    await controller.confirmStop();
    controller.dispose();

    // No row in the workouts store, before or after: the built-in was never saved.
    expect(await harness.read((store) => store.listWorkouts(ATHLETE_A))).toEqual([]);

    // The ride's page, on a connection nothing wrote on.
    await harness.discard();
    const store = openActivityStore(harness.databaseName);
    try {
      mounted = await mount(
        <ActivityDetailView port={{ athleteId: ATHLETE_A, store }} activityId={RIDE} />,
      );
      for (let turn = 0; (document.body.textContent ?? '').includes(READING_RIDE_TEXT); turn += 1) {
        if (turn > 200) throw new Error('the ride’s page was still reading its ride');
        await settle();
      }
      const heading = queryAll(document, 'h3').find(
        (each) => each.textContent === 'Workout blocks',
      );
      expect(heading, 'no workout blocks on the ride’s page').toBeDefined();
      const table = queryAll(document, 'table').find(
        (each) =>
          each.querySelector('caption')?.textContent ===
          'Workout blocks, in the order they came up',
      );
      expect(table, 'no workout-block table').toBeDefined();
      const rows = queryAll(table as HTMLElement, 'tbody tr');
      // Every tailored block, in order, by its target — and each ridden.
      expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(
        tailored.blocks.map(workoutBlockText),
      );
      expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual(
        tailored.blocks.map((_, index) => String(index + 1)),
      );
    } finally {
      store.close();
    }
  }, 120_000);
});
