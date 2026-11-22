// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Model-chosen lap-race bot tactics, through the routes as the app calls
 * them** (#2709, ADR 0071): sealed, as every instance with keys serves them,
 * over the real handler and the world's real store, with a `fetch` in place
 * of the local model server that records every request it was sent.
 *
 * What is read back is what a device reads: the route's answer, and the
 * status a second request reads from the store. What is asserted of the
 * model server is what it was SENT — so "nothing was called" is an empty
 * list, not an assumption.
 */

import {
  BOT_TACTICS,
  MODEL_TACTICS_ASK_EVERY_MS,
  MODEL_TACTICS_CUES,
  MODEL_TACTICS_REASONS,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { isProblem, logEvent, REDACTED } from '../log.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import { effectiveAnalysisSettings } from './settings.ts';
import {
  DEFAULT_TACTICS_DECISIONS,
  tacticsCallFigures,
  tacticsLocalOf,
  type TacticsCallLine,
  type TacticsLocal,
} from './tactics.ts';
import {
  ATTACK,
  CHAT_FIGURES,
  chatServer,
  consentToTactics,
  OFFERED,
  TACTICS_INPUT,
  TEST_TACTICS_MODEL,
} from './tactics-testing.ts';
import {
  TACTICS_PROMPT_VERSION,
  TACTICS_SYSTEM,
  tacticsUserContent,
  WARM_UP_INPUT,
} from './tactics-prompt.ts';
import { testConfig } from '../instance-testing.ts';
import { startOllamaStub, type OllamaStub } from './ollama-stub-testing.ts';

let world: IdentityInstance | undefined;
let stub: OllamaStub | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
  await stub?.close();
  stub = undefined;
});

type Options = NonNullable<Parameters<typeof syncWorld>[1]>['tactics'];

async function tacticsWorld(riders: number, tactics: Options) {
  const synced = await syncWorld(riders, { tactics });
  world = synced.world;
  return synced;
}

const decide = (w: IdentityInstance, token: string, input: unknown = TACTICS_INPUT) =>
  w.call('POST', '/v1/analysis/tactics/decide', { token, body: { input } });

const codeOf = (answer: { body: unknown }): unknown =>
  (answer.body as { error?: { code?: unknown } } | null)?.error?.code;

