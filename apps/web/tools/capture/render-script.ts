// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Render a whole scene script to one video — #3156, epic #3151.
 *
 * `capture -- --script youtube` checks the script (`video-script.ts`
 * §`scriptProblems`), then rides each of its scenes in the real app in turn
 * (`render-capture.ts`), every frame into ONE encoder, so the video is one
 * MP4 with no join to re-encode. Beside it go an `.srt` of every caption and
 * the chapter list for the YouTube description, both from the same script.
 *
 * ## Captions and callouts are drawn by the page
 *
 * Before each frame is taken, the caption on screen at that second of its
 * scene is laid out in the page, over the app, in the HUD's own tokens:
 *
 * 1. the page measures the caption's size, the HUD panel a callout explains
 *    (by its class and the label a rider reads), the map credit and every
 *    other HUD panel ({@link measureOverlay});
 * 2. `caption-layout.ts` §`placeCaption` says where it goes, from those boxes
 *    alone, so a callout lines up with its panel at any frame size;
 * 3. the page draws it there, with a leader line to the panel and a ring
 *    round it ({@link drawOverlay}), and the drawn box is measured again and
 *    held to the rules ({@link drawnProblems}).
 *
 * A frame where a callout's panel is missing, or where no place keeps the
 * caption off the panel it explains, the map credit and the title-safe
 * margin, stops the render: a video that breaks the epic's rules is not made.
 *
 * #3175: so does a captioned frame where any panel the scene's mode draws
 * (`video-script.ts` §`scenePanels`) is missing or faded — the owner's "make
 * sure the video shows all of the hud" — and the opening title is drawn under
 * the project's logo ({@link installLogo}).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { CAPTURE_SCENES } from '../../src/game/capture-scene';
import { encoders, startEncoder } from '../demo/render-video';
import { hasEncoder } from '../demo/video';
import {
  balancedWidth,
  placeCaption,
  inside,
  intersects,
  titleSafe,
  type Box,
  type Point,
} from './caption-layout';
import { overlayStyle, type CaptionKind, type OverlayStyle } from './caption-style';
import {
  captureMp4Args,
  musicMuxArgs,
  SCRIPT_MUSIC,
  VIDEO_SCRIPTS,
  type ScriptMusic,
  type ScriptRequest,
} from './capture-args';
import { renderCapture } from './render-capture';
import {
  CALLOUT_PANELS,
  captionAt,
  CREDIT_SELECTOR,
  scriptChapters,
  scriptDescription,
  scriptProblems,
  scriptSeconds,
  sceneFade,
  scenePanels,
  scriptSrt,
  shownLines,
  type CalloutPanel,
  type VideoCaption,
  type VideoScene,
} from './video-script';

/**
 * #3175: the project's logo, as the app ships it (`src/brand/`, the owner's
 * art, CC-BY-4.0): the dark palette's, which is the capture's. It is drawn no
 * larger than its own 512 × 408 pixels, so it is sharp at 1080p without a
 * scaled copy.
 */
export const LOGO_FILE = fileURLToPath(new URL('../../src/brand/logo-dark.webp', import.meta.url));

/** The logo as a `data:` address, so the page draws it without a request. */
export function logoDataUrl(file: string = LOGO_FILE): string {
  return `data:image/webp;base64,${readFileSync(file).toString('base64')}`;
}

/**
 * In the page: add the logo's `<img>`, hidden, and wait until it is decoded,
 * so the frame it is first drawn on has it. Once a page; a second call is
 * nothing.
 */
async function installLogo(src: string): Promise<void> {
  if (document.getElementById('oyl-capture-logo') !== null) return;
  const img = document.createElement('img');
  img.id = 'oyl-capture-logo';
  img.alt = '';
  img.style.display = 'none';
  img.src = src;
  document.body.append(img);
  await img.decode();
}

/** The HUD's panels, every one of which a caption keeps off where the frame has room. */
export const PANEL_SELECTOR = '.oyl-hud__panel, .oyl-hud__junction-prompt';

