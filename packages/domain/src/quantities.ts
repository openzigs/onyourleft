// SPDX-License-Identifier: Apache-2.0

/**
 * The canonical representation of every quantity this program measures, and the
 * constructors that are the only way to obtain one.
 *
 * One representation per quantity, chosen once here, is what makes "every
 * conversion in the program goes through this package" enforceable rather than
 * aspirational. The choices are SI where SI is what the sensors and the physics
 * model already speak, and the presentation units (km/h, and later mph) are
 * conversions *out* rather than alternative representations.
 *
 * | Quantity | Canonical unit | Type | Sign |
 * |---|---|---|---|
 * | distance | metre | `Metres` | non-negative |
 * | speed | metre per second | `MetresPerSecond` | non-negative |
 * | power | watt | `Watts` | non-negative |
 * | cadence | revolution per minute | `RevolutionsPerMinute` | non-negative |
 * | heart rate | beat per minute | `BeatsPerMinute` | non-negative |
 * | altitude | metre | `AltitudeMetres` | **signed** |
 * | temperature | degree Celsius | `DegreesCelsius` | at or above absolute zero |
 * | mass | kilogram | `Kilograms` | strictly positive |
 * | position | decimal degree, WGS 84 | `GeographicPosition` | signed |
 * | duration | second | `Seconds` | non-negative |
 * | instant | second since the Unix epoch | `UnixSeconds` | signed |
 *
 * **Validation is definitional only.** A guard here rejects values that are not
 * the quantity at all — `NaN`, a negative distance, a temperature below
 * absolute zero, a latitude of 91. It does not reject values that are merely
 * implausible: a heart rate of 260 bpm is a strap fault rather than a decoding
 * fault, and deciding that is analysis (#75-#78), which sees the neighbouring
 * samples this function cannot. A plausibility check placed here would silently
 * drop real data from the one athlete who is an outlier.
 */

import type { Quantity } from './quantity';
import { assertFinite, assertInRange, assertNotNegative, UnitError } from './unit-error';

// --- Distance ---------------------------------------------------------------

/** A distance in metres. A magnitude: a displacement is not this type. */
export type Metres = Quantity<'metre'>;

/** @throws {UnitError} if not a finite, non-negative number. */
export function metres(value: number): Metres {
  assertNotNegative(value, 'distance in metres');
  return value as Metres;
}

// --- Speed ------------------------------------------------------------------

/**
 * A speed in metres per second — the canonical speed unit.
 *
 * Chosen because it is what the physics model in `packages/physics` works in
 * and what every BLE speed source reduces to once its own scaling is undone.
 * A ground speed, so it is a magnitude and never negative.
 */
export type MetresPerSecond = Quantity<'metre per second'>;

/** @throws {UnitError} if not a finite, non-negative number. */
export function metresPerSecond(value: number): MetresPerSecond {
  assertNotNegative(value, 'speed in metres per second');
  return value as MetresPerSecond;
}

/**
 * A speed in kilometres per hour — a **presentation** unit, not a canonical one.
 *
 * It exists as a type so that a converted value cannot drift back into a
 * calculation that wanted metres per second. Nothing in this program should
 * store or transmit it.
 */
export type KilometresPerHour = Quantity<'kilometre per hour'>;

/** @throws {UnitError} if not a finite, non-negative number. */
export function kilometresPerHour(value: number): KilometresPerHour {
  assertNotNegative(value, 'speed in kilometres per hour');
  return value as KilometresPerHour;
}

// --- Power ------------------------------------------------------------------

/**
 * Mechanical power at the pedals, in watts.
 *
 * Non-negative: the BLE Cycling Power characteristic carries instantaneous
 * power as a `sint16` and a rider can drive it below zero only by back-pedalling
 * against a meter that models it, which no meter this program supports does. A
 * negative reading is a decode fault — most often a `uint16` read where a
 * `sint16` was meant, or the wrong flag offset — and is worth failing on.
 */
