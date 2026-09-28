// SPDX-License-Identifier: Apache-2.0

/**
 * The rider's kit colour: that it survives a reload, that it is athlete-scoped,
 * that an erase takes it with the row, and that nothing off the palette ever
 * comes back out (#623).
 *
 * Every read is through the #28 round-trip harness, whose `read()` cannot be
 * served by the handle that wrote, and through `getAthlete` — the path
 * `apps/web/src/main.tsx` reads the row by before the game is handed the
 * colour.
 *
 * ⚠️ **Every case that proves a write lands chooses an entry that is NOT the
 * house colour.** An absent field reads as the house kit in the client, so a
 * write that landed nowhere and a write of `house` look the same from the
 * game — `misfiledKitColourStoreFactory` is exactly that write, and the pair
 * at the bottom is what shows the assertion can tell.
 */

import { kilograms, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { DEFAULT_KIT_COLOUR, isKitColour, KIT_COLOURS, parseKitColour } from './kit-colour';
import type { AthleteRecord } from './records';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  misfiledKitColourStoreFactory,
  seedAthletes,
  type StoreHarness,
} from './testing';

/** Three athletes, from the #28 fixtures — CLAUDE.md §5. */
async function seeded(): Promise<StoreHarness> {
  const harness = createStoreHarness();
  await seedAthletes(harness);
  return harness;
}

function athlete(id = ATHLETE_A): AthleteRecord {
  return { id, displayName: 'Rider', createdAt: unixSeconds(1_600_000_000) };
}

describe('the palette’s keys', () => {
  it('has at most eight entries, the house colour first and the default', () => {
    expect(KIT_COLOURS.length).toBeLessThanOrEqual(8);
    expect(KIT_COLOURS[0]).toBe('house');
    expect(DEFAULT_KIT_COLOUR).toBe('house');
    expect(new Set(KIT_COLOURS).size).toBe(KIT_COLOURS.length);
  });

  it('reads anything off the palette as the house colour, and never as another entry', () => {
    for (const stranger of ['chartreuse', 'HOUSE', ' green', '#0b5c55', 7, null, {}, 'toString']) {
      expect(isKitColour(stranger), JSON.stringify(stranger)).toBe(false);
      expect(parseKitColour(stranger), JSON.stringify(stranger)).toBe('house');
    }
    expect(parseKitColour(undefined)).toBe('house');
  });

  it('keeps every recognised key', () => {
    for (const key of KIT_COLOURS) expect(parseKitColour(key)).toBe(key);
  });
});

