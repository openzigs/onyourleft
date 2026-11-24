// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the open-world half of the browser gate drives — #3107.
 *
 * It mounts the **real** `GameView`, with the **real** renderer
 * (`three-renderer.ts` §`threeGameRenderer`) and the product's own open-world
 * session, area reader, decoder, street graph and rolling route, over a
 * fixture archive of streets written in `fixture-testing.ts` (no map data, no
 * place): a dense town three blocks long whose street names begin a kilometre
 * from the start. The rider is given 300 W, and the ride is driven a frame at
 * a time from the spec, on a clock the page keeps, so a kilometre and a half
 * of road — a change of the road's view, a change of block, a junction every
 * 100 m, the first named street — is ridden in a few seconds.
 *
 * ## What it counts
 *
 * **Every `linkProgram` the page issues**, on any WebGL context, from the
 * moment the script runs. A link inside a frame of the ride is a program built
 * inside it — on the owner's tablet, 0.9 s to 1.2 s each (#3107). The spec
 * holds the count from the ride's first drawn frame to its end at nought.
 *
 * ## What it does not prove
 *
 * - **A realistic world of map data.** `?world=realistic` rides the same town
 *   in the realistic world, loaded before the game is mounted as a second
 *   realistic ride of a visit finds it, with houses along the street that
 *   begin 700 m on (`fixture-testing.ts` §`OPEN_WORLD_NEW_AREA_HOUSES`), so
 *   the first set of mapped buildings with a house in it arrives mid-ride.
 *   What it counts there is the programs of what the fixture carries: its
 *   houses are plain footprints, and it has no land use, footway or village.
 * - **A tablet's milliseconds.** SwiftShader offers no
 *   `KHR_parallel_shader_compile`, and what a link costs here is not what it
 *   costs a phone. A link counted is a link, whatever it costs.
 * - **Map data.** The fixture carries streets, their names and, in the
 *   realistic world, plain houses: no land use. What that adds mid-ride is
 *   not ridden here.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { watts } from '@onyourleft/domain';

import { GameView, type GamePort } from '../src/game/GameView';
import { createOpenWorldEntry } from '../src/game/open-world/entry';
import {
  fixtureStart,
  OPEN_WORLD_NEW_AREA_HOUSES,
  OPEN_WORLD_NEW_AREA_STREETS,
  openWorldFixtureArchive,
  START_COLUMN,
  START_ROW,
} from '../src/game/open-world/fixture-testing';
import type { OpenWorldSessions } from '../src/game/open-world/ride';
import type { OpenWorldRoad } from '../src/game/open-world/road';
import { createOpenWorldSession } from '../src/game/open-world/session';
import { lazyOpenWorldSessions } from '../src/game/open-world/session-lazy';
import type { GameRenderer, GameView as RenderedView, SceneFrame } from '../src/game/port';
import {
  drawnWorldOf,
  loadGameWordmark,
  loadRealisticWorld,
  loadSceneryModels,
  mappedBuildingsDrawnOf,
  programsOf,
  threeGameRenderer,
} from '../src/game/three-renderer';
import { REALISTIC_WORLD_STORAGE_KEY } from '../src/game/world-preference';
import { countingSource } from '../src/world-data/archive-testing';
import { corridorArchiveFrom } from '../src/world-data/corridor-source';

import '../src/design/theme.css';
import '../src/design/tailwind.css';

/** What one stretch of the ride did, as the spec reads it. */
export interface OpenWorldRideReport {
  /** Frames drawn in the stretch. */
  readonly frames: number;
  /** How far the rider is from the start, metres, at its end. */
  readonly ridden: number;
  /** Programs linked inside the stretch's frames. */
  readonly links: number;
  /** Each frame of the stretch that linked a program: how far on, and how many. */
  readonly linkedAt: readonly (readonly [number, number])[];
  /** The renderer's programs that were not there when the stretch began. */
  readonly newPrograms: readonly string[];
  /** How many times the road's view and the streets held changed in the stretch. */
  readonly viewChanges: number;
  readonly corridorChanges: number;
  /** Street-name letters the last frame carried. */
  readonly nameLetters: number;
  /** The most mapped buildings any frame of the stretch drew: none in the stylised world. */
  readonly buildings: number;
  /** The world the last frame was drawn in. */
  readonly world: string;
}

