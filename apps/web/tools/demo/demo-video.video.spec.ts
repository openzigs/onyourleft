// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo video's checks — #1655, run by `demo:video:check`
 * (`playwright.video.config.ts` says why not in the browser gate).
 *
 * Every claim is read back from the video FILE, never from the frames the
 * render handed `ffmpeg`: the frame count by `ffprobe`, each frame's digest by
 * `ffmpeg -f framemd5`, and a frame's pixels by decoding it to `rgb24`.
 *
 * - **Exactly the frames asked for**, in each container written.
 * - **The same frames twice**: two renders decode to the same first, middle
 *   and last frames. The containers' bytes are printed, not asserted.
 * - **The HUD is in the pixels**: its primary readings' panel, where the page
 *   laid it out, is the panel's own fill in the decoded frame.
 * - **The credit is in the pixels on a baked route** (ADR 0056 D-8.2), and the
 *   same box on the synthetic road is not the credit's backing: the control.
 *   The baked route is the synthetic corridor fixture (D-9), never
 *   OpenStreetMap data. Its video ends with the closing card (D-8.3).
 *
 * - **The YouTube tour's captions are where its script says** (#3074): its
 *   script claims only what its scenes show (`caption-claims.ts`); each
 *   caption's backing is in the pixels in the middle of its time and not just
 *   before or after it; two renders decode to the same frames; on a baked
 *   route the map-data caption is drawn and no caption covers the credit,
 *   which is still in the pixels under it; on the synthetic road the map-data
 *   caption is left out.
 *
 * Small sizes and short rides with the realistic world answered 404: what is
 * checked is the render, which draws whichever world the page drew.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import {
  bakeFixtureRouteInto,
  FIXTURE_ROUTE_ID,
  routeFilesIn,
} from '../../browser/demo-route-fixture';
import { YOUTUBE_CAPTIONS } from '../../demo/captions/youtube';
import { captionScriptProblems } from '../../src/demo/caption-claims';
import { scriptSeconds } from '../../src/demo/caption-script';
import { OSM_ATTRIBUTION } from '../../src/map/basemap';
import { SOURCE_CODE_URL } from '../../src/privacy/policy';
import { renderDemoVideo, type RenderResult } from './render-video';
import {
  cardFrames,
  CLOSING_CARD_SECONDS,
  parseFrameMd5,
  rideFrames,
  sampledFrames,
  shareOfColour,
  type PixelBox,
  type VideoRequest,
} from './video';

const DIST = fileURLToPath(new URL('../../demo/dist', import.meta.url));
const OUT = join(DIST, 'video-check');
/** How far a decoded pixel may sit from the colour the page painted: 4:2:0 and the encoder. */
const TOLERANCE = 24;

function request(overrides: Partial<VideoRequest> = {}): VideoRequest {
  return {
    preset: 'climb',
    route: undefined,
    seconds: 2,
    fps: 10,
    width: 320,
    height: 180,
    out: undefined,
    mp4: 'auto',
    realistic: false,
    ...overrides,
  };
}

function run(command: string, args: readonly string[]): Buffer {
  const done = spawnSync(command, args, { maxBuffer: 1 << 30 });
  if (done.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}: ${done.stderr.toString()}`);
  }
  return done.stdout;
}

/** The video stream's frames, counted by decoding them all. */
function countedFrames(file: string): number {
  const counted = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-count_frames',
    '-show_entries',
    'stream=nb_read_frames',
    '-of',
    'csv=p=0',
    file,
  ]);
  return Number(counted.toString().trim());
}

function digests(file: string): string[] {
  return parseFrameMd5(
    run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-']).toString(),
  );
}

/** Frame `index` of `file`, decoded to `rgb24`. */
function decoded(file: string, index: number): Uint8Array {
  return new Uint8Array(
    run('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${String(index)})`,
      '-fps_mode',
      'passthrough',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ]),
  );
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function intersects(one: PixelBox, two: PixelBox): boolean {
  return (
    one.x < two.x + two.width &&
    two.x < one.x + one.width &&
    one.y < two.y + two.height &&
    two.y < one.y + one.height
  );
}

function files(result: RenderResult): string[] {
  return [result.webm, ...(result.mp4 === undefined ? [] : [result.mp4])];
}

