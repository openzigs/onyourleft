// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { watts, type Watts } from '../quantities';
import dropoutFixture from '../workout/fixtures/ramp-test-recording-dropout.json';
import rampFixture from '../workout/fixtures/ramp-test-recording.json';
import { RAMP_TEST } from '../workout/library/test';

import type { PowerSeries } from './power-duration';
import {
  estimateThreshold,
  THRESHOLD_TEST_RULES,
  type ThresholdEstimate,
  type ThresholdTestRecording,
} from './threshold-estimate';

/** A fixture's run-length power, `[watts, seconds]` with `null` for a dropout, at 1 Hz. */
interface Fixture {
  readonly effortStartsAt: number;
  readonly effortEndsAt: number;
  readonly thresholdPower: number;
  readonly power: readonly (readonly (number | null)[])[];
}

function expand(runs: Fixture['power']): PowerSeries {
  const series: (Watts | undefined)[] = [];
  for (const [value, length] of runs) {
    if (length === undefined || length === null) {
      throw new Error('a run needs a length');
    }
    for (let second = 0; second < length; second += 1) {
      series.push(value === null || value === undefined ? undefined : watts(value));
    }
  }
  return series;
}

function recording(fixture: Fixture): ThresholdTestRecording {
  return {
    power: expand(fixture.power),
    effortStartsAt: fixture.effortStartsAt,
    effortEndsAt: fixture.effortEndsAt,
  };
}

/** `count` seconds at a constant power. */
const flat = (power: number, count: number): PowerSeries =>
  Array.from({ length: count }, () => watts(power));

const refusal = (estimate: ThresholdEstimate): string => {
  if (estimate.kind !== 'refused') {
    throw new Error(`expected a refusal, got an estimate of ${String(estimate.thresholdPower)} W`);
  }
  return estimate.reason;
};

/**
 * The load-metric marks and their long forms (`docs/agents/scope-and-ip.md`
 * §6, spike 0038 §3.1). The abbreviations as upper-case whole words, since a
 * case-insensitive `IF` would match every English "if".
 */
const MARKS = /\b(?:NP|TSS|IF|CTL|ATL|TSB|FTP)\b/;
const LONG_MARKS =
  /normali[sz]ed power|training stress score|intensity factor|functional threshold/i;

describe('the ramp fixture is a ride of the ramp test', () => {
  // Without this the fixture could drift from the template it claims to be a
  // ride of, and the 225 W below would be a sum about some other test.
  it('starts its effort where the warm-up ends, at the template’s steps', () => {
    const fixture = rampFixture as Fixture;
    const warmUp = RAMP_TEST.template.warmUp.reduce(
      (total, block) => total + (block.kind === 'intervals' ? 0 : block.seconds),
      0,
    );
    expect(fixture.effortStartsAt).toBe(warmUp);
    const power = expand(fixture.power);
    const steps = RAMP_TEST.template.mainSet.blocks.slice(0, 11);
    for (const [index, step] of steps.entries()) {
      if (step.kind !== 'steady') {
        throw new Error('a ramp step is steady');
      }
      const at = fixture.effortStartsAt + index * 60;
      expect(power[at]).toBe(Math.round(step.target * fixture.thresholdPower));
    }
  });
});

