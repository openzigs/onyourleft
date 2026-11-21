// SPDX-License-Identifier: Apache-2.0

/**
 * **A language model's lap-race bot tactics: what it is shown and what it may
 * answer** — #2709, ADR 0071 D-3, and since #2836 (ADR 0081) **one bot at a
 * time, from a menu the device makes**.
 *
 * Both halves are checked twice: the instance checks the ask it is sent
 * before a model sees it, and the answer before it returns it; the device
 * checks the answer again on arrival (ADR 0071 D-3.2). Both read this one
 * module, so the two checks cannot drift apart.
 *
 * ## The race, read off in full on the device
 *
 * {@link ModelTacticsRace}: spike 0039's shape (ADR 0071 D-3.4) as ADR 0073
 * D-5 widened it (#2720, #2710) — seats, racing styles dealt from the seed
 * ({@link modelRacingStyles}), how each bot compares
 * with the field on the flat, a climb, a sprint and in punch (#2759, ADR 0076
 * D-4: {@link MODEL_STRENGTH_WORDS}), ranks, gaps, W′ shares
 * and whether a bot is blown, drafting, current moves, laps and metres to the
 * line as each bot misreads it, launch distance, grade ahead, the rider's gap,
 * and the rider's own state: rank, W/kg, who is ahead of them, their gaps and
 * whether they draft. There is no code-computed attack gate (D-5.3).
 * **The course ahead (#2794):** once for the race, from the leading bot, the
 * next climb and the next descent, the lap's metres and climbing left, and
 * the grade of the last 500 m to the line ({@link ModelTacticsCourse}, by
 * `route/course-ahead.ts`'s stated thresholds), so a bot can plan for a hill
 * it cannot yet feel. Until #2836 this whole race was what the model was sent,
 * and it answered for every bot at once; it is now what an ask is made from.
 *
 * ## What the model is shown: one bot's ask (#2836, ADR 0081 D-2)
 *
 * On the owner's race of 2026-11-18 five of seven bots were answered `sit-in`
 * in every one of 32 answers: asked for the whole field at once, the model
 * gave most of it the safe move. So {@link modelTacticsAsk} makes
 * {@link ModelTacticsInput} for ONE bot: the shared race first (laps, the
 * course ahead, the rider, every racing bot in five fields, and the
 * {@link ModelTacticsStory story so far}), and the bot's own part last
 * ({@link ModelTacticsYou}), which ends with its **cue words**
 * ({@link MODEL_TACTICS_CUES}) and the **menu**: the two to four moves the
 * device worked out are sensible for it now ({@link modelTacticsOffer}), from
 * its style, the terrain, its energy and its place. The model picks from that
 * menu and nowhere else.
 * **Every field is a number, a boolean, or a word from a closed list**: there
 * is no field a coordinate, a place name, a rider's name, a date or an
 * identifier could be written into as text, and {@link readModelTacticsInput}
 * refuses any key it does not name. A problem names the field and the rule,
 * never the value (ADR 0004 D).
 *
 * ## What the model may answer
 *
 * `{"reason":<one of five>,"move":<one on the menu>,"effort"?:<one of four>}`
 * and nothing else: the reason word first (ADR 0081 D-3), so the model says
 * why before it says what. **There is no power field**, nor any number at
 * all (D-3.1); the effort is a word from a closed list (ADR 0073 D-2.5), and
 * the schema offers none on `sit-in` or `recover`, which read none.
 * {@link readModelTacticsAnswer} reads it field by field: a key the schema
 * does not name makes the whole answer invalid, so a model that writes
 * `"watts": 900` has said nothing; so does a reason outside the five, a move
 * outside the seven or off the menu, text that is not JSON, or an answer
 * longer than {@link MODEL_TACTICS_ANSWER_MOST_CHARACTERS} (D-3.2). The
 * target of a `follow` or `chase` is the menu's, never the model's.
 *
 * Written fresh for #2709 (ADR 0071 D-8.7): the spike's AGPL copy under
 * `apps/web/tools/model-tactics-spike/` is not moved.
 */

import { isCourseHill, type CourseHill } from '../route/course-ahead';
import { nextUnit, raceRandom } from './random';
import {
  BOT_EFFORTS,
  BOT_TACTIC_BRIDGE_METRES,
  BOT_TACTIC_CLIMB_GRADE_PERCENT,
  BOT_TACTIC_FLYER_LAPS,
  BOT_TACTIC_FLYER_WBAL_SHARE,
  BOT_TACTIC_FOLLOW_METRES,
  BOT_TACTIC_RECOVER_SHARE,
  BOT_TACTIC_WBAL_FLOOR,
  BOT_TACTIC_WHEEL_METRES,
  BOT_TACTICS,
  type BotEffort,
  type BotTactic,
} from './tactics';

/**
 * The most bots a model race has: **7**, the lap race's own most
 * (`apps/web` §`LAP_RACE_MOST_BOTS`), so seats run 0 to 6.
 */
export const MODEL_TACTICS_MOST_SEATS = 7;

/**
 * The longest answer read, characters: **8 192**, spike 0039's figure (ADR
 * 0071 D-3.2). One bot's pick is under 70 characters; anything near this is
 * not a decision.
 */
export const MODEL_TACTICS_ANSWER_MOST_CHARACTERS = 8_192;

/**
 * The longest ask accepted, characters of its JSON: **4 096**. One bot's ask
 * in a field of seven is about 1 300 characters.
 */
export const MODEL_TACTICS_INPUT_MOST_CHARACTERS = 4_096;

/**
 * **The racing styles a bot is dealt** (ADR 0073 D-5.1): how it likes to race,
 * apart from what its legs are good at. A `sprinter` is a wheel-sitter who
 * waits for the line; the instance's prompt says what each of the others does.
 */
export const MODEL_RACING_STYLES = [
  'breakaway',
  'sprinter',
  'climber',
  'rouleur',
  'opportunist',
] as const;

/** One of {@link MODEL_RACING_STYLES}. */
export type ModelRacingStyle = (typeof MODEL_RACING_STYLES)[number];

/** What the styles' deal mixes into the race's seed, so it draws apart from every other draw. */
const STYLE_SALT = 0x5717_1e5d;

/**
 * Each of `count` seats its racing style, dealt from the race's `seed` (ADR
 * 0073 D-5.1): every style once before any twice, in an order the seed
 * shuffles, so a field of seven holds all five and the same seed deals the
 * same field. ADR 0073 dealt it apart from the bots' archetypes (D-9 R-4);
 * since #2759 (ADR 0076 D-3) a race with AI bots deals each bot the pace and
 * body its style fits on these styles (`model-field.ts` §`modelFieldPaces`).
 */
