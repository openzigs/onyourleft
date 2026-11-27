// SPDX-License-Identifier: Apache-2.0

/**
 * #3300: the AI group ride stepped through the one physics. Whole scripted
 * rides (`group-ride-testing.ts`) through `@onyourleft/domain`
 * §`stepGroupRide` on {@link groupRidePhysics}: the real draft model, the
 * real `advance`. Each `describe` names the criterion of the issue it holds.
 *
 * Every gap is read off the odometers the tick's own draft call read. No case
 * sets its own timeout (#1688): the hilly ride is ridden once and shared.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  BOT_MASS_KILOGRAMS,
  BOT_TACTIC_WHEEL_FURTHEST_METRES,
  BOT_TACTIC_WHEEL_NEAREST_METRES,
  gradeAt,
  metres,
  metresPerSecond,
  startGroupRide,
  stepGroupRide,
  type MemberView,
} from '@onyourleft/domain';
import { courseOf, FLAT_COURSE, HILLY_COURSE } from '@onyourleft/domain/group-ride-testing';

import { fieldDraftFactors, leadFactor, LEVEL_METRES } from './draft';
import { groupRidePhysics } from './group-ride';
import groupRideSource from './group-ride.ts?raw';
import {
  bot,
  gapAhead,
  planFor,
  rideGroup,
  RIDER,
  RIDER_MASS_KILOGRAMS,
  SIX,
  TICK_SECONDS,
  windowsOf,
  YOU,
  type Frame,
  type GroupRide,
} from './group-ride-testing';
import { advance, type RideState } from './simulate';

vi.mock('./simulate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulate')>();
  return { ...actual, advance: vi.fn(actual.advance) };
});

// Counted, so a test can hold the line's draft to one call a tick.
vi.mock('./draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./draft')>();
  return { ...actual, fieldDraftFactors: vi.fn(actual.fieldDraftFactors) };
});

const FLAT = courseOf(FLAT_COURSE);
const HILLY = courseOf(HILLY_COURSE);
const TARGET_KMH = 30;
const KMH = 1 / 3.6;

/** #3298's hilly fixture, start to finish, with a rider who holds the wheel: ridden once. */
let hillyRide: GroupRide | undefined;
function hilly(): GroupRide {
  hillyRide ??= rideGroup({ course: HILLY, targetKmh: TARGET_KMH });
  return hillyRide;
}

const inBand = (gap: number): boolean =>
  gap >= BOT_TACTIC_WHEEL_NEAREST_METRES && gap <= BOT_TACTIC_WHEEL_FURTHEST_METRES;

/** Where the front of the line is in `frame`, metres. */
const frontM = (frame: Frame): number =>
  (frame.at[frame.order[0] as string] as MemberView).distanceM;

/** The frames in which a pull change started. */
function changeStarts(frames: readonly Frame[]): readonly Frame[] {
  return frames.filter(
    (frame, index) => frame.phase === 'changing' && frames[index - 1]?.phase === 'steady',
  );
}