describe('estimateThreshold, from a ramp test', () => {
  it('is three quarters of the best minute: 300 W makes 225 W', () => {
    const estimate = estimateThreshold('ramp', recording(rampFixture));
    expect(estimate).toEqual({
      kind: 'estimate',
      thresholdPower: 225,
      basis: 300,
      windowSeconds: 60,
      multiplier: 0.75,
    });
  });

  it('leaves a dropout in the best minute out, and never counts it as zero watts', () => {
    // One second missing 30 s into the 300 W step. No minute that holds it can
    // be vouched for, so the best minute anyone can vouch for is the one
    // ending just before it: 30 s at 285 W and 30 s at 300 W, 292.5 W.
    // Counted as zero, the step would read 295 W (221 W); bridged, 300 W (225).
    const estimate = estimateThreshold('ramp', recording(dropoutFixture));
    expect(estimate).toMatchObject({ kind: 'estimate', basis: 292.5, thresholdPower: 219 });
  });

  it('reads nothing after the effort ended, so a cool-down sprint is not a best minute', () => {
    const fixture = rampFixture as Fixture;
    const power = [...expand(fixture.power)];
    // A minute at 400 W in the cool-down, after the stall that ended the test.
    for (let second = 1200; second < 1260; second += 1) {
      power[second] = watts(400);
    }
    const estimate = estimateThreshold('ramp', { ...recording(fixture), power });
    expect(estimate).toMatchObject({ kind: 'estimate', thresholdPower: 225 });
  });

  it('reads nothing before the effort, so a hard warm-up is not a best minute', () => {
    const fixture = rampFixture as Fixture;
    const power = [...expand(fixture.power)];
    for (let second = 0; second < 60; second += 1) {
      power[second] = watts(400);
    }
    const estimate = estimateThreshold('ramp', { ...recording(fixture), power });
    expect(estimate).toMatchObject({ kind: 'estimate', thresholdPower: 225 });
  });

  it('refuses a ramp abandoned in its warm-up, with a reason and no number', () => {
    // Five minutes of an eight-minute warm-up, then *I'm done*.
    const estimate = estimateThreshold('ramp', {
      power: flat(130, 300),
      effortStartsAt: 480,
      effortEndsAt: 300,
    });
    expect(estimate).not.toHaveProperty('thresholdPower');
    expect(refusal(estimate)).toBe(
      "An estimate needs at least 3 minutes of the ramp's steps, and none of it was ridden. If " +
        'its first steps were too hard, lower your threshold and ride it again.',
    );
  });

  it('refuses a ramp given up before its third step was finished', () => {
    const estimate = estimateThreshold('ramp', {
      power: flat(200, 480 + 179),
      effortStartsAt: 480,
      effortEndsAt: 480 + 179,
    });
    expect(refusal(estimate)).toContain('179 seconds of it were ridden');
    expect(
      refusal(
        estimateThreshold('ramp', {
          power: flat(200, 481),
          effortStartsAt: 480,
          effortEndsAt: 481,
        }),
      ),
    ).toContain('and 1 second of it was ridden.');
    // …and makes one at exactly three steps.
    expect(
      estimateThreshold('ramp', {
        power: flat(200, 480 + 180),
        effortStartsAt: 480,
        effortEndsAt: 480 + 180,
      }),
    ).toMatchObject({ kind: 'estimate', thresholdPower: 150 });
  });

  it('counts only the seconds recorded, when the recording stops before the effort’s end', () => {
    // The effort is written to run on, but the recording holds two minutes of it.
    const estimate = estimateThreshold('ramp', {
      power: flat(200, 480 + 120),
      effortStartsAt: 480,
      effortEndsAt: 480 + 1440,
    });
    expect(refusal(estimate)).toContain('120 seconds of it were ridden');
  });

  it('refuses a ramp with no gap-free minute in it', () => {
    const power: (Watts | undefined)[] = [...flat(200, 480 + 600)];
    for (let second = 480; second < power.length; second += 30) {
      power[second] = undefined;
    }
    expect(
      refusal(estimateThreshold('ramp', { power, effortStartsAt: 480, effortEndsAt: 1080 })),
    ).toBe(
      'No minute-long stretch of the test has power in every second, so no estimate is made: ' +
        'a dropout is never counted as zero watts.',
    );
  });

  it('refuses a ramp of zero watts rather than estimating zero', () => {
    expect(
      refusal(
        estimateThreshold('ramp', { power: flat(0, 900), effortStartsAt: 480, effortEndsAt: 900 }),
      ),
    ).toBe('No power above zero was recorded during the test, so no estimate is made.');
  });
});

describe('estimateThreshold, from a 20-minute test', () => {
  const START = 1260;
  const twenty = (power: PowerSeries, endsAt = START + 1200): ThresholdTestRecording => ({
    power: [...flat(150, START), ...power, ...flat(120, 600)],
    effortStartsAt: START,
    effortEndsAt: endsAt,
  });

  it('is 95 % of the twenty-minute average', () => {
    expect(estimateThreshold('twenty-minute', twenty(flat(240, 1200)))).toEqual({
      kind: 'estimate',
      thresholdPower: 228,
      basis: 240,
      windowSeconds: 1200,
      multiplier: 0.95,
    });
  });

  it('refuses an effort ended at ten minutes, with a reason', () => {
    const estimate = estimateThreshold('twenty-minute', twenty(flat(260, 600), START + 600));
    expect(refusal(estimate)).toBe(
      'An estimate needs the whole 20-minute effort, and 600 seconds of it were ridden.',
    );
  });

  it('refuses an effort with a dropout in it, rather than averaging the rest', () => {
    const power: (Watts | undefined)[] = [...flat(240, 1200)];
    power[700] = undefined;
    expect(refusal(estimateThreshold('twenty-minute', twenty(power)))).toContain(
      'No 20-minute stretch of the test has power in every second',
    );
  });
});

describe('the estimate never uses a load-metric mark', () => {
  it('in any reason it gives, or in the rules it states', () => {
    const reasons = [
      estimateThreshold('ramp', { power: [], effortStartsAt: 480, effortEndsAt: 0 }),
      estimateThreshold('ramp', { power: flat(200, 600), effortStartsAt: 480, effortEndsAt: 600 }),
      estimateThreshold('ramp', {
        power: Array.from({ length: 900 }, () => undefined),
        effortStartsAt: 0,
        effortEndsAt: 900,
      }),
      estimateThreshold('ramp', { power: flat(0, 900), effortStartsAt: 0, effortEndsAt: 900 }),
      estimateThreshold('twenty-minute', { power: [], effortStartsAt: 0, effortEndsAt: 0 }),
    ].map(refusal);
    for (const text of [...reasons, JSON.stringify(THRESHOLD_TEST_RULES)]) {
      expect(text).not.toMatch(MARKS);
      expect(text).not.toMatch(LONG_MARKS);
    }
  });

  it('in the estimate it returns', () => {
    const estimate = estimateThreshold('ramp', recording(rampFixture));
    expect(Object.keys(estimate).join(' ')).not.toMatch(/ftp|tss|np\b/i);
  });
});
