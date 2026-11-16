// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin pages' sign-in and session (#2641, ADR 0069 D-1, D-4, D-8),
 * driven through the REAL handler over a real SQLite file, the code minted by
 * the operator CLI's own command function, and every guarantee read back
 * through the store or through the owner's sealed `GET /v1/operate/log` —
 * never through the page that claimed it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { runCommand } from '../operator/run.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { ADMIN_HEADERS } from './headers.ts';
import {
  adminRequest,
  cookieOf,
  csrfFrom,
  handlerOver,
  signInWith,
  TEST_HOST,
  type AdminRequestOptions,
  type HandlerOver,
} from './admin-testing.ts';
import type { AdminSessionRecord, SqlStore } from '../store/sql-store.ts';

let worlds: ModerationWorld[] = [];
let restarted: HandlerOver[] = [];
afterEach(async () => {
  await Promise.all(restarted.map((each) => each.close()));
  await Promise.all(worlds.map((each) => each.close()));
  worlds = [];
  restarted = [];
});

async function adminWorld(
  admin: NonNullable<Parameters<typeof startModerationWorld>[0]>['admin'] = {},
): Promise<ModerationWorld> {
  const world = await startModerationWorld({ admin });
  worlds.push(world);
  return world;
}

/** `operator admin-code`, as the CLI runs it, on the world's own file and clock. */
async function mint(world: ModerationWorld): Promise<string> {
  const report = await adminCode(
    { database: world.path, blobs: `${world.path}.blobs` },
    () => new Date(world.clock.ms),
  );
  return report.code;
}

const sessionOf = async (
  world: ModerationWorld,
  token: string,
): Promise<AdminSessionRecord | undefined> => {
  const sha = await sha256Hex(token);
  return world.freshRead((store) => store.findAdminSession(sha));
};

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

/** Every row of a table, read on a connection of its own. */
function rowsOf(world: ModerationWorld, table: 'admin_code' | 'admin_session'): unknown[] {
  const database = openDatabase(world.path);
  try {
    return database.prepare(`select * from ${table}`).all();
  } finally {
    database.close();
  }
}

const MINUTE = 60_000;

