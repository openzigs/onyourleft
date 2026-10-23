// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which mapped buildings are drawn, and the ground they clear — #1549, the
 * half of it that names no rendering library.
 *
 * `footprint-buildings.ts` (#1540) plans every mapped footprint once, at ride
 * start; `three-renderer.ts` §`MappedBuildingBelt` appends the plans in reach
 * into one buffer and draws them. Between the two is this file:
 *
 * - {@link mappedBuildingsOf}: the plans, indexed once, at the press, by
 *   `GameView` — never per frame.
 * - {@link selectMappedBuildings}: the set a refill draws — nearest first,
 *   within {@link MAPPED_BUILDING_REACH_METRES}, at most
 *   {@link MAPPED_BUILDING_MAX}, ranked by distance with the frame's
 *   procedural structures (#1586) inside `realistic-budget.ts`
 *   §`MAPPED_BUILDING_TRIANGLES`, every one beyond {@link MAPPED_BUILDING_NEAR_METRES} at its far level, and
 *   in at most {@link MAPPED_BUILDING_DRAW_CALLS} surfaces.
 * - {@link mappedChunk}: when a refill is due — only when the rider's chunk
 *   of {@link MAPPED_CHUNK_METRES} changes.
 * - {@link clearOfMappedBuildings}: no tree, shrub or rock inside a mapped
 *   footprint or within #1534's margin of it. That is #1534's rule, extended
 *   from a settlement's ground to a mapped one.
 *
 * ⚠️ **The clearing takes every planned footprint, not only the drawn ones.**
 * The drawn set changes at a refill, and a wood that came back when a house
 * fell out of the budget would be a tree that walks. The set cleared contains
 * every drawn one, which is what #1549 asks, and no plan stands on wood, water
 * or park (#1540's rule 2), so what is cleared beyond the drawn set is a
 * garden, never a wood.
 *
 * No coordinate is formatted into any string here.
 */

import type { FootprintPlan, FootprintRole } from './footprint-buildings';
import { FOOTPRINT_SURFACES, FOOTPRINT_VERTEX_FLOATS, ROOF_ROLES } from './footprint-buildings';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_BUILDING_REACH_METRES,
  MAPPED_CHUNK_METRES,
} from './realistic-budget';
import type { StructureSurface } from './realistic-assets';
import type { ScatterItem } from './scatter';
import { SETTLEMENT_CLEARED_KINDS, SETTLEMENT_MARGIN_METRES } from './settlements';

/** The side of a cell of {@link MappedBuildings}' clearing grid, metres. */
const CELL_METRES = 32;

/**
 * The key of the cell `(ix, iz)`: a number, so a lookup allocates nothing.
 *
 * Each axis takes 16 bits around 0x8000, so with {@link CELL_METRES} of 32 two
 * cells alias beyond about ±1,048 km of local metres from the origin. An alias
 * only misses a clearing; it cannot fail or crash, and no ride is that far
 * from its own origin.
 */
function cellKey(ix: number, iz: number): number {
  return (ix + 0x8000) * 0x1_0000 + (iz + 0x8000);
}

/** A ride's mapped buildings, planned and indexed — built once, at the press. */
export interface MappedBuildings {
  readonly plans: readonly FootprintPlan[];
  /** Each plan's reach about its centroid, metres: its outline's farthest vertex. */
  readonly radii: Float32Array;
  /** Every plan whose outline, with #1534's margin, reaches each cell. */
  readonly cells: ReadonlyMap<number, readonly number[]>;
  /** Scratch for {@link selectMappedBuildings}: one slot a plan, so a refill allocates nothing. */
  readonly order: Uint32Array;
  readonly distances: Float64Array;
}

/** What a frame carries about the mapped buildings — the one index, and where the rider is. */
export interface MappedBuildingsInView {
  readonly buildings: MappedBuildings;
  /** The rider's {@link mappedChunk}; a refill is due when it changes. */
  readonly chunk: number;
  /** Where the rider is drawn, local metres. */
  readonly x: number;
  readonly z: number;
}

/** Indexes a ride's plans — once, at the press. */
export function mappedBuildingsOf(plans: readonly FootprintPlan[]): MappedBuildings {
  const radii = new Float32Array(plans.length);
  const cells = new Map<number, number[]>();
  plans.forEach((plan, index) => {
    const { footprint: outline, centroid, driveway } = plan;
    let radius = 0;
    // #1588: a driveway's ground is the building's too, so its reach takes it in.
    for (const ring of [outline, driveway]) {
      for (let at = 0; at + 1 < ring.length; at += 2) {
        radius = Math.max(
          radius,
          Math.hypot((ring[at] as number) - centroid.x, (ring[at + 1] as number) - centroid.z),
        );
      }
    }
    radii[index] = radius;
    const reach = radius + SETTLEMENT_MARGIN_METRES;
    const fromX = Math.floor((centroid.x - reach) / CELL_METRES);
    const toX = Math.floor((centroid.x + reach) / CELL_METRES);
    const fromZ = Math.floor((centroid.z - reach) / CELL_METRES);
    const toZ = Math.floor((centroid.z + reach) / CELL_METRES);
    for (let ix = fromX; ix <= toX; ix += 1) {
      for (let iz = fromZ; iz <= toZ; iz += 1) {
        const key = cellKey(ix, iz);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [index]);
        else list.push(index);
      }
    }
  });
  return {
    plans,
    radii,
    cells,
    order: new Uint32Array(plans.length),
    distances: new Float64Array(plans.length),
  };
}

/** The rider's chunk at `distanceMetres` along the route. @see MAPPED_CHUNK_METRES */
export function mappedChunk(distanceMetres: number): number {
  return Math.floor(distanceMetres / MAPPED_CHUNK_METRES);
}

/** The roles a building's far level keeps: its walls and its roof (#1540's `farTriangleCount`). */
export const FAR_ROLES: readonly FootprintRole[] = ['wall', 'roof'];

/**
 * The roles a building's near level draws: all of them, #1581's chimney and
 * trim and #1588's dormers and driveway among them.
 */
export const NEAR_ROLES: readonly FootprintRole[] = [
  'wall',
  'plinth',
  'roof',
  'parapet',
  'door',
  'chimney',
  'trim',
  'dormer',
  'dormer-roof',
  'driveway',
];

/**
 * The surface a role wears: the roof and, since #1588, a dormer's roof the
 * plan's roof surface (`footprint-buildings.ts` §`ROOF_ROLES`), and
 * everything else — walls, plinth, parapet, door, since #1581 chimney and
 * trim, and since #1588 a dormer's front and cheeks and the driveway — its
 * wall surface. A driveway wears the wall's group only to cost no draw call:
 * the shader paints it, and no photograph shows.
 *
 * ⚠️ **The door, the trim and the plinth wear the wall's photograph**, where a
 * procedural house's wear timber (`realistic-assets.ts`
 * §`REALISTIC_BUILDING_SURFACES`). A third surface a building would put a
 * town's surfaces past {@link MAPPED_BUILDING_DRAW_CALLS} at once: brick,
 * render, two roofs and a flat roof are five, and timber doors a sixth before
 * the first shop. The plinth is darker, by `three-renderer.ts`' own
 * `REALISTIC_ROLE_SHADE`; since #1581 the door and the trim are painted over
 * the photograph instead (`three-renderer.ts` §`withFacade`).
 */
export function surfaceOfRole(plan: FootprintPlan, role: FootprintRole): StructureSurface {
  return ROOF_ROLES.has(role) ? plan.surfaces.roof : plan.surfaces.wall;
}

/** How many triangles one role of a plan is. */
export function roleTriangles(plan: FootprintPlan, role: FootprintRole): number {
  return plan.triangles[role].length / (3 * FOOTPRINT_VERTEX_FLOATS);
}

/**
 * The set one refill draws, written in place — a class, so the belt holds one
 * and every refill writes into it.
 */
export class MappedSelection {
  /** How many buildings are drawn, at most {@link MAPPED_BUILDING_MAX}. */
  count = 0;
  /** The drawn plans' indices, nearest first. */
  readonly plans = new Int32Array(MAPPED_BUILDING_MAX);
  /** 1 where the drawn building at that place is at its far level. */
  readonly far = new Uint8Array(MAPPED_BUILDING_MAX);
  /** How many are drawn whole, and how many at the far level. */
  near = 0;
  farCount = 0;
  /** The triangles drawn, every surface together. */
  triangles = 0;
  /**
   * How many in reach and inside the budget were passed over because their
   * surfaces would have opened a surface past {@link MAPPED_BUILDING_DRAW_CALLS}.
   */
  passed = 0;
  /** How many of the {@link RivalStructures} were ranked in, nearer than where the selection stopped — #1586. */
  rivals = 0;
  /** The surfaces drawn, in the order they were opened: at most {@link MAPPED_BUILDING_DRAW_CALLS}. */
  readonly surfaces: StructureSurface[] = [];
  /** Each surface's triangles, by its place in {@link surfaces}: room for every surface a plan wears. */
  readonly surfaceTriangles = new Int32Array(FOOTPRINT_SURFACES.length);

  reset(): void {
    this.count = 0;
    this.near = 0;
    this.farCount = 0;
    this.triangles = 0;
    this.passed = 0;
    this.rivals = 0;
    this.surfaces.length = 0;
    this.surfaceTriangles.fill(0);
  }
}

/** The place of `surface` in `selection`'s surfaces, or -1. */
function slotOf(selection: MappedSelection, surface: StructureSurface): number {
  return selection.surfaces.indexOf(surface);
}

/**
 * The frame's procedural structures, as one refill ranks the mapped buildings
 * against them — #1586, ADR 0054 D-5.6's "the nearest come first, within the
 * cap". Each is priced at `triangles`, the structure term's price of one.
 */
export interface RivalStructures {
  /** Each one's distance from the rider, metres, nearest first; the first {@link count} are read. */
  readonly distances: Float64Array;
  readonly count: number;
  readonly triangles: number;
}

/** No procedural structure to rank against: the budget is the mapped buildings' alone. */
export const NO_RIVALS: RivalStructures = {
  distances: new Float64Array(0),
  count: 0,
  triangles: 0,
};

/**
 * The mapped buildings one refill draws, written into `into` — #1549.
 *
 * Every plan within {@link MAPPED_BUILDING_REACH_METRES} of `(x, z)` by its
 * centroid, **nearest first**; each beyond {@link MAPPED_BUILDING_NEAR_METRES}
 * at its far level. Taken in that order until the next would pass
 * `triangleBudget` or {@link MAPPED_BUILDING_MAX} are taken — so the drawn set
 * is the nearest, and a far building never takes a near one's place.
 *
 * **Ranked with the procedural structures, under the one budget** — #1586.
 * Each of `rivals` nearer than (or as near as) the next building is taken
 * first, at its price, and the walk stops at the first of either that would
 * pass `triangleBudget`; once the buildings are done, or at their count cap,
 * the rest of the rivals are taken in order while they fit. `into.rivals` is
 * how many were. So a hedge 300 m ahead no longer outranks a house 20 m away:
 * until #1586 the procedural structures were all taken first, and a frame
 * whose fields filled the cap drew no mapped building at all.
 *
 * ⚠️ **Levels and reach are decided at a refill and held until the next**,
 * which is up to `MAPPED_CHUNK_METRES` (100 m) of riding. So a building can
 * stay at its far level until it is about 50 m away, and one comes into reach
 * 300 to 400 m ahead, not at 400 m. Inside #1549's rule, and one for #1553's
 * by-eye pass.
 *
 * ⚠️ **One exception to "the nearest", and it is the draw-call bound.** A
 * building whose wall or roof surface would open a surface past `surfaceSlots`
 * is passed over, counted in `passed`, and the next is tried: a seventh
 * surface would be a seventh draw call. A refill nearer it draws it.
 *
 * `surfaceSlots` is a parameter so a test can lift the bound, its control.
 */
export function selectMappedBuildings(
  buildings: MappedBuildings,
  x: number,
  z: number,
  triangleBudget: number,
  into: MappedSelection,
  surfaceSlots: number = MAPPED_BUILDING_DRAW_CALLS,
  rivals: RivalStructures = NO_RIVALS,
): void {
  into.reset();
  /** The triangles the rivals ranked in so far take. */
  let rivalTriangles = 0;
  /** Takes every rival no farther than `apart` while it fits; false at the first that does not. */
  const rivalsWithin = (apart: number): boolean => {
    while (into.rivals < rivals.count && (rivals.distances[into.rivals] as number) <= apart) {
      if (into.triangles + rivalTriangles + rivals.triangles > triangleBudget) return false;
      rivalTriangles += rivals.triangles;
      into.rivals += 1;
    }
    return true;
  };
  const { plans, order, distances } = buildings;
  let inReach = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index] as FootprintPlan;
    const apart = Math.hypot(plan.centroid.x - x, plan.centroid.z - z);
    if (apart > MAPPED_BUILDING_REACH_METRES) continue;
    distances[index] = apart;
    order[inReach] = index;
    inReach += 1;
  }
  // Ties broken by index, so the same ride draws the same town every time.
  order
    .subarray(0, inReach)
    .sort((a, b) => (distances[a] as number) - (distances[b] as number) || a - b);
  const slots = Math.min(surfaceSlots, FOOTPRINT_SURFACES.length);
  let stopped = false;
  for (let at = 0; at < inReach && into.count < MAPPED_BUILDING_MAX; at += 1) {
    const index = order[at] as number;
    const plan = plans[index] as FootprintPlan;
    const apart = distances[index] as number;
    if (!rivalsWithin(apart)) {
      stopped = true;
      break;
    }
    const far = apart > MAPPED_BUILDING_NEAR_METRES;
    const triangles = far ? plan.farTriangleCount : plan.triangleCount;
    if (into.triangles + rivalTriangles + triangles > triangleBudget) {
      stopped = true;
      break;
    }
    const wall = slotOf(into, plan.surfaces.wall);
    const roof = slotOf(into, plan.surfaces.roof);
    const opened =
      (wall < 0 ? 1 : 0) + (roof < 0 && plan.surfaces.roof !== plan.surfaces.wall ? 1 : 0);
    if (into.surfaces.length + opened > slots) {
      into.passed += 1;
      continue;
    }
    if (wall < 0) into.surfaces.push(plan.surfaces.wall);
    if (slotOf(into, plan.surfaces.roof) < 0) into.surfaces.push(plan.surfaces.roof);
    for (const role of far ? FAR_ROLES : NEAR_ROLES) {
      const slot = slotOf(into, surfaceOfRole(plan, role));
      into.surfaceTriangles[slot] = (into.surfaceTriangles[slot] ?? 0) + roleTriangles(plan, role);
    }
    into.plans[into.count] = index;
    into.far[into.count] = far ? 1 : 0;
    into.count += 1;
    if (far) into.farCount += 1;
    else into.near += 1;
    into.triangles += triangles;
  }
  if (!stopped) rivalsWithin(Number.POSITIVE_INFINITY);
}

