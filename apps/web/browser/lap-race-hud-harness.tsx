// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page `lap-race-hud.browser.spec.ts` drives — #1904.
 *
 * It renders the **real** `game/hud/HudPanel.tsx`, with a lap race on it
 * through the **real** `game/hud/lap-race-hud.ts`, under the **real**
 * `design/theme.css`, on a stage with the product's own classes — as
 * `hud-harness.tsx` does, and with its one substitution: each stage is
 * `position: relative` and `100vh` tall where the product's is fixed, so
 * three stages stack. The race states are the model's own
 * (`@onyourleft/domain` §`stepRace`); only the item a racer holds is set by
 * hand.
 *
 * Each stage is the widest ride the picker starts — a pacer, a ghost and a
 * wind, the longest moving time, a trainer line — so the readings that give
 * way to a race are all there to give way:
 *
 * - `none`: that ride with no race;
 * - `start`: a race of twelve on its first lap, nothing held — longer than
 *   any solo field, so the standings are their tallest, eight lines (#2328);
 * - `warned`: the same race on its last lap, the rider 11th of 12 holding a
 *   crosswind gust, with a bot behind in the rider's lane holding another —
 *   the widest place and the warning under the item;
 * - `held-…`: the `warned` race with the rider holding each other item, so
 *   every item's name is laid out under the runner's fonts.
 *
 * The race is the longest the chooser starts, {@link LAP_RACE_MOST_LAPS}
 * laps, and on every race stage a bot rides behind the rider, so the *Place*
 * field's lap line carries the "behind you" cue (#2455 AC2). On the warned
 * stages the line is at its widest — the last lap of ten, the bot named the
 * longest a solo field deals, `Sprinter 7`, at the window's edge, `+5 s`:
 * *Lap 10 of 10 · Sprinter 7 +5 s*. That bot is also the one holding the
 * gust, so it must be inside `GUST_REACH_METRES` (30 m): it rides 28 m back
 * and the race's gap is read at {@link WARNED_SPEED} (28 m / 6 m/s, 4.7 s,
 * written `+5 s`), where the HUD's own speed reading stays the state's.
 *
 * ⚠️ **Every item's HUD name is one word**, and the first cut's
 * *Crosswind gust* is why: on the CI runner's fonts *Crosswind* alone ran
 * past the *Item* field's value box at every corners layout (PR #1957's first
 * run), where on a Mac it fitted by a pixel. The `held-…` stages hold all five.
 *
 * ## `?group=ride` — an AI group ride's role strip and cue line (#3305)
 *
 * The same stage with a group ride on it in place of a race, through the
 * **real** `game/hud/group-ride-hud.ts` and `GroupRideCue.tsx`: the strip's
 * two fields take a race's two places, and the cue line is the longest
 * sentence a cue has, on the notices cell. Three stages, each the widest of
 * its kind: `group-wheel` (eighth of eight, a two-digit gap), `group-front`
 * (the pull's countdown at its longest) and `group-lost` (no power reading:
 * dashes). `?text=` sets the HUD's text size, as it does for `?corner=race`.
 *
 * ## `?group=controls` — the pull-off button lit and unlit (#3371)
 *
 * The `group-front` and `group-wheel` stages again, each with the group
 * ride's controls (`game/hud/GroupRideControls.tsx`) on the actions panel:
 * `pull-off-on-front` with the rider on the front, where *Pull off left* can
 * be used, and `pull-off-off-front` on a wheel, where it cannot. The spec
 * reads the button's drawn colours and edge off each, and photographs both
 * for the owner.
 *
 * ⚠️ **What it does not prove**: the stage is not `GameView`'s. No lap race
 * runs inside a game ride until #1906, and the notices a real ride can put
 * on the HUD (the road notice, a lap's notice) are not here. The rider's box
 * is `game/camera.ts` §`riderFrameBox` at the lean cap, as every ride spec
 * reads it (`ride-stage.ts` §`riderBox`), so "clear of the rider" is against
 * the same box; #1906's spec measures the race in the real ride.
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  BOT_PACING_STYLES,
  CUE_KINDS,
  MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
  altitudeMetres,
  beatsPerMinute,
  createItemRace,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  metres,
  metresPerSecond,
  pacerGap,
  raceCourse,
  routeProfile,
  seconds,
  stepRace,
  unixSeconds,
  watts,
  type ItemKind,
  type ItemRaceState,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import type { ChasedGap, ShownPower } from '../src/game/hud/fields';
import { HudPanel } from '../src/game/hud/HudPanel';
import {
  DEFAULT_HUD_LAYOUT,
  HUD_TEXT_SIZES,
  type HudLayoutPreference,
} from '../src/game/hud/hud-layout-preference';
import { GROUP_RIDE_CUE_TEXT, type GroupRideHud } from '../src/game/hud/group-ride-hud';
import { GROUP_RIDE_CUE_CLASS, groupCueNotice } from '../src/game/hud/GroupRideCue';
import { botName, lapRaceStandings, type LapRaceHud } from '../src/game/hud/lap-race-hud';
import { LAP_RACE_MOST_BOTS, LAP_RACE_MOST_LAPS } from '../src/game/lap-race/choice';
import { AI_BOTS_RACE_TEXT } from '../src/game/lap-race/ride-race';
import type { GameState } from '../src/game/simulation';
import type { LapFigures } from '../src/recording/laps';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';
import '../src/design/tailwind.css';
import { writeRideChrome } from '../src/game/hud/ride-chrome-preference';

/** A box, serialisable, relative to its own stage's top-left corner. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** One stage, measured. */
export interface LapRaceStageMeasurement {
  /** `none`, `start`, `warned`, or `held-` and an item. */
  readonly stage: string;
  /** Every HUD panel laid out at a size, by its classes. */
  readonly panels: readonly { readonly name: string; readonly box: Box }[];
  /** The secondary readings' panel. */
  readonly secondary: Box | undefined;
  /** Every field on the stage, by label: laid out at no size when it gives way. */
  readonly fields: readonly {
    readonly label: string;
    readonly box: Box;
    readonly valueOverflows: boolean;
    readonly outlineStyle: string;
    readonly outlineWidth: number;
    /** The phrase under the value (`HudReading.detail`), or `undefined` with none. */
    readonly detail: string | undefined;
  }[];
  /** The race's standings panel, laid out at no size when it is visually hidden. */
  readonly standings: Box | undefined;
  /** The ride's controls, Pause and End ride. */
  readonly controls: readonly { readonly label: string; readonly box: Box }[];
  /** The actions panel. */
  readonly actions: Box | undefined;
  /**
   * The trainer's line (#373), and whether it is the topmost thing at each of
   * its corners, hit-tested — so a panel drawn over it is caught however the
   * boxes are read.
   */
  readonly trainer: { readonly box: Box; readonly topmost: boolean } | undefined;
  /**
   * Each line of the standings, by its text, and whether it is in view: laid
   * out at a size and wholly inside the list's own box, where it scrolls.
   */
  readonly standingsLines: readonly {
    readonly text: string;
    readonly you: boolean;
    readonly inView: boolean;
  }[];
  /** The standings' list (#2599): where it scrolls, and what a screen reader and a keyboard meet. */
  readonly standingsList:
    | {
        readonly box: Box;
        readonly scrolls: boolean;
        readonly clientHeight: number;
        readonly scrollHeight: number;
        readonly scrollTop: number;
        readonly role: string | null;
        readonly label: string | null;
        readonly tabIndex: number;
        readonly overflowY: string;
        readonly overscroll: string;
        readonly more: string | null;
      }
    | undefined;
  /** *Show laps*, where the standings carry it (#2080). */
  readonly swap: Box | undefined;
  /** #3305: the group ride's cue line, where the stage draws one. */
  readonly cue: CueLineMeasurement | undefined;
}

/** The cue line as it is drawn: where, how large, on how many lines, and whether anything clips it. */
export interface CueLineMeasurement {
  readonly text: string;
  readonly box: Box;
  readonly fontSize: number;
  /** A notice's own size, px: what the line is 1.5 times. */
  readonly noticeSize: number;
  readonly lines: number;
  /** The line or its cell, where its content runs past its box. */
  readonly overflows: readonly string[];
  /** Whether the line is what a press on each of its corners lands on. */
  readonly onTop: boolean;
}

/** One stage's standings and actions panel in the first frame drawn. */
export interface FirstFrame {
  readonly stage: string;
  readonly standings: Box | undefined;
  readonly actions: Box | undefined;
  /**
   * PR #2621's second review: whether the rider's own line is wholly inside
   * the list in that frame, or `undefined` where the list is not drawn (a
   * phone) — so "opens on the own line, before paint" is read in the browser.
   */
  readonly ownInView: boolean | undefined;
}

declare global {
  interface Window {
    /** Set once the stages are rendered AND the fonts are loaded. */
    __oylLapRaceHud?: { readonly ready: boolean; readonly errors: readonly string[] };
    /** The measurement, taken when it is called. */
    __oylLapRaceHudMeasure?: () => readonly LapRaceStageMeasurement[];
    /**
     * PR #2621's review: each stage's standings and actions panel as the
     * FIRST frame drew them — read in the first animation frame after the
     * render, which runs before that frame is painted and before any
     * `ResizeObserver` delivers. `undefined` until then.
     */
    __oylLapRaceHudFirstFrame?: readonly FirstFrame[];
    /** #2599: the times the corner's *Use item* was asked for. */
    __oylLapRaceHudItemsUsed?: number;
  }
}

const errors: string[] = [];

function route(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 100) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(40 + 25 * Math.sin(index / 9)),
    });
  }
  return routeProfile(points);
}

