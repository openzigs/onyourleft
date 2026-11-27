// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a parked car stands — #3278 (`parked-cars.ts`), asked of the planner
 * itself on synthetic ground: a ridden road along `x = 0`, level ground, and
 * houses, streets and footways written as arithmetic. No real place.
 *
 * Whether a place has a car is hashed, so each rule is read over
 * {@link SEEDS} rides: a place that may have a car has one on some of them,
 * and a place that may not has one on none — with the same place made
 * allowed as the control, so "none" is never read off a place that would
 * have had none anyway.
 *
 * `parked-cars-scene.test.ts` reads the same cars back off `sceneFrame`, on a
 * route ride, an open-world ride and a lap race.
 */

import { describe, expect, it } from 'vitest';

import type { PathFeature, StreetFeature } from '@onyourleft/map-features';

import { SIDE_ROAD_WIDTHS, type WidthClass } from './cross-streets';
import type { NearbyStreetPiece } from './nearby-streets';
import {
  NO_PARKED_CARS,
  PARKED_CAR_APRON_DOOR_METRES,
  PARKED_CAR_APRON_KERB_METRES,
  PARKED_CAR_BOX,
  PARKED_CAR_CELL_METRES,
  PARKED_CAR_FAR_METRES,
  PARKED_CAR_FOOTWAY_METRES,
  PARKED_CAR_GAP_METRES,
  PARKED_CAR_GARAGE_GAP_METRES,
  PARKED_CAR_KERB_END_METRES,
  PARKED_CAR_KERB_GAP_METRES,
  PARKED_CAR_NEAR_METRES,
  PARKED_CAR_NOSE_IN_SHARE,
  PARKED_CAR_ROAD_CLEAR_METRES,
  PARKED_CAR_SHARES,
  PARKED_CAR_STREET_MARGIN_METRES,
  PARKED_CAR_WALL_METRES,
  PARKED_CARS_MAX,
  PARKED_CARS_NEAR_MAX,
  parkedCarBody,
  parkedCarCorners,
  parkedCarPaint,
  parkedCarsAt,
  parkedCarsSeenFrom,
  parkedCarToSegment,
  type ParkedCar,
  type ParkedCarPlot,
  type ParkedCarSite,
} from './parked-cars';
import { ROAD_WIDTH_METRES } from './terrain';

/** The rides each rule is read over. */
const SEEDS = Array.from({ length: 60 }, (_, index) => 1_000 + index * 7_919);

/** How far out from the road's middle a driveway ends: the carriageway's edge and 0.1 m, as #1588 lays it. */
const DRIVEWAY_END = ROAD_WIDTH_METRES / 2 + 0.1;

/**
 * A house on the road's right, its front wall `wall` metres out and its
 * middle at `z`, 12 m along the road and 8 m deep, with a garage bay 3.3 m
 * wide at the low end of its front and a driveway `width` wide straight out
 * to the road's edge — its corners in `footprint-buildings.ts`
 * §`drivewayRing`'s order: the garage's two, then the road's two.
 */
function house(z: number, wall: number, width = 3): ParkedCarPlot {
  const bay = z - 4.5;
  return {
    centroid: { x: wall + 4, z },
    footprint: Float32Array.of(wall, z - 6, wall + 8, z - 6, wall + 8, z + 6, wall, z + 6),
    garage: true,
    driveway: Float32Array.of(
      wall,
      bay - width / 2,
      wall,
      bay + width / 2,
      DRIVEWAY_END,
      bay + width / 2,
      DRIVEWAY_END,
      bay - width / 2,
    ),
    apron: new Float32Array(0),
  };
}

/** The synthetic street: ten houses with driveways, 30 m apart from `z` = 100, 14 m back. */
const STREET: readonly ParkedCarPlot[] = Array.from({ length: 10 }, (_, index) =>
  house(100 + index * 30, 14),
);

/** A stretch of mapped street along `points`, as `nearby-streets.ts` cuts one. */
function piece(
  widthClass: WidthClass,
  points: readonly (readonly [number, number])[],
): NearbyStreetPiece {
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  return {
    widthClass,
    line: Float32Array.from(points.flat()),
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** A mapped street along `points`, on the ground: `residential` unless `detail` says otherwise. */
function street(
  points: readonly (readonly [number, number])[],
  detail = 'residential',
  kind = 'minor_road',
): StreetFeature {
  return { kind, kindDetail: detail, grade: 'ground', line: Float32Array.from(points.flat()) };
}

/** A site on level ground beside a road along `x = 0`, with `more` of it said. */
function site(seed: number, more: Partial<ParkedCarSite> = {}): ParkedCarSite {
  const plots = more.plots ?? STREET;
  return {
    seed,
    plots,
    radii: plots.map(() => 16),
    pieces: [],
    streets: [],
    paths: [],
    kerbs: true,
    road: (x) => Math.abs(x),
    ground: () => () => 0,
    ...more,
  };
}

/** Every car within reach of the middle of the synthetic street. */
function carsOf(seed: number, more: Partial<ParkedCarSite> = {}, z = 235): readonly ParkedCar[] {
  return parkedCarsAt(site(seed, more), 0, z).cars;
}

/** Whether a car stands on `plot`'s driveway: its middle inside the driveway's outline. */
function onDrivewayOf(car: ParkedCar, plot: ParkedCarPlot): boolean {
  const ring = plot.driveway;
  const xs = [ring[0], ring[2], ring[4], ring[6]] as number[];
  const zs = [ring[1], ring[3], ring[5], ring[7]] as number[];
  return (
    car.x > Math.min(...xs) &&
    car.x < Math.max(...xs) &&
    car.z > Math.min(...zs) &&
    car.z < Math.max(...zs)
  );
}

/** How many of {@link SEEDS} put a car on `plot`'s driveway. */
function ridesWithACarOn(plot: ParkedCarPlot, more: Partial<ParkedCarSite> = {}): number {
  return SEEDS.filter((seed) => carsOf(seed, more).some((car) => onDrivewayOf(car, plot))).length;
}

/** How far a car's box is from a ring's outline, metres: 0 where they touch or cross. */
function toRing(car: ParkedCar, ring: ArrayLike<number>): number {
  const n = ring.length / 2;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    nearest = Math.min(
      nearest,
      parkedCarToSegment(
        car,
        ring[j * 2] as number,
        ring[j * 2 + 1] as number,
        ring[i * 2] as number,
        ring[i * 2 + 1] as number,
      ),
    );
  }
  return nearest;
}

/** How far apart two cars' boxes are, metres: 0 where they touch or cross. */
function apart(a: ParkedCar, b: ParkedCar): number {
  const corners = parkedCarCorners(b);
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const [jx, jz] = corners[j] as readonly [number, number];
    const [ix, iz] = corners[i] as readonly [number, number];
    nearest = Math.min(nearest, parkedCarToSegment(a, jx, jz, ix, iz));
  }
  return nearest;
}

