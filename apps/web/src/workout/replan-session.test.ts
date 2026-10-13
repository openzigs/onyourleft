// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The device half of re-plans, against the real player and the real
 * validator, with a scripted instance — #1244.
 *
 * What a TRAINER is sent is `ride/controller.test.ts` §"#1244"'s to read,
 * from the simulated trainer. This file holds the session's own rules: what
 * leaves, when, how often, what is dropped, and what is kept.
 */

import {
  beatsPerMinute,
  createWorkoutPlayer,
  expandWorkout,
  REPLAN_BOUNDARY_LEAD_SECONDS,
  REPLAN_FRESHNESS_SECONDS,
  seconds,
  thresholdShare,
  watts,
  type OwnThresholds,
  type Workout,
  type WorkoutBlock,
  type WorkoutGoals,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { JobSession } from '../ride-analysis/instance-job';

import { REPLAN_INPUT_BYTE_BUDGET } from './replan-job';
import {
  PERMANENT_REFUSALS,
  REPLAN_ASK_INTERVAL_SECONDS,
  REPLAN_MAXIMUM_BLOCKS,
  createReplanSession,
} from './replan-session';
import { scriptedReplans, type ScriptedReplans } from './replan-testing';
import { REPLAN_UNAVAILABLE } from './replan-text';

const steady = (length: number, share: number, label?: string): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
  ...(label === undefined ? {} : { label }),
});

/** A warm-up, three ten-minute blocks and a cool-down. */
const WORKOUT: Workout = {
  name: 'Tempo',
  blocks: [
    steady(300, 0.5, 'Warm up'),
    steady(600, 0.7),
    steady(600, 0.8),
    steady(600, 0.7),
    steady(300, 0.5),
  ],
};

const ATHLETE: OwnThresholds = {
  thresholdPower: watts(250),
  thresholdHeartRate: beatsPerMinute(170),
  assumed: { power: false, heartRate: false },
};

const START = 1000;

interface RigOptions {
  readonly workout?: Workout;
  readonly goals?: WorkoutGoals;
  readonly session?: () => Promise<JobSession>;
  /** In place of the player's own `revise`, for a player that will not take a plan. */
  readonly revise?: () => boolean;
  /** The ride's own memory of when it last asked, across workouts. */
  readonly asked?: { last: () => number | undefined; note: (at: number) => void };
}

function rig(options: RigOptions = {}) {
  const scripted: ScriptedReplans = scriptedReplans();
  const workout = options.workout ?? WORKOUT;
  const player = createWorkoutPlayer({
    timeline: expandWorkout(workout),
    thresholdPower: ATHLETE.thresholdPower,
  });
  let now = START;
  const facts = {
    rescue: false,
    control: true,
    heartRatePaired: true,
    power: 150 as number | undefined,
    heartRate: 140 as number | undefined,
    cadence: 90 as number | undefined,
  };
  let changes = 0;
  const session = createReplanSession({
    loaded: workout,
    athlete: ATHLETE,
    machine: { minimum: watts(0), maximum: watts(1000) },
    goals: options.goals ?? {},
    library: [],
    session: options.session ?? (() => Promise.resolve(scripted.session)),
    ride: () => ({ status: player.state().status, elapsed: player.state().elapsed, ...facts }),
    plan: () => player.plan(),
    revise: options.revise ?? ((timeline) => player.revise(timeline)),
    keepPlan: () => player.keepPlan(),
    clock: () => seconds(now),
    ...(options.asked === undefined
      ? {}
      : {
          asked: {
            last: () => {
              const at = options.asked?.last();
              return at === undefined ? undefined : seconds(at);
            },
            note: (at) => options.asked?.note(at),
          },
        }),
    onChange: () => {
      changes += 1;
    },
  });
  player.start(seconds(now));

  const flush = async (): Promise<void> => {
    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
    }
  };
  /** Every target the player asked for, in watts, in order. */
  const asked: number[] = [];
  const ride = async (forSeconds: number): Promise<void> => {
    for (let index = 0; index < forSeconds; index += 1) {
      now += 1;
      const state = player.tick(seconds(now));
      if (state.intent.kind === 'write-target') {
        asked.push(state.intent.watts);
        player.acknowledge(state.intent.watts);
      }
      session.tick(seconds(now));
      await flush();
    }
  };
  return {
    scripted,
    player,
    session,
    facts,
    asked,
    ride,
    flush,
    changes: () => changes,
    /** Move the clock with no tick: the time between two ticks. */
    wait: (forSeconds: number) => {
      now += forSeconds;
    },
    pause: () => {
      player.pause(seconds(now));
      session.tick(seconds(now));
    },
    /** The ride's clock now, for acting on the player between two of the session's ticks. */
    clock: () => seconds(now),
    resume: () => {
      player.resume(seconds(now));
    },
  };
}

/** A proposal naming the first request of a ride on the loaded plan. */
const proposal = (move: unknown, overrides: Record<string, unknown> = {}): unknown => ({
  revision: 0,
  summarySeq: 1,
  move,
  reason: 'on-plan',
  ...overrides,
});

const SHORTEN_NEXT = { kind: 'shorten-block', block: 2, minutes: 2 };

const inputOf = (scripted: ScriptedReplans, index = 0): Record<string, unknown> =>
  (scripted.starts()[index] as { input: Record<string, unknown> }).input;

