// SPDX-License-Identifier: Apache-2.0

/**
 * #2709, ADR 0071 D-3, and #2836, ADR 0081: one bot's ask and the answer the
 * model may give, each read field by field — above all, a key the schema does
 * not name makes the whole answer nothing, so a power the model writes never
 * reaches a bot, a move off the menu is no decision, and an ask with a field
 * a coordinate or a name could ride in is refused. And the menu itself: the
 * two to four moves the device works out are sensible for a bot, from its
 * style, the terrain, its energy and its place.
 */

import { describe, expect, it } from 'vitest';

import {
  MODEL_MENU_CAUGHT_SECONDS,
  MODEL_MENU_QUIET_SECONDS,
  MODEL_STORY_BREAK_METRES,
  MODEL_TACTICS_ANSWER_MOST_CHARACTERS,
  MODEL_TACTICS_CUES,
  MODEL_TACTICS_INPUT_MOST_CHARACTERS,
  MODEL_TACTICS_MENU_MOST,
  MODEL_RACING_STYLES,
  MODEL_STRENGTH_WORDS,
  MODEL_TACTICS_MOST_SEATS,
  MODEL_TACTICS_REASONS,
  modelRacingStyles,
  modelTacticsAnswerSchema,
  modelTacticsAsk,
  modelTacticsBreak,
  modelTacticsBunch,
  modelTacticsMoveOf,
  modelTacticsOffer,
  modelTacticsStoryLine,
  readModelTacticsAnswer,
  readModelTacticsInput,
  type ModelRacingStyle,
  type ModelTacticsBotView,
  type ModelTacticsMenuEntry,
  type ModelTacticsRace,
  type ModelTacticsStory,
} from './model-tactics';
import {
  BOT_EFFORTS,
  BOT_TACTIC_BRIDGE_METRES,
  BOT_TACTIC_CLIMB_GRADE_PERCENT,
  BOT_TACTIC_FOLLOW_METRES,
  BOT_TACTIC_WBAL_FLOOR,
  BOT_TACTICS,
} from './tactics';

const SEATS = [0, 1, 2, 3, 4, 5, 6];

/** A menu with every kind of move on it: one that reads an effort, one with a target, two that read none. */
const MENU: readonly ModelTacticsMenuEntry[] = [
  { move: 'attack' },
  { move: 'follow', target: 2 },
  { move: 'recover' },
  { move: 'sit-in' },
];

const read = (value: unknown, menu: readonly ModelTacticsMenuEntry[] = MENU) =>
  readModelTacticsAnswer(typeof value === 'string' ? value : JSON.stringify(value), menu);

/** A bot mid-race, read off in full: second on the road, on a wheel, half its W′ spent, the flat ahead. */
const view = (over: Partial<ModelTacticsBotView> = {}): ModelTacticsBotView => ({
  bot: 1,
  style: 'climber',
  flat: 'average',
  climb: 'strong',
  sprint: 'weak',
  punch: 'average',
  rank: 2,
  ahead: 0,
  aheadMove: 'sit-in',
  gapAheadM: 2,
  gapBehindM: 1,
  wbal: 0.6,
  blown: false,
  drafting: true,
  move: 'sit-in',
  secondsInMove: 12,
  lapsLeft: 3,
  toLineM: 1_800,
  launchM: 250,
  gradeAheadPct: 0,
  riderGapM: -4,
  ...over,
});

/** A race that has had a move, 15 s ago: neither just caught nor quiet. */
const LULL = { quietS: 15, moved: true };

const offer = (
  over: Partial<ModelTacticsBotView> = {},
  lull: { quietS: number; moved: boolean } = LULL,
  climbInM: number | null = null,
) => modelTacticsOffer(view(over), lull, climbInM);

const moves = (menu: readonly ModelTacticsMenuEntry[]): string[] => menu.map((each) => each.move);

