// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pinning the instance's identity key from an instance card (#1190, ADR 0047
 * D-5, D-6), through the REAL port against the REAL instance's identity routes
 * (`apps/instance`'s handler over a SQLite file, as `instance-port.test.ts`
 * reaches it) — with `GET /v1/instance/keys` answered by THIS file, signed
 * with real Ed25519 keys, so a test can serve another identity, an
 * endorsement, an older serial or a statement a year long.
 *
 * Every assertion about what is kept reads it back from the device's storage,
 * never from what a call returned.
 */

import {
  base32Unpadded,
  INSTANCE_IDENTITY_ROTATION_PURPOSE,
  INSTANCE_KEY_PURPOSE,
  instanceCard,
  instanceIdentityFingerprint,
  instanceIdentityRotationBytes,
  instanceKeyStatementBytes,
  NO_KEY_TRUST,
  toHex,
  unixSeconds,
  type InstanceIdentityRotation,
  type InstanceKeyStatement,
} from '@onyourleft/domain';
import { ensureDeviceSigningKey, webCryptoSha256 } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { eraseDevice } from '../transfer/erase-device';
import {
  cardFromPin,
  codeWithCard,
  INSTANCE_KEY_TEXT,
  olderKeyText,
  sealedRouteGate,
} from './instance-pin';
import {
  CONNECT_REFUSAL_TEXT,
  createInstancePort,
  instanceEraser,
  type InstancePortDependencies,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createModerationPort, INVITE_CARD_CAUTION } from './moderation-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY, readInstanceAccount, writeInstanceAccount } from './sign-in';
import { LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  /** The instance's own keys (#1189): its encryption key is what a sealed request opens under. */
  readonly instanceKeys: {
    served(): Promise<{
      readonly statements: readonly {
        readonly statement: { readonly keyId: string; readonly encryptionKey: string };
      }[];
    }>;
  };
  close(): Promise<void>;
}
interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    moderators?: { readonly owner: string };
  }): Promise<IdentityInstance>;
}
const INSTANCE_TESTING = new URL('../../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;

const T0 = 1_790_000_000;
const HOUR = 3600;
let testing: IdentityTesting;
let ORIGIN: string;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
  ORIGIN = testing.TEST_ORIGIN;
});

/**
 * Each test's instance, started first (#1192): the statements this file's own
 * identities sign name ITS encryption key, so a sealed request a device makes
 * after pinning one of those identities opens on the instance. What the pin
 * judges is the identity's signature; what the instance opens with is its key.
 */
let current: IdentityInstance;
beforeEach(async () => {
  current = await testing.startIdentityInstance();
  worlds.push(current);
});
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

/** An instance identity key: a real Ed25519 pair. */
interface Identity {
  readonly publicKey: string;
  sign(bytes: Uint8Array): Promise<string>;
  readonly fingerprint: Uint8Array;
  readonly card: string;
}

async function identity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const publicKey = toHex(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const fingerprint = await instanceIdentityFingerprint(webCryptoSha256, ORIGIN, publicKey);
  return {
    publicKey,
    fingerprint,
    card: instanceCard(ORIGIN, fingerprint),
    sign: async (bytes) =>
      toHex(
        new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, bytes as BufferSource)),
      ),
  };
}

async function statement(
  serial: number,
  members: Partial<InstanceKeyStatement> = {},
): Promise<InstanceKeyStatement> {
  // The instance's real encryption key (#1192), signed for by this file's identity.
  const real = (await current.instanceKeys.served()).statements.at(-1)?.statement;
  if (real === undefined) throw new Error('the instance serves no encryption key');
  return {
    purpose: INSTANCE_KEY_PURPOSE,
    instanceOrigin: ORIGIN,
    keyId: real.keyId,
    encryptionKey: real.encryptionKey,
    serial,
    notBefore: T0,
    issuedAt: T0,
    notAfter: T0 + 48 * HOUR,
    ...members,
  };
}

async function served(
  by: Identity,
  statements: readonly InstanceKeyStatement[],
  endorsements: readonly unknown[] = [],
) {
  return {
    identityKey: by.publicKey,
    statements: await Promise.all(
      statements.map(async (each) => ({
        statement: each,
        signature: await by.sign(instanceKeyStatementBytes(each)),
      })),
    ),
    endorsements,
  };
}

