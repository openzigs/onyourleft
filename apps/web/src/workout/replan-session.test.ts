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

import {
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
  reason: 'heart-rate-high',
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
      sentence:
        'Next block shortened by 2 minutes, because your heart rate stayed above the range you chose.',
    });
    expect(r.player.plan().waiting?.totalSeconds).toBe(2280);
    expect(r.player.plan().riding.totalSeconds).toBe(2400);
    // What the graph draws dotted: the plan as it was, from the next block on.
    expect(r.session.state().replaced?.map((each) => each.block)).toEqual([2, 3, 4]);
    expect(r.session.records()).toEqual([
      {
        decision: 'accepted',
        move: SHORTEN_NEXT,
        reason: 'heart-rate-high',
        revision: 1,
        at: START + 300,
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
        reason: 'heart-rate-high',
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

  it('asks again at the next boundary after job_running: a write-up was in the way', async () => {
    const r = rig();
    r.scripted.startAnswer = { status: 409, body: { error: { code: 'job_running' } } };
    await r.ride(300);
    r.scripted.startAnswer = undefined;
    await r.ride(600);
    expect(r.scripted.starts()).toHaveLength(2);
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
