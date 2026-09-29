// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sync on an instance: what a device sends, and what it may read back (#37,
 * #38, #776, #35). The routes in `routes.ts` turn each {@link Outcome} into a
 * response and do nothing else; the rules are here.
 *
 * ## Every read and write is the caller's own
 *
 * Every method takes the signed-in {@link Caller} and hands the store
 * `caller.athleteId` — never an athlete id from the request. Another athlete's
 * record, file or item is `not_found`, the same answer as one that does not
 * exist (`errors.ts` §"Why there is no forbidden"). Two athletes who sent the
 * same file each hold their own record of it, keyed by `(athlete, content)`,
 * and neither can reach the other's through the content hash (#776).
 *
 * ## Ingestion — #37
 *
 * The device has already decoded the file and signed a record of it (#61). So
 * the instance checks, in this order, each refusal with its own code:
 *
 * 1. `validation_failed` — the body is not `{record, file}` with `file` base64.
 * 2. `file_type_unsupported` — the bytes are not FIT, GPX or TCX, sniffed from
 *    the bytes (`activity-file.ts`).
 * 3. `file_undecodable` — they do not decode, or hold no sample.
 * 4. The record, by `@onyourleft/domain`'s `verifyActivityRecord` — ADR 0014
 *    D-6's answers, each its own code: `record_malformed`,
 *    `record_unsupported`, `record_signature_mismatch`,
 *    `record_content_mismatch`. A record that does not verify is REFUSED, not
 *    stored unverified (#37's revision).
 * 5. `record_not_your_key` — it verifies, and the key that signed it is not
 *    one of the caller's (revoked keys count: a key's records stay valid after
 *    it is revoked, ADR 0014 D-6).
 *
 * Only then is anything written: the file to the blob store, then the record
 * and its manifest row in one transaction. If the transaction fails, the file
 * is removed again unless another athlete's record holds it — so a failure
 * leaves no orphan (#37's wrong-layer criterion), and never takes somebody
 * else's file. A duplicate (the same file, the same athlete, however many
 * requests race) is decided by the primary key and answers the FIRST record.
 */

import {
  canonicalJson,
  SIGNATURE_ALGORITHM,
  toHex,
  verifyActivityRecord,
  type CanonicalObject,
  type SignatureVerifier,
  type SignedActivityRecord,
} from '@onyourleft/domain';

import { verifyEd25519 } from '../auth/crypto.ts';
import type { Caller, Outcome } from '../auth/identity.ts';
import { BLOB_KEY, type BlobStore } from '../blob/blob-store.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import type { ActivityRecord, SqlStore } from '../store/sql-store.ts';
import { decodeActivityFile } from './activity-file.ts';
import { createContentLock } from './content-lock.ts';

export interface SyncOptions {
  readonly store: SqlStore;
  readonly blobs: BlobStore;
  /** Unix milliseconds. */
  readonly now?: () => number;
}

/** What ingesting a record answers. */
export interface Ingested {
  readonly contentSha256: string;
  readonly recordSha256: string;
  /** Unix seconds. */
  readonly receivedAt: number;
  /** `true` when the athlete already held this file: the first record is what answers. */
  readonly duplicate: boolean;
}

export interface Sync {
  ingest(caller: Caller, body: Readonly<Record<string, unknown>>): Promise<Outcome<Ingested>>;
  /** The original file, byte for byte — only to an athlete who holds a record of it. */
  file(caller: Caller, contentSha256: string): Promise<Outcome<Uint8Array>>;
}

const refuse = (code: ErrorCode, fields?: readonly FieldProblem[]): Outcome<never> =>
  fields === undefined ? { ok: false, code } : { ok: false, code, fields };

const invalid = (field: string, problem: string): Outcome<never> =>
  refuse('validation_failed', [{ field, problem }]);

/** Web Crypto's Ed25519, as `@onyourleft/domain`'s verification seam. */
export const INSTANCE_VERIFIER: SignatureVerifier = {
  algorithm: SIGNATURE_ALGORITHM,
  verify: ({ publicKey, message, signature }) =>
    verifyEd25519(toHex(publicKey), message, toHex(signature)),
};

export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
}

