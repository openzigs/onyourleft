// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /v1/operate/status` (#2604), called through the real listener, sealed,
 * as every caller who might try it. What it counts is written the way real
 * writers write it — riders registered, approved and suspended through the
 * moderation routes, a room made through `POST /v1/rooms`, analysis jobs
 * through the store on another connection — and read back through the route.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { secretBytes } from '../keys/instance-keys-testing.ts';
import {
  codeOf,
  startModerationWorld,
  startSoleModeratorWorld,
  TEST_STATEMENT,
  type ModerationWorld,
  type Rider,
  type SoleModeratorWorld,
} from '../moderation/moderation-testing.ts';
import { runCommand } from '../operator/run.ts';
import { roomBody } from '../rooms/rooms-testing.ts';
import { readServerConfig } from '../server-config.ts';
import type { OperateCounts } from '../store/sql-store.ts';
import { statusSources, tunnelReadiness } from './status.ts';

const STATUS = '/v1/operate/status';

interface StatusBody {
  readonly ready: boolean;
  readonly checks: Record<string, unknown>;
  readonly version: string;
  readonly commit: string | null;
  readonly upstream: boolean;
  readonly registration: string;
  readonly uptimeSeconds: number;
  readonly disk: readonly Record<string, unknown>[];
  readonly lastBackup: unknown;
  readonly tunnel: { readonly state: string; readonly connections: number | null };
  readonly counts: OperateCounts;
  readonly keys: string;
}

const statusOf = async (world: SoleModeratorWorld): Promise<StatusBody> => {
  const answer = await world.as(world.owner, 'GET', STATUS);
  expect(answer.status).toBe(200);
  return answer.body as StatusBody;
};

async function approve(world: SoleModeratorWorld, rider: Rider): Promise<void> {
  const answer = await world.as(
    world.owner,
    'POST',
    `/v1/moderation/registrations/${rider.athleteId}/approve`,
    { reason: 'Known' },
  );
  expect(answer.status).toBe(200);
}

async function suspend(world: SoleModeratorWorld, rider: Rider): Promise<void> {
  const answer = await world.as(
    world.owner,
    'POST',
    `/v1/moderation/athletes/${rider.athleteId}/suspend`,
    { reason: 'Abuse', statement: TEST_STATEMENT },
  );
  expect(answer.status).toBe(200);
}

/** A job for `athleteId`, written through the store on its own connection. */
async function job(world: SoleModeratorWorld, id: string, athleteId: string, at: number) {
  await world.freshRead(async (store) => {
    expect(
      await store.createAnalysisJob({
        id,
        athleteId,
        source: 'instance-local',
        templateVersion: '1',
        inputJson: '{}',
        createdAt: at,
      }),
    ).toBe('created');
  });
}

