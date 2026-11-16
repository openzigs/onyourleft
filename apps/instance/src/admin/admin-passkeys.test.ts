// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's passkeys on the admin pages (#2642, ADR 0069 D-1, D-4, D-8 and
 * the owner's answers to Q-A and Q-C): enrolment from a code session, sign-in
 * with a passkey across a restart, the step-up every change needs, revoking,
 * and the CLI's `admin-passkeys`. Driven through the REAL handler over a real
 * SQLite file with the tests' own software authenticator, and every guarantee
 * read back through the store or the owner's sealed `GET /v1/operate/log` —
 * never through the page that claimed it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import {
  adminCode,
  adminPasskeysConfirm,
  adminPasskeysList,
  adminPasskeysRevoke,
} from '../operator/commands.ts';
import { runCommand } from '../operator/run.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import type { AdminPasskeyRecord } from '../store/sql-store.ts';
import { ADMIN_HEADERS } from './headers.ts';
import {
  adminRequest,
  cookieOf,
  csrfOn,
  enrolWith,
  handlerOver,
  passkeySignIn,
  passkeySignInForm,
  signInWith,
  stepUpWith,
  type HandlerOver,
} from './admin-testing.ts';
import { bindingOf } from './step-up.ts';
import { toBase64Url } from './webauthn.ts';
import { softwareAuthenticator, type SoftwareAuthenticator } from './webauthn-testing.ts';

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
afterEach(async () => {
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
  restarted = [];
  vi.unstubAllEnvs();
});

async function adminWorld(
  admin: NonNullable<Parameters<typeof startModerationWorld>[0]>['admin'] = {},
): Promise<ModerationWorld> {
  const world = await startModerationWorld({ admin });
  worlds.push(world);
  return world;
}

const paths = (world: ModerationWorld) => ({
  database: world.path,
  blobs: `${world.path}.blobs`,
});

/** `operator admin-code`, as the CLI runs it, on the world's own file and clock. */
async function mint(world: ModerationWorld): Promise<string> {
  return (await adminCode(paths(world), () => new Date(world.clock.ms))).code;
}

const MINUTE = 60_000;

/** A code session, signed in from its own address so the sign-in limits are not what is measured. */
let addresses = 0;
async function codeSession(world: ModerationWorld): Promise<string> {
  addresses += 1;
  return signInWith(world.instance.handler, await mint(world), {
    address: `198.51.100.${String(addresses % 250)}`,
  });
}

const passkeysOf = (world: ModerationWorld): Promise<readonly AdminPasskeyRecord[]> =>
  world.freshRead((store) => store.listAdminPasskeys());

const sessionRow = async (world: ModerationWorld, token: string) =>
  world.freshRead(async (store) => store.findAdminSession(await sha256Hex(token)));

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
  readonly outcome: string;
}

