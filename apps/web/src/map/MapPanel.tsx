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
 * 2. **No basemap is configured.** Since #534 a build with nothing set draws
 *    the archive #53 published, so this is a build somebody told `none`, or
 *    gave a value that is not an `https:` URL. Says so plainly.
 * 3. **No renderer.** The accessibility suite, and any browser without WebGL.
 *    Says so, and the trace and the table above are unaffected.
 *
 * An empty map centred on 0°, 0° is the failure all three exist to avoid, and
 * it is worth naming because it is what a map component does by default when
 * you give it nothing.
 *
 * ## A ride outside the archive's coverage is a line on a plain background
 *
 * The published archive covers the contiguous United States (`basemap.ts`
 * §`PUBLISHED_BASEMAP_URL`). A ride anywhere else gets the map container, the
 * style's background colour, the ride's own line fitted to its bounds, and the
 * attribution beneath — and no tiles, because MapLibre asks for none outside
 * the bounds the archive's header declares. No error, no retry, no spinner:
 * there is no loading state on this panel to get stuck in. It is deliberately
 * NOT a fourth message: whether the line falls inside coverage is a question
 * about the archive's header, and answering it here would mean fetching that
 * header for a panel that has already drawn everything it can.
 * `map.browser.spec.ts` §"a ride outside the archive's coverage" is the
 * measurement.
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
 * ## In the page's palette, following it (#672)
 *
 * The style is the page's palette's (`basemap.ts` §`MAP_COLOURS`), and a
 * change of palette while the map is open repaints it in place rather than
 * rebuilding it: `themed-map.ts` holds the one watch per map, and ends it
 * when the map is released. The palette is deliberately NOT a dependency of
 * the effect below — a map rebuilt to change colour would refetch every tile.
 *
 * ⚠️ **The description names no place.** ADR 0004 decision D: a message about a
 * coordinate names the field and the constraint and never the value. The label
 * says how many parts the track has, not where any of them is.
 *
 * ## A saved route's map can be moved — #2003
 *
 * `explorable` is a saved route's page, where looking along the route and
 * reading its street names is the point. The map takes a drag and a pinch
 * (`maplibre.ts` §`EXPLORABLE`), and every one of those has an ordinary
 * button below the attribution — *Zoom in*, *Zoom out*, four compass moves and
 * *Whole route* — which is the keyboard's way and a single pointer's way to do
 * the same (WCAG 2.2 SC 2.1.1 and 2.5.7). That is what #48's third criterion
 * asked for before a map could move, and why a ride's page still draws the
 * picture: nothing there asked for a map that moves.
 *
 * The surface itself is still `role="img"` and still out of the tab order: a
 * focusable canvas would be a tab stop with nothing to say, and the buttons are
 * the named controls.
 *
 * ## Offline is a fourth state, on a route's page
 *
 * `offline` (#2003): the streets come from the archive over the network and
 * ADR 0024 D-2 does not precache it, so a map drawn offline is the route's
 * line on a plain box. The page says the map is unavailable instead, and draws
 * it when the device is back online.
 */

import { useEffect, useRef, type JSX } from 'react';

import { Button } from '../design/Button';
import { basemapStyle, MAP_COLOURS, type BasemapConfig } from './basemap';
import type { MapPort, MapView } from './port';
import { createThemedMap } from './themed-map';
import { trackBounds, trackFeature, type TrackGeometry } from './track';

export interface MapPanelProps {
  /**
   * The renderer and the protocol registry, or `undefined` where there is none.
   *
   * Passed in like every other port in this client, so the accessibility suite
   * can render this panel on a machine with no WebGL.
   */
  readonly port?: MapPort | undefined;
  /** Where the basemap is, or `undefined` for a build configured with none (#534). */
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
  /**
   * Whether to draw map tiles under the line — the rider's Settings switch
   * (`tiles-preference.ts`), on unless they turned it off.
   *
   * `false` builds a style with no source (`basemap.ts` §`basemapStyle`), so
   * the tile host is contacted by nothing and the line is drawn on the plain
   * background. ⚠️ **The attribution is rendered either way**: it follows
   * the map panel rather than the tiles, and the owner's decision of
   * 2026-09-25 keeps it.
   */
  readonly tiles?: boolean;
  /** What the line is, for the words around the map: a ride's track or a saved route (#2003). */
  readonly subject?: MapSubject;
  /** Whether the rider can move the map, with buttons for every gesture (#2003). Off by default. */
  readonly explorable?: boolean;
  /**
   * The device is offline (#2003): no map is created and the panel says it is
   * unavailable. `undefined` and `false` both draw it.
   */
  readonly offline?: boolean | undefined;
}

/** @see MapPanelProps.subject */
export type MapSubject = 'ride' | 'route';

/**
 * Everything the panel says, per subject.
 *
 * A ride's words are the ones that page has always had. A route's say the same
 * things about a line with no ride behind it — its facts are above the map and
 * its downloads below, and neither needs the map.
 */
const WORDS: Readonly<
  Record<
    MapSubject,
    {
      readonly label: (parts: number) => string;
      readonly noRenderer: string;
      readonly noBasemap: string;
    }
  >
> = {
  ride: {
    label: (parts) =>
      parts === 1
        ? 'Map of this ride’s route.'
        : `Map of this ride’s route, drawn in ${String(parts)} separate parts.`,
    noRenderer:
      'This browser cannot draw a map — it needs WebGL, which is unavailable here. Everything ' +
      'about the ride above is unaffected.',
    noBasemap:
      'No basemap is configured for this build, so the route is not drawn. The ride’s track is ' +
      'stored on this device either way, and exporting it gives you the whole thing.',
  },
  route: {
    label: (parts) =>
      parts === 1
        ? 'Map of this route.'
        : `Map of this route, drawn in ${String(parts)} separate parts.`,
    // Each one short line: the route's page holds every section to one
    // (`a11y/section-lines.ts`, #1013).
    noRenderer:
      'This browser cannot draw a map: it needs WebGL. The route’s facts and downloads are ' +
      'unaffected.',
    noBasemap:
      'This build has no basemap, so the route is not drawn on a map. Its facts and downloads ' +
      'are unaffected.',
  },
};

/** What the panel says offline (#2003), whatever the line is. */
export const MAP_OFFLINE_TEXT =
  'The map is unavailable offline: its streets are not stored on this device. It is drawn once ' +
  'you are online.';

/** The buttons an explorable map is moved with (#2003), in the order they are read. */
const MOVES: readonly { readonly label: string; readonly move: (view: MapView) => void }[] = [
  { label: 'Zoom in', move: (view) => view.zoom('in') },
  { label: 'Zoom out', move: (view) => view.zoom('out') },
  { label: 'Move north', move: (view) => view.pan('north') },
  { label: 'Move west', move: (view) => view.pan('west') },
  { label: 'Move east', move: (view) => view.pan('east') },
  { label: 'Move south', move: (view) => view.pan('south') },
  { label: 'Whole route', move: (view) => view.fitTrack() },
];

export function MapPanel({
  port,
  basemap,
  track,
  tiles = true,
  subject = 'ride',
  explorable = false,
  offline = false,
}: MapPanelProps): JSX.Element | null {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<MapView | undefined>(undefined);
  const words = WORDS[subject];

  const drawable = track !== undefined && port !== undefined && basemap !== undefined && !offline;
  const parts = track?.coordinates.length ?? 0;
  const label = words.label(parts);

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

    // In the page's palette, and repainted in the other one when the page
    // changes (#672) — by one watch that `destroy` below ends with the map.
    const created = createThemedMap(
      port.renderer,
      container.current,
      container.current.ownerDocument,
      (theme) => ({
        style: basemapStyle(basemap, { tiles, theme }),
        trackColour: MAP_COLOURS[theme].track,
      }),
      explorable,
    );
    view.current = created;
    return () => {
      created.destroy();
      view.current = undefined;
    };
  }, [drawable, port, basemap, tiles, explorable]);

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
    // `drawable` too: a map created when the device comes back online (#2003)
    // is created after this effect last ran, and needs the line handed again.
  }, [track, drawable]);

  // Nothing to draw. Not an empty map — see the module note.
  if (track === undefined) {
    return null;
  }

  if (port === undefined) {
    return <p className="oyl-muted">{words.noRenderer}</p>;
  }

  if (basemap === undefined) {
    return <p className="oyl-muted">{words.noBasemap}</p>;
  }

  if (offline) {
    return <p className="oyl-muted">{MAP_OFFLINE_TEXT}</p>;
  }

  return (
    <>
      <div className="oyl-map" ref={container} role="img" aria-label={label} />
      {/*
        Directly under the map, as ordinary text. A licence obligation rather
        than a credit — see the module note and ODbL §4.3.
      */}
      <p className="oyl-map__attribution">{basemap.attribution}</p>
      {explorable && (
        // After the credit, so the credit stays the map's next sibling.
        <div className="oyl-map__moves" role="group" aria-label="Move the map">
          {MOVES.map(({ label: name, move }) => (
            <Button
              key={name}
              variant="secondary"
              onClick={() => {
                if (view.current !== undefined) move(view.current);
              }}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