export type Watts = Quantity<'watt'>;

/** @throws {UnitError} if not a finite, non-negative number. */
export function watts(value: number): Watts {
  assertNotNegative(value, 'power in watts');
  return value as Watts;
}

// --- Cadence ----------------------------------------------------------------

/** Crank cadence in revolutions per minute. */
export type RevolutionsPerMinute = Quantity<'revolution per minute'>;

/** @throws {UnitError} if not a finite, non-negative number. */
export function revolutionsPerMinute(value: number): RevolutionsPerMinute {
  assertNotNegative(value, 'cadence in revolutions per minute');
  return value as RevolutionsPerMinute;
}

// --- Heart rate -------------------------------------------------------------

/** Heart rate in beats per minute. */
export type BeatsPerMinute = Quantity<'beat per minute'>;

/** @throws {UnitError} if not a finite, non-negative number. */
export function beatsPerMinute(value: number): BeatsPerMinute {
  assertNotNegative(value, 'heart rate in beats per minute');
  return value as BeatsPerMinute;
}

// --- Altitude ---------------------------------------------------------------

/**
 * An altitude in metres.
 *
 * **Signed, and distinct from `Metres` on purpose.** Roughly a hundred million
 * people live below sea level and the Dead Sea shore is about -430 m, so the
 * non-negative guard that is right for a distance is a data-loss bug here. The
 * separate brand is what stops an altitude being summed into a distance.
 *
 * ⚠️ **The vertical datum is not decided by #25.** Whether these metres are
 * above the WGS 84 ellipsoid or above a geoid model (orthometric, "above sea
 * level") is a separate decision, and the two differ by up to about 50 m
 * worldwide and around 45 m in western Europe. Every Phase 1 source is a
 * device-reported figure whose datum the device does not state. Consumers
 * (#26-#28, #30-#31) must not assume one, and must not mix a barometric
 * altitude with a GNSS one without recording which is which. Settling it needs
 * a geoid model, which is data rather than code, and belongs to the elevation
 * work rather than to this package.
 */
export type AltitudeMetres = Quantity<'metre of altitude'>;

/** @throws {UnitError} if not a finite number. Negative altitudes are valid. */
export function altitudeMetres(value: number): AltitudeMetres {
  assertFinite(value, 'altitude in metres');
  return value as AltitudeMetres;
}

// --- Temperature ------------------------------------------------------------

/** The coldest temperature there is, in degrees Celsius. */
export const ABSOLUTE_ZERO_DEGREES_CELSIUS = -273.15;

/**
 * A temperature in degrees Celsius.
 *
 * Celsius rather than kelvin: FIT stores `sint8` degrees Celsius, every BLE
 * environmental characteristic reports Celsius, and a kelvin canon would mean
 * an offset applied on both sides of every boundary for no reader's benefit.
 */
export type DegreesCelsius = Quantity<'degree Celsius'>;

/** @throws {UnitError} if not finite or below absolute zero. */
export function degreesCelsius(value: number): DegreesCelsius {
  assertFinite(value, 'temperature in degrees Celsius');
  if (value < ABSOLUTE_ZERO_DEGREES_CELSIUS) {
    throw new UnitError(
      `temperature in degrees Celsius must not be below absolute zero (${String(
        ABSOLUTE_ZERO_DEGREES_CELSIUS,
      )}), received ${String(value)}`,
    );
  }
  return value as DegreesCelsius;
}

// --- Mass -------------------------------------------------------------------

/**
 * A mass in kilograms — rider, bike, or the system total the physics model
 * accelerates.
 */
export type Kilograms = Quantity<'kilogram'>;

/**
 * @throws {UnitError} if not finite or not strictly positive. Zero is rejected
 * as well as negative: a mass of zero is not a rider or a bike, and it is the
 * value an unset field decodes to, which divides by zero two layers away in
 * `packages/physics`.
 */