const PROFILE = route();
const RIDDEN = metres(5_000);

const STATE: GameState = {
  ride: { speed: metresPerSecond(12.5), distance: RIDDEN },
  elapsed: seconds(1_200),
  ridden: seconds(1_200),
  grade: gradeAt(PROFILE, RIDDEN),
  input: { power: watts(342), live: true },
  headwindMetresPerSecond: MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
};

/**
 * #2420: power as \`GameView\` hands it to every ride — the 3 s average, the
 * default — so the field is measured under the term a rider reads,
 * *Power (3 s)*. The average is the state's own reading, so no number here
 * changes.
 */
const SHOWN_POWER: ShownPower = { view: 'average', average: STATE.input.power };

const CHASES: readonly ChasedGap[] = [
  {
    to: 'bot',
    gap: pacerGap({
      botDistance: metres(5_120),
      riderDistance: RIDDEN,
      referenceSpeed: metresPerSecond(12.5),
    }),
  },
  {
    to: 'ghost',
    gap: pacerGap({
      botDistance: metres(4_900),
      riderDistance: RIDDEN,
      referenceSpeed: metresPerSecond(12.5),
    }),
  },
];

const MOVING_SECONDS = 9 * 3600 + 59 * 60 + 59;

const STAGE_IN_FLOW = { position: 'relative', inset: 'auto', height: '100vh' } as const;

