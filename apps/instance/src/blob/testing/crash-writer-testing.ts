// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A process that dies mid-write (#770). Run by `disk-blob-store.test.ts` as
 * `node crash-writer-testing.ts <root> <kill after bytes>`: it puts a blob
 * through the disk store in small chunks and sends ITSELF `SIGKILL` once the
 * given number of bytes are in the incoming file — no `finally`, no cleanup,
 * the way a power cut or the OOM killer ends a write. Test support.
 */

import { createDiskBlobStore } from '../disk-blob-store.ts';
import { crashBlob } from './crash-blob-testing.ts';

const [root, killAfter] = process.argv.slice(2);
if (root === undefined || killAfter === undefined) process.exit(2);

const store = createDiskBlobStore(root, {
  chunkBytes: 1024,
  afterChunk: (written) => {
    if (written >= Number(killAfter)) process.kill(process.pid, 'SIGKILL');
  },
});
await store.put(crashBlob());
process.exit(0);
