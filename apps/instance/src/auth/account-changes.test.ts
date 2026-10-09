// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The account-change log, each device's acknowledgement of it, and the
 * narrowed revoke (#1193, ADR 0047 D-8), end to end through the real listener
 * and `POST /v1/sealed`.
 *
 * Every call here is SEALED and signed by the device key the session names —
 * the routes this issue adds are sealed-only, and the others it logs (mint,
 * link, revoke, the device list) go sealed too, so these tests read the same
 * once #1192 makes those sealed-only as well. Where a test reads the store it
 * does so through a FRESH store or a fresh instance on the same file, never
 * through the object that wrote.
 *
 * The attackers are ADR 0047 D-8's table's columns: **(A)** a key the edge
 * added (a live device key, linked with a code), **(B)** a thief holding the
 * rider's unlocked second device (its key), and **(E)** the session token
 * alone, with no device key — which seals with a key of its own.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { LINK_PURPOSE, RECOVER_PURPOSE } from '@onyourleft/domain';

import { startTestInstance, type TestInstance } from '../instance-testing.ts';
import { createInstanceKeys } from '../keys/instance-keys.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { createSealed } from '../sealed/sealed.ts';
import { codeOf, sealedCall, type SealedAnswer } from '../sealed/sealed-testing.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { createIdentity, type AccountChanges, type AccountChangeView } from './identity.ts';
import {
  startIdentityInstance,
  TEST_ORIGIN,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from './identity-testing.ts';

let world: IdentityInstance | undefined;
let restarted: { instance: TestInstance; store: SqlStore } | undefined;
afterEach(async () => {
  if (restarted !== undefined) {
    await restarted.instance.listening.close();
    await restarted.store.close();
    restarted = undefined;
  }
  await world?.close();
  world = undefined;
});

async function start(): Promise<IdentityInstance> {
  world = await startIdentityInstance({ emailRecovery: true });
  return world;
}

/** A signed-in device of an athlete. */
interface Key {
  readonly device: TestDevice;
  readonly token: string;
  readonly athleteId: string;
}

async function register(w: IdentityInstance): Promise<Key & { recoveryCodes: string[] }> {
  const device = await testDevice();
  const signed = await w.signIn(device);
  return {
    device,
    token: signed.body.sessionToken as string,
    athleteId: signed.body.athleteId as string,
    recoveryCodes: signed.body.recoveryCodes as string[],
  };
}

/** A sealed request by `key`, signed with its own key, through `on` (the world by default). */
function sealed(
  w: IdentityInstance,
  key: Key,
  method: string,
  path: string,
  body?: unknown,
): Promise<SealedAnswer> {
  return sealedCall(w, {
    method,
    path,
    token: key.token,
    signer: key.device.signingKey,
    ...(body === undefined ? {} : { body }),
  });
}

async function mint(w: IdentityInstance, key: Key): Promise<string> {
  const answer = await sealed(w, key, 'POST', '/v1/auth/link-codes', {});
  expect(answer.reply?.status, JSON.stringify(answer.body)).toBe(200);
  return (answer.body as { linkCode: string }).linkCode;
}

/** A new device linked with `linkCode` through the sealed, sessionless `/v1/auth/link`. */
async function linkWith(
  w: IdentityInstance,
  linkCode: string,
  device?: TestDevice,
): Promise<SealedAnswer & { device: TestDevice }> {
  const joining = device ?? (await testDevice());
  const statement = await joining.statement(await w.nonceFor(joining), {
    purpose: LINK_PURPOSE,
    issuedAt: Math.floor(w.clock.ms / 1000),
  });
  const answer = await sealedCall(w, {
    method: 'POST',
    path: '/v1/auth/link',
    body: { ...statement, linkCode },
    signer: joining.signingKey,
  });
  return { ...answer, device: joining };
}

/** A device linked to `minter`'s athlete with a code `minter` minted, and signed in. */
async function linked(w: IdentityInstance, minter: Key): Promise<Key> {
  const joined = await linkWith(w, await mint(w, minter));
  expect(joined.reply?.status, JSON.stringify(joined.body)).toBe(200);
  const signed = await w.signIn(joined.device);
  expect(signed.status).toBe(200);
  return {
    device: joined.device,
    token: signed.body.sessionToken as string,
    athleteId: signed.body.athleteId as string,
  };
}

async function log(w: IdentityInstance, key: Key): Promise<AccountChanges> {
  const answer = await sealed(w, key, 'GET', '/v1/auth/account-changes');
  expect(answer.reply?.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as AccountChanges;
}

async function acknowledge(w: IdentityInstance, key: Key, through: number): Promise<SealedAnswer> {
  return sealed(w, key, 'POST', '/v1/auth/account-changes/acknowledge', { through });
}

async function revoke(w: IdentityInstance, key: Key, publicKey: string): Promise<SealedAnswer> {
  return sealed(w, key, 'POST', `/v1/auth/devices/${publicKey}/revoke`, {});
}

/** Each entry as `kind actor→subject`, short enough to read in a failure. */
const shape = (entries: readonly AccountChangeView[]): string[] =>
  entries.map(
    (entry) =>
      `${entry.kind} ${entry.actorKey}${entry.subjectKey === null ? '' : `→${entry.subjectKey}`}${entry.via === null ? '' : ` via ${entry.via}`}`,
  );

/**
 * A second instance over the same file: a new store, identity, keys and
 * sealed record — everything a restart makes again — so a read through it is
 * served by nothing that wrote.
 */
async function freshInstance(w: IdentityInstance): Promise<IdentityInstance> {
  const store = await openSqlStore(w.path);
  const now = (): number => w.clock.ms;
  const identity = createIdentity({ store, origin: TEST_ORIGIN, now, registration: 'open' });
  const instanceKeys = createInstanceKeys({
    store,
    secret: secretBytes(7),
    origin: TEST_ORIGIN,
    now: () => Math.floor(now() / 1000),
  });
  const instance = await startTestInstance({
    identity,
    instanceKeys,
    sealed: createSealed({ store, now }),
    config: { bodyLimitBytes: 16_384 },
  });
  restarted = { instance, store };
  return { ...w, url: instance.url, identity, instanceKeys, instance };
}

describe('every change is logged by the key that authorised it (#1193)', () => {
  it('logs a mint, a link and a revoke, each naming its key, read back sealed through a fresh instance', async () => {
    const w = await start();
    const first = await register(w);
    const second = await linked(w, first);
    const third = await linked(w, first);
    expect((await revoke(w, second, third.device.publicKey)).reply?.status).toBe(204);

    const fresh = await freshInstance(w);
    const read = await log(fresh, first);
    expect(shape(read.changes)).toEqual([
      `link_code_minted ${first.device.publicKey}`,
      `key_added ${first.device.publicKey}→${second.device.publicKey} via link_code`,
      `link_code_minted ${first.device.publicKey}`,
      `key_added ${first.device.publicKey}→${third.device.publicKey} via link_code`,
      `key_revoked ${second.device.publicKey}→${third.device.publicKey}`,
    ]);
    expect(read.changes.every((entry) => entry.at === Math.floor(w.clock.ms / 1000))).toBe(true);
    // Another athlete's id is nowhere in it: the entry carries no athlete.
    expect(Object.keys(read.changes[0]!).sort()).toEqual(
      ['actorKey', 'address', 'at', 'id', 'kind', 'subjectKey', 'subjectAddedAt', 'via'].sort(),
    );
  });

  it('answers each entry with the day its subject key was added, so a revoked key can be named by it', async () => {
    const w = await start();
    const first = await register(w);
    w.clock.ms += 3_600_000;
    const second = await linked(w, first);
    w.clock.ms += 3_600_000;
    const third = await linked(w, first);
    w.clock.ms += 3_600_000;
    expect((await revoke(w, second, third.device.publicKey)).reply?.status).toBe(204);

    const keys = await w.freshRead((store) => store.listDeviceKeys(first.athleteId));
    const addedAt = (key: Key): number =>
      keys.find((each) => each.publicKey === key.device.publicKey)!.addedAt;
    expect(new Set([addedAt(first), addedAt(second), addedAt(third)]).size).toBe(3);

    const read = await log(await freshInstance(w), first);
    const revoked = read.changes.find((entry) => entry.kind === 'key_revoked')!;
    expect(revoked.subjectKey).toBe(third.device.publicKey);
    expect(revoked.subjectAddedAt).toBe(addedAt(third));
    // An entry with no subject names no day.
    const minted = read.changes.filter((entry) => entry.kind === 'link_code_minted');
    expect(minted.map((entry) => entry.subjectAddedAt)).toEqual([null, null]);
    // The notices carry it too: they are what another device is shown.
    expect(read.notices.find((entry) => entry.kind === 'key_revoked')?.subjectAddedAt).toBe(
      addedAt(third),
    );
  });

  it('logs a key added by `recover`, named by the key it added and how', async () => {
    const w = await start();
    const rider = await register(w);
    const recovering = await testDevice();
    const statement = await recovering.statement(await w.nonceFor(recovering), {
      purpose: RECOVER_PURPOSE,
      issuedAt: Math.floor(w.clock.ms / 1000),
    });
    const recovered = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/recover',
      body: { ...statement, recoveryCode: rider.recoveryCodes[0] },
      signer: recovering.signingKey,
    });
    expect(recovered.reply?.status, JSON.stringify(recovered.body)).toBe(200);
    const read = await log(w, rider);
    expect(shape(read.changes)).toEqual([
      `key_added ${recovering.publicKey}→${recovering.publicKey} via recovery_code`,
    ]);
    expect(shape(read.notices)).toEqual(shape(read.changes));
  });

  it('logs a recovery address by the key that GAVE it, not the key that typed the code', async () => {
    const w = await start();
    const first = await register(w);
    const second = await linked(w, first);
    const given = await sealed(w, second, 'POST', '/v1/auth/recovery-email', {
      address: 'rider@example.org',
    });
    expect(given.reply?.status, JSON.stringify(given.body)).toBe(204);
    const token = w.confirmations.at(-1)!.token;
    const confirmed = await sealed(w, first, 'POST', '/v1/auth/recovery-email/confirm', { token });
    expect(confirmed.reply?.status, JSON.stringify(confirmed.body)).toBe(204);
    const read = await log(w, first);
    expect(read.changes.at(-1)).toMatchObject({
      kind: 'address_added',
      actorKey: second.device.publicKey,
      address: 'rider@example.org',
    });
  });
});

describe('acknowledgement is per device (#1193)', () => {
  it('moves only the asking device’s mark: X acknowledges and Y is still shown X’s entries', async () => {
    const w = await start();
    const x = await register(w);
    const y = await linked(w, x);
    await linked(w, x);

    const before = await log(w, y);
    expect(before.notices.length).toBe(4);
    expect(before.notices.every((entry) => entry.actorKey === x.device.publicKey)).toBe(true);

    const newest = before.changes.at(-1)!.id;
    const xAcknowledged = await acknowledge(w, x, newest);
    expect(xAcknowledged.body).toEqual({ acknowledgedThrough: newest });
    // Y is still shown every entry X made.
    expect((await log(w, y)).notices.length).toBe(4);
    expect((await log(w, y)).acknowledgedThrough).toBe(0);

    expect((await acknowledge(w, y, newest)).body).toEqual({ acknowledgedThrough: newest });
    expect((await log(w, y)).notices).toEqual([]);
    // Y's acknowledgement did not move X's mark: X's stays where X put it.
    const marks = await w.freshRead((store) => store.listAccountChangeMarks(x.athleteId));
    expect(marks.map((mark) => [mark.deviceKey, mark.acknowledgedThrough]).sort()).toEqual(
      [
        [x.device.publicKey, newest],
        [y.device.publicKey, newest],
      ].sort(),
    );
  });

  it('never moves a mark backwards, and clamps it to the newest entry', async () => {
    const w = await start();
    const x = await register(w);
    await linked(w, x);
    const newest = (await log(w, x)).changes.at(-1)!.id;
    expect((await acknowledge(w, x, newest + 1_000)).body).toEqual({ acknowledgedThrough: newest });
    expect((await acknowledge(w, x, 0)).body).toEqual({ acknowledgedThrough: newest });
    expect(codeOf(await acknowledge(w, x, -1))).toBe('validation_failed');
  });

  it('lets no key acknowledge for another key’s device: signing with A for B’s session, or naming B', async () => {
    const w = await start();
    const a = await register(w);
    const b = await linked(w, a);
    const newest = (await log(w, b)).changes.at(-1)!.id;

    // A's key signs a request sealed for B's session: refused, B's mark unmoved.
    const forged = await sealedCall(w, {
      method: 'POST',
      path: '/v1/auth/account-changes/acknowledge',
      body: { through: newest },
      token: b.token,
      signer: a.device.signingKey,
    });
    expect(codeOf(forged)).toBe('bad_signature');
    // A's own session naming B's key: the route reads no key from the body,
    // so what moves is A's own mark and never B's.
    const naming = await sealed(w, a, 'POST', '/v1/auth/account-changes/acknowledge', {
      through: newest,
      publicKey: b.device.publicKey,
    });
    expect(naming.body).toEqual({ acknowledgedThrough: newest });

    const marks = await w.freshRead((store) => store.listAccountChangeMarks(a.athleteId));
    expect(marks.map((mark) => mark.deviceKey)).toEqual([a.device.publicKey]);
    expect((await log(w, b)).notices.length).toBe(2);
  });
});

describe('scoping, with three athletes (#1193)', () => {
  it('shows each athlete only their own log, and no athlete can move another’s marks', async () => {
    const w = await start();
    const riders = [await register(w), await register(w), await register(w)];
    for (const rider of riders) await linked(w, rider);
    const first = riders[0]!;
    const firstLog = await log(w, first);
    expect(firstLog.changes.length).toBe(2);

    for (const other of riders.slice(1)) {
      const theirs = await log(w, other);
      expect(theirs.changes.length).toBe(2);
      for (const entry of theirs.changes) {
        expect(firstLog.changes.map((each) => each.id)).not.toContain(entry.id);
        expect(entry.actorKey).toBe(other.device.publicKey);
      }
      // Asking to acknowledge far past every id moves only their own mark,
      // clamped to THEIR newest entry.
      const acknowledged = await acknowledge(w, other, 1_000_000);
      expect(acknowledged.body).toEqual({ acknowledgedThrough: theirs.changes.at(-1)!.id });
    }
    expect(await w.freshRead((store) => store.listAccountChangeMarks(first.athleteId))).toEqual([]);
    expect((await log(w, first)).acknowledgedThrough).toBe(0);
  });
});

describe('the routes in scope, against attackers A, B and E (ADR 0047 D-8’s table)', () => {
  /** The rider, and A or B: both a live device key on the rider's account. */
  async function riderAnd(
    w: IdentityInstance,
  ): Promise<{ rider: Key & { recoveryCodes: string[] }; attacker: Key }> {
    const rider = await register(w);
    // A: a key the edge added before phase 1, with a code minted on the
    // rider's session. B: the rider's own second device, in a thief's hand.
    // Neither can be told from the other here, and both are live keys.
    const attacker = await linked(w, rider);
    return { rider, attacker };
  }

  const codesOf = (w: IdentityInstance, athleteId: string): Promise<string[]> =>
    w
      .freshRead((store) => store.listRecoveryCodes(athleteId))
      .then((codes) => codes.map((code) => `${code.codeSha256}:${String(code.usedAt)}`).sort());

  for (const column of ['A', 'B'] as const) {
    it(`Revoke a key, ${column}: revokes the rider’s other key, and never replaces the codes`, async () => {
      const w = await start();
      const { rider, attacker } = await riderAnd(w);
      const codesBefore = await codesOf(w, rider.athleteId);
      expect(codesBefore.length).toBeGreaterThan(0);
      // Residue R1: a live key may revoke another.
      expect((await revoke(w, attacker, rider.device.publicKey)).reply?.status).toBe(204);
      expect(await codesOf(w, rider.athleteId)).toEqual(codesBefore);
      const keys = await w.freshRead((store) => store.listDeviceKeys(rider.athleteId));
      expect(
        keys.find((key) => key.publicKey === rider.device.publicKey)?.revokedAt,
      ).not.toBeNull();
    });

    it(`Mint a link code, ${column}: mints one, logged and shown on the rider’s device`, async () => {
      const w = await start();
      const { rider, attacker } = await riderAnd(w);
      await mint(w, attacker);
      const notices = (await log(w, rider)).notices;
      expect(shape(notices).at(-1)).toBe(`link_code_minted ${attacker.device.publicKey}`);
    });

    it(`Link a device, ${column}: adds a key with a code it minted, logged naming it`, async () => {
      const w = await start();
      const { rider, attacker } = await riderAnd(w);
      const added = await linked(w, attacker);
      expect(shape((await log(w, rider)).notices).at(-1)).toBe(
        `key_added ${attacker.device.publicKey}→${added.device.publicKey} via link_code`,
      );
    });

    it(`The device list, ${column}: reads it, and changes nothing`, async () => {
      const w = await start();
      const { rider, attacker } = await riderAnd(w);
      const before = await log(w, rider);
      const listed = await sealed(w, attacker, 'GET', '/v1/auth/devices');
      expect(listed.reply?.status).toBe(200);
      expect((listed.body as { devices: unknown[] }).devices).toHaveLength(2);
      expect((await log(w, rider)).changes).toEqual(before.changes);
    });

    it(`The account-change log, ${column}: reads it, and acknowledges for its own device only`, async () => {
      const w = await start();
      const { rider, attacker } = await riderAnd(w);
      const read = await log(w, attacker);
      expect(read.changes.length).toBe(2);
      expect((await acknowledge(w, attacker, read.changes.at(-1)!.id)).reply?.status).toBe(200);
      expect((await log(w, rider)).acknowledgedThrough).toBe(0);
    });
  }

  describe('E, the token alone, fails every one of them', () => {
    /** The rider's token, sealed and signed with a key the edge holds. */
    async function asTheEdge(
      w: IdentityInstance,
      rider: Key,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<SealedAnswer> {
      const edge = await testDevice();
      return sealedCall(w, {
        method,
        path,
        token: rider.token,
        signer: edge.signingKey,
        ...(body === undefined ? {} : { body }),
      });
    }

    const ROUTES_IN_SCOPE: readonly (readonly [string, string, (other: Key) => string, unknown])[] =
      [
        ['Mint a link code', 'POST', () => '/v1/auth/link-codes', {}],
        [
          'Revoke a key',
          'POST',
          (other) => `/v1/auth/devices/${other.device.publicKey}/revoke`,
          {},
        ],
        ['The device list', 'GET', () => '/v1/auth/devices', undefined],
        ['The account-change log', 'GET', () => '/v1/auth/account-changes', undefined],
        [
          'Its acknowledgement',
          'POST',
          () => '/v1/auth/account-changes/acknowledge',
          { through: 1_000 },
        ],
      ];

    for (const [name, method, path, body] of ROUTES_IN_SCOPE) {
      it(`${name}, E: refused, and nothing changes`, async () => {
        const w = await start();
        const rider = await register(w);
        const other = await linked(w, rider);
        const before = await w.freshRead(async (store) => ({
          changes: await store.listAccountChanges(rider.athleteId),
          marks: await store.listAccountChangeMarks(rider.athleteId),
          codes: await store.listLinkCodes(rider.athleteId),
          keys: await store.listDeviceKeys(rider.athleteId),
        }));
        const answer = await asTheEdge(w, rider, method, path(other), body);
        expect(codeOf(answer)).toBe('bad_signature');
        const after = await w.freshRead(async (store) => ({
          changes: await store.listAccountChanges(rider.athleteId),
          marks: await store.listAccountChangeMarks(rider.athleteId),
          codes: await store.listLinkCodes(rider.athleteId),
          keys: await store.listDeviceKeys(rider.athleteId),
        }));
        // `last_used_at` is touched only by a request that verified.
        expect(after).toEqual(before);
      });
    }

    it('Link a device, E: has no code to put inside, so adds no key', async () => {
      const w = await start();
      const rider = await register(w);
      const joined = await linkWith(w, 'abcd-efgh-jkmn');
      expect(codeOf(joined)).toBe('code_unknown');
      expect(await w.freshRead((store) => store.listDeviceKeys(rider.athleteId))).toHaveLength(1);
      expect(await w.freshRead((store) => store.findDeviceKey(joined.device.publicKey))).toBe(
        undefined,
      );
    });

    /**
     * Column E in plaintext (#1192, #1193): the session token alone, sent with
     * no seal at all, is refused `sealed_required` on every route in scope —
     * mint, revoke and the device list as well as the log and its
     * acknowledgement — and nothing is written. Read back through a FRESH
     * store, never the one the handler used.
     */
    for (const [name, method, path, body] of ROUTES_IN_SCOPE) {
      it(`${name}, E in plaintext with a valid token: \`sealed_required\`, and nothing changes`, async () => {
        const w = await start();
        const rider = await register(w);
        const other = await linked(w, rider);
        const snapshot = (): Promise<unknown> =>
          w.freshRead(async (store) => ({
            changes: await store.listAccountChanges(rider.athleteId),
            marks: await store.listAccountChangeMarks(rider.athleteId),
            codes: await store.listLinkCodes(rider.athleteId),
            keys: await store.listDeviceKeys(rider.athleteId),
          }));
        const before = await snapshot();
        const answer = await w.call(method, path(other), {
          token: rider.token,
          plain: true,
          ...(body === undefined ? {} : { body }),
        });
        expect(answer.status).toBe(403);
        expect(codeOf({ status: answer.status, raw: '', body: answer.body })).toBe(
          'sealed_required',
        );
        expect(await snapshot()).toEqual(before);
      });
    }
  });
});

describe('revoke undoes what the revoked key did, and nothing else (#1193)', () => {
  it('voids the link codes the revoked key minted, and keeps another key’s working', async () => {
    const w = await start();
    const rider = await register(w);
    const other = await linked(w, rider);
    const byOther = await mint(w, other);
    const byRider = await mint(w, rider);
    expect((await revoke(w, rider, other.device.publicKey)).reply?.status).toBe(204);

    const refused = await linkWith(w, byOther);
    expect(codeOf(refused)).toBe('code_used');
    const accepted = await linkWith(w, byRider);
    expect(accepted.reply?.status, JSON.stringify(accepted.body)).toBe(200);
  });

  it('cancels the revoked key’s pending address confirmation, and keeps the codes', async () => {
    const w = await start();
    const rider = await register(w);
    const other = await linked(w, rider);
    const given = await sealed(w, other, 'POST', '/v1/auth/recovery-email', {
      address: 'other@example.org',
    });
    expect(given.reply?.status).toBe(204);
    const pending = await w.freshRead((store) => store.listEmailConfirmations(rider.athleteId));
    expect(
      pending.filter((each) => each.usedAt === null).map((each) => each.requestedByKey),
    ).toEqual([other.device.publicKey]);
    expect((await revoke(w, rider, other.device.publicKey)).reply?.status).toBe(204);
    expect(
      (await w.freshRead((store) => store.listEmailConfirmations(rider.athleteId))).filter(
        (each) => each.usedAt === null,
      ),
    ).toEqual([]);
    // Its mailed code now binds nothing.
    const token = w.confirmations.at(-1)!.token;
    const confirmed = await sealed(w, rider, 'POST', '/v1/auth/recovery-email/confirm', { token });
    expect(codeOf(confirmed)).toBe('code_unknown');
  });
});

describe('notices on the other devices (#1193)', () => {
  it('shows the rider both entries when key K mints a code and a second key links with it, until acknowledged', async () => {
    const w = await start();
    const rider = await register(w);
    const k = await linked(w, rider);
    const seenBefore = (await log(w, rider)).changes.at(-1)!.id;
    expect((await acknowledge(w, rider, seenBefore)).reply?.status).toBe(200);

    const added = await linked(w, k);
    const notices = (await log(w, rider)).notices;
    expect(shape(notices)).toEqual([
      `link_code_minted ${k.device.publicKey}`,
      `key_added ${k.device.publicKey}→${added.device.publicKey} via link_code`,
    ]);
    // Still shown until the rider's device acknowledges them.
    expect(shape((await log(w, rider)).notices)).toEqual(shape(notices));
    expect((await acknowledge(w, rider, notices.at(-1)!.id)).reply?.status).toBe(200);
    expect((await log(w, rider)).notices).toEqual([]);
  });
});

describe('the log’s smaller rules (#1193)', () => {
  it('leaves a key’s own entries out of its notices, while its log still carries them', async () => {
    const w = await start();
    const rider = await register(w);
    const other = await linked(w, rider);
    await mint(w, rider);
    const forRider = await log(w, rider);
    const mintedByRider = forRider.changes.filter(
      (each) => each.kind === 'link_code_minted' && each.actorKey === rider.device.publicKey,
    );
    expect(mintedByRider.length).toBeGreaterThan(0);
    expect(forRider.notices.filter((each) => each.actorKey === rider.device.publicKey)).toEqual([]);
    // The other device is shown the rider's entries, and none of its own.
    const forOther = await log(w, other);
    expect(forOther.notices.some((each) => each.actorKey === rider.device.publicKey)).toBe(true);
    expect(forOther.notices.some((each) => each.actorKey === other.device.publicKey)).toBe(false);
  });

  it('logs an address cleared when another replaces it, and nothing when the same one is confirmed again', async () => {
    const w = await start();
    const rider = await register(w);
    const confirmAddress = async (address: string): Promise<void> => {
      const given = await sealed(w, rider, 'POST', '/v1/auth/recovery-email', { address });
      expect(given.reply?.status, JSON.stringify(given.body)).toBe(204);
      const token = w.confirmations.at(-1)!.token;
      const done = await sealed(w, rider, 'POST', '/v1/auth/recovery-email/confirm', { token });
      expect(done.reply?.status, JSON.stringify(done.body)).toBe(204);
    };
    const kinds = async (): Promise<string[]> =>
      (await log(w, rider)).changes
        .filter((each) => each.kind.startsWith('address_'))
        .map((each) => `${each.kind} ${each.address}`);

    await confirmAddress('one@example.org');
    expect(await kinds()).toEqual(['address_added one@example.org']);
    await confirmAddress('one@example.org');
    expect(await kinds()).toEqual(['address_added one@example.org']);
    await confirmAddress('two@example.org');
    expect(await kinds()).toEqual([
      'address_added one@example.org',
      'address_cleared one@example.org',
      'address_added two@example.org',
    ]);
  });

  it('logs a revoke once: revoking an already-revoked key adds no second entry', async () => {
    const w = await start();
    const rider = await register(w);
    const other = await linked(w, rider);
    const count = async (): Promise<number> =>
      (await log(w, rider)).changes.filter((each) => each.kind === 'key_revoked').length;
    expect((await revoke(w, rider, other.device.publicKey)).reply?.status).toBe(204);
    expect(await count()).toBe(1);
    await revoke(w, rider, other.device.publicKey);
    expect(await count()).toBe(1);
  });
});

describe('the account export (#1193)', () => {
  it('carries the log and every device’s mark', async () => {
    const w = await start();
    const rider = await register(w);
    const other = await linked(w, rider);
    const newest = (await log(w, other)).changes.at(-1)!.id;
    await acknowledge(w, other, newest);
    const exported = await sealed(w, rider, 'GET', '/v1/account/export');
    expect(exported.reply?.status).toBe(200);
    const body = exported.body as {
      accountChanges: AccountChangeView[];
      accountChangeMarks: { deviceKey: string; acknowledgedThrough: number }[];
    };
    expect(shape(body.accountChanges)).toEqual([
      `link_code_minted ${rider.device.publicKey}`,
      `key_added ${rider.device.publicKey}→${other.device.publicKey} via link_code`,
    ]);
    expect(
      body.accountChangeMarks.map((mark) => [mark.deviceKey, mark.acknowledgedThrough]),
    ).toEqual([[other.device.publicKey, newest]]);
  });
});
