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
 * - `start`: a race of twelve on its first lap, nothing held;
 * - `warned`: the same race on its last lap, the rider 11th of 12 holding a
 *   crosswind gust, with a bot behind in the rider's lane holding another —
 *   the widest place and the warning under the item;
 * - `held-…`: the `warned` race with the rider holding each other item, so
 *   every item's name is laid out under the runner's fonts.
 *
 * ⚠️ **Every item's HUD name is one word**, and the first cut's
 * *Crosswind gust* is why: on the CI runner's fonts *Crosswind* alone ran
 * past the *Item* field's value box at every corners layout (PR #1957's first
 * run), where on a Mac it fitted by a pixel. The `held-…` stages hold all five.
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
  MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
  altitudeMetres,
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
  watts,
  type ItemKind,
  type ItemRaceState,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import type { ChasedGap } from '../src/game/hud/fields';
import { HudPanel } from '../src/game/hud/HudPanel';
import { botName, lapRaceStandings, type LapRaceHud } from '../src/game/hud/lap-race-hud';
import type { GameState } from '../src/game/simulation';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';
import '../src/design/tailwind.css';

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
  }[];
  /** The race's standings panel, laid out at no size when it is visually hidden. */
  readonly standings: Box | undefined;
  /** The ride's controls, Pause and End ride. */
  readonly controls: readonly { readonly label: string; readonly box: Box }[];
}

declare global {
  interface Window {
    /** Set once the stages are rendered AND the fonts are loaded. */
    __oylLapRaceHud?: { readonly ready: boolean; readonly errors: readonly string[] };
    /** The measurement, taken when it is called. */
    __oylLapRaceHudMeasure?: () => readonly LapRaceStageMeasurement[];
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
const TIERS = ['steady', 'brisk', 'hard', 'fierce'] as const;

function holding(race: ItemRaceState, id: string, kind: ItemKind): ItemRaceState {
  return {
    ...race,
    racers: race.racers.map((entry) => (entry.racer.id === id ? { ...entry, held: kind } : entry)),
  };
}

/** A race of twelve, five laps of 2 km, ridden to `rider` metres with the bots spread round it. */
function raceAt(rider: number, botsAhead: number): ItemRaceState {
  const start = createItemRace({
    course: raceCourse(2_000, 5),
    seed: 1_904,
    itemsOn: true,
    racerIds: [RIDER, ...BOTS],
    startMs: 0,
  });
  const efforts: Record<string, number> = { [RIDER]: rider };
  BOTS.forEach((id, index) => {
    efforts[id] =
      index < botsAhead ? rider + 40 * (index + 1) : rider - 10 - 40 * (index - botsAhead);
  });
  return stepRace(start, { atMs: 600_000, effortDistances: efforts });
}

function hudOf(race: ItemRaceState): LapRaceHud {
  return {
    race,
    riderId: RIDER,
    entrants: Object.fromEntries(
      BOTS.map((id, index) => [
        id,
        {
          name: botName(TIERS[index % TIERS.length] ?? 'steady', index + 1),
          wattsPerKilogram: 3.5,
        },
      ]),
    ),
    riderWattsPerKilogram: 4.1,
    speedMetresPerSecond: 12.5,
  };
}

const STAGES: readonly { readonly stage: string; readonly race: ItemRaceState | undefined }[] = [
  { stage: 'none', race: undefined },
  { stage: 'start', race: raceAt(300, 4) },
  {
    stage: 'warned',
    race: holding(holding(raceAt(8_100, 10), RIDER, 'crosswind-gust'), 'bot-11', 'crosswind-gust'),
  },
  ...(['tailwind', 'tow', 'puddle', 'rain-cape'] as const).map((kind) => ({
    stage: `held-${kind}`,
    race: holding(holding(raceAt(8_100, 10), RIDER, kind), 'bot-11', 'crosswind-gust'),
  })),
];

function Harness(): JSX.Element {
  return (
    <div>
      {STAGES.map(({ stage, race }) => (
        <section
          key={stage}
          className="oyl-game oyl-game--riding"
          style={STAGE_IN_FLOW}
          data-oyl-lap-race-stage={stage}
        >
          <HudPanel
            profile={PROFILE}
            state={STATE}
            cadence={{ value: 92, live: true }}
            heartRate={{ value: 168, live: true }}
            movingSeconds={MOVING_SECONDS}
            chases={CHASES}
            paused={false}
            onPause={() => undefined}
            onEnd={() => undefined}
            announcement=""
            trainer={{ gradePercent: -12.5, writes: 1_234 }}
            {...(race === undefined
              ? {}
              : { lapRace: hudOf(race), standings: lapRaceStandings(hudOf(race)) })}
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
    return {
      stage: stage.getAttribute('data-oyl-lap-race-stage') ?? '',
      panels: [...stage.querySelectorAll('.oyl-hud__panel')]
        .map((panel) => ({ name: panel.className, box: boxIn(panel, origin) }))
        .filter((panel) => panel.box.width > 1 && panel.box.height > 1),
      secondary: secondary === null ? undefined : boxIn(secondary, origin),
      fields: [...stage.querySelectorAll('.oyl-hud__field')].map((field) => {
        const value = field.querySelector('.oyl-hud__value');
        const style = window.getComputedStyle(field);
        return {
          label: textOf(field.querySelector('.oyl-hud__label') ?? field),
          box: boxIn(field, origin),
          valueOverflows: value === null ? true : value.scrollWidth > value.clientWidth,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
        };
      }),
      standings: standings === null ? undefined : boxIn(standings, origin),
      controls: [...stage.querySelectorAll('.oyl-hud__actions button')].map((control) => ({
        label: textOf(control),
        box: boxIn(control, origin),
      })),
    };
  });
}

async function run(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#hud');
  if (container === null) {
    throw new Error('the harness page is missing its #hud container');
  }
  flushSync(() => {
    createRoot(container).render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
  await document.fonts.ready;
  window.__oylLapRaceHudMeasure = measure;
  window.__oylLapRaceHud = { ready: true, errors };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylLapRaceHud = { ready: false, errors };
});
