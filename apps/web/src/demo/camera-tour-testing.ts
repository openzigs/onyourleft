// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a point lands in the frame a `CameraPose` draws — for
 * `camera-tour.test.ts` and `DemoPage.test.tsx` (#1649).
 *
 * The renderer's own projection, written out: `camera.ts` §`cameraRig` for
 * the eye and the point looked at, three's `lookAt` with `+y` up for the
 * camera's axes, and `camera.ts` §`verticalHalfTangent` for the lens. It is
 * not the director's arithmetic, so a director that aims wrong lands its
 * rider off-centre here.
 */

import { cameraRig, verticalHalfTangent, type RigPoint } from '../game/camera';
import type { CameraPose } from '../game/port';

/** A point in the frame: `-1` to `1` across and up, and its depth along the view. */
export interface Projected {
  readonly x: number;
  readonly y: number;
  /** Metres along the view axis; nought or less is behind the eye. */
  readonly depth: number;
}

const minus = (a: RigPoint, b: RigPoint): RigPoint => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const dot = (a: RigPoint, b: RigPoint): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: RigPoint, b: RigPoint): RigPoint => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: RigPoint): RigPoint => {
  const length = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};

/** Where `point` lands in a frame of `aspect` drawn from `pose`. */
export function projectThrough(pose: CameraPose, point: RigPoint, aspect: number): Projected {
  const rig = cameraRig(pose);
  const forward = unit(minus(rig.target, rig.eye));
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const offset = minus(point, rig.eye);
  const depth = dot(offset, forward);
  const t = verticalHalfTangent(aspect);
  return {
    x: dot(offset, right) / (depth * t * aspect),
    y: dot(offset, up) / (depth * t),
    depth,
  };
}

/** Whether a projected point is on screen: in front of the eye, inside the frame. */
export function inFrame(projected: Projected): boolean {
  return projected.depth > 0 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
}
