// SPDX-License-Identifier: AGPL-3.0-or-later

/** The planner's height port and its loader — #2013. */

import { metres, RoutingError, type HeightProfile } from '@onyourleft/domain';
import { describe, expect, it, vi } from 'vitest';

import { PUBLISHED_TERRAIN_URL, readTerrainConfig } from './config';
import {
  ELEVATION_NOT_DOWNLOADED_TEXT,
  ELEVATION_NOT_READABLE_TEXT,
  elevationFailureText,
  ELEVATION_TILES_OFF_TEXT,
  lazyRouteHeights,
  TERRAIN_SAMPLE_INTERVAL_METRES,
  type RouteHeights,
} from './heights';

const CONFIG = { archiveUrl: 'https://tiles.example.org/terrain.pmtiles' };
const ANSWER: HeightProfile = { source: { name: 'fixture', resolution: metres(15) }, samples: [] };
const REQUEST = { shape: [], interval: metres(TERRAIN_SAMPLE_INTERVAL_METRES) };

function reader(): RouteHeights & { asked: number } {
  const double = {
    asked: 0,
    interval: metres(TERRAIN_SAMPLE_INTERVAL_METRES),
    heights: () => {
      double.asked += 1;
      return Promise.resolve(ANSWER);
    },
  };
  return double;
}

