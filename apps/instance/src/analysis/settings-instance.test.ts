// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The operator's analysis settings on the RUNNING instance (#2609, ADR 0046's
 * 2026-11-14 amendment): saved through the owner's sealed Operate route, read
 * back at the connection the job engine builds — the model name each request
 * to the model server carries — and never at the row. Across a restart, with
 * no restart, a job already running, the switch for other riders, hosted
 * turned off, and an address that resolves elsewhere after it was saved.
 *
 * Jobs are driven through `analysisJobs()`, as the #1223 cases in
 * `instance.test.ts` drive them: an instance holding keys serves the job
 * routes sealed only, and sealing is not what these test.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import type { Caller } from '../auth/identity.ts';
import { readAnalysisModelSettings, type AnalysisModelEnv } from '../config.ts';
import type { Resolver } from '../history/address.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { modelKeySet } from '../operator/commands.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy, openServingStore } from '../store/serving.ts';
import { registrationFixture } from '../store/testing/index.ts';
import { startFakeModelServer, type FakeModelServer } from './fake-model-server-testing.ts';
import { secretText } from './hosted-key-testing.ts';
import { MASKING_ITEM_KEY } from './hosted.ts';
import { jobBody, parseStream } from './jobs-testing.ts';
import { startOllamaStub, type OllamaStub } from './ollama-stub-testing.ts';
import { TACTICS_PROMPT_VERSION } from './tactics-prompt.ts';
import { ATTACK, CHAT_FIGURES, TACTICS_INPUT } from './tactics-testing.ts';

const SECRET_FILL = 7;
const HOSTED = new URL('https://models.example/v1');

let directory: string | undefined;
let running: StartedInstance | undefined;
const servers: FakeModelServer[] = [];
const stubs: OllamaStub[] = [];
afterEach(async () => {
  await running?.stop();
  running = undefined;
  for (const server of servers.splice(0)) await server.close();
  for (const stub of stubs.splice(0)) await stub.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function modelServer(...texts: string[]): Promise<FakeModelServer> {
  const server = await startFakeModelServer(texts.map((text) => ({ kind: 'text', text })));
  servers.push(server);
  return server;
}

async function freshPath(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-analysis-settings-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  return path;
}

/** A keyed instance whose owner is `owner`, its `.env` analysis lines `env`. */
async function start(
  path: string,
  options: {
    readonly owner: TestDevice;
    readonly env: AnalysisModelEnv;
    readonly resolve?: Resolver;
    readonly hostedFetch?: typeof globalThis.fetch;
    readonly log?: string[];
  },
): Promise<StartedInstance> {
  const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '1' }, 1);
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({
      bodyLimitBytes: 16_384,
      registration: 'open',
      moderators: { owner: options.owner.publicKey },
      analysis: readAnalysisModelSettings(options.env),
      analysisEnv: options.env,
    }),
    resolve: options.resolve ?? (() => Promise.resolve(['127.0.0.1'])),
    server: {
      ...server.config,
      blobsPath: join(path, '..', 'blobs'),
      secretKey: new Uint8Array(32).fill(SECRET_FILL),
    },
    version: '0',
    notices: '',
    log: (line) => options.log?.push(line),
    ...(options.hostedFetch === undefined ? {} : { hostedFetch: options.hostedFetch }),
  });
  await running.opened;
  await running.jobsRecovered;
  await running.keysMaintained;
  return running;
}

interface Session {
  readonly device: TestDevice;
  readonly token: string;
  readonly athleteId: string;
}

