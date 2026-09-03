// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  latitudeSemicircles,
  longitudeSemicircles,
  DEGREES_PER_SEMICIRCLE,
  degreesLatitude,
  degreesLatitudeToSemicircles,
  degreesLongitude,
  degreesLongitudeToSemicircles,
  SEMICIRCLES_MAX,
  SEMICIRCLES_MIN,
  SEMICIRCLES_PER_HALF_TURN,
  semicirclesToDegreesLatitude,
  semicirclesToDegreesLongitude,
  semicirclesToPosition,
  UnitError,
} from './index';

/**
 * The documented round-trip precision: 1e-7 degrees, about 1.1 cm of latitude.
 *
 * Half a semicircle — the worst a round trip can do — is 4.19e-8 degrees, so
 * this bound has slack in it deliberately. It is a promise about the encoding
 * rather than a fingerprint of the current rounding mode.
 */
const TOLERANCE_DEGREES = 1e-7;

/** Places chosen so that every combination of signs appears at least once. */
const PLACES = [
  ['London — negative longitude', 51.5074, -0.1278],
  ['Santiago — negative latitude AND negative longitude', -33.4489, -70.6693],
  ['Sydney — negative latitude, positive longitude', -33.8688, 151.2093],
  ['Lyon — both positive', 45.764, 4.8357],
  ['Null Island', 0, 0],
] as const;

describe('the FIT semicircle encoding round-trips', () => {
  it.each(PLACES)('%s', (_, latitude, longitude) => {
    const encodedLatitude = degreesLatitudeToSemicircles(degreesLatitude(latitude));
    const encodedLongitude = degreesLongitudeToSemicircles(degreesLongitude(longitude));

    expect(semicirclesToDegreesLatitude(encodedLatitude)).toBeCloseTo(latitude, 7);
    expect(semicirclesToDegreesLongitude(encodedLongitude)).toBeCloseTo(longitude, 7);

    // toBeCloseTo(x, 7) is a bound of 5e-8; state the documented one explicitly
    // as well, so the precision this package promises is the thing asserted.
    expect(Math.abs(semicirclesToDegreesLatitude(encodedLatitude) - latitude)).toBeLessThan(
      TOLERANCE_DEGREES,
    );
    expect(Math.abs(semicirclesToDegreesLongitude(encodedLongitude) - longitude)).toBeLessThan(
      TOLERANCE_DEGREES,
    );
  });

  it('keeps a southern, western point in the southern and western hemispheres', () => {
    // The failure this guards against does not change the magnitude, so a test
    // comparing absolute values would pass over it.
    const encoded = degreesLatitudeToSemicircles(degreesLatitude(-33.4489));
    expect(encoded).toBeLessThan(0);
    expect(semicirclesToDegreesLatitude(encoded)).toBeLessThan(0);

    const encodedLongitude = degreesLongitudeToSemicircles(degreesLongitude(-70.6693));
    expect(encodedLongitude).toBeLessThan(0);
    expect(semicirclesToDegreesLongitude(encodedLongitude)).toBeLessThan(0);
  });
});

describe('the semicircle scale factor', () => {
  // -45 degrees is exactly a quarter turn, so this is an exact-integer
  // assertion rather than an approximate one: 2^31 / 4.
  it('encodes -45 degrees of latitude as exactly -2^29 semicircles', () => {
    expect(degreesLatitudeToSemicircles(degreesLatitude(-45))).toBe(-536870912);
  });

  it('encodes +45 degrees of latitude as exactly +2^29 semicircles', () => {
    expect(degreesLatitudeToSemicircles(degreesLatitude(45))).toBe(536870912);
  });

  it('decodes -2^29 semicircles as exactly -45 degrees', () => {
    expect(semicirclesToDegreesLatitude(latitudeSemicircles(-536870912))).toBe(-45);
  });

  it('is 180 degrees per half turn', () => {
    expect(DEGREES_PER_SEMICIRCLE * SEMICIRCLES_PER_HALF_TURN).toBe(180);
  });
});

