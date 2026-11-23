// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Nearby streets — #2973: the mapped streets of the corridor off the route —
 * the parallel streets, the streets beyond a junction's stub, the driveways
 * and the parking aisles — drawn as road surface out to the fog, so a
 * neighbourhood reads as streets and not as houses standing in a field. Until
 * #2973 only the route and a 60 m stub at each junction (`cross-streets.ts`)
 * were drawn.
 *
 * ## Which streets
 *
 * Every `ground` street of `WorldCorridor.streets` — a bridge or a tunnel is
 * `overpasses.ts`'s where it crosses the route, and is not drawn here. A
 * `highway` at ground is drawn too, at its class's width. Each is resampled
 * every {@link NEARBY_STREET_STEP_METRES} along its line, and a station is
 * drawn only:
 *
 * - on land that was read (`WorldCorridor.covered`);
 * - **off the route**: for a street that never touches it, with its edge off
 *   the main road's verge — at least `landform.ts` §`ROAD_CLEARANCE_METRES`
 *   and its own half-width from ANY stretch of the drawn road. A street that
 *   **touches** the route (a point of it, resampled as `cross-streets.ts`
 *   §`mappedJunctions` resamples it, within `cross-streets.ts`
 *   §`JUNCTION_TOLERANCE_METRES` of the drawn road on land that was read) is
 *   the junctions' near the route: its stub there stays exactly as it was,
 *   and it is drawn here only from {@link NEARBY_STREET_HANDOVER_METRES} off
 *   the road — where every stub is still at its full width and height, before
 *   its fade — so the street runs on from its stub instead of stopping at it.
 *   Over the stretch both draw, this one stands above the stub
 *   ({@link nearbyStreetLift} is more than `cross-streets.ts`
 *   §`SIDE_ROAD_LIFT_METRES`), so the stub's fade is under it and unseen;
 * - **off an overpass's road** (`overpasses.ts` §`GradeCrossing.approaches`):
 *   not within {@link OVERPASS_ROAD_CLEAR_METRES} of a bridge's crossing and
 *   its half-width and `overpasses.ts` §`EMBANKMENT_MAX_RUN_METRES` of the
 *   street it carries, which that file draws on its ramp and its banks;
 * - for a service road — a driveway, a parking aisle, an alley
 *   (`cross-streets.ts` §`widthClassOf`) — clear of every mapped footprint by
 *   its half-width and {@link SERVICE_FOOTPRINT_MARGIN_METRES}. ⚠️ A driveway
 *   ends AT the house, so a service road gives way to a building where a
 *   street does not: the driveway stops short of the wall, and the house is
 *   kept.
 *
 * The runs left are cut into {@link NearbyStreetPiece}s of at most
 * {@link NEARBY_STREET_PIECE_STEPS} steps, which share their end stations so
 * that one street drawn as several pieces has no gap.
 *
 * ## ⚠️ The road wins — what may not stand on one
 *
 * - **A mapped building** (`footprint-buildings.ts` rule 3b): a footprint that
 *   comes within {@link NEARBY_STREET_STRUCTURE_MARGIN_METRES} of any piece's
 *   edge is dropped as `on-street` ({@link onNearbyStreet}), ADR 0054 D-5.4's
 *   rule extended from the ridden road to every street drawn — the open-world
 *   issue #2903 asks for exactly this against a whole network.
 * - **Everything else** — scatter, structures, billboards, people: each piece
 *   in view is a `cross-streets.ts` §`SideRoad`, appended to the frame's side
 *   roads (`scene.ts`), so `clearOfSideRoads`, `boardsClearOfSideRoads` and
 *   `people.ts` §`besideSideRoads` keep everything off it as off a stub.
 *
 * ## What is drawn
 *
 * {@link streetRibbon}: a strip of the class's width (`cross-streets.ts`
 * §`SIDE_ROAD_WIDTHS`; a service road **3.5 m**, a minor street **5.5 m**)
 * along the stations, each row standing on the drawn ground
 * (`landform.ts` §`terrainHeightAt`, with the ride's land mask, so on mapped
 * built-up land it stands on #1547's levelled ground) and lifted above it by
 * {@link nearbyStreetLift} — more the farther it is from the road, since the
 * depth buffer's precision falls with distance. A row on water
 * (`waterways.ts` §`inWater`) or beyond the last column of drawn ground breaks
 * the strip. No give-way line, no fade: it is a street in its own right, not
 * a stub.
 *
 * ⚠️ **Shared, not the trainer game's own** (#2903's lane note): the ribbon
 * takes a polyline, a half-width and a {@link StreetGround}, and names no
 * route. A route ride hands it {@link routeGround}; the open world's street
 * graph hands it its own ground and draws its side streets with the same
 * function, into the same mesh.
 *
 * ## Cost
 *
 * Drawn by `three-renderer.ts` §`SideRoadBelt`, in the road's own material
 * and in its ONE draw call — no draw call, texture or material more. A frame
 * draws the {@link NEARBY_STREETS_PER_FRAME} pieces nearest the rider, at
 * most {@link NEARBY_STREET_TRIANGLES_PER_PIECE} triangles each, so at most
 * {@link NEARBY_STREET_FRAME_TRIANGLES} however many streets a town has.
 * Outside `realistic-budget.ts` §`REALISTIC_FRAME_TRIANGLES` by the side
 * roads' own rule: they are the same triangles in both worlds. The pieces in
 * view are chosen again only when the rider has moved on
 * {@link NEARBY_STREET_REFRESH_METRES}, so the belt rebuilds its mesh at most
 * once every so often and not every frame; each piece's mesh is built the
 * first time it is in view and kept.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. It reads
 * a street's `kind`, `kindDetail`, `grade` and line, and never a name.
 *
 * Pure, cached per corridor, and names no rendering library.
 */

