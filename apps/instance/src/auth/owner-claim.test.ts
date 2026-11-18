// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The owner's claim** (#2782, ADR 0080 D-3, D-5): a claim code minted for
 * the loopback page, redeemed by a device on the SEALED route
 * `POST /v1/auth/owner-claim`, and confirmed by the owner — after which the
 * owner key is the claimed one, read back through the checks a real request
 * meets: an Operate read, the moderators' queue, registration, the admin
 * pages, the operator's `model-key set`, and an instance restarted on the
 * same file.
 *
 * The loopback page that mints, shows and confirms is #2784's (and its QR
 * #2783's), so these tests call `identity.ownerClaim` where that page will.
 */

import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import { ownerClaimComparisonCode, SEALED_PATH, toHex, type SigningKey } from '@onyourleft/domain';

import { adminRequest, handlerOver, type HandlerOver } from '../admin/admin-testing.ts';
import { secretText } from '../analysis/hosted-key-testing.ts';
import type { Handler } from '../handler.ts';
import { modelKeySet, ownerClaimReset } from '../operator/commands.ts';
import {
  answerTo,
  sealedCall,
  sealFor,
  type SealedAnswer,
  type SealedCallOptions,
} from '../sealed/sealed-testing.ts';
import { sha256 } from '../sealed/sealed.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from './identity-testing.ts';
import {
  createOwnerClaim,
  DEFAULT_OWNER_CLAIM_LIMITS,
  OWNER_CLAIM_LIFETIME_SECONDS,
} from './owner-claim.ts';
import { createRateLimiter } from './rate-limit.ts';

const CLAIM = '/v1/auth/owner-claim';
const MINUTE = 60_000;

let worlds: IdentityInstance[] = [];
let restarted: HandlerOver[] = [];
afterEach(async () => {
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
  restarted = [];
});

async function world(
  options: Parameters<typeof startIdentityInstance>[0] = {},
): Promise<IdentityInstance> {
  const made = await startIdentityInstance(options);
  worlds.push(made);
  return made;
}

/** The loopback page's mint (#2784), as it will call it: a code, or a refusal. */
async function mint(w: IdentityInstance): Promise<string> {
  const minted = await w.identity.ownerClaim.mint('admin_loopback');
  if (minted === 'claimed') throw new Error('the instance is claimed');
  return minted.code;
}

/** The tablet's redemption: sealed to the instance, signed by `device`, as the app sends it. */
function redeem(
  w: IdentityInstance,
  device: TestDevice,
  claimCode: unknown,
): Promise<SealedAnswer> {
  return sealedCall(w, {
    method: 'POST',
    path: CLAIM,
    body: { publicKey: device.publicKey, claimCode },
    signer: device.signingKey,
  });
}

