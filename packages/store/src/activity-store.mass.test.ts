// SPDX-License-Identifier: Apache-2.0

/**
 * The athlete's recorded mass: that it can be written at all, that it survives
 * a reload, and that **a stored effort's frozen copy does not follow it**
 * (#325).
 *
 * ## Why this file exists at a schema version that already had the field
 *
 * `AthleteRecord.mass` has been on the row since schema 6. Two consumers read
 * it — the segment matcher freezes it onto an effort, the account export
 * carries it — and until #325 **nothing in the program wrote one**, so both
 * read a field that was always absent and neither test went red about it. A
 * store can hold a field with no writer for a long time; the tests below are
 * the first that could fail if the writer were wrong.
 *
 * ## The half that is not about this method at all
 *
 * `records.ts` §`FrozenEffortAttributes` warns that reading an athlete's mass
 * at *display* time rather than using the frozen copy *"produces a board which
 * looks right and quietly rewrites history whenever somebody edits their
 * profile"*. #325's fifth acceptance criterion is that changing a mass does not
 * do that, and the only honest way to check it is to write an effort, change
 * the mass, and read the effort back on a connection that never saw either —
 * which is what the third block does. Asserting it about
 * {@link ActivityStore.setAthleteMass}'s implementation would be asserting that
 * a method which touches one table touches one table.
 */

import { kilograms, unixSeconds, watts, beatsPerMinute } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { KILOGRAMS_PER_POUND } from '@onyourleft/domain';
import type { AthleteRecord } from './records';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  effortFor,
  rideFor,
  roundedMassStoreFactory,
  seedAthletes,
  segmentFor,
  type StoreHarness,
} from './testing';

/**
 * ⚠️ **Three athletes, from the #28 fixtures.** CLAUDE.md §5: two cannot
 * distinguish "scoped correctly" from "returns everything the requester is
 * connected to".
 */
async function seeded(): Promise<StoreHarness> {
  const harness = createStoreHarness();
  await seedAthletes(harness);
  return harness;
}

function athlete(id = ATHLETE_A): AthleteRecord {
  return { id, displayName: 'Rider', createdAt: unixSeconds(1_600_000_000) };
}

/**
 * 154 lb in kilograms, to the gram.
 *
 * Written as the product rather than as 69.853 so that the number under test is
 * the one an imperial rider's entry actually produces — a literal here would be
 * a second rounding, agreeing with the client's by luck.
 */
const ONE_HUNDRED_AND_FIFTY_FOUR_POUNDS = 154 * KILOGRAMS_PER_POUND;

describe('the athlete’s mass can be written and read back (#325)', () => {
  it('survives a reload, read back on a connection that never wrote it', async () => {
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMass(ATHLETE_A, kilograms(62.4)),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.mass).toBe(62.4);
    } finally {
      await harness.destroy();
    }
  });

  it('keeps every gram of a mass entered in pounds', async () => {
    // The store's unit is kilograms and the rider's may not be. A layer that
    // tidied this to a whole kilogram would read back as 154.3 lb beside the
    // box the rider typed 154 into — see `roundedMassStoreFactory`.
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) =>
          fresh.setAthleteMass(ATHLETE_A, kilograms(ONE_HUNDRED_AND_FIFTY_FOUR_POUNDS)),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.mass).toBe(ONE_HUNDRED_AND_FIFTY_FOUR_POUNDS);
    } finally {
      await harness.destroy();
    }
  });

  it('is absent on a row nobody has entered one for, rather than defaulted on disk', async () => {
    // `packages/store` reads and writes the field faithfully. The substitution
    // happens in exactly one place, in `apps/web/src/profile/mass.ts`; a store
    // that invented 80 kg here would make "this rider has never said"
    // unrepresentable, and a later change of default would not reach them.
    const harness = createStoreHarness();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.putAthlete(athlete()),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.mass).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('is cleared by an undefined, which is the only way back to the default', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteMass(ATHLETE_A, kilograms(62.4)));

      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMass(ATHLETE_A, undefined),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.mass).toBeUndefined();
      // The row is still there, and still the rider's. A "clear" that deleted
      // the athlete would also satisfy the line above.
      expect(onDisk?.id).toBe(ATHLETE_A);
    } finally {
      await harness.destroy();
    }
  });

  it('is athlete-scoped: setting one rider does not reach another', async () => {
    // CLAUDE.md §6's cross-athlete class, applied to a setting.
    const harness = await seeded();
    try {
      const other = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMass(ATHLETE_A, kilograms(62.4)),
        async (fresh) => fresh.getAthlete(ATHLETE_B),
      );

      expect(other?.mass).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('on an athlete that does not exist is not an error', async () => {
    const harness = createStoreHarness();
    try {
      const result = await harness.write(async (fresh) =>
        fresh.setAthleteMass(ATHLETE_A, kilograms(62.4)),
      );

      expect(result).toBeUndefined();
      expect(await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A))).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });
});

