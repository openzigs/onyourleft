// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the basemap comes from, and the proof that it comes from nowhere else.
 *
 * ## The criterion this file exists to make structural
 *
 * #63's third acceptance criterion: *"Zero requests go to any metered tile API.
 * A test intercepts all network traffic during a map render and fails if any
 * request host is outside the configured basemap origin. This is the criterion
 * that keeps the $950/month option from arriving by accident in a dependency
 * default."*
 *
 * That last clause is the whole thing, and it is not hypothetical. A MapLibre
 * style is not one URL — it is up to four kinds of URL, and **three of them are
 * third-party origins in every published example**:
 *
 * | Style key | What a copied example points at |
 * |---|---|
 * | `sources[].url` | the archive — the one we mean to configure |
 * | `glyphs` | a font-PBF host; Protomaps' own examples use `protomaps.github.io` |
 * | `sprite` | an icon-sprite host; likewise |
 * | a whole `style` URL | MapLibre's own `demotiles.maplibre.org/style.json` |
 *
 * Any of those pasted from documentation ships a request to somebody else's
 * server on every map load, forever, from a line that looks like boilerplate.
 * So the style is **built here from the configuration** rather than fetched,
 * {@link styleOrigins} enumerates every host it references, and
 * `basemap.test.ts` asserts that set is a subset of the configured origin.
 * A third-party URL added to `basemapStyle` fails that test rather than a
 * review.
 *
 * ⚠️ **ADR 0010 does not mention glyphs or sprites**, and that is a gap this
 * issue found rather than one it can close: #53 publishes the archive, and it
 * must publish font and sprite assets on the same origin if the map is ever to
 * carry labels. Until it does, {@link basemapStyle} emits **no** `glyphs` and
 * **no** `sprite`, so the map renders geometry without text. That is a visible
 * limitation and the right one: a labelled map that phones home is worse than
 * an unlabelled map that does not.
 *
 * ## The archive URL is configuration, not a constant
 *
 * #63's seventh criterion. It is read from the environment, which means rule
 * `ENV001` (`scripts/check-env-example.sh`) fails the build if it is not
 * documented in `.env.example` — so "it is configuration" is enforced by the
 * repository rather than asserted by this comment.
 *
 * **`undefined` is an ordinary state, not an error.** #53 has not published an
 * archive yet, so a build with nothing configured is the normal case today. The
 * map panel says so in words rather than rendering an empty grey grid.
 */

/**
 * The attribution OpenStreetMap's licence requires.
 *
 * ODbL 1.0 §4.3 and the OSMF Attribution Guidelines. A rendered basemap tile is
 * a **Produced Work** — attribution is required, share-alike is not triggered —
 * which ADR 0010 D-1 records with the publisher's own wording quoted.
 *
 * This is a **licence obligation, not a courtesy**, and #63's fourth criterion
 * makes it a test rather than a review item: rendered legibly, in the vicinity
 * of the map, no less prominent than any of our own credit, and visible without
 * interaction. `MapPanel.tsx` renders it as ordinary page text outside the map
 * canvas for exactly that reason — a control the reader has to open, or a label
 * drawn inside a WebGL canvas, satisfies none of those four words.
 */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Where the basemap is, and what must be credited for it. */
export interface BasemapConfig {
  /**
   * The PMTiles archive, as an ordinary `https:` URL.
   *
   * Stored **without** the `pmtiles://` prefix: the prefix is a MapLibre
   * protocol selector rather than part of the address, and keeping it out of
   * the configuration is what lets {@link basemapOrigin} parse this with `URL`
   * and lets an operator paste the URL they see in their bucket console.
   * {@link basemapStyle} adds the prefix.
   */
  readonly archiveUrl: string;
  /** Credited beside the map. Defaults to {@link OSM_ATTRIBUTION}. */
  readonly attribution: string;
}

/**
 * The environment names this module reads.
 *
 * Named as a constant rather than inlined so that `.env.example` and this file
 * cannot drift apart silently.
 *
 * ⚠️ The constant is documentation, **not** the read. Rule `ENV001` greps the
 * source for a literal environment access, so the real read below has to spell
 * the variable out; routing it through this constant would take it out of the
 * checker's sight and let the entry in `.env.example` go stale unnoticed. That
 * dumbness is the checker working as designed — it runs on a bare clone with no
 * toolchain — and it is why the name appears twice on purpose.
 */
export const BASEMAP_URL_VARIABLE = 'VITE_BASEMAP_PMTILES_URL';

/** What `readBasemapConfig` reads. A parameter, so a test needs no bundler. */
export interface BasemapEnvironment {
  readonly VITE_BASEMAP_PMTILES_URL?: string | undefined;
}

/**
 * The configured basemap, or `undefined` when there is none.
 *
 * `undefined` for an unset, empty or unparseable value — all three mean the
 * same thing to a reader (there is no map) and distinguishing them in the UI
 * would be reporting our own configuration error to somebody who cannot fix it.
 * A **non-`https:`** URL is refused too: a `http:` archive would be blocked as
 * mixed content on any real deployment, and failing here says so at start-up
 * rather than as an empty map.
 */
