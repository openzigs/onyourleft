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
  RIDER_SHADOW_MAP_RUNG,
  RIDER_SHADOW_MAP_STORAGE_KEY,
  SUSTAINED_SAMPLES,
  keepsShadowMap,
  nextQuality,
  qualitySettings,
  readShadowMapChoice,
  rungFor,
  type QualityLevel,
  type QualitySample,
  type QualityState,
} from './quality';
import { TERRAIN_BANDS, TERRAIN_COLUMN_OFFSETS } from './landform';
import { MAXIMUM_SCENERY_VARIANTS } from './scenery-models';
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

/**
 * How many distinct shapes the scenery may take, per rung — #367.
 *
 * ⚠️ **The one thing on this ladder whose cost is paid in draw calls**, which
 * is #240's NFR-2's first term. `scatterItems` decides how many instances are
 * submitted; this decides how many meshes they are spread over.
 */
describe('the scenery gives up its variety before it gives up its items — #367', () => {
  it('draws every shape the pack gives a kind at the target rung', () => {
    // The ceiling is `scenery-models.ts`'s own constant rather than a copy of
    // it, for the reason the top rung takes `SCATTER_MAX_ITEMS`.
    expect(qualitySettings(0).sceneryVariants).toBe(MAXIMUM_SCENERY_VARIANTS);
  });

  it('never falls below one, which is a shape rather than none', () => {
    // ⚠️ `ScatterBelt` takes an item's variant modulo this, so a zero would be
    // a division by zero and a world with nothing standing beside the road.
    for (const level of [0, 1, 2, 3] as const) {
      expect(qualitySettings(level).sceneryVariants).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(qualitySettings(level).sceneryVariants)).toBe(true);
    }
  });

  it('gives one up on the same rung as the first scenery step, never before it', () => {
    // The ordering argument, as a property of the ladder rather than as prose:
    // the first rung that draws fewer shapes is the first rung that draws fewer
    // items, and neither happens at the target.
    const variants = QUALITY_LADDER.map((rung) => rung.sceneryVariants);
    const items = QUALITY_LADDER.map((rung) => rung.scatterItems);
    const firstDrop = (values: readonly number[]) =>
      values.findIndex((value, at) => at > 0 && value < (values[at - 1] ?? value));

    expect(firstDrop(variants)).toBe(firstDrop(items));
    expect(firstDrop(variants)).toBe(1);
  });

  it('never goes back up as the ladder goes down', () => {
    // A rung that restored a shape on the way down would be a hotter phone
    // drawing more meshes, which is the ladder failing at its one job.
    for (let level = 1; level < QUALITY_LADDER.length; level += 1) {
      expect(QUALITY_LADDER[level]?.sceneryVariants ?? 0).toBeLessThanOrEqual(
        QUALITY_LADDER[level - 1]?.sceneryVariants ?? 0,
      );
    }
    expect(QUALITY_LADDER[QUALITY_LADDER.length - 1]?.sceneryVariants).toBe(1);
  });
});

describe('the ground beyond the road is a rung on the ladder — #458', () => {
  it('draws every band at the target, and never more as the phone gets hotter', () => {
    expect(qualitySettings(0).terrainBands).toBe(TERRAIN_BANDS);
    for (let level = 1; level < QUALITY_LADDER.length; level += 1) {
      expect(QUALITY_LADDER[level]?.terrainBands ?? 0).toBeLessThanOrEqual(
        QUALITY_LADDER[level - 1]?.terrainBands ?? 0,
      );
    }
  });

  it('gives the far ground up with the first scenery step, and never the road’s edge', () => {
    // The ordering argument `QualitySettings.terrainBands` makes, as a
    // property: the first rung to draw less ground is the first to draw less
    // scenery. And the floor keeps the verge and the relief beside the road —
    // every band out to 90 m — because the first two are the road's own edge,
    // and a rung that dropped them would open a crack under the tarmac.
    const bands = QUALITY_LADDER.map((rung) => rung.terrainBands);
    const items = QUALITY_LADDER.map((rung) => rung.scatterItems);
    const firstDrop = (values: readonly number[]) =>
      values.findIndex((value, at) => at > 0 && value < (values[at - 1] ?? value));
    expect(firstDrop(bands)).toBe(firstDrop(items));
    for (const rung of QUALITY_LADDER) {
      expect(Number.isInteger(rung.terrainBands)).toBe(true);
      expect(TERRAIN_COLUMN_OFFSETS[rung.terrainBands] ?? 0).toBeGreaterThanOrEqual(90);
    }
  });
});

