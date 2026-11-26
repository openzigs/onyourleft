// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { PUBLISHED_BASEMAP_URL } from '../map/basemap';

import { PUBLISHED_ROUTING_GRAPH_URL, readRoutingGraphConfig } from './browser-graph';

describe('where the in-browser routing graph is (#2734)', () => {
  it('is the published graph for a build on the published basemap', () => {
    expect(readRoutingGraphConfig({})).toStrictEqual({ manifestUrl: PUBLISHED_ROUTING_GRAPH_URL });
    expect(readRoutingGraphConfig({ VITE_ROUTING_GRAPH_MANIFEST_URL: '  ' })).toStrictEqual({
      manifestUrl: PUBLISHED_ROUTING_GRAPH_URL,
    });
  });

  it('is the configured https URL when one is set', () => {
    expect(
      readRoutingGraphConfig({
        VITE_ROUTING_GRAPH_MANIFEST_URL: 'https://example.org/routing/r1/manifest.json',
      }),
    ).toStrictEqual({ manifestUrl: 'https://example.org/routing/r1/manifest.json' });
  });

  it('is none for none, for anything that is not https, and for a build with no basemap', () => {
    expect(readRoutingGraphConfig({ VITE_ROUTING_GRAPH_MANIFEST_URL: 'none' })).toBeUndefined();
    expect(
      readRoutingGraphConfig({ VITE_ROUTING_GRAPH_MANIFEST_URL: 'http://example.org/m.json' }),
    ).toBeUndefined();
    expect(readRoutingGraphConfig({ VITE_BASEMAP_PMTILES_URL: 'none' })).toBeUndefined();
  });

  it('asks this project’s host nothing for a self-hosted basemap unless the graph is named too', () => {
    const own = 'https://maps.example.org/basemap.pmtiles';
    expect(readRoutingGraphConfig({ VITE_BASEMAP_PMTILES_URL: own })).toBeUndefined();
    expect(
      readRoutingGraphConfig({
        VITE_BASEMAP_PMTILES_URL: own,
        VITE_ROUTING_GRAPH_MANIFEST_URL: 'https://maps.example.org/routing/r1/manifest.json',
      }),
    ).toStrictEqual({ manifestUrl: 'https://maps.example.org/routing/r1/manifest.json' });
  });

  it('names a release directory on the basemap’s host', () => {
    expect(new URL(PUBLISHED_ROUTING_GRAPH_URL).host).toBe(new URL(PUBLISHED_BASEMAP_URL).host);
    expect(PUBLISHED_ROUTING_GRAPH_URL).toMatch(
      /\/routing\/oyl-bicycle-[0-9a-f]{12}\/manifest\.json$/,
    );
  });
});
