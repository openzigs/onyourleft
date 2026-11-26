// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The open-world sessions `main.tsx` hands the game, with the session's own
 * modules loaded when a start is first opened — #2896.
 *
 * ⚠️ **Why this module exists**, as `world-data/corridor-lazy.ts` does:
 * `session.ts` reaches the archive reader (`pmtiles`), the tile decoder and
 * the street graph (`@onyourleft/map-features`) and the rolling route.
 * Imported statically by `main.tsx`, all of that would be in the entry chunk
 * every rider downloads before Home paints, a rider who never rides the open
 * world included. So `main.tsx` imports this file, which names those modules
 * only as `import()`s and as types.
 *
 * The archive is always `world-data/corridor-source.ts`' own, the one module
 * with the one request (ADR 0090 D-3), over the basemap `main.tsx` reads.
 */

import type { AthleteId } from '@onyourleft/store';

import type { BasemapConfig } from '../../map/basemap';
import type { RiddenBlockStore } from '../../world-data/ridden-blocks';
import type { TerrainConfig } from '../../terrain/config';
import type { OpenWorldEntry } from './entry';
import type {
  OpenWorldReady,
  OpenWorldSession,
  OpenWorldSessionExtras,
  OpenWorldSessions,
} from './ride';
import type { OpenWorldStart } from './start';

interface LazyOpenWorldOptions {
  /** The tab's one way in (`entry.ts`): the picker hands the start to it. */
  readonly entry: OpenWorldEntry;
  /** The configured basemap, read when a session opens; `undefined` when none is. */
  readonly basemap: () => BasemapConfig | undefined;
  /** The map-tiles switch (ADR 0090 D-7.1), read before every request. */
  readonly mapTilesOn: () => boolean;
  /**
   * The configured terrain archive (#2899), read when a session opens;
   * `undefined` when none is, and the open-world road is then flat.
   */
  readonly terrain?: (() => TerrainConfig | undefined) | undefined;
  /**
   * #2891: the store and the athlete whose ridden blocks each ride reads and
   * keeps, over the configured basemap's URL. `undefined` — no store or no
   * athlete — and no ride keeps a block.
   */
  readonly riddenBlocks?:
    { readonly store: RiddenBlockStore; readonly owner: AthleteId } | undefined;
}

/** What opens one session, once the modules are loaded. */
type OpenSession = (start: OpenWorldStart, extras?: OpenWorldSessionExtras) => OpenWorldSession;

const UNAVAILABLE: OpenWorldReady = { kind: 'refused', refusal: 'unavailable' };

/**
 * {@link OpenWorldSessions} whose session modules are loaded on the first
 * {@link OpenWorldSessions.open}. A load that fails (a chunk this device
 * could not fetch) is `unavailable`, and the next open tries again.
 */
export function lazyOpenWorldSessions(
  options: LazyOpenWorldOptions,
  load: () => Promise<OpenSession> = async () => {
    // Two plain `await import()` bindings, which `check-wiring.mjs` follows
    // (§`namespaceBindings`).
    const session = await import('./session');
    const source = await import('../../world-data/corridor-source');
    // #2899: the road's heights, through #2013's one module (ADR 0087 D-2.3).
    const heights = await import('../../terrain/terrain-source');
    return (start, extras) => {
      const config = options.basemap();
      const terrain = options.terrain?.();
      return session.createOpenWorldSession({
        start,
        streetName: extras?.streetName,
        archive: config === undefined ? undefined : source.corridorArchive(config),
        mapTilesOn: options.mapTilesOn,
        terrain: terrain === undefined ? undefined : heights.terrainArchive(terrain),
        riddenBlocks:
          options.riddenBlocks === undefined || config === undefined
            ? undefined
            : {
                store: options.riddenBlocks.store,
                owner: options.riddenBlocks.owner,
                archiveUrl: config.archiveUrl,
                now: () => new Date(),
              },
      });
    };
  },
): OpenWorldSessions {
  let loaded: Promise<OpenSession> | undefined;
  return {
    take: () => options.entry.take(),
    open: (start, extras) => {
      let stopped = false;
      let inner: OpenWorldSession | undefined;
      loaded ??= load().catch((error: unknown) => {
        loaded = undefined;
        throw error;
      });
      const ready = loaded.then(
        (open): Promise<OpenWorldReady> | OpenWorldReady => {
          // Stopped while the modules loaded: nothing is asked for at all.
          if (stopped) return { kind: 'stopped' };
          inner = open(start, extras);
          return inner.ready;
        },
        (): OpenWorldReady => UNAVAILABLE,
      );
      return {
        ready,
        stop: () => {
          stopped = true;
          inner?.stop();
        },
      };
    },
  };
}
