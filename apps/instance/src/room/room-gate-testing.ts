// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PHYSICS_VERSION } from '@onyourleft/physics';

import { DEFAULT_BODY_LIMIT_BYTES } from '../config.ts';
import { testConfig } from '../instance-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { readServerConfig } from '../server-config.ts';
import { openSqlStore } from '../store/open-sql-store.ts';

/**
 * A REAL instance with one group-ride room in it, for the browser gate's
 * two-page room spec (#782, #771's last criterion): the production
 * `startInstance` — the handler, the identity routes, the room router and a
 * room worker process — on a loopback port, over a SQLite file in a temporary
 * directory, with registration open so two browser contexts can each sign a
 * new rider in.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it;
 * `apps/web/browser/room.browser.spec.ts` loads it by URL, the way
 * `identity.browser.spec.ts` loads `auth/identity-testing.ts`.
 */

export interface RoomGateInstance {
  /** The instance's origin, as a page types it: `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** The one room it holds: a group ride that starts on its first rider. */
  readonly roomId: string;
  close(): Promise<void>;
}

/**
 * A stand-in for the Cloudflare edge a rider's first instance is reached
 * through (#782, the owner's ruling Q3/Q6 of 2026-09-28): a TCP relay on its
 * own loopback port that passes every byte through untouched, and can be made
 * to do what a tunnel does to a WebSocket — close it from the server's side of
 * the browser, mid-ride, and be unreachable for a moment while it restarts.
 */
export interface RoomGateEdge {
  /** How many WebSocket upgrades have passed through the edge so far. */
  upgrades(): number;
  /**
   * An edge restart: every connection through the edge is dropped at once
   * (the browser sees its room socket close abnormally), and every new one is
   * dropped for `holdMs`. Answers how many WebSockets were dropped.
   */
  restart(holdMs: number): number;
}

/** A {@link RoomGateInstance} reached only through a {@link RoomGateEdge}. */
export interface EdgedRoomGateInstance extends RoomGateInstance {
  readonly edge: RoomGateEdge;
}

/** A WebSocket's opening request, read off the first bytes a browser sends. */
const UPGRADE_REQUEST = /^GET [^\r\n]* HTTP\/1\.1\r\n(?:[^\r\n]+\r\n)*upgrade:\s*websocket\r\n/i;

interface StartedEdge {
  readonly edge: RoomGateEdge;
  close(): Promise<void>;
}

/** Relay `port` (where the instance listens) to `target`, as the edge. */
async function startEdge(port: number, target: number): Promise<StartedEdge> {
  const open = new Set<Socket>();
  const sockets = new Set<Socket>();
  let upgrades = 0;
  let closedUntil = 0;
  const server = createServer((browser) => {
    if (Date.now() < closedUntil) {
      browser.destroy();
      return;
    }
    const instance = connect(target, '127.0.0.1');
    open.add(browser);
    open.add(instance);
    browser.once('data', (first: Buffer) => {
      if (UPGRADE_REQUEST.test(first.toString('latin1'))) {
        upgrades += 1;
        sockets.add(browser);
      }
    });
    const drop = (): void => {
      browser.destroy();
      instance.destroy();
      open.delete(browser);
      open.delete(instance);
      sockets.delete(browser);
    };
    for (const end of [browser, instance]) {
      end.on('error', drop);
      end.on('close', drop);
    }
    browser.pipe(instance);
    instance.pipe(browser);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    edge: {
      upgrades: () => upgrades,
      restart: (holdMs) => {
        closedUntil = Date.now() + holdMs;
        const dropped = sockets.size;
        for (const socket of [...open]) socket.destroy();
        return dropped;
      },
    },
    close: async () => {
      for (const socket of [...open]) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** A free loopback port, chosen by the operating system and let go. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

export async function startRoomGateInstance(): Promise<RoomGateInstance> {
  const port = await freePort();
  return start(port, `http://127.0.0.1:${String(port)}`);
}

/**
 * The same instance, reached only through a {@link RoomGateEdge}: its public
 * origin is the edge's, as an instance behind a tunnel names the tunnel's
 * hostname, and nothing on the page knows the instance's own port.
 */
export async function startRoomGateInstanceBehindEdge(): Promise<EdgedRoomGateInstance> {
  const port = await freePort();
  const edgePort = await freePort();
  const started = await start(port, `http://127.0.0.1:${String(edgePort)}`);
  const edge = await startEdge(edgePort, port);
  return {
    ...started,
    edge: edge.edge,
    close: async () => {
      await edge.close();
      await started.close();
    },
  };
}

async function start(port: number, origin: string): Promise<RoomGateInstance> {
  const directory = await mkdtemp(join(tmpdir(), 'oyl-room-gate-'));
  const database = join(directory, 'instance.sqlite');
  const roomId = 'gate-room';

  // The room and its course, written before the instance opens the file: a
  // level five kilometres, no countdown, the default rejoin window.
  const store = await openSqlStore(database);
  await store.putRoom({
    id: roomId,
    kind: 'group',
    visibility: 'private',
    routeSha256: '0'.repeat(64),
    physicsVersion: PHYSICS_VERSION,
  });
  await store.putRoomCourse({
    roomId,
    lengthMetres: 5_000,
    grades: [[0, 0]],
    ridingPosition: 'hoods',
    capacity: null,
    countdownMs: 0,
    rejoinWindowMs: null,
    raceStartedAt: null,
  });
  await store.close();

  // The blobs in the same temporary directory: a room's route is kept there (#784).
  const server = readServerConfig(
    { database, blobs: join(directory, 'blobs'), origin, roomWorkers: '1' },
    1,
  );
  if (!server.ok) throw new Error(server.problems.join('; '));
  const instance: StartedInstance = await startInstance({
    // The production body limit: a room's route (#784) is well past a test's 1 KiB.
    config: testConfig({ port, registration: 'open', bodyLimitBytes: DEFAULT_BODY_LIMIT_BYTES }),
    server: server.config,
    version: '0.0.0',
    notices: 'notices',
    log: () => undefined,
  });
  await instance.opened;
  return {
    origin,
    roomId,
    close: async () => {
      await instance.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
