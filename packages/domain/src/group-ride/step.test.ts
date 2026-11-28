// SPDX-License-Identifier: Apache-2.0

/**
 * #3300: `stepGroupRide`, a tick at a time, on a stand-in physics that records
 * what it is asked. This package cannot import `@onyourleft/physics`: the
 * issue's criteria are held on the real draft model and the real `advance` in
 * `packages/physics/src/group-ride.test.ts`. Here are the facts of one tick:
 * what is read, what each bot is asked to ride, and what is refused.
 */

import { describe, expect, it } from 'vitest';

import { BOT_TACTIC_WHEEL_GAP_METRES, botWheelWatts } from '../lap-race/tactics';
import type { BotCapacity } from '../lap-race/wbal';
import { metres, metresPerSecond, watts } from '../quantities';
import { GroupRideError } from './errors';
import { courseOf, FLAT_COURSE } from './fixtures/courses';
import { startNoDrop, type NoDropState } from './no-drop';
import type { GroupLedger, GroupPlan } from './plan';
import type { LineMember, MemberView } from './rotation';
import stepSource from './step.ts?raw';
import {
  startGroupRide,
  stepGroupRide,
  type GroupPhysics,
  type GroupRideState,
  type GroupRoad,
} from './step';

const CP = 300;
const MASS = 75;
const GROUP_MPS = 8;

function bot(id: string, cp = CP, floorWatts = 0): LineMember {
  const capacity: BotCapacity = {
    cpWatts: cp,
    wPrimeJoules: 20_000,
    peakWatts: 2 * cp,
    floorWatts,
  };
  return { id, kind: 'bot', capacity };
}

const RIDER: LineMember = { id: 'you', kind: 'rider' };
const LINE: readonly LineMember[] = [bot('b1'), bot('b2'), RIDER, bot('b3')];

/** A plan that says what it was asked: 150 W on the front, a watt more for each second the group is late. */
const PLAN: GroupPlan = {
  basePower: watts(150),
  distance: metres(10_000),
  targetSpeed: metresPerSecond(GROUP_MPS),
  plannedSecondsAt: (odometer) => odometer / GROUP_MPS,
  powerAt: (odometer: number, ledger: GroupLedger) =>
    watts(150 + (ledger.ridingSeconds - odometer / GROUP_MPS)),
  speedNowAt: () => metresPerSecond(GROUP_MPS),
};

interface Advanced {
  readonly from: MemberView;
  readonly powerWatts: number;
  readonly gradePercent: number;
  readonly seconds: number;
  readonly dragFactor: number;
}

/** A physics simple enough to work out by hand, that keeps every call. */
function standIn(): GroupPhysics & {
  readonly drafted: (readonly number[])[];
  readonly advanced: Advanced[];
} {
  const drafted: (readonly number[])[] = [];
  const advanced: Advanced[] = [];
  const drag = (speed: number, k: number): number => 0.2 * k * speed * speed;
  return {
    drafted,
    advanced,
    massKilograms: MASS,
    // 0.6 behind anybody within 30 m, 1 in the open.
    draftFactors(distances) {
      drafted.push([...distances]);
      return distances.map((own) =>
        distances.some((other) => other - own >= 0.05 && other - own <= 30) ? 0.6 : 1,
      );
    },
    // A climb costs 5 W for each percent and each m/s, so a test can tell one road from another.
    holdWatts: (speed, grade, k) => drag(speed, k) * speed + 5 * grade * speed,
    advance(from, powerWatts, gradePercent, seconds, dragFactor) {
      advanced.push({ from, powerWatts, gradePercent, seconds, dragFactor });
      const force = powerWatts / Math.max(from.speedMps, 1) - drag(from.speedMps, dragFactor);
      const speedMps = Math.max(0, from.speedMps + (force / MASS) * seconds);
      return { distanceM: from.distanceM + speedMps * seconds, speedMps };
    },
  };
}

const COURSE = courseOf(FLAT_COURSE);
const roadOn = (physics: GroupPhysics): GroupRoad => ({ course: COURSE, plan: PLAN, physics });
const RIDER_AT: MemberView = { distanceM: 100, speedMps: GROUP_MPS };
const start = (line: readonly LineMember[] = LINE, rider = RIDER_AT): GroupRideState =>
  startGroupRide({ line, seed: 3, atMs: 0, rider });

/** What holds 8 m/s in shelter on the stand-in: 0.2 × 0.6 × 8³. */
const HOLD_SHELTERED = 0.2 * 0.6 * GROUP_MPS * GROUP_MPS * GROUP_MPS;

describe('startGroupRide', () => {
  it("forms the bots up around the rider, a wheel gap apart, at the rider's speed, with a full reserve", () => {
    const state = start();
    expect(state.bots.b1?.distanceM).toBe(100 + 2 * BOT_TACTIC_WHEEL_GAP_METRES);
    expect(state.bots.b2?.distanceM).toBe(100 + BOT_TACTIC_WHEEL_GAP_METRES);
    expect(state.bots.b3?.distanceM).toBe(100 - BOT_TACTIC_WHEEL_GAP_METRES);
    for (const each of Object.values(state.bots)) {
      expect(each.speedMps).toBe(GROUP_MPS);
      expect(each.energy).toEqual({ wbalJoules: 20_000, exhausted: false });
      expect(each.powerWatts).toBeNull();
    }
    expect(Object.keys(state.bots)).toEqual(['b1', 'b2', 'b3']);
    expect(state.rotation.phase).toBe('forming');
    expect(state.ledger).toEqual({ ridingSeconds: 0 });
    expect(state.riderWas).toBeNull();
    expect(state.atMs).toBe(0);
  });

  it('refuses a line without a rider', () => {
    expect(() => start([bot('b1'), bot('b2')])).toThrowError(
      expect.objectContaining({ code: 'line-invalid' }) as GroupRideError,
    );
  });
});

