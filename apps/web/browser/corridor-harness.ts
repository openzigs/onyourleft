// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A route's corridor, read in a real engine — #1539.
 *
 * Through the product's own port (`world-data/corridor-port.ts`), the
 * product's own reader and its one `fetch` (`world-data/corridor-source.ts`),
 * into the product's store in this origin's real IndexedDB, from the synthetic
 * archive `corridor-fixture.ts` emits at this origin. The map-tiles switch is
 * read from `localStorage` exactly as `main.tsx` reads it, so a spec turns it
 * off the way a rider's Settings would.
 *
 * Publishes `window.__oylCorridor`: the state the read came to, how many tiles
 * were covered, the feature counts, and two digests of what the scene builds
 * at the start line — with the corridor (if any) and with none. Since #1551
 * a village's pavement sides read the corridor's footways, so the two may
 * differ when it is ready; the offline control asserts that they are equal,
 * which is the browser half of "offline, the world is today's".
 *
 * Since #1546 it also publishes {@link CorridorHarness.classed}: every
 * structure and scatter item the scene stands along the route with the
 * corridor's land-class mask, each with the class of the ground under it.
 * `?levers=-landclass` — a harness-only lever the product cannot reach —
 * hands the scene no mask, which is the browser case's control.
 *
 * Since #1540 it also publishes {@link CorridorHarness.verdicts}: what
 * `footprint-buildings.ts` §`footprintPlans` made of the corridor's
 * footprints, with the corridor's own mask, and how long that took. The spec
 * holds them to `corridor-fixture.ts` §`CORRIDOR_FIXTURE_VERDICTS`, which
 * `corridor-fixture.test.ts` holds the same plans to in Node.
 *
 * Since #1565 it also publishes {@link CorridorHarness.junctions}: every
 * mapped cross street the scene draws along the route, with each arm's
 * heading read back from its mesh (`corridor-fixture.ts` §`drawnJunctions`).
 * `?levers=-streets` — harness-only too — hands the scene the corridor with
 * its streets layer emptied, which is that case's control.
 *
 * ⚠️ What it does NOT prove: anything about the hosted archive's latency
 * (ADR 0010 D-1's 500 ms+; #1553 measures that on the tablet), or that the
 * realistic world draws anything from the corridor (#1549 draws the plans).
 */

import { openActivityStore } from '@onyourleft/store';
import { unixSeconds } from '@onyourleft/domain';

import { corridorOrigin } from '../src/game/terrain';
import { sceneFrame } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import { footprintPlans, type FootprintVerdicts } from '../src/game/footprint-buildings';
import { denseTownFixture } from '../src/game/footprint-fixtures-testing';
import { landClassMask } from '../src/game/land-class';
import type { CorridorState, WorldCorridor } from '../src/game/world-data/corridor';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';
import { readMapTilesChoice } from '../src/map/tiles-preference';
import { createWorldCorridorPort } from '../src/world-data/corridor-port';
import { corridorArchive } from '../src/world-data/corridor-source';
import { routeId } from '@onyourleft/store';

import {
  classedItems,
  CORRIDOR_ARCHIVE_FILE,
  corridorFixtureRoute,
  drawnJunctions,
  LONG_CORRIDOR_ARCHIVE_FILE,
  type ClassedItem,
  type DrawnJunction,
} from './corridor-fixture';

const QUERY = new URLSearchParams(location.search);

/** `?long`: the 600-tile corridor, for the performance budget. */
const LONG = QUERY.has('long');

/** `?levers=-landclass`: #1546's control — the scene is handed no land-class mask. */
const NO_LAND_CLASS_LEVER = (QUERY.get('levers') ?? '').split(',').includes('-landclass');

/** `?levers=-streets`: #1565's control — the scene is handed the corridor with no streets. */
const NO_STREETS_LEVER = (QUERY.get('levers') ?? '').split(',').includes('-streets');
/**
 * #1600's control: the town is planned this many times per timed sample, which
 * is a planner several times slower as far as the budget can tell.
 */
const SLOW_PLAN_PASSES = (QUERY.get('levers') ?? '').split(',').includes('slowplan') ? 8 : 1;

/**
 * #1600: a fixed workload that is not the planner — float arithmetic over a
 * typed array and short-lived small arrays, the mix planning is made of — whose
 * time is this runner's speed. It reads the same page, the same minute and the
 * same JIT as the town it normalises, and nothing under `src/` is in it, so a
 * slower planner cannot slow it.
 */
function referenceWorkloadMilliseconds(): number {
  const samples = new Float32Array(4_096);
  let best = Number.POSITIVE_INFINITY;
  let sink = 0;
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    for (let pass = 0; pass < 1_200; pass += 1) {
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = Math.sqrt(index + pass) * Math.sin(index * 0.01 + pass);
      }
      const pair = [samples[pass % samples.length] ?? 0, samples[(pass * 7) % samples.length] ?? 0];
      sink += (pair[0] ?? 0) * (pair[1] ?? 0);
    }
    best = Math.min(best, performance.now() - started);
  }
  // The result is read so the loop is not dead code to the optimiser.
  if (Number.isNaN(sink)) throw new Error('the reference workload produced NaN');
  return best;
}

