// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Render the built demo to video, frame by frame — #1655.
 *
 * ## How
 *
 * The built demo (`demo/dist`, `build:demo`) is opened in the pinned Chromium
 * with `?render`, every file answered from disk by `context.route` at an
 * origin of its own and every other request refused, so a render makes no
 * request at all. `?render` gives the page a clock that moves only when this
 * steps it (`src/demo/render-clock.ts`): each step is exactly `1000 / fps`
 * milliseconds of ride, however long the frame took to draw, and then
 * `page.screenshot` takes the frame — the WebGL world AND the DOM over it, the
 * ride HUD (`HudCore`, #1650) and its map credit — as a PNG, which is piped to
 * `ffmpeg`. So the HUD in the video is the HUD, not a copy drawn into the
 * canvas, and the credit is in the pixels (ADR 0056 D-8.2).
 *
 * ## The encoder: `ffmpeg`, not WebCodecs
 *
 * The issue's choice (b). WebCodecs in the page would encode the canvas, and
 * the HUD is not in the canvas: it would have to be drawn again in canvas,
 * which #1655 rules out. Screenshots already hold both, and `ffmpeg` takes
 * them as they are. It is a tool on the machine that renders and is never
 * shipped, so the project gains no dependency, and no licence or notice
 * changes; CI installs it with `apt-get` (the runner image has none).
 *
 * ## What is the same between two renders
 *
 * Every decoded frame (`ffmpeg -f framemd5`): the page draws from the ride's
 * time alone, the realistic world is loaded whole before the first step
 * (`port.ts` §`loadRealisticWorld`), the fonts before it too, and both
 * encoders run on one thread. `demo-video.video.spec.ts` renders twice and
 * compares. The containers' bytes are compared too and reported, not
 * required.
 *
 * ## A baked route's closing card
 *
 * A render with `--route` ends with {@link CLOSING_CARD_SECONDS} of the card
 * ADR 0056 D-8.3 asks for (`DemoPage.tsx` §`ClosingCard`), after the ride's own
 * seconds. A render whose route did not load is refused rather than rendered
 * without its map data.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

import { chromium, type Page } from '@playwright/test';

import { LAUNCH_ARGS } from '../../playwright.config';
import {
  cardFrames,
  hasEncoder,
  mp4Args,
  parseCssRgb,
  renderUrl,
  rideFrames,
  videoName,
  webmArgs,
  type PixelBox,
  type Rgb,
  type VideoRequest,
} from './video';

/**
 * The origin the built demo is answered at. Never resolved: `context.route`
 * answers it. ⚠️ Under `localhost`, so the page is a secure context, as a site
 * on `https:` is: the baked route's loader checks its file's digest with
 * `crypto.subtle`, which an insecure page does not have.
 */
export const RENDER_ORIGIN = 'http://demo.localhost';

/** How long the realistic world may take to load before the render gives up. */
const REALISTIC_LOAD_LIMIT_MS = 600_000;

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

/** What the render needs beyond the request. */
export interface RenderOptions {
  /** The built demo: `apps/web/demo/dist`. */
  readonly dist: string;
  /** Where the videos go. */
  readonly out: string;
  /**
   * Files answered under `routes/` instead of `dist/routes/`, by name: the
   * checks' fixture route (`demo-route-fixture.ts`, ADR 0056 D-9).
   */
  readonly routes?: ReadonlyMap<string, Uint8Array> | undefined;
  /** `ffmpeg`, unless another is named. */
  readonly ffmpeg?: string | undefined;
}

/** A box on the page, and the colours it is drawn in. */
export interface DrawnBox extends PixelBox {
  readonly background: Rgb;
  readonly ink: Rgb;
}

/** What a render wrote and saw. */
export interface RenderResult {
  readonly webm: string;
  /** Absent when this `ffmpeg` has no H.264 encoder and `--mp4` was `auto`, or `off`. */
  readonly mp4: string | undefined;
  readonly rideFrames: number;
  readonly cardFrames: number;
  /** The HUD's map credit on the first frame, if it was shown: what D-8.2's pixel check reads. */
  readonly attribution: DrawnBox | undefined;
  /** The HUD's primary readings on the first frame: the panel the HUD check reads. */
  readonly readings: DrawnBox;
  /** The world the first frame was drawn in, and why if not the realistic one. */
  readonly world: string;
  readonly notice: string | undefined;
}

interface Encoder {
  write(frame: Buffer): Promise<void>;
  end(): Promise<void>;
}

/** Start `ffmpeg` reading PNG frames from its standard input. */
function startEncoder(ffmpeg: string, args: readonly string[]): Encoder {
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const exited = new Promise<void>((done, fail) => {
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) done();
      else fail(new Error(`ffmpeg exited ${String(code)}: ${stderr.trim()}`));
    });
  });
  // A failed write is reported by the exit, with ffmpeg's own reason.
  child.stdin.on('error', () => undefined);
  return {
    write: (frame) =>
      new Promise<void>((done) => {
        if (child.stdin.write(frame)) done();
        else child.stdin.once('drain', done);
      }),
    end: async () => {
      child.stdin.end();
      await exited;
    },
  };
}

