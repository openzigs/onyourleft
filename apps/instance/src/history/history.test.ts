// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The history index end to end (#835, ADR 0040): items synced over HTTP, cut
 * and embedded by the catch-up sync schedules, and searched over HTTP by the
 * device-key session — all through the real handler, the real listener and a
 * real database file, with a scripted embedding model.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../auth/identity.ts';
import type { IdentityInstance } from '../auth/identity-testing.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import type { EmbedFailure } from './embedder.ts';
import {
  dot,
  FAILED_RETRY_SECONDS,
  labelFor,
  MAXIMUM_SEARCH_CHARACTERS,
  relativeAge,
  rideStarts,
} from './history.ts';
import { scriptedEmbedder, scriptedVector, SCRIPTED_DIMENSION } from './history-testing.ts';

type Rider = Awaited<ReturnType<typeof syncWorld>>['riders'][number];

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const WEEK = 7 * 24 * 60 * 60;

async function put(rider: Rider, kind: string, key: string, body: unknown): Promise<number> {
  // Sealed (#1192): every sync route is sealed-only.
  const response = await world!.request('POST', `/v1/sync/items/${kind}/${key}`, {
    token: rider.token,
    body: { body: typeof body === 'string' ? body : JSON.stringify(body) },
  });
  return response.status;
}

async function search(
  rider: Rider,
  body: Record<string, unknown>,
): Promise<{
  status: number;
  body: { passages?: { kind: string; label: string; text: string }[] };
}> {
  // Sealed (#1192): history search is sealed-only.
  const response = await world!.request('POST', '/v1/history/search', {
    token: rider.token,
    body,
  });
  return { status: response.status, body: (await response.json()) as never };
}

const ask = (query: string, extra: Record<string, unknown> = {}) => ({
  query,
  limit: 6,
  characters: MAXIMUM_SEARCH_CHARACTERS,
  ...extra,
});

/** A signed record of a ride, as sync stores one: only its claims are read here. */
async function rideRecord(athleteId: string, activityId: string, startedAt: number): Promise<void> {
  await world!.freshRead((store) =>
    store.putActivityRecord({
      athleteId,
      contentSha256: activityId
        .padEnd(64, '0')
        .replace(/[^0-9a-f]/g, 'a')
        .slice(0, 64),
      signedRecord: new TextEncoder().encode(JSON.stringify({ claims: { activityId, startedAt } })),
      receivedAt: startedAt,
    }),
  );
}