const RIDER = 'rider';
const BOTS = Array.from({ length: 11 }, (_, index) => `bot-${String(index + 1).padStart(2, '0')}`);
const STYLES = BOT_PACING_STYLES;

function holding(race: ItemRaceState, id: string, kind: ItemKind | null): ItemRaceState {
  return {
    ...race,
    racers: race.racers.map((entry) => (entry.racer.id === id ? { ...entry, held: kind } : entry)),
  };
}

/**
 * A race of twelve, {@link LAP_RACE_MOST_LAPS} laps of 2 km, ridden to `rider`
 * metres with the bots spread round it: the first bot behind `behind` metres
 * back, the rest 40 m apart behind it.
 */
function raceAt(rider: number, botsAhead: number, behind: number): ItemRaceState {
  const start = createItemRace({
    course: raceCourse(2_000, LAP_RACE_MOST_LAPS),
    seed: 1_904,
    itemsOn: true,
    racerIds: [RIDER, ...BOTS],
    startMs: 0,
  });
  const efforts: Record<string, number> = { [RIDER]: rider };
  BOTS.forEach((id, index) => {
    efforts[id] =
      index < botsAhead ? rider + 40 * (index + 1) : rider - behind - 40 * (index - botsAhead);
  });
  return stepRace(start, { atMs: 600_000, effortDistances: efforts });
}

/** The bot behind the rider on the warned stages, named the longest a solo field names a bot. */
const WIDEST_BEHIND = 'bot-11';

/** The rider's speed the warned stages' race gaps are read at: see the module note. */
const WARNED_SPEED = 6;

/** The warned stages' race: the rider on the last lap, 11th of 12, the gust holder 28 m back. */
const LAST_LAP = 2_000 * (LAP_RACE_MOST_LAPS - 1) + 100;

