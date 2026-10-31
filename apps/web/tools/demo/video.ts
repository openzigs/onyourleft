// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's video export, the parts that need no browser and no encoder — #1655.
 *
 * `render-video.ts` drives the built demo through Playwright and pipes each
 * frame to `ffmpeg`. Everything it decides that can be decided without either
 * — the command line it accepts, the file names, `ffmpeg`'s arguments, how
 * its output is read back, the pixel test for a credit — is here, so that
 * `video.test.ts` runs it in the ordinary Vitest suite.
 *
 * Imports nothing, so `node` runs `demo-video.ts` with types stripped
 * (`package.json`'s `demo:video`).
 */

/**
 * A baked route's id: `route-bundle.ts` §`ROUTE_ID`, written out because that
 * module's imports reach `packages/map-features`, which `node` cannot strip
 * (#1931). `video.test.ts` holds the two equal.
 */
export const VIDEO_ROUTE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The presets a video can ride (`src/demo/presets.ts`). */
export const VIDEO_PRESETS = ['climb', 'sprint', 'group'] as const;
export type VideoPreset = (typeof VIDEO_PRESETS)[number];

/**
 * How long the closing card a baked route's video ends on is held — ADR 0056
 * D-8.3. After the ride's own `seconds`, so a render of 30 seconds is 30
 * seconds of ride either way.
 */
export const CLOSING_CARD_SECONDS = 4;

/** What `demo:video` was asked for. */
export interface VideoRequest {
  readonly preset: VideoPreset;
  /** A baked route's id (`demo:bake`), or none: the synthetic road. */
  readonly route: string | undefined;
  readonly seconds: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  /** Where the files go; `demo/dist/video` unless `--out` says. */
  readonly out: string | undefined;
  /** `auto` writes an MP4 when this `ffmpeg` has `libx264`; `on` requires it. */
  readonly mp4: 'auto' | 'on' | 'off';
  /**
   * Whether the realistic world's files are served. `--no-realistic` answers
   * each with a 404, so the demo draws the stylised world it falls back to:
   * the checks' (`demo-video.video.spec.ts`), which then pay for no realistic load.
   */
  readonly realistic: boolean;
}

/** The longest render accepted, in frames: an hour at 60 a second. */
export const MAX_FRAMES = 60 * 60 * 60;

/** Read `demo:video`'s arguments; a sentence for anything it cannot use. */
export function parseVideoArgs(
  argv: readonly string[],
):
  | { readonly ok: true; readonly request: VideoRequest }
  | { readonly ok: false; readonly message: string } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? '';
    if (arg === '--') continue;
    if (arg === '--no-realistic') {
      flags.add(arg);
      continue;
    }
    if (!['--preset', '--route', '--seconds', '--fps', '--size', '--out', '--mp4'].includes(arg)) {
      return { ok: false, message: `demo:video has no option ${arg}` };
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, message: `demo:video: ${arg} needs a value` };
    }
    if (values.has(arg)) return { ok: false, message: `demo:video: ${arg} is given twice` };
    values.set(arg, value);
    at += 1;
  }
  const preset = values.get('--preset') ?? 'climb';
  if (!(VIDEO_PRESETS as readonly string[]).includes(preset)) {
    return {
      ok: false,
      message: `demo:video: --preset is one of ${VIDEO_PRESETS.join(', ')}, not ${preset}`,
    };
  }
  const route = values.get('--route');
  if (route !== undefined && !VIDEO_ROUTE_ID.test(route)) {
    return { ok: false, message: `demo:video: no route can be called ${route}` };
  }
  const seconds = Number(values.get('--seconds') ?? '30');
  if (!(Number.isFinite(seconds) && seconds > 0)) {
    return { ok: false, message: `demo:video: --seconds is a positive number` };
  }
  const fpsText = values.get('--fps') ?? '30';
  const fps = Number(fpsText);
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 60)) {
    return {
      ok: false,
      message: `demo:video: --fps is a whole number from 1 to 60, not ${fpsText}`,
    };
  }
  const frames = seconds * fps;
  if (!Number.isInteger(frames)) {
    return {
      ok: false,
      message: `demo:video: ${seconds} seconds at ${fps} frames a second is not a whole number of frames`,
    };
  }
  if (frames > MAX_FRAMES) {
    return { ok: false, message: `demo:video: ${frames} frames is more than ${MAX_FRAMES}` };
  }
  const size = /^(\d{2,4})x(\d{2,4})$/.exec(values.get('--size') ?? '1920x1080');
  const width = Number(size?.[1]);
  const height = Number(size?.[2]);
  // Even, because the encoders' 4:2:0 chroma halves each dimension.
  if (size === null || width < 64 || height < 64 || width % 2 !== 0 || height % 2 !== 0) {
    return {
      ok: false,
      message: 'demo:video: --size is WIDTHxHEIGHT, each even and from 64 to 9998, e.g. 1920x1080',
    };
  }
  const mp4 = values.get('--mp4') ?? 'auto';
  if (mp4 !== 'auto' && mp4 !== 'on' && mp4 !== 'off') {
    return { ok: false, message: `demo:video: --mp4 is auto, on or off, not ${mp4}` };
  }
  return {
    ok: true,
    request: {
      preset: preset as VideoPreset,
      route,
      seconds,
      fps,
      width,
      height,
      out: values.get('--out'),
      mp4,
      realistic: !flags.has('--no-realistic'),
    },
  };
}

