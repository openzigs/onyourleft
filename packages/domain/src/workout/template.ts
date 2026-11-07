// SPDX-License-Identifier: Apache-2.0

/**
 * A built-in workout a rider tailors — #2298, under the library epic #2295.
 *
 * ## A template is code, not a file format
 *
 * A template is a TypeScript constant shipped in the app. {@link tailorWorkout}
 * turns one, plus the rider's choices, into an ordinary {@link Workout}: the
 * thing the player rides, the store saves and `format.ts` writes. So a
 * template adds **no** format version, no stored field and no migration — a
 * tailored workout is indistinguishable from one a rider built by hand, and
 * everything that already reads a workout reads it unchanged.
 *
 * ## Targets are shares of threshold, never zones
 *
 * The owner's ruling R-2 on #2295 (2026-11-06): a template's blocks carry
 * {@link ThresholdShare}s exactly as any workout does, and a zone is a label a
 * screen derives from the share. The zone model can then never change what a
 * trainer is told.
 *
 * ## Refuse, never clamp
 *
 * A choice outside what a template allows is refused with a sentence naming
 * the bound, and so is a choice that would push a target past what
 * `validateWorkout` accepts. A clamp would hand the rider a different workout
 * from the one they chose, against a machine applying resistance to them
 * (`CLAUDE.md` §6). ⚠️ **The output is re-validated by `validateWorkout` and
 * by nothing else**: the range checks on targets, durations and repeat counts
 * live there once, with their own wording, and this module does not keep a
 * second copy that could drift from them — the same shape/meaning split
 * `format.ts` follows. What this module checks is only what `validateWorkout`
 * cannot know: the bounds a template puts on a rider's *choices*.
 */

import type { Seconds } from '../quantities';

import { WorkoutError } from './errors';
import {
  MAXIMUM_REPEATS,
  validateWorkout,
  type SteadyBlock,
  type ThresholdShare,
  type Workout,
  type WorkoutBlock,
} from './workout';

/** What kind of session a template is, for browsing. Labels, never targets. */
export type WorkoutCategory =
  | 'recovery'
  | 'endurance'
  | 'tempo'
  | 'sweet-spot'
  | 'threshold'
  | 'over-under'
  | 'vo2'
  | 'anaerobic'
  | 'sprint'
  | 'pyramid'
  | 'cadence'
  | 'race-simulation'
  | 'test';

/**
 * The lowest intensity offset any template may allow, in percent: −25 %.
 * The owner's ruling on #2295, question 2 (2026-11-06).
 */
export const MINIMUM_INTENSITY_PERCENT = -25;

/**
 * The highest intensity offset any template may allow, in percent: +10 %.
 * The owner's ruling on #2295, question 2 (2026-11-06). ADR 0048 already
 * allows +5 % a move mid-ride; this is the before-the-ride bound.
 */
export const MAXIMUM_INTENSITY_PERCENT = 10;

/** An inclusive range a rider's choice must fall inside. */
export interface ChoiceRange {
  readonly minimum: number;
  readonly maximum: number;
}

/** A range with the value a rider who chose nothing gets. */
export interface ChoiceRangeWithDefault extends ChoiceRange {
  readonly default: number;
}

/**
 * A main set ridden as a number of repetitions: an interval session.
 *
 * Each repetition is {@link rep}, then {@link recovery} when there is one —
 * **including after the last**, the convention `IntervalsBlock` already
 * follows (`timeline.ts` §`expandBlock`), so that "5 ×" means five of each.
 * The cool-down follows the final recovery.
 */
export interface RepeatMainSet {
  readonly scaling: 'repeat';
  /** One repetition's work, in order. */
  readonly rep: readonly WorkoutBlock[];
  /** How many repetitions the rider may choose, and how many they get. */
  readonly repeats: ChoiceRangeWithDefault;
  /** The easy riding after each repetition, when the set has any. */
  readonly recovery?: Recovery | undefined;
}

/**
 * The recovery between repetitions. Its own `seconds` is the default length;
 * {@link seconds}, when present, is how far a rider may change it. Absent, the
 * recovery's length is part of the session and a choice of it is refused.
 */
export interface Recovery {
  readonly block: SteadyBlock;
  readonly seconds?: ChoiceRange | undefined;
}

