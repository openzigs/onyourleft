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
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  watts,
} from '../quantities';
import { routeProfile } from '../route/profile';
import { lineClimbAheadM } from './climb-ahead';
import { GroupRideError } from './errors';
import { courseOf, FLAT_COURSE } from './fixtures/courses';
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
    // Level to 120 m and 6 % beyond: b1 (130 m) climbs while b2 (110 m), the rider (100 m) and b3 (90 m) do not.
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
      bots: { b1, b2: at(110, 'b2'), b3: at(90, 'b3') },
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
      gapMetres: 20,
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

describe('what a tick refuses', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'a tick of %s seconds',
    (elapsedSeconds) => {
      expect(() =>
        stepGroupRide(start(), { elapsedSeconds, rider: RIDER_AT }, roadOn(standIn())),
      ).toThrowError(expect.objectContaining({ code: 'view-out-of-range' }) as GroupRideError);
    },
  );

  it('not a route under a metre long that routeProfile built: it holds nothing (#3362)', () => {
    // Two made-up points 0.5 m apart on the equator from 0° 0°: no place is real.
    // routeProfile gives it a spacing of 0.5 m, under the 1 m a hand-built profile must have.
    const tiny = routeProfile([
      {
        position: geographicPosition(degreesLatitude(0), degreesLongitude(0)),
        elevation: altitudeMetres(100),
      },
      {
        position: geographicPosition(degreesLatitude(0), degreesLongitude(0.5 / 111_194.9)),
        elevation: altitudeMetres(100.1),
      },
    ]);
    expect(tiny.resolution as number).toBeLessThan(1);
    const road: GroupRoad = { course: tiny, plan: PLAN, physics: standIn() };
    const rider = { distanceM: 0, speedMps: GROUP_MPS };
    let state = startGroupRide({ line: LINE, seed: 3, atMs: 0, rider });
    for (let tick = 0; tick < 4; tick += 1) {
      state = stepGroupRide(state, { elapsedSeconds: 0.5, rider }, road).state;
    }
    for (const at of [0, 0.25, 0.49]) expect([at, lineClimbAheadM(tiny, at)]).toEqual([at, null]);
  });

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
