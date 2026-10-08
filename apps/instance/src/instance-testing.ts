// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Identity } from './auth/identity.ts';
import type { Config } from './config.ts';
import type { InstanceProbes } from './route-kit.ts';
import { createHandler, type Handler } from './handler.ts';
import type { Route } from './routes.ts';
import type { History } from './history/history.ts';
import type { Rooms } from './rooms/rooms.ts';
import type { Sync } from './sync/sync.ts';
import { createServer } from 'node:net';

import { listen, type Listening } from './node-listener.ts';

/**
 * An instance for a test: the real handler behind the real Node listener on a
 * port the operating system chose, with every log line kept.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

/**
 * A free loopback port, chosen by the operating system and let go, for a test
 * that must know its instance's origin before the instance listens (a device
 * signs the origin, so it has to name the port).
 *
 * ⚠️ Never a port drawn at random (#954): one drawn from 30 000–50 000 lands
 * in Linux's ephemeral range (32 768–60 999), where every other test worker's
 * outbound sockets take their ports, and on a busy runner it was taken —
 * `listen EADDRINUSE`. The operating system hands out a port nothing holds.
 */
export async function freeLoopbackPort(): Promise<number> {
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

export const TEST_COMMIT = '0123456789abcdef0123456789abcdef01234567';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    commit: TEST_COMMIT,
    sourceUrl: `https://github.com/openzigs/onyourleft/tree/${TEST_COMMIT}`,
    bodyLimitBytes: 1024,
    registration: 'approval',
    moderators: {},
    publicRooms: { minimumAccountDays: 7, minimumCompletedRides: 3 },
    clientAddressHeader: null,
    trustedProxies: [],
    history: { kind: 'off', code: 'not-set', reason: 'A test instance has no embedding model.' },
    analysis: { kind: 'off', code: 'not-set', reason: 'A test instance has no analysis model.' },
    name: null,
    ...overrides,
  };
}

export interface TestInstance {
  readonly handler: Handler;
  readonly listening: Listening;
  readonly url: string;
  readonly lines: string[];
}

export async function startTestInstance(
  options: {
    config?: Partial<Config>;
    routes?: readonly Route[];
    notices?: string;
    identity?: Identity;
    sync?: Sync;
    history?: History;
    rooms?: Rooms;
    probes?: InstanceProbes;
  } = {},
): Promise<TestInstance> {
  const lines: string[] = [];
  const config = testConfig(options.config);
  const handler = createHandler({
    config,
    version: '9.8.7',
    notices: options.notices ?? 'notices',
    log: (line) => lines.push(line),
    ...(options.routes === undefined ? {} : { routes: options.routes }),
    ...(options.identity === undefined ? {} : { identity: options.identity }),
    ...(options.sync === undefined ? {} : { sync: options.sync }),
    ...(options.history === undefined ? {} : { history: options.history }),
    ...(options.rooms === undefined ? {} : { rooms: options.rooms }),
    ...(options.probes === undefined ? {} : { probes: options.probes }),
  });
  const listening = await listen(handler, {
    host: '127.0.0.1',
    port: 0,
    clientAddressHeader: config.clientAddressHeader,
    trustedProxies: config.trustedProxies,
  });
  return { handler, listening, url: listening.url, lines };
}