describe('nothing else on the row moves when the mass does', () => {
  it('leaves the thresholds, the units and the identity alone', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) =>
        fresh.putAthlete({
          ...athlete(),
          thresholdPower: watts(288),
          thresholdHeartRate: beatsPerMinute(174),
          units: 'imperial',
        }),
      );

      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMass(ATHLETE_A, kilograms(62.4)),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.mass).toBe(62.4);
      expect(onDisk?.thresholdPower).toBe(288);
      expect(onDisk?.thresholdHeartRate).toBe(174);
      expect(onDisk?.units).toBe('imperial');
      expect(onDisk?.displayName).toBe('Rider');
      expect(onDisk?.createdAt).toBe(1_600_000_000);
    } finally {
      await harness.destroy();
    }
  });

  it('clearing it leaves them alone too', async () => {
    // The `delete`-on-a-copy path, which is a different branch from the
    // spread-an-override one above and would be the easy one to get wrong: a
    // clear written as "rebuild the row from the fields I know about" passes
    // every assertion about the mass and drops the threshold.
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) =>
        fresh.putAthlete({
          ...athlete(),
          mass: kilograms(62.4),
          thresholdPower: watts(288),
          units: 'imperial',
        }),
      );

      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMass(ATHLETE_A, undefined),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.mass).toBeUndefined();
      expect(onDisk?.thresholdPower).toBe(288);
      expect(onDisk?.units).toBe('imperial');
    } finally {
      await harness.destroy();
    }
  });
});

describe('a stored effort’s frozen mass does not follow the athlete’s (#325, criterion 5)', () => {
  it('reads back what it was matched at, after the rider changes their weight', async () => {
    const harness = await seeded();
    try {
      const ride = rideFor(ATHLETE_A);
      const segment = segmentFor(ATHLETE_A);
      await harness.write(async (fresh) => {
        await fresh.setAthleteMass(ATHLETE_A, kilograms(62.4));
        await fresh.putActivity(ride);
        await fresh.putSegment(segment);
        await fresh.putActivityEfforts(ATHLETE_A, ride.id, [
          effortFor(ATHLETE_A, segment.id, ride.id, { riderMassKilograms: 62.4 }),
        ]);
      });

      const efforts = await harness.roundTrip(
        async (fresh) => fresh.setAthleteMass(ATHLETE_A, kilograms(84)),
        async (fresh) => fresh.listEfforts(ATHLETE_A, segment.id),
      );

      // The point of the whole criterion: the board still says what the rider
      // weighed when they rode it.
      expect(efforts[0]?.attributes.riderMass).toBe(62.4);
      // And the athlete row really did change, so the assertion above is not
      // passing because nothing happened.
      expect(await harness.read(async (fresh) => (await fresh.getAthlete(ATHLETE_A))?.mass)).toBe(
        84,
      );
    } finally {
      await harness.destroy();
    }
  });
});

/**
 * The harness's own calibration for this write path — CLAUDE.md §5's rule that
 * a new write path in `packages/store` ships with a fake proving the harness
 * catches its failure.
 *
 * ⚠️ **The two cases are a pair and neither means anything alone.** The first
 * says the assertion passes against the real store; the second says the *same
 * assertion* fails against a store that writes a tidied-up mass. Without the
 * second, an assertion reading back a value it had just been handed would look
 * exactly as green.
 */
describe('the round trip catches a mass that is written tidied', () => {
  /** The assertion under test, written once so both stores get the same one. */
  async function assertMassPersistsExactly(harness: StoreHarness): Promise<void> {
    await harness.write(async (fresh) => fresh.putAthlete(athlete()));
    const answered = await harness.write(async (fresh) =>
      fresh.setAthleteMass(ATHLETE_A, kilograms(ONE_HUNDRED_AND_FIFTY_FOUR_POUNDS)),
    );
    // Both stores answer with *a* mass. This line is what a naive harness would
    // stop at, and it is why it is not the whole assertion.
    expect(answered?.mass).toBeDefined();

    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    if (onDisk?.mass !== ONE_HUNDRED_AND_FIFTY_FOUR_POUNDS) {
      throw new Error(`read back ${String(onDisk?.mass)} kg, not what the rider entered`);
    }
  }

  it('passes against the real store', async () => {
    const harness = createStoreHarness();
    try {
      await expect(assertMassPersistsExactly(harness)).resolves.toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('fails against a store that rounds it on the way in', async () => {
    const harness = createStoreHarness({ factory: roundedMassStoreFactory() });
    try {
      await expect(assertMassPersistsExactly(harness)).rejects.toThrow(
        /not what the rider entered/,
      );
    } finally {
      await harness.destroy();
    }
  });
});