export interface OpenWorldHarness {
  readonly ready: boolean;
  readonly errors: readonly string[];
  /**
   * Presses *Ride Open world* and draws the ride's first frame — in the
   * realistic world, where the page asked for it, which the game prepares the
   * view for again once it is handed it. Resolves to the links so far.
   */
  start(): Promise<number>;
  /** Rides on to `metres` from the start, a frame every `frameMs` of ride time. */
  ride(metres: number, frameMs: number): Promise<OpenWorldRideReport>;
  /** Whether the view's renderer reads each program's info log as it links. */
  shaderErrorsChecked(): boolean | undefined;
}

declare global {
  interface Window {
    __oylOpenWorld?: OpenWorldHarness;
  }
}

const errors: string[] = [];

// --- Every link, on every context --------------------------------------------

let links = 0;
for (const context of [
  typeof WebGL2RenderingContext === 'undefined' ? undefined : WebGL2RenderingContext,
  typeof WebGLRenderingContext === 'undefined' ? undefined : WebGLRenderingContext,
]) {
  if (context === undefined) continue;
  const prototype = context.prototype as {
    linkProgram: (this: unknown, program: WebGLProgram) => void;
  };
  const original = prototype.linkProgram;
  prototype.linkProgram = function counted(this: unknown, program: WebGLProgram): void {
    links += 1;
    original.call(this, program);
  };
}

// --- The page's own clock and frames -----------------------------------------

let nowMs = 0;
/**
 * The clock the quality ladder reads frame times on: a 60 Hz frame a frame,
 * however much ride time the frame is. On the ride's clock a frame a second
 * long reads as a device that cannot keep up, the ladder steps down a rung,
 * and a rung's programs are built on the frame it is stepped to — which is
 * the ladder's own cost, once a ride (`three-renderer.ts` §`prepare`), and
 * not a new area's.
 */
let wallMs = 0;
const pending: FrameRequestCallback[] = [];
window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  pending.push(callback);
  return pending.length;
};
window.cancelAnimationFrame = (): void => undefined;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Draws the next frame the game asked for, `frameMs` on. `false` when it has asked for none. */
function pump(frameMs: number): boolean {
  const next = pending.shift();
  if (next === undefined) return false;
  nowMs += frameMs;
  wallMs += 1000 / 60;
  next(nowMs);
  return true;
}

// --- The view and the road, kept as the game is handed them -------------------

let view: RenderedView | undefined;
let lastFrame: SceneFrame | undefined;
let framesDrawn = 0;
let road: OpenWorldRoad | undefined;

