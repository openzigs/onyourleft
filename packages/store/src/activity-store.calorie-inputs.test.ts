// SPDX-License-Identifier: Apache-2.0

/**
 * The athlete's calorie inputs — the sex and the year of birth a heart-rate
 * calorie estimate needs (#2432): that they can be written, survive a reload,
 * clear, leave every other field and every other athlete alone, and that a row
 * written before them reads back unchanged.
 *
 * Every read is on a connection that never wrote (`docs/agents/store-harness.md`).
 */

import { beatsPerMinute, kilograms, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, TABLE } from './index';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  droppedBirthYearStoreFactory,
  openOlderSchema,
  seedAthletes,
  type StoreHarness,
} from './testing';

async function seeded(harness: StoreHarness = createStoreHarness()): Promise<StoreHarness> {
  await seedAthletes(harness);
  return harness;
}

describe('the calorie inputs can be written and read back (#2432)', () => {
  it('survive a reload, read back through getAthlete on a fresh connection', async () => {
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (store) =>
          store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'female', birthYear: 1985 }),
        async (store) => store.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.calorieSex).toBe('female');
      expect(onDisk?.birthYear).toBe(1985);
    } finally {
      await harness.destroy();
    }
  });

  it('answers with the row it wrote', async () => {
    const harness = await seeded();
    try {
      const written = await harness.write(async (store) =>
        store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'male', birthYear: 1990 }),
      );
      expect(written?.calorieSex).toBe('male');
      expect(written?.birthYear).toBe(1990);
    } finally {
      await harness.destroy();
    }
  });

  it.each([
    ['the sex', { calorieSex: undefined, birthYear: 1985 }, undefined, 1985],
    ['the year of birth', { calorieSex: 'female', birthYear: undefined }, 'female', undefined],
    ['both', { calorieSex: undefined, birthYear: undefined }, undefined, undefined],
  ] as const)('clears %s with an undefined', async (_, inputs, sex, year) => {
    const harness = await seeded();
    try {
      await harness.write(async (store) =>
        store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'female', birthYear: 1985 }),
      );
      const onDisk = await harness.roundTrip(
        async (store) => store.setAthleteCalorieInputs(ATHLETE_A, inputs),
        async (store) => store.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.calorieSex).toBe(sex);
      expect(onDisk?.birthYear).toBe(year);
      expect(onDisk?.id).toBe(ATHLETE_A);
    } finally {
      await harness.destroy();
    }
  });

  it('refuses a birth year that is not a whole number, and writes nothing', async () => {
    const harness = await seeded();
    try {
      await expect(
        harness.write(async (store) =>
          store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'male', birthYear: 1985.5 }),
        ),
      ).rejects.toThrow(/athlete\.birthYear: must be a whole year/);
      const onDisk = await harness.read(async (store) => store.getAthlete(ATHLETE_A));
      expect(onDisk?.calorieSex).toBeUndefined();
      expect(onDisk?.birthYear).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('on an athlete that does not exist is not an error', async () => {
    const harness = createStoreHarness();
    try {
      const result = await harness.write(async (store) =>
        store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'male', birthYear: 1990 }),
      );
      expect(result).toBeUndefined();
      expect(await harness.read(async (store) => store.getAthlete(ATHLETE_A))).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });
});

