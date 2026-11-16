// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the local model is told, and asked, for one bot-tactics decision** —
 * #2709, ADR 0071 D-3 and D-5.7.
 *
 * ⚠️ **The prompt is spike 0039's, untuned**: `apps/web/tools/model-tactics-spike/ollama.ts`
 * §`MODEL_TACTICS_SYSTEM` as it was measured on 2026-11-16, which over-attacks
 * (spike 0039 §5). #2708 tunes it against the seeded harness; this file is
 * where the tuned text lands, and {@link TACTICS_PROMPT_VERSION} is raised with
 * it. Nothing in it names a rider, a place or a model (ADR 0031 D-4).
 *
 * The request is Ollama's own `/api/chat` (spike 0039 §2), because it is the
 * one spelling the spike measured of the two rules a tactics call needs:
 *
 * - **Reasoning off**: `think: false` (D-5.7). With it on, 3 of 3 spike calls
 *   spent every output token and returned no decision.
 * - **Held to the schema** by `format`, the answer's JSON Schema
 *   (`@onyourleft/domain` §`modelTacticsAnswerSchema`), and read again on
 *   arrival, field by field (`tactics.ts`).
 *
 * And **no `tools` field** (D-3.3): one call, no agent loop, nothing the model
 * can call. A local server that is not Ollama answers it 404, and the race
 * rides seeded tactics (D-7).
 */

import {
  modelTacticsAnswerSchema,
  modelTacticsSeats,
  type ModelTacticsInput,
} from '@onyourleft/domain';

/** Which prompt this is, for a measurement to name: raised with every change to the words below. */
export const TACTICS_PROMPT_VERSION = 'tactics-1';

/** The most a decision may write, tokens: seven moves with targets are about 150 (spike 0039: 73 typical). */
export const TACTICS_MOST_TOKENS = 400;

/** How long the model stays loaded after a call: spike 0039's 30 minutes, so a race never reloads it. */
export const TACTICS_KEEP_ALIVE = '30m';

/** What the model is told, once per call, before the race. Spike 0039's words, untuned (#2708). */
export const TACTICS_SYSTEM = [
  'You choose race tactics for the computer-controlled bots in a cycling lap race in a video game.',
  'Every few seconds you get the race as JSON, and you answer with one move for each bot.',
  'The moves:',
  '- "sit-in": ride in the group on the wheel ahead, saving energy. The default; most bots sit in most of the time, above all early.',
  '- "follow": go with a move by the racer directly ahead.',
  '- "attack": surge off the front for up to 20 seconds. Best in a lull or on a climb; most attacks are caught.',
  '- "chase": bridge to the racer directly ahead when they are 30 to 200 m up the road.',
  '- "recover": ease off to rebuild energy.',
  '- "flyer": a long effort in the last two laps by a bot with energy to spare.',
  '- "kick": the sprint for the line, only inside the bot\'s launch distance "launchM".',
  'Each bot\'s energy "wbal" runs from 0 to 1. Attack and chase need 0.3 or more, flyer 0.6 or more. A bot that spends early fades.',
  'Styles: a climber attacks on climbs ("gradeAheadPct" of 3 or more), an attacker goes early, a sprinter waits for the kick, a rouleur rides steadily.',
  'Race like people race: vary it, make the rider work, and do not send every bot at once.',
  'A target is optional and only for follow and chase: "rider" or a bot number, and only the racer directly ahead.',
  'Answer with JSON only, in the schema given.',
].join('\n');

/**
 * The race the warm-up call asks about (ADR 0071 D-6.5): two bots on the line
 * of a three-lap race. Fixed, so **nothing of the rider's is in it**, and of
 * the same shape as every decision, so the model is loaded and its system
 * text read before the first real one.
 */
export const WARM_UP_INPUT: ModelTacticsInput = {
  laps: 3,
  field: 3,
  rider: { rank: 2, wPerKg: null },
  bots: [0, 1].map((seat) => ({
    bot: seat,
    style: seat === 0 ? 'rouleur' : 'sprinter',
    rank: seat === 0 ? 1 : 3,
    gapAheadM: seat === 0 ? null : 0.5,
    gapBehindM: seat === 0 ? 0.5 : null,
    wbal: 1,
    drafting: seat !== 0,
    move: 'sit-in',
    lapsLeft: 3,
    toLineM: 1_800,
    launchM: 250,
    gradeAheadPct: 0,
    riderGapM: seat === 0 ? -0.5 : 0.5,
  })),
};

/**
 * The `/api/chat` body for one decision on `input` by `model`, writing at
 * most `mostTokens`. No `tools` field, reasoning off, the answer held to the
 * schema of `input`'s seats.
 */
export function tacticsRequest(
  model: string,
  input: ModelTacticsInput,
  mostTokens: number = TACTICS_MOST_TOKENS,
): Readonly<Record<string, unknown>> {
  return {
    model,
    stream: false,
    think: false,
    format: modelTacticsAnswerSchema(modelTacticsSeats(input)),
    keep_alive: TACTICS_KEEP_ALIVE,
    options: { temperature: 0.6, num_predict: mostTokens },
    messages: [
      { role: 'system', content: TACTICS_SYSTEM },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
}
