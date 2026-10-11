// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The round-trip measurement's own code (#1235), run against an instance on
 * this machine whose model is scripted. What is held here is the instrument:
 * that it times what it says it times, over both transports, and that its
 * arithmetic is right. The measurement itself needs a real model and, for
 * the tunnel, the owner's instance.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startFakeModelServer,
  type FakeModelServer,
  type ScriptedReply,
} from '../src/analysis/fake-model-server-testing.ts';
import { TEST_ORIGIN } from '../src/auth/identity-testing.ts';
import { readAnalysisModelSettings } from '../src/config.ts';
import { startInstance, type StartedInstance } from '../src/instance.ts';
import { testConfig } from '../src/instance-testing.ts';
import { readServerConfig } from '../src/server-config.ts';
import { migrateForDeploy } from '../src/store/serving.ts';
import {
  measure,
  stepsOf,
  summarise,
  type MeasureOptions,
  type Transport,
} from './replan-round-trip-run.ts';

let running: StartedInstance | undefined;
let model: FakeModelServer | undefined;
let directory: string | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  await model?.close();
  model = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

const TEXT: ScriptedReply = { kind: 'text', text: 'A steady ride.' };
/** One job: the model asks for the goals tool, then writes. */
const TWO_STEPS: readonly ScriptedReply[] = [
  { kind: 'tool-calls', calls: [{ name: 'goals', arguments: '{}' }] },
  TEXT,
];

/** An instance on loopback over `script`; `keyed` makes it hold keys, and so serve jobs sealed only. */
async function instance(script: readonly ScriptedReply[], keyed: boolean): Promise<string> {
  model = await startFakeModelServer(script);
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-round-trip-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '1' }, 1);
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({
      bodyLimitBytes: 16_384,
      registration: 'open',
      analysis: readAnalysisModelSettings({
        analysisModelUrl: `http://ollama:${model.baseUrl.port}/v1`,
        analysisModel: 'scripted',
      }),
    }),
    resolve: () => Promise.resolve(['127.0.0.1']),
    server: {
      ...server.config,
      blobsPath: join(directory, 'blobs'),
      ...(keyed ? { secretKey: new Uint8Array(32).fill(7) } : {}),
    },
    version: '0',
    notices: '',
    log: () => undefined,
  });
  await running.opened;
  await running.jobsRecovered;
  await running.keysMaintained;
  return running.url;
}

function options(
  url: string,
  transport: Transport,
  overrides: Partial<MeasureOptions> = {},
): MeasureOptions {
  return {
    url,
    origin: TEST_ORIGIN,
    transport,
    runs: 1,
    coldRuns: 0,
    startsPerAccount: 12,
    runTimeoutMs: 20_000,
    ...overrides,
  };
}

describe('the round-trip measurement’s arithmetic — #1235', () => {
  it('takes nearest-rank percentiles, so the p95 of thirty is the twenty-ninth', () => {
    const thirty = Array.from({ length: 30 }, (_, index) => (index + 1) * 10).reverse();
    expect(summarise(thirty)).toEqual({ n: 30, p50: 150, p95: 290, max: 300, min: 10 });
    expect(summarise([7])).toEqual({ n: 1, p50: 7, p95: 7, max: 7, min: 7 });
  });

  it('summarises nothing as nothing, never as a zero', () => {
    expect(summarise([])).toBeNull();
  });

  it('reads a step as its progress event to the next event, with the tools it called', () => {
    expect(
      stepsOf([
        { atMs: 100, kind: 'progress', step: 1 },
        { atMs: 400, kind: 'progress', step: 1, tool: 'goals' },
        { atMs: 410, kind: 'progress', step: 1, tool: 'history' },
        { atMs: 420, kind: 'progress', step: 2 },
        { atMs: 1_420, kind: 'section' },
        { atMs: 1_430, kind: 'result' },
      ]),
    ).toEqual([
      { step: 1, ms: 300, tools: ['goals', 'history'] },
      { step: 2, ms: 1_000, tools: [] },
    ]);
  });

  it('counts no step for a progress event nothing followed', () => {
    expect(stepsOf([{ atMs: 100, kind: 'progress', step: 1 }])).toEqual([]);
  });
});

