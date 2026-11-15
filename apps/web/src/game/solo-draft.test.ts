// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A solo ride's draft — #2425, ADR 0066 — through the production
 * `GameSimulation`: the own ghost gives a draft and is never moved, the model's
 * inputs are odometers and never a drawn place, a ride with nobody to give a
 * draft is today's to the bit, the in-draft state advances per fixed step, a
 * finished ghost and a pacer past a route's end stay in the field, and the
 * trainer is written the grade at the rider's own odometer and nothing else.
 * `drafting.test.ts` holds the pacer's half (D-8).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  botPacerPlan,
  buildGhostTrack,
  gradeAt,
  ghostDistanceAt,
  kilograms,
  metres,
  watts,
  type GhostTrack,
  type RouteProfile,
  type Seconds,
} from '@onyourleft/domain';
import { draftFactor, fieldDraftFactors, leadFactor, ridingConditions } from '@onyourleft/physics';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { createGradientSession } from './gradient';
import { draftEvent } from './room-ride';
import { cornerRoute, northRoute } from './route-fixtures-testing';
import { drawnRiderDistance } from './scene';
import { corridorOrigin } from './terrain';
import { GameSimulation, ghostClock, SIMULATION_STEP_SECONDS, type GameState } from './simulation';
import {
  DRAFTED_SHARE,
  draftedRide,
  soloDraftPercent,
  type SoloDraftSources,
  type SoloDraftState,
} from './solo-draft';
import {
  readSoloDraftChoice,
  SOLO_DRAFT_STORAGE_KEY,
  writeSoloDraftChoice,
} from './solo-draft-preference';
import type { GradientTrainer } from './trainer-port';

const MASS = kilograms(70);
const flat = (length: number): RouteProfile => northRoute(length, () => 10);
const STEP_MS = SIMULATION_STEP_SECONDS * 1000;

function ride(
  profile: RouteProfile,
  options: {
    readonly pacer?: number;
    readonly soloDraft?: SoloDraftSources;
  } = {},
): GameSimulation {
  return new GameSimulation({
    profile,
    conditions: ridingConditions(MASS, 'hoods'),
    ...(options.pacer === undefined ? {} : { pacer: botPacerPlan(options.pacer) }),
    ...(options.soloDraft === undefined ? {} : { soloDraft: options.soloDraft }),
  });
}

/**
 * `steps` fixed steps at `power`, one per call — a millisecond past each
 * boundary, so no call lands on one — with `each` told the state each step
 * began from and the `k` it was ridden at.
 */
function stepThrough(
  simulation: GameSimulation,
  steps: number,
  power: number,
  each: (before: GameState, k: number) => void = () => undefined,
): void {
  simulation.advanceTo(0, { power: watts(power), live: true });
  for (let step = 1; step <= steps; step += 1) {
    const before = simulation.state;
    expect(
      simulation.advanceTo(step * STEP_MS + 1, { power: watts(power), live: true }).steps,
    ).toBe(1);
    each(before, simulation.draftFactor);
  }
}

/** The rider's `k` from the gaps alone: the table's two functions, not `fieldDraftFactors`. */
function oracle(rider: number, giver: number): number {
  const gap = giver - rider;
  if (gap >= 0.05 && gap <= 30) return draftFactor(gap, 1);
  if (-gap >= 0.05 && -gap <= 30) return leadFactor(-gap);
  return 1;
}

/** An attempt 2 m up the road from its first instant, at 8 m/s for ten minutes. */
const AHEAD: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 600],
  distanceMetres: [2, 2 + 8 * 600],
});

describe('the rider’s own ghost gives a draft, and is never moved — ADR 0066 D-1.1', () => {
  it('drafts the rider behind their ghost 2 m ahead, from ghostDistanceAt at the ride’s racing clock', () => {
    const asked: Seconds[] = [];
    const ghostAt = vi.fn((ridden: Seconds) => {
      asked.push(ridden);
      return ghostDistanceAt(AHEAD, ridden);
    });
    const simulation = ride(flat(5_000), { soloDraft: { ghostAt } });
    const clocks: Seconds[] = [];
    let drafted = 0;
    stepThrough(simulation, 400, 200, (before, k) => {
      // The ghost is asked where it is at the clock the HUD and the scene
      // read it at (`ghostClock`), as the step begins — and only that.
      clocks.push(ghostClock(before));
      const ghost = ghostDistanceAt(AHEAD, ghostClock(before));
      expect(k).toBe(oracle(before.ride.distance, ghost));
      if (k < 1) drafted += 1;
    });
    expect(asked).toEqual(clocks);
    expect(ghostAt).toHaveBeenCalledTimes(400);
    expect(drafted).toBeGreaterThan(0);
    // A replay, never re-simulated: the track is the track it was.
    expect(AHEAD.totalDistance).toBe(2 + 8 * 600);
  });

  it('keeps a ghost that finished in the field at the end of its attempt, still giving a draft — the owner, 2026-11-10 (D-1.6)', () => {
    // An attempt that stopped 40 m up the road after one second.
    const short = buildGhostTrack({ elapsedSeconds: [0, 1], distanceMetres: [0, 40] });
    const simulation = ride(flat(5_000), {
      soloDraft: { ghostAt: (ridden) => ghostDistanceAt(short, ridden) },
    });
    let shelteredPastItsEnd = 0;
    stepThrough(simulation, 400, 150, (before, k) => {
      if ((before.ridden as number) > 1 && before.ride.distance > 15) {
        expect(k).toBe(oracle(before.ride.distance, 40));
        if (k < 1) shelteredPastItsEnd += 1;
      }
    });
    expect(shelteredPastItsEnd).toBeGreaterThan(0);
  });

  it('keeps a pacer past the end of a point-to-point route in the field at its unclamped odometer (D-1.6)', () => {
    const short = flat(60);
    const simulation = ride(short, { pacer: 4, soloDraft: {} });
    let pastTheEnd = 0;
    stepThrough(simulation, 600, 150, (before, k) => {
      const bot = before.bot?.state.distance as number;
      expect(k).toBe(oracle(before.ride.distance, bot));
      if (bot > 60 && k < 1) pastTheEnd += 1;
    });
    expect(pastTheEnd).toBeGreaterThan(0);
  });
});

