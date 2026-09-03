// SPDX-License-Identifier: Apache-2.0

/**
 * Where the corpus lives, and how it is rendered.
 *
 * Shared by the generator and by the tests that check what the generator
 * produced, so the two cannot disagree about which directory they mean — a
 * disagreement that would leave the guard passing over an empty directory while
 * the real corpus sat somewhere else, which is precisely the shape of "a check
 * that has not been watched to fail".
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { CorpusEntry } from './corpus';
import { CORPUS_BYTE_BUDGET } from './corpus';

/** `packages/fit/fixtures`. */
export const FIXTURES_DIRECTORY = join(import.meta.dirname, '..', '..', 'fixtures');

/**
 * `packages/fit/fixtures/corpus` — the closed directory.
 *
 * The README and the manifest are deliberately *outside* it, so "this directory
 * contains exactly the generated fixtures and nothing else" is a statement with
 * no exceptions in it. An exception list is where the next file gets added.
 */
export const CORPUS_DIRECTORY = join(FIXTURES_DIRECTORY, 'corpus');

export const MANIFEST_PATH = join(FIXTURES_DIRECTORY, 'MANIFEST.json');

export const README_PATH = join(FIXTURES_DIRECTORY, 'README.md');

export const README_TABLE_BEGIN = '<!-- BEGIN GENERATED FIXTURE TABLE -->';
export const README_TABLE_END = '<!-- END GENERATED FIXTURE TABLE -->';

/** One fixture's row in the manifest. */
export interface ManifestFixture {
  readonly name: string;
  readonly format: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly positionCount: number;
  readonly purpose: string;
}

export interface Manifest {
  readonly generatedBy: string;
  readonly budgetBytes: number;
  readonly totalBytes: number;
  readonly totalPositionCount: number;
  readonly fixtures: readonly ManifestFixture[];
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The manifest for a built corpus. Pure, so a test can rebuild and compare. */
export function manifestOf(corpus: readonly CorpusEntry[]): Manifest {
  return {
    generatedBy: 'pnpm --filter @onyourleft/fit run fixtures:generate',
    budgetBytes: CORPUS_BYTE_BUDGET,
    totalBytes: corpus.reduce((total, entry) => total + entry.bytes.length, 0),
    totalPositionCount: corpus.reduce((total, entry) => total + entry.positionCount, 0),
    fixtures: corpus.map((entry) => ({
      name: entry.name,
      format: entry.format,
      bytes: entry.bytes.length,
      sha256: sha256(entry.bytes),
      positionCount: entry.positionCount,
      purpose: entry.purpose,
    })),
  };
}

/**
 * The manifest as it is written to disk.
 *
 * Two spaces and a trailing newline, which is what Prettier writes for JSON, so
 * `pnpm run format:check` has nothing to say about a generated file.
 */
export function renderManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The fixture table for `fixtures/README.md`.
 *
 * Generated rather than hand-maintained: "every case is present, each with a
 * README entry saying what it is for" is an acceptance criterion, and a
 * hand-maintained table satisfies it exactly once — on the day it is written.
 * A test asserts the committed README contains this block verbatim, so a
 * fixture added without a purpose cannot reach `main`.
 */
export function renderReadmeTable(corpus: readonly CorpusEntry[]): string {
  const rows = corpus.map(
    (entry) =>
      `| \`${entry.name}\` | ${String(entry.bytes.length)} | ${String(entry.positionCount)} | ${entry.purpose} |`,
  );
  const manifest = manifestOf(corpus);
  const percent = Math.round((manifest.totalBytes / manifest.budgetBytes) * 100);
  return [
    README_TABLE_BEGIN,
    '',
    '| Fixture | Bytes | Positions | What it is for |',
    '| --- | ---: | ---: | --- |',
    ...rows,
    '',
    `**${String(corpus.length)} fixtures, ${String(manifest.totalBytes)} bytes of the ` +
      `${String(manifest.budgetBytes)} byte budget (${String(percent)}%), ` +
      `${String(manifest.totalPositionCount)} positions.** Regenerated with the corpus, so it ` +
      'cannot go stale.',
    '',
    README_TABLE_END,
  ].join('\n');
}

/** Replace the generated block in a README, leaving the prose around it alone. */
export function withReadmeTable(readme: string, table: string): string {
  const begin = readme.indexOf(README_TABLE_BEGIN);
  const end = readme.indexOf(README_TABLE_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `fixtures/README.md must contain ${README_TABLE_BEGIN} and ${README_TABLE_END}, in that order`,
    );
  }
  return readme.slice(0, begin) + table + readme.slice(end + README_TABLE_END.length);
}
