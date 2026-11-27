// SPDX-License-Identifier: Apache-2.0

/**
 * **The group plan: the target speed as a true ride average** — #3298, epic
 * #3296, the owner's ruling 1 of 2026-11-26.
 *
 * The rider picks an average speed. This module turns it into the power the
 * front of the group rides at every point of the route, so that **the group's
 * average over the whole route is the stated number**: faster than it on the
 * flats and descents, slower on the climbs, where the effort stays steadier.
 *
 * ## The rules (the issue's seven, in order)
 *
 * 1. **Solved once, at the start, from the course only.** {@link planGroupRide}
 *    searches a bracket for the base power whose simulated time over the
 *    route is `distance ÷ target`, in at most {@link GROUP_PLAN_SOLVE_STEPS}
 *    steps, so the same input is the same work and the same answer.
 * 2. **Steadier on climbs.** The base power is shaped by
 *    {@link groupGradeFactor}: #92's `pacingFactor` downhill, and uphill the
 *    same ramp to 8 % capped at {@link GROUP_PLAN_MAXIMUM_UPLIFT} (+5 %) rather
 *    than the solo pacer's +10 %. A lift by the front rider costs a drafting
 *    rider far more at climbing speed, because the draft is worth less there.
 * 3. **Ease before a climb, steady over the top**, read through ADR 0082's
 *    `pacerTerrainAt` (which reads `courseHillsAhead`): in the last 300 m
 *    before a climb the front eases by {@link GROUP_PLAN_EASE_BEFORE_CLIMB};
 *    for the first 200 m past a crest it holds at least the flat effort, so
 *    the group does not sit up at the top.
 * 4. **Keep pedalling downhill.** Nothing takes the front under #92's −20 %
 *    floor (`PACING_FACTOR_FLOOR`) of the base power, and the base power is at
 *    least {@link GROUP_PLAN_LEAST_BASE_WATTS}, so the power is never zero.
 * 5. **A time ledger** ({@link GroupLedger}): the planned elapsed time at the
 *    front's odometer against the group's riding time. A late group lifts, an
 *    early one eases, proportionally, inside ±{@link GROUP_LEDGER_BAND} of the
 *    base power, and never outside the envelope of rules 2 and 4.
 * 6. **Waiting is not chased back** (proposed for ADR 0101, #3297): a ledger
 *    step booked as paused adds no riding time, so after a wait the plan rides
 *    exactly as if the wait had never happened.
 * 7. **An unreachable target is refused, not approximated**: if no base power
 *    up to the group's capacity makes the average on this route,
 *    {@link planGroupRide} returns an error naming the highest average it can
 *    make (and the lowest, for a target under the gentlest base power).
 *
 * ## The speed model is the caller's
 *
 * `packages/physics` depends on this package, so this one cannot import its
 * steady-state solver or `draft.ts`. The caller hands in
 * {@link GroupPlanInput.frontSpeed}: the steady speed of the **front rider** —
 * the fixed bot mass, with the drag `draft.ts` §`leadFactor` gives a rider with
 * a wheel behind it — at a power and a grade. #3300 passes physics' own; this
 * package's tests pass a stand-in, and `packages/physics/src/group-plan.test.ts`
 * holds the plan to its time with physics' solver.
 *
 * ## The road the plan rides
 *
 * The route's own 10 m grid: one cell between each pair of samples, at the
 * mean of their two grades (the mean of `gradeAt`'s interpolation across the
 * cell), with one power and one steady speed each. The plan is for one pass
 * of the route: an odometer is clamped to `[0, totalDistance]`, on a loop too.
 *
 * ## Room-portable, and from no recorded ride
 *
 * Only `+ − × ÷`, comparisons, `Math.min`, `Math.max` and `Math.sqrt` (ADR 0067
 * D-5.2), so a room could run it later; no clock and no random draw, which
 * `eslint.config.js` refuses under `group-ride/` and `plan.test.ts` scans for.
 * There is no seed because no rule here draws: the rotation (#3299) is where
 * a group's draws are. The inputs are a route profile, a number the rider chose
 * and a speed model: there is nowhere in them for a recorded ride (ADR 0007 D4).
 * None of these numbers is ever sent to a trainer.
 */

import {
  BOT_MASS_KILOGRAMS,
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  PACING_CLIMB_REFERENCE_GRADE_PERCENT,
  PACING_FACTOR_FLOOR,
  pacingFactor,
} from '../pacer/pacing';
import { pacerTerrainAt } from '../pacer/terrain-rule';
import {
  metres,
  metresPerSecond,
  watts,
  type GradePercent,
  type Metres,
  type MetresPerSecond,
  type Watts,
} from '../quantities';
import type { RouteProfile } from '../route/profile';
import { GroupRideError } from './errors';