export function modelRacingStyles(seed: number, count: number): readonly ModelRacingStyle[] {
  const deck = Array.from(
    { length: count },
    (_, at) => MODEL_RACING_STYLES[at % MODEL_RACING_STYLES.length] as ModelRacingStyle,
  );
  let random = raceRandom((raceRandom(seed).state ^ STYLE_SALT) >>> 0);
  // A Fisher–Yates shuffle from the seeded generator.
  for (let at = deck.length - 1; at > 0; at -= 1) {
    const drawn = nextUnit(random);
    random = drawn.next;
    const swap = Math.floor(drawn.value * (at + 1));
    [deck[at], deck[swap]] = [deck[swap] as ModelRacingStyle, deck[at] as ModelRacingStyle];
  }
  return deck;
}

/**
 * **How a bot compares with the rest of its field**, in plain words (#2759,
 * ADR 0076 D-4): on the flat, on a climb, in a sprint and in its punch, each
 * one of these. `model-field.ts` §`modelFieldStrengths` says which.
 */
export const MODEL_STRENGTH_WORDS = ['weak', 'average', 'strong'] as const;

/** One of {@link MODEL_STRENGTH_WORDS}. */
export type ModelStrengthWord = (typeof MODEL_STRENGTH_WORDS)[number];

/** The most laps an ask may say: far over the app's ten. */
const MOST_LAPS = 100;
/** The largest distance an ask may say, metres: a loop of 1 000 km. */
const MOST_METRES = 1_000_000;
/** The highest W/kg an ask may say: well over any rider's. */
const MOST_WATTS_PER_KILOGRAM = 40;
/** The most seconds an ask may say: a day. */
const MOST_SECONDS = 86_400;

/** One bot, read off the race in full: what its ask is made from. */
export interface ModelTacticsBotView {
  /** The bot's seat, from 0: its place in the ride's bots. */
  readonly bot: number;
  /**
   * How it likes to race, dealt from the race's seed (ADR 0073 D-5.1). Since
   * ADR 0076 D-3 it also decides the bot's legs, its archetype, which is
   * therefore not sent (D-11).
   */
  readonly style: ModelRacingStyle;
  /** Beside the rest of the field, on the flat: its watts at threshold (ADR 0076 D-4). */
  readonly flat: ModelStrengthWord;
  /** Beside the rest of the field, on a climb: its watts per kilogram at threshold. */
  readonly climb: ModelStrengthWord;
  /** Beside the rest of the field, in a sprint: its peak watts. */
  readonly sprint: ModelStrengthWord;
  /** Beside the rest of the field, its punch: how much it can spend above threshold (W′). */
  readonly punch: ModelStrengthWord;
  /** Its place in the race, from 1. */
  readonly rank: number;
  /** Who is directly ahead: `"rider"`, another bot's seat, or `null` when it leads (#2708). */
  readonly ahead: 'rider' | number | null;
  /** The move of the bot directly ahead, or `null` when that is the rider or nobody (#2708). */
  readonly aheadMove: BotTactic | null;
  /** Metres to the racer directly ahead, or `null` when it leads: whole metres from the device. */
  readonly gapAheadM: number | null;
  /** Metres to the racer directly behind, or `null` when it is last: whole metres from the device. */
  readonly gapBehindM: number | null;
  /** Its W′ balance as a share of its W′, 0 to 1: to a tenth from the device. */
  readonly wbal: number;
  /** Whether it is blown (ADR 0073 D-5.4): its W′ ran out, and it rides no harder than CP until it has refilled. */
  readonly blown: boolean;
  readonly drafting: boolean;
  /** The move it is riding now. */
  readonly move: BotTactic;
  /** Whole seconds it has held {@link move}, 0 on the line (#2708). */
  readonly secondsInMove: number;
  readonly lapsLeft: number;
  /**
   * Metres to the finish line **as the bot reads them** (ADR 0073 D-3.5): the
   * true distance plus its skill's misjudgement for the window
   * (`archetype.ts` §`botTacticsMisjudgement`), the reading seeded
   * `decideTactic` launches on.
   */
  readonly toLineM: number;
  /** Where its legs would usually launch the sprint, metres to the line: a guide, not a rule (D-3.5). */
  readonly launchM: number;
  /** The grade 50 m up the road, percent: a whole percent from the device. */
  readonly gradeAheadPct: number;
  /** Metres the rider is ahead of the bot, below 0 behind it: whole metres from the device. */
  readonly riderGapM: number;
}

/** The race read off in full at one instant, on the device: what an ask is made from. */
export interface ModelTacticsRace {
  readonly laps: number;
  /** Whole seconds since any bot was last attacking or on a flyer, or since the start (#2708). */
  readonly quietS: number;
  /** The rider's state (ADR 0073 D-5.2), so a bot can mark them. */
  readonly rider: ModelTacticsRiderView;
  readonly bots: readonly ModelTacticsBotView[];
  /** The road ahead of the leading bot (#2794): once for the race, not once a bot. */
  readonly course?: ModelTacticsCourse;
}

/**
 * **The course ahead of the leading bot**, as the model is shown it (#2794),
 * from `route/course-ahead.ts`: a bot behind the leader is its gap further
 * from each place named. Metres to 10 m, grades to a whole percent.
 */
export interface ModelTacticsCourse {
  /** The next climb up the road (at least 3 % for at least 200 m), or `null` with none in 5 km before the line. */
  readonly climb: CourseHill | null;
  /** The next descent, by the same rule downhill, or `null`. */
  readonly descent: CourseHill | null;
  /** Metres left in the leader's lap. */
  readonly lapLeftM: number;
  /** Metres of climbing left in the leader's lap. */
  readonly lapClimbM: number;
  /**
   * The average grade of the last 500 m to the line, whole percent: whether
   * the finish is flat, up or down. The last lap is a bot's `lapsLeft` of 1.
   */
  readonly finishPct: number;
}

/** The rider as the model is shown them (ADR 0073 D-5.2). */
export interface ModelTacticsRiderView {
  /** The rider's place, from 1; 0 when the rider is not racing. */
  readonly rank: number;
  readonly wPerKg: number | null;
  /** The seat of the bot directly ahead of the rider, or `null` when the rider leads or is not racing. */
  readonly ahead: number | null;
  /** Metres to the racer directly ahead of the rider, or `null`. */
  readonly gapAheadM: number | null;
  /** Metres to the racer directly behind the rider, or `null`. */
  readonly gapBehindM: number | null;
  readonly drafting: boolean;
}

/** Who a move is aimed at: the rider, or another bot by its seat. */
export type ModelTacticsTarget = 'rider' | number;

