// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The assisted Delivery setting, audited — #1813, DL10, which asks that it
 * pass the accessibility gate.
 *
 * The real shell at the real route, as a rider reaches it: every control in
 * the panel has a name, is described by the visible sentence that says what
 * it changes, is reachable by keyboard and works from it, and the screen
 * passes the audit before and after each choice. What a keyboard chose is
 * read back through `assist-preference.ts`' own reader over the device's
 * storage, the path #1816's round reads it by.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  isHiddenFromAssistiveTechnology,
  keyboardReachableElements,
} from '../a11y/audit';
import { readDeliveryAssist } from '../game/delivery/assist-preference';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { DELIVERY_ASSIST_TEXT } from './SettingsView';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  localStorage.clear();
});

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

/** The text of every element `aria-describedby` names, joined as a screen reader reads it. */
function description(element: Element): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id !== '')
    .map((id) => {
      const target = document.getElementById(id);
      expect(target, `#${id} is named by aria-describedby and is not on the page`).not.toBeNull();
      expect(isHiddenFromAssistiveTechnology(target as Element), `#${id} is hidden`).toBe(false);
      return (target?.textContent ?? '').replace(/\s+/g, ' ').trim();
    })
    .join(' ');
}

function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('section.oyl-delivery-assist');
  expect(found, 'the Delivery panel is not on Settings').not.toBeNull();
  return found as HTMLElement;
}

describe('the assisted Delivery setting passes the accessibility gate — #1813', () => {
  it('names and describes every control, and the screen passes the audit', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    const section = panel();
    expect(accessibleName(section)).toBe(DELIVERY_ASSIST_TEXT.heading);

    const switches = queryAll<HTMLInputElement>(section, 'input[role="switch"]');
    expect(switches.map((box) => accessibleName(box))).toEqual([
      DELIVERY_ASSIST_TEXT.widerLabel,
      DELIVERY_ASSIST_TEXT.noFailLabel,
    ]);
    expect(switches.map((box) => description(box))).toEqual([
      DELIVERY_ASSIST_TEXT.widerDetail,
      DELIVERY_ASSIST_TEXT.noFailDetail,
    ]);

    const group = section.querySelector('fieldset');
    expect(group?.querySelector('legend')?.textContent).toBe(DELIVERY_ASSIST_TEXT.obstaclesLegend);
    expect(description(group as Element)).toBe(DELIVERY_ASSIST_TEXT.obstacles.normal.detail);
    const radios = queryAll<HTMLInputElement>(section, 'input[type="radio"]');
    expect(radios.map((radio) => accessibleName(radio))).toEqual(
      Object.values(DELIVERY_ASSIST_TEXT.obstacles).map((option) => option.label),
    );
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);

    const reachable = keyboardReachableElements(document);
    for (const control of [...switches, ...radios]) {
      expect(reachable, accessibleName(control)).toContain(control);
    }
    expectClean('Settings, the Delivery panel as it opens');
  });

  it('is operable by keyboard, and what the keyboard chose is what the round reads', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    const section = panel();
    const [wider, noFail] = queryAll<HTMLInputElement>(section, 'input[role="switch"]');
    const none = section.querySelector<HTMLInputElement>('input[type="radio"][value="none"]');
    await activateWithKeyboard(wider as HTMLInputElement);
    await activateWithKeyboard(none as HTMLInputElement);
    await activateWithKeyboard(noFail as HTMLInputElement);
    await settle();

    expect(readDeliveryAssist(localStorage)).toEqual({
      widerWindows: true,
      obstacles: 'none',
      noFail: true,
    });
    expect(wider?.checked).toBe(true);
    expect(none?.checked).toBe(true);
    expect(noFail?.checked).toBe(true);
    // The group's description follows the choice, so a screen reader hears what it now does.
    expect(description(section.querySelector('fieldset') as Element)).toBe(
      DELIVERY_ASSIST_TEXT.obstacles.none.detail,
    );
    expectClean('Settings, the Delivery panel after choosing every assist');
  });
});
