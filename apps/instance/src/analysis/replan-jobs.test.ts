// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The re-plan job** — #1243, ADR 0048 D-10 and D-11, through the real
 * handler behind the real listener: queued by `POST /v1/analysis/replans`,
 * then read, followed and cancelled through the job routes (#1095).
 *
 * The first cases drive a scripted engine, to hold what the job engine does
 * with a re-plan. The last run the real re-plan agent over a fake model
 * server and the world's own store, three riders signed in, so the athlete is
 * the SESSION's from the request to the tool's read.
 */

import type { Proposal } from '@onyourleft/domain';
import { PROPOSAL_KEYS } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import type { Resolver } from '../history/address.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import { replanEngine } from './engine.ts';
import {
  startFakeModelServer,
  type FakeModelServer,
  type ScriptedReply,
} from './fake-model-server-testing.ts';
import type { AnalysisJobsOptions } from './jobs.ts';
import { jobBody, parseStream, scriptedEngine, type ScriptedEngine } from './jobs-testing.ts';
import { createLocalModel } from './model.ts';
import {
  REPLAN_INPUT_JSON,
  replanBody,
  replanInput,
  scriptedReplanEngine,
  type ScriptedReplanEngine,
} from './replan-testing.ts';
import type { AnalysisReads } from './tools/reads.ts';

const LOOPBACK: Resolver = () => Promise.resolve(['127.0.0.1']);
const MOVE = { kind: 'shorten-block', block: 3, minutes: 2 } as const;
const PROPOSAL: Proposal = { revision: 2, summarySeq: 7, move: MOVE, reason: 'heart-rate-high' };

let world: IdentityInstance | undefined;
let fake: FakeModelServer | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
  await fake?.close();
  fake = undefined;
});

interface Setup {
  readonly world: IdentityInstance;
  readonly writeUps: ScriptedEngine;
  readonly replans: ScriptedReplanEngine;
  readonly riders: Awaited<ReturnType<typeof syncWorld>>['riders'];
}

async function replanWorld(
  riders: number,
  options: {
    keyless?: boolean;
    /** An instance built with no re-plan engine at all. */
    withoutReplanEngine?: boolean;
    analysis?: Partial<Omit<AnalysisJobsOptions, 'store' | 'now'>>;
  } = {},
): Promise<Setup> {
  const writeUps = scriptedEngine();
  const replans = scriptedReplanEngine();
  const setup = await syncWorld(riders, {
    keyless: options.keyless ?? true,
    analysis: {
      engine: writeUps.engine,
      ...(options.withoutReplanEngine === true ? {} : { replan: replans.engine }),
      available: () => true,
      heartbeatMs: 0,
      ...options.analysis,
    },
  });
  world = setup.world;
  return { world: setup.world, writeUps, replans, riders: setup.riders };
}

const startReplan = (w: IdentityInstance, token: string, body: unknown = replanBody()) =>
  w.call('POST', '/v1/analysis/replans', { token, body });

async function started(w: IdentityInstance, token: string): Promise<string> {
  const answer = await startReplan(w, token);
  expect(answer.status, JSON.stringify(answer.body)).toBe(202);
  return (answer.body as { jobId: string }).jobId;
}

