// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride page's workout-block table — #1319.
 *
 * ⚠️ **The last case reads the blocks back from a REAL store, through a fresh
 * handle** (docs/agents/quality-gate.md §5): a ride saved by the path a
 * finished recording takes (`recording/finish.ts`), read by `getActivity` as
 * the page reads it, and rendered by this component.
 */

import {
  beatsPerMinute,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
  type ThresholdShare,
} from '@onyourleft/domain';
import { activityId, type StreamChannelValue, type WorkoutBlockFact } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { rideToSave, saveFinishedRide } from '../recording/finish';
import { mount, queryAll, type Mounted } from '../testing/mount';

import { BLOCK_TIMES_NOTE, WorkoutBlocksTable } from './WorkoutBlocksTable';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function tableOf(blocks: readonly WorkoutBlockFact[]): Promise<{
  readonly headings: string[];
  readonly rows: string[][];
  readonly text: string;
}> {
  mounted = await mount(<WorkoutBlocksTable blocks={blocks} />);
  const container = mounted.container;
  return {
    headings: queryAll<HTMLElement>(container, 'thead th').map((cell) => cell.textContent ?? ''),
    rows: queryAll<HTMLElement>(container, 'tbody tr').map((row) =>
      queryAll<HTMLElement>(row, 'th, td').map((cell) => cell.textContent ?? ''),
    ),
    text: container.textContent ?? '',
  };
}

const share = (value: number): ThresholdShare => value as ThresholdShare;
const WARM_UP = { kind: 'steady', seconds: seconds(600), target: share(0.6) } as const;
const EFFORTS = {
  kind: 'intervals',
  repeats: 4,
  hardSeconds: seconds(180),
  hardTarget: share(1.1),
  easySeconds: seconds(120),
  easyTarget: share(0.5),
} as const;
const COOL_DOWN = { kind: 'free-ride', seconds: seconds(300) } as const;

const ridden = (overrides: Partial<Exclude<WorkoutBlockFact, { outcome: 'skipped' }>> = {}) =>
  ({
    outcome: 'ridden',
    block: WARM_UP,
    startedAt: unixSeconds(1_700_000_000),
    elapsedTime: seconds(610),
    movingTime: seconds(600),
    averagePower: watts(151),
    maxPower: watts(230),
    averageHeartRate: beatsPerMinute(121),
    maxHeartRate: beatsPerMinute(133),
    averageCadence: revolutionsPerMinute(88),
    ...overrides,
  }) as WorkoutBlockFact;

describe('the workout-block table — #1319', () => {
  it('lists one row per block: its target, its times and what was ridden in it', async () => {
    const { headings, rows, text } = await tableOf([ridden()]);
    expect(headings).toEqual([
      'Block',
      'Target',
      'Moving time',
      'Elapsed time',
      'Avg power (W)',
      'Best power (W)',
      'Avg heart rate (bpm)',
      'Highest heart rate (bpm)',
      'Avg cadence (rpm)',
    ]);
    expect(rows).toEqual([
      ['1', '10 min at 60%', '10:00', '10:10', '151', '230', '121', '133', '88'],
    ]);
    expect(text).toContain(BLOCK_TIMES_NOTE);
  });

  it('says a block was cut short, skipped or eased in its own row header, and a skipped block has no figure', async () => {
    const { rows } = await tableOf([
      ridden({ eased: true }),
      ridden({ outcome: 'cut-short', block: EFFORTS, movingTime: seconds(400) }),
      ridden({ outcome: 'cut-short', block: EFFORTS, eased: true }),
      { outcome: 'skipped', block: COOL_DOWN },
    ]);
    expect(rows.map((row) => [row[0], row[1]])).toEqual([
      ['1 · Eased', '10 min at 60%'],
      ['2 · Cut short', '4 × 3 min at 110%, 2 min at 50%'],
      ['3 · Cut short, eased', '4 × 3 min at 110%, 2 min at 50%'],
      ['4 · Skipped', '5 min free riding'],
    ]);
    expect(rows[3]?.slice(2)).toEqual(Array.from({ length: 7 }, () => '—'));
  });

  it('draws a figure’s column only where some block has it, average power always', async () => {
    const bare = ridden({
      averagePower: undefined,
      maxPower: undefined,
      averageHeartRate: undefined,
      maxHeartRate: undefined,
      averageCadence: undefined,
    });
    const { headings, rows } = await tableOf([bare, { outcome: 'skipped', block: COOL_DOWN }]);
    expect(headings).toEqual(['Block', 'Target', 'Moving time', 'Elapsed time', 'Avg power (W)']);
    expect(rows[0]?.[4]).toBe('—');
  });
});

describe('the blocks a ride was saved with are the blocks its page lists after a reload — #1319', () => {
  it('reads them back from the store through a fresh handle and renders them', async () => {
    const harness = createStoreHarness();
    try {
      await seedAthletes(harness);
      const ride = activityId('ride-1');
      const started = 1_700_000_000;
      // Twelve seconds at 1 Hz: 150 W for the warm-up, 300 W after.
      const series = {
        startedAt: unixSeconds(started),
        sampleInterval: seconds(1),
        sampleCount: 12,
        channels: {
          power: Array.from({ length: 12 }, (_unused, index) => watts(index < 6 ? 150 : 300)),
        },
        pauses: [],
      } as RecordedSeries<StreamChannelValue>;
      const mark = (offset: number) => ({
        at: unixSeconds(started + offset),
        movingTime: seconds(offset),
      });
      const finished = rideToSave({
        id: ride,
        athleteId: ATHLETE_A,
        series,
        elapsedTime: seconds(12),
        movingTime: seconds(12),
        timeZone: 'Europe/London',
        now: unixSeconds(started + 20),
        workoutBlocks: [
          { outcome: 'ridden', block: WARM_UP, from: mark(0), to: mark(6) },
          { outcome: 'cut-short', block: EFFORTS, eased: true, from: mark(6), to: mark(12) },
          { outcome: 'skipped', block: COOL_DOWN },
        ],
      });
      await harness.write(async (store) => saveFinishedRide(store, finished));

      const activity = await harness.read(async (store) => store.getActivity(ATHLETE_A, ride));
      const { rows } = await tableOf(activity?.rideFacts?.workoutBlocks ?? []);

      expect(rows.map((row) => [row[0], row[2], row[4], row[5]])).toEqual([
        ['1', '0:06', '150', '150'],
        ['2 · Cut short, eased', '0:06', '300', '300'],
        ['3 · Skipped', '—', '—', '—'],
      ]);
    } finally {
      await harness.destroy();
    }
  });
});
