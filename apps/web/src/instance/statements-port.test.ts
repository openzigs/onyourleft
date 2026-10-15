// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The statements of reasons, read on the rider's own device (#910), against
 * the REAL instance — `apps/instance`'s handler, its moderation routes and a
 * real SQLite file — reached through {@link StatementsPortDependencies.send}
 * with no network, as `moderation-port.test.ts` reaches it. The rider is THIS
 * device: its store's own key signs in, and, once suspended, signs the
 * way-out session the port opens to read why.
 *
 * `apps/instance` is imported by a computed path, for `instance-port.test.ts`'s
 * reason; the shape it is used through is written down here.
 */

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { createInstancePort, type InstanceStorage } from './instance-port';
import type { InstanceSend } from './instance-transport';
import { readInstanceAccount } from './sign-in';
import { createStatementsPort, type StatementsPort } from './statements-port';
import { LOADED_LOCALLY } from './testing';

interface TestDevice {
  readonly publicKey: string;
}

interface World {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly clock: { ms: number };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string },
  ): Promise<{ status: number; body: unknown }>;
  signIn(device: TestDevice): Promise<{ status: number; body: Record<string, unknown> }>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  testDevice(): Promise<TestDevice>;
  startIdentityInstance(options: {
    registration: 'open';
    moderators: { owner: string };
    config: Record<string, unknown>;
  }): Promise<World>;
}

const INSTANCE_TESTING = new URL('../../../instance/src/auth/identity-testing.ts', import.meta.url)
  .href;
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
const worlds: World[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(/* @vite-ignore */ INSTANCE_TESTING)) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
});

const STATEMENT = {
  facts: 'Repeated abuse of other riders in a room.',
  decidedOn: 'report',
  legalGround: null,
  termsGround: 'The terms of service, on abuse.',
};

/** This device, connected to a fresh instance, and the instance's owner. */
async function connected(): Promise<{
  world: World;
  port: StatementsPort;
  /** Every path this device sent, in order. */
  sent: string[];
  me: string;
  restrict: (path: 'suspend' | 'hide-display-name') => Promise<void>;
}> {
  const started: { world?: World } = {};
  const sent: string[] = [];
  const send: InstanceSend = (url, init) => {
    if (started.world === undefined) throw new Error('no instance yet');
    sent.push(new URL(url).pathname);
    return started.world.instance.handler(new Request(url, init));
  };
  const owner = await testing.testDevice();
  const world = await testing.startIdentityInstance({
    registration: 'open',
    moderators: { owner: owner.publicKey },
    config: {
      legal: {
        contactEmail: 'moderator@club.example',
        contactLanguages: ['English'],
        accountablePerson: null,
        legalRepresentative: null,
        privacyPolicyUrl: null,
        publicRooms: false,
      },
    },
  });
  started.world = world;
  worlds.push(world);
  const store = createStoreHarness();
  harnesses.push(store);
  const map = new Map<string, string>();
  const storage: InstanceStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  const ensure = () => store.write(async (open) => ensureLocalAthlete(open, NOW));
  const signingKey = () =>
    store.write(async (open) => {
      await ensureLocalAthlete(open, NOW);
      return ensureDeviceSigningKey(open, LOCAL_ATHLETE);
    });
  const instancePort = createInstancePort({
    storage,
    loadedFrom: LOADED_LOCALLY,
    signingKey,
    send,
    now: () => world.clock.ms,
    ensureLocalAthlete: ensure,
  });
  const outcome = await instancePort.connect(
    testing.TEST_ORIGIN,
    'Carys',
    (await world.instanceKeys.show()).card,
  );
  if (outcome.kind !== 'connected') throw new Error(JSON.stringify(outcome));
  world.clock.ms += 60_000;
  const ownerToken = (await world.signIn(owner)).body.sessionToken as string;
  const me = readInstanceAccount(storage)?.instanceAthleteId ?? '';
  return {
    world,
    sent,
    me,
    port: createStatementsPort({
      storage,
      ensureLocalAthlete: ensure,
      signingKey,
      send,
      now: () => world.clock.ms,
    }),
    restrict: async (path) => {
      const done = await world.call('POST', `/v1/moderation/athletes/${me}/${path}`, {
        token: ownerToken,
        body: { reason: 'Abuse', statement: STATEMENT },
      });
      if (done.status !== 200) throw new Error(JSON.stringify(done.body));
      world.clock.ms += 60_000;
    },
  };
}

describe('the statements of reasons about this rider (#910)', () => {
  it('reads none, and says so, before any decision', async () => {
    const { port } = await connected();
    expect(await port.read()).toEqual({ kind: 'statements', statements: [] });
  });

  it('reads a statement about a hidden name with the session this device holds', async () => {
    const { port, restrict, sent } = await connected();
    await restrict('hide-display-name');
    const before = sent.length;
    expect(await port.read()).toEqual({
      kind: 'statements',
      statements: [
        expect.objectContaining({
          restriction: 'hide_display_name',
          facts: STATEMENT.facts,
          decidedOn: 'report',
          termsGround: STATEMENT.termsGround,
          legalGround: null,
          contactEmail: 'moderator@club.example',
        }),
      ],
    });
    // One request: no way-out session for a rider who can sign in.
    expect(sent.slice(before)).toEqual(['/v1/statements']);
  });

  it('reads why a SUSPENDED rider was suspended, through the way-out session', async () => {
    const { port, restrict, sent } = await connected();
    await restrict('suspend');
    const before = sent.length;
    const read = await port.read();
    expect(read).toEqual({
      kind: 'statements',
      statements: [expect.objectContaining({ restriction: 'suspend', facts: STATEMENT.facts })],
    });
    expect(sent.slice(before)).toEqual([
      '/v1/statements',
      '/v1/auth/challenge',
      '/v1/auth/leave-session',
      '/v1/statements',
    ]);
  });

  it('sends nothing on a device connected to no instance', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const port = createStatementsPort({
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      ensureLocalAthlete: () => Promise.resolve(),
      signingKey: () => Promise.reject(new Error('no key is asked for')),
      send,
    });
    expect(await port.read()).toEqual({ kind: 'not-connected' });
    expect(send).not.toHaveBeenCalled();
  });
});
