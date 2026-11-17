// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Written through the admin page, read the way a rider's job reads it**
 * (#2648): on the RUNNING instance (`instance.ts`, the real Node listener,
 * `OYL_INSTANCE_ADMIN_PAGES=on`), the owner saves a model through the AI
 * backend page with a fresh passkey, and the next analysis job — started
 * through the real, sealed job route — asks the fake model server (#1096)
 * for THAT model; returned to `.env` through the page, the next job asks
 * for `.env`'s. Not that the settings row changed: that the request reached
 * the new model.
 */

import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODEL_SAVED_TEXT, RETURNED_TEXT, CHECK_TEXT } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it } from 'vitest';

import {
  startFakeModelServer,
  type FakeModelServer,
} from '../analysis/fake-model-server-testing.ts';
import { jobBody } from '../analysis/jobs-testing.ts';
import { TEST_ORIGIN, testDevice, type TestDevice } from '../auth/identity-testing.ts';
import { readAnalysisModelSettings, type AnalysisModelEnv } from '../config.ts';
import type { Handler } from '../handler.ts';
import { escapeHtml } from '../html.ts';
import { startInstance, type StartedInstance } from '../instance.ts';
import { testConfig } from '../instance-testing.ts';
import { sealedAt } from '../sealed/sealed-testing.ts';
import { readServerConfig } from '../server-config.ts';
import { migrateForDeploy } from '../store/serving.ts';
import { adminBrowser, changeOn, passkeySessionOn } from './admin-testing.ts';

let directory: string | undefined;
let running: StartedInstance | undefined;
const servers: FakeModelServer[] = [];
afterEach(async () => {
  await running?.stop();
  running = undefined;
  for (const server of servers.splice(0)) await server.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function start(
  owner: TestDevice,
  env: AnalysisModelEnv,
): Promise<{
  readonly instance: StartedInstance;
  readonly path: string;
}> {
  directory = await mkdtemp(join(tmpdir(), 'oyl-admin-analysis-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  const server = readServerConfig(
    { database: path, origin: TEST_ORIGIN, roomWorkers: '1', adminPages: 'on' },
    1,
  );
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({
      registration: 'open',
      moderators: { owner: owner.publicKey },
      analysis: readAnalysisModelSettings(env),
      analysisEnv: env,
    }),
    resolve: () => Promise.resolve(['127.0.0.1']),
    server: {
      ...server.config,
      blobsPath: join(directory, 'blobs'),
      secretKey: new Uint8Array(32).fill(7),
    },
    version: '0',
    notices: '',
    log: () => undefined,
  });
  await running.opened;
  await running.jobsRecovered;
  await running.keysMaintained;
  return { instance: running, path };
}

/**
 * The running instance as a browser on the tunnel's hostname reaches it:
 * every request sent over HTTP to its listener, `Host` and all, and the
 * answer read back with its `Set-Cookie`.
 */
function overHttp(url: string): Handler {
  return async (request) => {
    const target = new URL(request.url);
    const body = request.method === 'GET' ? undefined : await request.text();
    const headers = Object.fromEntries(request.headers.entries());
    return new Promise<Response>((resolve, reject) => {
      const outgoing = httpRequest(
        `${url}${target.pathname}${target.search}`,
        { method: request.method, headers },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            const answer = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (value !== undefined)
                answer.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            resolve(
              new Response(incoming.statusCode === 303 ? null : Buffer.concat(chunks), {
                status: incoming.statusCode ?? 0,
                headers: answer,
              }),
            );
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  };
}

/** Sign `device` in, sealed, as a device on an instance holding keys must. */
async function signIn(instance: StartedInstance, device: TestDevice): Promise<string> {
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
  return (JSON.parse(session.text) as { sessionToken: string }).sessionToken;
}

/** One write-up, started through the real job route, sealed, and run to its end. */
async function oneJob(instance: StartedInstance, owner: TestDevice, token: string): Promise<void> {
  const started = await sealedAt(instance.url, TEST_ORIGIN, {
    method: 'POST',
    path: '/v1/analysis/jobs',
    token,
    signer: owner.signingKey,
    body: jobBody(),
  });
  expect(started.status, started.text).toBeLessThan(300);
  await instance.analysisJobs()?.idle();
}

describe('a model saved through the admin page is the model the next job asks for (#2648)', () => {
  it('checks and saves a model with a fresh passkey, the next job asks the model server for it, and once returned to .env the next asks for .env’s', async () => {
    const model = await startFakeModelServer([
      // The page's check: the fixed tool, called, then answered.
      { kind: 'tool-calls', calls: [{ name: 'fixed_number', arguments: '{}' }] },
      { kind: 'text', text: 'It is 42.' },
      // A job on the saved model, then one on .env's.
      { kind: 'text', text: 'A steady ride.' },
      { kind: 'text', text: 'A steady ride.' },
    ]);
    servers.push(model);
    const owner = await testDevice();
    const { instance, path } = await start(owner, {
      analysisModelUrl: `http://ollama:${model.baseUrl.port}/v1`,
      analysisModel: 'env-model',
    });
    const token = await signIn(instance, owner);
    const browser = adminBrowser(overHttp(instance.url));
    const session = await passkeySessionOn(
      browser,
      { database: path, blobs: join(path, '..', 'blobs') },
      () => new Date(),
    );
    const asked = (): unknown[] =>
      model.requests
        .filter((_, index) => model.paths[index]?.endsWith('/chat/completions'))
        .map((request) => request.model);

    const checked = await changeOn(browser, session, '/admin/analysis/check', 'analysis_check', {
      model: 'saved-model',
    });
    expect(checked.status).toBe(200);
    expect(await checked.text()).toContain(escapeHtml(CHECK_TEXT['tools-ok']));
    const saved = await changeOn(browser, session, '/admin/analysis/model', 'analysis_model', {
      localModel: 'saved-model',
    });
    expect(saved.status).toBe(200);
    expect(await saved.text()).toContain(escapeHtml(MODEL_SAVED_TEXT));

    await oneJob(instance, owner, token);
    expect(asked()).toEqual(['saved-model', 'saved-model', 'saved-model']);

    const cleared = await changeOn(browser, session, '/admin/analysis/clear', 'analysis_clear', {});
    expect(cleared.status).toBe(200);
    expect(await cleared.text()).toContain(escapeHtml(RETURNED_TEXT));
    await oneJob(instance, owner, token);
    expect(asked()).toEqual(['saved-model', 'saved-model', 'saved-model', 'env-model']);

    // Each change the owner's log shows, from the admin pages through the tunnel.
    const log = await sealedAt(instance.url, TEST_ORIGIN, {
      method: 'GET',
      path: '/v1/operate/log?limit=50',
      token,
      signer: owner.signingKey,
    });
    const entries = (
      JSON.parse(log.text) as {
        entries: { source: string; action: string; detail: string | null }[];
      }
    ).entries
      .filter((entry) => entry.action.startsWith('analysis_'))
      .map(({ source, action, detail }) => [source, action, detail])
      .reverse();
    expect(entries).toEqual([
      ['admin_tunnel', 'analysis_model_checked', 'tools_ok'],
      ['admin_tunnel', 'analysis_settings_set', 'local_model'],
      ['admin_tunnel', 'analysis_settings_cleared', 'cleared'],
    ]);
  });
});