/**
 * The most the front lifts its power above the base, climbing: **+5 %**, at
 * 8 % and steeper. *Proposed* for ADR 0101 (#3297 Q2), half the solo pacer's
 * `PACING_MAXIMUM_UPLIFT`. A feel parameter, tuned in the harness (#3309).
 */
export const GROUP_PLAN_MAXIMUM_UPLIFT = 0.05;

/** The top of the front's envelope, as a multiplier of the base power. Derived. */
export const GROUP_PLAN_FACTOR_CEILING = 1 + GROUP_PLAN_MAXIMUM_UPLIFT;

/**
 * How much the front eases in the last 300 m before a climb (ADR 0082's
 * `PACER_BEFORE_CLIMB_M`): **5 %** of the shaped power. *The author's choice*,
 * a feel parameter for ADR 0101, under the pacer's 7 % because a group's ease
 * is felt by every wheel behind it.
 */
export const GROUP_PLAN_EASE_BEFORE_CLIMB = 0.05;

/**
 * The ledger's band: it moves the front's power by at most **±5 %** of the
 * base power (#3298 rule 5, *proposed*).
 */
export const GROUP_LEDGER_BAND = 0.05;

/**
 * How late, or early, in seconds, the group is when the ledger is at its full
 * band: **20 s**. Under it the correction is in proportion. *The author's
 * choice*: a few seconds of drift asks for a lift the rider barely feels.
 */
export const GROUP_LEDGER_FULL_BAND_SECONDS = 20;

/**
 * The gentlest base power the plan will solve for: #92's gentlest pace, 0.5
 * W/kg at the bot's 75 kg (37.5 W). The floor of rule 4 is a share of it, so
 * the front never pedals at zero.
 */
export const GROUP_PLAN_LEAST_BASE_WATTS =
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM * BOT_MASS_KILOGRAMS;

/**
 * The group's capacity when the caller names none: #92's hardest pace, 7 W/kg
 * at 75 kg (525 W). The group's own make-up (#3297 Q3) is for the caller to
 * pass as {@link GroupPlanInput.capacityWatts}.
 */
export const GROUP_PLAN_DEFAULT_CAPACITY_WATTS =
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * BOT_MASS_KILOGRAMS;

/**
 * The most steps the solve for the base power takes: **24**. A bracketed
 * false-position search with the Illinois rule, which converges faster than
 * halving, and each step rides the whole route through the caller's speed
 * model once, so the count is what a long route costs at the start. A fixed
 * bound, as `packages/physics`' steady-state solver has, so the same input is
 * the same work; the search stops early only once a step lands on the goal
 * exactly.
 */
export const GROUP_PLAN_SOLVE_STEPS = 24;

/**
 * The front rider's steady speed, metres per second, at `powerWatts` (always
 * above zero) on `gradePercent`. The caller's; see the file comment.
 */
export type GroupSpeedModel = (powerWatts: number, gradePercent: number) => number;

/** What a group plan is built from. */
export interface GroupPlanInput {
  /** The route, once. */
  readonly course: RouteProfile;
  /** The average the rider chose, over the whole route. */
  readonly targetSpeed: MetresPerSecond;
  /** The front rider's steady speed at a power and a grade. */
  readonly frontSpeed: GroupSpeedModel;
  /** The most base power the group can hold, watts; {@link GROUP_PLAN_DEFAULT_CAPACITY_WATTS} by default. */
  readonly capacityWatts?: number;
}

/**
 * The time ledger: the group's **riding** time so far, seconds. Time booked as
 * paused (the group waiting or regrouping for the rider) is not in it, which
 * is the whole of rule 6. Start from {@link GROUP_LEDGER_START} and step with
 * {@link stepGroupLedger}.
 */
export interface GroupLedger {
  readonly ridingSeconds: number;
}

/** A ledger at the start of the ride. */
export const GROUP_LEDGER_START: GroupLedger = { ridingSeconds: 0 };

/**
 * The ledger after `seconds` more of the ride. A paused step books nothing, so
 * the riding time after a wait is the same number, to the bit, as with no wait.
 *
 * @throws {GroupRideError} `ledger-step-out-of-range` for a step that is not a
 * finite number of seconds of at least zero.
 */
export function stepGroupLedger(
  ledger: GroupLedger,
  seconds: number,
  paused: boolean,
): GroupLedger {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new GroupRideError(
      'ledger-step-out-of-range',
      'a group ledger step must be a finite number of seconds of at least zero',
    );
  }
  if (paused) return ledger;
  return { ridingSeconds: ledger.ridingSeconds + seconds };
}