describe('the round trip across the boundary (#2641)', () => {
  it('a code the CLI minted, redeemed on one handler, signs the browser in on a NEW handler over the same file — once, and for 10 minutes', async () => {
    const world = await adminWorld();
    const code = await mint(world);
    const token = await signInWith(world.instance.handler, code);

    // The first handler is discarded: a new one, its own store, the same file.
    const moderators = {
      owner: world.owner.device.publicKey,
      deputy: world.deputy.device.publicKey,
    };
    const after = await handlerOver(world.path, world.clock, moderators);
    restarted.push(after);
    const landing = await after.handler(adminRequest('GET', '/admin/status', { cookie: token }));
    expect(landing.status).toBe(200);
    const page = await landing.text();
    expect(page).toContain('Signed in as the instance’s owner with a one-time code');
    // The seam's round trip: the version row read from GET /v1/operate/status.
    expect(page).toContain('<div><dt>Version</dt><dd>9.8.7</dd></div>');
    // Read back: the session is the OWNER's, never the deputy's.
    expect((await sessionOf(world, token))?.athleteId).toBe(world.owner.athleteId);

    // The same code again is refused, and opens nothing.
    const again = await after.handler(adminRequest('POST', '/admin/sign-in', { form: { code } }), {
      address: '203.0.113.7',
    });
    expect(again.status).toBe(400);
    expect(cookieOf(again)).toBeUndefined();
    expect(rowsOf(world, 'admin_session')).toHaveLength(1);

    // A code is good until its tenth minute, and not at it.
    const control = await mint(world);
    world.clock.ms += 10 * MINUTE - 1000;
    await signInWith(after.handler, control);
    const late = await mint(world);
    world.clock.ms += 10 * MINUTE;
    const expired = await after.handler(
      adminRequest('POST', '/admin/sign-in', { form: { code: late } }),
      { address: '203.0.113.8' },
    );
    expect(expired.status).toBe(400);
    expect(await expired.text()).toContain('That code was not accepted.');

    // The log records each mint (the CLI's) and each sign-in (the tunnel's).
    const log = await ownersLog(world);
    expect(log.filter((entry) => entry.action === 'admin_code_minted')).toHaveLength(3);
    const signIn = expect.objectContaining({
      source: 'admin_tunnel',
      detail: 'code',
      outcome: 'done',
    }) as unknown;
    expect(log.filter((entry) => entry.action === 'admin_sign_in')).toEqual([signIn, signIn]);
    for (const entry of log.filter((each) => each.action === 'admin_code_minted')) {
      expect(entry.source).toBe('cli');
    }
  });

  it('takes the code in either case, with or without its hyphens', async () => {
    const world = await adminWorld();
    const code = await mint(world);
    await signInWith(world.instance.handler, ` ${code.toUpperCase().replaceAll('-', ' ')} `);
  });

  it('mints a code of four groups of four from the readable alphabet, stores only its hash, and voids an unused one', async () => {
    const world = await adminWorld();
    const first = await mint(world);
    expect(first).toMatch(/^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/);
    const second = await mint(world);
    const bytes = await world.databaseBytes();
    for (const code of [first, second]) {
      expect(bytes).not.toContain(code);
      expect(bytes).not.toContain(code.replaceAll('-', ''));
    }
    // The first is void: only one code is ever live.
    const voided = await world.instance.handler(
      adminRequest('POST', '/admin/sign-in', { form: { code: first } }),
      { address: '203.0.113.9' },
    );
    expect(voided.status).toBe(400);
    await signInWith(world.instance.handler, second);
    const minted = (await ownersLog(world)).filter((entry) => entry.action === 'admin_code_minted');
    // Newest first: the second mint voided the first; the first voided nothing.
    expect(minted.map((entry) => entry.detail)).toEqual(['voided_unused', null]);
  });
});

describe('a session’s life is the instance’s to end, read from admin_session (#2641)', () => {
  it('is refused, and its row gone, after 15 minutes idle — and each use starts the idle clock again', async () => {
    const world = await adminWorld();
    const token = await signInWith(world.instance.handler, await mint(world));
    for (let use = 0; use < 3; use += 1) {
      world.clock.ms += 15 * MINUTE - 1000;
      expect(
        (await world.instance.handler(adminRequest('GET', '/admin/status', { cookie: token })))
          .status,
      ).toBe(200);
    }
    world.clock.ms += 15 * MINUTE;
    const idle = await world.instance.handler(
      adminRequest('GET', '/admin/status', { cookie: token }),
    );
    expect(idle.status).toBe(303);
    expect(idle.headers.get('location')).toBe('/admin/sign-in');
    expect(await sessionOf(world, token)).toBeUndefined();
  });

  it('is refused, and its row gone, two hours after sign-in however busy it was', async () => {
    const world = await adminWorld();
    const token = await signInWith(world.instance.handler, await mint(world));
    const opened = world.clock.ms;
    while (world.clock.ms + 10 * MINUTE < opened + 2 * 60 * MINUTE) {
      world.clock.ms += 10 * MINUTE;
      expect(
        (await world.instance.handler(adminRequest('GET', '/admin/status', { cookie: token })))
          .status,
      ).toBe(200);
    }
    world.clock.ms = opened + 2 * 60 * MINUTE;
    const old = await world.instance.handler(
      adminRequest('GET', '/admin/status', { cookie: token }),
    );
    expect(old.status).toBe(303);
    expect(await sessionOf(world, token)).toBeUndefined();
  });

  it('sends a browser with no session, or a cookie nobody issued, to sign in, changing nothing', async () => {
    const world = await adminWorld();
    const before = await ownersLog(world);
    for (const cookie of [undefined, 'A'.repeat(43), 'not a token']) {
      const answer = await world.instance.handler(
        adminRequest('GET', '/admin', cookie === undefined ? {} : { cookie }),
      );
      expect(answer.status).toBe(303);
      expect(answer.headers.get('location')).toBe('/admin/sign-in');
      const out = await world.instance.handler(
        adminRequest('POST', '/admin/sign-out', {
          ...(cookie === undefined ? {} : { cookie }),
          form: { csrf: 'x' },
        }),
      );
      expect(out.status).toBe(303);
      expect(out.headers.get('location')).toBe('/admin/sign-in');
    }
    expect(rowsOf(world, 'admin_session')).toEqual([]);
    expect(await ownersLog(world)).toEqual(before);
  });
});

