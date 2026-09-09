// SPDX-License-Identifier: Apache-2.0

/**
 * Why a routing request did not produce a route — [#70](https://github.com/openzigs/onyourleft/issues/70).
 *
 * One class with a `code`, the shape {@link RouteError} uses and for the same
 * reason: a caller switches on the code, and a class per failure is six imports
 * to catch one thing.
 *
 * ⚠️ **The `retryable` flag is the whole point of this type, not a
 * convenience.** #70's criteria name two failures the client must handle
 * *differently* from every other — a 429 and a timeout — because those say
 * "ask again" where the rest say "this route cannot be built". A canvas that
 * treats them alike shows a rider a permanent-looking failure for a transient
 * one, which is #70's *"a blank map"* in its literal form. Nothing infers the
 * distinction from the message.
 *
 * ⚠️ **And never a coordinate's value.** ADR 0004 decision D binds every layer
 * that formats a coordinate into a string, and a routing failure is exactly the
 * layer that wants to: "no path from 51.5074, -0.1278" is a home address in an
 * error toast. So a message here names the **leg** — an index a rider can see
 * on their own screen — and never the place. `route/errors.ts` makes the same
 * choice for the same reason.
 */

/** Why a {@link RoutingError} was raised. Switch on this, not on the message. */
export type RoutingErrorCode =
  /** The engine found no path between two waypoints. Moving one is the fix. */
  | 'no-route'
  /**
   * A waypoint sits on a surface the rider's own settings disallow.
   *
   * ⚠️ Its own code rather than a kind of `no-route`, because ADR 0010 D-4's
   * engine has a setting — {@link SurfaceTolerance} `'paved-only'` — that
   * disallows bad surfaces *including at the endpoints*, which strands a rider
   * whose own driveway is gravel. #70 requires that case to be refused
   * visibly rather than to come back as a mysterious absence of any route.
   */
  | 'unpaved-endpoint'
  /** The engine asked to be called less often. Retryable. */
  | 'rate-limited'
  /** The engine did not answer in time, or answered that it is unwell. Retryable. */
  | 'unavailable'
  /**
   * The engine answered with something this program will not act on.
   *
   * A distance of `NaN`, a leg with one point, a height where a number was
   * promised. #70: *"a malformed or partial response produces a typed error,
   * never a route with `NaN` distance rendered as a real route."*
   */
  | 'malformed-response'
  /** The request itself was not askable — fewer than two waypoints, say. */
  | 'invalid-request';

/** Raised by a {@link RoutingProvider}. @see RoutingErrorCode */
export class RoutingError extends Error {
  readonly code: RoutingErrorCode;

  /**
   * Whether asking again could succeed with nothing else changed.
   *
   * `true` for `rate-limited` and `unavailable` and false for every other code,
   * because the others describe the *request* rather than the moment. Derived
   * from the code rather than passed in, so the two cannot disagree.
   */
  readonly retryable: boolean;

  /** Which leg failed, when the failure belongs to one. Legs are zero-based. */
  readonly leg: number | undefined;

  constructor(code: RoutingErrorCode, message: string, leg?: number) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
    this.retryable = code === 'rate-limited' || code === 'unavailable';
    this.leg = leg;
  }
}
