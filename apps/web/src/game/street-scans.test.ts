// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3107: an open-world ride's streets read a slice a frame
 * (`nearby-streets.ts` §`NearbyStreetScan`, `cross-streets.ts`
 * §`JunctionScan`), and what a frame no longer reads at all — the footways'
 * reading of the junctions on a corridor with no footway, and the pavement
 * sides of a road's whole length. On a straight road north with streets
 * written here; `open-world/street-scan-wiring.test.tsx` rides the same
 * through the real game screen and counts what each frame reads.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { StreetFeature } from '@onyourleft/map-features';

import { JUNCTION_SLICE_UNITS, JunctionScan, mappedJunctions } from './cross-streets';
import { footwaysInView, NO_FOOTWAYS } from './footway-surfaces';
import { pavementSides } from './footways';
import { NO_LAND_CLASS } from './land-class';
import {
  NEARBY_STREET_SLICE_UNITS,
  NearbyStreetScan,
  nearbyStreetGridsBuilt,
  nearbyStreets,
  onNearbyStreet,
} from './nearby-streets';
import { footwayWalks } from './people';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { anchorScenery } from './scenery-anchor';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, type CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** Six kilometres of level road due north, and the same road again as another view of it. */
const ROAD = northRoute(6_000, () => 40);
const SAME_ROAD = northRoute(6_000, () => 40);
const ORIGIN = corridorOrigin(ROAD);
const SEED = scatterSeed(ROAD);

/** The place `lateral` metres off the road at `along`. */
function beside(along: number, lateral: number): [number, number] {
  const frame = drawnRoadFrame(ROAD, ORIGIN, along);
  if (frame === undefined) throw new Error('no road there');
  return [frame.x + frame.normalX * lateral, frame.z + frame.normalZ * lateral];
}

function street(points: readonly (readonly [number, number])[]): StreetFeature {
  return {
    kind: 'minor_road',
    kindDetail: 'residential',
    grade: 'ground',
    line: Float32Array.from(points.flatMap(([along, lateral]) => beside(along, lateral))),
  };
}

/** A street square across the road at `along`, 200 m each side. */
const across = (along: number): StreetFeature =>
  street([
    [along, -200],
    [along, 200],
  ]);

/** Forty streets across the road, 100 m apart from 500 m: a town's worth near the road. */
const TOWN: readonly StreetFeature[] = Array.from({ length: 40 }, (_, index) =>
  across(500 + index * 100),
);

/**
 * 410 km of street two kilometres and more off the road, in 10 m segments:
 * what an open-world ride's far blocks hold. Out of sight, so each segment is
 * passed over.
 */
const FAR: readonly StreetFeature[] = Array.from({ length: 205 }, (_, index) =>
  street(Array.from({ length: 201 }, (_, vertex) => [vertex * 10, 2_000 + index * 20] as const)),
);

/** How many times `covered` was asked, on a corridor of `streets`. */
function counted(streets: readonly StreetFeature[]): {
  corridor: WorldCorridor;
  asked: () => number;
} {
  let asked = 0;
  return {
    corridor: {
      routeId: 'street-scans-fixture',
      origin: ORIGIN,
      covered: () => {
        asked += 1;
        return true;
      },
      coveredBoxes: [],
      landUse: [],
      buildings: [],
      paths: [],
      streets,
      places: [],
      waterLines: [],
      rails: [],
    },
    asked: () => asked,
  };
}

const lines = (pieces: readonly { readonly line: Float32Array }[]): string[] =>
  pieces.map((piece) => Array.from(piece.line, (value) => value.toFixed(2)).join(' ')).sort();

