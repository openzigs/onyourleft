// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The running workout's graph as geometry and as a sentence — #1307. What is
 * drawn where, from which number; `WorkoutGraph.test.tsx` is the markup.
 */

import { describe, expect, it } from 'vitest';

import {
  beatsPerMinute,
  expandWorkout,
  seconds,
  thresholdShare,
  type WorkoutBlock,
} from '@onyourleft/domain';

import { blockChartPaths, CHART_WIDTH } from '../workouts/block-chart';

import {
  GRAPH_KEY_REPLACED,
  graphKeyHeld,
  HEART_RATE_LANE_HEIGHT,
  HELD_GRACE_SECONDS,
  heldInstead,
  heldNow,
  PLAN_FILL_SHARE,
  PLAN_LANE_HEIGHT,
  STRIP_PROGRESS_HEIGHT,
  TRACE_LANE_HEIGHT,
  TRACE_LANE_INSET,
  TRACE_MAX_SAMPLES,
  TRACE_WINDOW_SECONDS,
  withTraceSample,
  workoutGraphKey,
  workoutGraphLabels,
  workoutGraphPaths,
  workoutGraphText,
  workoutStripPaths,
  workoutStripText,
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
    const { plan } = workoutGraphPaths(input({ elapsedSeconds: 900, holdingWatts: 250 }));
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
    const { plan } = workoutGraphPaths(input({ elapsedSeconds: 1200, holdingWatts: undefined }));
    expect(plan.toCome.bands.join('')).toBe(
      blockChartPaths(timeline.segments.slice(2), {
        endSeconds: 1800,
        topShare: 1 / PLAN_FILL_SHARE,
      }).bands.join(''),
    );
  });

  it('scales the lane to the workout’s own hardest target, so the bars use it', () => {
    // An easy workout: nothing over 60 %. On the block chart's fixed 125 %
    // scale its tallest bar would be under half the lane.
    const easy = expandWorkout({ name: 'easy', blocks: [steady(600, 0.6), steady(600, 0.4)] });
    const { plan } = workoutGraphPaths(
      input({ timeline: easy, elapsedSeconds: 0, holdingWatts: undefined }),
    );
    const top = Math.min(...points(plan.toCome.bands.join('')).map(([, y]) => y));
    expect(top).toBeCloseTo(PLAN_LANE_HEIGHT * (1 - PLAN_FILL_SHARE), 6);
    // And the 40 % block is two thirds of that height.
    const ys = points(plan.toCome.bands.join('')).map(([, y]) => y);
    expect(ys).toContain(Math.round((100 - (0.4 / 0.6) * 85) * 100) / 100);
  });

  it('keeps the block chart’s own scale for a workout with no target in it', () => {
    const free = expandWorkout({
      name: 'free',
      blocks: [{ kind: 'free-ride', seconds: seconds(600) }],
    });
    const { plan } = workoutGraphPaths(
      input({ timeline: free, elapsedSeconds: 0, holdingWatts: undefined }),
    );
    expect(plan.toCome.freeRide).toBe(blockChartPaths(free.segments).freeRide);
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
    // 75 % at half way, on a scale where 100 % is 85 of the lane: y = 100 − 63.75.
    const cut = points(plan.done).filter(([x]) => x === CHART_WIDTH / 2);
    expect(cut.map(([, y]) => y)).toContain(36.25);
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
      by: 'plan',
      why: 'different',
    });
  });

  it('reports a refused target: the trainer still holds the block before', () => {
    // In the 100 % block (250 W), still holding the first block's 150 W.
    expect(heldInstead(input({ elapsedSeconds: 700, holdingWatts: 150 }))).toEqual({
      heldWatts: 150,
      plannedWatts: 250,
      by: 'plan',
      why: 'different',
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

  it('waits out the start of a block: a write on its way is not a different target', () => {
    // The 100 % block (250 W) starts at 600 s. The trainer still holds 150 W
    // until the new write is acknowledged, about a second later.
    for (let into = 0; into < HELD_GRACE_SECONDS; into += 1) {
      expect(
        heldInstead(input({ elapsedSeconds: 600 + into, holdingWatts: 150 })),
        `${String(into)} s in`,
      ).toBeUndefined();
    }
    // Still 150 W once the grace has run: that is a refusal.
    expect(
      heldInstead(input({ elapsedSeconds: 600 + HELD_GRACE_SECONDS, holdingWatts: 150 })),
    ).toEqual({ heldWatts: 150, plannedWatts: 250, by: 'plan', why: 'different' });
    // And nothing is drawn or said for it inside the grace.
    const inside = input({ elapsedSeconds: 601, holdingWatts: 150 });
    expect(workoutGraphPaths(inside).plan.asked).toBe('');
    expect(workoutGraphText(inside)).not.toContain('where the plan asks');
  });

  const tops = (d: string): number => Math.min(...points(d).map(([, y]) => y));
  /** y for a share of threshold on this workout's scale: 100 % is 85 of the lane. */
  const planY = (share: number): number => Math.round((100 - share * 85) * 100) / 100;

  it('draws the rest of the block being ridden as what the plan asks, outlined, and what the trainer holds, shaded', () => {
    // Third block, planned 50 %; held 140 W is 56 %. 1500 s of 1800 s.
    const held = workoutGraphPaths(input({ elapsedSeconds: 1500, holdingWatts: 140 })).plan;
    // What the plan asks: an outline from now to the block's end, at 50 %.
    expect(tops(held.asked)).toBe(planY(0.5));
    expect(Math.min(...xs(held.asked))).toBeCloseTo((1500 / 1800) * CHART_WIDTH, 1);
    expect(Math.max(...xs(held.asked))).toBe(CHART_WIDTH);
    // What the trainer holds: a step over the same stretch, at 56 %.
    expect(tops(held.heldArea)).toBe(planY(0.56));
    expect(tops(held.heldEdge)).toBe(planY(0.56));
    expect(Math.min(...xs(held.heldArea))).toBeCloseTo((1500 / 1800) * CHART_WIDTH, 1);
    expect(Math.max(...xs(held.heldArea))).toBe(CHART_WIDTH);
    expect(held.heldArea.endsWith('Z')).toBe(true);
    // That stretch is not ALSO filled as the plan.
    expect(held.toCome.bands.join('')).toBe('');
    // And the blocks already ridden are untouched by it.
    const planned = workoutGraphPaths(input({ elapsedSeconds: 1500, holdingWatts: 125 })).plan;
    expect(held.done).toBe(planned.done);
    // With the trainer holding what the plan asks, neither shape is drawn.
    expect([planned.asked, planned.heldArea, planned.heldEdge]).toEqual(['', '', '']);
    expect(tops(planned.toCome.bands.join(''))).toBe(planY(0.5));
  });

  it('keeps every block still to come drawn as the plan asks', () => {
    // First block (150 W planned), eased to 0 W; two blocks are still to come.
    const eased = workoutGraphPaths(input({ elapsedSeconds: 300, holdingWatts: 0 })).plan;
    const later = blockChartPaths(timeline.segments.slice(1), {
      endSeconds: 1800,
      topShare: 1 / PLAN_FILL_SHARE,
    });
    expect(eased.toCome.bands.join('')).toBe(later.bands.join(''));
    expect(eased.toCome.bands.join('')).not.toBe('');
    // The plan's height for the block being ridden is still on the picture…
    expect(tops(eased.asked)).toBe(planY(0.6));
    // …and at 0 W there is no step to shade.
    expect([eased.heldArea, eased.heldEdge]).toEqual(['', '']);
  });

  it('raises the scale when the trainer holds more than the plan ever asks', () => {
    // 400 W of a 250 W threshold is 160 %: that, not the plan's 100 %, is the top.
    const { plan } = workoutGraphPaths(input({ elapsedSeconds: 300, holdingWatts: 400 }));
    expect(tops(plan.heldEdge)).toBeCloseTo(PLAN_LANE_HEIGHT * (1 - PLAN_FILL_SHARE), 6);
    const ys = points(plan.toCome.bands.join('') + plan.done + plan.asked).map(([, y]) => y);
    expect(Math.min(...ys)).toBeGreaterThan(tops(plan.heldEdge));
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
    // 140 W to 200 W is 60 W, under the least span (40 % of 200 W, 80 W): 10 W
    // is added either side to reach it and 4 W more to breathe.
    expect([lane.bottomWatts, lane.topWatts]).toEqual([120, 220]);
    // The scale's ends are drawn inset from the lane's edges.
    const y = (watts: number): number =>
      Math.round(
        (TRACE_LANE_HEIGHT -
          TRACE_LANE_INSET -
          ((watts - 120) / 100) * (TRACE_LANE_HEIGHT - 2 * TRACE_LANE_INSET)) *
          100,
      ) / 100;
    expect(points(lane.power).map(([, each]) => each)).toEqual([y(140), y(160), y(190)]);
    // The edge starts at the first target and steps to the second.
    expect(points(lane.targetEdge)[0]?.[1]).toBe(y(150));
    expect(points(lane.targetEdge).at(-1)?.[1]).toBe(y(200));
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

  it('draws a 0 W target above the lane’s bottom line, as a step with a height', () => {
    // An eased workout: the trainer confirmed 0 W and the rider has stopped.
    const { trace: lane } = workoutGraphPaths(
      input({ trace: [298, 299, 300].map((at) => sample(at, { target: 0, power: 0 })) }),
    );
    expect(lane.bottomWatts).toBe(0);
    // ⚠️ Literals, not the constant: 90 of the lane's 100 units, a tenth clear
    // of its floor. With no inset this is 100, the lane's own bottom line.
    const edge = points(lane.targetEdge).map(([, y]) => y);
    expect(new Set(edge)).toEqual(new Set([90]));
    // The shaded step runs from that edge down to the lane's floor.
    const area = points(lane.targetArea).map(([, y]) => y);
    expect(Math.max(...area)).toBe(100);
    expect(Math.min(...area)).toBe(90);
  });

  it('uses the lane when the window already spans a lot: intervals', () => {
    // 138 W and 263 W: 125 W apart, more than the least span, so only the
    // breathing room is added and the two targets sit near the lane's ends.
    const { trace: lane } = workoutGraphPaths(
      input({
        trace: [sample(298, { target: 138, power: 138 }), sample(300, { target: 263, power: 263 })],
      }),
    );
    expect([lane.bottomWatts, lane.topWatts]).toEqual([130, 270]);
  });

  it('writes a vertex only where the target changes, so a steady target is one line', () => {
    const { trace: lane } = workoutGraphPaths(
      input({ trace: Array.from({ length: 300 }, (_, index) => sample(1 + index)) }),
    );
    expect(points(lane.targetEdge)).toHaveLength(2);
  });

  it('ends the last step at the newest sample, and a step before a gap where the gap starts', () => {
    const x = (at: number): number =>
      Math.round((at / TRACE_WINDOW_SECONDS) * CHART_WIDTH * 100) / 100;
    const { trace: lane } = workoutGraphPaths(
      input({
        trace: [
          sample(280),
          sample(285),
          // Control lost: no confirmed target from here…
          sample(290, { target: undefined }),
          // …and back.
          sample(295),
          sample(300),
        ],
      }),
    );
    const runs = lane.targetEdge.split('M').filter((run) => run !== '');
    expect(runs).toHaveLength(2);
    // The first run was held until the sample that has no target: 290, not 285.
    expect(Math.max(...xs(`M${runs[0] ?? ''}`))).toBe(x(290));
    // The last run ends at the newest sample, which is now: nothing is known after it.
    expect(Math.max(...xs(`M${runs[1] ?? ''}`))).toBe(x(300));
    expect(Math.min(...xs(`M${runs[1] ?? ''}`))).toBe(x(295));
    // And the shaded area ends where its edge does.
    expect(Math.max(...xs(lane.targetArea))).toBe(x(300));
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

  it('is not drawn outside a hold', () => {
    const paths = workoutGraphPaths(input({ trace: [sample(300, { heartRate: 120 })] }));
    expect(paths.heartRate).toBeUndefined();
  });

  it('is drawn while a hold has run inside the window', () => {
    expect(workoutGraphPaths(input({ trace: hold })).heartRate).toBeDefined();
  });

  it('says the range’s two edges and where each is drawn, for the numbers beside the lane', () => {
    const lane = workoutGraphPaths(input({ trace: hold })).heartRate;
    expect([lane?.low, lane?.high]).toEqual([130, 140]);
    // A lane from 123 bpm (bottom) to 146 (top): 140 is 6 of 23 down, 130 is 16.
    expect(lane?.highAt).toBeCloseTo(6 / 23, 2);
    expect(lane?.lowAt).toBeCloseTo(16 / 23, 2);
  });

  it('draws the range’s two edges as open lines, apart from the band they bound', () => {
    const lane = workoutGraphPaths(input({ trace: hold })).heartRate;
    if (lane === undefined) throw new Error('no heart-rate lane');
    expect(lane.rangeEdges.match(/M/g)).toHaveLength(2);
    expect(lane.rangeEdges).not.toContain('Z');
    const ys = new Set(points(lane.rangeEdges).map(([, y]) => y));
    expect(ys).toEqual(new Set(points(lane.range).map(([, y]) => y)));
    expect(ys.size).toBe(2);
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
    const heights = points(lane.targetEdge).map(([, y]) => y);
    expect(heights).toHaveLength(4);
    expect(heights[1]).toBe(heights[0]);
    expect(heights[2]).toBeGreaterThan(heights[0] ?? Infinity);
    expect(heights[3]).toBe(heights[2]);
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
    // 150 % is harder than anything in the plan that stands, so it sets the top.
    expect(Math.min(...points(plan.replaced).map(([, y]) => y))).toBeCloseTo(15, 6);
    // …and the plan that stands is drawn on that same scale: 100 % at two thirds of it.
    const standing = points(plan.toCome.bands.join('') + plan.done).map(([, y]) => y);
    expect(Math.min(...standing)).toBeCloseTo(100 - (1 / 1.5) * 85, 1);
  });
});

describe('a re-plan that shortened the plan — #1244’s review', () => {
  /** A 30-minute plan that was 40 minutes: the old last block ended 600 s later. */
  const longer = expandWorkout({
    name: 'before',
    blocks: [steady(1800, 0.6), steady(600, 0.6)],
  }).segments;

  it('draws the whole of what was replaced inside the chart, not past its right edge', () => {
    const { plan } = workoutGraphPaths(input({ replaced: longer, holdingWatts: undefined }));
    const xs = points(plan.replaced).map(([x]) => x);
    expect(Math.max(...xs)).toBeCloseTo(1000, 6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1000);
  });

  it('draws the plan that stands on the same, longer, scale: it ends at three quarters of the lane', () => {
    const { plan } = workoutGraphPaths(input({ replaced: longer, holdingWatts: undefined }));
    const standing = points(plan.toCome.bands.join('') + plan.done).map(([x]) => x);
    expect(Math.max(...standing)).toBeCloseTo(750, 6);
    // And "now" is on it too: 300 s of 2400.
    expect(plan.nowFraction).toBeCloseTo(300 / 2400, 6);
  });

  it('leaves the scale the plan’s own when what was replaced was no longer', () => {
    const same = workoutGraphPaths(
      input({ replaced: input().timeline.segments, holdingWatts: undefined }),
    );
    const none = workoutGraphPaths(input({ holdingWatts: undefined }));
    expect(same.plan.nowFraction).toBe(none.plan.nowFraction);
    expect(same.plan.done).toBe(none.plan.done);
  });
});

describe('the graph in words — #1307', () => {
  it('says how far in, what is left of the block, the confirmed target and the rider’s power', () => {
    expect(workoutGraphText(input({ trace: [sample(300, { power: 147.6 })] }))).toBe(
      'Workout graph. 5 min of 30 min ridden. 5:00 left in this block. Target the trainer last ' +
        'confirmed: 150 W. Your power: 148 W.',
    );
  });

  it('says both numbers when the trainer holds something the plan did not ask', () => {
    expect(workoutGraphText(input({ elapsedSeconds: 1500, holdingWatts: 140 }))).toBe(
      'Workout graph. 25 min of 30 min ridden. 5:00 left in this block. Target the trainer last ' +
        'confirmed: 140 W, where the plan asks for 125 W.',
    );
  });

  it('says no target and no power where there is neither, rather than a zero', () => {
    expect(
      workoutGraphText(
        input({ holdingWatts: undefined, trace: [sample(300, { power: undefined })] }),
      ),
    ).toBe('Workout graph. 5 min of 30 min ridden. 5:00 left in this block.');
  });

  it('says nothing is left of a block once the workout is over', () => {
    expect(workoutGraphText(input({ elapsedSeconds: 1800, holdingWatts: undefined }))).toBe(
      'Workout graph. 30 min of 30 min ridden.',
    );
  });

  it('reads the sample the graph draws: nothing outside the window or later than now', () => {
    // A sample five seconds AHEAD of now, and one older than the window.
    const ahead = input({
      elapsedSeconds: 400,
      holdingWatts: undefined,
      trace: [sample(50, { power: 111 }), sample(405, { power: 999 })],
    });
    expect(workoutGraphText(ahead)).not.toContain('Your power');
    expect(workoutGraphLabels(ahead).trace.reading).toBe('No target · No power reading');
    expect(workoutStripText(ahead)).toBe('No target · 3:20 left in block');
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

  it('says what the dotted outline is once a re-plan supplies one', () => {
    expect(workoutGraphText(input())).not.toContain('dotted');
    expect(workoutGraphText(input({ replaced: timeline.segments }))).toContain(
      'The dotted outline is the plan before it was changed.',
    );
  });
});

describe('the numbers written on the lanes — #1307', () => {
  const range = { low: 130, high: 140 };

  it('writes the clock on the plan lane: elapsed and total', () => {
    expect(workoutGraphLabels(input({ elapsedSeconds: 312 })).plan).toEqual({
      title: 'Whole workout',
      reading: '5:12 of 30:00',
    });
  });

  it('writes the confirmed target and the rider’s power, in watts, on the last lane', () => {
    expect(
      workoutGraphLabels(input({ trace: [sample(300, { target: 150, power: 147.6 })] })).trace,
    ).toEqual({ title: 'Last 5 min', reading: 'Target 150 W · You 148 W' });
  });

  it('writes what the plan asks beside the target when the trainer holds something else', () => {
    expect(
      workoutGraphLabels(
        input({
          elapsedSeconds: 1500,
          holdingWatts: 140,
          trace: [sample(1500, { target: 140, power: 139 })],
        }),
      ).trace.reading,
    ).toBe('Target 140 W (plan asks 125 W) · You 139 W');
  });

  it('writes no target once control is lost, never the last write', () => {
    // `holdingWatts` outlives the link; without control it is not a held target.
    expect(
      workoutGraphLabels(
        input({
          holdingWatts: 150,
          hasControl: false,
          trace: [sample(300, { target: undefined, power: undefined })],
        }),
      ).trace.reading,
    ).toBe('No target · No power reading');
  });

  it('writes heart rate and the range only while a hold has run inside the window', () => {
    expect(workoutGraphLabels(input({ trace: [sample(300, { heartRate: 136 })] })).heartRate).toBe(
      undefined,
    );
    expect(
      workoutGraphLabels(input({ trace: [sample(300, { heartRate: 136.4, range })] })).heartRate,
    ).toEqual({ title: 'Heart rate', reading: '136 bpm' });
    expect(workoutGraphLabels(input({ trace: [sample(300, { range })] })).heartRate?.reading).toBe(
      'No reading',
    );
  });
});

describe('what is said under the graph — #1307', () => {
  const range = { low: 130, high: 140 };

  it('is nothing for a plain workout or a hold: the lanes carry their own titles', () => {
    expect(workoutGraphKey(input())).toBe('');
    expect(workoutGraphKey(input({ trace: [sample(300, { range })] }))).toBe('');
  });

  it('says what the dashed outline and the shaded step at the line are, with both numbers', () => {
    const raised = input({ elapsedSeconds: 1500, holdingWatts: 140 });
    expect(workoutGraphKey(raised)).toBe(
      'At the line, the dashed outline is what the plan asks for now, 125\u00a0W. ' +
        'The shaded step is what the trainer confirmed instead, 140\u00a0W.',
    );
  });

  it('does not point at a shaded step that is not there: 0 W', () => {
    expect(graphKeyHeld({ heldWatts: 0, plannedWatts: 225, by: 'plan', why: 'different' })).toBe(
      'At the line, the dashed outline is what the plan asks for now, 225\u00a0W. The trainer ' +
        'confirmed 0\u00a0W instead, so nothing is shaded.',
    );
  });

  it('keeps each number with its unit when the sentence wraps: a no-break space', () => {
    const sentence = graphKeyHeld({
      heldWatts: 100,
      plannedWatts: 75,
      by: 'plan',
      why: 'different',
    });
    expect(sentence).toContain('75\u00a0W.');
    expect(sentence).toContain('100\u00a0W.');
    expect(sentence).not.toMatch(/\d W/);
    expect(
      graphKeyHeld({ heldWatts: 0, plannedWatts: 225, by: 'plan', why: 'different' }),
    ).not.toMatch(/\d W/);
  });

  it('names the heart-rate hold as the one asking, inside a hold', () => {
    expect(graphKeyHeld({ heldWatts: 100, plannedWatts: 119, by: 'hold', why: 'different' })).toBe(
      'At the line, the dashed outline is what the heart-rate hold asks for now, 119\u00a0W. The ' +
        'shaded step is what the trainer confirmed instead, 100\u00a0W.',
    );
  });

  it('says what the dotted outline is once a re-plan supplies one, and only that', () => {
    expect(workoutGraphKey(input({ replaced: timeline.segments }))).toBe(GRAPH_KEY_REPLACED);
  });
});

describe('a heart-rate hold’s own target is not held instead — #1307, the owner’s ruling', () => {
  const range = { low: 130, high: 140 };
  /** One 30-minute hold block that starts at 50 % (125 W of 250 W). */
  const holdTimeline = expandWorkout({
    name: 'hold',
    blocks: [
      {
        kind: 'heart-rate-hold',
        seconds: seconds(1800),
        range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
        startShare: thresholdShare(0.5),
        ceilingShare: thresholdShare(0.8),
      },
    ],
  });
  /** The hold asked `asked` and the trainer confirmed `target`, each second from `from`. */
  const seconds_ = (from: number, to: number, target: number, asked: number) =>
    Array.from({ length: to - from + 1 }, (_, index) =>
      sample(from + index, { target, asked, range, heartRate: 142 }),
    );
  const inHold = (overrides: Partial<WorkoutGraphInput> = {}): WorkoutGraphInput =>
    input({
      timeline: holdTimeline,
      elapsedSeconds: 600,
      holdingWatts: 119,
      hold: { reason: 'lowered', target: 119 },
      trace: seconds_(590, 600, 119, 119),
      ...overrides,
    });

  it('marks nothing while the trainer holds what the hold set, however far from the block’s share', () => {
    // 119 W where the block started at 125 W: the old rule called this held instead.
    const held = inHold();
    expect(heldInstead(held)).toBeUndefined();
    expect(workoutGraphPaths(held).plan.asked).toBe('');
    expect(workoutGraphPaths(held).plan.heldArea).toBe('');
    expect(workoutGraphLabels(held).trace.reading).toBe('Target 119 W · You 148 W');
    expect(workoutGraphText(held)).toContain('Target the trainer last confirmed: 119 W.');
    expect(workoutGraphText(held)).not.toContain('asks for');
    expect(workoutGraphKey(held)).toBe('');
    // The control: the same numbers with NO hold running are held instead.
    expect(heldInstead(inHold({ hold: undefined }))).toEqual({
      heldWatts: 119,
      plannedWatts: 125,
      by: 'plan',
      why: 'different',
    });
  });

  it('judges a hold that is OFF by the plan, as any block', () => {
    // `ineligible`: the block rides its planned 125 W. 140 W is the machine's minimum.
    expect(
      heldInstead(inHold({ holdingWatts: 140, hold: { reason: 'ineligible', target: 125 } })),
    ).toEqual({ heldWatts: 140, plannedWatts: 125, by: 'plan', why: 'different' });
  });

  it('does not mark the second it takes a new hold target to be acknowledged', () => {
    // The hold lowered its target to 109 W two seconds ago; the trainer still says 119 W.
    const moving = inHold({
      hold: { reason: 'lowered', target: 109 },
      trace: [...seconds_(590, 598, 119, 119), ...seconds_(599, 600, 119, 109)],
    });
    expect(heldInstead(moving)).toBeUndefined();
  });

  it('does not mark a hold that is ramping: a step behind in every sample, and moving', () => {
    // The hold raises its target 3 W every second; each second's sample is
    // taken while that second's write is still on its way.
    const ramping = inHold({
      holdingWatts: 139,
      hold: { reason: 'raised', target: 142 },
      trace: Array.from({ length: 11 }, (_, index) =>
        sample(590 + index, {
          target: 109 + index * 3,
          asked: 112 + index * 3,
          range,
          heartRate: 120,
        }),
      ),
    });
    expect(heldInstead(ramping)).toBeUndefined();
  });

  it('marks an eased hold for as long as the rescue is in force, with no number the hold did not ask', () => {
    // ⚠️ What the player really hands over in a relief step: the hold's own
    // target IS the eased number (H9), so confirmed and "asked" agree.
    const relief = inHold({
      holdingWatts: 87,
      hold: { reason: 'lowered', target: 87 },
      rescue: { kind: 'relief' },
      trace: seconds_(590, 600, 87, 87),
    });
    expect(heldInstead(relief)).toEqual({
      heldWatts: 87,
      plannedWatts: undefined,
      by: 'hold',
      why: 'eased',
    });
    expect(workoutGraphLabels(relief).trace.reading).toBe('Target 87 W (hold eased) · You 148 W');
    expect(workoutGraphText(relief)).toContain(
      'Target the trainer last confirmed: 87 W. The heart-rate hold is eased.',
    );
    expect(workoutGraphText(relief)).not.toContain('asks for');
    expect(workoutGraphKey(relief)).toBe(
      'At the line, the shaded step is what the trainer holds while the heart-rate hold is ' +
        'eased, 87\u00a0W.',
    );
    // A shaded step at what the trainer holds, and NO outline: nothing is known to outline.
    const { plan } = workoutGraphPaths(relief);
    const top = (d: string): number => Math.min(...points(d).map(([, y]) => y));
    expect(plan.asked).toBe('');
    expect(top(plan.heldEdge)).toBeCloseTo(100 - (87 / 125) * 85, 1);
    // At the rescue's floor there is no step either, and the sentence says so.
    const floor = inHold({
      holdingWatts: 0,
      hold: { reason: 'lowered', target: 87 },
      rescue: { kind: 'floor' },
    });
    expect(heldInstead(floor)?.why).toBe('eased');
    expect(workoutGraphPaths(floor).plan.heldArea).toBe('');
    expect(workoutGraphKey(floor)).toBe(
      'The heart-rate hold is eased and the trainer confirmed 0\u00a0W, so nothing is shaded ' +
        'at the line.',
    );
    // The same numbers with no rescue: the hold set it, and nothing is marked.
    expect(heldInstead({ ...relief, rescue: undefined })).toBeUndefined();
  });

  it('marks a difference that has LASTED: a floor the hold did not know, or a refusal', () => {
    // The hold has asked 90 W for ten seconds and the trainer has said 100 W throughout.
    const clamped = inHold({
      holdingWatts: 100,
      hold: { reason: 'lowered', target: 90 },
      trace: seconds_(590, 600, 100, 90),
    });
    expect(heldInstead(clamped)).toEqual({
      heldWatts: 100,
      plannedWatts: 90,
      by: 'hold',
      why: 'different',
    });
    // Exactly at the grace: the mismatch began 3 s ago.
    const justLong = inHold({
      holdingWatts: 100,
      hold: { reason: 'lowered', target: 90 },
      trace: [...seconds_(590, 596, 100, 100), ...seconds_(597, 600, 100, 90)],
    });
    expect(heldInstead(justLong)?.by).toBe('hold');
    const notYet = inHold({
      holdingWatts: 100,
      hold: { reason: 'lowered', target: 90 },
      trace: [...seconds_(590, 597, 100, 100), ...seconds_(598, 600, 100, 90)],
    });
    expect(heldInstead(notYet)).toBeUndefined();
  });

  it('needs the trace to say the difference lasted: with no `asked` in it, nothing is marked', () => {
    expect(
      heldInstead(
        inHold({
          holdingWatts: 100,
          hold: { reason: 'lowered', target: 90 },
          trace: [sample(600, { target: 100, range })],
        }),
      ),
    ).toBeUndefined();
  });
});

describe('one source for what the trainer holds, read live — #1307’s third review', () => {
  const range = { low: 130, high: 140 };
  /** In the first block (150 W asked), five minutes in, with a sample taken before a pause. */
  const before = [
    sample(299, { target: 150, power: 152 }),
    sample(300, { target: 150, power: 152 }),
  ];

  it('in a pause every text says what the trainer holds NOW and the power NOW, not the last sample’s', () => {
    // The pause eased the trainer to its floor, 50 W; no sample is taken while paused.
    const paused = input({
      status: 'paused',
      holdingWatts: 50,
      live: { power: 48, heartRate: undefined },
      trace: before,
    });
    expect(workoutGraphLabels(paused).trace.reading).toBe('Paused · Target 50 W · You 48 W');
    expect(workoutStripText(paused)).toBe('Paused · Target 50 W');
    expect(workoutGraphText(paused)).toBe(
      'Workout graph. Paused. 5 min of 30 min ridden. 5:00 left in this block. Target the ' +
        'trainer last confirmed: 50 W. Your power: 48 W.',
    );
    // Nothing is marked as held instead: the plan asks nothing while its clock is stopped.
    expect(heldInstead(paused)).toBeUndefined();
    expect(workoutGraphKey(paused)).toBe('');
    const { plan } = workoutGraphPaths(paused);
    expect([plan.asked, plan.heldArea, plan.heldEdge]).toEqual(['', '', '']);
    // The control: the same input running IS held instead (50 W where 150 W is asked).
    expect(heldInstead({ ...paused, status: 'running' })?.heldWatts).toBe(50);
  });

  it('in a pause inside a hold the strip says the pause, not the hold’s last line', () => {
    const paused = input({
      status: 'paused',
      holdingWatts: 0,
      // `hold` is undefined while paused; the samples still carry the range.
      live: { power: 0, heartRate: 121 },
      trace: [sample(300, { target: 115, heartRate: 128, range })],
    });
    expect(workoutStripText(paused)).toBe('Paused · Target 0 W');
    expect(workoutGraphLabels(paused).trace.reading).toBe('Paused · Target 0 W · You 0 W');
    expect(workoutGraphLabels(paused).heartRate?.reading).toBe('121 bpm');
    expect(workoutGraphText(paused)).not.toContain('asks for');
  });

  it('with no target confirmed at all, a pause says so', () => {
    expect(
      workoutStripText(input({ status: 'paused', holdingWatts: undefined, trace: before })),
    ).toBe('Paused · No target');
  });

  it('after control is lost nothing is "confirmed instead": the last write is not a held target', () => {
    // Second block: the plan asks 250 W; 150 W is the block before, last written before the loss.
    const lost = input({
      elapsedSeconds: 700,
      holdingWatts: 150,
      hasControl: false,
      live: { power: 148, heartRate: undefined },
      trace: [sample(700, { target: undefined, power: 148 })],
    });
    expect(heldNow(lost)).toBeUndefined();
    expect(heldInstead(lost)).toBeUndefined();
    expect(workoutGraphKey(lost)).toBe('');
    const { plan } = workoutGraphPaths(lost);
    expect([plan.asked, plan.heldArea, plan.heldEdge]).toEqual(['', '', '']);
    expect(plan.toCome.bands.join('')).not.toBe('');
    expect(workoutGraphLabels(lost).trace.reading).toBe('No target · You 148 W');
    expect(workoutStripText(lost)).toBe('No target · 8:20 left in block');
    // The name keeps what was last confirmed, and adds no "where the plan asks".
    expect(workoutGraphText(lost)).toContain('Target the trainer last confirmed: 150 W.');
    expect(workoutGraphText(lost)).not.toContain('asks for');
    // The control: with control the same numbers ARE a different target.
    expect(heldInstead({ ...lost, hasControl: true })).toEqual({
      heldWatts: 150,
      plannedWatts: 250,
      by: 'plan',
      why: 'different',
    });
  });

  it('reads the live readings where it is given them, and the newest sample’s only where it is not', () => {
    const stale = input({ live: { power: undefined, heartRate: undefined }, trace: before });
    expect(workoutGraphLabels(stale).trace.reading).toBe('Target 150 W · No power reading');
    expect(workoutGraphText(stale)).not.toContain('Your power');
    expect(workoutGraphLabels(input({ trace: before })).trace.reading).toBe(
      'Target 150 W · You 152 W',
    );
  });

  it('reads the target from what the trainer holds, never from a sample', () => {
    // The newest sample says 225 W; the trainer holds 150 W.
    const drifted = input({ trace: [sample(300, { target: 225, power: 225 })] });
    expect(workoutGraphLabels(drifted).trace.reading).toBe('Target 150 W · You 225 W');
    expect(workoutStripText(drifted)).toBe('Target 150 W · 5:00 left in block');
  });
});

describe('a block whose target was not sent — #1305, drawn by #1307', () => {
  // Third block: the plan asks 125 W (50 % of 250 W).
  const refused = (overrides: Partial<WorkoutGraphInput> = {}): WorkoutGraphInput =>
    input({
      elapsedSeconds: 1500,
      holdingWatts: undefined,
      refused: true,
      trace: [sample(1500, { target: undefined })],
      ...overrides,
    });

  it('is marked at once, outlined at what the plan asks, with NO shaded step', () => {
    expect(heldInstead(refused())).toEqual({
      heldWatts: undefined,
      plannedWatts: 125,
      by: 'plan',
      why: 'not-sent',
    });
    // At once: in the block's first second too. The refusal is the session's own fact.
    expect(heldInstead(refused({ elapsedSeconds: 1200 }))?.why).toBe('not-sent');
    const { plan } = workoutGraphPaths(refused());
    expect(plan.asked).not.toBe('');
    expect([plan.heldArea, plan.heldEdge]).toEqual(['', '']);
  });

  it('says no target was sent, in the caption, the strip, the sentence and the name', () => {
    expect(workoutGraphLabels(refused()).trace.reading).toBe(
      'No target sent (plan asks 125 W) · You 148 W',
    );
    expect(workoutStripText(refused())).toBe('No target sent · 5:00 left in block');
    expect(workoutGraphKey(refused())).toBe(
      'At the line, the dashed outline is what the plan asks for now, 125\u00a0W. No target ' +
        'was sent for it, so nothing is shaded.',
    );
    expect(workoutGraphText(refused())).toBe(
      'Workout graph. 25 min of 30 min ridden. 5:00 left in this block. No target was sent for ' +
        'this block, which asks for 125 W. Your power: 148 W.',
    );
  });

  it('does not pass off a target left from before as this block’s: no step, and the name says where it is from', () => {
    const leftOver = refused({ holdingWatts: 150 });
    expect(heldInstead(leftOver)?.heldWatts).toBe(150);
    expect(workoutGraphPaths(leftOver).plan.heldArea).toBe('');
    expect(workoutGraphLabels(leftOver).trace.reading).toBe(
      'No target sent (plan asks 125 W) · You 148 W',
    );
    expect(workoutGraphText(leftOver)).toContain(
      'No target was sent for this block, which asks for 125 W. The trainer still holds 150 W ' +
        'from before it.',
    );
    expect(workoutGraphText(leftOver)).not.toContain('last confirmed');
  });
});

describe('raised to the trainer’s minimum, by the session’s own word — #1305, #1307', () => {
  it('is marked at once, inside the grace too: the session says it only once it has landed', () => {
    // Second block starts at 600 s. One second in, and the session already says so.
    expect(
      heldInstead(input({ elapsedSeconds: 601, holdingWatts: 100, raisedFromWatts: 75 })),
    ).toEqual({ heldWatts: 100, plannedWatts: 75, by: 'plan', why: 'different' });
  });

  it('marks a clamp INSIDE a ramp, which the numbers alone cannot see', () => {
    // 80 % down to 20 % of 250 W over ten minutes, on a machine whose minimum is 100 W.
    const ramp = expandWorkout({
      name: 'ramp',
      blocks: [
        { kind: 'ramp', seconds: seconds(600), from: thresholdShare(0.8), to: thresholdShare(0.2) },
      ],
    });
    // At 540 s the plan asks 65 W; the trainer holds its 100 W minimum.
    const clamped = input({ timeline: ramp, elapsedSeconds: 540, holdingWatts: 100 });
    // By the numbers 100 W is inside what the ramp ever asks (50 W to 200 W): not marked.
    expect(heldInstead(clamped)).toBeUndefined();
    // With the session's word it is.
    const said = { ...clamped, raisedFromWatts: 65 };
    expect(heldInstead(said)).toEqual({
      heldWatts: 100,
      plannedWatts: 65,
      by: 'plan',
      why: 'different',
    });
    // The outline is the rest of the RAMP, and the step is flat at what the trainer holds.
    const { plan } = workoutGraphPaths(said);
    const ys = (d: string): readonly number[] => points(d).map(([, y]) => y);
    expect(new Set(ys(plan.asked)).size).toBeGreaterThan(2);
    expect(new Set(ys(plan.heldEdge)).size).toBe(1);
    expect(workoutGraphLabels(said).trace.reading).toBe(
      'Target 100 W (plan asks 65 W) · No power reading',
    );
  });
});

describe('the boundaries, each pinned — #1307’s third review', () => {
  const range = { low: 130, high: 140 };

  it('a plain block: 2 W off the plan is the plan, 3 W is not, either side', () => {
    // First block asks 150 W.
    expect(heldInstead(input({ holdingWatts: 152 }))).toBeUndefined();
    expect(heldInstead(input({ holdingWatts: 148 }))).toBeUndefined();
    expect(heldInstead(input({ holdingWatts: 153 }))?.heldWatts).toBe(153);
    expect(heldInstead(input({ holdingWatts: 147 }))?.heldWatts).toBe(147);
  });

  const holdTimeline = expandWorkout({
    name: 'hold',
    blocks: [
      {
        kind: 'heart-rate-hold',
        seconds: seconds(1800),
        range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
        startShare: thresholdShare(0.5),
        ceilingShare: thresholdShare(0.8),
      },
    ],
  });
  const stuck = (confirmed: number, asked: number, from = 590): WorkoutGraphInput =>
    input({
      timeline: holdTimeline,
      elapsedSeconds: 600,
      holdingWatts: confirmed,
      hold: { reason: 'lowered', target: asked },
      trace: Array.from({ length: 600 - from + 1 }, (_, index) =>
        sample(from + index, { target: confirmed, asked, range, heartRate: 142 }),
      ),
    });

  it('a hold: stuck 2 W from what the hold asks is the hold’s, 3 W is not', () => {
    expect(heldInstead(stuck(121, 119))).toBeUndefined();
    expect(heldInstead(stuck(117, 119))).toBeUndefined();
    expect(heldInstead(stuck(122, 119))?.why).toBe('different');
    expect(heldInstead(stuck(116, 119))?.why).toBe('different');
  });

  it('a hold: what it asks NOW decides first, and exactly 2 W off is the hold’s', () => {
    // The trainer was stuck on 100 W for ten seconds while the hold asked
    // 90 W — and the hold now asks 98 W, which 100 W is within 2 W of.
    expect(
      heldInstead({ ...stuck(100, 90), hold: { reason: 'raised', target: 98 } }),
    ).toBeUndefined();
    // At 97 W it is 3 W off, and the ten seconds count.
    expect(
      heldInstead({ ...stuck(100, 90), hold: { reason: 'raised', target: 97 } })?.plannedWatts,
    ).toBe(97);
  });

  it('a hold: samples exactly 2 W apart do not count towards "stuck"', () => {
    // 100 W confirmed throughout. The hold asked 98 W (2 W off: its own) until
    // 597 s and 90 W since: stuck for 2 s, not 3. Were 2 W counted as a
    // difference the run would reach back to 590 s.
    const base = stuck(100, 90, 598);
    const input2: WorkoutGraphInput = {
      ...base,
      trace: [
        ...Array.from({ length: 8 }, (_, index) =>
          sample(590 + index, { target: 100, asked: 98, range, heartRate: 142 }),
        ),
        ...(base.trace ?? []),
      ],
    };
    expect(heldInstead(input2)).toBeUndefined();
  });

  it('time left in a block is rounded UP: 299.6 s left is 5:00, not 4:59', () => {
    expect(workoutGraphText(input({ elapsedSeconds: 300.4 }))).toContain(
      '5:00 left in this block.',
    );
    expect(workoutStripText(input({ elapsedSeconds: 300.4 }))).toBe(
      'Target 150 W · 5:00 left in block',
    );
  });

  it('after a hold has ended the lane, its caption and the name still agree, for as long as it is drawn', () => {
    // A hold ran until 298 s; the two newest samples are outside it.
    const ended = input({
      trace: [
        sample(296, { heartRate: 139, range }),
        sample(297, { heartRate: 139, range }),
        sample(299, { heartRate: 137 }),
        sample(300, { heartRate: 136 }),
      ],
    });
    // The lane is drawn…
    expect(workoutGraphPaths(ended).heartRate).toBeDefined();
    // …so it has its caption, with the heart rate NOW…
    expect(workoutGraphLabels(ended).heartRate).toEqual({
      title: 'Heart rate',
      reading: '136 bpm',
    });
    // …and the name says its numbers. The strip, which draws by what runs now, is power again.
    expect(workoutGraphText(ended)).toContain(
      'Heart rate: 136 bpm, with a chosen range of 130–140 bpm.',
    );
    expect(workoutStripPaths(ended).lane.kind).toBe('power');
  });

  it('the range written beside the lane is the NEWEST hold’s, not the oldest in the window', () => {
    const two = input({
      trace: [
        sample(290, { heartRate: 122, range: { low: 120, high: 128 } }),
        sample(300, { heartRate: 136, range }),
      ],
    });
    const lane = workoutGraphPaths(two).heartRate;
    expect([lane?.low, lane?.high]).toEqual([130, 140]);
    expect(workoutGraphText(two)).toContain('with a chosen range of 130–140 bpm.');
  });
});

describe('the HUD’s strip: one lane, a bar and a line of text — #1307', () => {
  const range = { low: 130, high: 140 };
  const plain = [
    sample(290, { target: 150, power: 140 }),
    sample(295, { target: 150, power: 160 }),
    sample(300, { target: 200, power: 190 }),
  ];
  const held = plain.map((each, index) => ({ ...each, heartRate: 128 + index * 6, range }));

  it('draws power against the confirmed target outside a hold', () => {
    const strip = workoutStripPaths(input({ trace: plain }));
    const graph = workoutGraphPaths(input({ trace: plain }));
    expect(strip.lane).toEqual({
      kind: 'power',
      target: graph.trace.targetEdge,
      power: graph.trace.power,
    });
    expect(strip.lane.kind === 'power' && strip.lane.target).not.toBe('');
    expect(strip.laneHeight).toBe(TRACE_LANE_HEIGHT);
  });

  it('draws heart rate against its range, and nothing else, while a hold is running', () => {
    const strip = workoutStripPaths(input({ trace: held }));
    const graph = workoutGraphPaths(input({ trace: held }));
    expect(strip.lane).toEqual({
      kind: 'heart-rate',
      range: graph.heartRate?.rangeEdges,
      heartRate: graph.heartRate?.line,
    });
    expect(strip.lane.kind === 'heart-rate' && strip.lane.heartRate).not.toBe('');
    expect(strip.laneHeight).toBe(HEART_RATE_LANE_HEIGHT);
  });

  it('chooses by what is running NOW: a hold that ended inside the window is power again', () => {
    const ended = [...held.slice(0, 2), sample(300, { target: 200, power: 190 })];
    expect(workoutStripPaths(input({ trace: ended })).lane.kind).toBe('power');
    // The Ride screen's graph, which has room, still draws the lane.
    expect(workoutGraphPaths(input({ trace: ended })).heartRate).toBeDefined();
  });

  it('fills the bar as far as now and marks it, standing out of the bar', () => {
    const { progress } = workoutStripPaths(input({ elapsedSeconds: 450 }));
    expect(progress.nowFraction).toBeCloseTo(0.25, 6);
    expect(Math.max(...xs(progress.done))).toBe(250);
    expect(progress.done.endsWith('Z')).toBe(true);
    const now = [...progress.now.matchAll(/-?[\d.]+/g)].map(Number);
    expect(now[0]).toBe(250);
    expect(now[1]).toBeLessThan(0);
    expect(now[2]).toBeGreaterThan(STRIP_PROGRESS_HEIGHT);
  });

  it('has nothing ridden at the start, and keeps the mark inside the bar past the end', () => {
    expect(workoutStripPaths(input({ elapsedSeconds: 0 })).progress.done).toBe('');
    expect(workoutStripPaths(input({ elapsedSeconds: -5 })).progress.nowFraction).toBe(0);
    expect(workoutStripPaths(input({ elapsedSeconds: 99_999 })).progress.nowFraction).toBe(1);
  });

  it('says the confirmed target and what is left of the block', () => {
    expect(workoutStripText(input({ elapsedSeconds: 450, trace: [sample(450)] }))).toBe(
      'Target 150 W · 2:30 left in block',
    );
  });

  it('says no target where the trainer holds none, and only the target past the end', () => {
    expect(
      workoutStripText(
        input({ elapsedSeconds: 450, holdingWatts: undefined, trace: [sample(450)] }),
      ),
    ).toBe('No target · 2:30 left in block');
    expect(workoutStripText(input({ elapsedSeconds: 1800, trace: [sample(1800)] }))).toBe(
      'Target 150 W',
    );
  });

  it('says no target in a hold where the trainer confirmed none', () => {
    expect(
      workoutStripText(
        input({ hasControl: false, trace: [sample(300, { heartRate: 136, range })] }),
      ),
    ).toBe('136 bpm, range 130–140 · No target');
  });

  it('says heart rate, the range and the target in a hold, and that there is no heart rate', () => {
    expect(workoutStripText(input({ trace: [sample(300, { heartRate: 136.4, range })] }))).toBe(
      '136 bpm, range 130–140 · Target 150 W',
    );
    expect(workoutStripText(input({ trace: [sample(300, { range })] }))).toBe(
      '— bpm, range 130–140 · Target 150 W',
    );
  });

  it('never writes a NaN into a path', () => {
    const paths = workoutStripPaths(
      input({
        totalSeconds: 0,
        trace: [sample(300, { heartRate: Number.NaN, range: { low: Number.NaN, high: 140 } })],
      } as Partial<WorkoutGraphInput>),
    );
    expect(JSON.stringify(paths)).not.toMatch(/NaN|Infinity/);
  });
});
