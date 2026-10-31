// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the lap-race model raises — #1897.
 *
 * Same shape as {@link PacerError}: one class with a `code`, and a message
 * that names **the field and the constraint and never the value** (ADR 0004
 * decision D, `unit-error.ts`). Nothing here is a coordinate — a race counts
 * metres along a lap, never a position on the earth — but a message that
 * never carries a value cannot start carrying a coordinate when a later
 * caller hands one in by mistake.
 */

/** Why a {@link LapRaceError} was raised. Switch on this, not on the message. */
export type LapRaceErrorCode =
  /** A lap length that is not a finite number of metres above zero. */
  | 'lap-length-out-of-range'
  /** A lap count that is not a whole number of at least one. */
  | 'laps-out-of-range'
  /** An effort distance that is not a finite number of metres. */
  | 'effort-distance-not-finite'
  /** An offset change that is not a finite number of metres. */
  | 'offset-not-finite'
  /** An offset bound that is not a finite number of metres above zero, or one above B. */
  | 'bound-out-of-range'
  /** An instant that is not a finite number of milliseconds. */
  | 'instant-not-finite'
  /** A race tick at an instant before the last one (#1899). */
  | 'instant-out-of-order'
  /** A race seed that is not a whole number (#1899). */
  | 'seed-not-integer'
  /** A lane that is not one of the race's lanes (#1899, ADR 0060 D-6.3: lanes are discrete). */
  | 'lane-out-of-range'
  /** A field that is empty, or names one racer twice (#1899). */
  | 'field-invalid';

/** Raised by the lap-race model. @see LapRaceErrorCode */
export class LapRaceError extends Error {
  readonly code: LapRaceErrorCode;

  constructor(code: LapRaceErrorCode, message: string) {
    super(message);
    this.name = 'LapRaceError';
    this.code = code;
  }
}
