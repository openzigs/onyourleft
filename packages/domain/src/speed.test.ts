// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { metresPerSecondToKilometresPerHour, UnitError } from './index';

describe('metresPerSecondToKilometresPerHour', () => {
  it('scales by 3.6', () => {
    expect(metresPerSecondToKilometresPerHour(10)).toBeCloseTo(36, 10);
  });

  it('maps zero to zero', () => {
    expect(metresPerSecondToKilometresPerHour(0)).toBe(0);
  });

  it('rejects NaN, which is what a malformed GATT payload decodes to', () => {
    expect(() => metresPerSecondToKilometresPerHour(Number.NaN)).toThrow(UnitError);
  });

  it('rejects Infinity', () => {
    expect(() => metresPerSecondToKilometresPerHour(Number.POSITIVE_INFINITY)).toThrow(UnitError);
  });

  it('rejects a negative magnitude rather than converting it', () => {
    expect(() => metresPerSecondToKilometresPerHour(-1)).toThrow(UnitError);
  });
});
