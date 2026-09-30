// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the identity tests share: a device that holds a real, non-extractable
 * Ed25519 key and signs statements with it, and an instance with a real store
 * behind the real listener and a clock the test moves.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTH_PURPOSE,
  deviceStatementBytes,
  fromHex,
  SIGNATURE_ALGORITHM,
  toHex,
  type DevicePurpose,
  type SigningKey,
} from '@onyourleft/domain';

import { createMemoryBlobStore, type MemoryBlobs } from '../blob/memory-blob-store.ts';
import type { BlobStore } from '../blob/blob-store.ts';
import type { Config } from '../config.ts';
import { startTestInstance, type TestInstance } from '../instance-testing.ts';
import { createSync, type Sync } from '../sync/sync.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import type { InstanceProbes } from '../route-kit.ts';
import { createIdentity, DEFAULT_LIMITS, type Identity, type IdentityOptions } from './identity.ts';

/** The origin every test instance states. */
export const TEST_ORIGIN = 'https://ride.example';

/** A device: a key that cannot leave it, and a way to sign a statement with it. */
export interface TestDevice {
  readonly publicKey: string;
  sign(bytes: Uint8Array): Promise<string>;
  /** The same key as `@onyourleft/domain`'s signing seam, to sign an activity record with. */
  readonly signingKey: SigningKey;
  /** A signed statement for `nonce`, ready to post. */
  statement(
    nonce: string,
    overrides?: { purpose?: string; instanceOrigin?: string; issuedAt?: number },
  ): Promise<Record<string, string | number>>;
}

export async function testDevice(): Promise<TestDevice> {
  // Not extractable: the private half cannot leave this object, as on a device.
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as unknown as webcrypto.CryptoKeyPair;
  const publicKey = toHex(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)));
  const sign = async (bytes: Uint8Array): Promise<string> =>
    toHex(
      new Uint8Array(
        await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(bytes)),
      ),
    );
  return {
    publicKey,
    sign,
    signingKey: {
      algorithm: SIGNATURE_ALGORITHM,
      publicKey: fromHex(publicKey, 'the public key'),
      sign: async (message) => fromHex(await sign(message), 'the signature'),
    },
    statement: async (nonce, overrides = {}) => {
      const signed = {
        purpose: (overrides.purpose ?? AUTH_PURPOSE) as DevicePurpose,
        instanceOrigin: overrides.instanceOrigin ?? TEST_ORIGIN,
        nonce,
        publicKey,
        issuedAt: overrides.issuedAt ?? 1_790_000_000,
      };
      return { ...signed, signature: await sign(deviceStatementBytes(signed)) };
    },
  };
}

/** A clock a test moves by hand. Unix milliseconds. */
export interface TestClock {
  ms: number;
}

