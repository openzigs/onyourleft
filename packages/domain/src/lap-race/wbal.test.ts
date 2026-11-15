// SPDX-License-Identifier: Apache-2.0

/**
 * #2458, ADR 0067 D-2 and D-5.2: a lap-race bot's W′ balance, in the discrete
 * differential form, on its own. `plan.test.ts` holds the plan that spends it,
 * and `@onyourleft/physics` §`lap-race-bot.test.ts` the balance over whole
 * races.
 */

import { describe, expect, it } from 'vitest';

import { BOT_MASS_KILOGRAMS, MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM } from '../pacer/pacing';
import { LapRaceError } from './errors';
import wbalSource from './wbal.ts?raw';
import {
  BOT_CEILING_WATTS,
  BOT_WBAL_REENTRY_FRACTION,
  BOT_WBAL_TICK_TOLERANCE,
  fullBotEnergy,
  spendableWatts,
  stepWbal,
  type BotCapacity,
  type BotEnergy,
} from './wbal';

/** A `hard` bot's capacity: 3.6 W/kg at 75 kg, 18 kJ, and room above 1.5 × CP under 7 W/kg. */
const CP = 270;
const W_PRIME = 18_000;
const CAPACITY: BotCapacity = {
  cpWatts: CP,
  wPrimeJoules: W_PRIME,
  peakWatts: 1.8 * CP,
  floorWatts: 0.8 * CP,
};

/** The thrown error's code, or `undefined` if nothing was thrown. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof LapRaceError ? error.code : 'not a LapRaceError';
  }
  return undefined;
}

/** Ride `wanted` for `seconds`, `dt` at a time, as the plan does: what it may, then the balance. */
function ride(
  from: BotEnergy,
  wanted: number,
  seconds: number,
  dt: number,
): { readonly energy: BotEnergy; readonly trace: readonly BotEnergy[]; readonly power: number[] } {
  let energy = from;
  const trace: BotEnergy[] = [];
  const power: number[] = [];
  const ticks = Math.round(seconds / dt);
  for (let tick = 0; tick < ticks; tick += 1) {
    const ridden = spendableWatts(CAPACITY, energy, wanted, dt);
    energy = stepWbal(CAPACITY, energy, ridden, dt);
    power.push(ridden);
    trace.push(energy);
  }
  return { energy, trace, power };
}

describe('spending: an attack costs what it rides over CP (ADR 0067 D-2)', () => {
  it('starts full, and runs out holding 1.5 × CP at W′ / (0.5 · CP) seconds, within one tick', () => {
    expect(fullBotEnergy(CAPACITY)).toEqual({ wbalJoules: W_PRIME, exhausted: false });
    const expected = W_PRIME / (0.5 * CP);
    for (const dt of [1, 0.05]) {
      const { trace, power } = ride(fullBotEnergy(CAPACITY), 1.5 * CP, expected + 30, dt);
      const out = trace.findIndex((energy) => energy.exhausted);
      expect(out, `dt ${String(dt)}`).toBeGreaterThan(0);
      // The tick it ran out ends within one tick of the expected time.
      expect(Math.abs((out + 1) * dt - expected), `dt ${String(dt)}`).toBeLessThanOrEqual(dt);
      expect(trace[out]?.wbalJoules).toBe(0);
      // Until then it rode the 1.5 × CP it asked for; from the next tick, CP and no more.
      expect(power.slice(0, out - 1).every((each) => each === 1.5 * CP)).toBe(true);
      expect(power.slice(out + 1).every((each) => each === CP)).toBe(true);
    }
  });

  it('stays capped at CP while exhausted, though some balance has come back, until the re-entry share', () => {
    // Out, then 30 s at the floor: some back, under a fifth.
    const out = ride(fullBotEnergy(CAPACITY), 1.5 * CP, 200, 1).energy;
    expect(out).toEqual({ wbalJoules: 0, exhausted: true });
    const resting = ride(out, 0, 30, 1).energy;
    expect(resting.wbalJoules).toBeGreaterThan(0);
    expect(resting.wbalJoules).toBeLessThan(W_PRIME * BOT_WBAL_REENTRY_FRACTION);
    expect(resting.exhausted).toBe(true);
    expect(spendableWatts(CAPACITY, resting, 1.5 * CP, 1)).toBe(CP);
    // Rest on until past the share: no longer exhausted, and it attacks again.
    const rested = ride(resting, 0, 600, 1).energy;
    expect(rested.wbalJoules).toBeGreaterThan(W_PRIME * BOT_WBAL_REENTRY_FRACTION);
    expect(rested.exhausted).toBe(false);
    expect(spendableWatts(CAPACITY, rested, 1.5 * CP, 1)).toBe(1.5 * CP);
  });

  it('spends no more in a tick than the balance holds, so it lands on 0 and never below', () => {
    const last = { wbalJoules: 10, exhausted: false };
    expect(spendableWatts(CAPACITY, last, 1.5 * CP, 1)).toBe(CP + 10);
    expect(spendableWatts(CAPACITY, last, 2 * CP, 0.05)).toBe(CP + 200);
    expect(stepWbal(CAPACITY, last, CP + 10, 1)).toEqual({ wbalJoules: 0, exhausted: true });
    // Ridden harder than that anyway, by a caller that did not ask: clamped at 0.
    expect(stepWbal(CAPACITY, last, 1.5 * CP, 1)).toEqual({ wbalJoules: 0, exhausted: true });
  });

  it('rides inside the floor, the peak and 7 W/kg whatever it wants', () => {
    const full = fullBotEnergy(CAPACITY);
    expect(spendableWatts(CAPACITY, full, 0, 1)).toBe(CAPACITY.floorWatts);
    expect(spendableWatts(CAPACITY, full, 10 * CP, 1)).toBe(CAPACITY.peakWatts);
    expect(BOT_CEILING_WATTS).toBe(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * BOT_MASS_KILOGRAMS);
    const strong = { ...CAPACITY, peakWatts: 1_000 };
    expect(spendableWatts(strong, full, 10 * CP, 1)).toBe(BOT_CEILING_WATTS);
    // #2542: a floor the caller names, in place of the capacity's.
    expect(spendableWatts(CAPACITY, full, 0, 1, 0)).toBe(0);
    expect(spendableWatts(CAPACITY, full, -5, 1, 0)).toBe(0);
    expect(spendableWatts(CAPACITY, full, 0, 1, CAPACITY.floorWatts + 1)).toBe(
      CAPACITY.floorWatts + 1,
    );
    // Over a tick of no time nothing is spent, so the balance limits nothing.
    expect(spendableWatts(CAPACITY, { wbalJoules: 0, exhausted: false }, 1.5 * CP, 0)).toBe(
      1.5 * CP,
    );
  });
});

