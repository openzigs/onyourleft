// SPDX-License-Identifier: Apache-2.0

/**
 * What a list row carries, derived from the record rather than listed by hand
 * (#1088).
 *
 * `activity-store.ts` §`summaryOf` is an explicit destructure, so a REQUIRED
 * field added to `ActivityRecord` fails to compile there until somebody
 * decides which side of the projection it is on. An OPTIONAL one does not: it
 * is left out of every list row with no error at all. That happened twice —
 * the load summary (#1070) and `routeId` (#1088, which Home's "Next up" reads)
 * — and both times every test above the store was green, because the web
 * stubs carry the whole row.
 *
 * So this file closes it from both ends, the way
 * `activity-store.scoping.test.ts` derives its probes from the store:
 *
 * 1. {@link EVERY_FIELD} is a `Required<ActivityRecord>`. A new optional field
 *    on the record is a compile error HERE until the fixture sets it.
 * 2. The test then writes that ride, reads it back through
 *    `listActivitySummaries` on a fresh connection, and requires the row's
 *    keys to be the fixture's keys less {@link SUMMARY_EXCLUSIONS} — each with
 *    its reason — and every value to come back as written.
 * 3. {@link SUMMARY_EXCLUSIONS} is held to `ActivitySummary`'s own `Omit` by a
 *    type-level check, so the list here and the type cannot disagree.
 *
 * ⚠️ The red for a new optional field is the TYPECHECK (`pnpm run typecheck`),
 * not Vitest, which does not check types. Both run in CI.
 */

import { metres, seconds, unixSeconds, watts, beatsPerMinute } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { activityId, routeId } from './ids';
import type { ActivityRecord, ActivitySummary } from './records';
import { ATHLETE_A, createStoreHarness, seedAthletes, type StoreHarness } from './testing';

/**
 * The fields a list row deliberately does NOT carry, and why. A new entry here
 * is a decision, written down with its reason; nothing else leaves the row.
 */
const SUMMARY_EXCLUSIONS = {
  // #26 / #62: a list row never reaches the ride's stored file.
  originalFile: 'a list row never loads or references the stored file (#62)',
  // #793: no list row reads the consent; the ride's own page reads the ride.
  mayBeRaced: 'no list row reads the racing consent; the ride page reads the whole ride (#793)',
} as const satisfies Partial<Record<keyof ActivityRecord, string>>;

type Excluded = keyof typeof SUMMARY_EXCLUSIONS;
type OmittedByTheType = Exclude<keyof ActivityRecord, keyof ActivitySummary>;
// Fails to compile if `ActivitySummary`'s `Omit` and this list disagree, in
// either direction.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const EXCLUSIONS_MATCH_THE_TYPE: Same<Excluded, OmittedByTheType> = true;

/**
 * A ride with EVERY field set, optional ones included. `Required<…>` is the
 * point: a field added to `ActivityRecord` does not compile here until it is
 * given a value, and the test below then requires the list row to carry it.
 * Values are deliberately not defaults, so a reader that substitutes one is
 * caught by the value comparison.
 */
const EVERY_FIELD: Required<ActivityRecord> = {
  id: activityId('activity-every-field'),
  athleteId: ATHLETE_A,
  name: 'Every field set',
  startedAt: unixSeconds(1_700_100_000),
  startedAtTimeZone: 'Europe/London',
  elapsedTime: seconds(3_700),
  movingTime: seconds(3_600),
  distance: metres(30_000),
  visibility: 'followers',
  hasPosition: true,
  routeId: routeId('route-x'),
  averagePower: watts(201),
  effortWeightedPower: watts(223),
  effortWeightedHeartRate: beatsPerMinute(151),
  loadCoveredTime: seconds(3_500),
  originalFile: {
    key: 'files/every-field.fit',
    sha256: 'a'.repeat(64),
  },
  mayBeRaced: true,
  createdAt: unixSeconds(1_700_200_000),
};

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

describe('listActivitySummaries — the list row carries every field not excluded with a reason (#1088)', () => {
  it('holds the exclusion list to the ActivitySummary type', () => {
    expect(EXCLUSIONS_MATCH_THE_TYPE).toBe(true);
  });

  it('round-trips every field of the fixture through getActivity, so the fixture is a fair source', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);

    const read = await open.roundTrip(
      async (store) => store.putActivity(EVERY_FIELD),
      async (store) => store.getActivity(ATHLETE_A, EVERY_FIELD.id),
    );

    expect(read).toEqual(EVERY_FIELD);
  });

  it('a list row is the record less the named exclusions, key for key and value for value', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);

    const row = await open.roundTrip(
      async (store) => store.putActivity(EVERY_FIELD),
      async (store) =>
        (await store.listActivitySummaries(ATHLETE_A)).find(
          (summary) => summary.id === EVERY_FIELD.id,
        ),
    );

    const excluded = new Set<string>(Object.keys(SUMMARY_EXCLUSIONS));
    const expected = Object.fromEntries(
      Object.entries(EVERY_FIELD).filter(([key]) => !excluded.has(key)),
    );

    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual(Object.keys(expected).sort());
    expect(row).toEqual(expected);
  });

  it('carries routeId, which Home’s "Next up" reads (#1088)', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);

    const row = await open.roundTrip(
      async (store) => store.putActivity(EVERY_FIELD),
      async (store) => (await store.listActivitySummaries(ATHLETE_A))[0],
    );

    expect(row?.routeId).toBe('route-x');
  });
});
