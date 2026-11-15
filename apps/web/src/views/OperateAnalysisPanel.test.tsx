// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's AI backend (#2611), over the scripted port in
 * `instance/testing.ts`, which holds the settings as the instance would and
 * can be told to lose a save — so a line that shows what the instance READ
 * BACK is told from one that shows what was pressed. What the port reads from
 * the real instance is `instance/operate-port.test.ts`'s; the panel is audited
 * in `OperateAnalysisPanel.a11y.test.tsx`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedOperate, SCRIPTED_ANALYSIS, type ScriptedOperate } from '../instance/testing';
import { hrefFor, routeById } from '../shell/routes';
import { mount, settle, type Mounted } from '../testing/mount';
import {
  CHECK_BUTTON,
  CHECK_TEXT,
  HOSTED_OFFER_SENTENCE,
  MODEL_SAVED_TEXT,
  OFFER_HOSTED_LABEL,
  OFFER_LOCAL_LABEL,
  OFFER_OTHERS_LABEL,
  OFFER_SAVED_TEXT,
  OperateAnalysisPanel,
  OWN_KEY_LINK,
  RETURN_BUTTON,
  SAVE_BUTTON,
} from './OperateAnalysisPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(scripted: ScriptedOperate): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Operate</h1>
      <OperateAnalysisPanel port={scripted.port} />
    </main>,
  );
  await settle();
}

const text = (): string => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ');

/** The *Now* lines, top to bottom. */
const now = (): string[] =>
  [...document.querySelectorAll('[data-oyl-ai-now] li')].map((each) =>
    (each.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((each) => each.textContent === label);
  if (found === undefined) throw new Error(`no ${label}`);
  return found;
}

const radio = (name: string): HTMLInputElement => {
  const found = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')].find(
    (each) => each.value === name,
  );
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};

const box = (label: string): HTMLInputElement => {
  const found = [...document.querySelectorAll('label')].find((each) =>
    (each.textContent ?? '').includes(label),
  );
  const input = found?.querySelector('input');
  if (input === null || input === undefined) throw new Error(`no ${label}`);
  return input;
};

async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
}

describe('the Now line is what the instance read back (#2611)', () => {
  it('shows a saved model because the instance’s settings now name it', async () => {
    const scripted = scriptedOperate({ checks: { 'alpha:14b': 'tools-ok' } });
    await open(scripted);
    expect(now()).toContain('Model: none chosen');
    await press(radio('alpha:14b'));
    await press(button(CHECK_BUTTON));
    await press(button(SAVE_BUTTON));
    expect(now()).toContain('Model: alpha:14b');
    expect(text()).toContain(MODEL_SAVED_TEXT);
    // Saved, then read again: the read after the save is what is drawn.
    expect(scripted.calls.slice(-2)).toEqual([
      'setAnalysis {"localModel":"alpha:14b"}',
      'analysis',
    ]);
  });

  it('still shows the old model when the instance answers with it, whatever was picked here', async () => {
    const scripted = scriptedOperate({ checks: { 'alpha:14b': 'tools-ok' } });
    scripted.held.saveIsLost = true;
    await open(scripted);
    await press(radio('alpha:14b'));
    await press(button(CHECK_BUTTON));
    await press(button(SAVE_BUTTON));
    expect(now()).toContain('Model: none chosen');
    expect(now().join(' ')).not.toContain('alpha:14b');
  });

  it('says where the setting comes from, and the state as a sentence', async () => {
    await open(scriptedOperate());
    expect(now()).toEqual([
      'Local server: http://ollama:11434/v1 (from the instance’s .env)',
      'Model: none chosen',
      'Off: no model is chosen.',
      'Ollama 0.12.6',
    ]);
  });
});

