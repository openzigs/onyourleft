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
 * - {@link selectMappedBuildings}: the set a refill draws — since #2094 the
 *   nearest {@link MAPPED_LANDMARKS_AHEAD} landmarks first, then nearest first,
 *   within {@link MAPPED_BUILDING_REACH_METRES}, at most
 *   {@link MAPPED_BUILDING_MAX} (since #1638 more of a city centre's far
 *   boxes where its cap is on, which by default it is not), ranked by
 *   distance with the frame's
 *   procedural structures (#1586) inside `realistic-budget.ts`
 *   §`MAPPED_BUILDING_TRIANGLES`, every one beyond {@link MAPPED_BUILDING_NEAR_METRES} at its far level, and
 *   in at most {@link MAPPED_BUILDING_DRAW_CALLS} surfaces.
 * - {@link mappedChunk}: when a refill is due — only when the rider's chunk
 *   of {@link MAPPED_CHUNK_METRES} changes.
 * - Since #1585 a near plan with a house model that fits it
 *   (`FootprintPlan.model`, `house-models.ts`) is drawn as that model, in one
 *   more call counted inside {@link MAPPED_BUILDING_DRAW_CALLS}.
 * - Since #3334 a near plan wrapped in the downtown kit's facade pieces
 *   (`FootprintPlan.kit`, `facade-kit.ts`) is drawn as its wrap, in one more
 *   call of its own, counted inside {@link MAPPED_BUILDING_DRAW_CALLS} too.
 * - {@link clearOfMappedBuildings}: no tree, shrub or rock inside a mapped
 *   footprint or within #1534's margin of it. That is #1534's rule, extended
 *   from a settlement's ground to a mapped one. Since #2428 none within its
 *   own drawn reach of a driveway either.
 * - {@link clearOfDriveways}: no wall, hedge, fence, signpost or building
 *   across a driveway, or within 0.5 m of it — #2428.
 * - Since #2848 a shop's apron (`shop-aprons.ts`, `FootprintPlan.apron`) is
 *   paved ground as a driveway is: both clearings above hold for it, and the
 *   near level draws it ({@link NEAR_ROLES}).
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
import type { KitWrap } from './facade-kit';
import {
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  ROOF_ROLES,
  SPIRE_SURFACE,
} from './footprint-buildings';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_KIT_FOCUS_AHEAD_METRES,
  MAPPED_KIT_NEAR_MAX,
  MAPPED_BUILDING_MAX_CITY_FAR,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_BUILDING_REACH_METRES,
  MAPPED_CHUNK_METRES,
} from './realistic-budget';
import type { StructureSurface } from './realistic-assets';
import { footprintSamples, SIDE_ROAD_STRUCTURE_MARGIN_METRES } from './cross-streets';
import { isBuiltKind } from './buildings';
import type { ScatterItem } from './scatter';
import {
  SETTLEMENT_CLEARED_KINDS,
  SETTLEMENT_MARGIN_METRES,
  STRUCTURE_FOOTPRINTS,
  type Footprint,
} from './settlements';

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
  /**
   * #1638: the most buildings a refill draws, those past
   * {@link MAPPED_BUILDING_MAX} a city centre's at their far level only —
   * `realistic-budget.ts` §`MAPPED_BUILDING_MAX_CITY_FAR`. Absent, off: at
   * most {@link MAPPED_BUILDING_MAX}, anywhere. @see mappedBuildingCap
   */
  readonly cityFarMax?: number;
}

/**
 * The most buildings one refill of `buildings` may draw — #1638: its
 * {@link MappedBuildings.cityFarMax}, or {@link MAPPED_BUILDING_MAX}. What a
 * {@link MappedSelection} for it is built to hold.
 */
export function mappedBuildingCap(buildings: MappedBuildings): number {
  return buildings.cityFarMax ?? MAPPED_BUILDING_MAX;
}

/** What a frame carries about the mapped buildings — the one index, and where the rider is. */
export interface MappedBuildingsInView {
  readonly buildings: MappedBuildings;
  /** The rider's {@link mappedChunk}; a refill is due when it changes. */
  readonly chunk: number;
  /** Where the rider is drawn, local metres. */
  readonly x: number;
  readonly z: number;
  /**
   * The route from the rider `realistic-budget.ts` §`MAPPED_RANKED_AHEAD_METRES` on, `x, z`
   * every {@link MAPPED_AHEAD_STEP_METRES} — #2429: what a refill ranks the
   * buildings by ({@link rankFrom}). Absent, they are ranked by `x`, `z`.
   */
  readonly ahead?: Float32Array;
}

/** How far apart {@link MappedBuildingsInView.ahead}'s points are, metres: **25**. */
export const MAPPED_AHEAD_STEP_METRES = 25;

/**
 * How far `(x, z)` is from the road a refill ranks by — #2429: from the
 * nearest point of `ahead` (`x, z` pairs, a polyline), or from `(fromX,
 * fromZ)` where `ahead` is absent or a single point. #2902: a `NaN` pair in
 * `ahead` separates two polylines — every segment touching it measures `NaN`,
 * which is never nearer — so an open-world ride ranks by the road ahead and
 * the ways on from its next junction at once (`scene.ts` §`mappedBranches`).
 */