function hudOf(race: ItemRaceState, speedMetresPerSecond = 12.5): LapRaceHud {
  return {
    race,
    riderId: RIDER,
    entrants: Object.fromEntries(
      BOTS.map((id, index) => [
        id,
        {
          name:
            id === WIDEST_BEHIND
              ? botName('sprinter', LAP_RACE_MOST_BOTS)
              : botName(STYLES[index % STYLES.length] ?? 'even', index + 1),
          wattsPerKilogram: 3.5,
        },
      ]),
    ),
    riderWattsPerKilogram: 4.1,
    speedMetresPerSecond,
  };
}

const STAGES: readonly {
  readonly stage: string;
  readonly race: ItemRaceState | undefined;
  readonly speed?: number;
}[] = [
  { stage: 'none', race: undefined },
  { stage: 'start', race: raceAt(300, 4, 10) },
  {
    stage: 'warned',
    race: holding(
      holding(raceAt(LAST_LAP, 10, 28), RIDER, 'crosswind-gust'),
      'bot-11',
      'crosswind-gust',
    ),
    speed: WARNED_SPEED,
  },
  ...(['tailwind', 'tow', 'puddle', 'rain-cape'] as const).map((kind) => ({
    stage: `held-${kind}`,
    race: holding(holding(raceAt(LAST_LAP, 10, 28), RIDER, kind), 'bot-11', 'crosswind-gust'),
    speed: WARNED_SPEED,
  })),
];

/**
 * `lap-race-hud.html?corner=race` — #2599: the bottom-right corner of a solo
 * lap race as the owner's tablet drew it, where the stages above leave out
 * what made it overlap. A race of eight, the most a solo race starts
 * ({@link LAP_RACE_MOST_BOTS} bots and the rider), so the standings are
 * eight lines; on a loop with a lap done, so the swap to the lap splits is
 * on the standings' first row (#2080); with *Use item* in the actions panel
 * (#1901) under the trainer's line, *Pause* and *End ride*. `&text=large` or
 * `&text=extra-large` draws it at the HUD's larger text (#2079).
 *
 * - `corner-back`: the rider last, 8th of 8, holding nothing;
 * - `corner-middle`: the rider 4th of 8, holding a tailwind, so the lines
 *   that give way are on both sides of the rider's own.
 *
 * `&controls=hide` — #2837: the ride controls hide until touched (#2600), as
 * on a rider's device, and `corner-back`'s rider holds NOTHING (the race
 * deals that stage a tow otherwise), so its controls fade after a few seconds
 * with no input and its standings take the room they leave.
 * `corner-middle`'s never do: its rider holds an item, which holds them drawn
 * (ADR 0075 D-5), so it is the same page's control. `&note=ai` puts the AI bots' sentence under the
 * standings' summary (#2710), two lines the list then has less room by — the
 * corner as a race against a rider's own model draws it.
 */
const SEARCH = new URLSearchParams(window.location.search);
const CORNER = SEARCH.get('corner') === 'race';
const TEXT_SIZE = HUD_TEXT_SIZES.find((size) => size === SEARCH.get('text')) ?? 'normal';
const CORNER_LAYOUT: HudLayoutPreference = { ...DEFAULT_HUD_LAYOUT, textSize: TEXT_SIZE };
/** #2837: `&controls=hide`. @see CORNER */
const CONTROLS_HIDE = SEARCH.get('controls') === 'hide';
/** #2837: `&note=ai`. @see CORNER */
const AI_NOTE = SEARCH.get('note') === 'ai';

/** A 2 km loop, out 1 km and back, so a lap race has a lap to race and the splits a lap to show. */
function loop(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    const out = index <= 10 ? index : 20 - index;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (out * 100) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(40 + 2 * out),
    });
  }
  return routeProfile(points, { loop: true });
}

const LOOP = loop();

/** Two laps done, the splits panel's rows. */
const CORNER_LAPS: readonly LapFigures[] = [3_475, 3_599].map((moving) => ({
  startedAt: unixSeconds(1_800_000_000),
  elapsedTime: seconds(moving),
  movingTime: seconds(moving),
  distance: metres(2_000),
  averagePower: watts(342),
  averageHeartRate: beatsPerMinute(168),
}));

