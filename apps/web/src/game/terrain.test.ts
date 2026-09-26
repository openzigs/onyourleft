// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The corridor's geometry, and the two bounds that keep a rebuild cheap.
 *
 * Everything here is pure arithmetic over #89's profile, so it is all testable
 * in jsdom — which matters, because the *rendering* of this geometry is not
 * (jsdom implements no WebGL, §4f). The split is deliberate: as much of the
 * renderer as possible is arithmetic that can be asserted here, and what is left
 * for the browser gate is only what genuinely needs a GL context.
 */

import { describe, expect, it } from 'vitest';

import {
  BEND_SMOOTHING_METRES,
  CENTRE_LINE_MARK_METRES,
  CORRIDOR_DENSE_AHEAD_METRES,
  MAXIMUM_CORRIDOR_JOINT_DEGREES,
  CENTRE_LINE_PERIOD_METRES,
  GRADIENT_TINT_FULL_SCALE_PERCENT,
  MAXIMUM_CORRIDOR_QUADS,
  MINIMUM_TINT_CONTRAST_RATIO,
  ROAD_SURFACE_GRAIN,
  MARKING_COLOUR,
  ROAD_COLOUR_STEEPEST_CLIMB,
  ROAD_COLOUR_STEEPEST_DESCENT,
  ROAD_COLUMNS,
  ROAD_WIDTH_METRES,
  corridorOrigin,
  localGroundPosition,
  roadCorridor,
  roadTint,
  type RoadCorridor,
} from './terrain';
import { PLANNER_BENDS, hairpinRoute, plannerRoute, stadiumRoute } from './route-fixtures-testing';
import { SCATTER_VERGE_METRES } from './scatter';
import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio, relativeLuminance } from '../design/contrast';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  distanceOnRoute,
  elevationAt,
  gradePercent,
  positionAt,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

/** One surface vertex, by its row down the centreline and its column across. */
function surfaceVertex(
  corridor: RoadCorridor,
  row: number,
  column: number,
): readonly [number, number, number] {
  const at = (row * ROAD_COLUMNS + column) * 3;
  return [
    corridor.vertices[at] as number,
    corridor.vertices[at + 1] as number,
    corridor.vertices[at + 2] as number,
  ];
}

/** One surface vertex's colour, as the three linear channels the GPU is handed. */
function colourAt(
  corridor: RoadCorridor,
  row: number,
  column: number,
): readonly [number, number, number] {
  const at = (row * ROAD_COLUMNS + column) * 3;
  return [
    corridor.colours[at] as number,
    corridor.colours[at + 1] as number,
    corridor.colours[at + 2] as number,
  ];
}

/** The highest vertex any triangle names. */
function highestIndex(corridor: RoadCorridor): number {
  let highest = 0;
  for (const index of corridor.indices) {
    highest = Math.max(highest, index);
  }
  return highest;
}

/**
 * Where each centre-line mark begins, as a point in the corridor's own metres.
 *
 * ⚠️ **Read out of the vertex buffer, not out of a field the implementation
 * exposed.** A mark's start is the midpoint of the two vertices across its
 * leading edge, and the marks follow the surface in the same array — so this
 * measures the geometry a driver would rasterise rather than the arithmetic
 * that produced it. A mark clipped away at the corridor's ends collapses to
 * zero length and is skipped, which is what {@link roadCorridor} emits rather
 * than changing the buffer's size. @see RoadCorridor.vertices
 */
function markStarts(corridor: RoadCorridor): readonly (readonly [number, number, number])[] {
  const firstMarkVertex = corridor.centre.length * ROAD_COLUMNS;
  const found: (readonly [number, number, number])[] = [];
  for (let at = firstMarkVertex * 3; at < corridor.vertices.length; at += 12) {
    const start = midpoint(corridor, at);
    const end = midpoint(corridor, at + 6);
    if (Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]) > 1e-6) {
      found.push(start);
    }
  }
  return found;
}

/** The midpoint of the vertex pair at `at`. */
function midpoint(corridor: RoadCorridor, at: number): readonly [number, number, number] {
  const values = corridor.vertices;
  return [
    ((values[at] as number) + (values[at + 3] as number)) / 2,
    ((values[at + 1] as number) + (values[at + 4] as number)) / 2,
    ((values[at + 2] as number) + (values[at + 5] as number)) / 2,
  ];
}

/**
 * How far a distance measured off the geometry may sit from the one asked for.
 *
 * ⚠️ **Not a test's fudge factor — it is `terrain.ts`'s own stated trade, and
 * measuring it is the only way to keep the tests honest about it.** The
 * corridor projects latitude with a constant 111 320 m per degree, while
 * `packages/domain` computes the route's length with its own distance maths;
 * the two disagree by about a tenth of a percent, so ten metres of route
 * distance measures 10.011 m in the corridor's local metres. The file's header
 * says so in as many words: *"this answers where do I put this vertex, where
 * being a centimetre out is invisible and being slow is not"*.
 *
 * Five centimetres over a ten-metre period is five times that disagreement and
 * a two-hundredth of the period, so it admits the projection and nothing else:
 * a dash placed one grid point out fails by metres.
 */
const PROJECTION_TOLERANCE_METRES = 0.05;

/** The gap between each consecutive pair of mark starts, on the ground. */
function markGaps(corridor: RoadCorridor): readonly number[] {
  const starts = markStarts(corridor);
  const gaps: number[] = [];
  for (let index = 1; index < starts.length; index += 1) {
    const from = starts[index - 1] as readonly [number, number, number];
    const to = starts[index] as readonly [number, number, number];
    gaps.push(Math.hypot(to[0] - from[0], to[2] - from[2]));
  }
  return gaps;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Where each of `points` is along the route, in route metres.
 *
 * The fixtures run due north from the projection origin, so a point's `z` is
 * its northing — and the corridor's own first two points give the northing per
 * route metre, which is the projection disagreement
 * {@link PROJECTION_TOLERANCE_METRES} describes. Taking the scale from the
 * corridor rather than writing 1.0011 down is what keeps this from becoming a
 * second, silently wrong copy of the projection.
 */
function routeDistancesOf(
  corridor: RoadCorridor,
  points: readonly (readonly [number, number, number])[],
): readonly number[] {
  const first = corridor.centre[0] as { z: number; along: number };
  const second = corridor.centre[1] as { z: number; along: number };
  const northingPerMetre = (second.z - first.z) / (second.along - first.along);
  return points.map(([, , z]) => z / northingPerMetre);
}

/** A packed `0xRRGGBB` as the `#rrggbb` string `design/contrast.ts` reads. */
function hex(packed: number): string {
  return `#${packed.toString(16).padStart(6, '0')}`;
}

/** The same profile with every gradient replaced — a file nothing real produces. */
function withGrades(profile: RouteProfile, percent: number): RouteProfile {
  return { ...profile, grades: profile.grades.map(() => gradePercent(percent)) };
}

/** A straight kilometre running due north, climbing steadily. */
function straightClimb(resolutionMetres = 10): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const northMetres = index * 10;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + northMetres / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.5),
    });
  }
  return routeProfile(points, { resolutionMetres });
}