describe('what is sent, and when', () => {
  it('sends nothing during the first block, and one request as the second begins', async () => {
    const r = rig();
    await r.ride(299);
    expect(r.scripted.requests).toEqual([]);
    await r.ride(1);
    expect(r.scripted.starts()).toHaveLength(1);
    // And not another, however long that block lasts.
    await r.ride(500);
    expect(r.scripted.starts()).toHaveLength(1);
  });

  it('sends exactly the request the instance reads: three keys, six keys, one summary', async () => {
    const r = rig();
    await r.ride(300);
    const body = r.scripted.starts()[0] ?? {};
    expect(Object.keys(body).sort()).toEqual(['input', 'source', 'templateVersion']);
    expect(body.templateVersion).toBe('re-plan-1');
    expect(body.source).toBe('instance-local');
    const input = inputOf(r.scripted);
    expect(Object.keys(input).sort()).toEqual([
      'blocks',
      'currentBlock',
      'goals',
      'revision',
      'summaries',
      'summarySeq',
    ]);
    expect(input.revision).toBe(0);
    expect(input.summarySeq).toBe(1);
    expect(input.currentBlock).toBe(1);
    expect(input.summaries).toEqual([
      {
        block: 0,
        seconds: 300,
        meanHeartRate: 140,
        highestHeartRate: 140,
        meanPowerShare: 0.6,
        meanCadence: 90,
        rescues: 0,
      },
    ]);
  });

  it('sends the blocks as shares with no label, and no workout name', async () => {
    const r = rig();
    await r.ride(300);
    const input = inputOf(r.scripted);
    expect(input.blocks).toEqual([
      { kind: 'steady', seconds: 300, target: 0.5 },
      { kind: 'steady', seconds: 600, target: 0.7 },
      { kind: 'steady', seconds: 600, target: 0.8 },
      { kind: 'steady', seconds: 600, target: 0.7 },
      { kind: 'steady', seconds: 300, target: 0.5 },
    ]);
    const sent = JSON.stringify(r.scripted.starts()[0]);
    expect(sent).not.toContain('Warm up');
    expect(sent).not.toContain('Tempo');
  });

  it('sends the typed goals without the time-in-range target — spike 0022 R1', async () => {
    const r = rig({
      goals: { sessionType: 'tempo', durationMinutes: 60, timeInRangeMinutes: 30 },
    });
    await r.ride(300);
    expect(inputOf(r.scripted).goals).toEqual({ sessionType: 'tempo', durationMinutes: 60 });
  });

  it('leaves out a figure nothing was read for, rather than sending a zero', async () => {
    const r = rig();
    r.facts.heartRate = undefined;
    r.facts.power = undefined;
    r.facts.cadence = undefined;
    await r.ride(300);
    expect(inputOf(r.scripted).summaries).toEqual([{ block: 0, seconds: 300, rescues: 0 }]);
  });

  it('counts a hold block’s seconds in range, its highest heart rate and its rescues', async () => {
    const hold: WorkoutBlock = {
      kind: 'heart-rate-hold',
      seconds: seconds(300),
      range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
      startShare: thresholdShare(0.5),
      ceilingShare: thresholdShare(0.8),
    };
    const r = rig({
      workout: { name: 'Hold', blocks: [hold, steady(600, 0.6), steady(300, 0.5)] },
    });
    await r.ride(100);
    r.facts.heartRate = 150;
    await r.ride(100);
    r.facts.heartRate = 135;
    r.facts.rescue = true;
    await r.ride(10);
    r.facts.rescue = false;
    await r.ride(90);
    const [summary] = inputOf(r.scripted).summaries as Record<string, unknown>[];
    expect(summary?.secondsInRange).toBe(200);
    expect(summary?.highestHeartRate).toBe(150);
    expect(summary?.meanHeartRate).toBe(142);
    expect(summary?.rescues).toBe(1);
  });

  it('counts the reading of the tick that crosses a boundary once, in the block that has begun', async () => {
    const r = rig();
    await r.ride(299);
    // The reading the boundary's own tick carries, and no other tick does.
    r.facts.heartRate = 180;
    r.facts.power = 400;
    r.facts.cadence = 120;
    await r.ride(1);
    r.facts.heartRate = 140;
    r.facts.power = 150;
    r.facts.cadence = 90;
    const [first] = inputOf(r.scripted).summaries as Record<string, unknown>[];
    // Not in the block that had just ended: its figures are its own 299 readings.
    expect(first).toEqual({
      block: 0,
      seconds: 300,
      meanHeartRate: 140,
      highestHeartRate: 140,
      meanPowerShare: 0.6,
      meanCadence: 90,
      rescues: 0,
    });
    r.scripted.answer(null);
    await r.ride(600);
    const second = (inputOf(r.scripted, 1).summaries as Record<string, unknown>[])[1];
    // In the block that began with it, once: 1 reading of 180 among 600.
    expect(second?.highestHeartRate).toBe(180);
    expect(second?.seconds).toBe(600);
    expect(second?.meanHeartRate).toBe(Math.round((180 + 599 * 140) / 600));
    expect(second?.meanPowerShare).toBe(Math.round(((400 + 599 * 150) / 600 / 250) * 1000) / 1000);
  });

  it('gives the time up to the boundary to the block that ended, whatever its last reading', async () => {
    const hold: WorkoutBlock = {
      kind: 'heart-rate-hold',
      seconds: seconds(300),
      range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
      startShare: thresholdShare(0.5),
      ceilingShare: thresholdShare(0.8),
    };
    const r = rig({
      workout: { name: 'Hold', blocks: [hold, steady(600, 0.6), steady(300, 0.5)] },
    });
    await r.ride(300);
    const [summary] = inputOf(r.scripted).summaries as Record<string, unknown>[];
    // All 300 seconds in range, the last one among them.
    expect(summary?.secondsInRange).toBe(300);
  });

  it('asks no sooner than three minutes after the last request', async () => {
    const short: Workout = {
      name: 'Short blocks',
      blocks: [
        steady(120, 0.5),
        steady(120, 0.6),
        steady(120, 0.7),
        steady(120, 0.6),
        steady(300, 0.5),
      ],
    };
    const r = rig({ workout: short });
    await r.ride(120);
    expect(r.scripted.starts()).toHaveLength(1);
    r.scripted.answer(null);
    await r.flush();
    // The next boundary is 120 s on: too soon.
    await r.ride(120);
    expect(r.scripted.starts()).toHaveLength(1);
    // The one after is 240 s on.
    await r.ride(120);
    expect(r.scripted.starts()).toHaveLength(2);
    expect(REPLAN_ASK_INTERVAL_SECONDS).toBe(180);
    // Both blocks ridden since are summarised, and the newest is last.
    expect(
      (inputOf(r.scripted, 1).summaries as { block: number }[]).map((each) => each.block),
    ).toEqual([0, 1, 2]);
  });

  it('does not ask as the cool-down begins: no move may change it', async () => {
    const r = rig({ workout: { name: 'Two', blocks: [steady(300, 0.5), steady(300, 0.4)] } });
    await r.ride(400);
    expect(r.scripted.requests).toEqual([]);
  });

  it('does not ask for a block that ends within thirty seconds', async () => {
    const r = rig({
      workout: { name: 'Brief', blocks: [steady(300, 0.5), steady(29, 0.7), steady(300, 0.5)] },
    });
    await r.ride(310);
    expect(r.scripted.requests).toEqual([]);
  });

  it('does not send a plan of more blocks than the instance reads', async () => {
    const many = (count: number): Workout => ({
      name: 'Many',
      blocks: Array.from({ length: count }, () => steady(60, 0.6)),
    });
    const most = rig({ workout: many(REPLAN_MAXIMUM_BLOCKS) });
    await most.ride(60);
    expect(most.scripted.starts()).toHaveLength(1);

    const over = rig({ workout: many(REPLAN_MAXIMUM_BLOCKS + 1) });
    await over.ride(300);
    expect(over.scripted.requests).toEqual([]);
  });

  describe('a long workout is bounded to the instance’s 8 KB, not refused', () => {
    const bytesOf = (value: unknown): number =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const efforts = (hard: number, easy: number): WorkoutBlock => ({
      kind: 'intervals',
      repeats: 1,
      hardSeconds: seconds(60),
      hardTarget: thresholdShare(hard),
      easySeconds: seconds(60),
      easyTarget: thresholdShare(easy),
    });
    /** 63 two-minute blocks and a cool-down: the longest plan the instance reads. */
    const long = (hard: number, easy: number): Workout => ({
      name: 'Long',
      blocks: [...Array.from({ length: 63 }, () => efforts(hard, easy)), steady(300, 0.5)],
    });

    it('sends the most recent summaries that fit, and goes on asking', async () => {
      const r = rig({ workout: long(0.95, 0.55) });
      // Fifty blocks: 100 minutes.
      await r.ride(50 * 120);
      const starts = r.scripted.starts();
      // One request every second block (240 s apart): asking never stopped.
      expect(starts).toHaveLength(25);
      expect(r.session.state().notice).toBeUndefined();
      for (const start of starts) {
        expect(bytesOf(start.input)).toBeLessThanOrEqual(REPLAN_INPUT_BYTE_BUDGET);
      }
      const last = inputOf(r.scripted, starts.length - 1);
      const sent = (last.summaries as { block: number }[]).map((each) => each.block);
      // The last request left as block 49 began, with blocks 0 to 48 ridden:
      // fewer than those 49 are in it, the newest last, none missing between.
      expect(last.currentBlock).toBe(49);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.length).toBeLessThan(49);
      expect(sent.at(-1)).toBe(48);
      expect(sent).toEqual(Array.from({ length: sent.length }, (_, at) => 49 - sent.length + at));
      // The plan is still sent whole.
      expect(last.blocks).toHaveLength(64);
      // And an early request, with room for all of it, left none out.
      expect((inputOf(r.scripted, 2).summaries as unknown[]).length).toBe(5);
    });

    it('asks nothing, and says nothing, when the plan leaves no room for one summary', async () => {
      // The same plan with figures written out long: the blocks alone pass 8 KB.
      const r = rig({ workout: long(0.9512345678901234, 0.5512345678901234) });
      expect(bytesOf(r.player.plan().riding.workout.blocks)).toBeGreaterThan(8_000);
      await r.ride(10 * 120);
      expect(r.scripted.requests).toEqual([]);
      expect(r.session.state().notice).toBeUndefined();
    });
  });

  it('does not ask without trainer control, or without a heart-rate strap', async () => {
    const lost = rig();
    lost.facts.control = false;
    await lost.ride(310);
    expect(lost.scripted.requests).toEqual([]);

    const noStrap = rig();
    noStrap.facts.heartRatePaired = false;
    await noStrap.ride(310);
    expect(noStrap.scripted.requests).toEqual([]);
  });
});

