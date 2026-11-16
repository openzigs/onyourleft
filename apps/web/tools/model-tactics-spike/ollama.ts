// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: the one batched call, as Ollama's `/api/chat` takes it.
 *
 * - **No tools.** The body has no `tools` field, so the model can call
 *   nothing: it reads the race and writes moves (`ollama.test.ts`).
 * - **Thinking off**, `think: false`, which Ollama 0.40.16 honours for
 *   gemma4 (the write-up's measurement 1 says how that was confirmed).
 * - **Held to the schema** by `format`, and checked again on arrival
 *   (`decision.ts`).
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

import { modelDecisionSchema } from './decision';
import type { ModelInput } from './model-input';

/** The model the spike measures: the one the owner's instance runs its write-ups on (2026-11-14). */
export const MODEL_TACTICS_MODEL = 'gemma4:12b';

/** The most the model may write, tokens: seven moves with targets are about 150. */
export const MODEL_TACTICS_MOST_TOKENS = 400;

/** What the model is told, once per call, before the race. */
export const MODEL_TACTICS_SYSTEM = [
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
    format: modelDecisionSchema(bots),
    keep_alive: '30m',
    options: { temperature: 0.6, seed, num_predict: MODEL_TACTICS_MOST_TOKENS },
    messages: [
      { role: 'system', content: MODEL_TACTICS_SYSTEM },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
}
