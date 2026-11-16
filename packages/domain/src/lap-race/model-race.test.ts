// SPDX-License-Identifier: Apache-2.0

/**
 * #2710, ADR 0071 D-3.6, D-4 and D-7: when a logged decision is in force, how
 * a model's move is ridden through a bot's own tactics memory, the body's
 * limits outside the strategy seam and the seam's rules inside it, the launch
 * band read on the line as the bot misreads it (#2705), and a stored log read
 * back whole or not at all.
 */

import { describe, expect, it } from 'vitest';

import { botTacticsMisjudgement, BOT_TACTICS_WINDOW_MS } from './archetype';
import { createItemRace } from './item-race';
import type { ItemRaceState } from './items';
import {
  ADR_0071_MOVE_STRATEGY,
  applyModelMoves,
  MODEL_TACTICS_HOLD_MS,
  modelMovesInForce,
  modelTacticsAppliedAtMs,
  modelTacticsNextAskAtMs,
  LAP_RACE_MODEL_MOST_TICKS,
  readLapRaceModelRecord,
  readModelTacticsLogEntry,
  type LapRaceModelRecord,
  type ModelMoveAsk,
  type ModelMoveStrategy,
  type ModelRaceBot,
  type ModelTacticsLogEntry,
} from './model-race';
import { botRacePlan } from './plan';
import { raceCourse } from './race';
import {
  BOT_TACTIC_ATTACK_MS,
  BOT_TACTIC_FLYER_WBAL_SHARE,
  BOT_TACTIC_WBAL_FLOOR,
  botLaunchMetres,
  TACTIC_MEMORY_AT_START,
} from './tactics';
import { fullBotEnergy } from './wbal';

const LAP = 1_000;
const LAPS = 3;
const SEED = 7;
const IDS = ['bot-1', 'bot-2', 'bot-3'];

/** A race at `atMs`, the rider and three bots at the given effort distances. */
function raceAt(atMs: number, at: Readonly<Record<string, number>>): ItemRaceState {
  const race = createItemRace({
    course: raceCourse(LAP, LAPS),
    seed: SEED,
    itemsOn: false,
    racerIds: ['rider', ...IDS],
    startMs: 0,
  });
  return {
    ...race,
    atMs,
    racers: race.racers.map((entry) => ({
      ...entry,
      racer: { ...entry.racer, effortDistance: at[entry.racer.id] ?? 0 },
    })),
  };
}

const PLAN = botRacePlan('brisk', raceCourse(LAP, LAPS), SEED);

function bot(id: string, over: Partial<ModelRaceBot> = {}): ModelRaceBot {
  return {
    id,
    tactics: { ...TACTIC_MEMORY_AT_START, window: -1 },
    energy: fullBotEnergy(PLAN.capacity),
    plan: PLAN,
    strategy: { skill: 'canny' },
    ...over,
  };
}

/** Mid-race: the rider leads, then bots 0, 1 and 2, all a lap and more from the line. */
const MID = { rider: 830, 'bot-1': 820, 'bot-2': 810, 'bot-3': 800 };

const decision = (arrivedAtMs: number, move = 'attack' as const): ModelTacticsLogEntry => ({
  askedAtMs: Math.max(0, arrivedAtMs - 2_000),
  arrivedAtMs,
  outcome: 'decision',
  moves: [{ bot: 0, move }],
});