describe('the menu the device offers one bot (#2836, ADR 0081 D-2)', () => {
  it('offers a climber the attack on a climb, and not off it', () => {
    const on = offer({ gradeAheadPct: BOT_TACTIC_CLIMB_GRADE_PERCENT });
    expect(moves(on.menu)).toEqual(['attack', 'sit-in']);
    expect(on.cues).toContain('on-your-terrain');
    // Off its terrain, with nothing else to choose, there is nothing to ask.
    const off = offer({ gradeAheadPct: BOT_TACTIC_CLIMB_GRADE_PERCENT - 1 });
    expect(off.menu).toEqual([]);
    expect(off.cues).not.toContain('on-your-terrain');
  });

  it('offers a rouleur and a breakaway rider the attack on the flat and a descent, and not on a climb', () => {
    for (const style of ['rouleur', 'breakaway'] as const) {
      expect(moves(offer({ style, gradeAheadPct: 0 }).menu)).toContain('attack');
      expect(moves(offer({ style, gradeAheadPct: -6 }).menu)).toContain('attack');
      expect(offer({ style, gradeAheadPct: 5 }).menu).toEqual([]);
    }
  });

  it('offers a sprinter its kick inside the finish window on the last lap, and never an attack', () => {
    const sprinter = { style: 'sprinter' as const, lapsLeft: 1, launchM: 250 };
    const near = offer({ ...sprinter, toLineM: 500 });
    expect(moves(near.menu)).toEqual(['kick', 'sit-in']);
    expect(near.cues).toEqual(expect.arrayContaining(['on-your-terrain', 'finish-near']));
    // Outside the window, a lap early, and fresh in a quiet race: still no attack.
    expect(offer({ ...sprinter, toLineM: 501 }).menu).toEqual([]);
    expect(offer({ ...sprinter, lapsLeft: 2, toLineM: 500 }).menu).toEqual([]);
    expect(
      offer({ style: 'sprinter', wbal: 1 }, { quietS: MODEL_MENU_QUIET_SECONDS, moved: true }).menu,
    ).toEqual([]);
  });

  it('offers an opportunist the counter just after a move ended, and only then', () => {
    const counter = offer({ style: 'opportunist' }, { quietS: 3, moved: true });
    expect(moves(counter.menu)).toEqual(['attack', 'sit-in']);
    expect(counter.cues).toEqual(expect.arrayContaining(['on-your-terrain', 'move-just-caught']));
    const ended = { style: 'opportunist' as const };
    expect(offer(ended, { quietS: MODEL_MENU_CAUGHT_SECONDS, moved: true }).menu).not.toEqual([]);
    expect(offer(ended, { quietS: MODEL_MENU_CAUGHT_SECONDS + 1, moved: true }).menu).toEqual([]);
    // A move still on is not one caught, and a race with no move yet has none to counter.
    expect(offer(ended, { quietS: 0, moved: true }).menu).toEqual([]);
    expect(offer(ended, { quietS: 3, moved: false }).menu).toEqual([]);
  });

  it('offers any bot but a sprinter the attack when it is fresh and the race is quiet', () => {
    const quiet = { quietS: MODEL_MENU_QUIET_SECONDS, moved: true };
    const fresh = offer({ wbal: 0.8 }, quiet);
    expect(moves(fresh.menu)).toEqual(['attack', 'sit-in']);
    expect(fresh.cues).toEqual(expect.arrayContaining(['fresh', 'race-quiet']));
    expect(offer({ wbal: 0.7 }, quiet).menu).toEqual([]);
    expect(
      offer({ wbal: 0.8 }, { quietS: MODEL_MENU_QUIET_SECONDS - 1, moved: true }).menu,
    ).toEqual([]);
  });

  it('offers no attack and no chase under the W′ floor, on its terrain or not', () => {
    const low = offer({
      gradeAheadPct: 6,
      wbal: BOT_TACTIC_WBAL_FLOOR - 0.1,
      gapAheadM: 60,
    });
    expect(moves(low.menu)).toEqual(['recover', 'sit-in']);
    expect(low.cues).toContain('tiring');
    const enough = offer({ gradeAheadPct: 6, wbal: BOT_TACTIC_WBAL_FLOOR, gapAheadM: 60 });
    expect(moves(enough.menu)).toEqual(['attack', 'chase', 'recover', 'sit-in']);
  });

  it('offers nothing to a blown bot, nor to one inside its launch: the body and the sprint instinct decide', () => {
    const climbing = { gradeAheadPct: 6, wbal: 0.9 };
    expect(offer(climbing).menu).not.toEqual([]);
    expect(offer({ ...climbing, blown: true }).menu).toEqual([]);
    expect(offer({ ...climbing, lapsLeft: 1, toLineM: 250, launchM: 250 }).menu).toEqual([]);
    expect(offer({ ...climbing, lapsLeft: 1, toLineM: 251, launchM: 250 }).menu).not.toEqual([]);
  });

  it('offers to follow a move just ahead, aimed at that racer, and to chase one across a gap', () => {
    const mover = offer({ style: 'sprinter', ahead: 4, aheadMove: 'attack', gapAheadM: 20 });
    expect(mover.menu).toEqual([{ move: 'follow', target: 4 }, { move: 'sit-in' }]);
    expect(mover.cues).toContain('move-ahead');
    // The rider's move is covered the same way; a wheel sitting in is not a move.
    expect(
      offer({ style: 'sprinter', ahead: 'rider', aheadMove: 'attack', gapAheadM: 20 }).menu[0],
    ).toEqual({ move: 'follow', target: 'rider' });
    expect(offer({ style: 'sprinter', aheadMove: 'sit-in', gapAheadM: 20 }).menu).toEqual([]);
    expect(
      offer({ style: 'sprinter', aheadMove: 'attack', gapAheadM: BOT_TACTIC_FOLLOW_METRES + 1 })
        .cues,
    ).not.toContain('move-ahead');
    // Out of the draft and within reach: a chase, to the racer ahead.
    expect(offer({ style: 'sprinter', gapAheadM: 60 }).menu).toEqual([
      { move: 'chase', target: 0 },
      { move: 'sit-in' },
    ]);
    expect(offer({ style: 'sprinter', gapAheadM: BOT_TACTIC_BRIDGE_METRES + 1 }).menu).toEqual([]);
    expect(offer({ style: 'sprinter', gapAheadM: 30 }).menu).toEqual([]);
  });

  it('offers a flyer to a breakaway rider on any lap and to a rouleur in the last two, with the W′ for it', () => {
    expect(moves(offer({ style: 'breakaway', lapsLeft: 5 }).menu)).toContain('flyer');
    expect(moves(offer({ style: 'breakaway', wbal: 0.5 }).menu)).not.toContain('flyer');
    expect(moves(offer({ style: 'rouleur', lapsLeft: 3 }).menu)).not.toContain('flyer');
    expect(moves(offer({ style: 'rouleur', lapsLeft: 2 }).menu)).toContain('flyer');
    expect(moves(offer({ style: 'climber', lapsLeft: 1, gradeAheadPct: 6 }).menu)).not.toContain(
      'flyer',
    );
  });

  it('keeps the move a bot is in on its menu, so it can be held', () => {
    // A climber attacking, now off the climb: the attack is no longer its terrain's, and still on offer.
    expect(moves(offer({ move: 'attack' }).menu)).toEqual(['attack', 'sit-in']);
    expect(offer({ move: 'chase', ahead: 3 }).menu[0]).toEqual({ move: 'chase', target: 3 });
    // Recovering or sitting in is no move to hold.
    expect(offer({ move: 'recover' }).menu).toEqual([]);
  });

  it('holds two to four moves, each once, sitting in always last', () => {
    const styles: readonly ModelRacingStyle[] = MODEL_RACING_STYLES;
    let asked = 0;
    for (const style of styles) {
      for (const gradeAheadPct of [-5, 0, 6]) {
        for (const wbal of [0.1, 0.4, 0.7, 1]) {
          for (const gapAheadM of [null, 2, 60]) {
            for (const move of ['sit-in', 'attack', 'flyer'] as const) {
              const { menu } = offer(
                { style, gradeAheadPct, wbal, gapAheadM, move, aheadMove: 'attack', lapsLeft: 1 },
                { quietS: 40, moved: true },
              );
              if (menu.length === 0) continue;
              asked += 1;
              expect(menu.length).toBeGreaterThanOrEqual(2);
              expect(menu.length).toBeLessThanOrEqual(MODEL_TACTICS_MENU_MOST);
              expect(menu.at(-1)).toEqual({ move: 'sit-in' });
              expect(new Set(moves(menu)).size).toBe(menu.length);
            }
          }
        }
      }
    }
    expect(asked).toBeGreaterThan(100);
  });

  it('says a climb is coming only before it, and the last lap and the finish window as the bot reads them', () => {
    expect(offer({}, LULL, 300).cues).toContain('climb-soon');
    expect(offer({}, LULL, 301).cues).not.toContain('climb-soon');
    expect(offer({}, LULL, null).cues).not.toContain('climb-soon');
    expect(offer({ gradeAheadPct: 6 }, LULL, 0).cues).not.toContain('climb-soon');
    expect(offer({ lapsLeft: 1 }).cues).toContain('last-lap');
    expect(offer({ lapsLeft: 2 }).cues).not.toContain('last-lap');
  });

  it('sends its cue words in the list’s own order, each once', () => {
    const { cues } = offer(
      { style: 'sprinter', lapsLeft: 1, toLineM: 400, wbal: 1, aheadMove: 'kick', gapAheadM: 5 },
      { quietS: 40, moved: true },
      100,
    );
    expect(cues).toEqual(MODEL_TACTICS_CUES.filter((cue) => cues.includes(cue)));
    expect(cues).toEqual([
      'on-your-terrain',
      'climb-soon',
      'fresh',
      'move-ahead',
      'race-quiet',
      'last-lap',
      'finish-near',
    ]);
  });
});

