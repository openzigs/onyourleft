// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One Delivery house marker, or one lap-race pick-up point, a long way up the
 * owner's realistic page's road — #2453, for the owner's report of
 * 2026-11-10 that on the tablet's realistic world neither could be seen.
 *
 * The page's `?delivery=` and `?race=` frames stand every piece within about
 * 50 m of the rider, which is where both always read. What the rider needs is
 * to see them coming: a house to aim at, a pick-up point to steer for. So
 * `realistic.html` §`__oylRealisticSighting` draws the page's own held frame
 * once with no piece and once with ONE piece placed here, and counts the
 * pixels the piece changed (`changedPixels`), as `lap-race-harness.ts`
 * §`pickUpSeen` (#1969) counts one pick-up point on the stylised road.
 *
 * ⚠️ **Placements, not a round or a race.** The marker stands where a house's
 * front step does — beside the road, past its pavement, at the road's height
 * — and the pick-up point where `lap-race/in-view.ts` puts one: across the
 * road's centre. Nothing here picks a house or runs a race.
 */

import { createItemRace, raceCourse } from '@onyourleft/domain';

import { lapRaceInView } from '../../src/game/lap-race/in-view';
import type { DeliveryInView, LapRaceInView, SceneFrame } from '../../src/game/port';
import type { CorridorPoint } from '../../src/game/terrain';

/**
 * How far right of the road's centre the sighted marker stands, metres:
 * **8**, a front step past the 3.5 m half carriageway and the village's
 * pavement, inside `delivery/targets.ts` §`TARGET_MOST_FROM_ROAD_METRES`' 12.
 */
export const SIGHTED_MARKER_ACROSS_METRES = 8;

/** What one piece changed on the frame. @see changedPixels */
export interface Sighting {
  /** Pixels that differ between the frame with the piece and without it. */
  readonly changed: number;
  /** How many rows and columns those pixels span. */
  readonly rows: number;
  readonly columns: number;
}

/** The centreline point nearest `along` on the frame's corridor, and the road's heading there. */
function onRoad(
  centre: readonly CorridorPoint[],
  along: number,
): { readonly at: CorridorPoint; readonly headingX: number; readonly headingZ: number } {
  let index = 0;
  for (let at = 1; at < centre.length; at += 1) {
    const point = centre[at] as CorridorPoint;
    if (Math.abs(point.along - along) < Math.abs((centre[index] as CorridorPoint).along - along)) {
      index = at;
    }
  }
  const at = centre[index] as CorridorPoint;
  if (Math.abs(at.along - along) > 5) {
    throw new RangeError('the sighted piece must stand on the frame’s corridor');
  }
  const from = centre[Math.max(0, index - 1)] as CorridorPoint;
  const to = centre[Math.min(centre.length - 1, index + 1)] as CorridorPoint;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  return {
    at,
    headingX: length > 0 ? (to.x - from.x) / length : 0,
    headingZ: length > 0 ? (to.z - from.z) / length : 1,
  };
}

/**
 * One house marker `aheadMetres` up the road from a rider `riderAlong` metres
 * along it (the odometer, as `CorridorPoint.along` is), standing
 * {@link SIGHTED_MARKER_ACROSS_METRES} to the road's right and facing it.
 */
export function oneMarkerAhead(
  frame: Pick<SceneFrame, 'corridor'>,
  riderAlong: number,
  aheadMetres: number,
): DeliveryInView {
  const { at, headingX, headingZ } = onRoad(frame.corridor.centre, riderAlong + aheadMetres);
  const across = SIGHTED_MARKER_ACROSS_METRES;
  return {
    parcels: [],
    markers: [
      {
        x: at.x - headingZ * across,
        y: at.y,
        z: at.z + headingX * across,
        // Its front toward the road, as `targets.ts` turns a front step.
        yaw: Math.atan2(headingZ, -headingX),
      },
    ],
    obstacles: [],
  };
}

/**
 * One pick-up point `aheadMetres` up the road, placed by the product's own
 * `lapRaceInView`: the first pick-up point of a 400 m lap is a quarter of it,
 * 100 m, into the race, so the race starts `aheadMetres − 100` from the rider.
 */
export function onePickUpAhead(
  frame: Pick<SceneFrame, 'corridor'>,
  riderAlong: number,
  aheadMetres: number,
): LapRaceInView {
  const race = createItemRace({
    course: raceCourse(400, 1),
    seed: 1,
    itemsOn: true,
    racerIds: ['rider'],
    startMs: 0,
  });
  const inView = lapRaceInView({
    corridor: frame.corridor,
    race,
    startAlong: riderAlong + aheadMetres - 100,
  });
  const one = inView.pickUps.slice(0, 1);
  if (one.length !== 1) throw new RangeError('the sighted pick-up point must be on the corridor');
  return { pickUps: one, hazards: [] };
}

/** The pixels that differ between two RGBA readings of a `width` × `height` frame, and their span. */
export function changedPixels(
  without: Uint8Array,
  withIt: Uint8Array,
  width: number,
  height: number,
): Sighting {
  let changed = 0;
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const at = (row * width + column) * 4;
      if (
        withIt[at] !== without[at] ||
        withIt[at + 1] !== without[at + 1] ||
        withIt[at + 2] !== without[at + 2]
      ) {
        changed += 1;
        top = Math.min(top, row);
        bottom = Math.max(bottom, row);
        left = Math.min(left, column);
        right = Math.max(right, column);
      }
    }
  }
  return {
    changed,
    rows: bottom < 0 ? 0 : bottom - top + 1,
    columns: right < 0 ? 0 : right - left + 1,
  };
}