describe('the kit colour is stored on the athlete (#623)', () => {
  it('survives a reload, read back on a connection that never wrote it', async () => {
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'magenta'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.kitColour).toBe('magenta');
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
      expect(onDisk?.kitColour).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('can be changed back to the house kit', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'purple'));
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'house'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.kitColour).toBe('house');
    } finally {
      await harness.destroy();
    }
  });

  it('is athlete-scoped: one rider’s choice reaches neither of the other two', async () => {
    // CLAUDE.md §6's cross-athlete class. Three athletes, because two cannot
    // tell "scoped" from "every athlete I can see".
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteKitColour(ATHLETE_C, 'lime'));
      const [a, b, c] = await harness.roundTrip(
        async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'green'),
        async (fresh) =>
          Promise.all([
            fresh.getAthlete(ATHLETE_A),
            fresh.getAthlete(ATHLETE_B),
            fresh.getAthlete(ATHLETE_C),
          ]),
      );

      expect(a?.kitColour).toBe('green');
      expect(b?.kitColour).toBeUndefined();
      expect(c?.kitColour).toBe('lime');
    } finally {
      await harness.destroy();
    }
  });

  it('leaves every other field on the row alone, and survives the other narrow writes', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) =>
        fresh.putAthlete({
          ...athlete(),
          thresholdPower: watts(288),
          mass: kilograms(74.5),
          units: 'imperial',
        }),
      );
      await harness.write(async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'purple'));
      // Each neighbouring narrow write builds from the whole decoded row, so
      // the colour must survive all three.
      await harness.write(async (fresh) => fresh.setAthleteMass(ATHLETE_A, kilograms(70)));
      await harness.write(async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'metric'));
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteThresholds(ATHLETE_A, { thresholdPower: watts(300) }),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.kitColour).toBe('purple');
      expect(onDisk?.thresholdPower).toBe(300);
      expect(onDisk?.mass).toBe(70);
      expect(onDisk?.units).toBe('metric');
      expect(onDisk?.displayName).toBe('Rider');
    } finally {
      await harness.destroy();
    }
  });

  it('on an athlete that does not exist is not an error, and writes nothing', async () => {
    const harness = createStoreHarness();
    try {
      const result = await harness.write(async (fresh) =>
        fresh.setAthleteKitColour(ATHLETE_A, 'green'),
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
      await harness.write(async (fresh) => fresh.setAthleteKitColour(ATHLETE_A, 'magenta'));
      await harness.write(async (fresh) => fresh.deleteAthlete(ATHLETE_A));
      expect(await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A))).toBeUndefined();

      const recreated = await harness.roundTrip(
        async (fresh) => fresh.ensureAthlete(athlete()),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );
      expect(recreated?.kitColour).toBeUndefined();
      // The other athletes' rows are untouched by the erase.
      expect(await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_B))).toBeDefined();
    } finally {
      await harness.destroy();
    }
  });
});

describe('nothing off the palette comes back out (#623, CLAUDE.md §6)', () => {
  it('decodes a hand-edited value as the house colour, and the row still decodes', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) => fresh.putAthlete(athlete()));
      // The row as somebody poking at IndexedDB would leave it.
      const onDisk = await harness.roundTrip(
        async (fresh) =>
          fresh.putAthlete({ ...athlete(), kitColour: '#ff0000' as AthleteRecord['kitColour'] }),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.kitColour).toBe('house');
      expect(onDisk?.displayName).toBe('Rider');
    } finally {
      await harness.destroy();
    }
  });

  it('writes the house colour, not what it was handed, when a caller casts past the type', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) => fresh.putAthlete(athlete()));
      const answered = await harness.write(async (fresh) =>
        fresh.setAthleteKitColour(ATHLETE_A, 'chartreuse' as 'green'),
      );
      const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));

      expect(answered?.kitColour).toBe('house');
      expect(onDisk?.kitColour).toBe('house');
    } finally {
      await harness.destroy();
    }
  });
});

/**
 * The harness's own calibration for this write path — CLAUDE.md §5.
 *
 * ⚠️ **A pair, and neither means anything alone**: the same assertion passes
 * against the real store and fails against one that writes the colour under a
 * key the reader never looks at.
 */
describe('the round trip catches a kit colour written where the reader does not look', () => {
  async function assertKitColourPersists(harness: StoreHarness): Promise<void> {
    await harness.write(async (fresh) => fresh.putAthlete(athlete()));
    const answered = await harness.write(async (fresh) =>
      fresh.setAthleteKitColour(ATHLETE_A, 'magenta'),
    );
    // The write's own answer says magenta in both stores — the line a naive
    // harness would stop at.
    expect(answered?.kitColour).toBe('magenta');

    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    if (onDisk?.kitColour !== 'magenta') {
      throw new Error(`read back ${String(onDisk?.kitColour)}, not magenta`);
    }
  }

  it('passes against the real store', async () => {
    const harness = createStoreHarness();
    try {
      await expect(assertKitColourPersists(harness)).resolves.toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('fails against a store that misfiles the colour on the row', async () => {
    const harness = createStoreHarness({ factory: misfiledKitColourStoreFactory() });
    try {
      await expect(assertKitColourPersists(harness)).rejects.toThrow(/not magenta/);
    } finally {
      await harness.destroy();
    }
  });
});