const renderer: GameRenderer = {
  ...threeGameRenderer,
  create: (...args) => {
    const made = threeGameRenderer.create(...args);
    view = made;
    return new Proxy(made, {
      get(target, property) {
        if (property === 'render') {
          return (frame: SceneFrame): void => {
            lastFrame = frame;
            framesDrawn += 1;
            target.render(frame);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function'
          ? (value as (...inner: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  },
};

/** How far the rider is from where the ride began, metres: the ride is drawn in one frame, from its start. */
function ridden(): number {
  const rider = lastFrame?.markers.find((marker) => marker.kind === 'rider');
  return rider === undefined ? 0 : Math.hypot(rider.x, rider.z);
}

/** Whether the page was asked for the realistic world: `?world=realistic`. */
const realistic = new URLSearchParams(location.search).get('world') === 'realistic';

async function main(): Promise<void> {
  await Promise.all([loadSceneryModels(), loadGameWordmark()]);
  if (realistic) {
    // The rider's choice, as Settings writes it, and the world already here,
    // as a visit's second realistic ride finds it: the game is handed it
    // with the view, and prepares the view for it before the ride is drawn.
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    const outcome = await loadRealisticWorld();
    if (!outcome.loaded) throw new Error(`the realistic world did not load: ${outcome.detail}`);
  }
  const source = countingSource(
    await openWorldFixtureArchive(
      OPEN_WORLD_NEW_AREA_STREETS,
      2,
      realistic ? OPEN_WORLD_NEW_AREA_HOUSES : [],
    ),
  );
  const entry = createOpenWorldEntry();
  entry.hand(fixtureStart(START_COLUMN, START_ROW));
  const real = lazyOpenWorldSessions(
    {
      entry,
      basemap: () => ({ archiveUrl: 'https://tiles.example.invalid/a.pmtiles', attribution: '' }),
      mapTilesOn: () => true,
    },
    () =>
      Promise.resolve((start) =>
        createOpenWorldSession({
          start,
          archive: corridorArchiveFrom(source),
          mapTilesOn: () => true,
          // No wait before a crossing's blocks are asked for: the ride here is seconds long.
          random: () => 0,
        }),
      ),
  );
  // The product's sessions, with the ride's road kept as it is handed over.
  const sessions: OpenWorldSessions = {
    ...real,
    take: () => real.take(),
    open: (start) => {
      const session = real.open(start);
      return {
        ...session,
        ready: session.ready.then((ready) =>
          ready.kind !== 'ready'
            ? ready
            : {
                ...ready,
                road: () => {
                  road = ready.road();
                  return road;
                },
              },
        ),
        stop: () => {
          session.stop();
        },
      };
    },
  };
  const port: GamePort = {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: sessions,
  };
  const host = document.getElementById('root');
  if (host === null) throw new Error('no #root on the page');
  createRoot(host).render(
    <StrictMode>
      <GameView
        port={port}
        renderer={() => Promise.resolve(renderer)}
        now={() => nowMs}
        frameNow={() => wallMs}
      />
    </StrictMode>,
  );

  const rideButton = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll('button')].find(
      (button) => (button.textContent ?? '') === 'Ride Open world',
    );

  window.__oylOpenWorld = {
    ready: true,
    errors,
    start: async () => {
      for (let waited = 0; rideButton() === undefined && waited < 20_000; waited += 20) {
        await sleep(20);
      }
      const button = rideButton();
      if (button === undefined) throw new Error('the open-world ride was never offered');
      button.click();
      // The game prepares its first frame off the screen, and draws when that settles.
      for (let waited = 0; framesDrawn === 0 && waited < 30_000; waited += 10) {
        pump(1000 / 60);
        await sleep(10);
      }
      if (framesDrawn === 0) throw new Error('the ride drew no frame');
      if (realistic) {
        // And on until a frame is drawn in the realistic world: the game
        // draws none while the view is prepared for it.
        let drawnIn = -1;
        for (let waited = 0; waited < 60_000; waited += 10) {
          const world = view === undefined ? undefined : drawnWorldOf(view);
          if (world === 'realistic' && drawnIn < 0) drawnIn = framesDrawn;
          if (drawnIn >= 0 && framesDrawn > drawnIn + 1) break;
          pump(1000 / 60);
          await sleep(10);
        }
        if (drawnIn < 0) throw new Error('the ride never drew the realistic world');
      }
      return links;
    },
    ride: async (metres, frameMs) => {
      const linksBefore = links;
      const framesBefore = framesDrawn;
      const programsBefore = new Set(view === undefined ? [] : (programsOf(view)?.names ?? []));
      const linkedAt: [number, number][] = [];
      let viewChanges = 0;
      let corridorChanges = 0;
      let profile = road?.view.profile;
      let corridor = road?.streets();
      let buildings = 0;
      for (let idle = 0; ridden() < metres && idle < 2_000;) {
        const before = links;
        if (pump(frameMs)) idle = 0;
        else idle += 1;
        if (links !== before) linkedAt.push([Math.round(ridden()), links - before]);
        if (view !== undefined)
          buildings = Math.max(buildings, mappedBuildingsDrawnOf(view).length);
        if (road !== undefined && road.view.profile !== profile) {
          viewChanges += 1;
          profile = road.view.profile;
        }
        if (road !== undefined && road.streets() !== corridor) {
          corridorChanges += 1;
          corridor = road.streets();
        }
        // The session reads blocks and its workers answer between frames.
        await sleep(0);
      }
      return {
        frames: framesDrawn - framesBefore,
        ridden: ridden(),
        links: links - linksBefore,
        linkedAt,
        newPrograms: (view === undefined ? [] : (programsOf(view)?.names ?? [])).filter(
          (name) => !programsBefore.has(name),
        ),
        viewChanges,
        corridorChanges,
        nameLetters: lastFrame?.streetNames?.cells.length ?? 0,
        buildings,
        world: view === undefined ? 'none' : drawnWorldOf(view),
      };
    },
    shaderErrorsChecked: () => (view === undefined ? undefined : programsOf(view)?.checked),
  };
}

window.__oylOpenWorld = {
  ready: false,
  errors,
  start: () => Promise.reject(new Error('the page is not ready')),
  ride: () => Promise.reject(new Error('the page is not ready')),
  shaderErrorsChecked: () => undefined,
};
main().catch((error: unknown) => {
  errors.push(String(error));
});
