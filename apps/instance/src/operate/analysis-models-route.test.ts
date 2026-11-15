// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /v1/operate/analysis/models`, `POST /v1/operate/analysis/check` and
 * `GET /v1/operate/analysis/jobs` (#2610), called through the real listener,
 * sealed, as every caller who might try them. The local server is a stub
 * Ollama answering from the committed fixtures, or the fake model server for
 * the check; a name resolves to its loopback port. What the check logs is
 * read back through the operator log's own route and the store.
 *
 * What the reads and the check do on their own is `analysis/local-server.test.ts`'s
 * and `analysis/tool-check.test.ts`'s.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  startFakeModelServer,
  type FakeModelServer,
} from '../analysis/fake-model-server-testing.ts';
import {
  CURRENT_SERVER,
  startOllamaStub,
  type OllamaStub,
} from '../analysis/ollama-stub-testing.ts';
import { TOOL_CHECK_QUESTION, TOOL_CHECK_SYSTEM } from '../analysis/tool-check.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
  type Rider,
} from '../moderation/moderation-testing.ts';
import { runCommand } from '../operator/run.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import type { OperatorLogEntry, SqlStore } from '../store/sql-store.ts';

const MODELS = '/v1/operate/analysis/models';
const CHECK = '/v1/operate/analysis/check';
const JOBS = '/v1/operate/analysis/jobs';

/** `models-box` is the stub's loopback; `public-box` is somewhere else. */
const resolve = (name: string): Promise<readonly string[]> =>
  name === 'models-box'
    ? Promise.resolve(['127.0.0.1'])
    : name === 'public-box'
      ? Promise.resolve(['8.8.8.8'])
      : Promise.reject(new Error('no such name'));

const wholeLog = (world: ModerationWorld): Promise<readonly OperatorLogEntry[]> =>
  world.freshRead((store) => store.listOperatorLogPage(undefined, 200));

/** Save the local server's address from the app, as the owner would. */
async function pointAt(world: ModerationWorld, url: string): Promise<void> {
  const saved = await world.as(world.owner, 'POST', '/v1/operate/analysis', { localUrl: url });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}

const MARKER = 'MARKER-2610-a-riders-own-words';

/** Two athletes' jobs: the owner's write-up and another rider's re-plan, and a third queued. */
async function seedJobs(world: ModerationWorld, rider: Rider, third: Rider): Promise<void> {
  const now = world.clock.ms;
  const day = 24 * 60 * 60 * 1000;
  await world.freshRead(async (store: SqlStore) => {
    const make = async (
      id: string,
      athleteId: string,
      templateVersion: string,
      source: 'instance-local' | 'instance-hosted',
      createdAt: number,
      ending?: { status: 'succeeded' | 'failed'; failure: string | null; at: number },
    ): Promise<void> => {
      expect(
        await store.createAnalysisJob({
          id,
          athleteId,
          source,
          templateVersion,
          inputJson: JSON.stringify({ note: `${MARKER} in the input of ${id}` }),
          createdAt,
        }),
      ).toBe('created');
      await store.appendAnalysisEvent(athleteId, id, 'progress', `{"note":"${MARKER}"}`, createdAt);
      if (ending !== undefined) {
        await store.endAnalysisJob(athleteId, id, {
          status: ending.status,
          failure: ending.failure,
          candidate: ending.status === 'succeeded' ? `${MARKER} in the write-up of ${id}` : null,
          data: JSON.stringify({ status: ending.status }),
          at: ending.at,
        });
      }
    };
    // Ended eight days ago: listed, and outside the counts' seven days.
    await make('job-old', rider.athleteId, '1', 'instance-local', now - 9 * day, {
      status: 'failed',
      failure: 'model-unreachable',
      at: now - 8 * day,
    });
    await make('job-own', world.owner.athleteId, '1', 'instance-local', now - 3000, {
      status: 'succeeded',
      failure: null,
      at: now - 2000,
    });
    await make('job-other', rider.athleteId, 're-plan-1', 'instance-hosted', now - 1000, {
      status: 'failed',
      failure: 'model-without-tools',
      at: now - 500,
    });
    await make('job-queued', third.athleteId, '1', 'instance-local', now);
  });
}

