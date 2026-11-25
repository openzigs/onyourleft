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

import type {
  BUILDING_TYPES,
  LANDMARKS,
  PoiClass,
  RAIL_KIND_DETAILS,
  ROOF_MATERIALS,
  ROOF_ORIENTATIONS,
  PITCH_SPORTS,
  ROOF_SHAPES,
  WALL_MATERIALS,
  WATER_LINE_KINDS,
} from './schema';

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

/** A pitch's sport, where it is one the world draws (#2688). */
export type PitchSport = (typeof PITCH_SPORTS)[number];

/**
 * A `landuse` or `water` polygon and its `kind`, and nothing else (ADR 0054
 * D-2.2) — but, since #2688, a `pitch`'s `sport` where it is one of
 * {@link PITCH_SPORTS}. Absent on every other polygon.
 */
export interface LandUseFeature extends PolygonFeature {
  readonly layer: 'landuse' | 'water';
  readonly kind: LandUseKind;
  readonly sport?: PitchSport;
}

export type BuildingType = (typeof BUILDING_TYPES)[number];
export type RoofShape = (typeof ROOF_SHAPES)[number];
export type RoofOrientation = (typeof ROOF_ORIENTATIONS)[number];
export type WallMaterial = (typeof WALL_MATERIALS)[number];
export type RoofMaterial = (typeof ROOF_MATERIALS)[number];
export type Landmark = (typeof LANDMARKS)[number];

/**
 * The building fields #1557's archive adds (#1789, ADR 0054's entry of
 * 2026-11-01), each read by its rule in `schema.ts` §`BUILDING_FIELD_RULES`.
 * **Every one is `null`** when the tile carries none — as every tile of
 * Protomaps' published build does — or a value the rule cannot bring within
 * it. Nothing draws from them yet: the building plan's use of each is a
 * sibling issue under #1656.
 */
export interface BuildingFields {
  readonly buildingType: BuildingType | null;
  /** A whole number of storeys, 1 to 100. */
  readonly levels: number | null;
  /** A whole number of storeys in the roof, 0 to 5. */
  readonly roofLevels: number | null;
  readonly roofShape: RoofShape | null;
  readonly roofOrientation: RoofOrientation | null;
  /** Degrees clockwise from north, 0 to 345 in steps of 15. */
  readonly roofDirectionDegrees: number | null;
  /** An index, 0 to 19, into the profile's palette: never a colour string. */
  readonly wallColour: number | null;
  readonly roofColour: number | null;
  readonly wallMaterial: WallMaterial | null;
  readonly roofMaterial: RoofMaterial | null;
  /** A whole year, 1600 to 2100. */
  readonly startYear: number | null;
  readonly landmark: Landmark | null;
}

/** A footprint from `buildings`. Its `addr_housenumber`, name and id are never read. */
export interface BuildingFeature extends PolygonFeature, BuildingFields {
  readonly kind: 'building' | 'building_part';
  /** Metres, `null` when the tile carries none — never `0` for "absent". */
  readonly heightMetres: number | null;
  /** Metres, `null` when the tile carries none. */
  readonly minHeightMetres: number | null;
  /**
   * #2975: a shop, a café or a fuel station, where a `pois` point of that
   * class falls in it or within `schema.ts` §`POI_REACH_METRES` of it — on a
   * `building` only, never a `building_part`. Absent where none does, and on
   * a footprint built by hand. The POI's name, brand and point are never
   * kept: this is all that is.
   */
  readonly poi?: PoiClass;
}

/**
 * A `water` line that is a river, a stream or a canal — #2659, ADR 0054's
 * entry of 2026-11-15 — or since #2974 a ditch or a drain. Its `kind` and its
 * line, and nothing else: no name, no id, no `layer`.
 */
export interface WaterLineFeature {
  readonly kind: (typeof WATER_LINE_KINDS)[number];
  /** `x0, z0, x1, z1, …` in local metres. */
  readonly line: Float32Array;
}

/** A `roads` line that is a footway (`kind` `path`, or `kind_detail` in {@link FOOTWAY_KIND_DETAILS}). */
export interface PathFeature {
  readonly kind: string;
  /** `''` when the feature carries no `kind_detail`. */
  readonly kindDetail: string;
  /** `x0, z0, x1, z1, …` in local metres. */
  readonly line: Float32Array;
}

/** Whether a street is at grade, on a bridge or in a tunnel (#1565). A bridge wins if both are set. */
export type StreetGrade = 'ground' | 'bridge' | 'tunnel';

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
  /** From `is_bridge` and `is_tunnel`: `'ground'` unless either is `true`. */
  readonly grade: StreetGrade;
  /** `x0, z0, x1, z1, …` in local metres. */
  readonly line: Float32Array;
}

