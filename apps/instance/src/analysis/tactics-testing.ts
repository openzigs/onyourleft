// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for model-chosen bot tactics (#2709): a race state of the
 * domain's shape, the local model a test world offers, an `/api/chat` that
 * answers what a test says, and the consent a device records. Never shipped.
 */

import type { ModelPacerInput, ModelTacticsInput } from '@onyourleft/domain';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import type { TacticsLocal } from './tactics.ts';

/**
 * One bot's ask (#2836, ADR 0081): seven bots three laps out, the rider
 * fourth, and the climber in seat 2 asked about on a climb, offered an attack,
 * a follow of the bot ahead and sitting in. No coordinate and no name.
 */
export const TACTICS_INPUT: ModelTacticsInput = {
  laps: 3,
  // #2794: a climb coming, a descent after it, and a flat finish.
  course: {
    climb: { inM: 400, lengthM: 600, avgPct: 6, maxPct: 9 },
    descent: { inM: 1_100, lengthM: 500, avgPct: -5, maxPct: -7 },
    lapLeftM: 1_800,
    lapClimbM: 38,
    finishPct: 0,
  },
  rider: { rank: 4, wPerKg: 3.1, ahead: 2, gapAheadM: 4, gapBehindM: 3, drafting: true },
  field: [0, 1, 2, 3, 4, 5, 6].map((seat) => ({
    bot: seat,
    style: (['breakaway', 'sprinter', 'climber', 'rouleur', 'opportunist'] as const)[seat % 5]!,
    rank: seat < 3 ? seat + 1 : seat + 2,
    move: seat === 1 ? ('attack' as const) : ('sit-in' as const),
    gapAheadM: seat === 0 ? null : 3,
  })),
  story: {
    raceS: 130,
    lapsLeft: 3,
    quietS: 0,
    moved: true,
    away: { racers: 2, s: 40, gapM: 60 },
    bunch: 'tiring',
  },
  you: {
    bot: 2,
    style: 'climber',
    flat: 'average',
    climb: 'strong',
    sprint: 'weak',
    punch: 'average',
    sinceMoveS: 95,
    move: 'sit-in',
    secondsInMove: 12,
    rank: 3,
    gapAheadM: 3,
    gapBehindM: 4,
    riderGapM: -4,
    wbal: 0.8,
    drafting: true,
    lapsLeft: 3,
    toLineM: 1_800,
    gradeAheadPct: 6,
    climbInM: 0,
    cues: ['on-your-terrain', 'fresh', 'move-ahead'],
    menu: [{ move: 'follow', target: 1 }, { move: 'attack' }, { move: 'sit-in' }],
  },
};

/** The local model a test world offers: a loopback address, so no name is resolved. */
export const TEST_TACTICS_MODEL = {
  baseUrl: new URL('http://127.0.0.1:11434/v1'),
  model: 'a-local-model',
} as const;

/** Offered to every athlete. */
export const OFFERED: () => Promise<TacticsLocal> = () =>
  Promise.resolve({ offered: true, model: TEST_TACTICS_MODEL });

/** One request `/api/chat` was sent, as a test reads it back. */
export interface ChatRequest {
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/**
 * What a model server says a call cost, as Ollama spells it: durations in
 * nanoseconds, counts in tokens. Sent with every answer {@link chatServer}
 * gives unless a test hands its own.
 */
export const CHAT_FIGURES = {
  total_duration: 812_345_678,
  load_duration: 21_400_000,
  prompt_eval_count: 1_420,
  prompt_eval_duration: 301_600_000,
  eval_count: 17,
  eval_duration: 455_500_000,
} as const;

/**
 * A `fetch` that answers `/api/chat` with `answer(body)` as the model's
 * content — or, for `undefined`, a 500 — and records every request.
 */
export function chatServer(
  answer: (body: Readonly<Record<string, unknown>>) => string | undefined,
  figures: Readonly<Record<string, unknown>> = CHAT_FIGURES,
): {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  return {
    requests,
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const sent = init?.body;
      const body = JSON.parse(typeof sent === 'string' ? sent : '{}') as Readonly<
        Record<string, unknown>
      >;
      requests.push({ url, body });
      const content = answer(body);
      return Promise.resolve(
        content === undefined
          ? Response.json({ error: 'model failed' }, { status: 500 })
          : Response.json({
              model: body.model,
              message: { role: 'assistant', content },
              done: true,
              ...figures,
            }),
      );
    },
  };
}

/** A model's valid pick for {@link TACTICS_INPUT}: the reason first, then a move on its menu. */
export const ATTACK = JSON.stringify({ reason: 'my-terrain', move: 'attack', effort: 'all-out' });

/** Record `token`'s consent naming what the instance says now, as a device does. */
export async function consentToTactics(
  world: IdentityInstance,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const status = (await world.call('GET', '/v1/analysis/tactics', { token })).body as {
    instance: string;
    modelAddress: string | null;
  };
  return world.call('POST', '/v1/analysis/tactics/consent', {
    token,
    body: { instance: status.instance, modelAddress: status.modelAddress },
  });
}

/** A pacer state of the domain's shape (#2712): the rider 12 m back, in the draft, a rise ahead. */
export const PACER_INPUT: ModelPacerInput = {
  pacerWPerKg: 2.5,
  plan: 'rolling',
  intent: 'hold',
  secondsInIntent: 10,
  riderGapM: -12,
  riderWPerKg: 2.4,
  riderInDraft: true,
  gradeAheadPct: 3.5,
  toFinishM: 6_000,
  rideS: 240,
  // #2794: the rise ahead is the start of a climb, with a descent after it.
  course: {
    climb: { inM: 100, lengthM: 900, avgPct: 5, maxPct: 8 },
    descent: { inM: 1_400, lengthM: 600, avgPct: -4, maxPct: -6 },
    lapLeftM: null,
    climbLeftM: 85,
  },
};

/** A model's valid pacer answer (#2712). */
export const PACER_ANSWER = JSON.stringify({
  plan: 'climber',
  intent: 'ease',
  say: 'Nice and steady, stay on my wheel.',
});

/** Whether an `/api/chat` body asks for a pacer decision: its schema names a plan. */
export function asksForPacer(body: Readonly<Record<string, unknown>>): boolean {
  const format = body.format as { properties?: Record<string, unknown> } | undefined;
  return format?.properties?.plan !== undefined;
}