describe('GET /v1/operate/status — what it counts is what is there (#2604)', () => {
  let world: ModerationWorld;
  beforeAll(async () => {
    world = await startModerationWorld({
      registration: 'approval',
      config: { registration: 'approval' },
    });
  });
  afterAll(() => world.close());

  it('counts three active athletes, one awaiting approval and one suspended — read back through the route', async () => {
    // The owner and the deputy are active from their first sign-in.
    const approved = await world.rider('Approved');
    await approve(world, approved);
    await world.rider('Pending');
    const suspended = await world.rider('Suspended');
    await approve(world, suspended);
    await suspend(world, suspended);

    const body = await statusOf(world);
    expect(body.counts.athletes).toEqual({ active: 3, pending: 1, suspended: 1 });
    expect(body.registration).toBe('approval');
  });

  it('counts an open room and the jobs waiting and running, and nothing else of them', async () => {
    const before = await statusOf(world);
    expect(before.counts.roomsOpen).toBe(0);
    expect(before.counts.analysis).toEqual({ queued: 0, running: 0 });

    const maker = await world.rider('Maker');
    await approve(world, maker);
    const made = await world.as(maker, 'POST', '/v1/rooms', roomBody({ kind: 'group' }));
    expect(made.status).toBe(200);
    // One job running, two waiting: one open job per athlete.
    await job(world, 'running-one', world.owner.athleteId, 1);
    await world.freshRead((store) => store.claimAnalysisJob());
    await job(world, 'queued-one', world.deputy.athleteId, 2);
    await job(world, 'queued-two', maker.athleteId, 3);

    // And a room that is over, which is not counted.
    const over = await world.as(maker, 'POST', '/v1/rooms', roomBody({ kind: 'group' }));
    expect(over.status).toBe(200);
    const overId = (over.body as { roomId: string }).roomId;
    expect(await world.freshRead((store) => store.closePrivateRoom(overId, 1))).toBe(true);

    const after = await statusOf(world);
    expect(after.counts.roomsOpen).toBe(1);
    expect(after.counts.analysis).toEqual({ queued: 2, running: 1 });
    // Counts only: no id of anybody, nor of the room.
    const text = JSON.stringify(after);
    for (const id of [world.owner.athleteId, maker.athleteId]) expect(text).not.toContain(id);
    expect(text).not.toContain((made.body as { roomId: string }).roomId);
  });

  it('answers the deputy, an approved rider and one awaiting approval exactly as no route, and changes nothing', async () => {
    const approved = await world.rider('Another');
    await approve(world, approved);
    const pending = await world.rider('Waiting');
    const counts = (await statusOf(world)).counts;
    const log = await world.freshRead((store) => store.listOperatorLogPage(undefined, 200));

    const nowhere = await world.as(approved, 'GET', '/v1/no-such-route');
    for (const caller of [world.deputy, approved, pending]) {
      const answer = await world.as(caller, 'GET', STATUS);
      expect(answer).toEqual(nowhere);
      expect(codeOf(answer.body)).toBe('not_found');
    }
    const anonymous = await world.call('GET', STATUS, { signer: null });
    expect(codeOf(anonymous.body)).toBe('unauthenticated');
    const plain = await world.call('GET', STATUS, { token: world.owner.token, plain: true });
    expect(codeOf(plain.body)).toBe('sealed_required');

    // Read back through the store: nothing changed, and reading it logged nothing.
    expect((await statusOf(world)).counts).toEqual(counts);
    expect(await world.freshRead((store) => store.listOperatorLogPage(undefined, 200))).toEqual(
      log,
    );
  });
});

describe('GET /v1/operate/status — counts kept apart (#2604)', () => {
  let world: SoleModeratorWorld;
  beforeAll(async () => {
    world = await startSoleModeratorWorld({ registration: 'approval' });
  });
  afterAll(() => world.close());

  it('with athletes in two standings only, counts each in its own and none in the third', async () => {
    await world.rider('One');
    await world.rider('Two');
    const body = await statusOf(world);
    // The owner, active; two awaiting approval; nobody suspended.
    expect(body.counts.athletes).toEqual({ active: 1, pending: 2, suspended: 0 });
  });
});

