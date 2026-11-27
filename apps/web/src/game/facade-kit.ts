// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A mapped footprint wrapped in modular facade pieces — #3334, the owner's
 * direction of 2026-11-26 on it: *build this with Quaternius's Downtown City
 * MegaKit; it is modular, so wrap mapped footprints on town and city-centre
 * streets with facade pieces: storefronts on the ground floor, upper floors,
 * cornice. Do not place pre-built blocks that ignore the map.*
 *
 * The kit is CC0 (`ASSETS.toml`, ADR 0099 D-1). Twelve of its pieces are
 * taken ({@link KIT_PIECES}); `tools/realistic/blender/process_downtown_kit.py`
 * writes them into one GLB, each mapped into one colour atlas, so every
 * wrapped building drawn is one draw call between them.
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
 * | commercial, one storey | `retail`: a metal and glass shop front, a metal parapet |
 * | commercial, two or three storeys | `shop`: a stone shop front under brick upper floors |
 * | commercial, four storeys or more | `office`: a metal and glass front, floor after floor |
 * | residential, in a terrace, two to four storeys | `townhouse`: brick, a window a bay |
 *
 * Every other footprint keeps its extrusion (or its house model): a detached
 * house, a block of flats, a civic or industrial building, a part.
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
 *   edge) has the style's shop front on its ground floor, and the door's edge
 *   a door in its middle bay;
 * - every other edge has the style's solid ground floor;
 * - upper storeys have the style's window on every edge;
 * - a **party wall** — an edge mostly shared with a neighbour — is plain;
 * - a plinth of the plain piece from the plan's foot to its floor, so a wrap
 *   on falling ground stands in it as an extrusion does;
 * - a cornice a bay at the eaves, as tall as the extrusion's parapet;
 * - a flat roof at the eaves, the outline triangulated.
 *
 * ## Two levels a piece, one budget a building
 *
 * A piece is drawn either in **relief**, its own geometry (2 to 308
 * triangles), or as its **card**: two triangles on the wall's plane wearing
 * the same cell of the atlas, which the pipeline baked looking straight at
 * the piece. The texture coordinates of the relief are that same projection,
 * so the two agree texel for texel.
 *
 * ⚠️ **A wrapped building holds the structure class's ceiling**,
 * `realistic-budget.ts` §`REALISTIC_TRIANGLES.structure`, 640 — ADR 0099
 * D-4.1: *"a new model takes a class that exists and holds that class's
 * ceiling"*. It replaces an extrusion of at most 640 in the frame's pooled
 * 23 040, so a street of wraps can never draw fewer buildings than the same
 * street of extrusions did. Every bay starts as a card; then, while the
 * budget allows, bays are raised to relief nearest the rider's eye first: the
 * door, the ground floor of the street front outward from it, the front's
 * cornice, then the front's upper storeys from the first up. A footprint
 * whose cards alone pass the budget keeps its extrusion.
 *
 * Pure, and names no rendering library. No coordinate is formatted into any
 * string here.
 */

import { triangulate } from '@onyourleft/map-features';

import type { UrbanClass } from './urban-class';

/** The atlas's side, pixels: **1024**. */
export const KIT_ATLAS_PIXELS = 1024;

/** A piece's texels a metre, in the atlas: **80**, 1.25 cm a texel. */
export const KIT_PIXELS_PER_METRE = 80;

/**
 * The gutter round each piece's cell, pixels: **8**, which the bake's margin
 * fills with the cell's own edge, so a mipmap three levels down does not reach
 * a neighbour.
 */
export const KIT_GUTTER_PIXELS = 8;

/** One piece of the kit taken. */
export interface KitPiece {
  readonly id: string;
  /** Its name in the kit: `<source>.gltf` under the archive's glTF export. */
  readonly source: string;
  /** Its extent along the wall and up it, metres. */
  readonly width: number;
  readonly height: number;
  /** Its triangles in relief, as the pipeline reported them. Its card is {@link KIT_CARD_TRIANGLES}. */
  readonly triangles: number;
  /**
   * Whether the kit models it lying flat (the roof): the pipeline stands it
   * up to bake it, and nothing draws it in relief.
   */
  readonly lies?: true;
}

