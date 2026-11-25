// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The open-world ride's height tiles — #2899, ADR 0087 D-2, D-3 and D-7.
 *
 * Over a fixture terrain archive of synthetic height tiles, read through
 * `PMTiles` and the product's own reader (`terrain/terrain-source.ts`), with
 * the product's decode bounds (`terrain/decode.ts`). Every hostile tile is a
 * fixture built by a formula; none is real terrain.
 */

import type { HeightTileId } from '@onyourleft/map-features';
import {
  CLIFF,
  cliffHeightTile,
  FLAT_HEIGHT_METRES,
  flatHeightTile,
  oversizeHeightTile,
  SLOPE_BASE_METRES,
  slopeHeightTile,
  truncatedHeightTile,
} from '@onyourleft/map-features/testing';
import { describe, expect, it, vi } from 'vitest';

import { terrainArchiveFrom } from '../../terrain/terrain-source';
import {
  buildTerrainArchive,
  fixtureDecode,
  FIXTURE_HEIGHT_TILE,
  NEXT_HEIGHT_TILE,
  placeInTile,
} from '../../terrain/terrain-testing';
import { countingSource, type CountingSource } from '../../world-data/archive-testing';
import { CROSSING_DELAY_MAX_MS } from '../world-data/area';
import {
  createRoadHeights,
  HEIGHTS_START_TIMEOUT_MS,
  type RoadHeights,
  type RoadHeightsOptions,
} from './heights';

/** A scheduler a test runs by hand: what was asked to run, after how long, and whether it was cancelled. */
function manualSchedule() {
  const waiting: { run: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    waiting,
    schedule: (run: () => void, ms: number) => {
      const entry = { run, ms, cancelled: false };
      waiting.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    /** Run everything still waiting, as if its time had come. */
    runAll: () => {
      for (const entry of waiting.splice(0)) if (!entry.cancelled) entry.run();
    },
  };
}

/** Let every promise already resolvable settle. No timer is involved. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

async function heightsOver(
  tiles: readonly { readonly tile: HeightTileId; readonly bytes: Uint8Array }[],
  overrides: Partial<RoadHeightsOptions> = {},
): Promise<{
  heights: RoadHeights;
  source: CountingSource;
  clock: ReturnType<typeof manualSchedule>;
  said: string[];
}> {
  const source = countingSource(await buildTerrainArchive(tiles));
  const clock = manualSchedule();
  const said: string[] = [];
  const heights = createRoadHeights({
    archive: terrainArchiveFrom(source),
    mapTilesOn: () => true,
    decode: fixtureDecode,
    schedule: clock.schedule,
    random: () => 0.5,
    log: (line) => said.push(line),
    ...overrides,
  });
  return { heights, source, clock, said };
}

/** Inside block (1, 1) of the fixture tile: its 3 × 3 of blocks lies inside that one tile. */
const MIDDLE = placeInTile(FIXTURE_HEIGHT_TILE, 192, 192);
/** In the same block, 600 m away. */
const SAME_BLOCK = placeInTile(FIXTURE_HEIGHT_TILE, 150, 230);
/** In the tile's north-west block: its 3 × 3 touches the three tiles west and north as well. */
const CORNER = placeInTile(FIXTURE_HEIGHT_TILE, 20, 20);
/** In the block on the tile's east edge: its 3 × 3 touches the next tile east. */
const EAST_EDGE = placeInTile(FIXTURE_HEIGHT_TILE, 490, 192);

describe('the tiles held are the z12 tiles round the rider’s block', () => {
  it('reads the start’s tile at once, and answers with the ground’s height', async () => {
    const { heights, source, clock } = await heightsOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: slopeHeightTile(0.5) },
    ]);
    expect(heights.heightAt(MIDDLE)).toBeUndefined();
    await heights.start(MIDDLE);
    // Nothing waited out a delay: the start is not a crossing (ADR 0090 R-8).
    expect(clock.waiting.every((entry) => entry.ms === HEIGHTS_START_TIMEOUT_MS)).toBe(true);
    expect(source.calls.length).toBeGreaterThan(0);
    expect(heights.version).toBe(1);
    // A pixel's own height at its centre, and bilinear between two.
    expect(heights.heightAt(placeInTile(FIXTURE_HEIGHT_TILE, 100.5, 300.5))).toBeCloseTo(
      SLOPE_BASE_METRES + 100 * 0.5,
      6,
    );
    expect(heights.heightAt(placeInTile(FIXTURE_HEIGHT_TILE, 101, 300.5))).toBeCloseTo(
      SLOPE_BASE_METRES + 100.5 * 0.5,
      6,
    );
  });

  it('asks nothing more while the rider stays in the block (R-1)', async () => {
    const { heights, source, clock } = await heightsOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    await heights.start(MIDDLE);
    const asked = source.calls.length;
    heights.moveTo(SAME_BLOCK);
    heights.moveTo(MIDDLE);
    clock.runAll();
    await settled();
    expect(source.calls).toHaveLength(asked);
  });

  it('asks the same of the host from anywhere in a block (R-1), with no zone to read (R-3)', async () => {
    const tiles = [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }];
    const first = await heightsOver(tiles);
    const second = await heightsOver(tiles);
    await first.heights.start(MIDDLE);
    await second.heights.start(SAME_BLOCK);
    expect(first.source.calls.length).toBeGreaterThan(0);
    expect(second.source.calls).toStrictEqual(first.source.calls);
  });

  it('holds one tile in the middle of a tile, two at an edge and four at a corner', async () => {
    const tile = (x: number, y: number) => ({
      tile: { z: 12 as const, x, y },
      bytes: flatHeightTile(),
    });
    const { x, y } = FIXTURE_HEIGHT_TILE;
    const all = [tile(x - 1, y - 1), tile(x, y - 1), tile(x - 1, y), tile(x, y), tile(x + 1, y)];
    const known = async (start: typeof MIDDLE): Promise<number> => {
      const { heights } = await heightsOver(all);
      await heights.start(start);
      return heights.version;
    };
    expect(await known(MIDDLE)).toBe(1);
    expect(await known(EAST_EDGE)).toBe(2);
    // Four is the most a 3 × 3 of blocks can touch.
    expect(await known(CORNER)).toBe(4);
  });

  it('lets go of a tile the rider has left, and holds the ones round them', async () => {
    const { heights, clock } = await heightsOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
      { tile: NEXT_HEIGHT_TILE, bytes: slopeHeightTile(0.1) },
    ]);
    await heights.start(MIDDLE);
    // Into the middle of the next tile east: the first tile is out of reach.
    heights.moveTo(placeInTile(NEXT_HEIGHT_TILE, 192, 192));
    clock.runAll();
    await settled();
    expect(heights.heightAt(MIDDLE)).toBeUndefined();
    expect(heights.heightAt(placeInTile(NEXT_HEIGHT_TILE, 0.5, 100))).toBeCloseTo(
      SLOPE_BASE_METRES,
      6,
    );
  });
});

