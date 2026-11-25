// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The trainer's grade on an open-world ride's rolling route — #2982, under
 * ADR 0087 D-6: a session that follows each new view of the road
 * (`gradient.ts` §`follow`), read back from what a trainer was handed.
 *
 * The road is a synthetic street (`@onyourleft/domain/rolling-testing`), and
 * the ride is ridden the way `GameView`'s loop rides one: a sample every
 * frame at the ride distance, and the road followed whenever
 * `open-world/road.ts` hands on a new view.
 */

import { describe, expect, it } from 'vitest';

import {
  JUNCTION_LOCK_METRES,
  RollingRoute,
  SIMULATION_GRADE_DEADBAND_PERCENT,
  gradeAt,
  gradePercent,
  seconds,
  type RollingEdge,
  type RouteProfile,
} from '@onyourleft/domain';
import { graphOf, gridGraph, streetThrough } from '@onyourleft/domain/rolling-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { CORRECTION_GRADE_STEP_PERCENT_PER_SECOND } from '../net/correction';
import { createGradientSession, type GradientSession } from './gradient';
import { alongView, OpenWorldRoad } from './open-world/road';
import type { GradientTrainer } from './trainer-port';

/** A trainer that keeps every grade it was asked for, and when. */
function recordingTrainer(clock: () => number): {
  readonly control: GradientTrainer;
  readonly written: { readonly at: number; readonly grade: number }[];
} {
  const written: { at: number; grade: number }[] = [];
  return {
    written,
    control: {
      setSimulationParameters: (parameters: SimulationParameters) => {
        written.push({ at: clock(), grade: parameters.grade });
        return Promise.resolve();
      },
      letGo: () => Promise.resolve({ kind: 'stopped' }),
    },
  };
}

const drain = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

/** 30 km/h, and a frame every 0.1 s: the writer's one-a-second pace is what matters. */
const SPEED = 30 / 3.6;
const FRAME_SECONDS = 0.1;

interface Ride {
  readonly road: OpenWorldRoad;
  readonly session: GradientSession;
  readonly written: { readonly at: number; readonly grade: number }[];
  /** The view each write was read from, and the ride distance it was at. */
  readonly roads: {
    readonly at: number;
    readonly distance: number;
    readonly view: RouteProfile;
    readonly origin: number;
  }[];
  /** Rides on to ride distance `to`, at the ride's speed, following the road. */
  rideTo(to: number): Promise<void>;
  readonly distance: () => number;
  readonly now: () => number;
}

function rideOn(route: RollingRoute, walkFrom?: number): Ride {
  let at = 0;
  let distance = 0;
  const road = new OpenWorldRoad(route);
  const trainer = recordingTrainer(() => at);
  const session = createGradientSession({
    profile: road.view.profile,
    control: trainer.control,
    ...(walkFrom === undefined ? {} : { walkFrom: gradePercent(walkFrom) }),
  });
  const roads: Ride['roads'] = [];
  return {
    road,
    session,
    written: trainer.written,
    roads,
    distance: () => distance,
    now: () => at,
    async rideTo(to: number) {
      while (distance < to) {
        at += FRAME_SECONDS;
        distance = Math.min(to, distance + SPEED * FRAME_SECONDS);
        const next = road.follow(distance);
        if (next !== undefined) session.follow(next.profile, next.origin, next.turned);
        session.sample(seconds(at), distance);
        roads.push({ at, distance, view: road.view.profile, origin: road.view.origin });
        await drain();
      }
    },
  };
}

/** The road's own grade at ride distance `distance` on `view`, as the driver clamps it. */
function roadGrade(view: RouteProfile, origin: number, distance: number): number {
  return gradeAt(view, alongView({ origin }, distance));
}

/** A climb at `percent`, `metres` long, west to east, ending in a dead end. */
function climb(percent: number, metres: number): RollingRoute {
  const street: RollingEdge = {
    id: 'climb',
    from: 'bottom',
    to: 'top',
    points: streetThrough(
      [
        [0, 0],
        [metres / 2, 0],
        [metres, 0],
      ],
      (east) => 100 + (east * percent) / 100,
    ),
    roadClass: 1,
  };
  return new RollingRoute(graphOf([street]), street);
}