describe('lazyRouteHeights', () => {
  it('states its sampling interval before anything is loaded', () => {
    const load = vi.fn(() => Promise.resolve(reader()));
    expect(lazyRouteHeights({ config: CONFIG, mapTilesOn: () => true }, load).interval).toBe(15);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the reader on the first request and once only', async () => {
    const loaded = reader();
    const load = vi.fn(() => Promise.resolve(loaded));
    const heights = lazyRouteHeights({ config: CONFIG, mapTilesOn: () => true }, load);
    expect(await heights.heights(REQUEST)).toBe(ANSWER);
    expect(await heights.heights(REQUEST)).toBe(ANSWER);
    expect(load).toHaveBeenCalledTimes(1);
    expect(loaded.asked).toBe(2);
  });

  it('loads the product’s own reader when no loader is handed in', async () => {
    // The real `import()`s. A line with no point asks the archive for nothing.
    const heights = lazyRouteHeights({ config: CONFIG, mapTilesOn: () => true });
    const answer = await heights.heights(REQUEST);
    expect(answer.samples).toStrictEqual([]);
    expect(answer.source.name).toBe('Mapterhorn terrain');
  });

  it('with map tiles off loads nothing, asks nothing and says why', async () => {
    const loaded = reader();
    const load = vi.fn(() => Promise.resolve(loaded));
    const heights = lazyRouteHeights({ config: CONFIG, mapTilesOn: () => false }, load);
    const refused = await heights.heights(REQUEST).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RoutingError);
    expect((refused as RoutingError).code).toBe('unavailable');
    expect((refused as RoutingError).message).toBe(ELEVATION_TILES_OFF_TEXT);
    expect(load).not.toHaveBeenCalled();
    expect(loaded.asked).toBe(0);
  });

  it('reads the map-tiles choice at each request, not once', async () => {
    let on = false;
    const loaded = reader();
    const heights = lazyRouteHeights({ config: CONFIG, mapTilesOn: () => on }, () =>
      Promise.resolve(loaded),
    );
    await heights.heights(REQUEST).catch(() => undefined);
    on = true;
    expect(await heights.heights(REQUEST)).toBe(ANSWER);
    on = false;
    await expect(heights.heights(REQUEST)).rejects.toThrow(ELEVATION_TILES_OFF_TEXT);
    expect(loaded.asked).toBe(1);
  });

  it('says elevation is unavailable when the reader cannot be loaded, and tries again next time', async () => {
    const loaded = reader();
    const load = vi
      .fn<() => Promise<RouteHeights>>()
      .mockRejectedValueOnce(new Error('chunk not fetched'))
      .mockResolvedValue(loaded);
    const heights = lazyRouteHeights({ config: CONFIG, mapTilesOn: () => true }, load);
    const failed = await heights.heights(REQUEST).catch((e: unknown) => e);
    expect((failed as RoutingError).code).toBe('unavailable');
    expect((failed as RoutingError).message).toBe(
      "This copy of the app can't read the elevation data. The route is saved flat.",
    );
    expect(await heights.heights(REQUEST)).toBe(ANSWER);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('passes the reader’s own failure through unchanged', async () => {
    const failure = new RoutingError('unavailable', 'the archive could not be reached');
    const heights = lazyRouteHeights({ config: CONFIG, mapTilesOn: () => true }, () =>
      Promise.resolve({
        interval: metres(15),
        heights: () => Promise.reject(failure),
      }),
    );
    await expect(heights.heights(REQUEST)).rejects.toBe(failure);
  });
});

describe('what the rider is told when the terrain cannot be read', () => {
  it('is the owner’s two sentences, word for word', () => {
    expect(ELEVATION_NOT_DOWNLOADED_TEXT).toBe(
      "Elevation couldn't be downloaded right now. The route is saved flat; try again later.",
    );
    expect(ELEVATION_NOT_READABLE_TEXT).toBe(
      "This copy of the app can't read the elevation data. The route is saved flat.",
    );
  });

  it('says it could not be downloaded for every network, HTTP, range, size or changed-file failure', () => {
    for (const failure of [
      { kind: 'aborted' },
      { kind: 'network' },
      { kind: 'http', status: 503 },
      { kind: 'not-a-range' },
      { kind: 'changed' },
      { kind: 'too-large', limit: 4_194_304 },
    ] as const) {
      expect(elevationFailureText(failure)).toBe(ELEVATION_NOT_DOWNLOADED_TEXT);
    }
  });

  it('says this copy cannot read it for an archive of the wrong kind or compression', () => {
    expect(elevationFailureText({ kind: 'wrong-archive' })).toBe(ELEVATION_NOT_READABLE_TEXT);
    expect(elevationFailureText({ kind: 'compression' })).toBe(ELEVATION_NOT_READABLE_TEXT);
  });
});

describe('readTerrainConfig', () => {
  it('is the published archive when unset or blank', () => {
    expect(readTerrainConfig({})).toStrictEqual({ archiveUrl: PUBLISHED_TERRAIN_URL });
    expect(readTerrainConfig({ VITE_TERRAIN_PMTILES_URL: '  ' })).toStrictEqual({
      archiveUrl: PUBLISHED_TERRAIN_URL,
    });
  });

  it('is a self-hoster’s own archive when one is set', () => {
    expect(
      readTerrainConfig({ VITE_TERRAIN_PMTILES_URL: 'https://tiles.example.org/t.pmtiles' }),
    ).toStrictEqual({ archiveUrl: 'https://tiles.example.org/t.pmtiles' });
  });

  it('is no archive, never the default, for none, a typo or a plain http address', () => {
    for (const value of ['none', 'tiles.example.org/t.pmtiles', 'http://tiles.example.org/t']) {
      expect(readTerrainConfig({ VITE_TERRAIN_PMTILES_URL: value })).toBeUndefined();
    }
  });

  it('is no archive for a build with no basemap, whose Settings has no switch to turn it off', () => {
    expect(readTerrainConfig({ VITE_BASEMAP_PMTILES_URL: 'none' })).toBeUndefined();
    expect(
      readTerrainConfig({
        VITE_BASEMAP_PMTILES_URL: 'none',
        VITE_TERRAIN_PMTILES_URL: 'https://tiles.example.org/t.pmtiles',
      }),
    ).toBeUndefined();
    // A self-hoster's own basemap keeps the terrain.
    expect(
      readTerrainConfig({ VITE_BASEMAP_PMTILES_URL: 'https://tiles.example.org/b.pmtiles' }),
    ).toStrictEqual({ archiveUrl: PUBLISHED_TERRAIN_URL });
  });

  it('publishes its default on the host the basemap is on, as a dated object', () => {
    const url = new URL(PUBLISHED_TERRAIN_URL);
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toMatch(/^\/terrain-us-mapterhorn-\d{8}\.pmtiles$/);
  });
});
