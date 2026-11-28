// SPDX-License-Identifier: AGPL-3.0-or-later

import { metres, seconds, type RouteProfile } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { sitSeatShare } from './gait';
import { BARRIER_OFFSET_METRES, BARRIER_THICKNESS_METRES, type PlacedStand } from './gantry';
import {
  PEOPLE_FAR_MAX,
  PEOPLE_NEAR_MAX,
  PERSON_CLEARANCE_METRES,
  PERSON_HALF_WIDTH_METRES,
  peopleAt,
  personLook,
  walkLine,
  type PeopleOptions,
  type Person,
} from './people';
import { distanceToDrawnRoad } from './road-grid';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  SHOP_GROUP_MOST,
  SHOP_KERB_CLEAR_METRES,
  SHOP_OUT_METRES,
  SPECTATOR_CLAP_METRES,
  benchSitters,
  gantrySpectators,
  shopStanders,
  stillPeopleAt,
  type ShopFrontPlan,
  type StillSpot,
} from './still-people';
import { BENCH_SITTER_PLACES, streetsAt, type FurnitureItem } from './streets';
import { ROAD_WIDTH_METRES, corridorOrigin } from './terrain';
import { furniturePartBounds } from './three-renderer';

/** A long straight road with villages along it, as `streets.test.ts` rides. */
const FARMLAND = northRoute(6_000, () => 40);

/** A point in a bench's own frame: `+z` to the road, as three turns it by the bench's yaw. */
function inBenchFrame(bench: FurnitureItem, x: number, z: number): { along: number; out: number } {
  const dx = x - bench.x;
  const dz = z - bench.z;
  const sin = Math.sin(bench.rotation);
  const cos = Math.cos(bench.rotation);
  return { along: dx * cos - dz * sin, out: dx * sin + dz * cos };
}

/**
 * The drawn bench's seat, read off the renderer's own parts: the slats, every
 * part a few centimetres deep and below the back — what a sitter sits on.
 */
function drawnSeat(): { top: number; back: number; front: number; half: number } {
  const slats = furniturePartBounds('bench').filter(
    (part) => part.max[1] - part.min[1] <= 0.05 && part.max[1] < 0.55,
  );
  if (slats.length === 0) throw new Error('the bench has no seat');
  return {
    top: Math.max(...slats.map((part) => part.max[1])),
    back: Math.min(...slats.map((part) => part.min[2])),
    front: Math.max(...slats.map((part) => part.max[2])),
    half: Math.max(...slats.map((part) => part.max[0])),
  };
}

function frameAt(
  profile: RouteProfile,
  along: number,
  second: number,
): ReturnType<typeof sceneFrame> {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: {
      ...start,
      ride: { ...start.ride, distance: metres(along) },
      elapsed: seconds(second),
      ridden: seconds(second),
    },
    people: PEOPLE_NEAR_MAX,
  });
}

/** Every barrier's back face from the road's centreline: the line no spectator may be inside. */
const BARRIER_BACK = ROAD_WIDTH_METRES / 2 + BARRIER_OFFSET_METRES + BARRIER_THICKNESS_METRES / 2;

/** Which side of the road at a stand a point is: `+1` the rider's right. */
function sideOf(line: PlacedStand, x: number, z: number): number {
  return Math.sign(-line.headingZ * (x - line.x) + line.headingX * (z - line.z));
}

