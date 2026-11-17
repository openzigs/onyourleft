// SPDX-License-Identifier: Apache-2.0

/**
 * #2709, ADR 0071 D-3: the race state a model is shown and the answer it may
 * give, each read field by field — above all, a key the schema does not name
 * makes the whole answer nothing, so a power the model writes never reaches a
 * bot, and a race state with a field a coordinate or a name could ride in is
 * refused.
 */

import { describe, expect, it } from 'vitest';

import {
  MODEL_TACTICS_ANSWER_MOST_CHARACTERS,
  MODEL_TACTICS_INPUT_MOST_CHARACTERS,
  MODEL_RACING_STYLES,
  MODEL_STRENGTH_WORDS,
  MODEL_TACTICS_MOST_SEATS,
  modelRacingStyles,
  modelTacticsAnswerSchema,
  modelTacticsSeats,
  readModelTacticsAnswer,
  readModelTacticsInput,
  type ModelTacticsBotView,
  type ModelTacticsInput,
} from './model-tactics';
import { BOT_TACTICS } from './tactics';

const SEATS = [0, 1, 2, 3, 4, 5, 6];

const read = (value: unknown, seats: readonly number[] = SEATS) =>
  readModelTacticsAnswer(typeof value === 'string' ? value : JSON.stringify(value), seats);

const view = (bot: number, over: Partial<Record<keyof ModelTacticsBotView, unknown>> = {}) => ({
  bot,
  style: 'opportunist',
  legs: 'rouleur',
  flat: 'strong',
  climb: 'weak',
  sprint: 'average',
  punch: 'average',
  rank: bot + 1,
  ahead: bot === 0 ? null : bot - 1,
  aheadMove: bot === 0 ? null : 'sit-in',
  gapAheadM: bot === 0 ? null : 2.5,
  gapBehindM: 1.2,
  wbal: 0.8,
  blown: false,
  drafting: true,
  move: 'sit-in',
  secondsInMove: 12,
  lapsLeft: 3,
  toLineM: 1_800,
  launchM: 250,
  gradeAheadPct: 1.5,
  riderGapM: -4.2,
  ...over,
});

const RIDER = { rank: 4, wPerKg: 3.1, ahead: 2, gapAheadM: 1.5, gapBehindM: 0.8, drafting: true };

const input = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  laps: 3,
  field: 8,
  quietS: 40,
  rider: RIDER,
  bots: SEATS.map((seat) => view(seat)),
  ...over,
});

