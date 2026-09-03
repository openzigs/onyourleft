// SPDX-License-Identifier: Apache-2.0

/**
 * Altitude, and the FIT scale-and-offset encoding of it.
 *
 * FIT stores `altitude` as a `uint16` with a scale of 5 and an offset of 500:
 *
 * ```text
 * metres = raw / 5 - 500
 * raw    = round((metres + 500) * 5)
 * ```
 *
 * Both halves matter and each fails differently. Forgetting the offset puts
 * every point 500 m too high, which looks like a plausible mountain profile.
 * Forgetting the scale multiplies every elevation by five, which does not — but
 * it also multiplies total ascent by five, and total ascent is a number nobody
 * checks against anything. The offset is what lets the format carry the
 * below-sea-level altitudes that `AltitudeMetres` exists to permit.
 */

import type { AltitudeMetres } from './quantities';
import { altitudeMetres } from './quantities';
import { assertFinite, assertIntegerInRange, UnitError } from './unit-error';

/** FIT's scale for the `altitude` field: raw units per metre. */
export const FIT_ALTITUDE_SCALE = 5;

/** FIT's offset for the `altitude` field, in metres. */
export const FIT_ALTITUDE_OFFSET_METRES = 500;

/**
 * The all-ones value every unsigned FIT field uses to mean "no value".
 *
 * Decoding it arithmetically yields 12 606.8 m — above the cruising altitude of
 * an airliner, but not so absurd that a summary would look wrong, and it would
 * be averaged into an elevation profile rather than skipped. So it is rejected
 * here by name, and a decoder must test for it before deciding whether the
 * record has an altitude at all.
 */
export const FIT_UINT16_INVALID = 0xffff;

/** The lowest altitude the FIT `altitude` field can represent: raw 0. */
export const FIT_ALTITUDE_MIN_METRES = -FIT_ALTITUDE_OFFSET_METRES;

/** The highest altitude the FIT `altitude` field can represent: raw 65 534. */
export const FIT_ALTITUDE_MAX_METRES =
  (FIT_UINT16_INVALID - 1) / FIT_ALTITUDE_SCALE - FIT_ALTITUDE_OFFSET_METRES;

/**
 * Decode a FIT `altitude` field.
 *
 * @throws {UnitError} if the value is not a whole number in `[0, 65535]`, or if
 * it is the invalid marker.
 */
export function fitAltitudeToMetres(raw: number): AltitudeMetres {
  assertIntegerInRange(raw, 0, FIT_UINT16_INVALID, 'FIT altitude');
  if (raw === FIT_UINT16_INVALID) {
    throw new UnitError(
      `FIT altitude ${String(FIT_UINT16_INVALID)} is the invalid marker, not an altitude`,
    );
  }
  return altitudeMetres(raw / FIT_ALTITUDE_SCALE - FIT_ALTITUDE_OFFSET_METRES);
}

/**
 * Encode an altitude into a FIT `altitude` field.
 *
 * Rounds to the nearest raw unit, which is 0.2 m — two orders below the
 * accuracy of any altimeter this program will read.
 *
 * @throws {UnitError} if the altitude is outside what the field can represent.
 * Rejected rather than clamped, unlike the antimeridian case in `position.ts`:
 * an altitude out of this range is a decode fault upstream rather than a real
 * point on a real ride, and clamping it would write a plausible 12 606.8 m into
 * a file that then round-trips cleanly for ever.
 */
export function metresToFitAltitude(altitude: AltitudeMetres): number {
  assertFinite(altitude, 'altitude in metres');
  if (altitude < FIT_ALTITUDE_MIN_METRES || altitude > FIT_ALTITUDE_MAX_METRES) {
    throw new UnitError(
      `altitude ${String(altitude)} m is outside the FIT altitude field's range ` +
        `[${String(FIT_ALTITUDE_MIN_METRES)}, ${String(FIT_ALTITUDE_MAX_METRES)}] m`,
    );
  }
  return Math.round((altitude + FIT_ALTITUDE_OFFSET_METRES) * FIT_ALTITUDE_SCALE);
}