describe('sitters on the benches — #3285', () => {
  const origin = corridorOrigin(FARMLAND);
  const streets = streetsAt(FARMLAND, origin, scatterSeed(FARMLAND), 0, FARMLAND.totalDistance);
  const benches = streets.flatMap((street) =>
    street.furniture.filter((item) => item.kind === 'bench'),
  );
  const sitters = benchSitters(streets);

  it('sits somebody on some benches and not on others, one or two to a bench', () => {
    expect(benches.length).toBeGreaterThan(4);
    expect(sitters.length).toBeGreaterThan(0);
    const per = benches.map(
      (bench) =>
        sitters.filter((sitter) => Math.hypot(sitter.x - bench.x, sitter.z - bench.z) < 1).length,
    );
    expect(per.every((count) => count <= 2)).toBe(true);
    expect(per.some((count) => count === 0)).toBe(true);
    expect(per.reduce((sum, count) => sum + count, 0)).toBe(sitters.length);
  });

  it('puts a sitter’s hips on the drawn seat and their feet on the pavement the bench stands on, within 1 cm', () => {
    const seat = drawnSeat();
    for (const sitter of sitters) {
      const bench = benches.find(
        (each) => Math.hypot(sitter.x - each.x, sitter.z - each.z) < 1,
      ) as FurnitureItem;
      expect(bench).toBeDefined();
      expect(sitter.doing).toBe('sit');
      // The soles on the pavement's top, which the bench's own foot is on.
      expect(sitter.y).toBe(bench.y);
      // The hips on the seat the renderer draws: the control is a raised bench.
      const hips = sitter.y + sitSeatShare(sitter.phase) * sitter.height;
      expect(Math.abs(hips - (bench.y + seat.top)), `${String(sitter.height)} m tall`).toBeLessThan(
        0.01,
      );
      // Over the seat, between its back and its front, and inside its ends.
      const local = inBenchFrame(bench, sitter.x, sitter.z);
      expect(local.out).toBeCloseTo(BENCH_SITTER_PLACES.back, 6);
      expect(local.out).toBeGreaterThan(seat.back);
      expect(local.out).toBeLessThan(seat.front);
      expect(Math.abs(local.along)).toBeLessThan(seat.half - PERSON_HALF_WIDTH_METRES / 2);
      // Facing the road, as the bench does.
      expect(sitter.yaw).toBe(bench.rotation);
    }
  });

  it('puts two sitters on one bench a seat apart, never on top of each other', () => {
    for (const bench of benches) {
      const on = sitters.filter((sitter) => Math.hypot(sitter.x - bench.x, sitter.z - bench.z) < 1);
      if (on.length < 2) continue;
      const [a, b] = on as [StillSpot, StillSpot];
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0.9, 6);
    }
  });
});

describe('spectators at a gantry — #3285', () => {
  const north = northRoute(3_000, () => 40);
  const circuit = circuitRoute(200);

  for (const [name, profile] of [
    ['a straight start', north],
    ['a lap race’s line on a circuit', circuit],
  ] as const) {
    it(`stands them on both verges of ${name}, all outside the barrier line and off the road`, () => {
      const frame = frameAt(profile, 0, 30);
      const gantries = frame.lines.filter((line) => line.stand.kind === 'gantry');
      expect(gantries.length).toBeGreaterThan(0);
      const line = gantries[0] as PlacedStand;
      const spectators = gantrySpectators(frame.lines);
      expect(spectators.length).toBeGreaterThan(8);
      const origin = corridorOrigin(profile);
      const sides = new Set<number>();
      for (const person of spectators) {
        expect(person.on).toBe('spectator');
        sides.add(sideOf(line, person.x, person.z));
        // Their shoulder outside the barrier's back face, measured to ANY stretch of the drawn road.
        const off = distanceToDrawnRoad(profile, origin, person.x, person.z, 30);
        expect(off - PERSON_HALF_WIDTH_METRES).toBeGreaterThan(BARRIER_BACK);
        expect(off).toBeGreaterThan(PERSON_CLEARANCE_METRES);
        // Behind the barriers, not out in the fields.
        expect(off).toBeLessThan(BARRIER_BACK + 2.5);
      }
      expect([...sides].sort()).toEqual([-1, 1]);
    });
  }

  it('peoples a line placed twice — two laps’ copies of a short circuit’s — once', () => {
    const frame = frameAt(circuitRoute(60), 0, 30);
    const gantries = frame.lines.filter((line) => line.stand.kind === 'gantry');
    const once = gantrySpectators(gantries.slice(0, 1));
    expect(gantrySpectators([...gantries, ...gantries])).toEqual(once);
  });

  it('faces them to the road, and claps only some of them, only while the rider is near', () => {
    const frame = frameAt(north, 0, 30);
    const line = frame.lines.find((each) => each.stand.kind === 'gantry') as PlacedStand;
    const spectators = gantrySpectators(frame.lines);
    for (const spot of spectators) {
      const facingX = Math.sin(spot.yaw);
      const facingZ = Math.cos(spot.yaw);
      // Toward the road: against the side they stand on.
      const side = sideOf(line, spot.x, spot.z);
      expect(side * (-line.headingZ * facingX + line.headingX * facingZ)).toBeLessThan(-0.9);
    }
    const near = stillPeopleAt([spectators], { x: line.x, z: line.z, seconds: 12 });
    const clapping = near.filter((person) => person.gait === 'clap');
    expect(clapping.length).toBeGreaterThan(0);
    expect(clapping.length).toBeLessThan(near.length);
    for (const person of clapping)
      expect(person.distance).toBeLessThanOrEqual(SPECTATOR_CLAP_METRES);
    // The rider 100 m on: everybody still there, nobody clapping.
    const far = stillPeopleAt([spectators], {
      x: line.x + line.headingX * 100,
      z: line.z + line.headingZ * 100,
      seconds: 12,
    });
    expect(far.length).toBe(spectators.length);
    expect(far.every((person) => person.gait === 'stand')).toBe(true);
  });

  it('draws them in the frame’s people, behind the barriers, the walkers’ budget held', () => {
    const frame = frameAt(north, 0, 30);
    const people = frame.people as { near: readonly Person[]; far: readonly Person[] };
    const spectators = [...people.near, ...people.far].filter(
      (person) => person.on === 'spectator',
    );
    expect(spectators.length).toBeGreaterThan(0);
    expect(people.near.length).toBeLessThanOrEqual(PEOPLE_NEAR_MAX);
    expect(people.far.length).toBeLessThanOrEqual(PEOPLE_FAR_MAX);
    const origin = corridorOrigin(north);
    for (const person of spectators) {
      expect(distanceToDrawnRoad(north, origin, person.x, person.z, 30)).toBeGreaterThan(
        BARRIER_BACK + PERSON_HALF_WIDTH_METRES,
      );
    }
  });
});

