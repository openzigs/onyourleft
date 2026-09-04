// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT container: a file header, a stream of definition and data records,
 * and a trailing checksum.
 *
 * ## Provenance — ADR 0006 R2
 *
 * Every layout number here comes from the public FIT protocol documentation at
 * `developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html`,
 * corroborated against the independent format reference at
 * `fitfileeditor.com/skill`, both read 2026-09-04, and is tabulated with its
 * source in `packages/fit/README.md`. No Garmin FIT SDK, `Profile.xlsx` or
 * Garmin FIT tool was consulted (R1, R4).
 *
 *   header      size(1) protocolVersion(1) profileVersion(2) dataSize(4)
 *               ".FIT"(4) [ headerCrc(2) ]
 *   record      headerByte(1), then either a definition or a data message
 *   definition  reserved(1) architecture(1) globalMessageNumber(2) fieldCount(1)
 *               then fieldCount x [ number(1) size(1) baseType(1) ]
 *               then, if the developer flag is set, developerFieldCount(1)
 *               then that many [ number(1) size(1) developerDataIndex(1) ]
 *   data        the field values back to back, in the order and at the sizes
 *               the matching definition declared. No delimiters.
 *   footer      crc(2) over the header and every record byte
 *
 * ## Local message types are rebindable, and this is where that is honoured
 *
 * A local message type is the file's own four-bit short name for a definition,
 * and a file may rebind one part-way through — #30's second acceptance
 * criterion, and *"the most common source of silently-wrong FIT output"*. The
 * binding below is a plain `Map` write, so a later definition replaces an
 * earlier one. That is one line, it is trivially right, and it is trivially
 * wrong the other way: a decoder that keeps the first definition per local type
 * produces plausible garbage on long files. `container.test.ts` proves this one
 * by mutation.
 *
 * ## Nothing here throws on file content it can survive
 *
 * `SECURITY.md` puts activity file parsing in scope and requires malformed
 * input to produce an error rather than a crash. So the record loop always
 * advances by at least one byte, every read is bounds-checked against the end
 * of the available data, and running out of bytes ends the loop with a fault
 * rather than an exception. Only the header — where nothing at all can be
 * believed — throws.
 */

import type { FitFieldValue } from './base-types';
import { readFieldValue } from './base-types';
import { fitCrc16, FIT_CRC_SIZE } from './crc';
import { FitDecodeError } from './errors';

/** The smallest legal file header: the 12-byte form, with no header CRC. */
export const FIT_LEGACY_HEADER_SIZE = 12;

/** The preferred file header: 12 bytes plus the header's own CRC. */
export const FIT_HEADER_SIZE = 14;

/** `.FIT`, the four-byte data type signature at header offset 8. */
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54];

const RECORD_HEADER_COMPRESSED = 0x80;
const RECORD_HEADER_DEFINITION = 0x40;
const RECORD_HEADER_DEVELOPER_DATA = 0x20;
const RECORD_HEADER_LOCAL_TYPE_MASK = 0x0f;
const COMPRESSED_LOCAL_TYPE_SHIFT = 5;
const COMPRESSED_LOCAL_TYPE_MASK = 0x03;

/**
 * The compressed timestamp header carries five bits of seconds, so it rolls
 * over every 32 seconds relative to the most recent full timestamp.
 */
export const COMPRESSED_TIME_OFFSET_MASK = 0x1f;
export const COMPRESSED_TIME_OFFSET_PERIOD = 0x20;

/** The reserved field definition number every message uses for its `date_time`. */
export const FIELD_TIMESTAMP = 253;

/** The file header, as read. */
export interface FitFileHeader {
  readonly headerSize: number;
  readonly protocolVersion: number;
  /**
   * The `profile_version` field, read because it is there.
   *
   * It carries no meaning for this decoder and must not be given one: the
   * fixture corpus stamps its own constant into it precisely so that it does
   * not claim to be a Garmin SDK version, which under ADR 0006 R2 would be a
   * record of a rule violation rather than a fact.
   */
  readonly profileVersion: number;
  readonly dataSize: number;
  /** Present only in the 14-byte form. `0` means the writer did not compute one. */
  readonly headerCrc: number | undefined;
}

