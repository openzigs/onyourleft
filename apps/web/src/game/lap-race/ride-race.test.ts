// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `ride-race.ts`' own refusals and no-op paths — #1906. What a race does
 * inside a ride, read back through the real `GameView`, is
 * `../lap-race-wiring.test.tsx`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import { kilograms } from '@onyourleft/domain';

import { LAP_RACE_ASSIST_STORAGE_KEY } from './assist-preference';
import {
  askRaceItem,
  askRaceLane,
  LAP_RACE_MOST_BOTS,
  lapRaceBotConditions,
  lapRaceHeard,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceChoice,
  type LapRaceRide,
} from './ride-race';

const LOOP = circuitRoute(40);

/** The race the tablet step for #733 rides: three laps against seven bots, with items. */
const DEFAULT_LAP_RACE: LapRaceChoice = {
  laps: 3,
  bots: LAP_RACE_MOST_BOTS,
  tier: 'brisk',
  itemsOn: true,
};

function race(choice: LapRaceChoice = DEFAULT_LAP_RACE, profile = LOOP): LapRaceRide | undefined {
  return startLapRaceRide({
    choice,
    profile,
    conditions: lapRaceBotConditions(
      profile,
      rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
    ),
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
  });
}

function started(): LapRaceRide {
  const ride = race();
  if (ride === undefined) throw new Error('a loop starts a race');
  return ride;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a lap race in a ride — #1906', () => {
  it('starts the tablet step’s race on a loop: three laps, the rider and seven bots on the line', () => {
    const ride = started();
    expect(ride.race.course.laps).toBe(3);
    expect(ride.race.racers.map((entry) => entry.racer.id)).toEqual([
      'bot-1',
      'bot-2',
      'bot-3',
      'bot-4',
      'bot-5',
      'bot-6',
      'bot-7',
      'rider',
    ]);
    expect(ride.race.racers.every((entry) => entry.racer.effortDistance === 0)).toBe(true);
    expect(ride.names['bot-3']).toBe('Brisk bot 3');
  });

  it('starts no race on a route that is not a loop', () => {
    expect(
      race(
        DEFAULT_LAP_RACE,
        northRoute(500, () => 0),
      ),
    ).toBeUndefined();
  });

  it('draws the seed from the platform’s cryptographic source, once', () => {
    const draws = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const first = started();
    expect(draws).toHaveBeenCalledTimes(1);
    draws.mockImplementation(<T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 7;
      return array;
    });
    expect(started().seed).toBe(7);
    expect(Number.isSafeInteger(first.seed)).toBe(true);
  });

  it.each([0, LAP_RACE_MOST_BOTS + 1, 2.5, Number.NaN])(
    'refuses a field of %s bots, naming the constraint and not the value',
    (bots) => {
      expect(() => race({ ...DEFAULT_LAP_RACE, bots })).toThrow(
        new RangeError('a lap race has a whole number of bots, 1 to 7'),
      );
    },
  );

  it.each([-1, 1.5, Number.NaN])('refuses a step of %s ticks', (ticks) => {
    expect(() => stepLapRaceRide(started(), { ticks, along: 10 })).toThrow(
      new RangeError('a lap race step runs a whole number of ticks, 0 or more'),
    );
  });

  it('steps nothing on a frame that ran no simulation step', () => {
    const ride = started();
    expect(stepLapRaceRide(ride, { ticks: 0, along: 50 })).toBe(ride);
  });

  it('never steps the rider backwards: an odometer behind the last tick is the last tick’s', () => {
    const ride = stepLapRaceRide(started(), { ticks: 2, along: 4 });
    const after = stepLapRaceRide(ride, { ticks: 1, along: 1 });
    const rider = after.race.racers.find((entry) => entry.racer.id === 'rider');
    expect(rider?.racer.effortDistance).toBe(4);
    expect(after.along).toBe(4);
  });

  it.each([
    [true, null],
    [false, 'tailwind'],
  ] as const)(
    'with auto-use %s, a held item is used on the next tick, pressed or not',
    (autoUse, held) => {
      const storage = {
        getItem: (key: string) =>
          key === LAP_RACE_ASSIST_STORAGE_KEY
            ? JSON.stringify({ itemsOff: false, autoUse, noKnockBack: false, gentlerBots: false })
            : null,
        setItem: () => undefined,
      };
      const ride = startLapRaceRide({
        choice: DEFAULT_LAP_RACE,
        profile: LOOP,
        conditions: lapRaceBotConditions(
          LOOP,
          rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
        ),
        riderDistance: 0,
        lineOffset: 0,
        storage,
      });
      if (ride === undefined) throw new Error('a loop starts a race');
      const holding: LapRaceRide = {
        ...ride,
        race: {
          ...ride.race,
          racers: ride.race.racers.map((entry) =>
            entry.racer.id === 'rider' ? { ...entry, held: 'tailwind' as const } : entry,
          ),
        },
      };
      const after = stepLapRaceRide(holding, { ticks: 1, along: 0.5 });
      expect(after.race.racers.find((entry) => entry.racer.id === 'rider')?.held).toBe(held);
    },
  );

  it('returns the race it was given for a press that changes nothing, and for a silence', () => {
    const ride = started();
    const left = askRaceLane(askRaceLane(ride, 'lane-left'), 'lane-left');
    expect(askRaceLane(left, 'lane-left')).toBe(left);
    const asked = askRaceItem(ride);
    expect(asked).not.toBe(ride);
    expect(askRaceItem(asked)).toBe(asked);
    expect(lapRaceHeard(ride, undefined, 0)).toBe(ride);
  });
});
