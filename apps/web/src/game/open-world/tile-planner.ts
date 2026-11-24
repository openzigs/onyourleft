// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An open-world ride's tiles, planned off the main thread** — #2901.
 *
 * `tile-plan.ts` says what a tile's plan is. This module is where plans are
 * made and held: a worker (`tile-plan-worker.ts`) plans them, and the page
 * keeps what it sent back, by tile, for the scene to read.
 *
 * ## The protocol
 *
 * The page sends the frame once ({@link TilePlanRequest} `frame`), then each
 * block the area reader holds (`hold`) and each it lets go (`drop`), so the
 * worker holds the same features the page does without being sent them again
 * per tile. Then `plan`, one tile at a time: the planner keeps **one request
 * in flight**, and when its answer comes asks for the first tile still wanted
 * that has none, so a new wanted order (`tiles-ahead.ts`) takes effect at the
 * next request rather than behind a queue. The answer's buffers are
 * transferred, never copied (`tile-plan.ts` §`tilePlanBuffers`), and putting
 * one in the planner's map is all the page does with it: no plan is built, and
 * no buffer copied, on the main thread while a worker runs.
 *
 * ## When there is no worker, or it fails
 *
 * Where the platform has no `Worker`, or refuses to make one, or the worker
 * errors, or answers a request with `failed`, the planner says so once in
 * {@link describeTilePlanFailure}'s words, ends the worker, and goes on with
 * the SAME request handler ({@link tilePlanWorkerCore}) on this thread: every
 * held block sent to it again, every wanted tile planned again from the start.
 * It plans at `reduced` detail there, a sixteenth of the land cells and no
 * inferred built-up land, and each plan is its own task (`schedule`), so the
 * frames between plans are drawn; the quality ladder (`quality.ts`) then sheds
 * whatever drawing the page can no longer afford, from the frame times, as it
 * does for any other load. The ride never waits on a plan: one that fails on
 * the page too is simply not there, and the ride rides on.
 *
 * ⚠️ **Nothing here names a coordinate, a tile or a block in words** (ADR
 * 0004 D): the one sentence it says has none of them, and
 * `tile-planner.test.ts` holds it.
 */

import {
  TILES_AT_Z15,
  type CorridorFrame,
  type StreetFeature,
  type TileId,
} from '@onyourleft/map-features';

import type { FootprintPlan } from '../footprint-buildings';
import { mappedBuildingsOf, type MappedBuildings } from '../mapped-buildings';
import { StreetLevels } from '../street-levels';
import { openWorldStreetCorridor } from './street-corridor';
import {
  footprintPlanBuffers,
  planBuildingsNear,
  type BuildingsRequest,
  type OwnedFootprints,
} from './tile-buildings';
import {
  planTile,
  tilePlanBuffers,
  type TileBlockFeatures,
  type TilePlan,
  type TilePlanDetail,
} from './tile-plan';

/** What the page sends the worker. */
export type TilePlanRequest =
  | { readonly kind: 'frame'; readonly frame: CorridorFrame }
  | { readonly kind: 'hold'; readonly block: string; readonly features: TileBlockFeatures }
  | { readonly kind: 'drop'; readonly block: string }
  | {
      readonly kind: 'plan';
      readonly id: number;
      readonly block: string;
      readonly tile: TileId;
      readonly detail: TilePlanDetail;
    }
  | {
      /** #2902: the mapped buildings round the rider, from every tile planned so far. */
      readonly kind: 'buildings';
      readonly id: number;
      readonly request: BuildingsRequest;
      readonly detail: TilePlanDetail;
    };

/** What the worker sends back. */
export type TilePlanReply =
  | { readonly kind: 'plan'; readonly id: number; readonly plan: TilePlan }
  | { readonly kind: 'buildings'; readonly id: number; readonly plans: readonly FootprintPlan[] }
  | { readonly kind: 'failed'; readonly id: number };

/** A reply, and the buffers to transfer with it. */
export interface TilePlanAnswer {
  readonly reply: TilePlanReply;
  readonly transfer: ArrayBuffer[];
}

/**
 * The worker's request handler. A `plan` with no frame or no held block before
 * it, or one the planner throws on, is `failed`; anything that is not a
 * request is ignored.
 */
