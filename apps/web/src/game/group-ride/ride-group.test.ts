// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A group ride on a ride — #3303, ADR 0101: the line stepped beside the
 * simulation's own rider on the real physics, the draft it hands back, the
 * word that the rider has stopped, the drawing and what the ride keeps.
 *
 * The rider here is `GameSimulation`, the one a ride is ridden by, handed the
 * group's draft the way `GameView` hands it: no scripted rider of its own.
 */

import {
  GROUP_PLAN_FACTOR_CEILING,
  GROUP_RIDE_CODE_VERSION,
  LINE_PHASES,
  RIDER_ROLES,
  watts,
  type RouteProfile,
} from '@onyourleft/domain';
import { GROUP_RIDE_LOG_MOST } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { riderMassFor } from '../../athlete/mass';
import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES } from '../lap-race/pack-layout';
import { rideConditionsFor } from '../rider';
import { seededRiderBody } from '../rider-body';
import { northRoute } from '../route-fixtures-testing';
import { GameSimulation, SIMULATION_STEP_SECONDS } from '../simulation';

import { groupRidePlan } from './choice';
import {
  GROUP_BOT_CP_WATTS,
  GROUP_BOT_STRENGTH_SPREAD,
  GROUP_RIDE_RIDER_ID,
  groupLine,
  groupRideDrawing,
  groupRideFact,
  startGroupRideSession,
  stepGroupRideSession,
  type GroupRideSession,
} from './ride-group';

const FLAT = northRoute(20_000, () => 0);
const THIRTY = 30 / 3.6;
const FRAME_MS = 250;

function started(
  options: { readonly bots?: number; readonly seed?: number; readonly profile?: RouteProfile } = {},
): GroupRideSession {
  const session = startGroupRideSession({
    choice: { targetSpeed: THIRTY, bots: options.bots ?? 5 },
    profile: options.profile ?? FLAT,
    riderDistance: 0,
    riderSpeed: 0,
    seed: options.seed ?? 7,
  });
  if (session === undefined) throw new Error('the group did not start');
  return session;
}

/** Ride `seconds` at `power` watts with the group, as `GameView`'s tick does; each frame's session. */
function ride(
  from: GroupRideSession,
  seconds: number,
  power: number,
  options: { readonly stopped?: (second: number) => boolean; readonly draft?: boolean } = {},
): { readonly frames: readonly GroupRideSession[]; readonly simulation: GameSimulation } {
  const simulation = new GameSimulation({
    profile: from.road.course,
    conditions: rideConditionsFor(riderMassFor(undefined).mass, 'hoods'),
    soloDraft: { raced: true },
  });
  const frames: GroupRideSession[] = [];
  let session = from;
  for (let at = FRAME_MS; at <= seconds * 1_000; at += FRAME_MS) {
    const { steps } = simulation.advanceTo(at, { power: watts(power), live: true, paired: true });
    session = stepGroupRideSession(session, {
      ticks: steps,
      rider: { distanceM: simulation.state.ride.distance, speedMps: simulation.state.ride.speed },
      riderStopped: options.stopped?.(at / 1_000) ?? false,
    });
    if (options.draft !== false) simulation.draftWith(session.riderDraft);
    frames.push(session);
  }
  return { frames, simulation };
}

const last = <T>(list: readonly T[]): T => list[list.length - 1] as T;

