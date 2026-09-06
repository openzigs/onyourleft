// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The #29 fixture corpus, read off disk, for the transfer screen's tests.
 *
 * ## Why the codec's own corpus rather than files written here
 *
 * `packages/fit/fixtures/corpus/` holds nominal rides in all three formats, an
 * indoor ride with no position, a thirty-second sensor dropout, a file
 * truncated mid-record, a zero-length file, a header with no records, and the
 * hostile XML documents that carry an external entity declaration or an entity
 * bomb. #51's guidance is explicit that these are the right fixtures for an
 * import screen — *"an import screen tested only against a good file is tested
 * against the case that never causes support tickets"* — and a second set here
 * would be a second set to keep in step with the codec.
 *
 * ADR 0004 decision G: every coordinate in that corpus is inside a synthetic
 * test region, so none of it is anybody's real location.
 *
 * ⚠️ **Separate from `testing.ts` because this file reads the filesystem, and
 * a jsdom test cannot.** Under `@vitest-environment jsdom`, `import.meta.url`
 * is an `http:` URL and `fileURLToPath` throws on it — at *module* scope, so
 * merely importing a helper from the same file as this one would fail a UI test
 * that never wanted a corpus file. `testing.ts` holds the fixtures that work in
 * both environments.
 */

// ⚠️ This file names Node builtins and lives under `src/`, so it is inside
// `apps/web`'s production tsconfig program and inside the coverage glob, even
// though only test files import it (#167). That is deliberate, and it follows
// `testing.ts` beside it, which is the same shape for the same reason: keeping
// test-support code next to the code it supports beats a parallel tree.
//
// What it costs, so the next reader knows: a stray *production* import of this
// module would fail at bundle time rather than at lint or typecheck, because
// Vite never reaches it today. `pnpm run build` is what catches that, which is
// why CLAUDE.md §4a says a green typecheck is not a green build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ImportSource } from './import-batch';

/** Resolved from this file rather than from the process working directory. */
const CORPUS_DIRECTORY = fileURLToPath(
  new URL('../../../../packages/fit/fixtures/corpus/', import.meta.url),
);

/** One corpus file's bytes. */
export function corpusBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${CORPUS_DIRECTORY}${name}`));
}

/** A corpus file as something the batch importer can be handed. */
export function corpusSource(name: string, fileName = name): ImportSource {
  const bytes = corpusBytes(name);
  return { fileName, bytes: async () => Promise.resolve(bytes) };
}

/**
 * Corpus files that decode to a ride with samples on an absolute timeline.
 *
 * Not every corpus file does, and the ones that do not are the point of half
 * these tests — so the list is explicit rather than "everything in the
 * directory", which would silently change meaning the next time #29's generator
 * grows a case.
 */
export const IMPORTABLE_CORPUS_FILES = [
  'nominal-outdoor-ride.fit',
  'indoor-trainer-no-position.fit',
  'sensor-dropout-30s.fit',
  'paused-laps.fit',
  'antimeridian-crossing.fit',
  'heart-rate-16-bit.fit',
  'timestamp-epoch-boundary.fit',
  'developer-fields.fit',
  'point-nemo-southern-western.fit',
  'nominal-ride.gpx',
  'nominal-ride.tcx',
  'indoor-no-position.tcx',
  'point-nemo.gpx',
] as const;

/**
 * Corpus files this client must refuse, and the reason each one is here.
 *
 * `xxe-external-entity.{gpx,tcx}` and `billion-laughs.gpx` are the security
 * cases: the codec refuses the `<!DOCTYPE` outright, and what matters at this
 * layer is that the refusal reaches the rider **as that file's failure** rather
 * than taking the batch down or being flattened into a generic message.
 */
export const REFUSED_CORPUS_FILES = [
  'zero-length.fit',
  'xxe-external-entity.gpx',
  'xxe-external-entity.tcx',
  'billion-laughs.gpx',
  // Structural refusals from the XML parser: a document that ends mid-element,
  // and one nested past its depth bound. Both are `undecodable` at this layer
  // and both are reported against their own filename.
  'truncated-mid-trackpoint.gpx',
  'deep-nesting.gpx',
  'deep-nesting.tcx',
] as const;
