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
import { encodeCursor, parsePageRequest, type Page } from '../pagination.ts';
import {
  SYNC_KINDS,
  type ActivityRecord,
  type ManifestPosition,
  type SqlStore,
  type SyncKind,
} from '../store/sql-store.ts';
import {
  decodeActivityFile,
  downsample,
  STREAM_CHANNELS,
  type StreamChannel,
} from './activity-file.ts';
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

/** One of the caller's activities, as the list shows it (#38). */
export interface ActivityView {
  readonly contentSha256: string;
  /** Unix seconds. */
  readonly receivedAt: number;
  /** What the signed record claims: #62's list row, never a coordinate. */
  readonly claims: SignedActivityRecord['claims'];
}

/** One activity in detail: the list row, and the signed record itself. */
export interface ActivityDetail extends ActivityView {
  readonly recordSha256: string;
  readonly record: SignedActivityRecord;
}

/**
 * A ride's samples at a resolution (#38): `t` in seconds from the first
 * sample, and each channel beside it, `null` where there was no reading.
 * **No position**, ever — see `activity-file.ts`.
 */
export interface StreamsView {
  /** How many samples the file holds. */
  readonly samples: number;
  /** How many this answer carries: `samples`, or the resolution asked for. */
  readonly points: number;
  readonly t: readonly number[];
  readonly channels: Readonly<Record<StreamChannel, readonly (number | null)[]>>;
}

/** The most points a stream request may ask for; a chart is never wider. */
export const MAXIMUM_STREAM_POINTS = 10_000;

/** One entry of the manifest (#776). */
export interface ManifestEntry {
  readonly kind: SyncKind;
  /** An activity's content SHA-256, or the device's own id for anything else. */
  readonly key: string;
  /** SHA-256 of the item as stored — of the signed record, for an activity. `null` when deleted. */
  readonly digest: string | null;
  /** Unix seconds. */
  readonly receivedAt: number;
  readonly deleted: boolean;
  /** Which ride a live activity is — its record's `claims.activityId` — or `null`. */
  readonly activityId: string | null;
}

/** A signed record, as a pulling device fetches it (#776). */
export interface PulledRecord {
  readonly record: SignedActivityRecord;
  readonly recordSha256: string;
  readonly receivedAt: number;
}

/** An item, exactly as the device sent it (#776). */
export interface StoredItem {
  /** The text the device sent, byte for byte. */
  readonly body: string;
  readonly digest: string;
  readonly receivedAt: number;
}

/** The kinds a device puts as items; an activity comes through {@link Sync.ingest}. */
export const ITEM_KINDS: readonly Exclude<SyncKind, 'activity'>[] = SYNC_KINDS.filter(
  (kind): kind is Exclude<SyncKind, 'activity'> => kind !== 'activity',
);

/**
 * Everything this instance holds about an athlete, machine-readable (#35, and
 * the EU Data Act's Chapter II): every activity as its signed record with the
 * address of its ORIGINAL file — the rider's own true track, unobfuscated,
 * because privacy zones protect a rider from others and not from themselves —
 * and every item exactly as it was sent.
 */
export interface AccountExport {
  readonly format: 'onyourleft.instance-account';
  readonly version: 1;
  /** Unix seconds. */
  readonly exportedAt: number;
  readonly athlete: {
    readonly id: string;
    readonly displayName: string;
    readonly createdAt: number;
    readonly registrationState: string;
  };
  readonly displayNameChanges: readonly {
    readonly previousName: string;
    readonly changedAt: number;
  }[];
  /** PUBLIC keys only: the instance never holds a private one (ADR 0014 D-3). */
  readonly deviceKeys: readonly {
    readonly publicKey: string;
    readonly addedAt: number;
    readonly lastUsedAt: number | null;
    readonly revokedAt: number | null;
  }[];
  readonly recoveryEmail: string | null;
  readonly activities: readonly {
    readonly contentSha256: string;
    readonly recordSha256: string;
    readonly receivedAt: number;
    readonly record: SignedActivityRecord;
    /** Where the original file is: `GET` it with the same session. */
    readonly file: string;
  }[];
  readonly items: readonly {
    readonly kind: SyncKind;
    readonly key: string;
    readonly body: string;
    readonly digest: string;
    readonly receivedAt: number;
  }[];
  readonly results: readonly {
    readonly roomId: string;
    readonly finishMs: number | null;
    readonly flags: number;
  }[];
  /** What is on the instance and deliberately NOT in this file, and why. */
  readonly notIncluded: readonly string[];
}

