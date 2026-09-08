// SPDX-License-Identifier: Apache-2.0

/**
 * #89's second criterion, against the **committed** route fixture.
 *
 * > Importing a GPX file produces a profile whose total distance and total
 * > ascent match the source within a stated tolerance, asserted against a
 * > committed fixture.
 *
 * Read off disk rather than from the generator's return value, for
 * `xml-corpus.test.ts`'s reason: what is asserted has to be the artefact that
 * is committed and that CI checks out.
 *
 * **The stated tolerances are at the top of this file**, each with the thing it
 * is a tolerance for. They are not a fudge factor: a profile is a resampled,
 * despiked, fixed-grid approximation of the source and the difference between
 * it and the source is a real quantity, so the honest form of this criterion is
 * a bound on that difference rather than an equality nobody could hold to.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { distanceOnRoute, distanceBetween, elevationAt } from '@onyourleft/domain';

import { decodeGpxRoute } from '../../src/route';
import { decodeGpx } from '../../src/xml';
import { trackPointsOf } from '../../src/xml/track';
import { CORPUS_DIRECTORY } from './corpus-files';

/**
 * **0.1 %** of the route's length.
 *
 * The profile measures the same polyline the source describes, so the only
 * difference is the last grid step landing on the end — which the stretched
 * grid removes — and floating-point accumulation over 341 great-circle legs.
 * A tolerance this tight is what makes the assertion worth having: a resampler
 * that dropped or duplicated a leg would be several metres out, not fractions.
 */
const DISTANCE_TOLERANCE_FRACTION = 0.001;

/**
 * **2 %** of the route's ascent.
 *
 * Wider than the distance tolerance because a different mechanism can move it:
 * the despike stage is a median, and a median clips a *sharp* summit by about
 * one sample's rise. The bound is set at the size of that effect rather than at
 * whatever this fixture happens to measure.
 *
 * ⚠️ **This fixture does not exercise it**, and saying so is the point. Its
 * hill is a sine, so its summit is rounded and the median clips nothing — the
 * measured agreement is exact to floating point, which the test below pins
 * *as well as* the bound. The clipping case is asserted where a fixture can be
 * built for it, in `packages/domain`'s `profile.test.ts` under "close the run
 * the route ended in". A tolerance that has never been approached is a bound,
 * not evidence, and the two assertions are here so a reader can tell which is
 * which.
 */
const ASCENT_TOLERANCE_FRACTION = 0.02;

const text = readFileSync(join(CORPUS_DIRECTORY, 'planned-loop-route.gpx'), 'utf8');

/** The source's own totals, computed from the decoded points and nothing else. */
function sourceTotals(): { distance: number; ascent: number; descent: number } {
  const points = trackPointsOf(decodeGpx(text).activity);
  let distance = 0;
  let ascent = 0;
  let descent = 0;
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (previous === undefined) continue;
    if (previous.position !== undefined && point.position !== undefined) {
      distance += distanceBetween(previous.position, point.position);
    }
    if (previous.altitude !== undefined && point.altitude !== undefined) {
      const step = point.altitude - previous.altitude;
      if (step > 0) ascent += step;
      else descent -= step;
    }
  }
  return { distance, ascent, descent };
}

describe('the committed planned route', () => {
  it('is read from its <rte>, with no times and no track', () => {
    const { activity } = decodeGpx(text);
    const points = trackPointsOf(activity);
    expect(points.length).toBe(341);
    expect(activity.name).toBe('Synthetic fixture loop');
    // A route carries no time. If this ever starts passing timestamps through,
    // the fixture has become a ride and #89's import is testing the wrong thing.
    expect(points.every((point) => point.timestamp === undefined)).toBe(true);
    expect(activity.startTime).toBeUndefined();
  });

  it('produces a profile whose distance matches the source within 0.1 %', () => {
    const { profile } = decodeGpxRoute(text, { loop: true });
    const source = sourceTotals();
    expect(Math.abs(profile.totalDistance - source.distance)).toBeLessThan(
      source.distance * DISTANCE_TOLERANCE_FRACTION,
    );
    // ⚠️ What this half of the criterion can and cannot catch: the profile's
    // length is the length of the SAME polyline, so the two agree to the last
    // bit and the assertion is not measuring an approximation. What it does
    // catch is a resampler that lost, duplicated or reordered a leg — which is
    // the failure worth having a test for, and why the pin below is exact.
    expect(profile.totalDistance).toBeCloseTo(source.distance, 9);
    // And it is a real 5 km loop rather than a degenerate one.
    expect(profile.totalDistance).toBeGreaterThan(4800);
    expect(profile.totalDistance).toBeLessThan(5200);
  });

  it('produces a profile whose ascent matches the source within 2 %', () => {
    const { profile } = decodeGpxRoute(text, { loop: true });
    const source = sourceTotals();
    expect(Math.abs(profile.totalAscent - source.ascent)).toBeLessThan(
      source.ascent * ASCENT_TOLERANCE_FRACTION,
    );
    expect(Math.abs(profile.totalDescent - source.descent)).toBeLessThan(
      source.descent * ASCENT_TOLERANCE_FRACTION,
    );
    // The stated bound is 2 %; what is actually delivered on this route is
    // exact, and pinning it is what makes the test catch a regression rather
    // than absorb one. 60 m up and 60 m down, by construction.
    expect(profile.totalAscent).toBeCloseTo(60, 6);
    expect(profile.totalDescent).toBeCloseTo(60, 6);
    // A lap climbs what it descends, which is what makes it a loop rather than
    // a route that gains height forever.
    expect(profile.totalAscent).toBeCloseTo(profile.totalDescent, 6);
  });

  it('closes, so it can be ridden round again', () => {
    const { profile } = decodeGpxRoute(text, { loop: true });
    const lap = profile.totalDistance;
    expect(profile.loop).toBe(true);
    expect(distanceOnRoute(profile, lap + 250)).toBeCloseTo(250, 6);
    expect(elevationAt(profile, lap + 250)).toBeCloseTo(elevationAt(profile, 250), 6);
    // Second lap, third lap: the same place, not a drift.
    expect(elevationAt(profile, 3 * lap + 250)).toBeCloseTo(elevationAt(profile, 250), 6);
  });

  it('has irregularly spaced source points, which is what the resampling is for', () => {
    const points = trackPointsOf(decodeGpx(text).activity);
    const steps: number[] = [];
    for (const [index, point] of points.entries()) {
      const previous = points[index - 1];
      if (previous?.position === undefined || point.position === undefined) continue;
      steps.push(distanceBetween(previous.position, point.position));
    }
    // A fixture with an even spacing would leave the resampler untested by the
    // one file that exists to test it.
    expect(Math.max(...steps) / Math.min(...steps)).toBeGreaterThan(1.5);
  });
});