/** A race of eight, its bots `botsAhead` of them 40 m apart ahead of the rider and the rest behind. */
function raceOfEight(botsAhead: number): ItemRaceState {
  const bots = BOTS.slice(0, LAP_RACE_MOST_BOTS);
  const start = createItemRace({
    course: raceCourse(2_000, LAP_RACE_MOST_LAPS),
    seed: 2_599,
    itemsOn: true,
    racerIds: [RIDER, ...bots],
    startMs: 0,
  });
  const rider = 4_300;
  const efforts: Record<string, number> = { [RIDER]: rider };
  bots.forEach((id, index) => {
    efforts[id] =
      index < botsAhead ? rider + 40 * (index + 1) : rider - 40 * (index - botsAhead + 1);
  });
  return stepRace(start, { atMs: 600_000, effortDistances: efforts });
}

const CORNER_STAGES: readonly { readonly stage: string; readonly race: ItemRaceState }[] = [
  {
    stage: 'corner-back',
    race: CONTROLS_HIDE
      ? holding(raceOfEight(LAP_RACE_MOST_BOTS), RIDER, null)
      : raceOfEight(LAP_RACE_MOST_BOTS),
  },
  { stage: 'corner-middle', race: holding(raceOfEight(3), RIDER, 'tailwind') },
];

/** #2599: how many times *Use item* was asked for, so a scroll is shown never to be a tap on it. */
const ITEMS = {
  useItem: (): void => {
    window.__oylLapRaceHudItemsUsed = (window.__oylLapRaceHudItemsUsed ?? 0) + 1;
  },
};

function Corner(): JSX.Element {
  return (
    <div>
      {CORNER_STAGES.map(({ stage, race }) => (
        <section
          key={stage}
          className="oyl-game oyl-game--riding"
          style={STAGE_IN_FLOW}
          data-oyl-lap-race-stage={stage}
        >
          <HudPanel
            profile={LOOP}
            shownPower={SHOWN_POWER}
            state={STATE}
            cadence={{ value: 92, live: true }}
            heartRate={{ value: 168, live: true }}
            movingSeconds={MOVING_SECONDS}
            elapsedSeconds={MOVING_SECONDS}
            paused={false}
            onPause={() => undefined}
            onEnd={() => undefined}
            announcement=""
            trainer={{ gradePercent: -12.5, writes: 1_234 }}
            layout={CORNER_LAYOUT}
            laps={CORNER_LAPS}
            lapSeconds={59 * 60 + 59}
            items={ITEMS}
            lapRace={hudOf(race)}
            standings={{
              ...lapRaceStandings(hudOf(race)),
              ...(AI_NOTE ? { note: AI_BOTS_RACE_TEXT.racing } : {}),
            }}
          />
        </section>
      ))}
    </div>
  );
}

/** The longest sentence a cue has: what the cue line must hold. */
export const LONGEST_CUE = [...CUE_KINDS]
  .map((kind) => GROUP_RIDE_CUE_TEXT[kind])
  .sort((a, b) => b.length - a.length)[0] as string;

const GROUP = SEARCH.get('group') === 'ride';
/** #3371: `?group=controls`. @see the file header */
const GROUP_CONTROLS = SEARCH.get('group') === 'controls';

/** A group of eight at 42 km/h on a ride chosen at 38: the widest the chooser starts. */
const GROUP_ON_A_WHEEL: GroupRideHud = {
  place: 8,
  of: 8,
  gapMetres: 12.4,
  pullLeftSeconds: undefined,
  groupSpeed: 42 / 3.6,
  targetSpeed: 38 / 3.6,
  live: true,
};

const GROUP_STAGES: readonly { readonly stage: string; readonly group: GroupRideHud }[] = [
  { stage: 'group-wheel', group: GROUP_ON_A_WHEEL },
  {
    stage: 'group-front',
    group: { ...GROUP_ON_A_WHEEL, place: 1, gapMetres: undefined, pullLeftSeconds: 30 },
  },
  { stage: 'group-lost', group: { ...GROUP_ON_A_WHEEL, live: false } },
];