describe('the model reads odometers, never the drawing — ADR 0066 D-1.2', () => {
  it('rides the same k, step for step, whether the riders are drawn eased or not, on a 10 m corner', () => {
    const profile = cornerRoute(10);
    const origin = corridorOrigin(profile);
    const runs = [false, true].map((uneased) => {
      // Fast enough — about 13 m/s — for the corner to be eased (#1998).
      const simulation = ride(profile, { pacer: 7, soloDraft: {} });
      const ks: number[] = [];
      let drawnApart = 0;
      stepThrough(simulation, 1_600, 500, (before, k) => {
        ks.push(k);
        expect(k).toBe(oracle(before.ride.distance, before.bot?.state.distance as number));
        const input = { profile, origin, state: simulation.state, uneased };
        const odometer = simulation.state.ride.distance as number;
        if (Math.abs(drawnRiderDistance(input) - odometer) > 0.01) drawnApart += 1;
      });
      return { ks, drawnApart };
    });
    // Eased, the rider is drawn off their odometer through the corner;
    // un-eased, never: two drawings.
    expect(runs[0]?.drawnApart).toBeGreaterThan(0);
    expect(runs[1]?.drawnApart).toBe(0);
    expect(runs[0]?.ks).toEqual(runs[1]?.ks);
    expect(runs[0]?.ks.some((k) => k < 1)).toBe(true);
  });
});

describe('alone is exactly alone — ADR 0066 D-1.5, D-6', () => {
  it('rides a solo draft with nobody to give one bit for bit as a ride handed none, the same conditions object every step', () => {
    const profile = flat(5_000);
    const handed = ride(profile, { soloDraft: {} });
    const today = ride(profile);
    for (let at = 0; at <= 120_000; at += 100) {
      handed.advanceTo(at, { power: watts(230), live: true });
      today.advanceTo(at, { power: watts(230), live: true });
      expect(handed.state.ride).toEqual(today.state.ride);
      expect(handed.draftFactor).toBe(1);
    }
    expect(handed.state.ride.distance).toBe(today.state.ride.distance);
    expect(today.state.soloDraft).toBeUndefined();
  });

  it('carries no solo draft on a ride handed none — the switch off — whoever is up the road', () => {
    const simulation = ride(flat(5_000), { pacer: 4 });
    stepThrough(simulation, 200, 150, (_, k) => {
      expect(k).toBe(1);
    });
    expect(simulation.state.soloDraft).toBeUndefined();
  });
});

