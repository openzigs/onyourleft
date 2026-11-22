// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A line from the AI pacer, through the route as the app calls it** (#2712,
 * ADR 0072; #2835, ADR 0083): sealed, over the real handler and the world's
 * real store, with a `fetch` in place of the local model server that records
 * every request. `tactics.test.ts` holds the gates the routes share; this
 * file holds that the pacer routes go through them, and what they send and
 * answer.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  pacerSayAgainstRidden,
  pacerSayProblem,
  PACER_REASONS,
  type ModelPacerInput,
} from '@onyourleft/domain';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import {
  PACER_EXAMPLES,
  PACER_PROMPT_VERSION,
  PACER_SYSTEM,
  PACER_TEMPERATURE,
  PACER_WARM_UP_INPUT,
  pacerRequest,
  pacerStory,
} from './pacer-prompt.ts';
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

const warm = (w: IdentityInstance, token: string) =>
  w.call('POST', '/v1/analysis/pacer/warm', { token });

const codeOf = (answer: { body: unknown }): unknown =>
  (answer.body as { error?: { code?: unknown } } | null)?.error?.code;

/** The user message of a recorded request: its story line, and its state. */
function toldOf(request: { body: unknown } | undefined): { story: string; state: unknown } {
  const messages = (request?.body as { messages: { content: string }[] }).messages;
  const [story = '', state = ''] = messages[1]!.content.split('\n');
  return { story, state: JSON.parse(state) as unknown };
}

/** `input` as the model is shown it: less the plan, which the device no longer varies. */
function shown(input: ModelPacerInput): unknown {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'plan'));
}

