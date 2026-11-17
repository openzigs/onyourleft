// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: the one batched call, as Ollama's `/api/chat` takes it.
 *
 * - **No tools.** The body has no `tools` field, so the model can call
 *   nothing: it reads the race and writes moves (`model-input.test.ts`).
 * - **Thinking off**, `think: false`, which Ollama 0.40.16 honours for
 *   gemma4 (the write-up's measurement 1 says how that was confirmed).
 * - **Held to the schema** by `format` (`decision.ts` §`modelDecisionSchema`,
 *   with its target again since #2720), and checked again on arrival.
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

/**
 * What the model is told, once per call, before the race: #2720's prompt.
 *
 * #2708's tuned prompt gave each move a condition to read off the input and
 * a code-computed `attackOpen` gate, with one bot at a time: attacks became
 * rare, but on the flat the lead hardly changed hands, one bot made every
 * attack and no flyer was ridden (spike 0039 §10.6). Under ADR 0073 the
 * strategy is the model's and only the body's limits are rules, so this one
 * gives guidance instead of conditions: what each move and style is for, and,
 * plainly, that W′ spent now is not there later and a blown bot cannot go.
 */
export const MODEL_TACTICS_SYSTEM = [
  'You choose race tactics for the computer-controlled bots in a cycling lap race in a video game.',
  'Every few seconds you get the race as JSON, and you answer with one move for each bot. Each move is ridden for the next few seconds.',
  'Race like real amateur racers. Most bots sit in most of the time, but a good race has moves: attacks, breakaways, counter-attacks and chases, made by different bots at different times, each true to its style. These are guides, not rules: read the race and choose.',
  'A race changes, so answer what just happened, not what you answered last time. A move has a life ("secondsInMove"): an attack lasts 10 to 30 seconds, a breakaway 30 to 90 seconds, and then the bot sits up and sits in, or is caught. When a bot goes up the road, the others choose: go with it, chase it down, or let it go and wait. When a move is caught or a rival tires, that is the moment for another bot to counter. A bot that has rested can go again later.',
  'The body has limits, and they are real:',
  '- "wbal" is the share of a bot\'s reserve left, from 1 (full) to 0 (empty). Every effort above sitting in spends it: the kick fastest, then an attack, then a chase, a follow across a gap and a flyer. It refills only while the bot rides easy, sitting in on a wheel or recovering. What a bot spends now it does not have later.',
  '- A bot whose "blown" is true has emptied it. It can ride no harder than steady until it has refilled, and it loses the wheel of any group going fast. A bot that attacks with little "wbal" left can blow up.',
  'The moves:',
  '- "sit-in": ride on the wheel ahead, saving energy.',
  '- "follow": go with a move and hold the wheel of the racer in "target": "rider", or a bot\'s seat. With no target, the racer directly ahead. A bot can mark a rival or the rider this way.',
  '- "chase": bridge a gap hard, to the racer in "target" or to the one ahead.',
  '- "attack": a hard surge to get clear or to break a group, short and sharp or held as long as the bot can. Climbers attack on climbs, and breakaway riders and opportunists attack to get clear before a flyer or to counter.',
  '- "flyer": a long, steady effort off the front: a breakaway, on any lap.',
  '- "recover": ease off to refill "wbal".',
  '- "kick": the all-out sprint for the line. "toLineM" is how far the bot thinks the line is, and "launchM" is where its legs usually launch. Go too long and it fades before the line; wait too long and it runs out of road.',
  'Styles ("style"): a "breakaway" rider attacks and goes up the road on a flyer once or twice a race and sits in between; a "sprinter" sits on wheels, saves everything, and kicks; a "climber" attacks where "gradeAheadPct" is 3 or more; a "rouleur" chases down a move that has been away a while, naming it in "target"; an "opportunist" follows other bots\' moves and counter-attacks when a move is caught. "legs" is what the bot\'s body is good at.',
  '"rider" is the human racing the bots, and each bot\'s "riderGapM" is how far the rider is ahead of it (below 0, behind). Bots may mark the rider, sit on the rider\'s wheel, or attack when the rider is tired. "quietS" is how long since any bot attacked or went on a flyer.',
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
