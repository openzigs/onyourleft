// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  beatsPerMinute,
  seconds,
  thresholdShare,
  type WorkoutBlock,
  type WorkoutGoals,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  followReplan,
  goalsToSend,
  replanInput,
  replanInputWithin,
  replanRequest,
  REPLAN_INPUT_BYTE_BUDGET,
  REPLAN_MAXIMUM_SUMMARIES,
  REPLAN_SOURCE,
  REPLAN_TEMPLATE_VERSION,
  startReplan,
  type BlockSummary,
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

/** Every typed goal set, the withheld one among them. */
const EVERY_GOAL: WorkoutGoals = {
  sessionType: 'endurance',
  durationMinutes: 60,
  holdRange: { low: beatsPerMinute(130), high: beatsPerMinute(142) },
  heartRateAbove: beatsPerMinute(150),
  powerCeiling: thresholdShare(0.8),
  timeInRangeMinutes: 30,
  effortCheckIns: true,
};

/**
 * What the two golden requests are built from, as the device holds it: blocks
 * with the rider's labels, goals with the withheld target, and summaries. The
 * files are `packages/domain/src/workout/fixtures/replan-request*.json`, and
 * `apps/instance` §`replan-jobs.test.ts` posts the same two files to the
 * instance's own start. A change to the builder that changes what leaves is
 * red here until the file is regenerated, and then red there if the instance
 * does not take it.
 */
const GOLDEN_FROM = {
  revision: 1,
  summarySeq: 3,
  currentBlock: 3,
  goals: EVERY_GOAL,
  blocks: BLOCKS,
  summaries: [
    {
      block: 0,
      seconds: 300,
      meanHeartRate: 118,
      highestHeartRate: 131,
      meanPowerShare: 0.52,
      meanCadence: 88,
      rescues: 0,
    },
    // A block with no strap reading and no cadence: absent, never a zero.
    { block: 1, seconds: 300, meanPowerShare: 0.655, rescues: 1 },
    { block: 2, seconds: 480, meanHeartRate: 151, highestHeartRate: 163, rescues: 0 },
  ],
} satisfies Parameters<typeof replanInput>[0];

/** The longest plan the instance reads, every kind of block in it, 63 of its 64 blocks ridden. */
const LONG_BLOCKS: readonly WorkoutBlock[] = Array.from(
  { length: 64 },
  (_, index) => BLOCKS[index % BLOCKS.length] as WorkoutBlock,
);
const LONG_SUMMARIES: readonly BlockSummary[] = Array.from({ length: 63 }, (_, index) => ({
  block: index,
  seconds: 300 + index,
  meanHeartRate: 120 + (index % 40),
  highestHeartRate: 130 + (index % 40),
  ...(index % BLOCKS.length === 4 ? { secondsInRange: 200 + index } : {}),
  meanPowerShare: 0.5 + (index % 50) / 1000,
  meanCadence: 80 + (index % 20),
  rescues: index % 3,
}));
const LONG_FROM = {
  revision: 0,
  summarySeq: 12,
  currentBlock: 63,
  goals: EVERY_GOAL,
  blocks: LONG_BLOCKS,
  summaries: LONG_SUMMARIES,
} satisfies Parameters<typeof replanInput>[0];

