// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `capture` — render the real app to video, frame by frame. #3152.
 *
 * ```sh
 * pnpm --filter @onyourleft/web run capture -- --scene route-hud --seconds 20
 * ```
 *
 * builds the app into `capture/dist/app`, then writes
 * `capture/dist/route-hud-1920x1080-60fps.mp4`: H.264 High, 4:2:0, 60 fps,
 * and beside it the ride's event log, `….events.json` (#3153). `--fps`, `--size` and `--out <dir>` change it.
 * `render-capture.ts` says how; `docs/demo-video.md` §"Capture mode" says why.
 *
 * Needs `ffmpeg` with `libx264` on the PATH and the pinned Chromium
 * (`playwright install chromium`). Neither is shipped.
 */

import { fileURLToPath } from 'node:url';

import { captureName, parseCaptureArgs } from './capture-args';
import { renderCapture } from './render-capture';

// #3153: the capture build's own directory (`vite.config.ts`), never `dist`.
const DIST = fileURLToPath(new URL('../../capture/dist/app', import.meta.url));
const OUT = fileURLToPath(new URL('../../capture/dist', import.meta.url));

const parsed = parseCaptureArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(2);
}
const { request } = parsed;
let shown = 0;
const result = await renderCapture(request, {
  dist: DIST,
  out: request.out ?? OUT,
  onFrame: (frame, of) => {
    const percent = Math.floor((frame / of) * 100);
    if (percent >= shown + 10 || frame === of) {
      shown = percent;
      console.log(`capture: ${captureName(request)} ${String(frame)}/${String(of)} frames`);
    }
  },
});
console.log(`capture: ${result.mp4}`);
console.log(`capture: ${result.events}`);
console.log(`capture: ${result.requests}`);
console.log(
  `capture: ${String(result.frames)} frames; the ride was ${result.last.distance.toFixed(1)} m ` +
    `in at ${result.last.elapsed.toFixed(2)} s on the last`,
);
if (result.refused.length > 0) {
  console.log(`capture: the page asked other origins, refused: ${result.refused.join(', ')}`);
}
