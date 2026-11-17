// SPDX-License-Identifier: Apache-2.0

/**
 * **The field of a race with AI bots: a spread of strength around the tier,
 * and a body that fits each bot's racing style** — #2759,
 * [ADR 0076](../../../../docs/adr/0076-ai-bots-race-with-bodies-that-fit-their-style-and-a-spread-of-strength.md).
 *
 * Before #2759 a model race's field was dealt as a seeded race's: every bot
 * at or a little under its tier (`pace.ts`, 6 %), at one 75 kg, and its racing
 * style dealt apart from its legs (ADR 0073 D-5.1). On the owner's first
 * tablet race nobody was dropped and the field finished within 4 s. The
 * owner's ruling of 2026-11-17 asked for riders who differ, with personalities
 * whose strengths match them.
 *
 * ## The style carries its body (ADR 0076 D-3)
 *
 * The styles are still dealt every-style-once from the seed
 * (`model-tactics.ts` §`modelRacingStyles`, ADR 0073 D-5.1). Each now brings
 * the pace whose archetype fits it ({@link MODEL_STYLE_PACE}), so its legs
 * match, and a body profile ({@link MODEL_STYLE_BODY}):
 *
 * | Style | Pace (legs) | Mass | CP, × tier W/kg | W′, × tier's at its mass | Peak, × tier W/kg |
 * |---|---|---|---|---|---|
 * | `breakaway` | `fast-start` (attacker) | 72 kg | 1.01 | 1.0 | 1.3 |
 * | `sprinter` | `sprinter` | 80 kg | 0.93 | 1.4 | 1.5 |
 * | `climber` | `climber` | 62 kg | 1.08 | 1.0 | 1.3 |
 * | `rouleur` | `even` (rouleur) | 78 kg | 1.0 | 0.9 | 1.25 |
 * | `opportunist` | `negative-split` (attacker) | 70 kg | 0.98 | 1.2 | 1.45 |
 *
 * So a sprinter is heavy, with a big W′ and the highest peak; a climber is
 * light, with the highest W/kg and the least on the flat; a rouleur has the
 * most watts at threshold, which is what the flat and the wind reward; a
 * breakaway rider holds a high threshold; an opportunist has the punch to
 * follow and counter. The five CP shares average 1. ⚠️ **Feel numbers for the
 * owner's approval**, measured on the owner's PC in #2759's pull request.
 *
 * ## A spread of strength, with the field's middle at the tier (D-2)
 *
 * Each bot is dealt a {@link BotBody.strength} from 1 − {@link MODEL_FIELD_STRENGTH_SPREAD}
 * to 1 + it, one bot to each equal share of the band in an order the seed
 * shuffles, so a field always spreads; and its mass is its style's, give or
 * take {@link MODEL_FIELD_MASS_JITTER_KILOGRAMS}. Then the whole field is
 * scaled by one number so that **its mean CP in W/kg is the tier's exactly**:
 * the tier the rider chose is still the field's middle, and a bot may now sit
 * over it as well as under it.
 *
 * ## In plain words for the model (D-4)
 *
 * {@link modelFieldStrengths} says how each bot compares with the rest of the
 * field on the flat, on a climb, in a sprint and in its punch (W′), as
 * `strong`, `average` or `weak`: words from a closed list, which is all
 * ADR 0071 D-3.4 lets the input carry.
 *
 * ## Pure, seeded, and from no recorded ride
 *
 * Tables and draws through `random.ts`, under their own salt. Nothing here
 * imports `ghost/` or `recording/` (`bots.test.ts` scans every lap-race
 * module), and nothing here reads the race.
 */

import { BOT_MASS_KILOGRAMS } from '../pacer/pacing';
import { LapRaceError } from './errors';
import { modelRacingStyles, type ModelRacingStyle, type ModelStrengthWord } from './model-tactics';
import type { BotBody, BotPace, BotPacingStyle } from './pace';
import { nextUnit, raceRandom } from './random';
import { botCeilingWatts, type BotCapacity } from './wbal';

