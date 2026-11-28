// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A mapped footprint wrapped in modular facade pieces — #3334, the owner's
 * direction of 2026-11-26 on it: *build this with Quaternius's Downtown City
 * MegaKit; it is modular, so wrap mapped footprints on town and city-centre
 * streets with facade pieces: storefronts on the ground floor, upper floors,
 * cornice. Do not place pre-built blocks that ignore the map.*
 *
 * The kit is CC0 (`ASSETS.toml`, ADR 0099 D-1). {@link KIT_PIECES} is what is
 * taken of it; `tools/realistic/blender/process_downtown_kit.py` writes the
 * pieces into one GLB, each mapped into one colour atlas, so every wrapped
 * building drawn is one draw call between them.
 *
 * ## Which footprints, by setting
 *
 * {@link kitKindOf}: beside a `town` or `city-centre` stretch
 * (`urban-class.ts`), and never on farmland — the setting #3273's
 * `houseStyleOf` calls modern with no traditional share. A `village` stretch
 * (which is also what a suburb reads as), a `rural` one and one with no class
 * keep what they draw today.
 *
 * | the footprint | is drawn as |
 * |---|---|
 * | commercial, one storey | `retail`: a shop front under a parapet |
 * | commercial, two or three storeys | `shop`: a shop front under upper floors |
 * | commercial, four storeys or more | `office`: floor after floor |
 * | residential, in a terrace, two to four storeys | `townhouse`: a window a bay |
 *
 * Every other footprint keeps its extrusion (or its house model): a detached
 * house, a block of flats, a civic or industrial building, a part.
 *
 * A city centre's own street front (#1637's terraced blocks, which no
 * footprint was mapped for) is wrapped by the same table since the
 * maintainer's ruling on PR #3343: they are commercial, three or four storeys.
 *
 * ## What a building looks like is its own — the look check on PR #3343
 *
 * The first wrap was one brick, one window and flat cards, and read worse
 * than the painted terrace it replaced. Since the rework {@link kitStyleOf}
 * chooses, for each building, seeded from its footprint:
 *
 * - its **skin** ({@link KitSkin}), from what its extrusion is walled in, so
 *   that a wrap and its own far level are one building: the kit's red brick;
 *   `render`, the kit's brick pieces walled in its concrete, baked neutral and
 *   worn in the plan's own house paint; `stone`, the kit's cream trim as a
 *   wall; or `metal`, its metal and glass;
 * - its **window** ({@link KIT_SKINS}): a square sash, one under a keyed
 *   lintel, a tall one, a wide one two bays across, an arched one, a pair in
 *   quoins; metal glazing in three patterns;
 * - its **cornice**: the skin's own parapet, or the kit's deep moulded one;
 * - its **shop front** ({@link KIT_SHOPFRONTS}): a painted timber front
 *   between columns, a metal one over a stall riser, or glazing to the floor,
 *   under an awning or a sign band, in one of the main street's deep colours;
 * - its **door**; **pilasters** up some fronts; and a **fire escape** on some
 *   brick ones of three storeys or more.
 *
 * ⚠️ **What the kit does not hold**: an awning, a sign band, or a fire escape.
 * The awning and the sign band are the pipeline's own few triangles
 * (`process_downtown_kit.py` §`MADE`), as the pane behind a door frame is; the
 * fire escape is the kit's own metal railing on a landing and a ladder the
 * pipeline makes. Everything else drawn is the kit's geometry.
 *
 * ## Three colours a building, a class a vertex
 *
 * Every vertex of a piece carries a {@link KitTintClass}: its `wall`, its
 * `trim` (a sill, a lintel, a cornice), its `accent` (a shop front's timber,
 * an awning's canvas) or `fixed` (glass, a dark frame, metal). The belt
 * multiplies each by the building's own colour for that class
 * ({@link kitPaletteOf}). The pipeline bakes the `trim` and `accent` classes
 * and the `render` and `stone` walls **neutral**, a grey of
 * {@link KIT_NEUTRAL_LEVEL} that keeps the picture's grain, so the colour is
 * the building's and not the atlas's; brick and metal are baked as they are,
 * and their colour is a shade.
 *
 * ## The wrap
 *
 * {@link wrapFootprint} walks the footprint's own outline, edge by edge. An
 * edge is cut into bays of about {@link KIT_BAY_METRES}, each piece stretched
 * along the wall to fill its bay ({@link bayCount}), and each storey's pieces
 * stretched upward so that the storeys reach the plan's own eaves: the wrap
 * is exactly as tall as the extrusion it replaces, which is its far level.
 *
 * - an edge **facing the street** ({@link KIT_FRONT_COSINE} of the door's
 *   edge) has the style's front on its ground floor, and the door's edge a
 *   door in its middle bay;
 * - upper storeys have the style's window; a window two bays wide takes its
 *   bays in pairs, and an odd bay left over the skin's first window;
 * - a **party wall** — an edge mostly shared with a neighbour — is plain;
 * - a plinth of the plain piece from the plan's foot to its floor;
 * - a cornice a bay at the eaves, as tall as the extrusion's parapet;
 * - a flat roof at the eaves, the outline triangulated.
 *
 * ## One budget a building
 *
 * A piece is drawn either in **relief**, its own geometry, or as its
 * **card**: two triangles on the wall's plane wearing the same cell of the
 * atlas, which the pipeline baked looking straight at the piece.
 *
 * ⚠️ **A wrapped building holds `realistic-budget.ts`
 * §`REALISTIC_KIT_WRAP_TRIANGLES`, 3 000** — the house models' price a
 * building, the maintainer's direction on PR #3343 — and no longer the
 * structure class's 640, under which most bays were cards. Every bay starts
 * as a card. Then a door, a cornice and a window are chosen that put the WHOLE
 * street front in relief inside the budget, with its sign, its columns, its
 * pilasters and its fire escape (the seeded choice first, then the
 * richest window that fits, then the plain cornice, then the cheapest door),
 * and what is left is spent, a whole row at a time, on
 * the sign, the columns, the pilasters, the fire escape, and the other walls'
 * ground floors and windows. A front too long for any window keeps the
 * cheapest, and its rows stay cards from where the budget ends, the ground
 * floor last. A footprint whose cards alone pass the budget keeps its
 * extrusion.
 *
 * ⚠️ **How many are wraps at once is capped**, since a wrap is some thirty
 * times its extrusion: `mapped-buildings.ts` §`selectMappedBuildings` draws
 * the nearest wrapped plans as wraps up to `MAPPED_KIT_NEAR_MAX` of them, a
 * side of the street in turn ({@link KitWrap.facing}), and every wrapped plan
 * past them as its extrusion. They are the nearest to the rider, chosen again
 * every `MAPPED_KIT_STRIDE_METRES` as the rider moves (`nearWraps`).
 *
 * ⚠️ **Planned only where they can be drawn**: `GameView`'s press plans wraps
 * for a ride that asked for the realistic world, and Delivery's house count
 * plans none (`FootprintPlanOptions.facadeKit`). The demo player plans them:
 * its stage draws the realistic world.
 * The worst frame is `realistic-budget.ts`' to state.
 *
 * ## A gap, from PR #3343's review, not closed here
 *
 * A wrapped plan's paved apron (#2848) IS drawn at the near level since the
 * rework, in its extrusion's own surface (`mapped-buildings.ts`
 * §`MappedSelection.paved`): it is ground, and no piece of the kit. Still open:
 *
 * - **With an even number of bays the door is not on the middle of its
 *   edge**, where `FootprintPlan.frontStep` and the extrusion's door are: it
 *   is the bay before the middle, up to a metre along the wall.
 *
 * Pure, and names no rendering library. No coordinate is formatted into any
 * string here.
 */

import { triangulate } from '@onyourleft/map-features';

import { nearestPaint, SIGN_PAINTS, TRIM_PAINTS, WALL_PAINTS, type Rgb } from './building-paint';
import { uniformFrom } from './seeded';
import type { UrbanClass } from './urban-class';

/** The atlas's side, pixels: **2048**. */
export const KIT_ATLAS_PIXELS = 2048;

/** A piece's texels a metre, in the atlas: **96**, about a centimetre a texel. */
export const KIT_PIXELS_PER_METRE = 96;

/**
 * The gutter round each piece's cell, pixels: **8**, which the bake's margin
 * fills with the cell's own edge, so a mipmap three levels down does not reach
 * a neighbour.
 */
