// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A drawn route's heights with no instance and no routing engine — #2013.
 *
 * The planner asks {@link RouteHeights} for the heights along a line, exactly
 * as it asks a routing engine's `heights` (`@onyourleft/domain`
 * §`RoutingProvider`), and gets the same answer shape back, so the profile,
 * the climbing figure and the coverage report are `routing/elevation.ts`'s,
 * unchanged. What answers is the project's own terrain archive, read in the
 * app (`terrain/route-heights.ts`).
 *
 * This file is the light half: the port, its words, and a loader. The reader,
 * `pmtiles` and the decoder are behind {@link lazyRouteHeights}'s `import()`,
 * so they are not in the entry chunk.
 */

import {
  metres,
  RoutingError,
  type HeightProfile,
  type HeightRequest,
  type Metres,
  type RoadSpan,
} from '@onyourleft/domain';

import type { TerrainConfig } from './config';
import type { TerrainFailure } from './terrain-source';

/**
 * The distance between height samples along a drawn route: **15 metres**.
 *
 * Matched to the source, as `routing/elevation.ts` §`ELEVATION_INTERVAL_METRES`
 * is matched to its own: a z12 pixel of the archive covers 12.3 m of ground at
 * 50° N and 17.5 m at 24° N. Closer than that samples the same pixels twice;
 * further apart throws heights away.
 */
export const TERRAIN_SAMPLE_INTERVAL_METRES = 15;

/** What the dataset is called on a route that stores heights from it (`RouteRecord.elevation`). */
export const TERRAIN_DATASET_NAME = 'Mapterhorn terrain';

/** A height request that may also say where the line is on a bridge or in a tunnel. */
export interface TerrainHeightRequest extends HeightRequest {
  /**
   * The stretches of the line on a bridge or in a tunnel, where the caller
   * knows them. The road's height across each is linear between the ground
   * either side (`@onyourleft/domain` §`heightsAcrossSpans`, ADR 0087 D-4.3).
   * A drawn freehand line follows no mapped road, so the planner has none.
   */
  readonly spans?: readonly RoadSpan[] | undefined;
}

/** Heights along a line, from the terrain archive. */
export interface RouteHeights {
  /** The spacing this source is sampled at. */
  readonly interval: Metres;
  /**
   * @throws {RoutingError} `'unavailable'` when the archive could not be read
   * or map tiles are off, and nothing else.
   */
  heights(request: TerrainHeightRequest): Promise<HeightProfile>;
}

/** What follows the map-tiles-off sentence: the route is not lost. */
export const ROUTE_STILL_SAVES_TEXT = 'The route can still be saved, and is saved flat.';

/** Said when map tiles are off (ADR 0054 D-6.4: one switch for everything the tile host is asked). */
export const ELEVATION_TILES_OFF_TEXT = `Elevation is unavailable while map tiles are turned off in Settings. ${ROUTE_STILL_SAVES_TEXT}`;

/**
 * Said when the archive could not be downloaded: offline, an HTTP error, a
 * host that did not answer with the range, a part over the size limit, or a
 * file that changed while it was read. The owner's wording of 2026-11-24.
 */
export const ELEVATION_NOT_DOWNLOADED_TEXT =
  "Elevation couldn't be downloaded right now. The route is saved flat; try again later.";

/**
 * Said when this build cannot read the archive: the wrong format, compression
 * or zoom, or the reader itself failed to load. The owner's wording of
 * 2026-11-24.
 */
export const ELEVATION_NOT_READABLE_TEXT =
  "This copy of the app can't read the elevation data. The route is saved flat.";

/**
 * What the rider is told for a failed read. Two plain sentences, by the
 * owner's ruling of 2026-11-24; the detailed reason stays on the
 * `TerrainError`'s own message (`terrain-source.ts` §`describeTerrainFailure`),
 * which names no coordinate, tile or URL, and is not shown.
 */
export function elevationFailureText(failure: TerrainFailure): string {
  switch (failure.kind) {
    case 'compression':
    case 'wrong-archive':
      return ELEVATION_NOT_READABLE_TEXT;
    case 'aborted':
    case 'network':
    case 'http':
    case 'not-a-range':
    case 'changed':
    case 'too-large':
      return ELEVATION_NOT_DOWNLOADED_TEXT;
  }
}

/**
 * A {@link RouteHeights} whose reader is loaded on its first call.
 *
 * ⚠️ **With map tiles off nothing is loaded and nothing is asked**: the check
 * is made first, on every call, so the rider's choice is read at the moment of
 * the request and not when the app started.
 */
export function lazyRouteHeights(
  options: { readonly config: TerrainConfig; readonly mapTilesOn: () => boolean },
  load: () => Promise<RouteHeights> = async () => {
    // Two plain `await import()` bindings, as `world-data/corridor-lazy.ts` has them.
    const source = await import('./terrain-source');
    const reader = await import('./route-heights');
    return reader.terrainHeights({ archive: source.terrainArchive(options.config) });
  },
): RouteHeights {
  let loaded: Promise<RouteHeights> | undefined;
  return {
    interval: metres(TERRAIN_SAMPLE_INTERVAL_METRES),
    heights: async (request) => {
      if (!options.mapTilesOn()) throw new RoutingError('unavailable', ELEVATION_TILES_OFF_TEXT);
      loaded ??= load().catch((error: unknown) => {
        loaded = undefined;
        throw error;
      });
      let reader: RouteHeights;
      try {
        reader = await loaded;
      } catch {
        throw new RoutingError('unavailable', ELEVATION_NOT_READABLE_TEXT);
      }
      return reader.heights(request);
    },
  };
}
