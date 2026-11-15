// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin pages on the loopback listener (#2643, ADR 0069 D-1, D-4, D-5),
 * through the REAL handler with the `ClientInfo` the loopback adapter writes
 * (`listener: 'loopback'`): its own origin, `Host`, cookie, RP ID and log
 * source; a session or a passkey of one listener is nothing on the other; the
 * owner is asked on every request there too; and the optional allowlist
 * refuses a tunnel sign-in from elsewhere before the code is looked at and
 * leaves the loopback listener alone. Read back through the store and the
 * owner's sealed `GET /v1/operate/log`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { startModerationWorld, type ModerationWorld } from '../moderation/moderation-testing.ts';
import { adminCode } from '../operator/commands.ts';
import type { ClientInfo } from '../route-kit.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { LOOPBACK_COOKIE } from './admin.ts';
import {
  adminRequest,
  cookieOf,
  handlerOver,
  signInWith,
  type HandlerOver,
} from './admin-testing.ts';
import { ADMIN_HEADERS } from './headers.ts';
import { softwareAuthenticator } from './webauthn-testing.ts';

const PORT = 8788;
const LOCAL = `http://localhost:${String(PORT)}`;
/** What the loopback adapter writes for every request it reads. */
const ON_LOOPBACK: ClientInfo = { address: '172.30.87.1', listener: 'loopback' };

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
afterEach(async () => {
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
  restarted = [];
});

async function adminWorld(addresses?: readonly string[]): Promise<ModerationWorld> {
  const world = await startModerationWorld({
    admin: { loopbackPort: PORT, ...(addresses === undefined ? {} : { addresses }) },
  });
  worlds.push(world);
  return world;
}

const mint = async (world: ModerationWorld): Promise<string> =>
  (
    await adminCode(
      { database: world.path, blobs: `${world.path}.blobs` },
      () => new Date(world.clock.ms),
    )
  ).code;

/** A code session on the loopback listener; answers the cookie's token. */
async function loopbackSession(world: ModerationWorld): Promise<string> {
  const answer = await world.instance.handler(
    adminRequest('POST', '/admin/sign-in', { loopback: PORT, form: { code: await mint(world) } }),
    ON_LOOPBACK,
  );
  expect(answer.status, await answer.clone().text()).toBe(303);
  const token = cookieOf(answer, LOOPBACK_COOKIE);
  if (token === undefined) throw new Error('no loopback cookie');
  return token;
}

const sessionRow = async (world: ModerationWorld, token: string) =>
  world.freshRead(async (store) => store.findAdminSession(await sha256Hex(token)));

interface LogEntry {
  readonly source: string;
  readonly action: string;
  readonly detail: string | null;
}

async function ownersLog(world: ModerationWorld): Promise<readonly LogEntry[]> {
  const read = await world.as(world.owner, 'GET', '/v1/operate/log?limit=200');
  expect(read.status).toBe(200);
  return (read.body as { entries: LogEntry[] }).entries;
}