describe('recovery: slower as it fills, and never past W′', () => {
  it('rides under CP from empty and recovers monotonically, each tick less than the last, never reaching W′', () => {
    const { trace } = ride({ wbalJoules: 0, exhausted: true }, 0.8 * CP, 1_800, 1);
    let previous = 0;
    let gained = Number.POSITIVE_INFINITY;
    for (const energy of trace) {
      const step = energy.wbalJoules - previous;
      expect(step).toBeGreaterThan(0);
      // The (W′ − wbal) / W′ term: what comes back shrinks as the balance fills.
      expect(step).toBeLessThan(gained);
      expect(energy.wbalJoules).toBeLessThan(W_PRIME);
      gained = step;
      previous = energy.wbalJoules;
    }
    // The first second from empty is the whole shortfall under CP.
    expect(trace[0]?.wbalJoules).toBeCloseTo(0.2 * CP, 9);
    // Half an hour at 80 % of CP brings it close to full.
    expect(previous).toBeGreaterThan(0.9 * W_PRIME);
  });

  it('neither spends nor recovers at CP', () => {
    const half = { wbalJoules: W_PRIME / 2, exhausted: false };
    expect(stepWbal(CAPACITY, half, CP, 1)).toEqual(half);
  });

  it('changes nothing over a tick of no time', () => {
    const half = { wbalJoules: W_PRIME / 2, exhausted: false };
    expect(stepWbal(CAPACITY, half, 2 * CP, 0)).toEqual(half);
    expect(stepWbal(CAPACITY, half, 0, 0)).toEqual(half);
  });
});

describe('tick-rate independence: the solo race at 20 Hz and the tests at 1 s agree', () => {
  it('ends the same 60 s trace within BOT_WBAL_TICK_TOLERANCE of W′ at 0.05 s and at 1 s', () => {
    // An attack, a recovery and a tempo: a step change on whole seconds, so
    // both rates ride exactly the same trace.
    const trace = (second: number): number =>
      second < 20 ? 1.4 * CP : second < 40 ? 0.6 * CP : 1.05 * CP;
    const end = (dt: number): BotEnergy => {
      let energy = fullBotEnergy(CAPACITY);
      const ticks = Math.round(60 / dt);
      for (let tick = 0; tick < ticks; tick += 1) {
        energy = stepWbal(CAPACITY, energy, trace(Math.floor(tick * dt + 1e-9)), dt);
      }
      return energy;
    };
    const fine = end(0.05);
    const coarse = end(1);
    // Non-vacuity: the trace spent and recovered, so the two are not both full.
    expect(fine.wbalJoules).toBeLessThan(W_PRIME * 0.9);
    expect(fine.wbalJoules).toBeGreaterThan(0);
    expect(Math.abs(fine.wbalJoules - coarse.wbalJoules)).toBeLessThanOrEqual(
      W_PRIME * BOT_WBAL_TICK_TOLERANCE,
    );
  });
});

