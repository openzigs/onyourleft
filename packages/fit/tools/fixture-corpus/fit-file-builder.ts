// SPDX-License-Identifier: Apache-2.0

/**
 * A FIT container writer, for fixtures only.
 *
 * ## What it implements, and where that came from
 *
 * The container: a 14-byte file header, a stream of definition and data
 * records, and a trailing CRC. Read from the public FIT protocol documentation
 * at `developer.garmin.com/fit/protocol/` and corroborated against the
 * independent references named in `fixtures/README.md`, all on 2026-09-03. No
 * Garmin FIT SDK artefact was consulted (ADR 0006 R1, R4).
 *
 *   header    size(1) protocolVersion(1) profileVersion(2) dataSize(4)
 *             ".FIT"(4) headerCrc(2)
 *   record    headerByte(1) then, for a definition message,
 *             reserved(1) architecture(1) globalMessageNumber(2) fieldCount(1)
 *             then fieldCount x [ number(1) size(1) baseType(1) ]
 *             then, if the developer flag is set,
 *             developerFieldCount(1) then that many
 *             [ number(1) size(1) developerDataIndex(1) ]
 *   data      the field values back to back, in the order and at the sizes the
 *             matching definition declared. There are no delimiters, which is
 *             why a definition and its data must be built together.
 *   footer    crc(2), over the header and every record byte
 *
 * ## This is a writer, not half a decoder
 *
 * It never reads a FIT file. #30 writes the decoder, and it has to be able to
 * disagree with this file: a corpus checked by the parser it exists to test
 * proves only that the two share a bug.
 *
 * ## Positions can only be written one way, on purpose
 *
 * `positionValue()` is the single route by which a latitude or a longitude
 * reaches the file, and it records the byte offset of both fields as it writes
 * them. That is what lets the ADR 0004 decision G guard read every position out
 * of the committed bytes instead of trusting the generator's own account of
 * what it wrote. A second route would be a position the guard cannot see, so
 * there is not one — the two `sint32` fields are emitted as one indivisible
 * unit, which is also how a FIT record message lays them out.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import { degreesLatitudeToSemicircles, degreesLongitudeToSemicircles } from '@onyourleft/domain';

import { ByteWriter } from './byte-writer';
import { fitCrc16 } from './fit-crc';

/** The 14-byte header this generator always writes. */
export const FIT_HEADER_SIZE = 14;

/** The size of the trailing file CRC. */
export const FIT_CRC_SIZE = 2;

/**
 * The protocol version byte: major 2, minor 0.
 *
 * The high nibble is the major version and the low nibble the minor, so 2.0 is
 * `0x20`.
 */
export const FIT_PROTOCOL_VERSION = 0x20;

/**
 * The profile version this corpus stamps into every fixture.
 *
 * **This project's own constant, not a Garmin release number.** It is written
 * because the field exists and a decoder must read it; it deliberately does not
 * claim to be any SDK version, which under ADR 0006 R2 would be a record of a
 * rule violation rather than a fact. #30 must not treat it as meaningful.
 */
export const FIXTURE_PROFILE_VERSION = 1;

/** `.FIT`, the four-byte data type signature at header offset 8. */
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54];

const RECORD_HEADER_DEFINITION = 0x40;
const RECORD_HEADER_DEVELOPER_DATA = 0x20;
const MAXIMUM_LOCAL_MESSAGE_TYPE = 15;

/** One field of a definition message. */
export interface FieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly baseType: number;
}

/** One developer field of a definition message. */
export interface DeveloperFieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly developerDataIndex: number;
}

/** Where a position landed in the finished file. */
export interface PositionFieldOffsets {
  readonly latitudeOffset: number;
  readonly longitudeOffset: number;
}

