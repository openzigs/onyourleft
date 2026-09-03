// SPDX-License-Identifier: Apache-2.0

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  assertInsideSyntheticTestRegion,
  isInsideSyntheticTestRegion,
  SYNTHETIC_TEST_REGION_IDS,
  SYNTHETIC_TEST_REGIONS,
  SyntheticTestRegionError,
  syntheticTestRegionOf,
} from './synthetic-test-regions';

const at = (latitude: number, longitude: number) =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

describe('the declared regions', () => {
  it('is exactly the three regions ADR 0004 decision G names', () => {
    expect(SYNTHETIC_TEST_REGIONS.map((region) => region.id)).toEqual([
      'NULL-ISLAND',
      'ANTIMERIDIAN-EAST',
      'ANTIMERIDIAN-WEST',
      'POINT-NEMO',
    ]);
    expect(SYNTHETIC_TEST_REGION_IDS).toEqual([
      'NULL-ISLAND',
      'ANTIMERIDIAN-EAST',
      'ANTIMERIDIAN-WEST',
      'POINT-NEMO',
    ]);
  });

  it('gives every region a recorded reason it contains no land', () => {
    for (const region of SYNTHETIC_TEST_REGIONS) {
      expect(region.noLandBecause.length).toBeGreaterThan(20);
    }
  });

  it('holds the bounds ADR 0004 decision G tabulates', () => {
    const bounds = SYNTHETIC_TEST_REGIONS.map((region) => [
      region.id,
      region.minimumLatitude,
      region.maximumLatitude,
      region.minimumLongitude,
      region.maximumLongitude,
    ]);
    expect(bounds).toEqual([
      ['NULL-ISLAND', -1, 1, -1, 1],
      ['ANTIMERIDIAN-EAST', -1, 1, 179, 180],
      ['ANTIMERIDIAN-WEST', -1, 1, -180, -179],
      ['POINT-NEMO', -49, -48, -124, -123],
    ]);
  });
});

describe('isInsideSyntheticTestRegion', () => {
  it('accepts a position in the middle of each region', () => {
    expect(isInsideSyntheticTestRegion(at(0, 0))).toBe(true);
    expect(isInsideSyntheticTestRegion(at(0.5, 179.5))).toBe(true);
    expect(isInsideSyntheticTestRegion(at(-0.5, -179.5))).toBe(true);
    expect(isInsideSyntheticTestRegion(at(-48.5, -123.5))).toBe(true);
  });

  it('accepts every corner of every region, because the bounds are inclusive', () => {
    for (const region of SYNTHETIC_TEST_REGIONS) {
      for (const latitude of [region.minimumLatitude, region.maximumLatitude]) {
        for (const longitude of [region.minimumLongitude, region.maximumLongitude]) {
          expect(isInsideSyntheticTestRegion(at(latitude, longitude))).toBe(true);
        }
      }
    }
  });

  it('rejects a position one step outside each edge of every region', () => {
    const step = 1e-6;
    // Two of the boxes are flush against the edge of the coordinate system —
    // ANTIMERIDIAN-EAST ends at +180 and ANTIMERIDIAN-WEST begins at -180 —
    // and one step past those is not a longitude at all, so `degreesLongitude`
    // rejects it before this module ever sees it. Those edges are skipped
    // rather than fudged, and the count below is what stops the skip from
    // quietly swallowing the whole test.
    const representableLatitude = (value: number) => value >= -90 && value <= 90;
    const representableLongitude = (value: number) => value >= -180 && value <= 180;
    let checked = 0;

    for (const region of SYNTHETIC_TEST_REGIONS) {
      const midLatitude = (region.minimumLatitude + region.maximumLatitude) / 2;
      const midLongitude = (region.minimumLongitude + region.maximumLongitude) / 2;

      for (const latitude of [region.minimumLatitude - step, region.maximumLatitude + step]) {
        if (!representableLatitude(latitude)) continue;
        expect(syntheticTestRegionOf(at(latitude, midLongitude))?.id).not.toBe(region.id);
        checked += 1;
      }
      for (const longitude of [region.minimumLongitude - step, region.maximumLongitude + step]) {
        if (!representableLongitude(longitude)) continue;
        expect(syntheticTestRegionOf(at(midLatitude, longitude))?.id).not.toBe(region.id);
        checked += 1;
      }
    }

    // Four regions, four edges each, minus the two that run off the ends of the
    // longitude axis.
    expect(checked).toBe(14);
  });

  // This is the test the guard exists for. Each of these is a real, populated
  // place; three of them are places a contributor to this project might
  // plausibly ride. None came from a ride file — they are public city-centre
  // references, the same kind packages/domain and ADR 0004 already use.
  it.each([
    ['London', 51.5074, -0.1278],
    ['Girona', 41.9794, 2.8214],
    ['Boulder', 40.015, -105.2705],
    ['Melbourne', -37.8136, 144.9631],
    ['Cape Town', -33.9249, 18.4241],
    // Latitude inside NULL-ISLAND, longitude nowhere near it: a position that
    // passes a check written as "latitude OR longitude is in range".
    ['São Tomé latitude, Nairobi longitude', 0.3365, 36.8219],
    // The mirror case, and the one a longitude-only check waves through.
    ['Nairobi latitude, São Tomé longitude', -1.2921, 6.7273],
  ])('rejects %s', (_name, latitude, longitude) => {
    expect(isInsideSyntheticTestRegion(at(latitude, longitude))).toBe(false);
    expect(syntheticTestRegionOf(at(latitude, longitude))).toBeUndefined();
  });

  it('rejects the antimeridian latitude band at a mid-Pacific longitude', () => {
    // Inside the ANTIMERIDIAN latitude band but 100 degrees from its longitude
    // band, which is Kiribati rather than open ocean.
    expect(isInsideSyntheticTestRegion(at(0.5, 79.5))).toBe(false);
  });
});

describe('assertInsideSyntheticTestRegion', () => {
  it('returns for a position inside a region', () => {
    expect(() => {
      assertInsideSyntheticTestRegion(at(0, 0), 'nominal-outdoor-ride.fit', 0);
    }).not.toThrow();
  });

  it('throws SyntheticTestRegionError naming the fixture and the index', () => {
    let thrown: unknown;
    try {
      assertInsideSyntheticTestRegion(at(51.5074, -0.1278), 'someones-commute.fit', 7);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyntheticTestRegionError);
    expect((thrown as Error).message).toContain('someones-commute.fit');
    expect((thrown as Error).message).toContain('position 7');
  });

  // ADR 0004 decision D: an error message is a boundary, and for coordinates
  // the rule is the field and the constraint, never the value. This guard fires
  // exactly when a real coordinate is present, so a message that printed the
  // offending value would publish the one thing the guard exists to keep out —
  // into a CI log that is public on this repository.
  it('puts no part of the offending coordinate in the message', () => {
    let message = '';
    try {
      assertInsideSyntheticTestRegion(at(51.5074, -0.1278), 'someones-commute.fit', 7);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('51.5074');
    expect(message).not.toContain('0.1278');
    expect(message).not.toContain('51.5');
    // No decimal number at all: the fixture name and the index are the only
    // numbers a reader needs, and "7" is the index.
    expect(message).not.toMatch(/\d+\.\d+/);
  });

  it('names the regions a contributor is allowed to move the fixture into', () => {
    let message = '';
    try {
      assertInsideSyntheticTestRegion(at(51.5074, -0.1278), 'someones-commute.fit', 7);
    } catch (error) {
      message = (error as Error).message;
    }
    for (const id of SYNTHETIC_TEST_REGION_IDS) {
      expect(message).toContain(id);
    }
  });
});
