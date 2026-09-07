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
 */

import { describe, expect, it } from 'vitest';

import {
  BASEMAP_SOURCE_ID,
  basemapOrigin,
  basemapStyle,
  OSM_ATTRIBUTION,
  readBasemapConfig,
  styleOrigins,
  type BasemapStyle,
} from './basemap';

const ARCHIVE = 'https://tiles.example.org/basemap.pmtiles';
const OTHER = 'https://tiles.example.net/planet.pmtiles';

describe('readBasemapConfig — the URL is configuration', () => {
  it('reads a configured archive', () => {
    const config = readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: ARCHIVE });
    expect(config?.archiveUrl).toBe(ARCHIVE);
    expect(config?.attribution).toBe(OSM_ATTRIBUTION);
  });

  it('is undefined when nothing is configured, which is the state of every build today', () => {
    // #53 has not published an archive. This is the normal case, not an error —
    // and it is what makes "no basemap" a state the panel has to render rather
    // than a branch nobody exercises.
    expect(readBasemapConfig({})).toBeUndefined();
    expect(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: '' })).toBeUndefined();
    expect(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: '   ' })).toBeUndefined();
  });

  it('is undefined for something that is not a URL, rather than throwing at start-up', () => {
    expect(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: 'not a url' })).toBeUndefined();
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

  it('declares no glyphs and no sprite, because both would be a third-party origin today', () => {
    // The map renders without labels until #53 publishes font and sprite assets
    // on the basemap's own origin. A labelled map that phones home is worse.
    const style = basemapStyle({ archiveUrl: ARCHIVE, attribution: OSM_ATTRIBUTION });
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
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

describe('styleOrigins — criterion 3, the $950/month guard', () => {
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
