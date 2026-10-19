// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { COLLAPSE_RPM, seconds, STALLING_CADENCE, thresholdShare } from '@onyourleft/domain';

import {
  BAND_MINIMUM_WATTS,
  CADENCE_CUE_RPM,
  smoothedPower,
  targetBand,
  targetBandWords,
  type TargetBandInput,
} from './target-band';
import type { WorkoutTraceSample } from './workout-graph';

const sample = (at: number, power: number | undefined): WorkoutTraceSample => ({
  at,
  target: 200,
  power,
  heartRate: undefined,
  range: undefined,
});

/** A 600 s steady block at 0.8 of 250 W, then a free ride, 100 s into the first. */
const input = (overrides: Partial<TargetBandInput> = {}): TargetBandInput => ({
  elapsedSeconds: 100,
  status: 'running',
  holdingWatts: 200,
  hasControl: true,
  targetConfirmed: true,
  thresholdWatts: 250,
  timeline: {
    segments: [
      {
        startsAt: seconds(0),
        endsAt: seconds(600),
        from: thresholdShare(0.8),
        to: thresholdShare(0.8),
      },
      { startsAt: seconds(600), endsAt: seconds(900), from: undefined, to: undefined },
    ],
    totalSeconds: 900,
  },
  trace: [sample(96, 300), sample(97, 180), sample(98, 190), sample(99, 200), sample(100, 210)],
  live: { power: 210, heartRate: undefined, cadence: 90 },
  blockAverageWatts: 198,
  ...overrides,
});

const band = (overrides: Partial<TargetBandInput> = {}) => {
  const found = targetBand(input(overrides));
  if (found === undefined) throw new Error('no band');
  return found;
};

describe('the band — #1434', () => {
  it('is ±5 % around the target the trainer confirmed', () => {
    expect(band()).toMatchObject({ target: 200, low: 190, high: 210 });
  });

  it('is never narrower than its minimum on a low target', () => {
    const low = band({ holdingWatts: 60 });
    expect(low.high - low.target).toBe(BAND_MINIMUM_WATTS);
    expect(low.target - low.low).toBe(BAND_MINIMUM_WATTS);
  });

  it('is drawn around what the trainer holds, not what the plan asks — an eased target is the band', () => {
    // The plan asks 200 W; a relief has the trainer at 133 W.
    expect(band({ holdingWatts: 133, rescue: {} }).target).toBe(133);
  });

  it('is not shown paused, without control, unconfirmed, refused, in a free ride or a running hold', () => {
    expect(targetBand(input({ status: 'paused' }))).toBeUndefined();
    expect(targetBand(input({ hasControl: false }))).toBeUndefined();
    expect(targetBand(input({ targetConfirmed: false }))).toBeUndefined();
    expect(targetBand(input({ holdingWatts: undefined }))).toBeUndefined();
    expect(targetBand(input({ refused: true }))).toBeUndefined();
    expect(targetBand(input({ elapsedSeconds: 700 }))).toBeUndefined();
    expect(targetBand(input({ hold: { reason: 'holding', target: 180 } }))).toBeUndefined();
    // A hold that is OFF rides the plan, so the band is back.
    expect(targetBand(input({ hold: { reason: 'ineligible', target: 180 } }))).toBeDefined();
  });

  it('says how long is left of the block', () => {
    expect(band().left).toBe('8:20');
    expect(targetBandWords(band()).left).toBe('8:20 left in this block');
  });

  it('places each mark along its scale, with the band in the middle', () => {
    const { at } = band();
    // The scale is 100–300 W around a 200 W target.
    expect(at.low).toBeCloseTo(45);
    expect(at.high).toBeCloseTo(55);
    expect(at.smoothed).toBeCloseTo(50);
    expect(at.average).toBeCloseTo(49);
    expect(
      band({ live: { power: 900, heartRate: undefined }, trace: [sample(100, 900)] }).at.smoothed,
    ).toBe(100);
  });
});

describe('the 3 s power — #1434', () => {
  it('is the mean of the last three seconds of the trace', () => {
    // 190, 200, 210 — not the 300 W or the 180 W before them.
    expect(smoothedPower(input())).toBe(200);
  });

  it('leaves out a second with no reading rather than counting it as zero', () => {
    expect(
      smoothedPower(input({ trace: [sample(98, 190), sample(99, undefined), sample(100, 210)] })),
    ).toBe(200);
  });

  it('is nothing when power is not live now, whatever the trace holds', () => {
    expect(
      smoothedPower(input({ live: { power: undefined, heartRate: undefined } })),
    ).toBeUndefined();
    expect(
      targetBandWords(band({ live: { power: undefined, heartRate: undefined } })).standing,
    ).toBe('No power reading');
  });

  it('is nothing with no reading in the window', () => {
    expect(smoothedPower(input({ trace: [sample(90, 200)] }))).toBeUndefined();
  });
});

describe('in, under or over, in words — #1434, SC 1.4.1', () => {
  const at = (power: number) =>
    targetBandWords(
      band({
        trace: [sample(98, power), sample(99, power), sample(100, power)],
        live: { power, heartRate: undefined },
      }),
    );

  it('says each in words, with the watts out of the band', () => {
    expect(at(200).standing).toBe('In the band');
    expect(at(190).standing).toBe('In the band');
    expect(at(210).standing).toBe('In the band');
    expect(at(178).standing).toBe('12 W under the band');
    expect(at(218).standing).toBe('8 W over the band');
  });

  it('writes the band, the readings and a name with every number in it', () => {
    const words = targetBandWords(band());
    expect(words.band).toBe('Target 200 W, ride 190–210 W');
    expect(words.readings).toBe('3 s power 200 W · Block average 198 W');
    expect(words.name).toBe(
      'Target band 190–210 W, around the 200 W the trainer confirmed. In the band. ' +
        '3 s power 200 W. Block average 198 W. 8:20 left in this block.',
    );
  });

  it('writes no average before the block has one', () => {
    expect(targetBandWords(band({ blockAverageWatts: undefined })).readings).toBe(
      '3 s power 200 W',
    );
  });
});

describe('the early cadence warning — #1434', () => {
  const cadence = (rpm: number | undefined, overrides: Partial<TargetBandInput> = {}) =>
    band({ live: { power: 210, heartRate: undefined, cadence: rpm }, ...overrides }).lowCadence;

  it('starts where the stall relief’s trend rule can first fire, so it comes before the relief', () => {
    expect(CADENCE_CUE_RPM).toBe((STALLING_CADENCE as number) + COLLAPSE_RPM);
    expect(cadence(CADENCE_CUE_RPM)).toBeUndefined();
    expect(cadence(CADENCE_CUE_RPM - 1)).toBe(CADENCE_CUE_RPM - 1);
    expect(cadence(90)).toBeUndefined();
  });

  it('says nothing once the relief is easing the target, when pedalling has stopped, or with no reading', () => {
    expect(cadence(55, { rescue: {} })).toBeUndefined();
    expect(cadence(5)).toBeUndefined();
    expect(cadence(undefined)).toBeUndefined();
  });

  it('is a sentence that names the cadence', () => {
    expect(
      targetBandWords(band({ live: { power: 210, heartRate: undefined, cadence: 58.4 } })).cadence,
    ).toBe(
      '58 rpm under load. Spin faster now: in ERG a slower cadence makes the pedals heavier, ' +
        'and the target will be eased if it keeps falling.',
    );
    expect(targetBandWords(band()).cadence).toBeUndefined();
  });
});
