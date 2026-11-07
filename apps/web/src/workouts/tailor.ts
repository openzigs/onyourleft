// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tailoring a built-in on the Workouts screen — #2305, under the library epic
 * #2295: what the rider may change, what they typed made of it, and the
 * result in words, in watts and by zone.
 *
 * Pure, for `library.ts`'s reason: what the pane offers and says is decided
 * here and tested on its own.
 *
 * ## Every value comes from `tailorWorkout`
 *
 * This module computes no target. The rider's choices go to `tailorWorkout`
 * in `@onyourleft/domain` as they are, and either a workout comes back or a
 * refusal does, in the domain's own sentence ("… can be 41 or 52 minutes
 * long; you asked for 60 minutes."). A refusal is never clamped into a
 * workout here: the pane shows it beside the control that caused it and keeps
 * the last workout that was valid (the #1165 pattern).
 *
 * ## Watts only from the rider's own threshold
 *
 * A target is a share of threshold. With the rider's threshold power it is
 * also said in watts, rounded to the watt; without one no watt is invented
 * (`RideView.tsx`'s rule that an absent threshold stays absent). A block's
 * power zone is a label read off its share by `powerZones`
 * (`packages/domain/src/analysis/zones.ts`), which is the same with or without
 * a threshold, so it is named either way.
 */

import {
  powerZones,
  tailorWorkout,
  watts,
  WorkoutError,
  workoutBlockText,
  workoutDurationText,
  zoneOf,
  type ChoiceRange,
  type ChoiceRangeWithDefault,
  type TailorChoices,
  type Watts,
  type Workout,
  type WorkoutBlock,
  type WorkoutTemplate,
} from '@onyourleft/domain';

import { LENGTH_CHOICES } from './built-in';

/** What a template lets a rider change, and within what. */
export interface TailorOffer {
  /** Whether a length may be chosen: not for a workout ridden as written. */
  readonly length: boolean;
  /** The intensity offset's range in percent, or `undefined` where it is fixed. */
  readonly intensity: ChoiceRange | undefined;
  /** The repeat count's range and default, for a main set that repeats. */
  readonly repeats: ChoiceRangeWithDefault | undefined;
  /** The recovery between repeats in seconds, for a template that lets it change. */
  readonly recovery: ChoiceRangeWithDefault | undefined;
}

/** The offer a template makes. Bounds are the template's own, never wider. */
export function tailorOffer(template: WorkoutTemplate): TailorOffer {
  const set = template.mainSet;
  const allowed = template.parameters.intensityPercent;
  const recovery = set.scaling === 'repeat' ? set.recovery : undefined;
  return {
    length: set.scaling !== 'fixed',
    intensity: allowed.minimum === allowed.maximum ? undefined : allowed,
    repeats: set.scaling === 'repeat' ? set.repeats : undefined,
    recovery:
      recovery?.seconds === undefined
        ? undefined
        : { ...recovery.seconds, default: recovery.block.seconds },
  };
}

/** Which control a choice was made with. */
export type TailorControl = 'length' | 'intensity' | 'repeats' | 'recovery';

/**
 * What the rider has typed or chosen, as text: a box holds what was typed
 * until it is a valid choice, and a refusal keeps it there to be corrected.
 * An empty box is the template's own value.
 */
export interface TailorDraft {
  /** `''` for the template's own length, else one of `LENGTH_CHOICES`. */
  readonly length: string;
  readonly intensity: string;
  readonly repeats: string;
  readonly recovery: string;
}

export const EMPTY_TAILOR_DRAFT: TailorDraft = {
  length: '',
  intensity: '0',
  repeats: '',
  recovery: '',
};

/**
 * The draft a pane opens with — the owner's ruling of 2026-11-07 (d): the
 * template's own repeats and recovery IN the boxes, as values, rather than as
 * grey placeholders that read as a control switched off. Each is the
 * template's default, so the workout it makes is the template as written.
 */
export function initialTailorDraft(offer: TailorOffer): TailorDraft {
  return {
    ...EMPTY_TAILOR_DRAFT,
    repeats: offer.repeats === undefined ? '' : String(offer.repeats.default),
    recovery: offer.recovery === undefined ? '' : String(offer.recovery.default),
  };
}

/**
 * How many repeats a tailored workout of `template` holds, read off the
 * workout itself: what a chosen length chose. `undefined` for a template
 * whose main set does not repeat.
 *
 * `tailorWorkout` keeps one block for each block of the warm-up and the
 * cool-down (a length shortens them, never removes them), and the main set is
 * either one intervals block or the repetition written out each time.
 */
export function repeatsIn(template: WorkoutTemplate, workout: Workout): number | undefined {
  const set = template.mainSet;
  if (set.scaling !== 'repeat') return undefined;
  const main = workout.blocks.slice(
    template.warmUp.length,
    workout.blocks.length - template.coolDown.length,
  );
  const [only] = main;
  if (main.length === 1 && only?.kind === 'intervals') return only.repeats;
  const perRepeat = set.rep.length + (set.recovery === undefined ? 0 : 1);
  return Math.round(main.length / perRepeat);
}

/**
 * The preview's length, and why it is not the length chosen when it is not —
 * the owner's ruling of 2026-11-07: "47 min, the nearest with whole repeats".
 * A length is met with whole repeats, or by stretching blocks no further than
 * the template lets them go, so it can land beside the minutes asked for.
 */
export function lengthText(
  template: WorkoutTemplate,
  totalSeconds: number,
  chosen: string,
): string {
  const said = workoutDurationText(totalSeconds);
  const minutes = numberIn(chosen);
  if (minutes === undefined || said === workoutDurationText(minutes * 60)) return said;
  return template.mainSet.scaling === 'repeat'
    ? `${said}, the nearest with whole repeats`
    : `${said}, the nearest it stretches to`;
}

/**
 * One control changed, and what that does to the others: a length and a
 * repeat count cannot both be chosen (`tailorWorkout` refuses the pair,
 * because a length IS made by choosing the repeat count), so choosing either
 * lets go of the other rather than leaving the rider a refusal to untangle.
 */
export function withChoice(draft: TailorDraft, control: TailorControl, value: string): TailorDraft {
  switch (control) {
    case 'length':
      return { ...draft, length: value, repeats: value === '' ? draft.repeats : '' };
    case 'repeats':
      return { ...draft, repeats: value, length: value.trim() === '' ? draft.length : '' };
    case 'intensity':
      return { ...draft, intensity: value };
    case 'recovery':
      return { ...draft, recovery: value };
  }
}

export type TailorOutcome =
  | { readonly status: 'tailored'; readonly workout: Workout }
  | {
      readonly status: 'refused';
      readonly message: string;
      /**
       * The control the refusal belongs beside, when it can be told from the
       * draft alone; absent for a refusal of the choices together.
       */
      readonly control?: TailorControl;
    };

/** A box's text as a number, `undefined` for empty, `NaN` for anything else. */
function numberIn(text: string): number | undefined {
  // A minus sign as typography writes it, and a comma decimal, both as typed on a phone.
  const trimmed = text.trim().replace('−', '-').replace(',', '.');
  return trimmed === '' ? undefined : Number(trimmed);
}

/** The words for a box that holds no number, by control. */
const NOT_A_NUMBER: Readonly<Record<Exclude<TailorControl, 'length'>, string>> = {
  intensity: 'Type the intensity as a number of percent, such as −5 or 5.',
  repeats: 'Type the number of repeats as a whole number.',
  recovery: 'Type the recovery as a number of seconds.',
};

/**
 * The rider's choices as `tailorWorkout` takes them, or the box that holds
 * something that is not a number.
 */
function choicesFrom(
  draft: TailorDraft,
  thresholdHeartRate: number | undefined,
): TailorChoices | { readonly control: TailorControl; readonly message: string } {
  const values = {
    intensity: numberIn(draft.intensity),
    repeats: numberIn(draft.repeats),
    recovery: numberIn(draft.recovery),
  };
  for (const control of ['intensity', 'repeats', 'recovery'] as const) {
    if (Number.isNaN(values[control])) {
      return { control, message: NOT_A_NUMBER[control] };
    }
  }
  const length = numberIn(draft.length);
  return {
    ...(length === undefined ? {} : { targetMinutes: length }),
    ...(values.intensity === undefined ? {} : { intensityPercent: values.intensity }),
    ...(values.repeats === undefined ? {} : { repeats: values.repeats }),
    ...(values.recovery === undefined ? {} : { recoverySeconds: values.recovery }),
    ...(thresholdHeartRate === undefined ? {} : { thresholdHeartRate }),
  };
}

/** `"the intensity of …"` → `"The intensity of …"`. */
function sentence(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/**
 * The workout the rider's choices make, or the domain's refusal of them.
 *
 * The rider's own threshold heart rate, when they have one, turns each
 * heart-rate zone hold into a range in beats per minute; without one a zone
 * hold rides as its steady fallback, as `tailorWorkout` says.
 */
export function tailorFromDraft(
  template: WorkoutTemplate,
  draft: TailorDraft,
  thresholdHeartRate?: number,
): TailorOutcome {
  const choices = choicesFrom(draft, thresholdHeartRate);
  if ('message' in choices) {
    return { status: 'refused', message: choices.message, control: choices.control };
  }
  try {
    return { status: 'tailored', workout: tailorWorkout(template, choices) };
  } catch (error) {
    if (error instanceof WorkoutError) {
      const control = refusedControl(template, draft, thresholdHeartRate);
      return {
        status: 'refused',
        message: sentence(error.message),
        ...(control === undefined ? {} : { control }),
      };
    }
    throw error;
  }
}

/**
 * The control a domain refusal belongs to: the first whose choice is refused
 * when it is the only one made. The domain's refusal is one error code for
 * every choice, and the draft as a whole is refused whichever control the
 * rider touched last, so the control is found by asking about each alone.
 */
function refusedControl(
  template: WorkoutTemplate,
  draft: TailorDraft,
  thresholdHeartRate: number | undefined,
): TailorControl | undefined {
  for (const control of ['length', 'intensity', 'repeats', 'recovery'] as const) {
    const alone = { ...EMPTY_TAILOR_DRAFT, [control]: draft[control] };
    const choices = choicesFrom(alone, thresholdHeartRate);
    if ('message' in choices) continue;
    try {
      tailorWorkout(template, choices);
    } catch (error) {
      if (error instanceof WorkoutError) return control;
      throw error;
    }
  }
  return undefined;
}

/** One block of the preview, in words. */
export interface PreviewRow {
  /** The block as `workoutBlockText` says it, in shares of threshold. */
  readonly text: string;
  /** Its targets in watts, from the rider's threshold; absent without one. */
  readonly power?: string;
  /** The power zone its targets fall in, by number and name. */
  readonly zone?: string;
  /** What else a rider needs to know about the block. */
  readonly note?: string;
}

/** Zone boundaries in shares: `powerZones` at a threshold of one watt. */
const SHARE_ZONES = powerZones(watts(1));

/** `0.9` → `"zone 3 Tempo"`. */
function zoneText(share: number): string {
  const zone = zoneOf(SHARE_ZONES, share);
  return zone === undefined ? '' : `zone ${String(zone.index)} ${zone.name}`;
}

/** The zone of each target, said once each: `"zone 1 Recovery to zone 2 Endurance"`. */
function zonesText(shares: readonly number[], joiner: string): string {
  const named = [...new Set(shares.map(zoneText))].filter((text) => text !== '');
  return named.join(joiner);
}

/** A share of a threshold, in whole watts. */
function wattsText(share: number, threshold: Watts): string {
  return `${String(Math.round(share * threshold))} W`;
}

/** One block in words, with its watts when there is a threshold and its zone. */
export function previewRow(block: WorkoutBlock, threshold: Watts | undefined): PreviewRow {
  const text = workoutBlockText(block);
  switch (block.kind) {
    case 'steady':
      return {
        text,
        ...(threshold === undefined ? {} : { power: wattsText(block.target, threshold) }),
        zone: zoneText(block.target),
      };
    case 'ramp':
      return {
        text,
        ...(threshold === undefined
          ? {}
          : {
              power: `${wattsText(block.from, threshold)} to ${wattsText(block.to, threshold)}`,
            }),
        zone: zonesText([block.from, block.to], ' to '),
      };
    case 'intervals':
      return {
        text,
        ...(threshold === undefined
          ? {}
          : {
              power:
                `${wattsText(block.hardTarget, threshold)}, ` +
                `then ${wattsText(block.easyTarget, threshold)}`,
            }),
        zone: zonesText([block.hardTarget, block.easyTarget], ', then '),
      };
    case 'free-ride':
      return { text, note: 'The trainer is released.' };
    case 'heart-rate-hold':
      // No watts and no zone: the target moves to keep the heart rate in range
      // (ADR 0048 D-3), so any figure here would be one the trainer is not told.
      return { text, note: 'Needs a heart-rate strap.' };
  }
}

/** Every block of the preview, in order. */
export function previewRows(workout: Workout, threshold: Watts | undefined): readonly PreviewRow[] {
  return workout.blocks.map((block) => previewRow(block, threshold));
}

/** A length choice as the select says it. */
export function lengthOptionText(minutes: number): string {
  return `${String(minutes)} min`;
}

/** The lengths a rider may ask for: the five every library is browsed by. */
export const TAILOR_LENGTHS: readonly number[] = LENGTH_CHOICES;

/**
 * The name a saved copy is given: the template's, with its length and any
 * intensity, so two copies of one template read apart in the list —
 * "Sweet spot, two by twenty (45 min, −5%)".
 */
export function copyName(
  template: WorkoutTemplate,
  totalSeconds: number,
  draft: TailorDraft,
): string {
  const intensity = numberIn(draft.intensity) ?? 0;
  const parts = [workoutDurationText(totalSeconds)];
  if (intensity !== 0) {
    parts.push(intensity > 0 ? `+${String(intensity)}%` : `−${String(-intensity)}%`);
  }
  return `${template.name} (${parts.join(', ')})`;
}
