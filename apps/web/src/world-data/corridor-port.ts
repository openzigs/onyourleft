// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * When a route's corridor is read, and where it is kept — #1539, ADR 0054 D-2.4.
 *
 * `main.tsx` builds one of these and hands {@link WorldCorridorPort.load} to
 * the game (`GamePort.loadWorldCorridor`) and {@link WorldCorridorPort.afterSave}
 * to the two screens that save a route. Everything that decides whether a
 * request is made is here, in this order:
 *
 * 1. **The stylised world chosen** — nothing (`off: stylised-world`).
 * 2. **Map tiles off** in Settings (`map/tiles-preference.ts`) — nothing
 *    (`off: map-tiles-off`, ADR 0054 D-6.4: one switch for the map and the world).
 * 3. **No archive configured** (`map/basemap.ts` §`readBasemapConfig`) —
 *    nothing (`off: no-archive`): a self-hoster with none gets today's world.
 * 4. **A kept record** for this owner and route whose route digest, archive
 *    URL and reader version match — `ready`, and **no request**. Its archive
 *    identity is checked against the identity this device last saw the archive
 *    answer with; a device that has not opened the archive since it started
 *    trusts the record, which is what makes a stored corridor work offline.
 * 5. **A ride recording** — nothing (ADR 0054 D-2.4).
 * 6. Otherwise the read (`game/world-data/corridor.ts`), less the athlete's
 *    privacy zones, and the result kept with `putWorldCorridor`.
 *
 * ⚠️ **A save never waits on this and never fails because of it** (the
 * owner's ruling of 2026-10-21 on #1539): {@link WorldCorridorPort.afterSave}
 * is called after the route is stored, returns at once, and swallows
 * everything. A save with no network leaves the route saved and the corridor
 * read the next time the route is chosen.
 */

import type { GeographicPosition, RouteProfile } from '@onyourleft/domain';
import {
  routeId,
  type AthleteId,
  type PrivacyZoneRecord,
  type WorldCorridorRecord,
} from '@onyourleft/store';

import {
  CORRIDOR_HALF_WIDTH_METRES,
  CORRIDOR_READER_VERSION,
  describeCorridorFailure,
  packCorridorFeatures,
  planCorridor,
  readCorridorTiles,
  unpackCorridorFeatures,
  worldCorridorOf,
  type CorridorArchive,
  type CorridorFeatures,
  type CorridorState,
  type CorridorTile,
} from '../game/world-data/corridor';
import { corridorOrigin } from '../game/terrain';
import type { BasemapConfig } from '../map/basemap';

/** The store reads and the write this needs, every one naming the owner. */
export interface CorridorStore {
  getWorldCorridor(
    owner: AthleteId,
    id: ReturnType<typeof routeId>,
  ): Promise<WorldCorridorRecord | undefined>;
  putWorldCorridor(record: WorldCorridorRecord): Promise<void>;
  listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]>;
}

/** A route as the read needs it: its id and its line. */
export interface CorridorRoute {
  readonly id: string;
  readonly profile: RouteProfile;
}

export interface WorldCorridorPortOptions {
  readonly store: CorridorStore;
  readonly owner: AthleteId;
  /** `readBasemapConfig`'s answer, read at each call so a test can change it. */
  readonly basemap: () => BasemapConfig | undefined;
  /** The archive for a configuration: `corridor-source.ts` §`corridorArchive` in the product. */
  readonly archive: (config: BasemapConfig) => CorridorArchive;
  readonly mapTilesOn: () => boolean;
  readonly realisticOn: () => boolean;
  /** Whether a ride is recording: no read starts, and a running one stops (ADR 0054 D-2.4). */
  readonly recording: () => boolean;
  readonly now: () => Date;
  readonly log?: ((line: string) => void) | undefined;
  readonly yieldToIdle?: (() => Promise<void>) | undefined;
}

export interface WorldCorridorPort {
  /** The corridor for a chosen route: from the store, or read. Never rejects. */
  load(
    route: CorridorRoute,
    signal: AbortSignal,
    progress: (state: CorridorState) => void,
  ): Promise<CorridorState>;
  /**
   * After a route is saved: read its corridor in the background. Returns the
   * outcome for a test to await; a caller does not, and it never rejects.
   */
  afterSave(route: CorridorRoute): Promise<CorridorState>;
}

