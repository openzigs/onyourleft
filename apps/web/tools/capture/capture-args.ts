// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The capture's decisions that need no browser and no encoder — #3152: what
 * was asked for, how many frames that is, what `ffmpeg` is told, and the
 * synthetic route the capture rides. `render-capture.ts` does the rest.
 */

import { CAPTURE_SCENES } from '../../src/game/capture-scene';
import { YOUTUBE_SCRIPT } from './scripts/youtube';
import type { VideoScript } from './video-script';

/** What a capture was asked for. */
export interface CaptureRequest {
  readonly scene: string;
  readonly seconds: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  /** A directory; absent is `apps/web/capture/dist`. */
  readonly out: string | undefined;
  /**
   * #3154: where a free ride starts, `<lat>,<lon>` in degrees, for a scene
   * that rides the open world; `undefined` for every other scene.
   */
  readonly start?: string | undefined;
  /**
   * #3154: a local copy of the basemap archive (`.pmtiles`) the open world's
   * blocks are answered from, for a scene that rides it; `undefined` for
   * every other scene. Its bytes never leave this machine, nor does a request.
   */
  readonly archive?: string | undefined;
}

/** The longest capture, in frames: ten minutes at 60 fps. A typo is refused, not rendered for a day. */
export const MAX_CAPTURE_FRAMES = 36_000;

const OPTIONS = [
  '--scene',
  '--seconds',
  '--fps',
  '--size',
  '--out',
  '--start',
  '--archive',
  '--script',
] as const;

/** `<lat>,<lon>`, each a decimal number of degrees. */
const START = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/u;

type Refused = { readonly ok: false; readonly message: string };

/** Each option and its value, or why `argv` is not a capture's. */
function readOptions(argv: readonly string[]): Map<string, string> | Refused {
  const values = new Map<string, string>();
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? '';
    // pnpm hands a `--` on to the script.
    if (arg === '--') continue;
    if (!(OPTIONS as readonly string[]).includes(arg)) {
      return { ok: false, message: `capture has no option ${arg}` };
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, message: `capture: ${arg} needs a value` };
    }
    if (values.has(arg)) return { ok: false, message: `capture: ${arg} is given twice` };
    values.set(arg, value);
    at += 1;
  }
  return values;
}

/** The frame rate and size `values` ask for: 1920×1080 at 60 by default. */
function readFrame(
  values: ReadonlyMap<string, string>,
): { readonly fps: number; readonly width: number; readonly height: number } | Refused {
  const fpsText = values.get('--fps') ?? '60';
  const fps = Number(fpsText);
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 60)) {
    return { ok: false, message: `capture: --fps is a whole number from 1 to 60, not ${fpsText}` };
  }
  const sizeText = values.get('--size') ?? '1920x1080';
  const size = /^(\d{2,4})x(\d{2,4})$/.exec(sizeText);
  const width = Number(size?.[1]);
  const height = Number(size?.[2]);
  // H.264's 4:2:0 needs both sides even.
  if (size === null || width < 64 || height < 64 || width % 2 !== 0 || height % 2 !== 0) {
    return {
      ok: false,
      message: `capture: --size is WIDTHxHEIGHT, each even and at least 64, not ${sizeText}`,
    };
  }
  return { fps, width, height };
}

/**
 * #3154: a free ride's start and blocks, given exactly when `openWorld`, in
 * `what` (a scene's name, or a script's). ⚠️ A message about the start names
 * the option and the rule, never the value (ADR 0004 D): it is a place.
 */
function readOpenWorld(
  values: ReadonlyMap<string, string>,
  openWorld: boolean,
  what: string,
): { readonly start?: string; readonly archive?: string } | Refused {
  const start = values.get('--start');
  const archive = values.get('--archive');
  if (openWorld && (start === undefined || archive === undefined)) {
    return {
      ok: false,
      message: `capture: ${what} rides the open world, so it needs --start and --archive`,
    };
  }
  if (!openWorld && (start !== undefined || archive !== undefined)) {
    return {
      ok: false,
      message: 'capture: --start and --archive are for a scene that rides the open world',
    };
  }
  if (start !== undefined) {
    const parts = START.exec(start);
    const latitude = Number(parts?.[1]);
    const longitude = Number(parts?.[2]);
    if (parts === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return {
        ok: false,
        message:
          'capture: --start is <lat>,<lon> in decimal degrees, latitude to 90 and longitude to 180',
      };
    }
  }
  return {
    ...(start === undefined ? {} : { start }),
    ...(archive === undefined ? {} : { archive }),
  };
}