/** A synthetic shop front: a wall `width` long at `z = 10`, its apron `depth` deep toward the road. */
function shopFront(
  x: number,
  width: number,
  depth: number,
  shop: ShopFrontPlan['shop'],
): ShopFrontPlan {
  const ring: number[] = [];
  const stations = 4;
  for (let at = 0; at < stations; at += 1) ring.push(x + (width * at) / (stations - 1), 10);
  for (let at = stations - 1; at >= 0; at -= 1) {
    ring.push(x + (width * at) / (stations - 1), 10 - depth);
  }
  return { apron: Float32Array.from(ring), shop };
}

describe('standers at the shop fronts — #3285', () => {
  const plain = { front: true, awning: false };
  const awning = { front: true, awning: true };
  const plans = Array.from({ length: 400 }, (_, index) =>
    shopFront(index * 20, 12, 4, index % 2 === 0 ? plain : awning),
  );
  const standers = shopStanders(plans);

  it('stands them on the apron, out from the wall and clear of the kerb', () => {
    expect(standers.length).toBeGreaterThan(0);
    for (const stander of standers) {
      expect(stander.on).toBe('shop-front');
      expect(stander.doing).toBe('stand');
      const out = 10 - stander.z;
      expect(out).toBeGreaterThanOrEqual(SHOP_OUT_METRES[0] - 1e-5);
      expect(out).toBeLessThanOrEqual(SHOP_OUT_METRES[1] + 1e-5);
      expect(4 - out).toBeGreaterThanOrEqual(SHOP_KERB_CLEAR_METRES);
      const plan = Math.floor(stander.x / 20);
      expect(stander.x - plan * 20).toBeGreaterThanOrEqual(0);
      expect(stander.x - plan * 20).toBeLessThanOrEqual(12);
    }
  });

  it('is busier at a front with an awning — every café’s — than at a plain one', () => {
    const at = (kind: 'plain' | 'awning'): number =>
      standers.filter((stander) => (Math.floor(stander.x / 20) % 2 === 0) === (kind === 'plain'))
        .length;
    expect(at('awning')).toBeGreaterThan(1.5 * at('plain'));
    expect(at('plain')).toBeGreaterThan(0);
    // A plain front has one stander at most; a café's a small group.
    const per = new Map<number, number>();
    for (const stander of standers) {
      const plan = Math.floor(stander.x / 20);
      per.set(plan, (per.get(plan) ?? 0) + 1);
    }
    const most = (kind: 0 | 1): number =>
      Math.max(...[...per].filter(([plan]) => plan % 2 === kind).map(([, count]) => count));
    expect(most(0)).toBe(1);
    expect(most(1)).toBe(SHOP_GROUP_MOST);
  });

  it('stands nobody where there is no shop front or no apron, and nobody nearer a shallow kerb', () => {
    expect(
      shopStanders(plans.map((plan) => ({ ...plan, shop: { front: false, awning: true } }))),
    ).toEqual([]);
    expect(shopStanders(plans.map((plan) => ({ ...plan, apron: new Float32Array(0) })))).toEqual(
      [],
    );
    const shallow = shopStanders(plans.map((_, index) => shopFront(index * 20, 12, 0.7, awning)));
    expect(shallow).toEqual([]);
  });
});

