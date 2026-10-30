// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drafting on this client — #787, ADR 0038 D-4 and D-5: the draft predicted
 * for this rider from the room's newest frame, ridden by the game's own
 * simulation and corrected by the room; where riders are DRAWN against where
 * the room HOLDS them; and that nothing but a room's rider gives or takes a
 * draft. Through the production room port over a scripted room, the same
 * `RoomSession` and `roomFrame` the game is handed.
 */

import { describe, expect, it } from 'vitest';

import {
  botPacerPlan,
  gradePercent,
  kilograms,
  metres,
  metresPerSecond,
  seconds,
  watts,
  type RouteProfile,
} from '@onyourleft/domain';
import { advance, fieldDraftFactors, ridingConditions, START_OF_RIDE } from '@onyourleft/physics';

import { roomPortOver, type RoomConnection } from '../net/room-port';
import { flush, frameRider, ManualClock, ScriptedRoom } from '../net/testing';
import { northRoute } from './route-fixtures-testing';
import { draftReading, roomFrame, roomRideState } from './room-ride';
import { placedRiders } from './scene';
import { GameSimulation, SIMULATION_STEP_SECONDS, atStartLine } from './simulation';
import { corridorOrigin, roadCorridor } from './terrain';

async function joined(drafting: 'on' | 'off' = 'on'): Promise<{
  readonly room: ScriptedRoom;
  readonly connection: RoomConnection;
}> {
  const room = new ScriptedRoom();
  const clock = new ManualClock();
  const connection = roomPortOver(() => room.link(), { timers: clock, now: clock.now }).join({
    roomId: 'room-1',
    declaredMassKilograms: 70,
    sample: () => ({ powerWatts: 200 }),
  });
  await flush();
  room.accept();
  room.welcome(0, 'ride', drafting);
  return { room, connection };
}

const MASS = kilograms(70);

const flat = (length: number): RouteProfile => northRoute(length, () => 10);

function simulation(profile: RouteProfile, withPacer = false): GameSimulation {
  return new GameSimulation({
    profile,
    // What a room ride rides: `ridingConditions`, the call a room makes.
    conditions: ridingConditions(MASS, 'hoods'),
    ...(withPacer ? { pacer: botPacerPlan(3) } : {}),
  });
}

describe('the draft this client predicts — #787', () => {
  it('is the room’s own model over the room’s newest frame, so it is the k the room rides this rider at next', async () => {
    const { room, connection } = await joined();
    expect(connection.draftFactor()).toBe(1);
    room.frame(1, [frameRider(0, 100), frameRider(1, 101.5), frameRider(2, 140)]);
    const expected = fieldDraftFactors([100, 101.5, 140])[0] as number;
    expect(expected).toBeLessThan(0.7);
    expect(connection.draftFactor()).toBe(expected);
  });

  it('is 1 in a room with drafting off, whoever is in front', async () => {
    const { room, connection } = await joined('off');
    room.frame(1, [frameRider(0, 100), frameRider(1, 101.5)]);
    expect(connection.draftFactor()).toBe(1);
  });

  it('is ridden by the game, to the bit of the room’s own conditions at that k', () => {
    const profile = flat(5_000);
    const drafted = simulation(profile);
    const k = 0.62;
    drafted.draftWith(k);
    for (let at = 0; at <= 10_000; at += 100)
      drafted.advanceTo(at, { power: watts(200), live: true });
    // The room's tick at the same k, the same power and the same road, one
    // fixed step at a time, as the game steps.
    const alone = simulation(profile);
    for (let at = 0; at <= 10_000; at += 100)
      alone.advanceTo(at, { power: watts(200), live: true });
    expect(drafted.state.ride.distance).toBeGreaterThan(alone.state.ride.distance);
    const conditions = ridingConditions(MASS, 'hoods', k);
    let ride = START_OF_RIDE;
    const steps = Math.round((drafted.state.elapsed as number) / SIMULATION_STEP_SECONDS);
    for (let step = 0; step < steps; step += 1) {
      ride = advance(
        ride,
        {
          power: watts(200),
          grade: gradePercent(0),
          duration: seconds(SIMULATION_STEP_SECONDS),
        },
        conditions,
      );
    }
    expect(steps).toBeGreaterThan(100);
    expect(drafted.state.ride.distance).toBe(ride.distance);
  });

  it('is fed to the simulation by every room frame', async () => {
    const { room, connection } = await joined();
    room.frame(1, [frameRider(0, 100), frameRider(1, 101.5)]);
    const sim = simulation(flat(5_000));
    roomFrame(connection, roomRideState(), sim, 0);
    expect(sim.draftFactor).toBe(connection.draftFactor());
    expect(sim.draftFactor).toBeLessThan(1);
  });
});

