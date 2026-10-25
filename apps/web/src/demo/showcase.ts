// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's feature-showcase timeline — #1653: a declarative script of
 * moments that switch the product's features on and off while the group
 * rides, each one captioned.
 *
 * ## A timeline is data, and its state is a function of ride time
 *
 * {@link SHOWCASE_TIMELINE} is a list of {@link Cue}s at ride seconds.
 * {@link showcaseAt} reads it at one ride time and says what should be on —
 * the world, the season's date, people, countryside, the caption — and which
 * cues have fired and which were skipped. It holds no state and reads no
 * clock, so a pass of the timeline on the same stepped clock fires the same
 * cues at the same frames every time, and a second pass is the first again
 * (`showcase.test.ts`). `stage.ts` applies the state to the renderer; what the
 * page publishes is read back from the renderer and the frame it drew, never
 * from here.
 *
 * ## The shots are the camera tour
 *
 * The `shot` cues become the tour `camera-tour.ts` directs
 * ({@link showcaseShots}), so a shot cue reaches the camera through the same
 * director as a preset's tour, and reduced motion makes every move a cut there
 * (`reducedMotionTour`), not here.
 *
 * ## A feature that is not there is skipped, honestly
 *
 * A cue that needs a feature names it ({@link ShowcaseFeature}). A feature is
 * there when its module is (`showcase-features.ts`), and, for the realistic
 * world and the countryside, when this run can draw it: the realistic world
 * loaded and not left, map data given (#1542's changes read only mapped land).
 * A cue for a missing feature is never faked: it changes nothing, it is listed
 * in `__oylDemo.skipped`, and every caption that names the feature is
 * suppressed. When a feature lands, its cue is switched on by one line here.
 */

import type { ShotKind, TourShot, Transition } from './camera-tour';

/** The product features a showcase moment can need. */
export type ShowcaseFeature = 'realistic' | 'season' | 'people' | 'countryside';

/** One moment of the timeline, at ride second `at`. */
export type Cue =
  | { readonly at: number; readonly kind: 'world'; readonly world: 'stylised' | 'realistic' }
  /** A fixed day, `YYYY-MM-DD` — never the viewer's clock — or `none` for no season. */
  | { readonly at: number; readonly kind: 'season'; readonly date: string }
  | { readonly at: number; readonly kind: 'people'; readonly on: boolean }
  | { readonly at: number; readonly kind: 'countryside'; readonly on: boolean }
  | {
      readonly at: number;
      readonly kind: 'shot';
      readonly shot: ShotKind;
      readonly into: Transition;
    }
  | {
      readonly at: number;
      readonly kind: 'caption';
      readonly text: string;
      readonly seconds: number;
      /** The feature the caption names: suppressed when it was skipped. */
      readonly feature?: ShowcaseFeature;
    };

/** A whole timeline: its cues, and its length, after which it starts again from 0. */
export interface ShowcaseTimeline {
  readonly cues: readonly Cue[];
  readonly seconds: number;
}

/** The shortest a caption is shown: long enough to be read (#1653). */
export const CAPTION_MIN_SECONDS = 3;

/** `season`'s date for no season: no holiday and no autumn or winter. */
export const NO_SEASON_DATE = 'none';

/**
 * The showcase, ridden by the `group` preset (#1646) so the last moment is a
 * group. Every switch is set at 0, so each pass starts from the same world.
 */
export const SHOWCASE_TIMELINE: ShowcaseTimeline = {
  seconds: 72,
  cues: [
    { at: 0, kind: 'world', world: 'stylised' },
    { at: 0, kind: 'season', date: NO_SEASON_DATE },
    { at: 0, kind: 'people', on: false },
    { at: 0, kind: 'countryside', on: false },
    { at: 0, kind: 'shot', shot: 'behind', into: 'cut' },
    { at: 0.5, kind: 'caption', text: 'The stylised world', seconds: 4 },
    { at: 7, kind: 'world', world: 'realistic' },
    {
      at: 7.5,
      kind: 'caption',
      text: 'And the realistic world',
      seconds: 4,
      feature: 'realistic',
    },
    { at: 15, kind: 'shot', shot: 'overhead', into: 'blend' },
    { at: 16, kind: 'countryside', on: true },
    {
      at: 16.5,
      kind: 'caption',
      text: 'Countryside planted by what the map says the land is',
      seconds: 5,
      feature: 'countryside',
    },
    { at: 25, kind: 'shot', shot: 'behind', into: 'blend' },
    { at: 26, kind: 'people', on: true },
    {
      at: 26.5,
      kind: 'caption',
      text: 'People on the pavements and paths',
      seconds: 4,
      feature: 'people',
    },
    { at: 34, kind: 'season', date: '2026-10-31' },
    {
      at: 34.5,
      kind: 'caption',
      text: 'The season from the date: Halloween',
      seconds: 4,
      feature: 'season',
    },
    { at: 42, kind: 'season', date: '2026-12-20' },
    {
      at: 42.5,
      kind: 'caption',
      text: 'And winter lights in December',
      seconds: 4,
      feature: 'season',
    },
    { at: 50, kind: 'shot', shot: 'overhead', into: 'blend' },
    { at: 50.5, kind: 'caption', text: 'Ride as a group', seconds: 5 },
    { at: 62, kind: 'shot', shot: 'roadside', into: 'cut' },
  ],
};

/** A cue as `__oylDemo` names it: its kind and second, and its value where it has one. */
export function cueName(cue: Cue): string {
  const at = String(cue.at);
  switch (cue.kind) {
    case 'world':
      return `world ${cue.world} at ${at}`;
    case 'season':
      return `season ${cue.date} at ${at}`;
    case 'people':
    case 'countryside':
      return `${cue.kind} ${cue.on ? 'on' : 'off'} at ${at}`;
    case 'shot':
      return `shot ${cue.shot} at ${at}`;
    case 'caption':
      return `caption at ${at}`;
  }
}

/** The feature a cue needs, if any. A world cue needs the realistic world only to go to it. */
export function featureOf(cue: Cue): ShowcaseFeature | undefined {
  switch (cue.kind) {
    case 'world':
      return cue.world === 'realistic' ? 'realistic' : undefined;
    case 'season':
    case 'people':
    case 'countryside':
      return cue.kind;
    case 'shot':
      return undefined;
    case 'caption':
      return cue.feature;
  }
}

/** What should be on at one ride time. */
export interface ShowcaseState {
  readonly world: 'stylised' | 'realistic';
  /** The season's date, or {@link NO_SEASON_DATE}. */
  readonly date: string;
  readonly people: boolean;
  readonly countryside: boolean;
  /** The caption shown now, if any. */
  readonly caption: string | undefined;
  /** How many cues have fired, skipped ones included. */
  readonly fired: number;
  /** Every cue skipped so far this pass, by {@link cueName}. */
  readonly skipped: readonly string[];
}

/**
 * The timeline's state at `seconds` of ride, with `has` saying which features
 * this run can draw. Cues fire in order: a cue at exactly `seconds` has fired.
 */
export function showcaseAt(
  timeline: ShowcaseTimeline,
  seconds: number,
  has: (feature: ShowcaseFeature) => boolean,
): ShowcaseState {
  let world: ShowcaseState['world'] = 'stylised';
  let date = NO_SEASON_DATE;
  let people = false;
  let countryside = false;
  let caption: string | undefined;
  let fired = 0;
  const skipped: string[] = [];
  const missing = new Set<ShowcaseFeature>();
  for (const cue of timeline.cues) {
    if (cue.at > seconds) break;
    fired += 1;
    const feature = featureOf(cue);
    if (feature !== undefined && !has(feature)) {
      missing.add(feature);
      skipped.push(cueName(cue));
      continue;
    }
    switch (cue.kind) {
      case 'world':
        world = cue.world;
        break;
      case 'season':
        date = cue.date;
        break;
      case 'people':
        people = cue.on;
        break;
      case 'countryside':
        countryside = cue.on;
        break;
      case 'shot':
        break;
      case 'caption':
        caption = seconds < cue.at + cue.seconds ? cue.text : undefined;
        break;
    }
  }
  return { world, date, people, countryside, caption, fired, skipped };
}

/**
 * The timeline's `shot` cues as a camera tour's shots: each held until the
 * next, the last until the timeline's end, so the tour's period is the
 * timeline's and a second pass is shot as the first.
 */
export function showcaseShots(timeline: ShowcaseTimeline): TourShot[] {
  const shots = timeline.cues.filter(
    (cue): cue is Extract<Cue, { kind: 'shot' }> => cue.kind === 'shot',
  );
  return shots.map((cue, index) => ({
    kind: cue.shot,
    seconds: (shots[index + 1]?.at ?? timeline.seconds) - cue.at,
    into: cue.into,
  }));
}
