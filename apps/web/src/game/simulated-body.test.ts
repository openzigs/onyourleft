// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3210: the simulated rider's invented cadence and heart rate, ridden
 * through a step up in power, a step down, a stop and a climb. Each curve is
 * pinned whole, and beside each pin is the range the owner's *"make sure the
 * made up numbers are realistic"* asks for, so a change to a number has to
 * keep the curve realistic as well as change the pin.
 */

import { describe, expect, it } from 'vitest';

import { InventedBody, type OwnThresholds } from './simulated-body';

/** One stretch of a ride: so long, at so much power, up so steep a road. */
interface Leg {
  readonly seconds: number;
  readonly watts: number;
  readonly grade?: number;
}

/** One reading: the ride's second, the cadence and the heart rate. */
type Sample = readonly [second: number, cadence: number, heartRate: number];

/**
 * Ride `legs` in tenths of a second, a frame's worth, and read the body every
 * `every` seconds from the first leg's end on and over all the others.
 */
function ride(
  legs: readonly Leg[],
  every: number,
  options: {
    readonly seed?: number;
    readonly own?: OwnThresholds;
    readonly stepTenths?: number;
  } = {},
): Sample[] {
  const body = new InventedBody(options.seed ?? 3210, options.own);
  const step = options.stepTenths ?? 1;
  const samples: Sample[] = [];
  let tenths = 0;
  body.advanceTo(0, legs[0]?.watts ?? 0, legs[0]?.grade ?? 0);
  for (const leg of legs) {
    for (let index = 0; index < (leg.seconds * 10) / step; index += 1) {
      tenths += step;
      body.advanceTo(tenths / 10, leg.watts, leg.grade ?? 0);
      if (tenths % Math.round(every * 10) === 0) {
        samples.push([tenths / 10, body.cadence, body.heartRate]);
      }
    }
  }
  return samples;
}

/** The samples from `second` on. */
function from(samples: readonly Sample[], second: number): Sample[] {
  return samples.filter(([at]) => at >= second);
}

const cadences = (samples: readonly Sample[]): number[] => samples.map(([, cadence]) => cadence);
const heartRates = (samples: readonly Sample[]): number[] => samples.map(([, , heart]) => heart);

/** The largest change between one sample and the next. */
function largestStep(values: readonly number[]): number {
  let largest = 0;
  for (let index = 1; index < values.length; index += 1) {
    largest = Math.max(largest, Math.abs((values[index] ?? 0) - (values[index - 1] ?? 0)));
  }
  return largest;
}

/** The heart rate `after` seconds into a step from `before` watts to `watts`, and the two it lies between. */
interface Step {
  /** The rate of a body that never stepped: where the step began. */
  readonly start: number;
  readonly now: number;
  /** The rate of a body that rode `watts` all along: where the step ends. */
  readonly plateau: number;
}

/**
 * A step from `before` watts to `watts` after ten settled minutes, read
 * `after` seconds in (#3215). The three bodies share a seed and are read at
 * the same second, so the wobble is the same in each and cancels.
 */
function step(before: number, watts: number, after: number): Step {
  const settled = 600;
  const second = settled + after;
  const read = (legs: readonly Leg[]): number =>
    ride(legs, 1).find(([at]) => at === second)?.[2] ?? Number.NaN;
  return {
    start: read([{ seconds: second, watts: before }]),
    now: read([
      { seconds: settled, watts: before },
      { seconds: after, watts },
    ]),
    plateau: read([{ seconds: second, watts }]),
  };
}

/** How far of its way a step has gone, from nought to one, up or down. */
function shareOfStep({ start, now, plateau }: Step): number {
  return (now - start) / (plateau - start);
}