export const KIT_GUTTER_PIXELS = 8;

/**
 * What colours a vertex — the module's header: its place here is the number
 * the pipeline writes in the vertex's second texture coordinate.
 */
export const KIT_TINT_CLASSES = ['fixed', 'wall', 'trim', 'accent'] as const;

/** One of {@link KIT_TINT_CLASSES}. */
export type KitTintClass = (typeof KIT_TINT_CLASSES)[number];

/** One piece of the kit taken. */
export interface KitPiece {
  readonly id: string;
  /**
   * Its name in the kit: `<source>.gltf` under the archive's glTF export; `''`
   * where the pipeline makes the whole of it ({@link made}).
   */
  readonly source: string;
  /** Its extent along the wall and up it, metres. */
  readonly width: number;
  readonly height: number;
  /** Its triangles in relief, as the pipeline reported them. Its card is {@link KIT_CARD_TRIANGLES}. */
  readonly triangles: number;
  /** What colours its card, which is one class across: what most of its face is. */
  readonly tint: KitTintClass;
  /**
   * Whether the kit models it lying flat (the roof): the pipeline stands it
   * up to bake it, and nothing draws it in relief.
   */
  readonly lies?: true;
  /**
   * The piece whose geometry it wears, where it is that piece in another
   * skin: its own cell of the atlas, and no mesh of its own in the GLB.
   */
  readonly mesh?: string;
  /** `render`: its wall is baked from the kit's concrete, neutral, not from its brick. */
  readonly skin?: 'render';
  /** The kit materials that are its `wall`; the kit's two bricks where it names none. */
  readonly wall?: readonly string[];
  /** The kit materials that are its `accent`, beside the kit's `MI_Trim_Green`. */
  readonly accent?: readonly string[];
  /** The kit materials baked as they are and never coloured, beside the kit's metal and glass. */
  readonly fixed?: readonly string[];
  /** What is seen through its glass: a lit shop, or a dark room. */
  readonly glass?: 'lit-1' | 'lit-2' | 'dark';
  /** The kit's door leaf hung in its frame: `<leaf>.gltf`. */
  readonly leaf?: string;
  /** What the pipeline makes of it itself — the module's header. */
  readonly made?: 'awning' | 'fascia' | 'balcony' | 'ladder';
}

/** A kit material named in {@link KitPiece.wall} and its like. */
const TRIM = 'MI_Trim';
const METAL = 'MI_Trim_MetalConcrete';

/**
 * The pieces taken, as `process_downtown_kit.py` reported them on
 * 2026-11-27 — held to the committed GLB by `facade-kit.test.ts`. Their
 * order is their place in the atlas ({@link kitCell}).
 *
 * Each piece's `triangles` is what is left once the pipeline has dropped the
 * faces nobody outside sees (the kit's `MI_InteriorWall` and
 * `MI_FakeInterior`) and added what it makes itself.
 */
export const KIT_PIECES = [
  // The kit's red brick.
  { id: 'brick-plain', source: 'Brick_Plain_3', width: 2, height: 3, triangles: 2, tint: 'wall' },
  {
    id: 'brick-window',
    source: 'Brick_Window_Square_Single',
    width: 2,
    height: 3,
    triangles: 172,
    tint: 'wall',
    glass: 'dark',
  },
  {
    id: 'brick-lintel',
    source: 'Brick_Window_Trim_Single',
    width: 2,
    height: 3,
    triangles: 408,
    tint: 'wall',
    glass: 'dark',
  },
  {
    id: 'brick-tall',
    source: 'Brick_Window_Trim',
    width: 2,
    height: 3,
    triangles: 634,
    tint: 'wall',
    glass: 'dark',
  },
  {
    id: 'brick-wide',
    source: 'Brick_Inset_Window',
    width: 4,
    height: 3,
    triangles: 466,
    tint: 'wall',
    glass: 'dark',
  },
  {
    id: 'brick-arch',
    source: 'Brick_Inset_Window_Curved',
    width: 4,
    height: 3,
    triangles: 630,
    tint: 'wall',
    glass: 'dark',
  },
  {
    id: 'brick-quoin',
    source: 'Brick_RedWhite_DoubleWindow',
    width: 4,
    height: 3,
    triangles: 760,
    tint: 'wall',
    glass: 'dark',
  },
  {
    id: 'brick-cornice',
    source: 'Cornice_Brick_Center',
    width: 2,
    height: 1,
    triangles: 6,
    tint: 'wall',
  },
  {
    id: 'brick-pilaster',
    source: 'Brick_Column_Small',
    width: 0.5,
    height: 3,
    triangles: 32,
    tint: 'wall',
  },
  // The same pieces walled in render.
  {
    id: 'render-plain',
    source: 'Brick_Plain_3',
    width: 2,
    height: 3,
    triangles: 2,
    tint: 'wall',
    mesh: 'brick-plain',
    skin: 'render',
  },
  {
    id: 'render-window',
    source: 'Brick_Window_Square_Single',
    width: 2,
    height: 3,
    triangles: 172,
    tint: 'wall',
    mesh: 'brick-window',
    skin: 'render',
    glass: 'dark',
  },
  {
    id: 'render-lintel',
    source: 'Brick_Window_Trim_Single',
    width: 2,
    height: 3,
    triangles: 408,
    tint: 'wall',
    mesh: 'brick-lintel',
    skin: 'render',
    glass: 'dark',
  },
  {
    id: 'render-wide',
    source: 'Brick_Inset_Window',
    width: 4,
    height: 3,
    triangles: 466,
    tint: 'wall',
    mesh: 'brick-wide',
    skin: 'render',
    glass: 'dark',
  },
  {
    id: 'render-arch',
    source: 'Brick_Inset_Window_Curved',
    width: 4,
    height: 3,
    triangles: 630,
    tint: 'wall',
    mesh: 'brick-arch',
    skin: 'render',
    glass: 'dark',
  },
  {
    id: 'render-cornice',
    source: 'Cornice_Brick_Center',
    width: 2,
    height: 1,
    triangles: 6,
    tint: 'wall',
    mesh: 'brick-cornice',
    skin: 'render',
  },
  {
    id: 'render-pilaster',
    source: 'Brick_Column_Small',
    width: 0.5,
    height: 3,
    triangles: 32,
    tint: 'wall',
    mesh: 'brick-pilaster',
    skin: 'render',
  },
  // The kit's cream trim as a wall: stone.
  {
    id: 'stone-plain',
    source: 'Trim_Plain_3',
    width: 2,
    height: 3,
    triangles: 28,
    tint: 'wall',
    wall: [TRIM],
  },
  {
    id: 'stone-window',
    source: 'Trim_Window',
    width: 2,
    height: 3,
    triangles: 556,
    tint: 'wall',
    wall: [TRIM],
    glass: 'dark',
  },
  {
    id: 'stone-pier',
    source: 'Trim_FirstFloor_Wall',
    width: 2,
    height: 3,
    triangles: 44,
    tint: 'wall',
    wall: [TRIM],
  },
  {
    id: 'stone-cornice',
    source: 'Cornice_Trim_Center',
    width: 2,
    height: 1,
    triangles: 112,
    tint: 'trim',
  },
  // Its metal and glass.
  {
    id: 'metal-plain',
    source: 'Metal_Plain_3',
    width: 2,
    height: 3,
    triangles: 12,
    tint: 'wall',
    wall: [METAL],
  },
  {
    id: 'metal-glazing',
    source: 'Metal_FullWindow',
    width: 2,
    height: 3,
    triangles: 208,
    tint: 'wall',
    wall: [METAL],
    glass: 'dark',
  },
  {
    id: 'metal-window',
    source: 'Metal_Window_Half',
    width: 2,
    height: 3,
    triangles: 308,
    tint: 'wall',
    wall: [METAL],
    glass: 'dark',
  },
  {
    id: 'metal-wide',
    source: 'Metal_Window',
    width: 4,
    height: 3,
    triangles: 556,
    tint: 'wall',
    wall: [METAL, 'MI_RedBrick'],
    glass: 'dark',
  },
  {
    id: 'metal-pier',
    source: 'Metal_FirstFloor_Wall',
    width: 2,
    height: 3,
    triangles: 30,
    tint: 'wall',
    wall: [METAL],
  },
  {
    id: 'metal-cornice',
    source: 'Cornice_Metal_Center',
    width: 2,
    height: 1,
    triangles: 26,
    tint: 'wall',
    wall: [METAL],
  },
  {
    id: 'metal-fin',
    source: 'Metal_Column_Small_Center',
    width: 0.5,
    height: 3,
    triangles: 16,
    tint: 'wall',
    wall: [METAL],
  },
  // Shop fronts and doors.
  {
    id: 'timber-storefront',
    source: 'Trim_FirstFloor_Window_001',
    width: 2,
    height: 3,
    triangles: 142,
    tint: 'accent',
    glass: 'lit-1',
  },
  {
    id: 'timber-columns',
    source: 'Trim_FirstFloor_Window_Columns',
    width: 2,
    height: 3,
    triangles: 32,
    tint: 'accent',
  },
  {
    id: 'metal-storefront',
    source: 'Metal_FirstFloor_Window',
    width: 2,
    height: 3,
    triangles: 148,
    tint: 'fixed',
    glass: 'lit-2',
  },
  {
    id: 'shop-glazing',
    source: 'Metal_FullWindow',
    width: 2,
    height: 3,
    triangles: 208,
    tint: 'fixed',
    mesh: 'metal-glazing',
    glass: 'lit-1',
  },
  {
    id: 'metal-door',
    source: 'DoorFrame_Metal_Single',
    width: 2,
    height: 3,
    triangles: 241,
    tint: 'fixed',
    glass: 'dark',
  },
  {
    id: 'wood-door',
    source: 'DoorFrame_Wooden',
    width: 2,
    height: 3,
    triangles: 716,
    tint: 'fixed',
    fixed: [TRIM],
    leaf: 'Door_3',
    glass: 'dark',
  },
  {
    id: 'arch-door',
    source: 'DoorFrame_Trim',
    width: 2,
    height: 3,
    triangles: 818,
    tint: 'trim',
    glass: 'dark',
  },
  // What the kit does not hold: the pipeline's own, and a landing under the kit's railing.
  { id: 'awning', source: '', width: 2, height: 1, triangles: 52, tint: 'accent', made: 'awning' },
  {
    id: 'fascia',
    source: '',
    width: 2,
    height: 0.5,
    triangles: 14,
    tint: 'accent',
    made: 'fascia',
  },
  {
    id: 'balcony',
    source: 'Stairs_Rails_Metal_Straight_1',
    width: 2,
    height: 1.25,
    triangles: 180,
    tint: 'fixed',
    made: 'balcony',
  },
  {
    id: 'ladder',
    source: '',
    width: 0.5,
    height: 3,
    triangles: 132,
    tint: 'fixed',
    made: 'ladder',
  },
  { id: 'roof', source: 'Roof_2x2', width: 2, height: 2, triangles: 2, tint: 'fixed', lies: true },
] as const satisfies readonly KitPiece[];

