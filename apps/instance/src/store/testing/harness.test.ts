// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import {
  activityRecordFixture,
  assertActivityRecordRoundTrip,
  assertAthleteRoundTrip,
  athleteFixture,
  ATHLETE_A,
  createStoreHarness,
  RoundTripFailure,
  type StoreFactory,
  type StoreHarness,
} from './index.ts';
import { memoryStoreFactory, uncommittedStoreFactory, wrongKeyStoreFactory } from './fakes.ts';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function withAthlete(factory?: StoreFactory): Promise<StoreHarness> {
  harness = await createStoreHarness(factory);
  await harness.write((store) => store.putAthlete(athleteFixture(ATHLETE_A)));
  return harness;
}

describe('the round-trip harness (#769)', () => {
  it('passes a round trip through the real store', async () => {
    const opened = await withAthlete();
    await assertActivityRecordRoundTrip(opened, activityRecordFixture(ATHLETE_A));
    await assertAthleteRoundTrip(opened, athleteFixture('another'));
  });

  it('opens a new store for every read, so the writer never serves one', async () => {
    const opened = await withAthlete();
    const before = opened.connectionsOpened;
    let writer: unknown;
    let reader: unknown;
    await opened.roundTrip(
      (store) => {
        writer = store;
        return Promise.resolve();
      },
      (store) => {
        reader = store;
        return Promise.resolve();
      },
    );
    expect(opened.connectionsOpened).toBe(before + 2);
    expect(reader).not.toBe(writer);
  });

  describe.each([
    ['a store that writes to memory', memoryStoreFactory],
    ['a store that writes under a different key', wrongKeyStoreFactory],
    ['a store that acknowledges without committing', uncommittedStoreFactory],
  ] as const)('goes red against %s', (_name, factory) => {
    it('fails the activity record round trip', async () => {
      const opened = await withAthlete(factory);
      await expect(
        assertActivityRecordRoundTrip(opened, activityRecordFixture(ATHLETE_A)),
      ).rejects.toBeInstanceOf(RoundTripFailure);
    });
  });
});