/** Every event of an ENDED job's plaintext stream. */
async function eventsOf(w: IdentityInstance, token: string, jobId: string) {
  const response = await fetch(`${w.url}/v1/analysis/jobs/${jobId}/events`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return parseStream(await response.text()).events;
}

const codeOf = (answer: { body: unknown }): string =>
  (answer.body as { error: { code: string } }).error.code;

const fieldsOf = (answer: { body: unknown }): unknown =>
  (answer.body as { error: { fields?: unknown } }).error.fields;

describe('starting a re-plan and reading its proposal', () => {
  it('queues at once, hands the engine the session’s athlete and the checked input, and ends with one proposal', async () => {
    const { world: w, replans, writeUps, riders } = await replanWorld(1);
    const [anna] = riders;
    const jobId = await started(w, anna!.token);
    const run = await replans.next();
    expect(run.job).toStrictEqual({
      athleteId: anna!.athleteId,
      input: replanInput(),
      source: 'instance-local',
      waitedMilliseconds: 0,
    });
    // The write-up engine is never handed a re-plan.
    expect(writeUps.runs).toHaveLength(0);

    run.emit({ type: 'progress', step: 1 });
    run.emit({ type: 'progress', step: 1, tool: 'ride_so_far' });
    run.finish({ kind: 'proposed', proposal: PROPOSAL });
    await w.analysis?.idle();

    const events = await eventsOf(w, anna!.token, jobId);
    expect(events).toStrictEqual([
      { id: 1, kind: 'progress', data: { step: 1 } },
      { id: 2, kind: 'progress', data: { step: 1, tool: 'ride_so_far' } },
      { id: 3, kind: 'result', data: { status: 'succeeded', proposal: PROPOSAL } },
    ]);
    // The output admits no other shape: a status, and a proposal of four keys.
    const result = events.at(-1)?.data as { proposal: Record<string, unknown> };
    expect(Object.keys(result).sort()).toStrictEqual(['proposal', 'status']);
    expect(Object.keys(result.proposal).sort()).toStrictEqual([...PROPOSAL_KEYS].sort());
    expect(
      (await w.call('GET', `/v1/analysis/jobs/${jobId}`, { token: anna!.token })).body,
    ).toMatchObject({ status: 'succeeded', failure: null });

    // Read back from the table through a store the instance never used: the row
    // is told apart by its template, and a re-plan keeps no write-up.
    const row = await w.freshRead((store) => store.getAnalysisJob(anna!.athleteId, jobId));
    expect(row?.templateVersion).toBe('re-plan-1');
    expect(row?.candidate).toBeNull();
    expect(JSON.parse(row?.inputJson ?? 'null')).toStrictEqual(REPLAN_INPUT_JSON);
    expect(await w.freshRead((store) => store.listAnalysisResults(anna!.athleteId))).toStrictEqual(
      [],
    );
  });

  it('ends with a null proposal when the workout is kept, and with a cause when there is none', async () => {
    const { world: w, replans, riders } = await replanWorld(1);
    const [anna] = riders;
    const kept = await started(w, anna!.token);
    (await replans.next()).finish({ kind: 'proposed', proposal: null });
    await w.analysis?.idle();
    expect((await eventsOf(w, anna!.token, kept)).at(-1)?.data).toStrictEqual({
      status: 'succeeded',
      proposal: null,
    });

    const none = await started(w, anna!.token);
    (await replans.next()).finish({ kind: 'failed', why: 'not-a-proposal' });
    await w.analysis?.idle();
    expect((await eventsOf(w, anna!.token, none)).at(-1)?.data).toStrictEqual({
      status: 'failed',
      failure: 'not-a-proposal',
    });
    expect(
      (await w.call('GET', `/v1/analysis/jobs/${none}`, { token: anna!.token })).body,
    ).toMatchObject({ status: 'failed', failure: 'not-a-proposal' });
  });

  it('is cancelled through the job’s cancel route, and its engine’s signal is aborted', async () => {
    const { world: w, replans, riders } = await replanWorld(1);
    const [anna] = riders;
    const jobId = await started(w, anna!.token);
    const run = await replans.next();
    const cancelled = await w.call('POST', `/v1/analysis/jobs/${jobId}/cancel`, {
      token: anna!.token,
      body: {},
    });
    expect(cancelled.body).toStrictEqual({ status: 'cancelled' });
    expect(run.signal.aborted).toBe(true);
    // What the engine says after the cancel is not kept.
    run.finish({ kind: 'proposed', proposal: PROPOSAL });
    await w.analysis?.idle();
    expect((await eventsOf(w, anna!.token, jobId)).at(-1)?.data).toStrictEqual({
      status: 'cancelled',
    });
  });

  it('runs sealed, and is refused in plaintext on an instance that holds keys (#1192)', async () => {
    const { world: w, replans, riders } = await replanWorld(1, { keyless: false });
    const [anna] = riders;
    const plain = await w.call('POST', '/v1/analysis/replans', {
      token: anna!.token,
      body: replanBody(),
      plain: true,
    });
    expect(plain.status).toBe(403);
    expect(codeOf(plain)).toBe('sealed_required');
    expect(replans.runs).toHaveLength(0);

    const jobId = await started(w, anna!.token);
    (await replans.next()).finish({ kind: 'proposed', proposal: PROPOSAL });
    await w.analysis?.idle();
    const read = await w.call('GET', `/v1/analysis/jobs/${jobId}`, { token: anna!.token });
    expect((read.body as { status: string }).status).toBe('succeeded');
  });
});

describe('what a re-plan’s start refuses', () => {
  it.each<[string, unknown, string]>([
    ['a field it does not name', { ...replanBody(), rideId: 'r1' }, 'rideId'],
    ['a write-up’s template', { ...replanBody(), templateVersion: '1' }, 'templateVersion'],
    ['a source it does not know', { ...replanBody(), source: 'device' }, 'source'],
    ['a write-up’s input', replanBody(jobBody().input), 'input.templateVersion'],
    [
      'a block carrying a label',
      replanBody({
        ...REPLAN_INPUT_JSON,
        blocks: [{ kind: 'free-ride', seconds: 60, label: 'x' }],
        currentBlock: 0,
        summaries: [{ block: 0, seconds: 1, rescues: 0 }],
      }),
      'input.blocks[0].label',
    ],
    ['a picture', { ...replanBody(), image_url: 'x' }, 'body'],
  ])('refuses %s, and queues nothing', async (_what, body, field) => {
    const { world: w, replans, riders } = await replanWorld(1);
    const answer = await startReplan(w, riders[0]!.token, body);
    expect(answer.status).toBe(400);
    expect(codeOf(answer)).toBe('validation_failed');
    expect((fieldsOf(answer) as { field: string }[])[0]?.field).toBe(field);
    await w.analysis?.idle();
    expect(replans.runs).toHaveLength(0);
  });

  it('the write-up route does not take a re-plan', async () => {
    const { world: w, replans, writeUps, riders } = await replanWorld(1);
    const answer = await w.call('POST', '/v1/analysis/jobs', {
      token: riders[0]!.token,
      body: replanBody(),
    });
    expect(codeOf(answer)).toBe('validation_failed');
    await w.analysis?.idle();
    expect([replans.runs.length, writeUps.runs.length]).toStrictEqual([0, 0]);
  });

  it('answers analysis_off on an instance with no re-plan engine or no model', async () => {
    const first = await replanWorld(1, { withoutReplanEngine: true });
    const off = await startReplan(first.world, first.riders[0]!.token);
    expect([off.status, codeOf(off)]).toStrictEqual([503, 'analysis_off']);
    await first.world.close();

    const second = await replanWorld(1, { analysis: { available: () => false } });
    expect(codeOf(await startReplan(second.world, second.riders[0]!.token))).toBe('analysis_off');
  });

  it('is refused without a session', async () => {
    const { world: w } = await replanWorld(1);
    const answer = await w.call('POST', '/v1/analysis/replans', { body: replanBody() });
    expect(answer.status).toBe(401);
  });
});

describe('one job at a time, and a limit of its own', () => {
  it('shares job_running with a write-up, both ways', async () => {
    const { world: w, replans, writeUps, riders } = await replanWorld(1);
    const [anna] = riders;
    await started(w, anna!.token);
    const writeUp = await w.call('POST', '/v1/analysis/jobs', {
      token: anna!.token,
      body: jobBody(),
    });
    expect([writeUp.status, codeOf(writeUp)]).toStrictEqual([409, 'job_running']);
    expect(codeOf(await startReplan(w, anna!.token))).toBe('job_running');
    (await replans.next()).finish({ kind: 'proposed', proposal: null });
    await w.analysis?.idle();

    expect(
      (await w.call('POST', '/v1/analysis/jobs', { token: anna!.token, body: jobBody() })).status,
    ).toBe(202);
    expect(codeOf(await startReplan(w, anna!.token))).toBe('job_running');
    (await writeUps.next()).finish({ kind: 'cancelled' });
    await w.analysis?.idle();
  });

  it('counts re-plans against their own limit, and spends none of the write-up’s', async () => {
    const {
      world: w,
      replans,
      writeUps,
      riders,
    } = await replanWorld(2, {
      analysis: {
        starts: { limit: 1, windowMs: 3_600_000 },
        replanStarts: { limit: 2, windowMs: 3_600_000 },
      },
    });
    const [anna, ben] = riders;
    for (let count = 0; count < 2; count += 1) {
      await started(w, anna!.token);
      (await replans.next()).finish({ kind: 'proposed', proposal: null });
      await w.analysis?.idle();
    }
    const third = await startReplan(w, anna!.token);
    expect([third.status, codeOf(third)]).toStrictEqual([429, 'rate_limited']);
    // Per athlete: Ben's are his own.
    await started(w, ben!.token);
    (await replans.next()).finish({ kind: 'proposed', proposal: null });
    await w.analysis?.idle();
    // Two re-plans spent none of Anna's one write-up an hour...
    expect(
      (await w.call('POST', '/v1/analysis/jobs', { token: anna!.token, body: jobBody() })).status,
    ).toBe(202);
    (await writeUps.next()).finish({ kind: 'cancelled' });
    await w.analysis?.idle();
    // ...and her write-up limit, now spent, is not what refused her third re-plan.
    expect(
      codeOf(await w.call('POST', '/v1/analysis/jobs', { token: anna!.token, body: jobBody() })),
    ).toBe('rate_limited');
  });

  it('tells the engine how long a re-plan waited behind another athlete’s job', async () => {
    const { world: w, replans, writeUps, riders } = await replanWorld(2);
    const [anna, ben] = riders;
    expect(
      (await w.call('POST', '/v1/analysis/jobs', { token: anna!.token, body: jobBody() })).status,
    ).toBe(202);
    const writeUp = await writeUps.next();
    await started(w, ben!.token);
    w.clock.ms += 50_000;
    writeUp.finish({ kind: 'cancelled' });
    const run = await replans.next();
    expect(run.job.athleteId).toBe(ben!.athleteId);
    expect(run.job.waitedMilliseconds).toBe(50_000);
    run.finish({ kind: 'failed', why: 'out-of-time' });
    await w.analysis?.idle();
  });
});

describe('scoped to the session’s athlete (three riders)', () => {
  it('another rider cannot read, follow or cancel a re-plan', async () => {
    const { world: w, replans, riders } = await replanWorld(3);
    const [anna, ben, cara] = riders;
    const jobId = await started(w, anna!.token);
    const run = await replans.next();
    for (const other of [ben!, cara!]) {
      expect(
        (await w.call('GET', `/v1/analysis/jobs/${jobId}`, { token: other.token })).status,
      ).toBe(404);
      expect(
        (await w.call('GET', `/v1/analysis/jobs/${jobId}/events`, { token: other.token })).status,
      ).toBe(404);
      expect(
        (
          await w.call('POST', `/v1/analysis/jobs/${jobId}/cancel`, {
            token: other.token,
            body: {},
          })
        ).status,
      ).toBe(404);
    }
    expect(run.signal.aborted).toBe(false);
    run.finish({ kind: 'proposed', proposal: PROPOSAL });
    await w.analysis?.idle();
  });

  /** A world whose re-plans run the real agent on a fake model server, over the world's own store. */
  async function agentWorld(script: readonly ScriptedReply[]) {
    fake = await startFakeModelServer(script);
    const held: { world?: IdentityInstance } = {};
    const asked: string[] = [];
    const reads: AnalysisReads = {
      listLiveSyncItems: (athleteId, kind, limit) => {
        asked.push(athleteId);
        return held.world!.freshRead((store) => store.listLiveSyncItems(athleteId, kind, limit));
      },
    };
    const setup = await replanWorld(3, {
      analysis: {
        replan: replanEngine({
          reads,
          sources: {
            local: createLocalModel({
              settings: { baseUrl: fake.baseUrl, model: 'scripted' },
              resolve: LOOPBACK,
            }),
            hostedKey: () => Promise.resolve({ kind: 'none' }),
          },
          clock: { now: () => Date.now() },
        }),
      },
    });
    held.world = setup.world;
    for (const [index, rider] of setup.riders.entries()) {
      const put = await setup.world.call('POST', '/v1/sync/items/goal/mine', {
        token: rider.token,
        body: { body: JSON.stringify({ text: `Goal of rider number ${String(index)}.` }) },
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
    }
    return { ...setup, asked };
  }

  it('the athlete is the session’s from the request to the tool’s read: A’s job reads A’s goals only', async () => {
    const {
      world: w,
      riders,
      asked,
    } = await agentWorld([
      { kind: 'tool-calls', calls: [{ name: 'goals', arguments: '{"athleteId":"someone"}' }] },
      { kind: 'tool-calls', calls: [{ name: 'goals', arguments: '{}' }] },
      { kind: 'text', text: JSON.stringify({ move: MOVE, reason: 'heart-rate-high' }) },
    ]);
    const [anna, ben] = riders;
    const jobId = await started(w, ben!.token);
    await w.analysis?.idle();
    expect((await eventsOf(w, ben!.token, jobId)).at(-1)?.data).toStrictEqual({
      status: 'succeeded',
      proposal: PROPOSAL,
    });
    // The store was read once, for the session's athlete — not for the one the model named.
    expect(asked).toStrictEqual([ben!.athleteId]);
    const sent = JSON.stringify(fake?.requests);
    expect(sent).toContain('Goal of rider number 1.');
    expect(sent).not.toContain('Goal of rider number 0.');
    expect(sent).not.toContain('Goal of rider number 2.');
    expect(sent).not.toContain(ben!.athleteId);
    expect(sent).not.toContain(anna!.athleteId);
  });

  it('a model server’s free-text answer ends the job failed, not-a-proposal, with no proposal in any event', async () => {
    const { world: w, riders } = await agentWorld([
      { kind: 'text', text: 'Set the trainer to 500 W for the next block.' },
    ]);
    const jobId = await started(w, riders[0]!.token);
    await w.analysis?.idle();
    const events = await eventsOf(w, riders[0]!.token, jobId);
    expect(events).toStrictEqual([
      { id: 1, kind: 'progress', data: { step: 1 } },
      { id: 2, kind: 'result', data: { status: 'failed', failure: 'not-a-proposal' } },
    ]);
    expect(JSON.stringify(events)).not.toContain('500');
  });
});