/** SHA-256 of the route's positions as stored, hex — `WorldCorridorRecord.routeDigest`. */
export async function routeDigestOf(positions: readonly GeographicPosition[]): Promise<string> {
  const values = new Float64Array(positions.length * 2);
  positions.forEach((position, index) => {
    values[index * 2] = position.latitude;
    values[index * 2 + 1] = position.longitude;
  });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', values);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const NOTHING_FOR_THIS_ROUTE: CorridorState = { kind: 'unavailable', why: 'outside-coverage' };

export function createWorldCorridorPort(options: WorldCorridorPortOptions): WorldCorridorPort {
  const log = options.log ?? ((): void => undefined);
  /** The identity each archive URL last answered with on this device, since it started. */
  const seen = new Map<string, string>();

  const fromRecord = (
    route: CorridorRoute,
    tiles: readonly CorridorTile[],
    features: CorridorFeatures,
  ): CorridorState => {
    if (!tiles.some((tile) => tile.state === 'covered')) return NOTHING_FOR_THIS_ROUTE;
    return {
      kind: 'ready',
      corridor: worldCorridorOf(route.id, corridorOrigin(route.profile), tiles, features),
    };
  };

  const kept = async (route: CorridorRoute): Promise<WorldCorridorRecord | undefined> => {
    try {
      return await options.store.getWorldCorridor(options.owner, routeId(route.id));
    } catch (error) {
      log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
      return undefined;
    }
  };

  const fromKept = async (
    route: CorridorRoute,
    record: WorldCorridorRecord,
  ): Promise<CorridorState | undefined> => {
    try {
      return fromRecord(route, record.tiles, await unpackCorridorFeatures(record.features));
    } catch (error) {
      log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
      return undefined;
    }
  };

  const load = async (
    route: CorridorRoute,
    signal: AbortSignal,
    progress: (state: CorridorState) => void,
  ): Promise<CorridorState> => {
    if (!options.realisticOn()) return { kind: 'off', why: 'stylised-world' };
    if (!options.mapTilesOn()) return { kind: 'off', why: 'map-tiles-off' };
    const config = options.basemap();
    // No `crypto.subtle` (a page opened from the disk): no digest, so nothing
    // could be kept or matched. Today's world, as with no archive.
    if (config === undefined || globalThis.crypto?.subtle === undefined) {
      return { kind: 'off', why: 'no-archive' };
    }
    const positions = route.profile.positions;
    const digest = await routeDigestOf(positions);
    const record = await kept(route);
    const matches =
      record !== undefined &&
      record.routeDigest === digest &&
      record.archive.url === config.archiveUrl &&
      record.readerVersion === CORRIDOR_READER_VERSION;
    const identity = seen.get(config.archiveUrl);
    if (matches && (identity === undefined || identity === record.archive.identity)) {
      const state = await fromKept(route, record);
      if (state !== undefined) return state;
    }
    // A ride recording is checked by the read itself, before every request
    // (`mustStop` below), so a read that starts while one records asks nothing.
    if (signal.aborted) return { kind: 'unavailable', why: 'refused' };

    let zones: readonly PrivacyZoneRecord[];
    try {
      zones = await options.store.listPrivacyZones(options.owner);
    } catch (error) {
      // Not knowing the zones is never a reason to ask for tiles near them.
      log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
      return { kind: 'unavailable', why: 'refused' };
    }
    const plan = planCorridor(positions, zones);
    if (plan === undefined || plan.requestable.length === 0) return NOTHING_FOR_THIS_ROUTE;

    const read = await readCorridorTiles({
      plan,
      archive: options.archive(config),
      signal,
      progress: (done, of) => {
        progress({ kind: 'reading', done, of });
      },
      log,
      mustStop: options.recording,
      yieldToIdle: options.yieldToIdle,
    });
    switch (read.kind) {
      case 'wrong-schema':
        return { kind: 'off', why: 'wrong-schema' };
      case 'aborted':
        return { kind: 'unavailable', why: 'refused' };
      case 'offline':
        if (matches) {
          // The record's archive moved on, and there is no network to read the
          // new one: the old features are still the best this device has.
          const state = await fromKept(route, record);
          if (state !== undefined) return state;
        }
        return { kind: 'unavailable', why: 'offline' };
      case 'read':
        break;
    }
    seen.set(config.archiveUrl, read.identity);
    // Packed and read back before it is used, so the corridor this ride gets
    // is exactly the one the next ride will get from the store.
    const features = await packCorridorFeatures(read.features);
    try {
      await options.store.putWorldCorridor({
        owner: options.owner,
        routeId: routeId(route.id),
        routeDigest: digest,
        archive: { url: config.archiveUrl, identity: read.identity },
        readerVersion: CORRIDOR_READER_VERSION,
        halfWidthMetres: CORRIDOR_HALF_WIDTH_METRES,
        readAt: options.now().toISOString(),
        tiles: read.tiles,
        features,
        licence: 'ODbL-1.0',
      });
    } catch (error) {
      // A route deleted mid-read, or a corridor over the store's bound: this
      // ride may still use what was read; the next one reads again.
      log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
    }
    return fromRecord(route, read.tiles, await unpackCorridorFeatures(features));
  };

  return {
    load: async (route, signal, progress) => {
      try {
        return await load(route, signal, progress);
      } catch (error) {
        log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
        return { kind: 'unavailable', why: 'refused' };
      }
    },
    afterSave: async (route) => {
      try {
        return await load(route, new AbortController().signal, () => undefined);
      } catch (error) {
        log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
        return { kind: 'unavailable', why: 'refused' };
      }
    },
  };
}

/** An error's class name, which says what failed and carries no value. */
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
