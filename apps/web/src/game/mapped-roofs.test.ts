// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1790: a mapped footprint's `roof:shape`, `roof:orientation`,
 * `roof:direction`, `building:levels` and `roof:levels`, read back where a
 * rider sees them — the plans `footprintPlans` returns and the packed vertex
 * floats the belt uploads: the `roof` role's slope normals and ridge, the
 * `wall` role's facade floats and heights, and the dormers. Every tag and
 * footprint is synthetic. Absent tags and the lever are held against a frozen
 * record of the planner before this change.
 */

import { describe, expect, it } from 'vitest';

import {
  NO_BUILDING_FIELDS,
  ROOF_SHAPES as MAPPED_ROOF_SHAPES,
  type BuildingFeature,
  type BuildingFields,
  type RoofShape,
} from '@onyourleft/map-features';

import { windowStoreysOf } from './facade';
import {
  DORMER_MIN_PITCH_DEGREES,
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  LEVELS_ROOM_METRES,
  MAPPED_ROOFS,
  minimumAreaRectangle,
  SKILLION_PITCH_DEGREES,
  STOREY_METRES,
  storeyMetresOf,
  STYLE_OFFSET,
  STYLE_TERRACED,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  commercialStreetFixture,
  houseStreetFixture,
  landBeside,
  mappedRoofStreetFixture,
  mixedTownFixture,
  planFingerprint,
  rectangleBeside,
  ROOF_SHAPES,
  sawToothYou,
  shapeBeside,
  terraceStreetFixture,
  type ShapeCorners,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { rectanglesOf, type Rectangle } from './rectilinear-roofs';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);

/** One footprint to plan: its corners about `(along, lateral)`, its height and its tags. */
interface Site {
  readonly corners: ShapeCorners;
  readonly along: number;
  readonly lateral: number;
  readonly height: number | null;
  readonly tags?: Partial<BuildingFields>;
}

/** `sites` as a corridor's buildings, on residential land beside the fixture road. */
function corridorOf(sites: readonly Site[]): WorldCorridor {
  const buildings: BuildingFeature[] = sites.map((site) => ({
    ...buildingBeside(
      profile,
      origin,
      [shapeBeside(site.corners, site.along, site.lateral)],
      site.height,
    ),
    ...site.tags,
  }));
  return {
    routeId: 'mapped-roofs',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'residential', 10, 2_990, -150, 150)],
    buildings,
    paths: [],
    streets: [],
  };
}

/** `sites` planned with `options`, every one kept. */
function plansOf(
  sites: readonly Site[],
  options: FootprintPlanOptions = {},
  maxVertices = FOOTPRINT_MAX_VERTICES,
): readonly FootprintPlan[] {
  const corridor = corridorOf(sites);
  const { plans, verdicts } = footprintPlans(
    corridor,
    landClassMask(corridor),
    profile,
    origin,
    maxVertices,
    undefined,
    options,
  );
  expect(verdicts.kept).toBe(sites.length);
  return plans;
}

/** One footprint planned. */
function planOf(
  corners: ShapeCorners,
  tags: Partial<BuildingFields>,
  options: FootprintPlanOptions = {},
  height: number | null = 3.5,
): FootprintPlan {
  return plansOf([{ corners, along: 600, lateral: 24, height, tags }], options)[0] as FootprintPlan;
}

/** One vertex as the belt uploads it. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly fv: number;
  readonly top: number;
  readonly flags: number;
  readonly width: number;
  readonly extra: number;
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
      fv: floats[at + FACADE_OFFSET + 1] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
      flags: floats[at + STYLE_OFFSET + 1] as number,
      width: floats[at + STYLE_OFFSET + 2] as number,
      extra: floats[at + STYLE_OFFSET + 3] as number,
    });
  }
  return out;
}

/** A roof slope's plane: its normal's lean along the long axis, across it, and its pitch. */
interface Plane {
  readonly along: number;
  readonly across: number;
  /** Its normal's horizontal part, in the world: `x`, `z`. */
  readonly nx: number;
  readonly nz: number;
  readonly pitch: number;
}

