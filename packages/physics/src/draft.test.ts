// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  DRAFT_REACH_METRES,
  DRAFT_TABLE,
  draftFactor,
  fieldDraftFactors,
  LEVEL_METRES,
  leadFactor,
  MAXIMUM_DRAFT_DEPTH,
} from './draft';
import draftSource from './draft.ts?raw';
import { PhysicsError } from './physics-error';

/** The published gaps: every column but the unsourced reach. */
const PUBLISHED_GAPS = [0.05, 0.15, 0.5, 1, 5] as const;

/** ADR 0038 D-3.1 and D-3.2, typed out again here rather than read from the module under test. */
const PUBLISHED_TRAILING: readonly (readonly number[])[] = [
  [0.641, 0.644, 0.652, 0.665, 0.709],
  [0.517, 0.522, 0.536, 0.556, 0.631],
  [0.459, 0.466, 0.486, 0.511, 0.611],
  [0.436, 0.443, 0.466, 0.493, 0.605],
  [0.425, 0.433, 0.457, 0.485, 0.602],
];
const PUBLISHED_LEADING = [0.976, 0.98, 0.987, 0.992, 0.999] as const;

/** A sweep from the level gap to well past the reach, in 1 cm steps. */
function sweep(from: number, to: number): number[] {
  const gaps: number[] = [];
  for (let centimetres = Math.round(from * 100); centimetres <= to * 100; centimetres += 1) {
    gaps.push(centimetres / 100);
  }
  return gaps;
}

describe('the draft model reproduces its sources — ADR 0038 D-3.1, D-3.2', () => {
  PUBLISHED_TRAILING.forEach((row, rowIndex) => {
    const depth = rowIndex + 1;
    PUBLISHED_GAPS.forEach((gap, column) => {
      it(`gives the depth-${String(depth)} follower at ${String(gap)} m Blocken 2018's ${String(row[column])}`, () => {
        expect(draftFactor(gap, depth)).toBe(row[column]);
      });
    });
  });

  PUBLISHED_GAPS.forEach((gap, column) => {
    it(`gives the leader at ${String(gap)} m Blocken 2018's ${String(PUBLISHED_LEADING[column])}`, () => {
      expect(leadFactor(gap)).toBe(PUBLISHED_LEADING[column]);
    });
  });

  it('treats every depth past five as five, the paper’s own finding', () => {
    for (const gap of PUBLISHED_GAPS) {
      expect(draftFactor(gap, 9)).toBe(draftFactor(gap, MAXIMUM_DRAFT_DEPTH));
    }
  });

  it('exports the table it interpolates, so the provenance test and the code read one set', () => {
    expect(DRAFT_TABLE.gapsMetres).toEqual([...PUBLISHED_GAPS, DRAFT_REACH_METRES]);
  });
});

describe('the shape of k — #786 criterion 2', () => {
  for (let depth = 1; depth <= MAXIMUM_DRAFT_DEPTH; depth += 1) {
    it(`never decreases as the gap grows, and is exactly 1 from the reach on, at depth ${String(depth)}`, () => {
      let previous = 0;
      for (const gap of sweep(LEVEL_METRES, DRAFT_REACH_METRES + 10)) {
        const k = draftFactor(gap, depth);
        expect(k).toBeGreaterThanOrEqual(previous);
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThanOrEqual(1);
        if (gap >= DRAFT_REACH_METRES) {
          expect(k).toBe(1);
        } else {
          expect(k).toBeLessThan(1);
        }
        previous = k;
      }
    });
  }

  it('does the same for the leading-rider effect', () => {
    let previous = 0;
    for (const gap of sweep(LEVEL_METRES, DRAFT_REACH_METRES + 10)) {
      const k = leadFactor(gap);
      expect(k).toBeGreaterThanOrEqual(previous);
      expect(k === 1).toBe(gap >= DRAFT_REACH_METRES);
      previous = k;
    }
  });

  it('shelters more the deeper the chain, at every gap', () => {
    for (const gap of sweep(LEVEL_METRES, DRAFT_REACH_METRES - 0.01)) {
      for (let depth = 2; depth <= MAXIMUM_DRAFT_DEPTH; depth += 1) {
        expect(draftFactor(gap, depth)).toBeLessThan(draftFactor(gap, depth - 1));
      }
    }
  });

  it('interpolates beyond 5 m in a straight line to 1 at the reach — the unsourced D-3.3 rule', () => {
    // Half way from 5 m to 30 m is half way from 0.709 to 1.
    expect(draftFactor(17.5, 1)).toBeCloseTo((0.709 + 1) / 2, 12);
  });

  it('refuses a gap that is not a distance, and a depth that is not a place', () => {
    for (const gap of [Number.NaN, -0.01, Number.POSITIVE_INFINITY]) {
      expect(() => draftFactor(gap, 1)).toThrow(PhysicsError);
      expect(() => leadFactor(gap)).toThrow(PhysicsError);
    }
    for (const depth of [0, -1, 1.5, Number.NaN]) {
      expect(() => draftFactor(1, depth)).toThrow(PhysicsError);
    }
  });
});

