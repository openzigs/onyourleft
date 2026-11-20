// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { REGISTRATION_MODE_TEXT } from './accounts';
import {
  compareWithMainUrl,
  DISK_LOW_WARNING,
  diskRow,
  lastBackupRow,
  NOT_RECORDED,
  statusRows,
  tunnelText,
  TUNNEL_NOT_KNOWN,
  type OperateRow,
  type OperateStatusAnswer,
} from './status';

const HOUR = 3600;
const NOW = Date.parse('2026-11-14T21:00:00.000Z');
const LARGEST = Number.MAX_SAFE_INTEGER;

/**
 * A `GET /v1/operate/status` answer in the route's own shape
 * (`apps/instance/src/operate/routes.ts` §`statusSchema`), with synthetic
 * values: counts, closed words and a made-up commit — no host path, no key,
 * nobody's name or id. The tunnel is as the app's port hands it on, without
 * the route's `connections: null` beside a state that is not `ready`.
 */
const ANSWER: OperateStatusAnswer = {
  ready: true,
  checks: { database: true, migrations: 'at-head', rooms: true },
  version: '0.0.0',
  commit: '0123456789abcdef0123456789abcdef01234567',
  upstream: true,
  registration: 'approval',
  uptimeSeconds: (3 * 24 + 4) * HOUR + 17 * 60,
  disk: [
    { holds: 'database', freeBytes: 412_000_000_000, totalBytes: 500_000_000_000, low: false },
    { holds: 'blobs', freeBytes: 20_000_000_000, totalBytes: 1_000_000_000_000, low: true },
  ],
  lastBackup: { at: '2026-11-14T08:00:00.000Z', offBox: 'copied', intervalSeconds: 6 * HOUR },
  tunnel: { state: 'ready', connections: 4 },
  counts: {
    athletes: { active: 3, pending: 1, suspended: 1 },
    roomsOpen: 2,
    analysis: { queued: 2, running: 1 },
  },
  keys: 'ready',
};

const plain = (label: string, value: string): OperateRow => ({
  label,
  value,
  code: false,
  warning: null,
});

describe('statusRows — the Status section, as rows of label and value (#2644)', () => {
  it('turns the answer into every row, in the order it is drawn, and nothing else', () => {
    expect(statusRows(ANSWER, NOW, 'UTC')).toEqual([
      plain('Version', '0.0.0'),
      {
        label: 'Deployed commit',
        value: '0123456789abcdef0123456789abcdef01234567',
        code: true,
        warning: null,
      },
      plain('Database', 'ok'),
      plain('Migrations', 'up to date'),
      plain('Rooms', 'ok'),
      plain('Up for', '3 days 4 hours'),
      plain('Disk holding the database', '412 GB free of 500 GB'),
      {
        label: 'Disk holding the blobs',
        value: '20 GB free of 1.0 TB',
        code: false,
        warning: { label: 'Low', text: 'Less than a tenth of this disk is free.' },
      },
      {
        label: 'Last backup',
        value: '2026-11-14 08:00 UTC, 13 hours ago; its off-box copy succeeded.',
        code: false,
        warning: {
          label: 'Stale',
          text: 'That is more than twice the backup interval of 6 hours: a backup was missed.',
        },
      },
      plain('Tunnel', 'ready, 4 connections'),
      plain('Registration', 'approval: a moderator approves each account'),
      plain('Accounts', '3 active, 1 awaiting approval, 1 suspended'),
      plain('Rooms open', '2'),
      plain('Analysis jobs', '2 waiting, 1 running'),
      plain('Instance keys', 'ready'),
    ]);
  });

  it('says what is missing when nothing is named, measured or recorded', () => {
    const rows = statusRows(
      {
        ...ANSWER,
        ready: false,
        checks: { database: false, migrations: 'behind', rooms: false },
        commit: null,
        disk: [],
        lastBackup: null,
        tunnel: { state: 'unknown' },
        keys: 'no-secret',
      },
      NOW,
      'UTC',
    );
    const value = (label: string) => rows.find((each) => each.label === label);
    expect(value('Deployed commit')).toEqual(plain('Deployed commit', 'not named'));
    expect(value('Database')?.value).toBe('not ok');
    expect(value('Migrations')?.value).toBe('behind this build: run migrate');
    expect(value('Rooms')?.value).toBe('not ok');
    expect(value('Disk')).toEqual(plain('Disk', 'not known'));
    expect(value('Last backup')).toEqual(plain('Last backup', NOT_RECORDED));
    expect(value('Tunnel')?.value).toBe(TUNNEL_NOT_KNOWN);
    expect(value('Instance keys')?.value).toBe('no secret key set');
  });

  it('reads zero as a count, never as missing', () => {
    const rows = statusRows(
      {
        ...ANSWER,
        uptimeSeconds: 0,
        disk: [{ holds: 'database_and_blobs', freeBytes: 0, totalBytes: 0, low: true }],
        tunnel: { state: 'ready', connections: 0 },
        counts: {
          athletes: { active: 0, pending: 0, suspended: 0 },
          roomsOpen: 0,
          analysis: { queued: 0, running: 0 },
        },
      },
      NOW,
      'UTC',
    );
    const value = (label: string) => rows.find((each) => each.label === label)?.value;
    expect(value('Up for')).toBe('less than a minute');
    expect(value('Disk holding the database and blobs')).toBe('0 bytes free of 0 bytes');
    expect(value('Tunnel')).toBe('ready, 0 connections');
    expect(value('Accounts')).toBe('0 active, 0 awaiting approval, 0 suspended');
    expect(value('Rooms open')).toBe('0');
    expect(value('Analysis jobs')).toBe('0 waiting, 0 running');
  });

  it('holds at the largest count the route may send', () => {
    const rows = statusRows(
      {
        ...ANSWER,
        uptimeSeconds: LARGEST,
        disk: [{ holds: 'blobs', freeBytes: LARGEST, totalBytes: LARGEST, low: false }],
        tunnel: { state: 'ready', connections: LARGEST },
        counts: {
          athletes: { active: LARGEST, pending: LARGEST, suspended: LARGEST },
          roomsOpen: LARGEST,
          analysis: { queued: LARGEST, running: LARGEST },
        },
      },
      NOW,
      'UTC',
    );
    const value = (label: string) => rows.find((each) => each.label === label)?.value;
    expect(value('Up for')).toBe('104249991374 days 7 hours');
    expect(value('Disk holding the blobs')).toBe('9007 TB free of 9007 TB');
    expect(value('Tunnel')).toBe('ready, 9007199254740991 connections');
    expect(value('Rooms open')).toBe('9007199254740991');
  });

  it('names every word of every closed table the answer can carry', () => {
    for (const migrations of ['at-head', 'migrating', 'behind', 'ahead', 'unknown'] as const) {
      const rows = statusRows({ ...ANSWER, checks: { ...ANSWER.checks, migrations } }, NOW, 'UTC');
      expect(rows.find((each) => each.label === 'Migrations')?.value).toMatch(/^[a-z]/);
    }
    for (const keys of [
      'ready',
      'no-secret',
      'no-origin',
      'no-keys',
      'unreadable',
      'busy',
    ] as const) {
      const rows = statusRows({ ...ANSWER, keys }, NOW, 'UTC');
      expect(rows.find((each) => each.label === 'Instance keys')?.value).toMatch(/^[a-z]/);
    }
    for (const registration of ['approval', 'invite', 'open', 'closed'] as const) {
      const rows = statusRows({ ...ANSWER, registration }, NOW, 'UTC');
      expect(rows.find((each) => each.label === 'Registration')?.value).toBe(
        REGISTRATION_MODE_TEXT[registration].short,
      );
    }
  });
});

