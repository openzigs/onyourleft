// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/analysis`.
 *
 * **Deliberately imports nothing**, for the reason
 * `packages/domain/vitest.config.ts` records: `import { defineConfig } from
 * 'vitest/config'` pulls Vite's declarations, and with them
 * `/// <reference types="node" />`, into whatever program includes this file.
 * Vitest accepts a plain object.
 */
export default {
  test: {
    name: 'analysis',
    // `node` rather than a DOM environment: the core has to hold where there
    // is no DOM (an instance), and a test under jsdom would hide a `document`.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
