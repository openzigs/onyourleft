// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'domain',
    // `node` rather than a DOM environment, deliberately: this package must
    // hold in an environment with neither a DOM nor a filesystem, and a test
    // run under jsdom would hide an accidental `document` reference.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
