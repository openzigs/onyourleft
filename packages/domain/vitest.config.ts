// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/domain`.
 *
 * **Deliberately imports nothing.** The obvious spelling is
 * `import { defineConfig } from 'vitest/config'`, and `defineConfig` is only an
 * identity function for editor typing — but that import pulls Vite's type
 * declarations into this package's TypeScript program, and those declare
 * `/// <reference types="node" />`. That reference reaches @types/node from the
 * workspace root and defeats the `types: []` narrowing in `tsconfig.json`,
 * which is what makes `process`, `Buffer` and `fetch` compile errors in this
 * package. A config file is part of the same program as `src/`, so a type that
 * leaks in here leaks in everywhere. Vitest accepts a plain object.
 */
export default {
  test: {
    name: 'domain',
    // `node` rather than a DOM environment, deliberately: this package must
    // hold in an environment with neither a DOM nor a filesystem, and a test
    // run under jsdom would hide an accidental `document` reference.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