describe('the story so far, in numbers and closed words (#2836, ADR 0081 D-4.4)', () => {
  it('finds the break: the racers clear of the rest by the draft’s reach, when they are at most half the field', () => {
    expect(modelTacticsBreak([900, 898, 896, 894])).toBeNull();
    expect(modelTacticsBreak([900, 898 - MODEL_STORY_BREAK_METRES, 860, 858])).toEqual({
      racers: 1,
      gapM: MODEL_STORY_BREAK_METRES + 2,
    });
    expect(modelTacticsBreak([900, 899, 840, 838])).toEqual({ racers: 2, gapM: 59 });
    // Three of four ahead of the gap is a bunch that dropped a rider, not a break.
    expect(modelTacticsBreak([900, 899, 898, 800])).toBeNull();
    expect(modelTacticsBreak([900, 871])).toBeNull();
    expect(modelTacticsBreak([])).toBeNull();
  });

  it('says how the bots are for energy, by the mean of their W′', () => {
    expect(modelTacticsBunch([1, 0.8, 0.6])).toBe('fresh');
    expect(modelTacticsBunch([0.7, 0.7])).toBe('fresh');
    expect(modelTacticsBunch([0.6, 0.6])).toBe('tiring');
    expect(modelTacticsBunch([0.4, 0.4])).toBe('tiring');
    expect(modelTacticsBunch([0.3, 0.4])).toBe('tired');
    expect(modelTacticsBunch([])).toBe('fresh');
  });

  it('writes one line from it, in a fixed order', () => {
    const story: ModelTacticsStory = {
      raceS: 130,
      lapsLeft: 1,
      quietS: 0,
      moved: true,
      away: { racers: 2, s: 40, gapM: 60 },
      bunch: 'tiring',
    };
    expect(modelTacticsStoryLine(story)).toBe(
      '130 s raced; last lap; a break of 2 away for 40 s, 60 m clear; a move is on now; the bots are tiring.',
    );
    expect(
      modelTacticsStoryLine({ ...story, lapsLeft: 3, away: null, moved: false, bunch: 'fresh' }),
    ).toBe('130 s raced; 3 laps left; nobody away; no attack yet; the bots are fresh.');
    expect(modelTacticsStoryLine({ ...story, quietS: 6 })).toContain('a move ended 6 s ago');
    expect(modelTacticsStoryLine({ ...story, quietS: 45 })).toContain('quiet for 45 s');
  });
});