/** One field of a definition message. */
export interface FitFieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly baseType: number;
}

/** One developer field of a definition message. */
export interface FitDeveloperFieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly developerDataIndex: number;
}

/** A developer field as it was found in a data message, before it is described. */
export interface FitDeveloperFieldValue {
  readonly developerDataIndex: number;
  readonly fieldDefinitionNumber: number;
  readonly byteOffset: number;
  /**
   * The byte order the definition message declared, carried on the value
   * because a developer field is decoded later — once its `field_description`
   * has been seen — and by then the definition it came from is out of scope.
   */
  readonly littleEndian: boolean;
  /** The field's bytes. A view into the file, not a copy. */
  readonly bytes: Uint8Array;
}

/** A definition message, as bound to a local message type. */
export interface FitMessageDefinition {
  readonly globalMessageNumber: number;
  readonly littleEndian: boolean;
  readonly fields: readonly FitFieldDefinition[];
  readonly developerFields: readonly FitDeveloperFieldDefinition[];
  /** The number of bytes one data message against this definition occupies. */
  readonly bodySize: number;
}

/** One data message, decoded against the definition its local type was bound to. */
export interface FitMessage {
  readonly globalMessageNumber: number;
  readonly localMessageType: number;
  /** Where the record header byte is, counted from byte zero of the file. */
  readonly byteOffset: number;
  readonly fields: readonly FitFieldValue[];
  readonly developerFields: readonly FitDeveloperFieldValue[];
  /**
   * The full `date_time` a compressed timestamp header denotes, when the record
   * carried one. Absent on an ordinary record, which carries its timestamp as
   * field 253 like any other field.
   */
  readonly compressedTimestamp: number | undefined;
}

/** Everything the container layer knows, before any profile is applied. */
export interface FitContainer {
  readonly header: FitFileHeader;
  readonly messages: readonly FitMessage[];
  /** Recoverable faults, in the order they were found. */
  readonly faults: readonly FitDecodeError[];
}

function readHeader(bytes: Uint8Array, view: DataView): FitFileHeader {
  if (bytes.length < FIT_LEGACY_HEADER_SIZE) {
    throw new FitDecodeError(
      'file-too-short',
      0,
      `a FIT file needs at least ${String(FIT_LEGACY_HEADER_SIZE)} bytes for its header, ` +
        `this one has ${String(bytes.length)}`,
    );
  }

  const headerSize = view.getUint8(0);
  if (headerSize < FIT_LEGACY_HEADER_SIZE || headerSize > bytes.length) {
    throw new FitDecodeError(
      'bad-header-size',
      0,
      `the header declares a size of ${String(headerSize)} bytes, which is neither at least ` +
        `${String(FIT_LEGACY_HEADER_SIZE)} nor within the ${String(bytes.length)} bytes present`,
    );
  }

  const signatureMatches = FIT_SIGNATURE.every((byte, index) => view.getUint8(8 + index) === byte);
  if (!signatureMatches) {
    throw new FitDecodeError(
      'bad-signature',
      8,
      'the four bytes at offset 8 are not the ".FIT" data type signature',
    );
  }

  const headerCrc = headerSize >= FIT_HEADER_SIZE ? view.getUint16(12, true) : undefined;
  if (headerCrc !== undefined && headerCrc !== 0) {
    const computed = fitCrc16(bytes, 0, 12);
    if (computed !== headerCrc) {
      throw new FitDecodeError(
        'bad-header-crc',
        12,
        `the header CRC is 0x${headerCrc.toString(16).padStart(4, '0')} but its first 12 bytes ` +
          `check to 0x${computed.toString(16).padStart(4, '0')}`,
      );
    }
  }

  return {
    headerSize,
    protocolVersion: view.getUint8(1),
    profileVersion: view.getUint16(2, true),
    dataSize: view.getUint32(4, true),
    headerCrc,
  };
}

