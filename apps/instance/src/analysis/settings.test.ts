// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The operator's analysis settings, resolved (#2609): with no row, exactly
 * `.env` for every combination `config.test.ts` reads the analysis model
 * from; with a row, field by field over `.env`; and the sources and the
 * switch each falling back on their own (ADR 0046's 2026-11-14 amendment,
 * points 1 and 2).
 */

import { describe, expect, it } from 'vitest';

import { readAnalysisModelSettings, readConfig, type AnalysisModelEnv } from '../config.ts';
import type { AnalysisSettingRecord } from '../store/sql-store.ts';
import {
  checkedSettings,
  effectiveAnalysisSettings,
  resolveLocalModel,
  SAVE_LOOKUP_WAIT_MS,
} from './settings.ts';

const NOTHING: AnalysisSettingRecord = {
  localUrl: null,
  localModel: null,
  reasoningTokens: null,
  offerLocal: null,
  offerHosted: null,
  othersLocal: null,
  updatedAt: 1,
  updatedBy: 'app',
};

/**
 * Every `.env` combination `config.test.ts` §"the analysis model's settings"
 * reads, with the state it gives: on, or the code it is off for.
 */
const ENV_CASES: readonly (readonly [AnalysisModelEnv, string])[] = [
  [{}, 'not-set'],
  [{ analysisModelUrl: ' ', analysisModel: 'm' }, 'not-set'],
  [{ analysisModelUrl: 'http://ollama:11434/v1' }, 'no-model'],
  [{ analysisModelUrl: 'http://ollama:11434/v1', analysisModel: 'm:7b' }, 'on'],
  [{ analysisModelUrl: 'http://ollama:11434/v1/', analysisModel: 'm:7b' }, 'on'],
  [{ analysisModelUrl: 'http://127.0.0.1:11434/v1', analysisModel: 'm:7b' }, 'on'],
  [{ analysisModelUrl: 'http://localhost:11434/v1', analysisModel: 'm:7b' }, 'on'],
  [{ analysisModelUrl: 'http://192.168.1.20:11434/v1', analysisModel: 'm:7b' }, 'on'],
  [{ analysisModelUrl: 'http://[fd00::7]:11434/v1', analysisModel: 'm:7b' }, 'on'],
  [
    {
      analysisModelUrl: 'http://ollama:11434/v1',
      analysisModel: 'm',
      analysisModelReasoningTokens: ' 3072 ',
    },
    'on',
  ],
  [
    {
      analysisModelUrl: 'http://ollama:11434/v1',
      analysisModel: 'm',
      analysisModelReasoningTokens: ' ',
    },
    'on',
  ],
  ...['0', '-4', '1.5', 'many', '16385', '1e3x'].map(
    (bad) =>
      [
        {
          analysisModelUrl: 'http://ollama:11434/v1',
          analysisModel: 'm',
          analysisModelReasoningTokens: bad,
        },
        'bad-reasoning',
      ] as const,
  ),
  [{ analysisModelUrl: 'https://models.example.com/v1', analysisModel: 'm' }, 'not-local'],
  [{ analysisModelUrl: 'http://ollama.local:11434/v1', analysisModel: 'm' }, 'not-local'],
  [{ analysisModelUrl: 'http://8.8.8.8/v1', analysisModel: 'm' }, 'not-local'],
  [{ analysisModelUrl: 'https://ollama:11434/v1', analysisModel: 'm' }, 'tls-by-name'],
  [{ analysisModelUrl: 'https://localhost:11434/v1', analysisModel: 'm' }, 'tls-by-name'],
  [{ analysisModelUrl: 'https://192.168.1.20:11434/v1', analysisModel: 'm' }, 'on'],
  [{ analysisModelUrl: 'https://[fd00::7]/v1', analysisModel: 'm' }, 'on'],
  [{ analysisModelUrl: 'not a url', analysisModel: 'm' }, 'not-a-url'],
  [{ analysisModelUrl: 'ftp://ollama/v1', analysisModel: 'm' }, 'not-a-url'],
  [{ analysisModelUrl: 'http://ollama:11434/v1?x=1', analysisModel: 'm' }, 'not-base-url'],
  [{ analysisModelUrl: 'http://ollama:11434/v1', analysisModel: 'two words' }, 'bad-model'],
  // #2840: the model's context, from `.env` only.
  [
    {
      analysisModelUrl: 'http://ollama:11434/v1',
      analysisModel: 'm',
      analysisModelContextTokens: '16384',
    },
    'on',
  ],
  [
    {
      analysisModelUrl: 'http://ollama:11434/v1',
      analysisModel: 'm',
      analysisModelContextTokens: '16k',
    },
    'bad-context',
  ],
];

const stateOf = (settings: ReturnType<typeof readAnalysisModelSettings>): string =>
  settings.kind === 'on' ? 'on' : settings.code;

describe('the model’s context is .env’s under a row that sets the model (#2840)', () => {
  it('keeps the context .env states when the row names the address and the model', () => {
    const settings = resolveLocalModel(
      { ...NOTHING, localUrl: 'http://192.168.1.20:11434/v1', localModel: 'other' },
      {
        analysisModelUrl: 'http://ollama:11434/v1',
        analysisModel: 'm',
        analysisModelContextTokens: '16384',
      },
    );
    expect(settings).toMatchObject({ kind: 'on', model: 'other', contextTokens: 16_384 });
  });
});