/** `?group=ride`: a group ride's strip and cue line on the widest ride's stage. @see the file header */
function Group(): JSX.Element {
  return (
    <div>
      {GROUP_STAGES.map(({ stage, group }) => (
        <section
          key={stage}
          className="oyl-game oyl-game--riding"
          style={STAGE_IN_FLOW}
          data-oyl-lap-race-stage={stage}
        >
          <HudPanel
            profile={PROFILE}
            shownPower={SHOWN_POWER}
            state={STATE}
            cadence={{ value: 92, live: true }}
            heartRate={{ value: 168, live: true }}
            movingSeconds={MOVING_SECONDS}
            elapsedSeconds={MOVING_SECONDS}
            // A group ride has no pacer; the ghost's gap is still chased.
            chases={CHASES.filter((chase) => chase.to === 'ghost')}
            paused={false}
            onPause={() => undefined}
            onEnd={() => undefined}
            announcement=""
            trainer={{ gradePercent: -12.5, writes: 1_234 }}
            layout={CORNER_LAYOUT}
            groupRide={group}
            notices={[groupCueNotice(LONGEST_CUE)]}
          />
        </section>
      ))}
    </div>
  );
}

/** #3371, `?group=controls`: the pull-off button on the front and off it. @see the file header */
function GroupControls(): JSX.Element {
  const stages = [
    { stage: 'pull-off-on-front', onFront: true, group: GROUP_STAGES[1]?.group },
    { stage: 'pull-off-off-front', onFront: false, group: GROUP_STAGES[0]?.group },
  ];
  return (
    <div>
      {stages.map(({ stage, onFront, group }) => (
        <section
          key={stage}
          className="oyl-game oyl-game--riding"
          style={STAGE_IN_FLOW}
          data-oyl-lap-race-stage={stage}
        >
          <HudPanel
            profile={PROFILE}
            shownPower={SHOWN_POWER}
            state={STATE}
            cadence={{ value: 92, live: true }}
            heartRate={{ value: 168, live: true }}
            movingSeconds={MOVING_SECONDS}
            elapsedSeconds={MOVING_SECONDS}
            chases={CHASES.filter((chase) => chase.to === 'ghost')}
            paused={false}
            onPause={() => undefined}
            onEnd={() => undefined}
            announcement=""
            trainer={{ gradePercent: -12.5, writes: 1_234 }}
            layout={CORNER_LAYOUT}
            {...(group === undefined ? {} : { groupRide: group })}
            groupRideInput={{
              onFront,
              sittingIn: false,
              pullOff: () => undefined,
              sitIn: () => undefined,
            }}
          />
        </section>
      ))}
    </div>
  );
}

function Harness(): JSX.Element {
  if (CORNER) return <Corner />;
  if (GROUP) return <Group />;
  if (GROUP_CONTROLS) return <GroupControls />;
  return (
    <div>
      {STAGES.map(({ stage, race, speed }) => (
        <section
          key={stage}
          className="oyl-game oyl-game--riding"
          style={STAGE_IN_FLOW}
          data-oyl-lap-race-stage={stage}
        >
          <HudPanel
            profile={PROFILE}
            shownPower={SHOWN_POWER}
            state={STATE}
            cadence={{ value: 92, live: true }}
            heartRate={{ value: 168, live: true }}
            movingSeconds={MOVING_SECONDS}
            elapsedSeconds={MOVING_SECONDS}
            chases={CHASES}
            paused={false}
            onPause={() => undefined}
            onEnd={() => undefined}
            announcement=""
            trainer={{ gradePercent: -12.5, writes: 1_234 }}
            {...(race === undefined
              ? {}
              : {
                  lapRace: hudOf(race, speed),
                  standings: lapRaceStandings(hudOf(race, speed)),
                })}
          />
        </section>
      ))}
    </div>
  );
}

const textOf = (element: Element): string =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function boxIn(element: Element, origin: DOMRect): Box {
  const box = element.getBoundingClientRect();
  return {
    left: box.left - origin.left,
    top: box.top - origin.top,
    right: box.right - origin.left,
    bottom: box.bottom - origin.top,
    width: box.width,
    height: box.height,
  };
}

