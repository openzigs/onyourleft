// SPDX-License-Identifier: AGPL-3.0-or-later

/** The migration tool, run as an operator runs it: a separate `node` process (#769). */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../src/store/migrations/index.ts';

const TOOL = fileURLToPath(new URL('./migrate.ts', import.meta.url));
/** Read from the registry, so a new migration does not make this test stale (#865). */
const NAMES = Object.keys(MIGRATIONS);
const LAST = NAMES.at(-1) as string;

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

/** The tables a run of the tool lists after it, with their row counts. */
function tablesIn(out: string): string[] {
  return [...out.matchAll(/^ {2}(\w+): \d+ row\(s\)$/gm)].map((match) => match[1] as string);
}

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
    expect(latest.out).toContain(`latest: ${NAMES.length} migration(s) changed`);
    expect(latest.out).toContain(`applied: ${NAMES.join(', ')}\n`);
    expect(latest.out).toMatch(/ {2}result: 0 row\(s\)/);

    const down = migrate(path, 'down');
    expect(down.out).toMatch(/down: 1 migration\(s\) changed/);
    expect(down.out).not.toContain(LAST);
    expect(down.out).toContain(`applied: ${NAMES.slice(0, -1).join(', ')}\n`);
    // What the newest migration dropped is read off the two runs, never named
    // here: naming it (`sync_item` for 0009, the history index for 0010) made
    // this test the one to edit whenever a migration lands after it.
    const all = tablesIn(latest.out);
    const belowLast = tablesIn(down.out);
    expect(all.length).toBeGreaterThan(0);
    expect(all).toEqual(expect.arrayContaining(belowLast));
    // ⚠️ Not every migration creates a table: 0011 (#793) only adds a column,
    // so its `down` drops none. What holds either way is that `down` drops no
    // table the newest migration did not create, and `up` puts back every one.
    expect(belowLast.length).toBeLessThanOrEqual(all.length);

    const up = migrate(path, 'up');
    expect(up.out).toMatch(/up: 1 migration\(s\) changed/);
    expect(up.out).toContain(LAST);
    expect(tablesIn(up.out)).toEqual(all);
  });

  it('refuses status, up and down on a path with no database, and creates none', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-migrate-tool-'));
    const mistyped = join(directory, 'instnace.sqlite');
    for (const command of ['status', 'up', 'down']) {
      const run = migrate(mistyped, command);
      expect(run.status, command).toBe(2);
      expect(run.out).toMatch(/There is no database at/);
      expect(existsSync(mistyped), command).toBe(false);
    }
  });

  it('refuses a command it does not know, with usage and exit 2', () => {
    const run = migrate('/nowhere.sqlite', 'sideways');
    expect(run.status).toBe(2);
    expect(run.out).toMatch(/usage: node tools\/migrate.ts/);
  });
});