/** Sign `device` in, sealed, as a device on an instance holding keys must. */
async function signIn(instance: StartedInstance, device: TestDevice): Promise<Session> {
  const challenge = (await (
    await fetch(`${instance.url}/v1/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: device.publicKey }),
    })
  ).json()) as { nonce: string };
  const session = await sealedAt(instance.url, TEST_ORIGIN, {
    method: 'POST',
    path: '/v1/auth/session',
    body: await device.statement(challenge.nonce),
    signer: device.signingKey,
  });
  expect(session.status, session.text).toBe(200);
  const body = JSON.parse(session.text) as { sessionToken: string; athleteId: string };
  return { device, token: body.sessionToken, athleteId: body.athleteId };
}

/** One sealed call as `who`: the inner status and parsed body. */
async function sealed(
  instance: StartedInstance,
  who: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const answer = await sealedAt(instance.url, TEST_ORIGIN, {
    method,
    path,
    token: who.token,
    signer: who.device.signingKey,
    ...(body === undefined ? {} : { body }),
  });
  return { status: answer.status, body: answer.text === '' ? null : JSON.parse(answer.text) };
}

/** One job of `athleteId`'s, run to its end: the result event's data, or the start's refusal. */
async function jobOf(
  instance: StartedInstance,
  athleteId: string,
  body: Record<string, unknown> = jobBody(),
): Promise<Record<string, unknown> | undefined> {
  const jobs = instance.analysisJobs();
  if (jobs === undefined) throw new Error('no analysis jobs');
  const caller = { athleteId } as Caller;
  const started = await jobs.start(caller, body);
  // #2609: a source not offered to the athlete is refused at the start.
  if (!started.ok) return { refusedAtStart: started.code };
  await jobs.idle();
  const stream = await jobs.events(caller, started.value.jobId, null);
  return parseStream((await stream?.text()) ?? '').events.at(-1)?.data;
}

const SUCCEEDED = { status: 'succeeded', writeUp: 'A steady ride.' };
const modelsAsked = (server: FakeModelServer): unknown[] =>
  server.requests.map((request) => request.model);

describe('the operator’s analysis settings reach the job engine (#2609)', () => {
  it('builds the next job’s connection with the model saved in the app, across a restart, and falls back to .env once cleared', async () => {
    const model = await modelServer('A steady ride.', 'A steady ride.', 'A steady ride.');
    const port = model.baseUrl.port;
    const env = { analysisModelUrl: `http://ollama:${port}/v1`, analysisModel: 'env-model' };
    const path = await freshPath();
    const ownerDevice = await testDevice();
    const log: string[] = [];
    let instance = await start(path, { owner: ownerDevice, env, log });
    const owner = await signIn(instance, ownerDevice);

    const saved = await sealed(instance, owner, 'POST', '/v1/operate/analysis', {
      localUrl: `http://127.0.0.1:${port}/v1`,
      localModel: 'saved-model',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      local: { model: 'saved-model', setIn: 'app', state: 'on' },
    });
    // The log line says where it is set, never what or where the model is.
    const line = log.filter((each) => each.includes('"event":"analysis-model"')).at(-1);
    expect(line).toContain('"setIn":"app"');
    expect(line).not.toContain('saved-model');
    expect(line).not.toContain('127.0.0.1');

    // Closed — the store and the instance — and opened again on the same file.
    await instance.stop();
    running = undefined;
    instance = await start(path, { owner: ownerDevice, env });
    expect(await jobOf(instance, owner.athleteId)).toEqual(SUCCEEDED);
    expect(modelsAsked(model)).toEqual(['saved-model']);

    // Cleared from the app: the next job is the .env line's again.
    const cleared = await sealed(instance, owner, 'DELETE', '/v1/operate/analysis');
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ local: { model: 'env-model', setIn: 'env' } });
    expect(await jobOf(instance, owner.athleteId)).toEqual(SUCCEEDED);
    expect(modelsAsked(model)).toEqual(['saved-model', 'env-model']);
  });

  it('applies a model saved while the instance runs to the next job, and a job already running finishes on its own', async () => {
    const model = await startFakeModelServer([
      { kind: 'tool-calls', calls: [{ name: 'goals', arguments: '{}' }] },
      { kind: 'text', text: 'A steady ride.' },
      { kind: 'text', text: 'A steady ride.' },
    ]);
    servers.push(model);
    // The first turn's lookup of the model server's name waits for the test.
    let resolver: Resolver = () => Promise.resolve(['127.0.0.1']);
    let release: (() => void) | undefined;
    const looked = new Promise<void>((asked) => {
      let first = true;
      resolver = async () => {
        if (first) {
          first = false;
          asked();
          await new Promise<void>((done) => (release = done));
        }
        return ['127.0.0.1'];
      };
    });
    const env = {
      analysisModelUrl: `http://ollama:${model.baseUrl.port}/v1`,
      analysisModel: 'env-model',
    };
    const path = await freshPath();
    const ownerDevice = await testDevice();
    const instance = await start(path, {
      owner: ownerDevice,
      env,
      resolve: (name) => resolver(name),
    });
    const owner = await signIn(instance, ownerDevice);
    const jobs = instance.analysisJobs();
    if (jobs === undefined) throw new Error('no analysis jobs');
    const caller = { athleteId: owner.athleteId } as Caller;

    const first = await jobs.start(caller, jobBody());
    if (!first.ok) throw new Error('not started');
    await looked;
    // Mid-job, the operator names another model: no address, so nothing is looked up.
    const saved = await sealed(instance, owner, 'POST', '/v1/operate/analysis', {
      localModel: 'app-model',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    release?.();
    await jobs.idle();
    const firstEnd = parseStream(
      (await (await jobs.events(caller, first.value.jobId, null))?.text()) ?? '',
    ).events.at(-1)?.data;
    expect(firstEnd).toEqual(SUCCEEDED);
    // Both turns of the running job on the model it started with.
    expect(modelsAsked(model)).toEqual(['env-model', 'env-model']);

    expect(await jobOf(instance, owner.athleteId)).toEqual(SUCCEEDED);
    expect(modelsAsked(model)).toEqual(['env-model', 'env-model', 'app-model']);
  });

  it('refuses at job time a name that resolved to a local address when it was saved and to a public one now', async () => {
    const model = await modelServer('A steady ride.');
    let addresses = ['127.0.0.1'];
    const path = await freshPath();
    const ownerDevice = await testDevice();
    const instance = await start(path, {
      owner: ownerDevice,
      env: {},
      resolve: () => Promise.resolve(addresses),
    });
    const owner = await signIn(instance, ownerDevice);
    const saved = await sealed(instance, owner, 'POST', '/v1/operate/analysis', {
      localUrl: `http://models-box:${model.baseUrl.port}/v1`,
      localModel: 'saved-model',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    addresses = ['8.8.8.8'];
    const end = await jobOf(instance, owner.athleteId);
    expect(end?.status).toBe('failed');
    expect(model.requests).toEqual([]);
  });
});

describe('an instance whose only model is the settings row’s (#2609)', () => {
  it('starts jobs, rather than answering analysis_off, with no .env model and no secret', async () => {
    const model = await modelServer('A steady ride.');
    const path = await freshPath();
    const write = openServingStore(path);
    try {
      await write.registerAthlete(registrationFixture('athlete-a'));
      await write.putAnalysisSetting({
        localUrl: `http://127.0.0.1:${model.baseUrl.port}/v1`,
        localModel: 'row-model',
        reasoningTokens: null,
        offerLocal: null,
        offerHosted: null,
        othersLocal: true,
        updatedAt: 1,
        updatedBy: 'cli',
      });
    } finally {
      await write.close();
    }
    const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '1' }, 1);
    if (!server.ok) throw new Error(server.problems.join(' '));
    running = await startInstance({
      config: testConfig({ registration: 'open' }),
      server: { ...server.config, blobsPath: join(path, '..', 'blobs') },
      version: '0',
      notices: '',
      log: () => undefined,
    });
    await running.opened;
    await running.jobsRecovered;
    expect(await jobOf(running, 'athlete-a')).toEqual(SUCCEEDED);
    expect(modelsAsked(model)).toEqual(['row-model']);
  });
});