describe('the water shader is a rung on the ladder — #459', () => {
  it('shades water at the target only, and gives it up before any frame rate', () => {
    expect(qualitySettings(0).water).toBe('shaded');
    const firstFlat = QUALITY_LADDER.findIndex((rung) => rung.water === 'flat');
    const firstSlower = QUALITY_LADDER.findIndex(
      (rung) => rung.frameCap < QUALITY_LADDER[0]!.frameCap,
    );
    expect(firstFlat).toBeGreaterThan(0);
    expect(firstFlat).toBeLessThan(firstSlower);
    // Never back on as the ladder goes down.
    for (let level = firstFlat; level < QUALITY_LADDER.length; level += 1) {
      expect(QUALITY_LADDER[level]?.water).toBe('flat');
    }
  });
});

describe('the riders’ shadows on the ladder — #426', () => {
  it('grounds the riders with a contact shadow on EVERY rung, the floor included', () => {
    expect(QUALITY_LADDER.map((rung) => rung.riderShadows)).toEqual(
      QUALITY_LADDER.map(() => 'contact'),
    );
  });

  it('puts the shadow map on no rung of the ladder — the ladder never reaches it by itself', () => {
    // From level 0, a device running cool for as long as you like stays at 0,
    // and 0 has no shadow map: off by default, on the device floor and above.
    const cool = sustain(INITIAL_QUALITY, { frameMs: 5, thermalHeadroom: 0.1 }, 1_000);
    expect(cool.level).toBe(0);
    expect(rungFor(cool.level, false).riderShadows).toBe('contact');
  });

  it('is the full rung with one field changed, so a measurement of it is of the map alone', () => {
    const { riderShadows, label, ...rest } = RIDER_SHADOW_MAP_RUNG;
    const {
      riderShadows: top,
      label: topLabel,
      ...full
    } = QUALITY_LADDER[0] as never as typeof RIDER_SHADOW_MAP_RUNG;
    expect(riderShadows).toBe('map');
    expect(top).toBe('contact');
    expect(label).not.toBe(topLabel);
    expect(rest).toEqual(full);
  });

  it('is given to a device that asked, at level 0 only, and taken away by the first step down', () => {
    expect(rungFor(0, true)).toBe(RIDER_SHADOW_MAP_RUNG);
    expect(rungFor(0, false)).toBe(qualitySettings(0));
    for (const level of [1, 2, 3] as const) {
      expect(rungFor(level, true)).toBe(qualitySettings(level));
    }
  });

  it('stays given up for the rest of the ride once the ladder has stepped down — the latch', () => {
    // A device that asked, cooling and heating in turn: 0 → 1 → 0 → 1 → 0.
    // Without the latch the rung is re-entered on every return to 0, and each
    // entry rebuilds shader programs mid-ride (#448's review).
    let state: QualityState = INITIAL_QUALITY;
    let wanted = true;
    const drawn: string[] = [];
    for (const frameMs of [5, FRAME_MS_REDUCE_ABOVE + 10, 5, FRAME_MS_REDUCE_ABOVE + 10, 5]) {
      state = sustain(state, { frameMs }, SUSTAINED_SAMPLES);
      wanted = keepsShadowMap(wanted, state.level);
      drawn.push(`${String(state.level)}:${rungFor(state.level, wanted).riderShadows}`);
    }
    expect(drawn).toEqual(['0:map', '1:contact', '0:contact', '1:contact', '0:contact']);
    // And nothing but the latch's own input brings it back: a new ride re-reads
    // the device's choice, which is `true` again.
    expect(keepsShadowMap(true, 0)).toBe(true);
    expect(keepsShadowMap(false, 0)).toBe(false);
  });

  it('reads the choice off this device, and any failure to read it is "no"', () => {
    const storing = (value: string | null) => ({ getItem: () => value });
    expect(readShadowMapChoice(storing('on'))).toBe(true);
    expect(readShadowMapChoice(storing(null))).toBe(false);
    expect(readShadowMapChoice(storing('yes'))).toBe(false);
    expect(readShadowMapChoice(undefined)).toBe(false);
    expect(
      readShadowMapChoice({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
    expect(RIDER_SHADOW_MAP_STORAGE_KEY).toBe('oyl.game.riderShadowMap');
  });
});
