// SPDX-License-Identifier: Apache-2.0

/**
 * Effort persistence (#66) — idempotent re-matching, a resumable backfill, the
 * two read paths a `private-match` effort must be treated differently by, and
 * attributes that stay frozen across a profile edit.
 *
 * ⚠️ Every assertion here reads back through a **fresh store handle**
 * (`harness.read` discards every open connection first), because the defect
 * this package keeps hunting is a write that reports success while the read
 * cannot see it — CLAUDE.md §5.
 */

import { kilograms, seconds, unixSeconds } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  effortFor,
  appendingEffortStoreFactory,
  resetFixtureIds,
  rideFor,
  seedAthletes,
  segmentFor,
  type StoreHarness,
} from './testing';
import { StoreReferentialError, StoreValidationError } from './errors';
import { activityId } from './ids';

import type { ActivityId, SegmentId } from './ids';
import type { SegmentEffortRecord } from './records';

let harness: StoreHarness;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

/**
 * Seed the athletes, one segment and one ride into `into`, and return the ids.
 *
 * ⚠️ Only ATHLETE_A and ATHLETE_B are seeded, deliberately: ATHLETE_C is left
 * absent so there is a genuinely unknown athlete for the referential test. The
 * three-athlete fixture exists to tell "scoped correctly" apart from "returns
 * everything", and two of them is enough for that here.
 */
async function seedOneOfEach(
  into: StoreHarness = harness,
): Promise<{ segment: SegmentId; activity: ActivityId }> {
  const segment = segmentFor(ATHLETE_A);
  const ride = rideFor(ATHLETE_A);
  await seedAthletes(into, [ATHLETE_A, ATHLETE_B]);
  await into.write(async (store) => {
    await store.putSegment(segment);
    await store.putActivity(ride);
  });
  return { segment: segment.id, activity: ride.id };
}

