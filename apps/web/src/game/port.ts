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
import type { RoadCorridor } from './terrain';
import type { WorldStyle } from './world';

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
   * distinction is the renderer's to guarantee, and `three-renderer.ts` gives
   * each a different **shape as well as** a different colour — colour alone
   * fails a rider with a colour-vision deficiency and washes out in sunlight,
   * which is the same argument `views/AnalysisView.tsx` makes for its labels.
   */
  readonly kind: 'rider' | 'bot' | 'ghost';
  readonly x: number;
  readonly y: number;
  readonly z: number;
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
