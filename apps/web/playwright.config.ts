// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The browser gate's configuration.
 *
 * ## Chromium only, and that is not a shortcut
 *
 * ADR 0003 and CLAUDE.md §8: Web Bluetooth ships in no Safari and no Firefox,
 * anywhere, ever, so the core feature of this product is Chromium-only by the
 * platform's decision rather than ours. Running this gate on three engines
 * would be checking a map in browsers that cannot pair a trainer. The *map*
 * would work in Firefox — it is only WebGL — and that is worth having one day;
 * it is not worth tripling this job's runtime today.
 *
 * ## The SwiftShader flags are insurance, and that is a measured claim
 *
 * A headless Chromium with no GPU falls back to SwiftShader for WebGL, and on
 * some builds the fallback has to be asked for explicitly.
 *
 * ⚠️ **Not on this one.** Removing all three and re-running the gate leaves it
 * green: the Chromium these tests run against acquires a context without them.
 * So they are kept as insurance for a runner image that behaves differently,
 * **not** because their absence was observed to break anything — an earlier
 * version of this comment asserted they were load-bearing, and a mutation
 * showed that was not true here.
 *
 * What makes keeping them safe rather than superstitious is that the harness
 * asserts the context is live. If a runner ever gives MapLibre no GL at all,
 * the gate fails on that assertion with a reason, rather than passing over a
 * map that never drew anything.
 *
 * ## No retries
 *
 * `retries: 0`, deliberately. CLAUDE.md's posture throughout is that a flake is
 * not a root cause, and a retry count is how a genuinely flaky browser test
 * gets to stay in a gate. If this job turns out to be unstable the answer is to
 * fix or delete it, and a retry would hide the evidence needed to choose.
 */

import { defineConfig, devices } from '@playwright/test';

import { NIGHTLY } from './browser/nightly';
import { THEME_STORAGE_KEY } from './src/design/theme-selection';

/**
 * A fixed, unusual port.
 *
 * `strictPort` so a clash fails the run instead of silently serving the gate
 * from somewhere the spec is not looking — which would make every network
 * assertion below true of an empty page.
 */
const PORT = 4319;

/**
 * The **product** build's port, which is a different server (#408).
 *
 * ⚠️ The one above previews `browser/` — the harness — and an offline claim
 * about the product has to be measured against `apps/web/dist`, which that
 * server does not serve. So there are two `webServer` entries, not two
 * Playwright projects and emphatically not two CI jobs: `main` requires a
 * status check whose context is exactly `Repository rules`, and a second job
 * reports under a different context and could not block a merge (CLAUDE.md
 * §4c).
 *
 * ⚠️ **The product server serves a single-page app**, with Vite's default
 * `appType`. That is deliberate and is the opposite of the harness's `'mpa'`:
 * a static host serving this client rewrites an unknown path to `index.html`,
 * and #408's control depends on knowing which server answers what. The control
 * is a `fetch()` rather than a navigation for exactly that reason — see
 * `offline.browser.spec.ts`.
 */
const PRODUCT_PORT = 4320;

/**
 * The bind address, written down once.
 *
 * ⚠️ **`vite preview` defaults to `localhost`, and that is not the same thing
 * as `127.0.0.1`.** Debian and Ubuntu ship an `/etc/hosts` that maps
 * `localhost` to **both** `127.0.0.1` and `::1`, Node resolves it verbatim in
 * whatever order `getaddrinfo` returns, and a server handed `::1` listens on
 * IPv6 loopback alone. Playwright then polls `http://127.0.0.1:4319`, nothing
 * answers, and the run dies with `Timed out waiting 60000ms from
 * config.webServer` — which names the symptom and not one word of the cause.
 *
 * That is the explanation for the first CI run of this gate — green in a
 * container with no IPv6 at all, red on the runner — and it is an explanation
 * rather than an observation: what the run established is that nothing
 * answered on `127.0.0.1`, and the line naming the address the server did bind
 * to is the very one that was missing. So the address is stated
 * rather than resolved, and the server's bind and the URL the poller asks for
 * are built from **this one constant** — they cannot drift, and neither
 * depends on what `localhost` happens to mean on the machine.
 */
const HOST = '127.0.0.1';
export const HARNESS_ORIGIN = `http://${HOST}:${String(PORT)}`;
/** Where `apps/web/dist` is served from. The product, not the gate's own pages. */
export const PRODUCT_ORIGIN = `http://${HOST}:${String(PRODUCT_PORT)}`;

/**
 * The flags every browser this gate launches is given.
 *
 * Written down once and exported because `offline.browser.spec.ts` launches its
 * **own** persistent context — a service-worker registration and a Cache
 * Storage entry live in a profile directory, and `browser.newContext()` gives
 * each context its own empty one, so "come back tomorrow with no network" is
 * not expressible without one. A second copy of these flags is a second
 * browser configuration that can drift from this one silently.
 */
