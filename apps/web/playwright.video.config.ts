// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo video's checks — #1655: `pnpm --filter @onyourleft/web run demo:video:check`.
 *
 * ⚠️ **Not part of the browser gate, and not run on a pull request.** They
 * need `ffmpeg`, which the runner image does not have, and they render video:
 * `.github/workflows/demo-video.yml` installs it and runs them, by hand, before
 * it renders the presets. `playwright.config.ts` reads `browser/` for
 * `*.browser.spec.ts` and never sees these; this config reads `tools/demo/`
 * for `*.video.spec.ts` and nothing else. No web server: the render answers
 * the built demo's files itself (`tools/demo/render-video.ts`), so
 * `build:demo` comes first.
 *
 * Playwright's runner rather than Vitest's because the fixture route is baked
 * by `browser/demo-route-fixture.ts`, whose imports `node` cannot strip
 * (#1931) and Playwright's own transform can, as it does for the gate.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tools/demo',
  testMatch: '**/*.video.spec.ts',
  // Each case renders and decodes: seconds on a laptop, more on a runner.
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './demo/dist/video-check/test-results',
});
