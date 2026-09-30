// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * More than one device, and getting back in with none (#773): linking,
 * revoking, recovery codes and email recovery, through the real routes and a
 * real SQLite file, every stored claim read back on a second connection.
 */

import {
  contentHashOf,
  LINK_PURPOSE,
  RECOVER_PURPOSE,
  signActivityRecord,
  verifyActivityRecord,
  fromHex,
  toHex,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { ROUTES } from '../routes.ts';
import { sha256Hex, verifyEd25519 } from './crypto.ts';
import {
  DEFAULT_LIMITS,
  EMAIL_CONFIRMATION_LIFETIME_SECONDS,
  EMAIL_RECOVERY_LIFETIME_SECONDS,
  LINK_CODE_LIFETIME_SECONDS,
} from './identity.ts';
import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from './identity-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function start(options: Parameters<typeof startIdentityInstance>[0] = {}) {
  world = await startIdentityInstance(options);
  return world;
}

const codeOf = (body: unknown): unknown => (body as { error?: { code?: unknown } }).error?.code;

async function registered(w: IdentityInstance, extra: Record<string, unknown> = {}) {
  const device = await testDevice();
  const session = await w.signIn(device, extra);
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  return {
    device,
    athleteId: session.body.athleteId as string,
    token: session.body.sessionToken as string,
    recoveryCodes: session.body.recoveryCodes as string[],
  };
}

