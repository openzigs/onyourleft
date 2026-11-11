// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A drafted ride is kept as one on the device — #2451, ADR 0066 D-5.3:
 * written by `finish.ts` as the ride controller saves it, read back through
 * the store on a fresh connection, and said in words on the two screens a
 * rider finds a ride on — its page and the history — after a reload.
 */

import { seconds, unixSeconds, watts, type RecordedSeries } from '@onyourleft/domain';
import { activityId, openActivityStore, type StreamChannelValue } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DRAFTED_RIDE_TEXT } from '../game/solo-draft';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { ActivitiesView } from '../views/ActivitiesView';
import { ActivityDetailView, READING_RIDE_TEXT } from '../views/ActivityDetailView';

import { rideToSave, saveFinishedRide } from './finish';

const RIDE = activityId('ride-drafted');
const STARTED = unixSeconds(Date.UTC(2026, 10, 11, 8) / 1000);
const SAMPLES = 600;

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
    power: Array.from({ length: SAMPLES }, () => watts(200)),
    speed: Array.from({ length: SAMPLES }, () => 9 as StreamChannelValue),
  },
  pauses: [],
} as RecordedSeries<StreamChannelValue>;

/** Save a ride through `finish.ts`, as the ride controller does. */
async function save(draft: Parameters<typeof rideToSave>[0]['draft']): Promise<void> {
  const finished = rideToSave({
    id: RIDE,
    athleteId: ATHLETE_A,
    series,
    elapsedTime: seconds(SAMPLES),
    movingTime: seconds(SAMPLES),
    timeZone: 'Europe/London',
    now: unixSeconds(STARTED + SAMPLES),
    draft,
  });
  const outcome = await harness.write(async (store) => saveFinishedRide(store, finished));
  expect(outcome).toStrictEqual({ status: 'saved', id: RIDE });
}

/** The ride's page over the real store, on a connection that never wrote: its summary rows. */
async function ridePage(): Promise<string[]> {
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
  const rows = queryAll(document, '.oyl-ride-summary > div').map((row) =>
    (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
  mounted.unmount();
  mounted = undefined;
  store.close();
  return rows;
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

describe('a drafted ride is kept as one on the device — #2451, ADR 0066 D-5.3', () => {
  it('is saved with the fact and its spans, and says so on its page and its card after a reload', async () => {
    const spans = [{ from: unixSeconds(STARTED + 10), to: unixSeconds(STARTED + 200) }];
    await save({ drafted: true, draftSpans: spans });
    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, RIDE));
    expect(read?.rideFacts?.drafted).toBe(true);
    expect(read?.rideFacts?.draftSpans).toStrictEqual(spans);

    expect(await ridePage()).toContain(`Draft${DRAFTED_RIDE_TEXT}`);
    expect(await historyCard()).toMatch(/· drafted$/);
  });

  it('says nothing of a draft on a ride that was not drafted', async () => {
    await save(undefined);
    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, RIDE));
    expect(read?.rideFacts?.drafted).toBeUndefined();
    expect(read?.rideFacts?.draftSpans).toBeUndefined();

    expect((await ridePage()).some((row) => row.startsWith('Draft'))).toBe(false);
    expect(await historyCard()).not.toContain('drafted');
  });
});