describe('the race state ADR 0073 D-5 shows (#2710)', () => {
  it('reads who is ahead, that bot’s move, the seconds held and the lull', () => {
    const got = readModelTacticsInput(
      input({
        quietS: 12,
        bots: [
          view(0, { ahead: 'rider', aheadMove: null }),
          view(1, { ahead: 0, aheadMove: 'attack' }),
        ],
      }),
    );
    expect(got.ok).toBe(true);
  });

  it('refuses each of the five fields out of its range, naming it', () => {
    const bot = (over: Record<string, unknown>, field: string) => {
      const got = readModelTacticsInput(input({ bots: [view(0, over)] }));
      expect(got.ok ? undefined : got.problem.field).toBe(`input.bots[0].${field}`);
    };
    bot({ ahead: 7 }, 'ahead');
    bot({ ahead: 'Alex' }, 'ahead');
    bot({ aheadMove: 'erg' }, 'aheadMove');
    bot({ secondsInMove: -1 }, 'secondsInMove');
    bot({ secondsInMove: 1.5 }, 'secondsInMove');
    const top = (over: Record<string, unknown>) => {
      const got = readModelTacticsInput(input(over));
      return got.ok ? undefined : got.problem.field;
    };
    expect(top({ quietS: -1 })).toBe('input.quietS');
  });

  it('has no attack gate: a state that still carries one is refused (D-5.3)', () => {
    expect(readModelTacticsInput(input({ attackOpen: true }))).toEqual({
      ok: false,
      problem: { field: 'input', problem: 'has a field this race state does not' },
    });
  });

  it('reads each bot’s racing style apart from its legs, and whether it is blown (D-5.1, D-5.4)', () => {
    for (const style of MODEL_RACING_STYLES) {
      expect(readModelTacticsInput(input({ bots: [view(0, { style, blown: true })] })).ok).toBe(
        true,
      );
    }
    const bot = (over: Record<string, unknown>) => {
      const got = readModelTacticsInput(input({ bots: [view(0, over)] }));
      return got.ok ? undefined : got.problem;
    };
    // An archetype is legs, not a style; a style is not legs.
    expect(bot({ style: 'attacker' })).toEqual({
      field: 'input.bots[0].style',
      problem: 'must be a racing style',
    });
    expect(bot({ legs: 'breakaway' })).toEqual({
      field: 'input.bots[0].legs',
      problem: 'must be an archetype',
    });
    expect(bot({ blown: 'yes' })?.field).toBe('input.bots[0].blown');
  });

  it('reads how each bot compares with the field in a closed word, and refuses any other (#2759, ADR 0075 D-4)', () => {
    for (const word of MODEL_STRENGTH_WORDS) {
      for (const key of ['flat', 'climb', 'sprint', 'punch']) {
        expect(readModelTacticsInput(input({ bots: [view(0, { [key]: word })] })).ok).toBe(true);
      }
    }
    for (const key of ['flat', 'climb', 'sprint', 'punch']) {
      for (const bad of ['very strong', 1.2, null, true]) {
        expect(readModelTacticsInput(input({ bots: [view(0, { [key]: bad })] }))).toEqual({
          ok: false,
          problem: { field: `input.bots[0].${key}`, problem: 'must be a strength word' },
        });
      }
      const without = { ...view(0) } as Record<string, unknown>;
      delete without[key];
      expect(readModelTacticsInput(input({ bots: [without] }))).toEqual({
        ok: false,
        problem: { field: `input.bots[0].${key}`, problem: 'is required' },
      });
    }
  });

  it('reads the rider’s state, and refuses each of its fields out of range (D-5.2)', () => {
    const leading = {
      rank: 1,
      wPerKg: null,
      ahead: null,
      gapAheadM: null,
      gapBehindM: null,
      drafting: false,
    };
    expect(readModelTacticsInput(input({ rider: leading })).ok).toBe(true);
    const rider = (over: Record<string, unknown>) => {
      const got = readModelTacticsInput(input({ rider: { ...RIDER, ...over } }));
      return got.ok ? undefined : got.problem.field;
    };
    expect(rider({ ahead: 'rider' })).toBe('input.rider.ahead');
    expect(rider({ ahead: MODEL_TACTICS_MOST_SEATS })).toBe('input.rider.ahead');
    expect(rider({ gapAheadM: -1 })).toBe('input.rider.gapAheadM');
    expect(rider({ gapBehindM: '2' })).toBe('input.rider.gapBehindM');
    expect(rider({ drafting: null })).toBe('input.rider.drafting');
    expect(readModelTacticsInput(input({ rider: { rank: 4, wPerKg: 3.1 } }))).toEqual({
      ok: false,
      problem: { field: 'input.rider.ahead', problem: 'is required' },
    });
  });

  it('fits seven bots at their longest under the cap', () => {
    const longest = input({
      bots: SEATS.map((seat) =>
        view(seat, {
          style: 'opportunist',
          legs: 'attacker',
          flat: 'average',
          climb: 'average',
          sprint: 'average',
          punch: 'average',
          ahead: 'rider',
          aheadMove: 'recover',
          gapAheadM: 99_999.9,
          gapBehindM: 99_999.9,
          wbal: 0.45,
          move: 'recover',
          secondsInMove: 86_400,
          lapsLeft: 100,
          toLineM: -999_999,
          launchM: 99_999,
          gradeAheadPct: -12.5,
          riderGapM: -99_999.9,
        }),
      ),
    });
    expect(readModelTacticsInput(longest).ok).toBe(true);
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

describe('a model tactics answer (#2709, ADR 0071 D-3.2)', () => {
  it('reads every move it names, a target kept, a bot it does not name left out', () => {
    expect(
      read({
        bots: [
          { bot: 0, move: 'attack' },
          { bot: 3, move: 'chase', target: 2 },
          { bot: 6, move: 'follow', target: 'rider' },
        ],
      }),
    ).toEqual({
      ok: true,
      moves: [
        { bot: 0, move: 'attack' },
        { bot: 3, move: 'chase', target: 2 },
        { bot: 6, move: 'follow', target: 'rider' },
      ],
    });
  });

  it('reads each of the seven moves, a null target as none, and an empty list as no move', () => {
    for (const move of BOT_TACTICS) {
      expect(read({ bots: [{ bot: 1, move, target: null }] })).toEqual({
        ok: true,
        moves: [{ bot: 1, move }],
      });
    }
    expect(read({ bots: [] })).toEqual({ ok: true, moves: [] });
  });

  it('is nothing at all for a watts field, or any other key the schema does not name', () => {
    expect(read({ bots: [{ bot: 0, move: 'attack', watts: 900 }] })).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    expect(read({ bots: [{ bot: 0, move: 'attack' }], watts: 900 })).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
  });

  it('is nothing for a move outside the seven, a seat outside the field, or a seat twice', () => {
    expect(read({ bots: [{ bot: 0, move: 'erg' }] })).toEqual({ ok: false, reason: 'bad-move' });
    expect(read({ bots: [{ bot: 0 }] })).toEqual({ ok: false, reason: 'bad-move' });
    expect(read({ bots: [{ bot: 7, move: 'attack' }] })).toEqual({ ok: false, reason: 'bad-bot' });
    expect(read({ bots: [{ bot: 1.5, move: 'attack' }] })).toEqual({
      ok: false,
      reason: 'bad-bot',
    });
    expect(read({ bots: [{ bot: '1', move: 'attack' }] })).toEqual({
      ok: false,
      reason: 'bad-bot',
    });
    // The field is the seats the race state named, not a count: seat 2 has finished.
    expect(read({ bots: [{ bot: 2, move: 'attack' }] }, [0, 1, 3])).toEqual({
      ok: false,
      reason: 'bad-bot',
    });
    expect(
      read({
        bots: [
          { bot: 1, move: 'attack' },
          { bot: 1, move: 'recover' },
        ],
      }),
    ).toEqual({ ok: false, reason: 'duplicate-bot' });
    expect(read({ bots: [{ bot: 1, move: 'chase', target: 9 }] })).toEqual({
      ok: false,
      reason: 'bad-target',
    });
    expect(read({ bots: [{ bot: 1, move: 'chase', target: 'leader' }] })).toEqual({
      ok: false,
      reason: 'bad-target',
    });
  });

  it('reads an effort from the closed list, and refuses a number or a word outside it', () => {
    expect(read({ bots: [{ bot: 1, move: 'attack', effort: 'all-out' }] })).toEqual({
      ok: true,
      moves: [{ bot: 1, move: 'attack', effort: 'all-out' }],
    });
    expect(read({ bots: [{ bot: 1, move: 'attack', effort: null }] })).toEqual({
      ok: true,
      moves: [{ bot: 1, move: 'attack' }],
    });
    for (const effort of [900, 'max', '']) {
      expect(read({ bots: [{ bot: 1, move: 'attack', effort }] })).toEqual({
        ok: false,
        reason: 'bad-effort',
      });
    }
  });

  it('asks the model for an effort in the format, and never makes it required', () => {
    const format = JSON.stringify(modelTacticsAnswerSchema([0, 1]));
    expect(format).toContain(
      '"effort":{"type":"string","enum":["easy","tempo","threshold","all-out"]}',
    );
    expect(format).toContain('"required":["bot","move"]');
  });

  it('is nothing for text that is not JSON, not an object, or not a list', () => {
    expect(read('attack!')).toEqual({ ok: false, reason: 'not-json' });
    expect(read('[]')).toEqual({ ok: false, reason: 'not-an-object' });
    expect(read('null')).toEqual({ ok: false, reason: 'not-an-object' });
    expect(read({ bots: 'all attack' })).toEqual({ ok: false, reason: 'not-a-list' });
    expect(read({})).toEqual({ ok: false, reason: 'not-a-list' });
    expect(read({ bots: ['attack'] })).toEqual({ ok: false, reason: 'not-an-object' });
  });

  it('is nothing past its length cap, before it is parsed', () => {
    const padded = JSON.stringify({ bots: [{ bot: 0, move: 'attack' }] }).padEnd(
      MODEL_TACTICS_ANSWER_MOST_CHARACTERS + 1,
      ' ',
    );
    expect(read(padded)).toEqual({ ok: false, reason: 'too-long' });
    expect(read(padded.slice(0, MODEL_TACTICS_ANSWER_MOST_CHARACTERS)).ok).toBe(true);
  });

  it('has a schema with no power field: a seat, a move and a target, and nothing else', () => {
    const schema = modelTacticsAnswerSchema([0, 2]) as {
      properties: { bots: { items: { properties: Record<string, unknown> } } };
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties.bots.items.properties)).toEqual([
      'bot',
      'move',
      'effort',
      'target',
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).toContain('"enum":[0,2]');
  });
});

describe('a model tactics race state (#2709, ADR 0071 D-3.4)', () => {
  it('reads the spike’s shape, and names its seats', () => {
    const got = readModelTacticsInput(input());
    expect(got.ok).toBe(true);
    expect(modelTacticsSeats(got.ok ? got.value : ({} as ModelTacticsInput))).toEqual(SEATS);
    expect(readModelTacticsInput(input({ rider: { ...RIDER, rank: 0, wPerKg: null } })).ok).toBe(
      true,
    );
  });

  it('refuses a field it does not name — anywhere a coordinate or a name could ride', () => {
    expect(readModelTacticsInput(input({ lat: 51.5 }))).toEqual({
      ok: false,
      problem: { field: 'input', problem: 'has a field this race state does not' },
    });
    expect(readModelTacticsInput(input({ rider: { ...RIDER, name: 'Alex' } }))).toEqual({
      ok: false,
      problem: { field: 'input.rider', problem: 'has a field this race state does not' },
    });
    expect(
      readModelTacticsInput(input({ bots: [view(0, { place: 'Richmond Park' } as never)] })),
    ).toEqual({
      ok: false,
      problem: { field: 'input.bots[0]', problem: 'has a field this race state does not' },
    });
  });

  it('refuses a missing field, naming it', () => {
    const without = (value: Record<string, unknown>, key: string) =>
      Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
    expect(readModelTacticsInput(input({ bots: [without(view(0), 'lapsLeft')] }))).toEqual({
      ok: false,
      problem: { field: 'input.bots[0].lapsLeft', problem: 'is required' },
    });
    expect(readModelTacticsInput(without(input(), 'rider'))).toEqual({
      ok: false,
      problem: { field: 'input.rider', problem: 'is required' },
    });
  });

  it('refuses text where a word from a closed list goes, and never echoes the value', () => {
    const named = readModelTacticsInput(input({ bots: [view(0, { legs: '51.5072,-0.1276' })] }));
    expect(named).toEqual({
      ok: false,
      problem: { field: 'input.bots[0].legs', problem: 'must be an archetype' },
    });
    expect(JSON.stringify(named)).not.toContain('51.5072');
    expect(readModelTacticsInput(input({ bots: [view(0, { move: 'erg' })] }))).toEqual({
      ok: false,
      problem: { field: 'input.bots[0].move', problem: 'must be one of the seven moves' },
    });
  });

  it('refuses each number out of its range or of the wrong kind', () => {
    const refused = (over: Record<string, unknown>, field: string) => {
      const got = readModelTacticsInput(input({ bots: [view(0, over)] }));
      expect(got.ok ? undefined : got.problem.field).toBe(`input.bots[0].${field}`);
    };
    refused({ bot: MODEL_TACTICS_MOST_SEATS }, 'bot');
    refused({ rank: 0 }, 'rank');
    refused({ gapAheadM: -1 }, 'gapAheadM');
    refused({ gapBehindM: '1' }, 'gapBehindM');
    refused({ wbal: 1.2 }, 'wbal');
    refused({ drafting: 1 }, 'drafting');
    refused({ lapsLeft: 1.5 }, 'lapsLeft');
    refused({ toLineM: Number.MAX_VALUE }, 'toLineM');
    refused({ launchM: -5 }, 'launchM');
    refused({ gradeAheadPct: 300 }, 'gradeAheadPct');
    refused({ riderGapM: null }, 'riderGapM');
    expect(readModelTacticsInput(input({ laps: 0 })).ok).toBe(false);
    expect(readModelTacticsInput(input({ field: 9 })).ok).toBe(false);
    expect(readModelTacticsInput(input({ rider: { ...RIDER, rank: 9, wPerKg: 3 } })).ok).toBe(
      false,
    );
    expect(readModelTacticsInput(input({ rider: { ...RIDER, rank: 1, wPerKg: -1 } })).ok).toBe(
      false,
    );
  });

  it('refuses no bots, too many, a seat twice, and a state that is not an object', () => {
    expect(readModelTacticsInput(input({ bots: [] })).ok).toBe(false);
    expect(readModelTacticsInput(input({ bots: [...SEATS, 0].map((seat) => view(seat)) })).ok).toBe(
      false,
    );
    expect(readModelTacticsInput(input({ bots: [view(1), view(1)] }))).toEqual({
      ok: false,
      problem: { field: 'input.bots[1].bot', problem: 'must not repeat a seat' },
    });
    expect(readModelTacticsInput(input({ bots: ['bot'] })).ok).toBe(false);
    expect(readModelTacticsInput(input({ rider: 'me' })).ok).toBe(false);
    expect(readModelTacticsInput([]).ok).toBe(false);
  });

  it('refuses a state longer than its cap, before its fields are read', () => {
    const long = input({ pad: 'x'.repeat(MODEL_TACTICS_INPUT_MOST_CHARACTERS) });
    expect(readModelTacticsInput(long)).toEqual({
      ok: false,
      problem: {
        field: 'input',
        problem: `must be at most ${String(MODEL_TACTICS_INPUT_MOST_CHARACTERS)} characters`,
      },
    });
  });
});
