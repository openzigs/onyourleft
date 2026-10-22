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
  MAX_RINGS_PER_POLYGON,
  MAX_TILE_BYTES,
  MAX_VERTICES_PER_FEATURE,
  MAX_VERTICES_PER_TILE,
  type DecodeLimits,
} from './limits';
export { localMetres, METRES_PER_DEGREE_LATITUDE, tileBounds } from './projection';
export { describeRefusal } from './refusal';
export {
  BUILDING_KINDS,
  FOOTWAY_KIND,
  FOOTWAY_KIND_DETAILS,
  OTHER_ROAD_KIND,
  OTHER_STREET_KIND_DETAILS,
  READ_LAYERS,
  STREET_KINDS,
} from './schema';
export type {
  BuildingFeature,
  Box,
  CorridorFrame,
  DecodedTile,
  DecodeRefusal,
  GridSpec,
  LandUseFeature,
  LandUseKind,
  PathFeature,
  PolygonFeature,
  Ring,
  StreetFeature,
  TileId,
} from './types';
