// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1785: the gambrel, half-hipped, saltbox and side-hipped roofs, on a
 * rectangle and on #1660's split rectangles. Held where a rider sees them:
 * the plans `footprintPlans` returns and the packed vertex floats the belt
 * uploads — the `roof` role's slope normals and ridge, the `wall` role's
 * gable ends and eaves flags, the `trim` role's gutters, and the chimney and
 * dormers. The lever is held against a frozen record of `main`'s plans.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature } from '@onyourleft/map-features';

import {
  CHIMNEY,
  eavePitchOf,
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  GAMBREL,
  GUTTER,
  HALF_HIP,
  minimumAreaRectangle,
  SALTBOX,
  VERGE_OVERHANG_METRES,
  STYLE_EAVES,
  STYLE_OFFSET,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  besideRoad,
  buildingBeside,
  eavesOverhangOf,
  houseStreetFixture,
  landBeside,
  mixedTownFixture,
  planFingerprint,
  rectangleBeside,
  ROOF_SHAPES,
  sawToothYou,
  shapeBeside,
  type ShapeCorners,
} from './footprint-fixtures-testing';
import { ROOF_VARIANTS, type RoofVariant } from './house-archetypes';
import { landClassMask } from './land-class';
import { rectanglesOf, type Rectangle } from './rectilinear-roofs';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { urbanClassMap, type UrbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

type Variant = Exclude<RoofVariant, 'plain'>;

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);

/** One footprint to plan: its corners about `(along, lateral)`, and its height. */
interface Site {
  readonly corners: ShapeCorners;
  readonly along: number;
  readonly lateral: number;
  readonly height: number;
}

/** `sites` planned on residential land beside the fixture road, with `options`. */
function plansOf(
  sites: readonly Site[],
  options: FootprintPlanOptions = {},
  maxVertices = FOOTPRINT_MAX_VERTICES,
  urban?: UrbanClassMap,
): readonly FootprintPlan[] {
  const buildings: BuildingFeature[] = sites.map((site) =>
    buildingBeside(
      profile,
      origin,
      [shapeBeside(site.corners, site.along, site.lateral)],
      site.height,
    ),
  );
  const corridor: WorldCorridor = {
    routeId: 'roof-variants',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 10, 2_990, -150, 150)],
    buildings,
    paths: [],
    streets: [],
  };
  const { plans, verdicts } = footprintPlans(
    corridor,
    landClassMask(corridor),
    profile,
    origin,
    maxVertices,
    urban,
    options,
  );
  expect(verdicts.kept).toBe(sites.length);
  return plans;
}

/** The issue's synthetic 10 m × 7 m rectangle, one storey, its long side to the road. */
const TEN_BY_SEVEN: ShapeCorners = rectangleBeside(0, 0, 10, 7);

/** One rectangle like it, `count` of them along the road, so the seeded draws vary. */
const rectangles = (corners: ShapeCorners, count: number, height = 3.5): readonly Site[] =>
  Array.from({ length: count }, (_, index) => ({
    corners,
    along: 300 + 40 * index,
    lateral: 24,
    height,
  }));

/** One vertex as the belt uploads it. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly v: number;
  readonly top: number;
  readonly flags: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      x: floats[at] as number,
      y: floats[at + 1] as number,
      z: floats[at + 2] as number,
      nx: floats[at + 3] as number,
      ny: floats[at + 4] as number,
      nz: floats[at + 5] as number,
      v: floats[at + 7] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
      flags: floats[at + STYLE_OFFSET + 1] as number,
    });
  }
  return out;
}

/** A role's triangles, three vertices each. */
function trianglesOf(
  plan: FootprintPlan,
  role: FootprintRole,
): (readonly [Vertex, Vertex, Vertex])[] {
  const vertices = verticesOf(plan, role);
  const out: (readonly [Vertex, Vertex, Vertex])[] = [];
  for (let at = 0; at + 2 < vertices.length; at += 3) {
    out.push([vertices[at] as Vertex, vertices[at + 1] as Vertex, vertices[at + 2] as Vertex]);
  }
  return out;
}

/** `(x, z)` in a rectangle's frame: along its long axis, and across it. */
function localOf(rectangle: Rectangle, x: number, z: number): readonly [a: number, c: number] {
  const dx = x - rectangle.cx;
  const dz = z - rectangle.cz;
  return [dx * rectangle.ux + dz * rectangle.uz, -dx * rectangle.uz + dz * rectangle.ux];
}

/** A slope's plane: its normal's lean along the long axis and across it, and its pitch, degrees. */
interface Plane {
  readonly along: number;
  readonly across: number;
  readonly pitch: number;
  /** Its triangles' area seen from above. */
  area: number;
  /** Its lowest vertex. */
  low: number;
}

