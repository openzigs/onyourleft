// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where on its four small maps each part of the realistic bicycle samples —
 * #624. The contract between the geometry `three-renderer.ts` §`realisticBicycle`
 * builds and the pictures `tools/realistic/draw-bicycle-maps.ts` draws, stated
 * once so that neither side can move without the other.
 *
 * ## Four maps, three materials, no new draw call
 *
 * The bicycle is three merged meshes — the paint, the rubber and the metal —
 * and #624's ceiling is **zero** added draw calls, so a part cannot get a
 * material of its own. Two of the three materials therefore wear an ATLAS:
 *
 * | Material | Map | Rows | What |
 * |---|---|---|---|
 * | rubber | normal, 256² | 0–127 | the tyre: tread, shoulder, sidewall and bead, once round its cross-section |
 * | rubber | normal, 256² | 128–255 | the bar tape, once round the bar |
 * | metal | normal + roughness, 256² | 0–127 | the chainring's teeth and the chain on them |
 * | metal | normal + roughness, 256² | 128–191 | the rear hub, across it: plain on the far side, the cassette's sprockets on the drive side |
 * | metal | normal + roughness, 256² | 192–255 | plain metal — the rims, the front hub, the spokes, the cranks |
 * | paint | roughness, 128² | all | the frame's clear coat, round a tube and along it — one tile, repeated both ways |
 *
 * ⚠️ **The ACROSS direction of a band — its rows — is never repeated**: it
 * runs once round a part's cross-section (or once across the hub), and
 * {@link bandV} maps it onto the band's first to last texel CENTRES, so a
 * bilinear sample never reaches the band beside it at the full-size level. The
 * ALONG direction — the columns — is a tile repeated as often as the part is
 * long, so each map is sampled with `RepeatWrapping` across and clamped down.
 *
 * ⚠️ **Every along figure is a whole number of the map's own period.** A tyre is
 * given a whole number of tread tiles round its circumference and a chainring a
 * whole number of teeth, so neither has a seam where its ring closes.
 *
 * Pure, and naming no rendering library, like `bicycle.ts` beside it.
 */

/** The side of the rubber and metal atlases, in texels. */
export const BICYCLE_ATLAS_PIXELS = 256;

/** A run of an atlas's rows: the first, and how many. */
export interface AtlasBand {
  readonly first: number;
  readonly rows: number;
}

/** The tyre, once round its cross-section, tread centre at the band's first and last rows. */
export const TYRE_BAND: AtlasBand = { first: 0, rows: 128 };
/** The bar tape, once round the bar. */
export const TAPE_BAND: AtlasBand = { first: 128, rows: 128 };
/** The chainring, once round its section, the teeth at the band's first and last rows. */
export const CHAINRING_BAND: AtlasBand = { first: 0, rows: 128 };
/** The rear hub, across it from the side away from the chain to the drive side. */
export const CASSETTE_BAND: AtlasBand = { first: 128, rows: 64 };
/** Plain metal: a flat normal and the material's own roughness. */
export const PLAIN_METAL_BAND: AtlasBand = { first: 192, rows: 64 };

/**
 * The `v` of a fraction of the way across a band: 0 at its first row's texel
 * centre and 1 at its last row's. @see AtlasBand
 */
export function bandV(band: AtlasBand, fraction: number): number {
  const first = (band.first + 0.5) / BICYCLE_ATLAS_PIXELS;
  const last = (band.first + band.rows - 0.5) / BICYCLE_ATLAS_PIXELS;
  return first + fraction * (last - first);
}

/**
 * One tread period, and how many of them one tile of the tyre's band holds:
 * a 20 mm chevron, eight to a 160 mm tile. A road tyre's tread is finer than
 * this; at the chase camera 4.5 m back a tablet shows about 4 mm a pixel on the
 * tyre, and a pattern finer than two pixels there is a grey the normal map's
 * mipmaps average flat.
 */
export const TREAD_PITCH_METRES = 0.02;
export const TREAD_PITCHES_PER_TILE = 8;

/** How far along the bar one turn of the tape advances, and how many turns a tile holds. */
export const TAPE_WRAP_METRES = 0.022;
export const TAPE_WRAPS_PER_TILE = 3;

/** The chainring's teeth: 48 round the ring, eight to a tile. */
export const CHAINRING_TEETH = 48;
export const CHAINRING_TEETH_PER_TILE = 8;

/**
 * The hub the realistic bicycle has at each wheel: 20 mm in radius and 100 mm
 * across. Not a part of the stylised rider at all, so not in `bicycle.ts`; the
 * renderer builds it at these numbers and the cassette is drawn at them.
 */
export const HUB_RADIUS_METRES = 0.02;
export const HUB_WIDTH_METRES = 0.1;

/** How far along a frame tube one repeat of the paint's roughness runs. */
export const PAINT_TILE_METRES = 0.25;

/** A texture coordinate. */
export type Uv = readonly [number, number];

/**
 * A point on a tyre: `along` its circumference and `around` its cross-section,
 * each a fraction; `circumference` is the tread's, in metres.
 */
export function tyreUv(along: number, around: number, circumference: number): Uv {
  const tiles = Math.max(
    1,
    Math.round(circumference / (TREAD_PITCH_METRES * TREAD_PITCHES_PER_TILE)),
  );
  return [along * tiles, bandV(TYRE_BAND, around)];
}

/** A point on the taped bar: `alongMetres` from the part's own start, `around` a fraction. */
export function tapeUv(alongMetres: number, around: number): Uv {
  return [alongMetres / (TAPE_WRAP_METRES * TAPE_WRAPS_PER_TILE), bandV(TAPE_BAND, around)];
}

/** A point on the chainring: `along` its circumference and `around` its section, fractions. */
export function chainringUv(along: number, around: number): Uv {
  return [(along * CHAINRING_TEETH) / CHAINRING_TEETH_PER_TILE, bandV(CHAINRING_BAND, around)];
}

/** A point on the rear hub: `around` it, and `across` it from the far side (0) to the drive side (1). */
export function cassetteUv(around: number, across: number): Uv {
  return [around, bandV(CASSETTE_BAND, across)];
}

/** Every metal part with nothing drawn on it samples here. */
export const PLAIN_METAL_UV: Uv = [0.5, bandV(PLAIN_METAL_BAND, 0.5)];

/**
 * Every rubber part with nothing drawn on it — the saddle — samples here: the
 * middle of the tyre's band, which is its bead, flat, where a rim hides it.
 */
export const PLAIN_RUBBER_UV: Uv = [0.5, bandV(TYRE_BAND, 0.5)];

/** A point on a painted tube: `around` it, a fraction, and `alongMetres` along it. */
export function paintUv(around: number, alongMetres: number): Uv {
  return [around, alongMetres / PAINT_TILE_METRES];
}
