// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The test question's own rules (#1251), over a scripted model: what one turn
 * is asked, and how every way a turn can fail is said — in a word the route
 * declares, and never in the service's. The route itself, sealed, over a real
 * listener and a scripted model server, is `hosted-routes.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { HOSTED_ROUTES } from './hosted-routes.ts';
import {
  askHostedTestQuestion,
  HOSTED_TEST_ANSWER_TOKENS,
  HOSTED_TEST_MILLISECONDS,
  HOSTED_TEST_QUESTION,
  HOSTED_TEST_SYSTEM,
  type HostedTestResult,
} from './hosted-test.ts';
import type { HostedKeyState } from './hosted-key.ts';
import type { ModelFailure, ModelTurn, ModelTurnRequest } from './model-turn.ts';
import type { SourceOptions } from './source.ts';

const ATHLETE = 'athlete-a';
const HELD = {
  kind: 'held',
  athleteId: ATHLETE,
  url: 'https://models.example/v1',
  model: 'a-model',
  key: 'sk-0123456789',
} as HostedKeyState;

/** Sources that let `ATHLETE` through to a model answering `turn`. */
function sources(turn: ModelTurn, reasoningTokens?: number) {
  const asked: ModelTurnRequest[] = [];
  const options: SourceOptions = {
    local: undefined,
    hostedKey: () => Promise.resolve(HELD),
    recordedConsent: () => Promise.resolve('https://models.example'),
    guard: () => Promise.resolve({ words: [], zones: [] }),
    behindMasking: () => ({
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
      turn: (request) => {
        asked.push(request);
        return Promise.resolve(turn);
      },
    }),
  };
  return { asked, options };
}

const ANSWER: ModelTurn = { ok: true, text: 'ready', calls: [], finish: 'stop', usage: {} };

/** The words the route says it can answer. */
function declared(): readonly string[] {
  const route = HOSTED_ROUTES.find((each) => each.path === '/v1/analysis/hosted/test');
  const response = route?.response;
  const schema = (response?.contentType === 'application/json' ? response.schema : undefined) as
    { properties?: { result?: { enum?: readonly string[] } } } | undefined;
  return schema?.properties?.result?.enum ?? [];
}

describe('the test question, one turn (#1251)', () => {
  it('asks the two constants, no tool, a small answer and thirty seconds', async () => {
    const { asked, options } = sources(ANSWER);
    expect(await askHostedTestQuestion(ATHLETE, options)).toEqual({
      result: 'answered',
      reasoned: false,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      system: HOSTED_TEST_SYSTEM,
      messages: [{ role: 'user', text: HOSTED_TEST_QUESTION }],
      tools: [],
      maxOutputTokens: HOSTED_TEST_ANSWER_TOKENS,
      timeoutMilliseconds: HOSTED_TEST_MILLISECONDS,
    });
    expect(asked[0]?.signal.aborted).toBe(false);
    // Nothing of a rider's can be in a constant: no ride, no name, no place.
    expect(`${HOSTED_TEST_SYSTEM} ${HOSTED_TEST_QUESTION}`).toBe(
      'This is a connection test from a cycling app. No ride and no personal data is included. Reply with the one word: ready',
    );
    expect(HOSTED_TEST_MILLISECONDS).toBe(30_000);
  });

  it('adds the rider’s allowance to the answer’s bound', async () => {
    const { asked, options } = sources(ANSWER, 4_096);
    await askHostedTestQuestion(ATHLETE, options);
    expect(asked[0]?.maxOutputTokens).toBe(HOSTED_TEST_ANSWER_TOKENS + 4_096);
  });

  it.each([
    ['unreachable', 'unreachable'],
    ['unresolved', 'unreachable'],
    ['timed-out', 'timed-out'],
    ['refused', 'refused'],
    ['model-without-tools', 'refused'],
    ['server-error', 'failed'],
    ['malformed', 'failed'],
    ['aborted', 'failed'],
    ['not-local', 'failed'],
  ] as const)('says a %s turn is %s', async (failure: ModelFailure, result: HostedTestResult) => {
    const { options } = sources({ ok: false, failure });
    expect(await askHostedTestQuestion(ATHLETE, options)).toEqual({ result, reasoned: false });
    expect(declared()).toContain(result);
  });

  it('says only words the route declares, and the route declares no word it never says', async () => {
    const said = new Set<string>(['not-ready']);
    for (const turn of [
      ANSWER,
      { ...ANSWER, text: '  ' },
      { ok: false, failure: 'unreachable' },
      { ok: false, failure: 'timed-out' },
      { ok: false, failure: 'refused' },
      { ok: false, failure: 'server-error' },
    ] as ModelTurn[]) {
      said.add((await askHostedTestQuestion(ATHLETE, sources(turn).options)).result);
    }
    expect([...said].sort()).toEqual([...declared()].sort());
  });

  it('is not-ready, and asks no model, for an athlete the sources refuse', async () => {
    const { asked, options } = sources(ANSWER);
    expect(await askHostedTestQuestion('athlete-b', options)).toEqual({
      result: 'not-ready',
      reasoned: false,
    });
    expect(asked).toEqual([]);
  });
});
