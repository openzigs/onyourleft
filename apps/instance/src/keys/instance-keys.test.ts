// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's own keys (#1189, ADR 0047 D-4, D-5): made, wrapped, signed,
 * rotated, re-signed, pruned and rotated again on a restore — every time on an
 * injected clock, every read through a store opened afresh on the same file.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AUTH_PURPOSE,
  deviceStatementBytes,
  instanceIdentityRotationBytes,
  instanceKeyStatementBytes,
  instanceKeyId,
  toHex,
  type DeviceStatement,
  type InstanceKeyStatement,
} from '@onyourleft/domain';

import { verifyEd25519 } from '../auth/crypto.ts';
import { testDevice } from '../auth/identity-testing.ts';
import { vacuumInto } from '../store/backup.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { InstanceKeyRow, SqlStore } from '../store/sql-store.ts';
import {
  createInstanceKeys,
  ENCRYPTION_KEY_LIFE_SECONDS,
  InstanceKeysUnavailable,
  KEYS_BUSY_SENTENCE,
  NO_ORIGIN_SENTENCE,
  NO_SECRET_SENTENCE,
  OLD_KEY_KEPT_SECONDS,
  STATEMENT_LIFE_SECONDS,
  UNREADABLE_SENTENCE,
  type InstanceKeys,
  type InstanceKeyStore,
  type ServedKeys,
} from './instance-keys.ts';
import { secretBytes } from './instance-keys-testing.ts';
import { makeKey, sha256, unwrapPrivateKey, wrappingKeys, WRAP_IV_BYTES } from './wrap.ts';

const ORIGIN = 'https://ride.example';
const OTHER_ORIGIN = 'https://other.example';
const SECRET = secretBytes(7);
const DAY = 86_400;
/** The box's clock at the first start, Unix seconds. */
const T0 = 1_790_000_000;

let directory: string;
let path: string;
const open: SqlStore[] = [];
const clock = { s: T0 };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-keys-'));
  path = join(directory, 'instance.sqlite');
  clock.s = T0;
});
afterEach(async () => {
  for (const store of open.splice(0)) await store.close();
  await rm(directory, { recursive: true, force: true });
});

/** A store opened afresh on the file, every other one closed first. */
async function fresh(at = path): Promise<SqlStore> {
  for (const store of open.splice(0)) await store.close();
  const store = await openSqlStore(at);
  open.push(store);
  return store;
}

/** The instance's keys over a fresh store: what a restart is. */
async function restart(
  overrides: { secret?: Uint8Array | undefined; origin?: string | null; at?: string } = {},
): Promise<InstanceKeys> {
  return createInstanceKeys({
    store: await fresh(overrides.at),
    secret: 'secret' in overrides ? overrides.secret : SECRET,
    origin: overrides.origin === undefined ? ORIGIN : overrides.origin,
    now: () => clock.s,
  });
}

async function rows(): Promise<readonly InstanceKeyRow[]> {
  return (await fresh()).listInstanceKeys();
}

async function verifies(served: ServedKeys, index = 0): Promise<boolean> {
  const each = served.statements[index];
  if (each === undefined) return false;
  return verifyEd25519(
    served.identityKey,
    instanceKeyStatementBytes(each.statement),
    each.signature,
  );
}

describe('no secret, no keys (#1189, ADR 0047 D-5)', () => {
  it('makes no key and says so, naming the variable', async () => {
    const keys = await restart({ secret: undefined });
    await expect(keys.maintain()).rejects.toThrow(InstanceKeysUnavailable);
    await expect(keys.served()).rejects.toThrow(NO_SECRET_SENTENCE);
    expect(NO_SECRET_SENTENCE).toContain('OYL_INSTANCE_SECRET_KEY');
    expect(await rows()).toEqual([]);
  });

  it('makes no key with no origin to bind it to', async () => {
    const keys = await restart({ origin: null });
    await expect(keys.maintain()).rejects.toThrow(NO_ORIGIN_SENTENCE);
    expect(await rows()).toEqual([]);
  });
});

