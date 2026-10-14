// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A rider's own hosted model key and hosted consent over HTTP (#1199, ADR
 * 0046 D-9 as the owner ruled it on 2026-10-09: bring-your-own keys only).
 *
 * Every route is called SEALED, as the app calls it (`IdentityInstance.call`),
 * through the real listener over a real database file; and each is called in
 * plaintext once to show the edge cannot reach it. What a rider stored is
 * read back through the same route, and through a fresh store.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { testDevice, type IdentityInstance } from '../auth/identity-testing.ts';
import { authorised, syncWorld } from '../sync/sync-testing.ts';
import {
  startFakeModelServer,
  type FakeModelServer,
  type ScriptedReply,
} from './fake-model-server-testing.ts';
import { MARKER, MARKER_KEY } from './hosted-key-testing.ts';
import { HOSTED_KEY_NEEDS_SECRET, type HostedStatus } from './hosted-settings.ts';
import {
  HOSTED_TEST_ANSWER_TOKENS,
  HOSTED_TEST_QUESTION,
  HOSTED_TEST_SYSTEM,
} from './hosted-test.ts';
import { MASKING_ITEM_KEY } from './hosted.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const KEY_BODY = { url: 'https://models.example/v1', model: 'a-model', key: MARKER_KEY };

async function rider(w: IdentityInstance) {
  const device = await testDevice();
  const session = await w.signIn(device);
  return {
    device,
    token: session.body.sessionToken as string,
    athleteId: session.body.athleteId as string,
  };
}

