// SPDX-License-Identifier: Apache-2.0

/**
 * The 1959 agreement's definitions, and the one thing that can go wrong with
 * deriving one from the other.
 *
 * `length.ts` claims the foot and the mile are consistent *by construction*
 * rather than by somebody keeping two numbers in step. The construction is a
 * floating-point multiplication, and a floating-point multiplication is
 * entitled to land a bit away from the decimal literal it is meant to equal.
 * It does not here — `5280 * 0.3048` is exactly `1609.344` in IEEE-754 — and
 * that is a fact about the encoding rather than about arithmetic in general,
 * so it is pinned rather than assumed.
 */

import { describe, expect, it } from 'vitest';

import { FEET_PER_MILE, METRES_PER_FOOT, METRES_PER_MILE } from './length';

describe('the imperial length definitions', () => {
  it('fixes the foot at exactly 0.3048 m', () => {
    expect(METRES_PER_FOOT).toBe(0.3048);
  });

  it('derives the mile at exactly 1609.344 m, with no floating-point residue', () => {
    // ⚠️ `toBe`, not `toBeCloseTo`. The whole point of deriving the mile is
    // that it is the same number as before; a derivation that landed at
    // 1609.3440000000001 would be a silent change to every distance an
    // imperial rider reads, and `toBeCloseTo` would not say so.
    expect(METRES_PER_MILE).toBe(1609.344);
  });

  it('relates the two by the definition rather than by a second constant', () => {
    expect(FEET_PER_MILE * METRES_PER_FOOT).toBe(METRES_PER_MILE);
    expect(METRES_PER_MILE / METRES_PER_FOOT).toBe(FEET_PER_MILE);
  });

  it('is the international foot and not the US survey foot', () => {
    // The survey foot is 1200/3937 m, about 0.30480061 — three parts per
    // million longer. Over a 1 000 m climb that is 3 mm, which nothing here
    // cares about; over a marathon it is 127 mm, which is still nothing. It is
    // pinned because the two are easy to confuse in a source, not because the
    // difference would show.
    expect(METRES_PER_FOOT).not.toBe(1200 / 3937);
  });
});
