// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The AI pacer, end to end against the REAL instance** (#2712, ADR 0072):
 * a device connected to an instance that offers a local model asks for the
 * status, records its consent naming the instance and the model address,
 * takes the model slot, asks for a decision and lets the slot go — every call
 * sealed, through the one instance module. The model server is a `fetch` the
 * instance is handed, which records what it was sent.
 *
 * And what must give no decision: no consent, a withdrawn one, an answer the
 * device reads as none, no instance, and a website's copy.
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
import type { LoadedFrom } from './instance-pin';
import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createPacerPort, parsePacerReply, parsePacerStatus } from './pacer-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from './sign-in';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  readonly tactics: { idle(): Promise<void> };
  close(): Promise<void>;
}

interface ChatRequest {
  readonly body: Readonly<Record<string, unknown>>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    bodyLimitBytes?: number;
    tactics?: { local?: () => Promise<unknown>; fetch?: typeof globalThis.fetch };
  }): Promise<IdentityInstance>;
}

interface TacticsTesting {
  readonly OFFERED: () => Promise<unknown>;
  readonly PACER_INPUT: Readonly<Record<string, unknown>>;
  readonly PACER_ANSWER: string;
  chatServer(answer: (body: Readonly<Record<string, unknown>>) => string | undefined): {
    readonly fetch: typeof globalThis.fetch;
    readonly requests: ChatRequest[];
  };
  asksForPacer(body: Readonly<Record<string, unknown>>): boolean;
}

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
let tactics: TacticsTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
  tactics = (await import(
    /* @vite-ignore */ INSTANCE('analysis/tactics-testing.ts')
  )) as TacticsTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) {
    await world.tactics.idle();
    await world.close();
  }
  for (const harness of harnesses.splice(0)) await harness.destroy();
});

async function world(answer: () => string | undefined) {
  const server = tactics.chatServer((body) =>
    tactics.asksForPacer(body) ? answer() : '{"bots":[]}',
  );
  const w = await testing.startIdentityInstance({
    bodyLimitBytes: 1024 * 1024,
    tactics: { local: tactics.OFFERED, fetch: server.fetch },
  });
  worlds.push(w);
  const seen: string[] = [];
  const send: InstanceSend = async (url, init) => {
    seen.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    return w.instance.handler(new Request(url, init));
  };
  return { w, send, seen, server };
}

function mapStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

async function device(send: InstanceSend, loadedFrom: LoadedFrom = LOADED_LOCALLY) {
  const harness = createStoreHarness();
  harnesses.push(harness);
  let open: PersistentStore | undefined;
  await harness.write((store) => {
    open = store;
    return ensureLocalAthlete(store, NOW);
  });
  const store = (): PersistentStore => open as PersistentStore;
  const storage = mapStorage();
  const signingKey = () => ensureDeviceSigningKey(store(), LOCAL_ATHLETE, { now: () => NOW });
  const sealing = { storage, loadedFrom, signingKey, send, now: () => NOW * 1000 };
  const instance = createInstancePort({
    ...sealing,
    ensureLocalAthlete: () => ensureLocalAthlete(store(), NOW),
  });
  return { instance, storage, pacers: createPacerPort(sealing) };
}

async function connected(send: InstanceSend, w: IdentityInstance, loadedFrom?: LoadedFrom) {
  const on = await device(send, loadedFrom);
  const card = (await w.instanceKeys.show()).card;
  expect(await on.instance.connect(testing.TEST_ORIGIN, 'Anna', card)).toMatchObject({
    kind: 'connected',
  });
  return on;
}

