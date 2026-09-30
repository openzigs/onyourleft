// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registration modes, the approval queue, the 18+ confirmation, account
 * suspension across every key, and the per-address registration limit
 * (#775), through the real listener and a real SQLite file. Every claim about
 * what is stored is read back through a SECOND store on the same file.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LINK_PURPOSE } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { identitySettings, readConfig } from '../config.ts';
import { startTestInstance, TEST_COMMIT, type TestInstance } from '../instance-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { createIdentity, DEFAULT_LIMITS, INVITE_LIFETIME_SECONDS } from './identity.ts';
import { TEST_ORIGIN, testDevice, type TestDevice } from './identity-testing.ts';

let world: ModerationWorld | undefined;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await world?.close();
  world = undefined;
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function start(
  registration: 'open' | 'approval' | 'invite' | 'closed',
  options: Parameters<typeof startModerationWorld>[0] = {},
): Promise<ModerationWorld> {
  world = await startModerationWorld({ ...options, registration });
  return world;
}

/** Sign in from a stated client address, through the real handler. */
async function signInFrom(
  w: ModerationWorld,
  device: TestDevice,
  address: string | null,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const post = async (path: string, body: unknown) => {
    const response = await w.instance.handler(
      new Request(`http://instance.invalid${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { address },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const challenge = await post('/v1/auth/challenge', { publicKey: device.publicKey });
  return post('/v1/auth/session', {
    ...(await device.statement(challenge.body.nonce as string)),
    ...extra,
  });
}

describe('the default registration mode (#775, rulings Q5 and Q13)', () => {
  it('is approval-required, on an instance started with nothing configured', async () => {
    const configured = readConfig({ commit: TEST_COMMIT });
    if (!configured.ok) throw new Error(configured.problems.join(' '));
    expect(configured.config.registration).toBe('approval');

    const directory = await mkdtemp(join(tmpdir(), 'oyl-instance-default-'));
    const store = await openSqlStore(join(directory, 'instance.sqlite'));
    // Nothing but what the configuration says: no mode is named here.
    const instance: TestInstance = await startTestInstance({
      config: configured.config,
      identity: createIdentity({
        store,
        origin: TEST_ORIGIN,
        ...identitySettings(configured.config),
      }),
    });
    cleanups.push(async () => {
      await instance.listening.close();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    });
    const device = await testDevice();
    const challenge = await fetch(`${instance.url}/v1/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: device.publicKey }),
    });
    const { nonce } = (await challenge.json()) as { nonce: string };
    const session = await fetch(`${instance.url}/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await device.statement(nonce)),
    });
    const body = (await session.json()) as { registrationState: string; athleteId: string };
    expect(session.status).toBe(200);
    expect(body.registrationState).toBe('pending');
    const fresh = await openSqlStore(join(directory, 'instance.sqlite'));
    try {
      expect((await fresh.getAthlete(body.athleteId))?.registrationState).toBe('pending');
    } finally {
      await fresh.close();
    }
  });

  it('is what the project’s image is configured with', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).toMatch(/^\s*OYL_INSTANCE_REGISTRATION=approval\b/m);
  });
});

describe('the four registration modes (#775)', () => {
  it('open: a new key is active at once', async () => {
    const w = await start('open');
    const session = await w.signIn(await testDevice());
    expect(session.body.registrationState).toBe('active');
  });

  it('approval: a new key waits, reaching its own account and nothing else', async () => {
    const w = await start('approval');
    const session = await w.signIn(await testDevice());
    expect(session.status).toBe(200);
    expect(session.body.registrationState).toBe('pending');
    expect(session.body.recoveryCodes).toHaveLength(10);
    const token = session.body.sessionToken as string;
    const account = await w.call('GET', '/v1/auth/account', { token });
    expect(account.status).toBe(200);
    expect(account.body).toMatchObject({
      registrationState: 'pending',
      moderatorRole: null,
      publicRooms: { eligible: false },
    });
    const elsewhere = await w.call('GET', `/v1/athletes/${w.owner.athleteId}`, { token });
    expect(elsewhere.status).toBe(403);
    expect(codeOf(elsewhere.body)).toBe('registration_pending');
    // And other riders cannot see them.
    const seen = await w.as(w.owner, 'GET', `/v1/athletes/${session.body.athleteId as string}`);
    expect(seen.status).toBe(404);
  });

  it('invite: only with a moderator’s invitation, spent once, and not after it expires', async () => {
    const w = await start('invite');
    const missing = await w.signIn(await testDevice());
    expect(missing.status).toBe(400);
    const wrong = await w.signIn(await testDevice(), { inviteCode: 'aaaa-bbbb-cccc-dddd' });
    expect(codeOf(wrong.body)).toBe('code_unknown');

    const minted = await w.as(w.owner, 'POST', '/v1/moderation/invites', {
      reason: 'Tuesday group',
    });
    expect(minted.status).toBe(200);
    const { inviteCode } = minted.body as { inviteCode: string };
    const invited = await w.signIn(await testDevice(), { inviteCode });
    expect(invited.status).toBe(200);
    expect(invited.body.registrationState).toBe('active');
    const again = await w.signIn(await testDevice(), { inviteCode });
    expect(codeOf(again.body)).toBe('code_used');
    // A refused registration spent nothing: the code was taken in the same
    // transaction that registered, so a failed attempt left no athlete behind.
    const log = await w.freshRead((store) => store.listModerationLog());
    expect(log.map((entry) => entry.action)).toEqual(['mint_invite']);

    const late = (
      (await w.as(w.owner, 'POST', '/v1/moderation/invites', { reason: 'Later' })).body as {
        inviteCode: string;
      }
    ).inviteCode;
    w.clock.ms += INVITE_LIFETIME_SECONDS * 1000;
    expect(codeOf((await w.signIn(await testDevice(), { inviteCode: late })).body)).toBe(
      'code_expired',
    );
  });

  it('closed: nobody new', async () => {
    const w = await start('closed');
    const refused = await w.signIn(await testDevice());
    expect(refused.status).toBe(403);
    expect(codeOf(refused.body)).toBe('registration_closed');
  });

  it('registers the named owner and deputy active in every mode, or nobody could approve anybody', async () => {
    for (const mode of ['approval', 'invite', 'closed'] as const) {
      const w = await start(mode);
      for (const moderator of [w.owner, w.deputy]) {
        const account = await w.as(moderator, 'GET', '/v1/auth/account');
        expect(account.body, mode).toMatchObject({ registrationState: 'active' });
      }
      await w.close();
      world = undefined;
    }
  });
});

describe('a moderator’s key named AFTER its account registered (#891’s review)', () => {
  it('activates the pending account at its next sign-in, and logs it — a rider’s pending account stays pending', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oyl-instance-owner-late-'));
    const path = join(directory, 'instance.sqlite');
    const store = await openSqlStore(path);
    cleanups.push(async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    });
    let ms = 1_790_000_000_000;
    const owner = await testDevice();
    const rider = await testDevice();
    const identityWith = (moderators: { owner?: string }) =>
      createIdentity({
        store,
        origin: TEST_ORIGIN,
        now: () => ms,
        registration: 'approval',
        moderators,
        limits: { ...DEFAULT_LIMITS, registrationPerAddress: { limit: 100, windowMs: 60_000 } },
      });
    const signIn = async (identity: ReturnType<typeof createIdentity>, device: TestDevice) => {
      ms += 60_000;
      const challenge = await identity.challenge(device.publicKey, null);
      if (!challenge.ok) throw new Error(challenge.code);
      const signed = await identity.signIn(await device.statement(challenge.value.nonce), {}, null);
      if (!signed.ok) throw new Error(signed.code);
      return signed.value;
    };

    // The operator has not set OYL_INSTANCE_OWNER_KEY yet: the owner waits.
    const before = identityWith({});
    const first = await signIn(before, owner);
    expect(first.registrationState).toBe('pending');
    const riderFirst = await signIn(before, rider);
    expect(riderFirst.registrationState).toBe('pending');

    // The setting is set, and the instance restarted.
    const after = identityWith({ owner: owner.publicKey });
    const again = await signIn(after, owner);
    expect(again.athleteId).toBe(first.athleteId);
    expect(again.registrationState).toBe('active');
    expect((await signIn(after, rider)).registrationState).toBe('pending');

    const fresh = await openSqlStore(path);
    try {
      expect(await fresh.getAthlete(first.athleteId)).toMatchObject({
        registrationState: 'active',
        activatedAt: Math.floor(ms / 1000) - 60,
      });
      expect(await fresh.listModerationLog()).toEqual([
        expect.objectContaining({
          action: 'activate_moderator_key',
          actorAthleteId: first.athleteId,
          targetAthleteId: first.athleteId,
        }),
      ]);
    } finally {
      await fresh.close();
    }
    // And the owner can now moderate: the rider waiting is theirs to approve.
    expect(
      (
        await after.moderation.act(first.athleteId, 'approve_registration', riderFirst.athleteId, {
          reason: 'Known',
        })
      ).ok,
    ).toBe(true);
  });
});

describe('the approval queue (#775): the owner and the deputy decide, and the log records it', () => {
  it('lists pending riders, approves one and refuses another, each decision logged', async () => {
    const w = await start('approval');
    const first = await w.signIn(await testDevice(), { displayName: 'Anna', confirmsAdult: true });
    const secondDevice = await testDevice();
    w.clock.ms += 1000; // oldest first: the queue is in the order riders asked
    const second = await w.signIn(secondDevice, { displayName: 'Spam' });
    const anna = first.body.athleteId as string;
    const spam = second.body.athleteId as string;

    const queue = await w.as(w.deputy, 'GET', '/v1/moderation/registrations');
    expect(queue.body).toEqual({
      registrations: [
        {
          athleteId: anna,
          displayName: 'Anna',
          createdAt: expect.any(Number) as number,
          adultConfirmed: true,
        },
        {
          athleteId: spam,
          displayName: 'Spam',
          createdAt: expect.any(Number) as number,
          adultConfirmed: false,
        },
      ],
    });

    const approved = await w.as(w.deputy, 'POST', `/v1/moderation/registrations/${anna}/approve`, {
      reason: 'Club member',
    });
    expect(approved.status).toBe(200);
    const refused = await w.as(w.owner, 'POST', `/v1/moderation/registrations/${spam}/refuse`, {
      reason: 'Advertising',
    });
    expect(refused.status).toBe(200);

    expect(
      (await w.freshRead((store) => store.listModerationLog())).map(
        ({ action, actorAthleteId, targetAthleteId, reason }) => ({
          action,
          actorAthleteId,
          targetAthleteId,
          reason,
        }),
      ),
    ).toEqual([
      {
        action: 'approve_registration',
        actorAthleteId: w.deputy.athleteId,
        targetAthleteId: anna,
        reason: 'Club member',
      },
      {
        action: 'refuse_registration',
        actorAthleteId: w.owner.athleteId,
        targetAthleteId: spam,
        reason: 'Advertising',
      },
    ]);
    expect(await w.freshRead((store) => store.getAthlete(anna))).toMatchObject({
      registrationState: 'active',
      // Active from when it was approved, which is what an account's age counts from (#891).
      activatedAt: Math.floor(w.clock.ms / 1000),
    });
    expect((await w.freshRead((store) => store.getAthlete(spam)))?.activatedAt).toBeNull();
    expect((await w.as(w.owner, 'GET', '/v1/moderation/registrations')).body).toEqual({
      registrations: [],
    });
    // The refused rider's session ended, and every sign-in is refused from now on.
    expect(
      (await w.call('GET', '/v1/auth/session', { token: second.body.sessionToken as string }))
        .status,
    ).toBe(401);
    const back = await w.signIn(secondDevice);
    expect(back.status).toBe(403);
    expect(codeOf(back.body)).toBe('registration_refused');
    // A decision is made once.
    expect(
      (
        await w.as(w.owner, 'POST', `/v1/moderation/registrations/${anna}/approve`, {
          reason: 'Again',
        })
      ).status,
    ).toBe(409);
  });

  it('refuses approval actions to any other account — an approved rider and a pending one — and logs nothing', async () => {
    const w = await start('approval');
    const pending = await w.signIn(await testDevice());
    const pendingToken = pending.body.sessionToken as string;
    const target = (await w.signIn(await testDevice())).body.athleteId as string;
    const approvedRider = await w.rider();
    await w.as(w.owner, 'POST', `/v1/moderation/registrations/${approvedRider.athleteId}/approve`, {
      reason: 'Known',
    });
    const logged = (await w.freshRead((store) => store.listModerationLog())).length;

    for (const path of [
      `/v1/moderation/registrations/${target}/approve`,
      `/v1/moderation/registrations/${target}/refuse`,
    ]) {
      const byRider = await w.as(approvedRider, 'POST', path, { reason: 'Because' });
      expect(byRider.status, path).toBe(404);
      const byPending = await w.call('POST', path, {
        token: pendingToken,
        body: { reason: 'Because' },
      });
      expect(byPending.status, path).toBe(403);
    }
    expect((await w.as(approvedRider, 'GET', '/v1/moderation/registrations')).status).toBe(404);
    expect((await w.freshRead((store) => store.getAthlete(target)))?.registrationState).toBe(
      'pending',
    );
    expect(await w.freshRead((store) => store.listModerationLog())).toHaveLength(logged);
  });
});

describe('a suspension binds every key the athlete holds (#775, ADR 0028 D-6.2)', () => {
  it('refuses both of two linked keys at /auth/session, and ends both sessions', async () => {
    const w = await start('open');
    const first = await testDevice();
    const signedIn = await w.signIn(first);
    const token = signedIn.body.sessionToken as string;
    const athleteId = signedIn.body.athleteId as string;
    // A minute on, so the second key is not added in the second the account was.
    w.clock.ms += 60_000;
    const code = await w.call('POST', '/v1/auth/link-codes', { token });
    const second = await testDevice();
    const linked = await w.call('POST', '/v1/auth/link', {
      body: {
        ...(await second.statement(await w.nonceFor(second), { purpose: LINK_PURPOSE })),
        linkCode: (code.body as { linkCode: string }).linkCode,
      },
    });
    expect(linked.status).toBe(200);
    const secondToken = (await w.signIn(second)).body.sessionToken as string;
    expect(
      (await w.freshRead((store) => store.listDeviceKeys(athleteId))).filter(
        (key) => key.revokedAt === null,
      ),
    ).toHaveLength(2);

    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${athleteId}/suspend`, {
      reason: 'Cheating',
    });

    for (const device of [first, second]) {
      w.clock.ms += 60_000;
      const refused = await w.signIn(device);
      expect(refused.status).toBe(403);
      expect(codeOf(refused.body)).toBe('account_suspended');
    }
    for (const held of [token, secondToken]) {
      expect((await w.call('GET', '/v1/auth/session', { token: held })).status).toBe(401);
    }
  });
});

