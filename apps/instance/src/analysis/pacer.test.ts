// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An AI-pacer decision, through the route as the app calls it** (#2712,
 * ADR 0072): sealed, over the real handler and the world's real store, with
 * a `fetch` in place of the local model server that records every request.
 * `tactics.test.ts` holds the gates the two routes share; this file holds
 * that the pacer route goes through them, and what it sends and answers.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import { PACER_PROMPT_VERSION, PACER_SYSTEM, PACER_TEMPERATURE } from './pacer-prompt.ts';
import {
  ATTACK,
  chatServer,
  consentToTactics,
  OFFERED,
  PACER_ANSWER,
  PACER_INPUT,
  TEST_TACTICS_MODEL,
} from './tactics-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

type Options = NonNullable<Parameters<typeof syncWorld>[1]>['tactics'];

async function pacerWorld(riders: number, tactics: Options) {
  const synced = await syncWorld(riders, { tactics });
  world = synced.world;
  return { world: synced.world, riders: synced.riders };
}

const pace = (w: IdentityInstance, token: string, body: unknown = { input: PACER_INPUT }) =>
  w.call('POST', '/v1/analysis/pacer/decide', { token, body });

const codeOf = (answer: { body: unknown }): unknown =>
  (answer.body as { error?: { code?: unknown } } | null)?.error?.code;

