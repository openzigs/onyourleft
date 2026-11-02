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
 * ## Interaction is off, unless the map is created explorable
 *
 * `interactive: false` by default, and `MapPanel.tsx` records why at length: a
 * pannable map needs a keyboard equivalent for every gesture before it
 * satisfies #48's third criterion. A non-interactive map is a picture, is
 * marked up as one, and puts nothing focusable in the tab order.
 *
 * Since #2003 a saved route's page creates its map `explorable`
 * ({@link EXPLORABLE}): drag to pan, pinch and double-tap to zoom, and the
 * keyboard's equivalents are buttons the panel renders, which reach the map
 * through `MapView.zoom`, `pan` and `fitTrack`. ⚠️ **The canvas still takes no
 * focus**: MapLibre gives an interactive map's canvas `tabindex="0"`, and a
 * focusable element inside an `aria-hidden` one is an audit failure and a tab
 * stop that announces nothing, so it is put back to `-1` below.
 *
 * ## An editable map is the route planner's — #2006
 *
 * Created {@link MapCreateOptions.editable}, the map hears a tap, draws the
 * planner's waypoints as markers that drag, and lets the line be grabbed and
 * pulled to bend it — each reported once, at its end, through
 * `MapPointerHandlers`. Double-click zoom is off on it, because two quick taps
 * are two waypoints there; the zoom buttons remain.
 *
 * ⚠️ **The markers are custom elements, and that is the keyboard decision.**
 * In the version the lockfile pins (6.12.0) a draggable **default** marker is
 * keyboard-operable: MapLibre gives it `tabindex="0"` and `role="button"`,
 * and an arrow key moves it one screen pixel (ten with Shift), firing the same
 * drag events. Three things make that the wrong keyboard path here: a pixel is
 * no stated distance (the planner's nudge is about 55 m, `RouteBuilderView`
 * §`NUDGE_DEGREES`), the markers sit inside the map's `role="img"`, where a
 * focusable button is an audit failure, and the planner's list already places,
 * moves and inserts every waypoint from the keyboard. So each marker is our
 * own `aria-hidden` element, which MapLibre leaves out of the tab order and
 * gives no role, and the list stays the one keyboard path.
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
  Marker,
  removeProtocol,
  setWorkerUrl,
  type AddProtocolAction,
  type GeoJSONSource,
  type LngLat,
  type MapMouseEvent,
  type MapTouchEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
// The worker, bundled by Vite and addressed by URL. @see the setWorkerUrl note
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';

import { TRACK_LAYER_ID, TRACK_SOURCE_ID } from './basemap';
import type {
  MapCreateOptions,
  MapPanDirection,
  MapPointerHandlers,
  MapPort,
  MapRenderer,
  MapView,
  MapViewOptions,
  MapWaypoint,
  MapZoomDirection,
} from './port';
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

/**
 * The style MapLibre is handed: the basemap, with the ride's line on top.
 *
 * The line's data is part of it, so a style handed over again (#672's
 * {@link MapView.setStyle}) carries the line the map already shows. Against
 * a loaded style MapLibre applies the difference — here, paint colours — and
 * against one still loading it rebuilds from this, and either way the line
 * is in it rather than waiting on a `setData` somebody has to remember.
 */
function fullStyle(
  options: MapViewOptions,
  track: TrackFeature | undefined,
  editable = false,
): StyleSpecification {
  return {
    ...options.style,
    sources: {
      ...options.style.sources,
      [TRACK_SOURCE_ID]: { type: 'geojson', data: sourceDataFor(track) },
    },
    layers: [
      ...options.style.layers,
      // #2006: an invisible line as wide as a fingertip under the drawn one, so
      // the planner's line can be grabbed. Only on an editable map.
      ...(editable
        ? [
            {
              id: TRACK_HIT_LAYER_ID,
              type: 'line',
              source: TRACK_SOURCE_ID,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': options.trackColour, 'line-width': 24, 'line-opacity': 0 },
            },
          ]
        : []),
      {
        id: TRACK_LAYER_ID,
        type: 'line',
        source: TRACK_SOURCE_ID,
        // Round joins and caps so a one-point run renders as a dot rather
        // than as nothing — the same choice `detail/TraceChart.tsx` makes,
        // and `track.ts` explains why a lone fix is kept at all.
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': options.trackColour, 'line-width': 3 },
      },
    ],
  } as StyleSpecification;
}

