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
 *
 * ## The brand reaches the wire, because the swap happens there
 *
 * A FIT record message carries `position_lat` and `position_long` one field
 * apart, both `sint32`, both plausible in each other's place. Transposing them
 * is the geographic bug that no range check can find: London is 51.5074 N,
 * 0.1278 W, and the transposed pair (-0.1278, 51.5074) is a perfectly valid
 * position in Kenya. Most of Europe has that property.
 *
 * So the semicircle values are branded too — {@link LatitudeSemicircles} and
 * {@link LongitudeSemicircles} — and every function here consumes and produces
 * the branded form. The consequence is the one that matters: **two labelled
 * values cannot be transposed without a compile error**, at either entry point.
 *
 * What remains, and cannot be removed by any typing: an author who applies the
 * *wrong label* at the wire read — `latitudeSemicircles(longitudeField)` — has
 * declared that field to be a latitude and this package believes them. The
 * label is applied once, at the single point where an unlabelled number comes
 * off the wire, where it is visible in review; it is never re-applied
 * downstream. The compile errors are pinned by `@ts-expect-error` in
 * `src/position.test.ts` (the semicircle pair) and `src/quantities.test.ts` (the
 * degree pair), both using London, where neither value is out of range in the
 * swapped role.
 */

import type { DegreesLatitude, DegreesLongitude, GeographicPosition } from './quantities';
import { degreesLatitude, degreesLongitude, geographicPosition } from './quantities';
import type { Quantity } from './quantity';
import { assertIntegerInRange } from './unit-error';

/** Semicircles in a half turn: 2^31. Also the scale factor's numerator. */
export const SEMICIRCLES_PER_HALF_TURN = 2 ** 31;

/** Semicircles in a quarter turn: 2^30, exactly 90 degrees — the pole. */
export const SEMICIRCLES_PER_QUARTER_TURN = 2 ** 30;

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
 * A latitude in FIT semicircles: a `sint32` in `[-2^30, 2^30]`, north positive.
 *
 * Half the `sint32` range is beyond the poles, so the bound here is the pole
 * and not the field width. A longitude field offered to
 * {@link latitudeSemicircles} is therefore rejected outright whenever it is
 * beyond ±90 degrees — which catches the transposition this package cannot
 * catch by type alone, for every pair with one coordinate outside Europe.
 */
export type LatitudeSemicircles = Quantity<'semicircle of latitude'>;

/**
 * Label a raw `sint32` field as a latitude in semicircles.
 *
 * @throws {UnitError} if the value is not a whole number in `[-2^30, 2^30]`.
 */
export function latitudeSemicircles(value: number): LatitudeSemicircles {
  assertIntegerInRange(
    value,
    -SEMICIRCLES_PER_QUARTER_TURN,
    SEMICIRCLES_PER_QUARTER_TURN,
    'latitude in semicircles',
  );
  return value as LatitudeSemicircles;
}

/** A longitude in FIT semicircles: a `sint32` over the full turn, east positive. */
export type LongitudeSemicircles = Quantity<'semicircle of longitude'>;

/**
 * Label a raw `sint32` field as a longitude in semicircles.
 *
 * @throws {UnitError} if the value is not a whole number in the `sint32` range.
 */
export function longitudeSemicircles(value: number): LongitudeSemicircles {
  assertIntegerInRange(value, SEMICIRCLES_MIN, SEMICIRCLES_MAX, 'longitude in semicircles');
  return value as LongitudeSemicircles;
}

/** Decode a FIT semicircle latitude field as degrees. */
export function semicirclesToDegreesLatitude(semicircles: LatitudeSemicircles): DegreesLatitude {
  return degreesLatitude(semicircles * DEGREES_PER_SEMICIRCLE);
}

/** Decode a FIT semicircle longitude field as degrees. */
export function semicirclesToDegreesLongitude(semicircles: LongitudeSemicircles): DegreesLongitude {
  return degreesLongitude(semicircles * DEGREES_PER_SEMICIRCLE);
}

/**
 * Decode a pair of FIT semicircle fields as a position.
 *
 * The argument order is latitude then longitude, matching the field order of a
 * FIT record message and of every other function in this package — and the two
 * arguments have different types, so passing them the other way round does not
 * compile rather than producing a position on the wrong continent.
 */
export function semicirclesToPosition(
  latitude: LatitudeSemicircles,
  longitude: LongitudeSemicircles,
): GeographicPosition {
  return geographicPosition(
    semicirclesToDegreesLatitude(latitude),
    semicirclesToDegreesLongitude(longitude),
  );
}

/** Encode a latitude as a FIT semicircle field. Always inside the `sint32` range. */
export function degreesLatitudeToSemicircles(latitude: DegreesLatitude): LatitudeSemicircles {
  return latitudeSemicircles(Math.round(latitude / DEGREES_PER_SEMICIRCLE));
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
export function degreesLongitudeToSemicircles(longitude: DegreesLongitude): LongitudeSemicircles {
  const scaled = Math.round(longitude / DEGREES_PER_SEMICIRCLE);
  return longitudeSemicircles(scaled > SEMICIRCLES_MAX ? SEMICIRCLES_MAX : scaled);
}
