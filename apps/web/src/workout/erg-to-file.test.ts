// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #14's fourth criterion, end to end: *"a workout completed in ERG produces a
 * **FIT file** whose recorded power matches the targets within a stated
 * tolerance."*
 *
 * ⚠️ **`session.test.ts` already asserts the tolerance — against the machine's
 * own power stream.** Its own header says so. What that leaves unproved is
 * everything between the trainer's notification and the file a rider keeps, and
 * that is four separate places a watt can be lost: the recorder's channel
 * merge, auto-pause, the 1 Hz sample grid, and the encoder's scaling. Every one
 * of those is green in isolation; nothing joined them.
 *
 * So this file rides the workout against the #44 simulator, records the power
 * the machine reports, turns the recording into an activity, exports it through
 * the **real** export path, decodes the bytes with the **real** decoder, and
 * compares what comes back to the plan.
 *
 * ## What it deliberately does not go through
 *
 * The ride controller. `controller.test.ts` already asserts that a measurement
 * reaches the recorder and the screen *through the same call* — its own comment
 * is that "a screen that showed a reading the recorder never saw would be the
 * bug this closes" — so re-proving that here would duplicate a rig rather than
 * cover a seam. The seam this file owns starts at the recorder.
 *
 * ## The auto-pause trap, and why `autoPause: null` here is not a dodge
 *
 * `CLAUDE.md` §8: a recorder fed **only power** auto-pauses, because an
 * ERG-mode trainer holds a target while the rider is off the bike. This bench
 * subscribes to `power` alone, so a twelve-second ride would record ten seconds
 * and then pause — which would be the simulator's subscription showing through,
 * not the product. A real trainer's Indoor Bike Data carries speed and cadence
 * and would keep the recording moving. Disabling it here is what §8 says to do,
 * and it is called out so nobody reads the pass as evidence that a power-only
 * indoor ride records cleanly. It does not, and that is correct.
 */

import { decodeFitActivity } from '@onyourleft/fit';
import {
  expandWorkout,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type WorkoutBlock,
} from '@onyourleft/domain';
import { connectSimulatedTrainer } from '@onyourleft/sensors/protocol/testing';
import { activityId as toActivityId, recordingSessionId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rideToSave, saveFinishedRide } from '../recording/finish';
import { createRecorder, type RecordingCheckpointStore } from '../recording/recorder';
import { exportActivity } from '../transfer/export-activity';
import { createWorkoutSession } from './session';

const THRESHOLD = watts(250);
const ACTIVITY = toActivityId('erg-ride');
const SESSION = recordingSessionId('erg-session');
/**
 * ⚠️ The recorder's clock is the **bench's**, taken from the measurements
 * themselves rather than chosen here.
 *
 * The first version of this test started the recorder at an epoch of its own
 * and fed it measurements stamped with the simulator's, which are 100 million
 * seconds apart. Every reading was then far outside the recorder's window, all
 * of them were dropped, and the file came back with **zero** power records —
 * which the tolerance loop would have passed vacuously had the length check not
 * been there. Two clocks is the same class of defect `controller.ts` warns
 * about when it anchors a workout on `now()` rather than the cached tick.
 */
const settleAt = (powers: readonly { readonly at: number }[]): number => powers[0]?.at ?? 0;

/**
 * The tolerance, and every watt of it is accounted for.
 *
 * - **1 W of quantisation**, which the machine *declares* through its Supported
 *   Power Range rather than this test assuming it.
 * - **1 W of grid**, because the recorder lands notifications on a 1 Hz grid
 *   and the machine notifies on its own clock, so the sample that straddles a
 *   target change can hold either side of it.
 *
 * ⚠️ It is **not** a fudge factor to be widened until the test passes. If this
 * has to grow, something between the trainer and the file started rounding, and
 * that is the finding rather than the obstacle.
 */
const TOLERANCE_WATTS = 2;

/** 150 W then 250 W, at a 250 W threshold. Six seconds each. */
const PLAN = () =>
  expandWorkout({
    name: 'Two intervals',
    blocks: [
      { kind: 'steady', seconds: seconds(6), target: thresholdShare(0.6) },
      { kind: 'steady', seconds: seconds(6), target: thresholdShare(1) },
    ] satisfies WorkoutBlock[],
  });

let harness: StoreHarness;