describe('GET /v1/operate/status — the instance itself (#2604)', () => {
  it('says what /ready says, the version, the commit compared upstream, and how long it has been up', async () => {
    const world = await startSoleModeratorWorld({
      probes: {
        ready: () =>
          Promise.resolve({
            ready: false,
            checks: { database: true, migrations: 'migrating', rooms: true },
          }),
      },
    });
    try {
      world.clock.ms += ((3 * 24 + 4) * 60 + 5) * 60_000;
      const body = await statusOf(world);
      expect(body.ready).toBe(false);
      expect(body.checks).toEqual({ database: true, migrations: 'migrating', rooms: true });
      expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(body.upstream).toBe(true);
      expect(typeof body.version).toBe('string');
      // The sign-ins moved the clock a minute; the three days and more are the test's.
      expect(body.uptimeSeconds).toBeGreaterThanOrEqual(((3 * 24 + 4) * 60 + 5) * 60);
      expect(body.uptimeSeconds).toBeLessThan(((3 * 24 + 4) * 60 + 10) * 60);
      expect(body.lastBackup).toBeNull();
      expect(body.keys).toBe('ready');
      // A real disk under the world's directory, read without a path.
      expect(body.disk.length).toBeGreaterThan(0);
      expect(JSON.stringify(body.disk)).not.toContain(tmpdir());
    } finally {
      await world.close();
    }
  });

  it('says a modified instance is not this repository’s, so it is not compared', async () => {
    const world = await startSoleModeratorWorld({
      config: { sourceUrl: 'https://git.example/mine/onyourleft' },
    });
    try {
      expect((await statusOf(world)).upstream).toBe(false);
    } finally {
      await world.close();
    }
  });

  it('with no tunnel address says unknown and asks nothing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const resolve = vi.fn(() => Promise.resolve(['10.0.0.1']));
    const world = await startSoleModeratorWorld({
      operateStatus: { tunnel: tunnelReadiness({ url: undefined, resolve, fetch }) },
    });
    try {
      expect((await statusOf(world)).tunnel).toEqual({ state: 'unknown', connections: null });
      expect(fetch).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await world.close();
    }
  });

  it('answers the owner `unavailable` on an instance with no keys', async () => {
    const world = await startSoleModeratorWorld({ keyless: true });
    try {
      const answer = await world.as(world.owner, 'GET', STATUS);
      expect(answer.status).toBe(503);
      expect(codeOf(answer.body)).toBe('unavailable');
    } finally {
      await world.close();
    }
  });
});

describe('GET /v1/operate/status carries no secret the instance holds (#2604)', () => {
  it('holds every secret-bearing setting as a marker and returns none of them', async () => {
    const secret = btoa(String.fromCharCode(...secretBytes(7)));
    const metricsToken = 'MARKER-metrics-token-2604-0123456789abcdef';
    const discordToken = 'MARKER-discord-bot-token-2604-0123456789';
    const hostedKey = 'sk-MARKER-hosted-key-2604';
    const directory = join(tmpdir(), 'oyl-status-markers');
    const server = readServerConfig(
      {
        database: join(directory, 'instance.sqlite'),
        blobs: join(directory, 'blobs'),
        origin: 'https://ride.example',
        metrics: 'on',
        metricsToken,
        secretKey: secret,
        discordBotTokenFile: { kind: 'read', text: discordToken },
        discordGuildId: '123456789012345678',
        tunnelReadyUrl: 'http://tunnel:20241/ready',
      },
      1,
    );
    if (!server.ok) throw new Error(server.problems.join(' '));
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ status: 200, readyConnections: 4 })),
    );
    const world = await startSoleModeratorWorld({
      operateStatus: statusSources({
        // The whole server configuration, every secret in it: what is read is the builder's choice.
        server: server.config,
        keys: { show: () => Promise.reject(new Error('unused')) },
        now: () => 0,
        startedAt: 0,
        resolve: () => Promise.resolve(['172.30.87.10']),
        fetch,
        disk: {
          statfs: () => Promise.reject(new Error('no disk')),
          device: () => Promise.resolve(1),
        },
      }),
    });
    try {
      const report = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        const set = await runCommand(
          ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'],
          {
            database: world.path,
            blobs: `${world.path}.blobs`,
            secret,
            ownerKey: world.owner.device.publicKey,
            readStandardInput: () => Promise.resolve(hostedKey),
          },
        );
        expect(set).toBe(0);
      } finally {
        report.mockRestore();
      }
      const answer = await world.as(world.owner, 'GET', STATUS);
      expect(answer.status).toBe(200);
      // The tunnel was asked, at the address it resolved to: the sources were live.
      expect((answer.body as StatusBody).tunnel).toEqual({ state: 'ready', connections: 4 });
      expect((fetch.mock.calls[0]?.[0] as URL | undefined)?.href).toBe(
        'http://172.30.87.10:20241/ready',
      );
      const body = JSON.stringify(answer.body);
      for (const marker of [
        secret,
        metricsToken,
        discordToken,
        hostedKey,
        world.owner.token,
        world.owner.device.publicKey,
        directory,
        'tunnel:20241',
      ]) {
        expect(body).not.toContain(marker);
      }
    } finally {
      await world.close();
    }
  });
});