export interface CorridorHarness {
  readonly state: CorridorState['kind'];
  readonly why: string | undefined;
  readonly coveredTiles: number;
  readonly buildings: number;
  readonly landUse: number;
  readonly paths: number;
  /** #1565: the streets the corridor kept. */
  readonly streets: number;
  readonly sceneDigest: string;
  readonly proceduralDigest: string;
  readonly milliseconds: number;
  /** #1546: how long building the land-class mask took, and what it holds. */
  readonly maskMilliseconds: number;
  readonly maskBytes: number;
  /** #1546: every item along the route and the class under it; empty for `?long` or no corridor. */
  readonly classed: readonly ClassedItem[];
  /** #1540: the plans' verdicts on the corridor's footprints; `undefined` with no corridor. */
  readonly verdicts: FootprintVerdicts | undefined;
  /** #1540: how long planning them took, at ride start. */
  readonly planMilliseconds: number;
  /**
   * #1540's budget: the fastest of three plans of the 2 000-footprint town
   * (`footprint-fixtures-testing.ts` §`denseTownFixture`), and what was kept.
   * 0 for `?long`.
   */
  readonly townPlanMilliseconds: number;
  readonly townKept: number;
  /** #1600: the reference workload's best of five, on this page, in this run; 0 for `?long`. */
  readonly referenceMilliseconds: number;
  /** #1565: every mapped cross street drawn along the route; empty for `?long` or no corridor. */
  readonly junctions: readonly DrawnJunction[];
  readonly errors: readonly string[];
}

declare global {
  interface Window {
    __oylCorridor?: CorridorHarness;
  }
}

/** FNV-1a over what a frame stands in the world, so two frames compare as one string. */
function digestOf(corridor: WorldCorridor | undefined): string {
  const profile = corridorFixtureRoute(LONG);
  const frame = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: atStartLine(profile),
    ...(corridor === undefined ? {} : { worldCorridor: corridor }),
  });
  const text = JSON.stringify([
    frame.scatter,
    frame.billboards,
    frame.streets,
    frame.lines,
    // #1565: the cross streets at the start line.
    frame.sideRoads.map((road) => [road.junction.along, road.junction.arms]),
  ]);
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return `${String(text.length)}:${hash.toString(16)}`;
}

