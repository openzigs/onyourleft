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
  | 'unknown-block'
  /**
   * More segments than {@link MAXIMUM_SEGMENTS} once expanded.
   *
   * ⚠️ Not a taste limit. `expandWorkout` allocates one array entry per
   * segment, so an unbounded expansion is a resource-exhaustion path — and
   * since ADR 0017 a workout can arrive from a file, which `CLAUDE.md` §6
   * classes as untrusted input. A hand-edited store row was always the same
   * hazard; this code covers both.
   */
  | 'workout-too-long'
  /**
   * The text handed to the decoder is not an On Your Left workout file.
   *
   * Not JSON at all, not an object, or missing the one key that says what it
   * is — ADR 0017 D-3. Deliberately one code for all three: from a rider's
   * point of view they opened the wrong file, and which of the three ways it
   * was wrong is a detail the message carries rather than a branch a caller
   * wants.
   */
  | 'not-a-workout-file'
  /**
   * A workout file written to a version this build does not read.
   *
   * Distinct from `not-a-workout-file` because the answer a rider needs is
   * different: this one *is* ours, and the fix is a newer build rather than a
   * different file.
   */
  | 'unsupported-version'
  /**
   * A key the format does not define, at any level.
   *
   * ⚠️ ADR 0017 D-4 refuses these rather than ignoring them, which is the
   * opposite of the usual convention and is deliberate: a future field that
   * changes what a workout *does* would otherwise be dropped silently, and the
   * rider would ride something other than what the file says against a machine
   * applying resistance to them.
   */
  | 'unknown-field'
  /**
   * The file is longer than the decoder will parse.
   *
   * The other half of `workout-too-long`: that one bounds what a *valid*
   * workout may expand into, this one bounds how much text is turned into
   * objects in the first place, so that a hostile file cannot spend the memory
   * before anything has had a chance to refuse it.
   */
  | 'file-too-large';

export class WorkoutError extends Error {
  readonly code: WorkoutErrorCode;

  constructor(code: WorkoutErrorCode, message: string) {
    super(message);
    this.name = 'WorkoutError';
    this.code = code;
  }
}
