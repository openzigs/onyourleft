// SPDX-License-Identifier: AGPL-3.0-or-later

/** #2882: the fixed block grid and the streaming count the write-up's numbers come from. */

import { describe, expect, it } from 'vitest';

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';

import { blockKey, blocksWithin, blockTiles, streamRide, tileAt } from './block-grid';
import { ridden, turningLegs } from './turning-ride';

const START = geographicPosition(degreesLatitude(41.9), degreesLongitude(-87.8));

describe('the fixed block grid (#2882)', () => {
  it('names one block for every tile in it, and its tiles are the size squared', () => {
    const tile = tileAt(START);
    const key = blockKey(tile, 2);
    const tiles = blockTiles(key, 2);
    expect(tiles).toHaveLength(4);
    expect(tiles).toContainEqual(tile);
    for (const each of tiles) expect(blockKey(each, 2)).toBe(key);
    // The corner is on the grid, wherever the rider is: never centred on a place.
    expect((tiles[0] as { x: number }).x % 2).toBe(0);
    expect((tiles[0] as { y: number }).y % 2).toBe(0);
  });

  it('finds the block under a point and its neighbours as the reach grows', () => {
    expect(blocksWithin(START, 0, 1)).toEqual(new Set([blockKey(tileAt(START), 1)]));
    expect(blocksWithin(START, 1_000, 1).size).toBeGreaterThanOrEqual(4);
  });
});

describe('streaming a ride (#2882)', () => {
  // 40 km/h for ten minutes, a turn every 300 to 500 m.
  const path = ridden(START, turningLegs(7, 40), 40 / 3.6, 1);

  it('is late with no lead and a slow read, and on time with a lead that covers it', () => {
    const base = { path, stepSeconds: 1, size: 1, need: 400, readyAfterMs: 3_000 };
    expect(streamRide({ ...base, lead: 0 }).late).toBeGreaterThan(0);
    // 3 s at 11.1 m/s is 33 m; one step's ride more is the most a lead must add.
    expect(streamRide({ ...base, lead: 50 }).late).toBe(0);
  });

  it('counts each block once, as tiles', () => {
    const one = streamRide({ path, stepSeconds: 1, size: 1, need: 400, lead: 50, readyAfterMs: 0 });
    const two = streamRide({ path, stepSeconds: 1, size: 2, need: 400, lead: 50, readyAfterMs: 0 });
    expect(one.tiles).toBe(one.blocks);
    expect(two.tiles).toBe(two.blocks * 4);
    // Coarser blocks read more tiles for the same ride: the cost of not centring on a place.
    expect(two.tiles).toBeGreaterThan(one.tiles);
    expect(one.tilesPerHour).toBe(Math.round((one.tiles * 3600) / one.seconds));
  });
});