/** What the export says it leaves out. Fixed sentences; nothing from the account. */
export const EXPORT_LEAVES_OUT: readonly string[] = [
  'Session tokens, recovery codes, link codes and email-recovery tokens: the instance keeps only a hash of each, and a hash is of no use to you.',
  'Items you deleted: the instance keeps only that they were deleted, so your other devices can delete them too.',
  'Other riders’ results in the rooms you rode in: they are theirs.',
];

export interface Sync {
  /** #35: everything this instance holds about the caller. */
  exportAccount(caller: Caller): Promise<Outcome<AccountExport>>;
  /**
   * #35: remove the athlete from this instance — every row, and every file
   * no other athlete also holds. Safe to call again after a failure part way:
   * files go first, while the rows that name them are still there to be found.
   */
  eraseAccount(athleteId: string): Promise<void>;
  /** #776: the caller's manifest, `(receivedAt, id)`-paged, tombstones included. */
  manifest(caller: Caller, query: URLSearchParams): Promise<Outcome<Page<ManifestEntry>>>;
  /** #776: one of the caller's signed records, for a device to verify before it writes. */
  record(caller: Caller, contentSha256: string): Promise<Outcome<PulledRecord>>;
  /** #776: store an item — a write-up, a side-camera report, a goal, a note, a document. */
  putItem(
    caller: Caller,
    kind: string,
    key: string,
    body: unknown,
  ): Promise<
    Outcome<{ readonly digest: string; readonly receivedAt: number; readonly unchanged: boolean }>
  >;
  getItem(caller: Caller, kind: string, key: string): Promise<Outcome<StoredItem>>;
  /** #776: delete an item, or an activity by its content hash, leaving a tombstone. */
  deleteItem(caller: Caller, kind: string, key: string): Promise<Outcome<null>>;
  ingest(caller: Caller, body: Readonly<Record<string, unknown>>): Promise<Outcome<Ingested>>;
  /** The original file, byte for byte — only to an athlete who holds a record of it. */
  file(caller: Caller, contentSha256: string): Promise<Outcome<Uint8Array>>;
  /** #38: the caller's activities, newest first, one store query a page. */
  activities(caller: Caller, query: URLSearchParams): Promise<Outcome<Page<ActivityView>>>;
  /** #38: one of the caller's activities. */
  activity(caller: Caller, contentSha256: string): Promise<Outcome<ActivityDetail>>;
  /** #38: one of the caller's activities' samples, at `?points=` or in full. */
  streams(
    caller: Caller,
    contentSha256: string,
    query: URLSearchParams,
  ): Promise<Outcome<StreamsView>>;
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

  /**
   * THE read every per-activity route goes through (#38's choke point): the
   * caller's own record of this file, or nothing. Keyed by the caller AND the
   * content, so a record another athlete holds of the same bytes is not it.
   */
  const owned = (caller: Caller, contentSha256: string): Promise<ActivityRecord | undefined> =>
    BLOB_KEY.test(contentSha256)
      ? store.getActivityRecord(caller.athleteId, contentSha256)
      : Promise.resolve(undefined);

  /** Remove a file nobody holds a record of any more, under the file's lock. */
  const collect = (contentSha256: string): Promise<void> =>
    lock.hold(contentSha256, async () => {
      if (!(await store.isContentHeld(contentSha256))) await blobs.delete(contentSha256);
    });

  const itemKind = (kind: string): Exclude<SyncKind, 'activity'> | undefined =>
    ITEM_KINDS.find((each) => each === kind);

