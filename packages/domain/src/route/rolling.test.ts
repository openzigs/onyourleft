// SPDX-License-Identifier: Apache-2.0

/**
 * The rolling route (#2895), read back as the game reads a profile: through
 * {@link gradeAt}, {@link elevationAt} and {@link positionAt} on a view, at
 * ride distance minus the view's origin — never through the route's own
 * arrays. Every graph is synthetic (`rolling-testing.ts`).
 */

import { describe, expect, it } from 'vitest';

import { distanceBetween } from '../geodesy';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
} from '../quantities';

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
  type RollingStreetGraph,
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

  it('hands out the route a choice would give without taking it, and is left as it was — #3051', () => {
    const { route } = eastAlongRow3();
    // Past the first trim, and not on a sample: the road held starts at 530 m.
    const rider = 1_534;
    route.advance(rider);
    const { junction, other } = firstJunctionWithAnotherWay(route, rider);
    const before = route.view();
    const held = {
      origin: route.origin,
      end: route.end,
      legs: route.legs,
      junctions: route.junctionsAfter(rider),
    };

    const took = route.taking(junction.distance, other.edge.id);
    if (took === undefined) throw new Error('no route');
    const taking = took.view();

    // Nothing of the route moved: the same view object, legs, ends and junctions.
    expect(route.view()).toBe(before);
    expect(route.origin).toBe(held.origin);
    expect(route.end).toBe(held.end);
    expect(route.legs).toEqual(held.legs);
    expect(route.junctionsAfter(rider)).toEqual(held.junctions);
    // And a route that goes on from there goes on as one never asked does.
    const { route: unasked } = eastAlongRow3();
    unasked.advance(rider);
    route.advance(rider + 700);
    unasked.advance(rider + 700);
    expect(route.view()).toEqual(unasked.view());
    expect(route.legs).toEqual(unasked.legs);

    // The view is the one the choice gives, sample for sample, as far as it reaches.
    const { route: chosen } = eastAlongRow3();
    chosen.advance(rider);
    expect(chosen.choose(junction.distance, other.edge.id, rider)).toBe('swapped');
    const swapped = chosen.view();
    expect(taking).not.toBe(before);
    expect(taking.positions.length).toBeGreaterThanOrEqual(swapped.positions.length - 1);
    const count = Math.min(taking.positions.length, swapped.positions.length);
    expect(taking.positions.slice(0, count)).toEqual(swapped.positions.slice(0, count));
    // The grade's window runs 70 m past a sample, so the last of a shorter view are provisional.
    expect(taking.elevations.slice(0, count - 2)).toEqual(swapped.elevations.slice(0, count - 2));
    expect(taking.grades.slice(0, count - 7)).toEqual(swapped.grades.slice(0, count - 7));
    // It leaves the road the route takes at the junction, and not before it.
    const split = Math.floor((junction.distance - held.origin) / 10);
    expect(taking.positions.slice(0, split + 1)).toEqual(before.positions.slice(0, split + 1));
    expect(taking.positions[split + 2]).not.toEqual(before.positions[split + 2]);
    // The other route is one of its own: the same origin and U-turns, the
    // way taken at the junction, and its own junctions on from there.
    expect(took.origin).toBe(held.origin);
    expect(took.uTurns).toBe(route.uTurns);
    expect(took.junctionsAfter(rider).find((j) => j.distance === junction.distance)?.taken).toBe(
      other.edge.id,
    );
    expect(took.legs.map((leg) => leg.edge.id)).toEqual(chosen.legs.map((leg) => leg.edge.id));
    // And riding IT on changes nothing of the route it was taken from.
    const mine = route.view();
    took.advance(rider + 1_500);
    took.uTurn(rider + 1_500);
    expect(route.view()).toBe(mine);
    expect(route.legs).toEqual(unasked.legs);
  });

  it('hands out no route for a junction that is not on the route, or a way that is not one of its ways on — #3051', () => {
    const { route } = eastAlongRow3();
    const { junction, other } = firstJunctionWithAnotherWay(route, 0);
    const before = route.view();
    expect(route.taking(junction.distance + 1, other.edge.id)).toBeUndefined();
    expect(route.taking(junction.distance, 'no-such-street')).toBeUndefined();
    expect(route.view()).toBe(before);
    // The way already taken is a way on: its route's road is this route's own.
    const own = route.taking(junction.distance, junction.taken)?.view();
    if (own === undefined) throw new Error('no route');
    expect(own.positions.slice(0, -1)).toEqual(before.positions.slice(0, own.positions.length - 1));
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

describe('the next junction alone — #2898', () => {
  it('is the first of every junction after the rider, at every distance, through a choice and a U-turn', () => {
    const { route } = eastAlongRow3();
    const check = (from: number, to: number): void => {
      for (let rider = from; rider <= to; rider += 7) {
        expect(route.nextJunctionAfter(rider), `at ${rider}`).toEqual(
          route.junctionsAfter(rider)[0],
        );
      }
    };
    check(-20, 1_500);
    // A junction's exact distance is not after it.
    const first = route.junctionsAfter(0)[0] as RollingJunction;
    expect(route.nextJunctionAfter(first.distance)).toEqual(
      route.junctionsAfter(first.distance)[0],
    );
    expect(route.nextJunctionAfter(first.distance)?.distance).toBeGreaterThan(first.distance);
    const next = route.junctionsAfter(700)[0] as RollingJunction;
    const other = next.ways.find((way) => way.edge.id !== next.taken)?.edge.id as string;
    expect(route.choose(next.distance, other, 700)).toBe('swapped');
    check(700, 2_400);
    route.advance(1_300);
    route.uTurn(1_300);
    check(1_300, 3_000);
    for (const rider of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(route.nextJunctionAfter(rider)).toEqual(route.junctionsAfter(rider)[0]);
    }
  });

  it('works out the ways on for one junction, not for every one in the 2 km ahead', () => {
    const { graph } = gridGraph(COLUMNS, ROWS, roughGround, 3);
    let asked = 0;
    const counted = {
      edgesFrom: (node: string) => {
        asked += 1;
        return graph.edgesFrom(node);
      },
    };
    const route = new RollingRoute(counted, edgeFrom(graph, '0,3', 'h0,3'));
    route.advance(300);
    expect(route.junctionsAfter(300).length).toBeGreaterThan(5);
    asked = 0;
    expect(route.nextJunctionAfter(300)).toBeDefined();
    // Every node on this grid is a junction, so the first leg past the rider ends at one.
    expect(asked).toBe(1);
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

describe('the edge cases the review of #2962 found — #2982', () => {
  const ground = (east: number) => 100 + east * 0.04;
  const long: RollingEdge = {
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

  it('reads a rider far past the road held as a reach past its end, so one call samples twice its reach at most', () => {
    const { route } = eastAlongRow3();
    const end = route.end;
    route.advance(1e9);
    // Twice the reach past the old end, and the samples bounded as ever.
    expect(route.end).toBeLessThanOrEqual(end + 2 * ROLLING_AHEAD_METRES + 10);
    expect(route.end).toBeGreaterThanOrEqual(end + 2 * ROLLING_AHEAD_METRES);
    expect(route.view().positions.length).toBeLessThanOrEqual(ROLLING_MOST_SAMPLES);
    // And the next call goes on from there.
    route.advance(1e9);
    expect(route.end).toBeGreaterThanOrEqual(end + 4 * ROLLING_AHEAD_METRES);
  });

  it('turns nothing round behind the origin or past the end, and throws nothing', () => {
    const route = new RollingRoute(graphOf([long]), long);
    route.advance(1_800);
    expect(route.origin).toBeGreaterThan(0);
    const view = route.view();
    const legs = route.legs;
    for (const rider of [route.origin - 50, route.end + 50]) {
      expect(() => {
        route.uTurn(rider);
      }).not.toThrow();
      expect(route.view()).toBe(view);
      expect(route.legs).toEqual(legs);
    }
    // And a caller counting U-turns is told of none.
    expect(route.uTurns).toBe(0);
  });

  it('turns the rider back the way they were going on a second U-turn within one sample', () => {
    const route = new RollingRoute(graphOf([long]), long);
    route.advance(253);
    const before = route.view();
    route.uTurn(253);
    route.uTurn(255);
    expect(route.uTurns).toBe(2);
    const view = route.view();
    // Up to the turn, nothing moved; past it the rider rides on east, as before both.
    for (const at of [0, 250, 260, 300, 700, 1_400]) {
      expect(distanceBetween(readAt(view, route.origin, at).position, placeAt(at, 0))).toBeLessThan(
        0.01,
      );
      expect(readAt(view, route.origin, at).grade).toBeCloseTo(
        readAt(before, route.origin, at).grade,
        6,
      );
    }
  });

  it('turns back along the street ridden in on, at a sample where one street meets the next', () => {
    // A street exactly 200 m long, ridden north into a node on the equator,
    // where one way goes east and one west: the node is a sample, held by the
    // street ridden in on and by the way taken after it. The latitude is found
    // by stepping an ulp at a time until the street is 200 m to the bit.
    const at = (latitude: number, longitude: number) => ({
      position: geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
      elevation: altitudeMetres(0),
    });
    const node = at(0, 0);
    const guess = -200 / ((6_371_008.8 * Math.PI) / 180);
    let south = guess;
    for (let step = -400; step <= 400; step += 1) {
      const latitude = guess * (1 + step * Number.EPSILON);
      if ((distanceBetween(at(latitude, 0).position, node.position) as number) === 200) {
        south = latitude;
        break;
      }
    }
    const ridden: RollingEdge = {
      id: 'in',
      from: 's',
      to: 'm',
      points: [at(south, 0), node],
      roadClass: 1,
    };
    const east: RollingEdge = {
      id: 'e',
      from: 'm',
      to: 'x',
      points: [node, at(0, 0.03)],
      roadClass: 1,
    };
    const west: RollingEdge = {
      id: 'w',
      from: 'm',
      to: 'y',
      points: [node, at(0, -0.03)],
      roadClass: 1,
    };
    const route = new RollingRoute(graphOf([ridden, east, west]), ridden);
    expect(route.legs[0]?.end).toBe(200);
    route.uTurn(195);
    const view = route.view();
    // Back south down the street ridden in on, never on along the other way west.
    for (const back of [10, 100, 190]) {
      expect(readAt(view, route.origin, 200 + back).position.latitude).toBeLessThan(0);
      expect(Math.abs(readAt(view, route.origin, 200 + back).position.longitude)).toBeLessThan(
        1e-9,
      );
    }
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

describe('a dead end that the graph later goes on past — #2990', () => {
  const ground = (east: number) => 100 + east * 0.04;
  // A street east from 0 to 800 m, whose far end is the edge of the map held.
  const first: RollingEdge = {
    id: 'first',
    from: 'start',
    to: 'edge',
    points: streetThrough(
      [
        [0, 0],
        [800, 0],
      ],
      ground,
    ),
    roadClass: 1,
  };
  // The street on from there, once the next block is read.
  const onward: RollingEdge = {
    id: 'onward',
    from: 'edge',
    to: 'far',
    points: streetThrough(
      [
        [800, 0],
        [4_000, 0],
      ],
      ground,
    ),
    roadClass: 1,
  };

  /** A graph whose streets may be added to after the route reads it. */
  function growing(): { graph: RollingStreetGraph; add: (edge: RollingEdge) => void } {
    const edges: RollingEdge[] = [first];
    return {
      graph: { edgesFrom: (node) => graphOf(edges).edgesFrom(node) },
      add: (edge) => {
        edges.push(edge);
      },
    };
  }

  it('takes the way on past a turn-round once the graph has one, changing nothing the rider can have been sent', () => {
    const { graph, add } = growing();
    const route = new RollingRoute(graph, first);
    expect(route.legs[1]?.kind).toBe('turn-round');
    const rider = 300;
    route.advance(rider);
    const before = route.view();
    add(onward);
    expect(route.reopen(rider)).toBe(true);
    const legs = route.legs;
    expect(legs[1]?.kind).toBe('default');
    expect(legs[1]?.edge.id).toBe('onward');
    const view = route.view();
    expect(view).not.toBe(before);
    // Ridden on east past the old end, not back west: 1 km past it is 1.8 km
    // from the start.
    const end = legs[0]?.end as number;
    const past = readAt(view, route.origin, end + 1_000).position;
    expect(distanceBetween(placeAt(0, 0), past)).toBeCloseTo(end + 1_000, 0);
    // Nothing up to 100 m short of the old end moved, and no grade a rider at
    // 300 m can have been sent (it reads 80 m ahead) changed.
    for (const at of samplesIn(0, end - 100)) {
      expect(readAt(view, route.origin, at).position).toEqual(
        readAt(before, route.origin, at).position,
      );
    }
    for (const at of samplesIn(0, rider + 80)) {
      expect(readAt(view, route.origin, at).grade).toBe(readAt(before, route.origin, at).grade);
    }
    // Nothing more to take.
    expect(route.reopen(rider)).toBe(false);
  });

  it('rides a turn-round within the lock as it is', () => {
    const { graph, add } = growing();
    const route = new RollingRoute(graph, first);
    const end = route.legs[0]?.end as number;
    const rider = end - JUNCTION_LOCK_METRES;
    route.advance(rider);
    const before = route.view();
    add(onward);
    expect(route.reopen(Number.NaN)).toBe(false);
    expect(route.view()).toBe(before);
    // The turn-round 100 m ahead stays: the rider turns round there and rides
    // back to the start, a dead end, and back again. The street on is taken
    // the next time the route reaches the old end, a lap of 1.6 km later.
    route.reopen(rider);
    const legs = route.legs;
    expect(legs[1]?.kind).toBe('turn-round');
    expect(legs[2]?.kind).toBe('turn-round');
    expect(legs[3]?.kind).toBe('default');
    expect(legs[3]?.edge.id).toBe('onward');
    for (const at of samplesIn(0, end + 700)) {
      expect(readAt(route.view(), route.origin, at).position).toEqual(
        readAt(before, route.origin, at).position,
      );
    }
  });

  it('changes nothing at a dead end that still is one', () => {
    const { graph } = growing();
    const route = new RollingRoute(graph, first);
    const before = route.view();
    expect(route.reopen(0)).toBe(false);
    expect(route.view()).toBe(before);
  });
});

describe("a loop's two ways — #2990", () => {
  const ground = () => 100;
  const stem: RollingEdge = {
    id: 'stem',
    from: 's',
    to: 'n',
    points: streetThrough(
      [
        [0, -300],
        [0, 0],
      ],
      ground,
    ),
    roadClass: 1,
  };
  const ring = streetThrough(
    [
      [0, 0],
      [200, 100],
      [0, 200],
      [-200, 100],
      [0, 0],
    ],
    ground,
  );
  // As the open-world session orients a loop: two ways, two ids, one street.
  const clockwise: RollingEdge = {
    id: 'ring',
    street: 'ring',
    from: 'n',
    to: 'n',
    points: ring,
    roadClass: 1,
  };
  const anticlockwise: RollingEdge = {
    id: 'ring:reverse',
    street: 'ring',
    from: 'n',
    to: 'n',
    points: [...ring].reverse(),
    roadClass: 1,
  };
  const graph: RollingStreetGraph = {
    edgesFrom: (node) =>
      node === 'n'
        ? [
            { ...stem, from: 'n', to: 's', points: [...stem.points].reverse() },
            clockwise,
            anticlockwise,
          ]
        : node === 's'
          ? [stem]
          : [],
  };

  it('offers both ways round by two ids, and a choice by either takes that way', () => {
    const route = new RollingRoute(graph, stem);
    const junction = route.junctionsAfter(0)[0] as RollingJunction;
    expect(junction.ways.map((way) => way.edge.id).sort()).toEqual(['ring', 'ring:reverse']);
    for (const [id, east] of [
      ['ring', 1],
      ['ring:reverse', -1],
    ] as const) {
      expect(['swapped', 'unchanged']).toContain(route.choose(junction.distance, id, 0));
      const at = readAt(route.view(), route.origin, junction.distance + 150).position;
      // 150 m round the ring the rider is east of the stem one way, west the other.
      expect(Math.sign(at.longitude - placeAt(0, 0).longitude)).toBe(east);
    }
  });

  it('offers neither way round from the ring itself: both are the way back', () => {
    const { ways } = waysOn(clockwise, graph.edgesFrom('n'));
    expect(ways.map((way) => way.edge.id)).toEqual(['stem']);
  });

  it('keeps the street on a way it turns round, so the way back from there is still the ring', () => {
    // Up the stem and once round the ring, then a U-turn on the ring: ridden
    // back to the node, neither way round is a way on from it.
    const route = new RollingRoute(graph, stem);
    const junction = route.junctionsAfter(0)[0] as RollingJunction;
    const rider = junction.distance + 100;
    route.advance(rider);
    route.uTurn(rider);
    const legs = route.legs;
    const uTurn = legs.findIndex((leg) => leg.kind === 'u-turn');
    expect(legs[uTurn]?.edge.street).toBe('ring');
    expect(legs[uTurn + 1]?.edge.id).toBe('stem');
  });
});

describe('a U-turn just past a junction: the road back undoes the turn — #3129, ADR 0088', () => {
  /** East along row 3, right... north at the first junction (180 m), and turned round `past` metres on. */
  function turnedNorthThenRound(past: number) {
    const { route } = eastAlongRow3();
    const junction = route.junctionsAfter(0)[0] as RollingJunction;
    expect(junction.distance).toBeCloseTo(180, 0);
    expect(route.choose(junction.distance, 'v1,3', 50)).toBe('swapped');
    const rider = junction.distance + past;
    route.advance(rider);
    route.uTurn(rider);
    const back = route.junctionsAfter(rider)[0] as RollingJunction;
    return { route, rider, back };
  }

  it('takes, as its default, the way back onto the street ridden in on, within the lock', () => {
    const { route, back } = turnedNorthThenRound(60);
    // Ridden back to the junction from 60 m past it.
    expect(back.distance).toBeCloseTo(300, 0);
    expect(back.defaultWay).toBe('h0,3');
    expect(back.taken).toBe('h0,3');
    // Read through the view the game reads: past the junction, west along row 3.
    const view = route.view();
    for (const on of [20, 60, 150]) {
      expect(
        distanceBetween(
          readAt(view, route.origin, back.distance + on).position,
          placeAt(180 - on, ROWS[3] as number),
        ),
      ).toBeLessThan(1);
    }
    // Set by the U-turn itself: the junction is inside the lock, so no press made it.
    expect(back.distance - 240).toBeLessThanOrEqual(JUNCTION_LOCK_METRES);
    expect(route.choose(back.distance, 'v1,2', 240)).toBe('locked');
  });

  it('still takes it with the turn 90 m past the junction, which is still inside the lock', () => {
    const { route, rider, back } = turnedNorthThenRound(90);
    expect(back.defaultWay).toBe('h0,3');
    expect(back.taken).toBe('h0,3');
    // The turn is on the next sample, and the junction is no further from it than the lock.
    expect(route.choose(back.distance, 'v1,2', rider)).toBe('locked');
  });

  it('keeps D-1.4’s default for a U-turn further past the junction than the lock', () => {
    const { back } = turnedNorthThenRound(JUNCTION_LOCK_METRES + 10);
    // Straight on, south across row 3: the smallest change of bearing.
    expect(back.defaultWay).toBe('v1,2');
    expect(back.taken).toBe('v1,2');
    // And the street turned off from is still offered both ways, for a press to take.
    expect(back.ways.map((way) => way.edge.id).sort()).toEqual(['h0,3', 'h1,3', 'v1,2']);
  });

  it('keeps D-1.4’s default for a U-turn on the street ridden from the start, with no junction behind', () => {
    const { graph, route } = eastAlongRow3();
    route.advance(60);
    route.uTurn(60);
    const [start, back] = route.legs;
    const wanted = waysOn(back?.edge as RollingEdge, graph.edgesFrom('0,3')).defaultWay;
    expect(start?.kind).toBe('start');
    expect(route.legs[2]?.kind).toBe('default');
    expect(route.legs[2]?.edge.id).toBe(wanted?.edge.id);
  });
});
