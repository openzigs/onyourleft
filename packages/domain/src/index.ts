// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/domain` — canonical units, core types, validation, signing and
 * analysis.
 *
 * This package depends on **no platform API at all**: no DOM, no Node globals,
 * no I/O, no network types. `tsconfig.json` enforces it by narrowing `lib` and
 * emptying `types`, and `eslint.config.js` enforces it again for the module
 * specifiers a `lib` narrowing cannot see. See docs/architecture.md.
 *
 * The canonical representation of each quantity, and the reasoning behind it,
 * is in `README.md` and in the doc comments on each type. Everything the rest
 * of the program uses is re-exported here, so a consumer imports from
 * `@onyourleft/domain` and never from a file inside it.
 */

// --- Nominal typing ---------------------------------------------------------

export type { Quantity } from './quantity';

// --- Errors -----------------------------------------------------------------

export { UnitError } from './unit-error';

// --- Canonical quantities ---------------------------------------------------

export type {
  AltitudeMetres,
  BeatsPerMinute,
  DegreesCelsius,
  DegreesLatitude,
  DegreesLongitude,
  GeographicPosition,
  GradePercent,
  Kilograms,
  KilometresPerHour,
  Metres,
  MetresPerSecond,
  ResistanceLevel,
  RevolutionsPerMinute,
  Seconds,
  UnixSeconds,
  Watts,
} from './quantities';

export {
  ABSOLUTE_ZERO_DEGREES_CELSIUS,
  altitudeMetres,
  beatsPerMinute,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  kilograms,
  kilometresPerHour,
  metres,
  metresPerSecond,
  resistanceLevel,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
} from './quantities';

// --- Speed ------------------------------------------------------------------

export {
  hundredthsKilometresPerHourToMetresPerSecond,
  kilometresPerHourToMetresPerSecond,
  metresPerSecondToKilometresPerHour,
} from './speed';

// --- Position: the FIT semicircle encoding ----------------------------------

export {
  DEGREES_PER_SEMICIRCLE,
  degreesLatitudeToSemicircles,
  degreesLongitudeToSemicircles,
  latitudeSemicircles,
  longitudeSemicircles,
  SEMICIRCLE_ROUND_TRIP_TOLERANCE_DEGREES,
  SEMICIRCLES_MAX,
  SEMICIRCLES_MIN,
  SEMICIRCLES_PER_HALF_TURN,
  SEMICIRCLES_PER_QUARTER_TURN,
  semicirclesToDegreesLatitude,
  semicirclesToDegreesLongitude,
  semicirclesToPosition,
} from './position';

// The labelling functions are the single point where an unlabelled sint32 off
// the wire becomes a latitude or a longitude. #30 and #31 must call them at the
// field read, where a reviewer can see which field is which; nothing downstream
// re-labels, so a wrong label there is the one transposition no type can catch.
export type { LatitudeSemicircles, LongitudeSemicircles } from './position';

// --- Altitude: the FIT scale-and-offset encoding ----------------------------

export {
  FIT_ALTITUDE_MAX_METRES,
  FIT_ALTITUDE_MIN_METRES,
  FIT_ALTITUDE_OFFSET_METRES,
  FIT_ALTITUDE_SCALE,
  FIT_UINT16_INVALID,
  fitAltitudeToMetres,
  metresToFitAltitude,
} from './altitude';

// --- Time: the FIT epoch, and wrapping event-time counters ------------------

export {
  EVENT_TICKS_PER_SECOND_1024,
  EVENT_TICKS_PER_SECOND_2048,
  eventTickRate,
  eventTicks,
  eventTimeAmbiguityHorizonSeconds,
  eventTimeIntervalIsAmbiguous,
  eventTimeIntervalSeconds,
  FIT_EPOCH_UNIX_SECONDS,
  FIT_SYSTEM_TIME_MAX,
  FIT_TIMESTAMP_MAX,
  fitTimestampToUnixSeconds,
  isFitSystemTime,
  UINT16_MODULUS,
  UINT32_MODULUS,
  unixSecondsToFitTimestamp,
  unsignedCounterDelta,
} from './time';

// The event-time reading is a named-field object rather than three positional
// numbers, because all three are small non-negative integers and every wrong
// ordering of the old signature typechecked (#103). The two brands are what
// stop a tick rate being written into a counter reading's field.
export type { EventTickRate, EventTicks, EventTimeReading } from './time';
