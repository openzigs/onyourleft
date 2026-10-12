// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The running workout's graph as geometry and as a sentence — #1307. What is
 * drawn where, from which number; `WorkoutGraph.test.tsx` is the markup.
 */

import { describe, expect, it } from 'vitest';

import { expandWorkout, seconds, thresholdShare, type WorkoutBlock } from '@onyourleft/domain';

import { blockChartPaths, CHART_TOP_SHARE, CHART_WIDTH } from '../workouts/block-chart';

import {
  HEART_RATE_LANE_HEIGHT,
  heldInstead,
  LANE_GAP,
  PLAN_LANE_HEIGHT,
  TRACE_LANE_HEIGHT,
  TRACE_MAX_SAMPLES,
  TRACE_WINDOW_SECONDS,
  withTraceSample,
  workoutGraphPaths,
  workoutGraphText,
  type WorkoutGraphInput,
  type WorkoutTraceSample,
} from './workout-graph';

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

/** 10 min at 60 %, 10 min at 100 %, 10 min at 50 %: 1800 s. */
const BLOCKS: readonly WorkoutBlock[] = [steady(600, 0.6), steady(600, 1), steady(600, 0.5)];
const timeline = expandWorkout({ name: 'test', blocks: BLOCKS });

const sample = (at: number, overrides: Partial<WorkoutTraceSample> = {}): WorkoutTraceSample => ({
  at,
  target: 150,
  power: 148,
  heartRate: undefined,
  range: undefined,
  ...overrides,
});

const input = (overrides: Partial<WorkoutGraphInput> = {}): WorkoutGraphInput => ({
  elapsedSeconds: 300,
  timeline,
  holdingWatts: 150,
  thresholdWatts: 250,
  trace: [],
  ...overrides,
});

/** Every `x y` pair a path names, in order. */
const points = (d: string): readonly (readonly [number, number])[] =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)] as const);

/** The x of every vertex in a path, whichever command set it. */
const xs = (d: string): readonly number[] => [
  ...points(d).map(([x]) => x),
  ...[...d.matchAll(/H(-?[\d.]+)/g)].map(([, x]) => Number(x)),
];

describe('the trace is bounded — #1307', () => {
  it('keeps a window of samples and no more', () => {
    let trace: readonly WorkoutTraceSample[] = [];
    for (let at = 1; at <= 1000; at += 1) {
      trace = withTraceSample(trace, sample(at));
    }
    expect(trace.length).toBe(TRACE_MAX_SAMPLES);
    expect(trace.at(-1)?.at).toBe(1000);
    expect(trace[0]?.at).toBe(1000 - TRACE_MAX_SAMPLES + 1);
  });

  it('drops what is older than the window when samples are sparse', () => {
    const trace = withTraceSample([sample(10), sample(400)], sample(400 + TRACE_WINDOW_SECONDS));
    expect(trace.map((each) => each.at)).toEqual([400, 400 + TRACE_WINDOW_SECONDS]);
  });

  it('replaces a sample at the same second rather than drawing the line back on itself', () => {
    const trace = withTraceSample(
      [sample(10), sample(11, { power: 100 })],
      sample(11, { power: 200 }),
    );
    expect(trace.map((each) => [each.at, each.power])).toEqual([
      [10, 148],
      [11, 200],
    ]);
  });

  it('refuses a sample with no time', () => {
    const before = [sample(10)];
    expect(withTraceSample(before, sample(Number.NaN))).toBe(before);
  });
});

