// SPDX-License-Identifier: Apache-2.0

/**
 * The fuzz case generator — #128.
 *
 * Pure: it takes a seed, some seed files and a budget, and returns the
 * mutated buffers. It reads nothing off disk and decodes nothing, so the case
 * list can be asserted about directly and the same generator serves the FIT
 * decoder and the GPX/TCX readers rather than each growing its own.
 *
 * ## The thing that makes this fuzz the parser rather than the checksum
 *
 * A FIT file ends with a CRC over every byte before it, and `readFitContainer`
 * throws `bad-file-crc` before it looks at a single record. So **flipping a bit
 * in a valid FIT file and decoding it tests the checksum and nothing else** —
 * every case bounces off the same guard, the run is green, and it has explored
 * none of the record loop. That is the failure mode this generator exists to
 * avoid, and it is why {@link repairFitChecksums} is here: half the mutations
 * are repaired, so the corrupted bytes reach the code that has to survive them.
 *
 * The unrepaired half is kept as well, because the checksum gate is itself a
 * boundary that has to fail cleanly rather than throw a `RangeError`.
 *
 * ## The mutation kinds, and what each is for
 *
 * | Kind | What it finds |
 * | --- | --- |
 * | `bit-flip` | a single wrong bit in a length, a base type or a value |
 * | `byte-set` | a wholly different byte, which reaches sizes and counts a single flip cannot |
 * | `byte-sweep` | **every** offset, twice — see below |
 * | `truncate` | a file that stops mid-anything — the class that produces an out-of-bounds read |
 * | `random-bytes` | input that is not this format at all |
 * | `random-framed` | a **valid FIT header** wrapped around random data, with both checksums repaired: random *records*, which is the only case class that reaches the record loop with no structure at all |
 *
 * ## Why the exhaustive sweep exists, which is the second trap
 *
 * Random single-byte mutations do not find a bounds bug, and this was measured
 * rather than assumed. The bytes that decide *how much the parser reads* — a
 * field's size, a developer field's size, a field count — are a few dozen bytes
 * out of a twenty-kilobyte corpus, and only one seed file carries a developer
 * field at all. A budget of 160 random flips per file hits one of them about
 * once, and hits it with a *smaller* value half the time. Removing the
 * developer-field term from `container.ts`'s record-length check — the M16
 * defect #128 names as the mutation that must go red — left 320 random
 * mutations of `developer-fields.fit` producing 2,218 decoded messages and
 * **zero** violations.
 *
 * {@link FuzzBudget.byteSweep} is the fix: **every** offset of every seed file
 * gets its high bit set and, separately, gets `0xFF`. Both turn a small width
 * into a large one — `0x02` becomes `0x82`, which is 130 bytes — so every size
 * and count byte in the corpus is guaranteed to be enlarged rather than
 * probabilistically sampled. It is exhaustive in offset and deliberately narrow
 * in value, which is what keeps it linear in corpus size instead of 256 times
 * it.
 */

import { fitCrc16 } from '../fixture-corpus/fit-crc';
import type { FuzzRandom } from './random';
import { createFuzzRandom } from './random';

/** How a case was derived from its seed file. */
export type FuzzCaseKind =
  'bit-flip' | 'byte-set' | 'byte-sweep' | 'truncate' | 'random-bytes' | 'random-framed';

/** One seed file, as it was read off disk. */
export interface FuzzSeedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** One generated case, carrying everything needed to reproduce it. */
export interface FuzzCase {
  /** Position in the generated list. Stable for a given seed and budget. */
  readonly index: number;
  readonly kind: FuzzCaseKind;
  /** The seed file it came from, or `<generated>` for a synthesised buffer. */
  readonly source: string;
  /** Where the mutation landed, or `-1` when the whole buffer is the mutation. */
  readonly byteOffset: number;
  /** Whether the FIT header and file checksums were recomputed afterwards. */
  readonly checksumsRepaired: boolean;
  readonly bytes: Uint8Array;
}

