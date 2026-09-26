// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The offline claim, proved in the pinned Chromium, with a control (#408).
 *
 * ## Why this belongs here and nowhere else
 *
 * CLAUDE.md §4f: `apps/web/browser/` is the only place in this repository where
 * a real browser runs, and jsdom cannot test this **at all** — no service
 * worker, no Cache Storage, and no network stack to switch off.
 * `BrowserContext.setOffline(true)` is the tool, and before this file
 * `grep setOffline` over this directory returned nothing.
 *
 * ## ⚠️ It runs against `apps/web/dist`, not against the harness
 *
 * Every other spec here drives a page built by `vite.browser.config.ts`. An
 * offline claim about the **product** has to be measured against the product,
 * so `playwright.config.ts` runs a second `webServer` over `dist` and
 * `PRODUCT_ORIGIN` is where it lives. Two servers, one Playwright project, one
 * CI job — a second job reports under a different context and could not block a
 * merge.
 *
 * ## ⚠️ It launches its own persistent context, and that is load-bearing
 *
 * A service-worker registration and a Cache Storage entry live in a **profile
 * directory**. `browser.newContext()` gives every context an empty one, so a
 * "fresh context" created that way has no worker and could never load offline —
 * the assertion would be about a browser that was never going to work.
 * `chromium.launchPersistentContext` over a directory this file owns is what
 * makes "close the tab, come back tomorrow with no network" expressible, and
 * closing and relaunching over the same directory is a genuinely fresh
 * browsing context: new process, new page, nothing in memory.
 *
 * ## ⚠️ The control, and why a green run without one would mean nothing
 *
 * `hud.browser.spec.ts` renders every panel twice and requires the second copy
 * to overflow, because a container that was too wide, a stylesheet that failed
 * to load and a panel that rendered nothing would all report "no overflow". The
 * same trap is sharper here. A green *"it loads offline"* is indistinguishable
 * from `setOffline(true)` silently not taking effect, from the page being
 * served by Chromium's own HTTP cache, from an empty page that "loaded" because
 * the navigation resolved to nothing, and from the harness serving a different
 * build.
 *
 * So two controls, and they fail for different reasons:
 *
 * 1. **A resource deliberately outside the precache must FAIL in the same
 *    offline run.** If it succeeds the browser is not really offline and every
 *    other assertion in this file is worthless. ⚠️ It is a `fetch()` and not a
 *    navigation, deliberately: the worker serves the precached shell for every
 *    navigation, so navigating to a non-precached path succeeds offline and
 *    proves nothing.
 * 2. **Every offline response must report `fromServiceWorker`.** A page served
 *    from Chromium's disk cache passes a naive offline test and says nothing
 *    about the worker.
 *
 * ## What this gate does NOT prove — the `pmtiles-fixture.ts` habit
 *
 * - **Nothing about a real phone.** A headless Chromium on the loopback
 *   interface is not a handlebar in a basement.
 * - **Nothing about the Android APK**, which is #410 and needs a device.
 * - **Nothing about the basemap**, which ADR 0024 D-2 deliberately does not
 *   precache and which is unpublished anyway (#53).
 * - **Nothing about install prompting.** `beforeinstallprompt` is behind an
 *   engagement heuristic no automated run satisfies, so "the manifest is
 *   correct" is as far as this goes.
 * - **Nothing about a whole offline RIDE.** The trainer game needs a saved
 *   route in IndexedDB before it loads its renderer at all, so what is asserted
 *   is that the renderer chunk and all twelve scenery assets are served by the
 *   worker with the network off, and that the module still imports. Driving a
 *   ride is validation 0002's job and it needs a trainer.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

import { HARNESS_ORIGIN, LAUNCH_ARGS, PRODUCT_ORIGIN } from '../playwright.config';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

/**
 * A same-origin path the build never emits.
 *
 * ⚠️ Online the product server answers it with `index.html` — Vite's preview
 * serves a single-page app — so it is a `200` when there is a network and a
 * rejected `fetch` when there is not, which is exactly the control's contract.
 * If it is ever emitted into `dist` this control silently stops controlling
 * anything, so `the control is outside the precache` asserts its absence.
 */
const CONTROL_PATH = '/not-precached-control.txt';

/** Every file in the product build, relative to `dist`, with `/` separators. */
function distFiles(directory = DIST, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      // `test-results` is Playwright's own output directory and is not part of
      // the build. It is under `browser/dist`, not here, but a failed run has
      // been known to leave artefacts about.
      if (entry === 'test-results') {
        continue;
      }
      found.push(...distFiles(full, `${prefix}${entry}/`));
      continue;
    }
    found.push(`${prefix}${entry}`);
  }
  return found;
}

