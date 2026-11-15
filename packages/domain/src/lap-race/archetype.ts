// SPDX-License-Identifier: Apache-2.0

/**
 * A lap-race bot's rider archetype and its tactics skill — #2459, under
 * [ADR 0067](../../../../docs/adr/0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md)
 * D-1.1 and D-7.
 *
 * Before #2459 a field of seven differed by its pacing style and its ability
 * (#2455) and nothing else: every bot of a tier had the tier's W′, its surge
 * ceiling as its peak and the model's one recovery. An archetype is a **power
 * profile within the tier**, after the classic power-profile axes (5 s, 1 min,
 * 5 min and threshold: neuromuscular, anaerobic, VO2max and threshold), so a
 * field of seven is seven different racers.
 *
 * ## An archetype extends #2455's pace; it is not a second deal
 *
 * #2455 already deals each bot a pacing style from the race's seed
 * (`pace.ts` §`botFieldPaces`), and two of its styles were already
 * archetypes in all but name: a `climber` and a `sprinter` each held a larger
 * W′ and read the climbs their own way. So the archetype is **read off the
 * style** ({@link BOT_STYLE_ARCHETYPE}), and the style's name is still what the
 * standings call a bot. Nothing is dealt twice, and a bot called `Climber 4`
 * is a climber. The style keeps *when* in the race a bot rides its own power
 * (a fast start, a negative split); the archetype sets *what that power is*.
 *
 * ## The profile, a column per constant
 *
 * | Archetype | CP share | W′ | Peak | Recovery | Climb grade | Sprint opens |
 * |---|---|---|---|---|---|---|
 * | `sprinter` | lower, 0.95 | large, 1.5 | high, 1.5 | 1 | 16 %: saves on climbs | 1.5 × further out |
 * | `climber` | 0.98 | small, 0.9 | 1.4 | 1 | 4 %: a full surge early | the field's |
 * | `rouleur` | high, 1 | small, 0.9 | low, 1.3 | fast, 1.5 | 8 %, #92's | the field's |
 * | `attacker` | 0.98 | medium, 1.2 | 1.45 | 1 | 6 % | the field's |
 *
 * Each share is of the bot's **tier**, and none is over 1, so every bot's
 * capacity stays within its tier (ADR 0061 D-8.2 and D-8.3, kept by ADR 0067
 * D-1.3): its CP never over the tier's power, its peak never over
 * `plan.ts` §`BOT_PLAN_SURGE_CEILING` of it. ⚠️ **Every number is a feel number
 * for the owner's approval**, to be tuned against the seeded harness of #2464.
 * The rider-facing words for the four are the owner's (ADR 0060 D-1/Q7): these
 * are keys.
 *
 * {@link BOT_ARCHETYPE_ATTACK_PROPENSITY} is the last column, how readily each
 * archetype attacks in each part of a race. Nothing in a bot's power reads it:
 * it is the weight #2462's tactics give their states.
 *
 * ## The tactics skill (ADR 0067 D-7)
 *
 * `strategy.ts` §`BotSkill` (naive, canny, crafty) already scaled how far a
 * bot misjudges an item and a lane. {@link botTacticsMisjudgement} generalises
 * it to the race: how far a bot misjudges the gap to a rival, the distance to
 * the line and its own W′ balance, by up to {@link BOT_TACTICS_MISJUDGE_GAP_METRES},
 * {@link BOT_TACTICS_MISJUDGE_LINE_METRES} and
 * {@link BOT_TACTICS_MISJUDGE_WBAL_SHARE}, each times
 * `strategy.ts` §`BOT_SKILL_MISJUDGEMENT` for its skill. It is **drawn once per
 * {@link BOT_TACTICS_WINDOW_MS} of race time**, keyed by the window and never
 * by the tick, so the solo race at 50 ms and the tests at 1 s read the same
 * error. It changes what a bot reads, never its capacity (D-1).
 *
 * ## Pure, seeded, and from no recorded ride
 *
 * Tables and seeded draws through `random.ts`, under their own salt. Nothing
 * here imports `ghost/` or `recording/` (`bots.test.ts` scans every lap-race
 * module), and nothing here reads the race.
 */

import { LapRaceError } from './errors';
import { botFieldPaces, type BotPacingStyle } from './pace';
import { nextUnit, raceRandom } from './random';
import { BOT_SKILL_MISJUDGEMENT, type BotSkill } from './strategy';

