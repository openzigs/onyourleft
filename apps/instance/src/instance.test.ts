// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The running instance, put together (#780, #791): the store opened by the
 * entry point, the accounts on it, tickets minted over HTTP and admitted by a
 * room worker in another process, readiness while a migration runs, the
 * refusal to start un-migrated, `/metrics` after a populated fixture, and a
 * SIGTERM in the middle of a race.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice } from './auth/identity-testing.ts';
import { startInstance, type InstanceOptions, type StartedInstance } from './instance.ts';
import type { SweepTimers } from './node-listener.ts';
import { testConfig } from './instance-testing.ts';
import { joinRoom, type RoomClient } from './room/node/router-testing.ts';
import { until } from './room/node/node-room-testing.ts';
import { readServerConfig, type ServerConfig } from './server-config.ts';
import { migrateForDeploy, migratingMarker, openServingStore } from './store/serving.ts';
import { migrateAllBut } from './store/testing/index.ts';

const INSTANCE = fileURLToPath(new URL('..', import.meta.url));
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const CLI = fileURLToPath(new URL('./operator/cli.ts', import.meta.url));
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

let directory: string | undefined;
let running: StartedInstance | undefined;
const clients: RoomClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function freshDirectory(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-running-'));
  return directory;
}

function serverConfig(databasePath: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const read = readServerConfig(
    { database: databasePath, origin: TEST_ORIGIN, roomWorkers: '2' },
    2,
  );
  if (!read.ok) throw new Error(read.problems.join(' '));
  return { ...read.config, blobsPath: join(databasePath, '..', 'blobs'), ...overrides };
}

async function start(
  databasePath: string,
  overrides: Partial<ServerConfig> = {},
  timing: Pick<InstanceOptions, 'now' | 'sweepTimers'> = {},
) {
  const lines: string[] = [];
  running = await startInstance({
    ...timing,
    config: testConfig({ bodyLimitBytes: 16_384, registration: 'open' }),
    server: serverConfig(databasePath, overrides),
    version: '9.8.7',
    notices: 'notices',
    log: (line) => lines.push(line),
    migrationPollMs: 50,
  });
  return { instance: running, lines };
}

/** A rider signed in over HTTP: challenge, sign with a device key, session. */
async function signIn(url: string, displayName: string) {
  const device = await testDevice();
  const challenge = (await (
    await fetch(`${url}/v1/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: device.publicKey }),
    })
  ).json()) as { nonce: string };
  const session = (await (
    await fetch(`${url}/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(await device.statement(challenge.nonce, { issuedAt: Math.floor(Date.now() / 1000) })),
        displayName,
      }),
    })
  ).json()) as { sessionToken: string; athleteId: string };
  if (typeof session.sessionToken !== 'string') throw new Error('no session');
  return session;
}

