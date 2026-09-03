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
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