describe('the line stays together over the hilly fixture (criterion 1)', () => {
  it('keeps every following bot inside the wheel band for at least 95 % of steady windows', () => {
    const steady = windowsOf(hilly().frames).filter((frame) => frame.phase === 'steady');
    expect(steady.length).toBeGreaterThan(600);
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      const following = steady.filter((frame) => frame.order.indexOf(id) > 0);
      expect(following.length).toBeGreaterThan(300);
      const held = following.filter((frame) => inBand(gapAhead(frame, id) as number));
      expect(held.length / following.length).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('never has two members of the line level with one another', () => {
    let nearest = Infinity;
    for (const frame of hilly().frames) {
      const along = frame.order.map((id) => (frame.at[id] as MemberView).distanceM);
      along.forEach((here, seat) => {
        for (const other of along.slice(seat + 1)) {
          nearest = Math.min(nearest, Math.abs(here - other));
        }
      });
    }
    expect(nearest).toBeGreaterThanOrEqual(LEVEL_METRES);
  });

  it('keeps every bot on its wheel over the crest, where the wheel ahead speeds up at a steady power', () => {
    // The climb ends at 4 500 m. A bot that fed forward its wheel's speed
    // alone would be left there: the wheel is accelerating.
    const crest = hilly().frames.filter((frame) => frontM(frame) > 4_450 && frontM(frame) < 5_000);
    expect(crest.length).toBeGreaterThan(100);
    const behindTheRider = crest.filter((frame) => {
      const seat = frame.order.indexOf(YOU);
      return seat >= 0 && seat < frame.order.length - 1;
    });
    expect(behindTheRider.length).toBeGreaterThan(100);
    for (const frame of crest) {
      for (const id of frame.order.slice(1)) {
        if (id === YOU) continue;
        expect(gapAhead(frame, id)).toBeLessThanOrEqual(BOT_TACTIC_WHEEL_FURTHEST_METRES);
      }
    }
  });

  it('has its sheltered bots sit up down the descent, where a bot cannot brake', () => {
    // 1.5 km at −8 % from 5 500 m: a sheltered bot that coasts is faster than the front that pedals.
    const descent = hilly().frames.filter(
      (frame) => frontM(frame) > 5_700 && frontM(frame) < 6_900,
    );
    const satUp = descent.flatMap((frame) =>
      frame.order.slice(1).filter((id) => {
        const rode = frame.rode[id];
        return (
          rode !== undefined && rode.powerWatts === 0 && rode.dragFactor > (frame.draft[id] ?? 1)
        );
      }),
    );
    expect(satUp.length).toBeGreaterThan(100);
    for (const frame of descent) {
      for (const [id, rode] of Object.entries(frame.rode)) {
        // Less shelter than the model offers, never more, and never past the open air.
        expect(rode.dragFactor).toBeGreaterThanOrEqual(frame.draft[id] as number);
        expect(rode.dragFactor).toBeLessThanOrEqual(1);
      }
    }
  });

  it('starts no pull change from 300 m before the climb until it is nearly over', () => {
    const starts = changeStarts(windowsOf(hilly().frames)).map(frontM);
    // The climb is 3 000 to 4 500 m; a climb's last 200 m is no longer one ahead (`courseHillsAhead`).
    expect(starts.filter((at) => at >= 2_700 && at < 4_290)).toEqual([]);
    expect(starts.filter((at) => at < 2_700).length).toBeGreaterThan(5);
  });
});

describe("the bot behind the rider follows the rider's wheel (criterion 2)", () => {
  const ride = rideGroup({
    course: FLAT,
    targetKmh: TARGET_KMH,
    seconds: 40,
    rider: { slow: { fromSeconds: 5, toSeconds: 25, kmh: 2 } },
  });
  const during = ride.frames.filter((frame) => frame.atMs >= 5_000);

  it('is behind a rider who really slowed by 2 km/h for 20 s and lost the wheel ahead', () => {
    const before = (ride.frames[19] as Frame).at[YOU] as MemberView;
    const slowed = ride.frames.filter((frame) => frame.atMs >= 10_000 && frame.atMs < 25_000);
    for (const frame of slowed) {
      expect((frame.at[YOU] as MemberView).speedMps).toBeLessThan(before.speedMps - 1.9 * KMH);
    }
    expect(gapAhead(ride.frames[100] as Frame, YOU)).toBeGreaterThan(10);
  });

  it("keeps b3's gap to the rider inside the band, and b3 never passes", () => {
    expect((ride.frames[0] as Frame).order).toEqual(['b1', 'b2', YOU, 'b3', 'b4', 'b5']);
    for (const frame of during) {
      const gap = (frame.at[YOU] as MemberView).distanceM - (frame.at.b3 as MemberView).distanceM;
      expect(gap).toBeGreaterThanOrEqual(BOT_TACTIC_WHEEL_NEAREST_METRES);
      expect(gap).toBeLessThanOrEqual(BOT_TACTIC_WHEEL_FURTHEST_METRES);
    }
  });
});

describe('every rider drafts by the one model, from one call (criterion 3)', () => {
  const ride = rideGroup({ course: FLAT, targetKmh: TARGET_KMH, seconds: 20 });
  const frame = ride.frames[60] as Frame;
  const ids = SIX.map((member) => member.id);

  it("hands back draft.ts's own factors for the odometers as the tick began", () => {
    const expected = fieldDraftFactors(ids.map((id) => (frame.at[id] as MemberView).distanceM));
    expect(ids.map((id) => frame.draft[id])).toEqual(expected);
  });

  it('shelters every following bot and gives the front the leading-rider factor', () => {
    expect(frame.order).toEqual(ids);
    expect(frame.draft.b1).toBe(leadFactor(gapAhead(frame, 'b2') as number));
    for (const id of ['b2', 'b3', 'b4', 'b5']) expect(frame.draft[id]).toBeLessThan(1);
    expect(frame.draft[YOU]).toBeLessThan(1);
  });

  it('rides each bot at its factor: a sheltered bot holds the line on far less than the front', () => {
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      expect(frame.rode[id]?.dragFactor).toBe(frame.draft[id]);
    }
    const front = frame.rode.b1?.powerWatts as number;
    for (const id of ['b2', 'b3', 'b4', 'b5']) {
      expect(frame.rode[id]?.powerWatts).toBeLessThan(0.8 * front);
      expect(frame.rode[id]?.speedMps).toBeCloseTo(frame.rode.b1?.speedMps as number, 1);
    }
  });

  it('makes one draft call a tick, over every member, the rider included', () => {
    const plan = planFor(FLAT, TARGET_KMH);
    const rider: MemberView = { distanceM: 0, speedMps: 8 };
    const state = startGroupRide({ line: SIX, seed: 1, atMs: 0, rider });
    vi.mocked(fieldDraftFactors).mockClear();
    stepGroupRide(
      state,
      { elapsedSeconds: TICK_SECONDS, rider },
      { course: FLAT, plan, physics: groupRidePhysics() },
    );
    expect(vi.mocked(fieldDraftFactors)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fieldDraftFactors).mock.calls[0]?.[0]).toHaveLength(SIX.length);
  });
});

