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

import { defineConfig, type Plugin } from 'vite';

import {
  buildFixtureArchive,
  FIXTURE_ARCHIVE_FILE,
  FIXTURE_BOUNDED_ARCHIVE_FILE,
  PUBLISHED_ARCHIVE_BOUNDS,
} from './browser/pmtiles-fixture';
import { poseRuntime } from './tools/pose/pose-runtime-plugin';

/**
 * Emit the PMTiles archive the gate renders from (#63).
 *
 * Built rather than committed. `browser/dist` is already gitignored and already
 * pruned by `scripts/check-repo-rules.sh`, so the archive needs no new ignore
 * line, no `.spdx-exempt` entry — which §3a would refuse it anyway, since it is
 * not third-party generator output — and leaves nothing in the tree that a
 * reviewer cannot read. `pmtiles-fixture.ts` says what is in it and why it
 * carries no OpenStreetMap data.
 *
 * ⚠️ **`generateBundle` rather than a `public/` file**, because a file in
 * `browser/public/` would be a binary in the repository, which is the thing
 * above. The cost is that the archive exists only after a build: `vite preview`
 * serves `browser/dist`, and `test:browser` builds before it previews.
 */
function pmtilesFixture(): Plugin {
  return {
    name: 'oyl-pmtiles-fixture',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: FIXTURE_ARCHIVE_FILE,
        source: buildFixtureArchive(),
      });
      // The same tiles declaring only the published archive's coverage, for
      // the "ride outside the coverage" case (#534). pmtiles-fixture.ts says
      // why it holds every tile anyway.
      this.emitFile({
        type: 'asset',
        fileName: FIXTURE_BOUNDED_ARCHIVE_FILE,
        source: buildFixtureArchive(PUBLISHED_ARCHIVE_BOUNDS),
      });
    },
  };
}

export default defineConfig({
  // #530: the pose runtime the product ships, so `pose.browser.spec.ts` runs
  // the same bytes a rider's tablet would.
  plugins: [pmtilesFixture(), poseRuntime()],
  root: 'browser',
  // ⚠️ The APP's `public/`, not a `browser/public/` of the harness's own —
  // since ADR 0026. The realistic world's files are committed there and served
  // at `/realistic/…`, and `game.browser.spec.ts` §"the realistic world" and the
  // owner's `realistic.html` both load them from the path the product would.
  // It also copies the web app manifest and its icons, which nothing here reads.
  publicDir: '../public',
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
        // #373. The ride screen's own layout — the trainer status line, which
        // is the only rider-visible evidence that a gradient is reaching the
        // machine, and which fell outside the viewport in landscape while every
        // gate here stayed green. `ride-harness.tsx` says what it does and does
        // not prove, and why its control is what makes a green run mean
        // anything.
        ride: 'browser/ride.html',
        // #422. The Ride SCREEN — `views/RideView.tsx` at `#/`, which is not
        // the game's stage above. A prose reading measure put `WorkoutPanel`
        // below the fold on a landscape tablet, so structured workouts were
        // invisible and a rider testing whether ERG releases (#372) started a
        // plain recording instead. `rideview-harness.tsx` says what it proves.
        rideview: 'browser/rideview.html',
        // #440: the start of a loop, drawn by the real renderer at the real camera.
        loop: 'browser/loop.html',
        // #543: a bend, drawn by the real renderer and read back from straight above.
        bend: 'browser/bend.html',
        // #428: the home screen, laid out at a tablet's width and at 320 px.
        home: 'browser/home.html',
        // #528: the tripod phone's filming sign, at a phone's size — whether
        // it is the dominant thing on the screen, and whether the one stop
        // control is 44 × 44 and uncovered. `sidecamera-harness.tsx` says what
        // it does and does not prove.
        sidecamera: 'browser/sidecamera.html',
        // #529: the side-camera link, paired end to end in a real engine —
        // two peer connections through the real codes and the SDP rebuilt
        // from them. `sidelink-harness.ts` says what it does and does not
        // prove.
        sidelink: 'browser/sidelink.html',
        // #530: the tablet's pose model, in its real worker over the real
        // runtime, looking at a CC0 photograph of a rider side-on — and the
        // fence that keeps MediaPipe's usage log off the network.
        // `pose-harness.ts` says what it does and does not prove.
        pose: 'browser/pose.html',
        // ADR 0026 D-12: the ONE place the realistic world can be reached until
        // #475 offers it to riders — the owner's page, ridden automatically,
        // with the stylised world a tap away and a twenty-minute soak.
        // `realistic-harness.ts` says what it does; it asserts nothing.
        realistic: 'browser/realistic.html',
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
