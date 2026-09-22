// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One screenshot per realism configuration, from the pinned headless Chromium
 * — #457, so the owner can see the look before touching the tablet.
 *
 * ```bash
 * pnpm --filter @onyourleft/web exec vite build --config vite.browser.config.ts
 * node apps/web/tools/realism/screenshots.ts [out-dir] [metres]
 * ```
 *
 * Serves `browser/dist` itself on 127.0.0.1 (the harness server binds that
 * address for §4f's reason) and opens `realism.html` with the rider held at
 * one distance and the panel hidden, in every configuration of
 * `MEASUREMENT_MATRIX`. It FAILS unless each one reaches `ready`, reports no
 * error and publishes more than one sampled frame. The render-scale rows are
 * checked and not photographed.
 *
 * ⚠️ **What these are NOT**: a performance number. SwiftShader rasterises on
 * the CPU; its frame time says nothing about a Mali GPU and is published only
 * with that label. They are pictures of THIS renderer — ADR 0009 forbids a
 * reference image from another product, not a picture of this one.
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', '..', 'browser', 'dist');
const HOST = '127.0.0.1';
const PORT = 4329;

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.hdr': 'application/octet-stream',
  '.pmtiles': 'application/octet-stream',
  '.map': 'application/json',
};

async function main(): Promise<void> {
  const out = process.argv[2] ?? join(HERE, 'build', 'screenshots');
  const at = process.argv[3] ?? '2790';
  const { MEASUREMENT_MATRIX, configQuery } = (await import(
    new URL('../../browser/realism/config.ts', import.meta.url).href
  )) as typeof import('../../browser/realism/config');
  if (!existsSync(join(DIST, 'realism.html')))
    throw new Error(`build the harness first: ${DIST} has no realism.html`);
  mkdirSync(out, { recursive: true });
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'));
    const file = join(DIST, path);
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(PORT, HOST, resolve));
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const results: unknown[] = [];
  try {
    for (const [index, row] of MEASUREMENT_MATRIX.entries()) {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const query = configQuery({ ...row.config, at: Number(at), panel: false, seconds: 4 });
      await page.goto(`http://${HOST}:${PORT}/realism.html${query}`);
      await page.waitForFunction(
        () => window.__oylRealism?.ready === true || (window.__oylRealism?.errors.length ?? 0) > 0,
        undefined,
        {
          timeout: 120_000,
        },
      );
      const errors = await page.evaluate(() => window.__oylRealism?.errors ?? []);
      if (errors.length > 0) throw new Error(`${row.name}: ${errors.join('; ')}`);
      await page.waitForFunction(() => window.__oylRealism?.result !== undefined, undefined, {
        timeout: 180_000,
      });
      const result = (await page.evaluate(() => window.__oylRealism?.result)) as
        { frameMs: { count: number } } | undefined;
      // ⚠️ A result of ONE frame is not a measurement: the tablet's first run
      // published `{p50: 43530, count: 1}` for the baseline. Every row must
      // reach `ready` and publish a distribution, or this run fails.
      const count = result?.frameMs.count ?? 0;
      if (count <= 1)
        throw new Error(`${row.name}: published ${count} frame(s), not a distribution`);
      const late = await page.evaluate(() => window.__oylRealism?.errors ?? []);
      if (late.length > 0) throw new Error(`${row.name}: ${late.join('; ')}`);
      console.log(`${row.name}: ready, ${count} frames sampled`);
      // The render-scale rows are checked but not photographed: at 960 px wide
      // a scale changes sharpness, which is not what a reader is looking for.
      if (row.config.scale !== 1) {
        await page.close();
        continue;
      }
      const name = `${String(index).padStart(2, '0')}-${row.name
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()}.jpg`;
      await page.screenshot({ path: join(out, name), type: 'jpeg', quality: 72 });
      results.push({
        name: row.name,
        file: name,
        result,
      });
      console.log(`${row.name}: ${name}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`OYL-REALISM-SCREENSHOTS ${JSON.stringify(results)}`);
}

if (process.argv[1]?.endsWith('screenshots.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
