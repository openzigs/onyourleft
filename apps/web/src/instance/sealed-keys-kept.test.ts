// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A port keeps the instance's verified key for its sign-in** (#2776),
 * end to end against the REAL instance. Reading `GET /v1/instance/keys`
 * before every sealed request made each AI decision two round trips through a
 * tunnel; now a port reads the keys once and seals to the key it verified
 * until the trust runs out (D-5), the sign-in changes, the device has verified
 * a higher serial elsewhere, or the instance answers `instance_key_unknown` —
 * and then reads once and seals the request again once.
 *
 * What does not change is the judgement: only a key that verified under the
 * pin is kept, a forged or unverified key is refused as before, and an edge
 * that forges the refusal or the keys gets no second copy of the request.
 */

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import {
  createStoreHarness,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import {
  createInstancePort,
  heldSealedSession,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from './sign-in';
import { LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly clock: { ms: number };
  readonly instanceKeys: {
    show(): Promise<{ readonly card: string }>;
    rotate(options?: { readonly dropOld?: boolean }): Promise<{ readonly serial: number }>;
    maintain(): Promise<unknown>;
    rotateIdentity(options: { readonly compromised: boolean }): Promise<unknown>;
  };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(): Promise<IdentityInstance>;
}

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;
const NOW = unixSeconds(1_790_000_000);
const KEYS = 'GET /v1/instance/keys';
const SEALED = 'POST /v1/sealed';

let testing: IdentityTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
});

/** What stands between the device and the instance: it may rewrite an answer. */
type Edge = (request: Request, forward: () => Promise<Response>) => Promise<Response>;

async function world() {
  const w = await testing.startIdentityInstance();
  worlds.push(w);
  const seen: string[] = [];
  const edge: { rewrite?: Edge | undefined } = {};
  const send: InstanceSend = async (url, init) => {
    seen.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    const request = new Request(url, init);
    const forward = () => w.instance.handler(new Request(url, init));
    return edge.rewrite === undefined ? forward() : edge.rewrite(request, forward);
  };
  return { w, send, seen, edge };
}

function mapStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** A device signed in to `w` with its card, and a port's sealed session (as the pacer's is built). */
async function connected(send: InstanceSend, w: IdentityInstance) {
  const harness = createStoreHarness();
  harnesses.push(harness);
  let open: PersistentStore | undefined;
  await harness.write((store) => {
    open = store;
    return ensureLocalAthlete(store, NOW);
  });
  const store = (): PersistentStore => open as PersistentStore;
  const clock = { ms: NOW * 1000 };
  const sealing = {
    storage: mapStorage(),
    loadedFrom: LOADED_LOCALLY,
    signingKey: () => ensureDeviceSigningKey(store(), LOCAL_ATHLETE, { now: () => NOW }),
    send,
    now: () => clock.ms,
  };
  const instance = createInstancePort({
    ...sealing,
    ensureLocalAthlete: () => ensureLocalAthlete(store(), NOW),
  });
  const card = (await w.instanceKeys.show()).card;
  expect(await instance.connect(testing.TEST_ORIGIN, 'Anna', card)).toMatchObject({
    kind: 'connected',
  });
  const session = heldSealedSession(sealing);
  /** One sealed call as a port makes it: the session, then `GET /v1/auth/session` sealed. */
  const ask = async (): Promise<number | string> => {
    const held = await session();
    if (held.kind === 'closed') return held.why;
    return (await held.sealed.call('GET', '/v1/auth/session', { token: held.token })).status;
  };
  return { instance, sealing, session, ask, clock, card };
}

/** How many times `what` was sent since `from`. */
const count = (seen: readonly string[], what: string, from = 0): number =>
  seen.slice(from).filter((each) => each === what).length;