export function rankFrom(
  ahead: Float32Array | undefined,
  fromX: number,
  fromZ: number,
  x: number,
  z: number,
): number {
  if (ahead === undefined || ahead.length < 4) return Math.hypot(x - fromX, z - fromZ);
  let nearest = Number.POSITIVE_INFINITY;
  for (let at = 0; at + 3 < ahead.length; at += 2) {
    const ax = ahead[at] as number;
    const az = ahead[at + 1] as number;
    const dx = (ahead[at + 2] as number) - ax;
    const dz = (ahead[at + 3] as number) - az;
    const span = dx * dx + dz * dz;
    const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
    const off = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (off < nearest) nearest = off;
  }
  return nearest;
}

/**
 * Indexes a ride's plans — once, at the press. `cityFarMax` is #1638's city
 * centre's far-level cap, `realistic-budget.ts` §`MAPPED_BUILDING_MAX_CITY_FAR`
 * unless the owner's page names a candidate; `undefined` is off. A cap that is
 * not a whole number above {@link MAPPED_BUILDING_MAX} is refused: at or
 * under it there is nothing for it to add.
 */
export function mappedBuildingsOf(
  plans: readonly FootprintPlan[],
  cityFarMax: number | undefined = MAPPED_BUILDING_MAX_CITY_FAR,
): MappedBuildings {
  if (
    cityFarMax !== undefined &&
    !(Number.isInteger(cityFarMax) && cityFarMax > MAPPED_BUILDING_MAX)
  ) {
    throw new RangeError(
      `a city centre's far-level cap is a whole number above ${String(MAPPED_BUILDING_MAX)}, not ${String(cityFarMax)}`,
    );
  }
  const radii = new Float32Array(plans.length);
  const cells = new Map<number, number[]>();
  plans.forEach((plan, index) => {
    const { footprint: outline, centroid, driveway } = plan;
    let radius = 0;
    // #1588: a driveway's ground is the building's too, so its reach takes it in.
    // #2848: and an apron's.
    for (const ring of [outline, driveway, plan.apron]) {
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
    ...(cityFarMax === undefined ? {} : { cityFarMax }),
  };
}

/** The rider's chunk at `distanceMetres` along the route. @see MAPPED_CHUNK_METRES */
export function mappedChunk(distanceMetres: number): number {
  return Math.floor(distanceMetres / MAPPED_CHUNK_METRES);
}

/**
 * The roles a building's far level keeps: its walls, its plinth and its roof
 * (#1540's `farTriangleCount`).
 *
 * ⚠️ **The plinth since #2761.** The walls start at the floor, which stands
 * over the HIGHEST ground under the footprint (`footprint-buildings.ts` rule
 * 4); the plinth is what reaches from there down into the lowest. Without it
 * a far house on falling ground stood on nothing on its downhill side — up to
 * 2.7 m above the bank at the public coasts #2761 measured, which the owner
 * saw as a house on stilts by the shore. It is two triangles a ring edge and
 * wears the walls' surface, so it opens no draw call.
 */
export const FAR_ROLES: readonly FootprintRole[] = ['wall', 'plinth', 'roof', 'spire'];

/**
 * The roles a building's near level draws: all of them, #1581's chimney and
 * trim, #1588's dormers and driveway, #1589's porch, #1590's shop fronts and
 * #2848's apron among them.
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
  'shopfront',
  'porch',
  'porch-roof',
  'porch-trim',
  // #2206: last, so it follows the roof's run in the slate slot and moves no earlier one.
  'spire',
  // #2848: after every other, so it moves no earlier role's place in the walls' run.
  'apron',
];

/**
 * The surface a role wears: the roof and, since #1588, a dormer's roof the
 * plan's roof surface (`footprint-buildings.ts` §`ROOF_ROLES`), and
 * everything else — walls, plinth, parapet, door, since #1581 chimney and
 * trim, since #1588 a dormer's front and cheeks and the driveway, and since
 * #2848 a shop's apron — its wall surface. A driveway and an apron wear the
 * wall's group only to cost no draw call: the shader paints them, and no
 * photograph shows.
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
  if (role === 'spire') return SPIRE_SURFACE;
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
  /**
   * How many buildings are drawn, at most {@link MAPPED_BUILDING_MAX} — since
   * #1638 at most the selection's capacity, where a city centre's far-level
   * cap is on ({@link mappedBuildingCap}).
   */
  count = 0;
  /** The drawn plans' indices, the landmarks taken ahead first (#2094), then nearest first. */
  readonly plans: Int32Array;
  /** 1 where the drawn building at that place is at its far level. */
  readonly far: Uint8Array;
  /**
   * 1 where the drawn building at that place is drawn as its house model —
   * #1585: near, with a model that fits, and the models loaded.
   */
  readonly modelled: Uint8Array;
  /** How many are drawn as models, and their triangles — #1585. */
  modelCount = 0;
  modelTriangles = 0;
  /**
   * 1 where the drawn building at that place is drawn as its wrap of facade
   * pieces — #3334: near, wrapped, and the kit loaded. Never where
   * {@link modelled} is.
   */
  readonly kitted: Uint8Array;
  /**
   * 1 where the wrap at that place is drawn with its plan's paved apron
   * (#2848), in its extrusion's wall surface — #3334. Read only where
   * {@link kitted} is 1.
   */
  readonly paved: Uint8Array;
  /** How many are drawn as wraps, and their triangles (the wraps' alone, no apron's) — #3334. */
  kitCount = 0;
  kitTriangles = 0;
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

  /**
   * @param capacity the most buildings it holds: {@link MAPPED_BUILDING_MAX},
   * or since #1638 the {@link mappedBuildingCap} of the buildings it selects from
   */
  constructor(capacity: number = MAPPED_BUILDING_MAX) {
    this.plans = new Int32Array(capacity);
    this.far = new Uint8Array(capacity);
    this.modelled = new Uint8Array(capacity);
    this.kitted = new Uint8Array(capacity);
    this.paved = new Uint8Array(capacity);
  }

  reset(): void {
    this.count = 0;
    this.near = 0;
    this.farCount = 0;
    this.triangles = 0;
    this.passed = 0;
    this.rivals = 0;
    this.surfaces.length = 0;
    this.surfaceTriangles.fill(0);
    this.modelCount = 0;
    this.modelTriangles = 0;
    this.kitCount = 0;
    this.kitTriangles = 0;
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
 * How many landmarks in reach a refill takes before every other building —
 * #2094: **4**, a village's church or two, its school and its town hall. A
 * landmark is a plan whose mapped type or landmark draws it as a civic
 * building (`building-types.ts`: a place of worship, a school, a town hall);
 * an inferred family is never civic. Beyond this many, a landmark is ranked by
 * its distance like any other, so a city centre's civic blocks cannot take
 * more than 4 of {@link MAPPED_BUILDING_MAX}'s places from the street nearest
 * the rider.
 */
export const MAPPED_LANDMARKS_AHEAD = 4;

/** Whether a plan is a landmark — {@link MAPPED_LANDMARKS_AHEAD}. */
function isLandmark(plan: FootprintPlan): boolean {
  return plan.family === 'civic';
}

/**
 * Moves the nearest {@link MAPPED_LANDMARKS_AHEAD} landmarks of `order`'s
 * first `count` (nearest first) to its front, each keeping its order, and
 * returns how many moved. In place, so a refill allocates nothing.
 */
function landmarksAhead(
  plans: readonly FootprintPlan[],
  order: Uint32Array,
  count: number,
): number {
  let ahead = 0;
  for (let at = 0; at < count && ahead < MAPPED_LANDMARKS_AHEAD; at += 1) {
    const index = order[at] as number;
    if (!isLandmark(plans[index] as FootprintPlan)) continue;
    order.copyWithin(ahead + 1, ahead, at);
    order[ahead] = index;
    ahead += 1;
  }
  return ahead;
}

/**
 * The mapped buildings one refill draws, written into `into` — #1549.
 *
 * Every plan within {@link MAPPED_BUILDING_REACH_METRES} of `(x, z)` by its
 * centroid, **nearest first**; each beyond {@link MAPPED_BUILDING_NEAR_METRES}
 * at its far level.
 *
 * ⚠️ **Nearest to the road ahead, since #2429**, where `ahead` is given
 * ({@link MappedBuildingsInView.ahead}): each plan, and each rival, is
 * ranked by its distance from that stretch of route ({@link rankFrom}), and
 * reach and level are still measured from `(x, z)`. Ranked from `(x, z)`, the
 * nearest {@link MAPPED_BUILDING_MAX} of a dense town stood as much behind the
 * rider as ahead, and the set was held for a chunk, so a house drew when the
 * rider was beside it. Taken in that order until the next would pass
 * `triangleBudget` or {@link MAPPED_BUILDING_MAX} are taken — so the drawn set
 * is the nearest, and a far building never takes a near one's place but for
 * the landmarks below.
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
 * ⚠️ **Two exceptions to "the nearest".** The first is the draw-call bound. A
 * building whose wall or roof surface would open a surface past `surfaceSlots`
 * is passed over, counted in `passed`, and the next is tried: a seventh
 * surface would be a seventh draw call. A refill nearer it draws it.
 *
 * The second is the landmarks — #2094: the nearest
 * {@link MAPPED_LANDMARKS_AHEAD} in reach are taken before every other
 * building, so a church 300 m off the road is not lost behind the
 * {@link MAPPED_BUILDING_MAX} houses nearer the rider. They rank no rival in,
 * a landmark that does not fit the budget is skipped rather than ending the
 * walk, and they are inside the same count, budget and draw calls.
 *
 * **House models** — #1585. With `models` (each model's triangles, by its
 * place in `house-models.ts` §`HOUSE_MODELS`), a near plan that has one
 * (`FootprintPlan.model`) is drawn as it, at the model's triangles, in ONE
 * more group of the same mesh's draw calls whatever the count: the models
 * are counted INSIDE `surfaceSlots`, so a refill that draws any model opens
 * at most `surfaceSlots - 1` surfaces. A model that would open the group past
 * the bound is passed over like a surface. Without `models` — the stylised
 * world, a test, a realistic world whose models did not load — every plan is
 * its extrusion, as before #1585. A far plan is always its extrusion.
 *
 * **Facade-kit wraps** — #3334. With `kit` (the downtown kit loaded), a near
 * plan that is wrapped (`FootprintPlan.kit`) is drawn as its wrap, at the
 * wrap's triangles — up to `realistic-budget.ts`
 * §`REALISTIC_KIT_WRAP_TRIANGLES`, 3 000 — in ONE more group of its own,
 * counted inside `surfaceSlots` exactly as the models' group is. With no slot
 * left for it the plan is drawn as its extrusion. A wrap costs some thirty
 * times its extrusion's triangles, out of `triangleBudget` as a model's are,
 * so only the first `MAPPED_KIT_NEAR_MAX` wrapped plans of the walk are
 * wraps — `MAPPED_KIT_TRIANGLES` between them at the most — and every
 * wrapped plan past them is its extrusion, and still drawn.
 * ⚠️ **And never at a building's cost**: where the wraps would leave the
 * frame fewer buildings, fewer procedural structures ranked in, or more plans
 * passed over for want of a surface, than the same refill draws with no wrap, the walk is run again with one wrap fewer
 * until it does not — at most eight walks a refill, and a refill is a chunk's,
 * not a frame's. What the wraps do take is what `refillMappedBuildings` would
 * have left the field boundaries (walls, hedges, fences).
 * Without `kit` every wrapped plan is its extrusion, as before #3334.
 *
 * **A city centre's far boxes** — #1638, off by default. Where `buildings`
 * carries a {@link MappedBuildings.cityFarMax}, the walk goes on past
 * {@link MAPPED_BUILDING_MAX}, up to that cap and `into`'s capacity, taking
 * only plans whose {@link FootprintPlan.urban} is `city-centre` and that are
 * drawn at their far level; every other plan past the 36 is passed over and
 * ranks no rival in. The budget, the rivals and the surfaces bind as before,
 * so the triangles and the draw calls cannot rise with it. Without it the
 * walk stops at {@link MAPPED_BUILDING_MAX}, as before #1638.
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
  models?: readonly number[],
  ahead?: Float32Array,
  kit = false,
): void {
  // No closure and no object here: since #3334 the belt runs this between chunks too, to ask
  // whether the wraps would change, on a frame that may write nothing.
  const most = kit ? MAPPED_KIT_NEAR_MAX : 0;
  walkMappedBuildings(
    buildings,
    x,
    z,
    triangleBudget,
    into,
    surfaceSlots,
    rivals,
    models,
    ahead,
    most,
  );
  if (!kit) return;
  // #3334: never fewer buildings, nor fewer structures ranked in, nor more passed over, than
  // the same refill draws with no wrap at all. Where the wraps took triangles or a surface slot
  // a farther building or a structure was drawn in, one wrap fewer, until none is. ⚠️ Not
  // skipped where the first walk took no wrap: a wrap tried and not fitting stops that walk
  // short, and the bare walk is what it must not be shorter than.
  const firstCount = into.count;
  const firstRivals = into.rivals;
  const firstPassed = into.passed;
  let wraps = into.kitCount;
  walkMappedBuildings(
    buildings,
    x,
    z,
    triangleBudget,
    into,
    surfaceSlots,
    rivals,
    models,
    ahead,
    0,
  );
  const bareCount = into.count;
  const bareRivals = into.rivals;
  const barePassed = into.passed;
  if (wraps === 0) return;
  if (firstCount >= bareCount && firstRivals >= bareRivals && firstPassed <= barePassed) {
    walkMappedBuildings(
      buildings,
      x,
      z,
      triangleBudget,
      into,
      surfaceSlots,
      rivals,
      models,
      ahead,
      wraps,
    );
    return;
  }
  while (wraps > 0) {
    wraps -= 1;
    walkMappedBuildings(
      buildings,
      x,
      z,
      triangleBudget,
      into,
      surfaceSlots,
      rivals,
      models,
      ahead,
      wraps,
    );
    if (into.count >= bareCount && into.rivals >= bareRivals && into.passed <= barePassed) return;
  }
}

const NO_WRAPS: readonly number[] = [];

/**
 * The plans a refill at `(x, z)` may draw as wraps of the downtown kit's
 * facade pieces — #3334: the at most `wraps` near wrapped plans nearest the
 * point {@link MAPPED_KIT_FOCUS_AHEAD_METRES} up the road from the rider
 * (the rider, with no road `ahead`), taken from the street's two sides in
 * turn. A side is which way a building's door faces: with the nearest's, or
 * against it (the maintainer's ruling on PR #3343: nearest first alone put
 * all six on the rider's side).
 *
 * ⚠️ **From the rider, not by the road's ranking** — PR #3343's review. Every
 * other choice of a refill ranks a building by its distance from the 200 m of
 * road ahead, which is much the same for every building beside it; ranked so,
 * the six wraps were wherever the index put them, and held for a whole
 * {@link MAPPED_CHUNK_METRES}. The belt runs the selection again every
 * `MAPPED_KIT_STRIDE_METRES` and refills when the wraps it would draw are
 * other plans (`three-renderer.ts` §`MappedBuildingBelt.wrapsWouldChange`).
 *
 * Ahead of the rider, because the camera looks up the road: a wrap behind the
 * rider is three thousand triangles nobody sees.
 */
export function nearWraps(
  buildings: MappedBuildings,
  x: number,
  z: number,
  ahead: Float32Array | undefined,
  wraps: number = MAPPED_KIT_NEAR_MAX,
  /** Written and returned; a new list where none is given. Allocates nothing with one. */
  into: number[] = [],
): readonly number[] {
  RIDER[0] = x;
  RIDER[1] = z;
  return wrapsNearRider(buildings, ahead, wraps, into);
}

/**
 * {@link nearWraps} for the rider of a view — what the belt asks on a frame
 * that is not a refill: the rider's place is read off `at` here, so no number
 * crosses a call as an argument (which, below the engine's top tier, is a
 * boxed number allocated on every call).
 */
export function nearWrapsAt(
  buildings: MappedBuildings,
  at: { readonly x: number; readonly z: number },
  ahead: Float32Array | undefined,
  into: number[],
): readonly number[] {
  RIDER[0] = at.x;
  RIDER[1] = at.z;
  return wrapsNearRider(buildings, ahead, MAPPED_KIT_NEAR_MAX, into);
}

/** {@link nearWraps}, the rider's place in {@link RIDER}. */
function wrapsNearRider(
  buildings: MappedBuildings,
  ahead: Float32Array | undefined,
  wraps: number,
  into: number[],
): readonly number[] {
  // ⚠️ The focus and the nearest's distance are kept in a typed array, not in locals that an
  // `if` or a loop reassigns: until the engine's top tier has the function, each such local
  // is a boxed number allocated on every call (48 bytes a call, measured).
  FOCUS[0] = RIDER[0] as number;
  FOCUS[1] = RIDER[1] as number;
  if (ahead !== undefined && ahead.length >= 4) {
    const dx = (ahead[2] as number) - (ahead[0] as number);
    const dz = (ahead[3] as number) - (ahead[1] as number);
    // ⚠️ No `Math.hypot` in this function: the engine's allocates on every call, and this
    // runs on frames that are not refills (`mapped-kit-belt.test.ts` measured 68 bytes a plan).
    const span = Math.sqrt(dx * dx + dz * dz);
    if (span > 0) {
      FOCUS[0] = (RIDER[0] as number) + (dx / span) * MAPPED_KIT_FOCUS_AHEAD_METRES;
      FOCUS[1] = (RIDER[1] as number) + (dz / span) * MAPPED_KIT_FOCUS_AHEAD_METRES;
    }
  }
  const { plans } = buildings;
  // ⚠️ `into` is never emptied and filled again: that frees and reallocates its store. It is
  // written in place and cut to length once.
  const most = Math.min(wraps, MAPPED_KIT_NEAR_MAX);
  if (most <= 0) {
    if (into.length !== 0) into.length = 0;
    return into;
  }
  // The nearest of all: its door's facing is the first side.
  let nearest = -1;
  FOCUS[2] = Number.POSITIVE_INFINITY;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index] as FootprintPlan;
    if (plan.kit === undefined) continue;
    // Near is the rider's, as the walk's near level is.
    const riderX = plan.centroid.x - (RIDER[0] as number);
    const riderZ = plan.centroid.z - (RIDER[1] as number);
    if (riderX * riderX + riderZ * riderZ > NEAR_SQUARED) continue;
    const offX = plan.centroid.x - FOCUS[0];
    const offZ = plan.centroid.z - FOCUS[1];
    // Squared: only compared.
    const apart = offX * offX + offZ * offZ;
    // Ties broken by index, so the same ride draws the same town every time.
    if (apart < FOCUS[2]) {
      nearest = index;
      FOCUS[2] = apart;
    }
  }
  if (nearest < 0) {
    if (into.length !== 0) into.length = 0;
    return into;
  }
  const facing = ((plans[nearest] as FootprintPlan).kit as KitWrap).facing;
  // Each side's `most` nearest, kept in order in scratch: `SIDE_PLANS[side * most + rank]`.
  let counts0 = 0;
  let counts1 = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index] as FootprintPlan;
    const kit = plan.kit;
    if (kit === undefined) continue;
    const riderX = plan.centroid.x - (RIDER[0] as number);
    const riderZ = plan.centroid.z - (RIDER[1] as number);
    if (riderX * riderX + riderZ * riderZ > NEAR_SQUARED) continue;
    const offX = plan.centroid.x - FOCUS[0];
    const offZ = plan.centroid.z - FOCUS[1];
    // Squared: only compared.
    const apart = offX * offX + offZ * offZ;
    const side = kit.facing[0] * facing[0] + kit.facing[1] * facing[1] >= 0 ? 0 : 1;
    const base = side * MAPPED_KIT_NEAR_MAX;
    const count = side === 0 ? counts0 : counts1;
    // Where it stands among its side's nearest: after every one as near or nearer.
    let rank = count;
    while (rank > 0 && (SIDE_APART[base + rank - 1] as number) > apart) rank -= 1;
    if (rank >= most) continue;
    const kept = Math.min(count + 1, most);
    for (let at = kept - 1; at > rank; at -= 1) {
      SIDE_PLANS[base + at] = SIDE_PLANS[base + at - 1] as number;
      SIDE_APART[base + at] = SIDE_APART[base + at - 1] as number;
    }
    SIDE_PLANS[base + rank] = index;
    SIDE_APART[base + rank] = apart;
    if (side === 0) counts0 = kept;
    else counts1 = kept;
  }
  // A side in turn, the nearest's first.
  let chosen = 0;
  for (let turn = 0; chosen < most && turn < most; turn += 1) {
    if (turn < counts0 && chosen < most) {
      into[chosen] = SIDE_PLANS[turn] as number;
      chosen += 1;
    }
    if (turn < counts1 && chosen < most) {
      into[chosen] = SIDE_PLANS[MAPPED_KIT_NEAR_MAX + turn] as number;
      chosen += 1;
    }
  }
  if (into.length !== chosen) into.length = chosen;
  return into;
}

