// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Every path through the Connect flow, pressed on the screen, against the
 * REAL instance** — #2828.
 *
 * `instance-port.owner-claim.test.ts` (#2823) and `instance-port.invite.test.ts`
 * (#2826) drive the PORT against `apps/instance`'s own handler, identity,
 * sealed routes and a real SQLite file. This drives the SCREEN over that same
 * port and instance: `InstanceView` with `createInstancePort` and
 * `createOperatePort` on a device with its own store and real non-extractable
 * WebCrypto key, reaching the instance through `send` with no network. The
 * rider pastes the code the instance (or another device) really made, answers
 * the one question, and presses; every outcome is read BACK the way a real
 * consumer reads it — the instance's setup page's pending claim, the screen's
 * own connected view (which `InstanceView` reads from the instance, never the
 * form), the other device's list of this athlete's devices, and the Operate
 * link's owner check.
 *
 * The four paths: a claim from the server's setup page, a rider invite,
 * another of the rider's devices, and a plain card. And a refusal on the real
 * instance said under the button that was pressed.
 *
 * `apps/instance` is imported by a computed PATH (under jsdom a URL resolved
 * here is `http:`, which the loader refuses — `operate-instance-testing.ts`).
 *
 * ⚠️ **No case ends with an answer still on its way to the screen** (#2851).
 * A case is done once it has read what it came for, which is sooner than the
 * screen is: `InstanceView` goes on to ask for the devices, the notices and
 * the standings, each real cryptography against the real instance. Left
 * running, one of those answered after this file's jsdom was torn down, its
 * `setState` threw `window is not defined`, and the job failed with every test
 * passed. So the screen's ports are {@link watched}, and {@link leave} takes
 * the screen down and waits for the answers themselves — never for a time.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toHex, unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { codeWithCard } from '../instance/instance-pin';
import {
  createInstancePort,
  INVITE_REFUSAL_TEXT,
  type InstancePortDependencies,
  type InstanceStorage,
} from '../instance/instance-port';
import type { InstanceSend } from '../instance/instance-transport';
import { createModerationPort } from '../instance/moderation-port';
import { createOperatePort } from '../instance/operate-port';
import { LOADED_LOCALLY } from '../instance/testing';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import {
  answer,
  buttonNamed,
  pasteCode,
  pressNamed,
  saidUnder,
  typeName,
  until,
} from '../testing/connect-flow';
import { mount, settle, type Mounted } from '../testing/mount';
import { CONNECT_FLOW_TEXT } from './ConnectFlow';
import { InstanceView } from './InstanceView';
import { OWNER_CLAIM_TEXT } from './OwnerClaim';

interface World {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  readonly identity: {
    readonly ownerClaim: {
      mint(source: 'admin_loopback'): Promise<{ readonly code: string } | 'claimed'>;
      pending(): Promise<
        { readonly deviceKey: string; readonly comparisonCode: string } | undefined
      >;
      confirm(comparisonCode: string, source: 'admin_loopback'): Promise<'confirmed' | 'none'>;
    };
  };
  readonly clock: { ms: number };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    registration?: 'open' | 'invite' | 'closed';
    moderators?: { readonly owner?: string };
  }): Promise<World>;
}

const INSTANCE_TESTING = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../instance/src/auth/identity-testing.ts',
);
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
let mounted: Mounted | undefined;
const worlds: World[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
});

/** Every answer a port has promised a screen in this case — #2851. */
const promised: Promise<unknown>[] = [];

/** `port` as the screen is given it: the same port, with each promise it hands back kept in {@link promised}. */
function watched<Port extends object>(port: Port): Port {
  return new Proxy(port, {
    get(target, name, receiver): unknown {
      const member: unknown = Reflect.get(target, name, receiver);
      if (typeof member !== 'function') return member;
      return (...given: unknown[]): unknown => {
        const answer: unknown = Reflect.apply(member, target, given);
        if (answer instanceof Promise) promised.push(answer);
        return answer;
      };
    },
  });
}

