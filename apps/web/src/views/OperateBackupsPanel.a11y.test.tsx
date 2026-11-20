// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Backups (#2607), audited in each state it draws: the
 * list with a failed run, a failed off-box copy and the restore steps; a stale
 * newest snapshot; a request waiting; a refused Back up now; the confirmation
 * open; nothing recorded; and a list that could not be read. Its button is a
 * `.oyl-button` and its snapshot picker an `.oyl-input`, each of which
 * declares the project's touch-target floor (`theme.css`); the browser gate
 * measures the boxes (`browser/operate.browser.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { SCRIPTED_BACKUPS, scriptedOperate, type ScriptedOperate } from '../instance/testing';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { OperateBackupsPanel } from './OperateBackupsPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const NEVER = (): (() => void) => () => undefined;

async function open(scripted: ScriptedOperate): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateBackupsPanel timeZone="UTC" port={scripted.port} every={NEVER} />
    </main>,
  );
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));

function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((each) => each.textContent === name);
}

async function press(name: string): Promise<void> {
  const found = button(name);
  if (found === undefined) throw new Error(`no ${name}`);
  await activateWithKeyboard(found);
  await settle();
}

describe('the Operate area’s Backups — #2607', () => {
  it('passes the audit with the list and the restore steps, and its controls declare the target floor', async () => {
    await open(scriptedOperate());
    expect(audit()).toBe('');
    const buttons = [...document.querySelectorAll<HTMLElement>('main button')];
    expect(buttons.map((each) => each.textContent)).toEqual(['Back up now']);
    for (const each of buttons) expect(each.classList.contains('oyl-button')).toBe(true);
    const picker = document.querySelector('main select');
    expect(picker?.classList.contains('oyl-input')).toBe(true);
    // Its label names it.
    expect(document.querySelector(`label[for="${picker?.id ?? ''}"]`)?.textContent).toBe(
      'Snapshot to restore',
    );
    expect(
      [...document.querySelectorAll('main h2, main h3')].map((each) => each.textContent),
    ).toEqual(['Backups', 'Restoring a snapshot']);
  });

  it('passes the audit with a stale newest snapshot', async () => {
    const [newest, ...rest] = SCRIPTED_BACKUPS;
    if (newest === undefined) throw new Error('no backups');
    await open(scriptedOperate({ backups: [{ ...newest, ageSeconds: 50_000 }, ...rest] }));
    expect(audit()).toBe('');
  });

  it('passes the audit with the confirmation open', async () => {
    await open(scriptedOperate());
    await press('Back up now');
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(audit()).toBe('');
  });

  it('passes the audit while a request waits, and after one is refused', async () => {
    const waiting = scriptedOperate();
    waiting.held.pendingSince = '2026-11-14T20:59:00.000Z';
    await open(waiting);
    expect(button('Back up now')).toBeUndefined();
    expect(audit()).toBe('');
    mounted?.unmount();
    const refused = scriptedOperate();
    refused.held.backUpNow = {
      kind: 'refused',
      sentence: 'A backup is already waiting, or one was made in the last 15 minutes.',
    };
    await open(refused);
    await press('Back up now');
    const confirm = [
      ...(document.querySelector('[role="alertdialog"]')?.querySelectorAll('button') ?? []),
    ].find((each) => each.textContent === 'Back up now');
    if (confirm === undefined) throw new Error('no confirmation');
    await activateWithKeyboard(confirm);
    await settle();
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(audit()).toBe('');
  });

  it('passes the audit with nothing recorded, and when the backups could not be read', async () => {
    await open(scriptedOperate({ backups: [] }));
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(scriptedOperate({ backups: null }));
    expect(audit()).toBe('');
    expect(document.querySelectorAll('main button, main select')).toHaveLength(0);
  });
});