/** The encoders this `ffmpeg` has. */
function encoders(ffmpeg: string): string {
  const listed = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (listed.error !== undefined || listed.status !== 0) {
    throw new Error(
      `demo:video needs ffmpeg on the PATH (${ffmpeg}): ${String(listed.error ?? listed.stderr)}`,
    );
  }
  return listed.stdout;
}

/** A box on the page and its computed colours, or none if nothing matches `selector`. */
async function drawnBox(page: Page, selector: string): Promise<DrawnBox | undefined> {
  const found = await page.evaluate((query) => {
    const element = document.querySelector(query);
    if (element === null) return undefined;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      background: style.backgroundColor,
      ink: style.color,
    };
  }, selector);
  if (found === undefined || found.width === 0) return undefined;
  return { ...found, background: parseCssRgb(found.background), ink: parseCssRgb(found.ink) };
}

/** Render `request` from the built demo; resolves once every file is written and closed. */
export async function renderDemoVideo(
  request: VideoRequest,
  options: RenderOptions,
): Promise<RenderResult> {
  const dist = resolve(options.dist);
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`no built demo at ${dist}: run build:demo first`);
  }
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  const withMp4 =
    request.mp4 === 'on' || (request.mp4 === 'auto' && hasEncoder(encoders(ffmpeg), 'libx264'));
  if (request.mp4 === 'on' && !hasEncoder(encoders(ffmpeg), 'libx264')) {
    throw new Error('demo:video --mp4 on: this ffmpeg has no libx264');
  }
  mkdirSync(options.out, { recursive: true });
  const webm = join(options.out, videoName(request, 'webm'));
  const mp4 = withMp4 ? join(options.out, videoName(request, 'mp4')) : undefined;

  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const context = await browser.newContext({
      viewport: { width: request.width, height: request.height },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'no-preference',
    });
    const refused: string[] = [];
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== RENDER_ORIGIN) {
        refused.push(url.origin);
        return route.abort();
      }
      const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (!request.realistic && path.startsWith('realistic/')) {
        return route.fulfill({ status: 404, body: '' });
      }
      const routed = path.startsWith('routes/')
        ? options.routes?.get(path.slice('routes/'.length))
        : undefined;
      if (routed !== undefined) {
        return route.fulfill({ status: 200, body: Buffer.from(routed) });
      }
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
    const page = await context.newPage();
    await page.goto(renderUrl(RENDER_ORIGIN, request));
    await page.waitForFunction(
      () => window.__oylDemoRender !== undefined && window.__oylDemo !== undefined,
    );
    // The realistic world loads whole or not at all (`port.ts`), and the
    // first frame waits for it: drawn in the realistic world, or in the
    // stylised one with the reason, never half of each.
    await page.waitForFunction(
      () => window.__oylDemo?.world === 'realistic' || window.__oylDemo?.notice !== undefined,
      undefined,
      { timeout: REALISTIC_LOAD_LIMIT_MS },
    );
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const start = await page.evaluate(() => window.__oylDemo);
    if (request.route !== undefined && start?.mapData?.route !== request.route) {
      throw new Error(
        `demo:video: the route ${request.route} did not load, so it is not rendered ` +
          '(the page says why when it is opened without ?render)',
      );
    }

    const encoding = [startEncoder(ffmpeg, webmArgs(request.fps, webm))];
    if (mp4 !== undefined) encoding.push(startEncoder(ffmpeg, mp4Args(request.fps, mp4)));
    const send = async (frame: Buffer): Promise<void> => {
      await Promise.all(encoding.map((encoder) => encoder.write(frame)));
    };
    const shoot = (): Promise<Buffer> =>
      page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });

    const stepMs = 1000 / request.fps;
    const ride = rideFrames(request);
    let attribution: DrawnBox | undefined;
    let readings: DrawnBox | undefined;
    for (let frame = 0; frame < ride; frame += 1) {
      const drawn = await page.evaluate((ms) => window.__oylDemoRender?.step(ms), stepMs);
      if (drawn !== 1) {
        throw new Error(`demo:video: frame ${frame} drew ${String(drawn)} frames, not one`);
      }
      if (frame === 0) {
        attribution = await drawnBox(page, '.oyl-hud__attribution');
        readings = await drawnBox(page, '.oyl-hud__fields--primary');
      }
      await send(await shoot());
    }
    const card = cardFrames(request);
    if (card > 0) {
      await page.evaluate(() => window.__oylDemoRender?.closingCard());
      const still = await shoot();
      for (let frame = 0; frame < card; frame += 1) await send(still);
    }
    await Promise.all(encoding.map((encoder) => encoder.end()));
    if (refused.length > 0) {
      throw new Error(
        `demo:video: the page asked another origin: ${[...new Set(refused)].join(', ')}`,
      );
    }
    if (readings === undefined) throw new Error('demo:video: the first frame had no HUD');
    return {
      webm,
      mp4,
      rideFrames: ride,
      cardFrames: card,
      attribution,
      readings,
      world: start?.world ?? 'unknown',
      notice: start?.notice,
    };
  } finally {
    await browser.close();
  }
}
