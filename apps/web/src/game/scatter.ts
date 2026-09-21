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
 * | {@link BEND_INNER_SHARE} | **Derived, not chosen.** Its two bounds come from the geometry of placing by a local normal and from {@link MINIMUM_SCATTER_SEPARATION_METRES}; the measurement that shows why it is needed is on the constant |
 * | {@link AMBIGUOUS_TURN_RADIUS_METRES}, {@link AMBIGUOUS_CHORD_SHARE} | **Derived, not chosen.** The radius at which a {@link CURVATURE_WINDOW_METRES} chord subtends more than π is `30 / π`; the first is a margin below it and the second is `\|sin θ\| / θ` at that radius, computed rather than written down |
 * | {@link SCATTER_CELL_METRES}, {@link CELL_FILL}, {@link CLUSTER_SPAN_METRES}, {@link OPEN_GROUND_SHARE}, {@link PLANTED_GROUND_SHARE} | **This repository's own**, and judged by eye on the device rather than measured — #348, whose whole content is that the numbers said the scenery was fine and it looked like a village. ⚠️ Since **#351** they also carry a *proxy* measurement, because #348 overshot far enough to empty the world and nothing here could see it: how many items stand in the nearest 60 m of road, and how often that is none. A proxy is not the device, and #351's own criterion is still by eye |
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

/**
 * How many distinct shapes one kind's items are spread across: **6**.
 *
 * ⚠️ **A slot count, not a variant count — #367.** {@link ScatterItem.variant}
 * is drawn from this range and the renderer takes it modulo however many shapes
 * the kind actually has, so this file never has to know what
 * `scenery-models.ts` holds and a kind with two shapes and a kind with three
 * both get an even split. Six is the smallest number divisible by every count
 * up to `MAXIMUM_SCENERY_VARIANTS`, which is what makes that true.
 *
 * ⚠️ It is deliberately **not** `MAXIMUM_SCENERY_VARIANTS`. Using the ceiling
 * directly would give a two-shape kind a 2:1 split — two thirds of the trees
 * one shape — and the imbalance would look like a placement bug rather than
 * arithmetic.
 */
export const SCATTER_VARIANT_SLOTS = 6;

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
  /**
   * Which of its kind's shapes this one is drawn as — #367.
   *
   * An integer in `[0, {@link SCATTER_VARIANT_SLOTS})`, from this item's own
   * slot hash on a stream of its own. So it is a function of **where the item
   * stands**, exactly as its kind, rotation and scale already are: stable
   * across frames, stable across runs, and the same on lap two as on lap one.
   *
   * ⚠️ **A number, never a file and never a mesh** — the same reasoning
   * {@link ScatterKind} carries. `scenery-models.ts` decides what shape a
   * conifer's variant 1 actually is, and this file could not name one without
   * choosing a rendering library.
   *
   * ⚠️ It plays **no part in where anything is**, which is #367's own
   * criterion: variants change what stands somewhere, not where.
   * `arrangement-unchanged.test.ts` §"places the same scenery" is what says so,
   * and it is unmoved by this field precisely because each quantity draws from
   * its own hash stream.
   */
  readonly variant: number;
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
 * The most items a frame carries **at the target quality**: **240**.
 *
 * ⚠️ **Since #245 this is one rung's figure rather than every device's**, and a
 * reviewer who remembers this comment saying *"one number for every device"* is
 * reading the old one. `quality.ts`'s `QUALITY_LADDER` carries a `scatterItems`
 * per level and takes **this constant** for level 0; a phone that is throttling
 * is handed a smaller one, which is the whole of #245. Nothing here chooses
 * between them — a budget arrives as {@link ScatterBudget.maxItems} and this
 * file spends it.
 *
 * ⚠️ **This repository's own, and still a placeholder in the sense it always
 * was**: ADR 0008 D-2's measurement was waived rather than passed and #247 is
 * the run that would settle it, so a number that claimed to be tuned would be
 * claiming a measurement nobody has made. The same warning covers the three
 * figures #245 wrote below it.
 *
 * ⚠️ **#351 left it at 240, per that issue, and changed whether it binds.**
 * Between #348 and #351 a planted stretch supplied about 162 items into this
 * budget, so the cap never came into play and {@link SCATTER_NEAR_BIAS} did
 * nothing at all. A budget nothing reaches is not a cheaper world; it is a
 * quality ladder whose top rung has quietly stopped being a rung.
 */
export const SCATTER_MAX_ITEMS = 240;

/**
 * The nominal spacing of the placement grid, in metres: **12**.
 *
 * ⚠️ **10 before #348, 20 in #348, and 12 since #351** — a reviewer who
 * remembers this comment defending a doubling is reading the old one. #348 took
 * it to 20 to break a ten-metre rhythm the eye could find in a second or two,
 * and that half was right; what it cost is the half #351 was filed for.
 *
 * ⚠️ **This is the one constant that sets the density of the *foreground*, and
 * {@link SCATTER_BANDS_PER_SIDE} is not.** The nearest band gets exactly one
 * candidate position per cell per side, so what stands in the first few metres
 * of the verge is `2 / SCATTER_CELL_METRES` per metre of road **whatever the
 * band count is**. Doubling the cell halved it, and no other number could put
 * it back: adding depth bands only adds items further away.
 *
 * ⚠️ **It is not free to shrink**, and {@link CELL_FILL} is where the price is
 * paid: the margin that separates two items in one band in adjacent cells is
 * `(1 − CELL_FILL) · cellSpan`, so a smaller cell needs a smaller fill to keep
 * {@link MINIMUM_SCATTER_SEPARATION_METRES}. At 12 m and a fill of 0.55 that
 * margin is 5.4 m and the jitter is 6.6 m — five times the 1.25 m an item had
 * before #348, and still enough of a margin that the bend compression cannot
 * take it under two metres.
 *
 * It is deliberately **not** a reference to `profile.resolution`, which is the
 * route's *actual* sample spacing and differs from one import to the next:
 * scenery whose density followed that field would be a property of the file's
 * sampling rather than of the place. That is the same argument `terrain.ts`
 * gives for `CENTRE_LINE_PERIOD_METRES`. What it is no longer is
 * `packages/domain`'s `PROFILE_RESOLUTION_METRES` — a reviewer who remembers
 * this comment saying the two agree is reading the old one.
 *
 * ⚠️ It is nominal. {@link cellSpanMetres} stretches it so a loop tiles exactly
 * — see there for why the seam depends on it.
 */
