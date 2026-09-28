// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #63's third and seventh acceptance criteria.
 *
 * - **Criterion 3** — *"Zero requests go to any metered tile API… fails if any
 *   request host is outside the configured basemap origin."* Asserted on the
 *   style rather than on intercepted traffic, and that is the stronger place:
 *   traffic can only be observed for a map that actually renders, and the
 *   failure being guarded against is a URL sitting in a style that a *future*
 *   render would fetch. `styleOrigins` sees it whether or not anything runs.
 * - **Criterion 7** — the basemap URL is configuration, and the map renders
 *   against a second archive URL with no code change.
 * - **#534** — and when nothing is configured, a build draws the archive #53
 *   published rather than nothing, with the origin guard still holding.
 * - **#578** — labels, from glyphs the app ships, at a relative URL that adds
 *   no origin to the set the guard above checks.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FONT_STACK, GLYPH_RANGE_STARTS, rangeName } from '../../tools/glyphs/font-source';
import { THEMES } from '../design/tokens';

import {
  BASEMAP_SOURCE_ID,
  GLYPHS_URL,
  LABEL_FONT,
  MAP_COLOURS,
  basemapOrigin,
  basemapStyle,
  browserBasemapConfig,
  OSM_ATTRIBUTION,
  PUBLISHED_BASEMAP_URL,
  readBasemapConfig,
  styleOrigins,
  type BasemapStyle,
  type MapColours,
} from './basemap';

const ARCHIVE = 'https://tiles.example.org/basemap.pmtiles';
const OTHER = 'https://tiles.example.net/planet.pmtiles';

describe('readBasemapConfig — the URL is configuration', () => {
  it('reads a configured archive', () => {
    const config = readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: ARCHIVE });
    expect(config?.archiveUrl).toBe(ARCHIVE);
    expect(config?.attribution).toBe(OSM_ATTRIBUTION);
  });

  it('is the archive #53 published when nothing is configured — #534', () => {
    // Every build made with no environment, the APK's among them. Blank counts
    // as unset because `.env.example` carries the variable empty, and copying
    // the template must not cost a developer the map.
    for (const unset of [{}, { VITE_BASEMAP_PMTILES_URL: '' }, { VITE_BASEMAP_PMTILES_URL: ' ' }]) {
      const config = readBasemapConfig(unset);
      expect(config?.archiveUrl).toBe(PUBLISHED_BASEMAP_URL);
      expect(config?.attribution).toBe(OSM_ATTRIBUTION);
    }
  });

  it('defaults to exactly the published object, on our own host', () => {
    // Pinned as a literal: a default that drifted to a different object, or to
    // somebody else's host (ADR 0010 D-1 forbids hotlinking), is a change a
    // reviewer must see in this file as well as in the constant.
    expect(PUBLISHED_BASEMAP_URL).toBe('https://tiles.openzigs.com/basemap-us-20260914.pmtiles');
  });

  it('lets the environment override the default', () => {
    expect(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: OTHER })?.archiveUrl).toBe(OTHER);
  });

  it('is undefined for something that is not a URL, rather than throwing at start-up', () => {
    expect(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: 'not a url' })).toBeUndefined();
  });

  it('builds with no map when told `none`, and never falls back to ours', () => {
    // A value somebody SET names the host they meant. Substituting ours for a
    // typo would send their riders' tile requests to a host they did not pick.
    expect(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: 'none' })).toBeUndefined();
  });

  it('refuses a plain-http archive', () => {
    // Mixed content: an `https:` page cannot fetch it, so the map would render
    // as an empty grid with a console error the rider never sees. Refusing here
    // turns that into "no basemap configured", which the panel explains.
    expect(
      readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: 'http://tiles.example.org/a.pmtiles' }),
    ).toBeUndefined();
  });

  it('trims surrounding whitespace, which a copied-and-pasted value carries', () => {
    expect(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: `  ${ARCHIVE}  ` })?.archiveUrl).toBe(
      ARCHIVE,
    );
  });
});

describe('browserBasemapConfig — what a build actually ships', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('draws the published archive from a build with no environment at all — #534', () => {
    // The real bundler read, not the pure function: this is the path `main.tsx`
    // hands the map, and it is the one a `release.yml` build takes.
    vi.stubEnv('VITE_BASEMAP_PMTILES_URL', '');
    expect(browserBasemapConfig()?.archiveUrl).toBe(PUBLISHED_BASEMAP_URL);
  });

  it('still takes the environment over the default', () => {
    vi.stubEnv('VITE_BASEMAP_PMTILES_URL', OTHER);
    expect(browserBasemapConfig()?.archiveUrl).toBe(OTHER);
  });
});

