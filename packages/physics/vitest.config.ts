// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/physics`.
 *
 * **Deliberately imports nothing**, for the reason `packages/domain`'s copy of
 * this file records: `import { defineConfig } from 'vitest/config'` pulls Vite's
 * type declarations into whichever TypeScript program contains this file, and
 * those declare `/// <reference types="node" />`. That reference reaches
 * @types/node from the workspace root and defeats the `types: []` narrowing in
 * `tsconfig.json` — which is the thing that makes `process`, `Buffer` and
 * `fetch` compile errors in this package. This file is inside that program, so
 * a type that leaks in here leaks in everywhere.
 *
 * It is not hypothetical: that is exactly how the guard was silently broken in
 * `packages/domain` until #23's review (CLAUDE.md §4d). Vitest accepts a plain
 * object, and `defineConfig` is only an identity function for editor typing.
 */
export default {
  test: {
    name: 'physics',
    // `node` rather than a DOM environment, deliberately: this package must
    // hold in an environment with neither a DOM nor a filesystem, and a test
    // run under jsdom would hide an accidental `window` reference behind a
    // global that happened to exist.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