describe('a street of ten houses with driveways — #3278', () => {
  it('has cars on some of its driveways and not on all, each on its driveway’s own line', () => {
    const counts = SEEDS.map((seed) => carsOf(seed).length);
    // Some on every ride, and on some rides a driveway left empty.
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.min(...counts)).toBeLessThan(STREET.length);
    // About the driveways' share of them, over all the rides.
    const share = counts.reduce((sum, count) => sum + count, 0) / (SEEDS.length * STREET.length);
    expect(share).toBeGreaterThan(PARKED_CAR_SHARES.driveway - 0.1);
    expect(share).toBeLessThan(PARKED_CAR_SHARES.driveway + 0.1);
    for (const seed of SEEDS.slice(0, 10)) {
      for (const car of carsOf(seed)) {
        expect(car.spot).toBe('driveway');
        const plot = STREET.find((each) => onDrivewayOf(car, each));
        if (plot === undefined) throw new Error('a car stands on no driveway');
        // On the driveway's middle line, the garage's gap and half its length out from the door.
        expect(car.z).toBeCloseTo(plot.centroid.z - 4.5, 9);
        expect(14 - car.x).toBeCloseTo(PARKED_CAR_GARAGE_GAP_METRES + PARKED_CAR_BOX.halfLength, 9);
        // Along the driveway, one way or the other.
        expect(Math.abs(Math.sin(car.heading))).toBeCloseTo(1, 9);
      }
    }
  });

  it('parks most nose in and the rest nose out', () => {
    const cars = SEEDS.flatMap((seed) => carsOf(seed));
    // The houses are on the road's right, so nose in is toward `+x`.
    const noseIn = cars.filter((car) => Math.sin(car.heading) > 0).length / cars.length;
    expect(noseIn).toBeGreaterThan(PARKED_CAR_NOSE_IN_SHARE - 0.1);
    expect(noseIn).toBeLessThan(PARKED_CAR_NOSE_IN_SHARE + 0.1);
  });

  it('has no car whose box overlaps a house, the road, a side road’s mouth or another car', () => {
    // A side road leaves the road between the second and third houses, its
    // mouth beside the third house's driveway; a shed stands on the sixth's;
    // the eighth is so near the road that its car would stand in it; and the
    // tenth has a neighbour whose driveway runs into its own.
    const besideMouth = house(160, 14);
    const mouth = street([
      [0, 153.5],
      [63.5, 153.5],
    ]);
    const shedded = house(250, 14);
    const shed: ParkedCarPlot = {
      centroid: { x: 11, z: 245.5 },
      footprint: Float32Array.of(10, 244.5, 12, 244.5, 12, 246.5, 10, 246.5),
      garage: false,
      driveway: new Float32Array(0),
      apron: new Float32Array(0),
    };
    const short = house(310, 6.6);
    const crowded = house(370, 14);
    const crowding: ParkedCarPlot = { ...house(371.5, 14), footprint: house(385, 14).footprint };
    const plots = [
      ...STREET.filter((_, index) => ![2, 5, 7, 9].includes(index)),
      besideMouth,
      shedded,
      shed,
      short,
      crowded,
      crowding,
    ];
    const more = { plots, streets: [mouth] };
    let cars = 0;
    for (const seed of SEEDS) {
      const found = carsOf(seed, more);
      cars += found.length;
      for (const car of found) {
        for (const plot of plots) {
          expect(toRing(car, plot.footprint)).toBeGreaterThanOrEqual(PARKED_CAR_WALL_METRES);
        }
        // Off the ridden road: the carriageway and a metre.
        for (const [x] of parkedCarCorners(car)) {
          expect(Math.abs(x)).toBeGreaterThanOrEqual(PARKED_CAR_ROAD_CLEAR_METRES);
        }
        // Off the side road's surface.
        expect(parkedCarToSegment(car, 3.5, 153.5, 63.5, 153.5)).toBeGreaterThanOrEqual(
          SIDE_ROAD_WIDTHS.minor / 2 + PARKED_CAR_STREET_MARGIN_METRES,
        );
        for (const other of found) {
          if (other !== car)
            expect(apart(car, other)).toBeGreaterThanOrEqual(PARKED_CAR_GAP_METRES);
        }
      }
    }
    expect(cars).toBeGreaterThan(SEEDS.length);
    // Each place that may not have a car has none on any ride…
    expect(ridesWithACarOn(besideMouth, more)).toBe(0);
    expect(ridesWithACarOn(shedded, more)).toBe(0);
    expect(ridesWithACarOn(short, more)).toBe(0);
    // …and has one on some rides once what stood in the way is gone: THE CONTROLS.
    expect(ridesWithACarOn(besideMouth, { plots })).toBeGreaterThan(10);
    expect(
      ridesWithACarOn(shedded, { plots: plots.filter((plot) => plot !== shed) }),
    ).toBeGreaterThan(10);
    expect(ridesWithACarOn(house(310, 14), { plots: [house(310, 14)] })).toBeGreaterThan(10);
    // Two driveways that run into each other never both have one, and each has on some rides.
    const both = SEEDS.filter((seed) => {
      const found = carsOf(seed, more);
      return (
        found.some((car) => Math.abs(car.z - 365.5) < 0.01) &&
        found.some((car) => Math.abs(car.z - 367) < 0.01)
      );
    });
    expect(both).toEqual([]);
    const either = SEEDS.filter((seed) =>
      carsOf(seed, more).some(
        (car) => Math.abs(car.z - 365.5) < 0.01 || Math.abs(car.z - 367) < 0.01,
      ),
    );
    // More rides than either driveway's share alone: the other's car is kept where the first has none.
    expect(either.length).toBeGreaterThan(SEEDS.length * PARKED_CAR_SHARES.driveway);
  });

  it('has none on a driveway too short or too narrow for the car, or one that is no garage’s', () => {
    // 4.9 m of driveway: 0.2 m short of the gap and the box.
    const short = house(100, DRIVEWAY_END + PARKED_CAR_GARAGE_GAP_METRES + 4.3);
    expect(ridesWithACarOn(short, { plots: [short], road: () => 100 })).toBe(0);
    const narrow = house(100, 14, 1.9);
    expect(ridesWithACarOn(narrow, { plots: [narrow] })).toBe(0);
    // A fuel station's forecourt is filed as a driveway, with no garage.
    const forecourt = { ...house(100, 14), garage: false };
    expect(ridesWithACarOn(forecourt, { plots: [forecourt] })).toBe(0);
    // THE CONTROL: the same house as it was.
    expect(ridesWithACarOn(house(100, 14), { plots: [house(100, 14)] })).toBeGreaterThan(10);
  });

  it('keeps a car’s side a hand off a wall beside the driveway', () => {
    const plot = house(100, 14);
    const bay = 100 - 4.5;
    /** A wall along the driveway, `gap` metres off the car's side. */
    const besideTheCar = (gap: number): ParkedCarPlot => {
      const from = bay + PARKED_CAR_BOX.halfWidth + gap;
      return {
        centroid: { x: 10.5, z: from + 1 },
        footprint: Float32Array.of(9, from, 12, from, 12, from + 2, 9, from + 2),
        garage: false,
        driveway: new Float32Array(0),
        apron: new Float32Array(0),
      };
    };
    expect(PARKED_CAR_WALL_METRES).toBe(0.3);
    expect(ridesWithACarOn(plot, { plots: [plot, besideTheCar(0.2)] })).toBe(0);
    // THE CONTROL: the same wall a hand further off.
    expect(ridesWithACarOn(plot, { plots: [plot, besideTheCar(0.4)] })).toBeGreaterThan(10);
  });

  it('keeps a car off the near end of a long building whose middle is far off, whatever reach is said for it', () => {
    const plot = house(100, 14);
    const bay = 100 - 4.5;
    /** A block 60 m long beside the driveway, its end wall `gap` metres off the car's side. */
    const block = (gap: number): ParkedCarPlot => {
      const from = bay + PARKED_CAR_BOX.halfWidth + gap;
      return {
        centroid: { x: 10.5, z: from + 30 },
        footprint: Float32Array.of(9, from, 12, from, 12, from + 60, 9, from + 60),
        garage: false,
        driveway: new Float32Array(0),
        apron: new Float32Array(0),
      };
    };
    // Its reach as `mapped-buildings.ts` says it: its farthest corner from its middle.
    const said = { radii: [16, Math.hypot(1.5, 30)] };
    expect(ridesWithACarOn(plot, { plots: [plot, block(0.2)], ...said })).toBe(0);
    // With no reach said for it, it is still a wall.
    expect(ridesWithACarOn(plot, { plots: [plot, block(0.2)], radii: [16] })).toBe(0);
    // THE CONTROL: the same block a hand further off.
    expect(ridesWithACarOn(plot, { plots: [plot, block(0.4)], ...said })).toBeGreaterThan(10);
  });

  it('measures a line passing a corner of a car’s box from that corner, whichever of the four', () => {
    // Nose along +z: the box is its half-width either way in x and its half-length in z.
    const car = { x: 3, z: 40, heading: 0 };
    const { halfLength, halfWidth } = PARKED_CAR_BOX;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cornerX = car.x + sx * halfWidth;
        const cornerZ = car.z + sz * halfLength;
        // A line across the corner's diagonal, a metre out from it and 5 m either way.
        const out = Math.SQRT1_2;
        const ax = cornerX + sx * out + sx * out * 5;
        const az = cornerZ + sz * out - sz * out * 5;
        const bx = cornerX + sx * out - sx * out * 5;
        const bz = cornerZ + sz * out + sz * out * 5;
        expect(parkedCarToSegment(car, ax, az, bx, bz)).toBeCloseTo(1, 9);
        // And one through the corner touches it.
        expect(
          parkedCarToSegment(
            car,
            cornerX + sx * 2,
            cornerZ - sz * 2,
            cornerX - sx * 2,
            cornerZ + sz * 2,
          ),
        ).toBe(0);
      }
    }
  });

  it('has none where another stretch of the ridden road passes the driveway', () => {
    // A hairpin's other leg 8 m out, along the road: across the driveway's
    // middle, where the first leg's own carriageway is well clear of the car.
    const plot = house(100, 14);
    const hairpin = (x: number): number => Math.min(Math.abs(x), Math.abs(x - 8));
    expect(ridesWithACarOn(plot, { plots: [plot], road: hairpin })).toBe(0);
    // And the verge's metre: a driveway that holds a car with its nose 3.9 m
    // from the road's middle, off the carriageway and inside the verge.
    const tight = house(100, 9);
    expect(9 - PARKED_CAR_GARAGE_GAP_METRES - 2 * PARKED_CAR_BOX.halfLength).toBeCloseTo(3.9, 9);
    expect(ridesWithACarOn(tight, { plots: [tight] })).toBe(0);
    // THE CONTROLS: the one leg, and a road a metre further off.
    expect(ridesWithACarOn(plot, { plots: [plot] })).toBeGreaterThan(10);
    expect(
      ridesWithACarOn(tight, { plots: [tight], road: (x) => Math.abs(x) + 1 }),
    ).toBeGreaterThan(10);
  });

  it('stands a car behind a pavement the road says is laid there', () => {
    // A 3.5 m pavement on that side reads the road 2.7 m nearer (`scene.ts`).
    const paved = { road: (x: number) => Math.abs(x) - 2.7 };
    const near = house(100, 11);
    const far = house(100, 15.5);
    expect(ridesWithACarOn(near, { plots: [near] })).toBeGreaterThan(10);
    expect(ridesWithACarOn(near, { plots: [near], ...paved })).toBe(0);
    expect(ridesWithACarOn(far, { plots: [far], ...paved })).toBeGreaterThan(10);
  });

  it('has none where a mapped footway crosses the driveway, and none on water', () => {
    const plot = house(100, 14);
    const sidewalk: PathFeature = {
      kind: 'path',
      kindDetail: 'sidewalk',
      line: Float32Array.of(9.5, 60, 9.5, 140),
    };
    expect(ridesWithACarOn(plot, { plots: [plot], paths: [sidewalk] })).toBe(0);
    // A sidewalk nearer the kerb than the car's nose is no reason.
    const kerbside: PathFeature = { ...sidewalk, line: Float32Array.of(5.5, 60, 5.5, 140) };
    expect(ridesWithACarOn(plot, { plots: [plot], paths: [kerbside] })).toBeGreaterThan(10);
    for (const seed of SEEDS) {
      for (const car of carsOf(seed, { plots: [plot], paths: [kerbside] })) {
        expect(parkedCarToSegment(car, 5.5, 60, 5.5, 140)).toBeGreaterThanOrEqual(
          PARKED_CAR_FOOTWAY_METRES,
        );
      }
    }
    // A farm track is no footway (`footways.ts` §`isFootway`).
    const track: PathFeature = { ...sidewalk, kindDetail: 'track' };
    expect(ridesWithACarOn(plot, { plots: [plot], paths: [track] })).toBeGreaterThan(10);
    // Water, or ground that is not drawn, under the car or either end of it.
    expect(ridesWithACarOn(plot, { plots: [plot], ground: () => undefined })).toBe(0);
    const wetNose = (x: number): ((x: number, z: number) => number) | undefined =>
      x > 11.5 ? undefined : () => 0;
    expect(ridesWithACarOn(plot, { plots: [plot], ground: wetNose })).toBe(0);
  });

  it('stands each car on its ground, tipped up the slope under it', () => {
    // Ground rising 1 in 10 away from the road.
    const slope = { ground: () => (x: number) => x / 10 };
    const cars = SEEDS.flatMap((seed) => carsOf(seed, slope));
    expect(cars.length).toBeGreaterThan(SEEDS.length);
    for (const car of cars) {
      expect(car.y).toBeCloseTo(car.x / 10, 9);
      // Nose in is nose uphill.
      expect(car.pitch).toBeCloseTo(Math.sign(Math.sin(car.heading)) * Math.atan(0.1), 9);
    }
    for (const car of carsOf(SEEDS[0] as number)) {
      expect(car.y).toBe(0);
      expect(car.pitch).toBe(0);
    }
  });
});

