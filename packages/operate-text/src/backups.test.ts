// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { MODERATORS_ALWAYS_JOIN, REGISTRATION_MODE_TEXT } from './accounts';
import {
  BACK_UP_NOW_CONFIRM_TEXT,
  backupFactRows,
  backupLine,
  BACKUP_OFF_BOX_TEXT,
  backupsStaleText,
  RESTORE_ONE_OFF_TEXT,
  restoreSteps,
  snapshotPlace,
} from './backups';
import * as everything from './index';

const HOUR = 3600;

/**
 * Two `GET /v1/operate/backups` records in the route's own shape
 * (`apps/instance/src/operate/routes.ts` §`backupRecordSchema`), synthetic: a
 * scheduled snapshot and the pre-deploy one-off, whose interval is `null`.
 */
const SCHEDULED = {
  outcome: 'done',
  id: 2,
  at: '2026-11-14T18:00:00.000Z',
  ageSeconds: 3 * HOUR,
  snapshot: 'snapshot-20261114T180000Z',
  rows: 1204,
  blobs: 37,
  sizeBytes: 48_000_000,
  offBox: 'copied',
  intervalSeconds: 6 * HOUR,
  requested: false,
} as const;
const ONE_OFF = {
  ...SCHEDULED,
  id: 1,
  snapshot: 'snapshot-20261114T120000Z',
  intervalSeconds: null,
};

describe('the Backups section’s words (#2644)', () => {
  it('places a scheduled snapshot under /backups, and a one-off under pre-deploy', () => {
    expect(snapshotPlace(SCHEDULED)).toBe('/backups/snapshot-20261114T180000Z');
    expect(snapshotPlace(ONE_OFF)).toBe('/backups/pre-deploy/snapshot-20261114T120000Z');
    expect(RESTORE_ONE_OFF_TEXT).toContain('/backups/pre-deploy');
  });

  it('says how stale the newest scheduled snapshot is, from zero to the largest age', () => {
    expect(backupsStaleText(13 * HOUR, 6 * HOUR)).toBe(
      'The newest scheduled snapshot is 13 hours old, more than twice the backup interval of 6 hours: a backup was missed.',
    );
    expect(backupsStaleText(Number.MAX_SAFE_INTEGER, 0)).toBe(
      'The newest scheduled snapshot is 104249991374 days 7 hours old, more than twice the backup interval of less than a minute: a backup was missed.',
    );
  });

  it('names each off-box state', () => {
    expect(BACKUP_OFF_BOX_TEXT[SCHEDULED.offBox]).toBe('off-box copy made');
    expect(BACKUP_OFF_BOX_TEXT.failed).toBe('off-box copy FAILED');
    expect(BACKUP_OFF_BOX_TEXT['not-configured']).toBe('no off-box copy is set up');
    expect(BACK_UP_NOW_CONFIRM_TEXT).toContain('the oldest one beyond that number is removed');
  });
});

describe('the Accounts section’s words (#2644)', () => {
  it('has a short line and a sentence for every mode, in the order the steps name them', () => {
    expect(Object.keys(REGISTRATION_MODE_TEXT)).toEqual(['approval', 'invite', 'open', 'closed']);
    for (const { short, meaning } of Object.values(REGISTRATION_MODE_TEXT)) {
      expect(short).not.toBe('');
      expect(meaning).toMatch(/\.$/);
    }
    expect(MODERATORS_ALWAYS_JOIN).toContain('owner and deputy');
  });
});

describe('the package’s sentences (ADR 0004 D)', () => {
  it('carries no digit run that could be a coordinate, and no environment value', () => {
    const sentences = Object.entries(everything).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    expect(sentences.length).toBeGreaterThan(10);
    for (const [name, sentence] of sentences) {
      // A coordinate is digits, a point and more digits; a secret is a value
      // after `=`. Neither belongs in a fixed sentence.
      expect(sentence, name).not.toMatch(/\d+\.\d+/);
      expect(sentence, name).not.toMatch(/=/);
    }
  });
});

describe('a record’s line, its facts and the restore steps (#2647)', () => {
  const text = (line: readonly (string | { readonly code: string })[]): string =>
    line.map((part) => (typeof part === 'string' ? part : part.code)).join('');

  it('says a snapshot’s age, size, counts and off-box copy, and a failed run’s code', () => {
    const doneRecord = {
      outcome: 'done',
      at: '2026-11-14T18:00:00.000Z',
      ageSeconds: 3 * HOUR,
      snapshot: 'snapshot-a',
      rows: 1,
      blobs: 2,
      sizeBytes: 48_000_000,
      offBox: 'failed',
      intervalSeconds: null,
      requested: true,
    } as const;
    const done = backupLine(
      {
        outcome: 'done',
        at: '2026-11-14T18:00:00.000Z',
        ageSeconds: 3 * HOUR,
        snapshot: 'snapshot-a',
        rows: 1,
        blobs: 2,
        sizeBytes: 48_000_000,
        offBox: 'failed',
        intervalSeconds: null,
        requested: true,
      },
      'UTC',
    );
    expect(done.moment).toBe('2026-11-14 18:00 UTC');
    // #2917: in the zone it is given, named.
    expect(
      backupLine({ ...doneRecord, at: '2026-11-14T18:00:00.000Z' }, 'America/New_York').moment,
    ).toBe('2026-11-14 13:00 EST');
    expect(text(done.rest)).toBe(
      ', 3 hours ago, asked for from the app, a one-off: 48 MB, 1 row, 2 blobs; off-box copy FAILED. snapshot-a',
    );
    const failed = backupLine(
      {
        outcome: 'failed',
        at: '2026-11-14T18:00:00.000Z',
        ageSeconds: 60,
        error: 'ENOSPC',
        intervalSeconds: 3600,
        requested: false,
      },
      'UTC',
    );
    expect(failed.rest).toEqual([
      ', 1 minute ago: no snapshot was made (',
      { code: 'ENOSPC' },
      ').',
    ]);
  });

  it('writes the restore steps for the snapshot’s own place, a one-off under pre-deploy', () => {
    const steps = restoreSteps({
      snapshot: 'snapshot-b',
      intervalSeconds: null,
      rows: 3,
      blobs: 1,
    });
    expect(steps).toHaveLength(5);
    expect(text(steps[1] ?? [])).toContain('restore /backups/pre-deploy/snapshot-b --force');
    expect(text(steps[3] ?? [])).toContain('it should say 3 rows and 1 blob.');
  });

  it('lists the facts the line does not say, a missing one as not recorded', () => {
    expect(
      backupFactRows({
        databaseSha256: 'ab',
        removed: null,
        freeBytes: { backups: 2_000_000_000, offBox: null },
        intervalSeconds: 6 * HOUR,
      }).map((row) => [row.label, row.value]),
    ).toEqual([
      ['Database SHA-256', 'ab'],
      ['Old snapshots removed', 'not recorded'],
      ['Where snapshots go', '2.0 GB free'],
      ['Where off-box copies go', 'not recorded'],
      ['Backup interval', 'every 6 hours'],
    ]);
  });
});
