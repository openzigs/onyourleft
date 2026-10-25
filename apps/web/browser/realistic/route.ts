// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The stretch of road the owner's realistic page rides — #457's, kept for #430.
 *
 * Not a recorded ride: there is none in this repository, and a GPX of
 * somebody's own road is location data (SECURITY.md). It is a route drawn
 * through the product's OWN world generators — `landform.ts`, `waterways.ts`
 * and `settlements.ts`, which #468 added — so the realistic world sits in exactly
 * the world the product draws: a valley the road descends into, a level floor
 * long and low enough that `waterways.ts` DOES put a lake beside it, a climb
 * out of it gentle enough to be farmed and steep enough that `settlements.ts`
 * walls its fields in stone, and level stretches to build on. It meanders, because a straight
 * road seen from the chase camera is lit from one side for the whole run and
 * hides what an environment map does.
 *
 * Latitude 51.5°, the fixtures' latitude, for the same sun.
 *
 * ## The village road — #1559
 *
 * That road passes farmsteads and no village (validation 0002 §"AE2 cannot be
 * taken on this page"), and phase A of #1533 changes villages only. So
 * {@link villageRoute} is a second road, `?route=village` on the page: the
 * same meander, level and low, from another start, so its seed lays two
 * villages beside it. {@link realisticRoute} is untouched by it.
 *
 * ## Which way it faces — #702
 *
 * The sun stands at one azimuth in every world (`world.ts`
 * §`SUN_AZIMUTH_DEGREES`, 225°, the south-west), and this route meanders
 * ±25° about due north — so every frame it holds looks **110° to 160° away
 * from the sun**, and the sun's side of the sky, of the fog and of every lit
 * tree is behind the rider for the whole soak. {@link Facing} turns the WHOLE
 * route about its first point, which is what `?facing=` on the page asks for:
 * `sun` so it meanders about the sun's own azimuth, `away` so it meanders
 * about the opposite one. Absent, it is not turned at all and not one
 * coordinate moves — `route.test.ts` pins its digest, because the Part Z steps
 * and the Part AH triangle and draw-call rows were all taken on it.
 *
 * ⚠️ **The route turns, not the sun**: the renderer, the sun and the product
 * are untouched, and a turned route is the same road — the same elevations,
 * the same seed (`scatter.ts` §`scatterSeed` reads the first point and the
 * length, which a turn about the first point keeps), and so the same valley,
 * lake, bridge and walls, which `route.test.ts` holds for each facing.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { SUN_AZIMUTH_DEGREES } from '../../src/game/world';

const LATITUDE = 51.5;

/**
 * Where `?place=` puts a road — #1623, for the route's season on the owner's
 * page: `south`, the same road mirrored into the southern hemisphere, where 20
 * October is spring; `nordic`, at {@link NORDIC_LATITUDE}, where a winter's
 * snow lies to sea level (`world.ts` §"How far a winter brings the snow
 * down"), which at 51.5° N it does not. Absent, every road is where it was.
 */
export const PLACES = ['south', 'nordic'] as const;

/** A place `?place=` names. @see PLACES */
export type Place = (typeof PLACES)[number];

/** `nordic`'s latitude, degrees north: well inside `world.ts`' sea-level winter snow. */
const NORDIC_LATITUDE = 61;

/** The latitude a road at `place` runs from, degrees north; 51.5 with no place. */
export function placeLatitude(place: Place | undefined): number {
  if (place === 'south') return -LATITUDE;
  if (place === 'nordic') return NORDIC_LATITUDE;
  return LATITUDE;
}
const METRES_PER_DEGREE = 111_320;

/** How long the route is. Long enough for a 30 s run at 9 m/s never to reach its end. */
export const ROUTE_METRES = 4_000;

/**
 * The route's elevation: down 30 m into a valley with a level floor, up again
 * at 5 %, and then a 12 m V-shaped dip — a stream crossing, which is what
 * makes `waterways.ts` build a bridge.
 *
 * ⚠️ **Every one of those is a Part Z step, and `route.test.ts` holds the route
 * to all of them** — #501. Until then this comment said the floor was where
 * `waterways.ts` *"may lay a lake"*, and it laid none: a lake is seeded per
 * stretch at `LAKE_CHANCE`, and both of this floor's stretches said no, so
 * Z10's lake could not be judged on the page Part Z sends the owner to. Nor
 * could Z9's stone walls: `settlements.ts` walls a field in stone on ground
 * steeper than `WALL_GRADE_PERCENT` (4 %) but still farmed (no steeper than
 * `FIELD_GRADE_PERCENT`, 6 %), and the climb out was 7.5 %. So the climb is
 * 5 % over 600 m, and the descent ends at 780 m rather than 800 m, which is
 * where this route’s seed lays one. Both
 * are this route's own arithmetic, not a measurement of anywhere.
 */
export function realisticElevation(along: number): number {
  if (along <= 500) return 30;
  if (along <= 780) return 30 - ((along - 500) / 280) * 30;
  if (along <= 1_900) return 0;
  if (along <= 2_500) return ((along - 1_900) / 600) * 30;
  if (along <= 2_700) return 30;
  if (along <= 2_850) return 30 - ((along - 2_700) / 150) * 12;
  if (along <= 3_000) return 18 + ((along - 2_850) / 150) * 12;
  return 30;
}

/**
 * The heading, radians east of north, at a distance: a gentle meander of
 * ±25° over about 700 m, so bends are sweeping rather than hairpins.
 */
export function realisticHeading(along: number): number {
  return 0.45 * Math.sin((along / 700) * Math.PI * 2);
}

/** Which way `?facing=` holds the route: towards the sun, or directly away from it — #702. */
export type Facing = 'sun' | 'away';

/**
 * How far the whole route is turned for a facing, radians clockwise from
 * north: the sun's azimuth for `sun`, the opposite one for `away`, so the
 * route's mean heading — due north, unturned — points there.
 */
export function facingTurn(facing: Facing): number {
  const degrees = facing === 'sun' ? SUN_AZIMUTH_DEGREES : SUN_AZIMUTH_DEGREES - 180;
  return (degrees * Math.PI) / 180;
}

/**
 * The route, as the product profiles it — turned to `facing` if one is given,
 * and otherwise exactly the route every Part Z and Part AH row was taken on.
 */
export function realisticRoute(facing?: Facing, place?: Place): RouteProfile {
  return meanderingRoute(DEFAULT_START_LONGITUDE, realisticElevation, facing, place);
}

/** Where the default route starts, degrees east: the fixtures' longitude. */
const DEFAULT_START_LONGITUDE = -0.12;

/**
 * Where {@link villageRoute} starts, degrees east: about 3.5 km east of
 * {@link realisticRoute}'s first point — #1559.
 *
 * ⚠️ **Chosen by searching, not by reasoning.** `scatter.ts` §`scatterSeed`
 * reads the first point and the length, and `settlements.ts` hashes a kind per
 * site from that seed, so where a village stands is the seed's say. Of the
 * starts 0.01° apart from −0.12° east, this is the first whose level road
 * holds two villages, each with its row of shops nearer the start than its
 * church — so a rider riding up the road sees both ahead (`route.test.ts`
 * §"#1559" holds the villages; {@link VILLAGE_HOLD_METRES} the frame).
 */
const VILLAGE_START_LONGITUDE = -0.07;

/** How high the village route's road runs, metres: level, and low enough to be built on. */
export const VILLAGE_ELEVATION_METRES = 30;

/**
 * Where `?route=village&at=` holds the rider so the first village's church and
 * its row of shops are both in frame, on the owner's tablet's 16 : 10 frame —
 * validation 0002 AE2. `route.test.ts` §"#1559" and the browser gate hold
 * that, read off the frame the page draws (`village.ts` §`frameCensus`).
 */
export const VILLAGE_HOLD_METRES = 820;

/**
 * The route `?route=village` rides — #1559: the same meander as
 * {@link realisticRoute}, on a level road at {@link VILLAGE_ELEVATION_METRES},
 * from {@link VILLAGE_START_LONGITUDE}, so it passes through villages where
 * the default route passes only farmsteads (validation 0002 §"AE2 cannot be
 * taken on this page"). Level because `settlements.ts` builds only on level,
 * low, dry ground; the valley, the lake and the bridge stay the default
 * route's. Turned to `facing` as that one is.
 */
export function villageRoute(facing?: Facing, place?: Place): RouteProfile {
  return meanderingRoute(VILLAGE_START_LONGITUDE, () => VILLAGE_ELEVATION_METRES, facing, place);
}

/**
 * A short fingerprint of a route — #1559: FNV-1a over its positions to 1e-9 of
 * a degree, its heights to the millimetre and its length to the metre, as
 * eight hex digits. The page publishes it so the browser gate can see that the
 * default URL rides {@link realisticRoute} and `?route=village`
 * {@link villageRoute}, without the page carrying a hash library. Not a
 * security property: two routes are told apart, not defended.
 *
 * ⚠️ **Rounded, because Chromium and Node disagree in the last bits.** The
 * village road's length summed to 3995.3689064678824 m in the pinned Chromium
 * and 3995.3689064678833 m under Vitest (2026-10-24), from the same points, so
 * a digest of the raw numbers differed between the page and the test that
 * pins it. `route.test.ts`' sha-256 above stays exact, in Node.
 */
export function routeDigest(profile: RouteProfile): string {
  const text = [
    profile.positions
      .map((point) => `${point.latitude.toFixed(9)},${point.longitude.toFixed(9)}`)
      .join(';'),
    profile.elevations.map((height) => height.toFixed(3)).join(';'),
    Math.round(profile.totalDistance),
  ].join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The ±25° meander from `longitude` at 51.5° north — or at `place` (#1623) —
 * at `elevation`, turned to `facing`.
 */
function meanderingRoute(
  longitude: number,
  elevation: (along: number) => number,
  facing: Facing | undefined,
  place: Place | undefined,
): RouteProfile {
  const latitude = placeLatitude(place);
  const points: RoutePoint[] = [];
  let east = 0;
  let north = 0;
  const step = 10;
  const perLongitude = METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180);
  for (let along = 0; along <= ROUTE_METRES; along += step) {
    points.push({
      position: geographicPosition(
        degreesLatitude(latitude + north / METRES_PER_DEGREE),
        degreesLongitude(longitude + east / perLongitude),
      ),
      elevation: altitudeMetres(elevation(along)),
    });
    const heading = realisticHeading(along + step / 2);
    east += Math.sin(heading) * step;
    north += Math.cos(heading) * step;
  }
  return routeProfile(facing === undefined ? points : turned(points, facingTurn(facing)));
}

/**
 * `points` turned clockwise, seen from above, by `radians` about the first of
 * them — a rotation of the SPHERE about the axis through that point and the
 * Earth's centre, which moves no point's distance from any other.
 *
 * ⚠️ Not the meander's heading plus a turn, which was tried first: this
 * route's steps are laid out with one metres-per-degree of longitude, so the
 * same steps pointed another way are a few metres longer or shorter over
 * 4 km, the length rounds to another metre, `scatter.ts` §`scatterSeed` is
 * another seed, and the lake moved 150 m and its wet shore left the frames
 * Part Z holds — `route.test.ts` caught it. A rotation of the sphere keeps
 * every distance, so the profile, the seed and the world beside the road are
 * the unturned route's, turned.
 */
function turned(points: readonly RoutePoint[], radians: number): RoutePoint[] {
  const first = points[0];
  if (first === undefined) return [];
  const axis = unit(first.position.latitude, first.position.longitude);
  // Clockwise seen from outside the sphere is a negative right-handed turn.
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  return points.map((point) => {
    const v = unit(point.position.latitude, point.position.longitude);
    const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
    const cross = [
      axis[1] * v[2] - axis[2] * v[1],
      axis[2] * v[0] - axis[0] * v[2],
      axis[0] * v[1] - axis[1] * v[0],
    ] as const;
    // Rodrigues' rotation formula.
    const r = [0, 1, 2].map(
      (i) =>
        (v[i] as number) * cos + (cross[i] as number) * sin + (axis[i] as number) * dot * (1 - cos),
    ) as [number, number, number];
    return {
      position: geographicPosition(
        degreesLatitude((Math.asin(Math.max(-1, Math.min(1, r[2]))) * 180) / Math.PI),
        degreesLongitude((Math.atan2(r[1], r[0]) * 180) / Math.PI),
      ),
      elevation: point.elevation,
    };
  });
}

/** The unit vector to a latitude and longitude, in degrees. */
function unit(latitude: number, longitude: number): readonly [number, number, number] {
  const phi = (latitude * Math.PI) / 180;
  const lambda = (longitude * Math.PI) / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}
