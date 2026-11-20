// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GET /v1/operate/logs` (#2614): the instance's recent problem lines, read
 * sealed through the real listener. Lines are written the way the instance
 * writes them — `logEvent`, `logUnhandled` and `logRequest` through the
 * handler's own sink — and read back through the route, never off the ring.
 * The restart case runs the production `startInstance` twice on one file.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toHex } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { privateSpellings, secretBytes } from '../keys/instance-keys-testing.ts';
import {
  logEvent,
  logRequest,
  logUnhandled,
  RECENT_PROBLEMS_KEPT,
  REDACTED,
  type LogSink,
} from '../log.ts';
import {
  codeOf,
  startModerationWorld,
  type ModerationWorld,
} from '../moderation/moderation-testing.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy } from '../store/serving.ts';

const LOGS = '/v1/operate/logs';

interface LogsBody {
  readonly since: string;
  readonly lines: readonly { readonly at: string; readonly line: string }[];
}

let opened: ModerationWorld | undefined;
afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

async function world(): Promise<ModerationWorld> {
  opened = await startModerationWorld();
  return opened;
}

async function logsOf(w: ModerationWorld): Promise<LogsBody> {
  const answer = await w.as(w.owner, 'GET', LOGS);
  expect(answer.status).toBe(200);
  return answer.body as LogsBody;
}

/** Each kept line, parsed: what standard output got. */
const parsed = (body: LogsBody): Record<string, unknown>[] =>
  body.lines.map((each) => JSON.parse(each.line) as Record<string, unknown>);

describe('GET /v1/operate/logs — the problem lines, as standard output got them (#2614)', () => {
  it('keeps no coordinate: not one beside an event, and not one in an exception’s message', async () => {
    const w = await world();
    logEvent(w.instance.log, 'room-worker-died', {
      worker: 0,
      lat: 51.50735,
      lon: -0.12776,
      altitude: 35.25,
    });
    logUnhandled(
      w.instance.log,
      '/v1/rooms',
      new Error('the rider at 51.50735,-0.12776 fell over'),
    );
    const body = await logsOf(w);
    expect(parsed(body).map((line) => line.event)).toEqual(['unhandled', 'room-worker-died']);
    // Each line is the one standard output got, word for word.
    for (const each of body.lines) expect(w.instance.lines).toContain(each.line);
    const text = JSON.stringify(body);
    for (const number of ['51.50735', '0.12776', '35.25', '51.5', '-0.1']) {
      expect(text).not.toContain(number);
    }
    expect(parsed(body)[1]).toMatchObject({ lat: REDACTED, lon: REDACTED, altitude: REDACTED });
    expect(parsed(body)[0]).toEqual({ event: 'unhandled', route: '/v1/rooms', error: 'Error' });
  });

  it('keeps no secret: a session token, a hosted key and a display name are each redacted', async () => {
    const w = await world();
    const hostedKey = 'sk-MARKER-hosted-key-2614';
    logEvent(w.instance.log, 'voice-failed', {
      code: 'channel',
      token: w.owner.token,
      sessionToken: w.deputy.token,
      hostedKey,
      displayName: 'Owner',
    });
    const body = await logsOf(w);
    expect(parsed(body)[0]).toEqual({
      event: 'voice-failed',
      code: 'channel',
      token: REDACTED,
      sessionToken: REDACTED,
      hostedKey: REDACTED,
      displayName: REDACTED,
    });
    const markers = [
      w.owner.token,
      w.deputy.token,
      hostedKey,
      'Owner',
      toHex(secretBytes(7)),
      btoa(String.fromCharCode(...secretBytes(7))),
    ];
    for (const row of await w.freshRead((store) => store.listInstanceKeys())) {
      markers.push(...(await privateSpellings(row, secretBytes(7), TEST_ORIGIN)));
    }
    const text = JSON.stringify(body);
    for (const marker of markers) expect(text).not.toContain(marker);
  });

  it(`keeps the newest ${String(RECENT_PROBLEMS_KEPT)}, newest first, and drops the oldest`, async () => {
    const w = await world();
    const written = RECENT_PROBLEMS_KEPT + 5;
    for (let index = 0; index < written; index += 1) {
      w.clock.ms += 1000;
      logRequest(w.instance.log, { method: 'GET', route: '/v1/rooms', status: 503, ms: index });
    }
    const body = await logsOf(w);
    expect(body.lines).toHaveLength(RECENT_PROBLEMS_KEPT);
    const ms = parsed(body).map((line) => line.ms);
    expect(ms[0]).toBe(written - 1);
    expect(ms.at(-1)).toBe(5);
    expect(ms).toEqual([...ms].sort((a, b) => Number(b) - Number(a)));
    // Each with when it was written, newest first.
    expect(body.lines[0]?.at).toBe(new Date(w.clock.ms).toISOString());
  });

  it('keeps no line that is not a problem: a request answered 200, a model that is on', async () => {
    const w = await world();
    logRequest(w.instance.log, { method: 'GET', route: '/v1/rooms', status: 200, ms: 3 });
    logEvent(w.instance.log, 'analysis-model', { state: 'on', setIn: 'env' });
    logEvent(w.instance.log, 'instance-keys', { state: 'ready', made: false });
    logEvent(w.instance.log, 'room-socket-closed', { reason: 'too-slow', count: 1 });
    // Events that are never problems: the instance's own news.
    logEvent(w.instance.log, 'ready', { version: '0' });
    logEvent(w.instance.log, 'voice-swept', { deleted: 2 });
    logEvent(w.instance.log, 'room-socket-closed', { reason: 'room-lost', count: 1 });
    // #2859: an optional model never set is not a problem; one set and not working is.
    logEvent(w.instance.log, 'analysis-model', { state: 'off', code: 'not-set', setIn: 'none' });
    logEvent(w.instance.log, 'analysis-model', { state: 'off', code: 'not-local', setIn: 'env' });
    // The owner's own reads are 200s: none of them is kept either.
    expect(parsed(await logsOf(w))).toEqual([
      { event: 'analysis-model', state: 'off', code: 'not-local', setIn: 'env' },
      { event: 'room-socket-closed', reason: 'room-lost', count: 1 },
    ]);
    expect(parsed(await logsOf(w))).toHaveLength(2);
    // Reading is not an operator action.
    expect(await w.freshRead((store) => store.listOperatorLogPage(undefined, 10))).toEqual([]);
  });

  it('answers the deputy and a rider as no route', async () => {
    const w = await world();
    const rider = await w.rider('Rider');
    for (const caller of [w.deputy, rider]) {
      const nowhere = await w.as(caller, 'GET', '/v1/no-such-route');
      const answer = await w.as(caller, 'GET', LOGS);
      expect(answer.status).toBe(404);
      expect(codeOf(answer.body)).toBe('not_found');
      expect(answer).toEqual(nowhere);
    }
  });
});

