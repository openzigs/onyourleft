// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { rowCounts } from './backup.ts';
import { openDatabase } from './node-sqlite.ts';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

describe('rowCounts — #895 review', () => {
  it('counts a table whatever its name holds, a double quote included', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-instance-backup-'));
    const path = join(directory, 'odd.sqlite');
    const database = openDatabase(path);
    database.exec('CREATE TABLE "we""ird" (id INTEGER); INSERT INTO "we""ird" VALUES (1), (2);');
    database.close();
    expect(rowCounts(path)).toEqual({ 'we"ird': 2 });
  });
});