describe('a rider’s own hosted key (#1199)', () => {
  it('is stored sealed, read back without the key, and never written in clear', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token, athleteId } = synced.riders[0]!;
    world.clock.ms = 1_790_000_123_000;

    const set = await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const expected: HostedStatus = {
      key: {
        url: KEY_BODY.url,
        model: 'a-model',
        setAt: 1_790_000_123,
        reasoningTokens: null,
        setBy: 'app',
      },
      consent: null,
    };
    expect(set.body).toEqual(expected);
    expect(await world.call('GET', '/v1/analysis/hosted', { token })).toEqual({
      status: 200,
      body: expected,
    });
    // A fresh store reads the sealed row: ciphertext, and the key nowhere on disk.
    const row = await world.freshRead((store) => store.getAthleteHostedKey(athleteId));
    expect(row?.ciphertext.byteLength).toBeGreaterThan(0);
    expect(await world.databaseBytes()).not.toContain(MARKER);
  });

  it('keeps what the rider says their model needs to reason, replaces it with the next key, and reads it back from a fresh store (#1268)', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token, athleteId } = synced.riders[0]!;
    const set = await world.call('POST', '/v1/analysis/hosted/key', {
      token,
      body: { ...KEY_BODY, reasoningTokens: 2_048 },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((set.body as HostedStatus).key?.reasoningTokens).toBe(2_048);
    expect(
      ((await world.call('GET', '/v1/analysis/hosted', { token })).body as HostedStatus).key
        ?.reasoningTokens,
    ).toBe(2_048);
    const row = await world.freshRead((store) => store.getAthleteHostedKey(athleteId));
    expect(row?.reasoningTokens).toBe(2_048);
    // The next key says nothing: the figure is not carried over.
    await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    const again = await world.freshRead((store) => store.getAthleteHostedKey(athleteId));
    expect(again?.reasoningTokens).toBeUndefined();
    const nulled = await world.call('POST', '/v1/analysis/hosted/key', {
      token,
      body: { ...KEY_BODY, reasoningTokens: null },
    });
    expect((nulled.body as HostedStatus).key?.reasoningTokens).toBeNull();
  });

  it.each([0, -1, 1.5, 16_385, '2048', true])(
    'refuses reasoningTokens %j, naming the field, and stores nothing (#1268)',
    async (bad) => {
      const synced = await syncWorld(1);
      world = synced.world;
      const { token, athleteId } = synced.riders[0]!;
      const refused = await world.call('POST', '/v1/analysis/hosted/key', {
        token,
        body: { ...KEY_BODY, reasoningTokens: bad },
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('reasoningTokens');
      expect(JSON.stringify(refused.body)).not.toContain(MARKER);
      expect(
        await world.freshRead((store) => store.getAthleteHostedKey(athleteId)),
      ).toBeUndefined();
    },
  );

  it('is the caller’s alone: another rider reads nothing, and clearing theirs leaves it', async () => {
    const synced = await syncWorld(2);
    world = synced.world;
    const [a, b] = synced.riders;
    await world.call('POST', '/v1/analysis/hosted/key', { token: a!.token, body: KEY_BODY });
    expect(await world.call('GET', '/v1/analysis/hosted', { token: b!.token })).toEqual({
      status: 200,
      body: { key: null, consent: null },
    });
    const cleared = await world.call('DELETE', '/v1/analysis/hosted/key', { token: b!.token });
    expect(cleared.body).toEqual({ key: null, consent: null });
    expect(
      ((await world.call('GET', '/v1/analysis/hosted', { token: a!.token })).body as HostedStatus)
        .key,
    ).not.toBeNull();
  });

  it('clears the key the rider stored, and never the operator’s one key', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token, athleteId } = synced.riders[0]!;
    await world.freshRead((store) =>
      store.putHostedModelKey(athleteId, {
        url: 'https://operator.example/v1',
        model: 'operators',
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array([1]),
        setAt: 5,
      }),
    );
    // The operator's key, on the operator's own account, is theirs to read about.
    expect(
      ((await world.call('GET', '/v1/analysis/hosted', { token })).body as HostedStatus).key,
    ).toEqual({
      url: 'https://operator.example/v1',
      model: 'operators',
      setAt: 5,
      reasoningTokens: null,
      setBy: 'operator-command',
    });
    await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    expect(
      ((await world.call('GET', '/v1/analysis/hosted', { token })).body as HostedStatus).key?.setBy,
    ).toBe('app');
    const cleared = await world.call('DELETE', '/v1/analysis/hosted/key', { token });
    expect((cleared.body as HostedStatus).key?.setBy).toBe('operator-command');
    expect(await world.freshRead((store) => store.getHostedModelKey())).toBeDefined();
  });

  it.each([
    ['an http: URL', { ...KEY_BODY, url: 'http://models.example/v1' }, 'url'],
    ['a URL with a password', { ...KEY_BODY, url: 'https://u:p@models.example/v1' }, 'url'],
    ['a model with a space', { ...KEY_BODY, model: 'a model' }, 'model'],
    ['a key with a space', { ...KEY_BODY, key: `${MARKER_KEY} more` }, 'key'],
    ['a key that is not a string', { ...KEY_BODY, key: 7 }, 'key'],
    ['a field it does not know', { ...KEY_BODY, shared: true }, 'shared'],
  ])('refuses %s, stores nothing, and never echoes the key', async (_why, body, field) => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token, athleteId } = synced.riders[0]!;
    const answer = await world.call('POST', '/v1/analysis/hosted/key', { token, body });
    expect(answer.status).toBe(400);
    const error = (answer.body as { error: { code: string; fields: { field: string }[] } }).error;
    expect(error.code).toBe('validation_failed');
    expect(error.fields.map((each) => each.field)).toContain(field);
    expect(JSON.stringify(answer.body)).not.toContain(MARKER);
    expect(await world.freshRead((store) => store.getAthleteHostedKey(athleteId))).toBeUndefined();
  });

  it('is refused unavailable, before the key is read, on an instance with no secret', async () => {
    world = (await syncWorld(0, { keyless: true })).world;
    const { token, athleteId } = await rider(world);
    const answer = await world.call('POST', '/v1/analysis/hosted/key', {
      token,
      // Not even a valid body: the secret is checked first.
      body: { ...KEY_BODY, url: 'not a url' },
    });
    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({
      error: { code: 'unavailable', message: HOSTED_KEY_NEEDS_SECRET },
    });
    expect(await world.freshRead((store) => store.getAthleteHostedKey(athleteId))).toBeUndefined();
  });
});

