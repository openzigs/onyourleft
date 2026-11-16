// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the local model is told, and asked, for one bot-tactics decision** —
 * #2709, ADR 0071 D-3 and D-5.7.
 *
 * The prompt is spike 0039's as #2708 tuned it
 * (`apps/web/tools/model-tactics-spike/ollama.ts` §`MODEL_TACTICS_SYSTEM`), and
 * {@link TACTICS_PROMPT_VERSION} is raised with every change to its words. It
 * reads `quietS`, `attackOpen`, `ahead`, `aheadMove` and `secondsInMove` off
 * the race state, and the answer is asked for **with no target** (#2708): a
 * `follow` or `chase` goes to whoever is on the wheel ahead when it is ridden.
 * Nothing in it names a rider, a place or a model (ADR 0031 D-4).
 *
 * The request is Ollama's own `/api/chat` (spike 0039 §2), because it is the
 * one spelling the spike measured of the two rules a tactics call needs:
 *
 * - **Reasoning off**: `think: false` (D-5.7). With it on, 3 of 3 spike calls
 *   spent every output token and returned no decision.
 * - **Held to the schema** by `format`, the answer's JSON Schema without a target
 *   (`@onyourleft/domain` §`modelTacticsAnswerFormat`), and read again on
 *   arrival, field by field (`tactics.ts`).
 *
 * And **no `tools` field** (D-3.3): one call, no agent loop, nothing the model
 * can call. A local server that is not Ollama answers it 404, and the race
 * rides seeded tactics (D-7).
 */

import {
  modelTacticsAnswerFormat,
  modelTacticsSeats,
  type ModelTacticsInput,
} from '@onyourleft/domain';

/** Which prompt this is, for a measurement to name: raised with every change to the words below. */
export const TACTICS_PROMPT_VERSION = 'tactics-3';

/** The most a decision may write, tokens: seven moves with targets are about 150 (spike 0039: 73 typical). */
export const TACTICS_MOST_TOKENS = 400;

/** How long the model stays loaded after a call: spike 0039's 30 minutes, so a race never reloads it. */
export const TACTICS_KEEP_ALIVE = '30m';

/** What the model is told, once per call, before the race: spike 0039's #2708-tuned words, which say when each move is open in the input's own field names. */
export const TACTICS_SYSTEM = [
  'You choose race tactics for the computer-controlled bots in a cycling lap race in a video game.',
  'Every few seconds you get the race as JSON, and you answer with one move for each bot. Each move is ridden for the next few seconds.',
  'Race like real amateur racers. Most of the time the bots sit in, and a race has only a few attacks, spaced out.',
  'The moves:',
  '- "sit-in": ride in the group on the wheel ahead, saving energy. The default for every bot not doing something below.',
  '- "follow": go with a move. When a bot\'s "aheadMove" is "attack" or "flyer" and its "gapAheadM" is under 50, it follows.',
  '- "attack": surge off the front. A new attack starts only when "attackOpen" is true, and then only one bot starts it: a climber when its "gradeAheadPct" is 3 or more, otherwise an attacker, with "wbal" 0.7 or more. While "attackOpen" is false, no other bot starts an attack or a flyer. A bot whose "move" is already "attack" keeps attacking, whatever "attackOpen" says, until its "secondsInMove" is 15; then it sits in.',
  '- "chase": bridge a real gap. Only when "gapAheadM" is 30 to 200. A bot that has chased for 20 s ("secondsInMove") and is still 30 m or more behind gives up and sits in.',
  '- "recover": ease off to rebuild energy, when "wbal" is under 0.5.',
  '- "flyer": a long effort off the front instead of an attack, when "lapsLeft" is 2 or less: the one bot that goes when "attackOpen" is true may go on a flyer if its "wbal" is 0.6 or more. A bot whose "move" is already "flyer" keeps going, whatever "attackOpen" says, while its "wbal" is 0.6 or more.',
  '- "kick": the sprint for the line, only when "toLineM" is under "launchM".',
  'Each move may also carry an "effort", how hard the bot rides it: "easy", "tempo", "threshold" or "all-out". Leave it out to ride the move as it is. An effort changes nothing on "sit-in" or "follow" behind a wheel, or on "recover". Use "all-out" sparingly, for a decisive attack, and "easy" or "tempo" to save energy.',
  'Styles: a climber goes on climbs, an attacker goes on the flat, a sprinter sits in and waits for the kick, a rouleur rides steadily and chases.',
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
  quietS: 0,
  attackOpen: false,
  rider: { rank: 2, wPerKg: null },
  bots: [0, 1].map((seat) => ({
    bot: seat,
    style: seat === 0 ? 'rouleur' : 'sprinter',
    rank: seat === 0 ? 1 : 3,
    ahead: seat === 0 ? null : 'rider',
    aheadMove: null,
    gapAheadM: seat === 0 ? null : 0.5,
    gapBehindM: seat === 0 ? 0.5 : null,
    wbal: 1,
    drafting: seat !== 0,
    move: 'sit-in',
    secondsInMove: 0,
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
    format: modelTacticsAnswerFormat(modelTacticsSeats(input)),
    keep_alive: TACTICS_KEEP_ALIVE,
    options: { temperature: 0.6, num_predict: mostTokens },
    messages: [
      { role: 'system', content: TACTICS_SYSTEM },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
}