/** The instance's own handler for everything but its keys, which `keys.body` answers. */
function wire(world: IdentityInstance, keys: { body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (new URL(url).pathname === '/v1/instance/keys') {
      return new Response(JSON.stringify(keys.body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return world.instance.handler(new Request(url, init));
  });
}

function deviceStorage(): InstanceStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const clock = { s: T0 + HOUR };

function device(send: InstanceSend, storage = deviceStorage()) {
  const store = createStoreHarness();
  harnesses.push(store);
  const dependencies: InstancePortDependencies = {
    storage,
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () =>
      store.write(async (open) => ensureLocalAthlete(open, unixSeconds(T0))),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
    now: () => clock.s * 1000,
  };
  return { storage, store, dependencies, port: createInstancePort(dependencies) };
}

/** The pin as the device KEPT it: read back from storage. */
function keptPin(storage: { readonly map: Map<string, string> }): string | undefined {
  const raw = storage.map.get(INSTANCE_ACCOUNT_STORAGE_KEY);
  if (raw === undefined) return undefined;
  return (JSON.parse(raw) as { pin?: string }).pin;
}

const paths = (send: ReturnType<typeof wire>): string[] =>
  send.mock.calls.map(([url, init]) => `${init.method ?? 'GET'} ${new URL(url).pathname}`);

/** This test's instance, already started (`beforeEach`). */
function world(): Promise<IdentityInstance> {
  return Promise.resolve(current);
}

/** A device signed in with `card`, its pin kept. */
async function pinned(by: Identity, statements: readonly InstanceKeyStatement[]) {
  const keys = { body: await served(by, statements) };
  const send = wire(await world(), keys);
  const device_ = device(send);
  expect(await device_.port.connect(ORIGIN, 'Anna', by.card)).toMatchObject({
    kind: 'connected',
  });
  return { ...device_, keys, send };
}

describe('the first sign-in with a card (#1190, D-6)', () => {
  it('pins the card’s fingerprint when the instance’s keys verify under it', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const { storage, port } = await pinned(by, [await statement(T0)]);
    expect(keptPin(storage)).toBe(base32Unpadded(by.fingerprint));
    expect(await port.keys()).toMatchObject({ kind: 'trusted', serial: T0 });
  });

  it('refuses a mismatch loudly, sends nothing more, and keeps no pin', async () => {
    clock.s = T0 + HOUR;
    const [card, impostor] = [await identity(), await identity()];
    const keys = { body: await served(impostor, [await statement(T0)]) };
    const send = wire(await world(), keys);
    const { port, storage } = device(send);
    expect(await port.connect(ORIGIN, 'Anna', card.card)).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT.mismatch,
    });
    // Read back: nothing kept — no pin, no account, no token.
    expect(storage.map.size).toBe(0);
    expect(readInstanceAccount(storage)).toBeUndefined();
    // And only the keys were asked for: no sign-in, nothing sealed or plain.
    expect(paths(send)).toEqual(['GET /v1/instance/keys']);
  });

  it('refuses a card that differs from the instance’s only in its last character', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const { port, storage } = device(wire(await world(), keys));
    const text = base32Unpadded(by.fingerprint);
    // The last character carries 1 bit of fingerprint and 4 of padding: flip that bit.
    const last = text.at(-1) === 'A' ? 'Q' : 'A';
    const near = `${by.card.slice(0, -1)}${last}`;
    expect(await port.connect(ORIGIN, 'Anna', near)).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT.mismatch,
    });
    expect(storage.map.size).toBe(0);
  });

  it('refuses a card for another origin, or a damaged one, before anything is sent', async () => {
    const by = await identity();
    const send = vi.fn() as unknown as InstanceSend;
    const { port } = device(send);
    const other = instanceCard('https://other.example', by.fingerprint);
    expect(await port.connect(ORIGIN, 'Anna', other)).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT['other-origin'],
    });
    expect(await port.connect(ORIGIN, 'Anna', `${by.card}x`)).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT['not-a-card'],
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('no card, no sealed route (#1190, D-14 Q1)', () => {
  it('signs in with only an address, holds no pin, and every phase-1 gate says it needs the card', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const send = wire(await world(), keys);
    const { port, storage, dependencies } = device(send);
    // Signed in with only an address: this device's key is new, and a new key
    // registers only sealed (#1192) — so it registers through the instance's
    // own keys here, as another device of the rider's could have, and the
    // address-only sign-in is the one that follows.
    expect(await port.connect(ORIGIN, 'Anna', by.card)).toMatchObject({ kind: 'connected' });
    await port.disconnect();
    expect(await port.connect(ORIGIN, 'Anna')).toMatchObject({ kind: 'connected' });
    expect(keptPin(storage)).toBeUndefined();
    expect(sealedRouteGate(readInstanceAccount(storage), LOADED_LOCALLY)).toEqual({
      kind: 'needs-card',
      text: INSTANCE_KEY_TEXT['needs-card'],
    });
    expect(await port.keys()).toEqual({ kind: 'no-card', text: INSTANCE_KEY_TEXT['needs-card'] });
    expect(await port.linkCode()).toEqual({
      kind: 'unavailable',
      text: INSTANCE_KEY_TEXT['needs-card'],
    });
    const moderation = createModerationPort(dependencies);
    expect(await moderation.mintInvite('A friend')).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT['needs-card'],
    });
    // No link code and no invitation was asked of the instance.
    expect(paths(send).filter((path) => /link-codes|invites/.test(path))).toEqual([]);
  });

  it('pins later from a card offered on the Instance screen', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const { port, storage } = device(wire(await world(), keys));
    // Registered with the card (a new key registers only sealed, #1192), then
    // signed in again with only the address, which keeps no pin.
    await port.connect(ORIGIN, 'Anna', by.card);
    await port.disconnect();
    await port.connect(ORIGIN, 'Anna');
    expect(keptPin(storage)).toBeUndefined();
    expect(await port.offerCard(by.card)).toEqual({ kind: 'pinned' });
    expect(keptPin(storage)).toBe(base32Unpadded(by.fingerprint));
  });
});

