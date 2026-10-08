// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The blob store conformance suite (#770): ONE set of cases, run identically
 * against every implementation — the disk store, the in-memory fake, and the
 * S3-compatible store when a bucket is configured.
 *
 * `open()` must answer a NEW store instance over the SAME storage each time it
 * is called. Every read here goes through a fresh instance, never the one that
 * wrote (`docs/agents/quality-gate.md` §5), so an implementation that kept its blobs in the
 * port object would fail.
 *
 * Test support, never shipped: nothing but a test imports it.
 */

import { describe, expect, it } from 'vitest';
import { DigestMismatchError, InvalidBlobKeyError, type BlobStore } from './blob-store.ts';

export interface ConformanceTarget {
  /** A new store instance over the same storage as every other `open()`. */
  readonly open: () => Promise<BlobStore>;
  /** Remove the storage. */
  readonly dispose: () => Promise<void>;
}

/** NIST's SHA-256 of "abc", so the digest is checked against something outside this code. */
export const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Every key a store must refuse before it touches storage. */
export const MALFORMED_KEYS: readonly string[] = [
  '../../etc/passwd',
  `../${ABC_SHA256}`,
  '/etc/passwd',
  `/${ABC_SHA256.slice(1)}`,
  ABC_SHA256.toUpperCase(),
  ABC_SHA256.slice(1),
  `${ABC_SHA256}0`,
  `${ABC_SHA256.slice(0, 62)}/x`,
  '',
];

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Register the conformance cases for one implementation. */
export function describeBlobStoreConformance(
  name: string,
  target: () => Promise<ConformanceTarget>,
  options: { readonly skip?: string } = {},
): void {
  describe(`blob store conformance: ${name} (#770)`, () => {
    async function withTarget(run: (opened: ConformanceTarget) => Promise<void>): Promise<void> {
      const opened = await target();
      try {
        await run(opened);
      } finally {
        await opened.dispose();
      }
    }

    const test = (title: string, run: (opened: ConformanceTarget) => Promise<void>): void => {
      it(title, async (context) => {
        if (options.skip !== undefined) context.skip(options.skip);
        await withTarget(run);
      });
    };

    test('answers the SHA-256 of what it stored', async ({ open }) => {
      expect(await (await open()).put(bytesOf('abc'))).toBe(ABC_SHA256);
      expect(await (await open()).put(new Uint8Array())).toBe(EMPTY_SHA256);
    });

    test('round-trips through a fresh store, not the one that wrote', async ({ open }) => {
      const bytes = bytesOf('a signed ride, as the rider sent it');
      const key = await (await open()).put(bytes);
      const reader = await open();
      expect(await reader.has(key)).toBe(true);
      expect(await reader.get(key)).toEqual(bytes);
    });

    test('keeps what was put, whatever the caller does to its array afterwards', async ({
      open,
    }) => {
      const bytes = bytesOf('abc');
      const key = await (await open()).put(bytes);
      bytes.fill(0);
      expect(await (await open()).get(key)).toEqual(bytesOf('abc'));
    });

    test('stores what it hashed, whatever the caller does to its array DURING the put', async ({
      open,
    }) => {
      const bytes = bytesOf('abc');
      const pending = (await open()).put(bytes);
      bytes.fill(0);
      const key = await pending;
      expect(key).toBe(ABC_SHA256);
      expect(await (await open()).get(key)).toEqual(bytesOf('abc'));
    });

    test('accepts the digest the caller expected, and is idempotent', async ({ open }) => {
      const store = await open();
      expect(await store.put(bytesOf('abc'), ABC_SHA256)).toBe(ABC_SHA256);
      expect(await store.put(bytesOf('abc'), ABC_SHA256)).toBe(ABC_SHA256);
      expect(await (await open()).get(ABC_SHA256)).toEqual(bytesOf('abc'));
    });

    test('refuses a digest mismatch and stores nothing', async ({ open }) => {
      const wrong = EMPTY_SHA256;
      await expect((await open()).put(bytesOf('abc'), wrong)).rejects.toBeInstanceOf(
        DigestMismatchError,
      );
      const reader = await open();
      expect(await reader.has(ABC_SHA256)).toBe(false);
      expect(await reader.has(wrong)).toBe(false);
    });

    test('answers nothing for a blob that is not there', async ({ open }) => {
      const store = await open();
      expect(await store.has(ABC_SHA256)).toBe(false);
      expect(await store.get(ABC_SHA256)).toBeUndefined();
      await store.delete(ABC_SHA256);
    });

    test('deletes, as a fresh store sees it', async ({ open }) => {
      const key = await (await open()).put(bytesOf('abc'));
      await (await open()).delete(key);
      const reader = await open();
      expect(await reader.has(key)).toBe(false);
      expect(await reader.get(key)).toBeUndefined();
    });

    test('refuses every key that is not 64 lowercase hex characters', async ({ open }) => {
      const store = await open();
      for (const key of MALFORMED_KEYS) {
        await expect(store.get(key), key).rejects.toBeInstanceOf(InvalidBlobKeyError);
        await expect(store.has(key), key).rejects.toBeInstanceOf(InvalidBlobKeyError);
        await expect(store.delete(key), key).rejects.toBeInstanceOf(InvalidBlobKeyError);
        await expect(store.put(bytesOf('abc'), key), key).rejects.toBeInstanceOf(
          InvalidBlobKeyError,
        );
      }
    });
  });
}
