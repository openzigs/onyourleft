// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `ride.html?corridor=archive` and `?corridor=none` — #1552: the ride harness's
 * route read through the product's own corridor port, so the ride screen
 * either has map data in its world or has not.
 *
 * `archive`: `world-data/corridor-port.ts` over this origin's real IndexedDB
 * and the product's archive reader (`world-data/corridor-source.ts`), reading
 * the synthetic archive `corridor-fixture.ts` emits (no OpenStreetMap data in
 * it) for the fixture's own route — `corridor-harness.ts`'s set-up, ridden.
 * `none`: the same port with no archive configured, which is a self-hoster's
 * build with none: the corridor is `off`, and the world is today's.
 *
 * Both answer as if the realistic world were chosen (`realisticOn`), which is
 * the only world a corridor is read for. ⚠️ The page's renderer is NOT
 * switched to the realistic world — the credit is keyed on the corridor the
 * ride was given, not on which world draws, and the realistic assets are
 * `realistic.browser.spec.ts`'s to load. So `none` is the issue's control:
 * the realistic world asked for, no map data, no credit.
 */

import { openActivityStore, routeId } from '@onyourleft/store';
import { unixSeconds, type RouteProfile } from '@onyourleft/domain';

import type { GamePort } from '../src/game/GameView';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';
import { createWorldCorridorPort, type WorldCorridorPort } from '../src/world-data/corridor-port';
import { corridorArchive } from '../src/world-data/corridor-source';

import { CORRIDOR_ARCHIVE_FILE, corridorFixtureRoute } from './corridor-fixture';

export type CorridorRideKind = 'archive' | 'none';

/** The query's kind, or `undefined` on every other ride harness page. */
export function corridorRideKind(search: string): CorridorRideKind | undefined {
  const kind = new URLSearchParams(search).get('corridor');
  return kind === 'archive' || kind === 'none' ? kind : undefined;
}

/** What the harness's game port takes from this: the route, and the read. */
export interface CorridorRide {
  readonly profile: RouteProfile;
  readonly loadWorldCorridor: NonNullable<GamePort['loadWorldCorridor']>;
}

export function corridorRide(kind: CorridorRideKind, id: string, errors: string[]): CorridorRide {
  const profile = corridorFixtureRoute();
  let opened: Promise<WorldCorridorPort> | undefined;
  const port = (): Promise<WorldCorridorPort> => {
    opened ??= (async () => {
      const store = openActivityStore('oyl-ride-corridor');
      await ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000)));
      // The port keeps a corridor only for a route the athlete has.
      await store.putRoute({
        id: routeId(id),
        createdBy: LOCAL_ATHLETE,
        name: 'Ride harness corridor',
        profile,
        visibility: 'private',
        createdAt: unixSeconds(1_700_000_000),
        updatedAt: unixSeconds(1_700_000_000),
      });
      return createWorldCorridorPort({
        store,
        owner: LOCAL_ATHLETE,
        basemap: () =>
          kind === 'none'
            ? undefined
            : {
                archiveUrl: new URL(`/${CORRIDOR_ARCHIVE_FILE}`, location.href).href,
                attribution: '',
              },
        archive: corridorArchive,
        mapTilesOn: () => true,
        realisticOn: () => true,
        recording: () => false,
        now: () => new Date(),
        log: (line) => errors.push(line),
      });
    })();
    return opened;
  };
  return {
    profile,
    loadWorldCorridor: async (route, signal, progress) =>
      (await port()).load(route, signal, progress),
  };
}
