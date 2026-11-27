// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: what the model is shown carries the race on effort distance and
 * nothing that says where it is: no coordinate, no place, no name (CLAUDE.md
 * §6). And the one call sent to Ollama gives the model no tools. #2720: each
 * bot its dealt style, its W′ and whether it is blown, the line as the bot
 * misreads it, and the rider's own state; no attack gate.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  BOT_TACTICS_MISJUDGE_LINE_METRES,
  botTacticsMisjudgement,
  TACTIC_MEMORY_AT_START,
  type BotTactic,
} from '@onyourleft/domain';

import type { LapRaceRide } from '../../src/game/lap-race/ride-race';

import { modelDecisionSchema } from './decision';

import { MODEL_RACING_STYLES, modelInput, modelRacingStyles, type ModelInput } from './model-input';
import { decisionRequest, MODEL_TACTICS_SYSTEM } from './ollama';
import { quietSeconds, rideField, SPIKE_CIRCUITS, type FieldTick } from './race';

let ride: LapRaceRide;
let input: ModelInput;
beforeAll(async () => {
  ride = (await rideField('hilly', 1, { kind: 'seeded' }, 60)).last;
  input = modelInput(
    ride.race,
    ride.bots,
    SPIKE_CIRCUITS.hilly,
    ride.seed,
    ride.draft,
    200 / 75,
    12.6,
  );
});

