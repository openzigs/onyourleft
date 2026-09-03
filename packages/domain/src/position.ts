// SPDX-License-Identifier: Apache-2.0

/**
 * Geographic position, and the FIT **semicircle** encoding.
 *
 * FIT stores latitude and longitude as a signed 32-bit count of semicircles,
 * where a semicircle is `180 / 2^31` degrees:
 *
 * ```text
 * degrees     = semicircles * (180 / 2^31)
 * semicircles = round(degrees * (2^31 / 180))
 * ```
 *
 * The encoding is exactly a full turn across the `sint32` range, which is why
 * it is worth getting right rather than approximating: the sign is carried by
 * the two's-complement integer itself, so an implementation that reaches for
 * `Math.abs` and re-applies a sign — or that reads the field as `uint32` —
 * produces a coordinate that is still a valid coordinate. A latitude of
 * +45.5 read unsigned comes back as -45.5 or as 214.7; the first puts a French
 * ride in the Southern Ocean, and a test written with two positive coordinates
 * cannot see either. Every test here uses a negative latitude and a negative
 * longitude for that reason.
 */

import type { DegreesLatitude, DegreesLongitude, GeographicPosition } from './quantities';
import { degreesLatitude, degreesLongitude } from './quantities';
import { assertIntegerInRange } from './unit-error';

/** Semicircles in a half turn: 2^31. Also the scale factor's numerator. */
export const SEMICIRCLES_PER_HALF_TURN = 2 ** 31;

/** Degrees in one semicircle: `180 / 2^31`, about 8.3819e-8. */
export const DEGREES_PER_SEMICIRCLE = 180 / SEMICIRCLES_PER_HALF_TURN;

/** The most negative value a `sint32` field can hold: exactly -180 degrees. */
export const SEMICIRCLES_MIN = -SEMICIRCLES_PER_HALF_TURN;

/**
 * The largest value a `sint32` field can hold: `2^31 - 1`.
 *
 * One semicircle short of +180 degrees, because two's complement is not
 * symmetric. See {@link degreesLongitudeToSemicircles} for what that costs.
 */
export const SEMICIRCLES_MAX = SEMICIRCLES_PER_HALF_TURN - 1;

/**
 * The worst-case error of a degrees → semicircles → degrees round trip: half a
 * semicircle, about 4.19e-8 degrees, or about 4.7 mm of latitude.
 *
 * Two orders of magnitude below the best civilian GNSS fix, so the encoding is
 * lossless for every purpose this program has. Tests assert round trips to
 * 1e-7 degrees — roughly 1.1 cm — which is a bound with slack in it rather than
 * one that would need revisiting if a rounding mode changed.
 */
export const SEMICIRCLE_ROUND_TRIP_TOLERANCE_DEGREES = DEGREES_PER_SEMICIRCLE / 2;

/**
 * Decode a FIT semicircle field as a latitude.
 *
 * @throws {UnitError} if the value is not a whole number in the `sint32` range,
 * or if it decodes to a latitude outside [-90, 90]. The second check is not
 * redundant: half the `sint32` range is beyond the poles, so a longitude field
 * accidentally passed here is caught rather than stored as a latitude of 143.
 */
export function semicirclesToDegreesLatitude(semicircles: number): DegreesLatitude {
  assertIntegerInRange(semicircles, SEMICIRCLES_MIN, SEMICIRCLES_MAX, 'latitude in semicircles');
  return degreesLatitude(semicircles * DEGREES_PER_SEMICIRCLE);
}

/**
 * Decode a FIT semicircle field as a longitude.
 *
 * @throws {UnitError} if the value is not a whole number in the `sint32` range.
 */
export function semicirclesToDegreesLongitude(semicircles: number): DegreesLongitude {
  assertIntegerInRange(semicircles, SEMICIRCLES_MIN, SEMICIRCLES_MAX, 'longitude in semicircles');
  return degreesLongitude(semicircles * DEGREES_PER_SEMICIRCLE);
}

/**
 * Decode a pair of FIT semicircle fields as a position.
 *
 * The argument order is latitude then longitude, matching the field order of a
 * FIT record message and of every other function in this package.
 */
export function semicirclesToPosition(
  latitudeSemicircles: number,
  longitudeSemicircles: number,
): GeographicPosition {
  return {
    latitude: semicirclesToDegreesLatitude(latitudeSemicircles),
    longitude: semicirclesToDegreesLongitude(longitudeSemicircles),
  };
}

/** Encode a latitude as a FIT semicircle field. Always inside the `sint32` range. */
export function degreesLatitudeToSemicircles(latitude: DegreesLatitude): number {
  return Math.round(latitude / DEGREES_PER_SEMICIRCLE);
}

/**
 * Encode a longitude as a FIT semicircle field.
 *
 * A longitude of exactly +180 degrees scales to `2^31`, which is one past the
 * largest `sint32`. It is clamped to `2^31 - 1` rather than rejected or
 * wrapped: rejecting would fail a legitimate point on the antimeridian, and
 * wrapping would send it to -180 — the same place on the globe, but with a sign
 * flip that turns a track crossing the line into one that crosses the entire
 * map. The clamp costs one semicircle, about 9 mm at the equator.
 */
export function degreesLongitudeToSemicircles(longitude: DegreesLongitude): number {
  const scaled = Math.round(longitude / DEGREES_PER_SEMICIRCLE);
  return scaled > SEMICIRCLES_MAX ? SEMICIRCLES_MAX : scaled;
}
