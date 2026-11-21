// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the local model is told, and asked, for one bot's tactics** —
 * #2709, ADR 0071 D-3 and D-5.7, ADR 0073 D-5 (#2710), and since #2836 ADR
 * 0081: one bot a call, picking from a menu the device made.
 *
 * ## `tactics-8` (#2836, ADR 0081 D-4)
 *
 * `tactics-7` asked for every bot's move at once and said *"Most bots sit in
 * most of the time"*. On the owner's race of 2026-11-18 the model answered
 * `sit-in` for five of seven bots in all 32 answers. So the words are new:
 *
 * - **the goal is stated**: a lively, believable race for the human, and a
 *   race where nothing happens is a failure; the sentence about sitting in is
 *   gone;
 * - **one bot a call**: the race is shared and short, and the bot's own part
 *   comes last with its **cue words** and its **menu**, which the device
 *   worked out (`@onyourleft/domain` §`modelTacticsOffer`). The words say
 *   what each cue means; the model picks from the menu and nowhere else;
 * - **a "story so far" line**, written here from the numbers and closed words
 *   the device sent (`@onyourleft/domain` §`modelTacticsStoryLine`);
 * - **the seconds since the bot last made a move** come before its current
 *   move, so the model reads how long it has waited, not what it answered
 *   last time;
 * - **a reason word first** in the answer, from a closed list, and **no
 *   effort on `sit-in` or `recover`**, which the schema holds it to
 *   (`modelTacticsAnswerSchema`);
 * - **four worked examples**, four bots of different styles in one race, each
 *   doing a different thing true to its style.
 *
 * Still guidance and not rules (ADR 0073 D-5.4): what each move, style and
 * cue is for, and plainly what spending W′ costs. {@link TACTICS_PROMPT_VERSION}
 * is raised with every change to its words. Nothing in it names a rider, a
 * place or a model (ADR 0031 D-4).
 *
 * ## Shared first, the bot last (ADR 0081 D-2.4)
 *
 * {@link tacticsUserContent} writes three lines in a fixed order: the race,
 * the story, then the bot. The system text and the start of the race line are
 * the same from one call to the next, so a model server that keeps the start
 * of its last prompt reads only what changed. It is written from the ask
 * **after** it was read field by field (`tactics.ts`), key by key in an order
 * fixed here, so neither a key nor an order a device chose reaches the model.
 *
 * The request is Ollama's own `/api/chat` (spike 0039 §2), because it is the
 * one spelling the spike measured of the two rules a tactics call needs:
 *
 * - **Reasoning off**: `think: false` (D-5.7). With it on, 3 of 3 spike calls
 *   spent every output token and returned no decision.
 * - **Held to the schema** by `format`, the answer's JSON Schema for the
 *   bot's menu, and read again on arrival, field by field (`tactics.ts`).
 *
 * And **no `tools` field** (D-3.3): one call, no agent loop, nothing the model
 * can call. A local server that is not Ollama answers it 404, and the race
 * rides seeded tactics (D-7).
 */

import {
  modelTacticsAnswerSchema,
  modelTacticsStoryLine,
  type ModelTacticsInput,
} from '@onyourleft/domain';

/** Which prompt this is, for a measurement to name: raised with every change to the words below. */
export const TACTICS_PROMPT_VERSION = 'tactics-8';

/**
 * The most a decision may write, tokens: **48** (#2836, ADR 0081 D-2; 256 for
 * a whole field's answer until `tactics-8`). The longest answer the schema
 * admits, a reason, a move and an effort, is 59 characters; at the 0.38
 * tokens a character #2759 measured under a schema that is 23 tokens, and 48
 * is that twice over. Five answers of a reason and a move, measured from
 * gemma4:12b on a Mac on 2026-11-18, were 12 to 15 tokens. A model that
 * writes past it has written no decision.
 */
export const TACTICS_MOST_TOKENS = 48;

/** How long the model stays loaded after a call: spike 0039's 30 minutes, so a race never reloads it. */
export const TACTICS_KEEP_ALIVE = '30m';