describe('the #2610 routes are the owner’s, and nobody else’s', () => {
  let world: ModerationWorld;
  let stub: OllamaStub;
  let model: FakeModelServer;
  beforeAll(async () => {
    world = await startModerationWorld({ resolve });
    stub = await startOllamaStub(CURRENT_SERVER);
    model = await startFakeModelServer([]);
    await pointAt(world, `http://models-box:${String(stub.port)}/v1`);
  });
  afterAll(async () => {
    await stub.close();
    await model.close();
    await world.close();
  });

  it('answers the deputy and a rider exactly as no route, for each, and asks, sends and writes nothing', async () => {
    const rider = await world.rider('Rider');
    await seedJobs(world, rider, await world.rider('Third'));
    const nowhere = await world.as(rider, 'GET', '/v1/no-such-route');
    expect(nowhere.status).toBe(404);
    const before = await wholeLog(world);
    const asked = stub.requests.length;
    for (const caller of [world.deputy, rider]) {
      for (const [method, path, body] of [
        ['GET', MODELS, undefined],
        ['POST', CHECK, { model: 'alpha:14b' }],
        ['GET', JOBS, undefined],
      ] as const) {
        const answer = await world.as(caller, method, path, body);
        expect(
          answer,
          `${method} ${path} as ${caller === rider ? 'a rider' : 'the deputy'}`,
        ).toEqual(nowhere);
        expect(codeOf(answer.body)).toBe('not_found');
      }
    }
    // Read back: no entry, no request to the server, no model asked.
    expect(await wholeLog(world)).toEqual(before);
    expect(stub.requests).toHaveLength(asked);
    expect(model.requests).toEqual([]);
  });

  it('lists the local server’s models for the owner, with their tools and GPU fit, and logs nothing', async () => {
    const before = await wholeLog(world);
    const read = await world.as(world.owner, 'GET', MODELS);
    expect(read.status).toBe(200);
    const body = read.body as {
      state: string;
      version: string | null;
      models: { name: string; tools: string; gpu: string; gpuPercent: number | null }[];
    };
    expect(body.state).toBe('ollama');
    expect(body.version).toBe('0.12.6');
    expect(body.models.map((each) => [each.name, each.tools, each.gpu, each.gpuPercent])).toEqual([
      ['alpha:14b', 'listed', 'all', null],
      ['beta:32b', 'listed', 'part', 62],
      ['gamma:26b', 'not-listed', 'not-loaded', null],
    ]);
    expect(JSON.stringify(read.body)).not.toContain('127.0.0.1');
    expect(await wholeLog(world)).toEqual(before);
  });
});

describe('the jobs read names whose a job was, and nothing of it (#2610)', () => {
  it('marks the owner’s job own and another rider’s other, counts the last seven days, and carries no input, event or write-up', async () => {
    const world = await startModerationWorld({ resolve });
    try {
      const rider = await world.rider('Rider');
      const third = await world.rider('Third');
      await seedJobs(world, rider, third);
      const read = await world.as(world.owner, 'GET', JOBS);
      expect(read.status).toBe(200);
      expect(read.body).toEqual({
        counts: { queued: 1, running: 0, succeeded: 1, failed: 1, cancelled: 0, withheld: 0 },
        failures: [{ code: 'model-without-tools', count: 1 }],
        recent: [
          {
            kind: 'write-up',
            source: 'local',
            status: 'queued',
            failure: null,
            createdAt: new Date(world.clock.ms).toISOString(),
            endedAt: null,
            whose: 'other',
          },
          {
            kind: 're-plan',
            source: 'hosted',
            status: 'failed',
            failure: 'model-without-tools',
            createdAt: new Date(world.clock.ms - 1000).toISOString(),
            endedAt: new Date(world.clock.ms - 500).toISOString(),
            whose: 'other',
          },
          {
            kind: 'write-up',
            source: 'local',
            status: 'succeeded',
            failure: null,
            createdAt: new Date(world.clock.ms - 3000).toISOString(),
            endedAt: new Date(world.clock.ms - 2000).toISOString(),
            whose: 'own',
          },
          expect.objectContaining({ status: 'failed', failure: 'model-unreachable' }),
        ],
      });
      const text = JSON.stringify(read.body);
      for (const never of [
        MARKER,
        world.owner.athleteId,
        rider.athleteId,
        third.athleteId,
        'job-own',
        'job-other',
      ]) {
        expect(text).not.toContain(never);
      }
    } finally {
      await world.close();
    }
  });
});

