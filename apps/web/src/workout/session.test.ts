// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #14's control loop, driven against the #44 simulator.
 *
 * ⚠️ **This file is the point of the whole slice.** `player.test.ts` proves the
 * player's decisions and `erg-writer.test.ts` proves the writer's queue; each
 * does so against the other's *absence*. Three of #14's criteria are about the
 * two agreeing, and no test inside either package can see that:
 *
 * - *"each interval's target is sent **and acknowledged** before the interval is
 *   treated as begun"* — a claim about a round trip;
 * - *"a trainer disconnect mid-workout pauses the workout and preserves the
 *   recording rather than losing the session"*;
 * - *"a completed ERG workout's recorded power matches the target profile within
 *   a stated tolerance"* — a claim about the machine's **own** power stream.
 *
 * The trainer here is the #44 simulator with its own state, its own control
 * permission rules and its own 1 Hz notification loop, reached through the same
 * octet bridge #43 and #90 use. Power is read from `transport.subscribe('power')`
 * — the stream the ride recorder consumes — so a loop that reported a target it
 * never applied fails here and could not fail against a fake.
 */

import {
  expandWorkout,
  revolutionsPerMinute,
  seconds,
  thresholdShare,
  watts,
  type CadenceReading,
  type Workout,
  type WorkoutBlock,
} from '@onyourleft/domain';
import { SensorError } from '@onyourleft/sensors';
import { ftmsTrainer, type SimulatedDeviceSpec } from '@onyourleft/sensors/simulator';
import { connectSimulatedTrainer } from '@onyourleft/sensors/protocol/testing';
import { describe, expect, it } from 'vitest';

import {
  CADENCE_HISTORY_SECONDS,
  createWorkoutSession,
  RELEASE_INCOMPLETE,
  type WorkoutSession,
} from './session';

/** Control point op codes, FTMS Table 4.15 — written out so a test reads the wire. */
const RESET = 0x01;
const SET_TARGET_POWER = 0x05;
const STOP_OR_PAUSE = 0x08;

const THRESHOLD = watts(250);

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

const workout = (blocks: readonly WorkoutBlock[]): Workout => ({ name: 'Test', blocks });

/**
 * Two intervals with different targets. Short, because the loop runs at 1 Hz
 * and every tick is a real round trip through the simulator's control point.
 */
const TWO_INTERVALS = () => expandWorkout(workout([steady(6, 0.6), steady(6, 1.0)]));

/**
 * The trainer #372 was measured on: an acknowledged Stop leaves its targets
 * applied. ⚠️ A double built to model one machine's behaviour. It proves
 * nothing about any real trainer; validation 0002 Parts R and S are that.
 */
const RETAINS_THROUGH_STOP = () => ftmsTrainer({ id: 'kickr', retainsTargetsThroughStop: true });

/**
 * The same machine with a Supported Power Range that starts above zero, so an
 * ease to "the floor" is a number a test can tell from 0 W and from a
 * hard-coded one (#441). Read back through `trainer.powerRange`, never typed.
 */
const FLOOR_WATTS = 25;
const MEASURED_TRAINER = () =>
  ftmsTrainer({
    id: 'kickr',
    retainsTargetsThroughStop: true,
    minTargetPower: watts(FLOOR_WATTS),
  });

/** A `0x05` Set Target Power write, as octets: op code, then sint16 little-endian. */
const targetWrite = (target: number): number[] => [SET_TARGET_POWER, target & 0xff, target >> 8];

async function loop(timelineFactory = TWO_INTERVALS, spec?: SimulatedDeviceSpec) {
  const trainer = await connectSimulatedTrainer(spec === undefined ? {} : { spec });
  await trainer.control.requestControl();
  const session = createWorkoutSession({
    timeline: timelineFactory(),
    thresholdPower: THRESHOLD,
    control: trainer.control,
    powerFloor: trainer.powerRange.minimum,
  });
  return { trainer, session };
}

