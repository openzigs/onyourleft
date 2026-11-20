// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The open-world area reader — #2890, ADR 0090 D-2 and R-1, R-6, R-8: what is
 * asked for, when, and what is held, read back through the reader's own
 * `held()` and `holds()` (what the open-world session will read) and through a
 * counting archive (what the host would see). The byte ranges themselves, and
 * every failure path, are `world-data/area-reads.test.ts`' over the product's
 * own source.
 */

import type { TileId } from '@onyourleft/map-features';
import { residentialBlockTile } from '@onyourleft/map-features/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  blockFrame,
  blockOf,
  blocksAround,
  createAreaReader,
  crossingDelayMs,
  CROSSING_DELAY_MAX_MS,
  MAX_HELD_BLOCKS,
  MAX_HELD_TILES,
  tilesOfBlock,
  type AreaPosition,
  type AreaReaderOptions,
  type BlockId,
} from './area';
import type { CorridorArchive } from './corridor';

/** The latitude at a fractional z14 row (Web Mercator, row 0 at the north). */
const latitudeAt = (row: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 2 ** 14))) * 180) / Math.PI;

/** A point `(fx, fy)` of the way across block `b`, from its north-west corner. */
const inside = (b: BlockId, fx: number, fy: number): AreaPosition => ({
  longitude: -180 + ((b.x + fx) / 2 ** 14) * 360,
  latitude: latitudeAt(b.y + fy),
});

/** The middle of the block Denver is in: a block there is some 1.9 km across. */
const START: AreaPosition = inside(
  blockOf({ latitude: 39.74, longitude: -104.99 }) as BlockId,
  0.5,
  0.5,
);
const METRES_PER_DEGREE = 111_320;

/** A position `east` and `north` metres from `from`. */
function offset(from: AreaPosition, east: number, north: number): AreaPosition {
  return {
    latitude: from.latitude + north / METRES_PER_DEGREE,
    longitude:
      from.longitude + east / (METRES_PER_DEGREE * Math.cos((from.latitude * Math.PI) / 180)),
  };
}

/** The archive, as a host would see it: every tile asked for, in order. */
function countingArchive(options: { never?: boolean } = {}) {
  const asked: TileId[] = [];
  const opened: number[] = [];
  const signals: AbortSignal[] = [];
  const archive: CorridorArchive = {
    open: () => {
      opened.push(1);
      return Promise.resolve({
        kind: 'open',
        identity: '"fixture"',
        bounds: { west: -180, south: -85, east: 180, north: 85 },
      });
    },
    tile: (tile, signal) => {
      asked.push(tile);
      signals.push(signal);
      if (options.never === true) {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(residentialBlockTile());
    },
  };
  return { archive, asked, opened, signals };
}

/** A clock the test moves by hand, standing in for `setTimeout`. */
function manualClock() {
  let now = 0;
  const due: { at: number; run: () => void; cancelled: boolean }[] = [];
  const delays: number[] = [];
  const schedule = (run: () => void, ms: number): (() => void) => {
    delays.push(ms);
    const entry = { at: now + ms, run, cancelled: false };
    due.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const entry of due.filter((e) => !e.cancelled && e.at <= now)) {
      entry.cancelled = true;
      entry.run();
    }
  };
  const pending = (): number => due.filter((e) => !e.cancelled).length;
  return { schedule, advance, delays, pending };
}

function reader(overrides: Partial<AreaReaderOptions> & Pick<AreaReaderOptions, 'archive'>) {
  return createAreaReader({
    mapTilesOn: () => true,
    random: () => 0,
    schedule: (run) => {
      run();
      return () => undefined;
    },
    yieldToIdle: () => Promise.resolve(),
    ...overrides,
  });
}

const tileKeys = (tiles: readonly TileId[]): string[] => tiles.map((t) => `${t.x},${t.y}`);
const blockKeys = (blocks: readonly BlockId[]): string[] =>
  blocks.map((b) => `${b.x},${b.y}`).sort();