describe('the plan lane — #1307', () => {
  it('marks now where the rider is, as a share of the whole workout', () => {
    const { plan } = workoutGraphPaths(input({ elapsedSeconds: 450 }));
    expect(plan.nowFraction).toBeCloseTo(0.25, 6);
    expect(points(plan.now)).toEqual([
      [250, 0],
      [250, PLAN_LANE_HEIGHT],
    ]);
    // The cap is centred on the line.
    const cap = points(plan.nowCap).map(([x]) => x);
    expect((Math.min(...cap) + Math.max(...cap)) / 2).toBe(250);
  });

  it('keeps the mark inside the lane before the start and after the end', () => {
    expect(workoutGraphPaths(input({ elapsedSeconds: -5 })).plan.nowFraction).toBe(0);
    expect(workoutGraphPaths(input({ elapsedSeconds: 99_999 })).plan.nowFraction).toBe(1);
  });

  it('outlines what is ridden and fills what is to come, cut exactly at now', () => {
    const { plan } = workoutGraphPaths(input({ elapsedSeconds: 900 }));
    const now = CHART_WIDTH / 2;
    const doneXs = xs(plan.done);
    const toComeXs = plan.toCome.bands.flatMap(xs);
    expect(doneXs.length).toBeGreaterThan(0);
    expect(toComeXs.length).toBeGreaterThan(0);
    expect(Math.max(...doneXs)).toBe(now);
    expect(Math.min(...doneXs)).toBe(0);
    expect(Math.min(...toComeXs)).toBe(now);
    expect(Math.max(...toComeXs)).toBe(CHART_WIDTH);
  });

  it('has nothing ridden at the start and nothing to come at the end', () => {
    const start = workoutGraphPaths(input({ elapsedSeconds: 0, holdingWatts: undefined })).plan;
    expect(start.done).toBe('');
    expect(start.toCome.bands.join('')).not.toBe('');
    const end = workoutGraphPaths(input({ elapsedSeconds: 1800, holdingWatts: undefined })).plan;
    expect(end.done).not.toBe('');
    expect(end.toCome.bands.join('')).toBe('');
  });

  it('draws both halves on the whole workout’s scale, so they meet', () => {
    // The hardest block (100 %) is behind the rider. Were the part to come
    // scaled by itself, its 50 % block would be drawn at a different height
    // from the same block on the whole chart.
    const whole = blockChartPaths(timeline.segments);
    const { plan } = workoutGraphPaths(input({ elapsedSeconds: 1200, holdingWatts: undefined }));
    expect(plan.toCome.bands.join('')).toBe(
      blockChartPaths(timeline.segments.slice(2), {
        endSeconds: 1800,
        topShare: CHART_TOP_SHARE,
      }).bands.join(''),
    );
    expect(plan.rule).toBe(whole.rule);
  });

  it('cuts a ramp at the height the plan asks for at now', () => {
    const ramp = expandWorkout({
      name: 'ramp',
      blocks: [
        { kind: 'ramp', seconds: seconds(600), from: thresholdShare(0.5), to: thresholdShare(1) },
      ],
    });
    const { plan } = workoutGraphPaths(
      input({ timeline: ramp, elapsedSeconds: 300, holdingWatts: undefined }),
    );
    // 75 % at half way, on a scale whose top is 125 %: y = 100 − 60 = 40.
    const cut = points(plan.done).filter(([x]) => x === CHART_WIDTH / 2);
    expect(cut.map(([, y]) => y)).toContain(40);
  });
});