describe('keeping the index (ADR 0040 D-1, D-4, D-7)', () => {
  it('indexes an item as it syncs, and finds it for its owner', async () => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    expect(await put(anna, 'note', 'n1', { text: 'Hill repeats felt strong this week.' })).toBe(
      200,
    );
    await world.history.idle();
    const found = await search(anna, ask('hill repeats'));
    expect(found.status).toBe(200);
    expect(found.body.passages).toStrictEqual([
      { kind: 'note', label: 'Your note', text: 'Hill repeats felt strong this week.' },
    ]);
  });

  it('writes nothing while the model is down, waits, and indexes everything once it is back (fails closed)', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failWith = 'unreachable';
    await put(anna, 'note', 'n1', { text: 'Recovery week.' });
    await world.history.idle();
    expect(
      await world.freshRead((store) =>
        store.listPendingHistorySources(['note'], embedder.model, embedder.convention, 10),
      ),
    ).toHaveLength(1);
    expect((await search(anna, ask('recovery'))).status).toBe(503);

    embedder.failWith = undefined;
    const report = await world.history.catchUp();
    expect(report).toEqual({ indexed: 1, failed: 0, stopped: null });
    expect((await search(anna, ask('recovery'))).body.passages).toHaveLength(1);
  });

  it('is idempotent: a second catch-up embeds nothing, and an unchanged put changes nothing', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    await put(anna, 'goal', 'g1', { text: 'Ride a century by June.' });
    await world.history.idle();
    const calls = embedder.calls.length;
    expect(await world.history.catchUp()).toEqual({ indexed: 0, failed: 0, stopped: null });
    await put(anna, 'goal', 'g1', { text: 'Ride a century by June.' });
    await world.history.idle();
    expect(embedder.calls.length).toBe(calls);
  });

  it('is rebuilt whole from the synced items after every row is deleted (D-1)', async () => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    await put(anna, 'note', 'n1', { text: 'Tempo on the flat.' });
    await put(anna, 'document', 'd1', 'Week one: base miles. Week two: tempo.');
    await world.history.idle();
    const before = (await search(anna, ask('tempo'))).body.passages;
    // What an operator wiping the index does: every derived row goes, the items stay.
    const { path } = world;
    const { openDatabase } = await import('../store/node-sqlite.ts');
    const database = openDatabase(path);
    database.exec('DELETE FROM history_passage; DELETE FROM history_source;');
    database.close();
    expect((await search(anna, ask('tempo'))).body.passages).toStrictEqual([]);
    await world.history.catchUp();
    expect((await search(anna, ask('tempo'))).body.passages).toStrictEqual(before);
  });

  it('re-embeds everything under a new model, and never ranks the old model’s rows (D-7)', async () => {
    const first = scriptedEmbedder({ model: 'first-model' });
    const made = await syncWorld(1, { embedder: first });
    world = made.world;
    const [anna] = made.riders as [Rider];
    await put(anna, 'note', 'n1', { text: 'Sweet spot intervals.' });
    await world.history.idle();
    const { createHistory } = await import('./history.ts');
    const { openSqlStore } = await import('../store/open-sql-store.ts');
    const store = await openSqlStore(world.path);
    try {
      const second = scriptedEmbedder({ model: 'second-model' });
      const after = createHistory({ store, embedder: second });
      const caller = {
        athleteId: anna.athleteId,
        deviceKey: '',
        tokenSha256: '',
        standing: 'active' as const,
      };
      // Before it has caught up: nothing, rather than the first model's rows.
      expect(await after.search(caller, ask('sweet spot'))).toEqual({
        ok: true,
        value: { passages: [] },
      });
      expect(await after.catchUp()).toEqual({ indexed: 1, failed: 0, stopped: null });
      expect(second.calls.map((call) => call.texts)).toContainEqual(['Sweet spot intervals.']);
      const found = await after.search(caller, ask('sweet spot'));
      expect(found.ok && found.value.passages).toHaveLength(1);
      expect(await store.summariseHistoryIndex(anna.athleteId)).toStrictEqual([
        { model: 'second-model', dimension: SCRIPTED_DIMENSION, passages: 1 },
      ]);
    } finally {
      await store.close();
    }
  });

  it('keeps no passage of an item deleted or replaced while it was being embedded', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    let deleteDuringEmbed = true;
    const original = embedder.embed.bind(embedder);
    embedder.embed = async (texts, purpose) => {
      if (deleteDuringEmbed && purpose === 'document') {
        deleteDuringEmbed = false;
        await world!.request('DELETE', '/v1/sync/items/note/n1', { token: anna.token });
      }
      return original(texts, purpose);
    };
    await put(anna, 'note', 'n1', { text: 'Deleted mid-flight.' });
    await world.history.idle();
    await world.history.catchUp();
    expect((await search(anna, ask('deleted'))).body.passages).toStrictEqual([]);
  });

  it('cuts nothing from a side-camera report, whatever it says', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    await put(anna, 'side-camera-report', 'r1', { sentences: ['Possibly more upright.'] });
    await world.history.idle();
    expect(embedder.calls.filter((call) => call.purpose === 'document')).toStrictEqual([]);
  });

  it.each<EmbedFailure>(['unreachable', 'not-local', 'unresolved', 'unavailable', 'server-error'])(
    'stops a catch-up when the model cannot be asked (%s), and says so',
    async (failure) => {
      const embedder = scriptedEmbedder();
      const made = await syncWorld(1, { embedder });
      world = made.world;
      const [anna] = made.riders as [Rider];
      embedder.failWith = failure;
      await put(anna, 'note', 'n1', { text: 'x' });
      await put(anna, 'note', 'n2', { text: 'y' });
      await world.history.idle();
      expect(await world.history.catchUp()).toEqual({ indexed: 0, failed: 0, stopped: failure });
      // Nothing was marked: both wait for the model.
      expect(
        await world.freshRead((store) =>
          store.listPendingHistorySources(['note'], embedder.model, embedder.convention, 10),
        ),
      ).toHaveLength(2);
    },
  );

  it.each<EmbedFailure>(['refused', 'malformed'])(
    'marks an item the model answers %s for and goes past it, so one item cannot stop the rest — #918 item 2',
    async (failure) => {
      const embedder = scriptedEmbedder();
      const made = await syncWorld(1, { embedder });
      world = made.world;
      const [anna] = made.riders as [Rider];
      embedder.failFor = (text) => (text.includes('poison') ? failure : undefined);
      // The poison item is the OLDEST, so it is first on every sweep.
      await put(anna, 'note', 'n1', { text: 'A poison note.' });
      await put(anna, 'note', 'n2', { text: 'Threshold intervals went well.' });
      await put(anna, 'goal', 'g1', { text: 'Threshold by spring.' });
      await world.history.idle();
      // The two after it are indexed; the poison one is marked, not retried.
      expect((await search(anna, ask('threshold'))).body.passages).toHaveLength(2);
      const asked = embedder.calls.filter((call) => call.purpose === 'document').length;
      expect(await world.history.catchUp()).toEqual({ indexed: 0, failed: 0, stopped: null });
      expect(embedder.calls.filter((call) => call.purpose === 'document')).toHaveLength(asked);
      expect(
        await world.freshRead((store) =>
          store.listPendingHistorySources(
            ['note', 'goal'],
            embedder.model,
            embedder.convention,
            10,
          ),
        ),
      ).toStrictEqual([]);
    },
  );

  it('marks the one item the model answers 500 for, and indexes every other athlete’s after it — #928', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(2, { embedder });
    world = made.world;
    const [anna, ben] = made.riders as [Rider, Rider];
    // Ollama's 500 for a text its model makes a NaN of (ollama/ollama#13572).
    embedder.failFor = (text) => (text.includes('nan') ? 'server-error' : undefined);
    embedder.failWith = 'unreachable';
    // The NaN item is the OLDEST on the instance, so it heads every sweep.
    await put(anna, 'note', 'n1', { text: 'A nan note.' });
    await put(anna, 'note', 'n2', { text: 'Threshold intervals went well.' });
    await put(ben, 'goal', 'g1', { text: 'Threshold by spring.' });
    await world.history.idle();
    embedder.failWith = undefined;
    expect(await world.history.catchUp()).toEqual({ indexed: 3, failed: 1, stopped: null });
    expect((await search(anna, ask('threshold'))).body.passages).toHaveLength(1);
    expect((await search(ben, ask('threshold'))).body.passages).toHaveLength(1);
    // Marked, so the next sweep does not stop on it again inside its hour.
    expect(await world.history.catchUp()).toEqual({ indexed: 0, failed: 0, stopped: null });
  });

  it('does not ask about a held item again when it ends a page, and reaches the page after — #928', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failFor = (text) => (text.includes('nan') ? 'server-error' : undefined);
    embedder.failWith = 'unreachable';
    // A sweep reads sixteen at a time: the NaN item is the sixteenth, and the
    // only item that could clear it is on the next page.
    for (let index = 1; index <= 15; index += 1) {
      await put(anna, 'note', `n${index}`, { text: `Fine note ${index}.` });
    }
    await put(anna, 'note', 'n16', { text: 'A nan note.' });
    await put(anna, 'note', 'n17', { text: 'The seventeenth.' });
    await world.history.idle();
    embedder.failWith = undefined;
    const before = embedder.calls.length;
    expect(await world.history.catchUp()).toEqual({ indexed: 17, failed: 1, stopped: null });
    expect(embedder.calls.length - before).toBe(17);
  });

  it('marks two adjacent items the model answers 500 for, and indexes another athlete’s after them — #928', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(2, { embedder });
    world = made.world;
    const [anna, ben] = made.riders as [Rider, Rider];
    embedder.failFor = (text) => (text.includes('nan') ? 'server-error' : undefined);
    embedder.failWith = 'unreachable';
    // A rider who saved the same text twice: two NaN items, side by side, at the
    // head of the instance-wide queue. Holding only one of them halted every sweep.
    await put(anna, 'note', 'n1', { text: 'A nan note.' });
    await put(anna, 'note', 'n2', { text: 'A nan note.' });
    await put(ben, 'goal', 'g1', { text: 'Threshold by spring.' });
    await world.history.idle();
    embedder.failWith = undefined;
    expect(await world.history.catchUp()).toEqual({ indexed: 3, failed: 2, stopped: null });
    expect((await search(ben, ask('threshold'))).body.passages).toHaveLength(1);
    expect(await world.history.catchUp()).toEqual({ indexed: 0, failed: 0, stopped: null });
  });

  it('marks three items the model answers 500 for across a page boundary — #928', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failFor = (text) => (text.includes('nan') ? 'server-error' : undefined);
    embedder.failWith = 'unreachable';
    // Fifteen fine items, then the sixteenth to eighteenth are NaN (a page ends
    // after the sixteenth), then one fine item on the next page.
    for (let index = 1; index <= 15; index += 1) {
      await put(anna, 'note', `n${index}`, { text: `Fine note ${index}.` });
    }
    for (let index = 16; index <= 18; index += 1) {
      await put(anna, 'note', `n${index}`, { text: `A nan note ${index}.` });
    }
    await put(anna, 'note', 'n19', { text: 'The nineteenth.' });
    await world.history.idle();
    embedder.failWith = undefined;
    expect(await world.history.catchUp()).toEqual({ indexed: 19, failed: 3, stopped: null });
  });

  it('asks at most one page of items in an outage, and marks none of them — #928', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failWith = 'server-error';
    for (let index = 1; index <= 20; index += 1) {
      await put(anna, 'note', `n${index}`, { text: `Note ${index}.` });
    }
    await world.history.idle();
    const before = embedder.calls.length;
    expect(await world.history.catchUp()).toEqual({
      indexed: 0,
      failed: 0,
      stopped: 'server-error',
    });
    expect(embedder.calls.length - before).toBe(16);
    expect(
      await world.freshRead((store) =>
        store.listPendingHistorySources(['note'], embedder.model, embedder.convention, 50),
      ),
    ).toHaveLength(20);
  });

  it('marks nothing when the model answers 500 for every item — #928', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failWith = 'server-error';
    await put(anna, 'note', 'n1', { text: 'x' });
    await put(anna, 'note', 'n2', { text: 'y' });
    await put(anna, 'note', 'n3', { text: 'z' });
    await world.history.idle();
    const before = embedder.calls.length;
    expect(await world.history.catchUp()).toEqual({
      indexed: 0,
      failed: 0,
      stopped: 'server-error',
    });
    // Every item in the page asked about once, not one answer, and then it
    // stopped: the server is at fault, and nothing is marked.
    expect(embedder.calls.length - before).toBe(3);
    expect(
      await world.freshRead((store) =>
        store.listPendingHistorySources(['note'], embedder.model, embedder.convention, 10),
      ),
    ).toHaveLength(3);
    // The model recovers: all three are indexed, none was held back an hour.
    embedder.failWith = undefined;
    expect(await world.history.catchUp()).toEqual({ indexed: 3, failed: 0, stopped: null });
  });

  it('leaves a lone item the model answers 500 for unmarked, with nothing else to ask about — #928', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failFor = (text) => (text.includes('nan') ? 'server-error' : undefined);
    await put(anna, 'note', 'n1', { text: 'A nan note.' });
    await world.history.idle();
    expect(await world.history.catchUp()).toEqual({
      indexed: 0,
      failed: 0,
      stopped: 'server-error',
    });
    expect(
      await world.freshRead((store) =>
        store.listPendingHistorySources(['note'], embedder.model, embedder.convention, 10),
      ),
    ).toHaveLength(1);
  });

  it('tries a marked item again once its hour is up, and not before — #918 item 2', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failFor = (text) => (text.includes('odd') ? 'refused' : undefined);
    await put(anna, 'note', 'n1', { text: 'An odd note about cadence.' });
    await world.history.idle();
    expect((await search(anna, ask('cadence'))).body.passages).toStrictEqual([]);
    // The refusal was transient: the model takes it now.
    embedder.failFor = undefined;
    world.clock.ms += (FAILED_RETRY_SECONDS - 1) * 1000;
    expect(await world.history.catchUp()).toEqual({ indexed: 0, failed: 0, stopped: null });
    world.clock.ms += 1000;
    expect(await world.history.catchUp()).toEqual({ indexed: 1, failed: 0, stopped: null });
    expect((await search(anna, ask('cadence'))).body.passages).toHaveLength(1);
  });

  it('counts an item marked failed in the report', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failWith = 'unreachable';
    await put(anna, 'note', 'n1', { text: 'A poison note.' });
    await put(anna, 'note', 'n2', { text: 'Fine.' });
    await world.history.idle();
    embedder.failWith = undefined;
    embedder.failFor = (text) => (text.includes('poison') ? 'malformed' : undefined);
    expect(await world.history.catchUp()).toEqual({ indexed: 2, failed: 1, stopped: null });
  });

  it('records an item the model says is too long, and does not try it again', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(1, { embedder });
    world = made.world;
    const [anna] = made.riders as [Rider];
    embedder.failWith = 'too-long';
    await put(anna, 'note', 'n1', { text: 'x' });
    await world.history.idle();
    embedder.failWith = undefined;
    expect(await world.history.catchUp()).toEqual({ indexed: 0, failed: 0, stopped: null });
  });
});

