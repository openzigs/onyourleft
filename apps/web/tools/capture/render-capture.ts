// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Render the REAL app to video, frame by frame — #3152, epic #3151.
 *
 * ## How
 *
 * The built app (`apps/web/dist`, `vite build`) is opened in the pinned
 * Chromium at an origin of its own, every file answered from disk by
 * `context.route` and every other request refused, as the demo's render
 * answers the demo (`tools/demo/render-video.ts`). Before the app's first
 * script runs, `capture-clock.ts` replaces the page's clocks. The capture then:
 *
 * 1. imports the synthetic route (`capture-args.ts` §`captureRouteGpx`)
 *    through the Routes page's own form, as a rider does, and sets the
 *    rider's weight on the Settings page, so W/kg has one to read;
 * 2. opens the game at `#/game?capture=<scene>` (`src/game/capture-scene.ts`):
 *    a simulated ride, with no trainer, room or recording, whose power,
 *    cadence and heart rate follow the scene's script;
 * 3. HOLDS the clocks, presses *Ride*, and runs animation frames at that one
 *    instant until the ride has drawn the world — so the first counted frame
 *    is not a blank one, and no ride time has passed;
 * 4. for each frame, steps every clock by exactly `1000 / fps` ms, lets React
 *    commit, and takes `page.screenshot` — the WebGL world AND the full
 *    `HudPanel` over it — into `ffmpeg` (`tools/demo/render-video.ts`
 *    §`startEncoder`, the demo's encoder, with `capture-args.ts`
 *    §`captureMp4Args`).
 *
 * Each frame must draw the world exactly once (`window.__oylCapture.drawn`
 * moves by one), or the capture stops: a frame that drew nothing is a frame
 * of the video that is not the ride at its time.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

import { chromium, type Page } from '@playwright/test';

import { LAUNCH_ARGS } from '../../playwright.config';
import type { CaptureSnapshot } from '../../src/game/capture-scene';
import { encoders, startEncoder } from '../demo/render-video';
import { hasEncoder } from '../demo/video';
import {
  CAPTURE_DATE_MS,
  CAPTURE_RIDER_KILOGRAMS,
  CAPTURE_ROUTE_NAME,
  captureFrames,
  captureHash,
  captureMp4Args,
  captureName,
  captureRouteGpx,
  type CaptureRequest,
} from './capture-args';
import { installCaptureClock, type CaptureClockControl } from './capture-clock';

declare global {
  interface Window {
    __oylCapture?: CaptureSnapshot;
    __oylCaptureClock?: CaptureClockControl;
  }
}

/**
 * The origin the built app is answered at. Never resolved: `context.route`
 * answers it. Under `localhost`, so the page is a secure context, as the
 * app on `https:` is.
 */
export const CAPTURE_ORIGIN = 'http://app.localhost';

/** How long the ride may take to draw its first frame before the capture gives up. */
const FIRST_FRAME_LIMIT_MS = 120_000;

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

/** What a capture needs beyond the request. */
export interface CaptureOptions {
  /** The built app: `apps/web/dist`. */
  readonly dist: string;
  /** Where the video goes. */
  readonly out: string;
  /** `ffmpeg`, unless another is named. */
  readonly ffmpeg?: string | undefined;
  /** Told after each frame is written, for a progress line. */
  readonly onFrame?: ((frame: number, of: number) => void) | undefined;
}

/** What a capture wrote and saw. */
export interface CaptureResult {
  readonly mp4: string;
  readonly frames: number;
  /** The ride on the last frame, as the page reported it. */
  readonly last: CaptureSnapshot;
  /** Origins the page asked for and was refused. */
  readonly refused: readonly string[];
}

/** Import the capture's synthetic route through the Routes page's form. */
async function importRoute(page: Page): Promise<void> {
  await page.goto(`${CAPTURE_ORIGIN}/#/routes`);
  await page.locator('main #route-file').setInputFiles({
    name: 'capture-loop.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(captureRouteGpx()),
  });
  await page.getByRole('button', { name: 'Import route' }).click();
  await page.locator('main [role=status]').first().waitFor();
}

/**
 * Set the rider's weight through the Settings page's own form, so the HUD's
 * W/kg reads as it does for a rider who has set one — and the physics rides
 * that weight, as it does for them.
 */
