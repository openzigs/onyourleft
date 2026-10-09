// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The client half of #772 and #773, against the REAL device key (the store's
 * non-extractable WebCrypto key in IndexedDB) and a stand-in instance that
 * verifies every signature with WebCrypto, as the real one does. The real
 * instance verifying a browser's signature is the browser gate's claim
 * (`browser/identity.browser.spec.ts`).
 */

import {
  AUTH_PURPOSE,
  deviceStatementBytes,
  fromHex,
  LINK_PURPOSE,
  unixSeconds,
  type DevicePurpose,
} from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import {
  INSTANCE_ACCOUNT_STORAGE_KEY,
  InstanceSignInError,
  linkThisDevice,
  PIN_DIFFERS,
  readInstanceAccount,
  signInToInstance,
  writeInstanceAccount,
  type InstanceAccountStorage,
  type InstanceTransport,
  type SignInDependencies,
} from './sign-in';
import { SCRIPTED_FINGERPRINT, SCRIPTED_NEW_FINGERPRINT } from './testing';

const ORIGIN = 'https://ride.example';
const NOW = unixSeconds(1_790_000_000);

let harnesses: StoreHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses) await harness.destroy();
  harnesses = [];
  vi.restoreAllMocks();
});

function harness(): StoreHarness {
  const made = createStoreHarness();
  harnesses.push(made);
  return made;
}

/** `localStorage` as a map that outlives the module reading it: a reload keeps it. */
function deviceStorage(): InstanceAccountStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

/** A stand-in instance: nonces, Ed25519 verification of the statement, and one athlete per key. */
function fakeInstance(log: string[]) {
  const nonces = new Map<string, string>();
  const athletes = new Map<string, string>();
  const links = new Map<string, string>();
  let next = 0;
  async function verified(
    body: Readonly<Record<string, unknown>>,
    purpose: DevicePurpose,
  ): Promise<string | undefined> {
    const { nonce, publicKey, issuedAt, signature, instanceOrigin } = body as Record<
      string,
      string
    >;
    if (body.purpose !== purpose || instanceOrigin !== ORIGIN) return undefined;
    if (nonces.get(nonce as string) !== publicKey) return undefined;
    nonces.delete(nonce as string);
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(fromHex(publicKey as string, 'key')),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const bytes = deviceStatementBytes({
      purpose,
      instanceOrigin: ORIGIN,
      nonce: nonce as string,
      publicKey: publicKey as string,
      issuedAt: issuedAt as unknown as number,
    });
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      new Uint8Array(fromHex(signature as string, 'signature')),
      new Uint8Array(bytes),
    );
    return ok ? publicKey : undefined;
  }
  const transport: InstanceTransport = {
    post: async (path, body) => {
      log.push(`post ${path}`);
      if (path === '/v1/auth/challenge') {
        const nonce = String(next++).padStart(64, '0');
        nonces.set(nonce, body.publicKey as string);
        return { status: 200, body: { nonce, expiresAt: 1 } };
      }
      if (path === '/v1/auth/session') {
        const key = await verified(body, AUTH_PURPOSE);
        if (key === undefined) return { status: 401, body: { error: { code: 'bad_signature' } } };
        const registered = !athletes.has(key);
        if (registered) athletes.set(key, `instance-athlete-${String(athletes.size)}`);
        return {
          status: 200,
          body: {
            sessionToken: 'token-'.padEnd(43, 'x'),
            athleteId: athletes.get(key),
            registered,
            ...(registered ? { recoveryCodes: ['aaaa-bbbb-cccc-dddd'] } : {}),
          },
        };
      }
      if (path === '/v1/auth/link') {
        const key = await verified(body, LINK_PURPOSE);
        const athlete = links.get(body.linkCode as string);
        if (key === undefined || athlete === undefined) {
          return { status: 401, body: { error: { code: 'code_unknown' } } };
        }
        athletes.set(key, athlete);
        return { status: 200, body: { athleteId: athlete } };
      }
      return { status: 404, body: { error: { code: 'not_found' } } };
    },
  };
  return { transport, athletes, links };
}

function dependencies(
  store: StoreHarness,
  transport: InstanceTransport,
  storage: InstanceAccountStorage,
  log: string[],
): SignInDependencies {
  return {
    origin: ORIGIN,
    transport,
    storage,
    ensureLocalAthlete: () =>
      store.write(async (open) => {
        log.push('ensureLocalAthlete');
        return ensureLocalAthlete(open, NOW);
      }),
    signingKey: () =>
      store.write(async (open) => {
        log.push('signingKey');
        return ensureDeviceSigningKey(open, LOCAL_ATHLETE, { now: () => NOW });
      }),
    now: () => NOW * 1000,
  };
}