describe('a bot-tactics decision, read back as the app reads it (#2709; one bot’s since #2836)', () => {
  it('answers the model’s pick for the bot asked about, after a consent the next status reads back', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;

    const before = await w.call('GET', '/v1/analysis/tactics', { token });
    expect(before).toEqual({
      status: 200,
      body: {
        offered: true,
        instance: 'https://ride.example',
        modelAddress: TEST_TACTICS_MODEL.baseUrl.href,
        consent: null,
        consented: false,
      },
    });
    expect((await consentToTactics(w, token)).status).toBe(200);
    const after = await w.call('GET', '/v1/analysis/tactics', { token });
    expect(after.body).toMatchObject({
      consented: true,
      consent: { modelAddress: TEST_TACTICS_MODEL.baseUrl.href },
    });

    const decided = await decide(w, token);
    expect(decided).toEqual({
      status: 200,
      body: { reason: 'my-terrain', move: 'attack', effort: 'all-out' },
    });
  });

  it('sends Ollama’s own call: no tools, reasoning off, held to the menu’s schema, the ask and nothing else', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    await consentToTactics(w, riders[0]!.token);
    await decide(w, riders[0]!.token);

    expect(server.requests).toHaveLength(1);
    const [sent] = server.requests;
    expect(sent?.url).toBe('http://127.0.0.1:11434/api/chat');
    const body = sent?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['format', 'keep_alive', 'messages', 'model', 'options', 'stream', 'think'].sort(),
    );
    expect(body).not.toHaveProperty('tools');
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.model).toBe(TEST_TACTICS_MODEL.model);
    // #2836: one bot's pick is a reason, a move and an effort; capped at twice what that needs.
    expect(body.options).toEqual({ temperature: 0.6, num_predict: 48 });
    expect(body.messages).toEqual([
      { role: 'system', content: TACTICS_SYSTEM },
      { role: 'user', content: tacticsUserContent(TACTICS_INPUT) },
    ]);
    const format = JSON.stringify(body.format);
    expect(format).not.toMatch(/watt|power|target|integer|number/i);
  });

  it('holds the model to the menu the ask offered, the reason first, and no effort on sitting in (#2836, ADR 0081 D-3, D-4)', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    await consentToTactics(w, riders[0]!.token);
    expect((await decide(w, riders[0]!.token)).status).toBe(200);
    const body = server.requests[0]?.body as {
      format: { anyOf: { properties: Record<string, { enum: string[] }>; required: string[] }[] };
    };
    const [ridden, effortless] = body.format.anyOf;
    expect(Object.keys(ridden?.properties ?? {})).toEqual(['reason', 'move', 'effort']);
    expect(ridden?.properties.move?.enum).toEqual(['follow', 'attack']);
    expect(Object.keys(effortless?.properties ?? {})).toEqual(['reason', 'move']);
    expect(effortless?.properties.move?.enum).toEqual(['sit-in']);
    expect(ridden?.required).toEqual(['reason', 'move']);
    expect(ridden?.properties.reason?.enum).toEqual([
      'my-terrain',
      'cover-move',
      'counter',
      'save-legs',
      'finish-near',
    ]);
  });

  it('is no decision for an answer with a power in it, not JSON, past the cap, off the menu or with no reason; and no answer is a failure', async () => {
    const answers = [
      JSON.stringify({ reason: 'my-terrain', move: 'attack', watts: 900 }),
      'Bot 2 should attack now.',
      ATTACK.padEnd(9_000, ' '),
      // One of the seven moves, but not one this ask offered.
      JSON.stringify({ reason: 'finish-near', move: 'kick' }),
      JSON.stringify({ move: 'attack' }),
      JSON.stringify({ reason: 'it felt right', move: 'attack' }),
      // The answer for a whole field, as it was before #2836.
      JSON.stringify({ bots: [{ bot: 2, move: 'attack' }] }),
    ];
    let next = 0;
    const server = chatServer(() => answers[next++]);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    for (const answer of answers) {
      const decided = await decide(w, token);
      expect(decided.status, answer.slice(0, 40)).toBe(502);
      expect(codeOf(decided)).toBe('tactics_invalid');
      // The model's text is not in the answer.
      expect(JSON.stringify(decided.body)).not.toContain('Bot 2 should');
      expect(JSON.stringify(decided.body)).not.toContain('it felt right');
    }
    // The last: the server answers 500.
    expect(codeOf(await decide(w, token))).toBe('tactics_failed');
  });

  it('gives up on a model that has not answered in time, and closes its request', async () => {
    let aborted = false;
    const { riders } = await tacticsWorld(1, {
      local: OFFERED,
      answerWaitMs: 50,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    const w = world as IdentityInstance;
    await consentToTactics(w, riders[0]!.token);
    expect(codeOf(await decide(w, riders[0]!.token))).toBe('tactics_failed');
    expect(aborted).toBe(true);
  });
});

