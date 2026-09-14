// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the scenery goes, and what kind it is — #243.
 *
 * This file places nothing on screen. It answers *"what stands beside the road
 * between here and there"* as a pure function of the athlete's own imported
 * route, and `three-renderer.ts` draws the answer (#244). The split is the same
 * one `terrain.ts` and `world.ts` already make, and for the same reason: every
 * number below is asserted in jsdom, where no GL context exists.
 *
 * ## The inputs are the route and nothing else
 *
 * ADR 0008 **D-5** settled that the route is the world source — *"a route the
 * athlete imported is the one world source that cannot be an infringement"* —
 * and #19 / ADR 0009 **L2** forbid deriving any world asset, texture, model or
 * course geometry from another product, *including "for reference"*. Nothing
 * here was consulted from one. §"Provenance" below says where each threshold
 * came from, because "it looked right" is the answer #240's BR-1 exists to
 * prevent.
 *
 * ## Determinism is the contract (#240 FR-3)
 *
 * The same route must produce the same world on every ride, on every device, in
 * every tab. Three properties together are what make that true, and each is
 * asserted:
 *
 * 1. **The seed comes from the route**, through {@link scatterSeed} — its first
 *    coordinate and its length. Not from the store id, which does not exist for
 *    a route ridden before it is saved; not from a clock; not from a counter.
 * 2. **Placement is a stateless hash of where you are**, never a walk forward
 *    from where you were. {@link scatterAt} for `[0, 400)` and the concatenation
 *    of `[0, 200)` and `[200, 400)` return the same items. A generator that
 *    accumulated state would pass every straight-line test and shift the scenery
 *    on lap two of a loop and on every rejoin after a pause.
 * 3. **Nothing non-deterministic is reachable from this file.** No random
 *    source, no clock and no timer appears in it, and `scatter.test.ts` asserts
 *    that over this file's own source rather than by review. ⚠️ That assertion
 *    is a **grep**, so this comment may not spell any of the three names it
 *    looks for — which is why the paragraph reads the way it does.
 *
 * ⚠️ **This file must not import `three`, including `three/addons`.** `three` is
 * confined to `three-renderer.ts` (CLAUDE.md §4h, `port.ts`), and a second
 * importer would defeat ADR 0008 D-2's recorded React Native fallback and fold
 * ~600 kB toward the entry chunk. `three/addons/math/SimplexNoise.js` would have
 * been the obvious source of a noise field; the integer hash below is written
 * here instead, which is the choice #243 asked to be made explicitly.
 *
 * ## Provenance — what is published, and what is this repository's own
 *
 * | Constant | Where it came from |
 * |---|---|
 * | The tree line | `world.ts`'s {@link treeLineMetres}, whose two anchors are published — equatorial tree lines in the Andes and on Kilimanjaro near 3 900–4 000 m, and the northern tree line reaching the coast near 70° N. The straight line between them is this repository's own approximation |
 * | {@link BOREAL_LATITUDE_DEGREES} | Anchored on the published fact that the boreal/taiga belt dominates roughly 50–60° of latitude. **The ramp to it is this repository's own**, not anybody's table |
 * | {@link STEEP_GRADE_PERCENT} | **This repository's own.** A pitch at which a road is cut into the hillside rather than laid on it, so the planting beside it is scrub rather than standing timber |
 * | {@link TIGHT_BEND_RADIANS_PER_METRE} | **This repository's own**, stated as a radius: 1/50 m⁻¹, a bend tight enough that a real road would be posted |
 * | {@link SETTLEMENT_TREE_LINE_FRACTION}, {@link SETTLEMENT_GRADE_PERCENT} | **This repository's own.** People build on the valley floor and not on the pitch |
 * | {@link SCATTER_VERGE_METRES}, {@link SCATTER_BAND_METRES} | **This repository's own**, and the verge is a requirement rather than a taste — see the criterion it discharges on {@link SCATTER_VERGE_METRES} |
 * | The weights and densities | **This repository's own**, chosen so that each of the three named places — valley floor, above the trees, a steep pitch — reads as a different place, which is what `scatter.test.ts` asserts |
 * | {@link fmix32} | MurmurHash3's 32-bit finaliser, Austin Appleby, **placed in the public domain by its author**. Arithmetic, and the one piece of this file that is anybody else's idea |
 *
 * ## What it deliberately does not model
 *
 * Land use, field boundaries, buildings that are actually there, and the
 * difference between a lane and a motorway. None of them is in a `RouteProfile`
 * and reaching for one would be #240's "merely expensive" list item 1 — the
 * first outbound request `apps/web/src` has ever made. That is #248's decision
 * to take, not this file's.
 */

import {
  distanceOnRoute,
  elevationAt,
  gradeAt,
  positionAt,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';

import { ROAD_WIDTH_METRES, localGroundPosition, type CorridorOrigin } from './terrain';
import { treeLineMetres } from './world';

/**
 * What can stand beside the road.
 *
 * ⚠️ A **kind**, never a colour and never a mesh — the same reasoning
 * `port.ts` §`RiderMarker` gives. A caller handed a colour can pass the same one
 * twice; a caller handed a kind leaves the renderer responsible for telling a
 * conifer from a rock, which is where that responsibility belongs.
 */
export type ScatterKind =
  'tree-broadleaf' | 'tree-conifer' | 'shrub' | 'rock' | 'post' | 'building';

/**
 * Every kind, in a fixed order.
 *
 * The order is load-bearing: {@link pickKind} walks it to turn one uniform
 * number into a kind, so reordering it changes every world. It is also what
 * `scatter.test.ts` iterates to assert that no member is dead code.
 */
export const SCATTER_KINDS: readonly ScatterKind[] = [
  'tree-broadleaf',
  'tree-conifer',
  'shrub',
  'rock',
  'post',
  'building',
];

/** One thing standing beside the road. */
export interface ScatterItem {
  readonly kind: ScatterKind;
  /** Local metres, the same frame `terrain.ts` builds the corridor in. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw, radians. */
  readonly rotation: number;
  /** {@link SCATTER_SCALE_LOWEST} to {@link SCATTER_SCALE_HIGHEST}. */
  readonly scale: number;
}

/**
 * How much scenery a caller will accept, and where the rider is.
 *
 * ⚠️ **The rider's odometer is here rather than a seventh positional parameter**,
 * because it is only ever read by the thinning — it plays no part in deciding
 * *what* is placed, and putting it in the budget says so. Everything in this
 * object is about how much of the world survives, and nothing in it changes
 * where anything is.
 */
export interface ScatterBudget {
  /** The most items one call may return. */
  readonly maxItems: number;
  /**
   * The rider's odometer, in route metres. **Unwrapped**, like every other
   * distance that crosses `scene.ts` — see `terrain.ts` §`CorridorPoint.along`.
   */
  readonly riderMetres: number;
}

/**
 * The most items a frame carries by default: **240**.
 *
 * ⚠️ **This repository's own, and a placeholder in one specific sense**: #245
 * makes scenery density a rung on `quality.ts`'s ladder, and this constant is
 * what that issue will replace with a per-level figure. Until then it is one
 * number for every device, which is the honest state — ADR 0008 D-2's
 * measurement was waived rather than passed and #247 is the run that would
 * settle it, so a number that claimed to be tuned would be claiming a
 * measurement nobody has made.
 */
export const SCATTER_MAX_ITEMS = 240;

/**
 * The nominal spacing of the placement grid, in metres: **10**.
 *
 * The same figure as `packages/domain`'s `PROFILE_RESOLUTION_METRES`, and for
 * the same reason `terrain.ts` gives for `CENTRE_LINE_PERIOD_METRES`: it is a
 * constant of its own and deliberately **not** a reference to
 * `profile.resolution`, which is the route's *actual* spacing and differs by up
 * to half a metre from one import to the next. Scenery whose density followed
 * that field would be a property of the file's sampling rather than of the
 * place.
 *
 * ⚠️ It is nominal. {@link cellSpanMetres} stretches it so a loop tiles exactly
 * — see there for why the seam depends on it.
 */
export const SCATTER_CELL_METRES = 10;

/**
 * How many things may stand in one cell, on one side of the road: **4**.
 *
 * Each slot owns its own sub-interval of the cell *and* its own lateral
 * sub-band, which is what gives {@link MINIMUM_SCATTER_SEPARATION_METRES} its
 * value: two items can never be placed on top of each other, whatever the
 * hashes say.
 */
export const SLOTS_PER_CELL_SIDE = 4;

/**
 * How far from the road's edge the nearest thing may stand: **1.5 m**.
 *
 * ⚠️ **A requirement, not a taste.** #243's fifth criterion is that nothing is
 * placed on the road, and the carriageway is `ROAD_WIDTH_METRES` wide, so the
 * nearest lateral offset any item can take is
 * `ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES`. A tree in the carriageway is
 * the defect a rider notices first, and it is the one a lateral offset drawn
 * from `[0, band)` rather than `[verge, verge + band)` would produce on about
 * one item in fifteen.
 */
export const SCATTER_VERGE_METRES = 1.5;

/** How wide the band scenery is scattered into is, beyond the verge: 16 m. */
export const SCATTER_BAND_METRES = 16;

/** The smallest an item is drawn. @see ScatterItem.scale */
export const SCATTER_SCALE_LOWEST = 0.7;

/** The largest an item is drawn — so a stand of trees is not a row of clones. */
export const SCATTER_SCALE_HIGHEST = 1.4;

/** How much of its own slot an item may be placed in: the middle half. */
export const SLOT_FILL = 0.5;

/**
 * The closest two items are ever placed: **2 m**.
 *
 * Not a check performed at runtime — a **property of the slot layout**, stated
 * here so `scatter.test.ts` can assert it, and derived rather than guessed:
 *
 * - Two items **in one cell on one side** differ by at least one slot, and a
 *   slot is `SCATTER_BAND_METRES / SLOTS_PER_CELL_SIDE` = 4 m of band and
 *   `cellSpan / SLOTS_PER_CELL_SIDE` ≈ 2.5 m of road. {@link inSlot} leaves
 *   `1 − SLOT_FILL` of each as margin, so the separation is at least 2 m
 *   laterally **and** 1.25 m along at the same time.
 * - Two items **in adjacent cells in the same slot** are at least
 *   `cellSpan · (1 − SLOT_FILL / SLOTS_PER_CELL_SIDE)` ≈ 8.7 m apart along.
 * - The **two sides** of the road are `ROAD_WIDTH_METRES + 2 ·
 *   SCATTER_VERGE_METRES` = 10 m apart.
 *
 * ⚠️ **The along-separations compress on the inside of a bend**, by the ratio of
 * the offset to the radius: a hairpin of 25 m radius shrinks an 8.7 m gap at the
 * outer edge of the band to about 1.4 m. What that produces is two rocks
 * touching on the inside of a hairpin — a drawing artefact for #244's cull to
 * live with — and **not** the defect this constant exists to catch, which is two
 * items at the *same* position because the loop seam placed a cell twice. The
 * lateral separations do not compress, and they are what holds at any radius.
 *
 * @unwired a bound, not a setting: `scatter.test.ts` measures the placement
 * against it and no scenery decision reads it. Wiring it into the placer would
 * make the test assert the code against itself.
 */
export const MINIMUM_SCATTER_SEPARATION_METRES = 2;

/**
 * The latitude by which conifer has entirely displaced broadleaf: **60°**.
 *
 * @see the provenance table in this file's header.
 */
export const BOREAL_LATITUDE_DEGREES = 60;

/** The gradient at which a road reads as cut into the hill: 8 %. */
export const STEEP_GRADE_PERCENT = 8;

/** The curvature at which a bend reads as tight: 1/50 m⁻¹. */
export const TIGHT_BEND_RADIANS_PER_METRE = 1 / 50;

/** How far either side of a point the bend is measured over, in metres. */
export const CURVATURE_WINDOW_METRES = 30;

/**
 * Below this, the road has no direction at all: **a micrometre**.
 *
 * Not zero, because the two grid points either side of an out-and-back's
 * turning point are the *same* point reached by two different sums of the same
 * floats, and they come back differing in their last bits rather than not at
 * all. A twenty-metre baseline that measures 10⁻¹³ m is not a direction; it is
 * the rounding error, and normalising it would turn that error into a bearing.
 */
export const DEGENERATE_TANGENT_METRES = 1e-6;

/** How far up the local tree line people still build: a fifth of the way. */
export const SETTLEMENT_TREE_LINE_FRACTION = 0.2;

/** The gradient above which nobody builds beside the road, in percent. */
export const SETTLEMENT_GRADE_PERCENT = 3;

/**
 * How much more readily a near item survives the budget than a far one.
 *
 * ⚠️ **The whole of #243's sixth criterion.** Thinning has to remove items when
 * the geography argues for more than the budget allows, and the tempting way to
 * do that — take the first `maxItems` of the list — empties the far half of the
 * view and reads as a wall across the road. So each item carries a uniform rank
 * and the rank is *inflated* by how far the item is from the rider: a far item
 * is three times less likely to survive than a near one, and is never simply
 * excluded. See {@link thin}.
 */
export const SCATTER_NEAR_BIAS = 2;

/** Density in the trees: nine cells in ten carry something in every slot. */
const DENSITY_IN_TREES = 0.9;

/** Density on a steep pitch: cleared once, and only scrub came back. */
const DENSITY_ON_A_PITCH = 0.45;

/** Density above the trees: a quarter. Rock, and not much of it. */
const DENSITY_ABOVE_THE_TREES = 0.25;

/** The weight the trees carry between them on the valley floor. */
const WEIGHT_TREES = 7;

/** What is placed between the trees. */
const WEIGHT_SHRUB_IN_TREES = 2;
const WEIGHT_ROCK_IN_TREES = 0.5;

/** A pitch: scrub and exposed rock, with the last of the trees. */
const WEIGHT_SHRUB_ON_A_PITCH = 5;
const WEIGHT_ROCK_ON_A_PITCH = 3;
const WEIGHT_TREES_ON_A_PITCH = 1;

/** Above the trees. */
const WEIGHT_ROCK_ABOVE_THE_TREES = 6;
const WEIGHT_SHRUB_ABOVE_THE_TREES = 2;

/** How much of a place a tight bend's posts take, at full curvature. */
const WEIGHT_POST_AT_A_TIGHT_BEND = 4;

/** How much of a valley floor is built on. Small: a building is an event. */
const WEIGHT_BUILDING_ON_THE_VALLEY_FLOOR = 0.6;

/** Every uniform this file draws, one stream each, so none of them correlate. */
const STREAM_KEEP = 0;
const STREAM_ALONG = 1;
const STREAM_LATERAL = 2;
const STREAM_ROTATION = 3;
const STREAM_SCALE = 4;
const STREAM_KIND = 5;
const STREAM_RANK = 6;

/** An odd multiplier, so that `stream` reaches a different part of the hash. */
const STREAM_STRIDE = 0x9e37_79b1;

/** `2³²`, for turning a `uint32` into a number in `[0, 1)`. */
const UINT32_SCALE = 0x1_0000_0000;

/** An arbitrary non-zero start, so a route at (0, 0) of length 0 still mixes. */
const SEED_BASIS = 0x6f79_6c00;

/** Where the route's own coordinates are rounded to, before they are mixed. */
const SEED_COORDINATE_SCALE = 1e5;

/**
 * The seed a route implies.
 *
 * ⚠️ **From the route's own first coordinate and its length, and from nothing
 * else.** Not from the store id — a route can be ridden before it is saved, and
 * seeding from an id would give the same road two different worlds either side
 * of a save. Not from a clock, which would give it a different world every ride.
 *
 * The coordinates are rounded to {@link SEED_COORDINATE_SCALE} — about a metre —
 * before they are mixed, so that two imports of the same ride whose floating
 * point differs in the last bit still seed the same world.
 */
export function scatterSeed(profile: RouteProfile): number {
  const first = profile.positions[0] as GeographicPosition;
  let seed = SEED_BASIS;
  seed = mix(seed, Math.round(first.latitude * SEED_COORDINATE_SCALE));
  seed = mix(seed, Math.round(first.longitude * SEED_COORDINATE_SCALE));
  seed = mix(seed, Math.round(profile.totalDistance));
  return seed >>> 0;
}

/**
 * Everything standing beside the road between two odometer readings.
 *
 * Pure, total and **stateless**: the answer for a span depends on the span and
 * on nothing that was asked for before it. See this file's header for why that
 * is the contract rather than an implementation detail.
 *
 * `fromMetres` and `toMetres` are odometer readings — unwrapped, like
 * `CorridorPoint.along` — so on a loop the caller passes the same
 * ever-increasing numbers the simulation produces and the wrap is handled here.
 */
export function scatterAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  budget: ScatterBudget,
): readonly ScatterItem[] {
  // ⚠️ **There is deliberately no early return for a degenerate call**, and
  // three of them were written here and then removed because no mutation could
  // turn any of them red:
  //
  // - *A route of no length.* `routeProfile` refuses one outright — *"every
  //   point of this route is in the same place"* — so {@link cellSpanMetres} is
  //   always positive. `scatter.test.ts` asserts the refusal, against the
  //   function that actually makes the promise.
  // - *A span of no length, or one that runs backwards.* The cell count below
  //   comes out zero, so the loop does not run.
  // - *A budget of nothing.* {@link thin} takes none.
  //
  // The behaviour is still asserted — it is the *guards* that were redundant,
  // and a guard that cannot be observed is a line that hides which code is
  // really responsible for an answer.
  const span = cellSpanMetres(profile);
  const cellCount = Math.max(1, Math.round(profile.totalDistance / span));
  // Every cell that can hold an item inside `[from, to)`. A cell's items lie in
  // `[cell · span, (cell + 1) · span)`, so the range is wider than the span at
  // both ends and each item is admitted on its own `along` below.
  //
  // ⚠️ A route that does not loop is **clamped to its own cells**, rather than
  // the cells beyond its end being generated and discarded. That is the same
  // choice `distanceOnRoute` makes — there is no terrain past the end of a route
  // nobody surveyed — and it is also what stops a span far beyond the end from
  // costing anything at all.
  const firstCell = profile.loop
    ? Math.floor(fromMetres / span)
    : Math.max(0, Math.floor(fromMetres / span));
  const lastCell = profile.loop
    ? Math.ceil(toMetres / span) - 1
    : Math.min(cellCount - 1, Math.ceil(toMetres / span) - 1);

  // ⚠️ **Never more cells than the route has**, and this is the whole of the
  // loop-seam de-duplication: consecutive cell indices wrap onto distinct places
  // for exactly `cellCount` of them, so a lap's worth is also *one* of every
  // place. A loop shorter than the view would otherwise come round inside a
  // single span and be placed twice, which is the "doubled up" half of #243's
  // fourth criterion.
  //
  // ⚠️ It is also the bound that keeps this loop's cost off a hostile file. A
  // `RouteProfile` is built from an imported GPX, and a route a few centimetres
  // long has a cell span to match: without the `cellCount` cap, a 460 m view
  // over a 1 cm route is forty-six thousand iterations **per frame**, on the
  // thread GATT notifications arrive on. `terrain.ts`'s `MAXIMUM_CORRIDOR_QUADS`
  // and `world.ts`'s `WORLD_SAMPLE_LIMIT` are the same bound one layer down and
  // for the same reason. A `NaN` span makes this `NaN`, and `0 < NaN` is false,
  // so the loop does not run rather than not terminating.
  const cells = Math.min(cellCount, Math.max(0, lastCell - firstCell + 1));

  const found: Placed[] = [];
  for (let step = 0; step < cells; step += 1) {
    const cell = firstCell + step;
    const wrapped = ((cell % cellCount) + cellCount) % cellCount;
    fillCell(profile, origin, seed, { cell, wrapped, span, fromMetres, toMetres }, found);
  }

  return thin(found, budget);
}

/** An item, with the odometer reading it was placed at. @see thin */
interface Placed {
  readonly item: ScatterItem;
  /** The uniform rank the thinning sorts on, before the distance bias. */
  readonly rank: number;
  /** Unwrapped, so the distance to the rider is a subtraction. */
  readonly along: number;
}

/**
 * The grid spacing that tiles this route exactly.
 *
 * ⚠️ **Why the nominal spacing is stretched rather than used.** On a loop the
 * cell at the seam would otherwise be a partial one, and an item placed in it
 * at a fraction of a whole cell would land past `totalDistance` — which wraps,
 * and lands on top of whatever cell zero put there. Dividing the route into a
 * whole number of equal cells makes the seam an ordinary cell boundary, which
 * is what "does not double up or leave a bare gap" means in code.
 *
 * A route shorter than one nominal cell gets exactly one cell rather than none.
 */
export function cellSpanMetres(profile: RouteProfile): number {
  const cells = Math.max(1, Math.round(profile.totalDistance / SCATTER_CELL_METRES));
  return profile.totalDistance / cells;
}

/** What the geography at one cell says about what grows there. */
interface Place {
  readonly altitude: number;
  readonly treeLine: number;
  readonly latitude: number;
  /** Magnitude, in percent. Which way the road tilts does not change the trees. */
  readonly steepness: number;
  /** Magnitude, in radians per metre. */
  readonly curvature: number;
}

/** One cell of the placement grid, and the span it is being asked about. */
interface Cell {
  /** Unwrapped, so an item's distance from the rider is a subtraction. */
  readonly cell: number;
  /** Wrapped onto the route. What the hash and the geography are read at. */
  readonly wrapped: number;
  readonly span: number;
  readonly fromMetres: number;
  readonly toMetres: number;
}

/** Every slot of one cell that falls inside the span, appended to `found`. */
function fillCell(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  cell: Cell,
  found: Placed[],
): void {
  // ⚠️ The **wrapped** cell, and this one is belt and braces rather than load
  // bearing: every profile reader below goes through `distanceOnRoute`, which
  // wraps a loop and clamps a point-to-point route, so passing the unwrapped
  // index here produces the same answer. It is spelled `wrapped` because the
  // geography of a place is a property of the place, and a reader should not
  // have to follow three functions into `packages/domain` to satisfy themselves
  // that lap two reads the same hill. The hash below is a different matter — it
  // goes through nothing, and `wrapped` there is the whole seam.
  const centreOfCell = (cell.wrapped + 0.5) * cell.span;
  const place = placeAt(profile, centreOfCell);
  const density = densityAt(place);
  const weights = kindWeights(place);

  for (const side of [-1, 1]) {
    for (let slot = 0; slot < SLOTS_PER_CELL_SIDE; slot += 1) {
      // ⚠️ Hashed on the WRAPPED cell, so the same place on lap two is the same
      // place. Hashing the unwrapped cell would reseed the whole world every lap.
      const base = hash(seed, cell.wrapped, side * SLOTS_PER_CELL_SIDE + slot);
      if (uniform(base, STREAM_KEEP) >= density) {
        continue;
      }

      // Each slot owns a sub-interval of the cell and a sub-band of the verge,
      // and fills the middle {@link SLOT_FILL} of each — which is what makes
      // MINIMUM_SCATTER_SEPARATION_METRES a property of the layout rather than a
      // runtime check. @see MINIMUM_SCATTER_SEPARATION_METRES
      const alongInCell =
        (inSlot(slot, uniform(base, STREAM_ALONG)) / SLOTS_PER_CELL_SIDE) * cell.span;
      const lateralBand = SCATTER_BAND_METRES / SLOTS_PER_CELL_SIDE;
      const lateral =
        ROAD_WIDTH_METRES / 2 +
        SCATTER_VERGE_METRES +
        inSlot(slot, uniform(base, STREAM_LATERAL)) * lateralBand;

      const along = cell.cell * cell.span + alongInCell;
      // ⚠️ **Admitted on its own `along`, half-open, rather than by which cell
      // it came from.** A cell straddles the end of a span, so emitting whole
      // cells makes `[0, 200)` and `[200, 400)` both claim the cell at 200 —
      // which is eight items placed twice, and it is exactly what #243's
      // call-order criterion catches. Half-open is what makes two adjacent
      // queries a partition rather than an overlap.
      if (along < cell.fromMetres || along >= cell.toMetres) {
        continue;
      }
      const at = distanceOnRoute(profile, cell.wrapped * cell.span + alongInCell);
      const ground = localGroundPosition(origin, positionAt(profile, at));
      const normal = normalAt(profile, origin, at);

      found.push({
        item: {
          kind: pickKind(weights, uniform(base, STREAM_KIND)),
          x: ground.x + normal.x * lateral * side,
          y: (elevationAt(profile, at) as number) - origin.elevation,
          z: ground.z + normal.z * lateral * side,
          rotation: uniform(base, STREAM_ROTATION) * Math.PI * 2,
          scale:
            SCATTER_SCALE_LOWEST +
            uniform(base, STREAM_SCALE) * (SCATTER_SCALE_HIGHEST - SCATTER_SCALE_LOWEST),
        },
        rank: uniform(base, STREAM_RANK),
        along,
      });
    }
  }
}

/**
 * Where in slot `slot` a uniform number `unit` puts something.
 *
 * ⚠️ **The middle {@link SLOT_FILL} of the slot, not the whole of it**, and that
 * is what {@link MINIMUM_SCATTER_SEPARATION_METRES} rests on. Slots that filled
 * their whole interval would *touch*: the top of slot 0's band is the bottom of
 * slot 1's, so two items could be placed a millimetre apart and the separation
 * guarantee would be worth nothing. Leaving a margin at each end of every slot
 * turns "different slots" into "separated by at least the margin".
 */
function inSlot(slot: number, unit: number): number {
  return slot + (1 - SLOT_FILL) / 2 + unit * SLOT_FILL;
}

/**
 * What the route says about one point on it.
 *
 * Read once per cell rather than once per item: the geography of a ten-metre
 * cell is one answer, and asking for it eight times would make the cost of a
 * frame eight times what it needs to be for no change in the result.
 */
function placeAt(profile: RouteProfile, at: number): Place {
  const latitude = Math.abs(positionAt(profile, at).latitude);
  return {
    altitude: elevationAt(profile, at),
    treeLine: treeLineMetres(latitude),
    latitude,
    steepness: Math.abs(gradeAt(profile, at)),
    curvature: curvatureAt(profile, at),
  };
}

/**
 * How tightly the road turns at a point, in radians per metre.
 *
 * Measured over {@link CURVATURE_WINDOW_METRES} either side rather than between
 * adjacent grid points, because a grid point is ten metres and the angle between
 * two ten-metre chords is mostly the file's own sampling noise. `RouteProfile`
 * has no bearing channel, so this is computed from the positions — which is why
 * it is here and not in `packages/domain`: one consumer.
 */
function curvatureAt(profile: RouteProfile, at: number): number {
  const before = positionAt(profile, distanceOnRoute(profile, at - CURVATURE_WINDOW_METRES));
  const here = positionAt(profile, at);
  const after = positionAt(profile, distanceOnRoute(profile, at + CURVATURE_WINDOW_METRES));

  const incoming = Math.atan2(after.latitude - here.latitude, after.longitude - here.longitude);
  const outgoing = Math.atan2(here.latitude - before.latitude, here.longitude - before.longitude);
  let turn = incoming - outgoing;
  // Into (-π, π], so a bend either side of due north is not read as a U-turn.
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn <= -Math.PI) turn += Math.PI * 2;
  return Math.abs(turn) / (CURVATURE_WINDOW_METRES * 2);
}