const golden = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../../packages/domain/src/workout/fixtures/${file}`, import.meta.url),
      ),
      'utf8',
    ),
  );

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

  it('sends every goal the privacy policy names, each under its own key, and the range as two numbers', () => {
    expect(goalsToSend(EVERY_GOAL)).toStrictEqual({
      sessionType: 'endurance',
      durationMinutes: 60,
      holdRange: { low: 130, high: 142 },
      heartRateAbove: 150,
      powerCeiling: 0.8,
      effortCheckIns: true,
    });
    expect(Object.keys(goalsToSend(EVERY_GOAL))).not.toContain('timeInRangeMinutes');
  });

  it('names each goal it sends, so a goal added later is not sent until it is named', () => {
    // A goal a later build adds, and a key smuggled into the range.
    const later = {
      ...EVERY_GOAL,
      restingHeartRate: 48,
      note: 'ease off',
      holdRange: { low: beatsPerMinute(130), high: beatsPerMinute(142), label: 'Zone 2' },
    } as unknown as WorkoutGoals;
    const sent = goalsToSend(later);
    expect(Object.keys(sent).sort()).toEqual([
      'durationMinutes',
      'effortCheckIns',
      'heartRateAbove',
      'holdRange',
      'powerCeiling',
      'sessionType',
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/restingHeartRate|note|ease off|Zone 2|label/);
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

describe('what is sent is held to the instance’s budget — replanInputWithin', () => {
  it('sends every summary when they fit', () => {
    const from = { ...GOLDEN_FROM };
    expect(replanInputWithin(from)).toStrictEqual(replanInput(from));
  });

  it('leaves out the OLDEST summaries of a long workout, and stays inside 8 KB', () => {
    const built = replanInputWithin(LONG_FROM);
    if (built === undefined) throw new Error('nothing was built');
    const bytes = (value: unknown): number =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength;
    expect(REPLAN_INPUT_BYTE_BUDGET).toBe(8 * 1024);
    // All 63 would not fit: that is the request the instance refuses.
    expect(bytes(replanInput(LONG_FROM))).toBeGreaterThan(REPLAN_INPUT_BYTE_BUDGET);
    expect(bytes(built)).toBeLessThanOrEqual(REPLAN_INPUT_BYTE_BUDGET);
    // The most recent ones, in order, ending with the block just ridden.
    const kept = built.summaries.map((each) => each.block);
    expect(kept.length).toBeGreaterThan(10);
    expect(kept.length).toBeLessThan(LONG_FROM.summaries.length);
    expect(kept).toEqual(LONG_FROM.summaries.slice(-kept.length).map((each) => each.block));
    expect(kept.at(-1)).toBe(62);
    // As many as fit: one more would not.
    const oneMore = replanInput({
      ...LONG_FROM,
      summaries: LONG_FROM.summaries.slice(-(kept.length + 1)),
    });
    expect(bytes(oneMore)).toBeGreaterThan(REPLAN_INPUT_BYTE_BUDGET);
    // The plan and the goals are sent whole whatever is left out.
    expect(built.blocks).toHaveLength(64);
    expect(built.goals).toStrictEqual(goalsToSend(EVERY_GOAL));
  });

  it('never sends more summaries than the instance reads', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      block: 0,
      seconds: index,
      rescues: 0,
    }));
    const built = replanInputWithin({ ...GOLDEN_FROM, summaries: many });
    expect(built?.summaries).toHaveLength(REPLAN_MAXIMUM_SUMMARIES);
    expect(built?.summaries.at(-1)?.seconds).toBe(79);
  });

  it('builds nothing when no summary fits beside the plan, or there is none', () => {
    expect(replanInputWithin(LONG_FROM, 2_000)).toBeUndefined();
    expect(replanInputWithin({ ...GOLDEN_FROM, summaries: [] })).toBeUndefined();
  });
});

describe('the golden requests: one file the device’s suite and the instance’s both read', () => {
  it('is exactly what the builder produces for an ordinary workout', () => {
    const built = replanInputWithin(GOLDEN_FROM);
    if (built === undefined) throw new Error('nothing was built');
    expect(JSON.parse(JSON.stringify(replanRequest(built)))).toStrictEqual(
      golden('replan-request.json'),
    );
  });

  it('is exactly what the builder produces for a long workout, bounded', () => {
    const built = replanInputWithin(LONG_FROM);
    if (built === undefined) throw new Error('nothing was built');
    expect(JSON.parse(JSON.stringify(replanRequest(built)))).toStrictEqual(
      golden('replan-request-long.json'),
    );
  });

  it('holds this build’s template version and source', () => {
    for (const file of ['replan-request.json', 'replan-request-long.json']) {
      expect(golden(file)).toMatchObject({
        templateVersion: REPLAN_TEMPLATE_VERSION,
        source: REPLAN_SOURCE,
      });
    }
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