describe('the problem lines are memory only — #2614', () => {
  let directory: string | undefined;
  let running: StartedInstance | undefined;
  afterEach(async () => {
    await running?.stop();
    running = undefined;
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function start(path: string, owner: TestDevice, log: LogSink): Promise<StartedInstance> {
    const server = readServerConfig({ database: path, origin: TEST_ORIGIN, roomWorkers: '1' }, 1);
    if (!server.ok) throw new Error(server.problems.join(' '));
    const started = await startInstance({
      config: testConfig({ registration: 'open', moderators: { owner: owner.publicKey } }),
      server: {
        ...server.config,
        blobsPath: join(path, '..', 'blobs'),
        secretKey: new Uint8Array(32).fill(7),
      },
      version: '0',
      notices: '',
      log,
    });
    await started.opened;
    await started.keysMaintained;
    return started;
  }

  async function ownerLogs(instance: StartedInstance, owner: TestDevice): Promise<LogsBody> {
    const challenge = (await (
      await fetch(`${instance.url}/v1/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: owner.publicKey }),
      })
    ).json()) as { nonce: string };
    const session = await sealedAt(instance.url, TEST_ORIGIN, {
      method: 'POST',
      path: '/v1/auth/session',
      body: await owner.statement(challenge.nonce),
      signer: owner.signingKey,
    });
    const token = (JSON.parse(session.text) as { sessionToken: string }).sessionToken;
    const read = await sealedAt(instance.url, TEST_ORIGIN, {
      method: 'GET',
      path: LOGS,
      token,
      signer: owner.signingKey,
    });
    expect(read.status).toBe(200);
    return JSON.parse(read.text) as LogsBody;
  }

  it('is empty of the last process’s lines after a restart, and says since when', async () => {
    directory = await mkdtemp(join(tmpdir(), 'oyl-operate-logs-'));
    const path = join(directory, 'instance.sqlite');
    await migrateForDeploy(path);
    const owner = await testDevice();
    const out: string[] = [];
    const sink: LogSink = (line) => out.push(line);
    running = await start(path, owner, sink);
    logEvent(sink, 'rooms-sweep-failed', { error: 'MarkerError' });
    expect(JSON.stringify(await ownerLogs(running, owner))).toContain('MarkerError');
    await running.stop();
    running = undefined;

    const before = Date.now();
    running = await start(path, owner, sink);
    const started = Date.now();
    // The read comes later than the start, so `since` cannot be the read's clock.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const after = await ownerLogs(running, owner);
    expect(JSON.stringify(after)).not.toContain('MarkerError');
    // Standard output still has it: only the ring was the process's.
    expect(out.join('\n')).toContain('MarkerError');
    expect(Date.parse(after.since)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(after.since)).toBeLessThanOrEqual(started);
  });
});
