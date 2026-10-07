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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, type Mounted } from '../testing/mount';
import { AboutView } from '../views/AboutView';

import { webpDimensions } from '../../tools/brand/webp-testing';

import { FULL_LOGO_PICTURES, FULL_LOGO_TEXT } from './Brand';

const HERE = dirname(fileURLToPath(import.meta.url));

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
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`is ONE picture, the ${theme} palette’s, with its words as text — #972`, async () => {
      document.documentElement.setAttribute('data-theme', theme);
      mounted = await mount(<AboutView />);
      const logo = mounted.container.querySelector('.oyl-brand-logo');
      expect(logo?.textContent).toBe(FULL_LOGO_TEXT);
      const { images, hidden } = brand(logo ?? document.body, 'oyl-brand-logo__image');
      expect(hidden).toEqual([FULL_LOGO_TEXT]);
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute('alt')).toBe('');
      expect(images[0]?.getAttribute('src')).toMatch(new RegExp(`logo-${theme}\\.webp$`));
    });
  }

  it('follows a change of palette without a remount', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    mounted = await mount(<AboutView />);
    const image = () => mounted?.container.querySelector('img.oyl-brand-logo__image');
    expect(image()?.getAttribute('src')).toMatch(/logo-light\.webp$/);
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      // The MutationObserver reports in a microtask.
      await Promise.resolve();
    });
    expect(image()?.getAttribute('src')).toMatch(/logo-dark\.webp$/);
    expect(mounted.container.querySelectorAll('img.oyl-brand-logo__image')).toHaveLength(1);
  });

  it('never holds the page’s commit: lazy, with its box reserved — #1136', async () => {
    mounted = await mount(<AboutView />);
    const image = mounted.container.querySelector('img.oyl-brand-logo__image');
    // `react-dom` §`maySuspendCommit`: an `<img>` with `loading="lazy"` (or an
    // `onLoad`) is the one a transition does not wait for.
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('width')).not.toBeNull();
    expect(image?.getAttribute('height')).not.toBeNull();
  });

  it.each(['light', 'dark'] as const)(
    'gives the %s picture its own size, read from the file',
    (theme) => {
      // Lossless WebP since #972: the size is in the VP8L header.
      const bytes = new Uint8Array(readFileSync(join(HERE, `logo-${theme}.webp`)));
      expect(FULL_LOGO_PICTURES[theme]).toMatchObject(webpDimensions(bytes));
    },
  );
});