describe('a logged decision in force (D-4.2)', () => {
  it('applies from the window after it arrived, for the hold, and no longer', () => {
    const log = [decision(4_300)];
    expect(modelTacticsAppliedAtMs(4_300)).toBe(5_000);
    expect(modelTacticsAppliedAtMs(5_000)).toBe(6_000);
    expect(modelMovesInForce(log, 4_999)).toBeUndefined();
    expect(modelMovesInForce(log, 5_000)).toEqual([{ bot: 0, move: 'attack' }]);
    expect(modelMovesInForce(log, 5_000 + MODEL_TACTICS_HOLD_MS - 1)).toBeDefined();
    expect(modelMovesInForce(log, 5_000 + MODEL_TACTICS_HOLD_MS)).toBeUndefined();
  });

  it('is replaced by the next decision, and a late, invalid, refused or failed call applies nothing', () => {
    const log: ModelTacticsLogEntry[] = [
      decision(4_300),
      {
        askedAtMs: 6_000,
        arrivedAtMs: 7_100,
        outcome: 'decision',
        moves: [{ bot: 1, move: 'chase' }],
      },
      { askedAtMs: 8_000, arrivedAtMs: 8_200, outcome: 'invalid', reason: 'unknown-key' },
      { askedAtMs: 8_000, arrivedAtMs: 8_400, outcome: 'refused', reason: 'tactics_busy' },
      { askedAtMs: 8_000, arrivedAtMs: 8_500, outcome: 'failed', reason: 'unreachable' },
      { askedAtMs: 8_000, arrivedAtMs: 13_100, outcome: 'late', reason: 'no-answer' },
    ];
    expect(modelMovesInForce(log, 7_999)).toEqual([{ bot: 0, move: 'attack' }]);
    expect(modelMovesInForce(log, 8_000)).toEqual([{ bot: 1, move: 'chase' }]);
    expect(modelMovesInForce(log, 12_999)).toEqual([{ bot: 1, move: 'chase' }]);
    expect(modelMovesInForce(log, 13_000)).toBeUndefined();
    expect(modelMovesInForce([], 8_000)).toBeUndefined();
  });

  it('asks again at the next 4 s mark after a call settles', () => {
    expect(modelTacticsNextAskAtMs(4_000)).toBe(8_000);
    expect(modelTacticsNextAskAtMs(6_400)).toBe(8_000);
    expect(modelTacticsNextAskAtMs(0)).toBe(4_000);
  });
});

describe('a model move ridden through the tactics memory (D-3.6)', () => {
  it('hands the bot the memory decideTactic would have written, in this window', () => {
    const race = raceAt(12_000, MID);
    const applied = applyModelMoves(
      race,
      IDS.map((id) => bot(id)),
      [{ bot: 0, move: 'attack' }],
      SEED,
    );
    expect(applied.outcomes).toEqual(['applied', 'not-named', 'not-named']);
    expect(applied.bots[0]?.tactics).toEqual({ tactic: 'attack', sinceMs: 12_000, window: 12 });
    // A bot the decision does not name keeps its own memory, untouched.
    expect(applied.bots[1]?.tactics.window).toBe(-1);
  });

  it('keeps when a held move began, so an attack is not restarted by being asked again', () => {
    const race = raceAt(12_000, MID);
    const held = bot('bot-1', { tactics: { tactic: 'attack', sinceMs: 9_000, window: 11 } });
    const applied = applyModelMoves(
      race,
      [held, bot('bot-2'), bot('bot-3')],
      [{ bot: 0, move: 'attack' }],
      SEED,
    );
    expect(applied.bots[0]?.tactics).toEqual({ tactic: 'attack', sinceMs: 9_000, window: 12 });
  });

  it('decides nothing inside every bot’s window, and hands back the same bots', () => {
    const race = raceAt(12_500, MID);
    const bots = IDS.map((id) =>
      bot(id, { tactics: { tactic: 'sit-in', sinceMs: 0, window: 12 } }),
    );
    const applied = applyModelMoves(race, bots, [{ bot: 0, move: 'attack' }], SEED);
    expect(applied.bots).toBe(bots);
    expect(applied.outcomes).toEqual([]);
  });

  it('says no decision is in force, and changes nothing, with no moves', () => {
    const bots = IDS.map((id) => bot(id));
    const applied = applyModelMoves(raceAt(12_000, MID), bots, undefined, SEED);
    expect(applied.bots).toBe(bots);
    expect(applied.outcomes).toEqual(['no-decision', 'no-decision', 'no-decision']);
  });

  it('decides nothing for a bot on the line or one that has finished', () => {
    const race = raceAt(12_000, MID);
    const finished: ItemRaceState = {
      ...race,
      racers: race.racers.map((entry) =>
        entry.racer.id === 'bot-2'
          ? { ...entry, racer: { ...entry.racer, finishedAtMs: 11_000 } }
          : entry,
      ),
    };
    const applied = applyModelMoves(
      finished,
      [bot('bot-1', { plan: undefined }), bot('bot-2'), bot('bot-3')],
      [
        { bot: 0, move: 'attack' },
        { bot: 1, move: 'attack' },
        { bot: 2, move: 'attack' },
      ],
      SEED,
    );
    expect(applied.outcomes).toEqual(['applied']);
    expect(applied.bots[2]?.tactics.tactic).toBe('attack');
  });
});