describe('asking it (ADR 0040 D-3, D-8)', () => {
  it('never returns another athlete’s passage, with three athletes holding the same words (D-3, OWASP LLM08)', async () => {
    const made = await syncWorld(3);
    world = made.world;
    const riders = made.riders as [Rider, Rider, Rider];
    for (const [index, rider] of riders.entries()) {
      await put(rider, 'note', 'same-key', {
        text: `Threshold intervals, rider ${String(index)}.`,
      });
    }
    await world.history.idle();
    for (const [index, rider] of riders.entries()) {
      const found = await search(rider, ask('threshold intervals'));
      expect(found.body.passages?.map((passage) => passage.text)).toStrictEqual([
        `Threshold intervals, rider ${String(index)}.`,
      ]);
    }
  });

  it('takes the athlete from the session and never from the body', async () => {
    const made = await syncWorld(2);
    world = made.world;
    const [anna, bea] = made.riders as [Rider, Rider];
    await put(bea, 'note', 'n1', { text: 'Bea’s private note.' });
    await world.history.idle();
    const asked = await search(anna, { ...ask('private note'), athleteId: bea.athleteId });
    expect(asked.status).toBe(400);
    expect((await search(anna, ask('private note'))).body.passages).toStrictEqual([]);
  });

  it('refuses a request with no session', async () => {
    const made = await syncWorld(0);
    world = made.world;
    // Sealed with no session, it is not one of the sessionless routes.
    const response = await world.request('POST', '/v1/history/search', { body: ask('x') });
    expect(response.status).toBe(401);
  });

  it('returns the best matches first, within the passage count', async () => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    for (let index = 0; index < 8; index += 1) {
      await put(anna, 'note', `n${String(index)}`, {
        text: `Note ${String(index)} about cadence.`,
      });
    }
    await put(anna, 'note', 'best', { text: 'cadence cadence drills' });
    await world.history.idle();
    const found = (await search(anna, ask('cadence drills', { limit: 3 }))).body.passages ?? [];
    expect(found).toHaveLength(3);
    expect(found[0]?.text).toBe('cadence cadence drills');
    expect(dot(scriptedVector('cadence drills'), scriptedVector(found[0]!.text))).toBeGreaterThan(
      dot(scriptedVector('cadence drills'), scriptedVector(found[1]!.text)),
    );
  });

  it('never cuts a passage to fit the budget: one that would pass it is left out', async () => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    const long = `Climbing ${'steady '.repeat(100)}`.trim();
    await put(anna, 'note', 'long', { text: long });
    await put(anna, 'note', 'short', { text: 'Climbing short.' });
    await world.history.idle();
    const found = (await search(anna, ask('climbing', { characters: 100 }))).body.passages ?? [];
    expect(found.map((passage) => passage.text)).toStrictEqual(['Climbing short.']);
    const total = found.reduce((sum, passage) => sum + passage.text.length, 0);
    expect(total).toBeLessThanOrEqual(100);
  });

  it('leaves the ride being written about out, and dates every other ride against it in whole weeks (D-2)', async () => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    const now = 1_790_000_000;
    await rideRecord(anna.athleteId, 'ride-now', now);
    await rideRecord(anna.athleteId, 'ride-old', now - 3 * WEEK - 100);
    await rideRecord(anna.athleteId, 'ride-new', now + WEEK + 5);
    for (const ride of ['ride-now', 'ride-old', 'ride-new', 'ride-unknown']) {
      await put(anna, 'write-up', ride, { text: `A windy ride, ${ride}.` });
    }
    await put(anna, 'ride-summary', 'ride-old', {
      format: 'onyourleft.ride-summary',
      version: 1,
      passages: ['A windy climb of 12 minutes.'],
    });
    await world.history.idle();
    const found = (await search(anna, ask('windy', { rideId: 'ride-now' }))).body.passages ?? [];
    expect(found.map((passage) => passage.text)).not.toContain('A windy ride, ride-now.');
    const labels = Object.fromEntries(found.map((passage) => [passage.text, passage.label]));
    expect(labels['A windy ride, ride-old.']).toBe('Write-up of a ride 3 weeks earlier');
    expect(labels['A windy ride, ride-new.']).toBe('Write-up of a ride 1 week later');
    expect(labels['A windy ride, ride-unknown.']).toBe('Write-up of a ride');
    expect(labels['A windy climb of 12 minutes.']).toBe('Summary of a ride 3 weeks earlier');
    // The label is beside the passage, never inside it (D-2).
    expect(found.every((passage) => !passage.text.includes('weeks'))).toBe(true);
    for (const passage of found) expect(passage.label.length).toBeLessThanOrEqual(40);
  });

  it.each([
    ['no query', { limit: 6, characters: 900 }],
    ['an empty query', ask('  ')],
    ['a query too long', ask('x'.repeat(2_001))],
    ['no limit', { query: 'x', characters: 900 }],
    ['a limit of seven', ask('x', { limit: 7 })],
    ['a limit of nought', ask('x', { limit: 0 })],
    ['a limit that is not whole', ask('x', { limit: 1.5 })],
    ['a budget past six passages of 900', ask('x', { characters: 5_401 })],
    ['a budget of nothing', ask('x', { characters: 0 })],
    ['a ride id that is a path', ask('x', { rideId: '../ride' })],
    ['a field it does not know', ask('x', { model: 'other' })],
  ])('refuses %s', async (_case, body) => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    expect((await search(anna, body)).status).toBe(400);
  });

  it('answers unavailable on an instance with the index off, and when the model cannot be reached', async () => {
    const off = await syncWorld(1, { embedder: null });
    world = off.world;
    expect((await search(off.riders[0]!, ask('x'))).status).toBe(503);
    await world.close();

    const embedder = scriptedEmbedder();
    const down = await syncWorld(1, { embedder });
    world = down.world;
    embedder.failWith = 'unreachable';
    expect((await search(down.riders[0]!, ask('x'))).status).toBe(503);
  });
});

