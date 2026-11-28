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
  BOT_TACTIC_WHEEL_GAP_METRES,
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
import { LANE_OFFSETS_METRES } from '../lanes';
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
  pressGroupPullOff,
  setGroupSitIn,
  startGroupRideSession,
  stepGroupRideSession,
  type GroupRideSession,
} from './ride-group';
import { GROUP_RIDE_PULL_OFF_SIDE } from './rider-input';

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

/**
 * A scripted rider who holds the wheel (#3307): placed, frame by frame, a
 * wheel gap behind the member ahead of them in the line at that member's
 * speed; on the front, at the group's speed now, so they never fade; aside,
 * eased until they are behind the last wheel, then on it. `each` is the
 * rider's hands: it is handed the session before every frame and returns it,
 * pressed or not.
 */
function hold(
  from: GroupRideSession,
  seconds: number,
  each: (session: GroupRideSession, atMs: number) => GroupRideSession = (session) => session,
): GroupRideSession[] {
  const frames: GroupRideSession[] = [];
  const dt = FRAME_MS / 1_000;
  let session = from;
  let rider = from.rider;
  for (let at = FRAME_MS; at <= seconds * 1_000; at += FRAME_MS) {
    session = each(session, at - FRAME_MS);
    const { order } = session.state.rotation;
    const seat = order.indexOf(GROUP_RIDE_RIDER_ID);
    const wheelId = seat === 0 ? undefined : seat > 0 ? order[seat - 1] : order[order.length - 1];
    const wheel = wheelId === undefined ? undefined : session.state.bots[wheelId];
    let speedMps: number;
    if (wheel === undefined) {
      speedMps = session.groupSpeedMps;
    } else {
      const behind = wheel.distanceM - BOT_TACTIC_WHEEL_GAP_METRES - rider.distanceM;
      speedMps = Math.max(0, wheel.speedMps + Math.max(-1.5, Math.min(1.5, behind)));
    }
    rider = { distanceM: rider.distanceM + speedMps * dt, speedMps };
    session = stepGroupRideSession(session, {
      ticks: Math.round(dt / SIMULATION_STEP_SECONDS),
      rider,
      riderStopped: false,
    });
    frames.push(session);
  }
  return frames;
}

/** The first frame at which the rider is on the front of a steady line, or a failure. */
function toTheFront(from: GroupRideSession, most = 400): GroupRideSession {
  const front = hold(from, most).find(
    (frame) => frame.role === 'on-front' && frame.phase === 'steady',
  );
  if (front === undefined) throw new Error('the rider never reached the front');
  return front;
}

/** Each pull's puller, in order, over `frames`. */
function pullers(frames: readonly GroupRideSession[]): string[] {
  const by: string[] = [];
  for (const frame of frames) {
    const puller = frame.state.rotation.pull?.by;
    if (puller !== undefined && puller !== last(by)) by.push(puller);
  }
  return by;
}

