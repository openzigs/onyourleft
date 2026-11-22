// SPDX-License-Identifier: Apache-2.0

/**
 * The rolling route (#2895), read back as the game reads a profile: through
 * {@link gradeAt}, {@link elevationAt} and {@link positionAt} on a view, at
 * ride distance minus the view's origin — never through the route's own
 * arrays. Every graph is synthetic (`rolling-testing.ts`).
 */

import { describe, expect, it } from 'vitest';

import { distanceBetween } from '../geodesy';
import { altitudeMetres } from '../quantities';

import { elevationAt, gradeAt, positionAt, routeProfile, type RouteProfile } from './profile';
import {
  JUNCTION_LOCK_METRES,
  ROLLING_AHEAD_METRES,
  ROLLING_BEHIND_METRES,
  ROLLING_MOST_SAMPLES,
  RollingRoute,
  waysOn,
  type RollingEdge,
  type RollingJunction,
} from './rolling';
import { graphOf, gridGraph, placeAt, roughGround, streetThrough } from './rolling-testing';

/** Columns and rows spaced unevenly, so the ways on from a junction differ in length. */
const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];

/** The grid's edge leaving `node` with `id`, oriented away from it. */
function edgeFrom(
  graph: ReturnType<typeof gridGraph>['graph'],
  node: string,
  id: string,
): RollingEdge {
  const edge = graph.edgesFrom(node).find((candidate) => candidate.id === id);
  if (edge === undefined) throw new Error(`no edge ${id} from ${node}`);
  return edge;
}

/** What the game reads at ride distance `ride` on a view. */
function readAt(view: RouteProfile, origin: number, ride: number) {
  const on = ride - origin;
  return {
    grade: gradeAt(view, on) as number,
    elevation: elevationAt(view, on) as number,
    position: positionAt(view, on),
  };
}

/** Every sample distance in `[from, to]`, in ride distance. */
function samplesIn(from: number, to: number): number[] {
  const out: number[] = [];
  for (let at = Math.ceil(from / 10) * 10; at <= to; at += 10) out.push(at);
  return out;
}

/** A route starting at the grid's south-west corner, riding east along row 3. */
function eastAlongRow3() {
  const { graph } = gridGraph(COLUMNS, ROWS, roughGround, 3);
  const route = new RollingRoute(graph, edgeFrom(graph, '0,3', 'h0,3'));
  return { graph, route };
}