describe('the loopback listener’s own origin, Host and cookie (#2643, ADR 0069 D-4)', () => {
  it('signs in under `oyl-admin-loopback` — no __Host-, no Secure — and logs it from admin_loopback', async () => {
    const world = await adminWorld();
    const answer = await world.instance.handler(
      adminRequest('POST', '/admin/sign-in', { loopback: PORT, form: { code: await mint(world) } }),
      ON_LOOPBACK,
    );
    expect(answer.status).toBe(303);
    const cookie = answer.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(
      /^oyl-admin-loopback=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/,
    );
    const token = cookieOf(answer, LOOPBACK_COOKIE) as string;
    expect(await sessionRow(world, token)).toMatchObject({
      listener: 'loopback',
      strength: 'code',
    });
    const landing = await world.instance.handler(
      adminRequest('GET', '/admin', { loopback: PORT, cookie: token }),
      ON_LOOPBACK,
    );
    expect(landing.status).toBe(200);
    for (const [name, value] of Object.entries(ADMIN_HEADERS)) {
      expect(landing.headers.get(name), name).toBe(value);
    }
    expect(landing.headers.get('access-control-allow-origin')).toBeNull();
    expect(
      (await ownersLog(world)).find((entry) => entry.action === 'admin_sign_in'),
    ).toMatchObject({
      source: 'admin_loopback',
      detail: 'code',
    });
  });

  it('holds a session to its listener: a loopback session is nothing on the tunnel, and a tunnel one nothing on loopback', async () => {
    const world = await adminWorld();
    const local = await loopbackSession(world);
    // The loopback token presented through the tunnel, under the tunnel's name: ended.
    const crossed = await world.instance.handler(adminRequest('GET', '/admin', { cookie: local }));
    expect(crossed.status).toBe(303);
    expect(await sessionRow(world, local)).toBeUndefined();
    // And the reverse.
    const tunnel = await signInWith(world.instance.handler, await mint(world));
    const back = await world.instance.handler(
      adminRequest('GET', '/admin', { loopback: PORT, cookie: tunnel }),
      ON_LOOPBACK,
    );
    expect(back.status).toBe(303);
    expect(await sessionRow(world, tunnel)).toBeUndefined();
  });

  it('serves only Host localhost:<port> there, and takes a POST only from that exact origin', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    for (const host of [
      'ride.example',
      'localhost',
      `127.0.0.1:${String(PORT)}`,
      'localhost:3000',
    ]) {
      const answer = await handler(
        adminRequest('GET', '/admin/sign-in', { loopback: PORT, host }),
        ON_LOOPBACK,
      );
      expect(answer.status, host).toBe(421);
      expect(await answer.text()).toContain(`${LOCAL}/admin`);
    }
    const code = await mint(world);
    for (const bent of [
      { origin: 'https://ride.example' },
      // Another port on the same machine is the same SITE: Origin and Sec-Fetch-Site tell it apart.
      { origin: 'http://localhost:3000' },
      { site: 'same-site' },
      { origin: null },
    ]) {
      const answer = await handler(
        adminRequest('POST', '/admin/sign-in', { loopback: PORT, form: { code }, ...bent }),
        ON_LOOPBACK,
      );
      expect(answer.status, JSON.stringify(bent)).toBe(403);
    }
    // The code was never looked at: it still signs in.
    const answer = await handler(
      adminRequest('POST', '/admin/sign-in', { loopback: PORT, form: { code } }),
      ON_LOOPBACK,
    );
    expect(answer.status).toBe(303);
    await world.admin?.flushRefusals();
    expect(
      (await ownersLog(world))
        .filter((entry) => entry.action === 'admin_refused')
        .map((entry) => `${entry.source} ${String(entry.detail)}`),
    ).toEqual(['admin_loopback origin,refused=4']);
  });

  it('is not there at all on an instance whose loopback port is unset, even for a request marked loopback', async () => {
    const world = await startModerationWorld({ admin: {} });
    worlds.push(world);
    const answer = await world.instance.handler(
      adminRequest('GET', '/admin/sign-in', { loopback: PORT }),
      ON_LOOPBACK,
    );
    expect(answer.status).toBe(404);
  });
});

describe('a passkey enrolled on the loopback listener (#2643, ADR 0069 D-1)', () => {
  it('is for RP ID localhost at http://localhost:<port>, is not offered or taken through the tunnel, and is not confirmed by enrolling', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const token = await loopbackSession(world);
    const page = await (
      await handler(
        adminRequest('GET', '/admin/passkeys', { loopback: PORT, cookie: token }),
        ON_LOOPBACK,
      )
    ).text();
    const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(page)?.[1] as string;
    const options = (await (
      await handler(
        adminRequest('POST', '/admin/passkeys/options', {
          loopback: PORT,
          cookie: token,
          form: { csrf },
        }),
        ON_LOOPBACK,
      )
    ).json()) as { challenge: string; rpId: string };
    expect(options.rpId).toBe('localhost');
    const authenticator = await softwareAuthenticator('es256');
    const made = await authenticator.register({
      rpId: 'localhost',
      origin: LOCAL,
      challenge: options.challenge,
    });
    const added = await handler(
      adminRequest('POST', '/admin/passkeys/add', {
        loopback: PORT,
        cookie: token,
        form: { csrf, label: 'This machine', ...made },
      }),
      ON_LOOPBACK,
    );
    expect(added.status, await added.clone().text()).toBe(303);
    const [kept] = await world.freshRead((store) => store.listAdminPasskeys());
    // ⚠️ Not confirmed by enrolling: on Docker Desktop the tunnel container
    // reaches this listener too (docs/operating-an-instance.md), so a
    // loopback enrolment is held to the host's confirm like any other.
    expect(kept).toMatchObject({ rpId: 'localhost', listener: 'loopback', confirmedAt: null });
    expect(
      (await ownersLog(world)).find((entry) => entry.action === 'admin_passkey_enrolled'),
    ).toMatchObject({
      source: 'admin_loopback',
    });

    // It signs in on the loopback listener…
    const asked = (await (
      await handler(
        adminRequest('POST', '/admin/sign-in/passkey-options', { loopback: PORT, form: {} }),
        ON_LOOPBACK,
      )
    ).json()) as { challenge: string; allowCredentials: string[] };
    expect(asked.allowCredentials).toEqual([authenticator.credentialId]);
    const assertion = await authenticator.assert({
      rpId: 'localhost',
      origin: LOCAL,
      challenge: asked.challenge,
    });
    const signedIn = await handler(
      adminRequest('POST', '/admin/sign-in/passkey', {
        loopback: PORT,
        form: { credential: assertion.credentialId, ...assertion },
      }),
      ON_LOOPBACK,
    );
    expect(signedIn.status).toBe(303);
    expect(await sessionRow(world, cookieOf(signedIn, LOOPBACK_COOKIE) as string)).toMatchObject({
      listener: 'loopback',
      strength: 'passkey',
    });

    // …and is neither offered nor taken through the tunnel.
    const tunnelOptions = (await (
      await handler(adminRequest('POST', '/admin/sign-in/passkey-options', { form: {} }))
    ).json()) as { challenge: string; allowCredentials: string[] };
    expect(tunnelOptions.allowCredentials).toEqual([]);
    const across = await authenticator.assert({
      rpId: 'localhost',
      origin: LOCAL,
      challenge: tunnelOptions.challenge,
    });
    const refused = await handler(
      adminRequest('POST', '/admin/sign-in/passkey', {
        form: { credential: across.credentialId, ...across },
      }),
    );
    expect(refused.status).toBe(400);
  });
});

