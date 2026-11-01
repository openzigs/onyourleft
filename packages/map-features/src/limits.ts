// SPDX-License-Identifier: Apache-2.0

/**
 * The bounds a tile is decoded inside (#1544).
 *
 * A tile is untrusted input: it comes from a configurable URL (ADR 0054 D-2.1),
 * and a self-hoster or anybody on the path can hand back anything. Each limit
 * below turns "anything" into a refusal rather than a hang, a crash or
 * unbounded memory.
 *
 * ## What the limits sit above
 *
 * Measured on 2026-10-21 against the published archive,
 * `basemap-us-20260914.pmtiles` (Protomaps Basemap v4.15.2, z0–15, US). Every
 * z15 entry's stored length was read from the archive's directories, and the
 * **200 largest z15 tiles by stored (gzip) length** were fetched, decompressed
 * and walked. Over those 200:
 *
 * | Quantity | Largest seen | Limit | Headroom |
 * |---|---|---|---|
 * | decompressed tile bytes | 469,413 | 4 MiB | 8.9× |
 * | features a layer | 12,969 (`buildings`) | 20,000 | 1.5× |
 * | vertices a feature | 3,226 (`roads`; `water` 1,180) | 8,192 | 2.5× |
 * | vertices a tile, the four layers read | 88,903 | 400,000 | 4.5× |
 * | rings a polygon | 125 | 256 | 2.0× |
 *
 * ⚠️ That is a sample of the densest tiles, not the archive's maximum in every
 * column: a tile with one enormous coastline polygon need not be among the 200
 * largest. A real tile over a limit is refused and its stretch of the world is
 * procedural (ADR 0054 D-4), which is the safe direction to be wrong in.
 */

/** Every bound {@link decodeTile} enforces. */
export interface DecodeLimits {
  /** Decompressed tile bytes. Checked first, before anything is read. */
  readonly maxBytes: number;
  /** Features in one layer, counted before any feature is decoded. */
  readonly maxFeaturesPerLayer: number;
  /** Vertices in one feature, as decoded and before any simplification. */
  readonly maxVerticesPerFeature: number;
  /** Vertices in the whole tile, over the four layers read. */
  readonly maxVerticesPerTile: number;
  /** Rings in one polygon, its outer ring and its holes together. */
  readonly maxRingsPerPolygon: number;
  /**
   * Place points kept from one tile (ADR 0055 D-2.5). Not a refusal: the
   * decoder stops reading `places` at it, and the tile's other layers stand.
   */
  readonly maxPlacesPerTile: number;
}

/**
 * 4 MiB. The largest decompressed z15 tile measured was 469,413 bytes; this is
 * nearly nine times that, and still small enough that a tile at the limit is
 * decoded inside the time budget the suite asserts.
 */
export const MAX_TILE_BYTES = 4 * 1024 * 1024;

/**
 * 20,000. The densest layer measured held 12,969 building footprints (a
 * downtown tile). Counted by skipping, before a feature is decoded, so a layer
 * of a million empty features costs a scan and no allocation.
 */
export const MAX_FEATURES_PER_LAYER = 20_000;

/**
 * 8,192. The longest feature measured was a 3,226-vertex road; a footprint is
 * tens of vertices. Checked, by a counting pass before anything is decoded,
 * against each command's count **before** its parameters are skipped, so a
 * feature claiming a million `LineTo`s is refused at the 8,193rd vertex rather
 * than after a million.
 */
export const MAX_VERTICES_PER_FEATURE = 8_192;

/**
 * 400,000. The most vertices measured over the four layers read was 88,903,
 * counted over every feature of those layers whatever its type or kind, which
 * is how the counting pass counts too. This is what bounds the output: at 8
 * bytes a vertex, 3.2 MB of `Float32Array` a tile at most.
 */
export const MAX_VERTICES_PER_TILE = 400_000;

/** 256. The most rings measured in one polygon was 125 (a wood full of clearings). */
export const MAX_RINGS_PER_POLYGON = 256;

/**
 * 768 (#1632, ADR 0055 D-2.5). The archive thins `places` with a label grid:
 * at z15, 16-pixel cells of at most 3 points each (`Places.java` at
 * `c809cd18`, as ADR 0055 records). A 256-pixel tile is 256 such cells, so the
 * archive itself writes at most 768 points a tile; the most measured on
 * ADR 0055's downtown sample was 24 over 7 tiles. Past it a tile is not the
 * archive's output, and the decoder **stops**: the points after it are
 * dropped, never decoded, and the tile is not refused, since a place is a
 * prior and worth less than the footprints beside it.
 */
export const MAX_PLACES_PER_TILE = 768;

/** The limits a caller gets when it names none. */
export const DEFAULT_DECODE_LIMITS: DecodeLimits = {
  maxBytes: MAX_TILE_BYTES,
  maxFeaturesPerLayer: MAX_FEATURES_PER_LAYER,
  maxVerticesPerFeature: MAX_VERTICES_PER_FEATURE,
  maxVerticesPerTile: MAX_VERTICES_PER_TILE,
  maxRingsPerPolygon: MAX_RINGS_PER_POLYGON,
  maxPlacesPerTile: MAX_PLACES_PER_TILE,
};
