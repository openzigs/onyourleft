// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for the re-plan job (#1243): the input a device sends, the
 * body around it, and an engine a test drives run by run. Never shipped.
 */

import type { AgentEvent } from './agent.ts';
import type { ReplanEnding, ReplanEngine, ReplanEngineJob } from './jobs.ts';
import { readReplanInput, type ReplanInput } from './replan-input.ts';

/**
 * A re-plan input as it arrives: five blocks, the second being ridden, two
 * summaries. Plain JSON, as a device sends it.
 */
export const REPLAN_INPUT_JSON = {
  revision: 2,
  summarySeq: 7,
  currentBlock: 1,
  goals: {
    sessionType: 'endurance',
    durationMinutes: 60,
    holdRange: { low: 130, high: 142 },
    heartRateAbove: 150,
    powerCeiling: 0.8,
    timeInRangeMinutes: 30,
    effortCheckIns: true,
  },
  blocks: [
    { kind: 'ramp', seconds: 600, from: 0.4, to: 0.65 },
    {
      kind: 'heart-rate-hold',
      seconds: 1200,
      range: { low: 130, high: 142 },
      startShare: 0.6,
      ceilingShare: 0.8,
    },
    {
      kind: 'intervals',
      repeats: 3,
      hardSeconds: 180,
      hardTarget: 0.95,
      easySeconds: 180,
      easyTarget: 0.5,
    },
    { kind: 'steady', seconds: 600, target: 0.7 },
    { kind: 'free-ride', seconds: 300 },
  ],
  summaries: [
    {
      block: 0,
      seconds: 600,
      meanHeartRate: 118,
      highestHeartRate: 131,
      meanPowerShare: 0.52,
      meanCadence: 88,
      rescues: 0,
    },
    {
      block: 1,
      seconds: 900,
      meanHeartRate: 139,
      highestHeartRate: 147,
      secondsInRange: 610,
      meanPowerShare: 0.66,
      meanCadence: 84,
      rescues: 1,
      effort: 3,
    },
  ],
} as const;

/** {@link REPLAN_INPUT_JSON} with `overrides`, read as the instance reads it. */
export function replanInput(overrides: Readonly<Record<string, unknown>> = {}): ReplanInput {
  const read = readReplanInput({ ...REPLAN_INPUT_JSON, ...overrides });
  if (!read.ok) throw new Error(`not a re-plan input: ${JSON.stringify(read.fields)}`);
  return read.value;
}

/** The body a device sends to start a re-plan, over `input`. */
export function replanBody(input: unknown = REPLAN_INPUT_JSON): Record<string, unknown> {
  return { input, templateVersion: 're-plan-1', source: 'instance-local' };
}

/** One run the scripted re-plan engine was handed. */
export interface ScriptedReplanRun {
  readonly job: ReplanEngineJob;
  readonly signal: AbortSignal;
  emit(event: Extract<AgentEvent, { readonly type: 'progress' }>): void;
  finish(ending: ReplanEnding): void;
}

export interface ScriptedReplanEngine {
  readonly engine: ReplanEngine;
  readonly runs: ScriptedReplanRun[];
  /** The next run, once the worker hands it over. */
  next(): Promise<ScriptedReplanRun>;
}

/** A re-plan engine that runs nothing by itself: each run waits for the test to `finish` it. */
export function scriptedReplanEngine(): ScriptedReplanEngine {
  const runs: ScriptedReplanRun[] = [];
  const waiting: ((run: ScriptedReplanRun) => void)[] = [];
  let handedOut = 0;
  return {
    runs,
    engine: {
      run: (job, signal, emit) =>
        new Promise<ReplanEnding>((resolve) => {
          const run: ScriptedReplanRun = { job, signal, emit, finish: resolve };
          runs.push(run);
          waiting.shift()?.(run);
        }),
    },
    next() {
      const index = handedOut;
      handedOut += 1;
      const ready = runs[index];
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise((resolve) => {
        waiting.push(resolve);
      });
    },
  };
}
