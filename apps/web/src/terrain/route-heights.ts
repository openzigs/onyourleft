// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Heights along a line, sampled from the terrain archive's z12 tiles — #2013.
 *
 * The line arrives already resampled onto a uniform grid
 * (`routing/elevation.ts` §`planElevation`), so sample `i` of the answer is
 * position `i` of the request. Each position falls in one z12 tile; each tile
 * is read once, decoded inside ADR 0087 D-3's bounds (`terrain/decode.ts`),
 * sampled by bilinear interpolation and dropped. MapLibre's
 * `queryTerrainElevation` is not used: it answers only for what the camera
 * has loaded.
 *
 * ## What it asks for is a function of the tiles the line crosses
 *
 * Nothing finer. Two lines through the same tiles ask for the same byte
 * ranges in the same order, wherever in those tiles they run, and the read
 * does not look at the athlete's privacy zones at all (ADR 0090 R-1 and R-3,
 * which ADR 0087 D-2.2 binds to every height read). A z12 tile is about 7.5
 * to 9 km across: coarser than the map the planner is drawing on the same
 * screen, from the same host. `route-heights.test.ts` holds both.
 *
 * ## Where there is no height
 *
 * - **Outside the archive, or a tile that was refused** (`decode.ts`): those
 *   samples have no elevation, the planner draws the gap as a gap and says
 *   the climb is a floor (#72), and the rest of the route keeps its heights.
 * - **The archive could not be read** (offline, a host that is down): the
 *   whole request fails with one `RoutingError('unavailable')`, the planner
 *   says elevation is unavailable, and the route still saves.
 *
 * ⚠️ **No message names a coordinate or a tile** (ADR 0004 D).
 */

import {
  altitudeMetres,
  heightsAcrossSpans,
  metres,
  RoutingError,
  type AltitudeMetres,
  type HeightProfile,
} from '@onyourleft/domain';
import {
  heightPixelMetres,
  heightTilePosition,
  isHeightTileRefusal,
  sampleHeightTile,
  type HeightTile,
  type HeightTileId,
  type HeightTilePosition,
} from '@onyourleft/map-features';

import { decodeHeightTile, type DecodeHeightTile } from './decode';
import {
  elevationUnavailableText,
  TERRAIN_DATASET_NAME,
  TERRAIN_SAMPLE_INTERVAL_METRES,
  type RouteHeights,
  type TerrainHeightRequest,
} from './heights';
import { describeTerrainFailure, terrainFailureOf, type TerrainArchive } from './terrain-source';

/**
 * The most z12 tiles one route's heights are read from: **200**.
 *
 * A bound on requests, not on memory (a tile is dropped once it is sampled).
 * A tile is at least 7.5 km across, so a line needs well over 1,000 km to
 * cross this many; past it the route has no profile rather than a read that
 * runs for minutes.
 */
export const MAX_ROUTE_HEIGHT_TILES = 200;

/** How many tiles are read at once, as the corridor read's `CORRIDOR_CONCURRENCY` is. */
export const TERRAIN_READ_CONCURRENCY = 4;

/**
 * How many decoded tiles are kept between requests: **4**, 1 MiB each.
 *
 * Every edit of a draft asks again, and a short route's edits ask for the
 * same one or two tiles each time; held, an edit asks the host for nothing.
 */
export const HELD_HEIGHT_TILES = 4;

/** Said of a line that crosses more tiles than {@link MAX_ROUTE_HEIGHT_TILES}. */
export const ROUTE_TOO_LONG_FOR_HEIGHTS_TEXT =
  'This route is too long to read heights for, so it has no elevation profile.';

export interface TerrainHeightsOptions {
  readonly archive: TerrainArchive;
  /** The tile decoder: the platform's unless a test hands in another. */
  readonly decode?: DecodeHeightTile | undefined;
}

const keyOf = (tile: HeightTileId): string => `${String(tile.x)}/${String(tile.y)}`;

/** Heights along a line from `archive`. */
export function terrainHeights(options: TerrainHeightsOptions): RouteHeights {
  const decode = options.decode ?? ((bytes: Uint8Array) => decodeHeightTile(bytes));
  /** Decoded tiles, most recently asked for last; `undefined` for a tile with no heights. */
  const held = new Map<string, Promise<HeightTile | undefined>>();

  const read = async (tile: HeightTileId): Promise<HeightTile | undefined> => {
    const bytes = await options.archive.tile(tile);
    if (bytes === undefined) return undefined;
    const decoded = await decode(bytes);
    return isHeightTileRefusal(decoded) ? undefined : decoded;
  };

  const tileOf = (tile: HeightTileId): Promise<HeightTile | undefined> => {
    const key = keyOf(tile);
    const known = held.get(key);
    if (known !== undefined) {
      held.delete(key);
      held.set(key, known);
      return known;
    }
    const reading = read(tile).catch((error: unknown) => {
      // A read that failed is not kept: the next request asks again.
      held.delete(key);
      throw error;
    });
    held.set(key, reading);
    while (held.size > HELD_HEIGHT_TILES) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
    return reading;
  };

  return {
    interval: metres(TERRAIN_SAMPLE_INTERVAL_METRES),
    heights: async (request: TerrainHeightRequest): Promise<HeightProfile> => {
      const positions = request.shape.map((point) =>
        heightTilePosition(point.longitude, point.latitude),
      );
      const byTile = new Map<
        string,
        { readonly tile: HeightTileId; readonly samples: [number, HeightTilePosition][] }
      >();
      positions.forEach((position, index) => {
        if (position === undefined) return;
        const key = keyOf(position.tile);
        let group = byTile.get(key);
        if (group === undefined) {
          group = { tile: position.tile, samples: [] };
          byTile.set(key, group);
        }
        group.samples.push([index, position]);
      });
      if (byTile.size > MAX_ROUTE_HEIGHT_TILES) {
        throw new RoutingError('invalid-request', ROUTE_TOO_LONG_FOR_HEIGHTS_TEXT);
      }

      const ground: (AltitudeMetres | undefined)[] = positions.map(() => undefined);
      const queue = [...byTile.values()];
      const worker = async (): Promise<void> => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
          const tile = await tileOf(next.tile);
          if (tile === undefined) continue;
          for (const [index, position] of next.samples) {
            const height = sampleHeightTile(tile, position.column, position.row);
            if (height !== undefined) ground[index] = altitudeMetres(height);
          }
        }
      };
      try {
        await Promise.all(
          Array.from({ length: Math.min(TERRAIN_READ_CONCURRENCY, queue.length) }, worker),
        );
      } catch (error) {
        throw new RoutingError(
          'unavailable',
          elevationUnavailableText(describeTerrainFailure(terrainFailureOf(error))),
        );
      }

      const road =
        request.spans === undefined || request.spans.length === 0
          ? ground
          : heightsAcrossSpans(ground, request.interval, request.spans);
      const middle = request.shape[Math.floor(request.shape.length / 2)];
      return {
        source: {
          name: TERRAIN_DATASET_NAME,
          // The grid spacing of the source where this route is, to 0.1 m.
          resolution: metres(Math.round(heightPixelMetres(middle?.latitude ?? 0) * 10) / 10),
        },
        samples: road.map((elevation, index) => ({
          along: metres(index * request.interval),
          elevation,
        })),
      };
    },
  };
}