describe('the line at the press', () => {
  it('is the bots asked for, front first, with the rider on the last wheel', () => {
    for (const bots of [3, 5, 7]) {
      const session = started({ bots });
      expect(session.botIds).toHaveLength(bots);
      expect(session.state.rotation.order).toStrictEqual([...session.botIds, GROUP_RIDE_RIDER_ID]);
      // Formed up ahead of the rider, nearest last, so no bot starts behind the route's start.
      const ahead = session.botIds.map((id) => session.state.bots[id]?.distanceM ?? Number.NaN);
      expect(ahead.every((metres) => metres > 0)).toBe(true);
      expect([...ahead].sort((a, b) => b - a)).toStrictEqual(ahead);
      expect(session.riderDraft).toBe(1);
      expect(session.log).toStrictEqual([
        { at: 0, phase: 'forming', role: session.role, groupSpeed: session.groupSpeedMps },
      ]);
    }
  });

  it('is no ride for a size out of range or a target the plan refuses', () => {
    for (const bots of [2, 8, 4.5]) {
      expect(
        startGroupRideSession({
          choice: { targetSpeed: THIRTY, bots },
          profile: FLAT,
          riderDistance: 0,
          riderSpeed: 0,
        }),
      ).toBeUndefined();
    }
    expect(
      startGroupRideSession({
        choice: { targetSpeed: 90 / 3.6, bots: 5 },
        profile: FLAT,
        riderDistance: 0,
        riderSpeed: 0,
      }),
    ).toBeUndefined();
  });

  it('draws a seed of its own where none is named', () => {
    const drawn = [1, 2, 3, 4].map(
      () =>
        startGroupRideSession({
          choice: { targetSpeed: THIRTY, bots: 5 },
          profile: FLAT,
          riderDistance: 0,
          riderSpeed: 0,
        })?.seed,
    );
    expect(drawn.every((seed) => Number.isSafeInteger(seed) && (seed ?? -1) >= 0)).toBe(true);
    expect(new Set(drawn).size).toBeGreaterThan(1);
  });

  it('gives every bot a strength from the seed that always holds the front of the plan', () => {
    const plan = groupRidePlan({ targetSpeed: THIRTY, bots: 7 }, FLAT);
    if ('error' in plan) throw plan.error;
    const line = groupLine(7, 11, plan.basePower);
    expect(line.map((member) => member.kind)).toStrictEqual([
      ...Array.from({ length: 7 }, () => 'bot'),
      'rider',
    ]);
    const strengths = line.flatMap((member) =>
      member.kind === 'bot' ? [member.capacity.cpWatts] : [],
    );
    for (const cp of strengths) {
      expect(cp).toBeGreaterThanOrEqual(GROUP_BOT_CP_WATTS * (1 - GROUP_BOT_STRENGTH_SPREAD));
      expect(cp).toBeLessThanOrEqual(GROUP_BOT_CP_WATTS * (1 + GROUP_BOT_STRENGTH_SPREAD));
      // Over the most the plan asks of the front, so all ride the same speed.
      expect(cp).toBeGreaterThan(GROUP_PLAN_FACTOR_CEILING * plan.basePower);
    }
    // A spread, and the same one for the same seed, another for another.
    expect(new Set(strengths).size).toBe(7);
    expect(groupLine(7, 11, plan.basePower)).toStrictEqual(line);
    expect(groupLine(7, 12, plan.basePower)).not.toStrictEqual(line);
    // A plan that asks more of the front than the scripted figure lifts every bot over it.
    const hard = groupLine(3, 11, 500);
    for (const member of hard) {
      if (member.kind === 'bot') {
        expect(member.capacity.cpWatts).toBeGreaterThan(GROUP_PLAN_FACTOR_CEILING * 500);
      }
    }
  });
});