/**
 * Run the workout second by second, letting every outstanding write settle
 * before the next tick.
 *
 * ⚠️ `settled()` between ticks is what makes this a *test* rather than a race.
 * The loop itself deliberately does not await a write inside a tick — the ride
 * does not stop for a slow machine — so a test that ticked without settling
 * would be asserting against whatever the microtask queue happened to do.
 */
async function ride(
  session: WorkoutSession,
  fromSecond: number,
  toSecond: number,
  cadenceAt?: (second: number) => CadenceReading | undefined,
): Promise<void> {
  for (let second = fromSecond; second <= toSecond; second += 1) {
    const reading = cadenceAt?.(second);
    if (reading !== undefined) {
      session.observeCadence(reading);
    }
    session.tick(seconds(second));
    await session.settled();
  }
}

/**
 * Let a release run out. It is not the writer's, so `settled()` does not wait
 * for it: a Stop queued behind the control's own promise chain lands a few
 * microtasks after the tick that asked for it.
 */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await Promise.resolve();
  }
}

describe('a target reaches the trainer and comes back acknowledged', () => {
  it('holds the first interval on the machine itself', async () => {
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 2);

    // Read from the simulator's own state, not from what the session believes.
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
    expect(session.state().holding).toBe(150);
  });

  it('does not treat the second interval as begun until the first is answered', async () => {
    // ⚠️ #14's criterion in its literal form. The machine is stalled, so the
    // write for interval one never completes — and the loop must not send
    // interval two's target on top of it.
    const { trainer, session } = await loop();
    session.start(seconds(0));

    trainer.stall();
    session.tick(seconds(0));
    for (let second = 1; second <= 8; second += 1) {
      session.tick(seconds(second));
    }
    await Promise.resolve();

    const writes = trainer.wire.filter((entry) => entry.direction === 'write');
    // One Request Control from the harness, one Set Target Power. Nine ticks
    // spanning both intervals produced exactly one setpoint.
    expect(writes.filter((entry) => entry.bytes[0] === 0x05)).toHaveLength(1);

    trainer.release();
    await session.settled();
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
  });

  it('moves to the second interval once the first has landed', async () => {
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 8);
    expect(trainer.targetPowerOnTheTrainer()).toBe(250);
  });
});

describe('a completed ERG workout holds the target profile', () => {
  it('matches the machine power stream to the plan within a tolerance', async () => {
    // The simulator reports `targetPower ?? rider.power`, so the power stream
    // follows the setpoint the same way a real ERG trainer's does. The
    // tolerance is not a fudge: it is the quantisation the machine declares
    // (a 1 W increment) plus the one second between a target being sent and
    // the notification that carries it.
    const TOLERANCE_WATTS = 1;
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 11);

    // Group the power stream by the plan's interval, discarding the first
    // reading of each — the one that may predate the setpoint reaching the
    // machine. What is asserted is the steady state, which is the claim.
    const readings = trainer.powers.map((measurement) => measurement.power as number);
    expect(readings.length).toBeGreaterThan(6);

    const settledReadings = readings.slice(2);
    for (const reading of settledReadings) {
      const nearest = [150, 250].reduce((best, target) =>
        Math.abs(reading - target) < Math.abs(reading - best) ? target : best,
      );
      expect(Math.abs(reading - nearest)).toBeLessThanOrEqual(TOLERANCE_WATTS);
    }

    // And both targets were actually visited, so the assertion above is not
    // satisfied by a workout that never left its first interval.
    expect(settledReadings).toContain(150);
    expect(settledReadings).toContain(250);
  });

  it('reaches the finish and lets the trainer go with one Stop — #372', async () => {
    // ⚠️ PR #442 first made this a Reset, and a reviewer who remembers
    // `[RESET]` here is reading the old file: on the owner's trainer a Reset
    // cleared nothing a Stop did not, and it revoked control. So the double
    // keeps its target through the Stop, as the measured machine does, and
    // what is asserted is what was SENT — not that anything let go. Not a
    // target of zero either: a machine holding 0 W is still holding.
    const { trainer, session } = await loop(TWO_INTERVALS, RETAINS_THROUGH_STOP());
    session.start(seconds(0));
    await ride(session, 0, 12);
    await flush();

    expect(session.state().player.status).toBe('finished');
    const writes = trainer.wire.filter((entry) => entry.direction === 'write');
    expect(writes.at(-1)?.bytes).toStrictEqual([STOP_OR_PAUSE, 0x01]);
    expect(writes.filter((entry) => entry.bytes[0] === RESET)).toHaveLength(0);
    expect(trainer.control.hasControl()).toBe(true);
    // The measured machine's behaviour, stated rather than hidden: it is still
    // holding the last interval.
    expect(trainer.targetPowerOnTheTrainer()).toBe(250);
    expect(session.state().lastFault).toBeUndefined();
  });
});

