// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a realistic ride records about its ladder — #2289. Fed the same states
 * `quality.ts` §`nextWorldQuality` produces, so a record that disagrees with
 * the ladder is a red test here, not a confusing line on the owner's screen.
 * `realistic-choice.test.tsx` reads the record back through `GameView` and
 * the device's storage.
 */

import { describe, expect, it } from 'vitest';

import {
  ARRIVING_REALISTIC_QUALITY,
  FRAME_MS_REDUCE_ABOVE,
  INITIAL_QUALITY,
  REALISTIC_SETTLING_SAMPLES,
  SUSTAINED_SAMPLES,
  nextWorldQuality,
  realisticWorldArrived,
  type QualitySample,
  type WorldQualityState,
} from './quality';
import type { RealisticWorldReport } from './realistic-report';
import { RealisticWatch } from './realistic-watch';

/** Feeds `samples` through the ladder and the watch, as `GameView`'s loop does. */
function ride(
  watch: RealisticWatch,
  start: WorldQualityState,
  samples: readonly QualitySample[],
  secondsPerSample = 0.05,
): { readonly state: WorldQualityState; readonly reports: RealisticWorldReport[] } {
  let state = start;
  const reports: RealisticWorldReport[] = [];
  samples.forEach((sample, index) => {
    const next = nextWorldQuality(state, sample);
    const report = watch.observe(state, next, sample, (index + 1) * secondsPerSample);
    if (report !== undefined) reports.push(report);
    state = next;
  });
  return { state, reports };
}

const times = (count: number, sample: QualitySample): QualitySample[] =>
  Array.from({ length: count }, () => sample);

const SLOW: QualitySample = { frameMs: FRAME_MS_REDUCE_ABOVE + 15 };
const COMFORTABLE: QualitySample = { frameMs: 16 };
// Comfortable frames and a hot thermal forecast, as the owner's Pixel 8 gave them.
const WARM = { frameMs: 20, thermalHeadroom: 0.97 } as QualitySample;

describe('a realistic ride’s record — #2289', () => {
  it('records nothing while the world is arriving, nor for a stylised ride', () => {
    const arriving = ride(new RealisticWatch(), ARRIVING_REALISTIC_QUALITY, times(200, SLOW));
    expect(arriving.reports).toEqual([]);
    const stylised = ride(
      new RealisticWatch(),
      { realistic: false, quality: INITIAL_QUALITY },
      times(200, SLOW),
    );
    expect(stylised.reports).toEqual([]);
  });

  it('records what the settling window cost once, when it ends', () => {
    const swap = [
      { frameMs: 400 },
      { frameMs: 120 },
      ...times(REALISTIC_SETTLING_SAMPLES - 2, COMFORTABLE),
    ];
    const { reports } = ride(
      new RealisticWatch(),
      realisticWorldArrived(ARRIVING_REALISTIC_QUALITY),
      [...swap, ...times(100, COMFORTABLE)],
    );
    expect(reports).toEqual([
      {
        frameMsLimit: FRAME_MS_REDUCE_ABOVE,
        settling: { frames: REALISTIC_SETTLING_SAMPLES, slow: 2, worstMs: 400 },
        steps: [],
      },
    ]);
  });

  it('records each step down and the leaving, on frame time, with the window’s readings', () => {
    const settled = { ...realisticWorldArrived(ARRIVING_REALISTIC_QUALITY), settling: 0 };
    const fast = { frameMs: 50 };
    // The first run mixes two frame times, for a median that is not either end.
    const first = [...times(10, fast), ...times(SUSTAINED_SAMPLES - 10, { frameMs: 70 })];
    const { state, reports } = ride(new RealisticWatch(), settled, [
      ...first,
      ...times(SUSTAINED_SAMPLES, SLOW),
    ]);
    expect(state.realistic).toBe(false);
    expect(reports).toHaveLength(2);
    const [down, left] = reports.at(-1)?.steps ?? [];
    expect(down).toEqual({
      rung: 0,
      left: false,
      rideSeconds: SUSTAINED_SAMPLES * 0.05,
      frames: SUSTAINED_SAMPLES,
      overFrameMs: SUSTAINED_SAMPLES,
      medianMs: 70,
      worstMs: 70,
    });
    // The ladder's pressure starts again on a step, so the window is the second run.
    expect(left).toMatchObject({
      rung: 1,
      left: true,
      frames: SUSTAINED_SAMPLES,
      medianMs: SLOW.frameMs,
    });
    expect(reports.at(-1)).not.toHaveProperty('settling');
  });

  it('records nothing for a hot thermal forecast: the ladder does not read it — #2289', () => {
    const settled = { ...ARRIVING_REALISTIC_QUALITY, settling: 0 };
    const { state, reports } = ride(
      new RealisticWatch(),
      settled,
      times(SUSTAINED_SAMPLES * 4, WARM),
    );
    expect(state).toMatchObject({ realistic: true, quality: { level: 0 } });
    expect(reports).toEqual([]);
  });

  it('reads at most one decision window, though pressure built over more samples', () => {
    const settled = { ...ARRIVING_REALISTIC_QUALITY, settling: 0 };
    // A neutral sample decays the pressure by one rather than clearing it, so
    // this run takes more than thirty samples to step.
    const neutral: QualitySample = { frameMs: 35 };
    const run = [...times(20, SLOW), neutral, neutral, ...times(SUSTAINED_SAMPLES - 18, SLOW)];
    const { reports } = ride(new RealisticWatch(), settled, run);
    const step = reports.at(-1)?.steps[0];
    expect(run.length).toBeGreaterThan(SUSTAINED_SAMPLES);
    expect(step?.frames).toBe(SUSTAINED_SAMPLES);
    expect(step?.overFrameMs).toBe(SUSTAINED_SAMPLES - 2);
  });

  it('records no step for a climb back up, and reads only the run that stepped after it', () => {
    const settled = { ...ARRIVING_REALISTIC_QUALITY, settling: 0 };
    const { state, reports } = ride(new RealisticWatch(), settled, [
      ...times(SUSTAINED_SAMPLES, SLOW),
      ...times(SUSTAINED_SAMPLES, COMFORTABLE),
      ...times(SUSTAINED_SAMPLES, SLOW),
    ]);
    expect(state).toMatchObject({ realistic: true, quality: { level: 1 } });
    expect(reports).toHaveLength(2);
    const [first, second] = reports.at(-1)?.steps ?? [];
    expect(first?.rung).toBe(0);
    // Only slow samples: none of the comfortable ones before the climb.
    expect(second).toMatchObject({ rung: 0, frames: SUSTAINED_SAMPLES, medianMs: SLOW.frameMs });
  });
});
