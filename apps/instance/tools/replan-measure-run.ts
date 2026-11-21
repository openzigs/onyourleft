// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The re-plan measurement's runner (#2841) — `replan-measure.ts` is the
 * command. Apart from it so `replan-measure.test.ts` can run the same code
 * against a scripted server.
 *
 * It runs **the shipped re-plan agent** (`src/analysis/replan-agent.ts`)
 * through **the shipped connection** (`src/analysis/model.ts`
 * §`createLocalModel`) over the device's two golden requests
 * (`packages/domain/src/workout/fixtures/replan-request.json` and
 * `replan-request-long.json`), each as many times as it is asked, and counts
 * what came back: how many runs gave a valid answer (a proposal or a keep),
 * which moves, how long each took, and why the rest failed. Nothing it
 * writes holds the model's text: closed names and numbers only.
 *
 * The model is reached as `write-up-measure-run.ts` reaches it, on this
 * machine's loopback or over SSH. The time booked is the wall time HERE.
 */

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { encodeWorkoutFile, seconds, thresholdShare } from '@onyourleft/domain';

import { createLocalModel } from '../src/analysis/model.ts';
import type { ModelConnection } from '../src/analysis/model-turn.ts';
import { runReplanAgent } from '../src/analysis/replan-agent.ts';
import { readReplanInput, type ReplanInput } from '../src/analysis/replan-input.ts';
import type { AnalysisReads, ReadItem, ToolReadKind } from '../src/analysis/tools/reads.ts';

import { measuringFetch, OLLAMA_LOOPBACK, type Send } from './write-up-measure-run.ts';

/** The device's two golden requests, by the name a results file carries. */
export const REPLAN_FIXTURES = ['replan-request', 'replan-request-long'] as const;
export type ReplanFixture = (typeof REPLAN_FIXTURES)[number];

