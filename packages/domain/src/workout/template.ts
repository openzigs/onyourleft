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

import type { BeatsPerMinute, Seconds } from '../quantities';

import { WorkoutError } from './errors';
import {
  MAXIMUM_REPEATS,
  validateWorkout,
  type HeartRateHoldBlock,
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

/**
 * A heart-rate hold as a template writes one (#2300; spike 0038 R-4 and its
 * finding for #2298): the range is **shares of the rider's threshold heart
 * rate**, because a built-in cannot know anybody's heart rate in beats per
 * minute.
 *
 * {@link tailorWorkout} resolves it into an ordinary `HeartRateHoldBlock` from
 * the threshold heart rate a rider passes in {@link TailorChoices}, rounding
 * **inward** — the low end up, the high end down — so the range in beats per
 * minute never reaches outside the shares written. A range that comes out
 * narrower than `MINIMUM_HOLD_RANGE_BPM` is then refused by `validateWorkout`,
 * never widened.
 *
 * With no threshold heart rate it becomes the steady block at
 * {@link startShare}: exactly what a hold rides whenever it cannot run
 * (ADR 0048 D-3 H1, `heart-rate-hold.ts` §eligibility).
 *
 * Like the hold it becomes, it is never scaled by intensity.
 */
export interface HeartRateZoneHoldBlock {
  readonly kind: 'heart-rate-zone-hold';
  readonly seconds: Seconds;
  /** The range as shares of threshold heart rate, both ends inclusive. */
  readonly rangeShare: { readonly low: number; readonly high: number };
  readonly startShare: ThresholdShare;
  readonly ceilingShare: ThresholdShare;
  readonly label?: string | undefined;
}

/** A block a template's main set may hold: any workout block, or a zone hold. */
export type TemplateBlock = WorkoutBlock | HeartRateZoneHoldBlock;

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
  readonly rep: readonly TemplateBlock[];
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
  readonly blocks: readonly TemplateBlock[];
}

/**
 * A main set of steady efforts that a chosen length stretches or shortens
 * (#2299): endurance, tempo, recovery. Every block's length changes by one
 * factor, so the number of blocks, every target and the ratio between the
 * blocks stay as written.
 */
export interface StretchMainSet {
  readonly scaling: 'stretch';
  readonly blocks: readonly TemplateBlock[];
  /**
   * How far the blocks may be stretched, as a factor of their written length:
   * `{ minimum: 0.5, maximum: 2 }` lets a 40-minute set be 20 to 80 minutes.
   * The maximum is what keeps a block from becoming one nobody can ride —
   * an endurance block may double, a block at 0.95 of threshold may not.
   */
  readonly stretch: ChoiceRange;
}

/**
 * The part of a template that its parameters act on, and the one strategy a
 * chosen length uses on it (#2299): `repeat` changes the repeat count only,
 * `stretch` the length of every block, and `fixed` refuses a length at all.
 */
export type MainSet = RepeatMainSet | StretchMainSet | FixedMainSet;

/**
 * The shortest a warm-up becomes when a chosen length needs it shorter: 5
 * minutes, unless the template says otherwise (#2299). It is never removed.
 */
export const MINIMUM_WARM_UP_SECONDS = 300;

/** The same for a cool-down: 3 minutes, and never removed (#2299). */
export const MINIMUM_COOL_DOWN_SECONDS = 180;

/**
 * How near a tailored workout must come to the length chosen: within 5 % or
 * 3 minutes, whichever is larger (#2299). Outside it, the length is refused.
 */
export const LENGTH_TOLERANCE_SHARE = 0.05;
export const LENGTH_TOLERANCE_SECONDS = 180;

/**
 * The lengths a library is browsed by, in minutes: the ones every surveyed
 * library is organised around (#2295).
 */
export const TEMPLATE_LENGTHS_MINUTES: readonly number[] = [30, 45, 60, 75, 90];

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
  /** The shortest the warm-up may become; {@link MINIMUM_WARM_UP_SECONDS} if absent. */
  readonly warmUpFloorSeconds?: number | undefined;
  /** The shortest the cool-down may become; {@link MINIMUM_COOL_DOWN_SECONDS} if absent. */
  readonly coolDownFloorSeconds?: number | undefined;
}