describe('what the model reads: `tactics-8` (#2836, ADR 0081 D-4)', () => {
  it('writes the shared race first, the story so far as a line, and the bot last with its cues and menu', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    await consentToTactics(w, riders[0]!.token);
    expect((await decide(w, riders[0]!.token)).status).toBe(200);
    const body = server.requests[0]?.body as { messages: { content: string }[] };
    const lines = (body.messages[1]?.content ?? '').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Race: \{"laps":3,"course":\{/);
    expect(lines[1]).toBe(
      'Story so far: 130 s raced; 3 laps left; a break of 2 away for 40 s, 60 m clear; a move is on now; the bots are tiring.',
    );
    expect(lines[2]).toMatch(/^You: \{"bot":2,"style":"climber"/);
    const race = JSON.parse((lines[0] ?? '').slice('Race: '.length)) as Record<string, unknown>;
    expect(Object.keys(race)).toEqual(['laps', 'course', 'rider', 'field']);
    expect(race.course).toEqual(TACTICS_INPUT.course);
    expect(race.field).toEqual(TACTICS_INPUT.field);
    const you = JSON.parse((lines[2] ?? '').slice('You: '.length)) as Record<string, unknown>;
    expect(you).toEqual(TACTICS_INPUT.you);
    // The seconds since its last move are read before its current move, and the menu last.
    const keys = Object.keys(you);
    expect(keys.indexOf('sinceMoveS')).toBeLessThan(keys.indexOf('move'));
    expect(keys.slice(-2)).toEqual(['cues', 'menu']);
  });

  it('writes what the model reads in its own key order, whatever order a device sent', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    await consentToTactics(w, riders[0]!.token);
    const backwards = (value: object): Record<string, unknown> =>
      Object.fromEntries(Object.entries(value).reverse());
    const shuffled = {
      ...backwards(TACTICS_INPUT),
      you: backwards(TACTICS_INPUT.you),
      rider: backwards(TACTICS_INPUT.rider),
    };
    expect((await decide(w, riders[0]!.token, shuffled)).status).toBe(200);
    const body = server.requests[0]?.body as { messages: { content: string }[] };
    expect(body.messages[1]?.content).toBe(tacticsUserContent(TACTICS_INPUT));
  });

  it('states the goal, drops the sentence about sitting in, and gives worked examples of different bots', () => {
    expect(TACTICS_PROMPT_VERSION).toBe('tactics-8');
    expect(TACTICS_SYSTEM).toContain('a lively, believable race for the human');
    expect(TACTICS_SYSTEM).toContain('A race where nothing happens is a failure.');
    expect(TACTICS_SYSTEM).not.toMatch(/most bots sit in/i);
    // Each example is a pick the reader takes, for a different style and a different move.
    const examples = [...TACTICS_SYSTEM.matchAll(/^- An? (\w+),.*?(\{"reason".*\})$/gm)];
    expect(examples.map((each) => each[1])).toEqual([
      'climber',
      'sprinter',
      'opportunist',
      'rouleur',
    ]);
    const picks = examples.map(
      (each) => JSON.parse(each[2] ?? '') as { reason: string; move: string },
    );
    expect(new Set(picks.map((pick) => pick.reason)).size).toBe(4);
    expect(new Set(picks.map((pick) => pick.move)).size).toBeGreaterThanOrEqual(3);
  });

  it('says what every cue, move, reason and field it is guidance about means, and names no power', () => {
    for (const word of [...MODEL_TACTICS_CUES, ...BOT_TACTICS, ...MODEL_TACTICS_REASONS]) {
      expect(TACTICS_SYSTEM, word).toContain(`"${word}"`);
    }
    for (const field of [
      'sinceMoveS',
      'secondsInMove',
      'wbal',
      'style',
      'menu',
      'cues',
      'target',
    ]) {
      expect(TACTICS_SYSTEM, field).toContain(`"${field}"`);
    }
    for (const field of ['course', 'climb', 'descent', 'finishPct', 'field', 'rider', 'rank']) {
      expect(TACTICS_SYSTEM, field).toContain(`"${field}"`);
    }
    expect(TACTICS_SYSTEM).not.toMatch(/\bwatts?\b|\bpower\b/i);
    expect(TACTICS_SYSTEM).not.toContain('attackOpen');
  });

  it('refuses a course ahead that carries anything but its numbers, before the model sees it (#2794)', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    const named = { ...TACTICS_INPUT.course, name: 'Box Hill' };
    const refused = await decide(w, token, { ...TACTICS_INPUT, course: named });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toContain('Box Hill');
    expect(server.requests).toEqual([]);
  });

  it('refuses the race state a device sent before #2836, and a story that carries text, before the model sees either', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    const before = { laps: 3, quietS: 40, rider: TACTICS_INPUT.rider, bots: [] };
    expect(codeOf(await decide(w, token, before))).toBe('validation_failed');
    const told = {
      ...TACTICS_INPUT,
      story: { ...TACTICS_INPUT.story, bunch: 'tiring near Richmond Park' },
    };
    const refused = await decide(w, token, told);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toContain('Richmond');
    expect(server.requests).toEqual([]);
  });

  it('reads the answer against the menu of the ask it was sent with, not every move there is', async () => {
    // ATTACK picks an attack: on TACTICS_INPUT's menu, and not on one that offers a follow alone.
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    await consentToTactics(w, riders[0]!.token);
    const narrow = {
      ...TACTICS_INPUT,
      you: { ...TACTICS_INPUT.you, menu: [{ move: 'follow', target: 1 }, { move: 'sit-in' }] },
    };
    expect(codeOf(await decide(w, riders[0]!.token, narrow))).toBe('tactics_invalid');
    expect((await decide(w, riders[0]!.token)).status).toBe(200);
  });
});

