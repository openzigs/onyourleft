// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A ride's calorie estimate, worked out once when the ride is saved (#2433):
 * written by `finish.ts`, read back through the store on a fresh connection,
 * and shown on the ride result card and the ride's page — the same figure on
 * both, labelled an estimate, and a dash with a reason where there is none.
 */

import {
  beatsPerMinute,
  kilograms,
  rideCalories,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import {
  activityId,
  openActivityStore,
  type ActivityRecord,
  type StreamChannelValue,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { calorieRiderFor } from '../athlete/calorie-inputs';
import {
  CALORIES_BASIS_TEXT,
  NO_CALORIES_NO_READINGS,
  NO_CALORIES_SAVED_BEFORE,
  NO_CALORIES_SET_INPUTS,
  NO_CALORIES_SET_INPUTS_SHORT,
} from '../detail/CaloriesFact';
import type { SavedRide } from '../ride/ride-result';
import { RideResultCard } from '../ride/RideResultCard';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView, READING_RIDE_TEXT } from '../views/ActivityDetailView';

import { rideToSave, saveFinishedRide } from './finish';
import { recordedRideCalories, rideEnergy } from './totals';

const RIDE = activityId('ride-calories');
/** 2026-06-01T08:00:00Z, so a rider born in 1985 is 41 at the ride. */
const STARTED = unixSeconds(Date.UTC(2026, 5, 1, 8) / 1000);
const SAMPLES = 1800;

let harness: StoreHarness;
let mounted: Mounted | undefined;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness.destroy();
});

/** Half an hour at 1 Hz, with the channels asked for. */
function series(channels: {
  readonly power?: number;
  readonly heartRate?: number;
}): RecordedSeries<StreamChannelValue> {
  return {
    startedAt: STARTED,
    sampleInterval: seconds(1),
    sampleCount: SAMPLES,
    channels: {
      ...(channels.power === undefined
        ? {}
        : { power: Array.from({ length: SAMPLES }, () => watts(channels.power!)) }),
      ...(channels.heartRate === undefined
        ? {}
        : {
            heartRate: Array.from({ length: SAMPLES }, () => beatsPerMinute(channels.heartRate!)),
          }),
    },
    pauses: [],
  };
}

/** Save a ride through `finish.ts` as the controller does, with the rider read off the row. */
async function save(recorded: RecordedSeries<StreamChannelValue>) {
  const athlete = await harness.read(async (store) => store.getAthlete(ATHLETE_A));
  const finished = rideToSave({
    id: RIDE,
    athleteId: ATHLETE_A,
    series: recorded,
    elapsedTime: seconds(SAMPLES),
    movingTime: seconds(SAMPLES),
    timeZone: 'Europe/London',
    now: unixSeconds(STARTED + SAMPLES),
    rider: calorieRiderFor(athlete, recorded.startedAt),
  });
  const outcome = await harness.write(async (store) => saveFinishedRide(store, finished));
  expect(outcome).toStrictEqual({ status: 'saved', id: RIDE });
  return finished!;
}

/** The ride, read the way the ride's page reads it, on a connection that never wrote. */
async function readBack(): Promise<ActivityRecord | undefined> {
  return harness.read(async (store) => store.getActivity(ATHLETE_A, RIDE));
}

async function setInputs(sex: 'female' | 'male' | undefined): Promise<void> {
  await harness.write(async (store) => {
    await store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: sex, birthYear: 1985 });
    await store.setAthleteMass(ATHLETE_A, kilograms(68));
  });
}

/** The ride's page over the real store, read to the end of its first read. */
async function openRidePage(): Promise<string> {
  await harness.discard();
  const store = openActivityStore(harness.databaseName);
  await import('../detail/TraceChart');
  mounted = await mount(
    <ActivityDetailView port={{ athleteId: ATHLETE_A, store }} activityId={RIDE} />,
  );
  for (let tries = 0; tries < 50; tries += 1) {
    await settle();
    if (!(document.body.textContent ?? '').includes(READING_RIDE_TEXT)) break;
  }
  const text = caloriesText();
  mounted.unmount();
  mounted = undefined;
  store.close();
  return text;
}

/** The result card for what the save wrote, as the controller publishes it. */
async function openCard(result: SavedRide): Promise<string> {
  mounted = await mount(
    <RideResultCard
      result={result}
      announce={false}
      onAnnounced={() => undefined}
      onDone={() => undefined}
    />,
  );
  const text = caloriesText();
  mounted.unmount();
  mounted = undefined;
  return text;
}

