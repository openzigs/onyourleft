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
  decodeFrame,
  openSealedRequest,
  parseSealedEnvelope,
  sealedReplyWriter,
  unpad,
  utf8Encode,
  SEALED_PATH,
  AUTH_PURPOSE,
  deviceStatementBytes,
  fromHex,
  SIGNATURE_ALGORITHM,
  toHex,
  type DevicePurpose,
  type SigningKey,
} from '@onyourleft/domain';

import {
  createAnalysisJobs,
  type AnalysisJobs,
  type AnalysisJobsOptions,
} from '../analysis/jobs.ts';
import { createMemoryBlobStore, type MemoryBlobs } from '../blob/memory-blob-store.ts';
import type { BlobStore } from '../blob/blob-store.ts';
import type { Config } from '../config.ts';
import { startTestInstance, type TestInstance } from '../instance-testing.ts';
import type { Embedder } from '../history/embedder.ts';
import { createHistory, type History } from '../history/history.ts';
import { scriptedEmbedder } from '../history/history-testing.ts';
import { createSync, type Sync } from '../sync/sync.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import type { InstanceProbes } from '../route-kit.ts';
import { createRooms, type RoomLimits, type Rooms } from '../rooms/rooms.ts';
import { createInstanceKeys, type InstanceKeys } from '../keys/instance-keys.ts';
import { secretBytes } from '../keys/instance-keys-testing.ts';
import type { Route } from '../route-kit.ts';
import { instanceHpkePrimitives } from './crypto.ts';
import { createSealed, sha256, type Sealed } from '../sealed/sealed.ts';
import { sealFor } from '../sealed/sealed-testing.ts';
import { matchPath } from '../handler.ts';
import { ROUTES } from '../routes.ts';
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

/**
 * Every test device made in this process, by public key (#1192): a sealed
 * request with no session is signed by the key its statement names, so the
 * world finds that device here whatever the test did with it before.
 */