describe('what the model reads of the race (#2616)', () => {
  it('reads each of the seven bots: rank, gaps, W′, draft, laps, line, grade ahead and the rider’s gap', () => {
    expect(input.bots).toHaveLength(7);
    expect(input.field).toBe(8);
    expect(input.rider.wPerKg).toBe(2.7);
    const ranks = [...input.bots.map((bot) => bot.rank), input.rider.rank].sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const bot of input.bots) {
      expect(bot.wbal).toBeGreaterThan(0);
      expect(bot.wbal).toBeLessThanOrEqual(1);
      const { laps, lapLengthMetres } = ride.race.course;
      const ridden = laps * lapLengthMetres - bot.toLineM;
      expect(bot.lapsLeft).toBe(laps - Math.floor(ridden / lapLengthMetres));
    }
    // A climb and a descent each lap: the grade ahead is read off the road.
    expect(input.bots.some((bot) => bot.gradeAheadPct !== 0)).toBe(true);
    expect(input.bots.some((bot) => bot.drafting)).toBe(true);
  });

  it('names who is directly ahead of each bot, that bot’s move, and how long each has held its own (#2708)', () => {
    const byRank = new Map<number, 'rider' | number>([
      ...input.bots.map((bot): [number, number] => [bot.rank, bot.bot]),
      [input.rider.rank, 'rider'],
    ]);
    const behindRider = input.bots.find((bot) => bot.rank === input.rider.rank + 1);
    // Not vacuous: one bot sits behind the rider, and most behind another bot.
    expect(behindRider?.ahead).toBe('rider');
    expect(behindRider?.aheadMove).toBeNull();
    expect(input.bots.filter((bot) => typeof bot.ahead === 'number').length).toBeGreaterThan(3);
    for (const bot of input.bots) {
      expect(bot.ahead).toBe(byRank.get(bot.rank - 1) ?? null);
      if (typeof bot.ahead === 'number') {
        expect(bot.aheadMove).toBe(input.bots[bot.ahead]?.move);
        expect(bot.aheadMove).toBe(ride.bots[bot.ahead]?.tactics.tactic);
      }
      const since = ride.bots[bot.bot]?.tactics.sinceMs as number;
      expect(bot.secondsInMove).toBe(Math.floor((ride.race.atMs - since) / 1_000));
    }
    expect(input.bots.some((bot) => bot.secondsInMove > 0)).toBe(true);
    // Half a second on, mid-window, each count is still the whole seconds held.
    const later = modelInput(
      { ...ride.race, atMs: ride.race.atMs + 500 },
      ride.bots,
      SPIKE_CIRCUITS.hilly,
      ride.seed,
      ride.draft,
      200 / 75,
      12.6,
    );
    expect(later.bots.map((bot) => bot.secondsInMove)).toEqual(
      input.bots.map((bot) => bot.secondsInMove),
    );
  });

  it('reads 0 s in its move for a bot that has made no choice yet, as on the line (#2715)', () => {
    // A bot still carrying the tactics' starting memory has `sinceMs: null`.
    expect(TACTIC_MEMORY_AT_START.sinceMs).toBeNull();
    const fresh = ride.bots.map((bot, seat) =>
      seat === 0 ? { ...bot, tactics: TACTIC_MEMORY_AT_START } : bot,
    );
    const read = modelInput(
      ride.race,
      fresh,
      SPIKE_CIRCUITS.hilly,
      ride.seed,
      ride.draft,
      200 / 75,
      12.6,
    );
    const first = read.bots.find((bot) => bot.bot === 0);
    expect(first?.move).toBe(TACTIC_MEMORY_AT_START.tactic);
    expect(first?.secondsInMove).toBe(0);
    // Every other bot still reads the seconds it has held its own move.
    const held = (view: ModelInput): number[] =>
      view.bots.filter((bot) => bot.bot !== 0).map((bot) => bot.secondsInMove);
    expect(held(read)).toEqual(held(input));
  });

  it('reads the lull in whole seconds, and opens or shuts no attack itself (#2720)', () => {
    expect(input.quietS).toBe(12);
    expect(input).not.toHaveProperty('attackOpen');
    expect(Object.keys(input).sort()).toEqual(['bots', 'field', 'laps', 'quietS', 'rider']);
  });

  it('deals each bot a racing style from the seed: every style once in a field of seven, the same seed the same deal (#2720)', () => {
    expect(input.bots.map((bot) => bot.style)).toEqual(modelRacingStyles(ride.seed, 7));
    for (const seed of [1, 2, 3, 99, 2 ** 31]) {
      const deal = modelRacingStyles(seed, 7);
      expect(new Set(deal), String(seed)).toEqual(new Set(MODEL_RACING_STYLES));
      expect(modelRacingStyles(seed, 7)).toEqual(deal);
      expect(modelRacingStyles(seed, 3).every((style) => MODEL_RACING_STYLES.includes(style))).toBe(
        true,
      );
    }
    // Pinned, so a change to the salt (a deal that no longer draws apart) is seen.
    expect(modelRacingStyles(1, 7)).toEqual([
      'opportunist',
      'breakaway',
      'climber',
      'breakaway',
      'sprinter',
      'rouleur',
      'sprinter',
    ]);
    // The seed shuffles it: not every seed deals the same field.
    const deals = new Set([1, 2, 3, 4, 5, 6].map((seed) => modelRacingStyles(seed, 7).join()));
    expect(deals.size).toBeGreaterThan(3);
  });

  it('reads the line as each bot misreads it, and its W′ as it is, blown or not (#2720)', () => {
    const { laps, lapLengthMetres } = ride.race.course;
    const misread = input.bots.map((bot) => {
      const effort = ride.race.racers.find((entry) => entry.racer.id === ride.bots[bot.bot]?.id)
        ?.racer.effortDistance as number;
      const off = bot.toLineM - (laps * lapLengthMetres - effort);
      expect(Math.abs(off)).toBeLessThanOrEqual(BOT_TACTICS_MISJUDGE_LINE_METRES + 0.5);
      // The very read `decideTactic` launches on, with its sign (D-3.5).
      const read = botTacticsMisjudgement(
        ride.seed,
        bot.bot,
        (ride.bots[bot.bot] as (typeof ride.bots)[number]).strategy.skill,
        ride.race.atMs,
      ).lineMetres;
      expect(Math.abs(off - read)).toBeLessThanOrEqual(1);
      const energy = ride.bots[bot.bot]?.energy;
      expect(bot.blown).toBe(energy?.exhausted);
      return off;
    });
    // Not vacuous: some bot in this field misreads the line by more than rounding.
    expect(misread.some((off) => Math.abs(off) > 1)).toBe(true);
    const blownBots = ride.bots.map((bot) => ({
      ...bot,
      energy: { wbalJoules: 0, exhausted: true },
    }));
    const blown = modelInput(
      ride.race,
      blownBots,
      SPIKE_CIRCUITS.hilly,
      ride.seed,
      ride.draft,
      200 / 75,
      0,
    );
    expect(blown.bots.every((bot) => bot.blown && bot.wbal === 0)).toBe(true);
    // Blown is the body's `exhausted` flag, not an empty W′: a bot refilling is still blown,
    // and one that has just touched zero but is not flagged is not.
    const as = (energy: { wbalJoules: number; exhausted: boolean }): ModelInput =>
      modelInput(
        ride.race,
        ride.bots.map((bot) => ({ ...bot, energy })),
        SPIKE_CIRCUITS.hilly,
        ride.seed,
        ride.draft,
        200 / 75,
        0,
      );
    expect(as({ wbalJoules: 1_000, exhausted: true }).bots.every((bot) => bot.blown)).toBe(true);
    expect(as({ wbalJoules: 0, exhausted: false }).bots.some((bot) => bot.blown)).toBe(false);
  });

  it('reads the rider’s state: rank, who is ahead of them, their gaps and whether they draft (#2720)', () => {
    const riderAt = (effort: number): ModelInput =>
      modelInput(
        {
          ...ride.race,
          racers: ride.race.racers.map((entry) =>
            ride.bots.some((bot) => bot.id === entry.racer.id)
              ? entry
              : { ...entry, racer: { ...entry.racer, effortDistance: effort } },
          ),
        },
        ride.bots,
        SPIKE_CIRCUITS.hilly,
        ride.seed,
        ride.draft,
        200 / 75,
        0,
      );
    // The rider put 1 m behind the third bot on the road: the fourth behind them.
    const efforts = ride.bots
      .map((bot, seat) => ({
        seat,
        effort: ride.race.racers.find((entry) => entry.racer.id === bot.id)?.racer
          .effortDistance as number,
      }))
      .sort((a, b) => b.effort - a.effort);
    const [third, fourth] = [efforts[2], efforts[3]] as [
      (typeof efforts)[number],
      (typeof efforts)[number],
    ];
    expect(third.effort - fourth.effort).toBeGreaterThan(1);
    const middle = riderAt(third.effort - 1);
    expect(middle.rider.rank).toBe(4);
    expect(middle.rider.ahead).toBe(third.seat);
    expect(middle.rider.gapAheadM).toBe(1);
    expect(middle.rider.gapBehindM).toBeCloseTo(third.effort - 1 - fourth.effort, 1);
    expect(middle.bots.find((bot) => bot.bot === fourth.seat)?.ahead).toBe('rider');
    // Put in the lead, the rider has nobody ahead and no draft.
    const leading = riderAt(5_000);
    expect(leading.rider).toMatchObject({ rank: 1, ahead: null, gapAheadM: null, drafting: false });
    // Last, nobody behind.
    expect(riderAt(0).rider.gapBehindM).toBeNull();
  });

  it('counts the lull from the last tick any bot attacked or rode a flyer, or from the start (#2708)', () => {
    const tick = (second: number, moves: readonly BotTactic[]): FieldTick => ({
      second,
      at: new Map(),
      tactic: new Map(moves.map((move, at) => [String(at), move])),
      wbal: new Map(),
      exhausted: new Map(),
      k: new Map(),
      power: new Map(),
      inside: 0,
    });
    const sitting = tick(1, ['sit-in', 'follow', 'chase', 'recover', 'kick']);
    expect(quietSeconds([sitting, tick(2, ['sit-in', 'chase'])], 9_000)).toBe(9);
    expect(quietSeconds([tick(1, ['sit-in', 'attack']), sitting, tick(3, ['sit-in'])], 9_000)).toBe(
      8,
    );
    expect(quietSeconds([tick(1, ['attack']), tick(4, ['flyer', 'sit-in']), sitting], 9_000)).toBe(
      5,
    );
    expect(quietSeconds([], 2_500)).toBe(2.5);
  });

  it('is about 1 500 tokens with the instructions: under 5 500 characters together (#2720)', () => {
    expect(JSON.stringify(input).length + MODEL_TACTICS_SYSTEM.length).toBeLessThan(5_500);
  });

  it('carries no coordinate of the circuit, at any precision, and no name', () => {
    const text = JSON.stringify(decisionRequest(input, 7, 1));
    const positions = SPIKE_CIRCUITS.hilly.positions;
    expect(positions.length).toBeGreaterThan(10);
    for (const position of positions) {
      for (const value of [position.latitude, position.longitude]) {
        // Three places is about 100 m, four about 10 m: enough to find a
        // street, and a house. (Two would match the input's own 2-place W′.)
        for (const places of [3, 4]) {
          expect(text).not.toContain(Math.abs(value).toFixed(places));
        }
      }
    }
    expect(text).not.toMatch(
      /\\"(?:lat|latitude|lon|lng|longitude|position|place|name)\\"|bot-\d/iu,
    );
    // The bots are named by seat; their names (which carry their style) are the HUD's.
    for (const name of Object.values(ride.names)) expect(text).not.toContain(name);
  });

  it('asks Ollama with no tools, thinking off, and the schema as the format', () => {
    const body = decisionRequest(input, 7, 1);
    expect(Object.keys(body).sort()).toEqual(
      ['format', 'keep_alive', 'messages', 'model', 'options', 'stream', 'think'].sort(),
    );
    expect(body).not.toHaveProperty('tools');
    expect(body['think']).toBe(false);
    expect(body['stream']).toBe(false);
    expect(JSON.stringify(body['format'])).toContain('"additionalProperties":false');
    // #2720: the format is the whole schema, the target with it, so a move may name any racer.
    expect(body['format']).toEqual(modelDecisionSchema(7));
    expect(JSON.stringify(body['format'])).toContain('target');
    expect(body['messages']).toHaveLength(2);
  });
});
