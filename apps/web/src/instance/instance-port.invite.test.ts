// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A new rider redeems an invite from the Connect screen, against the REAL
 * instance** — #2826.
 *
 * `apps/instance`'s own handler, identity, sealed routes and a real SQLite
 * file in `invite` mode, reached through {@link InstancePortDependencies.send}
 * with no network, as `instance-port.owner-claim.test.ts` reaches them. The
 * invite is minted the way the Moderation screen mints it (`moderation-port.ts`
 * §`mintInvite`, signed in as the instance's owner), so the line a rider is
 * handed is the line the app really makes. Every outcome is read BACK the way
 * the Instance screen reads it: `InstancePort.current`, which asks the
 * instance who this session is, and `InstancePort.keys`, which reads the pin
 * from the device's storage.
 *
 * `apps/instance` is imported by a computed path, as `instance-port.test.ts`
 * explains; the shape it is used through is written down here.
 */

import { toHex, unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { codeWithCard, readCodeWithCard, WEB_BUILD_TEXT } from './instance-pin';
import {
  createInstancePort,
  INVITE_REFUSAL_TEXT,
  type InstancePortDependencies,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createModerationPort } from './moderation-port';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

interface InviteWorld {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: {
    show(): Promise<{ readonly card: string }>;
    /** The pass a running instance makes on its timer: re-signs its statements. */
    maintain(): Promise<unknown>;
  };
  readonly clock: { ms: number };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    registration?: 'open' | 'approval' | 'invite' | 'closed';
    moderators?: { readonly owner?: string };
  }): Promise<InviteWorld>;
}

const INSTANCE_TESTING = new URL('../../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;
const NOW = unixSeconds(1_790_000_000);
const SESSION_PATH = '/v1/auth/session';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let testing: IdentityTesting;
const worlds: InviteWorld[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
  vi.restoreAllMocks();
});