/** What a rider chose. Every field absent means the template as written. */
export interface TailorChoices {
  /**
   * About how long the whole workout should be, in minutes (#2299). A
   * template whose main set repeats meets it with the repeat count, so this
   * and {@link repeats} cannot both be chosen.
   */
  readonly targetMinutes?: number | undefined;
  /** An offset to every main-set power target, in percent: −10 or +5. */
  readonly intensityPercent?: number | undefined;
  /** How many repetitions, for a template whose main set repeats. */
  readonly repeats?: number | undefined;
  /** The recovery between repetitions, for a template that lets it change. */
  readonly recoverySeconds?: number | undefined;
  /**
   * The rider's own threshold heart rate, in beats per minute, which a
   * {@link HeartRateZoneHoldBlock} resolves its range from. Pass it only when
   * it is the rider's own: an assumed default makes a hold that could not run
   * anyway (H1). Absent, every zone hold rides as its steady fallback.
   * A template with no zone hold ignores it, because heart rate is a property
   * of the rider and not of the workout, unlike a repeat count it cannot offer.
   */
  readonly thresholdHeartRate?: number | undefined;
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
 * - **A zone hold** ({@link HeartRateZoneHoldBlock}) becomes a hold in beats
 *   per minute from the rider's threshold heart rate, or its steady fallback
 *   when none is given.
 * - **A length** is met by the main set's own strategy (see {@link MainSet}):
 *   the repeat count for `repeat`, one stretch factor for `stretch`, and a
 *   refusal for `fixed`. When the main set at its shortest still runs long,
 *   the warm-up and cool-down shorten towards their floors, and otherwise
 *   keep their length. A length the template cannot come within tolerance of
 *   is refused with the nearest lengths it can make. Length changes durations
 *   and counts only, and intensity changes targets only, so the two compose
 *   in either order.
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
  const heartRate = heartRateChoice(choices.thresholdHeartRate);
  const shaped = shapedBlocks(template, choices);
  const main = shaped.main.map((block) => offsetBlock(block, percent));
  // Resolved after the offset, so a zone hold's steady fallback is never
  // scaled either: it is the hold's own start share, as written.
  return validateWorkout({
    name: template.name,
    description: template.summary,
    blocks: [...shaped.warmUp, ...main, ...shaped.coolDown].map((block) =>
      resolveBlock(block, heartRate),
    ),
  });
}

/**
 * A share times a heart rate, to a millionth: `0.82 × 150` is
 * `122.99999999999999` in floating point, which rounding down would make 122.
 */
function product(share: number, heartRate: number): number {
  return Math.round(share * heartRate * 1e6) / 1e6;
}

/** A workout's three parts, before the intensity offset and zone holds are resolved. */
interface Shaped {
  readonly warmUp: readonly TemplateBlock[];
  readonly main: readonly TemplateBlock[];
  readonly coolDown: readonly TemplateBlock[];
}

/** The threshold heart rate a zone hold resolves from, after checking it is one. */
function heartRateChoice(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new WorkoutError(
      'invalid-choice',
      `a threshold heart rate must be a number of beats per minute above zero; you gave ${String(value)}.`,
    );
  }
  return value;
}

/**
 * A zone hold as the block a workout rides: a hold in beats per minute, rounded
 * inward, or with no threshold heart rate its steady fallback. Every other
 * block is returned as it is.
 */
