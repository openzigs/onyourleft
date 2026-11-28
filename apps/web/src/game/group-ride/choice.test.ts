// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The group ride's setup — #3303, ADR 0101 D-1, D-2 and D-3.4: what the
 * device keeps, what the chooser is told, and what it is not offered beside.
 */

import { describe, expect, it } from 'vitest';

import { northRoute, steadyClimb } from '../route-fixtures-testing';

import {
  DEFAULT_GROUP_RIDE,
  GROUP_RIDE_DEFAULT_BOTS,
  GROUP_RIDE_LEAST_BOTS,
  GROUP_RIDE_MOST_BOTS,
  GROUP_RIDE_STORAGE_KEY,
  GROUP_RIDE_UNAVAILABLE_TEXT,
  groupRideAsked,
  groupRidePlan,
  groupRideUnavailable,
  groupSpeedText,
  groupSpeedTyped,
  readGroupRideKept,
  writeGroupRideKept,
} from './choice';

const FLAT = northRoute(5_000, () => 0);

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map(Object.entries(initial));
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value);
    },
  };
}

describe('the setup kept on the device', () => {
  it('is the default where nothing was kept, or nothing can be read', () => {
    expect(readGroupRideKept(undefined)).toStrictEqual(DEFAULT_GROUP_RIDE);
    expect(readGroupRideKept(memoryStorage())).toStrictEqual(DEFAULT_GROUP_RIDE);
    for (const text of ['', 'not json', 'null', '7', '"on"']) {
      expect(
        readGroupRideKept(memoryStorage({ [GROUP_RIDE_STORAGE_KEY]: text })),
        text,
      ).toStrictEqual(DEFAULT_GROUP_RIDE);
    }
    expect(DEFAULT_GROUP_RIDE).toStrictEqual({ on: false, targetSpeed: 30 / 3.6, bots: 5 });
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readGroupRideKept(throwing)).toStrictEqual(DEFAULT_GROUP_RIDE);
    expect(writeGroupRideKept(throwing, DEFAULT_GROUP_RIDE)).toBe(false);
    expect(writeGroupRideKept(undefined, DEFAULT_GROUP_RIDE)).toBe(false);
  });

  it('reads back what was written, through the one key', () => {
    const storage = memoryStorage();
    const kept = { on: true, targetSpeed: 9.5, bots: 7 };
    expect(writeGroupRideKept(storage, kept)).toBe(true);
    expect(readGroupRideKept(storage)).toStrictEqual(kept);
    expect(storage.getItem(GROUP_RIDE_STORAGE_KEY)).not.toBeNull();
  });

  it('keeps each part that reads beside one that does not', () => {
    const read = (value: unknown) =>
      readGroupRideKept(memoryStorage({ [GROUP_RIDE_STORAGE_KEY]: JSON.stringify(value) }));
    expect(read({ on: true, targetSpeed: 9, bots: 12 })).toStrictEqual({
      on: true,
      targetSpeed: 9,
      bots: GROUP_RIDE_DEFAULT_BOTS,
    });
    expect(read({ on: 'yes', targetSpeed: -3, bots: 4 })).toStrictEqual({
      on: false,
      targetSpeed: DEFAULT_GROUP_RIDE.targetSpeed,
      bots: 4,
    });
    expect(read({ targetSpeed: 'fast', bots: 3.5 })).toStrictEqual(DEFAULT_GROUP_RIDE);
    expect(read({ on: true, bots: GROUP_RIDE_LEAST_BOTS - 1 }).bots).toBe(GROUP_RIDE_DEFAULT_BOTS);
    expect(read({ on: true, bots: GROUP_RIDE_MOST_BOTS }).bots).toBe(GROUP_RIDE_MOST_BOTS);
  });
});

describe('the speed box', () => {
  it('shows a speed in the rider’s units and reads it back', () => {
    expect(groupSpeedText(30 / 3.6, 'metric')).toBe('30');
    expect(groupSpeedText(30 / 3.6, 'imperial')).toBe('18.6');
    expect(groupSpeedTyped(' 30 ', 'metric')).toBeCloseTo(30 / 3.6, 9);
    expect(groupSpeedTyped('18.6', 'imperial')).toBeCloseTo(18.6 * 0.44704, 6);
  });

  it('reads no speed from an empty box, words, nought or less', () => {
    for (const text of ['', '   ', 'fast', '0', '-20', 'Infinity', 'NaN']) {
      expect(groupSpeedTyped(text, 'metric'), text).toBeUndefined();
    }
  });
});

