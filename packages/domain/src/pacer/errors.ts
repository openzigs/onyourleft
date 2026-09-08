// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the bot pacer's plan raises.
 *
 * Same shape and same posture as {@link RouteError}: one class with a `code`, a
 * message naming the problem and the constraint, and **an input error rather
 * than a programmer error** — a target intensity is a number a rider picked on
 * a screen, so "0.1 w/kg is below what this can pace" is a thing to tell them.
 */

/** Why a {@link PacerError} was raised. Switch on this, not on the message. */
export type PacerErrorCode =
  /** The target intensity is outside the range a bot will ride at. */
  | 'intensity-out-of-range'
  /** The bot's mass is not a mass a bicycle could carry. */
  | 'mass-out-of-range';

/** Raised while building a bot pacer's plan. @see PacerErrorCode */
export class PacerError extends Error {
  readonly code: PacerErrorCode;

  constructor(code: PacerErrorCode, message: string) {
    super(message);
    this.name = 'PacerError';
    this.code = code;
  }
}
