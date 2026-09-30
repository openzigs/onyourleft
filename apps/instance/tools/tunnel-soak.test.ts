// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The tunnel soak's own code (#807), ridden against an instance on this
 * machine for a few seconds with one socket dropped in the middle — the
 * shape of the Cloudflare restart #807 expects daily. The real run is the
 * owner's, through the real tunnel (issue #733).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { startInstance, type StartedInstance } from '../src/instance.ts';
import { testConfig } from '../src/instance-testing.ts';
import { readServerConfig } from '../src/server-config.ts';
import { migrateForDeploy } from '../src/store/serving.ts';
import { idleProbe, soak } from './tunnel-soak-run.ts';

const CLI = fileURLToPath(new URL('../src/operator/cli.ts', import.meta.url));

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

async function instance(pingIntervalMs: string) {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-soak-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  for (const [room, kind] of [
    ['soak', 'ride'],
    ['lobby', 'race'],
  ] as const) {
    const opened = spawnSync(
      process.execPath,
      [CLI, 'room-open', room, '--kind', kind, '--length', '10000', '--countdown', '0'],
      { encoding: 'utf8', env: { ...process.env, OYL_INSTANCE_DATABASE: path } },
    );
    expect(opened.status, opened.stderr).toBe(0);
  }
  // The origin is filled in once the port is known: a device signs it.
  const port = 30_000 + Math.floor(Math.random() * 20_000);
  const origin = `http://127.0.0.1:${String(port)}`;
  const server = readServerConfig(
    { database: path, origin, registration: 'open', roomWorkers: '1', pingIntervalMs },
    1,
  );
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({ port, bodyLimitBytes: 16_384 }),
    server: server.config,
    version: '0',
    notices: '',
    log: () => undefined,
  });
  return origin;
}

describe('the tunnel soak — #807’s measurement, ridden locally', () => {
  it('records a dropped socket, the rejoin that followed, and the frames either side of it', async () => {
    const url = await instance('');
    let dropped = false;
    const report = await soak({
      url,
      roomId: 'soak',
      durationMs: 4_500,
      riders: 2,
      keepaliveMs: 30_000,
      onSocket: (rider, socket) => {
        if (rider === 1 && !dropped) {
          dropped = true;
          setTimeout(() => socket.terminate(), 1_500);
        }
      },
    });
    expect(report.disconnects).toEqual([
      { rider: 1, atSecond: expect.any(Number) as number, code: 1006 },
    ]);
    expect(report.rejoinMs).toHaveLength(1);
    expect(report.rejoinMs[0]).toBeLessThan(10_000);
    expect(report.framesReceived.every((count) => count >= 2)).toBe(true);
  }, 60_000);

  it('the idle probe says so when the instance’s own ping kept the socket from ever being idle', async () => {
    const url = await instance('1000');
    const report = await idleProbe({ url, roomId: 'lobby', maximumMs: 2_500 });
    expect(report.note).toContain('never idle');
  }, 60_000);
});
