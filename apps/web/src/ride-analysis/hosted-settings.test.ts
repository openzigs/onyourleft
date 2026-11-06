// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A rider's own hosted key and hosted consent (#1251), against a REAL
 * instance: its own handler, its own sealed routes, its own database, and a
 * scripted model server where the internet would be.
 *
 * Every write is read back the way a real consumer reads it — through a
 * FRESH port over the same sign-in, and, for the masking list, by the
 * instance's own test question, which is sent only when the instance can read
 * that list. Nothing here asserts against the object it just built.
 *
 * The instance is reached by a computed `import()` of its test support (test
 * code only, as `instance/sealed-routes.test.ts` does).
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  unixSeconds,
} from '@onyourleft/domain';
import type { MaskingGuard } from '@onyourleft/analysis';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createInstancePort,
  heldSealedSession,
  INSTANCE_AGREEMENT_STORAGE_KEYS,
  instanceEraser,
  type HeldSealedSession,
  type InstancePortDependencies,
  type InstanceStorage,
} from '../instance/instance-port';
import { InstanceUnreachableError, type InstanceSend } from '../instance/instance-transport';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from '../instance/testing';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import {
  HOSTED_ANSWER_REFUSAL_TEXT,
  HOSTED_CHANGE_UNKNOWN,
  HOSTED_MASKING_NOT_SENT,
  HOSTED_NOT_ACCEPTED,
  HOSTED_NOT_OFFERED,
  HOSTED_TEST_UNREADABLE,
  HOSTED_UNREADABLE,
  hostedTestText,
} from './hosted-consent';
import {
  createHostedSettingsPort,
  HOSTED_CONSENT_PATH,
  HOSTED_KEY_PATH,
  HOSTED_OFFER_STORAGE_KEY,
  HOSTED_SETTINGS_PATH,
  HOSTED_TEST_PATH,
  HOSTED_TEST_WAIT_MILLISECONDS,
  hostedKeyRequest,
  hostedSettingsFrom,
  MASKING_ITEM_PATH,
  MAXIMUM_REASONING_TOKENS,
  readHostedOffer,
  sendMaskingGuard,
} from './hosted-settings';
import type { HostedKeyAnswers, HostedSettingsPort } from './hosted-settings-port';

interface ScriptedReply {
  readonly kind: 'text' | 'status';
  readonly text?: string;
  readonly status?: number;
  readonly body?: string;
}

interface FakeModelServer {
  readonly baseUrl: URL;
  readonly requests: Record<string, unknown>[];
  close(): Promise<void>;
}

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    hostedFetch?: typeof globalThis.fetch;
  }): Promise<IdentityInstance>;
}

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;
const NOW = unixSeconds(1_790_000_000);

/** A key no real service issued, long enough to be told from any other text. */
const KEY = 'sk-test-0123456789abcdefghijklmnopqrstuv';
const SERVICE = 'https://models.example';
const ANSWERS: HostedKeyAnswers = {
  address: `${SERVICE}/v1`,
  model: 'a-model',
  key: KEY,
  reasoningTokens: '',
};
/** A word the rider asked to have masked, and a zone whose centre is a coordinate. */
const GUARD: MaskingGuard = {
  words: ['Zennor'],
  zones: [
    {
      label: 'Home',
      centre: geographicPosition(degreesLatitude(50.1915), degreesLongitude(-5.5678)),
      radius: 400,
    },
  ],
};

let testing: IdentityTesting;
let startFakeModelServer: (script: ScriptedReply[]) => Promise<FakeModelServer>;
const closing: { close(): Promise<void> }[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
  ({ startFakeModelServer } = (await import(
    /* @vite-ignore */ INSTANCE('analysis/fake-model-server-testing.ts')
  )) as { startFakeModelServer: typeof startFakeModelServer });
});

