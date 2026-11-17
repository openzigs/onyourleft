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
 * line with no number, no metric name and no health claim. Since #2760 the
 * line is coaching from the rider's own sensors when the state carries them
 * (`@onyourleft/domain` §`ModelPacerInput`: power, its zone and trend, the
 * stretch above threshold, cadence, heart rate, its zone and trend), and the
 * state carries the model's own last lines, which it is asked not to repeat.
 * The line is screened on the instance and again on the device
 * (§`pacerSayProblem`): what the prompt asks is a request, the screen is the
 * rule. Nothing here names a rider, a place or a model (ADR 0031 D-4).
 * {@link PACER_PROMPT_VERSION} is raised with every change to the words.
 */

import { modelPacerAnswerSchema, type ModelPacerInput } from '@onyourleft/domain';

import { TACTICS_KEEP_ALIVE } from './tactics-prompt.ts';

/** Which prompt this is, for a measurement to name: raised with every change to the words below. */
export const PACER_PROMPT_VERSION = 'pacer-2';

/**
 * The most a decision may write, tokens: **120**. Spike 0039 §7 estimated a
 * plan, an intent and a line at 40 to 60.
 */
export const PACER_MOST_TOKENS = 120;

/**
 * How freely the model picks its words: **0.7**, above 0 so its lines vary
 * (#2760). Measured on the owner's PC on 2026-11-17 against 0.9, on one model
 * and a scripted ride (the pull request for #2760 has the numbers): 0.7 kept
 * the lines tied to what the rider was doing, 0.9 varied them little more.
 */
export const PACER_TEMPERATURE = 0.7;

/** What the model is told, once per call, before the pacer's state. */
export const PACER_SYSTEM = [
  'You are the pacer in a cycling video game: a computer rider the player rides with on an indoor trainer, and a kind, knowledgeable coach.',
  'Every few seconds you get the ride as JSON, and you answer with your plan, your intent and one short line to the player.',
  'Plans: "rolling" pushes a little on climbs and eases on descents; "even" rides the same effort everywhere; "climber" pushes harder on climbs and eases more on descents.',
  'Intents: "hold" rides the plan; "lift" goes a little harder; "ease" goes a little easier.',
  'Ride like a good training partner. When the player is close behind or in your draft ("riderInDraft"), hold. When the player has dropped back ("riderGapM" well below 0), ease a little so they can come back. When the player is ahead, lift to stay with them. Change intent only every few decisions.',
  'The ride may also carry the player\'s own sensor readings, each only when its sensor is there: "rider3sWPerKg" and "riderMinuteWPerKg" (their power per kilogram over three seconds and over the last minute), "powerZone" (of their own threshold), "powerTrend" ("rising", "steady" or "fading" over the last minute), "aboveThresholdS" (seconds they have held at or above their threshold), "cadenceRpm", "heartRateBpm", "heartRateZone" and "heartRateTrend" ("rising", "steady" or "falling"). Never assume a reading that is not there.',
  'Coach from what the player is doing right now, specifically and kindly, picking the one thing that matters most, in this order. Held at or above threshold for about a minute or more: suggest easing to recover. A cadence below about seventy on a climb: suggest an easier, lighter gear and a quicker spin, never a bigger or higher gear. Power fading while heart rate holds or climbs: a pacing note, such as settling into an effort they can hold to the top. Heart rate climbing fast: you may name it as effort, as in "your heart rate is climbing, ease a little", never as a health matter. Otherwise, riding steady: encourage them, about the road ahead, the gap or the draft.',
  '"recentLines" are your own last lines. Never repeat one, never start the same way twice in a row, and vary your words: tie each line to this moment, such as the road ahead, the gap, the draft, their legs, their breathing or the finish.',
  '"say" is one short line to the player, at most 80 characters, or "" to say nothing. Never use digits or numbers, units, symbols or emoji. Never name a training metric. Never mention health, medicine, pain, injury or illness. Never mention places or names.',
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
    options: { temperature: PACER_TEMPERATURE, num_predict: PACER_MOST_TOKENS },
    messages: [
      { role: 'system', content: PACER_SYSTEM },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
}