/**
 * Take the screen down, and wait for every answer it was still promised
 * (#2851). ⚠️ The instance and the stores are closed only after this, and the
 * file's jsdom is torn down only after that.
 */
async function leave(): Promise<void> {
  mounted?.unmount();
  mounted = undefined;
  // What an answer started is promised by the time the wait for it returns
  // (it was awaited first), so this is done when a pass finds nothing new.
  for (let waitedFor = 0; waitedFor < promised.length;) {
    waitedFor = promised.length;
    await Promise.allSettled(promised);
  }
  promised.length = 0;
}

afterEach(async () => {
  await leave();
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
});

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

/** A device with its own store, key and `localStorage`, on the world's clock. */
function device(send: InstanceSend, clock: () => number) {
  const store = createStoreHarness();
  harnesses.push(store);
  const map = new Map<string, string>();
  const storage: InstanceStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  const dependencies: InstancePortDependencies = {
    storage,
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () => store.write(async (open) => ensureLocalAthlete(open, NOW)),
    signingKey: () => store.write(async (open) => ensureDeviceSigningKey(open, LOCAL_ATHLETE)),
    send,
    now: clock,
  };
  return { dependencies, port: createInstancePort(dependencies) };
}

/** An instance, and the send every device reaches it through. */
async function instance(options: Parameters<IdentityTesting['startIdentityInstance']>[0] = {}) {
  const world = await testing.startIdentityInstance(options);
  worlds.push(world);
  const send: InstanceSend = (url, init) => world.instance.handler(new Request(url, init));
  return { world, send, clock: () => world.clock.ms };
}

/** The Connect screen on `on`, read once. */
async function screen(on: ReturnType<typeof device>): Promise<void> {
  mounted = await mount(
    <InstanceView port={watched(on.port)} operate={watched(createOperatePort(on.dependencies))} />,
  );
  await until(() => text().includes(CONNECT_FLOW_TEXT.pasteLabel));
}

/** Connected, as the screen reads it back from the instance. */
async function untilConnected(): Promise<void> {
  await until(() => mounted?.container.querySelector('#oyl-instance-connected') !== null);
  await settle();
}