describe('how often it may be asked — #918 item 3', () => {
  it('refuses a rider past their searches a minute, embeds nothing for them, and leaves another rider alone', async () => {
    const embedder = scriptedEmbedder();
    const made = await syncWorld(2, { embedder });
    world = made.world;
    const [anna, ben] = made.riders as [Rider, Rider];
    const { limit, windowMs } = DEFAULT_LIMITS.historySearchesPerAthlete;
    // At the start of a window, so the whole allowance falls inside it.
    world.clock.ms = (Math.floor(world.clock.ms / windowMs) + 1) * windowMs;
    for (let index = 0; index < limit; index += 1) {
      expect((await search(anna, ask('hills'))).status).toBe(200);
    }
    const queries = embedder.calls.filter((call) => call.purpose === 'query').length;
    const over = await search(anna, ask('hills'));
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: { code: 'rate_limited' } });
    // A malformed request past the limit is refused the same way: it counts.
    expect((await search(anna, { query: '' })).status).toBe(429);
    expect(embedder.calls.filter((call) => call.purpose === 'query')).toHaveLength(queries);
    expect((await search(ben, ask('hills'))).status).toBe(200);
    // The next window has a fresh allowance.
    world.clock.ms += windowMs;
    expect((await search(anna, ask('hills'))).status).toBe(200);
  });

  it('forgets the athlete when their window ends, with no further request (#892’s sweep)', async () => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    const { windowMs } = DEFAULT_LIMITS.historySearchesPerAthlete;
    // Past the sign-in's own minute-long keys, so only the search's key is new.
    world.clock.ms = (Math.floor(world.clock.ms / windowMs) + 1) * windowMs;
    world.identity.sweepRateLimits();
    const before = world.identity.heldRateLimitKeys();
    expect((await search(anna, ask('hills'))).status).toBe(200);
    // The search's key, and the session's sealed-request count it came through (#1192).
    expect(world.identity.heldRateLimitKeys()).toBe(before + 2);
    // Swept on its own window's boundary, as every limit is.
    expect(windowMs % world.identity.rateLimitSweepPeriodMs).toBe(0);
    world.clock.ms += windowMs;
    world.identity.sweepRateLimits();
    expect(world.identity.heldRateLimitKeys()).toBe(0);
  });
});

