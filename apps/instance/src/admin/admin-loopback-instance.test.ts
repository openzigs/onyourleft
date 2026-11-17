// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin pages' loopback listener as the RUNNING instance opens it
 * (#2643, ADR 0069 D-5): the production `startInstance` and its Node
 * listeners over a real SQLite file, reached over real TCP. It serves `/admin`
 * and nothing else; the main listener keeps serving everything; a request on
 * the main listener is the tunnel's whatever it carries; with the port unset
 * nothing listens; and a connection from a trusted proxy — cloudflared — is
 * closed unread.
 */

import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '../auth/crypto.ts';
import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { freeLoopbackPort, testConfig } from '../instance-testing.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { adminCode } from '../operator/commands.ts';
import { readServerConfig, type ServerConfig } from '../server-config.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { registrationFixture } from '../store/testing/index.ts';
import { ADMIN_COOKIE, LOOPBACK_COOKIE } from './admin.ts';

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

const OWNER = 'admin-loopback-owner';
const OWNER_KEY = registrationFixture(OWNER).key.publicKey;

interface Started {
  readonly instance: StartedInstance;
  readonly path: string;
  readonly loopback: number;
}

async function start(
  options: { loopback?: boolean; trustedProxies?: readonly string[] } = {},
): Promise<Started> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-admin-loopback-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const store = await openSqlStore(path);
  await store.registerAthlete(registrationFixture(OWNER));
  await store.close();
  const loopback = await freeLoopbackPort();
  const read = readServerConfig(
    {
      database: path,
      origin: TEST_ORIGIN,
      roomWorkers: '1',
      adminPages: 'on',
      ...(options.loopback === false ? {} : { adminLoopbackPort: String(loopback) }),
    },
    1,
  );
  if (!read.ok) throw new Error(read.problems.join(' '));
  const server: ServerConfig = {
    ...read.config,
    blobsPath: join(directory, 'blobs'),
    secretKey: secretBytes(7),
  };
  running = await startInstance({
    config: testConfig({
      moderators: { owner: OWNER_KEY },
      clientAddressHeader: 'cf-connecting-ip',
      trustedProxies: [...(options.trustedProxies ?? [])],
    }),
    server,
    version: '9.8.7',
    notices: 'notices',
    log: () => undefined,
    migrationPollMs: 50,
  });
  await running.opened;
  return { instance: running, path, loopback };
}

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/** One request over real TCP to `127.0.0.1:<port>`. */
function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (incoming) => {
      let text = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => (text += chunk));
      incoming.on('end', () => {
        resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const portOf = (instance: StartedInstance): number => Number(new URL(instance.url).port);

/** The code the CLI mints, on the instance's own file. */
const mint = async (path: string): Promise<string> =>
  (await adminCode({ database: path, blobs: `${path}.blobs` })).code;

/** The admin sessions the file holds, read on a store of its own. */
async function sessionsIn(path: string, token: string) {
  const store = await openSqlStore(path);
  try {
    return await store.findAdminSession(await sha256Hex(token));
  } finally {
    await store.close();
  }
}

describe('the loopback listener serves /admin and nothing else (#2643)', () => {
  it('answers the sign-in page on it, and not_found for the API, health, the sealed route and the report page — which the main listener still serves', async () => {
    const { instance, loopback } = await start();
    const local = { host: `localhost:${String(loopback)}` };
    const page = await send(loopback, 'GET', '/admin/sign-in', local);
    expect(page.status).toBe(200);
    expect(page.body).toContain('One-time code');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['access-control-allow-origin']).toBeUndefined();
    for (const [method, path] of [
      ['GET', '/v1/operate/status'],
      ['GET', '/health'],
      ['POST', '/v1/sealed'],
      ['GET', '/report'],
    ] as const) {
      const there = await send(loopback, method, path, local);
      expect(there.status, `${method} ${path} on the loopback listener`).toBe(404);
      expect(JSON.parse(there.body), path).toMatchObject({ error: { code: 'not_found' } });
      const main = await send(portOf(instance), method, path, { host: 'ride.example' });
      expect(main.status, `${method} ${path} on the main listener`).not.toBe(404);
    }
  });

  it('signs in with a code there under its own cookie, and the session is the loopback’s — read back', async () => {
    const { path, loopback } = await start();
    const local = `localhost:${String(loopback)}`;
    const answer = await send(
      loopback,
      'POST',
      '/admin/sign-in',
      {
        host: local,
        origin: `http://${local}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      `code=${await mint(path)}`,
    );
    expect(answer.status).toBe(303);
    const cookie = String(answer.headers['set-cookie']);
    const token = new RegExp(
      `^${LOOPBACK_COOKIE}=([^;]+); HttpOnly; SameSite=Strict; Path=/$`,
    ).exec(cookie)?.[1];
    expect(token, cookie).toBeDefined();
    expect((await sessionsIn(path, token as string))?.listener).toBe('loopback');
  });

  it('treats a request on the MAIN listener as the tunnel’s, whatever header it forges — and its code session changes nothing', async () => {
    const { instance, path } = await start();
    const forged = {
      host: 'ride.example',
      origin: TEST_ORIGIN,
      'x-oyl-listener': 'loopback',
      'x-listener': 'loopback',
      // From a peer that is no trusted proxy: not believed, and never a locality.
      'cf-connecting-ip': '127.0.0.1',
      'content-type': 'application/x-www-form-urlencoded',
    };
    const signedIn = await send(
      portOf(instance),
      'POST',
      '/admin/sign-in',
      forged,
      `code=${await mint(path)}`,
    );
    expect(signedIn.status).toBe(303);
    const cookie = String(signedIn.headers['set-cookie']);
    expect(cookie.startsWith(`${ADMIN_COOKIE}=`)).toBe(true);
    const token = /=([^;]+);/.exec(cookie)?.[1] as string;
    expect((await sessionsIn(path, token))?.listener).toBe('tunnel');
    // A loopback Host on the main listener is no loopback page either.
    const elsewhere = await send(portOf(instance), 'GET', '/admin/sign-in', {
      ...forged,
      host: 'localhost:8788',
    });
    expect(elsewhere.status).toBe(421);
    // The code session can make no change: a revoke is refused, nothing changed.
    const passkeys = await openSqlStore(path);
    try {
      await passkeys.addAdminPasskey({
        id: '0123456789abcdef',
        credentialId: 'AAAA',
        rpId: 'ride.example',
        algorithm: 'es256',
        publicKey: '04',
        signCount: 0,
        userHandle: 'AAAA',
        ownerKey: OWNER_KEY,
        label: 'Kept',
        listener: 'tunnel',
        enrolledAt: 1,
        lastUsedAt: null,
        confirmedAt: 1,
      });
    } finally {
      await passkeys.close();
    }
    const landing = await send(portOf(instance), 'GET', '/admin/status', {
      ...forged,
      cookie: `${ADMIN_COOKIE}=${token}`,
    });
    // The session's real token, so the revoke is refused for being a code session's, not for a missing token.
    const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(landing.body)?.[1];
    expect(csrf).toBeDefined();
    const revoked = await send(
      portOf(instance),
      'POST',
      '/admin/passkeys/0123456789abcdef/revoke',
      { ...forged, cookie: `${ADMIN_COOKIE}=${token}` },
      `csrf=${String(csrf)}&id=0123456789abcdef`,
    );
    expect(revoked.status).toBe(403);
    expect(revoked.body).toContain('Revoking a passkey needs a passkey sign-in');
    const after = await openSqlStore(path);
    try {
      expect((await after.listAdminPasskeys()).map((each) => each.id)).toEqual([
        '0123456789abcdef',
      ]);
    } finally {
      await after.close();
    }
  });
});

describe('with the port unset, and against the tunnel container (#2643, ADR 0069 D-5)', () => {
  /** Whether a TCP connection to `127.0.0.1:<port>` is accepted. */
  const connects = (port: number): Promise<string> =>
    new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve('connected');
      });
      socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
    });

  it('listens on no second port when OYL_INSTANCE_ADMIN_LOOPBACK_PORT is unset', async () => {
    const { instance, loopback } = await start({ loopback: false });
    expect(instance.adminLoopback).toBeUndefined();
    expect(await connects(loopback)).toBe('ECONNREFUSED');
    // The control: the main listener is there.
    expect(await connects(portOf(instance))).toBe('connected');
  });

  it('frees the loopback port when the instance stops', async () => {
    const { instance, loopback } = await start();
    expect(await connects(loopback)).toBe('connected');
    await instance.stop();
    running = undefined;
    expect(await connects(loopback)).toBe('ECONNREFUSED');
  });

  it('closes a connection from a trusted proxy unread, on the loopback listener and not on the main one', async () => {
    // 127.0.0.1 stands in for cloudflared's fixed address here: the peer every test connects from.
    const { instance, loopback } = await start({ trustedProxies: ['127.0.0.1'] });
    await expect(
      send(loopback, 'GET', '/admin/sign-in', { host: `localhost:${String(loopback)}` }),
    ).rejects.toThrow(/socket hang up|ECONNRESET/);
    const main = await send(portOf(instance), 'GET', '/admin/sign-in', { host: 'ride.example' });
    expect(main.status).toBe(200);
  });
});
