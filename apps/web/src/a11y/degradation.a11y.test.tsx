// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #48's seventh acceptance criterion: *"the shell renders and is navigable with
 * JavaScript-heavy charts absent, so a failed chart bundle does not blank the
 * page."*
 *
 * Two halves, and both are here because either alone would be misleading:
 *
 * 1. **With no chart at all**, every route renders its data and every
 *    navigation link works. That is the shell as it ships today — #50's
 *    activity detail view supplies the first chart — so it is the literal
 *    reading of "charts absent".
 * 2. **With a chart that fails**, the failure is contained: the table replaces
 *    it, the surrounding page is still there, and the navigation beside it is
 *    still focusable and still works. Without a boundary the whole React tree
 *    unmounts, and "does not blank the page" is exactly the thing that stops
 *    being true.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { ChartSlot } from '../design/ChartSlot';
import { AppShell } from '../shell/AppShell';
import { hrefFor, ROUTES, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import { auditAccessibility, formatViolations, tabbableElements } from './audit';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function Boom(): never {
  throw new Error('the chart bundle failed to load');
}

describe('with no charts at all — the shell as it ships', () => {
  it('renders every route and stays navigable', async () => {
    globalThis.location.hash = '#/';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    for (const destination of ROUTES) {
      const link = document.querySelector<HTMLAnchorElement>(
        `nav a[href="${hrefFor(destination)}"]`,
      );
      expect(link).not.toBeNull();
      await activateWithKeyboard(link as HTMLAnchorElement);
      expect(document.querySelector('h1')?.textContent).toBe(destination.title);
      expect(document.querySelector('main')?.textContent).not.toBe('');
    }
  });

  it('shows the ride and activity data as tables, which is the chart-free base case', async () => {
    globalThis.location.hash = '#/activities';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();
    expect(document.body.textContent).toContain('Rides on this device');
    expect(document.body.textContent).toContain('Nothing recorded yet');
  });
});

describe('with a chart that throws while rendering', () => {
  it('replaces it with the table and leaves the rest of the page standing', async () => {
    mounted = await mount(
      <div>
        <nav aria-label="Primary">
          <ul>
            <li>
              <a href={hrefFor(routeById('about'))}>About</a>
            </li>
          </ul>
        </nav>
        <main>
          <h1>Ride</h1>
          <ChartSlot
            caption="Power"
            columns={['Time', 'Watts']}
            rows={[
              ['0:01', '212'],
              ['0:02', '218'],
            ]}
            emptyMessage="No readings."
            chart={<Boom />}
          />
        </main>
      </div>,
    );
    await settle();

    // The chart failed…
    expect(mounted.caughtErrors.map((error) => error.message)).toContain(
      'the chart bundle failed to load',
    );
    // …the data is still on the page…
    expect(document.querySelector('table caption')?.textContent).toBe('Power');
    expect(document.body.textContent).toContain('218');
    // …and the page around it did not go with it.
    const link = document.querySelector<HTMLAnchorElement>('nav a');
    expect(link).not.toBeNull();
    expect(tabbableElements(document)).toContain(link);
    expect(document.querySelector('h1')?.textContent).toBe('Ride');
  });

  it('leaves the degraded page passing the accessibility audit', async () => {
    // A fallback nobody audited is where a table without headers, or a caption
    // that is really a heading, ends up. The degraded state is a state.
    document.documentElement.lang = 'en';
    mounted = await mount(
      <main>
        <h1>Ride</h1>
        <ChartSlot
          caption="Power"
          columns={['Time', 'Watts']}
          rows={[['0:01', '212']]}
          emptyMessage="No readings."
          chart={<Boom />}
        />
      </main>,
    );
    await settle();
    const violations = auditAccessibility(document);
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });
});