function measure(): readonly LapRaceStageMeasurement[] {
  return [...document.querySelectorAll('[data-oyl-lap-race-stage]')].map((stage) => {
    const origin = stage.getBoundingClientRect();
    const secondary = stage.querySelector('.oyl-hud__fields--secondary');
    const standings = stage.querySelector('.oyl-hud__standings');
    const actions = stage.querySelector('.oyl-hud__actions');
    const trainer = stage.querySelector('.oyl-hud__trainer');
    const list = stage.querySelector<HTMLElement>('.oyl-hud__standings-scroll');
    const swap = stage.querySelector('.oyl-hud__standings .oyl-hud__swap');
    return {
      stage: stage.getAttribute('data-oyl-lap-race-stage') ?? '',
      panels: [...stage.querySelectorAll('.oyl-hud__panel')]
        .map((panel) => ({ name: panel.className, box: boxIn(panel, origin) }))
        .filter((panel) => panel.box.width > 1 && panel.box.height > 1),
      secondary: secondary === null ? undefined : boxIn(secondary, origin),
      fields: [...stage.querySelectorAll('.oyl-hud__field')].map((field) => {
        const value = field.querySelector('.oyl-hud__value');
        const detail = field.querySelector('.oyl-hud__detail');
        const style = window.getComputedStyle(field);
        return {
          label: textOf(field.querySelector('.oyl-hud__label') ?? field),
          box: boxIn(field, origin),
          valueOverflows: value === null ? true : value.scrollWidth > value.clientWidth,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
          detail: detail === null ? undefined : textOf(detail),
        };
      }),
      standings: standings === null ? undefined : boxIn(standings, origin),
      controls: [...stage.querySelectorAll('.oyl-hud__actions button')].map((control) => ({
        label: textOf(control),
        box: boxIn(control, origin),
      })),
      actions: actions === null ? undefined : boxIn(actions, origin),
      trainer:
        trainer === null ? undefined : { box: boxIn(trainer, origin), topmost: topmost(trainer) },
      standingsLines: [...stage.querySelectorAll('.oyl-hud__standings-line')].map((line) => {
        const box = line.getBoundingClientRect();
        const view = list?.getBoundingClientRect();
        return {
          text: textOf(line),
          you: line.classList.contains('oyl-hud__standings-line--you'),
          inView:
            box.width > 1 &&
            box.height > 1 &&
            view !== undefined &&
            box.top >= view.top - 1 &&
            box.bottom <= view.bottom + 1,
        };
      }),
      standingsList:
        list === null
          ? undefined
          : {
              box: boxIn(list, origin),
              scrolls: list.hasAttribute('data-oyl-scrolls'),
              clientHeight: list.clientHeight,
              scrollHeight: list.scrollHeight,
              scrollTop: list.scrollTop,
              role: list.getAttribute('role'),
              label: list.getAttribute('aria-label'),
              tabIndex: list.tabIndex,
              overflowY: window.getComputedStyle(list).overflowY,
              overscroll: window.getComputedStyle(list).overscrollBehaviorY,
              more: list.getAttribute('data-oyl-more'),
            },
      swap: swap === null ? undefined : boxIn(swap, origin),
      cue: cueLine(stage),
    };
  });
}

/** #3305: the stage's cue line, measured as `ride-notices.browser.spec.ts` measures the pacer's. */
function cueLine(stage: Element): CueLineMeasurement | undefined {
  const notice = stage.querySelector<HTMLElement>(`.oyl-hud__notices .${GROUP_RIDE_CUE_CLASS}`);
  if (notice === null) return undefined;
  // `topmost` scrolls the line into view, so it is asked first and the stage's
  // origin is read after it.
  const onTop = topmost(notice);
  const origin = stage.getBoundingClientRect();
  const style = getComputedStyle(notice);
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const token = getComputedStyle(document.documentElement).getPropertyValue('--oyl-font-size-sm');
  // Its lines: the sentence's text, a line box at a time.
  const sentence = notice.querySelector<HTMLElement>(':scope > span:not(.oyl-status__glyph)');
  const range = document.createRange();
  if (sentence !== null) range.selectNodeContents(sentence);
  const lineHeight = parseFloat(style.lineHeight);
  const tops: number[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.width < 1) continue;
    if (!tops.some((top) => Math.abs(top - rect.top) < lineHeight / 2)) tops.push(rect.top);
  }
  const overflows: string[] = [];
  for (const each of [notice, notice.closest<HTMLElement>('.oyl-hud__notices')]) {
    if (each === null) continue;
    if (each.scrollHeight > each.clientHeight + 1 || each.scrollWidth > each.clientWidth + 1) {
      overflows.push(
        `${each.className.split(' ')[0] ?? ''} ${String(each.scrollWidth)}×${String(each.scrollHeight)} in ${String(each.clientWidth)}×${String(each.clientHeight)}`,
      );
    }
  }
  return {
    text: textOf(notice),
    box: boxIn(notice, origin),
    fontSize: parseFloat(style.fontSize),
    noticeSize: parseFloat(token) * (token.trim().endsWith('rem') ? root : 1),
    lines: tops.length,
    overflows,
    onTop,
  };
}