describe('the tool check, through the route (#2610)', () => {
  let model: FakeModelServer | undefined;
  afterEach(async () => {
    await model?.close();
    model = undefined;
  });

  it('answers tools-ok, logs analysis_model_checked, and sent the model nothing but the fixed instruction and tool', async () => {
    const world = await startModerationWorld({ resolve });
    try {
      const rider = await world.rider('Rider');
      await seedJobs(world, rider, await world.rider('Third'));
      model = await startFakeModelServer([
        { kind: 'tool-calls', calls: [{ name: 'fixed_number', arguments: '{}' }] },
        { kind: 'text', text: 'It is 42.' },
      ]);
      await pointAt(world, `http://models-box:${model.baseUrl.port}/v1`);
      const checked = await world.as(world.owner, 'POST', CHECK, { model: 'alpha:14b' });
      expect(checked).toEqual({ status: 200, body: { outcome: 'tools-ok' } });

      expect(model.requests).toHaveLength(2);
      for (const sent of model.requests) {
        const messages = sent.messages as { role: string; content: unknown }[];
        expect(messages.slice(0, 2)).toEqual([
          { role: 'system', content: TOOL_CHECK_SYSTEM },
          { role: 'user', content: TOOL_CHECK_QUESTION },
        ]);
        expect(
          (sent.tools as { function: { name: string } }[]).map((t) => t.function.name),
        ).toEqual(['fixed_number']);
        const text = JSON.stringify(sent);
        for (const never of [MARKER, world.owner.athleteId, 'Owner', world.owner.token]) {
          expect(text).not.toContain(never);
        }
      }

      // Read back through the operator log's own route, and the store.
      const log = await world.as(world.owner, 'GET', '/v1/operate/log');
      const [entry] = (log.body as { entries: Record<string, unknown>[] }).entries;
      expect([entry?.action, entry?.detail, entry?.outcome, entry?.source]).toEqual([
        'analysis_model_checked',
        'tools_ok',
        'done',
        'app',
      ]);
      expect((await wholeLog(world))[0]?.actorAthleteId).toBe(world.owner.athleteId);
      // The model's name is the owner's choice, and is not in the log.
      expect(JSON.stringify(log.body)).not.toContain('alpha');
    } finally {
      await world.close();
    }
  });

  it.each([
    ['no-tool-call', [{ kind: 'text', text: 'Forty-two.' }], 'no_tool_call'],
    [
      'does-not-support-tools',
      [
        {
          kind: 'status',
          status: 400,
          body: '{"error":{"message":"registry.ollama.ai/library/m:latest does not support tools"}}',
        },
      ],
      'does_not_support_tools',
    ],
  ] as const)('answers %s, and logs it', async (outcome, script, word) => {
    const world = await startModerationWorld({ resolve });
    try {
      model = await startFakeModelServer(script);
      await pointAt(world, `http://models-box:${model.baseUrl.port}/v1`);
      expect(await world.as(world.owner, 'POST', CHECK, { model: 'm' })).toEqual({
        status: 200,
        body: { outcome },
      });
      expect((await wholeLog(world))[0]).toMatchObject({
        action: 'analysis_model_checked',
        detail: word,
        outcome: 'done',
      });
    } finally {
      await world.close();
    }
  });

  it('answers no-address with no address set, sending nothing, logged refused; and refuses a body that names no model', async () => {
    const world = await startModerationWorld({ resolve });
    try {
      expect(await world.as(world.owner, 'POST', CHECK, { model: 'm' })).toEqual({
        status: 200,
        body: { outcome: 'no-address' },
      });
      expect((await wholeLog(world))[0]).toMatchObject({
        action: 'analysis_model_checked',
        detail: 'no_address',
        outcome: 'refused',
      });
      const before = await wholeLog(world);
      for (const body of [{}, { model: 'two words' }, { model: 'm', extra: 1 }]) {
        const refused = await world.as(world.owner, 'POST', CHECK, body);
        expect(refused.status).toBe(400);
        expect(codeOf(refused.body)).toBe('validation_failed');
        expect(JSON.stringify(refused.body)).not.toContain('two words');
      }
      expect(await wholeLog(world)).toEqual(before);
    } finally {
      await world.close();
    }
  });

  it('answers 500, and the log holds no outcome, when its entry cannot be written', async () => {
    const world = await startModerationWorld({ resolve });
    try {
      model = await startFakeModelServer([{ kind: 'text', text: 'no tool' }]);
      await pointAt(world, `http://models-box:${model.baseUrl.port}/v1`);
      const before = await wholeLog(world);
      const database = openDatabase(world.path);
      try {
        database.exec(`create trigger operator_log_refused before insert on operator_log
          begin select raise(abort, 'the operator log is full'); end`);
      } finally {
        database.close();
      }
      const answer = await world.as(world.owner, 'POST', CHECK, { model: 'm' });
      expect(answer.status).toBe(500);
      expect(JSON.stringify(answer.body)).not.toContain('no-tool-call');
      expect(await wholeLog(world)).toEqual(before);
    } finally {
      await world.close();
    }
  });
});

