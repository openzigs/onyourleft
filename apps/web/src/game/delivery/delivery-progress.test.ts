// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';

import {
  DELIVERY_PROGRESS_FIELDS,
  DELIVERY_PROGRESS_STORAGE_KEY,
  readDeliveryProgress,
  writeDeliveryProgress,
} from './delivery-progress';
import {
  DAYS_IN_WEEK,
  endRound,
  FRESH_WEEK,
  MOST_HOUSES,
  MOST_WEEK_SCORE,
  recordDelivery,
  recordMiss,
  startRound,
  type WeekProgress,
} from './round';

/** The bytes a device keeps: strings under keys, and nothing else survives a reload. */
type Disk = Map<string, string>;

/**
 * A `localStorage` stand-in over `disk`. Each call builds a new object, so a
 * reader opened with a second call shares the stored strings and nothing else
 * — the round trip crosses the storage boundary, as a reload does.
 */
function open(disk: Disk): PreferenceStorage {
  return {
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => {
      disk.set(key, value);
    },
  };
}

/** What is stored, parsed as a consumer of the raw value would parse it. */
function storedValue(disk: Disk): unknown {
  const text = disk.get(DELIVERY_PROGRESS_STORAGE_KEY);
  expect(text).toBeTypeOf('string');
  return JSON.parse(text ?? '');
}

describe("the Delivery week's progress on the device — #1806, DL11", () => {
  it('reads back, through a fresh reader over the same storage, what was written', () => {
    const disk: Disk = new Map();
    const progress: WeekProgress = { day: 3, houses: 9, score: 17 };
    expect(writeDeliveryProgress(open(disk), progress)).toBe(true);
    expect([...disk.keys()]).toEqual([DELIVERY_PROGRESS_STORAGE_KEY]);
    expect(readDeliveryProgress(open(disk))).toEqual(progress);
  });

  it("carries a round's outcome into the next ride's round", () => {
    const disk: Disk = new Map();
    let round = startRound(FRESH_WEEK.houses);
    round = recordMiss(round, 0);
    for (let position = 1; position < round.houses.length; position += 1) {
      round = recordDelivery(round, position);
    }
    const outcome = endRound(readDeliveryProgress(open(disk)), round);
    expect(writeDeliveryProgress(open(disk), outcome.next)).toBe(true);

    const tomorrow = readDeliveryProgress(open(disk));
    expect(tomorrow).toEqual({
      day: 2,
      houses: FRESH_WEEK.houses - 1,
      score: FRESH_WEEK.houses - 1,
    });
    expect(startRound(tomorrow.houses).houses).toHaveLength(FRESH_WEEK.houses - 1);
  });

  it('stores counts only: the raw value holds exactly the day, the houses and the score', () => {
    // Adding a field means editing this line, which is the point: a field that
    // names a house, an index into the town or a seed is DL11 broken.
    expect(DELIVERY_PROGRESS_FIELDS).toEqual(['day', 'houses', 'score']);

    const disk: Disk = new Map();
    // A caller handing over more than the counts still stores only the counts.
    const carrying = { day: 2, houses: 7, score: 8, house: 41, seed: 1234 } as WeekProgress;
    expect(writeDeliveryProgress(open(disk), carrying)).toBe(true);
    const stored = storedValue(disk);
    expect(
      typeof stored === 'object' && stored !== null ? Object.keys(stored).sort() : stored,
    ).toEqual([...DELIVERY_PROGRESS_FIELDS].sort());
    expect(stored).toEqual({ day: 2, houses: 7, score: 8 });
  });

  it('reads a fresh week where nothing is stored, or where the store cannot be reached', () => {
    expect(readDeliveryProgress(open(new Map()))).toEqual(FRESH_WEEK);
    expect(readDeliveryProgress(undefined)).toEqual(FRESH_WEEK);
    const blocked: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => undefined,
    };
    expect(readDeliveryProgress(blocked)).toEqual(FRESH_WEEK);
  });

  it.each(['not json', '{"day":', 'null', '[3, 9, 17]', '"week"', '42'])(
    'reads a stored value that fails to parse as a week, %s, as a fresh week',
    (text) => {
      const disk: Disk = new Map([[DELIVERY_PROGRESS_STORAGE_KEY, text]]);
      expect(readDeliveryProgress(open(disk))).toEqual(FRESH_WEEK);
    },
  );

  const inRange = { day: 4, houses: 6, score: 20 };
  it.each([
    ['day 0', { ...inRange, day: 0 }],
    ['a day past the week', { ...inRange, day: DAYS_IN_WEEK + 1 }],
    ['part of a day', { ...inRange, day: 2.5 }],
    ['no houses', { ...inRange, houses: 0 }],
    ['more houses than a round holds', { ...inRange, houses: MOST_HOUSES + 1 }],
    ['a negative score', { ...inRange, score: -1 }],
    ['more than a week can score', { ...inRange, score: MOST_WEEK_SCORE + 1 }],
    ['a count written as text', { ...inRange, score: '20' }],
    ['a count missing', { day: 4, houses: 6 }],
  ])('reads a stored value carrying %s as a fresh week', (_, value) => {
    const disk: Disk = new Map([[DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(value)]]);
    expect(readDeliveryProgress(open(disk))).toEqual(FRESH_WEEK);
    // …and the same value with its counts in range reads back whole.
    disk.set(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(inRange));
    expect(readDeliveryProgress(open(disk))).toEqual(inRange);
  });

  it('reads the edges of every range back as written', () => {
    const disk: Disk = new Map();
    const lowest: WeekProgress = { day: 1, houses: 1, score: 0 };
    const highest: WeekProgress = {
      day: DAYS_IN_WEEK,
      houses: MOST_HOUSES,
      score: MOST_WEEK_SCORE,
    };
    for (const edge of [lowest, highest]) {
      expect(writeDeliveryProgress(open(disk), edge)).toBe(true);
      expect(readDeliveryProgress(open(disk))).toEqual(edge);
    }
  });

  it('reports a device with no storage, or one that refuses, as not keeping the week', () => {
    expect(writeDeliveryProgress(undefined, FRESH_WEEK)).toBe(false);
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(writeDeliveryProgress(refusing, { day: 2, houses: 9, score: 8 })).toBe(false);
    expect(readDeliveryProgress(refusing)).toEqual(FRESH_WEEK);
  });
});
