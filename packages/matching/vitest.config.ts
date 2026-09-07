// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/matching`.
 *
 * **Imports nothing**, for the reason `packages/domain/vitest.config.ts`
 * records: `import { defineConfig } from 'vitest/config'` pulls Vite's type
 * declarations, and through their `/// <reference types="node" />` all of
 * @types/node, into whatever TypeScript program this file belongs to.
 */
export default {
  test: {
    name: 'matching',
    // `node`, because `tools/` reads a clock and writes a table. `src/` needs
    // neither and could run anywhere.
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
};