describe('a trainer disconnect pauses the workout and preserves it', () => {
  it('keeps the offset it had reached and writes nothing more', async () => {
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 3);
    const before = trainer.wire.length;

    session.linkLost(seconds(4));
    session.tick(seconds(300));
    await Promise.resolve();

    expect(session.state().player.status).toBe('paused');
    expect(session.state().player.elapsed).toBe(4);
    expect(trainer.wire).toHaveLength(before);
  });

  it('writes targets again once the trainer comes back', async () => {
    // ⚠️ The defect this test was written to find. `linkLost` used to close the
    // ERG writer, which is permanent — so a rider whose trainer dropped and
    // reconnected had a session that never wrote another target. #14 asks a
    // disconnect to *preserve* the session, and a workout that silently stops
    // controlling the trainer is the session lost with the clock still running.
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 1);

    session.linkLost(seconds(2));
    session.resume(seconds(2));
    await ride(session, 3, 8);

    expect(trainer.targetPowerOnTheTrainer()).toBe(250);
  });

  it('resumes where it stopped rather than where the clock is', async () => {
    const { session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 3);
    session.linkLost(seconds(4));

    session.resume(seconds(900));
    session.tick(seconds(902));
    await Promise.resolve();

    expect(session.state().player.status).toBe('running');
    expect(session.state().player.elapsed).toBe(6);
  });
});

describe('the trainer is eased whenever the rider is not riding to a target — #441', () => {
  // ⚠️ This block was "the trainer is let go", and every case asserted a Stop
  // and a machine that dropped its target on one. On the trainer #372 was
  // measured on, a Stop left the ERG target applied — so a pause, a free ride
  // and a stalled rider all went on being held at the last interval. The double
  // here keeps its target through a Stop, as that machine does, and has a floor
  // above zero so the ease is a number with a source.

  it('eases the trainer to its OWN floor when the workout is paused, with a 0x05 and no Stop', async () => {
    const { trainer, session } = await loop(TWO_INTERVALS, MEASURED_TRAINER());
    session.start(seconds(0));
    await ride(session, 0, 2);
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
    const before = trainer.wire.length;

    session.pause(seconds(3));
    await session.settled();

    const sent = trainer.wire.slice(before).filter((entry) => entry.direction === 'write');
    expect(trainer.powerRange.minimum).toBe(FLOOR_WATTS);
    expect(sent.map((entry) => [...entry.bytes])).toStrictEqual([targetWrite(FLOOR_WATTS)]);
    // Read from the device: the machine that ignored a Stop is holding the floor.
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);
  });

  it('keeps control through a pause and resumes to the target', async () => {
    const { trainer, session } = await loop(
      () => expandWorkout(workout([steady(600, 0.6)])),
      MEASURED_TRAINER(),
    );
    session.start(seconds(0));
    await ride(session, 0, 2);

    session.pause(seconds(3));
    await session.settled();
    session.resume(seconds(10));
    await ride(session, 10, 12);

    expect(trainer.control.hasControl()).toBe(true);
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
    expect(session.state().lastFault).toBeUndefined();
    expect(trainer.wire.some((entry) => entry.bytes[0] === RESET)).toBe(false);
  });

  it('stops again at the end of a workout that passed through a free ride', async () => {
    // ⚠️ The release bookkeeping has to be reset by a *write*, not only by the
    // first one. Without that, a free-ride block marks the trainer released and
    // the ERG block after it sets a target the finish then declines to let go.
    const { trainer, session } = await loop(() =>
      expandWorkout(workout([{ kind: 'free-ride', seconds: seconds(3) }, steady(3, 0.6)])),
    );
    session.start(seconds(0));
    await ride(session, 0, 7);
    await flush();

    expect(session.state().player.status).toBe('finished');
    const writes = trainer.wire.filter((entry) => entry.direction === 'write');
    expect(writes.at(-1)?.bytes).toStrictEqual([STOP_OR_PAUSE, 0x01]);
  });

  it('says so when the machine refuses the ease, and tries again on the next tick', async () => {
    // "A refusal is reported rather than assumed" (#441's third criterion).
    const { trainer } = await loop();
    const asked: number[] = [];
    let refuse = true;
    const session = createWorkoutSession({
      timeline: expandWorkout(workout([{ kind: 'free-ride', seconds: seconds(10) }])),
      thresholdPower: THRESHOLD,
      powerFloor: watts(FLOOR_WATTS),
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return refuse
            ? Promise.reject(new SensorError('control-rejected', 'the machine refused op code 0x5'))
            : Promise.resolve(target);
        },
        stop: () => trainer.control.stop(),
        letGo: () => trainer.control.letGo(),
      },
    });
    session.start(seconds(0));
    await ride(session, 0, 1);
    expect(session.state().lastFault).toContain('refused');
    refuse = false;
    await ride(session, 2, 4);

    // Refused twice while `refuse` held (ticks 0 and 1), then written once and
    // not again: the guard is re-armed only by a refusal.
    expect(asked).toStrictEqual([FLOOR_WATTS, FLOOR_WATTS, FLOOR_WATTS]);
  });
});

