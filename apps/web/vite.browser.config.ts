// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The build behind the browser gate — `browser/harness.html`, and nothing else.
 *
 * A **second** Vite config rather than a second entry in the app's own, so the
 * harness cannot end up in a shipped bundle by accident: `vite.config.ts`
 * builds from `apps/web/index.html` and never sees this directory. The same
 * split `packages/fit` and `packages/sensors` use for their platform-free
 * tsconfigs — one file for what ships, one for what checks it.
 *
 * No React plugin: the harness is plain TypeScript driving the map adapter
 * directly. What it tests is `map/maplibre.ts`, which has no React in it.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  root: 'browser',
  // ⚠️ A **multi-page** app, which here means "a static file server". Vite's
  // default single-page mode rewrites every unknown path to `index.html`, so a
  // request for a missing archive comes back `200` with a page of HTML in it —
  // and the spec's "there is no archive yet" assertion reads that as success.
  // A real PMTiles archive is served from object storage behind a CDN
  // (ADR 0010 D-1), which 404s what it does not have. This makes the harness
  // server behave like the thing it stands in for.
  appType: 'mpa',
  build: {
    // Inside `browser/`, and named `dist`. Both halves matter: `.gitignore`
    // already ignores any `dist/`, and `scripts/check-repo-rules.sh` already
    // prunes any directory of that name — so the harness build needs neither a
    // new ignore line nor a new exclusion in the checker. Named
    // `../dist-browser` first, which the checker duly scanned and failed on for
    // a minified bundle with no SPDX header.
    outDir: 'dist',
    emptyOutDir: true,
    // Sourcemaps so a failure in CI names a line of ours rather than a column
    // in a minified chunk. This bundle ships to nobody, so there is nothing to
    // weigh the cost against.
    sourcemap: true,
  },
});
