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
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
