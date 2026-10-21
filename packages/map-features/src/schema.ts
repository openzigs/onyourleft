// SPDX-License-Identifier: Apache-2.0

/**
 * What this package reads of a Protomaps Basemap v4 tile, and nothing else
 * (ADR 0054 D-2.2; #1538's P-4).
 *
 * Four layers and, of each, only the fields placement needs. `pois` and
 * `places` are never read: they carry names, and the world names no place.
 * `name`, every `name:*`, `pmap:*`, `addr_housenumber`, `sort_rank`, `layer`
 * and the feature `id` are **not decoded at all**: the decoder looks a key up
 * only to compare it with the four keys below, so a value under any other key
 * is never turned into a string. That is what keeps an OSM id or a name out of
 * the store by construction rather than by a filter somebody might loosen —
 * ADR 0012 D-3's trap.
 */

/** The layers decoded, in the order their features are returned. */
export const READ_LAYERS = ['landuse', 'water', 'buildings', 'roads'] as const;
export type ReadLayer = (typeof READ_LAYERS)[number];

/**
 * A layer read for presence only, as half of the schema check: every Protomaps
 * v4 tile covers land (`earth`) or water (`water`) or both. A tile with
 * neither is not a basemap tile. Its features are never decoded.
 */
export const EARTH_LAYER = 'earth';

/** The keys looked up. Every other key's value is never decoded. */
export const KEY_KIND = 'kind';
export const KEY_KIND_DETAIL = 'kind_detail';
export const KEY_HEIGHT = 'height';
export const KEY_MIN_HEIGHT = 'min_height';

/** MVT geometry types (spec 2.1 §4.3.4). */
export const GEOMETRY_POINT = 1;
export const GEOMETRY_LINE = 2;
export const GEOMETRY_POLYGON = 3;

/**
 * The geometry types each layer carries in Protomaps v4, measured on the 200
 * densest z15 tiles of the published archive: `landuse` polygons; `water`
 * polygons, lines (rivers, streams) and label points; `buildings` polygons and
 * address points; `roads` lines. A feature of a type its layer never carries
 * means the tile is not this schema, and it is refused as `wrong-schema`.
 */
export const LAYER_GEOMETRY_TYPES: Readonly<Record<ReadLayer, readonly number[]>> = {
  landuse: [GEOMETRY_POLYGON],
  water: [GEOMETRY_POINT, GEOMETRY_LINE, GEOMETRY_POLYGON],
  buildings: [GEOMETRY_POINT, GEOMETRY_POLYGON],
  roads: [GEOMETRY_LINE],
};

/** The one geometry type kept from each layer; the others are skipped unread. */
export const LAYER_KEPT_GEOMETRY: Readonly<Record<ReadLayer, number>> = {
  landuse: GEOMETRY_POLYGON,
  water: GEOMETRY_POLYGON,
  buildings: GEOMETRY_POLYGON,
  roads: GEOMETRY_LINE,
};

/** The `buildings.kind` values kept. Address points and anything else are dropped. */
export const BUILDING_KINDS = ['building', 'building_part'] as const;

/** The `roads.kind` that is a footway in Protomaps v4. */
export const FOOTWAY_KIND = 'path';

/**
 * The footway set: a `roads` feature is kept when its `kind` is
 * {@link FOOTWAY_KIND} or its `kind_detail` is one of these (#1551, read from
 * docs.protomaps.com/basemaps/layers on 2026-10-21). `track`, `bridleway` and
 * `corridor` are not in it.
 */
export const FOOTWAY_KIND_DETAILS = [
  'sidewalk',
  'footway',
  'crossing',
  'path',
  'pedestrian',
  'steps',
  'cycleway',
] as const;

/** The MVT layer version this decoder reads (spec 2.1). */
export const MVT_VERSION = 2;

/** Layer extents admitted. 0 would divide by zero; Protomaps writes 4096. */
export const MIN_EXTENT = 1;
export const MAX_EXTENT = 2 ** 16;

/**
 * How far outside the tile a coordinate may lie, in extents. The published
 * archive's tiles reach about half an extent past each edge (−2,027 to 6,140
 * at extent 4,096 on the densest 200); one full extent either side is
 * admitted and anything further is malformed.
 */
export const COORDINATE_BUFFER_EXTENTS = 1;

/**
 * A `kind` is lower-case ASCII letters, digits and `_`, at most this long. A
 * value of any other shape is not a Protomaps kind, and is never turned into a
 * string: the feature is dropped.
 */
export const MAX_KIND_LENGTH = 64;

/**
 * A height above this many metres is dropped to `null`. The tallest building
 * in the world is 828 m; a larger value is an error or an attack, and would
 * only make the renderer draw a spike.
 */
export const MAX_HEIGHT_METRES = 1_000;