export const SCATTER_CELL_METRES = 12;

/**
 * How many things may stand in one cell, on one side of the road: **5**.
 *
 * ⚠️ **Seven until #351**, which asked whether seven depths is more variation
 * than a rider can perceive at speed behind a fixed camera (ADR 0008 D-5). It
 * is: what the extra two bought was two more removes past 25 m, where an item
 * is a few pixels wide. They are not what a band count costs, though — see
 * {@link SCATTER_CELL_METRES} — so dropping them was nearly free in the
 * foreground and paid for a narrower {@link SCATTER_BAND_METRES} at an
 * unchanged band width.
 *
 * ⚠️ **#353 narrowed the band and left this at five**, which is the half of
 * #351's trade that no longer holds: a band is three metres deep now rather
 * than five, and {@link MINIMUM_SCATTER_SEPARATION_METRES} followed it down.
 * Dropping a depth instead of narrowing the band would have kept the
 * separation and left the far items exactly where #353 was filed to move them
 * from, which is why the issue names this one as settled at five.
 *
 * ⚠️ **A band is a *depth*, and since #348 it is no longer also a position
 * along the road** — which is the change that actually removes the rhythm. Each
 * band owns its own lateral sub-band of the verge and takes its position along
 * the cell from a stream of its own, so a near item is as likely to be at the
 * end of a cell as at the start. Before #348 the two were the same index: band
 * 0 was always both the nearest to the road *and* the first along it, which
 * drew a receding staircase that repeated every ten metres.
 *
 * ⚠️ Must be at least two — {@link bandsAt} divides the reach by it, and the
 * lateral separation {@link MINIMUM_SCATTER_SEPARATION_METRES} rests on is the
 * width of one band.
 */
export const SCATTER_BANDS_PER_SIDE = 5;

/**
 * How far from the road's edge the nearest thing may stand: **3 m**.
 *
 * ⚠️ **THE VERGE IS ALSO A VISIBILITY CONSTANT, and that is the whole of
 * #355.** A perspective camera's cone has an apex, so what a rider can see to
 * the side grows with depth and is *nothing* at the camera. An item standing
 * `across` metres from the centreline is off the side of the screen until it is
 * `across / spread` metres ahead of the **camera** — where `spread` is
 * `camera.ts` §`horizontalSpread`, the frame's aspect ratio times the tangent
 * of half the lens — and the camera sits `CAMERA_BEHIND_METRES` behind the
 * rider. So, in one line a future change to any of those numbers has to read:
 *
 * > **an item at the verge is invisible until `(ROAD_WIDTH_METRES / 2 +
 * > SCATTER_VERGE_METRES) / spread − CAMERA_BEHIND_METRES` metres ahead of the
 * > rider.** Negative means it is already in shot beside them.
 * > `camera.ts` §`vergeEntersFrameMetres` is that sentence as a function.
 *
 * ⚠️ **Every number that used to follow this sentence was taken through a
 * camera 8 m back on a 60° lens in a 16 : 9 letterbox, and #423 and #424 moved
 * all three** — a reviewer who remembers +1.26 m at a 6 m verge, −1.67 m at
 * three and a break-even verge of 4.7 m is reading the old file. Through the
 * camera that ships, at 16 : 9: **+0.72 m** at this 3 m verge and **+3.13 m** at
 * the 6 m one #355 replaced. It is no longer negative, and `camera.ts`'s header
 * is where that is argued rather than apologised for: a rider who fills a fifth
 * of the frame and scenery in shot level with them cannot both be had on a
 * 16 : 10 tablet, by any camera.
 *
 * ⚠️ Widening the verge, narrowing the lens or moving the camera nearer the
 * rider all push it the wrong way, and **all three are gated** in
 * `three-renderer.test.ts` §"the verge and the camera cone" rather than left to
 * this paragraph — because the geometry was written down beside
 * `lateralReachMetres` for three tuning passes before anyone computed it. Each
 * floor there is held from BOTH sides: the verge that ships must clear it and
 * the 6 m verge must not, through today's camera, so a floor cannot be quietly
 * re-pinned to whatever a new constant produces.
 *
 * ⚠️ **What #355's own arithmetic overstates, measured rather than repeated.**
 * That issue says roughly fifteen items fall in the first 25 m and *"are simply
 * not in frame"*. On a 12 km level fixture at the 6 m verge, **13.7** items a
 * frame stood in the first 25 m of road and **9.3** of them were already in a
 * 16 : 9 frame; that change took it to 10.6 (and #424's camera, on its wider
 * lens, holds 10.1). So the near field was never
 * bare by geometry — a bit under a third of it was off the side of the screen,
 * and a bit under a quarter still is. ⚠️ **The frames that carry nothing in
 * shot in the near field are NOT this**: 14 in 100, identical at verges of 6,
 * 5, 4, 3, 2 and 1.5 m, because thirteen of them have nothing *placed* there
 * at all. That is {@link OPEN_GROUND_SHARE} doing what #348 asked for, and it
 * is the fifth candidate cause in this chain rather than a sixth.
 *
 * ⚠️ **1.5 m until #348, 6 m from #348 to #355, and 3 m since** — a reviewer
 * who remembers this comment quoting #351's *"keep the 6 m verge — that part
 * solved the reported problem"* is reading the old one, and #355 is explicit
 * that the claim was wrong and that #353 repeated it. One and a half metres is
 * a hedge: the first thing a rider saw beside the road was a trunk a metre and
 * a half off the tarmac, for the whole ride. Three is far enough that there is
 * open ground before the planting starts, which is what the owner asked for,
 * and near enough to be inside the cone, which is what the owner was not
 * getting.
 *
 * ⚠️ **A requirement, not a taste.** #243's fifth criterion is that nothing is
 * placed on the road, and the carriageway is `ROAD_WIDTH_METRES` wide, so the
 * nearest lateral offset any item can take is
 * `ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES`. A tree in the carriageway is
 * the defect a rider notices first, and it is the one a lateral offset drawn
 * from `[0, band)` rather than `[verge, verge + band)` would produce on about
 * one item in fifteen. **That is unaffected by the number above** — three
 * metres of verge is still three metres of open ground, and `scatter.test.ts`
 * asserts the carriageway against the constant rather than against a literal.
 *
 * ⚠️ **It moves how much is placed not at all**, the same property
 * {@link SCATTER_BAND_METRES} has and for the same reason: nothing in
 * {@link fillCell} reads it. Measured either side of this change, the supply is
 * 245.2 items a frame, the budget binds on 62 frames in 100, the nearest 60 m
 * carries 32.3 items and 6 frames in 100 are bare — identical figures. What
 * moves is where everything stands: the median item is **13.9 m** from the
 * centreline rather than 16.9 m, and the whole arrangement slides three metres
 * toward the road with its spread untouched at 6.7 m.
 */
