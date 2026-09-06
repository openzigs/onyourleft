// SPDX-License-Identifier: Apache-2.0

/**
 * The large-file builder, checked against the decoder it feeds — #127.
 *
 * `retention.test.ts` asserts about how much memory decoding this file costs,
 * and that assertion is only worth anything if the file is a real FIT file that
 * really decodes. A builder that produced something the decoder bailed out of
 * after two records would report a very small peak and a very green test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decodeFitActivity } from '../../src';
import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import { SOURCE_FIXTURE, SOURCE_RECORD_COUNT } from './child-contract';
import { repeatFitDataSection } from './large-file';

const SOURCE = Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, SOURCE_FIXTURE)));

describe('repeatFitDataSection', () => {
  it('gives back the source unchanged for one copy', () => {
    // The strongest single statement that the header rewrite and both checksum
    // recomputations are right: at one copy every one of them has to land on
    // the value the committed fixture already carries. A builder that wrote the
    // data size in the wrong byte order, or hashed the wrong range, fails here
    // rather than by producing a file that decodes to slightly the wrong thing.
    expect([...repeatFitDataSection(SOURCE, 1)]).toEqual([...SOURCE]);
  });

  it('decodes to a multiple of the source’s records, with no new fault', () => {
    const source = decodeFitActivity(SOURCE);
    expect(source.faults).toEqual([]);
    expect(source.activity.records).toHaveLength(SOURCE_RECORD_COUNT);

    const grown = decodeFitActivity(repeatFitDataSection(SOURCE, 3));
    expect(grown.activity.records).toHaveLength(SOURCE_RECORD_COUNT * 3);
    // The repetition re-sends `file_id`, which the decoder is right to report
    // and right to keep the first of. That is the *only* fault it may invent:
    // a `bad-file-crc` or a `truncated-record` would mean the file is malformed
    // rather than long.
    expect(new Set(grown.faults.map((fault) => fault.code))).toEqual(
      new Set(['duplicate-file-id']),
    );
    expect(grown.activity.fileId).toEqual(source.activity.fileId);
  });

  it('grows the file by exactly one data section per copy', () => {
    // The data size the committed header declares, read here rather than
    // imported, so this is a second opinion about the number the builder used.
    const headerSize = SOURCE[0] ?? 0;
    const dataSize =
      new DataView(SOURCE.buffer, SOURCE.byteOffset, SOURCE.byteLength).getUint32(4, true) >>> 0;
    expect(SOURCE.length).toBe(headerSize + dataSize + 2);
    for (const copies of [1, 2, 3, 10]) {
      expect(repeatFitDataSection(SOURCE, copies).length, String(copies)).toBe(
        headerSize + dataSize * copies + 2,
      );
    }
  });

  it('refuses a copy count that is not a positive integer', () => {
    for (const copies of [0, -1, 1.5, Number.NaN]) {
      expect(() => repeatFitDataSection(SOURCE, copies), String(copies)).toThrow(RangeError);
    }
  });

  it('refuses a source whose header it cannot believe', () => {
    expect(() => repeatFitDataSection(SOURCE.subarray(0, 8), 2)).toThrow(RangeError);
    const lying = Uint8Array.from(SOURCE);
    // A data size larger than the bytes present: a truncated file, which the
    // decoder is required to survive and this builder is not required to grow.
    lying[4] = 0xff;
    lying[5] = 0xff;
    expect(() => repeatFitDataSection(lying, 2)).toThrow(RangeError);
  });
});