describe('the group stepped beside the rider', () => {
  it('rides its bots through the physics, and hands the rider a draft below 1 on a wheel', () => {
    const { frames, simulation } = ride(started(), 30, 120);
    const end = last(frames);
    // The bots rode: every one is well up the road from where it formed up.
    for (const id of end.botIds) {
      expect(end.state.bots[id]?.distanceM ?? 0).toBeGreaterThan(50);
      expect(end.state.bots[id]?.speedMps ?? 0).toBeGreaterThan(3);
    }
    // And the rider, who sat on the last wheel, was sheltered.
    const drafts = frames.map((frame) => frame.riderDraft);
    expect(Math.min(...drafts)).toBeLessThan(0.7);
    expect(drafts.every((k) => k > 0 && k <= 1)).toBe(true);
    // The time the group has ridden is the simulation's own steps.
    expect(end.state.atMs).toBeGreaterThan(29_000);
    expect(end.state.atMs).toBeCloseTo(simulation.state.elapsed * 1_000, 6);
  });

  it('makes the rider faster for the same watts, through the draft alone', () => {
    const sheltered = ride(started(), 40, 120).simulation.state.ride.distance;
    const unsheltered = ride(started(), 40, 120, { draft: false }).simulation.state.ride.distance;
    expect(sheltered).toBeGreaterThan(unsheltered + 5);
  });

  it('steps nothing for a frame with no simulation step, and refuses a count that is not one', () => {
    const session = started();
    const rider = { distanceM: 0, speedMps: 0 };
    expect(stepGroupRideSession(session, { ticks: 0, rider, riderStopped: false })).toBe(session);
    for (const ticks of [-1, 1.5, Number.NaN]) {
      expect(() => stepGroupRideSession(session, { ticks, rider, riderStopped: false })).toThrow(
        RangeError,
      );
    }
  });

  it('reads the rider at the start of each step, between the last frame and this one', () => {
    // One frame of five steps, and the same five steps a frame each, from the same places.
    const session = started();
    const whole = stepGroupRideSession(session, {
      ticks: 5,
      rider: { distanceM: 10, speedMps: 5 },
      riderStopped: false,
    });
    let split = session;
    for (let tick = 1; tick <= 5; tick += 1) {
      split = stepGroupRideSession(split, {
        ticks: 1,
        rider: { distanceM: 2 * tick, speedMps: tick },
        riderStopped: false,
      });
    }
    expect(whole.state).toStrictEqual(split.state);
    expect(whole.rider).toStrictEqual({ distanceM: 10, speedMps: 5 });
    expect(whole.state.atMs).toBeCloseTo(5 * SIMULATION_STEP_SECONDS * 1_000, 9);
  });

  it('waits for a rider who has stopped, and rides on for one who has not', () => {
    // On the wheel and riding: no wait. The same ride with the caller's word: the line holds.
    const riding = last(ride(started(), 20, 120).frames);
    const stopped = last(ride(started(), 20, 120, { stopped: (second) => second > 10 }).frames);
    expect(riding.phase).not.toBe('waiting');
    expect(stopped.phase).toBe('waiting');
    expect(stopped.log.some((entry) => entry.phase === 'waiting' && entry.at > 10)).toBe(true);
    expect(riding.log.some((entry) => entry.phase === 'waiting')).toBe(false);
  });

  it('carries the group’s speed now: the plan’s on the road, and the eased speed while the line holds', () => {
    const plan = started().road.plan;
    const riding = last(ride(started(), 20, 120).frames);
    expect(riding.groupSpeedMps).toBeCloseTo(plan.speedNowAt(0), 6);
    // A rider who stops pedalling for good: the line holds at their speed, under the plan's.
    const { frames } = ride(started(), 60, 0, { stopped: () => true });
    const held = last(frames);
    expect(held.phase).toBe('waiting');
    expect(held.groupSpeedMps).toBeLessThan(0.5);
    expect(last(held.log).groupSpeed).toBeLessThan(plan.speedNowAt(0));
  });
});