/**
 * The pace each racing style is ridden with, whose archetype is its legs
 * (`archetype.ts` §`BOT_STYLE_ARCHETYPE`): a breakaway rider goes early, an
 * opportunist closes late, a rouleur rides even.
 */
export const MODEL_STYLE_PACE: Readonly<Record<ModelRacingStyle, BotPacingStyle>> = {
  breakaway: 'fast-start',
  sprinter: 'sprinter',
  climber: 'climber',
  rouleur: 'even',
  opportunist: 'negative-split',
};

/** {@link MODEL_STYLE_PACE} read backwards, typed so a new pace without a style fails to compile. */
const PACE_RACING_STYLE: Readonly<Record<BotPacingStyle, ModelRacingStyle>> = {
  'fast-start': 'breakaway',
  sprinter: 'sprinter',
  climber: 'climber',
  even: 'rouleur',
  'negative-split': 'opportunist',
};

/** The racing style a pace is ridden for: {@link MODEL_STYLE_PACE} read backwards. */
export function modelRacingStyleOf(style: BotPacingStyle): ModelRacingStyle {
  return PACE_RACING_STYLE[style];
}

/** A racing style's body, before the field's strength is dealt. */
export interface ModelStyleBody {
  /** What a rider of the style weighs, kilograms. */
  readonly massKilograms: number;
  /** Its CP, as a multiple of the tier's W/kg. */
  readonly cpShare: number;
  /** Its W′, as a multiple of the tier's (`plan.ts` §`BOT_WPRIME_JOULES`) scaled to its mass. */
  readonly wPrimeShare: number;
  /** Its peak, as a multiple of the tier's W/kg: never over `plan.ts` §`BOT_PLAN_SURGE_CEILING`. */
  readonly peakShare: number;
}

/** Each racing style's body (see the file comment's table). ⚠️ Feel numbers for the owner. */
export const MODEL_STYLE_BODY: Readonly<Record<ModelRacingStyle, ModelStyleBody>> = {
  breakaway: { massKilograms: 72, cpShare: 1.01, wPrimeShare: 1, peakShare: 1.3 },
  sprinter: { massKilograms: 80, cpShare: 0.93, wPrimeShare: 1.4, peakShare: 1.5 },
  climber: { massKilograms: 62, cpShare: 1.08, wPrimeShare: 1, peakShare: 1.3 },
  rouleur: { massKilograms: 78, cpShare: 1, wPrimeShare: 0.9, peakShare: 1.25 },
  opportunist: { massKilograms: 70, cpShare: 0.98, wPrimeShare: 1.2, peakShare: 1.45 },
};

/**
 * How far either side of the tier a bot's strength is dealt: **12 %**. ⚠️ A
 * feel number for the owner. With the styles' own CP shares, over 10 000
 * seeds a field of seven's strongest CP in W/kg is 7 % to 48 % over its
 * weakest, and no bot is more than 23 % from the tier: the spread of a club
 * race, where a hard move drops the weakest. Two tiers are 22 to 40 % apart.
 */
export const MODEL_FIELD_STRENGTH_SPREAD = 0.12;

/** How far either side of its style's mass a bot's weight is dealt, kilograms: **3**. */
export const MODEL_FIELD_MASS_JITTER_KILOGRAMS = 3;

/** Keys the field's deal apart from the race's item draws and every other bot draw. */
const FIELD_SALT = 0x2759_f1ed;

/**
 * The paces of a race with AI bots' `count` bots, from the race's seed: each
 * its racing style's pace ({@link MODEL_STYLE_PACE}, on the styles
 * `modelRacingStyles` deals), at an ability of 1, with a body: its style's
 * mass give or take {@link MODEL_FIELD_MASS_JITTER_KILOGRAMS}, and a strength
 * from a band {@link MODEL_FIELD_STRENGTH_SPREAD} either side of 1, scaled so
 * the field's mean CP in W/kg is the tier's (see the file comment).
 *
 * @throws {LapRaceError} `seed-not-integer` for a seed that is not a safe
 *   whole number, and `field-invalid` for a count that is not a whole number
 *   of at least zero, as `pace.ts` §`botFieldPaces`.
 */