describe('re-matching is idempotent — #66’s sixth criterion', () => {
  it('running the matcher three times leaves the effort count unchanged', async () => {
    // The failure this prevents: "without this, every app restart inflates
    // every leaderboard". Three runs and not two, as the criterion asks — a
    // store that de-duplicated only against the immediately preceding run would
    // pass at two.
    const { segment, activity } = await seedOneOfEach();
    const found = [effortFor(ATHLETE_A, segment, activity)];

    for (let run = 0; run < 3; run += 1) {
      await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, found));
    }

    const stored = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));
    expect(stored).toHaveLength(1);
  });

  it('an effort keeps its id across a re-match, which is what the DERIVED id buys', async () => {
    // ⚠️ Not the same property as idempotence, and worth separating because the
    // first version of this suite conflated them. What makes the count stable
    // is that `putActivityEfforts` REPLACES the activity's set — a fake with
    // random ids stayed green against the three-runs test for exactly that
    // reason. What the derived id buys is that the effort a rider looked at
    // yesterday is still the same row today, which is what anything holding a
    // reference to an effort needs.
    const { segment, activity } = await seedOneOfEach();
    const found = [effortFor(ATHLETE_A, segment, activity)];

    await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, found));
    const before = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));
    await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, found));
    const after = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));

    expect(after[0]?.id).toBe(before[0]?.id);
  });

  it('the SAME traversal rewrites its row rather than adding beside it', async () => {
    // Same start instant, different elapsed — a re-match after the tolerances
    // moved. One row, carrying the new value.
    const { segment, activity } = await seedOneOfEach();
    const first = effortFor(ATHLETE_A, segment, activity, { elapsedSeconds: 90 });
    const again = effortFor(ATHLETE_A, segment, activity, { elapsedSeconds: 88 });
    expect(again.id).toBe(first.id);

    await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, [first]));
    await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, [again]));

    const stored = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.elapsed).toBe(seconds(88));
  });

  it('a segment ridden twice keeps BOTH efforts, because the start instants differ', async () => {
    const { segment, activity } = await seedOneOfEach();
    const lapOne = effortFor(ATHLETE_A, segment, activity, {
      startedAt: unixSeconds(1_700_000_000),
    });
    const lapTwo = effortFor(ATHLETE_A, segment, activity, {
      startedAt: unixSeconds(1_700_003_600),
    });

    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [lapOne, lapTwo]),
    );

    expect(await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment))).toHaveLength(
      2,
    );
  });

  it('an effort the matcher no longer finds is REMOVED, not left ranking', async () => {
    // The other half of idempotence, and the one a derived id alone does not
    // give: without it a re-match is additive, the count never falls, and a
    // stale effort on a segment the rider deleted keeps appearing.
    const { segment, activity } = await seedOneOfEach();
    const stale = effortFor(ATHLETE_A, segment, activity);
    await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, [stale]));

    await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, []));

    expect(await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment))).toEqual([]);
  });

  it('re-matching ONE activity leaves another activity’s efforts alone', async () => {
    // The scoping mistake a "replace this segment's efforts" API would make:
    // one ride re-matched would delete every other ride's efforts on it.
    const { segment, activity } = await seedOneOfEach();
    const second = rideFor(ATHLETE_A);
    await harness.write(async (store) => store.putActivity(second));

    await harness.write(async (store) => {
      await store.putActivityEfforts(ATHLETE_A, activity, [
        effortFor(ATHLETE_A, segment, activity),
      ]);
      await store.putActivityEfforts(ATHLETE_A, second.id, [
        effortFor(ATHLETE_A, segment, second.id, { startedAt: unixSeconds(1_700_009_000) }),
      ]);
    });
    await harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, []));

    const left = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));
    expect(left).toHaveLength(1);
    expect(left[0]?.activityId).toBe(second.id);
  });

  it('goes RED against a store that appends instead of replacing', async () => {
    // The failure in the criterion's own words: every app restart inflates
    // every leaderboard. Everything else about the write is correct, which is
    // why only running the matcher twice and counting catches it.
    const fake = createStoreHarness({ factory: appendingEffortStoreFactory() });
    try {
      const { segment, activity } = await seedOneOfEach(fake);
      const found = [effortFor(ATHLETE_A, segment, activity)];

      for (let run = 0; run < 3; run += 1) {
        await fake.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, found));
      }

      const stored = await fake.read(async (store) => store.listEfforts(ATHLETE_A, segment));
      expect(stored.length).toBeGreaterThan(1);
    } finally {
      await fake.destroy();
    }
  });
});

describe('the two read paths — #66’s seventh criterion, both halves', () => {
  it('a private-match effort IS returned by the athlete’s own read', async () => {
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [
        effortFor(ATHLETE_A, segment, activity, { visibility: 'private-match' }),
      ]),
    );

    const mine = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.visibility).toBe('private-match');
  });

  it('and is ABSENT from the shared read', async () => {
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [
        effortFor(ATHLETE_A, segment, activity, { visibility: 'private-match' }),
      ]),
    );

    expect(
      await harness.read(async (store) => store.listSharedEfforts(ATHLETE_A, segment)),
    ).toEqual([]);
  });

  it('an excluded effort is absent from BOTH', async () => {
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [
        effortFor(ATHLETE_A, segment, activity, { visibility: 'excluded' }),
      ]),
    );

    expect(await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment))).toEqual([]);
    expect(
      await harness.read(async (store) => store.listSharedEfforts(ATHLETE_A, segment)),
    ).toEqual([]);
  });

  it('a public effort appears on both, so the filters are not simply empty', async () => {
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [effortFor(ATHLETE_A, segment, activity)]),
    );

    expect(await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment))).toHaveLength(
      1,
    );
    expect(
      await harness.read(async (store) => store.listSharedEfforts(ATHLETE_A, segment)),
    ).toHaveLength(1);
  });

  it('returns the athlete’s own efforts fastest first, so a personal best is the first row', async () => {
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [
        effortFor(ATHLETE_A, segment, activity, {
          startedAt: unixSeconds(1_700_000_000),
          elapsedSeconds: 120,
        }),
        effortFor(ATHLETE_A, segment, activity, {
          startedAt: unixSeconds(1_700_003_600),
          elapsedSeconds: 95,
        }),
      ]),
    );

    const mine = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));
    expect(mine.map((effort) => effort.elapsed)).toEqual([seconds(95), seconds(120)]);
  });
});