/** A strategy that refuses nothing: what ADR 0073 could hand in at its loosest. */
const ANYTHING: ModelMoveStrategy = () => undefined;

describe('the body’s limits sit outside the strategy seam', () => {
  it('keeps an exhausted bot on its seeded choice, whatever the strategy allows', () => {
    const tired = bot('bot-1', { energy: { wbalJoules: 0, exhausted: true } });
    const race = raceAt(12_000, MID);
    for (const strategy of [ADR_0071_MOVE_STRATEGY, ANYTHING]) {
      const applied = applyModelMoves(
        race,
        [tired, bot('bot-2'), bot('bot-3')],
        [{ bot: 0, move: 'attack' }],
        SEED,
        strategy,
      );
      expect(applied.outcomes[0]).toBe('exhausted');
      expect(applied.bots[0]).toBe(tired);
    }
  });

  it('lets a looser strategy ride what ADR 0071’s refuses', () => {
    // Three laps out: ADR 0071 shuts the flyer; the loosest seam rides it.
    const race = raceAt(12_000, { rider: 30, 'bot-1': 20, 'bot-2': 10, 'bot-3': 0 });
    const moves = [{ bot: 0, move: 'flyer' as const }];
    const bots = IDS.map((id) => bot(id));
    expect(applyModelMoves(race, bots, moves, SEED).outcomes[0]).toBe('flyer-closed');
    const loose = applyModelMoves(race, bots, moves, SEED, ANYTHING);
    expect(loose.outcomes[0]).toBe('applied');
    expect(loose.bots[0]?.tactics.tactic).toBe('flyer');
  });

  it('shows the seam the bot’s own reading of the race', () => {
    const seen: ModelMoveAsk[] = [];
    const spy: ModelMoveStrategy = (ask) => {
      seen.push(ask);
      return undefined;
    };
    const tactics = { tactic: 'sit-in' as const, sinceMs: 3_000, window: 11 };
    const half = { wbalJoules: PLAN.capacity.wPrimeJoules / 2, exhausted: false };
    applyModelMoves(
      raceAt(12_000, MID),
      [bot('bot-1', { tactics, energy: half }), bot('bot-2'), bot('bot-3')],
      [
        { bot: 0, move: 'chase', target: 'rider' },
        { bot: 1, move: 'follow' },
      ],
      SEED,
      spy,
    );
    const misread = botTacticsMisjudgement(SEED, 0, 'canny', 12_000).lineMetres;
    expect(seen[0]).toEqual({
      move: 'chase',
      target: 'rider',
      atMs: 12_000,
      archetype: PLAN.archetype,
      readToLineMetres: LAP * LAPS - 820 + misread,
      lapsLeft: 3,
      wbalShare: 0.5,
      tactics,
      ahead: 'rider',
    });
    expect(seen[1]?.ahead).toBe(0);
  });
});

/** An ask ADR 0071's rules ride, changed by `over`. */
function ask(over: Partial<ModelMoveAsk> = {}): ModelMoveAsk {
  return {
    move: 'attack',
    target: undefined,
    atMs: 60_000,
    archetype: 'rouleur',
    readToLineMetres: 1_500,
    lapsLeft: 2,
    wbalShare: 0.9,
    tactics: { tactic: 'sit-in', sinceMs: 50_000, window: 59 },
    ahead: 1,
    ...over,
  };
}