describe('the same street on every ride — #3278', () => {
  it('gives the same cars for the same site and seed, and others for another seed', () => {
    const seed = SEEDS[3] as number;
    expect(carsOf(seed)).toEqual(carsOf(seed));
    // A site built again from the same numbers, not the same objects.
    const again = Array.from({ length: 10 }, (_, index) => house(100 + index * 30, 14));
    expect(carsOf(seed, { plots: again })).toEqual(carsOf(seed));
    // The plots in another order: nothing is read off the order they were found in.
    expect(carsOf(seed, { plots: [...again].reverse() })).toEqual(carsOf(seed));
    const looks = (found: readonly ParkedCar[]): string =>
      found
        .map((car) => `${String(car.z)}:${String(car.heading)}:${String(car.look)}`)
        .sort()
        .join();
    const different = SEEDS.filter((other) => looks(carsOf(other)) !== looks(carsOf(seed)));
    expect(different.length).toBeGreaterThanOrEqual(SEEDS.length - 2);
  });

  it('gives every camera place in a cell the same answer', () => {
    const seed = SEEDS[5] as number;
    const from = Math.floor(235 / PARKED_CAR_CELL_METRES) * PARKED_CAR_CELL_METRES;
    const first = parkedCarsAt(site(seed), 0.1, from + 0.1).cars;
    expect(first.length).toBeGreaterThan(0);
    expect(parkedCarsAt(site(seed), 15.9, from + 15.9).cars).toEqual(first);
  });

  it('keeps every car it drew as the camera moves on, but at the edge of its reach', () => {
    // A long street of houses on both sides, some driveways running into a neighbour's.
    const long: ParkedCarPlot[] = [];
    for (let index = 0; index < 60; index += 1) {
      long.push(house(index * 14, 14), house(index * 14 + 1.8, 14));
    }
    const key = (car: ParkedCar): string => `${String(car.x)},${String(car.z)},${String(car.look)}`;
    for (const seed of SEEDS.slice(0, 12)) {
      // No cap in the way of the comparison: read what MAY stand, by its place.
      let before: readonly ParkedCar[] | undefined;
      let beforeZ = 0;
      for (let z = 200; z <= 600; z += PARKED_CAR_CELL_METRES) {
        const now = parkedCarsAt(site(seed, { plots: long }), 0, z).cars;
        const middle = (Math.floor(z / PARKED_CAR_CELL_METRES) + 0.5) * PARKED_CAR_CELL_METRES;
        if (before !== undefined && now.length < PARKED_CARS_MAX) {
          const keys = new Set(now.map(key));
          for (const car of before) {
            const stillInReach = Math.hypot(car.x, car.z - middle) <= PARKED_CAR_FAR_METRES;
            if (stillInReach)
              expect(keys.has(key(car)), `${String(seed)} at ${String(z)}`).toBe(true);
          }
        }
        before = now.length < PARKED_CARS_MAX ? now : undefined;
        beforeZ = z;
      }
      expect(beforeZ).toBe(600);
    }
  });

  it('chooses each car’s body and paint from its own hash, the two apart', () => {
    const cars = SEEDS.flatMap((seed) => carsOf(seed));
    const bodies = new Set(cars.map((car) => parkedCarBody(car, 3)));
    const paints = new Set(cars.map((car) => parkedCarPaint(car, 8)));
    expect([...bodies].sort()).toEqual([0, 1, 2]);
    expect([...paints].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Not in step: every body is seen in more than one paint.
    for (const body of bodies) {
      const worn = new Set(
        cars.filter((car) => parkedCarBody(car, 3) === body).map((car) => parkedCarPaint(car, 8)),
      );
      expect(worn.size).toBeGreaterThan(4);
    }
    // And with counts that share a factor, where one stream for both would tie
    // a body to two of eight paints.
    for (const body of [0, 1, 2, 3]) {
      const worn = new Set(
        cars.filter((car) => parkedCarBody(car, 4) === body).map((car) => parkedCarPaint(car, 8)),
      );
      expect(worn.size).toBeGreaterThan(4);
    }
    // The same car, the same look, whatever asks.
    const car = cars[0] as ParkedCar;
    expect(parkedCarBody(car, 3)).toBe(parkedCarBody({ look: car.look }, 3));
    expect(parkedCarBody(car, 0)).toBe(0);
    expect(parkedCarPaint(car, 0)).toBe(0);
  });
});

describe('how many cars a frame carries, and at which level — #3278', () => {
  /**
   * Garages both sides of the road, 3.5 m apart on each: far more driveways
   * than a frame may draw. Each is a lock-up 2 m wide behind its own door.
   */
  const DENSE: readonly ParkedCarPlot[] = Array.from({ length: 280 }, (_, index) => {
    const z = index * 1.75;
    const bay = z - 4.5;
    const plot: ParkedCarPlot = {
      ...house(z, 14, 3),
      centroid: { x: 18, z: bay },
      footprint: Float32Array.of(14, bay - 1, 22, bay - 1, 22, bay + 1, 14, bay + 1),
    };
    if (index % 2 === 0) return plot;
    // Mirrored onto the road's left.
    const flip = (ring: Float32Array): Float32Array =>
      ring.map((value, at) => (at % 2 === 0 ? -value : value));
    return {
      ...plot,
      centroid: { x: -plot.centroid.x, z: plot.centroid.z },
      footprint: flip(plot.footprint),
      // Mirrored, its corners are still the garage's two and then the road's two.
      driveway: flip(plot.driveway),
    };
  });

  it('draws no more than its caps, the nearest first and with their wheels', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const cars = carsOf(seed, { plots: DENSE }, 245);
      expect(cars).toHaveLength(PARKED_CARS_MAX);
      const middle = (Math.floor(245 / PARKED_CAR_CELL_METRES) + 0.5) * PARKED_CAR_CELL_METRES;
      const centre = PARKED_CAR_CELL_METRES / 2;
      const off = cars.map((car) => Math.hypot(car.x - centre, car.z - middle));
      expect(off).toEqual([...off].sort((a, b) => a - b));
      const near = cars.filter((car) => car.level === 'near');
      expect(near).toHaveLength(PARKED_CARS_NEAR_MAX);
      // The near ones are the nearest, and none of them beyond the near band.
      expect(cars.slice(0, PARKED_CARS_NEAR_MAX)).toEqual(near);
      for (const car of near) {
        expect(Math.hypot(car.x - centre, car.z - middle)).toBeLessThanOrEqual(
          PARKED_CAR_NEAR_METRES,
        );
      }
      expect(Math.max(...off)).toBeLessThanOrEqual(PARKED_CAR_FAR_METRES);
    }
  });

  it('gives the wheels to the cars nearest the place they are seen from, not the cell asked about', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const planned = parkedCarsAt(site(seed, { plots: DENSE }), 0, 245);
      // The rider, 40 m back down the road from the place the cars were chosen about.
      const [riderX, riderZ] = [0, 205];
      const off = (car: ParkedCar): number => Math.hypot(car.x - riderX, car.z - riderZ);
      const byRider = [...planned.cars].sort((a, b) => off(a) - off(b));
      // As planned, the car beside the rider is one of those left without wheels.
      expect(byRider[0]?.level).toBe('far');
      const seen = parkedCarsSeenFrom(planned, riderX, riderZ);
      // The same cars in the same order, their levels apart.
      expect(seen.cars.map((car) => ({ ...car, level: 'far' }))).toEqual(
        planned.cars.map((car) => ({ ...car, level: 'far' })),
      );
      const near = seen.cars.filter((car) => car.level === 'near');
      expect(near).toHaveLength(PARKED_CARS_NEAR_MAX);
      expect([...near].sort((a, b) => off(a) - off(b))).toEqual(
        byRider.slice(0, PARKED_CARS_NEAR_MAX).map((car) => ({ ...car, level: 'near' })),
      );
      expect(near).toContainEqual({ ...byRider[0], level: 'near' });
      // Asked again from the same place, or one that changes no level, it is the very same list.
      expect(parkedCarsSeenFrom(seen, riderX, riderZ)).toBe(seen);
      expect(parkedCarsSeenFrom(seen, riderX + 0.01, riderZ)).toBe(seen);
      // A car that keeps its level is the very same car.
      const kept = seen.cars.filter((car) => planned.cars.includes(car));
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(seen.cars.length);
    }
  });

  it('gives no car its wheels beyond the near band of the place they are seen from, and answers an empty list itself', () => {
    const planned = parkedCarsAt(site(SEEDS[0] as number, { plots: DENSE }), 0, 245);
    const seen = parkedCarsSeenFrom(planned, 0, 245 - PARKED_CAR_NEAR_METRES);
    const near = seen.cars.filter((car) => car.level === 'near');
    expect(near.length).toBeGreaterThan(0);
    for (const car of near) {
      expect(Math.hypot(car.x, car.z - (245 - PARKED_CAR_NEAR_METRES))).toBeLessThanOrEqual(
        PARKED_CAR_NEAR_METRES,
      );
    }
    // From far off, none has: every car is the body alone.
    const from = parkedCarsSeenFrom(planned, 0, 5_000);
    expect(from.cars).toHaveLength(planned.cars.length);
    expect(from.cars.every((car) => car.level === 'far')).toBe(true);
    expect(parkedCarsSeenFrom(NO_PARKED_CARS, 0, 0)).toBe(NO_PARKED_CARS);
  });

  it('draws a car beyond the near band without its wheels, and none beyond the far one', () => {
    const lone = house(100, 14);
    const seed = SEEDS.find((each) => carsOf(each, { plots: [lone] }, 100).length === 1);
    if (seed === undefined) throw new Error('no ride parks on the lone driveway');
    expect(carsOf(seed, { plots: [lone] }, 100)[0]?.level).toBe('near');
    expect(carsOf(seed, { plots: [lone] }, 100 + PARKED_CAR_NEAR_METRES + 20)[0]?.level).toBe(
      'far',
    );
    expect(carsOf(seed, { plots: [lone] }, 100 + PARKED_CAR_FAR_METRES + 20)).toEqual([]);
  });

  it('answers the one empty view where there is nothing to park on or beside', () => {
    expect(parkedCarsAt(site(1, { plots: [] }), 0, 0)).toBe(NO_PARKED_CARS);
    expect(parkedCarsAt(site(1), 0, 5_000)).toBe(NO_PARKED_CARS);
    expect(NO_PARKED_CARS.cars).toEqual([]);
  });
});