/**
 * The twelve pieces taken, as `process_downtown_kit.py` reported them on
 * 2026-11-27 — held to the committed GLB by `facade-kit.test.ts`. Their
 * order is their place in the atlas ({@link kitCell}) and in the GLB.
 *
 * Each piece's `triangles` is what is left once the pipeline has dropped the
 * faces nobody outside sees (the kit's `MI_InteriorWall` and
 * `MI_FakeInterior`): 1 133 between the twelve, of the kit's own 1 205
 * (`tools/realistic/sources.ts` §`EXPECTED_REPORTS`).
 */
export const KIT_PIECES = [
  { id: 'brick-plain', source: 'Brick_Plain_3', width: 2, height: 3, triangles: 2 },
  { id: 'brick-window', source: 'Brick_Window_Square_Single', width: 2, height: 3, triangles: 172 },
  {
    id: 'stone-storefront',
    source: 'Trim_FirstFloor_Window_001',
    width: 2,
    height: 3,
    triangles: 142,
  },
  { id: 'stone-pier', source: 'Trim_FirstFloor_Wall', width: 2, height: 3, triangles: 44 },
  {
    id: 'metal-storefront',
    source: 'Metal_FirstFloor_Window',
    width: 2,
    height: 3,
    triangles: 148,
  },
  { id: 'metal-pier', source: 'Metal_FirstFloor_Wall', width: 2, height: 3, triangles: 30 },
  { id: 'metal-door', source: 'DoorFrame_Metal_Single', width: 2, height: 3, triangles: 241 },
  { id: 'metal-window', source: 'Metal_Window_Half', width: 2, height: 3, triangles: 308 },
  { id: 'metal-plain', source: 'Metal_Plain_3', width: 2, height: 3, triangles: 12 },
  { id: 'brick-cornice', source: 'Cornice_Brick_Center', width: 2, height: 1, triangles: 6 },
  { id: 'metal-cornice', source: 'Cornice_Metal_Center', width: 2, height: 1, triangles: 26 },
  { id: 'roof', source: 'Roof_2x2', width: 2, height: 2, triangles: 2, lies: true },
] as const satisfies readonly KitPiece[];

/** One of {@link KIT_PIECES}' ids. */
export type KitPieceId = (typeof KIT_PIECES)[number]['id'];

/** A piece's place in {@link KIT_PIECES}, by its id. */
export function kitPieceIndex(id: KitPieceId): number {
  return KIT_PIECES.findIndex((piece) => piece.id === id);
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

/** The pieces one kind is built of. */
export interface KitStyle {
  /** The ground floor of an edge facing the street. */
  readonly front: KitPieceId;
  /** The door, in the middle bay of the door's edge. */
  readonly door: KitPieceId;
  /** The ground floor of every other edge. */
  readonly ground: KitPieceId;
  /** Every upper storey. */
  readonly upper: KitPieceId;
  /** A party wall, the plinth, and a bay too narrow or too wide for a window. */
  readonly plain: KitPieceId;
  readonly cornice: KitPieceId;
}

/** Each kind's pieces — the module's table. */
export const KIT_STYLES: Readonly<Record<KitKind, KitStyle>> = {
  retail: {
    front: 'metal-storefront',
    door: 'metal-door',
    ground: 'brick-plain',
    upper: 'brick-plain',
    plain: 'brick-plain',
    cornice: 'metal-cornice',
  },
  shop: {
    front: 'stone-storefront',
    door: 'metal-door',
    ground: 'stone-pier',
    upper: 'brick-window',
    plain: 'brick-plain',
    cornice: 'brick-cornice',
  },
  office: {
    front: 'metal-storefront',
    door: 'metal-door',
    ground: 'metal-pier',
    upper: 'metal-window',
    plain: 'metal-plain',
    cornice: 'metal-cornice',
  },
  townhouse: {
    front: 'brick-window',
    door: 'metal-door',
    ground: 'brick-window',
    upper: 'brick-window',
    plain: 'brick-plain',
    cornice: 'brick-cornice',
  },
};

/**
 * The shades a wrap's pieces are multiplied by, a colour a vertex — #3334: the
 * kit's own brick and stone as they are, then buff, dark, warm and cool. The
 * atlas is one picture of one brick, so without them a terrace of wraps reads
 * as one long building (seen on the realistic page's `town=terrace`,
 * 2026-11-27); a plan's shade is chosen by its wall paint, which `paintTown`
 * keeps off its neighbours'. Within a half of 1 on purpose: a lighter or a
 * darker brick, never a paint.
 */
export const KIT_PAINTS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1.4, 1.28, 1.1],
  [0.72, 0.68, 0.68],
  [1.25, 0.98, 0.9],
  [0.95, 1.02, 1.14],
];

