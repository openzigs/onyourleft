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
      reporter: ['text', 'html'],
      include: ['packages/*/src/**', 'apps/*/src/**'],
      // No thresholds, deliberately. ADR 0005 decision C: the gate is the
      // mutation list in the pull request body, not a percentage. Coverage is
      // reported because an untested branch is worth seeing in review.
    },
  },
});
