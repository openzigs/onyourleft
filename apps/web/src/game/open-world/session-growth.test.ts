// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2990: the open-world session past the start's blocks. A street that runs
 * on out of the start's 3 × 3 is read as the rider goes, built into the graph
 * off the main thread, and ridden on — not turned round at the edge of what
 * the start read. A loop offers its two ways by two ids. Read back as the game
 * reads the road: the view the road hands on, position by position at ride
 * distance minus its origin, through the product's own archive reader,
 * decoder, graph builder and rolling route.
 */

import {
  distanceBetween,
  positionAt,
  type GeographicPosition,
  type RollingJunction,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { countingSource } from '../../world-data/archive-testing';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import { CROSSING_DELAY_MAX_MS } from '../world-data/area';
import {
  fixtureBlockTiles,
  fixturePosition,
  fixtureStart,
  MAIN_STREET_ROW,
  openWorldFixtureArchive,
  RING_NODE,
  START_COLUMN,
  START_ROW,
  TURNING_CIRCLE_STREETS,
} from './fixture-testing';
import {
  inlineGraphWorker,
  workerGraphBuilder,
  type GraphRequest,
  type GraphWorkerLike,
} from './graph-build';
import type { OpenWorldReady } from './ride';
import type { OpenWorldRoad } from './road';
import { createOpenWorldSession, type OpenWorldSessionOptions } from './session';

/** Main street, drawn on 20,000 pixels east: through the next block and into the one after. */
const LONG_MAIN_STREET = [
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [-4000, MAIN_STREET_ROW],
      [20_000, MAIN_STREET_ROW],
    ] as const,
  },
];

/** One task later: every read the last step set going has gone on. */
const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

type ArchiveSource = Parameters<typeof corridorArchiveFrom>[0];

/**
 * #3046: more tasks than the ride on after a release takes (600 m in 25 m
 * steps, a task each), so a read that waits this long outlasts that ride.
 */
const LAG_TASKS = 32;

/**
 * `source`, with every range read answered {@link LAG_TASKS} tasks late once
 * `lag()` is called: a slow read on every machine, as a loaded runner's is on
 * some runs (#3046). A wait by a count of ticks fails against it every time.
 */
function lagging(source: ArchiveSource): { source: ArchiveSource; lag: () => void } {
  let late = false;
  return {
    source: {
      getKey: () => source.getKey(),
      getBytes: async (offset, length, signal, etag) => {
        for (let task = 0; late && task < LAG_TASKS; task += 1) await tick();
        return source.getBytes(offset, length, signal, etag);
      },
    },
    lag: () => {
      late = true;
    },
  };
}

/** A crossing's delay at once (a microtask on), and the start's own bound never. */
const promptly = (run: () => void, ms: number): (() => void) => {
  if (ms <= CROSSING_DELAY_MAX_MS) queueMicrotask(run);
  return () => undefined;
};

/**
 * A crossing's delay that lasts until the test says: what a full 30 s delay,
 * or a slow read, looks like to a rider who rides on meanwhile. Released, the
 * held requests go and every later one is prompt.
 */
function heldCrossings(): {
  schedule: (run: () => void, ms: number) => () => void;
  release: () => void;
} {
  const held: (() => void)[] = [];
  let prompt = false;
  return {
    schedule: (run, ms) => {
      if (ms > CROSSING_DELAY_MAX_MS) return () => undefined;
      if (prompt) queueMicrotask(run);
      else held.push(run);
      return () => undefined;
    },
    release: () => {
      prompt = true;
      for (const run of held.splice(0)) run();
    },
  };
}

/**
 * The worker the session made, its requests counted, answering as the real one
 * does. #3046: `answered` waits on the answers themselves — until the changes
 * the worker has answered satisfy `done` — never on a count of ticks, which a
 * loaded runner's archive reads can outlast.
 */
function countedWorker(): {
  make: () => GraphWorkerLike;
  requests: GraphRequest[];
  answered: (done: (changes: readonly GraphRequest[]) => boolean) => Promise<void>;
} {
  const requests: GraphRequest[] = [];
  const answers: GraphRequest[] = [];
  const waiting: { done: (changes: readonly GraphRequest[]) => boolean; go: () => void }[] = [];
  const heard = (data: unknown): void => {
    const id = (data as { id?: unknown } | null)?.id;
    const request = requests.find((each) => each.kind === 'change' && each.id === id);
    if (request !== undefined) answers.push(request);
    for (const waiter of waiting.splice(0)) {
      if (waiter.done(answers)) waiter.go();
      else waiting.push(waiter);
    }
  };
  return {
    requests,
    answered: (done) =>
      new Promise((go) => {
        if (done(answers)) go();
        else waiting.push({ done, go });
      }),
    make: () => {
      const inner = inlineGraphWorker();
      let handler: GraphWorkerLike['onmessage'] = null;
      const worker: GraphWorkerLike = {
        postMessage: (message) => {
          requests.push(message);
          inner.postMessage(message);
        },
        terminate: () => {
          inner.terminate();
        },
        get onmessage() {
          return handler;
        },
        set onmessage(next) {
          handler = next;
          inner.onmessage =
            next === null
              ? null
              : (event) => {
                  next(event);
                  heard(event.data);
                };
        },
        onerror: null,
      };
      return worker;
    },
  };
}