describe('one line a call, in numbers and closed words (#2836, ADR 0081 D-5.2)', () => {
  it('logs the prompt, the model, how it ended, and the model server’s own figures', async () => {
    const lines: TacticsCallLine[] = [];
    const answers: (string | undefined)[] = [
      ATTACK,
      'Bot 2 should attack near Box Hill.',
      undefined,
    ];
    let next = 0;
    const server = chatServer(() => answers[next++]);
    const { riders } = await tacticsWorld(1, {
      local: OFFERED,
      fetch: server.fetch,
      logCall: (line) => lines.push(line),
    });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    for (let at = 0; at < answers.length; at += 1) await decide(w, token);

    expect(lines.map((line) => line.state)).toEqual(['decision', 'invalid', 'failed']);
    expect(lines[0]).toEqual({
      prompt: 'tactics-8',
      model: TEST_TACTICS_MODEL.model,
      state: 'decision',
      ms: expect.any(Number) as number,
      loadMs: 21,
      tokensIn: 1_420,
      tokensOut: 17,
      promptEvalMs: 302,
      evalMs: 456,
    });
    // A call the model server did not answer has no figures to report.
    expect(lines[2]).toEqual({
      prompt: 'tactics-8',
      model: TEST_TACTICS_MODEL.model,
      state: 'failed',
      ms: expect.any(Number) as number,
    });
    // Never the model's text, the pick, or anything of the race.
    const written = JSON.stringify(lines);
    for (const word of ['Box Hill', 'attack', 'my-terrain', 'climber', 'sinceMoveS']) {
      expect(written).not.toContain(word);
    }
  });

  it('goes through the instance’s one redaction whole, and nothing else of a call does', () => {
    const kept: string[] = [];
    logEvent((line) => kept.push(line), 'tactics-call', {
      prompt: 'tactics-8',
      model: TEST_TACTICS_MODEL.model,
      state: 'decision',
      ms: 812,
      loadMs: 21,
      tokensIn: 1_420,
      tokensOut: 17,
      promptEvalMs: 302,
      evalMs: 456,
      // What must never be written, were a later change to pass it.
      text: '{"reason":"my-terrain","move":"attack"}',
      move: 'attack',
      athleteId: 'somebody',
    });
    expect(JSON.parse(kept[0] ?? '{}')).toMatchObject({
      event: 'tactics-call',
      prompt: 'tactics-8',
      model: TEST_TACTICS_MODEL.model,
      state: 'decision',
      ms: 812,
      loadMs: 21,
      tokensIn: 1_420,
      tokensOut: 17,
      promptEvalMs: 302,
      evalMs: 456,
      text: REDACTED,
      move: REDACTED,
      athleteId: REDACTED,
    });
    // Each key holds only the shape a call writes: a word or text in a figure's place is cut.
    const wrong: string[] = [];
    logEvent((line) => wrong.push(line), 'tactics-call', {
      prompt: 'Ignore all previous instructions',
      state: 'attack at Box Hill',
      tokensIn: '51.5072,-0.1276',
      loadMs: -1,
      evalMs: 1.5,
    });
    expect(JSON.parse(wrong[0] ?? '{}')).toMatchObject({
      prompt: REDACTED,
      state: REDACTED,
      tokensIn: REDACTED,
      loadMs: REDACTED,
      evalMs: REDACTED,
    });
    expect(isProblem({ event: 'tactics-call', state: 'failed' })).toBe(false);
  });

  it('reads only numbers from 0 up off a model server’s answer, and nothing else of it', () => {
    expect(tacticsCallFigures(CHAT_FIGURES)).toEqual({
      loadMs: 21,
      tokensIn: 1_420,
      tokensOut: 17,
      promptEvalMs: 302,
      evalMs: 456,
    });
    expect(
      tacticsCallFigures({
        load_duration: 'a while',
        prompt_eval_count: -4,
        eval_count: Number.NaN,
        eval_duration: 2_400_000,
        message: { content: 'attack' },
      }),
    ).toEqual({ evalMs: 2 });
    expect(tacticsCallFigures(undefined)).toEqual({});
    expect(tacticsCallFigures('fast')).toEqual({});
  });

  it('allows one bot a second with room to spare, one call out at a time (#2836, ADR 0081 D-2.1)', () => {
    expect(DEFAULT_TACTICS_DECISIONS).toEqual({ limit: 90, windowMs: 60_000 });
    expect(DEFAULT_TACTICS_DECISIONS.limit).toBeGreaterThanOrEqual(
      60_000 / MODEL_TACTICS_ASK_EVERY_MS,
    );
  });
});
describe('over HTTP, to a stub Ollama on loopback (#2709)', () => {
  it('reaches /api/chat at the address the name resolves to, and refuses a name that resolves outside the local ranges', async () => {
    stub = await startOllamaStub({
      chat: () => ({ message: { role: 'assistant', content: ATTACK }, done: true }),
    });
    const resolved: { to: readonly string[] } = { to: ['127.0.0.1'] };
    const model = { baseUrl: new URL(`http://ollama.test:${String(stub.port)}/v1`), model: 'm' };
    const { riders } = await tacticsWorld(1, {
      local: () => Promise.resolve({ offered: true, model }),
      resolve: () => Promise.resolve(resolved.to),
      // The platform's own fetch: a real request to the stub.
      fetch: globalThis.fetch.bind(globalThis),
    });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    expect(await decide(w, token)).toMatchObject({
      status: 200,
      body: { reason: 'my-terrain', move: 'attack' },
    });
    expect(stub.requests.map((each) => `${each.method} ${each.path}`)).toEqual(['POST /api/chat']);
    expect((stub.requests[0]?.body as { think?: unknown }).think).toBe(false);

    // The same name, resolving public now: refused at THIS request, and nothing is sent.
    resolved.to = ['203.0.113.7'];
    expect(codeOf(await decide(w, token))).toBe('tactics_failed');
    expect(stub.requests).toHaveLength(1);
  });
});

