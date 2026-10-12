// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One side-camera picture through the instance (#1106): sealed in, shown to a
 * model, answered, and kept nowhere.
 *
 * Every call is made as the app makes it — SEALED, through the real listener
 * over a real database file — and the model is the fake OpenAI-compatible
 * server on loopback, so what a model is sent is read off the wire. The
 * refusals are each called the way they would really arrive: in plaintext, on
 * an instance with no keys, with another rider's key, with a consent naming
 * another service.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  startFakeModelServer,
  type FakeModelServer,
  type ScriptedReply,
} from '../analysis/fake-model-server-testing.ts';
import { MARKER, MARKER_KEY } from '../analysis/hosted-key-testing.ts';
import { createLocalPictureModel } from '../analysis/model.ts';
import type { IdentityInstance } from '../auth/identity-testing.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import { SIDE_POSE_ANSWER_TOKENS, SIDE_POSE_PICTURE_QUESTION } from './hosted-pictures.ts';
import type { PictureConnection, PictureLookRequest } from './picture-model.ts';
import { base64Of, PICTURE_MARKER, pictureWithExif, testPicture } from './picture-testing.ts';
import { SIDE_POSE_PATH } from './routes.ts';
import {
  createSidePose,
  MAXIMUM_SIDE_POSE_ANSWER,
  SIDE_POSE_MODEL_TIMEOUT_MS,
} from './side-pose.ts';

let world: IdentityInstance | undefined;
let model: FakeModelServer | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
  await model?.close();
  model = undefined;
});

const NOBODY = '{"rider":false}';
const HOSTED_URL = 'https://models.example/v1';
const HOSTED_ORIGIN = 'https://models.example';
const PICTURE = testPicture();
const PICTURE_TEXT = base64Of(PICTURE);

/** The fake server as the local picture model: `http://ollama:<port>/v1`, resolved to loopback. */
function localOver(server: FakeModelServer): PictureConnection {
  return createLocalPictureModel({
    settings: {
      baseUrl: new URL(`http://ollama:${server.baseUrl.port}/v1`),
      model: 'sees-pictures',
    },
    resolve: () => Promise.resolve(['127.0.0.1']),
    question: SIDE_POSE_PICTURE_QUESTION,
  });
}

/** The internet, for a hosted picture: every URL and its bearer, answered by the fake server. */
function internet(server: FakeModelServer) {
  const seen: { url: string; authorization: string | null }[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, authorization: new Headers(init?.headers).get('authorization') });
    if (!url.startsWith(`${HOSTED_URL}/`)) return Promise.reject(new Error('another host'));
    return globalThis.fetch(`${server.baseUrl.href}${url.slice(HOSTED_URL.length)}`, init);
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

/** A world of `riders` signed-in riders whose local picture model, and hosted service, is the fake server. */
async function picturesWorld(
  script: readonly ScriptedReply[],
  options: { riders?: number; local?: boolean; keyless?: boolean } = {},
) {
  model = await startFakeModelServer(script);
  const net = internet(model);
  const synced = await syncWorld(options.riders ?? 1, {
    pictures: {
      ...(options.local === false ? {} : { local: localOver(model) }),
      hostedFetch: net.fetch,
    },
    ...(options.keyless === true ? { keyless: true } : {}),
  });
  world = synced.world;
  return { world: synced.world, riders: synced.riders, model, net };
}

const local = (picture = PICTURE_TEXT) => ({ picture, source: 'instance-local' });
const hosted = (endpoint: string = HOSTED_ORIGIN) => ({
  picture: PICTURE_TEXT,
  source: 'instance-hosted',
  endpoint,
});

function codeOf(answer: { body: unknown }): string | undefined {
  return (answer.body as { error?: { code?: string } } | null)?.error?.code;
}

/** The one user message a picture request carries, as the model server received it. */
function sentTo(server: FakeModelServer, index = 0) {
  const body = server.requests[index] ?? {};
  const messages = body.messages as { role: string; content: unknown }[];
  return { body, messages };
}

