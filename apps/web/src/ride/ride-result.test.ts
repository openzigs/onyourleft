// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { metres, seconds, watts } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';

import { GAME_OUTCOME_TEXT, rideResultOf, type SavedRide } from './ride-result';

const RIDE: SavedRide = {
  activityId: activityId('a'),
  elapsedTime: seconds(60),
  distance: metres(500),
  averagePower: watts(150),
  averageHeartRate: undefined,
  gameOutcome: undefined,
};

const SAVED = {
  phase: 'stopped',
  stopping: false,
  storage: 'ok',
  saveState: 'saved',
  savedRide: RIDE,
} as const;

describe('rideResultOf — when there is a card at all (#1042)', () => {
  it('is the saved ride once it is stopped, settled, written and saved', () => {
    expect(rideResultOf(SAVED)).toBe(RIDE);
  });

  it.each([
    { phase: 'recording' },
    { phase: 'paused' },
    { phase: 'idle' },
    { stopping: true },
    { storage: 'failed' },
    { storage: 'quota-exceeded' },
    { saveState: 'saving' },
    { saveState: 'failed' },
    { saveState: 'empty' },
    { saveState: 'unavailable' },
    { savedRide: undefined },
  ])('is nothing when %o', (change) => {
    expect(rideResultOf({ ...SAVED, ...change })).toBeUndefined();
  });
});

describe('GAME_OUTCOME_TEXT', () => {
  it('reads three different ways, each about the rider’s best', () => {
    const sentences = Object.values(GAME_OUTCOME_TEXT);
    expect(new Set(sentences).size).toBe(3);
    for (const sentence of sentences) {
      expect(sentence).toContain('your best');
    }
  });
});
