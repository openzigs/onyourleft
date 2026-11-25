// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The ridden-block cache over the store, for one athlete** — #2891, ADR
 * 0090 D-6. The open-world reader (`game/world-data/area.ts`) asks it before
 * every request, and a block it holds is never asked of the archive again
 * while it is there (D-6.7).
 *
 * The open-world session (`game/open-world/session.ts`, #2896) builds one
 * per ride for the riding athlete, from the store and athlete `main.tsx`
 * hands `session-lazy.ts`; `open-world/ridden-blocks-wiring.test.ts` holds
 * it. The reader converts what it keeps into and out of each block's own
 * frame (`area.ts` §`blockFrame`), so a block kept on one ride lands in the
 * same place on a ride that started elsewhere.
 *
 * - **Scoped to the athlete** (D-6.2): it is built for one `owner`, and every
 *   store call it makes names that owner, so one athlete's ride never reads
 *   another's blocks on the same device.
 * - **What is kept** (D-6.1): the decoded features, packed as a corridor's are
 *   (`packCorridorFeatures`), and each tile's streets with their road fields
 *   (`packTileStreets`) for the street graph, with each street's name (ADR
 *   0098) for the road and the junction prompt, with the block's tile states,
 *   the archive it came from and when — never the raw tile bytes.
 * - **Only a block read whole**: the reader keeps no block with a tile still
 *   refused, and a block read whole again replaces what was kept.
 * - **Trusted only from this archive URL and this reader version**, as the
 *   corridor port trusts a corridor: a block kept from another archive, or by
 *   another `CORRIDOR_READER_VERSION`, is read again and replaced.
 * - **Ridden** (D-6.5): a block handed to a ride is marked ridden now, so the
 *   store's least-recently-ridden eviction keeps it longest.
 * - ⚠️ **Never leaves the device** (D-6.4): `privacy/world-corridor-never-sent.test.ts`
 *   and `transfer/ridden-blocks-not-exported.test.ts` hold it.
 */

import type { AthleteId, RiddenBlockRecord } from '@onyourleft/store';

import { blockKey, type AreaCache } from '../game/world-data/area';
import {
  CORRIDOR_READER_VERSION,
  packCorridorFeatures,
  packTileStreets,
  unpackCorridorFeatures,
  unpackTileStreets,
} from '../game/world-data/corridor';

/** The store calls the cache makes, every one naming the owner. */
export interface RiddenBlockStore {
  getRiddenBlock(owner: AthleteId, block: number): Promise<RiddenBlockRecord | undefined>;
  putRiddenBlock(record: RiddenBlockRecord): Promise<void>;
  markRiddenBlock(owner: AthleteId, block: number, riddenAt: string): Promise<boolean>;
}

export interface RiddenBlockCacheOptions {
  readonly store: RiddenBlockStore;
  /** The athlete riding. Only their blocks are read or kept. */
  readonly owner: AthleteId;
  /** `readBasemapConfig`'s `archiveUrl`: blocks from another archive are not trusted. */
  readonly archiveUrl: string;
  readonly now: () => Date;
}

export function riddenBlockCache(options: RiddenBlockCacheOptions): AreaCache {
  const { store, owner, archiveUrl } = options;
  return {
    get: async (block) => {
      const key = blockKey(block);
      const record = await store.getRiddenBlock(owner, key);
      if (
        record === undefined ||
        record.readerVersion !== CORRIDOR_READER_VERSION ||
        record.archive.url !== archiveUrl
      ) {
        return undefined;
      }
      const features = await unpackCorridorFeatures(record.features);
      const streets = await unpackTileStreets(record.streets);
      // A mark that fails costs the eviction order a little, never the hit:
      // the block is held, and asking the archive for it would break D-6.7.
      await store.markRiddenBlock(owner, key, options.now().toISOString()).catch(() => false);
      return { tiles: record.tiles, features, streets };
    },
    put: async (block, kept, identity) => {
      const at = options.now().toISOString();
      await store.putRiddenBlock({
        owner,
        block: blockKey(block),
        archive: { url: archiveUrl, identity },
        readerVersion: CORRIDOR_READER_VERSION,
        readAt: at,
        riddenAt: at,
        tiles: kept.tiles,
        features: await packCorridorFeatures(kept.features),
        streets: await packTileStreets(kept.streets),
        licence: 'ODbL-1.0',
      });
    },
  };
}