describe('one ride’s nearby streets, read a slice a frame — #3107', () => {
  it('reads a ride’s first reading whole: there is none before it to draw meanwhile', () => {
    const { corridor } = counted([...FAR, ...TOWN]);
    const scan = new NearbyStreetScan();
    const first = scan.streets(corridor, ROAD, ORIGIN);
    expect(scan.lastUnits).toBeGreaterThan(NEARBY_STREET_SLICE_UNITS * 5);
    expect(first.pieces.length).toBeGreaterThan(200);
    expect(lines(first.pieces)).toStrictEqual(
      lines(nearbyStreets({ ...corridor }, ROAD, ORIGIN).pieces),
    );
    // And the same object while the corridor and the view stand, reading nothing.
    expect(scan.streets(corridor, ROAD, ORIGIN)).toBe(first);
    expect(scan.lastUnits).toBe(0);
  });

  it('reads a new view a slice a call, handing on the reading before it until it is whole', () => {
    const { corridor } = counted([...FAR, ...TOWN]);
    const scan = new NearbyStreetScan();
    const first = scan.streets(corridor, ROAD, ORIGIN);
    // A street of this town is some 300 units, the most a slice is passed by.
    const most = NEARBY_STREET_SLICE_UNITS + 400;
    let calls = 0;
    let handed = scan.streets(corridor, SAME_ROAD, corridorOrigin(SAME_ROAD));
    // Until the reading is whole, the one before it is handed on: the same object.
    while (handed === first && calls < 200) {
      calls += 1;
      expect(scan.lastUnits).toBeGreaterThan(0);
      expect(scan.lastUnits).toBeLessThanOrEqual(most);
      handed = scan.streets(corridor, SAME_ROAD, corridorOrigin(SAME_ROAD));
    }
    expect(scan.lastUnits).toBeLessThanOrEqual(most);
    // Spread over several calls, and whole in the end.
    expect(calls).toBeGreaterThan(8);
    expect(calls).toBeLessThan(200);
    expect(handed).not.toBe(first);
    expect(lines(handed.pieces)).toStrictEqual(
      lines(nearbyStreets({ ...corridor }, SAME_ROAD, corridorOrigin(SAME_ROAD)).pieces),
    );
    // The same road, so every street stands as it did: each piece is the
    // object the ride made for it before, and what was built on it is kept.
    expect(handed.pieces).toHaveLength(first.pieces.length);
    handed.pieces.forEach((piece, index) => expect(piece).toBe(first.pieces[index]));
  });

  it('reads another corridor a slice a call too, and keeps the pieces of the streets it still holds', () => {
    const scan = new NearbyStreetScan();
    const first = scan.streets(counted([...FAR, ...TOWN]).corridor, ROAD, ORIGIN);
    // A block let go and a block read: the far streets go, the town's stay
    // (the same lines, as a held block's are), and one street more.
    const more = across(4_550);
    const { corridor } = counted([...TOWN, more]);
    let handed = scan.streets(corridor, ROAD, ORIGIN);
    expect(scan.lastUnits).toBeLessThanOrEqual(NEARBY_STREET_SLICE_UNITS + 400);
    expect(handed).toBe(first);
    for (let calls = 0; scan.lastUnits > 0 && calls < 200; calls += 1) {
      handed = scan.streets(corridor, ROAD, ORIGIN);
    }
    expect(lines(handed.pieces)).toStrictEqual(
      lines(nearbyStreets({ ...corridor }, ROAD, ORIGIN).pieces),
    );
    const kept = handed.pieces.filter((piece) => first.pieces.includes(piece));
    expect(kept).toHaveLength(first.pieces.length);
    expect(handed.pieces.length).toBeGreaterThan(first.pieces.length);
  });

  it('passes over the streets out of sight a slice a call too: they are counted, a sixteenth each segment', () => {
    const scan = new NearbyStreetScan();
    const first = scan.streets(counted(TOWN).corridor, ROAD, ORIGIN);
    // Nothing but far streets now: 41 000 segments, none of them in sight.
    const { corridor, asked } = counted(FAR);
    let calls = 0;
    let handed = scan.streets(corridor, ROAD, ORIGIN);
    while (handed === first && calls < 200) {
      calls += 1;
      // A far street is 200 segments: twelve and a half units.
      expect(scan.lastUnits).toBeLessThanOrEqual(NEARBY_STREET_SLICE_UNITS + 13);
      handed = scan.streets(corridor, ROAD, ORIGIN);
    }
    // 41 000 sixteenths: three slices, not one call.
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThan(10);
    // Whole: nothing of them is in sight, and none was read a point at a time.
    expect(handed.pieces).toHaveLength(0);
    expect(asked()).toBe(0);
  });

  it('builds the grid a planner of buildings asks of it, when it is asked and not before', () => {
    const { corridor } = counted(TOWN);
    const before = nearbyStreetGridsBuilt();
    const read = new NearbyStreetScan().streets(corridor, ROAD, ORIGIN);
    const whole = nearbyStreets({ ...corridor }, ROAD, ORIGIN);
    // Two readings, and neither has built its grid of segments: a frame draws the pieces.
    expect(read.pieces.length).toBeGreaterThan(200);
    expect(nearbyStreetGridsBuilt()).toBe(before);
    // A footprint across the street at 500 m, 60 m off the road; and one in the open.
    const on = Float32Array.from([
      ...beside(495, 55),
      ...beside(505, 55),
      ...beside(505, 65),
      ...beside(495, 65),
    ]);
    const off = Float32Array.from([
      ...beside(540, 55),
      ...beside(550, 55),
      ...beside(550, 65),
      ...beside(540, 65),
    ]);
    expect(onNearbyStreet(read, on, 0.5)).toBe(true);
    // Asked: built, once a reading.
    expect(nearbyStreetGridsBuilt()).toBe(before + 1);
    expect(onNearbyStreet(read, off, 0.5)).toBe(false);
    expect(nearbyStreetGridsBuilt()).toBe(before + 1);
    expect(onNearbyStreet(whole, on, 0.5)).toBe(true);
    expect(read.segments.length).toBe(whole.segments.length);
    expect(nearbyStreetGridsBuilt()).toBe(before + 2);
  });
});