import { elevationAt, type RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature, StreetFeature } from '@onyourleft/map-features';

import {
  JUNCTION_MIN_ANGLE_DEGREES,
  JUNCTION_TOLERANCE_METRES,
  resampled,
  SIDE_ROAD_FADE_METRES,
  SIDE_ROAD_METRES,
  SIDE_ROAD_STRUCTURE_MARGIN_METRES,
  SIDE_ROAD_WIDTHS,
  STREET_MAX_METRES,
  TARMAC,
  widthClassOf,
  type SideRoad,
  type SideRoadMesh,
  type WidthClass,
} from './cross-streets';
import { NO_LAND_CLASS, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES, TERRAIN_COLUMN_OFFSETS, terrainHeightAt } from './landform';
import { distanceToDrawnRoad, nearestOnDrawnRoad, type NearestOnRoad } from './road-grid';
import { sceneryAnchor } from './scenery-anchor';
import {
  APPROACH_METRES,
  EMBANKMENT_MAX_RUN_METRES,
  mappedGradeCrossings,
  type GradeCrossing,
} from './overpasses';
import {
  drawnRoadFrame,
  drawnRoadPosition,
  ROAD_WIDTH_METRES,
  type CorridorOrigin,
} from './terrain';
import { inWater, waterways } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** How far apart a nearby street's stations, and so its rows, are, in metres: **4**. */
export const NEARBY_STREET_STEP_METRES = 4;

/** The most steps one piece is: **16**, so a piece is at most 64 m of street. */
export const NEARBY_STREET_PIECE_STEPS = 16;

/** A run of stations shorter than this, in metres, is not drawn: **8** — a sliver, not a street. */
export const NEARBY_STREET_MIN_METRES = 8;

/**
 * How far from the rider nearby streets are drawn, in metres: **400**, the
 * fog's full depth (`three-renderer.ts` §`FOGGED_OUT_METRES`, which this file
 * cannot import: it names no rendering library). `nearby-streets.test.ts`
 * holds the two equal.
 */
export const NEARBY_STREET_VIEW_METRES = 400;

/**
 * How far the rider rides before the pieces in view are chosen again, in
 * metres: **40**. Chosen about the last multiple of this, out to
 * {@link NEARBY_STREET_VIEW_METRES} and this much more, so the fog's edge is
 * always reached.
 */
export const NEARBY_STREET_REFRESH_METRES = 40;

/** The most pieces a frame draws: **256**, the nearest the rider first. */
export const NEARBY_STREETS_PER_FRAME = 256;

/** The most triangles one piece is: **32**, a quad a step. */
export const NEARBY_STREET_TRIANGLES_PER_PIECE = 2 * NEARBY_STREET_PIECE_STEPS;

/**
 * The most triangles a frame's nearby streets add: **8 192**, in either
 * world, inside the side roads' one draw call. @see the header
 *
 * @test-facing held by `nearby-streets.test.ts`, which counts a dense town's
 * frame against it; the frame is bounded by the two constants it is made of
 */
export const NEARBY_STREET_FRAME_TRIANGLES =
  NEARBY_STREETS_PER_FRAME * NEARBY_STREET_TRIANGLES_PER_PIECE;

/**
 * How far off the drawn road a street that touches the route is drawn from,
 * in metres: **23.5** — the main road's half-width and the least a stub runs
 * before its fade, `cross-streets.ts` §`SIDE_ROAD_METRES` less
 * §`SIDE_ROAD_FADE_METRES`, at the shallowest junction there is
 * (§`JUNCTION_MIN_ANGLE_DEGREES`, 30°: half of it is lateral). Every stub is
 * at its full width and height there. @see the header
 */
