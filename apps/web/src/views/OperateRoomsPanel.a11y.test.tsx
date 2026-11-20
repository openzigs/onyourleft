// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Rooms (#2612), audited in each state it draws: the list,
 * the confirmation open with the code not yet typed and then typed, a room
 * the instance did not end, no room open, and a list that could not be read.
 * Its buttons are `.oyl-button`s and its reason and code `.oyl-input`s, each
 * of which declares the project's touch-target floor (`theme.css`); the
 * browser gate measures the boxes (`browser/operate.browser.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { scriptedOperate, type ScriptedOperate } from '../instance/testing';
import { activateWithKeyboard, mount, settle, typeInto, type Mounted } from '../testing/mount';
import { OperateRoomsPanel } from './OperateRoomsPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(scripted: ScriptedOperate): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateRoomsPanel timeZone="UTC" port={scripted.port} />
    </main>,
  );
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));

const dialog = (): HTMLElement | null => document.querySelector('[role="alertdialog"]');

async function openEnd(): Promise<void> {
  const first = [...document.querySelectorAll('main button')].find(
    (each) => each.textContent === 'End room',
  );
  if (!(first instanceof HTMLButtonElement)) throw new Error('no End room');
  await activateWithKeyboard(first);
  await settle();
}

describe('the Operate area’s Rooms — #2612', () => {
  it('passes the audit with the list, and its controls declare the target floor', async () => {
    await open(scriptedOperate());
    expect(audit()).toBe('');
    const buttons = [...document.querySelectorAll<HTMLElement>('main li button')];
    expect(buttons.map((each) => each.textContent)).toEqual(['End room', 'End room']);
    for (const each of buttons) expect(each.classList.contains('oyl-button')).toBe(true);
    expect([...document.querySelectorAll('main h2')].map((each) => each.textContent)).toEqual([
      'Rooms',
    ]);
  });

  it('passes the audit with the confirmation open, its fields labelled, before and after the code is typed', async () => {
    await open(scriptedOperate());
    await openEnd();
    expect(dialog()).not.toBeNull();
    expect(audit()).toBe('');
    const fields = [...(dialog()?.querySelectorAll<HTMLElement>('select, input') ?? [])];
    expect(fields).toHaveLength(2);
    for (const each of fields) {
      expect(each.classList.contains('oyl-input')).toBe(true);
      expect(document.querySelector(`label[for="${each.id}"]`)?.textContent).not.toBe('');
    }
    const input = dialog()?.querySelector('input');
    if (input === null || input === undefined) throw new Error('no code field');
    await typeInto(input, 'a1b2c3');
    expect(audit()).toBe('');
  });

  it('passes the audit when a room was not ended, with no room open, and when the list could not be read', async () => {
    const scripted = scriptedOperate();
    await open(scripted);
    await openEnd();
    const input = dialog()?.querySelector('input');
    if (input === null || input === undefined) throw new Error('no code field');
    await typeInto(input, 'a1b2c3');
    scripted.held.rooms = [];
    const confirm = [...(dialog()?.querySelectorAll('button') ?? [])].find(
      (each) => each.textContent === 'End room',
    );
    if (confirm === undefined) throw new Error('no confirmation');
    await activateWithKeyboard(confirm);
    await settle();
    await settle();
    expect(dialog()).toBeNull();
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(scriptedOperate({ rooms: [] }));
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(scriptedOperate({ rooms: null }));
    expect(audit()).toBe('');
    expect(document.querySelectorAll('main li button')).toHaveLength(0);
  });
});
