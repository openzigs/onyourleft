// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the recording engine raises.
 *
 * A single class with a `code` rather than a class per failure, for the reason
 * `packages/sensors`' `SensorError` gives: a consumer switches on the code, and
 * a hierarchy of five classes is five imports to catch one thing.
 *
 * ⚠️ **Only programmer errors are raised.** An illegal state transition is a
 * bug in the caller and must be loud — #45 asks specifically for "an explicit
 * error rather than a no-op". Everything that comes off a *sensor* is untrusted
 * input and is never a throw: a reading that arrives too late, too early, or
 * while the session is paused is reported as a {@link RecordingOutcome} and
 * counted, because a hostile or broken device must not be able to abort a
 * ride's recording by sending a bad timestamp.
 */

/** Why a {@link RecordingError} was raised. Switch on this, not on the message. */
export type RecordingErrorCode =
  /** A transition the state machine does not permit — recording from stopped. */
  | 'illegal-transition'
  /** Something that needs a started session was called on an idle one. */
  | 'not-started'
  /** A construction option is outside what the engine can honour. */
  | 'invalid-option'
  /** A restored snapshot does not describe a session this build can continue. */
  | 'invalid-snapshot';

/** Raised by the recording engine. @see RecordingErrorCode */
export class RecordingError extends Error {
  readonly code: RecordingErrorCode;

  constructor(code: RecordingErrorCode, message: string) {
    super(message);
    this.name = 'RecordingError';
    this.code = code;
  }
}