/** Every request handed to the instance's own handler, by the path the wire carries. */
function wire(world: InviteWorld): InstanceSend & { readonly paths: string[] } {
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

/** A device whose clock is the world's, so a week passes for both. */
function device(send: InstanceSend, clock: { ms: number }, loadedFrom = LOADED_LOCALLY) {
  const store = createStoreHarness();
  harnesses.push(store);
  const storage = deviceStorage();
  const dependencies: InstancePortDependencies = {
    storage,
    loadedFrom,
    ensureLocalAthlete: () => store.write(async (open) => ensureLocalAthlete(open, NOW)),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
    now: () => clock.ms,
  };
  const publicKey = async (): Promise<string> => toHex((await dependencies.signingKey()).publicKey);
  return { storage, dependencies, publicKey, port: createInstancePort(dependencies) };
}

/**
 * An invite-only instance whose owner is signed in on a device of its own,
 * and that device's Moderation screen, which mints the invites.
 */
async function inviteOnly() {
  const held: { world?: InviteWorld } = {};
  // One clock for the instance and every device on it: the world's.
  const clock = {
    get ms(): number {
      return held.world?.clock.ms ?? NOW * 1000;
    },
    set ms(ms: number) {
      if (held.world !== undefined) held.world.clock.ms = ms;
    },
  };
  const owner = device((url, init) => wire(held.world!)(url, init), clock);
  await owner.dependencies.ensureLocalAthlete();
  const world = await testing.startIdentityInstance({
    registration: 'invite',
    moderators: { owner: await owner.publicKey() },
  });
  worlds.push(world);
  held.world = world;
  const send = wire(world);
  const { card } = await world.instanceKeys.show();
  expect(await owner.port.connect(testing.TEST_ORIGIN, 'Owner', card)).toMatchObject({
    kind: 'connected',
  });
  const moderation = createModerationPort(owner.dependencies);
  const mint = async (): Promise<{ invite: string; code: string }> => {
    const minted = await moderation.mintInvite('A friend');
    if (minted.kind !== 'minted') throw new Error(JSON.stringify(minted));
    return { invite: minted.invite, code: minted.inviteCode };
  };
  return { world, send, clock, card, mint };
}

describe('a new rider joins an invite-only instance with the invite line — #2826', () => {
  it('registers with the invite, sealed, pins the card, and reads back signed in by the name typed', async () => {
    const { send, clock, card, mint } = await inviteOnly();
    const { invite, code } = await mint();
    const rider = device(send, clock);
    const before = send.paths.length;

    // The address left blank: the invite's own card says where.
    const outcome = await rider.port.connect('', 'Bea', invite);
    expect(outcome.kind, JSON.stringify(outcome)).toBe('connected');
    // A registration: the recovery codes come back once, for the screen to show.
    expect(outcome.kind === 'connected' ? outcome.recoveryCodes : []).toHaveLength(10);

    // Read back as the Instance screen reads it: the instance says who this is.
    expect(await rider.port.current()).toMatchObject({
      kind: 'connected',
      origin: testing.TEST_ORIGIN,
      displayName: 'Bea',
    });
    // The invite's card was pinned, so every later call is sealed.
    expect(await rider.port.keys()).toMatchObject({ kind: 'trusted' });
    expect(readCodeWithCard(invite)?.card).toBe(card);
    // The card was checked first, then the code went sealed: never in plaintext.
    expect(send.paths.slice(before, before + 3)).toEqual([
      '/v1/instance/keys',
      '/v1/auth/challenge',
      '/v1/sealed',
    ]);
    expect(send.paths.slice(before)).not.toContain(SESSION_PATH);
    expect(JSON.stringify(outcome)).not.toContain(code);
  });

  it('is the invite that lets the rider in: the same press without the code is refused', async () => {
    const { send, clock, card } = await inviteOnly();
    const rider = device(send, clock);
    // The card alone, as before #2826 the app sent an invite line's card.
    expect(await rider.port.connect(testing.TEST_ORIGIN, 'Bea', card)).toEqual({
      kind: 'refused',
      text: INVITE_REFUSAL_TEXT.required,
    });
    expect(await rider.port.current()).toEqual({ kind: 'not-connected' });
  });

  it('refuses a used invite in one sentence that never names the code, and the first rider keeps it', async () => {
    const { send, clock, mint } = await inviteOnly();
    const { invite, code } = await mint();
    const first = device(send, clock);
    expect((await first.port.connect('', 'Bea', invite)).kind).toBe('connected');

    const second = device(send, clock);
    const refused = await second.port.connect('', 'Cy', invite);
    expect(refused).toEqual({ kind: 'refused', text: INVITE_REFUSAL_TEXT.code_used });
    expect(JSON.stringify(refused)).not.toContain(code);
    expect(await second.port.current()).toEqual({ kind: 'not-connected' });
    expect(await first.port.current()).toMatchObject({ kind: 'connected', displayName: 'Bea' });
  });

  it('refuses an invite the instance never made, and one a week old', async () => {
    const { world, send, clock, card, mint } = await inviteOnly();
    const wrong = codeWithCard(card, 'abcd-efgh-jkmn-pqrs');
    const rider = device(send, clock);
    expect(await rider.port.connect('', 'Bea', wrong)).toEqual({
      kind: 'refused',
      text: INVITE_REFUSAL_TEXT.code_unknown,
    });

    const { invite, code } = await mint();
    clock.ms += WEEK_MS;
    // A running instance re-signs its keys as the week passes; the invite does not renew.
    await world.instanceKeys.maintain();
    const late = await rider.port.connect('', 'Bea', invite);
    expect(late).toEqual({ kind: 'refused', text: INVITE_REFUSAL_TEXT.code_expired });
    expect(JSON.stringify(late)).not.toContain(code);
    expect(await rider.port.current()).toEqual({ kind: 'not-connected' });
  });

  it('sends no invite from a copy of the app a website served, and the invite stays good', async () => {
    const { send, clock, mint } = await inviteOnly();
    const { invite } = await mint();
    const web = device(send, clock, LOADED_FROM_A_WEBSITE);
    const before = send.paths.length;
    expect(await web.port.connect('', 'Bea', invite)).toEqual({
      kind: 'refused',
      text: WEB_BUILD_TEXT,
    });
    // Only the card's check reached the instance: no challenge, no session.
    expect(send.paths.slice(before)).toEqual(['/v1/instance/keys']);
    expect(web.storage.map.size).toBe(0);
    const rider = device(send, clock);
    expect(await rider.port.connect('', 'Bea', invite)).toMatchObject({ kind: 'connected' });
  });

  it('sends nothing when the address typed is not the invite card’s', async () => {
    const { send, clock, mint } = await inviteOnly();
    const { invite } = await mint();
    const rider = device(send, clock);
    const before = send.paths.length;
    const refused = await rider.port.connect('https://elsewhere.example', 'Bea', invite);
    expect(refused.kind).toBe('refused');
    expect(send.paths.slice(before)).toEqual([]);
  });
});