describe('nothing else moves when the calorie inputs do', () => {
  it('leaves the mass, the thresholds and the identity alone', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (store) => {
        await store.setAthleteMass(ATHLETE_A, kilograms(68));
        await store.setAthleteThresholds(ATHLETE_A, {
          thresholdPower: watts(250),
          thresholdHeartRate: beatsPerMinute(172),
        });
      });
      const onDisk = await harness.roundTrip(
        async (store) =>
          store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'female', birthYear: 1985 }),
        async (store) => store.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.mass).toBe(68);
      expect(onDisk?.thresholdPower).toBe(250);
      expect(onDisk?.thresholdHeartRate).toBe(172);
    } finally {
      await harness.destroy();
    }
  });

  it('a mass write leaves the calorie inputs alone', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (store) =>
        store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'female', birthYear: 1985 }),
      );
      const onDisk = await harness.roundTrip(
        async (store) => store.setAthleteMass(ATHLETE_A, kilograms(70)),
        async (store) => store.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.calorieSex).toBe('female');
      expect(onDisk?.birthYear).toBe(1985);
    } finally {
      await harness.destroy();
    }
  });

  it('is athlete-scoped: a write for A leaves B and C unchanged', async () => {
    const harness = await seeded();
    try {
      const [before, after] = [
        await harness.read(async (store) =>
          Promise.all([store.getAthlete(ATHLETE_B), store.getAthlete(ATHLETE_C)]),
        ),
        await harness.roundTrip(
          async (store) =>
            store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'male', birthYear: 1990 }),
          async (store) => Promise.all([store.getAthlete(ATHLETE_B), store.getAthlete(ATHLETE_C)]),
        ),
      ];
      expect(after).toStrictEqual(before);
      expect(after[0]?.calorieSex).toBeUndefined();
      expect(after[1]?.birthYear).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });
});

describe('a row written before #2432', () => {
  it('reads back with neither field, and still reads its mass and thresholds', async () => {
    const harness = createStoreHarness();
    try {
      // The row as an older build left it: no `calorieSex` key, no `birthYear`
      // key, written raw rather than through `toPersistedAthlete`.
      const raw = await openOlderSchema(harness.databaseName, SCHEMA_VERSION);
      await raw.put(TABLE.athletes, {
        id: ATHLETE_A,
        displayName: 'Rider',
        createdAt: 1_600_000_000,
        thresholdPower: 240,
        thresholdHeartRate: 170,
        mass: 72.5,
      });
      raw.close();

      const onDisk = await harness.read(async (store) => store.getAthlete(ATHLETE_A));
      expect(onDisk).toStrictEqual({
        id: ATHLETE_A,
        displayName: 'Rider',
        createdAt: unixSeconds(1_600_000_000),
        thresholdPower: 240,
        thresholdHeartRate: 170,
        mass: 72.5,
      });
      expect(onDisk?.calorieSex).toBeUndefined();
      expect(onDisk?.birthYear).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('reads an unrecognised sex or a non-whole year on disk as unset, not as an error', async () => {
    const harness = createStoreHarness();
    try {
      const raw = await openOlderSchema(harness.databaseName, SCHEMA_VERSION);
      await raw.put(TABLE.athletes, {
        id: ATHLETE_A,
        displayName: 'Rider',
        createdAt: 1_600_000_000,
        calorieSex: 'other',
        birthYear: 1985.5,
        mass: 72.5,
      });
      raw.close();

      const onDisk = await harness.read(async (store) => store.getAthlete(ATHLETE_A));
      expect(onDisk?.calorieSex).toBeUndefined();
      expect(onDisk?.birthYear).toBeUndefined();
      expect(onDisk?.mass).toBe(72.5);
    } finally {
      await harness.destroy();
    }
  });
});

describe('the round trip calibrated against a store that drops the year', () => {
  async function assertCalorieInputsPersist(harness: StoreHarness): Promise<void> {
    await seedAthletes(harness);
    const onDisk = await harness.roundTrip(
      async (store) =>
        store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'female', birthYear: 1985 }),
      async (store) => store.getAthlete(ATHLETE_A),
    );
    if (onDisk?.calorieSex !== 'female' || onDisk.birthYear !== 1985) {
      throw new Error(
        `read back ${String(onDisk?.calorieSex)} and ${String(onDisk?.birthYear)}, not both`,
      );
    }
  }

  it('passes against the real store', async () => {
    const harness = createStoreHarness();
    try {
      await expect(assertCalorieInputsPersist(harness)).resolves.toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('fails against a store that drops the year of birth', async () => {
    const harness = createStoreHarness({ factory: droppedBirthYearStoreFactory() });
    try {
      await expect(assertCalorieInputsPersist(harness)).rejects.toThrow(/not both/);
    } finally {
      await harness.destroy();
    }
  });
});