/** The roof's distinct planes, by their normals, in `rectangle`'s frame. */
function planesOf(plan: FootprintPlan, rectangle: Rectangle): Plane[] {
  const planes = new Map<string, Plane>();
  for (const vertex of verticesOf(plan, 'roof')) {
    const along = vertex.nx * rectangle.ux + vertex.nz * rectangle.uz;
    const across = -vertex.nx * rectangle.uz + vertex.nz * rectangle.ux;
    const key = `${along.toFixed(3)} ${across.toFixed(3)} ${vertex.ny.toFixed(3)}`;
    planes.set(key, {
      along,
      across,
      nx: vertex.nx,
      nz: vertex.nz,
      pitch: (Math.acos(Math.min(1, vertex.ny)) * 180) / Math.PI,
    });
  }
  return [...planes.values()];
}

/** The ridge: the roof's highest vertices, in `rectangle`'s frame (`a` along, `c` across). */
function ridgeOf(plan: FootprintPlan, rectangle: Rectangle): (readonly [a: number, c: number])[] {
  const roof = verticesOf(plan, 'roof');
  const top = Math.max(...roof.map((vertex) => vertex.y));
  return roof
    .filter((vertex) => vertex.y > top - 1e-3)
    .map((vertex) => {
      const dx = vertex.x - rectangle.cx;
      const dz = vertex.z - rectangle.cz;
      return [dx * rectangle.ux + dz * rectangle.uz, -dx * rectangle.uz + dz * rectangle.ux];
    });
}

/** The heights of every roof triangle over `(x, z)`, seen from above. */
function roofHeightsAt(plan: FootprintPlan, x: number, z: number): number[] {
  const vertices = verticesOf(plan, 'roof');
  const out: number[] = [];
  for (let at = 0; at + 2 < vertices.length; at += 3) {
    const [p, q, r] = [vertices[at], vertices[at + 1], vertices[at + 2]] as [
      Vertex,
      Vertex,
      Vertex,
    ];
    const det = (q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z);
    if (Math.abs(det) < 1e-9) continue;
    const s = ((x - p.x) * (r.z - p.z) - (r.x - p.x) * (z - p.z)) / det;
    const t = ((q.x - p.x) * (z - p.z) - (x - p.x) * (q.z - p.z)) / det;
    if (s < -1e-4 || t < -1e-4 || s + t > 1 + 1e-4) continue;
    out.push(p.y + s * (q.y - p.y) + t * (r.y - p.y));
  }
  return out;
}

/** How far a set of numbers spreads. */
const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

/** The angle between two horizontal directions, degrees, in [0, 180]. */
function angleBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const dot = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

/** A compass bearing as a unit `(x, z)` in local metres: `x` west, `z` north. */
const bearing = (degrees: number): readonly [number, number] => [
  -Math.sin((degrees * Math.PI) / 180),
  Math.cos((degrees * Math.PI) / 180),
];

/** The issue's synthetic rectangle: 12 m along the road by 8 m deep, one storey. */
const TWELVE_BY_EIGHT = rectangleBeside(0, 0, 12, 8);
/** A 9 m square, on which a hip is a pyramid. */
const SQUARE = rectangleBeside(0, 0, 9, 9);

/**
 * What each mapped value is read back as, on {@link TWELVE_BY_EIGHT} (and a
 * `pyramidal` roof on {@link SQUARE}): its roof and variant, how many slope
 * planes, how many of them lean along the long axis (a hip's end), and where
 * the ridge is — `line` along the long axis at its middle, `point` a pyramid's
 * apex, `offset` a line off the middle (a saltbox's), `edge` a skillion's high
 * eave, or none for a flat roof.
 */
const EXPECTED: Readonly<
  Record<
    RoofShape,
    {
      readonly roof: FootprintPlan['roof'];
      readonly variant: FootprintPlan['roofVariant'];
      readonly planes: number;
      readonly ends: number;
      readonly ridge: 'line' | 'point' | 'offset' | 'edge' | 'none';
    }
  >
> = {
  flat: { roof: 'flat', variant: 'plain', planes: 1, ends: 0, ridge: 'none' },
  gabled: { roof: 'gable', variant: 'plain', planes: 2, ends: 0, ridge: 'line' },
  hipped: { roof: 'hip', variant: 'plain', planes: 4, ends: 2, ridge: 'line' },
  pyramidal: { roof: 'hip', variant: 'plain', planes: 4, ends: 2, ridge: 'point' },
  skillion: { roof: 'gable', variant: 'skillion', planes: 1, ends: 0, ridge: 'edge' },
  'half-hipped': { roof: 'gable', variant: 'half-hipped', planes: 4, ends: 2, ridge: 'line' },
  gambrel: { roof: 'gable', variant: 'gambrel', planes: 4, ends: 0, ridge: 'line' },
  saltbox: { roof: 'gable', variant: 'saltbox', planes: 2, ends: 0, ridge: 'offset' },
  side_hipped: { roof: 'gable', variant: 'side-hipped', planes: 3, ends: 1, ridge: 'line' },
  mansard: { roof: 'hip', variant: 'plain', planes: 4, ends: 2, ridge: 'line' },
};

