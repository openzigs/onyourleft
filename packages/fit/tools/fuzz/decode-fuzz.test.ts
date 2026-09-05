// SPDX-License-Identifier: Apache-2.0

/**
 * The seeded fuzz run — #128.
 *
 * #125's review fuzzed the new decoder hard and nothing escaped as anything
 * other than a `FitDecodeError`. That run lived in a scratch worktree and was
 * never committed, so nothing stopped the next change to `src/decode/` from
 * reintroducing what it had ruled out. This is that run, committed, seeded, and
 * inside the ordinary `pnpm run test` gate — no new CI job, because
 * `CLAUDE.md` §4c requires every gate to report under the one status check that
 * `main` protects.
 *
 * ## What it asserts
 *
 * `invariants.ts` states the three properties and why the first is not enough
 * on its own. In short: the right error type, no message reporting bytes from
 * outside the data section, and no output larger than the input could encode.
 * A hang is caught by the test timeout below rather than by an assertion,
 * because a wedged loop never reaches one.
 *
 * ## Budget
 *
 * #128: *"cheap enough for every PR … pick a budget that runs in seconds"*.
 * The numbers below are chosen against that, and they are stated as constants
 * rather than buried so that raising them is a visible decision. Truncation is
 * the expensive kind — every prefix of an n-byte file is n parses averaging
 * n/2 bytes — which is why FIT truncates at **every** offset (the FIT corpus is
 * ~20 KiB in total) and GPX/TCX truncate on a stride (those files are ~59 KiB
 * and each parse walks the whole prefix as text).
 *
 * ## Extends to GPX and TCX, which have landed
 *
 * #128 was written while #32 was still open and asked for the seam rather than
 * the coverage. #32 landed in #136, so the same generator drives `decodeGpx`
 * and `decodeTcx` here: they are the untrusted-file surface `SECURITY.md` names
 * XXE and entity expansion against, and `xxe-external-entity.gpx`,
 * `xxe-external-entity.tcx` and `billion-laughs.gpx` are already in the corpus
 * to be mutated. What changes per format is the error type and the budget;
 * nothing else.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ActivityXmlError,
  decodeActivity,
  FitDecodeError,
  decodeFitActivity,
  decodeGpx,
  decodeTcx,
  readFitContainer,
} from '../../src';
import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import type { FuzzBudget, FuzzCase, FuzzSeedFile } from './cases';
import { describeCase, fuzzCases } from './cases';
import { FuzzFailure } from './invariants';
import {
  assertMessagesInsideTheDataSection,
  assertOutputBoundedByInput,
  assertTypedFailure,
} from './invariants';

/**
 * The seed. Fixed, and printed with every failure.
 *
 * Changing it is allowed and is how the corpus gets explored further, but it is
 * a deliberate act: a seed that moves per run is the flake #128 exists to
 * avoid.
 */
const FUZZ_SEED = 0x0f170128;

const FIT_BUDGET: FuzzBudget = {
  bitFlipsPerFile: 160,
  byteSetsPerFile: 160,
  byteSweep: true,
  truncationStride: 1,
  randomBuffers: 512,
  randomFramedBuffers: 512,
  randomBufferMaximumBytes: 256,
  repairFitChecksums: true,
};

const XML_BUDGET: FuzzBudget = {
  bitFlipsPerFile: 128,
  byteSetsPerFile: 128,
  // No sweep: it is two cases per byte, and an XML parse walks the whole
  // document rather than seeking to an offset, so 59 KiB of seed material would
  // cost minutes rather than seconds. The FIT sweep is what the M16 mutation
  // needs; the XML readers have no length arithmetic for it to exercise.
  byteSweep: false,
  truncationStride: 64,
  randomBuffers: 0,
  randomFramedBuffers: 0,
  randomBufferMaximumBytes: 0,
  repairFitChecksums: false,
};

function seedFiles(extension: string): FuzzSeedFile[] {
  return readdirSync(CORPUS_DIRECTORY)
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => ({ name, bytes: Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name))) }));
}

/**
 * A mutated buffer read as text, the way a browser reads a dropped file.
 *
 * Non-fatal: an invalid UTF-8 sequence becomes U+FFFD rather than an exception,
 * which is what `File.text()` does. A fatal decoder here would reject a large
 * share of the mutations before the XML reader ever saw them, and the XML
 * reader is what is under test.
 */
const AS_TEXT = new TextDecoder('utf-8', { fatal: false });

/**
 * Decode one case and check every invariant against it.
 *
 * The two calls below are `decodeFitActivity`'s whole body, spelled out rather
 * than called, because the containment invariant needs byte offsets and
 * `FitActivity` deliberately carries none — it is the shape an importer
 * consumes, not a map of the file. Calling the public entry point *and* reading
 * the container would decode every case twice and double the run.
 *
 * `pins the public entry point to the two calls this harness makes` below is
 * what stops that spelling drifting from the entry point it stands in for.
 */
/** A call's outcome as a value, so two spellings of it can be compared. */
function attempt<T>(call: () => T): T | FitDecodeError {
  try {
    return call();
  } catch (error) {
    if (error instanceof FitDecodeError) return error;
    throw error;
  }
}

