// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { distanceBetween, EARTH_MEAN_RADIUS_METRES } from './geodesy';
import { degreesLatitude, degreesLongitude, geographicPosition } from './quantities';
import { UnitError } from './unit-error';

function at(latitude: number, longitude: number) {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

describe('distanceBetween — the properties a zone test rests on', () => {
  it('is exactly zero for a point and itself', () => {
    // Not "close to zero": `sharedTrack` compares this against a radius, and a
    // distance that is 1e-9 for a point and itself is a distance that could be
    // negative for another pair under a different formula. The zone centre is
    // the one point every zone test uses.
    expect(distanceBetween(at(51.5074, -0.1278), at(51.5074, -0.1278))).toBe(0);
  });

  it('is symmetric, so "inside the zone" cannot depend on argument order', () => {
    const home = at(51.5074, -0.1278);
    const away = at(51.5121, -0.1201);
    expect(distanceBetween(home, away)).toBe(distanceBetween(away, home));
  });

  it('grows with separation rather than merely differing', () => {
    const origin = at(0, 0);
    const near = at(0, 0.001);
    const far = at(0, 0.01);
    expect(distanceBetween(origin, near)).toBeLessThan(distanceBetween(origin, far));
  });
});

describe('distanceBetween — the numbers, against independently known values', () => {
  it('measures one degree of latitude at the equator as the meridian arc', () => {
    // A degree of arc on a sphere of radius R is R * pi / 180 by definition, so
    // this is a check against the model rather than against another
    // implementation of it: 6371008.8 * pi / 180 = 111194.9 m.
    const expected = (EARTH_MEAN_RADIUS_METRES * Math.PI) / 180;
    expect(distanceBetween(at(0, 0), at(1, 0))).toBeCloseTo(expected, 3);
  });

  it('shortens a degree of longitude by cos(latitude)', () => {
    // At 60 degrees north a degree of longitude is half what it is at the
    // equator, exactly, because cos(60) = 1/2. This is the term a haversine
    // implementation that forgot `cos(lat)` would get wrong, and it would get
    // every equatorial fixture right while doing so.
    const atEquator = distanceBetween(at(0, 0), at(0, 1));
    const atSixty = distanceBetween(at(60, 0), at(60, 1));
    expect(atSixty / atEquator).toBeCloseTo(0.5, 5);
  });

  it('measures London to Paris to within the spherical model’s stated error', () => {
    // London (51.5074 N, 0.1278 W) to Paris (48.8566 N, 2.3522 E). The
    // published great-circle distance is about 343.5 km; the WGS 84 geodesic is
    // about 343.6 km. The module note claims the spherical model is within
    // ~0.5% and this holds it to 0.2%, which is a real bound rather than a
    // restatement of whatever this code returns.
    const measured = distanceBetween(at(51.5074, -0.1278), at(48.8566, 2.3522));
    expect(measured).toBeGreaterThan(343_000);
    expect(measured).toBeLessThan(344_500);
  });

  it('handles an antipodal pair without producing NaN', () => {
    // The `Math.min(1, …)` clamp. Without it the sum inside the square root can
    // exceed 1 by a few ulps here and `asin` returns NaN — which compares false
    // against every radius, so every point would be reported outside every
    // privacy zone. A silent leak, not a crash.
    const half = Math.PI * EARTH_MEAN_RADIUS_METRES;
    const measured = distanceBetween(at(0, 0), at(0, 180));
    expect(Number.isNaN(measured)).toBe(false);
    expect(measured).toBeCloseTo(half, 0);
  });

  it('measures a 1 Hz sample step at road speed, where the law of cosines would lose precision', () => {
    // Roughly 8 m apart — one second at 30 km/h. This is the separation the
    // formula is actually called at, thousands of times per ride.
    const step = distanceBetween(at(51.5074, -0.1278), at(51.507_472, -0.1278));
    expect(step).toBeGreaterThan(7);
    expect(step).toBeLessThan(9);
  });
});

describe('distanceBetween — a non-finite coordinate is refused, and says nothing', () => {
  for (const [what, bad] of [
    ['latitude', { latitude: Number.NaN, longitude: -0.1278 }],
    ['longitude', { latitude: 51.5074, longitude: Number.POSITIVE_INFINITY }],
  ] as const) {
    it(`throws on a non-finite ${what} rather than returning NaN`, () => {
      // NaN is the dangerous return here: it compares false against every
      // radius, so a track point with a corrupt coordinate would be judged
      // *outside* every privacy zone and published.
      const corrupt = bad as unknown as ReturnType<typeof at>;
      expect(() => distanceBetween(corrupt, at(0, 0))).toThrow(UnitError);
    });
  }

  it('names the field and the constraint and never the value — ADR 0004 decision D', () => {
    const corrupt = { latitude: 51.5074, longitude: 1234.5678 } as unknown as ReturnType<typeof at>;
    let message = '';
    try {
      distanceBetween(corrupt, { ...corrupt, longitude: Number.NaN } as typeof corrupt);
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('longitude in degrees');
    expect(message).toContain('must be a finite number');
    // The value is a coordinate and does not appear. `1234.5678` is not a real
    // position, but the rule is applied from the field label rather than from a
    // range check, so a real one would be redacted by the same code path.
    expect(message).not.toContain('1234');
  });
});