/** A group's plan for one pass of the route. */
export interface GroupPlan {
  /** The front's power on the flat, solved once from the course. */
  readonly basePower: Watts;
  /** The route's length: what the target is an average over. */
  readonly distance: Metres;
  /** The average the plan makes: the rider's target. */
  readonly targetSpeed: MetresPerSecond;
  /** The planned elapsed riding time at `odometer`, seconds; `distance ÷ target` at the end. */
  plannedSecondsAt(odometer: number): number;
  /** The front's power at `odometer`, with the ledger's correction (rule 5). */
  powerAt(odometer: number, ledger: GroupLedger): Watts;
  /** The group's speed now: the planned steady speed on the road under the front. */
  speedNowAt(odometer: number): MetresPerSecond;
}

/** A target the plan refuses: unreachable on this route, or under the gentlest pace. */
export interface GroupPlanRefusal {
  readonly error: GroupRideError;
}

/**
 * The multiplier the gradient applies to the base power: #92's `pacingFactor`
 * downhill (to its −20 % floor at −6 %), and uphill the same linear ramp to
 * 8 % with its top at {@link GROUP_PLAN_FACTOR_CEILING}. A non-finite grade is
 * 1, as `pacingFactor` has it.
 */
export function groupGradeFactor(grade: GradePercent | number): number {
  const value: number = grade;
  if (!(value > 0)) return pacingFactor(value);
  return 1 + Math.min(value / PACING_CLIMB_REFERENCE_GRADE_PERCENT, 1) * GROUP_PLAN_MAXIMUM_UPLIFT;
}

/** The kilometres per hour in a metre per second, for a message. */
const KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND = 3.6;

/** `speed` as a message names it: km/h to one place. */
const inKilometresPerHour = (speed: number): string =>
  `${(speed * KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND).toFixed(1)} km/h`;

/** One cell of the route's grid: where it starts, how long it is, its grade and its share of the base power. */
interface Cell {
  readonly start: number;
  readonly length: number;
  readonly grade: number;
  readonly factor: number;
}

/** The cells of `course`, with the shaped factor of rules 2 to 4 on each. */
function cellsOf(course: RouteProfile): readonly Cell[] {
  const total = course.totalDistance as number;
  const step = course.resolution as number;
  const grades = course.grades as readonly number[];
  const cells: Cell[] = [];
  for (let index = 0; index + 1 < grades.length; index += 1) {
    const start = index * step;
    const end = index + 2 === grades.length ? total : (index + 1) * step;
    const length = end - start;
    if (!(length > 0)) continue;
    const grade = ((grades[index] as number) + (grades[index + 1] as number)) / 2;
    const shaped = groupGradeFactor(grade);
    const terrain = pacerTerrainAt(course, start + length / 2);
    const factor =
      terrain === 'before-climb'
        ? Math.max(PACING_FACTOR_FLOOR, shaped * (1 - GROUP_PLAN_EASE_BEFORE_CLIMB))
        : terrain === 'over-the-top'
          ? Math.max(shaped, 1)
          : shaped;
    cells.push({ start, length, grade, factor });
  }
  return cells;
}

/**
 * The front's steady speed in each cell at `base`, checked. A road repeats its
 * grades (every level cell is one question), so each distinct power and grade
 * is asked of the model once.
 */
function speedsAt(cells: readonly Cell[], base: number, model: GroupSpeedModel): number[] {
  const asked = new Map<number, Map<number, number>>();
  return cells.map((cell) => {
    const power = base * cell.factor;
    const atPower = asked.get(power) ?? new Map<number, number>();
    asked.set(power, atPower);
    const known = atPower.get(cell.grade);
    if (known !== undefined) return known;
    const speed = model(power, cell.grade);
    if (!Number.isFinite(speed) || !(speed > 0)) {
      throw new GroupRideError(
        'speed-out-of-range',
        "the front rider's speed model must answer a finite speed above zero",
      );
    }
    atPower.set(cell.grade, speed);
    return speed;
  });
}

/** The time over every cell at these speeds, seconds. */
function timeOver(cells: readonly Cell[], speeds: readonly number[]): number {
  let seconds = 0;
  for (let index = 0; index < cells.length; index += 1) {
    seconds += (cells[index] as Cell).length / (speeds[index] as number);
  }
  return seconds;
}

/**
 * Plan the group's power over `input.course` so that its average is
 * `input.targetSpeed`, or refuse a target it cannot make.
 *
 * @throws {GroupRideError} `target-out-of-range` for a target that is not a
 * finite speed above zero, `capacity-out-of-range` for a capacity under
 * {@link GROUP_PLAN_LEAST_BASE_WATTS}, `speed-out-of-range` for a speed model
 * that answers anything but a finite speed above zero.
 */