/** The roof's distinct slope planes, by their normals. */
function planesOf(plan: FootprintPlan, rectangle: Rectangle): Plane[] {
  const planes = new Map<string, Plane>();
  for (const [p, q, r] of trianglesOf(plan, 'roof')) {
    const along = p.nx * rectangle.ux + p.nz * rectangle.uz;
    const across = -p.nx * rectangle.uz + p.nz * rectangle.ux;
    const key = `${along.toFixed(3)} ${across.toFixed(3)} ${p.ny.toFixed(3)}`;
    const plane = planes.get(key) ?? {
      along,
      across,
      pitch: (Math.acos(Math.min(1, p.ny)) * 180) / Math.PI,
      area: 0,
      low: Number.POSITIVE_INFINITY,
    };
    plane.area += Math.abs((q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z)) / 2;
    plane.low = Math.min(plane.low, p.y, q.y, r.y);
    planes.set(key, plane);
  }
  return [...planes.values()];
}

/** The ridge: the roof's highest vertices. */
function ridgeOf(plan: FootprintPlan): Vertex[] {
  const roof = verticesOf(plan, 'roof');
  const top = Math.max(...roof.map((vertex) => vertex.y));
  return roof.filter((vertex) => vertex.y > top - 1e-3);
}

/** The heights of every roof triangle over `(x, z)`, seen from above. */
function roofHeightsAt(plan: FootprintPlan, x: number, z: number): number[] {
  const out: number[] = [];
  for (const [p, q, r] of trianglesOf(plan, 'roof')) {
    const det = (q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z);
    if (Math.abs(det) < 1e-9) continue;
    const s = ((x - p.x) * (r.z - p.z) - (r.x - p.x) * (z - p.z)) / det;
    const t = ((q.x - p.x) * (z - p.z) - (x - p.x) * (q.z - p.z)) / det;
    const eps = 1e-4;
    if (s < -eps || t < -eps || s + t > 1 + eps) continue;
    out.push(p.y + s * (q.y - p.y) + t * (r.y - p.y));
  }
  return out;
}

/** #1660's tolerance on a roof's reach past its rectangles, and so on a gap: **1 cm**. */
const TOLERANCE = 0.01;

/**
 * Whether the upright wall triangle `tri` stands on `(x, y, z)` — a gable end
 * over a ring wall's top: the point is in its plane, within the 2 cm the drawn
 * ring and its rectangle may differ by, and just above it is inside it.
 */
function standsOver(
  tri: readonly [Vertex, Vertex, Vertex],
  x: number,
  y: number,
  z: number,
): boolean {
  // Its horizontal line: the two corners farthest apart seen from above.
  const pairs = [
    [tri[0], tri[1]],
    [tri[1], tri[2]],
    [tri[2], tri[0]],
  ] as const;
  const [a, b] = pairs.reduce((best, pair) =>
    Math.hypot(pair[1].x - pair[0].x, pair[1].z - pair[0].z) >
    Math.hypot(best[1].x - best[0].x, best[1].z - best[0].z)
      ? pair
      : best,
  );
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  if (run < 1e-3) return false;
  const ex = (b.x - a.x) / run;
  const ez = (b.z - a.z) / run;
  if (Math.abs(-(x - a.x) * ez + (z - a.z) * ex) > 0.02) return false;
  // In its plane: along its line and up, the point a little above where it is asked.
  const flat = (vertex: Vertex): readonly [number, number] => [
    (vertex.x - a.x) * ex + (vertex.z - a.z) * ez,
    vertex.y,
  ];
  const [s, t] = [(x - a.x) * ex + (z - a.z) * ez, y + 0.05];
  const [x0, y0] = flat(tri[0]);
  const [x1, y1] = flat(tri[1]);
  const [x2, y2] = flat(tri[2]);
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-9) return false;
  const u = ((s - x0) * (y2 - y0) - (x2 - x0) * (t - y0)) / det;
  const v = ((x1 - x0) * (t - y0) - (s - x0) * (y1 - y0)) / det;
  return u >= -1e-3 && v >= -1e-3 && u + v <= 1 + 1e-3;
}

/** Each variant forced on the 10 × 7 rectangle, with the plan the lever off gives the same one. */
const forced = (variant: Variant, count = 1): readonly FootprintPlan[] =>
  plansOf(rectangles(TEN_BY_SEVEN, count), { roofVariant: variant });

/** Like {@link forced}, but with no archetype, so the seeded hip and porch shares apply. */
const seeded = (variant: Variant, count: number): readonly FootprintPlan[] =>
  plansOf(rectangles(TEN_BY_SEVEN, count), { roofVariant: variant, houseArchetypes: false });

