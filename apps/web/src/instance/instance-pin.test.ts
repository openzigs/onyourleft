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
  instanceKeyId,
  instanceKeyStatementBytes,
  toHex,
  unixSeconds,
  type InstanceIdentityRotation,
  type InstanceKeyStatement,
} from '@onyourleft/domain';
import { ensureDeviceSigningKey, webCryptoSha256 } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
  createInstancePort,
  instanceEraser,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstancePortDependencies,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createModerationPort, INVITE_CARD_CAUTION } from './moderation-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY, readInstanceAccount } from './sign-in';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  close(): Promise<void>;
}
interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(): Promise<IdentityInstance>;
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
  label = `key-${String(serial)}`,
): Promise<InstanceKeyStatement> {
  const encryptionKey = new Uint8Array(await webCryptoSha256(new TextEncoder().encode(label)));
  return {
    purpose: INSTANCE_KEY_PURPOSE,
    instanceOrigin: ORIGIN,
    keyId: await instanceKeyId(webCryptoSha256, encryptionKey),
    encryptionKey: toHex(encryptionKey),
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

async function world() {
  const started = await testing.startIdentityInstance();
  worlds.push(started);
  return started;
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
    const { port, storage } = device(send);
    expect(await port.connect(ORIGIN, 'Anna')).toMatchObject({ kind: 'connected' });
    expect(keptPin(storage)).toBeUndefined();
    expect(sealedRouteGate(readInstanceAccount(storage))).toEqual({
      kind: 'needs-card',
      text: INSTANCE_KEY_TEXT['needs-card'],
    });
    expect(await port.keys()).toEqual({ kind: 'no-card', text: INSTANCE_KEY_TEXT['needs-card'] });
    expect(await port.linkCode()).toEqual({
      kind: 'unavailable',
      text: INSTANCE_KEY_TEXT['needs-card'],
    });
    const moderation = createModerationPort({ storage, send });
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
    await port.connect(ORIGIN, 'Anna');
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
    expect(sealedRouteGate(readInstanceAccount(storage)).kind).toBe('needs-new-card');
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
    expect(sealedRouteGate(readInstanceAccount(storage)).kind).toBe('open');
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

  it('puts THIS device’s card in an invitation, whatever the instance answers', async () => {
    clock.s = T0 + HOUR;
    const by = await identity();
    const planted = instanceCard(ORIGIN, (await identity()).fingerprint);
    const storage = deviceStorage();
    storage.map.set(
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        origin: ORIGIN,
        instanceAthleteId: 'a',
        pin: base32Unpadded(by.fingerprint),
      }),
    );
    storage.map.set(INSTANCE_SESSION_STORAGE_KEY, JSON.stringify({ origin: ORIGIN, token: 't' }));
    const send = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ inviteCode: 'wxyz-2345-abcd-efgh', expiresAt: T0, card: planted }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const minted = await createModerationPort({ storage, send }).mintInvite('A friend');
    expect(minted).toEqual({
      kind: 'minted',
      invite: codeWithCard(by.card, 'wxyz-2345-abcd-efgh'),
      card: by.card,
      inviteCode: 'wxyz-2345-abcd-efgh',
      expiresAt: T0,
    });
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
