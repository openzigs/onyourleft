// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The corridor port, loaded when it is first used — #1539.
 *
 * ⚠️ **Why this module exists.** `corridor-port.ts` reaches the archive reader
 * (`pmtiles`) and the tile decoder (`@onyourleft/map-features`, `earcut`), and
 * `main.tsx` builds the port on start-up. Imported statically, all of that is
 * in the entry chunk that every rider downloads before Home paints — a rider
 * who never chooses the realistic world included. So `main.tsx` imports this
 * file, which names those modules only as `import()`s and as types, and the
 * build splits them out (`pnpm run build` shows the chunk).
 *
 * It also holds {@link readingCorridorOnSave}, which the two save screens'
 * stores are wrapped in, for the same reason.
 */

import type { RouteId, RouteRecord } from '@onyourleft/store';

import type { CorridorState } from '../game/world-data/corridor';
import type { CorridorRoute, WorldCorridorPort, WorldCorridorPortOptions } from './corridor-port';

/** Everything the port needs but the archive, which is always `corridor-source.ts`' own. */
export type LazyCorridorPortOptions = Omit<WorldCorridorPortOptions, 'archive'>;

const REFUSED: CorridorState = { kind: 'unavailable', why: 'refused' };

/**
 * A {@link WorldCorridorPort} whose modules are loaded on its first call.
 * A load that fails (a chunk this device could not fetch) is `refused`, as a
 * read that failed is, and the next call tries again.
 */
export function lazyWorldCorridorPort(
  options: LazyCorridorPortOptions,
  load: () => Promise<WorldCorridorPort> = async () => {
    const [port, source] = await Promise.all([
      import('./corridor-port'),
      import('./corridor-source'),
    ]);
    return port.createWorldCorridorPort({ ...options, archive: source.corridorArchive });
  },
): WorldCorridorPort {
  let loaded: Promise<WorldCorridorPort> | undefined;
  const ready = (): Promise<WorldCorridorPort> => {
    loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
    return loaded;
  };
  return {
    load: async (route: CorridorRoute, signal, progress) => {
      try {
        return await (await ready()).load(route, signal, progress);
      } catch {
        return REFUSED;
      }
    },
    afterSave: async (route: CorridorRoute) => {
      try {
        return await (await ready()).afterSave(route);
      } catch {
        return REFUSED;
      }
    },
  };
}

/**
 * `store`, with `putRoute` followed by the route's corridor read — #1539, the
 * owner's ruling of 2026-10-21. ⚠️ **The save never waits on the read and
 * never fails because of it**: the route is stored first, and the read is
 * started and not awaited (`afterSave` never rejects). Every other member is
 * the store's own, bound to it.
 */
export function readingCorridorOnSave<
  S extends { putRoute(record: RouteRecord): Promise<RouteId> },
>(store: S, corridors: WorldCorridorPort): S {
  return new Proxy(store, {
    get(target, key) {
      if (key === 'putRoute') {
        return async (record: RouteRecord): Promise<RouteId> => {
          const saved = await target.putRoute(record);
          void corridors.afterSave({ id: record.id, profile: record.profile });
          return saved;
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
