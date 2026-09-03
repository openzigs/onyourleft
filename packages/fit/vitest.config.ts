// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/fit`.
 *
 * **Imports nothing**, for the reason `packages/domain/vitest.config.ts`
 * records: `import { defineConfig } from 'vitest/config'` pulls Vite's type
 * declarations, and through their `/// <reference types="node" />` all of
 * @types/node, into whatever TypeScript program this file belongs to. Vitest
 * accepts a plain object.
 */
export default {
  test: {
    name: 'fit',
    // `node`, because the corpus tests read the committed fixture files off
    // disk. That is deliberate: the ADR 0004 decision G guard has to assert
    // against the artefact that is actually committed, not against the value
    // the generator held in memory.
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
};