export const NEARBY_STREET_HANDOVER_METRES =
  ROAD_WIDTH_METRES / 2 +
  (SIDE_ROAD_METRES - SIDE_ROAD_FADE_METRES) *
    Math.sin((JUNCTION_MIN_ANGLE_DEGREES * Math.PI) / 180);

/**
 * How far from a bridge's crossing its street is left to `overpasses.ts`, in
 * metres: **220** — its approach's `overpasses.ts` §`APPROACH_METRES` past a
 * deck of some 60 m.
 */
export const OVERPASS_ROAD_CLEAR_METRES = APPROACH_METRES + 60;

/** How far above the ground a nearby street stands beside the road, in metres: **0.05**. */
export const NEARBY_STREET_LIFT_METRES = 0.05;

/** How much higher it stands for every metre farther from the road: **0.5 mm**, 0.25 m at the fog. */
export const NEARBY_STREET_LIFT_PER_METRE = 0.0005;

/** How far above the ground a nearby street `metres` from the drawn road stands. @see the header */
export function nearbyStreetLift(metres: number): number {
  return NEARBY_STREET_LIFT_METRES + NEARBY_STREET_LIFT_PER_METRE * Math.max(0, metres);
}

/** How far off a nearby street's edge no mapped footprint may come, in metres: the side roads' **0.5**. */
export const NEARBY_STREET_STRUCTURE_MARGIN_METRES = SIDE_ROAD_STRUCTURE_MARGIN_METRES;

/**
 * How far past its half-width a service road stops short of a mapped
 * footprint, in metres: **1** — the structure margin, and
 * `footprint-buildings.ts` §`FOOTPRINT_SIMPLIFY_METRES`'s half-metre, since
 * the footprint drawn is the simplified ring and this measures the mapped one.
 */
export const SERVICE_FOOTPRINT_MARGIN_METRES = NEARBY_STREET_STRUCTURE_MARGIN_METRES + 0.5;

/** The last column of drawn ground, in metres from the road: **420**. Past it there is none. */
const GROUND_LATERAL_METRES = TERRAIN_COLUMN_OFFSETS[TERRAIN_COLUMN_OFFSETS.length - 1] as number;

/** One drawable stretch of a nearby street. */
export interface NearbyStreetPiece {
  readonly widthClass: WidthClass;
  /** Its stations, `x0, z0, x1, z1, …`, local metres, at most {@link NEARBY_STREET_PIECE_STEPS} + 1. */
  readonly line: Float32Array;
  /** Its stations' box in plan. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /**
   * #3105: a piece of a street on a mapped bridge, on an open-world ride:
   * drawn as a deck ({@link deckGround}), over water too. Absent on a street
   * on the ground.
   */
  readonly deck?: true;
}

/** A corridor's nearby streets: what {@link nearbyStreets} finds once a corridor. */
export interface NearbyStreets {
  readonly pieces: readonly NearbyStreetPiece[];
  /** Each piece's centreline segments, five floats each: `ax, az, bx, bz, half`. */
  readonly segments: Float32Array;
  /** The segments by {@link SEGMENT_CELL_METRES} cell. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
}

/** No nearby streets: a ride with no map data. */
export const NO_NEARBY_STREETS: NearbyStreets = {
  pieces: [],
  segments: new Float32Array(0),
  cells: new Map(),
};

/** The cell of the segments' and the footprints' grids, in metres: **32**. */
const SEGMENT_CELL_METRES = 32;

/** One cell's key: column and row packed, each offset to stay positive. */
function cellKey(column: number, row: number): number {
  return (column + 32_768) * 65_536 + (row + 32_768);
}

// --- Geometry --------------------------------------------------------------

function squaredToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  const ox = x - (ax + dx * t);
  const oz = z - (az + dz * t);
  return ox * ox + oz * oz;
}

/** Whether `(x, z)` is inside a ring of `x, z` pairs, by crossings. */
function insideRing(ring: ArrayLike<number>, x: number, z: number): boolean {
  const n = Math.floor(ring.length / 2);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The squared distance from `(x, z)` to a ring's nearest edge. */
function squaredToRing(ring: ArrayLike<number>, x: number, z: number): number {
  const n = Math.floor(ring.length / 2);
  let least = Number.POSITIVE_INFINITY;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    least = Math.min(
      least,
      squaredToSegment(
        x,
        z,
        ring[j * 2] as number,
        ring[j * 2 + 1] as number,
        ring[i * 2] as number,
        ring[i * 2 + 1] as number,
      ),
    );
  }
  return least;
}

/** Whether two segments cross or touch. */
function segmentsMeet(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return (
    side(ax, az, bx, bz, cx, cz) * side(ax, az, bx, bz, dx, dz) <= 0 &&
    side(cx, cz, dx, dz, ax, az) * side(cx, cz, dx, dz, bx, bz) <= 0
  );
}