/**
 * A main set whose blocks are ridden as written: a test, or anything else
 * with no repeat count to choose. Its targets still take the intensity offset
 * when the template's bounds allow one.
 */
export interface FixedMainSet {
  readonly scaling: 'fixed';
  readonly blocks: readonly WorkoutBlock[];
}

/** The part of a template that its parameters act on. */
export type MainSet = RepeatMainSet | FixedMainSet;

/** The knobs a template offers on every main set. */
export interface TemplateParameters {
  /**
   * The intensity offset a rider may choose, in percent; the default is 0.
   * Only the part inside {@link MINIMUM_INTENSITY_PERCENT}..
   * {@link MAXIMUM_INTENSITY_PERCENT} is ever offered: a template that names
   * a wider range is narrowed to the global one, not trusted past it.
   */
  readonly intensityPercent: ChoiceRange;
}

/** A built-in workout with named, bounded parameters. */
export interface WorkoutTemplate {
  /** A stable slug, e.g. `steady-climb-2x20`. */
  readonly id: string;
  /** Our own name (#2296: never another product's). */
  readonly name: string;
  /** One sentence, in our own words. Becomes the workout's description. */
  readonly summary: string;
  readonly category: WorkoutCategory;
  readonly warmUp: readonly WorkoutBlock[];
  readonly mainSet: MainSet;
  readonly coolDown: readonly WorkoutBlock[];
  readonly parameters: TemplateParameters;
}

/** What a rider chose. Every field absent means the template as written. */
export interface TailorChoices {
  /** An offset to every main-set power target, in percent: −10 or +5. */
  readonly intensityPercent?: number | undefined;
  /** How many repetitions, for a template whose main set repeats. */
  readonly repeats?: number | undefined;
  /** The recovery between repetitions, for a template that lets it change. */
  readonly recoverySeconds?: number | undefined;
}

/**
 * Turn a template and a rider's choices into an ordinary, validated workout.
 *
 * Total: it returns a workout `validateWorkout` accepts, or throws.
 *
 * - **Intensity** multiplies every power target in the main set by
 *   `1 + intensityPercent / 100`. It does not touch a free ride (no target),
 *   a heart-rate hold (its 0.85 ceiling is ADR 0048 D-3; `replan.ts` keeps
 *   the same rule) or the warm-up and cool-down.
 * - **Repeats** and **recovery** apply only where the main set declares them.
 *   A choice a template does not offer is refused rather than ignored: a
 *   rider who asked for three repeats and silently got the template's count
 *   was not told the truth about what they will ride.
 *
 * @throws {WorkoutError} `invalid-choice` for a choice outside the template's
 * bounds, or one it does not offer; anything `validateWorkout` refuses —
 * notably `target-out-of-range` for an offset that takes a target past
 * `MAXIMUM_SHARE`, which is refused and never clamped.
 */
export function tailorWorkout(template: WorkoutTemplate, choices: TailorChoices): Workout {
  const percent = intensityChoice(template, choices.intensityPercent);
  const main = mainSetBlocks(template.mainSet, choices).map((block) => offsetBlock(block, percent));
  return validateWorkout({
    name: template.name,
    description: template.summary,
    blocks: [...template.warmUp, ...main, ...template.coolDown],
  });
}

/** The offset to apply, after checking it against the template's bounds. */
function intensityChoice(template: WorkoutTemplate, value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const allowed = template.parameters.intensityPercent;
  const minimum = Math.max(allowed.minimum, MINIMUM_INTENSITY_PERCENT);
  const maximum = Math.min(allowed.maximum, MAXIMUM_INTENSITY_PERCENT);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new WorkoutError(
      'invalid-choice',
      minimum === maximum
        ? `"${template.name}" is ridden at the intensity it is written at, so its intensity ` +
            `cannot be set; you asked for ${signedPercent(value)}.`
        : `the intensity of "${template.name}" can be set from ${signedPercent(minimum)} to ` +
            `${signedPercent(maximum)}; you asked for ${signedPercent(value)}.`,
    );
  }
  return value;
}

