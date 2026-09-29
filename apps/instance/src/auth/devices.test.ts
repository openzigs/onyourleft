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
import { EMAIL_RECOVERY_LIFETIME_SECONDS, LINK_CODE_LIFETIME_SECONDS } from './identity.ts';
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
    const answer = await link(w, other.device, await mintLinkCode(w, first.token));
    expect(codeOf(answer.body)).toBe('key_in_use');
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

describe('no password, anywhere (ruling Q12)', () => {
  it('declares no password field in any request, and none in the specification', async () => {
    const requests = JSON.stringify(ROUTES.map((route) => route.request ?? null));
    expect(requests).not.toMatch(/pass(word|phrase)?/i);
    const { readFile } = await import('node:fs/promises');
    const specification = await readFile(new URL('../../openapi.json', import.meta.url), 'utf8');
    expect(specification).not.toMatch(/password|passphrase/i);
  });
});
