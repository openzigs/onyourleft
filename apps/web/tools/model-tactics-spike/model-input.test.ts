// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: what the model is shown carries the race on effort distance and
 * nothing that says where it is: no coordinate, no place, no name (CLAUDE.md
 * §6). And the one call sent to Ollama gives the model no tools.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { BotTactic } from '@onyourleft/domain';

import type { LapRaceRide } from '../../src/game/lap-race/ride-race';

import { modelAnswerFormat } from './decision';

import { MODEL_ATTACK_QUIET_SECONDS, modelInput, type ModelInput } from './model-input';
import { decisionRequest, MODEL_TACTICS_SYSTEM } from './ollama';
import { quietSeconds, rideField, SPIKE_CIRCUITS, type FieldTick } from './race';

let ride: LapRaceRide;
let input: ModelInput;
beforeAll(async () => {
  ride = (await rideField('hilly', 1, { kind: 'seeded' }, 60)).last;
  input = modelInput(ride.race, ride.bots, SPIKE_CIRCUITS.hilly, ride.draft, 200 / 75, 12.6);
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
      ride.draft,
      200 / 75,
      12.6,
    );
    expect(later.bots.map((bot) => bot.secondsInMove)).toEqual(
      input.bots.map((bot) => bot.secondsInMove),
    );
  });

  it('reads the lull in whole seconds, and opens an attack from 30 s of it (#2708)', () => {
    expect(input.quietS).toBe(12);
    expect(input.attackOpen).toBe(false);
    const at = (quiet: number): ModelInput =>
      modelInput(ride.race, ride.bots, SPIKE_CIRCUITS.hilly, ride.draft, 200 / 75, quiet);
    expect(at(MODEL_ATTACK_QUIET_SECONDS - 0.05).attackOpen).toBe(false);
    expect(at(MODEL_ATTACK_QUIET_SECONDS).attackOpen).toBe(true);
    expect(at(MODEL_ATTACK_QUIET_SECONDS).quietS).toBe(30);
  });

  it('counts the lull from the last tick any bot attacked or rode a flyer, or from the start (#2708)', () => {
    const tick = (second: number, moves: readonly BotTactic[]): FieldTick => ({
      second,
      at: new Map(),
      tactic: new Map(moves.map((move, at) => [String(at), move])),
      wbal: new Map(),
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

  it('is about 1 000 tokens with the instructions: under 4 000 characters together', () => {
    expect(JSON.stringify(input).length + MODEL_TACTICS_SYSTEM.length).toBeLessThan(4_000);
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
    // #2708: the format offers no target, so the model cannot aim a move at a stale wheel.
    expect(body['format']).toEqual(modelAnswerFormat(7));
    expect(JSON.stringify(body['format'])).not.toContain('target');
    expect(body['messages']).toHaveLength(2);
  });
});