describe('the owner, asked on every request (#2641, ADR 0069 D-1)', () => {
  it('ends a live session on its next request once OYL_INSTANCE_OWNER_KEY names another athlete’s key', async () => {
    const world = await adminWorld();
    const token = await signInWith(world.instance.handler, await mint(world));
    // The control: the same configuration restarted keeps the session.
    const same = await handlerOver(world.path, world.clock, {
      owner: world.owner.device.publicKey,
    });
    restarted.push(same);
    expect(
      (await same.handler(adminRequest('GET', '/admin/status', { cookie: token }))).status,
    ).toBe(200);

    const moved = await handlerOver(world.path, world.clock, {
      owner: world.deputy.device.publicKey,
    });
    restarted.push(moved);
    const csrf = await csrfFrom(same.handler, token);
    const before = await ownersLog(world);
    const out = await moved.handler(
      adminRequest('POST', '/admin/sign-out', { cookie: token, form: { csrf } }),
    );
    expect(out.status).toBe(303);
    expect(out.headers.get('location')).toBe('/admin/sign-in');
    // Read back: ended, and nothing else happened.
    expect(await sessionOf(world, token)).toBeUndefined();
    const landing = await moved.handler(adminRequest('GET', '/admin/status', { cookie: token }));
    expect(landing.status).toBe(303);
    expect(await sessionOf(world, token)).toBeUndefined();
    expect(await ownersLog(world)).toEqual(before);
    // And the old owner's cookie works on no configuration again.
    expect(
      (await same.handler(adminRequest('GET', '/admin/status', { cookie: token }))).status,
    ).toBe(303);
  });

  it('gives the deputy no sign-in: with no owner key named the pages are unavailable, and a code is not spent', async () => {
    const world = await adminWorld();
    const code = await mint(world);
    const deputyOnly = await handlerOver(world.path, world.clock, {
      deputy: world.deputy.device.publicKey,
    });
    restarted.push(deputyOnly);
    for (const request of [
      adminRequest('GET', '/admin/sign-in'),
      adminRequest('POST', '/admin/sign-in', { form: { code } }),
    ]) {
      const answer = await deputyOnly.handler(request, { address: '203.0.113.7' });
      expect(answer.status).toBe(503);
      const page = await answer.text();
      expect(page).toContain('OYL_INSTANCE_OWNER_KEY is not set');
      expect(page).not.toContain(world.deputy.device.publicKey);
      expect(page).not.toContain('<form');
    }
    expect(rowsOf(world, 'admin_session')).toEqual([]);
    // The code was never looked at: it still signs the owner in.
    await signInWith(world.instance.handler, code);
  });

  it('ends a session once OYL_INSTANCE_OWNER_KEY names another key of the SAME athlete: the key at sign-in is what is compared', async () => {
    const world = await adminWorld();
    const token = await signInWith(world.instance.handler, await mint(world));
    const second = 'cd'.repeat(32);
    await world.freshRead((store) =>
      store.putDeviceKey({
        publicKey: second,
        athleteId: world.owner.athleteId,
        addedAt: Math.floor(world.clock.ms / 1000),
        revokedAt: null,
      }),
    );
    const rotated = await handlerOver(world.path, world.clock, { owner: second });
    restarted.push(rotated);
    // The same athlete is the owner, through the new key: the pages are there.
    expect((await rotated.handler(adminRequest('GET', '/admin/sign-in'))).status).toBe(200);
    const landing = await rotated.handler(adminRequest('GET', '/admin/status', { cookie: token }));
    expect(landing.status).toBe(303);
    expect(await sessionOf(world, token)).toBeUndefined();
  });

  it('ends a session, and says the pages are unavailable, once the owner key is revoked from the account', async () => {
    const world = await adminWorld();
    const token = await signInWith(world.instance.handler, await mint(world));
    const database = openDatabase(world.path);
    try {
      database
        .prepare('UPDATE device_key SET revoked_at = ? WHERE public_key = ?')
        .run(Math.floor(world.clock.ms / 1000), world.owner.device.publicKey);
    } finally {
      database.close();
    }
    const answer = await world.instance.handler(
      adminRequest('GET', '/admin/status', { cookie: token }),
    );
    expect(answer.status).toBe(503);
    expect(await answer.text()).toContain('No account holds the device key');
    expect(await sessionOf(world, token)).toBeUndefined();
  });

  it('says why it is unavailable when no account holds the owner key, naming the variable and not the key', async () => {
    const world = await adminWorld();
    const nobody = 'ab'.repeat(32);
    const orphan = await handlerOver(world.path, world.clock, { owner: nobody });
    restarted.push(orphan);
    const answer = await orphan.handler(adminRequest('GET', '/admin/sign-in'));
    expect(answer.status).toBe(503);
    const page = await answer.text();
    expect(page).toContain('No account holds the device key OYL_INSTANCE_OWNER_KEY names');
    expect(page).not.toContain(nobody);
  });
});