/** One of {@link KIT_PIECES}' ids. */
export type KitPieceId = (typeof KIT_PIECES)[number]['id'];

/** A piece's place in {@link KIT_PIECES}, by its id. */
export function kitPieceIndex(id: KitPieceId): number {
  return KIT_PIECES.findIndex((piece) => piece.id === id);
}

/** The place in {@link KIT_PIECES} of the piece whose geometry piece `index` wears: its own, or its {@link KitPiece.mesh}'s. */
export function kitMeshIndex(index: number): number {
  const piece: KitPiece | undefined = KIT_PIECES[index];
  if (piece?.mesh === undefined) return index;
  return KIT_PIECES.findIndex((each) => each.id === piece.mesh);
}

/** A card's triangles: **2**, the piece's rectangle on the wall's plane. */
export const KIT_CARD_TRIANGLES = 2;

/** A rectangle of the atlas, pixels from its top-left corner. */
export interface KitCell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where each piece is in the atlas — the cells' CONTENT, without their
 * gutters: {@link KIT_PIXELS_PER_METRE} texels a metre, laid on shelves from
 * the top-left in {@link KIT_PIECES}' order, a shelf as tall as its tallest
 * piece. The pipeline bakes into exactly these (`sources.ts` hands them to
 * the script), and the renderer reads them back through {@link kitCellUv}.
 */
export function kitCells(pieces: readonly KitPiece[] = KIT_PIECES): readonly KitCell[] {
  const cells: KitCell[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const piece of pieces) {
    const width = piece.width * KIT_PIXELS_PER_METRE;
    const height = piece.height * KIT_PIXELS_PER_METRE;
    const slot = width + 2 * KIT_GUTTER_PIXELS;
    if (x + slot > KIT_ATLAS_PIXELS) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    cells.push({ x: x + KIT_GUTTER_PIXELS, y: y + KIT_GUTTER_PIXELS, width, height });
    x += slot;
    shelf = Math.max(shelf, height + 2 * KIT_GUTTER_PIXELS);
  }
  if (y + shelf > KIT_ATLAS_PIXELS) throw new RangeError('the kit does not fit its atlas');
  return cells;
}

/** {@link kitCells} of the committed set. */
export const KIT_CELLS: readonly KitCell[] = kitCells();

/**
 * A piece's cell as texture coordinates, glTF's (0, 0 the picture's top-left
 * corner): `u0, v0` its top-left — the piece's `-width / 2`, its top — and
 * `u1, v1` its bottom-right.
 */
export function kitCellUv(index: number): {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
} {
  const cell = KIT_CELLS[index];
  if (cell === undefined) throw new RangeError('no such kit piece');
  return {
    u0: cell.x / KIT_ATLAS_PIXELS,
    v0: cell.y / KIT_ATLAS_PIXELS,
    u1: (cell.x + cell.width) / KIT_ATLAS_PIXELS,
    v1: (cell.y + cell.height) / KIT_ATLAS_PIXELS,
  };
}

// --- Which footprints -------------------------------------------------------

/** What a wrapped footprint is drawn as. @see kitKindOf */
export type KitKind = 'retail' | 'shop' | 'office' | 'townhouse';

/**
 * The urban classes whose footprints are wrapped: a `town` and a
 * `city-centre` — the owner's direction on #3334, and the classes #3273's
 * `houseStyleOf` calls modern with no traditional share.
 */
export const KIT_URBAN_CLASSES: ReadonlySet<UrbanClass> = new Set(['town', 'city-centre']);

/** The storeys of each kind — the module's table. */
export const KIT_STOREYS = {
  /** A `retail` strip is one storey. */
  retail: 1,
  /** A `shop` is two or three; a commercial footprint above it is an `office`. */
  shopMost: 3,
  /** A `townhouse` is two to four. */
  townhouse: { least: 2, most: 4 },
} as const;

/** What {@link kitKindOf} reads of a footprint. */
export interface KitSetting {
  /** The urban class of the stretch of route it stands beside. */
  readonly urban: UrbanClass;
  /** Whether the land under it is farmland. */
  readonly farmland: boolean;
  /** What it is used for: `footprint-buildings.ts` §`FootprintUse`. */
  readonly use: string;
  readonly storeys: number;
  /** Whether it shares a party wall with a terrace's neighbour (#1635). */
  readonly terraced: boolean;
}

/**
 * What a footprint is wrapped as, by its setting — the module's table; or
 * `undefined`, and it keeps its extrusion.
 */
export function kitKindOf(setting: KitSetting): KitKind | undefined {
  if (setting.farmland || !KIT_URBAN_CLASSES.has(setting.urban)) return undefined;
  if (setting.use === 'commercial') {
    if (setting.storeys <= KIT_STOREYS.retail) return 'retail';
    return setting.storeys <= KIT_STOREYS.shopMost ? 'shop' : 'office';
  }
  if (
    setting.use === 'residential' &&
    setting.terraced &&
    setting.storeys >= KIT_STOREYS.townhouse.least &&
    setting.storeys <= KIT_STOREYS.townhouse.most
  ) {
    return 'townhouse';
  }
  return undefined;
}

// --- What a building looks like ----------------------------------------------

/** What a wrap is walled in — the module's header. */
export type KitSkin = 'brick' | 'render' | 'stone' | 'metal';

/** A window, and how many bays across it is. */
export interface KitWindow {
  readonly piece: KitPieceId;
  readonly span: 1 | 2;
}