describe('InventedBody at the start of a ride — #3210', () => {
  it('has no cadence and a resting heart rate before it has ridden', () => {
    const body = new InventedBody(3210);
    expect(body.cadence).toBe(0);
    expect(body.heartRate).toBeGreaterThanOrEqual(65);
    expect(body.heartRate).toBeLessThanOrEqual(75);
    body.advanceTo(0, 200, 0);
    expect(body.cadence).toBe(0);
  });

  it('spins up smoothly from nought, never in a step', () => {
    const first = ride([{ seconds: 10, watts: 200 }], 0.1);
    expect(first[0]?.[1]).toBeLessThan(10);
    expect(largestStep(cadences(first))).toBeLessThanOrEqual(6);
    expect(first.at(-1)?.[1]).toBeGreaterThanOrEqual(85);
  });
});

describe('InventedBody on the flat — #3210', () => {
  const flat = from(ride([{ seconds: 600, watts: 200 }], 0.1), 60);

  it('settles at 85–95 rpm, wobbling by a few rpm and never one fixed number', () => {
    const values = cadences(flat);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(85);
    expect(Math.max(...values)).toBeLessThanOrEqual(95);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(6);
  });

  it('changes smoothly: never more than a whole rpm or bpm in a tenth of a second', () => {
    expect(largestStep(cadences(flat))).toBeLessThanOrEqual(1);
    expect(largestStep(heartRates(flat))).toBeLessThanOrEqual(1);
  });
});

describe('InventedBody on a step up in power — #3210', () => {
  // Endurance (60 % of the default 250 W threshold) for five minutes, then threshold.
  const ridden = ride(
    [
      { seconds: 300, watts: 150 },
      { seconds: 180, watts: 250 },
    ],
    10,
  );

  it('is pinned', () => {
    expect(from(ridden, 290).map(([, cadence, heart]) => [cadence, heart])).toEqual([
      [86, 130],
      [85, 129],
      [92, 138],
      [92, 142],
      [91, 148],
      [91, 152],
      [90, 155],
      [90, 158],
      [88, 159],
      [87, 162],
      [88, 163],
      [89, 165],
      [90, 165],
      [89, 166],
      [90, 167],
      [90, 167],
      [89, 168],
      [87, 168],
      [88, 169],
      [89, 169],
    ]);
  });

  it('holds 120–150 bpm at endurance, and 160–180 once threshold has been held', () => {
    for (const heart of heartRates(from(ridden, 180).filter(([at]) => at <= 300))) {
      expect(heart).toBeGreaterThanOrEqual(120);
      expect(heart).toBeLessThanOrEqual(150);
    }
    for (const heart of heartRates(from(ridden, 420))) {
      expect(heart).toBeGreaterThanOrEqual(160);
      expect(heart).toBeLessThanOrEqual(180);
    }
  });

  it('spins up briefly on the surge, then settles back', () => {
    const before = cadences(from(ridden, 240).filter(([at]) => at <= 300));
    const surge = Math.max(...cadences(from(ridden, 301).filter(([at]) => at <= 330)));
    expect(surge).toBeGreaterThan(Math.max(...before) + 2);
    for (const cadence of cadences(from(ridden, 400))) expect(cadence).toBeLessThan(surge);
  });

  it('lags the effort by tens of seconds: under halfway there ten seconds in', () => {
    const at = (second: number): number => ridden.find(([each]) => each === second)?.[2] ?? 0;
    const rise = at(470) - at(300);
    expect(at(310) - at(300)).toBeLessThan(rise / 2);
    expect(at(360) - at(300)).toBeGreaterThan(rise / 2);
  });
});

/**
 * #3215, the owner's ruling of 2026-11-25: a step up settles in about 2–3
 * minutes, as a real rider's heart rate does, with about 60–70 % of the rise
 * in the first minute and the rate within about 3 bpm of its plateau after
 * three.
 */