describe('cars at the kerb of a mapped side street — #3278', () => {
  /** A minor street parallel to the road 60 m out, 64 m long, with a house beside its middle. */
  const SIDE = piece('minor', [
    [60, 200],
    [60, 232],
    [60, 264],
  ]);
  const HOUSE: ParkedCarPlot = {
    centroid: { x: 75, z: 232 },
    footprint: Float32Array.of(70, 226, 80, 226, 80, 238, 70, 238),
    garage: false,
    driveway: new Float32Array(0),
    apron: new Float32Array(0),
  };
  /** The map's own line of the same street, running on past both ends of the piece drawn. */
  const SIDE_MAPPED = street([
    [60, 120],
    [60, 232],
    [60, 340],
  ]);
  const kerbCars = (seed: number, more: Partial<ParkedCarSite> = {}): readonly ParkedCar[] =>
    carsOf(seed, { plots: [HOUSE], pieces: [SIDE], streets: [SIDE_MAPPED], ...more }, 232);
  const ridesWithKerbCars = (more: Partial<ParkedCarSite> = {}): number =>
    SEEDS.filter((seed) => kerbCars(seed, more).length > 0).length;

  it('stands them parallel to the street, just inside its edge, along one side, facing its way', () => {
    const half = SIDE_ROAD_WIDTHS.minor / 2;
    const out = half - PARKED_CAR_KERB_GAP_METRES - PARKED_CAR_BOX.halfWidth;
    expect(ridesWithKerbCars()).toBeGreaterThan(SEEDS.length / 2);
    const sides = new Set<number>();
    for (const seed of SEEDS) {
      const cars = kerbCars(seed);
      const side = new Set(cars.map((car) => Math.sign(car.x - 60)));
      // One side of a minor street on any one ride.
      expect(side.size).toBeLessThanOrEqual(1);
      for (const car of cars) {
        expect(car.spot).toBe('kerb');
        expect(Math.abs(car.x - 60)).toBeCloseTo(out, 9);
        // The street runs toward `+z`; its right is `−x`, where a car faces along it.
        expect(Math.cos(car.heading)).toBeCloseTo(car.x < 60 ? 1 : -1, 9);
        // Never within the piece's ends.
        expect(car.z).toBeGreaterThanOrEqual(200 + PARKED_CAR_KERB_END_METRES);
        expect(car.z).toBeLessThanOrEqual(264 - PARKED_CAR_KERB_END_METRES);
        sides.add(Math.sign(car.x - 60));
      }
      for (const car of cars) {
        for (const other of cars) {
          if (other !== car)
            expect(apart(car, other)).toBeGreaterThanOrEqual(PARKED_CAR_GAP_METRES);
        }
      }
    }
    // Either side, over the rides.
    expect(sides.size).toBe(2);
  });

  it('stands them along both sides of a major street, each facing its own way', () => {
    const major = piece('major', [
      [60, 200],
      [60, 264],
    ]);
    const mapped = street(
      [
        [60, 120],
        [60, 340],
      ],
      'primary',
      'major_road',
    );
    const more = { pieces: [major], streets: [mapped] };
    const cars = SEEDS.flatMap((seed) => kerbCars(seed, more));
    const left = cars.filter((car) => car.x > 60);
    const right = cars.filter((car) => car.x < 60);
    expect(left.length).toBeGreaterThan(10);
    expect(right.length).toBeGreaterThan(10);
    for (const car of left) expect(Math.cos(car.heading)).toBeCloseTo(-1, 9);
    for (const car of right) expect(Math.cos(car.heading)).toBeCloseTo(1, 9);
    const both = SEEDS.filter((seed) => {
      const found = kerbCars(seed, more);
      return found.some((car) => car.x > 60) && found.some((car) => car.x < 60);
    });
    expect(both.length).toBeGreaterThan(0);
  });

  it('has none on an open-world ride, on a service road, a track or a bridge, or with no building near', () => {
    expect(ridesWithKerbCars({ kerbs: false })).toBe(0);
    for (const widthClass of ['service', 'track', 'bridleway', 'highway', 'rail'] as const) {
      expect(ridesWithKerbCars({ pieces: [{ ...SIDE, widthClass }] }), widthClass).toBe(0);
    }
    expect(ridesWithKerbCars({ pieces: [{ ...SIDE, deck: true }] })).toBe(0);
    const farHouse = { ...HOUSE, centroid: { x: 160, z: 232 } };
    expect(ridesWithKerbCars({ plots: [farHouse] })).toBe(0);
  });

  it('has none across another street’s mouth, a crossing or a junction’s stub', () => {
    // A street meeting this one's middle from the far side…
    const meeting = street([
      [60, 232],
      [124, 232],
    ]);
    const clear = SIDE_ROAD_WIDTHS.minor / 2 + PARKED_CAR_STREET_MARGIN_METRES;
    let cars = 0;
    for (const seed of SEEDS) {
      for (const car of kerbCars(seed, { streets: [SIDE_MAPPED, meeting] })) {
        cars += 1;
        expect(parkedCarToSegment(car, 60, 232, 124, 232)).toBeGreaterThanOrEqual(clear);
      }
    }
    expect(cars).toBeGreaterThan(10);
    // THE CONTROL: without it, some ride parks where its mouth would be.
    expect(
      SEEDS.some((seed) =>
        kerbCars(seed).some((car) => parkedCarToSegment(car, 60, 232, 124, 232) < clear),
      ),
    ).toBe(true);
    // …a mapped crossing over it…
    const crossing: PathFeature = {
      kind: 'path',
      kindDetail: 'crossing',
      line: Float32Array.of(50, 228, 70, 228),
    };
    for (const seed of SEEDS) {
      for (const car of kerbCars(seed, { paths: [crossing] })) {
        expect(parkedCarToSegment(car, 50, 228, 70, 228)).toBeGreaterThanOrEqual(
          PARKED_CAR_FOOTWAY_METRES,
        );
      }
    }
    // …and a street the map draws 5.4 m beside it the whole way, as a dual
    // carriageway's other side is: along it, but not its own — a car on the
    // side between the two would stand 0.1 m off the other's edge. None
    // there, and the far side's are as they were.
    const twin = street([
      [65.4, 120],
      [65.4, 340],
    ]);
    for (const seed of SEEDS) {
      for (const car of kerbCars(seed, { streets: [SIDE_MAPPED, twin] })) {
        expect(car.x).toBeLessThan(60);
      }
    }
    expect(
      SEEDS.some((seed) => kerbCars(seed, { streets: [SIDE_MAPPED] }).some((car) => car.x > 60)),
    ).toBe(true);
    // Its own street's line, running on before and after the piece it stands on, is no reason:
    // the map's line of it alone gives the cars the piece alone gives.
    for (const seed of SEEDS.slice(0, 10)) {
      expect(kerbCars(seed)).toEqual(kerbCars(seed, { streets: [] }));
    }
    // THE CONTROL: the slot beside the crossing has a car on some ride without it.
    const besideCrossing = (found: readonly ParkedCar[]): boolean =>
      found.some((car) => parkedCarToSegment(car, 50, 228, 70, 228) < PARKED_CAR_FOOTWAY_METRES);
    expect(SEEDS.some((seed) => besideCrossing(kerbCars(seed)))).toBe(true);
  });

  it('keeps a driveway’s car off the middle of any street an open-world rider may turn onto', () => {
    // A street passing 4 m beside the car's side: clear of its edge, inside a ridden road's clearance.
    const plot = house(100, 14);
    const carZ = 100 - 4.5;
    const line = [
      [8, carZ + PARKED_CAR_BOX.halfWidth + 4],
      [40, carZ + PARKED_CAR_BOX.halfWidth + 4],
    ] as const;
    const more = { plots: [plot], streets: [street(line)] };
    expect(4).toBeGreaterThan(SIDE_ROAD_WIDTHS.minor / 2 + PARKED_CAR_STREET_MARGIN_METRES);
    expect(4).toBeLessThan(PARKED_CAR_ROAD_CLEAR_METRES);
    expect(ridesWithACarOn(plot, more)).toBeGreaterThan(10);
    expect(ridesWithACarOn(plot, { ...more, kerbs: false })).toBe(0);
    // A service road is never offered as a turn (ADR 0091 D-3), so its edge is all a car keeps off.
    const alley = street(line, 'service');
    expect(
      ridesWithACarOn(plot, { plots: [plot], streets: [alley], kerbs: false }),
    ).toBeGreaterThan(10);
    // Nor is a street on a bridge over the driveway, or in a tunnel under it.
    for (const grade of ['bridge', 'tunnel'] as const) {
      const over = { ...street(line), grade };
      expect(
        ridesWithACarOn(plot, { plots: [plot], streets: [over], kerbs: false }),
      ).toBeGreaterThan(10);
    }
  });
});