describe('an accepted move waits for the next block', () => {
  it('hands the player the revised plan, says one sentence, and changes nothing yet', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();

    expect(r.session.state().waiting).toEqual({
      revision: 1,
      // `on-plan`, the rig's reason, is one the device never says (rule R1).
      sentence: 'Next block shortened by 2 minutes.',
    });
    expect(r.player.plan().waiting?.totalSeconds).toBe(2280);
    expect(r.player.plan().riding.totalSeconds).toBe(2400);
    // What the graph draws dotted: the plan as it was, from the next block on.
    expect(r.session.state().replaced?.map((each) => each.block)).toEqual([2, 3, 4]);
    expect(r.session.records()).toEqual([
      {
        decision: 'accepted',
        move: SHORTEN_NEXT,
        reason: 'on-plan',
        revision: 1,
        at: START + 300,
        reasonNotShown: true,
      },
    ]);
  });

  it('becomes the plan at the boundary, and the next request names the new revision', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    await r.ride(600);

    expect(r.session.state().waiting).toBeUndefined();
    expect(r.player.plan().riding.totalSeconds).toBe(2280);
    expect(r.session.state().replaced?.map((each) => each.block)).toEqual([2, 3, 4]);
    expect(r.scripted.starts()).toHaveLength(2);
    expect(inputOf(r.scripted, 1).revision).toBe(1);
    expect((inputOf(r.scripted, 1).blocks as { seconds: number }[])[2]?.seconds).toBe(480);
  });

  it('never asks the player for a target on its own', async () => {
    const r = rig();
    await r.ride(300);
    const before = [...r.asked];
    r.scripted.answer(proposal({ kind: 'scale-remaining-intervals', percent: -10 }));
    await r.flush();
    expect(r.session.state().waiting).toBeDefined();
    await r.ride(599);
    // The whole of the block being ridden: not one new target.
    expect(r.asked).toEqual(before);
    await r.ride(1);
    // 0.8 × 0.9 × 250 W, where the loaded plan asked for 200 W.
    expect(r.asked.at(-1)).toBe(180);
  });
});