describe('ADR 0071 D-3.6’s strategy rules, behind the seam', () => {
  it('rides an open move', () => {
    expect(ADR_0071_MOVE_STRATEGY(ask())).toBeUndefined();
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'flyer' }))).toBeUndefined();
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'follow', target: 1 }))).toBeUndefined();
    expect(
      ADR_0071_MOVE_STRATEGY(ask({ move: 'chase', target: 'rider', ahead: 'rider' })),
    ).toBeUndefined();
  });

  it('keeps the sprint the bot’s own inside its launch distance, as it reads the line', () => {
    const launch = botLaunchMetres('rouleur');
    expect(ADR_0071_MOVE_STRATEGY(ask({ readToLineMetres: launch }))).toBe('launch');
    expect(ADR_0071_MOVE_STRATEGY(ask({ readToLineMetres: launch + 0.5 }))).toBeUndefined();
  });

  it('refuses a kick outside the launch, and a spend under the W′ floor', () => {
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'kick' }))).toBe('kick-closed');
    const low = BOT_TACTIC_WBAL_FLOOR - 0.01;
    expect(ADR_0071_MOVE_STRATEGY(ask({ wbalShare: low }))).toBe('wbal-floor');
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'chase', wbalShare: low }))).toBe('wbal-floor');
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'follow', wbalShare: low }))).toBeUndefined();
  });

  it('opens a flyer only in the last two laps and over its W′ share', () => {
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'flyer', lapsLeft: 3 }))).toBe('flyer-closed');
    expect(
      ADR_0071_MOVE_STRATEGY(ask({ move: 'flyer', wbalShare: BOT_TACTIC_FLYER_WBAL_SHARE - 0.01 })),
    ).toBe('flyer-closed');
  });

  it('ends an attack held its longest', () => {
    const held = { tactic: 'attack' as const, sinceMs: 60_000 - BOT_TACTIC_ATTACK_MS, window: 59 };
    expect(ADR_0071_MOVE_STRATEGY(ask({ tactics: held }))).toBe('attack-over');
    const younger = { ...held, sinceMs: held.sinceMs + 1 };
    expect(ADR_0071_MOVE_STRATEGY(ask({ tactics: younger }))).toBeUndefined();
    expect(ADR_0071_MOVE_STRATEGY(ask({ tactics: { ...held, sinceMs: null } }))).toBeUndefined();
  });

  it('refuses a follow or chase aimed past the racer directly ahead', () => {
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'follow', target: 'rider' }))).toBe(
      'target-not-ahead',
    );
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'chase', target: 2 }))).toBe('target-not-ahead');
    expect(ADR_0071_MOVE_STRATEGY(ask({ move: 'follow', target: 1, ahead: null }))).toBe(
      'target-not-ahead',
    );
  });
});

describe('the launch band reads the line as seeded decideTactic does (#2705)', () => {
  /** A naive bot's window, by seat and time, whose misread puts the line the given side of the true one. */
  function windowMisreading(sign: 1 | -1): { seat: number; atMs: number; misread: number } {
    for (let window = 1; window < 500; window += 1) {
      for (let seat = 0; seat < IDS.length; seat += 1) {
        const atMs = window * BOT_TACTICS_WINDOW_MS;
        const misread = botTacticsMisjudgement(SEED, seat, 'naive', atMs).lineMetres;
        if (misread * sign > 20) return { seat, atMs, misread };
      }
    }
    throw new Error('no window misread the line by 20 m');
  }

  function outcomeAt(seat: number, atMs: number, trueToLine: number): string | undefined {
    const at: Record<string, number> = { rider: 0 };
    IDS.forEach((id, index) => {
      at[id] = index === seat ? LAP * LAPS - trueToLine : 0;
    });
    const bots = IDS.map((id) => bot(id, { strategy: { skill: 'naive' } }));
    return applyModelMoves(raceAt(atMs, at), bots, [{ bot: seat, move: 'attack' }], SEED).outcomes[
      seat
    ];
  }

  it('keeps a bot that misreads the line as nearer on its own kick, outside the true band', () => {
    const { seat, atMs, misread } = windowMisreading(-1);
    const launch = botLaunchMetres(PLAN.archetype);
    // Truly outside its launch, but read inside it: seeded tactics kick here.
    const trueToLine = launch - misread / 2;
    expect(trueToLine).toBeGreaterThan(launch);
    expect(outcomeAt(seat, atMs, trueToLine)).toBe('launch');
  });

  it('lets the model move a bot that misreads the line as further, inside the true band', () => {
    const { seat, atMs, misread } = windowMisreading(1);
    const launch = botLaunchMetres(PLAN.archetype);
    const trueToLine = launch - misread / 2;
    expect(trueToLine).toBeLessThan(launch);
    expect(outcomeAt(seat, atMs, trueToLine)).toBe('applied');
  });
});