/** Follow the link the instance mailed to `address`, as the signed-in athlete (#865). */
async function confirm(w: IdentityInstance, token: string, address: string): Promise<void> {
  const mailed = w.confirmations.filter((each) => each.address === address).at(-1);
  if (mailed === undefined) throw new Error('no confirmation was mailed to that address');
  const answer = await w.call('POST', '/v1/auth/recovery-email/confirm', {
    token,
    body: { token: mailed.token },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(204);
}

async function mintLinkCode(w: IdentityInstance, token: string): Promise<string> {
  const answer = await w.call('POST', '/v1/auth/link-codes', { token });
  expect(answer.status).toBe(200);
  return (answer.body as { linkCode: string }).linkCode;
}

async function link(w: IdentityInstance, device: TestDevice, linkCode: string) {
  return w.call('POST', '/v1/auth/link', {
    body: {
      ...(await device.statement(await w.nonceFor(device), { purpose: LINK_PURPOSE })),
      linkCode,
    },
  });
}

describe('linking a second device', () => {
  it('adds the new device’s own key, which then signs in as the same athlete', async () => {
    const w = await start();
    const first = await registered(w);
    const second = await testDevice();
    const linked = await link(w, second, await mintLinkCode(w, first.token));
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body).toEqual({ athleteId: first.athleteId });
    const keys = await w.freshRead((store) => store.listDeviceKeys(first.athleteId));
    expect(keys.map((key) => key.publicKey).sort()).toEqual(
      [first.device.publicKey, second.publicKey].sort(),
    );
    const signIn = await w.signIn(second);
    expect(signIn.body.athleteId).toBe(first.athleteId);
    expect(signIn.body.registered).toBe(false);
  });

  it('spends a link code once: a second use is code_used', async () => {
    const w = await start();
    const first = await registered(w);
    const code = await mintLinkCode(w, first.token);
    expect((await link(w, await testDevice(), code)).status).toBe(200);
    const again = await link(w, await testDevice(), code);
    expect(again.status).toBe(401);
    expect(codeOf(again.body)).toBe('code_used');
  });

  it('refuses a link code after five minutes: code_expired', async () => {
    const w = await start();
    const first = await registered(w);
    const code = await mintLinkCode(w, first.token);
    w.clock.ms += LINK_CODE_LIFETIME_SECONDS * 1000;
    const late = await link(w, await testDevice(), code);
    expect(codeOf(late.body)).toBe('code_expired');
  });

  it('mints a link code only for a live session on the old device', async () => {
    const w = await start();
    const first = await registered(w);
    expect((await w.call('POST', '/v1/auth/link-codes')).status).toBe(401);
    await w.call('DELETE', '/v1/auth/session', { token: first.token });
    expect((await w.call('POST', '/v1/auth/link-codes', { token: first.token })).status).toBe(401);
  });

  it('will not link a key another athlete already holds: key_in_use', async () => {
    const w = await start();
    const first = await registered(w);
    const other = await registered(w);
    const code = await mintLinkCode(w, first.token);
    const answer = await link(w, other.device, code);
    expect(codeOf(answer.body)).toBe('key_in_use');
    // A refusal spends nothing: the same code still links a new device (#861).
    expect((await link(w, await testDevice(), code)).status).toBe(200);
  });

  it('refuses a key that another link registered after this one checked: key_in_use, never a 500 (#861)', async () => {
    const shared = await testDevice();
    // The race in a known order: this identity's check never sees the shared
    // key, as if the other link had not landed yet when it looked.
    const w = await start({
      storeSeenBy: (store) => ({
        ...store,
        findDeviceKey: (publicKey) =>
          publicKey === shared.publicKey
            ? Promise.resolve(undefined)
            : store.findDeviceKey(publicKey),
      }),
    });
    const anna = await registered(w);
    const ben = await registered(w);
    expect((await link(w, shared, await mintLinkCode(w, anna.token))).status).toBe(200);
    const late = await link(w, shared, await mintLinkCode(w, ben.token));
    expect(late.status, JSON.stringify(late.body)).toBe(409);
    expect(codeOf(late.body)).toBe('key_in_use');
    const annaKeys = await w.freshRead((store) => store.listDeviceKeys(anna.athleteId));
    expect(annaKeys.map((key) => key.publicKey)).toContain(shared.publicKey);
  });

  it('spends no recovery code on a key that is already registered: key_in_use (#861)', async () => {
    const w = await start();
    const lost = await registered(w);
    const other = await registered(w);
    const code = lost.recoveryCodes[0] as string;
    const recover = async (device: TestDevice) =>
      w.call('POST', '/v1/auth/recover', {
        body: {
          ...(await device.statement(await w.nonceFor(device), { purpose: RECOVER_PURPOSE })),
          recoveryCode: code,
        },
      });
    const refused = await recover(other.device);
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe('key_in_use');
    const codes = await w.freshRead((store) => store.listRecoveryCodes(lost.athleteId));
    expect(codes.filter((each) => each.usedAt === null)).toHaveLength(10);
    expect((await recover(await testDevice())).body).toEqual({ athleteId: lost.athleteId });
  });

  it('refuses a sign-in statement presented as a link: wrong_purpose', async () => {
    const w = await start();
    const first = await registered(w);
    const second = await testDevice();
    const answer = await w.call('POST', '/v1/auth/link', {
      body: {
        ...(await second.statement(await w.nonceFor(second))),
        linkCode: await mintLinkCode(w, first.token),
      },
    });
    expect(codeOf(answer.body)).toBe('wrong_purpose');
  });
});

describe('revoking a device', () => {
  it('stops the key authenticating — asserted on a fresh read — and leaves the records it signed valid', async () => {
    const w = await start();
    const first = await registered(w);
    const second = await testDevice();
    await link(w, second, await mintLinkCode(w, first.token));
    const secondSession = await w.signIn(second);
    const secondToken = secondSession.body.sessionToken as string;

    // A ride the second device signed before it was revoked.
    const file = new Uint8Array([9, 8, 7, 6]);
    const sha256 = async (bytes: Uint8Array) =>
      new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
    const record = await signActivityRecord(
      {
        claims: {
          activityId: 'ride-before',
          name: 'Before the revocation',
          startedAt: 1_790_000_000,
          startedAtTimeZone: 'Europe/London',
          elapsedTime: 600,
          movingTime: 600,
          distance: 5_000,
          hasPosition: false,
        },
        contentHash: await contentHashOf(file, sha256),
      },
      second.signingKey,
    );

    const revoked = await w.call('POST', `/v1/auth/devices/${second.publicKey}/revoke`, {
      token: first.token,
      body: {},
    });
    expect(revoked.status).toBe(204);

    const key = await w.freshRead((store) => store.findDeviceKey(second.publicKey));
    expect(key?.revokedAt).not.toBeNull();
    const signIn = await w.signIn(second);
    expect(codeOf(signIn.body)).toBe('key_revoked');
    expect((await w.call('GET', '/v1/auth/session', { token: secondToken })).status).toBe(401);

    // ADR 0014 D-6: verified by the record and the key in it, not by the key's status here.
    const verified = await verifyActivityRecord(record, {
      verifier: {
        algorithm: 'Ed25519',
        verify: ({ publicKey, message, signature }) =>
          verifyEd25519(toHex(publicKey), message, toHex(signature)),
      },
      fileDigest: await sha256(file),
    });
    expect(verified.status).toBe('verified');
    expect(fromHex(record.publicKey, 'key')).toEqual(second.signingKey.publicKey);
  });

  it('refuses to revoke the last key without a recovery code the athlete holds, and does not spend the code', async () => {
    const w = await start();
    const only = await registered(w);
    const path = `/v1/auth/devices/${only.device.publicKey}/revoke`;

    const bare = await w.call('POST', path, { token: only.token, body: {} });
    expect(bare.status).toBe(409);
    expect(codeOf(bare.body)).toBe('last_device');
    const wrong = await w.call('POST', path, {
      token: only.token,
      body: { recoveryCode: 'aaaa-bbbb-cccc-dddd' },
    });
    expect(codeOf(wrong.body)).toBe('last_device');
    expect(
      (await w.freshRead((store) => store.findDeviceKey(only.device.publicKey)))?.revokedAt,
    ).toBeNull();

    const code = only.recoveryCodes[0] as string;
    const confirmed = await w.call('POST', path, {
      token: only.token,
      body: { recoveryCode: code },
    });
    expect(confirmed.status).toBe(204);
    expect(
      (await w.freshRead((store) => store.findDeviceKey(only.device.publicKey)))?.revokedAt,
    ).not.toBeNull();
    const codes = await w.freshRead((store) => store.listRecoveryCodes(only.athleteId));
    expect(codes.every((each) => each.usedAt === null)).toBe(true);
  });

  it('will not revoke another athlete’s key: not_found', async () => {
    const w = await start();
    const a = await registered(w);
    const b = await registered(w);
    const answer = await w.call('POST', `/v1/auth/devices/${b.device.publicKey}/revoke`, {
      token: a.token,
      body: {},
    });
    expect(answer.status).toBe(404);
    expect(
      (await w.freshRead((store) => store.findDeviceKey(b.device.publicKey)))?.revokedAt,
    ).toBeNull();
  });
});

describe('two sessions revoking the last two keys at once (#867)', () => {
  it('leaves the athlete a key: one revocation lands and the other is last_device', async () => {
    // The race in a known order: when the first revocation reaches the store,
    // the second is run to completion ahead of it. A rule checked in one
    // store call and written in another sees two live keys both times.
    let interleave: (() => Promise<unknown>) | undefined;
    const w = await start({
      storeSeenBy: (store) => ({
        ...store,
        revokeDeviceKey: async (...args) => {
          const other = interleave;
          interleave = undefined;
          if (other !== undefined) await other();
          return store.revokeDeviceKey(...args);
        },
      }),
    });
    const first = await registered(w);
    const second = await testDevice();
    expect((await link(w, second, await mintLinkCode(w, first.token))).status).toBe(200);
    const secondToken = (await w.signIn(second)).body.sessionToken as string;

    let late: { status: number; body: unknown } | undefined;
    interleave = async () => {
      late = await w.call('POST', `/v1/auth/devices/${first.device.publicKey}/revoke`, {
        token: secondToken,
        body: {},
      });
    };
    const early = await w.call('POST', `/v1/auth/devices/${second.publicKey}/revoke`, {
      token: first.token,
      body: {},
    });

    expect(late?.status, JSON.stringify(late?.body)).toBe(204);
    expect(early.status, JSON.stringify(early.body)).toBe(409);
    expect(codeOf(early.body)).toBe('last_device');
    const keys = await w.freshRead((store) => store.listDeviceKeys(first.athleteId));
    expect(keys.filter((key) => key.revokedAt === null).map((key) => key.publicKey)).toEqual([
      second.publicKey,
    ]);
  });
});

describe('the device list', () => {
  it('lists this athlete’s devices with when each was added and last used, and nothing of anyone else — three athletes', async () => {
    const w = await start();
    const a = await registered(w);
    const b = await registered(w);
    const c = await registered(w);
    const aSecond = await testDevice();
    await link(w, aSecond, await mintLinkCode(w, a.token));

    const listed = await w.call('GET', '/v1/auth/devices', { token: a.token });
    const devices = (listed.body as { devices: Record<string, unknown>[] }).devices;
    expect(devices.map((d) => d.publicKey).sort()).toEqual(
      [a.device.publicKey, aSecond.publicKey].sort(),
    );
    const mine = devices.find((d) => d.publicKey === a.device.publicKey);
    expect(mine).toEqual({
      publicKey: a.device.publicKey,
      addedAt: Math.floor(w.clock.ms / 1000),
      lastUsedAt: Math.floor(w.clock.ms / 1000),
      revokedAt: null,
      thisDevice: true,
    });
    expect(devices.find((d) => d.publicKey === aSecond.publicKey)?.lastUsedAt).toBeNull();
    const text = JSON.stringify(listed.body);
    for (const other of [b, c]) {
      expect(text).not.toContain(other.device.publicKey);
      expect(text).not.toContain(other.athleteId);
    }
  });
});

describe('recovery codes (ruling Q1)', () => {
  it('are shown once, stored only as hashes, and each adds one new key once', async () => {
    const w = await start();
    const lost = await registered(w);
    expect(lost.recoveryCodes).toHaveLength(10);
    const bytes = await w.databaseBytes();
    for (const code of lost.recoveryCodes) {
      expect(bytes).not.toContain(code);
      expect(bytes).not.toContain(code.replace(/-/g, ''));
    }
    const stored = await w.freshRead((store) => store.listRecoveryCodes(lost.athleteId));
    expect(stored).toHaveLength(10);
    expect(stored.map((each) => each.codeSha256)).toContain(
      await sha256Hex((lost.recoveryCodes[0] as string).replace(/-/g, '')),
    );

    const replacement = await testDevice();
    const recover = async (device: TestDevice, recoveryCode: string) =>
      w.call('POST', '/v1/auth/recover', {
        body: {
          ...(await device.statement(await w.nonceFor(device), { purpose: RECOVER_PURPOSE })),
          recoveryCode,
        },
      });
    const code = lost.recoveryCodes[0] as string;
    const first = await recover(replacement, code.toUpperCase());
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ athleteId: lost.athleteId });
    expect((await w.signIn(replacement)).body.athleteId).toBe(lost.athleteId);

    const twice = await recover(await testDevice(), code);
    expect(twice.status).toBe(401);
    expect(codeOf(twice.body)).toBe('code_used');
    expect(codeOf((await recover(await testDevice(), 'zzzz-zzzz-zzzz-zzzz')).body)).toBe(
      'code_unknown',
    );
  });
});