describe('no row is .env, for every combination the environment path is read from (#2609)', () => {
  it.each(ENV_CASES.map(([env, state]) => [JSON.stringify(env), env, state] as const))(
    '%s',
    (_name, env, state) => {
      const fromEnv = readAnalysisModelSettings(env);
      expect(stateOf(fromEnv)).toBe(state);
      // The resolver over no row, and the instance's path from `readConfig`.
      expect(resolveLocalModel(undefined, env)).toEqual(fromEnv);
      const config = readConfig({ ...env, commit: '0123456789abcdef0123456789abcdef01234567' });
      if (!config.ok) throw new Error(config.problems.join(' '));
      const effective = effectiveAnalysisSettings(undefined, config.config);
      expect(effective.local).toEqual(fromEnv);
      expect(effective.setIn).toBe(state === 'not-set' ? 'none' : 'env');
      // And a row that sets no model field leaves it there too.
      expect(
        effectiveAnalysisSettings({ ...NOTHING, othersLocal: true }, config.config).local,
      ).toEqual(fromEnv);
    },
  );
});

describe('a row overrides .env field by field (#2609, ADR 0046 2026-11-14 point 2)', () => {
  const env: AnalysisModelEnv = {
    analysisModelUrl: 'http://ollama:11434/v1',
    analysisModel: 'env-model',
    analysisModelReasoningTokens: '1024',
  };
  const environment = { analysis: readAnalysisModelSettings(env), analysisEnv: env };

  it('takes the row’s model and keeps .env’s address and reasoning tokens', () => {
    const local = effectiveAnalysisSettings({ ...NOTHING, localModel: 'app-model' }, environment);
    expect(local.setIn).toBe('app');
    expect(local.local).toMatchObject({ kind: 'on', model: 'app-model', reasoningTokens: 1024 });
    expect(local.local.kind === 'on' && local.local.baseUrl.href).toBe('http://ollama:11434/v1');
  });

  it('takes the row’s address with .env’s model, and the row’s reasoning tokens', () => {
    const local = effectiveAnalysisSettings(
      { ...NOTHING, localUrl: 'http://10.0.0.9:11434/v1', reasoningTokens: 2048 },
      environment,
    ).local;
    expect(local).toMatchObject({ kind: 'on', model: 'env-model', reasoningTokens: 2048 });
    expect(local.kind === 'on' && local.baseUrl.href).toBe('http://10.0.0.9:11434/v1');
  });

  it('turns a model on that .env had only half of', () => {
    const half = { analysisModelUrl: 'http://ollama:11434/v1' };
    const settings = effectiveAnalysisSettings(
      { ...NOTHING, localModel: 'app-model' },
      { analysis: readAnalysisModelSettings(half), analysisEnv: half },
    );
    expect(settings.local).toMatchObject({ kind: 'on', model: 'app-model' });
  });

  it('offers both sources and keeps the switch off unless the row says otherwise', () => {
    expect(effectiveAnalysisSettings(undefined, environment)).toMatchObject({
      offerLocal: true,
      offerHosted: true,
      othersLocal: false,
    });
    expect(
      effectiveAnalysisSettings(
        { ...NOTHING, offerLocal: false, offerHosted: false, othersLocal: true },
        environment,
      ),
    ).toMatchObject({ offerLocal: false, offerHosted: false, othersLocal: true });
  });
});

describe('a save is checked field by field before anything is written (#2609)', () => {
  const resolve = (name: string) =>
    name === 'models-box' ? Promise.resolve(['10.1.2.3']) : Promise.resolve(['8.8.8.8']);

  it('keeps a good address, model and tokens, trimmed, and null as a return to the fallback', async () => {
    expect(
      await checkedSettings(
        {
          localUrl: ' http://models-box:11434/v1 ',
          localModel: ' m:7b ',
          reasoningTokens: 512,
          offerLocal: null,
          othersLocal: false,
        },
        resolve,
      ),
    ).toEqual({
      ok: true,
      values: {
        localUrl: 'http://models-box:11434/v1',
        localModel: 'm:7b',
        reasoningTokens: 512,
        offerLocal: null,
        othersLocal: false,
      },
    });
  });

  it('resolves a name when it is saved, and refuses one that is public now', async () => {
    expect(await checkedSettings({ localUrl: 'http://public-box/v1' }, resolve)).toEqual({
      ok: false,
      fields: [{ field: 'localUrl', problem: 'not-local' }],
    });
  });

  it('refuses a field it does not know, by its name', async () => {
    expect(await checkedSettings({ apiKey: 'x' }, resolve)).toEqual({
      ok: false,
      fields: [{ field: 'apiKey', problem: 'is not a field of this request' }],
    });
  });

  it('refuses a name that does not resolve within its deadline, unresolved, rather than holding the save', async () => {
    const hangs = () => new Promise<readonly string[]>(() => undefined);
    expect(await checkedSettings({ localUrl: 'http://models-box:11434/v1' }, hangs, 20)).toEqual({
      ok: false,
      fields: [{ field: 'localUrl', problem: 'unresolved' }],
    });
  });

  it('waits SAVE_LOOKUP_WAIT_MS by default, a few seconds', () => {
    expect(SAVE_LOOKUP_WAIT_MS).toBeGreaterThanOrEqual(1_000);
    expect(SAVE_LOOKUP_WAIT_MS).toBeLessThanOrEqual(5_000);
  });
});
