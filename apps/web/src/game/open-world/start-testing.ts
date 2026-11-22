// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fixtures for the open-world start picker's tests — #2889. Test support only:
 * nothing in the product imports this file.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  routeId,
  type ActivitySummary,
  type AthleteId,
  type RouteRecord,
} from '@onyourleft/store';

import type { PreferenceStorage } from '../hud/announce-preference';
import { writeMapTilesChoice } from '../../map/tiles-preference';
import type { OpenWorldStartStore } from './start-port';

export const ME = athleteId('athlete-me');
export const THEM = athleteId('athlete-them');

export function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

export const DENVER = at(39.7392, -104.9903);
export const BOULDER = at(40.015, -105.2705);
export const GOLDEN = at(39.7555, -105.2211);
export const LONDON = at(51.5074, -0.1278);

/** A saved route whose first point is `start`, heading north. */
export function startRoute(
  owner: AthleteId,
  id: string,
  name: string,
  start: GeographicPosition,
): RouteRecord {
  const points = Array.from({ length: 20 }, (_, index) => ({
    position: at(start.latitude + index * 0.0002, start.longitude),
    elevation: altitudeMetres(1600),
  }));
  return {
    id: routeId(id),
    createdBy: owner,
    name,
    profile: routeProfile(points),
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  };
}

/** A past ride: its summary and its track. */
export interface StartRide {
  readonly summary: ActivitySummary;
  readonly track: readonly GeographicPosition[];
}

export function startRide(
  owner: AthleteId,
  id: string,
  name: string,
  start: GeographicPosition,
): StartRide {
  return {
    summary: {
      id: activityId(id),
      athleteId: owner,
      name,
      startedAt: unixSeconds(1_700_000_000),
      startedAtTimeZone: 'America/Denver',
      hasPosition: true,
    } as ActivitySummary,
    track: [start, at(start.latitude + 0.0001, start.longitude)],
  };
}

/** An in-memory store that scopes every read on the owner, as `ActivityStore` does. */
export function memoryStartStore(
  routes: readonly RouteRecord[],
  rides: readonly StartRide[],
): OpenWorldStartStore {
  return {
    listRoutes: (owner) => Promise.resolve(routes.filter((each) => each.createdBy === owner)),
    listActivitySummaries: (owner) =>
      Promise.resolve(
        rides.filter((each) => each.summary.athleteId === owner).map((each) => each.summary),
      ),
    getStreamChannel: ((owner: AthleteId, activity: string, channel: 'latitude' | 'longitude') => {
      const found = rides.find(
        (each) => each.summary.athleteId === owner && each.summary.id === activity,
      );
      return Promise.resolve(found?.track.map((point) => point[channel]));
    }) as OpenWorldStartStore['getStreamChannel'],
  };
}

/** Two athletes' routes and rides: the rider's own in Colorado and one abroad, and another's. */
export function twoAthletesStore(): OpenWorldStartStore {
  return memoryStartStore(
    [
      startRoute(ME, 'r-mine', 'Lookout loop', GOLDEN),
      startRoute(THEM, 'r-theirs', 'Their loop', BOULDER),
    ],
    [
      startRide(ME, 'a-mine', 'Morning spin', BOULDER),
      startRide(ME, 'a-abroad', 'Thames path', LONDON),
      startRide(THEM, 'a-theirs', 'Their ride', DENVER),
    ],
  );
}

/** A preference store with the map-tiles switch set. */
export function tilesPreference(tiles: boolean): PreferenceStorage {
  const held = new Map<string, string>();
  const storage: PreferenceStorage = {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
  };
  writeMapTilesChoice(storage, tiles);
  return storage;
}
