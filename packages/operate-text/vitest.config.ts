// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/operate-text`.
 *
 * **Deliberately imports nothing**, for the reason `packages/domain`'s and
 * `packages/protocol`'s copies record: importing `vitest/config` pulls Vite's
 * declarations, and through them `@types/node`, into the program that
 * `tsconfig.json`'s `types: []` narrows (docs/agents/lint-boundaries.md §4d).
 */
export default {
  test: {
    name: 'operate-text',
    // `node` rather than a DOM environment: the instance's admin pages draw
    // these words where there is no DOM, and jsdom would hide a `document`.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