describe('a side-camera picture, shown to the instance’s own model (#1106)', () => {
  it('sends the model the picture and the one fixed question, and answers what it said', async () => {
    const { world, riders, model } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const answer = await world.call('POST', SIDE_POSE_PATH, {
      token: riders[0]!.token,
      body: local(),
    });
    expect(answer).toStrictEqual({ status: 200, body: { answer: NOBODY } });

    const { body, messages } = sentTo(model);
    expect(model.paths).toStrictEqual(['/v1/chat/completions']);
    expect(body.model).toBe('sees-pictures');
    expect(body.max_tokens).toBe(SIDE_POSE_ANSWER_TOKENS);
    // One user message: the question, then the picture as a data URL of the bytes sent.
    expect(messages).toStrictEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: SIDE_POSE_PICTURE_QUESTION.question },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PICTURE_TEXT}` } },
        ],
      },
    ]);
    // No tool, and nothing that says whose picture it is.
    expect(body.tools).toBeUndefined();
    const wire = JSON.stringify(body);
    expect(wire).not.toContain(riders[0]!.athleteId);
    expect(wire).not.toContain(riders[0]!.token);
  });

  it('keeps the picture nowhere: not in the database, not in a blob, not in a log line', async () => {
    const { world, riders } = await picturesWorld([
      { kind: 'text', text: NOBODY },
      { kind: 'status', status: 500, body: `{"error":{"message":"echo ${PICTURE_MARKER}"}}` },
    ]);
    const token = riders[0]!.token;
    expect((await world.call('POST', SIDE_POSE_PATH, { token, body: local() })).status).toBe(200);
    // And one the model failed on, whose error text quotes what it was sent.
    const failed = await world.call('POST', SIDE_POSE_PATH, { token, body: local() });
    expect(codeOf(failed)).toBe('picture_model_failed');
    expect(JSON.stringify(failed.body)).not.toContain(PICTURE_MARKER);

    const disk = await world.databaseBytes();
    // The control: the search finds what IS on disk.
    expect(disk).toContain(riders[0]!.athleteId);
    for (const needle of [PICTURE_MARKER, PICTURE_TEXT.slice(0, 48), PICTURE_TEXT.slice(-48)]) {
      expect(disk).not.toContain(needle);
      expect(world.instance.lines.join('\n')).not.toContain(needle);
    }
    expect(world.blobs.size).toBe(0);
    // The log has a line for each request, and each is the sealed envelope's: no route of the picture's.
    expect(world.instance.lines.length).toBeGreaterThan(0);
    expect(world.instance.lines.join('\n')).not.toContain('camera');
  });

  it('is refused in plaintext before anything is read, and the model is never asked', async () => {
    const { world, riders, model } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const plain = await world.call('POST', SIDE_POSE_PATH, {
      token: riders[0]!.token,
      body: local(),
      plain: true,
    });
    expect(plain.status).toBe(403);
    expect(codeOf(plain)).toBe('sealed_required');
    expect(model.requests).toHaveLength(0);
  });

  it('is refused on an instance that holds no keys, which answers its other sealed routes in plaintext', async () => {
    const { world, riders, model } = await picturesWorld([{ kind: 'text', text: NOBODY }], {
      keyless: true,
    });
    const token = riders[0]!.token;
    // The control: this instance DOES answer another sealed route unsealed.
    expect((await world.call('GET', '/v1/analysis/hosted', { token })).status).toBe(200);
    const refused = await world.call('POST', SIDE_POSE_PATH, { token, body: local() });
    expect(refused.status).toBe(403);
    expect(codeOf(refused)).toBe('sealed_required');
    expect(model.requests).toHaveLength(0);
  });

  it('needs a signed-in device', async () => {
    const { world, riders, model } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const refused = await world.call('POST', SIDE_POSE_PATH, {
      body: local(),
      signer: riders[0]!.device,
    });
    expect(refused.status).toBe(401);
    expect(model.requests).toHaveLength(0);
  });

  it.each([
    ['a picture that is not a JPEG', local('AAAA'), 'picture'],
    ['a picture carrying Exif', local(base64Of(pictureWithExif())), 'picture'],
    ['a picture over 64 KiB', local(base64Of(testPicture([], 64 * 1024 + 1))), 'picture'],
    ['no picture', { source: 'instance-local' }, 'picture'],
    ['a source it does not have', { picture: PICTURE_TEXT, source: 'computer' }, 'source'],
    ['a field it does not have', { ...local(), athleteId: 'someone' }, 'athleteId'],
    ['an endpoint beside the local model', { ...local(), endpoint: HOSTED_ORIGIN }, 'endpoint'],
    [
      'the hosted source with no endpoint',
      { picture: PICTURE_TEXT, source: 'instance-hosted' },
      'endpoint',
    ],
  ])('refuses %s, naming the field, and asks no model', async (_name, body, field) => {
    const { world, riders, model } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const refused = await world.call('POST', SIDE_POSE_PATH, { token: riders[0]!.token, body });
    expect(refused.status).toBe(400);
    expect(codeOf(refused)).toBe('validation_failed');
    const fields = (refused.body as { error: { fields: { field: string }[] } }).error.fields;
    expect(fields.map((each) => each.field)).toStrictEqual([field]);
    expect(JSON.stringify(refused.body)).not.toContain(PICTURE_MARKER);
    // Nothing of the picture is said back: not its text, whole or in part.
    const sent = (body as { picture?: unknown }).picture;
    if (typeof sent === 'string') {
      expect(JSON.stringify(refused.body)).not.toContain(sent.slice(0, 16));
    }
    expect(model.requests).toHaveLength(0);
  });

  it('says so when the operator named no model for pictures', async () => {
    const { world, riders, model } = await picturesWorld([], { local: false });
    const refused = await world.call('POST', SIDE_POSE_PATH, {
      token: riders[0]!.token,
      body: local(),
    });
    expect(refused.status).toBe(503);
    expect(codeOf(refused)).toBe('pictures_off');
    expect(model.requests).toHaveLength(0);
  });

  it('says a model takes no pictures when the server said so, and never repeats the server’s words', async () => {
    const { world, riders } = await picturesWorld([
      {
        kind: 'status',
        status: 400,
        body: `{"error":{"message":"unknown variant \`image_url\`, expected \`text\` ${PICTURE_MARKER}"}}`,
      },
      { kind: 'status', status: 400, body: '{"error":{"message":"max_tokens is too large"}}' },
      { kind: 'status', status: 401, body: '{"error":{"message":"no image for you"}}' },
    ]);
    const token = riders[0]!.token;
    const without = await world.call('POST', SIDE_POSE_PATH, { token, body: local() });
    expect(without.status).toBe(422);
    expect(codeOf(without)).toBe('model_without_pictures');
    expect(JSON.stringify(without.body)).not.toContain('image_url');
    expect(JSON.stringify(without.body)).not.toContain(PICTURE_MARKER);
    // Another refusal of the request's shape, and a refusal that is not of its shape.
    for (let other400 = 0; other400 < 2; other400 += 1) {
      const other = await world.call('POST', SIDE_POSE_PATH, { token, body: local() });
      expect(other.status).toBe(502);
      expect(codeOf(other)).toBe('picture_model_failed');
    }
  });

  it('does not pass on an answer longer than a pose could be', async () => {
    const { world, riders } = await picturesWorld([
      { kind: 'text', text: 'x'.repeat(MAXIMUM_SIDE_POSE_ANSWER + 1) },
      { kind: 'text', text: 'x'.repeat(MAXIMUM_SIDE_POSE_ANSWER) },
    ]);
    const token = riders[0]!.token;
    expect(codeOf(await world.call('POST', SIDE_POSE_PATH, { token, body: local() }))).toBe(
      'picture_model_failed',
    );
    expect((await world.call('POST', SIDE_POSE_PATH, { token, body: local() })).status).toBe(200);
  });

  it('takes one picture of a rider at a time, and another rider’s meanwhile', async () => {
    const { world, riders, model } = await picturesWorld(
      [
        { kind: 'slow', milliseconds: 400, then: { kind: 'text', text: NOBODY } },
        { kind: 'text', text: NOBODY },
        { kind: 'text', text: NOBODY },
      ],
      { riders: 2 },
    );
    const [a, b] = riders;
    const first = world.call('POST', SIDE_POSE_PATH, { token: a!.token, body: local() });
    // Wait until the first is with the model.
    while (model.paths.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await world.call('POST', SIDE_POSE_PATH, { token: a!.token, body: local() });
    expect(second.status).toBe(429);
    expect(codeOf(second)).toBe('rate_limited');
    // Another rider is not held up by it.
    expect(
      (await world.call('POST', SIDE_POSE_PATH, { token: b!.token, body: local() })).status,
    ).toBe(200);
    expect((await first).status).toBe(200);
    // And once it is done, the first rider's next picture is taken.
    expect(
      (await world.call('POST', SIDE_POSE_PATH, { token: a!.token, body: local() })).status,
    ).toBe(200);
    expect(model.requests).toHaveLength(3);
  });
});

describe('a side-camera picture, shown to a hosted model on the rider’s own key (#1106, ruling 3)', () => {
  const KEY_BODY = { url: HOSTED_URL, model: 'hosted-sees', key: MARKER_KEY };

  it('goes to the service the key is for when the consent names it, carrying the picture, the question and nothing else', async () => {
    const { world, riders, model, net } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const { token, athleteId } = riders[0]!;
    await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    const answer = await world.call('POST', SIDE_POSE_PATH, { token, body: hosted() });
    expect(answer).toStrictEqual({ status: 200, body: { answer: NOBODY } });

    // One request, to the key's host, with the rider's key as its bearer.
    expect(net.seen).toStrictEqual([
      { url: `${HOSTED_URL}/chat/completions`, authorization: `Bearer ${MARKER_KEY}` },
    ]);
    const { body, messages } = sentTo(model);
    // Exactly these keys: a model, the one message, a token bound.
    expect(Object.keys(body).sort()).toStrictEqual(['max_tokens', 'messages', 'model']);
    expect(body.model).toBe('hosted-sees');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toStrictEqual([
      { type: 'text', text: SIDE_POSE_PICTURE_QUESTION.question },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PICTURE_TEXT}` } },
    ]);
    const wire = JSON.stringify(body);
    expect(wire).not.toContain(athleteId);
    expect(wire).not.toContain(token);
    expect(wire).not.toContain(MARKER);
  });

  it('is its own consent: the write-up’s recorded consent neither stands in for it nor is needed', async () => {
    const { world, riders, net } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const { token } = riders[0]!;
    await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    // The write-up's consent is recorded, and no picture consent is sent.
    await world.call('POST', '/v1/analysis/hosted/consent', {
      token,
      body: { endpoint: HOSTED_URL },
    });
    const without = await world.call('POST', SIDE_POSE_PATH, {
      token,
      body: { picture: PICTURE_TEXT, source: 'instance-hosted' },
    });
    expect(codeOf(without)).toBe('validation_failed');
    expect(net.seen).toHaveLength(0);
    // The write-up's consent is withdrawn, and the picture consent is sent: it goes.
    await world.call('DELETE', '/v1/analysis/hosted/consent', { token });
    expect((await world.call('POST', SIDE_POSE_PATH, { token, body: hosted() })).status).toBe(200);
  });

  it.each([
    ['another service', 'https://other.example'],
    ['the same host on another port', 'https://models.example:8443'],
    ['an http: address', 'http://models.example'],
    ['no service at all', 'not a url'],
  ])('sends nothing when the consent names %s', async (_name, endpoint) => {
    const { world, riders, net } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const { token } = riders[0]!;
    await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    const refused = await world.call('POST', SIDE_POSE_PATH, { token, body: hosted(endpoint) });
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe('picture_source_unavailable');
    expect(net.seen).toHaveLength(0);
  });

  it('accepts the consent as a URL under the same origin as the key', async () => {
    const { world, riders } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    const { token } = riders[0]!;
    await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    expect(
      (await world.call('POST', SIDE_POSE_PATH, { token, body: hosted(`${HOSTED_ORIGIN}/`) }))
        .status,
    ).toBe(200);
  });

  it('never uses another rider’s key: a rider with none is refused, whoever else holds one', async () => {
    const { world, riders, net } = await picturesWorld([{ kind: 'text', text: NOBODY }], {
      riders: 2,
    });
    const [a, b] = riders;
    await world.call('POST', '/v1/analysis/hosted/key', { token: a!.token, body: KEY_BODY });
    const refused = await world.call('POST', SIDE_POSE_PATH, { token: b!.token, body: hosted() });
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe('picture_source_unavailable');
    expect(net.seen).toHaveLength(0);
    // The control: the rider whose key it is, is served.
    expect(
      (await world.call('POST', SIDE_POSE_PATH, { token: a!.token, body: hosted() })).status,
    ).toBe(200);
  });

  it('never falls back to the instance’s own model when the hosted one cannot be used', async () => {
    const { world, riders, model } = await picturesWorld([{ kind: 'text', text: NOBODY }]);
    // A local model IS configured; the rider holds no key and asked for the hosted one.
    const refused = await world.call('POST', SIDE_POSE_PATH, {
      token: riders[0]!.token,
      body: hosted(),
    });
    expect(codeOf(refused)).toBe('picture_source_unavailable');
    expect(model.requests).toHaveLength(0);
  });
});

