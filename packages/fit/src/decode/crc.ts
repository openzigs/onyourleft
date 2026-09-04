// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT checksum, as the decoder computes it.
 *
 * ## Provenance — ADR 0006 R2 and R3
 *
 * FIT's checksum is **CRC-16/ARC**: reflected polynomial `0xA001`
 * (`x^16 + x^15 + x^2 + 1`), initial value `0x0000`, no final XOR, input and
 * output reflected. The public FIT protocol documentation at
 * `developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html` (read
 * 2026-09-04) presents the same function as a sixteen-entry nibble lookup
 * table inside a C routine. **That routine is expression and is not reproduced
 * here** — ADR 0006 R3 permits recording the numbers that describe a wire
 * format and forbids copying anyone's expression of them. The polynomial is
 * the number; the loop below is derived from it.
 *
 * Independently pinned in `crc.test.ts` against the CRC catalogue's published
 * check value for CRC-16/ARC — `0xBB3D` over the nine ASCII bytes `123456789`
 * — which comes from the general CRC literature and touches nothing of
 * Garmin's.
 *
 * ## Why this is not `tools/fixture-corpus/fit-crc.ts`
 *
 * `fixtures/README.md` §6: *"A fixture validated only by the code under test
 * proves that the two share a bug; #30's decoder must be able to disagree with
 * this generator."* The generator's checksum and the decoder's are written
 * from the same public description and are deliberately separate pieces of
 * code, so that the corpus tests are a real cross-check rather than an
 * identity.
 */

/** The reflected form of the CRC-16/ARC generator polynomial. */
export const FIT_CRC_REFLECTED_POLYNOMIAL = 0xa001;

/** The value a FIT CRC starts from. */
export const FIT_CRC_INITIAL_VALUE = 0x0000;

/** The width of the trailing file checksum, in bytes. */
export const FIT_CRC_SIZE = 2;

/**
 * The FIT CRC over `bytes[start, end)`.
 *
 * A range rather than a subarray, because every caller here checksums a slice
 * of a file it already holds and `subarray` on a `Uint8Array` backed by a
 * larger buffer is one more offset to get wrong.
 */
export function fitCrc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = FIT_CRC_INITIAL_VALUE;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ FIT_CRC_REFLECTED_POLYNOMIAL : crc >>> 1;
    }
  }
  return crc & 0xffff;
}
