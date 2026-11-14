// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2596 in a real WebGL context: a rider held between the chase camera and the
 * rider is faded out, and the rider is not — read off the drawing buffer of a
 * view `three-renderer.ts` builds, in whichever world it draws.
 *
 * Two squares of pixels are read, each aimed through the frame's own camera at
 * the middle of a back — between the hips and the shoulders `bicycle.ts`
 * §`riderJoints` poses a body to:
 *
 * - **the bot's**, on a bot held in line a bike length and a wheel gap behind
 *   the rider, as `lap-race/pack-layout.ts` holds one;
 * - **the rider's**, which that bot stands in front of from the camera.
 *
 * Each frame is compared with the same frame with the bot left out. With the
 * product's fade, adding the bot changes neither square: the bot is not drawn
 * and the rider is drawn exactly as before. With the fade off (the control),
 * both change, so the squares were the bot and something it hid. A bot two
 * places across is read too, for the partial fade between. The rider's square
 * read against an empty road says the square is the rider.
 *
 * And the whole frame: a bot faded out entirely changes not one pixel of it,
 * its shadow included, where with the fade off it changes many.
 */

import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES } from '../src/game/lap-race/pack-layout';
import { emptyRiderJoints, riderJoints } from '../src/game/bicycle';
import { cameraRig, verticalHalfTangent } from '../src/game/camera';
import type { GameView, RiderMarker, SceneFrame } from '../src/game/port';
import { riderFadeOf } from '../src/game/three-renderer';

/** How far behind the rider the bot is held, metres: a bike length and #2542's shortest wheel gap. */
export const FADE_PROBE_BEHIND_METRES = BIKE_LENGTH_METRES + 0.3;

/** Half a square's side, pixels. */
const HALF = 10;

/** What {@link riderFadeProbe} read: pixels of each square that adding the bot changed. */
export interface RiderFadeReading {
  /** Pixels in each square. */
  readonly pixels: number;
  /** The bot in line behind the rider, faded (the product) and whole (the control). */
  readonly bot: { readonly faded: number; readonly whole: number };
  /** The rider's back behind that bot, likewise. */
  readonly rider: { readonly faded: number; readonly whole: number };
  /** A bot two places across, faded and whole: the fade between. */
  readonly aside: { readonly faded: number; readonly whole: number };
  /** The rider's square against an empty road: it is the rider. */
  readonly riderDrawn: number;
  /** The whole frame, the bot in line behind the rider and its shadow: faded and whole. */
  readonly frame: { readonly faded: number; readonly whole: number };
}

/** `marker` moved `back` metres behind it along its heading and `across` to its right. */
export function behind(
  marker: RiderMarker,
  back: number,
  across: number,
  kind: RiderMarker['kind'] = 'bot',
): RiderMarker {
  return {
    ...marker,
    kind,
    racer: kind === 'bot' ? true : undefined,
    x: marker.x - marker.headingX * back - marker.headingZ * across,
    z: marker.z - marker.headingZ * back + marker.headingX * across,
  };
}

/** The middle of a rider's back, in the world. */
function backOf(marker: RiderMarker): { x: number; y: number; z: number } {
  const joints = riderJoints(0, emptyRiderJoints(), 0);
  const y = (joints.hips.y + joints.shoulders.y) / 2;
  const z = (joints.hips.z + joints.shoulders.z) / 2;
  return { x: marker.x + marker.headingX * z, y: marker.y + y, z: marker.z + marker.headingZ * z };
}

/** Where a point is drawn, in the drawing buffer's own pixels (from the bottom). */
function pixelOf(
  frame: SceneFrame,
  canvas: HTMLCanvasElement,
  point: { x: number; y: number; z: number },
): { x: number; y: number } {
  const pose = frame.camera;
  const { eye, target } = cameraRig(pose);
  const axis = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
  const length = Math.hypot(axis.x, axis.y, axis.z);
  const forward = { x: axis.x / length, y: axis.y / length, z: axis.z / length };
  const right = { x: -pose.headingZ, z: pose.headingX };
  const up = {
    x: -right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y,
  };
  const to = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };
  const depth = to.x * forward.x + to.y * forward.y + to.z * forward.z;
  const aspect = canvas.width / canvas.height;
  const t = verticalHalfTangent(aspect);
  const across = (1 + (to.x * right.x + to.z * right.z) / (depth * t * aspect)) / 2;
  const down = (1 - (to.x * up.x + to.y * up.y + to.z * up.z) / (depth * t)) / 2;
  return { x: Math.round(canvas.width * across), y: Math.round(canvas.height * (1 - down)) };
}

/** The square round `centre`, or the whole buffer, `frame` drawn twice first. */
function squareOf(
  view: GameView,
  gl: WebGL2RenderingContext,
  frame: SceneFrame,
  centre: { x: number; y: number } | 'whole',
): Uint8Array {
  view.render(frame);
  view.render(frame);
  const [x, y, width, height] =
    centre === 'whole'
      ? [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight]
      : [centre.x - HALF, centre.y - HALF, 2 * HALF + 1, 2 * HALF + 1];
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** How many pixels two squares disagree about. */
function changed(one: Uint8Array, other: Uint8Array): number {
  let count = 0;
  for (let at = 0; at < one.length; at += 4) {
    if (one[at] !== other[at] || one[at + 1] !== other[at + 1] || one[at + 2] !== other[at + 2]) {
      count += 1;
    }
  }
  return count;
}

/**
 * Reads #2596 off `view`'s drawing buffer for a frame built from `base`, whose
 * markers must carry the rider: only the rider and the bot are drawn, with no
 * scenery. Leaves the view fading, as the product does.
 */
export function riderFadeProbe(
  view: GameView,
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  base: SceneFrame,
): RiderFadeReading {
  const rider = base.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('the probe’s frame carries no rider');
  const alone: SceneFrame = { ...base, scatter: [], markers: [rider] };
  const inLine = behind(rider, FADE_PROBE_BEHIND_METRES, 0);
  const aside = behind(rider, FADE_PROBE_BEHIND_METRES, 2 * PACK_ABREAST_METRES);
  const botSquare = pixelOf(alone, canvas, backOf(inLine));
  const asideSquare = pixelOf(alone, canvas, backOf(aside));
  const riderSquare = pixelOf(alone, canvas, backOf(rider));
  const read = (
    bot: RiderMarker | undefined,
    centre: { x: number; y: number } | 'whole',
  ): Uint8Array =>
    squareOf(view, gl, bot === undefined ? alone : { ...alone, markers: [rider, bot] }, centre);
  const reading = (fade: 'fade' | 'off') => {
    riderFadeOf(view, fade);
    return {
      bot: changed(read(inLine, botSquare), read(undefined, botSquare)),
      rider: changed(read(inLine, riderSquare), read(undefined, riderSquare)),
      aside: changed(read(aside, asideSquare), read(undefined, asideSquare)),
      frame: changed(read(inLine, 'whole'), read(undefined, 'whole')),
    };
  };
  const whole = reading('off');
  const faded = reading('fade');
  const riderDrawn = changed(
    read(undefined, riderSquare),
    squareOf(view, gl, { ...alone, markers: [] }, riderSquare),
  );
  return {
    pixels: (2 * HALF + 1) ** 2,
    bot: { faded: faded.bot, whole: whole.bot },
    rider: { faded: faded.rider, whole: whole.rider },
    aside: { faded: faded.aside, whole: whole.aside },
    riderDrawn,
    frame: { faded: faded.frame, whole: whole.frame },
  };
}
