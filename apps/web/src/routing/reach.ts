// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a routed leg reaches the two waypoints it was asked for (#3179).
 *
 * Valhalla snaps each waypoint to the nearest road its graph holds, and it
 * looks a long way for one: the in-browser SDK fixes a 30 m radius with no
 * reachability floor, and the instance sends no search cut-off, so a waypoint
 * where the graph has no roads (outside the region it was built from, though
 * inside its coverage rectangle; open water; a hole in the data) is moved to a
 * road that can be tens of kilometres away. The answer is then an ordinary
 * routed leg whose line never comes near the pin the rider put down, with a
 * distance and climbing for somewhere else.
 *
 * A leg whose line starts or ends further than {@link WAYPOINT_REACH_METRES}
 * from its waypoint is therefore not a road between them, and each tier says
 * so with a `FreehandFallback` (`draft.ts`) of its own (`valhalla-browser-provider.ts`
 * for the in-browser engine, `tiers.ts` for the instance's answer): the planner
 * draws that leg straight with the reason on it, never as "Following roads".
 */

import { distanceBetween, type GeographicPosition, type RoutedLeg } from '@onyourleft/domain';

/**
 * How far a leg's line may start or end from its waypoint: **300 m**, a few
 * hundred metres as #3179 asks. A pin dropped beside a road on the basemap
 * snaps to it within tens of metres (the contract suite allows 30 m on the
 * synthetic grid); a pin in a field or a car park a short walk from a road
 * still routes; a pin with no road for kilometres does not.
 */
export const WAYPOINT_REACH_METRES = 300;

/** Whether `leg` starts within reach of `from` and ends within reach of `to`. */
export function reachesItsWaypoints(
  leg: RoutedLeg,
  from: GeographicPosition,
  to: GeographicPosition,
): boolean {
  const first = leg.shape[0];
  const last = leg.shape.at(-1);
  return (
    first !== undefined &&
    last !== undefined &&
    distanceBetween(first, from) <= WAYPOINT_REACH_METRES &&
    distanceBetween(last, to) <= WAYPOINT_REACH_METRES
  );
}
