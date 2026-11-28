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
import { LANE_OFFSETS_METRES } from '../lanes';
import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES } from '../lap-race/pack-layout';
import { rideConditionsFor } from '../rider';
import { seededRiderBody } from '../rider-body';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import { GameSimulation, SIMULATION_STEP_SECONDS } from '../simulation';

import { groupRidePlan } from './choice';
import {
  GROUP_BOT_CP_WATTS,
  GROUP_BOT_STRENGTH_SPREAD,
  GROUP_PULL_OFF_LANE,
  GROUP_RIDE_RIDER_ID,
  groupLine,
  groupRideDrawing,
  groupRideFact,
  groupRideFinished,
  groupRideTimed,
  groupRideStrip,
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
    // A rider on one power rides through the line and back (#3303's finding),
    // which the single file must draw without one bicycle inside another.
    const { frames } = ride(started({ bots: 7 }), 120, 120);
    for (const frame of frames) {
      const drawing = groupRideDrawing(frame, frame.rider.distanceM, 0);
      expect(drawing.riderDistance).toBe(frame.rider.distanceM);
      expect(drawing.riderHit).toBeUndefined();
      expect(drawing.raceBots).toHaveLength(7);
      const drawn = [
        { along: drawing.riderDistance, across: drawing.steeredLateral },
        ...drawing.raceBots.map((bot) => {
          expect(bot.laidOut).toBe(true);
          expect(bot.distanceMetres).toBeGreaterThanOrEqual(0);
          // In the line's lane, a place beside it, or the pull-off lane: never further out.
          expect(Math.abs(bot.lateralMetres)).toBeLessThanOrEqual(
            Math.abs(LANE_OFFSETS_METRES[GROUP_PULL_OFF_LANE] as number) + 1e-9,
          );
          return { along: bot.distanceMetres, across: bot.lateralMetres };
        }),
      ];
      // No bicycle is drawn inside another: a bike length along the road, or a place across.
      drawn.forEach((one, index) => {
        for (const other of drawn.slice(index + 1)) {
          const along = Math.abs(one.along - other.along);
          const across = Math.abs(one.across - other.across);
          expect(along >= BIKE_LENGTH_METRES - 1e-6 || across >= PACK_ABREAST_METRES - 1e-6).toBe(
            true,
          );
        }
      });
    }
    // Each bot keeps one body for the ride, from the line's seed and its place as set up.
    const end = last(frames);
    expect(groupRideDrawing(end, 0, 0).raceBots.map((bot) => bot.body)).toStrictEqual(
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
    // On the start line at speed: two seconds back along that speed is behind the start.
    const session = startGroupRideSession({
      choice: { targetSpeed: THIRTY, bots: 5 },
      profile: FLAT,
      riderDistance: 0,
      riderSpeed: 10,
      seed: 7,
    });
    if (session === undefined) throw new Error('the group did not start');
    // In single file the front bot stands 12 m up the road, so two seconds back.
    const drawn = groupRideDrawing(session, 0, 2).raceBots;
    expect(drawn).toHaveLength(5);
    for (const bot of drawn) expect(bot.distanceMetres).toBe(0);
  });
});

