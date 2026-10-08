// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which model a job runs on (#1097): the job's own source and nothing else,
 * and — until #1101's masking seam lands — NO hosted request at all, whatever
 * key is held. #1101 replaces the "sends nothing" case with the masked path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HostedKeyState } from './hosted-key.ts';
import { MARKER_KEY } from './hosted-key-testing.ts';
import type { ModelConnection } from './model-turn.ts';
import { modelForSource } from './source.ts';

const LOCAL: ModelConnection = { turn: () => Promise.reject(new Error('not called')) };

const HELD: HostedKeyState = {
  kind: 'held',
  url: 'https://models.example/v1',
  model: 'a-model',
  athleteId: 'a',
  key: MARKER_KEY,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a job’s source (#1097)', () => {
  it('runs a local job on the local model, and says when there is none', async () => {
    const hostedKey = vi.fn(() => Promise.resolve(HELD));
    expect(await modelForSource('instance-local', 'a', { local: LOCAL, hostedKey })).toEqual({
      ok: true,
      model: LOCAL,
    });
    expect(await modelForSource('instance-local', 'a', { local: undefined, hostedKey })).toEqual({
      ok: false,
      failure: 'local_unavailable',
    });
    // A local job never so much as reads the hosted key.
    expect(hostedKey).not.toHaveBeenCalled();
  });

  it.each<[string, HostedKeyState]>([
    ['no key is held', { kind: 'none' }],
    ['no secret is set', { kind: 'no-secret', url: HELD.url, model: HELD.model }],
    ['the secret does not open it', { kind: 'unreadable', url: HELD.url, model: HELD.model }],
  ])('fails a hosted job hosted_unavailable when %s, even with masking', async (_why, state) => {
    const behindMasking = vi.fn(() => LOCAL);
    expect(
      await modelForSource('instance-hosted', 'a', {
        local: LOCAL,
        hostedKey: () => Promise.resolve(state),
        behindMasking,
      }),
    ).toEqual({ ok: false, failure: 'hosted_unavailable' });
    expect(behindMasking).not.toHaveBeenCalled();
  });

  it('on this tree, with a key held and no masking seam, fails a hosted job and sends nothing', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('nothing may be sent')));
    vi.stubGlobal('fetch', fetch);
    expect(
      await modelForSource('instance-hosted', 'a', {
        local: LOCAL,
        hostedKey: () => Promise.resolve(HELD),
      }),
    ).toEqual({ ok: false, failure: 'hosted_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses the held key to any athlete but the one it is held for, even with masking (ADR 0046 Q9, Q13)', async () => {
    const behindMasking = vi.fn(() => LOCAL);
    expect(
      await modelForSource('instance-hosted', 'another-rider', {
        local: LOCAL,
        hostedKey: () => Promise.resolve(HELD),
        behindMasking,
      }),
    ).toEqual({ ok: false, failure: 'hosted_unavailable' });
    expect(behindMasking).not.toHaveBeenCalled();
  });

  it('builds the hosted model only behind the masking seam, handed the opened key — the control', async () => {
    const hosted: ModelConnection = { turn: () => Promise.reject(new Error('not called')) };
    const behindMasking = vi.fn(() => hosted);
    expect(
      await modelForSource('instance-hosted', 'a', {
        local: LOCAL,
        hostedKey: () => Promise.resolve(HELD),
        behindMasking,
      }),
    ).toEqual({ ok: true, model: hosted });
    expect(behindMasking).toHaveBeenCalledWith(HELD);
  });
});
