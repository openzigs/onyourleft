// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `junction-surface.ts` on its own — #3133: the outline where the streets of
 * a junction meet, its rounded corners and its mouths; the surface built on
 * a road's view, at the road's level; and `terrain.ts` §`roadCorridor`
 * leaving its lines unpainted between the mouths. The real game screen is
 * `open-world/junction-surface.test.tsx`'s.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  elevationAt,
  geographicPosition,
  positionAt,
  routeProfile,
  type GeographicPosition,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { SIDE_ROAD_WIDTHS, TARMAC, linearColour } from './cross-streets';
import {
  JUNCTION_CORNER_MOST_METRES,
  JUNCTION_CORNER_RADIUS_METRES,
  junctionOutline,
  junctionSurface,
  junctionSurfacesAt,
  junctionWayWidth,
  type JunctionArm,
  type TurnedJunction,
} from './junction-surface';
import { NEARBY_STREET_LIFT_METRES } from './nearby-streets';
import {
  CENTRE_LINE_PERIOD_METRES,
  MARKING_COLOUR,
  ROAD_COLUMNS,
  ROAD_WIDTH_METRES,
  corridorOrigin,
  localGroundPosition,
  roadCorridor,
  type RoadCorridor,
} from './terrain';

const ROAD_HALF = ROAD_WIDTH_METRES / 2;
const MINOR_HALF = SIDE_ROAD_WIDTHS.minor / 2;

const EAST: JunctionArm = { x: 1, z: 0, half: ROAD_HALF };
const NORTH: JunctionArm = { x: 0, z: 1, half: ROAD_HALF };
const WEST: JunctionArm = { x: -1, z: 0, half: ROAD_HALF };
const SOUTH: JunctionArm = { x: 0, z: -1, half: ROAD_HALF };

/** The outline as points. */
function pointsOf(points: readonly number[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let at = 0; at + 1 < points.length; at += 2) {
    out.push({ x: points[at] as number, z: points[at + 1] as number });
  }
  return out;
}

/** Whether `(x, z)` is inside the outline, which is star-shaped about the origin. */
function inside(points: readonly number[], x: number, z: number): boolean {
  const ring = pointsOf(points);
  let winding = false;
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at, at += 1) {
    const a = ring[at] as { x: number; z: number };
    const b = ring[before] as { x: number; z: number };
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      winding = !winding;
    }
  }
  return winding;
}

/** Each point's heading about the origin, unwound so that it rises round the ring. */
function headingsRound(points: readonly number[]): number[] {
  const headings = pointsOf(points).map(({ x, z }) => Math.atan2(z, x));
  for (let at = 1; at < headings.length; at += 1) {
    while ((headings[at] as number) < (headings[at - 1] as number)) {
      headings[at] = (headings[at] as number) + 2 * Math.PI;
    }
  }
  return headings;
}

