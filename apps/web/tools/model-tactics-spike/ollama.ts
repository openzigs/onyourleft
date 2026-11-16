// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: the one batched call, as Ollama's `/api/chat` takes it.
 *
 * - **No tools.** The body has no `tools` field, so the model can call
 *   nothing: it reads the race and writes moves (`model-input.test.ts`).
 * - **Thinking off**, `think: false`, which Ollama 0.40.16 honours for
 *   gemma4 (the write-up's measurement 1 says how that was confirmed).
 * - **Held to the schema** by `format`, which since #2708 offers no target
 *   (`decision.ts` §`modelAnswerFormat`), and checked again on arrival.
 * - A fixed `seed` per call, so a rerun asks the same question the same way.
 *
 * In a build the call is the instance's, never the tablet's: the instance has
 * no Bluetooth and no trainer path, and the answer comes back through the one
 * module `apps/web/src/privacy/no-network.test.ts` admits for instance
 * traffic. The spike calls Ollama on the owner's instance PC over SSH from a
 * development machine (`live.ts`), which ships in nothing.
 *
 * Spike code: see `decision.ts`.
 */

import { modelAnswerFormat } from './decision';
import type { ModelInput } from './model-input';

/** The model the spike measures: the one the owner's instance runs its write-ups on (2026-11-14). */
export const MODEL_TACTICS_MODEL = 'gemma4:12b';

/** The most the model may write, tokens: seven moves with targets are about 150. */
export const MODEL_TACTICS_MOST_TOKENS = 400;

/**
 * What the model is told, once per call, before the race: #2708's tuned
 * prompt. Spike 0039's first one (#2616) described the moves and asked for
 * variety, and the model attacked 12 to 17 % of bot-time on the flat and
 * about 30 % on the hills, and hardly ever followed or chased. This one says
 * how rare an attack is and when each move is open, in the input's own field
 * names, so the model can read the condition straight off the race.
 */
export const MODEL_TACTICS_SYSTEM = [
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
  'Styles: a climber goes on climbs, an attacker goes on the flat, a sprinter sits in and waits for the kick, a rouleur rides steadily and chases.',
  'Answer with JSON only, in the schema given.',
].join('\n');

/** The `/api/chat` body for one batched decision on `input`. */
export function decisionRequest(
  input: ModelInput,
  bots: number,
  seed: number,
): Readonly<Record<string, unknown>> {
  return {
    model: MODEL_TACTICS_MODEL,
    stream: false,
    think: false,
    format: modelAnswerFormat(bots),
    keep_alive: '30m',
    options: { temperature: 0.6, seed, num_predict: MODEL_TACTICS_MOST_TOKENS },
    messages: [
      { role: 'system', content: MODEL_TACTICS_SYSTEM },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
}