async function ticket(url: string, token: string, roomId: string): Promise<string> {
  const answer = await fetch(`${url}/v1/rooms/${roomId}/ticket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ declaredMassKilograms: 72 }),
  });
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { ticket: string }).ticket;
}

function cli(databasePath: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: INSTANCE,
    encoding: 'utf8',
    env: { ...process.env, OYL_INSTANCE_DATABASE: databasePath },
  });
}

function wsUrl(url: string): string {
  return url.replace('http://', 'ws://');
}

describe('the running instance forgets every rate-limited address when its window ends — #892', () => {
  // The privacy policy: the project's instance holds an internet address "in
  // memory only, for at most an hour". Until the merge with #895 nothing built
  // an identity on a running instance, so nothing ran the sweep; now
  // `startInstance` builds one, and must run it.
  it('sweeps on every minute boundary once the store is open, with no further request, and stops on stop', async () => {
    const path = join(await freshDirectory(), 'instance.sqlite');
    await migrateForDeploy(path);
    const clock = { ms: Date.now() };
    const pending: { at: number; run: () => void }[] = [];
    let cleared = 0;
    const timers: SweepTimers = {
      now: () => clock.ms,
      setTimeout: (run, delayMs) => {
        const entry = { at: clock.ms + delayMs, run };
        pending.push(entry);
        return entry;
      },
      clearTimeout: (handle) => {
        const at = pending.indexOf(handle as { at: number; run: () => void });
        if (at >= 0) pending.splice(at, 1);
        cleared += 1;
      },
    };
    const { instance } = await start(path, {}, { now: () => clock.ms, sweepTimers: timers });
    await instance.opened;
    await signIn(instance.url, 'Ann Rider');
    const held = instance.heldRateLimitKeys();
    expect(held).toBeGreaterThan(1);
    // The minute's limits end on the next minute boundary…
    expect(pending).toHaveLength(1);
    const minute = pending.shift()!;
    expect(minute.at % 60_000).toBe(0);
    clock.ms = minute.at;
    minute.run();
    const afterMinute = instance.heldRateLimitKeys();
    expect(afterMinute).toBeLessThan(held);
    // …and the hour's — the registration counted against the address — on
    // the hour, which is the policy's bound.
    expect(afterMinute).toBeGreaterThan(0);
    expect(pending).toHaveLength(1);
    const next = pending.shift()!;
    clock.ms = Math.ceil(next.at / 3_600_000) * 3_600_000;
    next.run();
    expect(instance.heldRateLimitKeys()).toBe(0);
    expect(pending).toHaveLength(1);
    await instance.stop();
    running = undefined;
    expect(cleared).toBe(1);
    expect(pending).toHaveLength(0);
  }, 30_000);
});

describe('the entry point opens the store — #780 (from #861: every identity route answered 503)', () => {
  it('signs a rider in, mints a ticket over HTTP, and a room worker admits it once — the second time closes 4003', async () => {
    const path = join(await freshDirectory(), 'instance.sqlite');
    await migrateForDeploy(path);
    expect(
      cli(path, 'room-open', 'ride-1', '--kind', 'ride', '--length', '10000', '--countdown', '0')
        .status,
    ).toBe(0);
    const { instance } = await start(path);

    const ann = await signIn(instance.url, 'Ann Rider');
    const annTicket = await ticket(instance.url, ann.sessionToken, 'ride-1');
    const rider = await joinRoom(wsUrl(instance.url), 'ride-1', annTicket);
    clients.push(rider);
    await until(() => rider.messages.length > 0, 'a welcome');
    expect(rider.messages[0]).toMatchObject({ type: 'welcome', riderId: 0 });

    const replay = await joinRoom(wsUrl(instance.url), 'ride-1', annTicket);
    clients.push(replay);
    expect(await replay.closed).toEqual({ code: 4003, reason: 'ticket-refused' });
    // The replay changed nothing: still one seat in the room.
    await until(() => rider.messages.some((m) => m.type === 'frame'), 'a frame', 15_000);
    const frame = rider.messages.find((m) => m.type === 'frame');
    expect(frame?.type === 'frame' && frame.riders.length).toBe(1);
  }, 60_000);

  it('serves /metrics after a populated fixture with no athlete id, display name, room id or coordinate in it — #791', async () => {
    const path = join(await freshDirectory(), 'instance.sqlite');
    await migrateForDeploy(path);
    expect(
      cli(
        path,
        'room-open',
        'secret-room-7',
        '--kind',
        'ride',
        '--length',
        '10000',
        '--countdown',
        '0',
      ).status,
    ).toBe(0);
    const token = 't'.repeat(40);
    const { instance } = await start(path, { metrics: true, metricsToken: token });
    const riders = [
      await signIn(instance.url, 'Ann Rider'),
      await signIn(instance.url, 'Zed Quux'),
    ];
    for (const rider of riders) {
      const client = await joinRoom(
        wsUrl(instance.url),
        'secret-room-7',
        await ticket(instance.url, rider.sessionToken, 'secret-room-7'),
      );
      clients.push(client);
    }
    await until(
      () => clients.every((c) => c.messages.some((m) => m.type === 'frame')),
      'frames',
      5_000,
    );
    // A request carrying a coordinate, refused, is counted by its code only.
    await fetch(`${instance.url}/v1/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: 'x', latitude: 51.501364 }),
    });
    // Without the token, or with another, there is nothing there.
    expect((await fetch(`${instance.url}/metrics`)).status).toBe(404);
    expect(
      (
        await fetch(`${instance.url}/metrics`, {
          headers: { authorization: `Bearer ${'u'.repeat(40)}` },
        })
      ).status,
    ).toBe(404);
    const metrics = await (
      await fetch(`${instance.url}/metrics`, { headers: { authorization: `Bearer ${token}` } })
    ).text();
    expect(metrics).toContain('oyl_room_connected_riders{worker="');
    expect(metrics).toMatch(/oyl_room_tick_lateness_ms\{worker="\d",quantile="0.99"\}/);
    expect(metrics).toContain(
      'oyl_http_refusals_total{route="/v1/auth/challenge",reason="validation_failed"} 1',
    );
    for (const secret of [
      ...riders.map((r) => r.athleteId),
      'Ann Rider',
      'Zed Quux',
      'secret-room-7',
      '51.50',
    ]) {
      expect(metrics).not.toContain(secret);
    }
    const connected = [...metrics.matchAll(/^oyl_room_connected_riders\{[^}]*\} (\d+)$/gm)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    expect(connected).toBe(2);
  }, 60_000);

  it('does not serve /metrics unless the operator turned it on', async () => {
    const path = join(await freshDirectory(), 'instance.sqlite');
    await migrateForDeploy(path);
    const { instance } = await start(path);
    expect((await fetch(`${instance.url}/metrics`)).status).toBe(404);
  }, 60_000);
});

