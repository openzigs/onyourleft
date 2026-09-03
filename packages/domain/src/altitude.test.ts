// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  FIT_ALTITUDE_MAX_METRES,
  FIT_ALTITUDE_MIN_METRES,
  FIT_UINT16_INVALID,
  fitAltitudeToMetres,
  metresToFitAltitude,
  UnitError,
} from './index';

describe('the FIT altitude scale and offset', () => {
  it('applies both: raw 2500 is sea level, not 500 m and not 12500 m', () => {
    expect(fitAltitudeToMetres(2500)).toBe(0);
  });

  it('decodes raw 0 as 500 m below sea level, the lowest the field reaches', () => {
    expect(fitAltitudeToMetres(0)).toBe(FIT_ALTITUDE_MIN_METRES);
    expect(FIT_ALTITUDE_MIN_METRES).toBe(-500);
  });

  it('decodes the largest valid raw value', () => {
    expect(fitAltitudeToMetres(FIT_UINT16_INVALID - 1)).toBeCloseTo(12606.8, 6);
    expect(FIT_ALTITUDE_MAX_METRES).toBeCloseTo(12606.8, 6);
  });

  it('round-trips a below-sea-level altitude — the case the offset exists for', () => {
    const original = altitudeMetres(-430);
    expect(fitAltitudeToMetres(metresToFitAltitude(original))).toBeCloseTo(-430, 6);
  });

  it('round-trips a mountain pass', () => {
    const original = altitudeMetres(2770);
    expect(fitAltitudeToMetres(metresToFitAltitude(original))).toBeCloseTo(2770, 6);
  });

  it('round-trips within the 0.2 m the field can represent', () => {
    const original = altitudeMetres(350.37);
    expect(fitAltitudeToMetres(metresToFitAltitude(original))).toBeCloseTo(350.37, 1);
  });

  it('encodes sea level as raw 2500', () => {
    expect(metresToFitAltitude(altitudeMetres(0))).toBe(2500);
  });
});

describe('the FIT invalid marker', () => {
  it('is rejected rather than decoded as a plausible 12606.8 m', () => {
    expect(() => fitAltitudeToMetres(FIT_UINT16_INVALID)).toThrow(UnitError);
    expect(() => fitAltitudeToMetres(FIT_UINT16_INVALID)).toThrow(/invalid marker/);
  });
});

describe('raw field validation', () => {
  it('rejects a raw value past the end of a uint16', () => {
    expect(() => fitAltitudeToMetres(65536)).toThrow(UnitError);
  });

  it('rejects a negative raw value', () => {
    expect(() => fitAltitudeToMetres(-1)).toThrow(UnitError);
  });

  it('rejects a fractional raw value, which means the caller already scaled it', () => {
    expect(() => fitAltitudeToMetres(2500.5)).toThrow(UnitError);
  });
});

describe('encoding out of range', () => {
  it('rejects an altitude below what the field can hold rather than clamping', () => {
    expect(() => metresToFitAltitude(altitudeMetres(-501))).toThrow(UnitError);
  });

  it('rejects an altitude above what the field can hold rather than clamping', () => {
    expect(() => metresToFitAltitude(altitudeMetres(FIT_ALTITUDE_MAX_METRES + 1))).toThrow(
      UnitError,
    );
  });

  it('accepts both ends of the range exactly', () => {
    expect(metresToFitAltitude(altitudeMetres(FIT_ALTITUDE_MIN_METRES))).toBe(0);
    expect(metresToFitAltitude(altitudeMetres(FIT_ALTITUDE_MAX_METRES))).toBe(
      FIT_UINT16_INVALID - 1,
    );
  });
});