/** The shade a plan's wrap wears, by its wall paint's place in its list (`FootprintPaint.wall`). */
export function kitPaintOf(wall: number): readonly [number, number, number] {
  return KIT_PAINTS[Math.abs(Math.trunc(wall)) % KIT_PAINTS.length] ?? [1, 1, 1];
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
 * bay's foot, `x, y, z`; the unit vector along the wall, `ax, az`, which is
 * where the piece's +X points — its +Z, the wall's outward normal, is
 * `(-az, ax)`, as `house-models.ts` §`HousePlacement`'s; its stretch along the
 * wall and up it; and how many bays it runs, each a bay further along.
 */
export const KIT_RUN_FLOATS = 10;

/** A footprint wrapped. @see wrapFootprint */
export interface KitWrap {
  readonly kind: KitKind;
  /** Its runs of bays, {@link KIT_RUN_FLOATS} floats each. */
  readonly runs: Float32Array;
  /**
   * Its flat roof's triangles: `x, y, z` a vertex, local metres, wound
   * counter-clockwise seen from above.
   */
  readonly roof: Float32Array;
  /** The roof's extent, `minX, minZ, maxX, maxZ`: what its texture coordinates are laid across. */
  readonly roofBounds: readonly [number, number, number, number];
  /** What it costs the frame: every bay's triangles and the roof's. */
  readonly triangles: number;
  /** How many of its bays are in relief. */
  readonly relief: number;
}

/** What {@link wrapFootprint} reads of a plan. */
export interface KitWrapInput {
  readonly kind: KitKind;
  /** The outer ring as drawn, `x, z` pairs in local metres, either way round. */
  readonly ring: ArrayLike<number>;
  /** The plinth's foot, the ground floor, and where the walls end, metres. */
  readonly base: number;
  readonly floor: number;
  readonly eaves: number;
  readonly storeys: number;
  /** How tall its parapet is, which its cornice is stretched to. */
  readonly parapet: number;
  /** The edge its front door is on. */
  readonly frontEdge: number;
  /** How much of each edge a neighbour shares, metres, by the edge's index. */
  readonly shared: ReadonlyMap<number, number>;
  /** The most triangles it may be. */
  readonly budget: number;
}

/** One bay, before it is a run. */
interface Bay {
  readonly edge: number;
  /** -1 the plinth, 0 the ground floor, then up; `storeys` the cornice. */
  readonly storey: number;
  readonly at: number;
  piece: number;
  relief: boolean;
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

/**
 * Wraps a footprint in the kit's pieces — the module's rules — or returns
 * `undefined` where it cannot be: its storeys would be stretched past
 * {@link KIT_STRETCH}, its door's edge is not an edge, or its cards alone
 * pass `budget`.
 */
export function wrapFootprint(input: KitWrapInput): KitWrap | undefined {
  const { ring, base, floor, eaves, storeys, budget } = input;
  const n = ring.length / 2;
  if (n < 3 || storeys < 1 || input.frontEdge < 0 || input.frontEdge >= n) return undefined;
  const stretchY = (eaves - floor) / (storeys * KIT_STOREY_METRES);
  if (!(stretchY >= KIT_STRETCH.least && stretchY <= KIT_STRETCH.most)) return undefined;
  const style = KIT_STYLES[input.kind];
  const piece = {
    front: kitPieceIndex(style.front),
    door: kitPieceIndex(style.door),
    ground: kitPieceIndex(style.ground),
    upper: kitPieceIndex(style.upper),
    plain: kitPieceIndex(style.plain),
    cornice: kitPieceIndex(style.cornice),
  };
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
  const plinth = floor - base >= PLINTH_MIN_METRES;
  const bays: Bay[] = [];
  /** A window or a shop front only in a bay it is not stretched out of shape in. */
  const shaped = (edge: Edge, wanted: number): number => {
    const stretch = edge.length / edge.bays / KIT_BAY_METRES;
    return stretch >= KIT_STRETCH.least && stretch <= KIT_STRETCH.most ? wanted : piece.plain;
  };
  for (const edge of edges) {
    const doorAt = edge.index === input.frontEdge ? Math.floor((edge.bays - 1) / 2) : -1;
    for (let at = 0; at < edge.bays; at += 1) {
      if (plinth)
        bays.push({ edge: edge.index, storey: -1, at, piece: piece.plain, relief: false });
      for (let storey = 0; storey < storeys; storey += 1) {
        const wanted = edge.party
          ? piece.plain
          : storey > 0
            ? piece.upper
            : at === doorAt
              ? piece.door
              : edge.front
                ? piece.front
                : piece.ground;
        bays.push({ edge: edge.index, storey, at, piece: shaped(edge, wanted), relief: false });
      }
      bays.push({ edge: edge.index, storey: storeys, at, piece: piece.cornice, relief: false });
    }
  }
  const roofTriangles = n - 2;
  let triangles = bays.length * KIT_CARD_TRIANGLES + roofTriangles;
  if (triangles > budget) return undefined;

  // Raised to relief while the budget allows, nearest the rider's eye first.
  const byEdge = new Map(edges.map((edge) => [edge.index, edge]));
  const doorBay = Math.floor((door.bays - 1) / 2);
  const rank = (bay: Bay): number => {
    const edge = byEdge.get(bay.edge) as Edge;
    if (!edge.front || bay.storey < 0) return Number.POSITIVE_INFINITY;
    const own = bay.edge === input.frontEdge;
    // The door's edge before any other front, and outward from the door along it.
    const along = own ? Math.abs(bay.at - doorBay) : door.bays + bay.at;
    // The ground floor, then the cornice, then each upper storey from the first.
    const level = bay.storey === 0 ? 0 : bay.storey === storeys ? 1 : 1 + bay.storey;
    return level * 1024 + along;
  };
  const ranked = bays
    .map((bay, index) => ({ bay, index, rank: rank(bay) }))
    .filter((each) => Number.isFinite(each.rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  let relief = 0;
  for (const { bay } of ranked) {
    const kit = KIT_PIECES[bay.piece] as KitPiece;
    const more = kit.triangles - KIT_CARD_TRIANGLES;
    if (more <= 0 || triangles + more > budget) continue;
    bay.relief = true;
    triangles += more;
    relief += 1;
  }

  // Bays beside each other, on one edge and storey, in one piece and level: one run.
  const runs: number[] = [];
  let open: Bay | undefined;
  for (const bay of [...bays].sort(
    (a, b) => a.edge - b.edge || a.storey - b.storey || a.at - b.at,
  )) {
    if (
      open !== undefined &&
      open.edge === bay.edge &&
      open.storey === bay.storey &&
      open.piece === bay.piece &&
      open.relief === bay.relief
    ) {
      runs[runs.length - 1] = (runs[runs.length - 1] as number) + 1;
      continue;
    }
    open = bay;
    const edge = byEdge.get(bay.edge) as Edge;
    const width = edge.length / edge.bays;
    const kit = KIT_PIECES[bay.piece] as KitPiece;
    const [y, up] =
      bay.storey < 0
        ? [base, (floor - base) / kit.height]
        : bay.storey === storeys
          ? [eaves, input.parapet / kit.height]
          : [floor + bay.storey * KIT_STOREY_METRES * stretchY, stretchY];
    runs.push(
      bay.piece,
      bay.relief ? 1 : 0,
      edge.x + edge.ax * width * (bay.at + 0.5),
      y,
      edge.z + edge.az * width * (bay.at + 0.5),
      edge.ax,
      edge.az,
      width / kit.width,
      up,
      1,
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
    runs: Float32Array.from(runs),
    roof,
    roofBounds: [minX, minZ, maxX, maxZ],
    // The triangulation's own count, where it is not the outline's n - 2.
    triangles: triangles - roofTriangles + indices.length / 3,
    relief,
  };
}

/**
 * Where a piece's point stands in bay `bay` of a run — the transform the belt
 * writes every vertex through, here so a test can hold the belt to it. `run`
 * is the run's first float in `runs`.
 */
export function kitPlacedPoint(
  runs: Float32Array,
  run: number,
  bay: number,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] {
  const piece = KIT_PIECES[runs[run] as number] as KitPiece;
  const ax = runs[run + 5] as number;
  const az = runs[run + 6] as number;
  const stretchX = runs[run + 7] as number;
  const along = x * stretchX + bay * piece.width * stretchX;
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
 * A piece's card: its bay's rectangle on the wall's plane, facing out (+Z),
 * {@link KIT_CARD_TRIANGLES} triangles wearing the whole of its cell.
 */
export function kitCardOf(index: number): KitGeometry {
  const piece = KIT_PIECES[index];
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
  return { position, normal, uv, triangles: KIT_CARD_TRIANGLES };
}
