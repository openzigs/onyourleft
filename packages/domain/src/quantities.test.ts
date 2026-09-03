// SPDX-License-Identifier: Apache-2.0

/**
 * Every test in this package imports from `./index` rather than from the module
 * under test. A consumer reaches this code through the barrel, so that is the
 * path the tests read back through: a function that exists but is not exported
 * from `index.ts` is not a function anyone downstream can call, and importing
 * the module directly would hide that.
 */

import { describe, expect, it } from 'vitest';

import {
  ABSOLUTE_ZERO_DEGREES_CELSIUS,
  altitudeMetres,
  beatsPerMinute,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  UnitError,
  unixSeconds,
  watts,
} from './index';

describe('the constructors that reject what is not the quantity at all', () => {
  const magnitudes = [
    ['distance', metres],
    ['speed', metresPerSecond],
    ['power', watts],
    ['cadence', revolutionsPerMinute],
    ['heart rate', beatsPerMinute],
    ['duration', seconds],
  ] as const;

  it.each(magnitudes)('%s rejects NaN, which is what a truncated payload decodes to', (_, make) => {
    expect(() => make(Number.NaN)).toThrow(UnitError);
  });

  it.each(magnitudes)('%s rejects Infinity', (_, make) => {
    expect(() => make(Number.POSITIVE_INFINITY)).toThrow(UnitError);
  });

  it.each(magnitudes)('%s rejects a negative value, which is a decode fault', (_, make) => {
    expect(() => make(-1)).toThrow(UnitError);
  });

  it.each(magnitudes)('%s accepts zero, which is a real reading', (_, make) => {
    expect(make(0)).toBe(0);
  });

  it('carries the value through unchanged — the brand is a type, not a wrapper', () => {
    expect(metresPerSecond(8.25)).toBe(8.25);
    expect(typeof metresPerSecond(8.25)).toBe('number');
  });

  it('names the quantity in the message, so a decoder knows which field was bad', () => {
    expect(() => watts(-1)).toThrow(/power in watts/);
    expect(() => beatsPerMinute(-1)).toThrow(/heart rate in beats per minute/);
  });
});

describe('altitude, which is signed', () => {
  it('accepts an altitude below sea level — the Dead Sea shore is about -430 m', () => {
    expect(altitudeMetres(-430)).toBe(-430);
  });

  it('accepts sea level and a mountain pass', () => {
    expect(altitudeMetres(0)).toBe(0);
    expect(altitudeMetres(2770)).toBe(2770);
  });

  it('still rejects NaN', () => {
    expect(() => altitudeMetres(Number.NaN)).toThrow(UnitError);
  });
});

describe('temperature', () => {
  it('accepts a cold morning and a hot afternoon', () => {
    expect(degreesCelsius(-15)).toBe(-15);
    expect(degreesCelsius(41.5)).toBe(41.5);
  });

  it('accepts absolute zero itself', () => {
    expect(degreesCelsius(ABSOLUTE_ZERO_DEGREES_CELSIUS)).toBe(ABSOLUTE_ZERO_DEGREES_CELSIUS);
  });

  it('rejects a temperature below absolute zero', () => {
    expect(() => degreesCelsius(-273.16)).toThrow(UnitError);
  });
});

describe('mass', () => {
  it('accepts a rider and a bike', () => {
    expect(kilograms(74.2)).toBe(74.2);
    expect(kilograms(8.1)).toBe(8.1);
  });

  it('rejects zero, which is what an unset field decodes to and what divides by zero later', () => {
    expect(() => kilograms(0)).toThrow(UnitError);
  });

  it('rejects a negative mass', () => {
    expect(() => kilograms(-1)).toThrow(UnitError);
  });
});

describe('geographic position', () => {
  it('accepts a southern, western point — signs are carried, not stripped', () => {
    const position = geographicPosition(-33.8688, -151.2093);
    expect(position.latitude).toBe(-33.8688);
    expect(position.longitude).toBe(-151.2093);
  });

  it('accepts the poles and the antimeridian exactly', () => {
    expect(degreesLatitude(90)).toBe(90);
    expect(degreesLatitude(-90)).toBe(-90);
    expect(degreesLongitude(180)).toBe(180);
    expect(degreesLongitude(-180)).toBe(-180);
  });

  it('rejects a latitude past the pole', () => {
    expect(() => degreesLatitude(90.1)).toThrow(UnitError);
    expect(() => degreesLatitude(-90.1)).toThrow(UnitError);
  });

  it('rejects a longitude past the antimeridian', () => {
    expect(() => degreesLongitude(180.1)).toThrow(UnitError);
    expect(() => degreesLongitude(-180.1)).toThrow(UnitError);
  });

  it('rejects a longitude offered as a latitude, which is how a swap surfaces', () => {
    expect(() => geographicPosition(-151.2093, -33.8688)).toThrow(UnitError);
  });
});

describe('instants', () => {
  it('accepts an instant before 1970 — a Unix second is signed', () => {
    expect(unixSeconds(-86400)).toBe(-86400);
  });

  it('accepts a fractional second', () => {
    expect(unixSeconds(1767225600.25)).toBe(1767225600.25);
  });

  it('rejects NaN', () => {
    expect(() => unixSeconds(Number.NaN)).toThrow(UnitError);
  });
});
