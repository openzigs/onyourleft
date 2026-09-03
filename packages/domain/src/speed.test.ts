// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  hundredthsKilometresPerHourToMetresPerSecond,
  kilometresPerHour,
  kilometresPerHourToMetresPerSecond,
  metresPerSecond,
  metresPerSecondToKilometresPerHour,
  UnitError,
} from './index';

describe('metresPerSecondToKilometresPerHour', () => {
  it('scales by 3.6', () => {
    expect(metresPerSecondToKilometresPerHour(metresPerSecond(10))).toBeCloseTo(36, 10);
  });

  it('maps zero to zero', () => {
    expect(metresPerSecondToKilometresPerHour(metresPerSecond(0))).toBeCloseTo(0, 10);
  });

  it('round-trips through kilometres per hour', () => {
    const original = metresPerSecond(8.3);
    const back = kilometresPerHourToMetresPerSecond(metresPerSecondToKilometresPerHour(original));
    expect(back).toBeCloseTo(8.3, 10);
  });

  it('divides rather than multiplies on the way back', () => {
    expect(kilometresPerHourToMetresPerSecond(kilometresPerHour(36))).toBeCloseTo(10, 10);
  });
});

describe('hundredthsKilometresPerHourToMetresPerSecond', () => {
  // The scaling FTMS Indoor Bike Data uses: a uint16 of 0.01 km/h.
  it('reads 2543 as 25.43 km/h, which is 7.0639 m/s', () => {
    expect(hundredthsKilometresPerHourToMetresPerSecond(2543)).toBeCloseTo(7.0638889, 6);
  });

  it('maps zero to zero', () => {
    expect(hundredthsKilometresPerHourToMetresPerSecond(0)).toBeCloseTo(0, 10);
  });

  it('reads the saturated field as 655.35 km/h', () => {
    expect(hundredthsKilometresPerHourToMetresPerSecond(65535)).toBeCloseTo(182.0416667, 6);
  });

  it('rejects a value past the end of a uint16 field', () => {
    expect(() => hundredthsKilometresPerHourToMetresPerSecond(65536)).toThrow(UnitError);
  });

  it('rejects a negative raw field', () => {
    expect(() => hundredthsKilometresPerHourToMetresPerSecond(-1)).toThrow(UnitError);
  });

  it('rejects a fractional raw field, which means the caller already scaled it', () => {
    expect(() => hundredthsKilometresPerHourToMetresPerSecond(2543.5)).toThrow(UnitError);
  });
});

describe('the constructors validate, so the conversions do not have to', () => {
  it('rejects NaN, which is what a malformed GATT payload decodes to', () => {
    expect(() => metresPerSecond(Number.NaN)).toThrow(UnitError);
  });

  it('rejects Infinity', () => {
    expect(() => metresPerSecond(Number.POSITIVE_INFINITY)).toThrow(UnitError);
  });

  it('rejects a negative magnitude rather than converting it', () => {
    expect(() => metresPerSecond(-1)).toThrow(UnitError);
  });
});
