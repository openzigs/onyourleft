// SPDX-License-Identifier: Apache-2.0

/**
 * #93's second acceptance criterion, and the refusals around it.
 *
 * > *"The ghost's position comes from the stored activity's recorded
 * > position-versus-distance; a test asserts a replay reproduces the original
 * > ride's position at a given distance within tolerance."*
 *
 * The round trip in "reproduces" is the point: the samples go in, and asking the
 * track at each sample's own time must give that sample's own distance back. A
 * test that only checked interpolation between two hand-written points would
 * pass against a replay that had quietly rescaled the whole ride.
 */

import { describe, expect, it } from 'vitest';

import { GhostError } from './errors';
import {
  buildGhostTrack,
  ghostDistanceAt,
  ghostElapsedAt,
  ghostHasFinished,
  type GhostSamples,
} from './replay';
import { pacerGap } from '../pacer/gap';
import { metres, metresPerSecond, seconds } from '../quantities';

/**
 * A recorded attempt that is not at constant speed — the rider starts, settles,
 * slows on a climb, stops at a junction, and finishes.
 *
 * Deliberately irregular. A constant-speed fixture makes interpolation, holding
 * the previous sample, and returning `time * averageSpeed` all agree, so it
 * cannot tell a correct replay from two wrong ones.
 */
const ATTEMPT: GhostSamples = {
  elapsedSeconds: [0, 10, 20, 30, 40, 50, 60, 70],
  //              accelerating | steady | climbing | stopped | finishing
  distanceMetres: [0, 40, 130, 230, 300, 340, 340, 400],
};

describe('replaying an attempt reproduces what the rider actually did', () => {
  it('gives back each recorded distance at that sample’s own time', () => {
    const track = buildGhostTrack(ATTEMPT);

    for (let index = 0; index < ATTEMPT.elapsedSeconds.length; index += 1) {
      const at = seconds(ATTEMPT.elapsedSeconds[index] as number);
      expect(ghostDistanceAt(track, at)).toBeCloseTo(
        ATTEMPT.distanceMetres[index] as number,
        // Exact in principle; a tolerance because the lookup interpolates in
        // floating point and #93 asks for "within tolerance" rather than
        // bit-equality.
        9,
      );
    }
  });

  it('interpolates between samples rather than holding the previous one', () => {
    const track = buildGhostTrack(ATTEMPT);

    // Halfway through the 10 s → 20 s pair, which covered 40 m → 130 m.
    expect(ghostDistanceAt(track, seconds(15))).toBeCloseTo(85, 9);
    // Holding would give 40; the average speed over the whole ride would give
    // about 85.7. Both are wrong and only one of them is close, which is why
    // this fixture is not at constant speed.
    expect(ghostDistanceAt(track, seconds(15))).not.toBeCloseTo(40, 1);
  });

  it('keeps the ghost still while the rider was stopped', () => {
    const track = buildGhostTrack(ATTEMPT);

    // 50 s → 60 s covers no ground at all.
    expect(ghostDistanceAt(track, seconds(53))).toBeCloseTo(340, 9);
    expect(ghostDistanceAt(track, seconds(57))).toBeCloseTo(340, 9);
  });

  it('sits on the line before the start rather than somewhere behind it', () => {
    const track = buildGhostTrack(ATTEMPT);

    expect(ghostDistanceAt(track, seconds(0))).toBe(0);
  });

  it('stops at the finish instead of riding on forever', () => {
    const track = buildGhostTrack(ATTEMPT);

    expect(ghostDistanceAt(track, seconds(70))).toBeCloseTo(400, 9);
    expect(ghostDistanceAt(track, seconds(700))).toBeCloseTo(400, 9);
    expect(ghostHasFinished(track, seconds(69))).toBe(false);
    expect(ghostHasFinished(track, seconds(70))).toBe(true);
  });

  it('reports the attempt’s totals', () => {
    const track = buildGhostTrack(ATTEMPT);

    expect(track.totalDistance).toBe(400);
    expect(track.totalTime).toBe(70);
  });
});

describe('the inverse lookup — when was the ghost here', () => {
  it('finds the time at a distance between samples', () => {
    const track = buildGhostTrack(ATTEMPT);

    // 40 m → 130 m over 10 s → 20 s; 85 m is halfway.
    expect(ghostElapsedAt(track, metres(85))).toBeCloseTo(15, 9);
  });

  it('gives the earliest moment the rider reached a distance they then sat at', () => {
    const track = buildGhostTrack(ATTEMPT);

    // The rider was at 340 m from 50 s to 60 s. "When were they here" is 50.
    expect(ghostElapsedAt(track, metres(340))).toBeCloseTo(50, 9);
  });

  it('refuses to extrapolate past a distance the attempt never reached', () => {
    const track = buildGhostTrack(ATTEMPT);

    // Not `undefined` because the lookup failed — because the ghost never got
    // there, and inventing a time would invent a result.
    expect(ghostElapsedAt(track, metres(401))).toBeUndefined();
    expect(ghostElapsedAt(track, metres(400))).toBeCloseTo(70, 9);
  });
});

