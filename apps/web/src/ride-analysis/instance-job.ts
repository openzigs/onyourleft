// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A write-up job on the rider's instance, as the wire carries it** —
 * [#1102](https://github.com/openzigs/onyourleft/issues/1102),
 * [ADR 0046](../../../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
 * D-6 and D-11, over #1095's routes.
 *
 * What a job request carries ({@link analysisJobRequest}), the four calls on a
 * job — start, follow its event stream, cancel, acknowledge — and the reading
 * of each event. Nothing here decides anything about a write-up: the
 * controller (`instance-analysis.ts`) screens and saves.
 *
 * ## No network primitive here
 *
 * Every call goes through a {@link JobChannel}, which production fills with
 * `instance/instance-transport.ts` §`sealedInstance` — the ONE module the
 * client reaches an instance through (#777, ADR 0036 D-3 (a)), and the one
 * `privacy/no-network.test.ts` admits. The event stream is read there, with
 * `fetch` and a `ReadableStream` body, never an `EventSource`; each event is
 * sealed to this device (ADR 0047). This module names neither.
 *
 * ## What leaves: the request, and nothing else
 *
 * {@link analysisJobRequest} is the ONE builder of a start's body: the ride's
 * input as `@onyourleft/analysis` §`rideAnalysisInput` built it (#809 — no
 * coordinate, no absolute altitude, no date, no name, no id), the template
 * version and the source, and no other key. It is a `departing` boundary
 * (`privacy/boundaries.test.ts`), and `camera/no-picture-reachable.test.ts`
 * walks this module and holds the body to carrying no picture.
 *
 * ## What arrives is untrusted
 *
 * A `section`'s text and a `result`'s write-up are a model's words that the
 * instance screened. This module reads them as plain strings and hands them
 * on unscreened — the device screens them again before a word renders or is
 * kept (ADR 0046 D-3, D-11).
 */

import type { RideAnalysisInput } from '@onyourleft/analysis';

import type { HeldSealedSession } from '../instance/instance-port';
import type {
  SealedCallOptions,
  SealedInstanceAnswer,
  SealedStreamOptions,
  SealedStreamResult,
} from '../instance/instance-transport';

/** Where the instance runs the job (#1095, ADR 0046 D-9). */
export type InstanceJobSource = 'instance-local' | 'instance-hosted';

/** A start's body: exactly these three keys (`apps/instance` §`job-input.ts`). */
export interface AnalysisJobRequest {
  readonly input: RideAnalysisInput;
  readonly templateVersion: string;
  readonly source: InstanceJobSource;
}

/**
 * The ONE builder of a job request — see the file comment. A new key is a
 * change here, and the instance refuses any key it does not name.
 */
export function analysisJobRequest(
  input: RideAnalysisInput,
  templateVersion: string,
  source: InstanceJobSource,
): AnalysisJobRequest {
  return { input, templateVersion, source };
}

/** What a job's calls go through: a sealed instance and its session, in production. */
export interface JobChannel {
  call(
    method: 'GET' | 'POST',
    path: string,
    options: SealedCallOptions,
  ): Promise<Pick<SealedInstanceAnswer, 'status' | 'body'>>;
  stream(path: string, options: SealedStreamOptions): Promise<SealedStreamResult>;
}

/** The session a job runs under, or why there is none now — with the sentence to show. */
export type JobSession =
  | { readonly kind: 'open'; readonly channel: JobChannel; readonly token: string }
  | { readonly kind: 'closed'; readonly text: string };

/**
 * The sealed session this device holds (`instance-port.ts` §`heldSealedSession`)
 * as a job runs under it: the sealed instance and its token, or the sentence
 * that says why there is none now — no sign-in, a copy of the app loaded from
 * a website (ADR 0047 D-11), keys that do not verify.
 */
export function jobSessionOf(held: HeldSealedSession): JobSession {
  return held.kind === 'open'
    ? { kind: 'open', channel: held.sealed, token: held.token }
    : { kind: 'closed', text: held.text };
}

/** One event of a job's stream, read. Text in it is the instance's and is not yet screened here. */
export type JobEvent =
  | { readonly kind: 'progress'; readonly step: number }
  | { readonly kind: 'section'; readonly index: number; readonly text: string }
  | { readonly kind: 'withdrawn' }
  | {
      readonly kind: 'result';
      readonly status: 'succeeded' | 'failed' | 'cancelled' | 'withheld';
      readonly failure?: string;
      readonly writeUp?: string;
    };

const RESULT_STATUSES = ['succeeded', 'failed', 'cancelled', 'withheld'] as const;

/** A job id the instance writes: a path segment and nothing else. */
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A failure code the instance names: a short identifier. Anything else is read as no code. */
const CODE = /^[a-z][a-z0-9_-]{0,63}$/;

function record(data: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed = JSON.parse(data) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A whole number from one upward, or `undefined`. */
function counted(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/**
 * One stream event, read; `undefined` for one this build does not know or
 * cannot read, which the caller skips. A tool's name, when progress carries
 * one, is dropped: the page says the step and nothing about it.
 */
export function readJobEvent(kind: string, data: string): JobEvent | undefined {
  const body = record(data);
  if (body === undefined) return undefined;
  switch (kind) {
    case 'progress': {
      const step = counted(body.step);
      return step === undefined ? undefined : { kind: 'progress', step };
    }
    case 'section': {
      const index = counted(body.index);
      return index === undefined || typeof body.text !== 'string'
        ? undefined
        : { kind: 'section', index, text: body.text };
    }
    case 'withdrawn':
      return { kind: 'withdrawn' };
    case 'result': {
      const status = RESULT_STATUSES.find((each) => each === body.status);
      if (status === undefined) return undefined;
      return {
        kind: 'result',
        status,
        ...(typeof body.failure === 'string' && CODE.test(body.failure)
          ? { failure: body.failure }
          : {}),
        ...(typeof body.writeUp === 'string' ? { writeUp: body.writeUp } : {}),
      };
    }
    default:
      return undefined;
  }
}

/** The error code of a refusal, when it names one this module can read. */
function codeOf(body: unknown): string | undefined {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' && CODE.test(code) ? code : undefined;
}

/** How a start went. */
export type StartedJob =
  | { readonly kind: 'started'; readonly jobId: string }
  /** The instance refused; `code` is its error code, when it named one. */
  | { readonly kind: 'refused'; readonly code?: string }
  /** No answer: nothing is known to have been queued. */
  | { readonly kind: 'unreachable' };

/** `POST /v1/analysis/jobs`. Settles; never rejects. */
export async function startJob(
  session: Extract<JobSession, { kind: 'open' }>,
  request: AnalysisJobRequest,
): Promise<StartedJob> {
  let answer: Pick<SealedInstanceAnswer, 'status' | 'body'>;
  try {
    answer = await session.channel.call('POST', '/v1/analysis/jobs', {
      token: session.token,
      body: { ...request },
    });
  } catch {
    return { kind: 'unreachable' };
  }
  const jobId = (answer.body as { jobId?: unknown } | null)?.jobId;
  if (answer.status === 202 && typeof jobId === 'string' && JOB_ID.test(jobId)) {
    return { kind: 'started', jobId };
  }
  const code = codeOf(answer.body);
  return code === undefined ? { kind: 'refused' } : { kind: 'refused', code };
}

/** How following a job's stream ended. */
export type Followed =
  /** The `result` event arrived, and was handed on. */
  | { readonly kind: 'ended' }
  /** The stream dropped before its result: resume after `lastEventId`. */
  | { readonly kind: 'cut'; readonly lastEventId?: string }
  /** The instance has no such job of this rider's (`not_found`): it expired or was never theirs. */
  | { readonly kind: 'gone' }
  /** The instance refused to stream it for another reason — a session it no longer accepts. */
  | { readonly kind: 'refused' };

/**
 * `GET /v1/analysis/jobs/{jobId}/events`, after `lastEventId` when there is
 * one (`Last-Event-ID`, inside the seal). Each event is read and handed to
 * `onEvent` in order; an event this build cannot read is skipped, its id
 * still counted, so a resume never asks for it again. Settles; never rejects.
 */
export async function followJob(
  session: Extract<JobSession, { kind: 'open' }>,
  jobId: string,
  lastEventId: string | undefined,
  onEvent: (id: string, event: JobEvent) => void,
  signal: AbortSignal,
): Promise<Followed> {
  if (!JOB_ID.test(jobId)) return { kind: 'gone' };
  let sawResult = false;
  let seen = lastEventId;
  let streamed: SealedStreamResult;
  try {
    streamed = await session.channel.stream(`/v1/analysis/jobs/${jobId}/events`, {
      token: session.token,
      signal,
      ...(lastEventId === undefined ? {} : { lastEventId }),
      onEvent: ({ id, kind, data }) => {
        if (sawResult) return;
        seen = id;
        const event = readJobEvent(kind, data);
        if (event === undefined) return;
        if (event.kind === 'result') sawResult = true;
        onEvent(id, event);
      },
    });
  } catch {
    if (sawResult) return { kind: 'ended' };
    return seen === undefined ? { kind: 'cut' } : { kind: 'cut', lastEventId: seen };
  }
  if (sawResult) return { kind: 'ended' };
  // A 5xx is the instance being unwell for now, and worth another try.
  if (streamed.refused !== undefined && streamed.refused.status < 500) {
    return streamed.refused.status === 404 ? { kind: 'gone' } : { kind: 'refused' };
  }
  return seen === undefined ? { kind: 'cut' } : { kind: 'cut', lastEventId: seen };
}

/** `POST /v1/analysis/jobs/{jobId}/cancel`. Whether the instance took it. Never rejects. */
export async function cancelJob(
  session: Extract<JobSession, { kind: 'open' }>,
  jobId: string,
): Promise<boolean> {
  if (!JOB_ID.test(jobId)) return false;
  try {
    const answer = await session.channel.call('POST', `/v1/analysis/jobs/${jobId}/cancel`, {
      token: session.token,
    });
    return answer.status === 202;
  } catch {
    return false;
  }
}

/**
 * `POST /v1/analysis/jobs/{jobId}/ack`: this device has saved the write-up,
 * so the instance may drop the job's events (ADR 0046 D-12). Whether it took
 * it; a failure costs nothing but the events' keep, which the instance's own
 * retention ends. Never rejects.
 */
export async function acknowledgeJob(
  session: Extract<JobSession, { kind: 'open' }>,
  jobId: string,
): Promise<boolean> {
  if (!JOB_ID.test(jobId)) return false;
  try {
    const answer = await session.channel.call('POST', `/v1/analysis/jobs/${jobId}/ack`, {
      token: session.token,
    });
    return answer.status === 204;
  } catch {
    return false;
  }
}