/** The squared distance between two segments. */
function segmentToSegmentSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsMeet(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  return Math.min(
    squaredToSegment(cx, cz, ax, az, bx, bz),
    squaredToSegment(dx, dz, ax, az, bx, bz),
    squaredToSegment(ax, az, cx, cz, dx, dz),
    squaredToSegment(bx, bz, cx, cz, dx, dz),
  );
}

// --- Finding them ------------------------------------------------------------

/** A street's stations every {@link NEARBY_STREET_STEP_METRES} by arc length, its end kept, drawn from `budget`. */
function stationsOf(line: Float32Array, budget: { metres: number }): number[] {
  const out: number[] = [];
  let carried = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    const ax = line[at] as number;
    const az = line[at + 1] as number;
    const bx = line[at + 2] as number;
    const bz = line[at + 3] as number;
    if (![ax, az, bx, bz].every(Number.isFinite)) break;
    if (at === 0) out.push(ax, az);
    const length = Math.hypot(bx - ax, bz - az);
    if (length > budget.metres) {
      budget.metres = 0;
      break;
    }
    budget.metres -= length;
    let next = NEARBY_STREET_STEP_METRES - carried;
    while (next <= length) {
      out.push(ax + ((bx - ax) * next) / length, az + ((bz - az) * next) / length);
      next += NEARBY_STREET_STEP_METRES;
    }
    carried = length - (next - NEARBY_STREET_STEP_METRES);
  }
  // The street's own end, unless the last station already is it.
  const endX = line[line.length - 2];
  const endZ = line[line.length - 1];
  if (
    out.length >= 2 &&
    endX !== undefined &&
    endZ !== undefined &&
    Number.isFinite(endX) &&
    Number.isFinite(endZ) &&
    budget.metres > 0 &&
    Math.hypot(endX - (out[out.length - 2] as number), endZ - (out[out.length - 1] as number)) >
      0.01
  ) {
    out.push(endX, endZ);
  }
  return out;
}

/** Whether a street touches the route: `cross-streets.ts` §`mappedJunctions`' own test, point for point. */
function touchesRoute(
  street: StreetFeature,
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  budget: { metres: number },
): boolean {
  const points = resampled(street.line, budget);
  for (let at = 0; at + 1 < points.length; at += 2) {
    const x = points[at] as number;
    const z = points[at + 1] as number;
    if (
      corridor.covered(x, z) &&
      nearestOnDrawnRoad(profile, origin, x, z, JUNCTION_TOLERANCE_METRES) !== undefined
    ) {
      return true;
    }
  }
  return false;
}

/** The corridor's footprints' outer rings in a grid, for a service road's clearance. */
class FootprintGrid {
  readonly #cells = new Map<number, number[]>();
  readonly #rings: readonly Float32Array[];

  constructor(buildings: readonly BuildingFeature[]) {
    this.#rings = buildings.map((building) => building.rings[0] ?? new Float32Array(0));
    for (const [index, ring] of this.#rings.entries()) {
      if (ring.length < 6) continue;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (let at = 0; at + 1 < ring.length; at += 2) {
        minX = Math.min(minX, ring[at] as number);
        maxX = Math.max(maxX, ring[at] as number);
        minZ = Math.min(minZ, ring[at + 1] as number);
        maxZ = Math.max(maxZ, ring[at + 1] as number);
      }
      if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
      for (
        let column = Math.floor(minX / SEGMENT_CELL_METRES);
        column <= Math.floor(maxX / SEGMENT_CELL_METRES);
        column += 1
      ) {
        for (
          let row = Math.floor(minZ / SEGMENT_CELL_METRES);
          row <= Math.floor(maxZ / SEGMENT_CELL_METRES);
          row += 1
        ) {
          const key = cellKey(column, row);
          const cell = this.#cells.get(key);
          if (cell === undefined) this.#cells.set(key, [index]);
          else cell.push(index);
        }
      }
    }
  }