/** A square loop, so the corridor has real corners and a wrap to cross. */
function squareLoop(): ReturnType<typeof routeProfile> {
  const side = 400;
  const spacing = 10;
  const corners: [number, number][] = [
    [0, 0],
    [0, side],
    [side, side],
    [side, 0],
  ];
  const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
  const points: RoutePoint[] = [];
  for (let leg = 0; leg < corners.length; leg += 1) {
    const from = corners[leg] as [number, number];
    const to = corners[(leg + 1) % corners.length] as [number, number];
    const steps = side / spacing;
    for (let step = 0; step < steps; step += 1) {
      const north = from[0] + ((to[0] - from[0]) * step) / steps;
      const east = from[1] + ((to[1] - from[1]) * step) / steps;
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + north / 111_320),
          degreesLongitude(-0.12 + east / perDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      });
    }
  }
  return routeProfile(points, { loop: true });
}

describe('the corridor follows the route it was built from', () => {
  it('rises with the road', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    const first = corridor.centre[0];
    const last = corridor.centre[corridor.centre.length - 1];
    // A 5% climb over the corridor's span.
    expect(last?.y).toBeGreaterThan(first?.y ?? 0);
  });

  it('starts at the origin’s own height, so the road is not floating', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 0, {
      behindMetres: 0,
      aheadMetres: 100,
    });

    expect(corridor.centre[0]?.y).toBeCloseTo(0, 6);
  });

  it('runs due north for a route that runs due north', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    // Every centreline point sits on the same meridian, so x never moves.
    for (const point of corridor.centre) {
      expect(Math.abs(point.x)).toBeLessThan(0.5);
    }
    // And z increases.
    const zs = corridor.centre.map((point) => point.z);
    expect(zs[zs.length - 1]).toBeGreaterThan(zs[0] ?? 0);
  });

  it('keeps the road the width it says it is', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    // The two outermost columns of the first row: since #242 the ribbon is six
    // columns wide, and the outer edge of each edge line is what the road's
    // width means.
    const left = surfaceVertex(corridor, 0, 0);
    const right = surfaceVertex(corridor, 0, ROAD_COLUMNS - 1);

    expect(Math.hypot(left[0] - right[0], left[2] - right[2])).toBeCloseTo(ROAD_WIDTH_METRES, 6);
  });

  it('does not bank the road across its width on a climb', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    // Every column of a row shares a height: a 5% climb is still flat across
    // the carriageway, and banking it would lift one wheel off the road.
    const heights = new Set<number>();
    for (let column = 0; column < ROAD_COLUMNS; column += 1) {
      heights.add(surfaceVertex(corridor, 0, column)[1]);
    }

    expect(heights.size).toBe(1);
  });
});

describe('every vertex is a real number', () => {
  /**
   * NaN in a vertex buffer does not throw — it silently drops the triangle. So
   * this is asserted rather than assumed, and it is asserted at the far end,
   * which is where the naive `points[i + 1] - points[i]` walks off the array.
   */
  it('produces no NaN, including at the last point', () => {
    for (const profile of [straightClimb(), squareLoop()]) {
      const corridor = roadCorridor(profile, corridorOrigin(profile), 150);
      for (const value of corridor.vertices) {
        expect(Number.isFinite(value)).toBe(true);
      }
      for (const point of corridor.centre) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(Number.isFinite(point.z)).toBe(true);
      }
    }
  });

  it('produces a drawable ribbon even for a very short corridor', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 0, {
      aheadMetres: 1,
      behindMetres: 0,
    });

    expect(corridor.centre.length).toBeGreaterThanOrEqual(2);
    expect(corridor.quadCount).toBeGreaterThanOrEqual(1);
    for (const value of corridor.vertices) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('the rebuild is bounded', () => {
  it('never exceeds the quad budget, however fine the profile’s grid', () => {
    // A 1 m grid over the same corridor is ten times the samples.
    const fine = straightClimb(1);
    const corridor = roadCorridor(fine, corridorOrigin(fine), 200);

    expect(corridor.quadCount).toBeLessThanOrEqual(MAXIMUM_CORRIDOR_QUADS);
    // The surface is still six columns of it; whatever else is in the buffer,
    // every vertex has a colour and every triangle names a vertex that exists.
    expect(corridor.vertices.length).toBeGreaterThanOrEqual(
      corridor.centre.length * ROAD_COLUMNS * 3,
    );
    expect(corridor.colours.length).toBe(corridor.vertices.length);
    expect(highestIndex(corridor)).toBeLessThan(corridor.vertices.length / 3);
  });

  it('still spans the whole view distance when it strides', () => {
    const fine = straightClimb(1);
    const corridor = roadCorridor(fine, corridorOrigin(fine), 300, {
      aheadMetres: 400,
      behindMetres: 60,
    });

    const first = corridor.centre[0];
    const last = corridor.centre[corridor.centre.length - 1];
    // Striding must lose resolution, never reach.
    expect((last?.z ?? 0) - (first?.z ?? 0)).toBeGreaterThan(400);
  });

  it('does not stride at all when the grid is already coarse enough', () => {
    const profile = straightClimb(10);
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200, {
      aheadMetres: 400,
      behindMetres: 60,
    });

    // 460 m at this route's 9.99 m grid is 46 grid steps, none skipped. Since
    // #543 the 22 of them that reach from 60 m behind to
    // CORRIDOR_DENSE_AHEAD_METRES ahead (21 fall 0.2 m short of 210 m) are
    // each drawn as five pieces of about CORRIDOR_STEP_METRES: 134 quads.
    expect(corridor.quadCount).toBe(22 * 5 + 24);
    expect((corridor.centre[corridor.centre.length - 1]?.along ?? 0) - 200).toBeCloseTo(
      46 * profile.resolution - 60,
      9,
    );
    const step = (corridor.centre[1]?.along ?? 0) - (corridor.centre[0]?.along ?? 0);
    expect(step * 5).toBeCloseTo(profile.resolution, 9);
  });
});