export const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  // No sandbox: the CI runner and this container both run as root, where
  // Chromium's sandbox refuses to start. It is a test browser loading a
  // page from the loopback interface with no credentials of any kind.
  '--no-sandbox',
  // #382. A synthetic camera — a rolling colour pattern — so that the one line
  // ADR 0029 D-9 rests on is EXERCISED rather than asserted: `getUserMedia`,
  // then a canvas draw, then a `toBlob` encode, in a real engine.
  // `shell.browser.spec.ts` §"the camera, in a real engine" is the reader.
  //
  // ⚠️ **Given to every browser this gate launches, and that is safe rather
  // than lazy**: nothing else here touches a media device, and the flags change
  // nothing for a page that never asks for one. A second launch configuration
  // for one spec is the drift this array exists to prevent — see above.
  '--use-fake-device-for-media-stream',
  // Auto-answers the permission prompt. Without it `getUserMedia` waits for a
  // dialog nobody is there to press, and the spec times out with no reason
  // attached — the shape #165 recorded.
  '--use-fake-ui-for-media-stream',
  // #529. Chromium otherwise hides a WebRTC host candidate's address behind an
  // mDNS `.local` name, and resolving one needs a multicast responder a CI
  // container may not have. Spike 0012 found both Android WebViews publish
  // their raw private address, so the raw address is the path production takes
  // — and the one `sidelink.browser.spec.ts` should measure. A name-only pair
  // is `side-link-code.test.ts`' and `side-link.test.ts`' case. Changes nothing
  // for a page that opens no peer connection.
  '--disable-features=WebRtcHideLocalIpsWithMdns',
];

/**
 * How long the whole run may take before it stops itself — #651.
 *
 * ⚠️ **The job's `timeout-minutes` is 25, and this has to END before it does,
 * or the run reports nothing**: a job the runner cancels says "cancelled" and
 * names no case and no describe. On the slower of the two runners CI lands on
 * (a job over 1 000 s; #651 read it as an AMD EPYC 7763) this gate's step
 * starts as late as 592 s into the job, behind the Vitest run, and builds for
 * 9 s before Playwright starts (run 36395959573; thirteen green `main` runs
 * read on 2026-09-28, 36370135206 to 36405580515), so 840 s ends it by
 * 1 441 s — 59 s inside the job's 1 500, with only the coverage publish and
 * upload (2–3 s) after it. ⚠️ **Nothing re-checks that 59 s.** Every step
 * added before this gate eats into it, and the first sign will be a cancelled
 * job rather than a red case: it was 42 s inside twenty minutes when #651
 * measured it, and 19 s by #682 once the build its sum left out is counted
 * (592 + 9 + 580), which is how 20 became 25.
 *
 * ⚠️ **It is 840 s since #682, and a reviewer who remembers 580 is reading
 * the old file.** A GREEN gate took 547 s of Playwright's 580 on 36405580515
 * — 94 %, its four game loads at 69 % to 93 % of their own budgets — where
 * #651's took 390 s to 405 s and the slowest it measured 452 s (run
 * 36318760634). 840 s is 1.54 times that green 547 s.
 *
 * Every load the gate pays for has a budget of its own, and the arithmetic
 * that fits the four game loads inside this one is `game.browser.spec.ts`
 * §`paysForTheRealisticLoad` — 814 s of 840 summed in a line, or 844 s if
 * `realistic.browser.spec.ts`' control load is the one that hangs rather than
 * its first; that spec's wait overlaps the game loads on the other worker, so
 * the line over-counts, and it is reasoned rather than measured. This stop
 * ends the gate either way. This is what still reports when something with no
 * budget of its own hangs: Playwright stops, marks what was running as
 * interrupted and what had not started as not run, and exits non-zero.
 */
/*
 * ⚠️ Since #866 the realistic loads and `realistic.browser.spec.ts` run in the
 * `nightly` project, from a workflow of their own, so the required gate's
 * worst case is far inside this and the arithmetic above is the NIGHTLY run's
 * (`game.browser.spec.ts` §`paysForTheRealisticLoad` says which). It stays
 * 840 s because the same config stops both runs.
 */
export const GATE_BUDGET_MS = 840_000;

/**
 * Every context this gate opens starts with "Match this device" chosen — #992.
 *
 * The owner's ruling of 2026-10-02 made a device that has never chosen DARK.
 * Every spec here that reads a palette says which one with Playwright's
 * `colorScheme` (light unless it says otherwise), so each origin's storage
 * starts with the palette choice set to `device`: the page then follows that
 * `colorScheme` exactly as it did before #992, and a light read is still a
 * light read. ⚠️ **What the default itself does is `theme.browser.spec.ts`'s**,
 * which empties this storage for the cases that measure it. A context a test
 * opens with `browser.newContext()` inherits this as it inherits `baseURL`; a
 * persistent context (`offline.browser.spec.ts`) does not, and reads no
 * palette.
 */
export const FOLLOW_THE_DEVICE = {
  cookies: [],
  origins: [HARNESS_ORIGIN, PRODUCT_ORIGIN].map((origin) => ({
    origin,
    localStorage: [{ name: THEME_STORAGE_KEY, value: 'device' }],
  })),
};

/** The game spec, which runs as a project of its own — see `projects`. */
const GAME_SPEC = /game\.browser\.spec\.ts$/;

