// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * The files that take longest, in the order they should start — #651. Seconds
 * of one worker on the CI runner, under coverage, from run 36326090778 (the
 * near-field rides were one 216 s file then; they are two since #651).
 *
 * Vitest's own order, with no cache of earlier durations — and CI keeps none —
 * is project by project in name order, then largest file first. That started
 * the 216 s file 112 s into a 336 s run, and the run waited on it for its last
 * ninety seconds; the two files it is now are a few hundred bytes each and
 * would start last of all. Starting the long ones first is the whole of the
 * fix: nothing is skipped, and every file still runs in the same process with
 * the same isolation.
 *
 * ⚠️ **Only the ORDER is at stake here, never what runs**, so a file named here
 * that has since moved or got faster costs nothing but a slightly worse order.
 */
const HEAVIEST_FIRST = [
  'apps/web/src/game/near-field-rides-0.test.ts', // ~109 s
  'apps/web/src/game/near-field-rides-1.test.ts', // ~104 s
  'packages/fit/tools/fuzz/decode-fuzz.test.ts', // 99 s
  'apps/web/src/game/racing-line.test.ts', // 31 s
  'apps/web/src/game/GameView.test.tsx', // 25 s
  'apps/web/src/game/line-on-the-road.test.ts', // 22 s
] as const;

/** @see HEAVIEST_FIRST */
class HeaviestFirst extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const rank = (file: TestSpecification): number => {
      const at = HEAVIEST_FIRST.findIndex((path) => file.moduleId.endsWith(path));
      return at === -1 ? HEAVIEST_FIRST.length : at;
    };
    // A stable sort, so everything not named keeps Vitest's own order.
    return sorted.sort((a, b) => rank(a) - rank(b));
  }
}

export default defineConfig({
  test: {
    // One config per package rather than one root config with globs: each
    // package gets to choose its own environment, and `pnpm --filter <pkg> test`
    // and `pnpm test` then run the same thing. Vitest 4 removed the separate
    // workspace file in favour of this field.
    projects: ['packages/*', 'apps/*'],
    // ⚠️ **The heaviest files first — #651.** @see HeaviestFirst
    //
    // And NOT one worker per core, which #651 measured rather than assumed:
    // `maxWorkers: '100%'` (four on the `ubuntu-latest` runner, against the
    // default three) took the run from 336 s to 334 s and the summed test time
    // from 676 s to 807 s, and pushed a 4.4 s case past its 5 s timeout (run
    // 36333257690). Those four vCPUs are two cores' hyperthreads, so a fourth
    // worker shares a core rather than adding one.
    sequence: { sequencer: HeaviestFirst },
    coverage: {
      provider: 'v8',
      // `json-summary` is what the CI step renders into the run summary; `html`
      // is what gets uploaded as an artefact when a number looks wrong; `text`
      // stays because it is what you read locally. None of the three gates
      // anything -- see the note below.
      reporter: ['text', 'html', 'json-summary'],
      // The second pattern is for an adapter that needs a platform library
      // and therefore lives in its own directory beside `src/` with its own
      // tsconfig — `packages/sensors/web-bluetooth/src/**` today (#40), and
      // whatever #15 adds for the native stacks. Without it those files are
      // reported at 0% by being absent from the report entirely, which reads
      // in review as "not written" rather than "not measured".
      //
      // `packages/fit/tools/**` is deliberately NOT here, decided in #110.
      // It is the #29 fixture generator: authoring-time code that produces a
      // committed artefact and ships in nothing. Its tests run (its own
      // vitest.config.ts includes `tools/**/*.test.ts`) and its output is
      // asserted by the corpus tests; what would change by adding it is only
      // the denominator of `packages/fit`'s percentage, mixing a generator's
      // coverage into a codec's. #107 observed this report listing `apps/web`
      // alone at 125 statements — that predated the `packages/*/*/src/**`
      // pattern and is no longer true; all six packages appear (physics since #88).
      include: ['packages/*/src/**', 'packages/*/*/src/**', 'apps/*/src/**'],
      // No thresholds, deliberately. ADR 0005 decision C: the gate is the
      // mutation list in the pull request body, not a percentage. Coverage is
      // reported because an untested branch is worth seeing in review.
    },
  },
});