describe('one tick', () => {
  it('makes one draft call over every member in line order, the rider included, and hands the factors back by id', () => {
    const physics = standIn();
    const state = start();
    const tick = stepGroupRide(state, { elapsedSeconds: 0.5, rider: RIDER_AT }, roadOn(physics));
    expect(physics.drafted).toEqual([
      [state.bots.b1?.distanceM, state.bots.b2?.distanceM, 100, state.bots.b3?.distanceM],
    ]);
    expect(tick.draft).toEqual({ b1: 1, b2: 0.6, you: 0.6, b3: 0.6 });
  });

  it('rides every bot through the physics at its own draft factor, for the tick', () => {
    const physics = standIn();
    const state = start();
    const tick = stepGroupRide(state, { elapsedSeconds: 0.5, rider: RIDER_AT }, roadOn(physics));
    expect(physics.advanced.map((call) => call.dragFactor)).toEqual([1, 0.6, 0.6]);
    expect(physics.advanced.map((call) => call.seconds)).toEqual([0.5, 0.5, 0.5]);
    expect(physics.advanced.map((call) => call.gradePercent)).toEqual([0, 0, 0]);
    expect(physics.advanced.map((call) => call.from)).toEqual(
      ['b1', 'b2', 'b3'].map((id) => ({
        distanceM: state.bots[id]?.distanceM,
        speedMps: GROUP_MPS,
      })),
    );
    // What comes back is what the physics answered, and what was ridden.
    physics.advanced.forEach((call, index) => {
      const id = ['b1', 'b2', 'b3'][index] as string;
      expect(tick.state.bots[id]?.powerWatts).toBe(call.powerWatts);
      expect(tick.state.bots[id]?.dragFactor).toBe(call.dragFactor);
      expect(tick.state.bots[id]?.distanceM).toBeGreaterThan(call.from.distanceM);
    });
  });

  it("rides each bot on the grade under that bot, and reads a wheel's surplus on the road under the wheel", () => {
    // Level to 120 m and 6 % beyond: b1 (130 m) climbs while b2 (104 m), the rider (100 m) and b3 (90 m) do not.
    // The rider is on b2's wheel (inside `NO_DROP_GAPPED_METRES`), so b2 is nobody's sweep.
    const hill = courseOf([
      [120, 0],
      [9_880, 6],
    ]);
    const physics = standIn();
    const form: GroupRideState = start();
    const at = (distanceM: number, id: string) => ({
      ...(form.bots[id] as NonNullable<typeof form.bots.b1>),
      distanceM,
    });
    const b1 = { ...at(130, 'b1'), powerWatts: physics.holdWatts(GROUP_MPS, 6, 1) + 30 };
    const state: GroupRideState = {
      ...form,
      bots: { b1, b2: at(104, 'b2'), b3: at(90, 'b3') },
    };
    const tick = stepGroupRide(
      state,
      { elapsedSeconds: 0.5, rider: RIDER_AT },
      { course: hill, plan: PLAN, physics },
    );
    const grades = physics.advanced.map((call) => call.gradePercent);
    expect(grades[0]).toBeCloseTo(6, 6);
    expect(grades[1]).toBeCloseTo(0, 6);
    expect(grades[2]).toBeCloseTo(0, 6);
    // b2 holds b1 at the gap: what holds b1's speed on b2's road, and the 30 W b1 is putting into speeding up on its own.
    const expected = botWheelWatts({
      gapMetres: 26,
      closingMetresPerSecond: 0,
      holdWatts: physics.holdWatts(GROUP_MPS, 0, 0.6) + 30,
      cpWatts: CP,
    });
    expect(tick.state.bots.b2?.powerWatts).toBeCloseTo(expected, 9);
  });

  it("rides the front at the plan's power at its odometer, with the ledger's correction", () => {
    const physics = standIn();
    const state = start();
    const frontAt = state.bots.b1?.distanceM as number;
    const onTime = stepGroupRide(state, { elapsedSeconds: 0.5, rider: RIDER_AT }, roadOn(physics));
    expect(onTime.state.bots.b1?.powerWatts).toBe(150 + (0 - frontAt / GROUP_MPS));
    const late = stepGroupRide(
      { ...state, ledger: { ridingSeconds: 40 } },
      { elapsedSeconds: 0.5, rider: RIDER_AT },
      roadOn(physics),
    );
    expect(late.state.bots.b1?.powerWatts).toBe(150 + (40 - frontAt / GROUP_MPS));
  });

  it('books the tick as riding time, moves the clock on, and reports the group speed the plan asks under the front', () => {
    const tick = stepGroupRide(
      start(),
      { elapsedSeconds: 0.5, rider: RIDER_AT },
      roadOn(standIn()),
    );
    expect(tick.state.ledger).toEqual({ ridingSeconds: 0.5 });
    expect(tick.state.atMs).toBe(500);
    expect(tick.groupSpeedMps).toBe(GROUP_MPS);
    expect(tick.rotation.state).toBe(tick.state.rotation);
    // #3305: and hands back what the rotation read, for the cue selector: the
    // line as the tick began, at the group's speed now.
    expect(tick.line.atMs).toBe(0);
    expect(tick.line.groupSpeedMps).toBe(GROUP_MPS);
    expect(tick.line.members.you).toEqual(RIDER_AT);
    expect(Object.keys(tick.line.members).sort()).toEqual(['b1', 'b2', 'b3', 'you']);
    expect(tick.line.climbAheadM).toBeNull();
    expect(tick.rotation.roles).toEqual({
      b1: 'on-front',
      b2: 'second-wheel',
      you: 'in-line',
      b3: 'last-wheel',
    });
  });

  it("holds a bot on a wheel by the lap race's wheel rule, on the member ahead of it in the line", () => {
    const physics = standIn();
    // b3's wheel is the rider: 0.2 m further up the road than the gap, and 0.02 m/s slower than b3.
    const rider: MemberView = { distanceM: 100.2, speedMps: GROUP_MPS - 0.02 };
    const tick = stepGroupRide(start(), { elapsedSeconds: 0.5, rider }, roadOn(physics));
    const expected = botWheelWatts({
      gapMetres: 100.2 - (100 - BOT_TACTIC_WHEEL_GAP_METRES),
      closingMetresPerSecond: GROUP_MPS - (GROUP_MPS - 0.02),
      holdWatts: physics.holdWatts(GROUP_MPS - 0.02, 0, 0.6),
      cpWatts: CP,
    });
    expect(expected).toBeGreaterThan(HOLD_SHELTERED);
    expect(tick.state.bots.b3?.powerWatts).toBeCloseTo(expected, 9);
    // b2's wheel is b1, exactly on the gap at its own speed: the feed-forward alone.
    expect(tick.state.bots.b2?.powerWatts).toBeCloseTo(HOLD_SHELTERED, 9);
  });

  it('never rides a bot over what its reserve pays for, and spends the reserve it rides on', () => {
    const state = start();
    const empty: GroupRideState = {
      ...state,
      bots: {
        ...state.bots,
        b1: {
          ...(state.bots.b1 as NonNullable<typeof state.bots.b1>),
          energy: { wbalJoules: 0, exhausted: true },
        },
      },
    };
    const weak: LineMember[] = [bot('b1', 100), bot('b2'), RIDER, bot('b3')];
    const withWeak: GroupRideState = {
      ...empty,
      rotation: { ...empty.rotation, line: weak },
    };
    const capped = stepGroupRide(
      withWeak,
      { elapsedSeconds: 1, rider: RIDER_AT },
      roadOn(standIn()),
    );
    expect(capped.state.bots.b1?.powerWatts).toBe(100);

    const fresh = startGroupRide({ line: weak, seed: 3, atMs: 0, rider: RIDER_AT });
    const spent = stepGroupRide(fresh, { elapsedSeconds: 1, rider: RIDER_AT }, roadOn(standIn()));
    const rode = spent.state.bots.b1?.powerWatts as number;
    expect(rode).toBeGreaterThan(100);
    expect(spent.state.bots.b1?.energy.wbalJoules).toBeCloseTo(20_000 - (rode - 100), 9);
  });
});

