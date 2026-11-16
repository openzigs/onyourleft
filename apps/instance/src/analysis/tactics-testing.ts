// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for model-chosen bot tactics (#2709): a race state of the
 * domain's shape, the local model a test world offers, an `/api/chat` that
 * answers what a test says, and the consent a device records. Never shipped.
 */

import type { ModelTacticsInput } from '@onyourleft/domain';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import type { TacticsLocal } from './tactics.ts';

/** Seven bots three laps out, the rider fourth: spike 0039's shape, with no coordinate or name. */
export const TACTICS_INPUT: ModelTacticsInput = {
  laps: 3,
  field: 8,
  quietS: 40,
  rider: { rank: 4, wPerKg: 3.1, ahead: 2, gapAheadM: 4.2, gapBehindM: 3.4, drafting: true },
  bots: [0, 1, 2, 3, 4, 5, 6].map((seat) => ({
    bot: seat,
    style: (['breakaway', 'sprinter', 'climber', 'rouleur', 'opportunist'] as const)[seat % 5]!,
    legs: 'rouleur' as const,
    rank: seat < 3 ? seat + 1 : seat + 2,
    ahead: seat === 0 ? null : seat === 3 ? 'rider' : seat - 1,
    aheadMove: seat === 0 || seat === 3 ? null : ('sit-in' as const),
    gapAheadM: seat === 0 ? null : 2.5,
    gapBehindM: seat === 6 ? null : 1.2,
    wbal: 0.8,
    blown: false,
    drafting: seat !== 0,
    move: 'sit-in' as const,
    secondsInMove: 12,
    lapsLeft: 3,
    toLineM: 1_800,
    launchM: 250,
    gradeAheadPct: 1.5,
    riderGapM: seat < 3 ? -4.2 : 3.4,
  })),
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
 * A `fetch` that answers `/api/chat` with `answer(body)` as the model's
 * content — or, for `undefined`, a 500 — and records every request.
 */
export function chatServer(
  answer: (body: Readonly<Record<string, unknown>>) => string | undefined,
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
            }),
      );
    },
  };
}

/** The answer a model gives that every bot named should attack: a valid decision. */
export const ATTACK = JSON.stringify({
  bots: [
    { bot: 0, move: 'attack' },
    { bot: 3, move: 'chase', target: 2 },
  ],
});

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