/** What the model is told, once per call, before the race: `tactics-8`. See the file comment. */
export const TACTICS_SYSTEM = [
  'You are the racing brain of ONE computer-controlled rider (a "bot") in a cycling lap race in a video game. A human is racing against the bots.',
  'The goal is a lively, believable race for the human: attacks, breakaways, chases and counter-attacks, made by different bots at different times, each true to its style. A race where nothing happens is a failure.',
  'Each call is about one bot. You get three lines: "Race" is the race as JSON; "Story so far" is what has happened; "You" is the bot you decide for now, as JSON. You answer with one move for that bot. It is ridden for the next few seconds, and you are asked about the bot again soon.',
  '"You" ends with "cues" and "menu". The menu is the moves that make sense for this bot right now: pick one of them. The cues say what the bot can see:',
  '- "on-your-terrain": this is where the bot\'s style pays: a climber on a climb, a rouleur or a breakaway rider on the flat or a descent, a sprinter near the finish, an opportunist just after a move was caught. This is its moment to move.',
  '- "climb-soon": a climb starts soon. A climber gets ready for it; the others save something.',
  '- "fresh": the bot has plenty in reserve. "tiring": its reserve is low.',
  '- "move-ahead": the racer just ahead is making a move. Cover it, or let it go.',
  '- "move-just-caught": an attack has just ended. This is the moment for a counter-attack.',
  '- "race-quiet": nobody has attacked for a while. Somebody should.',
  '- "last-lap" and "finish-near": the race is nearly over, and nothing is worth saving.',
  'The moves:',
  '- "attack": a hard surge to get clear or to break a group.',
  '- "flyer": a long, steady effort off the front: a breakaway.',
  '- "chase": bridge the gap, hard, to the racer the menu names in "target".',
  '- "follow": go with the move of the racer in "target" and hold the wheel.',
  '- "kick": the all-out sprint for the line.',
  '- "recover": ease off to refill the reserve.',
  '- "sit-in": no move now. The bot rides on the wheels and its own instincts decide. Choose it to save the legs for a better moment, never out of habit.',
  '"sinceMoveS" is the seconds since this bot last made a move of its own, or null when it has made none yet. A bot that has waited a long time and is on its terrain should go. A bot in a move ("move", "secondsInMove") may hold it: an attack lasts 10 to 30 seconds and a flyer 30 to 90, and then the bot sits in or is caught.',
  'The body has limits, and they are real. "wbal" is the share of the bot\'s reserve left, from 1 (full) to 0 (empty). Every hard move spends it, and it refills only while the bot rides easy. A bot that empties it is dropped. "flat", "climb", "sprint" and "punch" say how the bot compares with the other bots: "strong", "average" or "weak".',
  'Styles ("style"): a "breakaway" rider attacks and goes up the road on a flyer; a "sprinter" sits on wheels, covers moves, and kicks; a "climber" attacks on the climbs; a "rouleur" rides hard on the flat and chases moves down; an "opportunist" follows moves and counter-attacks when one is caught.',
  'In "Race": "field" is every bot, with its style, its place ("rank"), its move and the metres to the racer ahead; "rider" is the human; "course" is the road ahead of the leading bot: the next "climb" and "descent" (or null), the metres and the climbing left in the lap, and "finishPct", the grade of the last 500 m.',
  'Answer with JSON only. First "reason", why: "my-terrain", "cover-move", "counter", "save-legs" or "finish-near". Then "move", one from the menu. Any move but "sit-in" and "recover" may add "effort", how hard to ride it: "easy", "tempo", "threshold" or "all-out". Leave it out to ride the move as it is; an attack is hard whatever the effort.',
  'Examples: four bots in one race, each doing what suits it.',
  '- A climber, "sinceMoveS" 95, cues ["on-your-terrain","fresh"], menu attack, sit-in: {"reason":"my-terrain","move":"attack","effort":"all-out"}',
  '- A sprinter, cues ["move-ahead"], menu follow, sit-in. The move ahead could win the race: {"reason":"cover-move","move":"follow"}',
  '- An opportunist, cues ["on-your-terrain","fresh","move-just-caught"], menu attack, sit-in: {"reason":"counter","move":"attack"}',
  '- A rouleur, cues ["tiring","move-ahead"], menu follow, recover, sit-in. It is tiring and cannot hold that move: {"reason":"save-legs","move":"recover"}',
].join('\n');