describe('the front, with somebody ahead of it on the road', () => {
  /** One tick with the rider `ahead` metres up the road from b1, the front, which rides at `frontSpeed`. */
  const tickWithRiderAhead = (frontSpeed: number, frontCp = CP) => {
    const physics = standIn();
    const state = start([bot('b1', frontCp), bot('b2'), RIDER, bot('b3')]);
    const b1 = { ...(state.bots.b1 as NonNullable<typeof state.bots.b1>), speedMps: frontSpeed };
    const rider: MemberView = { distanceM: b1.distanceM + 2, speedMps: GROUP_MPS };
    const tick = stepGroupRide(
      { ...state, bots: { ...state.bots, b1 } },
      { elapsedSeconds: 0.5, rider },
      roadOn(physics),
    );
    return { tick, call: physics.advanced[0] as Advanced };
  };

  it('rides no more than what holds the speed the rotation asks of it: it does not lift in the shelter', () => {
    const { tick, call } = tickWithRiderAhead(GROUP_MPS);
    expect(tick.draft.b1).toBe(0.6);
    expect(tick.rotation.demands.b1).toBe(GROUP_MPS);
    expect(call.powerWatts).toBeCloseTo(HOLD_SHELTERED, 9);
    expect(call.powerWatts).toBeLessThan(140);
    // A touch under it: what that speed costs, not its own, and 2 × CP for each m/s it is short.
    const under = tickWithRiderAhead(GROUP_MPS - 0.02).call;
    expect(under.powerWatts).toBeCloseTo(HOLD_SHELTERED + 2 * 0.02 * CP, 9);
  });

  it("still rides the plan's power where that is less", () => {
    // A strong bot half a metre a second under the speed it is asked: holding
    // it would take the rule's whole surge, 90 W over the feed-forward.
    const { call } = tickWithRiderAhead(GROUP_MPS - 0.5, 600);
    const planned = 150 - call.from.distanceM / GROUP_MPS;
    expect(HOLD_SHELTERED + 0.15 * 600).toBeGreaterThan(planned);
    expect(call.powerWatts).toBe(planned);
  });

  it('eases to nothing when it is over that speed, and does not sit up for it', () => {
    const { call } = tickWithRiderAhead(GROUP_MPS + 1);
    expect(call.powerWatts).toBe(0);
    expect(call.dragFactor).toBe(0.6);
  });
});

