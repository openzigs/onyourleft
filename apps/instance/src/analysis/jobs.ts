// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The analysis job engine** — #1095, ADR 0046 D-11.
 *
 * A device asks its instance to write a ride up; the work is a ROW, not a
 * request (D-11: *"Creating one answers at once, well inside Cloudflare's
 * 125 s timeout"*):
 *
 * 1. `start` checks the body (`job-input.ts`: no picture, the input's exact
 *    shape), counts the request against the athlete's start limit, and queues
 *    the job — refused `job_running` while the athlete has one queued or
 *    running, in the same transaction as the insert.
 * 2. **One worker** claims the oldest queued job of any athlete and hands it to
 *    the {@link AnalysisEngine} — a port: in production the agent
 *    (`engine.ts`, #1098), in tests a scripted engine. Every event the engine
 *    emits is appended to the job's stream, in order, while the job is
 *    RUNNING; then the job ends with one `result` event.
 * 3. **The stream** (`events`) replays every event after `Last-Event-ID`,
 *    then follows the job live, and ends after the `result` — so a device that
 *    lost its connection reconnects and gets the rest, with no duplicate and
 *    no gap. A comment (`: hb`) goes out at most every
 *    {@link DEFAULT_HEARTBEAT_MS} so the tunnel never sees an idle stream
 *    (Cloudflare's proxy read timeout is 125 s).
 * 4. **Cancel** aborts the engine's signal AND ends the job `cancelled` at
 *    once, so nothing the engine says after the cancel is kept: the store
 *    appends only to a running job.
 * 5. **Ack**: the device saved the write-up; the candidate and the events
 *    that carried it go. An ended job and its events are deleted
 *    {@link DEFAULT_RETENTION_MS} after it ended (the owner's Q5 ruling, 7 days)
 *    by {@link AnalysisJobs.sweep}.
 * 6. **Restart**: a job a stopped instance left `queued` or `running` ends
 *    `failed`, `interrupted`, at the next start ({@link AnalysisJobs.recover}),
 *    and is never run again: a write-up the rider is no longer waiting for is
 *    not one to spend a model on, and a half-run agent cannot be resumed.
 *
 * ## What is never in it
 *
 * - **No event carries a tool's arguments or its results**: progress names a
 *   tool by name alone, and only a name of the tool-name shape
 *   ({@link TOOL_NAME}). A section is screened text, and nothing else is text.
 * - **Nothing about a job is logged but its status and failure code**: every
 *   line goes through `log.ts` §`redacted`, and a job's input, id, write-up
 *   and tool names are never handed to it (`jobs.test.ts` plants markers).
 * - **The athlete is always the session's** (ADR 0040 D-3): every store call
 *   names the caller's athlete, so another athlete's job is `not_found`.
 */

import {
  ANALYSIS_AGENT_TEMPLATE_V1,
  type RideAnalysisInput,
  type ScreenedWriteUp,
  type ScreenReason,
} from '@onyourleft/analysis';

import type { Caller, Outcome } from '../auth/identity.ts';
import { createRateLimiter, type RateLimit } from '../auth/rate-limit.ts';
import type { FieldProblem } from '../errors.ts';
import { logEvent, type LogSink } from '../log.ts';
import type {
  AnalysisEvent,
  AnalysisJob,
  AnalysisJobEnding,
  AnalysisJobStatus,
  SqlStore,
} from '../store/sql-store.ts';
import type { AgentEvent, AgentFailure } from './agent.ts';
import { pictureFaults, readRideInput } from './job-input.ts';
import type { AnalysisSource, SourceFailure } from './source.ts';

/** How often a quiet stream writes a heartbeat: the room socket's 25 s ping (ADR 0046 D-11). */
export const DEFAULT_HEARTBEAT_MS = 25_000;

/** The slowest heartbeat `OYL_INSTANCE_ANALYSIS_HEARTBEAT_MS` may set: well under the tunnel's 100–125 s. */
export const MAXIMUM_HEARTBEAT_MS = 60_000;

/** How long an ended job and its events are kept: 7 days, the owner's Q5 ruling (ADR 0046 D-12). */
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many jobs one athlete may START an hour: twelve. A write-up takes a
 * model minutes, so a rider who asks again after a failure, a cancel or a
 * second ride is well inside it; a client in a loop is stopped after twelve.
 * Every request counts, a refused one included, before its body is read.
 */
export const DEFAULT_ANALYSIS_STARTS: RateLimit = { limit: 12, windowMs: 60 * 60 * 1000 };

/**
 * How often the instance runs {@link AnalysisJobs.sweep}: every hour, on the
 * hour — the start limit's window, so each window's athlete ids are forgotten
 * when it ends; and a job is then deleted within an hour of its seven days.
 */
export const ANALYSIS_SWEEP_PERIOD_MS = DEFAULT_ANALYSIS_STARTS.windowMs;

/** How many events a stream reads from the store at once. */
const EVENT_PAGE = 100;

/** A tool's name as progress may carry it: the shape of the agent's own names. */
export const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Why a job failed. Closed: the sentences live with the client (#1102). */
export type JobFailure = AgentFailure | SourceFailure | 'interrupted' | 'engine-error';

/** Every {@link JobFailure}, for the specification and the client. */
export const JOB_FAILURES: readonly JobFailure[] = [
  'out-of-steps',
  'out-of-tool-calls',
  'out-of-time',
  'out-of-tokens',
  'model-without-tools',
  'model-not-local',
  'model-unreachable',
  'model-refused',
  'model-error',
  'model-cut-off',
  'model-malformed',
  'local_unavailable',
  'hosted_unavailable',
  'interrupted',
  'engine-error',
];

/** The job, as an engine runs it: the session's athlete and the checked input. */
export interface EngineJob {
  readonly athleteId: string;
  readonly input: RideAnalysisInput;
  readonly source: AnalysisSource;
}

/** How an engine's run ended. `AgentOutcome` (`agent.ts`) is one. */
export type EngineEnding =
  | { readonly kind: 'written'; readonly writeUp: ScreenedWriteUp }
  | { readonly kind: 'withheld'; readonly reasons: readonly ScreenReason[] }
  | { readonly kind: 'failed'; readonly why: JobFailure }
  | { readonly kind: 'cancelled' };

/** What runs a job: the agent in production (`engine.ts`), a script in a test. */
export interface AnalysisEngine {
  run(
    job: EngineJob,
    signal: AbortSignal,
    emit: (event: AgentEvent) => void,
  ): Promise<EngineEnding>;
}

/** Timers the heartbeat runs on: the platform's unless a test's fake clock. */
export interface JobTimers {
  setTimeout(run: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const PLATFORM_TIMERS: JobTimers = {
  setTimeout: (run, delayMs) => {
    const handle = setTimeout(run, delayMs) as unknown as { unref?: () => void };
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
  },
};

/** The store, as far as jobs are concerned. */
export type JobStore = Pick<
  SqlStore,
  | 'createAnalysisJob'
  | 'getAnalysisJob'
  | 'listAnalysisEvents'
  | 'claimAnalysisJob'
  | 'appendAnalysisEvent'
  | 'endAnalysisJob'
  | 'acknowledgeAnalysisJob'
  | 'interruptAnalysisJobs'
  | 'pruneAnalysisJobs'
>;

export interface AnalysisJobsOptions {
  readonly store: JobStore;
  readonly engine: AnalysisEngine;
  /**
   * Whether this instance has a model source at all (#1096, #1097): `false`,
   * every start is `analysis_off` and nothing is queued.
   */
  readonly available: () => boolean | Promise<boolean>;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly log?: LogSink;
  /** {@link DEFAULT_HEARTBEAT_MS} unless the operator sets another; 0 sends none. */
  readonly heartbeatMs?: number;
  readonly timers?: JobTimers;
  readonly starts?: RateLimit;
  readonly retentionMs?: number;
}

/** What `GET /v1/analysis/jobs/{jobId}` answers. */
export interface JobView {
  readonly status: AnalysisJobStatus;
  readonly createdAt: number;
  readonly endedAt: number | null;
  readonly failure: string | null;
}

export interface AnalysisJobs {
  /** Queue a job for the caller; `{ jobId }`, or why not. */
  start(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<{ jobId: string }>>;
  /** The caller's job, or `undefined`. */
  read(caller: Caller, jobId: string): Promise<JobView | undefined>;
  /** The caller's job's stream after `lastEventId`, or `undefined` when it is not theirs. */
  events(caller: Caller, jobId: string, lastEventId: string | null): Promise<Response | undefined>;
  /** Cancel the caller's job: its status afterwards, or `undefined` when it is not theirs. */
  cancel(caller: Caller, jobId: string): Promise<AnalysisJobStatus | undefined>;
  /** The device saved the write-up. */
  acknowledge(caller: Caller, jobId: string): Promise<'acknowledged' | 'job_running' | 'not_found'>;
  /** At start: every job a stopped instance left unended is failed `interrupted`. */
  recover(): Promise<number>;
  /** Delete what has outlived its retention, and forget ended rate-limit windows. */
  sweep(): Promise<number>;
  /** Resolves once the worker has nothing left to run. */
  idle(): Promise<void>;
  /** Abort every running job, end every stream, and run nothing more. */
  stop(): Promise<void>;
}

const OPEN: ReadonlySet<AnalysisJobStatus> = new Set(['queued', 'running']);

/** A job id: 128 random bits, as hex — inside the router's path-parameter shape. */
function jobId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The SSE `Last-Event-ID` a device sends, as a sequence number: 0 for none or nonsense. */
export function resumeAfter(lastEventId: string | null): number {
  return lastEventId !== null && /^[0-9]{1,15}$/.test(lastEventId) ? Number(lastEventId) : 0;
}

/** An agent event, as the stream stores it. Never a raw token, never a tool's arguments. */
function recorded(event: AgentEvent): readonly ['progress' | 'section' | 'withdrawn', string] {
  switch (event.type) {
    case 'progress':
      return [
        'progress',
        JSON.stringify({
          step: event.step,
          ...(event.tool !== undefined && TOOL_NAME.test(event.tool) ? { tool: event.tool } : {}),
        }),
      ];
    case 'section':
      return ['section', JSON.stringify({ index: event.index, text: event.text })];
    case 'withdrawn':
      return ['withdrawn', '{}'];
  }
}

/** How a run's ending is stored: the job's status, and its `result` event. */
function ending(outcome: EngineEnding, at: number): AnalysisJobEnding {
  switch (outcome.kind) {
    case 'written':
      return {
        status: 'succeeded',
        failure: null,
        candidate: outcome.writeUp,
        data: JSON.stringify({ status: 'succeeded', writeUp: outcome.writeUp }),
        at,
      };
    case 'withheld':
      return {
        status: 'withheld',
        failure: null,
        candidate: null,
        data: JSON.stringify({ status: 'withheld', reasons: [...outcome.reasons] }),
        at,
      };
    case 'failed':
      return {
        status: 'failed',
        failure: outcome.why,
        candidate: null,
        data: JSON.stringify({ status: 'failed', failure: outcome.why }),
        at,
      };
    case 'cancelled':
      return {
        status: 'cancelled',
        failure: null,
        candidate: null,
        data: JSON.stringify({ status: 'cancelled' }),
        at,
      };
  }
}

const refused = (fields: readonly FieldProblem[]): Outcome<never> => ({
  ok: false,
  code: 'validation_failed',
  fields,
});

const BODY_KEYS = ['input', 'templateVersion', 'source'] as const;
const SOURCES: readonly AnalysisSource[] = ['instance-local', 'instance-hosted'];

export function createAnalysisJobs(options: AnalysisJobsOptions): AnalysisJobs {
  const { store, engine, now } = options;
  const log = options.log ?? (() => undefined);
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const timers = options.timers ?? PLATFORM_TIMERS;
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const starts = createRateLimiter(options.starts ?? DEFAULT_ANALYSIS_STARTS, now);

  /** Who is waiting on each job's stream. */
  const listeners = new Map<string, Set<() => void>>();
  /** The running jobs' abort controllers. */
  const running = new Map<string, AbortController>();
  /** Every open stream's way of ending itself, for `stop`. */
  const streams = new Set<() => void>();
  let working: Promise<void> | undefined;
  let wanted = false;
  /** `recover`'s pass: a job is queued only after it, so a new job is never taken for a stopped one. */
  let recovering: Promise<unknown> = Promise.resolve();
  let stopping = false;

  const notify = (id: string): void => {
    for (const listener of [...(listeners.get(id) ?? [])]) listener();
  };

  const logged = (status: AnalysisJobStatus, failure?: string | null): void => {
    logEvent(log, 'analysis-job', {
      state: status,
      ...(failure === null || failure === undefined ? {} : { code: failure }),
    });
  };

  async function runJob(job: AnalysisJob): Promise<void> {
    notify(job.id);
    logged('running');
    const controller = new AbortController();
    running.set(job.id, controller);
    let appended: Promise<void> = Promise.resolve();
    const emit = (event: AgentEvent): void => {
      const [kind, data] = recorded(event);
      appended = appended
        .then(async () => {
          const seq = await store.appendAnalysisEvent(job.athleteId, job.id, kind, data, now());
          if (seq !== undefined) notify(job.id);
        })
        .catch(() => undefined);
    };
    let outcome: EngineEnding;
    try {
      // Read again on the way out of the table: what is stored is what was checked.
      const input = readRideInput(JSON.parse(job.inputJson) as unknown);
      outcome = input.ok
        ? await engine.run(
            { athleteId: job.athleteId, input: input.value, source: job.source },
            controller.signal,
            emit,
          )
        : { kind: 'failed', why: 'engine-error' };
    } catch {
      outcome = { kind: 'failed', why: 'engine-error' };
    }
    await appended;
    running.delete(job.id);
    // Stopped by the instance, not by the rider: left `running`, for the next
    // start to end `interrupted` (`recover`), never ended `cancelled` here.
    if (stopping) return;
    const ended = ending(controller.signal.aborted ? { kind: 'cancelled' } : outcome, now());
    if ((await store.endAnalysisJob(job.athleteId, job.id, ended)) !== undefined) {
      logged(ended.status, ended.failure);
    }
    notify(job.id);
  }

  async function work(): Promise<void> {
    for (;;) {
      if (stopping) return;
      const job = await store.claimAnalysisJob();
      if (job === undefined) return;
      await runJob(job).catch(() => undefined);
    }
  }

  function schedule(): void {
    if (stopping) return;
    if (working !== undefined) {
      wanted = true;
      return;
    }
    working = work()
      .catch(() => undefined)
      .finally(() => {
        working = undefined;
        if (wanted) {
          wanted = false;
          schedule();
        }
      });
  }

  function stream(job: AnalysisJob, after: number): Response {
    const encoder = new TextEncoder();
    let cursor = after;
    let closed = false;
    let timer: unknown;
    let wake: (() => void) | undefined;
    const listener = (): void => {
      const woken = wake;
      wake = undefined;
      woken?.();
    };
    let finish = (): void => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const set = listeners.get(job.id) ?? new Set();
        set.add(listener);
        listeners.set(job.id, set);
        const cleanUp = (): void => {
          closed = true;
          if (timer !== undefined) timers.clearTimeout(timer);
          timer = undefined;
          set.delete(listener);
          if (set.size === 0) listeners.delete(job.id);
          streams.delete(finish);
          listener();
        };
        finish = () => {
          if (closed) return;
          cleanUp();
          try {
            controller.close();
          } catch {
            // Already cancelled by the reader.
          }
        };
        streams.add(finish);
        const write = (text: string): void => {
          if (!closed) controller.enqueue(encoder.encode(text));
        };
        const beat = (): void => {
          timer = undefined;
          if (closed) return;
          write(': hb\n\n');
          timer = timers.setTimeout(beat, heartbeatMs);
        };
        if (heartbeatMs > 0) timer = timers.setTimeout(beat, heartbeatMs);
        void (async () => {
          for (;;) {
            if (closed) return;
            // Armed BEFORE the read, so an event appended during it still wakes the loop.
            const woken = new Promise<void>((resolve) => {
              wake = resolve;
            });
            const events: readonly AnalysisEvent[] = await store.listAnalysisEvents(
              job.athleteId,
              job.id,
              cursor,
              EVENT_PAGE,
            );
            for (const event of events) {
              write(`id: ${String(event.seq)}\nevent: ${event.kind}\ndata: ${event.data}\n\n`);
              cursor = event.seq;
              if (event.kind === 'result') {
                finish();
                return;
              }
            }
            if (events.length === EVENT_PAGE) continue;
            if (events.length === 0) {
              const current = await store.getAnalysisJob(job.athleteId, job.id);
              // Ended with nothing left to send (acknowledged, or resumed past
              // its result), or gone (erased, or past its retention).
              if (current === undefined || !OPEN.has(current.status)) {
                finish();
                return;
              }
            }
            await woken;
          }
        })().catch(() => {
          finish();
        });
      },
      cancel() {
        // The reader went away: stop the heartbeat and the loop, and close nothing more.
        if (closed) return;
        closed = true;
        if (timer !== undefined) timers.clearTimeout(timer);
        timer = undefined;
        listeners.get(job.id)?.delete(listener);
        if (listeners.get(job.id)?.size === 0) listeners.delete(job.id);
        streams.delete(finish);
        listener();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
    });
  }

  return {
    async start(caller, body) {
      if (!(await options.available())) return { ok: false, code: 'analysis_off' };
      if (!starts.allow(caller.athleteId)) return { ok: false, code: 'rate_limited' };
      // #799, on the server path: a picture is refused for being one, before its shape is read.
      if (pictureFaults(body).length > 0) {
        return refused([{ field: 'body', problem: 'must not carry a picture' }]);
      }
      for (const key of Object.keys(body)) {
        if (!(BODY_KEYS as readonly string[]).includes(key)) {
          return refused([{ field: key, problem: 'is not a field of a job' }]);
        }
      }
      if (body.templateVersion !== ANALYSIS_AGENT_TEMPLATE_V1.version) {
        return refused([
          { field: 'templateVersion', problem: 'must be a template version this instance runs' },
        ]);
      }
      if (
        typeof body.source !== 'string' ||
        !(SOURCES as readonly string[]).includes(body.source)
      ) {
        return refused([{ field: 'source', problem: 'must be instance-local or instance-hosted' }]);
      }
      const input = readRideInput(body.input);
      if (!input.ok) return refused(input.fields);
      await recovering.catch(() => undefined);
      const id = jobId();
      const created = await store.createAnalysisJob({
        id,
        athleteId: caller.athleteId,
        source: body.source as AnalysisSource,
        templateVersion: ANALYSIS_AGENT_TEMPLATE_V1.version,
        inputJson: JSON.stringify(input.value),
        createdAt: now(),
      });
      if (created === 'busy') return { ok: false, code: 'job_running' };
      logged('queued');
      schedule();
      return { ok: true, value: { jobId: id } };
    },

    async read(caller, id) {
      const job = await store.getAnalysisJob(caller.athleteId, id);
      return job === undefined
        ? undefined
        : {
            status: job.status,
            createdAt: job.createdAt,
            endedAt: job.endedAt,
            failure: job.failure,
          };
    },

    async events(caller, id, lastEventId) {
      const job = await store.getAnalysisJob(caller.athleteId, id);
      return job === undefined ? undefined : stream(job, resumeAfter(lastEventId));
    },

    async cancel(caller, id) {
      const job = await store.getAnalysisJob(caller.athleteId, id);
      if (job === undefined) return undefined;
      if (!OPEN.has(job.status)) return job.status;
      running.get(id)?.abort();
      const cancelled = ending({ kind: 'cancelled' }, now());
      if ((await store.endAnalysisJob(caller.athleteId, id, cancelled)) !== undefined) {
        logged('cancelled');
      }
      notify(id);
      return (await store.getAnalysisJob(caller.athleteId, id))?.status;
    },

    async acknowledge(caller, id) {
      const answer = await store.acknowledgeAnalysisJob(caller.athleteId, id);
      if (answer === 'acknowledged') notify(id);
      return answer;
    },

    async recover() {
      const interrupted = ending({ kind: 'failed', why: 'interrupted' }, now());
      const pass = store.interruptAnalysisJobs('interrupted', interrupted.data, interrupted.at);
      recovering = pass;
      const count = await pass;
      if (count > 0) logged('failed', 'interrupted');
      return count;
    },

    async sweep() {
      starts.sweep();
      return store.pruneAnalysisJobs(now() - retentionMs);
    },

    async idle() {
      while (working !== undefined) await working;
    },

    async stop() {
      stopping = true;
      for (const controller of running.values()) controller.abort();
      for (const finish of [...streams]) finish();
      while (working !== undefined) await working;
    },
  };
}