/**
 * The race the warm-up call asks about (ADR 0071 D-6.5): two bots on the line
 * of a three-lap race, the first asked about. Fixed, so **nothing of the
 * rider's is in it**, and of the same shape as every decision, so the model
 * is loaded and its system text read before the first real one.
 */
export const WARM_UP_INPUT: ModelTacticsInput = {
  laps: 3,
  // #2794: a flat lap with nothing ahead, so the warm-up reads the course's shape too.
  course: { climb: null, descent: null, lapLeftM: 600, lapClimbM: 0, finishPct: 0 },
  rider: { rank: 2, wPerKg: null, ahead: 0, gapAheadM: 1, gapBehindM: 1, drafting: true },
  field: [
    { bot: 0, style: 'rouleur', rank: 1, move: 'sit-in', gapAheadM: null },
    { bot: 1, style: 'sprinter', rank: 3, move: 'sit-in', gapAheadM: 1 },
  ],
  story: { raceS: 0, lapsLeft: 3, quietS: 0, moved: false, away: null, bunch: 'fresh' },
  you: {
    bot: 0,
    style: 'rouleur',
    flat: 'strong',
    climb: 'average',
    sprint: 'weak',
    punch: 'weak',
    sinceMoveS: null,
    move: 'sit-in',
    secondsInMove: 0,
    rank: 1,
    gapAheadM: null,
    gapBehindM: 1,
    riderGapM: -1,
    wbal: 1,
    drafting: false,
    lapsLeft: 3,
    toLineM: 1_800,
    gradeAheadPct: 0,
    climbInM: null,
    cues: ['on-your-terrain', 'fresh'],
    menu: [{ move: 'attack' }, { move: 'sit-in' }],
  },
};

/**
 * What the model reads of one ask: the race, the story so far, then the bot,
 * each on its own line. Written key by key from an ask already read field by
 * field, in the order fixed here. See the file comment.
 */
export function tacticsUserContent(input: ModelTacticsInput): string {
  const { rider, you } = input;
  const race = {
    laps: input.laps,
    ...(input.course === undefined
      ? {}
      : {
          course: {
            climb: input.course.climb,
            descent: input.course.descent,
            lapLeftM: input.course.lapLeftM,
            lapClimbM: input.course.lapClimbM,
            finishPct: input.course.finishPct,
          },
        }),
    rider: {
      rank: rider.rank,
      wPerKg: rider.wPerKg,
      ahead: rider.ahead,
      gapAheadM: rider.gapAheadM,
      gapBehindM: rider.gapBehindM,
      drafting: rider.drafting,
    },
    field: input.field.map((each) => ({
      bot: each.bot,
      style: each.style,
      rank: each.rank,
      move: each.move,
      gapAheadM: each.gapAheadM,
    })),
  };
  const bot = {
    bot: you.bot,
    style: you.style,
    flat: you.flat,
    climb: you.climb,
    sprint: you.sprint,
    punch: you.punch,
    sinceMoveS: you.sinceMoveS,
    move: you.move,
    secondsInMove: you.secondsInMove,
    rank: you.rank,
    gapAheadM: you.gapAheadM,
    gapBehindM: you.gapBehindM,
    riderGapM: you.riderGapM,
    wbal: you.wbal,
    drafting: you.drafting,
    lapsLeft: you.lapsLeft,
    toLineM: you.toLineM,
    gradeAheadPct: you.gradeAheadPct,
    climbInM: you.climbInM,
    cues: [...you.cues],
    menu: you.menu.map((entry) => ({
      move: entry.move,
      ...(entry.target === undefined ? {} : { target: entry.target }),
    })),
  };
  return [
    `Race: ${JSON.stringify(race)}`,
    `Story so far: ${modelTacticsStoryLine(input.story)}`,
    `You: ${JSON.stringify(bot)}`,
  ].join('\n');
}

/**
 * The `/api/chat` body for one decision on `input` by `model`, writing at
 * most `mostTokens`. No `tools` field, reasoning off, the answer held to the
 * schema of the bot's menu.
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
    format: modelTacticsAnswerSchema(input.you.menu),
    keep_alive: TACTICS_KEEP_ALIVE,
    options: { temperature: 0.6, num_predict: mostTokens },
    messages: [
      { role: 'system', content: TACTICS_SYSTEM },
      { role: 'user', content: tacticsUserContent(input) },
    ],
  };
}