describe('a block the trainer holds at something else — #1297, #1301, #1305', () => {
  it('says nothing while the trainer holds what the plan asks', () => {
    expect(heldInstead(input({ elapsedSeconds: 300, holdingWatts: 150 }))).toBeUndefined();
    // A rounding apart is the same target.
    expect(heldInstead(input({ elapsedSeconds: 300, holdingWatts: 151 }))).toBeUndefined();
  });

  it('reports a target raised to the trainer’s minimum, with what the plan asked', () => {
    // 50 % of 250 W is 125 W; this machine's minimum is 140 W.
    expect(heldInstead(input({ elapsedSeconds: 1500, holdingWatts: 140 }))).toEqual({
      heldWatts: 140,
      plannedWatts: 125,
    });
  });

  it('reports a refused target: the trainer still holds the block before', () => {
    // In the 100 % block (250 W), still holding the first block's 150 W.
    expect(heldInstead(input({ elapsedSeconds: 700, holdingWatts: 150 }))).toEqual({
      heldWatts: 150,
      plannedWatts: 250,
    });
  });

  it('cannot tell without a threshold, a confirmed target or a target in the plan', () => {
    expect(heldInstead(input({ elapsedSeconds: 700, thresholdWatts: undefined }))).toBeUndefined();
    expect(heldInstead(input({ elapsedSeconds: 700, holdingWatts: undefined }))).toBeUndefined();
    const free = expandWorkout({
      name: 'free',
      blocks: [{ kind: 'free-ride', seconds: seconds(600) }],
    });
    expect(heldInstead(input({ timeline: free, holdingWatts: 150 }))).toBeUndefined();
  });

  it('judges a ramp against everything it asks, not this second', () => {
    const ramp = expandWorkout({
      name: 'ramp',
      blocks: [
        { kind: 'ramp', seconds: seconds(600), from: thresholdShare(0.5), to: thresholdShare(1) },
      ],
    });
    // The plan asks 187.5 W at 300 s; a confirmation trailing at 180 W is the ramp.
    expect(heldInstead(input({ timeline: ramp, holdingWatts: 180 }))).toBeUndefined();
    // 100 W is under anything the ramp asks (125 W–250 W).
    expect(heldInstead(input({ timeline: ramp, holdingWatts: 100 }))?.heldWatts).toBe(100);
  });

  it('draws the block being ridden at the height the trainer holds, not the plan’s', () => {
    // Third block, planned 50 % (y = 60 on the 125 % scale); held 140 W is 56 %.
    const planned = workoutGraphPaths(input({ elapsedSeconds: 1500, holdingWatts: 125 })).plan;
    const held = workoutGraphPaths(input({ elapsedSeconds: 1500, holdingWatts: 140 })).plan;
    const tops = (d: string): number => Math.min(...points(d).map(([, y]) => y));
    expect(tops(planned.toCome.bands.join(''))).toBe(60);
    expect(tops(held.toCome.bands.join(''))).toBeCloseTo(100 - (0.56 / 1.25) * 100, 1);
    // And the blocks already ridden are untouched by it.
    expect(points(held.done).filter(([x]) => x < 600)).toEqual(
      points(planned.done).filter(([x]) => x < 600),
    );
  });

  it('raises the scale when the trainer holds more than the plan ever asks', () => {
    // 400 W of a 250 W threshold is 160 %: above the 125 % top.
    const { plan } = workoutGraphPaths(input({ elapsedSeconds: 300, holdingWatts: 400 }));
    const ys = points(plan.toCome.bands.join('') + plan.done).map(([, y]) => y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...ys)).toBe(0);
  });
});

