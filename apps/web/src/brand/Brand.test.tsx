// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The owner's wordmark and logo are pictures, and their words are text — #965.
 *
 * `Brand.tsx` says why: each palette has its own picture and `theme.css` hides
 * the other, so a name carried by an `alt` would vanish with whichever picture
 * is hidden. These are the jsdom half — what is in the markup;
 * `browser/brand.browser.spec.ts` is which picture a rider sees.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, type Mounted } from '../testing/mount';
import { AboutView } from '../views/AboutView';

import { FULL_LOGO_TEXT } from './Brand';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** The two pictures inside `root`, and the words beside them. */
function brand(root: Element, picture: string) {
  const images = queryAll<HTMLImageElement>(root, `img.${picture}`);
  const hidden = queryAll(root, '.oyl-visually-hidden').map((span) => span.textContent);
  return { images, hidden };
}

describe('the header’s wordmark', () => {
  it('is the owner’s picture in both palettes, and still says the app’s name as text', async () => {
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    const header = mounted.container.querySelector('header.oyl-header');
    expect(header?.getAttribute('aria-label')).toBe('On Your Left');
    const wordmark = header?.querySelector('.oyl-wordmark');
    expect(wordmark?.textContent).toBe('On Your Left');
    const { images, hidden } = brand(wordmark ?? document.body, 'oyl-wordmark__image');
    expect(hidden).toEqual(['On Your Left']);
    expect(images.map((image) => image.className)).toEqual([
      'oyl-wordmark__image oyl-brand--light',
      'oyl-wordmark__image oyl-brand--dark',
    ]);
    expect(images.map((image) => image.getAttribute('alt'))).toEqual(['', '']);
    expect(images[0]?.getAttribute('src')).toMatch(/wordmark-light\.png$/);
    expect(images[1]?.getAttribute('src')).toMatch(/wordmark-dark\.png$/);
  });
});

describe('the full logo on About', () => {
  it('is the owner’s picture in both palettes, with its words as text', async () => {
    mounted = await mount(<AboutView />);
    const logo = mounted.container.querySelector('.oyl-brand-logo');
    expect(logo?.textContent).toBe(FULL_LOGO_TEXT);
    const { images } = brand(logo ?? document.body, 'oyl-brand-logo__image');
    expect(images.map((image) => image.getAttribute('alt'))).toEqual(['', '']);
    expect(images[0]?.getAttribute('src')).toMatch(/logo-light\.png$/);
    expect(images[1]?.getAttribute('src')).toMatch(/logo-dark\.png$/);
  });
});
