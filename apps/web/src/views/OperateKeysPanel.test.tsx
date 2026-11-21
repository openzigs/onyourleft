// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Instance keys (#2613): over the scripted port in
 * `instance/testing.ts` for what the screen does with each answer, and over
 * the REAL instance (`testing/operate-instance-testing.ts`) for a rotation
 * read back from the instance's own keys.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createOperatePort } from '../instance/operate-port';
import { SCRIPTED_KEYS, scriptedOperate } from '../instance/testing';
import { closeOperateWorlds, operatedWorld } from '../testing/operate-instance-testing';
import { activateWithKeyboard, mount, settle, typeInto, type Mounted } from '../testing/mount';
import {
  KEYS_UNREADABLE_TEXT,
  OperateKeysPanel,
  ROTATE_BUSY_TEXT,
  ROTATE_KEY_TEXT,
} from './OperateKeysPanel';

let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await closeOperateWorlds();
});

function text(of: ParentNode | null | undefined = mounted?.container): string {
  return (of?.textContent ?? '').replace(/\s+/g, ' ');
}

const dialog = (): HTMLElement | null => document.querySelector('[role="alertdialog"]');

function buttonIn(root: ParentNode | null, name: string): HTMLButtonElement {
  const found = [...(root?.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
}

/** The fact a term names, as the list shows it. */
function fact(term: string): string | undefined {
  const row = [...(mounted?.container.querySelectorAll('dl > div') ?? [])].find(
    (each) => each.querySelector('dt')?.textContent === term,
  );
  return row === undefined ? undefined : text(row.querySelector('dd'));
}

async function until(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !done(); turn += 1) await settle();
  await settle();
}

async function show(port: Parameters<typeof OperateKeysPanel>[0]['port']): Promise<void> {
  mounted = await mount(<OperateKeysPanel timeZone="UTC" port={port} />);
  await until(() => !text().includes('Reading the keys'));
}

/** *Rotate the encryption key*, then `typed` into its confirmation: its own button. */
async function openRotate(typed: string): Promise<HTMLButtonElement> {
  await activateWithKeyboard(buttonIn(mounted?.container ?? null, 'Rotate the encryption key'));
  await settle();
  const input = dialog()?.querySelector('input');
  if (input === null || input === undefined) throw new Error('no word field');
  await typeInto(input, typed);
  return buttonIn(dialog(), 'Rotate the encryption key');
}

describe('the Instance keys section over the scripted instance — #2613', () => {
  it('shows the card whole, in code and as a picture, and the fingerprint in groups', async () => {
    await show(scriptedOperate().port);
    const card = mounted?.container.querySelector('code.oyl-instance__card');
    expect(card?.textContent).toBe(SCRIPTED_KEYS.card);
    expect(fact('Fingerprint')).toBe(
      'AH4F OKN2 ZGRQ XRVJ 4EHL 6FAG WH35 X5PD DFXX QMAE TY5Z PNNK YU5Q',
    );
    expect(fact('Encryption key')).toBe('1790000000, made 2026-10-22 08:00 UTC');
    expect(fact('Rotates by itself')).toBe('2026-11-21 08:00 UTC');
    expect(fact('Older keys held')).toBe('1, each kept 7 days after the next was made');
    // The three that stay on the CLI are named as text, with no control of their own.
    expect(text()).toContain('instance-key rotate --drop-old');
    expect(text()).toContain('instance-key rotate-identity');
    expect(text()).toContain('instance-key reset');
    expect(
      [...(mounted?.container.querySelectorAll('button') ?? [])].map((each) => each.textContent),
    ).toEqual(['Rotate the encryption key']);
  });

  it('cannot rotate until rotate is typed, and says devices pick the key up by themselves', async () => {
    const scripted = scriptedOperate();
    await show(scripted.port);
    const confirm = await openRotate('rotat');
    expect(text(dialog())).toContain(ROTATE_KEY_TEXT);
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await activateWithKeyboard(confirm);
    await settle();
    expect(scripted.calls.filter((call) => call.startsWith('rotate key'))).toEqual([]);
    expect(dialog()).not.toBeNull();
  });

  it('rotates once the word is typed, and shows the key the instance reads after', async () => {
    const scripted = scriptedOperate();
    await show(scripted.port);
    await activateWithKeyboard(await openRotate('rotate'));
    await until(() => dialog() === null && scripted.calls.filter((c) => c === 'keys').length === 2);
    expect(scripted.calls).toEqual(['keys', 'rotate key rotate', 'keys']);
    expect(fact('Encryption key')).toBe('1790000001, made 2026-10-22 08:00 UTC');
    expect(fact('Older keys held')).toBe('2, each kept 7 days after the next was made');
  });

  it('says nothing was rotated while the instance’s own key maintenance runs', async () => {
    const scripted = scriptedOperate();
    scripted.held.keysBusy = true;
    await show(scripted.port);
    await activateWithKeyboard(await openRotate('rotate'));
    await until(() => dialog() === null);
    expect(text()).toContain(ROTATE_BUSY_TEXT);
    expect(fact('Encryption key')).toBe('1790000000, made 2026-10-22 08:00 UTC');
  });

  it('says the keys could not be read, and when they are not ready shows no card', async () => {
    await show(scriptedOperate({ keys: null }).port);
    expect(text()).toContain(KEYS_UNREADABLE_TEXT);
    mounted?.unmount();
    await show(
      scriptedOperate({
        keys: { ...SCRIPTED_KEYS, state: 'unreadable', card: null, fingerprint: null },
      }).port,
    );
    expect(fact('State')).toBe('not readable with the secret key set');
    expect(mounted?.container.querySelector('code.oyl-instance__card')).toBeNull();
  });
});

describe('the Instance keys section over the real instance — #2613', () => {
  it('rotates through the instance and shows the serial it then holds', async () => {
    const { owner, world } = await operatedWorld();
    const shown = await world.instanceKeys.show();
    await show(createOperatePort(owner.dependencies));
    expect(mounted?.container.querySelector('code.oyl-instance__card')?.textContent).toBe(
      shown.card,
    );
    const before = fact('Encryption key');
    await activateWithKeyboard(await openRotate('rotate'));
    await until(() => dialog() === null && fact('Older keys held') !== 'none');
    expect(fact('Encryption key')).not.toBe(before);
    expect(fact('Older keys held')).toBe('1, each kept 7 days after the next was made');
  });
});

describe('the card’s QR code — #2613', () => {
  it('draws the card as a QR code once asked, named for what it is', async () => {
    await show(scriptedOperate().port);
    const details = mounted?.container.querySelector<HTMLDetailsElement>('details.oyl-details');
    if (details === null || details === undefined) throw new Error('no QR disclosure');
    expect(details.querySelector('svg, [role="img"], [role="status"]')).toBeNull();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await until(() => details.querySelector('[role="img"]') !== null);
    expect(details.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'The instance’s card, for a rider’s device',
    );
  });
});