describe('erase and export (ADR 0040 D-10)', () => {
  it('deletes an item’s passages with the item, and every passage with the account', async () => {
    const made = await syncWorld(2);
    world = made.world;
    const [anna, bea] = made.riders as [Rider, Rider];
    await put(anna, 'note', 'n1', { text: 'Anna’s tempo note.' });
    await put(anna, 'note', 'n2', { text: 'Anna’s tempo goal.' });
    await put(bea, 'note', 'n1', { text: 'Bea’s tempo note.' });
    await world.history.idle();

    await world.request('DELETE', '/v1/sync/items/note/n1', { token: anna.token });
    expect(
      (await search(anna, ask('tempo'))).body.passages?.map((each) => each.text),
    ).toStrictEqual(['Anna’s tempo goal.']);

    const erased = await world.request('DELETE', '/v1/account', {
      token: anna.token,
      // The step-up deleting an account needs (#898).
      body: { recoveryCode: anna.recoveryCodes[0] },
    });
    expect(erased.status).toBe(204);
    const left = await world.freshRead(async (store) => ({
      anna: await store.summariseHistoryIndex(anna.athleteId),
      bea: await store.summariseHistoryIndex(bea.athleteId),
    }));
    expect(left.anna).toStrictEqual([]);
    expect(left.bea.reduce((sum, row) => sum + row.passages, 0)).toBe(1);
  });

  it('says in the export which model built the index, and leaves the passages and vectors out', async () => {
    const made = await syncWorld(1);
    world = made.world;
    const [anna] = made.riders as [Rider];
    await put(anna, 'note', 'n1', { text: 'A secret-ish note about my knee.' });
    await world.history.idle();
    const response = await world.request('GET', '/v1/account/export', { token: anna.token });
    const exported = (await response.json()) as {
      historyIndex: unknown;
      notIncluded: string[];
      items: { body: string }[];
    };
    expect(exported.historyIndex).toStrictEqual([
      { model: 'scripted-embedding', dimension: SCRIPTED_DIMENSION, passages: 1 },
    ]);
    expect(exported.notIncluded.some((line) => line.includes('history index'))).toBe(true);
    // The note is in the export once, as the item the rider sent — not again as a passage.
    const text = JSON.stringify(exported);
    expect(text.split('about my knee').length - 1).toBe(1);
  });
});

