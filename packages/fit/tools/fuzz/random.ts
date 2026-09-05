// SPDX-License-Identifier: Apache-2.0

/**
 * A seeded pseudo-random source, so a fuzz failure is reproducible from its
 * output alone.
 *
 * #128 is explicit that this must not be `Math.random`: *"a test that fails one
 * run in fifty on a different input each time is a flake that gets deleted"*.
 * Every case this package fuzzes is therefore a pure function of a seed and the
 * committed corpus, and both are printed with a failure.
 *
 * The generator is `mulberry32` — a 32-bit state, one multiply-shift round per
 * value. It is arithmetic derived from the algorithm's published constants, not
 * a translation of anyone's source; the same rule ADR 0006 R3 draws for a wire
 * format applies to a PRNG, and its statistical quality is irrelevant here
 * anyway. What matters is that it is *deterministic*, *portable* and *seedable*.
 * A cryptographic source would be strictly worse: it cannot be replayed.
 */

/** A seeded stream of numbers. Stateful, and reset only by making a new one. */
export interface FuzzRandom {
  /** The next value in `[0, 2^32)`. */
  u32(): number;
  /** The next value in `[0, limit)`. Returns `0` when `limit` is not positive. */
  below(limit: number): number;
}

/**
 * A stream seeded with `seed`.
 *
 * Two streams made with the same seed produce the same values in the same
 * order, on any platform, forever — which is the whole contract.
 */
export function createFuzzRandom(seed: number): FuzzRandom {
  let state = seed >>> 0;
  const u32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  return {
    u32,
    below: (limit) => (limit > 0 ? u32() % limit : 0),
  };
}