describe('a stored log entry, read back whole or not at all', () => {
  it('reads every outcome this build writes', () => {
    const entries: ModelTacticsLogEntry[] = [
      {
        askedAtMs: 4_000,
        arrivedAtMs: 6_500,
        outcome: 'decision',
        moves: [
          { bot: 0, move: 'attack' },
          { bot: 2, move: 'follow', target: 'rider' },
          { bot: 1, move: 'chase', target: 0 },
        ],
      },
      { askedAtMs: 4_000, arrivedAtMs: 9_100, outcome: 'late', reason: 'no-answer' },
      { askedAtMs: 4_000, arrivedAtMs: 4_100, outcome: 'invalid', reason: 'bad-move' },
      { askedAtMs: 4_000, arrivedAtMs: 4_100, outcome: 'refused', reason: 'tactics_busy' },
      { askedAtMs: 4_000, arrivedAtMs: 4_100, outcome: 'failed', reason: 'unreachable' },
    ];
    for (const entry of entries) {
      expect(readModelTacticsLogEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    }
  });

  it('refuses anything else', () => {
    const good = {
      askedAtMs: 4_000,
      arrivedAtMs: 6_500,
      outcome: 'decision',
      moves: [{ bot: 0, move: 'attack' }],
    };
    const bad: unknown[] = [
      null,
      [],
      { ...good, watts: 900 },
      { ...good, moves: [{ bot: 0, move: 'attack', watts: 900 }] },
      { ...good, moves: [{ bot: 0, move: 'sprint' }] },
      { ...good, moves: [{ bot: -1, move: 'attack' }] },
      { ...good, moves: [{ bot: 0, move: 'attack', target: 'pacer' }] },
      { ...good, moves: 'attack' },
      { ...good, reason: 'unknown-key' },
      { ...good, arrivedAtMs: 3_000 },
      { ...good, askedAtMs: Number.NaN },
      { ...good, outcome: 'won' },
      { askedAtMs: 1, arrivedAtMs: 2, outcome: 'late' },
      { askedAtMs: 1, arrivedAtMs: 2, outcome: 'late', reason: 'a model said so' },
      { askedAtMs: 1, arrivedAtMs: 2, outcome: 'late', reason: 'no-answer', moves: [] },
    ];
    for (const value of bad) expect(readModelTacticsLogEntry(value)).toBeUndefined();
  });
});

describe('a stored race record, read back whole or not at all (D-4.4)', () => {
  const record: LapRaceModelRecord = {
    version: 1,
    seed: 4_000_000_000,
    log: [
      {
        askedAtMs: 4_000,
        arrivedAtMs: 6_500,
        outcome: 'decision',
        moves: [{ bot: 0, move: 'attack' }],
      },
      { askedAtMs: 8_000, arrivedAtMs: 13_100, outcome: 'late', reason: 'no-answer' },
    ],
    rider: {
      effortDistances: [0.4, 0.8, 1.2],
      wattsPerKilogram: [3.1, null, 3.2],
      lanes: [1, 1, 2],
      uses: [2],
    },
  };

  it('reads what a race keeps', () => {
    expect(readLapRaceModelRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it('refuses a record with anything wrong in it', () => {
    const bad: unknown[] = [
      null,
      { ...record, model: 'gemma' },
      { ...record, version: 0 },
      { ...record, seed: -1 },
      { ...record, log: [{ ...record.log[0], watts: 9 }] },
      { ...record, log: 'none' },
      { ...record, rider: { ...record.rider, name: 'x' } },
      { ...record, rider: { ...record.rider, lanes: [1, 1] } },
      { ...record, rider: { ...record.rider, wattsPerKilogram: [1, 2] } },
      { ...record, rider: { ...record.rider, uses: [3] } },
      { ...record, rider: { ...record.rider, effortDistances: [0, Number.NaN, 1] } },
      { ...record, rider: { ...record.rider, lanes: [1, 1.5, 2] } },
      { ...record, rider: 'here' },
      {
        ...record,
        rider: {
          effortDistances: Array(LAP_RACE_MODEL_MOST_TICKS + 1).fill(0),
          wattsPerKilogram: Array(LAP_RACE_MODEL_MOST_TICKS + 1).fill(null),
          lanes: Array(LAP_RACE_MODEL_MOST_TICKS + 1).fill(1),
          uses: [],
        },
      },
    ];
    for (const value of bad) expect(readLapRaceModelRecord(value)).toBeUndefined();
  });
});