describe('a crossing waits a random delay of up to 30 s (R-8)', () => {
  it('asks for a new tile only when the delay has passed, and the ride reads on meanwhile', async () => {
    const { heights, source, clock } = await heightsOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
      { tile: NEXT_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    await heights.start(MIDDLE);
    clock.waiting.length = 0;
    const asked = source.calls.length;
    heights.moveTo(EAST_EDGE);
    await settled();
    // Nothing asked yet, and what is held still answers.
    expect(source.calls).toHaveLength(asked);
    expect(heights.heightAt(EAST_EDGE)).toBe(FLAT_HEIGHT_METRES);
    expect(clock.waiting).toHaveLength(1);
    expect(clock.waiting[0]?.ms).toBe(0.5 * CROSSING_DELAY_MAX_MS);
    clock.runAll();
    await settled();
    expect(source.calls.length).toBeGreaterThan(asked);
    expect(heights.heightAt(placeInTile(NEXT_HEIGHT_TILE, 10, 192))).toBe(FLAT_HEIGHT_METRES);
  });

  it('never waits longer than 30 s, whatever the draw', async () => {
    for (const draw of [0, 0.999, 7, Number.NaN]) {
      const { heights, clock } = await heightsOver(
        [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }],
        { random: () => draw },
      );
      await heights.start(MIDDLE);
      clock.waiting.length = 0;
      heights.moveTo(EAST_EDGE);
      for (const entry of clock.waiting) {
        expect(entry.ms).toBeGreaterThanOrEqual(0);
        expect(entry.ms).toBeLessThanOrEqual(CROSSING_DELAY_MAX_MS);
      }
    }
  });
});

describe('with map tiles off, or no archive', () => {
  it('asks for nothing and knows no height (R-6)', async () => {
    const { heights, source, clock } = await heightsOver(
      [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }],
      { mapTilesOn: () => false },
    );
    await heights.start(MIDDLE);
    heights.moveTo(EAST_EDGE);
    clock.runAll();
    await settled();
    expect(source.calls).toHaveLength(0);
    expect(heights.heightAt(MIDDLE)).toBeUndefined();
    expect(heights.version).toBe(0);
  });

  it('knows no height with no archive configured, and does not throw', async () => {
    const heights = createRoadHeights({ archive: undefined, mapTilesOn: () => true });
    await heights.start(MIDDLE);
    expect(heights.heightAt(MIDDLE)).toBeUndefined();
    heights.stop();
  });
});