/** A skin's pieces. */
export interface KitSkinPieces {
  /** A party wall, the plinth, and a bay too narrow or too wide for a window. */
  readonly plain: KitPieceId;
  /**
   * Its windows. The first is the skin's cheapest, one bay across: what a
   * wall that does not face the street has, and an odd bay beside a wide one.
   */
  readonly windows: readonly KitWindow[];
  /** Its cornices: the first is every wall's that does not face the street. */
  readonly cornices: readonly KitPieceId[];
  /** The ground floor of a commercial wall that does not face the street. */
  readonly pier: KitPieceId;
  /** What stands between its bays, where it has pilasters. */
  readonly pilaster?: KitPieceId;
}

/** Each skin's pieces — the module's table. */
export const KIT_SKINS: Readonly<Record<KitSkin, KitSkinPieces>> = {
  brick: {
    plain: 'brick-plain',
    windows: [
      { piece: 'brick-window', span: 1 },
      { piece: 'brick-lintel', span: 1 },
      { piece: 'brick-tall', span: 1 },
      { piece: 'brick-wide', span: 2 },
      { piece: 'brick-arch', span: 2 },
      { piece: 'brick-quoin', span: 2 },
    ],
    cornices: ['brick-cornice', 'stone-cornice'],
    pier: 'brick-plain',
    pilaster: 'brick-pilaster',
  },
  render: {
    plain: 'render-plain',
    windows: [
      { piece: 'render-window', span: 1 },
      { piece: 'render-lintel', span: 1 },
      { piece: 'render-wide', span: 2 },
      { piece: 'render-arch', span: 2 },
    ],
    cornices: ['render-cornice', 'stone-cornice'],
    pier: 'render-plain',
    pilaster: 'render-pilaster',
  },
  stone: {
    plain: 'stone-plain',
    // The first is the render skin's square sash, which a stone wall's paint suits as well:
    // the kit's one stone window is 556 triangles, and an office front of twenty bays
    // could put a storey and a half of them in relief.
    windows: [
      { piece: 'render-window', span: 1 },
      { piece: 'stone-window', span: 1 },
      { piece: 'render-lintel', span: 1 },
    ],
    cornices: ['stone-cornice'],
    pier: 'stone-pier',
  },
  metal: {
    plain: 'metal-plain',
    windows: [
      { piece: 'metal-glazing', span: 1 },
      { piece: 'metal-window', span: 1 },
      { piece: 'metal-wide', span: 2 },
    ],
    cornices: ['metal-cornice'],
    pier: 'metal-pier',
    pilaster: 'metal-fin',
  },
};

/** A shop front: what fills a bay of the street's ground floor, and its door. */
export interface KitShopfront {
  readonly front: KitPieceId;
  readonly door: KitPieceId;
  /** The columns that stand before each of its bays. */
  readonly columns?: KitPieceId;
}

/** The shop fronts — the module's table: painted timber, metal over a stall riser, glazing to the floor. */
export const KIT_SHOPFRONTS: readonly KitShopfront[] = [
  { front: 'timber-storefront', door: 'wood-door', columns: 'timber-columns' },
  { front: 'metal-storefront', door: 'metal-door' },
  { front: 'shop-glazing', door: 'metal-door' },
];

/** A townhouse's doors, the cheapest first: what a front too dear for the seeded one has. */
export const KIT_HOUSE_DOORS: readonly KitPieceId[] = ['metal-door', 'wood-door', 'arch-door'];

/** What hangs over a shop front. */
export type KitSign = 'none' | 'awning' | 'fascia';

/**
 * The shares the seeded choices are made by — the module's table: a shop
 * with no awning has a sign band six times in ten; pilasters stand up four
 * fronts in ten; a fire escape hangs on one brick front in three of
 * {@link KIT_ESCAPE_STOREYS} or more; an office of no brick is metal six
 * times in ten, and stone otherwise.
 */
export const KIT_SHARES = { fascia: 0.6, pilasters: 0.4, escape: 1 / 3, metalOffice: 0.6 } as const;

/** A fire escape hangs on a front of at least this many storeys: **3**. */
export const KIT_ESCAPE_STOREYS = 3;

/** The seeded streams {@link kitStyleOf} draws from, each its own (`seeded.ts` §`uniformFrom`). */
const STREAM = {
  skin: 0,
  window: 1,
  cornice: 2,
  shopfront: 3,
  door: 4,
  sign: 5,
  pilasters: 6,
  escape: 7,
} as const;

/** What one building is built of. @see kitStyleOf */
export interface KitStyle {
  readonly skin: KitSkin;
  /** The window its street front has, if the front can pay for it: a place in the skin's list. */
  readonly window: number;
  /** The street front's cornice. */
  readonly cornice: KitPieceId;
  /** Its shop front; `undefined` for a townhouse. */
  readonly shopfront: KitShopfront | undefined;
  /** Its door, if the front can pay for it. */
  readonly door: KitPieceId;
  readonly sign: KitSign;
  readonly pilasters: boolean;
  readonly escape: boolean;
}

/** What {@link kitStyleOf} reads of a plan. */
export interface KitStyleInput {
  readonly kind: KitKind;
  /** What its extrusion is walled in: `FootprintPlan.surfaces.wall`. */
  readonly surface: string;
  readonly storeys: number;
  /** A whole number its seeded choices are drawn from, the footprint's own. */
  readonly seed: number;
  /** Whether its extrusion has an awning: `FootprintPlan.shop.awning`. */
  readonly awning: boolean;
}

/** The entry a draw in `[0, 1)` comes to, of `count`. */
function entry(share: number, count: number): number {
  return Math.min(count - 1, Math.floor(share * count));
}

/** The skin of a wall surface: what the extrusion wears, in the kit's terms. */
function skinOf(surface: string): KitSkin {
  if (surface === 'brick') return 'brick';
  if (surface === 'stone' || surface === 'concrete') return 'stone';
  return 'render';
}

/**
 * What a building is built of, seeded from its footprint — the module's
 * header. Two buildings of one kind and one wall differ in their window,
 * their cornice, their shop front, their sign, their pilasters and their
 * fire escape, and every choice is the same on every load.
 */
export function kitStyleOf(input: KitStyleInput): KitStyle {
  const draw = (stream: number): number => uniformFrom(input.seed >>> 0, stream);
  const skin: KitSkin =
    input.kind !== 'office'
      ? skinOf(input.surface)
      : input.surface === 'brick'
        ? 'brick'
        : draw(STREAM.skin) < KIT_SHARES.metalOffice
          ? 'metal'
          : 'stone';
  const pieces = KIT_SKINS[skin];
  const shopfront =
    input.kind === 'townhouse'
      ? undefined
      : input.kind === 'office'
        ? // An office's ground floor is metal and glass, whatever is above it.
          KIT_SHOPFRONTS[1 + entry(draw(STREAM.shopfront), KIT_SHOPFRONTS.length - 1)]
        : KIT_SHOPFRONTS[entry(draw(STREAM.shopfront), KIT_SHOPFRONTS.length)];
  const commercial = input.kind === 'shop' || input.kind === 'retail';
  return {
    skin,
    window: entry(draw(STREAM.window), pieces.windows.length),
    cornice: pieces.cornices[entry(draw(STREAM.cornice), pieces.cornices.length)] as KitPieceId,
    shopfront,
    door:
      shopfront?.door ??
      (KIT_HOUSE_DOORS[entry(draw(STREAM.door), KIT_HOUSE_DOORS.length)] as KitPieceId),
    sign: !commercial
      ? 'none'
      : input.awning
        ? 'awning'
        : draw(STREAM.sign) < KIT_SHARES.fascia
          ? 'fascia'
          : 'none',
    pilasters: pieces.pilaster !== undefined && draw(STREAM.pilasters) < KIT_SHARES.pilasters,
    escape:
      skin === 'brick' &&
      input.kind !== 'office' &&
      input.storeys >= KIT_ESCAPE_STOREYS &&
      draw(STREAM.escape) < KIT_SHARES.escape,
  };
}

// --- Its colours --------------------------------------------------------------

/**
 * The grey the pipeline bakes a neutral class at, linear: **0.8**
 * (`process_downtown_kit.py` §`NEUTRAL_LEVEL`). A colour worn over it is
 * divided by it, so the paint a chart names is the paint drawn.
 */
export const KIT_NEUTRAL_LEVEL = 0.8;

/** The albedo of the white a `render` paint is laid over (`building-paint.ts` §`WALL_PAINTS`): **0.89**. */
const RENDER_WHITE = 0.89;

