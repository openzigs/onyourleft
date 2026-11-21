// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The owner's claim, from the app, against the REAL instance** — #2823,
 * ADR 0080 D-3, D-5.
 *
 * `apps/instance`'s own handler, identity, sealed routes and a real SQLite
 * file, reached through {@link InstancePortDependencies.send} with no network,
 * as `instance-port.test.ts` reaches them. The device key is the store's real
 * non-extractable WebCrypto key. The claim code is minted the way the setup
 * page mints it (`identity.ownerClaim.mint`), and every outcome is read BACK
 * through the path its real consumer uses: the pending claim as the setup page
 * reads it (`ownerClaim.pending`), and the owner as the Instance screen's
 * Operate link asks for it (`operate-port.ts` §`standing`).
 *
 * `apps/instance` is imported by a computed path, as `instance-port.test.ts`
 * explains; the shape it is used through is written down here.
 */

import { toHex, unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import {
  codeWithCard,
  INSTANCE_KEY_TEXT,
  UNREACHABLE_HINT_TEXT,
  unreachableAtText,
  WEB_BUILD_TEXT,
} from './instance-pin';
import {
  CLAIM_REFUSAL_TEXT,
  CONNECT_REFUSAL_TEXT,
  createInstancePort,
  type InstancePortDependencies,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createOperatePort } from './operate-port';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

interface PendingClaim {
  readonly deviceKey: string;
  readonly comparisonCode: string;
}

interface ClaimWorld {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  readonly identity: {
    readonly ownerClaim: {
      mint(source: 'admin_loopback'): Promise<{ readonly code: string } | 'claimed'>;
      pending(): Promise<PendingClaim | undefined>;
      confirm(comparisonCode: string, source: 'admin_loopback'): Promise<'confirmed' | 'none'>;
    };
  };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    registration?: 'open' | 'closed';
    moderators?: { readonly owner?: string };
    ownerClaimLimits?: {
      readonly perAddress: { readonly limit: number; readonly windowMs: number };
      readonly overall: { readonly limit: number; readonly windowMs: number };
    };
  }): Promise<ClaimWorld>;
}