export const SCATTER_VERGE_METRES = 3;

/**
 * How deep the band scenery is scattered into is, beyond the verge: **15 m**.
 *
 * ⚠️ **16 m before #348, 35 m in #348, 25 m in #351, and 15 m since #353** — a
 * reviewer who remembers this comment defending twenty-five is reading the old
 * one. Sixteen metres shared between four depths put everything at much the
 * same remove, so the scenery read as a wall at a fixed distance; thirty-five
 * put the *median* item 27.2 m from the centreline, which is the far field.
 * Twenty-five brought that median to 21.9 m and #353's verdict on it was
 * *"clusters on the horizon with empty ground either side of the rider"*.
 * Fifteen over five depths puts the median at **16.9 m** and the upper quartile
 * at **20.4 m**, measured over a 6 km level fixture, and leaves the band three
 * metres deep.
 *
 * ⚠️ **This is the ONLY constant #353 moves, and the reason it is the only one
 * that could be** — quoted from this file's own answer to #351, which #353
 * quotes back: nothing here biases an item's *lateral* offset, so narrowing the
 * band is the whole of the mechanism. {@link ScatterBudget} exists to keep it
 * that way.
 *
 * ⚠️ **It changes where scenery stands and NOT how much of it there is**, and
 * #353's own model of its mechanism says otherwise — *"a narrower band raises
 * supply per unit of road, which pushes the budget back into play"*. It does
 * not. {@link fillCell} offers one candidate per cell, per side, per band and
 * keeps it on a stream that reads {@link densityAt} and {@link clusterAt};
 * {@link bandsAt} returns every band on a road that is not bending; the depth
 * is spent on the lateral offset, **after** the item has been kept. Measured on
 * the #351 fixture at band depths of 25, 22, 20, 18, 16, 15, 14 and 12, the
 * supply is 245.2 items a frame and the budget binds on 62 frames in 100 at
 * every one of them. `scatter.test.ts` §"how much is placed does not depend on
 * how deep the band is — #353" is where that is asserted rather than recorded.
 * The consolation is that this change structurally **cannot** empty the world
 * the way #348 did.
 *
 * ⚠️ Widening it widens `three-renderer.ts`'s `SCATTER_BAND_REACH_METRES`,
 * which that file **derives** from this one rather than restating, so the cull
 * follows automatically. It is also why {@link bandsAt} exists: a band this
 * deep folds through the inside of a bend, and the cull is not what stops that.
 * ⚠️ Narrowing it **loosens** {@link bandsAt}: a three-metre band fits inside a
 * tighter turn than a five-metre one, so the radius below which a bend carries
 * nothing at all falls from about 24 m to about 22 m. The verge bound that
 * function takes is untouched, so the guard is exactly as absolute as it was —
 * `scatter.test.ts` sweeps both sides of the new threshold. ⚠️ **#355 loosened
 * it again and from the other term**, to about 16 m: `bandsAt` measures its
 * reach off {@link SCATTER_VERGE_METRES} twice over, so narrowing the verge
 * moves that threshold as surely as narrowing this does.
 */
export const SCATTER_BAND_METRES = 15;

/** The smallest an item is drawn. @see ScatterItem.scale */
export const SCATTER_SCALE_LOWEST = 0.7;

/** The largest an item is drawn — so a stand of trees is not a row of clones. */
export const SCATTER_SCALE_HIGHEST = 1.4;

