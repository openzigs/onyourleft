// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Building a workout from what a rider typed — #14.
 *
 * Pure, and separate from the view for `routes/save.ts`'s reason: every refusal
 * here is a decision about what a rider is allowed to ask a trainer for, and a
 * decision embedded in a submit handler is one that gets asserted by simulating
 * clicks.
 *
 * ## ⚠️ This is where a percentage becomes a share, and it is the whole file
 *
 * A rider types **`110`** into a box labelled "% of threshold". A trainer is
 * asked for **`1.1 × threshold`**. Those are the same instruction and a factor
 * of a hundred apart, and getting the conversion backwards produces a number
 * that passes every type in the program — `110` is a perfectly good
 * `ThresholdShare` as far as arithmetic is concerned — and asks a machine for
 * a hundred and ten times the rider's threshold power.
 *
 * `thresholdShare()`'s own guard is what catches it, and this file is written
 * so that the guard is reached rather than bypassed: the division happens here,
 * once, and the constructor sees the result. There is no other path from the
 * form to a block.
 *
 * ## Why a builder exists at all
 *
 * There is no workout file format, and that is a decision rather than an
 * omission — ADR 0009 and CLAUDE.md §6 record why, and #202 is the issue that
 * settles it. Until then this is the only way a workout comes to exist, which
 * is why it validates like a decoder rather than like a form.
 */

import {
  seconds,
  thresholdShare,
  unixSeconds,
  validateWorkout,
  WorkoutError,
  type Workout,
  type WorkoutBlock,
} from '@onyourleft/domain';
import type { AthleteId, WorkoutId, WorkoutRecord } from '@onyourleft/store';

export interface BuildRefusal {
  readonly code:
    'name-required' | 'name-too-long' | 'no-blocks' | 'bad-duration' | 'bad-target' | 'bad-repeats';
  readonly message: string;
}

export type BuildOutcome<T> =
  | { readonly status: 'built'; readonly value: T }
  | { readonly status: 'refused'; readonly refusal: BuildRefusal };

function refuse<T>(code: BuildRefusal['code'], message: string): BuildOutcome<T> {
  return { status: 'refused', refusal: { code, message } };
}

/**
 * The longest name a workout may carry: **80 characters**.
 *
 * `checkName` in `routes/save.ts` uses the same number for the same reason —
 * it is a label, not a description, and a name that does not fit a row is one
 * the rider cannot tell apart from its neighbour in a list.
 */
export const MAXIMUM_NAME_LENGTH = 80;

/**
 * The longest a single block may last: **four hours**.
 *
 * A typo guard rather than a limit on ambition, in the spirit of
 * `MAXIMUM_SHARE`. What it catches is a duration typed in seconds into a box
 * labelled minutes — `90` meaning ninety minutes and `5400` meaning the same
 * thing are both plausible, and one of them typed into the wrong box is a
 * ninety-hour block. A rider who genuinely wants a five-hour steady block
 * writes two.
 */
export const MAXIMUM_BLOCK_SECONDS = 4 * 60 * 60;

/** @returns a refusal, or `undefined` for a usable name. */
export function checkName(name: string): BuildRefusal | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { code: 'name-required', message: 'Give this workout a name so you can find it again.' };
  }
  if (trimmed.length > MAXIMUM_NAME_LENGTH) {
    return {
      code: 'name-too-long',
      message: `A name can be at most ${String(MAXIMUM_NAME_LENGTH)} characters.`,
    };
  }
  return undefined;
}

/**
 * Minutes as typed → seconds.
 *
 * ⚠️ Fractions are accepted (`0.5` is thirty seconds) because a thirty-second
 * interval is an ordinary thing to want and a minutes box that refused it would
 * push riders into the wrong unit. What is refused is a value that is not a
 * number, is not positive, or is longer than {@link MAXIMUM_BLOCK_SECONDS}.
 */
export function minutesToSeconds(input: string, what: string): BuildOutcome<number> {
  const value = Number(input.trim());
  if (input.trim().length === 0 || !Number.isFinite(value)) {
    return refuse('bad-duration', `${what} needs a length in minutes.`);
  }
  const total = Math.round(value * 60);
  if (total <= 0) {
    return refuse('bad-duration', `${what} must last longer than zero.`);
  }
  if (total > MAXIMUM_BLOCK_SECONDS) {
    return refuse(
      'bad-duration',
      `${what} is longer than ${String(MAXIMUM_BLOCK_SECONDS / 3600)} hours. ` +
        'If you meant minutes rather than hours, check the number; a longer session is ' +
        'several blocks.',
    );
  }
  return { status: 'built', value: total };
}

/**
 * A percentage as typed → a share of threshold.
 *
 * ⚠️ **The division is here and nowhere else**, and `thresholdShare` sees the
 * result rather than the input. See this module's header: the same digits mean
 * two things a hundred apart, and only one of them is a rideable instruction.
 */
export function percentToShare(input: string, what: string): BuildOutcome<number> {
  const value = Number(input.trim());
  if (input.trim().length === 0 || !Number.isFinite(value)) {
    return refuse('bad-target', `${what} needs a percentage of your threshold.`);
  }
  try {
    return { status: 'built', value: thresholdShare(value / 100) };
  } catch (error) {
    if (error instanceof WorkoutError) {
      return refuse(
        'bad-target',
        `${what} of ${input.trim()}% is outside what this app will ask a trainer for. ` +
          'Targets run from 20% to 300% of your threshold.',
      );
    }
    throw error;
  }
}