  /** Whether `(x, z)` is inside a footprint or within `clear` of one. */
  near(x: number, z: number, clear: number): boolean {
    const seen = new Set<number>();
    for (
      let column = Math.floor((x - clear) / SEGMENT_CELL_METRES);
      column <= Math.floor((x + clear) / SEGMENT_CELL_METRES);
      column += 1
    ) {
      for (
        let row = Math.floor((z - clear) / SEGMENT_CELL_METRES);
        row <= Math.floor((z + clear) / SEGMENT_CELL_METRES);
        row += 1
      ) {
        for (const index of this.#cells.get(cellKey(column, row)) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const ring = this.#rings[index] as Float32Array;
          if (insideRing(ring, x, z) || squaredToRing(ring, x, z) < clear * clear) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Whether `(x, z)` is on a bridge's street as `overpasses.ts` draws it, or
 * its banks: within {@link OVERPASS_ROAD_CLEAR_METRES} of the crossing, and
 * within `half` and the widest bank of the street it carries.
 */
function onOverpassRoad(
  bridges: readonly GradeCrossing[],
  x: number,
  z: number,
  half: number,
): boolean {
  const clear = half + EMBANKMENT_MAX_RUN_METRES;
  for (const bridge of bridges) {
    if (Math.hypot(x - bridge.x, z - bridge.z) > OVERPASS_ROAD_CLEAR_METRES + clear) continue;
    for (const line of bridge.approaches) {
      for (let at = 0; at + 3 < line.length; at += 2) {
        if (
          squaredToSegment(
            x,
            z,
            line[at] as number,
            line[at + 1] as number,
            line[at + 2] as number,
            line[at + 3] as number,
          ) <
          clear * clear
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** One corridor's nearby streets, kept with the profile they were found against. */
const found = new WeakMap<WorldCorridor, { profile: RouteProfile; streets: NearbyStreets }>();

/**
 * Every nearby street of a corridor, cut into pieces — #2973. Built once per
 * corridor and route, the same object after. @see the header
 */
export function nearbyStreets(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): NearbyStreets {
  const cached = found.get(corridor);
  if (cached?.profile === profile) return cached.streets;
  const pieces: NearbyStreetPiece[] = [];
  const touchBudget = { metres: STREET_MAX_METRES };
  const drawBudget = { metres: STREET_MAX_METRES };
  let footprints: FootprintGrid | undefined;
  const bridges = mappedGradeCrossings(corridor, profile, origin).filter(
    (crossing) => crossing.grade === 'bridge',
  );
  // #3105: an open-world ride draws a side street's bridge too, as a deck. A
  // route ride leaves every bridge to `overpasses.ts`, as before, and a
  // tunnel is under the ground on both.
  const decks = sceneryAnchor(profile) !== undefined;
  for (const street of corridor.streets) {
    const deck = decks && street.grade === 'bridge';
    if (street.grade !== 'ground' && !deck) continue;
    const widthClass = widthClassOf(street);
    const half = SIDE_ROAD_WIDTHS[widthClass] / 2;
    const clearOfRoad = touchesRoute(street, corridor, profile, origin, touchBudget)
      ? NEARBY_STREET_HANDOVER_METRES
      : ROAD_CLEARANCE_METRES + half;
    const stations = stationsOf(street.line, drawBudget);
    const count = stations.length / 2;
    const kept = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const x = stations[index * 2] as number;
      const z = stations[index * 2 + 1] as number;
      if (!corridor.covered(x, z)) continue;
      if (distanceToDrawnRoad(profile, origin, x, z, clearOfRoad + 1) < clearOfRoad) continue;
      if (onOverpassRoad(bridges, x, z, half)) continue;
      if (widthClass === 'service') {
        footprints ??= new FootprintGrid(corridor.buildings);
        if (footprints.near(x, z, half + SERVICE_FOOTPRINT_MARGIN_METRES)) continue;
      }
      kept[index] = 1;
    }
    // Each run of kept stations, in pieces of at most `NEARBY_STREET_PIECE_STEPS` steps.
    let start = 0;
    while (start < count) {
      if (kept[start] !== 1) {
        start += 1;
        continue;
      }
      let end = start;
      while (end + 1 < count && kept[end + 1] === 1) end += 1;
      let metres = 0;
      for (let index = start; index < end; index += 1) {
        metres += Math.hypot(
          (stations[index * 2 + 2] as number) - (stations[index * 2] as number),
          (stations[index * 2 + 3] as number) - (stations[index * 2 + 1] as number),
        );
      }
      if (metres >= NEARBY_STREET_MIN_METRES) {
        for (let from = start; from < end; from += NEARBY_STREET_PIECE_STEPS) {
          const to = Math.min(end, from + NEARBY_STREET_PIECE_STEPS);
          pieces.push(pieceOf(widthClass, stations.slice(from * 2, to * 2 + 2), deck));
        }
      }
      start = end + 1;
    }
  }
  const streets = withSegments(pieces);
  found.set(corridor, { profile, streets });
  return streets;
}

function pieceOf(widthClass: WidthClass, line: number[], deck = false): NearbyStreetPiece {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let at = 0; at + 1 < line.length; at += 2) {
    minX = Math.min(minX, line[at] as number);
    maxX = Math.max(maxX, line[at] as number);
    minZ = Math.min(minZ, line[at + 1] as number);
    maxZ = Math.max(maxZ, line[at + 1] as number);
  }
  return {
    widthClass,
    line: Float32Array.from(line),
    minX,
    maxX,
    minZ,
    maxZ,
    ...(deck ? { deck: true as const } : {}),
  };
}

/** The pieces, with their segments flat and in a grid for {@link onNearbyStreet}. */
function withSegments(pieces: readonly NearbyStreetPiece[]): NearbyStreets {
  const flat: number[] = [];
  const cells = new Map<number, number[]>();
  for (const piece of pieces) {
    const half = SIDE_ROAD_WIDTHS[piece.widthClass] / 2;
    const s = piece.line;
    for (let at = 0; at + 3 < s.length; at += 2) {
      const ax = s[at] as number;
      const az = s[at + 1] as number;
      const bx = s[at + 2] as number;
      const bz = s[at + 3] as number;
      const index = flat.length / 5;
      flat.push(ax, az, bx, bz, half);
      for (
        let column = Math.floor((Math.min(ax, bx) - half) / SEGMENT_CELL_METRES);
        column <= Math.floor((Math.max(ax, bx) + half) / SEGMENT_CELL_METRES);
        column += 1
      ) {
        for (
          let row = Math.floor((Math.min(az, bz) - half) / SEGMENT_CELL_METRES);
          row <= Math.floor((Math.max(az, bz) + half) / SEGMENT_CELL_METRES);
          row += 1
        ) {
          const key = cellKey(column, row);
          const cell = cells.get(key);
          if (cell === undefined) cells.set(key, [index]);
          else cell.push(index);
        }
      }
    }
  }
  return { pieces, segments: Float32Array.from(flat), cells };
}

/**
 * Whether a footprint's outline `ring` (`x, z` pairs) comes within `margin`
 * of any nearby street's edge — its segments' centrelines less their
 * half-widths, or a centreline inside it. `footprint-buildings.ts` rule 3b
 * drops such a footprint: the road wins (ADR 0054 D-5.4).
 */
export function onNearbyStreet(
  streets: NearbyStreets,
  ring: ArrayLike<number>,
  margin: number,
): boolean {
  if (streets.pieces.length === 0 || ring.length < 6) return false;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let at = 0; at + 1 < ring.length; at += 2) {
    minX = Math.min(minX, ring[at] as number);
    maxX = Math.max(maxX, ring[at] as number);
    minZ = Math.min(minZ, ring[at + 1] as number);
    maxZ = Math.max(maxZ, ring[at + 1] as number);
  }
  const s = streets.segments;
  const n = Math.floor(ring.length / 2);
  const seen = new Set<number>();
  for (
    let column = Math.floor((minX - margin) / SEGMENT_CELL_METRES);
    column <= Math.floor((maxX + margin) / SEGMENT_CELL_METRES);
    column += 1
  ) {
    for (
      let row = Math.floor((minZ - margin) / SEGMENT_CELL_METRES);
      row <= Math.floor((maxZ + margin) / SEGMENT_CELL_METRES);
      row += 1
    ) {
      for (const segment of streets.cells.get(cellKey(column, row)) ?? []) {
        if (seen.has(segment)) continue;
        seen.add(segment);
        const at = segment * 5;
        const ax = s[at] as number;
        const az = s[at + 1] as number;
        const bx = s[at + 2] as number;
        const bz = s[at + 3] as number;
        const clear = (s[at + 4] as number) + margin;
        if (insideRing(ring, ax, az)) return true;
        for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
          if (
            segmentToSegmentSquared(
              ring[j * 2] as number,
              ring[j * 2 + 1] as number,
              ring[i * 2] as number,
              ring[i * 2 + 1] as number,
              ax,
              az,
              bx,
              bz,
            ) <
            clear * clear
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// --- The ribbon: shared with the open world (#2903) -------------------------

/**
 * The ground a street stands on, as the ribbon asks it — #2903 shares it.
 * `about(x, z)` answers for one station: how high to stand a vertex near it,
 * lift included, or `undefined` where no ground is drawn there (off the drawn
 * ground, on water), which breaks the ribbon.
 */
export interface StreetGround {
  about(x: number, z: number): ((x: number, z: number) => number) | undefined;
}

/** A street drawn: its triangles and its centreline segments, as a `SideRoad` carries them. */
export interface StreetRibbon {
  readonly mesh: SideRoadMesh;
  /** Each drawn segment, four floats: `ax, az, bx, bz`. */
  readonly segments: Float32Array;
  /** Each drawn segment's half-width. */
  readonly halfWidths: Float32Array;
}

/**
 * A street's stations as road surface — #2973, and #2903's side streets: a
 * row across every station, `half` either side of it, square to the line
 * there; a quad between every two rows that both have ground; tarmac, with
 * `across` running from `−half` to `half` for #628's wear, as a side road's
 * does. Pure: names no route.
 */
export function streetRibbon(line: Float32Array, half: number, ground: StreetGround): StreetRibbon {
  const positions: number[] = [];
  const colours: number[] = [];
  const across: number[] = [];
  const indices: number[] = [];
  const segments: number[] = [];
  const halfWidths: number[] = [];
  const count = Math.floor(line.length / 2);
  /** The vertex index of each station's left edge, or −1 where it has no ground. */
  let previous = -1;
  for (let index = 0; index < count; index += 1) {
    const x = line[index * 2] as number;
    const z = line[index * 2 + 1] as number;
    const before = Math.max(0, index - 1);
    const after = Math.min(count - 1, index + 1);
    let dx = (line[after * 2] as number) - (line[before * 2] as number);
    let dz = (line[after * 2 + 1] as number) - (line[before * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    const height = length > 0 ? ground.about(x, z) : undefined;
    if (height === undefined) {
      previous = -1;
      continue;
    }
    dx /= length;
    dz /= length;
    // Across the street: its direction turned a quarter, as a side road's is.
    const ax = dz;
    const az = -dx;
    const lx = x - ax * half;
    const lz = z - az * half;
    const rx = x + ax * half;
    const rz = z + az * half;
    const left = positions.length / 3;
    positions.push(lx, height(lx, lz), lz, rx, height(rx, rz), rz);
    colours.push(...TARMAC, ...TARMAC);
    across.push(-half, half);
    if (previous >= 0) {
      indices.push(previous, left, left + 1, previous, left + 1, previous + 1);
      segments.push(line[index * 2 - 2] as number, line[index * 2 - 1] as number, x, z);
      halfWidths.push(half);
    }
    previous = left;
  }
  return {
    mesh: {
      positions: Float32Array.from(positions),
      colours: Float32Array.from(colours),
      across: Float32Array.from(across),
      indices: Uint32Array.from(indices),
    },
    segments: Float32Array.from(segments),
    halfWidths: Float32Array.from(halfWidths),
  };
}

// --- A route ride's ground, and the pieces in view ---------------------------

/** How far the first nearest-road search reaches, doubled until it finds the road. */
const FIRST_REACH_METRES = 32;

/**
 * The drawn ground about a route ride's streets: `landform.ts`
 * §`terrainHeightAt` beside the stretch of drawn road each station is
 * nearest, with the ride's `land`, lifted by {@link nearbyStreetLift}; none on
 * water or past the last column of drawn ground. A vertex beside a station is
 * read in the frame of the road at that station's nearest point. Each search
 * for the nearest stretch reaches only as far as the last station's distance
 * and the step since, which is exact: a point moved `d` is at most `d` nearer
 * or farther from anything.
 */
export function routeGround(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask = NO_LAND_CLASS,
): StreetGround {
  const ways = waterways(profile, seed, land);
  let last: { x: number; z: number; distance: number } | undefined;
  return {
    about(x, z) {
      let near: NearestOnRoad | undefined;
      if (last !== undefined) {
        near = nearestOnDrawnRoad(
          profile,
          origin,
          x,
          z,
          last.distance + Math.hypot(x - last.x, z - last.z) + 1,
        );
      }
      for (let reach = FIRST_REACH_METRES; near === undefined; reach *= 2) {
        near = nearestOnDrawnRoad(profile, origin, x, z, reach);
        if (reach > GROUND_LATERAL_METRES * 2) break;
      }
      if (near === undefined) {
        last = undefined;
        return undefined;
      }
      last = { x, z, distance: near.distance };
      if (near.distance > GROUND_LATERAL_METRES) return undefined;
      if (inWater(ways, profile, near.along, near.lateral)) return undefined;
      const frame = drawnRoadFrame(profile, origin, near.along);
      if (frame === undefined) return undefined;
      const { along, lateral } = near;
      const lift = nearbyStreetLift(near.distance);
      return (vx, vz) => {
        const ox = vx - x;
        const oz = vz - z;
        // The road's forward direction is its normal turned back a quarter (`terrain.ts`).
        const ahead = ox * frame.normalZ - oz * frame.normalX;
        const aside = ox * frame.normalX + oz * frame.normalZ;
        return terrainHeightAt(profile, origin, seed, along + ahead, lateral + aside, land) + lift;
      };
    },
  };
}

/**
 * The level a side street's bridge is drawn at — #3105: the ridden road's own
 * height at the point of it nearest each station, lifted as a nearby street
 * is, whatever is under the deck; so it is drawn across the water a street on
 * the ground stops at ({@link routeGround}). None past the drawn ground's
 * reach, as a street on the ground has none.
 *
 * ⚠️ **The road's level, because an open-world ride is flat until #2899**:
 * the ground beside every held street is levelled to it (#3094), so a deck at
 * the road's level meets the street at each end. Once real heights are read
 * the deck's grade is to be interpolated across its span, as #2899 asks of the
 * trainer's side.
 */
export function deckGround(profile: RouteProfile, origin: CorridorOrigin): StreetGround {
  return {
    about(x, z) {
      let near: NearestOnRoad | undefined;
      for (let reach = FIRST_REACH_METRES; near === undefined; reach *= 2) {
        near = nearestOnDrawnRoad(profile, origin, x, z, reach);
        if (reach > GROUND_LATERAL_METRES * 2) break;
      }
      if (near === undefined || near.distance > GROUND_LATERAL_METRES) return undefined;
      const level =
        elevationAt(profile, near.along) - origin.elevation + nearbyStreetLift(near.distance);
      return () => level;
    },
  };
}

/** Each piece's side road on a land mask, built the first time it is in view. */
const built = new WeakMap<LandClassMask, WeakMap<NearbyStreetPiece, SideRoad>>();

function sideRoadOf(
  piece: NearbyStreetPiece,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): SideRoad {
  let byPiece = built.get(land);
  if (byPiece === undefined) {
    byPiece = new WeakMap();
    built.set(land, byPiece);
  }
  const known = byPiece.get(piece);
  if (known !== undefined) return known;
  const ribbon = streetRibbon(
    piece.line,
    SIDE_ROAD_WIDTHS[piece.widthClass] / 2,
    piece.deck === true ? deckGround(profile, origin) : routeGround(profile, origin, seed, land),
  );
  let first: NearestOnRoad | undefined;
  for (let reach = FIRST_REACH_METRES; first === undefined; reach *= 2) {
    first = nearestOnDrawnRoad(
      profile,
      origin,
      piece.line[0] as number,
      piece.line[1] as number,
      reach,
    );
    if (reach > GROUND_LATERAL_METRES * 2) break;
  }
  const road: SideRoad = {
    // No junction: a nearby street meets no route. Its `along` is where it is beside.
    junction: { along: first?.along ?? 0, source: 'street', arms: [] },
    mesh: ribbon.mesh,
    segments: ribbon.segments,
    halfWidths: ribbon.halfWidths,
    ...(piece.deck === true ? { deck: true as const } : {}),
  };
  byPiece.set(piece, road);
  return road;
}

/** The last choice of pieces in view, by corridor's streets: reused until the rider moves on. */
const chosen = new WeakMap<
  NearbyStreets,
  { land: LandClassMask; profile: RouteProfile; at: number; roads: readonly SideRoad[] }
>();

/**
 * The nearby streets in view of a rider `riderMetres` along — #2973: the
 * {@link NEARBY_STREETS_PER_FRAME} pieces nearest the last multiple of
 * {@link NEARBY_STREET_REFRESH_METRES} behind the rider, within
 * {@link NEARBY_STREET_VIEW_METRES} and that much more of it, in the order
 * they were found. The same array, and the same objects, until the rider
 * reaches the next multiple, so the side roads' mesh is not rebuilt between.
 */
export function nearbyStreetsAt(
  streets: NearbyStreets,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  riderMetres: number,
  land: LandClassMask = NO_LAND_CLASS,
): readonly SideRoad[] {
  if (streets.pieces.length === 0) return [];
  const at = Math.floor(riderMetres / NEARBY_STREET_REFRESH_METRES) * NEARBY_STREET_REFRESH_METRES;
  const last = chosen.get(streets);
  if (last?.at === at && last.land === land && last.profile === profile) return last.roads;
  const centre = drawnRoadPosition(profile, origin, at);
  const reach = NEARBY_STREET_VIEW_METRES + NEARBY_STREET_REFRESH_METRES;
  const inView: { index: number; gap: number }[] = [];
  for (const [index, piece] of streets.pieces.entries()) {
    const gapX = Math.max(piece.minX - centre.x, centre.x - piece.maxX, 0);
    const gapZ = Math.max(piece.minZ - centre.z, centre.z - piece.maxZ, 0);
    const gap = Math.hypot(gapX, gapZ);
    if (gap <= reach) inView.push({ index, gap });
  }
  inView.sort((a, b) => a.gap - b.gap || a.index - b.index);
  const roads = inView
    .slice(0, NEARBY_STREETS_PER_FRAME)
    .sort((a, b) => a.index - b.index)
    .map(({ index }) =>
      sideRoadOf(streets.pieces[index] as NearbyStreetPiece, profile, origin, seed, land),
    )
    .filter((road) => road.mesh.indices.length > 0);
  chosen.set(streets, { land, profile, at, roads });
  return roads;
}
