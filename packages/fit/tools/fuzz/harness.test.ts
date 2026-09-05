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

import type {
  FitContainer,
  FitDecodeResult,
  FitMessage,
  TrackDecodeResult,
  TrackLap,
  TrackPoint,
} from '../../src';
import {
  ActivityXmlError,
  decodeFitActivity,
  decodeGpx,
  FitDecodeError,
  MAXIMUM_DEPTH,
  parseXml,
  readFitContainer,
  trackPointsOf,
} from '../../src';
import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import type { FuzzBudget } from './cases';
import { describeCase, fuzzCases, repairFitChecksums } from './cases';
import {
  assertDoctypeRefusedBeforeItsContents,
  assertMessagesInsideTheDataSection,
  assertNestingWithinTheParsersLimit,
  assertOutputBoundedByInput,
  assertTypedFailure,
  assertXmlOutputBoundedByInput,
  FuzzFailure,
  readXmlShape,
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

// ---------------------------------------------------------------------------
// The GPX and TCX arm's three — #149. Same treatment, for the same reason: the
// XML arm shipped with one invariant and nothing proving the others existed,
// and two real parser guards could be removed with the suite at 8 of 8.
// ---------------------------------------------------------------------------

const reproduction = 'seed 0x1 case 0';

function xmlFixture(name: string): string {
  return readFileSync(join(CORPUS_DIRECTORY, name), 'utf8');
}

describe('readXmlShape', () => {
  it('counts what the parser saw, on the committed nominal document', () => {
    const shape = readXmlShape(xmlFixture('nominal-ride.gpx'), reproduction);
    // 30 track points, each with an ele, a time and a five-element extensions
    // subtree, inside a gpx/metadata/trk/trkseg frame. The exact number matters
    // less than that it is neither zero nor the document's length: a counter
    // wired to nothing would report the first, and one counting characters the
    // second.
    expect(shape.elements).toBeGreaterThan(200);
    expect(shape.maximumDepth).toBe(7);
    expect(shape.textCharacters).toBeGreaterThan(0);
  });

  it('sees the committed deep-nesting fixtures as deeper than the parser will go', () => {
    // Read with `parseXml` rather than through an importer, because the whole
    // point of these two files is that the importer never gets to see them. If
    // this stops being true the fixtures have stopped being fixtures, and the
    // depth invariant below is asserting about nothing.
    for (const name of ['deep-nesting.gpx', 'deep-nesting.tcx']) {
      const error = (() => {
        try {
          parseXml(xmlFixture(name), {});
          return undefined;
        } catch (cause) {
          return cause as ActivityXmlError;
        }
      })();
      expect(error?.code, name).toBe('depth-limit-exceeded');
    }
  });

  it('turns a parse the importer accepted and the parser refused into a FuzzFailure', () => {
    // Cannot happen — they are the same parser on the same text — so this is
    // the assertion that says so rather than letting an `ActivityXmlError`
    // escape the fuzz loop as an untyped failure.
    expect(() => readXmlShape('<gpx>', reproduction)).toThrow(FuzzFailure);
  });
});

describe('assertDoctypeRefusedBeforeItsContents', () => {
  const hostile = xmlFixture('xxe-external-entity.gpx');
  const declaration = hostile.indexOf('<!DOCTYPE');

  it('accepts the real refusal, which happens at the declaration', () => {
    // Not a constructed error: the one the committed fixture actually produces.
    let thrown: unknown;
    try {
      decodeGpx(hostile);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ActivityXmlError).code).toBe('doctype-forbidden');
    expect(() => {
      assertDoctypeRefusedBeforeItsContents(hostile, thrown, reproduction);
    }).not.toThrow();
  });

  it('rejects a refusal that happened after the declaration', () => {
    // What a parser that *skipped* the DOCTYPE looks like from outside: it
    // still throws, and it still throws an `ActivityXmlError`, so
    // `assertTypedFailure` is content. It throws at `&xxe;`, which is what this
    // one sees.
    const atTheEntity = new ActivityXmlError(
      'unknown-entity',
      hostile.indexOf('&xxe;'),
      'a fixture',
    );
    expect(atTheEntity.characterOffset).toBeGreaterThan(declaration);
    expect(() => {
      assertDoctypeRefusedBeforeItsContents(hostile, atTheEntity, reproduction);
    }).toThrow(FuzzFailure);
  });

  it('says nothing about a document that declares no DOCTYPE', () => {
    const nominal = xmlFixture('nominal-ride.gpx');
    expect(nominal).not.toContain('<!DOCTYPE');
    expect(() => {
      assertDoctypeRefusedBeforeItsContents(
        nominal,
        new ActivityXmlError('unexpected-end', nominal.length, 'a fixture'),
        reproduction,
      );
    }).not.toThrow();
  });

  it('leaves a failure that is not an ActivityXmlError to assertTypedFailure', () => {
    // Two invariants reporting the same case would bury the one that named the
    // wrong error type, which is the more serious finding of the two.
    expect(() => {
      assertDoctypeRefusedBeforeItsContents(hostile, new RangeError('nope'), reproduction);
    }).not.toThrow();
  });

  it('accepts the lower-case spelling the parser also acts on', () => {
    const lowered = hostile.replace('<!DOCTYPE', '<!doctype');
    expect(lowered).toContain('<!doctype');
    expect(thrownCodeOf(lowered)).toBe('doctype-forbidden');
    expect(() => {
      assertDoctypeRefusedBeforeItsContents(
        lowered,
        new ActivityXmlError('unknown-entity', lowered.indexOf('&xxe;'), 'a fixture'),
        reproduction,
      );
    }).toThrow(FuzzFailure);
  });
});