describe('what a group ride is not offered beside — ADR 0101 D-1.5', () => {
  it('a workout holding the trainer, first, then the draft switched off, then a loop', () => {
    expect(groupRideUnavailable(false, true, false)).toBeUndefined();
    expect(groupRideUnavailable(true, true, false)).toBe('workout');
    expect(groupRideUnavailable(false, false, false)).toBe('draft-off');
    expect(groupRideUnavailable(true, false, false)).toBe('workout');
    // The review of PR #3364: the plan is one pass of the route, so not on a loop (#3369).
    expect(groupRideUnavailable(false, true, true)).toBe('loop');
    expect(groupRideUnavailable(false, false, true)).toBe('draft-off');
    expect(groupRideUnavailable(true, true, true)).toBe('workout');
  });

  it('has one sentence for each reason, naming no place and no number', () => {
    for (const text of Object.values(GROUP_RIDE_UNAVAILABLE_TEXT)) {
      expect(text).toMatch(/^A group ride is not offered /);
      expect(text).not.toMatch(/\d/);
    }
    expect(GROUP_RIDE_UNAVAILABLE_TEXT.workout).toContain('workout');
    expect(GROUP_RIDE_UNAVAILABLE_TEXT['draft-off']).toContain('draft');
    expect(GROUP_RIDE_UNAVAILABLE_TEXT.loop).toContain('loop');
  });
});

describe('the group asked for', () => {
  it('is none, with no complaint, while the switch is off or no route is chosen', () => {
    expect(groupRideAsked(false, '', 99, 'metric', FLAT)).toStrictEqual({
      ride: undefined,
      problem: undefined,
    });
    expect(groupRideAsked(true, '30', 5, 'metric', undefined)).toStrictEqual({
      ride: undefined,
      problem: undefined,
    });
  });

  it('is the speed in metres a second and the size, where the route can be ridden at it', () => {
    const metric = groupRideAsked(true, '30', 5, 'metric', FLAT);
    expect(metric.problem).toBeUndefined();
    expect(metric.ride?.bots).toBe(5);
    expect(metric.ride?.targetSpeed).toBeCloseTo(30 / 3.6, 9);
    const imperial = groupRideAsked(true, '20', 3, 'imperial', FLAT);
    expect(imperial.ride?.targetSpeed).toBeCloseTo(20 * 0.44704, 6);
    expect(imperial.ride?.bots).toBe(3);
  });

  it('refuses an empty or wordy speed, and a size out of range, in words', () => {
    for (const text of ['', 'fast', '0', '-5']) {
      expect(groupRideAsked(true, text, 5, 'metric', FLAT), text).toStrictEqual({
        ride: undefined,
        problem: 'Choose an average speed for the group.',
      });
    }
    for (const bots of [2, 8, 4.5, Number.NaN]) {
      expect(groupRideAsked(true, '30', bots, 'metric', FLAT), String(bots)).toStrictEqual({
        ride: undefined,
        problem: 'Choose a group of 3 to 7 riders.',
      });
    }
  });

  it('refuses a target the group cannot make on the route, with the most it can, in the rider’s units', () => {
    const asked = groupRideAsked(true, '90', 5, 'metric', FLAT);
    expect(asked.ride).toBeUndefined();
    const most =
      /^The group cannot average 90 km\/h on this route\. The most it can average here is (\d+(?:\.\d)?) km\/h\.$/.exec(
        asked.problem ?? '',
      );
    expect(most, asked.problem).not.toBeNull();
    // The figure shown is one the group takes: typed back, it is ridden.
    const shown = most?.[1] ?? '';
    expect(Number(shown)).toBeLessThan(90);
    expect(groupRideAsked(true, shown, 5, 'metric', FLAT).ride).toBeDefined();
    // And a tenth over it is still refused, so the figure is the most, not a guess under it.
    expect(
      groupRideAsked(true, String(Number(shown) + 0.2), 5, 'metric', FLAT).problem,
    ).toBeDefined();

    const miles = groupRideAsked(true, '60', 5, 'imperial', FLAT);
    expect(miles.problem).toMatch(
      /^The group cannot average 60 mph on this route\. The most it can average here is \d+(\.\d)? mph\.$/,
    );
  });

  it('refuses a target too slow for the route, with the least the group can make', () => {
    // Downhill all the way, the gentlest group still rolls faster than a crawl.
    const descent = northRoute(3_000, (along) => -along * 0.06);
    const asked = groupRideAsked(true, '3', 5, 'metric', descent);
    expect(asked.ride).toBeUndefined();
    const least =
      /^The group cannot average as little as 3 km\/h on this route\. The least it can average here is (\d+(?:\.\d)?) km\/h\.$/.exec(
        asked.problem ?? '',
      );
    expect(least, asked.problem).not.toBeNull();
    expect(groupRideAsked(true, least?.[1] ?? '', 5, 'metric', descent).ride).toBeDefined();
  });

  it('refuses by the plan the ride is ridden by', () => {
    const climb = steadyClimb();
    for (const text of ['8', '15', '30', '60']) {
      const asked = groupRideAsked(true, text, 5, 'metric', climb);
      const plan = groupRidePlan({ targetSpeed: Number(text) / 3.6, bots: 5 }, climb);
      expect(asked.ride === undefined, text).toBe('error' in plan);
    }
  });
});