describe('what is refused before a model is called (#2709, ADR 0071 D-5)', () => {
  it('refuses a rider the local model is not offered to, for a decision, a start and a consent', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, {
      local: () => Promise.resolve({ offered: false, model: TEST_TACTICS_MODEL }),
      fetch: server.fetch,
    });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    const status = await w.call('GET', '/v1/analysis/tactics', { token });
    expect(status.body).toMatchObject({ offered: false, modelAddress: null, consented: false });
    expect(
      codeOf(
        await w.call('POST', '/v1/analysis/tactics/consent', {
          token,
          body: { instance: 'https://ride.example', modelAddress: TEST_TACTICS_MODEL.baseUrl.href },
        }),
      ),
    ).toBe('local_unavailable');
    expect(codeOf(await decide(w, token))).toBe('local_unavailable');
    expect(codeOf(await w.call('POST', '/v1/analysis/tactics/start', { token }))).toBe(
      'local_unavailable',
    );
    expect(server.requests).toEqual([]);
  });

  it('refuses a rider with no consent, and one whose consent names an address the model has left', async () => {
    const server = chatServer(() => ATTACK);
    let model: TacticsLocal['model'] = TEST_TACTICS_MODEL;
    const { riders } = await tacticsWorld(1, {
      local: () => Promise.resolve({ offered: true, model }),
      fetch: server.fetch,
    });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    expect(codeOf(await decide(w, token))).toBe('tactics_consent_required');
    expect(codeOf(await w.call('POST', '/v1/analysis/tactics/start', { token }))).toBe(
      'tactics_consent_required',
    );
    await consentToTactics(w, token);
    // The operator moves the local model (D-5.3): the consent names the old address.
    model = { baseUrl: new URL('http://127.0.0.2:11434/v1'), model: TEST_TACTICS_MODEL.model };
    expect(codeOf(await decide(w, token))).toBe('tactics_consent_required');
    const status = await w.call('GET', '/v1/analysis/tactics', { token });
    expect(status.body).toMatchObject({
      consented: false,
      modelAddress: 'http://127.0.0.2:11434/v1',
      consent: { modelAddress: TEST_TACTICS_MODEL.baseUrl.href },
    });
    expect(server.requests).toEqual([]);
    // Agreeing to the new address lets the race ask again.
    await consentToTactics(w, token);
    expect((await decide(w, token)).status).toBe(200);
    expect(server.requests[0]?.url).toBe('http://127.0.0.2:11434/api/chat');
  });

  it('records a consent only naming this instance and the address it names now', async () => {
    const { riders } = await tacticsWorld(1, { local: OFFERED });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    const refused = await w.call('POST', '/v1/analysis/tactics/consent', {
      token,
      body: { instance: 'https://elsewhere.example', modelAddress: 'http://10.0.0.9:11434/v1' },
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { fields: unknown } }).error.fields).toEqual([
      { field: 'instance', problem: 'must be this instance' },
      { field: 'modelAddress', problem: 'must be the local model address this instance names now' },
    ]);
    const unnamed = await w.call('POST', '/v1/analysis/tactics/consent', {
      token,
      body: { instance: 'not an address', modelAddress: TEST_TACTICS_MODEL.baseUrl.href, also: 1 },
    });
    expect((unnamed.body as { error: { fields: unknown } }).error.fields).toEqual([
      { field: 'also', problem: 'is not a field of this request' },
      { field: 'instance', problem: 'must be this instance' },
    ]);
    expect((await w.call('GET', '/v1/analysis/tactics', { token })).body).toMatchObject({
      consent: null,
    });
  });

  it('refuses a withdrawn consent at the next request, and ends that rider’s hold', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(2, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const [first, second] = riders;
    await consentToTactics(w, first!.token);
    await consentToTactics(w, second!.token);
    expect((await decide(w, first!.token)).status).toBe(200);
    expect(codeOf(await decide(w, second!.token))).toBe('tactics_busy');
    const withdrawn = await w.call('DELETE', '/v1/analysis/tactics/consent', {
      token: first!.token,
    });
    expect(withdrawn.body).toMatchObject({ consent: null, consented: false });
    expect(codeOf(await decide(w, first!.token))).toBe('tactics_consent_required');
    // The slot is free: the other rider's race holds it now.
    expect((await decide(w, second!.token)).status).toBe(200);
    expect(server.requests).toHaveLength(2);
  });

  it('refuses a race state with a field it does not name, before the model sees it', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    const refused = await decide(w, token, { ...TACTICS_INPUT, lat: 51.50735 });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toContain('51.50735');
    const extra = await w.call('POST', '/v1/analysis/tactics/decide', {
      token,
      body: { input: TACTICS_INPUT, athleteId: 'somebody-else' },
    });
    expect(extra.status).toBe(400);
    expect(server.requests).toEqual([]);
  });

  it('is one model race per instance: a second rider is busy, and never reaches the model', async () => {
    const server = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(2, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const [first, second] = riders;
    await consentToTactics(w, first!.token);
    await consentToTactics(w, second!.token);
    expect(
      (await w.call('POST', '/v1/analysis/tactics/start', { token: first!.token })).status,
    ).toBe(202);
    await w.tactics.idle();
    const sent = server.requests.length;
    expect(
      codeOf(await w.call('POST', '/v1/analysis/tactics/start', { token: second!.token })),
    ).toBe('tactics_busy');
    expect(codeOf(await decide(w, second!.token))).toBe('tactics_busy');
    expect(server.requests).toHaveLength(sent);
    // The first race ends: the second may take the slot.
    expect((await w.call('POST', '/v1/analysis/tactics/end', { token: first!.token })).status).toBe(
      204,
    );
    expect((await decide(w, second!.token)).status).toBe(200);
  });

  it('asks one decision at a time per rider', async () => {
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const answering = chatServer(() => ATTACK);
    const { riders } = await tacticsWorld(1, {
      local: OFFERED,
      fetch: async (input, init) => {
        entered();
        await waiting;
        return answering.fetch(input, init);
      },
    });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    const first = decide(w, token);
    await reached;
    expect(codeOf(await decide(w, token))).toBe('rate_limited');
    release();
    expect((await first).status).toBe(200);
    expect((await decide(w, token)).status).toBe(200);
  });
});