describe('the member aside', () => {
  /**
   * One tick inside a decision window, b1 aside in `role` and `ahead` metres
   * up the road from b3, the last wheel, riding the speed it was asked.
   */
  const tickAside = (role: 'drifting-back' | 'latching', ahead: number) => {
    const physics = standIn();
    const state = start();
    const asked = GROUP_MPS * 0.88;
    const b1 = {
      ...(state.bots.b1 as NonNullable<typeof state.bots.b1>),
      distanceM: (state.bots.b3?.distanceM as number) + ahead,
      speedMps: asked,
    };
    const tick = stepGroupRide(
      {
        ...state,
        bots: { ...state.bots, b1 },
        rotation: {
          ...state.rotation,
          phase: role === 'latching' ? 'latching' : 'changing',
          order: ['b2', 'you', 'b3'],
          aside: 'b1',
          nextWindowAtMs: 1_000,
          roles: { b1: role, b2: 'on-front', you: 'second-wheel', b3: 'last-wheel' },
          demands: { b1: asked, b2: GROUP_MPS, b3: GROUP_MPS },
        },
      },
      { elapsedSeconds: 0.5, rider: RIDER_AT },
      roadOn(physics),
    );
    expect(tick.rotation.roles.b1).toBe(role);
    return { asked, physics, call: physics.advanced[0] as Advanced };
  };

  it('drifting back a long way ahead of the last wheel, eases no more than the rotation asks', () => {
    // 8 m up the road the wheel rule would have it give up half its CP; the speed it is asked is held.
    const { asked, physics, call } = tickAside('drifting-back', 8);
    expect(call.dragFactor).toBe(1);
    expect(call.powerWatts).toBeCloseTo(physics.holdWatts(asked, 0, 1), 9);
  });

  it('drifting back close to the last wheel, comes onto it by the wheel rule: harder than its asked speed costs', () => {
    // Half a metre up the road from the last wheel, losing 0.96 m/s to it: the rule damps the approach.
    const { asked, physics, call } = tickAside('drifting-back', 0.5);
    expect(call.powerWatts).toBeGreaterThan(physics.holdWatts(asked, 0, 1) + 20);
  });

  it('latching, holds the last wheel by the wheel rule alone', () => {
    const { call } = tickAside('latching', 8);
    expect(call.powerWatts).toBe(0);
  });
});

describe("the wheel's surplus in the feed-forward", () => {
  it('adds what a bot ahead puts into speeding up, and nothing before its first tick', () => {
    const state = start();
    const withPower = (powerWatts: number | null): number => {
      const b1 = { ...(state.bots.b1 as NonNullable<typeof state.bots.b1>), powerWatts };
      const tick = stepGroupRide(
        { ...state, bots: { ...state.bots, b1 } },
        { elapsedSeconds: 0.5, rider: RIDER_AT },
        roadOn(standIn()),
      );
      return tick.state.bots.b2?.powerWatts as number;
    };
    // b1 rode at drag factor 1 before the first tick: 0.2 × 8³ holds its speed.
    const holding = 0.2 * GROUP_MPS * GROUP_MPS * GROUP_MPS;
    expect(withPower(null)).toBeCloseTo(HOLD_SHELTERED, 9);
    expect(withPower(holding)).toBeCloseTo(HOLD_SHELTERED, 9);
    expect(withPower(holding + 30)).toBeCloseTo(HOLD_SHELTERED + 30, 9);
    expect(withPower(holding - 30)).toBeCloseTo(HOLD_SHELTERED - 30, 9);
  });

  it("reads the rider's off their speed alone: what the change over the last tick is worth at a bot's mass", () => {
    const state = start();
    const behindTheRider = (riderWas: GroupRideState['riderWas']): number => {
      const tick = stepGroupRide(
        { ...state, riderWas },
        { elapsedSeconds: 0.5, rider: RIDER_AT },
        roadOn(standIn()),
      );
      return tick.state.bots.b3?.powerWatts as number;
    };
    expect(behindTheRider(null)).toBeCloseTo(HOLD_SHELTERED, 9);
    expect(behindTheRider({ speedMps: GROUP_MPS, elapsedSeconds: 0.5 })).toBeCloseTo(
      HOLD_SHELTERED,
      9,
    );
    // 0.1 m/s gained in half a second: 0.2 m/s² × 75 kg × 8 m/s = 120 W; held to the rule's surge over CP.
    expect(behindTheRider({ speedMps: GROUP_MPS - 0.01, elapsedSeconds: 0.5 })).toBeCloseTo(
      HOLD_SHELTERED + MASS * 0.02 * GROUP_MPS,
      9,
    );
    expect(behindTheRider({ speedMps: GROUP_MPS + 0.01, elapsedSeconds: 0.25 })).toBeCloseTo(
      HOLD_SHELTERED - MASS * 0.04 * GROUP_MPS,
      9,
    );
  });

  it("remembers the rider's speed and the tick's length for the next tick, and nothing else of them", () => {
    const rider: MemberView = Object.freeze({ distanceM: 100, speedMps: 7.5 });
    const tick = stepGroupRide(start(), { elapsedSeconds: 0.25, rider }, roadOn(standIn()));
    expect(tick.state.riderWas).toEqual({ speedMps: 7.5, elapsedSeconds: 0.25 });
    expect(Object.keys(tick.state.bots)).toEqual(['b1', 'b2', 'b3']);
    expect(rider).toEqual({ distanceM: 100, speedMps: 7.5 });
  });
});