describe('the #2610 routes carry no secret the instance holds', () => {
  it('returns none of the secret key, the operator’s hosted key, a rider’s hosted key, a session token, a device key or a resolved address', async () => {
    const world = await startModerationWorld({ resolve });
    const stub = await startOllamaStub(CURRENT_SERVER);
    try {
      const secret = btoa(String.fromCharCode(...secretBytes(7)));
      const operatorKey = 'sk-MARKER-operator-hosted-key-2610';
      const riderKey = 'sk-MARKER-rider-hosted-key-2610';
      const report = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        expect(
          await runCommand(
            ['model-key', 'set', '--url', 'https://models.example/v1', '--model', 'm'],
            {
              database: world.path,
              blobs: `${world.path}.blobs`,
              secret,
              ownerKey: world.owner.device.publicKey,
              readStandardInput: () => Promise.resolve(operatorKey),
            },
          ),
        ).toBe(0);
      } finally {
        report.mockRestore();
      }
      const rider = await world.rider('Rider');
      expect(
        (
          await world.as(rider, 'POST', '/v1/analysis/hosted/key', {
            url: 'https://other.example/v1',
            model: 'm',
            key: riderKey,
          })
        ).status,
      ).toBe(200);
      await seedJobs(world, rider, await world.rider('Third'));
      await pointAt(world, `http://models-box:${String(stub.port)}/v1`);

      const answers = [
        await world.as(world.owner, 'GET', MODELS),
        // The stub answers no chat: the check reaches the server and fails.
        await world.as(world.owner, 'POST', CHECK, { model: 'alpha:14b' }),
        await world.as(world.owner, 'GET', JOBS),
      ];
      expect((answers[1]?.body as { outcome: string }).outcome).toBe('server-error');
      for (const answer of answers) {
        expect(answer.status).toBe(200);
        const body = JSON.stringify(answer.body);
        for (const marker of [
          secret,
          operatorKey,
          riderKey,
          world.owner.token,
          rider.token,
          world.owner.device.publicKey,
          '127.0.0.1',
        ]) {
          expect(body).not.toContain(marker);
        }
      }
    } finally {
      await stub.close();
      await world.close();
    }
  });
});

describe('a name that resolves public is refused at the route, before anything is asked (#2610)', () => {
  it('lists nothing and checks nothing for an address that is no longer local', async () => {
    // Private when saved; public from then on.
    let saved = false;
    const flipping = (name: string): Promise<readonly string[]> =>
      name === 'models-box'
        ? Promise.resolve(saved ? ['8.8.8.8'] : ['127.0.0.1'])
        : Promise.reject(new Error('no such name'));
    const world = await startModerationWorld({ resolve: flipping });
    const stub = await startOllamaStub(CURRENT_SERVER);
    try {
      await pointAt(world, `http://models-box:${String(stub.port)}/v1`);
      saved = true;
      expect(await world.as(world.owner, 'GET', MODELS)).toEqual({
        status: 200,
        body: { state: 'not-local', version: null, models: [] },
      });
      expect(await world.as(world.owner, 'POST', CHECK, { model: 'alpha:14b' })).toEqual({
        status: 200,
        body: { outcome: 'not-local' },
      });
      expect(stub.requests).toEqual([]);
    } finally {
      await stub.close();
      await world.close();
    }
  });
});
