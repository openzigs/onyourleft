// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride page's lap table — #1312.
 *
 * ⚠️ **The last case reads the laps back from a REAL store, through a fresh
 * handle** (docs/agents/quality-gate.md §5): a ride saved with its laps by the
 * path a finished recording takes (`recording/finish.ts`), read by `listLaps`
 * as the page reads it, and rendered by this component. A table built from
 * the objects a test constructed would pass whether or not a lap ever reached
 * IndexedDB.
 */

import {
  beatsPerMinute,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import {
  activityId,
  lapId,
  type LapRecord,
  type StreamChannelValue,
  type UnitSystem,
} from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { rideToSave, saveFinishedRide } from '../recording/finish';
import { courseLap } from '../recording/laps';
import { mount, queryAll, type Mounted } from '../testing/mount';

import { LAP_TIMES_NOTE, LapsTable } from './LapsTable';
import { stubLap } from './testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function tableOf(
  laps: readonly LapRecord[],
  units: UnitSystem = 'metric',
): Promise<{ readonly headings: string[]; readonly rows: string[][]; readonly text: string }> {
  mounted = await mount(<LapsTable laps={laps} units={units} />);
  const container = mounted.container;
  return {
    headings: queryAll<HTMLElement>(container, 'thead th').map((cell) => cell.textContent ?? ''),
    rows: queryAll<HTMLElement>(container, 'tbody tr').map((row) =>
      queryAll<HTMLElement>(row, 'th, td').map((cell) => cell.textContent ?? ''),
    ),
    text: container.textContent ?? '',
  };
}

/** A whole 7 km lap with every figure #1312 records. */
const full = (ordinal: number, moving: number, overrides: Partial<LapRecord> = {}): LapRecord =>
  stubLap(ordinal, {
    elapsedTime: seconds(moving + 30),
    movingTime: seconds(moving),
    averagePower: watts(203),
    maxPower: watts(618),
    averageHeartRate: beatsPerMinute(151),
    maxHeartRate: beatsPerMinute(173),
    averageCadence: revolutionsPerMinute(91),
    ascent: metres(48),
    ...overrides,
  });

describe('the lap table — #1312', () => {
  it('lists one row per lap with every figure the lap states', async () => {
    const { headings, rows } = await tableOf([full(0, 700)]);

    expect(headings).toEqual([
      'Lap',
      'Elapsed',
      'Moving',
      'Distance (km)',
      'Avg power (W)',
      'Best power (W)',
      'Avg speed (km/h)',
      'Avg heart rate (bpm)',
      'Highest heart rate (bpm)',
      'Avg cadence (rpm)',
      'Climb (m)',
    ]);
    // 7 km in 700 s of MOVING time is 36.0 km/h; the 30 s paused are not in it.
    expect(rows).toEqual([
      ['1', '12:10', '11:40', '7.0', '203', '618', '36.0', '151', '173', '91', '48'],
    ]);
  });

  it('marks the best lap in words, in its own row header', async () => {
    const { rows } = await tableOf([full(0, 700), full(1, 650), full(2, 690)]);

    expect(rows.map((row) => row[0])).toEqual(['1', '2 · Best lap', '3']);
  });

  it('shows a part lap as a part lap, and never as the best however quick it reads', async () => {
    const part = full(2, 60, { distance: metres(6_900), partial: true });
    const { rows } = await tableOf([full(0, 700), full(1, 650), part]);

    expect(rows.map((row) => row[0])).toEqual(['1', '2 · Best lap', '3 · Part lap']);
  });

  it('marks no lap best when only one was completed', async () => {
    const { rows } = await tableOf([full(0, 700), full(1, 60, { partial: true })]);

    expect(rows.map((row) => row[0])).toEqual(['1', '2 · Part lap']);
  });

  it('draws a figure’s column only when some lap has it, and a dash where one lap does not', async () => {
    // A ride with a power meter and no strap; the second lap's power dropped out.
    const laps = [stubLap(0, { averagePower: watts(180), maxPower: watts(300) }), stubLap(1)];
    const { headings, rows } = await tableOf(laps);

    expect(headings).toEqual([
      'Lap',
      'Elapsed',
      'Moving',
      'Distance (km)',
      'Avg power (W)',
      'Best power (W)',
      'Avg speed (km/h)',
    ]);
    expect(rows[1]?.slice(4, 6)).toEqual(['—', '—']);
  });

  it('keeps the average power column on a ride whose laps state none, as it always had', async () => {
    const { headings, rows } = await tableOf([stubLap(0)]);

    expect(headings).toContain('Avg power (W)');
    expect(rows[0]?.[4]).toBe('—');
  });

  it('states speed and climb in the rider’s own units', async () => {
    const { headings, rows } = await tableOf([full(0, 700)], 'imperial');

    expect(headings).toContain('Avg speed (mph)');
    expect(headings).toContain('Climb (ft)');
    expect(rows[0]?.[6]).toBe('22.4');
    expect(rows[0]?.[10]).toBe('157');
  });

  it('says which time the averages use', async () => {
    const { text } = await tableOf([full(0, 700)]);

    expect(text).toContain(LAP_TIMES_NOTE);
    expect(LAP_TIMES_NOTE).toContain('moving time');
  });

  it('says a ride has no laps, and draws no table and no note', async () => {
    const { headings, text } = await tableOf([]);

    expect(headings).toEqual([]);
    expect(text).toBe('This ride has no laps recorded.');
  });
});

describe('the laps a ride was saved with are the laps its page lists after a reload — #1312', () => {
  it('reads them back from the store through a fresh handle and renders them', async () => {
    const harness = createStoreHarness();
    try {
      await seedAthletes(harness);
      const ride = activityId('ride-1');
      const started = 1_700_000_000;
      // Twelve seconds at 1 Hz: 200 W for the first lap, 260 W for the second.
      const series = {
        startedAt: unixSeconds(started),
        sampleInterval: seconds(1),
        sampleCount: 12,
        channels: {
          power: Array.from({ length: 12 }, (_unused, index) => watts(index < 6 ? 200 : 260)),
          speed: Array.from({ length: 12 }, () => metresPerSecond(8)),
        },
        pauses: [],
      } as RecordedSeries<StreamChannelValue>;
      const mark = (offset: number) => ({
        at: unixSeconds(started + offset),
        movingTime: seconds(offset),
      });
      const course = { distance: metres(50), ascent: metres(3), partial: false };
      let minted = 0;
      const finished = rideToSave({
        id: ride,
        athleteId: ATHLETE_A,
        series,
        elapsedTime: seconds(12),
        movingTime: seconds(12),
        timeZone: 'Europe/London',
        now: unixSeconds(started + 20),
        laps: {
          ridden: [
            courseLap(series, mark(0), mark(6), course),
            courseLap(series, mark(6), mark(11), course),
            courseLap(series, mark(11), mark(12), {
              ...course,
              distance: metres(8),
              partial: true,
            }),
          ],
          newLapId: () => lapId(`lap-${String((minted += 1))}`),
        },
      });
      await harness.write(async (store) => saveFinishedRide(store, finished));

      const laps = await harness.read(async (store) => store.listLaps(ATHLETE_A, ride));
      const { rows } = await tableOf(laps);

      expect(rows.map((row) => [row[0], row[2], row[4], row[5]])).toEqual([
        ['1', '0:06', '200', '200'],
        ['2 · Best lap', '0:05', '260', '260'],
        ['3 · Part lap', '0:01', '260', '260'],
      ]);
    } finally {
      await harness.destroy();
    }
  });
});