/** One bot's move, as the log keeps it and the adapter rides it. */
export interface ModelTacticsMove {
  readonly bot: number;
  readonly move: BotTactic;
  readonly target?: ModelTacticsTarget;
  /** How hard to ride it, from a closed list, never a number (ADR 0073 D-2.5, #2710). Absent: the move's own. */
  readonly effort?: BotEffort;
}

// ---------------------------------------------------------------------------
// One bot's ask: the story so far, the cue words and the menu (#2836, ADR 0081).
// ---------------------------------------------------------------------------

/**
 * **Why the model picked its move**, a word from a closed list and the first
 * field of its answer (ADR 0081 D-3): its own terrain, covering a move,
 * countering one that was caught, saving its legs, or the finish. No free
 * text. The log keeps it; nothing rides it.
 */
export const MODEL_TACTICS_REASONS = [
  'my-terrain',
  'cover-move',
  'counter',
  'save-legs',
  'finish-near',
] as const;

/** One of {@link MODEL_TACTICS_REASONS}. */
export type ModelTacticsReason = (typeof MODEL_TACTICS_REASONS)[number];

/**
 * **The cue words the device hands the model with a bot's menu** (ADR 0081
 * D-2.2): what {@link modelTacticsOffer} read of the bot's style, the terrain,
 * its energy and its place, in closed words. In the order they are sent.
 *
 * - `on-your-terrain`: a climber where the road ahead climbs
 *   (`tactics.ts` §`BOT_TACTIC_CLIMB_GRADE_PERCENT`), a rouleur or a breakaway
 *   rider where it does not, a sprinter inside the finish window, an
 *   opportunist when a move has just been caught;
 * - `climb-soon`: a climb starts within {@link MODEL_MENU_CLIMB_SOON_METRES};
 * - `fresh`, `tiring`: its W′ at {@link MODEL_MENU_FRESH_SHARE} or more, or
 *   under `tactics.ts` §`BOT_TACTIC_RECOVER_SHARE`;
 * - `move-ahead`: the racer directly ahead is in a move, in reach;
 * - `move-just-caught`: no bot is attacking or on a flyer now, and one was
 *   within {@link MODEL_MENU_CAUGHT_SECONDS};
 * - `race-quiet`: none has for {@link MODEL_MENU_QUIET_SECONDS} or more;
 * - `last-lap`, and `finish-near`: on it, within
 *   {@link MODEL_MENU_FINISH_LAUNCHES} launch distances of the line as the bot
 *   reads it.
 */
export const MODEL_TACTICS_CUES = [
  'on-your-terrain',
  'climb-soon',
  'fresh',
  'tiring',
  'move-ahead',
  'move-just-caught',
  'race-quiet',
  'last-lap',
  'finish-near',
] as const;

/** One of {@link MODEL_TACTICS_CUES}. */
export type ModelTacticsCue = (typeof MODEL_TACTICS_CUES)[number];

/** One move on a bot's menu: the move, and for a `follow` or `chase` who it is aimed at. */
export interface ModelTacticsMenuEntry {
  readonly move: BotTactic;
  /** Set by the device, only on a `follow` or `chase`: the racer directly ahead. */
  readonly target?: ModelTacticsTarget;
}

/** The most moves a menu holds: **4**, `sit-in` and three others (ADR 0081 D-2.2). */
export const MODEL_TACTICS_MENU_MOST = 4;

/** The fewest moves a menu holds: **2**. With only `sit-in` to offer there is nothing to ask. */
export const MODEL_TACTICS_MENU_LEAST = 2;

/**
 * The menu's thresholds. ⚠️ **Feel numbers, the author's choice** (ADR 0081
 * D-2.3 and its R-2), to tune on the scoring harness (#2838) and the owner's
 * rides. Every other threshold the menu reads is the seeded tactics' own
 * (`tactics.ts`), so the two never disagree about what a climb or a wheel is.
 */
/** The W′ share from which a bot is `fresh`: **0.8**. */
export const MODEL_MENU_FRESH_SHARE = 0.8;
/** How long with no attack or flyer the race is `race-quiet`, seconds: **30**. */
export const MODEL_MENU_QUIET_SECONDS = 30;
/** How long after the last attack or flyer ended a move is `move-just-caught`, seconds: **10**. */
export const MODEL_MENU_CAUGHT_SECONDS = 10;
/** How near a climb's start is `climb-soon`, metres: **300**. */
export const MODEL_MENU_CLIMB_SOON_METRES = 300;
/** The finish window, in launch distances of the line as the bot reads it, on the last lap: **2**. */
export const MODEL_MENU_FINISH_LAUNCHES = 2;

/**
 * The moves that read as a move to the racer behind: every move but sitting
 * in and recovering. A bot in one may keep it, and a bot behind one may
 * `follow` it.
 */
const MOVING: readonly BotTactic[] = ['attack', 'chase', 'flyer', 'kick', 'follow'];

/** The two moves that read a target (`model-race.ts` §`ADR_0073_MOVE_STRATEGY`): every other ignores one. */
const TARGETED_MOVES: readonly BotTactic[] = ['follow', 'chase'];

/** The two moves that read no effort (`tactics.ts` §`wanted`): the schema offers none on them (ADR 0081 D-4). */
const EFFORTLESS_MOVES: readonly BotTactic[] = ['sit-in', 'recover'];

/** What the device offers one bot: its cue words, and its menu, empty with nothing to ask. */
export interface ModelTacticsOffer {
  readonly cues: readonly ModelTacticsCue[];
  readonly menu: readonly ModelTacticsMenuEntry[];
}

/**
 * **The cue words and the menu for one bot** (ADR 0081 D-2.2, D-2.3): the two
 * to four moves that are sensible for it now. Pure: a function of the bot as
 * the race reads it, the lull, and the metres to the next climb.
 *
 * The menu is empty, and the bot is not asked about, when:
 *
 * - it is **blown** (the body's limit: it cannot surge, ADR 0073 D-2);
 * - it reads the line **inside its launch distance** (ADR 0074's sprint
 *   instinct launches its kick there whatever the model says);
 * - or nothing but sitting in is sensible.
 *
 * Otherwise `sit-in` is always on it, **last**, and before it up to three of
 * these, in this order:
 *
 * 1. `kick`, in the finish window (`finish-near`);
 * 2. **the move it is in**, so a move the model began can be held;
 * 3. `follow` the racer directly ahead, when that racer is in a move within
 *    `tactics.ts` §`BOT_TACTIC_FOLLOW_METRES`;
 * 4. `attack`, never a sprinter's, with W′ at `BOT_TACTIC_WBAL_FLOOR` or
 *    more: on its terrain, or fresh in a quiet race;
 * 5. `flyer`, a breakaway rider's on any lap and a rouleur's in the last
 *    `BOT_TACTIC_FLYER_LAPS`, with W′ at `BOT_TACTIC_FLYER_WBAL_SHARE` or
 *    more and no climb ahead;
 * 6. `chase` the racer directly ahead, out of the draft and within
 *    `BOT_TACTIC_BRIDGE_METRES`, with W′ at the floor or more;
 * 7. `recover`, when it is `tiring`.
 *
 * `sit-in` is the model's "no opinion" (ADR 0081 D-1): the bot's seeded
 * tactics decide. Nothing here names a power, and a move on the menu is
 * still ridden inside the body's limits (`model-race.ts` §`applyModelMoves`).
 *
 * @param climbInM - metres to the start of the next climb for this bot, or `null` with none.
 */