/**
 * The gestures an explorable map answers (#2003), and the ones it does not.
 *
 * - **Wheel zoom is off.** A map in a scrolling page that zooms on the wheel
 *   catches the page's scroll the moment the pointer crosses it; the zoom
 *   buttons, a double click and a pinch remain.
 * - **Rotation and pitch are off.** The pan buttons are named north, south,
 *   east and west, which is only true of a map that keeps north up.
 * - **One finger scrolls the page.** MapLibre's touch pan calls
 *   `preventDefault` on a one-finger `touchmove`, so a thumb on a map that
 *   fills a phone's screen would pan the map and never the page. The touch pan
 *   is turned off (see `create`); a mouse drag still pans, a pinch still zooms,
 *   and the panel's compass buttons move the view for a touch.
 * - **Box zoom and the keyboard handler are off.** The keyboard handler
 *   listens on the canvas, which is kept out of the tab order (see the module
 *   note), and its equivalents are the panel's buttons.
 */
const EXPLORABLE = {
  interactive: true,
  dragPan: true,
  doubleClickZoom: true,
  touchZoomRotate: true,
  scrollZoom: false,
  boxZoom: false,
  dragRotate: false,
  touchPitch: false,
  keyboard: false,
} as const;

/** How far one press of a pan button moves the view: a third of the map. */
const PAN_FRACTION = 1 / 3;

/** The planner's grab line (#2006): see {@link fullStyle}. */
const TRACK_HIT_LAYER_ID = 'oyl-track-hit';

/** The class every planner marker carries (#2006), and what a tap on one is told apart by. */
const WAYPOINT_CLASS = 'oyl-map__waypoint';

function positionOf(lngLat: LngLat): GeographicPosition {
  return geographicPosition(degreesLatitude(lngLat.lat), degreesLongitude(lngLat.lng));
}

/** Whether a pointer event began on a planner marker rather than on the map under it. */
function onMarker(event: MapMouseEvent | MapTouchEvent): boolean {
  const target = event.originalEvent.target;
  return target instanceof Element && target.closest(`.${WAYPOINT_CLASS}`) !== null;
}

/** A marker's element: ours, so it is out of the tab order — see the module note. */
function markerElement(extra?: string): HTMLElement {
  const element = document.createElement('div');
  element.className = extra === undefined ? WAYPOINT_CLASS : `${WAYPOINT_CLASS} ${extra}`;
  element.setAttribute('aria-hidden', 'true');
  // MapLibre places a marker with a `transform` from the map's top left, and
  // its own stylesheet — not loaded in this client — is what would put it
  // there. Found by the browser gate: unplaced, a marker on the line was not
  // under the pointer, and dragging it pulled the line instead.
  element.style.position = 'absolute';
  element.style.left = '0';
  element.style.top = '0';
  return element;
}

/**
 * The planner's pointer, on an editable map (#2006): the tap, the markers and
 * the line. Returns what the view needs to keep its markers in step.
 */
