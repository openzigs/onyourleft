// SPDX-License-Identifier: Apache-2.0

/**
 * A minimal FIT writer, for the decoder's own unit tests.
 *
 * ## Why not `tools/fixture-corpus/fit-file-builder.ts`
 *
 * Two reasons, and the second is the one that matters.
 *
 * 1. It cannot write the cases this decoder has to handle. Every fixture in
 *    the #29 corpus declares little-endian architecture and none carries a
 *    compressed timestamp header — `fixtures/README.md` §6 lists both as
 *    deliberate gaps, along with a file that rebinds a local message type
 *    mid-file and a file with a *wrong* CRC rather than an absent one. This
 *    writer exists to produce exactly those four.
 * 2. `fixtures/README.md` §6 again: *"A fixture validated only by the code
 *    under test proves that the two share a bug."* The corpus tests are a
 *    cross-check between two independently written implementations; these unit
 *    tests are the decoder examined against bytes laid out by hand. Sharing a
 *    writer between them would collapse the two into one.
 *
 * It is deliberately dumb: it tracks no bindings, checks no sizes against
 * definitions, and will happily write a file that makes no sense. A test that
 * wants a malformed file should be able to ask for one.
 */

import { fitCrc16 } from '../crc';

/** `.FIT`, the four-byte data type signature at header offset 8. */
const SIGNATURE = [0x2e, 0x46, 0x49, 0x54];

/** One field of a definition message. */
export interface TestFieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly baseType: number;
}

/** One developer field of a definition message. */
export interface TestDeveloperFieldDefinition {
  readonly number: number;
  readonly size: number;
  readonly developerDataIndex: number;
}

/** How to finish a file, including the ways to break one. */
export interface FinishOptions {
  /** 14 by default; 12 writes the legacy header with no header CRC. */
  readonly headerSize?: number;
  /** Write this as the header's `data_size` instead of the real length. */
  readonly declaredDataSize?: number;
  /** Write a header CRC that is wrong. */
  readonly corruptHeaderCrc?: boolean;
  /** Write a file CRC that is wrong. */
  readonly corruptFileCrc?: boolean;
  /** Leave the two trailing CRC bytes off entirely. */
  readonly omitFileCrc?: boolean;
  /** Keep only this many bytes of the data section. */
  readonly truncateDataToBytes?: number;
}

/** Little-endian encodings, spelled out so a test can read the bytes it means. */
export const bytes = {
  u8: (value: number): number[] => [value & 0xff],
  u16: (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff],
  u16be: (value: number): number[] => [(value >>> 8) & 0xff, value & 0xff],
  u32: (value: number): number[] => [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ],
  u32be: (value: number): number[] => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ],
};

/** A FIT file, assembled a record at a time. */
export class FitBytes {
  #data: number[] = [];

  definition(
    localMessageType: number,
    globalMessageNumber: number,
    fields: readonly TestFieldDefinition[],
    options: {
      readonly bigEndian?: boolean;
      readonly developerFields?: readonly TestDeveloperFieldDefinition[];
    } = {},
  ): this {
    const developerFields = options.developerFields ?? [];
    const bigEndian = options.bigEndian ?? false;
    this.#data.push(0x40 | (developerFields.length > 0 ? 0x20 : 0) | localMessageType);
    this.#data.push(0);
    this.#data.push(bigEndian ? 1 : 0);
    this.#data.push(
      ...(bigEndian ? bytes.u16be(globalMessageNumber) : bytes.u16(globalMessageNumber)),
    );
    this.#data.push(fields.length);
    for (const field of fields) {
      this.#data.push(field.number, field.size, field.baseType);
    }
    if (developerFields.length > 0) {
      this.#data.push(developerFields.length);
      for (const field of developerFields) {
        this.#data.push(field.number, field.size, field.developerDataIndex);
      }
    }
    return this;
  }

  /** A data message with a normal record header. */
  data(localMessageType: number, body: readonly number[]): this {
    this.#data.push(localMessageType & 0x0f, ...body);
    return this;
  }

  /** A data message with a compressed timestamp header. */
  compressed(localMessageType: number, timeOffset: number, body: readonly number[]): this {
    this.#data.push(0x80 | ((localMessageType & 0x03) << 5) | (timeOffset & 0x1f), ...body);
    return this;
  }

  finish(options: FinishOptions = {}): Uint8Array {
    const headerSize = options.headerSize ?? 14;
    const full = this.#data;
    const data =
      options.truncateDataToBytes === undefined ? full : full.slice(0, options.truncateDataToBytes);
    const declaredDataSize = options.declaredDataSize ?? full.length;

    const header: number[] = [
      headerSize,
      0x20,
      ...bytes.u16(1),
      ...bytes.u32(declaredDataSize),
      ...SIGNATURE,
    ];
    if (headerSize >= 14) {
      const crc = fitCrc16(Uint8Array.from(header), 0, 12);
      header.push(...bytes.u16(options.corruptHeaderCrc === true ? (crc ^ 0xffff) & 0xffff : crc));
    }

    const out = [...header, ...data];
    if (options.omitFileCrc !== true) {
      const crc = fitCrc16(Uint8Array.from(out));
      out.push(...bytes.u16(options.corruptFileCrc === true ? (crc ^ 0xffff) & 0xffff : crc));
    }
    return Uint8Array.from(out);
  }
}
