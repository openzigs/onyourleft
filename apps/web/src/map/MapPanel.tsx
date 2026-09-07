// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride on a map, and every state in which there is no map to show.
 *
 * ## Three ways there is no map, and none of them is an empty map
 *
 * 1. **The ride has no GPS.** #63's first criterion and #50's, and the common
 *    case rather than the exception — most Phase 1 rides are indoor. Renders
 *    nothing at all: no container, no attribution, no broken tile grid. The
 *    detail view has already said "Indoor — no GPS track" in words.
 * 2. **No basemap is configured.** There is no published archive yet — #53 owns
 *    that — so this is the *normal* state of a build today. Says so plainly.
 * 3. **No renderer.** The accessibility suite, and any browser without WebGL.
 *    Says so, and the trace and the table above are unaffected.
 *
 * An empty map centred on 0°, 0° is the failure all three exist to avoid, and
 * it is worth naming because it is what a map component does by default when
 * you give it nothing.
 *
 * ## The attribution is a licence obligation
 *
 * ODbL §4.3 and the OSMF Attribution Guidelines, and #63's fourth criterion
 * spells out the four properties: *legible, in the vicinity of the map, no less
 * prominent than any of our own credit, and visible without interaction.*
 *
 * So it is **ordinary page text directly under the map**, not a collapsed
 * "ⓘ" control and not something drawn inside the WebGL canvas. A control the
 * reader has to open fails "without interaction"; a label painted into the
 * canvas fails "legible" for a screen reader and disappears with the GL
 * context. `map.a11y.test.tsx` asserts it is in the DOM whenever a map is.
 *
 * ## The map is a picture, deliberately
 *
 * `role="img"` with a description, and the adapter constructs MapLibre with
 * interaction **off**. A pannable map needs keyboard equivalents for every
 * gesture to satisfy #48's third criterion, and that is a piece of work this
 * issue does not ask for. A non-interactive rendering is honestly a picture,
 * `role="img"` is exactly right for one, and nothing inside it is focusable —
 * which is what keeps it out of the tab order rather than sitting in it as an
 * unlabelled stop.
 *
 * ⚠️ **The description names no place.** ADR 0004 decision D: a message about a
 * coordinate names the field and the constraint and never the value. The label
 * says how many parts the track has, not where any of them is.
 */

import { useEffect, useRef, type JSX } from 'react';

import { basemapStyle, type BasemapConfig } from './basemap';
import type { MapPort, MapView } from './port';
import { trackBounds, trackFeature, type TrackGeometry } from './track';

export interface MapPanelProps {
  /**
   * The renderer and the protocol registry, or `undefined` where there is none.
   *
   * Passed in like every other port in this client, so the accessibility suite
   * can render this panel on a machine with no WebGL.
   */
  readonly port?: MapPort | undefined;
  /** Where the basemap is, or `undefined` until #53 publishes one. */
  readonly basemap?: BasemapConfig | undefined;
  /**
   * The ride's line, already segmented and already trimmed if it is going to
   * be.
   *
   * `undefined` means there is nothing to draw. **This component performs no
   * trimming of its own and must never start**: ADR 0004 decision C is that
   * obfuscation is applied in the payload and never by the renderer, and a
   * component that filtered points here would be the exact shape the ADR
   * rejects — the untrimmed array would still be one `props` inspection away.
   */
  readonly track?: TrackGeometry | undefined;
}

export function MapPanel({ port, basemap, track }: MapPanelProps): JSX.Element | null {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<MapView | undefined>(undefined);

  const drawable = track !== undefined && port !== undefined && basemap !== undefined;
  const parts = track?.coordinates.length ?? 0;
  const label =
    parts === 1
      ? 'Map of this ride’s route.'
      : `Map of this ride’s route, drawn in ${String(parts)} separate parts.`;

  /**
   * Create the map — once per basemap, **not** once per track.
   *
   * The dependency list deliberately excludes `track`. A map rebuilt to change
   * its line blanks the basemap and refetches every tile, which on an archive
   * ADR 0010 already warns is high-latency is a visible stall every time the
   * rider opens the shared view. The line arrives through `setTrack` below.
   */
  useEffect(() => {
    if (!drawable || container.current === null) {
      return;
    }
    // Idempotent, and called from the component rather than only from the root
    // so that the deduplication in `protocol.ts` is the thing being relied on.
    // See that file for why `release()` is not called here.
    port.protocol.ensure();

    const created = port.renderer.create(container.current, { style: basemapStyle(basemap) });
    view.current = created;
    return () => {
      created.destroy();
      view.current = undefined;
    };
  }, [drawable, port, basemap]);

  /**
   * Put the line on it, and put a different line on it when the rider asks.
   *
   * The one path geometry reaches a map by. Runs after the effect above on
   * first render, and alone on every later change of `track` — which is what
   * makes swapping the owner's track for the shared one cost a `setData` call
   * rather than a map.
   */
  useEffect(() => {
    view.current?.setTrack(trackFeature(track), trackBounds(track));
  }, [track]);

  // Nothing to draw. Not an empty map — see the module note.
  if (track === undefined) {
    return null;
  }

  if (port === undefined) {
    return (
      <p className="oyl-muted">
        This browser cannot draw a map — it needs WebGL, which is unavailable here. Everything about
        the ride above is unaffected.
      </p>
    );
  }

  if (basemap === undefined) {
    return (
      <p className="oyl-muted">
        No basemap is configured for this build, so the route is not drawn. The ride’s track is
        stored on this device either way, and exporting it gives you the whole thing.
      </p>
    );
  }

  return (
    <>
      <div className="oyl-map" ref={container} role="img" aria-label={label} />
      {/*
        Directly under the map, as ordinary text. A licence obligation rather
        than a credit — see the module note and ODbL §4.3.
      */}
      <p className="oyl-map__attribution">{basemap.attribution}</p>
    </>
  );
}
