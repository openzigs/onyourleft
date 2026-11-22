// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the open-world start picker reads and where it hands its start — #2889.
 *
 * ⚠️ **Every read takes the owner, and is scoped by the store on it**
 * (CLAUDE.md §6, cross-athlete exposure). The past-ride list is
 * `listActivitySummaries(owner)`, whose index is `[athleteId+startedAt]`, and a
 * ride's start is read through `getStreamChannel(owner, id, …)`, whose index
 * leads with the athlete too, so another athlete's ride id finds nothing.
 * `start-port.test.ts` holds it against a real store with three athletes.
 *
 * Nothing here sends anything: the reads are the device's store, and
 * {@link OpenWorldStartPort.begin} hands the start to `entry.ts` in memory.
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

import type { OpenWorldEntry } from './entry';
import { openWorldStart, type OpenWorldStart, type OpenWorldStartOutcome } from './start';

/** How many saved routes the picker lists: the Routes screen's own budget (`routes/store-port.ts`). */
export const START_ROUTE_LIMIT = 50;

/** How many past rides the picker lists, newest first. */
export const START_RIDE_LIMIT = 20;

/** A saved route, as the picker offers it: its start is worked out when the list is read. */
export interface RouteStartChoice {
  readonly id: string;
  readonly name: string;
  readonly start: OpenWorldStartOutcome;
}

/** A past ride, as the picker offers it: its start is read only when it is chosen. */
export interface RideStartChoice {
  readonly id: string;
  readonly name: string;
  readonly startedAt: number;
  readonly timeZone: string;
}

export interface OpenWorldStartPort {
  /** The rider's saved routes, newest first, each with its start or why it has none. */
  listRouteStarts(): Promise<readonly RouteStartChoice[]>;
  /** The rider's recent rides that recorded a position, newest first. */
  listRideStarts(): Promise<readonly RideStartChoice[]>;
  /** One of those rides' first recorded position, as a start, or why it is none. */
  rideStart(id: string): Promise<OpenWorldStartOutcome>;
  /** The press: the open-world ride starts here. */
  begin(start: OpenWorldStart): void;
}

/** The store reads the picker makes. `ActivityStore` satisfies it. */
export interface OpenWorldStartStore {
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

export interface OpenWorldStartPortOptions {
  readonly store: OpenWorldStartStore;
  readonly owner: AthleteId;
  readonly entry: OpenWorldEntry;
  /** After the start is handed over: the shell opens the ride. */
  readonly opened: () => void;
}

/** The first sample at which both channels hold a position, or `undefined`. */
function firstPosition(
  latitudes: Samples<'latitude'>,
  longitudes: Samples<'longitude'>,
): GeographicPosition | undefined {
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

export function openWorldStartPort(options: OpenWorldStartPortOptions): OpenWorldStartPort {
  const { store, owner, entry } = options;
  return {
    listRouteStarts: async () => {
      const routes = await store.listRoutes(owner, START_ROUTE_LIMIT);
      return routes.map((route) => ({
        id: route.id,
        name: route.name,
        start: openWorldStart(route.profile.positions[0], 'route'),
      }));
    },
    listRideStarts: async () => {
      // More than the limit is read and those with no position dropped, so an
      // indoor season does not empty the list.
      const rides = await store.listActivitySummaries(owner, { limit: START_RIDE_LIMIT * 5 });
      return rides
        .filter((ride) => ride.hasPosition)
        .slice(0, START_RIDE_LIMIT)
        .map((ride) => ({
          id: ride.id,
          name: ride.name,
          startedAt: ride.startedAt,
          timeZone: ride.startedAtTimeZone,
        }));
    },
    rideStart: async (id) => {
      const activity = id as ActivityId;
      const [latitudes, longitudes] = await Promise.all([
        store.getStreamChannel(owner, activity, 'latitude'),
        store.getStreamChannel(owner, activity, 'longitude'),
      ]);
      if (latitudes === undefined || longitudes === undefined) {
        return openWorldStart(undefined, 'ride');
      }
      return openWorldStart(firstPosition(latitudes, longitudes), 'ride');
    },
    begin: (start) => {
      entry.hand(start);
      options.opened();
    },
  };
}
