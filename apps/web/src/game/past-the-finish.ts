// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The road on past a route's end** — [#3336](https://github.com/openzigs/onyourleft/issues/3336).
 *
 * A point-to-point route stops at its end: `distanceOnRoute` clamps, so every
 * corridor point past it lands on the one last point, and a rider still
 * pedalling there (a preview nobody ended, or a rider who chose *Keep riding*
 * at the finish) was drawn in an empty world — grey ground, a few stray road
 * pieces, a lone building. The owner's ruling of 2026-11-26: *Keep riding*
 * extends the road ahead with scenery, so the world is never empty.
 *
 * So once the view reaches toward the end, {@link drawnPastTheFinish} hands
 * the scene the route with a straight, level road added along its final
 * heading, {@link PAST_THE_FINISH_CHUNK_METRES} at a time, and longer again
 * before the rider reaches that end, however long they ride.
 *
 * ## The world short of the end does not move
 *
 * The extension is keyed to its route (`scenery-anchor.ts` §`extendScenery`):
 * the route's seed, its own cells counted on past its end, and everything a
 * whole profile is read for — the waterways, the world's colours, the horizon,
 * the relief, the fields — read off the route. So a frame that starts drawing
 * the extension draws the route's own world up to the end, to the item, and a
 * longer extension draws the shorter one's. `past-the-finish.test.ts` holds
 * the scenery and the ground short of the end to the route's own.
 *
 * ## What it does not change
 *
 * Only the DRAWING. The ride's odometer, the trainer's grade, the HUD's
 * distance to go and the course line (`course-laps.ts`) all read the route
 * itself, as they did; the finish gantry stands at the route's end
 * (`scene.ts` reads `gantry.ts` on the route). ⚠️ The trainer is therefore
 * held at the route's last grade past the end while the road is drawn level:
 * changing what is written to a trainer is a safety question this issue does
 * not open.
 *
 * ## The map past the end
 *
 * A ride in the realistic world has the map read round its route, so the road
 * drawn on can run into a mapped building the route never passed — often the
 * one at a route's end. {@link clearOfTheRoadOn} takes out every mapped
 * building the road on past the end runs through, and no other.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
  type AltitudeMetres,
  type GeographicPosition,
  type GradePercent,
  type RouteProfile,
} from '@onyourleft/domain';

import { mappedBuildingsOf, type MappedBuildings } from './mapped-buildings';
import { extendScenery, extendedRoute, routeOf, sceneryAnchor } from './scenery-anchor';
import { corridorOrigin, localGroundPosition, ROAD_WIDTH_METRES } from './terrain';

/** Metres in a degree of latitude: `terrain.ts`'s projection's own figure. */
const METRES_PER_DEGREE_LATITUDE = 111_320;

/**
 * How much road is added past the end at a time: **10 km**. Each extension is
 * a new profile, and what is built once a profile (the drawn line, the
 * retraced passes) is built again for it, so not a few hundred metres at a
 * time; and not the whole of any ride at once, which would build it for road
 * nobody rides.
 */
export const PAST_THE_FINISH_CHUNK_METRES = 10_000;

/**
 * How much road an extension holds ahead of the rider at least: **1 km**,
 * beyond the corridor's 400 m ahead and the scenery's reach past it, so the
 * road ahead of a rider past the end never stops in the view.
 */
export const DRAWN_ON_AHEAD_METRES = 1_000;

/** How far back from the end the final heading is read over: **50 m**, past a GPS wobble. */
const HEADING_OVER_METRES = 50;

/** The longest extension of each route, kept for as long as the route is. */
const extensions = new WeakMap<
  RouteProfile,
  { readonly chunks: number; readonly profile: RouteProfile }
>();

/**
 * The profile a frame at `odometer` is drawn on — #3336: `route` itself on a
 * loop, on an open-world view (which has its own road ahead), and up to its
 * end; past it, the route with level road on along its final heading, at least
 * {@link DRAWN_ON_AHEAD_METRES} ahead of the rider.
 *
 * ⚠️ **Only past the end, never on the approach to it**, though the road ahead
 * of a rider riding in to the finish stops there in the view as it always
 * has: a frame up to the end is the frame it was before #3336 to the bit, so
 * every gate on the drawing of a route's last stretch (a turnaround's, a
 * hairpin's, the barriers' at the finish) still holds as it did.
 */
export function drawnPastTheFinish(profile: RouteProfile, odometer: number): RouteProfile {
  // An extension handed back in is drawn on from its route, never from itself.
  const route = routeOf(profile);
  if (route.loop || sceneryAnchor(route) !== undefined || !Number.isFinite(odometer)) {
    return profile;
  }
  const end: number = route.totalDistance;
  const wanted = odometer + DRAWN_ON_AHEAD_METRES;
  if (odometer <= end || (profile.totalDistance as number) >= wanted) return profile;
  const chunks = Math.ceil((wanted - end) / PAST_THE_FINISH_CHUNK_METRES);
  const known = extensions.get(route);
  // Never shorter than one already built: a rider who rides on and back sees one road.
  if (known !== undefined && known.chunks >= chunks) return known.profile;
  const built = extended(route, chunks * PAST_THE_FINISH_CHUNK_METRES);
  extensions.set(route, { chunks, profile: built });
  return built;
}