test.describe('the demo video — #1655', () => {
  test.beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
  });

  test('has exactly seconds × fps frames, read back from each file, with the HUD in its pixels', async () => {
    const asked = request();
    const result = await renderDemoVideo(asked, { dist: DIST, out: join(OUT, 'count') });
    expect(result.rideFrames).toBe(20);
    expect(result.cardFrames).toBe(0);
    for (const file of files(result)) {
      expect(countedFrames(file), file).toBe(asked.seconds * asked.fps);
      expect(digests(file), file).toHaveLength(asked.seconds * asked.fps);
    }
    // The ride moves: its first and last frames differ.
    const each = digests(result.webm);
    expect(each[0]).not.toBe(each.at(-1));
    // The HUD (#1650) is in the frame: its readings' panel, where the page laid
    // it out, is the panel's own fill.
    const frame = decoded(result.webm, 0);
    const { readings } = result;
    expect(
      shareOfColour(frame, asked.width, readings, readings.background, TOLERANCE),
    ).toBeGreaterThan(0.5);
  });

  test('renders the same frames twice: the first, middle and last decode alike', async () => {
    const asked = request({ preset: 'group' });
    const first = await renderDemoVideo(asked, { dist: DIST, out: join(OUT, 'first') });
    const second = await renderDemoVideo(asked, { dist: DIST, out: join(OUT, 'second') });
    const pairs = [[first.webm, second.webm]];
    if (first.mp4 !== undefined && second.mp4 !== undefined) pairs.push([first.mp4, second.mp4]);
    for (const [one, two] of pairs) {
      const a = digests(one ?? '');
      const b = digests(two ?? '');
      const sampled = sampledFrames(a.length);
      expect(sampled).toEqual([0, 9, 19]);
      expect(sampled.map((at) => b[at])).toEqual(sampled.map((at) => a[at]));
      // Printed, never asserted: whether the containers are the same bytes too.
      console.info(
        `demo video: ${one ?? ''}: every frame alike ${String(a.join() === b.join())}, ` +
          `the file's bytes alike ${String(sha256(one ?? '') === sha256(two ?? ''))}`,
      );
    }
  });

  test.describe('on a baked route', () => {
    let routes: Map<string, Uint8Array>;
    const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-video-'));

    test.beforeAll(async () => {
      await bakeFixtureRouteInto(scratch);
      routes = new Map(
        [...routeFilesIn(scratch)].map(([path, bytes]) => [path.replace('./routes/', ''), bytes]),
      );
    });

    test.afterAll(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    test('burns the credit into the frame, ends on the closing card, and the synthetic road shows neither', async () => {
      // The corners layout (`theme.css`, 46 rem and up, taller than 30 rem): the credit in its corner.
      const size = { width: 800, height: 600, seconds: 1, fps: 5 };
      const baked = await renderDemoVideo(request({ ...size, route: FIXTURE_ROUTE_ID }), {
        dist: DIST,
        out: join(OUT, 'route'),
        routes,
      });
      const control = await renderDemoVideo(request(size), { dist: DIST, out: join(OUT, 'road') });
      const box = baked.attribution;
      if (box === undefined) throw new Error('the baked route showed no credit');
      expect(control.attribution).toBeUndefined();

      // In the pixels of the file: the credit's backing over its box, and on
      // the synthetic road, the same box is the world.
      const credited = shareOfColour(
        decoded(baked.webm, 0),
        size.width,
        box,
        box.background,
        TOLERANCE,
      );
      const uncredited = shareOfColour(
        decoded(control.webm, 0),
        size.width,
        box,
        box.background,
        TOLERANCE,
      );
      console.info(
        `demo video: the credit's box is ${String(credited)} its backing, ${String(uncredited)} on the road`,
      );
      expect(credited).toBeGreaterThan(0.5);
      expect(uncredited).toBeLessThan(0.2);

      // The ride's frames, then the closing card's, which only the baked route has.
      const ride = rideFrames(size);
      const card = cardFrames({ preset: 'climb', route: FIXTURE_ROUTE_ID, fps: size.fps });
      expect(card).toBe(CLOSING_CARD_SECONDS * size.fps);
      expect(countedFrames(baked.webm)).toBe(ride + card);
      expect(countedFrames(control.webm)).toBe(ride);
      // The card covers the stage: the middle of the frame, which the corners
      // layout keeps clear for the road, is the card's fill there and the
      // world on the road's last frame.
      const middle = {
        x: size.width * 0.35,
        y: size.height * 0.4,
        width: size.width * 0.3,
        height: size.height * 0.2,
      };
      const carded = shareOfColour(
        decoded(baked.webm, ride + card - 1),
        size.width,
        middle,
        box.background,
        TOLERANCE,
      );
      const ridden = shareOfColour(
        decoded(control.webm, ride - 1),
        size.width,
        middle,
        box.background,
        TOLERANCE,
      );
      console.info(
        `demo video: the middle of the last frame is ${String(carded)} the card's fill, ${String(ridden)} on the road`,
      );
      expect(carded).toBeGreaterThan(0.5);
      expect(ridden).toBeLessThan(0.2);
    });
  });
});

