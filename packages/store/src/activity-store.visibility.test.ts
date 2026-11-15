// SPDX-License-Identifier: Apache-2.0

/**
 * A ride's visibility, set through the narrow write (#68): what sharing a
 * ride's efforts on an instance's leaderboard makes `public` here, and
 * withdrawing them makes `private` again. Every read is on a connection the
 * write never touched (the harness's `read`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { StoreValidationError } from './errors';
import { activityId } from './ids';
import type { Visibility } from './visibility';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from './testing';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

describe('a ride’s visibility (#68)', () => {
  it('is private until it is set, and reads back what was set — and nothing else moved', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    await seedRide(harness, ATHLETE_A, { id: activityId('a-ride') });
    const before = await harness.read((store) =>
      store.getActivity(ATHLETE_A, activityId('a-ride')),
    );
    expect(before?.visibility).toBe('private');

    await expect(
      harness.write((store) =>
        store.setActivityVisibility(ATHLETE_A, activityId('a-ride'), 'public'),
      ),
    ).resolves.toBe(true);
    const after = await harness.read((store) => store.getActivity(ATHLETE_A, activityId('a-ride')));
    expect(after?.visibility).toBe('public');
    expect({ ...after, visibility: 'private' }).toStrictEqual(before);

    await harness.write((store) =>
      store.setActivityVisibility(ATHLETE_A, activityId('a-ride'), 'private'),
    );
    expect(
      (await harness.read((store) => store.getActivity(ATHLETE_A, activityId('a-ride'))))
        ?.visibility,
    ).toBe('private');
  });

  it('will not set another athlete’s ride, nor one that is not there', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    await seedRide(harness, ATHLETE_B, { id: activityId('b-ride') });
    await expect(
      harness.write((store) =>
        store.setActivityVisibility(ATHLETE_A, activityId('b-ride'), 'public'),
      ),
    ).resolves.toBe(false);
    await expect(
      harness.write((store) =>
        store.setActivityVisibility(ATHLETE_A, activityId('no-ride'), 'public'),
      ),
    ).resolves.toBe(false);
    expect(
      (await harness.read((store) => store.getActivity(ATHLETE_B, activityId('b-ride'))))
        ?.visibility,
    ).toBe('private');
  });

  it('refuses a value outside the three', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    await seedRide(harness, ATHLETE_A, { id: activityId('a-ride') });
    await expect(
      harness.write((store) =>
        store.setActivityVisibility(ATHLETE_A, activityId('a-ride'), 'everyone' as Visibility),
      ),
    ).rejects.toBeInstanceOf(StoreValidationError);
  });
});