describe('CSRF: three layers, and a refused POST changes nothing (#2641, ADR 0069 D-4)', () => {
  /** What each refused sign-out sends, from the session's own token and another session's. */
  type Shape = (own: { csrf: string; other: string }) => Omit<AdminRequestOptions, 'cookie'>;
  const SHAPES: readonly (readonly [string, Shape])[] = [
    ['no token', () => ({ form: {} })],
    ['a wrong token', () => ({ form: { csrf: '0'.repeat(64) } })],
    ['another session’s token', ({ other }) => ({ form: { csrf: other } })],
    ['a foreign Origin', ({ csrf }) => ({ form: { csrf }, origin: 'https://evil.example' })],
    ['no Origin', ({ csrf }) => ({ form: { csrf }, origin: null })],
    ['Sec-Fetch-Site: cross-site', ({ csrf }) => ({ form: { csrf }, site: 'cross-site' })],
    ['Sec-Fetch-Site: same-site', ({ csrf }) => ({ form: { csrf }, site: 'same-site' })],
  ];
  it.each(SHAPES)(
    'refuses a sign-out with %s, and the session still works afterwards',
    async (_name, shape) => {
      const world = await adminWorld();
      const handler = world.instance.handler;
      const token = await signInWith(handler, await mint(world));
      const other = await signInWith(handler, await mint(world), { address: '203.0.113.20' });
      const request = shape({
        csrf: await csrfFrom(handler, token),
        other: await csrfFrom(handler, other),
      });
      const refused = await handler(
        adminRequest('POST', '/admin/sign-out', { cookie: token, ...request }),
      );
      expect(refused.status).toBe(403);
      expect(refused.headers.get('set-cookie')).toBeNull();
      expect(await sessionOf(world, token)).toBeDefined();
      expect((await handler(adminRequest('GET', '/admin/status', { cookie: token }))).status).toBe(
        200,
      );
    },
  );

  it('signs out with the session’s own token from its own page: the row gone, the cookie cleared', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const token = await signInWith(handler, await mint(world));
    const out = await handler(
      adminRequest('POST', '/admin/sign-out', {
        cookie: token,
        form: { csrf: await csrfFrom(handler, token) },
      }),
    );
    expect(out.status).toBe(303);
    expect(out.headers.get('set-cookie')).toBe(
      '__Host-oyl-admin=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    );
    expect(await sessionOf(world, token)).toBeUndefined();
    expect((await handler(adminRequest('GET', '/admin/status', { cookie: token }))).status).toBe(
      303,
    );
  });

  it('refuses a sign-in from a foreign Origin before it looks at the code, which stays good', async () => {
    const world = await adminWorld();
    const code = await mint(world);
    for (const options of [
      { origin: 'https://evil.example' },
      { origin: null },
      { site: 'cross-site' },
    ]) {
      const answer = await world.instance.handler(
        adminRequest('POST', '/admin/sign-in', { form: { code }, ...options }),
        { address: '203.0.113.7' },
      );
      expect(answer.status).toBe(403);
      expect(cookieOf(answer)).toBeUndefined();
    }
    expect(rowsOf(world, 'admin_session')).toEqual([]);
    await signInWith(world.instance.handler, code);
  });

  it('sets the cookie __Host-, Secure, HttpOnly, SameSite=Strict, Path=/ with no lifetime of its own, and never adopts one the browser held', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const first = await signInWith(handler, await mint(world));
    const answer = await handler(
      adminRequest('POST', '/admin/sign-in', { cookie: first, form: { code: await mint(world) } }),
      { address: '203.0.113.7' },
    );
    expect(answer.status).toBe(303);
    const set = answer.headers.get('set-cookie') ?? '';
    expect(set).toMatch(
      /^__Host-oyl-admin=[A-Za-z0-9_-]{43}; Secure; HttpOnly; SameSite=Strict; Path=\/$/,
    );
    const second = cookieOf(answer) as string;
    expect(second).not.toBe(first);
    expect(await sessionOf(world, first)).toBeUndefined();
    expect(await sessionOf(world, second)).toBeDefined();
  });
});