describe('email recovery (ruling Q1): off unless the operator enables it', () => {
  it('off: no address is collected or stored at registration, and the routes are not there', async () => {
    const w = await start();
    const offered = await w.signIn(await testDevice(), { recoveryEmail: 'anna@example.org' });
    expect(offered.status).toBe(400);
    expect(JSON.stringify(offered.body)).toContain('"field":"recoveryEmail"');
    const plain = await registered(w);
    expect(await w.freshRead((store) => store.getRecoveryEmail(plain.athleteId))).toBeUndefined();
    expect(await w.databaseBytes()).not.toContain('anna@example.org');
    expect(
      (await w.call('POST', '/v1/auth/recover/email', { body: { address: 'anna@example.org' } }))
        .status,
    ).toBe(404);
  });

  it('on: a link is single-use, time-limited and stored as a hash — and an unknown address gets the same answer', async () => {
    const w = await start({ emailRecovery: true });
    const anna = await registered(w, { recoveryEmail: 'Anna@Example.org' });
    await confirm(w, anna.token, 'anna@example.org');
    const asked = await w.call('POST', '/v1/auth/recover/email', {
      body: { address: 'anna@example.org' },
    });
    expect(asked.status).toBe(204);
    const stranger = await w.call('POST', '/v1/auth/recover/email', {
      body: { address: 'nobody@example.org' },
    });
    expect(stranger.status).toBe(204);
    expect(w.mail).toHaveLength(1);
    const { token } = w.mail[0] as { token: string };
    expect(await w.databaseBytes()).not.toContain(token);
    const stored = await w.freshRead((store) => store.listEmailRecoveryTokens(anna.athleteId));
    expect(stored.map((each) => each.tokenSha256)).toEqual([await sha256Hex(token)]);

    const recover = async (emailToken: string) => {
      const device = await testDevice();
      return w.call('POST', '/v1/auth/recover', {
        body: {
          ...(await device.statement(await w.nonceFor(device), { purpose: RECOVER_PURPOSE })),
          emailToken,
        },
      });
    };
    expect((await recover(token)).body).toEqual({ athleteId: anna.athleteId });
    expect(codeOf((await recover(token)).body)).toBe('code_used');

    await w.call('POST', '/v1/auth/recover/email', { body: { address: 'anna@example.org' } });
    const late = (w.mail[1] as { token: string }).token;
    w.clock.ms += EMAIL_RECOVERY_LIFETIME_SECONDS * 1000;
    expect(codeOf((await recover(late)).body)).toBe('code_expired');
  });
});