describe('the switch for other riders’ analysis covers the local model, off by default (#2609, ADR 0046 D-9)', () => {
  it('refuses another rider’s local job until the operator turns it on, never the operator’s, and says so on the rider’s hosted settings', async () => {
    const model = await modelServer('A steady ride.', 'A steady ride.', 'A steady ride.');
    const env = { analysisModelUrl: `http://ollama:${model.baseUrl.port}/v1`, analysisModel: 'm' };
    const path = await freshPath();
    const ownerDevice = await testDevice();
    const instance = await start(path, { owner: ownerDevice, env });
    const owner = await signIn(instance, ownerDevice);
    const rider = await signIn(instance, await testDevice());
    const offered = async (who: Session) =>
      ((await sealed(instance, who, 'GET', '/v1/analysis/hosted')).body as { offered: unknown })
        .offered;

    // Off on an instance that never set it: refused before a model is called.
    expect(await jobOf(instance, rider.athleteId)).toEqual({ refusedAtStart: 'local_unavailable' });
    expect(model.requests).toEqual([]);
    expect(await offered(rider)).toEqual({ local: false, hosted: true });
    expect(await offered(owner)).toEqual({ local: true, hosted: true });
    // The operator's own job is not the switch's.
    expect(await jobOf(instance, owner.athleteId)).toEqual(SUCCEEDED);

    expect(
      (await sealed(instance, owner, 'POST', '/v1/operate/analysis', { othersLocal: true })).status,
    ).toBe(200);
    expect(await offered(rider)).toEqual({ local: true, hosted: true });
    expect(await jobOf(instance, rider.athleteId)).toEqual(SUCCEEDED);

    // And the local model not offered at all: the operator's job too.
    expect(
      (await sealed(instance, owner, 'POST', '/v1/operate/analysis', { offerLocal: false })).status,
    ).toBe(200);
    expect(await jobOf(instance, owner.athleteId)).toEqual({ refusedAtStart: 'local_unavailable' });
    expect(model.requests).toHaveLength(2);
  });
});

