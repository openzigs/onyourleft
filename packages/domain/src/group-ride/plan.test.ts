// SPDX-License-Identifier: Apache-2.0

/**
 * The group plan — #3298. Each `describe` is one of the issue's acceptance
 * criteria. The group is ridden headless: a fixed tick, the front's power from
 * the plan, its speed from a stand-in speed model, its odometer moved by it.
 * `packages/physics/src/group-plan.test.ts` rides the same plan on physics'
 * own steady-state solver.
 */

import { describe, expect, it } from 'vitest';

import * as domain from '../index';
import { metresPerSecond, watts, type MetresPerSecond } from '../quantities';
import { gradeAt, type RouteProfile } from '../route/profile';
import { GroupRideError } from './errors';
import {
  courseOf,
  FLAT_COURSE,
  HILLY_COURSE,
  stretchBounds,
  type Stretch,
} from './fixtures/courses';
import planSource from './plan.ts?raw';
import errorsSource from './errors.ts?raw';
import {
  GROUP_LEDGER_START,
  GROUP_PLAN_LEAST_BASE_WATTS,
  groupGradeFactor,
  planGroupRide,
  stepGroupLedger,
  type GroupLedger,
  type GroupPlan,
  type GroupPlanRefusal,
  type GroupSpeedModel,
} from './plan';

/**
 * A stand-in for physics' steady-state solver: the Martin balance at a fixed
 * 75 kg with the slope taken through `sqrt` only, bisected in a fixed count.
 * Not physics' numbers; a speed model of the same shape.
 */