/** How many cases of each kind to generate. */
export interface FuzzBudget {
  readonly bitFlipsPerFile: number;
  readonly byteSetsPerFile: number;
  /**
   * The step between truncation lengths. `1` is *every* offset.
   *
   * Truncation is quadratic in file size — every prefix of an n-byte file is
   * n parses averaging n/2 bytes — so a stride is how a large seed file stays
   * inside a seconds-long budget. The FIT budget uses `1`; see
   * `decode-fuzz.test.ts` for why the XML one does not.
   */
  readonly truncationStride: number;
  readonly randomBuffers: number;
  /**
   * Whether to also sweep **every** byte offset, setting the high bit and then
   * writing `0xFF`. Two cases per byte of seed material; see the note at the
   * top of this file for why the random kinds do not replace it.
   */
  readonly byteSweep: boolean;
  readonly randomFramedBuffers: number;
  /** The longest synthesised buffer, in bytes. */
  readonly randomBufferMaximumBytes: number;
  /**
   * Whether half the mutations get their FIT checksums recomputed.
   *
   * `true` for FIT seed files — see the note at the top of this file, which is
   * the difference between fuzzing the record parser and fuzzing the checksum.
   * `false` for GPX and TCX, which carry no checksum: leaving it on would make
   * every case claim a repair that never happened.
   */
  readonly repairFitChecksums: boolean;
}

const FIT_HEADER_BYTES = 14;
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54];
const FIT_CRC_BYTES = 2;

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

/**
 * Recompute a FIT file's header CRC and trailing file CRC in place.
 *
 * Returns the same array, mutated. Does nothing to a buffer too short to hold a
 * header, and leaves the file CRC alone when the declared data section runs
 * past the end of the buffer — that is a genuinely truncated file, and the
 * decoder reaches its record loop through the `truncated-file` path without
 * verifying a checksum it cannot compute.
 */
export function repairFitChecksums(bytes: Uint8Array): Uint8Array {
  if (bytes.length < FIT_HEADER_BYTES) return bytes;
  const headerSize = bytes[0] ?? 0;
  if (headerSize !== 12 && headerSize !== FIT_HEADER_BYTES) return bytes;
  if (headerSize === FIT_HEADER_BYTES) {
    writeUint16(bytes, 12, fitCrc16(bytes.subarray(0, 12)));
  }
  const dataSize =
    (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 24);
  const declaredEnd = headerSize + (dataSize >>> 0);
  if (declaredEnd + FIT_CRC_BYTES > bytes.length) return bytes;
  writeUint16(bytes, declaredEnd, fitCrc16(bytes.subarray(0, declaredEnd)));
  return bytes;
}

function flipBit(source: Uint8Array, offset: number, bit: number): Uint8Array {
  const out = Uint8Array.from(source);
  out[offset] = (out[offset] ?? 0) ^ (1 << bit);
  return out;
}

function setByte(source: Uint8Array, offset: number, value: number): Uint8Array {
  const out = Uint8Array.from(source);
  out[offset] = value;
  return out;
}

/**
 * Every case for a seed, a set of seed files and a budget.
 *
 * Deterministic in all three: the same arguments give the same buffers in the
 * same order, which is what makes a printed case index a reproduction
 * instruction rather than a curiosity. Seed files are consumed in the order
 * given, so callers sort them.
 */
