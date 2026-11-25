// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  metres,
  type GeographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { reachesItsWaypoints, WAYPOINT_REACH_METRES } from './reach';

// Synthetic points off Null Island: no road, no place.
const at = (latitude: number, longitude: number): GeographicPosition =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

const FROM = at(0.05, 0.05);
const TO = at(0.06, 0.05);

/** A point `distance` metres north of `point`, near enough to the equator for a degree to be 111.2 km. */
function northOf(point: GeographicPosition, distance: number): GeographicPosition {
  return at(point.latitude + distance / 111_195, point.longitude);
}

const leg = (shape: readonly GeographicPosition[]) => ({
  shape,
  distance: metres(1_200),
  surface: 'unknown' as const,
});

describe('whether a leg reaches its waypoints (#3179)', () => {
  it('holds for a line from one waypoint to the other, and for one that snapped a short way', () => {
    expect(reachesItsWaypoints(leg([FROM, at(0.055, 0.051), TO]), FROM, TO)).toBe(true);
    const near = northOf(FROM, WAYPOINT_REACH_METRES - 5);
    expect(distanceBetween(near, FROM)).toBeLessThan(WAYPOINT_REACH_METRES);
    expect(reachesItsWaypoints(leg([near, TO]), FROM, TO)).toBe(true);
  });

  it('fails a line that starts further than the reach from its first waypoint', () => {
    const away = northOf(FROM, WAYPOINT_REACH_METRES + 5);
    expect(distanceBetween(away, FROM)).toBeGreaterThan(WAYPOINT_REACH_METRES);
    expect(reachesItsWaypoints(leg([away, TO]), FROM, TO)).toBe(false);
  });

  it('fails a line that ends further than the reach from its second waypoint', () => {
    const short = northOf(TO, -(WAYPOINT_REACH_METRES + 5));
    expect(reachesItsWaypoints(leg([FROM, short]), FROM, TO)).toBe(false);
  });

  it('fails a line that ends tens of kilometres away, as Valhalla answers a waypoint with no road near it', () => {
    expect(reachesItsWaypoints(leg([FROM, at(0.3, 0.05)]), FROM, TO)).toBe(false);
  });

  it('fails a leg with no line at all', () => {
    expect(reachesItsWaypoints(leg([]), FROM, TO)).toBe(false);
  });
});