describe('Keep the plan', () => {
  it('drops the waiting move, keeps the record, and rides the plan as it was', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();

    expect(r.session.keepThePlan()).toBe(true);
    expect(r.session.state()).toEqual({
      waiting: undefined,
      kept: true,
      notice: undefined,
      off: false,
      replaced: undefined,
    });
    expect(r.player.plan().waiting).toBeUndefined();
    expect(r.session.records().at(-1)).toEqual({
      decision: 'not-applied',
      why: 'kept',
      revision: 1,
      at: START + 300,
    });
    await r.ride(600);
    expect(r.player.plan().riding.totalSeconds).toBe(2400);
    // The line about it ends with the block it was pressed in.
    expect(r.session.state().kept).toBe(false);
    // The dropped revision's number is never used again.
    expect(inputOf(r.scripted, 1).revision).toBe(2);
  });

  it('is nothing when no move is waiting', async () => {
    const r = rig();
    await r.ride(300);
    expect(r.session.keepThePlan()).toBe(false);
    expect(r.session.state().kept).toBe(false);
    expect(r.session.records()).toEqual([]);
  });

  it('keeps nothing, and does not say the plan stayed, once the move’s block has begun', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.ride(599);
    // The player crosses the boundary; the session has not been ticked yet.
    r.wait(1);
    r.player.tick(r.clock());
    expect(r.player.plan().waiting).toBeUndefined();
    // A screen is already shown no waiting move and no control, and the
    // outline of what the move replaced stays: it is the plan now.
    expect(r.session.state().waiting).toBeUndefined();
    expect(r.session.state().discarded).toBeUndefined();
    expect(r.session.state().replaced?.map((each) => each.block)).toEqual([2, 3, 4]);
    expect(r.session.keepThePlan()).toBe(false);
    expect(r.session.state().kept).toBe(false);
    expect(r.session.records().filter((each) => each.decision === 'not-applied')).toEqual([]);
    // The move is the plan.
    expect(r.player.plan().riding.totalSeconds).toBe(2280);
  });

  it('takes the kept move’s outline away, and leaves an earlier applied move’s where it was', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.ride(600);
    // The first move reached the plan: its outline stands.
    const first = r.session.state().replaced;
    expect(first?.map((each) => each.block)).toEqual([2, 3, 4]);
    // A second move, for the block after next, waits; its own outline is shown.
    r.scripted.answer(
      proposal({ kind: 'shorten-block', block: 3, minutes: 1 }, { revision: 1, summarySeq: 2 }),
    );
    await r.flush();
    expect(r.session.state().waiting?.revision).toBe(2);
    expect(r.session.state().replaced?.map((each) => each.block)).toEqual([3, 4]);
    // Kept: the second outline goes, and the first is back.
    expect(r.session.keepThePlan()).toBe(true);
    expect(r.session.state().replaced).toBe(first);
  });
});

describe('a proposal the validator refuses', () => {
  it('is refused whole when it carries one key too many, and nothing is shown', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer({ ...(proposal(SHORTEN_NEXT) as object), text: 'Ease off, you look tired.' });
    await r.flush();

    expect(r.session.state()).toEqual({
      waiting: undefined,
      kept: false,
      notice: undefined,
      off: false,
      replaced: undefined,
    });
    expect(r.player.plan().waiting).toBeUndefined();
    // P1, and nothing of what arrived is kept.
    expect(r.session.records()).toEqual([{ decision: 'refused', rule: 'P1', at: START + 300 }]);
    expect(JSON.stringify(r.session.records())).not.toContain('tired');
  });

  it('is refused for the block being ridden — P2', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal({ kind: 'shorten-block', block: 1, minutes: 2 }));
    await r.flush();
    expect(
      r.session.records().map((each) => (each.decision === 'refused' ? each.rule : '')),
    ).toEqual(['P2']);
    expect(r.player.plan().waiting).toBeUndefined();
  });

  it('does nothing when the model kept the workout as it is', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(null);
    await r.flush();
    expect(r.session.records()).toEqual([]);
    expect(r.session.state().notice).toBeUndefined();
    expect(r.scripted.openStreams()).toBe(0);
  });
});

describe('a late answer is dropped', () => {
  it('cancels the job once sixty seconds have passed, and ignores what it says', async () => {
    const r = rig();
    await r.ride(300);
    await r.ride(REPLAN_FRESHNESS_SECONDS);
    expect(r.scripted.cancelled).toEqual([]);
    expect(r.scripted.openStreams()).toBe(1);
    await r.ride(1);
    expect(r.scripted.cancelled).toEqual(['job-1']);
    expect(r.scripted.openStreams()).toBe(0);

    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.session.state().waiting).toBeUndefined();
    expect(r.session.records()).toEqual([]);
    expect(r.player.plan().waiting).toBeUndefined();
    // Dropped silently: no line about it.
    expect(r.session.state().notice).toBeUndefined();
  });

  it('is refused by the validator when it lands between two ticks, sixty-one seconds on — P5', async () => {
    const r = rig();
    await r.ride(300);
    await r.ride(REPLAN_FRESHNESS_SECONDS);
    r.wait(1);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.session.records()).toEqual([
      {
        decision: 'refused',
        rule: 'P5',
        move: SHORTEN_NEXT,
        reason: 'on-plan',
        at: START + 361,
      },
    ]);
    expect(r.player.plan().waiting).toBeUndefined();
    expect(r.session.state().notice).toBeUndefined();
  });

  it('cancels a job still out thirty seconds before the boundary', async () => {
    // A 200 s block, asked about 180 s after the request before it.
    const workout: Workout = {
      name: 'Late',
      blocks: [
        steady(60, 0.5),
        steady(185, 0.6),
        steady(65, 0.7),
        steady(600, 0.6),
        steady(300, 0.5),
      ],
    };
    const r = rig({ workout });
    await r.ride(60);
    r.scripted.answer(null);
    await r.flush();
    await r.ride(185);
    expect(r.scripted.starts()).toHaveLength(2);
    // 65 s block: 35 s in, 30 s remain, and the job is still listened to.
    await r.ride(65 - REPLAN_BOUNDARY_LEAD_SECONDS);
    expect(r.scripted.cancelled).toEqual([]);
    await r.ride(1);
    expect(r.scripted.cancelled).toEqual(['job-2']);
  });

  it('is refused by the validator twenty-nine seconds before the boundary — P2', async () => {
    const workout: Workout = {
      name: 'Late',
      blocks: [steady(300, 0.5), steady(59, 0.6), steady(600, 0.7), steady(300, 0.5)],
    };
    const r = rig({ workout });
    await r.ride(300);
    // 30 s into a 59 s block; the answer lands a second later, between ticks.
    await r.ride(29);
    r.wait(1);
    r.scripted.answer(proposal({ kind: 'shorten-block', block: 2, minutes: 2 }));
    await r.flush();
    expect(
      r.session.records().map((each) => (each.decision === 'refused' ? each.rule : '')),
    ).toEqual(['P2']);
    expect(r.player.plan().waiting).toBeUndefined();
  });
});