/** The main set as blocks, with the rider's repeat and recovery choices. */
function mainSetBlocks(set: MainSet, choices: TailorChoices): readonly WorkoutBlock[] {
  if (set.scaling === 'fixed') {
    if (choices.repeats !== undefined) {
      throw new WorkoutError(
        'invalid-choice',
        'this workout has no repeat count to choose; it is ridden as written.',
      );
    }
    if (choices.recoverySeconds !== undefined) {
      throw new WorkoutError(
        'invalid-choice',
        'this workout has no recovery between repeats to change; it is ridden as written.',
      );
    }
    return set.blocks;
  }
  const repeats = repeatChoice(set, choices.repeats);
  const recovery = recoveryBlock(set, choices.recoverySeconds);
  return repeatBlocks(set.rep, recovery, repeats);
}

function repeatChoice(set: RepeatMainSet, value: number | undefined): number {
  if (value === undefined) {
    return set.repeats.default;
  }
  const minimum = Math.max(set.repeats.minimum, 1);
  const maximum = Math.min(set.repeats.maximum, MAXIMUM_REPEATS);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new WorkoutError(
      'invalid-choice',
      `this workout can be ridden with ${String(minimum)} to ${String(maximum)} repeats, ` +
        `as a whole number; you asked for ${String(value)}.`,
    );
  }
  return value;
}

function recoveryBlock(set: RepeatMainSet, value: number | undefined): SteadyBlock | undefined {
  const recovery = set.recovery;
  if (value === undefined) {
    return recovery?.block;
  }
  const allowed = recovery?.seconds;
  if (recovery === undefined || allowed === undefined) {
    throw new WorkoutError(
      'invalid-choice',
      'this workout does not let its recovery between repeats change.',
    );
  }
  if (!Number.isFinite(value) || value < allowed.minimum || value > allowed.maximum) {
    throw new WorkoutError(
      'invalid-choice',
      `this workout's recovery between repeats can be ${String(allowed.minimum)} to ` +
        `${String(allowed.maximum)} seconds; you asked for ${String(value)}.`,
    );
  }
  return { ...recovery.block, seconds: value as Seconds };
}

/**
 * The repetitions as blocks.
 *
 * A repetition of one steady block with a recovery is written as one
 * `intervals` block — the same riding, and the shape a rider reads as
 * "5 × 3 min at 120 %" rather than ten rows. Anything else is written out.
 */
function repeatBlocks(
  rep: readonly WorkoutBlock[],
  recovery: SteadyBlock | undefined,
  repeats: number,
): readonly WorkoutBlock[] {
  const [only] = rep;
  if (rep.length === 1 && only?.kind === 'steady' && recovery !== undefined) {
    return [
      {
        kind: 'intervals',
        repeats,
        hardSeconds: only.seconds,
        hardTarget: only.target,
        easySeconds: recovery.seconds,
        easyTarget: recovery.target,
        ...(only.label === undefined ? {} : { label: only.label }),
      },
    ];
  }
  const blocks: WorkoutBlock[] = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    blocks.push(...rep);
    if (recovery !== undefined) {
      blocks.push(recovery);
    }
  }
  return blocks;
}

/**
 * One main-set block with its power targets offset.
 *
 * ⚠️ A hold and a free ride come back untouched, and that is the safety half
 * of the rule rather than a detail: a hold's ceiling is ADR 0048 D-3's 0.85,
 * and a free ride has no target to scale.
 */
function offsetBlock(block: WorkoutBlock, percent: number): WorkoutBlock {
  // No offset means no arithmetic at all: `(share × 100) / 100` is not
  // `share` for every share in floating point, and a rider who chose nothing
  // rides exactly the template's own numbers (#2298 rule 6).
  if (percent === 0) {
    return block;
  }
  const scale = (share: ThresholdShare): ThresholdShare =>
    ((share * (100 + percent)) / 100) as ThresholdShare;
  switch (block.kind) {
    case 'steady':
      return { ...block, target: scale(block.target) };
    case 'ramp':
      return { ...block, from: scale(block.from), to: scale(block.to) };
    case 'intervals':
      return { ...block, hardTarget: scale(block.hardTarget), easyTarget: scale(block.easyTarget) };
    case 'free-ride':
    case 'heart-rate-hold':
      return block;
    default: {
      const unhandled: never = block;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** `10` → `"+10%"`, `-25` → `"−25%"`, `0` → `"0%"`. */
function signedPercent(value: number): string {
  if (value > 0) {
    return `+${String(value)}%`;
  }
  return value < 0 ? `−${String(-value)}%` : `${String(value)}%`;
}