describe('never a silent re-pin (#1190, D-6, D-14 Q8)', () => {
  it('refuses keys from another identity, and the stored pin is byte-identical', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const { port, storage, keys } = await pinned(by, [await statement(T0)]);
    const before = storage.map.get(INSTANCE_ACCOUNT_STORAGE_KEY);
    keys.body = await served(await identity(), [await statement(T0 + 1)]);
    const outcome = await port.keys();
    expect(outcome).toMatchObject({ kind: 'refused', text: INSTANCE_KEY_TEXT.mismatch });
    expect(keptPin(storage)).toBe(base32Unpadded(by.fingerprint));
    expect(storage.map.get(INSTANCE_ACCOUNT_STORAGE_KEY)).toBe(before);
  });

  it('asks for a card on an endorsement, keeps the pin, and replaces it only on the endorsed card confirmed', async () => {
    clock.s = T0 + HOUR;
    const old = await identity();
    const { port, storage, keys } = await pinned(old, [await statement(T0)]);
    const next = await identity();
    const rotation: InstanceIdentityRotation = {
      purpose: INSTANCE_IDENTITY_ROTATION_PURPOSE,
      instanceOrigin: ORIGIN,
      previousIdentityKey: old.publicKey,
      identityKey: next.publicKey,
      fingerprint: base32Unpadded(next.fingerprint),
      issuedAt: T0,
    };
    keys.body = await served(
      next,
      [await statement(T0)],
      [{ statement: rotation, signature: await old.sign(instanceIdentityRotationBytes(rotation)) }],
    );
    expect(await port.keys()).toEqual({
      kind: 'needs-new-card',
      text: INSTANCE_KEY_TEXT['needs-new-card'],
      pinned: base32Unpadded(old.fingerprint),
      expected: base32Unpadded(next.fingerprint),
    });
    // The pin did not move on the endorsement; sealing stops.
    expect(keptPin(storage)).toBe(base32Unpadded(old.fingerprint));
    expect(sealedRouteGate(readInstanceAccount(storage), LOADED_LOCALLY).kind).toBe(
      'needs-new-card',
    );
    expect(await port.linkCode()).toMatchObject({ kind: 'unavailable' });

    // A card that is not the endorsed one changes nothing.
    const stranger = await identity();
    expect(await port.offerCard(stranger.card)).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT['not-the-endorsed-card'],
    });
    // The endorsed card is shown with both fingerprints, and not yet kept.
    expect(await port.offerCard(next.card)).toEqual({
      kind: 'confirm',
      text: INSTANCE_KEY_TEXT['confirm-new-card'],
      pinned: base32Unpadded(old.fingerprint),
      offered: base32Unpadded(next.fingerprint),
    });
    expect(keptPin(storage)).toBe(base32Unpadded(old.fingerprint));
    // Confirmed: replaced, and sealing may resume.
    expect(await port.confirmCard(next.card)).toEqual({ kind: 'pinned' });
    expect(keptPin(storage)).toBe(base32Unpadded(next.fingerprint));
    expect(sealedRouteGate(readInstanceAccount(storage), LOADED_LOCALLY).kind).toBe('open');
    expect(await port.keys()).toMatchObject({ kind: 'trusted' });
  });
});

