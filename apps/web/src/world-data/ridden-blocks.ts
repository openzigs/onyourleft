// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The ridden-block cache over the store, for one athlete** — #2891, ADR
 * 0090 D-6. The open-world reader (`game/world-data/area.ts`) asks it before
 * every request, and a block it holds is never asked of the archive again
 * while it is there (D-6.7).
 *
 * It ships with the reader and has the same caller to come: #2896, the
 * open-world session, builds one per ride with the riding athlete. Until then
 * nothing in the product builds one.
 *
 * - **Scoped to the athlete** (D-6.2): it is built for one `owner`, and every
 *   store call it makes names that owner, so one athlete's ride never reads
 *   another's blocks on the same device.
 * - **What is kept** (D-6.1): the decoded features, packed as a corridor's are
 *   (`packCorridorFeatures`), with the block's tile states, the archive it
 *   came from and when — never the raw tile bytes.
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
  unpackCorridorFeatures,
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
      await store.markRiddenBlock(owner, key, options.now().toISOString());
      return { tiles: record.tiles, features };
    },
    put: async (held, identity) => {
      const at = options.now().toISOString();
      await store.putRiddenBlock({
        owner,
        block: blockKey(held.block),
        archive: { url: archiveUrl, identity },
        readerVersion: CORRIDOR_READER_VERSION,
        readAt: at,
        riddenAt: at,
        tiles: held.tiles,
        features: await packCorridorFeatures(held.features),
        licence: 'ODbL-1.0',
      });
    },
  };
}
