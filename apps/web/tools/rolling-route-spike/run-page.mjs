// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: builds `page/`, serves it, rides it in Chromium once per
 * configuration and writes each run's summary to `results/`. From `apps/web`:
 *
 *     node tools/rolling-route-spike/run-page.mjs [seconds] [world:planning:place ...]
 *
 * with no configurations it rides all eight (two worlds, two planners, two
 * places). It reads the published basemap over the internet, as a ride would.
 *
 * ⚠️ **Chromium on the GPU**, not the browser gate's SwiftShader: the gate's
 * `LAUNCH_ARGS` draw on the CPU, which measures nothing about a frame. The
 * full Chromium build in its new headless mode, which on macOS draws through
 * ANGLE on Metal; each result records the WebGL renderer it actually got.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';

import { chromium } from '@playwright/test';
import { build, preview, runnerImport } from 'vite';

const config = fileURLToPath(new URL('./vite.config.ts', import.meta.url));
const results = fileURLToPath(new URL('./results/', import.meta.url));
const raw = fileURLToPath(new URL('./page/dist/raw/', import.meta.url));

const seconds = Number(process.argv[2] ?? '300');
const asked = process.argv.slice(3);
const runs =
  asked.length > 0
    ? asked
    : ['stylised', 'realistic'].flatMap((world) =>
        ['main', 'worker'].flatMap((planning) =>
          ['suburb', 'city'].map((place) => `${world}:${planning}:${place}`),
        ),
      );

const { module: summary } = await runnerImport(
  fileURLToPath(new URL('./summary.ts', import.meta.url)),
);

await build({ configFile: config, logLevel: 'warn' });
mkdirSync(raw, { recursive: true });
mkdirSync(results, { recursive: true });
const server = await preview({ configFile: config, preview: { port: 4317, strictPort: true } });
const origin = 'http://localhost:4317';

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
let failed = false;
try {
  for (const name of runs) {
    const [world, planning, place] = name.split(':');
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(
      `${origin}/?world=${world}&planning=${planning}&place=${place}&seconds=${String(seconds)}`,
    );
    await page.waitForFunction(() => globalThis.__spike?.done === true, undefined, {
      timeout: (seconds + 240) * 1000,
      polling: 1000,
    });
    const run = await page.evaluate(() => globalThis.__spike);
    await page.close();
    const file = `${world}-${planning}-${place}`;
    writeFileSync(`${raw}${file}.json`, JSON.stringify(run));
    if (run.error !== undefined || errors.length > 0) {
      failed = true;
      console.log(`${file}: ${run.error ?? ''} ${errors.join(' | ')}`);
      continue;
    }
    const summed = summary.summariseRun(run);
    writeFileSync(`${results}${file}.json`, `${JSON.stringify(summed, null, 2)}\n`);
    console.log(`${file}: ${JSON.stringify(summed.overall)}`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
process.exitCode = failed ? 1 : 0;
