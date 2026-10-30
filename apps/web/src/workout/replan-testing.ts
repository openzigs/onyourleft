// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A scripted instance for re-plan jobs** (#1244) — test support, never
 * shipped. It answers the three routes a re-plan uses the way
 * `apps/instance/src/analysis/routes.ts` does — a start's 202 and a job id,
 * the job's stream down to its one `result`, and a cancel — over the
 * `JobChannel` the device is handed, so a test drives the real session, the
 * real validator and the real controller with no seal and no socket.
 *
 * A job's result is whatever the test gives it, when the test gives it
 * ({@link ScriptedReplans.answer}), which is how a test makes an answer
 * arrive late. Each of the three steps can be made to fail on its own
 * ({@link ScriptedReplans.fail}): the send, the wait, and the reading of what
 * arrived.
 */

import type { ReplanPort } from './replan-port';
import type { JobChannel, JobSession } from '../ride-analysis/instance-job';

/** Which step of a job fails: the start's call, the stream, or the result's own JSON. */
export type ReplanFailure = 'send' | 'wait' | 'receive';

export interface ScriptedReplans {
  readonly session: Extract<JobSession, { kind: 'open' }>;
  /** Every call made on the channel, in order: a start's body is kept. */
  readonly requests: { readonly method: string; readonly path: string; readonly body?: unknown }[];
  /** The bodies of the starts, in order. */
  starts(): readonly Readonly<Record<string, unknown>>[];
  /** The job ids cancelled, in order. */
  readonly cancelled: string[];
  /** How many streams are open now. */
  openStreams(): number;
  /** The step that fails from now on, or `undefined` for none. */
  fail: ReplanFailure | undefined;
  /** The start's answer, in place of a 202 with a new job id. */
  startAnswer: { readonly status: number; readonly body: unknown } | undefined;
  /** Hold every start's 202 back until {@link releaseStarts}: a start still on the wire. */
  holdStarts: boolean;
  /** Let the starts held by {@link holdStarts} answer. */
  releaseStarts(): void;
  /**
   * End the newest job `succeeded` with this as its `proposal`, exactly as
   * given: `null` is the model keeping the workout as it is.
   */
  answer(proposal: unknown): void;
  /** End the newest job `failed`. */
  failed(failure: string): void;
}

/** A scripted instance. Every started job waits for {@link ScriptedReplans.answer}. */
export function scriptedReplans(): ScriptedReplans {
  /** Each job's result event's data, once it has one. */
  const results = new Map<string, string>();
  let waiting: (() => void)[] = [];
  const heldStarts: (() => void)[] = [];
  let jobs = 0;
  let open = 0;

  const wake = (): void => {
    const woken = waiting;
    waiting = [];
    for (const resolve of woken) resolve();
  };

  const end = (data: Readonly<Record<string, unknown>>): void => {
    results.set(`job-${String(jobs)}`, JSON.stringify(data));
    wake();
  };

  const channel: JobChannel = {
    call: (method, path, options) => {
      scripted.requests.push({
        method,
        path,
        ...(options.body === undefined ? {} : { body: options.body }),
      });
      if (path === '/v1/analysis/replans') {
        if (scripted.fail === 'send') {
          return Promise.reject(new Error('the instance did not answer'));
        }
        if (scripted.startAnswer !== undefined) {
          return Promise.resolve(scripted.startAnswer);
        }
        jobs += 1;
        const started = { status: 202, body: { jobId: `job-${String(jobs)}` } };
        if (!scripted.holdStarts) {
          return Promise.resolve(started);
        }
        // The job is made; only the answer waits, as on a slow connection.
        return new Promise((resolve) => {
          heldStarts.push(() => {
            resolve(started);
          });
        });
      }
      const cancel = /^\/v1\/analysis\/jobs\/([^/]+)\/cancel$/.exec(path);
      if (cancel !== null) {
        scripted.cancelled.push(cancel[1] ?? '');
        return Promise.resolve({ status: 202, body: { status: 'cancelled' } });
      }
      return Promise.resolve({ status: 404, body: { error: { code: 'not_found' } } });
    },
    stream: async (path, options) => {
      scripted.requests.push({ method: 'GET', path });
      const jobId = /^\/v1\/analysis\/jobs\/([^/]+)\/events$/.exec(path)?.[1] ?? '';
      open += 1;
      try {
        if (scripted.fail === 'wait') {
          throw new Error('the stream broke');
        }
        for (;;) {
          if (options.signal?.aborted === true) {
            return { outcome: 'cut' };
          }
          const data = results.get(jobId);
          if (data !== undefined) {
            options.onEvent({
              id: '1',
              kind: 'result',
              data: scripted.fail === 'receive' ? '{"status":' : data,
            });
            return { outcome: 'finished', lastEventId: '1' };
          }
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
            options.signal?.addEventListener('abort', () => {
              resolve();
            });
          });
        }
      } finally {
        open -= 1;
      }
    },
  };

  const scripted: ScriptedReplans = {
    session: { kind: 'open', channel, token: 'session-token' },
    requests: [],
    starts: () =>
      scripted.requests
        .filter((each) => each.path === '/v1/analysis/replans')
        .map((each) => each.body as Readonly<Record<string, unknown>>),
    cancelled: [],
    openStreams: () => open,
    fail: undefined,
    startAnswer: undefined,
    holdStarts: false,
    releaseStarts: () => {
      for (const release of heldStarts.splice(0)) release();
    },
    answer: (proposal) => {
      end({ status: 'succeeded', proposal });
    },
    failed: (failure) => {
      end({ status: 'failed', failure });
    },
  };
  return scripted;
}

/**
 * A {@link ReplanPort} over a scripted instance: signed in, with no goals
 * and an empty library unless a test says otherwise. `calls` counts every
 * method, so a test can hold the port to never having been asked.
 */
export function scriptedReplanPort(
  scripted: ScriptedReplans,
  overrides: Partial<ReplanPort> = {},
): { readonly port: ReplanPort; readonly calls: Record<keyof ReplanPort, number> } {
  const calls: Record<keyof ReplanPort, number> = {
    replanConnected: 0,
    replanSession: 0,
    replanGoals: 0,
    replanLibrary: 0,
  };
  const base: ReplanPort = {
    replanConnected: () => true,
    replanSession: () => Promise.resolve(scripted.session),
    replanGoals: () => Promise.resolve({}),
    replanLibrary: () => Promise.resolve([]),
    ...overrides,
  };
  return {
    port: {
      replanConnected: () => {
        calls.replanConnected += 1;
        return base.replanConnected();
      },
      replanSession: () => {
        calls.replanSession += 1;
        return base.replanSession();
      },
      replanGoals: () => {
        calls.replanGoals += 1;
        return base.replanGoals();
      },
      replanLibrary: () => {
        calls.replanLibrary += 1;
        return base.replanLibrary();
      },
    },
    calls,
  };
}
