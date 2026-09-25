// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one file that names MapLibre GL JS and `pmtiles`.
 *
 * The transport boundary, in the sense `packages/sensors/web-bluetooth` is one:
 * every other module under `map/` is written against `port.ts` and can be read,
 * typechecked and tested without a WebGL context. Nothing from this file's
 * imports escapes upward — the exported type is `MapPort`, and a `maplibregl.Map`
 * exists only inside the closure below.
 *
 * ## Loaded lazily, and that is a size decision
 *
 * `maplibre-gl` is the largest dependency in this client by a wide margin. A
 * static import would put it in the entry chunk, so a rider who never opens a
 * ride with GPS — which is most rides, most of the time, in a product whose
 * first milestone is indoor trainer sessions — would download a map engine to
 * look at a power chart. `views/ActivityDetailView.tsx` imports this through
 * `import()` for the same reason it lazy-loads the chart, and `pnpm run build`
 * shows the split.
 *
 * ## Interaction is off
 *
 * `interactive: false`, and `MapPanel.tsx` records why at length: a pannable
 * map needs a keyboard equivalent for every gesture before it satisfies #48's
 * third criterion, and that is not this issue's scope. A non-interactive map is
 * a picture, is marked up as one, and puts nothing focusable in the tab order.
 *
 * ## The attribution control is off, and the attribution is not
 *
 * `attributionControl: false` because `MapPanel.tsx` renders the credit as
 * ordinary page text under the map. That is not a removal — it is the only
 * shape that satisfies all four words of #63's fourth criterion, since
 * MapLibre's own control collapses to a "ⓘ" button at narrow widths and
 * "visible without interaction" then stops being true.
 */

