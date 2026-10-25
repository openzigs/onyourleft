// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's built page draws the realistic world under its own policy — #1683.
 *
 * `vite.demo.config.ts` is built here, into `browser/dist/` (ignored, and
 * pruned by the repository rules), and every file of it is served by
 * `page.route` at an origin of its own. Every other request is aborted and
 * recorded, so "no request left the page" is a measurement, not an assumption.
 *
 * Each claim has its control. The page as built reaches the realistic world
 * with no policy violation at all; the same page with `'unsafe-eval'` taken out
 * of its policy (the page #1645 shipped) is refused the transcoder, and the
 * load then SETTLES — the stylised world and `realisticWorldNotice` — instead
 * of drawing the stylised world forever, which is what #1683 found.
 *
 * ⚠️ **Every snapshot is recorded, not only the last.** On SwiftShader the
 * quality ladder (`quality.ts` §`nextWorldQuality`) steps a ride out of the
 * realistic world soon after it is drawn, and says so with
 * `REALISTIC_WORLD_LEFT_NOTICE`: that is the ladder working, on a software
 * GPU, and not a load that failed. So the claim is that `window.__oylDemo`
 * said `world: 'realistic'` at some point, read off a setter installed before
 * the page's own script runs.
 *
 * ⚠️ **The violations recorded are the DOCUMENT's.** A `blob:` worker's own —
 * the transcoder's `new Function` — fire on the worker's global scope, which
 * no listener here can reach, and Chromium logs them to no console Playwright
 * relays. So the transcoder's half is proven by its outcome: the page as built
 * draws the realistic world, and the same page without `'unsafe-eval'` does
 * not. The `blob:` half is a document violation, and its control sees it.
 */

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';

import { filesUnder } from '../tools/demo/demo-output';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(WEB, 'browser/dist/demo-world');
const DEMO_ORIGIN = 'http://demo.test';
/** `realistic-assets.ts` §`realisticWorldNotice`, for a load that failed. */
const COULD_NOT_LOAD = /^The realistic world could not be loaded/;
/** `realistic.browser.spec.ts`'s budget for the same world on the same SwiftShader. */
const REALISTIC_LOAD_BUDGET_MS = 150_000;

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

interface Served {
  /** Every request to another origin, which was aborted. */
  readonly elsewhere: string[];
  /** Every request to the demo's origin that the build has no file for. */
  readonly missing: string[];
}

/** Serve the build at {@link DEMO_ORIGIN}, with `html` as its page, and record every violation. */
async function serve(page: Page, html: string): Promise<Served> {
  const files = new Set(filesUnder(OUT));
  const served: Served = { elsewhere: [], missing: [] };
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== DEMO_ORIGIN) {
      served.elsewhere.push(url.href);
      return route.abort();
    }
    const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (path === 'index.html') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    if (!files.has(path)) {
      served.missing.push(path);
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: TYPES[extname(path)] ?? 'application/octet-stream',
      body: readFileSync(join(OUT, path)),
    });
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    const published: { world: string; notice?: string }[] = [];
    const record = window as unknown as {
      violations: string[];
      published: { world: string; notice?: string }[];
    };
    record.violations = seen;
    record.published = published;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    let last: unknown;
    Object.defineProperty(window, '__oylDemo', {
      configurable: true,
      get: () => last,
      set: (snapshot: { world: string; notice?: string }) => {
        last = snapshot;
        published.push({ world: snapshot.world, notice: snapshot.notice });
      },
    });
  });
  await page.goto(`${DEMO_ORIGIN}/`);
  return served;
}

interface Seen {
  /** Every world `window.__oylDemo` has said, in order, each once. */
  readonly worlds: string[];
  /** Every notice it has said, each once. */
  readonly notices: string[];
  readonly violations: string[];
}

function seen(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const record = window as unknown as {
      violations: string[];
      published: { world: string; notice?: string }[];
    };
    const once = (each: (string | undefined)[]): string[] =>
      each.filter((one, at): one is string => one !== undefined && each[at - 1] !== one);
    return {
      worlds: once(record.published.map((each) => each.world)),
      notices: [...new Set(record.published.flatMap((each) => each.notice ?? []))],
      violations: [...record.violations],
    };
  });
}

test.describe('the demo’s built page and the realistic world — #1683', () => {
  test.describe.configure({ mode: 'serial' });
  let built = '';

  test.beforeAll(async () => {
    await build({
      configFile: join(WEB, 'vite.demo.config.ts'),
      logLevel: 'silent',
      build: { outDir: OUT },
    });
    built = readFileSync(join(OUT, 'index.html'), 'utf8');
  });

  test('draws the realistic world, with no policy violation and no request elsewhere', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS + 30_000);
    const served = await serve(page, built);
    await expect
      .poll(async () => (await seen(page)).worlds, { timeout: REALISTIC_LOAD_BUDGET_MS })
      .toContain('realistic');
    const after = await seen(page);
    expect(after.worlds.slice(0, 2)).toEqual(['stylised', 'realistic']);
    expect(after.violations).toEqual([]);
    expect(after.notices.filter((each) => COULD_NOT_LOAD.test(each))).toEqual([]);
    expect(served.elsewhere).toEqual([]);
    // #1683 §4: the banners' glyphs are the page's own, not a 404.
    expect(served.missing).toEqual([]);
  });

  test('control: refused the transcoder, the load settles and says so', async ({ page }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS + 30_000);
    const refused = built.replace(" 'unsafe-eval'", '');
    expect(refused).not.toBe(built);
    const served = await serve(page, refused);
    await expect
      .poll(async () => (await seen(page)).notices, { timeout: REALISTIC_LOAD_BUDGET_MS })
      .toContainEqual(expect.stringMatching(COULD_NOT_LOAD));
    const after = await seen(page);
    expect(after.worlds).toEqual(['stylised']);
    expect(served.elsewhere).toEqual([]);
  });

  test('control: without blob: in connect-src the page is refused its own textures', async ({
    page,
  }) => {
    test.setTimeout(REALISTIC_LOAD_BUDGET_MS + 30_000);
    const refused = built.replace("connect-src 'self' blob:;", "connect-src 'self';");
    expect(refused).not.toBe(built);
    await serve(page, refused);
    await expect
      .poll(async () => (await seen(page)).violations, { timeout: REALISTIC_LOAD_BUDGET_MS })
      // A browser reports a `blob:` URL by its scheme alone.
      .toContain('connect-src blob');
  });
});
