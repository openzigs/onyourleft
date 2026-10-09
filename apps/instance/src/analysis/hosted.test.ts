// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Everything a hosted model is sent is masked on the instance (#1101,
 * ADR 0046 D-10): the system prompt, the ride input's first message, every
 * tool result, every rewrite and the model's own arguments sent back to it.
 *
 * A whole hosted run is driven through the real source (`modelForSource`),
 * the real seam (`hostedBehindMasking`), the real hosted connection and the
 * real agent with its four tools, over a real three-athlete store and history
 * index, against the fake model server reached through a fetch that stands in
 * for the internet. The planted details are `@onyourleft/analysis`'s own
 * (#839's), placed in a goal, a ride summary, a note and a write-up, and the
 * rider's guard comes from their synced `masking` item.
 *
 * Not here: a workout name (the workouts tool is #1100, not built), the sent
 * log (ADR 0046 Q8's preview is "not separately ruled", and its route needs
 * #1095's job table).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { MASK_PLACEHOLDER, PATTERNS_ONLY, type MaskingGuard } from '@onyourleft/analysis';
import { PLANTED_DETAILS, PLANTED_GUARD, personalDetailFaults } from '@onyourleft/analysis/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHistory, type History } from '../history/history.ts';
import { scriptedEmbedder } from '../history/history-testing.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore, SyncItemWrite } from '../store/sql-store.ts';
import {
  createStoreHarness,
  registrationFixture,
  type StoreHarness,
} from '../store/testing/index.ts';
import { runAnalysisAgent, type AgentEvent, type AgentOutcome } from './agent.ts';
import { movableClock, RIDE_INPUT } from './agent-testing.ts';
import { startFakeModelServer, type FakeModelServer } from './fake-model-server-testing.ts';
import type { HostedKeyState } from './hosted-key.ts';
import { MARKER_KEY } from './hosted-key-testing.ts';
import {
  hostedBehindMasking,
  maskedConnection,
  MASKING_ITEM_KEY,
  parseMaskingItem,
  readMaskingGuard,
  type MaskingItemBody,
} from './hosted.ts';
import { createHostedModel, createLocalModel } from './model.ts';
import type { ModelConnection, ModelTurnRequest } from './model-turn.ts';
import { modelForSource, type AnalysisSource } from './source.ts';

const ATHLETES = ['athlete-a', 'athlete-b', 'athlete-c'] as const;
const [A] = ATHLETES;
const HOSTED = new URL('https://models.example/v1');
const HELD: HostedKeyState = {
  kind: 'held',
  url: HOSTED.href,
  model: 'hosted-model',
  athleteId: A,
  key: MARKER_KEY,
};

/** Every planted detail in one plain sentence. */
const PLANTED_TEXT = `Remember ${PLANTED_DETAILS.map((detail) => detail.text).join(' and ')} next time.`;

/** The same items with nothing personal in them: the byte-identical control's fixture. */
const CLEAN_TEXT = 'Remember the long climb and the cafe stop next time.';

/** The guard as the device syncs it. */
function itemBody(guard: MaskingGuard): string {
  return JSON.stringify({
    words: guard.words,
    zones: guard.zones.map((zone) => ({
      label: zone.label,
      latitude: zone.centre.latitude,
      longitude: zone.centre.longitude,
      radius: zone.radius,
    })),
  } satisfies MaskingItemBody);
}

let harness: StoreHarness;
let store: SqlStore;
let history: History;
let server: FakeModelServer | undefined;
let planted = 0;

async function plant(athleteId: string, kind: SyncItemWrite['kind'], key: string, body: string) {
  planted += 1;
  await harness.write((writer) =>
    writer.putSyncItem({
      athleteId,
      kind,
      key,
      body: new TextEncoder().encode(body),
      digest: String(planted).padStart(64, '0'),
      now: 1_790_000_000 + planted,
    }),
  );
}

/** A's goal, ride summary, note and write-up, each carrying `text`; and B's and C's too. */
async function plantHistory(text: string): Promise<void> {
  for (const athlete of ATHLETES) {
    await plant(athlete, 'goal', `goal-${athlete}`, JSON.stringify({ text: `Goal: ${text}` }));
    await plant(
      athlete,
      'ride-summary',
      `ride-${athlete}`,
      JSON.stringify({ passages: [`An older ride. ${text}`] }),
    );
    await plant(
      athlete,
      'note',
      `note-${athlete}`,
      JSON.stringify({ text: `Kestrel notes. ${text}` }),
    );
  }
  // The write-up passage: the screen refuses a link, so it carries only what it may.
  await plant(
    A,
    'write-up',
    'write-up-a',
    JSON.stringify({
      text:
        text === CLEAN_TEXT
          ? 'Kestrel notes. The climb went well.'
          : 'Kestrel notes. The climb near Kestrel Farm and 12 Acacia Avenue went well, with Anneliese.',
    }),
  );
}

beforeEach(async () => {
  harness = await createStoreHarness();
  await harness.write(async (writer) => {
    for (const athlete of ATHLETES) await writer.registerAthlete(registrationFixture(athlete));
  });
  store = await openSqlStore(harness.path);
  history = createHistory({ store, embedder: scriptedEmbedder() });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await history.idle();
  await store.close();
  await harness.destroy();
});

/** The fake server's script: every tool, a write-up the screen withholds, then one it passes. */
async function scriptedServer(): Promise<FakeModelServer> {
  server = await startFakeModelServer([
    {
      kind: 'tool-calls',
      calls: [
        { name: 'ride_sections', arguments: '{}' },
        { name: 'recent_rides', arguments: '{"count":2}' },
        { name: 'goals', arguments: '{}' },
        // The model's own argument names a listed word: it is masked when sent back.
        { name: 'history_search', arguments: '{"query":"Kestrel notes Kestrel Farm"}' },
      ],
    },
    { kind: 'text', text: 'A steady ride. The knee reached 12 degrees on the climb.' },
    { kind: 'text', text: 'A steady ride.\n\nThe climb took the most effort.' },
  ]);
  return server;
}

/** A fetch standing in for the internet: requests under the hosted base go to the fake server. */
function internet(model: FakeModelServer) {
  const bodies: string[] = [];
  const base = HOSTED.href.replace(/\/+$/, '');
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (typeof init?.body === 'string') bodies.push(init.body);
    if (!url.startsWith(`${base}/`)) return Promise.reject(new Error('another host'));
    return globalThis.fetch(`${model.baseUrl.href}${url.slice(base.length)}`, init);
  }) as typeof globalThis.fetch;
  return { bodies, fetch };
}

interface Ran {
  readonly outcome: AgentOutcome;
  readonly events: AgentEvent[];
}

async function runOn(model: ModelConnection): Promise<Ran> {
  await history.catchUp();
  const events: AgentEvent[] = [];
  const outcome = await runAnalysisAgent({
    job: { athleteId: A, input: RIDE_INPUT },
    model,
    reads: store,
    history,
    clock: movableClock(),
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });
  return { outcome, events };
}

/** The model for A's job on `source`, through the real source and seam. */
function sourced(source: AnalysisSource, fetch: typeof globalThis.fetch) {
  return modelForSource(source, A, {
    local: createLocalModel({
      settings: { baseUrl: server?.baseUrl ?? new URL('http://127.0.0.1/v1'), model: 'scripted' },
      resolve: () => Promise.resolve(['127.0.0.1']),
    }),
    hostedKey: () => Promise.resolve(HELD),
    recordedConsent: () => Promise.resolve(HOSTED.origin),
    guard: (athleteId) => readMaskingGuard(store, athleteId),
    behindMasking: (key, guard) => hostedBehindMasking(key, guard, fetch),
  });
}

/** Every tool name whose result is in the last request the server was sent. */
function toolsAnswered(model: FakeModelServer): string[] {
  const messages = (model.requests.at(-1)?.messages ?? []) as {
    role: string;
    tool_call_id?: string;
  }[];
  const calls = (
    model.requests.at(-1)?.messages as {
      tool_calls?: { id: string; function: { name: string } }[];
    }[]
  ).flatMap((message) => message.tool_calls ?? []);
  return messages
    .filter((message) => message.role === 'tool')
    .map((message) => calls.find((call) => call.id === message.tool_call_id)?.function.name ?? '');
}

describe('planted details never leave for a hosted model (#1101)', () => {
  beforeEach(async () => {
    await plantHistory(PLANTED_TEXT);
    await plant(A, 'masking', MASKING_ITEM_KEY, itemBody(PLANTED_GUARD));
  });

  it('every tool fires, every request is masked, and the placeholders are what is sent', async () => {
    const model = await scriptedServer();
    const { bodies, fetch } = internet(model);
    const chosen = await sourced('instance-hosted', fetch);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    const { outcome, events } = await runOn(chosen.model);
    expect(outcome.kind).toBe('written');

    // Three requests: the tools, the write-up the screen withheld, and the rewrite.
    expect(model.requests).toHaveLength(3);
    expect(bodies).toHaveLength(3);
    expect(toolsAnswered(model).sort()).toStrictEqual([
      'goals',
      'history_search',
      'recent_rides',
      'ride_sections',
    ]);
    const last = JSON.stringify(model.requests.at(-1));
    // The rewrite instruction went too.
    expect(model.requests[2]?.messages).toBeDefined();

    for (const body of bodies) expect(personalDetailFaults(body)).toStrictEqual([]);
    for (const body of model.requests) expect(personalDetailFaults(body)).toStrictEqual([]);
    for (const placeholder of Object.values(MASK_PLACEHOLDER)) expect(last).toContain(placeholder);
    // The model's own argument, sent back to it, is masked too.
    expect(last).toContain('Kestrel notes [masked]');
    // Nothing the job was told carries a planted detail either.
    expect(personalDetailFaults(events)).toStrictEqual([]);
  });

  it('without the seam the same run leaks every kind — what the masking is for', async () => {
    const model = await scriptedServer();
    const { bodies, fetch } = internet(model);
    // Built directly, as no shipped module may (hosted-seam.test.ts).
    const unmasked = createHostedModel({
      baseUrl: HOSTED,
      model: 'hosted-model',
      apiKey: MARKER_KEY,
      fetch,
    });
    expect((await runOn(unmasked)).outcome.kind).toBe('written');
    const leaked = new Set(
      bodies.flatMap((body) => personalDetailFaults(body)).map((fault) => fault.split(':')[0]),
    );
    expect([...leaked].sort()).toStrictEqual(Object.keys(MASK_PLACEHOLDER).sort());
  });

  it('the rider’s own instance and its local model get the full text (ADR 0040 D-9)', async () => {
    const model = await scriptedServer();
    const { bodies, fetch } = internet(model);
    const chosen = await sourced('instance-local', fetch);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect((await runOn(chosen.model)).outcome.kind).toBe('written');
    // Nothing went through the hosted fetch, and the local server was sent it all.
    expect(bodies).toStrictEqual([]);
    const sent = JSON.stringify(model.requests);
    expect(sent).toContain('priya.rider+club@example.com');
    expect(sent).toContain('Kestrel Farm');
    expect(sent).not.toContain(MASK_PLACEHOLDER.masked);
  });

  it('a hosted run writes nothing to the database', async () => {
    const model = await scriptedServer();
    const { fetch } = internet(model);
    await history.catchUp();
    const digest = (): string[] =>
      [harness.path, `${harness.path}-wal`].map((path) =>
        existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'none',
      );
    const before = digest();
    const chosen = await sourced('instance-hosted', fetch);
    if (!chosen.ok) throw new Error('no hosted model');
    expect((await runOn(chosen.model)).outcome.kind).toBe('written');
    expect(digest()).toStrictEqual(before);
  });
});

describe('the control: nothing to mask, bodies byte-identical (#839’s, kept)', () => {
  it('a clean run over a guard of nothing sends exactly what the unmasked connection sends', async () => {
    await plantHistory(CLEAN_TEXT);
    await plant(A, 'masking', MASKING_ITEM_KEY, itemBody(PATTERNS_ONLY));

    const first = await scriptedServer();
    const masked = internet(first);
    const chosen = await sourced('instance-hosted', masked.fetch);
    if (!chosen.ok) throw new Error('no hosted model');
    expect((await runOn(chosen.model)).outcome.kind).toBe('written');
    await first.close();

    const second = await scriptedServer();
    const plain = internet(second);
    const unmasked = createHostedModel({
      baseUrl: HOSTED,
      model: 'hosted-model',
      apiKey: MARKER_KEY,
      fetch: plain.fetch,
    });
    expect((await runOn(unmasked)).outcome.kind).toBe('written');

    expect(masked.bodies).toHaveLength(3);
    expect(masked.bodies).toStrictEqual(plain.bodies);
  });
});

describe('a missing or unreadable guard is a request not sent', () => {
  beforeEach(async () => {
    await plantHistory(PLANTED_TEXT);
  });

  it.each([
    ['no masking item synced', undefined],
    ['a masking item that is not JSON', '{"words":'],
    [
      'a zone with no radius',
      '{"words":[],"zones":[{"label":"Home","latitude":52,"longitude":0}]}',
    ],
    ['a word that is not text', '{"words":[7],"zones":[]}'],
  ])('%s: hosted_unavailable, and the hosted server is sent nothing', async (_case, body) => {
    if (body !== undefined) await plant(A, 'masking', MASKING_ITEM_KEY, body);
    const model = await scriptedServer();
    const { bodies, fetch } = internet(model);
    expect(await sourced('instance-hosted', fetch)).toStrictEqual({
      ok: false,
      failure: 'hosted_unavailable',
    });
    expect(bodies).toStrictEqual([]);
    expect(model.requests).toStrictEqual([]);
  });

  it('another athlete’s guard is not this one’s', async () => {
    await plant('athlete-b', 'masking', MASKING_ITEM_KEY, itemBody(PLANTED_GUARD));
    expect(await readMaskingGuard(store, A)).toBeUndefined();
    expect(await readMaskingGuard(store, 'athlete-b')).toStrictEqual(PLANTED_GUARD);
  });

  it('a deleted masking item is no guard', async () => {
    await plant(A, 'masking', MASKING_ITEM_KEY, itemBody(PLANTED_GUARD));
    await harness.write((writer) =>
      writer.deleteSyncItem(A, 'masking', MASKING_ITEM_KEY, 1_800_000_000),
    );
    expect(await readMaskingGuard(store, A)).toBeUndefined();
  });
});

describe('the masking item', () => {
  it('reads the body the device writes into the guard it was made from', () => {
    expect(parseMaskingItem(itemBody(PLANTED_GUARD))).toStrictEqual(PLANTED_GUARD);
    expect(parseMaskingItem('{"words":[],"zones":[]}')).toStrictEqual(PATTERNS_ONLY);
  });

  it.each([
    ['not JSON', 'words'],
    ['not an object', '[]'],
    ['no zones', '{"words":[]}'],
    ['a key it does not know', '{"words":[],"zones":[],"extra":1}'],
    [
      'a latitude out of range',
      '{"words":[],"zones":[{"label":"x","latitude":91,"longitude":0,"radius":5}]}',
    ],
    [
      'a longitude that is text',
      '{"words":[],"zones":[{"label":"x","latitude":1,"longitude":"0","radius":5}]}',
    ],
    [
      'a radius of nought',
      '{"words":[],"zones":[{"label":"x","latitude":1,"longitude":0,"radius":0}]}',
    ],
    ['a zone with no label', '{"words":[],"zones":[{"latitude":1,"longitude":0,"radius":5}]}'],
  ])('refuses %s whole', (_case, text) => {
    expect(parseMaskingItem(text)).toBeUndefined();
  });

  it('is never indexed, so no history search can return it', async () => {
    await plant(A, 'masking', MASKING_ITEM_KEY, itemBody(PLANTED_GUARD));
    await history.catchUp();
    const found = await history.searchFor(A, {
      query: 'Kestrel Farm Anneliese Oakbrook',
      limit: 6,
      characters: 5_400,
    });
    expect(found).toStrictEqual({ ok: true, value: { passages: [] } });
  });
});

describe('maskedConnection masks every message of every request', () => {
  it('the system prompt, the user text, the model’s text and arguments, and every tool result', async () => {
    const seen: ModelTurnRequest[] = [];
    const inner: ModelConnection = {
      turn: (request) => {
        seen.push(request);
        return Promise.resolve({ ok: true, text: '', calls: [], finish: 'stop', usage: {} });
      },
    };
    const detail = 'Write to priya.rider+club@example.com about Kestrel Farm.';
    await maskedConnection(inner, PLANTED_GUARD).turn({
      system: detail,
      messages: [
        { role: 'user', text: detail },
        {
          role: 'assistant',
          text: detail,
          calls: [
            { callId: 'c1', toolName: 'history_search', input: { query: detail, deep: [detail] } },
            { callId: 'c2', toolName: 'goals', invalid: true },
          ],
        },
        { role: 'tool', results: [{ callId: 'c1', toolName: 'history_search', text: detail }] },
      ],
      tools: [],
      maxOutputTokens: 10,
      timeoutMilliseconds: 1_000,
      signal: new AbortController().signal,
    });
    const masked = 'Write to [email] about [masked].';
    expect(seen[0]?.system).toBe(masked);
    expect(seen[0]?.messages).toStrictEqual([
      { role: 'user', text: masked },
      {
        role: 'assistant',
        text: masked,
        calls: [
          { callId: 'c1', toolName: 'history_search', input: { query: masked, deep: [masked] } },
          { callId: 'c2', toolName: 'goals', invalid: true },
        ],
      },
      { role: 'tool', results: [{ callId: 'c1', toolName: 'history_search', text: masked }] },
    ]);
  });
});
