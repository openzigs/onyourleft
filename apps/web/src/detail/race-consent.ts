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
 * that this ride will not be offered, and the sync asks it again before every
 * offer it sends (#331, {@link raceRouteOffer}): an offer reaches the
 * instance only when the consent is given AND this answers yes.
 */

import {
  distanceBetween,
  EARTH_MEAN_RADIUS_METRES,
  toHex,
  type GeographicPosition,
  type RouteProfile,
  type Sha256,
} from '@onyourleft/domain';
import { encodeGpxRoute } from '@onyourleft/fit';
import type {
  ActivityId,
  ActivityStore,
  AthleteId,
  PrivacyZoneRecord,
  RouteRecord,
} from '@onyourleft/store';

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

/**
 * **The text a route is raced by** (#331): the route writer's GPX with no name
 * and no times, as a room's route is written (`rooms/share.ts`). Two riders
 * who imported the same file hold the same profile — a decode is
 * deterministic — and so write the same text. Its SHA-256 is the only way a
 * ghost is asked for (`instance/ghost-port.ts`) and the only way one is
 * offered ({@link raceRouteOffer}); the route itself is never sent.
 *
 * ⚠️ **Exact, or not the same route.** A route written out and read back is
 * resampled, and lands a digit away in the seventh decimal of a few points,
 * so a copy made that way is a different text and finds no ghost. That is the
 * safe failure: a near match would put a ghost on a road its rider did not
 * ride, and a fuzzy key would answer for routes the asker does not hold.
 */
export function raceRouteText(profile: RouteProfile): string {
  return encodeGpxRoute({ name: undefined, profile }).text;
}

/** {@link raceRouteText}'s SHA-256, lower-case hex: the route's name on the instance. */
export async function raceRouteDigest(profile: RouteProfile, sha256: Sha256): Promise<string> {
  return toHex(await sha256(new TextEncoder().encode(raceRouteText(profile))));
}

/**
 * The route a ride is offered to be raced on, as its digest, or `null` for
 * none (#331) — what the device that signed the ride tells the instance
 * (`instance/sync.ts` §"A ride's race offer").
 *
 * All three conditions, and `null` unless each holds:
 *
 * 1. the rider consented (the ride's `mayBeRaced`, ADR 0021 D-5.1);
 * 2. the ride was on a route this device still holds;
 * 3. no privacy zone of the rider's, at its widest trim, touches that route
 *    ({@link offeredAsGhost}, ADR 0021 D-5.2). The zones never leave this
 *    device, so this is where their answer is given, and a zone added after
 *    the consent withdraws the offer at the next sync.
 */
export async function raceRouteOffer(input: {
  readonly mayBeRaced: boolean;
  readonly route: Pick<RouteRecord, 'profile'> | undefined;
  readonly zones: readonly RaceZone[];
  readonly sha256: Sha256;
}): Promise<string | null> {
  if (!input.mayBeRaced || input.route === undefined) return null;
  if (!offeredAsGhost(input.route.profile.positions, input.zones)) return null;
  return raceRouteDigest(input.route.profile, input.sha256);
}

/**
 * {@link raceRouteOffer} for one of `athlete`'s rides, read from `store` —
 * what `main.tsx` hands the sync. `null` for a ride this athlete does not
 * hold, and for a ride on no route.
 */
export function raceRouteOf(
  store: Pick<ActivityStore, 'getActivity' | 'getRoute' | 'listPrivacyZones'>,
  athlete: AthleteId,
  sha256: Sha256,
): (activity: ActivityId) => Promise<string | null> {
  return async (activity) => {
    const ride = await store.getActivity(athlete, activity);
    if (ride === undefined || ride.routeId === undefined) return null;
    return raceRouteOffer({
      mayBeRaced: ride.mayBeRaced,
      route: await store.getRoute(athlete, ride.routeId),
      zones: await store.listPrivacyZones(athlete),
      sha256,
    });
  };
}
