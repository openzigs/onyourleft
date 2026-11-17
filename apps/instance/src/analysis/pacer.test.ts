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
import { PACER_SYSTEM, PACER_TEMPERATURE } from './pacer-prompt.ts';
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
      JSON.stringify({ plan: 'even', intent: 'lift', say: 'Hold 300 watts now.' }),
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