/**
 * The unit normal to the road at a point, in the ground plane.
 *
 * Taken from the route's own positions rather than from a stored bearing, the
 * same argument `scene.ts` §`cameraPose` makes: a separately-computed bearing is
 * a second source of truth that drifts, and here it would drift *sideways* and
 * put a tree in the road.
 *
 * ⚠️ **A forward difference with a backward fallback, and not a centred one.**
 * A centred difference is degenerate at an out-and-back's turning point — the
 * grid point before it and the grid point after it are the *same place* — and
 * the only answer left there is an arbitrary compass direction, which is a
 * branch no test could distinguish from its absence. Both of the differences
 * used here are real road directions, and between them exactly one case is left
 * over: **the last grid point of a route that does not loop**, where
 * `distanceOnRoute` clamps the forward sample onto the point itself. That case
 * is reached on every ride that gets to the end, and `scatter.test.ts` asserts
 * it, which is what makes the fallback a tested path rather than a comfort.
 */
function normalAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  at: number,
): { readonly x: number; readonly z: number } {
  const step: number = profile.resolution;
  // ⚠️ **Snapped to the grid before the lookups**, which is what `terrain.ts`
  // §`pointAt` does for the centreline and is worth the line for the same
  // reason: the samples then land on real profile entries, so the tangent is the
  // one the ribbon is actually built from rather than one interpolated a metre
  // to the side of it.
  const grid = Math.round(at / step) * step;
  const here = localGroundPosition(origin, positionAt(profile, distanceOnRoute(profile, grid)));
  const ahead = localGroundPosition(
    origin,
    positionAt(profile, distanceOnRoute(profile, grid + step)),
  );

  let dx = ahead.x - here.x;
  let dz = ahead.z - here.z;
  // ⚠️ Written as `!(length > …)` rather than `length <= …` so that a `NaN`
  // takes this branch too instead of falling through it into a `NaN` coordinate,
  // which reaches a vertex buffer and draws a black screen rather than a visible
  // fault — the argument `scene.ts` §`cameraPose` makes about a degenerate
  // look-at.
  if (!(Math.hypot(dx, dz) > DEGENERATE_TANGENT_METRES)) {
    const behind = localGroundPosition(
      origin,
      positionAt(profile, distanceOnRoute(profile, grid - step)),
    );
    dx = here.x - behind.x;
    dz = here.z - behind.z;
  }
  const length = Math.hypot(dx, dz);
  return { x: -dz / length, z: dx / length };
}

