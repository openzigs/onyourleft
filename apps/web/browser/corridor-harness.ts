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
 * is a planner this many times slower as far as the budget can tell. #1604
 * raised it from 8 so that the control clears the budget by a wide margin on
 * every runner rather than by a few per cent on a slow one.
 */
const SLOW_PLAN_PASSES = (QUERY.get('levers') ?? '').split(',').includes('slowplan') ? 16 : 1;

/**
 * #1604: how many (reference, town) pairs are timed. The control plans the
 * town sixteen times a sample, so it takes three to stay inside the test's
 * timeout on a slow runner.
 */
const TOWN_PAIRS = SLOW_PLAN_PASSES === 1 ? 7 : 3;

/** #1604: untimed rounds of the reference and of one plan before the pairs. */
const WARM_UP_ROUNDS = 8;

/**
 * #1600, reshaped by #1604: a fixed workload that is not the planner, whose
 * time is this runner's speed. It is made of what planning is made of —
 * 2 000 small shapes built from point tuples that are sorted, flattened
 * through a `number[]` into a `Float32Array`, bucketed in a `Map` grid and
 * queried for neighbours into object lists — and every one of them escapes
 * into the returned array, so the allocation and the collector are measured
 * along with the arithmetic. #1600's float loop was not: on a shared runner it
 * slowed 3.2× where the planner slowed 2.3×, and the budget it set was too
 * lenient. Nothing under `src/` is in it, so a slower planner cannot slow it.
 */
interface ReferenceShape {
  readonly ring: Float32Array;
  readonly walls: Float32Array;
  readonly centre: { readonly x: number; readonly y: number };
  readonly near: { readonly index: number; readonly apart: number }[];
}

const REFERENCE_SHAPES = 2_000;
const REFERENCE_CELL_METRES = 50;
const REFERENCE_STOREYS = 3;
/** Two triangles a wall panel: which end of the edge, and bottom or top. */
const REFERENCE_QUAD: readonly (readonly [0 | 1, 0 | 1])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 0],
  [1, 1],
  [0, 1],
];

function referenceWorkload(): readonly ReferenceShape[] {
  let seed = 0x25_45_f4_91;
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
  const cellKey = (x: number, y: number): number =>
    Math.floor(x / REFERENCE_CELL_METRES) * 4_096 + Math.floor(y / REFERENCE_CELL_METRES);
  const shapes: ReferenceShape[] = [];
  const grid = new Map<number, number[]>();
  for (let index = 0; index < REFERENCE_SHAPES; index += 1) {
    const x = random() * 1_500;
    const y = random() * 1_500;
    const points: [number, number][] = [];
    for (let vertex = 0; vertex < 24; vertex += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 4 + random() * 12;
      points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const flat: number[] = [];
    for (const point of points) flat.push(point[0], point[1]);
    // Walls, as the planner writes them: eight floats a vertex pushed onto a
    // growing `number[]`, copied into a `Float32Array` that the shape keeps.
    // The planner writes about 17 KB of these a footprint, 34 MB a town, and
    // this is about as much; it is the bulk of what both put through memory.
    const walls: number[] = [];
    for (let storey = 0; storey < REFERENCE_STOREYS; storey += 1) {
      for (let edge = 0; edge < points.length; edge += 1) {
        const a = points[edge] ?? [x, y];
        const b = points[(edge + 1) % points.length] ?? [x, y];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = (b[1] - a[1]) / length;
        const nz = (a[0] - b[0]) / length;
        for (const [corner, up] of REFERENCE_QUAD) {
          const at = corner === 0 ? a : b;
          walls.push(at[0], (storey + up) * 3, at[1], nx, 0, nz, corner * length, up);
        }
      }
    }
    const key = cellKey(x, y);
    const cell = grid.get(key);
    if (cell === undefined) grid.set(key, [index]);
    else cell.push(index);
    shapes.push({
      ring: Float32Array.from(flat),
      walls: Float32Array.from(walls),
      centre: { x, y },
      near: [],
    });
  }
  for (const [index, shape] of shapes.entries()) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const cell = grid.get(
          cellKey(
            shape.centre.x + dx * REFERENCE_CELL_METRES,
            shape.centre.y + dy * REFERENCE_CELL_METRES,
          ),
        );
        for (const other of cell ?? []) {
          if (other === index) continue;
          const there = shapes[other];
          if (there === undefined) continue;
          const apart = Math.hypot(
            there.centre.x - shape.centre.x,
            there.centre.y - shape.centre.y,
          );
          if (apart <= REFERENCE_CELL_METRES) shape.near.push({ index: other, apart });
        }
      }
    }
    shape.near.sort((a, b) => a.apart - b.apart);
  }
  return shapes;
}