describe('each mapped roof:shape, read back from the plan — #1790', () => {
  it('maps every value #1789 decodes, and no other', () => {
    expect(Object.keys(MAPPED_ROOFS).sort()).toStrictEqual([...MAPPED_ROOF_SHAPES].sort());
    expect(Object.keys(EXPECTED).sort()).toStrictEqual([...MAPPED_ROOF_SHAPES].sort());
  });

  it.each(MAPPED_ROOF_SHAPES)('draws a footprint tagged %s as the table says', (shape) => {
    const expected = EXPECTED[shape];
    const corners = shape === 'pyramidal' ? SQUARE : TWELVE_BY_EIGHT;
    const plan = planOf(corners, { roofShape: shape });
    expect(plan.roof).toBe(expected.roof);
    expect(plan.roofVariant).toBe(expected.variant);
    const rectangle = minimumAreaRectangle(plan.footprint);
    const planes = planesOf(plan, rectangle);
    expect(planes).toHaveLength(expected.planes);
    expect(planes.filter((plane) => Math.abs(plane.along) > 1e-3)).toHaveLength(expected.ends);
    if (expected.roof === 'flat') {
      expect(planes[0]?.pitch).toBeCloseTo(0, 6);
      expect(plan.pitchDegrees).toBe(0);
      return;
    }
    // Every slope rises from the eaves: none flat, none upright.
    for (const plane of planes) {
      expect(plane.pitch).toBeGreaterThan(5);
      expect(plane.pitch).toBeLessThan(75);
    }
    const ridge = ridgeOf(plan, rectangle);
    const along = ridge.map(([a]) => a);
    const across = ridge.map(([, c]) => c);
    switch (expected.ridge) {
      case 'line':
        expect(spread(across)).toBeLessThan(1e-3);
        expect(Math.abs(across[0] as number)).toBeLessThan(1e-3);
        expect(spread(along)).toBeGreaterThan(1);
        break;
      case 'point':
        // The drawn square is a square to within its float32 corners: an apex, not a ridge.
        expect(spread(across)).toBeLessThan(0.05);
        expect(spread(along)).toBeLessThan(0.05);
        break;
      case 'offset':
        expect(spread(across)).toBeLessThan(1e-3);
        expect(Math.abs(across[0] as number)).toBeGreaterThan(0.5);
        break;
      case 'edge':
        // The high eave, out past the wall on one side, the whole length.
        expect(spread(across)).toBeLessThan(1e-3);
        expect(Math.abs(across[0] as number)).toBeGreaterThan(rectangle.halfShort);
        expect(spread(along)).toBeGreaterThan(2 * rectangle.halfLong);
        expect(plan.pitchDegrees).toBe(SKILLION_PITCH_DEGREES);
        expect(planes[0]?.pitch).toBeCloseTo(SKILLION_PITCH_DEGREES, 3);
        break;
      default:
        throw new Error('a pitched roof has a ridge');
    }
  });

  it('draws a skillion’s walls up to its high edge: two right-triangle ends and the high side', () => {
    const plan = planOf(TWELVE_BY_EIGHT, { roofShape: 'skillion' });
    const rectangle = minimumAreaRectangle(plan.footprint);
    const high = Math.max(...verticesOf(plan, 'wall').map((vertex) => vertex.y));
    const rise = 2 * rectangle.halfShort * Math.tan((SKILLION_PITCH_DEGREES * Math.PI) / 180);
    expect(high - plan.eaves).toBeCloseTo(rise, 4);
    // Every wall above the eaves is on the high side, away from the way the slope faces.
    const [slope] = planesOf(plan, rectangle) as [Plane];
    const above = verticesOf(plan, 'wall').filter((vertex) => vertex.y > plan.eaves + 0.01);
    expect(above.length).toBeGreaterThan(0);
    for (const vertex of above) {
      const c =
        -(vertex.x - rectangle.cx) * rectangle.uz + (vertex.z - rectangle.cz) * rectangle.ux;
      expect(c * Math.sign(slope.across)).toBeLessThan(1e-3);
    }
    // The high side's wall closes it: a face above the eaves facing away from the slope, its
    // length the wall's.
    const back = above.filter((vertex) => {
      const across = -vertex.nx * rectangle.uz + vertex.nz * rectangle.ux;
      return across * Math.sign(slope.across) < -0.99;
    });
    expect(back.length).toBeGreaterThanOrEqual(3);
    const along = back.map(
      (vertex) =>
        (vertex.x - rectangle.cx) * rectangle.ux + (vertex.z - rectangle.cz) * rectangle.uz,
    );
    expect(spread(along)).toBeCloseTo(2 * rectangle.halfLong, 2);
  });

  it('draws a flat tag flat on a footprint the archetype would pitch', () => {
    const untagged = planOf(TWELVE_BY_EIGHT, {});
    expect(untagged.roof).not.toBe('flat');
    const flat = planOf(TWELVE_BY_EIGHT, { roofShape: 'flat' });
    expect(flat.roof).toBe('flat');
    expect(flat.triangles.roof.length).toBeGreaterThan(0);
    for (const vertex of verticesOf(flat, 'roof')) expect(vertex.ny).toBeCloseTo(1, 6);
  });

  it('draws a hipped tag on a Cape as a hip, where the Cape’s own roof is a gable', () => {
    const cape = rectangleBeside(0, 0, 10.5, 8);
    const untagged = planOf(cape, {});
    expect(untagged.archetype).toBe('cape');
    expect(untagged.roof).toBe('gable');
    const hipped = planOf(cape, { roofShape: 'hipped' });
    expect(hipped.archetype).toBe('cape');
    expect(hipped.roof).toBe('hip');
    const planes = planesOf(hipped, minimumAreaRectangle(hipped.footprint));
    expect(planes).toHaveLength(4);
  });

  it.each(['gabled', 'hipped', 'gambrel', 'half-hipped', 'saltbox', 'side_hipped', 'skillion'])(
    'draws %s on each of an L’s split rectangles',
    (shape) => {
      const plan = planOf(ROOF_SHAPES.ell, { roofShape: shape as RoofShape });
      expect(rectanglesOf(plan.footprint)).toHaveLength(2);
      const expected = EXPECTED[shape as RoofShape];
      expect(plan.roof).toBe(expected.roof);
      expect(plan.roofVariant).toBe(expected.variant);
      // Both wings roofed: a slope over each rectangle's middle, above the eaves.
      for (const wing of rectanglesOf(plan.footprint) ?? []) {
        const heights = roofHeightsAt(plan, wing.cx, wing.cz);
        expect(heights.length).toBeGreaterThan(0);
        expect(Math.max(...heights)).toBeGreaterThan(plan.eaves + 0.5);
      }
    },
  );

  it('keeps a terraced footprint’s flat roof and cornice, whatever its tag', () => {
    const town = terraceStreetFixture();
    const tagged = {
      ...town,
      corridor: {
        ...town.corridor,
        buildings: town.corridor.buildings.map((building) => ({
          ...building,
          roofShape: 'gabled' as const,
        })),
      },
    };
    const plan = (corridor: WorldCorridor): readonly FootprintPlan[] => {
      const land = landClassMask(corridor);
      return footprintPlans(
        corridor,
        land,
        town.profile,
        town.origin,
        undefined,
        urbanClassMap(corridor, land, town.profile),
      ).plans;
    };
    const before = plan(town.corridor);
    const after = plan(tagged.corridor);
    const terraced = (each: FootprintPlan): boolean =>
      verticesOf(each, 'wall').some((vertex) => (vertex.flags & STYLE_TERRACED) !== 0);
    const rows = before.filter(terraced);
    expect(rows.length).toBeGreaterThan(5);
    expect(after).toHaveLength(before.length);
    before.forEach((each, index) => {
      const its = after[index] as FootprintPlan;
      if (terraced(each)) {
        expect(its.roof).toBe('flat');
        expect(its.triangles.roof).toStrictEqual(each.triangles.roof);
        expect(its.triangles.trim).toStrictEqual(each.triangles.trim);
      }
    });
    // Control: a row house's footprint standing alone, with no party wall, is pitched as tagged.
    expect(planOf(rectangleBeside(0, 0, 8, 12), { roofShape: 'gabled' }).roof).toBe('gable');
  });

  it('keeps today’s roof for a pitched tag on a footprint that is no rectangle, L, T, U or Z', () => {
    const untagged = planOf(ROOF_SHAPES.dodecagon, {});
    const tagged = planOf(ROOF_SHAPES.dodecagon, { roofShape: 'gabled' });
    expect(tagged.roof).toBe(untagged.roof);
    expect(planFingerprint([tagged])).toBe(planFingerprint([untagged]));
    // A flat tag is drawn on any shape.
    expect(planOf(ROOF_SHAPES.dodecagon, { roofShape: 'flat' }).roof).toBe('flat');
  });
});

