// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the local model is told, and asked, for one bot-tactics decision** —
 * #2709, ADR 0071 D-3 and D-5.7, and ADR 0073 D-5 (#2710).
 *
 * The prompt is spike 0039's as #2720 wrote it for ADR 0073
 * (`apps/web/tools/model-tactics-spike/ollama.ts` §`MODEL_TACTICS_SYSTEM`):
 * **guidance, not rules**. The strategy is the model's, so it says what each
 * move and racing style is for and, plainly, what spending W′ costs, and it
 * gives no condition a move must meet and no attack gate (D-5.3, D-5.4). One
 * sentence is #2710's own: the effort (D-2.5). #2710 measured four sentences
 * about the finish (ADR 0073 R-5) and kept none: gemma4:12b answered each
 * bot's current `move` back whatever they said. Three are #2759's (ADR 0076
 * D-4 and D-6), still guidance: what the strength words mean, that an attack
 * is a hard effort, and that riders attack where their strengths pay and let
 * a stronger rival go.
 * {@link TACTICS_PROMPT_VERSION} is raised with every change to its words.
 * The answer is asked for **with a target again** (D-3.4: a `follow` or
 * `chase` may name any racer) and an optional effort.
 * Nothing in it names a rider, a place or a model (ADR 0031 D-4).
 *
 * The request is Ollama's own `/api/chat` (spike 0039 §2), because it is the
 * one spelling the spike measured of the two rules a tactics call needs:
 *
 * - **Reasoning off**: `think: false` (D-5.7). With it on, 3 of 3 spike calls
 *   spent every output token and returned no decision.
 * - **Held to the schema** by `format`, the answer's JSON Schema with its
 *   target and effort (`@onyourleft/domain` §`modelTacticsAnswerSchema`), and
 *   read again on arrival, field by field (`tactics.ts`).
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
export const TACTICS_PROMPT_VERSION = 'tactics-5';

/** The most a decision may write, tokens: seven moves with targets are about 150 (spike 0039: 73 typical). */
export const TACTICS_MOST_TOKENS = 400;

/** How long the model stays loaded after a call: spike 0039's 30 minutes, so a race never reloads it. */
export const TACTICS_KEEP_ALIVE = '30m';

/**
 * What the model is told, once per call, before the race: spike 0039's #2720
 * words under ADR 0073 (guidance, not rules), with #2710's sentence on the
 * effort.
 */
export const TACTICS_SYSTEM = [
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
  'Each move may also carry an "effort", how hard the bot rides it: "easy", "tempo", "threshold" or "all-out". Leave it out to ride the move as it is. An effort changes nothing on "sit-in" or "follow" behind a wheel, or on "recover". "all-out" spends "wbal" fastest; "easy" and "tempo" save it.',
  'Attacks are hard, as they are in a real race: ride an "attack" or a "chase" at "threshold" or "all-out", a "flyer" at "threshold", and a "kick" "all-out". An attack at "easy" or "tempo" is no attack. "easy" and "tempo" are for riding on the front or saving energy.',
  'Every bot has its own body. "flat", "climb", "sprint" and "punch" say how it compares with the other bots: "strong", "average" or "weak". "flat" is its power on the flat, "climb" its power for its weight on a climb, "sprint" its speed in a sprint, and "punch" how much it can spend above its steady pace before it blows.',
  'Race to the strengths, as real riders do. Attack where the bot is strong and its rivals are not: a strong climber where "gradeAheadPct" is 3 or more, a strong rouleur or breakaway rider on the flat, a sprinter only at the finish. When a strong rival attacks where a bot is weak, that bot usually lets it go and rides its own pace rather than blow up chasing; a bot as strong covers the move with "follow", or chases it down. A bot that goes too hard for too long empties "wbal", is dropped and loses; a well-timed attack wins the race.',
  'Styles ("style"): a "breakaway" rider attacks and goes up the road on a flyer once or twice a race and sits in between; a "sprinter" sits on wheels, saves everything, and kicks; a "climber" attacks on the climbs; a "rouleur" rides hard on the flat and chases down a move that has been away a while, naming it in "target"; an "opportunist" follows other bots\' moves and counter-attacks when a move is caught. "legs" is what the bot\'s body is good at, and its style and strengths go with it.',
  '"rider" is the human racing the bots, and each bot\'s "riderGapM" is how far the rider is ahead of it (below 0, behind). Bots may mark the rider, sit on the rider\'s wheel, or attack when the rider is tired. "quietS" is how long since any bot attacked or went on a flyer.',
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
  rider: { rank: 2, wPerKg: null, ahead: 0, gapAheadM: 0.5, gapBehindM: 0.5, drafting: true },
  bots: [0, 1].map((seat) => ({
    bot: seat,
    style: seat === 0 ? 'rouleur' : 'sprinter',
    legs: seat === 0 ? 'rouleur' : 'sprinter',
    flat: seat === 0 ? 'strong' : 'average',
    climb: 'average',
    sprint: seat === 0 ? 'weak' : 'strong',
    punch: seat === 0 ? 'weak' : 'strong',
    rank: seat === 0 ? 1 : 3,
    ahead: seat === 0 ? null : 'rider',
    aheadMove: null,
    gapAheadM: seat === 0 ? null : 0.5,
    gapBehindM: seat === 0 ? 0.5 : null,
    wbal: 1,
    blown: false,
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
    format: modelTacticsAnswerSchema(modelTacticsSeats(input)),
    keep_alive: TACTICS_KEEP_ALIVE,
    options: { temperature: 0.6, num_predict: mostTokens },
    messages: [
      { role: 'system', content: TACTICS_SYSTEM },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
}
