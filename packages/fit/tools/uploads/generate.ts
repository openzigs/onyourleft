// SPDX-License-Identifier: Apache-2.0

/**
 * Write #138's six upload files to disk.
 *
 *     pnpm --filter @onyourleft/fit run uploads:generate
 *
 * Everything about *which* files and *why* is in `uploads.ts`; this is the
 * filesystem half, kept separate for the reason `fixture-corpus/generate.ts` is
 * separate from `corpus.ts` — the decisions are testable without a disk.
 *
 * ⚠️ **It writes into `dist/`, which is gitignored, and that is deliberate.**
 * These files are generated, disposable and reproducible from the corpus by
 * this command; committing them would add six binaries to a public repository
 * that a reviewer would have to take on trust, and `check-repo-rules.sh`
 * already prunes any directory named `dist`. Regenerate rather than keep.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CORPUS_DIRECTORY } from '../fixture-corpus/corpus-files';
import { buildUploadFiles } from './uploads';

/** `packages/fit/dist/validation-uploads`. */
const OUTPUT_DIRECTORY = join(import.meta.dirname, '..', '..', 'dist', 'validation-uploads');

const files = buildUploadFiles((name) =>
  Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name))),
);

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
for (const file of files) {
  writeFileSync(join(OUTPUT_DIRECTORY, file.name), file.bytes);
}

process.stdout.write(
  [
    `wrote ${String(files.length)} files to ${OUTPUT_DIRECTORY}`,
    '',
    ...files.map((file) => `  ${file.name.padEnd(26)} ${String(file.bytes.length).padStart(7)} B`),
    '',
    'Every coordinate in these files is inside a synthetic test region — no real',
    'location is uploaded anywhere (ADR 0004 decision G). Upload them by hand and',
    'record what each platform said in docs/validation/0001-trainer-and-sensors.md.',
    '',
    'What each one asks:',
    '',
    ...files.map((file) => `  ${file.name}\n    ${file.asks}`),
    '',
  ].join('\n'),
);