describe('where the group is drawn', () => {
  it('draws every bot through the pack layout, none on another, and never moves the rider', () => {
    const end = last(ride(started({ bots: 7 }), 30, 120).frames);
    const drawing = groupRideDrawing(end, 123.4, 0.02);
    expect(drawing.riderDistance).toBe(123.4);
    expect(drawing.steeredLateral).toBe(0);
    expect(drawing.steeringSpeed).toBe(0);
    expect(drawing.riderHit).toBeUndefined();
    expect(drawing.raceBots).toHaveLength(7);
    for (const bot of drawing.raceBots) {
      expect(bot.laidOut).toBe(true);
      expect(Number.isFinite(bot.distanceMetres)).toBe(true);
      expect(bot.distanceMetres).toBeGreaterThanOrEqual(0);
      // In the line's lane or beside it in its row: the layout's, three abreast at most.
      expect(Math.abs(bot.lateralMetres)).toBeLessThan(2 * PACK_ABREAST_METRES);
    }
    // No bicycle is drawn inside another: a row apart along the road, or abreast in one.
    drawing.raceBots.forEach((bot, index) => {
      for (const other of drawing.raceBots.slice(index + 1)) {
        const along = Math.abs(bot.distanceMetres - other.distanceMetres);
        const across = Math.abs(bot.lateralMetres - other.lateralMetres);
        expect(along > BIKE_LENGTH_METRES / 2 || across > PACK_ABREAST_METRES / 2).toBe(true);
      }
    });
    // Each bot keeps one body for the ride, from the line's seed and its place as set up.
    expect(drawing.raceBots.map((bot) => bot.body)).toStrictEqual(
      end.botIds.map((_, index) => seededRiderBody(end.seed, index)),
    );
  });

  it('draws a bot back along its own speed for a frame behind the newest step', () => {
    const end = last(ride(started(), 20, 120).frames);
    const now = groupRideDrawing(end, 0, 0).raceBots;
    const behind = groupRideDrawing(end, 0, SIMULATION_STEP_SECONDS).raceBots;
    behind.forEach((bot, index) => {
      expect(bot.distanceMetres).toBeLessThan(now[index]?.distanceMetres ?? 0);
    });
  });

  it('never draws a bot behind the start of the route', () => {
    // On the start line at speed: a second back along that speed is behind the start.
    const session = startGroupRideSession({
      choice: { targetSpeed: THIRTY, bots: 5 },
      profile: FLAT,
      riderDistance: 0,
      riderSpeed: 10,
      seed: 7,
    });
    if (session === undefined) throw new Error('the group did not start');
    const drawn = groupRideDrawing(session, 0, 1).raceBots;
    expect(drawn).toHaveLength(5);
    for (const bot of drawn) expect(bot.distanceMetres).toBe(0);
  });
});

describe('what the ride keeps of its group', () => {
  it('is the seed, the average, the size, the rules’ version and the log so far', () => {
    const end = last(ride(started({ seed: 4242, bots: 4 }), 60, 120).frames);
    const fact = groupRideFact(end);
    expect(fact).toStrictEqual({
      version: GROUP_RIDE_CODE_VERSION,
      seed: 4242,
      targetSpeed: THIRTY,
      bots: 4,
      log: end.log,
    });
    // An entry for each change, in time order, in the rules' own words.
    expect(fact.log.length).toBeGreaterThan(1);
    fact.log.forEach((entry, index) => {
      expect(LINE_PHASES).toContain(entry.phase);
      expect(RIDER_ROLES).toContain(entry.role);
      expect(entry.groupSpeed).toBeGreaterThanOrEqual(0);
      const before = fact.log[index - 1];
      if (before !== undefined) {
        expect(entry.at).toBeGreaterThanOrEqual(before.at);
        expect(`${entry.phase} ${entry.role}`).not.toBe(`${before.phase} ${before.role}`);
      }
    });
    expect(fact.log.some((entry) => entry.phase === 'steady')).toBe(true);
  });

  it('stops at the most the log holds, and says a change was left out', () => {
    const session = started();
    const full: GroupRideSession = {
      ...session,
      log: Array.from({ length: GROUP_RIDE_LOG_MOST }, () => session.log[0]!),
    };
    const end = last(ride(full, 30, 120).frames);
    expect(end.log).toHaveLength(GROUP_RIDE_LOG_MOST);
    expect(end.logCut).toBe(true);
    expect(groupRideFact(end).logCut).toBe(true);
    expect(groupRideFact(session)).not.toHaveProperty('logCut');
  });
});
