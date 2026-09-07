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
  type AddProtocolAction,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import { TRACK_LAYER_ID, TRACK_SOURCE_ID } from './basemap';
import type { MapPort, MapRenderer, MapView, MapViewOptions } from './port';
import { createProtocolRegistry } from './protocol';
import type { TrackBounds, TrackFeature } from './track';

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
            paint: { 'line-color': '#b5341f', 'line-width': 3 },
          },
        ],
      } as StyleSpecification,
      interactive: false,
      attributionControl: false,
    });
    map.getCanvas().setAttribute('aria-hidden', 'true');

    return {
      setTrack(track: TrackFeature | undefined, bounds: TrackBounds | undefined): void {
        const source = map.getSource(TRACK_SOURCE_ID);
        if (source !== undefined && 'setData' in source) {
          // `setData` returns a promise in MapLibre v6, resolving when the
          // source has finished reloading. Nothing here waits on it: the map
          // repaints itself and there is no next step to sequence, so it is
          // explicitly discarded rather than left floating for the linter to
          // find. A rejection surfaces on the map's own `error` event.
          void (source as GeoJSONSource).setData(
            sourceDataFor(track) as Parameters<GeoJSONSource['setData']>[0],
          );
        }
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
