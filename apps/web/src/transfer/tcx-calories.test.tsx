// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A ride's calories through a TCX file — #2435.
 *
 * **Out**: a stored ride's figure is shared among its laps' `Calories`
 * (`export-activity.ts` §`lapCaloriesOf`), written through `exportActivity`
 * and read back by `decodeTcx`, and the laps add up to the stored figure.
 * **In**: a TCX whose laps carry `Calories` is stored with their sum on the
 * `file` basis, read back through the store on a fresh connection, and the
 * ride's page says the figure is from the file.
 *
 * Every ride is written to the real store and read back through the
 * round-trip harness, so what is asserted is what came off disk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  joules,
  kilograms,
  rideCalories,
  seconds,
  unixSeconds,
  type Kilocalories,
} from '@onyourleft/domain';
import { decodeTcx, type TrackLap } from '@onyourleft/fit';
import {
  activityId,
  openActivityStore,
  type ActivityCalories,
  type NewActivity,
  type StreamChannel,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  lapFor,
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
  type StreamGap,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CALORIES_BASIS_TEXT } from '../detail/CaloriesFact';
import { recordedRideCalories } from '../recording/totals';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView, READING_RIDE_TEXT } from '../views/ActivityDetailView';

import { webCryptoDigest } from './browser';
import { exportActivity } from './export-activity';
import { importActivityFiles } from './import-batch';

const SAMPLE_COUNT = 1_200;

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

/**
 * A twenty-minute ride with the channels asked for and the figure given:
 * 200 s before the first line, two whole laps of 300 s, a part lap of 250 s,
 * and 150 s after it — five splits in a TCX file. With `laps: false`, no
 * stored lap.
 */
async function seedRide(options: {
  readonly channels: readonly StreamChannel[];
  readonly calories: (streams: ReturnType<typeof streamSetFor>) => ActivityCalories | undefined;
  readonly laps?: boolean;
  readonly gaps?: readonly StreamGap[];
}): Promise<{ ride: NewActivity; stored: ActivityCalories | undefined }> {
  const plain = rideFor(ATHLETE_A, {
    elapsedTime: seconds(SAMPLE_COUNT),
    movingTime: seconds(SAMPLE_COUNT),
  });
  const streams = streamSetFor(plain, {
    sampleCount: SAMPLE_COUNT,
    channels: options.channels,
    gaps: options.gaps ?? [],
  });
  const calories = options.calories(streams);
  const ride: NewActivity = calories === undefined ? plain : { ...plain, calories };
  await harness.write(async (store) => {
    await store.putActivity(ride);
    await store.putStreamSet(streams);
    if (options.laps === false) return;
    for (const [ordinal, from, length] of [
      [0, 200, 300],
      [1, 500, 300],
      [2, 800, 250],
    ] as const) {
      await store.putLap(
        lapFor(ride, ordinal, {
          startedAt: unixSeconds(ride.startedAt + from),
          elapsedTime: seconds(length),
          movingTime: seconds(length),
          ...(ordinal === 2 ? { partial: true as const } : {}),
        }),
      );
    }
  });
  // Read back on a connection that never wrote, as the exporter will read it.
  const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, ride.id));
  return { ride, stored: read?.calories };
}

/** The ride exported as TCX through the real path, and decoded by the codec. */
async function exportedLaps(
  ride: NewActivity,
): Promise<{ laps: readonly TrackLap[]; text: string }> {
  const { file } = await harness.read(async (store) =>
    exportActivity({ store, athleteId: ATHLETE_A, activityId: ride.id, format: 'tcx' }),
  );
  const text = new TextDecoder('utf-8').decode(file.bytes);
  const { activity, faults } = decodeTcx(text);
  expect(faults).toEqual([]);
  return { laps: activity.laps, text };
}

function caloriesOf(laps: readonly TrackLap[]): readonly (Kilocalories | undefined)[] {
  return laps.map((lap) => lap.calories);
}

function sumOf(values: readonly (number | undefined)[]): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

