// SPDX-License-Identifier: AGPL-3.0-or-later

import { seconds, thresholdShare, unixSeconds, type Workout } from '@onyourleft/domain';
import {
  athleteId,
  workoutId,
  type AthleteId,
  type WorkoutGoalsRead,
  type WorkoutRecord,
} from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { WORKOUT_LIST_LIMIT } from '../workouts/store-port';

import { createReplanPort } from './replan-port';

const OWNER = athleteId('athlete-a');

const WORKOUT: Workout = {
  name: 'Tempo',
  blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.7) }],
};

const saved = (id: string): WorkoutRecord => ({
  id: workoutId(id),
  createdBy: OWNER,
  name: 'Tempo',
  workout: WORKOUT,
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
});

function portOver(goals: WorkoutGoalsRead, workouts: readonly WorkoutRecord[] = []) {
  const asked: { readonly what: string; readonly owner: AthleteId; readonly limit?: number }[] = [];
  let connected = false;
  const port = createReplanPort({
    store: {
      getWorkoutGoals: (owner) => {
        asked.push({ what: 'goals', owner });
        return Promise.resolve(goals);
      },
      listWorkouts: (owner, limit) => {
        asked.push({ what: 'workouts', owner, ...(limit === undefined ? {} : { limit }) });
        return Promise.resolve([...workouts]);
      },
    },
    athleteId: OWNER,
    connected: () => connected,
    session: () => Promise.resolve({ kind: 'closed', text: 'Signed out.' }),
  });
  return {
    port,
    asked,
    connect: () => {
      connected = true;
    },
  };
}

describe('the production re-plan port — #1244', () => {
  it('reads the rider’s goals as they are kept, naming the athlete', async () => {
    const { port, asked } = portOver({
      status: 'kept',
      record: { athleteId: OWNER, goals: { durationMinutes: 60 }, savedAt: unixSeconds(5) },
    });
    expect(await port.replanGoals()).toEqual({ durationMinutes: 60 });
    expect(asked).toEqual([{ what: 'goals', owner: OWNER }]);
  });

  it('reads no saved goals as no goals, never as a default', async () => {
    expect(await portOver({ status: 'none' }).port.replanGoals()).toEqual({});
  });

  it('reads a row that is not goals as unreadable, with none of it', async () => {
    const { port } = portOver({ status: 'fault', fault: 'workoutGoals: must be a row of goals' });
    expect(await port.replanGoals()).toBe('unreadable');
  });

  it('lists the rider’s own saved workouts by the id they are synced under, bounded', async () => {
    const { port, asked } = portOver({ status: 'none' }, [saved('workout-1'), saved('workout-2')]);
    expect(await port.replanLibrary()).toEqual([
      { id: 'workout-1', workout: WORKOUT },
      { id: 'workout-2', workout: WORKOUT },
    ]);
    expect(asked).toEqual([{ what: 'workouts', owner: OWNER, limit: WORKOUT_LIST_LIMIT }]);
  });

  it('says whether the device is signed in each time it is asked', () => {
    const { port, connect } = portOver({ status: 'none' });
    expect(port.replanConnected()).toBe(false);
    connect();
    expect(port.replanConnected()).toBe(true);
  });

  it('hands on the session it is given', async () => {
    expect(await portOver({ status: 'none' }).port.replanSession()).toEqual({
      kind: 'closed',
      text: 'Signed out.',
    });
  });
});
