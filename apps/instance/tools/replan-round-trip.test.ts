// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The round-trip measurement's own code (#1235), run against an instance on
 * this machine whose model is scripted. What is held here is the instrument:
 * that it times what it says it times, over both transports, and that its
 * arithmetic is right. The measurement itself needs a real model and, for
 * the tunnel, the owner's instance.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startFakeModelServer,
  type FakeModelServer,
  type ScriptedReply,
} from '../src/analysis/fake-model-server-testing.ts';
import { MARKER, MARKER_KEY } from '../src/analysis/hosted-key-testing.ts';
import { TEST_ORIGIN } from '../src/auth/identity-testing.ts';
import { readAnalysisModelSettings } from '../src/config.ts';
import { startInstance, type StartedInstance } from '../src/instance.ts';
import { testConfig } from '../src/instance-testing.ts';
import { readServerConfig } from '../src/server-config.ts';
import { migrateForDeploy } from '../src/store/serving.ts';
import {
  HOSTED_KEY_VARIABLE,
  hostedFromCommand,
  INTERRUPTED,
  KEY_NOT_CLEARED,
  measure,
  refusedArguments,
  stepsOf,
  summarise,
  type MeasureOptions,
  type Transport,
} from './replan-round-trip-run.ts';

let running: StartedInstance | undefined;
let model: FakeModelServer | undefined;
let directory: string | undefined;
/** The hosted service's own server, when a test has one: never the instance's local model. */
let hostedModel: FakeModelServer | undefined;
/** A proxy in front of the instance, when a test has one. */
let proxy: Server | undefined;
/** Where a redirecting proxy sends a request, when a test has one (#1270). */
let catcher: Server | undefined;
afterEach(async () => {
  for (const closing of [proxy, catcher]) {
    if (closing === undefined) continue;
    closing.closeAllConnections();
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
  proxy = undefined;
  catcher = undefined;
  await hostedModel?.close();
  hostedModel = undefined;
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
async function instance(
  script: readonly ScriptedReply[],
  keyed: boolean,
  hostedFetch?: typeof globalThis.fetch,
): Promise<string> {
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
    ...(hostedFetch === undefined ? {} : { hostedFetch }),
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

/** Where the hosted service is said to be. Nothing listens there: {@link hostedService} stands in. */
const HOSTED_URL = 'https://models.example/v1';

/**
 * The internet, for the instance's hosted requests (`InstanceOptions.hostedFetch`,
 * as `src/instance.test.ts` does it): a request to {@link HOSTED_URL} reaches
 * the fake hosted server, and its `Authorization` header is kept.
 */
async function hostedService(script: readonly ScriptedReply[]) {
  const fake = await startFakeModelServer(script);
  hostedModel = fake;
  const authorizations: (string | null)[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${HOSTED_URL}/`)) return Promise.reject(new Error('another host'));
    authorizations.push(new Headers(init?.headers).get('authorization'));
    return globalThis.fetch(`${fake.baseUrl.href}${url.slice(HOSTED_URL.length)}`, init);
  }) as typeof globalThis.fetch;
  return { fake, authorizations, fetch };
}

const HOSTED = { url: HOSTED_URL, model: 'hosted-model', key: MARKER_KEY };

/** What {@link interposed} does with one request: pass it on, destroy its socket, or redirect it. */
type Interposition = 'pass' | 'cut' | { readonly redirect: string };

/**
 * A loopback proxy in front of the instance that decides, request by request,
 * what becomes of each. `sealed` counts the sealed requests from one, this
 * one included, and is 0 for a request that is not sealed.
 */
async function interposed(
  target: string,
  decide: (path: string, sealed: number) => Interposition,
): Promise<string> {
  let sealed = 0;
  const server = createServer((incoming, outgoing) => {
    if (incoming.url === '/v1/sealed') sealed += 1;
    const decision = decide(incoming.url ?? '', incoming.url === '/v1/sealed' ? sealed : 0);
    if (decision === 'cut') {
      incoming.socket.destroy();
      return;
    }
    if (decision !== 'pass') {
      outgoing.writeHead(307, { location: decision.redirect }).end();
      return;
    }
    const upstream = httpRequest(
      `${target}${incoming.url ?? ''}`,
      { method: incoming.method, headers: incoming.headers },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  proxy = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

/** A server that only writes down what reaches it: where a redirect would carry a request. */
async function catching(): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((incoming, outgoing) => {
    requests.push(`${incoming.method ?? ''} ${incoming.url ?? ''}`);
    incoming.resume();
    outgoing.writeHead(404).end();
  });
  catcher = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, requests };
}

/**
 * The sealed requests of a one-run hosted measurement, in order: the
 * session, the key, the consent and the masking item (4), then a start, a
 * stream and a read for the warm-up and again for the counted run (6). The
 * eleventh is the clean-up's first.
 */
const FIRST_OF_THE_CLEAN_UP = 11;

describe('the round-trip measurement of a hosted model, on a key of the measurer’s own — #1235', () => {
  it('measures a hosted job to its decrypted result, on the hosted server with the key, and says the key nowhere', async () => {
    const service = await hostedService([...TWO_STEPS, ...TWO_STEPS]);
    // The local model has no script: a job that reached it would fail.
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    const report = await measure(
      options(url, 'sealed', { hosted: HOSTED, log: (line) => lines.push(line) }),
    );
    expect(report.statuses).toEqual({ succeeded: 1 });
    expect(report.source).toBe('instance-hosted');
    expect(report.hosted).toEqual({
      origin: 'https://models.example',
      model: 'hosted-model',
      cleared: true,
    });
    expect(report.warm[0]?.writeUpCharacters).toBe('A steady ride.'.length);
    expect(report.warm[0]?.steps).toHaveLength(2);
    // The hosted server answered all four model calls, each carrying the key; the local one none.
    expect(service.fake.paths).toHaveLength(4);
    expect(service.authorizations).toEqual(Array.from({ length: 4 }, () => `Bearer ${MARKER_KEY}`));
    expect(service.fake.requests[0]?.model).toBe('hosted-model');
    expect(model?.paths).toEqual([]);
    // The key is in no part of the report and no line the tool logged.
    expect(JSON.stringify(report)).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain(MARKER);
    // Afterwards the account holds neither: read back through GET /v1/analysis/hosted.
    expect(lines.at(-1)).toBe('account 1: the hosted key and consent are cleared');
  }, 60_000);

  it('says which source a local measurement ran on, and nothing of a hosted one', async () => {
    const url = await instance([TEXT, TEXT], true);
    const lines: string[] = [];
    const report = await measure(options(url, 'sealed', { log: (line) => lines.push(line) }));
    expect(report.source).toBe('instance-local');
    expect(report.hosted).toBeUndefined();
    // No account was sent a key, so none is cleared.
    expect(lines).toHaveLength(2);
  }, 60_000);

  it('clears the key and the consent when the run throws', async () => {
    const service = await hostedService(Array.from({ length: 12 }, () => TEXT));
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    // Thirteen starts on one account: the thirteenth is the instance's refusal.
    await expect(
      measure(
        options(url, 'sealed', {
          hosted: HOSTED,
          runs: 12,
          startsPerAccount: 100,
          log: (line) => lines.push(line),
        }),
      ),
    ).rejects.toThrow('rate_limited');
    expect(service.authorizations).toHaveLength(12);
    expect(lines.at(-1)).toBe('account 1: the hosted key and consent are cleared');
    expect(lines.join('\n')).not.toContain(MARKER);
  }, 60_000);

  it('clears every account it took, not only the last', async () => {
    const service = await hostedService(Array.from({ length: 3 }, () => TEXT));
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    const report = await measure(
      options(url, 'sealed', {
        hosted: HOSTED,
        runs: 2,
        startsPerAccount: 2,
        log: (line) => lines.push(line),
      }),
    );
    expect(report.statuses).toEqual({ succeeded: 2 });
    expect(report.hosted?.cleared).toBe(true);
    // Each account is cleared when the run is done with it, not when the whole run ends (#1270).
    expect(lines.map((line) => line.replace(/: succeeded .*/, ''))).toEqual([
      'warm 0',
      'warm 1',
      'account 1: the hosted key and consent are cleared',
      'warm 2',
      'account 2: the hosted key and consent are cleared',
    ]);
  }, 60_000);

  it('tries an account’s clean-up again when its first attempt is lost, and reads it back cleared — #1270', async () => {
    const service = await hostedService([TEXT, TEXT]);
    const url = await interposed(await instance([], true, service.fetch), (_, sealed) =>
      sealed === FIRST_OF_THE_CLEAN_UP ? 'cut' : 'pass',
    );
    const lines: string[] = [];
    const report = await measure(
      options(url, 'sealed', { hosted: HOSTED, log: (line) => lines.push(line) }),
    );
    expect(report.statuses).toEqual({ succeeded: 1 });
    expect(report.hosted?.cleared).toBe(true);
    expect(lines.at(-1)).toBe('account 1: the hosted key and consent are cleared');
  }, 60_000);

  it('stops when interrupted, without waiting for the run in flight, and clears the key first — #1270', async () => {
    const service = await hostedService([{ kind: 'slow', milliseconds: 20_000, then: TEXT }]);
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    const stop = new AbortController();
    const began = performance.now();
    const measuring = measure(
      options(url, 'sealed', {
        hosted: HOSTED,
        signal: stop.signal,
        log: (line) => lines.push(line),
      }),
    ).catch((error: unknown) => error);
    // Interrupted once the hosted service has the warm-up's request.
    await vi.waitFor(() => expect(service.authorizations).toHaveLength(1), { timeout: 15_000 });
    stop.abort();
    const failure = await measuring;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(INTERRUPTED);
    expect(performance.now() - began).toBeLessThan(15_000);
    expect(lines).toEqual(['account 1: the hosted key and consent are cleared']);
  }, 60_000);

  it('says to revoke the key when interrupted and an account cannot be read back as cleared — #1270', async () => {
    const service = await hostedService([{ kind: 'slow', milliseconds: 20_000, then: TEXT }]);
    let down = false;
    const url = await interposed(await instance([], true, service.fetch), () =>
      down ? 'cut' : 'pass',
    );
    const stop = new AbortController();
    const measuring = measure(
      options(url, 'sealed', { hosted: HOSTED, signal: stop.signal }),
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(service.authorizations).toHaveLength(1), { timeout: 15_000 });
    // The instance cannot be reached from the interruption on.
    down = true;
    stop.abort();
    const failure = await measuring;
    expect((failure as Error).message).toBe(KEY_NOT_CLEARED);
  }, 60_000);

  it('takes no account and sends no key when interrupted before it begins — #1270', async () => {
    const service = await hostedService([]);
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    const stop = new AbortController();
    stop.abort();
    const sent = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(
        measure(
          options(url, 'sealed', {
            hosted: HOSTED,
            signal: stop.signal,
            log: (line) => lines.push(line),
          }),
        ),
      ).rejects.toThrow(INTERRUPTED);
      // Nor afterwards: nothing it began carries on once it has answered.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
    expect(lines).toEqual([]);
    expect(service.authorizations).toEqual([]);
  }, 60_000);

  it('follows no redirect while a hosted key is in play: of the key, nor of the key it is sealed to — #1270', async () => {
    const service = await hostedService([]);
    const target = await instance([], true, service.fetch);
    const elsewhere = await catching();
    const redirects: readonly ((path: string, sealed: number) => boolean)[] = [
      (path) => path === '/v1/instance/keys',
      // The second sealed request is the one that carries the key.
      (_, sealed) => sealed === 2,
    ];
    for (const redirected of redirects) {
      const url = await interposed(target, (path, sealed) =>
        redirected(path, sealed) ? { redirect: `${elsewhere.url}${path}` } : 'pass',
      );
      const failure: unknown = await measure(options(url, 'sealed', { hosted: HOSTED })).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(JSON.stringify(failure)).not.toContain(MARKER);
      proxy?.closeAllConnections();
      proxy?.close();
    }
    expect(elsewhere.requests).toEqual([]);
    expect(service.authorizations).toEqual([]);
  }, 60_000);

  it('stops on a set-up the instance refuses, naming the step, the code and the field — and clears what it may have left', async () => {
    const service = await hostedService([]);
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    const failure: unknown = await measure(
      options(url, 'sealed', {
        hosted: { ...HOSTED, model: 'two words' },
        log: (line) => lines.push(line),
      }),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'the hosted key was refused: validation_failed (model)',
    );
    expect(lines).toEqual(['account 1: the hosted key and consent are cleared']);
    expect(service.authorizations).toEqual([]);
  }, 60_000);

  it('files a hosted job the service refused under its own reason, never as a lost connection', async () => {
    const service = await hostedService([
      TEXT,
      { kind: 'status', status: 401, body: '{"error":{"message":"bad key"}}' },
    ]);
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    const report = await measure(
      options(url, 'sealed', { hosted: HOSTED, log: (line) => lines.push(line) }),
    );
    expect(Object.keys(report.statuses)).toEqual([expect.stringMatching(/^failed:model-/)]);
    expect(report.summary.totalMs).toBeNull();
    expect(report.hosted?.cleared).toBe(true);
    expect(JSON.stringify(report)).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain(MARKER);
  }, 60_000);

  it('says so, in the report and aloud, when an account cannot be read back as cleared', async () => {
    const service = await hostedService([TEXT, TEXT]);
    const url = await instance([], true, service.fetch);
    const lines: string[] = [];
    const real = globalThis.fetch;
    let down = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      down
        ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
        : real(input, init),
    );
    try {
      const report = await measure(
        options(url, 'sealed', {
          hosted: HOSTED,
          log: (line) => {
            lines.push(line);
            // The instance cannot be reached from the end of the last counted run on.
            if (line.startsWith('warm 1:')) down = true;
          },
        }),
      );
      expect(report.statuses).toEqual({ succeeded: 1 });
      expect(report.hosted?.cleared).toBe(false);
      expect(lines.at(-1)).toMatch(/^account 1: ⚠️ could NOT confirm .* revoke the key/);
      expect(lines.join('\n')).not.toContain(MARKER);
    } finally {
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('refuses a hosted model in plaintext, before anything is sent', async () => {
    const service = await hostedService([]);
    const url = await instance([], true, service.fetch);
    const sent = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(measure(options(url, 'plaintext', { hosted: HOSTED }))).rejects.toThrow(
        'sealed transport only',
      );
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('refuses a hosted model through plain http: to another machine, before anything is sent', async () => {
    // Rejecting, so that nothing leaves this machine even when the refusal is broken.
    const sent = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('a request was sent')));
    try {
      for (const url of [
        'http://192.168.1.20:8787',
        'http://rides.example.org',
        'http://127.0.0.1.example.org',
        'http://localhost.example.org',
        'http://128.0.0.1',
        // A loopback name as userinfo, before the host really reached (#1270).
        'http://127.0.0.1@evil.example',
        'http://localhost:8787@evil.example',
        'http://[::1]@evil.example',
        'http://evil.example\\@127.0.0.1',
        // Numeric forms of an address that is not loopback.
        'http://0x80.0.0.1',
        'http://2147483649',
        'http://0200.0.0.1',
      ]) {
        await expect(measure(options(url, 'sealed', { hosted: HOSTED }))).rejects.toThrow(
          'an https: or a loopback --url only',
        );
      }
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('lets a hosted model through https: and through every loopback name, as far as its first request', async () => {
    const reached: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      reached.push(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      return Promise.reject(new Error('nothing listens here'));
    });
    try {
      for (const url of [
        'https://rides.example.org',
        'http://localhost:9',
        'http://127.0.0.1:9',
        'http://127.8.9.10:9',
        'http://[::1]:9',
        // Numeric forms of loopback, and loopback behind userinfo (#1270).
        'http://2130706433:9',
        'http://0x7f.0.0.1:9',
        'http://0177.0.0.1:9',
        'http://127.1:9',
        'http://evil.example@127.0.0.1:9',
      ]) {
        await expect(measure(options(url, 'sealed', { hosted: HOSTED }))).rejects.toThrow(
          'nothing listens here',
        );
      }
      expect(reached).toHaveLength(10);
      // Each went to the loopback address, and never to a name before an `@`.
      expect(reached.slice(5).map((each) => new URL(each).host)).toEqual(
        Array.from({ length: 5 }, () => '127.0.0.1:9'),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('holds a local measurement to no such rule', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('nothing listens here')),
    );
    try {
      await expect(measure(options('http://192.168.1.20:8787', 'sealed'))).rejects.toThrow(
        'nothing listens here',
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('refuses a hosted model with something to unload, before anything is sent', async () => {
    const sent = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(
        measure(
          options('http://127.0.0.1:9', 'sealed', {
            hosted: HOSTED,
            coldRuns: 1,
            unload: () => Promise.resolve(),
          }),
        ),
      ).rejects.toThrow('nothing to unload');
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('refuses a --url or --hosted-url that is not a URL by the option’s name, never with the value — #1270', async () => {
    const sent = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('a request was sent')));
    try {
      const local: unknown = await measure(options(MARKER_KEY, 'sealed')).catch(
        (error: unknown) => error,
      );
      expect((local as Error).message).toBe('--url is not a URL');
      const hosted: unknown = await measure(
        options('http://127.0.0.1:9', 'sealed', { hosted: { ...HOSTED, url: MARKER_KEY } }),
      ).catch((error: unknown) => error);
      expect((hosted as Error).message).toBe('--hosted-url is not a URL');
      // Nothing of the value rides along on the error, as `URL`'s own `input` does.
      expect(JSON.stringify(local)).not.toContain(MARKER);
      expect(JSON.stringify(hosted)).not.toContain(MARKER);
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('the hosted options of the command — #1235', () => {
  it('reads the key from the environment variable, and nothing when no hosted option is given', () => {
    expect(
      hostedFromCommand(undefined, undefined, { [HOSTED_KEY_VARIABLE]: MARKER_KEY }),
    ).toBeUndefined();
    expect(
      hostedFromCommand(HOSTED_URL, 'hosted-model', { [HOSTED_KEY_VARIABLE]: MARKER_KEY }),
    ).toEqual(HOSTED);
  });

  it('refuses hosted options with the variable unset or empty, naming it', () => {
    expect(() => hostedFromCommand(HOSTED_URL, 'hosted-model', {})).toThrow(
      /^OYL_MEASURE_HOSTED_KEY is not set/,
    );
    expect(() =>
      hostedFromCommand(HOSTED_URL, 'hosted-model', { [HOSTED_KEY_VARIABLE]: '' }),
    ).toThrow(/^OYL_MEASURE_HOSTED_KEY is not set/);
  });

  it('refuses one hosted option without the other', () => {
    const environment = { [HOSTED_KEY_VARIABLE]: MARKER_KEY };
    expect(() => hostedFromCommand(HOSTED_URL, undefined, environment)).toThrow('go together');
    expect(() => hostedFromCommand(undefined, 'hosted-model', environment)).toThrow('go together');
  });

  /** The command itself, as `pnpm run replan-round-trip` starts it. */
  function command(given: readonly string[], key: string | undefined) {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== HOSTED_KEY_VARIABLE),
    );
    return spawnSync(
      process.execPath,
      [join(dirname(fileURLToPath(import.meta.url)), 'replan-round-trip.ts'), ...given],
      {
        encoding: 'utf8',
        env: { ...environment, ...(key === undefined ? {} : { [HOSTED_KEY_VARIABLE]: key }) },
        timeout: 30_000,
      },
    );
  }
  const HOSTED_ARGUMENTS = ['--hosted-url', HOSTED_URL, '--hosted-model', 'hosted-model'];

  it('the command stops, naming the variable, when it is run hosted without it', () => {
    const ran = command(['--url', 'http://127.0.0.1:9', ...HOSTED_ARGUMENTS], undefined);
    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain('OYL_MEASURE_HOSTED_KEY is not set');
    expect(ran.stdout).toBe('');
  }, 60_000);

  it('the command hands the variable’s key to the measurement, which refuses plaintext without printing it', () => {
    const ran = command(
      ['--url', 'http://127.0.0.1:9', '--transport', 'plaintext', ...HOSTED_ARGUMENTS],
      MARKER_KEY,
    );
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toContain('sealed transport only');
    expect(`${ran.stdout}${ran.stderr}`).not.toContain(MARKER);
  }, 60_000);
});

describe('the command, run hosted against an instance — #1235', () => {
  /**
   * {@link interposed}, taking the instance away from the command at a chosen
   * request: from the `cutFrom`th sealed request on, each has its socket
   * destroyed, unanswered.
   */
  function proxied(target: string, cutFrom: number): Promise<string> {
    return interposed(target, (_, sealed) => (sealed >= cutFrom ? 'cut' : 'pass'));
  }

  /** The command, without blocking this process: the instance it talks to runs here. */
  function hostedCommand(
    url: string,
    started?: (child: ChildProcess) => void,
  ): Promise<{ status: number | null; out: string; err: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          join(dirname(fileURLToPath(import.meta.url)), 'replan-round-trip.ts'),
          ...['--url', url, '--origin', TEST_ORIGIN, '--runs', '1', '--run-timeout-seconds', '20'],
          ...['--hosted-url', HOSTED_URL, '--hosted-model', 'hosted-model'],
        ],
        { env: { ...process.env, [HOSTED_KEY_VARIABLE]: MARKER_KEY } },
      );
      started?.(child);
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, out, err }));
    });
  }

  it('prints a report and progress lines with no key in them, and exits 0 with every account cleared', async () => {
    const service = await hostedService([TEXT, TEXT]);
    const url = await proxied(await instance([], true, service.fetch), Number.POSITIVE_INFINITY);
    const ran = await hostedCommand(url);
    expect(ran.err.trimEnd().split('\n').at(-1)).toBe(
      'account 1: the hosted key and consent are cleared',
    );
    expect(ran.status).toBe(0);
    const report = JSON.parse(ran.out) as { statuses: unknown; hosted: unknown };
    expect(report.statuses).toEqual({ succeeded: 1 });
    expect(report.hosted).toEqual({
      origin: 'https://models.example',
      model: 'hosted-model',
      cleared: true,
    });
    expect(service.authorizations).toEqual([`Bearer ${MARKER_KEY}`, `Bearer ${MARKER_KEY}`]);
    expect(`${ran.out}${ran.err}`).not.toContain(MARKER);
  }, 60_000);

  it('exits 3, its last line on stderr saying to revoke the key, when an account could not be read back as cleared', async () => {
    const service = await hostedService([TEXT, TEXT]);
    const url = await proxied(await instance([], true, service.fetch), FIRST_OF_THE_CLEAN_UP);
    const ran = await hostedCommand(url);
    const report = JSON.parse(ran.out) as { statuses: unknown; hosted: { cleared: unknown } };
    // The run itself was whole: only the clean-up lost the instance.
    expect(report.statuses).toEqual({ succeeded: 1 });
    expect(report.hosted.cleared).toBe(false);
    expect(ran.err.trimEnd().split('\n').at(-1)).toBe(KEY_NOT_CLEARED);
    expect(ran.status).toBe(3);
    expect(`${ran.out}${ran.err}`).not.toContain(MARKER);
  }, 60_000);

  it('clears every account on Ctrl-C and exits 130, without waiting for the run in flight — #1270', async () => {
    const service = await hostedService([{ kind: 'slow', milliseconds: 30_000, then: TEXT }]);
    const url = await proxied(await instance([], true, service.fetch), Number.POSITIVE_INFINITY);
    const ran = await hostedCommand(url, (child) => {
      // Interrupted once the hosted service has the warm-up's request.
      const waiting = setInterval(() => {
        if (service.authorizations.length === 0) return;
        clearInterval(waiting);
        child.kill('SIGINT');
      }, 50);
      child.on('close', () => clearInterval(waiting));
    });
    expect(ran.err.trimEnd().split('\n').slice(-2)).toEqual([
      'account 1: the hosted key and consent are cleared',
      INTERRUPTED,
    ]);
    expect(ran.status).toBe(130);
    expect(ran.out).toBe('');
    expect(`${ran.out}${ran.err}`).not.toContain(MARKER);
  }, 60_000);

  it('refuses a --url or --hosted-url that is not a URL, by name and without the value — #1270', () => {
    const pasted = 'sk-PASTEDVALUE5R8W';
    for (const [option, given] of [
      ['--url', ['--url', pasted]],
      [
        '--hosted-url',
        ['--url', 'http://127.0.0.1:9', '--hosted-url', pasted, '--hosted-model', 'hosted-model'],
      ],
    ] as const) {
      const ran = spawnSync(
        process.execPath,
        [join(dirname(fileURLToPath(import.meta.url)), 'replan-round-trip.ts'), ...given],
        {
          encoding: 'utf8',
          env: { ...process.env, [HOSTED_KEY_VARIABLE]: MARKER_KEY },
          timeout: 30_000,
        },
      );
      expect(ran.status).not.toBe(0);
      expect(ran.stderr).toContain(`${option} is not a URL`);
      expect(`${ran.stdout}${ran.stderr}`).not.toContain('PASTEDVALUE');
    }
  }, 60_000);
});

describe('the command’s --unload, run by this machine’s own shell — #1287', () => {
  /** The command against a local model, without blocking this process: the instance runs here. */
  function localCommand(
    url: string,
    unload: string,
  ): Promise<{ status: number | null; out: string; err: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        join(dirname(fileURLToPath(import.meta.url)), 'replan-round-trip.ts'),
        ...['--url', url, '--origin', TEST_ORIGIN, '--transport', 'plaintext'],
        ...['--runs', '1', '--cold-runs', '2', '--run-timeout-seconds', '20'],
        ...['--unload', unload],
      ]);
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, out, err }));
    });
  }

  it('runs the unload command before each cold run, on Windows as on the others', async () => {
    const url = await instance(
      Array.from({ length: 4 }, () => TEXT),
      false,
    );
    // The unload command leaves a line behind each time it really runs. Double
    // quotes are the one quoting both `sh` and `cmd.exe` read the same way.
    const script = join(directory ?? '', 'unload.mjs');
    const ran = join(directory ?? '', 'unloads.txt');
    await writeFile(
      script,
      "import { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], 'unloaded\\n');\n",
    );
    const done = await localCommand(url, `"${process.execPath}" "${script}" "${ran}"`);
    expect(done.err).not.toContain('the unload command failed');
    expect(done.status).toBe(0);
    expect(await readFile(ran, 'utf8')).toBe('unloaded\nunloaded\n');
    const report = JSON.parse(done.out) as { statuses: unknown; cold: readonly unknown[] };
    expect(report.statuses).toEqual({ succeeded: 3 });
    expect(report.cold).toHaveLength(2);
  }, 60_000);
});

describe('the options the command does not have — #1235', () => {
  const KNOWN = ['--url', '--runs'];

  it('passes the options it has, each with its value — a value that looks like an option too', () => {
    expect(refusedArguments([], KNOWN)).toBeUndefined();
    expect(refusedArguments(['--url', 'https://x.example', '--runs', '3'], KNOWN)).toBeUndefined();
    expect(refusedArguments(['--url', '--not-an-option'], KNOWN)).toBeUndefined();
  });

  it('refuses an option it does not have by name, and never with its value', () => {
    expect(refusedArguments(['--url', 'https://x.example', '--rnus', '3'], KNOWN)).toBe(
      '--rnus is not an option of this command',
    );
    const pasted = refusedArguments(['--hosted-key', MARKER_KEY, '--url', 'u'], KNOWN);
    expect(pasted).toMatch(/^--hosted-key is not an option: .* OYL_MEASURE_HOSTED_KEY/);
    expect(pasted).not.toContain(MARKER);
    // The value glued to the name is no more written than one beside it.
    const glued = refusedArguments([`--hosted-key=${MARKER_KEY}`], KNOWN);
    expect(glued).toMatch(/^--hosted-key is not an option/);
    expect(glued).not.toContain(MARKER);
  });

  it('never echoes more of a name than an option could be — #1270', () => {
    // A key glued on with a hyphen is named as the option it follows, and no more.
    const hyphened = refusedArguments([`--hosted-key-${MARKER_KEY}`], KNOWN);
    expect(hyphened).toMatch(/^--hosted-key is not an option: /);
    expect(hyphened).not.toContain(MARKER);
    // Any other name longer than every option's is not repeated at all.
    expect(refusedArguments([`--${MARKER_KEY}`], KNOWN)).toBe(
      'an option this command does not have was given (its name is too long to repeat)',
    );
    expect(refusedArguments(['--rnuss'], KNOWN)).toBe(
      'an option this command does not have was given (its name is too long to repeat)',
    );
    // A name as long as the longest option's is still named.
    expect(refusedArguments(['--rnus'], KNOWN)).toBe('--rnus is not an option of this command');
  });

  it('refuses a word that is no option’s value, without writing it', () => {
    const stray = refusedArguments(['--url', 'u', MARKER_KEY], KNOWN);
    expect(stray).toBe('an argument that is no option’s value was given');
  });

  it('the command stops on a key given as an option, naming the option and not the key', () => {
    const ran = spawnSync(
      process.execPath,
      [
        join(dirname(fileURLToPath(import.meta.url)), 'replan-round-trip.ts'),
        ...['--url', 'http://127.0.0.1:9', '--hosted-url', HOSTED_URL],
        ...['--hosted-model', 'hosted-model', '--hosted-key', MARKER_KEY],
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain('--hosted-key is not an option');
    expect(`${ran.stdout}${ran.stderr}`).not.toContain(MARKER);
  }, 60_000);
});
