// SPDX-License-Identifier: AGPL-3.0-or-later

import { describeBlobStoreConformance } from './conformance-testing.ts';
import { createMemoryBlobStore, type MemoryBlobs } from './memory-blob-store.ts';

describeBlobStoreConformance('in memory', () => {
  const blobs: MemoryBlobs = new Map();
  return Promise.resolve({
    open: () => Promise.resolve(createMemoryBlobStore(blobs)),
    dispose: () => Promise.resolve(blobs.clear()),
  });
});