describe('which way a mapped roof runs — #1790', () => {
  /** The issue's 10 m × 6 m gable, its 10 m side along the road. */
  const TEN_BY_SIX = rectangleBeside(0, 0, 10, 6);

  /** The direction the ridge runs, as a unit `(x, z)`, from its end vertices. */
  const ridgeRun = (plan: FootprintPlan): readonly [number, number] => {
    const roof = verticesOf(plan, 'roof');
    const top = Math.max(...roof.map((vertex) => vertex.y));
    const ridge = roof.filter((vertex) => vertex.y > top - 1e-3);
    let best: readonly [number, number] = [0, 0];
    for (const p of ridge) {
      for (const q of ridge) {
        if (Math.hypot(q.x - p.x, q.z - p.z) > Math.hypot(...best)) best = [q.x - p.x, q.z - p.z];
      }
    }
    return best;
  };

  it('puts the ridge parallel to the 6 m side with `across`, and to the 10 m side without', () => {
    const rectangle = minimumAreaRectangle(planOf(TEN_BY_SIX, {}).footprint);
    const long: readonly [number, number] = [rectangle.ux, rectangle.uz];
    const along = planOf(TEN_BY_SIX, { roofShape: 'gabled', roofOrientation: 'along' });
    const across = planOf(TEN_BY_SIX, { roofShape: 'gabled', roofOrientation: 'across' });
    expect(angleBetween(ridgeRun(along), long) % 180).toBeLessThan(1);
    expect(Math.abs(angleBetween(ridgeRun(across), long) - 90)).toBeLessThan(1);
    // The ridge across is the 6 m side's length, with its verges.
    expect(Math.hypot(...ridgeRun(across))).toBeLessThan(7);
    expect(Math.hypot(...ridgeRun(along))).toBeGreaterThan(10);
  });

  /** The slope of a gable whose normal is nearest the way `degrees` faces: the main one. */
  const mainSlope = (plan: FootprintPlan, degrees: number): readonly [number, number] => {
    const facing = bearing(degrees);
    const planes = planesOf(plan, minimumAreaRectangle(plan.footprint));
    const main = planes.reduce((best, plane) =>
      plane.nx * facing[0] + plane.nz * facing[1] > best.nx * facing[0] + best.nz * facing[1]
        ? plane
        : best,
    );
    return [main.nx, main.nz];
  };

  it('turns the main slope’s normal by 90° from roof:direction 0 to 90, each facing its way', () => {
    const north = planOf(TEN_BY_SIX, { roofShape: 'gabled', roofDirectionDegrees: 0 });
    const east = planOf(TEN_BY_SIX, { roofShape: 'gabled', roofDirectionDegrees: 90 });
    const a = mainSlope(north, 0);
    const b = mainSlope(east, 90);
    expect(Math.abs(angleBetween(a, b) - 90)).toBeLessThanOrEqual(15);
    // Each within one 15° step of the way it is tagged.
    expect(angleBetween(a, bearing(0))).toBeLessThanOrEqual(15);
    expect(angleBetween(b, bearing(90))).toBeLessThanOrEqual(15);
  });

  it('lets roof:direction win over roof:orientation', () => {
    const rectangle = minimumAreaRectangle(planOf(TEN_BY_SIX, {}).footprint);
    const long: readonly [number, number] = [rectangle.ux, rectangle.uz];
    // The bearing square to the long side, `(−uz, ux)`: x is west, so `(−sin θ, cos θ)` is it.
    const square = (Math.atan2(rectangle.uz, rectangle.ux) * 180) / Math.PI;
    const degrees = (((Math.round(square / 15) * 15) % 360) + 360) % 360;
    expect(angleBetween(bearing(degrees), [-rectangle.uz, rectangle.ux])).toBeLessThan(8);
    // That direction keeps the ridge along the long side, whatever `across` says.
    const plan = planOf(TEN_BY_SIX, {
      roofShape: 'gabled',
      roofOrientation: 'across',
      roofDirectionDegrees: degrees,
    });
    expect(angleBetween(ridgeRun(plan), long) % 180).toBeLessThan(1);
    // Control: `across` alone turns it.
    const across = planOf(TEN_BY_SIX, { roofShape: 'gabled', roofOrientation: 'across' });
    expect(Math.abs(angleBetween(ridgeRun(across), long) - 90)).toBeLessThan(1);
  });

  it('slopes a skillion tagged 180 down toward 180', () => {
    const plan = planOf(TEN_BY_SIX, { roofShape: 'skillion', roofDirectionDegrees: 180 });
    const planes = planesOf(plan, minimumAreaRectangle(plan.footprint));
    expect(planes).toHaveLength(1);
    const [slope] = planes as [Plane];
    expect(angleBetween([slope.nx, slope.nz], bearing(180))).toBeLessThanOrEqual(15);
    // And tagged 0, toward 0: the other way.
    const [other] = planesOf(
      planOf(TEN_BY_SIX, { roofShape: 'skillion', roofDirectionDegrees: 0 }),
      minimumAreaRectangle(plan.footprint),
    ) as [Plane];
    expect(angleBetween([other.nx, other.nz], bearing(0))).toBeLessThanOrEqual(15);
  });
});

