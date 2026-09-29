// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The {@link BlobStore} on the box: a directory on local disk (#770), the
 * default, because an instance must not require a cloud object store
 * (ADR 0002 A). The Node adapter, and the only file under `blob/` that names
 * `node:fs`.
 *
 * ## Layout
 *
 *     <root>/objects/ab/abcdef…   one file per blob, fanned out by its first byte
 *     <root>/incoming/…           files being written, never read
 *
 * ## A crash never leaves a partial blob under its final name
 *
 * A blob is written to a new file under `incoming/`, flushed to disk, and only
 * then renamed to its final name. A rename within one filesystem is atomic, so
 * the final name holds either nothing or every byte. A process killed mid-write
 * leaves an orphan under `incoming/`, which no read ever looks at —
 * `disk-blob-store.test.ts` kills one with `SIGKILL` part-way through and
 * requires `has()` to be false afterwards.
 *
 * ## The key is a key before it is a path
 *
 * `requireBlobKey` runs first in every method, so nothing but 64 lowercase
 * hex characters is ever joined onto `root`.
 */

import { mkdir, open, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { keyFor, requireBlobKey, type BlobStore } from './blob-store.ts';

/** How much is written per call, in bytes. */
export const DISK_CHUNK_BYTES = 64 * 1024;

export interface DiskBlobStoreOptions {
  /** Bytes per write. {@link DISK_CHUNK_BYTES} by default. */
  readonly chunkBytes?: number;
  /**
   * Called after each chunk reaches the incoming file, with the bytes written
   * so far. Test support: it is how a test kills a write part-way through.
   */
  readonly afterChunk?: (written: number) => void;
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';

export function createDiskBlobStore(root: string, options: DiskBlobStoreOptions = {}): BlobStore {
  const chunkBytes = options.chunkBytes ?? DISK_CHUNK_BYTES;
  const objects = join(root, 'objects');
  const incoming = join(root, 'incoming');
  const pathOf = (key: string): string => join(objects, key.slice(0, 2), key);

  async function exists(key: string): Promise<boolean> {
    try {
      return (await stat(pathOf(key))).isFile();
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  return {
    put: async (input, expectedSha256) => {
      // One copy, taken before the first await: what is hashed is what is written.
      const bytes = input.slice();
      const key = await keyFor(bytes, expectedSha256);
      if (await exists(key)) return key;
      await mkdir(incoming, { recursive: true });
      await mkdir(join(objects, key.slice(0, 2)), { recursive: true });
      const temporary = join(incoming, `${key}.${randomUUID()}`);
      const file = await open(temporary, 'wx');
      try {
        for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
          const chunk = bytes.subarray(offset, offset + chunkBytes);
          await file.write(chunk, 0, chunk.length);
          options.afterChunk?.(offset + chunk.length);
        }
        await file.sync();
      } catch (error) {
        await file.close();
        await rm(temporary, { force: true });
        throw error;
      }
      await file.close();
      await rename(temporary, pathOf(key));
      return key;
    },

    get: async (sha256) => {
      const key = requireBlobKey(sha256);
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },

    has: async (sha256) => exists(requireBlobKey(sha256)),

    delete: async (sha256) => {
      const key = requireBlobKey(sha256);
      try {
        await unlink(pathOf(key));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