describe('the look itself (#1106)', () => {
  const caller = { athleteId: 'a1' } as Parameters<ReturnType<typeof createSidePose>['look']>[0];

  it('refuses a held key that is another athlete’s, whatever handed it over', async () => {
    let built = 0;
    const pose = createSidePose({
      local: undefined,
      // A key lookup that answers with somebody else's key: the look checks whose it is itself.
      hostedKey: () =>
        Promise.resolve({
          kind: 'held',
          athleteId: 'somebody-else',
          url: HOSTED_URL,
          model: 'm',
          key: MARKER_KEY,
        }),
      hosted: () => {
        built += 1;
        return { look: () => Promise.resolve({ ok: true, text: NOBODY }) };
      },
    });
    expect(await pose.look(caller, hosted(), new AbortController().signal)).toStrictEqual({
      ok: false,
      code: 'picture_source_unavailable',
    });
    expect(built).toBe(0);
  });

  it('gives the model the time it is allowed and the request’s own signal, and drops the picture’s athlete when it throws', async () => {
    const asked: PictureLookRequest[] = [];
    let fail = true;
    const pose = createSidePose({
      local: {
        look: (request) => {
          asked.push(request);
          if (fail) return Promise.reject(new Error('the connection threw'));
          return Promise.resolve({ ok: true, text: NOBODY });
        },
      },
      hostedKey: () => Promise.resolve({ kind: 'none' }),
      hosted: () => {
        throw new Error('not asked for');
      },
    });
    const signal = new AbortController().signal;
    await expect(pose.look(caller, local(), signal)).rejects.toThrow('the connection threw');
    // The athlete is not left marked as having a picture with the model.
    fail = false;
    expect(await pose.look(caller, local(), signal)).toStrictEqual({
      ok: true,
      value: { answer: NOBODY },
    });
    expect(asked[1]!.timeoutMilliseconds).toBe(SIDE_POSE_MODEL_TIMEOUT_MS);
    expect(asked[1]!.signal).toBe(signal);
    expect(asked[1]!.picture).toStrictEqual(PICTURE);
  });
});
