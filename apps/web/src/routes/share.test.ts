// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #73 criterion 6, and the asymmetry between a ride and a route.
 *
 * Every assertion here is on the **raw shared representation** — the object a
 * reader elsewhere would receive — and never on what a component rendered from
 * it. The criterion says so in terms, and the reason is that a renderer that
 * hides a point still received it: a payload trimmed only at the point of
 * drawing is not trimmed.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';
import {
  athleteId,
  privacyZoneId,
  routeId,
  type PrivacyZoneRecord,
  type RouteRecord,
} from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { PUBLIC_ROUTE_WARNING, ROUTE_SHARE_FAULT_TEXT, routeShare } from './share';

const ATHLETE = athleteId('athlete-a');
const METRES_PER_DEGREE_LATITUDE = 111_194.93;

/** Home, near enough — the same anchor `detail/privacy.test.ts` uses. */
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

function zone(overrides: Partial<PrivacyZoneRecord> = {}): PrivacyZoneRecord {
  return {
    id: privacyZoneId('home'),
    athleteId: ATHLETE,
    centre: HOME,
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(1),
    ...overrides,
  };
}

/** A route running due north from `from`, so distance from HOME is the latitude offset. */
function northRoute(
  lengthMetres: number,
  fromMetresNorth: number,
  name = 'Morning loop',
): RouteRecord {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= lengthMetres; along += 20) {
    points.push({
      position: geographicPosition(
        degreesLatitude(HOME.latitude + (fromMetresNorth + along) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(HOME.longitude),
      ),
      elevation: undefined,
    });
  }
  // No elevation anywhere would be refused, so give the route a flat one.
  const flat = points.map((point) => ({ ...point, elevation: altitudeMetres(30) }));
  return {
    id: routeId('route-1'),
    createdBy: ATHLETE,
    name,
    profile: routeProfile(flat),
    visibility: 'private',
    createdAt: unixSeconds(1),
  };
}

describe('a route that never goes near a zone', () => {
  it('is shared whole and is usable', () => {
    // Starts 2 km north of home and runs further north.
    const share = routeShare(northRoute(1000, 2000), [zone()]);
    expect(share.usable).toBe(true);
    expect(share.faults).toEqual([]);
    expect(share.track.trimmedPoints).toBe(0);
    expect(share.track.segments).toHaveLength(1);
    expect(share.name).toBe('Morning loop');
    // The zone was applied and withheld nothing, which is a different fact from
    // having no zones at all.
    expect(share.track.zonesApplied).toBe(1);
  });

  it('is trimmed in the payload when it does, with nothing withheld left in it', () => {
    // Starts inside the 500 m zone and runs out of it.
    const share = routeShare(northRoute(3000, 0), [zone()]);
    expect(share.track.trimmedPoints).toBeGreaterThan(0);
    // Walk the WHOLE returned structure: no emitted point may lie inside the
    // zone, in any field, however the segments happen to be split.
    for (const segment of share.track.segments) {
      for (const point of segment.points) {
        const north = (point.position.latitude - HOME.latitude) * METRES_PER_DEGREE_LATITUDE;
        expect(north).toBeGreaterThan(400);
      }
    }
  });
});

describe('the asymmetry #73 names — a route is not a ride', () => {
  it('refuses a route whose START is inside a zone, and says which end', () => {
    // A ride whose first kilometre is withheld is still a shareable ride. A
    // route whose first sample is withheld is not the route any more: "there is
    // no 'hide the first 200 m' that leaves a usable route".
    const share = routeShare(northRoute(3000, 0), [zone()]);
    expect(share.usable).toBe(false);
    expect(share.faults).toContain('start-withheld');
    expect(share.faults).not.toContain('end-withheld');
    expect(ROUTE_SHARE_FAULT_TEXT['start-withheld']).toContain('would not be this route');
  });

  it('refuses a route whose END is inside a zone', () => {
    // Runs from 3 km north back down to home: the zone is at the finish.
    const points: RoutePoint[] = [];
    for (let along = 3000; along >= 0; along -= 20) {
      points.push({
        position: geographicPosition(
          degreesLatitude(HOME.latitude + along / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(HOME.longitude),
        ),
        elevation: altitudeMetres(30),
      });
    }
    const homeward: RouteRecord = {
      id: routeId('route-2'),
      createdBy: ATHLETE,
      name: 'Homeward',
      profile: routeProfile(points),
      visibility: 'private',
      createdAt: unixSeconds(1),
    };
    const share = routeShare(homeward, [zone()]);
    expect(share.usable).toBe(false);
    expect(share.faults).toContain('end-withheld');
    expect(share.faults).not.toContain('start-withheld');
  });

  it('reports both ends when a loop begins and finishes at home', () => {
    // The commonest real case, and the one a rider is most likely to try to
    // share: out from the front door and back to it.
    const points: RoutePoint[] = [];
    for (let along = 0; along <= 3000; along += 20) {
      points.push({
        position: geographicPosition(
          degreesLatitude(HOME.latitude + along / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(HOME.longitude),
        ),
        elevation: altitudeMetres(30),
      });
    }
    for (let along = 2980; along >= 0; along -= 20) {
      points.push({
        position: geographicPosition(
          degreesLatitude(HOME.latitude + along / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(HOME.longitude + 0.0004),
        ),
        elevation: altitudeMetres(30),
      });
    }
    const outAndBack: RouteRecord = {
      id: routeId('route-3'),
      createdBy: ATHLETE,
      name: 'Out and back',
      profile: routeProfile(points),
      visibility: 'private',
      createdAt: unixSeconds(1),
    };
    const share = routeShare(outAndBack, [zone()]);
    expect(share.usable).toBe(false);
    expect(share.faults).toEqual(['start-withheld', 'end-withheld']);
  });

  it('reports nothing-remains rather than two end faults when the zone swallows it', () => {
    // A message about the ends would be misleading here: there are no ends.
    const share = routeShare(northRoute(200, 0), [zone({ radius: metres(5000) })]);
    expect(share.faults).toEqual(['nothing-remains']);
    expect(share.track.segments).toEqual([]);
    expect(ROUTE_SHARE_FAULT_TEXT['nothing-remains']).toContain('empty');
  });
});

describe('the warning a rider sees before publishing', () => {
  it('names the risk rather than the category — #73 criterion 5', () => {
    // "A generic 'this will be public' notice does not convey the actual risk."
    expect(PUBLIC_ROUTE_WARNING).toContain('where it starts');
    expect(PUBLIC_ROUTE_WARNING).toContain('where it ends');
    expect(PUBLIC_ROUTE_WARNING).toContain('start at home');
  });

  it('says a route that begins in a zone cannot be shared at all', () => {
    // The half a rider would otherwise assume away: a privacy zone protects a
    // ride by trimming it, and cannot protect a route the same way.
    expect(PUBLIC_ROUTE_WARNING).toContain('cannot be shared at all');
  });
});
