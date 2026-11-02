// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What this client needs of a map, and nothing more.
 *
 * The same seam as `packages/sensors`: `src/` names no platform API and
 * `web-bluetooth/` is the one place a `BluetoothDevice` exists. Here, every
 * module in `map/` but `maplibre.ts` is written against these interfaces, and
 * `maplibre.ts` is the one place `maplibre-gl` and `pmtiles` are named.
 *
 * ## Why a seam rather than a browser test
 *
 * MapLibre GL JS renders through **WebGL**, and jsdom implements none — no
 * layout, no canvas context, no GL. Every test in this repository runs under
 * jsdom (docs/agents/accessibility.md §4e says so of the accessibility gate, and the rest follows
 * it), so `new maplibregl.Map(...)` cannot be constructed in this suite at all.
 *
 * The alternative would be a headless-browser job. ⚠️ **It was taken, after
 * this paragraph was written** — a reviewer who remembers this file saying the
 * option *"was not taken here"* is reading the old one. #176 added
 * `apps/web/browser/`, inside the existing `Repository rules` job rather than
 * beside it, for exactly the reason the old paragraph gave: docs/agents/ci.md §4c
 * records that a second job reports under a different context and could not
 * block a merge. (Since #1285 it is a shard of that check: a job of its own
 * that the job named `Repository rules` waits for.) §4f is what that gate is
 * and is not.
 *
 * What the seam buys is not a workaround. Most of #63's criteria are about
 * **what this client does** — how many times it registers a protocol, which
 * origins its style reaches, what coordinate array it hands the map, what it
 * renders when there is no GPS. All of those are decided on this side of the
 * boundary, and asserting them here is stronger than reading pixels: a
 * screenshot cannot tell you the array behind the line had the front door still
 * in it.
 *
 * ⚠️ What it does **not** buy is a check that MapLibre draws what we asked —
 * and that gap was not theoretical. `maplibre.ts` shipped for months unable to
 * load its own tile-parsing worker under a bundler, so a production map would
 * have fetched every tile and drawn none of them. Nothing on this side of the
 * seam could see it: the port was satisfied, the style was right, the origins
 * were right, the protocol registered once. It took a real archive rendered in
 * a real engine (`browser/pmtiles-fixture.ts`) to find it. Read
 * `maplibre.ts`'s `setWorkerUrl` note before trusting a green suite here to
 * mean the map works.
 */

import type { GeographicPosition } from '@onyourleft/domain';

import type { BasemapStyle } from './basemap';
import type { TrackBounds, TrackFeature } from './track';

/** A live map. Created by a {@link MapRenderer}, destroyed by its owner. */
export interface MapView {
  /**
   * Replace the ride's line.
   *
   * `undefined` removes it. Separate from creation because the shared-view
   * toggle swaps one geometry for another without tearing the map down, and a
   * map that had to be rebuilt to change its line would flash the basemap and
   * refetch every tile.
   */
  setTrack(
    track: TrackFeature | undefined,
    bounds: TrackBounds | undefined,
    /**
     * Whether to move the view to `bounds` now (#2006). On unless `false`.
     * The route planner hands its line over on every edit and fits it only
     * once: a map that jumped to the whole route at every tap would throw the
     * rider off the street they were working on. `bounds` is still kept for
     * {@link fitTrack} either way.
     */
    fitNow?: boolean,
  ): void;
  /**
   * Repaint the same map in another basemap style — the other palette's,
   * when the page changes palette (#672).
   *
   * The map is not rebuilt: the ride's line it holds stays on it, the
   * `pmtiles://` protocol stays registered (it is the application's, not the
   * map's), and MapLibre applies a style that differs only in colour as
   * paint changes against the source it already has.
   */
  setStyle(options: MapViewOptions): void;
  /**
   * Zoom one step in or out about the map's centre (#2003).
   *
   * The keyboard's and a single pointer's way to do what a pinch or a double
   * tap does on a map created {@link MapCreateOptions.explorable}: WCAG 2.2
   * SC 2.1.1 and 2.5.7 want every gesture to have one, and `MapPanel.tsx`
   * renders them as ordinary buttons beside the map.
   */
  zoom(direction: MapZoomDirection): void;
  /** Move the view a third of the map's width or height (#2003). The drag's equivalent. */
  pan(direction: MapPanDirection): void;
  /** Fit the view to the line it holds again, after the rider has moved it (#2003). */
  fitTrack(): void;
  /**
   * Put the route planner's waypoints on the map as markers a pointer can drag
   * (#2006), replacing the ones it holds; matched by id, so a marker that is
   * being dragged is the same marker after the planner redraws. Only a map
   * created {@link MapCreateOptions.editable} draws them.
   */
  setWaypoints(waypoints: readonly MapWaypoint[]): void;
  /** Where the middle of the view is now (#2006): the route planner's first waypoint. */
  centre(): GeographicPosition;
  /**
   * Hear the pointer on an editable map (#2006). One set of handlers per map;
   * a second call replaces the first.
   */
  listen(handlers: MapPointerHandlers): void;
  /** Release the map and everything it holds. Idempotent. */
  destroy(): void;
}

