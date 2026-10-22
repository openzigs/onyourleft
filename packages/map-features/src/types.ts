// SPDX-License-Identifier: Apache-2.0

/**
 * The shapes this package hands out (#1544).
 *
 * Every coordinate is in **local metres in the corridor frame**, the frame
 * `apps/web/src/game/terrain.ts` §`localGroundPosition` defines: `x` is metres
 * **WEST** of the frame's origin (east is `−x`, since #583) and `z` is metres
 * **north** of it. `projection.ts` restates that formula, because a package may
 * not import from `apps/`, and `apps/web/src/game/map-features-projection.test.ts`
 * holds the two equal.
 */

/** One z15 tile. z15 only: ADR 0054 D-2, the zoom at which buildings are individual. */
export type TileId = { readonly z: 15; readonly x: number; readonly y: number };

/** A ring, `x0, z0, x1, z1, …` in local metres, closed implicitly (the first vertex is not repeated). */
export type Ring = Float32Array;

/** A polygon: `[outer, ...holes]`. */
export interface PolygonFeature {
  readonly rings: readonly Ring[];
}

/** Protomaps v4 `landuse.kind`, for example `residential` or `wood`. */
export type LandUseKind = string;

/** A `landuse` or `water` polygon and its `kind`, and nothing else (ADR 0054 D-2.2). */
export interface LandUseFeature extends PolygonFeature {
  readonly layer: 'landuse' | 'water';
  readonly kind: LandUseKind;
}

/** A footprint from `buildings`. Its `addr_housenumber`, name and id are never read. */
export interface BuildingFeature extends PolygonFeature {
  readonly kind: 'building' | 'building_part';
  /** Metres, `null` when the tile carries none — never `0` for "absent". */
  readonly heightMetres: number | null;
  /** Metres, `null` when the tile carries none. */
  readonly minHeightMetres: number | null;
}

/** A `roads` line that is a footway (`kind` `path`, or `kind_detail` in {@link FOOTWAY_KIND_DETAILS}). */
export interface PathFeature {
  readonly kind: string;
  /** `''` when the feature carries no `kind_detail`. */
  readonly kindDetail: string;
  /** `x0, z0, x1, z1, …` in local metres. */
  readonly line: Float32Array;
}

/**
 * A `roads` line that is a street (#1565): `kind` in {@link STREET_KINDS}, or
 * {@link OTHER_ROAD_KIND} with a street's `kind_detail`. Never a footway — a
 * line that is one of those is a {@link PathFeature} — and, like it, never a
 * name or an id.
 */
export interface StreetFeature {
  readonly kind: string;
  /** `''` when the feature carries no `kind_detail`. */
  readonly kindDetail: string;
  /** `x0, z0, x1, z1, …` in local metres. */
  readonly line: Float32Array;
}

export interface DecodedTile {
  readonly tile: TileId;
  readonly landUse: readonly LandUseFeature[];
  readonly buildings: readonly BuildingFeature[];
  readonly paths: readonly PathFeature[];
  /** #1565: the streets, for the cross streets at their junctions with the route. */
  readonly streets: readonly StreetFeature[];
}

/**
 * Why a tile was not decoded. A value, never a throw: a tile is untrusted input.
 *
 * `layer` is only ever one of the names this package reads — never a name the
 * tile supplied, which could be any string at all. No variant carries a
 * coordinate or the tile's `x` and `y` (ADR 0004 D): {@link describeRefusal}.
 *
 * `too-many-rings` is the fifth limit of #1544's table, which the issue's
 * refusal union had no variant for.
 */
export type DecodeRefusal =
  | { readonly reason: 'too-large'; readonly bytes: number; readonly limit: number }
  | {
      readonly reason: 'too-many-features';
      readonly layer: string;
      readonly count: number;
      readonly limit: number;
    }
  | { readonly reason: 'too-many-vertices'; readonly layer: string; readonly limit: number }
  | { readonly reason: 'too-many-rings'; readonly layer: string; readonly limit: number }
  | { readonly reason: 'malformed'; readonly layer: string | null }
  | { readonly reason: 'wrong-schema' };

/** The projection origin: the same two angles as the game's `CorridorOrigin`. */
export interface CorridorFrame {
  readonly latitude: number;
  readonly longitude: number;
}

/** An axis-aligned box in local metres. */
export interface Box {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/**
 * A grid of square cells in local metres. Cell `(column, row)` covers
 * `[originX + column·cellMetres, originX + (column + 1)·cellMetres)` in `x` and
 * the same in `z` from `originZ`, and its index is `row · columns + column`.
 */
export interface GridSpec {
  readonly originX: number;
  readonly originZ: number;
  readonly cellMetres: number;
  readonly columns: number;
  readonly rows: number;
}