describe('the rows Status is built from', () => {
  it('warns about a disk under a tenth free, and not about one that is not', () => {
    expect(diskRow({ holds: 'blobs', freeBytes: 1, totalBytes: 100, low: true }).warning).toBe(
      DISK_LOW_WARNING,
    );
    expect(
      diskRow({ holds: 'blobs', freeBytes: 99, totalBytes: 100, low: false }).warning,
    ).toBeNull();
  });

  it('warns about a backup older than two intervals, and not at exactly two', () => {
    const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
    const twice = 2 * 6 * HOUR;
    const backup = (secondsAgo: number) =>
      lastBackupRow(
        { at: at(secondsAgo), offBox: 'failed', intervalSeconds: 6 * HOUR },
        NOW,
        'UTC',
      );
    expect(backup(twice).warning).toBeNull();
    expect(backup(twice + 1).warning?.label).toBe('Stale');
    expect(backup(5 * HOUR).value).toBe(
      '2026-11-14 16:00 UTC, 5 hours ago; its off-box copy FAILED.',
    );
  });

  it('reads a backup dated after now as just taken, never a negative age', () => {
    const row = lastBackupRow(
      { at: '2026-11-14T21:05:00.000Z', offBox: 'not-configured', intervalSeconds: 0 },
      NOW,
      'UTC',
    );
    expect(row.value).toBe(
      '2026-11-14 21:05 UTC, less than a minute ago; no off-box copy is set up.',
    );
    expect(row.warning).toBeNull();
  });

  it('draws the last backup in the zone it is given, named (#2917)', () => {
    const backup = {
      at: '2026-11-14T16:00:00.000Z',
      offBox: 'copied',
      intervalSeconds: 6 * HOUR,
    } as const;
    expect(lastBackupRow(backup, NOW, 'America/New_York').value).toMatch(
      /^2026-11-14 11:00 EST, 5 hours ago;/,
    );
    expect(
      statusRows({ ...ANSWER, lastBackup: backup }, NOW, 'America/New_York').find(
        (row) => row.label === 'Last backup',
      )?.value,
    ).toMatch(/^2026-11-14 11:00 EST,/);
  });

  it('says the tunnel’s three states', () => {
    expect(tunnelText({ state: 'ready', connections: 1 })).toBe('ready, 1 connection');
    expect(tunnelText({ state: 'not_ready' })).toBe('not ready');
    expect(tunnelText({ state: 'unknown' })).toBe(TUNNEL_NOT_KNOWN);
  });
});

describe('compareWithMainUrl — a link the owner opens, never a request', () => {
  it('links a full commit of this repository to GitHub’s compare page', () => {
    expect(compareWithMainUrl(ANSWER)).toBe(
      'https://github.com/openzigs/onyourleft/compare/0123456789abcdef0123456789abcdef01234567...main',
    );
  });

  it('draws nothing for a modified instance, no commit, a short one or one with more after it', () => {
    for (const changed of [
      { upstream: false },
      { commit: null },
      { commit: '0123456789abcdef' },
      { commit: `${'a'.repeat(40)}/../x` },
      { commit: 'A'.repeat(40) },
    ]) {
      expect(compareWithMainUrl({ ...ANSWER, ...changed })).toBeUndefined();
    }
  });
});