/**
 * How much of its cell an item may be placed along: the middle **55 %**.
 *
 * ⚠️ **This is the jitter**, and the margin it leaves is what separates two
 * items in the same band in adjacent cells: `(1 − CELL_FILL) · cellSpan` =
 * 5.4 m at the nominal span. Before #348 a cell was divided into four fixed
 * sub-intervals and an item moved within the middle half of *one* of them —
 * 1.25 m of freedom inside a 10 m cell. It is now 6.6 m inside a 12 m one.
 *
 * ⚠️ **It was 0.7 until #351, and it moved because the cell did.** The two are
 * not independent: what {@link MINIMUM_SCATTER_SEPARATION_METRES} needs is the
 * *margin in metres*, and the bend compression can take 40 % of it, so the
 * margin has to stay above 5 m. A 12 m cell at 0.7 leaves 3.6 m, which is
 * 1.44 m on the tightest bend this file will plant on — under the two metres
 * the separation promises. Shrinking the cell without this is the mistake that
 * looks like it only affects density.
 */
export const CELL_FILL = 0.55;

/**
 * How much of its own band's depth an item may be placed across: the middle
 * **55 %**.
 *
 * The lateral half of {@link CELL_FILL}, and the half
 * {@link MINIMUM_SCATTER_SEPARATION_METRES} ultimately rests on, because a
 * lateral separation is the one that does **not** compress on a bend.
 */
export const BAND_FILL = 0.55;

/**
 * How far into a bend's own radius the scenery may reach: **0.6**.
 *
 * ⚠️ **This is what keeps #348's "the verge rule must still hold absolutely"
 * true at a wider band, and it repairs a defect that predates the issue.**
 * `normalAt` places an item by the road's local normal, so on the inside of a
 * bend of radius `R` an offset of `d` puts the item `R − d` from the centre of
 * the turn: the whole band folds inward, and at `d > R` it comes out the other
 * side of the road. Measured against the committed code on a circular fixture,
 * a 10 m radius put items **1.0 m** from the centreline — inside a 3.5 m
 * half-carriageway — and a 12 m radius put them 1.3 m. The band was 21 m then;
 * at 34.5 m the same fold reaches radii up to about 17 m.
 *
 * Two bounds, and {@link bandsAt} takes the smaller:
 *
 * - **The verge, measured from the centre of the turn**: `R − (ROAD_WIDTH /
 *   2 + SCATTER_VERGE_METRES)`. This says the clearance a straight road gets
 *   is the clearance a bend gets, which is the whole content of the rule.
 * - **This share of the radius**, which bounds how much the *along*
 *   separations compress: an offset of `d` shrinks them by `(R − d) / R`, so
 *   capping `d` at `0.6 R` keeps at least 40 % of the 6 m cell-boundary
 *   margin — 2.16 m — and {@link MINIMUM_SCATTER_SEPARATION_METRES} holds at
 *   any radius.
 *
 * ⚠️ **It is applied to BOTH sides of the road, and only the inside needs it.**
 * Telling the two apart needs a *signed* curvature, and `Place.curvature` is a
 * magnitude because that is all the kind weights ever wanted. Narrowing the
 * outside of a bend as well costs a shallower band where the road turns, which
 * is what a cutting looks like anyway — a cost worth paying to keep the
 * geometry that guards the carriageway down to one number.
 */
export const BEND_INNER_SHARE = 0.6;

/**
 * How long a stretch of road shares one clustering, in metres: **150**.
 *
 * ⚠️ **#348's third bullet — "let cells be empty" — and the reason it is a
 * field rather than a coin.** An independent per-cell chance of being empty is
 * salt and pepper: it thins everything evenly and leaves no stretch of open
 * road, so nothing reads as a cluster. {@link clusterAt} instead interpolates
 * between hashed values every 150 m, which is long enough that a rider passes
 * through open ground and then through trees rather than through a uniform
 * thinning of both.
 *
 * **This repository's own**, in the sense the provenance table means: it is the
 * distance over which the planting beside a road plausibly changes character,
 * and nobody has measured it.
 */
export const CLUSTER_SPAN_METRES = 150;

/**
 * How open the ground has to read before anything is placed on it: **0.15**.
 *
 * {@link clusterAt}'s field runs `[0, 1)`; everything below this is bare
 * ground. Raising it opens the road out and lowering it closes the road in.
 *
 * ⚠️ **0.25 until #351, and this pair is the multiplier that issue's own table
 * does not list.** #348 added the clustering, and a ramp from 0.25 to 0.6
 * leaves the field at **zero** over roughly a quarter of a route and at about
 * 0.57 on average — so it scaled *every* cell's density by a little over a
 * half, on top of the grid change. Measured over a 12 km fixture at 100 rider
 * positions, 15 frames in 100 had **nothing at all** in the nearest 60 m of
 * road, which is the literal *"empty plain"* #351 was filed about. The ramp
 * from 0.15 to {@link PLANTED_GROUND_SHARE} leaves 6 frames in 100 bare, which
 * is open ground a rider rides through rather than a world that failed to
 * arrive.
 */
export const OPEN_GROUND_SHARE = 0.15;

/**
 * How closed the ground has to read before it is as planted as the geography
 * allows: **0.45**.
 *
 * ⚠️ **0.6 until #351.** @see OPEN_GROUND_SHARE for the measurement. Bringing
 * the top of the ramp down is what makes a planted stretch actually planted:
 * with a 12 m cell a fully planted valley floor now carries 0.75 items per
 * metre of road, which is *more* than the 0.72 a stretch carried before #348 —
 * so the woods are woods, and the open ground is open, instead of everything
 * being uniformly thin.
 *
 * ⚠️ **The ramp saturates, and it has to.** A field that only reached full
 * density at its own maximum would put almost every stretch somewhere in the
 * middle, which is a route that is uniformly *thinner* rather than one that is
 * sometimes open and sometimes wooded — the same "salt and pepper" failure
 * {@link CLUSTER_SPAN_METRES} describes, arrived at from the other end. With a
 * ceiling, a good share of a route is planted to exactly what
 * {@link densityAt} says, which is also what keeps
 * {@link SCATTER_MAX_ITEMS} — and with it #245's quality ladder — something
 * that still binds somewhere rather than a cap nothing ever reaches.
 */