export function modelTacticsOffer(
  view: ModelTacticsBotView,
  lull: { readonly quietS: number; readonly moved: boolean },
  climbInM: number | null,
): ModelTacticsOffer {
  const { style, wbal } = view;
  const climbing = view.gradeAheadPct >= BOT_TACTIC_CLIMB_GRADE_PERCENT;
  const lastLap = view.lapsLeft <= 1;
  const finishNear = lastLap && view.toLineM <= MODEL_MENU_FINISH_LAUNCHES * view.launchM;
  const caught = lull.moved && lull.quietS >= 1 && lull.quietS <= MODEL_MENU_CAUGHT_SECONDS;
  const quiet = lull.quietS >= MODEL_MENU_QUIET_SECONDS;
  const fresh = wbal >= MODEL_MENU_FRESH_SHARE;
  const tiring = wbal < BOT_TACTIC_RECOVER_SHARE;
  const moveAhead =
    view.aheadMove !== null &&
    MOVING.includes(view.aheadMove) &&
    view.gapAheadM !== null &&
    view.gapAheadM <= BOT_TACTIC_FOLLOW_METRES;
  const onTerrain =
    style === 'climber'
      ? climbing
      : style === 'sprinter'
        ? finishNear
        : style === 'opportunist'
          ? caught
          : !climbing;
  const said: readonly (readonly [ModelTacticsCue, boolean])[] = [
    ['on-your-terrain', onTerrain],
    ['climb-soon', !climbing && climbInM !== null && climbInM <= MODEL_MENU_CLIMB_SOON_METRES],
    ['fresh', fresh],
    ['tiring', tiring],
    ['move-ahead', moveAhead],
    ['move-just-caught', caught],
    ['race-quiet', quiet],
    ['last-lap', lastLap],
    ['finish-near', finishNear],
  ];
  const cues = said.filter(([, on]) => on).map(([cue]) => cue);
  if (view.blown || view.toLineM <= view.launchM) return { cues, menu: [] };

  const ahead = view.ahead;
  const others: ModelTacticsMenuEntry[] = [];
  const offer = (move: BotTactic): void => {
    if (others.some((entry) => entry.move === move)) return;
    others.push(
      TARGETED_MOVES.includes(move) && ahead !== null ? { move, target: ahead } : { move },
    );
  };
  const spendable = wbal >= BOT_TACTIC_WBAL_FLOOR;
  if (finishNear) offer('kick');
  if (MOVING.includes(view.move)) offer(view.move);
  if (moveAhead) offer('follow');
  if (style !== 'sprinter' && spendable && (onTerrain || (fresh && quiet))) offer('attack');
  if (
    (style === 'breakaway' || (style === 'rouleur' && view.lapsLeft <= BOT_TACTIC_FLYER_LAPS)) &&
    wbal >= BOT_TACTIC_FLYER_WBAL_SHARE &&
    !climbing
  ) {
    offer('flyer');
  }
  if (
    spendable &&
    view.gapAheadM !== null &&
    view.gapAheadM > BOT_TACTIC_WHEEL_METRES &&
    view.gapAheadM <= BOT_TACTIC_BRIDGE_METRES
  ) {
    offer('chase');
  }
  if (tiring) offer('recover');
  if (others.length === 0) return { cues, menu: [] };
  return { cues, menu: [...others.slice(0, MODEL_TACTICS_MENU_MOST - 1), { move: 'sit-in' }] };
}

/** How the bots are for energy on the whole, in a closed word. */
export const MODEL_TACTICS_BUNCH_WORDS = ['fresh', 'tiring', 'tired'] as const;

/** One of {@link MODEL_TACTICS_BUNCH_WORDS}. */
export type ModelTacticsBunchWord = (typeof MODEL_TACTICS_BUNCH_WORDS)[number];

/** The mean W′ share from which the bots are `fresh`, and from which `tiring`: **0.7** and **0.4**. ⚠️ Feel numbers. */
export const MODEL_STORY_BUNCH_FRESH_SHARE = 0.7;
export const MODEL_STORY_BUNCH_TIRING_SHARE = 0.4;

/**
 * The gap that splits a break from the rest, metres: **30**, the draft's
 * reach (`tactics.ts` §`BOT_TACTIC_WHEEL_METRES`). Racers a draft apart are
 * not together.
 */
export const MODEL_STORY_BREAK_METRES = BOT_TACTIC_WHEEL_METRES;

/**
 * **The story so far** (ADR 0081 D-4.4): what the race has come to, written
 * by the device in numbers and closed words, and put into one line for the
 * model by {@link modelTacticsStoryLine}. Never free text.
 */
export interface ModelTacticsStory {
  /** Whole seconds raced. */
  readonly raceS: number;
  /** The leading bot's laps left: 1 on the last lap. */
  readonly lapsLeft: number;
  /** Whole seconds since any bot was last attacking or on a flyer, or since the start. */
  readonly quietS: number;
  /** Whether any bot has attacked or gone on a flyer yet. */
  readonly moved: boolean;
  /**
   * The break, or `null` with nobody away: how many racers, the rider
   * counted, are clear of the rest by {@link MODEL_STORY_BREAK_METRES} or
   * more, for how many whole seconds, and by how many whole metres.
   */
  readonly away: {
    readonly racers: number;
    readonly s: number;
    readonly gapM: number;
  } | null;
  /** How the racing bots are for energy on the whole. */
  readonly bunch: ModelTacticsBunchWord;
}

/**
 * The break in a field at these effort distances, **the leader first**: the
 * racers ahead of the first gap of {@link MODEL_STORY_BREAK_METRES} or more,
 * when they are at most half the field (more than half ahead of a gap is a
 * bunch that has dropped riders, not a break). `null` with nobody away.
 */