/** How much of each cell is filled, where this route runs. */
function densityAt(place: Place): number {
  if (aboveTheTrees(place)) {
    return DENSITY_ABOVE_THE_TREES;
  }
  if (place.steepness >= STEEP_GRADE_PERCENT) {
    return DENSITY_ON_A_PITCH;
  }
  return DENSITY_IN_TREES;
}

/**
 * Whether this point is above the local tree line.
 *
 * The same test `world.ts` §`groundColour` applies to decide whether the ground
 * is vegetation or rock, and deliberately the same one: a world whose ground is
 * painted as rock while conifers stand on it is two answers to one question.
 */
function aboveTheTrees(place: Place): boolean {
  return place.altitude >= place.treeLine;
}

/**
 * How much of a place each kind takes, before it is normalised.
 *
 * Three places rather than a blend, because they are genuinely different
 * places and a blend would make every route somewhere in the middle: the
 * valley floor, a pitch cut into the hill, and above the trees. The posts are
 * added on top of all three because they follow the **road** rather than the
 * ground — a bend is posted at any altitude.
 */
function kindWeights(place: Place): readonly number[] {
  // In SCATTER_KINDS order.
  const weights = [0, 0, 0, 0, 0, 0];

  if (aboveTheTrees(place)) {
    weights[3] = WEIGHT_ROCK_ABOVE_THE_TREES;
    weights[2] = WEIGHT_SHRUB_ABOVE_THE_TREES;
  } else if (place.steepness >= STEEP_GRADE_PERCENT) {
    const conifer = coniferShare(place);
    weights[2] = WEIGHT_SHRUB_ON_A_PITCH;
    weights[3] = WEIGHT_ROCK_ON_A_PITCH;
    weights[1] = WEIGHT_TREES_ON_A_PITCH * conifer;
    weights[0] = WEIGHT_TREES_ON_A_PITCH * (1 - conifer);
  } else {
    const conifer = coniferShare(place);
    weights[1] = WEIGHT_TREES * conifer;
    weights[0] = WEIGHT_TREES * (1 - conifer);
    weights[2] = WEIGHT_SHRUB_IN_TREES;
    weights[3] = WEIGHT_ROCK_IN_TREES;
    if (
      place.altitude <= place.treeLine * SETTLEMENT_TREE_LINE_FRACTION &&
      place.steepness < SETTLEMENT_GRADE_PERCENT &&
      place.curvature < TIGHT_BEND_RADIANS_PER_METRE
    ) {
      weights[5] = WEIGHT_BUILDING_ON_THE_VALLEY_FLOOR;
    }
  }

  weights[4] =
    WEIGHT_POST_AT_A_TIGHT_BEND * clamp01(place.curvature / TIGHT_BEND_RADIANS_PER_METRE);
  return weights;
}

