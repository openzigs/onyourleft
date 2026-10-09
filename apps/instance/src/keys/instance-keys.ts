// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's own two keys** — #1189, ADR 0047 D-4, D-5, D-6.
 *
 * - The **identity** key, Ed25519, which a device pins and which only signs.
 * - The **encryption** key, X25519, the HPKE recipient (`/v1/sealed`, #1191),
 *   published only inside an `oyl-instance-key-v1` statement the identity key
 *   signs (`packages/domain` §`instance-key-statement.ts`), served at
 *   `GET /v1/instance/keys` (`keys/routes.ts`).
 *
 * Both private halves are kept in `instance_key`, wrapped under the operator's
 * secret (`keys/wrap.ts`), and only ever unwrapped into memory as
 * non-extractable `CryptoKey`s. **No secret, no keys**: with no
 * `OYL_INSTANCE_SECRET_KEY` this module makes nothing and every answer is
 * {@link NO_SECRET_SENTENCE}; it never makes a key it could not wrap.
 *
 * ## The clock, and the owner's numbers (D-14 Q3)
 *
 * Every time here is the box's clock in Unix seconds, handed in as `now`.
 * {@link InstanceKeys.maintain} applies the whole rule, and the instance runs
 * it at start — before `/v1/instance/keys` answers — and again whenever it
 * says the next thing falls due:
 *
 * 1. no keys at all: make an identity key and an encryption key;
 * 2. the current encryption key is {@link ENCRYPTION_KEY_LIFE_SECONDS} old:
 *    make its successor (a ROTATION);
 * 3. the current key's newest statement has less than
 *    {@link RESIGN_BELOW_SECONDS} left, or none is in date: sign a fresh one,
 *    living {@link STATEMENT_LIFE_SECONDS}. **Only the current key is ever
 *    re-signed**: a superseded key's last statement runs out;
 * 4. a superseded key {@link OLD_KEY_KEPT_SECONDS} after its successor was
 *    made: DELETE its row, scrubbed (`SqlStore.deleteInstanceKeys`).
 *
 * A new key's **serial** is `max(now, highest serial ever issued + 1)` — the
 * clock only seeds it, so a clock put back still issues a higher one — and
 * `notBefore`, `issuedAt` and `notAfter` are the clock as it is (D-5, review
 * G2).
 *
 * ## One writer at a time (#1203)
 *
 * The running instance's timer and an operator's `instance-key` command are
 * two processes over one database. Every pass that WRITES a key —
 * {@link InstanceKeys.maintain}, `rotate`, `rotateIdentity`, `reset` — first
 * takes the database's key lease (migration 0016) for
 * {@link KEY_LEASE_SECONDS}, and gives it back when it is done (§`leased`).
 * While another holds it the pass writes nothing and is refused with
 * {@link KEYS_BUSY_SENTENCE}; the instance tries again a few seconds later,
 * and an operator runs the command again. Reading — `show`, `served`,
 * `encryptionKey` — takes no lease. The identity key is also claimed with a
 * guarded insert (`SqlStore.claimIdentityKey`), so a pass that finds another's
 * identity key already there signs with that one rather than making a second.
 */

import {
  base32Unpadded,
  canonicalJson,
  INSTANCE_IDENTITY_ROTATION_PURPOSE,
  INSTANCE_KEY_PURPOSE,
  instanceCard,
  instanceIdentityFingerprint,
  instanceIdentityRotationBytes,
  instanceKeyId,
  instanceKeyStatementBytes,
  parseInstanceKeyStatement,
  toHex,
  type InstanceIdentityRotation,
  type InstanceKeyStatement,
} from '@onyourleft/domain';

import type { InstanceKeyRow, InstanceKeyStatementRow, SqlStore } from '../store/sql-store.ts';
import {
  makeKey,
  sha256,
  signWith,
  unwrapPrivateKey,
  wrappingKeys,
  type InstanceCryptoKey,
  type MadeKey,
  type WrappingKeys,
} from './wrap.ts';

const DAY_SECONDS = 86_400;

/** A new encryption key every 30 days (D-14 Q3). */
export const ENCRYPTION_KEY_LIFE_SECONDS = 30 * DAY_SECONDS;
/** A statement lives 48 hours (D-14 Q3). */
export const STATEMENT_LIFE_SECONDS = 2 * DAY_SECONDS;
/** Re-signed once fewer than 24 hours are left: daily (D-5). */
export const RESIGN_BELOW_SECONDS = DAY_SECONDS;
/** An old private half is kept 7 days after its successor exists, then deleted (D-5). */
export const OLD_KEY_KEPT_SECONDS = 7 * DAY_SECONDS;

/**
 * How long a key pass may hold the lease before another may take it (#1203):
 * a pass takes milliseconds, so this only bounds how long a process that died
 * holding it keeps the keys from being changed.
 */
export const KEY_LEASE_SECONDS = 60;

/** What every answer says when the operator secret is not set. Names the variable. */
export const NO_SECRET_SENTENCE =
  'This instance has no keys and no sealed routes: OYL_INSTANCE_SECRET_KEY is not set.';
/** What every answer says when there is no origin to bind the keys to. */
export const NO_ORIGIN_SENTENCE =
  'This instance has no keys and no sealed routes: OYL_INSTANCE_ORIGIN is not set.';
/** What `show` says before any key has been made. */
export const NO_KEYS_SENTENCE =
  'This instance has made no keys yet: it makes them on its first start with OYL_INSTANCE_SECRET_KEY set, or `operator instance-key init` does.';
/** What every answer says when this secret does not open the keys it holds. */
export const UNREADABLE_SENTENCE =
  'This instance’s keys cannot be unwrapped with its OYL_INSTANCE_SECRET_KEY: its operator runs `operator instance-key reset`, and every device pins again.';

/** What a pass is told while another process is changing the keys (#1203). */
export const KEYS_BUSY_SENTENCE =
  'Another process is changing this instance’s keys right now: run the command again in a moment.';

/** The store members this module uses. */
export type InstanceKeyStore = Pick<
  SqlStore,
  | 'listInstanceKeys'
  | 'listInstanceKeyStatements'
  | 'putInstanceKey'
  | 'addEncryptionKey'
  | 'putInstanceKeyStatement'
  | 'deleteInstanceKeys'
  | 'replaceIdentityKey'
  | 'clearInstanceKeys'
  | 'claimIdentityKey'
  | 'takeInstanceKeyLease'
  | 'releaseInstanceKeyLease'
>;

/** Why the instance's keys cannot be used or changed now. */
export type InstanceKeysProblem = 'no-secret' | 'no-origin' | 'no-keys' | 'unreadable' | 'busy';

/** Why the instance has no usable keys. A fixed sentence each, never a key. */
export class InstanceKeysUnavailable extends Error {
  override readonly name = 'InstanceKeysUnavailable';
  readonly code: InstanceKeysProblem;
  constructor(code: InstanceKeysProblem) {
    super(
      code === 'no-secret'
        ? NO_SECRET_SENTENCE
        : code === 'no-origin'
          ? NO_ORIGIN_SENTENCE
          : code === 'no-keys'
            ? NO_KEYS_SENTENCE
            : code === 'busy'
              ? KEYS_BUSY_SENTENCE
              : UNREADABLE_SENTENCE,
    );
    this.code = code;
  }
}

/** One statement as served: the members signed, and the signature. */
export interface ServedStatement {
  readonly statement: InstanceKeyStatement;
  /** Ed25519 over the statement's RFC 8785 bytes, lowercase hex. */
  readonly signature: string;
}

/** What `GET /v1/instance/keys` answers. Every byte of it is public. */
export interface ServedKeys {
  /** The identity key, lowercase hex: what a device fingerprints and pins against its card. */
  readonly identityKey: string;
  /** Every in-date statement for a key still held, highest serial first. */
  readonly statements: readonly ServedStatement[];
  /** The old identity key's endorsement of this one, after a planned rotation; else empty. */
  readonly endorsements: readonly {
    readonly statement: InstanceIdentityRotation;
    readonly signature: string;
  }[];
}

/** What one {@link InstanceKeys.maintain} did, and when it next has something to do. */
export interface Maintenance {
  readonly made: boolean;
  readonly rotated: boolean;
  readonly signed: boolean;
  /** How many superseded keys it deleted. */
  readonly deleted: number;
  /** When, by the box's clock, the next step of the rule falls due. */
  readonly nextDueAt: number;
}

/** What `operator instance-key show` prints. Public material only. */
export interface InstanceKeysShown {
  readonly instanceOrigin: string;
  readonly identityKey: string;
  /** The full SHA-256 fingerprint, lowercase hex. */
  readonly fingerprint: string;
  /** The same 32 bytes as the card writes them: 52 base32 characters. */
  readonly fingerprintBase32: string;
  readonly card: string;
  readonly encryptionKeys: readonly {
    readonly keyId: string;
    readonly serial: number;
    readonly createdAt: number;
    readonly supersededAt: number | null;
  }[];
}

export interface InstanceKeys {
  /** Apply the rule above, making keys if there are none. Throws {@link InstanceKeysUnavailable}. */
  maintain(): Promise<Maintenance>;
  /** Make a new encryption key now; `dropOld` deletes every other one at once (D-10). */
  rotate(options?: {
    readonly dropOld?: boolean;
    /** Issue a serial above this, whatever the clock says (D-5, a restore). */
    readonly serialAbove?: number;
  }): Promise<{ readonly keyId: string; readonly serial: number; readonly dropped: number }>;
  /**
   * Make a new identity key. Planned, the OLD key signs an endorsement of the
   * new one; `compromised`, it signs nothing. The old private half is deleted
   * either way, and every device pins again from a new card (D-6, D-14 Q8).
   */
  rotateIdentity(options: { readonly compromised: boolean }): Promise<InstanceKeysShown>;
  /** Every key gone and new ones made: what a lost secret leaves (D-5). Every device re-pins. */
  reset(): Promise<InstanceKeysShown>;
  /** The identity key's fingerprint and card, and the encryption keys held. */
  show(): Promise<InstanceKeysShown>;
  /**
   * What `GET /v1/instance/keys` serves — after the first {@link maintain}
   * has run, so a box back from days off never serves only expired
   * statements.
   */
  served(): Promise<ServedKeys>;
  /** The encryption key `keyId`'s private half, non-extractable, or `undefined` if not held (#1191). */
  encryptionKey(keyId: string): Promise<InstanceCryptoKey | undefined>;
}

export interface InstanceKeysOptions {
  readonly store: InstanceKeyStore;
  /** `OYL_INSTANCE_SECRET_KEY`'s 32 bytes, or `undefined` when it is not set. */
  readonly secret: Uint8Array | undefined;
  /** `OYL_INSTANCE_ORIGIN`, or `null`. */
  readonly origin: string | null;
  /** The box's clock, Unix seconds. */
  readonly now: () => number;
}

/** The serial a new key takes: the clock seeds it, the highest issued floors it (D-5). */
export function nextSerial(now: number, highestIssued: number, serialAbove = 0): number {
  return Math.max(now, highestIssued + 1, serialAbove + 1);
}

export function createInstanceKeys(options: InstanceKeysOptions): InstanceKeys {
  const { store } = options;
  const origin = options.origin;
  const secret = options.secret;
  let wrapping: Promise<WrappingKeys> | undefined;
  /** Unwrapped private halves, by key id: a key id's material never changes. */
  const unwrapped = new Map<string, InstanceCryptoKey>();
  let firstMaintenance: Promise<Maintenance> | undefined;
  /** This process's name on the key lease. */
  const holder = crypto.randomUUID();

  /**
   * Run `operation` holding the key lease (#1203), and give it back after —
   * also when it throws. Refused with `busy`, having written nothing, while
   * another holds it.
   */
  async function leased<T>(operation: () => Promise<T>): Promise<T> {
    keyed();
    const now = options.now();
    if (!(await store.takeInstanceKeyLease(holder, now, now + KEY_LEASE_SECONDS))) {
      throw new InstanceKeysUnavailable('busy');
    }
    try {
      return await operation();
    } finally {
      await store.releaseInstanceKeyLease(holder);
    }
  }

  function keyed(): { wrap: Promise<WrappingKeys>; instanceOrigin: string } {
    if (secret === undefined) throw new InstanceKeysUnavailable('no-secret');
    if (origin === null) throw new InstanceKeysUnavailable('no-origin');
    wrapping ??= wrappingKeys(secret);
    return { wrap: wrapping, instanceOrigin: origin };
  }

  async function privateOf(row: InstanceKeyRow): Promise<InstanceCryptoKey | undefined> {
    const held = unwrapped.get(row.keyId);
    if (held !== undefined) return held;
    const { wrap, instanceOrigin } = keyed();
    const opened = await unwrapPrivateKey(
      await wrap,
      { role: row.role, keyId: row.keyId, instanceOrigin },
      row,
    );
    if (opened !== undefined) unwrapped.set(row.keyId, opened);
    return opened;
  }

  function rowOf(made: MadeKey, at: number, serial: number | null): InstanceKeyRow {
    unwrapped.set(made.keyId, made.privateKey);
    return {
      keyId: made.keyId,
      role: made.role,
      publicKey: made.publicKey,
      iv: made.iv,
      wrapped: made.wrapped,
      serial,
      createdAt: at,
      supersededAt: null,
    };
  }

  function highestSerial(rows: readonly InstanceKeyRow[]): number {
    return rows.reduce((highest, row) => Math.max(highest, row.serial ?? 0), 0);
  }

  function currentOf(rows: readonly InstanceKeyRow[]): InstanceKeyRow | undefined {
    return rows
      .filter((row) => row.role === 'encryption' && row.supersededAt === null)
      .sort((a, b) => (b.serial ?? 0) - (a.serial ?? 0))[0];
  }

  /** The identity key's row and private half; throws `unreadable` if this secret cannot open it. */
  async function identityOf(
    rows: readonly InstanceKeyRow[],
  ): Promise<{ row: InstanceKeyRow; key: InstanceCryptoKey } | undefined> {
    const row = rows.find((each) => each.role === 'identity');
    if (row === undefined) return undefined;
    const key = await privateOf(row);
    if (key === undefined) throw new InstanceKeysUnavailable('unreadable');
    return { row, key };
  }

  async function makeEncryption(
    highestIssued: number,
    serialAbove?: number,
  ): Promise<InstanceKeyRow> {
    const { wrap, instanceOrigin } = keyed();
    const at = options.now();
    const made = await makeKey(await wrap, 'encryption', instanceOrigin);
    return rowOf(made, at, nextSerial(at, highestIssued, serialAbove));
  }

  async function makeIdentity(): Promise<{ row: InstanceKeyRow; key: InstanceCryptoKey }> {
    const { wrap, instanceOrigin } = keyed();
    const made = await makeKey(await wrap, 'identity', instanceOrigin);
    return { row: rowOf(made, options.now(), null), key: made.privateKey };
  }

  /** Sign a fresh statement for `key`, living {@link STATEMENT_LIFE_SECONDS} from now. */
  async function sign(identity: InstanceCryptoKey, key: InstanceKeyRow): Promise<number> {
    const { instanceOrigin } = keyed();
    // Only a key this instance made is vouched for: its private half must open
    // under the secret (the wrap binds role, key id and origin), and its id must
    // be the hash of the public half the statement will carry. A row planted in
    // the database fails one or the other.
    if (
      (await privateOf(key)) === undefined ||
      (await instanceKeyId(sha256, key.publicKey)) !== key.keyId
    ) {
      throw new InstanceKeysUnavailable('unreadable');
    }
    const issuedAt = options.now();
    const statement: InstanceKeyStatement = {
      purpose: INSTANCE_KEY_PURPOSE,
      instanceOrigin,
      keyId: key.keyId,
      encryptionKey: toHex(key.publicKey),
      serial: key.serial ?? 0,
      notBefore: key.createdAt,
      issuedAt,
      notAfter: issuedAt + STATEMENT_LIFE_SECONDS,
    };
    const signature = await signWith(identity, instanceKeyStatementBytes(statement));
    await store.putInstanceKeyStatement(
      {
        keyId: key.keyId,
        kind: 'key',
        issuedAt,
        notAfter: statement.notAfter,
        body: canonicalJson({ ...statement }),
        signature: toHex(signature),
      },
      issuedAt,
    );
    return statement.notAfter;
  }

  function newestNotAfter(
    statements: readonly InstanceKeyStatementRow[],
    keyId: string,
  ): number | undefined {
    return statements
      .filter((each) => each.kind === 'key' && each.keyId === keyId)
      .reduce<number | undefined>(
        (newest, each) => Math.max(newest ?? Number.NEGATIVE_INFINITY, each.notAfter ?? 0),
        undefined,
      );
  }

  async function maintain(): Promise<Maintenance> {
    keyed();
    let rows = await store.listInstanceKeys();
    let made = false;
    let identity = await identityOf(rows);
    if (identity === undefined) {
      // No identity key: the first start with a secret, or `instance-key init`.
      const mine = await makeIdentity();
      if (await store.claimIdentityKey(mine.row)) {
        identity = mine;
        made = true;
      } else {
        // Another pass kept one first: sign with that one, never make a second.
        unwrapped.delete(mine.row.keyId);
        rows = await store.listInstanceKeys();
        identity = await identityOf(rows);
        if (identity === undefined) throw new InstanceKeysUnavailable('no-keys');
      }
    }
    let current = currentOf(rows);
    let rotated = false;
    const now = options.now();
    if (current === undefined) {
      current = await makeEncryption(highestSerial(rows));
      await store.addEncryptionKey(current);
      made = true;
    } else if (now >= current.createdAt + ENCRYPTION_KEY_LIFE_SECONDS) {
      current = await makeEncryption(highestSerial(rows));
      await store.addEncryptionKey(current);
      rotated = true;
    }
    let notAfter = newestNotAfter(await store.listInstanceKeyStatements(), current.keyId);
    let signed = false;
    // A new identity key signs afresh: nothing it signed exists yet.
    if (made || notAfter === undefined || notAfter - now < RESIGN_BELOW_SECONDS) {
      notAfter = await sign(identity.key, current);
      signed = true;
    }
    rows = await store.listInstanceKeys();
    const expired = rows.filter(
      (row) =>
        row.role === 'encryption' &&
        row.supersededAt !== null &&
        now >= row.supersededAt + OLD_KEY_KEPT_SECONDS,
    );
    await store.deleteInstanceKeys(expired.map((row) => row.keyId));
    for (const row of expired) unwrapped.delete(row.keyId);
    const kept = rows.filter((row) => !expired.includes(row));
    const due = [
      current.createdAt + ENCRYPTION_KEY_LIFE_SECONDS,
      notAfter - RESIGN_BELOW_SECONDS,
      ...kept
        .filter((row) => row.role === 'encryption' && row.supersededAt !== null)
        .map((row) => (row.supersededAt ?? 0) + OLD_KEY_KEPT_SECONDS),
    ];
    return { made, rotated, signed, deleted: expired.length, nextDueAt: Math.min(...due) };
  }

  /**
   * The first pass `served()` waits for: kept once it is under way, and
   * forgotten if it fails, so the next request tries again.
   */
  function remembered(running: Promise<Maintenance>): Promise<Maintenance> {
    if (firstMaintenance === undefined) {
      firstMaintenance = running;
      running.catch(() => {
        if (firstMaintenance === running) firstMaintenance = undefined;
      });
    }
    return running;
  }

  async function show(): Promise<InstanceKeysShown> {
    const { instanceOrigin } = keyed();
    const rows = await store.listInstanceKeys();
    const identity = rows.find((row) => row.role === 'identity');
    if (identity === undefined) throw new InstanceKeysUnavailable('no-keys');
    const identityKey = toHex(identity.publicKey);
    const fingerprint = await instanceIdentityFingerprint(sha256, instanceOrigin, identityKey);
    return {
      instanceOrigin,
      identityKey,
      fingerprint: toHex(fingerprint),
      fingerprintBase32: base32Unpadded(fingerprint),
      card: instanceCard(instanceOrigin, fingerprint),
      encryptionKeys: rows
        .filter((row) => row.role === 'encryption')
        .sort((a, b) => (b.serial ?? 0) - (a.serial ?? 0))
        .map((row) => ({
          keyId: row.keyId,
          serial: row.serial ?? 0,
          createdAt: row.createdAt,
          supersededAt: row.supersededAt,
        })),
    };
  }

  return {
    maintain: () => remembered(leased(maintain)),

    rotate: (rotation = {}) =>
      leased(async () => {
        const rows = await store.listInstanceKeys();
        const identity = await identityOf(rows);
        if (identity === undefined) throw new InstanceKeysUnavailable('no-keys');
        const key = await makeEncryption(highestSerial(rows), rotation.serialAbove);
        await store.addEncryptionKey(key);
        await sign(identity.key, key);
        const old =
          rotation.dropOld === true
            ? rows.filter((row) => row.role === 'encryption').map((row) => row.keyId)
            : [];
        await store.deleteInstanceKeys(old);
        for (const keyId of old) unwrapped.delete(keyId);
        return { keyId: key.keyId, serial: key.serial ?? 0, dropped: old.length };
      }),

    rotateIdentity: (rotation) =>
      leased(async () => {
        const { instanceOrigin } = keyed();
        const rows = await store.listInstanceKeys();
        const previous = await identityOf(rows);
        if (previous === undefined) throw new InstanceKeysUnavailable('no-keys');
        const next = await makeIdentity();
        let endorsement: InstanceKeyStatementRow | undefined;
        if (!rotation.compromised) {
          const identityKey = toHex(next.row.publicKey);
          const statement: InstanceIdentityRotation = {
            purpose: INSTANCE_IDENTITY_ROTATION_PURPOSE,
            instanceOrigin,
            previousIdentityKey: toHex(previous.row.publicKey),
            identityKey,
            fingerprint: base32Unpadded(
              await instanceIdentityFingerprint(sha256, instanceOrigin, identityKey),
            ),
            issuedAt: options.now(),
          };
          endorsement = {
            keyId: next.row.keyId,
            kind: 'identity-rotation',
            issuedAt: statement.issuedAt,
            notAfter: null,
            body: canonicalJson({ ...statement }),
            signature: toHex(
              await signWith(previous.key, instanceIdentityRotationBytes(statement)),
            ),
          };
        }
        await store.replaceIdentityKey(next.row, endorsement);
        unwrapped.delete(previous.row.keyId);
        // The current encryption key's statements went with the old identity: sign it again.
        const current = currentOf(rows);
        if (current !== undefined) await sign(next.key, current);
        return show();
      }),

    reset: () =>
      leased(async () => {
        const highest = highestSerial(await store.listInstanceKeys());
        await store.clearInstanceKeys();
        unwrapped.clear();
        const identity = await makeIdentity();
        await store.putInstanceKey(identity.row);
        const key = await makeEncryption(highest);
        await store.addEncryptionKey(key);
        await sign(identity.key, key);
        return show();
      }),

    show,

    async served() {
      keyed();
      await (firstMaintenance ?? remembered(leased(maintain)));
      const now = options.now();
      const rows = await store.listInstanceKeys();
      const identity = rows.find((row) => row.role === 'identity');
      if (identity === undefined) throw new InstanceKeysUnavailable('no-keys');
      const held = new Map(
        rows.filter((row) => row.role === 'encryption').map((row) => [row.keyId, row]),
      );
      const statements = await store.listInstanceKeyStatements();
      const newest = new Map<string, InstanceKeyStatementRow>();
      for (const each of statements) {
        if (each.kind !== 'key' || !held.has(each.keyId)) continue;
        if (each.notAfter === null || each.notAfter <= now) continue;
        const seen = newest.get(each.keyId);
        if (seen === undefined || each.issuedAt > seen.issuedAt) newest.set(each.keyId, each);
      }
      const served = [...newest.values()].flatMap((each) => {
        const statement = parseInstanceKeyStatement(JSON.parse(each.body));
        return statement === undefined ? [] : [{ statement, signature: each.signature }];
      });
      served.sort((a, b) => b.statement.serial - a.statement.serial);
      const endorsements = statements
        .filter((each) => each.kind === 'identity-rotation' && each.keyId === identity.keyId)
        .map((each) => ({
          statement: JSON.parse(each.body) as InstanceIdentityRotation,
          signature: each.signature,
        }));
      return { identityKey: toHex(identity.publicKey), statements: served, endorsements };
    },

    async encryptionKey(keyId) {
      const row = (await store.listInstanceKeys()).find(
        (each) => each.role === 'encryption' && each.keyId === keyId,
      );
      if (row === undefined) return undefined;
      return privateOf(row);
    },
  };
}
