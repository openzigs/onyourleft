// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the local model is told, and asked, for one AI-pacer decision** —
 * #2712, ADR 0072 D-3 and D-4.
 *
 * The request is the tactics call's shape (`tactics-prompt.ts`), for the
 * reasons that file gives: Ollama's own `/api/chat`, **reasoning off**
 * (`think: false`), the answer **held to the schema** by `format`
 * (`@onyourleft/domain` §`modelPacerAnswerSchema`) and read again on arrival,
 * field by field — and **no `tools` field**: one call, no agent loop,
 * nothing the model can call (D-3).
 *
 * The words ask for a plan and an intent from two closed lists, and a short
 * line of encouragement with no number, no metric name and no health claim.
 * The line is screened on the instance and again on the device
 * (§`pacerSayProblem`): what the prompt asks is a request, the screen is the
 * rule. Nothing here names a rider, a place or a model (ADR 0031 D-4).
 * {@link PACER_PROMPT_VERSION} is raised with every change to the words.
 */

import { modelPacerAnswerSchema, type ModelPacerInput } from '@onyourleft/domain';

import { TACTICS_KEEP_ALIVE } from './tactics-prompt.ts';

/** Which prompt this is, for a measurement to name: raised with every change to the words below. */
export const PACER_PROMPT_VERSION = 'pacer-1';

/**
 * The most a decision may write, tokens: **120**. Spike 0039 §7 estimated a
 * plan, an intent and a line at 40 to 60.
 */
export const PACER_MOST_TOKENS = 120;

/** What the model is told, once per call, before the pacer's state. */
export const PACER_SYSTEM = [
  'You are the pacer in a cycling video game: a computer rider the player rides with on an indoor trainer.',
  'Every few seconds you get the ride as JSON, and you answer with your plan, your intent and one short line to the player.',
  'Plans: "rolling" pushes a little on climbs and eases on descents; "even" rides the same effort everywhere; "climber" pushes harder on climbs and eases more on descents.',
  'Intents: "hold" rides the plan; "lift" goes a little harder; "ease" goes a little easier.',
  'Ride like a good training partner. When the player is close behind or in your draft ("riderInDraft"), hold. When the player has dropped back ("riderGapM" well below 0), ease a little so they can come back. When the player is ahead, lift to stay with them. Change intent only every few decisions.',
  '"say" is one short, friendly line of encouragement or feedback to the player, at most 80 characters, or "" to say nothing. Never use digits or numbers, units, symbols or emoji. Never name a training metric. Never mention health, the heart, pain, injury or anything medical. Never mention places or names.',
  'Answer with JSON only, in the schema given.',
].join('\n');

/**
 * The `/api/chat` body for one decision on `input` by `model`. No `tools`
 * field, reasoning off, the answer held to the pacer schema.
 */
export function pacerRequest(
  model: string,
  input: ModelPacerInput,
): Readonly<Record<string, unknown>> {
  return {
    model,
    stream: false,
    think: false,
    format: modelPacerAnswerSchema(),
    keep_alive: TACTICS_KEEP_ALIVE,
    options: { temperature: 0.7, num_predict: PACER_MOST_TOKENS },
    messages: [
      { role: 'system', content: PACER_SYSTEM },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
}