const INSTANCE_TESTING = new URL('../../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;
const NOW = unixSeconds(1_790_000_000);
const CLAIM_PATH = '/v1/auth/owner-claim';

let testing: IdentityTesting;
const worlds: ClaimWorld[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

async function instance(options: Parameters<IdentityTesting['startIdentityInstance']>[0] = {}) {
  const world = await testing.startIdentityInstance(options);
  worlds.push(world);
  return world;
}

/** The setup page's claim QR, as its text: the instance's card and a fresh claim code. */
async function claimLine(world: ClaimWorld): Promise<{ line: string; card: string; code: string }> {
  const minted = await world.identity.ownerClaim.mint('admin_loopback');
  if (minted === 'claimed') throw new Error('the instance is claimed');
  const { card } = await world.instanceKeys.show();
  return { line: codeWithCard(card, minted.code), card, code: minted.code };
}

/**
 * Every request handed to the instance's own handler, with the inner path of
 * each sealed one counted by what reached the claim route's handler: a sealed
 * request's path is inside the envelope, so the count is of `/v1/sealed`
 * posts and of plaintext paths, as the wire carries them.
 */
function wire(world: ClaimWorld): InstanceSend & { readonly paths: string[] } {
  const paths: string[] = [];
  const send = ((url: string, init: RequestInit) => {
    paths.push(new URL(url).pathname);
    return world.instance.handler(new Request(url, init));
  }) as InstanceSend & { paths: string[] };
  send.paths = paths;
  return send;
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

function device(send: InstanceSend, loadedFrom = LOADED_LOCALLY) {
  const store = createStoreHarness();
  harnesses.push(store);
  const storage = deviceStorage();
  const dependencies: InstancePortDependencies = {
    storage,
    loadedFrom,
    ensureLocalAthlete: () => store.write(async (open) => ensureLocalAthlete(open, NOW)),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
    now: () => NOW * 1000,
  };
  const publicKey = async (): Promise<string> => toHex((await dependencies.signingKey()).publicKey);
  return { storage, dependencies, publicKey, port: createInstancePort(dependencies) };
}

describe('claiming the owner from the app — #2823', () => {
  it('leaves a pending claim with THIS device’s key, and shows the six digits the setup page shows', async () => {
    const world = await instance();
    const send = wire(world);
    const tablet = device(send);
    const { line, card, code } = await claimLine(world);

    const outcome = await tablet.port.claimOwner(line);
    expect(outcome.kind, JSON.stringify(outcome)).toBe('pending');
    // Read back as the setup page reads it: the claim waits with this key.
    const pending = await world.identity.ownerClaim.pending();
    expect(pending?.deviceKey).toBe(await tablet.publicKey());
    expect(outcome).toEqual({ kind: 'pending', comparisonCode: pending?.comparisonCode, card });
    expect(outcome.kind === 'pending' ? outcome.comparisonCode : '').toMatch(/^\d{6}$/);
    // The card was checked first, then the code went sealed: nothing in plaintext.
    expect(send.paths).toEqual(['/v1/instance/keys', '/v1/sealed']);
    expect(send.paths).not.toContain(CLAIM_PATH);
    // A claim keeps nothing on the device: the sign-in after it does.
    expect(tablet.storage.map.size).toBe(0);
    expect(JSON.stringify(outcome)).not.toContain(code);
  });

  it('signs in as the owner once the setup page confirms, and the Operate link’s check says owner', async () => {
    const world = await instance();
    const tablet = device(wire(world));
    const { line } = await claimLine(world);
    const claimed = await tablet.port.claimOwner(line);
    if (claimed.kind !== 'pending') throw new Error(JSON.stringify(claimed));
    expect(await world.identity.ownerClaim.confirm(claimed.comparisonCode, 'admin_loopback')).toBe(
      'confirmed',
    );

    const signedIn = await tablet.port.signInAsOwner(claimed.card);
    expect(signedIn.kind, JSON.stringify(signedIn)).toBe('connected');
    // The registration's recovery codes come back once, for the screen to show.
    expect(signedIn.kind === 'connected' ? signedIn.recoveryCodes : []).toHaveLength(10);
    expect(await tablet.port.current()).toMatchObject({ kind: 'connected' });
    // The path the Instance screen's Operate link takes: the instance says owner.
    expect(await createOperatePort(tablet.dependencies).standing()).toBe('owner');
    // And the card was pinned at that sign-in, so every later call is sealed.
    expect(await tablet.port.keys()).toMatchObject({ kind: 'trusted' });
  });

  it('registers the owner’s athlete with the name given at the sign-in, and as Rider with none (#2878)', async () => {
    for (const [given, shown] of [
      ['  Mara Owner ', 'Mara Owner'],
      ['', 'Rider'],
    ] as const) {
      const world = await instance();
      const send = wire(world);
      const tablet = device(send);
      const { line } = await claimLine(world);
      const claimed = await tablet.port.claimOwner(line);
      if (claimed.kind !== 'pending') throw new Error(JSON.stringify(claimed));
      await world.identity.ownerClaim.confirm(claimed.comparisonCode, 'admin_loopback');
      expect(await tablet.port.signInAsOwner(claimed.card, given)).toMatchObject({
        kind: 'connected',
      });
      // Read back as the app reads it, from the instance: the session's athlete.
      expect(await tablet.port.current()).toMatchObject({ kind: 'connected', displayName: shown });
      // Sealed, as the claim was: the name never crossed the edge in plaintext.
      expect(send.paths).not.toContain('/v1/auth/session');
    }
  });

  it('sends nothing for a name the instance would refuse, and the claim still signs in', async () => {
    const world = await instance();
    const send = wire(world);
    const tablet = device(send);
    const { line } = await claimLine(world);
    const claimed = await tablet.port.claimOwner(line);
    if (claimed.kind !== 'pending') throw new Error(JSON.stringify(claimed));
    await world.identity.ownerClaim.confirm(claimed.comparisonCode, 'admin_loopback');
    const before = send.paths.length;
    expect(await tablet.port.signInAsOwner(claimed.card, 'x'.repeat(33))).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT['bad-name'],
    });
    expect(send.paths).toHaveLength(before);
    expect(await tablet.port.signInAsOwner(claimed.card, 'Mara')).toMatchObject({
      kind: 'connected',
    });
    expect(await tablet.port.current()).toMatchObject({ displayName: 'Mara' });
  });

  it('is not the owner when the setup page has not confirmed, and says so plainly where registration waits', async () => {
    // An instance that registers nobody, as one that refuses every rider
    // until its owner is claimed does (ADR 0080 D-3, #2784).
    const world = await instance({ registration: 'closed' });
    const tablet = device(wire(world));
    const { line } = await claimLine(world);
    const claimed = await tablet.port.claimOwner(line);
    if (claimed.kind !== 'pending') throw new Error(JSON.stringify(claimed));

    expect(await tablet.port.signInAsOwner(claimed.card)).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT['not-confirmed'],
    });
    // The same refusal on the Connect form keeps its own words.
    expect(await tablet.port.connect(testing.TEST_ORIGIN, '', claimed.card)).toEqual({
      kind: 'refused',
      text: CONNECT_REFUSAL_TEXT.registration_closed,
    });
    // Confirmed on the setup page, the same press signs in.
    await world.identity.ownerClaim.confirm(claimed.comparisonCode, 'admin_loopback');
    expect(await tablet.port.signInAsOwner(claimed.card)).toMatchObject({ kind: 'connected' });
    expect(await createOperatePort(tablet.dependencies).standing()).toBe('owner');
  });

  it('signed in before the confirmation, the device is not the owner, and is once it is confirmed', async () => {
    const world = await instance();
    const tablet = device(wire(world));
    const { line } = await claimLine(world);
    const claimed = await tablet.port.claimOwner(line);
    if (claimed.kind !== 'pending') throw new Error(JSON.stringify(claimed));
    expect(await tablet.port.signInAsOwner(claimed.card)).toMatchObject({ kind: 'connected' });
    const operate = createOperatePort(tablet.dependencies);
    expect(await operate.standing()).toBe('not-owner');
    await world.identity.ownerClaim.confirm(claimed.comparisonCode, 'admin_loopback');
    // Read on every check, so no restart and no new sign-in (D-3).
    expect(await operate.standing()).toBe('owner');
  });
});