/**
 * How much of the standing timber here is conifer rather than broadleaf.
 *
 * Two axes, and the larger wins: **latitude**, because the boreal belt displaces
 * broadleaf entirely by {@link BOREAL_LATITUDE_DEGREES}; and **altitude as a
 * fraction of the local tree line**, because the last trees below any tree line
 * are conifers whatever latitude they are at. A sea-level route at 55° and a
 * 1 200 m route at 45° both come out almost entirely conifer, by two different
 * routes, which is the behaviour wanted.
 *
 * ⚠️ Called only from the branches that use it, which is what keeps a tree line
 * of exactly zero out of the division: at and above
 * `TREE_LINE_SEA_LEVEL_LATITUDE_DEGREES` the tree line *is* zero, and any
 * altitude at or above zero takes the above-the-trees branch instead. What is
 * left is polar land **below** sea level, where `-430 / 0` is `-Infinity`, the
 * latitude term wins outright and the answer is 1. That is the same
 * two-steps-not-one reasoning `world.ts` §`groundColour` writes down, and it is
 * here for the same reason: a reader checking this line for a divide-by-zero
 * finds one.
 */
function coniferShare(place: Place): number {
  return clamp01(
    Math.max(place.latitude / BOREAL_LATITUDE_DEGREES, place.altitude / place.treeLine),
  );
}