describe('no going back, and the 48-hour cap (#1190, D-5)', () => {
  it('after serial 5, an answer serving only serial 4 is refused naming 5, re-read once first', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const five = await statement(5);
    const four = await statement(4);
    const { port, storage, keys, send } = await pinned(by, [five, four]);
    expect(await port.keys()).toMatchObject({ kind: 'trusted', serial: 5 });

    keys.body = await served(by, [four]);
    const reads = paths(send).filter((path) => path.endsWith('/v1/instance/keys')).length;
    expect(await port.keys()).toMatchObject({ kind: 'refused', text: olderKeyText(5) });
    expect(paths(send).filter((path) => path.endsWith('/v1/instance/keys')).length).toBe(reads + 2);
    expect(readInstanceAccount(storage)?.keyTrust?.highestSerial).toBe(5);

    // A re-signed statement for the same key and serial is accepted.
    keys.body = await served(by, [await statement(5, { issuedAt: T0 + 2 * HOUR })]);
    expect(await port.keys()).toMatchObject({ kind: 'trusted', serial: 5 });
  });

  it('stops trusting a year-long statement 48 hours after first verifying it, and accepts an issuedAt in the future', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const yearLong = await statement(T0, {
      issuedAt: T0 + 10 * HOUR,
      notAfter: T0 + 365 * 24 * HOUR,
    });
    const { port } = await pinned(by, [yearLong]);
    expect(await port.keys()).toMatchObject({ kind: 'trusted' });
    clock.s = T0 + HOUR + 48 * HOUR - 1;
    expect(await port.keys()).toMatchObject({ kind: 'trusted' });
    clock.s = T0 + HOUR + 48 * HOUR;
    expect(await port.keys()).toMatchObject({ kind: 'refused', text: INSTANCE_KEY_TEXT.expired });
  });
});

describe('the card a device shows is composed from its own pin (#1190, D-6)', () => {
  it('puts THIS device’s card beside the link code, whatever card field the instance answers', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const real = wire(await world(), keys);
    const planted = instanceCard(ORIGIN, (await identity()).fingerprint);
    const send = vi.fn(async (url: string, init: RequestInit) => {
      const answer = await real(url, init);
      if (!new URL(url).pathname.endsWith('/link-codes')) return answer;
      const body = (await answer.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...body, card: planted }), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { port, storage } = device(send);
    await port.connect(ORIGIN, 'Anna', by.card);
    const shown = await port.linkCode();
    expect(shown.kind).toBe('shown');
    if (shown.kind !== 'shown') return;
    expect(shown.card).toBe(by.card);
    expect(shown.card).toBe(cardFromPin(readInstanceAccount(storage)));
    expect(shown.offer).toBe(codeWithCard(by.card, shown.linkCode));
    expect(shown.offer).not.toContain(planted);
  });

  it('links a second device from that line, which pins the same card', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const send = wire(await world(), keys);
    const first = device(send);
    await first.port.connect(ORIGIN, 'Anna', by.card);
    const shown = await first.port.linkCode();
    if (shown.kind !== 'shown') throw new Error('no link code');
    const second = device(send);
    expect(await second.port.link(shown.offer)).toEqual({ kind: 'connected' });
    expect(keptPin(second.storage)).toBe(base32Unpadded(by.fingerprint));
  });

  it('links nothing, and keeps nothing, when the line’s card does not match the instance', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const send = wire(await world(), keys);
    const first = device(send);
    await first.port.connect(ORIGIN, 'Anna', by.card);
    const shown = await first.port.linkCode();
    if (shown.kind !== 'shown') throw new Error('no link code');
    keys.body = await served(await identity(), [await statement(T0)]);
    const second = device(send);
    const before = send.mock.calls.length;
    expect(await second.port.link(shown.offer)).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT.mismatch,
    });
    expect(second.storage.map.size).toBe(0);
    expect(paths(send).slice(before)).toEqual(['GET /v1/instance/keys']);
  });

  it('puts THIS device’s card in an invitation: the card from its own pin, the code from the instance', async () => {
    // Since #1192 the invitation is minted SEALED, so its answer is the
    // instance's and nobody on the way can plant a card in it; what is held
    // here is that the card beside the code is the device's own.
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys: { body: unknown } = { body: undefined };
    let routed = current;
    const routing: InstanceSend = (url, init) => wire(routed, keys)(url, init);
    const owner = device(routing);
    await owner.dependencies.ensureLocalAthlete();
    const ownerKey = toHex((await owner.dependencies.signingKey()).publicKey);
    // An instance whose owner moderator is this device's key.
    current = await testing.startIdentityInstance({ moderators: { owner: ownerKey } });
    worlds.push(current);
    routed = current;
    keys.body = await served(by, [await statement(T0)]);
    expect(await owner.port.connect(ORIGIN, 'Owner', by.card)).toMatchObject({
      kind: 'connected',
    });
    const minted = await createModerationPort(owner.dependencies).mintInvite('A friend');
    expect(minted.kind).toBe('minted');
    if (minted.kind !== 'minted') return;
    expect(minted.card).toBe(by.card);
    expect(minted.card).toBe(cardFromPin(readInstanceAccount(owner.storage)));
    expect(minted.invite).toBe(codeWithCard(by.card, minted.inviteCode));
    expect(INVITE_CARD_CAUTION).toMatch(/channel/);
  });
});