describe('each variant’s shape, read back from the plan — #1785', () => {
  it('builds every variant it is asked for on the 10 × 7 m rectangle, and the plain gable without it', () => {
    for (const variant of ROOF_VARIANTS) {
      const [plan] = forced(variant) as [FootprintPlan];
      expect(plan.roofVariant).toBe(variant);
      expect(plan.roof).toBe('gable');
    }
    const [control] = plansOf(rectangles(TEN_BY_SEVEN, 1)) as [FootprintPlan];
    expect(control.roofVariant).toBe('plain');
  });

  it('builds a gambrel as four slopes in two pitches, the lower the steeper, under one ridge', () => {
    const [plan] = forced('gambrel') as [FootprintPlan];
    const rectangle = minimumAreaRectangle(plan.footprint);
    const planes = planesOf(plan, rectangle);
    expect(planes).toHaveLength(4);
    // Every one a side's slope, leaning across the ridge and not along it.
    for (const plane of planes) expect(Math.abs(plane.along)).toBeLessThan(1e-3);
    const pitches = [...new Set(planes.map((plane) => Math.round(plane.pitch)))].sort();
    expect(pitches).toStrictEqual([GAMBREL.upperDegrees, GAMBREL.lowerDegrees].sort());
    // The lower slopes are the ones that reach the eaves, and they are the steeper.
    const lowest = Math.min(...planes.map((plane) => plane.low));
    for (const plane of planes) {
      if (plane.low < lowest + 1e-3) expect(plane.pitch).toBeCloseTo(GAMBREL.lowerDegrees, 1);
      else expect(plane.pitch).toBeCloseTo(GAMBREL.upperDegrees, 1);
    }
    // One ridge, on the long axis, end to end.
    const ridge = ridgeOf(plan);
    for (const vertex of ridge) expect(localOf(rectangle, vertex.x, vertex.z)[1]).toBeCloseTo(0, 3);
    const along = ridge.map((vertex) => localOf(rectangle, vertex.x, vertex.z)[0]);
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(2 * rectangle.halfLong);
    // Each gable end a pentagon: its knees and its apex above the eaves.
    const above = verticesOf(plan, 'wall').filter((vertex) => vertex.y > plan.eaves + 1e-3);
    expect(
      new Set(above.map((vertex) => `${vertex.x.toFixed(2)},${vertex.z.toFixed(2)}`)).size,
    ).toBe(2 * 3);
  });

  it('builds a half-hipped roof as two slopes and two small hips over a vertical gable', () => {
    const [plan] = forced('half-hipped') as [FootprintPlan];
    const rectangle = minimumAreaRectangle(plan.footprint);
    const planes = planesOf(plan, rectangle);
    expect(planes).toHaveLength(4);
    const sides = planes.filter((plane) => Math.abs(plane.along) < 1e-3);
    const hips = planes.filter((plane) => Math.abs(plane.across) < 1e-3);
    expect(sides).toHaveLength(2);
    expect(hips).toHaveLength(2);
    for (const plane of planes) expect(plane.pitch).toBeCloseTo(plan.pitchDegrees, 1);
    // The hips small: each under a tenth of a side's area.
    for (const hip of hips) expect(hip.area).toBeLessThan(0.1 * (sides[0] as Plane).area);
    // Above a vertical gable: each hip's foot is above the walls' top, and a wall rises to it.
    const walls = verticesOf(plan, 'wall');
    const gableTop = Math.max(...walls.map((vertex) => vertex.y));
    for (const hip of hips) {
      expect(hip.low).toBeGreaterThan(plan.eaves + 0.5);
      expect(hip.low).toBeLessThan(gableTop);
    }
    expect(gableTop).toBeLessThan(Math.max(...ridgeOf(plan).map((vertex) => vertex.y)));
    // The vertical gable at both ends, under the clipped share of the rise.
    const rise = Math.tan((plan.pitchDegrees * Math.PI) / 180) * rectangle.halfShort;
    expect(gableTop - plan.eaves).toBeCloseTo(rise * (1 - HALF_HIP.share), 2);
    const ends = new Set(
      walls
        .filter((vertex) => vertex.y > plan.eaves + 1e-3)
        .map((vertex) => Math.sign(localOf(rectangle, vertex.x, vertex.z)[0])),
    );
    expect(ends).toStrictEqual(new Set([1, -1]));
  });

  it('builds a saltbox with its ridge toward the front, and its back slope the long, low one', () => {
    for (const plan of forced('saltbox', 6)) {
      const rectangle = minimumAreaRectangle(plan.footprint);
      const planes = planesOf(plan, rectangle);
      expect(planes).toHaveLength(2);
      const ridge = ridgeOf(plan).map((vertex) => localOf(rectangle, vertex.x, vertex.z)[1]);
      const offset = ridge[0] as number;
      for (const c of ridge) expect(c).toBeCloseTo(offset, 3);
      // Off-centre, by its share of the half-width, toward the road.
      expect(Math.abs(offset)).toBeCloseTo(SALTBOX.offset * rectangle.halfShort, 2);
      const [roadX, roadZ] = besideRoad(profile, origin, 300, 0);
      const towardRoad = localOf(rectangle, roadX, roadZ)[1];
      expect(Math.sign(offset)).toBe(Math.sign(towardRoad));
      // The back slope: leaning away from the road, longer across and less steep.
      const front = planes.find((plane) => Math.sign(plane.across) === Math.sign(offset)) as Plane;
      const back = planes.find((plane) => Math.sign(plane.across) !== Math.sign(offset)) as Plane;
      expect(back.pitch).toBeCloseTo(plan.pitchDegrees, 1);
      expect(front.pitch).toBeGreaterThan(back.pitch + 5);
      expect(back.area).toBeGreaterThan(1.5 * front.area);
      const roof = verticesOf(plan, 'roof').map(
        (vertex) => localOf(rectangle, vertex.x, vertex.z)[1],
      );
      const backRun = Math.max(...roof.map((c) => -Math.sign(offset) * c)) + Math.abs(offset);
      const frontRun = Math.max(...roof.map((c) => Math.sign(offset) * c)) - Math.abs(offset);
      expect(backRun).toBeGreaterThan(1.5 * frontRun);
    }
  });

  it('builds a side-hipped roof with a hip at one end and a gable at the other', () => {
    for (const plan of forced('side-hipped', 6)) {
      const rectangle = minimumAreaRectangle(plan.footprint);
      const planes = planesOf(plan, rectangle);
      expect(planes).toHaveLength(3);
      const hips = planes.filter((plane) => Math.abs(plane.across) < 1e-3);
      expect(hips).toHaveLength(1);
      const hipEnd = Math.sign((hips[0] as Plane).along);
      // The gable's wall rises at the other end only.
      const gableEnds = new Set(
        verticesOf(plan, 'wall')
          .filter((vertex) => vertex.y > plan.eaves + 1e-3)
          .map((vertex) => Math.sign(localOf(rectangle, vertex.x, vertex.z)[0])),
      );
      expect(gableEnds).toStrictEqual(new Set([-hipEnd]));
      // The ridge runs from the gable's verge to the hip's foot, a half-width short of the wall.
      const along = ridgeOf(plan).map((vertex) => localOf(rectangle, vertex.x, vertex.z)[0]);
      expect(Math.max(...along.map((a) => a * hipEnd))).toBeCloseTo(
        rectangle.halfLong - rectangle.halfShort,
        2,
      );
    }
  });

  it('marks a side-hipped roof’s hipped end wall as under the eaves, and its gable end not', () => {
    let hipped = 0;
    for (const plan of forced('side-hipped', 6)) {
      const rectangle = minimumAreaRectangle(plan.footprint);
      const hip = planesOf(plan, rectangle).find((plane) => Math.abs(plane.across) < 1e-3) as Plane;
      const walls = verticesOf(plan, 'wall');
      for (let at = 0; at + 6 <= walls.length; at += 6) {
        const quad = walls.slice(at, at + 6);
        if ((quad[0] as Vertex).top <= 0) continue;
        const [a] = localOf(
          rectangle,
          quad.reduce((sum, vertex) => sum + vertex.x, 0) / 6,
          quad.reduce((sum, vertex) => sum + vertex.z, 0) / 6,
        );
        if (Math.abs(Math.abs(a) - rectangle.halfLong) > 0.1) continue;
        const flag = (quad[0] as Vertex).flags & STYLE_EAVES;
        if (Math.sign(a) === Math.sign(hip.along)) {
          hipped += 1;
          expect(flag).toBe(STYLE_EAVES);
        } else {
          expect(flag).toBe(0);
        }
      }
    }
    expect(hipped).toBe(6);
  });
});