export const PLANTED_GROUND_SHARE = 0.45;

/**
 * The closest two items are ever placed: **1.3 m**.
 *
 * Not a check performed at runtime — a **property of the cell layout**, stated
 * here so `scatter.test.ts` can assert it, and derived rather than guessed.
 * ⚠️ Since #348 the derivation is different in both halves, because a band is
 * no longer also a position along the road — a reviewer who remembers this
 * comment talking about slots is reading the old one.
 *
 * ⚠️ **2 m until #353, and it moved because it is a measurement rather than a
 * setting** — a reviewer who remembers two metres is reading the old file.
 * #351 narrowed the band and dropped two of its depths *together*, which left
 * a band five metres deep and this figure untouched; #353 narrows the band
 * alone, so the band is three metres deep and the lateral separation below
 * follows it to 1.35 m. Nothing in the placer reads this constant — it carries
 * `@unwired` for that reason — so re-deriving it changes where nothing stands.
 * ⚠️ **What it costs is real and is stated rather than glossed**: two items in
 * adjacent bands at the same point along the road can now stand 1.35 m apart
 * where they stood 2.25 m apart, and the widest kind is a little over three
 * metres across, so a pair of them can overlap. That is a copse rather than a
 * duplicate, and #243's fourth criterion is about the same item being placed
 * twice at the loop seam, which is unaffected. Measured over a 12 km fixture,
 * the closest pair anywhere is **1.49 m**; the worst case is rare because the
 * two items' positions *along* the road are drawn independently over 6.6 m.
 *
 * - Two items **in one cell on one side** are in different bands, so they are
 *   at least `(1 − BAND_FILL) · bandWidthMetres()` = 1.35 m apart **laterally**.
 *   Their positions along the road are drawn independently and may coincide,
 *   which is exactly the point: the lateral separation is the one that holds.
 * - Two items **in adjacent cells in the same band** are at least
 *   `(1 − CELL_FILL) · cellSpan` = 5.4 m apart **along** at the nominal span.
 * - The **two sides** of the road are `ROAD_WIDTH_METRES + 2 ·
 *   SCATTER_VERGE_METRES` = 13 m apart. ⚠️ **19 m until #355**, which narrowed
 *   the verge; it is still an order of magnitude clear of the bound above, so
 *   the separation is decided by the two cases before it exactly as it was.
 *
 * ⚠️ **The along-separations compress on the inside of a bend**, by `(R − d) /
 * R`, and that is what {@link BEND_INNER_SHARE} bounds: the offset can never
 * exceed 0.6 of the radius, so 5.4 m of cell-boundary margin never falls below
 * 2.16 m however tight the road turns. **The lateral separations do not
 * compress at all** — {@link bandsAt} answers a tight bend by dropping whole
 * bands rather than by squeezing them, so a band is three metres deep at every
 * radius. Squeezing them is the version of this that looks equivalent and is
 * not: it would put two items eight centimetres apart on a 20 m bend.
 *
 * @unwired a bound, not a setting: `scatter.test.ts` measures the placement
 * against it and no scenery decision reads it. Wiring it into the placer would
 * make the test assert the code against itself.
 */
export const MINIMUM_SCATTER_SEPARATION_METRES = 1.3;

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
 * The tightest radius {@link curvatureAt} will name rather than measure: **12 m**.
 *
 * ⚠️ **This is what makes {@link bandsAt}'s guard absolute rather than
 * absolute-above-a-radius**, and it closes a hole the first version of #348
 * left. `curvatureAt` reads a turn as an angle between two chord directions and
 * wraps it into `(-π, π]`, which it must — a bend either side of due north is
 * not a U-turn. But the angle a {@link CURVATURE_WINDOW_METRES} chord subtends
 * on a circle of radius `R` is `30 / R`, and that passes π at
 * `R = 30 / π ≈ 9.55 m`. Below that the wrap reports a *small* curvature for a
 * road that folds hard, `bandsAt` reads it as open and places every band, and
 * scenery lands well inside the verge: measured on circular fixtures, radii of
 * 4.75 m to 5.5 m stood things **4.7 m** from the centreline against a promised
 * 9.5 m — 6.5 m since #355, which the measurement is still inside. #243's hard
 * rule — nothing in the 3.5 m carriageway — still held, and #348's verge rule
 * did not.
 *
 * Two directions cannot tell a turn of `θ` from one of `θ + 2π`, so the repair
 * is not a better angle; it is a **second reading that does not wrap**. The
 * straight-line distance between the two ends of the window is `2R·sin(θ)`
 * against a straight road's `2 · CURVATURE_WINDOW_METRES`, so their ratio is
 * `|sin θ| / θ` — and that is below {@link AMBIGUOUS_CHORD_SHARE} for **every**
 * `θ > π`, with no ambiguity of its own: `|sin θ| / θ` is monotone decreasing
 * on `(0, π]` and its largest value anywhere above π is 0.217, at `θ ≈ 4.49`.
 * So a road the wrap could misreport is always caught here.
 *
 * ⚠️ **What it reports is a bound, not a measurement**, and it is honest about
 * the direction: below the threshold the only true statement is *"at least this
 * tight"*. 12 m is far inside the ~24 m radius {@link bandsAt} already refuses,
 * so a road caught here was going to be refused anyway and this only stops it
 * being refused for the wrong reason.
 */
