// SPDX-License-Identifier: AGPL-3.0-or-later
// Spike 0024 (#1273). What the browser gate's own browser (the pinned Playwright Chromium, headless,
// with playwright.config.ts's SwiftShader flags) makes of WebGPURenderer. Not a measurement of speed.
//   node spike-0024/scripts/gate-probe.mjs [port]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const port = process.argv[2] ?? '4331';
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
for (const [name, args] of [['gate flags', LAUNCH_ARGS], ['gate flags + --enable-unsafe-webgpu', [...LAUNCH_ARGS, '--enable-unsafe-webgpu']]]) {
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  console.log(`== ${name}: ${browser.version()}`);
  await page.goto(`http://127.0.0.1:${port}/webgpu.html?backend=none`).catch(() => undefined);
  const probe = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return { gpu: false };
    const adapter = await navigator.gpu.requestAdapter().catch((error) => ({ error: String(error) }));
    if (adapter === null) return { gpu: true, adapter: null };
    if (adapter.error) return { gpu: true, adapter: adapter.error };
    return { gpu: true, adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, isFallbackAdapter: adapter.isFallbackAdapter ?? adapter.info.isFallbackAdapter } };
  });
  console.log('  probe', JSON.stringify(probe));
  for (const backend of ['webgpu', 'webgl2', 'webglrenderer']) {
    const each = await browser.newPage({ viewport: { width: 640, height: 400 } });
    const started = Date.now();
    await each.goto(`http://127.0.0.1:${port}/webgpu.html?backend=${backend}&at=2550`);
    const ok = await each
      .waitForFunction(() => window.__oylSpike?.ready === true || (window.__oylSpike?.errors?.length ?? 0) > 0, undefined, { timeout: 180_000 })
      .then(() => true, () => false);
    const state = await each.evaluate(() => ({ ready: window.__oylSpike.ready, errors: window.__oylSpike.errors.slice(0, 3), webgpuBackend: window.__oylSpike.drawing?.webgpuBackend, first: window.__oylSpike.firstFrameMs }));
    console.log(`  ${backend}: settled=${ok} after ${Date.now() - started} ms`, JSON.stringify(state).slice(0, 500));
    await each.close();
  }
  await browser.close();
}
