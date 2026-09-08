// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vitest configuration for `@onyourleft/mobile`.
 *
 * **Imports nothing**, for the reason `packages/domain/vitest.config.ts`
 * records: `import { defineConfig } from 'vitest/config'` pulls Vite's type
 * declarations, and through their `/// <reference types="node" />` all of
 * `@types/node`, into whatever TypeScript program this file belongs to.
 * Vitest accepts a plain object.
 */
export default {
  test: {
    name: 'mobile',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
