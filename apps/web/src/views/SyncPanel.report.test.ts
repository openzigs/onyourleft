// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the last sync did, in lines — the saved workouts' share of it (#1100).
 * A sync that only sent a workout must not say everything was already in sync.
 */

import { describe, expect, it } from 'vitest';

import type { SyncReport } from '../instance/sync';
import { syncReportLines, WORKOUT_GOALS_SYNCED_TEXT } from './SyncPanel';

const NOTHING: SyncReport = {
  pulled: 0,
  pushed: 0,
  itemsPulled: 0,
  itemsPushed: 0,
  summariesPushed: 0,
  deletedOnInstance: 0,
  hiddenOnInstance: 0,
  consentsPushed: 0,
  consentsPulled: 0,
  textsPulled: 0,
  textsPushed: 0,
  textsHiddenOnInstance: 0,
  textsDeletedOnInstance: 0,
  textConflicts: 0,
  workoutsPushed: 0,
  workoutsPulled: 0,
  workoutsDeletedOnInstance: 0,
  workoutsHiddenOnInstance: 0,
  workoutGoalsPushed: 0,
  workoutGoalsPulled: 0,
  workoutGoalsDeletedOnInstance: 0,
  workoutGoalsHiddenOnInstance: 0,
  keysToConfirm: [],
  failures: [],
};

describe('the sync report’s lines for saved workouts (#1100)', () => {
  it('says nothing moved only when nothing did', () => {
    expect(syncReportLines(NOTHING)).toStrictEqual(['Everything was already in sync.']);
  });

  it('says how many saved workouts were sent', () => {
    expect(syncReportLines({ ...NOTHING, workoutsPushed: 1 })).toStrictEqual([
      'Sent 1 saved workout.',
    ]);
    expect(syncReportLines({ ...NOTHING, workoutsPushed: 3 })).toStrictEqual([
      'Sent 3 saved workouts.',
    ]);
  });

  it('says how many saved workouts were brought back, as the ride lines do', () => {
    expect(syncReportLines({ ...NOTHING, workoutsPulled: 1 })).toStrictEqual([
      'Brought back 1 saved workout.',
    ]);
    expect(syncReportLines({ ...NOTHING, workoutsPulled: 4 })).toStrictEqual([
      'Brought back 4 saved workouts.',
    ]);
    expect(syncReportLines({ ...NOTHING, pulled: 2, workoutsPulled: 2 })).toStrictEqual([
      'Brought back 2 rides.',
      'Brought back 2 saved workouts.',
    ]);
  });

  it('counts a workout deleted, or kept, with the other things', () => {
    expect(
      syncReportLines({ ...NOTHING, textsDeletedOnInstance: 1, workoutsDeletedOnInstance: 1 }),
    ).toStrictEqual(['Deleted 2 things on the instance that you deleted here.']);
    expect(syncReportLines({ ...NOTHING, workoutsHiddenOnInstance: 1 })).toStrictEqual([
      'Another device deleted 1 thing you still have here. It stays on this device.',
    ]);
  });

  it('says the typed workout goals were synced, either way (#1237)', () => {
    expect(syncReportLines({ ...NOTHING, workoutGoalsPushed: 1 })).toStrictEqual([
      WORKOUT_GOALS_SYNCED_TEXT,
    ]);
    expect(syncReportLines({ ...NOTHING, workoutGoalsPulled: 1 })).toStrictEqual([
      WORKOUT_GOALS_SYNCED_TEXT,
    ]);
  });

  it('counts the typed workout goals deleted, or kept, with the other things (#1237)', () => {
    expect(
      syncReportLines({
        ...NOTHING,
        workoutsDeletedOnInstance: 1,
        workoutGoalsDeletedOnInstance: 1,
      }),
    ).toStrictEqual(['Deleted 2 things on the instance that you deleted here.']);
    expect(syncReportLines({ ...NOTHING, workoutGoalsHiddenOnInstance: 1 })).toStrictEqual([
      'Another device deleted 1 thing you still have here. It stays on this device.',
    ]);
  });
});