describe('disconnecting and erasing forget the pin (#1190)', () => {
  it('disconnect removes the pin and the highest serial', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const { port, storage } = await pinned(by, [await statement(T0)]);
    expect(readInstanceAccount(storage)?.keyTrust?.highestSerial).toBe(T0);
    await port.disconnect();
    expect(storage.map.get(INSTANCE_ACCOUNT_STORAGE_KEY)).toBeUndefined();
    expect(readInstanceAccount(storage)).toBeUndefined();
  });

  it('an erase removes them, read back through the storage', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const { storage, store } = await pinned(by, [await statement(T0)]);
    expect(keptPin(storage)).toBeDefined();
    await store.write(async (open) =>
      eraseDevice(open, LOCAL_ATHLETE, { instance: instanceEraser(storage) }),
    );
    expect(keptPin(storage)).toBeUndefined();
    expect(readInstanceAccount(storage)).toBeUndefined();
  });
});

describe('a judgement lands only on the pin it was judged against (#1207)', () => {
  it('writes nothing, and seals nothing, when the pin was replaced while the keys were read', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const replacement = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const inFlight: { during?: () => void } = {};
    const inner = wire(await world(), keys);
    const send = vi.fn(async (url: string, init: RequestInit) => {
      if (new URL(url).pathname === '/v1/instance/keys') inFlight.during?.();
      return inner(url, init);
    });
    const { port, storage } = device(send);
    expect(await port.connect(ORIGIN, 'Anna', by.card)).toMatchObject({ kind: 'connected' });
    // The rider confirms another card while this read is in flight.
    const replaced = {
      ...readInstanceAccount(storage)!,
      pin: base32Unpadded(replacement.fingerprint),
      keyTrust: NO_KEY_TRUST,
    };
    inFlight.during = () => {
      writeInstanceAccount(storage, replaced);
    };
    expect(await port.keys()).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT.unreachable,
      pinned: base32Unpadded(by.fingerprint),
    });
    // Read back: the replaced pin and its empty trust, untouched by the old judgement.
    expect(readInstanceAccount(storage)).toEqual(replaced);
  });
});

describe('a card offered for an address this build refuses (#1207)', () => {
  const REFUSED_ORIGIN = 'http://ride.example';

  it('answers offerCard and confirmCard with a refusal, never a throw, and keeps nothing', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const keys = { body: await served(by, [await statement(T0)]) };
    const storage = deviceStorage();
    const stored = { origin: REFUSED_ORIGIN, instanceAthleteId: 'athlete-1' };
    writeInstanceAccount(storage, stored);
    const send = wire(await world(), keys);
    const { port } = device(send, storage);
    const card = `oyl-instance:${REFUSED_ORIGIN}#${base32Unpadded(by.fingerprint)}`;
    const refused = { kind: 'refused', text: INSTANCE_KEY_TEXT.unreachable };
    expect(await port.offerCard(card)).toEqual(refused);
    expect(await port.confirmCard(card)).toEqual(refused);
    expect(readInstanceAccount(storage)).toEqual(stored);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('connecting again with a different card (#1207, D-6)', () => {
  it('is refused before any sign-in, keeping the pin, even when the instance’s keys verify under the new card', async () => {
    clock.s = T0 + HOUR;
    const old = await identity();
    const { port, storage, keys, send } = await pinned(old, [await statement(T0)]);
    const next = await identity();
    keys.body = await served(next, [await statement(T0 + 1)]);
    send.mockClear();
    expect(await port.connect(ORIGIN, 'Anna', next.card)).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT.pin_differs,
    });
    expect(keptPin(storage)).toBe(base32Unpadded(old.fingerprint));
    // The card was checked against the keys, and nothing else was sent.
    expect(paths(send)).toEqual(['GET /v1/instance/keys']);
  });
});