describe('hosted turned off, and no Share mode (#2609, ADR 0046 D-9)', () => {
  /** A fetch standing in for the internet: every request recorded, none answered. */
  function internet() {
    const sent: string[] = [];
    const fetch = ((input: string | URL | Request) => {
      sent.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.reject(new Error('the test has no internet'));
    }) as typeof globalThis.fetch;
    return { sent, fetch };
  }

  it('refuses the operator’s hosted job and test question while hosted is off, with their key, consent and masking list left as they were', async () => {
    const { sent, fetch } = internet();
    const path = await freshPath();
    const ownerDevice = await testDevice();
    const instance = await start(path, { owner: ownerDevice, env: {}, hostedFetch: fetch });
    const owner = await signIn(instance, ownerDevice);
    await modelKeySet(
      { database: path, blobs: join(path, '..', 'blobs') },
      {
        url: HOSTED.href,
        model: 'hosted-model',
        input: 'sk-hosted-0123456789abcdef\n',
        secret: secretText(SECRET_FILL),
        ownerKey: ownerDevice.publicKey,
      },
    );
    const write = openServingStore(path);
    try {
      await write.putHostedConsent({
        athleteId: owner.athleteId,
        origin: HOSTED.origin,
        recordedAt: 1,
      });
      await write.putSyncItem({
        athleteId: owner.athleteId,
        kind: 'masking',
        key: MASKING_ITEM_KEY,
        body: new TextEncoder().encode(JSON.stringify({ words: ['Ann'], zones: [] })),
        digest: '1'.padStart(64, '0'),
        now: 1_790_000_000,
      });
    } finally {
      await write.close();
    }
    expect(
      (await sealed(instance, owner, 'POST', '/v1/operate/analysis', { offerHosted: false }))
        .status,
    ).toBe(200);

    const hostedJob = { ...jobBody(), source: 'instance-hosted', endpoint: HOSTED.origin };
    expect(await jobOf(instance, owner.athleteId, hostedJob)).toEqual({
      refusedAtStart: 'hosted_unavailable',
    });
    const tested = await sealed(instance, owner, 'POST', '/v1/analysis/hosted/test');
    expect(tested.status).toBe(409);
    expect((tested.body as { error: { code: string } }).error.code).toBe('hosted_unavailable');
    expect(sent).toEqual([]);

    // Nothing of the operator's was deleted or withdrawn.
    const read = openServingStore(path);
    try {
      expect(await read.getHostedModelKey()).toMatchObject({ athleteId: owner.athleteId });
      expect(await read.getHostedConsent(owner.athleteId)).toMatchObject({
        origin: HOSTED.origin,
      });
      const masking = await read.getSyncItem(owner.athleteId, 'masking', MASKING_ITEM_KEY);
      expect(masking?.deletedAt).toBeNull();
    } finally {
      await read.close();
    }
  });

  it('refuses a rider with consent and no key of their own, while the operator holds one and hosted is offered', async () => {
    const { sent, fetch } = internet();
    const path = await freshPath();
    const ownerDevice = await testDevice();
    const instance = await start(path, { owner: ownerDevice, env: {}, hostedFetch: fetch });
    await signIn(instance, ownerDevice);
    const rider = await signIn(instance, await testDevice());
    await modelKeySet(
      { database: path, blobs: join(path, '..', 'blobs') },
      {
        url: HOSTED.href,
        model: 'hosted-model',
        input: 'sk-hosted-0123456789abcdef\n',
        secret: secretText(SECRET_FILL),
        ownerKey: ownerDevice.publicKey,
      },
    );
    const consented = await sealed(instance, rider, 'POST', '/v1/analysis/hosted/consent', {
      endpoint: HOSTED.origin,
    });
    expect(consented.status, JSON.stringify(consented.body)).toBe(200);
    expect((consented.body as { offered: unknown }).offered).toEqual({
      local: false,
      hosted: true,
    });

    expect(
      await jobOf(instance, rider.athleteId, {
        ...jobBody(),
        source: 'instance-hosted',
        endpoint: HOSTED.origin,
      }),
    ).toEqual({ status: 'failed', failure: 'hosted_unavailable' });
    expect(sent).toEqual([]);
  });
});

