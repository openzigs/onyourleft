// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The hosted-service section of the Instance screen (#1251), audited in every
 * state a rider can put it in.
 *
 * The route walk (`a11y/routes.a11y.test.tsx`) audits the Instance screen
 * with a key held and nothing agreed. This renders the real shell at the real
 * route for the other states — no key, agreed, a consent the key no longer
 * matches, the instance not answering, and a message after a press — because
 * a section audited in one state has not been audited.
 *
 * ⚠️ **The 44 px touch target is a DECLARATION here, not a measurement**:
 * jsdom performs no layout (`apps/web/CLAUDE.md`). Every control is the design
 * system's `Button`, an `oyl-input`, or the switch's own class, whose floors
 * the browser gate measures.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { sectionLineFaults, sectionProse } from '../a11y/section-lines';
import { scriptedInstance } from '../instance/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { HOSTED_PANEL_HEADING, HOSTED_TEST_BUTTON } from './hosted-consent';
import type { HostedSettings } from './hosted-settings-port';
import { SCRIPTED_HOSTED_KEY, scriptedHostedSettings } from './hosted-settings-testing';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const AGREED: HostedSettings = {
  key: SCRIPTED_HOSTED_KEY,
  consent: { origin: SCRIPTED_HOSTED_KEY.origin },
};

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function panel(): HTMLElement {
  const found = queryAll<HTMLElement>(document.body, 'section').find(
    (each) => each.querySelector('h2')?.textContent === HOSTED_PANEL_HEADING,
  );
  if (found === undefined) throw new Error('the hosted-service section is not drawn');
  return found;
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
  // #1013, in the states the route walk does not reach: one short line a section.
  const main = document.querySelector('main');
  expect(main, where).not.toBeNull();
  expect(sectionProse(main!).flatMap(sectionLineFaults), where).toStrictEqual([]);
}

/** Every control in the section is in the tab order, and of a class that declares its target. */
function expectControls(where: string): void {
  const controls = queryAll<HTMLElement>(panel(), 'button, input, textarea, select, a[href]');
  expect(controls.length, where).toBeGreaterThan(0);
  const tabbable = tabbableElements(document);
  for (const control of controls) {
    expect(tabbable, `${where}: ${control.outerHTML}`).toContain(control);
    if (control.tagName === 'BUTTON') {
      expect(control.classList.contains('oyl-button'), `${where}: ${control.outerHTML}`).toBe(true);
    } else if ((control as HTMLInputElement).type === 'checkbox') {
      expect(control.closest('label.oyl-announce__switch'), where).not.toBeNull();
    } else {
      expect(control.classList.contains('oyl-input'), `${where}: ${control.outerHTML}`).toBe(true);
      expect(document.querySelector(`label[for="${control.id}"]`), where).not.toBeNull();
    }
  }
}

async function open(scripted: ReturnType<typeof scriptedHostedSettings>): Promise<void> {
  document.documentElement.lang = 'en';
  globalThis.location.hash = '#/settings/instance';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      instance={scriptedInstance({ connected: true }).port}
      hostedSettings={scripted.port}
    />,
  );
  await settle();
}

describe('every state of the hosted-service section passes the audit (#1251)', () => {
  it.each([
    ['no key held', { key: null, consent: null }],
    ['a key held, nothing agreed', { key: SCRIPTED_HOSTED_KEY, consent: null }],
    ['a key held and agreed to', AGREED],
    [
      'the operator’s own key',
      { key: { ...SCRIPTED_HOSTED_KEY, setBy: 'operator-command' }, consent: null },
    ],
    [
      'a consent for another service than the key',
      { key: SCRIPTED_HOSTED_KEY, consent: { origin: 'https://old.example' } },
    ],
    ['a consent and no key', { key: null, consent: { origin: 'https://old.example' } }],
  ] as const)('%s', async (what, held) => {
    await open(scriptedHostedSettings(held));
    expectClean(what);
    expectControls(what);
  });

  it('the instance not answering: a sentence, and no control that could not work', async () => {
    const scripted = scriptedHostedSettings();
    scripted.failNext = 'This needs the instance’s card.';
    await open(scripted);
    expectClean('not read');
    expect(queryAll(panel(), 'button, input')).toHaveLength(0);
  });

  it('after a press: the answer is in a live region, and the audit still passes', async () => {
    await open(scriptedHostedSettings(AGREED));
    const test = queryAll<HTMLButtonElement>(panel(), 'button').find(
      (each) => each.textContent === HOSTED_TEST_BUTTON,
    );
    await activateWithKeyboard(test!);
    await settle();
    const live = panel().querySelector('[role="status"], [aria-live]');
    expect(live?.textContent).toContain('models.example answered the test question.');
    expectClean('after the test question');
    expectControls('after the test question');
  });
});
