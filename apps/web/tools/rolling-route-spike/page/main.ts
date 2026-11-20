// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike page: a scripted moving ride through real streamed z15 tiles
 * that turns 90° every 300 to 500 m, drawn by the product's own renderer, with
 * the town planned on the main thread or in a worker. Throwaway (see
 * `../rolling-profile.ts`); `../run-page.mjs` drives it and writes
 * `../results/`.
 *
 * Query: `world=stylised|realistic`, `planning=main|worker`,
 * `place=suburb|city`, `seconds=` (of riding, after a 3 s warm-up),
 * `block=` (z15 tiles a side), `seed=`.
 *
 * ## What happens at a junction
 *
 * The profile holds the leg the rider is on and the default branch past its
 * junction: straight on for {@link STRAIGHT_ON_METRES}. {@link DECIDE_BEFORE_METRES}
 * before the junction the scripted choice is made, and the profile's tail is
 * swapped for the turned street ({@link RollingProfile.swapTail}): a new
 * `RouteProfile` object, which every per-profile cache in `scene.ts` sees as a
 * new route, and a re-plan of the town against it. Then the rider rides
 * through the corner and the view swings 90°. Both moments are recorded.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  positionAt,
  type GeographicPosition,
} from '@onyourleft/domain';

import { mappedTown } from '../../../src/game/footprint-buildings';
import type { FootprintPlan } from '../../../src/game/footprint-buildings';
import type { LandClassMask } from '../../../src/game/land-class';
import type { UrbanClassMap } from '../../../src/game/urban-class';
import type { WorldCorridor } from '../../../src/game/world-data/corridor';
import { mappedBuildingsOf } from '../../../src/game/mapped-buildings';
import { INITIAL_QUALITY, worldRung } from '../../../src/game/quality';
import { corridorOrigin, VIEW_AHEAD_METRES } from '../../../src/game/terrain';
import {
  loadRealisticWorld,
  loadSceneryModels,
  threeGameRenderer,
} from '../../../src/game/three-renderer';
import { PUBLISHED_BASEMAP_URL } from '../../../src/map/basemap';
import { archiveSource, corridorArchiveFrom } from '../../../src/world-data/corridor-source';
import { drawCounter } from '../../../browser/realistic/draws';
import { rideFrame } from '../../../browser/realistic/frame';
import { blocksWithin } from '../block-grid';
import { RollingProfile } from '../rolling-profile';
import { summariseRun, type PlanTimings, type SpikeRun } from '../summary';
import { legEnds, moved, turningLegs } from '../turning-ride';

import { blocksCorridor, planGround, planTown, readBlock, type ReadBlock } from './plan';
import type { FromWorker, ToWorker } from './plan-worker';

/** How far before a junction the choice is made: where the epic's prompt would be answered. */
export const DECIDE_BEFORE_METRES = 150;
/** The default branch drawn past a junction until the choice: straight on. */
export const STRAIGHT_ON_METRES = 600;
/** What must be read round the rider: everything up to the fog. */
const NEED_METRES = VIEW_AHEAD_METRES;
/** How much further than that a block is asked for. */
const LEAD_METRES = 200;
const SPEED_METRES_PER_SECOND = 30 / 3.6;
const WARM_UP_SECONDS = 3;

/** Two public crossroads on north–south grids: a suburb's and a city centre's. */
const PLACES = {
  // Oak Park, Illinois: Oak Park Avenue at Lake Street.
  suburb: { latitude: 41.8885, longitude: -87.7945 },
  // Chicago's Loop: State Street at Madison Street.
  city: { latitude: 41.8819, longitude: -87.6278 },
} as const;

declare global {
  interface Window {
    __spike?: SpikeRun;
  }
}

const result: SpikeRun = {
  ready: false,
  done: false,
  config: {},
  frames: [],
  longTasks: [],
  swaps: [],
  junctions: [],
  plans: [],
  blocks: [],
  tilesAsked: 0,
};
window.__spike = result;

