// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #390's pure decision, with fixtures and no camera.
 *
 * ⚠️ **Every "it pauses nothing" below is asserted as `unknown` or `present`,
 * never as "not absent"** — the three states are the point, and a test that
 * only ruled out `absent` would pass against a decision that collapsed the
 * other two.
 */

import { describe, expect, it } from 'vitest';

import {
  lumaGrid,
  nextPresence,
  observePair,
  PRESENCE_ABSENCE_MILLISECONDS,
  PRESENCE_BRIGHT_MEAN,
  PRESENCE_CHECK_MILLISECONDS,
  PRESENCE_DARK_MEAN,
  PRESENCE_MOTION_CELLS,
  PRESENCE_NOT_OBSERVED,
  PRESENCE_PAIR_GAP_MILLISECONDS,
  PRESENCE_STALE_MILLISECONDS,
  presenceAt,
  presenceSentence,
  type PresenceObservation,
  type PresenceTracker,
} from './presence';
import { stillRoom } from './testing';
import type { LuminanceGrid } from './camera-port';

/** A uniform grid, every cell `level`. */
function uniform(level: number): LuminanceGrid {
  return { columns: 32, rows: 24, values: new Uint8Array(32 * 24).fill(level) };
}

/** Feeds observations one check apart, from `start`, and returns the tracker. */
function feed(
  observations: readonly PresenceObservation[],
  start = 0,
  from: PresenceTracker = PRESENCE_NOT_OBSERVED,
): PresenceTracker {
  let tracker = from;
  observations.forEach((observation, index) => {
    tracker = nextPresence(tracker, observation, start + index * PRESENCE_CHECK_MILLISECONDS);
  });
  return tracker;
}

/** How many checks a run of stillness needs before it counts. */
const CHECKS_TO_ABSENCE =
  Math.ceil(PRESENCE_ABSENCE_MILLISECONDS / PRESENCE_CHECK_MILLISECONDS) + 1;

describe('observing a pair of grids', () => {
  it('reads a room in which nothing moved as still', () => {
    expect(observePair(stillRoom(), stillRoom())).toBe('still');
  });

  it('reads a few cells moving as motion', () => {
    expect(observePair(stillRoom(), stillRoom({ moved: PRESENCE_MOTION_CELLS }))).toBe('motion');
  });

  it('does not read one fewer than the bar as motion', () => {
    // The bar, held from both sides: `>=` against `>` is the mutation this
    // pins, and it is the difference between a curtain and a leg.
    expect(observePair(stillRoom(), stillRoom({ moved: PRESENCE_MOTION_CELLS - 1 }))).toBe('still');
  });

  it('reads a room gone dark as unreadable, not as still and not as motion', () => {
    // The light switched off between the two samples: every cell changed.
    expect(observePair(stillRoom(), uniform(PRESENCE_DARK_MEAN - 5))).toBe('unreadable');
    expect(observePair(uniform(5), uniform(5))).toBe('unreadable');
  });

  it('reads a washed-out picture as unreadable', () => {
    expect(observePair(uniform(PRESENCE_BRIGHT_MEAN + 5), uniform(PRESENCE_BRIGHT_MEAN + 5))).toBe(
      'unreadable',
    );
  });

  it('reads a featureless wall as unreadable rather than as an empty room', () => {
    // Mid-grey everywhere: bright enough, and nothing in it could be seen move.
    expect(observePair(uniform(128), uniform(128))).toBe('unreadable');
  });

  it('reads a pair of one frame as unreadable, never as still — #516', () => {
    // A <video> whose source stopped delivering frames draws its last one
    // again: the same picture of a lit room, twice.
    const frozen = { ...stillRoom(), frame: 41 };
    expect(observePair(frozen, frozen)).toBe('unreadable');
    // Nor a second grid from BEHIND the first, which a restarted element is.
    expect(observePair({ ...stillRoom(), frame: 41 }, { ...stillRoom(), frame: 40 })).toBe(
      'unreadable',
    );
    // The control: the same pictures, one frame apart, are a still room.
    expect(observePair({ ...stillRoom(), frame: 41 }, { ...stillRoom(), frame: 42 })).toBe('still');
    // And a platform that cannot say where the video had got infers nothing.
    expect(observePair({ ...stillRoom(), frame: 41 }, stillRoom())).toBe('still');
  });

  it('reads two grids of different sizes as unreadable', () => {
    const small: LuminanceGrid = { columns: 2, rows: 2, values: new Uint8Array([90, 30, 200, 60]) };
    expect(observePair(stillRoom(), small)).toBe('unreadable');
  });
});

