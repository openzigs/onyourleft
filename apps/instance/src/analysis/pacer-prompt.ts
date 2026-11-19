// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the local model is told, and asked, for one line from the AI pacer**
 * — #2712, ADR 0072 D-3 and D-4, and since #2835 ADR 0083.
 *
 * The request is the tactics call's shape (`tactics-prompt.ts`), for the
 * reasons that file gives: Ollama's own `/api/chat`, **reasoning off**
 * (`think: false`), the answer **held to the schema** by `format`
 * (`@onyourleft/domain` §`modelPacerAnswerSchema`) and read again on arrival,
 * field by field — and **no `tools` field**: one call, no agent loop,
 * nothing the model can call (D-3).
 *
 * ## `pacer-6`: the model writes the line, and only the line (#2835)
 *
 * Until `pacer-5` the model picked the pacer's plan and intent by a table of
 * rules in these words, and wrote a line. On the owner's tablet ride of
 * 2026-11-18 it eased for two and a half minutes and said only that it was
 * *"slowing down"*. Since ADR 0083 **the device decides the intent**
 * (`@onyourleft/domain` §`pacerRuleDecision`) and the state says what the
 * pacer is doing and why, in closed words (`intent`, `byPct`, `reason`,
 * `starting`). So the words here no longer hold a rule table. They:
 *
 * - **state the goal**: a kind training partner who keeps the rider company
 *   and says something useful;
 * - **say what each reason means**, so a line can say **why** — *"easing so
 *   you can get back on"*, never a bare *"slowing down"*;
 * - give **worked examples** of a moment and a good line
 *   ({@link PACER_EXAMPLES}, each held to the screen by `pacer.test.ts`);
 * - explain the **trends** the state carries since #2835 (the gap's drift,
 *   and power, cadence and heart rate against the half minute before);
 * - ask for **no repeat** of the last lines' wording, which the device also
 *   holds: a repeat is not shown.
 *
 * ## The story so far
 *
 * {@link pacerStory} writes one sentence from the state — where the rider is
 * and for how long, how the gap is moving, what the pacer is doing and why,
 * and the road ahead — and it goes before the JSON in the user message. **It
 * is written here, on the instance, from fields the domain has already read
 * from closed lists and number ranges**, so there is no free text a device
 * could put a place or a name into (ADR 0072 D-3.4).
 *
 * The line's rules have not moved: no number but a cadence or power target
 * (ADR 0077), no metric name and no health claim. The line is screened on the
 * instance and again on the device (§`pacerSayProblem`): what the prompt asks
 * is a request, the screen is the rule. Nothing here names a rider, a place
 * or a model (ADR 0031 D-4). {@link PACER_PROMPT_VERSION} is raised with
 * every change to the words.
 */

import {
  modelPacerAnswerSchema,
  type ModelPacerInput,
  type PacerIntent,
  type PacerReason,
} from '@onyourleft/domain';

import { TACTICS_KEEP_ALIVE } from './tactics-prompt.ts';

/** Which prompt this is, for a measurement to name: raised with every change to the words below. */
export const PACER_PROMPT_VERSION = 'pacer-6';

/**
 * The most an answer may write, tokens: **120**. Spike 0039 §7 estimated a
 * plan, an intent and a line at 40 to 60; a line alone is fewer.
 */
export const PACER_MOST_TOKENS = 120;

/**
 * How freely the model picks its words: **0.7**, above 0 so its lines vary
 * (#2760). Measured on the owner's PC on 2026-11-17 against 0.9, on one model
 * and a scripted ride (the pull request for #2760 has the numbers): 0.7 kept
 * the lines tied to what the rider was doing, 0.9 varied them little more.
 */
export const PACER_TEMPERATURE = 0.7;

/** Why the pacer is doing what it does, as the model is told it and as {@link pacerStory} writes it. */
const REASON_WORDS: Readonly<Record<PacerReason, { readonly means: string; readonly to: string }>> =
  {
    'rider-level': {
      means: 'the player is with you, so you hold your pace',
      to: 'because they are with you',
    },
    'rider-behind': {
      means: 'the player has dropped back, so you are easing to let them get back on',
      to: 'so they can get back on',
    },
    'rider-ahead': {
      means: 'the player has pulled away, so you are lifting to come back up to them',
      to: 'to come back up to them',
    },
    'rider-stopped': {
      means: 'the player has stopped behind you, so you are easing right off to wait',
      to: 'to wait for them',
    },
    'before-climb': {
      means:
        'a climb is close and the player is on your wheel, so you are easing to save something for it',
      to: 'to save something for the climb',
    },
    descent: {
      means:
        'you are on a descent with the player on your wheel, so you are lifting to carry speed',
      to: 'to carry speed down the descent',
    },
    'over-the-top': {
      means:
        'a climb has just ended with the player on your wheel, so you are lifting over the top',
      to: 'to carry speed over the top',
    },
  };

/**
 * **Worked examples: a moment, and a good line for it** (#2835). In the
 * prompt as they are here. `pacer.test.ts` holds every line to the screen
 * (`pacerSayProblem`) and to its intent (`pacerSayAgainstRidden`), so an
 * example cannot teach the model a line the device would hide.
 */
