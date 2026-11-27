// SPDX-License-Identifier: Apache-2.0

/**
 * #3301: the no-drop rule on the real physics. Whole scripted rides
 * (`group-ride-testing.ts`) through `@onyourleft/domain` §`stepGroupRide` on
 * `groupRidePhysics`, one `describe` for each criterion of the issue. The
 * rule's own table is `packages/domain/src/group-ride/no-drop.test.ts`.
 *
 * **Behind the line** is read here off the odometers, not off the rule's own
 * answer: the gap from the rider to the last bot of the line ahead of them,
 * the sweep not counted while it is back with the rider.
 *
 * No case sets its own timeout (#1688): each ride is ridden once, in a hook.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  BOT_TACTIC_WHEEL_FURTHEST_METRES,
  BOT_TACTIC_WHEEL_NEAREST_METRES,
  gradeAt,
  NO_DROP_REACH_METRES,
  NO_DROP_SETTLE_MS,
  type GroupLedger,
  type MemberView,
} from '@onyourleft/domain';
import { courseOf, FLAT_COURSE, HILLY_COURSE } from '@onyourleft/domain/group-ride-testing';

import { DRAFT_REACH_METRES, fieldDraftFactors } from './draft';
import { groupRidePhysics } from './group-ride';
import {
  bot,
  rideGroup,
  RIDER,
  RIDER_MASS_KILOGRAMS,
  SIX,
  TICK_SECONDS,
  windowsOf,
  YOU,
  type Frame,
  type GroupRide,
} from './group-ride-testing';

const FLAT = courseOf(FLAT_COURSE);
const HILLY = courseOf(HILLY_COURSE);
/** 3 km with a 300 m rise at 5 %: short enough for a rider at a quarter of the group's power to finish. */
const RISE = courseOf([
  [1_500, 0],
  [300, 5],
  [1_200, 0],
]);
const TARGET_KMH = 30;
/** Five bots and the rider last: the usual place to lose a wheel. */
const RIDER_LAST = [bot('b1'), bot('b2'), bot('b3'), bot('b4'), bot('b5'), RIDER];

const at = (frame: Frame, id: string): MemberView => frame.at[id] as MemberView;
const hold = (frame: Frame) => frame.tick.state.noDrop.hold;
const sweepOf = (frame: Frame) => frame.tick.state.noDrop.sweep;
const standing = (frame: Frame) => frame.tick.state.noDrop.standing;

/** The bots of the line ahead of the rider's seat, front first; the whole line for a rider aside. */
function aheadOf(frame: Frame): readonly string[] {
  const seat = frame.order.indexOf(YOU);
  return seat < 0 ? frame.order : frame.order.slice(0, seat);
}

/** How far the rider is behind the line, metres: see the file comment. Under zero, ahead of it. */
function behindLine(frame: Frame): number {
  const ahead = aheadOf(frame);
  const line = ahead.length > 1 ? ahead.filter((id) => id !== sweepOf(frame)) : ahead;
  const tail = line[line.length - 1];
  return tail === undefined ? 0 : at(frame, tail).distanceM - at(frame, YOU).distanceM;
}

