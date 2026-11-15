// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * What the trainer panel says once the end of a workout has let the trainer
 * go — #2348, the owner's ruling of 2026-11-07.
 *
 * > *After a confirmed step-down, the trainer panel must not read "The trainer
 * > may still be holding 0 W — this app can no longer tell". Say instead: "The
 * > trainer was eased off to its lowest setting, <floor> W, and released."*
 *
 * Read off the rendered `TrainerPanel`, fed the snapshot of the REAL ride
 * controller over the sensor simulator's FTMS trainer, so the sentence is the
 * one the step-down and the Stop on the wire produce, not one this file typed.
 * The unconfirmed step-down, and an *End ERG*, keep "may still be holding".
 */

import { afterEach, describe, expect, it } from 'vitest';

import { seconds, thresholdShare, unixSeconds, watts, type Watts } from '@onyourleft/domain';
import { deviceId } from '@onyourleft/sensors';
import { createSimulator, ftmsTrainer, type SimulatorBench } from '@onyourleft/sensors/simulator';
import { recordingSessionId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { ATHLETE_A } from '@onyourleft/store/testing';

import type { RecordingCheckpointStore } from '../recording/recorder';
import { mount, type Mounted } from '../testing/mount';
import { STEP_DOWN_UNCONFIRMED } from '../workout/session';

import { createRideController, type RideController } from './controller';
import { simulatedOpenTrainer } from './simulated-trainer-testing';
import { TrainerPanel } from './TrainerPanel';

/** The measured trainer's floor is not 0 W; the sentence must name the real one. */
const FLOOR = 40;
const THRESHOLD = watts(250);

const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

/** A long hard interval, so the end comes from *End workout* while it is held. */
const hardAndLong: WorkoutRecord = {
  id: workoutId('w2348-panel'),
  createdBy: ATHLETE_A,
  name: 'Hard',
  workout: {
    name: 'Hard',
    blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(1.2) }],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

interface Rig {
  readonly controller: RideController;
  readonly bench: SimulatorBench;
  readonly written: number[][];
  readonly targetOnTheTrainer: () => Watts | undefined;
}

let mounted: Mounted | undefined;
let rig: Rig | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  rig?.controller.dispose();
  rig = undefined;
});

async function flushMicrotasks(times = 20): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

async function ride(on: Rig, forSeconds: number): Promise<void> {
  for (let index = 0; index < forSeconds; index += 1) {
    on.bench.advance(seconds(1));
    await on.controller.tick(on.bench.now);
  }
}

async function riding(refuseTargetsBelow?: number): Promise<Rig> {
  const { transport, bench } = createSimulator({
    devices: [
      ftmsTrainer({
        id: 'kickr',
        name: 'KICKR 1F2A',
        retainsTargetsThroughStop: true,
        minTargetPower: watts(FLOOR),
      }),
    ],
  });
  const written: number[][] = [];
  const controller = createRideController({
    transport,
    store: CHECKPOINTS,
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-2348'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, {
      written,
      ...(refuseTargetsBelow === undefined ? {} : { refuseTargetsBelow }),
    }),
  });
  rig = {
    controller,
    bench,
    written,
    targetOnTheTrainer: () => bench.device(deviceId('kickr')).inspect().ftms?.targetPower,
  };
  await controller.pair('trainer');
  await controller.requestTrainerControl();
  await controller.start();
  return rig;
}

/** The trainer panel's text, rendered from the controller's own snapshot. */
async function panelText(on: Rig): Promise<string> {
  mounted?.unmount();
  mounted = await mount(
    <TrainerPanel
      trainer={on.controller.getSnapshot().trainer}
      onRequestControl={() => undefined}
      onSetTargetPower={() => undefined}
      onClearTarget={() => undefined}
      workoutOwnsTarget={false}
      announcementsOn={false}
    />,
  );
  return (mounted.container.textContent ?? '').replace(/\s+/g, ' ');
}

describe('the trainer panel after the end of a workout — #2348, owner ruling 2026-11-07', () => {
  it('a confirmed step-down and Stop: "eased off to its lowest setting, <floor> W, and released"', async () => {
    const on = await riding();
    expect(on.controller.startWorkout(hardAndLong, THRESHOLD)).toBe(true);
    await ride(on, 3);
    await flushMicrotasks();
    expect(on.targetOnTheTrainer()).toBe(300);
    const before = on.written.length;

    on.controller.endWorkout();
    await flushMicrotasks();

    // The wire: the floor, then the Stop — and the machine holds the floor.
    expect(on.written.slice(before)).toStrictEqual([
      [0x05, FLOOR, 0],
      [0x08, 0x01],
    ]);
    expect(on.targetOnTheTrainer()).toBe(FLOOR);

    const text = await panelText(on);
    expect(text).toContain(
      `The trainer was eased off to its lowest setting, ${String(FLOOR)} W, and released.`,
    );
    expect(text).not.toContain('may still be holding');
    expect(text).not.toContain('can no longer tell');
  });

  it('an unconfirmed step-down keeps "may still be holding", beside the approved notice', async () => {
    const on = await riding(FLOOR + 1);
    expect(on.controller.startWorkout(hardAndLong, THRESHOLD)).toBe(true);
    await ride(on, 3);
    await flushMicrotasks();

    on.controller.endWorkout();
    await flushMicrotasks();

    // The machine did not ease: it still holds the interval's target.
    expect(on.targetOnTheTrainer()).toBe(300);
    expect(on.controller.getSnapshot().trainer.easedOffTo).toBeUndefined();
    const text = await panelText(on);
    expect(text).toContain('The trainer may still be holding 300 W — this app can no longer tell.');
    expect(text).not.toContain('eased off to its lowest setting');
    expect(text).toContain(STEP_DOWN_UNCONFIRMED);
  });

  it('End ERG after the eased-off workout is said as before: "may still be holding"', async () => {
    const on = await riding();
    expect(on.controller.startWorkout(hardAndLong, THRESHOLD)).toBe(true);
    await ride(on, 3);
    await flushMicrotasks();
    on.controller.endWorkout();
    await flushMicrotasks();
    expect(await panelText(on)).toContain('eased off to its lowest setting');

    await on.controller.setTargetPower(watts(200));
    await flushMicrotasks();
    // A hand-set target replaces what the end of the workout did.
    expect(on.controller.getSnapshot().trainer.easedOffTo).toBeUndefined();
    await on.controller.clearTargetPower();
    await flushMicrotasks();

    const text = await panelText(on);
    expect(text).toContain('The trainer may still be holding 200 W — this app can no longer tell.');
    expect(text).not.toContain('eased off to its lowest setting');
  });
});
