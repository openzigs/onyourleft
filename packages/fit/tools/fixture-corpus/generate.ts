// SPDX-License-Identifier: Apache-2.0

/**
 * Write the fixture corpus to disk.
 *
 *     pnpm --filter @onyourleft/fit run fixtures:generate
 *
 * The only part of this package that touches a filesystem, and the reason
 * `packages/fit` has a second, narrower TypeScript program that excludes
 * `tools/` — see `tsconfig.platform-free.json`.
 *
 * It **adds and overwrites; it never deletes**. A file in `fixtures/corpus/`
 * that this generator did not produce is exactly what the closure test in
 * `corpus.test.ts` exists to catch, and a generator that quietly tidied it away
 * would destroy the evidence before anyone saw it. The test says what to remove
 * and the contributor removes it, on purpose.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildCorpus, CORPUS_BYTE_BUDGET } from './corpus';
import {
  CORPUS_DIRECTORY,
  manifestOf,
  MANIFEST_PATH,
  README_PATH,
  renderManifest,
  renderReadmeTable,
  withReadmeTable,
} from './corpus-files';

const corpus = buildCorpus();
const manifest = manifestOf(corpus);

mkdirSync(CORPUS_DIRECTORY, { recursive: true });

for (const entry of corpus) {
  writeFileSync(join(CORPUS_DIRECTORY, entry.name), entry.bytes);
}

writeFileSync(MANIFEST_PATH, renderManifest(manifest), 'utf8');
writeFileSync(
  README_PATH,
  withReadmeTable(readFileSync(README_PATH, 'utf8'), renderReadmeTable(corpus)),
  'utf8',
);

const expected = new Set(corpus.map((entry) => entry.name));
const strays = readdirSync(CORPUS_DIRECTORY).filter((name) => !expected.has(name));

process.stdout.write(
  [
    `wrote ${String(corpus.length)} fixtures to ${CORPUS_DIRECTORY}`,
    `total ${String(manifest.totalBytes)} bytes of a ${String(CORPUS_BYTE_BUDGET)} byte budget ` +
      `(${String(Math.round((manifest.totalBytes / CORPUS_BYTE_BUDGET) * 100))}%)`,
    `${String(manifest.totalPositionCount)} positions, every one of which the region guard checks`,
    ...(strays.length > 0
      ? [
          '',
          `WARNING: ${String(strays.length)} file(s) in the corpus directory were not generated:`,
          ...strays.map((name) => `  ${name}`),
          'Nothing has been deleted. Remove them by hand — the corpus is closed, and a file',
          'nobody generated may be a real ride file (ADR 0004 decision G).',
        ]
      : []),
    '',
  ].join('\n'),
);
