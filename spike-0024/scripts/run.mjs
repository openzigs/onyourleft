// SPDX-License-Identifier: AGPL-3.0-or-later
// Spike 0024 (#1273). One measured run on the Mac, in the installed Google Chrome, headed.
//
//   node spike-0024/scripts/run.mjs <label> '<query>' [--uncapped] [--shot] [--page=/webgpu.html] [--port=4331]
//
// Expects `vite preview` already serving the built page on the port (see mac.sh).
// Writes spike-0024/results/<label>.json; with --shot, spike-0024/screenshots/<label>.png.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const [label, query, ...flags] = process.argv.slice(2);
const flag = (name) => flags.includes(`--${name}`);
const option = (name, fallback) =>
  flags.find((each) => each.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const page_ = option('page', '/webgpu.html');
const port = option('port', '4331');
const global_ = page_.includes('realistic') ? '__oylRealistic' : '__oylSpike';

const profile = mkdtempSync(join(tmpdir(), 'oyl-spike-0024-'));
const args = ['--no-first-run', '--no-default-browser-check'];
if (flag('uncapped')) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');

/** CPU seconds so far of this profile's renderer and GPU processes, from `ps`. */
function cpu() {
  const out = execFileSync('ps', ['-axo', 'cputime=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const seconds = { renderer: 0, gpu: 0, browser: 0 };
  for (const line of out.split('\n')) {
    if (!line.includes(profile)) continue;
    const time = line.trim().split(/\s+/)[0];
    const parts = time.split(':').map(Number);
    const each = parts.reduce((sum, part) => sum * 60 + part, 0);
    if (line.includes('--type=renderer')) seconds.renderer += each;
    else if (line.includes('--type=gpu-process')) seconds.gpu += each;
    else if (!line.includes('--type=')) seconds.browser += each;
  }
  return seconds;
}

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args,
});
const lines = [];
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('OYL-')) lines.push(text);
  });
  page.on('pageerror', (error) => lines.push(`PAGEERROR ${error.message}`));
  const opened = Date.now();
  await page.goto(`http://127.0.0.1:${port}${page_}?${query}`);
  await page.waitForFunction((name) => window[name]?.ready === true || (window[name]?.errors?.length ?? 0) > 0, global_, { timeout: 120_000 });
  const firstFrameWallMs = Date.now() - opened;
  let shot;
  if (flag('shot')) {
    await page.waitForTimeout(4_000);
    shot = join(root, 'spike-0024/screenshots', `${label}.png`);
    await page.screenshot({ path: shot });
  }
  await page.waitForTimeout(3_000);
  const before = cpu();
  const from = Date.now();
  let published;
  if (!flag('shot') && !flag('first')) {
    await page
      .waitForFunction((name) => window[name]?.result !== undefined, global_, { timeout: 1_500_000 })
      .catch(() => undefined);
  }
  const after = cpu();
  const wallSeconds = (Date.now() - from) / 1000;
  published = await page.evaluate((name) => JSON.parse(JSON.stringify(window[name])), global_);
  const gpuInfo = !flag('dump')
    ? undefined
    : await page.evaluate(() => {
        const rows = [];
        globalThis.__oylSpikeDrawn.scene.traverse((node) => {
          if (!node.isMesh || !node.visible) return;
          const m = node.material;
          rows.push(
            [
              node.type,
              node.name,
              m.type,
              m.name,
              'vc=' + m.vertexColors,
              'inst=' + (node.count ?? '-'),
              'ic=' + (node.instanceColor ? node.instanceColor.array.constructor.name : '-'),
              Object.entries(node.geometry.attributes)
                .map(([k, v]) => k + ':' + v.array.constructor.name.replace('Array', '') + v.itemSize + (v.normalized ? 'n' : ''))
                .join(' '),
              'idx=' + (node.geometry.index?.count ?? '-'),
            ].join(' | '),
          );
        });
        return { rows, ported: [...globalThis.__oylPorted] };
      });
  if (gpuInfo) console.log(gpuInfo.rows.join('\n'), '\n', JSON.stringify(gpuInfo.ported));
  const out = {
    label,
    query,
    page: page_,
    flags,
    when: new Date().toISOString(),
    loadAverage: loadavg(),
    firstFrameWallMs,
    wallSeconds,
    cpuSeconds: {
      renderer: after.renderer - before.renderer,
      gpu: after.gpu - before.gpu,
      browser: after.browser - before.browser,
    },
    published,
    lines,
    shot,
    gpuInfo,
  };
  writeFileSync(join(root, 'spike-0024/results', `${label}.json`), `${JSON.stringify(out, null, 1)}\n`);
  const result = published?.result;
  console.log(
    label,
    JSON.stringify({
      errors: published?.errors,
      first: published?.firstFrameMs,
      fps: result?.fps,
      frameMs: result?.frameMs,
      renderMs: result?.renderMs,
      tri: result?.lastFrame?.triangles ?? result?.trianglesPerFrame,
      calls: result?.lastFrame?.drawCalls ?? result?.lastFrame?.calls ?? result?.drawCalls,
      cpu: out.cpuSeconds,
      wall: wallSeconds,
      load: loadavg()[0].toFixed(1),
      buffer: result?.drawingBuffer,
      gaps: result?.gapsOver100Ms ?? result?.stalls,
      webgpu: result?.webgpuBackend,
    }),
  );
  for (const line of lines.filter((each) => /ERROR|CONSOLE/.test(each)).slice(0, 25)) console.log('  ', line.slice(0, 300));
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