describe("the rider's physics is never tethered (criterion 4)", () => {
  const WATTS = 180;
  const speeds = [26, 30, 34];
  const own = groupRidePhysics(RIDER_MASS_KILOGRAMS);

  /** The rider alone, at the draft factors a ride handed back for them and nothing else of it. */
  function alone(ride: GroupRide): readonly number[] {
    let rider = (ride.frames[0] as Frame).at[YOU] as MemberView;
    return ride.frames.map((frame) => {
      const speed = rider.speedMps;
      rider = own.advance(
        rider,
        WATTS,
        gradeAt(HILLY, rider.distanceM),
        TICK_SECONDS,
        frame.draft[YOU] as number,
      );
      return speed;
    });
  }
  const riderSpeeds = (ride: GroupRide): readonly number[] =>
    ride.frames.map((frame) => (frame.at[YOU] as MemberView).speedMps);

  it('gives a rider in the line a speed that is their own power, mass, grade and draft factor, at three group speeds', () => {
    const rides = speeds.map((targetKmh) =>
      rideGroup({ course: HILLY, targetKmh, seconds: 60, rider: { watts: WATTS } }),
    );
    for (const ride of rides) {
      expect(ride.frames.some((frame) => (frame.draft[YOU] as number) < 1)).toBe(true);
      expect(riderSpeeds(ride)).toEqual(alone(ride));
      // Nothing of the rider is kept among the bots, and nothing but their speed is remembered.
      expect(Object.keys(ride.state.bots)).not.toContain(YOU);
    }
    // The group's speed reaches them only as shelter: three groups, three draft histories.
    const drafts = rides.map((ride) => ride.frames.map((frame) => frame.draft[YOU]));
    expect(drafts[0]).not.toEqual(drafts[1]);
    expect(drafts[1]).not.toEqual(drafts[2]);
  });

  it('gives a rider beyond the draft reach the same ride whatever the group does', () => {
    const line = [bot('b1'), bot('b2'), bot('b3'), bot('b4'), bot('b5'), RIDER];
    const rides = speeds.map((targetKmh) =>
      rideGroup({
        course: HILLY,
        targetKmh,
        line,
        seconds: 60,
        rider: { watts: WATTS, start: { distanceM: -200, speedMps: 6 } },
      }),
    );
    for (const ride of rides) {
      expect(ride.frames.every((frame) => frame.draft[YOU] === 1)).toBe(true);
    }
    expect(riderSpeeds(rides[1] as GroupRide)).toEqual(riderSpeeds(rides[0] as GroupRide));
    expect(riderSpeeds(rides[2] as GroupRide)).toEqual(riderSpeeds(rides[0] as GroupRide));
    // And the three groups did ride three different rides.
    const fronts = rides.map((ride) => frontM(ride.frames[239] as Frame));
    expect(new Set(fronts).size).toBe(3);
  });
});

