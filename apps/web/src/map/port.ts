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
 * jsdom (CLAUDE.md §4e says so of the accessibility gate, and the rest follows
 * it), so `new maplibregl.Map(...)` cannot be constructed in this suite at all.
 *
 * The alternative would be a headless-browser job. ⚠️ **It was taken, after
 * this paragraph was written** — a reviewer who remembers this file saying the
 * option *"was not taken here"* is reading the old one. #176 added
 * `apps/web/browser/`, inside the existing `Repository rules` job rather than
 * beside it, for exactly the reason the old paragraph gave: CLAUDE.md §4c
 * records that a second job reports under a different context and could not
 * block a merge. §4f is what that gate is and is not.
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
  setTrack(track: TrackFeature | undefined, bounds: TrackBounds | undefined): void;
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
}

export interface MapRenderer {
  create(container: HTMLElement, options: MapViewOptions): MapView;
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