export function modelTacticsBreak(
  effortDistances: readonly number[],
): { readonly racers: number; readonly gapM: number } | null {
  for (let at = 1; at < effortDistances.length; at += 1) {
    const gap = (effortDistances[at - 1] as number) - (effortDistances[at] as number);
    if (gap < MODEL_STORY_BREAK_METRES) continue;
    return at * 2 <= effortDistances.length ? { racers: at, gapM: Math.round(gap) } : null;
  }
  return null;
}

/** How the bots are for energy on the whole: the mean of their W′ shares, in a closed word. */
export function modelTacticsBunch(wbalShares: readonly number[]): ModelTacticsBunchWord {
  if (wbalShares.length === 0) return 'fresh';
  const mean = wbalShares.reduce((sum, share) => sum + share, 0) / wbalShares.length;
  if (mean >= MODEL_STORY_BUNCH_FRESH_SHARE) return 'fresh';
  return mean >= MODEL_STORY_BUNCH_TIRING_SHARE ? 'tiring' : 'tired';
}

/**
 * The story so far as the one line the model reads: numbers and closed words
 * only, in a fixed order. The instance writes it from a story it has checked
 * field by field, so nothing a device sends reaches the prompt as text.
 */
export function modelTacticsStoryLine(story: ModelTacticsStory): string {
  const n = (value: number): string => String(value);
  const parts = [
    `${n(story.raceS)} s raced`,
    story.lapsLeft <= 1 ? 'last lap' : `${n(story.lapsLeft)} laps left`,
    story.away === null
      ? 'nobody away'
      : `a break of ${n(story.away.racers)} away for ${n(story.away.s)} s, ${n(story.away.gapM)} m clear`,
    !story.moved
      ? 'no attack yet'
      : story.quietS === 0
        ? 'a move is on now'
        : story.quietS <= MODEL_MENU_CAUGHT_SECONDS
          ? `a move ended ${n(story.quietS)} s ago`
          : `quiet for ${n(story.quietS)} s`,
    `the bots are ${story.bunch}`,
  ];
  return `${parts.join('; ')}.`;
}

/** One racing bot as every ask shows it: enough to read the race, and no more. */
export interface ModelTacticsFieldView {
  readonly bot: number;
  readonly style: ModelRacingStyle;
  /** Its place in the race, from 1. */
  readonly rank: number;
  /** The move it is riding now. */
  readonly move: BotTactic;
  /** Metres to the racer directly ahead, or `null` when it leads. */
  readonly gapAheadM: number | null;
}

/** The bot an ask is about: its own part, sent last (ADR 0081 D-2.4). */
export interface ModelTacticsYou {
  /** Its seat. */
  readonly bot: number;
  readonly style: ModelRacingStyle;
  readonly flat: ModelStrengthWord;
  readonly climb: ModelStrengthWord;
  readonly sprint: ModelStrengthWord;
  readonly punch: ModelStrengthWord;
  /**
   * Whole seconds since it was last in a move of its own (`attack`, `chase`,
   * `flyer` or `kick`): 0 while it is in one, `null` when it has made none
   * this race. Shown before its current move (ADR 0081 D-4.5), so the model
   * reads how long the bot has waited and not what it answered last time.
   */
  readonly sinceMoveS: number | null;
  /** The move it is riding now, and the whole seconds it has held it. */
  readonly move: BotTactic;
  readonly secondsInMove: number;
  readonly rank: number;
  readonly gapAheadM: number | null;
  readonly gapBehindM: number | null;
  /** Metres the rider is ahead of it, below 0 behind it. */
  readonly riderGapM: number;
  /** Its W′ balance as a share of its W′, 0 to 1. */
  readonly wbal: number;
  readonly drafting: boolean;
  readonly lapsLeft: number;
  /** Metres to the line as it reads them (ADR 0073 D-3.5). */
  readonly toLineM: number;
  /** The grade 50 m up the road, percent. */
  readonly gradeAheadPct: number;
  /** Metres to the start of the next climb for this bot, or `null` with none before the line. */
  readonly climbInM: number | null;
  /** What the device read of it, in closed words: {@link MODEL_TACTICS_CUES}. */
  readonly cues: readonly ModelTacticsCue[];
  /** The moves it may be sent on: the model picks one of these and nothing else. */
  readonly menu: readonly ModelTacticsMenuEntry[];
}

/**
 * **One bot's ask, as the model is shown it** (ADR 0081 D-2): the shared
 * race first and {@link you}, the bot asked about, last, so a model server
 * that keeps the start of its last prompt reads only what changed.
 */
export interface ModelTacticsInput {
  readonly laps: number;
  /** The road ahead of the leading bot (#2794). Optional in the reader, as it was; every device sends it. */
  readonly course?: ModelTacticsCourse;
  /** The rider's state (ADR 0073 D-5.2), so a bot can mark them. */
  readonly rider: ModelTacticsRiderView;
  /** Every racing bot, the one asked about included, in seat order. */
  readonly field: readonly ModelTacticsFieldView[];
  readonly story: ModelTacticsStory;
  readonly you: ModelTacticsYou;
}

/** What an ask needs that the race read off at one instant does not hold. */
export interface ModelTacticsAskFacts {
  /** {@link ModelTacticsYou.sinceMoveS}. */
  readonly sinceMoveS: number | null;
  /** Whole seconds raced. */
  readonly raceS: number;
  /** {@link ModelTacticsStory.away}. */
  readonly away: ModelTacticsStory['away'];
  /** Whether any bot has attacked or gone on a flyer yet. */
  readonly moved: boolean;
  /** Metres to the start of the next climb for this bot, or `null`. */
  readonly climbInM: number | null;
}

/**
 * The ask for the bot in `seat`, made from the race read off in full, or
 * `undefined` with nothing to ask: no such bot racing, or an empty menu
 * ({@link modelTacticsOffer}).
 */
export function modelTacticsAsk(
  race: ModelTacticsRace,
  seat: number,
  facts: ModelTacticsAskFacts,
): ModelTacticsInput | undefined {
  const view = race.bots.find((each) => each.bot === seat);
  if (view === undefined) return undefined;
  const offer = modelTacticsOffer(
    view,
    { quietS: race.quietS, moved: facts.moved },
    facts.climbInM,
  );
  if (offer.menu.length < MODEL_TACTICS_MENU_LEAST) return undefined;
  return {
    laps: race.laps,
    ...(race.course === undefined ? {} : { course: race.course }),
    rider: race.rider,
    field: race.bots.map((each) => ({
      bot: each.bot,
      style: each.style,
      rank: each.rank,
      move: each.move,
      gapAheadM: each.gapAheadM,
    })),
    story: {
      raceS: facts.raceS,
      lapsLeft: Math.min(...race.bots.map((each) => each.lapsLeft)),
      quietS: race.quietS,
      moved: facts.moved,
      away: facts.away,
      bunch: modelTacticsBunch(race.bots.map((each) => each.wbal)),
    },
    you: {
      bot: view.bot,
      style: view.style,
      flat: view.flat,
      climb: view.climb,
      sprint: view.sprint,
      punch: view.punch,
      sinceMoveS: facts.sinceMoveS,
      move: view.move,
      secondsInMove: view.secondsInMove,
      rank: view.rank,
      gapAheadM: view.gapAheadM,
      gapBehindM: view.gapBehindM,
      riderGapM: view.riderGapM,
      wbal: view.wbal,
      drafting: view.drafting,
      lapsLeft: view.lapsLeft,
      toLineM: view.toLineM,
      gradeAheadPct: view.gradeAheadPct,
      climbInM: facts.climbInM,
      cues: offer.cues,
      menu: offer.menu,
    },
  };
}