const EVERY_DEVICE = new Map<string, TestDevice>();

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
  const device: TestDevice = {
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
  EVERY_DEVICE.set(publicKey, device);
  return device;
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
  /**
   * Mail a recovery code would have sent, when email recovery is on — with
   * the subject and body the instance wrote (#1194).
   */
  readonly mail: { address: string; token: string; subject: string; text: string }[];
  /** Mail a code confirming a recovery address would have sent (#865, #1194). */
  readonly confirmations: { address: string; token: string; subject: string; text: string }[];
  /**
   * POST or GET a JSON body; answers the status and the parsed body.
   *
   * ⚠️ **A sealed route is called SEALED** (#1192): a route the table marks
   * `sealed: 'only'`, and `POST /v1/auth/session`, go inside
   * `POST /v1/sealed`, signed by the device the session belongs to (or, with
   * no session, the device whose key the statement names), and the answer is
   * the INNER status and body, opened. That is how #772's and #773's tests
   * moved to the sealed path rather than being deleted. `plain: true` sends
   * it in plaintext instead, which is how a test asks what the edge could do.
   * `signer` names the device that signs, or `null` for none.
   */
  call(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      token?: string;
      headers?: Record<string, string>;
      plain?: boolean;
      signer?: TestDevice | null;
    },
  ): Promise<{ status: number; body: unknown }>;
  /**
   * {@link call}'s request as a `Response` — sealed exactly as `call` seals it,
   * and opened: the INNER status, content type and bytes, under the outer
   * response's headers. `body` may be bytes, sent as they are.
   */
  request(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      token?: string;
      headers?: Record<string, string>;
      plain?: boolean;
      signer?: TestDevice | null;
    },
  ): Promise<Response>;
  /** Remember `device` as the holder of `token`, for a session a test made some other way. */
  holds(device: TestDevice, token: string): void;
  /**
   * A handler that answers AS THIS INSTANCE every sealed request whose inner
   * path is `path` with `answer()` — a 200 sealed back under the request's own
   * context, anything else as it is, as a proxy's page would be — and hands
   * everything else to the real handler (#1192). For a client's test of an
   * answer only the instance could now give: since every moderator and sync
   * route is sealed, nobody on the way can write one.
   */
  answeringAs(path: string, answer: () => Response): (request: Request) => Promise<Response>;
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
  /** The history index over the same store (#835): sync schedules a catch-up after each item. */
  readonly history: History;
  /** Riders' rooms (#784, #785), over the same store. */
  readonly rooms: Rooms;
  /** Rooms' routes, as the memory blob store keeps them: a store of their own, not sync's. */
  readonly roomRoutes: MemoryBlobs;
  /**
   * The instance's own keys (#1189), made with a test secret before the
   * listener starts, so `/v1/sealed` has an encryption key to open with (#1191).
   */
  readonly instanceKeys: InstanceKeys;
  /** `/v1/sealed`'s replay record, clock and HPKE port (#1191). */
  readonly sealed: Sealed;
  /** The analysis jobs, when the world was given an engine (#1095). */
  readonly analysis: AnalysisJobs | undefined;
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
    /**
     * The history index's embedding model (#835): a scripted one unless a
     * test hands its own, or `null` for an instance with the index off.
     */
    embedder?: Embedder | null;
    /** The listener's configuration, over the test defaults — an instance name, say (#777). */
    config?: Partial<Config>;
    /**
     * The instance's origin is the listener's own `http://127.0.0.1:<port>`
     * rather than {@link TEST_ORIGIN}, so a real browser that reached it by
     * that address can sign for it (#777's browser gate).
     */
    originIsTheListener?: boolean;
    /** The rooms' rate limits (#784): the defaults unless a test of them sets its own. */
    roomLimits?: RoomLimits;
    /** A new room code each call — `code.ts`'s unless a test needs a known one. */
    roomCode?: () => string;
    /** `/v1/sealed`'s HPKE port: the instance's own unless a test counts its calls (#1191). */
    sealedPrimitives?: Sealed['primitives'];
    /** The route table: the production one unless a test adds a route of its own (#1191). */
    routes?: readonly Route[];
    /**
     * An instance with no `OYL_INSTANCE_SECRET_KEY` (#1192, ADR 0047 D-7): it
     * holds no keys, so it has no sealed routes, and `call` sends every route
     * in plaintext.
     */
    keyless?: boolean;
    /**
     * Where the world's clock starts, Unix milliseconds — 2026-09-21 unless a
     * test says otherwise. A real browser judges the instance's key statements
     * by its own clock (#1190), so a browser gate that seals (#1192) starts the
     * world at `Date.now()`.
     */
    startsAt?: number;
    /**
     * Analysis jobs (#1095), built over the world's own store and clock by
     * this function — a test hands the engine and whatever else it sets.
     */
    analysis?: Omit<AnalysisJobsOptions, 'store' | 'now'>;
    /** What `/metrics` would count of each response. */
    observe?: (route: string | null, status: number, code: string | undefined) => void;
  } = {},
): Promise<IdentityInstance> {
  const directory = await mkdtemp(join(tmpdir(), 'oyl-instance-identity-'));
  const path = join(directory, 'instance.sqlite');
  const store = await openSqlStore(path);
  const mail: { address: string; token: string; subject: string; text: string }[] = [];
  const confirmations: { address: string; token: string; subject: string; text: string }[] = [];
  const {
    emailRecovery,
    storeSeenBy,
    probes,
    syncStoreSeenBy,
    blobStoreSeenBy,
    bodyLimitBytes,
    embedder,
    config,
    originIsTheListener,
    roomLimits,
    roomCode,
    sealedPrimitives,
    routes,
    keyless,
    startsAt,
    analysis,
    observe,
    ...rest
  } = options;
  const clock: TestClock = { ms: startsAt ?? 1_790_000_000_000 };
  const identityFor = (origin: string): Identity =>
    createIdentity({
      // The identity tests predate registration modes (#775) and register
      // riders as they sign in; a test of a mode names it. The default an
      // instance really starts with is `approval`, asserted in registration.test.ts.
      registration: 'open',
      // Every test rider signs in from one loopback address, so the per-address
      // registration limit (#775) would be what these tests measured. A test of
      // that limit sets it.
      // And since #1192 every test of a sealed route is a sealed request, so
      // the sealed limits are not what these tests measured either.
      limits: {
        ...DEFAULT_LIMITS,
        registrationPerAddress: { limit: 10_000, windowMs: 60_000 },
        sealedPerSession: { limit: 10_000, windowMs: 60_000 },
        sessionlessSealedPerAddress: { limit: 10_000, windowMs: 60_000 },
      },
      ...rest,
      store: storeSeenBy === undefined ? store : storeSeenBy(store),
      origin,
      now: () => clock.ms,
      ...(emailRecovery === true || emailRecovery === 'failing'
        ? {
            emailRecovery: {
              send: (address, token, written) => {
                if (emailRecovery === 'failing') return Promise.reject(new Error('no mail'));
                mail.push({ address, token, ...written });
                return Promise.resolve();
              },
              confirm: (address, token, written) => {
                if (emailRecovery === 'failing') return Promise.reject(new Error('no mail'));
                confirmations.push({ address, token, ...written });
                return Promise.resolve();
              },
            },
          }
        : {}),
    });
  const blobs: MemoryBlobs = new Map();
  const memoryBlobs = createMemoryBlobStore(blobs);
  const history = createHistory({
    store,
    embedder: embedder === null ? undefined : (embedder ?? scriptedEmbedder()),
    now: () => clock.ms,
  });
  const sync = createSync({
    store: syncStoreSeenBy === undefined ? store : syncStoreSeenBy(store),
    blobs: blobStoreSeenBy === undefined ? memoryBlobs : blobStoreSeenBy(memoryBlobs),
    now: () => clock.ms,
    itemStored: () => {
      history.schedule();
    },
  });
  const listenerConfig = { bodyLimitBytes: bodyLimitBytes ?? 16_384, ...config };
  const roomRoutes: MemoryBlobs = new Map();
  // The rooms read names through the identity the listener is given, which
  // for the browser gate is only made once the listener has a port.
  const people: { identity?: Identity } = {};
  const rooms = createRooms({
    store,
    routes: createMemoryBlobStore(roomRoutes),
    nameFor: async (viewerId, subjectId) => {
      const identity = people.identity;
      if (identity === undefined) return undefined;
      if (!(await identity.moderation.canSee(viewerId, subjectId))) return undefined;
      const profile = await identity.profile(subjectId);
      return profile.ok ? profile.value.displayName : undefined;
    },
    now: () => clock.ms,
    ...(roomLimits === undefined ? {} : { limits: roomLimits }),
    ...(roomCode === undefined ? {} : { code: roomCode }),
  });
  const keysFor = async (origin: string): Promise<InstanceKeys> => {
    const keys = createInstanceKeys({
      store,
      secret: keyless === true ? undefined : secretBytes(7),
      origin,
      now: () => Math.floor(clock.ms / 1000),
    });
    if (keyless !== true) await keys.maintain();
    return keys;
  };
  /** Something made only once the listener has a port, forwarded to until then (#777). */
  const forwardingTo = <T extends object>(made: { value?: T }, what: string): T =>
    new Proxy({} as T, {
      get: (_target, key) => {
        const real = made.value;
        if (real === undefined) throw new Error(`the ${what} was used before it was made`);
        const value = Reflect.get(real, key) as unknown;
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(real)
          : value;
      },
    });
  // The keys state the instance's origin (#1189), so a world whose origin is
  // its listener's makes them once the listener has a port, as it does the identity.
  const madeKeys: { value?: InstanceKeys } = {};
  if (originIsTheListener !== true) madeKeys.value = await keysFor(TEST_ORIGIN);
  const instanceKeys = madeKeys.value ?? forwardingTo(madeKeys, 'instance keys');
  const sealed = createSealed({
    store,
    now: () => clock.ms,
    ...(sealedPrimitives === undefined ? {} : { primitives: sealedPrimitives }),
  });
  const analysisJobs =
    analysis === undefined
      ? undefined
      : createAnalysisJobs({ ...analysis, store, now: () => clock.ms });
  const started = (identity: Identity): Promise<TestInstance> =>
    startTestInstance({
      ...(analysisJobs === undefined ? {} : { analysis: analysisJobs }),
      ...(observe === undefined ? {} : { observe }),
      identity,
      sync,
      history,
      rooms,
      instanceKeys,
      sealed,
      config: listenerConfig,
      ...(probes === undefined ? {} : { probes }),
      ...(routes === undefined ? {} : { routes }),
    });
  let identity: Identity;
  let instance: TestInstance;
  if (originIsTheListener === true) {
    // The browser gate's case (#777): a real page signs for the address it
    // really reached, which is known only once the listener has a port. So the
    // handler is given a stand-in that forwards to the identity made then.
    const made: { value?: Identity } = {};
    instance = await started(forwardingTo(made, 'identity'));
    made.value = identityFor(instance.url);
    identity = made.value;
    madeKeys.value = await keysFor(instance.url);
  } else {
    identity = identityFor(TEST_ORIGIN);
    instance = await started(identity);
  }
  people.identity = identity;

  /** Every device the world has seen, by public key, and whose session each token is. */
  const devices = EVERY_DEVICE;
  const holders = new Map<string, TestDevice>();
  /** Which device signed the sealed request a response answers. */
  const signers = new WeakMap<Response, TestDevice>();
  const table = routes ?? ROUTES;
  /** Whether `method path` is a sealed route of this table (#1192). */
  const sealedRoute = (method: string, route: string): boolean => {
    const pathname = route.split('?')[0] ?? route;
    const found = table.find(
      (candidate) =>
        candidate.method === method && matchPath(candidate.path, pathname) !== undefined,
    );
    return found?.sealed === 'only' || (found?.sealed === 'new-key' && method === 'POST');
  };
  const sessionless = (route: string): boolean =>
    ['/v1/auth/session', '/v1/auth/link', '/v1/auth/recover'].includes(route);

  /** A session token an answer carries is the signer's, or the statement key's device's. */
  const remember = (sent: unknown, answered: unknown, signer: TestDevice | undefined): void => {
    const token = (answered as { sessionToken?: unknown } | null)?.sessionToken;
    if (typeof token !== 'string') return;
    const key = (sent as { publicKey?: unknown } | undefined)?.publicKey;
    const holder = signer ?? (typeof key === 'string' ? devices.get(key) : undefined);
    if (holder !== undefined) holders.set(token, holder);
  };

  const request: IdentityInstance['request'] = async (method, route, callOptions = {}) => {
    const raw =
      callOptions.body === undefined
        ? undefined
        : callOptions.body instanceof Uint8Array
          ? callOptions.body
          : new TextEncoder().encode(JSON.stringify(callOptions.body));
    if (callOptions.plain === true || !instanceKeys.configured || !sealedRoute(method, route)) {
      const headers: Record<string, string> = { ...callOptions.headers };
      if (callOptions.token !== undefined) headers.authorization = `Bearer ${callOptions.token}`;
      if (raw !== undefined) headers['content-type'] = 'application/json';
      return fetch(`${instance.url}${route}`, {
        method,
        headers,
        ...(raw === undefined ? {} : { body: raw }),
      });
    }
    const statementKey = (callOptions.body as { publicKey?: unknown } | undefined)?.publicKey;
    const signer =
      callOptions.signer !== undefined
        ? callOptions.signer
        : callOptions.token !== undefined
          ? holders.get(callOptions.token)
          : sessionless(route) && typeof statementKey === 'string'
            ? devices.get(statementKey)
            : undefined;
    const sealed = await sealFor(world, {
      method,
      path: route,
      ...(raw === undefined ? {} : { body: raw }),
      ...(callOptions.token === undefined ? {} : { token: callOptions.token }),
      signer: signer?.signingKey ?? null,
    });
    const headers: Record<string, string> = {
      ...callOptions.headers,
      'content-type': 'application/json',
    };
    if (callOptions.token !== undefined) headers.authorization = `Bearer ${callOptions.token}`;
    const response = await fetch(`${instance.url}${SEALED_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sealed.envelope),
    });
    const text = await response.text();
    let envelope: unknown;
    try {
      envelope = JSON.parse(text) as unknown;
    } catch {
      envelope = undefined;
    }
    if (
      response.status !== 200 ||
      typeof envelope !== 'object' ||
      envelope === null ||
      !('nonce' in envelope)
    ) {
      // A plaintext refusal before the request opened, exactly as it came.
      return new Response(text === '' ? null : text, {
        status: response.status,
        headers: response.headers,
      });
    }
    const reply = await sealed.openReply(envelope);
    const headers2 = new Headers(response.headers);
    headers2.set('content-type', reply.contentType);
    const bodyless = reply.status === 204 || reply.status === 304;
    const opened = new Response(bodyless ? null : reply.body.slice(), {
      status: reply.status,
      headers: headers2,
    });
    if (signer !== null && signer !== undefined) signers.set(opened, signer);
    return opened;
  };

  const call: IdentityInstance['call'] = async (method, route, callOptions = {}) => {
    const response = await request(method, route, callOptions);
    const text = await response.text();
    const body = text === '' ? null : (JSON.parse(text) as unknown);
    remember(callOptions.body, body, signers.get(response));
    return { status: response.status, body };
  };

  const nonceFor = async (device: TestDevice): Promise<string> => {
    devices.set(device.publicKey, device);
    const answer = await call('POST', '/v1/auth/challenge', {
      body: { publicKey: device.publicKey },
    });
    const nonce = (answer.body as { nonce?: unknown }).nonce;
    if (typeof nonce !== 'string') throw new Error(`no nonce: ${JSON.stringify(answer)}`);
    return nonce;
  };

  const world: IdentityInstance = {
    instance,
    url: instance.url,
    identity,
    clock,
    path,
    mail,
    blobs,
    sync,
    history,
    rooms,
    roomRoutes,
    instanceKeys,
    sealed,
    analysis: analysisJobs,
    confirmations,
    call,
    request,
    answeringAs: (path, answer) => async (request) => {
      if (new URL(request.url).pathname !== SEALED_PATH) return instance.handler(request);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await request.clone().text());
      } catch {
        return instance.handler(request);
      }
      const envelope =
        typeof parsed === 'object' && parsed !== null
          ? parseSealedEnvelope(parsed as Record<string, unknown>)
          : undefined;
      const recipient =
        envelope === undefined ? undefined : await instanceKeys.encryptionKey(envelope.keyId);
      if (envelope === undefined || recipient === undefined) return instance.handler(request);
      const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
      const binding = {
        instanceOrigin: identity.origin,
        keyId: envelope.keyId,
        tokenSha256: token === undefined ? null : toHex(await sha256(utf8Encode(token))),
      };
      let opened;
      try {
        opened = await openSealedRequest(instanceHpkePrimitives, recipient, envelope, binding);
      } catch {
        return instance.handler(request);
      }
      const named = decodeFrame(unpad(opened.padded)).header.path;
      const inner = (typeof named === 'string' ? named : '').split('?')[0];
      if (inner !== path) return instance.handler(request);
      const replaced = answer();
      if (replaced.status !== 200) return replaced;
      const writer = await sealedReplyWriter(instanceHpkePrimitives, opened.context, binding);
      const body = new Uint8Array(await replaced.arrayBuffer());
      return Response.json(
        await writer.reply(200, replaced.headers.get('content-type') ?? 'application/json', body),
      );
    },
    holds: (device, token) => {
      devices.set(device.publicKey, device);
      holders.set(token, device);
    },
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
      await analysisJobs?.stop();
      await instance.listening.close();
      await history.idle();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
  return world;
}
