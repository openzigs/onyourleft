// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for the analysis job engine (#1095): an engine a test drives
 * run by run, a clock of timers a test moves by hand, and the body a device
 * sends. Never shipped.
 */

import type { AgentEvent } from './agent.ts';
import { RIDE_INPUT } from './agent-testing.ts';
import type { AnalysisEngine, EngineEnding, EngineJob, JobTimers } from './jobs.ts';

/** One run the scripted engine was handed: the job, its signal, and what it may do. */
export interface ScriptedRun {
  readonly job: EngineJob;
  readonly signal: AbortSignal;
  emit(event: AgentEvent): void;
  /** End the run with `ending`. */
  finish(ending: EngineEnding): void;
}

export interface ScriptedEngine {
  readonly engine: AnalysisEngine;
  /** Every run so far, in the order the worker handed them over. */
  readonly runs: ScriptedRun[];
  /** The next run, once the worker hands it over. */
  next(): Promise<ScriptedRun>;
}

/** An engine that runs nothing by itself: each run waits for the test to `finish` it. */
export function scriptedEngine(): ScriptedEngine {
  const runs: ScriptedRun[] = [];
  const waiting: ((run: ScriptedRun) => void)[] = [];
  let handedOut = 0;
  return {
    runs,
    engine: {
      run: (job, signal, emit) =>
        new Promise<EngineEnding>((resolve) => {
          const run: ScriptedRun = { job, signal, emit, finish: resolve };
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

/** Timers on a clock that moves only when a test says, recording when each one fired. */
export interface FakeTimers {
  readonly timers: JobTimers;
  /** Fake milliseconds since the timers were made. */
  readonly now: () => number;
  /** When each timer fired, on the fake clock. */
  readonly fired: number[];
  /** Move the clock on, firing every timer that falls due, in order. */
  advance(milliseconds: number): void;
  /** How many timers are set and not yet fired. */
  pending(): number;
}

export function fakeTimers(): FakeTimers {
  let clock = 0;
  let nextId = 0;
  const set = new Map<number, { due: number; run: () => void }>();
  const fired: number[] = [];
  return {
    timers: {
      setTimeout: (run, delayMs) => {
        nextId += 1;
        set.set(nextId, { due: clock + delayMs, run });
        return nextId;
      },
      clearTimeout: (handle) => {
        set.delete(handle as number);
      },
    },
    now: () => clock,
    fired,
    advance(milliseconds) {
      const until = clock + milliseconds;
      for (;;) {
        const due = [...set.entries()]
          .filter(([, timer]) => timer.due <= until)
          .sort(([, left], [, right]) => left.due - right.due)[0];
        if (due === undefined) break;
        set.delete(due[0]);
        clock = due[1].due;
        fired.push(clock);
        due[1].run();
      }
      clock = until;
    },
    pending: () => set.size,
  };
}

/** The body a device sends to start a job, over `input`. */
export function jobBody(input: unknown = RIDE_INPUT): Record<string, unknown> {
  return { input, templateVersion: '1', source: 'instance-local' };
}

/** One parsed event of a job's plaintext stream. */
export interface StreamedEvent {
  readonly id: number;
  readonly kind: string;
  readonly data: Record<string, unknown>;
}

/** Every event in an SSE text, and how many heartbeat comments it held. */
export function parseStream(text: string): {
  events: StreamedEvent[];
  heartbeats: number;
} {
  const events: StreamedEvent[] = [];
  let heartbeats = 0;
  for (const block of text.split('\n\n')) {
    if (block === ': hb') {
      heartbeats += 1;
      continue;
    }
    const fields = Object.fromEntries(
      block
        .split('\n')
        .filter((line) => line.includes(': '))
        .map((line) => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2)]),
    );
    if (fields.id === undefined) continue;
    events.push({
      id: Number(fields.id),
      kind: String(fields.event),
      data: JSON.parse(String(fields.data)) as Record<string, unknown>,
    });
  }
  return { events, heartbeats };
}