function firstFrame(): readonly FirstFrame[] {
  return [...document.querySelectorAll('[data-oyl-lap-race-stage]')].map((stage) => {
    const origin = stage.getBoundingClientRect();
    const standings = stage.querySelector('.oyl-hud__standings');
    const actions = stage.querySelector('.oyl-hud__actions');
    const list = stage.querySelector('.oyl-hud__standings-scroll')?.getBoundingClientRect();
    const own = stage.querySelector('.oyl-hud__standings-line--you')?.getBoundingClientRect();
    return {
      stage: stage.getAttribute('data-oyl-lap-race-stage') ?? '',
      standings: standings === null ? undefined : boxIn(standings, origin),
      actions: actions === null ? undefined : boxIn(actions, origin),
      ownInView:
        list === undefined || own === undefined || list.width <= 1 || list.height <= 1
          ? undefined
          : own.top >= list.top - 1 && own.bottom <= list.bottom + 1,
    };
  });
}

/** Each stage's standings list, as tall as it is drawn and as far as it is scrolled. */
function listState(): string {
  return [...document.querySelectorAll('.oyl-hud__standings-scroll')]
    .map((list) => `${String(list.clientHeight)}@${String(list.scrollTop)}`)
    .join(',');
}

/** The most frames {@link settled} waits; the spec's own bound is the real one. */
const MOST_SETTLING_FRAMES = 120;

/**
 * #2599, PR #2621's review: the standings measure again when a panel changes
 * size — the fonts arriving among them — and set the list's height a frame
 * later, and scroll it to the rider's own line. Ready once two frames running
 * draw every stage's list at the same height and scroll, rather than after a
 * fixed count of frames.
 */
async function settled(): Promise<void> {
  const frame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));
  await frame();
  let before = listState();
  for (let count = 0; count < MOST_SETTLING_FRAMES; count += 1) {
    await frame();
    const now = listState();
    if (now === before) return;
    before = now;
  }
}

/** Whether `element` is what a press lands on at each of its corners, two pixels in. */
function topmost(element: Element): boolean {
  element.scrollIntoView({ block: 'nearest' });
  const box = element.getBoundingClientRect();
  if (box.width <= 4 || box.height <= 4) return false;
  return [
    [box.left + 2, box.top + 2],
    [box.right - 2, box.top + 2],
    [box.left + 2, box.bottom - 2],
    [box.right - 2, box.bottom - 2],
  ].every(([x, y]) => {
    const hit = document.elementFromPoint(x ?? 0, y ?? 0);
    return hit !== null && element.contains(hit);
  });
}

async function run(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#hud');
  if (container === null) {
    throw new Error('the harness page is missing its #hud container');
  }
  // #2599, the corner only: every face the stylesheet declares loaded before
  // the first render, as on a device whose fonts are cached — so the first
  // frame is the layout a rider meets when a race opens, not one drawn in a
  // fallback face (on the CI runner's, the large text then had no room for a
  // line until the fonts arrived). The other stages keep the page as it was.
  if (CORNER || GROUP || GROUP_CONTROLS)
    await Promise.all([...document.fonts].map((face) => face.load()));
  // #2600: the ride controls drawn and every panel open, as this page
  // measures them; `ride-chrome.browser.spec.ts` measures them hidden — and
  // #2837's `&controls=hide`, the corner's standings as they hide.
  writeRideChrome(localStorage, { autoHide: CORNER && CONTROLS_HIDE, collapsed: [] });
  flushSync(() => {
    createRoot(container).render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
  requestAnimationFrame(() => {
    window.__oylLapRaceHudFirstFrame = firstFrame();
  });
  await document.fonts.ready;
  await settled();
  window.__oylLapRaceHudMeasure = measure;
  window.__oylLapRaceHud = { ready: true, errors };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylLapRaceHud = { ready: false, errors };
});