// ---------------------------------------------------------------------------
// The answer.
// ---------------------------------------------------------------------------

/** What the model picked for one bot: why, the move, and how hard. */
export interface ModelTacticsPick {
  readonly reason: ModelTacticsReason;
  readonly move: BotTactic;
  /** Absent: the move's own. Never kept on a `sit-in` or a `recover`, which read none. */
  readonly effort?: BotEffort;
}

/**
 * Why an answer was read as no decision at all. A closed list (ADR 0071
 * D-4.2's `invalid`). `not-a-list`, `bad-bot`, `duplicate-bot` and
 * `bad-target` are what an answer for the whole field could be until bot-code
 * version 7; a stored log still reads them.
 */
export type ModelTacticsInvalid =
  | 'too-long'
  | 'not-json'
  | 'not-an-object'
  | 'unknown-key'
  | 'not-a-list'
  | 'bad-bot'
  | 'duplicate-bot'
  | 'bad-move'
  | 'bad-target'
  | 'bad-effort'
  /** No reason word, or one outside {@link MODEL_TACTICS_REASONS}. */
  | 'bad-reason'
  /** One of the seven moves, but not one the device offered. */
  | 'off-menu';

/** An answer, read. */
export type ModelTacticsAnswer =
  | { readonly ok: true; readonly pick: ModelTacticsPick }
  | { readonly ok: false; readonly reason: ModelTacticsInvalid };

/** An ask refused: the field, and the rule it broke. Never the value. */
export interface ModelTacticsInputProblem {
  readonly field: string;
  readonly problem: string;
}

/** An ask, read. */
export type ModelTacticsInputRead =
  | { readonly ok: true; readonly value: ModelTacticsInput }
  | { readonly ok: false; readonly problem: ModelTacticsInputProblem };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The answer's JSON Schema for a bot offered `menu`, which a local model
 * server's structured output holds the model to, and which
 * {@link readModelTacticsAnswer} checks again, because a schema a server
 * enforces is not one its caller may trust.
 *
 * **The reason word is first** (ADR 0081 D-3), and required, so the model
 * writes why before it writes the move. The move is one on the menu and no
 * other. **No effort on `sit-in` or `recover`** (D-4.6): a move is one of two
 * shapes, those two with a reason and a move only, and every other with an
 * optional effort (ADR 0073 D-2.5). There is no target: the menu names it.
 * And no number anywhere, so no power.
 */
export function modelTacticsAnswerSchema(
  menu: readonly ModelTacticsMenuEntry[],
): Readonly<Record<string, unknown>> {
  const shape = (moves: readonly BotTactic[], effort: boolean) => ({
    type: 'object',
    properties: {
      reason: { type: 'string', enum: [...MODEL_TACTICS_REASONS] },
      move: { type: 'string', enum: [...moves] },
      ...(effort ? { effort: { type: 'string', enum: [...BOT_EFFORTS] } } : {}),
    },
    required: ['reason', 'move'],
    additionalProperties: false,
  });
  const offered = menu.map((entry) => entry.move);
  const effortless = offered.filter((move) => EFFORTLESS_MOVES.includes(move));
  const ridden = offered.filter((move) => !EFFORTLESS_MOVES.includes(move));
  const shapes = [
    ...(ridden.length > 0 ? [shape(ridden, true)] : []),
    ...(effortless.length > 0 ? [shape(effortless, false)] : []),
  ];
  return shapes.length === 1 ? (shapes[0] as Readonly<Record<string, unknown>>) : { anyOf: shapes };
}

const PICK_KEYS: ReadonlySet<string> = new Set(['reason', 'move', 'effort']);

/**
 * Read a model's answer for a bot offered `menu`: its pick, or why it is
 * none. See the file comment for what makes it invalid.
 */
export function readModelTacticsAnswer(
  text: string,
  menu: readonly ModelTacticsMenuEntry[],
): ModelTacticsAnswer {
  if (text.length > MODEL_TACTICS_ANSWER_MOST_CHARACTERS) return { ok: false, reason: 'too-long' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'not-an-object' };
  if (Object.keys(parsed).some((key) => !PICK_KEYS.has(key))) {
    return { ok: false, reason: 'unknown-key' };
  }
  const { reason, move, effort } = parsed;
  if (
    typeof reason !== 'string' ||
    !(MODEL_TACTICS_REASONS as readonly string[]).includes(reason)
  ) {
    return { ok: false, reason: 'bad-reason' };
  }
  if (typeof move !== 'string' || !(BOT_TACTICS as readonly string[]).includes(move)) {
    return { ok: false, reason: 'bad-move' };
  }
  if (!menu.some((entry) => entry.move === move)) return { ok: false, reason: 'off-menu' };
  // A `null` effort is no effort, as an absent one is.
  if (
    effort !== undefined &&
    effort !== null &&
    !(typeof effort === 'string' && (BOT_EFFORTS as readonly string[]).includes(effort))
  ) {
    return { ok: false, reason: 'bad-effort' };
  }
  const kept =
    effort === undefined || effort === null || EFFORTLESS_MOVES.includes(move as BotTactic);
  return {
    ok: true,
    pick: {
      reason: reason as ModelTacticsReason,
      move: move as BotTactic,
      ...(kept ? {} : { effort: effort as BotEffort }),
    },
  };
}

/** A pick as the adapter rides it: the bot it was asked about, and the menu's own target. */
export function modelTacticsMoveOf(
  bot: number,
  pick: ModelTacticsPick,
  menu: readonly ModelTacticsMenuEntry[],
): ModelTacticsMove {
  const target = menu.find((entry) => entry.move === pick.move)?.target;
  return {
    bot,
    move: pick.move,
    ...(target === undefined ? {} : { target }),
    ...(pick.effort === undefined ? {} : { effort: pick.effort }),
  };
}

