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
 * ## The corridor is a dense synthetic town, on purpose
 *
 * A street every 100 m both ways across 2 km either side of a 40 km route, a
 * vertex every 20 m, footways between them and a lake every 4 km: more shapes
 * within a kilometre of the rider than a real corridor holds anywhere but a
 * city centre, so what this page costs is an upper end rather than a typical
 * ride. It is arithmetic, and no map data from anywhere.
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

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  metres,
  metresPerSecond,
  routeProfile,
  seconds,
  watts,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { HudPanel } from '../src/game/hud/HudPanel';
import type { GameState } from '../src/game/simulation';
import type { WorldCorridor } from '../src/game/world-data/corridor';

import '../src/design/theme.css';
import '../src/design/tailwind.css';

/** What a ride of the page reports. */
export interface StreetMapRide {
  readonly frames: number;
  /** DOM mutation records under the plan view's SVG, attribute and child alike. */
  readonly mutations: number;
  /** How many different `viewBox` values the SVG had. */
  readonly views: number;
  /** Milliseconds of script per frame spent rendering the HUD, the median and the worst. */
  readonly medianRenderMs: number;
  readonly worstRenderMs: number;
  /** Milliseconds between animation frames, the median and the worst: the frame budget as spent. */
  readonly medianFrameMs: number;
  readonly worstFrameMs: number;
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

/** 40 km due north from 40° N, 75° W. */
function route(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(40 + (index * 100) / 111_320),
        degreesLongitude(-75),
      ),
      elevation: altitudeMetres(60 + 20 * Math.sin(index / 30)),
    });
  }
  return routeProfile(points);
}

/** A line from (x0, z0) to (x1, z1) with a vertex every 20 m. */
function line(x0: number, z0: number, x1: number, z1: number): Float32Array {
  const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 20));
  const values: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    values.push(x0 + ((x1 - x0) * step) / steps, z0 + ((z1 - z0) * step) / steps);
  }
  return Float32Array.from(values);
}

/** The dense synthetic town: see the module note. Clipped to 1 km tiles, as the archive's are. */
function town(): WorldCorridor {
  const streets: WorldCorridor['streets'][number][] = [];
  const paths: WorldCorridor['paths'][number][] = [];
  const landUse: WorldCorridor['landUse'][number][] = [];
  const coveredBoxes: WorldCorridor['coveredBoxes'][number][] = [];
  for (let tileZ = 0; tileZ < 40_000; tileZ += 1000) {
    for (const tileX of [-2000, -1000, 0, 1000]) {
      coveredBoxes.push({ minX: tileX, minZ: tileZ, maxX: tileX + 1000, maxZ: tileZ + 1000 });
      for (let offset = 0; offset < 1000; offset += 100) {
        const street = { kind: 'minor_road', kindDetail: '', grade: 'ground' as const };
        streets.push({
          ...street,
          line: line(tileX + offset, tileZ, tileX + offset, tileZ + 1000),
        });
        streets.push({
          ...street,
          line: line(tileX, tileZ + offset, tileX + 1000, tileZ + offset),
        });
        paths.push({
          kind: 'path',
          kindDetail: 'footway',
          line: line(tileX + offset + 50, tileZ, tileX + offset + 50, tileZ + 1000),
        });
      }
    }
    if (tileZ % 4000 === 0) {
      const ring: number[] = [];
      for (let corner = 0; corner < 48; corner += 1) {
        const angle = (corner / 48) * 2 * Math.PI;
        ring.push(600 + 250 * Math.cos(angle), tileZ + 500 + 180 * Math.sin(angle));
      }
      landUse.push({ layer: 'water', kind: 'lake', rings: [Float32Array.from(ring)] });
    }
  }
  return {
    routeId: 'street-map-harness',
    origin: { latitude: 40, longitude: -75, elevation: 60 },
    covered: () => true,
    coveredBoxes,
    landUse,
    buildings: [],
    paths,
    streets,
  };
}

const PROFILE = route();
const CORRIDOR = town();
const STREET = new URL(window.location.href).searchParams.get('map') !== 'outline';
/** Five kilometres in, so every field has something to say. */
const START = 5_000;

function stateAt(distance: number): GameState {
  return {
    ride: { speed: metresPerSecond(11.1), distance: metres(distance) },
    elapsed: seconds(450),
    ridden: seconds(450),
    grade: gradeAt(PROFILE, metres(distance)),
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
  const views = new Set<string>();
  const times: number[] = [];
  const intervals: number[] = [];
  let distance = START;
  const step = (): void => {
    distance += metresPerFrame;
    const before = performance.now();
    flushSync(() => {
      move(distance);
    });
    times.push(performance.now() - before);
    mutations += observer.takeRecords().length;
    views.add(svg.getAttribute('viewBox') ?? '');
  };
  const done = (): StreetMapRide => {
    observer.disconnect();
    return {
      frames,
      mutations,
      views: views.size,
      medianRenderMs: median(times),
      worstRenderMs: Math.max(...times),
      medianFrameMs: median(intervals),
      worstFrameMs: intervals.length === 0 ? 0 : Math.max(...intervals),
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
