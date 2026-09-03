// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest configuration for `@onyourleft/store`.
 *
 * **Imports nothing**, for the reason `packages/domain/vitest.config.ts` gives:
 * `import { defineConfig } from 'vitest/config'` pulls Vite's declarations, and
 * through them `/// <reference types="node" />`, into the same TypeScript
 * program as `src/`. That would defeat this package's `types: []` narrowing.
 * `defineConfig` is only an identity function for editor typing and Vitest
 * accepts a plain object, so nothing is lost.
 *
 * `environment: 'node'` with `fake-indexeddb/auto` in `setupFiles`, rather than
 * jsdom or happy-dom. The tests need **IndexedDB**, not a DOM: an activity
 * store never touches `document`. A whole DOM implementation would be a larger
 * dependency that also hides an accidental `document` reference behind a
 * working global. `fake-indexeddb` (Apache-2.0) installs `indexedDB`,
 * `IDBKeyRange`, `IDBObjectStore` and `IDBIndex` on `globalThis` and nothing
 * else — and exposing `IDBObjectStore` and `IDBIndex` is what lets
 * `activity-store.index-path.test.ts` assert that a list query goes through an
 * index rather than a full object-store scan.
 */
export default {
  test: {
    name: 'store',
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['src/**/*.test.ts'],
  },
};