describe('a pause and a stall rescue', () => {
  it('cancels a job in flight when the ride pauses, and asks nothing while paused', async () => {
    const r = rig();
    await r.ride(300);
    r.pause();
    await r.flush();
    expect(r.scripted.cancelled).toEqual(['job-1']);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.session.records()).toEqual([]);
    expect(r.scripted.starts()).toHaveLength(1);
  });

  it('records a waiting move the pause discarded, and its number is not used again', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    r.pause();
    expect(r.session.state().waiting).toBeUndefined();
    expect(r.session.records().at(-1)).toEqual({
      decision: 'not-applied',
      why: 'paused',
      revision: 1,
      at: START + 300,
    });
    r.resume();
    await r.ride(600);
    expect(r.player.plan().riding.totalSeconds).toBe(2400);
    expect(inputOf(r.scripted, 1).revision).toBe(2);
  });

  describe('a waiting move a pause or a lost trainer discards — D-8', () => {
    const waitingMove = async () => {
      const r = rig();
      await r.ride(300);
      r.scripted.answer(proposal(SHORTEN_NEXT));
      await r.flush();
      expect(r.session.state().waiting?.revision).toBe(1);
      expect(r.session.state().replaced).toBeDefined();
      return r;
    };

    it.each([
      ['a pause', (r: Awaited<ReturnType<typeof waitingMove>>) => r.player.pause(r.clock())],
      [
        'a lost trainer',
        (r: Awaited<ReturnType<typeof waitingMove>>) => r.player.linkLost(r.clock()),
      ],
    ])(
      'says so at the moment of %s, before any tick: no sentence, no control, no outline',
      async (_, act) => {
        const r = await waitingMove();
        act(r);
        // No tick of the session has run: this is the snapshot a screen draws
        // in the same instant the player's plan went back.
        expect(r.player.plan().waiting).toBeUndefined();
        expect(r.session.state()).toEqual({
          waiting: undefined,
          discarded: 1,
          kept: false,
          notice: undefined,
          off: false,
          replaced: undefined,
        });
        // Nothing is left to keep the plan from.
        expect(r.session.keepThePlan()).toBe(false);
      },
    );

    it('says it once: the same revision on every later tick of that block, and not after it', async () => {
      const r = await waitingMove();
      r.pause();
      expect(r.session.state().discarded).toBe(1);
      expect(r.session.records().filter((each) => each.decision === 'not-applied')).toHaveLength(1);
      r.resume();
      await r.ride(100);
      // Still the one discarded move, by its number: an announcer says a number once.
      expect(r.session.state().discarded).toBe(1);
      expect(r.session.state().kept).toBe(false);
      await r.ride(500);
      // The block it was discarded in has ended.
      expect(r.session.state().discarded).toBeUndefined();
      expect(r.session.records().filter((each) => each.decision === 'not-applied')).toHaveLength(1);
    });

    it('is not said of a move the rider kept the plan from', async () => {
      const r = await waitingMove();
      r.session.keepThePlan();
      expect(r.session.state().discarded).toBeUndefined();
      expect(r.session.state().kept).toBe(true);
    });

    it('is not said of a move that reached the plan', async () => {
      const r = await waitingMove();
      await r.ride(600);
      expect(r.session.state()).toMatchObject({ waiting: undefined, discarded: undefined });
      expect(r.session.state().replaced).toBeDefined();
    });
  });

  it('cancels a job in flight when the stall rescue takes the target', async () => {
    const r = rig();
    await r.ride(300);
    r.facts.rescue = true;
    await r.ride(1);
    expect(r.scripted.cancelled).toEqual(['job-1']);
  });

  it('asks nothing at a boundary the rescue is holding the target through', async () => {
    const r = rig();
    await r.ride(290);
    r.facts.rescue = true;
    await r.ride(20);
    r.facts.rescue = false;
    await r.ride(100);
    expect(r.scripted.requests).toEqual([]);
  });

  it('refuses a proposal that arrives during a rescue between two ticks — P6', async () => {
    const r = rig();
    await r.ride(300);
    r.facts.rescue = true;
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(
      r.session.records().map((each) => (each.decision === 'refused' ? each.rule : '')),
    ).toEqual(['P6']);
    expect(r.player.plan().waiting).toBeUndefined();
  });
});

