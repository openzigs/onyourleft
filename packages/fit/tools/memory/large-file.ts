// SPDX-License-Identifier: Apache-2.0

/**
 * A large, valid FIT file built from a small committed one — #127.
 *
 * #127 is about what a **big** file costs, and the corpus cannot hold one: it
 * is capped at 256 KiB by `CORPUS_BYTE_BUDGET`, the corpus directory is closed,
 * and committing a multi-megabyte binary to make one assertion is exactly the
 * accumulation that budget exists to stop. So the file is built at test time,
 * deterministically, out of a fixture that *is* committed.
 *
 * The construction is the only one that keeps the result a real FIT file: a
 * FIT data section is a self-describing stream of definition and data records
 * with no index and no delimiters, so **concatenating a whole data section with
 * itself is a valid data section**. Each copy re-sends its own definition
 * messages before the data messages that use them, which is what a head unit
 * writing a long file does anyway. Only three things then need fixing up, and
 * all three are arithmetic over the file: the header's `dataSize`, the header
 * CRC and the trailing file CRC.
 *
 * It is deliberately **not** a fuzz mutation and deliberately not hostile. The
 * shape #127 measured is an ordinary ride that is simply long, and a bound
 * demonstrated against a crafted file would be answering a different question.
 */

import { fitCrc16, FIT_CRC_SIZE, FIT_LEGACY_HEADER_SIZE } from '../../src/decode';

const DATA_SIZE_OFFSET = 4;
const HEADER_CRC_OFFSET = 12;

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function writeUint16LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * `source` with its data section repeated `copies` times, and every checksum
 * recomputed so the result decodes without a fault the repetition invented.
 *
 * @throws {RangeError} when `copies` is not a positive integer, or when
 * `source` is too short to carry a 14-byte header. Both are programming errors
 * in a test rather than untrusted input, so they throw rather than collect.
 */
export function repeatFitDataSection(source: Uint8Array, copies: number): Uint8Array {
  if (!Number.isInteger(copies) || copies < 1) {
    throw new RangeError(`copies must be a positive integer, not ${String(copies)}`);
  }
  const headerSize = source[0] ?? 0;
  if (headerSize < FIT_LEGACY_HEADER_SIZE || headerSize > source.length) {
    throw new RangeError(
      `the source declares a ${String(headerSize)} byte header it does not have`,
    );
  }
  const dataSize = readUint32LittleEndian(source, DATA_SIZE_OFFSET);
  const data = source.subarray(headerSize, headerSize + dataSize);
  if (data.length !== dataSize) {
    throw new RangeError(
      `the source declares ${String(dataSize)} bytes of data and carries ${String(data.length)}`,
    );
  }

  const grownDataSize = dataSize * copies;
  const declaredEnd = headerSize + grownDataSize;
  const out = new Uint8Array(declaredEnd + FIT_CRC_SIZE);
  out.set(source.subarray(0, headerSize), 0);
  writeUint32LittleEndian(out, DATA_SIZE_OFFSET, grownDataSize);
  for (let copy = 0; copy < copies; copy += 1) out.set(data, headerSize + copy * dataSize);

  // The header CRC covers the first twelve bytes and exists only in the
  // 14-byte header form; the file CRC covers the header and every record byte.
  if (headerSize > HEADER_CRC_OFFSET) {
    writeUint16LittleEndian(out, HEADER_CRC_OFFSET, fitCrc16(out, 0, HEADER_CRC_OFFSET));
  }
  writeUint16LittleEndian(out, declaredEnd, fitCrc16(out, 0, declaredEnd));
  return out;
}
