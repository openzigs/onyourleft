// SPDX-License-Identifier: Apache-2.0

/**
 * Which rider is drawn (#2839): that the choice survives a reload, that it is
 * athlete-scoped, that nothing but one of the two words ever comes back out —
 * and that it IS the heart-rate calorie estimate's sex, one choice written to
 * both fields, which is the owner's ruling of 2026-11-20 (superseding the
 * 2026-11-18 ruling that kept them apart).
 *
 * Every read is through the #28 round-trip harness, whose `read()` cannot be
 * served by the handle that wrote, and through `getAthlete` — the path
 * `apps/web/src/main.tsx` reads the row by before the game is told the body.
 *
 * ⚠️ **Every case that proves a write lands chooses `female`**, which is NOT
 * the default: an absent field is drawn as the default, so a write that
 * landed nowhere and a write of `male` look the same from the game.
 */

import { unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { AthleteRecord } from './records';
import {
  DEFAULT_RIDER_BODY,
  isRiderBody,
  parseRiderBody,
  RIDER_BODIES,
  riderChoiceOf,
} from './rider-body';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  lookOnlyRiderStoreFactory,
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

describe('the two words', () => {
  it('are female and male, and the default is the rider drawn before #2839', () => {
    expect([...RIDER_BODIES]).toEqual(['female', 'male']);
    expect(DEFAULT_RIDER_BODY).toBe('male');
  });

  it('reads anything else as the default, and never as the other word', () => {
    for (const stranger of ['Female', ' female', 'f', 'woman', 'robot', 7, null, {}, 'toString']) {
      expect(isRiderBody(stranger), JSON.stringify(stranger)).toBe(false);
      expect(parseRiderBody(stranger), JSON.stringify(stranger)).toBe('male');
    }
    expect(parseRiderBody(undefined)).toBe('male');
  });

  it('keeps both words', () => {
    for (const body of RIDER_BODIES) expect(parseRiderBody(body)).toBe(body);
  });
});

describe('the rider body is stored on the athlete (#2839)', () => {
  it('survives a reload, read back on a connection that never wrote it', async () => {
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'female'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.riderBody).toBe('female');
    } finally {
      await harness.destroy();
    }
  });

  it('is absent on a row nobody has chosen for, rather than defaulted on disk', async () => {
    const harness = createStoreHarness();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.putAthlete(athlete()),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk).toBeDefined();
      expect(onDisk?.riderBody).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('can be changed back', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'female'));
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'male'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.riderBody).toBe('male');
    } finally {
      await harness.destroy();
    }
  });

  it('is athlete-scoped: one rider’s choice reaches neither of the other two', async () => {
    // CLAUDE.md §6's cross-athlete class, with three athletes.
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteRider(ATHLETE_C, 'male'));
      const [a, b, c] = await harness.roundTrip(
        async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'female'),
        async (fresh) =>
          Promise.all([
            fresh.getAthlete(ATHLETE_A),
            fresh.getAthlete(ATHLETE_B),
            fresh.getAthlete(ATHLETE_C),
          ]),
      );

      expect(a?.riderBody).toBe('female');
      expect(b?.riderBody).toBeUndefined();
      expect(c?.riderBody).toBe('male');
    } finally {
      await harness.destroy();
    }
  });

  it('survives the other narrow writes, the kit colour among them', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) => fresh.putAthlete(athlete()));
      await harness.write(async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'female'));
      await harness.write(async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'purple'));
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'imperial'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.riderBody).toBe('female');
      expect(onDisk?.kitColour).toBe('purple');
      expect(onDisk?.units).toBe('imperial');
    } finally {
      await harness.destroy();
    }
  });

  it('on an athlete that does not exist is not an error, and writes nothing', async () => {
    const harness = createStoreHarness();
    try {
      const result = await harness.write(async (fresh) =>
        fresh.setAthleteRider(ATHLETE_A, 'female'),
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
      await harness.write(async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'female'));
      await harness.write(async (fresh) => fresh.deleteAthlete(ATHLETE_A));

      const recreated = await harness.roundTrip(
        async (fresh) => fresh.ensureAthlete(athlete()),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );
      expect(recreated?.riderBody).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });
});