describe('the keys as made and served', () => {
  it('makes one identity key and one encryption key on the first start, and serves a statement that verifies', async () => {
    const done = await (await restart()).maintain();
    expect(done).toMatchObject({ made: true, signed: true, rotated: false, deleted: 0 });
    const held = await rows();
    expect(held.map((row) => row.role).sort()).toEqual(['encryption', 'identity']);
    const served = await (await restart()).served();
    expect(served.statements).toHaveLength(1);
    const statement = served.statements[0]!.statement;
    expect(statement).toMatchObject({
      purpose: 'oyl-instance-key-v1',
      instanceOrigin: ORIGIN,
      serial: T0,
      notBefore: T0,
      issuedAt: T0,
      notAfter: T0 + STATEMENT_LIFE_SECONDS,
    });
    const encryption = held.find((row) => row.role === 'encryption')!;
    expect(statement.encryptionKey).toBe(toHex(encryption.publicKey));
    expect(statement.keyId).toBe(encryption.keyId);
    expect(await verifies(served)).toBe(true);
  });

  it('is not served before the first pass has signed a statement in date', async () => {
    // `served()` runs the first pass itself when nothing has.
    const served = await (await restart()).served();
    expect(served.statements).toHaveLength(1);
  });

  it('takes the key id from the first 8 bytes of SHA-256 over the public key', async () => {
    await (await restart()).maintain();
    for (const row of await rows()) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', row.publicKey.slice()));
      expect(row.keyId).toBe(toHex(digest.slice(0, 8)));
    }
  });

  it('a device statement does not verify as an instance statement, nor the reverse', async () => {
    const served = await (await restart()).served();
    const { statement, signature } = served.statements[0]!;
    // The instance's signature over its statement is no device's statement…
    const asDevice: DeviceStatement = {
      purpose: AUTH_PURPOSE,
      instanceOrigin: statement.instanceOrigin,
      nonce: statement.encryptionKey,
      publicKey: served.identityKey,
      issuedAt: statement.issuedAt,
    };
    expect(await verifyEd25519(served.identityKey, deviceStatementBytes(asDevice), signature)).toBe(
      false,
    );
    // …and a device's signature over a device statement is no instance's.
    const device = await testDevice();
    const devicePublic = device.publicKey;
    const deviceSigned = await device.sign(
      deviceStatementBytes({ ...asDevice, publicKey: devicePublic }),
    );
    const claimed = { ...statement, purpose: AUTH_PURPOSE } as unknown as InstanceKeyStatement;
    expect(
      await verifyEd25519(devicePublic, instanceKeyStatementBytes(claimed), deviceSigned),
    ).toBe(false);
    // The control: the same signature over the bytes it was made for verifies.
    expect(await verifies(served)).toBe(true);
  });
});

describe('a wrap is bound to what it is (D-5)', () => {
  it('wraps every key under a fresh nonce', async () => {
    const wrapping = await wrappingKeys(SECRET);
    const ivs = new Set<string>();
    for (let index = 0; index < 4; index += 1) {
      const made = await makeKey(wrapping, index % 2 === 0 ? 'identity' : 'encryption', ORIGIN);
      expect(made.iv).toHaveLength(WRAP_IV_BYTES);
      ivs.add(toHex(made.iv));
    }
    expect(ivs.size).toBe(4);
    await (await restart()).maintain();
    const held = await rows();
    expect(toHex(held[0]!.iv)).not.toBe(toHex(held[1]!.iv));
  });

  it('opens with its own role, key id and origin — the control', async () => {
    const wrapping = await wrappingKeys(SECRET);
    const made = await makeKey(wrapping, 'identity', ORIGIN);
    expect(
      await unwrapPrivateKey(
        wrapping,
        { role: 'identity', keyId: made.keyId, instanceOrigin: ORIGIN },
        made,
      ),
    ).toBeDefined();
  });

  it('fails to unwrap with its role swapped', async () => {
    const wrapping = await wrappingKeys(SECRET);
    const made = await makeKey(wrapping, 'encryption', ORIGIN);
    expect(
      await unwrapPrivateKey(
        wrapping,
        { role: 'identity', keyId: made.keyId, instanceOrigin: ORIGIN },
        made,
      ),
    ).toBeUndefined();
  });

  it('fails to unwrap when copied onto another key’s row', async () => {
    const wrapping = await wrappingKeys(SECRET);
    const one = await makeKey(wrapping, 'encryption', ORIGIN);
    const other = await makeKey(wrapping, 'encryption', ORIGIN);
    expect(
      await unwrapPrivateKey(
        wrapping,
        { role: 'encryption', keyId: other.keyId, instanceOrigin: ORIGIN },
        one,
      ),
    ).toBeUndefined();
  });

  it('fails to unwrap on another instance sharing the secret, which then imports nothing', async () => {
    const wrapping = await wrappingKeys(SECRET);
    const made = await makeKey(wrapping, 'identity', ORIGIN);
    expect(
      await unwrapPrivateKey(
        wrapping,
        { role: 'identity', keyId: made.keyId, instanceOrigin: OTHER_ORIGIN },
        made,
      ),
    ).toBeUndefined();
    // End to end: this instance's database, served by one at another origin.
    await (await restart()).maintain();
    const elsewhere = await restart({ origin: OTHER_ORIGIN });
    await expect(elsewhere.maintain()).rejects.toThrow(UNREADABLE_SENTENCE);
    await expect(elsewhere.served()).rejects.toThrow(UNREADABLE_SENTENCE);
    expect(await rows()).toHaveLength(2);
  });

  it('fails to unwrap under another secret, and makes no key over the old ones', async () => {
    await (await restart()).maintain();
    const before = (await rows()).map((row) => row.keyId);
    await expect((await restart({ secret: secretBytes(8) })).maintain()).rejects.toThrow(
      UNREADABLE_SENTENCE,
    );
    expect((await rows()).map((row) => row.keyId)).toEqual(before);
  });
});

