// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * (Named `shell-demo` since #1648's review, when `--shard` cut by file name
 * and this name put the file in the half with the room. Since #1720 each
 * shard names its files, and this one is named in `test:browser:shard-3`, the
 * shard with the most room — `nightly-split.test.ts` holds it.)
 *
 * The demo's browser gate — #1648: the built demo, served from `demo/dist` by
 * the config's third server, plays, asks nothing of the network beyond its own
 * files, makes no Bluetooth call, sends no trainer command, and stores nothing
 * about the visitor.
 *
 * ## How each claim is observed
 *
 * - **Requests.** `context.route('**\/*')` sees every request the page and its
 *   workers make, and records each one to an origin other than
 *   {@link DEMO_ORIGIN} (aborted) and each one to a path `demo/dist` has no file
 *   for (`vite preview` would answer it with `index.html`, so the server's
 *   status says nothing). A WebSocket is recorded as foreign whatever its URL.
 * - **Bluetooth.** An init script replaces `navigator.bluetooth` with a
 *   recorder whose every method records the call and throws, and replaces
 *   `BluetoothRemoteGATTCharacteristic`'s three writes the same way (with a
 *   stand-in interface where this Chromium exposes none). The build-time
 *   forbidden-module check (`tools/demo/forbidden-modules.ts`, #1645) is the
 *   primary guarantee that no trainer command can be sent; this is the
 *   observed one.
 * - **Storage.** IndexedDB's databases, both Web Storage areas, the page's
 *   cookies and the context's, service-worker registrations and Cache Storage,
 *   each read and each asserted empty. The demo's origin is not in
 *   `FOLLOW_THE_DEVICE`, so it starts empty.
 * - **Playing.** Every `window.__oylDemo` snapshot is recorded by a setter
 *   installed before the page's own script, not only the last: on SwiftShader
 *   the quality ladder can step a ride out of the realistic world (#1683), and
 *   a reading of the last snapshot alone would miss what came before.
 * - **The frame.** The same setter reads the canvas back with `readPixels`
 *   when asked. `stage.ts` publishes right after `view.render`, in the same
 *   task, so the read sees the frame just drawn: the drawing buffer is not
 *   preserved, and a read from anywhere else sees whatever the compositor left,
 *   which on a frame the pacer did not draw is a cleared buffer (#1648's first
 *   CI run, where a poll from outside the frame never saw the group ride).
 *
 * ## Each recorder has its control
 *
 * A recorder that saw nothing would pass every assertion here, so each one is
 * shown to see: a fetch to another origin (on the page with its policy taken
 * out, because the policy refuses it before it reaches any network), a fetch
 * to a path the build does not have, a `requestDevice` and a `writeValue`,
 * and one `localStorage` key — each makes {@link findings} non-empty, which is
 * what fails the preset cases. And every preset case asserts the request
 * recorder saw the page and its script.
 *
 * ⚠️ **A control's page is the demo's own `index.html` with its module script
 * taken out**, under the same recorders: what a control proves is that the
 * recorder sees, and the demo's code adds nothing to that but a realistic-world
 * load, which on SwiftShader holds a CPU for a minute and is paid by the
 * preset cases already.
 *
 * ## One realistic load
 *
 * The demo starts loading the realistic world at once, and on SwiftShader that
 * load holds a CPU for most of a minute: three of them in the `browser-1`
 * shard took it past its 720 s stop with 20 cases not run (#1648's second CI
 * run). So the **climb** rides over the real load, and is the case that
 * audits the realistic world's code for requests, Bluetooth and storage; the
 * sprint, the group and the reduced-motion case are each answered 404 for
 * the realistic files, so they ride the stylised world the demo falls back to
 * (ADR 0026 D-7) and each is audited over that. That the realistic world
 * DRAWS in the demo, under its policy, is `demo-world.browser.spec.ts`'s.
 *
 * ## What it does NOT prove
 *
 * - **GPU cost on a phone.** This is SwiftShader on a CI runner: it proves the
 *   demo draws frames, not how hot or how smooth it is on a visitor's device.
 * - **That a real baked route bundle is correct.** Since #1652 the baked
 *   case rides a bundle `demo:bake`'s own code bakes from `corridor-fixture.ts`
 *   (`demo-route-fixture.ts`; no OSM data in a gate artefact, ADR 0056 D-9),
 *   served beside the build as `routes/` is, so a bundle baked from a real
 *   GPX is not what is measured here. Its counts are checked against
 *   `corridor-fixture.ts` §`expectedCorridorCounts`, decoded in Node.
 * - **"After a full preset"** is the gate's lifecycle of a preset — load, play
 *   for at least five seconds, and (for the climb) pause, play and stop — not
 *   the preset's whole scripted length, which is up to fifteen minutes.
 * - **The HUD's power reading.** The demo has no HUD until #1650; the
 *   assertion that its power reading changes belongs with it.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { DEMO_ORIGIN } from '../playwright.config';
import { OSM_ATTRIBUTION } from '../src/map/basemap';
import { filesUnder } from '../tools/demo/demo-output';
import { bakeFixtureRouteInto, expectedRouteCounts, routeFilesIn } from './demo-route-fixture';

const DIST = fileURLToPath(new URL('../demo/dist', import.meta.url));
/** Where the fixture route is baked for the #1652 case: ignored and pruned, as every `dist/` is. */
const FIXTURE_ROUTES = fileURLToPath(new URL('./dist/demo-routes', import.meta.url));
const PRESETS = ['climb', 'sprint', 'group'] as const;
const POLICY = /<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>/;
/**
 * How long a case may wait for frames. The demo starts the realistic world's
 * load at once (`stage.ts`), and on SwiftShader beside two other workers that
 * load holds the CPU: `demo-world.browser.spec.ts` gives the same load 150 s.
 */
const FRAMES_BUDGET_MS = 90_000;
/**
 * A small window. SwiftShader fills pixels on the CPU, so a frame's cost goes
 * with the canvas's area, and nothing this gate claims depends on the size:
 * at Playwright's 1280 × 720 the demo drew 60 frames in 20 to 40 s on a busy
 * machine, beside two other workers.
 */
const VIEWPORT = { width: 480, height: 360 };

interface Snapshot {
  readonly state: string;
  readonly world: string;
  readonly framesDrawn: number;
  readonly distance: number;
  /** #1652: the baked route's corridor counts, or `undefined` on the synthetic road. */
  readonly mapData?: { readonly route: string; readonly counts: Record<string, number> };
  readonly mappedBuildings?: number;
  /** #1653: the showcase cues skipped, and the showcase as it stands. */
  readonly skipped?: readonly string[];
  readonly showcase?: {
    readonly seconds: number;
    readonly caption?: string;
    readonly holiday: string;
  };
}

interface Gate {
  /** Every Bluetooth call the page made. */
  readonly calls: string[];
  /** Every `__oylDemo` snapshot, in order. */
  readonly snapshots: Snapshot[];
  /** The most distinct colours one drawn frame has held since {@link probeFrames}. */
  readonly colours: number;
  /** Every `securitypolicyviolation` the page raised: what the policy refused, by blocked URI. */
  readonly violations: string[];
}

interface Watched {
  /** Every request seen, as a URL. */
  readonly requests: string[];
  /** Every request to another origin, and every WebSocket. */
  readonly foreign: string[];
  /** Every request to the demo's origin for a path `demo/dist` has no file for. */
  readonly missing: string[];
}

/** What the page has stored, read through the browser's own APIs. */
interface Stored {
  readonly indexedDB: string[];
  readonly localStorage: number;
  readonly sessionStorage: number;
  readonly cookie: string;
  readonly contextCookies: number;
  readonly serviceWorkers: number;
  readonly caches: string[];
}

/** The init script: the Bluetooth recorder and the snapshot recorder. Runs before the page's script. */
function installRecorders(): void {
  const gate = {
    calls: [] as string[],
    snapshots: [] as Snapshot[],
    colours: 0,
    probe: false,
    violations: [] as string[],
  };
  Object.defineProperty(window, '__oylGate', { value: gate });
  // The demo's policy refuses a foreign fetch before `context.route` sees it,
  // so the request recorder cannot tell an attempt from nothing: the policy's
  // own report can.
  document.addEventListener('securitypolicyviolation', (event) => {
    gate.violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
  });
  const refuse = (name: string): never => {
    gate.calls.push(name);
    throw new Error(`The demo's browser gate refuses ${name}`);
  };
  const bluetooth = new Proxy(
    {},
    {
      get: (_target, name) =>
        typeof name === 'symbol' ? undefined : () => refuse(`bluetooth.${name}`),
    },
  );
  Object.defineProperty(Navigator.prototype, 'bluetooth', {
    configurable: true,
    get: () => bluetooth,
  });
  const scope = window as unknown as Record<string, { prototype: object } | undefined>;
  const characteristic = scope['BluetoothRemoteGATTCharacteristic'] ?? { prototype: {} };
  scope['BluetoothRemoteGATTCharacteristic'] = characteristic;
  for (const name of ['writeValue', 'writeValueWithResponse', 'writeValueWithoutResponse']) {
    Object.defineProperty(characteristic.prototype, name, {
      configurable: true,
      value: () => refuse(`characteristic.${name}`),
    });
  }
  /** How many distinct colours the canvas's drawing buffer holds now. */
  const colours = (): number => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (canvas === null || canvas === undefined || gl === null || gl === undefined) return 0;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const seen = new Set<number>();
    for (let at = 0; at < pixels.length; at += 4 * 97) {
      seen.add(
        (pixels[at] ?? 0) * 0x1000000 +
          (pixels[at + 1] ?? 0) * 0x10000 +
          (pixels[at + 2] ?? 0) * 0x100 +
          (pixels[at + 3] ?? 0),
      );
    }
    return seen.size;
  };
  let last: Snapshot | undefined;
  Object.defineProperty(window, '__oylDemo', {
    configurable: true,
    get: () => last,
    set: (snapshot: Snapshot) => {
      // A frame was drawn just now, in this task, when the count moved.
      const drawn = snapshot.framesDrawn > (last?.framesDrawn ?? 0);
      last = snapshot;
      if (gate.probe && drawn) {
        gate.colours = Math.max(gate.colours, colours());
        if (gate.colours > 1) gate.probe = false;
      }
      gate.snapshots.push({
        state: snapshot.state,
        world: snapshot.world,
        framesDrawn: snapshot.framesDrawn,
        distance: snapshot.distance,
        ...(snapshot.mapData === undefined ? {} : { mapData: snapshot.mapData }),
        ...(snapshot.mappedBuildings === undefined
          ? {}
          : { mappedBuildings: snapshot.mappedBuildings }),
        ...(snapshot.skipped === undefined ? {} : { skipped: snapshot.skipped }),
        ...(snapshot.showcase === undefined ? {} : { showcase: snapshot.showcase }),
      });
    },
  });
}

interface WatchOptions {
  /** Changes the page's HTML on its way in — a control's. */
  readonly rewrite?: (html: string) => string;
  /**
   * Whether the realistic world's files are served. When `false` each is
   * answered 404 (and still recorded), so the demo draws the stylised world
   * and says why — see the header's §"One realistic load".
   */
  readonly realistic: boolean;
  /**
   * #1652: files served under `routes/` as if `demo:bake` had written them
   * into `demo/dist`, by path relative to the page (`./routes/<name>`).
   */
  readonly routes?: ReadonlyMap<string, Uint8Array>;
}

/** Record every request `context` makes, and install the recorders. */
async function watch(
  context: BrowserContext,
  page: Page,
  { rewrite, realistic, routes }: WatchOptions,
): Promise<Watched> {
  const files = new Set(filesUnder(DIST));
  for (const path of routes?.keys() ?? []) files.add(path.replace(/^\.\//, ''));
  const watched: Watched = { requests: [], foreign: [], missing: [] };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    watched.requests.push(url.href);
    if (url.origin !== DEMO_ORIGIN) {
      watched.foreign.push(url.href);
      return route.abort();
    }
    // A malformed escape (`/%E0`) is a path the build does not have, not a handler error.
    let path = url.pathname.slice(1);
    try {
      path = decodeURIComponent(path);
    } catch {
      path = `${path} (malformed escape)`;
    }
    if (url.pathname === '/') path = 'index.html';
    if (!files.has(path)) watched.missing.push(url.pathname);
    if (!realistic && path.startsWith('realistic/')) {
      return route.fulfill({ status: 404, body: '' });
    }
    const baked = routes?.get(`./${path}`);
    if (baked !== undefined) {
      return route.fulfill({
        status: 200,
        contentType: path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        body: Buffer.from(baked),
      });
    }
    if (rewrite !== undefined && path === 'index.html') {
      const response = await route.fetch();
      return route.fulfill({ response, body: rewrite(await response.text()) });
    }
    return route.continue();
  });
  page.on('websocket', (socket) => watched.foreign.push(socket.url()));
  await context.addInitScript(installRecorders);
  return watched;
}

function gate(page: Page): Promise<Gate> {
  return page.evaluate(() => {
    const recorded = (window as unknown as { __oylGate: Gate }).__oylGate;
    return {
      calls: [...recorded.calls],
      snapshots: [...recorded.snapshots],
      colours: recorded.colours,
      violations: [...recorded.violations],
    };
  });
}

async function last(page: Page): Promise<Snapshot | undefined> {
  return (await gate(page)).snapshots.at(-1);
}

async function stored(context: BrowserContext, page: Page): Promise<Stored> {
  const inPage = await page.evaluate(async () => ({
    indexedDB: (await indexedDB.databases()).map((each) => String(each.name)),
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    cookie: document.cookie,
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await caches.keys(),
  }));
  return { ...inPage, contextCookies: (await context.cookies()).length };
}

const NOTHING_STORED: Stored = {
  indexedDB: [],
  localStorage: 0,
  sessionStorage: 0,
  cookie: '',
  contextCookies: 0,
  serviceWorkers: 0,
  caches: [],
};

/**
 * Everything the gate refuses, read from the recorders: empty is a pass. The
 * preset cases assert it empty and the controls assert it is not, so the
 * controls exercise exactly the check the preset cases make.
 */
async function findings(context: BrowserContext, page: Page, watched: Watched): Promise<string[]> {
  const found = [
    ...watched.foreign.map((url) => `request to another origin: ${url}`),
    ...watched.missing.map((path) => `request for a path not in demo/dist: ${path}`),
    ...(await gate(page)).calls.map((call) => `Bluetooth call: ${call}`),
    ...(await gate(page)).violations.map((each) => `policy refused: ${each}`),
  ];
  const now = await stored(context, page);
  for (const [key, value] of Object.entries(now)) {
    const expected = NOTHING_STORED[key as keyof Stored];
    if (JSON.stringify(value) !== JSON.stringify(expected)) {
      found.push(`stored ${key}: ${JSON.stringify(value)}`);
    }
  }
  return found;
}

/** Ask the snapshot setter to read back each frame drawn from now until one holds two colours. */
function probeFrames(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __oylGate: { probe: boolean } }).__oylGate.probe = true;
  });
}