describe('Save is offered only after this model’s check said tools-ok (#2611, ADR 0046 D-7)', () => {
  it('keeps Save withheld after no-tool-call, offers it after tools-ok, and withholds it again for another model', async () => {
    const scripted = scriptedOperate({
      checks: { 'beta:32b': 'no-tool-call', 'alpha:14b': 'tools-ok' },
    });
    await open(scripted);
    expect(button(SAVE_BUTTON).getAttribute('aria-disabled')).toBe('true');
    expect(button(CHECK_BUTTON).getAttribute('aria-disabled')).toBe('true');

    await press(radio('beta:32b'));
    expect(button(CHECK_BUTTON).getAttribute('aria-disabled')).not.toBe('true');
    await press(button(CHECK_BUTTON));
    expect(text()).toContain(CHECK_TEXT['no-tool-call']);
    expect(button(SAVE_BUTTON).getAttribute('aria-disabled')).toBe('true');
    // A press on a withheld Save sends nothing.
    await press(button(SAVE_BUTTON));
    expect(scripted.calls.filter((call) => call.startsWith('setAnalysis'))).toEqual([]);

    await press(radio('alpha:14b'));
    await press(button(CHECK_BUTTON));
    expect(text()).toContain(CHECK_TEXT['tools-ok']);
    expect(button(SAVE_BUTTON).getAttribute('aria-disabled')).not.toBe('true');

    await press(radio('beta:32b'));
    expect(button(SAVE_BUTTON).getAttribute('aria-disabled')).toBe('true');
    expect(scripted.calls.filter((call) => call.startsWith('checkModel'))).toEqual([
      'checkModel beta:32b',
      'checkModel alpha:14b',
    ]);
  });
});