/** A value to write into a data message, sized by the matching definition. */
export type FieldValue =
  | { readonly kind: 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32'; readonly value: number }
  | { readonly kind: 'position'; readonly value: GeographicPosition }
  | { readonly kind: 'raw'; readonly value: readonly number[] }
  | { readonly kind: 'string'; readonly value: string; readonly size: number };

/** The only way to put a position into a fixture. See the module comment. */
export function positionValue(value: GeographicPosition): FieldValue {
  return { kind: 'position', value };
}

/** Where a data message began, in the finished file. */
export interface DataMessageStart {
  readonly localMessageType: number;
  readonly offset: number;
}

/** A finished fixture: its bytes, where every position landed, and the record map. */
export interface FitFixture {
  readonly bytes: Uint8Array;
  readonly positionOffsets: readonly PositionFieldOffsets[];
  /**
   * Where each data message started. Only the truncation fixture uses it, and
   * it uses it so the cut can be located inside a record message by name rather
   * than by a byte count somebody would have to re-derive by hand.
   */
  readonly dataMessageStarts: readonly DataMessageStart[];
}

/** How to damage a file on the way out, for the corruption fixtures. */
export interface FinishOptions {
  /**
   * Keep only this many bytes of the data section, leaving the header's
   * `dataSize` claiming the full length and dropping the file CRC entirely.
   * A head unit whose battery died mid-record produces exactly this.
   */
  readonly truncateDataToBytes?: number;
}

export class FitFileBuilder {
  readonly #data = new ByteWriter();
  readonly #positionOffsets: PositionFieldOffsets[] = [];
  readonly #dataMessageStarts: DataMessageStart[] = [];

  /**
   * Write a definition message binding a local message type to a global one.
   *
   * Local message types are the file's own short names for a definition, four
   * bits wide, and a file may rebind one part-way through. `#30` has a criterion
   * about exactly that; this builder allows it by not tracking bindings.
   */
  definition(
    localMessageType: number,
    globalMessageNumber: number,
    fields: readonly FieldDefinition[],
    developerFields: readonly DeveloperFieldDefinition[] = [],
  ): this {
    assertLocalMessageType(localMessageType);
    const hasDeveloperFields = developerFields.length > 0;
    this.#data.u8(
      RECORD_HEADER_DEFINITION |
        (hasDeveloperFields ? RECORD_HEADER_DEVELOPER_DATA : 0) |
        localMessageType,
    );
    this.#data.u8(0); // reserved
    this.#data.u8(0); // architecture: little endian
    this.#data.u16(globalMessageNumber);
    this.#data.u8(fields.length);
    for (const field of fields) {
      this.#data.u8(field.number).u8(field.size).u8(field.baseType);
    }
    if (hasDeveloperFields) {
      this.#data.u8(developerFields.length);
      for (const field of developerFields) {
        this.#data.u8(field.number).u8(field.size).u8(field.developerDataIndex);
      }
    }
    return this;
  }

  /** Write a data message against the definition bound to `localMessageType`. */
  data(localMessageType: number, values: readonly FieldValue[]): this {
    assertLocalMessageType(localMessageType);
    this.#dataMessageStarts.push({
      localMessageType,
      offset: FIT_HEADER_SIZE + this.#data.offset,
    });
    this.#data.u8(localMessageType);
    for (const value of values) {
      this.#write(value);
    }
    return this;
  }

  #write(value: FieldValue): void {
    switch (value.kind) {
      case 'u8':
        this.#data.u8(value.value);
        return;
      case 'i8':
        this.#data.i8(value.value);
        return;
      case 'u16':
        this.#data.u16(value.value);
        return;
      case 'i16':
        this.#data.i16(value.value);
        return;
      case 'u32':
        this.#data.u32(value.value);
        return;
      case 'i32':
        this.#data.i32(value.value);
        return;
      case 'raw':
        this.#data.raw(value.value);
        return;
      case 'string':
        this.#data.asciiString(value.value, value.size);
        return;
      case 'position': {
        // `latitudeSemicircles` and `longitudeSemicircles` are distinct branded
        // types in packages/domain, so the two lines below cannot be swapped
        // without a compile error — which is the transposition no range check
        // catches, because most of Europe is a valid position either way round.
        const latitudeOffset = FIT_HEADER_SIZE + this.#data.offset;
        this.#data.i32(degreesLatitudeToSemicircles(value.value.latitude));
        const longitudeOffset = FIT_HEADER_SIZE + this.#data.offset;
        this.#data.i32(degreesLongitudeToSemicircles(value.value.longitude));
        this.#positionOffsets.push({ latitudeOffset, longitudeOffset });
        return;
      }
    }
  }

  /** Assemble the header, the data records and the trailing CRC. */
  finish(options: FinishOptions = {}): FitFixture {
    const full = this.#data.toUint8Array();
    const truncated = options.truncateDataToBytes !== undefined;
    const data = truncated ? full.subarray(0, options.truncateDataToBytes) : full;

    const header = new ByteWriter();
    header.u8(FIT_HEADER_SIZE);
    header.u8(FIT_PROTOCOL_VERSION);
    header.u16(FIXTURE_PROFILE_VERSION);
    // Deliberately the UNtruncated length: the header of a file whose write was
    // interrupted still promises the data the device meant to write. A decoder
    // that trusts it and reads past the end is the defect this fixture exists
    // to find.
    header.u32(full.length);
    header.raw(FIT_SIGNATURE);
    const headerBytes = header.toUint8Array();
    header.u16(fitCrc16(headerBytes));

    const withHeader = header.toUint8Array();
    const out = new ByteWriter();
    out.raw(withHeader).raw(data);

    if (!truncated) {
      out.u16(fitCrc16(data, fitCrc16(withHeader)));
    }

    // A position whose field was cut off by the truncation is no longer in the
    // file, so the guard must not go looking for it at an offset past the end.
    const length = out.offset;
    const positionOffsets = this.#positionOffsets.filter(
      (offsets) => offsets.longitudeOffset + 4 <= length,
    );

    return {
      bytes: out.toUint8Array(),
      positionOffsets,
      dataMessageStarts: this.#dataMessageStarts.filter((start) => start.offset < length),
    };
  }
}

function assertLocalMessageType(localMessageType: number): void {
  if (
    !Number.isInteger(localMessageType) ||
    localMessageType < 0 ||
    localMessageType > MAXIMUM_LOCAL_MESSAGE_TYPE
  ) {
    throw new RangeError(
      `local message type must be a whole number between 0 and ${String(MAXIMUM_LOCAL_MESSAGE_TYPE)}, received ${String(localMessageType)}`,
    );
  }
}