describe('efforts are athlete-scoped, on the write path as well as the read', () => {
  it('another athlete’s read finds nothing', async () => {
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [effortFor(ATHLETE_A, segment, activity)]),
    );

    expect(await harness.read(async (store) => store.listEfforts(ATHLETE_B, segment))).toEqual([]);
  });

  it('refuses an effort filed under an athlete who does not own it', async () => {
    // The cross-athlete shape CLAUDE.md §6 names, arriving through a write.
    const { segment, activity } = await seedOneOfEach();
    const theirs = effortFor(ATHLETE_B, segment, activity);

    await expect(
      harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, [theirs])),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('refuses an effort that names a different activity than the one being swept', async () => {
    const { segment, activity } = await seedOneOfEach();
    const elsewhere = effortFor(ATHLETE_A, segment, activityId('some-other-ride'));

    await expect(
      harness.write(async (store) => store.putActivityEfforts(ATHLETE_A, activity, [elsewhere])),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('refuses to write efforts for an athlete who does not exist', async () => {
    // ATHLETE_C is deliberately not seeded — see `seedOneOfEach`. The check is
    // inside the same transaction as the write, for `putActivity`'s reason: a
    // check outside it lets a concurrent `deleteAthlete` produce exactly the
    // orphan it exists to prevent.
    const { segment, activity } = await seedOneOfEach();
    await expect(
      harness.write(async (store) =>
        store.putActivityEfforts(ATHLETE_C, activity, [effortFor(ATHLETE_C, segment, activity)]),
      ),
    ).rejects.toThrow(StoreReferentialError);
  });
});

describe('attributes stay frozen across a profile edit — #66’s eighth criterion', () => {
  it('changing the athlete’s recorded mass does not alter a stored effort’s bucket', async () => {
    // The domain test proves `createEffort` copies. This proves the copy
    // SURVIVES a round trip and a profile write — the half that would fail if
    // anything joined the effort back to the athlete row at read time.
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [
        effortFor(ATHLETE_A, segment, activity, { riderMassKilograms: 78 }),
      ]),
    );

    await harness.write(async (store) => {
      const athlete = await store.getAthlete(ATHLETE_A);
      if (athlete === undefined) {
        throw new Error('the fixture athlete is missing');
      }
      await store.putAthlete({ ...athlete, mass: kilograms(72) });
    });

    const stored = await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment));
    expect(stored[0]?.attributes.riderMass).toBe(kilograms(78));
    // And the athlete really did change, so the assertion above is about
    // freezing rather than about a write that never happened.
    const athlete = await harness.read(async (store) => store.getAthlete(ATHLETE_A));
    expect(athlete?.mass).toBe(kilograms(72));
  });
});

describe('the backfill checkpoint', () => {
  it('round-trips, and clearing it is what finishing looks like', async () => {
    const { activity } = await seedOneOfEach();
    const cursor = {
      athleteId: ATHLETE_A,
      lastStartedAt: unixSeconds(1_700_000_500),
      lastActivityId: activity,
      swept: 41,
      updatedAt: unixSeconds(1_700_000_600),
    };

    await harness.write(async (store) => store.putMatchCheckpoint(cursor));
    expect(await harness.read(async (store) => store.getMatchCheckpoint(ATHLETE_A))).toEqual(
      cursor,
    );

    await harness.write(async (store) => store.clearMatchCheckpoint(ATHLETE_A));
    expect(
      await harness.read(async (store) => store.getMatchCheckpoint(ATHLETE_A)),
    ).toBeUndefined();
  });

  it('is per athlete, so one rider’s sweep is not another’s', async () => {
    const { activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putMatchCheckpoint({
        athleteId: ATHLETE_A,
        lastStartedAt: unixSeconds(1),
        lastActivityId: activity,
        swept: 1,
        updatedAt: unixSeconds(1),
      }),
    );

    expect(
      await harness.read(async (store) => store.getMatchCheckpoint(ATHLETE_B)),
    ).toBeUndefined();
  });
});

