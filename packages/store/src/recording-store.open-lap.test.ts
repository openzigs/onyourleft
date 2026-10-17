// SPDX-License-Identifier: Apache-2.0

/**
 * The lap in progress on a recording's header — #1322.
 *
 * A recording recovered after the tab died has no game to say how far round
 * the rider was, so the header carries it as a part lap, rewritten with every
 * flush. Every case writes through `putRecordingSession` and reads back on a
 * connection the write never touched, through both readers a client uses:
 * `getRecordingSession` (what is offered) and `recoverRecording` (what is
 * saved).
 */

import { metres, seconds, unixSeconds } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NewRecordingSession, RecordedCourseLap } from './recording';
import {
  ATHLETE_A,
  createStoreHarness,
  FIXTURE_EPOCH,
  recordingFor,
  resetFixtureIds,
  seedAthletes,
  type StoreHarness,
} from './testing';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

const START = FIXTURE_EPOCH + 100_000;

function lap(from: number, to: number, distance: number): RecordedCourseLap {
  return {
    from: { at: unixSeconds(START + from), movingTime: seconds(from) },
    to: { at: unixSeconds(START + to), movingTime: seconds(to) },
    distance: metres(distance),
    ascent: metres(3),
  };
}

function recording(overrides: Partial<NewRecordingSession>): NewRecordingSession {
  return recordingFor(ATHLETE_A, { updatedAt: unixSeconds(START + 60), ...overrides });
}

async function written(record: NewRecordingSession) {
  await harness.write(async (store) => store.putRecordingSession(record));
  return harness.read(async (store) => ({
    header: await store.getRecordingSession(ATHLETE_A, record.id),
    recovered: await store.recoverRecording(ATHLETE_A, record.id),
  }));
}

describe('the lap in progress is kept on the header', () => {
  it('reads back, through both readers, as a part lap after the completed ones', async () => {
    const record = recording({ courseLaps: [lap(0, 20, 1_000)], openCourseLap: lap(20, 35, 400) });

    const { header, recovered } = await written(record);

    const expected = { ...lap(20, 35, 400), partial: true };
    expect(header?.openCourseLap).toStrictEqual(expected);
    expect(recovered?.openCourseLap).toStrictEqual(expected);
    expect(recovered?.courseLaps).toStrictEqual([lap(0, 20, 1_000)]);
  });

  it('is a part lap whatever the writer called it', async () => {
    const { header } = await written(recording({ openCourseLap: lap(0, 15, 300) }));
    expect(header?.openCourseLap?.partial).toBe(true);
  });

  it('is absent from a header with none', async () => {
    const { header, recovered } = await written(recording({ courseLaps: [lap(0, 20, 1_000)] }));
    expect(header).not.toHaveProperty('openCourseLap');
    expect(recovered).not.toHaveProperty('openCourseLap');
  });
});

describe('a lap in progress that does not read costs nothing else', () => {
  it('one that cannot be kept is dropped alone, and the completed laps are not', async () => {
    const record = recording({
      courseLaps: [lap(0, 20, 1_000)],
      // Its moving time ran backwards: `courseLapFault`'s own case.
      openCourseLap: {
        ...lap(20, 35, 400),
        to: { at: unixSeconds(START + 35), movingTime: seconds(19) },
      },
    });

    const { header } = await written(record);

    expect(header).not.toHaveProperty('openCourseLap');
    expect(header?.courseLaps).toStrictEqual([lap(0, 20, 1_000)]);
  });

  it('one that began before the last completed lap ended is dropped alone on the way out', async () => {
    const { recovered } = await written(
      recording({ courseLaps: [lap(0, 20, 1_000)], openCourseLap: lap(10, 35, 400) }),
    );
    expect(recovered).not.toHaveProperty('openCourseLap');
    expect(recovered?.courseLaps).toStrictEqual([lap(0, 20, 1_000)]);
  });

  it('one that ends after the header was written is dropped alone on the way out', async () => {
    const { recovered } = await written(
      recording({ courseLaps: [lap(0, 20, 1_000)], openCourseLap: lap(20, 61, 400) }),
    );
    expect(recovered).not.toHaveProperty('openCourseLap');
    expect(recovered?.courseLaps).toStrictEqual([lap(0, 20, 1_000)]);
  });

  it('one that began before the recording did is dropped on the way out', async () => {
    const { recovered } = await written(
      recording({
        openCourseLap: {
          ...lap(0, 15, 300),
          from: { at: unixSeconds(START - 1), movingTime: seconds(0) },
        },
      }),
    );
    expect(recovered).not.toHaveProperty('openCourseLap');
  });
});