/** The operator log as the owner reads it: sealed, through the real route. */
async function ownersLog(world: ModerationWorld): Promise<readonly LogEntry[]> {
  const read = await world.as(world.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return (read.body as { entries: LogEntry[] }).entries;
}

const passkeyEntries = async (world: ModerationWorld) =>
  (await ownersLog(world))
    .filter((entry) => entry.action.startsWith('admin_passkey') || entry.action === 'admin_sign_in')
    .map(({ source, action, detail, outcome }) => ({ source, action, detail, outcome }))
    .reverse();

/** Enrol `authenticator` from a fresh code session, and confirm it on the host unless told not to. */
async function enrolled(
  world: ModerationWorld,
  authenticator: SoftwareAuthenticator,
  confirm = true,
): Promise<AdminPasskeyRecord> {
  const answer = await enrolWith(world.instance.handler, await codeSession(world), authenticator);
  expect(answer.status, await answer.clone().text()).toBe(303);
  const passkey = (await passkeysOf(world)).find(
    (each) => each.credentialId === authenticator.credentialId,
  );
  if (passkey === undefined) throw new Error('the passkey was not kept');
  if (confirm) await adminPasskeysConfirm(paths(world), passkey.id, () => new Date(world.clock.ms));
  return passkey;
}

/** Every row of a table, read on a connection of its own. */
function rowsOf(world: ModerationWorld, table: string): unknown[] {
  const database = openDatabase(world.path);
  try {
    return database.prepare(`select * from ${table}`).all();
  } finally {
    database.close();
  }
}

describe('enrolment from a code session, and sign-in with the passkey across a restart (#2642)', () => {
  it.each(['es256', 'ed25519'] as const)(
    'enrols a %s passkey, ends the code session, and a NEW handler over the same file signs in with it',
    async (algorithm) => {
      const world = await adminWorld();
      const authenticator = await softwareAuthenticator(algorithm);
      const code = await codeSession(world);
      const answer = await enrolWith(world.instance.handler, code, authenticator, {
        label: 'Work laptop',
      });
      expect(answer.status).toBe(303);
      expect(answer.headers.get('location')).toBe('/admin/sign-in?enrolled');
      expect(answer.headers.get('set-cookie')).toContain('Max-Age=0');
      // Read back: the code session is gone, and the passkey kept, unconfirmed.
      expect(await sessionRow(world, code)).toBeUndefined();
      const [kept] = await passkeysOf(world);
      expect(kept).toMatchObject({
        credentialId: authenticator.credentialId,
        rpId: 'ride.example',
        algorithm,
        publicKey: authenticator.publicKey,
        signCount: 0,
        label: 'Work laptop',
        listener: 'tunnel',
        confirmedAt: null,
        lastUsedAt: null,
      });
      expect(kept?.id).toMatch(/^[0-9a-f]{16}$/);

      // The first handler is discarded: a new one, its own store, the same file.
      const after = await handlerOver(world.path, world.clock, {
        owner: world.owner.device.publicKey,
        deputy: world.deputy.device.publicKey,
      });
      restarted.push(after);
      const token = await passkeySignIn(after.handler, authenticator);
      const landing = await after.handler(adminRequest('GET', '/admin', { cookie: token }));
      expect(landing.status).toBe(200);
      expect(await landing.text()).toContain('signed in as the instance’s owner, with a passkey');
      expect(await sessionRow(world, token)).toMatchObject({
        athleteId: world.owner.athleteId,
        strength: 'passkey',
      });
      // The counter and the last use are kept; the session is tied to the passkey.
      expect((await passkeysOf(world))[0]).toMatchObject({ signCount: 1 });
      expect((await passkeysOf(world))[0]?.lastUsedAt).not.toBeNull();
      expect(rowsOf(world, 'admin_passkey_session')).toEqual([
        { token_sha256: await sha256Hex(token), passkey_id: kept?.id },
      ]);
      expect(await passkeyEntries(world)).toEqual([
        { source: 'admin_tunnel', action: 'admin_sign_in', detail: 'code', outcome: 'done' },
        {
          source: 'admin_tunnel',
          action: 'admin_passkey_enrolled',
          detail: algorithm,
          outcome: 'done',
        },
        { source: 'admin_tunnel', action: 'admin_sign_in', detail: 'passkey', outcome: 'done' },
      ]);
    },
  );

  it('offers the creation options ADR 0069 D-1 fixes: Ed25519 and ES256 only, UV required, no attestation, the held ones excluded', async () => {
    const world = await adminWorld();
    const first = await softwareAuthenticator('es256');
    await enrolled(world, first);
    const token = await codeSession(world);
    const csrf = await csrfOn(world.instance.handler, token);
    const answer = await world.instance.handler(
      adminRequest('POST', '/admin/passkeys/options', { cookie: token, form: { csrf } }),
    );
    expect(answer.headers.get('content-type')).toBe('application/json');
    const options = (await answer.json()) as Record<string, unknown>;
    expect(options).toMatchObject({
      rpId: 'ride.example',
      algorithms: [-8, -7],
      excludeCredentials: [first.credentialId],
      timeout: 120_000,
    });
    // One handle for the owner, the first passkey's, never an athlete id.
    expect(options.userHandle).toBe((await passkeysOf(world))[0]?.userHandle);
    expect(options.userHandle).not.toContain(world.owner.athleteId);
    // The page's script reads them: the passkey.js it is served sets them.
    const script = await (
      await world.instance.handler(adminRequest('GET', '/admin/passkey.js'))
    ).text();
    expect(script).toContain("userVerification: 'required'");
    expect(script).toContain("attestation: 'none'");
  });

  it('refuses a second enrolment from one code session, an enrolment from a passkey session, and an eleventh passkey', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const code = await codeSession(world);
    const csrf = await csrfOn(handler, code);
    expect((await enrolWith(handler, code, await softwareAuthenticator('es256'))).status).toBe(303);
    // The code session ended at its enrolment: a second one is sent to sign in.
    const again = await handler(
      adminRequest('POST', '/admin/passkeys/options', { cookie: code, form: { csrf } }),
    );
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toBe('/admin/sign-in');

    // A passkey session is issued no enrolment.
    const authenticator = await softwareAuthenticator('ed25519');
    await enrolled(world, authenticator);
    const signedIn = await passkeySignIn(handler, authenticator);
    const refused = await handler(
      adminRequest('POST', '/admin/passkeys/options', {
        cookie: signedIn,
        form: { csrf: await csrfOn(handler, signedIn) },
      }),
    );
    expect(refused.status).toBe(403);
    expect(await passkeysOf(world)).toHaveLength(2);

    // Ten is the most: the eleventh is not offered, and not taken.
    for (let index = 2; index < 10; index += 1)
      await enrolled(world, await softwareAuthenticator('es256'), false);
    expect(await passkeysOf(world)).toHaveLength(10);
    const full = await codeSession(world);
    const fullCsrf = await csrfOn(handler, full, '/admin');
    const page = await (
      await handler(adminRequest('GET', '/admin/passkeys', { cookie: full }))
    ).text();
    expect(page).toContain('You hold 10 passkeys, the most there may be.');
    expect(
      (
        await handler(
          adminRequest('POST', '/admin/passkeys/options', {
            cookie: full,
            form: { csrf: fullCsrf },
          }),
        )
      ).status,
    ).toBe(409);
    expect(await passkeysOf(world)).toHaveLength(10);
  });

  it('refuses an enrolment answered for another origin, with UV unset, or with another session’s challenge — keeping nothing', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    for (const options of [
      { origin: 'https://evil.example' },
      { bend: { flags: 0x41 } },
      { bend: { rpIdHashed: 'evil.example' } },
    ]) {
      const code = await codeSession(world);
      const answer = await enrolWith(handler, code, await softwareAuthenticator('es256'), options);
      expect(answer.status, JSON.stringify(options)).toBe(400);
      // The code session lives on: nothing was spent but the challenge.
      expect(await sessionRow(world, code)).toBeDefined();
    }
    // Another session's challenge: the options asked by A, the answer posted by B.
    const a = await codeSession(world);
    const b = await codeSession(world);
    const asked = (await (
      await handler(
        adminRequest('POST', '/admin/passkeys/options', {
          cookie: a,
          form: { csrf: await csrfOn(handler, a) },
        }),
      )
    ).json()) as { challenge: string };
    const made = await (
      await softwareAuthenticator('es256')
    ).register({
      rpId: 'ride.example',
      origin: TEST_ORIGIN,
      challenge: asked.challenge,
    });
    const crossed = await handler(
      adminRequest('POST', '/admin/passkeys/add', {
        cookie: b,
        form: {
          csrf: await csrfOn(handler, b),
          label: 'Crossed',
          clientDataJSON: made.clientDataJSON,
          attestationObject: made.attestationObject,
        },
      }),
    );
    expect(crossed.status).toBe(400);
    expect(await passkeysOf(world)).toEqual([]);
    expect(
      (await ownersLog(world)).some((entry) => entry.action === 'admin_passkey_enrolled'),
    ).toBe(false);
  });

  it('refuses an enrolment answered over a challenge the instance did not issue to that session', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const code = await codeSession(world);
    const csrf = await csrfOn(handler, code);
    // The instance issues a challenge, which is never answered...
    const asked = await handler(
      adminRequest('POST', '/admin/passkeys/options', { cookie: code, form: { csrf } }),
    );
    expect(asked.status).toBe(200);
    // ...and the registration is signed over one the client chose, which it does name.
    const chosen = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const made = await (
      await softwareAuthenticator('es256')
    ).register({ rpId: 'ride.example', origin: TEST_ORIGIN, challenge: chosen });
    const answer = await handler(
      adminRequest('POST', '/admin/passkeys/add', {
        cookie: code,
        form: {
          csrf,
          label: 'Chosen',
          clientDataJSON: made.clientDataJSON,
          attestationObject: made.attestationObject,
        },
      }),
    );
    expect(answer.status).toBe(400);
    expect(await passkeysOf(world)).toEqual([]);
    expect(
      (await ownersLog(world)).some((entry) => entry.action === 'admin_passkey_enrolled'),
    ).toBe(false);
  });

  it('holds a passkey’s name to 1–60 characters and renders it escaped', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    for (const label of [
      '',
      ' '.repeat(3),
      'x'.repeat(61),
      'tab\there',
      'c1\u009b31m',
      'bidi\u202eevil',
    ]) {
      const answer = await enrolWith(
        handler,
        await codeSession(world),
        await softwareAuthenticator('es256'),
        {
          label,
        },
      );
      expect(answer.status, JSON.stringify(label)).toBe(400);
    }
    expect(await passkeysOf(world)).toEqual([]);
    const answer = await enrolWith(
      handler,
      await codeSession(world),
      await softwareAuthenticator('es256'),
      {
        label: '<b>Mine</b> & yours',
      },
    );
    expect(answer.status).toBe(303);
    const page = await (
      await handler(adminRequest('GET', '/admin/passkeys', { cookie: await codeSession(world) }))
    ).text();
    expect(page).toContain('&lt;b&gt;Mine&lt;/b&gt; &amp; yours');
    expect(page).not.toContain('<b>Mine</b>');
  });
});

