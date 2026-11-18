// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a golf course and a cemetery are drawn WITH — #2685, round two. The
 * owner held PR #2689 on 2026-11-16: in the before/after screenshots the
 * cemetery was barely visible and the golf course showed no difference, so
 * each must "read clearly from the bike at riding distance". Planting alone
 * (`scatter.ts` §`parkPlanting`) could not do that; this file adds what the
 * two look like on the ground and what stands on it.
 *
 * ## The golf course
 *
 * - **Fairways and rough**: mown, striped fairway in broad lanes with rough
 *   between them, and **greens** — a close-mown disc, a fringe round it, on
 *   fairway — each with a **flag** on a pole, and **sand bunkers** beside it.
 *   Bunkers are also drawn **where the map has them**: a `sand` polygon
 *   inside the course ({@link SAND_KINDS}).
 * - **A flag at every green the ground paints**, as far as the window reaches
 *   — the owner's ruling of 2026-11-16: from four public roads beside public
 *   courses the nearest green was 165 to 377 m away while flags were drawn
 *   only within 150 m, so nothing showed. Past
 *   {@link FLAG_TRUE_SIZE_METRES} a flag is its far form: the same flag
 *   scaled with distance, so it keeps the size on screen it has there
 *   ({@link flagScaleAt}).
 * - A green stands on a {@link GOLF_GREEN_CELL_METRES} grid, one at most a
 *   square, seeded, and only where the course is all round it, away from the
 *   road, and off every stand of trees (`scatter.ts` §`golfStandAt`), so no
 *   tree stands on a green.
 *
 * ## The cemetery
 *
 * - **Rows of headstones**: upright slabs, low ledgers and a few obelisks, on
 *   a grid of {@link HEADSTONE_ROW_METRES} rows and {@link HEADSTONE_PITCH_METRES}
 *   slots, the rows running north and south and the stones facing east, as a
 *   churchyard's traditionally do. Every {@link HEADSTONE_PATH_ROWS}th row is
 *   left for a **gravel path**, and so is every {@link HEADSTONE_CROSS_SLOTS}th
 *   pair of slots across them. Since the owner's ruling of 2026-11-16 a path
 *   is {@link HEADSTONE_PATH_WIDTH_METRES} wide down the middle of the row or
 *   slots left for it, in a gravel toned toward the grass, and none is drawn
 *   within {@link CEMETERY_PATH_ROAD_CLEARANCE_METRES} of the road: before,
 *   the nearest path was a bright band the row's full width up to the kerb.
 * - A **low stone wall** along the cemetery's mapped outline, broken where the
 *   road comes within {@link CEMETERY_WALL_ROAD_CLEARANCE_METRES}.
 *
 * ## How it reaches the screen
 *
 * Two halves, both in {@link ParkDressingInView}:
 *
 * - **On the ground, no triangle**: {@link ParkGround}, a window of the mask's
 *   park looks round the rider and the greens in it, which the photographic
 *   ground's shader paints the stripes, greens, bunkers and paths from
 *   (`three-renderer.ts` §`PARK_GROUND_MIX`). The shader's grid constants are
 *   this file's.
 * - **Standing on it**: {@link ParkPiece}s, every one a box — a headstone, a
 *   piece of wall, a flag's pole or its flag — drawn in ONE instanced call
 *   (`three-renderer.ts` §`ParkDressingBelt`), at most
 *   {@link PARK_DRESSING_CAPACITY} a frame, nearest first, the walls and flags
 *   before the stones. A frame with no cemetery and no golf course in reach
 *   draws none and makes no call.
 *
 * ⚠️ **No new class, and no building** (ADR 0054 D-5.2): the looks are
 * `land-class.ts` §`ParkLook`'s, read through {@link LandClassMask.parkLookAt}.
 *
 * Pure: names no rendering library, and formats no coordinate into a string.
 * Built once a corridor and lazily by {@link PARK_TILE_METRES} tile; a ride
 * with no `golf_course` and no `cemetery` polygon costs one scan of its land
 * use at the first frame and nothing after.
 */

import { rasterise, type LandUseFeature } from '@onyourleft/map-features';

import type { RouteProfile } from '@onyourleft/domain';

