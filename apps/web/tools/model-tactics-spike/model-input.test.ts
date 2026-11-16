// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: what the model is shown carries the race on effort distance and
 * nothing that says where it is: no coordinate, no place, no name (CLAUDE.md
 * §6). And the one call sent to Ollama gives the model no tools.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { LapRaceRide } from '../../src/game/lap-race/ride-race';

import { modelInput, type ModelInput } from './model-input';
import { decisionRequest, MODEL_TACTICS_SYSTEM } from './ollama';
import { rideField, SPIKE_CIRCUITS } from './race';

let ride: LapRaceRide;
let input: ModelInput;
beforeAll(async () => {
  ride = (await rideField('hilly', 1, { kind: 'seeded' }, 60)).last;
  input = modelInput(ride.race, ride.bots, SPIKE_CIRCUITS.hilly, ride.draft, 200 / 75);
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
    expect(body['messages']).toHaveLength(2);
  });
});