/** Whether `(x, z)` is inside `ring` (`(x, z)` pairs), by the even-odd rule. */
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

/** The squared distance from `(x, z)` to `ring`'s nearest edge. */
function squaredToRing(ring: Float32Array, x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const ax = ring[j * 2] as number;
    const az = ring[j * 2 + 1] as number;
    const dx = (ring[i * 2] as number) - ax;
    const dz = (ring[i * 2 + 1] as number) - az;
    const length = dx * dx + dz * dz;
    const t = length > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
    const ex = ax + dx * t - x;
    const ez = az + dz * t - z;
    nearest = Math.min(nearest, ex * ex + ez * ez);
  }
  return nearest;
}

/**
 * How far beside a driveway nothing stands — #1588: **1 m**, a verge a
 * shrub's crown clears, where a house keeps #1534's whole margin.
 */
export const DRIVEWAY_MARGIN_METRES = 1;

/**
 * Whether `(x, z)` stands on a mapped building's ground: inside a planned
 * footprint, or within #1534's {@link SETTLEMENT_MARGIN_METRES} of one, or
 * since #1588 on its driveway or within {@link DRIVEWAY_MARGIN_METRES} of it.
 */
export function onMappedGround(buildings: MappedBuildings, x: number, z: number): boolean {
  const list = buildings.cells.get(
    cellKey(Math.floor(x / CELL_METRES), Math.floor(z / CELL_METRES)),
  );
  if (list === undefined) return false;
  const margin = SETTLEMENT_MARGIN_METRES;
  for (const index of list) {
    const plan = buildings.plans[index] as FootprintPlan;
    const reach = (buildings.radii[index] as number) + margin;
    const dx = x - plan.centroid.x;
    const dz = z - plan.centroid.z;
    if (dx * dx + dz * dz > reach * reach) continue;
    if (insideRing(plan.footprint, x, z)) return true;
    if (squaredToRing(plan.footprint, x, z) <= margin * margin) return true;
    if (plan.driveway.length > 0) {
      if (insideRing(plan.driveway, x, z)) return true;
      if (squaredToRing(plan.driveway, x, z) <= DRIVEWAY_MARGIN_METRES ** 2) return true;
    }
  }
  return false;
}

/**
 * The natural scenery, less every tree, shrub and rock on a mapped building's
 * ground — #1549, #1534's rule extended to data. Pure, and a function of
 * positions only; `undefined` (a ride with no plans) returns `natural` itself.
 */
export function clearOfMappedBuildings(
  natural: readonly ScatterItem[],
  buildings: MappedBuildings | undefined,
): readonly ScatterItem[] {
  if (buildings === undefined || buildings.plans.length === 0) return natural;
  return natural.filter(
    (item) =>
      !SETTLEMENT_CLEARED_KINDS.has(item.kind) || !onMappedGround(buildings, item.x, item.z),
  );
}