describe('the pull-off press — #3307, ADR 0101 D-3.7', () => {
  it('on the front, ends the pull in the next decision window: the line is changing and the rider drifts back', () => {
    const front = toTheFront(started({ bots: 3 }));
    // Left alone, a rider who holds the group's speed is still on the front three seconds on.
    const unpressed = hold(front, 3);
    expect(unpressed.every((frame) => frame.role === 'on-front' && frame.phase === 'steady')).toBe(
      true,
    );
    const pressed = pressGroupPullOff(front);
    expect(pressed.pullOffPressed).toBe(true);
    // One decision window is a second: by then the rotation has had the press.
    const after = hold(pressed, 1.25);
    expect(last(after).phase).toBe('changing');
    expect(last(after).role).toBe('drifting-back');
    expect(last(after).state.rotation.aside).toBe(GROUP_RIDE_RIDER_ID);
    expect(last(after).state.rotation.order).toStrictEqual(front.state.rotation.order.slice(1));
    // The press was handed on once: the next step carries none.
    expect(after[0]?.pullOffPressed).toBe(false);
    // What the ride keeps says so too.
    expect(last(groupRideFact(last(after)).log)).toMatchObject({
      phase: 'changing',
      role: 'drifting-back',
    });
  });

  it('moves the rider’s drawn lane one lane to the pull-off side, and back to the line’s once they are off it', () => {
    expect(GROUP_RIDE_PULL_OFF_SIDE).toBe('lane-left');
    const front = toTheFront(started({ bots: 3 }));
    expect(groupRideDrawing(front, 0, 0).steeredLateral).toBe(0);
    const frames = hold(pressGroupPullOff(front), 60);
    // Half a second on, the move of 0.4 s is done: the left-hand lane.
    const aside = groupRideDrawing(frames[1] as GroupRideSession, 0, 0);
    expect(aside.steeredLateral).toBe(LANE_OFFSETS_METRES[0]);
    expect(aside.steeringSpeed).toBe(0);
    // Mid-move on the first frame, heading left.
    const moving = stepGroupRideSession(pressGroupPullOff(front), {
      ticks: 2,
      rider: front.rider,
      riderStopped: false,
    });
    expect(groupRideDrawing(moving, 0, 0).steeredLateral).toBeLessThan(0);
    expect(groupRideDrawing(moving, 0, 0).steeredLateral).toBeGreaterThan(
      LANE_OFFSETS_METRES[0] as number,
    );
    expect(groupRideDrawing(moving, 0, 0).steeringSpeed).toBeLessThan(0);
    // Aside for as long as they drift back, and in the line's lane again once back on a wheel.
    for (const frame of frames.slice(2)) {
      if (frame.role === 'drifting-back') {
        expect(frame.steer.offset).toBe(LANE_OFFSETS_METRES[0]);
      }
    }
    const back = frames.findIndex((frame) => frame.role === 'last-wheel');
    expect(back).toBeGreaterThan(0);
    expect(groupRideDrawing(frames[back + 4] as GroupRideSession, 0, 0).steeredLateral).toBe(0);
    // The simulation's rider was never handed any of it: the bots alone are laid out.
    expect(groupRideDrawing(last(frames), 123.4, 0).riderDistance).toBe(123.4);
  });

  it('outside on-front, starts no rotation, changes no order and moves nothing', () => {
    const roles = new Set<string>();
    const pressedRide = hold(started({ bots: 3 }), 100, (session) => {
      if (session.role === 'on-front') return session;
      roles.add(session.role);
      // The very same session: no press is held, and the drawn lane stays.
      expect(pressGroupPullOff(session)).toBe(session);
      return pressGroupPullOff(session);
    });
    const plain = hold(started({ bots: 3 }), 100);
    // Pressed on every frame in every other role, the ride is the unpressed ride.
    expect(roles.size).toBeGreaterThan(2);
    expect(roles.has('second-wheel')).toBe(true);
    expect(last(pressedRide).log).toStrictEqual(last(plain).log);
    expect(last(pressedRide).state.rotation.order).toStrictEqual(last(plain).state.rotation.order);
    expect(pressedRide.every((frame) => frame.steer.offset === 0)).toBe(true);
  });

  it('pressed 20 times in a second, is one pull-off and not a queue', () => {
    const front = toTheFront(started({ bots: 3 }));
    const once = hold(front, 200, (session, atMs) =>
      atMs === 0 ? pressGroupPullOff(session) : session,
    );
    // Five presses before each of four frames: twenty in the first second.
    let presses = 0;
    const mashed = hold(front, 200, (session, atMs) => {
      if (atMs >= 1_000) return session;
      let next = session;
      for (let press = 0; press < 5; press += 1) {
        next = pressGroupPullOff(next);
        presses += 1;
      }
      return next;
    });
    expect(presses).toBe(20);
    // The whole ride after, the rider's next pull included, is the one press's ride.
    expect(last(mashed).log).toStrictEqual(last(once).log);
    const turns = last(once).log.filter((entry) => entry.role === 'on-front');
    expect(turns.length).toBeGreaterThan(0);
    // And that next pull was not cut short by a press left over: it ran its target length.
    const again = once.findIndex(
      (frame, index) => index > 8 && frame.role === 'on-front' && frame.phase === 'steady',
    );
    expect(again).toBeGreaterThan(0);
    expect(once[again + 12]?.role).toBe('on-front');
    expect(mashed[again + 12]?.role).toBe('on-front');
  });
});

