// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the route profile raises.
 *
 * A single class with a `code`, for the reason `RecordingError` gives: a
 * consumer switches on the code, and a class per failure is five imports to
 * catch one thing.
 *
 * ⚠️ **These are all input errors, not programmer errors**, which is the
 * opposite of `RecordingError`'s posture and deliberate. A route arrives as a
 * file a rider chose, so "this file has three points in it" is a thing to tell
 * them rather than a bug to crash on — #89's fourth criterion asks for exactly
 * that: *"a malformed or empty GPX is rejected with an actionable message
 * naming the problem, not a crash and not a silently empty route."* Every
 * message below therefore names the problem and the constraint.
 *
 * ⚠️ **And never a coordinate's value.** ADR 0004 decision D binds every layer
 * that formats a coordinate into a string, and this is one of them: the
 * endpoint check in {@link RouteError} territory reports *how far apart* the
 * ends are, which is a distance and a diagnostic, and never *where* they are.
 */

/** Why a {@link RouteError} was raised. Switch on this, not on the message. */
export type RouteErrorCode =
  /** Fewer than two points with a position, so there is no path to measure. */
  | 'too-few-points'
  /** Every point is at the same place, so the route has no length. */
  | 'no-distance'
  /** No point carries an elevation, so there is no profile to build. */
  | 'no-elevation'
  /** A construction option is outside what the profile can honour. */
  | 'invalid-option'
  /** `loop` was asserted for a route whose two ends are not the same place. */
  | 'not-a-loop';

/** Raised while building a route profile. @see RouteErrorCode */
export class RouteError extends Error {
  readonly code: RouteErrorCode;

  constructor(code: RouteErrorCode, message: string) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
  }
}
