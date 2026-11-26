// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a new route's map opens — #3184: where the rider rides, read from
 * this device's own store.
 *
 * The planner opened every new route on the whole contiguous US
 * (`map-edit.ts` §`EMPTY_PLANNER_VIEW`): on the tablet's 568 x 320 px map,
 * many pinches and pans from the first waypoint, and the wrong continent for
 * a rider anywhere else. The place this module answers is **the start of the
 * newer of the rider's newest saved route and newest ride with a recorded
 * position**, and nothing else: no geocoder (#2749 is separate), and no
 * question to the device's location service.
 *
 * ## The position stays on the device
 *
 * ⚠️ **Every read is the device's store, and nothing here sends, logs or
 * formats the position** (ADR 0004 D; the owner's lane scope on #3184,
 * 2026-11-25). The planner uses it only to choose what its map shows first;
 * the basemap tiles that view then loads are the ones the rider would have
 * loaded by panning there. `riding-place.test.ts` §"no request" holds that
 * with the network refused.
 *
 * ## Scoped by the owner
 *
 * Every read takes the owner and is scoped by the store on it (CLAUDE.md §6,
 * cross-athlete exposure), as `game/open-world/start-port.ts`'s are: another
 * athlete's newer ride on the same device is not where this rider rides.
 * `riding-place.test.ts` holds it against a real store with two athletes.
 */

import { geographicPosition, type GeographicPosition } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivitySummary,
  AthleteId,
  ListActivitiesOptions,
  RouteRecord,
  Samples,
} from '@onyourleft/store';

/**
 * How many of the newest rides are looked through for one with a position:
 * an indoor season is many rides with none, and one row each is cheap.
 */
export const RIDING_PLACE_RIDES = 20;

/** The store reads this makes. `ActivityStore` satisfies it. */
export interface RidingPlaceStore {
  listRoutes(owner: AthleteId, limit?: number): Promise<RouteRecord[]>;
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
  getStreamChannel<C extends 'latitude' | 'longitude'>(
    owner: AthleteId,
    activity: ActivityId,
    channel: C,
  ): Promise<Samples<C> | undefined>;
}

/** A ride's first sample at which both channels hold a position, or `undefined`. */
async function rideStart(
  store: RidingPlaceStore,
  owner: AthleteId,
  ride: ActivitySummary,
): Promise<GeographicPosition | undefined> {
  const [latitudes, longitudes] = await Promise.all([
    store.getStreamChannel(owner, ride.id, 'latitude'),
    store.getStreamChannel(owner, ride.id, 'longitude'),
  ]);
  if (latitudes === undefined || longitudes === undefined) return undefined;
  const length = Math.min(latitudes.length, longitudes.length);
  for (let index = 0; index < length; index += 1) {
    const latitude = latitudes[index];
    const longitude = longitudes[index];
    if (latitude !== undefined && longitude !== undefined) {
      return geographicPosition(latitude, longitude);
    }
  }
  return undefined;
}

/**
 * The start of whichever is newer — the rider's newest saved route (by when
 * it was saved) or their newest ride that recorded a position (by when it
 * started) — or the other one's when the newer has no start, or `undefined`
 * with neither.
 *
 * Rejects only when the store does; the planner then keeps today's view.
 */
export async function ridingPlace(
  store: RidingPlaceStore,
  owner: AthleteId,
): Promise<GeographicPosition | undefined> {
  const [routes, rides] = await Promise.all([
    store.listRoutes(owner, 1),
    store.listActivitySummaries(owner, { limit: RIDING_PLACE_RIDES }),
  ]);
  const route = routes[0];
  const routeStart = route?.profile.positions[0];
  const ride = rides.find((each) => each.hasPosition);
  if (ride === undefined) return routeStart;
  if (route !== undefined && route.createdAt >= ride.startedAt && routeStart !== undefined) {
    return routeStart;
  }
  return (await rideStart(store, owner, ride)) ?? routeStart;
}