/**
 * One uniform number, and a weight table, into a kind.
 *
 * The last kind is returned by falling out of the loop rather than by a test of
 * its own, which is not a micro-optimisation: `unit · total` compared against a
 * running sum of the same floats can land a hair the wrong side of the last
 * boundary, and a loop that tested every kind would need an unreachable
 * `return` after it to satisfy the compiler. An unreachable line is one no
 * mutation can turn red, which is the shape §5 exists to keep out.
 */
function pickKind(weights: readonly number[], unit: number): ScatterKind {
  let total = 0;
  for (const weight of weights) {
    total += weight;
  }
  let running = unit * total;
  for (let index = 0; index < weights.length - 1; index += 1) {
    running -= weights[index] as number;
    if (running < 0) {
      return SCATTER_KINDS[index] as ScatterKind;
    }
  }
  return SCATTER_KINDS[weights.length - 1] as ScatterKind;
}

/**
 * The budget, applied by thinning rather than by truncation.
 *
 * ⚠️ **#243's sixth criterion, and the one with a tempting wrong answer.**
 * `found.slice(0, maxItems)` is in cell order, so it keeps everything behind the
 * rider and nothing in front — a wall across the road at whatever distance the
 * budget ran out. Sorting on a rank that is *inflated by distance from the
 * rider* keeps the near world dense, thins the far world, and never empties it:
 * a far item with a low rank still beats a near item with a high one.
 *
 * The bias is relative to the span asked for, so a caller that asks for a longer
 * view gets the same shape of thinning rather than a harder cut-off.
 *
 * ⚠️ **The budget binds per call, so two half-span calls return more in total
 * than one whole-span call.** That is correct — each call is budgeted — and it
 * is why `scatter.test.ts`'s call-order assertion uses a budget large enough not
 * to bind. What that assertion is about is *placement*, and placement is decided
 * before anything here runs.
 */
