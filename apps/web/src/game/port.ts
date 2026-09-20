// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the game needs of a 3D renderer, and nothing more.
 *
 * The same seam as `map/port.ts`, for the same reason and with the same honest
 * caveat. Every module in `game/` but `three-renderer.ts` is written against
 * these interfaces, and `three-renderer.ts` is the one place `three` is named.
 *
 * ## Why the seam is worth more here than it was for the map
 *
 * jsdom implements no WebGL, so a `WebGLRenderer` cannot be constructed in the
 * Vitest suite — exactly as `maplibregl.Map` cannot. But where `map/` had only a
 * style object and a coordinate array on this side of the boundary, the game has
 * considerably more: the fixed-tick simulation (`simulation.ts`), the corridor
 * geometry (`terrain.ts`), the quality ladder (`quality.ts`) and the whole HUD
 * (`hud/`). All of it is asserted in jsdom.
 *
 * What is left behind this interface is genuinely only *"turn these vertices
 * into pixels"* — which is the part three.js is responsible for and the part
 * this project has no business re-testing. The browser gate (§4f) checks the one
 * thing that is genuinely ours and genuinely needs a GL context: that a renderer
 * **constructs against a real context and draws a frame** with the geometry we
 * built. `game.browser.spec.ts` is that check.
 *
 * ## What the seam does not buy, stated rather than papered over
 *
 * ⚠️ It does not tell you the scene **looks right**. Nothing here does. A
 * screenshot comparison would need a reference image, and #19 forbids deriving
 * one from another product while there is nothing else to compare against.
 *
 * ⚠️ It does not discharge #91's third criterion — the 60-minute run on the
 * device floor recording frame times and `getThermalHeadroom()`. That needs the
 * hardware, and it is recorded as outstanding in `README.md` beside this file.
 */

import type { QualitySettings } from './quality';
import type { ScatterItem } from './scatter';
import type { RoadCorridor } from './terrain';
import type { WorldStyle } from './world';

/**
 * How far behind the rider a renderer puts the chase camera, in metres.
 *
 * ⚠️ **Here rather than in `three-renderer.ts`, because two files need it and
 * one of them must not import `three`.** `world.ts`'s near-fog bound is the
 * claim that the road under the rider is left alone, and "under the rider"
 * means *at the camera's distance from the rider's own marker* — so
 * `world.test.ts` checks `fogFactor` at exactly this distance. It used to do
 * that against a hand-copied `8`, which silently stops describing the camera
 * the day the camera moves, and starts testing the wrong distance without
 * going red. `world.ts` imports `VIEW_AHEAD_METRES` from `terrain.ts` for the
 * same reason and says so: *"so the two cannot drift"*.
 *
 * ADR 0008 **D-5** fixes the camera, so this is part of the seam's contract
 * rather than one renderer's taste: there is no free-look, and adding one is a
 * change to that ADR. Eight metres back is roughly a following motorbike — far
 * enough that the road ahead fills the frame on a phone held at arm's length,
 * close enough that the rider's own marker stays large enough to find.
 */
export const CAMERA_BEHIND_METRES = 8;

/** Where the chase camera is, in the corridor's local metres. */
export interface CameraPose {
  /** The rider's position on the road. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Which way the rider is facing, as a unit vector in the ground plane. */
  readonly headingX: number;
  readonly headingZ: number;
}