describe('a passkey sign-in, refused by name and changing nothing (#2642)', () => {
  it('refuses a passkey nobody enrolled, a stranger’s key under an enrolled id, and another origin', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const owners = await softwareAuthenticator('es256');
    await enrolled(world, owners);
    const stranger = await softwareAuthenticator('es256');
    const client = { address: '203.0.113.20' };
    const unknown = await handler(
      adminRequest('POST', '/admin/sign-in/passkey', {
        form: await passkeySignInForm(handler, stranger, { client }),
      }),
      client,
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toContain('That passkey was not accepted');
    // The stranger's assertion, claiming the owner's credential id.
    const claimed = await passkeySignInForm(handler, stranger, { client });
    const forged = await handler(
      adminRequest('POST', '/admin/sign-in/passkey', {
        form: { ...claimed, credential: owners.credentialId },
      }),
      client,
    );
    expect(forged.status).toBe(400);
    const elsewhere = await handler(
      adminRequest('POST', '/admin/sign-in/passkey', {
        form: await passkeySignInForm(handler, owners, { origin: 'https://evil.example', client }),
      }),
      client,
    );
    expect(elsewhere.status).toBe(400);
    for (const answer of [unknown, forged, elsewhere]) expect(cookieOf(answer)).toBeUndefined();
    expect(rowsOf(world, 'admin_passkey_session')).toEqual([]);
    // The control: the owner's own, unbent, signs in.
    await passkeySignIn(handler, owners, client);
  });

  it('answers each challenge once: the same assertion twice opens one session, and an expired one opens none', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const authenticator = await softwareAuthenticator('ed25519', 'zero');
    await enrolled(world, authenticator);
    const form = await passkeySignInForm(handler, authenticator);
    const first = await handler(adminRequest('POST', '/admin/sign-in/passkey', { form }));
    expect(first.status).toBe(303);
    const second = await handler(adminRequest('POST', '/admin/sign-in/passkey', { form }));
    expect(second.status).toBe(400);
    expect(rowsOf(world, 'admin_passkey_session')).toHaveLength(1);
    const late = await passkeySignInForm(handler, authenticator);
    world.clock.ms += 2 * MINUTE;
    expect(
      (await handler(adminRequest('POST', '/admin/sign-in/passkey', { form: late }))).status,
    ).toBe(400);
    expect(rowsOf(world, 'admin_passkey_session')).toHaveLength(1);
  });

  it('refuses a counter that went backwards, counts it as `counter`, and leaves the stored counter as it was', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const authenticator = await softwareAuthenticator('es256');
    await enrolled(world, authenticator);
    await passkeySignIn(handler, authenticator);
    await passkeySignIn(handler, authenticator);
    expect((await passkeysOf(world))[0]?.signCount).toBe(2);
    const cloned = await passkeySignInForm(handler, authenticator, { bend: { signCount: 1 } });
    const answer = await handler(adminRequest('POST', '/admin/sign-in/passkey', { form: cloned }));
    expect(answer.status).toBe(400);
    expect((await passkeysOf(world))[0]?.signCount).toBe(2);
    await world.admin?.flushRefusals();
    expect(
      (await ownersLog(world))
        .filter((entry) => entry.action === 'admin_refused')
        .map((e) => e.detail),
    ).toEqual(['counter,refused=1']);
  });

  it('offers no passkey of another RP ID, and does not take one', async () => {
    const world = await adminWorld();
    const authenticator = await softwareAuthenticator('es256');
    const passkey = await enrolled(world, authenticator);
    // The operator moved the instance to another host: the passkey's RP ID is gone.
    const database = openDatabase(world.path);
    try {
      database
        .prepare('UPDATE admin_passkey SET rp_id = ? WHERE id = ?')
        .run('old.example', passkey.id);
    } finally {
      database.close();
    }
    const handler = world.instance.handler;
    const options = (await (
      await handler(adminRequest('POST', '/admin/sign-in/passkey-options', { form: {} }))
    ).json()) as { allowCredentials: string[] };
    expect(options.allowCredentials).toEqual([]);
    const answer = await handler(
      adminRequest('POST', '/admin/sign-in/passkey', {
        form: await passkeySignInForm(handler, authenticator),
      }),
    );
    expect(answer.status).toBe(400);
    const page = await (
      await handler(adminRequest('GET', '/admin/passkeys', { cookie: await codeSession(world) }))
    ).text();
    expect(page).toContain('Not usable at this address: it was added for old.example.');
  });
});