describe('signing in to an instance with the device key (#772)', () => {
  it('makes sure the local athlete exists before it asks for the key or calls the instance', async () => {
    const log: string[] = [];
    const store = harness();
    const { transport } = fakeInstance(log);
    await signInToInstance(dependencies(store, transport, deviceStorage(), log));
    expect(log.indexOf('ensureLocalAthlete')).toBe(0);
    expect(log.indexOf('signingKey')).toBe(1);
    expect(log.slice(2)).toEqual(['post /v1/auth/challenge', 'post /v1/auth/session']);
  });

  it('keeps the instance’s athlete id on the device, and reads it back after a reload', async () => {
    const log: string[] = [];
    const store = harness();
    const storage = deviceStorage();
    const { transport } = fakeInstance(log);
    const signedIn = await signInToInstance(dependencies(store, transport, storage, log), {
      displayName: 'Anna',
    });
    expect(signedIn.registered).toBe(true);
    expect(signedIn.recoveryCodes).toEqual(['aaaa-bbbb-cccc-dddd']);

    // The reload: nothing but what the storage kept.
    const reloaded: InstanceAccountStorage = {
      getItem: (key) => storage.map.get(key) ?? null,
      setItem: () => undefined,
    };
    expect(readInstanceAccount(reloaded)).toEqual({
      origin: ORIGIN,
      instanceAthleteId: signedIn.instanceAthleteId,
    });
    // The token is not what the device keeps here: #777 decides where a session lives.
    expect(storage.map.get(INSTANCE_ACCOUNT_STORAGE_KEY)).not.toContain('token');
  });

  it('signs the same key in as the same athlete the second time', async () => {
    const log: string[] = [];
    const store = harness();
    const { transport } = fakeInstance(log);
    const first = await signInToInstance(dependencies(store, transport, deviceStorage(), log));
    const second = await signInToInstance(dependencies(store, transport, deviceStorage(), log));
    expect(second.registered).toBe(false);
    expect(second.instanceAthleteId).toBe(first.instanceAthleteId);
  });

  it('reports the instance’s refusal by its code, and keeps nothing', async () => {
    const storage = deviceStorage();
    const refusing: InstanceTransport = {
      post: (path) =>
        Promise.resolve(
          path === '/v1/auth/challenge'
            ? { status: 200, body: { nonce: '0'.repeat(64) } }
            : { status: 401, body: { error: { code: 'wrong_instance' } } },
        ),
    };
    await expect(signInToInstance(dependencies(harness(), refusing, storage, []))).rejects.toEqual(
      new InstanceSignInError('wrong_instance'),
    );
    expect(storage.map.size).toBe(0);
  });

  it('reads no account from storage that holds nothing, or something else', () => {
    const storage = deviceStorage();
    expect(readInstanceAccount(storage)).toBeUndefined();
    storage.setItem(INSTANCE_ACCOUNT_STORAGE_KEY, '{"origin":1}');
    expect(readInstanceAccount(storage)).toBeUndefined();
    storage.setItem(INSTANCE_ACCOUNT_STORAGE_KEY, 'not json');
    expect(readInstanceAccount(storage)).toBeUndefined();
  });
});

describe('linking this device to an athlete (#773)', () => {
  it('signs with this device’s own key and never calls exportKey on the way', async () => {
    const log: string[] = [];
    const { transport, links, athletes } = fakeInstance(log);
    // The first device, signed in.
    const first = await signInToInstance(dependencies(harness(), transport, deviceStorage(), log));
    links.set('code-1', first.instanceAthleteId);

    // The new device: its own database, its own key, made BEFORE the link path starts.
    const newDevice = harness();
    await newDevice.write(async (open) => {
      await ensureLocalAthlete(open, NOW);
      await ensureDeviceSigningKey(open, LOCAL_ATHLETE, { now: () => NOW });
    });

    const exportKey = vi.spyOn(crypto.subtle, 'exportKey');
    // Linking is sealed-only (#1192): the stand-in instance answers the sealed path too.
    const linked = await linkThisDevice(
      { ...dependencies(newDevice, transport, deviceStorage(), log), sealed: transport },
      'code-1',
    );
    expect(exportKey).not.toHaveBeenCalled();
    expect(linked.instanceAthleteId).toBe(first.instanceAthleteId);
    expect(linked.registered).toBe(false);
    // Two keys now answer for one athlete: nothing was copied between devices.
    const keys = [...athletes.entries()].filter(
      ([, athlete]) => athlete === first.instanceAthleteId,
    );
    expect(keys).toHaveLength(2);
  });

  it('never exports a private key, even when the new device mints its key on the link path', async () => {
    const log: string[] = [];
    const { transport, links } = fakeInstance(log);
    const first = await signInToInstance(dependencies(harness(), transport, deviceStorage(), log));
    links.set('code-2', first.instanceAthleteId);
    const exportKey = vi.spyOn(crypto.subtle, 'exportKey');
    await linkThisDevice(
      { ...dependencies(harness(), transport, deviceStorage(), log), sealed: transport },
      'code-2',
    );
    // Minting a key exports its PUBLIC half, which is the identity (ADR 0014).
    for (const [, key] of exportKey.mock.calls) {
      expect(key.type).toBe('public');
    }
  });
});