// ---------------------------------------------------------------------------
// Reading an ask a device sent.
// ---------------------------------------------------------------------------

const INPUT_KEYS = ['laps', 'rider', 'field', 'story', 'you'] as const;
/** The keys an ask may leave out. */
const OPTIONAL_INPUT_KEYS = ['course'] as const;
const COURSE_KEYS = ['climb', 'descent', 'lapLeftM', 'lapClimbM', 'finishPct'] as const;
const RIDER_KEYS = ['rank', 'wPerKg', 'ahead', 'gapAheadM', 'gapBehindM', 'drafting'] as const;
const FIELD_KEYS = ['bot', 'style', 'rank', 'move', 'gapAheadM'] as const;
const STORY_KEYS = ['raceS', 'lapsLeft', 'quietS', 'moved', 'away', 'bunch'] as const;
const AWAY_KEYS = ['racers', 's', 'gapM'] as const;
const YOU_KEYS = [
  'bot',
  'style',
  'flat',
  'climb',
  'sprint',
  'punch',
  'sinceMoveS',
  'move',
  'secondsInMove',
  'rank',
  'gapAheadM',
  'gapBehindM',
  'riderGapM',
  'wbal',
  'drafting',
  'lapsLeft',
  'toLineM',
  'gradeAheadPct',
  'climbInM',
  'cues',
  'menu',
] as const;

