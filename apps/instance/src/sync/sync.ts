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
 *    one of the caller's.
 * 6. `record_key_revoked` — the key is the caller's and has been revoked, and
 *    the ride the record describes started at or after the revocation (#898).
 *    A revoked key's records of rides BEFORE it was revoked stay valid (ADR
 *    0014 D-6), so a device that synced late still delivers them. ⚠️ The
 *    start time is signed by the very key under suspicion, so this bounds an
 *    honest late sync and refuses a record a revoked key dates after its
 *    revocation; it does NOT stop a thief holding the key who backdates the
 *    ride. There is no trustworthy start time to use instead: a late device
 *    legitimately delivers after the revocation, so when the record arrived
 *    cannot tell the two apart (#926's review).
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
import { accountChangeView, type Caller, type Outcome } from '../auth/identity.ts';
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
  /**
   * Told after an item is stored, so the history index can cut it (#835,
   * ADR 0040 D-1) — `history.ts` §`History.schedule`. Not awaited: a rider's
   * sync never waits on the embedding model. A deletion needs no call: the
   * index rows go in the store's own transaction (`sql-store.ts`
   * §`replaceSyncRow`).
   */
  readonly itemStored?: () => void;
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
  /** A live activity's "may be raced" consent (#793), or `null` for anything else. */
  readonly mayBeRaced: boolean | null;
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
    /** When a moderator suspended the account, or `null` (#83). */
    readonly suspendedAt: number | null;
    /** When a moderator hid the display name, or `null` (#83). */
    readonly displayNameHiddenAt: number | null;
    /** When the rider confirmed they are 18 or over, or `null` (#775). */
    readonly adultConfirmedAt: number | null;
    /** When the account became active — registered active, or approved — or `null` (#775). */
    readonly activatedAt: number | null;
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
  /**
   * The account-change log (#1193, ADR 0047 D-8): every account-security
   * change, oldest first, with the PUBLIC key that authorised it.
   */
  readonly accountChanges: readonly {
    readonly id: number;
    readonly at: number;
    readonly kind: string;
    readonly actorKey: string;
    readonly subjectKey: string | null;
    readonly via: string | null;
    readonly address: string | null;
  }[];
  /** How far each of the athlete's devices has acknowledged that log (#1193). */
  readonly accountChangeMarks: readonly {
    readonly deviceKey: string;
    readonly acknowledgedThrough: number;
    readonly acknowledgedAt: number;
  }[];
  readonly activities: readonly {
    readonly contentSha256: string;
    readonly recordSha256: string;
    readonly receivedAt: number;
    readonly record: SignedActivityRecord;
    /** Where the original file is: `GET` it with the same session. */
    readonly file: string;
    /** The rider's "may be raced" consent on this ride (#793). Not in the signed record. */
    readonly mayBeRaced: boolean;
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
  /** The athletes this one blocked (#83): the id they gave, whether or not anybody holds it. */
  readonly blocks: readonly { readonly blockedAthleteId: string; readonly createdAt: number }[];
  /**
   * The reports this athlete made (#83): whom, why and when — and NOT how or
   * whether one was decided. A report about an id nobody holds is stored
   * already closed (`no_such_athlete`), so a decision would tell the reporter
   * which ids are real, and which action a moderator took (#893's review).
   */
  readonly reports: readonly {
    readonly targetAthleteId: string;
    readonly reason: string;
    readonly createdAt: number;
  }[];
  /**
   * Recovery addresses given and waiting to be confirmed, or spent (#865): the
   * address in plain text, as the instance holds it, and never the token's hash.
   */
  readonly recoveryEmailConfirmations: readonly {
    readonly address: string;
    readonly expiresAt: number;
    readonly usedAt: number | null;
  }[];
  /**
   * That a history index of the items above exists, and which model built it
   * (#835, ADR 0040 D-10): the model, the vectors' dimension and how many
   * passages. Empty when there is none. The passages and vectors themselves
   * are NOT here — see {@link AccountExport.notIncluded}.
   */
  readonly historyIndex: readonly {
    readonly model: string;
    readonly dimension: number;
    readonly passages: number;
  }[];
  /**
   * {@link HOSTED_KEY_HELD} when the instance holds a hosted model key for
   * this athlete (#1097), and `null` when it does not. That and nothing
   * else: never the key, its service or its model.
   */
  readonly hostedModelKey: typeof HOSTED_KEY_HELD | null;
  /** What is on the instance and deliberately NOT in this file, and why. */
  readonly notIncluded: readonly string[];
}

/** What the export says of a hosted model key the instance holds for the athlete (#1097). */
export const HOSTED_KEY_HELD = 'a hosted model key is held';

/** What the export says it leaves out. Fixed sentences; nothing from the account. */
export const EXPORT_LEAVES_OUT: readonly string[] = [
  'Session tokens, recovery codes, link codes, email-recovery tokens and the tokens mailed to confirm a recovery address: the instance keeps only a hash of each, and a hash is of no use to you.',
  'Items you deleted: the instance keeps only that they were deleted, so your other devices can delete them too.',
  'Other riders’ results in the rooms you rode in: they are theirs.',
  'Invitations you minted as a moderator: the instance keeps only a hash of each code, and a hash is of no use to you.',
  'How a report you made was decided, and when: that is the moderators’ record, not the reporter’s.',
  'The moderation log: what moderators did, and to whom, is the instance’s audit trail and is kept even when an account is deleted. Ask the instance’s operator for what it says about you.',
  'Reports other riders made about you: they are the reporters’, and naming them would tell you who they are.',
  'The history index’s passages and vectors: they are cut from the items above and worked out by the model named in historyIndex, so the same model can make them again from those items, and without it they mean nothing.',
  'A hosted model key: hostedModelKey says only whether one is held. The key is a secret the operator set and can set again, and this file is meant to be carried around.',
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
  /**
   * #793: set or revoke the "may be raced" consent on one of the caller's
   * rides, by the SHA-256 of its file (ADR 0021 D-5.1). `not_found` for a ride
   * the caller does not hold — another athlete's included.
   */
  setRaceConsent(
    caller: Caller,
    contentSha256: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<{ readonly mayBeRaced: boolean }>>;
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
      const items = [];
      // Each live ride's consent, which the manifest carries beside it (#793).
      const consent = new Map<string, boolean>();
      let after: ManifestPosition | undefined;
      for (;;) {
        const page = await store.listSyncManifest(caller.athleteId, after, 500);
        for (const row of page) {
          if (row.kind === 'activity' && row.mayBeRaced !== null) {
            consent.set(row.key, row.mayBeRaced);
          }
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
      const records = await store.listActivityRecords(caller.athleteId);
      const activities = [];
      for (const record of records) {
        activities.push({
          contentSha256: record.contentSha256,
          recordSha256: toHex(await sha256Bytes(record.signedRecord)),
          receivedAt: record.receivedAt,
          record: storedRecord(record),
          file: `/v1/sync/files/${record.contentSha256}`,
          mayBeRaced: consent.get(record.contentSha256) ?? false,
        });
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
            suspendedAt: athlete.suspendedAt,
            displayNameHiddenAt: athlete.displayNameHiddenAt,
            adultConfirmedAt: athlete.adultConfirmedAt,
            activatedAt: athlete.activatedAt,
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
          accountChanges: (await store.listAccountChanges(caller.athleteId)).map(accountChangeView),
          accountChangeMarks: (await store.listAccountChangeMarks(caller.athleteId)).map(
            (mark) => ({
              deviceKey: mark.deviceKey,
              acknowledgedThrough: mark.acknowledgedThrough,
              acknowledgedAt: mark.acknowledgedAt,
            }),
          ),
          activities,
          items,
          results: (await store.listResults(caller.athleteId)).map((result) => ({
            roomId: result.roomId,
            finishMs: result.finishMs,
            flags: result.flags,
          })),
          blocks: (await store.listBlocks(caller.athleteId)).map((block) => ({
            blockedAthleteId: block.blockedAthleteId,
            createdAt: block.createdAt,
          })),
          reports: (await store.listReports(caller.athleteId)).map((report) => ({
            targetAthleteId: report.targetAthleteId,
            reason: report.reason,
            createdAt: report.createdAt,
          })),
          recoveryEmailConfirmations: (await store.listEmailConfirmations(caller.athleteId))
            .map((confirmation) => ({
              address: confirmation.address,
              expiresAt: confirmation.expiresAt,
              usedAt: confirmation.usedAt,
            }))
            .sort((a, b) => a.expiresAt - b.expiresAt),
          historyIndex: (await store.summariseHistoryIndex(caller.athleteId)).map((row) => ({
            model: row.model,
            dimension: row.dimension,
            passages: row.passages,
          })),
          hostedModelKey:
            (await store.getHostedModelKey())?.athleteId === caller.athleteId
              ? HOSTED_KEY_HELD
              : null,
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
            mayBeRaced: row.signedRecord === null ? null : row.mayBeRaced,
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

    setRaceConsent: async (caller, contentSha256, body) => {
      if (!BLOB_KEY.test(contentSha256)) return refuse('not_found');
      const { mayBeRaced } = body;
      if (typeof mayBeRaced !== 'boolean') return invalid('mayBeRaced', 'must be true or false');
      const set = await store.setActivityMayBeRaced(caller.athleteId, contentSha256, mayBeRaced);
      return set ? { ok: true, value: { mayBeRaced } } : refuse('not_found');
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
      if (outcome === 'stored') options.itemStored?.();
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
      const signer = keys.find((key) => key.publicKey === verified.publicKey);
      if (signer === undefined) return refuse('record_not_your_key');
      // A revoked key signs only for rides that started before it was revoked
      // (#898): both are Unix seconds, and a ride starting AT the revocation
      // is after it. The start is the key's own claim, so a backdated one
      // passes — the header says what this does and does not stop.
      if (signer.revokedAt !== null && verified.claims.startedAt >= signer.revokedAt) {
        return refuse('record_key_revoked');
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
