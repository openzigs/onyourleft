// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A new view's drawn path, eased in from the one drawn before it** — #2989,
 * for ADR 0089 C-6 on the drawn path.
 *
 * ## Why
 *
 * `racing-line.ts` solves its least-peak-curvature line over the whole
 * profile, so on an open-world view the line the rider is drawn on, and the
 * camera stood behind them on it, sets up for a junction's turn more than
 * 100 m before it. A choice made before the lock (ADR 0087 D-6.2) swaps the
 * tail past the junction, the view is a new profile, and its line is solved
 * again: measured on #2982's rolling route, a left turn swapped for a right
 * moved the drawn camera by 0.31 m (eye) and 0.74 m (target) at 101 m before
 * the junction, on the frame the choice was made. The camera stood on the
 * road's own centreline did not move at all, so ADR 0089's argument holds for
 * the road and not for the path.
 *
 * ## What is done
 *
 * When the view changes, the path last drawn is held, and the new view's line
 * is reached from it over the next {@link LINE_EASE_METRES} ridden: each frame
 * draws `(1 − w) · held + w · new`, sample by sample, with `w` a smoothstep of
 * the distance ridden since the change. On the frame of the change `w` is
 * nought, so the path drawn is the one drawn the frame before, to rounding.
 *
 * - **Sample by sample, one weight.** `drawn-line.ts` evaluates its spline
 *   from a sample's value and second derivative and its neighbour's, and both
 *   are linear in those arrays, so a blend of the two lines' arrays at ONE
 *   weight is exactly the blend of the two paths: as smooth as either.
 * - **Where the two are the same road.** A sample is blended only where the
 *   old view had a sample at the same ride distance and in the same place;
 *   anywhere else (past the junction a choice swapped, past the old view's
 *   end) the new line is drawn as it is. The rider and the camera read the
 *   path at most about 50 m ahead of the odometer, and a choice is final
 *   100 m before its junction, so nothing that reads a blended sample reads
 *   the swapped road.
 * - **In the new view's frame.** A view's local metres are its first
 *   sample's (`terrain.ts` §`corridorOrigin`), and a trim moves it, so the
 *   held path is put in the new frame through the same projection: an x
 *   scaled by the ratio of the two origins' cosines, and both shifted.
 * - **Not after a U-turn.** A U-turn changes the road under the rider at once
 *   (ADR 0088 D-1.6), so the held path is on a road the rider has left. The
 *   new line is drawn at once, and the camera's own damping turns the view.
 *
 * ⚠️ **A drawing, never physics** — `drawn-line.ts`' rule, unchanged. The
 * odometer, the grade and the recording never read this.
 *
 * Pure: no clock, no `three`, no DOM.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';

import type { DrawnLine } from '../drawn-line';
import { corridorOrigin, localGroundPosition, type CorridorOrigin } from '../terrain';

/**
 * How far the rider rides while a new view's line is eased in: **50 m**.
 * *#2989's choice.* A choice is final 100 m before its junction, so an ease
 * begun by the latest choice there is is over 50 m before it, before the
 * camera has turned for it; and over 50 m the largest move measured, 0.74 m
 * at the camera's target, is a drift of under a degree.
 */
export const LINE_EASE_METRES = 50;

/** A drawn path, held in the place it was drawn: its view's arrays, frame and samples. */
export interface HeldLine {
  /** The rolling route's sample index of the arrays' first entry: its view's origin over the spacing. */
  readonly firstSample: number;
  /** The frame its local metres are in. */
  readonly frame: CorridorOrigin;
  /** Where each of its samples is: a sample is blended only where the new view's is the same place. */
  readonly positions: readonly GeographicPosition[];
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly bendXs: Float64Array;
  readonly bendZs: Float64Array;
  readonly shifts: Float64Array;
  readonly offsets: Float64Array;
  readonly curvatures: Float64Array;
}

/** The rolling route's sample index of `profile`'s first sample, for a view whose distance zero is `origin`. */
function firstSampleOf(profile: RouteProfile, origin: number): number {
  return Math.round(origin / (profile.resolution as number));
}

/** `line`, drawn on a view whose distance zero is ride distance `origin`, held. */
export function heldLine(line: DrawnLine, origin: number): HeldLine {
  return {
    firstSample: firstSampleOf(line.profile, origin),
    frame: corridorOrigin(line.profile),
    positions: line.profile.positions,
    xs: line.xs,
    zs: line.zs,
    bendXs: line.bendXs,
    bendZs: line.bendZs,
    shifts: line.shifts,
    offsets: line.offsets,
    curvatures: line.curvatures,
  };
}

/** How far into the ease a rider `ridden` metres past its start is: a smoothstep from 0 to 1. */
export function easeWeight(ridden: number): number {
  const share = Math.max(0, Math.min(1, ridden / LINE_EASE_METRES));
  return share * share * (3 - 2 * share);
}

/**
 * The path to draw on `to`'s view, whose distance zero is ride distance
 * `origin`: `weight` of the way from `held` to `to`. At a weight of 1, `to`
 * itself. @see the module note
 */
export function easedLine(
  held: HeldLine,
  to: DrawnLine,
  origin: number,
  weight: number,
): DrawnLine {
  if (!(weight < 1)) return to;
  const profile = to.profile;
  const count = to.xs.length;
  const frame = corridorOrigin(profile);
  // `terrain.ts` §`localGroundPosition` is `x = (lon₀ − lon) · K`,
  // `z = (lat − lat₀) · M`, with `K` the metres in a degree of longitude at
  // the origin's latitude. So from `held.frame` to `frame` a point moves by
  // where the held frame's origin is in the new one, and its x is scaled by
  // `K' / K`; both read off the projection itself.
  const place = (latitude: number, longitude: number): GeographicPosition =>
    geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
  const shift = localGroundPosition(frame, place(held.frame.latitude, held.frame.longitude));
  const degreeAcross = (at: CorridorOrigin): number =>
    localGroundPosition(at, place(at.latitude, at.longitude - 1)).x;
  const scaleX = degreeAcross(frame) / degreeAcross(held.frame);
  const xs = new Float64Array(to.xs);
  const zs = new Float64Array(to.zs);
  const bendXs = new Float64Array(to.bendXs);
  const bendZs = new Float64Array(to.bendZs);
  const shifts = new Float64Array(to.shifts);
  const offsets = new Float64Array(to.offsets);
  const curvatures = new Float64Array(to.curvatures);
  const keep = 1 - weight;
  const offset = firstSampleOf(profile, origin) - held.firstSample;
  for (let sample = 0; sample < count; sample += 1) {
    const from = sample + offset;
    const was = held.positions[from];
    const is = profile.positions[sample];
    if (
      was === undefined ||
      is === undefined ||
      from >= held.xs.length ||
      was.latitude !== is.latitude ||
      was.longitude !== is.longitude
    ) {
      continue;
    }
    const blend = (into: Float64Array, value: number): void => {
      into[sample] = keep * value + weight * (into[sample] as number);
    };
    blend(xs, (held.xs[from] as number) * scaleX + shift.x);
    blend(zs, (held.zs[from] as number) + shift.z);
    blend(bendXs, (held.bendXs[from] as number) * scaleX);
    blend(bendZs, held.bendZs[from] as number);
    blend(shifts, held.shifts[from] as number);
    blend(offsets, held.offsets[from] as number);
    blend(curvatures, held.curvatures[from] as number);
  }
  return { profile, offsets, curvatures, xs, zs, bendXs, bendZs, shifts };
}