/** The median gap between `count` idle animation frames: the display's interval. */
function displayInterval(count: number): Promise<number> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const tick = (now: number): void => {
      stamps.push(now);
      if (stamps.length > count) {
        const gaps = stamps.slice(1).map((at, index) => at - (stamps[index] as number));
        gaps.sort((a, b) => a - b);
        resolve(gaps[Math.floor(gaps.length / 2)] as number);
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const world = params.get('world') === 'realistic' ? 'realistic' : 'stylised';
  const planning = params.get('planning') === 'worker' ? 'worker' : 'main';
  const placeName = params.get('place') === 'city' ? 'city' : 'suburb';
  const seconds = Number(params.get('seconds') ?? '300');
  const size = Number(params.get('block') ?? '1');
  const seed = Number(params.get('seed') ?? '1');
  result.config = { world, planning, place: placeName, seconds, block: size, seed };

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      result.longTasks.push({ at: entry.startTime, durationMs: entry.duration });
    }
  }).observe({ type: 'longtask', buffered: true });

  const counter = drawCounter(WebGL2RenderingContext.prototype);
  await loadSceneryModels();
  if (world === 'realistic') {
    const outcome = await loadRealisticWorld();
    result.outcome = outcome.loaded ? 'loaded' : 'failed';
  }

  // The ride: the legs, the junctions, and the profile with its default branch.
  const place = PLACES[placeName];
  const start = geographicPosition(
    degreesLatitude(place.latitude),
    degreesLongitude(place.longitude),
  );
  const legs = turningLegs(seed, 80, 0);
  const corners = legEnds(start, legs);
  const rolling = new RollingProfile({ position: start, elevation: 0 });
  const branch = (k: number): { position: GeographicPosition }[] => {
    const corner = corners[k] as GeographicPosition;
    return [
      { position: corner },
      { position: moved(corner, legs[k]?.heading ?? 0, STRAIGHT_ON_METRES) },
    ];
  };
  rolling.append(branch(0));
  const origin = corridorOrigin(rolling.view());

  /** The sample nearest corner `k` in the profile as it is: where junction `k` is, in route metres. */
  const junctionAt = (k: number): number => {
    const view = rolling.view();
    const corner = corners[k] as GeographicPosition;
    let best = 0;
    let bestGap = Infinity;
    view.positions.forEach((position, index) => {
      const gap = Math.hypot(
        position.latitude - corner.latitude,
        (position.longitude - corner.longitude) * Math.cos((corner.latitude * Math.PI) / 180),
      );
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    return best * view.resolution;
  };

  // The map: blocks on the fixed grid, read on this thread or in the worker.
  const held = new Map<number, ReadBlock>();
  const asked = new Set<number>();
  let dirtySince: number | undefined;
  const markDirty = (): void => {
    dirtySince ??= performance.now();
  };
  const signal = new AbortController().signal;
  const archive = corridorArchiveFrom(archiveSource(PUBLISHED_BASEMAP_URL));
  const opening = await archive.open(signal);
  if (opening.kind !== 'open') throw new Error('the archive is not the basemap schema');
  const worker =
    planning === 'worker'
      ? new Worker(new URL('./plan-worker.ts', import.meta.url), { type: 'module' })
      : undefined;
  const send = (message: ToWorker): void => worker?.postMessage(message);
  send({ kind: 'open', url: PUBLISHED_BASEMAP_URL, origin, size });

  const arrived = (block: ReadBlock): void => {
    held.set(block.key, block);
    result.blocks.push({
      at: performance.now(),
      key: block.key,
      readMs: block.readMs,
      decodeMs: block.decodeMs,
      bytes: block.bytes,
      tiles: block.tiles.length,
      buildings: block.features.buildings.length,
    });
    markDirty();
  };
  let pendingReads = 0;
  const ensure = (distance: number): void => {
    const at = positionAt(rolling.view(), distance);
    for (const key of blocksWithin(at, NEED_METRES + LEAD_METRES, size)) {
      if (asked.has(key)) continue;
      asked.add(key);
      result.tilesAsked += size * size;
      pendingReads += 1;
      if (worker !== undefined) send({ kind: 'read', key });
      else
        readBlock(archive, key, size, origin, signal).then(
          (block) => {
            pendingReads -= 1;
            arrived(block);
          },
          () => {
            pendingReads -= 1;
          },
        );
    }
  };

  // The town, planned against the profile as it is.
  let town: Parameters<typeof rideFrame>[0]['town'];
  let planId = 0;
  let inFlight:
    | {
        id: number;
        profile: ReturnType<RollingProfile['view']>;
        keys: readonly number[];
        since: number;
      }
    | undefined;
  let rider = 0;
  const nearKeys = (): number[] => {
    const near = blocksWithin(positionAt(rolling.view(), rider), NEED_METRES + LEAD_METRES, size);
    return [...near].filter((key) => held.has(key));
  };
  const corridorOf = (keys: readonly number[]): WorldCorridor =>
    blocksCorridor(
      keys.map((key) => held.get(key) as ReadBlock),
      origin,
    );
  /** Puts plans in the frame: the buildings' index and the lots, built here on either path. */
  const apply = (
    corridor: WorldCorridor,
    ground: { readonly land: LandClassMask; readonly urban: UrbanClassMap },
    plans: readonly FootprintPlan[],
    record: { readonly timings: PlanTimings; readonly workerMs?: number },
    mainSoFar: number,
    since: number,
  ): void => {
    const from = performance.now();
    town = {
      corridor,
      land: ground.land,
      buildings: mappedBuildingsOf(plans),
      lots: mappedTown(corridor, plans, ground.urban),
    };
    result.plans.push({
      ...record,
      at: performance.now(),
      mode: planning,
      plans: plans.length,
      buildingsHeld: corridor.buildings.length,
      mainMs: mainSoFar + performance.now() - from,
      latencyMs: performance.now() - since,
    });
  };
  const replan = (): void => {
    if (dirtySince === undefined) return;
    if (worker === undefined) {
      const since = dirtySince;
      dirtySince = undefined;
      const from = performance.now();
      const corridor = corridorOf(nearKeys());
      const planned = planTown(corridor, rolling.view(), origin, performance.now() - from);
      apply(
        corridor,
        planned,
        planned.plans,
        { timings: planned.timings },
        performance.now() - from,
        since,
      );
      return;
    }
    if (inFlight !== undefined) return;
    planId += 1;
    inFlight = { id: planId, profile: rolling.view(), keys: nearKeys(), since: dirtySince };
    dirtySince = undefined;
    send({ kind: 'plan', id: planId, keys: inFlight.keys, profile: inFlight.profile });
  };
  worker?.addEventListener('message', (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.kind === 'block') {
      pendingReads -= 1;
      arrived(message.block);
    } else if (message.kind === 'failed') {
      pendingReads -= 1;
    } else if (inFlight?.id === message.id) {
      const flight = inFlight;
      inFlight = undefined;
      // Planned against a profile the ride has since swapped: plan again.
      if (flight.profile !== rolling.view()) {
        dirtySince ??= flight.since;
        return;
      }
      // The mask and the urban class are built again here: they are objects
      // with methods, and cannot cross from the worker.
      const from = performance.now();
      const corridor = corridorOf(flight.keys);
      const ground = planGround(corridor, flight.profile);
      apply(
        corridor,
        ground,
        message.plans,
        { timings: message.timings, workerMs: message.workerMs },
        performance.now() - from,
        flight.since,
      );
    }
  });

  // The first blocks are read, and the town planned, before the ride starts.
  ensure(0);
  while (pendingReads > 0) await new Promise((resolve) => setTimeout(resolve, 50));
  replan();
  while (town === undefined) await new Promise((resolve) => setTimeout(resolve, 50));

  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.append(canvas);
  const rung = worldRung({ realistic: world === 'realistic', quality: INITIAL_QUALITY });
  const view = threeGameRenderer.create(canvas, rung);
  view.resize(canvas.clientWidth, canvas.clientHeight);
  const gl = canvas.getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  result.renderer =
    gl === null || info === null || info === undefined
      ? 'unknown'
      : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  result.displayMs = await displayInterval(60);

  let next = 0;
  let passed = 0;
  let last = 0;
  let began: number | undefined;
  result.ready = true;
  let drawn = 0;
  const tick = (now: number): void => {
    const from = performance.now();
    // The warm-up is timed from the third frame: the first compiles every
    // shader, which takes seconds and is not the ride's.
    drawn += 1;
    if (drawn === 3) began = now;
    const elapsed = began === undefined ? -WARM_UP_SECONDS : (now - began) / 1000 - WARM_UP_SECONDS;
    if (elapsed >= 0 && result.rideFrom === undefined) result.rideFrom = now;
    rider = Math.max(0, elapsed) * SPEED_METRES_PER_SECOND;
    // The scripted choice, DECIDE_BEFORE_METRES before the next junction.
    if (next < legs.length - 1 && rider >= junctionAt(next) - DECIDE_BEFORE_METRES) {
      const at = junctionAt(next);
      rolling.swapTail(at, branch(next + 1));
      result.swaps.push(now);
      next += 1;
      markDirty();
    }
    if (passed < next && rider >= junctionAt(passed)) {
      result.junctions.push(now);
      passed += 1;
    }
    ensure(rider);
    replan();
    const frame = rideFrame({
      profile: rolling.view(),
      origin,
      distance: rider,
      elapsed: Math.max(0, elapsed),
      rung,
      ...(town === undefined ? {} : { town }),
    });
    view.render(frame);
    const calls = counter.takeCalls();
    const triangles = counter.takeTriangles();
    if (elapsed >= 0 && result.rideFrom !== now) {
      result.frames.push({
        at: now,
        gapMs: now - last,
        cpuMs: performance.now() - from,
        calls,
        triangles,
      });
    }
    last = now;
    if (elapsed < seconds) {
      requestAnimationFrame(tick);
      return;
    }
    result.rideTo = now;
    result.profileViews = rolling.views;
    result.heapBytes = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      ?.usedJSHeapSize;
    // One line, as the realistic page's are, so `adb logcat` carries a
    // tablet's numbers off the device under the `chromium` tag.
    console.log(`OYL-SPIKE-0040 ${JSON.stringify(summariseRun(result))}`);
    result.done = true;
    worker?.terminate();
  };
  requestAnimationFrame(tick);
}

run().catch((error: unknown) => {
  // The message names no place: a failure here is the archive's or the page's.
  result.error = error instanceof Error ? `${error.name}: ${error.message}` : 'failed';
  result.done = true;
});