describe('a card never replaces a different pin without the rider confirming it (#1207, ADR 0047 D-6)', () => {
  const NO_TRUST = { highestSerial: null, highestKeyId: null, firstVerified: {}, newestIssued: {} };

  function pinned(): ReturnType<typeof deviceStorage> {
    const storage = deviceStorage();
    writeInstanceAccount(storage, {
      origin: ORIGIN,
      instanceAthleteId: 'athlete-1',
      pin: SCRIPTED_FINGERPRINT,
    });
    return storage;
  }

  it('refuses a sign-in carrying another card for the same instance, sending nothing and keeping the pin', async () => {
    const log: string[] = [];
    const storage = pinned();
    const { transport } = fakeInstance(log);
    await expect(
      signInToInstance({
        ...dependencies(harness(), transport, storage, log),
        pin: { fingerprint: SCRIPTED_NEW_FINGERPRINT, keyTrust: NO_TRUST },
      }),
    ).rejects.toEqual(new InstanceSignInError(PIN_DIFFERS));
    expect(log).toEqual([]);
    expect(readInstanceAccount(storage)?.pin).toBe(SCRIPTED_FINGERPRINT);
  });

  it('refuses a link carrying another card for the same instance before the link is sent', async () => {
    const log: string[] = [];
    const storage = pinned();
    const { transport } = fakeInstance(log);
    await expect(
      linkThisDevice(
        {
          ...dependencies(harness(), transport, storage, log),
          sealed: transport,
          pin: { fingerprint: SCRIPTED_NEW_FINGERPRINT, keyTrust: NO_TRUST },
        },
        'code-1',
      ),
    ).rejects.toEqual(new InstanceSignInError(PIN_DIFFERS));
    expect(log).toEqual([]);
    expect(readInstanceAccount(storage)?.pin).toBe(SCRIPTED_FINGERPRINT);
  });

  it('signs in with the same card again, and with any card for another instance', async () => {
    const log: string[] = [];
    const { transport } = fakeInstance(log);
    const same = pinned();
    await signInToInstance({
      ...dependencies(harness(), transport, same, log),
      pin: { fingerprint: SCRIPTED_FINGERPRINT, keyTrust: NO_TRUST },
    });
    expect(readInstanceAccount(same)?.pin).toBe(SCRIPTED_FINGERPRINT);

    const elsewhere = deviceStorage();
    writeInstanceAccount(elsewhere, {
      origin: 'https://other.example',
      instanceAthleteId: 'athlete-9',
      pin: SCRIPTED_FINGERPRINT,
    });
    await signInToInstance({
      ...dependencies(harness(), transport, elsewhere, log),
      pin: { fingerprint: SCRIPTED_NEW_FINGERPRINT, keyTrust: NO_TRUST },
    });
    expect(readInstanceAccount(elsewhere)).toMatchObject({
      origin: ORIGIN,
      pin: SCRIPTED_NEW_FINGERPRINT,
    });
  });
});

describe('stored key trust from before #1216 keeps each key’s newest re-signing (ADR 0047 D-5)', () => {
  const KEY = '0123456789abcdef';

  function stored(keyTrust: unknown): InstanceAccountStorage {
    const storage = deviceStorage();
    storage.setItem(
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        origin: ORIGIN,
        instanceAthleteId: 'athlete-1',
        pin: SCRIPTED_FINGERPRINT,
        keyTrust,
      }),
    );
    return storage;
  }

  it('reads the newest issuedAt of each key back out of the statements it first verified', () => {
    const account = readInstanceAccount(
      stored({
        highestSerial: 5,
        highestKeyId: KEY,
        firstVerified: {
          [`${KEY}@100`]: { at: 100, notAfter: 300 },
          [`${KEY}@200`]: { at: 200, notAfter: 400 },
          'fedcba9876543210@50': { at: 50, notAfter: 250 },
        },
      }),
    );
    expect(account?.keyTrust?.newestIssued).toEqual({
      [KEY]: { issuedAt: 200, notAfter: 400 },
      fedcba9876543210: { issuedAt: 50, notAfter: 250 },
    });
  });

  it('reads a trust this build wrote back as written, and refuses a malformed one', () => {
    const newestIssued = { [KEY]: { issuedAt: 200, notAfter: 400 } };
    const trust = { highestSerial: 5, highestKeyId: KEY, firstVerified: {}, newestIssued };
    expect(readInstanceAccount(stored(trust))?.keyTrust).toEqual(trust);
    expect(
      readInstanceAccount(stored({ ...trust, newestIssued: { [KEY]: { issuedAt: 'x' } } }))
        ?.keyTrust,
    ).toBeUndefined();
    expect(
      readInstanceAccount(
        stored({
          ...trust,
          newestIssued: undefined,
          firstVerified: { nokey: { at: 1, notAfter: 2 } },
        }),
      )?.keyTrust,
    ).toBeUndefined();
  });
});