describe('a row planted in the database is never vouched for (D-5)', () => {
  const ATTACKER = new Uint8Array(32).fill(7);

  async function servedKeys(): Promise<readonly string[]> {
    const served = await (await restart()).served().catch(() => undefined);
    return served?.statements.map((each) => each.statement.encryptionKey) ?? [];
  }

  it('does not sign an encryption row this instance never wrapped', async () => {
    await (await restart()).maintain();
    const store = await fresh();
    await store.addEncryptionKey({
      keyId: await instanceKeyId(sha256, ATTACKER),
      role: 'encryption',
      publicKey: ATTACKER,
      iv: new Uint8Array(12),
      wrapped: new Uint8Array(48),
      serial: T0 * 2,
      createdAt: T0,
      supersededAt: null,
    });
    await expect((await restart()).maintain()).rejects.toThrow(UNREADABLE_SENTENCE);
    expect(await servedKeys()).not.toContain(toHex(ATTACKER));
  });

  it('does not sign a row whose key id is not the hash of its public key', async () => {
    await (await restart()).maintain();
    // Wrapped by this instance for the real key id, carrying a public half that is not its.
    const real = await makeKey(await wrappingKeys(SECRET), 'encryption', ORIGIN);
    const store = await fresh();
    await store.addEncryptionKey({
      keyId: real.keyId,
      role: 'encryption',
      publicKey: ATTACKER,
      iv: real.iv,
      wrapped: real.wrapped,
      serial: T0 * 2,
      createdAt: T0,
      supersededAt: null,
    });
    await expect((await restart()).maintain()).rejects.toThrow(UNREADABLE_SENTENCE);
    expect(await servedKeys()).not.toContain(toHex(ATTACKER));
  });
});

describe('one identity key (D-5)', () => {
  it('refuses a second identity row, so a racing first pass cannot make two', async () => {
    await (await restart()).maintain();
    const identity = (await rows()).find((row) => row.role === 'identity')!;
    const other = await makeKey(await wrappingKeys(SECRET), 'identity', ORIGIN);
    await expect(
      (await fresh()).putInstanceKey({
        keyId: other.keyId,
        role: 'identity',
        publicKey: other.publicKey,
        iv: other.iv,
        wrapped: other.wrapped,
        serial: null,
        createdAt: T0,
        supersededAt: null,
      }),
    ).rejects.toThrow();
    expect((await rows()).filter((row) => row.role === 'identity')).toEqual([identity]);
  });
});