describe('a recovery address is bound only once it is confirmed (#865)', () => {
  const confirmLink = (w: IdentityInstance, token: string, emailed: unknown) =>
    w.call('POST', '/v1/auth/recovery-email/confirm', { token, body: { token: emailed } });
  const bound = (w: IdentityInstance, athleteId: string) =>
    w.freshRead((store) => store.getRecoveryEmail(athleteId));

  it('two athletes, one address: the one who gave it first binds nothing, the mailbox’s reader binds it, and every answer is the same', async () => {
    const w = await start({ emailRecovery: true });
    // Mallory gives Anna's address first, then Anna gives her own.
    const mallory = await w.signIn(await testDevice(), { recoveryEmail: 'anna@example.org' });
    const annaDevice = await testDevice();
    const anna = await w.signIn(annaDevice, { recoveryEmail: 'Anna@Example.org' });
    expect(mallory.status).toBe(200);
    expect(anna.status, JSON.stringify(anna.body)).toBe(200);
    expect(Object.keys(anna.body).sort()).toEqual(Object.keys(mallory.body).sort());
    const malloryId = mallory.body.athleteId as string;
    const annaId = anna.body.athleteId as string;
    const malloryToken = mallory.body.sessionToken as string;
    const annaToken = anna.body.sessionToken as string;

    // Nothing is bound yet, for either of them, and a link went to the
    // mailbox each time — the only place a token goes.
    expect(await bound(w, malloryId)).toBeUndefined();
    expect(await bound(w, annaId)).toBeUndefined();
    expect(w.confirmations.map((each) => each.address)).toEqual([
      'anna@example.org',
      'anna@example.org',
    ]);
    const [forMallory, forAnna] = w.confirmations.map((each) => each.token) as [string, string];
    expect(await w.databaseBytes()).not.toContain(forMallory);
    expect(await w.databaseBytes()).not.toContain(forAnna);

    // An unconfirmed address recovers nothing: no recovery link is mailed.
    expect(
      (await w.call('POST', '/v1/auth/recover/email', { body: { address: 'anna@example.org' } }))
        .status,
    ).toBe(204);
    expect(w.mail).toEqual([]);

    // Anna, reading her mail, follows the link Mallory caused: it is not
    // hers, and binds nothing to Mallory's account. Nor can Mallory spend
    // Anna's link, or her own through Anna's session.
    expect(codeOf((await confirmLink(w, annaToken, forMallory)).body)).toBe('code_unknown');
    expect(codeOf((await confirmLink(w, malloryToken, forAnna)).body)).toBe('code_unknown');
    expect(await bound(w, malloryId)).toBeUndefined();

    // Anna follows her own: the address is hers, once.
    expect((await confirmLink(w, annaToken, forAnna)).status).toBe(204);
    expect(await bound(w, annaId)).toEqual({ athleteId: annaId, address: 'anna@example.org' });
    expect(await bound(w, malloryId)).toBeUndefined();
    const again = await confirmLink(w, annaToken, forAnna);
    expect(again.status).toBe(401);
    expect(codeOf(again.body)).toBe('code_used');

    // Giving an address somebody holds answers exactly as giving a free one.
    const held = await w.call('POST', '/v1/auth/recovery-email', {
      token: malloryToken,
      body: { address: 'anna@example.org' },
    });
    const free = await w.call('POST', '/v1/auth/recovery-email', {
      token: malloryToken,
      body: { address: 'mallory@example.org' },
    });
    expect(held).toEqual(free);
    expect(held.status).toBe(204);
    expect(await bound(w, malloryId)).toBeUndefined();

    // And recovery by email now reaches Anna, and only Anna.
    await w.call('POST', '/v1/auth/recover/email', { body: { address: 'anna@example.org' } });
    expect(w.mail).toHaveLength(1);
    const { token: recovery } = w.mail[0] as { token: string };
    expect(
      (await w.freshRead((store) => store.listEmailRecoveryTokens(annaId))).map(
        (each) => each.tokenSha256,
      ),
    ).toEqual([await sha256Hex(recovery)]);
    expect(await w.freshRead((store) => store.listEmailRecoveryTokens(malloryId))).toEqual([]);

    // No address and no token reaches the log.
    const logged = w.instance.lines.join('\n').toLowerCase();
    expect(w.instance.lines.length).toBeGreaterThan(5);
    for (const secret of [
      forMallory,
      forAnna,
      recovery,
      'anna@example.org',
      'mallory@example.org',
    ]) {
      expect(logged).not.toContain(secret.toLowerCase());
    }
  });

  it('registers the athlete, codes and all, when the mail transport fails', async () => {
    const w = await start({ emailRecovery: 'failing' });
    const anna = await registered(w, { recoveryEmail: 'anna@example.org' });
    expect(anna.recoveryCodes).toHaveLength(10);
    expect(await bound(w, anna.athleteId)).toBeUndefined();
  });

  it('a link is time-limited: after 24 hours it is code_expired and binds nothing', async () => {
    const w = await start({ emailRecovery: true });
    const anna = await registered(w, { recoveryEmail: 'anna@example.org' });
    const { token } = w.confirmations[0] as { token: string };
    w.clock.ms += EMAIL_CONFIRMATION_LIFETIME_SECONDS * 1000;
    const late = await confirmLink(w, anna.token, token);
    expect(late.status).toBe(401);
    expect(codeOf(late.body)).toBe('code_expired');
    expect(await bound(w, anna.athleteId)).toBeUndefined();
    // Giving it again mails a fresh link, which does bind.
    await w.call('POST', '/v1/auth/recovery-email', {
      token: anna.token,
      body: { address: 'anna@example.org' },
    });
    const fresh = (w.confirmations[1] as { token: string }).token;
    expect((await confirmLink(w, anna.token, fresh)).status).toBe(204);
    expect((await bound(w, anna.athleteId))?.address).toBe('anna@example.org');
  });

  it('refuses an address another account already confirmed: address_in_use, and nothing moves', async () => {
    const w = await start({ emailRecovery: true });
    const first = await registered(w, { recoveryEmail: 'shared@example.org' });
    await confirm(w, first.token, 'shared@example.org');
    // The same person's second account: they read the mailbox, so they are
    // told, and the first account keeps its address.
    const second = await registered(w, { recoveryEmail: 'shared@example.org' });
    const { token } = w.confirmations.at(-1) as { token: string };
    const refused = await confirmLink(w, second.token, token);
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe('address_in_use');
    expect(await bound(w, second.athleteId)).toBeUndefined();
    expect((await bound(w, first.athleteId))?.address).toBe('shared@example.org');
  });

  it('mails an address at most its hourly share of links, and answers the same when it stops', async () => {
    const w = await start({ emailRecovery: true });
    const anna = await registered(w);
    const answers = [];
    for (let n = 0; n < 5; n += 1) {
      answers.push(
        await w.call('POST', '/v1/auth/recovery-email', {
          token: anna.token,
          body: { address: 'someone@example.org' },
        }),
      );
    }
    expect(new Set(answers.map((each) => JSON.stringify(each))).size).toBe(1);
    expect(w.confirmations).toHaveLength(3);
  });

  const give = (w: IdentityInstance, token: string, address: string) =>
    w.call('POST', '/v1/auth/recovery-email', { token, body: { address } });
  const mailedTo = (w: IdentityInstance, address: string) =>
    w.confirmations.filter((each) => each.address === address).length;

  it('one athlete cannot use up another’s share of an address: Mallory spends hers, and Anna’s link is still mailed (#883)', async () => {
    const w = await start({ emailRecovery: true });
    const mallory = await registered(w);
    const anna = await registered(w);
    for (let n = 0; n < 5; n += 1) await give(w, mallory.token, 'anna@example.org');
    expect(mailedTo(w, 'anna@example.org')).toBe(3);
    const answer = await give(w, anna.token, 'anna@example.org');
    expect(answer.status).toBe(204);
    expect(mailedTo(w, 'anna@example.org')).toBe(4);
    await confirm(w, anna.token, 'anna@example.org');
    expect((await bound(w, anna.athleteId))?.address).toBe('anna@example.org');
  });

  it('bounds an address’s mail across athletes, but never withholds an athlete’s first link of the hour (#883)', async () => {
    const w = await start({
      emailRecovery: true,
      limits: { ...DEFAULT_LIMITS, confirmationsPerAddress: { limit: 2, windowMs: 3_600_000 } },
    });
    const first = await registered(w);
    const second = await registered(w);
    const anna = await registered(w);
    // Two strangers spend the address's whole share at the top of the hour.
    await give(w, first.token, 'anna@example.org');
    await give(w, second.token, 'anna@example.org');
    expect(mailedTo(w, 'anna@example.org')).toBe(2);
    // Over the shared bound, a stranger's second link does not go…
    const held = await give(w, first.token, 'anna@example.org');
    expect(mailedTo(w, 'anna@example.org')).toBe(2);
    // …and the owner's first one does, with the same answer.
    const hers = await give(w, anna.token, 'anna@example.org');
    expect(hers).toEqual(held);
    expect(mailedTo(w, 'anna@example.org')).toBe(3);
    await confirm(w, anna.token, 'anna@example.org');
    expect((await bound(w, anna.athleteId))?.address).toBe('anna@example.org');
  });

  it('limits one athlete asking for many addresses: rate_limited, whoever holds them (#883)', async () => {
    const w = await start({ emailRecovery: true });
    const mallory = await registered(w);
    const statuses: number[] = [];
    for (let n = 0; n < 8; n += 1) {
      statuses.push((await give(w, mallory.token, `victim-${n}@example.org`)).status);
    }
    const allowed = DEFAULT_LIMITS.confirmationRequestsPerAthlete.limit;
    expect(statuses).toEqual([
      ...Array<number>(allowed).fill(204),
      ...Array<number>(8 - allowed).fill(429),
    ]);
    expect(w.confirmations).toHaveLength(allowed);
    // One pending link at a time: each new address replaced the one before.
    expect(
      (await w.freshRead((store) => store.listEmailConfirmations(mallory.athleteId))).map(
        (each) => each.address,
      ),
    ).toEqual([`victim-${allowed - 1}@example.org`]);
    // Another athlete is not limited by Mallory's count.
    const anna = await registered(w);
    expect((await give(w, anna.token, 'anna@example.org')).status).toBe(204);
    // And the next hour, Mallory may ask again.
    w.clock.ms += 3_600_000;
    expect((await give(w, mallory.token, 'victim-9@example.org')).status).toBe(204);
  });

  it('answers internal when the mail transport fails, and leaves no stray link and the earlier one standing (#883)', async () => {
    const w = await start({ emailRecovery: 'failing' });
    const anna = await registered(w, { recoveryEmail: 'anna@example.org' });
    const before = await w.freshRead((store) => store.listEmailConfirmations(anna.athleteId));
    expect(before).toHaveLength(1);
    const answer = await give(w, anna.token, 'anna@elsewhere.org');
    expect(answer.status).toBe(500);
    expect(codeOf(answer.body)).toBe('internal');
    expect(await w.freshRead((store) => store.listEmailConfirmations(anna.athleteId))).toEqual(
      before,
    );
    expect(w.instance.lines.join('\n')).not.toContain('anna@elsewhere.org');
  });

  it('off: the routes are not there', async () => {
    const w = await start();
    const anna = await registered(w);
    const given = await w.call('POST', '/v1/auth/recovery-email', {
      token: anna.token,
      body: { address: 'anna@example.org' },
    });
    expect(given.status).toBe(404);
    expect((await confirmLink(w, anna.token, 'a'.repeat(43))).status).toBe(404);
    expect(await w.databaseBytes()).not.toContain('anna@example.org');
  });
});

describe('no password, anywhere (ruling Q12)', () => {
  it('declares no password field in any request, and none in the specification', async () => {
    const requests = JSON.stringify(ROUTES.map((route) => route.request ?? null));
    expect(requests).not.toMatch(/pass(word|phrase)?/i);
    const { readFile } = await import('node:fs/promises');
    const specification = await readFile(new URL('../../openapi.json', import.meta.url), 'utf8');
    expect(specification).not.toMatch(/password|passphrase/i);
  });
});