describe('mapped storeys — #1790', () => {
  /** The wall faces with windows on them: `top` > 0. */
  const windowed = (plan: FootprintPlan): Vertex[] =>
    verticesOf(plan, 'wall').filter((vertex) => vertex.top > 0);

  it('lays building:levels=2 as 2 storeys of windows in a wall whose height would give 4', () => {
    const control = planOf(TWELVE_BY_EIGHT, {}, {}, 12);
    expect(control.storeys).toBe(4);
    const tagged = planOf(TWELVE_BY_EIGHT, { levels: 2 }, {}, 12);
    expect(tagged.storeys).toBe(2);
    for (const [plan, rows] of [
      [tagged, 2],
      [control, 4],
    ] as const) {
      const walls = windowed(plan);
      expect(walls.length).toBeGreaterThan(0);
      for (const vertex of walls) {
        expect(windowStoreysOf(vertex.top, vertex)).toBe(rows);
        expect(vertex.fv).toBeLessThanOrEqual(vertex.top + 1e-4);
      }
      // The eaves at the mapped height: 12 m of wall, the windows' top at it.
      expect(spread(walls.map((vertex) => vertex.y))).toBeCloseTo(12, 4);
      expect(Math.max(...walls.map((vertex) => vertex.y))).toBeCloseTo(plan.eaves, 4);
    }
    expect(tagged.eaves).toBeCloseTo(control.eaves, 6);
  });

  it('keeps 3 m storeys where the levels fill the mapped height to within #1629’s 2 m', () => {
    expect(storeyMetresOf(8, 2)).toBe(STOREY_METRES);
    expect(storeyMetresOf(6, 2)).toBe(STOREY_METRES);
    expect(storeyMetresOf(6 + LEVELS_ROOM_METRES + 0.5, 2)).toBeCloseTo(4.25, 6);
    expect(storeyMetresOf(5, 2)).toBeCloseTo(2.5, 6);
    // Read back: a 2-level tag on #1629's 8 m is drawn as the untagged 8 m house is.
    const tagged = planOf(TWELVE_BY_EIGHT, { levels: 2 }, {}, 8);
    const untagged = planOf(TWELVE_BY_EIGHT, {}, {}, 8);
    expect(tagged.storeys).toBe(2);
    expect(tagged.triangles.wall).toStrictEqual(untagged.triangles.wall);
  });

  it('lays as many rows as the levels, wherever the mapped height puts the eaves', () => {
    for (const [height, levels] of [
      [5, 3],
      [9, 1],
      [14, 2],
      [20, 6],
    ] as const) {
      const plan = planOf(TWELVE_BY_EIGHT, { levels }, {}, height);
      expect(plan.storeys).toBe(levels);
      for (const vertex of windowed(plan)) {
        expect(windowStoreysOf(vertex.top, vertex)).toBe(levels);
      }
    }
  });

  it('reads no level the decoder would not have kept, as a corridor edited on the device might carry', () => {
    const untaggedPlan = planOf(TWELVE_BY_EIGHT, {}, {}, 12);
    for (const levels of [-2, 0, 2.5, 101, Number.MAX_SAFE_INTEGER]) {
      const plan = planOf(TWELVE_BY_EIGHT, { levels }, {}, 12);
      expect(plan.storeys).toBe(untaggedPlan.storeys);
      expect(plan.triangles.wall).toStrictEqual(untaggedPlan.triangles.wall);
    }
    // Control: the decoder's bounds are read.
    expect(planOf(TWELVE_BY_EIGHT, { levels: 100 }, {}, 12).storeys).toBe(100);
  });

  it('reads levels with no mapped height as that many 3 m storeys', () => {
    const plan = planOf(TWELVE_BY_EIGHT, { levels: 3 }, {}, null);
    expect(plan.storeys).toBe(3);
    expect(spread(windowed(plan).map((vertex) => vertex.y))).toBeCloseTo(9, 4);
  });

  it('admits dormers below their least pitch under a roof:levels attic, and not without one', () => {
    const sites = (tags: Partial<BuildingFields>): readonly Site[] =>
      Array.from({ length: 60 }, (_, index) => ({
        corners: rectangleBeside(0, 0, 12, 10),
        along: 300 + 40 * index,
        lateral: 26,
        height: 3.5,
        tags: { roofShape: 'gabled', ...tags },
      }));
    const low = (plans: readonly FootprintPlan[]): readonly FootprintPlan[] =>
      plans.filter((plan) => plan.pitchDegrees < DORMER_MIN_PITCH_DEGREES);
    const attic = low(plansOf(sites({ roofLevels: 1 }), { houseArchetypes: false }));
    const none = low(plansOf(sites({}), { houseArchetypes: false }));
    expect(attic.length).toBeGreaterThan(5);
    expect(attic.filter((plan) => plan.dormers > 0).length).toBeGreaterThan(0);
    expect(none.filter((plan) => plan.dormers > 0)).toHaveLength(0);
    // A roof:levels of 0 is no attic.
    const zero = low(plansOf(sites({ roofLevels: 0 }), { houseArchetypes: false }));
    expect(zero.filter((plan) => plan.dormers > 0)).toHaveLength(0);
  });

  it('reads no level from a building part, whose levels count from the ground', () => {
    const corridor = corridorOf([]);
    const part: BuildingFeature = {
      ...buildingBeside(profile, origin, [shapeBeside(TWELVE_BY_EIGHT, 600, 24)], 12, {
        minHeightMetres: 3,
      }),
      levels: 2,
    };
    const { plans } = footprintPlans(
      { ...corridor, buildings: [part] },
      landClassMask(corridor),
      profile,
      origin,
    );
    expect(plans[0]?.storeys).toBe(3);
  });
});