/** A script render's file name, inside its directory, with `extension`. */
export function scriptName(request: ScriptRequest, extension: string): string {
  return `${request.script}-${String(request.width)}x${String(request.height)}-${String(request.fps)}fps${extension}`;
}

/** What a script render needs beyond the request. */
export interface ScriptOptions {
  /** The built app: `apps/web/capture/dist/app`. */
  readonly dist: string;
  /** Where the video, its captions and chapters go. */
  readonly out: string;
  readonly ffmpeg?: string | undefined;
  /** Told after each frame of a scene is written, for a progress line. */
  readonly onFrame?: ((scene: string, frame: number, of: number) => void) | undefined;
}

/** What a script render wrote. */
export interface ScriptResult {
  readonly mp4: string;
  readonly srt: string;
  readonly chapters: string;
  /** #3223: the description's draft: the chapters and the credits, the music's among them. */
  readonly description: string;
  /** Frames written, every scene's. */
  readonly frames: number;
}

type Kind = CaptionKind;

/** What {@link measureOverlay} reads off the page. */
export interface Measured {
  readonly size: { readonly width: number; readonly height: number };
  readonly target: Box | undefined;
  readonly credit: Box | undefined;
  readonly panels: readonly Box[];
  /** #3175: the names of the panels asked for that are not drawn, or are faded. */
  readonly missing: readonly string[];
}

/**
 * In the page: lay the caption's `lines` out, hidden, in the style of `kind`,
 * and measure it, the panel a callout explains, the credit and every panel.
 * Sent to the page as source, so it names nothing outside itself.
 */
