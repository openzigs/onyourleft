// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a realistic building is painted — #1581: its facade, its roof, its
 * trim and its door, each one of a short list a surface carries.
 *
 * #621's seeded tint (`instance-tint.ts`) shifts a structure's hue, saturation
 * and brightness by a few per cent, and that is all it can do: a shift of
 * saturation scales a colour about its own grey, so a near-white facade — the
 * `render` photograph is white painted plaster (`tools/realistic/sources.ts`,
 * `PaintedPlaster017`) — stays white under any tint, and under the scene's
 * light reads as the flat light grey the owner saw beside brick in #1549's
 * screenshots. That is the photograph, not a fault in it (#1581's "grey
 * walls"); what was missing is paint. A painted house is cream, sage, duck-egg
 * or blush, and this file is where those colours are written down.
 *
 * ## Two kinds of entry
 *
 * - A **multiplier** ({@link WALL_PAINTS}, {@link ROOF_PAINTS}), linear, laid
 *   over a surface's photograph: the brick's courses and the plaster's cracks
 *   stay, in another colour. The first entry of every list is `[1, 1, 1]`
 *   (the photograph as it was), except `render`'s, which is white paint over it.
 * - An **albedo** ({@link TRIM_PAINTS}, {@link DOOR_PAINTS} and, since #1588,
 *   {@link SHINGLE_PAINTS}), linear, drawn in place of any photograph: a
 *   window frame, a sill, a porch and a door are painted timber, whatever the
 *   wall is, and an asphalt shingle is its own colour, whatever the roof
 *   photograph under it.
 * - **Clapboard** (#1588) wears its `render` list: the eight house paints are
 *   a sided house's colours as much as a plastered one's, and the shader lays
 *   them over white paint's albedo rather than over the plaster photograph.
 *
 * Every albedo is written as the sRGB a paint chart would give and converted
 * here ({@link linearFromSrgb}), because that is how a colour is checked by
 * eye. Nothing here is a stylised colour, so `scenery-palette.ts` does not
 * gate it (ADR 0026 D-10); {@link PAINT_LIMITS} is its bound, held by
 * `building-paint.test.ts`.
 *
 * ## Who reads it
 *
 * - `footprint-buildings.ts` chooses each mapped plan's four entries, seeded
 *   from its footprint, so that no two neighbours match ({@link paintTown}'s
 *   rule, written there).
 * - `settlements.ts` §`lotsAt` chooses each procedural lot's wall and roof
 *   ({@link lotPaint}), and `three-renderer.ts` carries the choice in the
 *   instance colour's two channels a structure did not use.
 * - `three-renderer.ts` turns an entry into a vertex colour (a mapped
 *   building) or bakes a list into a structure material's program (a lot).
 *
 * Pure, and names no rendering library.
 */

import type { StructureSurface } from './realistic-assets';
import { slotHash, uniformFrom } from './seeded';

/** A linear colour, red, green and blue. */
export type Rgb = readonly [number, number, number];

/** sRGB in `[0, 1]` to linear, IEC 61966-2-1's curve. */
export function linearFromSrgb(channel: number): number {
  return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** A `0xRRGGBB` sRGB colour, linear. */
function linear(hex: number): Rgb {
  return [
    linearFromSrgb(((hex >> 16) & 0xff) / 255),
    linearFromSrgb(((hex >> 8) & 0xff) / 255),
    linearFromSrgb((hex & 0xff) / 255),
  ];
}

/** The photograph as it is: every multiplier list starts here. */
const AS_PHOTOGRAPHED: Rgb = [1, 1, 1];

/**
 * How many entries of each list a procedural lot chooses among: **5**, the
 * fewest any list has, and the number {@link lotPaint}'s colouring needs.
 */
export const LOT_PAINTS = 5;

/**
 * Each wall surface's multipliers — #1581. `render` has the most, because it
 * is the surface a house is painted: the white plaster photograph under eight
 * house paints, each written as the paint's linear colour over white paint's
 * (`0xf2f0ea`, 0.89), so white is the photograph and sage is sage on it. The
 * others move less, the way brick, concrete and boards do; `corrugated`'s are
 * painted cladding over galvanised sheet, a paint's linear colour over 0.4.
 */
export const WALL_PAINTS: Readonly<Partial<Record<StructureSurface, readonly Rgb[]>>> = {
  brick: [
    AS_PHOTOGRAPHED,
    [0.78, 0.72, 0.7],
    [1.05, 0.93, 0.8],
    [0.88, 0.78, 0.82],
    [0.95, 0.85, 0.7],
  ],
  render: [
    [1, 0.98, 0.92], // white, 0xf2f0ea
    [0.98, 0.86, 0.59], // cream, 0xf0e2c0
    [0.98, 0.78, 0.36], // butter, 0xf0d99a
    [0.55, 0.65, 0.47], // sage, 0xb9c8ad
    [0.51, 0.69, 0.76], // duck-egg, 0xb3cdd6
    [0.91, 0.62, 0.54], // blush, 0xe8c4b8
    [0.62, 0.59, 0.51], // stone, 0xc4bfb4
    [0.78, 0.4, 0.22], // terracotta, 0xd9a07a
  ],
  concrete: [
    AS_PHOTOGRAPHED,
    [0.85, 0.87, 0.9],
    [0.75, 0.72, 0.68],
    [1.05, 1, 0.92],
    [0.66, 0.67, 0.7],
  ],
  corrugated: [
    AS_PHOTOGRAPHED,
    [0.4, 0.64, 0.36], // green, 0x6f8a6a
    [0.81, 0.17, 0.11], // oxide red, 0x9a4a3c
    [0.27, 0.44, 0.71], // blue, 0x5d7491
    [0.75, 0.75, 0.72], // weathered
  ],
  planks: [
    AS_PHOTOGRAPHED,
    [1.1, 0.55, 0.45],
    [0.62, 0.62, 0.6],
    [0.72, 0.64, 0.56],
    [1.08, 1, 0.9],
  ],
  stone: [
    AS_PHOTOGRAPHED,
    [0.9, 0.88, 0.85],
    [1.05, 1, 0.92],
    [0.82, 0.82, 0.84],
    [0.95, 0.9, 0.82],
  ],
};

/** Each roof surface's multipliers — #1581: new tile, weathered, mossed; slate blue to grey. */
export const ROOF_PAINTS: Readonly<Partial<Record<StructureSurface, readonly Rgb[]>>> = {
  'roof-tiles': [
    AS_PHOTOGRAPHED,
    [0.8, 0.68, 0.62],
    [0.62, 0.55, 0.5],
    [1.05, 0.9, 0.8],
    [0.72, 0.72, 0.66],
  ],
  slate: [AS_PHOTOGRAPHED, [0.82, 0.88, 1], [0.7, 0.7, 0.72], [0.9, 0.84, 0.8], [0.6, 0.6, 0.62]],
  'flat-roof': [
    AS_PHOTOGRAPHED,
    [0.85, 0.85, 0.85],
    [0.72, 0.72, 0.74],
    [0.95, 0.92, 0.86],
    [0.62, 0.62, 0.6],
  ],
};

/**
 * An asphalt-shingle roof's colour — #1588, an albedo, drawn in place of the
 * roof photograph by `three-renderer.ts` §`withFacade`'s shingle courses:
 * the greys, browns and greens a US roofing chart sells. Asphalt granules are
 * dark, so every entry is under 0.2 linear.
 */
export const SHINGLE_PAINTS: readonly Rgb[] = [
  linear(0x5c_5d_5e), // pewter grey
  linear(0x3c_3e_42), // charcoal
  linear(0x6e_6a_64), // weathered wood grey
  linear(0x5e_4b_3c), // driftwood brown
  linear(0x4b_3a_2e), // chestnut brown
  linear(0x4a_57_47), // hunter green
  linear(0x5f_66_5a), // sage green
];

/**
 * The paints a roof chooses among — #1588: an asphalt-shingle roof's
 * {@link SHINGLE_PAINTS}, and otherwise its surface's multipliers.
 */
export function roofPaintsOf(
  surface: StructureSurface,
  shingled: boolean,
): readonly Rgb[] | undefined {
  return shingled ? SHINGLE_PAINTS : paintsOf(surface);
}

/** A window frame's, a sill's and a porch's paint — #1581. */
export const TRIM_PAINTS: readonly Rgb[] = [
  linear(0xf4_f2_ec), // white
  linear(0xec_e2_c6), // cream
  linear(0x2a_2a_2a), // black
  linear(0x2f_4a_3a), // green
  linear(0x2c_3a_55), // navy
  linear(0x8a_8f_94), // grey
];

/** A front door's paint — #1581. */
export const DOOR_PAINTS: readonly Rgb[] = [
  linear(0x7a_1f_1f), // red
  linear(0x1f_35_60), // blue
  linear(0x2a_52_36), // green
  linear(0x1c_1c_1c), // black
  linear(0xe9_e6_dd), // white
  linear(0xc9_96_2e), // ochre
  linear(0x5a_3a_22), // stained oak
];

/**
 * The bounds every entry is held to: a multiplier never more than 1.1 — a
 * photograph brightened past that clips in the sun — and no albedo above 0.92,
 * which is fresh white paint, nor below 0.01, which is soot.
 *
 * @test-facing held by `building-paint.test.ts`; the lists are written inside it
 */
export const PAINT_LIMITS = { multiplier: 1.1, albedoHighest: 0.92, albedoLowest: 0.01 } as const;

/** A surface's list of multipliers — a wall's or a roof's — or none: it is not painted. */
export function paintsOf(surface: StructureSurface): readonly Rgb[] | undefined {
  return WALL_PAINTS[surface] ?? ROOF_PAINTS[surface];
}

/** Which instance channel a painted surface reads its lot's choice from. @see lotPaint */
export function paintChannelOf(surface: StructureSurface): 'wall' | 'roof' | undefined {
  if (WALL_PAINTS[surface] !== undefined) return 'wall';
  if (ROOF_PAINTS[surface] !== undefined) return 'roof';
  return undefined;
}

/** The base {@link lotPaint} packs a wall and a roof in. */
const LOT_PAINT_BASE = 16;

/**
 * What a lot's channel adds for its cladding — #1588: an entry is under
 * {@link LOT_PAINTS}, so the channel's entry and its cladding share a number,
 * `entry + 8 × clad`, and the shader takes them apart.
 */
export const LOT_CLAD_STEP = 8;

/**
 * The share of residential houses clad in clapboard — #1588: **0.7**, the
 * default; a mapped house's (`footprint-buildings.ts`) and a lot's alike.
 */
export const SIDING_SHARE = 0.7;

/** The share of pitched roofs in asphalt shingles — #1588: **0.75**; a mapped house's and a lot's. */
export const SHINGLE_SHARE = 0.75;

/** The key {@link lotPaint} hashes a lot's cladding under, apart from every other draw. */
const LOT_CLAD_KEY = 0x15_88;

/**
 * A lot's siding paint, by its wall entry — #1588: `render`'s first
 * {@link LOT_PAINTS} house paints, which a clapboard lot wears in place of its
 * wall surface's multipliers. @see lotPaint
 */
export function lotSidingPaints(): readonly Rgb[] {
  return (WALL_PAINTS.render ?? []).slice(0, LOT_PAINTS);
}

/**
 * A procedural lot's wall and roof, packed into one number for its scatter
 * item — #1581, #1550's lots.
 *
 * A lot is plot `plot` along the road, on `side` (1 the right). Its wall is
 * `(plot + 2s) mod 5` and its roof `(2·plot + s) mod 5` of
 * {@link LOT_PAINTS}, each turned by the ride's `seed`, with `s` 0 on the
 * right and 1 on the left. So a lot's wall differs from the next lot's on
 * either side of it, the lot across the road, and the two diagonally across —
 * the five a rider sees beside it — and so does its roof: `1, 2, 3` and `1, 2,
 * 4` are never `0 mod 5`. ⚠️ The plot is the ride's wrapped plot, so on a loop
 * the last and the first plot are neighbours that this rule does not hold
 * apart; it holds everywhere else.
 *
 * Since #1588 a `house` is clad, seeded by its plot and side: in clapboard
 * ({@link SIDING_SHARE}), whose wall entry is then one of
 * {@link lotSidingPaints}, and under asphalt shingles ({@link SHINGLE_SHARE}),
 * whose roof entry is one of {@link SHINGLE_PAINTS}. A shop is never clad.
 */
export function lotPaint(seed: number, plot: number, side: 1 | -1, house = false): number {
  const s = side === 1 ? 0 : 1;
  const turn = (seed >>> 0) % LOT_PAINTS;
  const wall = (((plot + 2 * s + turn) % LOT_PAINTS) + LOT_PAINTS) % LOT_PAINTS;
  const roof = (((2 * plot + s + turn) % LOT_PAINTS) + LOT_PAINTS) % LOT_PAINTS;
  const hash = slotHash(seed, plot * 2 + s, LOT_CLAD_KEY);
  const clapboard = house && uniformFrom(hash, 0) < SIDING_SHARE ? 1 : 0;
  const shingled = house && uniformFrom(hash, 1) < SHINGLE_SHARE ? 1 : 0;
  return 1 + wall + LOT_CLAD_STEP * clapboard + LOT_PAINT_BASE * (roof + LOT_CLAD_STEP * shingled);
}

/**
 * What a lot's packed {@link lotPaint} says of one channel, as the instance
 * colour carries it: its entry, and since #1588 {@link LOT_CLAD_STEP} for its
 * cladding, **plus one**, so that nought — an item no lot rule painted, and
 * three's default — is no paint. Allocates nothing: the structures' belts
 * write it for every item they draw.
 */
export function lotPaintChannel(packed: number | undefined, channel: 'wall' | 'roof'): number {
  if (packed === undefined || !(packed >= 1)) return 0;
  const code = packed - 1;
  return 1 + (channel === 'wall' ? code % LOT_PAINT_BASE : Math.floor(code / LOT_PAINT_BASE));
}

/**
 * A lot's paint entry in one channel, or −1 for none — #1588, the shader's
 * own decoding (`three-renderer.ts` §`withLotPaint`), in TypeScript.
 *
 * @test-facing held by `building-paint.test.ts` and `settlements-lots.test.ts`;
 * the product decodes it in the shader
 */
export function lotPaintEntry(packed: number | undefined, channel: 'wall' | 'roof'): number {
  const value = lotPaintChannel(packed, channel);
  return value === 0 ? -1 : (value - 1) % LOT_CLAD_STEP;
}

/**
 * Whether a lot's channel is clad — clapboard on the wall, shingles on the
 * roof — #1588, the shader's own decoding in TypeScript.
 *
 * @test-facing held by `building-paint.test.ts` and `settlements-lots.test.ts`;
 * the product decodes it in the shader
 */
export function lotClad(packed: number | undefined, channel: 'wall' | 'roof'): boolean {
  const value = lotPaintChannel(packed, channel);
  return value > 0 && Math.floor((value - 1) / LOT_CLAD_STEP) === 1;
}
