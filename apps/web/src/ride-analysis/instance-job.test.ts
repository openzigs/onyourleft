// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A write-up job on the wire (#1102): the request a start carries, each event
 * read, and how a stream's ending is told apart.
 */

import { describe, expect, it } from 'vitest';

import type { RideAnalysisInput } from '@onyourleft/analysis';
import type { SealedStreamResult } from '../instance/instance-transport';

import {
  acknowledgeJob,
  analysisJobRequest,
  cancelJob,
  followJob,
  jobSessionOf,
  readJobEvent,
  startJob,
  type JobChannel,
  type JobEvent,
  type JobSession,
} from './instance-job';

const INPUT = { templateVersion: '1', sections: [] } as unknown as RideAnalysisInput;

function session(channel: Partial<JobChannel>): Extract<JobSession, { kind: 'open' }> {
  return {
    kind: 'open',
    token: 'token',
    channel: {
      call: async () => Promise.reject(new Error('not scripted')),
      stream: async () => Promise.reject(new Error('not scripted')),
      ...channel,
    },
  };
}

describe('the request', () => {
  it('is the input, the template version and the source, and no other key', () => {
    expect(analysisJobRequest(INPUT, '1', 'instance-local')).toStrictEqual({
      input: INPUT,
      templateVersion: '1',
      source: 'instance-local',
    });
  });

  it('carries the ride’s id only when it is handed a synced one (#1229)', () => {
    expect(analysisJobRequest(INPUT, '1', 'instance-local', 'ride-7')).toStrictEqual({
      input: INPUT,
      templateVersion: '1',
      source: 'instance-local',
      rideId: 'ride-7',
    });
    expect(analysisJobRequest(INPUT, '1', 'instance-local', undefined)).not.toHaveProperty(
      'rideId',
    );
  });

  it('says when a refusal names the ride id, and only then (#1229)', async () => {
    const answered = (body: unknown) =>
      startJob(
        session({ call: async () => Promise.resolve({ status: 400, body }) }),
        analysisJobRequest(INPUT, '1', 'instance-local', 'ride-7'),
      );
    expect(
      await answered({
        error: { code: 'validation_failed', fields: [{ field: 'rideId', problem: 'x' }] },
      }),
    ).toStrictEqual({ kind: 'refused', code: 'validation_failed', rideRefused: true });
    expect(
      await answered({
        error: { code: 'validation_failed', fields: [{ field: 'input.power', problem: 'x' }] },
      }),
    ).toStrictEqual({ kind: 'refused', code: 'validation_failed' });
    expect(
      await answered({ error: { code: 'job_running', fields: [{ field: 'rideId' }] } }),
    ).toStrictEqual({ kind: 'refused', code: 'job_running' });
  });

  it('is sent as the start’s body, under the session token', async () => {
    const calls: unknown[] = [];
    const started = await startJob(
      session({
        call: async (method, path, options) => {
          calls.push({ method, path, options });
          return Promise.resolve({ status: 202, body: { jobId: 'abc-1' } });
        },
      }),
      analysisJobRequest(INPUT, '1', 'instance-local'),
    );
    expect(started).toStrictEqual({ kind: 'started', jobId: 'abc-1' });
    expect(calls).toStrictEqual([
      {
        method: 'POST',
        path: '/v1/analysis/jobs',
        options: {
          token: 'token',
          body: { input: INPUT, templateVersion: '1', source: 'instance-local' },
        },
      },
    ]);
  });

  it('reads a refusal’s code, a job id that is not a path segment as a refusal, and no answer as unreachable', async () => {
    const answering = (status: number, body: unknown) =>
      session({ call: async () => Promise.resolve({ status, body }) });
    expect(
      await startJob(
        answering(409, { error: { code: 'job_running' } }),
        analysisJobRequest(INPUT, '1', 'instance-local'),
      ),
    ).toStrictEqual({ kind: 'refused', code: 'job_running' });
    expect(
      await startJob(
        answering(202, { jobId: '../auth/x' }),
        analysisJobRequest(INPUT, '1', 'instance-local'),
      ),
    ).toStrictEqual({ kind: 'refused' });
    expect(
      await startJob(session({}), analysisJobRequest(INPUT, '1', 'instance-local')),
    ).toStrictEqual({ kind: 'unreachable' });
  });
});

describe('an event', () => {
  it.each([
    ['progress', '{"step":2,"tool":"recent_rides"}', { kind: 'progress', step: 2 }],
    ['section', '{"index":1,"text":"A part."}', { kind: 'section', index: 1, text: 'A part.' }],
    ['withdrawn', '{}', { kind: 'withdrawn' }],
    [
      'result',
      '{"status":"succeeded","writeUp":"Done."}',
      { kind: 'result', status: 'succeeded', writeUp: 'Done.' },
    ],
    [
      'result',
      '{"status":"failed","failure":"out-of-time"}',
      { kind: 'result', status: 'failed', failure: 'out-of-time' },
    ],
  ] as const)('reads a %s event', (kind, data, read) => {
    expect(readJobEvent(kind, data)).toStrictEqual(read);
  });

  it.each([
    ['progress', '{"step":0}'],
    ['section', '{"index":1}'],
    ['section', '{"index":"1","text":"x"}'],
    ['result', '{"status":"done"}'],
    ['mystery', '{}'],
    ['section', 'not json'],
    ['progress', '[1]'],
  ])('skips a %s event it cannot read: %s', (kind, data) => {
    expect(readJobEvent(kind, data)).toBeUndefined();
  });

  it('drops a failure code that is not an identifier', () => {
    expect(readJobEvent('result', '{"status":"failed","failure":"<b>x</b>"}')).toStrictEqual({
      kind: 'result',
      status: 'failed',
    });
  });
});