describe('one ride’s junctions, read a slice a frame — #3107', () => {
  const AT_START = { rideOrigin: 0, riderMetres: 1_000 };
  const alongs = (junctions: readonly { readonly along: number }[]): string[] =>
    junctions.map((junction) => junction.along.toFixed(1));

  it('reads a ride’s first reading whole, and it is the whole reading', () => {
    const { corridor } = counted([...FAR, ...TOWN]);
    const scan = new JunctionScan();
    const first = scan.junctions(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS, AT_START);
    expect(scan.lastUnits).toBeGreaterThan(JUNCTION_SLICE_UNITS * 2);
    expect(first).toHaveLength(40);
    expect(alongs(first)).toStrictEqual(
      alongs(mappedJunctions({ ...corridor }, ROAD, ORIGIN, SEED, NO_LAND_CLASS)),
    );
    expect(scan.junctions(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS, AT_START)).toBe(first);
    expect(scan.lastUnits).toBe(0);
  });

  it('reads a new view a slice a call, handing on the junctions before it, and finds them the same objects', () => {
    const { corridor } = counted([...FAR, ...TOWN]);
    const scan = new JunctionScan();
    const first = scan.junctions(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS, AT_START);
    const origin: CorridorOrigin = corridorOrigin(SAME_ROAD);
    const read = () => scan.junctions(corridor, SAME_ROAD, origin, SEED, NO_LAND_CLASS, AT_START);
    let calls = 0;
    let handed = read();
    while (scan.lastUnits > 0 && calls < 200) {
      calls += 1;
      // A far street is 201 vertices, a sixteenth of a unit each; a street of the town 200 points.
      expect(scan.lastUnits).toBeLessThanOrEqual(JUNCTION_SLICE_UNITS + 250);
      // Meanwhile: the junctions before, the view's start where it was, so the same objects.
      expect(handed).toHaveLength(40);
      handed.forEach((junction, index) => expect(junction).toBe(first[index]));
      handed = read();
    }
    expect(calls).toBeGreaterThan(2);
    expect(calls).toBeLessThan(200);
    // Whole: each junction found again is the object it was.
    expect(handed).toHaveLength(40);
    handed.forEach((junction, index) => expect(junction).toBe(first[index]));
  });

  it('carries the junctions before by how far the view’s start moved on the ride', () => {
    const { corridor } = counted([...FAR, ...TOWN]);
    const scan = new JunctionScan();
    const first = scan.junctions(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS, AT_START);
    // The road trimmed behind: a view that starts 650 m further on, on the same line.
    const trimmed = northRoute(5_300, () => 40, { latitude: 51.5 + 650 / 111_320 });
    // The fixture's two roads are one line: the trimmed one starts 650 m along the other.
    const from = drawnRoadFrame(trimmed, ORIGIN, 0);
    const on = drawnRoadFrame(ROAD, ORIGIN, 650);
    if (from === undefined || on === undefined) throw new Error('no road there');
    expect(Math.hypot(from.x - on.x, from.z - on.z)).toBeLessThan(1);
    const handed = scan.junctions(corridor, trimmed, ORIGIN, SEED, NO_LAND_CLASS, {
      rideOrigin: 650,
      riderMetres: 300,
    });
    expect(scan.lastUnits).toBeGreaterThan(0);
    // The junctions at 500 m and 600 m are behind the new view's start; the rest, 650 m nearer it.
    expect(alongs(handed)).toStrictEqual(
      alongs(first.slice(2).map(({ along }) => ({ along: along - 650 }))),
    );
  });

  it('hands on none where the road ahead of the rider is another road', () => {
    const { corridor } = counted([...FAR, ...TOWN]);
    const scan = new JunctionScan();
    scan.junctions(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS, AT_START);
    // A view of a road a kilometre north of where the ride says it is: a U-turn's is as far off.
    const elsewhere = northRoute(6_000, () => 40, { latitude: 51.5 + 1_000 / 111_320 });
    const handed = scan.junctions(corridor, elsewhere, ORIGIN, SEED, NO_LAND_CLASS, AT_START);
    expect(scan.lastUnits).toBeGreaterThan(0);
    expect(handed).toHaveLength(0);
  });

  it('is told by the scene where each view starts on the ride, so a trimmed view draws the stubs it had', () => {
    // PR #3117's review: the scene's hand-over of a view's ride origin was held by no test.
    const { corridor } = counted([...FAR, ...TOWN]);
    const streetScans = { nearby: new NearbyStreetScan(), junctions: new JunctionScan() };
    // An open-world ride's first view, and the same road trimmed 650 m behind:
    // each keyed, as `open-world/road.ts` keys it, on where it starts on the ride.
    const first = northRoute(6_000, () => 40);
    const trimmed = northRoute(5_300, () => 40, { latitude: 51.5 + 650 / 111_320 });
    anchorScenery(first, { seed: SEED, origin: 0 });
    anchorScenery(trimmed, { seed: SEED, origin: 650 });
    const drawn = (profile: typeof first, distance: number): readonly number[] => {
      const start = atStartLine(profile);
      const frame = sceneFrame({
        profile,
        origin: ORIGIN,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        worldCorridor: corridor,
        streetScans,
      });
      return frame.sideRoads
        .filter((road) => road.junction.source === 'mapped')
        .map((road) => road.junction.along);
    };
    // 750 m on: the first reading, whole. Then the same place on the trimmed view.
    const before = drawn(first, 750);
    expect(streetScans.junctions.lastUnits).toBeGreaterThan(JUNCTION_SLICE_UNITS);
    expect(before.length).toBeGreaterThan(3);
    const after = drawn(trimmed, 100);
    // The new view's reading is a slice in, and the stubs are the ones before, 650 m nearer its start.
    expect(streetScans.junctions.lastUnits).toBeGreaterThan(0);
    expect(streetScans.junctions.lastUnits).toBeLessThan(JUNCTION_SLICE_UNITS * 2);
    expect(alongs(after.map((along) => ({ along })))).toStrictEqual(
      alongs(before.map((along) => ({ along: along - 650 }))),
    );
  });

  it('reads another corridor on the same view too, a slice a call, and finds its new junction', () => {
    const scan = new JunctionScan();
    const first = scan.junctions(
      counted([...FAR, ...TOWN]).corridor,
      ROAD,
      ORIGIN,
      SEED,
      NO_LAND_CLASS,
      AT_START,
    );
    // A block read: every street it had, and one more across the road.
    const { corridor } = counted([...FAR, ...TOWN, across(4_550)]);
    const read = () => scan.junctions(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS, AT_START);
    let handed = read();
    let calls = 1;
    // Meanwhile, the junctions it had: the same objects.
    expect(scan.lastUnits).toBeGreaterThan(0);
    expect(handed).toHaveLength(40);
    handed.forEach((junction, index) => expect(junction).toBe(first[index]));
    for (; scan.lastUnits > 0 && calls < 200; calls += 1) handed = read();
    expect(calls).toBeGreaterThan(2);
    // Whole: the forty it had, the same objects, and the new one.
    expect(handed).toHaveLength(41);
    first.forEach((junction) => expect(handed).toContain(junction));
    expect(handed.some((junction) => Math.abs(junction.along - 4_550) < 1)).toBe(true);
  });
});

describe('what a frame no longer reads — #3107', () => {
  it('reads no junction for the footways of a corridor that has none', () => {
    const { corridor, asked } = counted(TOWN);
    expect(footwaysInView(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS, 0, 0, [])).toBe(NO_FOOTWAYS);
    expect(footwayWalks(corridor, ROAD, ORIGIN, NO_LAND_CLASS)).toHaveLength(0);
    // Neither asked the corridor about a point of a street.
    expect(asked()).toBe(0);
    // Control: the junctions' reading does, by the thousand.
    mappedJunctions(corridor, ROAD, ORIGIN, SEED, NO_LAND_CLASS);
    expect(asked()).toBeGreaterThan(1_000);
  });

  it('works out a road’s pavement side where it is asked, once, and not for its whole length', () => {
    const { corridor, asked } = counted(TOWN);
    const sides = pavementSides(corridor, ROAD, ORIGIN);
    expect(asked()).toBe(0);
    expect(sides.sideAt(1_000)).toBe('none');
    expect(asked()).toBe(1);
    // Asked again, kept.
    expect(sides.sideAt(1_000)).toBe('none');
    expect(asked()).toBe(1);
    expect(sides.sideAt(2_000)).toBe('none');
    expect(asked()).toBe(2);
  });
});