describe('in the draft, per fixed step — ADR 0066 D-5.6', () => {
  /** `draftEvent` replayed over each step's k, crediting each step's road. */
  function replayed(ks: readonly number[], covered: readonly number[]): SoloDraftState {
    let state: SoloDraftState = { k: 1, inDraft: false, inDraftMetres: 0, riddenMetres: 0 };
    ks.forEach((k, index) => {
      const inDraft = draftEvent(state.inDraft, soloDraftPercent(k)).inDraft;
      const metres = covered[index] as number;
      state = {
        k,
        inDraft,
        inDraftMetres: state.inDraftMetres + (inDraft ? metres : 0),
        riddenMetres: state.riddenMetres + metres,
      };
    });
    return state;
  }

  it('is draftEvent’s 10 % / 5 % state on each step’s whole k, and credits each step’s road to it', () => {
    const simulation = ride(flat(5_000), { pacer: 3.5, soloDraft: {} });
    const ks: number[] = [];
    const covered: number[] = [];
    stepThrough(simulation, 4_000, 200, (before, k) => {
      ks.push(k);
      covered.push((simulation.state.ride.distance as number) - (before.ride.distance as number));
    });
    const expected = replayed(ks, covered);
    expect(simulation.state.soloDraft).toEqual(expected);
    expect(expected.inDraftMetres).toBeGreaterThan(0);
    expect(expected.inDraftMetres).toBeLessThan(expected.riddenMetres);
  });

  it('credits a catch-up burst exactly as the same ride stepped frame by frame', () => {
    const profile = flat(5_000);
    const stepped = ride(profile, { pacer: 3.5, soloDraft: {} });
    const burst = ride(profile, { pacer: 3.5, soloDraft: {} });
    stepThrough(stepped, 200, 200);
    burst.advanceTo(0, { power: watts(200), live: true });
    burst.advanceTo(200 * STEP_MS + 1, { power: watts(200), live: true });
    expect(burst.state.soloDraft).toEqual(stepped.state.soloDraft);
    expect(burst.state.ride).toEqual(stepped.state.ride);
  });

  it('marks a ride drafted from DRAFTED_SHARE of its distance in the draft, and not below it', () => {
    const at = (inDraftMetres: number): SoloDraftState => ({
      k: 1,
      inDraft: false,
      inDraftMetres,
      riddenMetres: 1_000,
    });
    expect(DRAFTED_SHARE).toBe(0.1);
    expect(draftedRide(at(100))).toBe(true);
    expect(draftedRide(at(99.9))).toBe(false);
    expect(draftedRide(undefined)).toBe(false);
    expect(draftedRide({ k: 1, inDraft: false, inDraftMetres: 0, riddenMetres: 0 })).toBe(false);
  });

  it('never marks a ride on the leading-rider effect alone, which never reaches 10 %', () => {
    // A rider who rides away from the pacer at once: the pacer behind them.
    const simulation = ride(flat(5_000), { pacer: 1, soloDraft: {} });
    stepThrough(simulation, 2_000, 400, (_, k) => {
      expect(soloDraftPercent(k)).toBeLessThan(2.5);
    });
    expect(simulation.state.soloDraft?.inDraftMetres).toBe(0);
    expect(draftedRide(simulation.state.soloDraft)).toBe(false);
  });
});

describe('the switch is on the device and on by default — ADR 0066 D-6', () => {
  function disk(): Storage {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
  }

  it('is on until a stored off, and reads back what it wrote', () => {
    const store = disk();
    expect(readSoloDraftChoice(store)).toBe(true);
    expect(readSoloDraftChoice(undefined)).toBe(true);
    expect(writeSoloDraftChoice(store, false)).toBe(true);
    expect(store.getItem(SOLO_DRAFT_STORAGE_KEY)).toBe('off');
    expect(readSoloDraftChoice(store)).toBe(false);
    expect(writeSoloDraftChoice(store, true)).toBe(true);
    expect(readSoloDraftChoice(store)).toBe(true);
  });

  it('is on when the device will not say, and says so when it will not keep it', () => {
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    } as unknown as Storage;
    expect(readSoloDraftChoice(refusing)).toBe(true);
    expect(writeSoloDraftChoice(refusing, false)).toBe(false);
    expect(writeSoloDraftChoice(undefined, false)).toBe(false);
  });
});

describe('the trainer never feels the draft — ADR 0066 D-7', () => {
  /** A rising kilometre, then a falling one, so a grade is in play. */
  const hill = (): RouteProfile =>
    northRoute(2_000, (metres) => (metres <= 1_000 ? metres * 0.04 : (2_000 - metres) * 0.04));

  /** Every write a gradient session made over a ride, with the odometer it was sampled at. */
  async function writes(
    profile: RouteProfile,
    soloDraft: boolean,
  ): Promise<{ readonly written: SimulationParameters[]; readonly at: number[] }> {
    const written: SimulationParameters[] = [];
    const at: number[] = [];
    let sampled = 0;
    const control: GradientTrainer = {
      setSimulationParameters: (parameters) => {
        written.push(parameters);
        at.push(sampled);
        return Promise.resolve();
      },
      letGo: () => Promise.resolve({ kind: 'stopped' }),
    };
    const session = createGradientSession({ profile, control });
    const simulation = ride(profile, { pacer: 3.5, ...(soloDraft ? { soloDraft: {} } : {}) });
    for (let frame = 0; frame <= 2_400; frame += 1) {
      simulation.advanceTo(frame * 250, { power: watts(200), live: true });
      sampled = simulation.state.ride.distance;
      session.sample(simulation.state.elapsed, sampled, simulation.correcting);
      await session.settled();
    }
    return { written, at };
  }

  it('writes, drafted behind the pacer, the grade at the rider’s own odometer and nothing else', async () => {
    const profile = hill();
    const drafted = await writes(profile, true);
    const alone = await writes(profile, false);
    expect(drafted.written.length).toBeGreaterThan(10);
    drafted.written.forEach((parameters, index) => {
      expect(Object.keys(parameters)).toEqual(['grade']);
      expect(parameters.grade).toBe(gradeAt(profile, metres(drafted.at[index] as number)));
    });
    // The drafted rider reaches the hill's grades sooner, and nothing else.
    expect(alone.written.every((parameters) => Object.keys(parameters).join() === 'grade')).toBe(
      true,
    );
    expect(drafted.at.at(-1)).toBeGreaterThan(alone.at.at(-1) as number);
    // One model for the solo ride and the room: `fieldDraftFactors` at the rider.
    expect(fieldDraftFactors([0, 1])[0]).toBe(draftFactor(1, 1));
  });
});