const RIDER = {
  rank: 1,
  wPerKg: 3.1,
  ahead: null,
  gapAheadM: null,
  gapBehindM: 4,
  drafting: false,
};

const RACE: ModelTacticsRace = {
  laps: 3,
  quietS: 40,
  rider: RIDER,
  bots: [
    view({ bot: 0, style: 'rouleur', rank: 2, ahead: 'rider', aheadMove: null, gapAheadM: 4 }),
    view({ bot: 1, rank: 3, ahead: 0, gradeAheadPct: 6, wbal: 0.9, lapsLeft: 2 }),
    view({ bot: 2, style: 'sprinter', rank: 4, ahead: 1, wbal: 0.5 }),
  ],
  course: {
    climb: { inM: 40, lengthM: 600, avgPct: 6, maxPct: 9 },
    descent: null,
    lapLeftM: 700,
    lapClimbM: 38,
    finishPct: 0,
  },
};

const FACTS = {
  sinceMoveS: 95,
  raceS: 130,
  away: null,
  moved: true,
  climbInM: 40,
};

/** The ask for the climber in seat 1, as a device sends it. */
const ask = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(modelTacticsAsk(RACE, 1, FACTS))) as Record<string, unknown>;

const withYou = (over: Record<string, unknown>): Record<string, unknown> => {
  const base = ask();
  return { ...base, you: { ...(base.you as Record<string, unknown>), ...over } };
};

