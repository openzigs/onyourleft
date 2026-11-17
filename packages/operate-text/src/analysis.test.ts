// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  aiNowLines,
  withoutUserinfo,
  analysisHolds,
  CHECK_TEXT,
  jobCountLines,
  jobLine,
  LOCAL_STATE_TEXT,
  modelLine,
  ownKeyText,
  SERVER_STATE_TEXT,
  type OperateAnalysisAnswer,
} from './analysis';

const ANALYSIS: OperateAnalysisAnswer = {
  local: {
    url: 'http://ollama:11434/v1',
    model: null,
    reasoningTokens: null,
    offered: true,
    othersMayUse: false,
    setIn: 'env',
    state: 'no-model',
  },
  hosted: { offered: true, operatorKey: 'none', operatorKeyOrigin: null },
};

const text = (line: readonly (string | { readonly code: string })[]): string =>
  line.map((part) => (typeof part === 'string' ? part : part.code)).join('');

describe('AI backend’s words — #2611, moved by #2648', () => {
  it('says the Now lines, an address and a model as code, and the version only when there is one', () => {
    expect(aiNowLines(ANALYSIS, null).map(text)).toEqual([
      'Local server: http://ollama:11434/v1 (from the instance’s .env)',
      'Model: none chosen',
      'Off: no model is chosen.',
    ]);
    const set = aiNowLines(
      {
        ...ANALYSIS,
        local: { ...ANALYSIS.local, url: null, model: 'alpha:14b', setIn: 'app', state: 'on' },
      },
      '0.12.6',
    );
    expect(set).toEqual([
      ['Local server: ', 'none', ' (set here)'],
      ['Model: ', { code: 'alpha:14b' }],
      ['On: write-ups can run on it.'],
      ['Ollama 0.12.6'],
    ]);
  });

  it('never says an address’s user:password, in a line or on its own (#2611)', () => {
    const secret = 'http://MARKER-user:MARKER-pass@ollama:11434/v1';
    expect(withoutUserinfo(secret)).toBe('http://ollama:11434/v1');
    expect(withoutUserinfo('https://ollama:11434/v1?a=b@c')).toBe('https://ollama:11434/v1?a=b@c');
    const lines = aiNowLines({ ...ANALYSIS, local: { ...ANALYSIS.local, url: secret } }, null);
    expect(JSON.stringify(lines)).not.toContain('MARKER');
    expect(text(lines[0] ?? [])).toBe(
      'Local server: http://ollama:11434/v1 (from the instance’s .env)',
    );
  });

  it('names every state, server state and check outcome the instance writes', () => {
    expect(Object.keys(LOCAL_STATE_TEXT)).toHaveLength(9);
    expect(Object.keys(SERVER_STATE_TEXT).sort()).toEqual(
      ['no-address', 'not-local', 'openai-compatible', 'unreachable', 'unresolved'].sort(),
    );
    expect(Object.keys(CHECK_TEXT)).toHaveLength(9);
  });

  it('says a model’s line in the server’s order, leaving out what it did not say', () => {
    expect(
      modelLine({
        name: 'beta:32b',
        sizeBytes: 19_900_000_000,
        parameters: '32.8B',
        quantisation: 'Q4_K_M',
        tools: 'listed',
        gpu: 'part',
        gpuPercent: 62,
      }),
    ).toBe('32.8B, Q4_K_M, 19.9 GB, lists tool support, in GPU memory: part, 62 %');
    expect(
      modelLine({
        name: 'x',
        sizeBytes: null,
        parameters: null,
        quantisation: null,
        tools: 'not-reported',
        gpu: 'not-known',
        gpuPercent: null,
      }),
    ).toBe('tool support not reported, in GPU memory: not known');
  });

  it('says the jobs without naming a rider', () => {
    expect(
      jobLine({
        kind: 're-plan',
        source: 'hosted',
        status: 'failed',
        failure: 'model-without-tools',
        createdAt: '2026-11-14T09:50:00.000Z',
        endedAt: null,
        whose: 'other',
      }),
    ).toBe(
      'Re-plan, on a hosted service, another rider’s: failed (model-without-tools), 2026-11-14 09:50 UTC',
    );
    expect(
      jobCountLines({
        counts: { queued: 1, running: 0, succeeded: 4, failed: 1, cancelled: 0, withheld: 2 },
        failures: [
          { code: 'model-without-tools', count: 1 },
          { code: null, count: 3 },
        ],
        recent: [],
      }),
    ).toEqual([
      '1 waiting, 0 running',
      'Last seven days: 4 done, 1 failed, 2 withheld, 0 cancelled',
      'Failed model-without-tools: 1',
      'Failed with no reason: 3',
    ]);
  });

  it('describes the owner’s own key as held or not, for which origin, and never shows one', () => {
    expect(ownKeyText(ANALYSIS)).toBe('No hosted key of yours is held.');
    expect(
      ownKeyText({
        ...ANALYSIS,
        hosted: { offered: true, operatorKey: 'held', operatorKeyOrigin: 'https://models.example' },
      }),
    ).toBe('Your key is held for https://models.example, and this instance’s secret opens it.');
    expect(
      ownKeyText({
        ...ANALYSIS,
        hosted: { offered: true, operatorKey: 'held-unreadable', operatorKeyOrigin: null },
      }),
    ).toBe('Your key is held, and this instance’s secret cannot open it.');
  });

  it('holds a change only when the read-back says every field it set, null being the fallback', () => {
    expect(analysisHolds(ANALYSIS, { offerLocal: true })).toBe(true);
    expect(analysisHolds(ANALYSIS, { offerLocal: false })).toBe(false);
    expect(analysisHolds(ANALYSIS, { othersLocal: null })).toBe(true);
    expect(analysisHolds(ANALYSIS, { othersLocal: true })).toBe(false);
    expect(analysisHolds(ANALYSIS, { offerHosted: null })).toBe(true);
    expect(analysisHolds(ANALYSIS, { localModel: 'alpha:14b' })).toBe(false);
    expect(
      analysisHolds(
        { ...ANALYSIS, local: { ...ANALYSIS.local, model: 'alpha:14b' } },
        {
          localModel: 'alpha:14b',
        },
      ),
    ).toBe(true);
  });
});