export function modelFieldPaces(seed: number, count: number): readonly BotPace[] {
  let random = raceRandom((raceRandom(seed).state ^ FIELD_SALT) >>> 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LapRaceError('field-invalid', 'count must be a whole number of at least zero');
  }
  const styles = modelRacingStyles(seed, count);
  const draw = (): number => {
    const drawn = nextUnit(random);
    random = drawn.next;
    return drawn.value;
  };
  // A Fisher–Yates shuffle of the band's shares, from the same seeded generator.
  const shares = Array.from({ length: count }, (_, at) => at);
  for (let at = count - 1; at > 0; at -= 1) {
    const other = Math.floor(draw() * (at + 1));
    [shares[at], shares[other]] = [shares[other] as number, shares[at] as number];
  }
  const raw = shares.map(
    (share) => 1 + MODEL_FIELD_STRENGTH_SPREAD * ((2 * (share + draw())) / count - 1),
  );
  const masses = styles.map(
    (style) =>
      MODEL_STYLE_BODY[style].massKilograms + (2 * draw() - 1) * MODEL_FIELD_MASS_JITTER_KILOGRAMS,
  );
  // One scale for the field, so its mean CP in W/kg is the tier's.
  const mean =
    styles.reduce(
      (sum, style, at) => sum + MODEL_STYLE_BODY[style].cpShare * (raw[at] as number),
      0,
    ) / Math.max(1, count);
  return styles.map((style, at) => {
    const body: BotBody = {
      massKilograms: masses[at] as number,
      strength: (raw[at] as number) / mean,
    };
    return { style: MODEL_STYLE_PACE[style], ability: 1, body };
  });
}

/** How a bot compares with the rest of its field, in the words the model is shown (D-4). */
export interface ModelBotStrengths {
  /** On the flat: its CP in watts. */
  readonly flat: ModelStrengthWord;
  /** On a climb: its CP per kilogram. */
  readonly climb: ModelStrengthWord;
  /** In a sprint: its peak in watts, as its body allows. */
  readonly sprint: ModelStrengthWord;
  /** Its punch: its W′, how much it can spend above CP. */
  readonly punch: ModelStrengthWord;
}

/**
 * How far from the field's mean a bot must be to be `strong` or `weak`:
 * **4 %**. ⚠️ A feel number for the owner.
 */
export const MODEL_STRENGTH_MARGIN = 0.04;

/** A bot's mass as its capacity has it, or a seeded bot's. */
const massOf = (capacity: BotCapacity): number => capacity.massKilograms ?? BOT_MASS_KILOGRAMS;

/**
 * Each of `capacities` as the model is told it compares with the rest
 * (D-4): `strong` at least {@link MODEL_STRENGTH_MARGIN} over the field's mean,
 * `weak` at least that under it, `average` between. A field of one is
 * average at everything.
 */
export function modelFieldStrengths(
  capacities: readonly BotCapacity[],
): readonly ModelBotStrengths[] {
  const measures: readonly ((capacity: BotCapacity) => number)[] = [
    (capacity) => capacity.cpWatts,
    (capacity) => capacity.cpWatts / massOf(capacity),
    (capacity) => Math.min(capacity.peakWatts, botCeilingWatts(capacity)),
    (capacity) => capacity.wPrimeJoules,
  ];
  const words = measures.map((measure) => {
    const values = capacities.map(measure);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    return values.map((value): ModelStrengthWord =>
      value >= mean * (1 + MODEL_STRENGTH_MARGIN)
        ? 'strong'
        : value <= mean * (1 - MODEL_STRENGTH_MARGIN)
          ? 'weak'
          : 'average',
    );
  });
  return capacities.map((_, at) => ({
    flat: words[0]?.[at] as ModelStrengthWord,
    climb: words[1]?.[at] as ModelStrengthWord,
    sprint: words[2]?.[at] as ModelStrengthWord,
    punch: words[3]?.[at] as ModelStrengthWord,
  }));
}