describe('a loop', () => {
  it('carries the corridor across the wrap rather than stopping at it', () => {
    const profile = squareLoop();
    const total: number = profile.totalDistance;
    // Sitting 30 m from the end, looking 400 m ahead: most of the corridor is
    // past the wrap.
    const corridor = roadCorridor(profile, corridorOrigin(profile), total - 30, {
      aheadMetres: 400,
      behindMetres: 0,
    });

    const distances = corridor.centre.map((point) => point.distance);
    // Some points before the wrap, some after — and none outside the route.
    expect(distances.some((distance) => distance > total - 40)).toBe(true);
    expect(distances.some((distance) => distance < 100)).toBe(true);
    for (const distance of distances) {
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThanOrEqual(total + 1e-6);
    }
  });

  it('turns corners, so a square loop is not rendered as a straight line', () => {
    const profile = squareLoop();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 0, {
      aheadMetres: 800,
      behindMetres: 0,
    });

    const xs = corridor.centre.map((point) => point.x);
    const zs = corridor.centre.map((point) => point.z);
    // Both axes have to move on a square loop; a projection bug that dropped one
    // would leave a perfectly straight road.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(100);
  });
});

describe('the start of a loop — #440', () => {
  /**
   * A 400 m square ridden from the middle of its south side, whose recorded
   * end is 10 m short of the start and 12 m across the road from it — inside
   * `LOOP_CLOSURE_METRES`, and the untidy closure a recorded GPX loop has.
   */
  function untidyLoopPoints(): RoutePoint[] {
    const perLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
    const path: Array<readonly [number, number]> = [];
    for (let s = 0; s <= 200; s += 10) path.push([s, 0]);
    for (let s = 10; s <= 400; s += 10) path.push([200, s]);
    for (let s = 190; s >= -200; s -= 10) path.push([s, 400]);
    for (let s = 390; s >= 12; s -= 10) path.push([-200, s]);
    for (let s = -190; s <= -10; s += 10) path.push([s, 12]);
    return path.map(([east, north]) => ({
      position: geographicPosition(
        degreesLatitude(51.5 + north / 111_320),
        degreesLongitude(-0.12 + east / perLongitude),
      ),
      elevation: altitudeMetres(10 + east * 0.01 + north * 0.02),
    }));
  }

  /**
   * The longest step between consecutive centreline points, in 3D metres —
   * among the points two metres apart since #543, which at distance 0 are the
   * 60 m behind the start line and the first CORRIDOR_DENSE_AHEAD_METRES ahead
   * of it: the stretch the wrap is in.
   */
  function longestStep(corridor: RoadCorridor): number {
    let longest = 0;
    for (let index = 1; index < corridor.centre.length; index += 1) {
      const a = corridor.centre[index - 1];
      const b = corridor.centre[index];
      if (a === undefined || b === undefined) continue;
      if (b.along > CORRIDOR_DENSE_AHEAD_METRES) break;
      longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    return longest;
  }

  /** How far apart, in route distance, the corridor's points are. */
  function drawStep(corridor: RoadCorridor): number {
    return (corridor.centre[1]?.along ?? 0) - (corridor.centre[0]?.along ?? 0);
  }

  it('draws the road through the start with no step longer than the grid', () => {
    // The corridor reaches 60 m behind the rider, so at distance 0 it runs
    // through the wrap. Every step is one drawing step of road, and the wrap is
    // not special. (Measured against the corridor's own step since #543, which
    // divides the grid's.)
    const profile = routeProfile(untidyLoopPoints(), { loop: true });
    const corridor = roadCorridor(profile, corridorOrigin(profile), 0);
    expect(longestStep(corridor)).toBeLessThanOrEqual(drawStep(corridor) * 1.05);
  });

  it('the control — the same loop as a pre-#440 build stored it steps across the gap', () => {
    // ⚠️ Without this, "no step longer than the grid" is equally true of a
    // corridor that never reached the wrap. This is the profile a route saved
    // before #440 still carries: the line, marked as a loop after the fact.
    // ⚠️ #543's smoothing spreads the 15.6 m gap over the twenty metres its
    // window spans, so a step no longer crosses the whole of it — measured at
    // 5.4 m against a 2 m step. Twice the step still tells the two apart.
    const stored: RouteProfile = { ...routeProfile(untidyLoopPoints()), loop: true };
    const corridor = roadCorridor(stored, corridorOrigin(stored), 0);
    expect(longestStep(corridor)).toBeGreaterThan(drawStep(corridor) * 2);
  });

  it('puts NOTHING behind the start of a point-to-point route', () => {
    // #440's other half: behind the start of a route that is not a loop there
    // is no road, deliberately. The corridor clamps every point behind 0 onto
    // the start, and those quads must have no area — a wedge of road there
    // would be the ribbon turning from a default cross-section to the real one.
    const line = routeProfile(untidyLoopPoints().slice(0, 30));
    const corridor = roadCorridor(line, corridorOrigin(line), 0);
    const behind = corridor.centre.filter((point) => point.along < 0).length;
    expect(behind).toBeGreaterThan(2);
    const start = corridor.centre.findIndex((point) => point.along >= 0) - 1;
    for (let row = 0; row < start; row += 1) {
      for (let column = 0; column < ROAD_COLUMNS; column += 1) {
        expect(surfaceVertex(corridor, row, column)).toEqual(
          surfaceVertex(corridor, start, column),
        );
      }
    }
  });
});

describe('the centre line is periodic in route distance — #242', () => {
  /**
   * ⚠️ **The defect this catches is a dash indexed by vertex.** It passes a
   * naive test — the marks are evenly spaced, and on the fixture the author
   * happened to use they are ten metres apart — and it gives a rider a false
   * speed cue on every route whose grid is fine enough to make `roadCorridor`
   * stride. The two profiles below differ only in their resolution.
   */
  it('has the same period in metres at a stride of one and a stride above one', () => {
    const coarse = straightClimb(10);
    const fine = straightClimb(1.5);
    const coarseCorridor = roadCorridor(coarse, corridorOrigin(coarse), 200);
    const fineCorridor = roadCorridor(fine, corridorOrigin(fine), 200);

    // Non-vacuity: one of these strides and the other does not, and — what a
    // dash indexed by vertex would actually read — their VERTICES are a
    // different distance apart. ⚠️ Since #543 a 1 m grid no longer shows that:
    // it strides to 2 m, and a 10 m grid is drawn in 2 m pieces, so the two
    // would share a vertex spacing and this test could not fail. A 1.5 m grid
    // strides to 3 m, which is too coarse to divide.
    expect(coarseCorridor.quadCount).toBe(22 * 5 + 24);
    expect(fineCorridor.quadCount).toBeLessThanOrEqual(MAXIMUM_CORRIDOR_QUADS);
    const spacing = (corridor: RoadCorridor): number =>
      (corridor.centre[1]?.along ?? 0) - (corridor.centre[0]?.along ?? 0);
    expect(Math.abs(spacing(fineCorridor) - spacing(coarseCorridor))).toBeGreaterThan(0.5);

    const coarseGaps = markGaps(coarseCorridor);
    const fineGaps = markGaps(fineCorridor);
    expect(coarseGaps.length).toBeGreaterThan(10);
    expect(fineGaps.length).toBeGreaterThan(10);
    for (const gap of [...coarseGaps, ...fineGaps]) {
      expect(Math.abs(gap - CENTRE_LINE_PERIOD_METRES)).toBeLessThan(PROJECTION_TOLERANCE_METRES);
    }

    // And the two agree with each other far more closely than that tolerance,
    // which is the half that says the stride changed nothing.
    expect(mean(coarseGaps)).toBeCloseTo(mean(fineGaps), 3);
  });

  it('puts every mark in the same place at both strides', () => {
    // Stronger than the period: a pattern with the right spacing and the wrong
    // phase passes the test above and is still a different road.
    const coarse = straightClimb(10);
    const fine = straightClimb(1.5);
    const coarseStarts = markStarts(roadCorridor(coarse, corridorOrigin(coarse), 200));
    const fineStarts = markStarts(roadCorridor(fine, corridorOrigin(fine), 200));

    expect(coarseStarts.length).toBeGreaterThan(10);
    for (const [, , z] of coarseStarts) {
      expect(fineStarts.some(([, , other]) => Math.abs(other - z) < 0.01)).toBe(true);
    }
  });

  it('paints the length it says it paints', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

    // The leading and trailing edges of the second slot, which is the first
    // one the corridor's near end cannot have clipped.
    const at = (corridor.centre.length * ROAD_COLUMNS + 4) * 3;
    const start = midpoint(corridor, at);
    const end = midpoint(corridor, at + 6);
    const painted = Math.hypot(end[0] - start[0], end[2] - start[2]);

    expect(Math.abs(painted - CENTRE_LINE_MARK_METRES)).toBeLessThan(PROJECTION_TOLERANCE_METRES);
    expect(painted).toBeLessThan(CENTRE_LINE_PERIOD_METRES);
  });
});