export const PACER_EXAMPLES: readonly {
  readonly moment: string;
  readonly intent: PacerIntent;
  readonly line: string;
}[] = [
  {
    moment:
      'The player has been behind for a while and is closing; you are easing ("rider-behind")',
    intent: 'ease',
    line: 'Easing so you can get back on, you are nearly here.',
  },
  {
    moment: 'The player is on your wheel and a climb starts soon; you are easing ("before-climb")',
    intent: 'ease',
    line: 'Climb coming, easing a touch so we take it together.',
  },
  {
    moment:
      'The player is level and you are holding ("rider-level"); their cadence has dropped on a climb',
    intent: 'hold',
    line: 'Legs are slowing, spin a little quicker, aim for 85 rpm.',
  },
];

/** What the model is told, once per call, before the pacer's state. */
export const PACER_SYSTEM = [
  'You are the pacer in a cycling video game: a computer rider the player rides with on an indoor trainer. Your goal is to be a kind training partner: keep the player company, and say something useful about this moment of the ride.',
  'Every few seconds you get the ride, and you answer with one short line to the player. You do not choose how you ride: the game has already decided it and tells you. "intent" is what you are doing now: "hold" rides your steady pace, "lift" goes harder, "ease" goes easier. "byPct" is by how many percent. "reason" is why:',
  ...Object.entries(REASON_WORDS).map(([reason, words]) => `- "${reason}": ${words.means}.`),
  '"starting" true means the ride has only just begun and you are easing yourself in over the first minute, so the player is not left at the line.',
  'Before the JSON you get one line that starts "Story so far:", written by the game: where the player is and for how long, how the gap is moving, what you are doing and why, and the road ahead. Trust it.',
  'The JSON is the ride in full. "riderGapM" is the metres the player is ahead of you: above 0 they are in front of you, below 0 they are behind you; "gapS" is the same gap in seconds. "riderPlace" says it in a word, "ahead", "level" or "behind", and "placeForS" for how many seconds. "gapTrend" says how the gap moved in the last few seconds for the player, "rider-gaining", "steady" or "rider-losing", and "gapDriftM" is the metres they gained on you over the last half minute, below 0 when they lost them.',
  '"course" is the road ahead of you: "climb" and "descent" are the next climb and descent, each 3 % or steeper for 200 m or more, or null: "inM" to its start, "lengthM", "avgPct" and the steepest "maxPct". "climbLeftM" is the climbing left to the finish or, on a loop, in this lap ("lapLeftM").',
  'The ride may also carry the player\'s own sensor readings, each only when its sensor is there: "rider3sWPerKg" and "riderMinuteWPerKg" (their power per kilogram over three seconds and over the last minute), "powerZone" (of their own threshold), "powerTrend" ("rising", "steady" or "fading" over the last minute), "aboveThresholdS" (seconds they have held at or above their threshold), "cadenceRpm", "heartRateBpm", "heartRateZone" and "heartRateTrend" ("rising", "steady" or "falling"). "powerDriftPct", "cadenceDriftRpm" and "heartRateDriftBpm" say how far each has moved against the half minute before: below 0 it is dropping. Never assume a reading that is not there.',
  'Write the one line that matters most right now, and make it about what has changed. Either say what you are doing and why, in plain words, such as "Easing so you can get back on" or "Lifting to come back up to you": never a bare "slowing down" or "speeding up" with no reason. Or coach the player from what they are doing, specifically and kindly, in this order. Held at or above threshold for about a minute or more: suggest easing to recover. A cadence below about seventy on a climb, or one that is dropping: suggest an easier, lighter gear and a quicker spin, never a bigger or higher gear. Power fading while heart rate holds or climbs: a pacing note, such as settling into an effort they can hold to the top. Heart rate climbing fast: you may name it as effort, as in "your heart rate is climbing, ease a little", never as a health matter. Otherwise, riding steady: encourage them, about the road ahead, the gap or the draft.',
  'If the line says what you are doing, it must agree with "intent": that you are pushing, lifting, chasing or coming past only with "lift"; that you are easing, slowing or waiting only with "ease"; neither with "hold". Advice to the player, such as "ease a little", is not about you and is always allowed. A line that disagrees with what you are doing is not shown.',
  'Examples of a moment and a good line for it:',
  ...PACER_EXAMPLES.map((example) => `- ${example.moment}: "${example.line}"`),
  '"recentLines" are your own last lines. Never repeat one, never start the same way twice in a row, and do not reuse their wording: tie each line to this moment. A repeated line is not shown.',
  '"say" is one short line to the player, at most 80 characters, or "" to say nothing. When it helps, you may give a cadence target in rpm or a power target in watts or W/kg, from the player\'s own readings, in digits with the unit straight after, such as "aim for 90 rpm", "hold around 200 watts" or "try 3 W/kg". Never write any other number, in digits or in words: no heart rate, time, distance (not the gap, not the road ahead, nothing from the story), speed, zone or percentage. Never use other units, symbols or emoji. Never name a training metric. Never mention health, medicine, pain, injury or illness. Never mention places or names.',
  'Answer with JSON only, in the schema given.',
].join('\n');