describe('a bot asked for less than nothing', () => {
  /** One tick for b3, whose wheel is the rider, at these speeds, the rider at `riderAt` metres. */
  const tickWithRider = (riderSpeed: number, botSpeed = GROUP_MPS, riderAt = 100) => {
    const physics = standIn();
    const state = start();
    const b3 = { ...(state.bots.b3 as NonNullable<typeof state.bots.b3>), speedMps: botSpeed };
    const tick = stepGroupRide(
      { ...state, bots: { ...state.bots, b3 } },
      { elapsedSeconds: 0.5, rider: { distanceM: riderAt, speedMps: riderSpeed } },
      roadOn(physics),
    );
    return { tick, call: physics.advanced[2] as Advanced };
  };

  it('pedals nothing and sits up, by the share of the open air the missing watts are', () => {
    // Closing at 0.1 m/s: the rule asks 0.2 × CP under the feed-forward, 60 W under 61.4… less the rest.
    const { tick, call } = tickWithRider(GROUP_MPS - 0.1);
    const holdWatts = 0.2 * 0.6 * (GROUP_MPS - 0.1) ** 3;
    const wanted = holdWatts - 0.2 * CP;
    expect(wanted).toBeLessThan(0);
    const open = 0.2 * (1 - 0.6) * GROUP_MPS ** 3;
    expect(call.powerWatts).toBe(0);
    expect(call.dragFactor).toBeCloseTo(0.6 + 0.4 * (-wanted / open), 9);
    expect(tick.state.bots.b3?.dragFactor).toBe(call.dragFactor);
    expect(tick.draft.b3).toBe(0.6);
  });

  it("eases under its capacity floor on a wheel: the floor is a lap race bot's own, not a wheel's", () => {
    // A floor of 100 W is what a lap race plan gives a bot; a bot in the shelter of a wheel ahead may ride under it.
    const physics = standIn();
    const state = start([bot('b1'), bot('b2'), RIDER, bot('b3', CP, 100)]);
    const tick = stepGroupRide(
      state,
      { elapsedSeconds: 0.5, rider: { distanceM: 100, speedMps: GROUP_MPS - 2 } },
      roadOn(physics),
    );
    expect(tick.state.bots.b3?.powerWatts).toBe(0);
  });

  it('never takes more wind than the open air', () => {
    const { call } = tickWithRider(GROUP_MPS - 2);
    expect(call.powerWatts).toBe(0);
    expect(call.dragFactor).toBe(1);
  });

  it('keeps its draft factor at a standstill, where there is no wind to take', () => {
    // Its wheel is a metre behind where the gap is right: the rule asks for less than nothing.
    const { call, tick } = tickWithRider(0, 0, 99);
    expect(call.powerWatts).toBe(0);
    expect(call.dragFactor).toBe(0.6);
    expect(Number.isFinite(tick.state.bots.b3?.distanceM)).toBe(true);
  });

  it('rides at its draft factor whenever it pedals', () => {
    const { call } = tickWithRider(GROUP_MPS);
    expect(call.powerWatts).toBeGreaterThan(0);
    expect(call.dragFactor).toBe(0.6);
  });
});