export function tilePlanWorkerCore(): { handle(data: unknown): TilePlanAnswer | undefined } {
  let frame: CorridorFrame | undefined;
  const blocks = new Map<string, TileBlockFeatures>();
  /** #2902: what each tile planned owns, kept here: the plan's own buffers leave with it. */
  const owned = new Map<string, OwnedFootprints>();
  /**
   * #3094: the held blocks' streets, found again only once a block is held or
   * dropped, and how far a place is from them, kept across requests.
   */
  let streets: readonly StreetFeature[] | undefined;
  const levels = new StreetLevels(() => {
    if (streets === undefined && frame !== undefined) {
      streets = openWorldStreetCorridor(frame, blocks.values()).streets;
    }
    return streets;
  });
  return {
    handle: (data) => {
      if (typeof data !== 'object' || data === null) return undefined;
      const request = data as TilePlanRequest;
      switch (request.kind) {
        case 'frame':
          frame = request.frame;
          streets = undefined;
          return undefined;
        case 'hold':
          blocks.set(request.block, request.features);
          streets = undefined;
          return undefined;
        case 'drop':
          blocks.delete(request.block);
          streets = undefined;
          for (const [key, tile] of owned) if (tile.block === request.block) owned.delete(key);
          return undefined;
        case 'buildings': {
          if (typeof request.id !== 'number') return undefined;
          if (frame === undefined)
            return { reply: { kind: 'failed', id: request.id }, transfer: [] };
          try {
            const planned = planBuildingsNear(
              frame,
              blocks,
              owned.values(),
              request.request,
              request.detail,
              levels,
            );
            // A copy, so what is transferred is the reply's alone and never a
            // buffer a planner's cache here still holds.
            const plans = structuredClone(planned);
            return {
              reply: { kind: 'buildings', id: request.id, plans },
              transfer: footprintPlanBuffers(plans),
            };
          } catch {
            return { reply: { kind: 'failed', id: request.id }, transfer: [] };
          }
        }
        case 'plan': {
          if (typeof request.id !== 'number') return undefined;
          const block = blocks.get(request.block);
          const failed: TilePlanAnswer = {
            reply: { kind: 'failed', id: request.id },
            transfer: [],
          };
          if (frame === undefined || block === undefined) return failed;
          try {
            const plan = planTile(frame, block, request.tile, request.detail);
            owned.set(`${String(plan.tile.x)}/${String(plan.tile.y)}`, {
              block: request.block,
              box: plan.box,
              source: plan.buildings.source.slice(),
              centroids: plan.buildings.centroids.slice(),
            });
            return {
              reply: { kind: 'plan', id: request.id, plan },
              transfer: tilePlanBuffers(plan),
            };
          } catch {
            return failed;
          }
        }
        default:
          return undefined;
      }
    },
  };
}