afterEach(async () => {
  for (const each of closing.splice(0)) await each.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

function deviceStorage(): InstanceStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * A device signed in, with the instance's card, to a real instance whose
 * hosted requests go to a scripted model server. `port()` builds a FRESH
 * hosted-settings port over that sign-in each time it is called.
 */
async function signedIn(
  script: ScriptedReply[] = [],
  options: { readonly guard?: () => Promise<MaskingGuard> } = {},
) {
  const model = await startFakeModelServer(script);
  closing.push(model);
  const toService: string[] = [];
  const hostedFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    toService.push(typeof init?.body === 'string' ? init.body : '');
    if (!url.startsWith(`${SERVICE}/v1/`)) return Promise.reject(new Error('another host'));
    return globalThis.fetch(`${model.baseUrl.href}${url.slice(`${SERVICE}/v1`.length)}`, init);
  }) as typeof globalThis.fetch;
  const world = await testing.startIdentityInstance({ hostedFetch });
  closing.push(world);
  const send: InstanceSend & ReturnType<typeof vi.fn> = vi.fn((url: string, init: RequestInit) =>
    world.instance.handler(new Request(url, init)),
  );
  const store = createStoreHarness();
  harnesses.push(store);
  const storage = deviceStorage();
  const dependencies: InstancePortDependencies = {
    storage,
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () => store.write(async (open) => ensureLocalAthlete(open, NOW)),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
    now: () => NOW * 1000,
  };
  const card = (await world.instanceKeys.show()).card;
  expect(
    await createInstancePort(dependencies).connect(testing.TEST_ORIGIN, 'Anna', card),
  ).toMatchObject({ kind: 'connected' });
  const guard = options.guard ?? (async () => Promise.resolve(GUARD));
  const port = (from = dependencies): HostedSettingsPort =>
    createHostedSettingsPort({ session: heldSealedSession(from), storage, guard });
  /** Every request this device made, as it left: the bytes a network would carry. */
  const wire = (): string =>
    (send.mock.calls as [string, RequestInit][])
      .map(([url, init]) => `${url} ${typeof init.body === 'string' ? init.body : ''}`)
      .join('\n');
  return { port, storage, dependencies, send, wire, toService, model };
}

describe('storing a key (#1251, #1199)', () => {
  it('stores it on the instance, read back by a fresh port — the address, the model, never the key', async () => {
    const device = await signedIn();
    const stored = await device.port().storeHostedKey({ ...ANSWERS, reasoningTokens: ' 2048 ' });
    expect(stored).toStrictEqual({
      kind: 'held',
      settings: {
        key: {
          origin: SERVICE,
          host: 'models.example',
          model: 'a-model',
          reasoningTokens: 2048,
          setBy: 'app',
        },
        consent: null,
      },
    });
    expect(await device.port().readHostedSettings()).toStrictEqual(stored);
    expect(JSON.stringify(stored)).not.toContain(KEY);
  });

  it('never puts the key on the wire in the clear, and keeps it nowhere on this device', async () => {
    const device = await signedIn();
    await device.port().storeHostedKey(ANSWERS);
    expect(device.send).toHaveBeenCalled();
    expect(device.wire()).not.toContain(KEY);
    expect(device.wire()).not.toContain('a-model');
    expect([...device.storage.map.values()].join('\n')).not.toContain(KEY);
  });

  it('removes it, read back by a fresh port', async () => {
    const device = await signedIn();
    await device.port().storeHostedKey(ANSWERS);
    expect(await device.port().removeHostedKey()).toStrictEqual({
      kind: 'held',
      settings: { key: null, consent: null },
    });
    expect(await device.port().readHostedSettings()).toStrictEqual({
      kind: 'held',
      settings: { key: null, consent: null },
    });
  });

  it.each([
    [{ address: '' }, 'no-address'],
    [{ address: 'models.example' }, 'no-address'],
    [{ address: 'http://models.example/v1' }, 'not-https'],
    [{ address: 'https://someone:secret@models.example/v1' }, 'has-credentials'],
    [{ model: '  ' }, 'no-model'],
    [{ model: 'a model' }, 'model-has-spaces'],
    [{ key: '' }, 'no-key'],
    [{ key: 'sk test' }, 'key-not-printable'],
    [{ key: 'sk-tést' }, 'key-not-printable'],
    [{ reasoningTokens: '0' }, 'reasoning-not-a-count'],
    [{ reasoningTokens: '16385' }, 'reasoning-not-a-count'],
    [{ reasoningTokens: '1.5' }, 'reasoning-not-a-count'],
    [{ reasoningTokens: 'lots' }, 'reasoning-not-a-count'],
  ] as const)(
    'refuses %j as %s before anything is sent, and repeats nothing typed',
    async (typed, refusal) => {
      const device = await signedIn();
      device.send.mockClear();
      const answers = { ...ANSWERS, ...typed };
      const outcome = await device.port().storeHostedKey(answers);
      expect(outcome).toStrictEqual({ kind: 'failed', text: HOSTED_ANSWER_REFUSAL_TEXT[refusal] });
      expect(device.send).not.toHaveBeenCalled();
      for (const value of Object.values(typed)) {
        if (value.trim().length > 3) expect(JSON.stringify(outcome)).not.toContain(value);
      }
      expect(JSON.stringify(outcome)).not.toContain(KEY);
    },
  );

  it('sends the address whole, the model and key trimmed, and the allowance only when typed', () => {
    expect(hostedKeyRequest({ ...ANSWERS, model: ' a-model ', key: ` ${KEY}\n` })).toStrictEqual({
      ok: true,
      body: { url: `${SERVICE}/v1`, model: 'a-model', key: KEY },
    });
    expect(hostedKeyRequest({ ...ANSWERS, reasoningTokens: '16384' })).toMatchObject({
      body: { reasoningTokens: 16_384 },
    });
  });
});