describe('no-drop (#3301)', () => {
  /** The bots as `start()` forms them up: b1 101.3 m, b2 100.65 m, b3 99.35 m, all at 8 m/s. */
  const FRONT_M = 101.3;
  const tick = (
    rider: MemberView,
    state: GroupRideState = start(),
    more: Partial<GroupRoad> & { readonly riderStopped?: boolean } = {},
  ) => {
    const physics = standIn();
    const { riderStopped, ...road } = more;
    const answer = stepGroupRide(
      state,
      { elapsedSeconds: 0.5, rider, ...(riderStopped === undefined ? {} : { riderStopped }) },
      { ...roadOn(physics), ...road },
    );
    return { answer, physics };
  };
  const withBot = (state: GroupRideState, id: string, at: Partial<MemberView>): GroupRideState => ({
    ...state,
    bots: {
      ...state.bots,
      [id]: { ...(state.bots[id] as NonNullable<typeof state.bots.b1>), ...at },
    },
  });

  it('starts with the rule before its first window, and nothing held', () => {
    const state = start();
    expect(state.noDrop).toEqual(startNoDrop(0));
    expect(state.heldFromM).toBeNull();
  });

  it('rides the sweep to a wheel gap ahead of the rider at the rider’s speed, not on the wheel ahead of it', () => {
    // The rider 9.3 m off b1 with b2, their sweep, half a metre ahead of them at their 7 m/s.
    const sweeping: NoDropState = { ...startNoDrop(0), standing: 'gapped', sweep: 'b2' };
    const state = withBot({ ...start(), noDrop: sweeping }, 'b2', { distanceM: 92.5, speedMps: 7 });
    const { answer, physics } = tick({ distanceM: 92, speedMps: 7 }, state);
    expect(answer.state.noDrop).toMatchObject({ standing: 'gapped', sweep: 'b2', hold: null });
    expect(answer.rotation.roles.you).toBe('gapped');
    // The wheel rule on a place two wheel gaps up the road from the rider: 0.8 m ahead of b2.
    const expected = botWheelWatts({
      gapMetres: 92 + 2 * BOT_TACTIC_WHEEL_GAP_METRES - 92.5,
      closingMetresPerSecond: 0,
      holdWatts: physics.holdWatts(7, 0, 0.6),
      cpWatts: CP,
    });
    expect(answer.state.bots.b2?.powerWatts).toBeCloseTo(expected, 9);
    // On b1's wheel, 8.8 m and 1 m/s up the road, it would ride the rule's whole surge.
    expect(expected).toBeLessThan(physics.holdWatts(GROUP_MPS, 0, 0.6));
    // The rest of the line does not ease: the plan's speed, and the plan's power on the front.
    expect(answer.groupSpeedMps).toBe(GROUP_MPS);
    expect(answer.state.bots.b1?.powerWatts).toBe(150 - FRONT_M / GROUP_MPS);
    expect(answer.state.ledger).toEqual({ ridingSeconds: 0.5 });
  });

  it('reads the sweep the rider’s change of speed, as any bot on their wheel does', () => {
    const sweeping: NoDropState = { ...startNoDrop(0), standing: 'gapped', sweep: 'b2' };
    const state = withBot(
      { ...start(), noDrop: sweeping, riderWas: { speedMps: 6.9, elapsedSeconds: 0.5 } },
      'b2',
      { distanceM: 92.5, speedMps: 7 },
    );
    const { answer, physics } = tick({ distanceM: 92, speedMps: 7 }, state);
    const expected = botWheelWatts({
      gapMetres: 0.8,
      closingMetresPerSecond: 0,
      // 0.1 m/s gained in half a second, at a bot's mass and their 7 m/s.
      holdWatts: physics.holdWatts(7, 0, 0.6) + MASS * 0.2 * 7,
      cpWatts: CP,
    });
    expect(answer.state.bots.b2?.powerWatts).toBeCloseTo(expected, 9);
  });

  it('holds the line for a rider off the back: the eased speed is the group’s speed now, and what the bots are asked', () => {
    // 30.65 m behind b2 at 8 m/s: 3.83 s of the 10 s at which the ease is whole.
    const { answer } = tick({ distanceM: 70, speedMps: GROUP_MPS });
    const eased = GROUP_MPS * (1 - 30.65 / 80);
    expect(answer.state.rotation.phase).toBe('waiting');
    expect(answer.rotation.roles.you).toBe('off-the-back');
    expect(answer.groupSpeedMps).toBeCloseTo(eased, 9);
    expect(answer.rotation.demands.b1).toBe(answer.groupSpeedMps);
    expect(answer.state.noDrop).toMatchObject({ hold: 'waiting', sweep: 'b2' });
    // Over that speed, the front pedals nothing.
    expect(answer.state.bots.b1?.powerWatts).toBe(0);
  });

  it('rides the front of a held line at what holds the eased speed, and never over the plan’s power', () => {
    const eased = GROUP_MPS * (1 - 30.65 / 80);
    const rider = { distanceM: 70, speedMps: GROUP_MPS };
    // At the eased speed already: the feed-forward and no correction.
    const { answer, physics } = tick(rider, withBot(start(), 'b1', { speedMps: eased }));
    const held = physics.holdWatts(eased, 0, 1);
    expect(held).toBeLessThan(150 - FRONT_M / GROUP_MPS);
    expect(answer.state.bots.b1?.powerWatts).toBeCloseTo(held, 9);
    // A rider coming back at 16 m/s: the line is held at the plan's 8 m/s, no faster. A front
    // a long way under that would surge by the wheel rule: the plan's power is the most it rides.
    const slow = tick({ distanceM: 70, speedMps: 16 }, withBot(start(), 'b1', { speedMps: 1 }));
    expect(slow.answer.groupSpeedMps).toBe(GROUP_MPS);
    expect(physics.holdWatts(GROUP_MPS, 0, 1) + 0.15 * CP).toBeGreaterThan(
      150 - FRONT_M / GROUP_MPS,
    );
    expect(slow.answer.state.bots.b1?.powerWatts).toBe(150 - FRONT_M / GROUP_MPS);
  });

  it('waits for a rider who has stopped though they are on a wheel', () => {
    const riding = tick({ distanceM: 100, speedMps: 5 });
    expect(riding.answer.state.rotation.phase).toBe('steady');
    const stopped = tick({ distanceM: 100, speedMps: 5 }, start(), { riderStopped: true });
    expect(stopped.answer.state.rotation.phase).toBe('waiting');
    expect(stopped.answer.groupSpeedMps).toBeCloseTo(5 * (1 - 0.65 / 50), 9);
    expect(stopped.answer.rotation.roles.you).toBe('in-line');
  });

  it('books a held tick as paused, and the road covered in it at the plan’s own time', () => {
    const off = { distanceM: 70, speedMps: GROUP_MPS };
    const first = tick(off).answer;
    expect(first.state.ledger).toEqual({ ridingSeconds: 0 });
    expect(first.state.heldFromM).toBe(FRONT_M);
    // Half a second on, inside the window: still held. The first tick's road is booked now.
    const frontNow = first.state.bots.b1?.distanceM as number;
    const second = tick(off, first.state).answer;
    expect(second.state.ledger.ridingSeconds).toBeCloseTo((frontNow - FRONT_M) / GROUP_MPS, 12);
    expect(second.state.ledger.ridingSeconds).toBeLessThan(0.5);
    expect(second.state.heldFromM).toBe(frontNow);
  });

  it('rides the plan’s un-chased power after a wait: the group is as late as it was before it', () => {
    const off = { distanceM: 70, speedMps: GROUP_MPS };
    // Every bot at 2 m/s as the wait begins, so the second it waits is mostly lost.
    const slow = ['b1', 'b2', 'b3'].reduce(
      (state, id) => withBot(state, id, { speedMps: 2 }),
      start(),
    );
    const first = tick(off, slow).answer;
    const second = tick(off, first.state).answer;
    // The rider is back on b2's wheel at the next window: the line is released.
    const b2 = second.state.bots.b2 as NonNullable<typeof second.state.bots.b2>;
    const frontAfter = second.state.bots.b1?.distanceM as number;
    // The pace the wait seeded is set aside, so the line is asked the plan's speed at once
    // and what is read is the ledger alone.
    const third = tick(
      { distanceM: b2.distanceM - 0.65, speedMps: GROUP_MPS },
      { ...second.state, noDrop: { ...second.state.noDrop, paceShare: null } },
    );
    expect(third.answer.state.noDrop.hold).toBeNull();
    expect(third.answer.groupSpeedMps).toBe(GROUP_MPS);
    // #3298's plan, read back: 150 W and a watt for each second late. A second of
    // waiting changed nothing: it is as late as on the start line, −FRONT_M / 8 s.
    expect(third.answer.state.bots.b1?.powerWatts).toBeCloseTo(150 - FRONT_M / GROUP_MPS, 9);
    // Chased, it would ride a watt more for each second the wait cost: the second
    // it took, less the plan's time for the road the line rolled over in it.
    const chased = 150 + (1 - frontAfter / GROUP_MPS);
    expect(chased - (150 - FRONT_M / GROUP_MPS)).toBeGreaterThan(0.5);
    // Still getting back up to speed, at 2 m/s of the plan's 8: that is not riding time either.
    expect(third.answer.state.ledger.ridingSeconds).toBeCloseTo(
      (frontAfter - FRONT_M) / GROUP_MPS,
      12,
    );
    expect(third.answer.state.heldFromM).toBe(frontAfter);
    // Back at 98 % of the plan's speed, the tick is booked whole on top of the road so far.
    const upToSpeed = withBot(third.answer.state, 'b1', { speedMps: 0.98 * GROUP_MPS });
    const frontNow = upToSpeed.bots.b1?.distanceM as number;
    const fourth = tick({ distanceM: b2.distanceM - 0.65, speedMps: GROUP_MPS }, upToSpeed);
    expect(fourth.answer.state.heldFromM).toBeNull();
    expect(fourth.answer.state.ledger.ridingSeconds).toBeCloseTo(
      (frontNow - FRONT_M) / GROUP_MPS + 0.5,
      12,
    );
    // A touch under it, not yet.
    const nearly = withBot(third.answer.state, 'b1', { speedMps: 0.979 * GROUP_MPS });
    expect(
      tick({ distanceM: b2.distanceM - 0.65, speedMps: GROUP_MPS }, nearly).answer.state.heldFromM,
    ).toBe(frontNow);
  });

  it('paces the line to the rider once their pace is remembered: asked a margin over it, ridden as an eased speed, and not booked', () => {
    // Half the plan's speed remembered, and the rider on b2's wheel at 4 m/s.
    const paced: NoDropState = { ...startNoDrop(0), paceShare: 0.5 };
    const { answer } = tick({ distanceM: 100, speedMps: 4 }, { ...start(), noDrop: paced });
    expect(answer.state.noDrop.hold).toBeNull();
    expect(answer.state.rotation.phase).toBe('steady');
    expect(answer.groupSpeedMps).toBeCloseTo(GROUP_MPS * 0.5 * 1.05, 9);
    expect(answer.rotation.demands.b1).toBe(answer.groupSpeedMps);
    // At the plan's 8 m/s the front is over that: it pedals nothing.
    expect(answer.state.bots.b1?.powerWatts).toBe(0);
    // The eased pace is the rider's ride: not riding time for the plan.
    expect(answer.state.ledger).toEqual({ ridingSeconds: 0 });
    expect(answer.state.heldFromM).toBe(FRONT_M);
  });

  it('does not book a rider’s own pull under the group’s speed, and books one at it', () => {
    const riderFirst = [RIDER, bot('b1'), bot('b2'), bot('b3')];
    const under = tick(
      { distanceM: 100, speedMps: 0.979 * GROUP_MPS },
      start(riderFirst, { distanceM: 100, speedMps: 0.979 * GROUP_MPS }),
    ).answer;
    expect(under.rotation.roles.you).toBe('on-front');
    expect(under.state.ledger).toEqual({ ridingSeconds: 0 });
    expect(under.state.heldFromM).toBe(100);
    const at = tick(
      { distanceM: 100, speedMps: 0.98 * GROUP_MPS },
      start(riderFirst, { distanceM: 100, speedMps: 0.98 * GROUP_MPS }),
    ).answer;
    expect(at.state.ledger).toEqual({ ridingSeconds: 0.5 });
    expect(at.state.heldFromM).toBeNull();
    // With the rule left out every tick is booked, as before #3301.
    const left = tick(
      { distanceM: 100, speedMps: 4 },
      start(riderFirst, { distanceM: 100, speedMps: 4 }),
      { noDrop: false },
    ).answer;
    expect(left.state.ledger).toEqual({ ridingSeconds: 0.5 });
  });

  it('names a rider off the front, moves them out of the line, and has the bot that was behind them hold a bot’s wheel', () => {
    const { answer, physics } = tick({ distanceM: 104, speedMps: 11 });
    expect(answer.rotation.roles.you).toBe('off-the-front');
    expect(answer.state.rotation.order).toEqual(['b1', 'b2', 'b3', 'you']);
    expect(answer.state.rotation.phase).toBe('forming');
    // b3 on b2's wheel, 1.3 m up the road at its own speed: not after the rider at 11 m/s.
    const expected = botWheelWatts({
      gapMetres: 1.3,
      closingMetresPerSecond: 0,
      holdWatts: physics.holdWatts(GROUP_MPS, 0, 0.6),
      cpWatts: CP,
    });
    expect(answer.state.bots.b3?.powerWatts).toBeCloseTo(expected, 9);
  });

  it('does not chase a rider beyond the draft’s reach up the road: the front rides the plan’s power to the watt', () => {
    // Half a metre a second under its speed: in the rider's shelter it would be held to that speed.
    const state = withBot(start(), 'b1', { speedMps: GROUP_MPS + 0.5 });
    const beyond = tick({ distanceM: FRONT_M + 30.5, speedMps: 11 }, state);
    expect(beyond.answer.rotation.roles.you).toBe('off-the-front');
    expect(beyond.answer.state.bots.b1?.powerWatts).toBe(150 - FRONT_M / GROUP_MPS);
    const inside = tick({ distanceM: FRONT_M + 29.5, speedMps: 11 }, state);
    expect(inside.answer.state.bots.b1?.powerWatts).toBe(0);
  });

  it('leaves a gapped rider who is aside after a pull their latching role', () => {
    const state = start();
    const { answer } = tick(
      { distanceM: 89, speedMps: GROUP_MPS },
      {
        ...state,
        rotation: { ...state.rotation, phase: 'latching', order: ['b1', 'b2', 'b3'], aside: 'you' },
      },
    );
    expect(answer.state.noDrop).toMatchObject({ standing: 'gapped', sweep: 'b3' });
    expect(answer.rotation.roles.you).toBe('latching');
  });

  it('with the rule left out, rides on: no hold, no sweep, every tick booked, the rider’s role the line’s', () => {
    const state = start();
    const { answer } = tick({ distanceM: 70, speedMps: GROUP_MPS }, state, { noDrop: false });
    expect(answer.state.noDrop).toBe(state.noDrop);
    expect(answer.state.rotation.phase).toBe('forming');
    expect(answer.rotation.roles.you).toBe('in-line');
    expect(answer.groupSpeedMps).toBe(GROUP_MPS);
    expect(answer.state.ledger).toEqual({ ridingSeconds: 0.5 });
    expect(answer.state.heldFromM).toBeNull();
    expect(answer.state.bots.b1?.powerWatts).toBe(150 - FRONT_M / GROUP_MPS);
  });

  it('has a bot aside drift back by its share of the front’s own speed where the line is slower than it is asked', () => {
    // b1 aside, 8 m up the road from the last wheel at the 7.04 m/s the rotation asked of it.
    const asideTick = (frontSpeed: number) => {
      const state = start();
      const asked = GROUP_MPS * 0.88;
      const physics = standIn();
      stepGroupRide(
        {
          ...withBot(
            withBot(state, 'b1', {
              distanceM: (state.bots.b3?.distanceM as number) + 8,
              speedMps: asked,
            }),
            'b2',
            { speedMps: frontSpeed },
          ),
          noDrop: { ...state.noDrop, nextWindowAtMs: 1_000 },
          rotation: {
            ...state.rotation,
            phase: 'changing',
            order: ['b2', 'you', 'b3'],
            aside: 'b1',
            nextWindowAtMs: 1_000,
            roles: { b1: 'drifting-back', b2: 'on-front', you: 'second-wheel', b3: 'last-wheel' },
            demands: { b1: asked, b2: GROUP_MPS, b3: GROUP_MPS },
          },
        },
        { elapsedSeconds: 0.5, rider: RIDER_AT },
        roadOn(physics),
      );
      return { asked, physics, call: physics.advanced[0] as Advanced };
    };
    // The front at the group's speed: the speed the rotation asked, as before.
    const level = asideTick(GROUP_MPS);
    expect(level.call.powerWatts).toBeCloseTo(level.physics.holdWatts(level.asked, 0, 1), 9);
    // The front at 5 m/s: 4.4 m/s is its share under that, and at 7.04 m/s it pedals nothing.
    expect(asideTick(5).call.powerWatts).toBe(0);
    // At 7.9 m/s: 6.952 m/s, a touch under what it rides.
    const slower = asideTick(7.9);
    expect(slower.call.powerWatts).toBeLessThan(level.call.powerWatts - 20);
    expect(slower.call.powerWatts).toBeGreaterThan(0);
  });
});