describe('the budget, and the same people every time — #3285', () => {
  const ALONG_Z = (): number => 100;
  const options = (extra: Partial<PeopleOptions> = {}): PeopleOptions => ({
    x: 0,
    z: 200,
    seconds: 5,
    near: PEOPLE_NEAR_MAX,
    rule: true,
    road: ALONG_Z,
    ground: () => 0,
    ...extra,
  });
  const straight = (x: number, length: number): number[] => {
    const points: number[] = [];
    for (let z = 0; z <= length; z += 2) points.push(x, 0, z);
    return points;
  };
  const still = (count: number, from: number): Person[] =>
    Array.from({ length: count }, (_, at) => ({
      x: 5,
      y: 0,
      z: from + at,
      yaw: 0,
      gait: 'stand',
      phase: 0,
      height: 1.7,
      look: personLook(at),
      distance: 0,
      on: 'shop-front',
    }));

  it('counts still people against PEOPLE_NEAR_MAX and PEOPLE_FAR_MAX, nearest first', () => {
    const busy = walkLine(straight(10, 400), 3, 'footway', 1, 9, ALONG_Z, true);
    const { near, far } = peopleAt(busy, options({ still: still(10, 198) }));
    expect(near.length).toBe(PEOPLE_NEAR_MAX);
    expect(far.length).toBe(PEOPLE_FAR_MAX);
    // The ten still people are the nearest, so they are drawn, as bodies, with six walkers.
    expect(near.filter((person) => person.on === 'shop-front').length).toBe(10);
    for (let at = 1; at < near.length; at += 1) {
      expect((near[at] as Person).distance).toBeGreaterThanOrEqual(
        (near[at - 1] as Person).distance,
      );
    }
    // Their distance is the frame's own.
    for (const person of near.filter((each) => each.on === 'shop-front')) {
      expect(person.distance).toBeCloseTo(Math.hypot(person.x, person.z - 200), 9);
    }
  });

  it('holds still people off the road by the rule, and draws none where the rung draws nobody', () => {
    const onTheRoad = still(3, 199);
    const road = (): number => 1;
    expect(peopleAt([], options({ still: onTheRoad, road })).near).toEqual([]);
    expect(peopleAt([], options({ still: onTheRoad, road, rule: false })).near.length).toBe(3);
    expect(peopleAt([], options({ still: onTheRoad, near: 0 })).near).toEqual([]);
  });

  it('gives the same ride and seed the same people in the same poses, and their seeded clothes', () => {
    const north = northRoute(3_000, () => 40);
    const a = frameAt(north, 0, 30).people;
    const b = frameAt(north, 0, 30).people;
    expect(b).toEqual(a);
    const still = [...(a?.near ?? []), ...(a?.far ?? [])].filter(
      (person) => person.on === 'spectator',
    );
    expect(still.length).toBeGreaterThan(0);
    // Their clothes are their own, and not all one person's.
    const tops = new Set(still.map((person) => person.look.top));
    expect(tops.size).toBeGreaterThan(1);
    // A second later the same people, where they were, in a pose of the clock.
    const later = frameAt(north, 0, 31).people;
    const there = [...(later?.near ?? []), ...(later?.far ?? [])].filter(
      (person) => person.on === 'spectator',
    );
    expect(there.map((person) => [person.x, person.z, person.look])).toEqual(
      still.map((person) => [person.x, person.z, person.look]),
    );
  });
});