/** The demo's own page with its module script taken out: a control's page, which runs no demo. */
function withoutTheDemo(html: string): string {
  const without = html.replace(/<script type="module"[^>]*><\/script>/, '');
  expect(without).not.toBe(html);
  return without;
}

/** Load a control's page, which publishes no snapshot. */
async function openControl(page: Page): Promise<void> {
  await page.goto(`${DEMO_ORIGIN}/?preset=climb`);
  expect(await page.evaluate(() => typeof window.__oylDemo)).toBe('undefined');
}

async function open(page: Page, preset: string, query = ''): Promise<void> {
  await page.goto(`${DEMO_ORIGIN}/?preset=${preset}${query}`);
  await expect.poll(() => last(page), { timeout: FRAMES_BUDGET_MS }).toBeDefined();
}

/** Ride `preset` for at least five seconds, and hold that it played. */
async function ridesFiveSeconds(page: Page, preset: string, query = ''): Promise<void> {
  const started = performance.now();
  // Printed, never asserted (a timing assertion on a shared runner is a
  // flake): how long each phase took, for the budget arithmetic.
  const phase = (name: string): void =>
    console.info(
      `demo ${preset}: ${name} at ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
  await open(page, preset, query);
  phase('first snapshot');
  await page.waitForTimeout(5_000);
  await expect
    .poll(async () => (await last(page))?.distance, { timeout: FRAMES_BUDGET_MS })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await last(page))?.framesDrawn, { timeout: FRAMES_BUDGET_MS })
    .toBeGreaterThanOrEqual(60);
  phase('60 frames');
  await probeFrames(page);
  await expect
    .poll(async () => (await gate(page)).colours, { timeout: FRAMES_BUDGET_MS })
    .toBeGreaterThan(1);
  phase('a frame read back');
  const snapshots = (await gate(page)).snapshots;
  expect(snapshots.every((each) => each.state === 'playing')).toBe(true);
  expect(snapshots.at(-1)?.distance ?? 0).toBeGreaterThan(0);
}

test.describe('the demo, built and served — #1648', () => {
  test.use({ viewport: VIEWPORT });

  for (const preset of PRESETS) {
    test(`${preset}: plays, and asks nothing of the network, Bluetooth or storage`, async ({
      context,
      page,
    }) => {
      test.setTimeout(3 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page, { realistic: preset === 'climb' });
      await ridesFiveSeconds(page, preset);
      if (preset === 'climb') {
        // Pause holds the distance.
        await page.getByRole('button', { name: 'Pause' }).click();
        await expect.poll(async () => (await last(page))?.state).toBe('paused');
        const held = (await last(page))?.distance;
        await page.waitForTimeout(2_000);
        expect((await last(page))?.distance).toBe(held);
        expect((await last(page))?.state).toBe('paused');
        await page.getByRole('button', { name: 'Play' }).click();
        await expect
          .poll(async () => (await last(page))?.distance, { timeout: FRAMES_BUDGET_MS })
          .toBeGreaterThan(held ?? 0);
        // Stop ends on a still frame, with a Play button. One more frame may
        // be drawn while stopped — the realistic world arriving redraws the
        // still frame — but no more.
        await page.getByRole('button', { name: 'Stop' }).click();
        await expect.poll(async () => (await last(page))?.state).toBe('stopped');
        await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
        await page.waitForTimeout(500);
        const still = await last(page);
        await page.waitForTimeout(2_000);
        const after = await last(page);
        expect(after?.state).toBe('stopped');
        expect(after?.distance).toBe(still?.distance);
        expect((after?.framesDrawn ?? 0) - (still?.framesDrawn ?? 0)).toBeLessThanOrEqual(1);
      }
      // Nothing is owed on the synthetic road (#1652 adds the baked case).
      await expect(page.getByText(/OpenStreetMap/)).toHaveCount(0);
      expect(await findings(context, page, watched)).toEqual([]);
      // The recorder saw the page and its script: a recorder that saw nothing
      // would pass the line above.
      expect(watched.requests).toContain(`${DEMO_ORIGIN}/?preset=${preset}`);
      expect(watched.requests.some((url) => /\/assets\/[^/]+\.js$/.test(url))).toBe(true);
      // The climb is the one ride audited over the realistic world's load.
      if (preset === 'climb') {
        expect(watched.requests.some((url) => url.includes('/realistic/'))).toBe(true);
      }
    });
  }

  test.describe('on a baked route — #1652', () => {
    /** The corners layout (`theme.css`, 46 rem and up, taller than 30 rem): the credit in its corner. */
    test.use({ viewport: { width: 800, height: 600 } });
    let routes: Map<string, Uint8Array<ArrayBuffer>>;
    let bundle = '';

    test.beforeAll(async () => {
      rmSync(FIXTURE_ROUTES, { recursive: true, force: true });
      mkdirSync(FIXTURE_ROUTES, { recursive: true });
      bundle = `routes/${(await bakeFixtureRouteInto(FIXTURE_ROUTES)).file}`;
      routes = routeFilesIn(FIXTURE_ROUTES);
    });

    test('draws the fixture bundle’s map data from memory, credits it, and stores nothing', async ({
      context,
      page,
    }) => {
      test.setTimeout(3 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page, { realistic: false, routes });
      await ridesFiveSeconds(page, 'climb', '&route=fixture');
      const now = await last(page);
      expect(now?.mapData).toEqual({ route: 'fixture', counts: expectedRouteCounts() });
      expect(now?.mappedBuildings ?? 0).toBeGreaterThan(0);
      // Every snapshot of the run carries it: the credit is owed for the whole run.
      const snapshots = (await gate(page)).snapshots;
      expect(snapshots.every((each) => each.mapData?.route === 'fixture')).toBe(true);
      // Read from the demo's own files, through the page's loader, and nowhere else.
      expect(watched.requests).toContain(`${DEMO_ORIGIN}/routes/routes.json`);
      expect(watched.requests).toContain(`${DEMO_ORIGIN}/${bundle}`);

      // The credit: the constant, in the HUD's region, inside the viewport, and under no panel.
      const credit = page
        .getByRole('region', { name: 'Ride metrics' })
        .getByText(OSM_ATTRIBUTION, { exact: true });
      await expect(credit).toBeVisible();
      const placed = await credit.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const overlaps = (other: DOMRect): boolean =>
          other.width > 0 &&
          other.height > 0 &&
          other.left < box.right &&
          box.left < other.right &&
          other.top < box.bottom &&
          box.top < other.bottom;
        const covering = [...document.querySelectorAll('.oyl-hud__panel')]
          .filter((panel) => overlaps(panel.getBoundingClientRect()))
          .map((panel) => panel.className);
        // Its two ends and its middle, half way down: in from the ends by the
        // backing's rounded corners, which a hit test does not count as it.
        const middle = (box.top + box.bottom) / 2;
        const points = [box.left + 8, (box.left + box.right) / 2, box.right - 8].map(
          (x) => [x, middle] as const,
        );
        return {
          inside:
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= window.innerWidth &&
            box.bottom <= window.innerHeight &&
            box.width > 0,
          covering,
          onTop: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))),
        };
      });
      expect(placed).toEqual({ inside: true, covering: [], onTop: true });

      // The ODbL notice, opened from the keyboard, offers the file itself.
      const summary = page.locator('summary', { hasText: 'Map data' });
      await summary.focus();
      await page.keyboard.press('Enter');
      const offer = page.getByRole('link', { name: 'This route’s map data' });
      await expect(offer).toBeVisible();
      expect(await offer.getAttribute('href')).toBe(`./${bundle}`);
      await expect(page.getByText(/Contains information from OpenStreetMap/)).toBeVisible();

      expect(await findings(context, page, watched)).toEqual([]);
    });

    test('control: a truncated bundle rides the synthetic road, says so, and credits nothing', async ({
      context,
      page,
    }) => {
      test.setTimeout(3 * FRAMES_BUDGET_MS);
      const whole = routes.get(`./${bundle}`);
      if (whole === undefined) throw new Error('no fixture bundle');
      const truncated = new Map(routes);
      truncated.set(`./${bundle}`, whole.slice(0, whole.length >> 1));
      const watched = await watch(context, page, { realistic: false, routes: truncated });
      await ridesFiveSeconds(page, 'climb', '&route=fixture');
      expect((await last(page))?.mapData).toBeUndefined();
      await expect(
        page.getByRole('status').filter({ hasText: 'Towns from map data' }),
      ).toContainText('Towns from map data: not available for this route');
      await expect(page.getByText(/OpenStreetMap/)).toHaveCount(0);
      expect(await findings(context, page, watched)).toEqual([]);
    });
  });

  test.describe('the showcase — #1653', () => {
    test('captions its moments, tells the real view the season, skips what it cannot draw, and asks nothing', async ({
      context,
      page,
    }) => {
      test.setTimeout(3 * FRAMES_BUDGET_MS);
      // The realistic world answered 404: its moment is skipped, visibly.
      const watched = await watch(context, page, { realistic: false });
      await open(page, 'group', '&showcase');
      const caption = page.locator('.oyl-demo__caption');
      await expect(caption).toHaveAttribute('role', 'status');
      await expect(caption).toHaveText('The stylised world', { timeout: FRAMES_BUDGET_MS });
      // Past the season's first moment: the season the VIEW holds, read back
      // through `three-renderer.ts` §`seasonOf`, is Halloween's.
      await expect
        .poll(async () => (await last(page))?.showcase?.seconds ?? 0, {
          timeout: FRAMES_BUDGET_MS,
        })
        .toBeGreaterThan(35);
      const now = await last(page);
      expect(now?.showcase?.holiday).toBe('halloween');
      expect(now?.world).toBe('stylised');
      expect(now?.skipped).toEqual(
        expect.arrayContaining(['world realistic at 7', 'caption at 7.5']),
      );
      const captions = new Set(
        (await gate(page)).snapshots.flatMap((each) => each.showcase?.caption ?? []),
      );
      expect(captions).not.toContain('And the realistic world');
      expect(captions).toContain('The season from the date: Halloween');
      expect(await findings(context, page, watched)).toEqual([]);
    });
  });

  test.describe('under reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('starts paused, with a Play button, and rides nothing until it is pressed', async ({
      context,
      page,
    }) => {
      test.setTimeout(2 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page, { realistic: false });
      await open(page, 'climb');
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
      await page.waitForTimeout(2_000);
      const snapshots = (await gate(page)).snapshots;
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots.every((each) => each.state === 'paused' && each.distance === 0)).toBe(true);
      expect(await findings(context, page, watched)).toEqual([]);
    });
  });

  test.describe('controls: each recorder sees what it is there to see', () => {
    test('a fetch to another origin, on the page without its policy, is found', async ({
      context,
      page,
    }) => {
      const watched = await watch(context, page, {
        realistic: false,
        rewrite: (html) => {
          const without = withoutTheDemo(html).replace(POLICY, '');
          expect(without).not.toContain('Content-Security-Policy');
          return without;
        },
      });
      await openControl(page);
      expect(await findings(context, page, watched)).toEqual([]);
      await page.evaluate(() => fetch('https://example.org/').catch(() => undefined));
      expect(await findings(context, page, watched)).toContain(
        'request to another origin: https://example.org/',
      );
    });

    test('a fetch the policy refuses is found, though no request reaches the network', async ({
      context,
      page,
    }) => {
      const watched = await watch(context, page, { realistic: false, rewrite: withoutTheDemo });
      await openControl(page);
      await page.evaluate(() => fetch('https://example.org/telemetry').catch(() => undefined));
      expect(watched.foreign).toEqual([]);
      expect(await findings(context, page, watched)).toEqual([
        'policy refused: connect-src: https://example.org/telemetry',
      ]);
    });

    test('a fetch to a path the build does not have is found', async ({ context, page }) => {
      const watched = await watch(context, page, { realistic: false, rewrite: withoutTheDemo });
      await openControl(page);
      await page.evaluate(() => fetch('/not-in-the-build.js').catch(() => undefined));
      expect(await findings(context, page, watched)).toContain(
        'request for a path not in demo/dist: /not-in-the-build.js',
      );
    });

    test('a requestDevice and a writeValue are found', async ({ context, page }) => {
      const watched = await watch(context, page, { realistic: false, rewrite: withoutTheDemo });
      await openControl(page);
      const refused = await page.evaluate(() => {
        const outcomes: string[] = [];
        const scope = window as unknown as {
          BluetoothRemoteGATTCharacteristic: {
            prototype: { writeValue: (value: BufferSource) => unknown };
          };
        };
        const attempts = [
          () =>
            (
              navigator as unknown as { bluetooth: { requestDevice: (o: object) => unknown } }
            ).bluetooth.requestDevice({ acceptAllDevices: true }),
          () =>
            scope.BluetoothRemoteGATTCharacteristic.prototype.writeValue.call(
              {},
              new Uint8Array([0]),
            ),
        ];
        for (const attempt of attempts) {
          try {
            attempt();
            outcomes.push('allowed');
          } catch {
            outcomes.push('refused');
          }
        }
        return outcomes;
      });
      expect(refused).toEqual(['refused', 'refused']);
      expect(await findings(context, page, watched)).toEqual([
        'Bluetooth call: bluetooth.requestDevice',
        'Bluetooth call: characteristic.writeValue',
      ]);
    });

    test('one localStorage key is found', async ({ context, page }) => {
      const watched = await watch(context, page, { realistic: false, rewrite: withoutTheDemo });
      await openControl(page);
      await page.evaluate(() => localStorage.setItem('oyl-demo-gate-control', '1'));
      expect(await findings(context, page, watched)).toEqual(['stored localStorage: 1']);
    });
  });
});