describe('the pattern does not move when the rider does — #242', () => {
  /**
   * ⚠️ **A pattern re-phased on every rebuild crawls along the road**, at a
   * speed unrelated to the rider's, and it is the single most noticeable
   * artefact this file could ship. The rider is advanced here by 1.37 grid
   * points, which is exactly the case a phase taken from the corridor's own
   * first point gets wrong: dropping the phase correction in
   * `writeCentreLine` moves every mark by up to half a grid cell.
   */
  it('keeps every mark at the route distance it began at', () => {
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    const settled = markStarts(roadCorridor(profile, origin, 200)).map((point) => point[2]);
    const advanced = markStarts(roadCorridor(profile, origin, 213.7)).map((point) => point[2]);

    // Non-vacuity: the two corridors really do cover different road, so this is
    // not two identical calls agreeing with each other.
    expect(Math.max(...advanced)).toBeGreaterThan(Math.max(...settled));
    expect(Math.min(...advanced)).toBeGreaterThan(Math.min(...settled));

    const shared = settled.filter((z) => z > Math.min(...advanced) + 1e-6);
    expect(shared.length).toBeGreaterThan(10);
    for (const z of shared) {
      expect(advanced.some((other) => Math.abs(other - z) < 0.01)).toBe(true);
    }
  });

  it('starts every mark on a whole multiple of the period along the route', () => {
    // Pinned to the route's own grid rather than merely being consistent
    // between two rider positions: a pattern anchored on the corridor's near
    // end is consistent with itself and still in the wrong place.
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 213.7);

    // ⚠️ **The one mark whose start is before the corridor begins is excluded,
    // and #323 is why it used to be included by accident.**
    // `markSlotCount`'s "+ 2" exists for exactly two such marks, and
    // `writeCentreLine` clamps their ends to the ribbon rather than dropping
    // them — so the near one's *start* vertex sits at the corridor's near end,
    // which is 52 m behind the camera and is on no period boundary at all. It
    // landed on one before #323 only because the phase correction `pointAt`'s
    // rounding needed happened to push it a fortieth of a grid point inside
    // the ribbon. Every other mark is still checked, so a pattern anchored on
    // the corridor's near end still fails this: those marks would be at
    // 153.7 m, 163.7 m and so on, and none of them is a multiple of ten.
    const nearEnd: number = (corridor.centre[0] as { along: number }).along;
    const begun = routeDistancesOf(corridor, markStarts(corridor)).filter(
      (along) => along > nearEnd + 0.01,
    );
    expect(begun.length).toBeGreaterThan(10);

    for (const along of begun) {
      const intoPeriod = along % CENTRE_LINE_PERIOD_METRES;
      expect(Math.min(intoPeriod, CENTRE_LINE_PERIOD_METRES - intoPeriod)).toBeLessThan(0.01);
    }
  });
});