describe('the lane of the last few minutes — #1307', () => {
  const trace = [
    sample(290, { target: 150, power: 140 }),
    sample(295, { target: 150, power: 160 }),
    sample(300, { target: 200, power: 190 }),
  ];

  it('puts now at the right-hand edge and the window’s start at the left', () => {
    const { trace: lane } = workoutGraphPaths(input({ trace }));
    expect(points(lane.power).map(([x]) => x)).toEqual(
      [
        ((290 - 0) / TRACE_WINDOW_SECONDS) * CHART_WIDTH,
        ((295 - 0) / TRACE_WINDOW_SECONDS) * CHART_WIDTH,
        CHART_WIDTH,
      ].map((x) => Math.round(x * 100) / 100),
    );
  });

  it('draws the confirmed target as steps and power as a line, on one scale', () => {
    const { trace: lane } = workoutGraphPaths(input({ trace }));
    // 140 W to 200 W; the room either side is half of 40 % of 200 W, 40 W.
    expect([lane.bottomWatts, lane.topWatts]).toEqual([100, 240]);
    const y = (watts: number): number =>
      Math.round((TRACE_LANE_HEIGHT - ((watts - 100) / 140) * TRACE_LANE_HEIGHT) * 100) / 100;
    expect(points(lane.power).map(([, each]) => each)).toEqual([y(140), y(160), y(190)]);
    // The edge starts at the first target and steps to the second.
    expect(points(lane.targetEdge)[0]?.[1]).toBe(y(150));
    expect(lane.targetEdge).toContain(`V${String(y(200))}`);
    // The area is the edge, closed down to the ground.
    expect(lane.targetArea.startsWith(lane.targetEdge)).toBe(true);
    expect(lane.targetArea.endsWith('Z')).toBe(true);
    expect(lane.targetArea).toContain(` ${String(TRACE_LANE_HEIGHT)}`);
  });

  it('fits the lane to what is in it, so a few watts off the target can be seen', () => {
    // 225 W held, the rider 8 W either side: from zero that is 3 % of the lane.
    const { trace: lane } = workoutGraphPaths(
      input({
        trace: [217, 233, 225].map((power, index) => sample(298 + index, { target: 225, power })),
      }),
    );
    expect([lane.bottomWatts, lane.topWatts]).toEqual([170, 280]);
    const ys = points(lane.power).map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(TRACE_LANE_HEIGHT * 0.1);
  });

  it('reaches zero when something in the window does, and never draws below the lane', () => {
    const { trace: lane } = workoutGraphPaths(
      input({
        trace: [sample(299, { target: 225, power: 220 }), sample(300, { target: 0, power: 0 })],
      }),
    );
    expect(lane.bottomWatts).toBe(0);
    for (const [, y] of [...points(lane.power), ...points(lane.targetArea)]) {
      expect(y).toBeLessThanOrEqual(TRACE_LANE_HEIGHT);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it('breaks the power line at a dropout rather than drawing through it or down to zero', () => {
    const { trace: lane } = workoutGraphPaths(
      input({
        trace: [sample(297), sample(298, { power: undefined }), sample(299), sample(300)],
      }),
    );
    expect(lane.power.match(/M/g)).toHaveLength(2);
    expect(points(lane.power)).toHaveLength(3);
  });

  it('breaks the target where the trainer holds none, as in a free ride', () => {
    const { trace: lane } = workoutGraphPaths(
      input({
        trace: [
          sample(296),
          sample(297),
          sample(298, { target: undefined }),
          sample(299),
          sample(300),
        ],
      }),
    );
    expect(lane.targetEdge.match(/M/g)).toHaveLength(2);
    expect(lane.targetArea.match(/Z/g)).toHaveLength(2);
  });

  it('ignores samples outside the window and after now', () => {
    const { trace: lane } = workoutGraphPaths(
      input({ elapsedSeconds: 400, trace: [sample(50), sample(390), sample(450)] }),
    );
    expect(points(lane.power)).toHaveLength(1);
  });

  it('draws nothing, and does not throw, with no samples', () => {
    const { trace: lane, heartRate } = workoutGraphPaths(input({ trace: undefined }));
    expect(lane).toMatchObject({ targetArea: '', targetEdge: '', power: '' });
    expect(heartRate).toBeUndefined();
  });

  it('never writes a NaN into a path, whatever the samples hold', () => {
    const paths = workoutGraphPaths(
      input({
        totalSeconds: 0,
        trace: [
          sample(299, { power: Number.NaN, target: Number.POSITIVE_INFINITY }),
          sample(300, { heartRate: Number.NaN, range: { low: Number.NaN, high: 140 } }),
        ],
      } as Partial<WorkoutGraphInput>),
    );
    expect(JSON.stringify(paths)).not.toMatch(/NaN|Infinity/);
  });
});

describe('the heart-rate lane — #1307', () => {
  const range = { low: 130, high: 140 };
  const hold = [
    sample(298, { heartRate: 128, range, target: 180 }),
    sample(299, { heartRate: 135, range, target: 180 }),
    sample(300, { heartRate: 141, range, target: 170 }),
  ];

  it('is not drawn outside a hold, and the trace lane sits right under the plan', () => {
    const paths = workoutGraphPaths(input({ trace: [sample(300, { heartRate: 120 })] }));
    expect(paths.heartRate).toBeUndefined();
    expect(paths.traceTop).toBe(PLAN_LANE_HEIGHT + LANE_GAP);
    expect(paths.height).toBe(PLAN_LANE_HEIGHT + LANE_GAP + TRACE_LANE_HEIGHT);
  });

  it('is drawn between the plan and the trace while a hold runs', () => {
    const paths = workoutGraphPaths(input({ trace: hold }));
    expect(paths.heartRate).toBeDefined();
    expect(paths.heartRateTop).toBe(PLAN_LANE_HEIGHT + LANE_GAP);
    expect(paths.traceTop).toBe(paths.heartRateTop + HEART_RATE_LANE_HEIGHT + LANE_GAP);
    expect(paths.height).toBe(paths.traceTop + TRACE_LANE_HEIGHT);
  });

  it('draws the range as a band and heart rate inside, under and over it where it is', () => {
    const lane = workoutGraphPaths(input({ trace: hold })).heartRate;
    if (lane === undefined) throw new Error('no heart-rate lane');
    // Scale: 128 − 5 = 123 at the bottom, 141 + 5 = 146 at the top.
    const y = (bpm: number): number =>
      Math.round((HEART_RATE_LANE_HEIGHT - ((bpm - 123) / 23) * HEART_RATE_LANE_HEIGHT) * 100) /
      100;
    expect(points(lane.line).map(([, each]) => each)).toEqual([y(128), y(135), y(141)]);
    const band = points(lane.range).map(([, each]) => each);
    expect(Math.min(...band)).toBe(y(140));
    expect(Math.max(...band)).toBe(y(130));
    // 128 is under the band, 135 in it and 141 over it — larger y is lower.
    expect(y(128)).toBeGreaterThan(y(130));
    expect(y(141)).toBeLessThan(y(140));
  });

  it('keeps the band, with no line, while the strap is silent', () => {
    const lane = workoutGraphPaths(
      input({ trace: hold.map((each) => ({ ...each, heartRate: undefined })) }),
    ).heartRate;
    expect(lane?.range).not.toBe('');
    expect(lane?.line).toBe('');
  });

  it('shows the target the hold set easing in the lane underneath', () => {
    const { trace: lane } = workoutGraphPaths(input({ trace: hold }));
    // 180 W then 170 W: the edge steps DOWN, which is a larger y.
    const heights = [...lane.targetEdge.matchAll(/[MV](?:-?[\d.]+ )?(-?[\d.]+)/g)].map(([, y]) =>
      Number(y),
    );
    expect(heights).toHaveLength(3);
    expect(heights[1]).toBe(heights[0]);
    expect(heights[2]).toBeGreaterThan(heights[0] ?? Infinity);
  });
});

describe('room for a re-plan — #1244’s seam', () => {
  it('draws nothing for it until something supplies it', () => {
    expect(workoutGraphPaths(input()).plan.replaced).toBe('');
  });

  it('draws what was replaced on the plan’s own scale, beside the plan that stands', () => {
    const before = expandWorkout({ name: 'before', blocks: [steady(1800, 1.5)] }).segments;
    const { plan } = workoutGraphPaths(input({ replaced: before, holdingWatts: undefined }));
    expect(plan.replaced).not.toBe('');
    // 150 % is above the default top, so the scale grows to hold it: y = 0.
    expect(Math.min(...points(plan.replaced).map(([, y]) => y))).toBe(0);
    // …and the plan that stands is drawn on that same scale: 100 % at a third down.
    const standing = points(plan.toCome.bands.join('') + plan.done).map(([, y]) => y);
    expect(Math.min(...standing)).toBeCloseTo(100 - (1 / 1.5) * 100, 1);
  });
});

describe('the graph in words — #1307', () => {
  it('says how far in, the confirmed target and the rider’s power', () => {
    expect(workoutGraphText(input({ trace: [sample(300, { power: 147.6 })] }))).toBe(
      'Workout graph. 5 min of 30 min ridden. Target the trainer last confirmed: 150 W. ' +
        'Your power: 148 W.',
    );
  });

  it('says both numbers when the trainer holds something the plan did not ask', () => {
    expect(workoutGraphText(input({ elapsedSeconds: 1500, holdingWatts: 140 }))).toBe(
      'Workout graph. 25 min of 30 min ridden. Target the trainer last confirmed: 140 W, where ' +
        'the plan asks for 125 W.',
    );
  });

  it('says no target and no power where there is neither, rather than a zero', () => {
    expect(
      workoutGraphText(
        input({ holdingWatts: undefined, trace: [sample(300, { power: undefined })] }),
      ),
    ).toBe('Workout graph. 5 min of 30 min ridden.');
  });

  it('says heart rate and the chosen range while a hold runs', () => {
    const range = { low: 130, high: 140 };
    expect(
      workoutGraphText(input({ trace: [sample(300, { heartRate: 136.4, range })] })),
    ).toContain('Heart rate: 136 bpm, with a chosen range of 130–140 bpm.');
    expect(workoutGraphText(input({ trace: [sample(300, { range })] }))).toContain(
      'No heart rate, with a chosen range of 130–140 bpm.',
    );
    expect(workoutGraphText(input({ trace: [sample(300, { heartRate: 136 })] }))).not.toContain(
      'Heart rate',
    );
  });

  it('says what the dashed outline is once a re-plan supplies one', () => {
    expect(workoutGraphText(input())).not.toContain('dashed');
    expect(workoutGraphText(input({ replaced: timeline.segments }))).toContain(
      'The dashed outline is the plan before it was changed.',
    );
  });
});