function editing(map: MapLibreMap): {
  readonly listen: (handlers: MapPointerHandlers) => void;
  readonly setWaypoints: (waypoints: readonly MapWaypoint[]) => void;
} {
  let handlers: MapPointerHandlers | undefined;
  const markers = new Map<string, Marker>();
  // The markers' containing block — see `markerElement`. `theme.css` makes
  // `.oyl-map` positioned; this covers a container it does not style.
  const container = map.getContainer();
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  map.on('click', (event) => {
    if (onMarker(event)) return;
    handlers?.tap(positionOf(event.lngLat));
  });

  /**
   * Grab the line and pull it. A marker that follows the pointer shows where
   * the new waypoint will go; letting go hands the grab and the drop to the
   * planner. A press that does not move is a tap, and `click` above hears it.
   */
  const grab = (event: MapMouseEvent | MapTouchEvent): void => {
    if (onMarker(event)) return;
    if ('points' in event && event.points.length !== 1) return;
    // Stops the map panning under the pull (MapLibre's documented use of it).
    event.preventDefault();
    const from = event.lngLat;
    const start = event.point;
    let moved = false;
    const ghost = new Marker({ element: markerElement(`${WAYPOINT_CLASS}--new`) });
    const follow = (next: MapMouseEvent | MapTouchEvent): void => {
      // A finger on the line pulls the line, not the page: from the first move,
      // or the browser has begun scrolling before the pull is recognised.
      if (next.type === 'touchmove') next.originalEvent.preventDefault();
      if (!moved && next.point.dist(start) < 3) return;
      if (!moved) ghost.setLngLat(next.lngLat).addTo(map);
      moved = true;
      ghost.setLngLat(next.lngLat);
    };
    const drop = (): void => {
      map.off('mousemove', follow);
      map.off('touchmove', follow);
      map.off('mouseup', drop);
      map.off('touchend', drop);
      if (!moved) return;
      const to = ghost.getLngLat();
      ghost.remove();
      handlers?.dragLine(positionOf(from), positionOf(to));
    };
    map.on('mousemove', follow);
    map.on('touchmove', follow);
    map.on('mouseup', drop);
    map.on('touchend', drop);
  };
  map.on('mousedown', TRACK_HIT_LAYER_ID, grab);
  map.on('touchstart', TRACK_HIT_LAYER_ID, grab);

  return {
    listen: (next) => {
      handlers = next;
    },
    setWaypoints: (waypoints) => {
      const wanted = new Set(waypoints.map((waypoint) => waypoint.id));
      for (const [id, marker] of markers) {
        if (!wanted.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
      for (const waypoint of waypoints) {
        const at: [number, number] = [waypoint.position.longitude, waypoint.position.latitude];
        const held = markers.get(waypoint.id);
        if (held !== undefined) {
          held.setLngLat(at);
          continue;
        }
        const marker = new Marker({ element: markerElement(), draggable: true })
          .setLngLat(at)
          .addTo(map);
        marker.on('dragend', () => {
          handlers?.moveWaypoint(waypoint.id, positionOf(marker.getLngLat()));
        });
        markers.set(waypoint.id, marker);
      }
    },
  };
}

const renderer: MapRenderer = {
  create(container: HTMLElement, options: MapCreateOptions): MapView {
    /** The line the map shows, so a new style is handed it too. */
    let current: TrackFeature | undefined;
    const editable = options.explorable === true && options.editable === true;
    const map = new MapLibreMap({
      container,
      // The style is built by `basemap.ts` from configuration and is never
      // fetched from a URL. `basemap.test.ts` asserts every origin it names is
      // the configured one; a `style: 'https://…/style.json'` here would put
      // that back outside the assertion's reach.
      style: fullStyle(options, current, editable),
      ...(options.explorable === true ? EXPLORABLE : { interactive: false }),
      // Two quick taps on the planner are two waypoints, not a zoom (#2006).
      ...(editable ? { doubleClickZoom: false } : {}),
      attributionControl: false,
    });
    map.getCanvas().setAttribute('aria-hidden', 'true');
    // MapLibre makes an interactive map's canvas a tab stop. See the module note.
    map.getCanvas().setAttribute('tabindex', '-1');
    if (options.explorable === true) {
      // A pinch zooms; it does not also turn the map. See `EXPLORABLE`.
      map.touchZoomRotate.disableRotation();
      // `dragPan` switches the mouse and the touch pan together; only the
      // touch half is unwanted. See `EXPLORABLE`.
      map.dragPan._touchPan.disable();
    }
    /** The box the line was last fitted to, for `fitTrack`. */
    let fitted: TrackBounds | undefined;
    /** The planner's pointer, on an editable map only (#2006). */
    const edit = editable ? editing(map) : undefined;

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
     * ⚠️ **`style.load`, not `load`.** In MapLibre 6.10.0 — and in 6.11.2,
     * whose `Map.loaded()` and tile-manager `loaded()` are unchanged (#756) —
     * `load` fires only once every visible tile has loaded or failed, so
     * waiting on it would hold the rider's own line hostage to the tile host
     * — indefinitely on a hung request, since the PMTiles protocol sets no
     * timeout. The track source is part of the style, so `getSource` answers
     * as soon as `style.load` fires.
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
      setTrack(
        track: TrackFeature | undefined,
        bounds: TrackBounds | undefined,
        fitNow?: boolean,
      ): void {
        current = track;
        waiting = draw(track) ? undefined : { track };
        fitted = bounds;
        if (fitNow !== false) fit(map, bounds);
      },
      zoom(direction: MapZoomDirection): void {
        // Animated unless the device asks for reduced motion, which MapLibre's
        // camera honours on its own.
        if (direction === 'in') {
          map.zoomIn();
        } else {
          map.zoomOut();
        }
      },
      pan(direction: MapPanDirection): void {
        const x = map.getContainer().clientWidth * PAN_FRACTION;
        const y = map.getContainer().clientHeight * PAN_FRACTION;
        // Screen pixels, y downward: north is up the screen on a map kept north up.
        const offset: Record<MapPanDirection, [number, number]> = {
          north: [0, -y],
          south: [0, y],
          east: [x, 0],
          west: [-x, 0],
        };
        map.panBy(offset[direction]);
      },
      fitTrack(): void {
        fit(map, fitted);
      },
      setWaypoints(waypoints: readonly MapWaypoint[]): void {
        edit?.setWaypoints(waypoints);
      },
      centre(): GeographicPosition {
        return positionOf(map.getCenter());
      },
      listen(handlers: MapPointerHandlers): void {
        edit?.listen(handlers);
      },
      setStyle(next: MapViewOptions): void {
        // `setStyle` diffs against the loaded style, so a change of palette
        // is a set of paint-property writes and the archive source, the same
        // URL, is kept rather than rebuilt. Before the first
        // style has loaded MapLibre cannot diff, warns once, and rebuilds
        // from this object instead — which still carries the line.
        map.setStyle(fullStyle(next, current, editable));
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
