// SPDX-License-Identifier: AGPL-3.0-or-later

/** The migration tool, run as an operator runs it: a separate `node` process (#769). */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const TOOL = fileURLToPath(new URL('./migrate.ts', import.meta.url));

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function migrate(...args: string[]): { status: number | null; out: string } {
  const run = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('tools/migrate.ts (#769)', () => {
  it('migrates to the latest, one down, and one up again, printing what is applied', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-migrate-tool-'));
    const path = join(directory, 'instance.sqlite');

    const latest = migrate(path, 'latest');
    expect(latest.status, latest.out).toBe(0);
    expect(latest.out).toMatch(/latest: 3 migration\(s\) changed/);
    expect(latest.out).toMatch(/applied: 0001-[^\n]*, 0003-rooms-and-results\n/);
    expect(latest.out).toMatch(/ {2}result: 0 row\(s\)/);

    const down = migrate(path, 'down');
    expect(down.out).toMatch(/down: 1 migration\(s\) changed/);
    expect(down.out).not.toMatch(/0003-rooms-and-results/);
    expect(down.out).not.toMatch(/ {2}result:/);

    const up = migrate(path, 'up');
    expect(up.out).toMatch(/up: 1 migration\(s\) changed/);
    expect(up.out).toMatch(/0003-rooms-and-results/);
  });

  it('refuses a command it does not know, with usage and exit 2', () => {
    const run = migrate('/nowhere.sqlite', 'sideways');
    expect(run.status).toBe(2);
    expect(run.out).toMatch(/usage: node tools\/migrate.ts/);
  });
});