/**
 * The shades of the kit's brick, a multiplier: a red, buff, a dark brown, a
 * warm orange and a plum. ⚠️ None is the kit's brick as it is: its picture is
 * a dark brown (a linear 0.15, 0.08, 0.06), and beside the photographed brick
 * an extrusion wears a terrace of it read dull (PR #3343's look check), so
 * every shade but the dark one lifts it.
 */
export const KIT_BRICK_SHADES: readonly Rgb[] = [
  [1.45, 1.3, 1.2],
  [1.9, 1.7, 1.4],
  [1, 0.95, 0.95],
  [1.75, 1.3, 1.1],
  [1.35, 1.2, 1.35],
];

/** The stones a `stone` wall is, an albedo: Portland, Bath, buff sandstone, grey limestone. */
export const KIT_STONE_PAINTS: readonly Rgb[] = [
  [0.72, 0.7, 0.62],
  [0.74, 0.62, 0.42],
  [0.6, 0.5, 0.36],
  [0.52, 0.52, 0.5],
];

/** The shades of the kit's metal, a multiplier: as it is, bronze, blue-grey, pale, dark. */
export const KIT_METAL_SHADES: readonly Rgb[] = [
  [1, 1, 1],
  [1.3, 1.05, 0.8],
  [0.8, 0.95, 1.2],
  [1.5, 1.5, 1.45],
  [0.65, 0.65, 0.7],
];

/**
 * The paints a wrap's trim is — its sills, lintels, quoins and moulded
 * cornice: white, cream and grey (`building-paint.ts` §`TRIM_PAINTS`' light
 * three) and a buff stone. Never that list's black, green or navy: those are
 * a painted timber frame's, and a lintel is stone.
 */
export const KIT_TRIM_PAINTS: readonly Rgb[] = [
  TRIM_PAINTS[0] as Rgb,
  TRIM_PAINTS[1] as Rgb,
  TRIM_PAINTS[5] as Rgb,
  [0.66, 0.56, 0.4],
];

/** A building's three colours, each multiplied into its class's vertices. */
export interface KitPalette {
  readonly wall: Rgb;
  readonly trim: Rgb;
  readonly accent: Rgb;
}

/** A list's entry at a seeded place, whatever the place. */
function pick(list: readonly Rgb[], at: number): Rgb {
  return list[Math.abs(Math.trunc(at)) % list.length] ?? [1, 1, 1];
}

/** An albedo as a multiplier over the neutral grey. */
function over(albedo: Rgb, white = 1): Rgb {
  const scale = white / KIT_NEUTRAL_LEVEL;
  return [albedo[0] * scale, albedo[1] * scale, albedo[2] * scale];
}

/**
 * The kit's brick picture, linear: the dark brown {@link KIT_BRICK_SHADES}
 * multiply (their comment's 0.15, 0.08, 0.06).
 */
export const KIT_BRICK_PICTURE: Rgb = [0.15, 0.08, 0.06];

/** Each brick shade as it is drawn: the shade times the picture — #3352. */
const KIT_BRICK_DRAWN: readonly Rgb[] = KIT_BRICK_SHADES.map((shade) => [
  shade[0] * KIT_BRICK_PICTURE[0],
  shade[1] * KIT_BRICK_PICTURE[1],
  shade[2] * KIT_BRICK_PICTURE[2],
]);

/** A skin's own wall list: what {@link kitPaletteOf} picks a wall's colour from. */
function kitWallsOf(skin: KitSkin): readonly Rgb[] {
  return skin === 'brick'
    ? KIT_BRICK_SHADES
    : skin === 'metal'
      ? KIT_METAL_SHADES
      : skin === 'stone'
        ? KIT_STONE_PAINTS
        : (WALL_PAINTS.render ?? []);
}

/**
 * The entry of `skin`'s own wall list nearest a mapped colour — #3352,
 * `building-paint.ts` §`nearestPaint`, each entry compared as it is drawn:
 * a brick shade times the kit's brick picture, a stone as the albedo it is,
 * a render paint over its white, as `building-paint.ts` §`mappedPaintEntry`
 * compares the extrusion's. ⚠️ A metal shade is compared as written, over 1:
 * the kit's metal picture's albedo is written down nowhere, and that is how
 * `building-paint.ts` compares every photograph's shift whose albedo is not.
 */
export function kitWallEntryOf(skin: KitSkin, colour: Rgb): number {
  if (skin === 'brick') return nearestPaint(KIT_BRICK_DRAWN, colour);
  if (skin === 'render') return nearestPaint(kitWallsOf(skin), colour, RENDER_WHITE);
  return nearestPaint(kitWallsOf(skin), colour);
}

/** How many entries `skin`'s own wall list has. */
export function kitWallCount(skin: KitSkin): number {
  return kitWallsOf(skin).length;
}

/**
 * The entry of `wrap`'s skin's wall list its wall is drawn in, for its plan's
 * wall paint `entry` — #3352: {@link KitWrap.wallShade} where it has one, and
 * otherwise the plan's entry, round the list.
 */
export function kitWallShadeOf(
  wrap: { readonly style: { readonly skin: KitSkin }; readonly wallShade?: number },
  entry: number,
): number {
  return (wrap.wallShade ?? Math.abs(Math.trunc(entry))) % kitWallCount(wrap.style.skin);
}

/**
 * A wrap's colours, from its plan's own paints (`FootprintPaint`), so that
 * `paintTown`'s rule — no two neighbours alike — holds for the wrap as for
 * the extrusion: a wall is its skin's shade chosen by its plan's wall entry,
 * so a `render` wall is the very house paint its extrusion wears; or, where
 * the wrap has one, `wallShade` (#3352, {@link KitWrap.wallShade}): a mapped
 * colour's nearest of the skin's own list, which for brick, stone and metal is
 * the kit's own and not the list the extrusion's entry indexes. The trim by its
 * trim's; and a shop front, its awning and its sign band one of the main
 * street's sign paints (`SIGN_PAINTS`), by its door's.
 */
export function kitPaletteOf(
  skin: KitSkin,
  paint: { readonly wall: number; readonly trim: number; readonly door: number },
  wallShade?: number,
): KitPalette {
  const shade = wallShade ?? paint.wall;
  const wall =
    skin === 'brick'
      ? pick(KIT_BRICK_SHADES, shade)
      : skin === 'metal'
        ? pick(KIT_METAL_SHADES, shade)
        : skin === 'stone'
          ? over(pick(KIT_STONE_PAINTS, shade))
          : over(pick(WALL_PAINTS.render ?? [], shade), RENDER_WHITE);
  return {
    wall,
    trim: over(pick(KIT_TRIM_PAINTS, paint.trim)),
    accent: over(pick(SIGN_PAINTS, paint.door)),
  };
}

// --- The wrap ---------------------------------------------------------------

/** A bay, metres: **2**, the kit's own module. */
export const KIT_BAY_METRES = 2;

/** A storey of the kit, metres: **3**, `footprint-buildings.ts` §`STOREY_METRES`. */
export const KIT_STOREY_METRES = 3;

/**
 * How far a piece may be stretched along the wall or up it and still be a
 * window or a shop front: from **0.7** to **1.5** times. Beyond it along the
 * wall the bay is the style's plain piece; beyond it upward the footprint is
 * not wrapped at all.
 */
export const KIT_STRETCH = { least: 0.7, most: 1.5 } as const;

/**
 * An edge faces the street where its outward normal is within 45° of the
 * door edge's: the cosine, as `house-models.ts` §`END_FRONT_COSINE`.
 */
export const KIT_FRONT_COSINE = Math.SQRT1_2;

/** An edge is a party wall where a neighbour shares at least this share of it: **0.5**. */
export const KIT_PARTY_SHARE = 0.5;

/**
 * Where the pieces that hang on a front are, metres: an awning's and a sign
 * band's top this far under the first floor; a pilaster at a front's end this
 * far in from its corner, so that two neighbours' do not stand in one place;
 * a fire escape's ladder this share of a bay off its bay's middle.
 */
export const KIT_HANG = { under: 0.05, pilasterInset: 0.25, ladderAside: 0.3 } as const;

/** No footprint of more storeys than this is wrapped: **40**, past any the map has beside a route. */
export const KIT_STOREYS_MOST = 40;

/**
 * The pieces that hang on a wall and are no bay of it: drawn in relief or not
 * at all, and never as a card.
 */