function measureOverlay(arg: {
  readonly lines: readonly string[];
  readonly selector: string | undefined;
  readonly label: string | undefined;
  readonly credit: string;
  readonly panels: string;
  /** #3175: draw the logo above the words. */
  readonly logo: boolean;
  /** How it is drawn (`caption-style.ts`). */
  readonly style: OverlayStyle;
  /** The width to lay it out at, in pixels; its own where there is none. */
  readonly width?: number | undefined;
  /** #3175: the panels the frame must show, by name, selector and label. */
  readonly want: readonly {
    readonly name: string;
    readonly selector: string;
    readonly label: string | undefined;
  }[];
}): Measured {
  const ID = 'oyl-capture-overlay';
  let root = document.getElementById(ID);
  if (root === null) {
    root = document.createElement('div');
    root.id = ID;
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483647',
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    for (const tag of ['line', 'circle', 'rect']) {
      svg.append(document.createElementNS('http://www.w3.org/2000/svg', tag));
    }
    const card = document.createElement('div');
    card.dataset['caption'] = '';
    root.append(svg, card);
    document.body.append(root);
  }
  root.style.display = 'block';
  const card = root.querySelector<HTMLElement>('[data-caption]');
  const svg = root.querySelector('svg');
  if (card === null || svg === null) throw new Error('the capture overlay lost its parts');
  svg.style.visibility = 'hidden';
  // #3175: the logo is kept out of the caption between frames, so a caption
  // that has none does not take it away with its own lines.
  const logo = document.getElementById('oyl-capture-logo') as HTMLImageElement | null;
  if (logo !== null) {
    logo.style.display = 'none';
    document.body.append(logo);
  }
  if (arg.logo && logo === null) throw new Error('the capture logo was not installed');
  if (arg.logo && logo !== null) {
    Object.assign(logo.style, {
      display: 'block',
      // Never larger than its own pixels, so never scaled up and blurred;
      // and small enough that the title sits between the HUD's top panels
      // and the rider at 1080p (`caption-style.ts` §`LOGO_VH`).
      height: `min(${String(arg.style.logoVh)}vh, ${String(logo.naturalHeight)}px)`,
      width: 'auto',
      margin: '0 auto 0.2em',
      order: '-1',
    });
  }
  card.replaceChildren(
    ...(arg.logo && logo !== null ? [logo] : []),
    ...arg.lines.map((line, index) => {
      const p = document.createElement('p');
      p.textContent = line;
      Object.assign(p.style, arg.style.lines[index]);
      return p;
    }),
  );
  card.removeAttribute('style');
  Object.assign(card.style, arg.style.card);
  // A wrapped caption is drawn at the width that balances its lines
  // (`caption-layout.ts` §`balancedWidth`), not at its widest.
  if (arg.width !== undefined) {
    Object.assign(card.style, { width: `${String(arg.width)}px`, maxWidth: 'none' });
  }
  Object.assign(svg.style, arg.style.marks);
  const boxOf = (element: Element): Box => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  // In the frame and more than the pixel a visually hidden panel keeps: a
  // panel the HUD leaves out at this size (the standings under 1080p) is none.
  const shown = (box: Box): boolean =>
    box.width >= 2 &&
    box.height >= 2 &&
    box.x + box.width > 0 &&
    box.y + box.height > 0 &&
    box.x < window.innerWidth &&
    box.y < window.innerHeight;
  // And drawn: the ride's controls fade out after five seconds with no input
  // (`controls-reveal.ts`), and a callout to a faded panel points at nothing.
  const drawn = (element: Element): boolean => {
    let opacity = 1;
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      opacity *= Number(style.opacity);
    }
    return opacity >= 0.5;
  };
  const find = (selector: string, label: string | undefined): Element | undefined =>
    [...document.querySelectorAll(selector)].find(
      (element) =>
        shown(boxOf(element)) &&
        drawn(element) &&
        (label === undefined ||
          (element.querySelector('.oyl-hud__label')?.textContent ?? '').trim().startsWith(label)),
    );
  const target = arg.selector === undefined ? undefined : find(arg.selector, arg.label);
  const credit = document.querySelector(arg.credit);
  const creditBox = credit === null ? undefined : boxOf(credit);
  const size = boxOf(card);
  return {
    size: { width: size.width, height: size.height },
    target: target === undefined ? undefined : boxOf(target),
    credit: creditBox !== undefined && shown(creditBox) ? creditBox : undefined,
    panels: [...document.querySelectorAll(arg.panels)].map(boxOf).filter(shown),
    missing: arg.want
      .filter((panel) => find(panel.selector, panel.label) === undefined)
      .map((panel) => panel.name),
  };
}

/**
 * In the page: show the measured caption at `box`, at `opacity`, with a
 * leader line from `leader.from` to `leader.to` and a ring round `target`;
 * answers the caption's box as drawn.
 */
function drawOverlay(arg: {
  readonly box: Box;
  readonly opacity: number;
  readonly leader: { readonly from: Point; readonly to: Point } | undefined;
  readonly target: Box | undefined;
}): Box {
  const root = document.getElementById('oyl-capture-overlay');
  const card = root?.querySelector<HTMLElement>('[data-caption]');
  const svg = root?.querySelector('svg');
  if (root === null || root === undefined || card === null || card === undefined || !svg) {
    throw new Error('the capture overlay was not laid out');
  }
  Object.assign(card.style, {
    left: `${String(arg.box.x)}px`,
    top: `${String(arg.box.y)}px`,
    visibility: 'visible',
    opacity: String(arg.opacity),
  });
  const [line, dot, ring] = [...svg.children] as SVGElement[];
  const stroke = {
    stroke: 'var(--oyl-color-hud-ink)',
    'stroke-width': String(Math.max(2, window.innerHeight * 0.003)),
    fill: 'none',
  };
  svg.style.visibility = arg.leader === undefined ? 'hidden' : 'visible';
  svg.style.opacity = String(arg.opacity);
  if (arg.leader !== undefined && arg.target !== undefined && line && dot && ring) {
    const set = (element: SVGElement, attributes: Record<string, string | number>): void => {
      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
      }
    };
    const out = Math.max(3, window.innerHeight * 0.006);
    set(line, {
      ...stroke,
      x1: arg.leader.from.x,
      y1: arg.leader.from.y,
      x2: arg.leader.to.x,
      y2: arg.leader.to.y,
    });
    set(dot, {
      ...stroke,
      fill: 'var(--oyl-color-hud-ink)',
      cx: arg.leader.to.x,
      cy: arg.leader.to.y,
      r: out,
    });
    set(ring, {
      ...stroke,
      x: arg.target.x - out,
      y: arg.target.y - out,
      width: arg.target.width + 2 * out,
      height: arg.target.height + 2 * out,
      rx: out,
    });
  }
  const rect = card.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * In the page: black over the whole frame at `opacity`, under any caption: a
 * scene's fade from and to black (`video-script.ts` §`sceneFade`).
 */
