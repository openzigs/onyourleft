// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A map in the page's palette, that follows the page when it changes (#672).
 *
 * The page changes palette without a reload — the device switches to dark, the
 * rider chooses one in Settings, another tab does, or an erase puts the device's
 * back — and `design/theme-selection.ts` §`watchDocumentTheme` hears every one
 * of those as a change of `data-theme` on the root element. A map created in
 * one palette and left there would be a light rectangle on a dark page.
 *
 * ## One watch per map, and it ends with the map
 *
 * The watch is started here, beside `create`, and stopped inside the returned
 * view's `destroy`, BEFORE the map is released — so the number of watches is
 * the number of live maps by construction, not by a caller remembering to pair
 * two calls, and no palette change can reach a map that has been torn down.
 * `MapPanel.tsx` owns one map per basemap and calls `destroy` in its effect's
 * cleanup; `themed-map.test.ts` and `MapPanel.test.tsx` count the observers.
 *
 * It is here rather than in `MapPanel.tsx` so that the browser harness drives
 * the same code: `browser/harness.ts` builds its map through this function and
 * the real adapter, and `map.browser.spec.ts` flips the device's palette and
 * reads the drawing buffer change.
 */

import { documentTheme, watchDocumentTheme } from '../design/theme-selection';
import type { Theme } from '../design/tokens';
import type { MapRenderer, MapView, MapViewOptions } from './port';

/**
 * Create a map in `doc`'s palette, and repaint it in the other one whenever
 * the page changes. `optionsFor` builds a palette's style — `MapPanel.tsx`
 * passes `basemap.ts` §`basemapStyle` with that palette's line colour.
 */
export function createThemedMap(
  renderer: MapRenderer,
  container: HTMLElement,
  doc: Document,
  optionsFor: (theme: Theme) => MapViewOptions,
): MapView {
  const view = renderer.create(container, optionsFor(documentTheme(doc)));
  const stopWatching = watchDocumentTheme(doc, (theme) => {
    view.setStyle(optionsFor(theme));
  });
  return {
    setTrack: (track, bounds) => {
      view.setTrack(track, bounds);
    },
    setStyle: (options) => {
      view.setStyle(options);
    },
    destroy: () => {
      stopWatching();
      view.destroy();
    },
  };
}