describe('the Connect flow against a real instance — #2828', () => {
  it('claims the server from its setup page’s code: the six digits, then Sign in as the owner', async () => {
    const { world, send, clock } = await instance();
    const tablet = device(send, clock);
    const minted = await world.identity.ownerClaim.mint('admin_loopback');
    if (minted === 'claimed') throw new Error('the instance is claimed');
    const { card } = await world.instanceKeys.show();
    await screen(tablet);

    await pasteCode(codeWithCard(card, minted.code));
    await answer('claim');
    // Nothing reached the instance before the press.
    expect(await world.identity.ownerClaim.pending()).toBeUndefined();
    await pressNamed(OWNER_CLAIM_TEXT.claim);
    await until(() => mounted?.container.querySelector('.oyl-instance__compare') !== null);

    // The digits on this screen are the ones the setup page shows.
    const pending = await world.identity.ownerClaim.pending();
    expect(pending?.comparisonCode).toMatch(/^\d{6}$/);
    expect(mounted?.container.querySelector('.oyl-instance__compare')?.textContent).toBe(
      `${pending!.comparisonCode.slice(0, 3)} ${pending!.comparisonCode.slice(3)}`,
    );
    expect(text()).not.toContain(minted.code);
    // The owner says Yes on the setup page, then signs in here.
    expect(await world.identity.ownerClaim.confirm(pending!.comparisonCode, 'admin_loopback')).toBe(
      'confirmed',
    );
    await pressNamed(OWNER_CLAIM_TEXT.signIn);
    await untilConnected();
    await until(() => text().includes(OWNER_CLAIM_TEXT.owned));
    expect(text()).toContain(OWNER_CLAIM_TEXT.owned);
    // Read back the way the Operate link asks: the instance says owner.
    expect(await createOperatePort(tablet.dependencies).standing()).toBe('owner');
  });

  it('joins with an invite and the name typed, which the connected screen reads back from the instance', async () => {
    const held: { world?: World } = {};
    const clock = (): number => held.world?.clock.ms ?? NOW * 1000;
    const send: InstanceSend = (url, init) => held.world!.instance.handler(new Request(url, init));
    const owner = device(send, clock);
    await owner.dependencies.ensureLocalAthlete();
    const world = await testing.startIdentityInstance({
      registration: 'invite',
      moderators: { owner: toHex((await owner.dependencies.signingKey()).publicKey) },
    });
    worlds.push(world);
    held.world = world;
    const { card } = await world.instanceKeys.show();
    expect((await owner.port.connect(testing.TEST_ORIGIN, 'Owner', card)).kind).toBe('connected');
    const minted = await createModerationPort(owner.dependencies).mintInvite('A friend');
    if (minted.kind !== 'minted') throw new Error(JSON.stringify(minted));

    const rider = device(send, clock);
    await screen(rider);
    await pasteCode(minted.invite);
    await answer('invite');
    await typeName('Bea');
    await pressNamed('Connect');
    await untilConnected();
    // What the instance holds, read back: this rider, by the name typed.
    expect(await rider.port.current()).toMatchObject({ kind: 'connected', displayName: 'Bea' });
    expect(text()).toContain('Bea');
    // The invite registered the rider: the recovery codes, shown once.
    expect(mounted?.container.querySelector('#oyl-instance-recovery')).not.toBeNull();

    // The same invite again, on a new device, is refused under Connect.
    await leave();
    const second = device(send, clock);
    await screen(second);
    await pasteCode(minted.invite);
    await answer('invite');
    await pressNamed('Connect');
    await until(() => saidUnder('Connect') !== undefined);
    expect(saidUnder('Connect')).toContain(INVITE_REFUSAL_TEXT.code_used);
    expect(await second.port.current()).toEqual({ kind: 'not-connected' });
  });

  it('adds this device with another device’s line, which that device then lists', async () => {
    const { world, send, clock } = await instance({ registration: 'open' });
    const { card } = await world.instanceKeys.show();
    const phone = device(send, clock);
    expect((await phone.port.connect(testing.TEST_ORIGIN, 'Anna', card)).kind).toBe('connected');
    const shown = await phone.port.linkCode();
    if (shown.kind !== 'shown') throw new Error(JSON.stringify(shown));

    const tablet = device(send, clock);
    await screen(tablet);
    await pasteCode(shown.offer);
    await answer('device');
    await pressNamed(CONNECT_FLOW_TEXT.deviceButton);
    await untilConnected();
    // The same account, read back from the instance on both devices.
    expect(await tablet.port.current()).toMatchObject({ kind: 'connected', displayName: 'Anna' });
    const devices = await phone.port.devices();
    expect(devices.kind === 'listed' ? devices.devices : []).toHaveLength(2);
  });

  it('connects with a plain card, with no question, to the address the card names', async () => {
    const { world, send, clock } = await instance({ registration: 'open' });
    const { card } = await world.instanceKeys.show();
    const rider = device(send, clock);
    await screen(rider);
    await pasteCode(card);
    expect(text()).not.toContain(CONNECT_FLOW_TEXT.question);
    expect(text()).toContain(CONNECT_FLOW_TEXT.cardFor(testing.TEST_ORIGIN));
    await typeName('Cy');
    await pressNamed('Connect');
    await untilConnected();
    expect(await rider.port.current()).toMatchObject({
      kind: 'connected',
      origin: testing.TEST_ORIGIN,
      displayName: 'Cy',
    });
    // The card was pinned: every later call is sealed.
    expect(await rider.port.keys()).toMatchObject({ kind: 'trusted' });
    expect(buttonNamed('Disconnect')).toBeDefined();
  });
});
