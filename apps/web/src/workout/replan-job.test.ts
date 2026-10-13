// SPDX-License-Identifier: AGPL-3.0-or-later

import { beatsPerMinute, seconds, thresholdShare, type WorkoutBlock } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  followReplan,
  goalsToSend,
  replanInput,
  replanRequest,
  REPLAN_SOURCE,
  REPLAN_TEMPLATE_VERSION,
  startReplan,
} from './replan-job';
import { scriptedReplans } from './replan-testing';

const BLOCKS: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.5), label: 'Warm up' },
  {
    kind: 'ramp',
    seconds: seconds(300),
    from: thresholdShare(0.5),
    to: thresholdShare(0.8),
    label: 'Build',
  },
  {
    kind: 'intervals',
    repeats: 4,
    hardSeconds: seconds(60),
    hardTarget: thresholdShare(1.1),
    easySeconds: seconds(60),
    easyTarget: thresholdShare(0.5),
    label: 'Efforts',
  },
  { kind: 'free-ride', seconds: seconds(120), label: 'Spin' },
  {
    kind: 'heart-rate-hold',
    seconds: seconds(600),
    range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
    startShare: thresholdShare(0.5),
    ceilingShare: thresholdShare(0.8),
    label: 'Hold',
  },
];

/** The keys `apps/instance` §`replan-input.ts` §`BLOCK_FIGURES` reads for each kind, with `kind`. */
const INSTANCE_BLOCK_KEYS: Readonly<Record<WorkoutBlock['kind'], readonly string[]>> = {
  steady: ['kind', 'seconds', 'target'],
  ramp: ['from', 'kind', 'seconds', 'to'],
  intervals: ['easySeconds', 'easyTarget', 'hardSeconds', 'hardTarget', 'kind', 'repeats'],
  'free-ride': ['kind', 'seconds'],
  'heart-rate-hold': ['ceilingShare', 'kind', 'range', 'seconds', 'startShare'],
};

const input = () =>
  replanInput({
    revision: 3,
    summarySeq: 5,
    currentBlock: 1,
    goals: { sessionType: 'endurance', timeInRangeMinutes: 20, effortCheckIns: true },
    blocks: BLOCKS,
    summaries: [
      {
        block: 0,
        seconds: 300,
        meanHeartRate: 131,
        highestHeartRate: 140,
        secondsInRange: 250,
        meanPowerShare: 0.52,
        meanCadence: 88,
        rescues: 1,
      },
    ],
  });

