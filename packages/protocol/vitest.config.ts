// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/protocol`.
 *
 * **Deliberately imports nothing**, for the reason `packages/domain`'s and
 * `packages/physics`' copies record: importing `vitest/config` pulls Vite's
 * declarations, and through them `@types/node`, into the program that
 * `tsconfig.json`'s `types: []` narrows — which is what makes `WebSocket`,
 * `fetch` and `Buffer` compile errors here (docs/agents/lint-boundaries.md §4d).
 */
export default {
  test: {
    name: 'protocol',
    // `node` rather than a DOM environment: this package must hold where there
    // is neither, and jsdom would hide an accidental `window` behind a global.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