describe('the instance’s verified key, kept for the sign-in (#2776)', () => {
  it('makes ONE key read for N sealed calls', async () => {
    const { w, send, seen } = await world();
    const { ask } = await connected(send, w);
    const from = seen.length;
    for (let n = 0; n < 6; n += 1) expect(await ask()).toBe(200);
    expect(count(seen, KEYS, from)).toBe(1);
    expect(count(seen, SEALED, from)).toBe(6);
  });

  it('shares one key read between calls asked at once', async () => {
    const { w, send, seen } = await world();
    const { ask } = await connected(send, w);
    const from = seen.length;
    expect(await Promise.all([ask(), ask(), ask()])).toEqual([200, 200, 200]);
    expect(count(seen, KEYS, from)).toBe(1);
  });

  it('reads once and seals again once when the instance no longer holds the key, then keeps the new one', async () => {
    const { w, send, seen } = await world();
    const { ask } = await connected(send, w);
    expect(await ask()).toBe(200);
    // The old key's private half deleted at once (D-10): the instance refuses it.
    await w.instanceKeys.rotate({ dropOld: true });
    const from = seen.length;
    expect(await ask()).toBe(200);
    expect(seen.slice(from)).toEqual([SEALED, KEYS, SEALED]);
    const after = seen.length;
    expect(await ask()).toBe(200);
    expect(seen.slice(after)).toEqual([SEALED]);
  });

  it('reads again when the trust in the key runs out (D-5)', async () => {
    const { w, send, seen } = await world();
    const { ask, clock } = await connected(send, w);
    expect(await ask()).toBe(200);
    const from = seen.length;
    // Just inside the device's 48 hours from its first verification: still kept.
    clock.ms += (48 * 60 * 60 - 60) * 1000;
    w.clock.ms += (48 * 60 * 60 - 60) * 1000;
    await w.instanceKeys.maintain();
    expect(await ask()).toBe(200);
    expect(count(seen, KEYS, from)).toBe(0);
    // Past it: read again, and the instance's renewed statement is trusted.
    clock.ms += 120 * 1000;
    w.clock.ms += 120 * 1000;
    expect(await ask()).toBe(200);
    expect(count(seen, KEYS, from)).toBe(1);
  });

  it('reads again on a new sign-in', async () => {
    const { w, send, seen } = await world();
    const { ask, instance, sealing, card } = await connected(send, w);
    expect(await ask()).toBe(200);
    const token = sealing.storage.getItem(INSTANCE_SESSION_STORAGE_KEY);
    expect(await instance.connect(testing.TEST_ORIGIN, '', card)).toMatchObject({
      kind: 'connected',
    });
    expect(sealing.storage.getItem(INSTANCE_SESSION_STORAGE_KEY)).not.toBe(token);
    const from = seen.length;
    expect(await ask()).toBe(200);
    expect(count(seen, KEYS, from)).toBe(1);
    expect(await ask()).toBe(200);
    expect(count(seen, KEYS, from)).toBe(1);
  });

  it('reads again once the device has verified a higher serial elsewhere, so it never seals below it', async () => {
    const { w, send, seen } = await world();
    const { ask, instance } = await connected(send, w);
    expect(await ask()).toBe(200);
    // A rotation in the overlap: the kept key still opens, but the Keys screen verifies serial 2.
    const rotated = await w.instanceKeys.rotate();
    expect(await instance.keys()).toMatchObject({ kind: 'trusted', serial: rotated.serial });
    const from = seen.length;
    expect(await ask()).toBe(200);
    expect(count(seen, KEYS, from)).toBe(1);
  });
});

