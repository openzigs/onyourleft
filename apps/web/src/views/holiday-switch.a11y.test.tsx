// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The "Holiday decorations" switch on the Settings screen — #1622, audited in
 * line with `SettingsKit.a11y.test.tsx`: the real shell, at the real route,
 * before and after the switch is operated from the keyboard alone.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  tabbableElements,
} from '../a11y/audit';
import { HOLIDAY_DECORATIONS_STORAGE_KEY } from '../game/holiday-preference';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  localStorage.clear();
});

function holidaySwitch(): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find(
    (each) => accessibleName(each) === 'Holiday decorations',
  );
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('Settings — the holiday decorations switch (#1622)', () => {
  it('is named, on by default, reachable and operable by keyboard, and the screen passes the audit', async () => {
    localStorage.clear();
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    const toggle = holidaySwitch();
    expect(toggle).toBeDefined();
    expect(toggle?.checked).toBe(true);
    expect(tabbableElements(document)).toContain(toggle);
    expectClean('Settings, holiday decorations on');

    if (toggle !== undefined) await activateWithKeyboard(toggle);
    await settle();
    expect(holidaySwitch()?.checked).toBe(false);
    expect(localStorage.getItem(HOLIDAY_DECORATIONS_STORAGE_KEY)).toBe('off');
    expectClean('Settings, holiday decorations off');
  });
});