describe('the warm-up (#2709, ADR 0071 D-6.5)', () => {
  it('loads the model with a call of the same shape about a fixed race, nothing of the rider’s in it', async () => {
    const server = chatServer(() => '');
    const { riders } = await tacticsWorld(1, { local: OFFERED, fetch: server.fetch });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    const started = await w.call('POST', '/v1/analysis/tactics/start', { token });
    expect(started).toEqual({ status: 202, body: { warming: true } });
    await w.tactics.idle();
    expect(server.requests).toHaveLength(1);
    const body = server.requests[0]?.body as {
      think: unknown;
      messages: { content: string }[];
      options: { num_predict: unknown };
      tools?: unknown;
    };
    expect(body.think).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(body.options.num_predict).toBe(1);
    expect(body.messages[1]?.content).toBe(tacticsUserContent(WARM_UP_INPUT));
    // Of every decision's shape, the course ahead included (#2794).
    expect(Object.keys(WARM_UP_INPUT)).toEqual(Object.keys(TACTICS_INPUT));
    // A second start of the same race warms nothing new while none is out, and refreshes the hold.
    expect((await w.call('POST', '/v1/analysis/tactics/start', { token })).status).toBe(202);
  });

  it('gives up on a model that never answers the warm-up, so a hung server does not keep it out', async () => {
    let aborted = false;
    const { riders } = await tacticsWorld(1, {
      local: OFFERED,
      warmUpWaitMs: 50,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    const w = world as IdentityInstance;
    await consentToTactics(w, riders[0]!.token);
    expect(
      (await w.call('POST', '/v1/analysis/tactics/start', { token: riders[0]!.token })).status,
    ).toBe(202);
    await w.tactics.idle();
    expect(aborted).toBe(true);
  });

  it('counts a start against the rider’s decisions, so a client in a loop cannot keep the model busy', async () => {
    const server = chatServer(() => '');
    const { riders } = await tacticsWorld(1, {
      local: OFFERED,
      fetch: server.fetch,
      decisions: { limit: 2, windowMs: 60_000 },
    });
    const w = world as IdentityInstance;
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    expect((await w.call('POST', '/v1/analysis/tactics/start', { token })).status).toBe(202);
    await w.tactics.idle();
    expect((await decide(w, token)).status).toBe(502);
    expect(codeOf(await w.call('POST', '/v1/analysis/tactics/start', { token }))).toBe(
      'rate_limited',
    );
    expect(server.requests).toHaveLength(2);
  });
});

describe('the consent is the rider’s own (#2709)', () => {
  it('is in the account export, never another rider’s, and goes with the account', async () => {
    const { riders } = await tacticsWorld(2, { local: OFFERED });
    const w = world as IdentityInstance;
    const [first, second] = riders;
    await consentToTactics(w, first!.token);
    expect(
      (await w.call('GET', '/v1/analysis/tactics', { token: second!.token })).body,
    ).toMatchObject({ consent: null });
    const exported = await w.call('GET', '/v1/account/export', { token: first!.token });
    expect((exported.body as { tacticsConsent: unknown }).tacticsConsent).toEqual({
      modelAddress: TEST_TACTICS_MODEL.baseUrl.href,
      recordedAt: Math.floor(w.clock.ms / 1000),
    });
    const other = await w.call('GET', '/v1/account/export', { token: second!.token });
    expect((other.body as { tacticsConsent: unknown }).tacticsConsent).toBeNull();
    const erased = await w.call('DELETE', '/v1/account', {
      token: first!.token,
      body: { recoveryCode: first!.recoveryCodes[0] },
    });
    expect(erased.status).toBeLessThan(300);
    expect(await w.freshRead((store) => store.getTacticsConsent(first!.athleteId))).toBeUndefined();
  });

  it('is reached sealed only', async () => {
    const { riders } = await tacticsWorld(1, { local: OFFERED });
    const w = world as IdentityInstance;
    const plain = await w.call('GET', '/v1/analysis/tactics', {
      token: riders[0]!.token,
      plain: true,
    });
    expect(codeOf(plain)).toBe('sealed_required');
  });
});

describe('who the local model is offered to (#2709, ADR 0071 D-5.5)', () => {
  const settings = (row: Partial<Record<'offerLocal' | 'othersLocal', boolean>>) =>
    effectiveAnalysisSettings(
      {
        localUrl: 'http://127.0.0.1:11434/v1',
        localModel: 'a-local-model',
        reasoningTokens: null,
        offerLocal: row.offerLocal ?? null,
        offerHosted: null,
        othersLocal: row.othersLocal ?? null,
        updatedAt: 1,
        updatedBy: 'app',
      },
      testConfig(),
    );

  it('offers it to the operator, and to other riders only with the switch on', () => {
    expect(tacticsLocalOf(settings({}), true).offered).toBe(true);
    expect(tacticsLocalOf(settings({}), false).offered).toBe(false);
    expect(tacticsLocalOf(settings({ othersLocal: true }), false)).toEqual({
      offered: true,
      model: { baseUrl: new URL('http://127.0.0.1:11434/v1'), model: 'a-local-model' },
    });
  });

  it('offers it to nobody with the local source off, and names no model with none configured', () => {
    expect(tacticsLocalOf(settings({ offerLocal: false, othersLocal: true }), true).offered).toBe(
      false,
    );
    const none = effectiveAnalysisSettings(undefined, testConfig());
    expect(tacticsLocalOf(none, true).model).toBeUndefined();
  });
});
