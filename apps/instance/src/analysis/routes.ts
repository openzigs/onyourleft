// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The analysis job routes (#1095, ADR 0046 D-11): start a job, read it,
 * follow its event stream, cancel it, and acknowledge its write-up.
 *
 * Every one is `auth: 'session'` (the device-key session, #772) and
 * `reaches: 'own'`: the athlete is the session's, and no body or path names
 * one. Another athlete's job is `not_found`, the same answer as no job.
 *
 * ⚠️ **Every one is sealed-only** (ADR 0047 D-7, phase 1; #1192): job text is
 * among what never crosses Cloudflare's edge readable, so a plaintext request
 * is `sealed_required` before anything is read, on an instance that holds
 * keys. The stream is re-sealed event by event by `sealed/routes.ts`, and
 * its heartbeat comments go through as they are — they carry nothing.
 */

import { errorResponse } from '../errors.ts';
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import { DEFAULT_ANALYSIS_STARTS, DEFAULT_HEARTBEAT_MS, JOB_FAILURES } from './jobs.ts';

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'withheld'];
const status: Schema = { type: 'string', enum: STATUSES };

/** The handler answers `unavailable` and `unauthenticated` before such a route is called without either. */
function ready(context: RouteContext) {
  const { analysis, caller } = context;
  return analysis === undefined || caller === undefined ? undefined : { analysis, caller };
}

export const ANALYSIS_ROUTES: readonly Route[] = [
  {
    method: 'POST',
    path: '/v1/analysis/jobs',
    sealed: 'only',
    operationId: 'startAnalysisJob',
    reaches: 'own',
    summary: `Queue a write-up of one ride, on a model this instance reaches (\`source\`: \`instance-local\` or \`instance-hosted\`, ADR 0046 D-9). \`input\` is the ride as \`@onyourleft/analysis\` builds it (#809): its exact shape and nothing else, no picture, at most 4 KiB. \`templateVersion\` is the agent template's. \`rideId\`, optional, is the synced id of the ride being written up — one of YOUR live synced rides, else \`validation_failed\` — and lets the history tool say how long before it each earlier ride it finds was; without it the write-up names no ride's age. Answers 202 at once with the job's id; the work is not done in the request. \`job_running\` while you have a job queued or running, \`rate_limited\` past ${String(DEFAULT_ANALYSIS_STARTS.limit)} starts an hour on an instance with the default limits, and \`analysis_off\` when this instance has no model at all.`,
    identity: true,
    auth: 'session',
    analysis: true,
    accepted: true,
    request: {
      type: 'object',
      properties: {
        input: { type: 'object', description: 'A `RideAnalysisInput` (#809).' },
        templateVersion: { type: 'string' },
        source: { type: 'string', enum: ['instance-local', 'instance-hosted'] },
        rideId: { type: 'string' },
      },
      required: ['input', 'templateVersion', 'source'],
      additionalProperties: false,
    },
    errors: [
      'unauthenticated',
      'validation_failed',
      'job_running',
      'rate_limited',
      'analysis_off',
      'unavailable',
    ],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const outcome = await got.analysis.start(got.caller, context.json);
      if (outcome.ok) return json(outcome.value, 202);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
  {
    method: 'GET',
    path: '/v1/analysis/jobs/{jobId}',
    sealed: 'only',
    operationId: 'getAnalysisJob',
    reaches: 'own',
    summary: `Your job's status, when it was made and ended (Unix milliseconds), and — when it failed — why, one of ${JOB_FAILURES.map((each) => `\`${each}\``).join(', ')}.`,
    identity: true,
    auth: 'session',
    analysis: true,
    errors: ['unauthenticated', 'not_found', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: {
          status,
          createdAt: { type: 'integer' },
          endedAt: { type: ['integer', 'null'] },
          failure: { type: ['string', 'null'] },
        },
        required: ['status', 'createdAt', 'endedAt', 'failure'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const view = await got.analysis.read(got.caller, context.params.jobId ?? '');
      return view === undefined ? errorResponse('not_found') : json(view);
    },
  },
  {
    method: 'GET',
    path: '/v1/analysis/jobs/{jobId}/events',
    sealed: 'only',
    operationId: 'streamAnalysisJob',
    reaches: 'own',
    summary: `Your job's events as Server-Sent Events, every one after \`Last-Event-ID\` and then live, ending after \`result\`. A heartbeat comment at most every ${String(DEFAULT_HEARTBEAT_MS / 1000)} s on an instance with the default setting.`,
    identity: true,
    auth: 'session',
    analysis: true,
    errors: ['unauthenticated', 'not_found', 'unavailable'],
    response: {
      contentType: 'text/event-stream',
      description:
        'Each event: `id:` (1, 2, … per job), `event:` (`progress` `{ step, tool? }` — a tool by name only; `section` `{ index, text }` — screened text; `withdrawn` `{}` — every section so far is retracted; `result` `{ status, failure?, writeUp?, reasons? }`) and one `data:` line of JSON. No event carries a tool’s arguments or results.',
    },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const stream = await got.analysis.events(
        got.caller,
        context.params.jobId ?? '',
        context.request.headers.get('last-event-id'),
      );
      return stream ?? errorResponse('not_found');
    },
  },
  {
    method: 'POST',
    path: '/v1/analysis/jobs/{jobId}/cancel',
    sealed: 'only',
    operationId: 'cancelAnalysisJob',
    reaches: 'own',
    summary:
      'Cancel your job: it ends `cancelled` at once and its engine is stopped at its next step; nothing it says afterwards is kept. 202 with the status afterwards — a job that had already ended keeps its own.',
    identity: true,
    auth: 'session',
    analysis: true,
    accepted: true,
    errors: ['unauthenticated', 'not_found', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { status },
        required: ['status'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const after = await got.analysis.cancel(got.caller, context.params.jobId ?? '');
      return after === undefined ? errorResponse('not_found') : json({ status: after }, 202);
    },
  },
  {
    method: 'POST',
    path: '/v1/analysis/jobs/{jobId}/ack',
    sealed: 'only',
    operationId: 'acknowledgeAnalysisJob',
    reaches: 'own',
    summary:
      'Your device has saved the write-up: the instance deletes the job’s events and keeps the write-up (ADR 0046 D-12), beside the job row. `job_running` for a job that has not ended.',
    identity: true,
    auth: 'session',
    analysis: true,
    errors: ['unauthenticated', 'not_found', 'job_running', 'unavailable'],
    response: { contentType: 'none' },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const answer = await got.analysis.acknowledge(got.caller, context.params.jobId ?? '');
      return answer === 'acknowledged' ? noContent() : errorResponse(answer);
    },
  },
];
