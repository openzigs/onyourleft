// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two questions #93 left open, and the answers this branch gives them.
 */

import { describe, expect, it } from 'vitest';

import { GameError } from './errors';
import {
  GHOST_GAP_TOLERANCE_SECONDS,
  fastestAttempt,
  ghostFromSpeed,
  type StoredAttempt,
} from './ghost-source';
import { ghostDistanceAt } from '@onyourleft/domain';
import { seconds } from '@onyourleft/domain';

describe('which attempt a rider races', () => {
  it('picks the fastest, not the most recent', () => {
    // The decision, asserted. Racing the most recent means racing a recovery
    // ride about a third of the time.
    //
    // ⚠️ The quickest attempt is deliberately NEITHER first NOR last in this
    // array. It was first in the version of this test written alongside the
    // implementation, and the mutation that replaced "the fastest" with "the
    // first" came back GREEN — the two answers agreed on that fixture, so the
    // test asserted nothing about the choice it is named for. `listRouteAttempts`
    // returns newest first, so "first" is the plausible wrong answer and has to
    // be a different id from the right one.
    const best = fastestAttempt([
      { id: 'most-recent', movingSeconds: 1_100 },
      { id: 'the-good-one', movingSeconds: 900 },
      { id: 'a-recovery-lap', movingSeconds: 1_500 },
    ]);

    expect(best?.id).toBe('the-good-one');
  });

  it('picks the fastest when it is last, too', () => {
    // The mirror of the case above, so neither "take the first" nor "take the
    // last" survives.
    const best = fastestAttempt([
      { id: 'a-recovery-lap', movingSeconds: 1_500 },
      { id: 'most-recent', movingSeconds: 1_100 },
      { id: 'the-good-one', movingSeconds: 800 },
    ]);

    expect(best?.id).toBe('the-good-one');
  });

  it('ranks on moving time rather than elapsed', () => {
    // A rider who stopped at a level crossing on their quickest lap did not ride
    // a slower lap. This is the opposite of `segment/effort.ts`'s basis, and
    // `ghost-source.ts` records why: there is nobody to cheat here.
    const best = fastestAttempt([
      { id: 'stopped-at-a-crossing', movingSeconds: 800 },
      { id: 'never-stopped', movingSeconds: 850 },
    ]);

    expect(best?.id).toBe('stopped-at-a-crossing');
  });

  it('breaks a tie stably, on the earlier entry', () => {
    const best = fastestAttempt([
      { id: 'first', movingSeconds: 600 },
      { id: 'second', movingSeconds: 600 },
    ]);

    expect(best?.id).toBe('first');
  });

  it('offers nothing when the rider has never ridden the route', () => {
    expect(fastestAttempt([])).toBeUndefined();
  });
});

describe('integrating a recorded speed into a ghost', () => {
  it('turns a steady 10 m/s into 10 m per second', () => {
    const attempt: StoredAttempt = {
      sampleIntervalSeconds: 1,
      speed: Array.from({ length: 60 }, () => 10),
    };

    const track = ghostFromSpeed(attempt);

    expect(ghostDistanceAt(track, seconds(10))).toBeCloseTo(110, 6);
    expect(track.totalTime).toBe(59);
  });

  it('follows a ride that changes pace', () => {
    const attempt: StoredAttempt = {
      // 10 s at 5 m/s, then 10 s at 15 m/s.
      sampleIntervalSeconds: 1,
      speed: [...Array.from({ length: 10 }, () => 5), ...Array.from({ length: 10 }, () => 15)],
    };

    const track = ghostFromSpeed(attempt);

    // The second half covers three times the ground of the first.
    const half = ghostDistanceAt(track, seconds(9));
    const whole = ghostDistanceAt(track, seconds(19));
    expect(whole - half).toBeGreaterThan(half * 2);
  });

  it('honours a sample interval other than one second', () => {
    const attempt: StoredAttempt = {
      sampleIntervalSeconds: 4,
      speed: Array.from({ length: 10 }, () => 10),
    };

    const track = ghostFromSpeed(attempt);

    // Ten samples four seconds apart is 36 s of riding, not 9.
    expect(track.totalTime).toBe(36);
    expect(track.totalDistance).toBeCloseTo(400, 6);
  });
});

describe('a hole in the recording', () => {
  it('bridges a gap short enough to be ordinary jitter', () => {
    const speed: (number | undefined)[] = Array.from({ length: 30 }, () => 10);
    speed[10] = undefined;
    speed[11] = undefined;

    expect(() => ghostFromSpeed({ sampleIntervalSeconds: 1, speed })).not.toThrow();
  });

  it('refuses a gap long enough to hide real ground', () => {
    // Carrying the last known speed across a two-minute dropout would invent a
    // distance the rider may never have covered.
    const speed: (number | undefined)[] = Array.from({ length: 200 }, () => 10);
    for (let index = 50; index < 170; index += 1) {
      speed[index] = undefined;
    }

    try {
      ghostFromSpeed({ sampleIntervalSeconds: 1, speed });
      expect.unreachable('a long dropout must be refused');
    } catch (error) {
      expect((error as GameError).code).toBe('ghost-unusable');
      expect((error as GameError).message).toContain(String(GHOST_GAP_TOLERANCE_SECONDS));
    }
  });

  it('measures the tolerance in seconds, not in samples', () => {
    // At 4 s per sample, two missing samples is eight seconds — over the bound —
    // where at 1 Hz two missing samples is fine. A tolerance counted in samples
    // would get one of these wrong.
    const speed: (number | undefined)[] = Array.from({ length: 20 }, () => 10);
    speed[5] = undefined;
    speed[6] = undefined;

    expect(() => ghostFromSpeed({ sampleIntervalSeconds: 1, speed })).not.toThrow();
    expect(() => ghostFromSpeed({ sampleIntervalSeconds: 4, speed })).toThrow(GameError);
  });

  it('refuses a negative speed rather than reversing the ghost', () => {
    const speed: (number | undefined)[] = Array.from({ length: 20 }, () => 10);
    for (let index = 4; index < 12; index += 1) {
      speed[index] = -5;
    }

    expect(() => ghostFromSpeed({ sampleIntervalSeconds: 1, speed })).toThrow(GameError);
  });

  it('refuses a ride with no sample interval', () => {
    expect(() => ghostFromSpeed({ sampleIntervalSeconds: 0, speed: [1, 2] })).toThrow(GameError);
  });

  it('refuses a ride too short to interpolate across', () => {
    expect(() => ghostFromSpeed({ sampleIntervalSeconds: 1, speed: [10] })).toThrow(GameError);
  });
});