describe('the centre line is painted on the road, not on the odometer — #242', () => {
  /**
   * ⚠️ **The wrap-versus-odometer confusion this file has already paid for
   * once**, one function over. `CorridorPoint.along` records #253: a rider's
   * distance is an odometer and keeps counting past the end of a loop, while
   * the route's own distance wraps back to zero. `writeCentreLine` chooses its
   * marks at route distances and then has to carry them back onto the ribbon's
   * *unwrapped* parameter, and the single line that does that is invisible to
   * every other test in this file — because they all use `straightClimb()`,
   * where `distanceOnRoute` clamps and the correction is always exactly zero.
   *
   * What it costs is not a shift: from lap two onward every mark is clipped to
   * the corridor's near end, collapses to zero area, and the road has no
   * centre line at all. Deleting the correction leaves the rest of this file,
   * and the rest of the repository, green.
   */
  it('paints the same marks in the same places on the second lap and the third', () => {
    const profile = squareLoop();
    const total: number = profile.totalDistance;
    const origin = corridorOrigin(profile);

    // Non-vacuity, and the whole reason this fixture rather than the other:
    // on lap two every corridor point's odometer is past the end of the route
    // while the route distance it is drawn at is not. On `straightClimb()`
    // these two are the same number and the assertions below cannot fail.
    const secondLap = roadCorridor(profile, origin, total + 200);
    expect(secondLap.centre.length).toBeGreaterThan(10);
    for (const point of secondLap.centre) {
      expect(point.along).toBeGreaterThan(total);
      expect(point.distance).toBeLessThanOrEqual(total + 1e-6);
    }

    const first = markStarts(roadCorridor(profile, origin, 200));
    expect(first.length).toBeGreaterThan(10);

    for (const lap of [1, 2]) {
      const later = markStarts(roadCorridor(profile, origin, lap * total + 200));

      // Counted off the vertex buffer, so a mark clipped away is a mark that
      // is not here: the count is what goes to zero when the correction is
      // dropped, and the positions are what would catch a correction that was
      // present and wrong.
      expect(later.length).toBe(first.length);
      for (let index = 0; index < first.length; index += 1) {
        const [x, , z] = first[index] as readonly [number, number, number];
        const [laterX, , laterZ] = later[index] as readonly [number, number, number];
        expect(Math.hypot(laterX - x, laterZ - z)).toBeLessThan(0.01);
      }
    }
  });
});

describe('the gradient cue is readable without colour vision — #242', () => {
  /**
   * The criterion in its own words: the tint at `+12%`, `0%` and `-12%`, by
   * the WCAG 2.2 relative-luminance formula `a11y/contrast.a11y.test.ts`
   * already uses. A tint that moved hue alone — blue for up, red for down, at
   * one lightness — scores about 1 here and goes red.
   */
  it('separates the steepest climb from the steepest descent by luminance', () => {
    const climb = relativeLuminance(hex(roadTint(GRADIENT_TINT_FULL_SCALE_PERCENT)));
    const flat = relativeLuminance(hex(roadTint(0)));
    const descent = relativeLuminance(hex(roadTint(-GRADIENT_TINT_FULL_SCALE_PERCENT)));

    expect(descent).toBeGreaterThan(flat);
    expect(flat).toBeGreaterThan(climb);
    expect(
      contrastRatio(
        hex(roadTint(GRADIENT_TINT_FULL_SCALE_PERCENT)),
        hex(roadTint(-GRADIENT_TINT_FULL_SCALE_PERCENT)),
      ),
    ).toBeGreaterThanOrEqual(MINIMUM_TINT_CONTRAST_RATIO);
  });

  it('still separates them with the surface grain at its worst — #425', () => {
    // The grain `three-renderer.ts` draws over the road MULTIPLIES the tint in
    // linear light, so its worst case for the cue is the descent darkened by
    // the whole of it and the climb lightened by the whole of it. Relative
    // luminance is linear in the linear channels, so the grain scales each
    // luminance by the same factor, and the contrast is taken on those.
    const climb = relativeLuminance(hex(roadTint(GRADIENT_TINT_FULL_SCALE_PERCENT)));
    const descent = relativeLuminance(hex(roadTint(-GRADIENT_TINT_FULL_SCALE_PERCENT)));
    const worst =
      (descent * (1 - ROAD_SURFACE_GRAIN) + 0.05) / (climb * (1 + ROAD_SURFACE_GRAIN) + 0.05);
    expect(worst).toBeGreaterThanOrEqual(MINIMUM_TINT_CONTRAST_RATIO);
    // Non-vacuity: the grain is real, and a grain that could not change the
    // answer would be a number nobody had to check.
    expect(ROAD_SURFACE_GRAIN).toBeGreaterThan(0);
    const unbounded = (descent * 0.6 + 0.05) / (climb * 1.4 + 0.05);
    expect(unbounded).toBeLessThan(MINIMUM_TINT_CONTRAST_RATIO);
  });

  it('states its threshold as WCAG 2.2’s own, rather than as an invented number', () => {
    // The same argument `contrast.a11y.test.ts` makes about its own thresholds:
    // a number nobody can cite is a number somebody will lower.
    expect(MINIMUM_TINT_CONTRAST_RATIO).toBe(AA_LARGE_TEXT_OR_NON_TEXT);
  });

  it('keeps the paint readable against the whole range of the surface', () => {
    for (const tint of [
      roadTint(0),
      roadTint(GRADIENT_TINT_FULL_SCALE_PERCENT),
      roadTint(-GRADIENT_TINT_FULL_SCALE_PERCENT),
    ]) {
      expect(contrastRatio(hex(MARKING_COLOUR), hex(tint))).toBeGreaterThanOrEqual(
        MINIMUM_TINT_CONTRAST_RATIO,
      );
    }
  });

  /**
   * ⚠️ **The one mistake in this file that nothing else can see.** three
   * multiplies a vertex-colour attribute straight into the fragment's diffuse
   * colour, in its linear working space — so handing it the sRGB bytes these
   * constants are written in paints the road about forty percent too bright.
   * It throws nothing, it stays inside `[0, 1]`, and no jsdom assertion about
   * ranges or ordering notices.
   *
   * WCAG 2.2 defines relative luminance as exactly this weighted sum of the
   * **linear** channels, so `relativeLuminance` — which does its own
   * linearisation from the sRGB string — is an independent witness: the two
   * agree only if the buffer really holds linear light.
   */
  it('hands the renderer linear light, not the sRGB bytes the constants are written in', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);
    const [red, green, blue] = colourAt(corridor, 0, 0);

    expect(0.2126 * red + 0.7152 * green + 0.0722 * blue).toBeCloseTo(
      relativeLuminance(hex(MARKING_COLOUR)),
      6,
    );
  });

  it('tints the carriageway and leaves the paint alone', () => {
    const flat = withGrades(straightClimb(), 0);
    const steep = withGrades(straightClimb(), GRADIENT_TINT_FULL_SCALE_PERCENT);
    const flatCorridor = roadCorridor(flat, corridorOrigin(flat), 200);
    const steepCorridor = roadCorridor(steep, corridorOrigin(steep), 200);

    // Column 2 is the carriageway and column 0 is the edge line.
    expect(colourAt(steepCorridor, 0, 2)).not.toEqual(colourAt(flatCorridor, 0, 2));
    expect(colourAt(steepCorridor, 0, 0)).toEqual(colourAt(flatCorridor, 0, 0));
  });
});