describe('migrations are a deploy step — #791 criteria 5 and 8', () => {
  it('refuses to start against an un-migrated database, naming the command', async () => {
    const path = join(await freshDirectory(), 'instance.sqlite');
    const run = spawnSync(process.execPath, [MAIN], {
      cwd: INSTANCE,
      encoding: 'utf8',
      env: {
        ...process.env,
        OYL_INSTANCE_COMMIT: COMMIT,
        OYL_INSTANCE_PORT: '0',
        OYL_INSTANCE_DATABASE: path,
      },
      timeout: 20_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('node src/operator/cli.ts migrate');
  }, 60_000);

  it('is not ready — and admits no room — while a migration is running, and is once it has finished', async () => {
    const path = join(await freshDirectory(), 'instance.sqlite');
    // A box coming back from a reboot: the database is one migration behind
    // and the deploy's migrate step has started (its marker is there).
    await migrateAllBut(path, 1);
    await writeFile(migratingMarker(path), 'now\n');

    const { instance } = await start(path);
    expect((await fetch(`${instance.url}/health`)).status).toBe(200);
    const notYet = await fetch(`${instance.url}/ready`);
    expect(notYet.status).toBe(503);
    expect(await notYet.json()).toMatchObject({
      status: 'not_ready',
      checks: { migrations: 'migrating' },
    });
    await expect(joinRoom(wsUrl(instance.url), 'any', 'ticket')).rejects.toThrow(
      'upgrade answered 503',
    );
    expect(
      (await fetch(`${instance.url}/v1/auth/challenge`, { method: 'POST', body: '{}' })).status,
    ).toBe(503);

    await migrateForDeploy(path);
    await instance.opened;
    const now = await fetch(`${instance.url}/ready`);
    expect(await now.json()).toEqual({
      status: 'ready',
      checks: { database: true, migrations: 'at-head', rooms: true },
    });
  }, 60_000);
});

describe('a race rider who drops mid-race rejoins it — #895 review B1', () => {
  it('rejoins the running race through the real instance and router, with a fresh ticket, into the same seat', async () => {
    const path = join(await freshDirectory(), 'instance.sqlite');
    await migrateForDeploy(path);
    expect(
      cli(
        path,
        'room-open',
        'race-rejoin',
        '--kind',
        'race',
        '--length',
        '100000',
        '--countdown',
        '0',
      ).status,
    ).toBe(0);
    const { instance } = await start(path);
    const ann = await signIn(instance.url, 'Ann');
    const bob = await signIn(instance.url, 'Bob');
    const annFirst = await joinRoom(
      wsUrl(instance.url),
      'race-rejoin',
      await ticket(instance.url, ann.sessionToken, 'race-rejoin'),
    );
    const bobSocket = await joinRoom(
      wsUrl(instance.url),
      'race-rejoin',
      await ticket(instance.url, bob.sessionToken, 'race-rejoin'),
    );
    clients.push(annFirst, bobSocket);
    await until(() => annFirst.messages.length > 0 && bobSocket.messages.length > 0, 'welcomes');
    const annSeat = annFirst.messages[0]?.type === 'welcome' ? annFirst.messages[0].riderId : -1;
    const started = await fetch(`${instance.url}/v1/rooms/race-rejoin/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ann.sessionToken}` },
    });
    expect(started.status).toBe(200);
    await until(
      () => bobSocket.messages.some((m) => m.type === 'frame'),
      'the race running',
      15_000,
    );
    // The race has left its lobby, and the store says so.
    const fresh = openServingStore(path);
    try {
      for (let i = 0; (await fresh.getRoomCourse('race-rejoin'))?.raceStartedAt == null; i += 1) {
        if (i > 100) throw new Error('the race was never marked started');
        await new Promise((done) => setTimeout(done, 50));
      }
    } finally {
      await fresh.close();
    }

    // Ann's connection drops — a tunnel restart — and she comes back at once.
    annFirst.socket.terminate();
    const annAgain = await joinRoom(
      wsUrl(instance.url),
      'race-rejoin',
      await ticket(instance.url, ann.sessionToken, 'race-rejoin'),
    );
    clients.push(annAgain);
    await until(() => annAgain.messages.length > 0, 'an answer to the rejoin', 15_000);
    expect(annAgain.messages[0]).toMatchObject({ type: 'welcome', riderId: annSeat });
    await until(
      () => annAgain.messages.some((m) => m.type === 'frame'),
      'frames after the rejoin',
      15_000,
    );
  }, 60_000);
});

