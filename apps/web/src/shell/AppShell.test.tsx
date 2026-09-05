// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The shell's own behaviour, as distinct from the accessibility properties
 * `../a11y/routes.a11y.test.tsx` asserts across every route.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import type { CapabilityProbe } from '../support/bluetooth-support';

import { AppShell } from './AppShell';
import { hrefFor, routeById } from './routes';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

async function open(path: string): Promise<void> {
  globalThis.location.hash = `#${path}`;
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
  await settle();
}

describe('the router', () => {
  it('renders the view the fragment selects, including on first load', async () => {
    // Not "renders the default and then corrects itself". `useRoute` uses
    // `useSyncExternalStore` precisely so the first paint is already right; an
    // effect-based reader would flash the ride view here.
    await open('/about');
    expect(document.querySelector('h1')?.textContent).toBe(routeById('about').title);
  });

  it('follows a link rendered inside a view, not only one in the header', async () => {
    await open('/');
    const link = document.querySelector<HTMLAnchorElement>(
      `main a[href="${hrefFor(routeById('devices'))}"]`,
    );
    expect(link).not.toBeNull();
    await activateWithKeyboard(link as HTMLAnchorElement);
    expect(document.querySelector('h1')?.textContent).toBe(routeById('devices').title);
  });

  it('shows the not-found view for an address that matches nothing, with a way out', async () => {
    await open('/there-is-no-such-page');
    expect(document.querySelector('h1')?.textContent).toBe('That page does not exist');
    // The way out is the point. A not-found page with no links is a dead end
    // for a keyboard user.
    expect(document.querySelectorAll('main a').length).toBeGreaterThan(0);
  });

  it('stops listening for navigation once it is unmounted', async () => {
    await open('/');
    mounted?.unmount();
    mounted = undefined;
    // A subscription that outlived the tree would set state on it here. The
    // assertion is the absence of a React warning, which `mount` would have
    // reported through `caughtErrors` and React through console.
    globalThis.location.hash = '#/about';
    await settle();
    expect(document.querySelector('h1')).toBeNull();
  });
});

describe('the header', () => {
  it('names its navigation landmark, so it is distinguishable in a landmark list', async () => {
    await open('/');
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Primary');
  });

  it('links to every navigable route and to none of the others', async () => {
    await open('/');
    const hrefs = [...document.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#/', '#/activities', '#/devices', '#/about']);
  });
});

describe('the view heading', () => {
  it('is the single h1 and is what names the main landmark', async () => {
    await open('/devices');
    const main = document.querySelector('main');
    const headings = document.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(main?.getAttribute('aria-labelledby')).toBe(headings[0]?.id);
  });

  it('is focusable programmatically without joining the tab order', async () => {
    await open('/');
    expect(document.querySelector('main')?.getAttribute('tabindex')).toBe('-1');
  });
});