/** A gap this small over the half minute, metres, is the gap holding: **3**. */
const STORY_STEADY_M = 3;

/** A climb further off than this, metres, is not in the story yet: **1 000**. */
const STORY_CLIMB_WITHIN_M = 1_000;

/** How the gap is moving, in the player's terms, or `undefined` when the state does not say. */
function gapMoving(input: ModelPacerInput): string | undefined {
  const { riderPlace: place, gapDriftM: drift, gapTrend: trend } = input;
  const gained =
    drift !== undefined
      ? drift > STORY_STEADY_M
        ? 1
        : drift < -STORY_STEADY_M
          ? -1
          : 0
      : trend === undefined
        ? undefined
        : trend === 'rider-gaining'
          ? 1
          : trend === 'rider-losing'
            ? -1
            : 0;
  if (gained === undefined || place === undefined) return undefined;
  if (gained === 0) return 'the gap is holding';
  if (place === 'behind') return gained > 0 ? 'they are closing' : 'they are dropping back';
  if (place === 'ahead')
    return gained > 0 ? 'they are pulling away' : 'they are coming back to you';
  return gained > 0 ? 'they are edging ahead' : 'they are slipping back';
}

/** Where the player is and for how long. */
function placed(input: ModelPacerInput): string {
  const { riderPlace: place, gapS, placeForS } = input;
  if (place === undefined) return 'the player is at a standstill';
  const held = placeForS !== undefined && placeForS > 0;
  if (place === 'level') {
    return `the player is level with you${held ? `, and has been for ${String(placeForS)} s` : ''}`;
  }
  const by = gapS === undefined ? '' : ` by ${String(Math.abs(gapS))} s`;
  return `the player is ${place === 'ahead' ? 'ahead of' : 'behind'} you${by}${
    held ? `, and has been ${place} for ${String(placeForS)} s` : ''
  }`;
}

/** What the pacer is doing and why. */
function doing(input: ModelPacerInput): string {
  const why = REASON_WORDS[input.reason].to;
  const start = input.starting ? ', and still easing yourself in at the start of the ride' : '';
  if (input.intent === 'hold') return `you are holding your pace ${why}${start}`;
  const verb = input.intent === 'ease' ? 'easing' : 'lifting';
  return `you are ${verb} by ${String(input.byPct)} % ${why}${start}`;
}

/** The road ahead worth a word: a climb within reach, or the hill the pacer is on. */
function road(input: ModelPacerInput): string | undefined {
  const { course } = input;
  if (course === undefined) return undefined;
  if (course.climb !== null && course.climb.inM === 0) return 'you are on a climb';
  if (course.descent !== null && course.descent.inM === 0) return 'you are on a descent';
  if (course.climb !== null && course.climb.inM <= STORY_CLIMB_WITHIN_M) {
    return `a climb starts in ${String(course.climb.inM)} m`;
  }
  return undefined;
}

/**
 * **The story so far**, one sentence the model reads before the state
 * (#2835): where the player is and for how long, how the gap is moving, what
 * the pacer is doing and why, and the road ahead. Closed words and numbers
 * only, every one from a field `readModelPacerInput` has already read.
 */
export function pacerStory(input: ModelPacerInput): string {
  const parts = [placed(input), gapMoving(input), doing(input), road(input)];
  return `Story so far: ${parts.filter((part) => part !== undefined).join('; ')}.`;
}

/**
 * A fixed pacer state, with nothing of any rider's in it: what the warm-up
 * sends (#2835), so the model is loaded and has read {@link PACER_SYSTEM} —
 * the pacer's own prompt prefix — before a ride's first ask.
 */
export const PACER_WARM_UP_INPUT: ModelPacerInput = {
  pacerWPerKg: 2.5,
  plan: 'rolling',
  intent: 'hold',
  secondsInIntent: 0,
  reason: 'rider-level',
  byPct: 0,
  starting: true,
  riderGapM: 0,
  riderWPerKg: null,
  riderInDraft: false,
  gradeAheadPct: 0,
  toFinishM: null,
  rideS: 0,
};

/**
 * The `/api/chat` body for one line on `input` by `model`. No `tools` field,
 * reasoning off, the answer held to the pacer schema. The user message is the
 * story, then the state as JSON less its `plan`: the device rides one plan
 * (#2835), so it is nothing the model can use.
 */
export function pacerRequest(
  model: string,
  input: ModelPacerInput,
  mostTokens = PACER_MOST_TOKENS,
): Readonly<Record<string, unknown>> {
  const shown = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'plan'));
  return {
    model,
    stream: false,
    think: false,
    format: modelPacerAnswerSchema(),
    keep_alive: TACTICS_KEEP_ALIVE,
    options: { temperature: PACER_TEMPERATURE, num_predict: mostTokens },
    messages: [
      { role: 'system', content: PACER_SYSTEM },
      { role: 'user', content: `${pacerStory(input)}\n${JSON.stringify(shown)}` },
    ],
  };
}