describe('the pieces', () => {
  it('dates only the rides it is asked about, and reads no record past the last it needs — #918 item 5', () => {
    let read = 0;
    const record = (activityId: string, startedAt: number) => ({
      get signedRecord() {
        read += 1;
        return new TextEncoder().encode(JSON.stringify({ claims: { activityId, startedAt } }));
      },
    });
    const records = [
      record('a', 1),
      record('b', 2),
      { signedRecord: new TextEncoder().encode('not json') },
      record('c', 3),
      ...Array.from({ length: 50 }, (_, index) => record(`other-${String(index)}`, index)),
    ];
    const starts = rideStarts(records, new Set(['c', 'a']));
    expect([...starts]).toStrictEqual([
      ['a', 1],
      ['c', 3],
    ]);
    // `a`, `b` and `c`: the fifty after them are never parsed.
    expect(read).toBe(3);
    // A ride with no record reads them all, and dates nothing.
    read = 0;
    expect(rideStarts(records, new Set(['missing'])).size).toBe(0);
    expect(read).toBe(53);
  });

  it('ages a ride in whole weeks either way, and says nothing it cannot know', () => {
    expect(relativeAge(0, 6 * 24 * 3600)).toBe(' the same week');
    expect(relativeAge(0, WEEK)).toBe(' 1 week earlier');
    expect(relativeAge(0, 20 * WEEK + 5)).toBe(' 20 weeks earlier');
    expect(relativeAge(2 * WEEK + 1, 0)).toBe(' 2 weeks later');
    expect(relativeAge(undefined, 0)).toBe('');
    expect(relativeAge(0, undefined)).toBe('');
  });

  it('labels every kind within 40 characters', () => {
    for (const kind of ['write-up', 'ride-summary', 'goal', 'note', 'document'] as const) {
      expect(labelFor(kind, ' 104 weeks earlier').length).toBeLessThanOrEqual(40);
    }
  });
});
