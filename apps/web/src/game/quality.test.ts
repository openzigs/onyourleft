// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #91's fourth acceptance criterion: *"a test asserts the reduction path is
 * exercised"*.
 *
 * The reduction path is code that only runs on a hot phone. Nothing in this
 * repository's environment can produce one — jsdom has no thermal API and the CI
 * runner has no thermal state worth reading — so the only way that criterion is
 * dischargeable at all is for the policy to be a pure function that can be
 * handed a hot measurement. That is what this file does.
 *
 * ⚠️ What it does **not** discharge is #91's third criterion, the 60-minute
 * measured run on the device floor. No test can: that needs the hardware. It is
 * recorded as outstanding in `apps/web/src/game/README.md` and in the pull
 * request rather than quietly counted as covered here.
 */

import { describe, expect, it } from 'vitest';

import {
  FRAME_MS_REDUCE_ABOVE,
  HEADROOM_REDUCE_ABOVE,
  HEADROOM_RESTORE_BELOW,
  INITIAL_QUALITY,
  QUALITY_LADDER,
  SUSTAINED_SAMPLES,
  nextQuality,
  qualitySettings,
  type QualitySample,
  type QualityState,
} from './quality';

/** Feeds the same measurement `count` times, as a sustained condition would. */
function sustain(state: QualityState, sample: QualitySample, count: number): QualityState {
  let current = state;
  for (let index = 0; index < count; index += 1) {
    current = nextQuality(current, sample);
  }
  return current;
}

const HOT: QualitySample = { thermalHeadroom: 0.95, frameMs: 33 };
const COOL: QualitySample = { thermalHeadroom: 0.2, frameMs: 20 };
const STEADY: QualitySample = { thermalHeadroom: 0.7, frameMs: 33 };

describe('the reduction path', () => {
  it('drops a level once the forecast has been high for long enough', () => {
    const reduced = sustain(INITIAL_QUALITY, HOT, SUSTAINED_SAMPLES);

    expect(reduced.level).toBe(1);
    expect(qualitySettings(reduced.level).renderScale).toBeLessThan(1);
  });

  it('reduces resolution before it reduces frame rate', () => {
    // #91 quotes Google naming both parameters; the order is this repository's
    // choice and is stated in `quality.ts`.
    const first = qualitySettings(1);
    const second = qualitySettings(2);

    expect(first.renderScale).toBeLessThan(1);
    expect(first.frameCap).toBe(30);
    expect(second.frameCap).toBeLessThan(30);
  });

  it('walks all the way down under sustained heat, and stops at the bottom', () => {
    let state = INITIAL_QUALITY;
    for (let rung = 0; rung < QUALITY_LADDER.length + 3; rung += 1) {
      state = sustain(state, HOT, SUSTAINED_SAMPLES);
    }

    expect(state.level).toBe(QUALITY_LADDER.length - 1);
    expect(qualitySettings(state.level).label).toBe('minimum');
  });

  it('needs each rung to be earned separately rather than falling through', () => {
    // One sustained run must move one level, not several.
    const once = sustain(INITIAL_QUALITY, HOT, SUSTAINED_SAMPLES);

    expect(once.level).toBe(1);
  });

  it('reduces on frame time alone when the platform reports no forecast', () => {
    // The web platform, and every Android below API 30.
    const slow: QualitySample = { thermalHeadroom: undefined, frameMs: FRAME_MS_REDUCE_ABOVE + 10 };
    const reduced = sustain(INITIAL_QUALITY, slow, SUSTAINED_SAMPLES);

    expect(reduced.level).toBe(1);
  });

  it('treats a NaN forecast as no forecast rather than as an emergency', () => {
    // A vendor that never implemented the API. Throttling every such device
    // would be the opposite of the intended behaviour.
    const broken: QualitySample = { thermalHeadroom: Number.NaN, frameMs: 20 };
    const unchanged = sustain(INITIAL_QUALITY, broken, SUSTAINED_SAMPLES * 2);

    expect(unchanged.level).toBe(0);
  });
});