describe('the delete cascades', () => {
  it('deleting the activity removes the efforts found in it', async () => {
    // Unlike #64's segments, which survive their source activity by design. An
    // effort is a claim about a specific ride; when the ride is gone it can no
    // longer be explained or re-derived, and it would still be ranking.
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) =>
      store.putActivityEfforts(ATHLETE_A, activity, [effortFor(ATHLETE_A, segment, activity)]),
    );

    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, activity));

    expect(await harness.read(async (store) => store.listEfforts(ATHLETE_A, segment))).toEqual([]);
    // The segment itself is untouched — #64's second criterion.
    expect(await harness.read(async (store) => store.getSegment(ATHLETE_A, segment))).toBeDefined();
  });

  it('erasing the athlete removes their efforts and their checkpoint, and counts them', async () => {
    const { segment, activity } = await seedOneOfEach();
    await harness.write(async (store) => {
      await store.putActivityEfforts(ATHLETE_A, activity, [
        effortFor(ATHLETE_A, segment, activity),
      ]);
      await store.putMatchCheckpoint({
        athleteId: ATHLETE_A,
        lastStartedAt: unixSeconds(1),
        lastActivityId: activity,
        swept: 1,
        updatedAt: unixSeconds(1),
      });
    });

    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.efforts).toBe(1);

    const left: SegmentEffortRecord[] = await harness.read(async (store) =>
      store.listEfforts(ATHLETE_A, segment),
    );
    expect(left).toEqual([]);
    expect(
      await harness.read(async (store) => store.getMatchCheckpoint(ATHLETE_A)),
    ).toBeUndefined();
  });
});

describe('the startedAfter cursor a resumable sweep needs', () => {
  it('is STRICTLY after, so a resumed sweep does not re-read where it stopped', async () => {
    // ⚠️ Inclusive here and a library whose final page holds one ride never
    // ends: the sweep reads that ride, checkpoints on it, and reads it again.
    await seedAthletes(harness, [ATHLETE_A]);
    const first = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
    const second = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_086_400) });
    await harness.write(async (store) => {
      await store.putActivity(first);
      await store.putActivity(second);
    });

    const after = await harness.read(async (store) =>
      store.listActivitySummaries(ATHLETE_A, {
        orderBy: 'startedAt',
        direction: 'ascending',
        startedAfter: first.startedAt,
      }),
    );

    expect(after.map((row) => row.id)).toEqual([second.id]);
  });

  it('returns the whole library when no cursor is given', async () => {
    // The other half: an absent cursor must not be read as "after nothing",
    // which would silently return an empty first page and end every sweep
    // before it started.
    await seedAthletes(harness, [ATHLETE_A]);
    const ride = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
    await harness.write(async (store) => store.putActivity(ride));

    const all = await harness.read(async (store) =>
      store.listActivitySummaries(ATHLETE_A, { orderBy: 'startedAt', direction: 'ascending' }),
    );

    expect(all.map((row) => row.id)).toEqual([ride.id]);
  });

  it('refuses to combine the cursor with an order it is not an index on', async () => {
    // `startedAfter` is a bound on the startedAt index. Silently ignoring it
    // under `orderBy: 'distance'` would make a sweep restart from the top and
    // never terminate.
    await seedAthletes(harness, [ATHLETE_A]);
    await expect(
      harness.read(async (store) =>
        store.listActivitySummaries(ATHLETE_A, {
          orderBy: 'distance',
          startedAfter: unixSeconds(1),
        }),
      ),
    ).rejects.toThrow(StoreValidationError);
  });
});
