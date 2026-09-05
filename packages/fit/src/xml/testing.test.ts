// SPDX-License-Identifier: Apache-2.0

/**
 * ADR 0004 decision G, applied to the coordinates in a test file.
 *
 * > No file recorded by a real device from a real ride may be committed to this
 * > repository, **referenced by a test**, or used as the evidence for any
 * > acceptance criterion in this program.
 *
 * `tools/fixture-corpus/synthetic-region-guard.test.ts` makes that mechanical
 * for the committed corpus. This is the same check for the activity builder
 * `gpx.test.ts` and `tcx.test.ts` construct in memory, which the corpus guard
 * never sees because it is not a file.
 */

import { describe, expect, it } from 'vitest';

import { assertInsideSyntheticTestRegion, syntheticTestRegionOf } from '../synthetic-test-regions';
import { indoorActivity, sampleActivity, samplePoint } from './testing';
import { trackPointsOf } from './track';

describe('the synthetic activity these tests are built from', () => {
  it('has every coordinate inside a declared synthetic test region', () => {
    const points = trackPointsOf(sampleActivity());
    expect(points.length).toBeGreaterThan(10);
    points.forEach((point, index) => {
      expect(point.position).toBeDefined();
      if (point.position) {
        assertInsideSyntheticTestRegion(point.position, 'src/xml/testing.ts', index);
      }
    });
  });

  it('has a latitude and a longitude that are different numbers', () => {
    // Otherwise a transposition is invisible: the writer swaps the two, the
    // reader swaps them back, and every round-trip assertion in gpx.test.ts and
    // tcx.test.ts passes over a file that is wrong. See `positionAt`.
    for (const index of [0, 1, 9, 17]) {
      const position = samplePoint(index).position;
      expect(position).toBeDefined();
      expect(position?.latitude).not.toBe(position?.longitude);
    }
    // And they move at different rates, so a swap cannot be absorbed by an
    // offset either.
    expect(
      samplePoint(1).position?.latitude ?? 0 - (samplePoint(0).position?.latitude ?? 0),
    ).not.toBe(samplePoint(1).position?.longitude ?? 0 - (samplePoint(0).position?.longitude ?? 0));
  });

  it('is in NULL-ISLAND specifically, so the region is one and not four', () => {
    const first = samplePoint(0).position;
    expect(first).toBeDefined();
    expect(first && syntheticTestRegionOf(first)?.id).toBe('NULL-ISLAND');
  });

  it('has no coordinate at all in the indoor variant', () => {
    for (const point of trackPointsOf(indoorActivity())) {
      expect(point.position).toBeUndefined();
    }
    // Every other channel is still there, so the indoor builder is not simply
    // an empty ride.
    expect(trackPointsOf(indoorActivity())[0]?.power).toBeDefined();
  });
});
