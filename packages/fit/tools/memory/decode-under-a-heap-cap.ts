// SPDX-License-Identifier: Apache-2.0

/**
 * Decode one large FIT file, in a process whose heap the caller has capped.
 *
 * The child half of `retention.test.ts` — #127. It exists as its own process
 * because that is the only way to observe a **peak**: a decode is synchronous,
 * so nothing inside this runtime can sample the heap while it is running, and
 * `heapUsed` read after the call has already lost the intermediate. What a
 * `--max-old-space-size` ceiling measures is exactly the peak, because
 * exceeding it aborts.
 *
 * Two modes, and the pair is the whole point:
 *
 * - `streaming` — `decodeFitActivity`, which since #127 never builds the
 *   `FitMessage[]`.
 * - `array` — `decodeActivity(readFitContainer(bytes))`, the two-step spelling,
 *   which does. The container is a live argument for the whole of
 *   `decodeActivity`, so this really is the shape #127 was filed about rather
 *   than a reconstruction of it.
 *
 * Prints one line of JSON on success and nothing on failure, so the parent can
 * tell "decoded inside the cap" from "aborted" from "threw" without parsing
 * V8's fatal-error banner.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeActivity, decodeFitActivity, readFitContainer } from '../../src';
import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import type { DecodeMode, DecodeReport } from './child-contract';
import { SOURCE_FIXTURE } from './child-contract';
import { repeatFitDataSection } from './large-file';

const [copiesArgument, modeArgument] = process.argv.slice(2);
const copies = Number(copiesArgument);
const mode = modeArgument as DecodeMode;
if (mode !== 'streaming' && mode !== 'array') {
  throw new Error(`usage: decode-under-a-heap-cap.ts <copies> streaming|array`);
}

const source = Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, SOURCE_FIXTURE)));
const bytes = repeatFitDataSection(source, copies);

const result =
  mode === 'streaming' ? decodeFitActivity(bytes) : decodeActivity(readFitContainer(bytes));

const report: DecodeReport = {
  mode,
  inputBytes: bytes.length,
  // Read from the result rather than counted separately: a decode that returned
  // an empty activity inside the cap would otherwise look like a pass.
  records: result.activity.records.length,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
