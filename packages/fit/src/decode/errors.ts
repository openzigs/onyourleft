// SPDX-License-Identifier: Apache-2.0

/**
 * The one error type the decoder produces, thrown or collected.
 *
 * #30's acceptance criterion for the truncated fixture is *"all records
 * readable up to the truncation **plus a structured error naming the byte
 * offset**"*. So an error here is not a string: it carries a machine-readable
 * {@link FitFaultCode} and the byte offset in the file where the problem is,
 * and the same class is used whether the decoder can continue or not.
 *
 * The split between the two is deliberate and narrow:
 *
 * - **Thrown** when nothing can be believed: the bytes are too short to hold a
 *   header, the `.FIT` signature is absent, or a checksum says the bytes are
 *   not the bytes that were written. There is no partial answer to give.
 * - **Collected into {@link FitDecodeResult.faults}** when the file is
 *   readable up to a point: a truncation, a field the profile cannot label, a
 *   value the domain rejects. The records already read are real data and
 *   discarding them would lose a ride.
 *
 * A silent empty result is never either of those. #30: *"it must not silently
 * return an empty activity — a silent empty result is indistinguishable from a
 * rest day."*
 */

/**
 * What went wrong, as a value rather than as prose.
 *
 * A caller that wants to say "this ride is incomplete" to a rider must be able
 * to tell a truncation from a bad checksum without matching on a message.
 */
export type FitFaultCode =
  /** Fewer bytes than the smallest legal file header. Thrown. */
  | 'file-too-short'
  /** The header's own size byte is not a size a header can have. Thrown. */
  | 'bad-header-size'
  /** Bytes 8..11 are not `.FIT`. Thrown. */
  | 'bad-signature'
  /** The 14-byte header's own CRC does not match its first twelve bytes. Thrown. */
  | 'bad-header-crc'
  /** The trailing CRC does not match the bytes it covers. Thrown. */
  | 'bad-file-crc'
  /** The header promises more data than the file contains. Collected. */
  | 'truncated-file'
  /** A message runs off the end of the available bytes. Collected. */
  | 'truncated-record'
  /** The file ends without the two CRC bytes. Collected. */
  | 'missing-file-crc'
  /** A data message names a local type no definition has bound. Collected. */
  | 'undefined-local-message-type'
  /** A compressed-timestamp record arrived before any full timestamp. Collected. */
  | 'compressed-timestamp-without-reference'
  /**
   * A second `file_id` message arrived after the first. Collected.
   *
   * The first one is kept and the later one is dropped, because `file_id` is
   * the file's identity and the protocol puts it first: manufacturer, serial
   * number and time created are what an importer deduplicates and attributes
   * on. Letting a message further down the file rewrite them means the identity
   * a consumer sees depends on the last such message rather than the first,
   * which is a property a crafted file gets to choose. Reported rather than
   * silently resolved either way, so an importer can refuse a file whose
   * identity is ambiguous.
   */
  | 'duplicate-file-id'
  /** A field decoded to a value `@onyourleft/domain` rejects. Collected. */
  | 'invalid-field-value';

/** A decoding fault, with the byte offset it was found at. */
export class FitDecodeError extends Error {
  override readonly name = 'FitDecodeError';

  /** What went wrong. */
  readonly code: FitFaultCode;

  /**
   * Where in the file it went wrong, counted from byte zero of the whole file
   * rather than from the start of the data section — a rider's hex editor and
   * a bug report both count from the start of the file.
   */
  readonly byteOffset: number;

  constructor(code: FitFaultCode, byteOffset: number, message: string) {
    super(`${message} (at byte ${String(byteOffset)})`);
    this.code = code;
    this.byteOffset = byteOffset;
  }
}