describe('assertNestingWithinTheParsersLimit', () => {
  it('passes on a document inside the limit', () => {
    const shape = readXmlShape(xmlFixture('nominal-ride.gpx'), reproduction);
    expect(() => {
      assertNestingWithinTheParsersLimit(shape, reproduction);
    }).not.toThrow();
  });

  it('fails on a document that was accepted while nested past it', () => {
    // The shape a parser with its depth check removed would report on
    // `deep-nesting.gpx`, which is a document it would accept. Nothing throws
    // in that world, so this is the only thing that can notice.
    expect(() => {
      assertNestingWithinTheParsersLimit(
        { maximumDepth: MAXIMUM_DEPTH + 1, elements: 10, textCharacters: 0 },
        reproduction,
      );
    }).toThrow(FuzzFailure);
  });

  it('accepts a document exactly at the limit', () => {
    // The parser admits `MAXIMUM_DEPTH` elements and refuses the next, so an
    // invariant that failed here would be red on a document the parser is right
    // to accept.
    expect(() => {
      assertNestingWithinTheParsersLimit(
        { maximumDepth: MAXIMUM_DEPTH, elements: 10, textCharacters: 0 },
        reproduction,
      );
    }).not.toThrow();
  });
});

describe('assertXmlOutputBoundedByInput', () => {
  const nominal = xmlFixture('nominal-ride.gpx');
  const decoded = decodeGpx(nominal);
  const shape = readXmlShape(nominal, reproduction);

  it('passes on the committed corpus, which is the control', () => {
    expect(() => {
      assertXmlOutputBoundedByInput(shape, nominal, decoded, reproduction);
    }).not.toThrow();
  });

  it('fails when more track points are reported than the document has characters', () => {
    const point = trackPointsOf(decoded.activity)[0];
    expect(point).toBeDefined();
    const inflated: TrackDecodeResult = {
      ...decoded,
      activity: {
        ...decoded.activity,
        laps: [
          {
            ...(decoded.activity.laps[0] as TrackLap),
            points: new Array<TrackPoint>(nominal.length + 1).fill(point as TrackPoint),
          },
        ],
      },
    };
    expect(() => {
      assertXmlOutputBoundedByInput(shape, nominal, inflated, reproduction);
    }).toThrow(FuzzFailure);
  });

  it('fails when more faults are reported than the document has characters', () => {
    const noisy: TrackDecodeResult = {
      ...decoded,
      faults: new Array<ActivityXmlError>(nominal.length + 1).fill(
        new ActivityXmlError('invalid-value', 0, 'a fixture'),
      ),
    };
    expect(() => {
      assertXmlOutputBoundedByInput(shape, nominal, noisy, reproduction);
    }).toThrow(FuzzFailure);
  });

  it('fails when more elements are reported than the document has characters', () => {
    expect(() => {
      assertXmlOutputBoundedByInput(
        { ...shape, elements: nominal.length + 1 },
        nominal,
        decoded,
        reproduction,
      );
    }).toThrow(FuzzFailure);
  });

  it('fails when more character data comes out than went in', () => {
    // The entity-expansion clause, and the one that is not bookkeeping. A
    // reader that resolved `&lol6;` would emit three megabytes of text from a
    // 753-byte document; every escape this parser *does* resolve contracts, so
    // the bound holds with room to spare on every real file.
    expect(() => {
      assertXmlOutputBoundedByInput(
        { ...shape, textCharacters: nominal.length + 1 },
        nominal,
        decoded,
        reproduction,
      );
    }).toThrow(FuzzFailure);
  });

  it('is nowhere near its bound on a document that resolves every escape it can', () => {
    // The control for the clause above: `&amp;` is five characters in and one
    // out, so a document full of them ends up far under rather than near the
    // line. A bound that a legitimate document sat against would be a flake.
    const escaped = '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>'
      .concat('&amp;'.repeat(200))
      .concat('</name><trkseg/></trk></gpx>');
    const escapedShape = readXmlShape(escaped, reproduction);
    expect(escapedShape.textCharacters).toBe(200);
    expect(escapedShape.textCharacters * 5).toBeLessThan(escaped.length);
  });
});

/** The fault code a document is refused with, or `undefined` if it is accepted. */
function thrownCodeOf(text: string): string | undefined {
  try {
    decodeGpx(text);
    return undefined;
  } catch (error) {
    return (error as ActivityXmlError).code;
  }
}
