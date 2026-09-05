// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The gate #48's third, fourth and fifth acceptance criteria name.
 *
 * - **Criterion 4** — automated accessibility checks on *every* route. The
 *   suite iterates `ALL_ROUTES` rather than naming views, so a route added to
 *   the table is audited without anyone remembering to add a case here.
 * - **Criterion 3** — every interactive control reachable and operable by
 *   keyboard, asserted rather than inspected. `activateWithKeyboard` refuses to
 *   activate anything it cannot focus first, which is what makes "operable"
 *   more than a click in disguise.
 * - **Criterion 5** — focus is managed on navigation: it moves to the new view
 *   rather than being left on a link describing the page you have left.
 *
 * This file runs in CI both inside `pnpm run test:coverage` and again as the
 * dedicated `pnpm run test:a11y` step, so an accessibility regression fails
 * under a check named for what broke.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { AppShell } from '../shell/AppShell';
import { ALL_ROUTES, hrefFor, ROUTES, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { accessibleName, auditAccessibility, formatViolations, tabbableElements } from './audit';

/**
 * A browser that can pair.
 *
 * The audit runs against the *capable* branch on purpose: it is the branch with
 * the most controls in it, so it is the one with the most to get wrong. The
 * incapable branches are audited too, below.
 */
function workingBluetooth(available = true): BluetoothPort {
  return {
    getAvailability: async () => Promise.resolve(available),
    requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
  };
}

const CAPABLE: CapabilityProbe = { bluetooth: workingBluetooth(), secureContext: true };
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

async function open(path: string, capabilities: CapabilityProbe = CAPABLE): Promise<Mounted> {
  globalThis.location.hash = `#${path}`;
  const result = await mount(<AppShell capabilities={capabilities} />);
  await settle();
  mounted = result;
  return result;
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(
    violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`,
    `accessibility violations on ${where}`,
  ).toBe('');
}

describe('criterion 4 — every route passes the automated audit', () => {
  for (const route of ALL_ROUTES) {
    it(`${route.id} (${route.path}) has no accessibility violations`, async () => {
      await open(route.path);
      expect(document.querySelector('h1')?.textContent).toBe(route.title);
      expectClean(`${route.id} with Bluetooth available`);
    });
  }

  it('the devices route passes in a browser with no Bluetooth at all', async () => {
    // The Safari and Firefox branch renders different markup — a different
    // status tone, a paragraph instead of a list. Auditing only the happy path
    // would leave the branch a quarter of visitors see unchecked.
    await open('/devices', NO_BLUETOOTH);
    expect(document.body.textContent).toContain('Safari and Firefox');
    expectClean('devices with no Bluetooth');
  });

  it('the devices route passes while the probe is still in flight', async () => {
    // The loading state is a real state — it lasts for as long as
    // `getAvailability()` takes, which on a cold adapter is not instant — and
    // it contains a live region. Held open with a promise this test resolves,
    // rather than by not awaiting: an unresolved probe is the only way to
    // observe the state at all, since `mount` already flushes microtasks.
    let release = (): void => {};
    const pending = new Promise<boolean>((resolve) => {
      release = () => {
        resolve(true);
      };
    });
    globalThis.location.hash = '#/devices';
    mounted = await mount(
      <AppShell
        capabilities={{
          bluetooth: {
            getAvailability: async () => pending,
            requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
          },
          secureContext: true,
        }}
      />,
    );

    expect(document.body.textContent).toContain('Looking for Bluetooth');
    expectClean('devices while probing');

    release();
    await settle();
    expect(document.body.textContent).toContain('Bluetooth is available');
  });
});

describe('criterion 3 — everything interactive is reachable by keyboard', () => {
  for (const route of ALL_ROUTES) {
    it(`every control on ${route.id} is in the tab order and is named`, async () => {
      await open(route.path);
      const tabbable = new Set(tabbableElements(document));
      const controls = queryAll(
        document,
        'a[href], button, input, select, textarea, [role="button"]',
      );

      expect(controls.length, `${route.id} renders no controls at all`).toBeGreaterThan(0);
      for (const control of controls) {
        expect(tabbable.has(control), `not in the tab order: ${control.outerHTML}`).toBe(true);
        expect(accessibleName(control), `unnamed control: ${control.outerHTML}`).not.toBe('');
      }
    });
  }

  it('puts the skip link first in the tab order, which is the one press it exists for', async () => {
    await open('/');
    const first = tabbableElements(document)[0];
    expect(first?.textContent).toBe('Skip to main content');
  });

  it('navigates between every pair of routes using the keyboard alone', async () => {
    await open('/');
    for (const destination of ROUTES) {
      const link = document.querySelector<HTMLAnchorElement>(
        `nav a[href="${hrefFor(destination)}"]`,
      );
      expect(link, `no navigation link to ${destination.id}`).not.toBeNull();
      await activateWithKeyboard(link as HTMLAnchorElement);
      expect(document.querySelector('h1')?.textContent).toBe(destination.title);
    }
  });

  it('marks the current page for assistive technology, not only with colour', async () => {
    await open('/activities');
    const current = queryAll(document, 'nav a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe(routeById('activities').navLabel);
  });
});

describe('criterion 5 — focus is managed on navigation', () => {
  it('moves focus to the new view rather than leaving it on the link', async () => {
    await open('/');
    const link = document.querySelector<HTMLAnchorElement>(
      `nav a[href="${hrefFor(routeById('devices'))}"]`,
    );
    await activateWithKeyboard(link as HTMLAnchorElement);

    const main = document.querySelector('main');
    expect(document.activeElement).toBe(main);
    // Not just "something is focused": the thing focused has to announce the
    // page arrived at, which is what `aria-labelledby` on `main` supplies.
    expect(accessibleName(main as Element)).toBe(routeById('devices').title);
  });

  it('does not steal focus on first render, which would make the skip link unreachable', async () => {
    await open('/');
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus on every navigation, not only the first', async () => {
    await open('/');
    for (const destination of [routeById('activities'), routeById('about'), routeById('ride')]) {
      const link = document.querySelector<HTMLAnchorElement>(
        `nav a[href="${hrefFor(destination)}"]`,
      );
      await activateWithKeyboard(link as HTMLAnchorElement);
      expect(document.activeElement, `focus was lost navigating to ${destination.id}`).toBe(
        document.querySelector('main'),
      );
    }
  });

  it('sends the skip link to main without navigating away from the page', async () => {
    // ⚠️ This shell routes on the fragment, so an ordinary `href="#oyl-main"`
    // would set the hash to a value matching no route and "skip to content"
    // would land on the not-found page. Both halves are asserted because
    // getting the focus right while breaking the route would look like a pass.
    await open('/about');
    const skip = tabbableElements(document)[0];
    await activateWithKeyboard(skip as HTMLElement);

    expect(document.activeElement).toBe(document.querySelector('main'));
    expect(document.querySelector('h1')?.textContent).toBe(routeById('about').title);
  });
});

describe('the document title follows the route', () => {
  it('names the view, so a tab strip and a screen reader both say where you are', async () => {
    await open('/activities');
    expect(document.title).toBe('Activities — On Your Left');
    const link = document.querySelector<HTMLAnchorElement>(
      `nav a[href="${hrefFor(routeById('about'))}"]`,
    );
    await activateWithKeyboard(link as HTMLAnchorElement);
    expect(document.title).toBe('About On Your Left — On Your Left');
  });
});