function refused(value: object): value is Refused {
  return 'ok' in value && value.ok === false;
}

/**
 * `capture`'s arguments. The defaults are the issue's: the `route-hud`
 * scene, 1920×1080 at 60 frames a second, for 20 seconds.
 */
export function parseCaptureArgs(
  argv: readonly string[],
):
  | { readonly ok: true; readonly request: CaptureRequest }
  | { readonly ok: false; readonly message: string } {
  const values = readOptions(argv);
  if (refused(values)) return values;
  if (values.has('--script')) {
    return { ok: false, message: 'capture: --script is a whole video: parseScriptArgs reads it' };
  }
  const scene = values.get('--scene') ?? 'route-hud';
  if (!Object.hasOwn(CAPTURE_SCENES, scene)) {
    return {
      ok: false,
      message: `capture: --scene is one of ${Object.keys(CAPTURE_SCENES).join(', ')}, not ${scene}`,
    };
  }
  const seconds = Number(values.get('--seconds') ?? '20');
  if (!(Number.isFinite(seconds) && seconds > 0)) {
    return { ok: false, message: 'capture: --seconds is a positive number' };
  }
  const frame = readFrame(values);
  if (refused(frame)) return frame;
  const { fps, width, height } = frame;
  const frames = seconds * fps;
  if (!Number.isInteger(frames)) {
    return {
      ok: false,
      message: `capture: ${String(seconds)} seconds at ${String(fps)} frames a second is not a whole number of frames`,
    };
  }
  if (frames > MAX_CAPTURE_FRAMES) {
    return {
      ok: false,
      message: `capture: ${String(frames)} frames is more than ${String(MAX_CAPTURE_FRAMES)}`,
    };
  }
  const openWorld = readOpenWorld(
    values,
    CAPTURE_SCENES[scene]?.openWorld === true,
    `--scene ${scene}`,
  );
  if (refused(openWorld)) return openWorld;
  return {
    ok: true,
    request: { scene, seconds, fps, width, height, out: values.get('--out'), ...openWorld },
  };
}

/** #3156: what a script's render was asked for. */
export interface ScriptRequest {
  /** A name in {@link VIDEO_SCRIPTS}. */
  readonly script: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  /** A directory; absent is `apps/web/capture/dist`. */
  readonly out: string | undefined;
  /** The start and archive of the script's free-ride scenes, when it has one. */
  readonly start?: string | undefined;
  readonly archive?: string | undefined;
}

/** #3156: the scene scripts `--script` renders, by name. */
export const VIDEO_SCRIPTS: Readonly<Record<string, VideoScript>> = { youtube: YOUTUBE_SCRIPT };

/**
 * #3156: `capture -- --script <name>`'s arguments: the whole video of a
 * script, whose scenes say what is ridden and for how long, so `--scene` and
 * `--seconds` are not taken. A script with an open-world scene needs
 * `--start` and `--archive`, as that scene does.
 */
export function parseScriptArgs(
  argv: readonly string[],
):
  | { readonly ok: true; readonly request: ScriptRequest }
  | { readonly ok: false; readonly message: string } {
  const values = readOptions(argv);
  if (refused(values)) return values;
  const name = values.get('--script') ?? '';
  const script = Object.hasOwn(VIDEO_SCRIPTS, name) ? VIDEO_SCRIPTS[name] : undefined;
  if (script === undefined) {
    return {
      ok: false,
      message: `capture: --script is one of ${Object.keys(VIDEO_SCRIPTS).join(', ')}, not ${name}`,
    };
  }
  for (const option of ['--scene', '--seconds']) {
    if (values.has(option)) {
      return { ok: false, message: `capture: ${option} is the script’s to say, not --script’s` };
    }
  }
  const frame = readFrame(values);
  if (refused(frame)) return frame;
  const openWorld = readOpenWorld(
    values,
    script.scenes.some((scene) => CAPTURE_SCENES[scene.capture]?.openWorld === true),
    `--script ${name}`,
  );
  if (refused(openWorld)) return openWorld;
  return { ok: true, request: { script: name, ...frame, out: values.get('--out'), ...openWorld } };
}

/** How many frames a capture writes: its seconds times its frames a second, exactly. */
export function captureFrames(request: Pick<CaptureRequest, 'seconds' | 'fps'>): number {
  return Math.round(request.seconds * request.fps);
}