function readDefinition(
  view: DataView,
  offset: number,
  end: number,
  hasDeveloperFields: boolean,
): { definition: FitMessageDefinition; next: number } | undefined {
  if (offset + 5 > end) return undefined;
  const littleEndian = view.getUint8(offset + 1) === 0;
  const globalMessageNumber = view.getUint16(offset + 2, littleEndian);
  const fieldCount = view.getUint8(offset + 4);

  let cursor = offset + 5;
  if (cursor + fieldCount * 3 > end) return undefined;
  const fields: FitFieldDefinition[] = [];
  for (let index = 0; index < fieldCount; index += 1) {
    fields.push({
      number: view.getUint8(cursor),
      size: view.getUint8(cursor + 1),
      baseType: view.getUint8(cursor + 2),
    });
    cursor += 3;
  }

  const developerFields: FitDeveloperFieldDefinition[] = [];
  if (hasDeveloperFields) {
    if (cursor + 1 > end) return undefined;
    const developerFieldCount = view.getUint8(cursor);
    cursor += 1;
    if (cursor + developerFieldCount * 3 > end) return undefined;
    for (let index = 0; index < developerFieldCount; index += 1) {
      developerFields.push({
        number: view.getUint8(cursor),
        size: view.getUint8(cursor + 1),
        developerDataIndex: view.getUint8(cursor + 2),
      });
      cursor += 3;
    }
  }

  const bodySize =
    fields.reduce((total, field) => total + field.size, 0) +
    developerFields.reduce((total, field) => total + field.size, 0);

  return {
    definition: { globalMessageNumber, littleEndian, fields, developerFields, bodySize },
    next: cursor,
  };
}

/**
 * The full `date_time` a five-bit time offset denotes.
 *
 * The offset counts seconds within a 32-second window anchored on the most
 * recent full timestamp. When the offset has gone backwards the window has
 * rolled over, so a period is added — which is the whole reason this is
 * arithmetic rather than a substitution.
 */
export function expandCompressedTimestamp(previous: number, timeOffset: number): number {
  const delta = (timeOffset - previous) & COMPRESSED_TIME_OFFSET_MASK;
  return previous + delta;
}

/**
 * Read a whole FIT container.
 *
 * @throws {FitDecodeError} when the header or a checksum makes the bytes
 * unbelievable — `file-too-short`, `bad-header-size`, `bad-signature`,
 * `bad-header-crc`, `bad-file-crc`. Everything else is a collected fault.
 */
