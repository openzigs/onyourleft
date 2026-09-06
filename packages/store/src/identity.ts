// SPDX-License-Identifier: Apache-2.0

/**
 * What this store holds for #61: the device's key, and the signed records.
 *
 * ## Two rows, and the difference between them is the whole security argument
 *
 * | Row | Holds | Leaves the device |
 * |---|---|---|
 * | `deviceKeys` | the athlete's **private** key, as a non-extractable `CryptoKey`, plus the public half as hex | never, in any form |
 * | `activityRecords` | a {@link SignedActivityRecord} — public key, content hash, claims, signature | that is what it is *for* |
 *
 * The private half is a `CryptoKey` created with `extractable: false`, so
 * `crypto.subtle.exportKey` on it **rejects**. That is stronger than a
 * convention about which fields an export includes: there is no sequence of
 * calls, in this package or above it, that turns the stored value back into
 * bytes. `web-crypto.ts` creates it and `identity-safety.test.ts` proves the
 * export refusal rather than asserting it in a comment.
 *
 * A `CryptoKey` survives the structured clone algorithm, which is what makes
 * storing one in IndexedDB possible at all — and is also why the row's
 * persisted shape is not a flattening of the record the way `persisted.ts`'s
 * are: there is nothing here to flatten, because the one field that is not a
 * string is a handle that must be stored **as** a handle.
 *
 * ## What comes back out is untrusted, records included
 *
 * `persisted.ts` says why: the row was written by an earlier build, or
 * hand-edited in a devtools pane. A signed record has a stronger reason still —
 * it may have arrived from somebody else's device — so it is re-parsed through
 * `parseSignedActivityRecord`, the same untrusted-input boundary a record
 * arriving over a network would cross.
 */

import {
  parseSignedActivityRecord,
  SIGNATURE_ALGORITHM,
  unixSeconds,
  type SignatureAlgorithm,
  type SignedActivityRecord,
  type UnixSeconds,
} from '@onyourleft/domain';

import { StoreDecodeError } from './errors';
import { activityId, athleteId, type ActivityId, type AthleteId } from './ids';
import { decodedNumber, decodedString } from './persisted';

/**
 * The athlete's identity on this device.
 *
 * One per athlete — the primary key is `athleteId`, so the row *is* the
 * athlete's key and there is no query that answers "the key with this id"
 * without being told whose. Write-once: `ActivityStore.putDeviceKey` refuses to
 * replace an existing key with a different one, because replacing it silently
 * is precisely the history-splitting failure #61's first criterion names.
 */
export interface DeviceKeyRecord {
  readonly athleteId: AthleteId;
  readonly algorithm: SignatureAlgorithm;
  /** The public half, lowercase hex, 64 characters. Safe to publish; it *is* the identity. */
  readonly publicKey: string;
  /**
   * The private half, as a handle.
   *
   * **Never bytes.** Created with `extractable: false`, so this value can sign
   * and cannot be read. An export path that walked every field of every row
   * would carry this object and still carry no key material.
   */
  readonly privateKey: CryptoKey;
  readonly createdAt: UnixSeconds;
}

/** One signed record, filed against the ride it vouches for. */
export interface StoredActivityRecord {
  /** The scoping column. Every read of this row filters on it. */
  readonly athleteId: AthleteId;
  /** The ride. Also the primary key: a ride has at most one current record. */
  readonly activityId: ActivityId;
  readonly record: SignedActivityRecord;
}

// --- On-disk shapes ---------------------------------------------------------

/** @see DeviceKeyRecord */
export interface PersistedDeviceKey {
  athleteId: string;
  algorithm: string;
  publicKey: string;
  privateKey: CryptoKey;
  createdAt: number;
}

/** @see StoredActivityRecord */
export interface PersistedActivityRecord {
  activityId: string;
  athleteId: string;
  /** Stored as the record's own JSON shape, so a row *is* the publishable artefact. */
  record: unknown;
}

export function toPersistedDeviceKey(record: DeviceKeyRecord): PersistedDeviceKey {
  return {
    athleteId: record.athleteId,
    algorithm: record.algorithm,
    publicKey: record.publicKey,
    privateKey: record.privateKey,
    createdAt: record.createdAt,
  };
}

/** @throws {StoreDecodeError} */
export function fromPersistedDeviceKey(row: PersistedDeviceKey): DeviceKeyRecord {
  const algorithm = decodedString('deviceKey.algorithm', row.algorithm);
  if (algorithm !== SIGNATURE_ALGORITHM) {
    throw new StoreDecodeError(
      `deviceKey.algorithm must be ${SIGNATURE_ALGORITHM}, and this row declares "${algorithm}"`,
    );
  }
  // Duck-typed rather than `instanceof CryptoKey`: a row read back through the
  // structured clone algorithm is a real `CryptoKey`, but a hand-edited row is
  // whatever somebody typed, and the failure has to be a stated decode error
  // rather than a `TypeError` from inside `crypto.subtle.sign` later.
  const privateKey = row.privateKey as { type?: unknown } | undefined;
  if (privateKey === undefined || privateKey === null || privateKey.type !== 'private') {
    throw new StoreDecodeError('deviceKey.privateKey must be a private CryptoKey');
  }
  return {
    athleteId: athleteId(decodedString('deviceKey.athleteId', row.athleteId)),
    algorithm: SIGNATURE_ALGORITHM,
    publicKey: decodedString('deviceKey.publicKey', row.publicKey),
    privateKey: row.privateKey,
    createdAt: unixSeconds(decodedNumber('deviceKey.createdAt', row.createdAt)),
  };
}

export function toPersistedActivityRecord(row: StoredActivityRecord): PersistedActivityRecord {
  return {
    activityId: row.activityId,
    athleteId: row.athleteId,
    record: row.record,
  };
}

/** @throws {StoreDecodeError} if the row is not a record this build can read. */
export function fromPersistedActivityRecord(row: PersistedActivityRecord): StoredActivityRecord {
  const parsed = parseSignedActivityRecord(row.record);
  if (!parsed.ok) {
    throw new StoreDecodeError(
      `the signed record on disk is not one this build can read: ${parsed.outcome.status === 'malformed' || parsed.outcome.status === 'unsupported' ? parsed.outcome.reason : parsed.outcome.status}`,
    );
  }
  return {
    activityId: activityId(decodedString('activityRecord.activityId', row.activityId)),
    athleteId: athleteId(decodedString('activityRecord.athleteId', row.athleteId)),
    record: parsed.record,
  };
}