describe('the sint32 range', () => {
  it('decodes the most negative sint32 as exactly -180 degrees of longitude', () => {
    expect(semicirclesToDegreesLongitude(longitudeSemicircles(SEMICIRCLES_MIN))).toBe(-180);
  });

  it('encodes -180 degrees as the most negative sint32, without clamping', () => {
    expect(degreesLongitudeToSemicircles(degreesLongitude(-180))).toBe(SEMICIRCLES_MIN);
  });

  it('clamps +180 degrees to the largest sint32 rather than overflowing to -180', () => {
    // 180 scales to 2^31, one past the end of a sint32. Wrapping would put a
    // track crossing the antimeridian on the far side of the map.
    const encoded = degreesLongitudeToSemicircles(degreesLongitude(180));
    expect(encoded).toBe(SEMICIRCLES_MAX);
    expect(encoded).toBeGreaterThan(0);
    expect(semicirclesToDegreesLongitude(longitudeSemicircles(encoded))).toBeCloseTo(180, 6);
  });

  it('rejects a semicircle value past the end of a sint32', () => {
    expect(() => longitudeSemicircles(SEMICIRCLES_MAX + 1)).toThrow(UnitError);
    expect(() => longitudeSemicircles(SEMICIRCLES_MIN - 1)).toThrow(UnitError);
  });

  it('rejects a negative field that was read as unsigned — the classic sint32 misread', () => {
    // -536870912 read out of a buffer as uint32 rather than sint32.
    const misread = 4294967296 - 536870912;
    expect(() => latitudeSemicircles(misread)).toThrow(UnitError);
  });

  it('rejects a fractional semicircle value', () => {
    expect(() => latitudeSemicircles(1.5)).toThrow(UnitError);
  });
});

describe('latitude and longitude are not interchangeable', () => {
  it('rejects a semicircle value that decodes past the pole', () => {
    // A longitude of about 143 degrees. Offering it to the latitude decoder is
    // now a COMPILE error rather than a runtime one -- the label carries.
    const semicircles = degreesLongitudeToSemicircles(degreesLongitude(143));

    // Both properties on one call: the @ts-expect-error pins the COMPILE error
    // (and fails the build if the brand is ever removed), while toThrow pins the
    // runtime behaviour for a caller who casts past it.
    expect(() =>
      // @ts-expect-error a longitude in semicircles is not a latitude.
      semicirclesToDegreesLatitude(semicircles),
    ).toThrow(UnitError);

    // Re-labelling it deliberately is caught too, because 143 degrees is past
    // the pole.
    expect(() => latitudeSemicircles(semicircles)).toThrow(UnitError);
    expect(semicirclesToDegreesLongitude(semicircles)).toBeCloseTo(143, 7);
  });
});

describe('semicirclesToPosition', () => {
  it('builds a position from a pair of fields, latitude first', () => {
    const latitude = degreesLatitudeToSemicircles(degreesLatitude(-33.4489));
    const longitude = degreesLongitudeToSemicircles(degreesLongitude(-70.6693));

    const position = semicirclesToPosition(latitude, longitude);

    expect(position.latitude).toBeCloseTo(-33.4489, 7);
    expect(position.longitude).toBeCloseTo(-70.6693, 7);
  });

  // This is the entry point packages/fit (#30, #31) calls from a decode loop,
  // where position_lat and position_long sit one field apart and are both
  // sint32. It is the more dangerous of the two constructors, not the less.
  //
  // The test this replaced chose -170.6693 -- outside +/-90 -- so it passed on
  // the RANGE rule while being named for swap protection. A European pair has
  // no such tell: both values are valid in each other's role.
  it('makes a transposed European pair a COMPILE error, not a runtime one', () => {
    const latitude = degreesLatitudeToSemicircles(degreesLatitude(51.5074)); // London
    const longitude = degreesLongitudeToSemicircles(degreesLongitude(-0.1278));

    // @ts-expect-error the label is the guarantee. If this stops erroring, the
    // directive itself fails the build, so the guard cannot rot silently.
    semicirclesToPosition(longitude, latitude);

    // Neither value is out of range in the swapped role, so no runtime check
    // could have caught this pair -- which is why the type must.
    const position = semicirclesToPosition(latitude, longitude);
    expect(position.latitude).toBeCloseTo(51.5074, 7);
    expect(position.longitude).toBeCloseTo(-0.1278, 7);
  });
});
