// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which model a re-plan runs on** — #1243, ADR 0048 D-11, the owner's
 * ruling on #1233 Q5: the instance's local model, or a hosted one on the
 * rider's OWN key only, under their recorded consent, masked. The operator's
 * key is never used for a rider's re-plan.
 */

import { parseMaskedWords, type MaskingGuard } from '@onyourleft/analysis';
import { describe, expect, it, vi } from 'vitest';

import { calls, movableClock, scriptedModel, text } from './agent-testing.ts';
import { replanEngine } from './engine.ts';
import { maskedConnection } from './hosted.ts';
import type { HostedKeyState } from './hosted-key.ts';
import { MARKER_KEY } from './hosted-key-testing.ts';
import type { ReplanEngineJob } from './jobs.ts';
import { replanInput } from './replan-testing.ts';
import type { SourceOptions } from './source.ts';
import type { AnalysisReads } from './tools/reads.ts';

const ORIGIN = 'https://models.example';
const held = (athleteId: string): HostedKeyState => ({
  kind: 'held',
  url: `${ORIGIN}/v1`,
  model: 'a-model',
  athleteId,
  key: MARKER_KEY,
});
const GUARD: MaskingGuard = { words: parseMaskedWords(['Glenshee']), zones: [] };
const ANSWER = JSON.stringify({ move: { kind: 'end-main-set' }, reason: 'goal-duration' });

const READS: AnalysisReads = {
  listLiveSyncItems: (_athlete, kind) =>
    Promise.resolve(
      kind === 'goal'
        ? [
            {
              key: 'g',
              body: new TextEncoder().encode('{"text":"Ride over Glenshee in June."}'),
            },
          ]
        : [],
    ),
};

const job = (source: ReplanEngineJob['source'], waitedMilliseconds = 0): ReplanEngineJob => ({
  athleteId: 'rider',
  input: replanInput(),
  source,
  waitedMilliseconds,
});

const run = (sources: SourceOptions, of: ReplanEngineJob) =>
  replanEngine({ reads: READS, sources, clock: movableClock() }).run(
    of,
    new AbortController().signal,
    () => undefined,
  );

describe('a re-plan’s model source (ADR 0048 D-11)', () => {
  it('runs on the local model, and says when there is none', async () => {
    const local = scriptedModel(text(ANSWER));
    const hostedKey = vi.fn(() => Promise.resolve(held('rider')));
    expect(await run({ local, hostedKey }, job('instance-local'))).toStrictEqual({
      kind: 'proposed',
      proposal: {
        revision: 2,
        summarySeq: 7,
        move: { kind: 'end-main-set' },
        reason: 'goal-duration',
      },
    });
    expect(await run({ local: undefined, hostedKey }, job('instance-local'))).toStrictEqual({
      kind: 'failed',
      why: 'local_unavailable',
    });
    expect(hostedKey).not.toHaveBeenCalled();
  });

  it('answers a kept workout as a null proposal', async () => {
    const local = scriptedModel(text('{"keep":true}'));
    expect(
      await run(
        { local, hostedKey: () => Promise.resolve({ kind: 'none' }) },
        job('instance-local'),
      ),
    ).toStrictEqual({ kind: 'proposed', proposal: null });
  });

  it('counts what the job waited against its budget', async () => {
    const local = scriptedModel(text(ANSWER));
    expect(
      await run(
        { local, hostedKey: () => Promise.resolve({ kind: 'none' }) },
        job('instance-local', 45_000),
      ),
    ).toStrictEqual({ kind: 'failed', why: 'out-of-time' });
    expect(local.requests).toHaveLength(0);
  });

  it.each<[string, Partial<SourceOptions>]>([
    ['the rider has no key of their own', { hostedKey: () => Promise.resolve({ kind: 'none' }) }],
    ['the only key held is the operator’s', { hostedKey: () => Promise.resolve(held('operator')) }],
    ['the rider has recorded no consent', { recordedConsent: () => Promise.resolve(undefined) }],
    [
      'their consent names another endpoint',
      { recordedConsent: () => Promise.resolve('https://elsewhere.example') },
    ],
    ['they have no masking guard', { guard: () => Promise.resolve(undefined) }],
  ])('refuses a hosted re-plan when %s, and sends nothing', async (_why, changed) => {
    const hosted = scriptedModel(text(ANSWER));
    const local = scriptedModel(text(ANSWER));
    const outcome = await run(
      {
        local,
        hostedKey: () => Promise.resolve(held('rider')),
        recordedConsent: () => Promise.resolve(ORIGIN),
        guard: () => Promise.resolve(GUARD),
        behindMasking: (_key, guard) => maskedConnection(hosted, guard),
        ...changed,
      },
      job('instance-hosted'),
    );
    expect(outcome).toStrictEqual({ kind: 'failed', why: 'hosted_unavailable' });
    // Nothing went to the hosted model, and it did not fall back to the local one.
    expect(hosted.requests).toHaveLength(0);
    expect(local.requests).toHaveLength(0);
  });

  it('runs a hosted re-plan on the rider’s own key, with every tool result masked', async () => {
    const hosted = scriptedModel(calls(['goals', {}]), text(ANSWER));
    const outcome = await run(
      {
        local: undefined,
        hostedKey: () => Promise.resolve(held('rider')),
        recordedConsent: () => Promise.resolve(ORIGIN),
        guard: () => Promise.resolve(GUARD),
        behindMasking: (_key, guard) => maskedConnection(hosted, guard),
      },
      job('instance-hosted'),
    );
    expect(outcome.kind).toBe('proposed');
    const sent = JSON.stringify(hosted.requests);
    // The control: the goal did reach the model, without the masked word.
    expect(sent).toContain('Ride over');
    expect(sent).not.toContain('Glenshee');
  });
});
