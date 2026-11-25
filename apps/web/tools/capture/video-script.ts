// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo video's scene script — #3156, epic #3151.
 *
 * One script is the whole video: its scenes in order, each a capture scene
 * (`src/game/capture-scene.ts`) ridden in the real app for a whole number of
 * seconds, with the captions and HUD callouts drawn over it. From the one
 * script come the video (`render-script.ts`), an `.srt` of every caption
 * ({@link scriptSrt}) and the chapter list for the YouTube description
 * ({@link scriptChapters}). The words live in `scripts/`, one file a script.
 *
 * ## What a script may say: {@link scriptProblems}
 *
 * `capture -- --script` refuses a script with any problem before it renders a
 * frame, and `video-script.test.ts` holds every shipped script to none:
 *
 * - **A caption names a feature only its scene shows** ({@link VideoFeature}):
 *   `delivery`, `lap-race`, `workout`, `junction`, `pacer` and `instance`,
 *   each satisfied only by a capture scene that rides it
 *   ({@link captureSceneShows}). A callout names its panel, and a panel that
 *   only a mode shows carries that mode's feature ({@link CALLOUT_PANELS}).
 * - **No word the project may not use** (`src/demo/caption-words.ts`, the
 *   demo tour's list).
 * - **No instance-only feature but on the closing card**: an AI pacer, AI
 *   bots and the rest exist only on a rider's own instance, which no scene
 *   rides yet (#3155), so only a line of the closing card may name them, and
 *   only as optional and on your own instance ({@link INSTANCE_ONLY_STATEMENT}).
 * - **The epic's timing**: a caption is up for 3 to 6 seconds (a card, up to
 *   10), inside its scene and a second from the next; no scene is under 6 seconds; YouTube's
 *   chapter rules (the first at 0:00, three or more, each 10 s or longer).
 *
 * Where a caption is drawn — clear of the panel it explains and of the map
 * credit, inside the title-safe area — is decided on each frame from the
 * page's own boxes (`caption-layout.ts`), and a frame where it cannot be is
 * refused by the render.
 *
 * Imports the capture scenes, the basemap's credit and the shared word list,
 * so `node` loads it with types stripped (`capture`).
 */

import type { CaptureScene } from '../../src/game/capture-scene';
import { refusedWords } from '../../src/demo/caption-words';
import { ODBL_LICENCE_URL, ODBL_NOTICE, OSM_ATTRIBUTION } from '../../src/map/basemap';
import { SOURCE_CODE_URL } from '../../src/privacy/policy';
import { OSM_COPYRIGHT_URL } from '../demo/route-bundle';

/**
 * What a caption may claim its scene shows — #3156:
 *
 * - `delivery`: a Delivery round on a built-in level, throwing parcels;
 * - `lap-race`: a lap race on a built-in circuit;
 * - `workout`: a built-in workout, its target held;
 * - `junction`: a free ride, choosing a turn at a junction (from the scene's
 *   first scripted turn on);
 * - `pacer`: riding with the pacer;
 * - `instance`: a scene ridden against a self-hosted instance. No capture
 *   scene is yet (#3155 adds them), so every such caption is refused.
 */
export type VideoFeature = 'delivery' | 'lap-race' | 'workout' | 'junction' | 'pacer' | 'instance';

/** A HUD panel a callout points at: how the page finds it, and the feature it shows. */
export interface CalloutPanel {
  /** A CSS selector for the panel. */
  readonly selector: string;
  /** Of the matches, the one whose `.oyl-hud__label` reads this, as the rider reads it. */
  readonly label?: string | undefined;
  /** The mode only a scene of which draws this panel. */
  readonly feature?: VideoFeature | undefined;
}

/**
 * The panels a callout may name. Found by the HUD's own class names and the
 * labels a rider reads, never by position, so a callout follows its panel to
 * wherever the layout puts it at the frame's size.
 */
export const CALLOUT_PANELS = {
  readings: { selector: '.oyl-hud__fields--primary' },
  power: { selector: '.oyl-hud__field', label: 'Power' },
  gradient: { selector: '.oyl-hud__field--gradient' },
  totals: { selector: '.oyl-hud__fields--secondary' },
  calories: { selector: '.oyl-hud__field--calories' },
  elevation: { selector: '.oyl-hud__strips' },
  map: { selector: '.oyl-hud__plan' },
  workout: { selector: '.oyl-workout-strip', feature: 'workout' },
  pacer: { selector: '.oyl-hud__field', label: 'Pacer', feature: 'pacer' },
  best: { selector: '.oyl-hud__field', label: 'Your best', feature: 'pacer' },
  standings: { selector: '.oyl-hud__standings', feature: 'lap-race' },
  // The Item reading, not the Use item button: the button fades with the
  // ride's controls after five seconds with no input (`controls-reveal.ts`).
  item: { selector: '.oyl-hud__field', label: 'Item', feature: 'lap-race' },
  houses: { selector: '.oyl-hud__field', label: 'Houses', feature: 'delivery' },
  throw: { selector: '.oyl-hud__throws', feature: 'delivery' },
  junction: { selector: '.oyl-hud__junction-prompt', feature: 'junction' },
  // #3175: Pause, End ride and the rest, drawn only while not faded.
  controls: { selector: '.oyl-hud__controls' },
} as const satisfies Readonly<Record<string, CalloutPanel>>;

/** A panel's name in {@link CALLOUT_PANELS}. */
export type CalloutPanelName = keyof typeof CALLOUT_PANELS;

/**
 * The panels every riding scene's HUD draws — #3175, the owner's ruling of
 * 2026-11-25: *"make sure the video shows all of the hud"*: the readings in
 * full and the ride's totals, the elevation profile and the map, and the
 * ride's controls, not faded.
 */
export const RIDING_PANELS = [
  'readings',
  'totals',
  'elevation',
  'map',
  'controls',
] as const satisfies readonly CalloutPanelName[];

/**
 * Every panel a frame of `scene` must show, drawn and not faded — #3175:
 * {@link RIDING_PANELS}, and the panels of each mode the scene rides (the
 * workout's strip, the pacer's and the best ride's readings, the race's
 * standings and item, the round's houses and throws). The render stops on a
 * captioned frame where one is missing (`render-script.ts`).
 *
 * Two are left out by design, not by the capture: a workout's strip is drawn
 * in the map's place in the route panel (#1307, `HudCore.tsx`
 * §`routeFigure`), so a workout has the strip and no map; and the junction's
 * prompt is drawn only as a junction comes up.
 */
export function scenePanels(scene: CaptureScene): CalloutPanelName[] {
  const panels: CalloutPanelName[] = RIDING_PANELS.filter(
    (panel) => scene.workout === undefined || panel !== 'map',
  );
  if (scene.workout !== undefined) panels.push('workout');
  if (scene.pacer !== undefined) panels.push('pacer');
  if (scene.ghost === true) panels.push('best');
  if (captureSceneShows('lap-race', scene, 0)) panels.push('standings', 'item');
  if (captureSceneShows('delivery', scene, 0)) panels.push('houses', 'throw');
  return panels;
}

/** The map credit, which no caption may cover. */
export const CREDIT_SELECTOR = '.oyl-hud__attribution';

/** One caption, timed from its scene's first frame. */
export interface VideoCaption {
  /** When it starts fading in, in seconds of the scene. */
  readonly at: number;
  /** How long it is on screen, fades included. */
  readonly seconds: number;
  readonly text: string;
  /**
   * - `title`: centred above the middle, under the project's logo when it
   *   has {@link logo};
   * - `lower-third`: low in the frame (the default);
   * - `card`: over the whole frame, opaque, with the map credit and the
   *   project's address under the words ({@link cardLines}): the closing card.
   *
   * A caption with a {@link callout} is drawn beside its panel instead.
   */
  readonly placement?: 'title' | 'lower-third' | 'card' | undefined;
  /** The HUD panel the caption explains, with a leader line to it. */
  readonly callout?: CalloutPanelName | undefined;
  /**
   * #3175: draw the project's logo above a `title`'s or a `card`'s words,
   * centred, no larger than its own pixels so it is sharp
   * (`render-script.ts`). Only a title or a card has it.
   */
  readonly logo?: boolean | undefined;
  /** The feature the caption claims, which its scene must show. */
  readonly feature?: VideoFeature | undefined;
  /**
   * A `card`'s or a `title`'s statements under its words — for a card,
   * before the credit: what it says of the product as a whole, not of a
   * scene, such as the platforms it runs on (#3175). Only a card or a title
   * has them, and only the closing card may state an instance-only feature,
   * worded as {@link INSTANCE_ONLY_STATEMENT} ({@link instanceOnlyProblem}).
   */
  readonly lines?: readonly string[] | undefined;
}

/** One scene of the video: part of a capture scene's ride, and its captions. */
export interface VideoScene {
  /** Lowercase letters, digits and hyphens, unique in its script. */
  readonly id: string;
  /** The capture scene ridden: a name in `CAPTURE_SCENES`. */
  readonly capture: string;
  /** Seconds of the ride before the scene's first frame: stepped and drawn, not written. */
  readonly from?: number | undefined;
  /** How long the scene is: a whole number of seconds, {@link SCENE_MIN_SECONDS} or more. */
  readonly seconds: number;
  /** Starts a chapter of this name; a scene without one runs on in the last. */
  readonly chapter?: string | undefined;
  readonly captions: readonly VideoCaption[];
}

/** A whole video. */
export interface VideoScript {
  readonly id: string;
  readonly scenes: readonly VideoScene[];
}

/** A caption's shortest and longest time on screen: the epic's 3 to 6 seconds. */
export const CAPTION_MIN_SECONDS = 3;
export const CAPTION_MAX_SECONDS = 6;
/** The least time between two captions of a scene, so each is seen on its own. */
export const CAPTION_GAP_SECONDS = 1;
/** Each caption's fade in and out: the epic's half second. */
export const FADE_SECONDS = 0.5;
/**
 * The longest a `card` is up: it carries the platforms, the project's address
 * and the map credit, which six seconds do not give a viewer time to find.
 */
export const CARD_MAX_SECONDS = 10;
/**
 * Each scene's fade from black and to black — #3175's review. Every scene
 * frames the rider alike, so a hard cut between two reads as a glitch in one
 * ride, not as a new scene; a short dip through black says it is one.
 */
export const SCENE_FADE_SECONDS = 0.4;
/** The shortest scene: the epic's "no scene is under 6 s". */
export const SCENE_MIN_SECONDS = 6;
/** YouTube's shortest chapter, and fewest chapters, for a chapter list to be read as one. */
export const CHAPTER_MIN_SECONDS = 10;
export const CHAPTERS_MIN = 3;

/**
 * Whether `scene` shows `feature`, read from what the capture scene rides
 * (`capture-scene.ts`): a scene that does not ride a mode cannot show it.
 */
export function captureSceneShows(feature: VideoFeature, scene: CaptureScene, at: number): boolean {
  switch (feature) {
    case 'delivery':
      return (
        scene.route?.id?.startsWith('level:') === true &&
        (scene.cues ?? []).some((cue) => cue.kind === 'throw')
      );
    case 'lap-race':
      return scene.lapRace !== undefined && scene.route?.id?.startsWith('circuit:') === true;
    case 'workout':
      return scene.workout !== undefined;
    case 'junction': {
      // From the first scripted turn on: before it, no turn has been chosen.
      const turn = (scene.cues ?? []).find((cue) => cue.kind === 'turn');
      return scene.openWorld === true && turn !== undefined && at >= turn.second;
    }
    case 'pacer':
      return scene.pacer !== undefined;
    case 'instance':
      // #3155: no capture scene rides an instance yet.
      return false;
  }
}

/**
 * The features a caption claims: its own, and its panel's. Both are held to
 * the scene, so a caption's own claim cannot stand in for the mode its
 * callout's panel needs.
 */
function claimed(caption: VideoCaption): VideoFeature[] {
  const panel =
    caption.callout === undefined
      ? undefined
      : (CALLOUT_PANELS[caption.callout] as CalloutPanel).feature;
  return [...new Set([caption.feature, panel])].filter(
    (feature): feature is VideoFeature => feature !== undefined,
  );
}

/**
 * Words that name a feature only a self-hosted instance runs: an AI pacer,
 * AI bots, the AI write-up (ADR 0046), the instance itself. No capture scene
 * rides an instance (#3155), so no scene's caption may say them.
 */
const INSTANCE_ONLY_WORDS = /\bAI\b|\binstances?\b/iu;

/**
 * How the closing card states the instance-only features, which exist but
 * are not filmed: optional, and on the rider's own instance (owner ruling of
 * 2026-11-25 on #3174).
 */
export const INSTANCE_ONLY_STATEMENT = /^Optional on your own instance: /u;

/**
 * Why `text` may not be shown where it is, if it names an instance-only
 * feature: only a statement on the script's closing card may, and only worded
 * as {@link INSTANCE_ONLY_STATEMENT}.
 */
function instanceOnlyProblem(text: string, onClosingCard: boolean): string | undefined {
  if (!INSTANCE_ONLY_WORDS.test(text)) return undefined;
  if (!onClosingCard) {
    return 'names a feature only an instance runs, which only the closing card may state';
  }
  return INSTANCE_ONLY_STATEMENT.test(text)
    ? undefined
    : 'names a feature only an instance runs, so the card says “Optional on your own instance:”';
}

/** Everything wrong with `script`, a sentence each; none for a script that may be rendered. */
export function scriptProblems(
  script: VideoScript,
  scenes: Readonly<Record<string, CaptureScene>>,
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  if (script.scenes.length === 0) problems.push(`${script.id} has no scenes`);
  const closing = script.scenes.at(-1);
  for (const scene of script.scenes) {
    const where = `${script.id} scene ${scene.id}`;
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(scene.id)) {
      problems.push(`${where}: a scene’s id is lowercase letters, digits and hyphens`);
    }
    if (ids.has(scene.id)) problems.push(`${where}: the id is used twice`);
    ids.add(scene.id);
    if (!(Number.isInteger(scene.seconds) && scene.seconds >= SCENE_MIN_SECONDS)) {
      problems.push(
        `${where}: a scene is a whole number of seconds, ${String(SCENE_MIN_SECONDS)} or more, not ${String(scene.seconds)}`,
      );
    }
    const from = scene.from ?? 0;
    if (!(Number.isInteger(from) && from >= 0)) {
      problems.push(`${where}: from is a whole number of seconds, not ${String(from)}`);
    }
    const capture = Object.hasOwn(scenes, scene.capture) ? scenes[scene.capture] : undefined;
    if (capture === undefined) {
      problems.push(`${where}: there is no capture scene ${scene.capture}`);
      continue;
    }
    const captions = [...scene.captions].sort((a, b) => a.at - b.at);
    captions.forEach((caption, index) => {
      const said = `${where}, “${caption.text}”`;
      const end = caption.at + caption.seconds;
      if (caption.text.trim() === '') problems.push(`${where}: a caption says nothing`);
      if (!(caption.at >= 0 && end <= scene.seconds)) {
        problems.push(`${said}: runs outside its scene’s ${String(scene.seconds)} seconds`);
      }
      const longest = caption.placement === 'card' ? CARD_MAX_SECONDS : CAPTION_MAX_SECONDS;
      if (!(caption.seconds >= CAPTION_MIN_SECONDS && caption.seconds <= longest)) {
        problems.push(
          `${said}: is up for ${String(caption.seconds)} seconds, not ${String(CAPTION_MIN_SECONDS)} to ${String(longest)}`,
        );
      }
      const next = captions[index + 1];
      if (next !== undefined && next.at - end < CAPTION_GAP_SECONDS) {
        problems.push(`${said}: is less than ${String(CAPTION_GAP_SECONDS)} second from the next`);
      }
      if (caption.callout !== undefined && !Object.hasOwn(CALLOUT_PANELS, caption.callout)) {
        problems.push(`${said}: there is no HUD panel ${caption.callout}`);
        return;
      }
      if (caption.callout !== undefined && caption.placement !== undefined) {
        problems.push(`${said}: a callout is drawn beside its panel, so it has no placement`);
      }
      if (
        caption.lines !== undefined &&
        caption.placement !== 'card' &&
        caption.placement !== 'title'
      ) {
        problems.push(`${said}: only a card or a title has lines under its words`);
      }
      if (caption.logo === true && caption.placement !== 'title' && caption.placement !== 'card') {
        problems.push(`${said}: only a title or a card is drawn under the logo`);
      }
      const onClosingCard = scene === closing && caption.placement === 'card';
      for (const text of [caption.text, ...(caption.lines ?? [])]) {
        const refused = refusedWords(text);
        if (refused !== undefined) problems.push(`${where}, “${text}”: may not say “${refused}”`);
        const instanceOnly = instanceOnlyProblem(text, onClosingCard && text !== caption.text);
        if (instanceOnly !== undefined) problems.push(`${where}, “${text}”: ${instanceOnly}`);
      }
      for (const feature of claimed(caption)) {
        if (!captureSceneShows(feature, capture, from + caption.at)) {
          problems.push(`${said}: claims ${feature}, which the scene does not show`);
        }
      }
    });
  }
  problems.push(...chapterProblems(script));
  return problems;
}