describe('ending the workout releases the trainer — #372', () => {
  it('releases at the end of a workout whose LAST block is a free ride', async () => {
    // ⚠️ The case the `released` guard used to swallow: the free ride eased
    // the trainer and marked it released, and the finish then declined to call
    // `letGo` at all — so a refusal of it could never be reported. #442 found
    // it and it survives the re-scope. Counted on the session's own trainer
    // rather than the wire, because it is the CALL that was missing.
    const { trainer } = await loop();
    const released: string[] = [];
    const session = createWorkoutSession({
      timeline: expandWorkout(
        workout([steady(3, 0.6), { kind: 'free-ride', seconds: seconds(3) }]),
      ),
      thresholdPower: THRESHOLD,
      powerFloor: trainer.powerRange.minimum,
      control: {
        setTargetPower: (target) => trainer.control.setTargetPower(target),
        stop: () => trainer.control.stop(),
        letGo: () => {
          released.push('letGo');
          return trainer.control.letGo();
        },
      },
    });
    session.start(seconds(0));
    await ride(session, 0, 7);
    await flush();

    expect(session.state().player.status).toBe('finished');
    expect(released).toStrictEqual(['letGo']);
  });

  it('releases with a Stop when the rider ends it early, and writes nothing after', async () => {
    const { trainer, session } = await loop(TWO_INTERVALS, RETAINS_THROUGH_STOP());
    session.start(seconds(0));
    await ride(session, 0, 2);
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
    const before = trainer.wire.length;

    session.stop();
    await session.settled();
    await flush();
    session.tick(seconds(5));
    await session.settled();

    const after = trainer.wire.slice(before).filter((entry) => entry.direction === 'write');
    expect(after.map((entry) => [...entry.bytes])).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
  });

  it('releases once however many times it is ended', async () => {
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 12);
    session.stop();
    session.stop();
    await session.settled();
    await flush();
    const writes = trainer.wire.filter((entry) => entry.direction === 'write');
    const lastTarget = writes.findLastIndex((entry) => entry.bytes[0] === SET_TARGET_POWER);
    expect(writes.slice(lastTarget + 1).map((entry) => [...entry.bytes])).toStrictEqual([
      [STOP_OR_PAUSE, 0x01],
    ]);
  });

  it('hands over to a replacement with a bare Stop, not the release, so control survives', async () => {
    // `supersede` is how the ride screen swaps one workout for another.
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 2);
    const before = trainer.wire.length;

    session.supersede();
    await session.settled();
    await flush();

    const after = trainer.wire.slice(before).filter((entry) => entry.direction === 'write');
    expect(after.map((entry) => [...entry.bytes])).toStrictEqual([[STOP_OR_PAUSE, 0x01]]);
    expect(trainer.control.hasControl()).toBe(true);
  });

  it('tells the rider when the trainer refused the release', async () => {
    const { trainer } = await loop();
    const session = createWorkoutSession({
      timeline: TWO_INTERVALS(),
      thresholdPower: THRESHOLD,
      powerFloor: trainer.powerRange.minimum,
      control: {
        setTargetPower: (target) => trainer.control.setTargetPower(target),
        stop: () => trainer.control.stop(),
        letGo: () =>
          Promise.resolve({
            kind: 'incomplete' as const,
            refusal: new SensorError('control-rejected', 'the machine refused op code 0x8'),
          }),
      },
    });
    session.start(seconds(0));
    await ride(session, 0, 2);

    session.stop();
    await flush();

    expect(session.state().lastFault).toBe(RELEASE_INCOMPLETE);
  });
});

