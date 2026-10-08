// SPDX-License-Identifier: Apache-2.0

/**
 * The rider's masked-word list (#839): that it survives a reload, that it is
 * athlete-scoped, that an erase takes it with the row, and that what comes
 * back out is always a tidy list.
 *
 * Every read is through the #28 round-trip harness, whose `read()` cannot be
 * served by the handle that wrote, and through `getAthlete` — the path
 * `@onyourleft/analysis` §`readMaskingGuard` (`hosted-mask.ts`) reads the
 * list by before a hosted request is masked.
 */

import { kilograms, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { AthleteRecord } from './records';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  lastWordDroppedStoreFactory,
  seedAthletes,
  type StoreHarness,
} from './testing';

async function seeded(): Promise<StoreHarness> {
  const harness = createStoreHarness();
  await seedAthletes(harness);
  return harness;
}

function athlete(id = ATHLETE_A): AthleteRecord {
  return { id, displayName: 'Rider', createdAt: unixSeconds(1_600_000_000) };
}

// What a list may hold — `parseMaskedWords` and `tidyMaskedWord` on their own —
// is `@onyourleft/analysis`'s `masked-words.test.ts`, beside the parser since
// #1094 moved it there.

describe('the list is stored on the athlete (#839)', () => {
  it('survives a reload, read back on a connection that never wrote it', async () => {
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMaskedWords(ATHLETE_A, ['Acacia Avenue', 'Priya']),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.maskedWords).toStrictEqual(['Acacia Avenue', 'Priya']);
    } finally {
      await harness.destroy();
    }
  });

  it('is absent on a row nobody has given one, and an emptied list reads back empty', async () => {
    const harness = await seeded();
    try {
      expect(
        (await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A)))?.maskedWords,
      ).toBeUndefined();
      await harness.write(async (fresh) => fresh.setAthleteMaskedWords(ATHLETE_A, ['Priya']));
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMaskedWords(ATHLETE_A, []),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.maskedWords).toStrictEqual([]);
    } finally {
      await harness.destroy();
    }
  });

  it('writes a tidy list, whatever it was handed', async () => {
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) =>
          fresh.setAthleteMaskedWords(ATHLETE_A, [' Priya ', 'priya', 7 as unknown as string]),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.maskedWords).toStrictEqual(['Priya']);
    } finally {
      await harness.destroy();
    }
  });

  it('is athlete-scoped: one rider’s list reaches neither of the other two', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteMaskedWords(ATHLETE_C, ['Carla']));
      const [a, b, c] = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMaskedWords(ATHLETE_A, ['Priya']),
        async (fresh) =>
          Promise.all([
            fresh.getAthlete(ATHLETE_A),
            fresh.getAthlete(ATHLETE_B),
            fresh.getAthlete(ATHLETE_C),
          ]),
      );
      expect(a?.maskedWords).toStrictEqual(['Priya']);
      expect(b?.maskedWords).toBeUndefined();
      expect(c?.maskedWords).toStrictEqual(['Carla']);
    } finally {
      await harness.destroy();
    }
  });

  it('leaves every other field alone, and survives the other narrow writes', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) =>
        fresh.putAthlete({ ...athlete(), thresholdPower: watts(288), units: 'imperial' }),
      );
      await harness.write(async (fresh) => fresh.setAthleteMaskedWords(ATHLETE_A, ['Priya']));
      await harness.write(async (fresh) => fresh.setAthleteMass(ATHLETE_A, kilograms(70)));
      await harness.write(async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'green'));
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'metric'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.maskedWords).toStrictEqual(['Priya']);
      expect(onDisk?.thresholdPower).toBe(288);
      expect(onDisk?.mass).toBe(70);
      expect(onDisk?.kitColour).toBe('green');
      expect(onDisk?.units).toBe('metric');
    } finally {
      await harness.destroy();
    }
  });

  it('on an athlete that does not exist is not an error, and writes nothing', async () => {
    const harness = createStoreHarness();
    try {
      const result = await harness.write(async (fresh) =>
        fresh.setAthleteMaskedWords(ATHLETE_A, ['Priya']),
      );
      expect(result).toBeUndefined();
      expect(await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A))).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('goes with the row when the athlete is erased, and a recreated row carries none', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteMaskedWords(ATHLETE_A, ['Priya']));
      await harness.write(async (fresh) => fresh.deleteAthlete(ATHLETE_A));
      const recreated = await harness.roundTrip(
        async (fresh) => fresh.ensureAthlete(athlete()),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );
      expect(recreated?.maskedWords).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('decodes a hand-edited row as a tidy list, and the row still decodes', async () => {
    const harness = createStoreHarness();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) =>
          fresh.putAthlete({
            ...athlete(),
            maskedWords: [' Priya', 42, ''] as unknown as readonly string[],
          }),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );
      expect(onDisk?.maskedWords).toStrictEqual(['Priya']);
      expect(onDisk?.displayName).toBe('Rider');
    } finally {
      await harness.destroy();
    }
  });
});

/**
 * The harness's own calibration for this write path — docs/agents/store-harness.md §5. A pair:
 * the same assertion passes against the real store and fails against one that
 * drops the last word on its way in.
 */
describe('the round trip catches a masked word dropped on its way in', () => {
  const WORDS = ['Acacia Avenue', 'Old Town', 'Priya'];

  async function assertMaskedWordsPersist(harness: StoreHarness): Promise<void> {
    await harness.write(async (fresh) => fresh.putAthlete(athlete()));
    const answered = await harness.write(async (fresh) =>
      fresh.setAthleteMaskedWords(ATHLETE_A, WORDS),
    );
    // The write's own answer is the whole list in both stores.
    expect(answered?.maskedWords).toStrictEqual(WORDS);
    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    if (JSON.stringify(onDisk?.maskedWords) !== JSON.stringify(WORDS)) {
      throw new Error(`read back ${JSON.stringify(onDisk?.maskedWords)}, not the whole list`);
    }
  }

  it('passes against the real store', async () => {
    const harness = createStoreHarness();
    try {
      await expect(assertMaskedWordsPersist(harness)).resolves.toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('fails against a store that drops the last word', async () => {
    const harness = createStoreHarness({ factory: lastWordDroppedStoreFactory() });
    try {
      await expect(assertMaskedWordsPersist(harness)).rejects.toThrow(/not the whole list/);
    } finally {
      await harness.destroy();
    }
  });
});