const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Standard base64 (RFC 4648 §4, padded) to bytes, or `undefined`. `atob` is
 * the decoder, so this names nothing of Node; the checks before it refuse what
 * `atob`'s forgiving form would let through (no padding, embedded spaces).
 */
export function fromBase64(text: unknown): Uint8Array | undefined {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !BASE64_ALPHABET.test(text)) {
    return undefined;
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Bytes to standard base64. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** The record's bytes as the instance keeps them: RFC 8785 canonical JSON, UTF-8. */
export function recordBytes(record: SignedActivityRecord): Uint8Array {
  return new TextEncoder().encode(canonicalJson(record as unknown as CanonicalObject));
}

/** A stored record's bytes, parsed back. They were canonical JSON when written. */
export function storedRecord(record: ActivityRecord): SignedActivityRecord {
  return JSON.parse(new TextDecoder().decode(record.signedRecord)) as SignedActivityRecord;
}

const VERIFICATION_CODES = {
  malformed: 'record_malformed',
  unsupported: 'record_unsupported',
  'signature-mismatch': 'record_signature_mismatch',
  'content-mismatch': 'record_content_mismatch',
} as const satisfies Record<string, ErrorCode>;

export function createSync(options: SyncOptions): Sync {
  const { store, blobs } = options;
  const now = options.now ?? (() => Date.now());
  const seconds = (): number => Math.floor(now() / 1000);
  const lock = createContentLock();

  return {
    ingest: async (caller, body) => {
      const { record, file } = body;
      if (typeof record !== 'object' || record === null || Array.isArray(record)) {
        return invalid('record', 'must be a signed activity record');
      }
      const bytes = fromBase64(file);
      if (bytes === undefined || bytes.length === 0) {
        return invalid('file', 'must be the activity file, base64');
      }
      const decoded = decodeActivityFile(bytes);
      if (!decoded.ok) return refuse(decoded.refusal);

      const digest = await sha256Bytes(bytes);
      const verification = await verifyActivityRecord(record, {
        verifier: INSTANCE_VERIFIER,
        fileDigest: digest,
      });
      if (verification.status !== 'verified') {
        return refuse(VERIFICATION_CODES[verification.status]);
      }
      const verified = verification.record;
      const keys = await store.listDeviceKeys(caller.athleteId);
      if (!keys.some((key) => key.publicKey === verified.publicKey)) {
        return refuse('record_not_your_key');
      }

      const contentSha256 = toHex(digest);
      const signedRecord = recordBytes(verified);
      const recordSha256 = toHex(await sha256Bytes(signedRecord));
      const ingested = await lock.hold(contentSha256, async () => {
        await blobs.put(bytes, contentSha256);
        try {
          return await store.ingestActivity({
            athleteId: caller.athleteId,
            contentSha256,
            signedRecord,
            recordSha256,
            now: seconds(),
          });
        } catch (error) {
          // The wrong-layer failure (#37): the file is stored and the record
          // is not. Take the file back unless somebody's record holds it.
          if (!(await store.isContentHeld(contentSha256))) await blobs.delete(contentSha256);
          throw error;
        }
      });
      return {
        ok: true,
        value: {
          contentSha256,
          recordSha256:
            ingested.outcome === 'stored'
              ? recordSha256
              : toHex(await sha256Bytes(ingested.record.signedRecord)),
          receivedAt: ingested.record.receivedAt,
          duplicate: ingested.outcome === 'duplicate',
        },
      };
    },

    file: async (caller, contentSha256) => {
      if (!BLOB_KEY.test(contentSha256)) return refuse('not_found');
      const held = await store.getActivityRecord(caller.athleteId, contentSha256);
      if (held === undefined) return refuse('not_found');
      const bytes = await blobs.get(contentSha256);
      return bytes === undefined ? refuse('not_found') : { ok: true, value: bytes };
    },
  };
}
