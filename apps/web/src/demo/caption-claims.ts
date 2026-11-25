// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a caption script may claim — #3074.
 *
 * {@link captionScriptProblems} says, in a sentence each, everything wrong
 * with a script (`caption-script.ts`). `caption-claims.test.ts` holds every
 * shipped script to none, in the ordinary suite, and `demo:video:check`
 * holds the script it renders to none before it renders.
 *
 * - **A caption naming a feature is in a scene that shows it.** `climb` is
 *   checked by riding the scene's preset on its own road, through the same
 *   runner the page rides (`runner.ts`), and reading the gradient under the
 *   lead rider for the caption's whole time. `group` needs two riders or
 *   more in the frame for the caption's whole time, the scene shot by its
 *   camera tour and each rider projected through the renderer's lens
 *   ({@link fewestRidersInFrame}): a preset of four riders shot from behind
 *   its lead shows one. `map-data` needs a scene that rides the render's baked route; the
 *   page then draws it only when map data was given.
 * - **No word the project may not use**: the load-metric trademarks
 *   (CLAUDE.md section 6), a competitor's name, and the accuracy and fit
 *   claims ADR 0030 R6 rules out.
 * - **Readable, and checkable**: a caption is up for at least
 *   {@link CAPTION_MIN_SECONDS}, inside its scene, and at least
 *   {@link CAPTION_GAP_SECONDS} from the next, so a render at one frame a
 *   second has a frame without it on each side.
 */

import { seconds } from '@onyourleft/domain';

import { inFrame, projectThrough } from './camera-tour-testing';
import type { CaptionFeature, CaptionScene, CaptionScript } from './caption-script';
import { DEFAULT_FADE_SECONDS } from './caption-script';
import { createDemoPlayer } from './player';
import { DEMO_PRESETS } from './presets';
import { createDemoRide, demoRoad } from './runner';
import type { DemoPreset } from './script';
import { CAPTION_MIN_SECONDS } from './showcase';

/** The least time between two captions of one scene. */
export const CAPTION_GAP_SECONDS = 1;

/** The gradient a `climb` caption needs under the lead rider for its whole time. */
export const CLIMB_GRADE_PERCENT = 6;

/** How often a ridden check samples the ride. */
const SAMPLE_SECONDS = 0.25;

/**
 * Whole words a caption may not say, matched as written: the load-metric
 * trademarks (CLAUDE.md section 6).
 */
const TRADEMARK_WORDS = ['NP', 'TSS', 'IF', 'CTL', 'ATL', 'TSB'] as const;

/**
 * Phrases a caption may not say, in any case: the metrics' long names,
 * competitors' names, and ADR 0030 R6's claims.
 */
const REFUSED_PHRASES = [
  'normalized power',
  'normalised power',
  'training stress score',
  'intensity factor',
  'strava',
  'zwift',
  'peloton',
  'trainerroad',
  'rouvy',
  'mywhoosh',
  'fulgaz',
  'bkool',
  'komoot',
  'validated',
  'accurate to',
  'professional fit',
] as const;

/** Whether the lead rider of `preset`, on its own road, is on a climb from `from` to `to`. */
function climbsThroughout(preset: DemoPreset, from: number, to: number): boolean {
  const ride = createDemoRide(preset, demoRoad(preset.route));
  for (let at = SAMPLE_SECONDS; at <= to; at += SAMPLE_SECONDS) {
    const frame = ride.sample(seconds(at));
    if (at >= from && (frame.riders[0]?.grade ?? 0) < CLIMB_GRADE_PERCENT) return false;
  }
  return true;
}

/** The frame's shape a video is rendered in: 16 : 9. */
const VIDEO_ASPECT = 16 / 9;

/** The barest scenery: what is checked is where the riders are, not what is around them. */
const BARE = { scatterItems: 0, structureItems: 0, people: 0 } as const;