export const KIT_HUNG: ReadonlySet<KitPieceId> = new Set([
  'awning',
  'fascia',
  'timber-columns',
  'brick-pilaster',
  'render-pilaster',
  'metal-fin',
  'balcony',
  'ladder',
]);

/** A plinth shorter than this is not drawn: **1 cm**. */
const PLINTH_MIN_METRES = 0.01;

/** An edge shorter than this has no bay: **5 cm**. */
const EDGE_MIN_METRES = 0.05;

/** The bays an edge of `length` metres is cut into: its length in {@link KIT_BAY_METRES}, rounded, at least one. */
export function bayCount(length: number): number {
  return Math.max(1, Math.round(length / KIT_BAY_METRES));
}

/**
 * How many floats a run is, in {@link KitWrap.runs}: the piece's place in
 * {@link KIT_PIECES}; 1 in relief, 0 as its card; the middle of its first
 * repeat's foot, `x, y, z`; the unit vector along the wall, `ax, az`, which is
 * where the piece's +X points — its +Z, the wall's outward normal, is
 * `(-az, ax)`, as `house-models.ts` §`HousePlacement`'s; its stretch along the
 * wall and up it; how many times it repeats; and how far along the wall each
 * repeat is from the last, metres.
 */
export const KIT_RUN_FLOATS = 11;

/** A footprint wrapped. @see wrapFootprint */
export interface KitWrap {
  readonly kind: KitKind;
  /** What it is built of, as chosen: {@link kitStyleOf}'s. */
  readonly style: KitStyle;
  /** The window its street front has: the style's, or the richest its budget paid for. */
  readonly window: KitPieceId;
  /** Its door: the style's, or the cheapest where its budget did not pay for that. */
  readonly door: KitPieceId;
  /** Its street front's cornice: the style's, or the skin's plain one, likewise. */
  readonly cornice: KitPieceId;
  /** Its runs, {@link KIT_RUN_FLOATS} floats each. */
  readonly runs: Float32Array;
  /**
   * Its flat roof's triangles: `x, y, z` a vertex, local metres, wound
   * counter-clockwise seen from above.
   */
  readonly roof: Float32Array;
  /** The roof's extent, `minX, minZ, maxX, maxZ`: what its texture coordinates are laid across. */
  readonly roofBounds: readonly [number, number, number, number];
  /** What it costs the frame: every run's triangles and the roof's. */
  readonly triangles: number;
  /** How many of its bays are in relief. */
  readonly relief: number;
  /** How many of its street front's bays are, and how many of those are in relief. */
  readonly front: { readonly bays: number; readonly relief: number };
  /**
   * Which way its door's wall faces, a unit vector in `x, z`: two buildings
   * across a street from each other face opposite ways, which is how
   * `mapped-buildings.ts` shares the frame's wraps between a street's sides.
   */
  readonly facing: readonly [number, number];
  /**
   * How many fronts were laid and priced to plan it: 1 where even the
   * cheapest cannot be wholly in relief, which is every long block of a city
   * street, and what planning a ride costs.
   */
  readonly attempts: number;
  /**
   * #3352: the entry of its skin's own wall list it is walled in, where its
   * plan's wall entry does not choose it: the nearest to its mapped wall
   * colour ({@link kitWallEntryOf}) where its plan's wall paint is one
   * (#1792); or one `footprint-buildings.ts` §`paintTown` moved it to, off a
   * neighbouring wrap's of its skin. `undefined` where the plan's entry, round
   * the list, chooses ({@link kitWallShadeOf}).
   */
  readonly wallShade?: number;
}

/** What {@link wrapFootprint} reads of a plan. */
export interface KitWrapInput extends KitStyleInput {
  /** The outer ring as drawn, `x, z` pairs in local metres, either way round. */
  readonly ring: ArrayLike<number>;
  /** The plinth's foot, the ground floor, and where the walls end, metres. */
  readonly base: number;
  readonly floor: number;
  readonly eaves: number;
  /** How tall its parapet is, which its cornice is stretched to. */
  readonly parapet: number;
  /** The edge its front door is on. */
  readonly frontEdge: number;
  /** How much of each edge a neighbour shares, metres, by the edge's index. */
  readonly shared: ReadonlyMap<number, number>;
  /** The most triangles it may be. */
  readonly budget: number;
  /** #3352: its mapped wall colour, linear, where its plan's wall paint is pinned to one. */
  readonly colour?: Rgb;
}

/** An edge, measured. */
interface Edge {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly ax: number;
  readonly az: number;
  readonly length: number;
  readonly bays: number;
  readonly front: boolean;
  readonly party: boolean;
}

/**
 * One piece on a wall, before it is a run. A bay's is drawn as its card until
 * its row is paid for; one that hangs on the wall (a sign, a pilaster) is not
 * drawn at all until its row is.
 */
interface Placed {
  readonly piece: number;
  readonly edge: Edge;
  /** How far along the edge its middle is, and how far up, metres. */
  readonly along: number;
  readonly y: number;
  readonly stretchX: number;
  readonly stretchY: number;
  /** The row it is paid for with: {@link wrapFootprint}'s order. */
  readonly row: number;
  /** Whether it is a bay of the wall, with a card, or hangs on it. */
  readonly bay: boolean;
  /** Whether it is on an edge facing the street. */
  readonly front: boolean;
  relief: boolean;
}

/** Twice a ring's signed area: positive where it runs counter-clockwise in `x, z`. */
function twiceArea(ring: ArrayLike<number>): number {
  const n = ring.length / 2;
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return twice;
}

/** A piece's triangles in relief, by its place. */
function reliefOf(piece: number): number {
  return (KIT_PIECES[piece] as KitPiece).triangles;
}

/**
 * The rows a wrap is paid for in, nearest the rider's eye first — the
 * module's "One budget a building". The street front's are `door` to
 * `frontTop`, which a window must pay for whole.
 */
const ROW = {
  door: 0,
  frontGround: 1,
  frontCornice: 2,
  /** The street front's storey `s` is row `frontStorey + s`, `s` from 1. */
  frontStorey: 2,
  /** After every storey a wrap can have ({@link KIT_STRETCH} bounds none; 64 is past any). */
  sign: 64,
  columns: 65,
  pilasters: 66,
  escape: 67,
  otherGround: 68,
  otherCornice: 69,
  otherStorey: 69,
} as const;

/** What a front is built with, once {@link wrapFootprint} has tried it against the budget. */
interface Attempt {
  readonly placed: Placed[];
  readonly triangles: number;
  /** Whether the whole street front is in relief, and everything that hangs on it drawn. */
  readonly whole: boolean;
}

/**
 * Wraps a footprint in the kit's pieces — the module's rules — or returns
 * `undefined` where it cannot be: its storeys would be stretched past
 * {@link KIT_STRETCH}, its door's edge is not an edge, or its cards alone
 * pass `budget`.
 */