const standInSpeed: GroupSpeedModel = (powerWatts, gradePercent) => {
  const rise = gradePercent / 100;
  const hypotenuse = Math.sqrt(1 + rise * rise);
  const resisting = 75 * 9.81 * (0.005 / hypotenuse + rise / hypotenuse);
  const cost = (speed: number): number => speed * resisting + 0.5 * 1.2 * 0.3 * speed ** 3;
  let low = 0;
  let high = 60;
  for (let step = 0; step < 70; step += 1) {
    const middle = (low + high) / 2;
    if (cost(middle) < powerWatts) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
};

const kmh = (value: number): MetresPerSecond => metresPerSecond(value / 3.6);
const TARGET = kmh(30);
const TICK_SECONDS = 0.5;

function planned(course: RouteProfile, target = TARGET, capacityWatts?: number): GroupPlan {
  const result = planGroupRide({
    course,
    targetSpeed: target,
    frontSpeed: standInSpeed,
    capacityWatts,
  });
  if ('error' in result) throw result.error;
  return result;
}

function refused(course: RouteProfile, target: MetresPerSecond): GroupRideError {
  const result = planGroupRide({ course, targetSpeed: target, frontSpeed: standInSpeed });
  expect('error' in result).toBe(true);
  return (result as GroupPlanRefusal).error;
}

interface RideOptions {
  /** Ride with the ledger always on the plan, so its correction is nought: the plan alone. */
  readonly onPlan?: boolean;
  /** A multiplier on the group's speed at an odometer: drift the plan does not know of. */
  readonly slow?: (odometer: number) => number;
  /** Stop the group this many seconds, booked as paused, at the first tick at or past `pauseAt`. */
  readonly pauseAt?: number;
  readonly pauseSeconds?: number;
}

interface Ridden {
  /** Wall time to the finish, seconds, waiting included. */
  readonly seconds: number;
  /** The front's power on every moving tick. */
  readonly powers: readonly number[];
  readonly odometers: readonly number[];
  /** What the ledger lifted or eased by, as a share of the base power, on every moving tick. */
  readonly corrections: readonly number[];
}

/** Ride the group over `course` on `plan`, a tick at a time. */
function ride(plan: GroupPlan, course: RouteProfile, options: RideOptions = {}): Ridden {
  const total = course.totalDistance as number;
  const base = plan.basePower as number;
  let odometer = 0;
  let seconds = 0;
  let ledger: GroupLedger = GROUP_LEDGER_START;
  let paused = options.pauseAt === undefined;
  const powers: number[] = [];
  const odometers: number[] = [];
  const corrections: number[] = [];
  for (;;) {
    if (!paused && odometer >= (options.pauseAt as number)) {
      paused = true;
      for (let waited = 0; waited < (options.pauseSeconds ?? 0); waited += TICK_SECONDS) {
        ledger = stepGroupLedger(ledger, TICK_SECONDS, true);
        seconds += TICK_SECONDS;
      }
    }
    const read: GroupLedger = options.onPlan
      ? { ridingSeconds: plan.plannedSecondsAt(odometer) }
      : ledger;
    const power = plan.powerAt(odometer, read) as number;
    const onPlan = plan.powerAt(odometer, { ridingSeconds: plan.plannedSecondsAt(odometer) });
    powers.push(power);
    odometers.push(odometer);
    corrections.push((power - (onPlan as number)) / base);
    const speed = standInSpeed(power, gradeAt(course, odometer)) * (options.slow?.(odometer) ?? 1);
    if (odometer + speed * TICK_SECONDS >= total) {
      return { seconds: seconds + (total - odometer) / speed, powers, odometers, corrections };
    }
    odometer += speed * TICK_SECONDS;
    seconds += TICK_SECONDS;
    ledger = stepGroupLedger(ledger, TICK_SECONDS, false);
  }
}

const goalOf = (course: RouteProfile, target = TARGET): number =>
  (course.totalDistance as number) / target;

/** The odometers every `step` metres strictly inside the stretch at `index` of `stretches`, `margin` in from each end. */
function inside(stretches: readonly Stretch[], index: number, margin = 250, step = 50): number[] {
  const [start, end] = stretchBounds(stretches)[index] as readonly [number, number];
  const at: number[] = [];
  for (let along = start + margin; along <= end - margin; along += step) at.push(along);
  return at;
}

const flat = courseOf(FLAT_COURSE);
const hilly = courseOf(HILLY_COURSE);

describe('on a flat course the average is the target', () => {
  it('rides the 10 km in distance ÷ target, within 0.5 %', () => {
    const plan = planned(flat);
    expect(plan.plannedSecondsAt(10_000)).toBeCloseTo(goalOf(flat), 6);
    const { seconds } = ride(plan, flat, { onPlan: true });
    expect(Math.abs(seconds - goalOf(flat)) / goalOf(flat)).toBeLessThan(0.005);
  });

  it('holds the target speed itself on a level road', () => {
    expect(planned(flat).speedNowAt(5_000) as number).toBeCloseTo(TARGET, 6);
  });
});

describe('on a hilly course the average is the target, faster on the flats and slower up the climb', () => {
  const plan = planned(hilly);

  it('rides the course in distance ÷ target, within 0.5 %', () => {
    const { seconds } = ride(plan, hilly, { onPlan: true });
    expect(Math.abs(seconds - goalOf(hilly)) / goalOf(hilly)).toBeLessThan(0.005);
  });

  it('is above the target on every flat and below it on the climb', () => {
    for (const index of [0, 2, 4]) {
      for (const at of inside(HILLY_COURSE, index)) {
        expect(plan.speedNowAt(at) as number, `flat at ${String(at)} m`).toBeGreaterThan(TARGET);
      }
    }
    for (const at of inside(HILLY_COURSE, 1)) {
      expect(plan.speedNowAt(at) as number, `climb at ${String(at)} m`).toBeLessThan(TARGET);
    }
  });

  it('is not the target held as a flat label: a base power that makes 30 km/h on the flat misses', () => {
    const flatPlan = planned(flat);
    const labelled = ride(
      {
        ...plan,
        powerAt: (odometer) =>
          watts((flatPlan.basePower as number) * groupGradeFactor(gradeAt(hilly, odometer))),
      },
      hilly,
    );
    expect(Math.abs(labelled.seconds - goalOf(hilly)) / goalOf(hilly)).toBeGreaterThan(0.005);
  });
});

describe('steadier on the climb: the front lifts no more than +5 %', () => {
  const plan = planned(hilly);
  const base = plan.basePower as number;

  it('stays at or under 1.05 × base on the +8 % section, on the plan and however late the group is', () => {
    for (const at of inside(HILLY_COURSE, 1, 30, 10)) {
      for (const ridingSeconds of [plan.plannedSecondsAt(at), plan.plannedSecondsAt(at) + 1_000]) {
        expect(plan.powerAt(at, { ridingSeconds }) as number).toBeLessThanOrEqual(
          base * 1.05 + 1e-9,
        );
      }
    }
  });

  it('does lift on the climb, to the cap at 8 %', () => {
    const at = 3_750;
    expect(plan.powerAt(at, { ridingSeconds: plan.plannedSecondsAt(at) }) as number).toBeCloseTo(
      base * 1.05,
      6,
    );
  });

  it('caps the uphill lift lower than the solo pacer’s, which is +10 % at 8 %', () => {
    expect(groupGradeFactor(8)).toBeCloseTo(1.05, 12);
    expect(groupGradeFactor(16)).toBeCloseTo(1.05, 12);
    expect(groupGradeFactor(4)).toBeCloseTo(1.025, 12);
    expect(domain.pacingFactor(8)).toBeCloseTo(1.1, 12);
    // Downhill it is the pacer's own rule.
    expect(groupGradeFactor(-3)).toBe(domain.pacingFactor(-3));
    expect(groupGradeFactor(Number.NaN)).toBe(1);
  });

  it('eases in the last 300 m before the climb and holds at least the flat effort over the top', () => {
    const onPlan = (at: number): number =>
      plan.powerAt(at, { ridingSeconds: plan.plannedSecondsAt(at) });
    expect(onPlan(2_850)).toBeCloseTo(base * 0.95, 6);
    expect(onPlan(1_500)).toBeCloseTo(base, 6);
    // 100 m past the crest, on the level: held at the flat effort, never eased.
    expect(onPlan(4_600)).toBeGreaterThanOrEqual(base - 1e-9);
    // 100 m before the descent's end is a descent, not over the top.
    expect(onPlan(6_900)).toBeCloseTo(base * 0.8, 6);
  });

  it('does not sit up at the crest: a gentle road down from the top is ridden at the flat effort for 200 m', () => {
    // −2 % is under a descent's 3 %, so past the crest it is "over the top" and then nothing.
    const crested = planned(
      courseOf([
        [1_000, 0],
        [500, 6],
        [2_000, -2],
      ]),
    );
    const at = (odometer: number): number =>
      crested.powerAt(odometer, { ridingSeconds: crested.plannedSecondsAt(odometer) });
    const flatBase = crested.basePower as number;
    expect(at(1_600)).toBeCloseTo(flatBase, 6);
    expect(at(1_800)).toBeCloseTo(flatBase * groupGradeFactor(-2), 6);
    expect(groupGradeFactor(-2)).toBeLessThan(1);
  });
});

describe('keeps pedalling downhill', () => {
  const plan = planned(hilly);
  const base = plan.basePower as number;

  it('never drops under −20 % of base, nor to zero, on the −8 % descent, however early the group is', () => {
    for (const at of inside(HILLY_COURSE, 3, 0, 10)) {
      for (const ridingSeconds of [plan.plannedSecondsAt(at), plan.plannedSecondsAt(at) - 1_000]) {
        const power = plan.powerAt(at, { ridingSeconds }) as number;
        expect(power).toBeGreaterThanOrEqual(base * 0.8 - 1e-9);
        expect(power).toBeGreaterThan(0);
      }
    }
  });

  it('solves for a base power of at least the gentlest pace, so the floor is never zero', () => {
    expect(GROUP_PLAN_LEAST_BASE_WATTS).toBe(37.5);
    expect(plan.basePower as number).toBeGreaterThan(GROUP_PLAN_LEAST_BASE_WATTS);
  });
});

describe('waiting is not chased back', () => {
  it('rides identically, sample for sample, after 120 s paused mid-ride as with no pause', () => {
    const plan = planned(hilly);
    const straight = ride(plan, hilly);
    const waited = ride(plan, hilly, { pauseAt: 5_000, pauseSeconds: 120 });
    expect(waited.powers.length).toBe(straight.powers.length);
    expect(waited.powers).toEqual(straight.powers);
    expect(waited.seconds - straight.seconds).toBeCloseTo(120, 6);
  });

  it('books nothing for a paused step and the whole step otherwise', () => {
    const ledger = stepGroupLedger({ ridingSeconds: 12.5 }, 3, true);
    expect(ledger.ridingSeconds).toBe(12.5);
    expect(stepGroupLedger(ledger, 3, false).ridingSeconds).toBe(15.5);
  });
});

describe('the ledger corrects drift inside its band', () => {
  const plan = planned(hilly);
  const slowKilometre = (odometer: number): number =>
    odometer >= 1_000 && odometer < 2_000 ? 0.98 : 1;
  const corrected = ride(plan, hilly, { slow: slowKilometre });
  const uncorrected = ride(plan, hilly, { slow: slowKilometre, onPlan: true });
  const goal = goalOf(hilly);

  it('lifts the power once the group has fallen behind', () => {
    expect(Math.max(...corrected.corrections)).toBeGreaterThan(0.001);
  });

  it('never moves the power by more than ±5 % of base', () => {
    for (const correction of corrected.corrections) {
      expect(Math.abs(correction)).toBeLessThanOrEqual(0.05 + 1e-12);
    }
    const late = planned(hilly);
    const base = late.basePower as number;
    expect(
      late.powerAt(1_500, { ridingSeconds: late.plannedSecondsAt(1_500) + 600 }) as number,
    ).toBeCloseTo(base * 1.05, 6);
    expect(
      late.powerAt(1_500, { ridingSeconds: late.plannedSecondsAt(1_500) - 600 }) as number,
    ).toBeCloseTo(base * 0.95, 6);
  });

  it('finishes within 0.5 % of distance ÷ target, nearer it than with no ledger', () => {
    expect(Math.abs(corrected.seconds - goal) / goal).toBeLessThan(0.005);
    // 2 % slow for a kilometre is about 2.2 s late; the ledger wins back a
    // third or more of it by the line, in proportion, never past its band.
    expect(Math.abs(corrected.seconds - goal)).toBeLessThan(
      Math.abs(uncorrected.seconds - goal) * 0.7,
    );
  });
});

describe('an unreachable target is refused, naming the highest reachable average', () => {
  it('refuses 60 km/h on the hilly course and names the most it can make, and no coordinate', () => {
    const error = refused(hilly, kmh(60));
    expect(error).toBeInstanceOf(GroupRideError);
    expect(error.code).toBe('target-unreachable');
    const most = error.reachableAverageMetresPerSecond as number;
    expect(error.message).toBe(
      `the group cannot average 60.0 km/h on this route; the most it can average here is ` +
        `${(most * 3.6).toFixed(1)} km/h`,
    );
    // The number named is the edge: a little under it plans, a little over it does not.
    expect(
      'error' in
        planGroupRide({
          course: hilly,
          targetSpeed: metresPerSecond(most * 0.999),
          frontSpeed: standInSpeed,
        }),
    ).toBe(false);
    expect(
      'error' in
        planGroupRide({
          course: hilly,
          targetSpeed: metresPerSecond(most * 1.001),
          frontSpeed: standInSpeed,
        }),
    ).toBe(true);
  });

  it('reads the capacity it is given', () => {
    const at525 = refused(hilly, kmh(60)).reachableAverageMetresPerSecond as number;
    const result = planGroupRide({
      course: hilly,
      targetSpeed: kmh(30),
      frontSpeed: standInSpeed,
      capacityWatts: 100,
    });
    expect('error' in result && result.error.code).toBe('target-unreachable');
    expect(
      ('error' in result && result.error.reachableAverageMetresPerSecond) as number,
    ).toBeLessThan(at525);
  });

  it('refuses a target under the gentlest pace, naming the least it can make', () => {
    const error = refused(hilly, kmh(3));
    expect(error.code).toBe('target-too-slow');
    const least = error.reachableAverageMetresPerSecond as number;
    expect(error.message).toBe(
      `the group cannot average as little as 3.0 km/h on this route; the least it can average ` +
        `here is ${(least * 3.6).toFixed(1)} km/h`,
    );
  });
});

describe('what it refuses as input', () => {
  it.each([Number.NaN, 0, -1, Number.POSITIVE_INFINITY])('a target of %s', (target) => {
    expect(() =>
      planGroupRide({
        course: flat,
        targetSpeed: target as MetresPerSecond,
        frontSpeed: standInSpeed,
      }),
    ).toThrow(expect.objectContaining({ code: 'target-out-of-range' }));
  });

  it('a capacity under the gentlest base power', () => {
    expect(() => planned(flat, TARGET, 30)).toThrow(
      expect.objectContaining({ code: 'capacity-out-of-range' }),
    );
  });

  it('a speed model that answers no speed', () => {
    expect(() =>
      planGroupRide({ course: flat, targetSpeed: TARGET, frontSpeed: () => Number.NaN }),
    ).toThrow(expect.objectContaining({ code: 'speed-out-of-range' }));
    expect(() => planGroupRide({ course: flat, targetSpeed: TARGET, frontSpeed: () => 0 })).toThrow(
      expect.objectContaining({ code: 'speed-out-of-range' }),
    );
  });

  it('an odometer that is not a number, and a ledger step that is not a time', () => {
    const plan = planned(flat);
    expect(() => plan.powerAt(Number.NaN, GROUP_LEDGER_START)).toThrow(
      expect.objectContaining({ code: 'odometer-not-finite' }),
    );
    expect(() => stepGroupLedger(GROUP_LEDGER_START, -1, false)).toThrow(
      expect.objectContaining({ code: 'ledger-step-out-of-range' }),
    );
    expect(() => stepGroupLedger(GROUP_LEDGER_START, Number.NaN, true)).toThrow(
      expect.objectContaining({ code: 'ledger-step-out-of-range' }),
    );
  });

  it('clamps an odometer to the route', () => {
    const plan = planned(flat);
    expect(plan.plannedSecondsAt(-50)).toBe(0);
    expect(plan.plannedSecondsAt(12_000)).toBe(plan.plannedSecondsAt(10_000));
  });
});

describe('deterministic and room-portable', () => {
  /** Every output of a plan on the hilly course, every 10 m. */
  function everything(): string {
    const plan = planned(hilly);
    const rows: number[] = [plan.basePower];
    for (let at = 0; at <= 10_000; at += 10) {
      rows.push(
        plan.plannedSecondsAt(at),
        plan.speedNowAt(at),
        plan.powerAt(at, { ridingSeconds: at / 8 }),
      );
    }
    return JSON.stringify(
      rows.map((value) => [...new Uint8Array(new Float64Array([value]).buffer)]),
    );
  }

  it('gives byte-identical output for the same course across two runs', () => {
    expect(everything()).toBe(everything());
  });

  it('names no clock, no random draw and no Math member but min, max and sqrt (ADR 0067 D-5.2)', () => {
    for (const source of [planSource, errorsSource]) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bDate\b|performance\.|\*\*|setTimeout|setInterval/);
      const members = [...code.matchAll(/Math\.(\w+)/g)].map((match) => match[1]);
      for (const member of members) expect(['min', 'max', 'sqrt']).toContain(member);
    }
    expect(planSource).toContain('Math.min');
  });

  it('imports only the pacer’s rules, the route and the quantities: no recorded ride', () => {
    const specifiers = [...planSource.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual([
      '../pacer/pacing',
      '../pacer/terrain-rule',
      '../quantities',
      '../route/profile',
      './errors',
    ]);
  });

  it('is exported from the package', () => {
    expect(domain.planGroupRide).toBe(planGroupRide);
    expect(domain.stepGroupLedger).toBe(stepGroupLedger);
    expect(domain.GroupRideError).toBe(GroupRideError);
  });
});
