// SPDX-License-Identifier: Apache-2.0

/**
 * The lap race's own seeded generator — #1899.
 *
 * The room and the device run the same race and must draw the same items, so
 * every draw comes from one seed per race and nothing else. This is written
 * here, in this package's licence, rather than borrowed from
 * `apps/web/src/game/seeded.ts`, which is AGPL-3.0-or-later and may not cross
 * into `packages/` (`docs/agents/licence-boundary.md`).
 *
 * The generator is a Weyl sequence (add the golden-ratio constant to a 32-bit
 * counter) passed through Chris Wellons' `lowbias32` integer hash, which he
 * published into the public domain in 2018. Its whole state is one unsigned
 * 32-bit counter, so a race's generator serialises as a number, and a step
 * returns the next state rather than mutating anything.
 *
 * Not cryptographic. Nothing secret depends on it: a race's seed only decides
 * which items fall where.
 */

import { LapRaceError } from './errors';

/** A generator's whole state: an unsigned 32-bit counter. */
export interface RaceRandom {
  readonly state: number;
}

/** The Weyl increment, ⌊2³² / φ⌋. */
const WEYL = 0x9e37_79b9;

/** 2³², to turn an unsigned 32-bit integer into `[0, 1)`. */
const UINT32_RANGE = 0x1_0000_0000;

/** A race's generator from its seed. @throws {LapRaceError} for a seed that is not a whole number. */
export function raceRandom(seed: number): RaceRandom {
  if (!Number.isSafeInteger(seed)) {
    throw new LapRaceError('seed-not-integer', 'seed must be a whole number');
  }
  return { state: seed >>> 0 };
}

/** `lowbias32`: a 32-bit integer mixed so every input bit reaches every output bit. */
function lowbias32(input: number): number {
  let x = input;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb_352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846c_a68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** The next number in `[0, 1)`, and the generator after it. */
export function nextUnit(random: RaceRandom): {
  readonly value: number;
  readonly next: RaceRandom;
} {
  const state = (random.state + WEYL) >>> 0;
  return { value: lowbias32(state) / UINT32_RANGE, next: { state } };
}
