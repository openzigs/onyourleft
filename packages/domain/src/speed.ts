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
 * functions do not check them *again*.
 *
 * ## Every value that leaves here goes through a constructor
 *
 * A validated argument does not make the **result** valid: the arithmetic in
 * between can leave the type's range. `metresPerSecond(Number.MAX_VALUE)` is a
 * legitimate `MetresPerSecond`, and times 3.6 it is `Infinity` — a value
 * `kilometresPerHour()` rejects. While these functions cast — as they did until
 * #103 — this package could hand out a branded value its own constructor would
 * refuse, which makes the brand a weaker statement than `quantities.ts` claims
 * for it: "has a unit" and "has been checked" stop being the same sentence.
 *
 * So none of them casts. Each returns through the constructor of the type it
 * produces, which is the bypass #102 removed from `semicirclesToPosition` for
 * the same reason. The cost is one comparison per conversion on a 1 Hz record
 * loop; the guarantee is that a `KilometresPerHour` from this package is one
 * `kilometresPerHour()` would have accepted.
 */

import type { KilometresPerHour, MetresPerSecond } from './quantities';
import { kilometresPerHour, metresPerSecond } from './quantities';
import { assertIntegerInRange } from './unit-error';

/** Seconds in an hour divided by metres in a kilometre: 3600 / 1000. */
const KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND = 3.6;

/**
 * Convert a speed in metres per second to kilometres per hour, for display.
 *
 * @throws {UnitError} if the product is not a speed — which a validated
 * argument does not rule out, because multiplying by 3.6 overflows to
 * `Infinity` near the top of the double range.
 */
export function metresPerSecondToKilometresPerHour(speed: MetresPerSecond): KilometresPerHour {
  return kilometresPerHour(speed * KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND);
}

/**
 * Convert a speed in kilometres per hour back to the canonical unit.
 *
 * @throws {UnitError} if the quotient is not a speed. No argument this
 * package can construct reaches that today — dividing a finite non-negative
 * number by 3.6 stays finite and non-negative — and the constructor is here so
 * that a later change to the arithmetic cannot quietly start producing one.
 */
export function kilometresPerHourToMetresPerSecond(speed: KilometresPerHour): MetresPerSecond {
  return metresPerSecond(speed / KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND);
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
  return metresPerSecond(hundredths / 100 / KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND);
}