/** #1660's shapes and the rectangle, each with every variant. */
const SHAPES: readonly (readonly [string, ShapeCorners])[] = [
  ['rectangle', TEN_BY_SEVEN],
  ['L', ROOF_SHAPES.ell],
  ['T', ROOF_SHAPES.tee],
  ['U', ROOF_SHAPES.you],
  ['Z', ROOF_SHAPES.zed],
];

/** Every shape with `variant`, four of each along the road. */
const shapesWith = (variant: Variant): readonly FootprintPlan[] =>
  plansOf(
    SHAPES.flatMap(([, corners], row) =>
      Array.from({ length: 4 }, (_, index) => ({
        corners,
        along: 300 + 40 * index + 200 * row,
        lateral: 30,
        height: 3.5,
      })),
    ),
    { roofVariant: variant },
  );

/** The rectangles a plan's roof is built over: its #1660 split, or its minimum-area one. */
const roofRectanglesOf = (plan: FootprintPlan): readonly Rectangle[] => {
  const split = rectanglesOf(plan.footprint);
  return split === undefined || split.length === 1 ? [minimumAreaRectangle(plan.footprint)] : split;
};

describe('watertight, at the mapped eaves — #1785, on a rectangle and on #1660’s split ones', () => {
  it.each([...ROOF_VARIANTS, 'plain' as const])(
    'meets every wall’s top with the %s roof, and roofs every point of the footprint',
    (variant) => {
      const plans =
        variant === 'plain'
          ? plansOf(
              SHAPES.map(([, corners], row) => ({
                corners,
                along: 300 + 200 * row,
                lateral: 30,
                height: 3.5,
              })),
              { roofVariants: false },
            )
          : shapesWith(variant);
      for (const plan of plans) {
        expect(plan.roof).not.toBe('flat');
        expect(plan.roofVariant).toBe(variant);
        // The walls' top edges — a ring wall's top and a gable's raking ones — each under a
        // roof that meets it there, sampled along it.
        const walls = trianglesOf(plan, 'wall');
        const edges = new Map<string, number>();
        const key = (p: Vertex, q: Vertex): string =>
          [p, q]
            .map((vertex) => `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`)
            .sort()
            .join('|');
        for (const tri of walls) {
          for (let k = 0; k < 3; k += 1) {
            const id = key(tri[k] as Vertex, tri[(k + 1) % 3] as Vertex);
            edges.set(id, (edges.get(id) ?? 0) + 1);
          }
        }
        let sampled = 0;
        for (const tri of walls) {
          for (let k = 0; k < 3; k += 1) {
            const p = tri[k] as Vertex;
            const q = tri[(k + 1) % 3] as Vertex;
            const r = tri[(k + 2) % 3] as Vertex;
            if (edges.get(key(p, q)) !== 1) continue;
            const run = Math.hypot(q.x - p.x, q.z - p.z);
            if (run < 1e-3) continue;
            // A top edge: the wall lies under it — its third corner below the edge's line.
            const along = ((r.x - p.x) * (q.x - p.x) + (r.z - p.z) * (q.z - p.z)) / run ** 2;
            if (r.y >= p.y + (q.y - p.y) * along - 1e-3) continue;
            for (const t of [0, 0.25, 0.5, 0.75, 1]) {
              const x = p.x + (q.x - p.x) * t;
              const y = p.y + (q.y - p.y) * t;
              const z = p.z + (q.z - p.z) * t;
              // Sealed: a roof meets it, or a gable's wall stands on it and a roof meets that.
              const met = roofHeightsAt(plan, x, z).some((h) => Math.abs(h - y) <= TOLERANCE);
              expect(met || walls.some((each) => standsOver(each, x, y, z))).toBe(true);
              sampled += 1;
            }
          }
        }
        expect(sampled).toBeGreaterThan(20);
        // No hole between neighbouring rectangles' roofs: a lattice through each is roofed.
        for (const each of roofRectanglesOf(plan)) {
          for (let i = -4; i <= 4; i += 1) {
            for (let j = -4; j <= 4; j += 1) {
              const a = (each.halfLong * i) / 4;
              const c = (each.halfShort * j) / 4;
              const x = each.cx + each.ux * a - each.uz * c;
              const z = each.cz + each.uz * a + each.ux * c;
              const over = roofHeightsAt(plan, x, z);
              expect(over.length).toBeGreaterThan(0);
              expect(Math.max(...over)).toBeGreaterThanOrEqual(plan.eaves - 1e-3);
            }
          }
        }
      }
    },
  );

  it.each(ROOF_VARIANTS)(
    'hangs the %s roof’s lowest edge at the eaves less the overhang’s drop, and no further out',
    (variant) => {
      for (const plan of shapesWith(variant)) {
        const roof = verticesOf(plan, 'roof');
        const pitch = eavePitchOf(variant, plan.pitchDegrees);
        const low = Math.min(...roof.map((vertex) => vertex.y));
        expect(low).toBeCloseTo(
          plan.eaves - eavesOverhangOf(plan) * Math.tan((pitch * Math.PI) / 180),
          3,
        );
        // #1660's notch test: no roof or soffit hangs past its rectangles by more than the overhang.
        const own = roofRectanglesOf(plan);
        const cos = roof.map((vertex) => vertex.ny);
        const soffits = verticesOf(plan, 'trim').filter((vertex) =>
          cos.some((ny) => Math.abs(vertex.ny + ny) < 1e-4),
        );
        for (const vertex of [...roof, ...soffits]) {
          let least = Number.POSITIVE_INFINITY;
          for (const each of own) {
            const [a, c] = localOf(each, vertex.x, vertex.z);
            least = Math.min(
              least,
              Math.max(0, Math.abs(a) - each.halfLong, Math.abs(c) - each.halfShort),
            );
          }
          // Since #1784 a Cape's eaves are tighter than every verge.
          expect(least).toBeLessThanOrEqual(
            Math.max(eavesOverhangOf(plan), VERGE_OVERHANG_METRES) + TOLERANCE,
          );
        }
      }
    },
  );

  it.each(ROOF_VARIANTS)(
    'lays the %s roof’s facade up each slope in metres: its rise over its sine',
    (variant) => {
      for (const plan of shapesWith(variant)) {
        for (const tri of trianglesOf(plan, 'roof')) {
          const sin = Math.sqrt(1 - tri[0].ny ** 2);
          for (const [p, q] of [
            [tri[0], tri[1]],
            [tri[1], tri[2]],
          ] as const) {
            expect((q.v - p.v) * 3).toBeCloseTo((q.y - p.y) / sin, 3);
          }
        }
      }
    },
  );
});