describe('every failure is the plan already on the device', () => {
  it.each(['send', 'wait', 'receive'] as const)(
    'a transport that fails at the %s leaves the plan alone, says one line, and is not retried',
    async (step) => {
      const r = rig();
      r.scripted.fail = step;
      await r.ride(300);
      r.scripted.answer(proposal(SHORTEN_NEXT));
      await r.flush();

      expect(r.session.state()).toEqual({
        waiting: undefined,
        kept: false,
        notice: REPLAN_UNAVAILABLE,
        off: false,
        replaced: undefined,
      });
      expect(r.player.plan().waiting).toBeUndefined();
      expect(r.session.records()).toEqual([]);
      // The rest of the block: the same request is never sent again.
      await r.ride(599);
      expect(r.scripted.starts()).toHaveLength(1);
      // The next boundary may ask, once.
      r.scripted.fail = undefined;
      await r.ride(1);
      expect(r.scripted.starts()).toHaveLength(2);
    },
  );

  it('cancels a job whose stream broke, so nothing is left running for nobody', async () => {
    const r = rig();
    r.scripted.fail = 'wait';
    await r.ride(300);
    expect(r.scripted.cancelled).toEqual(['job-1']);
  });

  it('clears the line once a later request is answered', async () => {
    const r = rig();
    r.scripted.fail = 'send';
    await r.ride(300);
    expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
    r.scripted.fail = undefined;
    await r.ride(600);
    r.scripted.answer(null);
    await r.flush();
    expect(r.session.state().notice).toBeUndefined();
  });

  it('says the same line when the job itself failed', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.failed('out-of-time');
    await r.flush();
    expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
    expect(r.session.records()).toEqual([]);
  });

  it.each(['rate_limited', 'analysis_off', 'validation_failed', 'unauthenticated'])(
    'asks nothing more for this workout once the instance refuses with %s',
    async (code) => {
      const r = rig();
      r.scripted.startAnswer = { status: 429, body: { error: { code } } };
      await r.ride(300);
      expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
      r.scripted.startAnswer = undefined;
      await r.ride(1300);
      expect(r.scripted.starts()).toHaveLength(1);
    },
  );

  it('ends the asking for exactly the refusals the instance’s start names as permanent', () => {
    expect([...PERMANENT_REFUSALS].sort()).toEqual([
      'analysis_off',
      'rate_limited',
      'unauthenticated',
      'validation_failed',
    ]);
  });

  it.each([
    [
      'job_running: a write-up was in the way',
      { status: 409, body: { error: { code: 'job_running' } } },
    ],
    ['unavailable', { status: 503, body: { error: { code: 'unavailable' } } }],
    ['a 502 the tunnel relayed, with no body', { status: 502, body: null }],
    ['a 500 with a page of HTML', { status: 500, body: '<html>Bad gateway</html>' }],
    ['a code nobody foresaw', { status: 418, body: { error: { code: 'teapot' } } }],
    ['a code that is not one', { status: 400, body: { error: { code: 'RATE LIMITED!' } } }],
  ])(
    'asks again at the next block boundary, and never sooner, after %s',
    async (_, startAnswer) => {
      const r = rig();
      r.scripted.startAnswer = startAnswer;
      await r.ride(300);
      expect(r.scripted.starts()).toHaveLength(1);
      expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
      r.scripted.startAnswer = undefined;
      // The whole of the block it failed in: nothing is sent again.
      await r.ride(599);
      expect(r.scripted.starts()).toHaveLength(1);
      // The next block begins.
      await r.ride(1);
      expect(r.scripted.starts()).toHaveLength(2);
    },
  );

  it('asks again at the next block boundary after a session that threw as it was opened', async () => {
    let throws = true;
    const scriptedSession = { current: undefined as JobSession | undefined };
    const r = rig({
      session: () =>
        throws
          ? Promise.reject(new Error('no keys'))
          : Promise.resolve(scriptedSession.current as JobSession),
    });
    scriptedSession.current = r.scripted.session;
    await r.ride(300);
    expect(r.scripted.requests).toEqual([]);
    expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
    throws = false;
    await r.ride(599);
    expect(r.scripted.requests).toEqual([]);
    await r.ride(1);
    expect(r.scripted.starts()).toHaveLength(1);
  });

  it('is never a storm: an instance that fails every time is asked at most 20 times in an hour', async () => {
    // 62 one-minute blocks and a cool-down: a boundary every 60 seconds.
    const r = rig({
      workout: {
        name: 'Minutes',
        blocks: [...Array.from({ length: 62 }, () => steady(60, 0.6)), steady(300, 0.5)],
      },
    });
    r.scripted.startAnswer = { status: 502, body: null };
    const sentAt: number[] = [];
    for (let second = 1; second <= 3600; second += 1) {
      const before = r.scripted.starts().length;
      await r.ride(1);
      if (r.scripted.starts().length > before) sentAt.push(second);
    }
    expect(sentAt.length).toBeGreaterThan(10);
    expect(sentAt.length).toBeLessThanOrEqual(20);
    // Under the instance's own 24 an hour, which a refused start still spends.
    expect(sentAt.length).toBeLessThan(24);
    for (let index = 1; index < sentAt.length; index += 1) {
      expect((sentAt[index] ?? 0) - (sentAt[index - 1] ?? 0)).toBeGreaterThanOrEqual(
        REPLAN_ASK_INTERVAL_SECONDS,
      );
    }
    // Each at a block boundary, and no two for one boundary.
    expect(sentAt.every((second) => second % 60 === 0)).toBe(true);
    expect(new Set(sentAt).size).toBe(sentAt.length);
  });

  it('sends nothing when there is no sealed session, and asks nothing more', async () => {
    const r = rig({ session: () => Promise.resolve({ kind: 'closed', text: 'Signed out.' }) });
    await r.ride(1500);
    expect(r.scripted.requests).toEqual([]);
    expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
  });

  it('sends nothing when the session cannot be opened at all', async () => {
    const r = rig({ session: () => Promise.reject(new Error('no keys')) });
    await r.ride(310);
    expect(r.scripted.requests).toEqual([]);
    expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
  });

  it('asks nothing more once this device holds no sign-in the instance would take', async () => {
    let asked = 0;
    const r = rig({
      session: () => {
        asked += 1;
        return Promise.resolve({ kind: 'closed', text: 'Signed out.' });
      },
    });
    await r.ride(1500);
    expect(asked).toBe(1);
  });
});

describe('a plan the player will not take', () => {
  it('is recorded as not taken, shows nothing, and its number is not used again', async () => {
    const r = rig({ revise: () => false });
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.session.state().waiting).toBeUndefined();
    expect(r.session.state().replaced).toBeUndefined();
    expect(r.session.records().map((each) => each.decision)).toEqual(['accepted', 'not-applied']);
    expect(r.session.records().at(-1)).toMatchObject({ why: 'not-taken', revision: 1 });
    await r.ride(600);
    expect(inputOf(r.scripted, 1).revision).toBe(2);
    expect((inputOf(r.scripted, 1).blocks as { seconds: number }[])[2]?.seconds).toBe(600);
  });

  it('is the plan already on the device when handing it over throws', async () => {
    const r = rig({
      revise: () => {
        throw new Error('the player is gone');
      },
    });
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    await r.session.settled();
    expect(r.session.state().waiting).toBeUndefined();
    expect(r.session.state().notice).toBe(REPLAN_UNAVAILABLE);
    expect(r.player.plan().waiting).toBeUndefined();
    // No record of a move that was never handed over.
    expect(r.session.records()).toEqual([]);
    // And the plan's number has not moved: the next request names revision 0.
    await r.ride(600);
    expect(inputOf(r.scripted, 1).revision).toBe(0);
  });
});

