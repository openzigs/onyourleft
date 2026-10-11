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
import { MARKER, MARKER_KEY } from './hosted-key-testing.ts';
import { HOSTED_KEY_NEEDS_SECRET, type HostedStatus } from './hosted-settings.ts';

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
      key: { url: KEY_BODY.url, model: 'a-model', setAt: 1_790_000_123, setBy: 'app' },
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
