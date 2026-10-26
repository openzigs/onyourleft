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
 * ## The village stretch — the owner's ruling of 2026-10-26
 *
 * A holiday's decorations stand on a village's street (`decorations.ts`), and
 * a village is drawn only within `streets.ts` §`FURNITURE_DRAW_METRES` of the
 * camera. The group's own road has no village, and `upstate-climb` has none
 * at all: on mapped land a procedural village is not built (#1546), and its
 * nearest mapped building stands well off the road. So the season moments,
 * and the group's, ride a **stretch** of a synthetic road that has one: the
 * same group on {@link SHOWCASE_VILLAGE_ROAD}, cut to by a `stretch` cue and
 * cut back from by the next. A flat road, too, so the group holds its gaps
 * under the overhead. Both rides are ridden on the same clock throughout, so a
 * cut lands where that ride is now, and each pass is the first again.
 *
 * ## The group rides close — the owner's ruling of 2026-10-26
 *
 * #1649's overhead stands behind the lead and looks at it, so it frames about
 * the first dozen metres of the line behind; the `group` preset's riders ride
 * ten metres apart. {@link SHOWCASE_GROUP} is the same riders and scripts at
 * {@link SHOWCASE_GROUP_GAP_METRES}, so the overhead frames all four
 * (`showcase-stage.test.ts`). #1646's presets and #1649's shots are unchanged.
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

import type { BakedRoute } from './baked-route';
import type { ShotKind, TourShot, Transition } from './camera-tour';
import { createDemoPlayer, type DemoPlayer } from './player';
import { GROUP_PRESET } from './presets';
import type { DemoPreset, RouteSection } from './script';

/** The product features a showcase moment can need. */
export type ShowcaseFeature = 'realistic' | 'season' | 'people' | 'countryside';

/** The run's own road, or {@link SHOWCASE_VILLAGE_ROAD}. */
export type ShowcaseStretch = 'route' | 'village';

/** One moment of the timeline, at ride second `at`. */
export type Cue =
  | { readonly at: number; readonly kind: 'world'; readonly world: 'stylised' | 'realistic' }
  /** A fixed day, `YYYY-MM-DD` — never the viewer's clock — or `none` for no season. */
  | { readonly at: number; readonly kind: 'season'; readonly date: string }
  | { readonly at: number; readonly kind: 'people'; readonly on: boolean }
  | { readonly at: number; readonly kind: 'countryside'; readonly on: boolean }
  /** Which ride is drawn: the run's road, or the village stretch's. A cut. */
  | { readonly at: number; readonly kind: 'stretch'; readonly stretch: ShowcaseStretch }
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
    { at: 0, kind: 'stretch', stretch: 'route' },
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
    // Into the village: its decorations are in reach from here to 62 s.
    { at: 34, kind: 'stretch', stretch: 'village' },
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
    { at: 62, kind: 'stretch', stretch: 'route' },
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
    case 'stretch':
      return `stretch ${cue.stretch} at ${at}`;
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
    case 'stretch':
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
  /** Which ride is drawn. */
  readonly stretch: ShowcaseStretch;
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
  let stretch: ShowcaseStretch = 'route';
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
      case 'stretch':
        stretch = cue.stretch;
        break;
      case 'shot':
        break;
      case 'caption':
        caption = seconds < cue.at + cue.seconds ? cue.text : undefined;
        break;
    }
  }
  return { world, date, people, countryside, stretch, caption, fired, skipped };
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

/** How far apart the showcase's group rides, wheel to wheel plus a bike. */
export const SHOWCASE_GROUP_GAP_METRES = 3;

/**
 * The showcase's group: the `group` preset's riders and scripts (#1646),
 * {@link SHOWCASE_GROUP_GAP_METRES} apart in the same order, so #1649's
 * overhead frames all four.
 */
export const SHOWCASE_GROUP: DemoPreset = {
  ...GROUP_PRESET,
  riders: GROUP_PRESET.riders.map((rider, index, all) => ({
    ...rider,
    startMetres: (all.length - 1 - index) * SHOWCASE_GROUP_GAP_METRES,
  })),
};

/**
 * The village stretch's road: 1.7 km of flat, whose one village
 * (`streets.ts` §`streetsAt`, placed from the whole profile) the group
 * rides into a second after the stretch's cut in and out of about 59 s, so
 * both season moments, and most of the group's, are among its doors. Found
 * by riding the group down flat roads of each length; `showcase-stage.test.ts`
 * reads the view's decorations on every frame of the season moments, so a
 * change that moves the village fails there.
 */
export const SHOWCASE_VILLAGE_ROAD: readonly RouteSection[] = [
  { lengthMetres: 1700, gradePercent: 0 },
];

/** The group on the village stretch: {@link SHOWCASE_GROUP} on {@link SHOWCASE_VILLAGE_ROAD}. */
export const SHOWCASE_VILLAGE_GROUP: DemoPreset = {
  ...SHOWCASE_GROUP,
  route: SHOWCASE_VILLAGE_ROAD,
};

/** The showcase's two rides: the run's road, and the village stretch's. */
export interface ShowcaseRides {
  readonly player: DemoPlayer;
  readonly village: DemoPlayer;
}

/**
 * The showcase's rides, each shot with `timeline`'s tour: {@link SHOWCASE_GROUP}
 * on `route` (the group's own road without one) and {@link SHOWCASE_VILLAGE_GROUP}.
 */
export function showcaseRides(
  timeline: ShowcaseTimeline,
  options: { readonly reducedMotion: boolean; readonly route?: BakedRoute | undefined },
): ShowcaseRides {
  const shots = showcaseShots(timeline);
  return {
    player: createDemoPlayer(SHOWCASE_GROUP, { ...options, shots }),
    village: createDemoPlayer(SHOWCASE_VILLAGE_GROUP, {
      reducedMotion: options.reducedMotion,
      shots,
    }),
  };
}