const tileKeyOf = (tile: { readonly x: number; readonly y: number }): string =>
  `${String(tile.x)}/${String(tile.y)}`;

/** Every tile of the `east`th block, added by the changes in `changes`. */
const addsBlock =
  (east: number) =>
  (changes: readonly GraphRequest[]): boolean => {
    const added = new Set(
      changes.flatMap((request) =>
        request.kind === 'change' ? request.change.add.map((each) => tileKeyOf(each.tile)) : [],
      ),
    );
    return fixtureBlockTiles(east).every((tile) => added.has(tileKeyOf(tile)));
  };

async function readyOn(
  bytes: Uint8Array,
  start: ReturnType<typeof fixtureStart>,
  more: Partial<OpenWorldSessionOptions> = {},
): Promise<{ ready: OpenWorldReady; stop: () => void }> {
  const session = createOpenWorldSession({
    start,
    archive: corridorArchiveFrom(countingSource(bytes)),
    mapTilesOn: () => true,
    yieldToIdle: () => Promise.resolve(),
    random: () => 0,
    schedule: promptly,
    ...more,
  });
  return { ready: await session.ready, stop: () => session.stop() };
}

/** Where the road puts the rider at ride distance `ride`, as the game reads it. */
function placeOn(road: OpenWorldRoad, ride: number): GeographicPosition {
  return positionAt(road.view.profile, ride - road.view.origin);
}

/** Rides `road` from `from` to `to` metres in `step`s, a task between each. */
async function ride(road: OpenWorldRoad, to: number, from = 0, step = 25): Promise<void> {
  for (let rider = from; rider <= to; rider += step) {
    road.follow(rider);
    await tick();
  }
}

const turnsRound = (road: OpenWorldRoad): boolean =>
  road.route.legs.some((leg) => leg.kind === 'turn-round');

