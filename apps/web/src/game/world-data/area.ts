// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world ride's map, read in fixed-grid blocks as the rider goes** —
 * #2890, ADR 0090 D-2, D-3 and D-5.
 *
 * @unwired #2890 builds the reader and #2896 (the open-world session) is its
 * first caller: until then no ride is an open-world ride, so nothing in the
 * product may make the streamed read, and a route ride must never make it
 * (`area-route-ride.test.ts` holds the importers to an exact list).
 *
 * A **block** is one z14 tile of the archive's own grid, read as its four z15
 * tiles (ADR 0090 D-2.1). It is fixed to the grid and never to the rider, the
 * start or home. While a ride is under way the reader holds the **3 × 3**
 * blocks centred on the rider's block (D-2.2):
 *
 * - {@link AreaReader.start} reads the start's 3 × 3 at once, centre first,
 *   and is the only read the ride waits for (D-2.3).
 * - {@link AreaReader.moveTo} is synchronous and asks for nothing while the
 *   rider stays in one block. On entering a new one it drops every held block
 *   outside the new 3 × 3 (the bound: never more than {@link MAX_HELD_BLOCKS}
 *   blocks, {@link MAX_HELD_TILES} tiles) and asks for the new 3 × 3's other
 *   blocks after one random delay of up to {@link CROSSING_DELAY_MAX_MS}
 *   (R-8). ⚠️ **The delay holds only that background request**: the call
 *   returns at once and the ride keeps riding on what is held.
 * - {@link AreaReader.stop} abandons a running read and every waiting one.
 *
 * **The ridden-block cache** (#2891, ADR 0090 D-6): every block is looked for
 * in {@link AreaReaderOptions.cache} before it is asked for, and a block in it
 * is never asked for again (D-6.7); a block read from the archive is kept
 * there. Each block's features are decoded about the block's own corner
 * ({@link blockFrame}), not the ride's start, so a kept block serves any later
 * ride. With map tiles off, a ride reads only what is kept (D-7.2).
 *
 * ⚠️ **What is requested is a function of the rider's block alone** (R-1):
 * a position is turned into its block by {@link blockOf} and nothing else of
 * it is kept. The reader takes no privacy zone (R-3, the owner's Q2) and the
 * delay's draw takes no argument at all (R-8).
 *
 * ⚠️ **This file names no network primitive** (ADR 0054 D-1.1): the bytes
 * arrive through a {@link CorridorArchive}, which in the product is
 * `world-data/corridor-source.ts`' — the one module with the one request
 * (ADR 0090 D-3), so `privacy/no-network.test.ts` gains no entry. Decoding is
 * `readCorridorTiles`', so every tile is held to `@onyourleft/map-features`'
 * bounds (`limits.ts`) and every failure is put into words by
 * `describeCorridorFailure` alone, which names no coordinate, no tile and no
 * block (R-2).
 */

import {
  columnAtLongitude,
  rowAtLatitude,
  tileBounds,
  TILES_AT_Z15,
  type CorridorFrame,
  type TileId,
} from '@onyourleft/map-features';

import {
  describeCorridorFailure,
  readCorridorTiles,
  type ArchiveOpening,
  type CorridorArchive,
  type CorridorFeatures,
  type CorridorPlan,
  type CorridorTile,
} from './corridor';

/** Blocks along one side of the world: a block is a z14 tile (ADR 0090 D-2.1). */
const BLOCKS = TILES_AT_Z15 / 2;

/** The blocks held round the rider: their own and the eight round it (D-2.2). */
export const MAX_HELD_BLOCKS = 9;

/** The z15 tiles those blocks are: four each. */
export const MAX_HELD_TILES = MAX_HELD_BLOCKS * 4;

/** The longest a crossing's request waits (ADR 0090 R-8, the owner's Q4 of 2026-11-20). */
export const CROSSING_DELAY_MAX_MS = 30_000;

/** One block: a z14 tile of the archive's grid. */
export interface BlockId {
  readonly x: number;
  readonly y: number;
}

/** A position, as the reader is told it. Only its block is ever kept. */
export interface AreaPosition {
  readonly latitude: number;
  readonly longitude: number;
}

/** The z15 row or column clamped onto the grid, as `corridorTileCover` clamps it. */
function onGrid(value: number): number {
  return Math.min(TILES_AT_Z15 - 1, Math.max(0, Math.floor(value)));
}

/** The block a position is in, or `undefined` for a position that is not one. */
export function blockOf(position: AreaPosition): BlockId | undefined {
  const { latitude, longitude } = position;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (Math.abs(latitude) > 85.0511 || Math.abs(longitude) > 180) return undefined;
  return {
    x: Math.floor(onGrid(columnAtLongitude(longitude)) / 2),
    y: Math.floor(onGrid(rowAtLatitude(latitude)) / 2),
  };
}

/** The 3 × 3 round `block`, centre first and then row by row; none off the grid. */
export function blocksAround(block: BlockId): BlockId[] {
  const out: BlockId[] = [block];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = block.x + dx;
      const y = block.y + dy;
      if ((dx !== 0 || dy !== 0) && x >= 0 && y >= 0 && x < BLOCKS && y < BLOCKS) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/** A block's four z15 tiles, in a fixed order. */
export function tilesOfBlock(block: BlockId): TileId[] {
  const x = block.x * 2;
  const y = block.y * 2;
  return [
    { z: 15, x, y },
    { z: 15, x: x + 1, y },
    { z: 15, x, y: y + 1 },
    { z: 15, x: x + 1, y: y + 1 },
  ];
}

/**
 * The frame a block's features are decoded in: its own north-west corner,
 * fixed to the grid like the block (R-1). A block's features are the same
 * whichever ride reads them, so the ridden-block cache (#2891) can keep them
 * and hand them to a ride that started somewhere else.
 */
export function blockFrame(block: BlockId): CorridorFrame {
  const corner = tileBounds({ z: 15, x: block.x * 2, y: block.y * 2 });
  return { latitude: corner.north, longitude: corner.west };
}

/** The key a block is kept under (`RiddenBlockRecord.block`): `y × 2^14 + x`. */
export function blockKey(block: BlockId): number {
  return block.y * BLOCKS + block.x;
}

/**
 * A crossing's delay (R-8): `random()` scaled onto [0, {@link CROSSING_DELAY_MAX_MS}].
 * ⚠️ It is handed nothing but the draw, so no position, block or time of
 * crossing can decide it.
 */
export function crossingDelayMs(random: () => number): number {
  const draw = random();
  if (!Number.isFinite(draw)) return CROSSING_DELAY_MAX_MS;
  return Math.min(CROSSING_DELAY_MAX_MS, Math.max(0, draw * CROSSING_DELAY_MAX_MS));
}

/** One block the reader holds: its four tiles' states and its decoded features. */
export interface HeldBlock {
  readonly block: BlockId;
  /** {@link blockFrame}: the features' local metres are about the block's own corner. */
  readonly frame: CorridorFrame;
  readonly tiles: readonly CorridorTile[];
  readonly features: CorridorFeatures;
}

/**
 * The ridden-block cache, as the reader sees it (ADR 0090 D-6.7): read before
 * the network, written after it. `world-data/ridden-blocks.ts` is the
 * product's, over the store and for one athlete.
 */
export interface AreaCache {
  /** The block as kept, or `undefined` when it is not. */
  get(block: BlockId): Promise<Pick<HeldBlock, 'tiles' | 'features'> | undefined>;
  /** Keeps a block just read from the archive whose identity is `identity`. */
  put(held: HeldBlock, identity: string): Promise<void>;
}

/** What {@link AreaReader.start} came to. */
export type AreaStart =
  | { readonly kind: 'off'; readonly why: 'map-tiles-off' | 'no-archive' | 'wrong-schema' }
  /** The start's own block is held: the ride may begin. */
  | { readonly kind: 'ready' }
  /** The start's own block could not be read, or the reader was stopped. */
  | { readonly kind: 'unavailable' };

export interface AreaReaderOptions {
  /** `corridor-source.ts` §`corridorArchive` in the product; `undefined` when none is configured. */
  readonly archive: CorridorArchive | undefined;
  /**
   * The ridden-block cache (#2891), asked before every request. With map
   * tiles off, a ride reads only what it holds (D-7.2).
   */
  readonly cache?: AreaCache | undefined;
  /** The map-tiles switch (ADR 0090 D-7.1), read before every request. */
  readonly mapTilesOn: () => boolean;
  /** The draw for R-8's delay. `Math.random` in the product. */
  readonly random?: (() => number) | undefined;
  /** Runs `run` after `ms`; returns what cancels it. `setTimeout` in the product. */
  readonly schedule?: ((run: () => void, ms: number) => () => void) | undefined;
  /** Where failures are said, in `describeCorridorFailure`'s words only. */
  readonly log?: ((line: string) => void) | undefined;
  readonly yieldToIdle?: (() => Promise<void>) | undefined;
}

export interface AreaReader {
  /** Reads the start's 3 × 3, with no delay (D-2.3). Never rejects. */
  start(position: AreaPosition): Promise<AreaStart>;
  /** The rider is at `position`. Synchronous: it never waits for a read. */
  moveTo(position: AreaPosition): void;
  /** Every block held now. */
  held(): readonly HeldBlock[];
  /** Whether the block `position` is in is held. */
  holds(position: AreaPosition): boolean;
  /** Resolves when no read is running (a delayed one not yet due does not count). */
  settled(): Promise<void>;
  /** The ride has ended: the running read is abandoned and nothing more is asked. */
  stop(): void;
}

const keyOf = blockKey;

/** An error's class name, which says what failed and carries no value. */
const nameOf = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

export function createAreaReader(options: AreaReaderOptions): AreaReader {
  const random = options.random ?? Math.random;
  const schedule = options.schedule ?? defaultSchedule;
  const ride = new AbortController();
  const held = new Map<number, HeldBlock>();
  /** Blocks waiting their turn, in the order they were asked for. */
  const queue: BlockId[] = [];
  /** The blocks of the current 3 × 3. */
  let wanted = new Set<number>();
  let centre: number | undefined;
  let running: { key: number; stop: AbortController } | undefined;
  let pumping: Promise<void> = Promise.resolve();
  const waiting = new Set<() => void>();
  let stopped = false;
  let opening: Promise<ArchiveOpening> | undefined;

  // The archive is opened once per ride, not once per block: its header and
  // metadata are the same ranges whatever the block, and need asking once.
  const archive: CorridorArchive | undefined =
    options.archive === undefined
      ? undefined
      : {
          open: () => {
            const inner = options.archive as CorridorArchive;
            opening ??= inner.open(ride.signal).catch((error: unknown) => {
              opening = undefined;
              throw error;
            });
            return opening;
          },
          tile: (tile, signal) => (options.archive as CorridorArchive).tile(tile, signal),
        };

  const log = options.log ?? ((): void => undefined);

  /** The block from the cache, or `undefined`; a store that fails is a miss. */
  const cached = async (block: BlockId): Promise<HeldBlock | undefined> => {
    if (options.cache === undefined) return undefined;
    try {
      const kept = await options.cache.get(block);
      return kept === undefined ? undefined : { block, frame: blockFrame(block), ...kept };
    } catch (error) {
      log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
      return undefined;
    }
  };

  const readOne = async (
    block: BlockId,
    stop: AbortController,
  ): Promise<'read' | 'wrong-schema' | 'none'> => {
    // D-6.7: a block in the cache is never asked for again while it is there.
    const kept = await cached(block);
    if (kept !== undefined) {
      if (!stopped && wanted.has(keyOf(block))) held.set(keyOf(block), kept);
      return 'read';
    }
    if (archive === undefined) return 'none';
    const tiles = tilesOfBlock(block);
    const frame = blockFrame(block);
    const plan: CorridorPlan = {
      frame,
      tiles: tiles.map((tile) => ({ x: tile.x, y: tile.y, state: 'covered' })),
      requestable: tiles,
    };
    const read = await readCorridorTiles({
      plan,
      archive,
      signal: stop.signal,
      progress: () => undefined,
      log: options.log,
      mustStop: () => stopped || !options.mapTilesOn(),
      yieldToIdle: options.yieldToIdle,
    });
    if (read.kind === 'wrong-schema') return 'wrong-schema';
    // A block the rider has left behind while it was read is not kept.
    if (read.kind !== 'read' || stopped || !wanted.has(keyOf(block))) return 'none';
    const fresh: HeldBlock = { block, frame, tiles: read.tiles, features: read.features };
    held.set(keyOf(block), fresh);
    // Kept for the next ride. A store that refuses it costs that ride a re-read.
    try {
      await options.cache?.put(fresh, read.identity);
    } catch (error) {
      log(describeCorridorFailure({ kind: 'store', name: nameOf(error) }));
    }
    return 'read';
  };

  let sawWrongSchema = false;
  const pump = (): Promise<void> => {
    pumping = pumping.then(async () => {
      for (;;) {
        const block = queue.shift();
        if (block === undefined || stopped) return;
        const key = keyOf(block);
        if (!wanted.has(key) || held.has(key)) continue;
        const stop = new AbortController();
        const forward = (): void => {
          stop.abort();
        };
        ride.signal.addEventListener('abort', forward, { once: true });
        running = { key, stop };
        try {
          if ((await readOne(block, stop)) === 'wrong-schema') sawWrongSchema = true;
        } finally {
          ride.signal.removeEventListener('abort', forward);
          running = undefined;
        }
      }
    });
    return pumping;
  };

  /** Queues the blocks not already asked for; the pump skips what is held by its turn. */
  const ask = (blocks: readonly BlockId[]): void => {
    for (const block of blocks) {
      const key = keyOf(block);
      if (running?.key === key || queue.some((b) => keyOf(b) === key)) continue;
      queue.push(block);
    }
    void pump();
  };

  /** Makes `block` the centre: drops what is behind, and returns the 3 × 3. */
  const centreOn = (block: BlockId): BlockId[] => {
    const around = blocksAround(block);
    centre = keyOf(block);
    wanted = new Set(around.map(keyOf));
    for (const key of [...held.keys()]) if (!wanted.has(key)) held.delete(key);
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!wanted.has(keyOf(queue[i] as BlockId))) queue.splice(i, 1);
    }
    if (running !== undefined && !wanted.has(running.key)) running.stop.abort();
    return around;
  };

  const off = (): AreaStart | undefined => {
    if (!options.mapTilesOn()) return { kind: 'off', why: 'map-tiles-off' };
    if (archive === undefined) return { kind: 'off', why: 'no-archive' };
    return undefined;
  };

  return {
    start: async (position) => {
      const block = blockOf(position);
      if (stopped || block === undefined) return { kind: 'unavailable' };
      // With no cache, map tiles off or no archive means nothing to read at all.
      if (options.cache === undefined) {
        const why = off();
        if (why !== undefined) return why;
      }
      ask(centreOn(block));
      await pumping;
      if (sawWrongSchema) return { kind: 'off', why: 'wrong-schema' };
      if (held.has(keyOf(block))) return { kind: 'ready' };
      // D-7.2: the start's block is not cached, and tiles off or no archive
      // is why it was not read.
      return off() ?? { kind: 'unavailable' };
    },
    moveTo: (position) => {
      const block = blockOf(position);
      if (stopped || block === undefined || keyOf(block) === centre) return;
      const around = centreOn(block);
      // One draw per crossing (R-8), taken before anything is known of the
      // blocks to ask for, and handed nothing.
      const delay = crossingDelayMs(random);
      // A scheduler may run the request at once (a test's does), before
      // `schedule` has returned what cancels it: `fired` says so.
      const timer = { fired: false, cancel: (): void => undefined };
      timer.cancel = schedule(() => {
        timer.fired = true;
        waiting.delete(timer.cancel);
        if (stopped) return;
        // Only what is still round the rider when the delay ends. Map tiles
        // turned off since, or no archive, and the read asks for nothing
        // (`readOne`'s `mustStop`, checked before every request).
        ask(around.filter((b) => wanted.has(keyOf(b))));
      }, delay);
      if (!timer.fired) waiting.add(timer.cancel);
    },
    held: () => [...held.values()],
    holds: (position) => {
      const block = blockOf(position);
      return block !== undefined && held.has(keyOf(block));
    },
    settled: () => pumping,
    stop: () => {
      stopped = true;
      queue.length = 0;
      for (const cancel of waiting) cancel();
      waiting.clear();
      ride.abort();
      held.clear();
    },
  };
}
