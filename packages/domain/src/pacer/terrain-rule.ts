// SPDX-License-Identifier: Apache-2.0

/**
 * **The pacer paces the terrain when the rider is on its wheel** — ADR 0082,
 * the owner's ruling of 2026-11-18 on #2802 (*"Yes to pacer rule"*).
 *
 * Under `pacer-5` the model held everywhere with the rider level or in the
 * draft: it never eased before a climb or lifted on a descent. So the device
 * does it. With the rider **level** with the pacer (`riderPlaceOf`, inside
 * `PACER_LEVEL_S`) or **in its draft**, and never with the rider `ahead`:
 *
 * - **`ease`** within the last {@link PACER_BEFORE_CLIMB_M} before the next
 *   climb, by #2794's definition (`route/course-ahead.ts`: at least
 *   `COURSE_HILL_GRADE_PERCENT` for at least `COURSE_HILL_LEAST_METRES`);
 * - **`lift`** on a descent, by the same rule downhill, and for the first
 *   {@link PACER_OVER_THE_TOP_M} after a climb ends.
 *
 * On the climb itself, and everywhere else, the model's intent is ridden.
 * **Only the intent moves; the plan is the model's.** The rule names no power:
 * the direction it returns is ridden through `directedPacingFactor`, inside
 * #92's envelope, and reaches no trainer.
 *
 * ## Which wins
 *
 * - **Before a climb over a descent**: a dip that runs into a climb inside
 *   {@link PACER_BEFORE_CLIMB_M} is `before-climb`. The ease is the rule's
 *   reason for existing (save for the climb), and it is the lower of the two.
 * - **ADR 0078's floor over this rule**: {@link riddenDirection} applies the
 *   floor last. The two cannot act on one answer today — the floor needs the
 *   rider `ahead` and this rule refuses `ahead` — and the order makes the
 *   floor win if a later change lets them meet.
 */

import {
  COURSE_HILL_GRADE_PERCENT,
  COURSE_HILL_LEAST_METRES,
  courseHillsAhead,
} from '../route/course-ahead';
import { gradeAt, type RouteProfile } from '../route/profile';
import {
  flooredDirection,
  pacerSaysEasing,
  pacerSaysPushing,
  type PacerDirection,
  type PacerIntent,
  type RiderPlace,
} from './model-pacer';

/** How far before a climb the pacer eases, metres: **300**, the owner's figure. */
export const PACER_BEFORE_CLIMB_M = 300;

/**
 * How far past the top of a climb the pacer lifts, metres: **200**, the
 * shortest a climb is. A feel parameter, the author's choice (ADR 0082 D-1).
 */
export const PACER_OVER_THE_TOP_M = 200;

/** Where the pacer is, for the rule. A closed list. */
export const PACER_TERRAINS = ['before-climb', 'descent', 'over-the-top', 'none'] as const;
export type PacerTerrain = (typeof PACER_TERRAINS)[number];

/** The intent each terrain is ridden at, or `undefined` where the model's stands. */
const TERRAIN_INTENT: Readonly<Record<PacerTerrain, PacerIntent | undefined>> = {
  'before-climb': 'ease',
  descent: 'lift',
  'over-the-top': 'lift',
  none: undefined,
};

/** Whether the road at `at` is on a run of `sign` grade at least {@link COURSE_HILL_LEAST_METRES} long, end to end. */
function onHill(profile: RouteProfile, at: number, sign: 1 | -1): boolean {
  const step = profile.resolution as number;
  const hill = (d: number): boolean =>
    (gradeAt(profile, d) as number) * sign >= COURSE_HILL_GRADE_PERCENT;
  if (!hill(at)) return false;
  const inRoad = (d: number): boolean => profile.loop || (d >= 0 && d <= profile.totalDistance);
  let back = 0;
  while (back < COURSE_HILL_LEAST_METRES && inRoad(at - back - step) && hill(at - back - step)) {
    back += step;
  }
  let on = 0;
  while (on < COURSE_HILL_LEAST_METRES && inRoad(at + on + step) && hill(at + on + step)) {
    on += step;
  }
  return back + on >= COURSE_HILL_LEAST_METRES;
}

/**
 * Where a pacer `pacerAt` metres along `profile` is, for the rule: in the
 * last {@link PACER_BEFORE_CLIMB_M} before a climb, on a descent, in the first
 * {@link PACER_OVER_THE_TOP_M} past a climb's top, or `none` (on a climb, or
 * anywhere else). A climb or descent is #2794's: at least 3 % for at least
 * 200 m, counted end to end, so the last metres of either still count.
 */
export function pacerTerrainAt(profile: RouteProfile, pacerAt: number): PacerTerrain {
  if (onHill(profile, pacerAt, 1)) return 'none';
  // The next climb must fit its 200 m inside the look, or it is not one yet.
  const { climb } = courseHillsAhead(
    profile,
    pacerAt,
    PACER_BEFORE_CLIMB_M + COURSE_HILL_LEAST_METRES,
  );
  if (climb !== null && climb.inM > 0 && climb.inM <= PACER_BEFORE_CLIMB_M) return 'before-climb';
  if (onHill(profile, pacerAt, -1)) return 'descent';
  const step = profile.resolution as number;
  for (let back = step; back <= PACER_OVER_THE_TOP_M; back += step) {
    const at = pacerAt - back;
    if (!profile.loop && at < 0) break;
    if (onHill(profile, at, 1)) return 'over-the-top';
  }
  return 'none';
}

/**
 * Whether the rule may act on an ask built with the rider at `riderPlace`
 * and `riderInDraft`: level, or in the draft, and **never ahead** (ADR 0078's
 * floor's ground). Behind and out of the draft, the model's gap rules decide.
 */
export function pacerTerrainApplies(
  riderPlace: RiderPlace | undefined,
  riderInDraft: boolean,
): boolean {
  if (riderPlace === 'ahead') return false;
  return riderPlace === 'level' || riderInDraft;
}

/** What the ask an answer replies to was built with: where the rider and the pacer were. */
export interface PacerRuleGround {
  readonly terrain: PacerTerrain;
  readonly riderPlace: RiderPlace | undefined;
  readonly riderInDraft: boolean;
  /** How long the rider had been ahead, for ADR 0078's floor; `undefined` when they were not. */
  readonly aheadForS: number | undefined;
}

/**
 * The direction the device rides for the model's `chosen` (ADR 0082 D-1):
 * this rule's intent where it applies, then ADR 0078's floor, last, so the
 * floor wins. The plan is always `chosen`'s. Returns `chosen` itself when
 * nothing moved, so a caller can tell.
 */
export function riddenDirection(chosen: PacerDirection, ground: PacerRuleGround): PacerDirection {
  const intent = pacerTerrainApplies(ground.riderPlace, ground.riderInDraft)
    ? TERRAIN_INTENT[ground.terrain]
    : undefined;
  const terrained =
    intent === undefined || intent === chosen.intent ? chosen : { plan: chosen.plan, intent };
  return flooredDirection(terrained, ground.aheadForS);
}

/**
 * Whether `say` contradicts the intent the device **rode** (ADR 0082 D-3),
 * read only when that differs from the model's: a push under `ease`, an ease
 * under `lift`, and either under `hold`, which neither describes. Such a
 * line is not shown; the direction ridden is still applied and logged.
 */
export function pacerSayAgainstRidden(say: string, ridden: PacerIntent): boolean {
  switch (ridden) {
    case 'ease':
      return pacerSaysPushing(say);
    case 'lift':
      return pacerSaysEasing(say);
    case 'hold':
      return pacerSaysEasing(say) || pacerSaysPushing(say);
  }
}