/** A marker on the road: the rider, the bot (#92), or the ghost (#93). */
export interface RiderMarker {
  /**
   * Which of the three this is.
   *
   * ⚠️ Carried as a **kind** rather than as a colour, because #93's third
   * criterion is that the ghost be *"visually distinct from the bot pacer and
   * from the rider"* at a glance on a bar-mounted phone. A renderer that took a
   * colour would let a caller pass the same one twice; taking the kind means the
   * distinction is the renderer's to guarantee.
   *
   * ⚠️ **What the renderer guarantees with it changed in #368**, and this note
   * used to say it gave each *"a different shape as well as a different
   * colour"*. All three are bicycles now, so colour carries the distinction
   * alone — which is a weaker position than the old one and was taken with that
   * stated: #368's own framing is that a solid is not something you race.
   * `bicycle.ts` carries the replaced argument, and the distances at which it
   * was actually checked are in
   * `docs/validation/0002-android-shell-and-game.md` Part N rather than in
   * anybody's assertion here.
   */
  readonly kind: 'rider' | 'bot' | 'ghost';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * Which way this marker is facing, as a unit vector in the ground plane.
   *
   * ⚠️ **Added by #349, because a bicycle has a front and a sphere does not.**
   * The three shapes the renderer drew before it were all rotationally
   * symmetric about the vertical, so no marker had ever needed to say which way
   * it was pointing; a rider on a bicycle sideways on the road is the most
   * obviously wrong thing this frame could carry.
   *
   * ⚠️ Taken from the corridor by `scene.ts`, at the marker's **own** distance,
   * rather than from {@link CameraPose.headingX} — the two agree for the rider
   * by construction and cannot for the bot or the ghost, which are somewhere
   * else on the road and may be round a bend. Reading the camera's heading here
   * would be correct today and silently wrong the day anything but the rider
   * grows a front.
   */
  readonly headingX: number;
  readonly headingZ: number;
  /**
   * How far the cranks have turned, in radians — #349, #368.
   *
   * ⚠️ **All three carry one now, and this note used to say only the rider's
   * was read** — *"the bot is a cone and the ghost an octahedron, and neither
   * has a crank to turn"*. A reviewer who remembers that is reading the old
   * file. What is still true is that only the rider's comes from a **cadence**:
   * the bot's and the ghost's are derived from their own odometers at a fixed
   * gear by `scene.ts`, because a simulated rider has no sensor and
   * `bicycle.ts` §`simulatedCrankAngle` will not invent a rate and call one a
   * reading.
   *
   * ⚠️ **An optional field nobody supplies is exactly the hole
   * `check-wiring.mjs` §Limits says this repository's gates cannot see** — it is
   * how `SceneInput.botDistance` shipped a pacer that drew nothing (#237). So
   * `GameView.test.tsx` reads what the renderer was actually handed and fails if
   * a live cadence stops moving this number, and `game.browser.spec.ts` reads
   * the rider's own pixels back at two angles. Absent means the cranks are
   * wherever the renderer last put them, which is what the start line and the
   * browser harness want.
   */
  readonly crankAngle?: number | undefined;
}

/** One frame's worth of scene. */
export interface SceneFrame {
  readonly corridor: RoadCorridor;
  readonly camera: CameraPose;
  readonly markers: readonly RiderMarker[];
  /**
   * The ground, the sky and how far you can see — #241.
   *
   * ⚠️ **Carried on the frame rather than passed to `create`**, which keeps
   * `GameRenderer.create` taking only what a renderer needs to exist. A world
   * is a property of the route, and the frame is the object that always carries
   * the route's own answers — the corridor beside it is derived from the same
   * profile for the same reason.
   *
   * ⚠️ A `WorldStyle` added here that `three-renderer.ts` never reads passes
   * every test in the jsdom suite and changes nothing on screen — #240's named
   * defect shape for this epic. `game.browser.spec.ts` reads the drawing buffer
   * back for exactly that reason.
   */
  readonly world: WorldStyle;
  /**
   * What stands beside the road, for this stretch of it — #243.
   *
   * ⚠️ **Kinds and placements, never meshes.** The same reasoning
   * {@link RiderMarker} gives: a caller handed a mesh has already chosen a
   * rendering library, and `scatter.ts` is on the side of the seam that must
   * not name one. `three-renderer.ts` decides what a conifer looks like, and
   * #244 is the issue that makes it do so.
   *
   * ⚠️ Like {@link world}, an array added here that the renderer never reads
   * passes every jsdom test and changes nothing on screen — #240's named defect
   * shape for this epic. It **was** unread between #243, which places the
   * scenery, and #244, which draws it; `three-renderer.ts`'s `ScatterBelt` is
   * the reader, and `game.browser.spec.ts` is what says so from the drawing
   * buffer rather than from this sentence.
   */
  readonly scatter: readonly ScatterItem[];
}

/** A live 3D view. Created by a {@link GameRenderer}, destroyed by its owner. */
export interface GameView {
  /** Draw one frame. Called by the host's loop; never drives the simulation. */
  render(frame: SceneFrame): void;
  /** Apply a new quality level. @see QualitySettings */
  setQuality(settings: QualitySettings): void;
  /** Tell the renderer the canvas changed size. */
  resize(widthCssPixels: number, heightCssPixels: number): void;
  /** Release the GL context and every buffer. */
  destroy(): void;
  /**
   * Whether a real drawing context was obtained.
   *
   * ⚠️ `false` is not an error and must not throw: WebGL can be unavailable for
   * ordinary reasons — a browser with it disabled, a device out of GPU memory, a
   * context lost and not yet restored. #94's HUD is a DOM overlay and stays
   * useful with no world behind it, so the ride screen degrades to a HUD-only
   * view rather than failing. `degradation.a11y.test.tsx` makes the same
   * argument for a chart that throws.
   */
  readonly hasContext: boolean;
}

/** Creates views. The one thing `three-renderer.ts` exports. */
export interface GameRenderer {
  create(canvas: HTMLCanvasElement, settings: QualitySettings): GameView;
}
