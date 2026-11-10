// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD with its street map, in a real engine — #2290.
 *
 * Renders the **real** `game/hud/HudPanel.tsx` on the product's own stage
 * classes and stylesheet, mid-ride, over a corridor of map data — or, with
 * `?map=outline`, over none, which is the plan view as it was and this page's
 * control. `street-map.browser.spec.ts` loads both at each viewport and holds
 * them to each other: the same panel boxes, the same controls, and a map that
 * follows the rider.
 *
 * With `?route=compact` (#2385) it draws the route panel as the compact tile,
 * the map alone with the gradient printed on it, and the gradient SWINGS:
 * `8 × sin(distance / 40 m)` %, so the tile's label changes on nearly every
 * 5 m frame of a paced ride. That is a harsher ride than any road, on
 * purpose: the spec counts the map's paints while the label changes, and a
 * label that repainted the map would show it on every frame.
 *
 * ## The corridor is a dense synthetic town, on purpose
 *
 * `street-map-testing.ts` §`denseTown`, the one `street-map.test.ts` bounds
 * the drawing over: a street every 100 m both ways across 2 km either side of
 * a 40 km route, a vertex every 20 m, footways between them and a lake every
 * 4 km: more shapes within a kilometre of the rider than a real corridor holds
 * anywhere but a city centre, so what this page costs is an upper end rather
 * than a typical ride. It is arithmetic, and no map data from anywhere.
 *
 * With `?town=east` (#2397) the route runs due east and the town is turned
 * with it, so the rider's place moves east–west on the sheet's grid, which
 * the north route never does.
 *
 * ## What it publishes
 *
 * `window.__oylStreetMap.ride(frames, metresPerFrame, paced)` advances the
 * rider a frame at a time, re-rendering the HUD as `GameView` does, and counts
 * what changed in the plan view's DOM — the drawing's cost as a number of
 * writes, which a slow runner cannot change. Paced, one step per animation
 * frame, it also times the frames, and the spec reads the engine's own
 * main-thread times beside them.
 *
 * ## What it does not prove
 *
 * What a tablet's GPU pays. A headless Chromium on a runner is not a Fire HD
 * on a handlebar; the counts are the claim, and the times are published for
 * the owner's device measurement to be read against.
 */

import { StrictMode, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { gradeAt, gradePercent, metres, metresPerSecond, seconds, watts } from '@onyourleft/domain';

import { HudPanel } from '../src/game/hud/HudPanel';
import { denseTown, denseTownRoute } from '../src/game/hud/street-map-testing';
import type { GameState } from '../src/game/simulation';

import '../src/design/theme.css';
import '../src/design/tailwind.css';

/** What a ride of the page reports. */
export interface StreetMapRide {
  readonly frames: number;
  /** DOM mutation records under the plan view's box, attribute and child alike. */
  readonly mutations: number;
  /**
   * The records among those that change what is DRAWN rather than where it
   * is (#2380): a shape's `d`, the sheet's `viewBox`, an element added or
   * taken away. The rest are the sheet's `style`, its place, and the box's
   * own `aria-label`, which says how far along the route the rider is.
   */
  readonly drawn: number;
  /**
   * Those of {@link drawn} made on a frame whose sheet kept its `viewBox`:
   * what changed in the drawing while the rider moved within the margin.
   */
  readonly drawnWithin: number;
  /**
   * How many places the view had: the street map's sheet's `viewBox` and
   * `transform` together, or the outline's `viewBox`.
   */
  readonly views: number;
  /** How many different `viewBox` values the street map's sheet had: its regions. */
  readonly regions: number;
  /** Milliseconds of script per frame spent rendering the HUD, the median and the worst. */
  readonly medianRenderMs: number;
  readonly worstRenderMs: number;
  /** Milliseconds between animation frames, the median and the worst: the frame budget as spent. */
  readonly medianFrameMs: number;
  readonly worstFrameMs: number;
  /**
   * How many times the compact tile's gradient label changed (#2385): `0`
   * with the full route panel, which has no label.
   */
  readonly grades: number;
}

declare global {
  interface Window {
    __oylStreetMap?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly ride?: (
        frames: number,
        metresPerFrame: number,
        paced: boolean,
      ) => Promise<StreetMapRide>;
    };
  }
}

const errors: string[] = [];

/** The compact tile's gradient label as drawn, or `undefined` with none. */
function tileGrade(): string | undefined {
  return (
    document.querySelector('.oyl-hud__tile-grade')?.getAttribute('data-oyl-tile-grade') ?? undefined
  );
}

const PARAMS = new URL(window.location.href).searchParams;
/** #2397: which way the route runs through the town (see the module note). */
const HEADING = PARAMS.get('town') === 'east' ? 'east' : 'north';
const PROFILE = denseTownRoute(HEADING);
const CORRIDOR = denseTown(HEADING);
const STREET = PARAMS.get('map') !== 'outline';
/** #2385: the compact route panel, and a gradient that swings (see the module note). */
const COMPACT = PARAMS.get('route') === 'compact';
const LAYOUT = { hidden: [], textSize: 'normal', route: COMPACT ? 'compact' : 'full' } as const;
/** Five kilometres in, so every field has something to say. */
const START = 5_000;

function stateAt(distance: number): GameState {
  return {
    ride: { speed: metresPerSecond(11.1), distance: metres(distance) },
    elapsed: seconds(450),
    ridden: seconds(450),
    grade: COMPACT ? gradePercent(8 * Math.sin(distance / 40)) : gradeAt(PROFILE, metres(distance)),
    input: { power: watts(240), live: true },
    headwindMetresPerSecond: 0,
  };
}

let moveTo: ((distance: number) => void) | undefined;

function Harness(): JSX.Element {
  const [distance, setDistance] = useState(START);
  moveTo = setDistance;
  return (
    <section className="oyl-game oyl-game--riding" aria-label="Trainer game">
      <HudPanel
        profile={PROFILE}
        state={stateAt(distance)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        movingSeconds={450}
        elapsedSeconds={450}
        chases={[]}
        paused={false}
        onPause={() => undefined}
        onEnd={() => undefined}
        announcement=""
        layout={LAYOUT}
        // As GameView passes it once a ride has a sample: the graph is in the
        // route panel, shown or hidden by the stylesheet, as on a real ride.
        recent={{ samples: [{ power: 240, heartRate: 150 }], written: 1 }}
        {...(STREET ? { corridor: CORRIDOR, attribution: '© OpenStreetMap contributors' } : {})}
      />
    </section>
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Ride `frames` frames of `metresPerFrame` each. `paced`, one per animation
 * frame, so the engine styles, lays out and paints between them, as it does
 * for `GameView`; otherwise in one synchronous loop, which counts the same
 * writes in a fraction of the time and cannot be slowed into a timeout.
 * @see the module note
 */
function ride(frames: number, metresPerFrame: number, paced: boolean): Promise<StreetMapRide> {
  const svg = document.querySelector('.oyl-hud__plan-svg');
  if (svg === null || moveTo === undefined) {
    return Promise.reject(new Error('there is no plan view to ride'));
  }
  const move = moveTo;
  const observer = new MutationObserver(() => undefined);
  observer.observe(svg, { attributes: true, childList: true, subtree: true, characterData: true });
  let mutations = 0;
  let drawn = 0;
  let drawnWithin = 0;
  let region = svg.querySelector('.oyl-hud__street-map-sheet')?.getAttribute('viewBox') ?? '';
  const views = new Set<string>();
  const regions = new Set<string>();
  const times: number[] = [];
  const intervals: number[] = [];
  let distance = START;
  let grade = tileGrade();
  let grades = 0;
  const step = (): void => {
    distance += metresPerFrame;
    const before = performance.now();
    flushSync(() => {
      move(distance);
    });
    times.push(performance.now() - before);
    const now = tileGrade();
    if (now !== grade) grades += 1;
    grade = now;
    const records = observer.takeRecords();
    mutations += records.length;
    // Not the box's own attributes (its `aria-label` says how far along the
    // route the rider is), and not the sheet's `style`, which is its place.
    const drawing = records.filter(
      (record) => record.target !== svg && record.attributeName !== 'style',
    ).length;
    drawn += drawing;
    const sheet = svg.querySelector<SVGSVGElement>('.oyl-hud__street-map-sheet');
    // The sheet's place is its region and where in it the rider is.
    views.add(
      sheet === null
        ? (svg.getAttribute('viewBox') ?? '')
        : `${sheet.getAttribute('viewBox') ?? ''} ${sheet.style.transform}`,
    );
    if (sheet !== null) {
      const now = sheet.getAttribute('viewBox') ?? '';
      if (now === region) drawnWithin += drawing;
      region = now;
      regions.add(now);
    }
  };
  const done = (): StreetMapRide => {
    observer.disconnect();
    return {
      frames,
      mutations,
      drawn,
      drawnWithin,
      views: views.size,
      regions: regions.size,
      medianRenderMs: median(times),
      worstRenderMs: Math.max(...times),
      medianFrameMs: median(intervals),
      worstFrameMs: intervals.length === 0 ? 0 : Math.max(...intervals),
      grades,
    };
  };
  if (!paced) {
    for (let frame = 0; frame < frames; frame += 1) step();
    return Promise.resolve(done());
  }
  return new Promise((resolve) => {
    let frame = 0;
    let last: number | undefined;
    const tick = (now: number): void => {
      if (last !== undefined) intervals.push(now - last);
      last = now;
      step();
      frame += 1;
      if (frame < frames) {
        window.requestAnimationFrame(tick);
        return;
      }
      resolve(done());
    };
    window.requestAnimationFrame(tick);
  });
}

async function run(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#hud');
  if (container === null) throw new Error('the harness page is missing its #hud container');
  flushSync(() => {
    createRoot(container).render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
  await document.fonts.ready;
  window.__oylStreetMap = { ready: true, errors, ride };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylStreetMap = { ready: false, errors };
});