describe('room-portable arithmetic (ADR 0067 D-5.2)', () => {
  it('names no exponential, power, random draw or clock in the module', () => {
    // Comments are prose and may name what the code must not use: the scan is of the code.
    const code = wbalSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('stepWbal');
    for (const banned of [
      /Math\.exp\b/,
      /Math\.pow\b/,
      /\*\*/,
      /Math\.random\b/,
      /\bDate\b/,
      /performance\./,
    ]) {
      expect(code).not.toMatch(banned);
    }
    // Only Math.min and Math.max of Math at all.
    const used = new Set([...code.matchAll(/Math\.(\w+)/g)].map((match) => match[1]));
    expect([...used].sort()).toEqual(['max', 'min']);
  });
});

describe('it refuses what is not a balance', () => {
  it('names the field and the constraint, never the value', () => {
    const full = fullBotEnergy(CAPACITY);
    expect(codeOf(() => stepWbal(CAPACITY, { wbalJoules: -1, exhausted: false }, CP, 1))).toBe(
      'wbal-out-of-range',
    );
    expect(
      codeOf(() => stepWbal(CAPACITY, { wbalJoules: W_PRIME + 1, exhausted: false }, CP, 1)),
    ).toBe('wbal-out-of-range');
    expect(
      codeOf(() => stepWbal(CAPACITY, { wbalJoules: Number.NaN, exhausted: false }, CP, 1)),
    ).toBe('wbal-out-of-range');
    expect(codeOf(() => stepWbal(CAPACITY, full, CP, -1))).toBe('elapsed-out-of-range');
    expect(codeOf(() => stepWbal(CAPACITY, full, CP, Number.POSITIVE_INFINITY))).toBe(
      'elapsed-out-of-range',
    );
    expect(codeOf(() => stepWbal(CAPACITY, full, Number.NaN, 1))).toBe('power-not-finite');
    expect(
      codeOf(() =>
        stepWbal({ ...CAPACITY, wPrimeJoules: 0 }, { wbalJoules: 0, exhausted: false }, CP, 1),
      ),
    ).toBe('capacity-out-of-range');
    expect(codeOf(() => stepWbal({ ...CAPACITY, cpWatts: Number.NaN }, full, CP, 1))).toBe(
      'capacity-out-of-range',
    );
    for (const recoveryFactor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(() => stepWbal({ ...CAPACITY, recoveryFactor }, full, CP, 1))).toBe(
        'capacity-out-of-range',
      );
    }
    expect(codeOf(() => spendableWatts(CAPACITY, full, Number.NaN, 1))).toBe('power-not-finite');
    expect(codeOf(() => spendableWatts(CAPACITY, full, CP, 1, Number.NaN))).toBe(
      'power-not-finite',
    );
    expect(codeOf(() => spendableWatts({ ...CAPACITY, peakWatts: Number.NaN }, full, CP, 1))).toBe(
      'capacity-out-of-range',
    );
    expect(codeOf(() => stepWbal({ ...CAPACITY, floorWatts: Number.NaN }, full, CP, 1))).toBe(
      'capacity-out-of-range',
    );
    expect(codeOf(() => spendableWatts(CAPACITY, full, CP, -1))).toBe('elapsed-out-of-range');
    expect(
      codeOf(() => spendableWatts(CAPACITY, { wbalJoules: -1, exhausted: false }, CP, 1)),
    ).toBe('wbal-out-of-range');
    expect(codeOf(() => stepWbal(CAPACITY, full, CP, 1))).toBeUndefined();
    let message = '';
    try {
      stepWbal(CAPACITY, { wbalJoules: 123_456, exhausted: false }, CP, 1);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('W prime balance');
    expect(message).not.toContain('123');
  });
});

describe('exhaustion latches on an off-round capacity at the game tick (review of #2482)', () => {
  it('holding the surge ceiling at 0.05 s, a hard bot at ability 0.99 runs out and stays capped until the re-entry threshold', () => {
    const cp = 270 * 0.99;
    const capacity: BotCapacity = {
      cpWatts: cp,
      wPrimeJoules: W_PRIME,
      peakWatts: 1.8 * cp,
      floorWatts: 0.8 * cp,
    };
    let energy = fullBotEnergy(capacity);
    for (let tick = 0; tick < 20 * 200 && !energy.exhausted; tick += 1) {
      energy = stepWbal(
        capacity,
        energy,
        spendableWatts(capacity, energy, capacity.peakWatts, 0.05),
        0.05,
      );
    }
    expect(energy.exhausted).toBe(true);
    expect(energy.wbalJoules).toBe(0);
    for (let tick = 0; tick < 20 * 600; tick += 1) {
      const ridden = spendableWatts(capacity, energy, capacity.peakWatts, 0.05);
      if (energy.exhausted) expect(ridden).toBeLessThanOrEqual(cp);
      else expect(energy.wbalJoules).toBeGreaterThan(W_PRIME * BOT_WBAL_REENTRY_FRACTION);
      energy = stepWbal(capacity, energy, ridden, 0.05);
      if (!energy.exhausted) break;
    }
  });
});
