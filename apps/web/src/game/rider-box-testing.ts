// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the camera's near plane would cut a drawn rider — #3198. Test
 * support, never shipped: what `rider-fade.test.ts` sweeps a rider about the
 * eye with, and what `capture-lap-race-wiring.test.tsx` asks of every bot on
 * every frame of the demo video's lap race.
 */

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  RIDER_HALF_WIDTH_METRES,
  RIDER_HEIGHT_METRES,
} from './bicycle';
import type { RigPoint } from './camera';
import { triangleMeets, type NearPyramid } from './near-field';
import type { RiderMarker } from './port';

/**
 * #3198: what a drawn rider stands in, in the world, as two boxes from
 * `bicycle.ts`' rider and {@link BOX_MARGIN_METRES} more on every side, for
 * the lean, the pedalling and a realistic body:
 *
 * - the bicycle and the legs, from its back tyre to its front one, as wide as
 *   its bars, and up to the hips ({@link LEGS_TOP_METRES});
 * - the upper body, from the hips back to the bars forward
 *   ({@link BODY_BACK_METRES}, {@link BODY_FRONT_METRES}), up to the top of
 *   the helmet.
 *
 * Each box as its twelve triangles.
 */
const BOX_MARGIN_METRES = 0.1;
/** `bicycle.ts` §`HIP_Y`, 0.97 m: the top of the legs. */
const LEGS_TOP_METRES = 0.97;
/** `bicycle.ts` §`HIP_Z`, 0.26 m behind the marker, and §`HEAD_TUBE_TOP_Z`, the bars, 0.34 m in front. */
const BODY_BACK_METRES = -0.26;
const BODY_FRONT_METRES = 0.34;

function boxTriangles(
  at: RiderMarker,
  roadY: number,
  from: number,
  to: number,
  top: number,
): readonly (readonly RigPoint[])[] {
  const half = RIDER_HALF_WIDTH_METRES + BOX_MARGIN_METRES;
  const corner = (along: number, across: number, up: number): RigPoint => ({
    x: at.x + at.headingX * along - at.headingZ * across,
    y: roadY + up,
    z: at.z + at.headingZ * along + at.headingX * across,
  });
  const c = [from - BOX_MARGIN_METRES, to + BOX_MARGIN_METRES].flatMap((along) =>
    [-half, half].flatMap((across) =>
      [0, top + BOX_MARGIN_METRES].map((up) => corner(along, across, up)),
    ),
  );
  // Corners by bit: along 4, across 2, up 1. Each face as two triangles.
  const faces = [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ];
  return faces.flatMap(([a, b, d, e]) => [
    [c[a as number], c[b as number], c[d as number]] as RigPoint[],
    [c[a as number], c[d as number], c[e as number]] as RigPoint[],
  ]);
}

function riderTriangles(at: RiderMarker, roadY: number): readonly (readonly RigPoint[])[] {
  return [
    ...boxTriangles(
      at,
      roadY,
      BICYCLE_FRONT_METRES - BICYCLE_LENGTH_METRES,
      BICYCLE_FRONT_METRES,
      LEGS_TOP_METRES,
    ),
    ...boxTriangles(at, roadY, BODY_BACK_METRES, BODY_FRONT_METRES, RIDER_HEIGHT_METRES),
  ];
}

/**
 * Whether the near plane would cut a drawn rider: whether any triangle of its
 * two boxes, standing on the road at its own `y`, meets `pyramid`
 * (`near-field.ts` §`nearPyramid`). Faces only, which is enough: the eye
 * stands 2 m over the road (`camera.ts` §`CAMERA_ABOVE_METRES`), above either
 * box's top, so no box can hold the whole solid inside it.
 */
export function riderBoxCut(at: RiderMarker, pyramid: NearPyramid): boolean {
  return riderTriangles(at, at.y).some(([a, b, c]) =>
    triangleMeets(a as RigPoint, b as RigPoint, c as RigPoint, pyramid),
  );
}