export const AMBIGUOUS_TURN_RADIUS_METRES = 12;

/**
 * The share of a straight road's window span a chord may close to before the
 * reading is ambiguous.
 *
 * ⚠️ **Derived from {@link AMBIGUOUS_TURN_RADIUS_METRES}, not written down**,
 * so the two cannot come to disagree about which radius the threshold names.
 */
export const AMBIGUOUS_CHORD_SHARE =
  Math.abs(Math.sin(CURVATURE_WINDOW_METRES / AMBIGUOUS_TURN_RADIUS_METRES)) /
  (CURVATURE_WINDOW_METRES / AMBIGUOUS_TURN_RADIUS_METRES);

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
 *
 * ⚠️ **It is a bias along the ROAD, not across the verge**, and #351 reads it
 * as the second. *"Narrow the band, or bias placement toward its near edge —
 * `SCATTER_NEAR_BIAS` already exists for this"*: it does not. Nothing here
 * biases an item's **lateral** offset, which is uniform across the band it is
 * drawn in, and a constant that did would change *where* things are placed —
 * which {@link ScatterBudget} exists to say this one cannot. So #351's third
 * bullet is discharged by its first alternative, a narrower
 * {@link SCATTER_BAND_METRES}.
 *
 * ⚠️ **And it is inert whenever the supply is under the budget**, which is the
 * quiet half of what #348 did. {@link thin} returns everything it was given
 * when `found.length <= maxItems`, so a world that supplies 161.9 items a frame
 * into a budget of 240 — measured, over a 12 km fixture, with #348's constants
 * — never sorts, never ranks and never concentrates anything near the rider.
 * It oversubscribed on 11 frames in 100 and now does on 62. Density and this
 * bias are therefore not independent knobs: below the budget there is no bias
 * at all, and `scatter.test.ts` §"#351" counts how often the budget binds
 * rather than whether it ever does.
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
const STREAM_CLUSTER = 7;
/**
 * #367's variant. ⚠️ **Appended, and that is what keeps the arrangement
 * unmoved**: {@link uniform} derives each stream from the slot's base hash and
 * the stream index alone, so a new stream reads a part of the hash none of the
 * seven above it reads and changes none of their answers.
 * `arrangement-unchanged.test.ts`' digest is the evidence rather than this
 * sentence.
 */
const STREAM_VARIANT = 8;

/**
 * The cell index {@link clusterAt} hashes its nodes under.
 *
 * ⚠️ It is a **band** index in {@link hash}'s third argument, and the band
 * indices a cell uses run `−SCATTER_BANDS_PER_SIDE` to `SCATTER_BANDS_PER_SIDE
 * − 1`. Anything outside that range will do; this one is far enough outside it
 * that widening the band count can never reach it, because a collision would
 * correlate a stretch's openness with one item's own draws inside it.
 */
const CLUSTER_KEY = 0x1_0000;

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
    fillCell(
      profile,
      origin,
      seed,
      { cell, wrapped, cellCount, span, fromMetres, toMetres },
      found,
    );
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
  /** How many cells the whole route has. @see clusterAt */
  readonly cellCount: number;
  readonly span: number;
  readonly fromMetres: number;
  readonly toMetres: number;
}

/** Every band of one cell that falls inside the span, appended to `found`. */
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
  const place = placeAt(profile, origin, centreOfCell);
  // ⚠️ **Two independent reasons a cell can be empty, and they multiply.** The
  // geography says how much grows here; the clustering says whether this
  // stretch of road is planted at all. Before #348 there was only the first,
  // and a route at one altitude on one gradient had the same density from end
  // to end — every cell filled to the same fraction, which is what makes a
  // hashed placement still read as a grid.
  const density = densityAt(place) * clusterAt(seed, cell);
  const weights = kindWeights(place);
  // ⚠️ **Whole bands, dropped rather than squeezed.** @see MINIMUM_SCATTER_SEPARATION_METRES
  const bands = bandsAt(place.curvature);

  for (const side of [-1, 1]) {
    for (let band = 0; band < bands; band += 1) {
      // ⚠️ Hashed on the WRAPPED cell, so the same place on lap two is the same
      // place. Hashing the unwrapped cell would reseed the whole world every lap.
      const base = hash(seed, cell.wrapped, side * SCATTER_BANDS_PER_SIDE + band);
      if (uniform(base, STREAM_KEEP) >= density) {
        continue;
      }

      // ⚠️ **Two draws from two streams, and nothing ties them together** —
      // which is the whole of #348's "jitter within the cell". The position
      // along the road is anywhere in the middle {@link CELL_FILL} of the cell;
      // the depth into the verge is the band's own, filled to
      // {@link BAND_FILL}. @see MINIMUM_SCATTER_SEPARATION_METRES
      const alongInCell = inCell(uniform(base, STREAM_ALONG)) * cell.span;
      const lateral =
        ROAD_WIDTH_METRES / 2 +
        SCATTER_VERGE_METRES +
        (band + inBand(uniform(base, STREAM_LATERAL))) * bandWidthMetres();

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
          // ⚠️ `Math.min` rather than trusting the multiply: `uniform` returns
          // a value in `[0, 1)` by construction, but a float at the very top of
          // that range can floor to the slot count on some inputs, and an
          // out-of-range variant is an item drawn as the wrong kind's shape.
          variant: Math.min(
            SCATTER_VARIANT_SLOTS - 1,
            Math.floor(uniform(base, STREAM_VARIANT) * SCATTER_VARIANT_SLOTS),
          ),
        },
        rank: uniform(base, STREAM_RANK),
        along,
      });
    }
  }
}

