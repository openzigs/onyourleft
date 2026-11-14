// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a Delivery round's houses and their markers stand on the screen —
 * #2514, the owner's report from the tablet: "It is hard to see when throwing
 * the packages due to all side menus."
 *
 * A house a round can take stands with its front step beside the road, from
 * the carriageway's edge (`throw.ts` §`CARRIAGEWAY_HALF_WIDTH_METRES`) out to
 * the throw's reach (`targets.ts` §`TARGET_MOST_FROM_ROAD_METRES`), and its
 * marker rises {@link MARKER_TOP_METRES} above the ground. The rider sees it
 * coming from #2453's {@link SIGHTED_FROM_METRES} and throws at it as it
 * passes: {@link NEAREST_AHEAD_METRES} ahead is about where a house at the
 * reach leaves the frame. Each band is that volume on one side of the road,
 * projected through the chase camera on a straight, level road
 * (`camera.ts` §`cameraRig`, §`projectToFrame`, the projection the renderer
 * sets up), as the rectangle that bounds it, cut to the frame. Pixels of the
 * viewport, as the stage measures its panels.
 *
 * ⚠️ **A straight, level road.** On a bend the camera turns after the road
 * (`camera.ts` §`dampedHeading`) and a hill tips it, so a band on a ride
 * moves; and the rider steers across the road (`delivery/steer.ts`), which
 * the camera follows. These are the bands of the road a round is mostly
 * ridden on, not a promise about every frame.
 */

import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  THROW_WINDOW_BEFORE_METRES,
} from '../src/game/delivery/throw';
import { TARGET_MOST_FROM_ROAD_METRES } from '../src/game/delivery/targets';
import { CAMERA_TARGET_AHEAD_METRES, cameraRig, projectToFrame } from '../src/game/camera';

/** #2453's sighting distance: a house is seen coming from here. */
export const SIGHTED_FROM_METRES = 100;

/** The nearest ahead a house is held in the band: about where one at the throw's reach leaves the frame. */
export const NEAREST_AHEAD_METRES = 5;

/** How high a house's marker stands, metres: its 2.4 m post and its diamond (#2453). */
export const MARKER_TOP_METRES = 3;

/** A rectangle in viewport pixels. */
export interface Band {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The distances ahead the volume is sampled at: its two ends and the throw window's opening between. */
const AHEAD = [NEAREST_AHEAD_METRES, THROW_WINDOW_BEFORE_METRES, SIGHTED_FROM_METRES] as const;

/**
 * The left and right roadside bands at this viewport. @see the module header
 *
 * Throws where a band would be empty, because "no panel overlaps a rectangle
 * of no size" is true of every layout there is.
 */
export function roadsideBands(viewport: { readonly width: number; readonly height: number }): {
  readonly left: Band;
  readonly right: Band;
} {
  const aspect = viewport.width / viewport.height;
  const rig = cameraRig({
    x: 0,
    y: 0,
    z: 0,
    headingX: 0,
    headingZ: 1,
    eyeRoadY: 0,
    targetRoadY: 0,
    targetAheadMetres: CAMERA_TARGET_AHEAD_METRES,
  });
  const band = (side: 1 | -1): Band => {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const ahead of AHEAD) {
      for (const across of [CARRIAGEWAY_HALF_WIDTH_METRES, TARGET_MOST_FROM_ROAD_METRES]) {
        for (const up of [0, MARKER_TOP_METRES]) {
          // The frame's right is the road's normal (−headingZ, headingX): −x here.
          const seen = projectToFrame(rig, aspect, { x: -side * across, y: up, z: ahead });
          if (seen === undefined) continue;
          left = Math.min(left, seen.left * viewport.width);
          right = Math.max(right, seen.left * viewport.width);
          top = Math.min(top, seen.top * viewport.height);
          bottom = Math.max(bottom, seen.top * viewport.height);
        }
      }
    }
    const cut: Band = {
      left: Math.max(0, left),
      right: Math.min(viewport.width, right),
      top: Math.max(0, top),
      bottom: Math.min(viewport.height, bottom),
    };
    if (!(cut.right - cut.left > 10 && cut.bottom - cut.top > 10)) {
      throw new Error(`a roadside band is not a usable rectangle: ${JSON.stringify(cut)}`);
    }
    return cut;
  };
  return { left: band(-1), right: band(1) };
}
