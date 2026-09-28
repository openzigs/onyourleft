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
 * ⚠️ **ADR 0010 does not mention glyphs or sprites**, and #63 found that gap
 * rather than closing it: for months {@link basemapStyle} emitted **no**
 * `glyphs` and **no** `sprite`, so the map drew geometry without a word on it.
 * A labelled map that phones home was judged worse than an unlabelled map that
 * does not, and that judgement stands.
 *
 * ⚠️ **Since #578 the map has labels, and a reviewer who remembers "no glyphs"
 * is reading the old file.** The owner decided on 2026-09-26 to bundle an
 * Apache-2.0 font's glyphs **in the app**, so {@link GLYPHS_URL} is a
 * **relative** URL: it resolves against the page, which is this deployment by
 * definition, and {@link styleOrigins} — which records no origin for a relative
 * URL — still reports the archive's origin and nothing else. The glyphs are
 * made by `tools/glyphs/` from a committed Roboto v2.138 (the last Apache-2.0
 * Roboto) and served out of `public/glyphs/`; `map.browser.spec.ts` §"place
 * names" proves the engine really fetches them from the page's own origin.
 * There is still **no sprite**: no layer here draws an icon.
 *
 * ## The archive URL is configuration, not a constant
 *
 * #63's seventh criterion. It is read from the environment, which means rule
 * `ENV001` (`scripts/check-env-example.sh`) fails the build if it is not
 * documented in `.env.example` — so "it is configuration" is enforced by the
 * repository rather than asserted by this comment.
 *
 * ⚠️ **Unset now means the published archive, not "no map"** (#534). #53
 * published one on 2026-09-14 and until #534 no build pointed at it, so every
 * map screen in the web build and the APK drew nothing. The default is
 * {@link PUBLISHED_BASEMAP_URL}, a committed constant rather than a committed
 * `.env.production`, because `.gitignore` ignores `.env.*` and nothing may be
 * forced past it. The environment still overrides it.
 *
 * **`undefined` is still an ordinary state, not an error** — it is what a build
 * gets when whoever made it set the variable to something that is not an
 * `https:` URL, `none` being the spelling to use on purpose. The map panel says
 * so in words rather than rendering an empty grey grid.
 */

import type { Theme } from '../design/tokens';

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

/**
 * The archive a build uses when nothing else is configured (#534).
 *
 * #53's published US extract: the Protomaps basemap build of 2026-09-14, copied
 * to storage this project controls (ADR 0010 D-1 — copied, never hotlinked).
 * Read off the archive's own header on 2026-09-25: PMTiles v3, zoom 0–15,
 * bounds −125° to −66° longitude and 24° to 50° latitude — the contiguous
 * United States — and 19 155 814 749 bytes. It answers range requests with
 * `access-control-allow-origin: *`, which is what lets the APK's origin and a
 * self-hosted web build read it.
 *
 * ⚠️ **Why a default at all, when the URL is configuration (#63 criterion 7).**
 * Without one, "no manual environment setup" (#534) cannot be met: `release.yml`
 * builds the APK with no environment of its own, and a committed
 * `.env.production` is a file `.gitignore` refuses. Configuration still wins —
 * {@link readBasemapConfig} consults this only when the variable is unset or
 * blank, so a self-hoster points `VITE_BASEMAP_PMTILES_URL` at their own copy,
 * and `none` builds a client with no map and no tile request at all.
 *
 * ⚠️ **Its host is disclosed, and a test says so.** This is the one host the
 * shipped app contacts without being asked to, so `docs/privacy-policy.md` and
 * `apps/mobile/src/android/data-safety.ts` both name it, and
 * `privacy/no-network.test.ts` §"the default basemap is disclosed" fails when
 * this origin moves and they do not.
 *
 * ⚠️ **This object must never be deleted or renamed while any shipped build
 * names it** (#535's review). The URL — dated object name and all — is baked
 * into every web bundle and every APK, and an installed APK does not update
 * itself when #53 publishes a newer build. Deleting it would take the map away
 * from every old client, and quietly: one request, two console errors, no
 * message to the rider. A newer build is published BESIDE this one under a new
 * name and this constant moves to it; the old object goes only when no build
 * still in use can name it. `docs/architecture.md`'s Basemap row says the same
 * where #53's archive is described.
 *
 * ⚠️ **Outside that box the map is a line on a plain background.** The archive
 * declares its bounds in its header, `pmtiles`' protocol hands them to
 * MapLibre as the source's `bounds`, and MapLibre asks for no tile outside
 * them — so a ride in London costs one header read and then nothing: no error,
 * no retry, no spinner. `map.browser.spec.ts` §"a ride outside the archive's
 * coverage" is the measurement.
 */
export const PUBLISHED_BASEMAP_URL = 'https://tiles.openzigs.com/basemap-us-20260914.pmtiles';

/** What `readBasemapConfig` reads. A parameter, so a test needs no bundler. */
export interface BasemapEnvironment {
  readonly VITE_BASEMAP_PMTILES_URL?: string | undefined;
}

/**
 * The configured basemap, or `undefined` when there is none.
 *
 * **Unset or blank is {@link PUBLISHED_BASEMAP_URL}** (#534). Blank counts as
 * unset because `.env.example` carries the variable with an empty value, and a
 * developer who copies the template as its own header says must not be handed
 * a build with no map for doing so.
 *
 * `undefined` for a value that is set and is not an `https:` URL — `none`, a
 * typo, a `http:` archive. ⚠️ **Deliberately NOT the default**: somebody who
 * set the variable meant a particular host, and quietly substituting ours
 * would send their riders' tile requests somewhere they did not choose. A
 * **non-`https:`** URL is refused because it would be blocked as mixed content
 * on any real deployment, and failing here says so at start-up rather than as
 * an empty map. The panel says "no basemap" in words either way; distinguishing
 * the causes in the UI would be reporting a build's configuration to somebody
 * who cannot change it.
 */
export function readBasemapConfig(environment: BasemapEnvironment): BasemapConfig | undefined {
  const configured = environment.VITE_BASEMAP_PMTILES_URL?.trim() ?? '';
  const raw = configured === '' ? PUBLISHED_BASEMAP_URL : configured;
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
  readonly minzoom?: number;
  readonly paint?: Readonly<Record<string, unknown>>;
  readonly layout?: Readonly<Record<string, unknown>>;
}

/** The id the ride's own trace is added under, so the adapter and the tests agree on one string. */
export const TRACK_SOURCE_ID = 'oyl-track';
export const TRACK_LAYER_ID = 'oyl-track-line';
/** The vector source the basemap tiles arrive on. */
export const BASEMAP_SOURCE_ID = 'basemap';

/**
 * Where the label glyphs are, relative to the page (#578).
 *
 * ⚠️ **Relative on purpose, and that is the whole privacy argument.** A
 * relative URL resolves against the document, so in a browser it is this
 * deployment's own origin and inside the Android shell it is the shell's own
 * `https://localhost` — the glyphs ship in the APK. {@link styleOrigins}
 * records no origin for it, so "the style reaches the archive and nothing
 * else" is still the assertion `basemap.test.ts` makes, unweakened. An absolute
 * URL built from `location` would have said the same thing with a second
 * origin in the set for every reader to reason about.
 *
 * `./` rather than `/`: a build served under a sub-path finds its own copy.
 * MapLibre fetches glyphs on the main thread, so it resolves against the page
 * and not against the worker's script. `{fontstack}` and `{range}` are
 * MapLibre's own tokens, and it substitutes the stack name without encoding
 * it — which is why {@link LABEL_FONT} has no space in it.
 */
export const GLYPHS_URL = './glyphs/{fontstack}/{range}.pbf';

/**
 * The one font stack the labels are set in: Roboto v2.138, Regular, the last
 * Apache-2.0 release. `tools/glyphs/font-source.ts` §`FONT_STACK` names the
 * directory the ranges are generated into, and `basemap.test.ts` holds the two
 * equal — a stack the style asks for that no directory holds is a 404 per
 * range, and MapLibre then draws the text in the device's own font instead,
 * silently.
 */
export const LABEL_FONT = 'Roboto-Regular';

/**
 * Every colour the map paints, in one table per palette (#672).
 *
 * ## Why a table of its own, and not the palette tokens
 *
 * The map is **cartography**, not interface: water is blue and roads are a
 * line lighter than the land in every palette, and neither is a role
 * `design/tokens.ts` has or should grow. So the colours are declared here, per
 * palette, and **checked against** the palette rather than derived from it —
 * `map-colours.a11y.test.ts` holds three things:
 *
 * 1. **The map sits on the page it is in.** The background and the land fill
 *    are each within one elevation step (`tokens.ts`
 *    §`MAXIMUM_ELEVATION_STEP`) of that palette's `canvas`, and on the side
 *    of it `tokens.ts` §`ELEVATION_DIRECTION` names — darker in the light
 *    palette, lighter in the dark. A light map under a dark page, which is
 *    what #672 found here, is 12 : 1 away from its canvas.
 * 2. **Every pair in {@link MAP_CONTRAST_REQUIREMENTS} measures what was
 *    recorded**, in both directions, per palette — #307's erosion gate, the
 *    shape `CONTRAST_REQUIREMENTS` has since #744.
 * 3. The existing #578 check, that the label ink clears AA text contrast
 *    against every colour the style can put behind a label, now run over
 *    both styles.
 *
 * Deriving the map from the tokens was the alternative and it was rejected:
 * the light map's `#f5f3ef` is not `canvas` (`#ffffff`) and was never meant to
 * be — the map is a warm surface ON the page — and making it one would repaint
 * every light map to satisfy a rule the dark one needed.
 *
 * ⚠️ **Six-digit hex only**, so `design/contrast.ts` can read every value. And
 * no pure black or white in the dark table, `DARK_COLOUR_TOKENS`' rule.
 */
export interface MapColours {
  /** The `background` layer: what shows with no tile, and with tiles off. */
  readonly background: string;
  /** The land fill, which covers most of a map that has tiles. */
  readonly earth: string;
  readonly water: string;
  /** Roads, as a line one step from the land. */
  readonly road: string;
  /** The labels' ink (#578). */
  readonly labelInk: string;
  /** The halo round a label: a lift, not what its contrast rests on. */
  readonly labelHalo: string;
  /** The ride's own line, which `maplibre.ts` draws over everything else. */
  readonly track: string;
}

/**
 * The two tables. The light one is the map as it was before #672, colour for
 * colour; the dark one is new. Exported so the browser harness can look for
 * each on the drawing buffer without a second copy of any of them.
 */
export const MAP_COLOURS: Readonly<Record<Theme, MapColours>> = {
  light: {
    background: '#f5f3ef',
    earth: '#eeece7',
    water: '#b9d4e8',
    road: '#ffffff',
    labelInk: '#3a3731',
    labelHalo: '#ffffff',
    track: '#b5341f',
  },
  dark: {
    background: '#151b19',
    earth: '#1c2321',
    water: '#1a3242',
    road: '#3a4543',
    labelInk: '#d3dbd8',
    labelHalo: '#101614',
    // The light palette's `#b5341f` is 2.65 : 1 on the dark land (2.20 over
    // the water, 2.89 on the background, 1.65 on a road), under SC 1.4.11's
    // 3 : 1 for a graphic a rider needs on every one of them; this is 5.75.
    track: '#f0785c',
  },
};

/** One pair of map colours that end up against each other. `tokens.ts` §`ContrastRequirement`'s shape. */
export interface MapContrastRequirement {
  readonly foreground: keyof MapColours;
  readonly background: keyof MapColours;
  /** `AA_TEXT` or `AA_LARGE_TEXT_OR_NON_TEXT`, from `design/contrast.ts`. */
  readonly minimum: number;
  /** What it measures in each palette, to two places: below is erosion, above is unrecorded. */
  readonly measured: Readonly<Record<Theme, number>>;
  readonly where: string;
}

/**
 * The pairs the map places together, per palette (#672).
 *
 * The label ink on its halo is the pair #672 names; the ink on each layer it
 * can sit over is #578's check made an erosion gate; and the ride's line on
 * each fill is SC 1.4.11, which nothing here checked before the dark map made
 * the light line unreadable. The line on a road is 3.57 in the dark map and is
 * recorded because a ride follows roads.
 */
export const MAP_CONTRAST_REQUIREMENTS: readonly MapContrastRequirement[] = [
  {
    foreground: 'labelInk',
    background: 'labelHalo',
    minimum: 4.5,
    measured: { light: 11.86, dark: 12.99 },
    where: 'a label on its own halo',
  },
  {
    foreground: 'labelInk',
    background: 'background',
    minimum: 4.5,
    measured: { light: 10.7, dark: 12.38 },
    where: 'a label with no tile under it',
  },
  {
    foreground: 'labelInk',
    background: 'earth',
    minimum: 4.5,
    measured: { light: 10.05, dark: 11.35 },
    where: 'a label on land',
  },
  {
    foreground: 'labelInk',
    background: 'water',
    minimum: 4.5,
    measured: { light: 7.71, dark: 9.43 },
    where: 'a label on water',
  },
  {
    foreground: 'labelInk',
    background: 'road',
    minimum: 4.5,
    measured: { light: 11.86, dark: 7.05 },
    where: 'a road name on its road',
  },
  {
    foreground: 'track',
    background: 'background',
    minimum: 3,
    measured: { light: 5.45, dark: 6.27 },
    where: 'the ride’s line with no tile under it (SC 1.4.11)',
  },
  {
    foreground: 'track',
    background: 'earth',
    minimum: 3,
    measured: { light: 5.12, dark: 5.75 },
    where: 'the ride’s line on land (SC 1.4.11)',
  },
  {
    foreground: 'track',
    background: 'water',
    minimum: 3,
    measured: { light: 3.93, dark: 4.78 },
    where: 'the ride’s line over water (SC 1.4.11)',
  },
  {
    foreground: 'track',
    background: 'road',
    minimum: 3,
    measured: { light: 6.04, dark: 3.57 },
    where: 'the ride’s line along a road (SC 1.4.11)',
  },
];

/** One paint for both label layers, so the contrast check covers both by covering one. */
function labelPaint(colours: MapColours): Readonly<Record<string, unknown>> {
  return {
    'text-color': colours.labelInk,
    'text-halo-color': colours.labelHalo,
    'text-halo-width': 1.5,
  };
}

/** The layer that needs no tile, and so the whole of a style with tiles turned off. */
function backgroundLayer(colours: MapColours): BasemapLayer {
  return {
    id: 'background',
    type: 'background',
    paint: { 'background-color': colours.background },
  };
}

/** What {@link basemapStyle} is asked for besides the configuration. */
export interface BasemapStyleOptions {
  /** `false` is the rider's Settings switch turned off (`tiles-preference.ts`). */
  readonly tiles?: boolean;
  /** The palette the page is in (#672). Light when not given. */
  readonly theme?: Theme;
}

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
 * `glyphs` is {@link GLYPHS_URL}, relative, so the labels cost no origin (see
 * the module note), and there is still no `sprite`. The two label layers read
 * the Protomaps schema's `places` and `roads` layers by their `name` property.
 *
 * ⚠️ **`tiles: false` is a style with no source at all** — the background
 * layer and nothing else, and no `glyphs` either, because there is nothing to
 * label — and that is what the rider's Settings switch
 * (`tiles-preference.ts`, the owner's decision of 2026-09-25) turns into. Not
 * a source with its layers hidden: a declared source is a URL MapLibre may
 * fetch, and "off" has to mean the tile host is contacted by nothing.
 * {@link styleOrigins} over this style is empty, which `basemap.test.ts`
 * asserts, and `map.browser.spec.ts` intercepts the network to say the same
 * of a real engine. The ride's own line is added by the adapter, not by this
 * style, so it is drawn either way.
 *
 * **`theme` picks the colours and nothing else** (#672). The dark style is
 * this same function over {@link MAP_COLOURS}' dark table — built, never
 * fetched — so it has exactly the light style's sources, layers and `glyphs`,
 * and {@link styleOrigins} reports the same one origin for both, which
 * `basemap.test.ts` asserts for both with tiles on and off.
 */
export function basemapStyle(
  config: BasemapConfig,
  options: BasemapStyleOptions = {},
): BasemapStyle {
  const colours = MAP_COLOURS[options.theme ?? 'light'];
  if (options.tiles === false) {
    return { version: 8, sources: {}, layers: [backgroundLayer(colours)] };
  }
  return {
    version: 8,
    glyphs: GLYPHS_URL,
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
      backgroundLayer(colours),
      {
        id: 'earth',
        type: 'fill',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'earth',
        paint: { 'fill-color': colours.earth },
      },
      {
        id: 'water',
        type: 'fill',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'water',
        paint: { 'fill-color': colours.water },
      },
      {
        id: 'roads',
        type: 'line',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'roads',
        paint: { 'line-color': colours.road, 'line-width': 1 },
      },
      {
        // Road names only from zoom 13, where a street is long enough on
        // screen to carry one; below that they are clutter along lines too
        // short to read them on. A ride's map is fitted to the ride, so a
        // short ride gets street names and a long one gets place names only,
        // which is the right way round at each scale.
        id: 'road-names',
        type: 'symbol',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'roads',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': [LABEL_FONT],
          'text-size': 12,
        },
        paint: labelPaint(colours),
      },
      {
        // Above the road names, so where the two collide the place wins.
        id: 'places',
        type: 'symbol',
        source: BASEMAP_SOURCE_ID,
        'source-layer': 'places',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': [LABEL_FONT],
          // 12 px at a region's zoom up to 15 px at a street's. 12 is the
          // smallest size any text in this client is set at.
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 16, 15],
          'text-max-width': 8,
        },
        paint: labelPaint(colours),
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