describe('a rider’s own hosted consent (#1199, ADR 0046 Q10)', () => {
  it('names the ORIGIN of the endpoint given, and is withdrawn on request', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    world.clock.ms = 1_790_000_456_000;
    const recorded = await world.call('POST', '/v1/analysis/hosted/consent', {
      token,
      body: { endpoint: 'https://Models.Example/v1/chat/' },
    });
    expect(recorded).toEqual({
      status: 200,
      body: { key: null, consent: { origin: 'https://models.example', recordedAt: 1_790_000_456 } },
    });
    const withdrawn = await world.call('DELETE', '/v1/analysis/hosted/consent', { token });
    expect(withdrawn.body).toEqual({ key: null, consent: null });
  });

  it('survives a key rotated at the same origin, and is withdrawn by a key at another', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token } = synced.riders[0]!;
    await world.call('POST', '/v1/analysis/hosted/consent', {
      token,
      body: { endpoint: 'https://models.example' },
    });
    const rotated = await world.call('POST', '/v1/analysis/hosted/key', {
      token,
      body: { ...KEY_BODY, url: 'https://models.example/v2', key: 'sk-rotated' },
    });
    expect((rotated.body as HostedStatus).consent?.origin).toBe('https://models.example');
    const moved = await world.call('POST', '/v1/analysis/hosted/key', {
      token,
      body: { ...KEY_BODY, url: 'https://elsewhere.example/v1' },
    });
    expect((moved.body as HostedStatus).consent).toBeNull();
  });

  it.each([
    ['not a URL', { endpoint: 'models.example' }],
    ['http:', { endpoint: 'http://models.example' }],
    ['missing', {}],
  ])('refuses an endpoint that is %s', async (_why, body) => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token, athleteId } = synced.riders[0]!;
    const answer = await world.call('POST', '/v1/analysis/hosted/consent', { token, body });
    expect(answer.status).toBe(400);
    expect(await world.freshRead((store) => store.getHostedConsent(athleteId))).toBeUndefined();
  });
});

describe('sealed only (ADR 0047 D-7, D-13)', () => {
  it.each([
    ['GET', '/v1/analysis/hosted', undefined],
    ['POST', '/v1/analysis/hosted/key', KEY_BODY],
    ['DELETE', '/v1/analysis/hosted/key', undefined],
    ['POST', '/v1/analysis/hosted/consent', { endpoint: 'https://models.example' }],
    ['DELETE', '/v1/analysis/hosted/consent', undefined],
    ['POST', '/v1/analysis/hosted/test', undefined],
  ] as const)('refuses %s %s in plaintext, and stores nothing', async (method, path, body) => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token, athleteId } = synced.riders[0]!;
    const answer = await world.call(method, path, {
      token,
      plain: true,
      ...(body === undefined ? {} : { body }),
    });
    expect(answer.status).toBe(403);
    expect((answer.body as { error: { code: string } }).error.code).toBe('sealed_required');
    expect(await world.freshRead((store) => store.getAthleteHostedKey(athleteId))).toBeUndefined();
    expect(await world.freshRead((store) => store.getHostedConsent(athleteId))).toBeUndefined();
  });
});

describe('exported and erased with the account (#1199, #35)', () => {
  it('exports that a key is held and the consent, never the key; erasure takes both', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const { token, athleteId, recoveryCodes } = synced.riders[0]!;
    await world.call('POST', '/v1/analysis/hosted/key', { token, body: KEY_BODY });
    await world.call('POST', '/v1/analysis/hosted/consent', {
      token,
      body: { endpoint: 'https://models.example' },
    });

    const exported = await authorised(world, token, 'GET', '/v1/account/export');
    const text = await exported.text();
    expect(exported.status, text).toBe(200);
    const body = JSON.parse(text) as { hostedModelKey: unknown; hostedConsent: unknown };
    expect(body.hostedModelKey).toBe('a hosted model key is held');
    expect(body.hostedConsent).toMatchObject({ origin: 'https://models.example' });
    expect(text).not.toContain(MARKER);

    const erased = await authorised(world, token, 'DELETE', '/v1/account', {
      recoveryCode: recoveryCodes[0],
    });
    expect(erased.status, await erased.clone().text()).toBeLessThan(300);
    expect(await world.freshRead((store) => store.getAthleteHostedKey(athleteId))).toBeUndefined();
    expect(await world.freshRead((store) => store.getHostedConsent(athleteId))).toBeUndefined();
  });

  it('exports null consent for an athlete with none', async () => {
    const synced = await syncWorld(1);
    world = synced.world;
    const exported = await authorised(world, synced.riders[0]!.token, 'GET', '/v1/account/export');
    expect(((await exported.json()) as { hostedConsent: unknown }).hostedConsent).toBeNull();
  });
});