describe('basemapStyle — built here, never fetched', () => {
  it('points the vector source at the configured archive through the pmtiles selector', () => {
    // The `pmtiles://` form is what auto-derives the source's zoom range from
    // the archive header rather than making us guess it.
    const style = basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION });
    expect(style.sources[BASEMAP_SOURCE_ID]?.url).toBe(`pmtiles://${ARCHIVE}`);
  });

  it('carries the OpenStreetMap attribution on the source', () => {
    const style = basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION });
    expect(style.sources[BASEMAP_SOURCE_ID]?.attribution).toBe('© OpenStreetMap contributors');
  });

  it('takes its glyphs from the page’s own origin, and still declares no sprite — #578', () => {
    // Relative, so it resolves against this deployment; and therefore no new
    // origin in the set criterion 3 checks. An absolute third-party glyphs URL
    // is what `styleOrigins` catches below — this is what it lets through.
    const style = basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION });
    expect(style.glyphs).toBe(GLYPHS_URL);
    expect(GLYPHS_URL.startsWith('./')).toBe(true);
    expect(styleOrigins(style)).toEqual(['https://tiles.example.org']);
    expect(style.sprite).toBeUndefined();
  });

  it('labels places and road names by their name, in the one font it ships — #578', () => {
    const style = basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION });
    const symbols = style.layers.filter((layer) => layer.type === 'symbol');
    expect(symbols.map((layer) => [layer.id, layer['source-layer']])).toEqual([
      ['road-names', 'roads'],
      ['places', 'places'],
    ]);
    for (const layer of symbols) {
      expect(layer.source, layer.id).toBe(BASEMAP_SOURCE_ID);
      expect(layer.layout?.['text-field'], layer.id).toEqual(['get', 'name']);
      expect(layer.layout?.['text-font'], layer.id).toEqual([LABEL_FONT]);
      // No icon: a sprite would be a second asset set to ship and credit.
      expect(layer.layout?.['icon-image'], layer.id).toBeUndefined();
    }
  });

  it('asks for a font stack the app actually ships, in every range it generates — #578', () => {
    // MapLibre substitutes the stack name into the URL; a name no directory
    // holds 404s every range and the text falls back to the device's own
    // font without a word. The generator's directory and the style's name are
    // two spellings of one thing, so they are held equal here.
    expect(LABEL_FONT).toBe(FONT_STACK);
    for (const start of GLYPH_RANGE_STARTS) {
      const path = GLYPHS_URL.replace('{fontstack}', LABEL_FONT).replace(
        '{range}',
        rangeName(start),
      );
      const file = fileURLToPath(new URL(path.replace('./', '../../public/'), import.meta.url));
      expect(existsSync(file), path).toBe(true);
    }
  });

  it('renders against a second archive with no code change — criterion 7', () => {
    const first = basemapStyle(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: ARCHIVE }) as never);
    const second = basemapStyle(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: OTHER }) as never);
    expect(styleOrigins(first)).toEqual(['https://tiles.example.org']);
    expect(styleOrigins(second)).toEqual(['https://tiles.example.net']);
    // And nothing but the URL moved: the layer list is the same style either way.
    expect(second.layers).toEqual(first.layers);
  });
});

describe('basemapStyle with map tiles turned off — the owner’s decision of 2026-09-25', () => {
  it('declares no source at all, so there is no URL for MapLibre to ask for', () => {
    const style = basemapStyle(
      { archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION },
      { tiles: false },
    );
    expect(style.sources).toEqual({});
    expect(styleOrigins(style)).toEqual([]);
    // And nothing to label, so no glyphs URL for anything to fetch.
    expect(style.glyphs).toBeUndefined();
  });

  it('keeps the background, so the ride’s line is drawn on something', () => {
    const style = basemapStyle(
      { archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION },
      { tiles: false },
    );
    expect(style.layers.map((layer) => layer.id)).toEqual(['background']);
    expect(style.layers.every((layer) => layer.source === undefined)).toBe(true);
  });

  it('is the full style when tiles are on, or when nobody said', () => {
    const config = { archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION };
    expect(basemapStyle(config, { tiles: true })).toEqual(basemapStyle(config));
    expect(styleOrigins(basemapStyle(config))).toEqual(['https://tiles.example.org']);
  });
});