function runFitCase(fuzzCase: FuzzCase, seed: number): void {
  const reproduction = describeCase(seed, fuzzCase);
  let container;
  let result;
  try {
    container = readFitContainer(fuzzCase.bytes);
    result = decodeActivity(container);
  } catch (error) {
    assertTypedFailure(error, reproduction);
    return;
  }
  assertMessagesInsideTheDataSection(container, fuzzCase.bytes, reproduction);
  assertOutputBoundedByInput(container, result, fuzzCase.bytes, reproduction);
}

function runXmlCase(fuzzCase: FuzzCase, seed: number, decode: (text: string) => unknown): void {
  const reproduction = describeCase(seed, fuzzCase);
  const text = AS_TEXT.decode(fuzzCase.bytes);
  try {
    decode(text);
  } catch (error) {
    if (error instanceof ActivityXmlError) return;
    const described =
      error instanceof Error ? `${error.name}: ${error.message}` : `a non-Error ${typeof error}`;
    throw new FuzzFailure(
      `decoding threw ${described}, which is not an ActivityXmlError`,
      reproduction,
      error,
    );
  }
}

describe('the FIT decoder survives a seeded corpus fuzz', () => {
  const files = seedFiles('.fit');
  const cases = fuzzCases(FUZZ_SEED, files, FIT_BUDGET);

  it('has seed material to mutate', () => {
    // A fuzz run over an empty corpus is the shape of "a check that has never
    // been watched to fail": green, fast, and asserting nothing at all.
    expect(files.length).toBeGreaterThanOrEqual(13);
    expect(cases.length).toBeGreaterThan(20_000);
  });

  it('covers bit flips, byte substitutions, every truncation offset and random buffers', () => {
    const kinds = new Set(cases.map((fuzzCase) => fuzzCase.kind));
    expect([...kinds].sort()).toEqual([
      'bit-flip',
      'byte-set',
      'byte-sweep',
      'random-bytes',
      'random-framed',
      'truncate',
    ]);
    const corpusBytes = files.reduce((total, file) => total + file.bytes.length, 0);
    // Every offset of every seed file, which is what the acceptance criterion
    // asks for rather than a sample of them.
    expect(cases.filter((fuzzCase) => fuzzCase.kind === 'truncate').length).toBe(corpusBytes);
    // And every offset again for the sweep, twice over. This is the kind that
    // reaches the width arithmetic; `cases.ts` records the measurement that
    // says the random kinds do not.
    expect(cases.filter((fuzzCase) => fuzzCase.kind === 'byte-sweep').length).toBe(corpusBytes * 2);
    // Most of the mutations reach the record loop rather than the checksum
    // gate. Without repair the whole run would be a test of `bad-file-crc`.
    const repaired = cases.filter((fuzzCase) => fuzzCase.checksumsRepaired);
    expect(repaired.length).toBeGreaterThan(cases.length / 2);
  });

  it('pins the public entry point to the two calls this harness makes', () => {
    // If `decodeFitActivity` ever grows a step of its own, the fuzz would stop
    // covering the function real callers use and nothing else would say so.
    // Asserted on a clean file and on a mutated one, because the interesting
    // divergence is in the fault path rather than the happy one.
    const clean = files.find((file) => file.name === 'nominal-outdoor-ride.fit')?.bytes;
    expect(clean).toBeDefined();
    expect(decodeFitActivity(clean ?? new Uint8Array())).toEqual(
      decodeActivity(readFitContainer(clean ?? new Uint8Array())),
    );

    // And on damaged input, where the fault path is. Both halves are checked:
    // a case that still decodes must decode identically, and a case that
    // throws must throw the same fault code.
    let agreedOnDamaged = 0;
    let agreedOnThrown = 0;
    for (const fuzzCase of cases) {
      if (agreedOnDamaged >= 8 && agreedOnThrown >= 8) break;
      if (fuzzCase.kind !== 'byte-sweep' || fuzzCase.source !== 'developer-fields.fit') continue;
      const viaEntryPoint = attempt(() => decodeFitActivity(fuzzCase.bytes));
      const viaHarness = attempt(() => decodeActivity(readFitContainer(fuzzCase.bytes)));
      expect(viaEntryPoint).toEqual(viaHarness);
      if (viaEntryPoint instanceof FitDecodeError) agreedOnThrown += 1;
      else agreedOnDamaged += 1;
    }
    expect(agreedOnDamaged).toBeGreaterThan(0);
    expect(agreedOnThrown).toBeGreaterThan(0);
  });

  it(
    'produces a decode or a FitDecodeError for every case, and nothing else',
    { timeout: 60_000 },
    () => {
      // The timeout is the hang guard: a wedged record loop never reaches an
      // assertion, so the only thing that can catch it is the runner.
      for (const fuzzCase of cases) runFitCase(fuzzCase, FUZZ_SEED);
    },
  );
});

describe('the GPX and TCX readers survive the same fuzz', () => {
  for (const [extension, decode] of [
    ['.gpx', decodeGpx],
    ['.tcx', decodeTcx],
  ] as const) {
    const files = seedFiles(extension);
    const cases = fuzzCases(FUZZ_SEED, files, XML_BUDGET);

    it(`has ${extension} seed material to mutate`, () => {
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(cases.length).toBeGreaterThan(500);
    });

    it(
      `produces a decode or an ActivityXmlError for every mutated ${extension} case`,
      { timeout: 60_000 },
      () => {
        for (const fuzzCase of cases) runXmlCase(fuzzCase, FUZZ_SEED, decode);
      },
    );
  }
});
