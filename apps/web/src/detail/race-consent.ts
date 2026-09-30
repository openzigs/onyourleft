// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Whether a ride may be offered as another rider's ghost**, as far as its
 * own rider's privacy zones decide it — ADR 0021 D-5.2, ADR 0039 D-2.2 (#793).
 *
 * > *"An attempt whose trimmed portion overlaps the raced route at all is not
 * > offered as a ghost … A partial ghost is worse than none."*
 *
 * That is the `routes/share.ts` §`RouteShare.usable` precedent: a route that
 * begins inside a zone cannot be shared at all, because a trimmed copy is no
 * longer the route. A ghost is the same shape one step further — it replays
 * a rider's distance against time along the route, so where a zone touches
 * the route the replay says how fast somebody rode past their own front door,
 * and a ghost that went quiet there would draw a circle round it. So the
 * answer is a refusal of the whole attempt, never a trim.
 *
 * ## The radius it refuses at is the WIDEST a trim can reach
 *
 * `privacy.ts` jitters each zone's trim radius by up to
 * ±{@link TRIM_JITTER_FRACTION}, keyed on the ride, so that two shared rides
 * do not hand an observer two exact boundaries. A refusal keyed the same way
 * would reintroduce that: the same route offered for one attempt and refused
 * for the next, a yes/no per ride an observer could average. So the refusal
 * uses one radius per zone for every ride — `r · (1 + TRIM_JITTER_FRACTION)`,
 * the furthest any trim of that zone reaches — which is both constant and
 * never smaller than the trim it stands for.
 *
 * ## Along the road, not only at its samples
 *
 * A route's profile is a list of points, and a zone can sit between two of
 * them; a test that only looked at the samples would pass a zone that the road
 * runs straight through. Each leg of the route is tested against each disc,
 * in a local flat frame around the zone's centre — at the size of a privacy
 * zone (hundreds of metres) the flat-earth error is far below a metre.
 *
 * ## Where this runs, and what it cannot see
 *
 * It needs the SOURCE rider's zones, which never leave that rider's device
 * (ADR 0004), so it runs there: the ride's own page says, beside the consent,
 * that this ride will not be offered. ⚠️ **Nothing in this build offers a
 * cross-rider ghost at all** — #331 is the first caller that decides an
 * offer, and it must ask this, not only the consent flag the store's
 * `listRaceableAttempts` reads.
 */

import {
  distanceBetween,
  EARTH_MEAN_RADIUS_METRES,
  type GeographicPosition,
} from '@onyourleft/domain';
import type { PrivacyZoneRecord } from '@onyourleft/store';

import { TRIM_JITTER_FRACTION } from './privacy';

/** One zone, as far as the refusal is concerned: where, and how wide. */
export type RaceZone = Pick<PrivacyZoneRecord, 'centre' | 'radius'>;

/** The widest radius any trim of this zone can have — the jitter at its top. */
export function widestTrimRadius(zone: RaceZone): number {
  return zone.radius * (1 + TRIM_JITTER_FRACTION);
}

const RADIANS_PER_DEGREE = Math.PI / 180;

/** `point` in metres east and north of `origin`, in a flat frame around it. */
function localMetres(
  origin: GeographicPosition,
  point: GeographicPosition,
): { x: number; y: number } {
  const cosLatitude = Math.cos(origin.latitude * RADIANS_PER_DEGREE);
  // Longitude wraps: the short way round, so a zone on the antimeridian works.
  const dLongitude = ((point.longitude - origin.longitude + 540) % 360) - 180;
  return {
    x: dLongitude * RADIANS_PER_DEGREE * EARTH_MEAN_RADIUS_METRES * cosLatitude,
    y: (point.latitude - origin.latitude) * RADIANS_PER_DEGREE * EARTH_MEAN_RADIUS_METRES,
  };
}

/** How close the leg from `a` to `b` comes to the zone's centre, in metres. */
function legDistanceToCentre(
  centre: GeographicPosition,
  a: GeographicPosition,
  b: GeographicPosition,
): number {
  const p = localMetres(centre, a);
  const q = localMetres(centre, b);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(p.x * dx + p.y * dy) / lengthSquared));
  return Math.hypot(p.x + t * dx, p.y + t * dy);
}

/**
 * Whether any of the rider's zones, at its widest trim, touches the raced
 * route — on a sample, or anywhere along the road between two.
 *
 * A route with one point is tested at that point; a route with none touches
 * nothing (and is not a route anybody could race on).
 */
export function trimTouchesRoute(
  route: readonly GeographicPosition[],
  zones: readonly RaceZone[],
): boolean {
  if (route.length === 0 || zones.length === 0) return false;
  for (const zone of zones) {
    const reach = widestTrimRadius(zone);
    const [only] = route;
    if (route.length === 1 && only !== undefined) {
      if (distanceBetween(zone.centre, only) <= reach) return true;
      continue;
    }
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1];
      const b = route[index];
      if (a === undefined || b === undefined) continue;
      if (legDistanceToCentre(zone.centre, a, b) <= reach) return true;
    }
  }
  return false;
}

/**
 * Whether an attempt may be offered as a ghost on this route, as far as its
 * rider's zones decide: `false` whenever {@link trimTouchesRoute}. The consent
 * is a separate condition — this answers only ADR 0021 D-5.2's half.
 */
export function offeredAsGhost(
  route: readonly GeographicPosition[],
  zones: readonly RaceZone[],
): boolean {
  return !trimTouchesRoute(route, zones);
}