  return {
    exportAccount: async (caller) => {
      const athlete = await store.getAthlete(caller.athleteId);
      if (athlete === undefined) return refuse('not_found');
      const records = await store.listActivityRecords(caller.athleteId);
      const activities = [];
      for (const record of records) {
        activities.push({
          contentSha256: record.contentSha256,
          recordSha256: toHex(await sha256Bytes(record.signedRecord)),
          receivedAt: record.receivedAt,
          record: storedRecord(record),
          file: `/v1/sync/files/${record.contentSha256}`,
        });
      }
      const items = [];
      let after: ManifestPosition | undefined;
      for (;;) {
        const page = await store.listSyncManifest(caller.athleteId, after, 500);
        for (const row of page) {
          if (row.kind === 'activity' || row.body === null || row.digest === null) continue;
          items.push({
            kind: row.kind,
            key: row.key,
            body: new TextDecoder().decode(row.body),
            digest: row.digest,
            receivedAt: row.receivedAt,
          });
        }
        const last = page.at(-1);
        if (page.length < 500 || last === undefined) break;
        after = { receivedAt: last.receivedAt, seq: last.seq };
      }
      return {
        ok: true,
        value: {
          format: 'onyourleft.instance-account',
          version: 1,
          exportedAt: seconds(),
          athlete: {
            id: athlete.id,
            displayName: athlete.displayName,
            createdAt: athlete.createdAt,
            registrationState: athlete.registrationState,
          },
          displayNameChanges: (await store.listDisplayNameChanges(caller.athleteId)).map(
            (change) => ({ previousName: change.previousName, changedAt: change.changedAt }),
          ),
          deviceKeys: (await store.listDeviceKeys(caller.athleteId)).map((key) => ({
            publicKey: key.publicKey,
            addedAt: key.addedAt,
            lastUsedAt: key.lastUsedAt,
            revokedAt: key.revokedAt,
          })),
          recoveryEmail: (await store.getRecoveryEmail(caller.athleteId))?.address ?? null,
          activities,
          items,
          results: (await store.listResults(caller.athleteId)).map((result) => ({
            roomId: result.roomId,
            finishMs: result.finishMs,
            flags: result.flags,
          })),
          notIncluded: EXPORT_LEAVES_OUT,
        },
      };
    },

    eraseAccount: async (athleteId) => {
      // Files first, while this athlete's rows still name them: a failure here
      // leaves the rows, so a retry finds the same files again (#35).
      for (const record of await store.listActivityRecords(athleteId)) {
        await lock.hold(record.contentSha256, async () => {
          if (!(await store.isContentHeld(record.contentSha256, athleteId))) {
            await blobs.delete(record.contentSha256);
          }
        });
      }
      const erased = await store.eraseAthlete(athleteId);
      // A record that arrived while the files were going is swept here.
      for (const contentSha256 of erased) await collect(contentSha256);
    },

    manifest: async (caller, query) => {
      const request = parsePageRequest(query);
      if (!request.ok) return refuse('validation_failed', request.fields);
      const { limit, after } = request.request;
      let position;
      if (after !== undefined) {
        position = { receivedAt: Number(after.key), seq: Number(after.id) };
        if (!Number.isSafeInteger(position.receivedAt) || !Number.isSafeInteger(position.seq)) {
          return invalid('cursor', 'must be a cursor this instance returned');
        }
      }
      const rows = await store.listSyncManifest(caller.athleteId, position, limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        ok: true,
        value: {
          items: page.map((row) => ({
            kind: row.kind,
            key: row.key,
            digest: row.digest,
            receivedAt: row.receivedAt,
            deleted: row.deletedAt !== null,
            activityId:
              row.signedRecord === null
                ? null
                : storedRecord({ ...row, contentSha256: row.key, signedRecord: row.signedRecord })
                    .claims.activityId,
          })),
          next:
            rows.length > limit && last !== undefined
              ? encodeCursor({ key: String(last.receivedAt), id: String(last.seq) })
              : null,
        },
      };
    },

    record: async (caller, contentSha256) => {
      const held = await owned(caller, contentSha256);
      if (held === undefined) return refuse('not_found');
      return {
        ok: true,
        value: {
          record: storedRecord(held),
          recordSha256: toHex(await sha256Bytes(held.signedRecord)),
          receivedAt: held.receivedAt,
        },
      };
    },

    putItem: async (caller, kind, key, body) => {
      const known = itemKind(kind);
      if (known === undefined) return refuse('not_found');
      if (typeof body !== 'string') return invalid('body', 'must be the item, as text');
      // Kept byte for byte: a write-up is the device's screened copy (#776).
      const bytes = new TextEncoder().encode(body);
      const digest = toHex(await sha256Bytes(bytes));
      const outcome = await store.putSyncItem({
        athleteId: caller.athleteId,
        kind: known,
        key,
        body: bytes,
        digest,
        now: seconds(),
      });
      const stored = await store.getSyncItem(caller.athleteId, known, key);
      return {
        ok: true,
        value: {
          digest,
          receivedAt: stored?.receivedAt ?? seconds(),
          unchanged: outcome === 'unchanged',
        },
      };
    },

    getItem: async (caller, kind, key) => {
      const known = itemKind(kind);
      if (known === undefined) return refuse('not_found');
      const item = await store.getSyncItem(caller.athleteId, known, key);
      if (item?.body === null || item?.body === undefined || item.digest === null) {
        return refuse('not_found');
      }
      return {
        ok: true,
        value: {
          body: new TextDecoder().decode(item.body),
          digest: item.digest,
          receivedAt: item.receivedAt,
        },
      };
    },

    deleteItem: async (caller, kind, key) => {
      const known: SyncKind | undefined = kind === 'activity' ? 'activity' : itemKind(kind);
      if (known === undefined) return refuse('not_found');
      if (known === 'activity' && !BLOB_KEY.test(key)) return refuse('not_found');
      const removed = await store.deleteSyncItem(caller.athleteId, known, key, seconds());
      if (!removed) return refuse('not_found');
      if (known === 'activity') await collect(key);
      return { ok: true, value: null };
    },

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
      const held = await owned(caller, contentSha256);
      if (held === undefined) return refuse('not_found');
      const bytes = await blobs.get(contentSha256);
      return bytes === undefined ? refuse('not_found') : { ok: true, value: bytes };
    },