export function readFitContainer(bytes: Uint8Array): FitContainer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readHeader(bytes, view);
  const faults: FitDecodeError[] = [];

  const declaredEnd = header.headerSize + header.dataSize;
  const truncated = declaredEnd > bytes.length;
  const end = truncated ? bytes.length : declaredEnd;

  if (truncated) {
    faults.push(
      new FitDecodeError(
        'truncated-file',
        bytes.length,
        `the header declares ${String(header.dataSize)} bytes of data ending at byte ` +
          `${String(declaredEnd)}, but the file ends at byte ${String(bytes.length)}; ` +
          `${String(declaredEnd - bytes.length)} bytes are missing`,
      ),
    );
  } else if (bytes.length < declaredEnd + FIT_CRC_SIZE) {
    faults.push(
      new FitDecodeError(
        'missing-file-crc',
        bytes.length,
        'the file ends without its two trailing CRC bytes, so its contents cannot be verified',
      ),
    );
  } else {
    const stored = view.getUint16(declaredEnd, true);
    const computed = fitCrc16(bytes, 0, declaredEnd);
    if (stored !== computed) {
      throw new FitDecodeError(
        'bad-file-crc',
        declaredEnd,
        `the file CRC is 0x${stored.toString(16).padStart(4, '0')} but its ` +
          `${String(declaredEnd)} bytes check to 0x${computed.toString(16).padStart(4, '0')}`,
      );
    }
  }

  const definitions = new Map<number, FitMessageDefinition>();
  const messages: FitMessage[] = [];
  let lastFullTimestamp: number | undefined;
  let offset = header.headerSize;

  while (offset < end) {
    const recordStart = offset;
    const recordHeader = view.getUint8(offset);
    offset += 1;

    if ((recordHeader & RECORD_HEADER_COMPRESSED) !== 0) {
      const localMessageType =
        (recordHeader >> COMPRESSED_LOCAL_TYPE_SHIFT) & COMPRESSED_LOCAL_TYPE_MASK;
      const timeOffset = recordHeader & COMPRESSED_TIME_OFFSET_MASK;
      if (lastFullTimestamp === undefined) {
        faults.push(
          new FitDecodeError(
            'compressed-timestamp-without-reference',
            recordStart,
            'a compressed timestamp header arrived before any message carried a full timestamp, ' +
              'so its five-bit offset has nothing to be relative to',
          ),
        );
      }
      const timestamp =
        lastFullTimestamp === undefined
          ? undefined
          : expandCompressedTimestamp(lastFullTimestamp, timeOffset);
      if (timestamp !== undefined) lastFullTimestamp = timestamp;
      const read = readDataMessage(
        bytes,
        view,
        definitions,
        localMessageType,
        recordStart,
        offset,
        end,
        timestamp,
        faults,
      );
      if (!read) break;
      messages.push(read.message);
      offset = read.next;
      continue;
    }

    const localMessageType = recordHeader & RECORD_HEADER_LOCAL_TYPE_MASK;

    if ((recordHeader & RECORD_HEADER_DEFINITION) !== 0) {
      const read = readDefinition(
        view,
        offset,
        end,
        (recordHeader & RECORD_HEADER_DEVELOPER_DATA) !== 0,
      );
      if (!read) {
        faults.push(
          new FitDecodeError(
            'truncated-record',
            recordStart,
            `the definition message for local type ${String(localMessageType)} beginning at byte ` +
              `${String(recordStart)} runs past the end of the data at byte ${String(end)}`,
          ),
        );
        break;
      }
      // A plain write: a later definition rebinds the local message type, and
      // every data message after it is read against the new one.
      definitions.set(localMessageType, read.definition);
      offset = read.next;
      continue;
    }

    const read = readDataMessage(
      bytes,
      view,
      definitions,
      localMessageType,
      recordStart,
      offset,
      end,
      undefined,
      faults,
    );
    if (!read) break;
    const timestamp = read.message.fields.find(
      (field) => field.number === FIELD_TIMESTAMP,
    )?.numeric;
    if (timestamp !== undefined) lastFullTimestamp = timestamp;
    messages.push(read.message);
    offset = read.next;
  }

  return { header, messages, faults };
}

function readDataMessage(
  bytes: Uint8Array,
  view: DataView,
  definitions: ReadonlyMap<number, FitMessageDefinition>,
  localMessageType: number,
  recordStart: number,
  bodyStart: number,
  end: number,
  compressedTimestamp: number | undefined,
  faults: FitDecodeError[],
): { message: FitMessage; next: number } | undefined {
  const definition = definitions.get(localMessageType);
  if (!definition) {
    faults.push(
      new FitDecodeError(
        'undefined-local-message-type',
        recordStart,
        `a data message names local message type ${String(localMessageType)}, which no definition ` +
          'message has bound; without a definition its length is unknown and the record stream ' +
          'cannot be resynchronised',
      ),
    );
    return undefined;
  }

  if (bodyStart + definition.bodySize > end) {
    faults.push(
      new FitDecodeError(
        'truncated-record',
        recordStart,
        `the data message for local type ${String(localMessageType)} (global message ` +
          `${String(definition.globalMessageNumber)}) beginning at byte ${String(recordStart)} ` +
          `needs ${String(definition.bodySize)} bytes but only ${String(end - bodyStart)} are ` +
          `available before the end of the data at byte ${String(end)}`,
      ),
    );
    return undefined;
  }

  let cursor = bodyStart;
  const fields: FitFieldValue[] = [];
  for (const field of definition.fields) {
    fields.push(readFieldValue(bytes, view, field, cursor, definition.littleEndian));
    cursor += field.size;
  }

  const developerFields: FitDeveloperFieldValue[] = [];
  for (const field of definition.developerFields) {
    developerFields.push({
      developerDataIndex: field.developerDataIndex,
      fieldDefinitionNumber: field.number,
      byteOffset: cursor,
      littleEndian: definition.littleEndian,
      bytes: bytes.subarray(cursor, cursor + field.size),
    });
    cursor += field.size;
  }

  return {
    message: {
      globalMessageNumber: definition.globalMessageNumber,
      localMessageType,
      byteOffset: recordStart,
      fields,
      developerFields,
      compressedTimestamp,
    },
    next: cursor,
  };
}