export function wrapFootprint(input: KitWrapInput): KitWrap | undefined {
  const { ring, base, floor, eaves, storeys, budget } = input;
  const n = ring.length / 2;
  if (n < 3 || storeys < 1 || storeys > KIT_STOREYS_MOST) return undefined;
  if (input.frontEdge < 0 || input.frontEdge >= n) return undefined;
  const stretchY = (eaves - floor) / (storeys * KIT_STOREY_METRES);
  if (!(stretchY >= KIT_STRETCH.least && stretchY <= KIT_STRETCH.most)) return undefined;
  const style = kitStyleOf(input);
  const skin = KIT_SKINS[style.skin];
  const plain = kitPieceIndex(skin.plain);
  // The wall runs so that the piece's +Z, (-az, ax), is the outward normal.
  const outward = twiceArea(ring) > 0 ? 1 : -1;
  const measure = (index: number): Omit<Edge, 'front' | 'party'> => {
    const j = (index + 1) % n;
    const px = ring[index * 2] as number;
    const pz = ring[index * 2 + 1] as number;
    const qx = ring[j * 2] as number;
    const qz = ring[j * 2 + 1] as number;
    const length = Math.hypot(qx - px, qz - pz);
    // Counter-clockwise, the outward normal is (ez, -ex), so the wall runs back along the edge.
    const ax = length > 0 ? ((px - qx) / length) * outward : 1;
    const az = length > 0 ? ((pz - qz) / length) * outward : 0;
    return {
      index,
      x: outward > 0 ? qx : px,
      z: outward > 0 ? qz : pz,
      ax,
      az,
      length,
      bays: bayCount(length),
    };
  };
  const door = measure(input.frontEdge);
  const edges: Edge[] = [];
  for (let index = 0; index < n; index += 1) {
    const edge = measure(index);
    if (!(edge.length >= EDGE_MIN_METRES)) continue;
    const party = (input.shared.get(index) ?? 0) >= KIT_PARTY_SHARE * edge.length;
    // The normals' cosine is the walls' own: both are a quarter turn from their wall.
    const facing = edge.ax * door.ax + edge.az * door.az;
    edges.push({ ...edge, party, front: !party && facing >= KIT_FRONT_COSINE });
  }
  const hasPlinth = floor - base >= PLINTH_MIN_METRES;
  const doorBay = Math.floor((door.bays - 1) / 2);
  const storeyMetres = KIT_STOREY_METRES * stretchY;
  const roofTriangles = n - 2;
  const commercial = input.kind !== 'townhouse';
  const first = skin.windows[0] as KitWindow;
  const plainCornice = skin.cornices[0] as KitPieceId;

  /** Everything the wrap would draw with `window` and `frontCornice` on its front and `doorPiece` in its door's bay. */
  const lay = (window: KitWindow, doorPiece: KitPieceId, frontCornice: KitPieceId): Placed[] => {
    const placed: Placed[] = [];
    for (const edge of edges) {
      const width = edge.length / edge.bays;
      const stretch = width / KIT_BAY_METRES;
      /** A window or a shop front only in a bay it is not stretched out of shape in. */
      const shaped = stretch >= KIT_STRETCH.least && stretch <= KIT_STRETCH.most;
      const own = edge.index === input.frontEdge;
      const put = (
        id: KitPieceId,
        row: number,
        along: number,
        y: number,
        up: number,
        span = 1,
      ): void => {
        const piece = kitPieceIndex(id);
        const kit = KIT_PIECES[piece] as KitPiece;
        // A bay of the wall, or what hangs on it.
        const bay = !KIT_HUNG.has(id);
        placed.push({
          piece,
          edge,
          along,
          y,
          // A bay's piece fills its bay; what hangs on the wall is as wide as a bay where it
          // is the kit's module, and its own width where it is narrower (a pilaster).
          stretchX: bay ? (width * span) / kit.width : kit.width === KIT_BAY_METRES ? stretch : 1,
          stretchY: up,
          row,
          bay,
          front: edge.front,
          relief: false,
        });
      };
      for (let at = 0; at < edge.bays; at += 1) {
        const middle = width * (at + 0.5);
        if (hasPlinth) {
          placed.push({
            piece: plain,
            edge,
            along: middle,
            y: base,
            stretchX: stretch,
            stretchY: (floor - base) / (KIT_PIECES[plain] as KitPiece).height,
            row: edge.front ? ROW.frontGround : ROW.otherGround,
            bay: true,
            front: edge.front,
            relief: false,
          });
        }
        // The ground floor.
        const isDoor = own && at === doorBay;
        const ground: KitPieceId =
          edge.party || !shaped
            ? skin.plain
            : isDoor
              ? doorPiece
              : !commercial
                ? first.piece
                : edge.front
                  ? (style.shopfront as KitShopfront).front
                  : skin.pier;
        put(
          ground,
          isDoor ? ROW.door : edge.front ? ROW.frontGround : ROW.otherGround,
          middle,
          floor,
          stretchY,
        );
        // The cornice: the front's on the street, the skin's own elsewhere.
        const cornice = edge.front ? frontCornice : plainCornice;
        put(
          cornice,
          edge.front ? ROW.frontCornice : ROW.otherCornice,
          middle,
          eaves,
          input.parapet / (KIT_PIECES[kitPieceIndex(cornice)] as KitPiece).height,
        );
      }
      // The upper storeys: the front's window in pairs where it is two bays across.
      for (let storey = 1; storey < storeys; storey += 1) {
        const y = floor + storey * storeyMetres;
        const row = (edge.front ? ROW.frontStorey : ROW.otherStorey) + storey;
        const chosen = edge.front ? window : first;
        for (let at = 0; at < edge.bays;) {
          const span = chosen.span === 2 && at + 1 < edge.bays ? 2 : 1;
          const id =
            edge.party || !shaped ? skin.plain : span === chosen.span ? chosen.piece : first.piece;
          put(id, row, width * (at + span / 2), y, stretchY, edge.party || !shaped ? 1 : span);
          at += edge.party || !shaped ? 1 : span;
        }
      }
      if (!own || edge.party || !shaped) continue;
      // What hangs on the door's edge.
      if (style.sign !== 'none') {
        const sign = KIT_PIECES[kitPieceIndex(style.sign)] as KitPiece;
        for (let at = 0; at < edge.bays; at += 1) {
          put(
            style.sign,
            ROW.sign,
            width * (at + 0.5),
            floor + storeyMetres - KIT_HANG.under - sign.height,
            1,
          );
        }
      }
      const columns = style.shopfront?.columns;
      if (columns !== undefined) {
        for (let at = 0; at < edge.bays; at += 1) {
          if (at !== doorBay) put(columns, ROW.columns, width * (at + 0.5), floor, stretchY);
        }
      }
      if (style.pilasters && skin.pilaster !== undefined) {
        // Up the storeys that are wall: a shop front has its own columns.
        for (let storey = commercial ? 1 : 0; storey < storeys; storey += 1) {
          for (let at = 0; at <= edge.bays; at += 1) {
            const along =
              at === 0
                ? KIT_HANG.pilasterInset
                : at === edge.bays
                  ? edge.length - KIT_HANG.pilasterInset
                  : width * at;
            put(skin.pilaster, ROW.pilasters, along, floor + storey * storeyMetres, stretchY);
          }
        }
      }
      if (style.escape && edge.bays >= 2) {
        const at = doorBay + 1 < edge.bays ? doorBay + 1 : doorBay - 1;
        for (let storey = 1; storey < storeys; storey += 1) {
          const y = floor + storey * storeyMetres;
          put('balcony', ROW.escape, width * (at + 0.5), y, 1);
          if (storey + 1 < storeys) {
            put('ladder', ROW.escape, width * (at + 0.5 + KIT_HANG.ladderAside), y, stretchY);
          }
        }
      }
    }
    return placed;
  };

  /** Pays for `placed`'s rows in order, each whole or not at all. */
  const pay = (placed: Placed[]): Attempt | undefined => {
    let triangles = roofTriangles;
    for (const each of placed) if (each.bay) triangles += KIT_CARD_TRIANGLES;
    if (triangles > budget) return undefined;
    const rows = new Map<number, Placed[]>();
    for (const each of placed) {
      const row = rows.get(each.row);
      if (row === undefined) rows.set(each.row, [each]);
      else row.push(each);
    }
    let whole = true;
    for (const row of [...rows.keys()].sort((a, b) => a - b)) {
      const members = rows.get(row) as Placed[];
      let more = 0;
      for (const each of members) {
        more += reliefOf(each.piece) - (each.bay ? KIT_CARD_TRIANGLES : 0);
      }
      if (triangles + more > budget) {
        if (row < ROW.otherGround) whole = false;
        continue;
      }
      triangles += more;
      for (const each of members) each.relief = true;
    }
    return { placed, triangles, whole };
  };

  // The cheapest of all three FIRST: where even that cannot put the whole front in relief
  // nothing can, and the front is settled in one attempt (PR #3343's review: a street of
  // long blocks laid twenty-eight fronts each to learn it, and planning a city street went
  // from 155 ms to 896 ms). Where it can, the seeded door, cornice and window, then whatever
  // puts the WHOLE front in relief giving up the least: a cheaper window before the plain
  // cornice, and that before the cheapest door.
  const cheapestDoor = KIT_HOUSE_DOORS[0] as KitPieceId;
  let attempts = 1;
  const cheapest = pay(lay(first, cheapestDoor, plainCornice));
  if (cheapest === undefined) return undefined;
  let taken: { attempt: Attempt; window: KitWindow; door: KitPieceId; cornice: KitPieceId } = {
    attempt: cheapest,
    window: first,
    door: cheapestDoor,
    cornice: plainCornice,
  };
  if (cheapest.whole) {
    const byCost = [...skin.windows].sort(
      (a, b) =>
        reliefOf(kitPieceIndex(b.piece)) / b.span - reliefOf(kitPieceIndex(a.piece)) / a.span,
    );
    const windows = [skin.windows[style.window] as KitWindow, ...byCost];
    search: for (const doorPiece of new Set([style.door, cheapestDoor])) {
      for (const cornice of new Set([style.cornice, plainCornice])) {
        for (const window of windows) {
          // The cheapest of all three is the one already laid.
          if (window === first && doorPiece === cheapestDoor && cornice === plainCornice) {
            break search;
          }
          attempts += 1;
          const attempt = pay(lay(window, doorPiece, cornice));
          if (attempt?.whole === true) {
            taken = { attempt, window, door: doorPiece, cornice };
            break search;
          }
        }
      }
    }
  }

  // What is drawn, in the order it was laid; neighbours of one piece, level and line: one run.
  const drawn = taken.attempt.placed
    .filter((each) => each.bay || each.relief)
    .sort(
      (a, b) =>
        a.edge.index - b.edge.index ||
        a.y - b.y ||
        a.row - b.row ||
        a.piece - b.piece ||
        a.along - b.along,
    );
  const runs: number[] = [];
  let open: Placed | undefined;
  let relief = 0;
  let frontBays = 0;
  let frontRelief = 0;
  for (const each of drawn) {
    if (each.bay && each.relief) relief += 1;
    if (each.bay && each.front) {
      frontBays += 1;
      if (each.relief) frontRelief += 1;
    }
    const pitch = open === undefined ? 0 : each.along - open.along;
    const count = runs[runs.length - 2] as number;
    if (
      open !== undefined &&
      open.edge === each.edge &&
      open.piece === each.piece &&
      open.relief === each.relief &&
      open.row === each.row &&
      open.y === each.y &&
      open.stretchX === each.stretchX &&
      open.stretchY === each.stretchY &&
      pitch > 0 &&
      (count === 1 || Math.abs(pitch - (runs[runs.length - 1] as number)) < 1e-6)
    ) {
      runs[runs.length - 2] = count + 1;
      runs[runs.length - 1] = pitch;
      open = each;
      continue;
    }
    open = each;
    const { edge } = each;
    runs.push(
      each.piece,
      each.relief ? 1 : 0,
      edge.x + edge.ax * each.along,
      each.y,
      edge.z + edge.az * each.along,
      edge.ax,
      edge.az,
      each.stretchX,
      each.stretchY,
      1,
      0,
    );
  }

  // The flat roof, at the eaves, wound to face up.
  const outline = Float32Array.from(ring);
  const indices = triangulate({ rings: [outline] });
  const roof = new Float32Array(indices.length * 3);
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = indices[at] as number;
    let b = indices[at + 1] as number;
    let c = indices[at + 2] as number;
    const bx = (outline[b * 2] as number) - (outline[a * 2] as number);
    const bz = (outline[b * 2 + 1] as number) - (outline[a * 2 + 1] as number);
    const cx = (outline[c * 2] as number) - (outline[a * 2] as number);
    const cz = (outline[c * 2 + 1] as number) - (outline[a * 2 + 1] as number);
    // The normal's y of (b - a) × (c - a): up where it is positive.
    if (bz * cx - bx * cz < 0) [b, c] = [c, b];
    [a, b, c].forEach((vertex, corner) => {
      roof[(at + corner) * 3] = outline[vertex * 2] as number;
      roof[(at + corner) * 3 + 1] = eaves;
      roof[(at + corner) * 3 + 2] = outline[vertex * 2 + 1] as number;
    });
  }
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    minX = Math.min(minX, outline[i * 2] as number);
    maxX = Math.max(maxX, outline[i * 2] as number);
    minZ = Math.min(minZ, outline[i * 2 + 1] as number);
    maxZ = Math.max(maxZ, outline[i * 2 + 1] as number);
  }
  return {
    kind: input.kind,
    style,
    window: taken.window.piece,
    door: taken.door,
    cornice: taken.cornice,
    runs: Float32Array.from(runs),
    roof,
    roofBounds: [minX, minZ, maxX, maxZ],
    // The triangulation's own count, where it is not the outline's n - 2.
    triangles: taken.attempt.triangles - roofTriangles + indices.length / 3,
    relief,
    front: { bays: frontBays, relief: frontRelief },
    // The wall's outward normal: its piece's +Z, (-az, ax).
    facing: [-door.az, door.ax],
    attempts,
    ...(input.colour === undefined ? {} : { wallShade: kitWallEntryOf(style.skin, input.colour) }),
  };
}