// Named imports, not a default: MapLibre v6 ships no default export, and the
// `import maplibregl from 'maplibre-gl'` spelling in every published example
// predates that. It fails the typecheck here rather than at run time.
import {
  addProtocol,
  Map as MapLibreMap,
  removeProtocol,
  setWorkerUrl,
  type AddProtocolAction,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
// The worker, bundled by Vite and addressed by URL. @see the setWorkerUrl note
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';

import { TRACK_LAYER_ID, TRACK_LINE_COLOUR, TRACK_SOURCE_ID } from './basemap';
import type { MapPort, MapRenderer, MapView, MapViewOptions } from './port';
import { createProtocolRegistry } from './protocol';
import type { TrackBounds, TrackFeature } from './track';

/**
 * Where the tile-parsing worker is, because MapLibre cannot work it out here.
 *
 * ⚠️ **Without this the map fetches its tiles and draws none of them, in a
 * production build, silently.** MapLibre v6 parses every vector tile in a Web
 * Worker, and it locates that worker with
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Under a bundler
 * `import.meta.url` is the **hashed chunk** MapLibre was bundled into, so the
 * request goes to `/assets/maplibre-gl-worker.mjs` — a file no bundler emits,
 * because that expression is built from a variable and is not statically
 * analysable. The worker's script 404s, the `Worker` object is created anyway,
 * every `loadTile` message is sent into it and never answered, and the tile sits
 * in `loading` for ever.
 *
 * **Every symptom of that is an absence.** No exception is thrown, `create`
 * returns normally, the canvas has a live GL context, the archive is fetched
 * from the right origin over a correct range request, and the map reports no
 * error. #63's browser gate was green through all of it, because until the
 * fixture archive (#63, `browser/pmtiles-fixture.ts`) there was no tile for the
 * worker to fail to parse — the gate asserted routing, and routing was fine.
 * Building the archive is what surfaced it, which is the ordinary way an
 * endpoint's first real consumer finds its defects.
 *
 * `?worker&url` and **not** `?url`: `maplibre-gl-worker.mjs` imports its sibling
 * `maplibre-gl-shared.mjs`, so a verbatim copy of the one file fails on its
 * first import and nothing loads — the same blank map by a different route.
 * `?worker&url` makes Vite bundle the worker with what it imports and hands back
 * the emitted URL.
 *
 * Set at module scope rather than per map: it is process-wide configuration, and
 * this module is only evaluated when a map is actually wanted — `main.tsx`
 * reaches it through `import()`.
 */
setWorkerUrl(workerUrl);

/** An empty geometry, for a map created before its track is known. */
const EMPTY_TRACK = {
  type: 'FeatureCollection' as const,
  features: [] as unknown[],
};

function sourceDataFor(track: TrackFeature | undefined): unknown {
  return track ?? EMPTY_TRACK;
}

function fit(map: MapLibreMap, bounds: TrackBounds | undefined): void {
  if (bounds === undefined) {
    return;
  }
  map.fitBounds(
    [
      [bounds.west, bounds.south],
      [bounds.east, bounds.north],
    ],
    // Padding so a ride that ends at the edge of its own bounding box is not
    // drawn against the frame, and `animate: false` because there is nothing to
    // animate from — this runs once, on a map that has just appeared.
    { padding: 24, animate: false },
  );
}

const renderer: MapRenderer = {
  create(container: HTMLElement, options: MapViewOptions): MapView {
    const map = new MapLibreMap({
      container,
      // The style is built by `basemap.ts` from configuration and is never
      // fetched from a URL. `basemap.test.ts` asserts every origin it names is
      // the configured one; a `style: 'https://…/style.json'` here would put
      // that back outside the assertion's reach.
      style: {
        ...options.style,
        sources: {
          ...options.style.sources,
          [TRACK_SOURCE_ID]: { type: 'geojson', data: EMPTY_TRACK },
        },
        layers: [
          ...options.style.layers,
          {
            id: TRACK_LAYER_ID,
            type: 'line',
            source: TRACK_SOURCE_ID,
            // Round joins and caps so a one-point run renders as a dot rather
            // than as nothing — the same choice `detail/TraceChart.tsx` makes,
            // and `track.ts` explains why a lone fix is kept at all.
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': TRACK_LINE_COLOUR, 'line-width': 3 },
          },
        ],
      } as StyleSpecification,
      interactive: false,
      attributionControl: false,
    });
    map.getCanvas().setAttribute('aria-hidden', 'true');

    /**
     * The line, handed over before the style had loaded, waiting for it.
     *
     * ⚠️ **Found by #535's tiles-off browser case, and it is older than that
     * change.** `MapPanel` calls `setTrack` in the same commit as `create`,
     * and at that moment MapLibre has not loaded the style it was handed, so
     * `getSource` answers `undefined` and the line was silently dropped — every
     * gate stayed green because none of them looked for the line on the
     * drawing buffer. `harness.ts` §`MapLoadResult.trackPainted` does now, and
     * applying the line once the style has loaded is what turns it green.
     *
     * ⚠️ **`style.load`, not `load`.** In MapLibre 6.10.0 `load` fires only
     * once every visible tile has loaded or failed, so waiting on it would hold
     * the rider's own line hostage to the tile host — indefinitely on a hung
     * request, since the PMTiles protocol sets no timeout. The track source is
     * part of the style, so `getSource` answers as soon as `style.load` fires.
     * `undefined` here means nothing is waiting, which is different from a
     * track of `undefined` waiting to clear the line — hence the wrapper.
     */
    let waiting: { readonly track: TrackFeature | undefined } | undefined;
    const draw = (track: TrackFeature | undefined): boolean => {
      const source = map.getSource(TRACK_SOURCE_ID);
      if (source === undefined || !('setData' in source)) {
        return false;
      }
      // `setData` returns a promise in MapLibre v6, resolving when the source
      // has finished reloading. Nothing here waits on it: the map repaints
      // itself and there is no next step to sequence, so it is explicitly
      // discarded rather than left floating for the linter to find. A
      // rejection surfaces on the map's own `error` event.
      void (source as GeoJSONSource).setData(
        sourceDataFor(track) as Parameters<GeoJSONSource['setData']>[0],
      );
      return true;
    };
    map.once('style.load', () => {
      if (waiting !== undefined) {
        draw(waiting.track);
        waiting = undefined;
      }
    });

    return {
      setTrack(track: TrackFeature | undefined, bounds: TrackBounds | undefined): void {
        waiting = draw(track) ? undefined : { track };
        fit(map, bounds);
      },
      destroy(): void {
        map.remove();
      },
    };
  },
};

/**
 * The client's one map port.
 *
 * Module-scope, so the protocol registry is a singleton across the application
 * — which is what makes "registered once per application lifetime" true of the
 * process rather than only of one component tree.
 */
export const mapLibrePort: MapPort = {
  renderer,
  protocol: createProtocolRegistry(
    {
      addProtocol: (scheme, handler) => {
        addProtocol(scheme, handler as AddProtocolAction);
      },
      removeProtocol: (scheme) => {
        removeProtocol(scheme);
      },
    },
    // A thunk: building the `Protocol` allocates a tile cache, and a build that
    // never shows a map should never pay for one.
    () => new Protocol().tile,
  ),
};
