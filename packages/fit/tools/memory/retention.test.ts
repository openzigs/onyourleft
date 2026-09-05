// SPDX-License-Identifier: Apache-2.0

/**
 * What decoding a large FIT file costs, measured — #127.
 *
 * #127 measured a 4.39 MiB file retaining ~354 MiB and asked for *"a test [that]
 * decodes a large fixture and asserts a bound on retained heap — measured, not
 * assumed, and expressed against the input size so it cannot silently rot into a
 * tautology"*. Every clause of that sentence decided something here.
 *
 * ## Why a child process, and not `process.memoryUsage()`
 *
 * Because the number that matters is a **peak**, and this one is unobservable
 * from inside the runtime that has it. A decode is synchronous, so no timer, no
 * microtask and no other thread gets to sample the heap while it runs; and by
 * the time `decodeFitActivity` returns, the intermediate whose size is the whole
 * subject has already become collectable. Measured on the 4.55 MiB file below,
 * `heapUsed` after a forced collection reads **47.9 MiB for the array spelling
 * and 48.4 MiB for the streaming one** — the two are indistinguishable, because
 * what survives each call is the same activity. A test written that way would
 * have passed against the unfixed decoder, which is the trap CLAUDE.md §5 names.
 *
 * `process.resourceUsage().maxRSS` *is* a real peak and was tried second. It
 * separates the two (19–28 bytes per input byte streaming, 129 array) but its
 * streaming figure moved by 40% between runs on one machine, because RSS
 * includes heap pages V8 grew and has not returned. A bound of 32 with a
 * measurement that wanders to 28 is a flake waiting for a slower runner.
 *
 * So: run the decode in a process whose old space is capped at
 * `MAXIMUM_RETAINED_BYTES_PER_INPUT_BYTE × the input's own length`, and let V8
 * decide. Exceeding the cap aborts. That is a peak measurement, it is expressed
 * against the input size by construction, and it has no variance to speak of.
 *
 * ## Both directions, so the bound cannot become a tautology
 *
 * A ceiling every implementation passes is a comment. So the same cap is applied
 * to the spelling #127 was filed about — `decodeActivity(readFitContainer(...))`,
 * which builds the whole `FitMessage[]` — and that arm is **required to abort**.
 * Raising the constant until the streaming arm is comfortable would eventually
 * turn that second assertion red, which is the point of having it.
 *
 * Measured thresholds on the 4.55 MiB file, Node 24, by bisecting the cap:
 *
 *     streaming    decodes at 65 MiB, aborts at 60
 *     array        aborts at 420 MiB, and at every value below it
 *     the cap       145 MiB  (32 x 4 775 416 bytes)
 *
 * — a 2.2x margin under the cap and a 2.9x margin over it. The interpreter's own
 * baseline is inside the same cap rather than added to it, which makes the bound
 * conservative rather than generous.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAXIMUM_RETAINED_BYTES_PER_INPUT_BYTE } from '../../src';
import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import type { DecodeMode, DecodeReport } from './child-contract';
import { SOURCE_FIXTURE, SOURCE_RECORD_COUNT } from './child-contract';
import { repeatFitDataSection } from './large-file';

/**
 * How many times the 3 427-byte baseline ride is repeated: 4.55 MiB, 168 000
 * records.
 *
 * Chosen to sit just above the 4.39 MiB file #127 measured, so the assertion is
 * about the size that was actually reported rather than about an extrapolation
 * from it. Larger would widen the margins and cost seconds; this is enough.
 */
const COPIES = 1400;

const MIB = 1024 * 1024;

const CHILD = join(import.meta.dirname, 'decode-under-a-heap-cap.ts');
const TYPE_RESOLVER = join(import.meta.dirname, '..', 'ts-extensionless-resolve.mjs');

const SOURCE = Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, SOURCE_FIXTURE)));

interface Attempt {
  readonly aborted: boolean;
  readonly report: DecodeReport | undefined;
  readonly detail: string;
}

/**
 * Decode in a child process whose old space is capped, and say what happened.
 *
 * `--max-old-space-size` takes whole mebibytes, so the cap is rounded **up**:
 * rounding down would make the bound slightly stricter than the constant says,
 * and a test that is stricter than the thing it documents fails for a reason
 * nobody can look up.
 */
function decodeUnderCap(mode: DecodeMode, capBytes: number): Attempt {
  const child = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${String(Math.ceil(capBytes / MIB))}`,
      '--import',
      TYPE_RESOLVER,
      CHILD,
      String(COPIES),
      mode,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  const stdout = child.stdout;
  const report =
    child.status === 0 && stdout.trim() !== ''
      ? (JSON.parse(stdout.trim()) as DecodeReport)
      : undefined;
  return {
    // V8 aborts on a heap it cannot grow, which surfaces as SIGABRT on POSIX
    // and as a non-zero status elsewhere. Either is "it did not fit"; what
    // would not be is a clean exit with no output, so `report` is checked too.
    aborted: report === undefined,
    report,
    detail: `status ${String(child.status)} signal ${String(child.signal)}\n${child.stderr.slice(-800)}`,
  };
}

describe('decoding a large FIT file', () => {
  const bytes = repeatFitDataSection(SOURCE, COPIES);
  const cap = MAXIMUM_RETAINED_BYTES_PER_INPUT_BYTE * bytes.length;

  it('builds a file the size #127 is about', () => {
    // The measurement is only about a large file if the file is large. #127's
    // was 4.39 MiB; this is 4.55.
    expect(bytes.length).toBeGreaterThan(4.39 * MIB);
    expect(bytes.length).toBeLessThan(8 * MIB);
  });

  it('stays inside a heap capped at the bound this package declares', { timeout: 120_000 }, () => {
    const attempt = decodeUnderCap('streaming', cap);
    expect(attempt.aborted, `the streaming decode did not finish: ${attempt.detail}`).toBe(false);
    // Every record of every copy, so the cap was met by decoding the file and
    // not by decoding less of it.
    expect(attempt.report?.records).toBe(SOURCE_RECORD_COUNT * COPIES);
    expect(attempt.report?.inputBytes).toBe(bytes.length);
  });

  it(
    'does not, when the message stream is materialised — so the bound is not vacuous',
    { timeout: 120_000 },
    () => {
      // The shape #127 was filed about, under the identical cap. If this ever
      // passes, either the constant has been raised until nothing can fail it
      // or `readFitContainer` has stopped building the array — and in the
      // second case this file is what should be rewritten, deliberately.
      const attempt = decodeUnderCap('array', cap);
      expect(
        attempt.aborted,
        `materialising ${String(SOURCE_RECORD_COUNT * COPIES)} messages fitted inside ` +
          `${String(Math.ceil(cap / MIB))} MiB, which it must not: ${attempt.detail}`,
      ).toBe(true);
    },
  );
});