/**
 * Where a piece's point stands in repeat `bay` of a run — the transform the
 * belt writes every vertex through, here so a test can hold the belt to it.
 * `run` is the run's first float in `runs`.
 */
export function kitPlacedPoint(
  runs: Float32Array,
  run: number,
  bay: number,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] {
  const ax = runs[run + 5] as number;
  const az = runs[run + 6] as number;
  const along = x * (runs[run + 7] as number) + bay * (runs[run + 10] as number);
  return [
    (runs[run + 2] as number) + along * ax - z * az,
    (runs[run + 3] as number) + y * (runs[run + 8] as number),
    (runs[run + 4] as number) + along * az + z * ax,
  ];
}

/** A piece's triangles as the belt copies them: not indexed, three floats a vertex. */
export interface KitGeometry {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  /** Each vertex's place in {@link KIT_TINT_CLASSES}. */
  readonly tint: Uint8Array;
  readonly triangles: number;
}

/**
 * Where the wall-plane point `(x, y)` of a piece is in its cell — the
 * projection the pipeline wrote the relief's texture coordinates by
 * (`process_downtown_kit.py`, step 4), a point outside the bay's rectangle
 * taken to its edge.
 */
export function kitProjectedUv(index: number, x: number, y: number): readonly [number, number] {
  const piece = KIT_PIECES[index];
  if (piece === undefined) throw new RangeError('no such kit piece');
  const { u0, v0, u1, v1 } = kitCellUv(index);
  const along = Math.min(1, Math.max(0, x / piece.width + 0.5));
  const up = Math.min(1, Math.max(0, y / piece.height));
  return [u0 + along * (u1 - u0), v1 - up * (v1 - v0)];
}

/**
 * Piece `index` in relief, from the geometry of the piece whose mesh it wears
 * ({@link kitMeshIndex}): that geometry itself where the mesh is its own, and
 * otherwise the same triangles mapped into this piece's own cell, by the
 * projection the pipeline baked the cell by.
 */
export function kitSkinned(index: number, mesh: KitGeometry): KitGeometry {
  if (kitMeshIndex(index) === index) return mesh;
  const uv = new Float32Array(mesh.uv.length);
  for (let vertex = 0; vertex * 2 < uv.length; vertex += 1) {
    const [u, v] = kitProjectedUv(
      index,
      mesh.position[vertex * 3] as number,
      mesh.position[vertex * 3 + 1] as number,
    );
    uv[vertex * 2] = u;
    uv[vertex * 2 + 1] = v;
  }
  return { ...mesh, uv };
}

/**
 * A piece's card: its bay's rectangle on the wall's plane, facing out (+Z),
 * {@link KIT_CARD_TRIANGLES} triangles wearing the whole of its cell, every
 * vertex the piece's own {@link KitPiece.tint}.
 */
export function kitCardOf(index: number): KitGeometry {
  const piece: KitPiece | undefined = KIT_PIECES[index];
  if (piece === undefined) throw new RangeError('no such kit piece');
  const half = piece.width / 2;
  const corners: readonly (readonly [number, number])[] = [
    [-half, 0],
    [half, 0],
    [half, piece.height],
    [-half, 0],
    [half, piece.height],
    [-half, piece.height],
  ];
  const position = new Float32Array(corners.length * 3);
  const normal = new Float32Array(corners.length * 3);
  const uv = new Float32Array(corners.length * 2);
  corners.forEach(([x, y], vertex) => {
    position[vertex * 3] = x;
    position[vertex * 3 + 1] = y;
    normal[vertex * 3 + 2] = 1;
    const [u, v] = kitProjectedUv(index, x, y);
    uv[vertex * 2] = u;
    uv[vertex * 2 + 1] = v;
  });
  const tint = new Uint8Array(corners.length).fill(KIT_TINT_CLASSES.indexOf(piece.tint));
  return { position, normal, uv, tint, triangles: KIT_CARD_TRIANGLES };
}
