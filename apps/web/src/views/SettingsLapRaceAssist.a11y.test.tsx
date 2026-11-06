// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The lap race's assisted setting, audited — #1905, which asks that it be
 * reachable by keyboard and screen reader before a race and pass the
 * accessibility gate.
 *
 * The real shell at the real route, as a rider reaches it before any ride:
 * every switch has a name, is described by the sentence in the section's ⓘ
 * that says what it changes, is reachable by keyboard and works from it, and
 * the screen passes the audit before and after each choice. What a keyboard
 * chose is read back through `assist-preference.ts`' own reader over the
 * device's storage, the reader the race reads it with.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  keyboardReachableElements,
} from '../a11y/audit';
import { LAP_RACE_ASSIST_PARTS, readLapRaceAssist } from '../game/lap-race/assist-preference';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { LAP_RACE_ASSIST_TEXT } from './SettingsView';

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

/** What `aria-describedby` names, as a screen reader reads it; each must be in this section's ⓘ. */
function description(element: Element): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id !== '')
    .map((id) => {
      const target = document.getElementById(id);
      expect(target, `#${id} is named by aria-describedby and is not on the page`).not.toBeNull();
      expect(
        target?.closest('section.oyl-lap-race-assist details.oyl-section-help'),
        `#${id} is not in the lap race section's help`,
      ).not.toBeNull();
      return (target?.textContent ?? '').replace(/\s+/g, ' ').trim();
    })
    .join(' ');
}

function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('section.oyl-lap-race-assist');
  expect(found, 'the lap race panel is not on Settings').not.toBeNull();
  return found as HTMLElement;
}

describe('the lap race’s assisted setting passes the accessibility gate — #1905', () => {
  it('names and describes every switch, each reachable by keyboard, and the screen passes the audit', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    const section = panel();
    expect(accessibleName(section)).toBe(LAP_RACE_ASSIST_TEXT.heading);
    const switches = queryAll<HTMLInputElement>(section, 'input[role="switch"]');
    expect(switches.map((box) => accessibleName(box))).toEqual(
      LAP_RACE_ASSIST_PARTS.map((part) => LAP_RACE_ASSIST_TEXT.parts[part].label),
    );
    expect(switches.map((box) => description(box))).toEqual(
      LAP_RACE_ASSIST_PARTS.map((part) => LAP_RACE_ASSIST_TEXT.parts[part].detail),
    );
    expect(switches.every((box) => !box.checked)).toBe(true);
    const reachable = keyboardReachableElements(document);
    for (const control of switches) {
      expect(reachable, accessibleName(control)).toContain(control);
    }
    // The privacy sentence stays on the screen, not behind the ⓘ.
    expect(section.textContent).toContain(LAP_RACE_ASSIST_TEXT.stays);
    expectClean('Settings, the lap race panel as it opens');
  });

  it('is operable by keyboard, and what the keyboard chose is what the race reads', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    const [itemsOff, autoUse, noKnockBack, gentlerBots] = queryAll<HTMLInputElement>(
      panel(),
      'input[role="switch"]',
    );
    await activateWithKeyboard(autoUse as HTMLInputElement);
    await activateWithKeyboard(noKnockBack as HTMLInputElement);
    await settle();
    expect(readLapRaceAssist(localStorage)).toEqual({
      itemsOff: false,
      autoUse: true,
      noKnockBack: true,
      gentlerBots: false,
    });
    expectClean('Settings, the lap race panel after two choices');

    await activateWithKeyboard(itemsOff as HTMLInputElement);
    await activateWithKeyboard(gentlerBots as HTMLInputElement);
    await activateWithKeyboard(autoUse as HTMLInputElement);
    await settle();
    expect(readLapRaceAssist(localStorage)).toEqual({
      itemsOff: true,
      autoUse: false,
      noKnockBack: true,
      gentlerBots: true,
    });
    expect([itemsOff, autoUse, noKnockBack, gentlerBots].map((box) => box?.checked)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    // The Delivery setting beside it is untouched: the two are kept apart.
    expect(localStorage.getItem('oyl.game.delivery.assist.v1')).toBeNull();
    expectClean('Settings, the lap race panel after every choice');
  });
});