/**
 * Where along its cell a uniform number `unit` puts something, as a fraction.
 *
 * ⚠️ **The middle {@link CELL_FILL} of the cell, not the whole of it.** A cell
 * that filled its whole interval would *touch* the next one: the top of cell
 * `k` is the bottom of cell `k + 1`, so two items in the same band could be
 * placed a millimetre apart and the separation guarantee would be worth
 * nothing. Leaving a margin at each end turns "different cells" into "separated
 * by at least the margin".
 */
function inCell(unit: number): number {
  return (1 - CELL_FILL) / 2 + unit * CELL_FILL;
}

/** Where across its own band a uniform number puts something, as a fraction. */
function inBand(unit: number): number {
  return (1 - BAND_FILL) / 2 + unit * BAND_FILL;
}

/**
 * How deep one band is, in metres.
 *
 * ⚠️ **A constant of the band, never of the reach.** {@link bandsAt} answers a
 * bend by returning fewer bands, so this stays three metres at every radius —
 * and the lateral separation {@link MINIMUM_SCATTER_SEPARATION_METRES} rests on
 * stays what it says. Deriving it from the reach instead is the version that
 * looks equivalent and silently puts two items eight centimetres apart on a
 * 20 m bend.
 */
function bandWidthMetres(): number {
  return SCATTER_BAND_METRES / SCATTER_BANDS_PER_SIDE;
}

/**
 * How many bands a place with this curvature may carry, nearest first.
 *
 * @see BEND_INNER_SHARE for the two bounds and why they are both needed, and
 * for the measurement of what the committed code did on a 10 m bend before
 * this function existed.
 *
 * ⚠️ A bend too tight to hold even the first band gets **nothing** — the
 * honest answer, rather than something inside the carriageway. At the values
 * here that is a radius under about 24 m, which is a switchback or a
 * roundabout; `CURVATURE_WINDOW_METRES` smooths anything shorter than 60 m of
 * arc, so a single tight corner on an otherwise open road keeps its scenery.
 *
 * ⚠️ **That smoothing is also where this guard could stop being absolute, and
 * it is the reason {@link AMBIGUOUS_TURN_RADIUS_METRES} exists.** This function
 * is only ever as good as the curvature it is handed, and a window measured as
 * an angle cannot read a road that turns through more than half a circle inside
 * it. Below about 9.55 m of radius the reading used to come back *small*, the
 * straight-road branch was taken, and all seven bands were placed on a road
 * folding hard — measured, 4.7 m from the centreline where 9.5 m was promised
 * and 6.5 m is promised since #355. `curvatureAt` now reports a bound rather
 * than a wrapped angle there, so the refusal holds at every radius;
 * `scatter.test.ts` sweeps 1 m to 25 m in quarter-metre steps rather than
 * sampling four round radii, because the failure fell on particular radii and
 * not on a band of them.
 *
 * ⚠️ Written as `!(curvature > 0)` rather than `curvature <= 0` so a `NaN`
 * takes the straight-road branch instead of falling through it into a `NaN`
 * band count, which would make the loop below run zero times on a route that
 * merely has a hole in its positions. ⚠️ **{@link curvatureAt} no longer hands
 * one over** — the chord reading catches a hole before the angle is taken — so
 * this is now a guard against a second caller rather than against the only one.
 */
function bandsAt(curvature: number): number {
  if (!(curvature > 0)) {
    return SCATTER_BANDS_PER_SIDE;
  }
  const radius = 1 / curvature;
  const verge = ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES;
  const reach = Math.min(radius - verge, radius * BEND_INNER_SHARE);
  return Math.max(
    0,
    Math.min(SCATTER_BANDS_PER_SIDE, Math.floor((reach - verge) / bandWidthMetres())),
  );
}

/**
 * How planted this stretch of road is, from 0 (bare) to 1 (as the geography
 * allows).
 *
 * ⚠️ **A smooth field along the route, not a per-cell coin** — see
 * {@link CLUSTER_SPAN_METRES} for why that distinction is the whole of the
 * effect. Values are hashed at nodes about {@link CLUSTER_SPAN_METRES} apart
 * and interpolated between them, then the bottom {@link OPEN_GROUND_SHARE} of
 * the range is flattened to nothing so that some stretches are genuinely empty
 * rather than merely thinner.
 *
 * ⚠️ **Nodes are counted in cells and wrapped on the node count, which is what
 * keeps the loop seam invisible.** The route is divided into a whole number of
 * nodes exactly as {@link cellSpanMetres} divides it into a whole number of
 * cells, and the node after the last is the first — so a rider crossing the
 * start of a loop rides out of the same planting they rode into. Interpolating
 * against an unwrapped node index would put a visible step at the seam, on a
 * route where every other property is continuous across it.
 */