describe('the policy does not react to noise', () => {
  it('ignores a single hot frame', () => {
    const state = nextQuality(INITIAL_QUALITY, HOT);

    expect(state.level).toBe(0);
  });

  it('ignores a burst shorter than the sustained window', () => {
    const state = sustain(INITIAL_QUALITY, HOT, SUSTAINED_SAMPLES - 1);

    expect(state.level).toBe(0);
  });

  it('lets pressure decay when the measurement stops arguing either way', () => {
    // Nearly enough to reduce, then a long steady stretch. The renderer must not
    // be one hot frame from a reduction an hour later.
    let state = sustain(INITIAL_QUALITY, HOT, SUSTAINED_SAMPLES - 1);
    state = sustain(state, STEADY, SUSTAINED_SAMPLES);

    expect(state.pressure).toBe(0);

    state = nextQuality(state, HOT);
    expect(state.level).toBe(0);
  });
});

describe('recovery, and the hysteresis that stops it oscillating', () => {
  it('restores a level once the phone is properly cool again', () => {
    const reduced = sustain(INITIAL_QUALITY, HOT, SUSTAINED_SAMPLES);
    const restored = sustain(reduced, COOL, SUSTAINED_SAMPLES);

    expect(reduced.level).toBe(1);
    expect(restored.level).toBe(0);
  });

  it('does not restore merely because the phone stopped getting hotter', () => {
    // Google's guidance: the workload must drop BELOW the sustainable level to
    // recover, not back to it. A forecast between the two thresholds is exactly
    // that case, and restoring here is what would oscillate.
    const between = (HEADROOM_REDUCE_ABOVE + HEADROOM_RESTORE_BELOW) / 2;
    const reduced = sustain(INITIAL_QUALITY, HOT, SUSTAINED_SAMPLES);
    const held = sustain(reduced, { thermalHeadroom: between, frameMs: 20 }, SUSTAINED_SAMPLES * 2);

    expect(held.level).toBe(1);
  });

  it('keeps reducing on comfortable frames while the forecast is still high', () => {
    // The dangerous case, and the one a frame-time-only policy gets backwards:
    // the reduction worked, so frames are fine — and the phone is only fine
    // *because* of the reduction, while the forecast says it is still heating.
    // Restoring here is what would oscillate; holding would ignore a forecast
    // that is still above the reduce threshold. The right answer is to keep
    // going down.
    const reduced = sustain(INITIAL_QUALITY, HOT, SUSTAINED_SAMPLES);
    const further = sustain(reduced, { thermalHeadroom: 0.9, frameMs: 20 }, SUSTAINED_SAMPLES);

    expect(reduced.level).toBe(1);
    expect(further.level).toBe(2);
    expect(further.level).not.toBe(0);
  });

  it('never climbs above the target quality', () => {
    // There is no 60 fps rung to be found by a cold phone — #91 is explicit that
    // 30 fps is the target rather than a compromise.
    const state = sustain(INITIAL_QUALITY, COOL, SUSTAINED_SAMPLES * 5);

    expect(state.level).toBe(0);
    expect(qualitySettings(state.level).frameCap).toBe(30);
  });
});

describe('the ladder itself', () => {
  it('gets monotonically cheaper', () => {
    for (let rung = 1; rung < QUALITY_LADDER.length; rung += 1) {
      const previous = QUALITY_LADDER[rung - 1] as (typeof QUALITY_LADDER)[number];
      const current = QUALITY_LADDER[rung] as (typeof QUALITY_LADDER)[number];
      expect(current.renderScale).toBeLessThanOrEqual(previous.renderScale);
      expect(current.frameCap).toBeLessThanOrEqual(previous.frameCap);
      // And strictly cheaper in at least one of the two, or the rung is a no-op.
      expect(
        current.renderScale < previous.renderScale || current.frameCap < previous.frameCap,
      ).toBe(true);
    }
  });

  it('names every rung, so a diagnostic can say which one a ride ran at', () => {
    for (const rung of QUALITY_LADDER) {
      expect(rung.label.length).toBeGreaterThan(0);
    }
  });
});