describe('what the ride keeps of the rider’s presses — #3307', () => {
  it('keeps a press taken on the front once however often it is pressed, and none made off it', () => {
    const from = started({ bots: 3 });
    // Nothing pressed: the fact has no such field, as a ride before #3307 had none.
    expect('presses' in groupRideFact(last(hold(from, 5)))).toBe(false);
    expect('presses' in groupRideFact(pressGroupPullOff(from))).toBe(false);

    const front = toTheFront(from);
    let pressed = front;
    for (let press = 0; press < 20; press += 1) pressed = pressGroupPullOff(pressed);
    const at = front.state.atMs / 1_000;
    expect(at).toBeGreaterThan(0);
    expect(groupRideFact(pressed).presses).toStrictEqual([{ at, press: 'pull-off' }]);
    // It rides on with the ride, beside the log.
    const after = last(hold(pressed, 5));
    expect(groupRideFact(after).presses).toStrictEqual([{ at, press: 'pull-off' }]);
    expect(groupRideFact(after).version).toBe(2);
  });

  it('keeps each sit-in choice with its ride time, in order, and no choice that changed nothing', () => {
    const from = started({ bots: 3 });
    const sat = setGroupSitIn(setGroupSitIn(from, false), true);
    const later = last(hold(setGroupSitIn(sat, true), 12));
    const out = setGroupSitIn(later, false);
    expect(groupRideFact(out).presses).toStrictEqual([
      { at: 0, press: 'sit-in' },
      { at: 12, press: 'sit-out' },
    ]);
  });

  it('stops at the most it holds, and says a press was left out', () => {
    let session = started({ bots: 3 });
    for (let choice = 0; choice < GROUP_RIDE_LOG_MOST; choice += 1) {
      session = setGroupSitIn(session, choice % 2 === 0);
    }
    expect(groupRideFact(session).presses).toHaveLength(GROUP_RIDE_LOG_MOST);
    expect(groupRideFact(session).logCut).toBeUndefined();
    session = setGroupSitIn(session, !session.sittingIn);
    expect(groupRideFact(session).presses).toHaveLength(GROUP_RIDE_LOG_MOST);
    expect(groupRideFact(session).logCut).toBe(true);
  });
});

describe('the sit-in choice — #3307, ADR 0101 D-3.7', () => {
  it('never gives a rider who sits in the front through three rotations, and gives it back at the next turn once off', () => {
    const from = started({ bots: 3 });
    // The same line without the choice: the rider is on the front inside the first rotation.
    const taking = hold(from, 200);
    expect(taking.some((frame) => frame.role === 'on-front')).toBe(true);

    const sitting = setGroupSitIn(from, true);
    expect(setGroupSitIn(sitting, true)).toBe(sitting);
    const sat = hold(sitting, 420);
    // Three rotations of the three bots: nine pulls, and the rider on the front in none.
    const pulls = pullers(sat);
    expect(pulls.length).toBeGreaterThanOrEqual(9);
    expect(pulls).not.toContain(GROUP_RIDE_RIDER_ID);
    expect(sat.some((frame) => frame.role === 'on-front')).toBe(false);
    expect(sat.some((frame) => frame.role === 'sitting-in')).toBe(true);
    for (const id of from.botIds) {
      expect(pulls.filter((by) => by === id).length).toBeGreaterThanOrEqual(3);
    }

    // Off again: the rider is back in the order and takes the front within one rotation.
    const off = setGroupSitIn(last(sat), false);
    expect(off.state.rotation.order).toContain(GROUP_RIDE_RIDER_ID);
    const back = hold(off, 200);
    const turn = back.findIndex((frame) => frame.role === 'on-front');
    expect(turn).toBeGreaterThanOrEqual(0);
    expect(pullers(back.slice(0, turn + 1)).length).toBeLessThanOrEqual(from.botIds.length + 1);
  });
});