describe('a corrupt gradient still draws a road — #242', () => {
  /**
   * ⚠️ `RouteProfile.grades` comes from a file the rider supplied, and
   * `gradePercent` refuses only a value that is not finite. Four hundred
   * percent is not a hill; it is a malformed import, and a renderer's job with
   * one is to draw the steepest road it knows how to draw rather than to hand
   * the driver a `NaN` vertex colour, which does not throw and does not draw.
   */
  it('clamps a gradient no road has to the tints it declares', () => {
    for (const percent of [400, -400]) {
      const tint = roadTint(percent);
      expect(tint).toBe(percent > 0 ? ROAD_COLOUR_STEEPEST_CLIMB : ROAD_COLOUR_STEEPEST_DESCENT);
      expect(tint).toBeGreaterThanOrEqual(0x000000);
      expect(tint).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('keeps every channel a real number inside the range a colour has', () => {
    for (const percent of [400, -400]) {
      const profile = withGrades(straightClimb(), percent);
      const corridor = roadCorridor(profile, corridorOrigin(profile), 200);

      expect(corridor.quadCount).toBeGreaterThan(0);
      expect(corridor.indices.length).toBeGreaterThan(0);
      for (const channel of corridor.colours) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      for (const value of corridor.vertices) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('the road is one buffer, and it does not grow as the rider moves — #242', () => {
  /**
   * ⚠️ **#242's fifth criterion, in the only place jsdom can assert it.** The
   * edge lines and the centre line are vertex data in the same arrays as the
   * surface — one position array, one colour array, one index list — so a
   * renderer draws them with one mesh and one call. The count of draw calls a
   * driver actually issues is asserted in `game.browser.spec.ts`, which is
   * where a real GL context exists.
   */
  it('carries the markings in the same arrays as the surface', () => {
    const profile = straightClimb();
    const corridor = roadCorridor(profile, corridorOrigin(profile), 200);
    const surfaceVertices = corridor.centre.length * ROAD_COLUMNS;

    // There is more in the buffer than the surface, every triangle names a
    // vertex that is in it, and the markings are past the surface rather than
    // in an array of their own.
    expect(corridor.vertices.length / 3).toBeGreaterThan(surfaceVertices);
    expect(corridor.colours.length).toBe(corridor.vertices.length);
    expect(highestIndex(corridor)).toBeGreaterThanOrEqual(surfaceVertices);
    expect(highestIndex(corridor)).toBeLessThan(corridor.vertices.length / 3);
  });

  /**
   * ⚠️ **#240's NFR-3, at the layer that actually decides it.** The renderer
   * grows its buffers and never shrinks them, so a mark count that rose and
   * fell as the rider crossed each period would reallocate the vertex buffer
   * on the frame it rose — thirty times a second, forever. A mark outside the
   * corridor is emitted as a zero-area quad for exactly this reason.
   */
  it('produces the same number of vertices wherever the rider is', () => {
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    const sizes = new Set<string>();
    for (let step = 0; step < 100; step += 1) {
      const corridor = roadCorridor(profile, origin, 100 + step * 0.37);
      sizes.add(`${corridor.vertices.length}/${corridor.indices.length}`);
    }

    expect(sizes.size).toBe(1);
  });

  /**
   * ⚠️ **The same list, not an equal one — and it is the *instance* that is
   * asserted.** `roadCorridor` is called from inside `requestAnimationFrame`,
   * and the index list depends only on the corridor's shape, which does not
   * change as the rider moves: rebuilding it was 4.5 kB of identical
   * `Uint32Array` discarded sixty times a second on the thread GATT
   * notifications arrive on. `toEqual` would pass against the version that
   * allocates, which is the whole point of writing `toBe`.
   */
  it('hands back the same index list frame after frame rather than an equal one', () => {
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    const first = roadCorridor(profile, origin, 100);
    const later = roadCorridor(profile, origin, 137.4);

    // Non-vacuity: these are two different corridors, covering different road.
    expect(later.vertices).not.toBe(first.vertices);
    expect((later.centre[0] as { along: number }).along).toBeGreaterThan(
      (first.centre[0] as { along: number }).along,
    );

    expect(later.indices).toBe(first.indices);
  });

  /**
   * ⚠️ **What stops the cache above being a correctness bug.** A list keyed on
   * too little — or on nothing at all — hands a corridor of one shape the
   * triangles of another, which draws the road into the wrong vertices.
   */
  it('rebuilds the index list when the corridor changes shape', () => {
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    const wide = roadCorridor(profile, origin, 200, { aheadMetres: 400, behindMetres: 60 });
    const narrow = roadCorridor(profile, origin, 200, { aheadMetres: 200, behindMetres: 20 });
    const wideAgain = roadCorridor(profile, origin, 200, { aheadMetres: 400, behindMetres: 60 });

    expect(narrow.indices.length).toBeLessThan(wide.indices.length);
    expect(highestIndex(narrow)).toBeLessThan(narrow.vertices.length / 3);
    expect([...wideAgain.indices]).toStrictEqual([...wide.indices]);
    expect(highestIndex(wideAgain)).toBeLessThan(wideAgain.vertices.length / 3);
  });

  /**
   * ⚠️ **The invariant `three-renderer.ts` casts on.** `getIndex()` is
   * `BufferAttribute | null` there, and the cast is safe only because a
   * corridor always carries enough triangles to force the grow-the-index-buffer
   * branch on the very first frame. `markSlotCount`'s `+ 2` is what guarantees
   * it, and its comment justifies the `+ 2` as covering partial marks — so
   * nothing there says it is also a floor. This is the assertion that says so.
   */
  it('always has room for at least one whole mark and one clipped one', () => {
    const profile = straightClimb();
    const origin = corridorOrigin(profile);

    // A corridor far shorter than one dash period is the case that would reach
    // zero slots if the `+ 2` were ever lost.
    for (const ahead of [0, 1, CENTRE_LINE_PERIOD_METRES, 400]) {
      const corridor = roadCorridor(profile, origin, 200, { aheadMetres: ahead, behindMetres: 0 });
      const slots = (corridor.vertices.length / 3 - corridor.centre.length * ROAD_COLUMNS) / 4;
      expect(slots).toBeGreaterThanOrEqual(2);
      // Two mark quads are twelve indices, which is what makes the renderer's
      // `indices.length > 0` branch unconditional on the first frame.
      expect(corridor.indices.length).toBeGreaterThanOrEqual(12);
    }
  });
});

/**
 * The road slides under the rider rather than jumping a grid point at a time —
 * #323.
 *
 * ⚠️ **This is the half of "the world steps rather than moves" that is not
 * about the tick rate**, and it is the larger half. #323 diagnoses a 20 Hz
 * simulation drawn at 60 fps with nothing interpolating between the two, which
 * duplicates each position for three frames — 50 ms of stillness. This was
 * worse: {@link roadCorridor} read each centreline point's *position* out of
 * `profile.positions` at `Math.round(wrapped / resolution)`, so every point in
 * the corridor — and with it the camera, which is placed on one — held
 * completely still for a whole grid cell and then jumped the width of one. At
 * a route's nominal 10 m grid and a plausible 8 m/s that is **1.25 seconds of
 * a frozen world followed by a ten-metre jump**, and no amount of interpolating
 * between simulation states can be seen through it.
 *
 * ⚠️ **Only `x` and `z` were quantised. `y` was not**, because it came from
 * `elevationAt`, which interpolates — so the camera rose and fell smoothly
 * while the ground under it stood still, which is exactly the kind of partial
 * motion that makes a defect like this read as "the frame rate is bad".
 *
 * `packages/domain` had the answer the whole time: `positionAt` is documented
 * *"the position at a distance along the route, **for the renderer's camera**"*
 * and `gradeAt` beside it explains the rule this file was breaking — *"a held
 * value steps by the whole difference between two grid points every time the
 * rider crosses one"*. `scatter.ts` and `hud/plan.ts` both already used it;
 * this file was the one that did not.
 */
describe('the road slides with the rider rather than jumping a grid point — #323', () => {
  it('moves the road for a rider movement smaller than one grid point', () => {
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    const resolution: number = profile.resolution;

    const here = roadCorridor(profile, origin, 200);
    // A tenth of a grid cell — a single frame's worth of riding, and less than
    // half a cell, so rounding to the nearest sample cannot see it at all.
    const aMetreOn = roadCorridor(profile, origin, 200 + resolution / 10);

    const from = here.centre[0] as { x: number; z: number };
    const to = aMetreOn.centre[0] as { x: number; z: number };
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeCloseTo(resolution / 10, 1);
  });

  it('places a point between two route samples rather than on the nearer one', () => {
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    const resolution: number = profile.resolution;
    /** The one centreline point of a corridor with no span at all. */
    const pointAt = (distance: number): { x: number; z: number } =>
      roadCorridor(profile, origin, distance, { behindMetres: 0, aheadMetres: 0 })
        .centre[0] as unknown as { x: number; z: number };

    const low = pointAt(resolution);
    const high = pointAt(resolution * 2);
    const between = pointAt(resolution * 1.5);

    // Halfway between two samples is halfway along the ground between them.
    // Rounding to the nearer sample puts it on `high` instead, half a grid
    // cell — about five metres — from where the rider actually is.
    expect(between.z).toBeCloseTo((low.z + high.z) / 2, 6);
    expect(between.z).not.toBeCloseTo(high.z, 2);
  });

  it('keeps every grid point itself exactly where it was', () => {
    // The interpolation is only ever asked for between two samples, so a point
    // that lands on one must be unchanged — otherwise this is a new projection
    // rather than the same one read at a finer resolution.
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 0, { behindMetres: 0, aheadMetres: 0 });
    const first = corridor.centre[0] as { x: number; y: number; z: number };

    expect(first.x).toBeCloseTo(0, 9);
    expect(first.z).toBeCloseTo(0, 9);
    expect(first.y).toBeCloseTo(0, 9);
  });
});

describe('a bend is drawn as a curve, not as straight pieces — #543', () => {
  /**
   * The largest turn, in degrees, between one centreline segment and the next.
   *
   * ⚠️ Segments of no length are skipped: the corridor clamps every point
   * behind the start of a point-to-point route onto the start (#440), and the
   * direction of a zero-length segment is not a turn.
   */
  function worstJointDegrees(corridor: RoadCorridor, rider: number): number {
    let worst = 0;
    // "At the rider's draw density" — #543's words: the points two metres
    // apart. Beyond CORRIDOR_DENSE_AHEAD_METRES the corridor is a point a grid
    // step, as it always was, and a bend there is drawn at ten metres.
    const centre = corridor.centre.filter(
      (point) => point.along <= rider + CORRIDOR_DENSE_AHEAD_METRES + 1e-6,
    );
    for (let index = 1; index + 1 < centre.length; index += 1) {
      const a = centre[index - 1];
      const b = centre[index];
      const c = centre[index + 1];
      if (a === undefined || b === undefined || c === undefined) continue;
      const inX = b.x - a.x;
      const inZ = b.z - a.z;
      const outX = c.x - b.x;
      const outZ = c.z - b.z;
      if (Math.hypot(inX, inZ) < 1e-6 || Math.hypot(outX, outZ) < 1e-6) continue;
      const turn = Math.abs(Math.atan2(inX * outZ - inZ * outX, inX * outX + inZ * outZ));
      worst = Math.max(worst, (turn * 180) / Math.PI);
    }
    return worst;
  }

  /** The worst joint of every corridor a ride along the whole route builds. */
  function worstAlong(profile: RouteProfile, unsmoothed = false): number {
    const origin = corridorOrigin(profile);
    let worst = 0;
    for (let at = 0; at <= profile.totalDistance; at += 7) {
      const corridor = roadCorridor(profile, origin, at, { unsmoothed });
      worst = Math.max(worst, worstJointDegrees(corridor, at));
    }
    return worst;
  }

  it('holds every joint of a planner’s route under the stated bound', () => {
    const profile = plannerRoute();
    const worst = worstAlong(profile);
    expect(worst).toBeLessThan(MAXIMUM_CORRIDOR_JOINT_DEGREES);
    // Not a bound that holds because the road is straight: the road's own
    // 20 m bend turns 5.7° every two metres, and this is within a few degrees
    // of that — measured at 5.7°.
    expect(worst).toBeGreaterThan(4);
  });

  it('the control — the road as it was drawn before #543 turns a whole corner at once', () => {
    // ⚠️ Without this, "under the bound" is equally true of a fixture that
    // turned gently everywhere. The same route drawn as it was puts each of
    // the planner's corners into one joint: measured at 38.5°.
    expect(worstAlong(plannerRoute(), true)).toBeGreaterThan(3 * MAXIMUM_CORRIDOR_JOINT_DEGREES);
  });

  it('does not reach beyond the verge to find the curve', () => {
    // The drawn road cuts a corner by up to half the window times the sine of
    // half the corner. The scenery is placed beside the ROUTE (`scatter.ts`
    // projects it itself), so this is what keeps a tree off the drawn tarmac.
    const profile = plannerRoute();
    const origin = corridorOrigin(profile);
    let furthest = 0;
    for (const { middleMetres: middle } of PLANNER_BENDS) {
      for (const point of roadCorridor(profile, origin, middle).centre) {
        const route = localGroundPosition(origin, positionAt(profile, point.distance));
        furthest = Math.max(furthest, Math.hypot(route.x - point.x, route.z - point.z));
      }
    }
    expect(furthest).toBeLessThan(SCATTER_VERGE_METRES - 1);
    // And it did move the road, or the bound above says nothing.
    expect(furthest).toBeGreaterThan(0.5);
  });

  it('moves nothing on a straight', () => {
    // The mean of a straight line over any window is the line.
    const profile = straightClimb();
    const origin = corridorOrigin(profile);
    for (const point of roadCorridor(profile, origin, 300).centre) {
      const route = localGroundPosition(origin, positionAt(profile, point.distance));
      expect(point.x).toBeCloseTo(route.x, 6);
      expect(point.z).toBeCloseTo(route.z, 6);
    }
  });

  it('is the exact mean of the route over the window, so it does not shimmer as the rider moves', () => {
    // A mean taken from samples at fixed offsets from each point would change
    // a little as the corridor slid along the road, which it does every frame.
    // The exact one is checked against a brute-force mean at 1 cm.
    const profile = plannerRoute();
    const origin = corridorOrigin(profile);
    const middle = (PLANNER_BENDS[2] as { middleMetres: number }).middleMetres;
    const corridor = roadCorridor(profile, origin, middle, { behindMetres: 0, aheadMetres: 0 });
    const drawn = corridor.centre[0] as { x: number; z: number };
    const samples = 4000;
    let x = 0;
    let z = 0;
    for (let index = 0; index < samples; index += 1) {
      const at =
        middle - BEND_SMOOTHING_METRES + ((index + 0.5) / samples) * 2 * BEND_SMOOTHING_METRES;
      const ground = localGroundPosition(origin, positionAt(profile, at));
      x += ground.x / samples;
      z += ground.z / samples;
    }
    expect(Math.hypot(drawn.x - x, drawn.z - z)).toBeLessThan(0.001);
  });

  it('starts and finishes a point-to-point route exactly where the route does', () => {
    const profile = plannerRoute();
    const origin = corridorOrigin(profile);
    const total: number = profile.totalDistance;
    for (const distance of [0, total]) {
      const drawn = roadCorridor(profile, origin, distance, { behindMetres: 0, aheadMetres: 0 })
        .centre[0] as { x: number; z: number };
      const route = localGroundPosition(origin, positionAt(profile, distance));
      expect(drawn.x).toBeCloseTo(route.x, 6);
      expect(drawn.z).toBeCloseTo(route.z, 6);
    }
  });

  it('draws the road from the origin it is handed, not the first caller’s — #569', () => {
    // #569 integrates the route once and keeps the table against the profile.
    // A caller handing the same profile another origin must get the road
    // projected from THAT origin: each drawn point is still the brute-force
    // mean of the route over the window, as seen from there. Latitude and
    // longitude both move, because both are in the projection.
    const profile = plannerRoute();
    const home = corridorOrigin(profile);
    const away = { ...home, latitude: home.latitude + 0.01, longitude: home.longitude - 0.02 };
    const middle = (PLANNER_BENDS[1] as { middleMetres: number }).middleMetres;
    const drawnFrom = (origin: typeof home): { x: number; z: number } =>
      roadCorridor(profile, origin, middle, { behindMetres: 0, aheadMetres: 0 })
        .centre[0] as unknown as { x: number; z: number };
    const meanFrom = (origin: typeof home): { x: number; z: number } => {
      const samples = 4000;
      let x = 0;
      let z = 0;
      for (let index = 0; index < samples; index += 1) {
        const at =
          middle - BEND_SMOOTHING_METRES + ((index + 0.5) / samples) * 2 * BEND_SMOOTHING_METRES;
        const ground = localGroundPosition(origin, positionAt(profile, at));
        x += ground.x / samples;
        z += ground.z / samples;
      }
      return { x, z };
    };
    for (const origin of [home, away, home]) {
      const drawn = drawnFrom(origin);
      const mean = meanFrom(origin);
      expect(Math.hypot(drawn.x - mean.x, drawn.z - mean.z)).toBeLessThan(0.001);
    }
    // And the two do put the road in different places, or the loop above
    // could pass with one table.
    expect(Math.abs(drawnFrom(away).x - drawnFrom(home).x)).toBeGreaterThan(100);
  });

  it('carries the curve across a loop’s wrap without a step', () => {
    const profile = stadiumRoute(20);
    const origin = corridorOrigin(profile);
    const total: number = profile.totalDistance;
    const at = (distance: number): { x: number; z: number } =>
      roadCorridor(profile, origin, distance, { behindMetres: 0, aheadMetres: 0 })
        .centre[0] as unknown as { x: number; z: number };
    const before = at(total - 0.01);
    const after = at(0.01);
    expect(Math.hypot(before.x - after.x, before.z - after.z)).toBeLessThan(0.05);
    // The same place on the second lap is the same drawn place.
    const lapTwo = at(total + 123);
    const lapOne = at(123);
    expect(lapTwo.x).toBeCloseTo(lapOne.x, 6);
    expect(lapTwo.z).toBeCloseTo(lapOne.z, 6);
  });

  it('draws the road only: height and route distance are the centreline’s', () => {
    // #543's "unchanged" criterion. What a point is FOR — its route distance,
    // and the height and gradient read there — is the route's; only where it
    // is drawn across the ground moved.
    const profile = hairpinRoute(20);
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 480);
    let moved = 0;
    corridor.centre.forEach((point, row) => {
      expect(point.distance).toBe(distanceOnRoute(profile, point.along));
      expect(point.y).toBeCloseTo(
        (elevationAt(profile, point.distance) as number) - origin.elevation,
        9,
      );
      expect(colourAt(corridor, row, 2)).toEqual(
        colourAt(
          roadCorridor(profile, origin, point.along, { behindMetres: 0, aheadMetres: 0 }),
          0,
          2,
        ),
      );
      const route = localGroundPosition(origin, positionAt(profile, point.distance));
      moved = Math.max(moved, Math.hypot(route.x - point.x, route.z - point.z));
    });
    // And the hairpin's road was drawn somewhere other than its centreline, or
    // none of that says anything.
    expect(moved).toBeGreaterThan(0.5);
  });
});
