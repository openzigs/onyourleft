// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Captioned feature tours for the demo video — #3074.
 *
 * A caption script is a list of **scenes**, each a preset ridden from ride
 * time zero for a whole number of seconds, and each with the captions drawn
 * over it. The words live in `apps/web/demo/captions/`, one file a script, so
 * they can be edited without touching code; this module says what a script
 * is and when each caption is on screen.
 *
 * ## Drawn by the page, captured in the frame
 *
 * The page draws a scene's captions when asked with
 * `?captions=<script>&scene=<id>` (`query.ts`), over the stage, from the
 * HUD's own ride clock. The video render (`tools/demo/render-video.ts`) opens
 * each scene in turn and screenshots it, so a caption is in the same pixels as
 * the world and the HUD: no `ffmpeg` filter, and no new dependency. Opened
 * without `?render`, the same page previews a scene's captions live.
 *
 * ## A caption fades in and out — or cuts, under reduced motion
 *
 * {@link captionAt} is a closed-form function of the scene and the ride time:
 * a caption is absent before its `at` and from `at + seconds` on, and between
 * them its opacity rises over its fade and falls over its last. A render takes
 * reduced motion as not asked for (`main.tsx`), so a video fades; a visitor
 * who asked for it is shown each caption whole, for its whole time.
 *
 * ## A caption names the feature it claims, and the scene has to show it
 *
 * `caption-claims.ts` refuses a script whose caption names a feature its scene
 * does not show, rides the scene to check a climb, and refuses the words the
 * project may not use. `map-data` is the one feature only a run can know: the
 * page draws such a caption only when the run was given a baked route's map
 * data, so a render on the synthetic road leaves it out rather than claim it.
 *
 * Imports the scripts' words and types alone, so `node` loads it with types
 * stripped (`demo:video`).
 */

import { YOUTUBE_CAPTIONS } from '../../demo/captions/youtube';
import type { DemoPresetId } from './script';

/**
 * What a caption may claim the scene shows:
 *
 * - `map-data` — the scene is ridden on a baked route's map data;
 * - `climb` — the lead rider is on a climb for the caption's whole time;
 * - `group` — the scene's preset rides more than one rider.
 */
export type CaptionFeature = 'map-data' | 'climb' | 'group';

/** Where a caption is drawn: a centred title, or a lower third. */
export type CaptionPlacement = 'title' | 'lower-third';

/** One caption, timed from its scene's start. */
export interface Caption {
  /** When it starts fading in, in seconds of the scene. */
  readonly at: number;
  /** How long it is on screen, fades included. */
  readonly seconds: number;
  readonly text: string;
  /** A lower third unless it says otherwise. */
  readonly placement?: CaptionPlacement;
  /** How long each fade takes; {@link DEFAULT_FADE_SECONDS} unless it says otherwise. */
  readonly fadeSeconds?: number;
  /** The feature the caption claims, which its scene must show. */
  readonly feature?: CaptionFeature;
}

/** One scene: a preset ridden from its start, and its captions. */
export interface CaptionScene {
  /** A lowercase name, unique in its script: the page's `?scene=`. */
  readonly id: string;
  readonly preset: DemoPresetId;
  /** How long the scene is ridden: a whole number of seconds. */
  readonly seconds: number;
  /**
   * Whether the scene rides the baked route a render is given (`--route`).
   * Every other scene rides its preset's own road, so what its captions claim
   * about that road holds whatever route the video was asked for.
   */
  readonly route?: true;
  readonly captions: readonly Caption[];
}

/** A whole captioned tour: its scenes, in order. */
export interface CaptionScript {
  readonly id: string;
  readonly scenes: readonly CaptionScene[];
}

/** A fade's length when a caption names none. */
export const DEFAULT_FADE_SECONDS = 0.5;

/** Every caption script, by the name `?captions=` and `demo:video --preset` take. */
export const CAPTION_SCRIPTS = { youtube: YOUTUBE_CAPTIONS } as const;

/** A script's name. */
export type CaptionScriptId = keyof typeof CAPTION_SCRIPTS;

/** Whether `name` is a script's. */
export function isCaptionScriptId(name: string): name is CaptionScriptId {
  return Object.hasOwn(CAPTION_SCRIPTS, name);
}

/** A script's length: its scenes' seconds, end to end. */
export function scriptSeconds(script: CaptionScript): number {
  return script.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
}

/** A caption on screen: what it says, where, and how opaque it is now. */
export interface ShownCaption {
  readonly text: string;
  readonly placement: CaptionPlacement;
  /** From just above 0 to 1. */
  readonly opacity: number;
}

/**
 * The caption on screen at `seconds` of `scene`, if any. A caption whose
 * feature the run cannot show (`shows`) is never drawn.
 */
export function captionAt(
  scene: CaptionScene,
  seconds: number,
  options: {
    readonly reducedMotion: boolean;
    readonly shows: (feature: CaptionFeature) => boolean;
  },
): ShownCaption | undefined {
  for (const caption of scene.captions) {
    const end = caption.at + caption.seconds;
    if (seconds < caption.at || seconds >= end) continue;
    if (caption.feature !== undefined && !options.shows(caption.feature)) continue;
    const fade = caption.fadeSeconds ?? DEFAULT_FADE_SECONDS;
    const opacity =
      options.reducedMotion || fade <= 0
        ? 1
        : Math.min(1, (seconds - caption.at) / fade, (end - seconds) / fade);
    if (opacity <= 0) continue;
    return { text: caption.text, placement: caption.placement ?? 'lower-third', opacity };
  }
  return undefined;
}

/** Where one caption falls in a render, in frames from the video's first. */
export interface CaptionFrames {
  readonly scene: string;
  readonly text: string;
  readonly placement: CaptionPlacement;
  readonly feature: CaptionFeature | undefined;
  /** The scene's first frame. */
  readonly sceneFrame: number;
  /** The last frame before the caption starts, if the scene has one. */
  readonly before: number | undefined;
  /** A frame in the middle of its time, where it is whole. */
  readonly middle: number;
  /** The first frame after it ends, if the scene has one. */
  readonly after: number | undefined;
}

/**
 * Each caption's frames in a render of `script` at `fps`, frame `n` of a scene
 * being its ride at `n / fps` seconds (`render-clock.ts`). What the video's
 * checks read the pixels at.
 */
export function captionFrames(script: CaptionScript, fps: number): CaptionFrames[] {
  const found: CaptionFrames[] = [];
  let sceneFrame = 0;
  for (const scene of script.scenes) {
    const frames = Math.round(scene.seconds * fps);
    for (const caption of scene.captions) {
      const before = Math.ceil(caption.at * fps) - 1;
      const after = Math.ceil((caption.at + caption.seconds) * fps);
      found.push({
        scene: scene.id,
        text: caption.text,
        placement: caption.placement ?? 'lower-third',
        feature: caption.feature,
        sceneFrame,
        before: before >= 0 ? sceneFrame + before : undefined,
        middle: sceneFrame + Math.round((caption.at + caption.seconds / 2) * fps),
        after: after < frames ? sceneFrame + after : undefined,
      });
    }
    sceneFrame += frames;
  }
  return found;
}