describe('InventedBody settles a step up in 2–3 minutes — #3215', () => {
  const steps = [
    { name: 'from rest to threshold, 70 to 170 bpm', before: 0, watts: 250 },
    { name: 'from rest to 200 W, the tablet’s step, 70 to 150 bpm', before: 0, watts: 200 },
    { name: 'from endurance to threshold, 130 to 170 bpm', before: 150, watts: 250 },
  ] as const;

  for (const { name, before, watts } of steps) {
    it(`goes 60–70 % of the way in the first minute, ${name}`, () => {
      const share = shareOfStep(step(before, watts, 60));
      expect(share).toBeGreaterThanOrEqual(0.6);
      expect(share).toBeLessThanOrEqual(0.7);
    });

    it(`is within 3 bpm of its plateau after three minutes, ${name}`, () => {
      const { now, plateau } = step(before, watts, 180);
      expect(plateau - now).toBeGreaterThanOrEqual(0);
      expect(plateau - now).toBeLessThanOrEqual(3);
    });
  }

  it('has not settled after two minutes of a big step: more than 3 bpm short', () => {
    for (const watts of [200, 250]) {
      const { now, plateau } = step(0, watts, 120);
      expect(plateau - now).toBeGreaterThan(3);
    }
  });
});

describe('InventedBody on a step down in power — #3210', () => {
  const ridden = ride(
    [
      { seconds: 300, watts: 250 },
      { seconds: 180, watts: 150 },
    ],
    10,
  );

  it('is pinned', () => {
    expect(from(ridden, 290).map(([, cadence, heart]) => [cadence, heart])).toEqual([
      [88, 170],
      [87, 169],
      [83, 168],
      [86, 163],
      [86, 162],
      [87, 158],
      [87, 156],
      [88, 155],
      [86, 151],
      [85, 151],
      [86, 148],
      [87, 147],
      [88, 146],
      [87, 144],
      [88, 144],
      [88, 142],
      [87, 142],
      [85, 140],
      [86, 140],
      [87, 139],
    ]);
  });

  it('recovers more slowly than it rose: under half the fall in the first minute — #3215', () => {
    // A minute after each step between the same two powers: the rise has gone
    // further of its way than the fall has of its own.
    const rise = shareOfStep(step(150, 250, 60));
    const fall = shareOfStep(step(250, 150, 60));
    expect(fall).toBeLessThan(0.5);
    expect(fall).toBeLessThan(rise - 0.2);
  });
});

describe('InventedBody when the power stops — #3210', () => {
  it('stops the legs within two seconds, and they stay stopped', () => {
    const ridden = ride(
      [
        { seconds: 300, watts: 200 },
        { seconds: 10, watts: 0 },
      ],
      0.1,
    );
    const after = from(ridden, 300.1);
    expect(after[0]?.[1]).toBeGreaterThan(70);
    for (const [at, cadence] of after) if (at >= 302) expect(cadence).toBe(0);
    expect(largestStep(cadences(after))).toBeLessThanOrEqual(6);
  });

  it('recovers slowly, towards rest: pinned at half-minute steps', () => {
    const ridden = ride(
      [
        { seconds: 300, watts: 250 },
        { seconds: 180, watts: 0 },
      ],
      30,
    );
    expect(from(ridden, 300).map(([, cadence, heart]) => [cadence, heart])).toEqual([
      [87, 169],
      [0, 148],
      [0, 131],
      [0, 117],
      [0, 106],
      [0, 99],
      [0, 92],
    ]);
  });
});