describe('one writer at a time, and one identity key under a race (#1203, D-5)', () => {
  /** A store on `path` that stays open beside the others: a second process. */
  async function another(): Promise<SqlStore> {
    const store = await openSqlStore(path);
    open.push(store);
    return store;
  }

  function keysOver(store: InstanceKeyStore): InstanceKeys {
    return createInstanceKeys({ store, secret: SECRET, origin: ORIGIN, now: () => clock.s });
  }

  it('keeps one identity key and one current encryption key when two first passes run at once over two connections', async () => {
    const [a, b] = [keysOver(await another()), keysOver(await another())];
    const settled = await Promise.allSettled([a.maintain(), b.maintain()]);
    expect(settled.some((each) => each.status === 'fulfilled')).toBe(true);
    for (const each of settled) {
      if (each.status === 'rejected') {
        expect(each.reason).toBeInstanceOf(InstanceKeysUnavailable);
        expect((each.reason as InstanceKeysUnavailable).code).toBe('busy');
      }
    }
    // Whichever lost tries again, as the instance's timer does, and agrees.
    await a.maintain();
    await b.maintain();
    const [servedA, servedB] = [await a.served(), await b.served()];
    expect(servedA.identityKey).toBe(servedB.identityKey);
    expect(await verifies(servedA)).toBe(true);
    const held = await rows();
    expect(held.filter((row) => row.role === 'identity')).toHaveLength(1);
    expect(
      held.filter((row) => row.role === 'encryption' && row.supersededAt === null),
    ).toHaveLength(1);
  });

  it('signs with the identity key another pass kept first, rather than failing or making a second', async () => {
    await (await restart()).maintain();
    const [identity] = (await rows()).filter((row) => row.role === 'identity');
    const store = await fresh();
    // This pass looked before the other one's identity key was there.
    let looked = false;
    const racing: InstanceKeyStore = {
      ...store,
      listInstanceKeys: async () => {
        if (looked) return store.listInstanceKeys();
        looked = true;
        return [];
      },
    };
    const done = await keysOver(racing).maintain();
    expect(done.made).toBe(false);
    expect((await rows()).filter((row) => row.role === 'identity')).toEqual([identity]);
    const served = await (await restart()).served();
    expect(served.identityKey).toBe(toHex(identity!.publicKey));
    expect(await verifies(served)).toBe(true);
  });

  it('refuses every key-writing command while another process holds the lease, and writes nothing', async () => {
    await (await restart()).maintain();
    const before = await rows();
    const statements = await (await fresh()).listInstanceKeyStatements();
    const operator = await another();
    const due = clock.s + ENCRYPTION_KEY_LIFE_SECONDS; // a rotation is due
    expect(await operator.takeInstanceKeyLease('operator', clock.s, due + 60)).toBe(true);
    const keys = await restart();
    clock.s = due;
    await expect(keys.maintain()).rejects.toThrow(KEYS_BUSY_SENTENCE);
    await expect(keys.rotate()).rejects.toThrow(KEYS_BUSY_SENTENCE);
    await expect(keys.rotateIdentity({ compromised: false })).rejects.toThrow(KEYS_BUSY_SENTENCE);
    await expect(keys.reset()).rejects.toThrow(KEYS_BUSY_SENTENCE);
    expect(await rows()).toEqual(before);
    expect(await (await fresh()).listInstanceKeyStatements()).toEqual(statements);
    // Reading takes no lease.
    expect((await (await restart()).show()).card).toMatch(/^oyl-instance:/);
  });

  it('takes a lease whose holder died once it has lapsed, and gives its own back after a pass', async () => {
    await (await restart()).maintain();
    expect(await (await another()).takeInstanceKeyLease('dead', clock.s, clock.s + 60)).toBe(true);
    clock.s += 60;
    const rotated = await (await restart()).rotate();
    expect(rotated.serial).toBeGreaterThan(0);
    // Given back: a second process takes it at once.
    expect(await (await another()).takeInstanceKeyLease('next', clock.s, clock.s + 60)).toBe(true);
  });

  it('gives the lease back when a pass throws', async () => {
    const keys = await restart();
    await expect(keys.rotate()).rejects.toThrow(InstanceKeysUnavailable); // no keys yet
    expect(await (await another()).takeInstanceKeyLease('next', clock.s, clock.s + 60)).toBe(true);
  });
});