function drawFade(opacity: number): void {
  const ID = 'oyl-capture-fade';
  let fade = document.getElementById(ID);
  if (fade === null) {
    fade = document.createElement('div');
    fade.id = ID;
    fade.setAttribute('aria-hidden', 'true');
    Object.assign(fade.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      background: '#000',
      zIndex: '2147483646',
    });
    document.body.append(fade);
  }
  fade.style.opacity = String(opacity);
}

/** In the page: no caption on this frame. */
function hideOverlay(): void {
  const root = document.getElementById('oyl-capture-overlay');
  if (root !== null) root.style.display = 'none';
}

/**
 * What is wrong with a caption as drawn at `drawn` — the rules, held against
 * the page's own boxes: it covers neither the panel it explains nor the map
 * credit, and (but for a card, which is the frame) it is inside the
 * title-safe area. Half a pixel is let go, for the browser's rounding.
 */
export function drawnProblems(
  drawn: Box,
  measured: Pick<Measured, 'target' | 'credit'>,
  kind: Kind,
  frame: { readonly width: number; readonly height: number },
): string[] {
  const shrunk: Box = {
    x: drawn.x + 0.5,
    y: drawn.y + 0.5,
    width: Math.max(0, drawn.width - 1),
    height: Math.max(0, drawn.height - 1),
  };
  const problems: string[] = [];
  if (measured.target !== undefined && intersects(shrunk, measured.target)) {
    problems.push('covers the panel it explains');
  }
  if (measured.credit !== undefined && intersects(shrunk, measured.credit)) {
    problems.push('covers the map credit');
  }
  if (kind !== 'card' && !inside(shrunk, titleSafe(frame.width, frame.height))) {
    problems.push('is outside the title-safe area');
  }
  return problems;
}

/**
 * #3175: what is wrong with a captioned frame's HUD: a panel its scene's mode
 * draws (`video-script.ts` §`scenePanels`) that is not in the frame, or is
 * faded. A card covers the whole frame, so it is not asked.
 */
export function hudProblems(missing: readonly string[], kind: Kind): string[] {
  if (kind === 'card' || missing.length === 0) return [];
  return [`the HUD does not show ${missing.join(', ')}, drawn and unfaded`];
}