/**
 * Everything the build emitted that the worker is expected to hold.
 *
 * The **directory**, not a list written in this file. That is what makes the
 * comparison below #406's derivation criterion at the build level: adding a
 * twelfth model, a new lazy route or a second stylesheet keeps it green with no
 * edit anywhere, and failing to cache one turns it red naming the file.
 *
 * Captured once, at module load, because one test below writes a second worker
 * script into `dist` and removes it again.
 */
const EXPECTED_PRECACHE = distFiles()
  // `sw-next-*` is a case's second worker, in `dist` only while that case runs.
  // Capturing at module load keeps THIS copy of the file from reading its own,
  // and the prefix keeps it from reading another copy's: `--repeat-each` over
  // several workers — how #467 was measured — runs this file in parallel with
  // itself, and a stray `sw-next-*` then asked for a precache of 29 files.
  .filter((file) => file !== 'sw.js' && !file.startsWith('sw-next-') && !file.endsWith('.map'))
  // ⚠️ ADR 0026 D-7: the realistic world is in `dist` — it ships in the APK —
  // and is deliberately NOT precached. Written here as the directory, which is
  // the rule, rather than read out of `precache.ts`, so this spec states the
  // decision independently of the code that implements it.
  .filter((file) => !file.startsWith('realistic/'))
  // ⚠️ #530: the side camera's pose model, its runtime and its worker are in
  // `dist` too, and are deliberately NOT precached — spike 0010 §7's warning
  // that they would multiply a first visit by about seven for every rider.
  // The directory again, for the same reason as the line above.
  .filter((file) => !file.startsWith('pose/'))
  .sort();

/** The realistic world's files in `dist`: there, and not to be cached. ADR 0026 D-7. */
const REALISTIC_IN_DIST = distFiles().filter((file) => file.startsWith('realistic/'));

const POSE_IN_DIST = distFiles().filter((file) => file.startsWith('pose/'));

/**
 * What the worker actually cached, read out of the browser.
 *
 * ⚠️ **Read from Cache Storage rather than parsed out of `dist/sw.js`.** The
 * first version of this file regexed the injected array out of the built
 * worker and could not find it: the minifier rewrites every string literal as a
 * template literal, so `["a","b"]` ships as `` [`a`,`b`] ``. Reading the cache
 * is not merely a workaround for that — it is the stronger claim. A list the
 * build injected is an intention; a cache the browser filled is what a rider
 * has.
 */
async function cachedPaths(page: Page): Promise<string[]> {
  const urls = await page.evaluate(async () => {
    const names = await caches.keys();
    const ours = names.filter((name) => name.startsWith('oyl-precache-'));
    const found: string[] = [];
    for (const name of ours) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        found.push(request.url);
      }
    }
    return found;
  });
  return urls.map((url) => new URL(url).pathname.replace(/^\//, '')).sort();
}

/**
 * Wait until the worker is active and its cache holds everything it precaches.
 *
 * ⚠️ **`expect.poll` and not `page.waitForFunction`, and this is a measurement
 * rather than a preference.** The first version of this helper passed an
 * **async** predicate to `waitForFunction`, which returns a `Promise` — and a
 * `Promise` object is truthy, so the wait resolved on its first poll every
 * time, whatever the cache held. It was a wait that could not fail: the run
 * went straight past it and the assertion that followed read an empty cache.
 * `expect.poll` awaits what its callback returns, so the condition is the
 * condition.
 */
async function waitForPrecache(page: Page, expected: number): Promise<void> {
  await expect
    .poll(async () => (await cachedPaths(page)).length, {
      timeout: 30_000,
      message: 'the worker never finished filling its precache',
    })
    .toBeGreaterThanOrEqual(expected);
  await expect
    .poll(
      async () =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.active !== undefined,
        ),
      { timeout: 30_000, message: 'no service worker became active' },
    )
    .toBe(true);
}

