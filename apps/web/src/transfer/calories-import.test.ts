// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An imported ride gets its calorie estimate on import (#2433), by the rule a
 * recorded ride's is worked out by (`recording/totals.ts`
 * §`recordedRideCalories`), from the decoded channels and the importing
 * athlete's current inputs — and the figure is on the list row, read through
 * `listActivitySummaries` without decoding a stream.
 */

import { kilograms, unixSeconds } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { calorieRiderFor } from '../athlete/calorie-inputs';
import { recordedRideCalories } from '../recording/totals';
import { webCryptoDigest } from './browser';
import { corpusSource } from './corpus';
import { importActivityFiles } from './import-batch';

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

async function importOne(name: string, withAthlete: boolean) {
  const athlete = withAthlete
    ? await harness.read(async (store) => store.getAthlete(ATHLETE_A))
    : undefined;
  const report = await harness.write(async (store) =>
    importActivityFiles({
      sources: [corpusSource(name)],
      store,
      athleteId: ATHLETE_A,
      athlete,
      newActivityId: () => activityId(`imported-${name}`),
      now: () => unixSeconds(1_800_000_000),
      digest: webCryptoDigest,
      timeZone: 'Europe/London',
    }),
  );
  expect(report.imported, JSON.stringify(report.outcomes)).toBe(1);
  const [summary] = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A));
  const streams = await harness.read(async (store) =>
    store.getStreamSet(ATHLETE_A, activityId(`imported-${name}`)),
  );
  return { summary, streams, athlete };
}

describe('an imported ride gets its calorie estimate on import (#2433)', () => {
  it.each(['nominal-outdoor-ride.fit', 'nominal-ride.tcx'])(
    '%s, which has power, is on the power basis, on the list row',
    async (name) => {
      const { summary, streams } = await importOne(name, false);
      expect(streams).toBeDefined();
      expect(summary?.calories?.basis).toBe('power');
      expect(summary?.calories).toStrictEqual(recordedRideCalories(streams!, {}));
      expect(summary!.calories!.energy).toBeGreaterThan(0);
    },
  );

  it('a GPX with heart rate and no power uses the importing athlete’s current inputs', async () => {
    await harness.write(async (store) => {
      await store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'male', birthYear: 1980 });
      await store.setAthleteMass(ATHLETE_A, kilograms(75));
    });
    const { summary, streams, athlete } = await importOne('nominal-ride.gpx', true);
    expect(streams?.channels.power?.some((sample) => sample !== undefined) ?? false).toBe(false);
    const expected = recordedRideCalories(streams!, calorieRiderFor(athlete, streams!.startedAt));
    expect(expected?.basis).toBe('heart-rate');
    expect(summary?.calories).toStrictEqual(expected);
  });

  it('the same GPX, imported with no athlete inputs, has no figure', async () => {
    const { summary } = await importOne('nominal-ride.gpx', false);
    expect(summary).toBeDefined();
    expect(summary).not.toHaveProperty('calories');
  });
});