describe('the grid: a block is a z14 tile, fixed to the archive (D-2.1)', () => {
  it('puts every position inside one z14 tile into that block, and none outside it', () => {
    const block = blockOf(START) as BlockId;
    const [first] = tilesOfBlock(block);
    // The block's own z15 children: its north-west tile is (2x, 2y).
    expect(first).toStrictEqual({ z: 15, x: block.x * 2, y: block.y * 2 });
    const west = blockOf(offset(START, -2_500, 0)) as BlockId;
    expect(west.x).toBe(block.x - 1);
    expect(west.y).toBe(block.y);
    const north = blockOf(offset(START, 0, 2_500)) as BlockId;
    expect(north).toStrictEqual({ x: block.x, y: block.y - 1 });
  });

  it('refuses a position that is not one', () => {
    expect(blockOf({ latitude: Number.NaN, longitude: 0 })).toBeUndefined();
    expect(blockOf({ latitude: 89, longitude: 0 })).toBeUndefined();
    expect(blockOf({ latitude: 0, longitude: 181 })).toBeUndefined();
  });

  it('holds the 3 × 3, centre first, and drops what is off the grid', () => {
    const around = blocksAround({ x: 10, y: 10 });
    expect(around[0]).toStrictEqual({ x: 10, y: 10 });
    expect(new Set(around.map((b) => `${b.x},${b.y}`)).size).toBe(9);
    expect(blocksAround({ x: 0, y: 0 })).toHaveLength(4);
    expect(blocksAround({ x: 2 ** 14 - 1, y: 2 ** 14 - 1 })).toHaveLength(4);
  });

  it('reads four z15 tiles per block, all inside it', () => {
    const block = { x: 4685, y: 6269 };
    expect(tileKeys(tilesOfBlock(block)).sort()).toStrictEqual(
      ['9370,12538', '9371,12538', '9370,12539', '9371,12539'].sort(),
    );
  });
});

describe('R-1: what is asked for is a function of the rider’s block alone', () => {
  const block = blockOf(START) as BlockId;
  // Two starts at opposite corners of the same block.
  const corner = (dx: number, dy: number): AreaPosition =>
    inside(block, dx === 0 ? 0.01 : 0.99, dy === 0 ? 0.01 : 0.99);

  it('asks for the identical tiles, in the identical order, from two starts in one block', async () => {
    const one = countingArchive();
    const two = countingArchive();
    expect(blockOf(corner(0, 0))).toStrictEqual(block);
    expect(blockOf(corner(1, 1))).toStrictEqual(block);
    await reader({ archive: one.archive }).start(corner(0, 0));
    await reader({ archive: two.archive }).start(corner(1, 1));
    expect(one.asked).toHaveLength(MAX_HELD_TILES);
    expect(tileKeys(two.asked)).toStrictEqual(tileKeys(one.asked));
  });

  it('asks for the start’s 3 × 3, centre first, and holds all nine', async () => {
    const { archive, asked, opened } = countingArchive();
    const area = reader({ archive });
    expect(await area.start(START)).toStrictEqual({ kind: 'ready' });
    expect(tileKeys(asked.slice(0, 4))).toStrictEqual(tileKeys(tilesOfBlock(block)));
    expect(blockKeys(area.held().map((h) => h.block))).toStrictEqual(
      blockKeys(blocksAround(block)),
    );
    // Each held block carries its own decoded features, in its own frame:
    // its corner on the grid, whatever the start (#2891 keeps them so).
    for (const held of area.held()) {
      expect(held.features.buildings.length).toBeGreaterThan(0);
      expect(held.frame).toStrictEqual(blockFrame(held.block));
    }
    const corner = blockFrame(block);
    expect(
      blockOf({ latitude: corner.latitude - 1e-6, longitude: corner.longitude + 1e-6 }),
    ).toStrictEqual(block);
    // The archive's header and metadata are asked for once per ride, not per block.
    expect(opened).toHaveLength(1);
  });
});