function thin(found: readonly Placed[], budget: ScatterBudget): readonly ScatterItem[] {
  // ⚠️ **Clamped at zero, and that is not defensive tidiness.** `Array.slice`
  // reads a negative end as "from the end", so a budget of −1 would return
  // every item but the last instead of none at all — a caller asking for no
  // scenery and getting all of it.
  const keep = Math.max(0, budget.maxItems);
  if (found.length <= keep) {
    return found.map((placed) => placed.item);
  }
  const reach = Math.max(
    1,
    found.reduce(
      (widest, placed) => Math.max(widest, Math.abs(placed.along - budget.riderMetres)),
      0,
    ),
  );
  return found
    .map((placed) => ({
      placed,
      priority:
        placed.rank *
        (1 + (SCATTER_NEAR_BIAS * Math.abs(placed.along - budget.riderMetres)) / reach),
    }))
    .sort((first, second) => first.priority - second.priority)
    .slice(0, keep)
    .map((scored) => scored.placed.item);
}

/**
 * MurmurHash3's 32-bit finaliser.
 *
 * Austin Appleby placed MurmurHash3 in the public domain, so this is the one
 * piece of arithmetic here that is anybody else's idea and it carries no licence
 * obligation. It is used rather than a bespoke mix because avalanche behaviour
 * is a property that is hard to get right and easy to get subtly wrong, and a
 * weak mix here shows up as scenery that visibly repeats.
 */
function fmix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85eb_ca6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2_ae35);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/** Fold one integer into a running hash. */
function mix(running: number, value: number): number {
  return fmix32((running ^ Math.imul(value | 0, STREAM_STRIDE)) >>> 0);
}

/** The hash of one slot: the route's seed, the cell, and which slot it is. */
function hash(seed: number, cell: number, slot: number): number {
  return mix(mix(seed, cell), slot);
}

/**
 * One uniform number in `[0, 1)` from a slot's hash.
 *
 * ⚠️ Each quantity an item needs draws from its **own** stream. Reusing one
 * hash for two of them correlates them — every tall tree would also be a rotated
 * one — and the correlation is invisible in a unit test and obvious on screen.
 */
function uniform(base: number, stream: number): number {
  return fmix32((base ^ Math.imul(stream + 1, STREAM_STRIDE)) >>> 0) / UINT32_SCALE;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
