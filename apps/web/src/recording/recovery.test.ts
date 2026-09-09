// SPDX-License-Identifier: AGPL-3.0-or-later

import { unixSeconds } from '@onyourleft/domain';
import {
  activityId as toActivityId,
  athleteId as toAthleteId,
  recordingSessionId,
  type RecordingSessionRecord,
  type RecordingStoredState,
} from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { formatDuration } from '../format';
import { RECOVERABLE_LIMIT, recoverableRides } from './recovery';

const ATHLETE = toAthleteId('athlete-a');

function row(
  id: string,
  state: RecordingStoredState,
  startedAt: number,
  updatedAt: number,
  savedAs?: string,
): RecordingSessionRecord {
  return {
    ...(savedAs === undefined ? {} : { savedAs: toActivityId(savedAs) }),
    id: recordingSessionId(id),
    athleteId: ATHLETE,
    startedAt: unixSeconds(startedAt),
    sampleInterval: 1 as RecordingSessionRecord['sampleInterval'],
    state,
    updatedAt: unixSeconds(updatedAt),
    pauses: [],
  };
}

describe('the two kinds of leftover are offered different things', () => {
  it('lets a rider continue a ride the tab died in the middle of', () => {
    const [ride] = recoverableRides([row('a', 'recording', 100, 400)]);
    expect(ride?.kind).toBe('interrupted');
    expect(ride?.canContinue).toBe(true);
  });

  it('treats a paused recording as interrupted too', () => {
    // A rider who paused and then closed the tab is in the same position as one
    // who never paused: the ride is unfinished either way.
    expect(recoverableRides([row('a', 'paused', 100, 400)])[0]?.canContinue).toBe(true);
  });

  it('marks a stopped ride that already became an activity, and offers no save', () => {
    // ⚠️ **Found by review.** Without the stored link this row is
    // indistinguishable from the one below, so the screen offered "save" — and
    // pressing it wrote a SECOND copy of the same ride under a fresh activity
    // id with nothing deduplicating it. The two causes of a surviving
    // `stopped` row are a failed save and a failed tidy-up, and only one of
    // them wants saving.
    const [ride] = recoverableRides([row('a', 'stopped', 100, 400, 'ride-7')]);
    expect(ride?.kind).toBe('already-saved');
    expect(ride?.alreadySaved).toBe(true);
    expect(ride?.canContinue).toBe(false);
  });

  it('does NOT offer to continue a ride that was already stopped', () => {
    // ⚠️ A `stopped` row that is still on disk is a ride whose SAVE failed —
    // `finish.ts` keeps the checkpoint deliberately in that case. The rider
    // pressed Stop; offering to restart it would be offering to undo that.
    const [ride] = recoverableRides([row('a', 'stopped', 100, 400)]);
    expect(ride?.kind).toBe('unsaved');
    expect(ride?.canContinue).toBe(false);
    expect(ride?.alreadySaved).toBe(false);
  });
});

describe('what the offer says about a ride', () => {
  it('spans from the start to the last checkpoint', () => {
    const [ride] = recoverableRides([row('a', 'recording', 1000, 1000 + 4320)]);
    expect(ride?.spannedSeconds).toBe(4320);
    // The screen's own formatter, so this cannot pin a second spelling of a
    // duration that the rest of the ride screen writes differently.
    expect(ride?.spanned).toBe(formatDuration(4320));
  });

  it('never reports a negative span when the device clock stepped backwards', () => {
    // A stored `updatedAt` that precedes the start is what an NTP correction
    // mid-ride produces, and the engine counts those rather than passing over
    // them. A negative span would format as a duration nobody can read.
    const [ride] = recoverableRides([row('a', 'recording', 1000, 400)]);
    expect(ride?.spannedSeconds).toBe(0);
  });

  it('offers the most recently written first', () => {
    const rides = recoverableRides([
      row('older', 'recording', 100, 200),
      row('newest', 'recording', 100, 900),
      row('middle', 'recording', 100, 500),
    ]);
    expect(rides.map((ride) => ride.id)).toEqual(['newest', 'middle', 'older']);
  });
});

describe('what is never offered back', () => {
  it('excludes the recording this tab is making right now', () => {
    // ⚠️ The one that matters. A recording in progress has a checkpoint on disk
    // from its first flush, so without this the screen would offer a rider the
    // ride they are in the middle of — and Discard on it would delete the ride
    // they are currently riding.
    const rides = recoverableRides(
      [row('live', 'recording', 100, 400), row('old', 'recording', 10, 40)],
      { excluding: recordingSessionId('live') },
    );
    expect(rides.map((ride) => ride.id)).toEqual(['old']);
  });

  it('bounds a device that has somehow accumulated orphans', () => {
    const many = Array.from({ length: RECOVERABLE_LIMIT + 5 }, (_, index) =>
      row(`ride-${String(index)}`, 'recording', 100, 100 + index),
    );
    expect(recoverableRides(many)).toHaveLength(RECOVERABLE_LIMIT);
  });

  it('keeps the newest when it has to drop some', () => {
    // Dropping from the wrong end would hide the ride a rider actually lost.
    const many = Array.from({ length: RECOVERABLE_LIMIT + 1 }, (_, index) =>
      row(`ride-${String(index)}`, 'recording', 100, 100 + index),
    );
    const kept = recoverableRides(many).map((ride) => ride.id);
    expect(kept).toContain(`ride-${String(RECOVERABLE_LIMIT)}`);
    expect(kept).not.toContain('ride-0');
  });

  it('offers nothing at all when the device is holding nothing', () => {
    expect(recoverableRides([])).toEqual([]);
  });
});