describe('the lead rule: a crossing asks for the new 3 × 3’s other blocks and nothing else', () => {
  it('asks nothing while the rider stays in one block', async () => {
    const { archive, asked } = countingArchive();
    const area = reader({ archive });
    await area.start(START);
    const before = asked.length;
    const block = blockOf(START) as BlockId;
    for (const [east, north] of [
      [100, 0],
      [-300, 200],
      [0, -150],
    ] as const) {
      const at = offset(START, east, north);
      expect(blockOf(at)).toStrictEqual(block);
      area.moveTo(at);
    }
    await area.settled();
    expect(asked).toHaveLength(before);
  });

  it('asks for the three blocks of the new column on crossing east, and drops the old west column', async () => {
    const { archive, asked } = countingArchive();
    const area = reader({ archive });
    await area.start(START);
    const before = asked.length;
    const block = blockOf(START) as BlockId;
    const east = { x: block.x + 1, y: block.y };
    const at = offset(START, 2_000, 0);
    expect(blockOf(at)).toStrictEqual(east);
    area.moveTo(at);
    await area.settled();
    const fresh = [-1, 0, 1].map((dy) => ({ x: block.x + 2, y: block.y + dy }));
    expect(tileKeys(asked.slice(before)).sort()).toStrictEqual(
      tileKeys(fresh.flatMap(tilesOfBlock)).sort(),
    );
    expect(blockKeys(area.held().map((h) => h.block))).toStrictEqual(blockKeys(blocksAround(east)));
    expect(area.holds(offset(START, -2_000, 0))).toBe(false);
  });

  it('asks for five blocks on a diagonal crossing', async () => {
    const { archive, asked } = countingArchive();
    const area = reader({ archive });
    await area.start(START);
    const before = asked.length;
    const block = blockOf(START) as BlockId;
    const at = offset(START, 2_000, -2_500);
    expect(blockOf(at)).toStrictEqual({ x: block.x + 1, y: block.y + 1 });
    area.moveTo(at);
    await area.settled();
    expect(asked.length - before).toBe(5 * 4);
  });

  it('never holds more than nine blocks, or 36 tiles, over a long ride', async () => {
    const { archive } = countingArchive();
    const area = reader({ archive });
    await area.start(START);
    for (let metres = 0; metres <= 20_000; metres += 250) {
      area.moveTo(offset(START, metres, metres / 3));
      await area.settled();
      const held = area.held();
      expect(held.length).toBeLessThanOrEqual(MAX_HELD_BLOCKS);
      expect(held.flatMap((h) => h.tiles).length).toBeLessThanOrEqual(MAX_HELD_TILES);
    }
  });
});

