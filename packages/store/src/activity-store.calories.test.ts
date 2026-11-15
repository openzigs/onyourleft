// SPDX-License-Identifier: Apache-2.0

/**
 * A ride's stored calorie estimate (#2433): written with the ride, read back on
 * a fresh connection by the ride's own read and by the list's, absent on a row
 * written before it, and refused on disk when it is not an estimate at all.
 */

import { kilocalories, unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, TABLE } from './index';
import type { ActivityCaloriesBasis } from './records';
import {
  ATHLETE_A,
  createStoreHarness,
  openOlderSchema,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from './testing';

async function seeded(): Promise<StoreHarness> {
  const harness = createStoreHarness();
  await seedAthletes(harness);
  return harness;
}

describe('a ride’s calorie estimate is stored with it (#2433)', () => {
  it.each<ActivityCaloriesBasis>(['power', 'heart-rate', 'file'])(
    'round-trips on the %s basis, through the ride’s read and the list’s',
    async (basis) => {
      const harness = await seeded();
      try {
        const ride = {
          ...rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) }),
          calories: { energy: kilocalories(612.4), basis },
        };
        const [one, list] = await harness.roundTrip(
          async (store) => store.putActivity(ride),
          async (store) =>
            Promise.all([
              store.getActivity(ATHLETE_A, ride.id),
              store.listActivitySummaries(ATHLETE_A),
            ]),
        );
        expect(one?.calories).toStrictEqual({ energy: 612.4, basis });
        expect(list[0]?.calories).toStrictEqual({ energy: 612.4, basis });
      } finally {
        await harness.destroy();
      }
    },
  );

  it('is absent on a ride written without one, rather than nought', async () => {
    const harness = await seeded();
    try {
      const ride = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
      const read = await harness.roundTrip(
        async (store) => store.putActivity(ride),
        async (store) => store.getActivity(ATHLETE_A, ride.id),
      );
      expect(read).toBeDefined();
      expect(read).not.toHaveProperty('calories');
    } finally {
      await harness.destroy();
    }
  });
});

describe('a stored estimate that is not one is refused on read', () => {
  async function readRaw(calories: unknown): Promise<unknown> {
    const harness = await seeded();
    try {
      const ride = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
      await harness.write(async (store) => store.putActivity(ride));
      await harness.discard();
      const raw = await openOlderSchema(harness.databaseName, SCHEMA_VERSION);
      await raw.put(TABLE.activities, {
        id: ride.id,
        athleteId: ATHLETE_A,
        name: ride.name,
        startedAt: ride.startedAt,
        startedAtTimeZone: ride.startedAtTimeZone,
        elapsedTime: ride.elapsedTime,
        movingTime: ride.movingTime,
        distance: ride.distance,
        visibility: 'private',
        hasPosition: ride.hasPosition,
        mayBeRaced: false,
        createdAt: ride.createdAt,
        calories,
      });
      raw.close();
      return await harness.read(async (store) => store.getActivity(ATHLETE_A, ride.id));
    } finally {
      await harness.destroy();
    }
  }

  it('refuses a basis that is not one of the three', async () => {
    await expect(readRaw({ energy: 600, basis: 'guess' })).rejects.toThrow(
      /activity\.calories\.basis/,
    );
  });

  it('refuses a negative energy', async () => {
    await expect(readRaw({ energy: -1, basis: 'power' })).rejects.toThrow(
      /activity\.calories\.energy/,
    );
  });
});