/**
 * How many of `preset`'s riders the camera frames, at the fewest, from `from`
 * to `to`: the scene ridden by the player the page rides (`player.ts`), shot
 * by its camera tour, each rider's hips projected through the renderer's own
 * lens (`camera-tour-testing.ts`) into a 16 : 9 frame.
 */
export function fewestRidersInFrame(preset: DemoPreset, from: number, to: number): number {
  const player = createDemoPlayer(preset);
  player.play();
  let fewest = Infinity;
  for (let at = 0; at <= to; at += SAMPLE_SECONDS) {
    player.advance(at * 1000);
    if (at < from) continue;
    const frame = player.frame(BARE);
    const framed = frame.markers.filter((marker) =>
      inFrame(
        projectThrough(frame.camera, { x: marker.x, y: marker.y + 1, z: marker.z }, VIDEO_ASPECT),
      ),
    ).length;
    fewest = Math.min(fewest, framed);
  }
  return fewest;
}

function featureShown(
  feature: CaptionFeature,
  scene: CaptionScene,
  preset: DemoPreset,
  from: number,
  to: number,
): boolean {
  switch (feature) {
    case 'map-data':
      return scene.route === true;
    case 'group':
      return fewestRidersInFrame(preset, from, to) >= 2;
    case 'climb':
      return climbsThroughout(preset, from, to);
  }
}

/** Why `text` may not be said, if it may not. */
function refusedWords(text: string): string | undefined {
  for (const word of TRADEMARK_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return word;
  }
  const lower = text.toLowerCase();
  return REFUSED_PHRASES.find((phrase) => lower.includes(phrase));
}

/** Everything wrong with `script`, a sentence each; none for a script that may be rendered. */
export function captionScriptProblems(script: CaptionScript): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  if (script.scenes.length === 0) problems.push(`${script.id} has no scenes`);
  for (const scene of script.scenes) {
    const where = `${script.id} scene ${scene.id}`;
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(scene.id)) {
      problems.push(`${where}: a scene’s id is lowercase letters, digits and hyphens`);
    }
    if (ids.has(scene.id)) problems.push(`${where}: the id is used twice`);
    ids.add(scene.id);
    if (!(Number.isInteger(scene.seconds) && scene.seconds > 0)) {
      problems.push(`${where}: a scene is a whole number of seconds, not ${scene.seconds}`);
    }
    const preset = DEMO_PRESETS.find((each) => each.id === scene.preset);
    if (preset === undefined) {
      problems.push(`${where}: there is no preset ${scene.preset}`);
      continue;
    }
    const captions = [...scene.captions].sort((a, b) => a.at - b.at);
    captions.forEach((caption, index) => {
      const said = `${where}, “${caption.text}”`;
      const end = caption.at + caption.seconds;
      if (caption.text.trim() === '') problems.push(`${where}: a caption says nothing`);
      if (!(caption.at >= 0 && end <= scene.seconds)) {
        problems.push(`${said}: runs outside its scene’s ${scene.seconds} seconds`);
      }
      if (!(caption.seconds >= CAPTION_MIN_SECONDS)) {
        problems.push(`${said}: is up for under ${CAPTION_MIN_SECONDS} seconds`);
      }
      const fade = caption.fadeSeconds ?? DEFAULT_FADE_SECONDS;
      if (!(fade >= 0 && fade * 2 <= caption.seconds)) {
        problems.push(`${said}: its fades are longer than it is`);
      }
      const next = captions[index + 1];
      if (next !== undefined && next.at - end < CAPTION_GAP_SECONDS) {
        problems.push(`${said}: is less than ${CAPTION_GAP_SECONDS} second from the next`);
      }
      const refused = refusedWords(caption.text);
      if (refused !== undefined) problems.push(`${said}: may not say “${refused}”`);
      if (
        caption.feature !== undefined &&
        !featureShown(caption.feature, scene, preset, caption.at, end)
      ) {
        problems.push(`${said}: claims ${caption.feature}, which the scene does not show`);
      }
    });
  }
  return problems;
}
