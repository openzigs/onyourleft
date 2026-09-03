// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT checksum.
 *
 * A FIT file carries two of these: a CRC over the first twelve header bytes
 * (optional, and present here because a 14-byte header is the preferred form),
 * and a CRC over the header and every data record, written little-endian as the
 * last two bytes of the file.
 *
 * ## Provenance — ADR 0006 R2/R3
 *
 * FIT's checksum is **CRC-16/ARC**: the reflected polynomial `0xA001`
 * (`x^16 + x^15 + x^2 + 1`), initial value `0x0000`, no final XOR, input and
 * output reflected. The public descriptions of the FIT protocol give it as a
 * sixteen-entry nibble lookup table; that table is not reproduced here, because
 * ADR 0006 R3 permits recording the numbers that describe a wire format and
 * forbids copying anyone's expression of them. The polynomial is the number.
 * The bitwise loop below is derived from it, and `fit-crc.test.ts` regenerates
 * the nibble table from the same polynomial and checks the two agree, so the
 * equivalence is asserted rather than assumed.
 *
 * Independently pinned against the CRC catalogue's published check value for
 * CRC-16/ARC — `0xBB3D` over the nine ASCII bytes `123456789` — which is a
 * value from the general CRC literature and touches nothing of Garmin's.
 *
 * Sources, read 2026-09-03: the public FIT protocol documentation at
 * `developer.garmin.com/fit/protocol/`; the independent format reference at
 * `fitfileeditor.com/skill`. No Garmin FIT SDK artefact was consulted.
 */

/** The reflected form of the CRC-16/ARC generator polynomial. */
export const FIT_CRC_REFLECTED_POLYNOMIAL = 0xa001;

/** The value a FIT CRC starts from, and the seed for the first chunk. */
export const FIT_CRC_INITIAL_VALUE = 0x0000;

/**
 * The FIT CRC over `bytes`, optionally continuing from a previous chunk.
 *
 * Seedable because the file CRC covers the header and the data records, and
 * this generator produces them separately — running the two through one call
 * would mean concatenating them a second time for no reason.
 */
export function fitCrc16(bytes: Uint8Array, seed: number = FIT_CRC_INITIAL_VALUE): number {
  let crc = seed & 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ FIT_CRC_REFLECTED_POLYNOMIAL : crc >>> 1;
    }
  }
  return crc & 0xffff;
}