function caloriesText(): string {
  const facts = queryAll<HTMLElement>(document, '[data-oyl-calories]');
  expect(facts).toHaveLength(1);
  return (facts[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function cardFor(
  finished: {
    activity: { calories?: SavedRide['calories']; averagePower?: SavedRide['averagePower'] };
  },
  heartRate: number | undefined,
): SavedRide {
  return {
    activityId: RIDE,
    movingTime: seconds(SAMPLES),
    elapsedTime: seconds(SAMPLES),
    distance: 0 as SavedRide['distance'],
    averagePower: finished.activity.averagePower,
    averageHeartRate: heartRate === undefined ? undefined : beatsPerMinute(heartRate),
    calories: finished.activity.calories,
    gameOutcome: undefined,
  };
}

describe('a ride’s calorie estimate is saved with it (#2433)', () => {
  it('a ride with power is saved with rideCalories over its series, on the power basis', async () => {
    const recorded = series({ power: 200, heartRate: 150 });
    await save(recorded);
    const read = await readBack();
    const expected = rideCalories({
      work: rideEnergy(recorded),
      heartRate: recorded.channels.heartRate,
      sampleInterval: recorded.sampleInterval,
      rider: {},
    });
    expect(expected?.basis).toBe('power');
    expect(read?.calories).toStrictEqual(expected);
    expect(read?.calories).toStrictEqual(recordedRideCalories(recorded, {}));
  });

  it('a ride with heart rate and no power, for a rider who set all three, is on the heart-rate basis', async () => {
    await setInputs('female');
    const recorded = series({ heartRate: 145 });
    await save(recorded);
    const read = await readBack();
    const expected = rideCalories({
      work: undefined,
      heartRate: recorded.channels.heartRate,
      sampleInterval: recorded.sampleInterval,
      rider: { sex: 'female', ageYears: 41, mass: kilograms(68) },
    });
    expect(read?.calories).toStrictEqual(expected);
    expect(read?.calories?.basis).toBe('heart-rate');
  });

  it('a heart-rate ride for a rider with no sex set is saved with no figure, and the page says why', async () => {
    await setInputs(undefined);
    await save(series({ heartRate: 145 }));
    const read = await readBack();
    expect(read).toBeDefined();
    expect(read).not.toHaveProperty('calories');
    const page = await openRidePage();
    expect(page).toContain('—');
    expect(page).toContain(NO_CALORIES_SET_INPUTS);
    expect(page).not.toContain('0 kcal');
  });

  it('is frozen at the ride: a later change of weight does not move the page’s figure', async () => {
    await setInputs('male');
    await save(series({ heartRate: 150 }));
    const before = await readBack();
    expect(before?.calories?.basis).toBe('heart-rate');
    const shown = `≈ ${String(Math.round(before!.calories!.energy))} kcal`;

    await harness.write(async (store) => store.setAthleteMass(ATHLETE_A, kilograms(95)));
    const page = await openRidePage();
    expect(page).toContain(shown);
  });

  it('the card and the page show the same figure, each labelled an estimate and naming its basis', async () => {
    const finished = await save(series({ power: 200 }));
    const card = await openCard(cardFor(finished, undefined));
    const page = await openRidePage();
    const shown = `≈ ${String(Math.round(finished.activity.calories!.energy))} kcal`;
    expect(card).toContain(shown);
    expect(page).toContain(shown);
    for (const text of [card, page]) {
      expect(text).toContain('estimate');
      expect(text).toContain(CALORIES_BASIS_TEXT.power);
    }
    // The same words on both, less the label each screen sets its own way.
    expect(card.replace(/^Calories:?\s*/, '')).toBe(page.replace(/^Calories:?\s*/, ''));
  });
});

describe('a ride with no figure is a dash and a reason, never 0 kcal', () => {
  it('a ride saved before #2433 renders a dash on both screens, with no error', async () => {
    // A ride with power and no `calories` key, as every ride saved before
    // this change is.
    const finished = await save(series({ power: 180 }));
    const before = { ...finished.activity };
    delete (before as { calories?: unknown }).calories;
    await harness.write(async (store) => store.putActivity(before));
    expect(await readBack()).not.toHaveProperty('calories');

    const card = await openCard(cardFor({ activity: before }, undefined));
    const page = await openRidePage();
    for (const text of [card, page]) {
      expect(text).toContain('—');
      expect(text).toContain(NO_CALORIES_SAVED_BEFORE);
      expect(text).not.toContain('kcal');
    }
  });

  it('a heart-rate ride with no figure points the card at Settings, and the page says what to set', async () => {
    await setInputs(undefined);
    const finished = await save(series({ heartRate: 145 }));
    const card = await openCard(cardFor(finished, 145));
    const page = await openRidePage();
    expect(card).toContain(NO_CALORIES_SET_INPUTS_SHORT);
    expect(page).toContain(NO_CALORIES_SET_INPUTS);
    // The card's label is for assistive technology; its words say the rest.
    expect(card.startsWith('Calories:')).toBe(true);
  });

  it('a ride with neither channel says so on the card', async () => {
    const card = await openCard(cardFor({ activity: {} }, undefined));
    expect(card).toContain(NO_CALORIES_NO_READINGS);
    expect(card).not.toContain('kcal');
  });

  it('a ride whose power read zero throughout is 0 kcal on the power basis — a figure, not a dash', async () => {
    const finished = await save(series({ power: 0 }));
    expect(finished.activity.calories).toStrictEqual({ energy: 0, basis: 'power' });
    const card = await openCard(cardFor(finished, undefined));
    expect(card).toContain('≈ 0 kcal');
    expect(card).toContain(CALORIES_BASIS_TEXT.power);
  });
});
