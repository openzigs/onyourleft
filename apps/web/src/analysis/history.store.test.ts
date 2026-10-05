// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1070's stale 0 W row, against the **real** local store.
 *
 * `history.test.ts` covers the same case over `analysis/testing.ts`'s stub,
 * whose `setActivityLoadSummary` merges the way the store's is written to. This
 * file is the claim that it actually does: a ride stored before #1070 with
 * `effortWeightedPower: 0` and then backfilled from its heart-rate strap comes
 * back from a FRESH IndexedDB connection holding both fields — the stale 0 and
 * the heart-rate figure — and the chart's own read (`loadFitnessHistory`, the
 * path the Analysis screen and Home use) scores it from heart rate.
 *
 * `@onyourleft/store/testing`'s `read` discards every open handle before it
 * opens another, so nothing here is served by the connection that wrote
 * (CLAUDE.md §5, "The round-trip harness").
 */

import { beatsPerMinute, seconds, watts } from '@onyourleft/domain';
import type { NewStreamSet } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { backfillLoadSummaries, loadFitnessHistory } from './history';
import { hasNoLoadToWorkOut } from './summary';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

const SAMPLES = 600;

describe('#1070 — a stale 0 W beside a heart-rate summary, through the real store', () => {
  it('keeps both fields on the row, and the chart scores the ride from heart rate', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);

    // A ride summarised before #1070 from a power channel that read 0 W.
    const ride = rideFor(ATHLETE_A, {
      effortWeightedPower: watts(0),
      loadCoveredTime: seconds(SAMPLES),
    });
    const streams: NewStreamSet = {
      activityId: ride.id,
      athleteId: ride.athleteId,
      startedAt: ride.startedAt,
      sampleInterval: seconds(1),
      sampleCount: SAMPLES,
      channels: {
        power: Array.from({ length: SAMPLES }, () => watts(0)),
        heartRate: Array.from({ length: SAMPLES }, () => beatsPerMinute(150)),
      },
    };
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streams);
    });

    // The backfill runs over its own connection, as the Analysis control does.
    const outcome = await open.write((store) =>
      backfillLoadSummaries({ athleteId: ATHLETE_A, store }),
    );
    expect(outcome.computed).toBe(1);

    // A fresh connection: the row holds the stale 0 AND the heart-rate figure.
    const row = await open.read(async (store) => {
      const summaries = await store.listActivitySummaries(ATHLETE_A, {
        orderBy: 'startedAt',
        direction: 'ascending',
        limit: 10,
      });
      return summaries.find((summary) => summary.id === ride.id);
    });
    expect(row?.effortWeightedPower).toBe(0);
    expect(row?.effortWeightedHeartRate).toBeDefined();
    expect(row?.loadCoveredTime).toBe(SAMPLES);

    // And the chart's own read, over another fresh connection, scores it from
    // heart rate rather than as a rest day or a ride with no load.
    const history = await open.read((store) => loadFitnessHistory({ athleteId: ATHLETE_A, store }));
    expect(history.ridesCounted).toBe(1);
    expect(history.ridesWithoutSummary).toBe(0);
    expect(history.bases).toEqual(['heartRate']);
  });
});

describe('#1084 — a ride with nothing to work out is marked once, through the real store', () => {
  it('reads back marked from a fresh connection, and no later pass counts it', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);

    // Stored before #1084: a 0 W power channel, no strap, and no summary.
    const ride = rideFor(ATHLETE_A, {});
    const streams: NewStreamSet = {
      activityId: ride.id,
      athleteId: ride.athleteId,
      startedAt: ride.startedAt,
      sampleInterval: seconds(1),
      sampleCount: SAMPLES,
      channels: { power: Array.from({ length: SAMPLES }, () => watts(0)) },
    };
    await open.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streams);
    });

    const first = await open.write((store) =>
      backfillLoadSummaries({ athleteId: ATHLETE_A, store }),
    );
    expect(first).toEqual({ computed: 0, nothingToWorkOut: 1, noStreamsYet: 0, remaining: 0 });

    const row = await open.read(async (store) =>
      (await store.listActivitySummaries(ATHLETE_A)).find((summary) => summary.id === ride.id),
    );
    expect(row?.loadCoveredTime).toBe(0);
    expect(row === undefined ? undefined : hasNoLoadToWorkOut(row)).toBe(true);

    const second = await open.write((store) =>
      backfillLoadSummaries({ athleteId: ATHLETE_A, store }),
    );
    expect(second).toEqual({ computed: 0, nothingToWorkOut: 0, noStreamsYet: 0, remaining: 0 });

    const history = await open.read((store) => loadFitnessHistory({ athleteId: ATHLETE_A, store }));
    expect(history.ridesWithoutSummary).toBe(0);
    expect(history.ridesWithNoLoad).toBe(1);
  });
});