describe('styleOrigins — criterion 3, the $950/month guard', () => {
  it('reaches only the published archive’s origin with the default in force — #534', () => {
    const config = readBasemapConfig({});
    expect(config).toBeDefined();
    if (config === undefined) {
      return;
    }
    expect(styleOrigins(basemapStyle(config))).toEqual(['https://tiles.openzigs.com']);
  });

  it('reaches exactly the configured origin and nothing else', () => {
    const config = { archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION };
    expect(styleOrigins(basemapStyle(config))).toEqual([basemapOrigin(config)]);
  });

  it('sees through the pmtiles protocol selector to the real host', () => {
    // The trap: `new URL('pmtiles://https://evil.example/x').origin` is `null`,
    // so a naive check would read a third-party archive as "no origin" and pass.
    const style: BasemapStyle = {
      version: 8,
      sources: { a: { type: 'vector', url: 'pmtiles://https://metered.example.com/x.pmtiles' } },
      layers: [],
    };
    expect(styleOrigins(style)).toEqual(['https://metered.example.com']);
  });

  it('catches a glyphs URL, which is the one a copied example carries', () => {
    const style: BasemapStyle = {
      ...basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION }),
      glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    };
    expect(styleOrigins(style)).toContain('https://protomaps.github.io');
  });

  it('catches a sprite URL too', () => {
    const style: BasemapStyle = {
      ...basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION }),
      sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    };
    expect(styleOrigins(style)).toContain('https://protomaps.github.io');
  });

  it('walks keys it has never heard of, which is the point of walking', () => {
    // The failure this guards is a *new* style key — a terrain source, a sky
    // texture, a raster overlay — carrying a host nobody thought to check.
    const style = {
      ...basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION }),
      terrain: { source: 'https://api.mapbox.com/v4/terrain.json' },
    } as unknown as BasemapStyle;
    expect(styleOrigins(style)).toContain('https://api.mapbox.com');
  });

  it('records no origin for a relative URL, which resolves against our own page', () => {
    const style: BasemapStyle = {
      version: 8,
      sources: { a: { type: 'vector', url: '/tiles/basemap.pmtiles' } },
      layers: [],
    };
    expect(styleOrigins(style)).toEqual([]);
  });

  it('records no origin for a string that merely looks like one', () => {
    const style: BasemapStyle = {
      version: 8,
      sources: {},
      layers: [{ id: 'x', type: 'background', paint: { 'background-color': '#https://no' } }],
    };
    expect(styleOrigins(style)).toEqual([]);
  });
});

/** A style with every colour in every paint replaced by one word, so two palettes' structures compare. */
function withoutColours(style: BasemapStyle): BasemapStyle {
  return {
    ...style,
    layers: style.layers.map((layer) =>
      layer.paint === undefined
        ? layer
        : {
            ...layer,
            paint: Object.fromEntries(
              Object.entries(layer.paint).map(([key, value]) => [
                key,
                key.endsWith('-color') ? 'colour' : value,
              ]),
            ),
          },
    ),
  };
}

/** Every colour any paint in the style names. */
function coloursOf(style: BasemapStyle): string[] {
  return style.layers.flatMap((layer) =>
    Object.entries(layer.paint ?? {})
      .filter(([key]) => key.endsWith('-color'))
      .map(([, value]) => String(value)),
  );
}

describe('the dark style — built the same way, never fetched (#672)', () => {
  const config = { archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION };

  it.each([true, false])(
    'differs from the light style in colour and nothing else, with tiles %s',
    (tiles) => {
      const light = basemapStyle(config, { tiles, theme: 'light' });
      const dark = basemapStyle(config, { tiles, theme: 'dark' });
      expect(withoutColours(dark)).toEqual(withoutColours(light));
      expect(styleOrigins(dark)).toEqual(styleOrigins(light));
      // And the colours really are different — a `theme` the builder ignored
      // would pass the line above.
      expect(coloursOf(dark)).not.toEqual(coloursOf(light));
    },
  );

  it('reaches the configured archive and nothing else, exactly as the light one does', () => {
    expect(styleOrigins(basemapStyle(config, { theme: 'dark' }))).toEqual([
      'https://tiles.example.org',
    ]);
    expect(styleOrigins(basemapStyle(config, { tiles: false, theme: 'dark' }))).toEqual([]);
  });

  it('is light when nobody says', () => {
    expect(basemapStyle(config)).toEqual(basemapStyle(config, { theme: 'light' }));
  });

  it.each(THEMES)('paints only colours the %s table declares — no loose literal', (theme) => {
    const table = MAP_COLOURS[theme];
    const declared = new Set<string>(
      (Object.keys(table) as (keyof MapColours)[]).map((key) => table[key]),
    );
    for (const tiles of [true, false]) {
      for (const colour of coloursOf(basemapStyle(config, { tiles, theme }))) {
        expect(declared, `${theme}: ${colour} is painted and declared nowhere`).toContain(colour);
      }
    }
  });
});