describe('the rolling route grows ahead along the default ways', () => {
  it('reaches the stated distance ahead and keeps no more than the stated distance behind', () => {
    const { route } = eastAlongRow3();
    expect(route.end).toBeGreaterThanOrEqual(ROLLING_AHEAD_METRES);
    route.advance(3_000);
    expect(route.end).toBeGreaterThanOrEqual(3_000 + ROLLING_AHEAD_METRES);
    expect(route.origin).toBeGreaterThanOrEqual(3_000 - ROLLING_BEHIND_METRES - 10);
    expect(route.origin).toBeLessThanOrEqual(3_000 - ROLLING_BEHIND_METRES);
    // The view's length is what is held, and its distance zero is the origin.
    const view = route.view();
    expect(view.totalDistance).toBe(route.end - route.origin);
  });

  it('never changes the position, height or grade at a distance the rider has passed', () => {
    const { route } = eastAlongRow3();
    let view = route.view();
    let origin = route.origin;
    for (let rider = 0; rider <= 6_000; rider += 11) {
      route.advance(rider);
      const next = route.view();
      for (const at of samplesIn(Math.max(origin, route.origin), rider)) {
        const before = readAt(view, origin, at);
        const after = readAt(next, route.origin, at);
        expect(after.grade, `grade at ${at} m`).toBe(before.grade);
        expect(after.elevation, `height at ${at} m`).toBe(before.elevation);
        expect(after.position).toEqual(before.position);
      }
      view = next;
      origin = route.origin;
    }
  });

  it('spaces its samples exactly 10 m along the road, from the ride start', () => {
    const { route } = eastAlongRow3();
    const view = route.view();
    // Row 3 runs due east from the corner: sample k is k × 10 m east of it.
    for (const k of [1, 17, 18, 41, 100]) {
      const metres = distanceBetween(placeAt(0, 650), view.positions[k] as never);
      expect(metres).toBeCloseTo(k * 10, 4);
    }
  });

  it("fits the grade with routeProfile's own filters, on the same road", () => {
    // One long, rough street with no junction on it until its far end.
    const stops: [number, number][] = [];
    for (let east = 0; east <= 4_000; east += 130) stops.push([east, 0]);
    const street = streetThrough(stops, roughGround);
    const edge: RollingEdge = { id: 's', from: 'a', to: 'b', points: street, roadClass: 1 };
    const route = new RollingRoute(graphOf([edge]), edge);
    // ADR 0087 D-4.1 fixes the counts at 5 and 11. `routeProfile` derives its
    // counts from a stretched spacing a hair over 10 m, where 30 m rounds to a
    // 3-sample median; 31 m gives it the same 5 as the rolling route.
    const fixed = routeProfile(street, { despikeWindowMetres: 31 });
    route.advance(1_000);
    expect(route.origin).toBe(0);
    const view = route.view();
    for (const at of samplesIn(100, 2_900)) {
      expect(gradeAt(view, at)).toBeCloseTo(gradeAt(fixed, at), 2);
      expect(elevationAt(view, at)).toBeCloseTo(elevationAt(fixed, at), 2);
    }
  });

  it('hands out a new profile after a change and the same one otherwise, and never changes one it handed out', () => {
    const { route } = eastAlongRow3();
    const first = route.view();
    expect(route.view()).toBe(first);
    const held = first.grades.slice();
    const length = first.positions.length;
    route.advance(400);
    const second = route.view();
    expect(second).not.toBe(first);
    expect(first.grades).toEqual(held);
    expect(first.positions).toHaveLength(length);
  });
});