describe('no model is recommended (#2611, ADR 0031 D-4)', () => {
  it('picks none, marks none, and says nothing of a recommendation', async () => {
    await open(scriptedOperate());
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(radios.map((each) => each.value)).toEqual(['alpha:14b', 'beta:32b', 'gamma:26b']);
    expect(radios.filter((each) => each.checked)).toEqual([]);
    expect(text()).not.toMatch(/recommend|suggest|best|default/i);
  });

  it('names no model in its source', () => {
    // A path, not a URL: under jsdom a URL resolved here is not a file's.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'OperateAnalysisPanel.tsx'),
      'utf8',
    );
    // A `name:tag` literal, or a model family by its name.
    expect(source).not.toMatch(/['"`][a-z0-9.-]+:[a-z0-9.]+['"`]/i);
    expect(source).not.toMatch(
      /\b(llama|qwen|gemma|mistral|mixtral|phi\d|deepseek|gpt-?\d|claude|gemini|command-r)\b/i,
    );
  });
});

describe('no key is on the screen (#2611)', () => {
  it('describes a held key by its origin, offers no box for one, and links to the Instance screen', async () => {
    const scripted = scriptedOperate({
      analysis: {
        ...SCRIPTED_ANALYSIS,
        hosted: {
          offered: true,
          operatorKey: 'held',
          operatorKeyOrigin: 'https://models.example',
          // What an instance that leaked a key would send: never drawn.
          ...({ key: 'sk-MARKER-2611' } as object),
        },
      },
    });
    await open(scripted);
    expect(text()).toContain('Your key is held for https://models.example');
    expect(text()).not.toContain('sk-MARKER-2611');
    expect(
      document.querySelectorAll('input[type=password], input[type=text], textarea'),
    ).toHaveLength(0);
    const link = [...document.querySelectorAll('a')].find(
      (each) => each.textContent === OWN_KEY_LINK,
    );
    expect(link?.getAttribute('href')).toBe(hrefFor(routeById('instance')));
  });
});

describe('the offers are the instance’s answer after the press (#2611)', () => {
  it('turns hosted off, says so, and draws the switch as the instance reads it back', async () => {
    const scripted = scriptedOperate();
    await open(scripted);
    expect(text()).toContain(HOSTED_OFFER_SENTENCE);
    expect(box(OFFER_HOSTED_LABEL).checked).toBe(true);
    await press(box(OFFER_HOSTED_LABEL));
    expect(scripted.calls.slice(-2)).toEqual(['setAnalysis {"offerHosted":false}', 'analysis']);
    expect(box(OFFER_HOSTED_LABEL).checked).toBe(false);
    expect(text()).toContain(OFFER_SAVED_TEXT);
  });

  it('draws the local model’s two switches as the instance holds them, and saves each by its own field', async () => {
    const scripted = scriptedOperate({
      analysis: { ...SCRIPTED_ANALYSIS, local: { ...SCRIPTED_ANALYSIS.local, offered: false } },
    });
    await open(scripted);
    expect(box(OFFER_LOCAL_LABEL).checked).toBe(false);
    expect(box(OFFER_OTHERS_LABEL).checked).toBe(false);
    await press(box(OFFER_OTHERS_LABEL));
    expect(scripted.calls.slice(-2)).toEqual(['setAnalysis {"othersLocal":true}', 'analysis']);
    expect(box(OFFER_OTHERS_LABEL).checked).toBe(true);
    await press(box(OFFER_LOCAL_LABEL));
    expect(scripted.calls.slice(-2)).toEqual(['setAnalysis {"offerLocal":true}', 'analysis']);
    expect(box(OFFER_LOCAL_LABEL).checked).toBe(true);
  });

  it('draws the switch as the instance holds it when the save did not stick', async () => {
    const scripted = scriptedOperate();
    scripted.held.saveIsLost = true;
    await open(scripted);
    await press(box(OFFER_HOSTED_LABEL));
    expect(box(OFFER_HOSTED_LABEL).checked).toBe(true);
  });
});

describe('the list says what the server says of each model (#2611)', () => {
  it('reads not known until loaded for an unloaded model, and part, 62 % for one partly in GPU memory', async () => {
    await open(scriptedOperate());
    const line = (name: string): string =>
      (radio(name).closest('label')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(line('gamma:26b')).toContain('in GPU memory: not known until loaded');
    expect(line('beta:32b')).toContain('in GPU memory: part, 62 %');
    expect(line('alpha:14b')).toContain(
      '14.8B, Q4_K_M, 9.0 GB, lists tool support, in GPU memory: all',
    );
    expect(line('gamma:26b')).toContain('tool support not reported');
  });
});

describe('the jobs and the way back to .env (#2611)', () => {
  it('labels each job yours or another rider’s, and never names the rider', async () => {
    await open(scriptedOperate());
    const jobs = [...document.querySelectorAll('.oyl-operate__jobs li')].map(
      (each) => each.textContent,
    );
    expect(jobs).toEqual([
      'Write-up, on this instance’s model, another rider’s: waiting, 2026-11-14 10:05 UTC',
      'Re-plan, on a hosted service, another rider’s: failed (model-without-tools), 2026-11-14 09:50 UTC',
      'Write-up, on this instance’s model, yours: done, 2026-11-14 09:00 UTC',
    ]);
    expect(text()).toContain('1 waiting, 0 running');
  });

  it('returns to .env only after the confirmation, and shows what the instance reads after', async () => {
    const scripted = scriptedOperate({
      analysis: {
        ...SCRIPTED_ANALYSIS,
        local: { ...SCRIPTED_ANALYSIS.local, model: 'alpha:14b', setIn: 'app', state: 'on' },
      },
    });
    await open(scripted);
    expect(now()).toContain('Model: alpha:14b');
    await press(button(RETURN_BUTTON));
    expect(scripted.calls).not.toContain('clearAnalysis');
    const dialog = document.querySelector('[role=alertdialog]');
    expect(dialog).not.toBeNull();
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (each) => each.textContent === RETURN_BUTTON,
    );
    if (confirm === undefined) throw new Error('no confirmation');
    await press(confirm);
    expect(scripted.calls.slice(-2)).toEqual(['clearAnalysis', 'analysis']);
    expect(now()).toContain('Model: none chosen');
  });
});