describe('level riders shelter neither way — ADR 0038 D-2, D-3.6', () => {
  it('gives 1 to both functions under 0.05 m, and the full draft at 0.05 m', () => {
    expect(draftFactor(0.049, 1)).toBe(1);
    expect(leadFactor(0.049)).toBe(1);
    expect(draftFactor(0, 1)).toBe(1);
    expect(draftFactor(LEVEL_METRES, 1)).toBe(0.641);
  });

  it('gives two riders under 0.05 m apart, alone on the road, exactly 1 each', () => {
    expect(fieldDraftFactors([100, 100.04])).toEqual([1, 1]);
    expect(fieldDraftFactors([100, 100])).toEqual([1, 1]);
  });

  it('counts two level riders ahead as one place, not a double draft', () => {
    const [alone] = fieldDraftFactors([100, 101]);
    const [besideAPair] = fieldDraftFactors([100, 101, 101.03]);
    expect(besideAPair).toBe(alone);
    expect(alone).toBe(0.665);
  });
});

describe('the combination rule over a field — ADR 0038 D-3.6', () => {
  it('gives a lone rider 1, and a rider beyond the reach of everybody 1', () => {
    expect(fieldDraftFactors([42])).toEqual([1]);
    expect(fieldDraftFactors([0, 30.5, 61])).toEqual([1, 1, 1]);
  });

  it('gives the leader of a pair the leading effect and the follower the trailing one', () => {
    expect(fieldDraftFactors([10, 10.5])).toEqual([0.652, 0.987]);
  });

  it('uses this rider’s own gap, and the depth of the whole chain ahead', () => {
    // Three riders ahead at 1 m spacings; this rider 0.5 m off the last wheel.
    const [k] = fieldDraftFactors([0, 0.5, 1.5, 2.5]);
    expect(k).toBe(draftFactor(0.5, 3));
  });

  it('does not depend on the order the field is given in', () => {
    const field = [3, 0, 12.25, 1, 2, 40, 1.02, 7.5];
    const reversed = [...field].reverse();
    const byRider = new Map(field.map((d, i) => [d, fieldDraftFactors(field)[i]]));
    fieldDraftFactors(reversed).forEach((k, i) => {
      expect(k).toBe(byRider.get(reversed[i] as number));
    });
  });

  it('refuses a distance that is not finite', () => {
    expect(() => fieldDraftFactors([1, Number.NaN])).toThrow(PhysicsError);
  });
});

describe('the check ADR 0038 D-3 held the table to — errs toward less draft, by at most ~4 %', () => {
  // Each: the model's middle rider against the paper's measured value.
  const CHECKS = [
    {
      what: '3-rider line at 0.05 m, the middle rider',
      field: [0, 0.05, 0.1],
      index: 1,
      measured: 0.617,
    },
    { what: '3-rider line at 1 m, the middle rider', field: [0, 1, 2], index: 1, measured: 0.655 },
    {
      what: '9-rider line at 0.15 m, rider 7 (the text’s 40.7 %)',
      field: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2].reverse(),
      index: 6,
      measured: 0.407,
    },
  ] as const;

  for (const { what, field, index, measured } of CHECKS) {
    it(what, () => {
      const k = fieldDraftFactors(field)[index] as number;
      expect(k).toBeGreaterThanOrEqual(measured);
      expect(k / measured).toBeLessThan(1.045);
    });
  }

  it('models the middle rider of the 3-rider line as 0.641 × 0.976', () => {
    expect(fieldDraftFactors([0, 0.05, 0.1])[1]).toBe(0.641 * 0.976);
  });
});

describe('no transcendental — #786 criterion 4, ADR 0038 D-2', () => {
  it('names no Math member and no exponent operator in draft.ts’s code', () => {
    const source = draftSource;
    expect(source).toContain('export function fieldDraftFactors');
    // Comments may name what is forbidden, in order to forbid it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bMath\s*\./);
    expect(code).not.toMatch(/\*\*/);
    expect(code).not.toMatch(/\b(exp|pow|log|sin|cos|tan|atan2?|hypot|cbrt)\s*\(/);
  });
});
