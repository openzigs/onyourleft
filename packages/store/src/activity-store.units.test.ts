// SPDX-License-Identifier: Apache-2.0

/**
 * The unit preference: that it survives a reload, and that **nothing else
 * moves when it does** (#238).
 *
 * The second half is #238's fourth acceptance criterion — *"No stored,
 * computed, exported or signed value changes: the conversion is at the
 * formatting boundary and a test asserts the store is untouched by the
 * preference"* — and it is the half that cannot be asserted by a screen test,
 * because a screen test reads the screen. So it is asserted here, through the
 * #28 round-trip harness, whose `read()` cannot be served by the handle that
 * wrote: a ride is written, the preference is flipped twice, and the ride is
 * read back on a fresh connection and compared field for field.
 *
 * The neighbouring-field cases are here for a reason that cost this store a
 * latent defect. `setAthleteThresholds` used to rebuild the athlete row from a
 * hand-written list of three fields, so it silently erased `mass` — and would
 * have erased `units`. The write it was *about* succeeded and the read for it
 * agreed, which is why nothing noticed: it is CLAUDE.md §5's "a write that
 * reports success while the read cannot see it" applied to the field nobody
 * was looking at.
 */

import { unixSeconds, watts, kilograms, beatsPerMinute, metres } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { AthleteRecord } from './records';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from './testing';
import { DEFAULT_UNIT_SYSTEM, parseUnitSystem } from './unit-system';

/**
 * ⚠️ **Three athletes, from the #28 fixtures, not two hand-written ones.**
 * CLAUDE.md §5: two cannot distinguish "scoped correctly" from "returns
 * everything the requester is connected to".
 */
async function seeded(): Promise<StoreHarness> {
  const harness = createStoreHarness();
  await seedAthletes(harness);
  return harness;
}

function athlete(id = ATHLETE_A): AthleteRecord {
  return { id, displayName: 'Rider', createdAt: unixSeconds(1_600_000_000) };
}

describe('the unit preference is stored on the athlete (#238)', () => {
  it('survives a reload, read back on a connection that never wrote it', async () => {
    const harness = await seeded();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'imperial'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.units).toBe('imperial');
    } finally {
      await harness.destroy();
    }
  });

  it('is absent on a row nobody has chosen for, rather than defaulted on disk', async () => {
    // `packages/store` reads the field faithfully — the substitution happens in
    // exactly one place, in `apps/web/src/units/`. A store that invented
    // `metric` here would make "this athlete has never chosen" unrepresentable,
    // and a later change of default would silently not reach them.
    const harness = createStoreHarness();
    try {
      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.putAthlete(athlete()),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.units).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('can be changed back, so the choice is not one-way', async () => {
    const harness = await seeded();
    try {
      await harness.write(async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'imperial'));

      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'metric'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.units).toBe('metric');
    } finally {
      await harness.destroy();
    }
  });

  it('is athlete-scoped: setting one rider does not reach another', async () => {
    // CLAUDE.md §6's cross-athlete class, applied to a setting. Two athletes,
    // because a one-athlete fixture cannot fail this way.
    const harness = await seeded();
    try {
      const other = await harness.roundTrip(
        async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'imperial'),
        async (fresh) => fresh.getAthlete(ATHLETE_B),
      );

      expect(other?.units).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });

  it('on an athlete that does not exist is not an error', async () => {
    const harness = createStoreHarness();
    try {
      const result = await harness.write(async (fresh) =>
        fresh.setAthleteUnits(ATHLETE_A, 'imperial'),
      );

      expect(result).toBeUndefined();
      expect(await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A))).toBeUndefined();
    } finally {
      await harness.destroy();
    }
  });
});

describe('nothing stored moves when the preference does (#238, criterion 4)', () => {
  it('leaves a stored ride byte-for-byte what it was, in metres and metres per second', async () => {
    const harness = await seeded();
    try {
      const ride = { ...rideFor(ATHLETE_A), distance: metres(30_000) };
      await harness.write(async (fresh) => fresh.putActivity(ride));
      const before = await harness.read(async (fresh) => fresh.getActivity(ATHLETE_A, ride.id));

      await harness.write(async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'imperial'));
      const after = await harness.read(async (fresh) => fresh.getActivity(ATHLETE_A, ride.id));

      // Named as well as compared whole: 30 000 is the metre count, and a
      // conversion that had leaked into the store would read 18.64 or 30.
      expect(after?.distance).toBe(30_000);
      expect(after).toEqual(before);
    } finally {
      await harness.destroy();
    }
  });

  it('leaves the thresholds and the recorded mass alone', async () => {
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) =>
        fresh.putAthlete({
          ...athlete(),
          thresholdPower: watts(288),
          thresholdHeartRate: beatsPerMinute(174),
          mass: kilograms(74.5),
        }),
      );

      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'imperial'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.thresholdPower).toBe(288);
      expect(onDisk?.thresholdHeartRate).toBe(174);
      // Kilograms, still. The preference says how a mass is *read*, and this
      // store has never held anything but the canonical unit.
      expect(onDisk?.mass).toBe(74.5);
      expect(onDisk?.displayName).toBe('Rider');
      expect(onDisk?.createdAt).toBe(1_600_000_000);
    } finally {
      await harness.destroy();
    }
  });

  it('setAthleteThresholds no longer erases the fields it does not name', async () => {
    // The latent defect this file's header describes. Before #238 the rebuilt
    // record named `id`, `displayName` and `createdAt` and nothing else, so a
    // threshold save dropped `mass` — and would have dropped `units`.
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) =>
        fresh.putAthlete({ ...athlete(), mass: kilograms(74.5), units: 'imperial' }),
      );

      const onDisk = await harness.roundTrip(
        async (fresh) => fresh.setAthleteThresholds(ATHLETE_A, { thresholdPower: watts(301) }),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.thresholdPower).toBe(301);
      expect(onDisk?.mass).toBe(74.5);
      expect(onDisk?.units).toBe('imperial');
    } finally {
      await harness.destroy();
    }
  });
});

describe('a stored value outside the two falls back rather than failing the row', () => {
  it('decodes to the default', () => {
    expect(parseUnitSystem('metrick')).toBe(DEFAULT_UNIT_SYSTEM);
    expect(parseUnitSystem(undefined)).toBe(DEFAULT_UNIT_SYSTEM);
    expect(parseUnitSystem(7)).toBe(DEFAULT_UNIT_SYSTEM);
  });

  it('keeps a recognised value', () => {
    expect(parseUnitSystem('imperial')).toBe('imperial');
    expect(parseUnitSystem('metric')).toBe('metric');
  });

  it('a hand-edited row still yields an athlete, rather than taking the library away', async () => {
    // The one place this field departs from every other on the row. A
    // `StoreDecodeError` here would mean a database somebody poked at loses
    // its athlete — and with it every write path, which `#requireAthlete`
    // guards.
    const harness = createStoreHarness();
    try {
      await harness.write(async (fresh) => fresh.putAthlete(athlete()));
      const onDisk = await harness.roundTrip(
        // Cast: the whole point is a value the type system says cannot be here.
        async (fresh) => fresh.setAthleteUnits(ATHLETE_A, 'furlongs' as 'metric'),
        async (fresh) => fresh.getAthlete(ATHLETE_A),
      );

      expect(onDisk?.units).toBe(DEFAULT_UNIT_SYSTEM);
      expect(onDisk?.displayName).toBe('Rider');
    } finally {
      await harness.destroy();
    }
  });
});
