// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Account recovery rebuilt (#1194, ADR 0047 D-8): up to two recovery
 * addresses, each held for a week; `/confirm`'s check order; `/clear`; the
 * full reset; `recover`'s reset and *revoke every other key*; the removal
 * rule and the re-check at redemption — end to end through the real listener
 * and `POST /v1/sealed`, every write read back through a FRESH store.
 *
 * The attackers are D-8's table's columns: **(A)** a key the edge added and
 * **(B)** a thief's unlocked device — each a live device key of the rider's,
 * linked with a code, and nothing more; **(C)** B plus a recovery code in
 * force; **(D)** B plus the rider's mail for an established address; **(E)**
 * the session token alone, which seals with a key of its own. A and B are the
 * same thing cryptographically, so each row plays both through one helper.
 *
 * **The invariant**: with a device key alone (A, B) or a token alone (E), no
 * route removes or disables an established address or the codes in force.
 * Every attacker test reads `recovery_email` and `recovery_code` back
 * afterwards. Where C or D succeed, the test says it is residue R4.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { ERASE_ACCOUNT_PURPOSE, LINK_PURPOSE, RECOVER_PURPOSE } from '@onyourleft/domain';

import { codeOf as sealedCodeOf, sealedCall } from '../sealed/sealed-testing.ts';
import type { EmailRecoveryToken, RecoveryCode, RecoveryEmail } from '../store/sql-store.ts';
import { sha256Hex } from './crypto.ts';
import { RECOVERY_ADDRESS_HOLD_SECONDS } from './identity.ts';
import {
  startIdentityInstance,
  TEST_ORIGIN,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from './identity-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function start(
  options: Parameters<typeof startIdentityInstance>[0] = {},
): Promise<IdentityInstance> {
  world = await startIdentityInstance({ emailRecovery: true, ...options });
  return world;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_MS = RECOVERY_ADDRESS_HOLD_SECONDS * 1000;

/** A signed-in device of an athlete. */
interface Key {
  readonly device: TestDevice;
  readonly token: string;
  readonly athleteId: string;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const codeIn = (answer: Answer): unknown =>
  (answer.body as { error?: { code?: unknown } } | null)?.error?.code;

async function register(w: IdentityInstance): Promise<Key & { recoveryCodes: string[] }> {
  const device = await testDevice();
  const signed = await w.signIn(device);
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return {
    device,
    token: signed.body.sessionToken as string,
    athleteId: signed.body.athleteId as string,
    recoveryCodes: signed.body.recoveryCodes as string[],
  };
}

/** A sealed request by `key`, signed by its own device (the world seals every sealed-only route). */
function call(
  w: IdentityInstance,
  key: Key,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  return w.call(method, path, { token: key.token, ...(body === undefined ? {} : { body }) });
}

/** A second device of `minter`'s athlete, linked with a code `minter` minted — A or B. */
async function linked(w: IdentityInstance, minter: Key): Promise<Key> {
  const minted = await call(w, minter, 'POST', '/v1/auth/link-codes', {});
  expect(minted.status, JSON.stringify(minted.body)).toBe(200);
  const joining = await testDevice();
  const statement = await joining.statement(await w.nonceFor(joining), {
    purpose: LINK_PURPOSE,
    issuedAt: Math.floor(w.clock.ms / 1000),
  });
  const joined = await w.call('POST', '/v1/auth/link', {
    body: { ...statement, linkCode: (minted.body as { linkCode: string }).linkCode },
  });
  expect(joined.status, JSON.stringify(joined.body)).toBe(200);
  const signed = await w.signIn(joining);
  return {
    device: joining,
    token: signed.body.sessionToken as string,
    athleteId: signed.body.athleteId as string,
  };
}

/** `key` gives `address`; answers the code mailed for it. */
async function give(w: IdentityInstance, key: Key, address: string): Promise<string> {
  const given = await call(w, key, 'POST', '/v1/auth/recovery-email', { address });
  expect(given.status, JSON.stringify(given.body)).toBe(204);
  const mailed = w.confirmations.at(-1);
  expect(mailed?.address).toBe(address);
  return mailed!.token;
}

function confirm(w: IdentityInstance, key: Key, token: string): Promise<Answer> {
  return call(w, key, 'POST', '/v1/auth/recovery-email/confirm', { token });
}

/** `key` gives and confirms `address`: bound, held, with `key` as its binder. */
async function bind(w: IdentityInstance, key: Key, address: string): Promise<void> {
  const answer = await confirm(w, key, await give(w, key, address));
  expect(answer.status, JSON.stringify(answer.body)).toBe(204);
}

/** The rider's ways back, as the store holds them: every address and every code. */
async function waysBack(
  w: IdentityInstance,
  athleteId: string,
): Promise<{ addresses: readonly RecoveryEmail[]; codes: readonly RecoveryCode[] }> {
  return w.freshRead(async (store) => ({
    addresses: await store.listRecoveryEmails(athleteId),
    codes: await store.listRecoveryCodes(athleteId),
  }));
}

const tokens = (w: IdentityInstance, athleteId: string): Promise<readonly EmailRecoveryToken[]> =>
  w.freshRead((store) => store.listEmailRecoveryTokens(athleteId));

/** Ask for a recovery mail; answers the code mailed, if one was. */
async function requestMail(w: IdentityInstance, address: string): Promise<string | undefined> {
  const before = w.mail.length;
  const asked = await w.call('POST', '/v1/auth/recover/email', { body: { address } });
  expect(asked.status).toBe(204);
  return w.mail.length > before ? w.mail.at(-1)!.token : undefined;
}

/** `recover` on a NEW device: the sealed request is signed by the key it adds. */
async function recover(
  w: IdentityInstance,
  proof: { recoveryCode?: string; emailToken?: string },
  options: { reset?: boolean; revokeOtherKeys?: boolean } = {},
): Promise<Answer & { device: TestDevice }> {
  const device = await testDevice();
  const statement = await device.statement(await w.nonceFor(device), {
    purpose: RECOVER_PURPOSE,
    issuedAt: Math.floor(w.clock.ms / 1000),
  });
  const answer = await w.call('POST', '/v1/auth/recover', {
    body: { ...statement, ...proof, ...options },
  });
  return { ...answer, device };
}

/** The rider's token, sealed and signed with a key the edge holds: column E. */
async function asTheEdge(
  w: IdentityInstance,
  rider: Key,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const edge = await testDevice();
  return sealedCodeOf(
    await sealedCall(w, {
      method,
      path,
      token: rider.token,
      signer: edge.signingKey,
      ...(body === undefined ? {} : { body }),
    }),
  );
}

/**
 * A rider with ten codes and an ESTABLISHED address of their own, and two
 * more live keys: `a` (the edge's) and `b` (the thief's).
 */
async function riderWithWayBack(w: IdentityInstance): Promise<{
  rider: Key & { recoveryCodes: string[] };
  a: Key;
  b: Key;
  established: string;
}> {
  const rider = await register(w);
  const established = 'rider@example.org';
  await bind(w, rider, established);
  w.clock.ms += HOLD_MS + DAY_MS;
  const a = await linked(w, rider);
  const b = await linked(w, rider);
  return { rider, a, b, established };
}

const ATTACKERS = ['A', 'B'] as const;

describe('the invariant, route by route: a device key alone or a token alone takes no way back (ADR 0047 D-8)', () => {
  for (const column of ATTACKERS) {
    const pick = (keys: { a: Key; b: Key }): Key => (column === 'A' ? keys.a : keys.b);

    it(`Recover, ${column}: a key alone has no secret to recover with, and the ways back stand`, async () => {
      const w = await start();
      const { rider, ...keys } = await riderWithWayBack(w);
      void pick(keys);
      const before = await waysBack(w, rider.athleteId);
      const tried = await recover(
        w,
        { recoveryCode: 'abcd-efgh-jkmn-pqrs' },
        { reset: true, revokeOtherKeys: true },
      );
      expect(codeIn(tried)).toBe('code_unknown');
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
    });

    it(`Ask for a recovery mail, ${column}: the code goes to the rider’s own address, and nothing is removed`, async () => {
      const w = await start();
      const { rider, established } = await riderWithWayBack(w);
      const before = await waysBack(w, rider.athleteId);
      await requestMail(w, established);
      expect(w.mail.at(-1)?.address).toBe(established);
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
    });

    it(`Give a recovery address, ${column}: mails its own address and cancels nobody else’s pending confirmation`, async () => {
      const w = await start();
      const { rider, established, ...keys } = await riderWithWayBack(w);
      const ridersCode = await give(w, rider, 'rider-new@example.org');
      const before = await waysBack(w, rider.athleteId);
      await give(w, pick(keys), 'attacker@example.org');
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
      // The rider's pending confirmation is still there, and still binds.
      expect((await confirm(w, rider, ridersCode)).status).toBe(204);
      expect((await waysBack(w, rider.athleteId)).addresses.map((each) => each.address)).toEqual([
        established,
        'rider-new@example.org',
      ]);
    });

    it(`Confirm it, ${column}: ADDS its address, held, beside the established one, which stays in force`, async () => {
      const w = await start();
      const { rider, established, ...keys } = await riderWithWayBack(w);
      const before = await waysBack(w, rider.athleteId);
      await bind(w, pick(keys), 'attacker@example.org');
      const after = await waysBack(w, rider.athleteId);
      expect(after.codes).toEqual(before.codes);
      expect(after.addresses[0]).toEqual(before.addresses[0]);
      expect(after.addresses.map((each) => each.address)).toEqual([
        established,
        'attacker@example.org',
      ]);
      // The established address still recovers; the held one does not.
      expect(await requestMail(w, established)).toBeDefined();
      expect(await requestMail(w, 'attacker@example.org')).toBeUndefined();
    });

    it(`Clear an address, ${column}: the established one needs a step-up; a held one only its binder clears`, async () => {
      const w = await start();
      const { rider, established, ...keys } = await riderWithWayBack(w);
      await bind(w, rider, 'rider-held@example.org');
      const before = await waysBack(w, rider.athleteId);
      const attacker = pick(keys);
      for (const address of [established, 'rider-held@example.org']) {
        const cleared = await call(w, attacker, 'POST', '/v1/auth/recovery-email/clear', {
          address,
        });
        expect(codeIn(cleared), address).toBe('step_up_required');
      }
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
      // A held address it bound itself, it may clear (the rider clears theirs
      // first, to make room under the limit of two).
      expect(
        (
          await call(w, rider, 'POST', '/v1/auth/recovery-email/clear', {
            address: 'rider-held@example.org',
          })
        ).status,
      ).toBe(204);
      await bind(w, attacker, 'own@example.org');
      const own = await call(w, attacker, 'POST', '/v1/auth/recovery-email/clear', {
        address: 'own@example.org',
      });
      expect(own.status).toBe(204);
      const after = await waysBack(w, rider.athleteId);
      expect(after.codes).toEqual(before.codes);
      expect(after.addresses).toEqual([before.addresses[0]]);
    });

    it(`The full reset, ${column}: refused without a step-up, and nothing changes`, async () => {
      const w = await start();
      const { rider, ...keys } = await riderWithWayBack(w);
      const before = await waysBack(w, rider.athleteId);
      const refused = await call(w, pick(keys), 'POST', '/v1/auth/recovery/reset', {});
      expect(refused.status).toBe(403);
      expect(codeIn(refused)).toBe('step_up_required');
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
    });

    it(`Recovery codes, ${column}: no route shows them, and every call above leaves them as they were`, async () => {
      const w = await start();
      const { rider, ...keys } = await riderWithWayBack(w);
      const before = await waysBack(w, rider.athleteId);
      const devices = await call(w, pick(keys), 'GET', '/v1/auth/devices');
      expect(devices.status).toBe(200);
      for (const code of rider.recoveryCodes) {
        expect(JSON.stringify(devices.body)).not.toContain(code);
        expect(JSON.stringify(devices.body)).not.toContain(code.replace(/-/g, ''));
      }
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
    });

    it(`The one-off review, ${column}: every step a key alone can take leaves the rider’s ways back`, async () => {
      const w = await start();
      const { rider, established, ...keys } = await riderWithWayBack(w);
      const before = await waysBack(w, rider.athleteId);
      const attacker = pick(keys);
      // The review's own reads and the steps it offers, taken by the attacker.
      expect((await call(w, attacker, 'GET', '/v1/auth/devices')).status).toBe(200);
      expect((await call(w, attacker, 'GET', '/v1/auth/account-changes')).status).toBe(200);
      expect(
        codeIn(
          await call(w, attacker, 'POST', '/v1/auth/recovery-email/clear', {
            address: established,
          }),
        ),
      ).toBe('step_up_required');
      expect(codeIn(await call(w, attacker, 'POST', '/v1/auth/recovery/reset', {}))).toBe(
        'step_up_required',
      );
      // It can revoke the rider's key (R1) — which takes neither way back.
      expect(
        (await call(w, attacker, 'POST', `/v1/auth/devices/${rider.device.publicKey}/revoke`, {}))
          .status,
      ).toBe(204);
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
    });

    it(`Revoke a key, ${column}: revoking the rider’s keys (R1) never touches the codes or an established address`, async () => {
      const w = await start();
      const { rider, ...keys } = await riderWithWayBack(w);
      const before = await waysBack(w, rider.athleteId);
      const attacker = pick(keys);
      const other = column === 'A' ? keys.b : keys.a;
      for (const victim of [rider, other]) {
        const revoked = await call(
          w,
          attacker,
          'POST',
          `/v1/auth/devices/${victim.device.publicKey}/revoke`,
          {},
        );
        expect(revoked.status).toBe(204);
      }
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
    });

    it(`Delete the account, ${column}: an erase statement any live key signs deletes it — accepted residue R3`, async () => {
      const w = await start();
      const { rider, ...keys } = await riderWithWayBack(w);
      const attacker = pick(keys);
      const statement = await attacker.device.statement(await w.nonceFor(attacker.device), {
        purpose: ERASE_ACCOUNT_PURPOSE,
        issuedAt: Math.floor(w.clock.ms / 1000),
      });
      const erased = await call(w, attacker, 'DELETE', '/v1/account', { statement });
      expect(erased.status, JSON.stringify(erased.body)).toBe(204);
      // R3: everything goes, the ways back with it; the device copy is canonical.
      expect(await waysBack(w, rider.athleteId)).toEqual({ addresses: [], codes: [] });
      expect(await tokens(w, rider.athleteId)).toEqual([]);
    });
  }

  describe('E, the token alone, fails every route', () => {
    const ROUTES: readonly (readonly [string, string, string, unknown])[] = [
      ['Give a recovery address', 'POST', '/v1/auth/recovery-email', { address: 'e@example.org' }],
      ['Confirm it', 'POST', '/v1/auth/recovery-email/confirm', { token: 'x'.repeat(43) }],
      [
        'Clear an address',
        'POST',
        '/v1/auth/recovery-email/clear',
        { address: 'rider@example.org' },
      ],
      [
        'The full reset',
        'POST',
        '/v1/auth/recovery/reset',
        { recoveryCode: 'abcd-efgh-jkmn-pqrs' },
      ],
      ['The device list (the review)', 'GET', '/v1/auth/devices', undefined],
      ['Delete the account', 'DELETE', '/v1/account', { recoveryCode: 'abcd-efgh-jkmn-pqrs' }],
    ];
    for (const [name, method, path, body] of ROUTES) {
      it(`${name}, E: refused, and the ways back stand`, async () => {
        const w = await start();
        const { rider } = await riderWithWayBack(w);
        const before = await waysBack(w, rider.athleteId);
        expect(await asTheEdge(w, rider, method, path, body)).toBe('bad_signature');
        expect(await waysBack(w, rider.athleteId)).toEqual(before);
      });
    }

    it('Recover and Ask for a recovery mail, E: it has no secret to put inside, and gains nothing', async () => {
      const w = await start();
      const { rider, established } = await riderWithWayBack(w);
      const before = await waysBack(w, rider.athleteId);
      // The mail goes to the rider, not to whoever asked.
      await requestMail(w, established);
      expect(w.mail.every((each) => each.address === established)).toBe(true);
      expect(codeIn(await recover(w, { emailToken: 'not-a-token-anyone-was-sent' }))).toBe(
        'code_unknown',
      );
      expect(await waysBack(w, rider.athleteId)).toEqual(before);
    });
  });

  describe('C and D succeed where the table says: residue R4', () => {
    it('Recover with the reset, C (a device and a code): takes the account — accepted residue R4', async () => {
      const w = await start();
      const { rider } = await riderWithWayBack(w);
      const taken = await recover(w, { recoveryCode: rider.recoveryCodes[3]! }, { reset: true });
      expect(taken.status, JSON.stringify(taken.body)).toBe(200);
      const after = await waysBack(w, rider.athleteId);
      expect(after.addresses).toEqual([]);
      expect(after.codes.map((each) => each.usedAt)).toEqual(Array(10).fill(null));
    });

    it('Recover, D (a device and the mail): adds a key with a code mailed to the established address — accepted residue R4', async () => {
      const w = await start();
      const { rider, established } = await riderWithWayBack(w);
      const mailed = await requestMail(w, established);
      const added = await recover(w, { emailToken: mailed! });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      expect((added.body as { athleteId: string }).athleteId).toBe(rider.athleteId);
    });

    it('Clear an address, C: clears the established one with a code — accepted residue R4', async () => {
      const w = await start();
      const { rider, b, established } = await riderWithWayBack(w);
      const cleared = await call(w, b, 'POST', '/v1/auth/recovery-email/clear', {
        address: established,
        recoveryCode: rider.recoveryCodes[0],
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(204);
      const after = await waysBack(w, rider.athleteId);
      expect(after.addresses).toEqual([]);
      // Checked, not spent.
      expect(after.codes.every((each) => each.usedAt === null)).toBe(true);
    });

    it('Clear an address, D: clears it with a code mailed to THAT address — accepted residue R4', async () => {
      const w = await start();
      const { rider, b, established } = await riderWithWayBack(w);
      const mailed = await requestMail(w, established);
      const cleared = await call(w, b, 'POST', '/v1/auth/recovery-email/clear', {
        address: established,
        emailToken: mailed,
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(204);
      expect((await waysBack(w, rider.athleteId)).addresses).toEqual([]);
    });

    it('Clear an address, E: a token mailed to one established address cannot clear another, and is not spent by the refusal', async () => {
      const w = await start();
      const { rider, b, established } = await riderWithWayBack(w);
      const other = 'other@example.org';
      await bind(w, rider, other);
      w.clock.ms += HOLD_MS + DAY_MS;
      const mailedToX = await requestMail(w, established);
      const refused = await call(w, b, 'POST', '/v1/auth/recovery-email/clear', {
        address: other,
        emailToken: mailedToX,
      });
      expect(codeIn(refused)).toBe('address_unbound');
      expect(
        (await waysBack(w, rider.athleteId)).addresses.map((each) => each.address).sort(),
      ).toEqual([established, other].sort());
      // Refused before it was spent: it still clears the address it was mailed to.
      const own = await call(w, b, 'POST', '/v1/auth/recovery-email/clear', {
        address: established,
        emailToken: mailedToX,
      });
      expect(own.status, JSON.stringify(own.body)).toBe(204);
    });

    it('The full reset, C and D: replaces the codes and clears every address — accepted residue R4', async () => {
      for (const proof of ['code', 'mail'] as const) {
        const w = await start();
        const { rider, b, established } = await riderWithWayBack(w);
        const step =
          proof === 'code'
            ? { recoveryCode: rider.recoveryCodes[0] }
            : { emailToken: await requestMail(w, established) };
        const reset = await call(w, b, 'POST', '/v1/auth/recovery/reset', step);
        expect(reset.status, `${proof}: ${JSON.stringify(reset.body)}`).toBe(200);
        const fresh = (reset.body as { recoveryCodes: string[] }).recoveryCodes;
        expect(fresh).toHaveLength(10);
        const after = await waysBack(w, rider.athleteId);
        expect(after.addresses).toEqual([]);
        expect(after.codes.map((each) => each.codeSha256).sort()).toEqual(
          (
            await Promise.all(
              fresh.map((code) => sha256Hex(code.toLowerCase().replace(/[\s-]/g, ''))),
            )
          ).sort(),
        );
        await world?.close();
        world = undefined;
      }
    });
  });
});

describe('`/confirm` answers in item 9’s order, stopping at the first that answers (#1194)', () => {
  it('1. an unknown code is code_unknown, and nothing changes', async () => {
    const w = await start();
    const rider = await register(w);
    await bind(w, rider, 'one@example.org');
    const before = await waysBack(w, rider.athleteId);
    expect(codeIn(await confirm(w, rider, 'n'.repeat(43)))).toBe('code_unknown');
    expect(await waysBack(w, rider.athleteId)).toEqual(before);
  });

  it('1. a confirmation pending when another key bound the address is confirmation_superseded, and changes nothing', async () => {
    const w = await start();
    const rider = await register(w);
    const a = await linked(w, rider);
    const ridersCode = await give(w, rider, 'new@example.org');
    const attackersCode = await give(w, a, 'new@example.org');
    expect((await confirm(w, rider, attackersCode)).status).toBe(204);
    const bound = await waysBack(w, rider.athleteId);
    expect(bound.addresses).toMatchObject([
      { address: 'new@example.org', boundByKey: a.device.publicKey },
    ]);
    w.clock.ms += 60_000;
    const late = await confirm(w, rider, ridersCode);
    expect(late.status).toBe(409);
    expect(codeIn(late)).toBe('confirmation_superseded');
    expect(await waysBack(w, rider.athleteId)).toEqual(bound);
  });

  it('2. another athlete holds the address: address_in_use, and nothing is bound', async () => {
    const w = await start();
    const first = await register(w);
    const second = await register(w);
    await bind(w, first, 'shared@example.org');
    const refused = await confirm(w, second, await give(w, second, 'shared@example.org'));
    expect(codeIn(refused)).toBe('address_in_use');
    expect((await waysBack(w, second.athleteId)).addresses).toEqual([]);
    expect((await waysBack(w, first.athleteId)).addresses).toMatchObject([
      { address: 'shared@example.org' },
    ]);
  });

  it('3 before 4: re-confirming an address already bound while two are bound is success, not address_limit', async () => {
    const w = await start();
    const rider = await register(w);
    await bind(w, rider, 'one@example.org');
    await bind(w, rider, 'two@example.org');
    const before = await waysBack(w, rider.athleteId);
    const again = await confirm(w, rider, await give(w, rider, 'one@example.org'));
    expect(again.status, JSON.stringify(again.body)).toBe(204);
    expect(await waysBack(w, rider.athleteId)).toEqual(before);
  });

  it('3. the rider’s own established address, given again under another key’s name, keeps its binder and its hold', async () => {
    const w = await start();
    const { rider, a, established } = await riderWithWayBack(w);
    const [own] = (await waysBack(w, rider.athleteId)).addresses;
    expect(own).toMatchObject({ address: established, boundByKey: rider.device.publicKey });
    // The edge's key gives the rider's address; the rider types the code, as told.
    const typed = await confirm(w, rider, await give(w, a, established));
    expect(typed.status).toBe(204);
    const [after] = (await waysBack(w, rider.athleteId)).addresses;
    expect(after?.boundByKey).toBe(own?.boundByKey);
    expect(after?.confirmedAt).toBe(own?.confirmedAt);
    // So revoking that key, as the notice says, leaves the rider's address.
    await call(w, rider, 'POST', `/v1/auth/devices/${a.device.publicKey}/revoke`, {});
    expect((await waysBack(w, rider.athleteId)).addresses).toEqual([after]);
  });

  it('4. a third address while two are bound is address_limit, nothing changes, and the code stays usable', async () => {
    const w = await start();
    const rider = await register(w);
    await bind(w, rider, 'one@example.org');
    await bind(w, rider, 'two@example.org');
    const before = await waysBack(w, rider.athleteId);
    const third = await give(w, rider, 'three@example.org');
    const refused = await confirm(w, rider, third);
    expect(refused.status).toBe(409);
    expect(codeIn(refused)).toBe('address_limit');
    expect(await waysBack(w, rider.athleteId)).toEqual(before);
    // Clearing one (held, by its binder) makes room, and the same code binds.
    await call(w, rider, 'POST', '/v1/auth/recovery-email/clear', { address: 'two@example.org' });
    expect((await confirm(w, rider, third)).status).toBe(204);
  });

  it('5. adds the address held, with the GIVING key as binder, and spends every other pending confirmation of it', async () => {
    const w = await start();
    const rider = await register(w);
    const a = await linked(w, rider);
    const byA = await give(w, a, 'new@example.org');
    const byRider = await give(w, rider, 'new@example.org');
    const at = Math.floor(w.clock.ms / 1000);
    expect((await confirm(w, rider, byA)).status).toBe(204);
    expect((await waysBack(w, rider.athleteId)).addresses).toEqual([
      {
        athleteId: rider.athleteId,
        address: 'new@example.org',
        confirmedAt: at,
        boundByKey: a.device.publicKey,
      },
    ]);
    const confirmations = await w.freshRead((store) =>
      store.listEmailConfirmations(rider.athleteId),
    );
    expect(confirmations.every((each) => each.usedAt === at)).toBe(true);
    expect(
      confirmations.find((each) => each.requestedByKey === rider.device.publicKey)?.supersededAt,
    ).toBe(at);
    expect(codeIn(await confirm(w, rider, byRider))).toBe('confirmation_superseded');
  });
});

describe('the hold: a new address recovers nothing for a week (#1194)', () => {
  /** A rider whose second key `a` binds `held@example.org` now. */
  async function heldByA(w: IdentityInstance) {
    const rider = await register(w);
    const a = await linked(w, rider);
    await bind(w, a, 'held@example.org');
    return { rider, a };
  }

  it('day 6: mails no recovery code, and a code mailed to it does not recover', async () => {
    const w = await start();
    const { rider } = await heldByA(w);
    w.clock.ms += 6 * DAY_MS;
    expect(await requestMail(w, 'held@example.org')).toBeUndefined();
    // A code that reached it anyway — written beneath the routes, as a
    // mailer that ignored the hold would have — does not recover either.
    const token = 'acodemailedtoaheldaddress';
    await w.freshRead(async (store) =>
      store.putEmailRecoveryToken({
        tokenSha256: await sha256Hex(token),
        athleteId: rider.athleteId,
        expiresAt: Math.floor(w.clock.ms / 1000) + 600,
        address: 'held@example.org',
      }),
    );
    const refused = await recover(w, { emailToken: token });
    expect(refused.status).toBe(401);
    expect(codeIn(refused)).toBe('address_unbound');
    expect(await w.freshRead((store) => store.findDeviceKey(refused.device.publicKey))).toBe(
      undefined,
    );
  });

  it('day 8: both work — the mail goes, and its code recovers', async () => {
    const w = await start();
    const { rider } = await heldByA(w);
    w.clock.ms += 8 * DAY_MS;
    const mailed = await requestMail(w, 'held@example.org');
    expect(mailed).toBeDefined();
    const recovered = await recover(w, { emailToken: mailed! });
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    expect((recovered.body as { athleteId: string }).athleteId).toBe(rider.athleteId);
  });

  it('day 6: revoking the binder clears the address', async () => {
    const w = await start();
    const { rider, a } = await heldByA(w);
    w.clock.ms += 6 * DAY_MS;
    await call(w, rider, 'POST', `/v1/auth/devices/${a.device.publicKey}/revoke`, {});
    expect((await waysBack(w, rider.athleteId)).addresses).toEqual([]);
    const cleared = (
      await w.freshRead((store) => store.listAccountChanges(rider.athleteId))
    ).filter((entry) => entry.kind === 'address_cleared');
    expect(cleared).toMatchObject([
      { address: 'held@example.org', actorKey: rider.device.publicKey },
    ]);
  });

  it('day 8: revoking the binder leaves the address, which is established', async () => {
    const w = await start();
    const { rider, a } = await heldByA(w);
    w.clock.ms += 8 * DAY_MS;
    await call(w, rider, 'POST', `/v1/auth/devices/${a.device.publicKey}/revoke`, {});
    expect((await waysBack(w, rider.athleteId)).addresses).toMatchObject([
      { address: 'held@example.org', boundByKey: a.device.publicKey },
    ]);
  });

  it('shows the hold in the device list: when it ends, then nothing once established', async () => {
    const w = await start();
    const { rider } = await heldByA(w);
    const boundAt = Math.floor(w.clock.ms / 1000);
    const listed = await call(w, rider, 'GET', '/v1/auth/devices');
    expect((listed.body as { recoveryAddresses: unknown[] }).recoveryAddresses).toMatchObject([
      { address: 'held@example.org', heldUntil: boundAt + RECOVERY_ADDRESS_HOLD_SECONDS },
    ]);
    w.clock.ms += 8 * DAY_MS;
    const later = await call(w, rider, 'GET', '/v1/auth/devices');
    expect((later.body as { recoveryAddresses: unknown[] }).recoveryAddresses).toMatchObject([
      { address: 'held@example.org', heldUntil: null },
    ]);
  });
});

describe('the removal rule (#1194, ADR 0047 D-8)', () => {
  it('`/clear` voids every unredeemed code mailed to the cleared address and every pending confirmation of it, and nothing else', async () => {
    const w = await start();
    const { rider, a, established } = await riderWithWayBack(w);
    await bind(w, rider, 'second@example.org');
    w.clock.ms += HOLD_MS + DAY_MS;
    await requestMail(w, established);
    w.clock.ms += 60_000;
    await requestMail(w, established);
    const toSecond = await requestMail(w, 'second@example.org');
    // A key gives the cleared address again: a pending confirmation of it.
    await give(w, a, established);
    const cleared = await call(w, rider, 'POST', '/v1/auth/recovery-email/clear', {
      address: established,
      recoveryCode: rider.recoveryCodes[0],
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(204);
    const after = await tokens(w, rider.athleteId);
    expect(
      after.filter((each) => each.address === established).every((each) => each.usedAt !== null),
    ).toBe(true);
    expect(after.find((each) => each.address === 'second@example.org')?.usedAt).toBeNull();
    const pending = (
      await w.freshRead((store) => store.listEmailConfirmations(rider.athleteId))
    ).filter((each) => each.usedAt === null);
    expect(pending.filter((each) => each.address === established)).toEqual([]);
    // The other address's code still recovers.
    expect((await recover(w, { emailToken: toSecond! })).status).toBe(200);
  });

  it('the reset voids every mailed code and link code, and every pending confirmation', async () => {
    const w = await start();
    const { rider, a, established } = await riderWithWayBack(w);
    const mailed = await requestMail(w, established);
    const minted = await call(w, a, 'POST', '/v1/auth/link-codes', {});
    const linkCode = (minted.body as { linkCode: string }).linkCode;
    await give(w, a, 'pending@example.org');
    const reset = await call(w, rider, 'POST', '/v1/auth/recovery/reset', {
      recoveryCode: rider.recoveryCodes[0],
    });
    expect(reset.status).toBe(200);
    expect((await tokens(w, rider.athleteId)).every((each) => each.usedAt !== null)).toBe(true);
    expect(
      (await w.freshRead((store) => store.listLinkCodes(rider.athleteId))).every(
        (each) => each.usedAt !== null,
      ),
    ).toBe(true);
    expect(
      (await w.freshRead((store) => store.listEmailConfirmations(rider.athleteId))).filter(
        (each) => each.usedAt === null,
      ),
    ).toEqual([]);
    // What was mailed or minted before cannot add a key after.
    expect(codeIn(await recover(w, { emailToken: mailed! }))).toBe('address_unbound');
    const joining = await testDevice();
    const linked2 = await w.call('POST', '/v1/auth/link', {
      body: {
        ...(await joining.statement(await w.nonceFor(joining), {
          purpose: LINK_PURPOSE,
          issuedAt: Math.floor(w.clock.ms / 1000),
        })),
        linkCode,
      },
    });
    expect(codeIn(linked2)).toBe('code_used');
    const kinds = (await w.freshRead((store) => store.listAccountChanges(rider.athleteId)))
      .slice(-2)
      .map((entry) => `${entry.kind} ${entry.actorKey === rider.device.publicKey}`);
    expect(kinds).toEqual(['codes_replaced true', 'address_cleared true']);
  });

  it('*revoke every other key* voids each revoked key’s codes and pending confirmations, and clears the held addresses they bound', async () => {
    const w = await start();
    const { rider, a, b, established } = await riderWithWayBack(w);
    await bind(w, a, 'a-held@example.org');
    await give(w, b, 'b-pending@example.org');
    await call(w, b, 'POST', '/v1/auth/link-codes', {});
    const recovered = await recover(
      w,
      { recoveryCode: rider.recoveryCodes[0]! },
      { revokeOtherKeys: true },
    );
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    const after = await waysBack(w, rider.athleteId);
    // The held address a key bound is gone; the rider's established one stays.
    expect(after.addresses.map((each) => each.address)).toEqual([established]);
    expect(
      (await w.freshRead((store) => store.listLinkCodes(rider.athleteId))).every(
        (each) => each.usedAt !== null,
      ),
    ).toBe(true);
    expect(
      (await w.freshRead((store) => store.listEmailConfirmations(rider.athleteId))).filter(
        (each) => each.usedAt === null,
      ),
    ).toEqual([]);
    const live = (await w.freshRead((store) => store.listDeviceKeys(rider.athleteId))).filter(
      (key) => key.revokedAt === null,
    );
    expect(live.map((key) => key.publicKey)).toEqual([recovered.device.publicKey]);
  });
});

describe('the re-check at redemption (#1194, D-8 item 7)', () => {
  it('a code whose address was removed between mailing and redemption is refused address_unbound', async () => {
    const w = await start();
    const { rider, b, established } = await riderWithWayBack(w);
    const mailed = await requestMail(w, established);
    await call(w, b, 'POST', '/v1/auth/recovery-email/clear', {
      address: established,
      recoveryCode: rider.recoveryCodes[0],
    });
    const refused = await recover(w, { emailToken: mailed! });
    expect(refused.status).toBe(401);
    expect(codeIn(refused)).toBe('address_unbound');
    expect(await w.freshRead((store) => store.findDeviceKey(refused.device.publicKey))).toBe(
      undefined,
    );
  });

  it('a step-up by mailed code is re-checked as well: a code mailed to a removed address cannot reset', async () => {
    const w = await start();
    const { rider, b, established } = await riderWithWayBack(w);
    const mailed = await requestMail(w, established);
    await call(w, b, 'POST', '/v1/auth/recovery-email/clear', {
      address: established,
      recoveryCode: rider.recoveryCodes[0],
    });
    const before = await waysBack(w, rider.athleteId);
    const refused = await call(w, b, 'POST', '/v1/auth/recovery/reset', { emailToken: mailed });
    expect(codeIn(refused)).toBe('address_unbound');
    expect(await waysBack(w, rider.athleteId)).toEqual(before);
  });
});

describe('a rider’s way back from a thief (R1, end to end)', () => {
  it('device A is stolen and revokes device B; a printed code on a new device resets and revokes every other key', async () => {
    const w = await start();
    const rider = await register(w);
    const printed = rider.recoveryCodes;
    const stolen = await linked(w, rider);
    // The thief revokes the rider's own device.
    expect(
      (await call(w, stolen, 'POST', `/v1/auth/devices/${rider.device.publicKey}/revoke`, {}))
        .status,
    ).toBe(204);
    const recovered = await recover(
      w,
      { recoveryCode: printed[0]! },
      { reset: true, revokeOtherKeys: true },
    );
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    const fresh = (recovered.body as { recoveryCodes: string[] }).recoveryCodes;
    expect(fresh).toHaveLength(10);

    // Key A cannot sign: refused at sign-in, and its session is over.
    expect(codeIn(await w.signIn(stolen.device))).toBe('key_revoked');
    expect((await call(w, stolen, 'GET', '/v1/auth/devices')).status).toBe(401);
    // The old codes fail, the new ones work.
    expect(codeIn(await recover(w, { recoveryCode: printed[1]! }))).toBe('code_unknown');
    expect((await recover(w, { recoveryCode: fresh[0]! })).status).toBe(200);
  });

  it('accepted residue R4: a device key plus a code resets first, and the rider’s old codes are refused', async () => {
    const w = await start();
    const rider = await register(w);
    const thief = await linked(w, rider);
    const taken = await call(w, thief, 'POST', '/v1/auth/recovery/reset', {
      recoveryCode: rider.recoveryCodes[9],
    });
    expect(taken.status).toBe(200);
    for (const code of rider.recoveryCodes.slice(0, 3)) {
      expect(codeIn(await recover(w, { recoveryCode: code }))).toBe('code_unknown');
    }
  });
});

describe('the review is per device: what one key did is a notice on every other (#1194)', () => {
  it('key X resets and revokes; device Y is shown both, naming X, until Y itself acknowledges', async () => {
    const w = await start();
    const x = await register(w);
    const y = await linked(w, x);
    const z = await linked(w, x);
    expect(
      (await call(w, x, 'POST', '/v1/auth/recovery/reset', { recoveryCode: x.recoveryCodes[0] }))
        .status,
    ).toBe(200);
    expect(
      (await call(w, x, 'POST', `/v1/auth/devices/${z.device.publicKey}/revoke`, {})).status,
    ).toBe(204);
    const forY = (await call(w, y, 'GET', '/v1/auth/account-changes')).body as {
      notices: { kind: string; actorKey: string }[];
    };
    expect(
      forY.notices
        .filter((each) => each.kind === 'codes_replaced' || each.kind === 'key_revoked')
        .map((each) => `${each.kind} ${each.actorKey === x.device.publicKey}`),
    ).toEqual(['codes_replaced true', 'key_revoked true']);
    // X's own reading shows X none of its own.
    const forX = (await call(w, x, 'GET', '/v1/auth/account-changes')).body as {
      notices: { actorKey: string }[];
    };
    expect(forX.notices.filter((each) => each.actorKey === x.device.publicKey)).toEqual([]);
  });
});

describe('mail carries no URL (#1194, D-8)', () => {
  it('neither the recovery nor the confirmation mail holds `://` or the instance’s origin', async () => {
    const w = await start();
    const { established } = await riderWithWayBack(w);
    await requestMail(w, established);
    expect(w.mail).toHaveLength(1);
    expect(w.confirmations.length).toBeGreaterThan(0);
    for (const mail of [...w.mail, ...w.confirmations]) {
      for (const part of [mail.subject, mail.text]) {
        expect(part).not.toContain('://');
        expect(part).not.toContain(TEST_ORIGIN);
        expect(part).not.toContain(new URL(TEST_ORIGIN).host);
      }
      // The code is in it, to be typed.
      expect(mail.text).toContain(mail.token);
    }
  });

  it('the confirmation mail names the device that asked, by the day its key was added', async () => {
    const w = await start();
    const rider = await register(w);
    w.clock.ms += 3 * DAY_MS;
    const a = await linked(w, rider);
    await give(w, a, 'new@example.org');
    const added = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(w.clock.ms));
    expect(w.confirmations.at(-1)?.text).toContain(`asked for by the key added on ${added}`);
  });
});

describe('scoping: three athletes (#1194)', () => {
  it('athlete 2 cannot bind athlete 1’s address, and athlete 1’s reset and clear touch no row of 2 or 3', async () => {
    const w = await start();
    const one = await riderWithWayBack(w);
    const two = await register(w);
    const three = await register(w);
    await bind(w, two, 'two@example.org');
    await bind(w, three, 'three@example.org');
    w.clock.ms += HOLD_MS + DAY_MS;
    expect(codeIn(await confirm(w, two, await give(w, two, one.established)))).toBe(
      'address_in_use',
    );
    await requestMail(w, 'two@example.org');
    await requestMail(w, 'three@example.org');
    const rowsOf = (athleteId: string) =>
      w.freshRead(async (store) => ({
        addresses: await store.listRecoveryEmails(athleteId),
        codes: await store.listRecoveryCodes(athleteId),
        tokens: await store.listEmailRecoveryTokens(athleteId),
        confirmations: await store.listEmailConfirmations(athleteId),
        links: await store.listLinkCodes(athleteId),
        changes: await store.listAccountChanges(athleteId),
      }));
    const others = async () => [await rowsOf(two.athleteId), await rowsOf(three.athleteId)];
    const before = await others();
    expect(
      (
        await call(w, one.rider, 'POST', '/v1/auth/recovery-email/clear', {
          address: one.established,
          recoveryCode: one.rider.recoveryCodes[0],
        })
      ).status,
    ).toBe(204);
    // Another athlete's address is not this athlete's to clear.
    expect(
      codeIn(
        await call(w, one.rider, 'POST', '/v1/auth/recovery-email/clear', {
          address: 'two@example.org',
          recoveryCode: one.rider.recoveryCodes[0],
        }),
      ),
    ).toBe('not_found');
    expect(
      (
        await call(w, one.rider, 'POST', '/v1/auth/recovery/reset', {
          recoveryCode: one.rider.recoveryCodes[1],
        })
      ).status,
    ).toBe(200);
    // Another athlete's code steps nothing up here.
    expect(
      codeIn(
        await call(w, one.rider, 'POST', '/v1/auth/recovery/reset', {
          recoveryCode: two.recoveryCodes[0],
        }),
      ),
    ).toBe('code_unknown');
    expect(await others()).toEqual(before);
  });

  it('deleting the account empties every recovery row of the athlete, the new columns included', async () => {
    const w = await start();
    const { rider, a, established } = await riderWithWayBack(w);
    await bind(w, a, 'held@example.org');
    await requestMail(w, established);
    const erased = await call(w, rider, 'DELETE', '/v1/account', {
      recoveryCode: rider.recoveryCodes[0],
    });
    expect(erased.status, JSON.stringify(erased.body)).toBe(204);
    expect(await waysBack(w, rider.athleteId)).toEqual({ addresses: [], codes: [] });
    expect(await tokens(w, rider.athleteId)).toEqual([]);
    expect(await w.freshRead((store) => store.findRecoveryEmail(established))).toBeUndefined();
  });
});

describe('a mailed code is typed (#1194, the owner’s ruling of 2026-10-09)', () => {
  // The recovery codes' alphabet, grouped in fours: 12 × log2(31) = 59.4 bits.
  const MAILED = /^[abcdefghjkmnpqrstuvwxyz23456789]{4}(-[abcdefghjkmnpqrstuvwxyz23456789]{4}){2}$/;

  it('both mails carry twelve letters from the recovery codes’ alphabet, in fours — never 43 base64url', async () => {
    const w = await start();
    const { established } = await riderWithWayBack(w);
    await requestMail(w, established);
    expect(w.mail).toHaveLength(1);
    expect(w.confirmations.length).toBeGreaterThan(0);
    for (const mail of [...w.mail, ...w.confirmations]) expect(mail.token).toMatch(MAILED);
  });

  it('takes a mailed code as a recovery code is taken: any case, without its hyphens or with spaces', async () => {
    const w = await start();
    const rider = await register(w);
    const a = await linked(w, rider);
    const mailed = await give(w, a, 'typed@example.org');
    const confirmed = await confirm(w, a, mailed.toUpperCase().replace(/-/g, ' '));
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(204);

    const { rider: other, established } = await riderWithWayBack(w);
    const recoveryCode = await requestMail(w, established);
    const added = await recover(w, { emailToken: recoveryCode!.replace(/-/g, '').toUpperCase() });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect((added.body as { athleteId: string }).athleteId).toBe(other.athleteId);
  });
});
