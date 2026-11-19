// SPDX-License-Identifier: Apache-2.0

/**
 * #2710, ADR 0071 D-4 and D-7 and ADR 0073 D-2 to D-4: when a logged decision
 * is in force, how a model's move is ridden through a bot's own tactics
 * memory, the body's limits outside the strategy seam, ADR 0073's strategy
 * (the default: every rule of ADR 0071 D-3.6 lifted) and ADR 0071's kept
 * behind the seam, the line read as the bot misreads it (#2705), and a stored
 * log read back whole or not at all.
 */

import { describe, expect, it } from 'vitest';

import {
  botTacticsMisjudgement,
  BOT_TACTICS_MISJUDGE_LINE_METRES,
  BOT_TACTICS_WINDOW_MS,
} from './archetype';
import { createItemRace } from './item-race';
import type { ItemRaceState } from './items';
import {
  ADR_0071_MOVE_STRATEGY,
  ADR_0073_MOVE_STRATEGY,
  ADR_0074_MOVE_STRATEGY,
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
import type { ModelTacticsMove } from './model-tactics';
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
    // #2759, ADR 0076 D-11: held 10 s from the window it applied in.
    expect(modelMovesInForce(log, 17_999)).toEqual([{ bot: 1, move: 'chase' }]);
    expect(modelMovesInForce(log, 18_000)).toBeUndefined();
    expect(modelMovesInForce([], 8_000)).toBeUndefined();
  });

  it('holds a decision 10 s, long enough to meet the next one a slow call brings (#2759, ADR 0076 D-11)', () => {
    expect(MODEL_TACTICS_HOLD_MS).toBe(10_000);
    // Asked at 4 s and answered at 9.6 s (a 5.6 s round trip): in force from
    // 10 s. The next ask goes out at 12 s and, as slow, lands at 17.6 s and
    // applies from 18 s: the first still holds until then, so no window
    // between the two rides seeded tactics.
    const first: ModelTacticsLogEntry = {
      askedAtMs: 4_000,
      arrivedAtMs: 9_600,
      outcome: 'decision',
      moves: [{ bot: 0, move: 'flyer' }],
    };
    expect(modelTacticsNextAskAtMs(first.arrivedAtMs)).toBe(12_000);
    expect(modelMovesInForce([first], 17_999)).toEqual([{ bot: 0, move: 'flyer' }]);
    const second: ModelTacticsLogEntry = {
      askedAtMs: 12_000,
      arrivedAtMs: 17_600,
      outcome: 'decision',
      moves: [{ bot: 0, move: 'sit-in' }],
    };
    expect(modelMovesInForce([first, second], 18_000)).toEqual([{ bot: 0, move: 'sit-in' }]);
    // With no next decision it lapses 10 s after it applied: seeded tactics again.
    expect(modelMovesInForce([first], 20_000)).toBeUndefined();
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

/** A strategy that refuses nothing and rides every move as named: the loosest seam there is. */
const ANYTHING: ModelMoveStrategy = () => undefined;

describe('the body’s limits sit outside the strategy seam (ADR 0073 D-2)', () => {
  it('keeps an exhausted bot on its seeded choice, whatever the strategy allows, an effort included', () => {
    const tired = bot('bot-1', { energy: { wbalJoules: 0, exhausted: true } });
    const race = raceAt(12_000, MID);
    for (const strategy of [
      undefined,
      ADR_0074_MOVE_STRATEGY,
      ADR_0073_MOVE_STRATEGY,
      ADR_0071_MOVE_STRATEGY,
      ANYTHING,
    ]) {
      const applied = applyModelMoves(
        race,
        [tired, bot('bot-2'), bot('bot-3')],
        [{ bot: 0, move: 'attack', effort: 'all-out' }],
        SEED,
        strategy,
      );
      expect(applied.outcomes[0]).toBe('exhausted');
      expect(applied.bots[0]).toBe(tired);
    }
  });

  it('rides by default what ADR 0071’s rules refuse', () => {
    // Three laps out: ADR 0071 shuts the flyer; the race's own strategy rides it.
    const race = raceAt(12_000, { rider: 30, 'bot-1': 20, 'bot-2': 10, 'bot-3': 0 });
    const moves = [{ bot: 0, move: 'flyer' as const }];
    const bots = IDS.map((id) => bot(id));
    expect(applyModelMoves(race, bots, moves, SEED, ADR_0071_MOVE_STRATEGY).outcomes[0]).toBe(
      'flyer-closed',
    );
    const ridden = applyModelMoves(race, bots, moves, SEED);
    expect(ridden.outcomes[0]).toBe('applied');
    expect(ridden.bots[0]?.tactics.tactic).toBe('flyer');
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
      toLineMetres: LAP * LAPS - 820,
      lapsLeft: 3,
      wbalShare: 0.5,
      tactics,
      ahead: 'rider',
      targetAt: 'ahead',
    });
    expect(seen[1]?.ahead).toBe(0);
    expect(seen[1]?.targetAt).toBeUndefined();
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
    toLineMetres: 1_500,
    lapsLeft: 2,
    wbalShare: 0.9,
    tactics: { tactic: 'sit-in', sinceMs: 50_000, window: 59 },
    ahead: 1,
    targetAt: undefined,
    ...over,
  };
}

/** One bot's move ridden under `strategy`, the race's own unless given: its outcome, and the memory it rides. */
function ridden(
  move: ModelTacticsMove,
  over: Partial<ModelRaceBot> = {},
  at: Readonly<Record<string, number>> = MID,
  atMs = 12_000,
  strategy?: ModelMoveStrategy,
): { outcome: string | undefined; tactics: ModelRaceBot['tactics'] | undefined } {
  const bots = IDS.map((id, seat) => (seat === move.bot ? bot(id, over) : bot(id)));
  const applied = applyModelMoves(raceAt(atMs, at), bots, [move], SEED, strategy);
  return { outcome: applied.outcomes[move.bot], tactics: applied.bots[move.bot]?.tactics };
}

describe('ADR 0073 D-3: every strategy rule lifted, under ADR 0074’s backstop', () => {
  const low = {
    wbalJoules: PLAN.capacity.wPrimeJoules * (BOT_TACTIC_WBAL_FLOOR - 0.05),
    exhausted: false,
  };

  it('rides an attack or a chase under the W′ floor: a gamble (D-3.1)', () => {
    for (const move of ['attack', 'chase'] as const) {
      expect(ridden({ bot: 1, move }, { energy: low })).toEqual({
        outcome: 'applied',
        tactics: { tactic: move, sinceMs: 12_000, window: 12 },
      });
    }
  });

  it('rides a flyer on any lap and at any W′ (D-3.2)', () => {
    // Three laps out, and under the flyer's W′ share.
    const start = { rider: 30, 'bot-1': 20, 'bot-2': 10, 'bot-3': 0 };
    expect(ridden({ bot: 0, move: 'flyer' }, {}, start).tactics?.tactic).toBe('flyer');
    const under = {
      wbalJoules: PLAN.capacity.wPrimeJoules * (BOT_TACTIC_FLYER_WBAL_SHARE - 0.05),
      exhausted: false,
    };
    expect(ridden({ bot: 0, move: 'flyer' }, { energy: under }).outcome).toBe('applied');
  });

  it('rides an attack past its longest hold, keeping when it began (D-3.3)', () => {
    const since = 12_000 - BOT_TACTIC_ATTACK_MS * 3;
    const held = { tactics: { tactic: 'attack' as const, sinceMs: since, window: 11 } };
    expect(ridden({ bot: 0, move: 'attack' }, held)).toEqual({
      outcome: 'applied',
      tactics: { tactic: 'attack', sinceMs: since, window: 12 },
    });
  });

  it('rides a follow or chase of a racer up the road as a chase to them: bridging (D-3.4)', () => {
    // Order: rider, bot-1 (seat 0), bot-2 (seat 1), bot-3 (seat 2).
    for (const move of ['follow', 'chase'] as const) {
      expect(ridden({ bot: 2, move, target: 'rider' })).toEqual({
        outcome: 'bridging',
        tactics: { tactic: 'chase', sinceMs: 12_000, window: 12 },
      });
      expect(ridden({ bot: 2, move, target: 0 }).outcome).toBe('bridging');
    }
  });

  it('rides a follow or chase of a racer behind as sitting in: marking (D-3.4)', () => {
    for (const move of ['follow', 'chase'] as const) {
      expect(ridden({ bot: 0, move, target: 2 })).toEqual({
        outcome: 'marking',
        tactics: { tactic: 'sit-in', sinceMs: 12_000, window: 12 },
      });
    }
  });

  it('rides a follow or chase of the racer directly ahead, itself, or nobody, as named (D-3.4)', () => {
    expect(ridden({ bot: 0, move: 'follow', target: 'rider' }).tactics?.tactic).toBe('follow');
    expect(ridden({ bot: 1, move: 'chase', target: 0 }).tactics?.tactic).toBe('chase');
    expect(ridden({ bot: 1, move: 'follow', target: 1 }).outcome).toBe('applied');
    expect(ridden({ bot: 1, move: 'follow' }).tactics?.tactic).toBe('follow');
    // A target over the line is no longer racing: the move as named.
    const race = raceAt(12_000, MID);
    const done: ItemRaceState = {
      ...race,
      racers: race.racers.map((entry) =>
        entry.racer.id === 'bot-1'
          ? { ...entry, racer: { ...entry.racer, finishedAtMs: 11_000 } }
          : entry,
      ),
    };
    const applied = applyModelMoves(
      done,
      IDS.map((id) => bot(id)),
      [{ bot: 2, move: 'follow', target: 0 }],
      SEED,
    );
    expect(applied.outcomes[1]).toBe('applied');
    expect(applied.bots[2]?.tactics.tactic).toBe('follow');
  });

  it('rides, under ADR 0073’s own strategy, a kick anywhere, any move inside the launch, and the model ending a kick (D-3.5)', () => {
    const adr0073 = ADR_0073_MOVE_STRATEGY;
    // A lap and more out: a kick launched long.
    expect(ridden({ bot: 0, move: 'kick' }, {}, MID, 12_000, adr0073).tactics?.tactic).toBe('kick');
    // Ten metres out, deep inside every launch: a launch held late.
    const close = { rider: 2_995, 'bot-1': 2_990, 'bot-2': 0, 'bot-3': 0 };
    expect(ridden({ bot: 0, move: 'sit-in' }, {}, close, 12_000, adr0073).outcome).toBe('applied');
    // In its kick, and told to sit up: the model ends it.
    const kicking = { tactics: { tactic: 'kick' as const, sinceMs: 11_000, window: 11 } };
    expect(
      ridden({ bot: 0, move: 'sit-in' }, kicking, close, 12_000, adr0073).tactics?.tactic,
    ).toBe('sit-in');
  });

  it('refuses nothing, by itself', () => {
    for (const move of [
      'sit-in',
      'follow',
      'chase',
      'attack',
      'recover',
      'flyer',
      'kick',
    ] as const) {
      expect(
        ADR_0073_MOVE_STRATEGY(ask({ move, wbalShare: 0, readToLineMetres: 0, lapsLeft: 9 })),
      ).toBeUndefined();
    }
  });
});

describe('ADR 0074: a sprint instinct behind the model’s moves, the race’s own strategy', () => {
  const close = { rider: 2_995, 'bot-1': 2_990, 'bot-2': 0, 'bot-3': 0 };

  it('launches the kick of a bot the model has not sent on it, inside its launch', () => {
    for (const move of ['sit-in', 'follow', 'attack', 'recover', 'flyer'] as const) {
      expect(ridden({ bot: 0, move }, {}, close)).toEqual({
        outcome: 'backstop',
        tactics: { tactic: 'kick', sinceMs: 12_000, window: 12 },
      });
    }
  });

  it('rides the backstop kick at the kick’s own target, never the effort the model gave another move', () => {
    const held = ridden({ bot: 0, move: 'sit-in', effort: 'easy' }, {}, close);
    expect(held.outcome).toBe('backstop');
    expect(held.tactics?.effort).toBeUndefined();
    // A move the model chose keeps its effort.
    expect(ridden({ bot: 0, move: 'kick', effort: 'easy' }, {}, close).tactics?.effort).toBe(
      'easy',
    );
  });

  it('reads the launch on the misread line, as seeded decideTactic does', () => {
    const launch = botLaunchMetres('rouleur');
    expect(ADR_0074_MOVE_STRATEGY(ask({ move: 'sit-in', readToLineMetres: launch }))).toEqual({
      outcome: 'backstop',
      ride: 'kick',
    });
    expect(
      ADR_0074_MOVE_STRATEGY(
        ask({ move: 'sit-in', readToLineMetres: launch + 0.5, toLineMetres: launch - 10 }),
      ),
    ).toBeUndefined();
  });

  it('holds a kick in progress to the line, whatever the model names and the bot misreads', () => {
    const launch = botLaunchMetres('rouleur');
    const kicking = { tactic: 'kick' as const, sinceMs: 50_000, window: 59 };
    const band = launch + BOT_TACTICS_MISJUDGE_LINE_METRES;
    // Misread back outside its launch a window later: still held.
    const outside = { tactics: kicking, readToLineMetres: launch + 30, toLineMetres: band };
    for (const move of ['sit-in', 'follow', 'recover'] as const) {
      expect(ADR_0074_MOVE_STRATEGY(ask({ ...outside, move }))).toEqual({
        outcome: 'backstop',
        ride: 'kick',
      });
    }
    // Held in the bot's memory, its start kept.
    const kickingBot = { tactics: { tactic: 'kick' as const, sinceMs: 11_000, window: 11 } };
    expect(ridden({ bot: 0, move: 'sit-in' }, kickingBot, close).tactics).toEqual({
      tactic: 'kick',
      sinceMs: 11_000,
      window: 12,
    });
    // Further out than any misread reaches: the model's own kick, still the model's to end.
    expect(
      ADR_0074_MOVE_STRATEGY(
        ask({ tactics: kicking, readToLineMetres: band + 1, toLineMetres: band + 1 }),
      ),
    ).toBeUndefined();
  });

  it('still rides a kick the model names, earlier or inside the launch', () => {
    // A lap and more out: launched long.
    expect(ridden({ bot: 0, move: 'kick' })).toEqual({
      outcome: 'applied',
      tactics: { tactic: 'kick', sinceMs: 12_000, window: 12 },
    });
    expect(ridden({ bot: 0, move: 'kick', effort: 'threshold' }, {}, close).outcome).toBe(
      'applied',
    );
  });

  it('lets the exhausted rule win over the backstop and the model’s kick alike', () => {
    const tired = { energy: { wbalJoules: 0, exhausted: true } };
    for (const move of ['kick', 'sit-in'] as const) {
      expect(ridden({ bot: 0, move }, tired, close).outcome).toBe('exhausted');
    }
  });

  it('leaves the rest to ADR 0073’s strategy outside the launch', () => {
    expect(ridden({ bot: 2, move: 'follow', target: 'rider' }).outcome).toBe('bridging');
    expect(ADR_0074_MOVE_STRATEGY(ask({ move: 'flyer', lapsLeft: 9, wbalShare: 0 }))).toBe(
      undefined,
    );
  });
});

describe('when a ridden move began (`kept`)', () => {
  it('keeps the start of a chase that a bridge rides on as a chase', () => {
    // Bot 2 is chasing; the model names a follow of the rider up the road: ridden as a chase.
    const chasing = { tactics: { tactic: 'chase' as const, sinceMs: 9_000, window: 11 } };
    expect(ridden({ bot: 2, move: 'follow', target: 'rider' }, chasing)).toEqual({
      outcome: 'bridging',
      tactics: { tactic: 'chase', sinceMs: 9_000, window: 12 },
    });
  });

  it('restarts the clock when the move ridden is not the one the bot was in, though the model named it', () => {
    // Bot 2 is following; the model names a follow of the rider up the road: ridden as a chase.
    const following = { tactics: { tactic: 'follow' as const, sinceMs: 9_000, window: 11 } };
    expect(ridden({ bot: 2, move: 'follow', target: 'rider' }, following)).toEqual({
      outcome: 'bridging',
      tactics: { tactic: 'chase', sinceMs: 12_000, window: 12 },
    });
  });
});

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

  it('never ends a kick a bot is already in, whatever it reads the line as', () => {
    const kicking = { tactic: 'kick' as const, sinceMs: 50_000, window: 59 };
    expect(ADR_0071_MOVE_STRATEGY(ask({ tactics: kicking }))).toBe('launch');
    expect(ADR_0071_MOVE_STRATEGY(ask({ tactics: kicking, move: 'follow', target: 1 }))).toBe(
      'launch',
    );
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

describe('the launch band reads the line as seeded decideTactic does (#2705), under ADR 0071’s rules', () => {
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
    return applyModelMoves(
      raceAt(atMs, at),
      bots,
      [{ bot: seat, move: 'attack' }],
      SEED,
      ADR_0071_MOVE_STRATEGY,
    ).outcomes[seat];
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

describe('an effort rides through the tactics memory', () => {
  it('hands the bot the effort with the move, and none with a move that names none', () => {
    const bots = IDS.map((id) => bot(id));
    const withEffort = applyModelMoves(
      raceAt(60_000, { rider: 0 }),
      bots,
      [{ bot: 0, move: 'attack', effort: 'tempo' }],
      SEED,
    );
    expect(withEffort.bots[0]?.tactics.effort).toBe('tempo');
    const without = applyModelMoves(
      raceAt(60_000, { rider: 0 }),
      bots,
      [{ bot: 0, move: 'attack' }],
      SEED,
    );
    expect(without.bots[0]?.tactics.effort).toBeUndefined();
  });

  it('keeps an effort through a stored log', () => {
    const entry: ModelTacticsLogEntry = {
      askedAtMs: 4_000,
      arrivedAtMs: 4_100,
      outcome: 'decision',
      moves: [{ bot: 0, move: 'attack', effort: 'easy' }],
    };
    expect(readModelTacticsLogEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    expect(
      readModelTacticsLogEntry({ ...entry, moves: [{ bot: 0, move: 'attack', effort: 900 }] }),
    ).toBeUndefined();
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