/** A chapter: where it starts in the video, in seconds, and its title. */
export interface Chapter {
  readonly at: number;
  readonly title: string;
}

/** The script's chapters, in order: each scene that names one starts one. */
export function chapters(script: VideoScript): Chapter[] {
  const found: Chapter[] = [];
  let at = 0;
  for (const scene of script.scenes) {
    if (scene.chapter !== undefined) found.push({ at, title: scene.chapter });
    at += scene.seconds;
  }
  return found;
}

/** A script's length: its scenes' seconds, end to end. */
export function scriptSeconds(script: VideoScript): number {
  return script.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
}

function chapterProblems(script: VideoScript): string[] {
  const problems: string[] = [];
  const list = chapters(script);
  if (script.scenes.length > 0 && script.scenes[0]?.chapter === undefined) {
    problems.push(
      `${script.id}: the first scene starts no chapter, and YouTube’s first is at 0:00`,
    );
  }
  if (list.length < CHAPTERS_MIN) {
    problems.push(
      `${script.id}: ${String(list.length)} chapters, and YouTube reads ${String(CHAPTERS_MIN)} or more`,
    );
  }
  list.forEach((chapter, index) => {
    const end = list[index + 1]?.at ?? scriptSeconds(script);
    if (end - chapter.at < CHAPTER_MIN_SECONDS) {
      problems.push(
        `${script.id} chapter “${chapter.title}”: ${String(end - chapter.at)} seconds, and YouTube’s are ${String(CHAPTER_MIN_SECONDS)} or more`,
      );
    }
  });
  return problems;
}