describe('the end of the workout', () => {
  it('cancels the job in flight and ignores what it says afterwards', async () => {
    const r = rig();
    await r.ride(300);
    r.session.stop();
    await r.flush();
    expect(r.scripted.cancelled).toEqual(['job-1']);
    expect(r.scripted.openStreams()).toBe(0);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.session.records()).toEqual([]);
    expect(r.player.plan().waiting).toBeUndefined();
  });

  it('cancels a job whose start was still on the wire when the workout ended', async () => {
    const r = rig();
    r.scripted.holdStarts = true;
    await r.ride(300);
    expect(r.scripted.starts()).toHaveLength(1);
    r.session.stop();
    // Nothing to cancel yet: the instance has not said which job it made.
    expect(r.scripted.cancelled).toEqual([]);
    r.scripted.releaseStarts();
    await r.flush();
    expect(r.scripted.cancelled).toEqual(['job-1']);
    // And its stream is never opened.
    expect(r.scripted.requests.filter((each) => each.method === 'GET')).toEqual([]);
  });

  it('sends nothing at all when the workout ended before the session had opened', async () => {
    const r = rig();
    await r.ride(299);
    // The boundary tick, with no microtask run after it.
    r.wait(1);
    r.player.tick(seconds(START + 300));
    r.session.tick(seconds(START + 300));
    r.session.stop();
    await r.flush();
    expect(r.scripted.requests).toEqual([]);
  });

  it('records a move that was still waiting, and asks nothing after', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    r.session.stop();
    expect(r.session.state().waiting).toBeUndefined();
    expect(r.session.records().at(-1)).toEqual({
      decision: 'not-applied',
      why: 'ended',
      revision: 1,
      at: START + 300,
    });
    await r.ride(700);
    expect(r.scripted.starts()).toHaveLength(1);
    expect(r.session.keepThePlan()).toBe(false);
  });
});

describe('a screen is told when something it shows has changed', () => {
  it('on an accepted move, on Keep the plan, and on a failure', async () => {
    const r = rig();
    await r.ride(300);
    const before = r.changes();
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.changes()).toBeGreaterThan(before);
    const accepted = r.changes();
    r.session.keepThePlan();
    expect(r.changes()).toBeGreaterThan(accepted);
  });
});

describe('a reason is said only when this device holds its premise — #1244’s review', () => {
  const hold: WorkoutBlock = {
    kind: 'heart-rate-hold',
    seconds: seconds(300),
    range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
    startShare: thresholdShare(0.5),
    ceilingShare: thresholdShare(0.8),
  };
  const afterAHold: Workout = {
    name: 'Hold',
    blocks: [hold, steady(600, 0.7), steady(600, 0.8), steady(300, 0.5)],
  };

  it('says "because your heart rate stayed above the range you chose" after a hold ridden above its range', async () => {
    const r = rig({ workout: afterAHold });
    r.facts.heartRate = 150;
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT, { reason: 'heart-rate-high' }));
    await r.flush();
    expect(r.session.state().waiting?.sentence).toBe(
      'Next block shortened by 2 minutes, because your heart rate stayed above the range you chose.',
    );
    // The record is the validator's own: nothing says the reason was withheld.
    expect(r.session.records().at(-1)).toEqual({
      decision: 'accepted',
      move: SHORTEN_NEXT,
      reason: 'heart-rate-high',
      revision: 1,
      at: START + 300,
    });
  });

  it('says the move alone when the rider chose no range, accepts it all the same, and records that', async () => {
    // The review's case: steady blocks, no goals, the model says heart-rate-high.
    const r = rig();
    r.facts.heartRate = 185;
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT, { reason: 'heart-rate-high' }));
    await r.flush();
    expect(r.session.state().waiting?.sentence).toBe('Next block shortened by 2 minutes.');
    // ⚠️ Not a refusal: the move was the validator's to judge, and it stands.
    expect(r.player.plan().waiting).toBeDefined();
    expect(r.session.records().at(-1)).toEqual({
      decision: 'accepted',
      move: SHORTEN_NEXT,
      reason: 'heart-rate-high',
      revision: 1,
      at: START + 300,
      reasonNotShown: true,
    });
    await r.ride(600);
    expect(r.player.plan().riding.totalSeconds).toBe(2280);
  });

  it('says the move alone after a hold ridden INSIDE its range', async () => {
    const r = rig({ workout: afterAHold });
    r.facts.heartRate = 135;
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT, { reason: 'heart-rate-high' }));
    await r.flush();
    expect(r.session.state().waiting?.sentence).toBe('Next block shortened by 2 minutes.');
  });

  it.each([
    ['effort-check-in', 'this device sends no effort check-in'],
    ['goal-time-in-range', 'this device withholds that goal'],
    [
      'on-plan',
      'seeing it would mean setting power against the target, which rule R1 keeps off the ride',
    ],
  ])('never says %s: %s', async (reason) => {
    const r = rig({ goals: { timeInRangeMinutes: 20, effortCheckIns: true } });
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT, { reason }));
    await r.flush();
    expect(r.session.state().waiting?.sentence).toBe('Next block shortened by 2 minutes.');
    expect(r.session.records().at(-1)).toMatchObject({ reason, reasonNotShown: true });
  });

  it('says "to fit the duration you chose" only to a rider who chose one', async () => {
    const withGoal = rig({ goals: { durationMinutes: 40 } });
    await withGoal.ride(300);
    withGoal.scripted.answer(proposal(SHORTEN_NEXT, { reason: 'goal-duration' }));
    await withGoal.flush();
    expect(withGoal.session.state().waiting?.sentence).toBe(
      'Next block shortened by 2 minutes, to fit the duration you chose.',
    );

    const without = rig();
    await without.ride(300);
    without.scripted.answer(proposal(SHORTEN_NEXT, { reason: 'goal-duration' }));
    await without.flush();
    expect(without.session.state().waiting?.sentence).toBe('Next block shortened by 2 minutes.');
  });

  it('reads the premise in the request the answer is for, not in what has been ridden since', async () => {
    const r = rig({ workout: afterAHold });
    r.facts.heartRate = 150;
    await r.ride(300);
    // After the request left, the heart rate comes down: the summary sent still says 150.
    r.facts.heartRate = 120;
    await r.ride(20);
    r.scripted.answer(proposal(SHORTEN_NEXT, { reason: 'heart-rate-high' }));
    await r.flush();
    expect(r.session.state().waiting?.sentence).toContain('stayed above the range you chose');
  });
});