describe('owner-only on the loopback listener too (#2643, the epic’s constraint)', () => {
  it('sends a browser with no session to sign in, and ends a session once the owner key names another athlete', async () => {
    const world = await adminWorld();
    const none = await world.instance.handler(
      adminRequest('GET', '/admin', { loopback: PORT }),
      ON_LOOPBACK,
    );
    expect(none.status).toBe(303);
    expect(none.headers.get('location')).toBe('/admin/sign-in');
    const token = await loopbackSession(world);
    const moved = await handlerOver(world.path, world.clock, {
      owner: world.deputy.device.publicKey,
    });
    restarted.push(moved);
    // `handlerOver`'s admin has no loopback listener: a request marked so is no page.
    expect(
      (
        await moved.handler(
          adminRequest('GET', '/admin', { loopback: PORT, cookie: token }),
          ON_LOOPBACK,
        )
      ).status,
    ).toBe(404);
    // The world's own handler, with the owner key revoked from the account: ended.
    const database = openDatabase(world.path);
    try {
      database
        .prepare('UPDATE device_key SET revoked_at = ? WHERE public_key = ?')
        .run(Math.floor(world.clock.ms / 1000), world.owner.device.publicKey);
    } finally {
      database.close();
    }
    const after = await world.instance.handler(
      adminRequest('GET', '/admin', { loopback: PORT, cookie: token }),
      ON_LOOPBACK,
    );
    expect(after.status).toBe(503);
    expect(await sessionRow(world, token)).toBeUndefined();
  });
});

describe('the tunnel sign-in allowlist, OYL_INSTANCE_ADMIN_ADDRESSES (#2643, ADR 0069 D-5)', () => {
  it('refuses a tunnel sign-in from an address it does not list before the code is looked at, and leaves the loopback listener alone', async () => {
    const world = await adminWorld(['198.51.100.7']);
    const handler = world.instance.handler;
    const code = await mint(world);
    const outside = await handler(adminRequest('POST', '/admin/sign-in', { form: { code } }), {
      address: '203.0.113.9',
    });
    expect(outside.status).toBe(403);
    expect(await outside.text()).toContain('only from the addresses its operator listed');
    const options = await handler(
      adminRequest('POST', '/admin/sign-in/passkey-options', { form: {} }),
      {
        address: '203.0.113.9',
      },
    );
    expect(options.status).toBe(403);
    const passkey = await handler(adminRequest('POST', '/admin/sign-in/passkey', { form: {} }), {
      address: '203.0.113.9',
    });
    expect(passkey.status).toBe(403);
    // The code was never looked at: it signs in from the listed address.
    await signInWith(handler, code, { address: '198.51.100.7' });
    // The loopback listener is not asked: any address there.
    const local = await handler(
      adminRequest('POST', '/admin/sign-in', { loopback: PORT, form: { code: await mint(world) } }),
      { address: '203.0.113.9', listener: 'loopback' },
    );
    expect(local.status).toBe(303);
    await world.admin?.flushRefusals();
    expect(
      (await ownersLog(world))
        .filter((entry) => entry.action === 'admin_refused')
        .map((entry) => `${entry.source} ${String(entry.detail)}`),
    ).toEqual(['admin_tunnel address,refused=3']);
  });

  it('refuses a client whose address is unknown, fail closed, when an allowlist is set', async () => {
    const world = await adminWorld(['198.51.100.7']);
    const code = await mint(world);
    const unknown = await world.instance.handler(
      adminRequest('POST', '/admin/sign-in', { form: { code } }),
      { address: null },
    );
    expect(unknown.status).toBe(403);
  });

  it('keys an IPv6 entry by its /64, as the rate limits do, and refuses another /64', async () => {
    const world = await adminWorld(['2001:db8:1:2::1']);
    const handler = world.instance.handler;
    const code = await mint(world);
    const other = await handler(adminRequest('POST', '/admin/sign-in', { form: { code } }), {
      address: '2001:db8:1:3::1',
    });
    expect(other.status).toBe(403);
    // The same /64 is the listed network (a rider's privacy addresses rotate the low 64 bits).
    await signInWith(handler, code, { address: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' });
  });

  it('takes any address when it is empty, the default', async () => {
    const world = await adminWorld([]);
    await signInWith(world.instance.handler, await mint(world), { address: '203.0.113.9' });
  });
});