describe('the step-up every change needs (#2642, ADR 0069 D-4)', () => {
  /** Two confirmed passkeys and a session opened with the first. */
  async function twoPasskeys(world: ModerationWorld) {
    const one = await softwareAuthenticator('es256');
    const two = await softwareAuthenticator('ed25519');
    const first = await enrolled(world, one);
    const second = await enrolled(world, two);
    const token = await passkeySignIn(world.instance.handler, one);
    return { one, two, first, second, token };
  }

  const revoke = (
    world: ModerationWorld,
    token: string,
    id: string,
    form: Record<string, string>,
  ) =>
    world.instance.handler(
      adminRequest('POST', `/admin/passkeys/${id}/revoke`, { cookie: token, form }),
    );

  it('revokes with a step-up made for that passkey, ends the sessions it opened, and logs it', async () => {
    const world = await adminWorld();
    const { one, two, first, second, token } = await twoPasskeys(world);
    const handler = world.instance.handler;
    // Two more sessions opened by the second passkey, which is revoked.
    const theirs = [await passkeySignIn(handler, two), await passkeySignIn(handler, two)];
    const form = await stepUpWith(handler, token, one, 'passkey_revoke', { id: second.id });
    const answer = await revoke(world, token, second.id, form);
    expect(answer.status, await answer.clone().text()).toBe(303);
    expect(answer.headers.get('location')).toBe('/admin/passkeys');
    // Read back: the passkey gone, both its sessions ended, this one alive.
    expect((await passkeysOf(world)).map((each) => each.id)).toEqual([first.id]);
    for (const ended of theirs) {
      expect(await sessionRow(world, ended)).toBeUndefined();
      const next = await handler(adminRequest('GET', '/admin', { cookie: ended }));
      expect(next.status).toBe(303);
      expect(next.headers.get('location')).toBe('/admin/sign-in');
    }
    expect(await sessionRow(world, token)).toBeDefined();
    expect((await ownersLog(world))[0]).toMatchObject({
      source: 'admin_tunnel',
      action: 'admin_passkey_revoked',
      detail: 'sessions_ended=2',
      outcome: 'done',
    });
  });

  it('binds the challenge to the action’s fields: one for revoking A, spent on revoking B, is refused, and then refused for A too', async () => {
    const world = await adminWorld();
    const { one, first, second, token } = await twoPasskeys(world);
    const handler = world.instance.handler;
    const forFirst = await stepUpWith(handler, token, one, 'passkey_revoke', { id: first.id });
    const crossed = await revoke(world, token, second.id, { ...forFirst, id: second.id });
    expect(crossed.status).toBe(403);
    expect(await crossed.text()).toContain('Nothing was changed');
    expect((await passkeysOf(world)).map((each) => each.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    // The challenge was taken by that attempt: the same assertion for A is refused now.
    const reused = await revoke(world, token, first.id, forFirst);
    expect(reused.status).toBe(403);
    expect((await passkeysOf(world)).map((each) => each.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect((await ownersLog(world)).some((entry) => entry.action === 'admin_passkey_revoked')).toBe(
      false,
    );
    // The control: a fresh step-up for B revokes B.
    const fresh = await stepUpWith(handler, token, one, 'passkey_revoke', { id: second.id });
    expect((await revoke(world, token, second.id, fresh)).status).toBe(303);
  });

  it('refuses a revoke whose path names another passkey than the one the step-up is bound to', async () => {
    const world = await adminWorld();
    const { one, first, second, token } = await twoPasskeys(world);
    const handler = world.instance.handler;
    // A step-up made for B, whose form says B, posted to A's path.
    const forSecond = await stepUpWith(handler, token, one, 'passkey_revoke', { id: second.id });
    const crossed = await revoke(world, token, first.id, forSecond);
    expect(crossed.status).toBe(400);
    expect((await passkeysOf(world)).map((each) => each.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect((await ownersLog(world)).some((entry) => entry.action === 'admin_passkey_revoked')).toBe(
      false,
    );
  });

  it('refuses a challenge issued for back up now, spent on revoking a passkey — read back, nothing changed', async () => {
    const world = await adminWorld();
    const { one, second, token } = await twoPasskeys(world);
    const at = Math.floor(world.clock.ms / 1000);
    /** A step-up the instance holds for this session, as `/admin/step-up` would issue it. */
    const issued = async (action: string, binding: string): Promise<Record<string, string>> => {
      const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      await world.freshRead(async (store) =>
        store.issueAdminChallenge(
          {
            challengeSha256: await sha256Hex(challenge),
            purpose: 'step_up',
            sessionSha256: await sha256Hex(token),
            action,
            fieldsSha256: binding,
            userHandle: null,
            expiresAt: at + 120,
          },
          at,
        ),
      );
      const made = await one.assert({ rpId: 'ride.example', origin: TEST_ORIGIN, challenge });
      return {
        csrf: await csrfOn(world.instance.handler, token),
        id: second.id,
        credential: made.credentialId,
        clientDataJSON: made.clientDataJSON,
        authenticatorData: made.authenticatorData,
        signature: made.signature,
      };
    };
    // Back up now's own binding; and the revoke's binding under back up now's name.
    // Each issued only when the one before was answered: a session holds one step-up.
    for (const binding of [
      await bindingOf('backup_now', {}),
      await bindingOf('passkey_revoke', { id: second.id }),
    ]) {
      const form = await issued('backup_now', binding);
      expect((await revoke(world, token, second.id, form)).status).toBe(403);
      expect(await passkeysOf(world)).toHaveLength(2);
    }
    // The control: the same, issued for the revoke, revokes.
    const right = await issued(
      'passkey_revoke',
      await bindingOf('passkey_revoke', { id: second.id }),
    );
    expect((await revoke(world, token, second.id, right)).status).toBe(303);
    expect(await passkeysOf(world)).toHaveLength(1);
  });

  it('refuses a change with no step-up, an expired one, or one after the challenge was replaced', async () => {
    const world = await adminWorld();
    const { one, second, token } = await twoPasskeys(world);
    const handler = world.instance.handler;
    const csrf = await csrfOn(handler, token);
    expect((await revoke(world, token, second.id, { csrf, id: second.id })).status).toBe(403);
    const expired = await stepUpWith(handler, token, one, 'passkey_revoke', { id: second.id });
    world.clock.ms += 2 * MINUTE;
    expect((await revoke(world, token, second.id, expired)).status).toBe(403);
    const replaced = await stepUpWith(handler, token, one, 'passkey_revoke', { id: second.id });
    await stepUpWith(handler, token, one, 'passkey_revoke', { id: second.id });
    expect((await revoke(world, token, second.id, replaced)).status).toBe(403);
    expect(await passkeysOf(world)).toHaveLength(2);
  });

  it('gives a code session no step-up and no change (ADR 0069 Q-A), and an unconfirmed passkey none until the host confirms it (Q-C)', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const owner = await softwareAuthenticator('es256');
    const passkey = await enrolled(world, owner, false);
    // A code session: no challenge, and the revoke is refused.
    const code = await codeSession(world);
    const codeCsrf = await csrfOn(handler, code);
    const asked = await handler(
      adminRequest('POST', '/admin/step-up', {
        cookie: code,
        form: { csrf: codeCsrf, action: 'passkey_revoke', id: passkey.id },
      }),
    );
    expect(asked.status).toBe(403);
    expect((await revoke(world, code, passkey.id, { csrf: codeCsrf, id: passkey.id })).status).toBe(
      403,
    );
    // An unconfirmed passkey signs in and reads, and is offered for no change.
    const token = await passkeySignIn(handler, owner);
    const page = await (
      await handler(adminRequest('GET', '/admin/passkeys', { cookie: token }))
    ).text();
    expect(page).toContain(`operator admin-passkeys confirm ${passkey.id}`);
    const form = await stepUpWith(handler, token, owner, 'passkey_revoke', { id: passkey.id });
    expect((await revoke(world, token, passkey.id, form)).status).toBe(403);
    expect(await passkeysOf(world)).toHaveLength(1);
    // Confirmed on the host, the same passkey can make the change.
    await adminPasskeysConfirm(paths(world), passkey.id);
    const confirmed = await stepUpWith(handler, token, owner, 'passkey_revoke', { id: passkey.id });
    const answer = await revoke(world, token, passkey.id, confirmed);
    expect(answer.status).toBe(303);
    // Revoking the passkey this session was opened with ends this session too.
    expect(answer.headers.get('location')).toBe('/admin/sign-in');
    expect(await sessionRow(world, token)).toBeUndefined();
    expect(await passkeysOf(world)).toEqual([]);
  });

  it('refuses a step-up for an action that is not a change, or with a field it does not bind', async () => {
    const world = await adminWorld();
    const { second, token } = await twoPasskeys(world);
    const handler = world.instance.handler;
    const csrf = await csrfOn(handler, token);
    for (const form of [
      { csrf, action: 'backup_now' } as Record<string, string>,
      { csrf, action: 'constructor', id: second.id },
      { csrf, action: 'passkey_revoke' },
      { csrf, action: 'passkey_revoke', id: second.id, extra: 'x' },
    ]) {
      const answer = await handler(adminRequest('POST', '/admin/step-up', { cookie: token, form }));
      expect(answer.status, JSON.stringify(form)).toBe(400);
    }
    expect(
      rowsOf(world, 'admin_challenge').filter(
        (row) => (row as { purpose: string }).purpose === 'step_up',
      ),
    ).toEqual([]);
  });

  it('issues at most 30 step-up challenges a minute to one session', async () => {
    const world = await adminWorld();
    const { second, token } = await twoPasskeys(world);
    const handler = world.instance.handler;
    const csrf = await csrfOn(handler, token);
    const ask = () =>
      handler(
        adminRequest('POST', '/admin/step-up', {
          cookie: token,
          form: { csrf, action: 'passkey_revoke', id: second.id },
        }),
      );
    for (let index = 0; index < 30; index += 1) expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
    world.clock.ms += MINUTE;
    expect((await ask()).status).toBe(200);
  });
});

describe('the operator CLI’s admin-passkeys (#2642)', () => {
  it('lists, confirms and revokes, ending every session the passkey opened, each change logged from the cli', async () => {
    const world = await adminWorld();
    const authenticator = await softwareAuthenticator('ed25519');
    const passkey = await enrolled(world, authenticator, false);
    const listed = await adminPasskeysList(paths(world));
    expect(listed.passkeys).toEqual([
      expect.objectContaining({ id: passkey.id, label: passkey.label, confirmedAt: null }),
    ]);
    // Never a key or a credential id.
    expect(JSON.stringify(listed)).not.toContain(authenticator.publicKey);
    expect(JSON.stringify(listed)).not.toContain(authenticator.credentialId);

    await adminPasskeysConfirm(paths(world), passkey.id);
    expect((await passkeysOf(world))[0]?.confirmedAt).not.toBeNull();
    await expect(adminPasskeysConfirm(paths(world), passkey.id)).rejects.toThrow(
      /confirmed already/,
    );
    await expect(adminPasskeysConfirm(paths(world), 'f'.repeat(16))).rejects.toThrow(
      /no admin passkey/,
    );

    const live = await passkeySignIn(world.instance.handler, authenticator);
    const report = await adminPasskeysRevoke(paths(world), passkey.id);
    expect(report).toEqual({ command: 'admin-passkeys revoke', id: passkey.id, sessionsEnded: 1 });
    // The next request of the session it opened is refused.
    const next = await world.instance.handler(adminRequest('GET', '/admin', { cookie: live }));
    expect(next.status).toBe(303);
    expect(await passkeysOf(world)).toEqual([]);
    await expect(adminPasskeysRevoke(paths(world), passkey.id)).rejects.toThrow(/no admin passkey/);
    await expect(adminPasskeysRevoke(paths(world), 'not-an-id')).rejects.toThrow(
      /takes a passkey id/,
    );

    const cli = (await ownersLog(world))
      .filter((entry) => entry.source === 'cli' && entry.action.startsWith('admin_passkey'))
      .map(({ action, detail, outcome }) => ({ action, detail, outcome }))
      .reverse();
    expect(cli).toEqual([
      { action: 'admin_passkey_confirmed', detail: null, outcome: 'done' },
      { action: 'admin_passkey_confirmed', detail: null, outcome: 'refused' },
      { action: 'admin_passkey_confirmed', detail: null, outcome: 'refused' },
      { action: 'admin_passkey_revoked', detail: 'sessions_ended=1', outcome: 'done' },
      { action: 'admin_passkey_revoked', detail: null, outcome: 'refused' },
    ]);
  });

  it('is reached through runCommand by its usage line', async () => {
    const world = await adminWorld();
    const out: string[] = [];
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    const errors = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runCommand(['admin-passkeys', 'list'], paths(world))).toBe(0);
      expect(await runCommand(['admin-passkeys', 'confirm'], paths(world))).not.toBe(0);
      expect(await runCommand(['admin-passkeys', 'drop', 'x'], paths(world))).not.toBe(0);
    } finally {
      quiet.mockRestore();
      errors.mockRestore();
    }
    expect(JSON.parse(out[0] as string)).toEqual({ command: 'admin-passkeys list', passkeys: [] });
  });
});

describe('the change and its log entry, in one transaction (#2642)', () => {
  function refuseLogInserts(world: ModerationWorld): () => void {
    const database = openDatabase(world.path);
    try {
      database.exec(`create trigger operator_log_refuses_test before insert on operator_log
        begin select raise(abort, 'the log refused this entry'); end`);
    } finally {
      database.close();
    }
    return () => {
      const again = openDatabase(world.path);
      try {
        again.exec('drop trigger operator_log_refuses_test');
      } finally {
        again.close();
      }
    };
  }

  it('keeps no passkey, and ends no session, when the enrolment cannot be logged', async () => {
    const world = await adminWorld();
    const code = await codeSession(world);
    const restore = refuseLogInserts(world);
    const answer = await enrolWith(
      world.instance.handler,
      code,
      await softwareAuthenticator('es256'),
    );
    restore();
    expect(answer.status).toBe(500);
    expect(await passkeysOf(world)).toEqual([]);
    expect(await sessionRow(world, code)).toBeDefined();
  });

  it('revokes nothing, and ends no session, when the revocation cannot be logged', async () => {
    const world = await adminWorld();
    const one = await softwareAuthenticator('es256');
    const passkey = await enrolled(world, one);
    const token = await passkeySignIn(world.instance.handler, one);
    const form = await stepUpWith(world.instance.handler, token, one, 'passkey_revoke', {
      id: passkey.id,
    });
    const restore = refuseLogInserts(world);
    const answer = await world.instance.handler(
      adminRequest('POST', `/admin/passkeys/${passkey.id}/revoke`, { cookie: token, form }),
    );
    expect(answer.status).toBe(500);
    await expect(adminPasskeysRevoke(paths(world), passkey.id)).rejects.toThrow(/the log refused/);
    restore();
    expect((await passkeysOf(world)).map((each) => each.id)).toEqual([passkey.id]);
    expect(await sessionRow(world, token)).toBeDefined();
  });

  it('opens no passkey session when the sign-in cannot be logged, and leaves the counter where it was', async () => {
    const world = await adminWorld();
    const one = await softwareAuthenticator('es256');
    await enrolled(world, one);
    const form = await passkeySignInForm(world.instance.handler, one);
    const restore = refuseLogInserts(world);
    const answer = await world.instance.handler(
      adminRequest('POST', '/admin/sign-in/passkey', { form }),
    );
    restore();
    expect(answer.status).toBe(500);
    expect(rowsOf(world, 'admin_passkey_session')).toEqual([]);
    expect((await passkeysOf(world))[0]?.signCount).toBe(0);
  });
});

describe('owner-only, checked on every request (#2642, the epic’s constraint)', () => {
  it('sends a browser with no session to sign in from every passkey page and change, changing nothing', async () => {
    const world = await adminWorld();
    const one = await softwareAuthenticator('es256');
    const passkey = await enrolled(world, one);
    const before = await ownersLog(world);
    const handler = world.instance.handler;
    for (const [method, path] of [
      ['GET', '/admin/passkeys'],
      ['POST', '/admin/passkeys/options'],
      ['POST', '/admin/passkeys/add'],
      ['POST', '/admin/step-up'],
      ['POST', `/admin/passkeys/${passkey.id}/revoke`],
    ] as const) {
      const answer = await handler(
        adminRequest(
          method,
          path,
          method === 'POST' ? { form: { csrf: 'x', id: passkey.id } } : {},
        ),
      );
      expect(answer.status, path).toBe(303);
      expect(answer.headers.get('location'), path).toBe('/admin/sign-in');
    }
    expect(await passkeysOf(world)).toHaveLength(1);
    expect(await ownersLog(world)).toEqual(before);
  });

  it('refuses every passkey page and change once OYL_INSTANCE_OWNER_KEY names another athlete, nothing changed', async () => {
    const world = await adminWorld();
    const one = await softwareAuthenticator('es256');
    const two = await softwareAuthenticator('es256');
    await enrolled(world, one);
    const second = await enrolled(world, two);
    const token = await passkeySignIn(world.instance.handler, one);
    const form = await stepUpWith(world.instance.handler, token, one, 'passkey_revoke', {
      id: second.id,
    });
    const moved = await handlerOver(world.path, world.clock, {
      owner: world.deputy.device.publicKey,
    });
    restarted.push(moved);
    const before = await ownersLog(world);
    const revoked = await moved.handler(
      adminRequest('POST', `/admin/passkeys/${second.id}/revoke`, { cookie: token, form }),
    );
    expect(revoked.status).toBe(303);
    expect(revoked.headers.get('location')).toBe('/admin/sign-in');
    // The old owner's passkey signs the new owner in nowhere: it is bound to the
    // owner key it was enrolled under.
    const signIn = await moved.handler(
      adminRequest('POST', '/admin/sign-in/passkey', {
        form: await passkeySignInForm(moved.handler, one),
      }),
    );
    expect(signIn.status).toBe(400);
    expect(await passkeysOf(world)).toHaveLength(2);
    expect(await sessionRow(world, token)).toBeUndefined();
    expect(await ownersLog(world)).toEqual(before);
  });

  it('gives the deputy no passkey sign-in: with no owner key named the pages are unavailable', async () => {
    const world = await adminWorld();
    const one = await softwareAuthenticator('es256');
    await enrolled(world, one);
    const deputyOnly = await handlerOver(world.path, world.clock, {
      deputy: world.deputy.device.publicKey,
    });
    restarted.push(deputyOnly);
    const answer = await deputyOnly.handler(
      adminRequest('POST', '/admin/sign-in/passkey-options', { form: {} }),
    );
    expect(answer.status).toBe(503);
    expect(rowsOf(world, 'admin_passkey_session')).toEqual([]);
  });
});

describe('headers and CSRF on every page and POST this adds (#2642, ADR 0069 D-4)', () => {
  it('refuses every new POST from a foreign Origin, or same-site from another port, and each signed-in one without its CSRF token', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const one = await softwareAuthenticator('es256');
    const passkey = await enrolled(world, one);
    const token = await passkeySignIn(handler, one);
    const code = await codeSession(world);
    const csrf = await csrfOn(handler, token);
    const codeCsrf = await csrfOn(handler, code);
    const posts: [string, string, Record<string, string>][] = [
      ['/admin/sign-in/passkey-options', token, {}],
      ['/admin/sign-in/passkey', token, {}],
      ['/admin/passkeys/options', code, { csrf: codeCsrf }],
      ['/admin/passkeys/add', code, { csrf: codeCsrf, label: 'x' }],
      ['/admin/step-up', token, { csrf, action: 'passkey_revoke', id: passkey.id }],
      [`/admin/passkeys/${passkey.id}/revoke`, token, { csrf, id: passkey.id }],
    ];
    for (const [path, cookie, form] of posts) {
      for (const bent of [
        { origin: 'https://evil.example' },
        { origin: null },
        { site: 'same-site' },
        { site: 'cross-site' },
      ]) {
        const answer = await handler(adminRequest('POST', path, { cookie, form, ...bent }));
        expect(answer.status, `${path} ${JSON.stringify(bent)}`).toBe(403);
      }
      if ('csrf' in form) {
        for (const csrfSent of [undefined, 'f'.repeat(64)]) {
          const { csrf: _dropped, ...rest } = form;
          void _dropped;
          const answer = await handler(
            adminRequest('POST', path, {
              cookie,
              form: csrfSent === undefined ? rest : { ...rest, csrf: csrfSent },
            }),
          );
          expect(answer.status, `${path} csrf ${String(csrfSent)}`).toBe(403);
        }
      }
    }
    expect((await passkeysOf(world)).map((each) => each.id)).toEqual([passkey.id]);
    expect(rowsOf(world, 'admin_challenge')).toEqual([]);
    await world.admin?.flushRefusals();
    const refusals = (await ownersLog(world))
      .filter((entry) => entry.action === 'admin_refused')
      .map((entry) => entry.detail)
      .sort();
    expect(refusals).toEqual(['csrf,refused=8', 'origin,refused=24']);
  });

  it('answers every new page, ceremony, refusal and the script with the admin headers and no CORS header', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const one = await softwareAuthenticator('es256');
    const passkey = await enrolled(world, one);
    const token = await passkeySignIn(handler, one);
    const code = await codeSession(world);
    const csrf = await csrfOn(handler, token);
    const answers: Response[] = [
      await handler(adminRequest('GET', '/admin/passkeys', { cookie: token })),
      await handler(adminRequest('GET', '/admin/passkeys', { cookie: code })),
      await handler(adminRequest('GET', '/admin/passkeys')),
      await handler(adminRequest('GET', '/admin/passkey.js')),
      await handler(adminRequest('GET', '/admin/sign-in?enrolled')),
      await handler(adminRequest('POST', '/admin/sign-in/passkey-options', { form: {} })),
      await handler(adminRequest('POST', '/admin/sign-in/passkey', { form: {} })),
      await handler(
        adminRequest('POST', '/admin/step-up', {
          cookie: token,
          form: { csrf, action: 'passkey_revoke', id: passkey.id },
        }),
      ),
      await handler(adminRequest('POST', '/admin/step-up', { cookie: token, form: { csrf } })),
      await handler(
        adminRequest('POST', `/admin/passkeys/${passkey.id}/revoke`, {
          cookie: token,
          form: { csrf, id: passkey.id },
        }),
      ),
      await handler(adminRequest('GET', `/admin/passkeys/${passkey.id}/revoke`, { cookie: token })),
    ];
    for (const answer of answers) {
      for (const [name, value] of Object.entries(ADMIN_HEADERS)) {
        expect(answer.headers.get(name), `${name} on ${String(answer.status)}`).toBe(value);
      }
      expect(
        [...answer.headers.keys()].filter((name) => name.startsWith('access-control-')),
      ).toEqual([]);
    }
    expect(answers.map((answer) => answer.status)).toEqual([
      200, 200, 303, 200, 200, 200, 400, 200, 400, 403, 405,
    ]);
    expect(answers[3]?.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });
});

describe('the passkey pages by keyboard, and with no passkey support (#2642)', () => {
  it('offers the one-time code where the browser has no passkey support, and labels every control', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const signIn = await (await handler(adminRequest('GET', '/admin/sign-in'))).text();
    // Shown until the script finds passkey support; the passkey form hidden until then.
    expect(signIn).toMatch(
      /<p data-passkey-unsupported>[^<]*Sign in with a one-time code instead\.<\/p>/,
    );
    expect(signIn).toContain('data-passkey="sign-in" data-passkey-supported hidden>');
    expect(signIn).toContain('<button type="submit">Sign in with a passkey</button>');
    expect(signIn).toContain('<label for="code">One-time code</label>');
    const code = await codeSession(world);
    const page = await (
      await handler(adminRequest('GET', '/admin/passkeys', { cookie: code }))
    ).text();
    expect(page).toContain('<label for="label">A name for this passkey</label>');
    expect(page).toMatch(/<input type="text" id="label" name="label" maxlength="60"/);
    expect(page).toContain('<button type="submit">Add a passkey</button>');
    expect(page).toContain('<p data-passkey-unsupported>');
    expect(page).toContain('<html lang="en">');
    // Every control a native button or field: nothing that needs a pointer.
    expect(page.replace('<script src="/admin/passkey.js" defer></script>', '')).not.toMatch(
      /<script|\son[a-z]+=|tabindex="-|<div[^>]*role="button"/i,
    );
    // The script shows and hides by `hidden`, and handles no click but a form's submit.
    const script = await (await handler(adminRequest('GET', '/admin/passkey.js'))).text();
    expect(script).toContain("addEventListener('submit'");
    expect(script).not.toContain("'click'");
  });
});

describe('no secret and no coordinate in anything the passkey pages say (#2642, CLAUDE.md §6)', () => {
  it('shows no page, error, log line or log entry holding a secret the instance holds', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const secret = btoa(String.fromCharCode(...secretBytes(7)));
    const hostedKey = 'sk-MARKER-hosted-key-2642';
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2642-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2642');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(
        await runCommand(
          ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'],
          {
            ...paths(world),
            secret,
            ownerKey: world.owner.device.publicKey,
            readStandardInput: () => Promise.resolve(hostedKey),
          },
        ),
      ).toBe(0);
    } finally {
      quiet.mockRestore();
    }
    const said: string[] = [];
    const keep = async (answer: Response): Promise<Response> => {
      for (const [name, value] of answer.headers.entries()) {
        if (name !== 'set-cookie') said.push(`${name}: ${value}`);
      }
      said.push(await answer.clone().text());
      return answer;
    };
    const code = await mint(world);
    const codeToken = await signInWith(handler, code);
    const one = await softwareAuthenticator('es256');
    await keep(await enrolWith(handler, codeToken, one));
    const [passkey] = await passkeysOf(world);
    await adminPasskeysConfirm(paths(world), passkey?.id as string);
    const token = await passkeySignIn(handler, one);
    await keep(await handler(adminRequest('GET', '/admin/passkeys', { cookie: token })));
    await keep(await handler(adminRequest('GET', '/admin', { cookie: token })));
    await keep(
      await handler(
        adminRequest('POST', '/admin/sign-in/passkey', {
          form: await passkeySignInForm(handler, await softwareAuthenticator('es256')),
        }),
      ),
    );
    const form = await stepUpWith(handler, token, one, 'passkey_revoke', {
      id: passkey?.id as string,
    });
    await keep(
      await handler(
        adminRequest('POST', `/admin/passkeys/${passkey?.id as string}/revoke`, {
          cookie: token,
          form,
        }),
      ),
    );
    await world.admin?.flushRefusals();
    said.push(...world.instance.lines, JSON.stringify(await ownersLog(world)));
    const everything = said.join('\n');
    for (const marker of [
      secret,
      hostedKey,
      'MARKER-metrics-token-2642',
      'MARKER-tunnel-token-2642',
      world.owner.token,
      token,
      codeToken,
      code,
      code.replaceAll('-', ''),
      world.owner.device.publicKey,
      one.publicKey,
    ]) {
      expect(everything, marker).not.toContain(marker);
    }
  });
});