describe('one bot’s ask, made from the race (#2836, ADR 0081 D-2)', () => {
  it('puts the shared race first and the bot last, with its cues and its menu', () => {
    const made = modelTacticsAsk(RACE, 1, FACTS);
    expect(Object.keys(made ?? {})).toEqual(['laps', 'course', 'rider', 'field', 'story', 'you']);
    expect(made?.field).toEqual([
      { bot: 0, style: 'rouleur', rank: 2, move: 'sit-in', gapAheadM: 4 },
      { bot: 1, style: 'climber', rank: 3, move: 'sit-in', gapAheadM: 2 },
      { bot: 2, style: 'sprinter', rank: 4, move: 'sit-in', gapAheadM: 2 },
    ]);
    expect(made?.story).toEqual({
      raceS: 130,
      // The leading bot's: the least of the field's.
      lapsLeft: 2,
      quietS: 40,
      moved: true,
      away: null,
      bunch: 'tiring',
    });
    expect(made?.you).toMatchObject({
      bot: 1,
      style: 'climber',
      climb: 'strong',
      sinceMoveS: 95,
      rank: 3,
      wbal: 0.9,
      climbInM: 40,
      cues: ['on-your-terrain', 'fresh', 'race-quiet'],
      menu: [{ move: 'attack' }, { move: 'sit-in' }],
    });
    // The seconds since its last move come before its current move.
    const keys = Object.keys(made?.you ?? {});
    expect(keys.indexOf('sinceMoveS')).toBeLessThan(keys.indexOf('move'));
    expect(keys.slice(-2)).toEqual(['cues', 'menu']);
    // Not sent: what the menu already settled.
    for (const key of ['blown', 'launchM', 'ahead', 'aheadMove']) expect(keys).not.toContain(key);
  });

  it('is read by the instance’s own reader', () => {
    expect(readModelTacticsInput(ask())).toMatchObject({ ok: true });
    expect(JSON.stringify(ask()).length).toBeLessThan(MODEL_TACTICS_INPUT_MOST_CHARACTERS / 2);
  });

  it('is nothing for a bot with nothing to choose, and for a seat that is not racing', () => {
    // The sprinter in seat 2: mid-race on a wheel, no move ahead, nothing to choose.
    expect(modelTacticsAsk(RACE, 2, FACTS)).toBeUndefined();
    expect(modelTacticsAsk(RACE, 6, FACTS)).toBeUndefined();
    expect(modelTacticsAsk(RACE, 1, FACTS)).toBeDefined();
  });
});

describe('the racing styles’ deal (ADR 0073 D-5.1)', () => {
  it('deals every style once before any twice, the same field from the same seed', () => {
    for (const seed of [0, 1, 7, 4_000_000_000]) {
      const seven = modelRacingStyles(seed, 7);
      expect(new Set(seven.slice()).size).toBe(MODEL_RACING_STYLES.length);
      for (const style of MODEL_RACING_STYLES) {
        expect(seven.filter((each) => each === style).length).toBeGreaterThanOrEqual(1);
        expect(seven.filter((each) => each === style).length).toBeLessThanOrEqual(2);
      }
      expect(modelRacingStyles(seed, 7)).toEqual(seven);
      expect([...new Set(modelRacingStyles(seed, 3))]).toHaveLength(3);
    }
  });

  it('shuffles the deal by the seed', () => {
    const deals = new Set([1, 2, 3, 4, 5, 6].map((seed) => modelRacingStyles(seed, 5).join()));
    expect(deals.size).toBeGreaterThan(1);
  });
});

