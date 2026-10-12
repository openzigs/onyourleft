// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which hosted service the rider's own key on their instance is for (#1106):
 * one sealed read, an answer treated as untrusted, and a sentence for every
 * way it cannot be had.
 */

import { describe, expect, it } from 'vitest';

import {
  HOSTED_SERVICE_NOT_OFFERED,
  HOSTED_SERVICE_UNREADABLE,
  HOSTED_SETTINGS_PATH,
  hostedKeyServiceReader,
} from './hosted-service';
import type { HeldSealedSession } from './instance-port';
import { InstanceUnreachableError } from './instance-transport';

type Answer = { status: number; body: unknown } | Error;

function sessionAnswering(answer: Answer) {
  const calls: { method: string; path: string; options: unknown }[] = [];
  const held = {
    kind: 'open',
    token: 'session-token',
    sealed: {
      call: (method: string, path: string, options: unknown) => {
        calls.push({ method, path, options });
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
    },
  } as unknown as HeldSealedSession;
  return { calls, read: hostedKeyServiceReader(() => Promise.resolve(held)) };
}

const key = (url: unknown) => ({
  status: 200,
  body: { key: { url, model: 'm', setAt: 1, reasoningTokens: null, setBy: 'app' }, consent: null },
});

describe('the hosted service a rider’s own key is for (#1106)', () => {
  it('reads it sealed, with the session’s token, and names it by the URL’s origin and host', async () => {
    const { calls, read } = sessionAnswering(key('https://api.models.example:8443/v1'));
    expect(await read()).toStrictEqual({
      kind: 'held',
      origin: 'https://api.models.example:8443',
      host: 'api.models.example:8443',
    });
    expect(calls).toStrictEqual([
      { method: 'GET', path: HOSTED_SETTINGS_PATH, options: { token: 'session-token' } },
    ]);
    expect(HOSTED_SETTINGS_PATH).toBe('/v1/analysis/hosted');
  });

  it('says none when the rider holds no key', async () => {
    const { read } = sessionAnswering({ status: 200, body: { key: null, consent: null } });
    expect(await read()).toStrictEqual({ kind: 'none' });
  });

  it.each([
    ['an http: URL', 'http://models.example/v1'],
    ['a URL with a user name', 'https://someone@models.example/v1'],
    ['not a URL', 'models.example'],
    ['not a string', 7],
  ])('names nothing for a key whose URL is %s', async (_name, url) => {
    const { read } = sessionAnswering(key(url));
    expect(await read()).toStrictEqual({ kind: 'unavailable', text: HOSTED_SERVICE_UNREADABLE });
  });

  it.each([
    [404, HOSTED_SERVICE_NOT_OFFERED],
    [503, HOSTED_SERVICE_NOT_OFFERED],
    [401, HOSTED_SERVICE_UNREADABLE],
    [500, HOSTED_SERVICE_UNREADABLE],
  ])('says why on a %i', async (status, text) => {
    const { read } = sessionAnswering({ status, body: { error: { code: 'x' } } });
    expect(await read()).toStrictEqual({ kind: 'unavailable', text });
  });

  it('says so for an answer that is not the settings, and when the instance does not answer', async () => {
    for (const answer of [
      { status: 200, body: null },
      { status: 200, body: { consent: null } },
      new InstanceUnreachableError('no-answer'),
    ]) {
      const { read } = sessionAnswering(answer);
      expect(await read()).toStrictEqual({ kind: 'unavailable', text: HOSTED_SERVICE_UNREADABLE });
    }
  });

  it('sends nothing with no sealed session, and shows that session’s own sentence', async () => {
    const closed: HeldSealedSession = { kind: 'closed', why: 'gate', text: 'Not from a website.' };
    expect(await hostedKeyServiceReader(() => Promise.resolve(closed))()).toStrictEqual({
      kind: 'unavailable',
      text: 'Not from a website.',
    });
    expect(
      await hostedKeyServiceReader(() => Promise.reject(new Error('no keys')))(),
    ).toStrictEqual({ kind: 'unavailable', text: HOSTED_SERVICE_UNREADABLE });
  });

  it('does not swallow a fault that is not the instance being unreachable', async () => {
    const { read } = sessionAnswering(new TypeError('a bug'));
    await expect(read()).rejects.toThrow('a bug');
  });
});
