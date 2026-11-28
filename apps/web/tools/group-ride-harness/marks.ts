// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness: **the pass marks**, each with the reason it is there. A
 * mark is one score of one scripted rider on one fixture course, held at
 * least or at most a figure. Below any mark the command exits 1, and
 * `marks.*.test.ts` go red in `pnpm run test`.
 *
 * They pin the owner's rulings of 2026-11-26 and #3302's bandwidth:
 *
 * | Mark | Rider | Courses | Holds |
 * |---|---|---|---|
 * | `finishes-with-group` | `weak`, `absent` | all | no more than the draft's reach behind the nearest member ahead at the finish |
 * | `stays-in-reach` | `weak`, `absent` | all | never beyond the draft's reach for longer than {@link RECOVERY_SECONDS} |
 * | `makes-the-average` | `steady` | hilly | the group's average within 1 % of the one asked |
 * | `takes-a-pull` | `never-presses` | all | at least one turn on the front |
 * | `not-stuck-on-front` | `never-presses` | all | no turn on the front longer than the pull, its grace and the fade's dwell |
 * | `surging-said` | `surger` | flat, hilly | `surging` said or marked at least once |
 * | `no-correction` | `steady` | all | no correction said or marked |
 * | `cue-ceiling` | `steady` | all | cues a minute at or below #3302's ceiling |
 * | `pulls-on-time` | `steady` | all | no turn on the front longer than the pull and the window its press waits for |
 *
 * `surging-said` is not asked of the rolling course: there the rider's turns
 * are cut short by the rotation's fade rule at a crest, where the group's
 * speed steps up faster than anyone on the front can follow it, so a surge
 * seldom has its dwell. The scores show it (`presses` is 0 for the steady
 * rider there); it is a finding for the rotation (#3410), not a mark.
 */

import { CUE_CEILING_PER_MINUTE } from '@onyourleft/domain';
import { DRAFT_REACH_METRES } from '@onyourleft/physics';

import type { HarnessCourse } from './courses';
import type { ScriptedRider } from './riders';
import type { RideScore } from './score';

/** A fixture course's name. */
export type CourseName = HarnessCourse['name'];

const ALL_COURSES: readonly CourseName[] = ['flat', 'hilly', 'rolling'];

/** One pass mark. */
export interface PassMark {
  /** A short word, as the table and the results file name it. */
  readonly mark: string;
  readonly rider: ScriptedRider;
  readonly courses: readonly CourseName[];
  /** Why the mark is there: printed beside it, never written to the results file. */
  readonly reason: string;
  /** The score held, or `null` where the ride has none, which is below the mark. */
  readonly scored: (score: RideScore) => number | null;
  /** The least the score may be; absent, no least. */
  readonly least?: number;
  /** The most the score may be; absent, no most. */
  readonly most?: number;
}

/**
 * The longest a rider who never presses may be on the front, seconds: **45**,
 * the rider's pull (`ROTATION_RIDER_PULL_MS`, 30 s), its grace
 * (`ROTATION_RIDER_GRACE_MS`, 10 s) and the fade's dwell
 * (`ROTATION_FADE_DWELL_MS`, 5 s) as they stand. Written as a number and not
 * summed from them, so that a change to the rotation that keeps a rider on
 * the front longer goes red here rather than moving the mark with it;
 * `score.test.ts` says when the three no longer add up to it.
 */
export const STUCK_ON_FRONT_SECONDS = 45;

/**
 * The longest a rider who presses on time is on the front, seconds: **31**,
 * the rider's pull (`ROTATION_RIDER_PULL_MS`, 30 s) and the one decision
 * window the press waits for. A number, for the reason
 * {@link STUCK_ON_FRONT_SECONDS} is one.
 */
export const ON_TIME_PULL_SECONDS = 31;

/**
 * The longest a rider the group waits for may be beyond the draft's reach,
 * seconds: **20**, the recovery time `@onyourleft/physics`
 * §`group-no-drop.test.ts` states for #3301's rider at 60 %.
 */
export const RECOVERY_SECONDS = 20;

/** The marks. See the file comment's table. */
export const PASS_MARKS: readonly PassMark[] = [
  ...(['weak', 'absent'] as const).map((rider): PassMark => ({
    mark: 'finishes-with-group',
    rider,
    courses: ALL_COURSES,
    reason:
      "owner ruling 3, no-drop with no lower limit: a rider at 60 % of the group's power, or one who stops for minutes, finishes with the group",
    scored: (score) => score.finishBehindM,
    most: DRAFT_REACH_METRES,
  })),
  ...(['weak', 'absent'] as const).map((rider): PassMark => ({
    mark: 'stays-in-reach',
    rider,
    courses: ALL_COURSES,
    reason:
      'owner ruling 3, the group waits with no lower limit: the rider is never beyond the draft reach for longer than the recovery time of #3301, a stop of minutes included',
    scored: (score) => score.longestBeyondReachSeconds,
    most: RECOVERY_SECONDS,
  })),
  {
    mark: 'makes-the-average',
    rider: 'steady',
    courses: ['hilly'],
    reason:
      'owner ruling 1, a true ride average: the group makes the speed asked over a hilly course to within 1 %, holding steadier effort on the climb',
    scored: (score) =>
      score.averageOffPercent === null ? null : Math.abs(score.averageOffPercent),
    most: 1,
  },
  {
    mark: 'takes-a-pull',
    rider: 'never-presses',
    courses: ALL_COURSES,
    reason: 'a rider who never presses still comes to the front in turn',
    scored: (score) => score.riderPulls,
    least: 1,
  },
  {
    mark: 'not-stuck-on-front',
    rider: 'never-presses',
    courses: ALL_COURSES,
    reason:
      'ADR 0101, nobody is kept on the front: a rider who fades without pressing is passed by the line within the pull, its grace and the fade dwell',
    scored: (score) => score.riderLongestPullSeconds,
    most: STUCK_ON_FRONT_SECONDS,
  },
  {
    mark: 'surging-said',
    rider: 'surger',
    courses: ['flat', 'hilly'],
    reason: '#3302: a rider who lifts on the front is told to hold the speed',
    scored: (score) => score.corrections.surging,
    least: 1,
  },
  {
    mark: 'pulls-on-time',
    rider: 'steady',
    courses: ALL_COURSES,
    reason:
      "ADR 0101 D-3.7, the rider's press: a rider who presses pull off when the pull's time is up is off the front within a window of it",
    scored: (score) => score.riderLongestPullSeconds,
    most: ON_TIME_PULL_SECONDS,
  },
  {
    mark: 'no-correction',
    rider: 'steady',
    courses: ALL_COURSES,
    reason: '#3302 bandwidth: a rider who holds the wheel and pulls on time is never corrected',
    scored: (score) => score.correctionsAll,
    most: 0,
  },
  {
    mark: 'cue-ceiling',
    rider: 'steady',
    courses: ALL_COURSES,
    reason:
      "#3302's ceiling: a clean rider hears no more cues a minute than this, so the ride does not nag",
    scored: (score) => score.cuesPerMinute,
    most: CUE_CEILING_PER_MINUTE,
  },
];

/** A mark held against one ride's scores. */
export interface MarkResult {
  readonly mark: string;
  readonly rider: ScriptedRider;
  readonly course: CourseName;
  readonly scored: number | null;
  readonly least: number | null;
  readonly most: number | null;
  readonly passed: boolean;
}

/** Whether `scored` holds `mark`. */
export function holds(mark: Pick<PassMark, 'least' | 'most'>, scored: number | null): boolean {
  if (scored === null || !Number.isFinite(scored)) return false;
  if (mark.least !== undefined && scored < mark.least) return false;
  if (mark.most !== undefined && scored > mark.most) return false;
  return true;
}

/** The marks asked of `rider` on `course`. */
export function marksFor(rider: ScriptedRider, course: CourseName): readonly PassMark[] {
  return PASS_MARKS.filter((each) => each.rider === rider && each.courses.includes(course));
}

/** Every mark asked of `rider` on `course`, held against `score`. */
export function markRide(rider: ScriptedRider, course: CourseName, score: RideScore): MarkResult[] {
  return marksFor(rider, course).map((each) => {
    const scored = each.scored(score);
    return {
      mark: each.mark,
      rider,
      course,
      scored,
      least: each.least ?? null,
      most: each.most ?? null,
      passed: holds(each, scored),
    };
  });
}
