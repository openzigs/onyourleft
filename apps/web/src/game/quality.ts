// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the renderer gives up, and when — #91's thermal criterion as a pure
 * function.
 *
 * > *"Under thermal pressure the renderer reduces internal resolution and/or
 * > frame cap rather than stuttering, and a test asserts the reduction path is
 * > exercised."*
 *
 * ## Why this is a decision table and not a branch inside the render loop
 *
 * The reduction path is the code that runs **only on a hot phone**, which is
 * exactly the code least likely to be exercised by anybody developing on a
 * desktop. Written inline in the render loop it would be unreachable in every
 * test the repository can run (jsdom has no GL, and the browser gate's runner
 * has no thermal API at all), and its first execution would be on a rider's
 * phone at minute fifty of a ride. Written here it is a pure function from two
 * numbers to a quality level, and every rung of the ladder gets a test.
 *
 * ## Two inputs, because either alone lies
 *
 * **`thermalHeadroom`** is Android's own forecast — `PowerManager.
 * getThermalHeadroom()`, API 30+, 0.0 to 1.0, where 1.0 means throttling is
 * imminent. It is the leading indicator, and it is the one Google's guidance
 * says to act on. ⚠️ It is **absent** on the web platform, absent below API 30,
 * and can return `NaN` on devices whose vendor never implemented it — so it is
 * optional here and its absence is not treated as "cool".
 *
 * **`recentFrameMs`** is what actually happened. It is the lagging indicator and
 * it cannot be missing, because we measure it ourselves. A phone whose thermal
 * API says nothing but whose frames have gone to 60 ms is throttling regardless
 * of what any API declines to tell us.
 *
 * Google's guidance also warns that once a device has overheated the workload
 * must drop **below** the sustainable level to recover, not merely back to it —
 * which is why {@link nextQuality} has hysteresis and why the recovery threshold
 * is not the reduction threshold.
 */

import { TERRAIN_BANDS } from './landform';
import { SCATTER_MAX_ITEMS } from './scatter';
import { STRUCTURE_MAX_ITEMS } from './settlements';
import { MAXIMUM_SCENERY_VARIANTS } from './scenery-models';

/** How hard the renderer is working. Lower is cooler. */
export type QualityLevel = 0 | 1 | 2 | 3 | 4;

/** What one quality level means to the renderer. */
export interface QualitySettings {
  /**
   * Multiplier on the drawing-buffer size, applied to `devicePixelRatio`.
   *
   * Resolution first, frame rate second — #91 quotes Google naming *"framebuffer
   * resolution and frame rate"* as the two parameters to reduce, and of the two
   * a rider notices resolution far less: the HUD is vector text drawn at full
   * resolution over the top, and the world behind it is a stylised corridor with
   * no fine detail to lose.
   */
  readonly renderScale: number;
  /**
   * The frame cap, in frames per second — {@link DISPLAY_RATE} for "as fast
   * as the display refreshes, and never faster".
   *
   * ⚠️ **Read by `GameView`'s loop since #476, through `frame-pacer.ts`.** It
   * was declared on every rung and read by nothing: every rung drew at the
   * display's rate, and the two rungs whose frame cap is their deepest cut
   * (24, 20) cut nothing it describes. `GameView.test.tsx` §"#476" counts the
   * frames each rung draws.
   */
  readonly frameCap: number;
  /**
   * How many pieces of scenery a frame may carry — #245.
   *
   * ⚠️ **The fourth thing a rung can give up, and the only one whose cost
   * scales with the figure written here.** {@link renderScale} and
   * {@link frameCap} each change one fixed property of a frame, and
   * {@link shading} swaps one material for another. This number *is*
   * `scatter.ts`'s `ScatterBudget.maxItems`, which is also the instances the
   * belt submits, the fragments they shade and the overdraw beside the road —
   * #240's NFR-2 names exactly those three as the budget.
   *
   * ## Where scenery sits on the ladder, argued rather than inherited
   *
   * {@link renderScale}'s own note puts resolution first because *"the world
   * behind [the HUD] is a stylised corridor with no fine detail to lose"*.
   * #243 and #244 gave it fine detail to lose, so that reason cannot simply be
   * carried over; #245 asks for it to be re-made.
   *
   * It is re-made and it lands in the same place, on a ground the older note
   * could not have stood on: **the first slice of this budget is the only
   * reduction on the ladder that is invisible where it is taken.** `scatter.ts`
   * thins towards the rider — `SCATTER_NEAR_BIAS` — so the items that go first
   * are the furthest away, and `world.ts` has already fogged the far end of the
   * view to `FOG_OCCLUSION_AT_VIEW_END` of the horizon colour by the time the
   * rider can see it. A resolution step is visible across the whole screen at
   * once and a frame-rate step is visible in everything that moves; the first
   * third of the scenery is visible in a band the fog has mostly taken.
   *
   * So the scenery goes **with** the first resolution step rather than before
   * it or after it:
   *
   * - **Not before**, as a rung of its own. The slice that is nearly free to
   *   lose is also the slice that buys the least back, so a rung spent on it
   *   alone would be a rung spent for almost nothing — and every rung costs a
   *   visible change, which is the whole of {@link HEADROOM_RESTORE_BELOW}'s
   *   argument for the hysteresis. Fewer rungs that each do something beat
   *   more rungs that each do little.
   * - **Not after the frame rate.** #245's FR-4 fixes that outer bound
   *   directly — scenery is reduced before frame rate is — and since #482 the
   *   first step down gives up NO frame rate at all: it sheds this budget at
   *   the display's rate, and the first rung that caps below the display's
   *   rate is the **second step down**, which gives up only the frame rate.
   *   "Frame rate given up" means exactly that — a `frameCap` below
   *   {@link DISPLAY_RATE} — and not, as between #476 and #482, "below
   *   {@link TARGET_FRAMES_PER_SECOND}". {@link QUALITY_LADDER} §"The owner's
   *   rulings".
   *
   * ## Why the floor rung is sixty and not zero
   *
   * A corridor with nothing standing beside it leaves a rider no way to read
   * their own speed: what passes the verge is the only motion cue in a world
   * whose road is a repeating surface and whose horizon does not move. That is
   * why #243 exists at all, and a floor rung that took all of it away would
   * ship the world #243 replaced to precisely the riders least able to tell a
   * hot phone from a broken one.
   *
   * ## ⚠️ Provenance — BR-1, and none of these numbers is a measurement
   *
   * 240 → 160 → 160 → 100 → 60 — level 2 is level 1 capped at 30 (#482), so
   * the figure repeats there. Each step that cuts it keeps about two-thirds of
   * the one above and the floor keeps a quarter of the top, which is the shape
   * {@link renderScale} already takes in *pixels*: 1, 0.83, 0.67 and 0.5 square to 1, 0.69, 0.45
   * and 0.25. That shape is **chosen, not measured.** ADR 0008 D-2's rendering
   * gate was waived rather than passed and
   * [#247](https://github.com/openzigs/onyourleft/issues/247) is the 60-minute
   * run on the device floor that would settle it, so every figure here is a
   * **starting position for that measurement to revise** rather than a result
   * it has already produced. `SCATTER_MAX_ITEMS` has carried the same warning
   * for the top rung since #243, and the top rung is that constant rather than
   * a copy of it.
   */
  readonly scatterItems: number;
  /**
   * How many distinct shapes one scenery kind may be drawn as — #367.
   *
   * ⚠️ **The fifth thing a rung can give up, and the only one whose cost is
   * paid in draw calls rather than in fragments.** {@link scatterItems} decides
   * how many instances are submitted; this decides how many *meshes* they are
   * spread over, and a mesh is a draw call — #240's NFR-2, which names draw
   * calls first. Twelve meshes at the top rung against the six #244 spent, and
   * six again at the floor.
   *
   * ## Why it is here and not simply fixed at the maximum
   *
   * #367 asks the question directly: *"`quality.ts` already has a
   * `scatterItems` rung — variants may belong on it, so a throttling phone
   * falls back toward fewer distinct meshes before it loses items."* It does,
   * and the ordering argument is the one {@link scatterItems} already makes
   * from the other end.
   *
   * **Losing a variant is cheaper to look at than losing an item.** An item
   * that goes is a gap in the verge, and {@link scatterItems}' own note is that
   * what passes the verge is the rider's only speed cue. A variant that goes is
   * a second tree that looks like the first tree — which is exactly the world
   * this repository shipped between #341 and #367, and nobody could tell it was
   * a *reduction* rather than a style. So the first variant step is taken on
   * the same rung as the first scenery step, and the floor rung is back to one
   * shape a kind.
   *
   * ⚠️ **It reduces to one, never to zero.** A kind with no shape at all is a
   * kind that is not drawn, and this number is an index bound rather than a
   * count of things to draw: `three-renderer.ts` §`ScatterBelt.setVariants`
   * takes an item's variant modulo it, so zero would be a division by zero and
   * a world with nothing standing beside the road. `quality.test.ts` asserts
   * the floor.
   *
   * ## ⚠️ Provenance — BR-1, and this number is not a measurement either
   *
   * 3 → 2 → 2 → 1 → 1 (level 2 repeats level 1, #482), on the same footing
   * as every other figure on this ladder: ADR 0008 D-2's rendering gate was waived rather than passed and
   * [#247](https://github.com/openzigs/onyourleft/issues/247) is the run that
   * would settle it. What *is* measured is the draw-call arithmetic itself —
   * `game.browser.spec.ts` counts the meshes a frame actually submits at each
   * of these three counts and prints the figure, which is the half that can be
   * checked without a phone.
   */
  readonly sceneryVariants: number;
  /**
   * Whether the world is shaded by a light direction, or flat — #286.
   *
   * ⚠️ **The third thing a rung can give up, and the first that is not a
   * number.** #286 gives the scene one directional light and one ambient, and
   * puts `MeshLambertMaterial` on everything with a form to show — which buys
   * a lit side and a shaded side and costs a shading pass per lit fragment.
   * ADR 0008 D-2's rendering gate was **waived rather than passed** and
   * [#247](https://github.com/openzigs/onyourleft/issues/247)'s run on the
   * device floor is outstanding, so nobody knows what that pass costs on a
   * mid-range phone in a handlebar mount.
   *
   * So the floor rung can lose it. `'flat'` puts back exactly the unlit
   * `MeshBasicMaterial` the renderer used before #286 — the same colours,
   * the same draw calls, no shading pass — and `three-renderer.ts` holds both
   * materials from construction so the swap allocates nothing.
   *
   * ⚠️ **A rung, not a build-time flag, and the reason is the measurement
   * problem.** A build-time choice would have to be made by somebody who knows
   * which device the build will run on, and nobody does: the same bundle is
   * served to a desktop browser and wrapped by `apps/mobile`. A rung is
   * decided by the device itself, from the two signals {@link nextQuality}
   * already reads, and it is the answer #286 records for
   * [#245](https://github.com/openzigs/onyourleft/issues/245)'s question.
   */
  readonly shading: 'lit' | 'flat';
  /**
   * How the riders are grounded on the road — #426.
   *
   * - `'contact'` — one soft ellipse under each rider and the pacer, placed from
   *   `world.ts`'s own sun (`contact-shadow.ts`). One transparent draw for all
   *   of them. **Every rung of {@link QUALITY_LADDER}**, the floor included: a
   *   quad a few hundred pixels across is not what a throttling phone is
   *   short of, and a rider floating over the road is the defect #426 is.
   * - `'map'` — a real shadow map, cast by the riders only, received by a
   *   shadow-catching plane under them. **On no rung of the ladder**: it is
   *   {@link RIDER_SHADOW_MAP_RUNG}, above the top, which a rider has to ask
   *   for and the ladder takes away first. #426 says ship it only as a rung,
   *   off by default on the device floor, until it is measured there.
   * - `'none'` — nothing. On no rung either; it is what the browser gate
   *   renders to prove the contact shadow is what darkened the road, and what
   *   a probe that measures the RIDER uses so the shadow is not counted as
   *   part of them.
   */
  readonly riderShadows: 'contact' | 'map' | 'none';
  /**
   * How many bands of ground either side of the road are drawn, innermost
   * first — #458. `landform.ts` §`TERRAIN_BANDS` is the most there are.
   *
   * ⚠️ **The ground is the largest fill in the frame since #458**, which is why
   * it is on the ladder at all: the flat quad it replaced was two triangles,
   * and a landform out to 420 m either side of 460 m of road is about two
   * thousand, lit, most of them far away. What goes first is the OUTSIDE —
   * the bands beyond 300 m, and then beyond 200 m and 135 m — which is the
   * ground `world.ts` has already faded most of the way into the horizon
   * colour, and which the horizon ring's own foot, in that same colour, stands
   * in for once it is gone. So it goes with the first resolution step, on
   * {@link scatterItems}' argument: the slice that costs least to look at is
   * the slice taken first.
   *
   * ⚠️ **It never moves a vertex.** The rung shortens a draw range over the
   * same mesh (`three-renderer.ts` §`TerrainBelt.setBands`), so a tree standing
   * on the ground stands on the same ground at every rung, and the ground at
   * the road's edge — the no-crack guarantee — is in every rung's first band.
   *
   * ## ⚠️ Provenance — BR-1, and this is not a measurement either
   *
   * 12 → 10 → 10 → 9 → 8 (level 2 repeats level 1, #482), on the same footing
   * as every figure on this ladder. What the browser gate measures is the vertex and index counts and the draw
   * range, and `docs/validation/0002-android-shell-and-game.md` Part V is the
   * frame time on a phone.
   */
  readonly terrainBands: number;
  /**
   * How water is drawn — #459.
   *
   * - `'shaded'` — the water shader: the sky reflected with a Fresnel term,
   *   ripples scrolling in the fragment, the edges tinted by depth. No second
   *   render of the scene, which is what a planar reflection would be.
   * - `'flat'` — one colour, unlit, the cheapest thing that still reads as
   *   water beside a road.
   *
   * ⚠️ **Shaded on the target rung only.** Every fragment of water runs the
   *   shader, and it is detail rather than information — nothing about where
   *   the water is changes — so it goes on the first step down, with the
   *   scenery and the far ground, before any rung gives up frame rate. The
   *   browser gate publishes what the shader costs on the valley frame.
   *
   * ## ⚠️ Provenance — BR-1, and this is not a measurement either
   *
   * The rung is chosen, not measured; validation 0002 Part W is the phone.
   */
  readonly water: 'shaded' | 'flat';
  /**
   * How many structures a frame may carry — buildings, signposts and field
   * boundaries, #460.
   *
   * ⚠️ **Its own budget rather than a share of {@link scatterItems}**, because
   * the two are thinned differently: the scenery by a distance-biased rank
   * (`scatter.ts` §`thin`), the structures by keeping every building and then
   * the field boundaries nearest the rider (`settlements.ts` §`structuresAt`).
   * A shared budget would let a forest cost a village its houses.
   *
   * It goes on the same rungs as the scenery, for the same reason: what is
   * taken first is the far end of the view, which the fog has mostly taken
   * already.
   *
   * ## ⚠️ Provenance — BR-1, and not a measurement
   *
   * 240 → 120 → 120 → 60 → 40 (level 2 repeats level 1, #482): halved at
   * each of the first two steps that cut it, faster than the scenery's own
   * two-thirds, because what a structure budget takes first
   * is a field's far boundary and a wall 40 m from the road reads as the same
   * field without it. The houses are never what goes: they lead the list.
   * Validation 0002 Part X is the frame time on a phone with the new kinds in
   * view.
   */
  readonly structureItems: number;
  /**
   * Whether the road and the ground carry their procedural surface detail —
   * #425: a grain on the tarmac, a mottle and a patchwork of fields on the
   * ground, computed in the fragment from where it is.
   *
   * ⚠️ **No texture.** #425 asked for tiled textures, and the photographic
   * ones wait for [#431](https://github.com/openzigs/onyourleft/issues/431);
   * what ships is the half that needs no asset, drawn by arithmetic in the
   * shader, so "no texture reaches the GPU" (#366) still holds and ADR 0022 is
   * not amended.
   *
   * ⚠️ **On the target rung only**, which is #425's own criterion: *"a
   * throttling phone drops textures before it drops frame rate"* — the first
   * step down takes it at the display's rate, and the first rung that caps
   * below the display's rate is the one after (#482). Detail is what goes first because nothing a rider needs lives
   * in it: the gradient is in the road's own colour, which the grain is
   * bounded against (`terrain.ts` §`ROAD_SURFACE_GRAIN`).
   *
   * ## ⚠️ Provenance — BR-1, and not a measurement
   *
   * Validation 0002 Part Y measures the frame time on a phone.
   */
  readonly surfaceDetail: boolean;
  /**
   * Which of the two worlds this rung draws — [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md)
   * D-3 and D-10.
   *
   * - `'stylised'` — today's world: the Kenney models, #366's vertex colours,
   *   the Lambert/flat pair, the procedural surfaces. **Every rung of
   *   {@link QUALITY_LADDER}**, and the world the precache holds (D-7).
   * - `'realistic'` — the photoscanned world: physically based materials lit
   *   by an HDRI's environment and `world.ts`'s one sun, photographic road and
   *   ground, photoscanned vegetation and the MakeHuman rider. **Only the rungs
   *   of {@link REALISTIC_LADDER}**, which sits above the stylised ladder and
   *   which nothing in the shipped app selects — D-12: *"offered to riders only
   *   when the world is whole"*, and layer 3 (structures) has not landed.
   *
   * ⚠️ **A whole world, never a kind at a time.** No rung draws a pack asset
   * from one world beside a pack asset from the other (D-3): on a realistic
   * rung the buildings are their own procedural primitives rather than Kenney's
   * models until layer 3 lands (#475), and stepping down leaves the realistic
   * ladder for the stylised ladder's TOP, every kind at once —
   * {@link nextWorldQuality}.
   */
  readonly world: 'stylised' | 'realistic';
  /** A human-readable name, for the diagnostic line #91 asks to be recorded. */
  readonly label: string;
}

/**
 * A frame cap of "the display's own rate": draw on every animation frame the
 * browser offers, which is never faster than the display refreshes — 60 Hz on
 * the Pixel Tablet. Infinite so that `frame-pacer.ts`'s interval is zero and no
 * animation frame is ever skipped, rather than a guessed 60 that would halve a
 * 120 Hz display's rate or be above a 50 Hz one's.
 */
export const DISPLAY_RATE = Number.POSITIVE_INFINITY;

/**
 * #91's target frame rate, and the cap of the first rung that gives up frame
 * rate at all. The two rungs above it draw at the display's rate where the
 * device sustains that — see {@link QUALITY_LADDER}.
 */
export const TARGET_FRAMES_PER_SECOND = 30;

/**
 * The ladder's first step down — resolution, scenery and the other detail —
 * at the display's rate (#482). Named because two rungs are built from it:
 * level 1 is this, and level 2 is this capped at 30. @see QUALITY_LADDER
 */
const REDUCED_AT_DISPLAY_RATE: QualitySettings = {
  renderScale: 0.83,
  frameCap: DISPLAY_RATE,
  scatterItems: 160,
  sceneryVariants: 2,
  terrainBands: 10,
  water: 'flat',
  structureItems: 120,
  surfaceDetail: false,
  shading: 'lit',
  riderShadows: 'contact',
  world: 'stylised',
  label: 'reduced resolution and scenery',
};

/**
 * The ladder, coolest last.
 *
 * ## The owner's rulings on frame rate — #476 and #482, 2026-09-22
 *
 * ⚠️ **The top TWO rungs are uncapped, at the display's rate**
 * ({@link DISPLAY_RATE} — 60 Hz on the tablet, and never above the display's
 * own rate), **and only the three below them cap, at 30 → 24 → 20.** So a
 * warming device first gives up resolution and scenery AT the display's rate,
 * and only after that gives up frame rate. **A reviewer who remembers the first
 * step down cutting to 30 fps is reading the old file**: between #476 and #482
 * level 1 took the resolution, the scenery AND the drop from 60 to 30 in one
 * step, and #481's review (finding 4) put that to the owner, who ruled *"I want
 * the extra 60 fps step."* And a reviewer who remembers every rung capping at
 * 30, or this paragraph saying *"there is deliberately no 60 fps rung"*, is
 * reading an older one still — #476 found the cap was read by nothing, so every
 * rung had in fact been drawing at the display's rate, and the owner chose
 * *"allow 60 fps at the top quality rung where the device sustains it, then
 * step down 30 → 24 → 20 as it heats"*.
 *
 * | Level | Label | Frame cap | What that step gives up |
 * |---|---|---|---|
 * | 0 | full | display rate | — |
 * | 1 | reduced resolution and scenery | display rate | resolution, scenery, variety, far ground, structures, water shader, surface detail |
 * | 2 | reduced resolution and scenery, 30 fps | 30 | frame rate **only** — every other figure is level 1's |
 * | 3 | reduced resolution, scenery and frame rate | 24 | resolution, scenery, variety, far ground, structures, frame rate |
 * | 4 | minimum | 20 | resolution, scenery, far ground, structures, frame rate, shading |
 *
 * ⚠️ **Level 2 is a frame-rate step and nothing else, on purpose.** The
 * ruling is "shed resolution and scenery at 60, THEN cap 30 → 24 → 20", and a
 * step that capped at 30 and also cut resolution again would be two
 * reductions a rider sees at once, which is exactly what the ruling took
 * apart. Every figure on it is level 1's; `quality.test.ts` §"#482" asserts
 * that, so a later tuning that slips a second change into it is a red test.
 *
 * #91's arithmetic — *"30 fps is the right target, not a compromise"*, and 60
 * *"doubles the thermal bill for the entire ride"* — is not contradicted; the
 * rulings move who pays it. A cool device draws at the display's rate, and it
 * now takes TWO steps down (thermal forecast or frame time, the same two
 * signals as always) to return to #91's 30. **What "sustains it" means is the
 * ladder's existing policy, unchanged**: a device is stepped down when its
 * forecast or its frame times say it is hot ({@link HEADROOM_REDUCE_ABOVE},
 * {@link FRAME_MS_REDUCE_ABOVE}); a device drawing 40 fps at the top rung that
 * is neither is left there, which is still smoother than the 30 it would be
 * stepped down to.
 *
 * ## What "frame rate given up" means, precisely — #482
 *
 * **A rung gives up frame rate when its `frameCap` is below
 * {@link DISPLAY_RATE}.** #245 FR-4 (scenery before frame rate), #425 (surface
 * detail before frame rate) and #459 (the water shader before frame rate) are
 * each stated against that, and each holds: all three are given up at level 1
 * and the first capped rung is level 2. Between #476 and #482 the three were
 * read as "below {@link TARGET_FRAMES_PER_SECOND}", which they passed only
 * because level 1's own drop from 60 to 30 was not counted; the stricter
 * reading is back because the ladder now meets it.
 *
 * ## Where the realistic rungs sit — ADR 0026 D-3
 *
 * {@link REALISTIC_LADDER} is this ladder's levels 0 and 1 with the world
 * swapped, figure for figure, so both realistic rungs draw at the display's
 * rate and neither needs an exception any more. The heat walk from the
 * realistic top is realistic full (display) → realistic reduced (display) →
 * stylised full (display) → stylised reduced (display) → 30 → 24 → 20:
 * realism is given up two steps before any frame rate is, which is D-3's order
 * with room to spare.
 */
export const QUALITY_LADDER: readonly QualitySettings[] = [
  {
    renderScale: 1,
    // #476, the owner's ruling. @see QUALITY_LADDER
    frameCap: DISPLAY_RATE,
    // The target rung takes `scatter.ts`'s own constant rather than a copy of
    // it, so there is one figure for "as much scenery as this program ever
    // draws" instead of two that can drift. @see QualitySettings.scatterItems
    scatterItems: SCATTER_MAX_ITEMS,
    // Every shape the pack gives a kind — #367. The ceiling is
    // `scenery-models.ts`'s own constant rather than a copy of it, for the
    // reason `scatterItems` above takes `SCATTER_MAX_ITEMS`.
    sceneryVariants: MAXIMUM_SCENERY_VARIANTS,
    terrainBands: TERRAIN_BANDS,
    water: 'shaded',
    structureItems: STRUCTURE_MAX_ITEMS,
    surfaceDetail: true,
    shading: 'lit',
    riderShadows: 'contact',
    world: 'stylised',
    label: 'full',
  },
  // ⚠️ The scenery goes here, WITH the first resolution step rather than as a
  // rung of its own — {@link QualitySettings.scatterItems} argues why — and AT
  // the display's rate, which is #482's ruling: this step gives up no frame
  // rate at all. @see QUALITY_LADDER
  REDUCED_AT_DISPLAY_RATE,
  // ⚠️ #482: the frame-rate step, and NOTHING else — level 1 with a 30 fps
  // cap. @see QUALITY_LADDER §"Level 2 is a frame-rate step and nothing else"
  {
    ...REDUCED_AT_DISPLAY_RATE,
    frameCap: TARGET_FRAMES_PER_SECOND,
    label: 'reduced resolution and scenery, 30 fps',
  },
  {
    renderScale: 0.67,
    frameCap: 24,
    scatterItems: 100,
    sceneryVariants: 1,
    terrainBands: 9,
    water: 'flat',
    structureItems: 60,
    surfaceDetail: false,
    shading: 'lit',
    riderShadows: 'contact',
    world: 'stylised',
    label: 'reduced resolution, scenery and frame rate',
  },
  // ⚠️ The only rung that is flat. Resolution and frame rate are given up
  // twice each before the shading is given up once, because a rider notices a
  // softer world far less than a world that has stopped having a sun in it —
  // the same ordering argument {@link QualitySettings.renderScale} makes for
  // resolution going before frame rate.
  //
  // ⚠️ And sixty pieces of scenery rather than none, which is the one figure on
  // this ladder that does not go to its own floor:
  // {@link QualitySettings.scatterItems} §"Why the floor rung is sixty and not
  // zero" says what an empty verge costs a rider.
  {
    renderScale: 0.5,
    frameCap: 20,
    scatterItems: 60,
    sceneryVariants: 1,
    terrainBands: 8,
    water: 'flat',
    structureItems: 40,
    surfaceDetail: false,
    shading: 'flat',
    riderShadows: 'contact',
    world: 'stylised',
    label: 'minimum',
  },
];

/**
 * The headroom at which the next reduction is taken.
 *
 * 0.85 rather than 1.0: the forecast reaching 1.0 means throttling is happening,
 * and reducing then is reacting rather than avoiding. The whole value of a
 * *forecast* is spent by waiting for it to be right.
 */
export const HEADROOM_REDUCE_ABOVE = 0.85;

/**
 * The headroom below which quality is allowed back up.
 *
 * Well under {@link HEADROOM_REDUCE_ABOVE}, and that gap is the hysteresis. A
 * single threshold would oscillate: reduce, cool a little, restore, heat again —
 * and the oscillation is more visible to a rider than the lower setting would
 * have been, because each change is a visible resolution pop.
 */
export const HEADROOM_RESTORE_BELOW = 0.6;

/** The frame time above which quality is reduced regardless of the thermal API. */
export const FRAME_MS_REDUCE_ABOVE = 45;

/** The frame time below which quality is allowed back up. */
export const FRAME_MS_RESTORE_BELOW = 30;

/**
 * How long the measurement must agree before quality moves, in samples.
 *
 * A rider passing through a tunnel, a garbage collection, or one dropped frame
 * must not change the renderer's settings. #91's criterion is about a *sustained*
 * condition, and a single-sample trigger would make the resolution flicker on
 * ordinary jitter.
 *
 * ## ⚠️ A sample is a DRAWN frame, so the window is longer lower down — #482
 *
 * Since #476 the ladder is fed one sample per drawn frame (`frame-pacer.ts`
 * §"What the ladder is told"), so thirty samples are not a fixed duration. On
 * a 60 Hz display, with frames that cost less than a vsync:
 *
 * | Rung | Cap | Thirty samples take |
 * |---|---|---|
 * | 0, 1 | display rate | 0.5 s |
 * | 2 | 30 | 1.0 s |
 * | 3 | 24 | 1.25 s |
 * | 4 | 20 | 1.5 s |
 *
 * **Decided, not merely noted: this stays a count of drawn frames rather than
 * a duration.** #481's review (finding 2) asked for one or the other, and the
 * count wins on three grounds. (1) Lower rungs are cheaper, so the heat they
 * are reacting to builds more slowly; a window that lengthens as the ladder
 * descends asks a hot device to be hot for longer before it gives up more,
 * which is the direction Google's recovery guidance leans, and it lengthens
 * the recovery window by the same factor, which damps the 30 ↔ 24 flicker
 * {@link HEADROOM_RESTORE_BELOW} exists to prevent. (2) A duration would need a
 * clock inside {@link nextQuality}, which is pure and is handed two numbers;
 * the time between samples is the pacer's, not the ladder's, and a second
 * clock is how the two would come to disagree. (3) Since #482 the first two
 * steps down — the ones a warming device takes first — both happen at the
 * display's rate, so the slower windows are only ever reached by a device that
 * has already been stepped down twice. The slowest is a second and a half, at
 * the floor. `frame-pacer.test.ts` §"how long the ladder takes to react"
 * pins the table, so changing this number or a cap changes it visibly.
 */
export const SUSTAINED_SAMPLES = 30;

/** What the policy is tracking between calls. */
export interface QualityState {
  readonly level: QualityLevel;
  /** Consecutive samples arguing for a change, signed: positive means hotter. */
  readonly pressure: number;
}

/** A fresh ride starts at the target quality. */
export const INITIAL_QUALITY: QualityState = { level: 0, pressure: 0 };

/** One measurement. @see nextQuality */
export interface QualitySample {
  /** Android's forecast, 0–1, or `undefined` where the platform has none. */
  readonly thermalHeadroom?: number | undefined;
  /** A recent frame time in milliseconds. */
  readonly frameMs: number;
}

/**
 * The quality level after one more measurement.
 *
 * Pure: same state and sample in, same state out. The renderer applies the
 * result; it does not decide it.
 */
export function nextQuality(state: QualityState, sample: QualitySample): QualityState {
  const { level, pressure } = step(state, sample, QUALITY_LADDER.length - 1);
  return { level, pressure };
}

/**
 * One measurement's worth of movement on a ladder of `last + 1` rungs, and
 * whether it wanted to step down past the last one — which only
 * {@link nextWorldQuality} cares about, because only the realistic ladder has
 * somewhere to go when it runs out.
 */
function step(
  state: QualityState,
  sample: QualitySample,
  last: number,
): QualityState & { readonly pastTheFloor: boolean } {
  const hot = isHot(sample);
  const cool = isCool(sample);

  // Neither: the measurement argues for nothing, so any accumulated pressure
  // decays rather than persisting. Without this a phone that was briefly hot an
  // hour ago would still be one sample from a reduction.
  if (!hot && !cool) {
    return { ...state, pressure: decayToward(state.pressure, 0), pastTheFloor: false };
  }

  const pressure = hot ? Math.max(0, state.pressure) + 1 : Math.min(0, state.pressure) - 1;
  if (Math.abs(pressure) < SUSTAINED_SAMPLES) {
    return { level: state.level, pressure, pastTheFloor: false };
  }

  const wanted = hot ? state.level + 1 : state.level - 1;
  const level = clampLevel(wanted, last);
  // Pressure resets on a change so the next rung needs its own sustained run,
  // rather than the ladder being descended in consecutive frames.
  return {
    level,
    pressure: level === state.level ? pressure : 0,
    pastTheFloor: wanted > last,
  };
}

/** The settings for a level. */
export function qualitySettings(level: QualityLevel): QualitySettings {
  return QUALITY_LADDER[level] as QualitySettings;
}

/**
 * The top rung with a real shadow map for the riders — #426's second half.
 *
 * ## Why it is above the ladder rather than on it
 *
 * #426: *"Measure (2) and ship it only as a rung on `quality.ts`'s ladder,
 * off by default on the device floor."* {@link QUALITY_LADDER} starts every
 * ride at level 0 and climbs back to it whenever a device runs cool, so a
 * shadow map at level 0 would be ON by default everywhere, and one inserted
 * above it would be climbed to by any cool device, the floor included. So it
 * is a rung the ladder never reaches by itself: a rider who asks for it
 * starts here, and the first reduction the ladder takes — thermal or frame
 * time, the same two signals as every other rung — is to level 1, which has
 * no shadow map. It is the first thing given up, which is where #426 puts it.
 *
 * ⚠️ **It is the full rung with one field changed**, so a measurement of it
 * against level 0 is a measurement of the shadow map and nothing else.
 *
 * ⚠️ **Nothing measured it on a device yet.** The browser gate publishes what
 * it costs in the pinned Chromium on a software rasteriser, which says nothing
 * about a phone; `docs/validation/0002-android-shell-and-game.md` Part T is
 * the procedure, with its tables empty. Whether this stays, becomes a default
 * on some devices, or is removed as "measured, not worth it" is that
 * measurement's to decide. How a rider asks for it: {@link rungFor}.
 */
export const RIDER_SHADOW_MAP_RUNG: QualitySettings = {
  ...(QUALITY_LADDER[0] as QualitySettings),
  riderShadows: 'map',
  label: 'full, with a rider shadow map',
};

/**
 * The settings a ride draws with at a level — {@link qualitySettings}, except
 * that a rider who asked for the shadow map gets {@link RIDER_SHADOW_MAP_RUNG}
 * in place of level 0, and loses it the moment the ladder steps down.
 * Whether it ever comes back that ride is {@link keepsShadowMap}'s: it does not.
 */
export function rungFor(level: QualityLevel, shadowMap: boolean): QualitySettings {
  return level === 0 && shadowMap ? RIDER_SHADOW_MAP_RUNG : qualitySettings(level);
}

/**
 * Whether a ride that wanted the shadow map still wants it at this level —
 * the LATCH that makes "the first thing given up" stay given up.
 *
 * ⚠️ **{@link rungFor} alone would flap, and did until #448's review.** The
 * ladder climbs back to level 0 whenever the device cools, and `rungFor(0,
 * true)` is the map rung, so every 0 → 1 → 0 round trip turned the map off and
 * on again. Each change rebuilds the riders' and the catcher's shader programs
 * (`three-renderer.ts` §`applyRiderShadows`), which is a stall; a stall is a
 * frame-time spike; and a frame-time spike is what pushes the ladder down
 * again. So once any step down has been seen, the answer is `false` for the
 * rest of the ride, whatever the level does next.
 *
 * Fed its own previous answer on every level change — `GameView` holds it in
 * a ref and re-reads the device's choice only when a ride STARTS, which is
 * what resets the latch. Pure: the state is the caller's.
 */
export function keepsShadowMap(wanted: boolean, level: QualityLevel): boolean {
  return wanted && level === 0;
}

/**
 * Where a rider's request for the shadow map is kept: THIS device's
 * `localStorage`, the way `hud/announce-preference.ts` keeps announcements —
 * a GPU is a property of the device, not of the athlete.
 *
 * ⚠️ **There is no control for it on any screen, deliberately.** It exists to
 * be MEASURED (Part T of validation 0002 sets it through
 * `apps/mobile/tools/webview-probe.mjs`), and a Settings switch offering a
 * rider a feature nobody has measured on their device would be offering them
 * a hot phone. A control is the measurement's to add.
 */
export const RIDER_SHADOW_MAP_STORAGE_KEY = 'oyl.game.riderShadowMap';

/** Whether this device has asked for the shadow map. Any failure to read is "no". */
export function readShadowMapChoice(
  storage: { getItem(key: string): string | null } | undefined,
): boolean {
  try {
    return storage?.getItem(RIDER_SHADOW_MAP_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * The realistic world's rungs — [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md)
 * D-3, above {@link QUALITY_LADDER}, coolest last.
 *
 * ## Why a ladder of its own rather than two more rungs on that one
 *
 * D-3: *"the realistic world is a second set of rungs above it. It is chosen
 * by the rider … and — like {@link RIDER_SHADOW_MAP_RUNG} — it is never
 * entered by the thermal logic on its own."* {@link nextQuality} climbs back
 * to level 0 whenever a device runs cool, so realism inserted above level 0
 * would be climbed to by every cool device — the floor device included, which
 * D-3 says is never defaulted to realism. A ladder of its own, left by
 * {@link nextWorldQuality} and never re-entered, is the same latch the shadow
 * map has, for a whole world.
 *
 * ## The two rungs, and what the second gives up
 *
 * The first is the stylised target rung's every figure with the world
 * swapped, so a measurement of it against level 0 is a measurement of realism
 * and nothing else. The second takes the stylised ladder's first step down —
 * resolution, scenery, the far ground and the water shader — **inside** the
 * realistic world, before the world itself is given up: D-3's *"the realistic
 * rungs reduce within themselves"*. Neither lowers the frame cap, so a hot
 * device gives up realism before it gives up frame rate, which is what the
 * owner's brief for #430's pull request asked of the ladder. ⚠️ **Since #482
 * both are exact copies of stylised levels 0 and 1 with the world swapped.**
 * Between #476 and #482 the second kept the top rung's cap by exception,
 * because the stylised level 1 it copied capped at 30; that level now draws at
 * the display's rate itself, so the exception is gone, and the realistic walk
 * reaches its first capped rung two steps after it leaves realism —
 * {@link QUALITY_LADDER} §"Where the realistic rungs sit".
 *
 * ⚠️ **Nothing in the shipped app selects either.** D-12: the realistic world
 * is offered to riders only when it is whole, and layer 3 (structures) has not
 * landed — [#475](https://github.com/openzigs/onyourleft/issues/475). The one
 * way to reach it is the owner's harness page, `apps/web/browser/realistic.html`,
 * and `realistic-offered.test.ts` fails the build if a module the product
 * ships names this ladder.
 *
 * ⚠️ Provenance: every figure is the stylised rung it is copied from, so it is
 * BR-1 exactly as they are. What realism costs on the tablet is #457's device
 * run and `realistic-budget.ts`; the soak is validation 0002 Part Z.
 *
 * @unwired reached only from the owner's harness page until ADR 0026 D-12's
 * layer 3 lands and a rider is offered the realistic world — #475.
 */
export const REALISTIC_LADDER: readonly QualitySettings[] = [
  { ...(QUALITY_LADDER[0] as QualitySettings), world: 'realistic', label: 'realistic' },
  // The stylised first step down, at the display's rate, with the world
  // swapped — #482. The heat walk never raises the cap: realistic 60 → 60 →
  // stylised full 60 → reduced 60 → 30 → 24 → 20.
  {
    ...(QUALITY_LADDER[1] as QualitySettings),
    world: 'realistic',
    label: 'realistic, reduced resolution and scenery',
  },
];

/** Where a ride that may be realistic is on the two ladders. */
export interface WorldQualityState {
  /** Whether the ride is still on {@link REALISTIC_LADDER}. Once false, false for the ride. */
  readonly realistic: boolean;
  /** The level on whichever ladder {@link realistic} names. */
  readonly quality: QualityState;
}

/**
 * A ride the rider started in the realistic world.
 *
 * @unwired reached only from the owner's harness page until #475 offers the
 * realistic world to a rider; see {@link REALISTIC_LADDER}.
 */
export const INITIAL_REALISTIC_QUALITY: WorldQualityState = {
  realistic: true,
  quality: INITIAL_QUALITY,
};

/**
 * The next state after one more measurement, on whichever ladder the ride is.
 *
 * Within {@link REALISTIC_LADDER} it moves exactly as {@link nextQuality} does,
 * with the same hysteresis. **Stepping down past its last rung leaves realism**
 * for the stylised ladder's level 0 — the TOP of that ladder, every kind at
 * once (D-3) — and nothing ever steps back: a device that was too hot for
 * realism once this ride is not handed it again the moment it cools, because
 * each switch is a whole world of textures uploaded or freed, and that stall is
 * itself a frame-time spike that would push it straight back down. The same
 * argument {@link keepsShadowMap} makes, for the same reason.
 *
 * Pure: the state is the caller's.
 *
 * @unwired reached only from the owner's harness page until #475; see
 * {@link REALISTIC_LADDER}.
 */
export function nextWorldQuality(
  state: WorldQualityState,
  sample: QualitySample,
): WorldQualityState {
  if (!state.realistic) {
    return { realistic: false, quality: nextQuality(state.quality, sample) };
  }
  const moved = step(state.quality, sample, REALISTIC_LADDER.length - 1);
  if (moved.pastTheFloor) {
    return { realistic: false, quality: INITIAL_QUALITY };
  }
  return { realistic: true, quality: { level: moved.level, pressure: moved.pressure } };
}

/**
 * The settings a ride draws with in a {@link WorldQualityState}.
 *
 * @unwired reached only from the owner's harness page until #475; see
 * {@link REALISTIC_LADDER}.
 */
export function worldRung(state: WorldQualityState): QualitySettings {
  return state.realistic
    ? (REALISTIC_LADDER[state.quality.level] as QualitySettings)
    : qualitySettings(state.quality.level);
}

/** Whether this sample argues for less work. */
function isHot(sample: QualitySample): boolean {
  const headroom = sample.thermalHeadroom;
  // ⚠️ `NaN > x` is false, so a vendor returning NaN reads as "not hot" here and
  // the frame time is what decides. That is the intended behaviour and it is
  // stated because the opposite reading — NaN as hot — would throttle every
  // device whose vendor never implemented the API.
  if (headroom !== undefined && Number.isFinite(headroom) && headroom > HEADROOM_REDUCE_ABOVE) {
    return true;
  }
  return sample.frameMs > FRAME_MS_REDUCE_ABOVE;
}

/** Whether this sample argues for more. Both signals must agree. */
function isCool(sample: QualitySample): boolean {
  const headroom = sample.thermalHeadroom;
  // Frames must be comfortable AND, where the platform reports it, the forecast
  // must be well clear. Restoring on frame time alone is how a device that is
  // hot but keeping up gets pushed back into throttling.
  if (sample.frameMs >= FRAME_MS_RESTORE_BELOW) {
    return false;
  }
  if (headroom === undefined || !Number.isFinite(headroom)) {
    return true;
  }
  return headroom < HEADROOM_RESTORE_BELOW;
}

function decayToward(pressure: number, target: number): number {
  if (pressure > target) {
    return pressure - 1;
  }
  return pressure < target ? pressure + 1 : target;
}

function clampLevel(level: number, last: number): QualityLevel {
  const clamped = level < 0 ? 0 : level > last ? last : level;
  return clamped as QualityLevel;
}