describe('the cadence history is bounded', () => {
  it('keeps only the readings inside the retention window', async () => {
    const { session } = await loop(() => expandWorkout(workout([steady(300, 0.6)])));
    session.start(seconds(0));
    for (let second = 0; second <= 120; second += 1) {
      session.observeCadence({ at: seconds(second), cadence: revolutionsPerMinute(90) });
      session.tick(seconds(second));
      await session.settled();
    }
    // Two minutes of 1 Hz readings, and the session is holding thirty-one of
    // them — the retention window inclusive of both ends — not a hundred and
    // twenty-one. An hour-long workout would otherwise scan 3 600 readings
    // every tick to look at the last eight.
    expect(session.state().cadenceRetained).toBe(CADENCE_HISTORY_SECONDS + 1);
  });
});

describe('the ERG spiral is broken against a real control point', () => {
  it('eases the target on the machine when cadence collapses', async () => {
    const { trainer, session } = await loop(() => expandWorkout(workout([steady(30, 1.0)])));
    session.start(seconds(0));

    // A rider settling in, then losing the fight. The readings are the shape
    // #44's rider produces when a target is beyond them.
    const collapse = new Map<number, number>([
      [0, 92],
      [1, 90],
      [2, 88],
      [3, 80],
      [4, 72],
      [5, 64],
      [6, 56],
      [7, 50],
      [8, 46],
    ]);
    await ride(session, 0, 8, (second) => {
      const rpm = collapse.get(second);
      return rpm === undefined
        ? undefined
        : { at: seconds(second), cadence: revolutionsPerMinute(rpm) };
    });

    const held = trainer.targetPowerOnTheTrainer();
    expect(held).toBeDefined();
    // Two thirds of 250 W, quantised by the machine.
    expect(held).toBeLessThan(250);
    expect(held).toBeGreaterThan(150);
  });

  it('rescues a STALLED rider with a lower 0x05 target, and sends no Stop — #441', async () => {
    // ⚠️ The safety case. A rider ground to a halt in ERG used to be "released"
    // with a Stop, and on the trainer #372 was measured on a Stop left the
    // target applied — the rescue rescued nobody. What that trainer obeys is a
    // new target, so the rescue is the machine's own floor.
    const { trainer, session } = await loop(
      () => expandWorkout(workout([steady(60, 1.0)])),
      MEASURED_TRAINER(),
    );
    session.start(seconds(0));
    const stalling = new Map<number, number>([
      [0, 80],
      [1, 78],
      [2, 60],
      [3, 40],
      [4, 20],
      [5, 8],
      [6, 5],
      [7, 4],
    ]);
    await ride(session, 0, 7, (second) => {
      const rpm = stalling.get(second);
      return rpm === undefined
        ? undefined
        : { at: seconds(second), cadence: revolutionsPerMinute(rpm) };
    });
    await flush();

    const writes = trainer.wire.filter((entry) => entry.direction === 'write');
    expect(writes.at(-1)?.bytes).toStrictEqual(targetWrite(FLOOR_WATTS));
    expect(writes.some((entry) => entry.bytes[0] === STOP_OR_PAUSE)).toBe(false);
    // The number on the machine went DOWN — the only thing this suite can say.
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);
  });

  it('raises a relief target that would fall under the floor to the floor, rather than having it refused', async () => {
    // 20 % of 250 W is 50 W; two thirds of that is 33 W, below this machine's
    // 40 W minimum. Written as asked it would be refused out of range — an ease
    // the machine rejects is no ease.
    const { trainer, session } = await loop(
      () => expandWorkout(workout([steady(60, 0.2)])),
      ftmsTrainer({ id: 'kickr', retainsTargetsThroughStop: true, minTargetPower: watts(40) }),
    );
    session.start(seconds(0));
    await ride(session, 0, 8, (second) => ({
      at: seconds(second),
      cadence: revolutionsPerMinute(Math.max(20, 80 - second * 8)),
    }));

    expect(trainer.targetPowerOnTheTrainer()).toBe(40);
    expect(session.state().lastFault).toBeUndefined();
  });

  it('holds the full target for a rider grinding at 60 rpm on purpose', async () => {
    const { trainer, session } = await loop(() => expandWorkout(workout([steady(30, 1.0)])));
    session.start(seconds(0));
    await ride(session, 0, 8, (second) => ({
      at: seconds(second),
      cadence: revolutionsPerMinute(62 - second * 0.2),
    }));
    expect(trainer.targetPowerOnTheTrainer()).toBe(250);
  });
});

