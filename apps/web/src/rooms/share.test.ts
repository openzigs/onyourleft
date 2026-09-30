// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  unixSeconds,
  type RouteProfile,
} from '@onyourleft/domain';
import { decodeGpxRoute } from '@onyourleft/fit';
import { athleteId, privacyZoneId, type PrivacyZoneRecord } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { coordinatesIn, insideZone } from '../privacy/boundaries';
import { ROUTE_SHARE_FAULT_TEXT } from '../routes/share';
import {
  MAXIMUM_ROOM_ROUTE_BYTES,
  ROOM_ROUTE_REFUSAL_TEXT,
  roomCourse,
  roomRouteFrom,
  routeDigest,
  sharedRoomRoute,
} from './share';

const METRES_PER_DEGREE_LATITUDE = 111_194.93;
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

function zone(centreMetresNorth: number, radius = 300): PrivacyZoneRecord {
  return {
    id: privacyZoneId(`zone-${String(centreMetresNorth)}`),
    athleteId: athleteId('athlete-a'),
    centre: geographicPosition(
      degreesLatitude(HOME.latitude + centreMetresNorth / METRES_PER_DEGREE_LATITUDE),
      degreesLongitude(HOME.longitude),
    ),
    radius: metres(radius),
    label: 'home',
    createdAt: unixSeconds(1),
  };
}

/** A route due north from HOME, climbing then falling, `length` metres long. */
function northRoute(length: number, every = 20): RouteProfile {
  const points = [];
  for (let along = 0; along <= length; along += every) {
    points.push({
      position: geographicPosition(
        degreesLatitude(HOME.latitude + along / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(HOME.longitude),
      ),
      elevation: altitudeMetres(20 + (along < length / 2 ? along : length - along) * 0.04),
    });
  }
  return routeProfile(points);
}

describe('the route a room rides — #784', () => {
  it('shares a route clear of every zone as GPX with no name, and everybody rides what the GPX reads back as', () => {
    const route = { id: 'route-1', profile: northRoute(3_000) };
    const shared = sharedRoomRoute(route, [zone(10_000)]);
    if (shared.kind !== 'shared') throw new Error(`refused: ${shared.reason}`);
    expect(shared.gpx).not.toMatch(/<name>/);
    expect(shared.gpx).not.toMatch(/<time>/);
    // The profile the creator rides IS the one the file reads back as.
    const readBack = decodeGpxRoute(shared.gpx).profile;
    expect(shared.profile.totalDistance).toBe(readBack.totalDistance);
    expect(shared.profile.grades).toEqual(readBack.grades);
    expect(shared.course).toEqual(roomCourse(readBack));
    expect(shared.course.lengthMetres).toBeCloseTo(3_000, -1);
    expect(shared.course.grades[0]?.[0]).toBe(0);
  });

  it('refuses a route that starts inside a zone with the route share’s own sentence, and builds nothing', () => {
    const answer = sharedRoomRoute({ id: 'route-1', profile: northRoute(3_000) }, [zone(0)]);
    expect(answer).toEqual({ kind: 'refused', reason: 'start-in-a-zone' });
    expect(ROOM_ROUTE_REFUSAL_TEXT['start-in-a-zone']).toBe(
      ROUTE_SHARE_FAULT_TEXT['start-withheld'],
    );
  });

  it('refuses a route that ends inside a zone, or passes through one on the way', () => {
    const route = { id: 'route-1', profile: northRoute(3_000) };
    expect(sharedRoomRoute(route, [zone(3_000)])).toEqual({
      kind: 'refused',
      reason: 'end-in-a-zone',
    });
    expect(sharedRoomRoute(route, [zone(1_500)])).toEqual({
      kind: 'refused',
      reason: 'through-a-zone',
    });
  });

  it('refuses a route too long for the instance before a byte is sent', () => {
    // 200 km on the profile's 10 m grid: twenty thousand points, past 900 KiB of GPX.
    const answer = sharedRoomRoute({ id: 'long', profile: northRoute(200_000, 500) }, []);
    expect(answer).toEqual({ kind: 'refused', reason: 'too-long' });
    expect(MAXIMUM_ROOM_ROUTE_BYTES).toBe(900 * 1024);
  });

  it('what departs carries no point inside any zone the rider has, anywhere in it', () => {
    const zones = [zone(10_000)];
    const shared = sharedRoomRoute({ id: 'route-1', profile: northRoute(3_000) }, zones);
    if (shared.kind !== 'shared') throw new Error('refused');
    // The GPX is text, which the walk cannot read, so its points are read back
    // out of it and walked as the departing boundary they are.
    const points = coordinatesIn(decodeGpxRoute(shared.gpx).profile.positions);
    expect(points.length).toBeGreaterThan(0);
    for (const each of zones) expect(insideZone(points, each, 'route-1')).toEqual([]);
  });
});

describe('a route that came from the room — #784', () => {
  it('rides a route whose bytes are the room’s routeRef, and refuses one that is not', async () => {
    const shared = sharedRoomRoute({ id: 'route-1', profile: northRoute(2_000) }, []);
    if (shared.kind !== 'shared') throw new Error('refused');
    const sha = await routeDigest(shared.gpx);
    const ridden = await roomRouteFrom(shared.gpx, sha, false);
    expect(ridden?.totalDistance).toBe(shared.profile.totalDistance);
    // One coordinate moved by a digit: not the room's route, not ridden.
    const tampered = shared.gpx.replace(/lat="51\.50740/, 'lat="51.50741');
    expect(tampered).not.toBe(shared.gpx);
    expect(await roomRouteFrom(tampered, sha, false)).toBeUndefined();
    expect(
      await roomRouteFrom('not a route', await routeDigest('not a route'), false),
    ).toBeUndefined();
  });
});
