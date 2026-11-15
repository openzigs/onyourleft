// SPDX-License-Identifier: Apache-2.0

/**
 * How each bot in a solo lap race paces it: its own ability inside the tier,
 * and a pacing style read off the course — #2455, under ADR 0061.
 *
 * Before #2455 every bot of a tier rode one power trace: the same plan from
 * the same tier, course and seed (`plan.ts`). A field of seven was one stacked
 * group, at one gap and one W/kg on every sample of the owner's tablet race.
 * The owner's ruling of 2026-11-10 on #2455 asked that the bots "ride at
 * different speeds and use some racing strategy", and set what strategy may
 * mean here: **course-based tactics, each seeded per bot**, and never one that
 * reacts to the rider's or another bot's position (ADR 0060 D-9, ADR 0061 D-3,
 * spike 0030 §3.2).
 *
 * ## A pace is fixed at the start, from the race's seed (ADR 0061 D-1, D-2.5)
 *
 * {@link botFieldPaces} deals a field its paces from the race's own seed, as
 * `strategy.ts` §`botFieldPersonalities` deals its personalities, keyed apart
 * from the race's item draws. A pace never changes after the start, and
 * nothing in it is read from the race: not a place, a rank, a gap or another
 * racer. It is a randomness from the race's seed, which is what ADR 0061 D-1
 * allows a plan.
 *
 * ## Ability: at or a little under the tier, never over it
 *
 * {@link BotPace.ability} scales the tier's power: from
 * 1 − {@link BOT_ABILITY_SPREAD} to 1. **Never above 1**, so ADR 0061 D-2's
 * "a bot whose budget is empty rides at no more than its tier's power" holds
 * as written, and the tiers keep their order (D-8.3): the weakest `fierce` is
 * still well clear of the strongest `hard`. A field's abilities are spread
 * across the whole band, one bot to each equal share of it, so a field never
 * bunches on one ability by chance.
 *
 * ## The styles (the owner's list of 2026-11-10)
 *
 * | Style | What the plan does with it |
 * |---|---|
 * | `even` | as a rouleur's plan (#1960's, shaped by #2459): holds its own power, surges up climbs, sprints the close |
 * | `fast-start` | its own power on the first lap, then {@link BOT_STYLE_EASING} under it: it fades |
 * | `negative-split` | {@link BOT_STYLE_EASING} under its own power until the last lap, then all of it |
 * | `climber` | as `even`; its archetype climbs hard (#2459) |
 * | `sprinter` | as `even`; its archetype saves on climbs and opens a long kick (#2459) |
 *
 * Since #2459 each style also carries a rider archetype, `archetype.ts`
 * §`BOT_STYLE_ARCHETYPE`: the power profile within the tier that a style's
 * bot rides with. What a climber's or a sprinter's style did to its capacity
 * before (a larger W′, its own climb grade, a longer kick) is its archetype's
 * row now, so there is one table for it rather than two.
 *
 * A race of one lap has no first or last lap to speak of: there the first and
 * the last third stand in for them. The plan reads which part of the race the
 * bot is in from **its own effort distance**, never the race's lap counter
 * (ADR 0061 D-2.3).
 *
 * ## Pure, and from no recorded ride
 *
 * Scalars and keys only; nothing here imports `ghost/` or `recording/`
 * (`bots.test.ts` scans every lap-race module).
 */

import { LapRaceError } from './errors';
import { nextUnit, raceRandom } from './random';

/** How a bot paces a race, by key. #2455's words for them are the HUD's, for the owner's approval. */
export type BotPacingStyle = 'even' | 'fast-start' | 'negative-split' | 'climber' | 'sprinter';

/** Every style, in the order {@link botFieldPaces} deals them. */
export const BOT_PACING_STYLES: readonly BotPacingStyle[] = [
  'even',
  'fast-start',
  'negative-split',
  'climber',
  'sprinter',
];

/** One bot's pace for one race: fixed at the start, from the race's seed. */
export interface BotPace {
  readonly style: BotPacingStyle;
  /** Its share of its tier's power: from 1 − {@link BOT_ABILITY_SPREAD} to 1. */
  readonly ability: number;
}

/** The pace of a bot nothing has dealt one: a rouleur's plan (#2459), at its tier's full power. */
export const BOT_EVEN_PACE: BotPace = Object.freeze({ style: 'even', ability: 1 });

/**
 * How far under its tier a bot's ability may lie: **6 %**. ⚠️ A feel number for
 * the owner's approval (#2455). Six per cent of power is about two per cent of
 * speed on the flat: some seconds a lap between the strongest and the weakest
 * bot of a field, so the field spreads, and well under the 0.8 W/kg between
 * two tiers, so a tier still beats the one below it.
 */
export const BOT_ABILITY_SPREAD = 0.06;

/**
 * How far under its own power a `fast-start` bot rides after its first lap,
 * and a `negative-split` bot before its last: **4 %**. ⚠️ A feel number for the
 * owner's approval (#2455).
 */
export const BOT_STYLE_EASING = 0.04;

/** Keys the field's deal apart from the race's item draws and the personalities' deal. */
const PACE_SALT = 0x2455_b07e;

/**
 * Check a pace: a style this module names, and an ability inside its band.
 *
 * @throws {LapRaceError} `pace-out-of-range` for either.
 */
export function checkBotPace(pace: BotPace): void {
  const { ability } = pace;
  if (
    !BOT_PACING_STYLES.includes(pace.style) ||
    !Number.isFinite(ability) ||
    ability < 1 - BOT_ABILITY_SPREAD ||
    ability > 1
  ) {
    throw new LapRaceError(
      'pace-out-of-range',
      'a pace has a known style and an ability from one less the spread to one',
    );
  }
}

/**
 * The paces of a solo race's `count` bots, from the race's seed: the styles in
 * turn from a start the seed picks, so any five bots in a row are one of each,
 * and the abilities one to each share of the band, in an order the seed
 * shuffles, so a field always spreads.
 *
 * @throws {LapRaceError} `seed-not-integer` for a seed that is not a safe
 *   whole number, and `field-invalid` for a count that is not a whole number
 *   of at least zero.
 */
export function botFieldPaces(seed: number, count: number): readonly BotPace[] {
  let random = raceRandom((raceRandom(seed).state ^ PACE_SALT) >>> 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LapRaceError('field-invalid', 'count must be a whole number of at least zero');
  }
  const draw = (): number => {
    const drawn = nextUnit(random);
    random = drawn.next;
    return drawn.value;
  };
  const first = Math.floor(draw() * BOT_PACING_STYLES.length);
  // A Fisher–Yates shuffle of the shares, from the same seeded generator.
  const shares = Array.from({ length: count }, (_, at) => at);
  for (let at = count - 1; at > 0; at -= 1) {
    const other = Math.floor(draw() * (at + 1));
    [shares[at], shares[other]] = [shares[other] as number, shares[at] as number];
  }
  return shares.map((share, at) => ({
    style: BOT_PACING_STYLES[(first + at) % BOT_PACING_STYLES.length] as BotPacingStyle,
    ability: 1 - (BOT_ABILITY_SPREAD * (share + draw())) / count,
  }));
}
