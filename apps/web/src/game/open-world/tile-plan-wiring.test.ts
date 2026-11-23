// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The tile planner's worker is made by the app's own session** — #2901.
 *
 * ⚠️ **Why this file exists.** `tile-plan-worker.ts` is a second entry point
 * that `check:wiring` cannot reach (its `@unwired`), and the planner is made
 * by the session only once a block is held, which no gate follows. So this
 * rides the real session (`session.ts` §`createOpenWorldSession`, the one
 * `session-lazy.ts` opens for `main.tsx`, which `session-wiring.test.ts`
 * holds) over the synthetic fixture archive, with the platform's `Worker`
 * stood in by one that runs each worker's own handler, and reads back which
 * workers were made and what they were asked. A session that stopped making
 * the planner, a road that stopped asking it, or a planner that stopped making
 * its worker, is red here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { corridorArchiveFrom } from '../../world-data/corridor-source';
import { sceneryAnchor } from '../scenery-anchor';
import { countingSource } from '../../world-data/archive-testing';
import {
  fixtureStart,
  OPEN_WORLD_FIXTURE_STREETS,
  openWorldFixtureArchive,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { graphWorkerCore } from './graph-build';
import { createOpenWorldSession } from './session';
import { openWorldStreetCorridor } from './street-corridor';
import type { TileBlockFeatures } from './tile-plan';
import {
  createTilePlanner,
  describeTilePlanFailure,
  tilePlanWorkerCore,
  type TilePlanRequest,
} from './tile-planner';

// #2903: counted, so a test can tell a reused street corridor from a rebuilt one.
vi.mock('./street-corridor', async (actual) => {
  const real = await actual<typeof import('./street-corridor')>();
  return { openWorldStreetCorridor: vi.fn(real.openWorldStreetCorridor) };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Made {
  readonly url: string;
  readonly name: unknown;
  readonly asked: unknown[];
}

/** A `Worker` that runs the handler of the worker its URL names, a microtask later. */
function stubWorkers(options: { tileWorkerErrors?: boolean } = {}): Made[] {
  const made: Made[] = [];
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      readonly #made: Made;
      readonly #handle: (data: unknown) => unknown;
      constructor(url: URL | string, init?: { name?: string }) {
        this.#made = { url: String(url), name: init?.name, asked: [] };
        made.push(this.#made);
        if (/graph-worker\.ts$/.test(String(url))) {
          const core = graphWorkerCore();
          this.#handle = (data) => core.handle(data);
        } else {
          const core = tilePlanWorkerCore();
          this.#handle = (data) => core.handle(data)?.reply;
        }
      }
      postMessage(message: unknown): void {
        this.#made.asked.push(message);
        queueMicrotask(() => {
          if (options.tileWorkerErrors === true && (message as TilePlanRequest).kind === 'plan') {
            this.onerror?.({});
            return;
          }
          const reply = this.#handle(structuredClone(message));
          if (reply !== undefined) this.onmessage?.({ data: structuredClone(reply) });
        });
      }
      terminate(): void {}
    },
  );
  return made;
}

async function openRide(
  log?: (line: string) => void,
  held?: ReadonlyMap<string, TileBlockFeatures>[],
) {
  const archive = corridorArchiveFrom(countingSource(await openWorldFixtureArchive()));
  const session = createOpenWorldSession({
    start: fixtureStart(START_COLUMN, START_ROW),
    archive,
    mapTilesOn: () => true,
    yieldToIdle: () => Promise.resolve(),
    random: () => 0,
    log,
    // The real planner, with what each `hold` was handed recorded.
    tilePlanner: (options) => {
      const planner = createTilePlanner(options);
      const hold = planner.hold.bind(planner);
      planner.hold = (blocks) => {
        held?.push(blocks);
        hold(blocks);
      };
      return planner;
    },
  });
  const ready = await session.ready;
  if (ready.kind !== 'ready') throw new Error(`no ride: ${ready.kind}`);
  return { session, road: ready.road() };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('the open-world session makes the tile planner’s worker — #2901', () => {
  it('makes it once a block is held, and the road asks it to plan the rider’s tiles', async () => {
    const made = stubWorkers();
    const { session, road } = await openRide();
    const tiles = made.filter((each) => /tile-plan-worker\.ts$/.test(each.url));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.name).toBe('oyl-tile-plans');
    // Before the ride moves, the blocks are held and nothing is planned.
    const before = tiles[0]?.asked.map((each) => (each as TilePlanRequest).kind);
    expect(before?.[0]).toBe('frame');
    expect(before).toContain('hold');
    expect(before).not.toContain('plan');
    road.follow(0);
    await settle();
    const plans = (tiles[0]?.asked ?? []).filter(
      (each) => (each as TilePlanRequest).kind === 'plan',
    );
    expect(plans.length).toBeGreaterThan(0);
    // #2902: once tiles are planned, the buildings round the rider are, and
    // the road hands them on (the fixture's block has no footprints).
    expect(road.buildings()).toBeUndefined();
    road.follow(30);
    await settle();
    const asked = (tiles[0]?.asked ?? []).map((each) => (each as TilePlanRequest).kind);
    expect(asked).toContain('buildings');
    expect(road.buildings()?.plans).toStrictEqual([]);
    // #3094: each handing the worker what the road keyed the view on, so the
    // worker's copy of it stands the plans on the ground the scene draws.
    const anchor = sceneryAnchor(road.view.profile);
    expect(anchor).toBeDefined();
    const requests = (tiles[0]?.asked ?? []).filter(
      (each): each is Extract<TilePlanRequest, { kind: 'buildings' }> =>
        (each as TilePlanRequest).kind === 'buildings',
    );
    expect(requests.length).toBeGreaterThan(0);
    for (const { request } of requests) {
      expect(request.scenery).toStrictEqual({
        seed: anchor?.seed,
        origin: sceneryAnchor(request.profile)?.origin,
      });
    }
    // #2903: and every held street, for the scene to draw: the fixture's three, in each tile it crosses.
    // Each tile carries its own cut of a street it crosses, as a route's corridor does.
    expect(road.streets()?.streets.length).toBeGreaterThanOrEqual(
      OPEN_WORLD_FIXTURE_STREETS.length,
    );
    session.stop();
  });

  it('builds the street corridor again only when the held blocks change — #2903', async () => {
    stubWorkers();
    const built = vi.mocked(openWorldStreetCorridor);
    built.mockClear();
    const held: ReadonlyMap<string, TileBlockFeatures>[] = [];
    const { session, road } = await openRide(undefined, held);
    road.follow(0);
    await settle();
    const same = (
      a: ReadonlyMap<string, TileBlockFeatures>,
      b: ReadonlyMap<string, TileBlockFeatures>,
    ) => a.size === b.size && [...a].every(([key, features]) => b.get(key) === features);
    const changes = held.filter((blocks, at) => at === 0 || !same(blocks, held[at - 1] as never));
    // Control: the session did hand the planner the same blocks more than once.
    expect(held.length).toBeGreaterThan(changes.length);
    // One corridor per change of what is held, and the road hands on the last.
    expect(built).toHaveBeenCalledTimes(changes.length);
    expect(road.streets()).toBe(built.mock.results.at(-1)?.value);
    session.stop();
  });

  it('says a failed worker in words with no coordinate or tile, and the ride rides on', async () => {
    stubWorkers({ tileWorkerErrors: true });
    const lines: string[] = [];
    const { session, road } = await openRide((line) => lines.push(line));
    road.follow(0);
    await settle();
    expect(lines).toContain(describeTilePlanFailure());
    expect(lines.filter((line) => /\d/.test(line))).toStrictEqual([]);
    // The ride goes on along its road after the failure.
    for (let rider = 0; rider <= 400; rider += 50) road.follow(rider);
    expect(road.view.profile.totalDistance as number).toBeGreaterThan(0);
    session.stop();
  });
});