/** How many times one reference sample builds the shapes: about the town's own time. */
const REFERENCE_ROUNDS = 2;

/** One timed sample of {@link referenceWorkload}; its result is read so it is not dead code. */
function referenceMillisecondsOnce(): number {
  const kept: (readonly ReferenceShape[])[] = [];
  const started = performance.now();
  for (let round = 0; round < REFERENCE_ROUNDS; round += 1) kept.push(referenceWorkload());
  const milliseconds = performance.now() - started;
  if (kept.some((shapes) => shapes.length !== REFERENCE_SHAPES)) {
    throw new Error('the reference workload did not run');
  }
  return milliseconds;
}

/** The middle value; the samples are few and a collector pause can land on either side. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
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
   * #1540's budget: the fastest of the paired plans of the 2 000-footprint town
   * (`footprint-fixtures-testing.ts` §`denseTownFixture`), and what was kept.
   * 0 for `?long`.
   */
  readonly townPlanMilliseconds: number;
  readonly townKept: number;
  /** #1600: the reference workload's fastest sample, on this page, in this run; 0 for `?long`. */
  readonly referenceMilliseconds: number;
  /**
   * #1604: each town sample over the reference sample timed next to it, in
   * order; the budget is read from their median. Empty for `?long`.
   */
  readonly townRatios: readonly number[];
  readonly townRatio: number;
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
  const townRatios: number[] = [];
  if (!LONG) {
    const town = denseTownFixture();
    const townLand = landClassMask(town.corridor);
    const planTown = (): number => {
      const started = performance.now();
      for (let pass = 0; pass < SLOW_PLAN_PASSES; pass += 1) {
        townKept = footprintPlans(town.corridor, townLand, town.profile, town.origin).verdicts.kept;
      }
      return performance.now() - started;
    };
    // Untimed rounds of each first, so that neither is still being compiled
    // inside a sample. Where the runner has no spare core for V8's background
    // compiler — a shared CI runner — the planner, the larger of the two, is
    // compiled for longer, and one round left the ratio 40 % high (#1604).
    for (let warm = 0; warm < WARM_UP_ROUNDS; warm += 1) {
      referenceMillisecondsOnce();
      footprintPlans(town.corridor, townLand, town.profile, town.origin);
    }
    townPlanMilliseconds = Number.POSITIVE_INFINITY;
    referenceMilliseconds = Number.POSITIVE_INFINITY;
    for (let pair = 0; pair < TOWN_PAIRS; pair += 1) {
      // The order alternates so that a runner speeding up or slowing down
      // across the pairs is not always charged to the same side.
      let reference: number;
      let plan: number;
      if (pair % 2 === 0) {
        reference = referenceMillisecondsOnce();
        plan = planTown();
      } else {
        plan = planTown();
        reference = referenceMillisecondsOnce();
      }
      townRatios.push(plan / reference);
      townPlanMilliseconds = Math.min(townPlanMilliseconds, plan);
      referenceMilliseconds = Math.min(referenceMilliseconds, reference);
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
    townRatios,
    townRatio: townRatios.length === 0 ? 0 : median(townRatios),
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
      townRatios: [],
      townRatio: 0,
      junctions: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  },
);