describe('a ride’s calories, exported as TCX lap Calories (#2435)', () => {
  it('a power-basis figure is shared by each lap’s work, and the laps add up to it', async () => {
    const { ride, stored } = await seedRide({
      channels: ['power', 'heartRate', 'cadence'],
      // A meter that drops out for two thirds of the first whole lap: its work,
      // and so its share, falls where its heartbeats and its time do not.
      gaps: [{ channel: 'power', from: 500, count: 200 }],
      calories: (streams) => recordedRideCalories(streams, {}),
    });
    expect(stored?.basis).toBe('power');

    const { laps } = await exportedLaps(ride);

    expect(laps).toHaveLength(5);
    const written = caloriesOf(laps);
    expect(written.every((value) => value !== undefined && Number.isInteger(value))).toBe(true);
    // Within one kcal a lap, as #2435 asks; the running-total rounding gives
    // the stored figure rounded, which is tighter.
    expect(Math.abs(sumOf(written) - stored!.energy)).toBeLessThanOrEqual(laps.length);
    expect(sumOf(written)).toBe(Math.round(stored!.energy));
    // Each lap's is `rideCalories` over its own slice of the samples.
    laps.forEach((lap) => {
      const work = sumOf(lap.points.map((point) => point.power));
      const own = rideCalories({
        work: joules(work),
        heartRate: undefined,
        sampleInterval: 1,
        rider: {},
      });
      expect(Math.abs((lap.calories ?? -1) - own!.energy)).toBeLessThanOrEqual(1);
    });
    // And the lap whose meter dropped out says less than the one before it.
    expect(laps[2]!.calories!).toBeLessThan(laps[1]!.calories! / 2);
  });

  it('a heart-rate-basis figure, frozen at the ride, is shared by heartbeats and adds up', async () => {
    const rider = { sex: 'male' as const, ageYears: 40, mass: kilograms(75) };
    const { ride, stored } = await seedRide({
      channels: ['heartRate', 'cadence'],
      // A strap that drops out for two thirds of the first whole lap: its
      // heartbeats, and so its share, fall where its time does not.
      gaps: [{ channel: 'heartRate', from: 500, count: 200 }],
      calories: (streams) => recordedRideCalories(streams, rider),
    });
    expect(stored?.basis).toBe('heart-rate');

    const { laps } = await exportedLaps(ride);

    expect(sumOf(caloriesOf(laps))).toBe(Math.round(stored!.energy));
    const beats = laps.map((lap) => sumOf(lap.points.map((point) => point.heartRate)));
    const total = sumOf(beats);
    laps.forEach((lap, index) => {
      expect(
        Math.abs(lap.calories! - (stored!.energy * beats[index]!) / total),
      ).toBeLessThanOrEqual(1);
    });
  });

  it('a figure over a ride with neither channel is shared by elapsed time', async () => {
    const { ride, stored } = await seedRide({
      channels: ['cadence'],
      calories: () => ({ energy: 600 as Kilocalories, basis: 'file' }),
    });
    expect(stored).toStrictEqual({ energy: 600, basis: 'file' });

    const { laps } = await exportedLaps(ride);

    // The ride's 1200 s, split 200, 300, 300, 250 and 150: half a kcal a second.
    expect(caloriesOf(laps)).toEqual([100, 150, 150, 125, 75]);
  });

  it('a ride with no stored laps writes the whole figure on its one lap', async () => {
    const { ride, stored } = await seedRide({
      channels: ['power'],
      calories: (streams) => recordedRideCalories(streams, {}),
      laps: false,
    });

    const { laps } = await exportedLaps(ride);

    expect(caloriesOf(laps)).toEqual([Math.round(stored!.energy)]);
  });

  it('a ride with no figure writes no Calories, as before', async () => {
    const { ride, stored } = await seedRide({
      channels: ['heartRate'],
      calories: () => undefined,
    });
    expect(stored).toBeUndefined();

    const { laps, text } = await exportedLaps(ride);

    expect(text).not.toContain('Calories');
    expect(caloriesOf(laps).every((value) => value === undefined)).toBe(true);
  });
});