describe('a bot-tactics call on the running instance writes its one line (#2836, ADR 0081 D-5.2)', () => {
  it('logs the prompt, the model and the model server’s figures, and nothing of the race or the answer', async () => {
    const stub = await startOllamaStub({
      chat: (body) => ({
        model: (body as { model?: unknown } | null)?.model,
        message: { role: 'assistant', content: ATTACK },
        done: true,
        ...CHAT_FIGURES,
      }),
    });
    stubs.push(stub);
    const env = {
      analysisModelUrl: `http://127.0.0.1:${String(stub.port)}/v1`,
      analysisModel: 'env-model',
    };
    const ownerDevice = await testDevice();
    const log: string[] = [];
    const instance = await start(await freshPath(), { owner: ownerDevice, env, log });
    const owner = await signIn(instance, ownerDevice);

    const status = (await sealed(instance, owner, 'GET', '/v1/analysis/tactics')).body as {
      instance: string;
      modelAddress: string;
    };
    const consented = await sealed(instance, owner, 'POST', '/v1/analysis/tactics/consent', {
      instance: status.instance,
      modelAddress: status.modelAddress,
    });
    expect(consented.status, JSON.stringify(consented.body)).toBe(200);
    const decided = await sealed(instance, owner, 'POST', '/v1/analysis/tactics/decide', {
      input: TACTICS_INPUT,
    });
    expect(decided).toEqual({
      status: 200,
      body: { reason: 'my-terrain', move: 'attack', effort: 'all-out' },
    });

    const lines = log.filter((each) => each.includes('"event":"tactics-call"'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      event: 'tactics-call',
      prompt: TACTICS_PROMPT_VERSION,
      model: 'env-model',
      state: 'decision',
      ms: expect.any(Number) as number,
      loadMs: 21,
      tokensIn: 1_420,
      tokensOut: 17,
      promptEvalMs: 302,
      evalMs: 456,
    });
    // Whole, through the one redaction: nothing was cut, and nothing of the race or the pick is there.
    expect(lines[0]).not.toContain('[redacted]');
    for (const word of ['attack', 'my-terrain', 'climber', 'cues', 'menu', '127.0.0.1']) {
      expect(lines[0]).not.toContain(word);
    }
  });
});