describe('sign-in rate limits and the coalesced refusals (#2641, ADR 0069 D-4)', () => {
  it('refuses the eleventh attempt in a minute from one address without looking at the code', async () => {
    let lookups = 0;
    const world = await adminWorld({
      storeSeenBy: (store) =>
        new Proxy(store, {
          get: (target, key) =>
            key === 'openAdminSessionWithCode'
              ? (...args: Parameters<SqlStore['openAdminSessionWithCode']>) => {
                  lookups += 1;
                  return target.openAdminSessionWithCode(...args);
                }
              : (Reflect.get(target, key) as unknown),
        }),
    });
    const good = await mint(world);
    const from = { address: '198.51.100.4' };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const answer = await world.instance.handler(
        adminRequest('POST', '/admin/sign-in', { form: { code: 'aaaa-bbbb-cccc-dddd' } }),
        from,
      );
      expect(answer.status).toBe(400);
    }
    expect(lookups).toBe(10);
    // The eleventh — even with the right code — is refused, and nothing is asked.
    const limited = await world.instance.handler(
      adminRequest('POST', '/admin/sign-in', { form: { code: good } }),
      from,
    );
    expect(limited.status).toBe(429);
    expect(lookups).toBe(10);
    // Another address in the same minute is its own allowance.
    await signInWith(world.instance.handler, good, { address: '198.51.100.5' });
    expect(lookups).toBe(11);
  });

  it('refuses the thirty-first attempt in a minute from anybody', async () => {
    const world = await adminWorld();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const answer = await world.instance.handler(
        adminRequest('POST', '/admin/sign-in', { form: { code: 'aaaa-bbbb-cccc-dddd' } }),
        { address: `192.0.2.${String(attempt)}` },
      );
      expect(answer.status).toBe(400);
    }
    const good = await mint(world);
    const limited = await world.instance.handler(
      adminRequest('POST', '/admin/sign-in', { form: { code: good } }),
      { address: '192.0.2.200' },
    );
    expect(limited.status).toBe(429);
    world.clock.ms += MINUTE;
    await signInWith(world.instance.handler, good, { address: '192.0.2.200' });
  });

  it('writes 30 bad codes in a minute as ONE admin_refused entry carrying the count, read through GET /v1/operate/log', async () => {
    const world = await adminWorld();
    const before = await ownersLog(world);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await world.instance.handler(
        adminRequest('POST', '/admin/sign-in', { form: { code: 'aaaa-bbbb-cccc-dddd' } }),
        { address: `192.0.2.${String(attempt % 3)}` },
      );
    }
    // Nothing is written as they come.
    expect(await ownersLog(world)).toEqual(before);
    await world.admin?.flushRefusals();
    const refused = (await ownersLog(world)).filter((entry) => entry.action === 'admin_refused');
    expect(refused).toEqual([
      expect.objectContaining({
        source: 'admin_tunnel',
        detail: 'code,refused=30',
        outcome: 'refused',
      }),
    ]);
    // A minute with no refusal writes nothing.
    await world.admin?.flushRefusals();
    expect(
      (await ownersLog(world)).filter((entry) => entry.action === 'admin_refused'),
    ).toHaveLength(1);
  });

  it('counts each kind apart, one entry per kind', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const token = await signInWith(handler, await mint(world));
    await handler(adminRequest('POST', '/admin/sign-out', { cookie: token, form: {} }));
    await handler(
      adminRequest('POST', '/admin/sign-out', {
        cookie: token,
        form: {},
        origin: 'https://evil.example',
      }),
    );
    await handler(
      adminRequest('POST', '/admin/sign-in', { form: { code: 'aaaa-bbbb-cccc-dddd' } }),
      { address: '192.0.2.1' },
    );
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await handler(adminRequest('POST', '/admin/sign-in', { form: { code: 'x' } }), {
        address: '192.0.2.2',
      });
    }
    await world.admin?.flushRefusals();
    const details = (await ownersLog(world))
      .filter((entry) => entry.action === 'admin_refused')
      .map((entry) => entry.detail)
      .sort();
    expect(details).toEqual([
      'code,refused=11',
      'csrf,refused=1',
      'origin,refused=1',
      'rate_limited,refused=1',
    ]);
  });
});

