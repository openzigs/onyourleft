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
  /** An offset bound that is not a finite number of metres above zero. */
  | 'bound-out-of-range'
  /** An instant that is not a finite number of milliseconds. */
  | 'instant-not-finite';

/** Raised by the lap-race model. @see LapRaceErrorCode */
export class LapRaceError extends Error {
  readonly code: LapRaceErrorCode;

  constructor(code: LapRaceErrorCode, message: string) {
    super(message);
    this.name = 'LapRaceError';
    this.code = code;
  }
}