/** The ride's frames: `seconds × fps`, exactly. */
export function rideFrames(request: Pick<VideoRequest, 'seconds' | 'fps'>): number {
  return Math.round(request.seconds * request.fps);
}

/** The closing card's frames: none on the synthetic road, where nothing is owed. */
export function cardFrames(request: Pick<VideoRequest, 'route' | 'fps'>): number {
  return request.route === undefined ? 0 : CLOSING_CARD_SECONDS * request.fps;
}

/** `climb-1920x1080.webm`, or `climb-upstate-climb-1920x1080.webm` on a baked route. */
export function videoName(
  request: Pick<VideoRequest, 'preset' | 'route' | 'width' | 'height'>,
  extension: 'webm' | 'mp4',
): string {
  const route = request.route === undefined ? '' : `-${request.route}`;
  return `${request.preset}${route}-${request.width}x${request.height}.${extension}`;
}

/** The page's address for a request, under `origin`. */
export function renderUrl(origin: string, request: Pick<VideoRequest, 'preset' | 'route'>): string {
  const route = request.route === undefined ? '' : `&route=${request.route}`;
  return `${origin}/?preset=${request.preset}${route}&render`;
}

/**
 * What every encode is given before its own codec: PNG frames on standard
 * input at `fps`, no audio, and none of the muxer's version strings or dates,
 * so that what can differ between two renders is as little as the encoder
 * allows.
 */
function inputArgs(fps: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-c:v',
    'png',
    '-i',
    '-',
  ];
}

const BITEXACT = ['-an', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact'];

/**
 * VP9 in WebM. One thread and no row threading, so the encoder's own
 * decisions do not depend on how its threads were scheduled; `-crf` with no
 * bitrate cap is constant quality.
 */
export function webmArgs(fps: number, out: string): string[] {
  return [
    ...inputArgs(fps),
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '30',
    '-b:v',
    '0',
    '-deadline',
    'good',
    '-cpu-used',
    '4',
    '-row-mt',
    '0',
    '-threads',
    '1',
    ...BITEXACT,
    out,
  ];
}

/** H.264 in MP4, on one thread for the same reason, with the index first for the web. */
export function mp4Args(fps: number, out: string): string[] {
  return [
    ...inputArgs(fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-preset',
    'medium',
    '-threads',
    '1',
    '-movflags',
    '+faststart',
    ...BITEXACT,
    out,
  ];
}

/** Whether `ffmpeg -encoders`' list has `name`. */
export function hasEncoder(encoders: string, name: string): boolean {
  return encoders.split('\n').some((line) => line.trim().split(/\s+/)[1] === name);
}

/**
 * Each decoded frame's MD5, in order, from `ffmpeg -f framemd5`'s output:
 * `stream, dts, pts, duration, size, hash`, with `#` lines the header.
 */
export function parseFrameMd5(text: string): string[] {
  const hashes: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const hash = line.split(',').at(-1)?.trim() ?? '';
    if (!/^[0-9a-f]{32}$/.test(hash)) throw new Error(`framemd5: not a frame line: ${line}`);
    hashes.push(hash);
  }
  return hashes;
}

/** The first, the middle and the last of `count` frames. */
export function sampledFrames(count: number): readonly number[] {
  if (count < 1) throw new RangeError('a video with no frames has none to sample');
  return [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
}

/** A box on the frame, in pixels. */
export interface PixelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An sRGB colour, 0 to 255 a channel. */
export type Rgb = readonly [number, number, number];

/**
 * How much of `box` in an `rgb24` frame `width` pixels wide is within
 * `tolerance` of `colour` in every channel, from 0 to 1. The tolerance takes
 * up what 4:2:0 chroma and the encoder do to a flat fill.
 */
export function shareOfColour(
  rgb: Uint8Array,
  width: number,
  box: PixelBox,
  colour: Rgb,
  tolerance: number,
): number {
  const height = rgb.length / 3 / width;
  const left = Math.max(0, Math.round(box.x));
  const top = Math.max(0, Math.round(box.y));
  const right = Math.min(width, Math.round(box.x + box.width));
  const bottom = Math.min(height, Math.round(box.y + box.height));
  let inside = 0;
  let matching = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const at = (y * width + x) * 3;
      inside += 1;
      if (
        Math.abs((rgb[at] ?? 0) - colour[0]) <= tolerance &&
        Math.abs((rgb[at + 1] ?? 0) - colour[1]) <= tolerance &&
        Math.abs((rgb[at + 2] ?? 0) - colour[2]) <= tolerance
      ) {
        matching += 1;
      }
    }
  }
  return inside === 0 ? 0 : matching / inside;
}

/** `rgb(1, 2, 3)` or `rgba(1, 2, 3, 1)`, as a browser computes a colour, to {@link Rgb}. */
export function parseCssRgb(text: string): Rgb {
  const parts = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/.exec(text.trim());
  if (parts === null) throw new Error(`not an rgb() colour: ${text}`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}
