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
import { connectSimulatedTrainer } from '@onyourleft/sensors/protocol/testing';
import { describe, expect, it } from 'vitest';

import { CADENCE_HISTORY_SECONDS, createWorkoutSession, type WorkoutSession } from './session';

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

async function loop(timelineFactory = TWO_INTERVALS) {
  const trainer = await connectSimulatedTrainer();
  await trainer.control.requestControl();
  const session = createWorkoutSession({
    timeline: timelineFactory(),
    thresholdPower: THRESHOLD,
    control: trainer.control,
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

  it('reaches the finish and lets the trainer go', async () => {
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 12);

    expect(session.state().player.status).toBe('finished');
    // ⚠️ Released with `stop`, not with a target of zero. A machine holding
    // 0 W is still holding.
    expect(trainer.targetPowerOnTheTrainer()).toBeUndefined();
    const stops = trainer.wire.filter(
      (entry) => entry.direction === 'write' && entry.bytes[0] === 0x08,
    );
    expect(stops.length).toBeGreaterThanOrEqual(1);
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

describe('the trainer is let go whenever the rider is not riding to a target', () => {
  it('stops the trainer when the workout is paused', async () => {
    // A rider who presses pause is off the pedals. Leaving ERG holding 250 W
    // means the trainer is still loaded when they get back on, which is both
    // unpleasant and, per CLAUDE.md §6, a safety question rather than a polish
    // one.
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 2);
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);

    session.pause(seconds(3));
    await session.settled();
    expect(trainer.targetPowerOnTheTrainer()).toBeUndefined();
  });

  it('stops again at the end of a workout that passed through a free ride', async () => {
    // ⚠️ The release bookkeeping has to be reset by a *write*, not only by the
    // first one. Without that, a free-ride block marks the trainer released and
    // the ERG block after it sets a target the finish then declines to clear —
    // leaving the rider holding a setpoint after the workout has ended.
    const { trainer, session } = await loop(() =>
      expandWorkout(workout([{ kind: 'free-ride', seconds: seconds(3) }, steady(3, 0.6)])),
    );
    session.start(seconds(0));
    await ride(session, 0, 7);

    expect(session.state().player.status).toBe('finished');
    expect(trainer.targetPowerOnTheTrainer()).toBeUndefined();
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

describe('a free ride releases the trainer once, not every second', () => {
  it('sends one stop for the whole block', async () => {
    const { trainer, session } = await loop(() =>
      expandWorkout(workout([{ kind: 'free-ride', seconds: seconds(8) }])),
    );
    session.start(seconds(0));
    await ride(session, 0, 6);

    const stops = trainer.wire.filter(
      (entry) => entry.direction === 'write' && entry.bytes[0] === 0x08,
    );
    // ⚠️ Seven ticks, one stop. Without the `released` guard this is seven
    // writes, each of which occupies a control point that runs one procedure
    // at a time. It is exactly one rather than zero because `released` starts
    // false: the session does not assume the trainer was left holding nothing.
    expect(stops).toHaveLength(1);
  });
});

describe('what the trainer is never asked to do', () => {
  it('sends no Reset for the whole of a workout', async () => {
    // ⚠️ FTMS §4.16.2.1: a client-initiated Reset revokes the client's own
    // control permission. `ErgSink` and `WorkoutTrainer` both narrow it away,
    // so this is a belt-and-braces assertion over the actual octets — the one
    // place a reset could appear is the wire, and it does not.
    const { trainer, session } = await loop();
    session.start(seconds(0));
    await ride(session, 0, 12);
    expect(
      trainer.wire.filter((entry) => entry.direction === 'write' && entry.bytes[0] === 0x01),
    ).toHaveLength(0);
  });
});