describe('the 18+ self-declaration (#775, ruling Q5)', () => {
  it('stores the confirmation and its date, at registration or later, and keeps the first', async () => {
    const w = await start('open');
    const atRegistration = await w.signIn(await testDevice(), { confirmsAdult: true });
    const registeredAt = Math.floor(w.clock.ms / 1000);
    expect(
      (await w.freshRead((store) => store.getAthlete(atRegistration.body.athleteId as string)))
        ?.adultConfirmedAt,
    ).toBe(registeredAt);

    const later = await w.signIn(await testDevice());
    const token = later.body.sessionToken as string;
    expect(
      (await w.call('GET', '/v1/auth/account', { token })).body as { adultConfirmedAt: unknown },
    ).toMatchObject({ adultConfirmedAt: null });
    const refused = await w.call('POST', '/v1/auth/adult', { token, body: { confirmed: false } });
    expect(refused.status).toBe(400);
    w.clock.ms += 5_000;
    const confirmedAt = Math.floor(w.clock.ms / 1000);
    expect(
      (await w.call('POST', '/v1/auth/adult', { token, body: { confirmed: true } })).body,
    ).toMatchObject({ adultConfirmedAt: confirmedAt });
    w.clock.ms += 5_000;
    await w.call('POST', '/v1/auth/adult', { token, body: { confirmed: true } });
    expect(
      (await w.freshRead((store) => store.getAthlete(later.body.athleteId as string)))
        ?.adultConfirmedAt,
    ).toBe(confirmedAt);
  });

  it('collects no date of birth: none is stored, and no column could hold one', async () => {
    const w = await start('open');
    const birthday = '1987-06-05';
    await w.signIn(await testDevice(), {
      confirmsAdult: true,
      dateOfBirth: birthday,
      birthDate: birthday,
    });
    expect(await w.databaseBytes()).not.toContain(birthday);
    const database = openDatabase(w.path);
    try {
      const columns = database
        .prepare(
          `SELECT m.name || '.' || c.name AS name FROM sqlite_schema AS m, pragma_table_info(m.name) AS c
           WHERE m.type = 'table'`,
        )
        .all() as { name: string }[];
      expect(columns.length).toBeGreaterThan(0);
      for (const { name } of columns) expect(name).not.toMatch(/birth|[._]dob$|[._]age$/i);
    } finally {
      database.close();
    }
  });
});

