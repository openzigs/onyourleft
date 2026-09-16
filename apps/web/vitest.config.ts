// SPDX-License-Identifier: AGPL-3.0-or-later

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    // `node` with server-side rendering rather than jsdom: the scaffold's
    // assertions read rendered markup, so a DOM implementation would be a
    // dependency that buys nothing. #48 adds one when there is interaction to
    // test.
    environment: 'node',
    // `fake-indexeddb/auto` for the same reason `packages/store` uses it: the
    // recorder's tests need **IndexedDB**, not a DOM. It installs `indexedDB`
    // and the `IDB*` constructors on `globalThis` and nothing else, so an
    // accidental `document` reference in a recorder still fails rather than
    // being hidden behind a working global.
    setupFiles: ['fake-indexeddb/auto'],
    // ⚠️ `browser/` as well as `src/`, since #63's fixture archive. The browser
    // gate's directory is not all Playwright specs: `pmtiles-fixture.ts` is a
    // pure encoder that `vite.browser.config.ts` calls at build time, and its
    // own test is a Vitest one. Without this line that file matches neither
    // runner's selector — Playwright takes `**/*.browser.spec.ts` and this took
    // `src/` — so it would be a test nobody runs, which is worse than none.
    // `packages/fit/vitest.config.ts` includes `tools/**/*.test.ts` for the
    // same reason and about the same kind of file: an authoring-time generator
    // whose output is a committed or built artefact.
    //
    // It does not widen the **coverage** report, which is `apps/*/src/**` in
    // the root config, and deliberately: a fixture generator's coverage mixed
    // into a client's denominator is the thing #110 decided against for
    // `packages/fit/tools`.
    include: ['src/**/*.test.{ts,tsx}', 'browser/**/*.test.{ts,tsx}'],
  },
});
