// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/map-features`.
 *
 * **Deliberately imports nothing**, for the reason
 * `packages/domain/vitest.config.ts` records: `import { defineConfig } from
 * 'vitest/config'` pulls Vite's declarations, and with them
 * `/// <reference types="node" />`, into whatever program includes this file.
 * Vitest accepts a plain object.
 */
export default {
  test: {
    name: 'map-features',
    // `node`: the decoder has to hold where there is no DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
