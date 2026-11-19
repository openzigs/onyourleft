// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's AI backend (#2611), audited in each state it draws: the
 * settings with the server's list, after a check, with the server not local
 * and with nothing readable, and with *Return to .env*'s question open. Every
 * button and link is a `.oyl-button` and every switch and model a label that
 * wraps its input (`theme.css` §"A checkbox or radio ROW", the project's
 * touch-target floor); the browser gate measures the boxes
 * (`browser/operate.browser.spec.ts`).
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { scriptedOperate, SCRIPTED_MODELS, type ScriptedOperate } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { CHECK_BUTTON, OperateAnalysisPanel, RETURN_BUTTON } from './OperateAnalysisPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(scripted: ScriptedOperate): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateAnalysisPanel timeZone="UTC" port={scripted.port} />
    </main>,
  );
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));

async function press(element: Element | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to press');
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
}

const byText = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((each) => each.textContent === label);

/** Every control a rider presses or follows, and every switch and model they choose. */
function targetsAreFloored(): void {
  for (const each of document.querySelectorAll('main button, main a')) {
    expect(each.classList.contains('oyl-button'), each.textContent ?? '').toBe(true);
  }
  for (const each of document.querySelectorAll('main input')) {
    expect(each.parentElement?.tagName, (each as HTMLInputElement).value).toBe('LABEL');
  }
}

describe('the Operate area’s AI backend — #2611', () => {
  it('passes the audit with the settings and the list, every target floored', async () => {
    await open(scriptedOperate());
    expect(audit()).toBe('');
    targetsAreFloored();
    expect(
      [...document.querySelectorAll('main h2, main h3')].map((each) => each.textContent),
    ).toEqual([
      'AI backend',
      'What the instance offers riders',
      'Now',
      'Pick a local model',
      'Your own hosted key',
      'Jobs',
      'Return to .env',
    ]);
  });

  it('passes the audit after a check, with its outcome said', async () => {
    const scripted = scriptedOperate({ checks: { 'alpha:14b': 'tools-ok' } });
    await open(scripted);
    await press(document.querySelector('input[value="alpha:14b"]') ?? undefined);
    await press(byText(CHECK_BUTTON));
    expect(audit()).toBe('');
    targetsAreFloored();
  });

  it('passes the audit when the server is not local, and when nothing could be read', async () => {
    await open(scriptedOperate({ models: { ...SCRIPTED_MODELS, state: 'not-local', models: [] } }));
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(scriptedOperate({ models: null, jobs: null }));
    expect(audit()).toBe('');
    mounted?.unmount();
    await open(scriptedOperate({ analysis: null }));
    expect(audit()).toBe('');
    targetsAreFloored();
  });

  it('passes the audit with Return to .env’s question open', async () => {
    await open(scriptedOperate());
    await press(byText(RETURN_BUTTON));
    expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
    expect(audit()).toBe('');
  });
});