async function run(): Promise<CorridorHarness> {
  const errors: string[] = [];
  const store = openActivityStore('oyl-corridor-harness');
  await ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000)));
  const profile = corridorFixtureRoute(LONG);
  const id = routeId(LONG ? 'corridor-harness-long' : 'corridor-harness-route');
  await store.putRoute({
    id,
    createdBy: LOCAL_ATHLETE,
    name: 'Corridor harness',
    profile,
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  });
  const port = createWorldCorridorPort({
    store,
    owner: LOCAL_ATHLETE,
    basemap: () => ({
      archiveUrl: new URL(
        `/${LONG ? LONG_CORRIDOR_ARCHIVE_FILE : CORRIDOR_ARCHIVE_FILE}`,
        location.href,
      ).href,
      attribution: '',
    }),
    archive: corridorArchive,
    mapTilesOn: () => readMapTilesChoice(localStorage),
    realisticOn: () => true,
    recording: () => false,
    now: () => new Date(),
    log: (line) => errors.push(line),
  });
  const started = performance.now();
  const state = await port.load({ id, profile }, new AbortController().signal, () => undefined);
  const milliseconds = performance.now() - started;
  const ready = state.kind === 'ready' ? state.corridor : undefined;
  const kept = await store.getWorldCorridor(LOCAL_ATHLETE, id);
  store.close();
  // #1546: the mask, built once from the ready corridor, as `GameView` builds it at the press.
  const maskStarted = performance.now();
  const mask = ready === undefined ? undefined : landClassMask(ready);
  const maskMilliseconds = performance.now() - maskStarted;
  // #1540: the plans, once, as a ride's start would make them.
  const planStarted = performance.now();
  const verdicts =
    ready === undefined || mask === undefined
      ? undefined
      : footprintPlans(ready, mask, profile, corridorOrigin(profile)).verdicts;
  const planMilliseconds = performance.now() - planStarted;
  let townPlanMilliseconds = 0;
  let townKept = 0;
  let referenceMilliseconds = 0;
  if (!LONG) {
    referenceMilliseconds = referenceWorkloadMilliseconds();
    const town = denseTownFixture();
    const townLand = landClassMask(town.corridor);
    townPlanMilliseconds = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      for (let pass = 0; pass < SLOW_PLAN_PASSES; pass += 1) {
        townKept = footprintPlans(town.corridor, townLand, town.profile, town.origin).verdicts.kept;
      }
      townPlanMilliseconds = Math.min(townPlanMilliseconds, performance.now() - started);
    }
  }
  const classed =
    ready === undefined || mask === undefined || LONG
      ? []
      : classedItems(ready, NO_LAND_CLASS_LEVER ? undefined : mask, mask);
  // #1565: the cross streets, through the scene, from the corridor as read —
  // or, for the control, the same corridor with its streets layer off.
  const junctions =
    ready === undefined || LONG
      ? []
      : drawnJunctions(NO_STREETS_LEVER ? { ...ready, streets: [] } : ready, mask);
  return {
    state: state.kind,
    why: 'why' in state ? state.why : undefined,
    coveredTiles: kept?.tiles.filter((tile) => tile.state === 'covered').length ?? 0,
    buildings: ready?.buildings.length ?? 0,
    landUse: ready?.landUse.length ?? 0,
    paths: ready?.paths.length ?? 0,
    streets: ready?.streets.length ?? 0,
    sceneDigest: digestOf(ready),
    proceduralDigest: digestOf(undefined),
    milliseconds,
    maskMilliseconds,
    maskBytes: mask?.bytes ?? 0,
    classed,
    verdicts,
    planMilliseconds,
    townPlanMilliseconds,
    townKept,
    referenceMilliseconds,
    junctions,
    errors,
  };
}

void run().then(
  (result) => {
    window.__oylCorridor = result;
  },
  (error: unknown) => {
    window.__oylCorridor = {
      state: 'unavailable',
      why: undefined,
      coveredTiles: 0,
      buildings: 0,
      landUse: 0,
      paths: 0,
      streets: 0,
      sceneDigest: '',
      proceduralDigest: '',
      milliseconds: 0,
      maskMilliseconds: 0,
      maskBytes: 0,
      classed: [],
      verdicts: undefined,
      planMilliseconds: 0,
      townPlanMilliseconds: 0,
      townKept: 0,
      referenceMilliseconds: 0,
      junctions: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  },
);
