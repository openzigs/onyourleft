// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT container, written.
 *
 * The mirror of `decode/container.ts`, and it takes its layout from the same
 * record in `packages/fit/README.md` §3 rather than from a second reading:
 *
 *   header      size(1) protocolVersion(1) profileVersion(2) dataSize(4)
 *               ".FIT"(4) headerCrc(2)
 *   record      headerByte(1), then either a definition or a data message
 *   definition  reserved(1) architecture(1) globalMessageNumber(2) fieldCount(1)
 *               then fieldCount x [ number(1) size(1) baseType(1) ]
 *               then, if the developer flag is set, developerFieldCount(1)
 *               then that many [ number(1) size(1) developerDataIndex(1) ]
 *   data        the field values back to back, in the order and at the sizes
 *               the matching definition declared. No delimiters.
 *   footer      crc(2) over the header and every record byte
 *
 * **No Garmin FIT SDK, `Profile.xlsx`, `fit-sdk-tools` artefact, `FitCSVTool`,
 * `Fitgen` or `ActivityRepairTool` was consulted, downloaded, installed or read
 * in the course of this work** (ADR 0006 R1, R4).
 *
 * ## Three things this writer does that a naive one does not
 *
 * 1. **A definition always precedes the first data message that uses it.**
 *    That is #31's first practical constraint and it is structural here rather
 *    than a convention: a shape is turned into a local message type by
 *    {@link FitContainerWriter.message}, which emits the definition the first
 *    time it sees one and never afterwards. There is no way to write a data
 *    message for a shape that has not been defined.
 * 2. **A local message type is never rebound.** The decoder handles rebinding
 *    because real files do it; this writer refuses to, because the only reason
 *    to rebind is to run out of the sixteen available, and silently reusing one
 *    would make every earlier definition unreadable to a streaming reader.
 *    Running out is an error, not a rebinding.
 * 3. **The header's data size and both CRCs are computed from the bytes
 *    actually written**, never from a running total kept alongside them. A
 *    counter that drifts from the buffer produces a file every reader rejects
 *    and nothing local notices.
 *
 * Everything is written little-endian, and the definition messages say so —
 * the architecture byte is `0`. The decoder reads either order; there is no
 * reason for a writer to offer a choice.
 */

import { baseTypeInvalidValue, baseTypeIsSigned, BASE_TYPE_NUMBER } from '../decode/base-types';
import { FIT_HEADER_SIZE } from '../decode/container';
import { fitCrc16, FIT_CRC_SIZE } from '../decode/crc';
import { ByteSink } from './byte-sink';
import { FitEncodeError } from './errors';
import { encodeFitString } from './utf8';

/** How the endian-sensitive base types are spelled in a definition message. */
const ENDIAN = 0x80;

/**
 * The base type bytes this encoder writes.
 *
 * The low five bits are the type number from `decode/base-types.ts`; bit 7
 * marks a type whose byte order follows the definition's architecture field, so
 * the one-byte types do not carry it.
 */
export const BASE_TYPE = {
  enum: BASE_TYPE_NUMBER.enum,
  sint8: BASE_TYPE_NUMBER.sint8,
  uint8: BASE_TYPE_NUMBER.uint8,
  sint16: ENDIAN | BASE_TYPE_NUMBER.sint16,
  uint16: ENDIAN | BASE_TYPE_NUMBER.uint16,
  sint32: ENDIAN | BASE_TYPE_NUMBER.sint32,
  uint32: ENDIAN | BASE_TYPE_NUMBER.uint32,
  string: BASE_TYPE_NUMBER.string,
  byte: BASE_TYPE_NUMBER.byte,
} as const;

/**
 * The protocol version byte this encoder writes: major 2, minor 0.
 *
 * The high nibble is the major version and the low nibble the minor.
 */
export const FIT_PROTOCOL_VERSION = 0x20;

/**
 * The profile version this encoder stamps into every file it writes.
 *
 * **This project's own constant, not a Garmin release number**, for the reason
 * `tools/fixture-corpus/fit-file-builder.ts` gives about the corpus: the field
 * exists and a reader will read it, and a value claiming to be an SDK version
 * would under ADR 0006 R2 be a record of a rule violation rather than a fact.
 */