/** One sealed call to `handler` — a restarted instance's — sealed to the world's keys on its file. */
async function sealedVia(
  handler: Handler,
  w: IdentityInstance,
  options: SealedCallOptions,
): Promise<SealedAnswer> {
  const sealed = await sealFor(w, options);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  const response = await handler(
    new Request(`http://instance.invalid${SEALED_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sealed.envelope),
    }),
    { address: null },
  );
  return answerTo(sealed, response);
}

/** The opened inner answer's status, and its body byte for byte. */
function innerOf(answer: SealedAnswer): { status: number; body: string } {
  if (answer.reply === undefined) throw new Error(`not sealed: ${answer.raw}`);
  return { status: answer.reply.status, body: toHex(answer.reply.body) };
}

async function signedIn(w: IdentityInstance, device: TestDevice): Promise<string> {
  const answer = await w.signIn(device);
  expect(answer.status).toBe(200);
  return answer.body.sessionToken as string;
}

/** An Operate read, sealed with `token`'s session and signed by `signer`: its inner status. */
async function operateStatus(
  handler: Handler,
  w: IdentityInstance,
  token: string,
  signer: SigningKey,
): Promise<number> {
  const answer = await sealedVia(handler, w, {
    method: 'GET',
    path: '/v1/operate/status',
    token,
    signer,
  });
  return innerOf(answer).status;
}

/** Every row of `table`, read on a fresh connection to the world's file. */
function rowsOf(w: IdentityInstance, table: string): Record<string, unknown>[] {
  const database = openDatabase(w.path);
  try {
    return database.prepare(`SELECT * FROM ${table}`).all();
  } finally {
    database.close();
  }
}

/** A claim code written straight into the file — where the page's mint would refuse to make one. */
function plantCode(w: IdentityInstance, sha: string): void {
  const database = openDatabase(w.path);
  try {
    const at = Math.floor(w.clock.ms / 1000);
    database
      .prepare(`INSERT INTO owner_claim_code VALUES (?, ?, ?, NULL, NULL, NULL)`)
      .run(sha, at, at + OWNER_CLAIM_LIFETIME_SECONDS);
  } finally {
    database.close();
  }
}

const normalisedSha = (code: string): string =>
  createHash('sha256').update(code.toLowerCase().replace(/[\s-]/g, '')).digest('hex');

/** Redeem, then confirm the six digits the TABLET derives on its own (D-5). */
async function claim(w: IdentityInstance, device: TestDevice): Promise<void> {
  const code = await mint(w);
  expect(innerOf(await redeem(w, device, code)).status).toBe(200);
  const tablets = await ownerClaimComparisonCode(sha256, code, device.publicKey);
  expect(await w.identity.ownerClaim.confirm(tablets, 'admin_loopback')).toBe('confirmed');
}

describe('the comparison code, against an independent SHA-256 (ADR 0080 D-5)', () => {
  it('is the first four bytes of SHA-256 over the label, the normalised code and the key, mod a million', async () => {
    const key = 'cd'.repeat(32);
    const digest = createHash('sha256')
      .update(`oyl-owner-claim-compare-v1\nabcdefghjkmnpqrs\n${key}`)
      .digest();
    const expected = String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
    expect(await ownerClaimComparisonCode(sha256, 'ABCD-EFGH-JKMN-PQRS', key)).toBe(expected);
  });
});

describe('the owner’s claim, read back across a restart (#2782, ADR 0080 D-3)', () => {
  it('makes the claimed key the owner: a restarted instance on the same file lets it read Operate, and refuses a second device', async () => {
    const w = await world();
    const owner = await testDevice();
    const other = await testDevice();
    const code = await mint(w);

    const redeemed = await redeem(w, owner, code);
    expect(innerOf(redeemed).status).toBe(200);
    expect(redeemed.body).toEqual({ claim: 'pending' });
    // Pending, not yet the owner: the instance's six digits are the tablet's own.
    const pending = await w.identity.ownerClaim.pending();
    expect(pending?.deviceKey).toBe(owner.publicKey);
    expect(pending?.comparisonCode).toBe(
      await ownerClaimComparisonCode(sha256, code, owner.publicKey),
    );
    expect(await w.freshRead((store) => store.claimedOwnerKey())).toBeUndefined();

    expect(
      await w.identity.ownerClaim.confirm(pending?.comparisonCode ?? '', 'admin_loopback'),
    ).toBe('confirmed');
    expect(await w.identity.ownerClaim.pending()).toBeUndefined();

    const ownerToken = await signedIn(w, owner);
    const otherToken = await signedIn(w, other);

    // A new handler over the same file, with no OYL_INSTANCE_OWNER_KEY: what
    // it reads is what the claim wrote, not anything the first one held.
    const after = await handlerOver(w.path, w.clock, {});
    restarted.push(after);
    expect(await operateStatus(after.handler, w, ownerToken, owner.signingKey)).toBe(200);
    expect(await operateStatus(after.handler, w, otherToken, other.signingKey)).toBe(404);
    expect(await after.store.claimedOwnerKey()).toBe(owner.publicKey);
  });

  it('takes effect without a restart: the running instance’s next Operate read is the owner’s', async () => {
    const w = await world();
    const owner = await testDevice();
    const token = await signedIn(w, owner);
    expect(await operateStatus(w.instance.handler, w, token, owner.signingKey)).toBe(404);
    await claim(w, owner);
    expect(await operateStatus(w.instance.handler, w, token, owner.signingKey)).toBe(200);
  });

  it('lets OYL_INSTANCE_OWNER_KEY win over a claimed key when both are there (Q-2)', async () => {
    const w = await world();
    const claimed = await testDevice();
    const named = await testDevice();
    await claim(w, claimed);
    const claimedToken = await signedIn(w, claimed);
    const namedToken = await signedIn(w, named);
    const after = await handlerOver(w.path, w.clock, { owner: named.publicKey });
    restarted.push(after);
    expect(await operateStatus(after.handler, w, namedToken, named.signingKey)).toBe(200);
    expect(await operateStatus(after.handler, w, claimedToken, claimed.signingKey)).toBe(404);
  });
});

describe('one refusal for every reason (ADR 0080 D-3)', () => {
  it('answers a used code, an expired code and a code after a claim with the same status and the same bytes', async () => {
    const w = await world();
    const first = await testDevice();
    const second = await testDevice();

    // Used: redeemed once, then again.
    const used = await mint(w);
    expect(innerOf(await redeem(w, first, used)).status).toBe(200);
    const again = innerOf(await redeem(w, second, used));

    // Expired: minted (which voids the pending claim), then left past its ten minutes.
    const late = await mint(w);
    w.clock.ms += 10 * MINUTE;
    const expired = innerOf(await redeem(w, second, late));

    // After a claim: a live, unredeemed code is still refused once an owner is claimed.
    await claim(w, first);
    const spare = 'abcd-efgh-jkmn-pqrs';
    plantCode(w, normalisedSha(spare));
    const afterClaim = innerOf(await redeem(w, second, spare));

    expect(again.status).toBe(401);
    expect(expired).toEqual(again);
    expect(afterClaim).toEqual(again);
    expect(JSON.parse(Buffer.from(again.body, 'hex').toString('utf8'))).toEqual({
      error: {
        code: 'claim_refused',
        message:
          'That claim code was not accepted. Make a new one on the setup page on the server machine and scan it again.',
      },
    });
    // Nothing a refusal touched changed the owner, and the planted code is unredeemed.
    expect(await w.freshRead((store) => store.claimedOwnerKey())).toBe(first.publicKey);
    expect(rowsOf(w, 'owner_claim_code')).toEqual([
      expect.objectContaining({ redeemed_at: null, device_key: null }),
    ]);
  });

  it('refuses an unknown code, a code that is not the shape of one, the deputy’s key and a second claim while one waits — in the same words', async () => {
    const deputy = await testDevice();
    const w = await world({ moderators: { deputy: deputy.publicKey } });
    const first = await testDevice();
    const second = await testDevice();
    const code = await mint(w);
    const deputyTries = innerOf(await redeem(w, deputy, code));
    const unknown = innerOf(await redeem(w, second, 'abcd-efgh-jkmn-pqrs'));
    const malformed = innerOf(await redeem(w, second, 'not a code'));
    expect(innerOf(await redeem(w, first, code)).status).toBe(200);
    // One pending claim at a time, whichever code the second one brings.
    plantCode(w, normalisedSha('qrst-uvwx-yz23-4567'));
    const whilePending = innerOf(await redeem(w, second, 'qrst-uvwx-yz23-4567'));
    for (const answer of [unknown, malformed, whilePending]) expect(answer).toEqual(deputyTries);
    expect(deputyTries.status).toBe(401);
    // A body that is not a claim is a validation failure naming the field, never the value.
    const notAString = await redeem(w, second, 12345);
    expect(innerOf(notAString).status).toBe(400);
    expect(notAString.body).toEqual({
      error: expect.objectContaining({
        code: 'validation_failed',
        fields: [{ field: 'claimCode', problem: 'must be a string' }],
      }) as unknown,
    });
    expect((await w.identity.ownerClaim.pending())?.deviceKey).toBe(first.publicKey);
  });
});

describe('the claim route is never plaintext (ADR 0080 D-3, ADR 0047 D-7)', () => {
  it('refuses an unsealed POST sealed_required before reading it, and records nothing', async () => {
    const w = await world();
    const device = await testDevice();
    const code = await mint(w);
    const plain = await w.call('POST', CLAIM, {
      plain: true,
      body: { publicKey: device.publicKey, claimCode: code },
    });
    expect(plain.status).toBe(403);
    expect((plain.body as { error: { code: string } }).error.code).toBe('sealed_required');
    expect(await w.identity.ownerClaim.pending()).toBeUndefined();
    expect(rowsOf(w, 'owner_claim_code')).toEqual([
      expect.objectContaining({ redeemed_at: null, device_key: null, comparison_code: null }),
    ]);
    // The same code still redeems sealed: the plaintext attempt spent nothing.
    expect(innerOf(await redeem(w, device, code)).status).toBe(200);
  });

  it('refuses it on an instance with no keys too, where nothing is sealed', async () => {
    const w = await world({ keyless: true });
    const device = await testDevice();
    const code = await mint(w);
    const plain = await w.call('POST', CLAIM, {
      body: { publicKey: device.publicKey, claimCode: code },
    });
    expect(plain.status).toBe(403);
    expect((plain.body as { error: { code: string } }).error.code).toBe('sealed_required');
    expect(await w.identity.ownerClaim.pending()).toBeUndefined();
  });
});

describe('with OYL_INSTANCE_OWNER_KEY set, the environment is the owner (ADR 0080 D-3, Q-2)', () => {
  it('mints no code, refuses a claim and a confirmation, and keeps the named key the owner', async () => {
    const named = await testDevice();
    const claimer = await testDevice();
    const w = await world({ moderators: { owner: named.publicKey } });
    expect(await w.identity.ownerClaim.mint('admin_loopback')).toBe('claimed');
    expect(rowsOf(w, 'owner_claim_code')).toEqual([]);

    // A live code written by hand is refused all the same.
    const code = 'abcd-efgh-jkmn-pqrs';
    plantCode(w, normalisedSha(code));
    const answer = innerOf(await redeem(w, claimer, code));
    expect(answer.status).toBe(401);
    expect(Buffer.from(answer.body, 'hex').toString('utf8')).toContain('claim_refused');
    expect(rowsOf(w, 'owner_claim_code')).toEqual([
      expect.objectContaining({ redeemed_at: null, device_key: null }),
    ]);
    expect(
      await w.identity.ownerClaim.confirm(
        await ownerClaimComparisonCode(sha256, code, claimer.publicKey),
        'admin_loopback',
      ),
    ).toBe('none');
    expect(await w.freshRead((store) => store.claimedOwnerKey())).toBeUndefined();

    const namedToken = await signedIn(w, named);
    const claimerToken = await signedIn(w, claimer);
    expect(await operateStatus(w.instance.handler, w, namedToken, named.signingKey)).toBe(200);
    expect(await operateStatus(w.instance.handler, w, claimerToken, claimer.signingKey)).toBe(404);
  });
});

describe('the claim code is never stored in clear (ADR 0069 D-1, ADR 0080 D-3)', () => {
  it('keeps only its SHA-256, before and after it is redeemed, anywhere in the database’s files', async () => {
    const w = await world();
    const device = await testDevice();
    const code = await mint(w);
    const forms = [code, code.replace(/-/g, ''), code.toUpperCase()];
    const check = async (): Promise<void> => {
      const rows = rowsOf(w, 'owner_claim_code');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.code_sha256).toBe(normalisedSha(code));
      const bytes = await w.databaseBytes();
      for (const form of forms) {
        expect(JSON.stringify(rows)).not.toContain(form);
        expect(bytes.includes(form), form).toBe(false);
      }
    };
    await check();
    expect(innerOf(await redeem(w, device, code)).status).toBe(200);
    await check();
  });
});

describe('the owner’s decision on the loopback page (ADR 0080 D-5)', () => {
  it('confirms only the six digits the pending claim holds, and logs each decision naming no code or key', async () => {
    const w = await world();
    const device = await testDevice();
    const code = await mint(w);
    await redeem(w, device, code);
    const right = await ownerClaimComparisonCode(sha256, code, device.publicKey);
    const wrong = right === '000000' ? '000001' : '000000';
    expect(await w.identity.ownerClaim.confirm(wrong, 'admin_loopback')).toBe('none');
    expect(await w.freshRead((store) => store.claimedOwnerKey())).toBeUndefined();
    expect(await w.identity.ownerClaim.confirm(right, 'admin_loopback')).toBe('confirmed');
    expect(await w.freshRead((store) => store.claimedOwnerKey())).toBe(device.publicKey);
    // Confirming deleted the code: it cannot be redeemed again.
    expect(rowsOf(w, 'owner_claim_code')).toEqual([]);

    const log = rowsOf(w, 'operator_log').map((row) => ({
      source: row.source,
      actor: row.actor_athlete_id,
      action: row.action,
      detail: row.detail,
      outcome: row.outcome,
    }));
    expect(log).toEqual([
      {
        source: 'admin_loopback',
        actor: null,
        action: 'owner_claim_code_minted',
        detail: null,
        outcome: 'done',
      },
      {
        source: 'admin_loopback',
        actor: null,
        action: 'owner_claim_confirmed',
        detail: null,
        outcome: 'refused',
      },
      {
        source: 'admin_loopback',
        actor: null,
        action: 'owner_claim_confirmed',
        detail: null,
        outcome: 'done',
      },
    ]);
  });

  it('discards a pending claim: its code is void, and a new code voids the one before it', async () => {
    const w = await world();
    const stranger = await testDevice();
    const owner = await testDevice();
    const code = await mint(w);
    await redeem(w, stranger, code);
    expect(await w.identity.ownerClaim.discard('admin_loopback')).toBe(true);
    expect(await w.identity.ownerClaim.pending()).toBeUndefined();
    expect(innerOf(await redeem(w, owner, code)).status).toBe(401);
    expect(await w.identity.ownerClaim.discard('admin_loopback')).toBe(false);

    const replaced = await mint(w);
    const minted = await w.identity.ownerClaim.mint('admin_loopback');
    if (minted === 'claimed') throw new Error('claimed');
    expect(innerOf(await redeem(w, owner, replaced)).status).toBe(401);
    expect(innerOf(await redeem(w, owner, minted.code)).status).toBe(200);
    const entries = rowsOf(w, 'operator_log').map((row) => [row.action, row.detail, row.outcome]);
    expect(entries).toEqual([
      ['owner_claim_code_minted', null, 'done'],
      ['owner_claim_discarded', null, 'done'],
      ['owner_claim_discarded', null, 'refused'],
      ['owner_claim_code_minted', null, 'done'],
      ['owner_claim_code_minted', 'voided_unused', 'done'],
    ]);
  });

  it('mints nothing once an owner is claimed', async () => {
    const w = await world();
    await claim(w, await testDevice());
    expect(await w.identity.ownerClaim.mint('admin_loopback')).toBe('claimed');
    expect(rowsOf(w, 'owner_claim_code')).toEqual([]);
  });

  it('keeps no dead code: a code minted after the last one ended is the only row, and voided nothing', async () => {
    const w = await world();
    const old = await mint(w);
    w.clock.ms += 11 * MINUTE;
    const fresh = await mint(w);
    expect(rowsOf(w, 'owner_claim_code').map((row) => row.code_sha256)).toEqual([
      normalisedSha(fresh),
    ]);
    expect(rowsOf(w, 'owner_claim_code')).not.toContainEqual(
      expect.objectContaining({ code_sha256: normalisedSha(old) }),
    );
    expect(rowsOf(w, 'operator_log').at(-1)?.detail).toBeNull();
  });

  it('refuses to confirm a claim left pending when OYL_INSTANCE_OWNER_KEY is set after it was made (Q-2)', async () => {
    const w = await world();
    const claimer = await testDevice();
    const code = await mint(w);
    expect(innerOf(await redeem(w, claimer, code)).status).toBe(200);
    // The instance restarted with the variable set: its claim is built over the same file.
    const store = await openSqlStore(w.path);
    try {
      const named = createOwnerClaim({
        store,
        now: () => w.clock.ms,
        moderators: { owner: 'ab'.repeat(32) },
        limiters: {
          perAddress: createRateLimiter(DEFAULT_OWNER_CLAIM_LIMITS.perAddress, () => w.clock.ms),
          overall: createRateLimiter(DEFAULT_OWNER_CLAIM_LIMITS.overall, () => w.clock.ms),
        },
      });
      expect(
        await named.confirm(
          await ownerClaimComparisonCode(sha256, code, claimer.publicKey),
          'admin_loopback',
        ),
      ).toBe('none');
    } finally {
      await store.close();
    }
    expect(await w.freshRead((store) => store.claimedOwnerKey())).toBeUndefined();
  });
});

describe('a redemption is rate-limited as an admin sign-in is (ADR 0069 D-4)', () => {
  it('refuses rate_limited past the per-address allowance, before the code is looked at', async () => {
    const w = await world({
      ownerClaimLimits: {
        perAddress: { limit: 2, windowMs: 60_000 },
        overall: { limit: 100, windowMs: 60_000 },
      },
    });
    const device = await testDevice();
    const code = await mint(w);
    await redeem(w, device, 'abcd-efgh-jkmn-pqrs');
    await redeem(w, device, 'abcd-efgh-jkmn-pqrs');
    const third = innerOf(await redeem(w, device, code));
    expect(third.status).toBe(429);
    expect(await w.identity.ownerClaim.pending()).toBeUndefined();
    w.clock.ms += MINUTE;
    expect(innerOf(await redeem(w, device, code)).status).toBe(200);
  });

  it('counts everybody together, too', async () => {
    const w = await world({
      ownerClaimLimits: {
        perAddress: { limit: 100, windowMs: 60_000 },
        overall: { limit: 1, windowMs: 60_000 },
      },
    });
    const device = await testDevice();
    const code = await mint(w);
    await redeem(w, device, 'abcd-efgh-jkmn-pqrs');
    expect(innerOf(await redeem(w, device, code)).status).toBe(429);
  });
});

describe('every owner check reads the claimed key (ADR 0080 D-3)', () => {
  it('registers the claimed key active under approval, as the owner, and makes it the sole moderator', async () => {
    const w = await world({ registration: 'approval' });
    const owner = await testDevice();
    const rider = await testDevice();
    await claim(w, owner);
    const token = await signedIn(w, owner);
    const account = await w.call('GET', '/v1/auth/account', { token });
    expect(account.body).toEqual(
      expect.objectContaining({ registrationState: 'active', moderatorRole: 'owner' }),
    );
    const queue = await w.call('GET', '/v1/moderation/reports', { token });
    expect(queue.status).toBe(200);
    expect((queue.body as { soleModerator: boolean }).soleModerator).toBe(true);
    // Anybody else still waits for approval.
    const riderToken = await signedIn(w, rider);
    const riders = await w.call('GET', '/v1/auth/account', { token: riderToken });
    expect(riders.body).toEqual(expect.objectContaining({ registrationState: 'pending' }));
  });

  it('activates a pending account at its next sign-in once its key is claimed', async () => {
    const w = await world({ registration: 'approval' });
    const owner = await testDevice();
    const token = await signedIn(w, owner);
    const before = await w.call('GET', '/v1/auth/account', { token });
    expect(before.body).toEqual(expect.objectContaining({ registrationState: 'pending' }));
    await claim(w, owner);
    const again = await signedIn(w, owner);
    const after = await w.call('GET', '/v1/auth/account', { token: again });
    expect(after.body).toEqual(expect.objectContaining({ registrationState: 'active' }));
  });

  it('opens the admin pages to the claimed owner where they said there was no owner', async () => {
    const w = await world({ admin: {} });
    const before = await w.instance.handler(adminRequest('GET', '/admin/sign-in'));
    expect(before.status).toBe(503);
    expect(await before.text()).toContain('no owner has claimed it from the app');
    const owner = await testDevice();
    await claim(w, owner);
    await signedIn(w, owner);
    const after = await w.instance.handler(adminRequest('GET', '/admin/sign-in'));
    expect(after.status).toBe(200);
  });

  it('holds the operator’s hosted model key for the claimed owner’s athlete (ADR 0046 Q9)', async () => {
    const w = await world();
    const owner = await testDevice();
    await claim(w, owner);
    const token = await signedIn(w, owner);
    const account = await w.call('GET', '/v1/auth/account', { token });
    await modelKeySet(
      { database: w.path, blobs: `${w.path}.blobs` },
      {
        url: 'https://models.example/v1',
        model: 'm',
        input: 'sk-test-key\n',
        secret: secretText(7),
        ownerKey: undefined,
      },
    );
    const held = await w.freshRead((store) => store.getHostedModelKey());
    expect(held?.athleteId).toBe((account.body as { athleteId: string }).athleteId);
  });
});

describe('operator owner-claim reset (ADR 0080 D-3)', () => {
  it('clears the claimed key at once, ends every admin session, and lets the instance be claimed again', async () => {
    const w = await world();
    const owner = await testDevice();
    await claim(w, owner);
    const token = await signedIn(w, owner);
    expect(await operateStatus(w.instance.handler, w, token, owner.signingKey)).toBe(200);
    const database = openDatabase(w.path);
    try {
      const athlete = (
        database
          .prepare('SELECT athlete_id FROM device_key WHERE public_key = ?')
          .get(owner.publicKey) as { athlete_id: string }
      ).athlete_id;
      database
        .prepare(
          `INSERT INTO admin_session VALUES (?, ?, ?, 'loopback', 'code', ?, 1, 1, 9999999999)`,
        )
        .run('a2'.repeat(32), athlete, owner.publicKey, 'a3'.repeat(32));
    } finally {
      database.close();
    }

    const report = await ownerClaimReset({ database: w.path, blobs: `${w.path}.blobs` });
    expect(report).toEqual({
      command: 'owner-claim reset',
      cleared: true,
      adminSessionsEnded: 1,
      ownerKeyFromEnvironment: false,
    });
    // The running instance reads it on the next request: no restart.
    expect(await operateStatus(w.instance.handler, w, token, owner.signingKey)).toBe(404);
    expect(rowsOf(w, 'admin_session')).toEqual([]);
    expect(rowsOf(w, 'operator_log').at(-1)).toEqual(
      expect.objectContaining({
        source: 'cli',
        actor_athlete_id: null,
        action: 'owner_claim_reset',
        detail: 'cleared,sessions_ended=1',
        outcome: 'done',
      }),
    );
    // Unclaimed again: a new claim can be made.
    await claim(w, owner);
    expect(await operateStatus(w.instance.handler, w, token, owner.signingKey)).toBe(200);

    const nothing = await ownerClaimReset(
      { database: w.path, blobs: `${w.path}.blobs` },
      { ownerKey: 'ab'.repeat(32) },
    );
    expect(nothing.cleared).toBe(true);
    expect(nothing.ownerKeyFromEnvironment).toBe(true);
    const twice = await ownerClaimReset({ database: w.path, blobs: `${w.path}.blobs` });
    expect(twice.cleared).toBe(false);
    expect(rowsOf(w, 'operator_log').at(-1)?.detail).toBe('none_claimed,sessions_ended=0');
  });
});

describe('review fixes on #2811', () => {
  it('holds no client address once the rate-limit window has passed and the sweep has run', async () => {
    const w = await world();
    const device = await testDevice();
    const code = await mint(w);
    await redeem(w, device, code);
    expect(w.identity.heldRateLimitKeys()).toBeGreaterThan(0);
    w.clock.ms += 2 * MINUTE;
    w.identity.sweepRateLimits();
    expect(w.identity.heldRateLimitKeys()).toBe(0);
  });

  it('refuses a signed-in device claiming a key it does not hold, and leaves no pending claim', async () => {
    const w = await world();
    const signer = await testDevice();
    const other = await testDevice();
    const token = await signedIn(w, signer);
    const code = await mint(w);
    const answer = await sealedCall(w, {
      method: 'POST',
      path: CLAIM,
      body: { publicKey: other.publicKey, claimCode: code },
      token,
      signer: signer.signingKey,
    });
    expect(innerOf(answer).status).toBe(401);
    expect(await w.identity.ownerClaim.pending()).toBeUndefined();
  });

  it('lets a signed-in device claim its own key', async () => {
    const w = await world();
    const signer = await testDevice();
    const token = await signedIn(w, signer);
    const code = await mint(w);
    const answer = await sealedCall(w, {
      method: 'POST',
      path: CLAIM,
      body: { publicKey: signer.publicKey, claimCode: code },
      token,
      signer: signer.signingKey,
    });
    expect(innerOf(answer).status).toBe(200);
  });

  it('lets a pending claim lapse with its code: it is neither shown nor confirmable after ten minutes', async () => {
    const w = await world();
    const device = await testDevice();
    const code = await mint(w);
    await redeem(w, device, code);
    const digits = await ownerClaimComparisonCode(sha256, code, device.publicKey);
    w.clock.ms += 10 * MINUTE + 1000;
    expect(await w.identity.ownerClaim.pending()).toBeUndefined();
    expect(await w.identity.ownerClaim.confirm(digits, 'admin_loopback')).toBe('none');
    expect(await w.freshRead((store) => store.claimedOwnerKey())).toBeUndefined();
  });
});
