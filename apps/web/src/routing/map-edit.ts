// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route planner on a map — [#2006](https://github.com/openzigs/onyourleft/issues/2006).
 *
 * What the map shows of a draft, and which leg a pull on the line meant. Pure,
 * like the rest of `routing/`: a map reports a gesture as places
 * (`map/port.ts` §`MapPointerHandlers`), and every decision about what that
 * gesture does to the route is made here, where a test can ask it without a
 * map.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';

import type { MapWaypoint } from '../map/port';
import type { TrackBounds, TrackGeometry } from '../map/track';
import type { DraftLeg, RouteDraft } from './draft';
import { endsAtStart } from './loop';

/**
 * Where the planner's map looks before there is a waypoint: the contiguous
 * United States, which is what the published archive covers (`map/basemap.ts`
 * §`PUBLISHED_BASEMAP_URL`).
 *
 * ⚠️ **Not the rider's position.** Nothing on this screen asks the device
 * where it is; the rider pans and zooms to their own roads and taps.
 */
export const EMPTY_PLANNER_VIEW: TrackBounds = { west: -125, south: 24, east: -66, north: 50 };

/**
 * A leg's line: its routed shape when it has one, and otherwise the straight
 * line between its two waypoints, which is the line a freehand leg is anyway.
 */
function legLine(
  leg: DraftLeg,
  from: GeographicPosition,
  to: GeographicPosition,
): readonly GeographicPosition[] {
  return leg.state === 'routed' && leg.shape.length >= 2 ? leg.shape : [from, to];
}

/**
 * The draft's line, one part per leg, in the order the legs run.
 *
 * `undefined` with fewer than two waypoints: there is no line, and a lone
 * waypoint is drawn as its marker.
 */
export function draftGeometry(draft: RouteDraft): TrackGeometry | undefined {
  if (draft.legs.length === 0) return undefined;
  return {
    type: 'MultiLineString',
    coordinates: draft.legs.map((leg, index) =>
      legLine(leg, draft.waypoints[index]!.position, draft.waypoints[index + 1]!.position).map(
        (position) => [position.longitude, position.latitude] as const,
      ),
    ),
  };
}

/** The waypoints, as the map draws them. */
export function mapWaypoints(draft: RouteDraft): readonly MapWaypoint[] {
  // #2102: a closed loop's last waypoint sits on the first and is drawn over
  // it, so it shows "1" too — start and finish, one marker — rather than
  // hiding the start under its own number. It is numbered again once it moves.
  const closed = endsAtStart(draft);
  const last = draft.waypoints.length - 1;
  return draft.waypoints.map(({ id, position }, index) => ({
    id,
    position,
    label: closed && index === last ? '1' : String(index + 1),
  }));
}

/**
 * Which leg's line passes closest to `position`: the leg a pull on the line
 * that began there was a pull on. `undefined` when there is no leg.
 *
 * Distances are on a local flat projection, longitude scaled by the cosine of
 * the latitude — exact enough to tell one leg from its neighbour, which is the
 * only question asked.
 */
export function nearestLeg(draft: RouteDraft, position: GeographicPosition): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const scale = Math.cos((position.latitude * Math.PI) / 180);
  const flat = (point: GeographicPosition): readonly [number, number] => [
    point.longitude * scale,
    point.latitude,
  ];
  const [px, py] = flat(position);
  draft.legs.forEach((leg, index) => {
    const line = legLine(
      leg,
      draft.waypoints[index]!.position,
      draft.waypoints[index + 1]!.position,
    );
    for (let at = 1; at < line.length; at += 1) {
      const [ax, ay] = flat(line[at - 1]!);
      const [bx, by] = flat(line[at]!);
      const dx = bx - ax;
      const dy = by - ay;
      const length = dx * dx + dy * dy;
      const t =
        length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
  });
  return best;
}

/**
 * Halfway between a leg's two waypoints: where the keyboard's *Add a waypoint
 * halfway along* puts one, the list's way to do what pulling the line does.
 */
export function legMidpoint(draft: RouteDraft, legIndex: number): GeographicPosition | undefined {
  const from = draft.waypoints[legIndex]?.position;
  const to = draft.waypoints[legIndex + 1]?.position;
  if (from === undefined || to === undefined) return undefined;
  return geographicPosition(
    degreesLatitude((from.latitude + to.latitude) / 2),
    degreesLongitude((from.longitude + to.longitude) / 2),
  );
}
