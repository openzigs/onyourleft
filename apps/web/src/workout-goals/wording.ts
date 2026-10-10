// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every sentence the workout goals screen shows (#1237), in one module.
 *
 * ADR 0048 D-12 (the owner's Q12), and #1233 §8: a heart rate here is *the
 * range you chose*, never a limit for health or safety, and no sentence says
 * *safe*, *cardiac*, *heart condition*, *patient* or *therapy*.
 * `form.test.ts` §'the wording (ADR 0048 D-12)' holds every string here to that list.
 *
 * Every sentence here is the wording the owner approved on 2026-10-10 (on
 * #1259), the sync disclosure ({@link WORKOUT_GOALS_SYNC_TEXT}) included.
 */

import type { WorkoutSessionType } from '@onyourleft/domain';

/** The card's title in Settings. */
export const WORKOUT_GOALS_CARD_TITLE = 'Your workout goals';

/** The section's heading. */
export const WORKOUT_GOALS_HEADING = 'Workout goals';

/** What these goals are, kept beside the form: what they do and what they are not. */
export const WORKOUT_GOALS_LEAD =
  'Goals you choose for a workout. A heart-rate hold stays inside them. Leave a box blank for no goal.';

/**
 * Where they are kept and what a sync does with them — a disclosure, so never
 * tucked away: Settings' `SETTINGS_KEPT_VISIBLE` lists each sentence.
 */
export const WORKOUT_GOALS_KEPT_VISIBLE: readonly string[] = [
  'They are kept on this device.',
  'If you sync with an instance, they are sent to it sealed, so another of your devices can use them.',
];

/** The two sentences as the screen shows them. */
export const WORKOUT_GOALS_SYNC_TEXT = WORKOUT_GOALS_KEPT_VISIBLE.join(' ');

/** The ⓘ's longer explanation. */
export const WORKOUT_GOALS_HELP: readonly string[] = [
  'These are not the goals you write in words for the analysis. Those never change a number in a workout; these can.',
  'Your own threshold power and threshold heart rate are checked when a workout uses these goals, not here, because you can change them later.',
];

/** One field's label and the sentence under it, which is its description. */
export interface FieldWords {
  readonly label: string;
  readonly hint: string;
}

export const FIELD_WORDS = {
  sessionType: {
    label: 'Kind of session',
    hint: 'The kind of ride you want. On its own it sets no number.',
  },
  durationMinutes: {
    label: 'Length (minutes)',
    hint: 'How long you want the whole workout to be, from 10 to 300 minutes.',
  },
  holdLow: {
    label: 'Heart-rate range, lowest (bpm)',
    hint: 'The lowest heart rate of the range you want a heart-rate hold to keep you in.',
  },
  holdHigh: {
    label: 'Heart-rate range, highest (bpm)',
    hint: 'The highest heart rate of that range. The range is at least 6 beats per minute wide.',
  },
  heartRateAbove: {
    label: 'Do not go above (bpm)',
    hint: 'The highest heart rate you want a heart-rate hold to aim for. It is your choice, not a health limit.',
  },
  powerCeiling: {
    label: 'Most power (% of your threshold)',
    hint: 'The most power a heart-rate hold may ask of you, as a share of your own threshold power. At most 85%.',
  },
  timeInRangeMinutes: {
    label: 'Time in your range (minutes)',
    hint: 'How many minutes you want to spend inside the range you chose.',
  },
  effortCheckIns: {
    label: 'Ask me how hard it feels between blocks',
    hint: 'A tap from 1 to 5 between blocks, never during one.',
  },
} as const satisfies Record<string, FieldWords>;

/** A field of the form, by the key its words are under. */
export type GoalField = keyof typeof FIELD_WORDS;

/** The choice that means "no goal" in the session list. */
export const NO_SESSION_TYPE = 'No goal';

/** Each session type's name in the list. */
export const SESSION_TYPE_NAMES: Readonly<Record<WorkoutSessionType, string>> = {
  endurance: 'Endurance',
  tempo: 'Tempo',
  intervals: 'Intervals',
  recovery: 'Recovery',
};

/** The two controls. */
export const SAVE_GOALS = 'Save workout goals';
export const CLEAR_GOALS = 'Clear workout goals';

/** What the rider is told after each thing they can do. */
export const GOALS_SAVED = 'Your workout goals are saved.';
export const GOALS_CLEARED = 'Your workout goals are cleared. No goal is in use.';
export const GOALS_READING = 'Reading your workout goals…';
export const GOALS_NO_STORE =
  'This browser has no local store, so goals chosen here would be forgotten as soon as the page reloaded.';
export const GOALS_NOT_READ =
  'Your workout goals could not be read on this device, so none are in use. Save new ones to replace them.';

/** A save that failed: what was saved before is unchanged. */
export function goalsSaveFailure(reason: string): string {
  return `Your workout goals could not be saved, so what you saved before is unchanged: ${reason}`;
}

/** A clear that failed: what was saved before is unchanged. */
export function goalsClearFailure(reason: string): string {
  return `Your workout goals could not be cleared, so what you saved before is unchanged: ${reason}`;
}

/** A refusal for one field: its label and what it must be. */
export function fieldRefusal(field: GoalField, constraint: string): string {
  return `${FIELD_WORDS[field].label}: ${constraint}`;
}

/** The power ceiling's refusal, in the percentage the rider typed rather than a share. */
export const POWER_CEILING_CONSTRAINT = 'must be from 20% to 85% of your own threshold power.';