/**
 * A `roads` line that is a railway kept as track (#2660): `kind`
 * {@link RAIL_KIND} with a `kind_detail` in {@link RAIL_KIND_DETAILS}. Its
 * detail, its grade and its line; never a name, an operator or an id.
 */
export interface RailFeature {
  readonly kindDetail: (typeof RAIL_KIND_DETAILS)[number];
  /** From `is_bridge` and `is_tunnel`, as a street's. */
  readonly grade: StreetGrade;
  /** `x0, z0, x1, z1, …` in local metres. */
  readonly line: Float32Array;
}

/**
 * A street's `oneway` (#2892, ADR 0091 D-2): `'with-line'` for `yes`, which
 * runs along the line's vertex order, `'against-line'` for `-1`, and `'no'`
 * for `no`, for none, and for anything else. A fact about the street: it never
 * removes a way on (D-5).
 */
export type StreetOneway = 'no' | 'with-line' | 'against-line';

/** A street's `access`, read only to tell `no` or `private` from open (#2892, ADR 0091 D-2). */
export type StreetAccess = 'open' | 'no' | 'private';

/**
 * The three road fields the open-world street graph reads besides a street's
 * kind and grade (#2892, ADR 0091 D-2). Every one is always set: a field the
 * tile does not carry, or carries a value the decoder does not recognise, is
 * its default (`schema.ts` §`NO_ROAD_FIELDS`), never `undefined`.
 */
export interface StreetRoadFields {
  readonly oneway: StreetOneway;
  readonly access: StreetAccess;
  /** From `is_link`: `true` only for a boolean `true`. */
  readonly isLink: boolean;
}

/**
 * A street as {@link decodeTile} hands it out: a {@link StreetFeature} and its
 * road fields. A corridor's packed streets (`apps/web` §`world-data/corridor.ts`)
 * keep the {@link StreetFeature} alone, which is why the fields are not on it.
 */
export interface DecodedStreetFeature extends StreetFeature, StreetRoadFields {
  /**
   * #3052, ADR 0096: its OSM `name`, as mapped, when the caller asked for
   * names (`decodeTile`'s `streetNames`) and the tile carried one: at most
   * `schema.ts` §`STREET_NAME_MAX_CHARS` characters, with no control or
   * bidirectional-override character. Absent otherwise — never `''`.
   */
  readonly name?: string;
}

/** What {@link decodeTile} is asked to read beyond its default. */
export interface DecodeOptions {
  /**
   * #3052, ADR 0096: read each street's `name` onto it. Off by default: a
   * route ride's corridor reads no name (ADR 0054 D-2.2 stands for it).
   */
  readonly streetNames?: boolean;
}

/**
 * A point from `places` (#1632, ADR 0055 D-2): what kind of settlement stands
 * there and roughly how big, **never which one** — no name, no `wikidata`, no
 * `population`, no id is ever decoded (D-3).
 */
export interface PlaceFeature {
  readonly kind: 'locality' | 'neighbourhood' | 'macrohood';
  /** The OSM `place` value. */
  readonly kindDetail: 'city' | 'town' | 'village' | 'hamlet' | 'suburb' | 'quarter';
  /** An integer from 1 to 18; a point with any other is dropped. */
  readonly populationRank: number;
  /** The point, in local metres: `x` WEST and `z` north, as every other feature. */
  readonly x: number;
  readonly z: number;
}

export interface DecodedTile {
  readonly tile: TileId;
  readonly landUse: readonly LandUseFeature[];
  readonly buildings: readonly BuildingFeature[];
  readonly paths: readonly PathFeature[];
  /**
   * #1565: the streets, for the cross streets at their junctions with the
   * route; since #2892 each with its road fields, for the open-world graph.
   */
  readonly streets: readonly DecodedStreetFeature[];
  /**
   * #2892: how many road-field values on the streets kept were present but
   * not recognised, and read as their default — a hostile or unknown
   * `oneway`, `access` or `is_link`. A count, never the value.
   */
  readonly roadValuesDefaulted: number;
  /** #1632: the place points, at most `DecodeLimits.maxPlacesPerTile` of them. */
  readonly places: readonly PlaceFeature[];
  /**
   * #2659: the rivers, streams and canals, for where they cross the route;
   * since #2974 the ditches and drains too, for where they run beside it.
   */
  readonly waterLines: readonly WaterLineFeature[];
  /** #2660: the railway lines, for the level crossings where they cross the route. */
  readonly rails: readonly RailFeature[];
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
