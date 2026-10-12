// SPDX-License-Identifier: AGPL-3.0-or-later
// Spike 0024 (#1273). One measured run on the Mac, in the installed Google Chrome, headed,
// in a throwaway profile that is deleted afterwards.
//
//   node spike-0024/scripts/run.mjs <label> '<query>' [--seconds=60] [--uncapped] [--shot=<file>]
//        [--first] [--dump] [--page=/webgpu.html] [--port=4331] [--out=<dir>]
//
// Expects the built page already served on the port (see mac.sh).
// Writes <out>/<label>.json. An image is written only where --shot says, and that is never
// inside the repository (owner ruling 2026-10-12).
//
// The frame intervals are taken OUTSIDE the page, by a wrapper on requestAnimationFrame
// installed before any script of the page runs, so the unchanged control page and the
// spike's page are timed by one instrument (and the control gets the p95 it does not publish).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  flags.find((each) => each.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const page_ = option('page', '/webgpu.html');
const port = option('port', '4331');
const seconds = Number(option('seconds', '60'));
const out = option('out', join(root, 'spike-0024/results'));
const shot = option('shot', undefined);
const global_ = page_.includes('realistic') ? '__oylRealistic' : '__oylSpike';
const WARM_UP_MS = 3_000;

const profile = mkdtempSync(join(tmpdir(), 'oyl-spike-0024-'));
const args = ['--no-first-run', '--no-default-browser-check'];
if (flag('uncapped')) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');

function ps() {
  return execFileSync('ps', ['-axo', 'cputime=,%cpu=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
}

/** CPU seconds so far of this profile's renderer and GPU processes, from `ps`. */
function cpu() {
  const seconds_ = { renderer: 0, gpu: 0, browser: 0 };
  for (const line of ps().split('\n')) {
    if (!line.includes(profile)) continue;
    const time = line.trim().split(/\s+/)[0];
    const each = time.split(':').map(Number).reduce((sum, part) => sum * 60 + part, 0);
    if (line.includes('--type=renderer')) seconds_.renderer += each;
    else if (line.includes('--type=gpu-process')) seconds_.gpu += each;
    else if (!line.includes('--type=')) seconds_.browser += each;
  }
  return seconds_;
}

/** What else is busy on the machine as the run starts: the five busiest processes that are not this run's. */
function busiest() {
  return ps()
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.includes(profile))
    .map((line) => {
      const [, percent, ...command] = line.trim().split(/\s+/);
      return { cpu: Number(percent), command: command.join(' ').slice(0, 90) };
    })
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 5);
}

const loadBefore = loadavg();
const busyBefore = busiest();
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args,
});
const lines = [];
try {
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const times = [];
    window.__oylRaf = times;
    window.requestAnimationFrame = (callback) =>
      raf((now) => {
        times.push(now);
        callback(now);
      });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('OYL-')) lines.push(text);
  });
  page.on('pageerror', (error) => lines.push(`PAGEERROR ${error.message}`));
  const opened = Date.now();
  await page.goto(`http://127.0.0.1:${port}${page_}?${query}`);
  await page.waitForFunction(
    (name) => window[name]?.ready === true || (window[name]?.errors?.length ?? 0) > 0,
    global_,
    { timeout: 120_000 },
  );
  const firstFrameWallMs = Date.now() - opened;
  let cpuSeconds;
  let wallSeconds;
  let external;
  if (shot !== undefined) {
    await page.waitForTimeout(4_000);
    mkdirSync(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });
  } else if (!flag('first')) {
    await page.waitForTimeout(WARM_UP_MS);
    const before = cpu();
    const from = Date.now();
    await page.waitForTimeout(seconds * 1000);
    const after = cpu();
    wallSeconds = (Date.now() - from) / 1000;
    cpuSeconds = {
      renderer: after.renderer - before.renderer,
      gpu: after.gpu - before.gpu,
      browser: after.browser - before.browser,
    };
    // The page's own result arrives at the end of its own window, a moment later.
    await page
      .waitForFunction((name) => window[name]?.result !== undefined, global_, { timeout: 60_000 })
      .catch(() => undefined);
    external = await page.evaluate(
      ({ name, warm, length }) => {
        const first = window[name].firstFrameMs;
        const from = first + warm;
        const to = from + length;
        const times = window.__oylRaf.filter((each) => each >= from && each <= to);
        const gaps = [];
        for (let index = 1; index < times.length; index += 1) gaps.push(times[index] - times[index - 1]);
        const sorted = [...gaps].sort((a, b) => a - b);
        const rank = (p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
        return {
          frames: gaps.length,
          fps: gaps.length / (length / 1000),
          p50: rank(50),
          p90: rank(90),
          p95: rank(95),
          p99: rank(99),
          max: sorted[sorted.length - 1],
          over20Ms: gaps.filter((each) => each > 20).length,
          over100Ms: gaps.filter((each) => each > 100).length,
        };
      },
      { name: global_, warm: WARM_UP_MS, length: seconds * 1000 },
    );
  }
  const published = await page.evaluate((name) => JSON.parse(JSON.stringify(window[name])), global_);
  // Added AFTER the one-sitting set (the tablet's cold starts showed the page's own first-frame
  // mark and the first paint apart under WebGPU): when the browser first painted the canvas.
  if (flag('first')) await page.waitForTimeout(3_000);
  const firstContentfulPaintMs = await page.evaluate(
    () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
  );
  const dump = !flag('dump')
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
              'inst=' + (node.count ?? '-'),
              'map=' + (m.map ? (m.map.name || m.map.image?.width + 'x' + m.map.image?.height) : '-'),
              'normalMap=' + (m.normalMap ? 'yes' : '-'),
              'idx=' + (node.geometry.index?.count ?? '-'),
            ].join(' | '),
          );
        });
        const scene = globalThis.__oylSpikeDrawn.scene;
        return {
          rows,
          ported: [...(globalThis.__oylPorted ?? [])],
          background: scene.background?.isTexture ? 'texture' : String(scene.background),
          environment: scene.environment?.isTexture ? 'texture' : String(scene.environment),
        };
      });
  const result = {
    label,
    query,
    page: page_,
    flags,
    when: new Date().toISOString(),
    loadAverageBefore: loadBefore,
    loadAverageAfter: loadavg(),
    busiestBefore: busyBefore,
    firstFrameWallMs,
    firstFrameMs: published?.firstFrameMs,
    firstContentfulPaintMs,
    wallSeconds,
    cpuSeconds,
    external,
    published,
    lines,
    shot,
    dump,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);
  const own = published?.result;
  console.log(
    label,
    JSON.stringify({
      errors: published?.errors,
      first: Math.round(published?.firstFrameMs ?? -1),
      fcp: firstContentfulPaintMs,
      ext: external && { fps: +external.fps.toFixed(1), p50: external.p50, p95: external.p95, p99: external.p99, o100: external.over100Ms },
      renderMs: own?.renderMs && { p50: own.renderMs.p50, p99: own.renderMs.p99 },
      tri: own?.lastFrame?.triangles ?? own?.trianglesPerFrame,
      calls: own?.lastFrame?.drawCalls ?? own?.lastFrame?.calls ?? own?.drawCalls,
      cpu: cpuSeconds,
      load: loadBefore[0].toFixed(1),
      webgpu: own?.webgpuBackend ?? published?.drawing?.webgpuBackend,
    }),
  );
  for (const line of lines.filter((each) => /ERROR|CONSOLE/.test(each)).slice(0, 12)) console.log('  ', line.slice(0, 300));
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
