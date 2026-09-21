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
import { MAXIMUM_SCENERY_VARIANTS } from './scenery-models';

/** How hard the renderer is working. Lower is cooler. */
export type QualityLevel = 0 | 1 | 2 | 3;

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
  /** The frame cap, in frames per second. */
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
   *   directly — scenery is reduced before frame rate is — and the first rung
   *   whose `frameCap` drops below 30 is the **second step down**, by which
   *   point this budget has already fallen twice.
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
   * 240 → 160 → 100 → 60. Each rung keeps about two-thirds of the one above and
   * the floor keeps a quarter of the top, which is the shape {@link renderScale}
   * already takes in *pixels*: 1, 0.83, 0.67 and 0.5 square to 1, 0.69, 0.45
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
   * 3 → 2 → 1 → 1, on the same footing as every other figure on this ladder:
   * ADR 0008 D-2's rendering gate was waived rather than passed and
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
   * 12 → 10 → 9 → 8, on the same footing as every figure on this ladder. What
   * the browser gate measures is the vertex and index counts and the draw
   * range, and `docs/validation/0002-android-shell-and-game.md` Part V is the
   * frame time on a phone.
   */
  readonly terrainBands: number;
  /** A human-readable name, for the diagnostic line #91 asks to be recorded. */
  readonly label: string;
}

/**
 * The ladder, coolest last.
 *
 * Level 0 is the target #91 specifies — 30 fps at full render scale — and **not**
 * a "high" setting above it. There is deliberately no 60 fps rung: #91 is
 * explicit that *"30 fps is the right target, not a compromise"*, and that 60
 * "doubles the thermal bill for the entire ride". A rung above the target would
 * be a rung the device spends its headroom on before the ride has warmed up.
 */
export const QUALITY_LADDER: readonly QualitySettings[] = [
  {
    renderScale: 1,
    frameCap: 30,
    // The target rung takes `scatter.ts`'s own constant rather than a copy of
    // it, so there is one figure for "as much scenery as this program ever
    // draws" instead of two that can drift. @see QualitySettings.scatterItems
    scatterItems: SCATTER_MAX_ITEMS,
    // Every shape the pack gives a kind — #367. The ceiling is
    // `scenery-models.ts`'s own constant rather than a copy of it, for the
    // reason `scatterItems` above takes `SCATTER_MAX_ITEMS`.
    sceneryVariants: MAXIMUM_SCENERY_VARIANTS,
    terrainBands: TERRAIN_BANDS,
    shading: 'lit',
    riderShadows: 'contact',
    label: 'full',
  },
  // ⚠️ The scenery goes here, WITH the first resolution step rather than as a
  // rung of its own — {@link QualitySettings.scatterItems} argues why, and #245
  // FR-4's outer bound is discharged by the rung below rather than by this one.
  {
    renderScale: 0.83,
    frameCap: 30,
    scatterItems: 160,
    sceneryVariants: 2,
    terrainBands: 10,
    shading: 'lit',
    riderShadows: 'contact',
    label: 'reduced resolution and scenery',
  },
  {
    renderScale: 0.67,
    frameCap: 24,
    scatterItems: 100,
    sceneryVariants: 1,
    terrainBands: 9,
    shading: 'lit',
    riderShadows: 'contact',
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
    shading: 'flat',
    riderShadows: 'contact',
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
  const hot = isHot(sample);
  const cool = isCool(sample);

  // Neither: the measurement argues for nothing, so any accumulated pressure
  // decays rather than persisting. Without this a phone that was briefly hot an
  // hour ago would still be one sample from a reduction.
  if (!hot && !cool) {
    return { ...state, pressure: decayToward(state.pressure, 0) };
  }

  const pressure = hot ? Math.max(0, state.pressure) + 1 : Math.min(0, state.pressure) - 1;
  if (Math.abs(pressure) < SUSTAINED_SAMPLES) {
    return { level: state.level, pressure };
  }

  const wanted = hot ? state.level + 1 : state.level - 1;
  const level = clampLevel(wanted);
  // Pressure resets on a change so the next rung needs its own sustained run,
  // rather than the ladder being descended in consecutive frames.
  return { level, pressure: level === state.level ? pressure : 0 };
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

function clampLevel(level: number): QualityLevel {
  const last = QUALITY_LADDER.length - 1;
  const clamped = level < 0 ? 0 : level > last ? last : level;
  return clamped as QualityLevel;
}
