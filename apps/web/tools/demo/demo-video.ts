// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `demo:video` — render the built demo to a video file. #1655.
 *
 * ```sh
 * pnpm --filter @onyourleft/web run build:demo
 * pnpm --filter @onyourleft/web run demo:video -- --preset climb --seconds 30 --size 1920x1080 --fps 30
 * ```
 *
 * writes `demo/dist/video/climb-1920x1080.webm`, and `climb-1920x1080.mp4`
 * where this machine's `ffmpeg` has `libx264`. `--route <id>` rides a route
 * `demo:bake` wrote, and the video ends with ADR 0056 D-8.3's closing card;
 * `--out <dir>` writes elsewhere; `--mp4 on|off` requires or skips the MP4.
 * `render-video.ts` says how, and why `ffmpeg`.
 *
 * Needs `ffmpeg` on the PATH and the pinned Chromium (`playwright install
 * chromium`). Neither is shipped.
 */

import { fileURLToPath } from 'node:url';

import { renderDemoVideo } from './render-video';
import { parseVideoArgs } from './video';

const DIST = fileURLToPath(new URL('../../demo/dist', import.meta.url));

const parsed = parseVideoArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(2);
}
const { request } = parsed;
const result = await renderDemoVideo(request, {
  dist: DIST,
  out: request.out ?? `${DIST}/video`,
});
for (const file of [result.webm, result.mp4]) {
  if (file !== undefined) console.log(`demo:video: ${file}`);
}
console.log(
  `demo:video: ${String(result.rideFrames)} frames of ride` +
    (result.cardFrames > 0 ? ` and ${String(result.cardFrames)} of the closing card` : '') +
    `, in the ${result.world} world${result.notice === undefined ? '' : ` (${result.notice})`}`,
);
