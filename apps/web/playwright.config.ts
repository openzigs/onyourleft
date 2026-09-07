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

/**
 * A fixed, unusual port.
 *
 * `strictPort` so a clash fails the run instead of silently serving the gate
 * from somewhere the spec is not looking — which would make every network
 * assertion below true of an empty page.
 */
const PORT = 4319;

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
 * That is exactly what happened on the first CI run of this gate: green in a
 * container with no IPv6 at all, red on the runner. So the address is stated
 * rather than resolved, and the server's bind and the URL the poller asks for
 * are built from **this one constant** — they cannot drift, and neither
 * depends on what `localhost` happens to mean on the machine.
 */
const HOST = '127.0.0.1';
export const HARNESS_ORIGIN = `http://${HOST}:${String(PORT)}`;

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
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        // No sandbox: the CI runner and this container both run as root, where
        // Chromium's sandbox refuses to start. It is a test browser loading a
        // page from the loopback interface with no credentials of any kind.
        '--no-sandbox',
      ],
    },
  },
  webServer: {
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
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
});
