// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drafting on this client — #787, ADR 0038 D-4 and D-5: the draft predicted
 * for this rider from the room's newest frame, ridden by the game's own
 * simulation and corrected by the room; where riders are DRAWN against where
 * the room HOLDS them; and that a pacer and a ghost give a draft only on a
 * solo ride and never take one (#2425, ADR 0066). Through the production room port over a scripted room, the same
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
import {
  advance,
  draftFactor,
  fieldDraftFactors,
  ridingConditions,
  START_OF_RIDE,
} from '@onyourleft/physics';

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

function simulation(
  profile: RouteProfile,
  withPacer = false,
  soloDraft = false,
  intensity = 3,
): GameSimulation {
  return new GameSimulation({
    profile,
    // What a room ride rides: `ridingConditions`, the call a room makes.
    conditions: ridingConditions(MASS, 'hoods'),
    ...(withPacer ? { pacer: botPacerPlan(intensity) } : {}),
    // #2425: the solo draft, as `GameView` hands it with the switch on.
    ...(soloDraft ? { soloDraft: {} } : {}),
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

describe('a pacer and a ghost give a draft only on a solo ride, and never take one — #2425, ADR 0066 D-1, D-8', () => {
  it('gives no draft from a bot pacer 1 m ahead in a room: the room’s k is the only k', async () => {
    const { room, connection } = await joined();
    // The room's frame has this rider alone; the game's bot is a metre up the road.
    room.frame(1, [frameRider(0, 100)]);
    const sim = simulation(flat(5_000), true);
    roomFrame(connection, roomRideState(), sim, 0);
    expect(connection.draftFactor()).toBe(1);
    expect(sim.draftFactor).toBe(1);
  });

  it('drafts a solo rider about a metre behind the pacer at draftFactor(gap, 1), and they ride further than with the switch off, at k = 1', () => {
    const profile = flat(5_000);
    const on = simulation(profile, true, true);
    const off = simulation(profile, true);
    let nearAMetre = 0;
    // 600 s at 200 W, one fixed step per call — a millisecond past each
    // step's boundary, so no call lands on one — so each step's k is read
    // back against the odometers it began from.
    on.advanceTo(0, { power: watts(200), live: true });
    off.advanceTo(0, { power: watts(200), live: true });
    for (let step = 1; step <= 600 / SIMULATION_STEP_SECONDS; step += 1) {
      const rider = on.state.ride.distance as number;
      const bot = on.state.bot?.state.distance as number;
      const at = step * SIMULATION_STEP_SECONDS * 1000 + 1;
      expect(on.advanceTo(at, { power: watts(200), live: true }).steps).toBe(1);
      off.advanceTo(at, { power: watts(200), live: true });
      expect(off.draftFactor).toBe(1);
      const gap = bot - rider;
      // Nobody is behind a rider who is behind the pacer: k is the trailing
      // table's at depth 1, from `@onyourleft/physics` and nothing beside it.
      if (gap >= 0.05 && gap <= 30) expect(on.draftFactor).toBe(draftFactor(gap, 1));
      if (gap > 0.5 && gap < 1.5) nearAMetre += 1;
    }
    expect(nearAMetre, 'steps ridden about a metre behind the pacer').toBeGreaterThan(100);
    expect(on.state.ride.distance).toBeGreaterThan(off.state.ride.distance);
  });

  it('never drafts the bot, whatever the rider is ridden at, and whether or not the pacer gives a draft', () => {
    const profile = flat(5_000);
    const drafted = simulation(profile, true);
    const alone = simulation(profile, true);
    // #2425: the pacer giving the rider a draft, with the rider behind it
    // (200 W) and in front of it (400 W).
    const behind = simulation(profile, true, true);
    const ahead = simulation(profile, true, true);
    drafted.draftWith(0.5);
    for (let at = 0; at <= 10_000; at += 100) {
      drafted.advanceTo(at, { power: watts(200), live: true });
      alone.advanceTo(at, { power: watts(200), live: true });
      behind.advanceTo(at, { power: watts(200), live: true });
      ahead.advanceTo(at, { power: watts(400), live: true });
      expect(behind.state.bot?.state.distance).toBe(alone.state.bot?.state.distance);
      expect(ahead.state.bot?.state.distance).toBe(alone.state.bot?.state.distance);
    }
    expect(drafted.state.bot?.state.distance).toBe(alone.state.bot?.state.distance);
    expect(drafted.state.ride.distance).not.toBe(alone.state.ride.distance);
    expect(behind.state.ride.distance).not.toBe(alone.state.ride.distance);
    expect(ahead.state.ride.distance).toBeGreaterThan(alone.state.bot?.state.distance as number);
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