test.describe('the YouTube tour’s captions — #3074', () => {
  // The corners layout a 1080p video is drawn in, at 720p, the size the
  // captions must read at; one frame a second, so a caption's middle and the
  // frames either side of it are each a frame.
  const tour = request({
    preset: 'youtube',
    seconds: scriptSeconds(YOUTUBE_CAPTIONS),
    fps: 1,
    width: 1280,
    height: 720,
    mp4: 'off',
  });
  test('claims only what its scenes show', () => {
    expect(captionScriptProblems(YOUTUBE_CAPTIONS)).toEqual([]);
  });

  test('draws each caption in the middle of its time and not either side of it', async () => {
    const first = await renderDemoVideo(tour, { dist: DIST, out: join(OUT, 'tour') });
    expect(countedFrames(first.webm)).toBe(first.rideFrames + first.cardFrames);
    expect(first.rideFrames).toBe(tour.seconds);
    expect(first.cardFrames).toBe(CLOSING_CARD_SECONDS);
    // The project's address, and no map credit: no scene drew map data.
    expect(first.cardLines).toEqual([`On Your Left: ${SOURCE_CODE_URL}`]);
    expect(first.captions.map((each) => each.text)).toEqual(
      YOUTUBE_CAPTIONS.scenes.flatMap((scene) => scene.captions.map((each) => each.text)),
    );
    for (const caption of first.captions) {
      if (caption.feature === 'map-data') {
        // The synthetic road is no map data: the caption is left out.
        expect(caption.box, caption.text).toBeUndefined();
        continue;
      }
      const box = caption.box;
      if (box === undefined) throw new Error(`no caption drawn for “${caption.text}”`);
      expect(caption.drawnText).toBe(caption.text);
      // It covers no HUD panel: the readings, the route, Pause and Stop.
      expect(caption.hud.length, caption.text).toBeGreaterThan(2);
      for (const panel of caption.hud) expect(intersects(box, panel), caption.text).toBe(false);
      const share = (frame: number): number =>
        shareOfColour(decoded(first.webm, frame), tour.width, box, box.background, TOLERANCE);
      const middle = share(caption.middle);
      const either = [caption.before, caption.after].flatMap((frame) =>
        frame === undefined ? [] : [share(frame)],
      );
      console.info(
        `demo video: “${caption.text}” is ${String(middle)} its backing at frame ` +
          `${String(caption.middle)}, ${either.join(' and ')} either side`,
      );
      expect(middle, caption.text).toBeGreaterThan(0.5);
      expect(either.length, caption.text).toBeGreaterThan(0);
      for (const outside of either) expect(outside, caption.text).toBeLessThan(0.2);
    }
  });

  test('renders the same frames twice, every one of them', async () => {
    // At the existing check's size. ⚠️ Not at 1280 × 720: there the WORLD
    // differs between two renders in a few pixels at the far left horizon,
    // from a frame that varies (the climb preset's 83rd second on main, before
    // #3074), and VP9 carries that into every later frame. The captions are
    // DOM over the world, so their sameness is shown where the world is the same.
    const small = { ...tour, width: 320, height: 180 };
    const one = await renderDemoVideo(small, { dist: DIST, out: join(OUT, 'tour-one') });
    const two = await renderDemoVideo(small, { dist: DIST, out: join(OUT, 'tour-two') });
    expect(one.captions.filter((each) => each.box !== undefined)).toHaveLength(
      one.captions.filter((each) => each.feature !== 'map-data').length,
    );
    const a = digests(one.webm);
    expect(a).toHaveLength(one.rideFrames + one.cardFrames);
    expect(digests(two.webm)).toEqual(a);
  });

  test.describe('on a baked route', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-tour-'));
    let routes: Map<string, Uint8Array>;

    test.beforeAll(async () => {
      await bakeFixtureRouteInto(scratch);
      routes = new Map(
        [...routeFilesIn(scratch)].map(([path, bytes]) => [path.replace('./routes/', ''), bytes]),
      );
    });

    test.afterAll(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    test('draws the map-data caption, and no caption covers the credit, which stays in the pixels', async () => {
      const baked = await renderDemoVideo(
        { ...tour, route: FIXTURE_ROUTE_ID },
        { dist: DIST, out: join(OUT, 'tour-route'), routes },
      );
      const [credit] = baked.credits;
      if (credit === undefined) throw new Error('the baked route’s scene showed no credit');
      expect(baked.credits).toHaveLength(
        YOUTUBE_CAPTIONS.scenes.filter((scene) => scene.route === true).length,
      );
      // The card carries the credit, though the last scene rode its own road.
      expect(baked.cardLines[0]).toBe(OSM_ATTRIBUTION);
      expect(baked.cardLines.at(-1)).toBe(`On Your Left: ${SOURCE_CODE_URL}`);
      const map = baked.captions.find((each) => each.feature === 'map-data');
      expect(map?.box).toBeDefined();
      expect(map?.drawnText).toBe(map?.text);
      for (const caption of baked.captions) {
        const box = caption.box;
        if (box === undefined) throw new Error(`no caption drawn for “${caption.text}”`);
        for (const each of [...baked.credits, ...caption.hud]) {
          expect(intersects(box, each), caption.text).toBe(false);
        }
        if (caption.scene !== map?.scene) continue;
        // In the scene that rides the route, the credit is still in the
        // pixels while the caption is up.
        const shown = shareOfColour(
          decoded(baked.webm, caption.middle),
          tour.width,
          credit,
          credit.background,
          TOLERANCE,
        );
        console.info(
          `demo video: under “${caption.text}” the credit's box is ${String(shown)} its backing`,
        );
        expect(shown, caption.text).toBeGreaterThan(0.5);
      }
    });
  });
});