export function fuzzCases(
  seed: number,
  files: readonly FuzzSeedFile[],
  budget: FuzzBudget,
): FuzzCase[] {
  const random = createFuzzRandom(seed);
  const cases: FuzzCase[] = [];
  const push = (
    kind: FuzzCaseKind,
    source: string,
    byteOffset: number,
    checksumsRepaired: boolean,
    bytes: Uint8Array,
  ): void => {
    cases.push({ index: cases.length, kind, source, byteOffset, checksumsRepaired, bytes });
  };

  for (const file of files) {
    for (let n = 0; n < budget.bitFlipsPerFile; n += 1) {
      if (file.bytes.length === 0) break;
      const offset = random.below(file.bytes.length);
      const bit = random.below(8);
      // Alternating rather than random, so each file gets both halves of the
      // repaired/unrepaired split however small its share of the budget is.
      const repair = budget.repairFitChecksums && n % 2 === 0;
      const mutated = flipBit(file.bytes, offset, bit);
      push('bit-flip', file.name, offset, repair, repair ? repairFitChecksums(mutated) : mutated);
    }

    for (let n = 0; n < budget.byteSetsPerFile; n += 1) {
      if (file.bytes.length === 0) break;
      const offset = random.below(file.bytes.length);
      const value = random.below(256);
      const repair = budget.repairFitChecksums && n % 2 === 0;
      const mutated = setByte(file.bytes, offset, value);
      push('byte-set', file.name, offset, repair, repair ? repairFitChecksums(mutated) : mutated);
    }

    if (budget.byteSweep) {
      for (let offset = 0; offset < file.bytes.length; offset += 1) {
        for (const value of [(file.bytes[offset] ?? 0) | 0x80, 0xff]) {
          const mutated = setByte(file.bytes, offset, value);
          push(
            'byte-sweep',
            file.name,
            offset,
            budget.repairFitChecksums,
            budget.repairFitChecksums ? repairFitChecksums(mutated) : mutated,
          );
        }
      }
    }

    for (let length = 0; length < file.bytes.length; length += budget.truncationStride) {
      // Never repaired: a truncated file is exactly the case where the decoder
      // must reach its record loop *without* a verifiable checksum, and
      // repairing one would replace that path with a well-formed short file.
      push('truncate', file.name, length, false, file.bytes.slice(0, length));
    }
  }

  for (let n = 0; n < budget.randomBuffers; n += 1) {
    const length = random.below(budget.randomBufferMaximumBytes + 1);
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) bytes[index] = random.below(256);
    push('random-bytes', '<generated>', -1, false, bytes);
  }

  for (let n = 0; n < budget.randomFramedBuffers; n += 1) {
    push('random-framed', '<generated>', -1, true, randomFramedFitFile(random, budget));
  }

  return cases;
}

/**
 * A syntactically valid FIT header wrapped around random record bytes, with
 * both checksums correct.
 *
 * The most productive case class there is, and the one a naive fuzzer never
 * reaches: every byte after the header is arbitrary, so record headers,
 * definition messages, field counts, base types and developer field widths are
 * all adversarial at once, and nothing bounces off the signature or the CRC on
 * the way in.
 */
export function randomFramedFitFile(random: FuzzRandom, budget: FuzzBudget): Uint8Array {
  const dataSize = random.below(budget.randomBufferMaximumBytes + 1);
  const bytes = new Uint8Array(FIT_HEADER_BYTES + dataSize + FIT_CRC_BYTES);
  bytes[0] = FIT_HEADER_BYTES;
  bytes[1] = 0x20;
  writeUint16(bytes, 2, random.below(0x10000));
  bytes[4] = dataSize & 0xff;
  bytes[5] = (dataSize >>> 8) & 0xff;
  bytes[6] = (dataSize >>> 16) & 0xff;
  bytes[7] = (dataSize >>> 24) & 0xff;
  bytes.set(FIT_SIGNATURE, 8);
  for (let index = 0; index < dataSize; index += 1) {
    bytes[FIT_HEADER_BYTES + index] = random.below(256);
  }
  return repairFitChecksums(bytes);
}

/**
 * A one-line reproduction instruction for a case.
 *
 * #128: *"a failure prints enough to reproduce it — seed, case index, byte
 * offset"*. All three are here, plus the seed file and whether the checksums
 * were repaired, because those two decide which half of the decoder the case
 * even reached.
 */
export function describeCase(seed: number, fuzzCase: FuzzCase): string {
  const offset =
    fuzzCase.byteOffset === -1 ? 'whole buffer' : `byte ${String(fuzzCase.byteOffset)}`;
  return (
    `seed 0x${seed.toString(16)} case ${String(fuzzCase.index)} ` +
    `[${fuzzCase.kind} of ${fuzzCase.source} at ${offset}, ` +
    `${fuzzCase.checksumsRepaired ? 'checksums repaired' : 'checksums left broken'}, ` +
    `${String(fuzzCase.bytes.length)} bytes]`
  );
}