describe('the operator log and the change, in one transaction (#2641)', () => {
  /** Every insert into the log refused, as a full disk or a broken log would. */
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

  it('opens no session and spends no code when the sign-in cannot be logged', async () => {
    const world = await adminWorld();
    const code = await mint(world);
    const restore = refuseLogInserts(world);
    const answer = await world.instance.handler(
      adminRequest('POST', '/admin/sign-in', { form: { code } }),
      { address: '203.0.113.7' },
    );
    expect(answer.status).toBe(500);
    expect(cookieOf(answer)).toBeUndefined();
    expect(answer.headers.get('access-control-allow-origin')).toBeNull();
    restore();
    expect(rowsOf(world, 'admin_session')).toEqual([]);
    expect(
      (rowsOf(world, 'admin_code') as { used_at: unknown }[]).map((row) => row.used_at),
    ).toEqual([null]);
    // Unspent: it signs in once the log can take the entry.
    await signInWith(world.instance.handler, code);
  });

  it('holds no code the CLI could not log', async () => {
    const world = await adminWorld();
    const restore = refuseLogInserts(world);
    await expect(mint(world)).rejects.toThrow(/the log refused this entry/);
    restore();
    expect(rowsOf(world, 'admin_code')).toEqual([]);
  });
});

describe('every /admin response carries the admin headers exactly (#2641, ADR 0069 D-4)', () => {
  it('on every page, redirect, refusal, error and the stylesheet — and no CORS header at all', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const token = await signInWith(handler, await mint(world));
    const answers: Response[] = [
      await handler(adminRequest('GET', '/admin/sign-in')),
      await handler(adminRequest('GET', '/admin/sign-in', { cookie: token })),
      await handler(adminRequest('GET', '/admin')),
      await handler(adminRequest('GET', '/admin/status', { cookie: token })),
      await handler(adminRequest('GET', '/admin/admin.css')),
      await handler(adminRequest('GET', '/admin/nowhere')),
      await handler(adminRequest('DELETE', '/admin')),
      await handler(
        adminRequest('OPTIONS', '/admin', { headers: { 'access-control-request-method': 'POST' } }),
      ),
      await handler(adminRequest('GET', '/admin', { host: 'evil.example' })),
      await handler(adminRequest('POST', '/admin/sign-in', { form: { code: 'x' } }), {
        address: '192.0.2.9',
      }),
      await handler(
        adminRequest('POST', '/admin/sign-in', {
          form: { code: 'x' },
          origin: 'https://evil.example',
        }),
      ),
      await handler(adminRequest('POST', '/admin/sign-out', { cookie: token, form: {} })),
      await handler(adminRequest('POST', '/admin/sign-in', { form: { code: 'x'.repeat(5000) } }), {
        address: '192.0.2.10',
      }),
    ];
    for (const answer of answers) {
      for (const [name, value] of Object.entries(ADMIN_HEADERS)) {
        expect(answer.headers.get(name), `${name} on ${String(answer.status)}`).toBe(value);
      }
      const names = [...answer.headers.keys()];
      expect(names.filter((name) => name.startsWith('access-control-'))).toEqual([]);
      expect(answer.headers.get('content-security-policy')).not.toContain('unsafe-inline');
      expect(
        names.filter(
          (name) =>
            !(name in ADMIN_HEADERS) &&
            !['content-type', 'location', 'set-cookie', 'allow', 'retry-after'].includes(name),
        ),
      ).toEqual([]);
    }
    expect(answers.map((answer) => answer.status)).toEqual([
      200, 303, 303, 200, 200, 404, 405, 405, 421, 400, 403, 403, 413,
    ]);
    const css = answers[4] as Response;
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(await css.text()).toContain(':focus-visible');
  });

  it('links its stylesheet and carries no inline style or script', async () => {
    const world = await adminWorld();
    const page = await (await world.instance.handler(adminRequest('GET', '/admin/sign-in'))).text();
    expect(page).toContain('<link rel="stylesheet" href="/admin/admin.css">');
    // The one script is the instance's own file (#2642), linked; nothing inline.
    const script = '<script src="/admin/passkey.js" defer></script>';
    expect(page.split(script)).toHaveLength(2);
    expect(page.replace(script, '')).not.toMatch(/<style|<script|\sstyle=|\son[a-z]+=/i);
    // A labelled field, a heading and a language: a form usable by keyboard and screen reader.
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('<label for="code">One-time code</label>');
    expect(page).toMatch(/<input type="text" id="code" name="code" autocomplete="one-time-code"/);
    expect(page).toContain('<button type="submit">Sign in</button>');
  });

  it('tells a request on another Host which address to open, with no form and no session read', async () => {
    const world = await adminWorld();
    const token = await signInWith(world.instance.handler, await mint(world));
    const answer = await world.instance.handler(
      adminRequest('GET', '/admin/status', { host: 'rebound.example', cookie: token }),
    );
    expect(answer.status).toBe(421);
    const page = await answer.text();
    expect(page).toContain(`${TEST_ORIGIN}/admin`);
    expect(page).not.toContain('<form');
    expect(page).not.toContain('signed in');
    expect(TEST_HOST).toBe('ride.example');
  });

  it('leaves /legal, /terms and /report answered with the headers they had', async () => {
    const world = await adminWorld();
    const without = await startModerationWorld();
    worlds.push(without);
    const headersOf = async (handler: ModerationWorld['instance']['handler'], path: string) =>
      Object.fromEntries((await handler(adminRequest('GET', path))).headers.entries());
    for (const path of ['/legal', '/terms', '/report']) {
      expect(await headersOf(world.instance.handler, path), path).toEqual(
        await headersOf(without.instance.handler, path),
      );
    }
    expect(await headersOf(world.instance.handler, '/report')).toEqual({
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
  });

  it('is not there at all on an instance that did not turn the admin pages on', async () => {
    const without = await startModerationWorld();
    worlds.push(without);
    const answer = await without.instance.handler(adminRequest('GET', '/admin/sign-in'));
    expect(answer.status).toBe(404);
    expect(codeOf(await answer.json())).toBe('not_found');
  });
});

describe('no secret and no coordinate in anything the admin pages say (#2641, CLAUDE.md §6)', () => {
  it('shows no page, error, log line or log entry holding a secret the instance holds', async () => {
    const world = await adminWorld();
    const handler = world.instance.handler;
    const secret = btoa(String.fromCharCode(...secretBytes(7)));
    const hostedKey = 'sk-MARKER-hosted-key-2641';
    vi.stubEnv('OYL_INSTANCE_METRICS_TOKEN', 'MARKER-metrics-token-2641-0123456789abcdef');
    vi.stubEnv('CLOUDFLARE_TUNNEL_TOKEN', 'MARKER-tunnel-token-2641');
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(
        await runCommand(
          ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'],
          {
            database: world.path,
            blobs: `${world.path}.blobs`,
            secret,
            ownerKey: world.owner.device.publicKey,
            readStandardInput: () => Promise.resolve(hostedKey),
          },
        ),
      ).toBe(0);
    } finally {
      quiet.mockRestore();
    }
    const code = await mint(world);
    const typed = 'MARKER-typed-code-2641';
    const said: string[] = [];
    const keep = async (answer: Response): Promise<Response> => {
      for (const [name, value] of answer.headers.entries()) {
        // The cookie carries its own token by design, and only there.
        if (name !== 'set-cookie') said.push(`${name}: ${value}`);
      }
      said.push(await answer.clone().text());
      return answer;
    };
    const client = { address: '203.0.113.7' };
    await keep(await handler(adminRequest('GET', '/admin/sign-in')));
    await keep(
      await handler(adminRequest('POST', '/admin/sign-in', { form: { code: typed } }), client),
    );
    const signedIn = await keep(
      await handler(adminRequest('POST', '/admin/sign-in', { form: { code } }), client),
    );
    const token = cookieOf(signedIn) as string;
    // #2645: every signed-in page, the log's newest page and a cursor refused among them.
    await keep(await handler(adminRequest('GET', '/admin', { cookie: token })));
    await keep(await handler(adminRequest('GET', '/admin/status', { cookie: token })));
    await keep(await handler(adminRequest('GET', '/admin/log', { cookie: token })));
    await keep(await handler(adminRequest('GET', '/admin/log?cursor=AAAA', { cookie: token })));
    await keep(
      await handler(adminRequest('GET', '/admin/status', { cookie: token, host: 'evil.example' })),
    );
    await keep(await handler(adminRequest('GET', '/admin/nowhere', { cookie: token })));
    await keep(
      await handler(
        adminRequest('POST', '/admin/sign-out', { cookie: token, form: { csrf: 'x' } }),
      ),
    );
    await keep(
      await handler(
        adminRequest('POST', '/admin/sign-out', {
          cookie: token,
          form: { csrf: await csrfFrom(handler, token) },
        }),
      ),
    );
    await world.admin?.flushRefusals();
    said.push(...world.instance.lines, JSON.stringify(await ownersLog(world)));
    const everything = said.join('\n');
    for (const marker of [
      secret,
      hostedKey,
      'MARKER-metrics-token-2641',
      'MARKER-tunnel-token-2641',
      world.owner.token,
      token,
      code,
      code.replaceAll('-', ''),
      typed,
      world.owner.device.publicKey,
    ]) {
      expect(everything, marker).not.toContain(marker);
    }
    vi.unstubAllEnvs();
  });
});