describe('rotation, on the box’s clock (D-5, D-14 Q3)', () => {
  async function encryptionRows() {
    return (await rows()).filter((row) => row.role === 'encryption');
  }

  it('re-signs the current key daily, rotates on day 31, stops re-signing the old key, and deletes it at day 31 + 7', async () => {
    await (await restart()).maintain();
    const [first] = await encryptionRows();

    // Day 1.5: under 24 h left, so a fresh statement for the same key and serial.
    clock.s = T0 + 1.5 * DAY;
    expect((await (await restart()).maintain()).signed).toBe(true);
    let served = await (await restart()).served();
    expect(served.statements).toHaveLength(1);
    expect(served.statements[0]!.statement).toMatchObject({
      keyId: first!.keyId,
      serial: T0,
      issuedAt: T0 + 1.5 * DAY,
    });

    // Day 31: a new key, with a higher serial.
    clock.s = T0 + 31 * DAY;
    const rotation = await (await restart()).maintain();
    expect(rotation.rotated).toBe(true);
    const second = (await encryptionRows()).find((row) => row.keyId !== first!.keyId)!;
    expect(second.serial).toBeGreaterThan(first!.serial!);
    expect(second.serial).toBe(T0 + 31 * DAY);
    served = await (await restart()).served();
    expect(served.statements[0]!.statement.keyId).toBe(second.keyId);

    // Day 33: the old key is held for its overlap, and nothing re-signed it.
    clock.s = T0 + 33 * DAY;
    await (await restart()).maintain();
    const statements = await (await fresh()).listInstanceKeyStatements();
    const forOld = statements.filter((each) => each.keyId === first!.keyId);
    expect(forOld.every((each) => each.issuedAt < T0 + 31 * DAY)).toBe(true);
    served = await (await restart()).served();
    expect(served.statements.map((each) => each.statement.keyId)).toEqual([second.keyId]);
    expect((await encryptionRows()).map((row) => row.keyId)).toContain(first!.keyId);

    // Day 31 + 7: the old private half is gone from the table…
    clock.s = T0 + 38 * DAY;
    const pruned = await (await restart()).maintain();
    expect(pruned.deleted).toBe(1);
    expect((await encryptionRows()).map((row) => row.keyId)).toEqual([second.keyId]);
    // …and from a backup taken afterwards.
    for (const store of open.splice(0)) await store.close();
    const snapshot = join(directory, 'snapshot.sqlite');
    vacuumInto(path, snapshot);
    const bytes = (await readFile(snapshot)).toString('latin1');
    expect(bytes).not.toContain(Buffer.from(first!.wrapped).toString('latin1'));
    expect(bytes).toContain(Buffer.from(second.wrapped).toString('latin1'));
  });

  it('serves the old key’s statement only inside its own 48 hours after a rotation', async () => {
    await (await restart()).maintain();
    clock.s = T0 + 30 * DAY + 3600;
    await (await restart()).maintain();
    // The last re-sign of the old key was within the day before the rotation.
    const served = await (await restart()).served();
    expect(served.statements.length).toBeGreaterThanOrEqual(1);
    expect(served.statements[0]!.statement.serial).toBe(T0 + 30 * DAY + 3600);
    clock.s = T0 + 30 * DAY + 3600 + STATEMENT_LIFE_SECONDS;
    const later = await (await restart()).served();
    expect(later.statements).toHaveLength(1);
  });

  it('--drop-old deletes the old private half at once', async () => {
    await (await restart()).maintain();
    const [first] = await encryptionRows();
    clock.s = T0 + 60;
    const rotated = await (await restart()).rotate({ dropOld: true });
    expect(rotated.dropped).toBe(1);
    expect((await encryptionRows()).map((row) => row.keyId)).toEqual([rotated.keyId]);
    expect(rotated.keyId).not.toBe(first!.keyId);
  });

  it('rotate without --drop-old keeps the old key for its overlap', async () => {
    await (await restart()).maintain();
    clock.s = T0 + 60;
    expect((await (await restart()).rotate()).dropped).toBe(0);
    expect(await encryptionRows()).toHaveLength(2);
  });

  it('gives the next step’s time, so the daily re-sign is scheduled from the rule', async () => {
    const done = await (await restart()).maintain();
    expect(done.nextDueAt).toBe(T0 + STATEMENT_LIFE_SECONDS - DAY);
    clock.s = T0 + 30 * DAY;
    const rotated = await (await restart()).maintain();
    expect(rotated.nextDueAt).toBe(T0 + 30 * DAY + DAY);
    expect(ENCRYPTION_KEY_LIFE_SECONDS).toBe(30 * DAY);
    expect(OLD_KEY_KEPT_SECONDS).toBe(7 * DAY);
  });
});

describe('the serial survives a clock put back (D-5)', () => {
  it('issues a higher serial after the clock goes back, with issuedAt and notBefore the clock as it is', async () => {
    // The box's clock ran a day ahead when the first key was made.
    clock.s = T0 + DAY;
    await (await restart()).maintain();
    // Put right, and a key rotated on demand.
    clock.s = T0;
    const rotated = await (await restart()).rotate();
    expect(rotated.serial).toBe(T0 + DAY + 1);
    const served = await (await restart()).served();
    const newest = served.statements[0]!.statement;
    expect(newest.serial).toBe(T0 + DAY + 1);
    expect(newest.issuedAt).toBe(T0);
    expect(newest.notBefore).toBe(T0);
    expect(await verifies(served)).toBe(true);
  });

  it('issues a serial above --serial-above', async () => {
    await (await restart()).maintain();
    const rotated = await (await restart()).rotate({ serialAbove: T0 + 1000 });
    expect(rotated.serial).toBe(T0 + 1001);
  });
});