describe('switching re-plans off mid-workout — ADR 0048 D-7', () => {
  it('sends nothing more for the rest of the workout, and says it is off', async () => {
    const r = rig();
    await r.ride(300);
    expect(r.scripted.starts()).toHaveLength(1);
    r.scripted.answer(null);
    await r.flush();
    const before = r.scripted.requests.length;

    expect(r.session.switchOff()).toBe(true);
    expect(r.session.state()).toEqual({
      waiting: undefined,
      discarded: undefined,
      kept: false,
      notice: undefined,
      off: true,
      replaced: undefined,
    });
    // Three more block boundaries, to the end of the workout.
    await r.ride(2100);
    expect(r.scripted.requests).toHaveLength(before);
    expect(r.scripted.starts()).toHaveLength(1);
    expect(r.session.state().off).toBe(true);
  });

  it('cancels the job in flight, and ignores what it says afterwards', async () => {
    const r = rig();
    await r.ride(300);
    expect(r.scripted.openStreams()).toBe(1);
    r.session.switchOff();
    await r.flush();
    expect(r.scripted.cancelled).toEqual(['job-1']);
    expect(r.scripted.openStreams()).toBe(0);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.session.records()).toEqual([]);
    expect(r.player.plan().waiting).toBeUndefined();
    await r.ride(600);
    expect(r.player.plan().riding.totalSeconds).toBe(2400);
  });

  it('drops a move that was waiting, records why, and rides the plan as it was', async () => {
    const r = rig();
    await r.ride(300);
    r.scripted.answer(proposal(SHORTEN_NEXT));
    await r.flush();
    expect(r.player.plan().waiting).toBeDefined();

    r.session.switchOff();
    expect(r.player.plan().waiting).toBeUndefined();
    expect(r.session.state()).toMatchObject({
      waiting: undefined,
      off: true,
      // Not the answer to *Keep the plan*, and not a pause's discard: the
      // line that says re-plans are off says the plan stays.
      kept: false,
      discarded: undefined,
      replaced: undefined,
    });
    expect(r.session.records().at(-1)).toEqual({
      decision: 'not-applied',
      why: 'switched-off',
      revision: 1,
      at: START + 300,
    });
    await r.ride(600);
    expect(r.player.plan().riding.totalSeconds).toBe(2400);
    // The workout's end adds no second record for the same move.
    r.session.stop();
    expect(r.session.records().filter((each) => each.decision === 'not-applied')).toHaveLength(1);
  });

  it('cannot be switched back on, or off twice, and Keep the plan is nothing after it', async () => {
    const r = rig();
    await r.ride(300);
    expect(r.session.switchOff()).toBe(true);
    expect(r.session.switchOff()).toBe(false);
    expect(r.session.keepThePlan()).toBe(false);
    expect(r.session.state().off).toBe(true);
  });

  it('is nothing once the workout is over', async () => {
    const r = rig();
    await r.ride(300);
    r.session.stop();
    expect(r.session.switchOff()).toBe(false);
    expect(r.session.state().off).toBe(false);
  });

  it('tells the screen', async () => {
    const r = rig();
    await r.ride(300);
    const before = r.changes();
    r.session.switchOff();
    expect(r.changes()).toBeGreaterThan(before);
  });
});

describe('a job in flight when control or the strap is lost — P6, D-8', () => {
  it.each([
    ['trainer control', 'control'],
    ['the heart-rate strap', 'heartRatePaired'],
  ] as const)(
    'is cancelled when %s goes, and its answer is not accepted once it is back',
    async (_, fact) => {
      const r = rig();
      await r.ride(300);
      expect(r.scripted.openStreams()).toBe(1);
      r.facts[fact] = false;
      await r.ride(1);
      expect(r.scripted.cancelled).toEqual(['job-1']);
      // Back five ticks later, and the answer five ticks after that.
      await r.ride(4);
      r.facts[fact] = true;
      await r.ride(5);
      r.scripted.answer(proposal(SHORTEN_NEXT));
      await r.ride(1);
      expect(r.session.state().waiting).toBeUndefined();
      expect(r.session.records()).toEqual([]);
      expect(r.player.plan().waiting).toBeUndefined();
      await r.ride(600);
      expect(r.player.plan().riding.totalSeconds).toBe(2400);
    },
  );
});

describe('the three minutes are the RIDE’s, across its workouts', () => {
  it('waits out an earlier workout’s request, and tells the ride when it asks', async () => {
    let last: number | undefined = START + 240;
    const noted: number[] = [];
    const r = rig({
      asked: {
        last: () => last,
        note: (at) => {
          noted.push(at);
          last = at;
        },
      },
    });
    // The first boundary is 300 s into this workout, 60 s after the ride last asked.
    await r.ride(300);
    expect(r.scripted.requests).toEqual([]);
    // The next is 900 s in.
    await r.ride(600);
    expect(r.scripted.starts()).toHaveLength(1);
    expect(noted).toEqual([START + 900]);
  });

  it('asks at its first boundary when the ride last asked three minutes ago or more', async () => {
    const r = rig({ asked: { last: () => START + 120, note: () => undefined } });
    await r.ride(300);
    expect(r.scripted.starts()).toHaveLength(1);
  });
});
