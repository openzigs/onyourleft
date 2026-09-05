// SPDX-License-Identifier: Apache-2.0

/**
 * The one error type the encoder produces, thrown or collected.
 *
 * It mirrors `decode/errors.ts` deliberately, including the split between
 * thrown and collected, because the two halves of a codec that report problems
 * differently are two things a caller has to learn instead of one.
 *
 * - **Thrown** when no file can be produced at all: there is nothing to write,
 *   or the activity needs more concurrently-bound message shapes than a FIT
 *   file has local message types for.
 * - **Collected into {@link FitEncodeResult.faults}** when the file is written
 *   but something in the input could not be carried into it: a value outside
 *   what any base type in this profile subset can hold, an instant with no FIT
 *   representation, a timestamp that will read back as something else.
 *
 * A collected fault never silently changes a value. The field is **dropped** —
 * written as its base type's invalid marker, or left out of the definition
 * entirely — because a dropped channel reads as a gap, and a clamped one reads
 * as data.
 *
 * **A fault message never carries the value that caused it.** ADR 0004
 * decision D, applied the same way `decode/activity.ts` applies it: the field
 * and the constraint, never the value. An encoder is the more dangerous half
 * here, because the value it is refusing to write is usually the one the rider
 * just recorded.
 */

/** What could not be encoded, as a value rather than as prose. */
export type FitEncodeFaultCode =
  /** There is nothing to write: no records, no laps, no sessions, no summary. */
  | 'nothing-to-encode'
  /** More distinct message shapes than a FIT file has local message types. Thrown. */
  | 'too-many-message-types'
  /**
   * A field holds a value no base type in this profile subset can represent,
   * so the field is dropped. Collected.
   */
  | 'value-not-representable'
  /**
   * An instant has no FIT `date_time` — before the 1989 epoch, or past what a
   * `uint32` holds. The timestamp is dropped. Collected.
   */
  | 'instant-not-representable'
  /**
   * An instant whose FIT `date_time` falls inside the reserved system-time
   * range, so a conforming reader will read it back as seconds since a device
   * powered on rather than as an instant. Written anyway — the format has no
   * other representation — and reported. Collected.
   */
  | 'instant-reads-back-as-system-time';

/** An encoding fault, naming the message and field it came from. */
export class FitEncodeError extends Error {
  override readonly name = 'FitEncodeError';

  /** What could not be encoded. */
  readonly code: FitEncodeFaultCode;

  /**
   * The global message number the fault belongs to, or `undefined` for a fault
   * about the file as a whole.
   *
   * A number rather than a name, so a caller can match on it without matching
   * on a message — the same reason `FitDecodeError` carries a byte offset.
   */
  readonly globalMessageNumber: number | undefined;

  /** The field definition number, when the fault belongs to one field. */
  readonly fieldNumber: number | undefined;

  constructor(
    code: FitEncodeFaultCode,
    message: string,
    where: { globalMessageNumber?: number; fieldNumber?: number } = {},
  ) {
    super(message);
    this.code = code;
    this.globalMessageNumber = where.globalMessageNumber;
    this.fieldNumber = where.fieldNumber;
  }
}
