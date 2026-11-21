// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Instance keys (#2613), audited in each state it draws:
 * the card, the fingerprint and the facts; the confirmation open, before and
 * after the word is typed; a rotation refused as busy; keys not ready; and
 * keys that could not be read. Its button is a `.oyl-button` and its word
 * field an `.oyl-input`, each of which declares the project's touch-target
 * floor (`theme.css`); the browser gate measures the boxes and that the card
 * is not cut off at the tablet's width (`browser/operate.browser.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { SCRIPTED_KEYS, scriptedOperate, type ScriptedOperate } from '../instance/testing';
import { activateWithKeyboard, mount, settle, typeInto, type Mounted } from '../testing/mount';
import { OperateKeysPanel } from './OperateKeysPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(scripted: ScriptedOperate): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateKeysPanel timeZone="UTC" port={scripted.port} />
    </main>,
  );
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));
const dialog = (): HTMLElement | null => document.querySelector('[role="alertdialog"]');

async function openRotate(): Promise<void> {
  const button = [...document.querySelectorAll('main button')].find(
    (each) => each.textContent === 'Rotate the encryption key',
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('no Rotate');
  await activateWithKeyboard(button);
  await settle();
}

describe('the Operate area’s Instance keys — #2613', () => {
  it('passes the audit with the card and the facts, and its control declares the target floor', async () => {
    await open(scriptedOperate());
    expect(audit()).toBe('');
    const buttons = [...document.querySelectorAll<HTMLElement>('main button')];
    expect(buttons.map((each) => each.textContent)).toEqual(['Rotate the encryption key']);
    for (const each of buttons) expect(each.classList.contains('oyl-button')).toBe(true);
    expect([...document.querySelectorAll('main h2')].map((each) => each.textContent)).toEqual([
      'Instance keys',
    ]);
  });

  it('passes the audit with the confirmation open, its field labelled, before and after the word', async () => {
    await open(scriptedOperate());
    await openRotate();
    expect(dialog()).not.toBeNull();
    expect(audit()).toBe('');
    const input = dialog()?.querySelector('input');
    if (input === null || input === undefined) throw new Error('no word field');
    expect(input.classList.contains('oyl-input')).toBe(true);
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe(
      'To rotate it, type rotate.',
    );
    await typeInto(input, 'rotate');
    expect(audit()).toBe('');
  });

  it('passes the audit after a busy refusal, with keys not ready, and when they could not be read', async () => {
    const busy = scriptedOperate();
    busy.held.keysBusy = true;
    await open(busy);
    await openRotate();
    const input = dialog()?.querySelector('input');
    if (input === null || input === undefined) throw new Error('no word field');
    await typeInto(input, 'rotate');
    const confirm = [...(dialog()?.querySelectorAll('button') ?? [])].find(
      (each) => each.textContent === 'Rotate the encryption key',
    );
    if (confirm === undefined) throw new Error('no confirmation');
    await activateWithKeyboard(confirm);
    await settle();
    await settle();
    expect(dialog()).toBeNull();
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(
      scriptedOperate({
        keys: { ...SCRIPTED_KEYS, state: 'no-secret', card: null, fingerprint: null },
      }),
    );
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(scriptedOperate({ keys: null }));
    expect(audit()).toBe('');
  });
});
