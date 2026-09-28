// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A map follows the page's palette, through one watch that ends with the map
 * (#672 part b). The browser gate reads the pixels change
 * (`map.browser.spec.ts` §"#672"); this is what counts the watches.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Theme } from '../design/tokens';

import { basemapStyle, MAP_COLOURS, OSM_ATTRIBUTION } from './basemap';
import type { MapViewOptions } from './port';
import { countingMutationObservers, stubMapPort, type ObserverCount } from './testing';
import { createThemedMap } from './themed-map';

const CONFIG = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

function optionsFor(theme: Theme): MapViewOptions {
  return { style: basemapStyle(CONFIG, { theme }), trackColour: MAP_COLOURS[theme].track };
}

/** Let a `MutationObserver` deliver: its records arrive in a microtask. */
async function delivered(): Promise<void> {
  await Promise.resolve();
}

let observers: ObserverCount;

beforeEach(() => {
  observers = countingMutationObservers();
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  observers.restore();
  document.documentElement.removeAttribute('data-theme');
});

describe('a map in the page’s palette — #672', () => {
  it.each(['light', 'dark'] as const)('is created in the %s palette the page is in', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    const port = stubMapPort();
    const view = createThemedMap(
      port.renderer,
      document.createElement('div'),
      document,
      optionsFor,
    );
    expect(port.created[0]?.options).toEqual(optionsFor(theme));
    view.destroy();
  });

  it('is repainted in the other palette when the page changes, and not rebuilt', async () => {
    const port = stubMapPort();
    const view = createThemedMap(
      port.renderer,
      document.createElement('div'),
      document,
      optionsFor,
    );

    document.documentElement.setAttribute('data-theme', 'dark');
    await delivered();
    document.documentElement.setAttribute('data-theme', 'light');
    await delivered();

    expect(port.created).toHaveLength(1);
    expect(port.created[0]?.styles).toEqual([optionsFor('dark'), optionsFor('light')]);
    view.destroy();
  });

  it('does not repaint for a write of the palette already in force', async () => {
    const port = stubMapPort();
    const view = createThemedMap(
      port.renderer,
      document.createElement('div'),
      document,
      optionsFor,
    );
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-oyl-theme-override', 'light');
    await delivered();
    expect(port.created[0]?.styles).toEqual([]);
    document.documentElement.removeAttribute('data-oyl-theme-override');
    view.destroy();
  });

  it('holds exactly one watch while the map lives, and none once it is destroyed', async () => {
    const port = stubMapPort();
    const view = createThemedMap(
      port.renderer,
      document.createElement('div'),
      document,
      optionsFor,
    );
    expect(observers.observed()).toBe(1);
    expect(observers.live()).toBe(1);

    view.setTrack(undefined, undefined);
    expect(observers.live()).toBe(1);

    view.destroy();
    expect(observers.live()).toBe(0);
    expect(port.created[0]?.destroyed).toBe(true);

    // And a change after it is gone reaches nothing.
    document.documentElement.setAttribute('data-theme', 'dark');
    await delivered();
    expect(port.created[0]?.styles).toEqual([]);
  });

  it('holds one watch per map, however many maps there are', () => {
    const port = stubMapPort();
    const views = [1, 2, 3].map(() =>
      createThemedMap(port.renderer, document.createElement('div'), document, optionsFor),
    );
    expect(observers.live()).toBe(3);
    for (const view of views) view.destroy();
    expect(observers.live()).toBe(0);
  });
});
