// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Model-chosen lap-race bot tactics** (#2709, ADR 0071): what this instance
 * offers the rider, their consent, a race's start and end, and one decision.
 * `tactics.ts` says what each checks, in what order, and why.
 *
 * Every one is `auth: 'session'` and `reaches: 'own'`: the athlete is the
 * session's, and no body or path names one (D-5.6).
 *
 * ⚠️ **Every one is sealed-only** (ADR 0047 D-7; ADR 0071 D-5.6), with no
 * plaintext twin, and listed in `sealed/phase-one.ts`: a race state and the
 * moves answered for it never cross the tunnel's edge readable.
 */

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
  properties: {
    bots: {
      type: 'array',
      items: {
        type: 'object',
        description:
          'One bot’s move: `bot`, its seat; `move`, one of `sit-in`, `follow`, `attack`, `chase`, `recover`, `flyer` and `kick`; and, only when the model named one, `target`: `"rider"` or a seat. No other field, and never a power.',
      },
    },
  },
  required: ['bots'],
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
    summary: `Your AI-bots race is starting (ADR 0071 D-6): it takes this instance’s one model race slot, and post-ride write-ups on this instance wait while it runs — none already running is stopped, and a re-plan does not wait. Answers 202 at once; \`warming\` says a call of the same shape about a fixed race, with nothing of yours in it, has gone out to load the model, so the first decision is not late. The slot is let go by \`POST /v1/analysis/tactics/end\`, after ${String(TACTICS_HOLD_LAPSE_MS / 1000)} s with no tactics request, or ${String(TACTICS_HOLD_CEILING_MS / 3_600_000)} hours after it was taken, whichever is first. \`tactics_busy\` while another rider’s AI-bots race holds it; \`local_unavailable\` and \`tactics_consent_required\` before anything is sent. Counted with your decisions against \`rate_limited\`.`,
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
    summary: `One decision for your AI bots (ADR 0071 D-3): \`input\` is the race as it stands, exactly \`@onyourleft/domain\`’s \`ModelTacticsInput\` — seats, styles, ranks, gaps, W′ shares, drafting, moves, laps and metres to the line, launch distance, grade ahead, your gap, rank and W/kg; no coordinate, no name — at most 4 096 characters. Answers \`bots\`: a move from the closed list of seven for each bot the model named, and a target only of \`rider\` or a seat. **No power, ever.** The model is given no tools, asked for no reasoning, and its text is neither kept nor returned. \`tactics_invalid\` when its answer was not such a decision, \`tactics_failed\` when it gave none in time; on either, and on every refusal, ride the bots’ usual tactics. Takes or refreshes the model race slot as \`start\` does. \`rate_limited\` past ${String(DEFAULT_TACTICS_DECISIONS.limit)} a minute on an instance with the default limits, or while one of yours is out.`,
    request: {
      type: 'object',
      properties: { input: { type: 'object', description: 'A `ModelTacticsInput` (#2709).' } },
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
    path: '/v1/analysis/tactics/end',
    operationId: 'endBotTacticsRace',
    summary:
      'Your AI-bots race has ended: the model race slot is let go, and write-ups held for it start. Nothing for a slot you do not hold.',
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