describe('the three-state decision', () => {
  it('starts as unknown', () => {
    expect(presenceAt(PRESENCE_NOT_OBSERVED, 0)).toBe('unknown');
  });

  it('is present the moment something moves', () => {
    expect(feed(['motion']).presence).toBe('present');
  });

  it('becomes absent only after the stated interval of unbroken stillness', () => {
    const almost = feed([
      'motion',
      ...Array<PresenceObservation>(CHECKS_TO_ABSENCE - 1).fill('still'),
    ]);
    const stillFor = (almost.observedAt ?? 0) - (almost.stillSince ?? 0);
    expect(stillFor).toBeLessThan(PRESENCE_ABSENCE_MILLISECONDS);
    // A rider reaching for a bottle, towelling off: still `present`.
    expect(almost.presence).toBe('present');

    const enough = nextPresence(
      almost,
      'still',
      (almost.stillSince ?? 0) + PRESENCE_ABSENCE_MILLISECONDS,
    );
    expect(enough.presence).toBe('absent');
  });

  it('breaks the run of stillness on one movement', () => {
    const tracker = feed([
      ...Array<PresenceObservation>(CHECKS_TO_ABSENCE - 2).fill('still'),
      'motion',
      ...Array<PresenceObservation>(CHECKS_TO_ABSENCE - 2).fill('still'),
    ]);
    expect(tracker.presence).toBe('present');
  });

  it('breaks the run of stillness on an unreadable picture, and says unknown', () => {
    const tracker = feed([
      'motion',
      ...Array<PresenceObservation>(CHECKS_TO_ABSENCE - 2).fill('still'),
      'unreadable',
      ...Array<PresenceObservation>(CHECKS_TO_ABSENCE - 2).fill('still'),
    ]);
    // A dark minute in the middle of a still one is not a still minute — and
    // with the run broken and nothing seen move since, it cannot be `present`
    // either.
    expect(tracker.presence).toBe('unknown');
  });

  it('never calls a room that went dark absent, however long it stays dark', () => {
    const tracker = feed(['motion', ...Array<PresenceObservation>(60).fill('unreadable')]);
    expect(tracker.presence).toBe('unknown');
  });

  it('is unknown, not absent, when stillness follows a gap in the checks', () => {
    const before = feed(['motion']);
    // The watch stopped and came back: nothing carries forward across a gap.
    const after = nextPresence(before, 'still', PRESENCE_STALE_MILLISECONDS * 4);
    expect(after.presence).toBe('unknown');
    expect(after.stillSince).toBe(PRESENCE_STALE_MILLISECONDS * 4);
  });

  it('returns to present when the rider comes back', () => {
    const gone = feed(Array<PresenceObservation>(CHECKS_TO_ABSENCE + 2).fill('still'));
    expect(gone.presence).toBe('absent');
    const back = nextPresence(gone, 'motion', (gone.observedAt ?? 0) + PRESENCE_CHECK_MILLISECONDS);
    expect(back.presence).toBe('present');
  });
});

