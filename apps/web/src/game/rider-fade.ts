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
 * In plan, a line runs from the camera's EYE toward the rider and stops
 * {@link RIDER_FADE_METRES}' `clear` short of them. Another rider whose drawn
 * place is nearer that line — or its end at the eye — than `whole` is drawn
 * with only part of its pixels, falling evenly to none at `gone`:
 *
 *     faded = clamp((whole − distance) / (whole − gone), 0, 1)
 *
 * So one distance covers both halves of the issue: a rider between the camera
 * and the rider is near the line, and a rider beside or just behind the
 * camera is near its end. It moves continuously with the riders and the eye,
 * so a rider coming up the side fades back in over the metre it takes to
 * leave that space, never in one frame.
 *
 * `three-renderer.ts` draws `faded` as a screen-space dither, the one #545's
 * near trees and #617's tree levels already use: a fragment whose hash falls
 * under it is discarded. A fading rider is no new draw call, no blending and
 * no sorting, and its instances stay in the meshes the rider's own avatar is
 * drawn by.
 *
 * ## The distances
 *
 * - **`clear`, 2 m**: the line stops that short of the rider. The nearest a
 *   bot is drawn in line behind them is `lap-race/pack-layout.ts`
 *   §`BIKE_LENGTH_METRES` (1.75 m) and #2542's shortest wheel gap (0.3 m)
 *   back, 2.05 m, so that bot is still on the line; a bot level with the
 *   rider, or beside their back wheel, is far enough from its end to be drawn
 *   whole or nearly.
 * - **`gone`, 0.8 m**: wider than the pack's `PACK_ABREAST_METRES` (0.55 m),
 *   so the bot held behind the rider and the one beside it in the row behind
 *   are both gone; wider than the 0.78 m a solo pacer the rider has passed is
 *   drawn off their line on `rider-fade.test.ts`' fixture; and wider than the
 *   camera's near plane (`camera.ts` §`NEAR_PLANE_METRES`, 0.5 m), so no
 *   rider the near plane would cut is still drawn.
 * - **`whole`, 1.6 m**: three places across (1.65 m) is drawn whole. Two
 *   places across, 1.1 m, keeps 3/8 of itself: about two metres in front of
 *   the eye it fills a lower corner of the frame.
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

/** Where a rider is gone, where it is whole, and how far short of the rider the line stops. */
export const RIDER_FADE_METRES = { gone: 0.8, whole: 1.6, clear: 2 } as const;

/**
 * How another rider near the camera is drawn: `'fade'` is the product; `'off'`
 * draws every rider whole wherever it is, as before #2596 — the browser gate's
 * control.
 */
export type RiderFade = 'fade' | 'off';

/** The line {@link riderFaded} measures from, in plan: the eye, and the end `clear` short of the rider. */
export interface RiderFadeLine {
  eyeX: number;
  eyeZ: number;
  endX: number;
  endZ: number;
}

/** A line to write into, so a frame allocates nothing. */
export function emptyRiderFadeLine(): RiderFadeLine {
  return { eyeX: 0, eyeZ: 0, endX: 0, endZ: 0 };
}

/**
 * The line for a frame drawn from `pose`, written into `into`: from the eye
 * `camera.ts` §`cameraRig` places for that pose — taken from it, not
 * restated, so the fade measures from wherever the camera really stands —
 * toward the frame's own rider, or the pose's point when the frame carries
 * none, stopping `clear` short. A rider nearer the eye than `clear` leaves
 * the line its eye alone.
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
  const toX = (rider?.x ?? pose.x) - eyeX;
  const toZ = (rider?.z ?? pose.z) - eyeZ;
  const length = Math.hypot(toX, toZ);
  const reach = Math.max(0, length - RIDER_FADE_METRES.clear) / (length > 0 ? length : 1);
  into.eyeX = eyeX;
  into.eyeZ = eyeZ;
  into.endX = eyeX + toX * reach;
  into.endZ = eyeZ + toZ * reach;
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
  const alongX = line.endX - line.eyeX;
  const alongZ = line.endZ - line.eyeZ;
  const span = alongX * alongX + alongZ * alongZ;
  const offX = marker.x - line.eyeX;
  const offZ = marker.z - line.eyeZ;
  const share = span > 0 ? Math.min(1, Math.max(0, (offX * alongX + offZ * alongZ) / span)) : 0;
  const distance = Math.hypot(offX - alongX * share, offZ - alongZ * share);
  const { gone, whole } = RIDER_FADE_METRES;
  return Math.min(1, Math.max(0, (whole - distance) / (whole - gone)));
}
