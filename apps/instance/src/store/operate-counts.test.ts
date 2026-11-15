// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's Status counts (#2604) are answered from indexes, not scans
 * (#2622's review): each of `OPERATE_COUNT_QUERIES` is planned against a
 * database migrated to the head, and its plan read back. What they count is
 * `operate/status-route.test.ts`'s, through the route.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase } from './node-sqlite.ts';
import { openSqlStore } from './open-sql-store.ts';
import { OPERATE_COUNT_QUERIES } from './sql-store.ts';

let directory: string;
let path: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oyl-operate-counts-'));
  path = join(directory, 'instance.sqlite');
  await (await openSqlStore(path)).close();
});
afterAll(() => rm(directory, { recursive: true, force: true }));

function plan(query: string): string {
  const database = openDatabase(path);
  try {
    const rows = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as { detail: string }[];
    return rows.map((row) => row.detail).join(' | ');
  } finally {
    database.close();
  }
}

describe('the owner’s Status counts, from indexes (#2604)', () => {
  it('counts the open rooms from migration 0041’s partial index', () => {
    const [rooms] = OPERATE_COUNT_QUERIES;
    expect(plan(rooms)).toMatch(/USING (COVERING )?INDEX private_room_open\b/);
  });

  it('counts the queued and running jobs from analysis_job_by_status', () => {
    const [, queued, running] = OPERATE_COUNT_QUERIES;
    for (const query of [queued, running]) {
      expect(plan(query)).toMatch(/USING (COVERING )?INDEX analysis_job_by_status \(status=\?\)/);
    }
  });
});