function clusterAt(seed: number, cell: Cell): number {
  // ⚠️ **At least two**, and one is what a first draft had. A single node makes
  // the field constant — `(0 + 1) % 1` is `0`, so it interpolates a value
  // against itself — and a route shorter than two cluster spans then comes out
  // uniformly planted or **uniformly bare**, one seed in three. A route is
  // divided into a whole number of nodes for the reason {@link cellSpanMetres}
  // divides it into a whole number of cells: so the last node's neighbour is
  // the first, and the seam has no step in it.
  const nodes = Math.max(2, Math.round((cell.cellCount * cell.span) / CLUSTER_SPAN_METRES));
  const at = (cell.wrapped / cell.cellCount) * nodes;
  const node = Math.floor(at);
  const from = nodeOpenness(seed, node % nodes);
  const to = nodeOpenness(seed, (node + 1) % nodes);
  const ramp = at - node;
  // Smoothstep, so the field has no corner at a node — a linear ramp between
  // hashed values reads as a run of straight lines, which is its own rhythm.
  const openness = from + (to - from) * ramp * ramp * (3 - 2 * ramp);
  return clamp01((openness - OPEN_GROUND_SHARE) / (PLANTED_GROUND_SHARE - OPEN_GROUND_SHARE));
}

/** How open one node of the clustering field is, in `[0, 1)`. */
function nodeOpenness(seed: number, node: number): number {
  return uniform(hash(seed, node, CLUSTER_KEY), STREAM_CLUSTER);
}

/**
 * What the route says about one point on it.
 *
 * Read once per cell rather than once per item: the geography of one cell is one
 * answer, and asking for it ten times would make the cost of a frame ten times
 * what it needs to be for no change in the result.
 */
function placeAt(profile: RouteProfile, origin: CorridorOrigin, at: number): Place {
  const latitude = Math.abs(positionAt(profile, at).latitude);
  return {
    altitude: elevationAt(profile, at),
    treeLine: treeLineMetres(latitude),
    latitude,
    steepness: Math.abs(gradeAt(profile, at)),
    curvature: curvatureAt(profile, origin, at),
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
 *
 * ⚠️ **In local metres, and until #348 it was in degrees** — a reviewer who
 * remembers `atan2` over a latitude and a longitude here is reading the old
 * file. A degree of longitude is `cos(latitude)` of a degree of latitude, so a
 * bearing taken in degree space is sheared: at 45° the same circular bend read
 * as a radius anywhere between 13 m and 26 m depending on which way it happened
 * to be pointing. That was a curiosity while the only consumer was a weight for
 * signposts, and it is not one now — {@link bandsAt} decides how far scenery
 * may stand from a bending road from this number, and a bend that reads as
 * half again its radius puts scenery correspondingly too far in.
 */
function curvatureAt(profile: RouteProfile, origin: CorridorOrigin, at: number): number {
  const sample = (metres: number): { readonly x: number; readonly z: number } =>
    localGroundPosition(origin, positionAt(profile, distanceOnRoute(profile, metres)));
  const before = sample(at - CURVATURE_WINDOW_METRES);
  const here = sample(at);
  const after = sample(at + CURVATURE_WINDOW_METRES);

  // ⚠️ **Read before the angle is, because below a radius of about 9.55 m the
  // angle cannot be read at all.** @see AMBIGUOUS_TURN_RADIUS_METRES for why
  // the wrap below has to lie there, why a chord cannot, and why the answer is
  // a bound rather than a number.
  //
  // ⚠️ Written as `!(spanned > …)` rather than `spanned <= …` for the reason
  // `normalAt` gives below, and **that half is a form rather than a guarantee**:
  // rewriting it the other way round leaves every test in this repository green,
  // measured rather than assumed. A `RouteProfile`'s positions are validated
  // before it exists, so nothing here can reach a `NaN` chord to assert on — do
  // not read the negated form as evidence one is handled.
  const spanned = Math.hypot(after.x - before.x, after.z - before.z);
  if (!(spanned > AMBIGUOUS_CHORD_SHARE * 2 * CURVATURE_WINDOW_METRES)) {
    return 1 / AMBIGUOUS_TURN_RADIUS_METRES;
  }

  const incoming = Math.atan2(after.z - here.z, after.x - here.x);
  const outgoing = Math.atan2(here.z - before.z, here.x - before.x);
  let turn = incoming - outgoing;
  // Into (-π, π], so a bend either side of due north is not read as a U-turn.
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn <= -Math.PI) turn += Math.PI * 2;
  // ⚠️ **Over `CURVATURE_WINDOW_METRES`, not twice it, and it was twice it
  // until #348** — a reviewer who remembers the doubled baseline is reading the
  // old file. Each chord's direction is the tangent at its own **midpoint**, so
  // the two midpoints are one window apart along the road and not two: dividing
  // by the whole baseline reported exactly **half** the true curvature, and a
  // circular fixture of 40 m radius read as 79.7 m. That was invisible while
  // the only consumer was {@link TIGHT_BEND_RADIANS_PER_METRE} — signposts
  // merely appeared on bends twice as open as that constant's own comment
  // claims — and it stopped being invisible when {@link bandsAt} started
  // deciding how far scenery may stand from a bending road.
  return Math.abs(turn) / CURVATURE_WINDOW_METRES;
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
  // takes this branch too instead of falling through it. **It catches a `NaN`
  // input and not a degenerate fallback**, and that distinction is not academic:
  // the backward difference has a length of its own, and on a loop shorter than
  // two grid steps it is zero as well, so `0 / 0` leaves with the item. Circuits
  // of 1.25 m to 2.25 m radius did exactly that — twelve `NaN` coordinates at
  // 2 m — and a `NaN` in a vertex buffer draws a black screen rather than a
  // visible fault, the argument `scene.ts` §`cameraPose` makes about a
  // degenerate look-at. What closes it is upstream and absolute rather than a
  // third difference here: a loop that short reads as tighter than
  // {@link AMBIGUOUS_TURN_RADIUS_METRES}, so {@link bandsAt} places nothing on
  // it and this function is never reached. `scatter.test.ts` §"never emits a
  // coordinate that is not a number" sweeps every radius up to 40 m for it.
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
