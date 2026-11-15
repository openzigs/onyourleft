// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Accounts (#2605), audited in each state it draws: an
 * approval instance with its two links, an invitation instance with the third,
 * and a status that could not be read. Every control is a `.oyl-button`
 * (`theme.css` §`.oyl-button`, the project's touch-target floor); the browser
 * gate measures the box (`browser/operate.browser.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { OperateStatusRead } from '../instance/operate-port';
import { SCRIPTED_STATUS } from '../instance/testing';
import { mount, type Mounted } from '../testing/mount';
import { OperateAccountsPanel } from './OperateAccountsPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(status: OperateStatusRead): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateAccountsPanel status={status} />
    </main>,
  );
}

const audit = (): string => formatViolations(auditAccessibility(document));

const controls = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('main button, main a'),
];

describe('the Operate area’s Accounts — #2605', () => {
  it('passes the audit on an approval instance, every link a .oyl-button', async () => {
    await open(SCRIPTED_STATUS);
    expect(audit()).toBe('');
    expect(controls().map((each) => each.textContent)).toEqual([
      'Go to approvals',
      'Go to suspended accounts',
    ]);
    for (const each of controls()) expect(each.classList.contains('oyl-button')).toBe(true);
    expect([...document.querySelectorAll('main h2, main h3')].map((each) => each.tagName)).toEqual([
      'H2',
      'H3',
      'H3',
    ]);
  });

  it('passes the audit on an invitation instance, with its third link', async () => {
    await open({ ...SCRIPTED_STATUS, registration: 'invite' });
    expect(audit()).toBe('');
    expect(controls()).toHaveLength(3);
    for (const each of controls()) expect(each.classList.contains('oyl-button')).toBe(true);
  });

  it('passes the audit when the status could not be read', async () => {
    await open({ kind: 'unreachable' });
    expect(audit()).toBe('');
    for (const each of controls()) expect(each.classList.contains('oyl-button')).toBe(true);
  });
});
