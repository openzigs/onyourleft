// SPDX-License-Identifier: AGPL-3.0-or-later

/**
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
 * ## What it does NOT prove
 *
 * - **GPU cost on a phone.** This is SwiftShader on a CI runner: it proves the
 *   demo draws frames, not how hot or how smooth it is on a visitor's device.
 * - **That a real baked route bundle is correct.** Until #1652 lands the demo
 *   rides the synthetic road; after it, this gate builds with a bundle baked
 *   from `corridor-fixture.ts` (no OSM data in a gate artefact), so a bundle
 *   baked from a real GPX is not what is measured here.
 * - **"After a full preset"** is the gate's lifecycle of a preset — load, play
 *   for at least five seconds, and (for the climb) pause, play and stop — not
 *   the preset's whole scripted length, which is up to fifteen minutes.
 * - **The HUD's power reading.** The demo has no HUD until #1650; the
 *   assertion that its power reading changes belongs with it.
 */

import { fileURLToPath } from 'node:url';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { DEMO_ORIGIN } from '../playwright.config';
import { filesUnder } from '../tools/demo/demo-output';

const DIST = fileURLToPath(new URL('../demo/dist', import.meta.url));
const PRESETS = ['climb', 'sprint', 'group'] as const;
const POLICY = /<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>/;
/**
 * How long a case may wait for frames. The demo starts the realistic world's
 * load at once (`stage.ts`), and on SwiftShader beside two other workers that
 * load holds the CPU: `demo-world.browser.spec.ts` gives the same load 150 s.
 */
const FRAMES_BUDGET_MS = 90_000;

interface Snapshot {
  readonly state: string;
  readonly world: string;
  readonly framesDrawn: number;
  readonly distance: number;
}

interface Gate {
  /** Every Bluetooth call the page made. */
  readonly calls: string[];
  /** Every `__oylDemo` snapshot, in order. */
  readonly snapshots: Snapshot[];
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
  const gate = { calls: [] as string[], snapshots: [] as unknown[] };
  Object.defineProperty(window, '__oylGate', { value: gate });
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
  let last: unknown;
  Object.defineProperty(window, '__oylDemo', {
    configurable: true,
    get: () => last,
    set: (snapshot: Snapshot) => {
      last = snapshot;
      gate.snapshots.push({
        state: snapshot.state,
        world: snapshot.world,
        framesDrawn: snapshot.framesDrawn,
        distance: snapshot.distance,
      });
    },
  });
}

/**
 * Record every request `context` makes, and install the recorders.
 * `rewrite`, if given, changes the page's HTML on its way in — a control's.
 */
async function watch(
  context: BrowserContext,
  page: Page,
  rewrite?: (html: string) => string,
): Promise<Watched> {
  const files = new Set(filesUnder(DIST));
  const watched: Watched = { requests: [], foreign: [], missing: [] };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    watched.requests.push(url.href);
    if (url.origin !== DEMO_ORIGIN) {
      watched.foreign.push(url.href);
      return route.abort();
    }
    const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!files.has(path)) watched.missing.push(url.pathname);
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
    return { calls: [...recorded.calls], snapshots: [...recorded.snapshots] };
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

/** How many distinct colours the canvas's drawing buffer holds, read inside a frame. */
function coloursInAFrame(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        // A frame callback queued now runs after the demo's own in the next
        // frame, before the buffer is presented and cleared
        // (`preserveDrawingBuffer` is false), so it reads what was drawn.
        requestAnimationFrame(() => {
          const canvas = document.querySelector('canvas');
          const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
          if (canvas === null || canvas === undefined || gl === null || gl === undefined) {
            resolve(0);
            return;
          }
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
          resolve(seen.size);
        });
      }),
  );
}

async function open(page: Page, preset: string): Promise<void> {
  await page.goto(`${DEMO_ORIGIN}/?preset=${preset}`);
  await expect.poll(() => last(page), { timeout: FRAMES_BUDGET_MS }).toBeDefined();
}

/** Ride `preset` for at least five seconds, and hold that it played. */
async function ridesFiveSeconds(page: Page, preset: string): Promise<void> {
  await open(page, preset);
  await page.waitForTimeout(5_000);
  await expect.poll(async () => (await last(page))?.distance).toBeGreaterThan(0);
  await expect
    .poll(async () => (await last(page))?.framesDrawn, { timeout: FRAMES_BUDGET_MS })
    .toBeGreaterThanOrEqual(60);
  await expect.poll(() => coloursInAFrame(page), { timeout: FRAMES_BUDGET_MS }).toBeGreaterThan(1);
  const snapshots = (await gate(page)).snapshots;
  expect(snapshots.every((each) => each.state === 'playing')).toBe(true);
  expect(snapshots.at(-1)?.distance ?? 0).toBeGreaterThan(0);
}

test.describe('the demo, built and served — #1648', () => {
  for (const preset of PRESETS) {
    test(`${preset}: plays, and asks nothing of the network, Bluetooth or storage`, async ({
      context,
      page,
    }) => {
      test.setTimeout(3 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page);
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
    });
  }

  test.describe('under reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('starts paused, with a Play button, and rides nothing until it is pressed', async ({
      context,
      page,
    }) => {
      test.setTimeout(2 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page);
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
      test.setTimeout(2 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page, (html) => {
        const without = html.replace(POLICY, '');
        expect(without).not.toBe(html);
        return without;
      });
      await open(page, 'climb');
      expect(await findings(context, page, watched)).toEqual([]);
      await page.evaluate(() => fetch('https://example.org/').catch(() => undefined));
      expect(await findings(context, page, watched)).toContain(
        'request to another origin: https://example.org/',
      );
    });

    test('a fetch to a path the build does not have is found', async ({ context, page }) => {
      test.setTimeout(2 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page);
      await open(page, 'climb');
      await page.evaluate(() => fetch('/not-in-the-build.js').catch(() => undefined));
      expect(await findings(context, page, watched)).toContain(
        'request for a path not in demo/dist: /not-in-the-build.js',
      );
    });

    test('a requestDevice and a writeValue are found', async ({ context, page }) => {
      test.setTimeout(2 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page);
      await open(page, 'climb');
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
      test.setTimeout(2 * FRAMES_BUDGET_MS);
      const watched = await watch(context, page);
      await open(page, 'climb');
      await page.evaluate(() => localStorage.setItem('oyl-demo-gate-control', '1'));
      expect(await findings(context, page, watched)).toEqual(['stored localStorage: 1']);
    });
  });
});
