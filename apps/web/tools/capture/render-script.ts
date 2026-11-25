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
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { CAPTURE_SCENES } from '../../src/game/capture-scene';
import { encoders, startEncoder } from '../demo/render-video';
import { hasEncoder } from '../demo/video';
import {
  placeCaption,
  inside,
  intersects,
  titleSafe,
  type Box,
  type Point,
} from './caption-layout';
import { captureMp4Args, VIDEO_SCRIPTS, type ScriptRequest } from './capture-args';
import { renderCapture } from './render-capture';
import {
  CALLOUT_PANELS,
  captionAt,
  CREDIT_SELECTOR,
  scriptChapters,
  scriptProblems,
  scriptSeconds,
  scriptSrt,
  shownLines,
  type CalloutPanel,
  type VideoScene,
} from './video-script';

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
  /** Frames written, every scene's. */
  readonly frames: number;
}

/** How a caption is drawn: a callout beside its panel, or its own placement. */
type Kind = 'title' | 'lower-third' | 'callout' | 'card';

/** What {@link measureOverlay} reads off the page. */
export interface Measured {
  readonly size: { readonly width: number; readonly height: number };
  readonly target: Box | undefined;
  readonly credit: Box | undefined;
  readonly panels: readonly Box[];
}

/**
 * In the page: lay the caption's `lines` out, hidden, in the style of `kind`,
 * and measure it, the panel a callout explains, the credit and every panel.
 * Sent to the page as source, so it names nothing outside itself.
 */
function measureOverlay(arg: {
  readonly lines: readonly string[];
  readonly kind: Kind;
  readonly selector: string | undefined;
  readonly label: string | undefined;
  readonly credit: string;
  readonly panels: string;
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
  const title = arg.kind === 'title';
  const whole = arg.kind === 'card';
  card.replaceChildren(
    ...arg.lines.map((line, index) => {
      const p = document.createElement('p');
      p.textContent = line;
      Object.assign(p.style, {
        margin: '0',
        ...(whole && index > 0
          ? { fontFamily: 'inherit', fontSize: '2.2vh', fontWeight: '400', maxWidth: '70%' }
          : {}),
      });
      return p;
    }),
  );
  card.removeAttribute('style');
  Object.assign(card.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    visibility: 'hidden',
    boxSizing: 'border-box',
    background: 'var(--oyl-color-hud-surface)',
    color: 'var(--oyl-color-hud-ink)',
    fontFamily: 'var(--oyl-font-family-display)',
    fontWeight: title ? '800' : '700',
    fontSize: title ? '6.5vh' : whole ? '5.5vh' : arg.kind === 'callout' ? '3.4vh' : '4.2vh',
    lineHeight: '1.2',
    textAlign: arg.kind === 'callout' ? 'left' : 'center',
    borderRadius: whole ? '0' : 'var(--oyl-radius)',
    padding: whole ? '0' : '0.35em 0.7em',
    ...(whole
      ? {
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1.6vh',
        }
      : {
          width: 'max-content',
          maxWidth: title ? '80vw' : arg.kind === 'callout' ? '34vw' : '64vw',
        }),
  });
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
  const target =
    arg.selector === undefined
      ? undefined
      : [...document.querySelectorAll(arg.selector)].find(
          (element) =>
            shown(boxOf(element)) &&
            drawn(element) &&
            (arg.label === undefined ||
              (element.querySelector('.oyl-hud__label')?.textContent ?? '')
                .trim()
                .startsWith(arg.label)),
        );
  const credit = document.querySelector(arg.credit);
  const creditBox = credit === null ? undefined : boxOf(credit);
  const size = boxOf(card);
  return {
    size: { width: size.width, height: size.height },
    target: target === undefined ? undefined : boxOf(target),
    credit: creditBox !== undefined && shown(creditBox) ? creditBox : undefined,
    panels: [...document.querySelectorAll(arg.panels)].map(boxOf).filter(shown),
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

/** Draw `scene`'s caption at `second` of it over the page, or none; throws on a frame that breaks the rules. */
async function drawCaption(
  page: Page,
  scene: VideoScene,
  second: number,
  frame: { readonly width: number; readonly height: number },
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
  const measured = await page.evaluate(measureOverlay, {
    lines: shownLines(caption),
    kind,
    selector: panel?.selector,
    label: panel?.label,
    credit: CREDIT_SELECTOR,
    panels: PANEL_SELECTOR,
  });
  if (panel !== undefined && measured.target === undefined) {
    throw new Error(`${where}: the ${String(caption.callout)} panel is not in the frame`);
  }
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
  mkdirSync(options.out, { recursive: true });
  const mp4 = join(options.out, scriptName(request, '.mp4'));
  const frame = { width: request.width, height: request.height };
  const encoder = startEncoder(ffmpeg, captureMp4Args(request.fps, mp4));
  let frames = 0;
  try {
    for (const scene of script.scenes) {
      const from = scene.from ?? 0;
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
          encoder: { into: encoder, mp4 },
          skipFrames: from * request.fps,
          beforeShot: (page, second) => drawCaption(page, scene, second - from, frame),
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
  const expected = scriptSeconds(script) * request.fps;
  if (frames !== expected) {
    throw new Error(
      `capture: wrote ${String(frames)} frames, not the script’s ${String(expected)}`,
    );
  }
  const srt = join(options.out, scriptName(request, '.srt'));
  writeFileSync(srt, scriptSrt(script));
  const chapters = join(options.out, scriptName(request, '.chapters.txt'));
  writeFileSync(chapters, scriptChapters(script));
  return { mp4, srt, chapters, frames };
}
