// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A group ride is kept as one on the device, and reads as drafted** —
 * #3303, ADR 0101 Q14 (ADR 0066 D-5): saved through `recording/finish.ts` as
 * the ride controller saves it, read back from a connection that never wrote
 * it, with `rideFacts.groupRide` as it was written and the history's existing
 * "drafted" mark on its card.
 *
 * `packages/store` §`activity-store.group-ride-facts.test.ts` holds the
 * store's half (the codec, the owner scope, a ride saved before the field);
 * `ride/controller.test.ts` holds the controller's (`noteGroupRide`). The
 * ride page's debrief is #3310.
 */

import {
  metresPerSecond,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import {
  activityId,
  openActivityStore,
  type GroupRideFact,
  type StreamChannelValue,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rideToSave, saveFinishedRide } from '../../recording/finish';
import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { ActivitiesView } from '../../views/ActivitiesView';

const RIDE = activityId('ride-in-a-group');
const STARTED = unixSeconds(Date.UTC(2026, 10, 27, 8) / 1000);
const SAMPLES = 600;

const FACT: GroupRideFact = {
  version: 1,
  seed: 20_261_127,
  startedAt: 0,
  targetSpeed: 30 / 3.6,
  bots: 5,
  log: [
    { at: 0, phase: 'forming', role: 'last-wheel', groupSpeed: 8.3 },
    { at: 21, phase: 'steady', role: 'last-wheel', groupSpeed: 8.3 },
    { at: 52.5, phase: 'changing', role: 'in-line', groupSpeed: 8.3 },
  ],
};

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

const series: RecordedSeries<StreamChannelValue> = {
  startedAt: STARTED,
  sampleInterval: seconds(1),
  sampleCount: SAMPLES,
  channels: {
    power: Array.from({ length: SAMPLES }, () => watts(150)),
    speed: Array.from({ length: SAMPLES }, () => metresPerSecond(8.3)),
  },
  pauses: [],
};

/** Save a ride through `finish.ts`, as the ride controller does. */
async function save(input: {
  readonly groupRide?: GroupRideFact;
  readonly drafted?: boolean;
}): Promise<void> {
  const finished = rideToSave({
    id: RIDE,
    athleteId: ATHLETE_A,
    series,
    elapsedTime: seconds(SAMPLES),
    movingTime: seconds(SAMPLES),
    timeZone: 'Etc/UTC',
    now: unixSeconds(STARTED + SAMPLES),
    ...(input.drafted === true ? { draft: { drafted: true } } : {}),
    ...(input.groupRide === undefined ? {} : { groupRide: input.groupRide }),
  });
  const outcome = await harness.write(async (store) => saveFinishedRide(store, finished));
  expect(outcome).toStrictEqual({ status: 'saved', id: RIDE });
}

/** The history over the real store, on a connection that never wrote: the ride's card. */
async function historyCard(): Promise<string> {
  await harness.discard();
  const store = openActivityStore(harness.databaseName);
  mounted = await mount(<ActivitiesView library={{ athleteId: ATHLETE_A, store }} />);
  let card = '';
  for (let tries = 0; tries < 50 && card === ''; tries += 1) {
    await settle();
    card = queryAll(document, '.oyl-activity-card__name')[0]?.textContent ?? '';
  }
  mounted.unmount();
  mounted = undefined;
  store.close();
  return card;
}

describe('a group ride is kept with its ride on the device — #3303', () => {
  it('is saved with its group and as drafted, read back by its rider alone, and marked on its card', async () => {
    await save({ groupRide: FACT, drafted: true });
    await harness.discard();
    const read = await harness.read(async (store) => ({
      mine: await store.getActivity(ATHLETE_A, RIDE),
      theirs: await store.getActivity(ATHLETE_B, RIDE),
    }));
    expect(read.mine?.rideFacts?.groupRide).toStrictEqual(FACT);
    expect(read.mine?.rideFacts?.drafted).toBe(true);
    expect(read.theirs).toBeUndefined();
    expect(await historyCard()).toMatch(/· drafted$/);
  });

  it('keeps no group with a ride that had none', async () => {
    await save({});
    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, RIDE));
    expect(read?.rideFacts).not.toHaveProperty('groupRide');
    expect(await historyCard()).not.toContain('drafted');
  });
});