describe('public rooms need an eligible account (#775)', () => {
  it('refuses a ticket to a public room until every requirement is met', async () => {
    const w = await start('approval');
    const device = await testDevice();
    const session = await w.signIn(device);
    const athleteId = session.body.athleteId as string;
    await w.freshRead((store: SqlStore) =>
      store.putRoom({
        id: 'public-1',
        kind: 'race',
        visibility: 'public',
        routeSha256: 'a'.repeat(64),
        physicsVersion: 1,
      }),
    );
    await w.as(w.owner, 'POST', `/v1/moderation/registrations/${athleteId}/approve`, {
      reason: 'Known',
    });
    const token = session.body.sessionToken as string;
    const ticket = () =>
      w.call('POST', '/v1/rooms/public-1/ticket', { token, body: { declaredMassKilograms: 70 } });

    const early = await ticket();
    expect(early.status).toBe(403);
    expect(codeOf(early.body)).toBe('not_eligible');
    expect((await w.call('GET', '/v1/auth/account', { token })).body).toMatchObject({
      publicRooms: {
        eligible: false,
        reasons: ['not-confirmed-adult', 'account-too-new', 'too-few-rides'],
      },
    });

    await w.call('POST', '/v1/auth/adult', { token, body: { confirmed: true } });
    await w.freshRead(async (store) => {
      for (const n of [1, 2, 3]) {
        await store.putActivityRecord({
          athleteId,
          contentSha256: String(n).repeat(64),
          signedRecord: new Uint8Array([n]),
          receivedAt: 1,
        });
      }
    });
    w.clock.ms += 7 * 24 * 60 * 60 * 1000;
    const eligible = await ticket();
    expect(eligible.status).toBe(200);

    await w.as(w.owner, 'POST', `/v1/moderation/athletes/${athleteId}/suspend`, {
      reason: 'Cheating',
    });
    expect((await ticket()).status).toBe(401);
  });

  it('counts the account’s age from its approval, not its registration (#891’s review)', async () => {
    const w = await start('approval');
    const session = await w.signIn(await testDevice(), { confirmsAdult: true });
    const athleteId = session.body.athleteId as string;
    const token = session.body.sessionToken as string;
    await w.freshRead(async (store) => {
      for (const n of [1, 2, 3]) {
        await store.putActivityRecord({
          athleteId,
          contentSha256: String(n).repeat(64),
          signedRecord: new Uint8Array([n]),
          receivedAt: 1,
        });
      }
    });
    const week = 7 * 24 * 60 * 60 * 1000;
    w.clock.ms += week; // a week waiting in the queue
    await w.as(w.owner, 'POST', `/v1/moderation/registrations/${athleteId}/approve`, {
      reason: 'Known',
    });
    expect((await w.call('GET', '/v1/auth/account', { token })).body).toMatchObject({
      publicRooms: { eligible: false, reasons: ['account-too-new'] },
    });
    w.clock.ms += week;
    expect((await w.call('GET', '/v1/auth/account', { token })).body).toMatchObject({
      publicRooms: { eligible: true, reasons: [] },
    });
  });
});

