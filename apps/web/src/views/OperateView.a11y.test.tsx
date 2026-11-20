// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area (#2603), audited in each state it draws: the owner's log
 * with *Show older entries*, the log after it, a log that could not be read,
 * a page that did not come, and an account that is not the owner. Every
 * control on it is a `.oyl-button`, which declares the project's touch-target
 * floor (`theme.css` §`.oyl-button`); the browser gate measures the box
 * (`browser/operate.browser.spec.ts`). The route is also walked with every
 * other by `a11y/routes.a11y.test.tsx`.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { OperateStanding } from '../instance/operate-port';
import { scriptedOperate, type ScriptedOperate } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateView } from './OperateView';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(scripted: ScriptedOperate): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateView timeZone="UTC" port={scripted.port} />
    </main>,
  );
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));

/** Every control a rider can press or follow inside the area. */
function controls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('main button, main a')];
}

async function showOlder(): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (each) => each.textContent === 'Show older entries',
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
}

describe('the Operate area — #2603', () => {
  it('passes the audit with the owner’s log and Show older entries, and every button is a .oyl-button', async () => {
    await open(scriptedOperate({ pageSize: 2 }));
    expect(audit()).toBe('');
    const buttons = controls().filter((each) => each.tagName === 'BUTTON');
    expect(buttons.length).toBeGreaterThan(0);
    for (const each of buttons) expect(each.classList.contains('oyl-button')).toBe(true);
    // One heading level under the page's h1.
    expect([...document.querySelectorAll('main h2')].map((each) => each.textContent)).toEqual([
      'Status',
      'Accounts',
      'Backups',
      'AI backend',
      'Rooms',
      'Instance keys',
      'Recent problems',
      'Operator log',
    ]);
    // #2604: Status's one control, Compare with main, is a target too.
    for (const each of controls()) expect(each.classList.contains('oyl-button')).toBe(true);
  });

  it('passes the audit after the last page, with no control left on the log', async () => {
    await open(scriptedOperate({ pageSize: 2 }));
    await showOlder();
    expect(audit()).toBe('');
    // Status's Compare with main, Accounts' links (#2605) and Backups' one
    // button (#2607) stay; the log has nothing left to press.
    expect(controls().map((each) => each.textContent)).toEqual([
      'Compare with main',
      'Go to approvals',
      'Go to suspended accounts',
      'Back up now',
      // #2611: the AI backend's, which stay with the log at its end.
      'Check it calls tools',
      'Save this model',
      'Read the list again',
      'Set, replace or remove it on the Instance screen',
      'Return to .env',
      // #2612: each open room's own.
      'End room',
      'End room',
      // #2613: the Keys section's one control.
      'Rotate the encryption key',
    ]);
  });

  it('passes the audit when the log could not be read, and when a page did not come', async () => {
    const unread = scriptedOperate();
    unread.held.logReadable = false;
    await open(unread);
    expect(audit()).toBe('');
    mounted?.unmount();
    const paged = scriptedOperate({ pageSize: 2 });
    await open(paged);
    paged.held.logReadable = false;
    await showOlder();
    expect(audit()).toBe('');
  });

  it.each(['not-owner', 'signed-out', 'unreachable', 'no-keys'] satisfies OperateStanding[])(
    'passes the audit for %s, which is offered only the way back',
    async (standing) => {
      await open(scriptedOperate({ standing }));
      expect(audit()).toBe('');
      expect(controls().map((each) => each.getAttribute('href'))).toEqual(['#/settings/instance']);
    },
  );
});