export interface IdentityInstance {
  readonly instance: TestInstance;
  readonly url: string;
  readonly identity: Identity;
  readonly clock: TestClock;
  /** The database file. */
  readonly path: string;
  /** Mail an email-recovery link would have sent, when email recovery is on. */
  readonly mail: { address: string; token: string }[];
  /** Mail a link confirming a recovery address would have sent (#865). */
  readonly confirmations: { address: string; token: string }[];
  /** POST or GET a JSON body; answers the status and the parsed body. */
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string; headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown }>;
  /** Challenge, sign, sign in: the session the device gets. */
  signIn(
    device: TestDevice,
    extra?: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  /** A nonce issued to `device`. */
  nonceFor(device: TestDevice): Promise<string>;
  /**
   * Every byte of the database as it is on disk — the file, its write-ahead
   * log and its shared-memory index — as Latin-1, so any ASCII secret written
   * anywhere in them is found by a substring search.
   */
  databaseBytes(): Promise<string>;
  /** Sync's blobs, as the memory blob store keeps them: the object store, read directly. */
  readonly blobs: MemoryBlobs;
  readonly sync: Sync;
  /** A second, fresh store on the same file — a read the instance's store did not serve. */
  freshRead<T>(read: (store: SqlStore) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function startIdentityInstance(
  options: Partial<Omit<IdentityOptions, 'store' | 'origin' | 'now' | 'emailRecovery'>> & {
    /** `'failing'`: email recovery on, with a mail transport that rejects every send. */
    emailRecovery?: boolean | 'failing';
    /**
     * What the identity sees in place of the real store — for putting a
     * check-then-write race in a known order, which two concurrent calls in
     * one process do not reliably produce.
     */
    storeSeenBy?: (store: SqlStore) => SqlStore;
    /** What sync sees in place of the real store — to fail a write after the blob landed (#37). */
    syncStoreSeenBy?: (store: SqlStore) => SqlStore;
    /** What sync sees in place of the memory blob store over {@link IdentityInstance.blobs}. */
    blobStoreSeenBy?: (blobs: BlobStore) => BlobStore;
    /** The largest request body, in bytes. 16 KiB unless a test needs files. */
    bodyLimitBytes?: number;
    /** What `/ready`, `/metrics` and a room's start answer (#780). */
    probes?: InstanceProbes;
    /** The listener's configuration, over the test defaults — an instance name, say (#777). */
    config?: Partial<Config>;
    /**
     * The instance's origin is the listener's own `http://127.0.0.1:<port>`
     * rather than {@link TEST_ORIGIN}, so a real browser that reached it by
     * that address can sign for it (#777's browser gate).
     */
    originIsTheListener?: boolean;
  } = {},
): Promise<IdentityInstance> {
  const directory = await mkdtemp(join(tmpdir(), 'oyl-instance-identity-'));
  const path = join(directory, 'instance.sqlite');
  const store = await openSqlStore(path);
  const clock: TestClock = { ms: 1_790_000_000_000 };
  const mail: { address: string; token: string }[] = [];
  const confirmations: { address: string; token: string }[] = [];
  const {
    emailRecovery,
    storeSeenBy,
    probes,
    syncStoreSeenBy,
    blobStoreSeenBy,
    bodyLimitBytes,
    config,
    originIsTheListener,
    ...rest
  } = options;
  const identityFor = (origin: string): Identity =>
    createIdentity({
      // The identity tests predate registration modes (#775) and register
      // riders as they sign in; a test of a mode names it. The default an
      // instance really starts with is `approval`, asserted in registration.test.ts.
      registration: 'open',
      // Every test rider signs in from one loopback address, so the per-address
      // registration limit (#775) would be what these tests measured. A test of
      // that limit sets it.
      limits: { ...DEFAULT_LIMITS, registrationPerAddress: { limit: 10_000, windowMs: 60_000 } },
      ...rest,
      store: storeSeenBy === undefined ? store : storeSeenBy(store),
      origin,
      now: () => clock.ms,
      ...(emailRecovery === true || emailRecovery === 'failing'
        ? {
            emailRecovery: {
              send: (address, token) => {
                if (emailRecovery === 'failing') return Promise.reject(new Error('no mail'));
                mail.push({ address, token });
                return Promise.resolve();
              },
              confirm: (address, token) => {
                if (emailRecovery === 'failing') return Promise.reject(new Error('no mail'));
                confirmations.push({ address, token });
                return Promise.resolve();
              },
            },
          }
        : {}),
    });
  const blobs: MemoryBlobs = new Map();
  const memoryBlobs = createMemoryBlobStore(blobs);
  const sync = createSync({
    store: syncStoreSeenBy === undefined ? store : syncStoreSeenBy(store),
    blobs: blobStoreSeenBy === undefined ? memoryBlobs : blobStoreSeenBy(memoryBlobs),
    now: () => clock.ms,
  });
  const listenerConfig = { bodyLimitBytes: bodyLimitBytes ?? 16_384, ...config };
  const started = (identity: Identity): Promise<TestInstance> =>
    startTestInstance({
      identity,
      sync,
      config: listenerConfig,
      ...(probes === undefined ? {} : { probes }),
    });
  let identity: Identity;
  let instance: TestInstance;
  if (originIsTheListener === true) {
    // The browser gate's case (#777): a real page signs for the address it
    // really reached, which is known only once the listener has a port. So the
    // handler is given a stand-in that forwards to the identity made then.
    const made: { identity?: Identity } = {};
    const forwarding = new Proxy({} as Identity, {
      get: (_target, key) => {
        const real = made.identity;
        if (real === undefined) throw new Error('the identity was used before it was made');
        const value = Reflect.get(real, key) as unknown;
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(real)
          : value;
      },
    });
    instance = await started(forwarding);
    made.identity = identityFor(instance.url);
    identity = made.identity;
  } else {
    identity = identityFor(TEST_ORIGIN);
    instance = await started(identity);
  }

  const call: IdentityInstance['call'] = async (method, route, callOptions = {}) => {
    const headers: Record<string, string> = { ...callOptions.headers };
    if (callOptions.token !== undefined) headers.authorization = `Bearer ${callOptions.token}`;
    if (callOptions.body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${instance.url}${route}`, {
      method,
      headers,
      ...(callOptions.body === undefined ? {} : { body: JSON.stringify(callOptions.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  const nonceFor = async (device: TestDevice): Promise<string> => {
    const answer = await call('POST', '/v1/auth/challenge', {
      body: { publicKey: device.publicKey },
    });
    const nonce = (answer.body as { nonce?: unknown }).nonce;
    if (typeof nonce !== 'string') throw new Error(`no nonce: ${JSON.stringify(answer)}`);
    return nonce;
  };

  return {
    instance,
    url: instance.url,
    identity,
    clock,
    path,
    mail,
    blobs,
    sync,
    confirmations,
    call,
    nonceFor,
    signIn: async (device, extra = {}) => {
      const nonce = await nonceFor(device);
      const answer = await call('POST', '/v1/auth/session', {
        body: { ...(await device.statement(nonce)), ...extra },
      });
      return { status: answer.status, body: answer.body as Record<string, unknown> };
    },
    databaseBytes: async () => {
      const parts: string[] = [];
      for (const file of [path, `${path}-wal`, `${path}-shm`]) {
        if (existsSync(file)) parts.push((await readFile(file)).toString('latin1'));
      }
      return parts.join('');
    },
    freshRead: async (read) => {
      const fresh = await openSqlStore(path);
      try {
        return await read(fresh);
      } finally {
        await fresh.close();
      }
    },
    close: async () => {
      await instance.listening.close();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