describe('account creation is rate-limited per source address (#775)', () => {
  const limited = { ...DEFAULT_LIMITS };

  it(`refuses a fourth new account from one address in an hour, and creates nothing`, async () => {
    const w = await start('approval', { limits: limited });
    for (let n = 0; n < limited.registrationPerAddress.limit; n += 1) {
      expect((await signInFrom(w, await testDevice(), '203.0.113.7')).status).toBe(200);
    }
    const device = await testDevice();
    const over = await signInFrom(w, device, '203.0.113.7');
    expect(over.status).toBe(429);
    expect(codeOf(over.body)).toBe('rate_limited');
    expect(await w.freshRead((store) => store.findDeviceKey(device.publicKey))).toBeUndefined();

    // Another address has an allowance of its own…
    expect((await signInFrom(w, await testDevice(), '198.51.100.1')).status).toBe(200);
    // …a rider who already has an account is not counted…
    expect((await signInFrom(w, w.owner.device, '203.0.113.7')).status).toBe(200);
    // …and the window moves on.
    w.clock.ms += limited.registrationPerAddress.windowMs;
    expect((await signInFrom(w, device, '203.0.113.7')).status).toBe(200);
  });

  it('counts an IPv6 client by its /64, so a fresh address from the same network is the same client', async () => {
    const w = await start('approval', { limits: limited });
    const addresses = ['2001:db8:1:2::5', '2001:db8:1:2:aaaa::6', '2001:0db8:0001:0002::7'];
    for (const address of addresses) {
      expect((await signInFrom(w, await testDevice(), address)).status, address).toBe(200);
    }
    expect((await signInFrom(w, await testDevice(), '2001:db8:1:2:ffff::8')).status).toBe(429);
    expect((await signInFrom(w, await testDevice(), '2001:db8:1:3::5')).status).toBe(200);
  });

  it('counts clients whose address is unknown together, failing closed', async () => {
    const w = await start('approval', { limits: limited });
    for (let n = 0; n < limited.registrationPerAddress.limit; n += 1) {
      expect((await signInFrom(w, await testDevice(), null)).status).toBe(200);
    }
    expect((await signInFrom(w, await testDevice(), null)).status).toBe(429);
  });
});