describe('nothing but one of the two words comes back out (#2839, CLAUDE.md §6)', () => {
  it('decodes a hand-edited value as the default, and the row still decodes', async () => {
    const harness = createStoreHarness();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) =>
          fresh.putAthlete({ ...athlete(), riderBody: 'robot' as AthleteRecord['riderBody'] }),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.riderBody).toBe('male');
      expect(onDisk?.displayName).toBe('Rider');
    } finally {
      await harness.destroy();
    }
  });

  it('writes the default, not what it was handed, when a caller casts past the type', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) => fresh.putAthlete(athlete()));
      const answered = await harness.write(async (fresh) =>
        fresh.setAthleteRider(ATHLETE_A, 'robot' as 'female'),
      );
      const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));

      expect(answered?.riderBody).toBe('male');
      expect(onDisk?.riderBody).toBe('male');
    } finally {
      await harness.destroy();
    }
  });
});

/**
 * The owner's ruling of 2026-11-20, as a property of the store: one Female /
 * Male choice, written to the look and to the calorie estimate's sex together.
 *
 * ⚠️ **A pair, and neither means anything alone** (docs/agents/store-harness.md
 * §5): the same assertion passes against the real store and fails against one
 * that writes the look only.
 */
describe('choosing a rider is also the calorie estimate’s sex (#2839, 2026-11-20)', () => {
  async function assertRiderWritesBoth(harness: StoreHarness): Promise<void> {
    await harness.write(async (fresh) => fresh.putAthlete(athlete()));
    // The calorie sex starts as the OTHER word, so a half write shows.
    await harness.write(async (fresh) =>
      fresh.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'male', birthYear: 1985 }),
    );
    await harness.write(async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'female'));

    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    if (onDisk?.riderBody !== 'female') {
      throw new Error(`read back the rider ${String(onDisk?.riderBody)}, not female`);
    }
    if (onDisk.calorieSex !== 'female') {
      throw new Error(`the calorie sex read back ${String(onDisk.calorieSex)}, not female`);
    }
    if (onDisk.birthYear !== 1985) {
      throw new Error(`the year of birth changed to ${String(onDisk.birthYear)}`);
    }
  }

  it('passes against the real store', async () => {
    const harness = createStoreHarness();
    try {
      await expect(assertRiderWritesBoth(harness)).resolves.toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('fails against a store that writes the look only', async () => {
    const harness = createStoreHarness({ factory: lookOnlyRiderStoreFactory() });
    try {
      await expect(assertRiderWritesBoth(harness)).rejects.toThrow(
        /calorie sex read back male, not female/,
      );
    } finally {
      await harness.destroy();
    }
  });

  it('writes male to both, from a row where they disagreed the other way', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) => fresh.putAthlete({ ...athlete(), riderBody: 'female' }));
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteRider(ATHLETE_A, 'male'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.riderBody).toBe('male');
      expect(onDisk?.calorieSex).toBe('male');
    } finally {
      await harness.destroy();
    }
  });
});

describe('riderChoiceOf: the one rule that reads the two fields (2026-11-20)', () => {
  it('is the calorie sex when it is set, whatever the look says', () => {
    expect(riderChoiceOf({ calorieSex: 'female', riderBody: 'male' })).toBe('female');
    expect(riderChoiceOf({ calorieSex: 'male', riderBody: 'female' })).toBe('male');
    expect(riderChoiceOf({ calorieSex: 'female' })).toBe('female');
  });

  it('is the look when there is no calorie sex', () => {
    expect(riderChoiceOf({ riderBody: 'female' })).toBe('female');
  });

  it('is nothing for a rider who never chose, and for no row', () => {
    expect(riderChoiceOf({})).toBeUndefined();
    expect(riderChoiceOf(undefined)).toBeUndefined();
  });

  it('reads a row stored before the ruling, through the store', async () => {
    const harness = createStoreHarness();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) =>
          fresh.putAthlete({ ...athlete(), riderBody: 'male', calorieSex: 'female' }),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(riderChoiceOf(onDisk)).toBe('female');
    } finally {
      await harness.destroy();
    }
  });
});