describe('R-8: a crossing’s request waits a random delay, and the ride never does', () => {
  it('draws the delay from nothing but the random source, once per crossing, inside [0, 30 s]', async () => {
    const draws: unknown[][] = [];
    const random = (...args: unknown[]): number => {
      draws.push(args);
      return 0.5;
    };
    const clock = manualClock();
    const { archive } = countingArchive();
    const area = reader({ archive, random, schedule: clock.schedule });
    await area.start(START);
    // The start's 3 × 3 is not delayed (D-2.3).
    expect(draws).toHaveLength(0);
    area.moveTo(offset(START, 2_000, 0));
    area.moveTo(offset(START, 2_100, 0));
    area.moveTo(offset(START, 4_000, 0));
    expect(draws).toStrictEqual([[], []]);
    expect(clock.delays).toStrictEqual([15_000, 15_000]);
  });

  it('clamps any draw onto [0, 30 s]', () => {
    expect(crossingDelayMs(() => 0)).toBe(0);
    expect(crossingDelayMs(() => 1)).toBe(CROSSING_DELAY_MAX_MS);
    expect(crossingDelayMs(() => 7)).toBe(CROSSING_DELAY_MAX_MS);
    expect(crossingDelayMs(() => -3)).toBe(0);
    expect(crossingDelayMs(() => Number.NaN)).toBe(CROSSING_DELAY_MAX_MS);
    expect(CROSSING_DELAY_MAX_MS).toBe(30_000);
  });

  it('draws alike for two rides through the same blocks at different positions', async () => {
    const run = async (north: number) => {
      const draws: number[] = [];
      const clock = manualClock();
      const { archive, asked } = countingArchive();
      const area = reader({
        archive,
        random: () => {
          draws.push(1);
          return 0.25;
        },
        schedule: clock.schedule,
      });
      await area.start(offset(START, 0, north));
      for (let east = 0; east <= 9_000; east += 500) {
        area.moveTo(offset(START, east, north));
        clock.advance(CROSSING_DELAY_MAX_MS);
        await area.settled();
      }
      return { draws: draws.length, delays: clock.delays, asked: tileKeys(asked) };
    };
    // Both rows stay inside the start's row of blocks.
    expect(blockOf(offset(START, 0, 50))?.y).toBe(blockOf(offset(START, 0, -50))?.y);
    expect(await run(50)).toStrictEqual(await run(-50));
  });

  it('returns at once and asks for nothing until the delay is over', async () => {
    const clock = manualClock();
    const { archive, asked } = countingArchive();
    const area = reader({ archive, random: () => 1, schedule: clock.schedule });
    await area.start(START);
    const before = asked.length;
    expect(area.moveTo(offset(START, 2_000, 0))).toBeUndefined();
    await area.settled();
    clock.advance(CROSSING_DELAY_MAX_MS - 1);
    await area.settled();
    expect(asked).toHaveLength(before);
    clock.advance(1);
    await area.settled();
    expect(asked).toHaveLength(before + 12);
  });

  it('at 40 km/h with every request held the full 30 s, the rider is never outside what is held', async () => {
    const clock = manualClock();
    const { archive } = countingArchive();
    const area = reader({ archive, random: () => 1, schedule: clock.schedule });
    expect(await area.start(START)).toStrictEqual({ kind: 'ready' });
    const metresPerSecond = 40 / 3.6;
    let crossings = 0;
    let last = blockOf(START);
    // An hour, east and then north-east, one step a second.
    for (let second = 1; second <= 3_600; second++) {
      const travelled = second * metresPerSecond;
      const at =
        second < 1_800
          ? offset(START, travelled, 0)
          : offset(
              START,
              1_800 * metresPerSecond + (travelled - 1_800 * metresPerSecond) * 0.7,
              (travelled - 1_800 * metresPerSecond) * 0.7,
            );
      // The frame loop's question, asked before the reader is told: is the
      // block the rider has just reached already there?
      expect(area.holds(at)).toBe(true);
      area.moveTo(at);
      const now = blockOf(at);
      if (now?.x !== last?.x || now?.y !== last?.y) crossings += 1;
      last = now;
      clock.advance(1_000);
      await area.settled();
    }
    expect(crossings).toBeGreaterThan(15);
    expect(new Set(clock.delays)).toStrictEqual(new Set([CROSSING_DELAY_MAX_MS]));
  });
});

describe('the end of the ride', () => {
  it('abandons a running read and every waiting one, and asks nothing after', async () => {
    const clock = manualClock();
    const { archive, asked, signals } = countingArchive({ never: true });
    const area = reader({ archive, schedule: clock.schedule });
    const started = area.start(START);
    await vi.waitFor(() => {
      expect(asked.length).toBeGreaterThan(0);
    });
    area.moveTo(offset(START, 2_000, 0));
    expect(clock.pending()).toBe(1);
    area.stop();
    expect(await started).toStrictEqual({ kind: 'unavailable' });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(clock.pending()).toBe(0);
    const after = asked.length;
    clock.advance(CROSSING_DELAY_MAX_MS);
    area.moveTo(offset(START, 4_000, 0));
    expect(await area.start(START)).toStrictEqual({ kind: 'unavailable' });
    await area.settled();
    expect(asked).toHaveLength(after);
    expect(area.held()).toHaveLength(0);
  });
});