    activities: async (caller, query) => {
      const request = parsePageRequest(query);
      if (!request.ok) return refuse('validation_failed', request.fields);
      const { limit, after } = request.request;
      const before = after === undefined ? undefined : Number(after.id);
      if (before !== undefined && (after?.key !== 'seq' || !Number.isSafeInteger(before))) {
        return invalid('cursor', 'must be a cursor this instance returned');
      }
      // One query for the page, and one row more than the page: that row says
      // whether there is a next page without a second query (#38's counter).
      const rows = await store.listActivityPage(caller.athleteId, before, limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        ok: true,
        value: {
          items: page.map(({ record }) => viewOf(record)),
          next:
            rows.length > limit && last !== undefined
              ? encodeCursor({ key: 'seq', id: String(last.seq) })
              : null,
        },
      };
    },

    activity: async (caller, contentSha256) => {
      const held = await owned(caller, contentSha256);
      if (held === undefined) return refuse('not_found');
      return {
        ok: true,
        value: {
          ...viewOf(held),
          recordSha256: toHex(await sha256Bytes(held.signedRecord)),
          record: storedRecord(held),
        },
      };
    },

    streams: async (caller, contentSha256, query) => {
      const asked = query.getAll('points');
      let points: number | undefined;
      if (asked.length > 1) return invalid('points', 'must be given at most once');
      if (asked.length === 1) {
        points = /^[0-9]{1,6}$/.test(asked[0] ?? '') ? Number(asked[0]) : Number.NaN;
        if (!Number.isInteger(points) || points < 2 || points > MAXIMUM_STREAM_POINTS) {
          return invalid(
            'points',
            `must be a whole number from 2 to ${String(MAXIMUM_STREAM_POINTS)}`,
          );
        }
      }
      const held = await owned(caller, contentSha256);
      if (held === undefined) return refuse('not_found');
      const bytes = await blobs.get(contentSha256);
      if (bytes === undefined) return refuse('not_found');
      const decoded = decodeActivityFile(bytes);
      // It decoded when it was ingested; a file that no longer does is not a stream.
      if (!decoded.ok) return refuse('not_found');
      const served = points === undefined ? decoded.samples : downsample(decoded.samples, points);
      const channels = Object.fromEntries(
        STREAM_CHANNELS.map((channel) => [channel, served.map((sample) => sample[channel])]),
      ) as Record<StreamChannel, (number | null)[]>;
      return {
        ok: true,
        value: {
          samples: decoded.samples.length,
          points: served.length,
          t: served.map((sample) => sample.t),
          channels,
        },
      };
    },
  };
}

/** A stored record as the list shows it. */
function viewOf(record: ActivityRecord): ActivityView {
  return {
    contentSha256: record.contentSha256,
    receivedAt: record.receivedAt,
    claims: storedRecord(record).claims,
  };
}
