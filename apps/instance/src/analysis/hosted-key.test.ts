// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hosted model key's seal (#1097): the operator's secret, AES-256-GCM with
 * a fresh nonce on every write, the URL and model bound in, and a key that
 * will not open read as a state rather than thrown.
 */

import { describe, expect, it } from 'vitest';

import {
  hostedKeyFrom,
  hostedKeyState,
  hostedUrlFrom,
  importSecretKey,
  MAXIMUM_HOSTED_KEY_LENGTH,
  openHostedKey,
  readSecretKey,
  sealHostedKey,
} from './hosted-key.ts';
import { MARKER, MARKER_KEY, secretText } from './hosted-key-testing.ts';

async function secret(fill: number) {
  const read = readSecretKey(secretText(fill));
  if (read.kind !== 'ok') throw new Error('the fixture secret did not read');
  return importSecretKey(read.bytes);
}

const KEY = MARKER_KEY;
const URL_TEXT = 'https://models.example/v1';

describe('the operator’s secret', () => {
  it('reads 32 bytes of base64, and nothing else', () => {
    expect(readSecretKey(undefined)).toEqual({ kind: 'unset' });
    expect(readSecretKey('  ')).toEqual({ kind: 'unset' });
    expect(readSecretKey(secretText(7)).kind).toBe('ok');
    expect(readSecretKey(` ${secretText(7)}\n`).kind).toBe('ok');
    // 31 bytes, 33 bytes, not base64 at all.
    expect(readSecretKey(btoa('x'.repeat(31)))).toEqual({ kind: 'malformed' });
    expect(readSecretKey(btoa('x'.repeat(33)))).toEqual({ kind: 'malformed' });
    expect(readSecretKey('not base64 at all!')).toEqual({ kind: 'malformed' });
  });

  it('is imported non-extractable', async () => {
    const key = await secret(1);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
});

describe('the hosted URL', () => {
  it('is https: only — an http: URL is refused', () => {
    expect(hostedUrlFrom(URL_TEXT).ok).toBe(true);
    expect(hostedUrlFrom('http://models.example/v1')).toEqual({
      ok: false,
      problem: '--url must be https:.',
    });
    expect(hostedUrlFrom('not a url').ok).toBe(false);
  });

  it('is NOT held to the local-address rule: a public host is what a hosted service is', () => {
    expect(hostedUrlFrom('https://api.public-model.example/v1').ok).toBe(true);
  });

  it('carries no credentials, query or fragment', () => {
    expect(hostedUrlFrom('https://user:pass@models.example/v1').ok).toBe(false);
    expect(hostedUrlFrom('https://models.example/v1?key=x').ok).toBe(false);
    expect(hostedUrlFrom('https://models.example/v1#x').ok).toBe(false);
  });
});

describe('the key as standard input gives it', () => {
  it('takes one line, its line ending off', () => {
    expect(hostedKeyFrom(`${KEY}\n`)).toBe(KEY);
    expect(hostedKeyFrom(`${KEY}\r\n`)).toBe(KEY);
    expect(hostedKeyFrom(KEY)).toBe(KEY);
  });

  it('refuses nothing, two lines, a space, or too much', () => {
    expect(hostedKeyFrom('')).toBeUndefined();
    expect(hostedKeyFrom('\n')).toBeUndefined();
    expect(hostedKeyFrom(`${KEY}\n${KEY}\n`)).toBeUndefined();
    expect(hostedKeyFrom('sk two words')).toBeUndefined();
    expect(hostedKeyFrom('k'.repeat(MAXIMUM_HOSTED_KEY_LENGTH + 1))).toBeUndefined();
    expect(hostedKeyFrom('k'.repeat(MAXIMUM_HOSTED_KEY_LENGTH))).toBeDefined();
  });
});

describe('sealing and opening', () => {
  it('opens what it sealed, and the ciphertext does not hold the key', async () => {
    const secretKey = await secret(1);
    const sealed = await sealHostedKey(secretKey, {
      athleteId: 'a',
      url: URL_TEXT,
      model: 'm',
      key: KEY,
    });
    expect(new TextDecoder('latin1').decode(sealed.ciphertext)).not.toContain(MARKER);
    expect(sealed.iv).toHaveLength(12);
    expect(
      await openHostedKey(secretKey, { athleteId: 'a', url: URL_TEXT, model: 'm', ...sealed }),
    ).toBe(KEY);
  });

  it('draws a fresh nonce for every seal', async () => {
    const secretKey = await secret(1);
    const one = await sealHostedKey(secretKey, {
      athleteId: 'a',
      url: URL_TEXT,
      model: 'm',
      key: KEY,
    });
    const two = await sealHostedKey(secretKey, {
      athleteId: 'a',
      url: URL_TEXT,
      model: 'm',
      key: KEY,
    });
    expect(one.iv).not.toEqual(two.iv);
    expect(one.ciphertext).not.toEqual(two.ciphertext);
  });

  it('will not open with another secret — and says so rather than throwing', async () => {
    const sealed = await sealHostedKey(await secret(1), {
      athleteId: 'a',
      url: URL_TEXT,
      model: 'm',
      key: KEY,
    });
    expect(
      await openHostedKey(await secret(2), {
        athleteId: 'a',
        url: URL_TEXT,
        model: 'm',
        ...sealed,
      }),
    ).toBe(undefined);
  });

  it('will not open once its URL or its model is edited: the key cannot be pointed elsewhere', async () => {
    const secretKey = await secret(1);
    const sealed = await sealHostedKey(secretKey, {
      athleteId: 'a',
      url: URL_TEXT,
      model: 'm',
      key: KEY,
    });
    expect(
      await openHostedKey(secretKey, {
        athleteId: 'a',
        url: 'https://attacker.example/v1',
        model: 'm',
        ...sealed,
      }),
    ).toBeUndefined();
    expect(
      await openHostedKey(secretKey, { athleteId: 'a', url: URL_TEXT, model: 'n', ...sealed }),
    ).toBeUndefined();
  });

  it('will not open once its athlete is edited: the key cannot be moved to another rider', async () => {
    const secretKey = await secret(1);
    const sealed = await sealHostedKey(secretKey, {
      athleteId: 'a',
      url: URL_TEXT,
      model: 'm',
      key: KEY,
    });
    expect(
      await openHostedKey(secretKey, { athleteId: 'b', url: URL_TEXT, model: 'm', ...sealed }),
    ).toBeUndefined();
  });
});

describe('the state the instance reads', () => {
  it('is none, no-secret, unreadable or held — and only held carries the key', async () => {
    const secretKey = await secret(1);
    const sealed = await sealHostedKey(secretKey, {
      athleteId: 'a',
      url: URL_TEXT,
      model: 'm',
      key: KEY,
    });
    const held = {
      getHostedModelKey: () =>
        Promise.resolve({ athleteId: 'a', url: URL_TEXT, model: 'm', setAt: 1, ...sealed }),
    };
    const none = { getHostedModelKey: () => Promise.resolve(undefined) };

    expect(await hostedKeyState(none, secretKey)).toEqual({ kind: 'none' });
    expect(await hostedKeyState(held, undefined)).toEqual({
      kind: 'no-secret',
      url: URL_TEXT,
      model: 'm',
    });
    expect(await hostedKeyState(held, await secret(2))).toEqual({
      kind: 'unreadable',
      url: URL_TEXT,
      model: 'm',
    });
    expect(await hostedKeyState(held, secretKey)).toEqual({
      kind: 'held',
      url: URL_TEXT,
      model: 'm',
      athleteId: 'a',
      key: KEY,
    });
  });
});
