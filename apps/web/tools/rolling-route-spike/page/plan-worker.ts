// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: the worker half of `?planning=worker`. It reads and decodes
 * each block and plans the footprints, and hands the page the features and
 * the plans. What it cannot hand over is said in the write-up: the land-class
 * mask and the urban class are objects with methods, so the page builds its
 * own again. Throwaway (see `../rolling-profile.ts`).
 */

import type { RouteProfile } from '@onyourleft/domain';

import { archiveSource, corridorArchiveFrom } from '../../../src/world-data/corridor-source';
import type { CorridorOrigin } from '../../../src/game/terrain';

import { blocksCorridor, planTown, readBlock, type ReadBlock } from './plan';

export type ToWorker =
  | {
      readonly kind: 'open';
      readonly url: string;
      readonly origin: CorridorOrigin;
      readonly size: number;
    }
  | { readonly kind: 'read'; readonly key: number }
  | {
      readonly kind: 'plan';
      readonly id: number;
      readonly keys: readonly number[];
      readonly profile: RouteProfile;
    };

export type FromWorker =
  | { readonly kind: 'block'; readonly block: ReadBlock }
  | { readonly kind: 'failed'; readonly key: number }
  | {
      readonly kind: 'planned';
      readonly id: number;
      readonly plans: ReturnType<typeof planTown>['plans'];
      readonly timings: ReturnType<typeof planTown>['timings'];
      readonly workerMs: number;
    };

const blocks = new Map<number, ReadBlock>();
let archive: ReturnType<typeof corridorArchiveFrom> | undefined;
let origin: CorridorOrigin | undefined;
let size = 1;
const signal = new AbortController().signal;

/** The worker's own `postMessage`: the page's lib types `self` as a window. */
const post = (message: FromWorker): void => {
  (globalThis as unknown as { postMessage(message: FromWorker): void }).postMessage(message);
};

addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.kind === 'open') {
    archive = corridorArchiveFrom(archiveSource(message.url));
    origin = message.origin;
    size = message.size;
    return;
  }
  if (archive === undefined || origin === undefined) return;
  if (message.kind === 'read') {
    readBlock(archive, message.key, size, origin, signal).then(
      (block) => {
        blocks.set(block.key, block);
        post({ kind: 'block', block });
      },
      () => post({ kind: 'failed', key: message.key }),
    );
    return;
  }
  const started = performance.now();
  const held = message.keys.flatMap((key) => {
    const block = blocks.get(key);
    return block === undefined ? [] : [block];
  });
  const corridor = blocksCorridor(held, origin);
  const { plans, timings } = planTown(
    corridor,
    message.profile,
    origin,
    performance.now() - started,
  );
  post({ kind: 'planned', id: message.id, plans, timings, workerMs: performance.now() - started });
});
