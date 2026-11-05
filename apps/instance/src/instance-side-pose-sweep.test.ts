// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The running instance sweeps the side pose's local-model hour on the hour
 * (#2175), from #2192: `side-pose.test.ts` tests what `sweep()` forgets, and
 * nothing failed when `instance.ts` stopped calling it — one hour's athlete
 * ids would then stay in memory until the next picture.
 *
 * `sweep()` answers only how many athletes are still counted, and the running
 * instance exposes no count of its own, so this wraps the real
 * `createSidePose` and counts the calls that the instance's own timers make.
 * Its own file because `vi.mock` holds for a whole file.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ANALYSIS_SWEEP_PERIOD_MS } from './analysis/jobs.ts';
import { TEST_ORIGIN } from './auth/identity-testing.ts';
import { startInstance, type StartedInstance } from './instance.ts';
import { testConfig } from './instance-testing.ts';
import type { SweepTimers } from './node-listener.ts';
import { readServerConfig } from './server-config.ts';
import { migrateForDeploy } from './store/serving.ts';

const swept = vi.hoisted(() => ({ count: 0 }));

vi.mock('./camera/side-pose.ts', async (original) => {
  const real = await original<typeof import('./camera/side-pose.ts')>();
  return {
    ...real,
    createSidePose: (options: Parameters<typeof real.createSidePose>[0]) => {
      const service = real.createSidePose(options);
      return {
        ...service,
        sweep: () => {
          swept.count += 1;
          return service.sweep();
        },
      };
    },
  };
});

let directory: string | undefined;
let running: StartedInstance | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('the running instance sweeps the local picture model’s hour — #2175, #2192', () => {
  it('once when the store opens, and again on every hour the jobs are swept on', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-side-pose-'));
    const path = join(directory, 'instance.sqlite');
    await migrateForDeploy(path);
    const read = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '2' }, 2);
    if (!read.ok) throw new Error(read.problems.join(' '));
    // A pinned epoch 13 min 20 s into an hour, as `instance.test.ts` pins one.
    const clock = { ms: 1_790_000_000_000 };
    const pending: { at: number; run: () => void }[] = [];
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
      },
    };
    running = await startInstance({
      now: () => clock.ms,
      sweepTimers: timers,
      config: testConfig({ bodyLimitBytes: 16_384, registration: 'open' }),
      server: { ...read.config, blobsPath: join(directory, 'blobs') },
      version: '9.8.7',
      notices: 'notices',
      log: () => undefined,
      migrationPollMs: 50,
    });
    await running.opened;
    expect(swept.count).toBe(1);
    // The jobs' hourly sweep — the one timer armed on the next hour that runs
    // the jobs' sweep — is the one the picture model's hour goes with.
    const hour = Math.ceil(clock.ms / ANALYSIS_SWEEP_PERIOD_MS) * ANALYSIS_SWEEP_PERIOD_MS;
    const onTheHour = pending.filter((entry) => entry.at === hour);
    expect(onTheHour.length).toBeGreaterThan(0);
    clock.ms = hour;
    for (const entry of onTheHour) {
      pending.splice(pending.indexOf(entry), 1);
      entry.run();
    }
    expect(swept.count).toBe(2);
  }, 30_000);
});