describe('agreeing, and what may be offered (#1251)', () => {
  it('records the consent on the instance and notes the offer, both read back fresh', async () => {
    const device = await signedIn();
    await device.port().storeHostedKey(ANSWERS);
    // A key alone offers nothing.
    expect(readHostedOffer(device.storage, testing.TEST_ORIGIN)).toBeUndefined();
    const agreed = await device.port().agreeToHostedService(SERVICE);
    expect(agreed).toMatchObject({ kind: 'held', settings: { consent: { origin: SERVICE } } });
    expect(await device.port().readHostedSettings()).toStrictEqual(agreed);
    expect(readHostedOffer(device.storage, testing.TEST_ORIGIN)).toBe(SERVICE);
    // Noted for THIS instance: signed in to another, nothing is offered.
    expect(readHostedOffer(device.storage, 'https://other.example')).toBeUndefined();
    expect(readHostedOffer(device.storage, undefined)).toBeUndefined();
    expect(readHostedOffer(undefined, testing.TEST_ORIGIN)).toBeUndefined();
  });

  it('gives the instance the masking list first: its own test question is then sent, masked by it', async () => {
    const device = await signedIn([{ kind: 'text', text: 'ready' }]);
    await device.port().storeHostedKey(ANSWERS);
    // Before agreeing the instance holds no list and no consent: it sends nothing.
    expect(await device.port().sendHostedTestQuestion()).toStrictEqual({
      kind: 'tested',
      result: 'not-ready',
      reasoned: false,
    });
    expect(device.toService).toStrictEqual([]);
    await device.port().agreeToHostedService(SERVICE);
    expect(await device.port().sendHostedTestQuestion()).toStrictEqual({
      kind: 'tested',
      result: 'answered',
      reasoned: false,
    });
    expect(device.toService).toHaveLength(1);
    // The list travelled sealed: neither the word nor the zone's centre is readable on the wire.
    expect(device.wire()).not.toContain('Zennor');
    expect(device.wire()).not.toContain('50.1915');
  });

  it('records no consent when the list cannot be read on this device, and says so', async () => {
    const device = await signedIn([], { guard: async () => Promise.reject(new Error('no store')) });
    await device.port().storeHostedKey(ANSWERS);
    expect(await device.port().agreeToHostedService(SERVICE)).toStrictEqual({
      kind: 'failed',
      text: HOSTED_MASKING_NOT_SENT,
    });
    expect(await device.port().readHostedSettings()).toMatchObject({
      settings: { consent: null },
    });
    expect(readHostedOffer(device.storage, testing.TEST_ORIGIN)).toBeUndefined();
  });

  it('withdraws it, and forgets the offer', async () => {
    const device = await signedIn();
    await device.port().storeHostedKey(ANSWERS);
    await device.port().agreeToHostedService(SERVICE);
    expect(await device.port().withdrawHostedAgreement()).toMatchObject({
      kind: 'held',
      settings: { consent: null },
    });
    expect(await device.port().readHostedSettings()).toMatchObject({ settings: { consent: null } });
    expect(readHostedOffer(device.storage, testing.TEST_ORIGIN)).toBeUndefined();
  });

  it.each([
    [
      'a key for another service',
      (port: HostedSettingsPort) =>
        port.storeHostedKey({ ...ANSWERS, address: 'https://elsewhere.example/v1' }),
    ],
    ['removing the key', (port: HostedSettingsPort) => port.removeHostedKey()],
  ] as const)('forgets the offer after %s', async (_name, press) => {
    const device = await signedIn();
    await device.port().storeHostedKey(ANSWERS);
    await device.port().agreeToHostedService(SERVICE);
    expect(readHostedOffer(device.storage, testing.TEST_ORIGIN)).toBe(SERVICE);
    await press(device.port());
    expect(readHostedOffer(device.storage, testing.TEST_ORIGIN)).toBeUndefined();
  });

  it('is forgotten with the sign-in', async () => {
    const device = await signedIn();
    await device.port().storeHostedKey(ANSWERS);
    await device.port().agreeToHostedService(SERVICE);
    expect(INSTANCE_AGREEMENT_STORAGE_KEYS).toContain(HOSTED_OFFER_STORAGE_KEY);
    instanceEraser(device.storage).forget();
    expect(device.storage.map.has(HOSTED_OFFER_STORAGE_KEY)).toBe(false);
  });

  it.each([
    ['not JSON', '{'],
    [
      'an http: service',
      JSON.stringify({ instance: 'https://i.example', endpoint: 'http://m.example' }),
    ],
    [
      'a URL that is not an origin',
      JSON.stringify({ instance: 'https://i.example', endpoint: 'https://m.example/v1' }),
    ],
    ['no service', JSON.stringify({ instance: 'https://i.example' })],
    ['null', 'null'],
  ])('offers nothing for a note that is %s', (_name, noted) => {
    const storage = deviceStorage();
    storage.setItem(HOSTED_OFFER_STORAGE_KEY, noted);
    expect(readHostedOffer(storage, 'https://i.example')).toBeUndefined();
  });
});