/** `route` with `length` metres of level road on along its final heading. */
function extended(route: RouteProfile, length: number): RouteProfile {
  const resolution: number = route.resolution;
  const positions = route.positions;
  const last = positions[positions.length - 1] as GeographicPosition;
  const heading = finalHeading(route, last);
  if (heading === undefined) return route;
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((last.latitude * Math.PI) / 180);
  const stepLatitude = (heading.north * resolution) / METRES_PER_DEGREE_LATITUDE;
  const stepLongitude = (heading.east * resolution) / metresPerDegreeLongitude;
  const level = route.elevations[route.elevations.length - 1] as AltitudeMetres;
  const flat = gradePercent(0);
  const added: GeographicPosition[] = [];
  const steps = Math.round(length / resolution);
  for (let step = 1; step <= steps; step += 1) {
    const latitude = last.latitude + stepLatitude * step;
    const longitude = last.longitude + stepLongitude * step;
    // A road run off the map's edge stops there, rather than throw in a frame.
    if (Math.abs(latitude) > 89.9 || Math.abs(longitude) > 180) break;
    added.push(geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)));
  }
  if (added.length === 0) return route;
  const profile: RouteProfile = {
    ...route,
    totalDistance: metres((route.totalDistance as number) + added.length * resolution),
    positions: [...positions, ...added],
    elevations: [...route.elevations, ...added.map((): AltitudeMetres => altitudeMetres(level))],
    grades: [...route.grades, ...added.map((): GradePercent => flat)],
  };
  extendScenery(profile, route);
  return profile;
}

/**
 * The direction the route ends in, as a unit vector east and north, read from
 * the last point at least {@link HEADING_OVER_METRES} back — or the farthest,
 * on a route shorter than that; `undefined` where every point is the last.
 */
function finalHeading(
  route: RouteProfile,
  last: GeographicPosition,
): { readonly east: number; readonly north: number } | undefined {
  const positions = route.positions;
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((last.latitude * Math.PI) / 180);
  let found: { readonly east: number; readonly north: number; readonly length: number } | undefined;
  for (let index = positions.length - 2; index >= 0; index -= 1) {
    const back = positions[index] as GeographicPosition;
    const east = (last.longitude - back.longitude) * metresPerDegreeLongitude;
    const north = (last.latitude - back.latitude) * METRES_PER_DEGREE_LATITUDE;
    const length = Math.hypot(east, north);
    if (length > 0) found = { east, north, length };
    if (length >= HEADING_OVER_METRES) break;
  }
  if (found === undefined) return undefined;
  return { east: found.east / found.length, north: found.north / found.length };
}

/**
 * How far either side of the road drawn on a mapped building may not stand:
 * half the road and a metre, so the carriageway runs clear of every wall.
 */
const CLEAR_OF_THE_ROAD_ON_METRES = ROAD_WIDTH_METRES / 2 + 1;

/** Each ride's mapped buildings, cleared off each extension of its route. */
const clearedOff = new WeakMap<MappedBuildings, WeakMap<RouteProfile, MappedBuildings>>();

/**
 * `buildings` without the ones the road drawn on past the end of `drawn`'s
 * route runs through — #3336: any whose outline comes within
 * {@link CLEAR_OF_THE_ROAD_ON_METRES} of that road past the end. A building
 * beside the route, or behind its end, is kept, as is every one on a profile
 * that is not drawn on: then `buildings` itself.
 */
export function clearOfTheRoadOn(buildings: MappedBuildings, drawn: RouteProfile): MappedBuildings {
  const route = extendedRoute(drawn);
  if (route === undefined) return buildings;
  let byDrawn = clearedOff.get(buildings);
  if (byDrawn === undefined) {
    byDrawn = new WeakMap();
    clearedOff.set(buildings, byDrawn);
  }
  const known = byDrawn.get(drawn);
  if (known !== undefined) return known;
  const origin = corridorOrigin(route);
  const from = localGroundPosition(origin, positionAtEnd(route));
  const to = localGroundPosition(origin, positionAtEnd(drawn));
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const kept =
    length > 0
      ? buildings.plans.filter(
          (plan) =>
            !onTheRoadOn(plan.footprint, from, {
              x: (to.x - from.x) / length,
              z: (to.z - from.z) / length,
              length,
            }),
        )
      : buildings.plans;
  const cleared =
    kept.length === buildings.plans.length
      ? buildings
      : mappedBuildingsOf(kept, buildings.cityFarMax);
  byDrawn.set(drawn, cleared);
  return cleared;
}

function positionAtEnd(profile: RouteProfile): GeographicPosition {
  return profile.positions[profile.positions.length - 1] as GeographicPosition;
}

/**
 * Whether an outline — `x, z` pairs, local metres — reaches the road on from
 * `from` along `heading`: a corner of it beside that road, or an edge across it.
 */
function onTheRoadOn(
  ring: ArrayLike<number>,
  from: { readonly x: number; readonly z: number },
  heading: { readonly x: number; readonly z: number; readonly length: number },
): boolean {
  const corners: { readonly along: number; readonly across: number }[] = [];
  for (let at = 0; at + 1 < ring.length; at += 2) {
    const dx = (ring[at] as number) - from.x;
    const dz = (ring[at + 1] as number) - from.z;
    corners.push({
      along: dx * heading.x + dz * heading.z,
      across: dx * heading.z - dz * heading.x,
    });
  }
  const past = (along: number): boolean => along > 0 && along < heading.length;
  for (let index = 0; index < corners.length; index += 1) {
    const here = corners[index] as (typeof corners)[number];
    if (past(here.along) && Math.abs(here.across) < CLEAR_OF_THE_ROAD_ON_METRES) return true;
    const next = corners[(index + 1) % corners.length] as (typeof corners)[number];
    // An edge across the road's centreline, past the end: where it crosses.
    if (here.across * next.across < 0) {
      const share = here.across / (here.across - next.across);
      if (past(here.along + (next.along - here.along) * share)) return true;
    }
  }
  return false;
}
