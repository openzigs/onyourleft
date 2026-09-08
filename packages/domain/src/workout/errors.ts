// SPDX-License-Identifier: Apache-2.0

/**
 * Why a workout could not be built — #14.
 *
 * The same shape as `RouteError`: a code a caller can branch on and a message a
 * rider can act on. A workout drives a trainer that applies physical resistance
 * to somebody who is pedalling, so a malformed one is refused outright rather
 * than clamped into something plausible — `CLAUDE.md` §6 calls trainer control
 * a safety question and not only a security one.
 */

export type WorkoutErrorCode =
  /** No blocks, so there is nothing to ride. */
  | 'empty-workout'
  /** A block whose duration is zero, negative or not finite. */
  | 'invalid-duration'
  /**
   * A target outside {@link MINIMUM_SHARE}..{@link MAXIMUM_SHARE}.
   *
   * Both ends matter. Zero would be a target of no power, which is a free ride
   * expressed as an ERG target and is not the same thing; and a share above the
   * maximum is far more likely to be a percentage written as `250` than a rider
   * who meant two and a half times threshold.
   */
  | 'target-out-of-range'
  /** A repeat count that is zero, negative, not an integer, or absurd. */
  | 'invalid-repeat'
  /** A block kind the model does not have. */
  | 'unknown-block';

export class WorkoutError extends Error {
  readonly code: WorkoutErrorCode;

  constructor(code: WorkoutErrorCode, message: string) {
    super(message);
    this.name = 'WorkoutError';
    this.code = code;
  }
}
