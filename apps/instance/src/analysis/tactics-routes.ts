// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Model-chosen lap-race bot tactics** (#2709, ADR 0071): what this instance
 * offers the rider, their consent, a race's start and end, and one decision —
 * and **one AI-pacer decision** (#2712, ADR 0072), under the same consent,
 * slot and gates.
 * `tactics.ts` says what each checks, in what order, and why.
 *
 * Every one is `auth: 'session'` and `reaches: 'own'`: the athlete is the
 * session's, and no body or path names one (D-5.6).
 *
 * ⚠️ **Every one is sealed-only** (ADR 0047 D-7; ADR 0071 D-5.6), with no
 * plaintext twin, and listed in `sealed/phase-one.ts`: a race state and the
 * moves answered for it never cross the tunnel's edge readable.
 */

import {
  BOT_EFFORTS,
  BOT_TACTICS,
  MODEL_PACER_SAY_MOST_CHARACTERS,
  MODEL_TACTICS_REASONS,
  PACER_INTENTS,
  PACER_PLANS,
} from '@onyourleft/domain';

import { errorResponse } from '../errors.ts';
import { json, noContent, type Route, type RouteContext, type Schema } from '../route-kit.ts';
import { DEFAULT_TACTICS_DECISIONS, type Tactics } from './tactics.ts';
import { TACTICS_HOLD_CEILING_MS, TACTICS_HOLD_LAPSE_MS } from './tactics-hold.ts';

const status: Schema = {
  type: 'object',
  description:
    'Whether this instance offers you model races now (`offered`): its own local model configured and offered to you — for anybody but the operator, only while the operator lets other riders use it; no hosted model plays the bots. `instance` and `modelAddress` are what a consent names: this instance, and the address of its local model now (null when none is offered to you). `consent` is your recorded one, or null: the address it names and when (Unix seconds); it counts only while it names `modelAddress`. `consented`: offered, and your consent names its address.',
  properties: {
    offered: { type: 'boolean' },
    instance: { type: 'string' },
    modelAddress: { type: ['string', 'null'] },
    consent: {
      type: ['object', 'null'],
      properties: { modelAddress: { type: 'string' }, recordedAt: { type: 'integer' } },
      required: ['modelAddress', 'recordedAt'],
      additionalProperties: false,
    },
    consented: { type: 'boolean' },
  },
  required: ['offered', 'instance', 'modelAddress', 'consent', 'consented'],
  additionalProperties: false,
};

const decision: Schema = {
  type: 'object',
  description:
    'The model’s pick for the one bot asked about (#2836, ADR 0081): `reason`, why, from its closed list; `move`, one of the moves on the menu the ask offered; and, only when the model named one, `effort`, how hard. No other field, never a target (the menu names it), and never a power.',
  properties: {
    reason: { type: 'string', enum: [...MODEL_TACTICS_REASONS] },
    move: { type: 'string', enum: [...BOT_TACTICS] },
    effort: { type: 'string', enum: [...BOT_EFFORTS] },
  },
  required: ['reason', 'move'],
  additionalProperties: false,
};

const pacerDecision: Schema = {
  type: 'object',
  description: `The AI pacer’s plan and intent from their closed lists, and its line of feedback: at most ${String(MODEL_PACER_SAY_MOST_CHARACTERS)} characters, screened, or "" for none. No other field, and never a power.`,
  properties: {
    plan: { type: 'string', enum: [...PACER_PLANS] },
    intent: { type: 'string', enum: [...PACER_INTENTS] },
    say: { type: 'string' },
  },
  required: ['plan', 'intent', 'say'],
  additionalProperties: false,
};

/** The handler answers `unavailable` and `unauthenticated` before such a route is called without either. */
function ready(
  context: RouteContext,
): { tactics: Tactics; caller: NonNullable<RouteContext['caller']> } | undefined {
  const { tactics, caller } = context;
  return tactics === undefined || caller === undefined ? undefined : { tactics, caller };
}

const COMMON = {
  sealed: 'only',
  reaches: 'own',
  identity: true,
  auth: 'session',
  tactics: true,
} as const;

const GATES = ['local_unavailable', 'tactics_consent_required', 'tactics_busy'] as const;

export const TACTICS_ROUTES: readonly Route[] = [
  {
    ...COMMON,
    method: 'GET',
    path: '/v1/analysis/tactics',
    operationId: 'getBotTactics',
    summary:
      'Whether this instance offers you AI bots in a lap race (ADR 0071): a language model on THIS instance’s own local model picks each bot’s move, and never its power. Says the instance and local model address a consent names, and your recorded consent.',
    errors: ['unauthenticated', 'unavailable'],
    response: { contentType: 'application/json', schema: status },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      return json(await got.tactics.status(got.caller));
    },
  },
  {
    ...COMMON,
    method: 'POST',
    path: '/v1/analysis/tactics/consent',
    operationId: 'recordBotTacticsConsent',
    summary:
      'Record your consent to this instance’s own local model choosing your lap-race bots’ tactics (ADR 0071 D-5.2). `instance` and `modelAddress` must be the ones `GET /v1/analysis/tactics` says now, else `validation_failed`. Replaces any consent you had. A change of the local model’s address withdraws it: your next race asks again. `local_unavailable` when no local model is offered to you.',
    request: {
      type: 'object',
      properties: { instance: { type: 'string' }, modelAddress: { type: 'string' } },
      required: ['instance', 'modelAddress'],
      additionalProperties: false,
    },
    errors: ['unauthenticated', 'validation_failed', 'local_unavailable', 'unavailable'],
    response: { contentType: 'application/json', schema: status },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const outcome = await got.tactics.recordConsent(got.caller, context.json);
      if (outcome.ok) return json(outcome.value);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
  {
    ...COMMON,
    method: 'DELETE',
    path: '/v1/analysis/tactics/consent',
    operationId: 'withdrawBotTacticsConsent',
    summary:
      'Withdraw your consent to model-chosen bot tactics (ADR 0071 D-5.4). Your next tactics request is refused, and a race you are riding finishes on its usual tactics; nothing else of yours changes.',
    errors: ['unauthenticated', 'unavailable'],
    response: { contentType: 'application/json', schema: status },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      return json(await got.tactics.withdrawConsent(got.caller));
    },
  },
  {
    ...COMMON,
    method: 'POST',
    path: '/v1/analysis/tactics/start',
    operationId: 'startBotTacticsRace',
    summary: `Your AI-bots race, or your ride with an AI pacer (ADR 0072), is starting (ADR 0071 D-6): it takes this instance’s one model race slot, and post-ride write-ups on this instance wait while it runs — none already running is stopped, and a re-plan does not wait. Answers 202 at once; \`warming\` says a call of the same shape about a fixed race, with nothing of yours in it, has gone out to load the model, so the first decision is not late. The slot is let go by \`POST /v1/analysis/tactics/end\`, after ${String(TACTICS_HOLD_LAPSE_MS / 1000)} s with no tactics request, or ${String(TACTICS_HOLD_CEILING_MS / 3_600_000)} hours after it was taken, whichever is first. \`tactics_busy\` while another rider’s AI-bots race holds it; \`local_unavailable\` and \`tactics_consent_required\` before anything is sent. Counted with your decisions against \`rate_limited\`.`,
    accepted: true,
    errors: ['unauthenticated', ...GATES, 'rate_limited', 'unavailable'],
    response: {
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { warming: { type: 'boolean' } },
        required: ['warming'],
        additionalProperties: false,
      },
    },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const outcome = await got.tactics.start(got.caller);
      return outcome.ok ? json(outcome.value, 202) : errorResponse(outcome.code);
    },
  },
  {
    ...COMMON,
    method: 'POST',
    path: '/v1/analysis/tactics/decide',
    operationId: 'decideBotTactics',
    summary: `One decision for ONE of your AI bots (ADR 0071 D-3; one bot a call since #2836, ADR 0081): \`input\` is that bot’s ask, exactly \`@onyourleft/domain\`’s \`ModelTacticsInput\` — the race as it stands (laps, the course ahead of the leading bot since #2794, your rank, gaps and W/kg, and every racing bot’s seat, style, rank, move and gap), the story so far in numbers and closed words (seconds raced, laps left, the break, the lull, how the bots are for energy), and last the bot asked about: its style and strengths, the seconds since its last move, its move, rank, gaps, W′ share, laps and metres to the line, grade ahead and metres to the next climb, its cue words, and the menu of two to four moves your device offers it; no coordinate, no name — at most 4 096 characters. Answers \`reason\`, a word from a closed list, and \`move\`, one from that menu, with an \`effort\` word when the model named one. **No power, ever.** The model is given no tools, asked for no reasoning, and its text is neither kept nor returned. \`tactics_invalid\` when its answer was not such a pick, a move off the menu included, \`tactics_failed\` when it gave none in time; on either, and on every refusal, the bot rides its usual tactics. An ask of the shape sent before #2836 is \`validation_failed\`. Takes or refreshes the model race slot as \`start\` does. \`rate_limited\` past ${String(DEFAULT_TACTICS_DECISIONS.limit)} a minute on an instance with the default limits, or while one of yours is out.`,
    request: {
      type: 'object',
      properties: {
        input: { type: 'object', description: 'A `ModelTacticsInput` (#2709, #2836).' },
      },
      required: ['input'],
      additionalProperties: false,
    },
    errors: [
      'unauthenticated',
      'validation_failed',
      ...GATES,
      'rate_limited',
      'tactics_invalid',
      'tactics_failed',
      'unavailable',
    ],
    response: { contentType: 'application/json', schema: decision },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const outcome = await got.tactics.decide(got.caller, context.json);
      if (outcome.ok) return json(outcome.value);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
  {
    ...COMMON,
    method: 'POST',
    path: '/v1/analysis/pacer/decide',
    operationId: 'decidePacer',
    summary: `One decision for your AI pacer (#2712, ADR 0072): \`input\` is the ride as it stands, exactly \`@onyourleft/domain\`’s \`ModelPacerInput\` — the pacer’s W/kg, its plan and intent and the seconds held, your gap to it, your W/kg, whether you are in its draft, the grade ahead, the metres to the finish and the seconds ridden, and since #2760, each only when its sensor is live, your power over 3 s and the last minute with its zone, trend and time at or above threshold, your cadence, and your heart rate with its zone and trend, and up to three of the pacer’s own last lines, and since #2777 where you are against it (\`ahead\`, \`level\` or \`behind\`) and how the gap is moving, and since #2794 the course ahead of the pacer (the next climb and descent, and the climbing left); no coordinate, no name — at most 2 048 characters. Answers \`plan\` (\`rolling\`, \`even\` or \`climber\`), \`intent\` (\`hold\`, \`lift\` or \`ease\`) and \`say\`, one line of feedback of at most 80 characters with no number, no metric name and no health wording, or "". **No power, ever**, and nothing of it reaches a trainer: the plan and intent move the pacer inside its usual range. The same consent as AI bots, the same model slot (\`POST /v1/analysis/tactics/start\` and \`end\`), the same rate limit and the same model call, with no tools and no reasoning. \`tactics_invalid\` when the model’s answer was not such a decision, its line did not pass, or its line said the opposite of its intent, \`tactics_failed\` when it gave none in time; on either, and on every refusal, the pacer rides its usual rule.`,
    request: {
      type: 'object',
      properties: { input: { type: 'object', description: 'A `ModelPacerInput` (#2712).' } },
      required: ['input'],
      additionalProperties: false,
    },
    errors: [
      'unauthenticated',
      'validation_failed',
      ...GATES,
      'rate_limited',
      'tactics_invalid',
      'tactics_failed',
      'unavailable',
    ],
    response: { contentType: 'application/json', schema: pacerDecision },
    handle: async (context) => {
      const got = ready(context);
      if (got === undefined) return errorResponse('unavailable');
      const outcome = await got.tactics.pace(got.caller, context.json);
      if (outcome.ok) return json(outcome.value);
      return errorResponse(
        outcome.code,
        outcome.fields === undefined ? {} : { fields: outcome.fields },
      );
    },
  },
  {
    ...COMMON,
    method: 'POST',
    path: '/v1/analysis/tactics/end',
    operationId: 'endBotTacticsRace',
    summary:
      'Your AI-bots race, or your ride with an AI pacer, has ended: the model race slot is let go, and write-ups held for it start. Nothing for a slot you do not hold.',
    errors: ['unauthenticated', 'unavailable'],
    response: { contentType: 'none' },
    handle: (context) => {
      const got = ready(context);
      if (got === undefined) return Promise.resolve(errorResponse('unavailable'));
      got.tactics.end(got.caller);
      return Promise.resolve(noContent());
    },
  },
];