interface Session {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly close: () => Promise<void>;
}

/** A browser over a profile directory, so storage survives the context closing. */
async function session(profile: string): Promise<Session> {
  const context = await chromium.launchPersistentContext(profile, {
    args: LAUNCH_ARGS,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    close: async () => {
      await context.close();
    },
  };
}

let profile = '';

/**
 * What the worker held after one online visit, captured once.
 *
 * ⚠️ **One online session for the whole file, and it is not only about speed.**
 * Every offline assertion below depends on the profile being in exactly the
 * state a rider's browser is in after a first visit; priming it once, in one
 * place, means a test cannot accidentally assert against a profile some earlier
 * test left in a different state.
 */
let precached: string[] = [];

test.beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), 'oyl-offline-'));
  const first = await session(profile);
  await first.page.goto(`${PRODUCT_ORIGIN}/`);
  await waitForPrecache(first.page, EXPECTED_PRECACHE.length);
  precached = await cachedPaths(first.page);
  await first.close();
});

test.afterAll(() => {
  rmSync(profile, { recursive: true, force: true });
});

test.describe('what the worker actually cached', () => {
  test('is every file in dist, derived and not written down', () => {
    // ⚠️ **#406's derivation criterion, at the build level and in its strongest
    // form**: the expectation is the directory, and the observation is the
    // cache a real browser filled. Nothing in `precache.ts`, `sw.ts` or
    // `worker-core.ts` names an asset, so adding one is cached with no edit
    // here and failing to cache one is red naming the file.
    expect(precached).toEqual(EXPECTED_PRECACHE);
  });

  test('holds the renderer, the map, the charts and all twelve scenery assets', () => {
    // Named categories rather than filenames, because filenames carry a content
    // hash. #406's own table of what a shell-only precache would have missed.
    const has = (fragment: string): boolean => precached.some((entry) => entry.includes(fragment));
    for (const chunk of ['three-renderer', 'maplibre', 'FitnessChart', 'TraceChart']) {
      expect(has(chunk), `${chunk} is not precached`).toBe(true);
    }
    expect(precached.filter((entry) => entry.endsWith('.glb'))).toHaveLength(11);
    expect(has('colormap')).toBe(true);
    expect(precached).toContain('index.html');
    expect(precached).toContain('manifest.webmanifest');
  });

  test('does not hold the worker itself, which could only ever cache a stale worker', () => {
    expect(precached).not.toContain('sw.js');
  });

  test('holds none of the realistic world, which IS in the build — ADR 0026 D-7', () => {
    // Both halves, so neither can pass by the other being empty: the set is
    // really in `dist` (it ships in the APK), and not one file of it reached
    // the cache a real browser filled. The stylised half is the two cases
    // above: every other file in `dist`, and all eleven models by count.
    expect(REALISTIC_IN_DIST.length).toBeGreaterThan(10);
    expect(precached.filter((entry) => entry.startsWith('realistic/'))).toEqual([]);
    for (const file of REALISTIC_IN_DIST) expect(precached).not.toContain(file);
  });

  test('holds none of the side camera’s pose model, which IS in the build — #530', () => {
    // Both halves, as above: the model, its runtime and its worker are really
    // in `dist`, and none of them reached the cache a real browser filled.
    expect(POSE_IN_DIST.some((file) => file.endsWith('.task'))).toBe(true);
    expect(POSE_IN_DIST.some((file) => file.endsWith('.wasm'))).toBe(true);
    expect(POSE_IN_DIST.some((file) => file.startsWith('pose/pose-worker-'))).toBe(true);
    expect(precached.filter((entry) => entry.startsWith('pose/'))).toEqual([]);
  });

  test('leaves the control outside the cache, and outside dist entirely', () => {
    // A control that stopped being outside the precache would stop failing
    // offline, and every other assertion here would be unguarded.
    const name = CONTROL_PATH.replace(/^\//, '');
    expect(distFiles()).not.toContain(name);
    expect(precached).not.toContain(name);
  });

  test('publishes what a first visit downloads because of it', () => {
    // ADR 0024 §Consequences: "a first visit downloads more … a real number on
    // a phone plan and is not yet measured". Printed rather than bounded, the
    // way validation 0002 Part H publishes the model cost — a threshold here
    // would be a number nobody chose.
    let bytes = 0;
    for (const entry of precached) {
      bytes += statSync(join(DIST, ...entry.split('/'))).size;
    }
    // The measurement is the point; `console.log` is how the other specs here
    // publish a figure too.
    console.log(
      `offline: the precache is ${String(precached.length)} files, ` +
        `${(bytes / 1024 / 1024).toFixed(2)} MiB uncompressed`,
    );
    expect(bytes).toBeGreaterThan(0);
  });
});

test.describe('the web app manifest, in the built output', () => {
  test('is served, is linked from the shipped index.html, and names only files that exist', async ({
    page,
  }) => {
    // ⚠️ #405's criteria, asserted against `dist` rather than against the
    // source template — "a manifest that exists in `public/` and is not copied
    // is the wrong-storage cause of §5's defect shape in a new place".
    const document = await page.goto(`${PRODUCT_ORIGIN}/`);
    expect(document?.status()).toBe(200);
    expect(await document?.text()).toContain('rel="manifest"');

    const response = await page.goto(`${PRODUCT_ORIGIN}/manifest.webmanifest`);
    expect(response?.status()).toBe(200);
    const manifest = JSON.parse((await response?.text()) ?? '{}') as {
      start_url: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    for (const icon of manifest.icons) {
      const served = await page.request.get(new URL(icon.src, `${PRODUCT_ORIGIN}/`).toString());
      expect(served.status(), `${icon.src} is named by the manifest and is not in dist`).toBe(200);
      expect(served.headers()['content-type']).toContain('image/png');
    }

    const start = await page.request.get(
      new URL(manifest.start_url, `${PRODUCT_ORIGIN}/`).toString(),
    );
    expect(start.status()).toBe(200);
    expect(await start.text()).toContain('id="root"');
  });
});

test.describe('the harness origin', () => {
  test('has no service worker at all — a cache there would poison every other spec', async ({
    page,
  }) => {
    // ⚠️ `map.browser.spec.ts`'s `pmtiles://` protocol test, its `styleOrigins`
    // host check and its `appType: 'mpa'` 404 test would all start being
    // answered from a cache. Asserted so that a future plugin added to
    // `vite.browser.config.ts` is a red build rather than a silently poisoned
    // gate.
    await page.goto(`${HARNESS_ORIGIN}/`);
    const registrations = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    );
    expect(registrations).toBe(0);
    const worker = await page.request.get(`${HARNESS_ORIGIN}/sw.js`);
    expect(worker.status()).toBe(404);
  });
});

test.describe('a cold start with the network off', () => {
  test('renders the app, and the control proves the network really was off', async () => {
    // The profile is already primed by `beforeAll`: one online visit, worker
    // installed, cache full. This is the rider closing the tab and coming back
    // to a basement.
    const second = await session(profile);
    await second.context.setOffline(true);

    const fromWorker: boolean[] = [];
    second.page.on('response', (response) => {
      if (response.url().startsWith(PRODUCT_ORIGIN)) {
        fromWorker.push(response.fromServiceWorker());
      }
    });

    try {
      const cold = await second.page.goto(`${PRODUCT_ORIGIN}/`);
      expect(cold?.status(), 'the offline cold start did not resolve').toBe(200);

      // The app, not an empty document that "loaded". `#root` is in the HTML
      // whatever happens, so this asserts React actually mounted into it.
      await expect(second.page.locator('h1')).toHaveText(/.+/);
      await expect(second.page.locator('header.oyl-header')).toBeVisible();
      await expect(second.page.locator('nav[aria-label="Primary"] a').first()).toBeVisible();

      // --- Control 1: the network really is off.
      const control = await second.page.evaluate(async (path: string) => {
        try {
          const response = await fetch(path);
          return `succeeded with ${String(response.status)}`;
        } catch (cause) {
          return `failed: ${cause instanceof Error ? cause.message : 'unknown'}`;
        }
      }, CONTROL_PATH);
      expect(
        control,
        'a resource outside the precache SUCCEEDED offline, so the browser was not offline and ' +
          'every other assertion in this file is worthless',
      ).toMatch(/^failed:/);

      // --- Control 2: the worker served it, not Chromium's HTTP cache.
      expect(fromWorker.length).toBeGreaterThan(0);
      expect(
        fromWorker.every(Boolean),
        'an offline response did not come from the service worker, so this may be a disk-cached page',
      ).toBe(true);
    } finally {
      await second.close();
    }
  });

  test('serves the renderer and every scenery model from the cache', async () => {
    // #406's third criterion and #391 finding 4's actual demand: the rider in a
    // basement opened the app, and the *game* is why they opened it.
    const second = await session(profile);
    await second.context.setOffline(true);
    try {
      await second.page.goto(`${PRODUCT_ORIGIN}/`);

      const wanted = precached.filter(
        (entry) => entry.endsWith('.glb') || entry.includes('three-renderer'),
      );
      expect(wanted.length).toBeGreaterThan(11);

      const served = await second.page.evaluate(async (entries: string[]) => {
        const results: { entry: string; status: number | string }[] = [];
        for (const entry of entries) {
          try {
            const response = await fetch(`/${entry}`);
            results.push({ entry, status: response.status });
          } catch (cause) {
            results.push({ entry, status: cause instanceof Error ? cause.message : 'unknown' });
          }
        }
        return results;
      }, wanted);
      for (const result of served) {
        expect(result.status, `${result.entry} was not available offline`).toBe(200);
      }

      // And the renderer chunk is not merely cached bytes: it still imports.
      const renderer = wanted.find((entry) => entry.includes('three-renderer'));
      const imported = await second.page.evaluate(async (entry: string) => {
        try {
          await import(/* @vite-ignore */ `/${entry}`);
          return 'imported';
        } catch (cause) {
          return `failed: ${cause instanceof Error ? cause.message : 'unknown'}`;
        }
      }, renderer ?? '');
      expect(imported).toBe('imported');

      // The game route renders with no network.
      await second.page.goto(`${PRODUCT_ORIGIN}/#/game`);
      await expect(second.page.locator('h1')).toHaveText('Trainer game');
    } finally {
      await second.close();
    }
  });

  test('asks the browser for persistent storage, exactly once — #409', async () => {
    // ⚠️ **This asserts the CALL, not `persisted()`, and that is a measurement
    // rather than a preference.** #409 asks for the round trip to be read back
    // from a fresh context, on the grounds that asserting `persist()`'s own
    // return value in the calling context is the "wrong harness" cause of
    // CLAUDE.md §5's defect shape. In this browser that read **cannot
    // discriminate**, measured on 2026-09-20 against a profile directory and
    // `vite preview`:
    //
    //   session 1, `durableStorage` granted over CDP, before anything asked
    //     → `persisted()` === true
    //   session 1, after `persist()`               → true
    //   session 2, same profile, permission NOT granted
    //                                              → false
    //   session 3, same profile, permission granted, nothing ever asked
    //                                              → true
    //
    // `persisted()` is the permission. With the grant it is true whether or not
    // this client asked; without it, false whether or not this client asked —
    // and a CDP grant does not survive the browser process, so there is no
    // profile state to read back. An assertion over it would be green for a
    // reason that has nothing to do with the code under test, which is the
    // vacuous pass this whole file exists to avoid.
    //
    // What IS decidable in a real browser is whether the shipped bundle calls
    // `persist()` at all, and how many times. That is the wiring claim and the
    // once-per-session claim, observed from **outside** the app's own modules by
    // an init script that runs before any of them. `persistent-storage.test.ts`
    // covers the answers; this covers the asking.
    const fresh = await session(profile);
    try {
      await fresh.context.addInitScript(() => {
        const seen: string[] = [];
        (globalThis as unknown as { __oylPersistCalls: string[] }).__oylPersistCalls = seen;
        const storage = navigator.storage;
        const original = storage.persist.bind(storage);
        storage.persist = async (): Promise<boolean> => {
          seen.push('persist');
          return original();
        };
      });
      await fresh.page.goto(`${PRODUCT_ORIGIN}/`);

      await expect
        .poll(
          async () =>
            fresh.page.evaluate(
              () =>
                (globalThis as unknown as { __oylPersistCalls?: string[] }).__oylPersistCalls
                  ?.length ?? 0,
            ),
          { timeout: 15_000, message: 'the shipped bundle never asked for persistent storage' },
        )
        .toBe(1);

      // And it does not ask again. The documented way to be re-evaluated is to
      // ask again on a LATER visit, never in a loop on this one.
      await fresh.page.waitForTimeout(1_000);
      expect(
        await fresh.page.evaluate(
          () =>
            (globalThis as unknown as { __oylPersistCalls?: string[] }).__oylPersistCalls?.length ??
            0,
        ),
      ).toBe(1);

      // ⚠️ And the request was REFUSED here — no permission was granted — so
      // this is also #409's "a denied request is handled and the app is fully
      // usable afterwards", in the shipped build rather than against a stub.
      expect(await fresh.page.evaluate(async () => navigator.storage.persisted())).toBe(false);
      await fresh.page.goto(`${PRODUCT_ORIGIN}/#/settings`);
      await expect(fresh.page.locator('h1')).toHaveText('Settings');
      await expect(fresh.page.getByRole('heading', { name: 'Storage' })).toBeVisible();
      await expect(fresh.page.locator('main')).toContainText('may remove them automatically');
      await expect(fresh.page.locator('main')).toContainText('Clearing this browser');
    } finally {
      await fresh.close();
    }
  });
});

/**
 * Write a second version of the worker into `dist`, and say where.
 *
 * ⚠️ A second worker script is written into `dist` for a test and removed
 * again. `dist` is gitignored and rebuilt by `test:browser`, and the
 * alternative — a second whole build — costs seconds for no extra claim. It is
 * a copy of the real worker with its cache version changed, so it is a
 * genuinely different worker precaching the same, present, assets.
 *
 * The name carries a random part as well as the content hash: two cases that
 * each write one — or one case run with `--repeat-each` over several workers,
 * which is how #467 was measured — must not remove a script the other is still
 * installing from.
 */
function writeNextWorker(): { readonly name: string; readonly path: string } {
  const source = readFileSync(join(DIST, 'sw.js'), 'utf8');
  const next = source.replace(/oyl-precache-/g, 'oyl-precache-next-');
  expect(next, 'the worker does not name its cache prefix; this test rewrites nothing').not.toBe(
    source,
  );
  const digest = createHash('sha256').update(next).digest('hex').slice(0, 8);
  const name = `sw-next-${digest}-${randomUUID().slice(0, 8)}.js`;
  const path = join(DIST, name);
  writeFileSync(path, next);
  return { name, path };
}

test.describe('a second version arrives', () => {
  test('waits, does not take over, and steps aside only when asked', async () => {
    const { name: nextName, path: nextPath } = writeNextWorker();

    const opened = await session(profile);
    try {
      await opened.page.goto(`${PRODUCT_ORIGIN}/`);
      await waitForPrecache(opened.page, EXPECTED_PRECACHE.length);

      // A marker that does not survive a reload, which is how "the page was not
      // reloaded" is asserted from the page's own point of view rather than
      // from `registration.waiting`.
      await opened.page.evaluate(() => {
        (globalThis as unknown as { __oylAlive?: number }).__oylAlive = Date.now();
      });

      const controllerBefore = await opened.page.evaluate(
        () => navigator.serviceWorker.controller?.scriptURL ?? '',
      );
      expect(controllerBefore).toContain('/sw.js');

      await opened.page.evaluate(async (script: string) => {
        await navigator.serviceWorker.register(`/${script}`);
      }, nextName);

      await expect
        .poll(
          async () =>
            opened.page.evaluate(
              async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null,
            ),
          { timeout: 30_000, message: 'the second worker never reached `waiting`' },
        )
        .toBe(true);

      // ⚠️ **The criterion.** The new worker is installed and waiting; the page
      // is still controlled by the old one and was never reloaded. No
      // `skipWaiting()` ran, so nothing served this page an asset its own
      // bundle does not expect.
      expect(
        await opened.page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''),
      ).toBe(controllerBefore);
      expect(
        await opened.page.evaluate(
          () => (globalThis as unknown as { __oylAlive?: number }).__oylAlive !== undefined,
        ),
        'the page reloaded without anybody asking it to',
      ).toBe(true);

      // ⚠️ #418: and the RIDER is offered it. Since #418 the first render no
      // longer waits for the registration, so the update watcher reaches the
      // tree in a second render once `register()` resolves — and a first
      // render that was never followed by that second one would leave every
      // assertion above green while no rider could ever take an update. The
      // offer on screen is the only thing that says the watcher arrived.
      await expect(opened.page.getByRole('button', { name: 'Update now' })).toBeVisible({
        timeout: 30_000,
      });

      // Now the gesture, which in the app is a click on "Update now".
      await opened.page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        registration?.waiting?.postMessage({ type: 'OYL_SKIP_WAITING' });
      });
      await opened.page.waitForFunction(
        (before: string) => (navigator.serviceWorker.controller?.scriptURL ?? '') !== before,
        controllerBefore,
        { timeout: 30_000 },
      );
      expect(
        await opened.page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''),
      ).toContain(nextName);

      // ⚠️ **#483, in a real browser and on no extra page load.** This page
      // never pressed "Update now" — the line above posted `SKIP_WAITING`
      // straight to the worker, which is precisely what ANOTHER TAB pressing
      // it looks like from here. The spec's Activate made the new worker this
      // page's controller anyway, and the old worker's cache is gone: the page
      // is an old bundle under a new worker. Before #483 it was told `none`
      // and showed nothing at all.
      //
      // Two things make this more than a rendering assertion. (1) The marker
      // planted before the update is still here, so the page was NOT reloaded
      // out from under the rider — ADR 0027 D-2, in the engine rather than in
      // jsdom. (2) "Update now" must be gone: a page offering both would be
      // one that never noticed, and D-4 says the reload is the way out.
      await expect(opened.page.getByRole('button', { name: 'Reload now' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(opened.page.getByRole('button', { name: 'Update now' })).toHaveCount(0);
      expect(
        await opened.page.evaluate(
          () => (globalThis as unknown as { __oylAlive?: number }).__oylAlive !== undefined,
        ),
        'the page reloaded itself after another tab took the update',
      ).toBe(true);
    } finally {
      await opened.page
        .evaluate(async () => {
          for (const registration of await navigator.serviceWorker.getRegistrations()) {
            await registration.unregister();
          }
        })
        .catch(() => undefined);
      await opened.close();
      rmSync(nextPath, { force: true });
    }
  });

  test('is offered even when it began installing before the app was listening — #467', async () => {
    // ⚠️ **The race behind #467's flake, forced rather than waited for.** The
    // update watcher reaches the page in `main.tsx`'s second render, once the
    // app's own `register()` has resolved — measured locally at 20 to 75 ms
    // before the case above registers its second worker, which is a margin a
    // busy runner can eat. When it does, the second worker's `updatefound` has
    // already fired with nobody listening, the worker is still installing when
    // the watcher is made, and a watcher that read only `registration.waiting`
    // never offered it. Here the app's `register()` is held until the second
    // worker's `updatefound` has fired, which is that ordering every time.
    //
    // Its own profile, because the case above unregisters every worker in the
    // shared one and a first visit is part of what this asserts.
    const own = mkdtempSync(join(tmpdir(), 'oyl-offline-late-'));
    const { name: nextName, path: nextPath } = writeNextWorker();
    const opened = await session(own);
    try {
      await opened.page.goto(`${PRODUCT_ORIGIN}/`);
      await waitForPrecache(opened.page, EXPECTED_PRECACHE.length);

      // ⚠️ **And a first visit is not an update.** Chromium reports the first
      // ever worker as `registration.waiting` at the moment it reaches
      // `installed`, with no active worker yet. Before #467 a watcher that
      // happened to be listening by then offered a new rider "Update now" to
      // the version they were already running — one first visit in five,
      // measured. The case above is the control: it requires the offer to
      // appear when there IS an update, so this absence is not an app that
      // renders no offer at all.
      await expect(opened.page.getByRole('button', { name: 'Update now' })).toHaveCount(0);

      await opened.context.addInitScript(() => {
        const container = navigator.serviceWorker;
        const register = container.register.bind(container);
        container.register = async (
          script: string | URL,
          options?: RegistrationOptions,
        ): Promise<ServiceWorkerRegistration> => {
          const pending = register(script, options);
          if (!String(script).endsWith('/sw.js')) {
            return pending;
          }
          // Published for the ordering assertion below: when the app asked.
          (globalThis as unknown as { __oylAppRegisteredAt?: string }).__oylAppRegisteredAt =
            document.readyState;
          // The app's own registration: hand it over only once an update has
          // been found on it, so the watcher is made after `updatefound`.
          return pending.then(
            (registration) =>
              new Promise((resolve) => {
                registration.addEventListener(
                  'updatefound',
                  () => {
                    resolve(registration);
                  },
                  { once: true },
                );
              }),
          );
        };
      });
      await opened.page.reload();
      // ⚠️ **The ordering this case stands on, asserted rather than assumed** —
      // #472's review. The hold above only forces the race if the app's own
      // `register('/sw.js')` is already in flight, with its `updatefound`
      // listener attached, before the next line registers the second worker.
      // That is true because `main.tsx` registers during module evaluation,
      // before `load`, and `reload()` waits for `load`. ADR 0024's 2026-09-21
      // amendment measured deferring registration to `window.load`; were that
      // adopted, the app's call would land AFTER the second worker's, start an
      // update job of its own back to `sw.js`, and this case would time out
      // with no reason given or pass for a different one. So it fails here,
      // naming the dependency, instead.
      expect(
        await opened.page.evaluate(
          () => (globalThis as unknown as { __oylAppRegisteredAt?: string }).__oylAppRegisteredAt,
        ),
        'the app must call register("/sw.js") before `load` for this case to force #467’s race',
      ).toMatch(/^(loading|interactive)$/);
      await opened.page.evaluate(async (script: string) => {
        await navigator.serviceWorker.register(`/${script}`);
      }, nextName);

      await expect(opened.page.getByRole('button', { name: 'Update now' })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await opened.close();
      rmSync(nextPath, { force: true });
      rmSync(own, { recursive: true, force: true });
    }
  });
});