/** The ride's page over the real store, read to the end of its first read. */
async function ridePageCaloriesText(id: ReturnType<typeof activityId>): Promise<string> {
  await harness.discard();
  const store = openActivityStore(harness.databaseName);
  await import('../detail/TraceChart');
  mounted = await mount(
    <ActivityDetailView port={{ athleteId: ATHLETE_A, store }} activityId={id} />,
  );
  for (let tries = 0; tries < 50; tries += 1) {
    await settle();
    if (!(document.body.textContent ?? '').includes(READING_RIDE_TEXT)) break;
  }
  const facts = queryAll<HTMLElement>(document, '[data-oyl-calories]');
  expect(facts).toHaveLength(1);
  const text = (facts[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
  mounted.unmount();
  mounted = undefined;
  store.close();
  return text;
}

/**
 * A corpus file, read by path: `corpus.ts`'s `import.meta.url` is not a
 * `file:` URL under jsdom, as `TransferView.test.tsx` found.
 */
function corpusBytes(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(import.meta.dirname, '../../../../packages/fit/fixtures/corpus', name)),
  );
}

async function importOne(name: string) {
  const id = activityId(`imported-${name}`);
  const bytes = corpusBytes(name);
  const report = await harness.write(async (store) =>
    importActivityFiles({
      sources: [{ fileName: name, bytes: async () => Promise.resolve(bytes) }],
      store,
      athleteId: ATHLETE_A,
      athlete: undefined,
      newActivityId: () => id,
      now: () => unixSeconds(1_800_000_000),
      digest: webCryptoDigest,
      timeZone: 'Europe/London',
    }),
  );
  expect(report.imported, JSON.stringify(report.outcomes)).toBe(1);
  return id;
}

describe('a TCX whose laps carry Calories, imported (#2435)', () => {
  it('is stored with the laps’ sum on the file basis, and the ride page says so', async () => {
    const id = await importOne('lap-figures.tcx');

    // The list row, read on a connection that never wrote, without a stream.
    const [summary] = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(summary?.calories).toStrictEqual({ energy: 12 + 7, basis: 'file' });
    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, id));
    expect(read?.calories).toStrictEqual({ energy: 19, basis: 'file' });

    const text = await ridePageCaloriesText(id);
    expect(text).toContain('≈ 19');
    expect(text).toContain(CALORIES_BASIS_TEXT.file);
    expect(text).toContain('from the file');
  });

  it('a TCX whose laps’ Calories were refused falls back to the estimate from its channels', async () => {
    await importOne('lap-calories-malformed.tcx');

    const [summary] = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    // Heart rate and no power, and no athlete inputs: no figure — not the
    // file's, which it did not state in a form the schema admits.
    expect(summary).toBeDefined();
    expect(summary).not.toHaveProperty('calories');
  });

  it('a TCX with no Calories keeps #2433’s estimate from power', async () => {
    const id = await importOne('nominal-ride.tcx');

    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, id));
    const streams = await harness.read(async (store) => store.getStreamSet(ATHLETE_A, id));
    expect(read?.calories?.basis).toBe('power');
    expect(read?.calories).toStrictEqual(recordedRideCalories(streams!, {}));
  });

  it('this client’s own TCX comes back with the figure it wrote, from the file', async () => {
    const { ride, stored } = await seedRide({
      channels: ['power'],
      calories: (streams) => recordedRideCalories(streams, {}),
    });
    const { text } = await exportedLaps(ride);
    const id = activityId('re-imported');
    const report = await harness.write(async (store) =>
      importActivityFiles({
        sources: [
          {
            fileName: 'ride.tcx',
            bytes: async () => Promise.resolve(new TextEncoder().encode(text)),
          },
        ],
        store,
        athleteId: ATHLETE_A,
        athlete: undefined,
        newActivityId: () => id,
        now: () => unixSeconds(1_800_000_000),
        digest: webCryptoDigest,
        timeZone: 'Europe/London',
      }),
    );
    expect(report.imported, JSON.stringify(report.outcomes)).toBe(1);

    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, id));
    expect(read?.calories).toStrictEqual({ energy: Math.round(stored!.energy), basis: 'file' });
  });
});
