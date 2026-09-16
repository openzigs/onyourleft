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
  type QualityLevel,
  type QualitySample,
  type QualityState,
} from './quality';
import { SCATTER_MAX_ITEMS } from './scatter';

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

  it('never gives the shading back as it gets cooler — #286', () => {
    // The third thing a rung can give up, and the first that is not a number,
    // so `gets monotonically cheaper` above cannot see it. Once a rung has
    // dropped the light direction no cooler rung may have it again, or the
    // ladder would buy back the most expensive thing on it on the way down.
    let dropped = false;
    for (const rung of QUALITY_LADDER) {
      if (rung.shading === 'flat') {
        dropped = true;
      }
      expect(rung.shading === 'lit' && dropped).toBe(false);
    }
  });

  it('keeps the light direction until the very last rung — #286', () => {
    // ⚠️ **Two halves, and the second is what stops this passing vacuously.**
    // A ladder that was flat all the way down would satisfy the monotone rule
    // above and would ship the unlit world #286 exists to replace; a ladder
    // that was lit all the way down would satisfy it too and would leave the
    // floor device no way out. So: the target rung is lit, the floor rung is
    // not, and there is exactly one of each condition.
    const first = QUALITY_LADDER[0] as (typeof QUALITY_LADDER)[number];
    const last = QUALITY_LADDER[QUALITY_LADDER.length - 1] as (typeof QUALITY_LADDER)[number];

    expect(first.shading).toBe('lit');
    expect(last.shading).toBe('flat');
    expect(QUALITY_LADDER.filter((rung) => rung.shading === 'flat')).toHaveLength(1);
  });
});

describe('the scenery budget is a rung on the ladder — #245', () => {
  /** Every rung, in order, as the settings a renderer would be handed. */
  const rungs = QUALITY_LADDER.map((_, level) => qualitySettings(level as QualityLevel));

  it('gives every rung a budget, and never a bigger one as the phone gets hotter', () => {
    // #245's first criterion. A ladder where a hotter rung asks for *more*
    // scenery is not a ladder, and nothing else in this file could see it:
    // `gets monotonically cheaper` above reads only the two numbers that
    // existed before #245.
    for (const rung of rungs) {
      expect(Number.isFinite(rung.scatterItems)).toBe(true);
    }
    for (let rung = 1; rung < rungs.length; rung += 1) {
      const previous = rungs[rung - 1] as (typeof rungs)[number];
      const current = rungs[rung] as (typeof rungs)[number];
      expect(current.scatterItems).toBeLessThanOrEqual(previous.scatterItems);
    }
  });

  it('starts at `scatter.ts`’s own figure and ends above zero', () => {
    // ⚠️ **Non-vacuity, and the half that stops the monotone rule above passing
    // over a flat ladder.** A ladder holding 240 at every rung satisfies
    // "never bigger", and would be #245 not implemented. A ladder holding zero
    // at the floor satisfies it too, and would ship an empty verge to the
    // riders least able to tell a hot phone from a broken one — which is the
    // one thing `QualitySettings.scatterItems` says the floor must not do.
    const top = rungs[0] as (typeof rungs)[number];
    const floor = rungs[rungs.length - 1] as (typeof rungs)[number];

    expect(top.scatterItems).toBe(SCATTER_MAX_ITEMS);
    expect(floor.scatterItems).toBeGreaterThan(0);
    expect(floor.scatterItems).toBeLessThan(top.scatterItems);
  });

  it('sheds scenery before it sheds frame rate — FR-4', () => {
    // ⚠️ **Walked with `nextQuality` rather than read off the table**, because
    // the claim is about the order a throttling phone arrives at the rungs in,
    // not about the order they are written down in. A ladder whose entries were
    // right and whose walk skipped a rung would pass the table version of this.
    let state = INITIAL_QUALITY;
    const full = qualitySettings(state.level).scatterItems;
    let firstFrameRateDrop: number | undefined;

    for (let step = 0; step < QUALITY_LADDER.length; step += 1) {
      state = sustain(state, HOT, SUSTAINED_SAMPLES);
      const settings = qualitySettings(state.level);
      if (settings.frameCap < 30 && firstFrameRateDrop === undefined) {
        firstFrameRateDrop = settings.scatterItems;
      }
    }

    expect(firstFrameRateDrop).toBeDefined();
    expect(firstFrameRateDrop).toBeLessThan(full);
    // And the first rung down gave up scenery without giving up a frame.
    expect(qualitySettings(1).frameCap).toBe(30);
    expect(qualitySettings(1).scatterItems).toBeLessThan(full);
  });

  it('does not change the budget on every sample when the phone hovers', () => {
    // #245's third criterion. ⚠️ A flickering scenery budget is worse than a
    // flickering resolution, because items appear and vanish rather than the
    // whole world softening — so the hysteresis has to hold with the new
    // dimension on it, not merely with the two it was written for.
    const above = HEADROOM_REDUCE_ABOVE + 0.05;
    const below = HEADROOM_RESTORE_BELOW - 0.05;
    let state = INITIAL_QUALITY;
    const seen: number[] = [qualitySettings(state.level).scatterItems];

    for (let sample = 0; sample < SUSTAINED_SAMPLES * 8; sample += 1) {
      const headroom = sample % 2 === 0 ? above : below;
      state = nextQuality(state, { thermalHeadroom: headroom, frameMs: 20 });
      seen.push(qualitySettings(state.level).scatterItems);
    }

    const changes = seen.filter((items, at) => at > 0 && items !== seen[at - 1]).length;
    expect(changes).toBe(0);
    expect(new Set(seen).size).toBe(1);
  });

  it('is not merely a budget that never moves', () => {
    // ⚠️ The control for the test above, and without it that assertion is
    // satisfied by a ladder whose budget is constant. The *same* signal, held
    // rather than alternated, has to move it.
    const held = sustain(
      INITIAL_QUALITY,
      { thermalHeadroom: 0.95, frameMs: 20 },
      SUSTAINED_SAMPLES,
    );

    expect(qualitySettings(held.level).scatterItems).toBeLessThan(
      qualitySettings(INITIAL_QUALITY.level).scatterItems,
    );
  });

  it('leaves the budget at full when the forecast is NaN and the frames are fine', () => {
    // #245's fourth criterion, and the behaviour is deliberate: reading NaN as
    // hot would thin the scenery on every device whose vendor never implemented
    // `getThermalHeadroom`, which is most of them.
    const broken: QualitySample = { thermalHeadroom: Number.NaN, frameMs: 20 };
    const unchanged = sustain(INITIAL_QUALITY, broken, SUSTAINED_SAMPLES * 3);

    expect(qualitySettings(unchanged.level).scatterItems).toBe(SCATTER_MAX_ITEMS);
  });
});
