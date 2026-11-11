// SPDX-License-Identifier: Apache-2.0

/**
 * #2455: each bot's own pace, dealt from the race's seed. What a pace does to
 * a bot's power is `plan.test.ts`; what it does to a race, on the one physics,
 * is `@onyourleft/physics` §`lap-race-bot.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { LapRaceError } from './errors';
import {
  BOT_ABILITY_SPREAD,
  BOT_EVEN_PACE,
  BOT_PACING_STYLES,
  botFieldPaces,
  checkBotPace,
} from './pace';
import { botFieldPersonalities } from './strategy';

/** The thrown error's code, or `undefined` if nothing was thrown. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof LapRaceError ? error.code : 'not a LapRaceError';
  }
  return undefined;
}

describe('a field’s paces, from the race’s seed — #2455', () => {
  it('deals the same paces for the same seed, and others for another', () => {
    expect(botFieldPaces(7, 7)).toEqual(botFieldPaces(7, 7));
    expect(botFieldPaces(8, 7)).not.toEqual(botFieldPaces(7, 7));
    expect(botFieldPaces(5, 0)).toEqual([]);
  });

  it('deals the five styles in turn, so any five bots in a row are one of each', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const styles = botFieldPaces(seed, 7).map((pace) => pace.style);
      for (let at = 0; at + 4 < styles.length; at += 1) {
        expect(new Set(styles.slice(at, at + 5)).size, `seed ${String(seed)}`).toBe(5);
      }
    }
    // The seed picks where the turn starts: every style leads some field.
    const firsts = new Set(
      Array.from({ length: 40 }, (_, seed) => botFieldPaces(seed, 1)[0]?.style),
    );
    expect(firsts).toEqual(new Set(BOT_PACING_STYLES));
  });

  it('spreads a field’s abilities across the band, one to each share, never over the tier', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const count = 1 + (seed % 7);
      const abilities = botFieldPaces(seed, count).map((pace) => pace.ability);
      for (const ability of abilities) {
        expect(ability).toBeLessThanOrEqual(1);
        expect(ability).toBeGreaterThan(1 - BOT_ABILITY_SPREAD);
        expect(() => {
          checkBotPace({ style: 'even', ability });
        }).not.toThrow();
      }
      // One bot to each equal share of the band.
      const shares = abilities
        .map((ability) => Math.floor(((1 - ability) / BOT_ABILITY_SPREAD) * count))
        .sort((a, b) => a - b);
      expect(shares, `seed ${String(seed)}`).toEqual(Array.from({ length: count }, (_, at) => at));
    }
  });

  it('shuffles the shares by the seed, so the strongest bot is not always one number', () => {
    const strongest = new Set(
      Array.from({ length: 30 }, (_, seed) => {
        const abilities = botFieldPaces(seed, 7).map((pace) => pace.ability);
        return abilities.indexOf(Math.max(...abilities));
      }),
    );
    expect(strongest.size).toBeGreaterThan(4);
  });

  it('is keyed apart from the personalities’ deal on the same seed', () => {
    // Two deals from one draw would line a style up with a personality every race.
    const pairs = new Set(
      Array.from({ length: 60 }, (_, seed) => {
        const style = botFieldPaces(seed, 1)[0]?.style;
        const personality = botFieldPersonalities(seed, 1)[0];
        return `${String(style)}/${String(personality)}`;
      }),
    );
    expect(pairs.size).toBeGreaterThan(10);
  });

  it('refuses a seed or a count that is not a whole number', () => {
    expect(codeOf(() => botFieldPaces(1.5, 3))).toBe('seed-not-integer');
    for (const count of [-1, 2.5, Number.NaN]) {
      expect(codeOf(() => botFieldPaces(1, count))).toBe('field-invalid');
    }
  });
});

describe('a pace is checked before a plan reads it', () => {
  it('takes the even pace and the band’s ends, and refuses past them', () => {
    expect(codeOf(() => checkBotPace(BOT_EVEN_PACE))).toBeUndefined();
    expect(codeOf(() => checkBotPace({ style: 'sprinter', ability: 1 - BOT_ABILITY_SPREAD }))).toBe(
      undefined,
    );
    for (const ability of [1 + 1e-9, 1 - BOT_ABILITY_SPREAD - 1e-9, Number.NaN, Infinity]) {
      expect(codeOf(() => checkBotPace({ style: 'even', ability }))).toBe('pace-out-of-range');
    }
  });

  it('names the constraint and never the value', () => {
    expect(() => {
      checkBotPace({ style: 'even', ability: 1.5 });
    }).toThrow(/^a pace has a known style and an ability from one less the spread to one$/);
  });
});