const wholeIn = (value: unknown, least: number, most: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= least && value <= most;

const numberIn = (value: unknown, least: number, most: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= least && value <= most;

const wordIn = (value: unknown, words: readonly string[]): boolean =>
  typeof value === 'string' && words.includes(value);

const isSeat = (value: unknown): boolean => wholeIn(value, 0, MODEL_TACTICS_MOST_SEATS - 1);
const isGap = (value: unknown): boolean => value === null || numberIn(value, 0, MOST_METRES);

type Check = readonly [string, boolean, string];

/** The first of `checks` that failed, as a problem at `at`, or `undefined`. */
function firstProblem(checks: readonly Check[], at: string): ModelTacticsInputProblem | undefined {
  const failed = checks.find(([, ok]) => !ok);
  return failed === undefined ? undefined : { field: `${at}.${failed[0]}`, problem: failed[2] };
}

/** Why `value` is not exactly `keys`: the first key it has that is not one, or the first it lacks. */
function keyProblem(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  at: string,
): ModelTacticsInputProblem | undefined {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra !== undefined) return { field: at, problem: 'has a field this race state does not' };
  const missing = keys.find((key) => !(key in value));
  return missing === undefined ? undefined : { field: `${at}.${missing}`, problem: 'is required' };
}

/** The first problem with an object that must be exactly `keys` and pass `checks`. */
function objectProblem(
  value: unknown,
  keys: readonly string[],
  at: string,
  checks: (value: Readonly<Record<string, unknown>>) => readonly Check[],
): ModelTacticsInputProblem | undefined {
  if (!isRecord(value)) return { field: at, problem: 'must be an object' };
  return keyProblem(value, keys, at) ?? firstProblem(checks(value), at);
}

/** The first problem with the course ahead (#2794), or `undefined`. */
function courseProblem(course: unknown): ModelTacticsInputProblem | undefined {
  return objectProblem(course, COURSE_KEYS, 'input.course', (value) => [
    ['climb', value.climb === null || isCourseHill(value.climb), 'must be a hill, or null'],
    ['descent', value.descent === null || isCourseHill(value.descent), 'must be a hill, or null'],
    ['lapLeftM', numberIn(value.lapLeftM, 0, MOST_METRES), 'must be metres'],
    ['lapClimbM', numberIn(value.lapClimbM, 0, MOST_METRES), 'must be metres'],
    ['finishPct', numberIn(value.finishPct, -100, 100), 'must be a grade in percent'],
  ]);
}

/** The first problem with the rider's state, or `undefined`. */
function riderProblem(rider: unknown): ModelTacticsInputProblem | undefined {
  return objectProblem(rider, RIDER_KEYS, 'input.rider', (value) => [
    [
      'rank',
      wholeIn(value.rank, 0, MODEL_TACTICS_MOST_SEATS + 1),
      'must be a place in the field, or 0',
    ],
    [
      'wPerKg',
      value.wPerKg === null || numberIn(value.wPerKg, 0, MOST_WATTS_PER_KILOGRAM),
      'must be watts per kilogram, or null',
    ],
    ['ahead', value.ahead === null || isSeat(value.ahead), 'must be a seat, or null'],
    ['gapAheadM', isGap(value.gapAheadM), 'must be metres, or null'],
    ['gapBehindM', isGap(value.gapBehindM), 'must be metres, or null'],
    ['drafting', typeof value.drafting === 'boolean', 'must be a boolean'],
  ]);
}

/** The first problem with the story so far, or `undefined`. */
function storyProblem(story: unknown): ModelTacticsInputProblem | undefined {
  const problem = objectProblem(story, STORY_KEYS, 'input.story', (value) => [
    ['raceS', wholeIn(value.raceS, 0, MOST_SECONDS), 'must be a whole number of seconds'],
    ['lapsLeft', wholeIn(value.lapsLeft, 0, MOST_LAPS), 'must be a whole number of laps'],
    ['quietS', wholeIn(value.quietS, 0, MOST_SECONDS), 'must be a whole number of seconds'],
    ['moved', typeof value.moved === 'boolean', 'must be a boolean'],
    ['bunch', wordIn(value.bunch, MODEL_TACTICS_BUNCH_WORDS), 'must be a word for the bunch'],
  ]);
  if (problem !== undefined) return problem;
  const away = (story as Readonly<Record<string, unknown>>).away;
  if (away === null) return undefined;
  return objectProblem(away, AWAY_KEYS, 'input.story.away', (value) => [
    ['racers', wholeIn(value.racers, 1, MODEL_TACTICS_MOST_SEATS + 1), 'must be a count of racers'],
    ['s', wholeIn(value.s, 0, MOST_SECONDS), 'must be a whole number of seconds'],
    ['gapM', numberIn(value.gapM, 0, MOST_METRES), 'must be metres'],
  ]);
}

/** The first problem with the menu, or `undefined`: two to four different moves, a target only where one is read. */
function menuProblem(menu: unknown, at: string): ModelTacticsInputProblem | undefined {
  if (
    !Array.isArray(menu) ||
    menu.length < MODEL_TACTICS_MENU_LEAST ||
    menu.length > MODEL_TACTICS_MENU_MOST
  ) {
    return {
      field: at,
      problem: `must list ${String(MODEL_TACTICS_MENU_LEAST)} to ${String(MODEL_TACTICS_MENU_MOST)} moves`,
    };
  }
  const offered = new Set<unknown>();
  for (const [index, entry] of (menu as readonly unknown[]).entries()) {
    const here = `${at}[${String(index)}]`;
    if (!isRecord(entry)) return { field: here, problem: 'must be an object' };
    if (Object.keys(entry).some((key) => key !== 'move' && key !== 'target')) {
      return { field: here, problem: 'has a field this race state does not' };
    }
    if (!wordIn(entry.move, BOT_TACTICS)) {
      return { field: `${here}.move`, problem: 'must be one of the seven moves' };
    }
    if (offered.has(entry.move)) {
      return { field: `${here}.move`, problem: 'must not repeat a move' };
    }
    offered.add(entry.move);
    if (
      'target' in entry &&
      !(
        TARGETED_MOVES.includes(entry.move as BotTactic) &&
        (entry.target === 'rider' || isSeat(entry.target))
      )
    ) {
      return {
        field: `${here}.target`,
        problem: 'must be "rider" or a seat, on a follow or a chase',
      };
    }
  }
  return undefined;
}

/** The first problem with the bot asked about, or `undefined`. */
function youProblem(you: unknown): ModelTacticsInputProblem | undefined {
  const at = 'input.you';
  const metres = (value: unknown): boolean => numberIn(value, -MOST_METRES, MOST_METRES);
  const problem = objectProblem(you, YOU_KEYS, at, (value) => [
    ['bot', isSeat(value.bot), 'must be a seat'],
    ['style', wordIn(value.style, MODEL_RACING_STYLES), 'must be a racing style'],
    ...(['flat', 'climb', 'sprint', 'punch'] as const).map((key): Check => [
      key,
      wordIn(value[key], MODEL_STRENGTH_WORDS),
      'must be a strength word',
    ]),
    [
      'sinceMoveS',
      value.sinceMoveS === null || wholeIn(value.sinceMoveS, 0, MOST_SECONDS),
      'must be a whole number of seconds, or null',
    ],
    ['move', wordIn(value.move, BOT_TACTICS), 'must be one of the seven moves'],
    [
      'secondsInMove',
      wholeIn(value.secondsInMove, 0, MOST_SECONDS),
      'must be a whole number of seconds',
    ],
    ['rank', wholeIn(value.rank, 1, MODEL_TACTICS_MOST_SEATS + 1), 'must be a place in the field'],
    ['gapAheadM', isGap(value.gapAheadM), 'must be metres, or null'],
    ['gapBehindM', isGap(value.gapBehindM), 'must be metres, or null'],
    ['riderGapM', metres(value.riderGapM), 'must be metres'],
    ['wbal', numberIn(value.wbal, 0, 1), 'must be a share from 0 to 1'],
    ['drafting', typeof value.drafting === 'boolean', 'must be a boolean'],
    ['lapsLeft', wholeIn(value.lapsLeft, 0, MOST_LAPS), 'must be a whole number of laps'],
    ['toLineM', metres(value.toLineM), 'must be metres'],
    ['gradeAheadPct', numberIn(value.gradeAheadPct, -100, 100), 'must be a grade in percent'],
    ['climbInM', isGap(value.climbInM), 'must be metres, or null'],
    [
      'cues',
      Array.isArray(value.cues) &&
        value.cues.length <= MODEL_TACTICS_CUES.length &&
        (value.cues as readonly unknown[]).every(
          (cue, index, all) => wordIn(cue, MODEL_TACTICS_CUES) && all.indexOf(cue) === index,
        ),
      'must list cue words, each once',
    ],
  ]);
  if (problem !== undefined) return problem;
  return menuProblem((you as Readonly<Record<string, unknown>>).menu, `${at}.menu`);
}

/**
 * Read an ask a device sent, exactly {@link ModelTacticsInput}'s shape and no
 * more than {@link MODEL_TACTICS_INPUT_MOST_CHARACTERS} of JSON: the ask, or
 * the first problem, naming the field and never the value.
 */
export function readModelTacticsInput(value: unknown): ModelTacticsInputRead {
  const refuse = (field: string, problem: string): ModelTacticsInputRead => ({
    ok: false,
    problem: { field, problem },
  });
  if (!isRecord(value)) return refuse('input', 'must be an object');
  if (JSON.stringify(value).length > MODEL_TACTICS_INPUT_MOST_CHARACTERS) {
    return refuse(
      'input',
      `must be at most ${String(MODEL_TACTICS_INPUT_MOST_CHARACTERS)} characters`,
    );
  }
  const keys = keyProblem(
    value,
    [...INPUT_KEYS, ...OPTIONAL_INPUT_KEYS.filter((key) => key in value)],
    'input',
  );
  if (keys !== undefined) return { ok: false, problem: keys };
  if (!wholeIn(value.laps, 1, MOST_LAPS)) return refuse('input.laps', 'must be a number of laps');
  const rider = riderProblem(value.rider);
  if (rider !== undefined) return { ok: false, problem: rider };
  const field = value.field;
  if (!Array.isArray(field) || field.length === 0 || field.length > MODEL_TACTICS_MOST_SEATS) {
    return refuse('input.field', `must list 1 to ${String(MODEL_TACTICS_MOST_SEATS)} bots`);
  }
  const seats = new Set<unknown>();
  for (const [index, view] of (field as readonly unknown[]).entries()) {
    const at = `input.field[${String(index)}]`;
    const problem = objectProblem(view, FIELD_KEYS, at, (each) => [
      ['bot', isSeat(each.bot), 'must be a seat'],
      ['style', wordIn(each.style, MODEL_RACING_STYLES), 'must be a racing style'],
      ['rank', wholeIn(each.rank, 1, MODEL_TACTICS_MOST_SEATS + 1), 'must be a place in the field'],
      ['move', wordIn(each.move, BOT_TACTICS), 'must be one of the seven moves'],
      ['gapAheadM', isGap(each.gapAheadM), 'must be metres, or null'],
    ]);
    if (problem !== undefined) return { ok: false, problem };
    const seat = (view as ModelTacticsFieldView).bot;
    if (seats.has(seat)) return refuse(`${at}.bot`, 'must not repeat a seat');
    seats.add(seat);
  }
  const story = storyProblem(value.story);
  if (story !== undefined) return { ok: false, problem: story };
  const you = youProblem(value.you);
  if (you !== undefined) return { ok: false, problem: you };
  if (!seats.has((value.you as ModelTacticsYou).bot)) {
    return refuse('input.you.bot', 'must be a bot in the field');
  }
  if ('course' in value) {
    const problem = courseProblem(value.course);
    if (problem !== undefined) return { ok: false, problem };
  }
  return { ok: true, value: value as unknown as ModelTacticsInput };
}
