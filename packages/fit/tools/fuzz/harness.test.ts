// SPDX-License-Identifier: Apache-2.0

/**
 * The fuzz harness examined, rather than trusted.
 *
 * `@onyourleft/store/testing`'s `harness.test.ts` sets the standard this
 * follows: *"the same assertion body run green against the real store and red
 * against a fake … is the only honest proof that a harness works"*. A fuzz
 * harness has exactly the same failure mode as a round-trip harness — it runs
 * tens of thousands of cases, reports green, and would have reported green with
 * its assertions deleted.
 *
 * So each invariant below is run against something that satisfies it and
 * against something that does not, and the second is required to throw
 * `FuzzFailure`. The generator gets the same treatment: determinism is the
 * whole contract of a *seeded* fuzz, and it is asserted rather than assumed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FitContainer, FitDecodeResult, FitMessage } from '../../src';
import { ActivityXmlError, decodeFitActivity, FitDecodeError, readFitContainer } from '../../src';
import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import type { FuzzBudget } from './cases';
import { describeCase, fuzzCases, repairFitChecksums } from './cases';
import {
  assertMessagesInsideTheDataSection,
  assertOutputBoundedByInput,
  assertTypedFailure,
  FuzzFailure,
} from './invariants';
import { createFuzzRandom } from './random';

const BUDGET: FuzzBudget = {
  bitFlipsPerFile: 4,
  byteSetsPerFile: 4,
  byteSweep: false,
  truncationStride: 400,
  randomBuffers: 4,
  randomFramedBuffers: 4,
  randomBufferMaximumBytes: 64,
  repairFitChecksums: true,
};

function fixture(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));
}

const CLEAN = fixture('developer-fields.fit');
const SEED_FILES = [{ name: 'developer-fields.fit', bytes: CLEAN }];

describe('the seeded random source', () => {
  it('gives the same sequence for the same seed, every time', () => {
    const first = Array.from({ length: 16 }, () => createFuzzRandom(1234).u32());
    // Sixteen fresh streams on the same seed, so this pins the seeding rather
    // than one stream's continuation.
    expect(new Set(first).size).toBe(1);

    const a = createFuzzRandom(0x0f170128);
    const b = createFuzzRandom(0x0f170128);
    expect(Array.from({ length: 64 }, () => a.u32())).toEqual(
      Array.from({ length: 64 }, () => b.u32()),
    );
  });

  it('gives a different sequence for a different seed', () => {
    const a = createFuzzRandom(1);
    const b = createFuzzRandom(2);
    expect(Array.from({ length: 32 }, () => a.u32())).not.toEqual(
      Array.from({ length: 32 }, () => b.u32()),
    );
  });

  it('bounds below() and answers 0 for an empty range', () => {
    const random = createFuzzRandom(7);
    for (let n = 0; n < 200; n += 1) {
      const value = random.below(13);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(13);
    }
    expect(createFuzzRandom(7).below(0)).toBe(0);
    expect(createFuzzRandom(7).below(-1)).toBe(0);
  });
});

describe('the case generator', () => {
  it('is a pure function of its seed, its files and its budget', () => {
    const first = fuzzCases(99, SEED_FILES, BUDGET);
    const again = fuzzCases(99, SEED_FILES, BUDGET);
    expect(first.length).toBe(again.length);
    for (const [index, fuzzCase] of first.entries()) {
      expect(fuzzCase.index).toBe(index);
      expect(again[index]).toEqual(fuzzCase);
    }
  });

  it('produces different material for a different seed', () => {
    const flips = (seed: number): number[] =>
      fuzzCases(seed, SEED_FILES, BUDGET)
        .filter((fuzzCase) => fuzzCase.kind === 'bit-flip')
        .map((fuzzCase) => fuzzCase.byteOffset);
    expect(flips(1)).not.toEqual(flips(2));
  });

  it('never hands back the seed file unchanged', () => {
    // A generator that returned the original would be a suite of decodes of
    // valid files reported as a fuzz run.
    for (const fuzzCase of fuzzCases(5, SEED_FILES, BUDGET)) {
      if (fuzzCase.kind === 'truncate' && fuzzCase.byteOffset === CLEAN.length) continue;
      expect([...fuzzCase.bytes]).not.toEqual([...CLEAN]);
    }
  });

  it('sweeps every offset twice when the budget asks for it', () => {
    const swept = fuzzCases(5, SEED_FILES, { ...BUDGET, byteSweep: true }).filter(
      (fuzzCase) => fuzzCase.kind === 'byte-sweep',
    );
    expect(swept.length).toBe(CLEAN.length * 2);
    expect(new Set(swept.map((fuzzCase) => fuzzCase.byteOffset)).size).toBe(CLEAN.length);
  });

  it('prints the seed, the case index and the byte offset', () => {
    const first = fuzzCases(0x0f170128, SEED_FILES, BUDGET).at(0);
    if (first === undefined) expect.unreachable('the budget generates cases');
    const described = describeCase(0x0f170128, first);
    expect(described).toContain('seed 0xf170128');
    expect(described).toContain('case 0');
    expect(described).toContain('developer-fields.fit');
    expect(described).toContain('byte ');
  });
});

describe('repairing the checksums is what lets a mutation reach the record loop', () => {
  const corrupted = (): Uint8Array => {
    const bytes = Uint8Array.from(CLEAN);
    // A byte inside the data section, well past the header.
    bytes[60] = (bytes[60] ?? 0) ^ 0x40;
    return bytes;
  };

  it('is needed: an unrepaired mutation stops at the checksum gate', () => {
    // This is the measurement that justifies `repairFitChecksums` existing. If
    // it ever stops holding, the repaired half of the budget is dead weight and
    // this test is where that gets noticed.
    let thrown: unknown;
    try {
      decodeFitActivity(corrupted());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FitDecodeError);
    expect((thrown as FitDecodeError).code).toBe('bad-file-crc');
  });

  it('lets the same mutation through to the records', () => {
    const repaired = repairFitChecksums(corrupted());
    expect(() => decodeFitActivity(repaired)).not.toThrow();
    // And it really is a different file from the clean one.
    expect([...repaired]).not.toEqual([...CLEAN]);
  });

  it('leaves a buffer it cannot frame alone', () => {
    const tooShort = Uint8Array.from([1, 2, 3]);
    expect([...repairFitChecksums(tooShort)]).toEqual([1, 2, 3]);
    const wrongHeaderSize = Uint8Array.from(CLEAN);
    wrongHeaderSize[0] = 0x55;
    const before = [...wrongHeaderSize];
    expect([...repairFitChecksums(wrongHeaderSize)]).toEqual(before);
  });

  it('leaves a truncated file without a file CRC to verify', () => {
    // The declared data section runs past the end, so there is no place to
    // write a file CRC. The `truncated-file` path is how the decoder reaches
    // its record loop here, and repairing would replace it with a short but
    // well-formed file.
    const truncated = CLEAN.slice(0, 200);
    const repaired = repairFitChecksums(Uint8Array.from(truncated));
    // Only the header CRC changes, and only because the header is intact.
    expect([...repaired.subarray(14)]).toEqual([...truncated.subarray(14)]);
  });
});

describe('assertTypedFailure', () => {
  const reproduction = 'seed 0x1 case 0';

  it('accepts the one error type the decoder documents', () => {
    expect(() =>
      assertTypedFailure(new FitDecodeError('bad-signature', 8, 'not a FIT file'), reproduction),
    ).not.toThrow();
  });

  it('rejects a RangeError, which is what an out-of-bounds DataView read gives', () => {
    expect(() => {
      assertTypedFailure(
        new RangeError('Offset is outside the bounds of the DataView'),
        reproduction,
      );
    }).toThrow(FuzzFailure);
  });

  it('accepts a different error type when the caller names one', () => {
    // The GPX/TCX arm passes `ActivityXmlError`. Without this case the widened
    // parameter is untested, and an arm that names the wrong constructor would
    // silently accept every failure -- which is how the inline copy this
    // replaced managed to be green with two parser guards removed.
    expect(() =>
      assertTypedFailure(
        new ActivityXmlError('malformed-markup', 0, 'a fixture'),
        'r',
        ActivityXmlError,
      ),
    ).not.toThrow();
  });

  it('rejects a FitDecodeError when the caller asked for an XML one', () => {
    // The direction that matters. If `expected` were ignored and the check fell
    // back to FitDecodeError, this would pass and the XML arm would be accepting
    // FIT errors as though they were its own.
    expect(() =>
      assertTypedFailure(new FitDecodeError('bad-file-crc', 0, 'a fixture'), 'r', ActivityXmlError),
    ).toThrow(FuzzFailure);
  });

  it('rejects a TypeError and a thrown non-Error', () => {
    expect(() => {
      assertTypedFailure(new TypeError('undefined is not a function'), reproduction);
    }).toThrow(FuzzFailure);
    expect(() => {
      assertTypedFailure('a string', reproduction);
    }).toThrow(FuzzFailure);
  });

  it('carries the reproduction instruction into the failure', () => {
    try {
      assertTypedFailure(new RangeError('nope'), 'seed 0xabc case 42 [byte-sweep at byte 7]');
      expect.unreachable('assertTypedFailure should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('seed 0xabc case 42');
      expect((error as Error).message).toContain('byte 7');
    }
  });
});

describe('assertMessagesInsideTheDataSection', () => {
  const reproduction = 'seed 0x1 case 0';
  const container = readFitContainer(CLEAN);

  function withMessages(messages: readonly FitMessage[]): FitContainer {
    return { ...container, messages };
  }

  it('passes on the committed corpus, which is the control', () => {
    expect(() => {
      assertMessagesInsideTheDataSection(container, CLEAN, reproduction);
    }).not.toThrow();
  });

  it('fails when a developer field reports bytes past the data section', () => {
    // The M16 shape: `subarray` clamps rather than throwing, so this is what a
    // missing record-length check looks like from the outside — no exception,
    // just a message claiming bytes the data section does not contain.
    const message = container.messages.find((found) => found.developerFields.length > 0);
    expect(message).toBeDefined();
    const overrunning: FitMessage = {
      ...(message as FitMessage),
      developerFields: (message as FitMessage).developerFields.map((field) => ({
        ...field,
        byteOffset: CLEAN.length,
        bytes: Uint8Array.from([1, 2]),
      })),
    };
    expect(() => {
      assertMessagesInsideTheDataSection(withMessages([overrunning]), CLEAN, reproduction);
    }).toThrow(FuzzFailure);
  });

  it('fails when a native field reports bytes past the data section', () => {
    const message = container.messages.find((found) => found.fields.length > 0);
    expect(message).toBeDefined();
    const overrunning: FitMessage = {
      ...(message as FitMessage),
      fields: (message as FitMessage).fields.map((field) => ({
        ...field,
        byteOffset: CLEAN.length,
      })),
    };
    expect(() => {
      assertMessagesInsideTheDataSection(withMessages([overrunning]), CLEAN, reproduction);
    }).toThrow(FuzzFailure);
  });

  it('fails when a message itself begins outside the data section', () => {
    const message = container.messages.at(0);
    expect(message).toBeDefined();
    expect(() => {
      assertMessagesInsideTheDataSection(
        withMessages([{ ...(message as FitMessage), byteOffset: 0 }]),
        CLEAN,
        reproduction,
      );
    }).toThrow(FuzzFailure);
    expect(() => {
      assertMessagesInsideTheDataSection(
        withMessages([{ ...(message as FitMessage), byteOffset: CLEAN.length }]),
        CLEAN,
        reproduction,
      );
    }).toThrow(FuzzFailure);
  });
});

describe('assertOutputBoundedByInput', () => {
  const reproduction = 'seed 0x1 case 0';
  const container = readFitContainer(CLEAN);
  const result = decodeFitActivity(CLEAN);

  it('passes on the committed corpus', () => {
    expect(() => {
      assertOutputBoundedByInput(container, result, CLEAN, reproduction);
    }).not.toThrow();
  });

  it('fails when more records are reported than the input has bytes', () => {
    const inflated: FitDecodeResult = {
      ...result,
      activity: {
        ...result.activity,
        records: new Array<(typeof result.activity.records)[number]>(CLEAN.length + 1).fill(
          result.activity.records[0] as (typeof result.activity.records)[number],
        ),
      },
    };
    expect(() => {
      assertOutputBoundedByInput(container, inflated, CLEAN, reproduction);
    }).toThrow(FuzzFailure);
  });

  it('fails when more messages are reported than the input has bytes', () => {
    const inflated: FitContainer = {
      ...container,
      messages: new Array<FitMessage>(CLEAN.length + 1).fill(container.messages[0] as FitMessage),
    };
    expect(() => {
      assertOutputBoundedByInput(inflated, result, CLEAN, reproduction);
    }).toThrow(FuzzFailure);
  });

  it('fails when more faults are reported than the input has bytes', () => {
    const noisy: FitDecodeResult = {
      ...result,
      faults: new Array<FitDecodeError>(CLEAN.length + 1).fill(
        new FitDecodeError('truncated-record', 0, 'short'),
      ),
    };
    expect(() => {
      assertOutputBoundedByInput(container, noisy, CLEAN, reproduction);
    }).toThrow(FuzzFailure);
  });
});
