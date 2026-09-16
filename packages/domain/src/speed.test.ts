// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  hundredthsKilometresPerHourToMetresPerSecond,
  kilometresPerHour,
  kilometresPerHourToMetresPerSecond,
  metresPerSecond,
  metresPerSecondToKilometresPerHour,
  metresPerSecondToMilesPerHour,
  METRES_PER_MILE,
  milesPerHour,
  milesPerHourToMetresPerSecond,
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

describe('a conversion cannot hand out a value its own constructor would reject (#103)', () => {
  // The bypass #102 removed from `semicirclesToPosition`, surviving here. While
  // these functions cast their result instead of constructing it, the package
  // can produce a branded value it would itself refuse — which makes "has a
  // unit" and "has been checked" different statements.

  it('throws rather than returning Infinity typed as KilometresPerHour', () => {
    // Number.MAX_VALUE is a legitimate MetresPerSecond: finite and
    // non-negative, so `metresPerSecond` accepts it. Times 3.6 it overflows.
    const fastest = metresPerSecond(Number.MAX_VALUE);
    expect(fastest * 3.6).toBe(Number.POSITIVE_INFINITY);
    expect(() => kilometresPerHour(Number.POSITIVE_INFINITY)).toThrow(UnitError);

    expect(() => metresPerSecondToKilometresPerHour(fastest)).toThrow(UnitError);
  });

  it('names the unit it rejected, so a caller can tell which conversion failed', () => {
    expect(() => metresPerSecondToKilometresPerHour(metresPerSecond(Number.MAX_VALUE))).toThrow(
      /kilometres per hour/,
    );
  });

  it('still converts every speed a bicycle can reach', () => {
    // The guard is on the overflow, not on plausibility: 1000 km/h is not a
    // bike and is converted without complaint, because rejecting the merely
    // unlikely is analysis and not this package's job.
    expect(metresPerSecondToKilometresPerHour(metresPerSecond(277.8))).toBeCloseTo(1000.08, 6);
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

describe('metresPerSecondToMilesPerHour (#238)', () => {
  it('scales by 3600 divided by the metres in a mile', () => {
    // 10 m/s is 22.369362920544 mph. Written out rather than recomputed from
    // the same expression the implementation uses, which would assert only
    // that the file agrees with itself.
    expect(metresPerSecondToMilesPerHour(metresPerSecond(10))).toBeCloseTo(22.369362920544, 10);
  });

  it('leaves a standstill at zero', () => {
    expect(metresPerSecondToMilesPerHour(metresPerSecond(0))).toBeCloseTo(0, 10);
  });

  it('uses the international mile, exactly 1609.344 m', () => {
    // A mile per hour is a mile of ground in an hour, so the speed that covers
    // exactly one mile in 3600 s must read as exactly 1.
    expect(metresPerSecondToMilesPerHour(metresPerSecond(METRES_PER_MILE / 3600))).toBeCloseTo(
      1,
      12,
    );
  });

  it('is a different number from the kilometres-per-hour reading of the same speed', () => {
    // The reason the two are separate branded types: both are plausible
    // bicycle speeds, so a mix-up produces a number nobody questions.
    const speed = metresPerSecond(10);
    expect(metresPerSecondToKilometresPerHour(speed)).toBeCloseTo(36, 10);
    expect(metresPerSecondToMilesPerHour(speed)).not.toBeCloseTo(36, 1);
  });

  it('throws rather than returning Infinity typed as MilesPerHour', () => {
    const fastest = metresPerSecond(Number.MAX_VALUE);
    expect(() => metresPerSecondToMilesPerHour(fastest)).toThrow(UnitError);
  });

  it('names the unit it rejected, so a caller can tell which conversion failed', () => {
    expect(() => metresPerSecondToMilesPerHour(metresPerSecond(Number.MAX_VALUE))).toThrow(
      /miles per hour/,
    );
  });
});

describe('milesPerHourToMetresPerSecond (#326)', () => {
  it('is the inverse of the outward conversion', () => {
    // A round trip rather than a second table of numbers: the outward
    // direction is already pinned against the 1959 international mile above,
    // and what this function has to be is *that*, backwards.
    for (const speed of [0, 1, 12, 26.8224, 40]) {
      expect(
        milesPerHourToMetresPerSecond(metresPerSecondToMilesPerHour(metresPerSecond(speed))),
      ).toBeCloseTo(speed, 9);
    }
  });

  it('is not the kilometre-per-hour conversion wearing a different name', () => {
    // The mistake this pair of functions invites: one body, two exports. At
    // 60 the two answers are 26.82 and 16.67, so a caller that got the wrong
    // one would be out by 60 %.
    expect(milesPerHourToMetresPerSecond(milesPerHour(60))).toBeCloseTo(26.8224, 6);
    expect(milesPerHourToMetresPerSecond(milesPerHour(60))).not.toBeCloseTo(
      kilometresPerHourToMetresPerSecond(kilometresPerHour(60)),
      2,
    );
  });

  it('refuses a speed its own constructor would refuse', () => {
    expect(() => milesPerHour(-1)).toThrow(UnitError);
    expect(() => milesPerHour(Number.NaN)).toThrow(UnitError);
  });
});