export function planGroupRide(input: GroupPlanInput): GroupPlan | GroupPlanRefusal {
  const target: number = input.targetSpeed;
  if (!Number.isFinite(target) || !(target > 0)) {
    throw new GroupRideError(
      'target-out-of-range',
      "a group ride's target average must be a finite speed above zero",
    );
  }
  const capacity = input.capacityWatts ?? GROUP_PLAN_DEFAULT_CAPACITY_WATTS;
  if (!Number.isFinite(capacity) || capacity < GROUP_PLAN_LEAST_BASE_WATTS) {
    throw new GroupRideError(
      'capacity-out-of-range',
      `a group's capacity must be a finite power of at least ` +
        `${String(GROUP_PLAN_LEAST_BASE_WATTS)} W`,
    );
  }
  const distance = input.course.totalDistance as number;
  const cells = cellsOf(input.course);
  const goal = distance / target;
  const timeAt = (base: number): number => timeOver(cells, speedsAt(cells, base, input.frontSpeed));

  const fastest = timeAt(capacity);
  if (fastest > goal) {
    const most = distance / fastest;
    return {
      error: new GroupRideError(
        'target-unreachable',
        `the group cannot average ${inKilometresPerHour(target)} on this route; ` +
          `the most it can average here is ${inKilometresPerHour(most)}`,
        most,
      ),
    };
  }
  const slowest = timeAt(GROUP_PLAN_LEAST_BASE_WATTS);
  if (slowest < goal) {
    const least = distance / slowest;
    return {
      error: new GroupRideError(
        'target-too-slow',
        `the group cannot average as little as ${inKilometresPerHour(target)} on this route; ` +
          `the least it can average here is ${inKilometresPerHour(least)}`,
        least,
      ),
    };
  }

  // Time falls as the base power rises: `low` stays too slow (`lateLow` > 0)
  // and `high` fast enough (`lateHigh` ≤ 0). Each step tries where the line
  // between them crosses the goal; when one end moves twice running, the
  // other end's lateness is halved (the Illinois rule), so the bracket
  // shrinks from both ends.
  let low = GROUP_PLAN_LEAST_BASE_WATTS;
  let high = capacity;
  let lateLow = slowest - goal;
  let lateHigh = fastest - goal;
  let base = high;
  let moved: 'low' | 'high' | undefined;
  for (let step = 0; step < GROUP_PLAN_SOLVE_STEPS && lateHigh < 0; step += 1) {
    base = (low * lateHigh - high * lateLow) / (lateHigh - lateLow);
    const late = timeAt(base) - goal;
    if (late > 0) {
      low = base;
      lateLow = late;
      if (moved === 'low') lateHigh /= 2;
      moved = 'low';
    } else {
      high = base;
      lateHigh = late;
      if (moved === 'high') lateLow /= 2;
      moved = 'high';
    }
  }
  const speeds = speedsAt(cells, base, input.frontSpeed);
  const before: number[] = [];
  let elapsed = 0;
  for (let index = 0; index < cells.length; index += 1) {
    before.push(elapsed);
    elapsed += (cells[index] as Cell).length / (speeds[index] as number);
  }

  /** The cell under `odometer`, clamped to the route, found by comparisons alone. */
  const cellIndexAt = (odometer: number): number => {
    if (!Number.isFinite(odometer)) {
      throw new GroupRideError(
        'odometer-not-finite',
        "a group's odometer must be a finite number of metres",
      );
    }
    let first = 0;
    let last = cells.length - 1;
    while (first < last) {
      const middle = (first + last + 1) >> 1;
      if ((cells[middle] as Cell).start <= odometer) {
        first = middle;
      } else {
        last = middle - 1;
      }
    }
    return first;
  };
  const along = (odometer: number, index: number): number => {
    const cell = cells[index] as Cell;
    return Math.min(Math.max(odometer, cell.start), cell.start + cell.length) - cell.start;
  };
  const plannedSecondsAt = (odometer: number): number => {
    const index = cellIndexAt(odometer);
    return (before[index] as number) + along(odometer, index) / (speeds[index] as number);
  };

  return {
    basePower: watts(base),
    distance: metres(distance),
    targetSpeed: input.targetSpeed,
    plannedSecondsAt,
    powerAt(odometer: number, ledger: GroupLedger): Watts {
      const index = cellIndexAt(odometer);
      const late = ledger.ridingSeconds - plannedSecondsAt(odometer);
      const share = Math.min(1, Math.max(-1, late / GROUP_LEDGER_FULL_BAND_SECONDS));
      const factor = Math.min(
        GROUP_PLAN_FACTOR_CEILING,
        Math.max(PACING_FACTOR_FLOOR, (cells[index] as Cell).factor + share * GROUP_LEDGER_BAND),
      );
      return watts(base * factor);
    },
    speedNowAt(odometer: number): MetresPerSecond {
      return metresPerSecond(speeds[cellIndexAt(odometer)] as number);
    },
  };
}