/** A test tagged {@link NIGHTLY}, which runs in the `nightly` project and no other — #866. */
const TAGGED_NIGHTLY = new RegExp(NIGHTLY);

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.browser.spec.ts',
  // The whole gate is a handful of assertions against one page load. A budget
  // this generous is not a guess about speed; it is headroom so a loaded runner
  // costs seconds rather than a red build — the lesson #165 recorded.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  // Everything this gate generates lands under the harness build directory,
  // which `.gitignore` and `scripts/check-repo-rules.sh` both already handle by
  // its name. A failure artefact outside it would be a file the repository
  // rules scan and a file somebody eventually commits.
  outputDir: './browser/dist/test-results',
  use: {
    baseURL: HARNESS_ORIGIN,
    launchOptions: { args: LAUNCH_ARGS },
    storageState: FOLLOW_THE_DEVICE,
  },
  webServer: [
    {
      // `vite preview` over the harness build. The build is a separate step in
      // `test:browser`, so a failure to compile is reported as a build failure
      // rather than as a server that would not start.
      command: `pnpm exec vite preview --config vite.browser.config.ts --host ${HOST} --port ${String(PORT)} --strictPort`,
      url: HARNESS_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      // Playwright ignores a web server's stdout by default, so a server that
      // starts and is simply not where the poller is looking produces a timeout
      // with no output at all — the whole of what the first CI run told us. Vite
      // prints the address it bound to; pipe it, so the next failure of this
      // shape arrives with its own diagnosis attached.
      stdout: 'pipe',
    },
    {
      // The product (#408). `vite preview` with no `--config` reads
      // `vite.config.ts` and serves `dist`, which `test:browser` now builds
      // first — an offline claim about the product cannot be measured against
      // the harness.
      command: `pnpm exec vite preview --host ${HOST} --port ${String(PRODUCT_PORT)} --strictPort`,
      url: PRODUCT_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
  ],
  // ⚠️ **A backstop, not a budget — #651.** @see GATE_BUDGET_MS
  globalTimeout: GATE_BUDGET_MS,
  // ⚠️ **Playwright's default of half the cores, and that is measured — #651.**
  // The `ubuntu-latest` runner's four vCPUs are two cores' hyperthreads
  // (`lscpu`, run 36333257690). On that run a fourth Vitest worker made the
  // suite no faster — 336 s to 334 s — while its summed test time rose from
  // 676 s to 807 s and one case passed its timeout: a thread that shares a
  // core adds contention, not a core. Two workers here is one a core.
  // ⚠️ **Two projects, one browser, one run — #651, and the game spec is
  // LAST.** Playwright queues a project's groups in the order the projects are
  // listed, and the game spec is one group — its shared harness (#456) is a
  // worker fixture, so its four loads run one after another in one worker.
  //
  // ⚠️ Last, because its loads draw on the CPU: SwiftShader rasterises there
  // and one load already keeps every core busy. Listed FIRST, #651 ran them
  // beside the other specs and they slowed by half or more — the plain page
  // 34 s to 58 s, and `?shadow-map` past its 120 s budget (run 36326756014) —
  // and splitting the four loads across two workers doubled each of them —
  // `?realistic` 64 s to 145 s, `?realistic&trees` 79 s to 146 s, run
  // 36325068145 — and made the plain page's load a second time besides. So
  // they are queued after everything else, and `game.browser.spec.ts`
  // §`paysForTheRealisticLoad` is the arithmetic that fits a gate where every
  // one of them hangs inside `GATE_BUDGET_MS`.
  //
  // ⚠️ **"Last" is queue order and nothing more.** With two workers, the game
  // group starts as soon as one worker is free, which can be while the other
  // is still running the last `chromium` spec — so its first load can overlap
  // that spec's tail. Nothing here waits for the `chromium` project to finish;
  // a `dependencies` entry would, and it would also skip the game spec
  // whenever any other spec failed, which a gate must not do.
  //
  // Not a second browser and not a second job — one `playwright test`, one
  // Chromium, the one `Repository rules` check (CLAUDE.md §4c).
  //
  // ⚠️ **A third project since #866, `nightly`, and it is NOT part of the
  // gate.** Every test tagged `@nightly` (`browser/nightly.ts`, a reviewed
  // list) runs there and in neither project above, and every other test runs
  // in exactly one of those two and not there — `nightly-split.test.ts` holds
  // that by construction. `test:browser` names `chromium` and `game`;
  // `test:browser:nightly` names `nightly` and runs from
  // `.github/workflows/nightly.yml`, which cannot block a merge. A bare
  // `playwright test` runs all three, the nightly loads beside the game's.
  projects: [
    {
      name: 'chromium',
      testIgnore: GAME_SPEC,
      grepInvert: TAGGED_NIGHTLY,
      use: devices['Desktop Chrome'],
    },
    {
      name: 'game',
      testMatch: GAME_SPEC,
      grepInvert: TAGGED_NIGHTLY,
      use: devices['Desktop Chrome'],
    },
    { name: 'nightly', grep: TAGGED_NIGHTLY, use: devices['Desktop Chrome'] },
  ],
});
