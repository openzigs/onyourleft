// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The admin pages as the RUNNING instance mounts them (#2641, ADR 0069 D-2):
 * through the real Node listener, only when `OYL_INSTANCE_ADMIN_PAGES` is on,
 * and with the refusals counted since the last minute written as it stops.
 */

import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN } from '../auth/identity-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import { readServerConfig, type ServerConfig } from '../server-config.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { registrationFixture } from '../store/testing/index.ts';

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

const OWNER = 'admin-owner';
const OWNER_KEY = registrationFixture(OWNER).key.publicKey;

async function start(adminPages: boolean): Promise<{ instance: StartedInstance; path: string }> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-admin-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  // The owner's account, as a sign-in from the app would have made it.
  const store = await openSqlStore(path);
  await store.registerAthlete(registrationFixture(OWNER));
  await store.close();
  const read = readServerConfig(
    {
      database: path,
      origin: TEST_ORIGIN,
      roomWorkers: '1',
      adminPages: adminPages ? 'on' : 'off',
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
    config: testConfig({ moderators: { owner: OWNER_KEY } }),
    server,
    version: '9.8.7',
    notices: 'notices',
    log: () => undefined,
    migrationPollMs: 50,
  });
  await running.opened;
  return { instance: running, path };
}

/** One request over HTTP with the headers a browser on the tunnel's hostname sends. */
function send(
  url: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(`${url}${path}`, { method, headers }, (incoming) => {
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

describe('the running instance mounts the admin pages only when they are on (#2641)', () => {
  it('serves the sign-in page with the admin headers when on', async () => {
    const { instance } = await start(true);
    const page = await send(instance.url, 'GET', '/admin/sign-in', { host: 'ride.example' });
    expect(page.status).toBe(200);
    expect(page.body).toContain('One-time code');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers /admin as any path with no route when off', async () => {
    const { instance } = await start(false);
    const page = await send(instance.url, 'GET', '/admin/sign-in', { host: 'ride.example' });
    expect(page.status).toBe(404);
    expect(JSON.parse(page.body)).toMatchObject({ error: { code: 'not_found' } });
  });

  it('writes the refusals counted since the last minute as it stops', async () => {
    const { instance, path } = await start(true);
    const refused = await send(
      instance.url,
      'POST',
      '/admin/sign-in',
      {
        host: 'ride.example',
        origin: 'https://evil.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      'code=aaaa-bbbb-cccc-dddd',
    );
    expect(refused.status).toBe(403);
    await instance.stop();
    running = undefined;
    const store = await openSqlStore(path);
    try {
      expect(await store.listOperatorLogPage(undefined, 10)).toEqual([
        expect.objectContaining({
          source: 'admin_tunnel',
          actorAthleteId: null,
          action: 'admin_refused',
          detail: 'origin,refused=1',
          outcome: 'refused',
        }),
      ]);
    } finally {
      await store.close();
    }
  });
});