/**
 * The planner's plans before #1790, fingerprinted by
 * `footprint-fixtures-testing.ts` §`planFingerprint` (roof, pitch, storeys,
 * dormers, garage, porch, paint and every float of every role) at `8f241c3b`:
 * each town with its urban class, as the realistic page plans it, and the
 * mixed town without one, as a corridor with no class is. A frozen record,
 * not a snapshot to refresh: if a later change moves these, it has changed an
 * untagged plan, and says why in its PR.
 */
const BEFORE = {
  mixed: '2b5b40a1',
  mixedUnclassed: '3d0fb8ab',
  houses: 'e8cab869',
  commercial: '21078cf3',
} as const;

describe('absent tags change nothing — #1790', () => {
  const classed = (
    town: ReturnType<typeof mixedTownFixture>,
    options: FootprintPlanOptions = {},
  ): readonly FootprintPlan[] => {
    const land = landClassMask(town.corridor);
    const urban = urbanClassMap(town.corridor, land, town.profile);
    return footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options)
      .plans;
  };

  it('plans every untagged town as before, storeys and all', () => {
    expect(planFingerprint(classed(mixedTownFixture()))).toBe(BEFORE.mixed);
    expect(planFingerprint(classed(houseStreetFixture()))).toBe(BEFORE.houses);
    expect(planFingerprint(classed(commercialStreetFixture()))).toBe(BEFORE.commercial);
    const town = mixedTownFixture();
    const land = landClassMask(town.corridor);
    expect(
      planFingerprint(footprintPlans(town.corridor, land, town.profile, town.origin).plans),
    ).toBe(BEFORE.mixedUnclassed);
  });

  it('control: the tagged street is not planned as its untagged self', () => {
    const tagged = mappedRoofStreetFixture();
    const stripped = untagged(tagged);
    expect(planFingerprint(classed(tagged))).not.toBe(planFingerprint(classed(stripped)));
  });
});