/** The longest unbroken time the rider is beyond the draft's reach behind the line, seconds. */
function longestBeyondReach(frames: readonly Frame[]): number {
  let longest = 0;
  let run = 0;
  for (const frame of frames) {
    run = behindLine(frame) > DRAFT_REACH_METRES ? run + TICK_SECONDS : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** The front of the line as `frames[index]` began: the order the tick before it left. */
function frontAt(frames: readonly Frame[], index: number): string {
  const before = frames[index - 1];
  return (before === undefined ? SIX[0]?.id : before.order[0]) as string;
}

/** A ride ridden once, in a hook, and read by the cases of its `describe`. */
function ridden(script: () => GroupRide): () => GroupRide {
  let ride: GroupRide | undefined;
  beforeAll(() => {
    ride = script();
  });
  return () => {
    if (ride === undefined) throw new Error('the ride is ridden in beforeAll');
    return ride;
  };
}

/** A rider at a quarter of the group's power over the rise, start to finish: read by two criteria. */
const quarter = ridden(() =>
  rideGroup({ course: RISE, targetKmh: TARGET_KMH, rider: { share: 0.25 } }),
);

it("measures the reach the draft model's own", () => {
  expect(NO_DROP_REACH_METRES).toBe(DRAFT_REACH_METRES);
});

describe('a rider at 60 % of the group’s power, over the hilly fixture (criterion 1)', () => {
  /** The stated recovery time, seconds: the longest the rider is ever beyond the reach. */
  const RECOVERY_SECONDS = 40;
  const ride = ridden(() =>
    rideGroup({ course: HILLY, targetKmh: TARGET_KMH, rider: { share: 0.6 } }),
  );

  it('is never beyond the draft reach behind the line for longer than the recovery time, start to finish', () => {
    expect(ride().finishSeconds).not.toBeNull();
    expect(longestBeyondReach(ride().frames)).toBeLessThanOrEqual(RECOVERY_SECONDS);
    // And they were dropped: the line waited, more than once.
    const waits = ride().frames.filter(
      (frame, index, frames) =>
        hold(frame) === 'waiting' && hold(frames[index - 1] as Frame) === null,
    );
    expect(waits.length).toBeGreaterThan(3);
  });

  it('has the group ride under four fifths of the plan’s speed for them on the climb: the pacer’s floor is not the group’s', () => {
    // The climb is 3 000 to 4 500 m at 8 %, where the rider's speed is 60 % of the group's.
    const climbing = windowsOf(ride().frames).filter(
      (frame) =>
        hold(frame) !== null &&
        at(frame, frame.order[0] as string).distanceM > 3_100 &&
        at(frame, frame.order[0] as string).distanceM < 4_400,
    );
    expect(climbing.length).toBeGreaterThan(60);
    const slowest = Math.min(
      ...climbing.map((frame) => {
        const front = at(frame, frame.order[0] as string);
        return front.speedMps / ride().plan.speedNowAt(front.distanceM);
      }),
    );
    expect(slowest).toBeLessThan(0.5);
  });
});

describe('a rider at 25 % of the group’s power is still with the group at the finish (criterion 2)', () => {
  const ride = quarter;

  it('finishes with the rider inside the reach, or with the line holding for them', () => {
    const { frames, finishSeconds } = ride();
    expect(finishSeconds).not.toBeNull();
    const last = frames[frames.length - 1] as Frame;
    expect(behindLine(last) <= DRAFT_REACH_METRES || hold(last) !== null).toBe(true);
    // Never left: three reaches is the furthest they are ever behind, and never for long.
    expect(Math.max(...frames.map(behindLine))).toBeLessThan(3 * DRAFT_REACH_METRES);
    expect(longestBeyondReach(frames)).toBeLessThanOrEqual(75);
  });

  it('has a group whose speed fell to the rider’s: the two covered the same road in the same time', () => {
    const { frames } = ride();
    const first = frames[0] as Frame;
    const last = frames[frames.length - 1] as Frame;
    const riderRode = at(last, YOU).distanceM - at(first, YOU).distanceM;
    const lineRode = at(last, 'b3').distanceM - at(first, 'b3').distanceM;
    expect(lineRode / riderRode).toBeGreaterThan(0.97);
    expect(lineRode / riderRode).toBeLessThan(1.03);
    // Half the plan's average or less: far under any 20 % limit.
    const seconds = frames.length * TICK_SECONDS;
    expect(lineRode / seconds).toBeLessThan(0.55 * (TARGET_KMH / 3.6));
  });

  it('has no lower limit: on the rise the whole line stands still while the rider comes up', () => {
    const stopped = windowsOf(ride().frames).filter(
      (frame) =>
        hold(frame) !== null &&
        frame.groupSpeedMps === 0 &&
        aheadOf(frame).every((id) => id === sweepOf(frame) || at(frame, id).speedMps === 0),
    );
    expect(stopped.length).toBeGreaterThan(20);
    for (const frame of stopped) expect(at(frame, YOU).speedMps).toBeGreaterThan(0.5);
  });
});

describe('a rider who stops for five minutes (criterion 3)', () => {
  const STOP_FROM = 60;
  const STOP_TO = 360;
  const ride = ridden(() =>
    rideGroup({
      course: FLAT,
      targetKmh: TARGET_KMH,
      seconds: 420,
      rider: { stop: { fromSeconds: STOP_FROM, toSeconds: STOP_TO } },
    }),
  );
  const bots = ['b1', 'b2', 'b3', 'b4', 'b5'];

  it('has the line wait from the window they stop in, and all through the stop', () => {
    const during = ride().frames.filter(
      (frame) => frame.atMs >= (STOP_FROM + 1) * 1_000 && frame.atMs < STOP_TO * 1_000,
    );
    expect(during.length).toBeGreaterThan(1_000);
    for (const frame of during) expect(frame.phase).toBe('waiting');
  });

  it('never has a bot beyond the reach of a rider who is at rest, and does not roll on', () => {
    const atRest = ride().frames.filter(
      (frame) =>
        frame.atMs < STOP_TO * 1_000 &&
        frame.atMs > STOP_FROM * 1_000 &&
        at(frame, YOU).speedMps === 0,
    );
    // They roll to rest through the physics, and are at rest for most of the five minutes.
    expect(atRest.length * TICK_SECONDS).toBeGreaterThan(120);
    for (const frame of atRest) {
      for (const id of bots) {
        expect(Math.abs(at(frame, id).distanceM - at(frame, YOU).distanceM)).toBeLessThanOrEqual(
          DRAFT_REACH_METRES,
        );
      }
    }
    const first = atRest[0] as Frame;
    const last = atRest[atRest.length - 1] as Frame;
    for (const id of bots) {
      expect(at(last, id).distanceM - at(first, id).distanceM).toBeLessThan(DRAFT_REACH_METRES);
    }
  });

  it('finds the group stopped within the reach when they start again, and rides on with it', () => {
    const { frames } = ride();
    const restart = frames.find((frame) => frame.atMs === STOP_TO * 1_000) as Frame;
    for (const id of bots) {
      expect(at(restart, id).speedMps).toBe(0);
      expect(Math.abs(at(restart, id).distanceM - at(restart, YOU).distanceM)).toBeLessThanOrEqual(
        DRAFT_REACH_METRES,
      );
    }
    const last = frames[frames.length - 1] as Frame;
    expect(hold(last)).toBeNull();
    expect(at(last, YOU).speedMps).toBeGreaterThan(0.95 * last.groupSpeedMps);
    expect(Math.abs(behindLine(last))).toBeLessThan(BOT_TACTIC_WHEEL_FURTHEST_METRES);
  });
});

describe('a gapped rider is given a wheel, and the rest of the line rides on (criterion 4)', () => {
  /** The stated time, seconds: from the rider gapping to the sweep sitting in the wheel band ahead of them. */
  const SWEEP_SECONDS = 25;
  // At the back of the line, 2 km/h under their speed from 5 s: off the wheel, and slowly out toward the reach.
  const ride = ridden(() =>
    rideGroup({
      course: FLAT,
      targetKmh: TARGET_KMH,
      line: RIDER_LAST,
      seconds: 60,
      rider: { slow: { fromSeconds: 5, toSeconds: 60, kmh: 2 } },
    }),
  );
  const gapped = (): readonly Frame[] =>
    ride().frames.filter((frame) => standing(frame) === 'gapped');

  it('makes exactly one bot the sweep, the last bot, while the rider is gapped and never otherwise', () => {
    expect(gapped().length * TICK_SECONDS).toBeGreaterThan(15);
    for (const frame of ride().frames) {
      expect(sweepOf(frame)).toBe(standing(frame) === 'with' ? null : 'b5');
      // The last bot of the line ahead of them, whoever is on the front by then.
      if (sweepOf(frame) !== null) expect(aheadOf(frame)[aheadOf(frame).length - 1]).toBe('b5');
    }
    expect(gapped().every((frame) => frame.roles[YOU] === 'gapped')).toBe(true);
  });

  it('has the sweep inside the wheel band ahead of the rider within the stated time, and keeps it there', () => {
    const from = (gapped()[0] as Frame).atMs;
    const settled = gapped().filter((frame) => frame.atMs >= from + SWEEP_SECONDS * 1_000);
    expect(settled.length).toBeGreaterThan(40);
    for (const frame of settled) {
      const gap = at(frame, 'b5').distanceM - at(frame, YOU).distanceM;
      expect(gap).toBeGreaterThanOrEqual(BOT_TACTIC_WHEEL_NEAREST_METRES);
      expect(gap).toBeLessThanOrEqual(BOT_TACTIC_WHEEL_FURTHEST_METRES);
    }
    // It dropped back to them: before that it was on b4's wheel, more than the gap away.
    expect(
      at(gapped()[0] as Frame, 'b5').distanceM - at(gapped()[0] as Frame, YOU).distanceM,
    ).toBeGreaterThan(5);
  });

  it('does not ease the rest of the line: the plan’s speed, the plan’s power on the front, every wheel held', () => {
    const { frames, plan } = ride();
    let ledger: GroupLedger = { ridingSeconds: 0 };
    let checked = 0;
    frames.forEach((frame, index) => {
      if (standing(frame) === 'gapped') {
        expect(hold(frame)).toBeNull();
        const front = frontAt(frames, index);
        expect(frame.groupSpeedMps).toBe(plan.speedNowAt(at(frame, front).distanceM));
        if (front === frame.order[0] && frame.aside === null) {
          expect(frame.rode[front]?.powerWatts).toBe(
            plan.powerAt(at(frame, front).distanceM, ledger),
          );
          checked += 1;
        }
        for (const id of ['b2', 'b3', 'b4']) {
          const seat = frame.order.indexOf(id);
          if (seat < 1) continue;
          const gap =
            at(frame, frame.order[seat - 1] as string).distanceM - at(frame, id).distanceM;
          expect(gap).toBeLessThanOrEqual(BOT_TACTIC_WHEEL_FURTHEST_METRES);
        }
      }
      ledger = frame.tick.state.ledger;
    });
    expect(checked).toBeGreaterThan(20);
  });
});

describe('over the crest with the rider 15 s behind, the line regroups and settles (criterion 5)', () => {
  // The fixture's climb tops out at 4 500 m. The line forms up with its front
  // just over the top and the rider 15 s back down the climb at the group's
  // speed, riding to get back on: the scripted rider who holds a wheel.
  const FROM_M = 4_496;
  const ride = ridden(() => {
    const climbing = groupRidePhysics().frontSpeed(200, 8);
    return rideGroup({
      course: HILLY,
      targetKmh: TARGET_KMH,
      line: RIDER_LAST,
      fromM: FROM_M,
      seconds: 120,
      rider: { start: { distanceM: FROM_M - 15 * climbing, speedMps: climbing } },
    });
  });
  const windows = (): readonly Frame[] => windowsOf(ride().frames);
  /** The first window with the rider inside the reach. */
  const inside = (): number =>
    windows().findIndex((frame) => behindLine(frame) <= DRAFT_REACH_METRES);

  it('is regrouping from the first window: the front over the top, the rider 15 s behind and beyond the reach', () => {
    const first = windows()[0] as Frame;
    expect(at(first, 'b1').distanceM).toBeGreaterThan(4_496);
    expect(at(first, 'b1').distanceM).toBeLessThan(4_500);
    expect(behindLine(first) / at(first, YOU).speedMps).toBeGreaterThan(14.5);
    expect(behindLine(first)).toBeGreaterThan(DRAFT_REACH_METRES);
    expect(first.phase).toBe('regrouping');
    expect(first.roles[YOU]).toBe('off-the-back');
  });

  it('stays regrouping until the rider is inside the reach, then eased for the settle time, then steady', () => {
    expect(inside()).toBeGreaterThan(5);
    const settle = NO_DROP_SETTLE_MS / 1_000;
    windows()
      .slice(0, inside() + settle)
      .forEach((frame) => {
        expect(frame.phase).toBe('regrouping');
        // Eased: far under the plan's speed on that road, and under the rider's own.
        const planned: number = ride().plan.speedNowAt(at(frame, 'b1').distanceM);
        expect(frame.groupSpeedMps).toBeLessThan(0.8 * planned);
        expect(frame.groupSpeedMps).toBeLessThan(at(frame, YOU).speedMps);
      });
    const after = windows()[inside() + settle] as Frame;
    expect(after.phase).toBe('steady');
    expect(hold(after)).toBeNull();
    expect(after.groupSpeedMps).toBe(ride().plan.speedNowAt(at(after, 'b1').distanceM));
  });
});

describe('a rider who rides off the front is not chased (criterion 6)', () => {
  const ride = ridden(() =>
    rideGroup({ course: FLAT, targetKmh: TARGET_KMH, seconds: 60, rider: { watts: 420 } }),
  );
  const offFront = (): readonly { readonly frame: Frame; readonly index: number }[] =>
    ride()
      .frames.map((frame, index) => ({ frame, index }))
      .filter(({ frame }) => frame.roles[YOU] === 'off-the-front');

  it('names the rider off the front, and never holds the line for them', () => {
    expect(offFront().length * TICK_SECONDS).toBeGreaterThan(30);
    for (const { frame } of offFront()) {
      expect(at(frame, YOU).distanceM).toBeGreaterThan(
        at(frame, frame.order[0] as string).distanceM,
      );
      expect(hold(frame)).toBeNull();
      expect(sweepOf(frame)).toBeNull();
    }
  });

  it('rides the front at the plan’s power, to the watt, wherever the rider gives it no shelter, and never over it', () => {
    const { frames, plan } = ride();
    let exact = 0;
    let sheltered = 0;
    for (const { frame, index } of offFront()) {
      const front = frontAt(frames, index);
      if (front !== frame.order[0] || frame.aside !== null) continue;
      const ledger = (frames[index - 1] as Frame).tick.state.ledger;
      const planned: number = plan.powerAt(at(frame, front).distanceM, ledger);
      const rode = frame.rode[front]?.powerWatts as number;
      if (at(frame, YOU).distanceM - at(frame, front).distanceM > DRAFT_REACH_METRES) {
        expect(rode).toBe(planned);
        exact += 1;
      } else {
        expect(rode).toBeLessThanOrEqual(planned);
        sheltered += 1;
      }
    }
    expect(exact).toBeGreaterThan(40);
    expect(sheltered).toBeGreaterThan(4);
  });

  it('sends no bot up the road after them: the line closes up on its own wheels at the group’s speed', () => {
    const { frames } = ride();
    const last = frames[frames.length - 1] as Frame;
    expect(at(last, YOU).distanceM - at(last, last.order[0] as string).distanceM).toBeGreaterThan(
      60,
    );
    const late = offFront().filter(({ frame }) => frame.atMs >= 30_000);
    expect(late.length).toBeGreaterThan(60);
    for (const { frame } of late) {
      const line = frame.order.filter((id) => id !== YOU);
      for (const id of line) {
        expect(at(frame, id).speedMps).toBeLessThan(frame.groupSpeedMps + 0.5);
      }
      line.slice(1).forEach((id, seat) => {
        const gap = at(frame, line[seat] as string).distanceM - at(frame, id).distanceM;
        expect(gap).toBeLessThanOrEqual(BOT_TACTIC_WHEEL_FURTHEST_METRES);
      });
    }
  });
});

describe('the rider’s simulated speed is unchanged by the rule (criterion 7)', () => {
  const WATTS = 150;
  const script = {
    course: FLAT,
    targetKmh: TARGET_KMH,
    line: RIDER_LAST,
    seconds: 120,
    rider: { watts: WATTS, start: { distanceM: -150, speedMps: 6 } },
  };
  const on = ridden(() => rideGroup(script));
  const off = ridden(() => rideGroup({ ...script, noDrop: false }));
  const own = groupRidePhysics(RIDER_MASS_KILOGRAMS);
  const speeds = (ride: GroupRide): readonly number[] =>
    ride.frames.map((frame) => at(frame, YOU).speedMps);

  it('gives identical speed samples with the rule on and off wherever the rider is beyond the reach', () => {
    // With the rule off the group rides away and the rider is alone for the whole ride.
    expect(off().frames.every((frame) => frame.draft[YOU] === 1)).toBe(true);
    // With it on the group comes back for them: until it is inside the reach, the same samples to the bit.
    const reached = on().frames.findIndex((frame) => (frame.draft[YOU] as number) < 1);
    expect(reached).toBeGreaterThan(40);
    expect(reached).toBeLessThan(on().frames.length - 100);
    expect(speeds(on()).slice(0, reached + 1)).toEqual(speeds(off()).slice(0, reached + 1));
    // And the rule did act in that time: the two groups are in different places.
    const frame = on().frames[reached] as Frame;
    expect(at(frame, 'b5').distanceM).toBeLessThan(
      at(off().frames[reached] as Frame, 'b5').distanceM - 20,
    );
    expect(on().frames.some((each) => hold(each) === 'waiting')).toBe(true);
  });

  it('differs elsewhere only through the draft factor: their own power, mass and grade at the factor handed back', () => {
    for (const ride of [on(), off()]) {
      let rider = at(ride.frames[0] as Frame, YOU);
      const alone = ride.frames.map((frame) => {
        const speed = rider.speedMps;
        rider = own.advance(
          rider,
          WATTS,
          gradeAt(FLAT, rider.distanceM),
          TICK_SECONDS,
          frame.draft[YOU] as number,
        );
        return speed;
      });
      expect(speeds(ride)).toEqual(alone);
    }
    expect(speeds(on())).not.toEqual(speeds(off()));
  });

  it('hands the rider the draft model’s own factor for the odometers, held or not', () => {
    const ids = RIDER_LAST.map((member) => member.id);
    let held = 0;
    for (const frame of on().frames) {
      const factors = fieldDraftFactors(ids.map((id) => at(frame, id).distanceM));
      expect(frame.draft[YOU]).toBe(factors[ids.indexOf(YOU)]);
      if (hold(frame) !== null || sweepOf(frame) !== null) held += 1;
    }
    expect(held).toBeGreaterThan(100);
  });
});

describe('time spent waiting or regrouping is not chased back (criterion 8)', () => {
  const ride = quarter;

  /** Each unbroken run of held ticks: its first index and the first index after it. */
  function holds(frames: readonly Frame[]): readonly (readonly [from: number, to: number])[] {
    const runs: [number, number][] = [];
    frames.forEach((frame, index) => {
      if (hold(frame) === null) return;
      const open = runs[runs.length - 1];
      if (open !== undefined && open[1] === index) open[1] = index + 1;
      else runs.push([index, index + 1]);
    });
    return runs;
  }

  it('books a hold as the plan’s own time for the road covered in it, however long it took', () => {
    const { frames, plan } = ride();
    const runs = holds(frames).filter(([, to]) => to < frames.length);
    expect(runs.length).toBeGreaterThan(5);
    let waited = 0;
    for (const [from, to] of runs) {
      // Booked by the end of the first tick after the hold, which is itself ridden and booked whole.
      const before = from === 0 ? 0 : (frames[from - 1] as Frame).tick.state.ledger.ridingSeconds;
      const after = (frames[to] as Frame).tick.state.ledger.ridingSeconds;
      const front = frontAt(frames, to);
      expect(frontAt(frames, from)).toBe(front);
      const planned =
        plan.plannedSecondsAt(at(frames[to] as Frame, front).distanceM) -
        plan.plannedSecondsAt(at(frames[from] as Frame, front).distanceM);
      expect(after - before).toBeCloseTo(planned + TICK_SECONDS, 6);
      waited += (to - from) * TICK_SECONDS - planned;
    }
    // Minutes of waiting, none of it in the ledger.
    expect(waited).toBeGreaterThan(200);
    expect(ride().state.ledger.ridingSeconds).toBeLessThan(frames.length * TICK_SECONDS - 200);
  });

  // One wait and no pull change (a tight bend holds every change), so b1 is
  // on the front before the wait and after it with nobody ahead to shelter it.
  const oneWait = ridden(() =>
    rideGroup({
      course: FLAT,
      targetKmh: TARGET_KMH,
      line: RIDER_LAST,
      seconds: 130,
      bendRadiusM: 20,
      rider: { slow: { fromSeconds: 5, toSeconds: 50, kmh: 8 } },
    }),
  );

  it('rides the plan’s un-chased power after a wait: what #3298’s plan asks of a group as late as it was before', () => {
    const { frames, plan } = oneWait();
    const runs = holds(frames);
    expect(runs.length).toBe(1);
    const [from, to] = runs[0] as readonly [number, number];
    expect((to - from) * TICK_SECONDS).toBeGreaterThan(30);
    expect(frames.every((frame) => frame.order[0] === 'b1' && frame.aside === null)).toBe(true);
    const lateBefore =
      (frames[from - 1] as Frame).tick.state.ledger.ridingSeconds -
      plan.plannedSecondsAt(at(frames[from] as Frame, 'b1').distanceM);
    // Every ridden tick after the hold but its first, which books the hold's last road.
    let late = lateBefore;
    for (let index = to + 1; index < frames.length; index += 1) {
      const frame = frames[index] as Frame;
      const lead = at(frame, 'b1').distanceM;
      // The ridden tick before this one: its own time, less the plan's for its road.
      late +=
        TICK_SECONDS -
        (plan.plannedSecondsAt(lead) -
          plan.plannedSecondsAt(at(frames[index - 1] as Frame, 'b1').distanceM));
      const unchased: number = plan.powerAt(lead, {
        ridingSeconds: plan.plannedSecondsAt(lead) + late,
      });
      expect(frame.rode.b1?.powerWatts).toBeCloseTo(unchased, 6);
      // Chased, it would be the plan's power for a group late by the whole wait as well.
      const chased: number = plan.powerAt(lead, {
        ridingSeconds: plan.plannedSecondsAt(lead) + late + (to - from) * TICK_SECONDS,
      });
      if (index === to + 1) expect(chased).toBeGreaterThan(unchased + 5);
    }
  });
});

describe('deterministic for a seed (criterion 9)', () => {
  const script = {
    course: RISE,
    targetKmh: TARGET_KMH,
    seconds: 120,
    seed: 11,
    rider: { share: 0.4 },
  };
  const rides = ridden(() => rideGroup(script));
  const again = ridden(() => rideGroup(script));

  it('rides the same ride twice from one seed, hold for hold and metre for metre', () => {
    expect(again().state).toEqual(rides().state);
    expect(again().frames.map((frame) => frame.tick.state.noDrop)).toEqual(
      rides().frames.map((frame) => frame.tick.state.noDrop),
    );
    expect(rides().frames.some((frame) => hold(frame) !== null)).toBe(true);
    expect(rides().frames.some((frame) => sweepOf(frame) !== null)).toBe(true);
  });
});
