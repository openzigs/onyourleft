// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/map-features` (#1544): one Protomaps v4 tile into bounded,
 * typed features in the corridor's local metres, and the geometry a corridor
 * read needs. It fetches nothing, decompresses nothing and holds no map data.
 */

export { corridorTileCover, tileBox } from './cover';
export { decodeTile } from './decode';
export { clipToBox, rasterise, simplifyRing, triangulate } from './geometry';
export {
  DEFAULT_DECODE_LIMITS,
  MAX_FEATURES_PER_LAYER,
  MAX_PLACES_PER_TILE,
  MAX_RINGS_PER_POLYGON,
  MAX_TILE_BYTES,
  MAX_VERTICES_PER_FEATURE,
  MAX_VERTICES_PER_TILE,
  type DecodeLimits,
} from './limits';
export { localMetres, METRES_PER_DEGREE_LATITUDE, tileBounds } from './projection';
export { describeRefusal } from './refusal';
export {
  BUILDING_FIELD_NAMES,
  BUILDING_FIELD_RULES,
  BUILDING_KINDS,
  BUILDING_PALETTE_SIZE,
  BUILDING_TYPES,
  FOOTWAY_KIND,
  FOOTWAY_KIND_DETAILS,
  LANDMARKS,
  MAX_START_YEAR,
  MIN_START_YEAR,
  NO_BUILDING_FIELDS,
  OTHER_ROAD_KIND,
  OTHER_STREET_KIND_DETAILS,
  READ_LAYERS,
  ROOF_DIRECTION_STEP_DEGREES,
  ROOF_MATERIALS,
  ROOF_ORIENTATIONS,
  ROOF_SHAPES,
  STREET_KINDS,
  WALL_MATERIALS,
  type BuildingFieldName,
  type BuildingFieldRule,
} from './schema';
export type {
  BuildingFeature,
  BuildingFields,
  BuildingType,
  Box,
  CorridorFrame,
  DecodedTile,
  DecodeRefusal,
  GridSpec,
  Landmark,
  LandUseFeature,
  LandUseKind,
  PathFeature,
  PlaceFeature,
  PolygonFeature,
  Ring,
  RoofMaterial,
  RoofOrientation,
  RoofShape,
  StreetFeature,
  StreetGrade,
  TileId,
  WallMaterial,
} from './types';
