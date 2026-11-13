// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The tunnel soak's own code (#807), ridden against an instance on this
 * machine for a few seconds with one socket dropped in the middle — the
 * shape of the Cloudflare restart #807 expects daily. The real run is the
 * owner's, through the real tunnel (issue #733).
 *
 * Each case runs inside Vitest's 5 s default (#1688, #2569): a room sends a
 * frame a second, so the soak lasts only as long as its frames take. Each
 * instance opens only the room its case rides, by the operator command's own
 * function in this process: the CLI's process cost more than the probe on a
 * CI runner, and `operator/commands.test.ts` runs the CLI.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startInstance, type StartedInstance } from '../src/instance.ts';
import { freeLoopbackPort, testConfig } from '../src/instance-testing.ts';
import { roomOpen } from '../src/operator/commands.ts';
import { readServerConfig } from '../src/server-config.ts';
import { migrateForDeploy } from '../src/store/serving.ts';
import { idleProbe, soak } from './tunnel-soak-run.ts';

/**
 * How long the soak rides: past the room's second frame, which comes two
 * seconds after the riders sign in, so a rider dropped at the first has a frame
 * either side of the drop. 1 700 ms was too short to see it; the rest is slack
 * for signing in and a late frame on a busy runner.
 */
const SOAK_MS = 2_800;
/** The room host's ping in the idle probe's case: often enough that the probe can be short. */
const PING_MS = 200;

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

/**
 * An instance with one room open, `room` of `kind`. `pingIntervalMs` is the
 * room host's own and is not read through `readServerConfig`, whose floor of
 * 1 000 ms is an operator's and is tested in `server-config.test.ts`.
 */
async function instance(room: string, kind: 'ride' | 'race', pingIntervalMs = 0) {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-soak-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  await roomOpen({ database: path, blobs: join(directory, 'blobs') }, room, {
    kind,
    lengthMetres: 10_000,
    countdownMs: 0,
  });
  // The origin is filled in once the port is known: a device signs it. The
  // port is the operating system's choice, never a random one (#954).
  const port = await freeLoopbackPort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const server = readServerConfig({ database: path, origin, roomWorkers: '1' }, 1);
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({ port, bodyLimitBytes: 16_384, registration: 'open' }),
    server: { ...server.config, pingIntervalMs },
    version: '0',
    notices: '',
    log: () => undefined,
  });
  return origin;
}

describe('the tunnel soak — #807’s measurement, ridden locally', () => {
  it('records a dropped socket, the rejoin that followed, and the frames either side of it', async () => {
    const url = await instance('soak', 'ride');
    let dropped = false;
    const report = await soak({
      url,
      roomId: 'soak',
      durationMs: SOAK_MS,
      riders: 2,
      keepaliveMs: 30_000,
      onSocket: (rider, socket) => {
        if (rider === 1 && !dropped) {
          dropped = true;
          // At its first frame, once the soak has counted it: the frame before the drop.
          socket.on('message', (data) => {
            if ((data as Buffer).toString('utf8').includes('"type":"frame"')) socket.terminate();
          });
        }
      },
    });
    expect(report.disconnects).toEqual([
      { rider: 1, atSecond: expect.any(Number) as number, code: 1006 },
    ]);
    expect(report.rejoinMs).toHaveLength(1);
    expect(report.rejoinMs[0]).toBeLessThan(10_000);
    expect(report.framesReceived.every((count) => count >= 2)).toBe(true);
  });

  it('the idle probe says so when the instance’s own ping kept the socket from ever being idle', async () => {
    const url = await instance('lobby', 'race', PING_MS);
    const report = await idleProbe({ url, roomId: 'lobby', maximumMs: 4 * PING_MS });
    expect(report.note).toContain('never idle');
  });
});