describe('the grade on a rolling route past its first view — #2982, ADR 0087 D-6', () => {
  it('follows the road through every new view, with each write the road’s grade where it was read', async () => {
    // A rolling grid: the route is advanced, trimmed and handed on many times.
    const { graph, edges } = gridGraph(
      [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450, 2_700, 2_900],
      [0, 230, 400, 650, 820, 1_090],
    );
    const start = edges.find((edge) => edge.id === 'h0,3') as RollingEdge;
    const ride = rideOn(new RollingRoute(graph, start));
    await ride.rideTo(6_000);
    // Past the first view, and the origin moved.
    expect(ride.road.view.origin).toBeGreaterThan(3_000);
    expect(new Set(ride.roads.map((each) => each.view)).size).toBeGreaterThan(3);
    expect(ride.written.length).toBeGreaterThan(20);
    for (const write of ride.written) {
      const read = ride.roads.find((each) => each.at === write.at);
      if (read === undefined) throw new Error('a write at no frame');
      expect(write.grade).toBeCloseTo(roadGrade(read.view, read.origin, read.distance), 6);
    }
    // And never two writes inside the driver's one second, a new view or not.
    for (let index = 1; index < ride.written.length; index += 1) {
      const gap = (ride.written[index]?.at ?? 0) - (ride.written[index - 1]?.at ?? 0);
      expect(gap).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('sends the same grades up to the lock whichever way is chosen past a junction, of whatever length', async () => {
    const columns = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520];
    const rows = [0, 230, 400, 650, 820, 1_090, 1_280];
    const ride = (choose: boolean) => {
      const { graph, edges } = gridGraph(columns, rows);
      const route = new RollingRoute(
        graph,
        edges.find((edge) => edge.id === 'h0,3') as RollingEdge,
      );
      return { route, ride: rideOn(route), choose };
    };
    const taken = ride(false);
    const swapped = ride(true);
    const junction = swapped.route.junctionsAfter(0)[1];
    if (junction === undefined) throw new Error('no second junction');
    const chosenBefore = junction.distance - JUNCTION_LOCK_METRES - 1;
    await taken.ride.rideTo(chosenBefore);
    await swapped.ride.rideTo(chosenBefore);
    const other = junction.ways.find((way) => way.edge.id !== junction.taken)?.edge.id as string;
    expect(swapped.route.choose(junction.distance, other, chosenBefore)).toBe('swapped');
    const lockAt = junction.distance - JUNCTION_LOCK_METRES;
    await taken.ride.rideTo(lockAt);
    await swapped.ride.rideTo(lockAt);
    expect(swapped.ride.written).toEqual(taken.ride.written);
    // And a choice inside the lock is refused, so it can change nothing.
    expect(swapped.route.choose(junction.distance, junction.defaultWay, lockAt + 1)).toBe('locked');
  });

  it('walks the grade at 1 % a second after a U-turn on a climb, never stepping it', async () => {
    const ride = rideOn(climb(8, 3_000));
    await ride.rideTo(600);
    const before = ride.written[ride.written.length - 1]?.grade as number;
    expect(before).toBeCloseTo(8, 0);
    const sentBefore = ride.written.length;
    // As #2897's junction choice turns the rider: on the route itself.
    ride.road.route.uTurn(ride.distance());
    await ride.rideTo(900);
    expect(ride.written.length).toBeGreaterThan(sentBefore + 10);
    for (let index = sentBefore; index < ride.written.length; index += 1) {
      const previous = ride.written[index - 1] as { readonly at: number; readonly grade: number };
      const write = ride.written[index] as { readonly at: number; readonly grade: number };
      const allowed =
        CORRECTION_GRADE_STEP_PERCENT_PER_SECOND * Math.min(1, write.at - previous.at);
      expect(Math.abs(write.grade - previous.grade), `write ${index}`).toBeLessThanOrEqual(
        allowed + 1e-9,
      );
    }
    // And it gets there: down the climb it is on the road's own −8 %.
    expect(ride.written[ride.written.length - 1]?.grade).toBeCloseTo(-8, 0);
  });

  it('walks a change the caller did not name as a U-turn, when the grade under the rider moved', async () => {
    const steep = climb(8, 3_000);
    const flat = climb(0, 3_000);
    const ride = rideOn(steep);
    await ride.rideTo(600);
    const at = ride.now();
    const before = ride.written[ride.written.length - 1]?.grade as number;
    // A road whose grade under the rider is 8 % lower, handed on as no U-turn.
    ride.session.follow(flat.view(), flat.origin, false);
    for (let second = 1; second <= 4; second += 1) {
      ride.session.sample(seconds(at + second), ride.distance());
      await drain();
    }
    const walked = ride.written.slice(-4).map((write) => write.grade);
    expect(walked[0]).toBeCloseTo(before - 1, 6);
    expect(walked[3]).toBeCloseTo(before - 4, 6);
  });

  it('writes nothing for a new view that changes nothing under the rider', async () => {
    const ride = rideOn(climb(4, 3_000));
    await ride.rideTo(300);
    const count = ride.written.length;
    const at = ride.now();
    // The same road again, as a new view would hand it on: within the
    // driver's second, and within its deadband, nothing is written.
    const view = ride.road.view;
    ride.session.follow({ ...view.profile }, view.origin, false);
    ride.session.sample(seconds(at + 0.5), ride.distance());
    await drain();
    expect(ride.written).toHaveLength(count);
    expect(SIMULATION_GRADE_DEADBAND_PERCENT).toBeGreaterThan(0);
  });
});

describe('the start of a ride, walked — #2899, ADR 0087 D-6.4', () => {
  /** The biggest change between one write and the next, in percent a second. */
  const steepest = (written: readonly { at: number; grade: number }[]): number => {
    let most = 0;
    for (let index = 1; index < written.length; index += 1) {
      const before = written[index - 1] as { at: number; grade: number };
      const after = written[index] as { at: number; grade: number };
      most = Math.max(most, Math.abs(after.grade - before.grade) / (after.at - before.at));
    }
    return most;
  };

  it('writes one step from the grade it walks from first, then a step a second up to the road', async () => {
    const ride = rideOn(climb(12, 3_000), 0);
    await ride.rideTo(400);
    const grades = ride.written.map((write) => write.grade);
    // The road's own grade at the start is some 6 % (half a window of 12 %).
    expect(roadGrade(ride.road.view.profile, 0, 0)).toBeGreaterThan(5);
    expect(grades[0]).toBeCloseTo(CORRECTION_GRADE_STEP_PERCENT_PER_SECOND, 6);
    expect(ride.written[0]?.at).toBeCloseTo(FRAME_SECONDS, 6);
    expect(steepest(ride.written)).toBeLessThanOrEqual(
      CORRECTION_GRADE_STEP_PERCENT_PER_SECOND + 1e-6,
    );
    expect(grades.at(-1)).toBeCloseTo(12, 1);
  });

  it('walks down as it walks up: a descent from the start is a step at a time too', async () => {
    const ride = rideOn(climb(-9, 3_000), 0);
    await ride.rideTo(300);
    expect(ride.written[0]?.grade).toBeCloseTo(-CORRECTION_GRADE_STEP_PERCENT_PER_SECOND, 6);
    expect(steepest(ride.written)).toBeLessThanOrEqual(
      CORRECTION_GRADE_STEP_PERCENT_PER_SECOND + 1e-6,
    );
    expect(ride.written.at(-1)?.grade).toBeCloseTo(-9, 1);
  });

  it('still tells the trainer of a flat start: the first write is made though it moves nothing', async () => {
    const ride = rideOn(climb(0, 3_000), 0);
    await ride.rideTo(100);
    expect(ride.written.length).toBeGreaterThan(0);
    expect(new Set(ride.written.map((write) => write.grade))).toStrictEqual(new Set([0]));
  });

  it('is the driver’s write, the road’s grade at once, with no grade to walk from', async () => {
    const ride = rideOn(climb(12, 3_000));
    await ride.rideTo(50);
    expect(ride.written[0]?.grade).toBeGreaterThan(5);
  });

  it('walks again from that grade when the first write was refused and none was confirmed', async () => {
    let now = 0;
    let refuse = true;
    const written: { at: number; grade: number }[] = [];
    const route = climb(12, 3_000);
    const session = createGradientSession({
      profile: route.view(),
      walkFrom: gradePercent(0),
      control: {
        setSimulationParameters: (parameters: SimulationParameters) => {
          if (refuse) return Promise.reject(new Error('refused'));
          written.push({ at: now, grade: parameters.grade });
          return Promise.resolve();
        },
        letGo: () => Promise.resolve({ kind: 'stopped' }),
      },
    });
    session.sample(seconds(now), 0);
    await drain();
    refuse = false;
    for (now = 1; now <= 4; now += 1) {
      session.sample(seconds(now), now * SPEED);
      await drain();
    }
    expect(written[0]?.grade).toBeCloseTo(CORRECTION_GRADE_STEP_PERCENT_PER_SECOND, 6);
    expect(steepest(written)).toBeLessThanOrEqual(CORRECTION_GRADE_STEP_PERCENT_PER_SECOND + 1e-6);
  });
});
