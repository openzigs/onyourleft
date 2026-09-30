// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ADR 0021 D-5.2 (#793): an attempt whose rider's privacy-zone trim touches
 * the raced route is not offered — a zone at the start, in the middle and at
 * the finish, and the control, a zone off the route, which is offered.
 */

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  type GeographicPosition,
} from '@onyourleft/domain';

import { TRIM_JITTER_FRACTION } from './privacy';
import { offeredAsGhost, trimTouchesRoute, widestTrimRadius, type RaceZone } from './race-consent';

/** Metres per degree of latitude, near enough for a fixture. */
const METRES_PER_DEGREE = 111_195;

const at = (latitude: number, longitude: number): GeographicPosition =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

/**
 * A 10 km route due north from 51.5° N, sampled every 500 m — sparse on
 * purpose, so a zone can sit between two samples.
 */
const ROUTE: readonly GeographicPosition[] = Array.from({ length: 21 }, (_unused, index) =>
  at(51.5 + (index * 500) / METRES_PER_DEGREE, -0.12),
);

/** A zone of `radius` metres, `east` metres east of the route at `north` metres along it. */
function zone(north: number, east: number, radius = 200): RaceZone {
  const latitude = 51.5 + north / METRES_PER_DEGREE;
  const longitude = -0.12 + east / (METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  return { centre: at(latitude, longitude), radius: metres(radius) };
}

describe('a ghost whose rider’s trim touches the raced route is not offered — ADR 0021 D-5.2', () => {
  it('refuses a zone at the start', () => {
    expect(offeredAsGhost(ROUTE, [zone(0, 0)])).toBe(false);
  });

  it('refuses a zone in the middle', () => {
    expect(offeredAsGhost(ROUTE, [zone(5000, 50)])).toBe(false);
  });

  it('refuses a zone at the finish', () => {
    expect(offeredAsGhost(ROUTE, [zone(10_000, -30)])).toBe(false);
  });

  it('offers the ride when every zone is off the route — the control', () => {
    expect(offeredAsGhost(ROUTE, [zone(5000, 2000), zone(-3000, 0)])).toBe(true);
  });

  it('offers the ride to a rider with no zones', () => {
    expect(offeredAsGhost(ROUTE, [])).toBe(true);
  });

  it('refuses when ANY zone touches, not only the first', () => {
    expect(offeredAsGhost(ROUTE, [zone(5000, 2000), zone(7000, 0)])).toBe(false);
  });

  it('sees a zone the road runs through BETWEEN two samples', () => {
    // 250 m along: exactly between the samples at 0 and 500 m, each 250 m from
    // the centre — outside a 200 m zone's widest trim (225 m). Tested against
    // the samples alone this would be offered; the road passes through it.
    const between = zone(250, 0);
    expect(ROUTE.some((point) => trimTouchesRoute([point], [between]))).toBe(false);
    expect(offeredAsGhost(ROUTE, [between])).toBe(false);
  });

  it('refuses at the widest a trim can reach, not at the nominal radius', () => {
    // 210 m to the side: outside the 200 m radius, inside its 225 m widest trim.
    expect(widestTrimRadius(zone(0, 0))).toBeCloseTo(200 * (1 + TRIM_JITTER_FRACTION), 9);
    expect(offeredAsGhost(ROUTE, [zone(5000, 210)])).toBe(false);
    // And 240 m to the side is outside that too.
    expect(offeredAsGhost(ROUTE, [zone(5000, 240)])).toBe(true);
  });

  it('tests a one-point route at its point, and a route with none touches nothing', () => {
    expect(trimTouchesRoute([ROUTE[0]!], [zone(0, 100)])).toBe(true);
    expect(trimTouchesRoute([ROUTE[0]!], [zone(0, 400)])).toBe(false);
    expect(trimTouchesRoute([], [zone(0, 0)])).toBe(false);
  });
});