describe('what a tick refuses', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'a tick of %s seconds',
    (elapsedSeconds) => {
      expect(() =>
        stepGroupRide(start(), { elapsedSeconds, rider: RIDER_AT }, roadOn(standIn())),
      ).toThrowError(expect.objectContaining({ code: 'view-out-of-range' }) as GroupRideError);
    },
  );

  it('a rider who is nowhere finite, before any physics is asked', () => {
    const physics = standIn();
    expect(() =>
      stepGroupRide(
        start(),
        { elapsedSeconds: 1, rider: { distanceM: Number.NaN, speedMps: 8 } },
        roadOn(physics),
      ),
    ).toThrowError(GroupRideError);
    expect(physics.drafted).toEqual([]);
  });
});

describe('room-portable and seeded', () => {
  it('names no clock, no random draw, no platform API and no arithmetic beyond + − × ÷, min, max and sqrt', () => {
    const code = stepSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const banned of [
      /Math\.random\b/,
      /\bDate\b/,
      /performance\./,
      /\*\*/,
      /\bdocument\b/,
      /\bwindow\./,
    ]) {
      expect(code).not.toMatch(banned);
    }
    const maths = [...code.matchAll(/Math\.(\w+)/g)].map((match) => match[1]);
    expect(maths.length).toBeGreaterThan(0);
    expect(maths.every((name) => name === 'min' || name === 'max' || name === 'sqrt')).toBe(true);
  });

  it('is a pure function of its inputs: the same tick twice is the same answer', () => {
    const state = start();
    const input = { elapsedSeconds: 0.5, rider: RIDER_AT };
    const once = stepGroupRide(state, input, roadOn(standIn()));
    const again = stepGroupRide(state, input, roadOn(standIn()));
    expect(again.state).toEqual(once.state);
    expect(again.draft).toEqual(once.draft);
  });
});
