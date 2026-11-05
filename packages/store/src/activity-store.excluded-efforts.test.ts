// SPDX-License-Identifier: Apache-2.0

/**
 * An effort the rule excluded (#69): read by `listExcludedEfforts` and by no
 * other effort read — so it is never a personal best, and never lost either.
 * Every read is on a connection the write never touched (the harness's `read`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';

import {
  ATHLETE_A,
  createStoreHarness,
  effortFor,
  rideFor,
  seedAthletes,
  segmentFor,
  type StoreHarness,
} from './testing';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

describe('excluded efforts (#69)', () => {
  it('are read by listExcludedEfforts alone, fastest first, and kept out of every other read', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    const segment = segmentFor(ATHLETE_A);
    const ride = rideFor(ATHLETE_A);
    const counted = effortFor(ATHLETE_A, segment.id, ride.id, { elapsedSeconds: 90 });
    const slow = effortFor(ATHLETE_A, segment.id, ride.id, {
      startedAt: unixSeconds(1_700_000_500),
      elapsedSeconds: 8,
      visibility: 'excluded',
    });
    const fast = effortFor(ATHLETE_A, segment.id, ride.id, {
      startedAt: unixSeconds(1_700_000_900),
      elapsedSeconds: 4,
      visibility: 'excluded',
    });
    await harness.write(async (store) => {
      await store.putSegment(segment);
      await store.putActivity(ride);
      await store.putActivityEfforts(ATHLETE_A, ride.id, [counted, slow, fast]);
    });

    const excluded = await harness.read((store) =>
      store.listExcludedEfforts(ATHLETE_A, segment.id),
    );
    expect(excluded.map((effort) => effort.id)).toEqual([fast.id, slow.id]);
    expect(
      (await harness.read((store) => store.listExcludedEfforts(ATHLETE_A, segment.id, 1))).map(
        (effort) => effort.id,
      ),
    ).toEqual([fast.id]);
    expect(
      (await harness.read((store) => store.listEfforts(ATHLETE_A, segment.id))).map(
        (effort) => effort.id,
      ),
    ).toEqual([counted.id]);
    expect(
      (await harness.read((store) => store.listSharedEfforts(ATHLETE_A, segment.id))).map(
        (effort) => effort.id,
      ),
    ).toEqual([counted.id]);
  });
});