/** `town` with every #1789 field of every footprint `null`. */
function untagged<T extends { readonly corridor: WorldCorridor }>(town: T): T {
  return {
    ...town,
    corridor: {
      ...town.corridor,
      buildings: town.corridor.buildings.map((building) => ({
        ...building,
        ...NO_BUILDING_FIELDS,
      })),
    },
  };
}

describe('the lever — #1790', () => {
  it('ignores every tag over a fully tagged town with `mappedRoofShape: false`', () => {
    const town = mappedRoofStreetFixture();
    const land = landClassMask(town.corridor);
    const urban = urbanClassMap(town.corridor, land, town.profile);
    const plan = (
      corridor: WorldCorridor,
      options: FootprintPlanOptions,
    ): readonly FootprintPlan[] =>
      footprintPlans(corridor, land, town.profile, town.origin, undefined, urban, options).plans;
    const off = plan(town.corridor, { mappedRoofShape: false });
    const bare = plan(untagged(town).corridor, {});
    expect(off).toHaveLength(bare.length);
    expect(planFingerprint(off)).toBe(planFingerprint(bare));
    // Control: on, the tags are read — every roof:shape is drawn.
    const on = plan(town.corridor, {});
    const variants = new Set(on.map((each) => each.roofVariant));
    expect(variants).toContain('skillion');
    expect(on.some((each) => each.roof === 'flat')).toBe(true);
    expect(off.some((each) => each.roofVariant === 'skillion')).toBe(false);
  });
});