export const ONYOURLEFT_PROFILE_VERSION = 1;

/** `.FIT`, the four-byte data type signature at header offset 8. */
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54] as const;

const RECORD_HEADER_DEFINITION = 0x40;
const RECORD_HEADER_DEVELOPER_DATA = 0x20;

/** A FIT file has four bits of local message type, so sixteen may be bound. */
export const LOCAL_MESSAGE_TYPE_COUNT = 16;

/** One field of a definition message, as this encoder declares it. */
export interface EncodeFieldDefinition {
  readonly number: number;
  /** The whole field's width in bytes, which for a string is more than one. */
  readonly size: number;
  /** A value from {@link BASE_TYPE}. */
  readonly baseType: number;
}

/** One developer field of a definition message. */
export interface EncodeDeveloperFieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly developerDataIndex: number;
}

/** The shape of a message: its global number and the fields it declares. */
export interface EncodeMessageShape {
  readonly globalMessageNumber: number;
  readonly fields: readonly EncodeFieldDefinition[];
  readonly developerFields?: readonly EncodeDeveloperFieldDefinition[];
}

/**
 * A value written into one field.
 *
 * `undefined` in the numeric case is a **gap**, and it is written as the base
 * type's invalid marker rather than as zero. That is the whole of #31's
 * criterion that *"gaps in a stream encode as absent records, not as
 * zero-valued records"* at the field level; the record level is
 * `encode/activity.ts`, which declines to declare a channel no record carries
 * at all.
 */
export type EncodeValue =
  | { readonly kind: 'numeric'; readonly value: number | undefined }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: Uint8Array };

/** A number, or a gap. */
export function numericValue(value: number | undefined): EncodeValue {
  return { kind: 'numeric', value };
}

/** Text, for a `string` field. */
export function textValue(value: string): EncodeValue {
  return { kind: 'text', value };
}

/** Raw bytes, for a `byte` field or a developer field carried verbatim. */
export function bytesValue(value: Uint8Array): EncodeValue {
  return { kind: 'bytes', value };
}

/** A key that is equal exactly when two shapes would produce the same definition. */
function shapeKey(shape: EncodeMessageShape): string {
  const fields = shape.fields
    .map((field) => `${String(field.number)}:${String(field.size)}:${String(field.baseType)}`)
    .join(',');
  const developer = (shape.developerFields ?? [])
    .map(
      (field) =>
        `${String(field.number)}:${String(field.size)}:${String(field.developerDataIndex)}`,
    )
    .join(',');
  return `${String(shape.globalMessageNumber)}|${fields}|${developer}`;
}

export class FitContainerWriter {
  readonly #sink: ByteSink;
  readonly #localTypes = new Map<string, number>();
  #nextLocalType = 0;

  constructor(capacityHint = FIT_HEADER_SIZE + FIT_CRC_SIZE) {
    this.#sink = new ByteSink(capacityHint);
    this.#writeHeaderPlaceholder();
  }