beforeEach(() => {
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

function checkpointStore(): RecordingCheckpointStore {
  return {
    putRecordingSession: async (record) =>
      harness.write(async (store) => store.putRecordingSession(record)),
    appendRecordingChunk: async (chunk) =>
      harness.write(async (store) => store.appendRecordingChunk(chunk)),
    listRecordingSessions: async (owner) =>
      harness.write(async (store) => store.listRecordingSessions(owner)),
    recoverRecording: async (owner, id) =>
      harness.write(async (store) => store.recoverRecording(owner, id)),
    deleteRecordingSession: async (owner, id) =>
      harness.write(async (store) => store.deleteRecordingSession(owner, id)),
  };
}

/**
 * Ride the whole workout, recording what the machine says as it goes.
 *
 * The power measurements are the bench's own — the same objects
 * `transport.subscribe('power')` delivers to the ride screen — handed to
 * `recorder.observe` exactly as the controller hands them over.
 */
async function rideAndRecord(): Promise<Uint8Array> {
  const trainer = await connectSimulatedTrainer();
  await trainer.control.requestControl();
  const session = createWorkoutSession({
    timeline: PLAN(),
    thresholdPower: THRESHOLD,
    control: trainer.control,
  });

  const recorder = createRecorder({
    store: checkpointStore(),
    athleteId: ATHLETE_A,
    sessionId: SESSION,
    // See this file's header. §8's trap, disabled on purpose and said out loud.
    autoPause: null,
  });
  // Ride the workout first, so the recorder can be started on the machine's
  // own clock rather than on one this test invented. See `settleAt`.
  session.start(seconds(0));
  for (let second = 0; second <= 12; second += 1) {
    session.tick(seconds(second));
    await session.settled();
  }
  expect(session.state().player.status).toBe('finished');

  const epoch = settleAt(trainer.powers);
  await recorder.start(unixSeconds(epoch));
  for (const measurement of trainer.powers) {
    recorder.observe(measurement);
    await recorder.tick(unixSeconds(measurement.at));
  }
  await recorder.stop(unixSeconds(trainer.powers.at(-1)?.at ?? epoch));

  await seedAthletes(harness);
  const saved = await harness.write(async (store) =>
    saveFinishedRide(
      store,
      rideToSave({
        id: ACTIVITY,
        athleteId: ATHLETE_A,
        series: recorder.session.series(),
        elapsedTime: recorder.session.elapsedTime,
        movingTime: recorder.session.movingTime,
        timeZone: 'Europe/London',
        now: unixSeconds(trainer.powers.at(-1)?.at ?? 0),
        workoutName: 'Two intervals',
      }),
    ),
  );
  expect(saved.status).toBe('saved');

  const exported = await harness.read(async (store) =>
    exportActivity({ store, athleteId: ATHLETE_A, activityId: ACTIVITY, format: 'fit' }),
  );
  return exported.file.bytes;
}

describe('a workout ridden in ERG reaches a FIT file with its targets intact', () => {
  it('writes a file whose recorded power matches the plan within the tolerance', async () => {
    const bytes = await rideAndRecord();

    // ⚠️ Decoded, not inspected. The claim is about the file a rider ends up
    // with, so the assertion has to go through the reader rather than through
    // the samples the encoder was handed.
    const decoded = decodeFitActivity(bytes);
    // ⚠️ Faults are asserted empty rather than ignored. `FitDecodeResult` keeps
    // them out of the activity deliberately, so a reader that only looks at
    // `.activity` gets the data and never learns the ride came back short.
    expect(decoded.faults).toStrictEqual([]);
    // Widened out of the brand deliberately: what is being compared is a
    // number of watts against a number of watts, and keeping the brand here
    // would only make the arithmetic below need casts of its own.
    const powers = decoded.activity.records
      .map((record) => (record.power === undefined ? undefined : (record.power as number)))
      .filter((power): power is number => power !== undefined);

    // The plan is twelve seconds, and the machine's first notification lands
    // one second after the start — so sample `i` is roughly workout second
    // `i + 1`, and the samples inside the workout are the first eleven.
    const PLAN_SECONDS = 12;
    // ⚠️ Two seconds of settling, the same allowance `session.test.ts` makes
    // and for the same reason: the first setpoint has not reached the machine
    // yet, and what is being asserted is the steady state.
    const SETTLING = 2;
    const inWorkout = powers.slice(SETTLING, PLAN_SECONDS - 1);
    expect(inWorkout.length).toBeGreaterThan(6);

    for (const power of inWorkout) {
      const nearest = [150, 250].reduce((best, target) =>
        Math.abs(power - target) < Math.abs(power - best) ? target : best,
      );
      expect(Math.abs(power - nearest)).toBeLessThanOrEqual(TOLERANCE_WATTS);
    }

    // ⚠️ And both targets are actually in the file. Without this the loop above
    // is satisfied by a ride that never left its first interval — a workout
    // that stopped controlling after one target would pass every assertion
    // above it.
    expect(inWorkout).toContain(150);
    expect(inWorkout).toContain(250);

    // ⚠️ The tail is asserted to be NOT a target, which is the release reaching
    // the file. When the workout finishes the machine is let go — with `stop`,
    // never a target of zero — so the rider's own power comes back, and a file
    // that still showed 250 W after the finish would mean the trainer was never
    // released. This is the one place that fact is visible in a recorded ride.
    const afterTheFinish = powers.at(-1);
    expect(afterTheFinish).toBeDefined();
    for (const target of [150, 250]) {
      expect(Math.abs((afterTheFinish ?? 0) - target)).toBeGreaterThan(TOLERANCE_WATTS);
    }
  });

  it('names the file after the workout that was ridden', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    await seedAthletes(harness);
    // A ride named after its workout is how a rider finds it again; the
    // fallback is the local calendar day, which `finish.test.ts` pins.
    const finished = rideToSave({
      id: ACTIVITY,
      athleteId: ATHLETE_A,
      series: {
        startedAt: unixSeconds(1_800_000_000),
        sampleInterval: seconds(1),
        sampleCount: 1,
        channels: { power: [watts(150)] },
        pauses: [],
      },
      elapsedTime: seconds(1),
      movingTime: seconds(1),
      timeZone: 'Europe/London',
      now: unixSeconds(1_800_000_001),
      workoutName: 'Two intervals',
    });
    await harness.write(async (store) => saveFinishedRide(store, finished));
    const exported = await harness.read(async (store) =>
      exportActivity({ store, athleteId: ATHLETE_A, activityId: ACTIVITY, format: 'fit' }),
    );
    expect(exported.file.fileName).toContain('Two intervals');
  });
});
