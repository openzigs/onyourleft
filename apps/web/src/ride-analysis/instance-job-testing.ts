// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A scripted instance for a write-up job** (#1102) — test support, never
 * shipped. It answers the five job routes (#1095) the way
 * `apps/instance/src/analysis/routes.ts` does — a start's 202 and its job id,
 * a stream of events after `Last-Event-ID`, a cancel that ends the job
 * `cancelled`, an acknowledgement — over the {@link JobChannel} the
 * controller is handed, so a test drives the real controller and the real
 * page with no seal and no socket.
 *
 * A stream can be cut after any event ({@link ScriptedJobs.cutAfter}), or
 * held open after one until a test lets it go ({@link ScriptedJobs.holdAfter})
 * — which is how a test looks at the page mid-stream, drops the connection,
 * or remounts the page while the job carries on.
 */

import type { SealedStreamOptions, SealedStreamResult } from '../instance/instance-transport';

import type { AnalysisJobRequest, JobChannel, JobSession } from './instance-job';

/** One event as the instance stores it: its kind and its JSON. */
export interface ScriptedEvent {
  readonly kind: 'progress' | 'section' | 'withdrawn' | 'result';
  readonly data: Readonly<Record<string, unknown>>;
}

/** Progress at `step`. */
export const progress = (step: number): ScriptedEvent => ({ kind: 'progress', data: { step } });
/** A section the instance screened. */
export const section = (index: number, text: string): ScriptedEvent => ({
  kind: 'section',
  data: { index, text },
});
/** Every section so far retracted. */
export const withdrawn = (): ScriptedEvent => ({ kind: 'withdrawn', data: {} });
/** The job succeeded with `writeUp`. */
export const succeeded = (writeUp: string): ScriptedEvent => ({
  kind: 'result',
  data: { status: 'succeeded', writeUp },
});
/** The job failed with `failure`. */
export const failedWith = (failure: string): ScriptedEvent => ({
  kind: 'result',
  data: { status: 'failed', failure },
});

export interface ScriptedJobs {
  readonly session: Extract<JobSession, { kind: 'open' }>;
  /** Every request, in order: method, path, and the body a start carried. */
  readonly requests: { method: string; path: string; body?: unknown; lastEventId?: string }[];
  /** The job's events, ids 1… in order. A test may push more while a stream is held. */
  readonly events: ScriptedEvent[];
  /** The next stream ends `cut` after this event id (one-shot). */
  cutAfter: number | undefined;
  /** Streams wait after this event id until {@link release} or the reader lets go. */
  holdAfter: number | undefined;
  /** The start's answer; a 202 with `job-1` unless a test says otherwise. */
  startAnswer: { status: number; body: unknown } | undefined;
  /** The stream's refusal instead of events, when set. */
  streamRefusal: { status: number; body: unknown } | undefined;
  readonly acknowledged: string[];
  readonly cancelled: string[];
  /** Let a held stream go on. */
  release(): void;
  /** Add events to the job's run, and wake any stream waiting for them. */
  push(...events: ScriptedEvent[]): void;
  /** How many streams were opened. */
  streams(): number;
  /** How many streams are open now: a page that let go of a job holds none. */
  openStreams(): number;
}

export const SCRIPTED_JOB_ID = 'job-1';

/** A scripted instance; `events` is the job's whole run unless a test adds to it. */
export function scriptedJobs(events: readonly ScriptedEvent[] = []): ScriptedJobs {
  let waiting: (() => void)[] = [];
  let opened = 0;
  const wake = (): void => {
    const now = waiting;
    waiting = [];
    for (const resolve of now) resolve();
  };

  /** One stream, as `stream` below runs it. */
  const streamOnce = async (
    path: string,
    options: SealedStreamOptions,
  ): Promise<SealedStreamResult> => {
    opened += 1;
    scripted.requests.push({
      method: 'GET',
      path,
      ...(options.lastEventId === undefined ? {} : { lastEventId: options.lastEventId }),
    });
    if (scripted.streamRefusal !== undefined) {
      return { outcome: 'cut', refused: scripted.streamRefusal };
    }
    let next = options.lastEventId === undefined ? 1 : Number(options.lastEventId) + 1;
    let last = options.lastEventId;
    const cut = scripted.cutAfter;
    scripted.cutAfter = undefined;
    for (;;) {
      if (options.signal?.aborted === true) {
        return { outcome: 'cut', ...(last === undefined ? {} : { lastEventId: last }) };
      }
      const held = scripted.holdAfter !== undefined && next - 1 >= scripted.holdAfter;
      const event = held ? undefined : scripted.events[next - 1];
      if (event !== undefined) {
        const id = String(next);
        options.onEvent({ id, kind: event.kind, data: JSON.stringify(event.data) });
        last = id;
        if (event.kind === 'result') return { outcome: 'finished', lastEventId: id };
        if (cut !== undefined && next >= cut) return { outcome: 'cut', lastEventId: id };
        next += 1;
        continue;
      }
      if (cut !== undefined && next - 1 >= cut) {
        return { outcome: 'cut', ...(last === undefined ? {} : { lastEventId: last }) };
      }
      // Nothing more yet, or held: wait for a release, more events, or the reader to let go.
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        options.signal?.addEventListener('abort', () => {
          resolve();
        });
      });
    }
  };

  let open = 0;
  const stream = async (
    path: string,
    options: SealedStreamOptions,
  ): Promise<SealedStreamResult> => {
    open += 1;
    try {
      return await streamOnce(path, options);
    } finally {
      open -= 1;
    }
  };

  const channel: JobChannel = {
    call: async (method, path, options) => {
      scripted.requests.push({
        method,
        path,
        ...(options.body === undefined ? {} : { body: options.body }),
      });
      if (path === '/v1/analysis/jobs') {
        return Promise.resolve(
          scripted.startAnswer ?? { status: 202, body: { jobId: SCRIPTED_JOB_ID } },
        );
      }
      const cancel = /^\/v1\/analysis\/jobs\/([^/]+)\/cancel$/.exec(path);
      if (cancel !== null) {
        scripted.cancelled.push(cancel[1] ?? '');
        if (!scripted.events.some((event) => event.kind === 'result')) {
          scripted.events.push({ kind: 'result', data: { status: 'cancelled' } });
        }
        scripted.holdAfter = undefined;
        wake();
        return Promise.resolve({ status: 202, body: { status: 'cancelled' } });
      }
      const ack = /^\/v1\/analysis\/jobs\/([^/]+)\/ack$/.exec(path);
      if (ack !== null) {
        scripted.acknowledged.push(ack[1] ?? '');
        return Promise.resolve({ status: 204, body: null });
      }
      return Promise.resolve({ status: 404, body: { error: { code: 'not_found' } } });
    },
    stream,
  };

  const scripted: ScriptedJobs = {
    session: { kind: 'open', channel, token: 'session-token' },
    requests: [],
    events: [...events],
    cutAfter: undefined,
    holdAfter: undefined,
    startAnswer: undefined,
    streamRefusal: undefined,
    acknowledged: [],
    cancelled: [],
    release: () => {
      scripted.holdAfter = undefined;
      wake();
    },
    push: (...more) => {
      scripted.events.push(...more);
      wake();
    },
    streams: () => opened,
    openStreams: () => open,
  };
  return scripted;
}

/** The body the first start carried. */
export function startedWith(scripted: ScriptedJobs): AnalysisJobRequest | undefined {
  return scripted.requests.find((request) => request.path === '/v1/analysis/jobs')?.body as
    AnalysisJobRequest | undefined;
}
