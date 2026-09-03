// SPDX-License-Identifier: Apache-2.0

/**
 * Speed conversions.
 *
 * The canonical unit for speed in this program is **metres per second**, because
 * that is what every BLE speed and trainer characteristic ultimately reports and
 * what the physics model in `packages/physics` works in. Kilometres per hour is
 * a presentation unit and the conversion belongs here rather than in a view, so
 * that the device and a Phase 3 instance produce identical numbers.
 *
 * The arguments are typed quantities rather than bare numbers, so the values
 * were validated when they were constructed (`quantities.ts`) and these
 * functions do not check them again.
 */

import type { KilometresPerHour, MetresPerSecond } from './quantities';
import { assertIntegerInRange } from './unit-error';

/** Seconds in an hour divided by metres in a kilometre: 3600 / 1000. */
const KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND = 3.6;

/** Convert a speed in metres per second to kilometres per hour, for display. */
export function metresPerSecondToKilometresPerHour(speed: MetresPerSecond): KilometresPerHour {
  return (speed * KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND) as KilometresPerHour;
}

/** Convert a speed in kilometres per hour back to the canonical unit. */
export function kilometresPerHourToMetresPerSecond(speed: KilometresPerHour): MetresPerSecond {
  return (speed / KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND) as MetresPerSecond;
}

/** The largest value a `uint16` field can hold. */
const UINT16_MAX = 65535;

/**
 * Convert a speed expressed in hundredths of a kilometre per hour to the
 * canonical unit.
 *
 * This is the scaling the **FTMS Indoor Bike Data** characteristic uses for
 * both its instantaneous and its average speed field: a `uint16` in units of
 * 0.01 km/h, so 2 543 is 25.43 km/h and the field saturates at 655.35 km/h.
 * Reading it as metres per second — or as km/h without the divide — is a
 * hundred-fold error that still looks like a number, which is why the
 * conversion is here and named after the scaling rather than left at the call
 * site.
 *
 * The argument is a raw field straight off the wire and therefore untrusted, so
 * unlike the conversions above this one validates.
 *
 * @throws {UnitError} if the value is not a whole number in `[0, 65535]`.
 */
export function hundredthsKilometresPerHourToMetresPerSecond(hundredths: number): MetresPerSecond {
  assertIntegerInRange(hundredths, 0, UINT16_MAX, 'speed in hundredths of a kilometre per hour');
  return (hundredths / 100 / KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND) as MetresPerSecond;
}