describe('gutters, a chimney and dormers on a variant — #1785', () => {
  it.each(ROOF_VARIANTS)(
    'hangs the %s roof’s gutters under its own eaves, either side',
    (variant) => {
      let hung = 0;
      for (const plan of forced(variant, 6)) {
        const rectangle = minimumAreaRectangle(plan.footprint);
        const across = rectangle.halfShort + eavesOverhangOf(plan);
        for (const side of [1, -1]) {
          const eave = verticesOf(plan, 'roof').filter(
            (vertex) => Math.abs(localOf(rectangle, vertex.x, vertex.z)[1] - side * across) < 1e-3,
          );
          const eaveY = Math.min(...eave.map((vertex) => vertex.y));
          const front = verticesOf(plan, 'trim').filter(
            (vertex) =>
              Math.abs(localOf(rectangle, vertex.x, vertex.z)[1] - side * (across + GUTTER.width)) <
              1e-3,
          );
          expect(front.length).toBe(6 + 3 + 3 + 3);
          expect(Math.max(...front.map((vertex) => vertex.y))).toBeCloseTo(eaveY - GUTTER.below, 3);
          hung += 1;
        }
      }
      expect(hung).toBe(12);
    },
  );

  it.each(ROOF_VARIANTS)('stands the %s roof’s chimney astride its ridge', (variant) => {
    let stood = 0;
    for (const plan of forced(variant, 12)) {
      const chimney = verticesOf(plan, 'chimney');
      if (chimney.length === 0) continue;
      stood += 1;
      const rectangle = minimumAreaRectangle(plan.footprint);
      const ridge = ridgeOf(plan);
      const top = (ridge[0] as Vertex).y;
      expect(Math.max(...chimney.map((vertex) => vertex.y))).toBeCloseTo(top + CHIMNEY.above, 3);
      const middle = localOf(
        rectangle,
        chimney.reduce((sum, vertex) => sum + vertex.x, 0) / chimney.length,
        chimney.reduce((sum, vertex) => sum + vertex.z, 0) / chimney.length,
      );
      const ridgeAt = ridge.map((vertex) => localOf(rectangle, vertex.x, vertex.z));
      // Across, on the ridge's line; along, within its length.
      expect(middle[1]).toBeCloseTo((ridgeAt[0] as readonly [number, number])[1], 2);
      expect(middle[0]).toBeGreaterThanOrEqual(Math.min(...ridgeAt.map(([a]) => a)) - 1e-3);
      expect(middle[0]).toBeLessThanOrEqual(Math.max(...ridgeAt.map(([a]) => a)) + 1e-3);
    }
    expect(stood).toBeGreaterThan(3);
  });

  /** Steep enough rectangles, a dozen, for a seeded dormer on some. */
  const steep = rectangles(rectangleBeside(0, 0, 12, 8), 24);

  it.each(['half-hipped', 'side-hipped'] as const)(
    'stands the %s roof’s dormers inside its side slopes, under its ridge',
    (variant) => {
      let dormered = 0;
      for (const plan of plansOf(steep, { roofVariant: variant })) {
        if (plan.dormers === 0) continue;
        dormered += 1;
        const rectangle = minimumAreaRectangle(plan.footprint);
        const sides = planesOf(plan, rectangle).filter((plane) => Math.abs(plane.along) < 1e-3);
        const top = (ridgeOf(plan)[0] as Vertex).y;
        for (const vertex of verticesOf(plan, 'dormer')) {
          expect(vertex.y).toBeLessThan(top);
          // Over a side slope's triangle, not a hip's, and not past the eaves.
          const under = trianglesOf(plan, 'roof').filter(([p, q, r]) => {
            const det = (q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z);
            const s = ((vertex.x - p.x) * (r.z - p.z) - (r.x - p.x) * (vertex.z - p.z)) / det;
            const t = ((q.x - p.x) * (vertex.z - p.z) - (vertex.x - p.x) * (q.z - p.z)) / det;
            return s >= -1e-4 && t >= -1e-4 && s + t <= 1 + 1e-4;
          });
          expect(under.length).toBeGreaterThan(0);
          for (const [p] of under) {
            const along = p.nx * rectangle.ux + p.nz * rectangle.uz;
            expect(Math.abs(along)).toBeLessThan(1e-3);
          }
        }
        expect(sides).toHaveLength(2);
      }
      expect(dormered).toBeGreaterThan(2);
    },
  );

  it.each(['gambrel', 'saltbox'] as const)(
    'builds no dormer on a %s roof, where the plain roof on the same footprints has some',
    (variant) => {
      const plans = plansOf(steep, { roofVariant: variant });
      expect(plans.every((plan) => plan.roofVariant === variant && plan.dormers === 0)).toBe(true);
      expect(plans.every((plan) => plan.triangles.dormer.length === 0)).toBe(true);
      // Control: with the variants off, the same footprints carry dormers.
      expect(plansOf(steep, { roofVariants: false }).some((plan) => plan.dormers > 0)).toBe(true);
    },
  );

  it('ties a front porch’s roof under the gambrel’s lower gutter, not the plain pitch’s', () => {
    let porched = 0;
    for (const plan of seeded('gambrel', 60)) {
      if (!plan.porch) continue;
      const roof = verticesOf(plan, 'porch-roof');
      if (roof.length === 0) continue; // a canopy, not a front porch
      porched += 1;
      // The steepest eave drops EAVES_OVERHANG × tan(lower) below the walls' top; the gutter hangs
      // under it, and the porch's roof meets the wall below the gutter's foot (#1589).
      const drop = EAVES_OVERHANG_METRES * Math.tan((GAMBREL.lowerDegrees * Math.PI) / 180);
      const gutterFoot = plan.eaves - drop - GUTTER.below - GUTTER.depth;
      expect(Math.max(...roof.map((vertex) => vertex.y))).toBeLessThan(gutterFoot);
    }
    expect(porched).toBeGreaterThan(2);
  });

  it.each(ROOF_VARIANTS)(
    'draws no hip on the %s roof, whatever the seeded hip draw: it is a gable with its variant',
    (variant) => {
      const plans = seeded(variant, 60);
      expect(plans.every((plan) => plan.roof === 'gable' && plan.roofVariant === variant)).toBe(
        true,
      );
      // Control: the plain roof on the same footprints draws some hips.
      expect(
        plansOf(rectangles(TEN_BY_SEVEN, 60), { houseArchetypes: false }).some(
          (plan) => plan.roof === 'hip',
        ),
      ).toBe(true);
    },
  );
});

