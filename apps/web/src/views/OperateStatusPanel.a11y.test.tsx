// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Status (#2604), audited in each state it draws: ready
 * with Compare with main and a low disk, not ready with a stale backup, a
 * modified instance with no link, and a status that could not be read. Its one
 * control is a `.oyl-button` (`theme.css` §`.oyl-button`, the project's
 * touch-target floor); the browser gate measures the box
 * (`browser/operate.browser.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { OperateStatusRead } from '../instance/operate-port';
import { SCRIPTED_STATUS } from '../instance/testing';
import { mount, type Mounted } from '../testing/mount';
import { OperateStatusPanel } from './OperateStatusPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const NOW = Date.parse('2026-11-14T21:00:00.000Z');

async function open(status: OperateStatusRead): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateStatusPanel timeZone="UTC" status={status} now={() => NOW} />
    </main>,
  );
}

const audit = (): string => formatViolations(auditAccessibility(document));

const controls = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('main button, main a'),
];

describe('the Operate area’s Status — #2604', () => {
  it('passes the audit ready, with a low disk and Compare with main, a .oyl-button', async () => {
    await open(SCRIPTED_STATUS);
    expect(audit()).toBe('');
    expect(controls().map((each) => each.textContent)).toEqual(['Compare with main']);
    for (const each of controls()) expect(each.classList.contains('oyl-button')).toBe(true);
    expect([...document.querySelectorAll('main h2')].map((each) => each.textContent)).toEqual([
      'Status',
    ]);
  });

  it('passes the audit not ready, with a stale backup whose off-box copy failed', async () => {
    await open({
      ...SCRIPTED_STATUS,
      ready: false,
      checks: { database: false, migrations: 'unknown', rooms: false },
      lastBackup: { at: '2026-11-14T08:00:00.000Z', offBox: 'failed', intervalSeconds: 21_600 },
      tunnel: { state: 'not_ready' },
    });
    expect(audit()).toBe('');
  });

  it('passes the audit for a modified instance, which has no control at all', async () => {
    await open({ ...SCRIPTED_STATUS, upstream: false, disk: [] });
    expect(audit()).toBe('');
    expect(controls()).toEqual([]);
  });

  it('passes the audit when the status could not be read', async () => {
    await open({ kind: 'unreachable' });
    expect(audit()).toBe('');
  });
});