/** The slice of a `Worker` the planner uses, so a test — and the fallback — can supply one. */
export interface TilePlanWorkerLike {
  postMessage(message: TilePlanRequest): void;
  terminate(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * The real worker.
 *
 * ⚠️ **This exact expression is what Vite looks for** — `new Worker(new
 * URL(…, import.meta.url), …)` — to bundle `tile-plan-worker.ts` and what it
 * imports into a worker script (`graph-build.ts` §`realGraphWorker`).
 */
function realTilePlanWorker(): TilePlanWorkerLike {
  return new Worker(new URL('./tile-plan-worker.ts', import.meta.url), {
    type: 'module',
    name: 'oyl-tile-plans',
  }) as unknown as TilePlanWorkerLike;
}

/** Runs `run` in a task of its own: `setTimeout(run, 0)` in the product. */
export type TaskSchedule = (run: () => void) => void;

const ownTask: TaskSchedule = (run) => {
  setTimeout(run, 0);
};

/**
 * {@link tilePlanWorkerCore} on this thread, as a worker would answer: each
 * plan in a task of its own, so the frames between plans are drawn.
 */
function inlineTilePlanWorker(schedule: TaskSchedule): TilePlanWorkerLike {
  const core = tilePlanWorkerCore();
  let live = true;
  const worker: TilePlanWorkerLike = {
    postMessage: (message) => {
      if (message.kind !== 'plan' && message.kind !== 'buildings') {
        core.handle(message);
        return;
      }
      schedule(() => {
        if (!live) return;
        const answer = core.handle(message);
        if (answer !== undefined) worker.onmessage?.({ data: answer.reply });
      });
    },
    terminate: () => {
      live = false;
    },
    onmessage: null,
    onerror: null,
  };
  return worker;
}

/**
 * What a rider is told when the worker cannot plan the map: never a
 * coordinate, a tile or a block (ADR 0004 D).
 */
export function describeTilePlanFailure(): string {
  return 'The map round the ride could not be planned in the background, so it is planned as the ride goes, with less detail.';
}

/** The page's side: where the ride's tile plans are asked for and kept. */
export interface TilePlanner {
  /** Every block the area reader holds now, by key; a block not named is let go, with its plans. */
  hold(blocks: ReadonlyMap<string, TileBlockFeatures>): void;
  /** The tiles to plan, first first (`tiles-ahead.ts`). Replaces the last order. */
  want(tiles: readonly TileId[]): void;
  /** `tile`'s plan, once it is made and while its block is held. */
  plan(tile: TileId): TilePlan | undefined;
  /** Every plan held now. */
  plans(): IterableIterator<TilePlan>;
  /** Moves on each plan added or let go, so a reader can tell the plans changed. */
  readonly version: number;
  /**
   * #2902: asks for the mapped buildings round the rider to be planned against
   * `request`'s view. One is planned at a time; asked again meanwhile, the
   * latest is planned next and the others are not.
   */
  planBuildings(request: BuildingsRequest): void;
  /** #2902: the buildings last planned round the rider, indexed; `undefined` until there are. */
  readonly buildings: MappedBuildings | undefined;
  /** Whether plans are being made in a worker: `false` on the page's fallback. */
  readonly inWorker: boolean;
  /** Ends the worker; nothing more is planned. Safe to call twice. */
  stop(): void;
}

export interface TilePlannerOptions {
  /** The session's frame: the start. Every plan is in it. */
  readonly frame: CorridorFrame;
  /** Makes the worker: the real one where the platform has `Worker`. A `make` that throws is a failure. */
  readonly make?: (() => TilePlanWorkerLike) | undefined;
  /** Where the failure is said, in {@link describeTilePlanFailure}'s words only. */
  readonly log?: ((line: string) => void) | undefined;
  /** The fallback's task: `setTimeout(run, 0)` when absent. */
  readonly schedule?: TaskSchedule | undefined;
}

const tileKey = (tile: TileId): number => tile.y * TILES_AT_Z15 + tile.x;

/** A planner over the worker `options.make` makes, falling back to this thread. See the header. */
export function createTilePlanner(options: TilePlannerOptions): TilePlanner {
  const { frame } = options;
  const schedule = options.schedule ?? ownTask;
  // No `Worker` on the platform is a failure like any other: said once, then reduced detail here.
  const make =
    options.make ??
    (typeof Worker === 'undefined'
      ? (): TilePlanWorkerLike => {
          throw new Error('no Worker');
        }
      : realTilePlanWorker);
  /** The blocks held, and which held block each decoded tile is in. */
  let held: ReadonlyMap<string, TileBlockFeatures> = new Map();
  const blockOfTile = new Map<number, string>();
  const plans = new Map<number, TilePlan>();
  let wanted: readonly TileId[] = [];
  let version = 0;
  let next = 0;
  let inFlight: { readonly id: number; readonly tile: number; readonly block: string } | undefined;
  let worker: TilePlanWorkerLike | undefined;
  let detail: TilePlanDetail = 'full';
  let inWorker = true;
  let stopped = false;
  let dead = false;
  /** #2902: the buildings request in flight, the one waiting behind it, and the last answer. */
  let buildingsInFlight: number | undefined;
  let buildingsWaiting: BuildingsRequest | undefined;
  let buildings: MappedBuildings | undefined;
  let buildingsAsked: BuildingsRequest | undefined;

  const send = (message: TilePlanRequest): boolean => {
    if (worker === undefined) return false;
    try {
      worker.postMessage(message);
      return true;
    } catch {
      fail();
      return false;
    }
  };

  const pump = (): void => {
    if (stopped || dead || inFlight !== undefined || worker === undefined) return;
    for (const tile of wanted) {
      const key = tileKey(tile);
      if (plans.has(key)) continue;
      const block = blockOfTile.get(key);
      if (block === undefined) continue;
      const id = next++;
      inFlight = { id, tile: key, block };
      if (!send({ kind: 'plan', id, block, tile: { z: 15, x: tile.x, y: tile.y }, detail })) return;
      return;
    }
  };

  const askBuildings = (): void => {
    if (stopped || dead || buildingsInFlight !== undefined || worker === undefined) return;
    const request = buildingsWaiting;
    if (request === undefined) return;
    buildingsWaiting = undefined;
    const id = next++;
    buildingsInFlight = id;
    buildingsAsked = request;
    send({ kind: 'buildings', id, request, detail });
  };

  const answer = (data: unknown): void => {
    const reply = data as TilePlanReply | null | undefined;
    if (reply !== null && reply !== undefined && reply.id === buildingsInFlight) {
      buildingsInFlight = undefined;
      if (reply.kind === 'buildings') {
        buildings = mappedBuildingsOf(reply.plans);
        version += 1;
      }
      // A failed one leaves the tiles' planner alone: the buildings last
      // planned stay drawn, and only a newer ask is planned, never this again.
      askBuildings();
      return;
    }
    if (reply === null || reply === undefined || inFlight === undefined) return;
    if (reply.id !== inFlight.id) return;
    const asked = inFlight;
    inFlight = undefined;
    if (reply.kind !== 'plan') {
      fail();
      return;
    }
    // A block let go while its tile was planned: the plan is not kept.
    if (held.has(asked.block)) {
      plans.set(asked.tile, reply.plan);
      version += 1;
    }
    pump();
  };

  const attach = (made: TilePlanWorkerLike): void => {
    worker = made;
    made.onmessage = ({ data }) => {
      if (worker === made) answer(data);
    };
    made.onerror = () => {
      if (worker === made) fail();
    };
    send({ kind: 'frame', frame });
    for (const [block, features] of held) send({ kind: 'hold', block, features });
  };

  /** The worker failed: say so once, and go on on this thread at reduced detail. */
  function fail(): void {
    const failed = worker;
    worker = undefined;
    inFlight = undefined;
    if (buildingsInFlight !== undefined) buildingsWaiting ??= buildingsAsked;
    buildingsInFlight = undefined;
    failed?.terminate();
    if (stopped) return;
    if (!inWorker) {
      // The page's own planner failed too: the ride rides on with what it has.
      dead = true;
      return;
    }
    inWorker = false;
    detail = 'reduced';
    options.log?.(describeTilePlanFailure());
    // Every plan is made again at the page's detail, so the world is one detail throughout.
    if (plans.size > 0) {
      plans.clear();
      version += 1;
    }
    attach(inlineTilePlanWorker(schedule));
    pump();
    askBuildings();
  }

  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    try {
      attach(make());
    } catch {
      fail();
    }
  };

  return {
    hold: (blocks) => {
      if (stopped) return;
      const before = held;
      held = new Map(blocks);
      if (held.size > 0) start();
      for (const block of before.keys()) {
        if (!held.has(block)) send({ kind: 'drop', block });
      }
      for (const [block, features] of held) {
        if (before.get(block) !== features) send({ kind: 'hold', block, features });
      }
      blockOfTile.clear();
      for (const [block, features] of held) {
        for (const { tile } of features.tiles) blockOfTile.set(tileKey(tile), block);
      }
      let dropped = false;
      for (const key of [...plans.keys()]) {
        if (blockOfTile.has(key)) continue;
        plans.delete(key);
        dropped = true;
      }
      if (dropped) version += 1;
      pump();
    },
    want: (tiles) => {
      if (stopped) return;
      wanted = tiles;
      pump();
    },
    planBuildings: (request) => {
      if (stopped) return;
      buildingsWaiting = request;
      askBuildings();
    },
    get buildings() {
      return buildings;
    },
    plan: (tile) => plans.get(tileKey(tile)),
    plans: () => plans.values(),
    get version() {
      return version;
    },
    get inWorker() {
      return inWorker;
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      inFlight = undefined;
      worker?.terminate();
      worker = undefined;
    },
  };
}