describe('the AI pacer, from the instance (#2712)', () => {
  it('asks, consents naming the place, takes the slot, decides and lets it go — every call sealed', async () => {
    const { w, send, seen, server } = await world(() => tactics.PACER_ANSWER);
    const { pacers } = await connected(send, w);
    expect(pacers.offered()).toBe(true);

    const before = await pacers.pacerStatus();
    expect(before).toMatchObject({ kind: 'offered', consented: false });
    if (before.kind !== 'offered') throw new Error('not offered');
    expect(before.instance).toBe(testing.TEST_ORIGIN);
    // No consent: refused before a model is called.
    expect(await pacers.decidePacer(tactics.PACER_INPUT as never)).toEqual({ kind: 'refused' });
    expect(server.requests).toEqual([]);

    expect(await pacers.consentToPacer(before)).toMatchObject({ kind: 'offered', consented: true });
    // Read back through a fresh status, as the chooser next reads it.
    expect(await pacers.pacerStatus()).toMatchObject({ consented: true });
    expect(await pacers.startPacerRide()).toBe(true);
    await w.tactics.idle();
    expect(await pacers.decidePacer(tactics.PACER_INPUT as never)).toEqual({
      kind: 'answer',
      direction: { plan: 'climber', intent: 'ease' },
      say: 'Nice and steady, stay on my wheel.',
    });
    await pacers.endPacerRide();

    // The pacer state reached the model as it was built, and nothing else of the rider's.
    const asked = server.requests.find((each) => tactics.asksForPacer(each.body));
    const messages = asked?.body.messages as { content: string }[] | undefined;
    expect(messages?.[1]?.content).toBe(JSON.stringify(tactics.PACER_INPUT));
    // Every call went out sealed: no inner path is on the wire.
    expect(seen.some((each) => each.includes('/v1/analysis/'))).toBe(false);

    expect(await pacers.withdrawPacerConsent()).toMatchObject({ consented: false });
    expect(await pacers.decidePacer(tactics.PACER_INPUT as never)).toEqual({ kind: 'refused' });
  });

  it('reads an answer the device will not ride as no decision', async () => {
    const answers = [
      JSON.stringify({ plan: 'even', intent: 'lift', say: 'Hold 300 watts.' }),
      undefined,
    ];
    let next = 0;
    const { w, send } = await world(() => answers[next++]);
    const { pacers } = await connected(send, w);
    const status = await pacers.pacerStatus();
    if (status.kind !== 'offered') throw new Error('not offered');
    await pacers.consentToPacer(status);
    expect(await pacers.decidePacer(tactics.PACER_INPUT as never)).toEqual({ kind: 'invalid' });
    expect(await pacers.decidePacer(tactics.PACER_INPUT as never)).toEqual({ kind: 'failed' });
  });

  it('offers nothing and sends nothing with no instance, or from a website’s copy', async () => {
    const { w, send, seen } = await world(() => tactics.PACER_ANSWER);
    const alone = await device(send);
    expect(alone.pacers.offered()).toBe(false);
    expect(await alone.pacers.decidePacer(tactics.PACER_INPUT as never)).toEqual({
      kind: 'failed',
    });
    expect(seen).toEqual([]);
    const anna = await connected(send, w);
    expect(anna.pacers.offered()).toBe(true);
    const website = await device(send, LOADED_FROM_A_WEBSITE);
    for (const key of [INSTANCE_ACCOUNT_STORAGE_KEY, INSTANCE_SESSION_STORAGE_KEY]) {
      const value = anna.storage.getItem(key);
      if (value !== null) website.storage.setItem(key, value);
    }
    seen.length = 0;
    expect(website.pacers.offered()).toBe(false);
    expect(await website.pacers.decidePacer(tactics.PACER_INPUT as never)).toEqual({
      kind: 'failed',
    });
    expect(seen).toEqual([]);
  });
});

describe('what this device reads back from the instance (#2712)', () => {
  it('reads an answer again, whatever the instance checked', () => {
    expect(parsePacerReply(200, { plan: 'even', intent: 'hold', say: 'Stay with me.' })).toEqual({
      kind: 'answer',
      direction: { plan: 'even', intent: 'hold' },
      say: 'Stay with me.',
    });
    for (const body of [
      { plan: 'even', intent: 'hold', say: '', watts: 900 },
      { plan: 'even', intent: 'hold', say: 'Your TSS is fine.' },
      { plan: 'sprint', intent: 'hold', say: '' },
      null,
    ]) {
      expect(parsePacerReply(200, body), JSON.stringify(body)).toEqual({ kind: 'invalid' });
    }
  });

  it('reads a refusal before a model, a model miss and anything else apart', () => {
    const coded = (code: string) => ({ error: { code } });
    for (const code of ['tactics_consent_required', 'local_unavailable', 'tactics_busy']) {
      expect(parsePacerReply(409, coded(code))).toEqual({ kind: 'refused' });
    }
    expect(parsePacerReply(502, coded('tactics_invalid'))).toEqual({ kind: 'invalid' });
    expect(parsePacerReply(502, coded('tactics_failed'))).toEqual({ kind: 'failed' });
    expect(parsePacerReply(429, coded('rate_limited'))).toEqual({ kind: 'failed' });
    expect(parsePacerReply(500, 'oops')).toEqual({ kind: 'failed' });
  });

  it('reads a status, and nothing that is not one', () => {
    expect(
      parsePacerStatus({
        offered: true,
        instance: 'https://ride.example',
        modelAddress: 'http://127.0.0.1:11434/v1',
        consent: null,
        consented: false,
      }),
    ).toEqual({
      kind: 'offered',
      instance: 'https://ride.example',
      modelAddress: 'http://127.0.0.1:11434/v1',
      consented: false,
    });
    expect(parsePacerStatus({ offered: false, consented: false })).toEqual({ kind: 'not-offered' });
    expect(parsePacerStatus({ offered: true, consented: false })).toEqual({ kind: 'unavailable' });
    expect(parsePacerStatus('yes')).toEqual({ kind: 'unavailable' });
  });
});