describe('a stale answer is no answer', () => {
  it('reads an old absent as unknown', () => {
    const gone = feed(Array<PresenceObservation>(CHECKS_TO_ABSENCE + 2).fill('still'));
    const at = gone.observedAt ?? 0;
    expect(presenceAt(gone, at)).toBe('absent');
    expect(presenceAt(gone, at + PRESENCE_STALE_MILLISECONDS)).toBe('absent');
    // One millisecond past the deadline. Without it a camera that stopped
    // being sampled would go on pausing a ride with a room it cannot see.
    expect(presenceAt(gone, at + PRESENCE_STALE_MILLISECONDS + 1)).toBe('unknown');
  });
});

describe('the boolean is all that is derived', () => {
  it('keeps three primitives between checks, and no grid, frame or count of anything', () => {
    const tracker = feed(['motion', 'still', 'unreadable', 'still']);
    expect(Object.keys(tracker).sort()).toStrictEqual(['observedAt', 'presence', 'stillSince']);
    for (const value of Object.values(tracker)) {
      expect(['string', 'number', 'undefined']).toContain(typeof value);
    }
    expect(['present', 'absent', 'unknown']).toContain(tracker.presence);
  });

  it('answers an observation with a word, not a measurement', () => {
    const observed = observePair(stillRoom(), stillRoom({ moved: 20 }));
    expect(typeof observed).toBe('string');
  });
});

describe('the stated rate and interval', () => {
  it('checks at a low rate, in seconds rather than frames', () => {
    expect(PRESENCE_CHECK_MILLISECONDS).toBeGreaterThanOrEqual(1000);
  });

  it('takes the pair close enough together that no pedalling cadence aliases', () => {
    // A cadence at which one revolution fits exactly in the gap would read as
    // "nothing moved". 400 rpm is the lowest, and nobody pedals it.
    const aliasingRpm = 60_000 / PRESENCE_PAIR_GAP_MILLISECONDS;
    expect(aliasingRpm).toBeGreaterThan(250);
  });

  it('makes absence last longer than a rider reaching for a bottle', () => {
    expect(PRESENCE_ABSENCE_MILLISECONDS).toBeGreaterThanOrEqual(10_000);
    expect(PRESENCE_STALE_MILLISECONDS).toBeGreaterThan(PRESENCE_CHECK_MILLISECONDS);
  });
});

describe('the RGBA conversion', () => {
  it('turns pixels into luma, cell by cell', () => {
    const white = [255, 255, 255, 255];
    const black = [0, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const grid = lumaGrid([...white, ...black, ...green, ...black], 2, 2);
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(2);
    expect([...grid.values]).toStrictEqual([255, 0, 182, 0]);
  });

  it('refuses a buffer that is not the size it was asked for', () => {
    expect(() => lumaGrid([0, 0, 0, 255], 2, 2)).toThrow(RangeError);
  });
});

describe('what the Camera screen says', () => {
  it('tells a rider that unknown does not pause their ride', () => {
    expect(presenceSentence('unknown')).toMatch(/will not pause/);
    expect(presenceSentence('absent')).toMatch(/pause/);
    expect(presenceSentence('present')).not.toMatch(/pause/);
  });

  it('does not promise a pause when nothing may be recording — #516', () => {
    // The screen does not know whether a ride is recording, so the sentence
    // may not assert that "your ride" exists.
    expect(presenceSentence('absent')).not.toMatch(/your ride will pause/i);
    expect(presenceSentence('absent')).toMatch(/if a ride is recording/i);
  });

  it('does not say "yet" of a check the quality ladder has taken away — #516', () => {
    const throttled = presenceSentence('unknown', false);
    expect(throttled).not.toMatch(/\byet\b/);
    expect(throttled).toMatch(/stopped/);
    expect(throttled).toMatch(/will not pause/);
    // The control: while the ladder allows it, "yet" is still the truth.
    expect(presenceSentence('unknown', true)).toMatch(/\byet\b/);
    expect(presenceSentence('unknown')).toBe(presenceSentence('unknown', true));
  });
});