describe('the gap to a ghost is the bot’s gap, unchanged', () => {
  it('reuses pacerGap rather than computing its own distance ÷ speed', () => {
    const track = buildGhostTrack(ATTEMPT);
    const ghostDistance = ghostDistanceAt(track, seconds(20));

    const gap = pacerGap({
      botDistance: ghostDistance,
      riderDistance: metres(100),
      referenceSpeed: metresPerSecond(10),
    });

    // The ghost was at 130 m, the rider is at 100 m: 30 m and 3 s down.
    expect(gap.metres).toBeCloseTo(30, 9);
    expect(gap.seconds).toBeCloseTo(3, 9);
  });

  it('reports a rider who is winning as a negative gap', () => {
    const track = buildGhostTrack(ATTEMPT);

    const gap = pacerGap({
      botDistance: ghostDistanceAt(track, seconds(20)),
      riderDistance: metres(200),
      referenceSpeed: metresPerSecond(10),
    });

    expect(gap.metres).toBeLessThan(0);
  });
});

describe('a recording that cannot be a ghost is refused, not repaired', () => {
  it('refuses a ride with fewer than two samples', () => {
    expect(() => buildGhostTrack({ elapsedSeconds: [0], distanceMetres: [0] })).toThrow(GhostError);
    try {
      buildGhostTrack({ elapsedSeconds: [], distanceMetres: [] });
    } catch (error) {
      expect((error as GhostError).code).toBe('too-few-samples');
    }
  });

  it('refuses mismatched series lengths', () => {
    try {
      buildGhostTrack({ elapsedSeconds: [0, 1, 2], distanceMetres: [0, 1] });
      expect.unreachable('a mismatch must be refused');
    } catch (error) {
      expect((error as GhostError).code).toBe('length-mismatch');
    }
  });

  it('refuses a distance that goes backwards rather than clamping it', () => {
    // A bad GPS fix mid-ride. Clamping would put the ghost somewhere the rider
    // was never at, which is the fabrication `errors.ts` refuses.
    try {
      buildGhostTrack({ elapsedSeconds: [0, 10, 20], distanceMetres: [0, 100, 90] });
      expect.unreachable('a backwards distance must be refused');
    } catch (error) {
      expect((error as GhostError).code).toBe('distance-not-monotonic');
    }
  });

  it('accepts a distance that stands still, which is only a stopped rider', () => {
    expect(() =>
      buildGhostTrack({ elapsedSeconds: [0, 10, 20], distanceMetres: [0, 100, 100] }),
    ).not.toThrow();
  });

  it('refuses a time that does not advance, because the lookup would be ambiguous', () => {
    try {
      buildGhostTrack({ elapsedSeconds: [0, 10, 10], distanceMetres: [0, 100, 110] });
      expect.unreachable('a repeated timestamp must be refused');
    } catch (error) {
      expect((error as GhostError).code).toBe('time-not-increasing');
    }
  });

  it('refuses a non-finite sample', () => {
    try {
      buildGhostTrack({ elapsedSeconds: [0, 10], distanceMetres: [0, Number.NaN] });
      expect.unreachable('NaN must be refused');
    } catch (error) {
      expect((error as GhostError).code).toBe('sample-not-finite');
    }
  });
});

describe('the lookup holds up over a long attempt', () => {
  /**
   * The binary search exists because a two-hour ride at 1 Hz is 7 200 samples
   * and the lookup runs every frame. A linear scan would be correct and would
   * also be 7 200 comparisons per frame at 30 fps.
   */
  const LONG: GhostSamples = {
    elapsedSeconds: Array.from({ length: 7_200 }, (_, index) => index),
    distanceMetres: Array.from({ length: 7_200 }, (_, index) => index * 8),
  };

  it('finds every sample it was built from', () => {
    const track = buildGhostTrack(LONG);

    for (let index = 0; index < 7_200; index += 617) {
      expect(ghostDistanceAt(track, seconds(index))).toBeCloseTo(index * 8, 6);
    }
  });

  it('interpolates inside the last pair as well as the first', () => {
    const track = buildGhostTrack(LONG);

    expect(ghostDistanceAt(track, seconds(0.5))).toBeCloseTo(4, 6);
    expect(ghostDistanceAt(track, seconds(7_198.5))).toBeCloseTo(7_198.5 * 8, 6);
  });
});
