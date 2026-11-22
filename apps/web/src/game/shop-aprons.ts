// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A paved apron in front of a mapped shop — #2848, the owner's ruling of
 * 2026-11-18 on the model pass's proposal 4 (PR #2842): *"add a paved apron
 * in front of shopfronts where the map has no pavement"*.
 *
 * ## What was wrong
 *
 * A mapped commercial footprint with no mapped footway before it stood on
 * grass to the road's edge: a shop front, a sign band and an awning over a
 * lawn. A procedural village has its pavement (`streets.ts`, #1535) and a
 * city centre its own (#1637); a mapped town of any other class has none, and
 * a mapped footway is walked (`people.ts`) and never drawn.
 *
 * ## Which fronts get one
 *
 * The planner (`footprint-buildings.ts` §`footprintPlans`) asks for one for
 * every kept footprint `building-archetypes.ts` reads as commercial — its use
 * commercial, by the land under it or by its mapped type; so every
 * main-street block and strip front, and a commercial footprint no cue takes
 * — that is not a `building_part` and has a front: the wall its door is on,
 * the outer ring's edge nearest the route. It gets one only where all of
 * these hold:
 *
 * - the front faces the route within 60° ({@link APRON}'s `facing`);
 * - nowhere along the front is the kerb more than {@link APRON}'s `deepest`
 *   (**12 m**) from the wall — further back the ground before it is a yard or
 *   a car park, which is not this issue's;
 * - **no mapped footway comes within {@link APRON}'s `footway` (2 m) of the
 *   ground between the front and the kerb** — any footway, a crossing
 *   included. That is the "stated distance": a footway nearer than that is
 *   the map's own pavement before this front, and an apron under it would
 *   cover it.
 *
 * ## Where it lies
 *
 * The front is cut into columns no wider than {@link APRON}'s `column`, and
 * each column's two edges run from the wall straight to the nearest point of
 * the drawn road, stopping {@link APRON}'s `short` outside the carriageway's
 * edge — the kerb's line (`streets.ts` §`KERB_LATERAL_METRES`), which the
 * driveway (#1588) stops at too — or, where a city centre's pavement is laid
 * on that side (`streets.ts` §`cityPavementOn`), at that pavement's back, so
 * it never lies on a drawn pavement. A column is laid whole or not at all: it
 * is dropped where any of its vertices is on a mapped street or road, on
 * water or its bank, on a park, a wood or bare ground (the classes
 * `land-class.ts` ranks above built-up land, so the precedence is kept), or
 * where its ground meets another footprint, the building's own wing, a porch
 * or a driveway. What is laid is the longest unbroken run of columns, so an
 * apron is one piece of paving, from the wall to the kerb. Two aprons never
 * overlap: a column's edges run straight to the nearest point of the road,
 * and two such lines never cross.
 *
 * ## The ground
 *
 * Every vertex is {@link APRON}'s `lift` above the drawn ground beneath it —
 * the driveway's rule and its number (#1588, `footprint-buildings.ts`
 * §`DRIVEWAY`) — so it stands clear of the ground's own surface rather than
 * in its plane. Each column is cut, between the kerb and the wall, **on the
 * lines the drawn ground itself bends on** (`landform.ts`
 * §`TERRAIN_COLUMN_OFFSETS`: the verge's foot, then 8 m and 12 m from the
 * centreline), and between those in pieces no longer than {@link APRON}'s
 * `piece`. So each piece lies on one flat of the ground, and an apron follows
 * a slope — the road's own climb along it, the verge's fall and a hillside's
 * across it — rather than floating over it or sinking into it.
 *
 * ## Cost
 *
 * Plan-time only, built once at the press with the plans. Its triangles are
 * the plan's `apron` role: counted in `FootprintPlan.triangleCount`, so
 * inside `FOOTPRINT_MAX_TRIANGLES` a plan (an apron that would put its plan
 * past that is not laid) and `realistic-budget.ts`
 * §`MAPPED_BUILDING_TRIANGLES` a frame, by `mapped-buildings.ts`
 * §`selectMappedBuildings`' own count. It wears the walls' surface group and
 * the shader paints it (`footprint-buildings.ts` §`CLAD_PAVING`, the
 * driveway's paving), so it opens no draw call, no texture and no byte. Near
 * level only, as a driveway is.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message.
 *
 * Pure, and names no rendering library.
 */

import type { PathFeature, StreetFeature } from '@onyourleft/map-features';

import { SIDE_ROAD_WIDTHS, widthClassOf } from './cross-streets';
import { isFootway } from './footways';
import { squaredToSegment } from './road-grid';

/**
 * An apron's numbers — #2848.
 *
 * - `lift`: how far above the drawn ground it is laid, metres: **0.05**, the
 *   driveway's.
 * - `piece`: the longest piece, between the kerb and the wall, before it is
 *   bent to the ground again, metres: **2**, the driveway's; a piece also
 *   ends on every line the ground bends on.
 * - `column`: the widest a column is along the wall, metres: **3.6**, a bay
 *   of the facade (`footprint-buildings.ts` §`BAY_METRES`, and written as it
 *   is: `3.6` is also the m/s-to-km/h factor `units/no-inline-units.ts` keeps
 *   out of the client), and what a driveway spans unbent across its width.
 * - `deepest`: the furthest the kerb may be from the wall anywhere along the
 *   front, metres: **12**.
 * - `least`: the least a column's edge may be long, metres: **0.2**; a wall
 *   nearer the kerb than that has no ground to pave there.
 * - `short`: how far outside the carriageway's edge it stops, metres:
 *   **0.1**, the driveway's.
 * - `footway`: a mapped footway nearer its ground than this, metres, and the
 *   front gets no apron: **2**.
 * - `street`: how far off a mapped street's drawn edge a vertex must be,
 *   metres: **0.5**, `cross-streets.ts` §`SIDE_ROAD_STRUCTURE_MARGIN_METRES`'
 *   figure.
 * - `facing`: the least cosine between the front's outward normal and the
 *   way to the road at its middle: **0.5**, 60°.
 * - `inset`: how far inside its own edges a column's ground is held when it
 *   is checked against footprints, porches and driveways, metres: **0.05**,
 *   what a driveway is held off its own wall by.
 */
export const APRON = {
  lift: 0.05,
  piece: 2,
  column: 36 / 10,
  deepest: 12,
  least: 0.2,
  short: 0.1,
  footway: 2,
  street: 0.5,
  facing: 0.5,
  inset: 0.05,
} as const;

/** A front wall: its middle, its direction along, its outward normal, and its length. */
export interface ApronFront {
  readonly mx: number;
  readonly mz: number;
  readonly ex: number;
  readonly ez: number;
  readonly nx: number;
  readonly nz: number;
  readonly length: number;
}

/** Where a point stands beside the drawn road. @see ApronSite.beside */
export interface ApronBeside {
  /** The unit direction from the point to the nearest point of the road's centreline. */
  readonly towardX: number;
  readonly towardZ: number;
  /** How far the point is from the centreline, metres. */
  readonly distance: number;
  /** How far from the centreline paving stops there, metres: the kerb's line, or a pavement's back. */
  readonly kerb: number;
}

/** What an apron is laid against: the road, the land, and everything already standing. */
export interface ApronSite {
  /** Where `(x, z)` stands beside the nearest stretch of the drawn road; `undefined` with none near. */
  beside(x: number, z: number): ApronBeside | undefined;
  /** Whether paving may lie at `(x, z)`: off every street, water, park, wood and bare ground. */
  clear(x: number, z: number): boolean;
  /** Whether the ground inside `ring` is free: no footprint, porch or driveway meets it. */
  free(ring: Float32Array): boolean;
  /** Whether a mapped footway comes within {@link APRON}'s `footway` of `ring`, or lies inside it. */
  footwayNear(ring: Float32Array): boolean;
  /**
   * How far from the centreline the drawn ground bends, metres, ascending:
   * the lines along the road its triangles meet on (`landform.ts`
   * §`TERRAIN_COLUMN_OFFSETS`). An apron is bent on the same lines.
   */
  readonly bends: readonly number[];
}

/** One station of an apron: a point of the wall, and the point of the kerb's line before it. */
export interface ApronStation {
  /** Along the wall from its middle, metres. */
  readonly along: number;
  readonly wallX: number;
  readonly wallZ: number;
  readonly kerbX: number;
  readonly kerbZ: number;
  /** From the wall to the kerb's line, metres. */
  readonly depth: number;
  /** How far the wall is from the road's centreline here, metres; the kerb's line is `depth` nearer. */
  readonly wall: number;
}

/** An apron, laid out: its stations, the lines it is bent on, and its outline. */
export interface ShopApron {
  /** Two or more, in order along the wall; column `i` lies between stations `i` and `i + 1`. */
  readonly stations: readonly ApronStation[];
  /**
   * The lines a column is cut on between the wall and the kerb, as distances
   * from the road's centreline, metres, ascending: the nearest kerb's line,
   * every one of the ground's bends between, and the farthest wall — and
   * between those, lines no further apart than {@link APRON}'s `piece`.
   */
  readonly levels: readonly number[];
  /** Its outline in local metres, `x, z` pairs: along the wall, then back along the kerb's line. */
  readonly ring: Float32Array;
  /** How many triangles {@link apronTriangles} writes: two a piece, less those with no ground in them. */
  readonly triangleCount: number;
}

/** How many times a station's kerb end is moved onto the kerb's line: enough for a wall 60° off the road. */
const KERB_STEPS = 8;

/** How near the kerb's line a station's end must come, metres: a millimetre. */
const KERB_TOLERANCE_METRES = 0.001;

/** A bend nearer an apron's own edge than this, metres, cuts no piece of its own. */
const SLIVER_METRES = 0.05;

/** The station at `along` of `front`, or `undefined` where no road is near or the wall is within `least` of the kerb. */
function stationAt(front: ApronFront, site: ApronSite, along: number): ApronStation | undefined {
  const wallX = front.mx + front.ex * along;
  const wallZ = front.mz + front.ez * along;
  const from = site.beside(wallX, wallZ);
  if (from === undefined) return undefined;
  // Straight toward the road, to the kerb's line; the line is read again
  // where the end lands, since a city's pavement starts and stops along it.
  let depth = from.distance - from.kerb;
  let onLine = false;
  for (let step = 0; step < KERB_STEPS && !onLine; step += 1) {
    if (!(depth > 0)) return undefined;
    const end = site.beside(wallX + from.towardX * depth, wallZ + from.towardZ * depth);
    if (end === undefined) return undefined;
    const left = end.distance - end.kerb;
    if (Math.abs(left) < KERB_TOLERANCE_METRES) onLine = true;
    else depth += left;
  }
  if (!onLine) return undefined;
  if (!(depth >= APRON.least)) return undefined;
  return {
    along,
    wallX,
    wallZ,
    kerbX: wallX + from.towardX * depth,
    kerbZ: wallZ + from.towardZ * depth,
    depth,
    wall: from.distance,
  };
}

/** How far out from its wall a station's line crosses `level`, metres: held to the station's own ends. */
function outAt(station: ApronStation, level: number): number {
  return Math.min(station.depth, Math.max(0, station.wall - level));
}

/** The point `out` metres from a station's wall toward its kerb. */
function pointOf(station: ApronStation, out: number): readonly [x: number, z: number] {
  const share = out / station.depth;
  return [
    station.wallX + (station.kerbX - station.wallX) * share,
    station.wallZ + (station.kerbZ - station.wallZ) * share,
  ];
}

/**
 * The lines `stations`' columns are cut on. @see ShopApron.levels
 *
 * ⚠️ **On the ground's own bends, not every `piece` from the wall.** The
 * drawn ground is flat between two of its bends and creased on each — the
 * verge's foot 0.6 m outside the road's edge is one, where the ground stops
 * falling 0.25 m — so a piece laid across a bend stands off the crease by
 * the fall it bridges: up to 9 cm off its lift over the verge's foot, cut
 * evenly every 2 m (`shop-aprons.test.ts`' hillside, with no bends handed
 * in). Cut on the bends, a piece lies on one flat of the ground, to 5 mm.
 */
function levelsOf(stations: readonly ApronStation[], bends: readonly number[]): number[] {
  let nearest = Number.POSITIVE_INFINITY;
  let farthest = 0;
  for (const station of stations) {
    nearest = Math.min(nearest, station.wall - station.depth);
    farthest = Math.max(farthest, station.wall);
  }
  const marks = [
    nearest,
    ...bends.filter((bend) => bend > nearest + SLIVER_METRES && bend < farthest - SLIVER_METRES),
    farthest,
  ];
  const levels = [nearest];
  for (let at = 1; at < marks.length; at += 1) {
    const from = marks[at - 1] as number;
    const to = marks[at] as number;
    const pieces = Math.max(1, Math.ceil((to - from) / APRON.piece - 1e-9));
    for (let piece = 1; piece <= pieces; piece += 1) {
      levels.push(piece === pieces ? to : from + ((to - from) * piece) / pieces);
    }
  }
  return levels;
}

/** Less of a station's line than this between two levels, metres, and a triangle on it has no area. */
const NO_GROUND_METRES = SLIVER_METRES / 10;

/**
 * Every triangle of an apron, in the order they are written: for each column,
 * for each piece from the kerb to the wall, the piece's two — each handed to
 * `visit` as its three corners, a station and a level each.
 *
 * ⚠️ **A triangle, not a quad, is the unit.** Where a wall is not square to
 * the road a level can lie past the wall, or short of the kerb, at one of a
 * column's stations and not the other: that piece is a triangle, and the
 * other half of its quad has no area. A half with no ground in it is left
 * out, so nothing is uploaded or counted for it.
 */
function eachTriangle(
  stations: readonly ApronStation[],
  levels: readonly number[],
  visit: (
    first: ApronStation,
    firstLevel: number,
    second: ApronStation,
    secondLevel: number,
    third: ApronStation,
    thirdLevel: number,
  ) => void,
): void {
  for (let column = 0; column + 1 < stations.length; column += 1) {
    const a = stations[column] as ApronStation;
    const b = stations[column + 1] as ApronStation;
    for (let piece = 0; piece + 1 < levels.length; piece += 1) {
      const near = levels[piece] as number;
      const far = levels[piece + 1] as number;
      if (outAt(b, near) - outAt(b, far) > NO_GROUND_METRES) visit(a, near, b, near, b, far);
      if (outAt(a, near) - outAt(a, far) > NO_GROUND_METRES) visit(a, near, b, far, a, far);
    }
  }
}

/**
 * The ground between two stations, as a ring held {@link APRON}'s `inset`
 * inside the column on every side. Off the wall, so it does not meet the
 * building it lies before; and off its other three edges because the
 * planner's test for two rings meeting counts two edges on one line as
 * meeting wherever along it they are — and a column's side is on the line of
 * its own building's side wall, and on a neighbour's where two stand in a
 * row.
 */
function columnRing(a: ApronStation, b: ApronStation): Float32Array {
  const width = Math.hypot(b.wallX - a.wallX, b.wallZ - a.wallZ);
  const across = width > 0 ? Math.min(0.25, APRON.inset / width) : 0;
  const corner = (
    near: ApronStation,
    far: ApronStation,
    share: number,
  ): readonly [number, number] => {
    const [nearX, nearZ] = pointOf(near, near.depth * share);
    const [farX, farZ] = pointOf(far, far.depth * share);
    return [nearX + (farX - nearX) * across, nearZ + (farZ - nearZ) * across];
  };
  const out = (station: ApronStation): number => Math.min(0.25, APRON.inset / station.depth);
  return Float32Array.of(
    ...corner(a, b, out(a)),
    ...corner(b, a, out(b)),
    ...corner(b, a, 1 - out(b)),
    ...corner(a, b, 1 - out(a)),
  );
}

/** The outline of `stations`: along the wall, then back along the kerb's line. */
function outlineOf(stations: readonly ApronStation[]): Float32Array {
  const ring: number[] = [];
  for (const station of stations) ring.push(station.wallX, station.wallZ);
  for (let at = stations.length - 1; at >= 0; at -= 1) {
    const station = stations[at] as ApronStation;
    ring.push(station.kerbX, station.kerbZ);
  }
  return Float32Array.from(ring);
}

/**
 * The apron before `front`, or `undefined` where it gets none. @see the header
 *
 * Deterministic: a function of the front and of what `site` answers, with no
 * seed and no draw.
 */
export function shopApron(front: ApronFront, site: ApronSite): ShopApron | undefined {
  if (!(front.length > 0)) return undefined;
  const middle = site.beside(front.mx, front.mz);
  if (middle === undefined) return undefined;
  // A front turned away from the route, or end-on to it, is no shop front on it.
  if (front.nx * middle.towardX + front.nz * middle.towardZ < APRON.facing) return undefined;
  const columns = Math.max(1, Math.ceil(front.length / APRON.column));
  const stations: (ApronStation | undefined)[] = [];
  let deepest = 0;
  for (let at = 0; at <= columns; at += 1) {
    const along = -front.length / 2 + (front.length * at) / columns;
    const station = stationAt(front, site, along);
    stations.push(station);
    if (station !== undefined) deepest = Math.max(deepest, station.depth);
  }
  // Further back than that anywhere, and the ground before it is not a pavement's.
  if (!(deepest > 0) || deepest > APRON.deepest) return undefined;
  // The map's own pavement before this front: none of ours under or beside it.
  const reached = stations.filter((station) => station !== undefined);
  if (reached.length < 2) return undefined;
  if (site.footwayNear(outlineOf(reached))) return undefined;
  const cuts = levelsOf(reached, site.bends);
  const laid = (at: number): boolean => {
    const a = stations[at];
    const b = stations[at + 1];
    if (a === undefined || b === undefined) return false;
    for (const level of cuts) {
      if (!site.clear(...pointOf(a, outAt(a, level)))) return false;
      if (!site.clear(...pointOf(b, outAt(b, level)))) return false;
    }
    return site.free(columnRing(a, b));
  };
  // The longest unbroken run of columns, the first of two as long.
  let best = { from: 0, count: 0 };
  let from = 0;
  let count = 0;
  for (let at = 0; at < columns; at += 1) {
    if (!laid(at)) {
      count = 0;
      continue;
    }
    if (count === 0) from = at;
    count += 1;
    if (count > best.count) best = { from, count };
  }
  if (best.count === 0) return undefined;
  const kept = stations.slice(best.from, best.from + best.count + 1) as ApronStation[];
  // Cut again on the run's own nearest and farthest: a column dropped may have been either.
  const levels = levelsOf(kept, site.bends);
  let triangleCount = 0;
  eachTriangle(kept, levels, () => {
    triangleCount += 1;
  });
  if (triangleCount === 0) return undefined;
  return { stations: kept, levels, ring: outlineOf(kept), triangleCount };
}

/**
 * An apron's triangles in the order they are written ({@link eachTriangle}):
 * three corners a triangle, each `x, z`, then `across`, metres along the wall
 * from its middle, and `out`, metres from the wall. Four floats a corner,
 * twelve a triangle, {@link ShopApron.triangleCount} triangles.
 */
export function apronTriangles(apron: ShopApron): Float64Array {
  const out = new Float64Array(apron.triangleCount * 12);
  let at = 0;
  const write = (station: ApronStation, level: number): void => {
    const from = outAt(station, level);
    const [x, z] = pointOf(station, from);
    out[at] = x;
    out[at + 1] = z;
    out[at + 2] = station.along;
    out[at + 3] = from;
    at += 4;
  };
  eachTriangle(
    apron.stations,
    apron.levels,
    (first, firstLevel, second, secondLevel, third, thirdLevel) => {
      write(first, firstLevel);
      write(second, secondLevel);
      write(third, thirdLevel);
    },
  );
  return out;
}

// --- What the map draws before a front -----------------------------------

/** The side of a cell of {@link ApronObstacles}' grids, metres. */
const CELL_METRES = 32;

function cellKey(column: number, row: number): number {
  return (column + 0x8000) * 0x1_0000 + (row + 0x8000);
}

/**
 * The most cell entries a corridor's footways and streets may take in
 * {@link ApronObstacles}' grids: **2 000 000**, some 16 MiB. A segment is
 * filed under every cell its box touches, so a tile of long diagonal lines —
 * a map tile is untrusted input — would otherwise take a cell for every 32 m
 * square of each one's box. Past this the grids stop filing and say so
 * ({@link ApronObstacles.overflowed}), and the planner lays no apron at all:
 * grass, as before #2848, never paving over a street it did not read.
 */
const GRID_MAX_ENTRIES = 2_000_000;

/** How many cell entries {@link SegmentGrid}s may still take, shared between them. */
interface GridBudget {
  left: number;
  overflowed: boolean;
}

/** Segments in a grid: `ax, az, bx, bz` and one more float a segment. */
class SegmentGrid {
  readonly segments: number[] = [];
  readonly #cells = new Map<number, number[]>();
  readonly #budget: GridBudget;

  constructor(budget: GridBudget) {
    this.#budget = budget;
  }

  add(ax: number, az: number, bx: number, bz: number, extra: number, reach: number): void {
    if (this.#budget.overflowed || ![ax, az, bx, bz].every(Number.isFinite)) return;
    const firstColumn = Math.floor((Math.min(ax, bx) - reach) / CELL_METRES);
    const lastColumn = Math.floor((Math.max(ax, bx) + reach) / CELL_METRES);
    const lastRow = Math.floor((Math.max(az, bz) + reach) / CELL_METRES);
    const firstRow = Math.floor((Math.min(az, bz) - reach) / CELL_METRES);
    this.#budget.left -= (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1);
    if (this.#budget.left < 0) {
      this.#budget.overflowed = true;
      return;
    }
    const index = this.segments.length / 5;
    this.segments.push(ax, az, bx, bz, extra);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      for (let row = firstRow; row <= lastRow; row += 1) {
        const key = cellKey(column, row);
        const list = this.#cells.get(key);
        if (list === undefined) this.#cells.set(key, [index]);
        else list.push(index);
      }
    }
  }

  /** Every segment filed in the cell `(x, z)` is in: each within its own reach of the point is among them. */
  at(x: number, z: number): readonly number[] {
    return this.#cells.get(cellKey(Math.floor(x / CELL_METRES), Math.floor(z / CELL_METRES))) ?? [];
  }
}

/** The squared distance from `(x, z)` to the segment `a b`. */
function squaredToLine(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  return squaredToSegment(x, z, ax, az, dx, dz, dx * dx + dz * dz);
}

/** Which side of `a b` the point `c` is on: positive, negative, or nought on its line. */
function sideOf(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/** The squared distance between the segments `a b` and `c d`: nought where they cross. */
function squaredBetweenSegments(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  const crosses =
    sideOf(ax, az, bx, bz, cx, cz) * sideOf(ax, az, bx, bz, dx, dz) < 0 &&
    sideOf(cx, cz, dx, dz, ax, az) * sideOf(cx, cz, dx, dz, bx, bz) < 0;
  if (crosses) return 0;
  return Math.min(
    squaredToLine(ax, az, cx, cz, dx, dz),
    squaredToLine(bx, bz, cx, cz, dx, dz),
    squaredToLine(cx, cz, ax, az, bx, bz),
    squaredToLine(dx, dz, ax, az, bx, bz),
  );
}

/** Whether `(x, z)` is inside `ring`, by the even-odd rule. */
function insideRing(ring: Float32Array, x: number, z: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Whether a mapped street heading `(dx, dz)` at its point `(x, z)` is the
 * route's own there: on the drawn road, and along it rather than across it or
 * off it. `footprint-buildings.ts` answers with `cross-streets.ts`' own
 * tolerance and angle, so what the cross streets call the route — and never
 * draw as a side road — is the route here, and stops no apron beside it.
 */
export type AlongRoute = (x: number, z: number, dx: number, dz: number) => boolean;

/**
 * A corridor's mapped footways and streets, in grids — #2848: what an apron
 * may not lie under ({@link ApronObstacles.footwayNear}) or on
 * ({@link ApronObstacles.onStreet}). Built
 * once a ride, at the press, and only when a front asks.
 *
 * A street in a `tunnel` is under the ground and stops nothing; every other
 * — at grade or on a bridge, whose embankment stands on the ground — does,
 * across its drawn width (`cross-streets.ts` §`SIDE_ROAD_WIDTHS`) and
 * {@link APRON}'s `street` beside it.
 */
export class ApronObstacles {
  readonly #budget: GridBudget;
  readonly #footways: SegmentGrid;
  readonly #streets: SegmentGrid;
  readonly #alongRoute: AlongRoute;

  constructor(
    paths: readonly PathFeature[],
    streets: readonly StreetFeature[],
    alongRoute: AlongRoute,
    /** How far round a point a footway is looked for, metres: an apron's reach and the margin. */
    footwayReach: number = APRON.deepest + APRON.column + APRON.footway,
    /** The most cell entries the grids take; past it they stop, and {@link overflowed} says so. */
    maxEntries: number = GRID_MAX_ENTRIES,
  ) {
    this.#alongRoute = alongRoute;
    this.#budget = { left: maxEntries, overflowed: false };
    this.#footways = new SegmentGrid(this.#budget);
    this.#streets = new SegmentGrid(this.#budget);
    for (const path of paths) {
      if (!isFootway(path)) continue;
      const line = path.line;
      for (let at = 0; at + 3 < line.length; at += 2) {
        this.#footways.add(
          line[at] as number,
          line[at + 1] as number,
          line[at + 2] as number,
          line[at + 3] as number,
          0,
          footwayReach,
        );
      }
    }
    for (const street of streets) {
      if (street.grade === 'tunnel') continue;
      const half = SIDE_ROAD_WIDTHS[widthClassOf(street)] / 2 + APRON.street;
      const line = street.line;
      for (let at = 0; at + 3 < line.length; at += 2) {
        this.#streets.add(
          line[at] as number,
          line[at + 1] as number,
          line[at + 2] as number,
          line[at + 3] as number,
          half,
          half,
        );
      }
    }
  }

  /**
   * Whether the corridor's footways and streets were more than the grids
   * take, so that some were not filed: what the grids answer is then no
   * longer the whole map, and the planner lays no apron by it.
   */
  get overflowed(): boolean {
    return this.#budget.overflowed;
  }

  /**
   * Whether a mapped footway comes within {@link APRON}'s `footway` of `ring`
   * or lies inside it. `ring` is an apron's ground, so no wider or deeper
   * than the reach the footways were filed with.
   */
  footwayNear(ring: Float32Array): boolean {
    const n = ring.length / 2;
    const near = APRON.footway * APRON.footway;
    const s = this.#footways.segments;
    const seen = new Set<number>();
    for (let i = 0; i < n; i += 1) {
      const px = ring[i * 2] as number;
      const pz = ring[i * 2 + 1] as number;
      for (const segment of this.#footways.at(px, pz)) {
        if (seen.has(segment)) continue;
        seen.add(segment);
        const ax = s[segment * 5] as number;
        const az = s[segment * 5 + 1] as number;
        const bx = s[segment * 5 + 2] as number;
        const bz = s[segment * 5 + 3] as number;
        if (insideRing(ring, ax, az) || insideRing(ring, bx, bz)) return true;
        for (let k = 0, l = n - 1; k < n; l = k, k += 1) {
          const apart = squaredBetweenSegments(
            ax,
            az,
            bx,
            bz,
            ring[l * 2] as number,
            ring[l * 2 + 1] as number,
            ring[k * 2] as number,
            ring[k * 2 + 1] as number,
          );
          if (apart <= near) return true;
        }
      }
    }
    return false;
  }

  /**
   * Whether `(x, z)` is on a mapped street, or within the margin of one —
   * but for the route's own: where the nearest point of the street is on the
   * route and the street runs along it there ({@link AlongRoute}). So the
   * route's street, mapped a little off the drawn road, stops nothing; a
   * street the route turns off stops an apron only past the turn; and a side
   * road stops it from the kerb out.
   */
  onStreet(x: number, z: number): boolean {
    const s = this.#streets.segments;
    for (const segment of this.#streets.at(x, z)) {
      const ax = s[segment * 5] as number;
      const az = s[segment * 5 + 1] as number;
      const dx = (s[segment * 5 + 2] as number) - ax;
      const dz = (s[segment * 5 + 3] as number) - az;
      const half = s[segment * 5 + 4] as number;
      const span = dx * dx + dz * dz;
      const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
      const nearX = ax + dx * t;
      const nearZ = az + dz * t;
      if ((x - nearX) ** 2 + (z - nearZ) ** 2 > half * half) continue;
      if (!this.#alongRoute(nearX, nearZ, dx, dz)) return true;
    }
    return false;
  }
}