describe('a refused write is reported and retried, not thrown', () => {
  it('tells the rider control was lost, and takes it back on the next tick', async () => {
    // Control permission is revoked by the machine. The next setpoint is
    // refused, which the loop turns into a fault a screen can show — and the
    // workout carries on rather than ending.
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 1);

    trainer.handle().script({ kind: 'control-permission-lost' });
    await ride(session, 2, 3);

    expect(session.state().lastFault).toContain('trainer');
    expect(session.state().player.status).toBe('running');
  });
});

describe('a free ride eases the trainer once, not every second', () => {
  it('writes the floor once for the whole block, and no Stop — #441', async () => {
    const { trainer, session } = await loop(
      () => expandWorkout(workout([{ kind: 'free-ride', seconds: seconds(8) }])),
      MEASURED_TRAINER(),
    );
    session.start(seconds(0));
    await ride(session, 0, 6);

    const writes = trainer.wire.filter((entry) => entry.direction === 'write');
    // ⚠️ Seven ticks, one ease. Without the `released` guard this is seven
    // writes, each of which occupies a control point that runs one procedure
    // at a time. It is exactly one rather than zero because `released` starts
    // false: the session does not assume the trainer was left holding nothing.
    expect(writes.filter((entry) => entry.bytes[0] === SET_TARGET_POWER)).toHaveLength(1);
    expect(writes.some((entry) => entry.bytes[0] === STOP_OR_PAUSE)).toBe(false);
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);
  });
});

describe('what the trainer is never asked to do', () => {
  it('sends no Reset for the whole of a workout, the end included', async () => {
    // ⚠️ FTMS §4.16.2.1: a client-initiated Reset revokes the client's own
    // control permission. `ErgSink` and `WorkoutTrainer` both narrow it away,
    // so this is a belt-and-braces assertion over the actual octets. ⚠️ PR #442
    // first made the END of a workout a Reset and rewrote this test to allow
    // one; the re-scope put it back, because on the measured trainer the Reset
    // cleared nothing and cost the rider their control.
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 12);
    await flush();
    expect(
      trainer.wire.filter((entry) => entry.direction === 'write' && entry.bytes[0] === RESET),
    ).toHaveLength(0);
  });
});