function resolveBlock(block: TemplateBlock, thresholdHeartRate: number | undefined): WorkoutBlock {
  if (block.kind !== 'heart-rate-zone-hold') {
    return block;
  }
  const label = block.label === undefined ? {} : { label: block.label };
  if (thresholdHeartRate === undefined) {
    return { kind: 'steady', seconds: block.seconds, target: block.startShare, ...label };
  }
  const hold: HeartRateHoldBlock = {
    kind: 'heart-rate-hold',
    seconds: block.seconds,
    range: {
      // Inward: up at the bottom, down at the top. `validateWorkout` refuses
      // what is then too narrow or out of bounds, by block number.
      low: Math.ceil(product(block.rangeShare.low, thresholdHeartRate)) as BeatsPerMinute,
      high: Math.floor(product(block.rangeShare.high, thresholdHeartRate)) as BeatsPerMinute,
    },
    startShare: block.startShare,
    ceilingShare: block.ceilingShare,
    ...label,
  };
  return hold;
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

/** The three parts, with the rider's length, repeat and recovery choices. */
function shapedBlocks(template: WorkoutTemplate, choices: TailorChoices): Shaped {
  const set = template.mainSet;
  const target = lengthChoice(template, choices.targetMinutes);
  const asWritten = (main: readonly TemplateBlock[]): Shaped => ({
    warmUp: template.warmUp,
    main,
    coolDown: template.coolDown,
  });
  switch (set.scaling) {
    case 'fixed':
      refuseRepeatChoices(choices);
      return asWritten(set.blocks);
    case 'stretch':
      refuseRepeatChoices(choices);
      return target === undefined
        ? asWritten(set.blocks)
        : stretchedToLength(template, set, target);
    case 'repeat': {
      const recovery = recoveryBlock(set, choices.recoverySeconds);
      if (target === undefined) {
        return asWritten(repeatBlocks(set.rep, recovery, repeatChoice(set, choices.repeats)));
      }
      if (choices.repeats !== undefined) {
        throw new WorkoutError(
          'invalid-choice',
          'choose a length or a number of repeats for this workout, not both: the length is ' +
            'made by choosing the number of repeats.',
        );
      }
      return repeatedToLength(template, set, recovery, target);
    }
    default: {
      const unhandled: never = set;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A main set with no repeat count refuses a choice of one, rather than ignoring it. */
function refuseRepeatChoices(choices: TailorChoices): void {
  if (choices.repeats !== undefined) {
    throw new WorkoutError('invalid-choice', 'this workout has no repeat count to choose.');
  }
  if (choices.recoverySeconds !== undefined) {
    throw new WorkoutError(
      'invalid-choice',
      'this workout has no recovery between repeats to change.',
    );
  }
}

/** The chosen length in seconds, or `undefined` for the template's own. */
function lengthChoice(template: WorkoutTemplate, minutes: number | undefined): number | undefined {
  if (minutes === undefined) {
    return undefined;
  }
  if (template.mainSet.scaling === 'fixed') {
    throw new WorkoutError(
      'invalid-choice',
      `"${template.name}" is ridden as written, so its length cannot be chosen.`,
    );
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new WorkoutError(
      'invalid-choice',
      `a workout's length must be a number of minutes above zero; you asked for ${String(minutes)}.`,
    );
  }
  return minutes * 60;
}

/** The repeat count whose workout comes nearest the length, and that workout. */
function repeatedToLength(
  template: WorkoutTemplate,
  set: RepeatMainSet,
  recovery: SteadyBlock | undefined,
  target: number,
): Shaped {
  const minimum = Math.max(set.repeats.minimum, 1);
  const maximum = Math.min(set.repeats.maximum, MAXIMUM_REPEATS);
  const written: Shaped[] = [];
  const shortened: Shaped[] = [];
  for (let repeats = minimum; repeats <= maximum; repeats += 1) {
    const main = repeatBlocks(set.rep, recovery, repeats);
    written.push({ warmUp: template.warmUp, main, coolDown: template.coolDown });
    shortened.push(framed(template, main, target));
  }
  // The frame as written first: it shortens only when no repeat count can
  // meet the length without it, so a length that more repeats and a shorter
  // warm-up would hit exactly still keeps the warm-up.
  for (const candidates of [written, shortened]) {
    const best = nearest(candidates, target);
    if (best !== undefined && distance(best, target) <= tolerance(target)) {
      return best;
    }
  }
  const lengths = shortened.map(shapedSeconds);
  const below = lengths.filter((length) => length < target);
  const above = lengths.filter((length) => length > target);
  throw lengthRefusal(
    template,
    target,
    below.length === 0 ? undefined : Math.max(...below),
    above.length === 0 ? undefined : Math.min(...above),
    'or',
  );
}

/** The main set stretched by the one factor that comes nearest the length. */
function stretchedToLength(template: WorkoutTemplate, set: StretchMainSet, target: number): Shaped {
  const written = blocksSeconds(set.blocks);
  const framing = blocksSeconds(template.warmUp) + blocksSeconds(template.coolDown);
  const wanted = (target - framing) / written;
  const factor = Math.min(Math.max(wanted, set.stretch.minimum), set.stretch.maximum);
  const shaped = framed(template, stretchBlocks(set.blocks, factor), target);
  if (distance(shaped, target) <= tolerance(target)) {
    return shaped;
  }
  const shortest = framed(template, stretchBlocks(set.blocks, set.stretch.minimum), 0);
  const longest = framed(template, stretchBlocks(set.blocks, set.stretch.maximum), Infinity);
  throw lengthRefusal(template, target, shapedSeconds(shortest), shapedSeconds(longest), 'to');
}

/**
 * The main set with the warm-up and cool-down it is ridden with: their own,
 * unless that runs outside tolerance long, when they shorten towards the
 * length — never below their floors, and never removed.
 *
 * The shortening is shared between the two in proportion to how much each
 * may lose, so neither is cut to its floor while the other keeps its length.
 */
function framed(template: WorkoutTemplate, main: readonly TemplateBlock[], target: number): Shaped {
  const warmUp = blocksSeconds(template.warmUp);
  const coolDown = blocksSeconds(template.coolDown);
  const full = warmUp + blocksSeconds(main) + coolDown;
  const over = full - target;
  if (over <= tolerance(target)) {
    return { warmUp: template.warmUp, main, coolDown: template.coolDown };
  }
  const warmUpSlack = Math.max(
    0,
    warmUp - (template.warmUpFloorSeconds ?? MINIMUM_WARM_UP_SECONDS),
  );
  const coolDownSlack = Math.max(
    0,
    coolDown - (template.coolDownFloorSeconds ?? MINIMUM_COOL_DOWN_SECONDS),
  );
  const slack = warmUpSlack + coolDownSlack;
  const cut = slack === 0 ? 0 : Math.min(over, slack) / slack;
  return {
    warmUp: stretchBlocks(template.warmUp, (warmUp - warmUpSlack * cut) / warmUp),
    main,
    coolDown: stretchBlocks(template.coolDown, (coolDown - coolDownSlack * cut) / coolDown),
  };
}

function lengthRefusal(
  template: WorkoutTemplate,
  target: number,
  shorter: number | undefined,
  longer: number | undefined,
  joiner: 'or' | 'to',
): WorkoutError {
  const asked = `you asked for ${minutesText(target)}.`;
  const can =
    shorter !== undefined && longer !== undefined
      ? `can be ${minutesText(shorter, false)} ${joiner} ${minutesText(longer)} long`
      : longer !== undefined
        ? `can be no shorter than ${minutesText(longer)}`
        : `can be no longer than ${minutesText(shorter ?? 0)}`;
  return new WorkoutError('invalid-choice', `"${template.name}" ${can}; ${asked}`);
}

/** `2700` → `"45 minutes"`; with `unit` false, `"45"`. */
function minutesText(totalSeconds: number, unit = true): string {
  const minutes = String(Math.round(totalSeconds / 60));
  return unit ? `${minutes} minutes` : minutes;
}

/** The candidate nearest the length; the first, so the fewest repeats, on a tie. */
function nearest(candidates: readonly Shaped[], target: number): Shaped | undefined {
  let best: Shaped | undefined;
  for (const candidate of candidates) {
    if (best === undefined || distance(candidate, target) < distance(best, target)) {
      best = candidate;
    }
  }
  return best;
}

function tolerance(target: number): number {
  return Math.max(target * LENGTH_TOLERANCE_SHARE, LENGTH_TOLERANCE_SECONDS);
}

function distance(shaped: Shaped, target: number): number {
  return Math.abs(shapedSeconds(shaped) - target);
}

function shapedSeconds(shaped: Shaped): number {
  return blocksSeconds(shaped.warmUp) + blocksSeconds(shaped.main) + blocksSeconds(shaped.coolDown);
}

/** How long some blocks last, the way `expandWorkout` adds them up. */
function blocksSeconds(blocks: readonly TemplateBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    total +=
      block.kind === 'intervals'
        ? block.repeats * (block.hardSeconds + block.easySeconds)
        : block.seconds;
  }
  return total;
}

/**
 * Every block's length times one factor, to the whole second. Targets, kinds
 * and the number of blocks are untouched.
 */
function stretchBlocks(blocks: readonly TemplateBlock[], factor: number): readonly TemplateBlock[] {
  // A length that rounds to zero is left for `validateWorkout` to refuse, by
  // block number, rather than raised to something nobody chose.
  const length = (value: Seconds): Seconds => Math.round(value * factor) as Seconds;
  return blocks.map((block) =>
    block.kind === 'intervals'
      ? { ...block, hardSeconds: length(block.hardSeconds), easySeconds: length(block.easySeconds) }
      : { ...block, seconds: length(block.seconds) },
  );
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
  rep: readonly TemplateBlock[],
  recovery: SteadyBlock | undefined,
  repeats: number,
): readonly TemplateBlock[] {
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
  const blocks: TemplateBlock[] = [];
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
 * ⚠️ A hold, a zone hold and a free ride come back untouched, and that is the safety half
 * of the rule rather than a detail: a hold's ceiling is ADR 0048 D-3's 0.85,
 * and a free ride has no target to scale.
 */
function offsetBlock(block: TemplateBlock, percent: number): TemplateBlock {
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
    case 'heart-rate-zone-hold':
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