describe('the test question (#1251, #1104 B1 question 2)', () => {
  const ENDPOINT = 'https://models.example';
  /** A word the rider asked to have masked: it must be in nothing the service is sent. */
  const RIDER_WORD = 'Zennor';
  let model: FakeModelServer | undefined;
  afterEach(async () => {
    await model?.close();
    model = undefined;
  });

  /**
   * One rider on an instance whose hosted requests reach a scripted model
   * server in place of the internet, with whichever of the key, the consent
   * and the masking item the case names — each stored through its own sealed
   * route, as the app stores it.
   */
  async function ready(
    script: ScriptedReply[],
    has: {
      readonly key?: Readonly<Record<string, unknown>> | false;
      readonly consent?: string | false;
      readonly masking?: boolean;
      /** Each request reaches the service only once this resolves (#1311). */
      readonly hold?: Promise<void>;
    } = {},
  ) {
    const started = await startFakeModelServer(script);
    model = started;
    const sent: { url: string; authorization: string | null; body: string }[] = [];
    let reached: () => void = () => undefined;
    /** Resolves once the first request has been handed to the service. */
    const firstSent = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const base = KEY_BODY.url.replace(/\/+$/, '');
    const hostedFetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      sent.push({
        url,
        authorization: new Headers(init?.headers).get('authorization'),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      reached();
      if (!url.startsWith(`${base}/`)) return Promise.reject(new Error('another host'));
      const forward = () =>
        globalThis.fetch(`${started.baseUrl.href}${url.slice(base.length)}`, init);
      return has.hold === undefined ? forward() : has.hold.then(forward);
    }) as typeof globalThis.fetch;
    const synced = await syncWorld(2, { hostedFetch });
    world = synced.world;
    const [rider, other] = synced.riders;
    const token = rider!.token;
    if (has.key !== false) {
      const set = await world.call('POST', '/v1/analysis/hosted/key', {
        token,
        body: has.key ?? KEY_BODY,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    }
    if (has.consent !== false) {
      await world.call('POST', '/v1/analysis/hosted/consent', {
        token,
        body: { endpoint: has.consent ?? ENDPOINT },
      });
    }
    if (has.masking !== false) {
      const put = await world.call('POST', `/v1/sync/items/masking/${MASKING_ITEM_KEY}`, {
        token,
        body: { body: JSON.stringify({ words: [RIDER_WORD], zones: [] }) },
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
    }
    const ask = (as = token) => world!.call('POST', '/v1/analysis/hosted/test', { token: as });
    return { ask, sent, firstSent, rider: rider!, other: other!, requests: started.requests };
  }

  it('sends the two fixed sentences on the rider’s own key, and nothing of the rider’s', async () => {
    const { ask, sent, rider, requests } = await ready([{ kind: 'text', text: 'ready' }]);
    expect(await ask()).toEqual({ status: 200, body: { result: 'answered', reasoned: false } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${KEY_BODY.url}/chat/completions`);
    expect(sent[0]?.authorization).toBe(`Bearer ${MARKER_KEY}`);
    expect(requests).toHaveLength(1);
    const request = requests[0] as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: unknown }[];
      tools?: unknown;
    };
    expect(request.model).toBe('a-model');
    expect(request.max_tokens).toBe(HOSTED_TEST_ANSWER_TOKENS);
    expect(request.tools).toBeUndefined();
    expect(request.messages).toEqual([
      { role: 'system', content: HOSTED_TEST_SYSTEM },
      { role: 'user', content: HOSTED_TEST_QUESTION },
    ]);
    expect(sent[0]?.body).not.toContain(rider.athleteId);
    expect(sent[0]?.body).not.toContain(RIDER_WORD);
  });

  it('returns nothing the service said', async () => {
    const said = 'the-service-said-this';
    const { ask } = await ready([{ kind: 'text', text: said }]);
    const answer = await ask();
    expect(answer.body).toEqual({ result: 'answered', reasoned: false });
    expect(JSON.stringify(answer)).not.toContain(said);
  });

  it.each([
    ['no key of the rider’s own', { key: false }],
    ['no recorded consent', { consent: false }],
    ['a consent naming another origin', { consent: 'https://other.example' }],
    ['no masking item', { masking: false }],
  ] as const)('is not-ready with %s, and sends nothing', async (_name, has) => {
    const { ask, sent } = await ready([{ kind: 'text', text: 'ready' }], has);
    expect(await ask()).toEqual({ status: 200, body: { result: 'not-ready', reasoned: false } });
    expect(sent).toEqual([]);
  });

  it('never uses another rider’s key: a rider with only a consent is not-ready', async () => {
    const { ask, sent, other } = await ready([{ kind: 'text', text: 'ready' }]);
    await world!.call('POST', '/v1/analysis/hosted/consent', {
      token: other.token,
      body: { endpoint: ENDPOINT },
    });
    await world!.call('POST', `/v1/sync/items/masking/${MASKING_ITEM_KEY}`, {
      token: other.token,
      body: { body: JSON.stringify({ words: [], zones: [] }) },
    });
    expect((await ask(other.token)).body).toEqual({ result: 'not-ready', reasoned: false });
    expect(sent).toEqual([]);
    // The control: the rider whose key it is gets an answer.
    expect((await ask()).body).toEqual({ result: 'answered', reasoned: false });
  });

  it('gives a model the rider said reasons its allowance, and says that it reasoned (#1268)', async () => {
    const { ask, requests } = await ready(
      [
        {
          kind: 'text',
          text: 'ready',
          reasoning: { field: 'reasoning_content', text: 'thinking', tokens: 40 },
        },
      ],
      { key: { ...KEY_BODY, reasoningTokens: 2_048 } },
    );
    expect((await ask()).body).toEqual({ result: 'answered', reasoned: true });
    expect((requests[0] as { max_tokens: number }).max_tokens).toBe(
      HOSTED_TEST_ANSWER_TOKENS + 2_048,
    );
  });

  it('says no-answer for a reply cut off before any answer', async () => {
    const { ask } = await ready([{ kind: 'text', text: '', finish: 'length' }]);
    expect((await ask()).body).toMatchObject({ result: 'no-answer' });
  });

  it.each([
    [401, 'refused'],
    [404, 'refused'],
    [500, 'failed'],
  ] as const)('says only %i → %s, never the service’s own words', async (status, result) => {
    const words = 'your-key-sk-123-is-wrong';
    const { ask } = await ready([
      { kind: 'status', status, body: JSON.stringify({ error: { message: words } }) },
    ]);
    const answer = await ask();
    expect(answer).toEqual({ status: 200, body: { result, reasoned: false } });
    expect(JSON.stringify(answer)).not.toContain(words);
  });

  it('refuses a rider’s seventh test in ten minutes with nothing sent, and only that rider', async () => {
    const { ask, sent, other } = await ready(
      Array.from({ length: 8 }, () => ({ kind: 'text', text: 'ready' })),
    );
    for (let n = 0; n < 6; n += 1) expect((await ask()).status).toBe(200);
    expect(sent).toHaveLength(6);
    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(JSON.stringify(refused.body)).toContain('rate_limited');
    expect(sent).toHaveLength(6);
    // Per rider: another rider is not refused by this one's count (not-ready, and not 429).
    expect((await ask(other.token)).status).toBe(200);
  });

  it('allows one test in flight per rider: a second while the first waits is refused, nothing sent', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { ask, sent, firstSent } = await ready([{ kind: 'text', text: 'ready' }], { hold });
    const first = ask();
    // In flight, provably: its request has reached the service, which answers
    // nothing until it is released. Until #1311 this was a 300 ms reply and a
    // 100 ms sleep, which a slow runner lost (`expected 200 to be 429`, #1308).
    await firstSent;
    const second = await ask();
    expect(second.status).toBe(429);
    release();
    expect((await first).body).toEqual({ result: 'answered', reasoned: false });
    expect(sent).toHaveLength(1);
    // Once it has finished, the next is let through.
    expect((await ask()).status).toBe(200);
  });
});