describe('the round-trip measurement, run against a scripted model — #1235', () => {
  it('measures a sealed job to its decrypted result, with the model’s own delay inside the step it belongs to', async () => {
    // Long enough that a busy runner cannot make the step before it look as slow.
    const slow: ScriptedReply = { kind: 'slow', milliseconds: 1_500, then: TEXT };
    const url = await instance(
      [...TWO_STEPS, { kind: 'tool-calls', calls: [{ name: 'goals', arguments: '{}' }] }, slow],
      true,
    );
    const report = await measure(options(url, 'sealed'));
    expect(report.statuses).toEqual({ succeeded: 1 });
    expect(report.warmUp?.status).toBe('succeeded');
    const [run] = report.warm;
    expect(run?.steps.map((step) => [step.step, step.tools])).toEqual([
      [1, ['goals']],
      [2, []],
    ]);
    // A step is timed between two events as they ARRIVE, so it can read a
    // little under the model's own delay when the first event came late.
    expect(run?.steps[1]?.ms).toBeGreaterThanOrEqual(1_000);
    expect(run?.steps[0]?.ms).toBeLessThan(1_000);
    expect(run?.totalMs).toBeGreaterThanOrEqual(1_500);
    expect(run?.serverMs).toBeGreaterThanOrEqual(1_490);
    expect(run?.sealMs).toBeGreaterThan(0);
    expect(run?.openMs).toBeGreaterThan(0);
    expect(run?.sections).toBe(1);
    expect(run?.writeUpCharacters).toBe('A steady ride.'.length);
    expect(report.summary.totalMs?.n).toBe(1);
    expect(report.summary.stepsPerRun?.p50).toBe(2);
    // The model was asked four times: two for the run nobody counts, two for the one counted.
    expect(model?.paths).toHaveLength(4);
    // And no two jobs sent it the same ride: a model server that keeps its
    // last prompt would otherwise skip evaluating the input every time.
    expect(JSON.stringify(model?.requests[2])).not.toBe(JSON.stringify(model?.requests[0]));
  }, 60_000);

  it('measures the same job in plaintext against an instance with no keys, sealing nothing', async () => {
    const url = await instance([...TWO_STEPS, ...TWO_STEPS], false);
    const report = await measure(options(url, 'plaintext'));
    expect(report.statuses).toEqual({ succeeded: 1 });
    const [run] = report.warm;
    expect(run?.steps).toHaveLength(2);
    expect([run?.sealMs, run?.openMs]).toEqual([0, 0]);
    expect(run?.serverMs).not.toBeNull();
  }, 60_000);

  it('cannot be run in plaintext against an instance that holds keys', async () => {
    const url = await instance(TWO_STEPS, true);
    await expect(measure(options(url, 'plaintext'))).rejects.toThrow('sealed_required');
    expect(model?.paths).toEqual([]);
  }, 60_000);

  it('says an instance with no keys cannot be measured sealed', async () => {
    const url = await instance(TWO_STEPS, false);
    await expect(measure(options(url, 'sealed'))).rejects.toThrow('serves no encryption key');
  }, 60_000);

  it('takes a new account before one athlete’s twelve starts an hour run out', async () => {
    const url = await instance(
      Array.from({ length: 14 }, () => TEXT),
      false,
    );
    const report = await measure(options(url, 'plaintext', { runs: 13 }));
    expect(report.statuses).toEqual({ succeeded: 13 });
    // And without it the thirteenth start is the instance's refusal.
    await expect(
      measure(options(url, 'plaintext', { runs: 13, startsPerAccount: 100 })),
    ).rejects.toThrow('rate_limited');
  }, 60_000);

  it('unloads before each cold run, and makes no cold run with nothing to unload with', async () => {
    const url = await instance(
      Array.from({ length: 4 }, () => TEXT),
      false,
    );
    let unloads = 0;
    const cold = await measure(
      options(url, 'plaintext', {
        coldRuns: 2,
        unload: () => {
          unloads += 1;
          return Promise.resolve();
        },
      }),
    );
    expect(unloads).toBe(2);
    expect(cold.cold.map((run) => [run.cold, run.status])).toEqual([
      [true, 'succeeded'],
      [true, 'succeeded'],
    ]);
    expect(cold.coldTotalMs?.n).toBe(2);
    const none = await measure(options(url, 'plaintext', { runs: 0, coldRuns: 2 }));
    expect([none.warmUp, none.cold, none.coldTotalMs]).toEqual([null, [], null]);
  }, 60_000);

  it('records a run that outlived its time as timed-out, cancels it, and leaves it out of the figures', async () => {
    const url = await instance([{ kind: 'slow', milliseconds: 5_000, then: TEXT }], false);
    const report = await measure(
      options(url, 'plaintext', {
        runs: 0,
        coldRuns: 1,
        unload: () => Promise.resolve(),
        runTimeoutMs: 300,
      }),
    );
    expect(report.statuses).toEqual({ 'timed-out': 1 });
    expect(report.coldTotalMs).toBeNull();
    expect(report.cold[0]?.serverMs).toBeNull();
    await running?.analysisJobs()?.idle();
    // The cancel closed the model call in flight; the server sees the socket close a moment later.
    await vi.waitFor(() => expect(model?.closedEarly).toBe(1));
  }, 60_000);

  it('records a run whose stream was cut as connection-lost, and goes on to the next run', async () => {
    const url = await instance([TEXT, TEXT, TEXT], false);
    const real = globalThis.fetch;
    let streams = 0;
    let cutJob: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const address =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // The job whose stream was cut cannot be read back either: the connection is still down.
      if (cutJob !== undefined && address.endsWith(`/v1/analysis/jobs/${cutJob}`)) {
        return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
      }
      if (!address.endsWith('/events')) return real(input, init);
      streams += 1;
      // The second stream (the first counted run) is reset before any event.
      if (streams !== 2) return real(input, init);
      cutJob = address.split('/').at(-2);
      const cut = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new TypeError('terminated', { cause: { code: 'ECONNRESET' } }));
        },
      });
      return Promise.resolve(
        new Response(cut, { headers: { 'content-type': 'text/event-stream' } }),
      );
    });
    const lines: string[] = [];
    try {
      const report = await measure(
        options(url, 'plaintext', { runs: 2, log: (line) => lines.push(line) }),
      );
      expect(report.statuses).toEqual({ 'connection-lost:ECONNRESET': 1, succeeded: 1 });
      expect(report.warm.map((record) => [record.status, record.unread])).toEqual([
        ['connection-lost', 'ECONNREFUSED'],
        ['succeeded', undefined],
      ]);
      expect(report.warm[0]?.serverMs).toBeNull();
      expect(report.summary.totalMs?.n).toBe(1);
      expect(lines[1]).toMatch(/^warm 1: connection-lost:ECONNRESET in /);
    } finally {
      vi.restoreAllMocks();
    }
    await running?.analysisJobs()?.idle();
  }, 60_000);

  it('stops on a stream that is refused, which is a fault and not a lost connection', async () => {
    const url = await instance([TEXT, TEXT], false);
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const address =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!address.endsWith('/events')) return real(input, init);
      return Promise.resolve(new Response('bad gateway', { status: 502 }));
    });
    try {
      await expect(measure(options(url, 'plaintext'))).rejects.toThrow(
        /the stream was refused: 502/,
      );
    } finally {
      vi.restoreAllMocks();
    }
    await running?.analysisJobs()?.idle();
  }, 60_000);

  it('keeps a job that failed out of the figures, under its own reason', async () => {
    const url = await instance(
      [TEXT, { kind: 'status', status: 500, body: '{"error":{"message":"no"}}' }],
      false,
    );
    const report = await measure(options(url, 'plaintext'));
    expect(Object.keys(report.statuses)).toEqual([expect.stringMatching(/^failed:model-/)]);
    expect(report.summary.totalMs).toBeNull();
  }, 60_000);
});
