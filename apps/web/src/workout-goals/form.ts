// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workout goals form's pure core (#1237): what was typed, turned into
 * typed goals or into one refusal, and goals turned back into what the form
 * shows.
 *
 * The goals are checked by `@onyourleft/domain` §`readWorkoutGoals` — the one
 * check the store runs on the way in and out and a sync runs on a pulled body —
 * so the screen cannot admit a set the store would refuse. This module only
 * turns text into numbers first, and names the box a refusal belongs to.
 *
 * A blank box is no goal, never a default (ADR 0048 D-10).
 */

import { readWorkoutGoals, type WorkoutGoals, type WorkoutSessionType } from '@onyourleft/domain';

import { percentToShare } from '../workouts/build';
import { fieldRefusal, POWER_CEILING_CONSTRAINT, type GoalField } from './wording';

/** What the form holds: text as typed, a session type or `''`, and a tick. */
export interface WorkoutGoalsForm {
  readonly sessionType: WorkoutSessionType | '';
  readonly durationMinutes: string;
  readonly holdLow: string;
  readonly holdHigh: string;
  readonly heartRateAbove: string;
  /** A percentage of threshold, as typed. */
  readonly powerCeiling: string;
  readonly timeInRangeMinutes: string;
  readonly effortCheckIns: boolean;
}

/** An empty form: no goal at all. */
export const EMPTY_GOALS_FORM: WorkoutGoalsForm = {
  sessionType: '',
  durationMinutes: '',
  holdLow: '',
  holdHigh: '',
  heartRateAbove: '',
  powerCeiling: '',
  timeInRangeMinutes: '',
  effortCheckIns: false,
};

/** The goals, or the box that is wrong and why. */
export type GoalsFromForm =
  | { readonly ok: true; readonly goals: WorkoutGoals }
  | { readonly ok: false; readonly field: GoalField; readonly message: string };

const asText = (value: number | undefined): string => (value === undefined ? '' : String(value));

/** What the form shows for saved goals. */
export function formFromGoals(goals: WorkoutGoals): WorkoutGoalsForm {
  return {
    sessionType: goals.sessionType ?? '',
    durationMinutes: asText(goals.durationMinutes),
    holdLow: asText(goals.holdRange?.low),
    holdHigh: asText(goals.holdRange?.high),
    heartRateAbove: asText(goals.heartRateAbove),
    // A share back to the percentage it was typed as, without float noise.
    powerCeiling:
      goals.powerCeiling === undefined ? '' : String(Math.round(goals.powerCeiling * 1000) / 10),
    timeInRangeMinutes: asText(goals.timeInRangeMinutes),
    effortCheckIns: goals.effortCheckIns === true,
  };
}

/** A box as a number, `undefined` when blank, and `NaN` (refused later) when not a number. */
function numberIn(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : Number(trimmed);
}

/** Which box a fault from `readWorkoutGoals` belongs to. */
const FIELD_OF: Readonly<Record<string, GoalField>> = {
  'workoutGoals.sessionType': 'sessionType',
  'workoutGoals.durationMinutes': 'durationMinutes',
  'workoutGoals.holdRange': 'holdHigh',
  'workoutGoals.holdRange.low': 'holdLow',
  'workoutGoals.holdRange.high': 'holdHigh',
  'workoutGoals.heartRateAbove': 'heartRateAbove',
  'workoutGoals.powerCeiling': 'powerCeiling',
  'workoutGoals.timeInRangeMinutes': 'timeInRangeMinutes',
  'workoutGoals.effortCheckIns': 'effortCheckIns',
};

/** What `percentToShare` calls the box in its own message, which is not shown. */
const FIELD_OF_LABEL = 'Most power';

/** The form as goals, or one refusal naming its box. Pure. */
export function goalsFromForm(form: WorkoutGoalsForm): GoalsFromForm {
  const raw: Record<string, unknown> = {};
  if (form.sessionType !== '') raw['sessionType'] = form.sessionType;
  raw['durationMinutes'] = numberIn(form.durationMinutes);
  const low = numberIn(form.holdLow);
  const high = numberIn(form.holdHigh);
  if (low !== undefined || high !== undefined) raw['holdRange'] = { low, high };
  raw['heartRateAbove'] = numberIn(form.heartRateAbove);
  if (form.powerCeiling.trim().length > 0) {
    // The one place a typed percentage becomes a share (`workouts/build.ts`).
    const share = percentToShare(form.powerCeiling, FIELD_OF_LABEL);
    if (share.status !== 'built') {
      return {
        ok: false,
        field: 'powerCeiling',
        message: fieldRefusal('powerCeiling', POWER_CEILING_CONSTRAINT),
      };
    }
    raw['powerCeiling'] = share.value;
  }
  raw['timeInRangeMinutes'] = numberIn(form.timeInRangeMinutes);
  if (form.effortCheckIns) raw['effortCheckIns'] = true;

  const reading = readWorkoutGoals(raw);
  if (reading.ok) return { ok: true, goals: reading.goals };
  const field = FIELD_OF[reading.fault.field] ?? 'sessionType';
  const constraint =
    field === 'powerCeiling' ? POWER_CEILING_CONSTRAINT : `${reading.fault.constraint}.`;
  return { ok: false, field, message: fieldRefusal(field, constraint) };
}

/** Whether a set of goals holds no goal at all. */
export function isNoGoal(goals: WorkoutGoals): boolean {
  return Object.keys(goals).length === 0;
}
