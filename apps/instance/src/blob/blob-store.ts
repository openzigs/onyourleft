// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's blob storage port (#770): original activity files and route
 * geometry, content-addressed by SHA-256.
 *
 * ## Content addressing
 *
 * A blob's key IS the SHA-256 of its bytes, lowercase hex. So a write is
 * idempotent — the same file sent twice is the same key, which is what a
 * local-first client retrying a sync needs (#47) — and a key that is not 64
 * lowercase hex characters names no blob at all. Every implementation refuses
 * one with {@link InvalidBlobKeyError} BEFORE it reaches a filesystem or a
 * URL, so `../` and `/etc/passwd` never become a path (`requireBlobKey`).
 *
 * ## Portable on purpose
 *
 * This file and `memory-blob-store.ts` and `s3-blob-store.ts` name nothing of
 * Node — the digest is Web Crypto's, which a Durable Object has too (ADR 0037
 * D-2). `disk-blob-store.ts` is the Node adapter, and the only one.
 */

/** A blob's key: the SHA-256 of its bytes, 64 lowercase hex characters. */
export const BLOB_KEY = /^[0-9a-f]{64}$/;

/** The port. Every method refuses a malformed key before doing anything else. */
export interface BlobStore {
  /**
   * Store `bytes` and answer their SHA-256. When the caller says what digest it
   * expects, a mismatch is refused with {@link DigestMismatchError} and nothing
   * is stored.
   */
  put(bytes: Uint8Array, expectedSha256?: string): Promise<string>;
  /** The bytes under `sha256`, or `undefined` when there are none. */
  get(sha256: string): Promise<Uint8Array | undefined>;
  has(sha256: string): Promise<boolean>;
  /** Remove the blob. Removing one that is not there is not an error. */
  delete(sha256: string): Promise<void>;
}

/** A key that is not 64 lowercase hex characters. The key is never echoed. */
export class InvalidBlobKeyError extends Error {
  override readonly name = 'InvalidBlobKeyError';
  constructor() {
    super('A blob key is the SHA-256 of the blob: 64 lowercase hexadecimal characters.');
  }
}

/** The bytes are not the ones the caller said they were. */
export class DigestMismatchError extends Error {
  override readonly name = 'DigestMismatchError';
  constructor() {
    super('The bytes do not have the SHA-256 the caller expected; nothing was stored.');
  }
}

/** Answer `key` if it is a blob key, or throw {@link InvalidBlobKeyError}. */
export function requireBlobKey(key: unknown): string {
  if (typeof key !== 'string' || !BLOB_KEY.test(key)) throw new InvalidBlobKeyError();
  return key;
}

/** The SHA-256 of `bytes`, lowercase hex, through Web Crypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The key `bytes` will be stored under, checked against what the caller
 * expected. Both are validated before anything is written.
 */
export async function keyFor(bytes: Uint8Array, expectedSha256?: string): Promise<string> {
  if (expectedSha256 !== undefined) requireBlobKey(expectedSha256);
  const key = await sha256Hex(bytes);
  if (expectedSha256 !== undefined && expectedSha256 !== key) throw new DigestMismatchError();
  return key;
}