describe('following a stream', () => {
  const streaming = (result: SealedStreamResult, frames: [string, string, string][] = []) =>
    session({
      stream: async (_path, options) => {
        for (const [id, kind, data] of frames) options.onEvent({ id, kind, data });
        return Promise.resolve(result);
      },
    });

  it('names the job and the last event, and hands each event on in order', async () => {
    const paths: string[] = [];
    const resumed: (string | undefined)[] = [];
    const events: [string, JobEvent][] = [];
    const followed = await followJob(
      session({
        stream: async (path, options) => {
          paths.push(path);
          resumed.push(options.lastEventId);
          options.onEvent({ id: '5', kind: 'progress', data: '{"step":3}' });
          options.onEvent({ id: '6', kind: 'unknown', data: '{}' });
          return Promise.resolve({ outcome: 'cut', lastEventId: '6' });
        },
      }),
      'job-1',
      '4',
      (id, event) => events.push([id, event]),
      new AbortController().signal,
    );
    expect(paths).toStrictEqual(['/v1/analysis/jobs/job-1/events']);
    expect(resumed).toStrictEqual(['4']);
    expect(events).toStrictEqual([['5', { kind: 'progress', step: 3 }]]);
    // The event it could not read still counts: a resume does not ask for it again.
    expect(followed).toStrictEqual({ kind: 'cut', lastEventId: '6' });
  });

  it('is ended on its result, and hands on nothing after it', async () => {
    const events: JobEvent[] = [];
    const followed = await followJob(
      streaming({ outcome: 'finished' }, [
        ['1', 'result', '{"status":"cancelled"}'],
        ['2', 'section', '{"index":1,"text":"late"}'],
      ]),
      'job-1',
      undefined,
      (_id, event) => events.push(event),
      new AbortController().signal,
    );
    expect(followed).toStrictEqual({ kind: 'ended' });
    expect(events).toStrictEqual([{ kind: 'result', status: 'cancelled' }]);
  });

  it('tells a job the instance does not have from one it will not stream, and retries a 5xx', async () => {
    const refused = (status: number) =>
      followJob(
        streaming({ outcome: 'cut', refused: { status, body: null } }),
        'job-1',
        undefined,
        () => undefined,
        new AbortController().signal,
      );
    expect(await refused(404)).toStrictEqual({ kind: 'gone' });
    expect(await refused(401)).toStrictEqual({ kind: 'refused' });
    expect(await refused(503)).toStrictEqual({ kind: 'cut' });
  });

  it('reads a stream that threw as cut, after the last event it saw', async () => {
    const followed = await followJob(
      session({
        stream: async (_path, options) => {
          options.onEvent({ id: '3', kind: 'progress', data: '{"step":1}' });
          return Promise.reject(new Error('no answer'));
        },
      }),
      'job-1',
      '2',
      () => undefined,
      new AbortController().signal,
    );
    expect(followed).toStrictEqual({ kind: 'cut', lastEventId: '3' });
  });

  it('builds no path from a job id that is not a path segment', async () => {
    let streamed = false;
    const followed = await followJob(
      session({
        stream: async () => {
          streamed = true;
          return Promise.resolve({ outcome: 'finished' });
        },
      }),
      '../../auth/devices',
      undefined,
      () => undefined,
      new AbortController().signal,
    );
    expect(followed).toStrictEqual({ kind: 'gone' });
    expect(streamed).toBe(false);
  });
});

describe('cancel and acknowledge', () => {
  it('post to the job’s own paths and read the instance’s answer', async () => {
    const paths: string[] = [];
    const answering = (status: number) =>
      session({
        call: async (_method, path) => {
          paths.push(path);
          return Promise.resolve({ status, body: null });
        },
      });
    expect(await cancelJob(answering(202), 'job-1')).toBe(true);
    expect(await acknowledgeJob(answering(204), 'job-1')).toBe(true);
    expect(await acknowledgeJob(answering(409), 'job-1')).toBe(false);
    expect(await cancelJob(session({}), 'job-1')).toBe(false);
    expect(await cancelJob(answering(202), 'a/b')).toBe(false);
    expect(paths).toStrictEqual([
      '/v1/analysis/jobs/job-1/cancel',
      '/v1/analysis/jobs/job-1/ack',
      '/v1/analysis/jobs/job-1/ack',
    ]);
  });
});

describe('the session', () => {
  it('is the sealed instance and its token, or the closed one’s sentence', () => {
    const sealed = { origin: 'https://x.example' } as never;
    const account = {} as never;
    expect(jobSessionOf({ kind: 'open', sealed, token: 't', account })).toStrictEqual({
      kind: 'open',
      channel: sealed,
      token: 't',
    });
    expect(jobSessionOf({ kind: 'closed', why: 'gate', text: 'Not here.' })).toStrictEqual({
      kind: 'closed',
      text: 'Not here.',
    });
  });
});