/** What a builder form submits, before any of it has been checked. */
export interface BlockDraft {
  readonly kind: WorkoutBlock['kind'];
  readonly minutes: string;
  readonly percent: string;
  /** Ramp only. */
  readonly toPercent: string;
  /** Intervals only. */
  readonly repeats: string;
  readonly easyMinutes: string;
  readonly easyPercent: string;
  readonly label: string;
}

/** Every field blank — what a fresh form holds. */
export const EMPTY_DRAFT: BlockDraft = {
  kind: 'steady',
  minutes: '',
  percent: '',
  toPercent: '',
  repeats: '',
  easyMinutes: '',
  easyPercent: '',
  label: '',
};

/**
 * Turn one draft into a block, or say why not.
 *
 * ⚠️ Only the fields that block kind uses are read. A rider who fills in a
 * ramp's second target and then switches the block to steady does not get a
 * refusal about a field that is no longer on the form — which is the failure a
 * "validate everything" pass produces, and it is unfixable from the rider's
 * side because they cannot see the box any more.
 */
export function blockFromDraft(draft: BlockDraft): BuildOutcome<WorkoutBlock> {
  const label = draft.label.trim();
  const withLabel = <T extends object>(block: T): T => (label === '' ? block : { ...block, label });

  switch (draft.kind) {
    case 'steady': {
      const length = minutesToSeconds(draft.minutes, 'This block');
      if (length.status === 'refused') return length;
      const target = percentToShare(draft.percent, 'The target');
      if (target.status === 'refused') return target;
      return {
        status: 'built',
        value: withLabel({
          kind: 'steady',
          seconds: seconds(length.value),
          target: thresholdShare(target.value),
        }) as WorkoutBlock,
      };
    }
    case 'free-ride': {
      const length = minutesToSeconds(draft.minutes, 'This block');
      if (length.status === 'refused') return length;
      return {
        status: 'built',
        value: withLabel({ kind: 'free-ride', seconds: seconds(length.value) }) as WorkoutBlock,
      };
    }
    case 'ramp': {
      const length = minutesToSeconds(draft.minutes, 'This block');
      if (length.status === 'refused') return length;
      const from = percentToShare(draft.percent, 'The starting target');
      if (from.status === 'refused') return from;
      const to = percentToShare(draft.toPercent, 'The finishing target');
      if (to.status === 'refused') return to;
      return {
        status: 'built',
        value: withLabel({
          kind: 'ramp',
          seconds: seconds(length.value),
          from: thresholdShare(from.value),
          to: thresholdShare(to.value),
        }) as WorkoutBlock,
      };
    }
    case 'intervals': {
      const repeats = Number(draft.repeats.trim());
      if (!Number.isInteger(repeats) || repeats < 1) {
        return refuse('bad-repeats', 'How many times? A whole number, at least one.');
      }
      const hard = minutesToSeconds(draft.minutes, 'The hard interval');
      if (hard.status === 'refused') return hard;
      const hardTarget = percentToShare(draft.percent, 'The hard target');
      if (hardTarget.status === 'refused') return hardTarget;
      const easy = minutesToSeconds(draft.easyMinutes, 'The recovery');
      if (easy.status === 'refused') return easy;
      const easyTarget = percentToShare(draft.easyPercent, 'The recovery target');
      if (easyTarget.status === 'refused') return easyTarget;
      return {
        status: 'built',
        value: withLabel({
          kind: 'intervals',
          repeats,
          hardSeconds: seconds(hard.value),
          hardTarget: thresholdShare(hardTarget.value),
          easySeconds: seconds(easy.value),
          easyTarget: thresholdShare(easyTarget.value),
        }) as WorkoutBlock,
      };
    }
    default: {
      const unhandled: never = draft.kind;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

export interface SaveInput {
  readonly id: WorkoutId;
  readonly owner: AthleteId;
  readonly name: string;
  readonly blocks: readonly WorkoutBlock[];
  /** Seconds since the epoch. */
  readonly now: number;
  /** The record being replaced, if this is an edit rather than a new workout. */
  readonly existing?: WorkoutRecord | undefined;
}

/**
 * Assemble a record, or say why not.
 *
 * ⚠️ **It calls `validateWorkout` even though every block came from
 * `blockFromDraft`.** Not belt and braces: this is the function the *store*
 * will call on the way back out, and a record that could not survive its own
 * read is one this screen should refuse to write. A workout with no blocks is
 * the case that actually reaches here — a rider who names a workout and saves
 * before adding anything.
 */
export function workoutToSave(input: SaveInput): BuildOutcome<WorkoutRecord> {
  const nameFault = checkName(input.name);
  if (nameFault !== undefined) {
    return { status: 'refused', refusal: nameFault };
  }
  const name = input.name.trim();
  const workout: Workout = { name, blocks: [...input.blocks] };
  try {
    validateWorkout(workout);
  } catch (error) {
    if (error instanceof WorkoutError) {
      return refuse(
        error.code === 'empty-workout' ? 'no-blocks' : 'bad-target',
        error.code === 'empty-workout' ? 'Add at least one block before saving.' : error.message,
      );
    }
    throw error;
  }

  return {
    status: 'built',
    value: {
      id: input.existing?.id ?? input.id,
      createdBy: input.owner,
      name,
      workout,
      // ⚠️ An edit keeps the ORIGINAL creation time. A save that stamped both
      // fields would reorder the library on every rename, so a rider's oldest
      // workout would jump to the top the moment they fixed a typo in its name.
      createdAt: input.existing?.createdAt ?? unixSeconds(Math.floor(input.now)),
      updatedAt: unixSeconds(Math.floor(input.now)),
    },
  };
}