describe('a full rotation does not yo-yo the line (criterion 5)', () => {
  const ride = rideGroup({ course: FLAT, targetKmh: TARGET_KMH, seconds: 130 });
  const windows = windowsOf(ride.frames);
  const starts = changeStarts(windows);

  it('brings the old front rider back through changing and latching to the last wheel', () => {
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (const start of starts.slice(0, 3)) {
      const old = start.aside as string;
      const from = windows.indexOf(start);
      const after = windows.slice(from);
      const phases = after.map((frame) => frame.phase);
      const latching = phases.indexOf('latching');
      const steady = phases.indexOf('steady');
      expect(latching).toBeGreaterThan(0);
      expect(steady).toBeGreaterThan(latching);
      const back = after[steady] as Frame;
      expect(back.order[back.order.length - 1]).toBe(old);
      // It did drift back: at least 1 km/h under the line while aside.
      const drifting = after.slice(0, latching).map((frame) => frame.at[old]?.speedMps as number);
      expect(Math.min(...drifting)).toBeLessThan(start.groupSpeedMps - 1 * KMH);
    }
  });

  it("holds every member of the line within 0.5 km/h of the line's speed through each rotation", () => {
    for (const start of starts.slice(0, 3)) {
      const from = ride.frames.indexOf(start);
      const before = ride.frames[from - 1] as Frame;
      const line = (before.at[before.order[0] as string] as MemberView).speedMps;
      const steadyAgain = ride.frames.findIndex(
        (frame, index) => index > from && frame.phase === 'steady',
      );
      // From the pull-off to ten seconds after the old front is back on.
      for (const frame of ride.frames.slice(from, steadyAgain + 40)) {
        for (const id of frame.order) {
          if (id === start.aside) continue;
          const speed = (frame.at[id] as MemberView).speedMps;
          expect(Math.abs(speed - line)).toBeLessThanOrEqual(0.5 * KMH);
        }
      }
    }
  });

  it('does not let a bot new to the front chase a rider who goes off the front', () => {
    // The rider starts 3 m up the road from the front bot and rides away from it.
    const away = rideGroup({
      course: FLAT,
      targetKmh: TARGET_KMH,
      line: [bot('b1'), bot('b2'), RIDER],
      seconds: 25,
      rider: { watts: 320, start: { distanceM: 3, speedMps: TARGET_KMH * KMH } },
    });
    const last = away.frames[away.frames.length - 1] as Frame;
    expect(
      (last.at[YOU] as MemberView).distanceM - (last.at.b1 as MemberView).distanceM,
    ).toBeGreaterThan(15);
    for (const frame of away.frames) {
      expect((frame.at.b1 as MemberView).speedMps).toBeLessThanOrEqual(
        frame.groupSpeedMps + 0.5 * KMH,
      );
    }
  });
});

describe("the plan's promise survives real stepping (criterion 6)", () => {
  it('finishes the hilly fixture within 1 % of distance ÷ target', () => {
    const goal = (HILLY.totalDistance as number) / (TARGET_KMH * KMH);
    const finish = hilly().finishSeconds as number;
    expect(Math.abs(finish - goal) / goal).toBeLessThan(0.01);
  });
});

describe('deterministic for a seed (criterion 7)', () => {
  const script = { course: FLAT, targetKmh: TARGET_KMH, seconds: 150 } as const;
  const positions = (ride: GroupRide): unknown => ride.frames.map((frame) => frame.at);

  it('rides the same ride twice from one seed, to the bit', () => {
    const once = rideGroup({ ...script, seed: 11 });
    const again = rideGroup({ ...script, seed: 11 });
    expect(positions(again)).toEqual(positions(once));
    expect(again.state).toEqual(once.state);
  });

  it('rides a different rotation from another seed', () => {
    const one = changeStarts(windowsOf(rideGroup({ ...script, seed: 11 }).frames));
    const other = changeStarts(windowsOf(rideGroup({ ...script, seed: 12 }).frames));
    expect(other.map((frame) => frame.atMs)).not.toEqual(one.map((frame) => frame.atMs));
  });

  it('names no clock, no random draw and no platform API in the physics it is handed', () => {
    const code = groupRideSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const banned of [/Math\.random\b/, /\bDate\b/, /performance\./, /\bwindow\./]) {
      expect(code).not.toMatch(banned);
    }
  });
});