describe('a start after 48 hours or more off (D-5)', () => {
  it('signs an in-date statement before anything is served, and rotates first when the key is past its 30 days', async () => {
    await (await restart()).maintain();
    // Five days off: every statement held has expired.
    clock.s = T0 + 5 * DAY;
    const statements = await (await fresh()).listInstanceKeyStatements();
    expect(statements.every((each) => (each.notAfter ?? 0) <= clock.s)).toBe(true);
    const served = await (await restart()).served();
    expect(served.statements).toHaveLength(1);
    expect(served.statements[0]!.statement.notAfter).toBeGreaterThan(clock.s);
    expect(await verifies(served)).toBe(true);

    // Forty days off: a new key first, then its statement.
    clock.s = T0 + 45 * DAY;
    const later = await (await restart()).served();
    expect(later.statements[0]!.statement.serial).toBe(T0 + 45 * DAY);
  });
});

describe('the identity key (D-5, D-6)', () => {
  it('shows the full fingerprint and the card', async () => {
    await (await restart()).maintain();
    const shown = await (await restart()).show();
    const identity = (await rows()).find((row) => row.role === 'identity')!;
    expect(shown.identityKey).toBe(toHex(identity.publicKey));
    expect(shown.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(shown.fingerprintBase32).toMatch(/^[A-Z2-7]{52}$/);
    expect(shown.card).toBe(`oyl-instance:${ORIGIN}#${shown.fingerprintBase32}`);
    const label = new TextEncoder().encode('oyl-instance-identity-v1');
    const origin = new TextEncoder().encode(ORIGIN);
    const input = new Uint8Array([...label, ...origin, ...identity.publicKey]);
    expect(shown.fingerprint).toBe(
      toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input))),
    );
  });

  it('rotate-identity endorses the new key with the old one, deletes the old one, and signs the current key again', async () => {
    await (await restart()).maintain();
    const before = await (await restart()).show();
    const after = await (await restart()).rotateIdentity({ compromised: false });
    expect(after.fingerprint).not.toBe(before.fingerprint);
    const identities = (await rows()).filter((row) => row.role === 'identity');
    expect(identities.map((row) => toHex(row.publicKey))).toEqual([after.identityKey]);
    const served = await (await restart()).served();
    expect(served.identityKey).toBe(after.identityKey);
    expect(await verifies(served)).toBe(true);
    expect(served.endorsements).toHaveLength(1);
    const { statement, signature } = served.endorsements[0]!;
    expect(statement).toMatchObject({
      purpose: 'oyl-instance-identity-rotation-v1',
      previousIdentityKey: before.identityKey,
      identityKey: after.identityKey,
      fingerprint: after.fingerprintBase32,
    });
    expect(
      await verifyEd25519(before.identityKey, instanceIdentityRotationBytes(statement), signature),
    ).toBe(true);
  });

  it('rotate-identity --compromised endorses nothing', async () => {
    await (await restart()).maintain();
    await (await restart()).rotateIdentity({ compromised: true });
    const served = await (await restart()).served();
    expect(served.endorsements).toEqual([]);
    expect(await verifies(served)).toBe(true);
  });

  it('reset makes new keys after a lost secret, with a serial above every earlier one', async () => {
    await (await restart()).maintain();
    const highest = Math.max(...(await rows()).map((row) => row.serial ?? 0));
    const lost = await restart({ secret: secretBytes(9) });
    await expect(lost.maintain()).rejects.toThrow(UNREADABLE_SENTENCE);
    const shown = await lost.reset();
    expect(shown.encryptionKeys).toHaveLength(1);
    expect(shown.encryptionKeys[0]!.serial).toBeGreaterThan(highest);
    const served = await (await restart({ secret: secretBytes(9) })).served();
    expect(await verifies(served)).toBe(true);
  });

  it('hands the encryption key back non-extractable, and nothing for a key it does not hold', async () => {
    const keys = await restart();
    const served = await keys.served();
    const key = await keys.encryptionKey(served.statements[0]!.statement.keyId);
    expect(key?.extractable).toBe(false);
    expect(await keys.encryptionKey('0000000000000000')).toBeUndefined();
    expect(existsSync(path)).toBe(true);
  });
});