/** A bot's power profile within its tier, by key. The owner chooses the words (ADR 0060 D-1/Q7). */
export type BotArchetype = 'sprinter' | 'climber' | 'rouleur' | 'attacker';

/** Every archetype. */
export const BOT_ARCHETYPES: readonly BotArchetype[] = [
  'sprinter',
  'climber',
  'rouleur',
  'attacker',
];

/**
 * Each pacing style's archetype: `even` is the tempo rider, the rouleur;
 * `fast-start` and `negative-split` go early and late, the attacker's way;
 * `climber` and `sprinter` are themselves.
 */
export const BOT_STYLE_ARCHETYPE: Readonly<Record<BotPacingStyle, BotArchetype>> = {
  even: 'rouleur',
  'fast-start': 'attacker',
  'negative-split': 'attacker',
  climber: 'climber',
  sprinter: 'sprinter',
};

/** Each archetype's critical power, as a share of its tier's power times its ability. Never over 1. */
export const BOT_ARCHETYPE_CP_SHARE: Readonly<Record<BotArchetype, number>> = {
  sprinter: 0.95,
  climber: 0.98,
  rouleur: 1,
  attacker: 0.98,
};

/** Each archetype's W′, as a multiple of its tier's `plan.ts` §`BOT_WPRIME_JOULES`. */
export const BOT_ARCHETYPE_WPRIME_FACTOR: Readonly<Record<BotArchetype, number>> = {
  sprinter: 1.5,
  climber: 0.9,
  rouleur: 0.9,
  attacker: 1.2,
};

/**
 * Each archetype's peak, the most it ever rides, as a multiple of its tier's
 * power: never over `plan.ts` §`BOT_PLAN_SURGE_CEILING` (1.5), so never over
 * 7 W/kg for the strongest tier.
 */
export const BOT_ARCHETYPE_PEAK_SHARE: Readonly<Record<BotArchetype, number>> = {
  sprinter: 1.5,
  climber: 1.4,
  rouleur: 1.3,
  attacker: 1.45,
};

/**
 * How fast each archetype recovers W′ under its CP, as a multiple of the
 * discrete differential form's own rate (`wbal.ts`): a rouleur's is fast.
 */
export const BOT_ARCHETYPE_RECOVERY_FACTOR: Readonly<Record<BotArchetype, number>> = {
  sprinter: 1,
  climber: 1,
  rouleur: 1.5,
  attacker: 1,
};

/**
 * The grade at which each archetype asks its full peak up a climb, percent:
 * the lower, the harder it climbs. The rouleur's is #92's 8 %
 * (`PACING_CLIMB_REFERENCE_GRADE_PERCENT`); a sprinter's 16 % asks half a
 * climb's surge at 8 %, saving its W′ for the line.
 */
export const BOT_ARCHETYPE_CLIMB_GRADE_PERCENT: Readonly<Record<BotArchetype, number>> = {
  sprinter: 16,
  climber: 4,
  rouleur: 8,
  attacker: 6,
};

/**
 * How much further from the line each archetype opens its closing sprint, as
 * a multiple of the field's draw (`plan.ts`, 200 to 300 m): a sprinter's is a
 * long one, to 450 m.
 */
export const BOT_ARCHETYPE_SPRINT_FACTOR: Readonly<Record<BotArchetype, number>> = {
  sprinter: 1.5,
  climber: 1,
  rouleur: 1,
  attacker: 1,
};

/** How readily an archetype attacks in each part of a race, from 0 (never) to 1. */
export interface BotAttackPropensity {
  /** Before the last laps, on the flat. */
  readonly early: number;
  /** On a climb. */
  readonly climb: number;
  /** In the last laps, toward the line. */
  readonly finish: number;
  /** Chasing a move down, rather than attacking. */
  readonly chase: number;
}

/**
 * Each archetype's attack propensity: a sprinter low early and high at the
 * finish, a climber on climbs, a rouleur low but quick to chase, an attacker
 * high throughout. The weights #2462's tactics give their states; nothing in
 * a bot's power reads them.
 */
export const BOT_ARCHETYPE_ATTACK_PROPENSITY: Readonly<Record<BotArchetype, BotAttackPropensity>> =
  {
    sprinter: { early: 0.1, climb: 0.1, finish: 1, chase: 0.4 },
    climber: { early: 0.3, climb: 1, finish: 0.4, chase: 0.3 },
    rouleur: { early: 0.2, climb: 0.2, finish: 0.3, chase: 1 },
    attacker: { early: 1, climb: 0.6, finish: 0.7, chase: 0.5 },
  };

