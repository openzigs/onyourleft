// SPDX-License-Identifier: AGPL-3.0-or-later
// Spike 0024 (#1273), W7: the JavaScript a page loads, gzipped (level 9), from the files the page
// actually requested until its first realistic frame and 5 s after.
//   node spike-0024/scripts/js-size.mjs <label> <dist dir> <url>
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const [label, dist, url] = process.argv.slice(2);
const profile = mkdtempSync(join(tmpdir(), 'oyl-spike-0024-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1280, height: 800 } });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  const scripts = new Set();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\.(m?js|wasm)$/.test(path)) scripts.add(path);
  });
  await page.goto(url);
  const name = url.includes('realistic.html') ? '__oylRealistic' : '__oylSpike';
  await page.waitForFunction((n) => window[n]?.ready === true || (window[n]?.errors?.length ?? 0) > 0, name, { timeout: 120_000 });
  await page.waitForTimeout(5_000);
  const state = await page.evaluate((n) => ({ ready: window[n].ready, errors: window[n].errors, backend: window[n].drawing?.webgpuBackend }), name);
  let raw = 0, gz = 0, wasmRaw = 0, wasmGz = 0;
  const rows = [];
  for (const path of [...scripts].sort()) {
    const bytes = readFileSync(join(dist, path));
    const zipped = gzipSync(bytes, { level: 9 }).length;
    rows.push(`${path} ${bytes.length} ${zipped}`);
    if (path.endsWith('.wasm')) { wasmRaw += bytes.length; wasmGz += zipped; } else { raw += bytes.length; gz += zipped; }
  }
  console.log(JSON.stringify({ label, url, state, js: { files: rows.filter((r) => !r.includes('.wasm')).length, raw, gz, gzKiB: +(gz / 1024).toFixed(1) }, wasm: { raw: wasmRaw, gz: wasmGz }, rows }, null, 1));
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