/** Draw `scene`'s caption at `second` of it over the page, or none; throws on a frame that breaks the rules. */
async function drawCaption(
  page: Page,
  scene: VideoScene,
  second: number,
  frame: { readonly width: number; readonly height: number },
  logo: string,
  widths: WeakMap<VideoCaption, number>,
): Promise<void> {
  const shown = captionAt(scene, second);
  if (shown === undefined) {
    await page.evaluate(hideOverlay);
    return;
  }
  const { caption } = shown;
  const where = `capture: scene ${scene.id} at ${second.toFixed(2)} s, “${caption.text}”`;
  const panel: CalloutPanel | undefined =
    caption.callout === undefined ? undefined : CALLOUT_PANELS[caption.callout];
  const kind: Kind = panel === undefined ? (caption.placement ?? 'lower-third') : 'callout';
  if (caption.logo === true) await page.evaluate(installLogo, logo);
  const capture = CAPTURE_SCENES[scene.capture];
  const lines = shownLines(caption);
  const asked = {
    lines,
    selector: panel?.selector,
    label: panel?.label,
    credit: CREDIT_SELECTOR,
    panels: PANEL_SELECTOR,
    logo: caption.logo === true,
    style: overlayStyle(kind, lines.length, caption.lines?.length ?? 0),
    want: (capture === undefined ? [] : scenePanels(capture)).map((name) => {
      const wanted: CalloutPanel = CALLOUT_PANELS[name];
      return { name, selector: wanted.selector, label: wanted.label };
    }),
  };
  // A callout or a lower third that wraps is drawn at the least width that
  // keeps its lines, so they are even and the box holds no empty side. Found
  // once a caption: the words and the frame do not change under it.
  let width = widths.get(caption);
  if (width === undefined && (kind === 'callout' || kind === 'lower-third')) {
    const natural = (await page.evaluate(measureOverlay, asked)).size;
    width = await balancedWidth(
      natural,
      async (at) => (await page.evaluate(measureOverlay, { ...asked, width: at })).size.height,
    );
    widths.set(caption, width);
  }
  const measured = await page.evaluate(measureOverlay, { ...asked, width });
  if (panel !== undefined && measured.target === undefined) {
    throw new Error(`${where}: the ${String(caption.callout)} panel is not in the frame`);
  }
  const hud = hudProblems(measured.missing, kind);
  if (hud.length > 0) throw new Error(`${where}: ${hud.join('; ')}`);
  const place = placeCaption({
    frame,
    size: measured.size,
    placement: kind,
    target: measured.target,
    hard: measured.credit === undefined ? [] : [measured.credit],
    soft: measured.panels,
  });
  if (place === undefined) {
    throw new Error(
      `${where}: no place in the title-safe area is clear of the panel it explains and the map credit`,
    );
  }
  const drawn = await page.evaluate(drawOverlay, {
    box: place.box,
    opacity: shown.opacity,
    leader: place.leader,
    target: measured.target,
  });
  const problems = drawnProblems(drawn, measured, kind, frame);
  if (problems.length > 0) throw new Error(`${where}: ${problems.join('; ')}`);
}

/**
 * The name a video is encoded under until it is whole: beside its own, still
 * ending `.mp4`, as ffmpeg chooses the container from it.
 */
export function partialName(mp4: string): string {
  return mp4.replace(/\.mp4$/u, '.partial.mp4');
}

/** #3223: the file a {@link ScriptMusic} track is, in the app's own `public/`. */
export function musicFile(music: ScriptMusic): string {
  return fileURLToPath(new URL(`../../public/${music.file}`, import.meta.url));
}

/**
 * #3223: mix `music` under the silent `video` into `out` with `ffmpeg`
 * (`capture-args.ts` §`musicMuxArgs`); throws when it fails, so no video
 * is named whole that is not.
 */
export function muxMusic(
  ffmpeg: string,
  video: string,
  music: string,
  seconds: number,
  out: string,
): void {
  const run = spawnSync(ffmpeg, musicMuxArgs(video, music, seconds, out), { encoding: 'utf8' });
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(`capture: mixing the music failed: ${String(run.error ?? run.stderr)}`);
  }
}

/**
 * Give the encoded `partial` its final name `mp4`, only if it holds every
 * frame the script asks for. A render that stopped part-way leaves its
 * partial file, and an earlier whole video under `mp4` stays as it was.
 *
 * #3223: with `mix`, the music is mixed under `partial` first, into a file of
 * its own beside it, and that is what is named `mp4`; a mix that fails leaves
 * `partial` and the earlier `mp4` as they were.
 */
export function finishVideo(
  partial: string,
  mp4: string,
  frames: number,
  expected: number,
  mix?: (video: string, out: string) => void,
): void {
  if (frames !== expected) {
    throw new Error(
      `capture: wrote ${String(frames)} frames, not the script’s ${String(expected)}`,
    );
  }
  if (mix === undefined) {
    renameSync(partial, mp4);
    return;
  }
  const mixed = partial.replace(/\.partial\.mp4$/u, '.mixed.partial.mp4');
  mix(partial, mixed);
  renameSync(mixed, mp4);
  rmSync(partial);
}