describe('with no sealed session nothing is sent (#1192, ADR 0047 D-11)', () => {
  it('says the session’s own sentence for every press, from a copy a website served', async () => {
    const device = await signedIn();
    const website = device.port({ ...device.dependencies, loadedFrom: LOADED_FROM_A_WEBSITE });
    device.send.mockClear();
    const outcomes = [
      await website.readHostedSettings(),
      await website.storeHostedKey(ANSWERS),
      await website.removeHostedKey(),
      await website.agreeToHostedService(SERVICE),
      await website.withdrawHostedAgreement(),
      await website.sendHostedTestQuestion(),
    ];
    for (const outcome of outcomes) {
      expect(outcome.kind).toBe('failed');
      expect((outcome as { text: string }).text.length).toBeGreaterThan(20);
    }
    expect(new Set(outcomes.map((outcome) => (outcome as { text: string }).text)).size).toBe(1);
    expect(device.send).not.toHaveBeenCalled();
  });
});

type Answer = { status: number; body: unknown } | Error;

/** A sealed session whose instance answers from a script: for what a real instance never says. */
function scripted(answers: Answer[]) {
  const calls: { method: string; path: string; options: Record<string, unknown> }[] = [];
  const held = {
    kind: 'open',
    token: 'session-token',
    account: { origin: 'https://i.example' },
    sealed: {
      call: (method: string, path: string, options: Record<string, unknown>) => {
        calls.push({ method, path, options });
        const answer = answers.shift() ?? { status: 500, body: null };
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
    },
  } as unknown as HeldSealedSession;
  const storage = deviceStorage();
  const port = createHostedSettingsPort({
    session: () => Promise.resolve(held),
    storage,
    guard: async () => Promise.resolve(GUARD),
  });
  return { calls, port, storage };
}

const HELD_BODY = {
  key: { url: `${SERVICE}/v1`, model: 'm', setAt: 1, reasoningTokens: null, setBy: 'app' },
  consent: { origin: SERVICE, recordedAt: 2 },
};

describe('each call, as it is made', () => {
  it('pads the one request that carries the key, and no other', async () => {
    const { calls, port } = scripted([
      { status: 200, body: HELD_BODY },
      { status: 200, body: HELD_BODY },
      { status: 200, body: HELD_BODY },
      { status: 200, body: HELD_BODY },
    ]);
    await port.storeHostedKey(ANSWERS);
    await port.readHostedSettings();
    await port.removeHostedKey();
    await port.withdrawHostedAgreement();
    expect(calls).toStrictEqual([
      {
        method: 'POST',
        path: HOSTED_KEY_PATH,
        options: {
          token: 'session-token',
          body: { url: `${SERVICE}/v1`, model: 'a-model', key: KEY },
          pastedKey: true,
        },
      },
      { method: 'GET', path: HOSTED_SETTINGS_PATH, options: { token: 'session-token' } },
      { method: 'DELETE', path: HOSTED_KEY_PATH, options: { token: 'session-token' } },
      { method: 'DELETE', path: HOSTED_CONSENT_PATH, options: { token: 'session-token' } },
    ]);
  });

  it('sends the masking item, then the consent naming the endpoint', async () => {
    const { calls, port } = scripted([
      { status: 200, body: { digest: 'd', receivedAt: 1, unchanged: false } },
      { status: 200, body: HELD_BODY },
    ]);
    await port.agreeToHostedService(SERVICE);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toStrictEqual([
      `POST ${MASKING_ITEM_PATH}`,
      `POST ${HOSTED_CONSENT_PATH}`,
    ]);
    expect(JSON.parse((calls[0]?.options.body as { body: string }).body)).toStrictEqual({
      words: ['Zennor'],
      zones: [{ label: 'Home', latitude: 50.1915, longitude: -5.5678, radius: 400 }],
    });
    expect(calls[1]?.options.body).toStrictEqual({ endpoint: SERVICE });
  });

  it('records no consent when the instance did not take the masking item', async () => {
    for (const refusal of [
      { status: 400, body: null },
      new InstanceUnreachableError('no-answer'),
    ]) {
      const { calls, port } = scripted([refusal, { status: 200, body: HELD_BODY }]);
      expect(await port.agreeToHostedService(SERVICE)).toStrictEqual({
        kind: 'failed',
        text: HOSTED_MASKING_NOT_SENT,
      });
      expect(calls).toHaveLength(1);
    }
  });

  it.each([429, 500])(
    'does not report a %i answer as the test’s result, even one carrying a result word',
    async (status) => {
      const { port } = scripted([{ status, body: { result: 'answered', reasoned: true } }]);
      expect(await port.sendHostedTestQuestion()).toStrictEqual({
        kind: 'failed',
        text: HOSTED_TEST_UNREADABLE,
      });
    },
  );

  it('waits longer than any other call for the test question', async () => {
    const { calls, port } = scripted([
      { status: 200, body: { result: 'timed-out', reasoned: false } },
    ]);
    expect(await port.sendHostedTestQuestion()).toStrictEqual({
      kind: 'tested',
      result: 'timed-out',
      reasoned: false,
    });
    expect(calls).toStrictEqual([
      {
        method: 'POST',
        path: HOSTED_TEST_PATH,
        options: { token: 'session-token', timeoutMilliseconds: HOSTED_TEST_WAIT_MILLISECONDS },
      },
    ]);
    expect(HOSTED_TEST_WAIT_MILLISECONDS).toBeGreaterThan(30_000);
  });
});

describe('an instance is untrusted input', () => {
  it.each([
    [404, HOSTED_NOT_OFFERED],
    [503, HOSTED_NOT_OFFERED],
    [400, HOSTED_NOT_ACCEPTED],
    [401, HOSTED_UNREADABLE],
    [500, HOSTED_UNREADABLE],
  ])('says why on a %i, and notes no offer', async (status, text) => {
    const { port, storage } = scripted([{ status, body: HELD_BODY }]);
    expect(await port.readHostedSettings()).toStrictEqual({ kind: 'failed', text });
    expect(storage.map.size).toBe(0);
  });

  it.each([
    ['nothing', null],
    ['no consent field', { key: null }],
    ['an http: key URL', { ...HELD_BODY, key: { ...HELD_BODY.key, url: 'http://models.example' } }],
    [
      'a key URL with a user name',
      { ...HELD_BODY, key: { ...HELD_BODY.key, url: 'https://a@models.example' } },
    ],
    ['a model that is not text', { ...HELD_BODY, key: { ...HELD_BODY.key, model: 7 } }],
    ['an unknown setter', { ...HELD_BODY, key: { ...HELD_BODY.key, setBy: 'somebody' } }],
    [
      'an allowance that is not a count',
      { ...HELD_BODY, key: { ...HELD_BODY.key, reasoningTokens: '9' } },
    ],
    [
      'a consent that is not an origin',
      { ...HELD_BODY, consent: { origin: 'https://models.example/v1' } },
    ],
    ['an http: consent', { ...HELD_BODY, consent: { origin: 'http://models.example' } }],
    ['a consent that is text', { ...HELD_BODY, consent: 'yes' }],
  ])('reads %s as no settings at all', async (_name, body) => {
    expect(hostedSettingsFrom(body)).toBeUndefined();
    const { port, storage } = scripted([{ status: 200, body }]);
    expect(await port.readHostedSettings()).toStrictEqual({
      kind: 'failed',
      text: HOSTED_UNREADABLE,
    });
    expect(storage.map.size).toBe(0);
  });

  it('offers nothing while the consent names another service than the key is for', async () => {
    const { port, storage } = scripted([
      { status: 200, body: { ...HELD_BODY, consent: { origin: 'https://other.example' } } },
    ]);
    expect((await port.readHostedSettings()).kind).toBe('held');
    expect(readHostedOffer(storage, 'https://i.example')).toBeUndefined();
  });

  it('offers the service only when both are held for one origin — the control', async () => {
    const { port, storage } = scripted([{ status: 200, body: HELD_BODY }]);
    await port.readHostedSettings();
    expect(readHostedOffer(storage, 'https://i.example')).toBe(SERVICE);
  });

  it.each([
    ['a word that is not on the list', { result: 'splendid', reasoned: false }],
    ['nothing', null],
  ])('reads a test answer of %s as unreadable', async (_name, body) => {
    const { port } = scripted([{ status: 200, body }]);
    expect(await port.sendHostedTestQuestion()).toStrictEqual({
      kind: 'failed',
      text: HOSTED_TEST_UNREADABLE,
    });
  });

  // #1796: a change whose answer was lost may have been made, so it is never
  // said to have changed nothing — whether the call timed out after it left
  // or its answer could not be read. A read changed nothing either way.
  it.each([
    ['no answer', new InstanceUnreachableError('no-answer')],
    ['an answer it cannot read', { status: 200, body: null }],
    ['a server error', { status: 500, body: null }],
  ] as const)(
    'says it cannot tell whether a change was made when it had %s',
    async (_name, answer) => {
      const changes: [string, (port: HostedSettingsPort) => Promise<unknown>][] = [
        ['store', (port) => port.storeHostedKey(ANSWERS)],
        ['remove', (port) => port.removeHostedKey()],
        ['agree', (port) => port.agreeToHostedService(SERVICE)],
        ['withdraw', (port) => port.withdrawHostedAgreement()],
      ];
      for (const [change, press] of changes) {
        // The agreement sends the masking list first, which the instance takes.
        const answers = change === 'agree' ? [{ status: 200, body: {} }, answer] : [answer];
        const { port } = scripted([...answers]);
        expect(await press(port), change).toStrictEqual({
          kind: 'failed',
          text: HOSTED_CHANGE_UNKNOWN,
        });
      }
      const { port } = scripted([answer]);
      expect(await port.readHostedSettings()).toStrictEqual({
        kind: 'failed',
        text: HOSTED_UNREADABLE,
      });
    },
  );

  it('says so when the instance does not answer, and does not swallow a bug', async () => {
    const quiet = scripted([
      new InstanceUnreachableError('no-answer'),
      new InstanceUnreachableError('no-answer'),
    ]);
    expect(await quiet.port.readHostedSettings()).toStrictEqual({
      kind: 'failed',
      text: HOSTED_UNREADABLE,
    });
    expect(await quiet.port.sendHostedTestQuestion()).toStrictEqual({
      kind: 'failed',
      text: HOSTED_TEST_UNREADABLE,
    });
    await expect(scripted([new TypeError('a bug')]).port.readHostedSettings()).rejects.toThrow(
      'a bug',
    );
  });
});

describe('the masking item', () => {
  it('is false, and never throws, when the guard cannot be read — and nothing is sent', async () => {
    let called = 0;
    const sent = await sendMaskingGuard(
      {
        call: async () => {
          called += 1;
          return Promise.resolve({ status: 200 });
        },
      },
      'token',
      async () => Promise.reject(new Error('unreadable')),
    );
    expect(sent).toBe(false);
    expect(called).toBe(0);
  });
});

describe('what this module copies from the instance stays what the instance says', () => {
  it('reads every word the instance’s test route declares, and has a sentence for each', async () => {
    const { HOSTED_ROUTES } = (await import(
      /* @vite-ignore */ INSTANCE('analysis/hosted-routes.ts')
    )) as {
      HOSTED_ROUTES: readonly {
        path: string;
        response: { schema?: { properties?: { result?: { enum?: readonly string[] } } } };
      }[];
    };
    const words =
      HOSTED_ROUTES.find((route) => route.path === HOSTED_TEST_PATH)?.response.schema?.properties
        ?.result?.enum ?? [];
    expect(words.length).toBeGreaterThan(5);
    for (const word of words) {
      const { port } = scripted([{ status: 200, body: { result: word, reasoned: false } }]);
      const outcome = await port.sendHostedTestQuestion();
      expect(outcome, word).toStrictEqual({ kind: 'tested', result: word, reasoned: false });
      if (outcome.kind !== 'tested') continue;
      const said = hostedTestText(outcome.result, 'models.example', {
        reasoned: false,
        allowanceSet: false,
      });
      expect(said.length, word).toBeGreaterThan(20);
    }
  });

  it('allows the reasoning tokens the instance allows', async () => {
    const turn = (await import(/* @vite-ignore */ INSTANCE('analysis/model-turn.ts'))) as {
      MAXIMUM_REASONING_TOKENS: number;
    };
    expect(MAXIMUM_REASONING_TOKENS).toBe(turn.MAXIMUM_REASONING_TOKENS);
  });

  it('names the masking item by the instance’s own key', async () => {
    const hosted = (await import(/* @vite-ignore */ INSTANCE('analysis/hosted.ts'))) as {
      MASKING_ITEM_KEY: string;
    };
    expect(MASKING_ITEM_PATH).toBe(`/v1/sync/items/masking/${hosted.MASKING_ITEM_KEY}`);
  });
});