describe('what the kept key does not change (#2776)', () => {
  /** The keys' answer with every statement's encryption key replaced: it no longer verifies. */
  const forgedKeys: Edge = async (request, forward) => {
    const answer = await forward();
    if (new URL(request.url).pathname !== '/v1/instance/keys') return answer;
    const body = (await answer.json()) as {
      statements: { statement: Record<string, unknown> }[];
    };
    for (const each of body.statements) each.statement.encryptionKey = 'ab'.repeat(32);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  it('still refuses a forged or unverified key, and seals nothing to it', async () => {
    const { w, send, seen, edge } = await world();
    const { ask } = await connected(send, w);
    edge.rewrite = forgedKeys;
    const from = seen.length;
    expect(await ask()).toBe('keys');
    expect(count(seen, SEALED, from)).toBe(0);
    // Nothing was kept from it: the next call reads the keys again.
    expect(await ask()).toBe('keys');
    expect(count(seen, KEYS, from)).toBe(4);
    edge.rewrite = undefined;
    expect(await ask()).toBe(200);
  });

  it('closes at once, kept key or not, when the instance’s identity endorsed a new card (D-14 Q8)', async () => {
    const { w, send, seen } = await world();
    const { ask, instance } = await connected(send, w);
    expect(await ask()).toBe(200);
    await w.instanceKeys.rotateIdentity({ compromised: false });
    expect(await instance.keys()).toMatchObject({ kind: 'needs-new-card' });
    const from = seen.length;
    expect(await ask()).toBe('gate');
    expect(seen.slice(from)).toEqual([]);
  });

  it('reads the keys again once a new card is confirmed, though the session token is kept (D-10)', async () => {
    const { w, send, seen } = await world();
    const { ask, instance, sealing } = await connected(send, w);
    expect(await ask()).toBe(200);
    const token = sealing.storage.getItem(INSTANCE_SESSION_STORAGE_KEY);
    await w.instanceKeys.rotateIdentity({ compromised: false });
    expect(await instance.keys()).toMatchObject({ kind: 'needs-new-card' });
    const next = (await w.instanceKeys.show()).card;
    expect(await instance.offerCard(next)).toMatchObject({ kind: 'confirm' });
    expect(await instance.confirmCard(next)).toEqual({ kind: 'pinned' });
    // Only the pin changed: the sign-in's session token is the same one.
    expect(sealing.storage.getItem(INSTANCE_SESSION_STORAGE_KEY)).toBe(token);
    const from = seen.length;
    expect(await ask()).toBe(200);
    // The key kept under the OLD identity key is not sealed to again unread.
    expect(count(seen, KEYS, from)).toBe(1);
  });

  it('shares one refused read between calls asked at once, and keeps nothing of it', async () => {
    const { w, send, seen, edge } = await world();
    const { ask } = await connected(send, w);
    edge.rewrite = forgedKeys;
    const from = seen.length;
    expect(await Promise.all([ask(), ask(), ask()])).toEqual(['keys', 'keys', 'keys']);
    // One judgement, which re-reads once before an out-of-date verdict (D-5).
    expect(count(seen, KEYS, from)).toBe(2);
    expect(count(seen, SEALED, from)).toBe(0);
  });

  it('reads and resends nothing when the sign-in went, or a new card is awaited, while the call was out', async () => {
    for (const change of ['signed-out', 'new-card'] as const) {
      const { w, send, seen, edge } = await world();
      const { ask, sealing } = await connected(send, w);
      expect(await ask()).toBe(200);
      await w.instanceKeys.rotate({ dropOld: true });
      edge.rewrite = async (request, forward) => {
        if (new URL(request.url).pathname === '/v1/sealed') {
          if (change === 'signed-out') {
            sealing.storage.removeItem(INSTANCE_SESSION_STORAGE_KEY);
          } else {
            const account = JSON.parse(
              sealing.storage.getItem(INSTANCE_ACCOUNT_STORAGE_KEY) ?? '{}',
            ) as Record<string, unknown>;
            sealing.storage.setItem(
              INSTANCE_ACCOUNT_STORAGE_KEY,
              JSON.stringify({ ...account, expectedFingerprint: 'A'.repeat(52) }),
            );
          }
        }
        return forward();
      };
      const from = seen.length;
      expect(await ask(), change).toBe(400);
      expect(seen.slice(from), change).toEqual([SEALED]);
    }
  });

  it('seals nothing again when the keys read after a refusal are forged', async () => {
    const { w, send, seen, edge } = await world();
    const { ask } = await connected(send, w);
    expect(await ask()).toBe(200);
    await w.instanceKeys.rotate({ dropOld: true });
    edge.rewrite = forgedKeys;
    const from = seen.length;
    expect(await ask()).toBe(400);
    expect(count(seen, SEALED, from)).toBe(1);
  });

  it('sends no second copy for a forged `instance_key_unknown` when the keys are unchanged', async () => {
    const { w, send, seen, edge } = await world();
    const { ask } = await connected(send, w);
    expect(await ask()).toBe(200);
    edge.rewrite = async (request, forward) =>
      new URL(request.url).pathname === '/v1/sealed'
        ? new Response(JSON.stringify({ error: { code: 'instance_key_unknown', message: '' } }), {
            status: 400,
          })
        : forward();
    const from = seen.length;
    expect(await ask()).toBe(400);
    expect(seen.slice(from)).toEqual([SEALED, KEYS]);
  });
});