describe('the caps — #1785', () => {
  /** The largest rectangle and the largest split footprint the pitched rule admits, two storeys. */
  const LARGEST: readonly Site[] = [
    // A rectangle just inside `FOOTPRINT_GABLE_MAX_AREA`'s 300 m², as the fixture road draws it.
    ...rectangles(rectangleBeside(0, 0, 24.8, 12), 6, 6.5),
    // A U of 296 m² on three rectangles.
    ...Array.from({ length: 6 }, (_, index) => ({
      corners: [
        [0, 0],
        [23.5, 0],
        [23.5, 16],
        [16.75, 16],
        [16.75, 8],
        [6.75, 8],
        [6.75, 16],
        [0, 16],
      ] as ShapeCorners,
      along: 600 + 40 * index,
      lateral: 30,
      height: 6.5,
    })),
  ];

  it.each(ROOF_VARIANTS)(
    'holds the %s roof, with a chimney, to 640 near and 200 far on the largest footprints',
    (variant) => {
      const plans = plansOf(LARGEST, { roofVariant: variant });
      let chimneys = 0;
      for (const plan of plans) {
        expect(plan.roofVariant).toBe(variant);
        expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
        expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
        if (plan.triangles.chimney.length > 0) chimneys += 1;
      }
      expect(chimneys).toBeGreaterThan(3);
      expect(
        plans.filter((plan) => (rectanglesOf(plan.footprint)?.length ?? 1) === 3),
      ).toHaveLength(6);
    },
  );

  it('falls back to the plain roof, then to the flat one, never a truncated one', () => {
    // #1660's saw-toothed U, more of its vertices kept: a gambrel past the far cap, a plain one not.
    const toothed: Site = { corners: sawToothYou(), along: 1_000, lateral: 40, height: 4 };
    const [plain] = plansOf([toothed], { roofVariant: 'gambrel' }, 86) as [FootprintPlan];
    expect(rectanglesOf(plain.footprint)).toHaveLength(3);
    expect(plain.roof).not.toBe('flat');
    expect(plain.roofVariant).toBe('plain');
    expect(plain.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    // Control: fewer of its vertices kept, the gambrel fits and is built.
    const [gambrel] = plansOf([toothed], { roofVariant: 'gambrel' }, 60) as [FootprintPlan];
    expect(gambrel.roofVariant).toBe('gambrel');
    // Past the plain roof too: flat, a wall for every edge of the ring as drawn.
    const [flat] = plansOf([toothed], { roofVariant: 'gambrel' }, 400) as [FootprintPlan];
    expect(flat.roof).toBe('flat');
    expect(flat.roofVariant).toBe('plain');
    expect(verticesOf(flat, 'wall').length / 6).toBe(flat.footprint.length / 2);
  });
});

/**
 * `origin/main`'s plans at `ac20712c`, before #1785, fingerprinted by
 * `footprint-fixtures-testing.ts` §`planFingerprint` with `main`'s own planner:
 * the mixed town and the street of houses, each with its urban class (the
 * realistic page's) and #1782's archetypes on.
 *
 * A frozen record of the pre-#1785 planner, not a snapshot to refresh. If a
 * later change moves these, it has changed what the lever-off plan is: update
 * them only with a stated, reviewed reason in the PR.
 */
const MAIN_FINGERPRINTS = { mixed: '18e7375f', houses: '15da7210' } as const;

describe('the archetypes’ variants and the lever — #1785', () => {
  const towns = { mixed: mixedTownFixture(), houses: houseStreetFixture() } as const;
  const planned = (
    town: (typeof towns)[keyof typeof towns],
    options: FootprintPlanOptions = {},
  ): readonly FootprintPlan[] => {
    const land = landClassMask(town.corridor);
    const urban = urbanClassMap(town.corridor, land, town.profile);
    return footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options)
      .plans;
  };

  it('plans every footprint as `origin/main` did with `-roof-variants`, and chooses no variant', () => {
    for (const name of ['mixed', 'houses'] as const) {
      // Since #1786 its dormers are off too: `main` had neither.
      const off = planned(towns[name], {
        roofVariants: false,
        dormerVariants: false,
        archetypePorches: false,
      });
      expect(off.every((plan) => plan.roofVariant === 'plain')).toBe(true);
      expect(planFingerprint(off)).toBe(MAIN_FINGERPRINTS[name]);
    }
  });

  it('control: with the lever on, the street of houses is not `origin/main`’s', () => {
    expect(planFingerprint(planned(towns.houses))).not.toBe(MAIN_FINGERPRINTS.houses);
  });

  it('gives each archetype only its own variant, and no `unknown` footprint one', () => {
    const plans = [...planned(towns.mixed), ...planned(towns.houses)];
    const own: Readonly<Record<string, RoofVariant>> = {
      farmhouse: 'gambrel',
      colonial: 'saltbox',
      bungalow: 'half-hipped',
      ranch: 'side-hipped',
    };
    const seen = new Set<RoofVariant>();
    for (const plan of plans) {
      if (plan.roofVariant === 'plain') continue;
      seen.add(plan.roofVariant);
      expect(plan.roofVariant).toBe(own[plan.archetype]);
    }
    expect([...seen].sort()).toStrictEqual([...ROOF_VARIANTS].sort());
  });

  it('plans every footprint that wears no variant exactly as with the lever off', () => {
    for (const town of [towns.mixed, towns.houses]) {
      const on = planned(town);
      const off = planned(town, { roofVariants: false });
      expect(on).toHaveLength(off.length);
      let plain = 0;
      on.forEach((plan, index) => {
        if (plan.roofVariant !== 'plain') return;
        plain += 1;
        expect(planFingerprint([plan], false)).toBe(
          planFingerprint([off[index] as FootprintPlan], false),
        );
      });
      expect(plain).toBeGreaterThan(30);
    }
  });

  it('holds every plan of the two towns to the caps, variants on', () => {
    for (const plan of [...planned(towns.mixed), ...planned(towns.houses)]) {
      expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    }
  });

  it('builds nothing but `main`’s roles: no new role, so no new draw call', () => {
    const [plan] = forced('gambrel') as [FootprintPlan];
    expect(Object.keys(plan.triangles).sort()).toStrictEqual(
      Object.keys((plansOf(rectangles(TEN_BY_SEVEN, 1))[0] as FootprintPlan).triangles).sort(),
    );
  });
});
