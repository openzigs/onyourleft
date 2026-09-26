// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  CADENCE_SILENT_REASON,
  RECOVERING_REASON,
  RELIEF_SHARE,
  TREND_WINDOW,
  type WorkoutRescue,
} from '@onyourleft/domain';

import { workoutRescueText } from './rescue-text';

const FLOOR: WorkoutRescue = { kind: 'floor', reason: CADENCE_SILENT_REASON };
const RELIEF: WorkoutRescue = { kind: 'relief', share: RELIEF_SHARE, reason: RECOVERING_REASON };

describe('what a rider is told while a workout’s target is eased — #585', () => {
  it('opens with the rescue’s own fixed sentence, unchanged', () => {
    expect(workoutRescueText(FLOOR, 'ride-screen').startsWith(CADENCE_SILENT_REASON)).toBe(true);
    expect(workoutRescueText(RELIEF, 'game').startsWith(RECOVERING_REASON)).toBe(true);
  });

  it('says the two-step way back from the floor, and only from the floor', () => {
    expect(workoutRescueText(FLOOR, 'ride-screen')).toContain('lighter target first');
    expect(workoutRescueText(RELIEF, 'ride-screen')).not.toContain('lighter target first');
  });

  it('says the target comes back by itself, after the detector’s own window', () => {
    expect(workoutRescueText(RELIEF, 'ride-screen')).toContain(
      `held steady for ${String(TREND_WINDOW)} seconds`,
    );
  });

  it('says how to leave it, in the words of the screen it is on', () => {
    expect(workoutRescueText(RELIEF, 'ride-screen')).toMatch(/Press End workout to leave it\.$/);
    expect(workoutRescueText(RELIEF, 'game')).toMatch(
      /End the workout on the Ride screen to leave it\.$/,
    );
  });
});