export function kilograms(value: number): Kilograms {
  assertNotNegative(value, 'mass in kilograms');
  if (value === 0) {
    throw new UnitError('mass in kilograms must be greater than zero, received 0');
  }
  return value as Kilograms;
}

// --- Geographic position ----------------------------------------------------

/**
 * A latitude in decimal degrees on WGS 84, north positive.
 *
 * Latitude and longitude are separate types, and the cost of that is a little
 * ceremony at every construction site. It buys the one geographic bug that is
 * both the easiest to write and the hardest to see: the swap. Swapped
 * coordinates stay inside the valid range whenever both are under 90 degrees,
 * which is most of Europe, so no range check finds them — the ride simply
 * appears in the wrong place.
 */
export type DegreesLatitude = Quantity<'degree of latitude'>;

/** @throws {UnitError} if not finite or outside [-90, 90]. */
export function degreesLatitude(value: number): DegreesLatitude {
  assertInRange(value, -90, 90, 'latitude in degrees');
  return value as DegreesLatitude;
}

/** A longitude in decimal degrees on WGS 84, east positive. */
export type DegreesLongitude = Quantity<'degree of longitude'>;

/** @throws {UnitError} if not finite or outside [-180, 180]. */
export function degreesLongitude(value: number): DegreesLongitude {
  assertInRange(value, -180, 180, 'longitude in degrees');
  return value as DegreesLongitude;
}

/**
 * A point on the earth, in decimal degrees on WGS 84.
 *
 * Deliberately **not** a tuple. GeoJSON orders a position `[longitude,
 * latitude]` and almost every mapping library, GPX attribute set and human
 * conversation orders it the other way, so a positional pair is a swap waiting
 * for a careless read. Named fields cannot be transposed silently, and the
 * distinct types mean they cannot be transposed loudly either.
 *
 * Altitude is not part of a position: it has its own type, its own sign rule
 * and an unsettled datum, and most positions in a ride stream have no altitude
 * at all.
 */
export interface GeographicPosition {
  readonly latitude: DegreesLatitude;
  readonly longitude: DegreesLongitude;
}

/** @throws {UnitError} if either coordinate is out of range. */
export function geographicPosition(latitude: number, longitude: number): GeographicPosition {
  return {
    latitude: degreesLatitude(latitude),
    longitude: degreesLongitude(longitude),
  };
}

// --- Time -------------------------------------------------------------------

/**
 * A duration or an interval, in seconds.
 *
 * Fractional values are expected: a 1/1024 s event-time interval is not a whole
 * number of seconds and rounding it to one would destroy the cadence it exists
 * to compute.
 */
export type Seconds = Quantity<'second'>;

/** @throws {UnitError} if not a finite, non-negative number. */
export function seconds(value: number): Seconds {
  assertNotNegative(value, 'duration in seconds');
  return value as Seconds;
}

/**
 * An instant, as seconds since the Unix epoch (1970-01-01T00:00:00Z).
 *
 * Seconds rather than milliseconds, because every format this program reads or
 * writes — FIT, GPX, TCX — carries whole or fractional seconds, and because a
 * millisecond canon would put a factor of 1000 on both sides of every
 * conversion for the benefit of no consumer.
 *
 * **Not a `Date`.** `Date` is mutable, it carries an implicit local time zone
 * in half its methods, and it is exactly the kind of platform-flavoured type
 * this package is required not to spread. A number of seconds means the same
 * thing on a phone and on an instance.
 *
 * Signed and fractional: instants before 1970 are real, and sub-second
 * precision is real. The FIT-specific bounds live in `time.ts`, because they
 * are a property of that format rather than of the instant.
 */
export type UnixSeconds = Quantity<'second since the Unix epoch'>;

/** @throws {UnitError} if not a finite number. */
export function unixSeconds(value: number): UnixSeconds {
  assertFinite(value, 'instant in seconds since the Unix epoch');
  return value as UnixSeconds;
}