describe('a line from the AI pacer, read back as the app reads it (#2712, #2835)', () => {
  it('answers the screened line and nothing else: no plan, no intent', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    const { token } = riders[0]!;
    expect((await consentToTactics(w, token)).status).toBe(200);
    expect(await pace(w, token)).toEqual({
      status: 200,
      body: { say: 'Nice and steady, stay on my wheel.' },
    });
  });

  it('sends one call with no tools, reasoning off, held to a schema of one line, and the story and the state and nothing else', async () => {
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
      {
        role: 'user',
        content: `${pacerStory(PACER_INPUT)}\n${JSON.stringify(shown(PACER_INPUT))}`,
      },
    ]);
    // The model is asked for a line, and for nothing that could direct the pacer.
    expect(body.format).toEqual({
      type: 'object',
      properties: { say: { type: 'string', maxLength: 80 } },
      required: ['say'],
      additionalProperties: false,
    });
    expect(JSON.stringify(body.format)).not.toMatch(/plan|intent|watt|power|resistance|erg/i);
  });

  it('passes the rider’s own sensors, their drift and the model’s last lines to the model, asking for varied coaching — #2760, #2835', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    const sensed: ModelPacerInput = {
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
      // #2835: the trends, as numbers.
      gapDriftM: 6.5,
      powerDriftPct: -9,
      cadenceDriftRpm: -6,
      heartRateDriftBpm: 4,
    };
    expect((await pace(w, riders[0]!.token, { input: sensed })).status).toBe(200);

    const body = server.requests[0]?.body as { options: { temperature: number } };
    expect(toldOf(server.requests[0]).state).toEqual(shown(sensed));
    expect(body.options.temperature).toBe(PACER_TEMPERATURE);
    expect(PACER_TEMPERATURE).toBeGreaterThan(0);
    for (const field of [
      'cadenceRpm',
      'heartRateTrend',
      'aboveThresholdS',
      'recentLines',
      'gapDriftM',
      'powerDriftPct',
      'cadenceDriftRpm',
      'heartRateDriftBpm',
    ]) {
      expect(PACER_SYSTEM).toContain(`"${field}"`);
    }
    expect(PACER_SYSTEM).toMatch(/lighter gear/);
    expect(PACER_SYSTEM).toMatch(/Never repeat/);
    expect(PACER_SYSTEM).toMatch(/do not reuse their wording/);
    expect(PACER_SYSTEM).toMatch(/never as a health matter/);
  });

  it('answers a line with a cadence or power target, and asks for no other number — ADR 0077', async () => {
    const say = 'Lighter gear, aim for 90 rpm.';
    const server = chatServer(() => JSON.stringify({ say }));
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    expect(await pace(w, riders[0]!.token)).toEqual({ status: 200, body: { say } });
    expect(PACER_SYSTEM).toMatch(/"aim for 90 rpm"/);
    expect(PACER_SYSTEM).toMatch(/Never write any other number/);
    // Measured on the owner's PC: easing lines quoted the gap in metres, which the screen voids.
    expect(PACER_SYSTEM).toMatch(
      /distance \(not the gap, not the road ahead, nothing from the story\)/,
    );
  });

  it('tells the model what the pacer is doing and why, and asks it for the line only — #2835', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    const waiting: ModelPacerInput = {
      ...PACER_INPUT,
      riderGapM: -68,
      riderInDraft: false,
      riderPlace: 'behind',
      gapTrend: 'rider-gaining',
      intent: 'ease',
      byPct: 12,
      reason: 'rider-behind',
      gapS: -6.8,
      placeForS: 90,
      gapDriftM: 14,
    };
    expect((await pace(w, riders[0]!.token, { input: waiting })).status).toBe(200);
    const told = toldOf(server.requests[0]);
    expect(told.state).toEqual(shown(waiting));
    expect(told.story).toBe(
      'Story so far: the player is behind you by 6.8 s, and has been behind for 90 s; they are closing; you are easing by 12 % so they can get back on; a climb starts in 100 m.',
    );

    expect(PACER_PROMPT_VERSION).toBe('pacer-6');
    // The goal, stated.
    expect(PACER_SYSTEM).toMatch(/Your goal is to be a kind training partner/);
    // Every reason the device may give is explained, and so is the start.
    for (const reason of PACER_REASONS) expect(PACER_SYSTEM).toContain(`- "${reason}": `);
    for (const field of ['intent', 'byPct', 'reason', 'starting', 'gapS', 'placeForS']) {
      expect(PACER_SYSTEM).toContain(`"${field}"`);
    }
    for (const field of ['riderPlace', 'gapTrend', 'rider-gaining', 'rider-losing']) {
      expect(PACER_SYSTEM).toContain(`"${field}"`);
    }
    for (const field of ['course', 'climb', 'descent', 'inM', 'lengthM', 'avgPct', 'maxPct']) {
      expect(PACER_SYSTEM).toContain(`"${field}"`);
    }
    for (const field of ['climbLeftM', 'lapLeftM']) expect(PACER_SYSTEM).toContain(`"${field}"`);
    // A line that says why: the owner's "saying it is slowing down".
    expect(PACER_SYSTEM).toMatch(/"Easing so you can get back on"/);
    expect(PACER_SYSTEM).toMatch(/never a bare "slowing down"/);
    // The model picks nothing: `pacer-5`'s rule table and its plans are gone.
    expect(PACER_SYSTEM).toMatch(/You do not choose how you ride/);
    expect(PACER_SYSTEM).not.toMatch(/Pick the intent by these rules/);
    expect(PACER_SYSTEM).not.toMatch(/"rolling"|"even"|"climber"|your plan/);
    expect(JSON.stringify(told.state)).not.toContain('"plan"');
  });

  it('shows the model worked examples whose lines the device would show', () => {
    expect(PACER_EXAMPLES.length).toBeGreaterThanOrEqual(2);
    expect(PACER_EXAMPLES.length).toBeLessThanOrEqual(3);
    for (const example of PACER_EXAMPLES) {
      expect(PACER_SYSTEM).toContain(`- ${example.moment}: "${example.line}"`);
      expect(pacerSayProblem(example.line), example.line).toBeUndefined();
      expect(pacerSayAgainstRidden(example.line, example.intent), example.line).toBe(false);
    }
  });

  it('returns a line that says the opposite of the intent: it voids nothing here, and the device hides it — #2835', async () => {
    // Until #2835 such a line made the whole answer `tactics_invalid` (`say-against-intent`),
    // and the pacer kept an old decision. Now there is no decision in the answer to void.
    const say = 'I will push on this climb now.';
    const server = chatServer(() => JSON.stringify({ say }));
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    expect(await pace(w, riders[0]!.token)).toEqual({ status: 200, body: { say } });
    expect(pacerSayAgainstRidden(say, PACER_INPUT.intent)).toBe(true);
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

  it('refuses a state from a device from before #2835, and a reason outside the list, before a model is called', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    await consentToTactics(w, riders[0]!.token);
    const before = Object.fromEntries(
      Object.entries(PACER_INPUT).filter(([key]) => !['reason', 'byPct', 'starting'].includes(key)),
    );
    expect(codeOf(await pace(w, riders[0]!.token, { input: before }))).toBe('validation_failed');
    const made = await pace(w, riders[0]!.token, {
      input: { ...PACER_INPUT, reason: 'heading home to Main St' },
    });
    expect(codeOf(made)).toBe('validation_failed');
    expect(JSON.stringify(made.body)).not.toContain('Main St');
    expect(server.requests).toEqual([]);
  });

  it('is no line for an answer with a power, a plan or an intent in it, a bad line or a bot move; no answer is a failure', async () => {
    const answers = [
      JSON.stringify({ say: '', watts: 900 }),
      // #2835: an answer that tries to direct the pacer is no answer.
      JSON.stringify({ say: 'Stay with me.', intent: 'lift' }),
      JSON.stringify({ plan: 'even', intent: 'lift', say: 'Stay with me.' }),
      JSON.stringify({ say: 'Hold 3000 watts now.' }),
      JSON.stringify({ say: 'Your heart rate is 150.' }),
      JSON.stringify({ say: 'Keep your TSS up.' }),
      JSON.stringify({ say: 'Good for your heart condition.' }),
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
      expect(JSON.stringify(decided.body)).not.toMatch(/watts|TSS|heart|Ease off|lift|Stay with/);
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

describe('the story so far — #2835', () => {
  const told = (fields: Partial<ModelPacerInput>): string =>
    pacerStory({ ...PACER_WARM_UP_INPUT, starting: false, ...fields });

  it('says where the player is and for how long, how the gap moves, what the pacer does and why, and the road', () => {
    expect(
      told({
        riderPlace: 'ahead',
        gapS: 4.5,
        placeForS: 20,
        gapDriftM: 9,
        intent: 'lift',
        byPct: 3,
        reason: 'rider-ahead',
      }),
    ).toBe(
      'Story so far: the player is ahead of you by 4.5 s, and has been ahead for 20 s; they are pulling away; you are lifting by 3 % to come back up to them.',
    );
    expect(
      told({
        riderPlace: 'behind',
        gapS: -12,
        placeForS: 150,
        gapDriftM: -20,
        intent: 'ease',
        byPct: 20,
        reason: 'rider-behind',
        course: {
          climb: { inM: 0, lengthM: 600, avgPct: 5, maxPct: 7 },
          descent: null,
          lapLeftM: null,
          climbLeftM: 30,
        },
      }),
    ).toBe(
      'Story so far: the player is behind you by 12 s, and has been behind for 150 s; they are dropping back; you are easing by 20 % so they can get back on; you are on a climb.',
    );
  });

  it('reads the last few seconds when there is no half minute yet, and says a small drift is the gap holding', () => {
    expect(told({ riderPlace: 'ahead', gapS: 3, gapTrend: 'rider-losing' })).toContain(
      'they are coming back to you',
    );
    expect(
      told({ riderPlace: 'behind', gapS: -3, gapDriftM: 2, gapTrend: 'rider-losing' }),
    ).toContain('the gap is holding');
    expect(told({ riderPlace: 'level', gapDriftM: 5 })).toContain('they are edging ahead');
    expect(told({ riderPlace: 'level', gapDriftM: -5 })).toContain('they are slipping back');
  });

  it('says a standstill, the start of the ride, and the terrain rule’s reasons', () => {
    expect(pacerStory(PACER_WARM_UP_INPUT)).toBe(
      'Story so far: the player is at a standstill; you are holding your pace because they are with you, and still easing yourself in at the start of the ride.',
    );
    expect(told({ intent: 'ease', byPct: 20, reason: 'rider-stopped' })).toContain(
      'you are easing by 20 % to wait for them',
    );
    expect(
      told({
        riderPlace: 'level',
        intent: 'lift',
        byPct: 5,
        reason: 'descent',
        course: {
          climb: { inM: 2_400, lengthM: 300, avgPct: 4, maxPct: 5 },
          descent: { inM: 0, lengthM: 400, avgPct: -5, maxPct: -6 },
          lapLeftM: 3_000,
          climbLeftM: 12,
        },
      }),
    ).toBe(
      'Story so far: the player is level with you; you are lifting by 5 % to carry speed down the descent; you are on a descent.',
    );
    expect(
      told({ riderPlace: 'level', intent: 'lift', byPct: 5, reason: 'over-the-top' }),
    ).toContain('to carry speed over the top');
  });

  it('is closed words and numbers: every word of every story comes from this file', () => {
    // No field of the state is a free string but `recentLines`, which the story never reads.
    const story = told({
      riderPlace: 'behind',
      gapS: -5,
      recentLines: ['Meet me at Box Hill.'],
      powerZone: 'VO₂',
    });
    expect(story).not.toContain('Box Hill');
    expect(story).not.toContain('VO₂');
  });
});

describe('the pacer’s warm-up — #2835, ADR 0083 D-4', () => {
  it('sends one call of the pacer’s own shape, with the pacer’s words and nothing of the rider’s', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(1, { local: OFFERED, fetch: server.fetch });
    const { token } = riders[0]!;
    await consentToTactics(w, token);
    expect(await warm(w, token)).toEqual({ status: 202, body: { warming: true } });
    await w.tactics.idle();

    expect(server.requests).toHaveLength(1);
    const body = server.requests[0]?.body as Record<string, unknown>;
    // The pacer's own prompt prefix, so the first ask of the ride finds it read.
    expect(body).toEqual(pacerRequest(TEST_TACTICS_MODEL.model, PACER_WARM_UP_INPUT, 1));
    expect((body.messages as { content: string }[])[0]?.content).toBe(PACER_SYSTEM);
    expect((body.options as { num_predict: number }).num_predict).toBe(1);
    expect(body).not.toHaveProperty('tools');
  });

  it('takes no model slot: another rider’s race starts while it is out', async () => {
    const server = chatServer(() => PACER_ANSWER);
    const { world: w, riders } = await pacerWorld(2, { local: OFFERED, fetch: server.fetch });
    const [first, second] = riders;
    await consentToTactics(w, first!.token);
    await consentToTactics(w, second!.token);
    expect((await warm(w, first!.token)).status).toBe(202);
    // A `start` would have made this `tactics_busy`.
    expect(
      (await w.call('POST', '/v1/analysis/tactics/start', { token: second!.token })).status,
    ).toBe(202);
    await w.call('POST', '/v1/analysis/tactics/end', { token: second!.token });
    await w.tactics.idle();
  });

  it('refuses before a model is called: not offered, and no consent', async () => {
    const server = chatServer(() => PACER_ANSWER);
    let offered = false;
    const { world: w, riders } = await pacerWorld(1, {
      local: () => Promise.resolve({ offered, model: TEST_TACTICS_MODEL }),
      fetch: server.fetch,
    });
    const { token } = riders[0]!;
    expect(codeOf(await warm(w, token))).toBe('local_unavailable');
    offered = true;
    expect(codeOf(await warm(w, token))).toBe('tactics_consent_required');
    await w.tactics.idle();
    expect(server.requests).toEqual([]);
  });
});