describe('an open-world ride past the start’s blocks — #2990', () => {
  it('reads the blocks round the rider as it goes, and rides on along a street the start’s blocks ended', async () => {
    const worker = countedWorker();
    const crossings = heldCrossings();
    const bytes = await openWorldFixtureArchive(LONG_MAIN_STREET, 2);
    const slow = lagging(countingSource(bytes));
    const { ready, stop } = await readyOn(bytes, fixtureStart(START_COLUMN, START_ROW), {
      archive: corridorArchiveFrom(slow.source),
      graphBuilder: (frame) => workerGraphBuilder(frame, worker.make),
      schedule: crossings.schedule,
    });
    try {
      if (ready.kind !== 'ready') throw new Error(`not ready: ${JSON.stringify(ready)}`);
      const snapped = fixturePosition(START_COLUMN, MAIN_STREET_ROW);
      // The street runs out of what the start read where the third block begins.
      const edge = distanceBetween(snapped, fixturePosition(12_288, MAIN_STREET_ROW));
      const road = ready.road();
      // Built where the graph is built: the frame, then the start's tiles as they came.
      const kinds = worker.requests.map((request) => request.kind);
      expect(kinds[0]).toBe('frame');
      expect(kinds.slice(1).every((kind) => kind === 'change')).toBe(true);
      // Into the second block, and on while its crossing's request waits: the
      // road ahead reaches the end of what is held, and turns round there.
      await ride(road, edge - 300);
      expect(turnsRound(road)).toBe(true);
      expect(distanceBetween(placeOn(road, edge + 300), snapped)).toBeCloseTo(edge - 300, -1);
      // The crossing's request goes 300 m short of that turn: the third
      // block is read, and the road goes on past it. #3046: the read is made
      // slow, and the rider rides on once the graph has taken the third block
      // (the worker has answered the change that adds it, and a task on the
      // session's mirror holds it), however long the read took, not after a
      // count of ticks.
      slow.lag();
      crossings.release();
      await worker.answered(addsBlock(2));
      await tick();
      await ride(road, edge + 300, edge - 300);
      expect(turnsRound(road)).toBe(false);
      // The third block's tiles went in as the rider rode into the second.
      const added = worker.requests.flatMap((request) =>
        request.kind === 'change' ? request.change.add.map((each) => each.tile.x) : [],
      );
      for (const tile of fixtureBlockTiles(2)) expect(added).toContain(tile.x);
      // And the start's block came out as the rider rode into the third: the
      // graph is the 3 × 3 round the rider, not every block ridden through.
      const removed = worker.requests.flatMap((request) =>
        request.kind === 'change' ? request.change.remove.map((tile) => tile.x) : [],
      );
      for (const tile of fixtureBlockTiles(0)) expect(removed).toContain(tile.x);
      for (const tile of fixtureBlockTiles(2)) expect(removed).not.toContain(tile.x);
      // 300 m past where the start's blocks ended, the rider is 300 m further
      // east along Main street, not 300 m back towards the start.
      for (const past of [100, 300, 900]) {
        const at = placeOn(road, edge + past);
        expect(distanceBetween(at, snapped), `${String(past)} m past`).toBeCloseTo(edge + past, -1);
      }
    } finally {
      stop();
    }
  });

  it('rides back into a block it dropped and read again, over the seam it was stitched across', async () => {
    const bytes = await openWorldFixtureArchive(LONG_MAIN_STREET, 2);
    const { ready, stop } = await readyOn(bytes, fixtureStart(START_COLUMN, START_ROW));
    try {
      if (ready.kind !== 'ready') throw new Error(`not ready: ${JSON.stringify(ready)}`);
      const snapped = fixturePosition(START_COLUMN, MAIN_STREET_ROW);
      const edge = distanceBetween(snapped, fixturePosition(12_288, MAIN_STREET_ROW));
      const road = ready.road();
      // East into the third block, which drops the start's; then a U-turn.
      const turn = edge + 300;
      await ride(road, turn);
      road.route.uTurn(turn);
      // The turn is on the next 10 m sample, so home is as far past it as it is from the start.
      const turned = road.route.legs.find((leg) => leg.kind === 'u-turn')?.start as number;
      // Back west: into the second block, which reads the start's block again
      // with new nodes, stitched to the second's at their seam.
      const home = 2 * turned;
      await ride(road, home - 200, turn);
      // 300 m short of home the rider is 300 m east of the start, on Main
      // street: over the seam, not turned round at it.
      const at = placeOn(road, home - 300);
      expect(distanceBetween(at, snapped)).toBeCloseTo(300, -1);
    } finally {
      stop();
    }
  });

  it('turns round at the edge of what is held while nothing more is read', async () => {
    // The same street, with the third block never in the archive.
    const bytes = await openWorldFixtureArchive(LONG_MAIN_STREET, 1);
    const { ready, stop } = await readyOn(bytes, fixtureStart(START_COLUMN, START_ROW));
    try {
      if (ready.kind !== 'ready') throw new Error(`not ready: ${JSON.stringify(ready)}`);
      const snapped = fixturePosition(START_COLUMN, MAIN_STREET_ROW);
      const edge = distanceBetween(snapped, fixturePosition(12_288, MAIN_STREET_ROW));
      const road = ready.road();
      await ride(road, edge);
      expect(distanceBetween(placeOn(road, edge + 300), snapped)).toBeCloseTo(edge - 300, -1);
    } finally {
      stop();
    }
  });

  it('stops the graph’s worker when the session stops', async () => {
    let terminated = 0;
    const bytes = await openWorldFixtureArchive();
    const { ready, stop } = await readyOn(bytes, fixtureStart(START_COLUMN, START_ROW), {
      graphBuilder: (frame) =>
        workerGraphBuilder(frame, () => {
          const inner = inlineGraphWorker();
          const end = inner.terminate.bind(inner);
          return Object.assign(inner, {
            terminate: () => {
              terminated += 1;
              end();
            },
          });
        }),
    });
    expect(ready.kind).toBe('ready');
    expect(terminated).toBe(0);
    stop();
    expect(terminated).toBe(1);
  });

  it('says the map could not be read when the graph cannot be built', async () => {
    const bytes = await openWorldFixtureArchive();
    const { ready, stop } = await readyOn(bytes, fixtureStart(START_COLUMN, START_ROW), {
      graphBuilder: (frame) =>
        workerGraphBuilder(frame, () => {
          throw new Error('no worker here');
        }),
    });
    stop();
    expect(ready).toStrictEqual({ kind: 'refused', refusal: 'unavailable' });
  });
});

describe('a loop’s two ways in the open-world graph — #2990', () => {
  it('offers the turning circle both ways round by two ids, and a choice by either rides that way', async () => {
    const bytes = await openWorldFixtureArchive(TURNING_CIRCLE_STREETS);
    // About 12 m east of the stem, 100 m short of the ring: the ride heads north.
    const { ready, stop } = await readyOn(bytes, fixtureStart(-2950, 3300));
    try {
      if (ready.kind !== 'ready') throw new Error(`not ready: ${JSON.stringify(ready)}`);
      const road = ready.road();
      const junction = road.route.junctionsAfter(0)[0] as RollingJunction;
      const ids = junction.ways.map((way) => way.edge.id);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      const node = fixturePosition(...RING_NODE);
      const sides = new Set<number>();
      for (const id of ids) {
        expect(['swapped', 'unchanged']).toContain(road.route.choose(junction.distance, id, 0));
        road.follow(0);
        // 40 m round the ring, one way is east of the node and the other west.
        const at = placeOn(road, junction.distance + 40);
        sides.add(Math.sign(at.longitude - node.longitude));
      }
      expect(sides).toStrictEqual(new Set([1, -1]));
    } finally {
      stop();
    }
  });
});