describe('the caps — #1790', () => {
  /** The largest rectangle and the largest split footprint the pitched rule admits, two storeys. */
  const LARGEST: readonly Omit<Site, 'tags'>[] = [
    ...Array.from({ length: 4 }, (_, index) => ({
      corners: rectangleBeside(0, 0, 24.8, 12),
      along: 300 + 40 * index,
      lateral: 24,
      height: 6.5,
    })),
    // #1785's U of 296 m² on three rectangles.
    ...Array.from({ length: 4 }, (_, index) => ({
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

  it.each(MAPPED_ROOF_SHAPES)(
    'holds a %s tag to 640 near and 200 far on the largest footprints',
    (shape) => {
      const plans = plansOf(
        LARGEST.map((site) => ({ ...site, tags: { roofShape: shape, roofLevels: 1 } })),
      );
      for (const plan of plans) {
        expect(plan.roof).toBe(MAPPED_ROOFS[shape].roof);
        expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
        expect(plan.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      }
      expect(
        plans.filter((plan) => (rectanglesOf(plan.footprint)?.length ?? 1) === 3),
      ).toHaveLength(4);
    },
  );

  it('falls back from a tagged variant to the plain gable, then to flat, never truncated', () => {
    const toothed = (maxVertices: number): FootprintPlan =>
      plansOf(
        [
          {
            corners: sawToothYou(),
            along: 1_000,
            lateral: 40,
            height: 4,
            tags: { roofShape: 'gambrel' },
          },
        ],
        {},
        maxVertices,
      )[0] as FootprintPlan;
    // Fewer of its vertices kept, the gambrel fits and is built.
    expect(toothed(60).roofVariant).toBe('gambrel');
    // More, a gambrel passes the far cap and the plain gable does not.
    const plain = toothed(86);
    expect(rectanglesOf(plain.footprint)).toHaveLength(3);
    expect(plain.roof).toBe('gable');
    expect(plain.roofVariant).toBe('plain');
    expect(plain.farTriangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
    // Past the plain roof too: flat.
    const flat = toothed(400);
    expect(flat.roof).toBe('flat');
    expect(flat.roofVariant).toBe('plain');
    // A wall for every edge of the ring as drawn: nothing cut away.
    expect(verticesOf(flat, 'wall').length / 6).toBe(flat.footprint.length / 2);
  });
});

describe('the mapped roof street — #1790', () => {
  it('carries every roof:shape, and every one is drawn as tagged', () => {
    const town = mappedRoofStreetFixture();
    const shapes = new Set(town.corridor.buildings.map((building) => building.roofShape));
    for (const shape of MAPPED_ROOF_SHAPES) expect(shapes).toContain(shape);
    const land = landClassMask(town.corridor);
    const { plans, verdicts } = footprintPlans(
      town.corridor,
      land,
      town.profile,
      town.origin,
      undefined,
      urbanClassMap(town.corridor, land, town.profile),
    );
    expect(verdicts.kept).toBe(town.corridor.buildings.length);
    plans.forEach((plan, index) => {
      const shape = town.corridor.buildings[index]?.roofShape ?? null;
      if (shape !== null) expect(plan.roof).toBe(MAPPED_ROOFS[shape].roof);
    });
  });
});