describe('reads that fail, and reads left behind', () => {
  it('waits on the platform timer by default, and stop clears it', async () => {
    vi.useFakeTimers();
    try {
      const { archive, asked } = countingArchive();
      const area = createAreaReader({
        archive,
        mapTilesOn: () => true,
        random: () => 1,
        yieldToIdle: () => Promise.resolve(),
      });
      await area.start(START);
      const before = asked.length;
      area.moveTo(offset(START, 2_000, 0));
      await vi.advanceTimersByTimeAsync(CROSSING_DELAY_MAX_MS - 1);
      expect(asked).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      await area.settled();
      expect(asked).toHaveLength(before + 12);
      area.moveTo(offset(START, 4_000, 0));
      expect(vi.getTimerCount()).toBe(1);
      area.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the archive again at the next crossing when it could not be opened at the start', async () => {
    const { archive, asked } = countingArchive();
    let refuse = true;
    const flaky: CorridorArchive = {
      open: (signal) =>
        refuse ? Promise.reject(new TypeError('Failed to fetch')) : archive.open(signal),
      tile: (tile, signal) => archive.tile(tile, signal),
    };
    const area = reader({ archive: flaky });
    expect(await area.start(START)).toStrictEqual({ kind: 'unavailable' });
    expect(asked).toHaveLength(0);
    refuse = false;
    area.moveTo(offset(START, 2_000, 0));
    await area.settled();
    expect(asked).toHaveLength(MAX_HELD_TILES);
    expect(area.holds(offset(START, 2_000, 0))).toBe(true);
  });

  it('says an archive that is not the basemap schema is off', async () => {
    const { archive, asked } = countingArchive();
    const area = reader({
      archive: {
        open: () => Promise.resolve({ kind: 'wrong-schema' }),
        tile: (tile, signal) => archive.tile(tile, signal),
      },
    });
    expect(await area.start(START)).toStrictEqual({ kind: 'off', why: 'wrong-schema' });
    expect(asked).toHaveLength(0);
  });

  it('abandons a read of a block the rider has left behind', async () => {
    const { archive, asked, signals } = countingArchive({ never: true });
    const area = reader({ archive });
    void area.start(START);
    await vi.waitFor(() => {
      expect(asked.length).toBe(4);
    });
    const centre = signals.slice(0, 4);
    expect(centre.some((signal) => signal.aborted)).toBe(false);
    // Two blocks east: the start's block is outside the new 3 × 3.
    area.moveTo(offset(START, 4_000, 0));
    await vi.waitFor(() => {
      expect(centre.every((signal) => signal.aborted)).toBe(true);
    });
    area.stop();
  });
});

describe('R-6: map tiles off asks for nothing', () => {
  it('makes no request at the start or on any crossing', async () => {
    const { archive, asked, opened } = countingArchive();
    const area = reader({ archive, mapTilesOn: () => false });
    expect(await area.start(START)).toStrictEqual({ kind: 'off', why: 'map-tiles-off' });
    area.moveTo(offset(START, 2_000, 0));
    area.moveTo(offset(START, 6_000, 0));
    await area.settled();
    expect(asked).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });

  it('asks nothing for a crossing whose delay ends after tiles are turned off', async () => {
    let tiles = true;
    const clock = manualClock();
    const { archive, asked } = countingArchive();
    const area = reader({ archive, mapTilesOn: () => tiles, schedule: clock.schedule });
    await area.start(START);
    const before = asked.length;
    area.moveTo(offset(START, 2_000, 0));
    tiles = false;
    clock.advance(CROSSING_DELAY_MAX_MS);
    await area.settled();
    expect(asked).toHaveLength(before);
  });

  it('stops asking the moment tiles are turned off during a read', async () => {
    let tiles = true;
    const { archive, asked } = countingArchive();
    const counting: CorridorArchive = {
      open: (signal) => archive.open(signal),
      tile: (tile, signal) => {
        tiles = false;
        return archive.tile(tile, signal);
      },
    };
    const area = reader({ archive: counting, mapTilesOn: () => tiles });
    await area.start(START);
    expect(asked).toHaveLength(1);
  });

  it('with no archive configured, is off and asks for nothing', async () => {
    const area = reader({ archive: undefined });
    expect(await area.start(START)).toStrictEqual({ kind: 'off', why: 'no-archive' });
  });
});