describe('InventedBody on a climb — #3210', () => {
  const ridden = ride(
    [
      { seconds: 120, watts: 200 },
      { seconds: 60, watts: 200, grade: 8 },
      { seconds: 60, watts: 200, grade: 12 },
    ],
    10,
  );

  it('is pinned', () => {
    expect(from(ridden, 110).map(([, cadence, heart]) => [cadence, heart])).toEqual([
      [87, 140],
      [87, 143],
      [75, 143],
      [77, 146],
      [78, 145],
      [80, 147],
      [78, 148],
      [77, 147],
      [70, 149],
      [70, 147],
      [68, 149],
      [68, 149],
      [71, 149],
      [71, 150],
    ]);
  });

  it('eases to 70–80 rpm on a steep climb, smoothly', () => {
    const fine = ride(
      [
        { seconds: 120, watts: 200 },
        { seconds: 60, watts: 200, grade: 8 },
      ],
      0.1,
    );
    for (const cadence of cadences(from(fine, 130))) {
      expect(cadence).toBeGreaterThanOrEqual(70);
      expect(cadence).toBeLessThanOrEqual(80);
    }
    expect(largestStep(cadences(from(fine, 110)))).toBeLessThanOrEqual(1);
  });

  it('pedals no slower down a descent than on the flat', () => {
    const descent = ride([{ seconds: 120, watts: 200, grade: -6 }], 10).at(-1);
    const flat = ride([{ seconds: 120, watts: 200 }], 10).at(-1);
    expect(descent?.[1]).toBe(flat?.[1]);
  });
});

describe('InventedBody is scaled to the rider — #3210', () => {
  it('reaches the rider’s own threshold heart rate at their own threshold power', () => {
    const own = ride([{ seconds: 600, watts: 300 }], 600, {
      own: { power: 300, heartRate: 160 },
    }).at(-1);
    expect(own?.[2]).toBeGreaterThanOrEqual(158);
    expect(own?.[2]).toBeLessThanOrEqual(162);
  });

  it('never climbs more than 15 bpm above threshold, however hard the effort', () => {
    const hard = ride([{ seconds: 900, watts: 1000 }], 900).at(-1);
    expect(hard?.[2]).toBeGreaterThanOrEqual(183);
    expect(hard?.[2]).toBeLessThanOrEqual(186);
  });

  it('takes the default for a threshold that is not a usable one', () => {
    const fallback = ride([{ seconds: 600, watts: 250 }], 600).at(-1);
    for (const own of [{ power: 0, heartRate: Number.NaN }, { power: -5 }, {}]) {
      expect(ride([{ seconds: 600, watts: 250 }], 600, { own }).at(-1)).toEqual(fallback);
    }
  });
});

describe('InventedBody is seeded and does not depend on the frame rate — #3210', () => {
  const legs: readonly Leg[] = [{ seconds: 120, watts: 220 }];

  it('rides the same curve for the same seed, and a different one for another', () => {
    expect(ride(legs, 1)).toEqual(ride(legs, 1));
    expect(cadences(ride(legs, 1, { seed: 7 }))).not.toEqual(cadences(ride(legs, 1)));
  });

  it('reads the same whether it was advanced in tenths or in frames of two seconds, through a surge', () => {
    const surge: readonly Leg[] = [
      ...legs,
      { seconds: 60, watts: 400 },
      { seconds: 60, watts: 150 },
    ];
    expect(ride(surge, 2, { stepTenths: 20 })).toEqual(ride(surge, 2));
  });

  it('settles an hour passed in one call, as a background tab passes it', () => {
    const body = new InventedBody(3210);
    body.advanceTo(0, 250, 0);
    body.advanceTo(3_600, 250, 0);
    // Against the same hour ridden frame by frame: the same second, so the same wobble.
    const steady = ride([{ seconds: 3_600, watts: 250 }], 3_600).at(-1);
    expect(Math.abs(body.cadence - (steady?.[1] ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(body.heartRate - (steady?.[2] ?? 0))).toBeLessThanOrEqual(1);
  });

  it('changes nothing for a second that is not after the last', () => {
    const body = new InventedBody(3210);
    body.advanceTo(0, 200, 0);
    body.advanceTo(30, 200, 0);
    const read = [body.cadence, body.heartRate];
    body.advanceTo(10, 0, 0);
    body.advanceTo(30, 0, 0);
    expect([body.cadence, body.heartRate]).toEqual(read);
  });
});
