// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PHYSICS_VERSION } from '@onyourleft/physics';

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

  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  // The blobs in the same temporary directory: a room's route is kept there (#784).
  const server = readServerConfig(
    { database, blobs: join(directory, 'blobs'), origin, roomWorkers: '1' },
    1,
  );
  if (!server.ok) throw new Error(server.problems.join('; '));
  const instance: StartedInstance = await startInstance({
    config: testConfig({ port, registration: 'open' }),
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