/** The file a capture writes, inside its directory. */
export function captureName(request: CaptureRequest): string {
  return `${request.scene}-${String(request.width)}x${String(request.height)}-${String(request.fps)}fps.mp4`;
}

/**
 * `ffmpeg`'s arguments: PNG frames on its standard input, out as H.264 High
 * profile, 4:2:0, at constant quality CRF 16 (#3152's first choice), with
 * the index at the front (`+faststart`) for the web. Constant quality, not a
 * bitrate: the stylised world compresses well, and the 20 s `route-hud`
 * capture came to about 4.9 Mb/s, under the 12 Mb/s YouTube suggests for an
 * upload at 1080p60 and at the quality CRF 16 holds. One thread, as the
 * demo's encoder (`tools/demo/video.ts` §`mp4Args`), so two captures of one
 * ride encode alike.
 */
export function captureMp4Args(fps: number, out: string): string[] {
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
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '16',
    '-preset',
    'slow',
    '-r',
    String(fps),
    '-threads',
    '1',
    '-movflags',
    '+faststart',
    '-an',
    '-map_metadata',
    '-1',
    out,
  ];
}

/**
 * The instant every capture's `Date` stands at when the ride starts: a
 * midsummer morning, in UTC, which the capture's browser is set to. So the
 * HUD's clock reads 10:30 and the season has no holiday in it, whenever and
 * wherever the capture is made.
 */
export const CAPTURE_DATE_MS = Date.UTC(2026, 5, 20, 10, 30, 0);

/** The capture rider's weight, set on the Settings page as a rider sets theirs: chosen, not anybody's. */
export const CAPTURE_RIDER_KILOGRAMS = 72;

/**
 * The fragment the capture opens the game at, for `scene`: on the scene's
 * built-in route when it names one (#3153), as `shell/routes.ts`
 * §`hrefForGameRoute` writes it, so the game opens with that card chosen.
 */
export function captureHash(scene: string, start?: string): string {
  const id = CAPTURE_SCENES[scene]?.route?.id;
  const chosen = id === undefined ? '' : `route=${encodeURIComponent(id)}&`;
  // #3154: a free ride's start, which only an open-world scene reads.
  const from = start === undefined ? '' : `&start=${encodeURIComponent(start)}`;
  return `#/game?${chosen}capture=${encodeURIComponent(scene)}${from}`;
}

/**
 * What the *Ride* button of `scene`'s route reads after *Ride*: its built-in
 * route's name (#3153), or the synthetic route's ({@link CAPTURE_ROUTE_NAME}).
 */
export function captureRideName(scene: string): string {
  return CAPTURE_SCENES[scene]?.route?.name ?? CAPTURE_ROUTE_NAME;
}

/** What the capture's route is called on the picker: a placeholder, never a real place's name. */
export const CAPTURE_ROUTE_NAME = 'Capture loop';

/**
 * The route the capture rides, as GPX: eight kilometres north from 0° 0°,
 * swinging 1.2 km east and then as far west, about 9.5 km of road over two
 * rises — invented, so no real street or place is on screen (the epic's
 * rule), with a gradient that changes for the HUD to show. A point every ten
 * metres north.
 *
 * The swing is the route's shape on the HUD's map (`hud/plan.ts`), fitted
 * whole into its panel: the demo's "The whole route, and where you are on it"
 * is said over it, and a route that only bends 120 m in 8 km is drawn there as
 * a straight line (the owner's review of #3177, 2026-11-25). Its bends are
 * over a kilometre in radius, so the ride itself still reads as a gentle road.
 */
export function captureRouteGpx(): string {
  const points: string[] = [];
  const METRES_PER_DEGREE = 111_320;
  const SPACING = 10;
  const COUNT = 800;
  for (let index = 0; index <= COUNT; index += 1) {
    const along = index * SPACING;
    const east = 1_200 * Math.sin((along / 4000) * Math.PI);
    const elevation = 40 + 18 * (1 - Math.cos((along / 2000) * Math.PI));
    points.push(
      `<trkpt lat="${(along / METRES_PER_DEGREE).toFixed(7)}" lon="${(east / METRES_PER_DEGREE).toFixed(7)}">` +
        `<ele>${elevation.toFixed(1)}</ele></trkpt>`,
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="onyourleft capture" xmlns="http://www.topografix.com/GPX/1/1">',
    `<trk><name>${CAPTURE_ROUTE_NAME}</name><trkseg>`,
    ...points,
    '</trkseg></trk></gpx>',
  ].join('');
}
