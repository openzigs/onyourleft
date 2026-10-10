// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which model a job runs on (#1097): the job's own source and nothing else,
 * and (#1101) a hosted model only behind the athlete's masking guard — a
 * guard that is missing or cannot be read is a request not sent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLANTED_GUARD } from '@onyourleft/analysis/testing';

import type { HostedKeyState } from './hosted-key.ts';
import { MARKER_KEY } from './hosted-key-testing.ts';
import type { ModelConnection } from './model-turn.ts';
import { modelForSource } from './source.ts';

/** A recorded consent naming `origin` (Q10; the store's `athlete_hosted_consent` row on a running instance, #1199). */
const consentTo =
  (origin: string | undefined): ((athleteId: string) => Promise<string | undefined>) =>
  () =>
    Promise.resolve(origin);

const LOCAL: ModelConnection = { turn: () => Promise.reject(new Error('not called')) };

const HELD: HostedKeyState = {
  kind: 'held',
  url: 'https://models.example/v1',
  model: 'a-model',
  athleteId: 'a',
  key: MARKER_KEY,
};

/** The origin a request to the held key's endpoint goes to: what a consent names. */
const ORIGIN = 'https://models.example';

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
        recordedConsent: consentTo(ORIGIN),
        guard: () => Promise.resolve(PLANTED_GUARD),
        behindMasking,
      }),
    ).toEqual({ ok: false, failure: 'hosted_unavailable' });
    expect(behindMasking).not.toHaveBeenCalled();
  });

  it('with a key held and no masking seam, fails a hosted job and sends nothing', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('nothing may be sent')));
    vi.stubGlobal('fetch', fetch);
    expect(
      await modelForSource('instance-hosted', 'a', {
        local: LOCAL,
        hostedKey: () => Promise.resolve(HELD),
        recordedConsent: consentTo(ORIGIN),
        guard: () => Promise.resolve(PLANTED_GUARD),
      }),
    ).toEqual({ ok: false, failure: 'hosted_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('a missing or unreadable guard is a request not sent (#1101)', () => {
    it.each<[string, { guard?: () => Promise<typeof PLANTED_GUARD | undefined> }]>([
      ['no guard reader at all', {}],
      ['the athlete has no guard that can be read', { guard: () => Promise.resolve(undefined) }],
      ['the read throws', { guard: () => Promise.reject(new Error('disk')) }],
    ])('%s', async (_why, guardOption) => {
      const fetch = vi.fn(() => Promise.reject(new Error('nothing may be sent')));
      vi.stubGlobal('fetch', fetch);
      const behindMasking = vi.fn(() => LOCAL);
      expect(
        await modelForSource('instance-hosted', 'a', {
          local: LOCAL,
          hostedKey: () => Promise.resolve(HELD),
          recordedConsent: consentTo(ORIGIN),
          behindMasking,
          ...guardOption,
        }),
      ).toEqual({ ok: false, failure: 'hosted_unavailable' });
      expect(behindMasking).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('a local job reads no guard: its model gets the full text (ADR 0040 D-9)', async () => {
      const guard = vi.fn(() => Promise.resolve(PLANTED_GUARD));
      expect(
        await modelForSource('instance-local', 'a', {
          local: LOCAL,
          hostedKey: () => Promise.resolve(HELD),
          guard,
        }),
      ).toEqual({ ok: true, model: LOCAL });
      expect(guard).not.toHaveBeenCalled();
    });
  });

  it('refuses the held key to any athlete but the one it is held for, even with masking (ADR 0046 Q9, Q13)', async () => {
    const behindMasking = vi.fn(() => LOCAL);
    expect(
      await modelForSource('instance-hosted', 'another-rider', {
        local: LOCAL,
        hostedKey: () => Promise.resolve(HELD),
        recordedConsent: consentTo(ORIGIN),
        guard: () => Promise.resolve(PLANTED_GUARD),
        behindMasking,
      }),
    ).toEqual({ ok: false, failure: 'hosted_unavailable' });
    expect(behindMasking).not.toHaveBeenCalled();
  });

  it('builds the hosted model only behind the masking seam, handed the opened key and the athlete’s guard — the control', async () => {
    const hosted: ModelConnection = { turn: () => Promise.reject(new Error('not called')) };
    const behindMasking = vi.fn(() => hosted);
    const guard = vi.fn(() => Promise.resolve(PLANTED_GUARD));
    expect(
      await modelForSource('instance-hosted', 'a', {
        local: LOCAL,
        hostedKey: () => Promise.resolve(HELD),
        recordedConsent: consentTo(ORIGIN),
        guard,
        behindMasking,
      }),
    ).toEqual({ ok: true, model: hosted });
    expect(guard).toHaveBeenCalledWith('a');
    expect(behindMasking).toHaveBeenCalledWith(HELD, PLANTED_GUARD);
  });

  describe('the athlete’s own recorded consent, before the key is read (ADR 0046 D-9, Q10)', () => {
    it('with no consent reader, refuses the OPERATOR’s own hosted job and never reads the key', async () => {
      const hostedKey = vi.fn(() => Promise.resolve(HELD));
      const behindMasking = vi.fn(() => LOCAL);
      // 'a' is the athlete the key is held for — the operator — with masking supplied.
      expect(
        await modelForSource('instance-hosted', 'a', {
          local: LOCAL,
          hostedKey,
          guard: () => Promise.resolve(PLANTED_GUARD),
          behindMasking,
        }),
      ).toEqual({ ok: false, failure: 'hosted_unavailable' });
      expect(hostedKey).not.toHaveBeenCalled();
      expect(behindMasking).not.toHaveBeenCalled();
    });

    it('refuses an athlete whose consent records nothing, and never reads the key', async () => {
      const hostedKey = vi.fn(() => Promise.resolve(HELD));
      const recordedConsent = vi.fn(consentTo(undefined));
      expect(
        await modelForSource('instance-hosted', 'a', {
          local: LOCAL,
          hostedKey,
          recordedConsent,
          guard: () => Promise.resolve(PLANTED_GUARD),
          behindMasking: () => LOCAL,
        }),
      ).toEqual({ ok: false, failure: 'hosted_unavailable' });
      expect(recordedConsent).toHaveBeenCalledWith('a');
      expect(hostedKey).not.toHaveBeenCalled();
    });

    it.each([
      ['the origin itself', ORIGIN],
      ['the origin with a trailing slash', `${ORIGIN}/`],
      ['a full URL at that origin', 'https://models.example/v1/chat'],
    ])(
      'reads a consent recorded as %s as naming the key’s origin (#1197’s review)',
      async (_why, recorded) => {
        const hosted: ModelConnection = { turn: () => Promise.reject(new Error('not called')) };
        expect(
          await modelForSource('instance-hosted', 'a', {
            local: LOCAL,
            hostedKey: () => Promise.resolve(HELD),
            recordedConsent: consentTo(recorded),
            guard: () => Promise.resolve(PLANTED_GUARD),
            behindMasking: () => hosted,
          }),
        ).toEqual({ ok: true, model: hosted });
      },
    );

    it.each([
      ['not a URL', 'models.example'],
      ['not https', 'http://models.example'],
    ])('refuses a consent that is %s, and never reads the key', async (_why, recorded) => {
      const hostedKey = vi.fn(() => Promise.resolve(HELD));
      expect(
        await modelForSource('instance-hosted', 'a', {
          local: LOCAL,
          hostedKey,
          recordedConsent: consentTo(recorded),
          guard: () => Promise.resolve(PLANTED_GUARD),
          behindMasking: () => LOCAL,
        }),
      ).toEqual({ ok: false, failure: 'hosted_unavailable' });
      expect(hostedKey).not.toHaveBeenCalled();
    });

    it('asks for the job’s own athlete’s key, and no other (#1199: bring-your-own)', async () => {
      const hostedKey = vi.fn(() => Promise.resolve(HELD));
      await modelForSource('instance-hosted', 'a', {
        local: LOCAL,
        hostedKey,
        recordedConsent: consentTo(ORIGIN),
        guard: () => Promise.resolve(PLANTED_GUARD),
        behindMasking: () => LOCAL,
      });
      expect(hostedKey).toHaveBeenCalledWith('a');
    });

    it('refuses a consent that names another origin than the held key’s endpoint', async () => {
      const behindMasking = vi.fn(() => LOCAL);
      expect(
        await modelForSource('instance-hosted', 'a', {
          local: LOCAL,
          hostedKey: () => Promise.resolve(HELD),
          recordedConsent: consentTo('https://elsewhere.example/v1'),
          guard: () => Promise.resolve(PLANTED_GUARD),
          behindMasking,
        }),
      ).toEqual({ ok: false, failure: 'hosted_unavailable' });
      expect(behindMasking).not.toHaveBeenCalled();
    });
  });
});