export function readBasemapConfig(environment: BasemapEnvironment): BasemapConfig | undefined {
  const raw = environment.VITE_BASEMAP_PMTILES_URL?.trim() ?? '';
  if (raw === '') {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') {
    return undefined;
  }
  return { archiveUrl: parsed.toString(), attribution: OSM_ATTRIBUTION };
}

/** Read the real bundler environment. The one caller that does. */
export function browserBasemapConfig(): BasemapConfig | undefined {
  // Spelled out rather than read through the constant above. See its note: the
  // checker greps for this exact form, so indirection here would hide the read.
  return readBasemapConfig({
    VITE_BASEMAP_PMTILES_URL: import.meta.env.VITE_BASEMAP_PMTILES_URL as string | undefined,
  });
}

/** The one origin every basemap request is permitted to reach. */
export function basemapOrigin(config: BasemapConfig): string {
  return new URL(config.archiveUrl).origin;
}

/**
 * A MapLibre style, in its own JSON shape.
 *
 * Typed here rather than imported from `maplibre-gl`: this module must be
 * readable — and testable — without loading a 900 KB WebGL library into jsdom,
 * and the style is plain data. `map/maplibre.ts` is the one file that names the
 * library, exactly as `packages/sensors/web-bluetooth` is the one place a
 * `BluetoothDevice` exists.
 */
export interface BasemapStyle {
  readonly version: 8;
  readonly sources: Readonly<Record<string, BasemapSource>>;
  readonly layers: readonly BasemapLayer[];
  readonly glyphs?: string;
  readonly sprite?: string;
}

export interface BasemapSource {
  readonly type: 'vector' | 'geojson';
  readonly url?: string;
  readonly data?: unknown;
  readonly attribution?: string;
}

export interface BasemapLayer {
  readonly id: string;
  readonly type: string;
  readonly source?: string;
  readonly 'source-layer'?: string;
  readonly paint?: Readonly<Record<string, unknown>>;
  readonly layout?: Readonly<Record<string, unknown>>;
}

/** The id the ride's own trace is added under, so the adapter and the tests agree on one string. */
export const TRACK_SOURCE_ID = 'oyl-track';
export const TRACK_LAYER_ID = 'oyl-track-line';
/** The vector source the basemap tiles arrive on. */
export const BASEMAP_SOURCE_ID = 'basemap';

/**
 * The style, built from the configuration.
 *
 * **Deliberately minimal, and deliberately ours.** The `protomaps/basemaps`
 * cartography is several hundred layers and its own package; adopting it is a
 * dependency and a licence check (its visual design is CC0, its code BSD-3 —
 * ADR 0010 D-1) that belongs to whichever issue publishes a style alongside the
 * archive. What is here is enough to draw land, water and roads under a ride,
 * with the source-layer names taken from the Protomaps basemap schema.
 *
 * The `pmtiles://` prefix is added here rather than stored, so the
 * configuration holds an address and this holds the protocol selector.
 *
 * No `glyphs` and no `sprite`: see the module note. Both would be third-party
 * origins today, and the criterion above is worth more than labels.
 */
export function basemapStyle(config: BasemapConfig): BasemapStyle {
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: 'vector',
        // The `pmtiles://` URL form, which is what auto-derives the source's
        // `minzoom`/`maxzoom` from the archive header rather than making us
        // guess them — Protomaps' documented integration shape.
        url: `pmtiles://${config.archiveUrl}`,
        attribution: config.attribution,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f5f3ef' } },
      {
        id: 'earth',
        type: 'fill',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'earth',
        paint: { 'fill-color': '#eeece7' },
      },
      {
        id: 'water',
        type: 'fill',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'water',
        paint: { 'fill-color': '#b9d4e8' },
      },
      {
        id: 'roads',
        type: 'line',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'roads',
        paint: { 'line-color': '#ffffff', 'line-width': 1 },
      },
    ],
  };
}

/**
 * Every origin a style would reach, as absolute URLs only.
 *
 * The proof behind #63's third criterion. It walks the style rather than
 * checking the three keys it happens to know about, because the failure this
 * guards against is a **new** key — a `terrain` source, a `sky` texture, a
 * raster overlay — carrying a host nobody thought to look at.
 *
 * A relative URL contributes no origin: it resolves against the page, which is
 * our own deployment by definition.
 */
export function styleOrigins(style: BasemapStyle): readonly string[] {
  const origins = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      // `pmtiles://https://host/x.pmtiles` — strip any protocol selector
      // prefixed to a real URL before parsing, or the origin reads as `null`
      // and a third-party archive would slip through as "no origin".
      const withoutSelector = value.replace(/^[a-z0-9+.-]+:\/\/(?=https?:\/\/)/i, '');
      if (!/^https?:\/\//i.test(withoutSelector)) {
        return;
      }
      try {
        origins.add(new URL(withoutSelector).origin);
      } catch {
        // Not a URL after all. Nothing to record.
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value as unknown[]) {
        visit(entry);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const entry of Object.values(value)) {
        visit(entry);
      }
    }
  };
  visit(style);
  return [...origins].sort();
}
