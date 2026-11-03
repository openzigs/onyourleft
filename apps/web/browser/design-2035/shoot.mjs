// SPDX-License-Identifier: AGPL-3.0-or-later
// #2035 throwaway: serve dist/ and screenshot every option. Never merged.
// Usage (from apps/web): node browser/design-2035/shoot.mjs <outDir>
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dist = fileURLToPath(new URL('./dist', import.meta.url));
const out = process.argv[2];
if (!out) throw new Error('give an output directory');
await mkdir(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(dist, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const shots = [];
for (const option of ['A', 'B', 'C']) {
  for (const theme of ['dark', 'light']) {
    for (const [device, width, height] of [['tablet', 1280, 800], ['phone', 412, 915]]) {
      shots.push({ file: `${option}-home-${device}-${theme}.png`, url: `?option=${option}&theme=${theme}&view=home`, width, height, full: false });
    }
  }
  shots.push({ file: `${option}-hud-tablet-dark.png`, url: `?option=${option}&view=hud`, width: 1280, height: 800, full: false });
  shots.push({ file: `${option}-board.png`, url: `?option=${option}&theme=dark&view=board`, width: 1400, height: 900, full: true });
  shots.push({ file: `${option}-home-phone-dark-full.png`, url: `?option=${option}&theme=dark&view=home`, width: 412, height: 915, full: true });
}
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${origin}/index.html${s.url}`);
  await page.waitForFunction(() => window.__ready === true);
  await page.screenshot({ path: join(out, s.file), fullPage: s.full });
  if (errors.length) console.log(s.file, errors);
  await page.close();
}
// The measured cap height of a primary numeral, for the 16 arc-minute check.
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const option of ['A', 'B', 'C']) {
  await page.goto(`${origin}/index.html?option=${option}&view=hud`);
  await page.waitForFunction(() => window.__ready === true);
  const m = await page.evaluate(() => {
    const el = document.querySelector('.d-num--primary');
    const cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} Barlow`;
    const t = c.measureText('248');
    return { fontSize: cs.fontSize, weight: cs.fontWeight, digitAscent: t.actualBoundingBoxAscent, barlow: document.fonts.check(`${cs.fontWeight} 10px Barlow`) };
  });
  console.log(option, JSON.stringify(m));
}
await browser.close();
server.close();
console.log('wrote', shots.length, 'screenshots to', out);