describe('a junction choice swaps the tail past the junction', () => {
  function firstJunctionWithAnotherWay(route: RollingRoute, after: number) {
    const junction = route
      .junctionsAfter(after)
      .find((candidate) => candidate.distance - after > JUNCTION_LOCK_METRES + 60);
    if (junction === undefined) throw new Error('no junction');
    // Prefer the way whose length differs most from the one taken.
    const taken = junction.ways.find((way) => way.edge.id === junction.taken);
    const other = junction.ways
      .filter((way) => way.edge.id !== junction.taken)
      .sort(
        (a, b) =>
          Math.abs(b.edge.points.length - (taken?.edge.points.length ?? 0)) -
          Math.abs(a.edge.points.length - (taken?.edge.points.length ?? 0)),
      )[0];
    if (other === undefined) throw new Error('no other way');
    return { junction, other };
  }

  it('changes nothing before the junction, and every distance after it follows the new way', () => {
    const { route } = eastAlongRow3();
    const rider = 900;
    route.advance(rider);
    const { junction, other } = firstJunctionWithAnotherWay(route, rider);
    const before = route.view();
    const origin = route.origin;

    expect(route.choose(junction.distance, other.edge.id, rider)).toBe('swapped');
    const after = route.view();
    expect(route.origin).toBe(origin);

    for (const at of samplesIn(origin, junction.distance)) {
      const was = readAt(before, origin, at);
      const now = readAt(after, origin, at);
      expect(now.position, `position at ${at} m`).toEqual(was.position);
      expect(now.elevation, `height at ${at} m`).toBe(was.elevation);
    }
    // The grade reads 80 m of road ahead (ADR 0087 D-6.1), so none is changed
    // further than that before the junction: none the rider can have been sent.
    for (const at of samplesIn(origin, junction.distance - 80)) {
      expect(readAt(after, origin, at).grade, `grade at ${at} m`).toBe(
        readAt(before, origin, at).grade,
      );
    }
    // Past the junction, every sample lies on the chosen street, the right
    // distance along it.
    const chosen = other.edge;
    const start = chosen.points[0]?.position;
    const end = chosen.points[chosen.points.length - 1]?.position;
    if (start === undefined || end === undefined) throw new Error('empty street');
    const length = distanceBetween(start, end);
    const past = samplesIn(junction.distance, junction.distance + length).filter(
      (at) => at > junction.distance,
    );
    // The first sample past the junction is the one a stale sample would be.
    expect(past[0]).toBe(Math.floor(junction.distance / 10) * 10 + 10);
    for (const at of past) {
      const { position } = readAt(after, origin, at);
      expect(distanceBetween(start, position)).toBeCloseTo(at - junction.distance, 3);
      expect(distanceBetween(position, end)).toBeCloseTo(length - (at - junction.distance), 3);
    }
    const legs = route.legs;
    const next = legs.findIndex((leg) => leg.start === junction.distance);
    expect(legs[next]?.edge.id).toBe(chosen.id);
    expect(legs[next]?.kind).toBe('chosen');
    expect(route.junctionsAfter(rider).find((j) => j.distance === junction.distance)?.taken).toBe(
      chosen.id,
    );
  });

  it('swaps between ways of different lengths with no grade the rider was sent changing', () => {
    const { route } = eastAlongRow3();
    const rider = 900;
    route.advance(rider);
    const { junction, other } = firstJunctionWithAnotherWay(route, rider);
    const taken = junction.ways.find((way) => way.edge.id === junction.taken);
    const lengthOf = (edge: RollingEdge) =>
      distanceBetween(
        edge.points[0]?.position as never,
        edge.points[edge.points.length - 1]?.position as never,
      );
    expect(Math.abs(lengthOf(other.edge) - lengthOf(taken?.edge as RollingEdge))).toBeGreaterThan(
      10,
    );
    const lockPoint = junction.distance - JUNCTION_LOCK_METRES - 1;
    route.advance(lockPoint);
    const sent = samplesIn(route.origin, lockPoint).map(
      (at) => readAt(route.view(), route.origin, at).grade,
    );
    expect(route.choose(junction.distance, other.edge.id, lockPoint)).toBe('swapped');
    const now = samplesIn(route.origin, lockPoint).map(
      (at) => readAt(route.view(), route.origin, at).grade,
    );
    expect(now).toEqual(sent);
    // And swapping back is a swap too: the route follows the default again.
    expect(route.choose(junction.distance, junction.taken, lockPoint)).toBe('swapped');
  });

  it('refuses a swap inside the lock distance, so the grade under the rider cannot jump', () => {
    const { route } = eastAlongRow3();
    route.advance(900);
    const { junction, other } = firstJunctionWithAnotherWay(route, 900);
    const view = route.view();
    for (const rider of [
      junction.distance - JUNCTION_LOCK_METRES,
      junction.distance - 99,
      junction.distance,
      junction.distance + 5,
    ]) {
      expect(route.choose(junction.distance, other.edge.id, rider)).toBe('locked');
      expect(route.view()).toBe(view);
    }
    expect(route.choose(junction.distance, other.edge.id, junction.distance - 101)).toBe('swapped');
  });

  it('says why it took no choice: no junction there, no such way, or the way already taken', () => {
    const { route } = eastAlongRow3();
    const junction = route.junctionsAfter(0)[1] as RollingJunction;
    expect(route.choose(junction.distance + 3, junction.taken, 0)).toBe('no-junction');
    expect(route.choose(junction.distance, 'no such street', 0)).toBe('no-such-way');
    expect(route.choose(junction.distance, junction.taken, 0)).toBe('unchanged');
  });

  it('names every way on from left to right, with the default, and never the way back', () => {
    const { route } = eastAlongRow3();
    // Riding east along row 3 (the major road), the first junction has left
    // (north), straight (east) and right (south).
    const junction = route.junctionsAfter(0)[0] as RollingJunction;
    expect(junction.ways.map((way) => Math.round(way.turnDegrees))).toEqual([-90, 0, 90]);
    expect(junction.defaultWay).toBe(junction.ways[1]?.edge.id);
    expect(junction.taken).toBe(junction.defaultWay);
    expect(junction.ways.some((way) => way.edge.id === 'h0,3')).toBe(false);
  });
});

