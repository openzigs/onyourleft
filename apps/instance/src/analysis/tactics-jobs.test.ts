// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Write-ups wait while a model race runs, and still complete** (#2709, ADR
 * 0071 D-6): through the job routes and the tactics routes as the app calls
 * them, sealed, over the real job engine and store, with one model slot shared
 * between them as `instance.ts` shares it. The hold's clock is moved by hand;
 * a job's state is read back through `GET /v1/analysis/jobs/{jobId}`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import { AGENT_RUN_MILLISECONDS } from './agent.ts';
import { PASSING_WRITE_UP, scriptedModel, text } from './agent-testing.ts';
import { agentEngine } from './engine.ts';
import type { AnalysisEngine, ReplanEngine } from './jobs.ts';
import { fakeTimers, jobBody, scriptedEngine } from './jobs-testing.ts';
import { replanBody } from './replan-testing.ts';
import { createRaceHold, TACTICS_HOLD_LAPSE_MS } from './tactics-hold.ts';
import { ATTACK, chatServer, consentToTactics, OFFERED } from './tactics-testing.ts';
import type { ScreenedWriteUp } from '@onyourleft/analysis';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const WRITE_UP = 'A steady hour, held well throughout.' as ScreenedWriteUp;

async function racingWorld(engine: AnalysisEngine, replan?: ReplanEngine) {
  const holdTimers = fakeTimers();
  const hold = createRaceHold({ now: holdTimers.now, timers: holdTimers.timers });
  const synced = await syncWorld(2, {
    analysis: {
      engine,
      available: () => true,
      ...(replan === undefined ? {} : { replan }),
    },
    tactics: { local: OFFERED, fetch: chatServer(() => ATTACK).fetch, hold },
  });
  world = synced.world;
  const [racer, writer] = synced.riders;
  await consentToTactics(synced.world, racer!.token);
  return { w: synced.world, racer: racer!, writer: writer!, holdTimers };
}

async function startRace(w: IdentityInstance, token: string): Promise<void> {
  expect((await w.call('POST', '/v1/analysis/tactics/start', { token })).status).toBe(202);
  await w.tactics.idle();
}

async function startJob(
  w: IdentityInstance,
  token: string,
  path = '/v1/analysis/jobs',
  body = jobBody(),
) {
  const answer = await w.call('POST', path, { token, body });
  expect(answer.status, JSON.stringify(answer.body)).toBe(202);
  return (answer.body as { jobId: string }).jobId;
}

const statusOf = async (w: IdentityInstance, token: string, jobId: string) =>
  ((await w.call('GET', `/v1/analysis/jobs/${jobId}`, { token })).body as { status: string })
    .status;

describe('write-ups during a model race (#2709, ADR 0071 D-6)', () => {
  it('holds a write-up asked during a race, queued, and completes it once the race ends', async () => {
    const engine = scriptedEngine();
    const { w, racer, writer } = await racingWorld(engine.engine);
    await startRace(w, racer.token);

    const jobId = await startJob(w, writer.token);
    await w.analysis?.idle();
    expect(engine.runs).toHaveLength(0);
    expect(await statusOf(w, writer.token, jobId)).toBe('queued');

    expect((await w.call('POST', '/v1/analysis/tactics/end', { token: racer.token })).status).toBe(
      204,
    );
    const run = await engine.next();
    expect(run.job.athleteId).toBe(writer.athleteId);
    run.finish({ kind: 'written', writeUp: WRITE_UP });
    await w.analysis?.idle();
    expect(await statusOf(w, writer.token, jobId)).toBe('succeeded');
  });

  it('starts a held write-up when the race has sent nothing for the lapse, with no request to start it', async () => {
    const engine = scriptedEngine();
    const { w, racer, writer, holdTimers } = await racingWorld(engine.engine);
    await startRace(w, racer.token);
    const jobId = await startJob(w, writer.token);
    await w.analysis?.idle();
    holdTimers.advance(TACTICS_HOLD_LAPSE_MS - 1);
    await w.analysis?.idle();
    expect(engine.runs).toHaveLength(0);

    holdTimers.advance(1);
    (await engine.next()).finish({ kind: 'written', writeUp: WRITE_UP });
    await w.analysis?.idle();
    expect(await statusOf(w, writer.token, jobId)).toBe('succeeded');
  });

  it('does not count the wait against the write-up’s run budget', async () => {
    const holder: { world?: IdentityInstance } = {};
    const engine = agentEngine({
      reads: { listLiveSyncItems: () => Promise.resolve([]) },
      sources: {
        local: scriptedModel(text(PASSING_WRITE_UP)),
        hostedKey: () => Promise.resolve({ kind: 'none' }),
      },
      clock: { now: () => holder.world?.clock.ms ?? 0 },
    });
    const { w, racer, writer } = await racingWorld(engine);
    holder.world = w;
    await startRace(w, racer.token);
    const jobId = await startJob(w, writer.token);
    // Held for longer than the whole budget, the race kept alive all the while.
    w.clock.ms += AGENT_RUN_MILLISECONDS + 60_000;
    await w.call('POST', '/v1/analysis/tactics/start', { token: racer.token });
    await w.analysis?.idle();
    expect(await statusOf(w, writer.token, jobId)).toBe('queued');

    await w.call('POST', '/v1/analysis/tactics/end', { token: racer.token });
    await w.analysis?.idle();
    const job = (await w.call('GET', `/v1/analysis/jobs/${jobId}`, { token: writer.token }))
      .body as { status: string; failure: string | null };
    expect(job).toMatchObject({ status: 'succeeded', failure: null });
  });

  it('leaves a write-up already running to finish when a race starts (D-6.2)', async () => {
    const engine = scriptedEngine();
    const { w, racer, writer } = await racingWorld(engine.engine);
    const jobId = await startJob(w, writer.token);
    const run = await engine.next();
    await startRace(w, racer.token);
    expect(run.signal.aborted).toBe(false);
    expect(await statusOf(w, writer.token, jobId)).toBe('running');
    run.finish({ kind: 'written', writeUp: WRITE_UP });
    await w.analysis?.idle();
    expect(await statusOf(w, writer.token, jobId)).toBe('succeeded');
  });

  it('does not hold a re-plan (D-6.6)', async () => {
    const engine = scriptedEngine();
    const replanned: string[] = [];
    const replan: ReplanEngine = {
      run: (job) => {
        replanned.push(job.athleteId);
        return Promise.resolve({ kind: 'proposed', proposal: null });
      },
    };
    const { w, racer, writer } = await racingWorld(engine.engine, replan);
    await startRace(w, racer.token);
    const heldId = await startJob(w, racer.token);
    const replanId = await startJob(w, writer.token, '/v1/analysis/replans', replanBody());
    await w.analysis?.idle();
    expect(replanned).toEqual([writer.athleteId]);
    expect(await statusOf(w, writer.token, replanId)).toBe('succeeded');
    expect(await statusOf(w, racer.token, heldId)).toBe('queued');
    expect(engine.runs).toHaveLength(0);
  });
});
