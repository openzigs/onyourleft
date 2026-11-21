// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The re-plan measurement's runner (#2841), against the fake model server and
 * on recorded runs: the device's golden requests read, a run booked as the
 * shipped agent ended it, the forced tool calls, and the summary's arithmetic.
 */

import { describe, expect, it } from 'vitest';

import { startFakeModelServer } from '../src/analysis/fake-model-server-testing.ts';
import type { ModelConnection, ModelTurnRequest } from '../src/analysis/model-turn.ts';
import {
  fixtureInput,
  forcedLooks,
  measureReplans,
  REPLAN_FIXTURES,
  spreadOf,
  summarise,
  type ReplanRun,
} from './replan-measure-run.ts';
import { sendTo } from './write-up-measure-run.ts';

describe('the golden requests', () => {
  it('read as the instance reads a device’s request, both of them', () => {
    for (const name of REPLAN_FIXTURES) {
      expect(fixtureInput(name).blocks.length, name).toBeGreaterThan(0);
    }
  });
});

describe('a measured run, against a scripted server', () => {
  it('books each run as the shipped agent ended it, with its move and no text', async () => {
    const server = await startFakeModelServer([
      { kind: 'text', text: '{"move":{"kind":"end-main-set"},"reason":"heart-rate-high"}' },
      { kind: 'text', text: '{"keep":true}' },
      { kind: 'text', text: 'Set the trainer to 500 W.' },
      { kind: 'text', text: '{"look":"goals"}' },
      { kind: 'text', text: '{"keep":true}' },
    ]);
    try {
      const { runs, summaries } = await measureReplans({
        send: sendTo({ kind: 'loopback', origin: server.baseUrl.origin }),
        model: 'scripted',
        times: 2,
      });
      expect(runs.map((run) => [run.fixture, run.outcome, run.move, run.reason])).toStrictEqual([
        ['replan-request', 'proposed', 'end-main-set', 'heart-rate-high'],
        ['replan-request-long', 'kept', 'keep', undefined],
        ['replan-request', 'failed:not-a-proposal', undefined, undefined],
        // A look is a tool call: the model read its goals, then kept the plan.
        ['replan-request-long', 'kept', 'keep', undefined],
      ]);
      expect(runs[3]).toMatchObject({ turns: 2, toolCalls: 1 });
      expect(summaries[0]).toMatchObject({
        fixture: 'replan-request',
        runs: 2,
        valid: 1,
        moves: { 'end-main-set': 1 },
        failures: { 'not-a-proposal': 1 },
      });
      // Every request was held to the answer's schema, as the shipped connection sends it.
      expect(server.requests.every((body) => body.response_format !== undefined)).toBe(true);
      expect(JSON.stringify(runs)).not.toContain('500 W');
    } finally {
      await server.close();
    }
  });
});

describe('forced tool calls', () => {
  it('answers the first turns with a call of each tool in turn, then asks the model', async () => {
    const asked: ModelTurnRequest[] = [];
    const model: ModelConnection = {
      turn: (request) => {
        asked.push(request);
        return Promise.resolve({
          ok: true,
          text: '{"keep":true}',
          calls: [],
          finish: 'stop',
          usage: {},
        });
      },
    };
    const forced = forcedLooks(model, 2);
    const request = {} as ModelTurnRequest;
    const turns = [
      await forced.turn(request),
      await forced.turn(request),
      await forced.turn(request),
    ];
    expect(
      turns.map((turn) => (turn.ok ? turn.calls.map((call) => call.toolName) : turn.failure)),
    ).toStrictEqual([['ride_so_far'], ['goals'], []]);
    expect(asked).toHaveLength(1);
  });
});

describe('the summary', () => {
  const run = (overrides: Partial<ReplanRun>): ReplanRun => ({
    fixture: 'replan-request',
    outcome: 'proposed',
    move: 'end-main-set',
    reason: 'heart-rate-high',
    turns: 1,
    toolCalls: 0,
    promptTokensMost: 1,
    outputTokensTotal: 1,
    milliseconds: 1,
    ...overrides,
  });

  it('counts a valid answer, each move and each failure, for its own fixture only', () => {
    const runs = [
      run({ milliseconds: 3_000 }),
      run({ move: 'keep', outcome: 'kept', milliseconds: 2_000 }),
      run({ move: undefined, outcome: 'failed:model-cut-off', milliseconds: 9_000 }),
      run({ fixture: 'replan-request-long', milliseconds: 1 }),
    ];
    expect(summarise('replan-request', runs)).toStrictEqual({
      fixture: 'replan-request',
      runs: 3,
      valid: 2,
      moves: { 'end-main-set': 1, keep: 1 },
      failures: { 'model-cut-off': 1 },
      milliseconds: { median: 3_000, p90: 9_000, most: 9_000 },
    });
  });

  it('takes each spread at a value that was measured, and nought with none', () => {
    expect(spreadOf([5, 1, 3, 2, 4])).toStrictEqual({ median: 3, p90: 5, most: 5 });
    expect(spreadOf([])).toStrictEqual({ median: 0, p90: 0, most: 0 });
  });
});