async function setRiderWeight(page: Page): Promise<void> {
  await page.goto(`${CAPTURE_ORIGIN}/#/settings`);
  await page
    .getByRole('textbox', { name: 'Your weight (kg)' })
    .fill(String(CAPTURE_RIDER_KILOGRAMS));
  await page.getByRole('button', { name: 'Save weight' }).click();
  await page.getByText('Saved. The trainer game now rides you at this weight.').waitFor();
}

/** Capture `request` from the built app; resolves once the video is written and closed. */
export async function renderCapture(
  request: CaptureRequest,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const dist = resolve(options.dist);
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`no built app at ${dist}: run vite build first`);
  }
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  if (!hasEncoder(encoders(ffmpeg), 'libx264')) {
    throw new Error('capture: this ffmpeg has no libx264, which the H.264 output needs');
  }
  mkdirSync(options.out, { recursive: true });
  const mp4 = join(options.out, captureName(request));

  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const context = await browser.newContext({
      viewport: { width: request.width, height: request.height },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'no-preference',
      // The HUD's clock and the ride's season, read in this zone at {@link CAPTURE_DATE_MS}.
      timezoneId: 'UTC',
      // The offline worker would answer the app's files from its own cache,
      // round `context.route`.
      serviceWorkers: 'block',
    });
    const refused = new Set<string>();
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== CAPTURE_ORIGIN) {
        refused.add(url.origin);
        return route.abort();
      }
      const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = resolve(dist, path);
      if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fulfill({
        status: 200,
        contentType: TYPES[extname(file)] ?? 'application/octet-stream',
        body: readFileSync(file),
      });
    });
    // As source text, called on the page's own window: Playwright sends a
    // function's text, and this one names nothing outside itself.
    await context.addInitScript({
      content: `(${installCaptureClock.toString()})(window);`,
    });
    const page = await context.newPage();
    await importRoute(page);
    await setRiderWeight(page);

    await page.goto(`${CAPTURE_ORIGIN}/${captureHash(request.scene)}`);
    const ride = page.getByRole('button', { name: `Ride ${CAPTURE_ROUTE_NAME}` });
    await ride.waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.evaluate((dateMs) => {
      window.__oylCaptureClock?.hold(dateMs);
    }, CAPTURE_DATE_MS);
    await ride.click();

    // The ride's first frames, all at the instant of the press, until one
    // has drawn the world: none of them is in the video.
    const startedAt = Date.now();
    for (;;) {
      const drawn = await page.evaluate(async () => {
        const clock = window.__oylCaptureClock;
        clock?.frame();
        await clock?.settled();
        return window.__oylCapture?.drawn ?? 0;
      });
      if (drawn > 0) break;
      if (Date.now() - startedAt > FIRST_FRAME_LIMIT_MS) {
        throw new Error('capture: the ride never drew its first frame');
      }
      await page.waitForTimeout(50);
    }

    const encoder = startEncoder(ffmpeg, captureMp4Args(request.fps, mp4));
    const stepMs = 1000 / request.fps;
    const frames = captureFrames(request);
    let last: CaptureSnapshot | undefined;
    let drawnBefore = (await page.evaluate(() => window.__oylCapture))?.drawn ?? 0;
    try {
      for (let frame = 1; frame <= frames; frame += 1) {
        const stepped = await page.evaluate(async (ms) => {
          const clock = window.__oylCaptureClock;
          const ran = clock?.step(ms) ?? 0;
          await clock?.settled();
          return { ran, snapshot: window.__oylCapture };
        }, stepMs);
        const drawn = stepped.snapshot?.drawn ?? 0;
        if (stepped.ran !== 1 || drawn !== drawnBefore + 1) {
          throw new Error(
            `capture: frame ${String(frame)} ran ${String(stepped.ran)} animation frames ` +
              `and drew the world ${String(drawn - drawnBefore)} times, not once`,
          );
        }
        drawnBefore = drawn;
        last = stepped.snapshot;
        await encoder.write(
          await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' }),
        );
        options.onFrame?.(frame, frames);
      }
    } finally {
      await encoder.end();
    }
    if (last === undefined) throw new Error('capture: no frame was captured');
    return { mp4, frames, last, refused: [...refused] };
  } finally {
    await browser.close();
  }
}