  #writeHeaderPlaceholder(): void {
    this.#sink.u8(FIT_HEADER_SIZE);
    this.#sink.u8(FIT_PROTOCOL_VERSION);
    this.#sink.u16(ONYOURLEFT_PROFILE_VERSION);
    // Back-filled in `finish()` from the bytes actually written.
    this.#sink.u32(0);
    for (const byte of FIT_SIGNATURE) this.#sink.u8(byte);
    this.#sink.u16(0);
  }

  /** How many local message types have been bound. */
  get boundLocalTypeCount(): number {
    return this.#localTypes.size;
  }

  /**
   * Write one data message, emitting its definition first if this shape has not
   * been seen.
   *
   * @throws {FitEncodeError} `too-many-message-types` when a seventeenth
   * distinct shape is written. Rebinding an existing local type would be the
   * alternative and it is refused; see the module comment.
   */
  message(shape: EncodeMessageShape, values: readonly EncodeValue[]): this {
    const key = shapeKey(shape);
    let localType = this.#localTypes.get(key);
    if (localType === undefined) {
      if (this.#nextLocalType >= LOCAL_MESSAGE_TYPE_COUNT) {
        throw new FitEncodeError(
          'too-many-message-types',
          `this activity needs more than the ${String(LOCAL_MESSAGE_TYPE_COUNT)} local message ` +
            'types a FIT file can bind at once, and rebinding one would make every earlier ' +
            'definition unreadable to a streaming reader',
          { globalMessageNumber: shape.globalMessageNumber },
        );
      }
      localType = this.#nextLocalType;
      this.#nextLocalType += 1;
      this.#localTypes.set(key, localType);
      this.#writeDefinition(localType, shape);
    }

    this.#sink.u8(localType);
    shape.fields.forEach((field, index) => {
      this.#writeValue(field.size, field.baseType, values[index]);
    });
    // Developer fields follow the native ones, in declaration order, and their
    // values continue the same array. They have no base type in the definition
    // — only a size and the index of the application that described them — so
    // they are written as the bytes they came in as.
    (shape.developerFields ?? []).forEach((field, index) => {
      this.#writeValue(field.size, BASE_TYPE.byte, values[shape.fields.length + index]);
    });
    return this;
  }

  #writeDefinition(localType: number, shape: EncodeMessageShape): void {
    const developerFields = shape.developerFields ?? [];
    this.#sink.u8(
      RECORD_HEADER_DEFINITION |
        (developerFields.length > 0 ? RECORD_HEADER_DEVELOPER_DATA : 0) |
        localType,
    );
    this.#sink.u8(0); // reserved
    this.#sink.u8(0); // architecture: little-endian
    this.#sink.u16(shape.globalMessageNumber);
    this.#sink.u8(shape.fields.length);
    for (const field of shape.fields) {
      this.#sink.u8(field.number).u8(field.size).u8(field.baseType);
    }
    if (developerFields.length > 0) {
      this.#sink.u8(developerFields.length);
      for (const field of developerFields) {
        this.#sink.u8(field.number).u8(field.size).u8(field.developerDataIndex);
      }
    }
  }

  #writeValue(size: number, baseType: number, value: EncodeValue | undefined): void {
    if (value?.kind === 'text') {
      this.#sink.raw(encodeFitString(value.value, size));
      return;
    }
    if (value?.kind === 'bytes') {
      const bytes = value.value.subarray(0, size);
      this.#sink.raw(bytes);
      // A short `byte` field is padded with the invalid marker for that type,
      // which is 0xFF per element — never zero, which is a legal byte value.
      for (let index = bytes.length; index < size; index += 1) this.#sink.u8(0xff);
      return;
    }

    const raw = value?.kind === 'numeric' ? value.value : undefined;
    const invalid = baseTypeInvalidValue(baseType);
    if (raw === undefined) {
      // A gap. Write the invalid marker across the whole field, per element, so
      // an array-shaped field is as absent as a scalar one.
      const pattern = invalid ?? 0xff;
      this.#writeNumber(size, baseType, pattern);
      return;
    }
    this.#writeNumber(size, baseType, raw);
  }

  #writeNumber(size: number, baseType: number, raw: number): void {
    const signed = baseTypeIsSigned(baseType);
    if (size === 1) {
      if (signed) this.#sink.i8(raw);
      else this.#sink.u8(raw);
      return;
    }
    if (size === 2) {
      if (signed) this.#sink.i16(raw);
      else this.#sink.u16(raw);
      return;
    }
    if (signed) this.#sink.i32(raw);
    else this.#sink.u32(raw);
  }

  /**
   * Close the file: back-fill the data size, both CRCs, and return the bytes.
   *
   * The data size is `length - FIT_HEADER_SIZE` measured from the sink, the
   * header CRC covers bytes 0..11 **after** the data size has been written into
   * them, and the file CRC covers every byte before itself. Getting the order
   * of those three wrong produces a file that reads back fine here and is
   * rejected everywhere else, which is #31's whole reason for existing.
   */
  finish(): Uint8Array {
    this.#sink.patchU32(4, this.#sink.length - FIT_HEADER_SIZE);
    this.#sink.patchU16(12, fitCrc16(this.#sink.written(), 0, 12));
    this.#sink.u16(fitCrc16(this.#sink.written(), 0, this.#sink.length));
    return this.#sink.take();
  }
}