/**
 * What a map is created with — the basemap, and nothing about the ride.
 *
 * The track is **not** here, deliberately. A map is created empty and its line
 * arrives through {@link MapView.setTrack}, so there is exactly one code path
 * that puts geometry on a map rather than two that can disagree. It also means
 * the shared-view toggle swaps one line for another without tearing the map
 * down — which would blank the basemap and refetch every tile to change a
 * polyline.
 */
export interface MapViewOptions {
  readonly style: BasemapStyle;
  /**
   * The ride's line colour (#672), which is the adapter's layer rather than
   * the style's — `basemap.ts` §`MAP_COLOURS`' `track`, for the same palette
   * as {@link style}.
   */
  readonly trackColour: string;
}

/** @see MapView.zoom */
export type MapZoomDirection = 'in' | 'out';

/** @see MapView.pan — compass directions, because the map keeps north up. */
export type MapPanDirection = 'north' | 'south' | 'east' | 'west';

/**
 * What a map is created with: its first style, and whether a rider may move it.
 *
 * A separate type from {@link MapViewOptions} because {@link MapView.setStyle}
 * takes those and a change of palette must not be able to change the other.
 */
export interface MapCreateOptions extends MapViewOptions {
  /**
   * Whether the rider can drag and pinch the map (#2003) — a saved route's
   * page, where looking along the route is the point. Off, the default, is the
   * picture a ride's page draws (`MapPanel.tsx` §"The map is a picture").
   *
   * ⚠️ **The gestures are the pointer's half only.** The map surface stays out
   * of the tab order; its keyboard half is {@link MapView.zoom},
   * {@link MapView.pan} and {@link MapView.fitTrack}, which the panel puts on
   * buttons.
   */
  readonly explorable?: boolean;
  /**
   * Whether the map is the route planner's (#2006): a tap is heard, the
   * waypoints are markers that drag, and the line can be dragged to bend it.
   * Only meaningful on an {@link explorable} map.
   *
   * ⚠️ **The pointer's way only, and never the only way.** The markers take no
   * focus — the planner's list is the keyboard's way to place, move and insert
   * a waypoint (`views/RouteBuilderView.tsx`) — so nothing here is a tab stop.
   */
  readonly editable?: boolean;
}

/** One waypoint as an editable map draws it (#2006). */
export interface MapWaypoint {
  /** The planner's id, which a drag hands back. */
  readonly id: string;
  readonly position: GeographicPosition;
}

/**
 * What an editable map tells its owner (#2006). Each fires once per gesture,
 * at its end: a waypoint dragged across the map is one move, not a hundred.
 */
export interface MapPointerHandlers {
  /** A tap or click on the map, away from a waypoint. */
  readonly tap: (position: GeographicPosition) => void;
  /** A waypoint was dragged and let go here. */
  readonly moveWaypoint: (id: string, position: GeographicPosition) => void;
  /**
   * The line was grabbed at `from` and let go at `to`. The map does not know
   * which leg that was: the planner works it out from `from`
   * (`routing/map-edit.ts` §`nearestLeg`).
   */
  readonly dragLine: (from: GeographicPosition, to: GeographicPosition) => void;
}

export interface MapRenderer {
  create(container: HTMLElement, options: MapCreateOptions): MapView;
}

/**
 * The global protocol registration MapLibre exposes.
 *
 * Narrowed to the two calls this client makes, so `protocol.ts` can be tested
 * against a counter rather than against the library.
 */
export interface ProtocolRegistrar {
  addProtocol(scheme: string, handler: unknown): void;
  removeProtocol(scheme: string): void;
}

/**
 * Everything the map panel needs, in one object.
 *
 * Passed down like every other port in this client (`LibraryPort`,
 * `TransferPort`, `DetailPort`) so the accessibility suite can render the panel
 * on a machine with no WebGL. `undefined` renders the honest explanation.
 */
export interface MapPort {
  readonly renderer: MapRenderer;
  readonly protocol: ProtocolRegistry;
}

/** @see createProtocolRegistry */
export interface ProtocolRegistry {
  /** Register the handler if it is not registered. Idempotent by contract. */
  ensure(): void;
  /** Remove it if it is registered. Called at application teardown, not on a route change. */
  release(): void;
  /** How many times `addProtocol` has actually been called. #63's second criterion reads this. */
  readonly registrations: number;
  /** How many times `removeProtocol` has actually been called. */
  readonly removals: number;
}