describe("ADR 0088 D-1.4's default way", () => {
  const ground = () => 100;
  const arriving: RollingEdge = {
    id: 'in',
    from: 'a',
    to: 'j',
    points: streetThrough(
      [
        [0, 0],
        [100, 0],
      ],
      ground,
    ),
    roadClass: 1,
  };
  const way = (id: string, to: [number, number], roadClass = 1): RollingEdge => ({
    id,
    from: 'j',
    to: id,
    points: streetThrough([[100, 0], to], ground),
    roadClass,
  });

  it('is the smallest change of bearing', () => {
    const { defaultWay } = waysOn(arriving, [
      way('left', [100, 100]),
      way('slight', [200, 30]),
      way('right', [100, -100]),
    ]);
    expect(defaultWay?.edge.id).toBe('slight');
  });

  it('on a tie, is the higher road class, then the right-hand way', () => {
    const fork = [way('left', [200, 100]), way('right', [200, -100])];
    expect(waysOn(arriving, fork).defaultWay?.edge.id).toBe('right');
    expect(
      waysOn(arriving, [way('left', [200, 100], 2), way('right', [200, -100])]).defaultWay?.edge.id,
    ).toBe('left');
  });

  it('is not the way back, nor a way too short to ride', () => {
    const back: RollingEdge = {
      ...arriving,
      from: 'j',
      to: 'a',
      points: [...arriving.points].reverse(),
    };
    const stub = way('stub', [100.5, 0]);
    const { ways, defaultWay } = waysOn(arriving, [back, stub]);
    expect(ways).toEqual([]);
    expect(defaultWay).toBeUndefined();
  });
});

describe('turning round', () => {
  const ground = (east: number) => 100 + east * 0.04;
  const spur: RollingEdge = {
    id: 'spur',
    from: 'open',
    to: 'dead',
    points: streetThrough(
      [
        [0, 0],
        [300, 0],
        [500, 0],
      ],
      ground,
    ),
    roadClass: 1,
  };

  it('turns round at a dead end, back down the same street with no jump in distance', () => {
    const route = new RollingRoute(graphOf([spur]), spur);
    const legs = route.legs;
    expect(legs[1]?.kind).toBe('turn-round');
    expect(legs[1]?.edge.id).toBe('spur');
    const view = route.view();
    const end = legs[0]?.end as number;
    for (const back of [10, 50, 200, 400]) {
      const out = readAt(view, 0, end - back);
      const home = readAt(view, 0, end + back);
      expect(distanceBetween(out.position, home.position)).toBeLessThan(1e-6);
    }
    // Climbing in, descending out: the grade changes sign through the turn.
    expect(readAt(view, 0, end - 200).grade).toBeCloseTo(4, 1);
    expect(readAt(view, 0, end + 200).grade).toBeCloseTo(-4, 1);
  });

  it('reverses direction where the rider is on a U-turn, with no jump in distance', () => {
    const through: RollingEdge = {
      id: 'long',
      from: 'w',
      to: 'e',
      points: streetThrough(
        [
          [0, 0],
          [1_500, 0],
          [3_000, 0],
        ],
        ground,
      ),
      roadClass: 1,
    };
    const route = new RollingRoute(graphOf([through]), through);
    const rider = 253;
    route.advance(rider);
    const before = route.view();
    route.uTurn(rider);
    const view = route.view();
    // Every distance the rider has reached is where it was, up to the sample
    // the turn is on, 7 m ahead.
    const turn = 260;
    for (const at of [0, 100, 250, rider, 259, turn]) {
      expect(readAt(view, route.origin, at).position).toEqual(
        readAt(before, route.origin, at).position,
      );
    }
    for (const step of [7, 27, 107]) {
      const ahead = readAt(view, route.origin, turn + step);
      expect(distanceBetween(placeAt(0, 0), ahead.position)).toBeCloseTo(turn - step, 3);
    }
    const legs = route.legs;
    expect(legs[1]?.kind).toBe('u-turn');
    expect(legs[0]?.end).toBe(turn);
    expect(legs[1]?.start).toBe(turn);
    // Ridden back to the west end, which is a dead end, it turns round again.
    expect(legs[2]?.kind).toBe('turn-round');
    expect(legs[2]?.start).toBeCloseTo(turn * 2, 6);
    // Past the U-turn, the road descends.
    expect(readAt(view, route.origin, turn + 100).grade).toBeLessThan(0);
  });
});