/** A golden request's input, read as the instance reads one off the wire. */
export function fixtureInput(name: ReplanFixture): ReplanInput {
  const body = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../packages/domain/src/workout/fixtures/${name}.json`, import.meta.url),
      ),
      'utf8',
    ),
  ) as { input: unknown };
  const read = readReplanInput(body.input);
  if (!read.ok) throw new Error(`${name} is not a re-plan request this instance reads`);
  return read.value;
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A saved workout as the device syncs one: steady blocks, shares of threshold. */
function workout(name: string, targets: readonly number[]): ReadItem {
  return {
    key: `workout-${name}`,
    body: encode(
      encodeWorkoutFile({
        name,
        blocks: targets.map((target) => ({
          kind: 'steady' as const,
          seconds: seconds(600),
          target: thresholdShare(target),
        })),
      }),
    ),
  };
}

/** What the re-plan tools read for the measurement's one rider: typed goals and three saved workouts. */
const ITEMS: Readonly<Record<ToolReadKind, readonly ReadItem[]>> = {
  'ride-summary': [],
  goal: [],
  'workout-goal': [
    {
      key: 'goal-0',
      body: encode(JSON.stringify({ text: 'Build endurance for a long sportive in June.' })),
    },
  ],
  workout: [
    workout('Steady endurance', [0.6, 0.65, 0.6]),
    workout('Easy spin', [0.5, 0.5]),
    workout('Tempo', [0.75, 0.8, 0.75]),
  ],
};

/** The tools' reads, whoever asks. */
export const REPLAN_READS: AnalysisReads = {
  listLiveSyncItems: (_athleteId, kind, limit) => Promise.resolve(ITEMS[kind].slice(0, limit)),
};

/** One run, as a results file keeps it: closed names and numbers. */
export interface ReplanRun {
  readonly fixture: ReplanFixture;
  /** `proposed`, `kept`, `cancelled`, or `failed:<why>`. */
  readonly outcome: string;
  /** The proposal's move kind, or `keep`, or `undefined` when the run gave no answer. */
  readonly move: string | undefined;
  /** The proposal's reason code, when it proposed. */
  readonly reason: string | undefined;
  readonly turns: number;
  readonly toolCalls: number;
  readonly promptTokensMost: number;
  readonly outputTokensTotal: number;
  readonly milliseconds: number;
}

/** The middle, the ninth decile and the most of some numbers, by the nearest-rank rule. */
export function spreadOf(values: readonly number[]): {
  readonly median: number;
  readonly p90: number;
  readonly most: number;
} {
  if (values.length === 0) return { median: 0, p90: 0, most: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (share: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))] ?? 0;
  return { median: rank(0.5), p90: rank(0.9), most: sorted.at(-1) ?? 0 };
}

/** What a fixture's runs came to. */
export interface FixtureSummary {
  readonly fixture: ReplanFixture;
  readonly runs: number;
  /** Runs that gave a proposal or a keep: the answers the device could use. */
  readonly valid: number;
  /** How many of each move came back, `keep` included. */
  readonly moves: Readonly<Record<string, number>>;
  /** How many runs failed for each reason. */
  readonly failures: Readonly<Record<string, number>>;
  readonly milliseconds: { readonly median: number; readonly p90: number; readonly most: number };
}

const counted = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

/** A fixture's runs, summed. */
export function summarise(fixture: ReplanFixture, runs: readonly ReplanRun[]): FixtureSummary {
  const own = runs.filter((run) => run.fixture === fixture);
  return {
    fixture,
    runs: own.length,
    valid: own.filter((run) => run.move !== undefined).length,
    moves: counted(own.flatMap((run) => (run.move === undefined ? [] : [run.move]))),
    failures: counted(
      own.flatMap((run) => (run.outcome.startsWith('failed:') ? [run.outcome.slice(7)] : [])),
    ),
    milliseconds: spreadOf(own.map((run) => run.milliseconds)),
  };
}

/** The three re-plan tools, in the order a forced run calls them. */
const LOOKS = ['ride_so_far', 'goals', 'saved_workouts'] as const;

/**
 * `model`, with its first `looks` turns answered here by a call of the next
 * re-plan tool, as a model calling each in turn would: so a run measures what
 * the conversation costs the model once the tools' results are in it, and
 * that the model server takes it, though the measured model calls none of
 * its own accord. The forced turns reach no server.
 */
export function forcedLooks(model: ModelConnection, looks: number): ModelConnection {
  let turns = 0;
  return {
    async turn(request) {
      const index = turns;
      turns += 1;
      const name = LOOKS[index];
      if (index >= looks || name === undefined) return model.turn(request);
      return Promise.resolve({
        ok: true,
        text: '',
        calls: [{ callId: `forced-${String(index)}`, toolName: name, input: {} }],
        finish: 'tool-calls',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    },
  };
}

/** One re-plan of `fixture`, through the shipped agent and connection. */
export async function oneReplan(
  send: Send,
  model: string,
  fixture: ReplanFixture,
  input: ReplanInput,
  looks = 0,
): Promise<ReplanRun> {
  const measuring = measuringFetch(send);
  let toolCalls = 0;
  const started = performance.now();
  const outcome = await runReplanAgent({
    job: { athleteId: 'measure-rider', input },
    model: forcedLooks(
      createLocalModel({
        settings: { baseUrl: new URL(`${OLLAMA_LOOPBACK}/v1`), model },
        resolve: () => Promise.resolve(['127.0.0.1']),
        fetch: measuring.fetch,
      }),
      looks,
    ),
    reads: REPLAN_READS,
    // Whole milliseconds, as the instance's own clock (`Date.now`) gives: a turn's
    // timeout is handed to `AbortSignal.timeout`, which refuses a fraction.
    clock: { now: () => Math.floor(performance.now()) },
    signal: new AbortController().signal,
    emit: (event) => {
      if (event.tool !== undefined) toolCalls += 1;
    },
  });
  const milliseconds = Math.round(performance.now() - started);
  const prompts = measuring.turns.map((turn) => turn.promptTokens ?? 0);
  return {
    fixture,
    outcome: outcome.kind === 'failed' ? `failed:${outcome.why}` : outcome.kind,
    move:
      outcome.kind === 'proposed'
        ? outcome.proposal.move.kind
        : outcome.kind === 'kept'
          ? 'keep'
          : undefined,
    reason: outcome.kind === 'proposed' ? outcome.proposal.reason : undefined,
    turns: measuring.turns.length,
    toolCalls,
    promptTokensMost: Math.max(0, ...prompts),
    outputTokensTotal: measuring.turns.reduce((sum, turn) => sum + (turn.outputTokens ?? 0), 0),
    milliseconds,
  };
}

/** Every fixture `times` times, one run at a time, in turn. */
export async function measureReplans(options: {
  readonly send: Send;
  readonly model: string;
  readonly times: number;
  readonly fixtures?: readonly ReplanFixture[];
  /** How many of the tools each run is made to call before the model answers. */
  readonly looks?: number;
  readonly log?: (line: string) => void;
}): Promise<{
  readonly runs: readonly ReplanRun[];
  readonly summaries: readonly FixtureSummary[];
}> {
  const fixtures = options.fixtures ?? REPLAN_FIXTURES;
  const inputs = new Map(fixtures.map((name) => [name, fixtureInput(name)] as const));
  const runs: ReplanRun[] = [];
  for (let round = 0; round < options.times; round += 1) {
    for (const fixture of fixtures) {
      const run = await oneReplan(
        options.send,
        options.model,
        fixture,
        inputs.get(fixture) as ReplanInput,
        options.looks ?? 0,
      );
      options.log?.(JSON.stringify(run));
      runs.push(run);
    }
  }
  return { runs, summaries: fixtures.map((fixture) => summarise(fixture, runs)) };
}