describe('graceful shutdown drains rooms — #780 criterion 6', () => {
  it('on SIGTERM mid-race tells the riders the server is stopping, and the result already final is on disk', async () => {
    const dir = await freshDirectory();
    const path = join(dir, 'instance.sqlite');
    await migrateForDeploy(path);
    expect(
      cli(path, 'room-open', 'race-1', '--kind', 'race', '--length', '40', '--countdown', '0')
        .status,
    ).toBe(0);
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const child = spawn(process.execPath, [MAIN], {
      cwd: INSTANCE,
      env: {
        ...process.env,
        OYL_INSTANCE_COMMIT: COMMIT,
        OYL_INSTANCE_PORT: String(port),
        OYL_INSTANCE_DATABASE: path,
        OYL_INSTANCE_ORIGIN: TEST_ORIGIN,
        OYL_INSTANCE_REGISTRATION: 'open',
        OYL_INSTANCE_ROOM_WORKERS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ann: { athleteId: string; sessionToken: string } | undefined;
    const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
    try {
      const url = `http://127.0.0.1:${String(port)}`;
      for (let i = 0; ; i += 1) {
        const ready = await fetch(`${url}/ready`).catch(() => undefined);
        if (ready?.status === 200) break;
        if (i > 200) throw new Error('the instance did not become ready');
        await new Promise((done) => setTimeout(done, 50));
      }
      ann = await signIn(url, 'Ann');
      const bob = await signIn(url, 'Bob');
      const annSocket = await joinRoom(
        wsUrl(url),
        'race-1',
        await ticket(url, ann.sessionToken, 'race-1'),
      );
      const bobSocket = await joinRoom(
        wsUrl(url),
        'race-1',
        await ticket(url, bob.sessionToken, 'race-1'),
      );
      clients.push(annSocket, bobSocket);
      await until(() => bobSocket.messages.length > 0 && annSocket.messages.length > 0, 'welcomes');
      const started = await fetch(`${url}/v1/rooms/race-1/start`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ann.sessionToken}` },
      });
      expect(started.status).toBe(200);
      // Ann rides hard enough to cross 40 m in a few seconds; Bob does not ride.
      let sequence = 0;
      const pedal = setInterval(() => {
        sequence += 1;
        annSocket.report(sequence, 800);
      }, 250);
      try {
        await until(
          () =>
            annSocket.messages.some(
              (m) =>
                m.type === 'frame' &&
                m.riders[0]?.decimetres !== undefined &&
                m.riders[0].decimetres >= 400,
            ),
          'Ann across the line',
          15_000,
        );
      } finally {
        clearInterval(pedal);
      }
      // Her result is final: give the room worker's report a moment to be written.
      const store = openServingStore(path);
      try {
        for (let i = 0; (await store.listRoomResults('race-1')).length === 0; i += 1) {
          if (i > 100) throw new Error('no result was written');
          await new Promise((done) => setTimeout(done, 50));
        }
      } finally {
        await store.close();
      }

      child.kill('SIGTERM');
      expect(await bobSocket.closed).toEqual({ code: 1001, reason: 'server-stopping' });
      expect(await exited).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    // Read back on a fresh connection, as a consumer would: Ann's result and
    // nobody else's, and the race marked as never to be a lobby again.
    const fresh = openServingStore(path);
    try {
      const results = await fresh.listRoomResults('race-1');
      expect(results.map((r) => r.athleteId)).toEqual([ann?.athleteId]);
      expect(results[0]?.finishMs).toBeGreaterThan(0);
      expect((await fresh.getRoomCourse('race-1'))?.raceStartedAt).not.toBeNull();
    } finally {
      await fresh.close();
    }
  }, 90_000);
});

describe('the metrics token — #895 review N3', () => {
  it('matches only the whole token, as a bearer', async () => {
    const { bearerMatches } = await import('./instance.ts');
    const token = 'x'.repeat(40);
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
    for (const header of [null, token, `Bearer ${token}y`, `Bearer ${'x'.repeat(39)}`, 'Bearer ']) {
      expect(bearerMatches(header, token), String(header)).toBe(false);
    }
    expect(bearerMatches(`Bearer ${token}`, undefined)).toBe(false);
  });
});
