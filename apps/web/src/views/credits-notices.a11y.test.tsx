// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Credits with the full third-party notices shown — #664, audited in line
 * with `holiday-switch.a11y.test.tsx`: the real shell, at the real route,
 * before and after *Show the full notices* is operated from the keyboard
 * alone. `routes.a11y.test.tsx` audits Credits as it first renders, with the
 * notices hidden; this is the state it cannot reach.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  tabbableElements,
} from '../a11y/audit';
import { loadNoticesDocument } from '../credits/notices-document';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function showNotices(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => accessibleName(each) === 'Show the full notices',
  );
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('Credits — the full third-party notices (#664)', () => {
  it('is a named toggle, reachable and operable by keyboard, and the screen passes the audit with the notices shown', async () => {
    // Read once first, so the chunk's module is loaded and one settle is enough.
    const committed = await loadNoticesDocument();
    globalThis.location.hash = '#/about/credits';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    const toggle = showNotices();
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(tabbableElements(document)).toContain(toggle);
    expectClean('Credits, notices hidden');

    if (toggle !== undefined) await activateWithKeyboard(toggle);
    await settle();
    expect(showNotices()?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-notices-document]')?.textContent).toBe(committed);
    expectClean('Credits, notices shown');
  });
});
