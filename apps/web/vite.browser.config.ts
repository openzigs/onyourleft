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
 * ## No React plugin, and since #266 that is a measured claim rather than a
 * description
 *
 * This header used to read *"the harness is plain TypeScript"*, and the HUD
 * page (#266) renders a React component — so the sentence had to be either
 * corrected or replaced by a plugin. It is the former: Vite's esbuild transform
 * reads `jsx` out of `apps/web/tsconfig.json`, which is `react-jsx`, so a
 * `.tsx` entry compiles here with no plugin at all. Verified by building this
 * config and loading `hud.html` in the gate rather than by reasoning about it.
 *
 * ⚠️ What `@vitejs/plugin-react` adds over that is Fast Refresh and the dev
 * transforms — a dev-server concern, and this config is only ever *built* and
 * then served by `vite preview`. Adding it would be a second React toolchain to
 * keep in step with `vite.config.ts` for no behaviour the gate can observe.
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
    // ⚠️ Every page has to be named. Vite's multi-page mode discovers only
    // `index.html` by default, so adding a page without a line here builds a
    // harness the spec then cannot load — and the failure is a 404 during the
    // run rather than a build error, which reads like a server problem.
    rollupOptions: {
      input: {
        map: 'browser/index.html',
        game: 'browser/game.html',
        // #266. The ride HUD, laid out by a real engine at a phone's width —
        // the one thing jsdom cannot do, on the one surface where it is
        // load-bearing. `hud-harness.tsx` says what it does and does not prove.
        hud: 'browser/hud.html',
        // #307's review. The app shell — header, skip link, `main` — laid out
        // by a real engine at the viewport WCAG 2.2 SC 1.4.10 names. The chrome
        // was the one surface no browser had ever laid out here, which is how a
        // sticky header taking 70% of a 320×256 viewport passed every gate.
        // `shell-harness.tsx` says what it does and does not prove.
        shell: 'browser/shell.html',
        // Not a gate the way the other two are: `capture.html` is the tool a
        // person opens with a trainer in front of them (#111), and a headless
        // runner has no Bluetooth adapter. It is built and loaded here so that
        // the page cannot be discovered to be broken on the one afternoon
        // somebody has the hardware — see `capture.browser.spec.ts`.
        capture: 'browser/capture.html',
      },
    },
    // Sourcemaps so a failure in CI names a line of ours rather than a column
    // in a minified chunk. This bundle ships to nobody, so there is nothing to
    // weigh the cost against.
    sourcemap: true,
  },
});