/**
 * The lines a `card` caption carries under its own words: the map credit,
 * ODbL §4.3's notice and the addresses it asks for, written out since a video
 * cannot link (ADR 0056 D-8.3, as the demo's closing card), and the project's
 * address.
 */
export function cardLines(): readonly string[] {
  return [
    `Map data ${OSM_ATTRIBUTION}`,
    ODBL_NOTICE,
    `OpenStreetMap: ${OSM_COPYRIGHT_URL}`,
    `Open Database License: ${ODBL_LICENCE_URL}`,
    `On Your Left: ${SOURCE_CODE_URL}`,
  ];
}

/** What a caption shows on the frame, line by line. */
export function shownLines(caption: VideoCaption): readonly string[] {
  return caption.placement === 'card'
    ? [caption.text, ...(caption.lines ?? []), ...cardLines()]
    : [caption.text, ...(caption.lines ?? [])];
}

/** A caption on screen: which, and how opaque it is now. */
export interface ShownCaption {
  readonly caption: VideoCaption;
  /** From just above 0 to 1. */
  readonly opacity: number;
}

/**
 * The caption on screen at `second` of `scene`, if any, with its fade.
 *
 * A frame is taken at the end of its own time (`render-capture.ts` passes
 * `frame / fps`), so a scene's last frame is at its last second exactly. A
 * card that ends its scene therefore holds, with no fade out, up to and
 * including that second: the closing card is the video's last frame.
 */