describe('the bots ride the one physics', () => {
  it('moves a bot by whatever advance returns, so it cannot be on separate maths', () => {
    const plan = planFor(FLAT, TARGET_KMH);
    const rider: MemberView = { distanceM: 0, speedMps: 8 };
    const state = startGroupRide({ line: [bot('b1'), RIDER], seed: 1, atMs: 0, rider });
    const sentinel: RideState = { speed: metresPerSecond(42), distance: metres(12) };
    vi.mocked(advance).mockReturnValueOnce(sentinel);
    const tick = stepGroupRide(
      state,
      { elapsedSeconds: 1, rider },
      { course: FLAT, plan, physics: groupRidePhysics() },
    );
    expect(tick.state.bots.b1?.speedMps).toBe(42);
    expect(tick.state.bots.b1?.distanceM).toBe((state.bots.b1?.distanceM as number) + 12);
  });

  it("rides a bot at the plan's 75 kg unless a mass is named", () => {
    vi.mocked(advance).mockClear();
    groupRidePhysics().advance({ distanceM: 0, speedMps: 8 }, 150, 0, 1, 1);
    groupRidePhysics(RIDER_MASS_KILOGRAMS).advance({ distanceM: 0, speedMps: 8 }, 150, 0, 1, 1);
    const masses = vi.mocked(advance).mock.calls.map((call) => call[2].totalMass);
    expect(masses).toEqual([BOT_MASS_KILOGRAMS, RIDER_MASS_KILOGRAMS]);
    expect(groupRidePhysics().massKilograms).toBe(BOT_MASS_KILOGRAMS);
  });

  it('spends a weak bot’s W′ on the front and gives it back in the line', () => {
    // 130 W of critical power: under the flat plan's power on the front, over what the line costs in shelter.
    const weak = rideGroup({
      course: FLAT,
      targetKmh: TARGET_KMH,
      line: [bot('b1', 130, 6_000), bot('b2'), bot('b3'), RIDER],
      seconds: 90,
      rider: { sittingIn: true },
    });
    const balance = (frame: Frame): number => frame.rode.b1?.energy.wbalJoules as number;
    const pulling = weak.frames[40] as Frame;
    expect(pulling.order[0]).toBe('b1');
    expect(pulling.rode.b1?.powerWatts).toBeGreaterThan(130);
    expect(balance(pulling)).toBeLessThan(5_900);
    const back = weak.frames.findIndex(
      (frame) => frame.phase === 'steady' && frame.order.indexOf('b1') > 0,
    );
    const onTheWheel = weak.frames[back] as Frame;
    const later = weak.frames[back + 80] as Frame;
    expect(later.order.indexOf('b1')).toBeGreaterThan(0);
    expect(later.rode.b1?.powerWatts).toBeLessThan(130);
    expect(balance(later)).toBeGreaterThan(balance(onTheWheel));
  });

  it('holds a pull change on a tight bend, and a rider who sits in never reaches the front', () => {
    const bend = rideGroup({ course: FLAT, targetKmh: TARGET_KMH, seconds: 80, bendRadiusM: 10 });
    expect(changeStarts(windowsOf(bend.frames))).toEqual([]);
    const sat = rideGroup({
      course: FLAT,
      targetKmh: TARGET_KMH,
      seconds: 150,
      rider: { sittingIn: true },
    });
    expect(changeStarts(windowsOf(sat.frames)).length).toBeGreaterThan(2);
    expect(sat.frames.some((frame) => frame.order[0] === YOU)).toBe(false);
    expect(sat.frames.some((frame) => frame.roles[YOU] === 'sitting-in')).toBe(true);
  });

  it('brings a rider on the front round when they press pull off, and not before', () => {
    const ride = rideGroup({
      course: FLAT,
      targetKmh: TARGET_KMH,
      line: [RIDER, bot('b1'), bot('b2')],
      seconds: 30,
      rider: { pressAfterSeconds: 12 },
    });
    const starts = changeStarts(windowsOf(ride.frames));
    expect(starts[0]?.aside).toBe(YOU);
    expect(starts[0]?.atMs).toBeGreaterThanOrEqual(12_000);
    expect(starts[0]?.atMs).toBeLessThanOrEqual(14_000);
  });
});