/** A pacing style's archetype ({@link BOT_STYLE_ARCHETYPE}). */
export function botArchetype(style: BotPacingStyle): BotArchetype {
  return BOT_STYLE_ARCHETYPE[style];
}

/**
 * The archetypes of a solo race's `count` bots, from the race's seed: those of
 * the paces `pace.ts` §`botFieldPaces` deals the same field, in its order. Any
 * five bots in a row carry every style, so every field of five or more holds
 * all four archetypes.
 *
 * @throws {LapRaceError} as `botFieldPaces`.
 */
export function botFieldArchetypes(seed: number, count: number): readonly BotArchetype[] {
  return botFieldPaces(seed, count).map((pace) => botArchetype(pace.style));
}

/**
 * The length of a tactics decision window, ms of race time: **1 s**. A bot's
 * tactical misjudgement is drawn once per window. A whole number of the solo
 * race's 50 ms ticks and of the tests' 1 s ticks, so both read one error per
 * window.
 */
export const BOT_TACTICS_WINDOW_MS = 1_000;

/** The most a `naive` bot misjudges the gap to a rival by, metres: scaled by `BOT_SKILL_MISJUDGEMENT`. */
export const BOT_TACTICS_MISJUDGE_GAP_METRES = 8;

/** The most a `naive` bot misjudges the distance to the line by, metres: scaled the same way. */
export const BOT_TACTICS_MISJUDGE_LINE_METRES = 60;

/** The most a `naive` bot misjudges its own W′ balance by, as a share of its W′: scaled the same way. */
export const BOT_TACTICS_MISJUDGE_WBAL_SHARE = 0.2;

/** Keys the tactics' draws apart from the race's item draws and every other bot draw. */
const TACTICS_SALT = 0x2459_7ac7;

/** How far, this window, a bot misreads the race: each signed, and 0 for a crafty bot. */
export interface BotMisjudgement {
  /** Added to every gap it reads, metres. */
  readonly gapMetres: number;
  /** Added to the distance it reads to the line, metres. */
  readonly lineMetres: number;
  /** Added to the share of its W′ it reads it has left. */
  readonly wbalShare: number;
}

/** One number in `[−1, 1)` for this bot, window and quantity. */
function signedDraw(seed: number, botIndex: number, window: number, what: number): number {
  const key =
    raceRandom(seed).state ^
    TACTICS_SALT ^
    Math.imul(botIndex + 1, 0x85eb_ca6b) ^
    Math.imul(window + 1, 0xc2b2_ae35) ^
    Math.imul(what + 1, 0x27d4_eb2f);
  return 2 * nextUnit(raceRandom(key >>> 0)).value - 1;
}

/**
 * How far a bot of `skill` misreads the race in the window that holds `atMs`:
 * the same at every instant of the window, whatever the tick, and none at all
 * for a crafty bot. Two bots of different skill, the same capacity and the same
 * seat in the field misjudge by the same draws scaled differently.
 *
 * @param seed - the race's own seed, the one `createItemRace` took.
 * @param botIndex - the bot's seat in the field, from 0.
 * @param atMs - race time, ms.
 * @throws {LapRaceError} `seed-not-integer` for a seed that is not a safe whole
 *   number, `field-invalid` for a seat that is not a whole number of at least
 *   zero, and `instant-not-finite` for a time that is not a finite number of
 *   at least zero.
 */
export function botTacticsMisjudgement(
  seed: number,
  botIndex: number,
  skill: BotSkill,
  atMs: number,
): BotMisjudgement {
  raceRandom(seed);
  if (!Number.isSafeInteger(botIndex) || botIndex < 0) {
    throw new LapRaceError('field-invalid', 'a bot index must be a whole number of at least zero');
  }
  if (!Number.isFinite(atMs) || atMs < 0) {
    throw new LapRaceError('instant-not-finite', 'atMs must be a finite time of at least zero');
  }
  const scale = BOT_SKILL_MISJUDGEMENT[skill];
  const window = Math.floor(atMs / BOT_TACTICS_WINDOW_MS);
  return {
    gapMetres: signedDraw(seed, botIndex, window, 0) * BOT_TACTICS_MISJUDGE_GAP_METRES * scale,
    lineMetres: signedDraw(seed, botIndex, window, 1) * BOT_TACTICS_MISJUDGE_LINE_METRES * scale,
    wbalShare: signedDraw(seed, botIndex, window, 2) * BOT_TACTICS_MISJUDGE_WBAL_SHARE * scale,
  };
}