describe('cars on a shop’s apron — #3278', () => {
  /**
   * A shop on the road's right, its front `wall` out and 22 m along the road,
   * with an apron from the wall to the kerb's line 3.6 m out — its outline as
   * `shop-aprons.ts` writes it: the wall's stations, then the kerb line's back.
   */
  function shop(wall: number): ParkedCarPlot {
    const stations = [89, 92.6, 96.2, 99.8, 103.4, 107, 111];
    return {
      centroid: { x: wall + 5, z: 100 },
      footprint: Float32Array.of(wall, 89, wall + 10, 89, wall + 10, 111, wall, 111),
      garage: false,
      driveway: new Float32Array(0),
      apron: Float32Array.from([
        ...stations.flatMap((z) => [wall, z]),
        ...[...stations].reverse().flatMap((z) => [3.6, z]),
      ]),
    };
  }
  const apronCars = (seed: number, wall: number): readonly ParkedCar[] =>
    carsOf(seed, { plots: [shop(wall)] }, 100);

  it('stands a row parallel to the shop front, a metre in from the kerb line and a doorway off the wall', () => {
    const deep = 3.6 + PARKED_CAR_APRON_KERB_METRES + 2 * PARKED_CAR_BOX.halfWidth + 2;
    const cars = SEEDS.flatMap((seed) => apronCars(seed, deep));
    expect(cars.length).toBeGreaterThan(SEEDS.length / 2);
    for (const car of cars) {
      expect(car.spot).toBe('apron');
      // Parallel to the wall, which runs along `z`.
      expect(Math.abs(Math.cos(car.heading))).toBeCloseTo(1, 9);
      // Its outer side a metre in from the kerb's line.
      expect(car.x - PARKED_CAR_BOX.halfWidth).toBeCloseTo(3.6 + PARKED_CAR_APRON_KERB_METRES, 5);
      expect(deep - (car.x + PARKED_CAR_BOX.halfWidth)).toBeGreaterThanOrEqual(
        PARKED_CAR_APRON_DOOR_METRES,
      );
      // Inside the front's run.
      expect(car.z - PARKED_CAR_BOX.halfLength).toBeGreaterThanOrEqual(89);
      expect(car.z + PARKED_CAR_BOX.halfLength).toBeLessThanOrEqual(111);
    }
    // A row on one ride faces one way, and its cars keep apart.
    for (const seed of SEEDS) {
      const row = apronCars(seed, deep);
      expect(new Set(row.map((car) => Math.round(Math.cos(car.heading)))).size).toBeLessThanOrEqual(
        1,
      );
      for (const car of row) {
        for (const other of row) {
          if (other !== car)
            expect(apart(car, other)).toBeGreaterThanOrEqual(PARKED_CAR_GAP_METRES);
        }
      }
    }
  });

  it('has none on an apron too shallow for a car and a doorway', () => {
    const shallow = 3.6 + PARKED_CAR_APRON_KERB_METRES + 2 * PARKED_CAR_BOX.halfWidth + 1;
    expect(SEEDS.flatMap((seed) => apronCars(seed, shallow))).toEqual([]);
  });
});
