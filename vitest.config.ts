// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One config per package rather than one root config with globs: each
    // package gets to choose its own environment, and `pnpm --filter <pkg> test`
    // and `pnpm test` then run the same thing. Vitest 4 removed the separate
    // workspace file in favour of this field.
    projects: ['packages/*', 'apps/*'],
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
      // pattern and is no longer true; all five packages appear.
      include: ['packages/*/src/**', 'packages/*/*/src/**', 'apps/*/src/**'],
      // No thresholds, deliberately. ADR 0005 decision C: the gate is the
      // mutation list in the pull request body, not a percentage. Coverage is
      // reported because an untested branch is worth seeing in review.
    },
  },
});