import { LAND_CLASS_CELL_METRES, type LandClassMask, type ParkLook } from './land-class';
import { distanceToDrawnRoad } from './road-grid';
import { golfStandAt, GOLF_STAND_METRES } from './scatter';
import { mixInto, slotHash, uniformFrom } from './seeded';
import type { CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** What a {@link ParkPiece} is. */
export type ParkPieceKind = 'headstone' | 'wall' | 'flag-pole' | 'flag';

/**
 * One box standing on a park's ground. The renderer draws a unit box, its
 * base at `y`, scaled by `width` along its own x, `height` up and `depth`
 * along its own z, turned by `yaw` and raised by `lift`.
 */
export interface ParkPiece {
  readonly kind: ParkPieceKind;
  readonly x: number;
  /** The ground's height under it: 0 until `landform.ts` §`standingOnGround` stands it. */
  readonly y: number;
  readonly z: number;
  /** Metres above the ground its base is: below 0 sets it into the ground. */
  readonly lift: number;
  /**
   * Radians about the vertical, as three turns an object: its width then runs
   * along `(cos yaw, −sin yaw)` in `(x, z)`. @see yawAlong
   */
  readonly yaw: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Packed sRGB. */
  readonly colour: number;
}

/** A sand bunker beside a green, on the ground. */
export interface GolfBunker {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** One green: a close-mown disc, its flag, and the bunkers beside it. */
export interface GolfGreen {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly bunkers: readonly GolfBunker[];
  /** Where its pin stands, inside the green. */
  readonly pinX: number;
  readonly pinZ: number;
  /** Packed sRGB. */
  readonly flagColour: number;
}

/**
 * The park looks round the rider, for the ground's shader — a square window
 * of {@link PARK_LOOK_CELLS}² of the mask's own cells, one RGBA texel each,
 * texel `(column, row)` at index `(row · cells + column) · 4`, its centre the
 * cell centre `originX + (column + ½)·cellMetres`, likewise in `z`:
 *
 * - **R**: 255 on a golf course;
 * - **G**: 255 on a cemetery;
 * - **B**: 255 on mapped sand inside a golf course — a bunker where mapped;
 * - **A**: 255 on a cemetery whose cell centre is at least
 *   {@link CEMETERY_PATH_ROAD_CLEARANCE_METRES} from the drawn road: where
 *   its paths may be drawn. 0 everywhere else.
 */
export interface ParkGround {
  readonly originX: number;
  readonly originZ: number;
  readonly cellMetres: number;
  readonly cells: number;
  readonly looks: Uint8Array;
  /** The greens in the window, nearest its middle first, at most {@link GOLF_GREENS_DRAWN}. */
  readonly greens: readonly GolfGreen[];
}

/** What a frame draws of the parks in reach. @see the header */
export interface ParkDressingInView {
  readonly pieces: readonly ParkPiece[];
  /** Absent where no golf course or cemetery is in the window. */
  readonly ground: ParkGround | undefined;
}

/** Nothing: a frame with no golf course and no cemetery in reach. */
export const NO_PARK_DRESSING: ParkDressingInView = Object.freeze({
  pieces: Object.freeze([]),
  ground: undefined,
});

/**
 * How far from the camera a headstone or a piece of wall is drawn, in metres:
 * **150**. A flag is drawn at every green the window holds, however far.
 */
export const PARK_DRESSING_REACH_METRES = 150;

/**
 * How far a flag is drawn at its own size, in metres: **120**. Past it a flag
 * is scaled with distance, so it keeps the size on screen it has at 120 m —
 * a pole about 10 px tall on a 720-line frame — rather than shrinking below
 * a pixel. @see flagScaleAt
 */
export const FLAG_TRUE_SIZE_METRES = 120;

/**
 * The most pieces a frame draws: **512** — inside what the worst realistic
 * frame leaves (`realistic-budget.ts` §`REALISTIC_PARK_DRESSING_TRIANGLES`).
 * A quarter is kept for the walls and flags, nearest first; the stones take
 * the rest, nearest first.
 */
export const PARK_DRESSING_CAPACITY = 512;

/** The share of {@link PARK_DRESSING_CAPACITY} the walls and flags are taken from first. */
const FIXTURE_SHARE = 0.25;

/** The side of the tile pieces are built and kept by, in metres: **40**. */
export const PARK_TILE_METRES = 40;

/** How far the camera moves before the pieces in reach are gathered again, in metres. */
const VIEW_STEP_METRES = 10;

/** One window's side, in the mask's 5 m cells: **160**, 800 m. */
export const PARK_LOOK_CELLS = 160;

/** How far the camera moves before the window is built again, in metres: **100**. */
export const PARK_LOOK_STEP_METRES = 100;

/** The most greens the ground's shader is handed: **8**, each with at most {@link GOLF_BUNKERS_PER_GREEN} bunkers. */
export const GOLF_GREENS_DRAWN = 8;

/** The bunkers beside each green: **2**. */
export const GOLF_BUNKERS_PER_GREEN = 2;

/** The landuse kinds a mapped bunker is: `sand`, which is how Protomaps writes `natural=sand`. */
export const SAND_KINDS: ReadonlySet<string> = new Set(['sand']);

/**
 * The most mapped sand polygons one window rasterises, so a hostile archive
 * cannot make a window's build unbounded: **256**. Past it the rest are not
 * drawn as sand, which is the course's grass.
 */
export const SAND_POLYGONS_MAX = 256;

/** The kinds this file dresses. */
const DRESSED_KINDS: ReadonlySet<string> = new Set(['golf_course', 'cemetery']);

// ---------------------------------------------------------------------------
// The cemetery.

/** Between two rows of headstones, centre to centre, in metres: **3.2**. */
export const HEADSTONE_ROW_METRES = 3.2;

/** Between two headstones along a row, in metres: **1.6**. */
export const HEADSTONE_PITCH_METRES = 1.6;

/**
 * Every 7th row is a gravel path: **7**, a path every 22.4 m. Row `i` is the
 * band `[i, i + 1) × {@link HEADSTONE_ROW_METRES}` in `x`; it is a path where
 * `i mod 7 = 6`.
 */
export const HEADSTONE_PATH_ROWS = 7;

/**
 * Every 25 slots along the rows, the last {@link HEADSTONE_CROSS_PATH_SLOTS}
 * are a path across them: a 3.2 m path every 40 m.
 */
export const HEADSTONE_CROSS_SLOTS = 25;
export const HEADSTONE_CROSS_PATH_SLOTS = 2;

/**
 * How wide a cemetery's gravel path is drawn, in metres: **1.5**, a walk
 * between graves, down the middle of the 3.2 m row or pair of slots left for
 * it (`three-renderer.ts` §`PARK_GROUND_MIX`).
 */
export const HEADSTONE_PATH_WIDTH_METRES = 1.5;

/**
 * How far from the drawn road's centreline a cemetery's paths start, in
 * metres: **12** — past the verge, the kerb and the first rows of stones
 * ({@link HEADSTONE_ROAD_CLEARANCE_METRES}), so no path runs up to the road.
 */
export const CEMETERY_PATH_ROAD_CLEARANCE_METRES = 12;

/** The share of slots left empty, so the rows read as a cemetery's and not a grid's: **0.15**. */
export const HEADSTONE_GAP_SHARE = 0.15;

/** How far in from the cemetery's edge, every way, a stone must be: **2.5 m**, inside the wall. */
export const HEADSTONE_INSET_METRES = 2.5;

/** How far a stone stands from the drawn road's centreline at least: **8 m**. */
export const HEADSTONE_ROAD_CLEARANCE_METRES = 8;

/** The cemetery wall: pieces at most this long, in metres. */
export const CEMETERY_WALL_PIECE_METRES = 4;
export const CEMETERY_WALL_HEIGHT_METRES = 0.5;
export const CEMETERY_WALL_THICKNESS_METRES = 0.4;
/** A piece whose middle is nearer the road's centreline than this is not built: the gate. */
export const CEMETERY_WALL_ROAD_CLEARANCE_METRES = 6;
/** The most wall pieces a corridor holds, so an archive's outline cannot be unbounded. */
export const CEMETERY_WALL_PIECES_MAX = 20_000;
/** Grey limestone, packed sRGB. */
export const CEMETERY_WALL_COLOUR = 0xb3aa9c;

/** How deep a stone and the wall are set into the ground, so a slope does not lift them off it. */
const SET_IN_METRES = 0.15;

/** The stones' colours, packed sRGB: grey and dark granite, pale and white marble, sandstone. */
export const HEADSTONE_COLOURS: readonly number[] = Object.freeze([
  0x9a9a96, 0x6e6d6a, 0xc9c6bd, 0xdcdad3, 0xb5aa98,
]);

// ---------------------------------------------------------------------------
// The golf course.

/** The grid greens stand on, one at most a square, in metres: **150**. */
export const GOLF_GREEN_CELL_METRES = 150;

/** A green's radius, in metres: **11** to **16**. */
export const GOLF_GREEN_RADIUS_METRES: readonly [number, number] = [11, 16];

/** How far past a green's edge the course must reach all round it, in metres. */
const GREEN_SURROUND_METRES = 6;

/** How far past a green's edge the drawn road must be, in metres. */
export const GOLF_GREEN_ROAD_CLEARANCE_METRES = 12;

/** Where in its square a green may be tried, this many times. */
const GREEN_TRIES = 6;

/** A bunker's radius, in metres: **2.5** to **4.5**. */
export const GOLF_BUNKER_RADIUS_METRES: readonly [number, number] = [2.5, 4.5];

/** The flag's pole and its flag. */
export const FLAG_POLE_HEIGHT_METRES = 2.4;
const FLAG_POLE_THICKNESS_METRES = 0.08;
const FLAG_WIDTH_METRES = 0.9;
const FLAG_HEIGHT_METRES = 0.6;
const FLAG_THICKNESS_METRES = 0.04;
const FLAG_POLE_COLOUR = 0xf2f2ee;
/** Red and yellow, packed sRGB. */
export const FLAG_COLOURS: readonly number[] = Object.freeze([0xd8332b, 0xf0c419]);

// Hash slots, each its own so no two quantities correlate.
const HEADSTONE_KEY = 0x2685_0001;
const GREEN_KEY = 0x2685_0100;

/** `atan2`'s answer for a box whose width runs along `(dx, dz)`. @see ParkPiece.yaw */
export function yawAlong(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

const TILE_RANGE = 2 ** 15;

/** A tile's key, or `undefined` past the range a key names (1 300 km). */
function tileKey(tx: number, tz: number): number | undefined {
  if (Math.abs(tx) >= TILE_RANGE || Math.abs(tz) >= TILE_RANGE) return undefined;
  return (tx + TILE_RANGE) * 2 * TILE_RANGE + (tz + TILE_RANGE);
}

/** Everything one corridor's dressing keeps. */
interface Dressing {
  readonly land: LandClassMask;
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  /** Whether the corridor has any land this file dresses. */
  readonly any: boolean;
  /** The wall pieces, by tile. */
  readonly walls: ReadonlyMap<number, readonly ParkPiece[]>;
  /** The mapped sand, with each polygon's box. */
  readonly sands: readonly { readonly feature: LandUseFeature; readonly box: Box4 }[];
  readonly stones: Map<number, readonly ParkPiece[]>;
  readonly greens: Map<number, GolfGreen | null>;
  window: { key: string; ground: ParkGround | undefined } | undefined;
  view: { key: string; value: ParkDressingInView } | undefined;
}

type Box4 = readonly [number, number, number, number];

const dressings = new WeakMap<WorldCorridor, Dressing>();

/**
 * What a frame draws of the golf courses and cemeteries round the camera.
 * @see the header
 *
 * Built once a corridor, and again only if it is asked about with another
 * mask, route or seed; the same object is handed back while the camera stays
 * within one {@link VIEW_STEP_METRES} square.
 */
export function parkDressingInView(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
  cameraX: number,
  cameraZ: number,
): ParkDressingInView {
  const dressing = dressingOf(corridor, profile, origin, seed, land);
  if (!dressing.any) return NO_PARK_DRESSING;
  const viewKey = `${Math.round(cameraX / VIEW_STEP_METRES)},${Math.round(cameraZ / VIEW_STEP_METRES)}`;
  if (dressing.view?.key === viewKey) return dressing.view.value;
  const ground = groundWindow(dressing, cameraX, cameraZ);
  const pieces = piecesInReach(dressing, ground, cameraX, cameraZ);
  const value = ground === undefined && pieces.length === 0 ? NO_PARK_DRESSING : { pieces, ground };
  dressing.view = { key: viewKey, value };
  return value;
}

function dressingOf(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): Dressing {
  const known = dressings.get(corridor);
  if (
    known !== undefined &&
    known.land === land &&
    known.profile === profile &&
    known.origin === origin &&
    known.seed === seed
  ) {
    return known;
  }
  const any = corridor.landUse.some(
    (feature) => feature.layer === 'landuse' && DRESSED_KINDS.has(feature.kind),
  );
  const made: Dressing = {
    land,
    profile,
    origin,
    seed,
    any,
    walls: any ? cemeteryWalls(corridor.landUse, profile, origin) : new Map(),
    sands: any ? sandsOf(corridor.landUse) : [],
    stones: new Map(),
    greens: new Map(),
    window: undefined,
    view: undefined,
  };
  dressings.set(corridor, made);
  return made;
}

/** Every mapped sand polygon, with its box. */
function sandsOf(
  landUse: readonly LandUseFeature[],
): readonly { readonly feature: LandUseFeature; readonly box: Box4 }[] {
  const sands: { feature: LandUseFeature; box: Box4 }[] = [];
  for (const feature of landUse) {
    if (feature.layer !== 'landuse' || !SAND_KINDS.has(feature.kind)) continue;
    const box = boxOf(feature);
    if (box !== undefined) sands.push({ feature, box });
  }
  return sands;
}

function boxOf(feature: LandUseFeature): Box4 | undefined {
  const outer = feature.rings[0];
  if (outer === undefined || outer.length < 6) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < outer.length; i += 2) {
    minX = Math.min(minX, outer[i] as number);
    maxX = Math.max(maxX, outer[i] as number);
    minZ = Math.min(minZ, outer[i + 1] as number);
    maxZ = Math.max(maxZ, outer[i + 1] as number);
  }
  return [minX, maxX, minZ, maxZ];
}

/**
 * The low wall along each mapped cemetery's outer ring, in pieces of at most
 * {@link CEMETERY_WALL_PIECE_METRES}, by tile. A piece whose middle is within
 * {@link CEMETERY_WALL_ROAD_CLEARANCE_METRES} of the drawn road is left out,
 * which is the gate the road goes in by. At most
 * {@link CEMETERY_WALL_PIECES_MAX}.
 */
function cemeteryWalls(
  landUse: readonly LandUseFeature[],
  profile: RouteProfile,
  origin: CorridorOrigin,
): ReadonlyMap<number, readonly ParkPiece[]> {
  const tiles = new Map<number, ParkPiece[]>();
  let count = 0;
  for (const feature of landUse) {
    if (feature.layer !== 'landuse' || feature.kind !== 'cemetery') continue;
    const outline = feature.rings[0];
    if (outline === undefined || outline.length < 6) continue;
    const corners = Math.floor(outline.length / 2);
    for (let corner = 0; corner < corners; corner += 1) {
      const ax = outline[corner * 2] as number;
      const az = outline[corner * 2 + 1] as number;
      const next = (corner + 1) % corners;
      const bx = outline[next * 2] as number;
      const bz = outline[next * 2 + 1] as number;
      const length = Math.hypot(bx - ax, bz - az);
      if (!(length > 0.5)) continue;
      const pieces = Math.ceil(length / CEMETERY_WALL_PIECE_METRES);
      const piece = length / pieces;
      const dx = (bx - ax) / length;
      const dz = (bz - az) / length;
      for (let index = 0; index < pieces; index += 1) {
        if (count >= CEMETERY_WALL_PIECES_MAX) return tiles;
        const t = (index + 0.5) * piece;
        const x = ax + dx * t;
        const z = az + dz * t;
        const road = distanceToDrawnRoad(
          profile,
          origin,
          x,
          z,
          CEMETERY_WALL_ROAD_CLEARANCE_METRES,
        );
        if (road < CEMETERY_WALL_ROAD_CLEARANCE_METRES) continue;
        const key = tileKey(Math.floor(x / PARK_TILE_METRES), Math.floor(z / PARK_TILE_METRES));
        if (key === undefined) continue;
        let list = tiles.get(key);
        if (list === undefined) {
          list = [];
          tiles.set(key, list);
        }
        list.push({
          kind: 'wall',
          x,
          y: 0,
          z,
          lift: -SET_IN_METRES,
          yaw: yawAlong(dx, dz),
          // A few centimetres over, so two pieces meet at a corner without a slot.
          width: piece + CEMETERY_WALL_THICKNESS_METRES * 0.5,
          height: CEMETERY_WALL_HEIGHT_METRES + SET_IN_METRES,
          depth: CEMETERY_WALL_THICKNESS_METRES,
          colour: CEMETERY_WALL_COLOUR,
        });
        count += 1;
      }
    }
  }
  return tiles;
}

/** Whether `(x, z)` and the ground `reach` metres to each of its four sides are all `look`. */
function allLook(
  land: LandClassMask,
  look: ParkLook,
  x: number,
  z: number,
  reach: number,
): boolean {
  return (
    land.parkLookAt(x, z) === look &&
    land.parkLookAt(x + reach, z) === look &&
    land.parkLookAt(x - reach, z) === look &&
    land.parkLookAt(x, z + reach) === look &&
    land.parkLookAt(x, z - reach) === look
  );
}

/** Whether a tile has any cemetery ground: a look a cell, its corners and middle first. */
function tileHasLook(land: LandClassMask, look: ParkLook, x0: number, z0: number): boolean {
  const step = LAND_CLASS_CELL_METRES;
  for (let x = x0 + step / 2; x < x0 + PARK_TILE_METRES; x += step) {
    for (let z = z0 + step / 2; z < z0 + PARK_TILE_METRES; z += step) {
      if (land.parkLookAt(x, z) === look) return true;
    }
  }
  return false;
}

/**
 * Whether row `row` is a path: every {@link HEADSTONE_PATH_ROWS}th. The
 * shader's twin is `mod(x, 7 · row) ≥ 6 · row`.
 */
export function isPathRow(row: number): boolean {
  return (
    ((row % HEADSTONE_PATH_ROWS) + HEADSTONE_PATH_ROWS) % HEADSTONE_PATH_ROWS ===
    HEADSTONE_PATH_ROWS - 1
  );
}

/**
 * Whether slot `slot` along a row is on a cross path. The shader's twin is
 * `mod(z, 25 · pitch) ≥ 23 · pitch`.
 */
export function isCrossPathSlot(slot: number): boolean {
  const at = ((slot % HEADSTONE_CROSS_SLOTS) + HEADSTONE_CROSS_SLOTS) % HEADSTONE_CROSS_SLOTS;
  return at >= HEADSTONE_CROSS_SLOTS - HEADSTONE_CROSS_PATH_SLOTS;
}

/** One tile's headstones, built on first ask. @see the header */
function stonesOf(dressing: Dressing, tx: number, tz: number, key: number): readonly ParkPiece[] {
  const known = dressing.stones.get(key);
  if (known !== undefined) return known;
  const { land, profile, origin, seed } = dressing;
  const x0 = tx * PARK_TILE_METRES;
  const z0 = tz * PARK_TILE_METRES;
  const stones: ParkPiece[] = [];
  if (tileHasLook(land, 'cemetery', x0, z0)) {
    const firstRow = Math.ceil(x0 / HEADSTONE_ROW_METRES - 0.5);
    const lastRow = Math.ceil((x0 + PARK_TILE_METRES) / HEADSTONE_ROW_METRES - 0.5);
    const firstSlot = Math.ceil(z0 / HEADSTONE_PITCH_METRES - 0.5);
    const lastSlot = Math.ceil((z0 + PARK_TILE_METRES) / HEADSTONE_PITCH_METRES - 0.5);
    for (let row = firstRow; row < lastRow; row += 1) {
      if (isPathRow(row)) continue;
      const x = (row + 0.5) * HEADSTONE_ROW_METRES;
      for (let slot = firstSlot; slot < lastSlot; slot += 1) {
        if (isCrossPathSlot(slot)) continue;
        const z = (slot + 0.5) * HEADSTONE_PITCH_METRES;
        const base = slotHash(seed, mixInto(row, slot), HEADSTONE_KEY);
        if (uniformFrom(base, 0) < HEADSTONE_GAP_SHARE) continue;
        if (!allLook(land, 'cemetery', x, z, HEADSTONE_INSET_METRES)) continue;
        if (
          distanceToDrawnRoad(profile, origin, x, z, HEADSTONE_ROAD_CLEARANCE_METRES) <
          HEADSTONE_ROAD_CLEARANCE_METRES
        ) {
          continue;
        }
        stones.push(headstone(base, x, z));
      }
    }
  }
  dressing.stones.set(key, stones);
  return stones;
}

/**
 * One headstone: an upright slab facing east, mostly; a low ledger laid
 * along its grave one time in seven; a tall obelisk one in fifteen.
 */
function headstone(base: number, x: number, z: number): ParkPiece {
  const shape = uniformFrom(base, 1);
  const size = uniformFrom(base, 2);
  const colour = HEADSTONE_COLOURS[
    Math.floor(uniformFrom(base, 3) * HEADSTONE_COLOURS.length)
  ] as number;
  // Its broad face toward the east: its width along the row, north and south.
  const yaw = yawAlong(0, 1) + (uniformFrom(base, 4) - 0.5) * 0.16;
  const along = (uniformFrom(base, 5) - 0.5) * 0.3;
  if (shape < 1 / 15) {
    const side = 0.32 + size * 0.12;
    return piece('headstone', x, z + along, yaw, side, 1.3 + size * 0.5, side, colour);
  }
  if (shape < 1 / 15 + 1 / 7) {
    // A ledger: low, and long across the row, over the grave.
    return piece('headstone', x - 0.6, z + along, yaw, 0.7, 0.22 + size * 0.1, 1.5, colour);
  }
  return piece(
    'headstone',
    x,
    z + along,
    yaw,
    0.5 + size * 0.3,
    0.6 + uniformFrom(base, 6) * 0.45,
    0.13 + size * 0.08,
    colour,
  );
}

function piece(
  kind: ParkPieceKind,
  x: number,
  z: number,
  yaw: number,
  width: number,
  height: number,
  depth: number,
  colour: number,
): ParkPiece {
  return {
    kind,
    x,
    y: 0,
    z,
    lift: -SET_IN_METRES,
    yaw,
    width,
    height: height + SET_IN_METRES,
    depth,
    colour,
  };
}

/**
 * The green in square `(column, row)` of {@link GOLF_GREEN_CELL_METRES}, if
 * one stands there: tried at up to {@link GREEN_TRIES} seeded places, the
 * first that is golf course all round it, clear of the road and of every
 * stand of trees. Kept once found, or once not.
 */
function greenOf(dressing: Dressing, column: number, row: number): GolfGreen | undefined {
  const key = tileKey(column, row);
  if (key === undefined) return undefined;
  const known = dressing.greens.get(key);
  if (known !== undefined) return known ?? undefined;
  const found = findGreen(dressing, column, row);
  dressing.greens.set(key, found ?? null);
  return found;
}

function findGreen(dressing: Dressing, column: number, row: number): GolfGreen | undefined {
  const { land, profile, origin, seed } = dressing;
  const cell = mixInto(column, row);
  for (let attempt = 0; attempt < GREEN_TRIES; attempt += 1) {
    const base = slotHash(seed, cell, GREEN_KEY + attempt);
    const x = (column + 0.2 + 0.6 * uniformFrom(base, 0)) * GOLF_GREEN_CELL_METRES;
    const z = (row + 0.2 + 0.6 * uniformFrom(base, 1)) * GOLF_GREEN_CELL_METRES;
    const [least, most] = GOLF_GREEN_RADIUS_METRES;
    const radius = least + (most - least) * uniformFrom(base, 2);
    if (!courseAllRound(land, x, z, radius + GREEN_SURROUND_METRES)) continue;
    if (!clearOfStands(seed, x, z, radius + 2)) continue;
    const clearance = radius + GOLF_GREEN_ROAD_CLEARANCE_METRES;
    if (distanceToDrawnRoad(profile, origin, x, z, clearance) < clearance) continue;
    const bunkers: GolfBunker[] = [];
    const first = uniformFrom(base, 3) * 2 * Math.PI;
    for (let index = 0; index < GOLF_BUNKERS_PER_GREEN; index += 1) {
      const angle = first + index * (2.1 + uniformFrom(base, 4));
      const [small, large] = GOLF_BUNKER_RADIUS_METRES;
      const size = small + (large - small) * uniformFrom(base, 5 + index);
      const reach = radius + 2.5 + size;
      const bx = x + Math.cos(angle) * reach;
      const bz = z + Math.sin(angle) * reach;
      if (land.parkLookAt(bx, bz) !== 'golf') continue;
      bunkers.push({ x: bx, z: bz, radius: size });
    }
    const pin = 0.6 * radius;
    return {
      x,
      z,
      radius,
      bunkers,
      pinX: x + (uniformFrom(base, 8) - 0.5) * pin,
      pinZ: z + (uniformFrom(base, 9) - 0.5) * pin,
      flagColour: FLAG_COLOURS[Math.floor(uniformFrom(base, 10) * FLAG_COLOURS.length)] as number,
    };
  }
  return undefined;
}

/** Whether the course reaches `reach` metres from `(x, z)` every way: its middle and eight points round it. */
function courseAllRound(land: LandClassMask, x: number, z: number, reach: number): boolean {
  if (land.parkLookAt(x, z) !== 'golf') return false;
  for (let index = 0; index < 8; index += 1) {
    const angle = (index * Math.PI) / 4;
    if (land.parkLookAt(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach) !== 'golf') {
      return false;
    }
  }
  return true;
}

/** Whether no stand of trees (`scatter.ts` §`golfStandAt`) reaches within `reach` of `(x, z)`. */
function clearOfStands(seed: number, x: number, z: number, reach: number): boolean {
  const square = GOLF_STAND_METRES;
  for (let sx = Math.floor((x - reach) / square); sx <= Math.floor((x + reach) / square); sx += 1) {
    for (
      let sz = Math.floor((z - reach) / square);
      sz <= Math.floor((z + reach) / square);
      sz += 1
    ) {
      if (golfStandAt(seed, (sx + 0.5) * square, (sz + 0.5) * square)) return false;
    }
  }
  return true;
}

/** Every green whose square reaches within `reach` of `(x, z)`. */
function greensNear(dressing: Dressing, x: number, z: number, reach: number): GolfGreen[] {
  const cell = GOLF_GREEN_CELL_METRES;
  const greens: GolfGreen[] = [];
  for (
    let column = Math.floor((x - reach) / cell);
    column <= Math.floor((x + reach) / cell);
    column += 1
  ) {
    for (
      let row = Math.floor((z - reach) / cell);
      row <= Math.floor((z + reach) / cell);
      row += 1
    ) {
      const green = greenOf(dressing, column, row);
      if (green !== undefined) greens.push(green);
    }
  }
  return greens;
}

/**
 * How much a flag `distance` metres from the camera is scaled: 1 within
 * {@link FLAG_TRUE_SIZE_METRES}, and past it in step with the distance, so
 * the far form keeps the size on screen the flag has there.
 */
export function flagScaleAt(distance: number): number {
  return Math.max(1, distance / FLAG_TRUE_SIZE_METRES);
}

/**
 * A green's flag: its pole and the flag at the top of it, flying east, both
 * scaled by `scale` ({@link flagScaleAt}) about the foot of the pole.
 */
function flagPieces(green: GolfGreen, scale: number): readonly [ParkPiece, ParkPiece] {
  return [
    {
      kind: 'flag-pole',
      x: green.pinX,
      y: 0,
      z: green.pinZ,
      lift: 0,
      yaw: 0,
      width: FLAG_POLE_THICKNESS_METRES * scale,
      height: FLAG_POLE_HEIGHT_METRES * scale,
      depth: FLAG_POLE_THICKNESS_METRES * scale,
      colour: FLAG_POLE_COLOUR,
    },
    {
      kind: 'flag',
      x: green.pinX + (FLAG_WIDTH_METRES / 2) * scale,
      y: 0,
      z: green.pinZ,
      lift: (FLAG_POLE_HEIGHT_METRES - FLAG_HEIGHT_METRES) * scale,
      yaw: 0,
      width: FLAG_WIDTH_METRES * scale,
      height: FLAG_HEIGHT_METRES * scale,
      depth: FLAG_THICKNESS_METRES * scale,
      colour: green.flagColour,
    },
  ];
}

/**
 * The stones and walls within {@link PARK_DRESSING_REACH_METRES} of the
 * camera and a flag at every green `ground` paints, at most
 * {@link PARK_DRESSING_CAPACITY}: the walls and flags first, nearest first,
 * up to their share, then the stones, nearest first.
 */
function piecesInReach(
  dressing: Dressing,
  ground: ParkGround | undefined,
  cameraX: number,
  cameraZ: number,
): readonly ParkPiece[] {
  const reach = PARK_DRESSING_REACH_METRES;
  const reachSquared = reach * reach;
  const fixtures: { piece: ParkPiece; squared: number }[] = [];
  const stones: { piece: ParkPiece; squared: number }[] = [];
  const near = (piece: ParkPiece): number => {
    const dx = piece.x - cameraX;
    const dz = piece.z - cameraZ;
    return dx * dx + dz * dz;
  };
  const first = Math.floor((cameraX - reach) / PARK_TILE_METRES);
  const last = Math.floor((cameraX + reach) / PARK_TILE_METRES);
  const firstRow = Math.floor((cameraZ - reach) / PARK_TILE_METRES);
  const lastRow = Math.floor((cameraZ + reach) / PARK_TILE_METRES);
  for (let tx = first; tx <= last; tx += 1) {
    for (let tz = firstRow; tz <= lastRow; tz += 1) {
      const key = tileKey(tx, tz);
      if (key === undefined) continue;
      for (const wall of dressing.walls.get(key) ?? []) {
        const squared = near(wall);
        if (squared <= reachSquared) fixtures.push({ piece: wall, squared });
      }
      for (const stone of stonesOf(dressing, tx, tz, key)) {
        const squared = near(stone);
        if (squared <= reachSquared) stones.push({ piece: stone, squared });
      }
    }
  }
  // Every green the ground paints, so a flag never stands on grass and a
  // painted green never stands without one — at any distance the window holds.
  for (const green of ground?.greens ?? []) {
    const away = Math.hypot(green.pinX - cameraX, green.pinZ - cameraZ);
    for (const flag of flagPieces(green, flagScaleAt(away))) {
      fixtures.push({ piece: flag, squared: near(flag) });
    }
  }
  forgetFarStones(dressing, cameraX, cameraZ);
  const byNearness = (a: { squared: number }, b: { squared: number }): number =>
    a.squared - b.squared;
  fixtures.sort(byNearness);
  stones.sort(byNearness);
  const fixtureRoom = Math.floor(PARK_DRESSING_CAPACITY * FIXTURE_SHARE);
  const kept = fixtures.slice(0, fixtureRoom).map((entry) => entry.piece);
  for (const entry of stones) {
    if (kept.length >= PARK_DRESSING_CAPACITY) break;
    kept.push(entry.piece);
  }
  // Any of the fixtures' share the stones left, back to the fixtures.
  for (let index = fixtureRoom; index < fixtures.length; index += 1) {
    if (kept.length >= PARK_DRESSING_CAPACITY) break;
    kept.push((fixtures[index] as { piece: ParkPiece }).piece);
  }
  return kept;
}

/** The most tiles of stones kept before the far ones are forgotten. */
const STONE_TILES_KEPT = 512;

function forgetFarStones(dressing: Dressing, cameraX: number, cameraZ: number): void {
  if (dressing.stones.size <= STONE_TILES_KEPT) return;
  const far = 2 * PARK_DRESSING_REACH_METRES + PARK_TILE_METRES;
  for (const key of [...dressing.stones.keys()]) {
    const tx = Math.floor(key / (2 * TILE_RANGE)) - TILE_RANGE;
    const tz = (key % (2 * TILE_RANGE)) - TILE_RANGE;
    const dx = (tx + 0.5) * PARK_TILE_METRES - cameraX;
    const dz = (tz + 0.5) * PARK_TILE_METRES - cameraZ;
    if (Math.hypot(dx, dz) > far) dressing.stones.delete(key);
  }
}

/**
 * The window of park looks round the camera, built again only when the camera
 * crosses a {@link PARK_LOOK_STEP_METRES} square. Absent where it holds no
 * golf course and no cemetery.
 */
function groundWindow(
  dressing: Dressing,
  cameraX: number,
  cameraZ: number,
): ParkGround | undefined {
  const middleX = Math.round(cameraX / PARK_LOOK_STEP_METRES) * PARK_LOOK_STEP_METRES;
  const middleZ = Math.round(cameraZ / PARK_LOOK_STEP_METRES) * PARK_LOOK_STEP_METRES;
  const key = `${middleX},${middleZ}`;
  if (dressing.window?.key === key) return dressing.window.ground;
  const ground = buildWindow(dressing, middleX, middleZ);
  dressing.window = { key, ground };
  return ground;
}

function buildWindow(dressing: Dressing, middleX: number, middleZ: number): ParkGround | undefined {
  const { land } = dressing;
  const cell = LAND_CLASS_CELL_METRES;
  const cells = PARK_LOOK_CELLS;
  const span = cells * cell;
  // On the mask's own grid, so each texel is one of its cells.
  const originX = Math.floor((middleX - span / 2) / cell) * cell;
  const originZ = Math.floor((middleZ - span / 2) / cell) * cell;
  const looks = new Uint8Array(cells * cells * 4);
  let golf = false;
  let cemetery = false;
  const { profile, origin } = dressing;
  const clearance = CEMETERY_PATH_ROAD_CLEARANCE_METRES;
  for (let row = 0; row < cells; row += 1) {
    const z = originZ + (row + 0.5) * cell;
    for (let column = 0; column < cells; column += 1) {
      const x = originX + (column + 0.5) * cell;
      const look = land.parkLookAt(x, z);
      const at = (row * cells + column) * 4;
      if (look === 'golf') {
        looks[at] = 255;
        golf = true;
      } else if (look === 'cemetery') {
        looks[at + 1] = 255;
        cemetery = true;
        // Its paths only past the clearance: none runs up to the kerb.
        if (distanceToDrawnRoad(profile, origin, x, z, clearance) >= clearance) {
          looks[at + 3] = 255;
        }
      }
    }
  }
  if (!golf && !cemetery) return undefined;
  if (golf) paintSand(dressing, looks, originX, originZ);
  const greens = golf
    ? greensNear(dressing, middleX, middleZ, span / 2)
        .filter(
          (green) =>
            green.x >= originX &&
            green.x < originX + span &&
            green.z >= originZ &&
            green.z < originZ + span,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - middleX, a.z - middleZ) - Math.hypot(b.x - middleX, b.z - middleZ),
        )
        .slice(0, GOLF_GREENS_DRAWN)
    : [];
  return { originX, originZ, cellMetres: cell, cells, looks, greens };
}

/** The mapped sand inside a golf course, onto the window's B channel, at most {@link SAND_POLYGONS_MAX} polygons. */
function paintSand(dressing: Dressing, looks: Uint8Array, originX: number, originZ: number): void {
  const cells = PARK_LOOK_CELLS;
  const cellMetres = LAND_CLASS_CELL_METRES;
  const maxX = originX + cells * cellMetres;
  const maxZ = originZ + cells * cellMetres;
  const grid = { originX, originZ, cellMetres, columns: cells, rows: cells };
  let painted = 0;
  for (const { feature, box } of dressing.sands) {
    if (box[1] < originX || box[0] > maxX || box[3] < originZ || box[2] > maxZ) continue;
    if (painted >= SAND_POLYGONS_MAX) return;
    painted += 1;
    rasterise(feature, grid, (index) => {
      const at = index * 4;
      if ((looks[at] as number) > 0) looks[at + 2] = 255;
    });
  }
}
