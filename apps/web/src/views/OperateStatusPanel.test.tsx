// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Status (#2604) over a scripted status: what each field
 * reads as, the warnings, and the one link — Compare with main — which is
 * drawn only for a full commit of this repository's source and only ever
 * opened, never fetched. Over the real instance it is read in
 * `OperateView.test.tsx`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { OperateStatus } from '../instance/operate-port';
import { SCRIPTED_STATUS } from '../instance/testing';
import { mount, type Mounted } from '../testing/mount';
import {
  NOT_RECORDED,
  OperateStatusPanel,
  STATUS_UNREADABLE_TEXT,
  TUNNEL_NOT_KNOWN,
  bytesText,
  compareWithMainUrl,
  durationText,
} from './OperateStatusPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const NOW = Date.parse('2026-11-14T21:00:00.000Z');
const HOUR = 3600;

async function show(status: OperateStatus | { kind: 'unreachable' }): Promise<void> {
  mounted = await mount(<OperateStatusPanel status={status} now={() => NOW} />);
}

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

/** The value a fact is shown with, by its name. */
function fact(name: string): string {
  const term = [...(mounted?.container.querySelectorAll('dt') ?? [])].find(
    (each) => each.textContent === name,
  );
  return (term?.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ');
}

function compareLink(): HTMLAnchorElement | undefined {
  return [...(mounted?.container.querySelectorAll('a') ?? [])].find(
    (each) => each.textContent === 'Compare with main',
  );
}

describe('the Status panel — #2604', () => {
  it('shows each check, the counts and the tunnel, read as words', async () => {
    await show(SCRIPTED_STATUS);
    expect(text()).toContain('The instance is up and ready for riders.');
    expect(fact('Database')).toBe('ok');
    expect(fact('Migrations')).toBe('up to date');
    expect(fact('Rooms')).toBe('ok');
    expect(fact('Up for')).toBe('3 days 4 hours');
    expect(fact('Version')).toBe('0.0.0');
    expect(fact('Deployed commit')).toBe(SCRIPTED_STATUS.commit);
    expect(fact('Tunnel')).toBe('ready, 4 connections');
    expect(fact('Registration')).toContain('approval');
    expect(fact('Accounts')).toBe('3 active, 1 awaiting approval, 1 suspended');
    expect(fact('Rooms open')).toBe('2');
    expect(fact('Analysis jobs')).toBe('2 waiting, 1 running');
    expect(fact('Instance keys')).toBe('ready');
  });

  it('says not ready, with the check that failed', async () => {
    await show({
      ...SCRIPTED_STATUS,
      ready: false,
      checks: { database: true, migrations: 'behind', rooms: false },
    });
    expect(text()).toContain('not ready for riders');
    expect(fact('Rooms')).toBe('not ok');
    expect(fact('Migrations')).toBe('behind this build: run migrate');
  });

  it('warns about a disk under a tenth free, and not about one that is not', async () => {
    await show(SCRIPTED_STATUS);
    expect(fact('Disk holding the database')).toBe('412 GB free of 500 GB');
    expect(fact('Disk holding the blobs')).toContain('20 GB free of 1.0 TB');
    expect(fact('Disk holding the blobs')).toContain('Less than a tenth of this disk is free.');
    expect(fact('Disk holding the database')).not.toContain('Less than a tenth');
  });

  it('reads the last backup as not recorded until one is, and the tunnel as not known until asked', async () => {
    await show({ ...SCRIPTED_STATUS, tunnel: { state: 'unknown' } });
    expect(fact('Last backup')).toBe(NOT_RECORDED);
    expect(fact('Tunnel')).toBe(TUNNEL_NOT_KNOWN);
    mounted?.unmount();
    await show({ ...SCRIPTED_STATUS, tunnel: { state: 'not_ready' } });
    expect(fact('Tunnel')).toBe('not ready');
  });

  it('warns about a backup thirteen hours old on a six-hour interval, and not about one five hours old', async () => {
    const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR * 1000).toISOString();
    await show({
      ...SCRIPTED_STATUS,
      lastBackup: { at: at(13), offBox: 'copied', intervalSeconds: 6 * HOUR },
    });
    expect(fact('Last backup')).toContain('13 hours ago');
    expect(fact('Last backup')).toContain('its off-box copy succeeded');
    expect(fact('Last backup')).toContain('a backup was missed');
    mounted?.unmount();
    await show({
      ...SCRIPTED_STATUS,
      lastBackup: { at: at(5), offBox: 'failed', intervalSeconds: 6 * HOUR },
    });
    expect(fact('Last backup')).toContain('5 hours ago');
    expect(fact('Last backup')).toContain('its off-box copy FAILED');
    expect(fact('Last backup')).not.toContain('a backup was missed');
  });

  it('links a full commit of this repository to GitHub’s compare page, opened outside the app', async () => {
    await show(SCRIPTED_STATUS);
    const link = compareLink();
    expect(link?.getAttribute('href')).toBe(
      `https://github.com/openzigs/onyourleft/compare/${String(SCRIPTED_STATUS.commit)}...main`,
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer');
  });

  it('draws no compare link for a modified instance, or with no full commit', async () => {
    for (const changed of [
      { upstream: false },
      { commit: null },
      { commit: '0123456789abcdef' },
      { commit: `${'a'.repeat(40)}/../x` },
    ] satisfies Partial<OperateStatus>[]) {
      const status = { ...SCRIPTED_STATUS, ...changed };
      expect(compareWithMainUrl(status)).toBeUndefined();
      await show(status);
      expect(compareLink()).toBeUndefined();
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('says so when the status could not be read', async () => {
    await show({ kind: 'unreachable' });
    expect(text()).toContain(STATUS_UNREADABLE_TEXT);
    expect(mounted?.container.querySelector('dl')).toBeNull();
  });
});

describe('Status’s words for time and size — #2604', () => {
  it('says how long in its two largest units', () => {
    expect(durationText(0)).toBe('less than a minute');
    expect(durationText(60)).toBe('1 minute');
    expect(durationText(2 * HOUR)).toBe('2 hours');
    expect(durationText(HOUR + 17 * 60)).toBe('1 hour 17 minutes');
    expect(durationText(24 * HOUR)).toBe('1 day');
    expect(durationText((3 * 24 + 4) * HOUR + 59)).toBe('3 days 4 hours');
  });

  it('says how much in decimal units', () => {
    expect(bytesText(512)).toBe('512 bytes');
    expect(bytesText(1_500)).toBe('1.5 kB');
    expect(bytesText(412_000_000_000)).toBe('412 GB');
    expect(bytesText(1_500_000_000_000)).toBe('1.5 TB');
  });
});
