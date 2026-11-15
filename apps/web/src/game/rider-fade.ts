// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Another rider between the chase camera and the rider fades out, and never
 * pops — #2596, the owner's ruling of 2026-11-14.
 *
 * ## Why
 *
 * `lap-race/pack-layout.ts` holds a bot that would be drawn through the rider
 * BEHIND them instead (#2558), a bike length and a wheel gap back. The chase
 * camera stands `camera.ts` §`CAMERA_BEHIND_METRES` (4.5 m) behind the rider
 * and §`CAMERA_ABOVE_METRES` (2 m) up, so a bot held there is about two metres
 * in front of the eye with its head a little under it: on the owner's tablet
 * a large dark low-detail head filled the bottom middle of the screen. A
 * ghost or a pacer the rider has passed is drawn on the same line, and so is
 * a room's rider, so the rule is for every rider drawn but the rider's own.
 *
 * ## The rule
 *
 * ⚠️ **Only a rider BEHIND the rider, in their lane — the owner's ruling of
 * 2026-11-15** from the tablet: a bot riding one place across and a little
 * behind showed the stipple, and *"fade when behind"*. A rider beside the
 * rider is always drawn whole.
 *
 * In plan, a line runs from the camera's EYE through the rider. Another
 * rider's drawn place is measured on it: how far behind the rider along it
 * (`behind`), and how far off it to either side (`aside`). Each gives a share,
 * falling evenly, and the rider is faded by the two multiplied:
 *
 *     behindShare = clamp((behind − behind.whole) / (behind.gone − behind.whole), 0, 1)
 *     asideShare  = clamp((aside.whole − aside) / (aside.whole − aside.gone), 0, 1)
 *     faded       = behindShare × asideShare
 *
 * Both move continuously with the riders and the eye, so a rider dropping
 * back into the lane, or moving out of it, fades over the distance it takes,
 * never in one frame.
 *
 * `three-renderer.ts` draws `faded` as a screen-space dither, the one #545's
 * near trees and #617's tree levels already use: a fragment whose hash falls
 * under it is discarded. A fading rider is no new draw call, no blending and
 * no sorting, and its instances stay in the meshes the rider's own avatar is
 * drawn by.
 *
 * ## The distances
 *
 * - **`behind`: whole at 0.9 m, gone at 1.7 m** back along the line. 0.9 m
 *   is the back of the rider's own bicycle: a marker stands midway between
 *   its two contact patches (`bicycle.ts`), half `lap-race/pack-layout.ts`
 *   §`BIKE_LENGTH_METRES` (1.75 m) in front of its tail. 1.7 m is short of
 *   the nearest a bot is held in line behind them, that bike length and
 *   #2542's shortest wheel gap (0.3 m), 2.05 m, so that bot is gone. 5 cm of
 *   a bot dropping back over the 0.8 m ramp is a sixteenth of the fade.
 * - **`aside`: gone at 0.1 m, whole at 0.4 m** off the line. Whole short of
 *   `PACK_ABREAST_METRES` (0.55 m), so a bot one place across is never
 *   faded wherever it is along the road, with 0.15 m to spare for the few
 *   degrees the damped camera's line turns off the road through a bend
 *   (about 4° at a bot two metres behind); the whole ramp is inside the
 *   rider's lane. Gone within 0.1 m, so a rider squarely between the eye and
 *   the rider is gone. The 0.3 m between is as wide as the lane allows, so a
 *   rider moving into or out of the lane — the solo pacer drifts 0.9 m across
 *   for each metre the rider drops it — fades over several frames.
 *
 * There is no end behind the eye: a rider in the lane behind the camera is
 * faded too, which the camera does not see, so that one passing the eye is
 * already faded when it comes into the frame.
 *
 * ⚠️ **Since the ruling, a rider passing BESIDE the eye is drawn whole.** A
 * rider a place across that drops back past the camera stays whole as it
 * passes it, and the near plane (`camera.ts` §`NEAR_PLANE_METRES`, 0.5 m) may
 * cut its edge for the moment it is beside the eye. The ruling puts the
 * stipple on a rider beside the rider first. The solo pacer is not such a
 * rider: `scene.ts` brings it into the rider's lane as it is dropped, so it is
 * gone before it reaches the eye (`rider-fade.test.ts`).
 *
 * ⚠️ **The rider's own avatar is never faded**: {@link riderFaded} returns 0
 * for `kind: 'rider'` before it measures anything.
 *
 * Its shadow fades with it — the contact blob and the realistic silhouette
 * are as light as the rider is faded out, and the shadow map is cast through
 * the same dither — so a bot faded out leaves no shadow under the camera.
 *
 * ⚠️ **Only the drawn picture.** Nothing here is read by the simulation, the
 * race, a draft or a trainer: a faded rider is still where it was.
 *
 * Pure, and naming no rendering library — `three-seam.test.ts`.
 */

import { cameraRig } from './camera';
import type { CameraPose, RiderMarker } from './port';

/**
 * How far behind the rider along the camera's line a rider begins to fade
 * (`behind.whole`) and is gone (`behind.gone`), and how far off that line it
 * is gone (`aside.gone`) and whole (`aside.whole`), in metres. @see riderFaded
 */
export const RIDER_FADE_METRES = {
  behind: { whole: 0.9, gone: 1.7 },
  aside: { gone: 0.1, whole: 0.4 },
} as const;

/**
 * How another rider near the camera is drawn: `'fade'` is the product; `'off'`
 * draws every rider whole wherever it is, as before #2596 — the browser gate's
 * control.
 */
export type RiderFade = 'fade' | 'off';

/**
 * The line {@link riderFaded} measures on, in plan: the eye, the rider, and
 * the unit direction from the eye toward the rider.
 */
export interface RiderFadeLine {
  eyeX: number;
  eyeZ: number;
  riderX: number;
  riderZ: number;
  alongX: number;
  alongZ: number;
}

/** A line to write into, so a frame allocates nothing. */
export function emptyRiderFadeLine(): RiderFadeLine {
  return { eyeX: 0, eyeZ: 0, riderX: 0, riderZ: 0, alongX: 0, alongZ: 1 };
}

/**
 * The line for a frame drawn from `pose`, written into `into`: from the eye
 * `camera.ts` §`cameraRig` places for that pose — taken from it, not
 * restated, so the fade measures from wherever the camera really stands —
 * through the frame's own rider, or the pose's point when the frame carries
 * none. Where that point is the eye itself, the line runs along the pose's
 * heading.
 *
 * Once a frame, so the rig it builds is the one allocation here;
 * {@link riderFaded}, asked of every rider, allocates nothing.
 */
export function riderFadeLine(
  pose: CameraPose,
  markers: readonly RiderMarker[],
  into: RiderFadeLine,
): RiderFadeLine {
  const { x: eyeX, z: eyeZ } = cameraRig(pose).eye;
  const rider = markers.find((marker) => marker.kind === 'rider');
  const riderX = rider?.x ?? pose.x;
  const riderZ = rider?.z ?? pose.z;
  const toX = riderX - eyeX;
  const toZ = riderZ - eyeZ;
  const length = Math.hypot(toX, toZ);
  into.eyeX = eyeX;
  into.eyeZ = eyeZ;
  into.riderX = riderX;
  into.riderZ = riderZ;
  into.alongX = length > 0 ? toX / length : pose.headingX;
  into.alongZ = length > 0 ? toZ / length : pose.headingZ;
  return into;
}

/**
 * How much of `marker` is NOT drawn, for a frame whose line is `line` — 0
 * whole, 1 not drawn at all. Always 0 for the rider's own avatar, and for any
 * rider when there is no line. Allocates nothing: each belt asks it of every
 * rider every frame.
 */
export function riderFaded(marker: RiderMarker, line: RiderFadeLine | undefined): number {
  if (line === undefined || marker.kind === 'rider') return 0;
  const offX = marker.x - line.riderX;
  const offZ = marker.z - line.riderZ;
  const behind = -(offX * line.alongX + offZ * line.alongZ);
  const aside = Math.abs(offX * line.alongZ - offZ * line.alongX);
  const { behind: back, aside: side } = RIDER_FADE_METRES;
  const behindShare = Math.min(1, Math.max(0, (behind - back.whole) / (back.gone - back.whole)));
  const asideShare = Math.min(1, Math.max(0, (side.whole - aside) / (side.whole - side.gone)));
  return behindShare * asideShare;
}