describe('what a re-plan request carries — the one builder', () => {
  it('is exactly input, templateVersion and source', () => {
    const request = replanRequest(input());
    expect(Object.keys(request).sort()).toEqual(['input', 'source', 'templateVersion']);
    expect(request.templateVersion).toBe(REPLAN_TEMPLATE_VERSION);
    expect(request.source).toBe(REPLAN_SOURCE);
    // The instance's own model only: a hosted re-plan is not built here.
    expect(REPLAN_SOURCE).toBe('instance-local');
  });

  it('gives every kind of block exactly the keys the instance reads for it, and no label', () => {
    const sent = input().blocks;
    for (const [index, block] of BLOCKS.entries()) {
      expect(Object.keys(sent[index] ?? {}).sort()).toEqual(INSTANCE_BLOCK_KEYS[block.kind]);
    }
    expect(sent[4]?.['range']).toEqual({ low: 130, high: 140 });
    expect(JSON.stringify(sent)).not.toMatch(/label|Warm up|Build|Efforts|Spin|Hold"/);
  });

  it('withholds the goal’s time-in-range target and sends every other goal', () => {
    expect(input().goals).toEqual({ sessionType: 'endurance', effortCheckIns: true });
    expect(goalsToSend({})).toEqual({});
    // The caller's own goals are not changed: the device's validator reads them whole.
    const goals = { timeInRangeMinutes: 20 };
    goalsToSend(goals);
    expect(goals).toEqual({ timeInRangeMinutes: 20 });
  });

  it('copies a summary key by key, so a figure added to one later is not sent by accident', () => {
    const extra = { block: 0, seconds: 10, rescues: 0, position: { latitude: 51.5, longitude: 0 } };
    const built = replanInput({
      revision: 0,
      summarySeq: 1,
      currentBlock: 1,
      goals: {},
      blocks: BLOCKS,
      summaries: [extra],
    });
    expect(built.summaries).toEqual([{ block: 0, seconds: 10, rescues: 0 }]);
  });

  it('carries no watt, date, name or id anywhere in the body', () => {
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(replanRequest(input()));
    expect(
      [...keys].filter((key) => /watt|date|name|id$|label|latitude|longitude/i.test(key)),
    ).toEqual([]);
  });
});

describe('startReplan', () => {
  it('posts the request to the re-plan route under the session’s token', async () => {
    const scripted = scriptedReplans();
    const request = replanRequest(input());
    expect(await startReplan(scripted.session, request)).toEqual({
      kind: 'started',
      jobId: 'job-1',
    });
    expect(scripted.requests).toEqual([
      { method: 'POST', path: '/v1/analysis/replans', body: request },
    ]);
  });

  it('reads a refusal’s code, and nothing else of it', async () => {
    const scripted = scriptedReplans();
    scripted.startAnswer = {
      status: 429,
      body: { error: { code: 'rate_limited', message: 'Slow down.' } },
    };
    expect(await startReplan(scripted.session, replanRequest(input()))).toEqual({
      kind: 'refused',
      code: 'rate_limited',
    });
  });

  it('reads a 202 with no usable job id, or a code that is not one, as a bare refusal', async () => {
    const scripted = scriptedReplans();
    scripted.startAnswer = { status: 202, body: { jobId: '../../cancel' } };
    expect(await startReplan(scripted.session, replanRequest(input()))).toEqual({
      kind: 'refused',
    });
    scripted.startAnswer = { status: 500, body: { error: { code: 'Not A Code' } } };
    expect(await startReplan(scripted.session, replanRequest(input()))).toEqual({
      kind: 'refused',
    });
  });

  it('settles as unreachable when the call fails', async () => {
    const scripted = scriptedReplans();
    scripted.fail = 'send';
    expect(await startReplan(scripted.session, replanRequest(input()))).toEqual({
      kind: 'unreachable',
    });
  });
});

describe('followReplan', () => {
  const follow = async (scripted = scriptedReplans(), signal = new AbortController().signal) => {
    await startReplan(scripted.session, replanRequest(input()));
    return { scripted, result: followReplan(scripted.session, 'job-1', signal) };
  };

  it('hands a proposal on exactly as it arrived, undecoded', async () => {
    const { scripted, result } = await follow();
    const arrived = { revision: 3, summarySeq: 5, move: { kind: 'end-main-set' }, text: 'hello' };
    scripted.answer(arrived);
    expect(await result).toEqual({ kind: 'proposal', proposal: arrived });
  });

  it('hands on null: the model kept the workout as it is', async () => {
    const { scripted, result } = await follow();
    scripted.answer(null);
    expect(await result).toEqual({ kind: 'proposal', proposal: null });
  });

  it('reads a failed job as no proposal', async () => {
    const { scripted, result } = await follow();
    scripted.failed('not-a-proposal');
    expect(await result).toEqual({ kind: 'none' });
  });

  it('reads a result it cannot parse, and a broken stream, as lost', async () => {
    const unreadable = scriptedReplans();
    unreadable.fail = 'receive';
    const first = await follow(unreadable);
    unreadable.answer({ move: { kind: 'end-main-set' } });
    expect(await first.result).toEqual({ kind: 'lost' });

    const broken = scriptedReplans();
    broken.fail = 'wait';
    expect(await (await follow(broken)).result).toEqual({ kind: 'lost' });
  });

  it('ends lost when the caller stops listening', async () => {
    const abort = new AbortController();
    const { scripted, result } = await follow(scriptedReplans(), abort.signal);
    abort.abort();
    expect(await result).toEqual({ kind: 'lost' });
    expect(scripted.openStreams()).toBe(0);
  });

  it('opens no stream for a job id that is not one', async () => {
    const scripted = scriptedReplans();
    expect(
      await followReplan(scripted.session, '../jobs/other', new AbortController().signal),
    ).toEqual({ kind: 'lost' });
    expect(scripted.requests).toEqual([]);
  });
});