export function captionAt(scene: VideoScene, second: number): ShownCaption | undefined {
  for (const caption of scene.captions) {
    const end = caption.at + caption.seconds;
    const holds = caption.placement === 'card' && end === scene.seconds;
    if (second < caption.at || second > end || (second === end && !holds)) continue;
    const opacity = Math.min(
      1,
      (second - caption.at) / FADE_SECONDS,
      holds ? 1 : (end - second) / FADE_SECONDS,
    );
    if (opacity <= 0) continue;
    return { caption, opacity };
  }
  return undefined;
}

/**
 * How black the frame at `second` of a scene `seconds` long is, from 0 to 1:
 * each scene fades from black and to black over {@link SCENE_FADE_SECONDS}.
 * The video's `last` scene does not fade out — its closing card is the last
 * frame — and its `first` fades in like any other.
 */
export function sceneFade(
  second: number,
  seconds: number,
  edges: { readonly first: boolean; readonly last: boolean },
): number {
  const fromBlack = 1 - second / SCENE_FADE_SECONDS;
  const toBlack = edges.last ? 0 : 1 - (seconds - second) / SCENE_FADE_SECONDS;
  return Math.min(1, Math.max(0, fromBlack, toBlack));
}

/** `seconds` as an SRT time, `HH:MM:SS,mmm`. */
export function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

/** Every caption of `script` as SubRip text, timed in the whole video. */
export function scriptSrt(script: VideoScript): string {
  const cues: string[] = [];
  let start = 0;
  for (const scene of script.scenes) {
    for (const caption of [...scene.captions].sort((a, b) => a.at - b.at)) {
      const from = start + caption.at;
      cues.push(
        `${String(cues.length + 1)}\n${srtTime(from)} --> ${srtTime(from + caption.seconds)}\n${shownLines(caption).join('\n')}\n`,
      );
    }
    start += scene.seconds;
  }
  return cues.join('\n');
}

/** `seconds` as a YouTube chapter time: `M:SS`, or `H:MM:SS` from an hour. */
export function chapterTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const ss = String(whole % 60).padStart(2, '0');
  return minutes >= 60
    ? `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}:${ss}`
    : `${String(minutes)}:${ss}`;
}

/** The chapter list for the video's description: `0:00 Title`, a line each. */
export function scriptChapters(script: VideoScript): string {
  return chapters(script)
    .map((chapter) => `${chapterTime(chapter.at)} ${chapter.title}\n`)
    .join('');
}
