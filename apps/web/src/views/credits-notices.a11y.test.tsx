// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Credits with the full third-party notices shown — #664, audited in line
 * with `holiday-switch.a11y.test.tsx`: the real shell, at the real route,
 * before and after *Read the full notices* is opened from the keyboard
 * alone. `routes.a11y.test.tsx` audits Credits as it first renders, with the
 * notices hidden; this is the state it cannot reach.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  tabbableElements,
} from '../a11y/audit';
import * as licenceDocuments from '../credits/licence-documents';
import * as noticesDocument from '../credits/notices-document';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  readsSettled,
  settle,
  type Mounted,
} from '../testing/mount';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  vi.restoreAllMocks();
});

function showNotices(): HTMLElement | undefined {
  return queryAll<HTMLElement>(document.body, 'main details > summary').find(
    (each) => accessibleName(each) === 'Read the full notices',
  );
}

function isOpen(): boolean | undefined {
  return (showNotices()?.parentElement as HTMLDetailsElement | null | undefined)?.open;
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('Credits — the full third-party notices (#664)', () => {
  it('is a named disclosure, reachable and operable by keyboard, and the screen passes the audit with the notices shown', async () => {
    const committed = await noticesDocument.loadNoticesDocument();
    // #1939: watched, not replaced, so the test waits for the read the screen
    // started rather than for a number of event-loop turns.
    const reads = vi.spyOn(noticesDocument, 'loadNoticesDocument');
    globalThis.location.hash = '#/about/credits';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    const toggle = showNotices();
    expect(toggle).toBeDefined();
    expect(isOpen()).toBe(false);
    expect(tabbableElements(document)).toContain(toggle);
    expectClean('Credits, notices hidden');

    if (toggle !== undefined) await activateWithKeyboard(toggle);
    expect(reads).toHaveBeenCalledTimes(1);
    await readsSettled(reads);
    expect(isOpen()).toBe(true);
    expect(document.querySelector('[data-notices-document]')?.textContent).toBe(committed);
    expectClean('Credits, notices shown');
  });
});

describe('Credits — the shipped licence texts (#1744)', () => {
  it('is a named disclosure per licence, operable by keyboard, and the screen passes the audit with both shown', async () => {
    const texts = {
      'Apache-2.0': await licenceDocuments.loadShippedLicence('Apache-2.0'),
      'OFL-1.1': await licenceDocuments.loadShippedLicence('OFL-1.1'),
    };
    // #1939: as above.
    const reads = vi.spyOn(licenceDocuments, 'loadShippedLicence');
    globalThis.location.hash = '#/about/credits';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    for (const [licence, text] of Object.entries(texts)) {
      const toggle = queryAll<HTMLElement>(document.body, 'main details > summary').find(
        (each) => accessibleName(each) === `Read the ${licence} licence`,
      );
      expect(toggle, licence).toBeDefined();
      expect(tabbableElements(document)).toContain(toggle);
      if (toggle !== undefined) await activateWithKeyboard(toggle);
      expect(reads.mock.calls.at(-1), licence).toEqual([licence]);
      await readsSettled(reads);
      expect(document.querySelector(`[data-licence-text="${licence}"]`)?.textContent).toBe(text);
    }
    expectClean('Credits, licence texts shown');
  });
});