describe('a height tile is untrusted input (ADR 0087 D-3)', () => {
  it.each([
    [
      'a malformed tile',
      truncatedHeightTile,
      'Height tile refused: its image could not be decoded.',
    ],
    ['an oversize tile', oversizeHeightTile, 'Height tile refused: it is not 512 pixels square.'],
  ])(
    'refuses %s: no height, no throw, and it is not asked for again',
    async (_, hostile, words) => {
      const { heights, source, clock, said } = await heightsOver([
        { tile: FIXTURE_HEIGHT_TILE, bytes: hostile() },
      ]);
      await heights.start(MIDDLE);
      expect(heights.heightAt(MIDDLE)).toBeUndefined();
      expect(heights.version).toBe(0);
      expect(said).toStrictEqual([words]);
      const asked = source.calls.length;
      heights.moveTo(SAME_BLOCK);
      heights.moveTo(MIDDLE);
      clock.runAll();
      await settled();
      expect(source.calls).toHaveLength(asked);
    },
  );

  it('answers an oversize tile from its header: `terrain/decode.test.ts` holds that no decoder sees it', async () => {
    const decode = vi.fn(fixtureDecode);
    const { heights } = await heightsOver(
      [{ tile: FIXTURE_HEIGHT_TILE, bytes: oversizeHeightTile() }],
      { decode },
    );
    await heights.start(MIDDLE);
    // The bounded decode was asked, and answered from the header.
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await decode.mock.results[0]?.value).toStrictEqual({
      reason: 'wrong-size',
      pixels: 512,
    });
  });

  it('reads a cliff edge as the heights it holds: the road, not the tile, refuses the step', async () => {
    const { heights } = await heightsOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: cliffHeightTile() },
    ]);
    await heights.start(MIDDLE);
    expect(heights.heightAt(placeInTile(FIXTURE_HEIGHT_TILE, 200, 192))).toBe(CLIFF.topMetres);
    expect(heights.heightAt(placeInTile(FIXTURE_HEIGHT_TILE, 300, 192))).toBe(CLIFF.footMetres);
  });

  it('names no tile and no coordinate in anything it says', async () => {
    const { heights, source, clock, said } = await heightsOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: truncatedHeightTile() },
      { tile: NEXT_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    await heights.start(MIDDLE);
    source.offline = true;
    heights.moveTo(placeInTile(NEXT_HEIGHT_TILE, 192, 192));
    clock.runAll();
    await settled();
    expect(said.length).toBeGreaterThanOrEqual(2);
    expect(said).toContain('The terrain archive could not be reached.');
    const secrets = [
      String(FIXTURE_HEIGHT_TILE.x),
      String(FIXTURE_HEIGHT_TILE.y),
      String(NEXT_HEIGHT_TILE.x),
      MIDDLE.latitude.toFixed(1),
      MIDDLE.longitude.toFixed(1),
      String(Math.trunc(MIDDLE.latitude)),
      String(Math.trunc(Math.abs(MIDDLE.longitude))),
    ];
    for (const line of said) {
      for (const secret of secrets) expect(line).not.toContain(secret);
      // The only number is the tile's own size, which is not a place.
      expect(line.replace('512', '')).not.toMatch(/\d/);
    }
  });
});

describe('a read that fails', () => {
  it('is asked for again after a delay, so a moment offline is not the whole ride', async () => {
    const onChange = vi.fn();
    const { heights, source, clock, said } = await heightsOver(
      [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }],
      { onChange },
    );
    source.offline = true;
    await heights.start(MIDDLE);
    expect(heights.heightAt(MIDDLE)).toBeUndefined();
    expect(said).toStrictEqual(['The terrain archive could not be reached.']);
    source.offline = false;
    clock.waiting.length = 0;
    // The rider has not left the block: the next report of where they are asks again.
    heights.moveTo(SAME_BLOCK);
    expect(clock.waiting).toHaveLength(1);
    expect(clock.waiting[0]?.ms).toBeGreaterThan(0);
    clock.runAll();
    await settled();
    expect(heights.heightAt(MIDDLE)).toBe(FLAT_HEIGHT_METRES);
    expect(heights.version).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('the start is bounded, and stop lets everything go', () => {
  it('begins without heights when the tiles do not arrive in time', async () => {
    const { heights, clock } = await heightsOver(
      [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }],
      { decode: () => new Promise(() => undefined), startTimeoutMs: 1_234 },
    );
    let begun = false;
    const start = heights.start(MIDDLE).then(() => {
      begun = true;
    });
    await settled();
    expect(begun).toBe(false);
    expect(clock.waiting.map((entry) => entry.ms)).toStrictEqual([1_234]);
    clock.runAll();
    await start;
    expect(begun).toBe(true);
    expect(heights.heightAt(MIDDLE)).toBeUndefined();
  });

  it('asks for nothing after stop, cancels what was waiting and forgets what it held', async () => {
    const { heights, source, clock } = await heightsOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
      { tile: NEXT_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    await heights.start(MIDDLE);
    clock.waiting.length = 0;
    heights.moveTo(EAST_EDGE);
    expect(clock.waiting).toHaveLength(1);
    heights.stop();
    heights.stop();
    expect(clock.waiting[0]?.cancelled).toBe(true);
    const asked = source.calls.length;
    heights.moveTo(CORNER);
    await heights.start(CORNER);
    clock.runAll();
    await settled();
    expect(source.calls).toHaveLength(asked);
    expect(heights.heightAt(MIDDLE)).toBeUndefined();
  });
});