describe('what the ride keeps of its group', () => {
  it('is the seed, the average, the size, the rules’ version and the log so far', () => {
    const ridden = last(ride(started({ seed: 4242, bots: 4 }), 60, 120).frames);
    // A recording begun at the press, read as the group's own clock reads.
    const end = groupRideTimed(ridden, ridden.state.atMs / 1_000);
    const fact = groupRideFact(end);
    if (fact === undefined) throw new Error('a timed group ride keeps a fact');
    expect(fact).toStrictEqual({
      version: GROUP_RIDE_CODE_VERSION,
      seed: 4242,
      startedAt: 0,
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
    expect(groupRideFact(groupRideTimed(end, 30))?.logCut).toBe(true);
    expect(groupRideFact(groupRideTimed(session, 0))).not.toHaveProperty('logCut');
  });
});

describe('where the group began on the recording — the review of PR #3364', () => {
  it('keeps nothing until a recording is read: there is nothing to keep it with', () => {
    const end = last(ride(started(), 10, 120).frames);
    expect(end.startedAt).toBeUndefined();
    expect(groupRideFact(end)).toBeUndefined();
    expect(groupRideTimed(end, undefined)).toBe(end);
  });

  it('is the recording’s seconds when the group’s clock read nought, fixed once read', () => {
    // A recording begun 25 s after the press: 25 s less on its clock than on the group's.
    const end = last(ride(started(), 30, 120).frames);
    expect(end.state.atMs).toBeGreaterThan(25_000);
    const timed = groupRideTimed(end, end.state.atMs / 1_000 - 25);
    expect(timed.startedAt).toBeCloseTo(-25, 9);
    expect(groupRideFact(timed)?.startedAt).toBeCloseTo(-25, 9);
    // Read again later, on a recording clock that ran on: never moved.
    const later = groupRideTimed(last(ride(timed, 10, 120).frames), 99);
    expect(later.startedAt).toBe(timed.startedAt);
  });
});

describe('the group ride ends at the finish — the review of PR #3364', () => {
  it('on a route with a finish, once the rider reaches it, and not before', () => {
    const short = northRoute(300, () => 0);
    const { frames } = ride(started({ profile: short }), 60, 250);
    const ends = frames.findIndex(groupRideFinished);
    expect(ends).toBeGreaterThan(0);
    expect(frames[ends]?.rider.distanceM).toBeGreaterThanOrEqual(short.totalDistance);
    expect(frames[ends - 1]?.rider.distanceM).toBeLessThan(short.totalDistance);
  });

  it('never on a loop, which has no finish', () => {
    const loop = circuitRoute(40, () => 0);
    const session = started({ profile: loop });
    const past: GroupRideSession = {
      ...session,
      rider: { distanceM: 3 * loop.totalDistance, speedMps: 8 },
    };
    expect(groupRideFinished(past)).toBe(false);
  });
});

describe("the rider's cue and the role strip — #3305", () => {
  /** What one frame of a held-wheel ride left: the session and the strip the HUD reads. */
  interface Held {
    readonly session: GroupRideSession;
    readonly strip: ReturnType<typeof groupRideStrip>;
  }

  /**
   * A rider who holds their place exactly, put where a clean rider would be
   * frame by frame (the rider is read and never written, so a test may place
   * them): on the wheel ahead while in the line; at the group's speed on the
   * front, then under it once *Pull off now* has been shown, so the line
   * comes round; easing while drifting back; and on the last wheel after.
   */
  function holdTheWheel(seconds: number, power: number | null): readonly Held[] {
    let session = started({ bots: 3 });
    const gap =
      (session.state.bots[last(session.botIds)]?.distanceM ?? 0) - session.rider.distanceM;
    const held: Held[] = [];
    const frame = FRAME_MS / 1_000;
    for (let at = FRAME_MS; at <= seconds * 1_000; at += FRAME_MS) {
      const { order } = session.state.rotation;
      const seat = order.indexOf(GROUP_RIDE_RIDER_ID);
      const wheel = seat > 0 ? order[seat - 1] : seat < 0 ? last(order) : undefined;
      const ahead = wheel === undefined ? undefined : session.state.bots[wheel];
      let rider = session.rider;
      if (seat === 0) {
        const asked = session.cue?.kind === 'pull-off' || session.cue?.kind === 'ease';
        const speedMps = asked ? Math.max(0, session.groupSpeedMps - 1) : session.groupSpeedMps;
        rider = { distanceM: rider.distanceM + speedMps * frame, speedMps };
      } else if (seat < 0 && session.role === 'drifting-back') {
        const speedMps = 0.85 * session.groupSpeedMps;
        rider = { distanceM: rider.distanceM + speedMps * frame, speedMps };
      } else if (ahead !== undefined) {
        // Where the wheel will be when the frame ends, less the gap held.
        rider = {
          distanceM: ahead.distanceM + ahead.speedMps * frame - gap,
          speedMps: ahead.speedMps,
        };
      }
      session = stepGroupRideSession(session, {
        ticks: Math.round(frame / SIMULATION_STEP_SECONDS),
        rider,
        riderStopped: false,
        powerWatts: power,
        thresholdWatts: null,
      });
      held.push({ session, strip: groupRideStrip(session, power !== null) });
    }
    return held;
  }

  /** The frames a new cue was selected in: a selection is an object of its own. */
  function newCues(held: readonly Held[]): readonly Held[] {
    return held.filter(
      ({ session }, index) =>
        session.cue !== undefined && session.cue !== held[index - 1]?.session.cue,
    );
  }

  /** Each cue the ride selected, once, in order. */
  function cuesOf(held: readonly Held[]): string[] {
    return newCues(held).map(({ session }) => session.cue?.kind ?? '');
  }

  const TURN = ['next-up', 'your-pull', 'pull-off', 'ease', 'last-wheel', 'back-in-line'];

  it('selects each event of the rider’s turn once, in order, turn after turn, on the group’s own clock', () => {
    const held = holdTheWheel(400, 180);
    const kinds = cuesOf(held);
    // Three turns in 400 s behind three bots: no correction for a rider who holds the wheel.
    expect(kinds.slice(0, 18)).toStrictEqual([...TURN, ...TURN, ...TURN]);
    // Each is kept with the instant it was selected at.
    const firsts = newCues(held);
    expect(firsts).toHaveLength(kinds.length);
    for (const { session } of firsts) {
      const at = session.cue?.atSeconds ?? Number.NaN;
      expect(at).toBeLessThanOrEqual(session.state.atMs / 1_000);
      expect(at).toBeGreaterThan(session.state.atMs / 1_000 - FRAME_MS / 1_000 - 1e-9);
    }
    // *Your pull* is selected as the rider's role becomes on-front, and not before.
    const pull = firsts.find(({ session }) => session.cue?.kind === 'your-pull');
    expect(pull?.session.role).toBe('on-front');
  });

  it('selects nothing with no power reading, and for a power that is no reading', () => {
    for (const power of [null, Number.NaN, -5]) {
      const held = holdTheWheel(200, power);
      expect(cuesOf(held)).toStrictEqual([]);
      expect(last(held).session.cue).toBeUndefined();
      // The line rode its rotation all the same: the rider was on the front.
      expect(held.some(({ session }) => session.role === 'on-front')).toBe(true);
    }
    expect(last(holdTheWheel(5, null)).strip.live).toBe(false);
  });

  it('the strip counts the pull down only while the rider is on the front, from its length to nothing', () => {
    const held = holdTheWheel(140, 180);
    const front = held.filter(({ session }) => session.role === 'on-front');
    const rest = held.filter(({ session }) => session.role !== 'on-front');
    expect(front.length).toBeGreaterThan(100);
    expect(rest.length).toBeGreaterThan(100);
    expect(rest.every(({ strip }) => strip.pullLeftSeconds === undefined)).toBe(true);
    const left = front.map(({ strip }) => strip.pullLeftSeconds as number);
    expect(left.every((seconds) => Number.isInteger(seconds) && seconds >= 0)).toBe(true);
    expect(left[0]).toBe(30);
    expect(last(left)).toBe(0);
    expect(
      left.every((seconds, index) => index === 0 || seconds <= (left[index - 1] as number)),
    ).toBe(true);
    // On the front there is no wheel ahead, and the place is the first of four.
    expect(front.every(({ strip }) => strip.gapMetres === undefined && strip.place === 1)).toBe(
      true,
    );
  });

  it('the strip reads the place in the line, the gap to the wheel ahead and both speeds', () => {
    const held = holdTheWheel(140, 180);
    const first = held[0] as Held;
    // At the press: last of four, a wheel gap behind the last bot.
    expect(first.strip.place).toBe(4);
    expect(first.strip.of).toBe(4);
    expect(first.strip.live).toBe(true);
    expect(first.strip.targetSpeed).toBe(THIRTY);
    for (const { session, strip } of held) {
      const { order } = session.state.rotation;
      const seat = order.indexOf(GROUP_RIDE_RIDER_ID);
      expect(strip.groupSpeed).toBe(session.groupSpeedMps);
      if (seat > 0) {
        expect(strip.place).toBe(seat + 1);
        const wheel = session.state.bots[order[seat - 1] as string]?.distanceM ?? Number.NaN;
        expect(strip.gapMetres).toBeCloseTo(wheel - session.rider.distanceM, 9);
        expect(strip.gapMetres).toBeGreaterThan(0);
      }
      // Aside, drifting back or latching on: bound for the back, and the last wheel is theirs.
      if (seat < 0) expect(strip.place).toBe(4);
    }
    // The rider moved up the line as the bots took their turns.
    expect(new Set(held.map(({ strip }) => strip.place))).toStrictEqual(new Set([4, 3, 2, 1]));
    // Level with the wheel ahead or past it, there is no gap to close.
    const session = first.session;
    const wheelAt = session.state.bots[last(session.botIds)]?.distanceM ?? Number.NaN;
    for (const past of [0, 1.5]) {
      const overlapped = { ...session, rider: { ...session.rider, distanceM: wheelAt + past } };
      expect(groupRideStrip(overlapped, true).gapMetres).toBeUndefined();
    }
  });
});