describe('what a claim refuses, in one sentence that never names the code — #2823', () => {
  it('refuses a used code with one sentence, and the second device is not the claim', async () => {
    const world = await instance();
    const send = wire(world);
    const { line, code } = await claimLine(world);
    const first = device(send);
    expect((await first.port.claimOwner(line)).kind).toBe('pending');

    const second = device(send);
    const refused = await second.port.claimOwner(line);
    expect(refused).toEqual({ kind: 'refused', text: CLAIM_REFUSAL_TEXT.refused });
    expect(JSON.stringify(refused)).not.toContain(code);
    expect((await world.identity.ownerClaim.pending())?.deviceKey).toBe(await first.publicKey());
  });

  it('refuses every claim while the environment names an owner (D-3, Q-2)', async () => {
    const world = await instance({ moderators: { owner: 'ab'.repeat(32) } });
    const { card } = await world.instanceKeys.show();
    const tablet = device(wire(world));
    // No code is minted on such an instance, so the line carries one the
    // instance never minted: the answer is the one refusal either way.
    expect(await tablet.port.claimOwner(codeWithCard(card, 'abcd-efgh-jkmn-pqrs'))).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT.refused,
    });
  });

  it('says to wait when the instance limits claims', async () => {
    const world = await instance({
      ownerClaimLimits: {
        perAddress: { limit: 1, windowMs: 60_000 },
        overall: { limit: 30, windowMs: 60_000 },
      },
    });
    const { card } = await world.instanceKeys.show();
    const tablet = device(wire(world));
    const guess = codeWithCard(card, 'abcd-efgh-jkmn-pqrs');
    expect(await tablet.port.claimOwner(guess)).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT.refused,
    });
    expect(await tablet.port.claimOwner(guess)).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT.rate_limited,
    });
  });

  it('sends nothing for a card with no code, or for something that is not a claim line', async () => {
    const world = await instance();
    const send = wire(world);
    const tablet = device(send);
    const { card } = await world.instanceKeys.show();
    expect(await tablet.port.claimOwner(card)).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT['card-only'],
    });
    expect(await tablet.port.claimOwner('482913')).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT['not-a-claim'],
    });
    expect(send.paths).toEqual([]);
  });

  it('sends no code to an instance whose keys are not the card’s', async () => {
    const world = await instance();
    const other = await instance();
    const send = wire(world);
    const tablet = device(send);
    // The other instance's card, at this instance's address (both are TEST_ORIGIN).
    const minted = await world.identity.ownerClaim.mint('admin_loopback');
    if (minted === 'claimed') throw new Error('claimed');
    const { card: otherCard } = await other.instanceKeys.show();
    expect(await tablet.port.claimOwner(codeWithCard(otherCard, minted.code))).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT.mismatch,
    });
    expect(send.paths).toEqual(['/v1/instance/keys']);
    expect(await world.identity.ownerClaim.pending()).toBeUndefined();
  });

  it('sends nothing from a copy of the app a website served (ADR 0047 D-11)', async () => {
    const world = await instance();
    const send = wire(world);
    const tablet = device(send, LOADED_FROM_A_WEBSITE);
    const { line } = await claimLine(world);
    expect(await tablet.port.claimOwner(line)).toEqual({ kind: 'refused', text: WEB_BUILD_TEXT });
    expect(send.paths).toEqual([]);
  });

  it('says the server did not answer when the claim gets no answer, and nothing is claimed', async () => {
    const world = await instance();
    const handed = wire(world);
    const send = ((url: string, init: RequestInit) =>
      new URL(url).pathname === '/v1/sealed'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : handed(url, init)) as InstanceSend;
    const tablet = device(send);
    const { line } = await claimLine(world);
    expect(await tablet.port.claimOwner(line)).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT['no-answer'],
    });
    expect(await world.identity.ownerClaim.pending()).toBeUndefined();
  });

  it('says a fault on this device is this device’s, sends nothing, and leaves the code unspent', async () => {
    const world = await instance();
    const send = wire(world);
    const tablet = device(send);
    const broken = createInstancePort({
      ...tablet.dependencies,
      signingKey: () => Promise.reject(new Error('no key store')),
    });
    const { line } = await claimLine(world);
    expect(await broken.claimOwner(line)).toEqual({
      kind: 'refused',
      text: CLAIM_REFUSAL_TEXT['this-device'],
    });
    expect(send.paths).toEqual(['/v1/instance/keys']);
    expect(await world.identity.ownerClaim.pending()).toBeUndefined();
    // The same code still claims from a device that can sign.
    expect(await tablet.port.claimOwner(line)).toMatchObject({ kind: 'pending' });
  });
});