describe('a model tactics answer (#2709, ADR 0071 D-3.2; one bot’s pick since #2836)', () => {
  it('reads the reason, the move and an effort', () => {
    expect(read({ reason: 'my-terrain', move: 'attack', effort: 'all-out' })).toEqual({
      ok: true,
      pick: { reason: 'my-terrain', move: 'attack', effort: 'all-out' },
    });
    expect(read({ reason: 'save-legs', move: 'sit-in' })).toEqual({
      ok: true,
      pick: { reason: 'save-legs', move: 'sit-in' },
    });
  });

  it('reads each reason word, and is nothing with none or with any other', () => {
    for (const reason of MODEL_TACTICS_REASONS) {
      expect(read({ reason, move: 'attack' })).toMatchObject({ ok: true, pick: { reason } });
    }
    expect(read({ move: 'attack' })).toEqual({ ok: false, reason: 'bad-reason' });
    expect(read({ reason: 'because it is Tuesday', move: 'attack' })).toEqual({
      ok: false,
      reason: 'bad-reason',
    });
    expect(read({ reason: 3, move: 'attack' })).toEqual({ ok: false, reason: 'bad-reason' });
  });

  it('is nothing for a move off the menu, and for one outside the seven', () => {
    expect(read({ reason: 'counter', move: 'flyer' })).toEqual({ ok: false, reason: 'off-menu' });
    expect(read({ reason: 'counter', move: 'kick' })).toEqual({ ok: false, reason: 'off-menu' });
    expect(read({ reason: 'counter', move: 'erg' })).toEqual({ ok: false, reason: 'bad-move' });
    expect(read({ reason: 'counter' })).toEqual({ ok: false, reason: 'bad-move' });
    // Every move reads when it is on the menu.
    for (const move of BOT_TACTICS) {
      expect(read({ reason: 'counter', move }, [{ move }, { move: 'sit-in' }])).toMatchObject({
        ok: true,
        pick: { move },
      });
    }
  });

  it('is nothing at all for a watts field, a target, or any other key the schema does not name', () => {
    for (const extra of [
      { watts: 900 },
      { power: 'max' },
      { target: 2 },
      { bot: 1 },
      { say: 'go' },
    ]) {
      expect(read({ reason: 'counter', move: 'attack', ...extra })).toEqual({
        ok: false,
        reason: 'unknown-key',
      });
    }
  });

  it('reads an effort from the closed list, refuses a number or a word outside it, and keeps none on a move that reads none', () => {
    for (const effort of BOT_EFFORTS) {
      expect(read({ reason: 'counter', move: 'attack', effort })).toMatchObject({
        ok: true,
        pick: { effort },
      });
    }
    expect(read({ reason: 'counter', move: 'attack', effort: null })).toEqual({
      ok: true,
      pick: { reason: 'counter', move: 'attack' },
    });
    expect(read({ reason: 'counter', move: 'attack', effort: 400 })).toEqual({
      ok: false,
      reason: 'bad-effort',
    });
    expect(read({ reason: 'counter', move: 'attack', effort: 'max' })).toEqual({
      ok: false,
      reason: 'bad-effort',
    });
    for (const move of ['sit-in', 'recover'] as const) {
      expect(read({ reason: 'save-legs', move, effort: 'all-out' })).toEqual({
        ok: true,
        pick: { reason: 'save-legs', move },
      });
    }
  });

  it('is nothing for text that is not JSON or not an object', () => {
    expect(read('attack')).toEqual({ ok: false, reason: 'not-json' });
    expect(read('')).toEqual({ ok: false, reason: 'not-json' });
    expect(read([{ reason: 'counter', move: 'attack' }])).toEqual({
      ok: false,
      reason: 'not-an-object',
    });
    expect(read('"attack"')).toEqual({ ok: false, reason: 'not-an-object' });
  });

  it('is nothing past its length cap, before it is parsed', () => {
    const long = JSON.stringify({
      reason: 'counter',
      move: 'attack',
      effort: 'x'.repeat(MODEL_TACTICS_ANSWER_MOST_CHARACTERS),
    });
    expect(read(long)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('rides the pick as the bot’s move, the target the menu’s and never the model’s', () => {
    expect(modelTacticsMoveOf(4, { reason: 'cover-move', move: 'follow' }, MENU)).toEqual({
      bot: 4,
      move: 'follow',
      target: 2,
    });
    expect(
      modelTacticsMoveOf(4, { reason: 'my-terrain', move: 'attack', effort: 'threshold' }, MENU),
    ).toEqual({ bot: 4, move: 'attack', effort: 'threshold' });
  });
});

describe('the answer’s schema, built from the menu (ADR 0081 D-3, D-4.6)', () => {
  type Shape = {
    properties: Record<string, { enum: string[] }>;
    required: string[];
    additionalProperties: boolean;
  };

  it('asks for the reason first and requires it, offers the menu’s moves only, and no effort on sit-in or recover', () => {
    const schema = modelTacticsAnswerSchema(MENU) as { anyOf: Shape[] };
    const [ridden, effortless] = schema.anyOf;
    expect(schema.anyOf).toHaveLength(2);
    expect(Object.keys(ridden?.properties ?? {})).toEqual(['reason', 'move', 'effort']);
    expect(Object.keys(effortless?.properties ?? {})).toEqual(['reason', 'move']);
    expect(ridden?.properties.move?.enum).toEqual(['attack', 'follow']);
    expect(effortless?.properties.move?.enum).toEqual(['recover', 'sit-in']);
    for (const shape of schema.anyOf) {
      expect(shape.required).toEqual(['reason', 'move']);
      expect(shape.additionalProperties).toBe(false);
      expect(shape.properties.reason?.enum).toEqual([...MODEL_TACTICS_REASONS]);
    }
    expect(ridden?.properties.effort?.enum).toEqual([...BOT_EFFORTS]);
  });

  it('has no power field, no target and no number anywhere', () => {
    const text = JSON.stringify(modelTacticsAnswerSchema(MENU));
    expect(text).not.toMatch(/watt|power|target|integer|number/i);
    // A menu of sitting in and recovering alone is one shape, with no effort at all.
    const plain = modelTacticsAnswerSchema([{ move: 'recover' }, { move: 'sit-in' }]) as Shape;
    expect(Object.keys(plain.properties)).toEqual(['reason', 'move']);
    expect(JSON.stringify(plain)).not.toContain('effort');
  });
});

describe('an ask, read as a device sent it (#2709, ADR 0071 D-3.4; one bot’s since #2836)', () => {
  const refused = (value: unknown, field: string, problem?: string) => {
    const got = readModelTacticsInput(value);
    expect(got, field).toMatchObject({
      ok: false,
      problem: { field, ...(problem === undefined ? {} : { problem }) },
    });
    return got;
  };

  it('refuses a field it does not name — anywhere a coordinate or a name could ride', () => {
    const extra = 'has a field this race state does not';
    const base = ask();
    refused({ ...base, lat: 51.5 }, 'input', extra);
    refused({ ...base, rider: { ...RIDER, name: 'Alex' } }, 'input.rider', extra);
    refused(withYou({ place: 'Richmond Park' }), 'input.you', extra);
    refused(
      { ...base, story: { ...(base.story as object), note: 'near home' } },
      'input.story',
      extra,
    );
    refused(
      { ...base, field: [{ ...(base.field as object[])[0], name: 'Alex' }] },
      'input.field[0]',
      extra,
    );
    refused(
      withYou({ menu: [{ move: 'attack', watts: 400 }, { move: 'sit-in' }] }),
      'input.you.menu[0]',
      extra,
    );
    // The shape sent before #2836, one race state for the whole field, is not an ask.
    refused({ laps: 3, quietS: 40, rider: RIDER, bots: RACE.bots }, 'input', extra);
  });

  it('refuses a missing field, naming it', () => {
    const without = (value: Record<string, unknown>, key: string) =>
      Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
    const base = ask();
    refused(without(base, 'rider'), 'input.rider', 'is required');
    refused(without(base, 'you'), 'input.you', 'is required');
    refused(without(base, 'story'), 'input.story', 'is required');
    refused(
      { ...base, you: without(base.you as Record<string, unknown>, 'menu') },
      'input.you.menu',
      'is required',
    );
    refused(
      { ...base, you: without(base.you as Record<string, unknown>, 'sinceMoveS') },
      'input.you.sinceMoveS',
      'is required',
    );
    // The course ahead may be left out, as it could be before #2836.
    expect(readModelTacticsInput(without(base, 'course'))).toMatchObject({ ok: true });
  });

  it('refuses text where a word from a closed list goes, and never echoes the value', () => {
    const named = refused(
      withYou({ style: '51.5072,-0.1276' }),
      'input.you.style',
      'must be a racing style',
    );
    expect(JSON.stringify(named)).not.toContain('51.5072');
    refused(withYou({ move: 'erg' }), 'input.you.move', 'must be one of the seven moves');
    refused(withYou({ cues: ['near Richmond Park'] }), 'input.you.cues');
    refused(withYou({ cues: ['fresh', 'fresh'] }), 'input.you.cues');
    refused(
      { ...ask(), story: { ...(ask().story as object), bunch: 'lively' } },
      'input.story.bunch',
    );
    for (const key of ['flat', 'climb', 'sprint', 'punch']) {
      refused(withYou({ [key]: 'mighty' }), `input.you.${key}`, 'must be a strength word');
      for (const word of MODEL_STRENGTH_WORDS) {
        expect(readModelTacticsInput(withYou({ [key]: word }))).toMatchObject({ ok: true });
      }
    }
  });

  it('refuses each number out of its range or of the wrong kind', () => {
    const cases: readonly (readonly [string, unknown])[] = [
      ['bot', MODEL_TACTICS_MOST_SEATS],
      ['sinceMoveS', -1],
      ['sinceMoveS', 1.5],
      ['secondsInMove', -1],
      ['rank', 0],
      ['gapAheadM', -1],
      ['gapBehindM', '2'],
      ['riderGapM', Number.NaN],
      ['wbal', 1.2],
      ['drafting', 'yes'],
      ['lapsLeft', 1.5],
      ['toLineM', 2_000_000],
      ['gradeAheadPct', 150],
      ['climbInM', -10],
    ];
    for (const [key, value] of cases) refused(withYou({ [key]: value }), `input.you.${key}`);
    const base = ask();
    refused({ ...base, laps: 0 }, 'input.laps');
    refused({ ...base, rider: { ...RIDER, wPerKg: 99 } }, 'input.rider.wPerKg');
    refused({ ...base, rider: { ...RIDER, rank: 9 } }, 'input.rider.rank');
    const story = base.story as Record<string, unknown>;
    refused({ ...base, story: { ...story, raceS: 1.5 } }, 'input.story.raceS');
    refused({ ...base, story: { ...story, moved: 'yes' } }, 'input.story.moved');
    refused(
      { ...base, story: { ...story, away: { racers: 0, s: 4, gapM: 40 } } },
      'input.story.away.racers',
    );
    refused(
      { ...base, story: { ...story, away: { racers: 2, s: 4, gapM: 40, where: 'the hill' } } },
      'input.story.away',
    );
    expect(
      readModelTacticsInput({ ...base, story: { ...story, away: { racers: 2, s: 4, gapM: 40 } } }),
    ).toMatchObject({ ok: true });
  });

  it('refuses a menu that is not two to four different moves, or names a target where none is read', () => {
    refused(withYou({ menu: [{ move: 'sit-in' }] }), 'input.you.menu');
    refused(
      withYou({
        menu: ['attack', 'flyer', 'chase', 'recover', 'sit-in'].map((move) => ({ move })),
      }),
      'input.you.menu',
    );
    refused(withYou({ menu: 'attack' }), 'input.you.menu');
    refused(withYou({ menu: [{ move: 'attack' }, { move: 'attack' }] }), 'input.you.menu[1].move');
    refused(withYou({ menu: [{ move: 'erg' }, { move: 'sit-in' }] }), 'input.you.menu[0].move');
    refused(
      withYou({ menu: [{ move: 'attack', target: 2 }, { move: 'sit-in' }] }),
      'input.you.menu[0].target',
    );
    refused(
      withYou({ menu: [{ move: 'follow', target: 'the rider in red' }, { move: 'sit-in' }] }),
      'input.you.menu[0].target',
    );
    expect(
      readModelTacticsInput(
        withYou({
          menu: [
            { move: 'follow', target: 'rider' },
            { move: 'chase', target: 0 },
          ],
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it('refuses no bots, too many, a seat twice, a bot asked about that is not in the field, and an ask that is not an object', () => {
    const base = ask();
    const one = (base.field as Record<string, unknown>[])[1] as Record<string, unknown>;
    refused({ ...base, field: [] }, 'input.field');
    refused({ ...base, field: [...SEATS, 7].map((bot) => ({ ...one, bot })) }, 'input.field');
    refused({ ...base, field: [one, one] }, 'input.field[1].bot', 'must not repeat a seat');
    refused(
      { ...base, field: [{ ...one, bot: 5 }] },
      'input.you.bot',
      'must be a bot in the field',
    );
    refused('laps', 'input', 'must be an object');
    refused([base], 'input', 'must be an object');
  });

  it('reads the course ahead, and refuses one that carries anything but its numbers (#2794)', () => {
    const base = ask();
    const course = base.course as Record<string, unknown>;
    refused({ ...base, course: { ...course, name: 'Box Hill' } }, 'input.course');
    refused({ ...base, course: { ...course, finishPct: 'steep' } }, 'input.course.finishPct');
    refused({ ...base, course: { ...course, climb: { inM: 40 } } }, 'input.course.climb');
  });

  it('refuses an ask longer than its cap, before its fields are read', () => {
    const got = readModelTacticsInput({
      ...ask(),
      padding: 'x'.repeat(MODEL_TACTICS_INPUT_MOST_CHARACTERS),
    });
    expect(got).toEqual({
      ok: false,
      problem: {
        field: 'input',
        problem: `must be at most ${String(MODEL_TACTICS_INPUT_MOST_CHARACTERS)} characters`,
      },
    });
  });
});
