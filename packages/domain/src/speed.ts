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
 * Scaffold seed for #25, which owns the full unit and type surface.
 */

/** Seconds in an hour divided by metres in a kilometre: 3600 / 1000. */
const KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND = 3.6;

/**
 * Raised when a value offered to a conversion is not a quantity that conversion
 * can accept.
 *
 * Sensor data is untrusted input (CLAUDE.md section 6): a GATT payload from a
 * device that may not be what it claims can decode to `NaN` or to a negative
 * magnitude, and a conversion that quietly propagates either produces a ride
 * summary that is wrong rather than an error that is visible.
 */
export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

/**
 * Convert a speed in metres per second to kilometres per hour.
 *
 * @throws {UnitError} if the value is not a finite, non-negative number. Speed
 * here is a scalar magnitude, so a negative value is not a direction — it is a
 * decoding fault.
 */
export function metresPerSecondToKilometresPerHour(metresPerSecond: number): number {
  if (!Number.isFinite(metresPerSecond)) {
    throw new UnitError(`speed must be a finite number, received ${String(metresPerSecond)}`);
  }
  if (metresPerSecond < 0) {
    throw new UnitError(`speed must not be negative, received ${String(metresPerSecond)}`);
  }
  return metresPerSecond * KILOMETRES_PER_HOUR_PER_METRE_PER_SECOND;
}