describe('a U-turn mid-street', () => {
  it('leaves no junction at the turn, so no prompt offers the far end of the street', () => {
    const { route } = eastAlongRow3();
    const rider = 95;
    const turn = 100;
    route.advance(rider);
    // The street the rider is on ends at a junction with three ways on.
    expect(route.junctionsAfter(rider)[0]?.ways.length).toBe(3);
    route.uTurn(rider);
    expect(route.legs[0]?.end).toBe(turn);
    expect(route.legs[1]?.kind).toBe('u-turn');
    expect(route.junctionsAfter(rider).map((junction) => junction.distance)).not.toContain(turn);
  });
});

describe('a rider distance that is not a finite number', () => {
  const notFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it('is refused by every call that takes one, and changes nothing', () => {
    const { route } = eastAlongRow3();
    route.advance(900);
    const { distance, ways, taken } = route.junctionsAfter(900)[0] as RollingJunction;
    const other = ways.find((way) => way.edge.id !== taken)?.edge.id as string;
    const view = route.view();
    const legs = route.legs;
    for (const rider of notFinite) {
      expect(route.choose(distance, other, rider), `choose at ${rider}`).toBe('locked');
      route.uTurn(rider);
      route.advance(rider);
      expect(route.view(), `view after ${rider}`).toBe(view);
      expect(route.legs).toEqual(legs);
    }
    // And the route still rides on from where it was.
    route.advance(1_000);
    expect(route.end - 1_000).toBeGreaterThanOrEqual(ROLLING_AHEAD_METRES);
  });
});

describe('an hour of riding', () => {
  it('holds no more than the stated bound, however long the ride', () => {
    const { route } = eastAlongRow3();
    const speed = 40 / 3.6;
    let mostSamples = 0;
    let mostLegs = 0;
    let turns = 0;
    for (let second = 0; second <= 3_600; second += 1) {
      const rider = second * speed;
      route.advance(rider);
      // Take a way that is not the default at every other junction, and turn
      // round now and then, so the ride wanders the grid rather than leaving it.
      const next = route.junctionsAfter(rider)[0];
      if (next !== undefined && next.distance - rider > JUNCTION_LOCK_METRES && turns % 2 === 0) {
        const other = next.ways.find((way) => way.edge.id !== next.defaultWay);
        if (
          other !== undefined &&
          route.choose(next.distance, other.edge.id, rider) === 'swapped'
        ) {
          turns += 1;
        }
      } else if (next !== undefined && next.distance - rider > JUNCTION_LOCK_METRES) {
        turns += 1;
      }
      if (second % 600 === 300) route.uTurn(rider);
      const view = route.view();
      mostSamples = Math.max(mostSamples, view.elevations.length);
      mostLegs = Math.max(mostLegs, route.legs.length);
      expect(route.end - rider).toBeGreaterThanOrEqual(ROLLING_AHEAD_METRES);
      expect(Number.isFinite(readAt(view, route.origin, rider).grade)).toBe(true);
    }
    expect(turns).toBeGreaterThan(20);
    expect(mostSamples).toBeLessThanOrEqual(ROLLING_MOST_SAMPLES);
    // The legs go with the samples: the road held is 3 km, and no street in
    // this grid is shorter than 170 m.
    expect(mostLegs).toBeLessThanOrEqual(Math.ceil(3_010 / 170) + 2);
  });
});

describe('a start street that is not one', () => {
  it('is refused, with no position in the words', () => {
    const one = streetThrough([[0, 0]], roughGround);
    const graph = graphOf([]);
    expect(
      () => new RollingRoute(graph, { id: 'x', from: 'a', to: 'b', points: one, roadClass: 1 }),
    ).toThrow(expect.objectContaining({ code: 'too-few-points' }));
    const here = { position: placeAt(5, 5), elevation: altitudeMetres(1) };
    try {
      new RollingRoute(graph, { id: 'x', from: 'a', to: 'b', points: [here, here], roadClass: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'no-distance' });
      expect(String((error as Error).message)).not.toMatch(/40\.|105\.|-105/);
    }
  });
});
