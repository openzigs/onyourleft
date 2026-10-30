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
import { INSTANCE_ACCOUNT_STORAGE_KEY, readInstanceAccount } from './sign-in';
import {
  APPEAL_REFUSAL_TEXT,
  createStatementsPort,
  ERASE_REFUSAL_TEXT,
  type StatementsPort,
} from './statements-port';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

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
async function connected(
  options: { readonly portLoadedFrom?: typeof LOADED_LOCALLY } = {},
): Promise<{
  world: World;
  port: StatementsPort;
  /** Every path this device sent, in order. */
  sent: string[];
  me: string;
  storage: InstanceStorage;
  restrict: (path: 'suspend' | 'hide-display-name') => Promise<void>;
  /** Connect THIS device again, with its same key: the athlete id the instance answers. */
  reconnect: () => Promise<string | undefined>;
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
    storage,
    port: createStatementsPort({
      storage,
      loadedFrom: options.portLoadedFrom ?? LOADED_LOCALLY,
      ensureLocalAthlete: ensure,
      signingKey,
      send,
      now: () => world.clock.ms,
    }),
    reconnect: async () => {
      const again = await instancePort.connect(
        testing.TEST_ORIGIN,
        'Carys',
        (await world.instanceKeys.show()).card,
      );
      if (again.kind !== 'connected') throw new Error(JSON.stringify(again));
      return readInstanceAccount(storage)?.instanceAthleteId;
    },
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
    // One sealed request (#1382): no way-out session for a rider who can sign
    // in, and never `/v1/statements` in plaintext from a device with a pin.
    expect(sent.slice(before)).toEqual(['/v1/instance/keys', '/v1/sealed']);
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
    // The held session is refused sealed; the way-out session is a phase-2
    // sealed route (#1210): the keys are judged, the challenge is plaintext,
    // and the session is asked for sealed — and the statements are read with
    // it sealed too (#1382). Never `/v1/auth/leave-session` nor
    // `/v1/statements` in plaintext.
    expect(sent.slice(before)).toEqual([
      '/v1/instance/keys',
      '/v1/sealed',
      '/v1/instance/keys',
      '/v1/auth/challenge',
      '/v1/sealed',
      '/v1/sealed',
    ]);
  });

  it('appeals while SUSPENDED through the way-out session, and reads the appeal back (#911)', async () => {
    const { port, restrict, sent } = await connected();
    await restrict('suspend');
    const read = await port.read();
    const statementId = read.kind === 'statements' ? read.statements[0]?.statementId : undefined;
    if (statementId === undefined) throw new Error('no statement');
    const before = sent.length;
    expect(await port.appeal(statementId, 'I was quoting another rider.')).toEqual({
      kind: 'filed',
    });
    // Sealed with both sessions (#1382): the appeal never goes in plaintext.
    expect(sent.slice(before)).toEqual([
      '/v1/instance/keys',
      '/v1/sealed',
      '/v1/instance/keys',
      '/v1/auth/challenge',
      '/v1/sealed',
      '/v1/sealed',
    ]);
    expect(await port.read()).toEqual({
      kind: 'statements',
      statements: [
        expect.objectContaining({
          appeal: expect.objectContaining({
            grounds: 'I was quoting another rider.',
            outcome: null,
          }) as unknown,
        }),
      ],
    });
    expect(await port.appeal(statementId, 'Again.')).toEqual({
      kind: 'refused',
      text: APPEAL_REFUSAL_TEXT.already,
    });
  });

  it('sends nothing for empty grounds', async () => {
    const { port, sent } = await connected();
    const before = sent.length;
    expect(await port.appeal(1, '   ')).toEqual({
      kind: 'refused',
      text: APPEAL_REFUSAL_TEXT.grounds,
    });
    expect(sent.length).toBe(before);
  });

  it('opens no way-out session from a copy that may not seal, and says nothing was read (#1210)', async () => {
    const { port, restrict, sent } = await connected({ portLoadedFrom: LOADED_FROM_A_WEBSITE });
    await restrict('suspend');
    const before = sent.length;
    expect(await port.read()).toEqual({ kind: 'unreachable' });
    // A copy a website served may not seal (D-11), so nothing is sent at all:
    // not the statements in plaintext (#1382), and nothing about a way out.
    expect(sent.slice(before)).toEqual([]);
  });

  it('sends no statement, appeal or way out in plaintext from a device with no card, to an instance holding keys (#1382)', async () => {
    const { port, restrict, sent, storage } = await connected();
    await restrict('suspend');
    // The same device, as one that signed in with only an address: no pin.
    const account = readInstanceAccount(storage);
    if (account === undefined) throw new Error('not connected');
    storage.setItem(INSTANCE_ACCOUNT_STORAGE_KEY, JSON.stringify({ ...account, pin: undefined }));
    expect(readInstanceAccount(storage)?.pin).toBeUndefined();
    const before = sent.length;
    expect(await port.read()).toEqual({ kind: 'unreachable' });
    expect(await port.appeal(1, 'I was quoting another rider.')).toEqual({
      kind: 'refused',
      text: APPEAL_REFUSAL_TEXT['no-answer'],
    });
    // Only the public keys are read, which say the card is needed.
    expect(sent.slice(before)).toEqual(['/v1/instance/keys', '/v1/instance/keys']);
  });

  it('sends nothing on a device connected to no instance', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const port = createStatementsPort({
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      loadedFrom: LOADED_LOCALLY,
      ensureLocalAthlete: () => Promise.resolve(),
      signingKey: () => Promise.reject(new Error('no key is asked for')),
      send,
    });
    expect(await port.read()).toEqual({ kind: 'not-connected' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a SUSPENDED rider takes their data out and deletes their account (#1517)', () => {
  it('saves the instance’s export of the account through the way-out session', async () => {
    const { port, restrict, sent, me } = await connected();
    await restrict('suspend');
    const before = sent.length;
    const text = await port.exportAccount();
    if (text === undefined) throw new Error('no export');
    const saved = JSON.parse(text) as { athlete?: { id?: unknown }; notIncluded?: unknown };
    // The rider's own account, as the instance holds it.
    expect(saved.athlete?.id).toBe(me);
    expect(saved.notIncluded).toBeDefined();
    // Sealed with the way-out session, as the statements are: never plaintext.
    expect(sent.slice(before)).toEqual([
      '/v1/instance/keys',
      '/v1/sealed',
      '/v1/instance/keys',
      '/v1/auth/challenge',
      '/v1/sealed',
      '/v1/sealed',
    ]);
  });

  it('deletes the account on the instance, signed by this device’s key, and forgets only the sign-in', async () => {
    const { port, restrict, storage, sent, me, reconnect } = await connected();
    await restrict('suspend');
    const before = sent.length;
    expect(await port.eraseAccount()).toEqual({ kind: 'erased' });
    // The held session's attempt is refused; then the way-out session, a
    // fresh challenge for its own step-up statement, and the deletion sealed.
    expect(sent.slice(before)).toEqual([
      '/v1/instance/keys',
      '/v1/auth/challenge',
      '/v1/sealed',
      '/v1/instance/keys',
      '/v1/auth/challenge',
      '/v1/sealed',
      '/v1/auth/challenge',
      '/v1/sealed',
    ]);
    // This device forgot the sign-in, and nothing more.
    expect(readInstanceAccount(storage)).toBeUndefined();
    expect(await port.read()).toEqual({ kind: 'not-connected' });
    // Read back on the instance: this device's key is no account's now, so
    // connecting with it again registers a NEW athlete — not the suspended one,
    // whose sign-in would be refused `account_suspended`.
    const again = await reconnect();
    expect(again).toBeDefined();
    expect(again).not.toBe(me);
  });

  it('deletes the account of a rider who is NOT suspended with the session it holds', async () => {
    const { port, sent, storage } = await connected();
    const before = sent.length;
    expect(await port.eraseAccount()).toEqual({ kind: 'erased' });
    expect(sent.slice(before)).toEqual(['/v1/instance/keys', '/v1/auth/challenge', '/v1/sealed']);
    expect(readInstanceAccount(storage)).toBeUndefined();
  });

  it('says nothing was deleted when the instance will not answer', async () => {
    const { port, restrict, world, storage } = await connected();
    await restrict('suspend');
    await world.close();
    worlds.splice(worlds.indexOf(world), 1);
    expect(await port.eraseAccount()).toEqual({
      kind: 'refused',
      text: ERASE_REFUSAL_TEXT,
    });
    // Not deleted, so the sign-in is still held.
    expect(readInstanceAccount(storage)).toBeDefined();
  });

  it('sends nothing on a device connected to no instance', async () => {
    const send = vi.fn() as unknown as InstanceSend;
    const port = createStatementsPort({
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      loadedFrom: LOADED_LOCALLY,
      ensureLocalAthlete: () => Promise.resolve(),
      signingKey: () => Promise.reject(new Error('no key is asked for')),
      send,
    });
    expect(await port.exportAccount()).toBeUndefined();
    expect(await port.eraseAccount()).toEqual({
      kind: 'refused',
      text: ERASE_REFUSAL_TEXT,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