describe('a claim the server never answers says where it tried and why, never the code — #2855', () => {
  /** The claim line's fingerprint: the 52 characters after the card's `#`. */
  const fingerprintOf = (card: string): string => card.slice(card.indexOf('#') + 1);

  it.each([
    ['no answer at all', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a proxy’s own page', () => Promise.resolve(new Response('Bad gateway', { status: 502 }))],
  ])(
    'names the address and the likely cause when the keys get %s, and sends nothing more',
    async (_name, unanswered) => {
      const world = await instance();
      const handed = wire(world);
      const send = ((url: string, init: RequestInit) => {
        if (new URL(url).pathname !== '/v1/instance/keys') return handed(url, init);
        handed.paths.push('/v1/instance/keys');
        return unanswered();
      }) as InstanceSend;
      const tablet = device(send);
      const { line, card, code } = await claimLine(world);
      const refused = await tablet.port.claimOwner(line);
      expect(refused).toEqual({ kind: 'refused', text: unreachableAtText(testing.TEST_ORIGIN) });
      const text = refused.kind === 'refused' ? refused.text : '';
      expect(text).toContain(`The instance at ${testing.TEST_ORIGIN} did not answer`);
      expect(text).toContain(UNREACHABLE_HINT_TEXT.other);
      expect(text).not.toContain('Tailscale');
      // ADR 0004 D's spirit, and the issue's rule: the address, never the code or the fingerprint.
      expect(text).not.toContain(code);
      expect(text).not.toContain(fingerprintOf(card));
      // Only the keys were asked for: the code went nowhere, and no claim waits.
      expect(new Set(handed.paths)).toEqual(new Set(['/v1/instance/keys']));
      expect(await world.identity.ownerClaim.pending()).toBeUndefined();
      // The code is unspent: once the server can be reached, the same line claims it.
      expect(await device(handed).port.claimOwner(line)).toMatchObject({ kind: 'pending' });
    },
  );

  it('says a tablet that is not on the tailnet most likely cannot reach a Tailscale address yet', async () => {
    const world = await instance();
    const { card, code } = await claimLine(world);
    // The setup page's QR for an instance on its owner's tailnet, scanned off the tailnet.
    const tailnet = 'https://onyourleft.tail1a2b.ts.net';
    const line = codeWithCard(`oyl-instance:${tailnet}#${fingerprintOf(card)}`, code);
    const asked: string[] = [];
    const send = ((url: string) => {
      asked.push(url);
      return Promise.reject(new TypeError('Failed to fetch'));
    }) as InstanceSend;
    const refused = await device(send).port.claimOwner(line);
    expect(refused).toEqual({ kind: 'refused', text: unreachableAtText(tailnet) });
    const text = refused.kind === 'refused' ? refused.text : '';
    expect(text).toContain(`The instance at ${tailnet} did not answer`);
    expect(text).toContain(UNREACHABLE_HINT_TEXT.tailscale);
    expect(text).toContain('Tailscale app');
    expect(text).not.toBe(INSTANCE_KEY_TEXT.unreachable);
    expect(text).not.toContain(code);
    expect(text).not.toContain(fingerprintOf(card));
    // The address in the sentence is the one that was tried, and nothing else was.
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked) expect(url).toBe(`${tailnet}/v1/instance/keys`);
  });
});