/** Render `request`'s script into one MP4, with its `.srt` and chapters beside it. */
export async function renderScript(
  request: ScriptRequest,
  options: ScriptOptions,
): Promise<ScriptResult> {
  const script = VIDEO_SCRIPTS[request.script];
  if (script === undefined) throw new Error(`capture: there is no script ${request.script}`);
  const problems = scriptProblems(script, CAPTURE_SCENES);
  if (problems.length > 0) {
    throw new Error(`capture: the script may not be rendered:\n${problems.join('\n')}`);
  }
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  if (!hasEncoder(encoders(ffmpeg), 'libx264')) {
    throw new Error('capture: this ffmpeg has no libx264, which the H.264 output needs');
  }
  // #3223: the bed is looked for before a frame is rendered, not after.
  const music = request.music === undefined ? undefined : SCRIPT_MUSIC[request.music];
  if (request.music !== undefined && music === undefined) {
    throw new Error(`capture: there is no music ${request.music}`);
  }
  const track = music === undefined ? undefined : musicFile(music);
  if (track !== undefined && !existsSync(track)) {
    throw new Error(`capture: the music file ${track} is not there`);
  }
  mkdirSync(options.out, { recursive: true });
  const mp4 = join(options.out, scriptName(request, '.mp4'));
  const partial = partialName(mp4);
  const frame = { width: request.width, height: request.height };
  const encoder = startEncoder(ffmpeg, captureMp4Args(request.fps, partial));
  const logo = logoDataUrl();
  const widths = new WeakMap<VideoCaption, number>();
  let frames = 0;
  try {
    for (const scene of script.scenes) {
      const from = scene.from ?? 0;
      const edges = {
        first: scene === script.scenes[0],
        last: scene === script.scenes.at(-1),
      };
      const openWorld = CAPTURE_SCENES[scene.capture]?.openWorld === true;
      const result = await renderCapture(
        {
          scene: scene.capture,
          seconds: from + scene.seconds,
          fps: request.fps,
          width: request.width,
          height: request.height,
          out: undefined,
          ...(openWorld ? { start: request.start, archive: request.archive } : {}),
        },
        {
          dist: options.dist,
          // Each scene's event and request logs, by the scene's own name.
          out: join(options.out, `${script.id}-scenes`, scene.id),
          ffmpeg,
          encoder: { into: encoder, mp4: partial },
          skipFrames: from * request.fps,
          beforeShot: async (page, second) => {
            await page.evaluate(drawFade, sceneFade(second - from, scene.seconds, edges));
            await drawCaption(page, scene, second - from, frame, logo, widths);
          },
          onFrame: (at, of) => options.onFrame?.(scene.id, at, of),
        },
      );
      frames += result.frames;
    }
  } catch (error) {
    // The render's own reason, not the encoder's at a cut-off input.
    await encoder.end().catch(() => undefined);
    throw error;
  }
  await encoder.end();
  // The video is every scene, end to end: the captions' times say so.
  const seconds = scriptSeconds(script);
  finishVideo(
    partial,
    mp4,
    frames,
    seconds * request.fps,
    track === undefined
      ? undefined
      : (video, out) => {
          muxMusic(ffmpeg, video, track, seconds, out);
        },
  );
  const srt = join(options.out, scriptName(request, '.srt'));
  writeFileSync(srt, scriptSrt(script));
  const chapters = join(options.out, scriptName(request, '.chapters.txt'));
  writeFileSync(chapters, scriptChapters(script));
  const description = join(options.out, scriptName(request, '.description.txt'));
  writeFileSync(description, scriptDescription(script, music?.credit));
  return { mp4, srt, chapters, description, frames };
}
