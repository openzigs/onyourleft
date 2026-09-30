// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Signing in with a device key (#772), through the real listener, the real
 * handler and a real SQLite file. Every claim about what is stored is read
 * back through a SECOND store on the same file, or from the file's bytes.
 */

import { contentHashOf, RECORD_FORMAT, signActivityRecord, LINK_PURPOSE } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from './crypto.ts';
import { CHALLENGE_LIFETIME_SECONDS, DEFAULT_LIMITS, RECOVERY_CODE_COUNT } from './identity.ts';
import {
  startIdentityInstance,
  TEST_ORIGIN,
  testDevice,
  type IdentityInstance,
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

describe('the four refusals #772 names — four distinct codes', () => {
  it('refuses a replayed (nonce, signature): challenge_used', async () => {
    const w = await start();
    const device = await testDevice();
    const statement = await device.statement(await w.nonceFor(device));
    const first = await w.call('POST', '/v1/auth/session', { body: statement });
    expect(first.status).toBe(200);
    const again = await w.call('POST', '/v1/auth/session', { body: statement });
    expect(again.status).toBe(401);
    expect(codeOf(again.body)).toBe('challenge_used');
  });

  it('refuses an expired nonce: challenge_expired', async () => {
    const w = await start();
    const device = await testDevice();
    const statement = await device.statement(await w.nonceFor(device));
    w.clock.ms += CHALLENGE_LIFETIME_SECONDS * 1000;
    const answer = await w.call('POST', '/v1/auth/session', { body: statement });
    expect(answer.status).toBe(401);
    expect(codeOf(answer.body)).toBe('challenge_expired');
  });

  it('refuses a signature over another instance’s origin: wrong_instance', async () => {
    const w = await start();
    const device = await testDevice();
    const statement = await device.statement(await w.nonceFor(device), {
      instanceOrigin: 'https://other.example',
    });
    const answer = await w.call('POST', '/v1/auth/session', { body: statement });
    expect(answer.status).toBe(401);
    expect(codeOf(answer.body)).toBe('wrong_instance');
  });

  it('refuses a real signed activity record, by the same key, presented as a sign-in: wrong_purpose', async () => {
    const w = await start();
    const device = await testDevice();
    const nonce = await w.nonceFor(device);
    const record = await signActivityRecord(
      {
        claims: {
          activityId: 'ride-1',
          name: 'Sunday loop',
          startedAt: 1_790_000_000,
          startedAtTimeZone: 'Europe/London',
          elapsedTime: 3_600,
          movingTime: 3_540,
          distance: 42_195,
          hasPosition: true,
        },
        contentHash: await contentHashOf(
          new Uint8Array([1, 2, 3]),
          async (bytes) =>
            new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
        ),
      },
      device.signingKey,
    );
    // The record's own purpose, and its real signature.
    const asRecord = await w.call('POST', '/v1/auth/session', {
      body: {
        purpose: record.format,
        instanceOrigin: TEST_ORIGIN,
        nonce,
        publicKey: device.publicKey,
        issuedAt: 1_790_000_000,
        signature: record.signature,
      },
    });
    expect(record.format).toBe(RECORD_FORMAT);
    expect(asRecord.status).toBe(401);
    expect(codeOf(asRecord.body)).toBe('wrong_purpose');

    // And a genuine statement for another purpose — a LINK, which adds a key.
    const asLink = await w.call('POST', '/v1/auth/session', {
      body: await device.statement(nonce, { purpose: LINK_PURPOSE }),
    });
    expect(codeOf(asLink.body)).toBe('wrong_purpose');
  });
});

describe('the other refusals', () => {
  it('refuses a record’s signature claimed as a sign-in: bad_signature', async () => {
    const w = await start();
    const device = await testDevice();
    const statement = await device.statement(await w.nonceFor(device));
    const forged = { ...statement, signature: 'ab'.repeat(64) };
    const answer = await w.call('POST', '/v1/auth/session', { body: forged });
    expect(codeOf(answer.body)).toBe('bad_signature');
  });

  it('refuses a nonce issued to another key: challenge_unknown', async () => {
    const w = await start();
    const mine = await testDevice();
    const theirs = await testDevice();
    const nonce = await w.nonceFor(theirs);
    const answer = await w.call('POST', '/v1/auth/session', { body: await mine.statement(nonce) });
    expect(codeOf(answer.body)).toBe('challenge_unknown');
  });

  it('refuses a nonce it never issued: challenge_unknown', async () => {
    const w = await start();
    const device = await testDevice();
    const answer = await w.call('POST', '/v1/auth/session', {
      body: await device.statement('0'.repeat(64)),
    });
    expect(codeOf(answer.body)).toBe('challenge_unknown');
  });

  it('names the field of a malformed statement, never its value', async () => {
    const w = await start();
    const answer = await w.call('POST', '/v1/auth/session', {
      body: {
        purpose: 'oyl-auth-v1',
        instanceOrigin: TEST_ORIGIN,
        nonce: 'SECRET-VALUE',
        publicKey: '0'.repeat(64),
        issuedAt: 1,
        signature: '0'.repeat(128),
      },
    });
    expect(answer.status).toBe(400);
    expect(JSON.stringify(answer.body)).toContain('"field":"nonce"');
    expect(JSON.stringify(answer.body)).not.toContain('SECRET-VALUE');
  });
});

describe('the first key an instance sees registers an athlete', () => {
  it('creates the athlete, with ten recovery codes shown once, and signs the same key in again', async () => {
    const w = await start();
    const device = await testDevice();
    const first = await w.signIn(device, { displayName: 'Anna' });
    expect(first.status).toBe(200);
    expect(first.body.registered).toBe(true);
    expect(first.body.displayName).toBe('Anna');
    expect(first.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    const athleteId = first.body.athleteId as string;

    const athlete = await w.freshRead((store) => store.getAthlete(athleteId));
    expect(athlete?.displayName).toBe('Anna');
    const keys = await w.freshRead((store) => store.listDeviceKeys(athleteId));
    expect(keys.map((key) => key.publicKey)).toEqual([device.publicKey]);

    const second = await w.signIn(device);
    expect(second.body.registered).toBe(false);
    expect(second.body.athleteId).toBe(athleteId);
    expect(second.body).not.toHaveProperty('recoveryCodes');
  });

  it('refuses an unknown key where registration is closed, and creates nothing', async () => {
    const w = await start({ registration: 'closed' });
    const answer = await w.signIn(await testDevice());
    expect(answer.status).toBe(403);
    expect(codeOf(answer.body)).toBe('registration_closed');
    expect(await w.databaseBytes()).not.toContain('active');
  });
});

describe('the session token', () => {
  it('is never stored: only its SHA-256 is, and the raw token is in no byte of the database', async () => {
    const w = await start();
    const answer = await w.signIn(await testDevice());
    const token = answer.body.sessionToken as string;
    expect(token.length).toBeGreaterThanOrEqual(43);
    const sessions = await w.freshRead((store) =>
      store.listSessions(answer.body.athleteId as string),
    );
    expect(sessions.map((session) => session.tokenSha256)).toEqual([await sha256Hex(token)]);

    const bytes = await w.databaseBytes();
    expect(bytes).toContain(await sha256Hex(token));
    expect(bytes).not.toContain(token);
  });

  it('is revoked on the instance: after DELETE, the old token is refused, on a fresh read', async () => {
    const w = await start();
    const answer = await w.signIn(await testDevice());
    const token = answer.body.sessionToken as string;
    expect((await w.call('GET', '/v1/auth/session', { token })).status).toBe(200);

    expect((await w.call('DELETE', '/v1/auth/session', { token })).status).toBe(204);

    const stored = await w.freshRead(async (store) => store.findSession(await sha256Hex(token)));
    expect(stored?.revokedAt).not.toBeNull();
    const replay = await w.call('GET', '/v1/auth/session', { token });
    expect(replay.status).toBe(401);
    expect(codeOf(replay.body)).toBe('unauthenticated');
  });

  it('is refused after it expires', async () => {
    const w = await start();
    const answer = await w.signIn(await testDevice());
    const token = answer.body.sessionToken as string;
    w.clock.ms = ((answer.body.expiresAt as number) + 1) * 1000;
    expect((await w.call('GET', '/v1/auth/session', { token })).status).toBe(401);
  });
});

describe('what the rate limits hold, and for how long — #892 review', () => {
  // The privacy policy: the project's instance holds an internet address "in
  // memory only, for at most an hour". The sweep, with no further request.
  it('forgets an address and a key when their minute ends, with no further request', async () => {
    const w = await start();
    expect(w.identity.rateLimitSweepPeriodMs).toBe(60_000);
    const device = await testDevice();
    // A challenge counts the address; the key is counted only once a valid
    // signature spends a challenge (#891), so a whole sign-in is what holds
    // it — with the per-address registration count of a new account.
    expect((await w.identity.challenge(device.publicKey, '203.0.113.9')).ok).toBe(true);
    expect(w.identity.heldRateLimitKeys()).toBe(1);
    await w.signIn(device);
    // 203.0.113.9 and the test's own loopback address, per address; the key,
    // proven; and loopback again, for the registration it made.
    expect(w.identity.heldRateLimitKeys()).toBe(4);
    const end = (Math.floor(w.clock.ms / 60_000) + 1) * 60_000;
    w.clock.ms = end - 1;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(4);
    w.clock.ms = end;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(0);
  });

  it('forgets an email address when its hour ends, and the internet address at its minute', async () => {
    const w = await start({ emailRecovery: true });
    expect((await w.identity.requestEmailRecovery('rider@example.org', '203.0.113.9')).ok).toBe(
      true,
    );
    expect(w.identity.heldRateLimitKeys()).toBe(2);
    w.clock.ms = (Math.floor(w.clock.ms / 60_000) + 1) * 60_000;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(1);
    const hourEnd = (Math.floor(w.clock.ms / 3_600_000) + 1) * 3_600_000;
    w.clock.ms = hourEnd - 1;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(1);
    w.clock.ms = hourEnd;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(0);
  });
});

describe('how long a rate limit may hold anything — #892', () => {
  // The privacy policy's "in memory only, for at most an hour" rests on this:
  // a key is swept at the end of its window, so no window may be longer than
  // an hour. Every `RateLimit` in the defaults is found by its shape, so a
  // limit added later is held here with no edit.
  it('has no default window longer than an hour', () => {
    const windows = Object.entries(DEFAULT_LIMITS).flatMap(([name, value]) =>
      typeof value === 'object' && value !== null && 'windowMs' in value
        ? [[name, (value as { windowMs: number }).windowMs] as const]
        : [],
    );
    expect(windows.length).toBeGreaterThanOrEqual(9);
    // #918's history-search limit is one of them.
    expect(windows.map(([name]) => name)).toContain('historySearchesPerAthlete');
    for (const [name, windowMs] of windows) {
      expect(windowMs, name).toBeGreaterThan(0);
      expect(windowMs, name).toBeLessThanOrEqual(60 * 60_000);
    }
  });
});

describe('what the rate limits hold after the merge with #889 and #891 — #892', () => {
  // #889's confirmation limits and #891's registration limit hold keys too —
  // an athlete, an address pair, an email address, an internet address — and
  // every one of them is swept at the end of its hour.
  it('forgets the registration and confirmation keys when their hour ends', async () => {
    const w = await start({ emailRecovery: true });
    const answer = await w.signIn(await testDevice());
    const token = answer.body.sessionToken as string;
    const given = await w.call('POST', '/v1/auth/recovery-email', {
      token,
      body: { address: 'rider@example.org' },
    });
    expect(given.status).toBe(204);
    const minuteEnd = (Math.floor(w.clock.ms / 60_000) + 1) * 60_000;
    w.clock.ms = minuteEnd;
    w.identity.sweepRateLimits();
    // The test harness's registration limit is a minute long; the three
    // confirmation limits are an hour long, and still held.
    expect(w.identity.heldRateLimitKeys()).toBe(3);
    const hourEnd = (Math.floor(w.clock.ms / 3_600_000) + 1) * 3_600_000;
    w.clock.ms = hourEnd - 1;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(3);
    w.clock.ms = hourEnd;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(0);
  });
});

describe('rate limits on /v1/auth/challenge', () => {
  it('refuses the eleventh SIGN-IN of one key in a minute, and allows it the next minute', async () => {
    const w = await start();
    const device = await testDevice();
    for (let n = 0; n < 10; n += 1) expect((await w.signIn(device)).status).toBe(200);
    const over = await w.call('POST', '/v1/auth/challenge', {
      body: { publicKey: device.publicKey },
    });
    expect(over.status).toBe(429);
    expect(codeOf(over.body)).toBe('rate_limited');
    w.clock.ms += 60_000;
    expect((await w.signIn(device)).status).toBe(200);
  });

  it('does not let a stranger asking for a key’s challenges lock its holder out (#861’s review)', async () => {
    const w = await start();
    const device = await testDevice();
    // A public key is in every signed record, so anybody can ask for its challenges.
    for (let n = 0; n < 20; n += 1) {
      expect(
        (await w.call('POST', '/v1/auth/challenge', { body: { publicKey: device.publicKey } }))
          .status,
      ).toBe(200);
    }
    expect((await w.signIn(device)).status).toBe(200);
  });

  it('gives a client whose address is unknown no shared per-address bucket (#861’s review)', async () => {
    const w = await start({
      limits: { ...DEFAULT_LIMITS, challengePerAddress: { limit: 2, windowMs: 60_000 } },
    });
    const ask = (publicKey: string) =>
      w.instance.handler(
        new Request('http://instance.invalid/v1/auth/challenge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publicKey }),
        }),
        { address: null },
      );
    // One busy client with no address…
    for (let n = 0; n < 5; n += 1) {
      expect((await ask(n.toString(16).padStart(2, '0').repeat(32))).status).toBe(200);
    }
    // …and another is still answered.
    expect((await ask('ab'.repeat(32))).status).toBe(200);
  });

  it('refuses one address past its limit, whatever key it names', async () => {
    const w = await start({
      limits: {
        ...DEFAULT_LIMITS,
        challengePerKey: { limit: 100, windowMs: 60_000 },
        challengePerAddress: { limit: 5, windowMs: 60_000 },
      },
    });
    const statuses: number[] = [];
    for (let n = 0; n < 6; n += 1) {
      const publicKey = n.toString(16).padStart(2, '0').repeat(32);
      statuses.push((await w.call('POST', '/v1/auth/challenge', { body: { publicKey } })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('the log (#772)', () => {
  it('carries no token, nonce, signature, recovery code, link code or ticket across the whole flow', async () => {
    const w = await start();
    await w.freshRead((store) =>
      store.putRoom({
        id: 'room-1',
        kind: 'race',
        visibility: 'private',
        routeSha256: 'a'.repeat(64),
        physicsVersion: 1,
      }),
    );
    const device = await testDevice();
    const nonce = await w.nonceFor(device);
    const statement = await device.statement(nonce);
    const session = await w.call('POST', '/v1/auth/session', { body: statement });
    const body = session.body as Record<string, unknown>;
    const token = body.sessionToken as string;
    const ticket = await w.call('POST', '/v1/rooms/room-1/ticket', {
      token,
      body: { declaredMassKilograms: 71 },
    });
    const link = await w.call('POST', '/v1/auth/link-codes', { token });
    // A path that carries a key and one that carries an athlete id: the log
    // names the ROUTE, never the path it was asked for.
    await w.call('POST', `/v1/auth/devices/${device.publicKey}/revoke`, { token, body: {} });
    await w.call('GET', `/v1/athletes/${body.athleteId as string}`, { token });
    await w.call('DELETE', '/v1/auth/session', { token });
    await w.call('GET', '/v1/auth/session', { token });

    const secrets = [
      token,
      nonce,
      statement.signature as string,
      ...(body.recoveryCodes as string[]),
      (link.body as { linkCode: string }).linkCode,
      (ticket.body as { ticket: string }).ticket,
    ];
    const logged = w.instance.lines.join('\n');
    expect(w.instance.lines.length).toBeGreaterThan(5);
    for (const secret of secrets) expect(logged).not.toContain(secret);
    expect(logged).not.toContain(device.publicKey);
    expect(logged).not.toContain(body.athleteId as string);
  });
});
