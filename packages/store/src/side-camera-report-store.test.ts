// SPDX-License-Identifier: Apache-2.0

/**
 * **The side camera's post-ride report, written, read back through a
 * connection nothing wrote on, replaced, and erased with its ride and its
 * athlete** — #388.
 *
 * ⚠️ **The pair at the bottom is the point of this file.**
 * `testing/fakes.ts` §`lastSentenceDroppedReportStoreFactory` is a store that
 * drops the last observation on the way in: every put succeeds, the report
 * comes back for the right ride with the right summary and a well-formed list,
 * and a test that only asked whether a report came back cannot tell it from
 * the real one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import {
  fromPersistedSideCameraReport,
  MAXIMUM_SIDE_REPORT_OBSERVATIONS,
  MAXIMUM_SIDE_REPORT_SENTENCE,
  toPersistedSideCameraReport,
} from './persisted';
import {
  assertSideCameraReportRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  lastSentenceDroppedReportStoreFactory,
  resetFixtureIds,
  RoundTripFailure,
  seedAthletes,
  seedRide,
  sideCameraReportFor,
} from './testing';
import type { StoreHarness } from './testing';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

describe('keeping a side-camera report', () => {
  it('survives a round trip, every sentence in order', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const report = sideCameraReportFor(ATHLETE_A, ride.id);
    const read = await assertSideCameraReportRoundTrip(harness, report);
    expect(read.observations).toStrictEqual(report.observations);
  });

  it('keeps an empty list of observations as empty — "nothing changed" is a report too', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const report = { ...sideCameraReportFor(ATHLETE_A, ride.id), observations: [] };
    const read = await assertSideCameraReportRoundTrip(harness, report);
    expect(read.observations).toStrictEqual([]);
  });

  it('is not there for a ride that was not filmed', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      harness.read(async (store) => store.getSideCameraReport(ATHLETE_A, ride.id)),
    ).resolves.toBeUndefined();
  });

  it('replaces the report a ride already had — the newest session wins', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putSideCameraReport(sideCameraReportFor(ATHLETE_A, ride.id, 1)),
    );
    const second = sideCameraReportFor(ATHLETE_A, ride.id, 2);
    const read = await assertSideCameraReportRoundTrip(harness, second);
    expect(read.summary).toBe(second.summary);
  });

  it('goes with its ride when the ride is deleted', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const other = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.putSideCameraReport(sideCameraReportFor(ATHLETE_A, ride.id));
      await store.putSideCameraReport(sideCameraReportFor(ATHLETE_A, other.id));
    });
    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    await expect(
      harness.read(async (store) => store.getSideCameraReport(ATHLETE_A, ride.id)),
    ).resolves.toBeUndefined();
    // And only its own ride's.
    await expect(
      harness.read(async (store) => store.getSideCameraReport(ATHLETE_A, other.id)),
    ).resolves.toBeDefined();
  });

  it('goes with the athlete when the device is erased, and is counted', async () => {
    const mine = await seedRide(harness, ATHLETE_A);
    const theirs = await seedRide(harness, ATHLETE_B);
    await harness.write(async (store) => {
      await store.putSideCameraReport(sideCameraReportFor(ATHLETE_A, mine.id));
      await store.putSideCameraReport(sideCameraReportFor(ATHLETE_B, theirs.id));
    });
    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.sideCameraReports).toBe(1);
    await expect(
      harness.read(async (store) => store.getSideCameraReport(ATHLETE_A, mine.id)),
    ).resolves.toBeUndefined();
    await expect(
      harness.read(async (store) => store.getSideCameraReport(ATHLETE_B, theirs.id)),
    ).resolves.toBeDefined();
  });

  it('refuses a report on a ride that does not exist', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    await expect(
      harness.write(async (store) =>
        store.putSideCameraReport(sideCameraReportFor(ATHLETE_A, ride.id)),
      ),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('refuses a report filed under one athlete against another athlete’s ride', async () => {
    // Otherwise the report would be read on the second athlete's detail page,
    // or be a row about the first that no scoped read can reach.
    const theirs = await seedRide(harness, ATHLETE_B);
    await expect(
      harness.write(async (store) =>
        store.putSideCameraReport(sideCameraReportFor(ATHLETE_A, theirs.id)),
      ),
    ).rejects.toThrow(StoreReferentialError);
    await expect(
      harness.read(async (store) => store.getSideCameraReport(ATHLETE_B, theirs.id)),
    ).resolves.toBeUndefined();
  });
});

describe('what a report has to be', () => {
  const base = sideCameraReportFor(ATHLETE_A, 'activity-x' as never);
  const long = 'x'.repeat(MAXIMUM_SIDE_REPORT_SENTENCE + 1);

  it.each([
    ['no summary', { ...base, summary: ' ' }],
    ['a summary that is a page', { ...base, summary: long }],
    ['observations that are not a list', { ...base, observations: 'nope' as never }],
    [
      'too many observations',
      {
        ...base,
        observations: Array.from(
          { length: MAXIMUM_SIDE_REPORT_OBSERVATIONS + 1 },
          (_, index) => `Sentence ${String(index)}.`,
        ),
      },
    ],
    ['an empty observation', { ...base, observations: [''] }],
    ['an observation that is a page', { ...base, observations: [long] }],
  ])('refuses %s on the way in', async (_what, report) => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) => store.putSideCameraReport({ ...report, activityId: ride.id })),
    ).rejects.toThrow(StoreValidationError);
  });

  it('refuses a hand-edited row on the way out', () => {
    const row = { ...toPersistedSideCameraReport(base), observations: [long] };
    expect(() => fromPersistedSideCameraReport(row)).toThrow(StoreDecodeError);
  });

  it('never puts the sentence in the message', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const secret = `Your knee ${'z'.repeat(MAXIMUM_SIDE_REPORT_SENTENCE)}`;
    await expect(
      harness.write(async (store) =>
        store.putSideCameraReport({ ...base, activityId: ride.id, observations: [secret] }),
      ),
    ).rejects.toThrow(/^(?!.*Your knee).*$/s);
  });
});

describe('the harness can tell a report that lost a sentence (#28)', () => {
  it('is green against the real store', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await expect(
      assertSideCameraReportRoundTrip(harness, sideCameraReportFor(ATHLETE_A, ride.id)),
    ).resolves.toBeDefined();
  });

  it('is red against a store that drops the last observation', async () => {
    const broken = createStoreHarness({ factory: lastSentenceDroppedReportStoreFactory() });
    try {
      await seedAthletes(broken);
      const ride = await seedRide(broken, ATHLETE_A);
      await expect(
        assertSideCameraReportRoundTrip(broken, sideCameraReportFor(ATHLETE_A, ride.id)),
      ).rejects.toThrow(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });
});