describe('an AI-pacer decision, read back as the app reads it (#2712)', () => {
  it('answers the plan, the intent and the screened line', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    const { token } = riders[0]!;
    expect((await consentToTactics(w, token)).status).toBe(200);
    expect(await pace(w, token)).toEqual({
      status: 200,
      body: { plan: 'climber', intent: 'ease', say: 'Nice and steady, stay on my wheel.' },
    });
  });

  it('sends one call with no tools, reasoning off, held to the pacer schema, and the state and nothing else', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    await pace(w, riders[0]!.token);

    expect(server.requests).toHaveLength(1);
    const body = server.requests[0]?.body as Record<string, unknown>;
    expect(server.requests[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(body).not.toHaveProperty('tools');
    expect(body.think).toBe(false);
    expect(body.model).toBe(TEST_TACTICS_MODEL.model);
    expect(body.messages).toEqual([
      { role: 'system', content: PACER_SYSTEM },
      { role: 'user', content: JSON.stringify(PACER_INPUT) },
    ]);
    const format = JSON.stringify(body.format);
    expect(format).toContain('"enum":["rolling","even","climber"]');
    expect(format).not.toMatch(/watt|power|resistance|erg/i);
  });

  it('passes the rider’s own sensors and the model’s last lines to the model, asking for varied coaching — #2760', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    const sensed = {
      ...PACER_INPUT,
      rider3sWPerKg: 3.4,
      riderMinuteWPerKg: 3.1,
      powerZone: 'VO₂',
      powerTrend: 'rising',
      aboveThresholdS: 75,
      cadenceRpm: 58,
      heartRateBpm: 168,
      heartRateZone: 'Threshold',
      heartRateTrend: 'rising',
      recentLines: ['Nice and steady, stay on my wheel.'],
    };
    expect((await pace(w, riders[0]!.token, { input: sensed })).status).toBe(200);

    const body = server.requests[0]?.body as {
      messages: { content: string }[];
      options: { temperature: number };
    };
    expect(JSON.parse(body.messages[1]!.content)).toEqual(sensed);
    expect(body.options.temperature).toBe(PACER_TEMPERATURE);
    expect(PACER_TEMPERATURE).toBeGreaterThan(0);
    for (const field of ['cadenceRpm', 'heartRateTrend', 'aboveThresholdS', 'recentLines']) {
      expect(PACER_SYSTEM).toContain(`"${field}"`);
    }
    expect(PACER_SYSTEM).toMatch(/lighter gear/);
    expect(PACER_SYSTEM).toMatch(/Never repeat/);
    expect(PACER_SYSTEM).toMatch(/never as a health matter/);
  });

  it('answers a line with a cadence or power target, and asks for no other number — ADR 0077', async () => {
    const say = 'Lighter gear, aim for 90 rpm.';
    const server = chatServer(() => JSON.stringify({ plan: 'even', intent: 'hold', say }));
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    expect(await pace(w, riders[0]!.token)).toEqual({
      status: 200,
      body: { plan: 'even', intent: 'hold', say },
    });
    expect(PACER_SYSTEM).toMatch(/"aim for 90 rpm"/);
    expect(PACER_SYSTEM).toMatch(/Never write any other number/);
  });

  it('passes where the rider is to the model, and asks for an intent that follows the gap — #2777', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    const placed = {
      ...PACER_INPUT,
      riderGapM: 40,
      riderInDraft: false,
      riderPlace: 'ahead',
      gapTrend: 'rider-gaining',
    };
    expect((await pace(w, riders[0]!.token, { input: placed })).status).toBe(200);
    const body = server.requests[0]?.body as { messages: { content: string }[] };
    expect(JSON.parse(body.messages[1]!.content)).toEqual(placed);
    for (const field of ['riderPlace', 'gapTrend', 'rider-gaining', 'rider-losing']) {
      expect(PACER_SYSTEM).toContain(`"${field}"`);
    }
    expect(PACER_SYSTEM).toMatch(/not pulling away: "hold" or "lift", never "ease"/);
    expect(PACER_SYSTEM).toMatch(/coming back: "hold" or "ease", never "lift"/);
    // The owner's ride: the model eased while telling a rider ahead of it to ease.
    expect(PACER_SYSTEM).toMatch(/never a reason for you to ease/);
    expect(PACER_SYSTEM).toMatch(/it must match your intent/);
    // The old inertia, which kept an ease in force while the rider rode away, is gone.
    expect(PACER_SYSTEM).not.toMatch(/Change intent only every few decisions/);
  });

  it('is no decision for a line that says the opposite of its intent — #2777', async () => {
    const answers = [
      JSON.stringify({ plan: 'rolling', intent: 'ease', say: 'I will push on this climb now.' }),
      JSON.stringify({ plan: 'rolling', intent: 'hold', say: 'Here I come, stay sharp.' }),
      JSON.stringify({
        plan: 'rolling',
        intent: 'lift',
        say: 'I am easing off so you can bridge.',
      }),
    ];
    let next = 0;
    const server = chatServer(() => answers[next++]);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    for (const answer of answers) {
      const decided = await pace(w, riders[0]!.token);
      expect(decided.status, answer).toBe(502);
      expect(codeOf(decided)).toBe('tactics_invalid');
      expect(JSON.stringify(decided.body)).not.toMatch(/push|come|easing/);
    }
  });

  it('passes the course ahead to the model, and asks it to pace the terrain where the gap leaves a choice — #2794', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    expect((await pace(w, riders[0]!.token)).status).toBe(200);
    const body = server.requests[0]?.body as { messages: { content: string }[] };
    expect((JSON.parse(body.messages[1]!.content) as { course?: unknown }).course).toEqual(
      PACER_INPUT.course,
    );
    expect(PACER_PROMPT_VERSION).toBe('pacer-5');
    for (const field of ['course', 'climb', 'descent', 'inM', 'lengthM', 'avgPct', 'maxPct']) {
      expect(PACER_SYSTEM).toContain(`"${field}"`);
    }
    for (const field of ['climbLeftM', 'lapLeftM']) expect(PACER_SYSTEM).toContain(`"${field}"`);
    expect(PACER_SYSTEM).toMatch(/"ease" in the last 300 m before a climb/);
    expect(PACER_SYSTEM).toMatch(/"lift" on a descent/);
    // The gap rules still come first: the terrain only chooses where they leave a choice.
    expect(PACER_SYSTEM).toMatch(/Where these rules leave a choice, pace the terrain/);
  });

  it('refuses a course ahead that carries anything but its numbers, before a model is called — #2794', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    const placed = await pace(w, riders[0]!.token, {
      input: { ...PACER_INPUT, course: { ...PACER_INPUT.course, name: 'Box Hill' } },
    });
    expect(codeOf(placed)).toBe('validation_failed');
    expect(JSON.stringify(placed.body)).not.toContain('Box Hill');
    expect(server.requests).toEqual([]);
  });

  it('refuses a state whose last lines carry what the screen stops, before a model is called — #2760', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    const placed = await pace(w, riders[0]!.token, {
      input: { ...PACER_INPUT, recentLines: ['Home is at 51.5074 north.'] },
    });
    expect(codeOf(placed)).toBe('validation_failed');
    expect(JSON.stringify(placed.body)).not.toContain('51.5074');
    expect(server.requests).toEqual([]);
  });

  it('is no decision for an answer with a power in it, a bad line or a bot move; no answer is a failure', async () => {
    const answers = [
      JSON.stringify({ plan: 'even', intent: 'lift', say: '', watts: 900 }),
      JSON.stringify({ plan: 'even', intent: 'lift', say: 'Hold 3000 watts now.' }),
      JSON.stringify({ plan: 'even', intent: 'lift', say: 'Your heart rate is 150.' }),
      JSON.stringify({ plan: 'even', intent: 'lift', say: 'Keep your TSS up.' }),
      JSON.stringify({ plan: 'even', intent: 'lift', say: 'Good for your heart condition.' }),
      ATTACK,
      'Ease off a little.',
    ];
    let next = 0;
    const server = chatServer(() => answers[next++]);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    for (const answer of answers) {
      const decided = await pace(w, token);
      expect(decided.status, answer.slice(0, 40)).toBe(502);
      expect(codeOf(decided)).toBe('tactics_invalid');
      // Nothing the model wrote is in the answer.
      expect(JSON.stringify(decided.body)).not.toMatch(/watts|TSS|heart|Ease off/);
    }
    // The next: the server answers 500.
    expect(codeOf(await pace(w, token))).toBe('tactics_failed');
  });

  it('refuses before a model is called: not offered, no consent, a bad state, another rider’s race', async () => {
    const server = chatServer(() => PACER_ANSWER);
    let offered = false;
    const { world: w, riders } = await pacerWorld(2, {
      local: () => Promise.resolve({ offered, model: TEST_TACTICS_MODEL }),
      fetch: server.fetch,
    });
    const [first, second] = riders;
    expect(codeOf(await pace(w, first!.token))).toBe('local_unavailable');
    offered = true;
    expect(codeOf(await pace(w, first!.token))).toBe('tactics_consent_required');
    await consentToTactics(w, first!.token);
    await consentToTactics(w, second!.token);
    const placed = await pace(w, first!.token, { input: { ...PACER_INPUT, place: 'Main St' } });
    expect(codeOf(placed)).toBe('validation_failed');
    expect(JSON.stringify(placed.body)).not.toContain('Main St');
    expect(codeOf(await pace(w, first!.token, { input: PACER_INPUT, athleteId: 'x' }))).toBe(
      'validation_failed',
    );
    expect(server.requests).toEqual([]);

    // The first rider's directed ride holds the one model slot (ADR 0071 D-6.3).
    expect(
      (await w.call('POST', '/v1/analysis/tactics/start', { token: first!.token })).status,
    ).toBe(202);
    expect(codeOf(await pace(w, second!.token))).toBe('tactics_busy');
    await w.call('POST', '/v1/analysis/tactics/end', { token: first!.token });
    await w.tactics.idle();
    expect((await pace(w, second!.token)).status).toBe(200);
  });

  it('refuses a rider whose consent was withdrawn, at the next request', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    expect((await pace(w, token)).status).toBe(200);
    await w.call('DELETE', '/v1/analysis/tactics/consent', { token });
    expect(codeOf(await pace(w, token))).toBe('tactics_consent_required');
    expect(server.requests).toHaveLength(1);
  });
});
