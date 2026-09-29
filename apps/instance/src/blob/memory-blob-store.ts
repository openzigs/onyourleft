// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An in-memory {@link BlobStore} (#770): the fake the conformance suite runs
 * beside the real implementations, and a store for a test that needs one.
 *
 * The bytes live in a `MemoryBlobs` map the caller holds, so two store
 * instances over one map are "the same storage, a fresh port" — the round
 * trip the conformance suite asks of every implementation. Bytes are copied
 * in and out, so a caller mutating its array after `put` cannot fake a read.
 */

import { keyFor, requireBlobKey, type BlobStore } from './blob-store.ts';

/** Where a memory store keeps its blobs. */
export type MemoryBlobs = Map<string, Uint8Array>;

/** Run `operation`, answering a promise: a thrown refusal becomes a rejection. */
const settled = <T>(operation: () => T): Promise<T> =>
  new Promise((resolve) => {
    resolve(operation());
  });

export function createMemoryBlobStore(blobs: MemoryBlobs = new Map()): BlobStore {
  return {
    put: async (bytes, expectedSha256) => {
      const key = await keyFor(bytes, expectedSha256);
      if (!blobs.has(key)) blobs.set(key, bytes.slice());
      return key;
    },
    get: (sha256) => settled(() => blobs.get(requireBlobKey(sha256))?.slice()),
    has: (sha256) => settled(() => blobs.has(requireBlobKey(sha256))),
    delete: (sha256) =>
      settled(() => {
        blobs.delete(requireBlobKey(sha256));
      }),
  };
}