describe('nothing but a room’s rider gives or takes a draft — #327, ADR 0038 D-5', () => {
  it('gives no draft from a bot pacer 1 m ahead: k = 1', async () => {
    const { room, connection } = await joined();
    // The room's frame has this rider alone; the game's bot is a metre up the road.
    room.frame(1, [frameRider(0, 100)]);
    const sim = simulation(flat(5_000), true);
    roomFrame(connection, roomRideState(), sim, 0);
    expect(connection.draftFactor()).toBe(1);
    expect(sim.draftFactor).toBe(1);
  });

  it('never drafts the bot, whatever the rider is ridden at', () => {
    const profile = flat(5_000);
    const drafted = simulation(profile, true);
    const alone = simulation(profile, true);
    drafted.draftWith(0.5);
    for (let at = 0; at <= 10_000; at += 100) {
      drafted.advanceTo(at, { power: watts(200), live: true });
      alone.advanceTo(at, { power: watts(200), live: true });
    }
    expect(drafted.state.bot?.state.distance).toBe(alone.state.bot?.state.distance);
    expect(drafted.state.ride.distance).not.toBe(alone.state.ride.distance);
  });
});

describe('drawn behind is behind in the room — #787, ADR 0038 D-3.4', () => {
  /**
   * The room holds no lateral position: every rider is single file, placed by
   * distance along the route alone. So a rider DRAWN directly behind another
   * — on the same line across the road — must be one the room's geometry has
   * behind them, within reach, and so drafted. `placedRiders` is the step
   * every frame's markers come from (`scene.ts`), so this reads the lateral
   * offsets the renderer is handed for the very distances the room holds.
   */
  it('draws a rider 4 m behind another on the same line, and the room drafts them', () => {
    const profile = flat(2_000);
    const origin = corridorOrigin(profile);
    for (const gap of [4, 8, 15, 29]) {
      const here = 500;
      const state = {
        ...atStartLine(profile),
        ride: { speed: metresPerSecond(10), distance: metres(here) },
      };
      const placed = placedRiders(
        {
          profile,
          origin,
          state,
          remoteRiders: [{ riderId: 1, distanceMetres: here + gap, speedMetresPerSecond: 10 }],
        },
        roadCorridor(profile, origin, here),
      );
      const [own, ahead] = placed;
      // Drawn directly behind: the same lateral offset, to the millimetre.
      expect(
        Math.abs((own?.lateral ?? 0) - (ahead?.lateral ?? 0)),
        `${String(gap)} m`,
      ).toBeLessThan(0.001);
      // …and behind in the room's geometry, which drafts them.
      const [k] = fieldDraftFactors([here, here + gap]);
      expect(k, `${String(gap)} m`).toBeLessThan(1);
    }
  });

  it('draws two riders level side by side — and the room, single file, drafts neither when they ARE level', () => {
    const profile = flat(2_000);
    const origin = corridorOrigin(profile);
    const here = 500;
    const state = {
      ...atStartLine(profile),
      ride: { speed: metresPerSecond(10), distance: metres(here) },
    };
    const placed = placedRiders(
      {
        profile,
        origin,
        state,
        remoteRiders: [{ riderId: 1, distanceMetres: here + 0.01, speedMetresPerSecond: 10 }],
      },
      roadCorridor(profile, origin, here),
    );
    const [own, beside] = placed;
    expect(Math.abs((own?.lateral ?? 0) - (beside?.lateral ?? 0))).toBeGreaterThan(1);
    expect(fieldDraftFactors([here, here + 0.01])).toEqual([1, 1]);
  });
});

describe('the HUD’s draft is the room’s — #787, ADR 0038 D-5', () => {
  it('reads the room’s own frame for this rider, says Off in a room without drafting, and nothing before a frame', async () => {
    const on = await joined();
    expect(draftReading(on.connection)).toBeUndefined();
    on.room.frame(1, [frameRider(0, 100, 10, 34), frameRider(1, 101.5)]);
    expect(draftReading(on.connection)).toBe(34);
    const off = await joined('off');
    off.room.frame(1, [frameRider(0, 100), frameRider(1, 101.5)]);
    expect(draftReading(off.connection)).toBe('off');
  });
});