describe('the outline of a junction’s surface — #3133', () => {
  it('joins the four arms of a square crossroads at a surface with a corner rounded to the radius between each two', () => {
    const outline = junctionOutline([EAST, NORTH, WEST, SOUTH]);
    if (outline === undefined) throw new Error('no outline');
    // Each arm reaches past the corner's rounding: the other arm's half-width and a radius.
    for (const mouth of outline.mouths) {
      expect(mouth).toBeCloseTo(ROAD_HALF + JUNCTION_CORNER_RADIUS_METRES, 6);
    }
    // The square where the two streets overlap is surface.
    for (let x = -ROAD_HALF + 0.1; x < ROAD_HALF; x += 0.5) {
      for (let z = -ROAD_HALF + 0.1; z < ROAD_HALF; z += 0.5) {
        expect(inside(outline.points, x, z), `${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(true);
      }
    }
    // Each arm, to its own width, from the node to its mouth; and nothing wider.
    for (const arm of [EAST, NORTH, WEST, SOUTH]) {
      for (const out of [ROAD_HALF + 0.5, ROAD_HALF + JUNCTION_CORNER_RADIUS_METRES - 0.2]) {
        const across = { x: -arm.z, z: arm.x };
        for (const side of [-1, 1]) {
          const at = (aside: number): boolean =>
            inside(
              outline.points,
              arm.x * out + across.x * aside * side,
              arm.z * out + across.z * aside * side,
            );
          expect(at(ROAD_HALF - 0.05), `${String(out)} m out`).toBe(true);
        }
      }
    }
    // Each corner is rounded: the edges meet at (3.5, 3.5) and the kerb
    // passes the radius's (√2 − 1) inside that, along the diagonal.
    const kerb = JUNCTION_CORNER_RADIUS_METRES * (Math.SQRT2 - 1);
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      const into = (metres: number): boolean =>
        inside(
          outline.points,
          sx * (ROAD_HALF + metres / Math.SQRT2),
          sz * (ROAD_HALF + metres / Math.SQRT2),
        );
      expect(into(kerb - 0.1)).toBe(true);
      expect(into(kerb + 0.1)).toBe(false);
    }
    // Every point at a heading after the last, once round: the fan from the node covers it.
    const headings = headingsRound(outline.points);
    expect((headings.at(-1) as number) - (headings[0] as number)).toBeLessThan(2 * Math.PI);
  });

  it('gives each arm its own width, and its mouth in the order the arms were given', () => {
    const narrow: JunctionArm = { x: 0, z: 1, half: MINOR_HALF };
    const outline = junctionOutline([WEST, EAST, narrow]);
    if (outline === undefined) throw new Error('no outline');
    const [west, east, north] = outline.mouths as [number, number, number];
    // West and east reach past the narrow street's edge and its corner.
    expect(west).toBeCloseTo(MINOR_HALF + JUNCTION_CORNER_RADIUS_METRES, 6);
    expect(east).toBeCloseTo(MINOR_HALF + JUNCTION_CORNER_RADIUS_METRES, 6);
    expect(north).toBeCloseTo(ROAD_HALF + JUNCTION_CORNER_RADIUS_METRES, 6);
    // The narrow street is drawn to its own width, not the road's.
    expect(inside(outline.points, MINOR_HALF - 0.05, north - 0.1)).toBe(true);
    expect(inside(outline.points, MINOR_HALF + 0.05, north - 0.1)).toBe(false);
  });

  it('runs a straight edge where two neighbouring arms are a half-turn apart, along the top of a T', () => {
    const outline = junctionOutline([WEST, EAST, SOUTH]);
    if (outline === undefined) throw new Error('no outline');
    // Along the top, the road's whole width is surface, and nothing past it.
    for (let x = -9; x <= 9; x += 0.5) {
      expect(inside(outline.points, x, ROAD_HALF - 0.05), `${String(x)}`).toBe(true);
      expect(inside(outline.points, x, ROAD_HALF + 0.05), `${String(x)}`).toBe(false);
    }
    // And both corners into the stem are rounded.
    const kerb = JUNCTION_CORNER_RADIUS_METRES * (Math.SQRT2 - 1);
    for (const sx of [1, -1]) {
      expect(
        inside(
          outline.points,
          sx * (ROAD_HALF + (kerb - 0.1) / Math.SQRT2),
          -(ROAD_HALF + (kerb - 0.1) / Math.SQRT2),
        ),
      ).toBe(true);
    }
  });

  it('rounds a corner between arms at a narrow angle less, so the rounding stays near the node', () => {
    const angle = (20 * Math.PI) / 180;
    const fork: JunctionArm = { x: Math.cos(angle), z: Math.sin(angle), half: MINOR_HALF };
    const outline = junctionOutline([EAST, fork, WEST]);
    if (outline === undefined) throw new Error('no outline');
    // A full radius at 20° would run 34 m along each street from where the edges meet.
    const meet = (ROAD_HALF + MINOR_HALF * Math.cos(angle)) / Math.sin(angle);
    for (const mouth of outline.mouths.slice(0, 2)) {
      expect(mouth).toBeLessThanOrEqual(meet + JUNCTION_CORNER_MOST_METRES + 1);
    }
  });

  it('keeps every piece of the outline less than a half-turn across a gap wider than one', () => {
    const angle = (60 * Math.PI) / 180;
    const outline = junctionOutline([
      { x: Math.cos(angle), z: Math.sin(angle), half: ROAD_HALF },
      { x: Math.cos(-angle), z: Math.sin(-angle), half: ROAD_HALF },
      { x: 0, z: 1, half: MINOR_HALF },
    ]);
    if (outline === undefined) throw new Error('no outline');
    const headings = headingsRound(outline.points);
    for (let at = 1; at < headings.length; at += 1) {
      expect((headings[at] as number) - (headings[at - 1] as number)).toBeLessThan(Math.PI);
    }
    expect((headings[0] as number) + 2 * Math.PI - (headings.at(-1) as number)).toBeLessThan(
      Math.PI,
    ); // And the node's own neighbourhood is surface on every side, the wide gap's too.
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const angle = (degrees * Math.PI) / 180;
      expect(inside(outline.points, Math.cos(angle), Math.sin(angle)), `${String(degrees)}°`).toBe(
        true,
      );
    }
  });

  it('has none for fewer than two arms, or two with one heading', () => {
    expect(junctionOutline([EAST])).toBeUndefined();
    expect(junctionOutline([EAST, { ...EAST, half: 1 }])).toBeUndefined();
  });

  it('draws a major way at the road’s width and any other at a minor street’s', () => {
    expect(junctionWayWidth(2)).toBe(SIDE_ROAD_WIDTHS.major);
    expect(junctionWayWidth(1)).toBe(SIDE_ROAD_WIDTHS.minor);
    expect(junctionWayWidth(0)).toBe(SIDE_ROAD_WIDTHS.minor);
  });
});

/** A straight kilometre due north, climbing 2 %, sampled every 10 m. */
function northClimb(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.2),
    });
  }
  return routeProfile(points, { resolutionMetres: 10 });
}

const PER_DEGREE_LONGITUDE = 111_320 * Math.cos((51.5 * Math.PI) / 180);

/** `east` metres east and `north` metres north of `from`. */
function offset(from: GeographicPosition, east: number, north: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude((from.latitude as number) + north / 111_320),
    degreesLongitude((from.longitude as number) + east / PER_DEGREE_LONGITUDE),
  );
}

/** A junction 500 m up `profile` turned right into, with a minor street on the left and the road on ahead. */
function turnedAt(profile: RouteProfile, metres = 500): TurnedJunction {
  const node = positionAt(profile, metres);
  return {
    junction: metres,
    position: node,
    taken: { toward: offset(node, 15, 0), width: SIDE_ROAD_WIDTHS.minor },
    ways: [
      { toward: offset(node, -15, 0), width: SIDE_ROAD_WIDTHS.minor },
      { toward: offset(node, 0, 15), width: SIDE_ROAD_WIDTHS.major },
    ],
  };
}

describe('a junction’s surface on the road’s view — #3133', () => {
  it('stands at the road’s level, lifted as a nearby street is, in the road’s tarmac, about the junction’s node', () => {
    const profile = northClimb();
    const origin = corridorOrigin(profile);
    const junction = turnedAt(profile);
    const surface = junctionSurface(profile, origin, junction, 500);
    if (surface === undefined) throw new Error('no surface');
    const node = localGroundPosition(origin, junction.position);
    const { positions, colours, indices } = surface.road.mesh;
    expect(positions[0]).toBeCloseTo(node.x, 3);
    expect(positions[2]).toBeCloseTo(node.z, 3);
    // Each vertex the road's own height beside it, lifted: the road climbs north.
    for (let at = 0; at + 2 < positions.length; at += 3) {
      const north = (positions[at + 2] as number) - node.z;
      const road = (elevationAt(profile, 500 + north) as number) - origin.elevation;
      const lift = (positions[at + 1] as number) - road;
      expect(lift).toBeGreaterThanOrEqual(NEARBY_STREET_LIFT_METRES - 1e-3);
      expect(lift).toBeLessThan(NEARBY_STREET_LIFT_METRES + 0.015);
    }
    for (let at = 0; at < colours.length; at += 3) {
      expect([colours[at], colours[at + 1], colours[at + 2]]).toEqual(
        TARMAC.map((channel) => Math.fround(channel)),
      );
    }
    // A fan about the node: every triangle names it.
    expect(indices.length).toBeGreaterThan(0);
    for (let at = 0; at < indices.length; at += 3) expect(indices[at]).toBe(0);
    // The road's lines stop at the mouths of the way in and the way taken.
    // The way taken is the route, drawn at the road's width: the way in reaches past its corner.
    expect(surface.mouths.from).toBeCloseTo(500 - (ROAD_HALF + JUNCTION_CORNER_RADIUS_METRES), 1);
    expect(surface.mouths.to).toBeGreaterThan(500 + ROAD_HALF);
    expect(surface.mouths.to).toBeLessThan(500 + 15);
    // And it keeps the scenery off: its segments reach out each arm.
    expect(surface.road.segments.length / 4).toBe(surface.road.halfWidths.length);
    expect(Math.max(...surface.road.halfWidths)).toBe(SIDE_ROAD_WIDTHS.major / 2);
    // What is measured about the way in and the way taken ends at their
    // mouths, so a way road counts nothing past a mouth as drawn.
    const segments = surface.road.segments;
    [500 - surface.mouths.from, surface.mouths.to - 500].forEach((mouth, arm) => {
      const out = Math.hypot(
        (segments[arm * 4 + 2] as number) - node.x,
        (segments[arm * 4 + 3] as number) - node.z,
      );
      expect(out + (surface.road.halfWidths[arm] as number)).toBeCloseTo(mouth, 1);
    });
  });

  it('is the same object for the same view and junction, and a new one for a junction handed on anew, as a choice hands one', () => {
    const profile = northClimb();
    const origin = corridorOrigin(profile);
    const junction = turnedAt(profile);
    const first = junctionSurface(profile, origin, junction, 500);
    expect(junctionSurface(profile, origin, junction, 500)).toBe(first);
    const other = junctionSurface(profile, origin, { ...junction }, 500);
    expect(other).not.toBe(first);
  });

  it('has none too near either end of the view to read the road’s arms', () => {
    const profile = northClimb();
    const origin = corridorOrigin(profile);
    expect(junctionSurface(profile, origin, turnedAt(profile, 5), 5)).toBeUndefined();
    const total = profile.totalDistance as number;
    expect(
      junctionSurface(profile, origin, turnedAt(profile, total - 5), total - 5),
    ).toBeUndefined();
  });

  it('hands on the surfaces of the junctions in reach only, counted from the view’s ride distance', () => {
    const profile = northClimb();
    const origin = corridorOrigin(profile);
    const near = turnedAt(profile, 300);
    const far = turnedAt(profile, 700);
    // A view whose first sample is ride distance 100: the junctions are at 200 and 600 on it.
    const shifted = (each: TurnedJunction): TurnedJunction => ({
      ...each,
      junction: each.junction + 100,
    });
    const found = junctionSurfacesAt(profile, origin, [shifted(far), shifted(near)], 100, 0, 400);
    expect(found).toHaveLength(1);
    expect(found[0]?.road.junction.along).toBe(300);
    expect(junctionSurfacesAt(profile, origin, [], 0, 0, 1000)).toHaveLength(0);
  });
});

/** Whether a surface vertex of `corridor` is painted. */
function paintedAt(corridor: RoadCorridor, row: number, column: number): boolean {
  const paint = linearColour(MARKING_COLOUR);
  const at = (row * ROAD_COLUMNS + column) * 3;
  return [0, 1, 2].every(
    (channel) =>
      Math.abs((corridor.colours[at + channel] as number) - (paint[channel] as number)) < 1e-4,
  );
}

/** Each centre-line mark's length along the road, in metres. */
function markLengths(corridor: RoadCorridor): { at: number; length: number }[] {
  const first = corridor.centre.length * ROAD_COLUMNS;
  const v = corridor.vertices;
  const out: { at: number; length: number }[] = [];
  for (let vertex = first; (vertex + 4) * 3 <= v.length; vertex += 4) {
    const fromX = ((v[vertex * 3] as number) + (v[vertex * 3 + 3] as number)) / 2;
    const fromZ = ((v[vertex * 3 + 2] as number) + (v[vertex * 3 + 5] as number)) / 2;
    const toX = ((v[vertex * 3 + 6] as number) + (v[vertex * 3 + 9] as number)) / 2;
    const toZ = ((v[vertex * 3 + 8] as number) + (v[vertex * 3 + 11] as number)) / 2;
    out.push({ at: fromZ, length: Math.hypot(toX - fromX, toZ - fromZ) });
  }
  return out;
}

describe('the road’s lines across a junction turned through — #3133', () => {
  it('paints no edge line and no centre-line mark between the mouths, and both either side of them', () => {
    const profile = northClimb();
    const origin = corridorOrigin(profile);
    const rider = 450;
    const plain = roadCorridor(profile, origin, rider);
    const bare = roadCorridor(profile, origin, rider, { unpainted: [{ from: 490, to: 510 }] });
    let inStretch = 0;
    let outside = 0;
    for (let row = 0; row < bare.centre.length; row += 1) {
      const along = (bare.centre[row] as { along: number }).along;
      for (const column of [0, 1, 4, 5]) {
        expect(paintedAt(plain, row, column)).toBe(true);
        expect(paintedAt(bare, row, column), `${along.toFixed(0)} m`).toBe(
          !(along >= 490 && along <= 510),
        );
      }
      if (along >= 490 && along <= 510) inStretch += 1;
      else outside += 1;
    }
    expect(inStretch).toBeGreaterThan(5);
    expect(outside).toBeGreaterThan(100);
    // The road's surface is where it was: only its colours changed.
    expect(bare.vertices.subarray(0, bare.centre.length * ROAD_COLUMNS * 3)).toEqual(
      plain.vertices.subarray(0, plain.centre.length * ROAD_COLUMNS * 3),
    );
    // The marks reaching into the stretch are folded to nothing; the rest are as they were.
    const origin500 = localGroundPosition(origin, positionAt(profile, 490)).z;
    const end = localGroundPosition(origin, positionAt(profile, 510)).z;
    const plainMarks = markLengths(plain);
    const bareMarks = markLengths(bare);
    let folded = 0;
    bareMarks.forEach((mark, index) => {
      const was = plainMarks[index] as { at: number; length: number };
      const reaches = was.length > 0 && was.at <= end && was.at + was.length >= origin500;
      if (reaches) {
        expect(mark.length).toBe(0);
        folded += 1;
      } else expect(mark.length).toBeCloseTo(was.length, 5);
    });
    expect(folded).toBeGreaterThanOrEqual(Math.floor(20 / CENTRE_LINE_PERIOD_METRES));
  });
});
