// SPDX-License-Identifier: Apache-2.0

/**
 * Distance between two points on the earth.
 *
 * Here rather than in `apps/web` for the reason every conversion in this
 * program is here: the number decides whether a track point falls inside a
 * privacy zone (ADR 0004 decision B), and that judgement is made **twice** —
 * on the device when a ride is emitted, and, from Phase 3, on an instance
 * enforcing the same rule in its response bodies (ADR 0004 decision C, "two
 * layers, not one"). Two implementations of a distance are two places for those
 * layers to disagree about whether a point is inside a disc, and a disagreement
 * there publishes a front door.
 *
 * ## The model, and what it is not
 *
 * The haversine formula on a **sphere** of the IUGG mean radius. WGS 84 is an
 * ellipsoid, so this is an approximation, and the size of the error is the
 * reason it is acceptable rather than a hope: a spherical-earth distance is
 * within about 0.5% of the geodesic anywhere on the globe, worst at high
 * latitudes over long baselines. Over the distances this function is used for —
 * a privacy-zone radius, 250 m to 2 km — 0.5% is at most 10 m, which is inside
 * the GNSS error the radius is chosen against in the first place.
 *
 * Vincenty's inverse formula would remove that error and would bring an
 * iteration that fails to converge on near-antipodal points, which is a
 * non-termination bug reachable from a hand-edited coordinate. Karney's
 * algorithm converges everywhere and is several hundred lines. Neither buys
 * anything at the scale this is called at, and both would be a decision to
 * revisit if a segment matcher (#12) ever needs metre-accurate long baselines.
 *
 * ⚠️ **This is a distance, not a bearing and not a projection.** Nothing here
 * is suitable for drawing a map: a chart or a tile renderer needs a projection,
 * which is #63's problem and a different piece of mathematics.
 */

import { assertFinite } from './unit-error';

import type { GeographicPosition, Metres } from './quantities';

/**
 * The IUGG mean radius R₁ = (2a + b) / 3 for WGS 84, in metres.
 *
 * 6 371 008.8 m. Not 6 371 000 and not the equatorial 6 378 137: R₁ is the
 * radius of the sphere with the same *surface area distribution* as the
 * ellipsoid, and it is the one that makes a spherical distance an unbiased
 * approximation rather than one that is long everywhere or short everywhere.
 *
 * Source: WGS 84 defines a = 6 378 137 m exactly and 1/f = 298.257223563
 * exactly, giving b = a(1 − f) = 6 356 752.314245… m; R₁ follows by arithmetic
 * and is quoted as 6 371.0088 km by the IUGG. Both inputs are published
 * constants, which CLAUDE.md §6 records as facts rather than as anybody's
 * implementation.
 */
export const EARTH_MEAN_RADIUS_METRES = 6_371_008.8;

/** Degrees to radians. Named so the multiplication below is not a bare literal. */
const RADIANS_PER_DEGREE = Math.PI / 180;

/**
 * Great-circle distance between two positions.
 *
 * Haversine rather than the spherical law of cosines: the law of cosines loses
 * precision catastrophically for small separations, because it takes `acos` of
 * a number within a rounding error of 1 — and a 1 Hz ride stream is *nothing
 * but* small separations, roughly 8 m apart at 30 km/h. Haversine is
 * well-conditioned there, which is the case that matters here.
 *
 * Symmetric, and zero for identical arguments exactly rather than to within a
 * rounding error: `haversin(0)` is 0 and `asin(0)` is 0, with no cancellation
 * anywhere in the path. `geodesy.test.ts` pins both properties, because a
 * distance that is symmetric only approximately makes "is this point inside the
 * zone" depend on argument order.
 *
 * @returns a non-negative distance in metres, so it composes with everything
 * else in this package that takes a {@link Metres}.
 */
export function distanceBetween(from: GeographicPosition, to: GeographicPosition): Metres {
  // Guards rather than trust: a position assembled by `geographicPosition` is
  // already validated, but this function is also reached from a decoded stream
  // whose channel arrays may hold whatever a hand-edited row put there, and
  // `NaN` propagating out of here would compare false against every radius and
  // silently place a point *outside* every privacy zone.
  assertFinite(from.latitude, 'latitude in degrees');
  assertFinite(from.longitude, 'longitude in degrees');
  assertFinite(to.latitude, 'latitude in degrees');
  assertFinite(to.longitude, 'longitude in degrees');

  const fromLatitude = from.latitude * RADIANS_PER_DEGREE;
  const toLatitude = to.latitude * RADIANS_PER_DEGREE;
  const deltaLatitude = (to.latitude - from.latitude) * RADIANS_PER_DEGREE;
  const deltaLongitude = (to.longitude - from.longitude) * RADIANS_PER_DEGREE;

  const halfChordSquared =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;

  // `Math.min(1, …)` before the square root, not after: floating point can push
  // the sum a few ulps above 1 for a near-antipodal pair, and `asin` of
  // anything above 1 is `NaN`. The clamp is the standard fix and it is here
  // rather than left to chance, because the `NaN` it prevents is the one the
  // guards above cannot see — it is produced by this arithmetic, not supplied.
  const angle = 2 * Math.asin(Math.min(1, Math.sqrt(halfChordSquared)));
  return (angle * EARTH_MEAN_RADIUS_METRES) as Metres;
}
