// SPDX-License-Identifier: Apache-2.0

/**
 * The errors building a ghost track raises.
 *
 * Same shape and posture as {@link PacerError} and {@link RouteError}: one class
 * with a `code`, a message naming the problem and the constraint, and an **input
 * error rather than a programmer error**. The input here is a ride the athlete
 * actually recorded, and a recorded ride can be short, can be missing its
 * distance channel, or can have a distance that goes backwards after a bad GPS
 * fix — none of which is a bug in this package, and all of which a screen has to
 * be able to say something about.
 */

/** Why a {@link GhostError} was raised. Switch on this, not on the message. */
export type GhostErrorCode =
  /**
   * Fewer than two samples, so there is nothing to interpolate between.
   *
   * A one-sample ride is a real thing — a recording that was stopped
   * immediately — and it is not a ghost.
   */
  | 'too-few-samples'
  /** The time and distance series are different lengths. */
  | 'length-mismatch'
  /** Elapsed time does not increase strictly, so a lookup would be ambiguous. */
  | 'time-not-increasing'
  /**
   * Distance decreases somewhere.
   *
   * ⚠️ Refused rather than repaired. A ghost is a claim about what the rider
   * did, and quietly clamping a backwards step would move the ghost to a place
   * the rider was never at — which is the fabrication `analysis/load.ts`'s gap
   * rule refuses for the same reason. The caller can decide to drop the ride
   * from the offer; this cannot decide to invent it.
   */
  | 'distance-not-monotonic'
  /** A sample is not a finite number. */
  | 'sample-not-finite';

/** Raised while building or reading a ghost track. @see GhostErrorCode */
export class GhostError extends Error {
  readonly code: GhostErrorCode;

  constructor(code: GhostErrorCode, message: string) {
    super(message);
    this.name = 'GhostError';
    this.code = code;
  }
}