/** {@link nearWraps}' rider, `x, z`. */
const RIDER = new Float64Array(2);

/** {@link nearWraps}' focus, `x, z`, and the nearest plan's squared distance from it. */
const FOCUS = new Float64Array(3);

/** {@link MAPPED_BUILDING_NEAR_METRES}, squared. */
const NEAR_SQUARED = MAPPED_BUILDING_NEAR_METRES * MAPPED_BUILDING_NEAR_METRES;

/** {@link nearWraps}' scratch: each side's nearest plans and how far each is, so a call allocates nothing. */
const SIDE_PLANS = new Int32Array(2 * MAPPED_KIT_NEAR_MAX);
const SIDE_APART = new Float64Array(2 * MAPPED_KIT_NEAR_MAX);
/** The walk's own list of {@link nearWraps}, reused. */
const WALK_WRAPS: number[] = [];

/**
 * {@link selectMappedBuildings}' one walk, drawing at most `wraps` plans as
 * their wraps of facade pieces — #3334; 0 where the kit is not loaded.
 */
function walkMappedBuildings(
  buildings: MappedBuildings,
  x: number,
  z: number,
  triangleBudget: number,
  into: MappedSelection,
  surfaceSlots: number,
  rivals: RivalStructures,
  models: readonly number[] | undefined,
  ahead: Float32Array | undefined,
  wraps: number,
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
    // #2429: ranked by the road ahead, where there is one.
    distances[index] =
      ahead === undefined ? apart : rankFrom(ahead, x, z, plan.centroid.x, plan.centroid.z);
    order[inReach] = index;
    inReach += 1;
  }
  // Ties broken by index, so the same ride draws the same town every time.
  order
    .subarray(0, inReach)
    .sort((a, b) => (distances[a] as number) - (distances[b] as number) || a - b);
  const landmarks = landmarksAhead(plans, order, inReach);
  // #3334: which plans may be wraps: the nearest to the rider, never the road's ranking.
  const kitted = wraps > 0 ? nearWraps(buildings, x, z, ahead, wraps, WALK_WRAPS) : NO_WRAPS;
  const slots = Math.min(surfaceSlots, FOOTPRINT_SURFACES.length);
  // #1638: past MAPPED_BUILDING_MAX only where a city centre's far-level cap is on.
  const most = Math.min(mappedBuildingCap(buildings), into.plans.length);
  let stopped = false;
  for (let at = 0; at < inReach && into.count < most; at += 1) {
    const index = order[at] as number;
    const plan = plans[index] as FootprintPlan;
    const rank = distances[index] as number;
    const far = Math.hypot(plan.centroid.x - x, plan.centroid.z - z) > MAPPED_BUILDING_NEAR_METRES;
    // #1638: past MAPPED_BUILDING_MAX, a city centre's far boxes and nothing
    // else. Any other building is passed over. (Where this sits does not change
    // the result: a rival the skip would leave unranked is taken by the next
    // city box's `rivalsWithin` or by the final sweep.)
    if (into.count >= MAPPED_BUILDING_MAX && !(far && plan.urban === 'city-centre')) continue;
    // #2094: a landmark taken ahead ranks no rival in, so it brings no hedge
    // nearer than a house the walk has not reached yet. Two costs it does
    // accept, by design (ADR 0054's 2026-11-03 amendment): its triangles come
    // out of the shared budget before any rival is ranked, so a binding budget
    // can drop a structure nearer the rider than the church; and it opens its
    // wall and roof slots before the nearest houses, so the slot check below
    // can pass over a near house that would need a 7th surface.
    if (at >= landmarks && !rivalsWithin(rank)) {
      stopped = true;
      break;
    }
    // #1585: near, with a model that fits, and the models loaded. With no
    // slot left for the models' group the plan is drawn as its extrusion,
    // whose surfaces may already be open, rather than passed over.
    /** The wraps' one group, counted inside the slots once it is open — #3334. */
    const kitGroup = into.kitCount > 0 ? 1 : 0;
    const modelTriangles =
      far ||
      plan.model === undefined ||
      models === undefined ||
      (into.modelCount === 0 && into.surfaces.length + kitGroup + 1 > slots)
        ? undefined
        : models[plan.model.model];
    // #3334: near, wrapped, and the kit loaded; with no slot left for the
    // wraps' group the plan is drawn as its extrusion, as a model's is.
    const kitTriangles =
      far ||
      plan.kit === undefined ||
      modelTriangles !== undefined ||
      // The nearest few only, a side of the street in turn: `wraps` of them, so never more
      // than `MAPPED_KIT_TRIANGLES`.
      !kitted.includes(index) ||
      (into.kitCount === 0 && into.surfaces.length + (into.modelCount > 0 ? 1 : 0) + 1 > slots)
        ? undefined
        : plan.kit.triangles;
    const triangles =
      modelTriangles ?? kitTriangles ?? (far ? plan.farTriangleCount : plan.triangleCount);
    if (into.triangles + rivalTriangles + triangles > triangleBudget) {
      // A landmark taken ahead that does not fit leaves the nearest to their own walk.
      if (at < landmarks) continue;
      stopped = true;
      break;
    }
    /** The models' one group, counted inside the slots once it is open. */
    const modelGroup = into.modelCount > 0 ? 1 : 0;
    if (modelTriangles !== undefined) {
      into.plans[into.count] = index;
      into.far[into.count] = 0;
      into.modelled[into.count] = 1;
      into.kitted[into.count] = 0;
      into.count += 1;
      into.near += 1;
      into.modelCount += 1;
      into.modelTriangles += modelTriangles;
      into.triangles += modelTriangles;
      continue;
    }
    if (kitTriangles !== undefined) {
      // Its paved apron (#2848) is ground, and no piece of the kit: drawn with the wrap, in
      // its extrusion's own surface, where that surface's slot is open or can be and the
      // frame has its few triangles. PR #3343's look check: without it a wrapped shop stood
      // on grass where its extrusion stood on its pavement.
      const apron = roleTriangles(plan, 'apron');
      const paving = surfaceOfRole(plan, 'apron');
      const paved =
        apron > 0 &&
        into.triangles + rivalTriangles + kitTriangles + apron <= triangleBudget &&
        (slotOf(into, paving) >= 0 || into.surfaces.length + 1 + modelGroup + 1 <= slots);
      if (paved) {
        if (slotOf(into, paving) < 0) into.surfaces.push(paving);
        const slot = slotOf(into, paving);
        into.surfaceTriangles[slot] = (into.surfaceTriangles[slot] ?? 0) + apron;
        into.triangles += apron;
      }
      into.paved[into.count] = paved ? 1 : 0;
      into.plans[into.count] = index;
      into.far[into.count] = 0;
      into.modelled[into.count] = 0;
      into.kitted[into.count] = 1;
      into.count += 1;
      into.near += 1;
      into.kitCount += 1;
      into.kitTriangles += kitTriangles;
      into.triangles += kitTriangles;
      continue;
    }
    const wall = slotOf(into, plan.surfaces.wall);
    const roof = slotOf(into, plan.surfaces.roof);
    // #2206: and a spire's slate, where the plan has one and neither its walls nor its roof wear it.
    const spired = roleTriangles(plan, 'spire') > 0;
    const spire = spired ? SPIRE_SURFACE : plan.surfaces.roof;
    const opened =
      (wall < 0 ? 1 : 0) +
      (roof < 0 && plan.surfaces.roof !== plan.surfaces.wall ? 1 : 0) +
      (slotOf(into, spire) < 0 && spire !== plan.surfaces.wall && spire !== plan.surfaces.roof
        ? 1
        : 0);
    if (into.surfaces.length + opened + modelGroup + kitGroup > slots) {
      into.passed += 1;
      continue;
    }
    if (wall < 0) into.surfaces.push(plan.surfaces.wall);
    if (slotOf(into, plan.surfaces.roof) < 0) into.surfaces.push(plan.surfaces.roof);
    if (slotOf(into, spire) < 0) into.surfaces.push(spire);
    for (const role of far ? FAR_ROLES : NEAR_ROLES) {
      const slot = slotOf(into, surfaceOfRole(plan, role));
      into.surfaceTriangles[slot] = (into.surfaceTriangles[slot] ?? 0) + roleTriangles(plan, role);
    }
    into.plans[into.count] = index;
    into.far[into.count] = far ? 1 : 0;
    into.modelled[into.count] = 0;
    into.kitted[into.count] = 0;
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
 * since #1588 on its driveway — since #2848 on its apron too — or within
 * `drivewayMargin` of it, {@link DRIVEWAY_MARGIN_METRES} unless the caller
 * says more.
 *
 * Where `drivewayMargin` is wider than {@link SETTLEMENT_MARGIN_METRES} —
 * a broadleaf at the top of its scale reaches 6.06 m (`scene.ts`
 * §`sideRoadNaturalMargin`) — the cells that much further round `(x, z)` are
 * looked up too: a plan is only listed in the cells its reach and that
 * margin touch. Otherwise it is the one cell `(x, z)` is in, as before.
 */
export function onMappedGround(
  buildings: MappedBuildings,
  x: number,
  z: number,
  drivewayMargin: number = DRIVEWAY_MARGIN_METRES,
): boolean {
  const margin = SETTLEMENT_MARGIN_METRES;
  const beyond = Math.max(0, drivewayMargin - margin);
  const fromX = Math.floor((x - beyond) / CELL_METRES);
  const toX = Math.floor((x + beyond) / CELL_METRES);
  const fromZ = Math.floor((z - beyond) / CELL_METRES);
  const toZ = Math.floor((z + beyond) / CELL_METRES);
  for (let ix = fromX; ix <= toX; ix += 1) {
    for (let iz = fromZ; iz <= toZ; iz += 1) {
      const list = buildings.cells.get(cellKey(ix, iz));
      if (list === undefined) continue;
      for (const index of list) {
        const plan = buildings.plans[index] as FootprintPlan;
        const reach = (buildings.radii[index] as number) + margin + beyond;
        const dx = x - plan.centroid.x;
        const dz = z - plan.centroid.z;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (insideRing(plan.footprint, x, z)) return true;
        if (squaredToRing(plan.footprint, x, z) <= margin * margin) return true;
        if (plan.driveway.length > 0) {
          if (insideRing(plan.driveway, x, z)) return true;
          if (squaredToRing(plan.driveway, x, z) <= drivewayMargin ** 2) return true;
        }
        // #2848: a shop's apron is paved ground as a driveway is.
        if (plan.apron.length > 0) {
          if (insideRing(plan.apron, x, z)) return true;
          if (squaredToRing(plan.apron, x, z) <= drivewayMargin ** 2) return true;
        }
      }
    }
  }
  return false;
}

/**
 * The natural scenery, less every tree, shrub and rock on a mapped building's
 * ground — #1549, #1534's rule extended to data. Pure, and a function of
 * positions only; `undefined` (a ride with no plans) returns `natural` itself.
 *
 * `drivewayMargin` is how far off a driveway each item stands — #2428:
 * `scene.ts` hands in `sideRoadNaturalMargin`, the item's own drawn reach,
 * so a fir's branches do not lie across the paving as they did at the old
 * 1 m. It is never taken below {@link DRIVEWAY_MARGIN_METRES}, and it is
 * handed in because `near-field.ts`, where the reach is, imports this file.
 */
export function clearOfMappedBuildings(
  natural: readonly ScatterItem[],
  buildings: MappedBuildings | undefined,
  drivewayMargin?: (item: ScatterItem) => number,
): readonly ScatterItem[] {
  if (buildings === undefined || buildings.plans.length === 0) return natural;
  return natural.filter(
    (item) =>
      !SETTLEMENT_CLEARED_KINDS.has(item.kind) ||
      !onMappedGround(
        buildings,
        item.x,
        item.z,
        drivewayMargin === undefined
          ? DRIVEWAY_MARGIN_METRES
          : Math.max(DRIVEWAY_MARGIN_METRES, drivewayMargin(item)),
      ),
  );
}

/**
 * Whether a structure's footprint standing at `at` comes within `margin` of
 * any mapped building's driveway — #2428 — or, since #2848, its apron: its
 * footprint sampled as `cross-streets.ts` §`onSideRoad` samples it, each
 * sample measured against the paving's outline, which is its drawn paving in
 * plan.
 *
 * Only the cells the footprint's reach touches are looked up, and only a
 * plan within that reach of its centroid is sampled at all, so a frame's few
 * hundred structures cost a few lookups each and the samples only beside a
 * driveway.
 */
export function onDriveway(
  buildings: MappedBuildings,
  at: { readonly x: number; readonly z: number; readonly rotation: number },
  footprint: Footprint,
  margin: number,
  /**
   * #3132: and on the building's own footprint, by any overlap: a procedural
   * building standing on a mapped one's plot. Off, the driveway and apron alone.
   */
  onBuilding = false,
): boolean {
  const reach = Math.hypot(footprint.x, Math.max(-footprint.back, footprint.front)) + margin;
  const fromX = Math.floor((at.x - reach) / CELL_METRES);
  const toX = Math.floor((at.x + reach) / CELL_METRES);
  const fromZ = Math.floor((at.z - reach) / CELL_METRES);
  const toZ = Math.floor((at.z + reach) / CELL_METRES);
  let samples: number[] | undefined;
  for (let ix = fromX; ix <= toX; ix += 1) {
    for (let iz = fromZ; iz <= toZ; iz += 1) {
      const list = buildings.cells.get(cellKey(ix, iz));
      if (list === undefined) continue;
      for (const index of list) {
        const plan = buildings.plans[index] as FootprintPlan;
        if (!onBuilding && plan.driveway.length === 0 && plan.apron.length === 0) continue;
        const near = (buildings.radii[index] as number) + reach;
        const dx = at.x - plan.centroid.x;
        const dz = at.z - plan.centroid.z;
        if (dx * dx + dz * dz > near * near) continue;
        samples ??= footprintSamples(at, footprint);
        if (onBuilding) {
          for (let p = 0; p + 1 < samples.length; p += 2) {
            if (insideRing(plan.footprint, samples[p] as number, samples[p + 1] as number)) {
              return true;
            }
          }
        }
        // #2848: an apron's outline as a driveway's. An empty ring holds no point and has no edge.
        for (const paving of [plan.driveway, plan.apron]) {
          for (let p = 0; p + 1 < samples.length; p += 2) {
            const x = samples[p] as number;
            const z = samples[p + 1] as number;
            if (insideRing(paving, x, z)) return true;
            if (squaredToRing(paving, x, z) < margin * margin) return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * `items`, less every structure whose footprint (`settlements.ts`
 * §`STRUCTURE_FOOTPRINTS`) comes within `cross-streets.ts`
 * §`SIDE_ROAD_STRUCTURE_MARGIN_METRES` of a mapped building's driveway —
 * #2428, the side roads' rule for a structure, held for a driveway. A
 * roadside hedge row stands on the verge a driveway crosses, so the piece
 * across its end is left out and the row stops short of it each side.
 * Since #3132 also every building (`buildings.ts` §`BUILT_KINDS`) whose
 * footprint overlaps a mapped building's: an open-world ride has no land
 * class, so a procedural village could be sited on a mapped town, its houses
 * on the mapped buildings' plots and through their walls. Anything with no
 * footprint is kept: {@link clearOfMappedBuildings} clears the natural
 * scenery. The same array where there are no plans.
 */
export function clearOfDriveways(
  items: readonly ScatterItem[],
  buildings: MappedBuildings | undefined,
): readonly ScatterItem[] {
  if (buildings === undefined || buildings.plans.length === 0) return items;
  return items.filter((item) => {
    const footprint = (STRUCTURE_FOOTPRINTS as Readonly<Record<string, Footprint>>)[item.kind];
    return (
      footprint === undefined ||
      !onDriveway(
        buildings,
        item,
        footprint,
        SIDE_ROAD_STRUCTURE_MARGIN_METRES,
        isBuiltKind(item.kind),
      )
    );
  });
}
