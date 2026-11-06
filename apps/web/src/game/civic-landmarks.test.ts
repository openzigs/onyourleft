// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1795: a mapped town hall or school whose footprint holds the block is
 * drawn as one — brick, its front an odd number of bays with the door in the
 * middle one; a town hall's entry under a posted canopy and a cupola on its
 * ridge or roof. Held where a rider sees it: the plans `footprintPlans`
 * returns over #1795's street (`footprint-fixtures-testing.ts`
 * §`civicStreetFixture`) and the `wall`, `roof`, `trim` and `door` vertex
 * floats the belt uploads — the facade's bays and the skipped bay are what
 * the shader lays the windows by (`facade.ts`).
 */

import { describe, expect, it } from 'vitest';

import type { RoofMaterial, WallMaterial } from '@onyourleft/map-features';

import {
  FACADE_DOOR,
  FACADE_OFFSET,
  FOOTPRINT_MAX_FAR_TRIANGLES,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  STYLE_OFFSET,
  type FootprintPlan,
  type FootprintPlanOptions,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  CIVIC_FOOTPRINTS,
  civicStreetFixture,
  mixedTownFixture,
  rectangleBeside,
  planFingerprint,
  type CivicFootprint,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { surfaceOfRole } from './mapped-buildings';
import { ROAD_CLEARANCE_METRES } from './landform';
import { CIVIC_LANDMARK, civicLandmarkFits, civicLandmarkOf, CUPOLA } from './mapped-landmarks';
import { drawnRoadFrame } from './terrain';
import { urbanClassMap } from './urban-class';

const street = civicStreetFixture();

/** A `length` by `depth` rectangle about the hall's slot, 40 m out from the road. */
const rectangleOf = (length: number, depth: number) => rectangleBeside(1_000, 40, length, depth);

/**
 * The street planned with its urban class, by each footprint's name — since
 * #2206 with every footprint tagged `building:material=<wallMaterial>` when
 * one is given.
 */
function planStreet(
  options: FootprintPlanOptions = {},
  wallMaterial?: WallMaterial,
  roofMaterial?: RoofMaterial,
): Map<CivicFootprint['name'], FootprintPlan> {
  const corridor =
    wallMaterial === undefined && roofMaterial === undefined
      ? street.corridor
      : {
          ...street.corridor,
          buildings: street.corridor.buildings.map((building) => ({
            ...building,
            ...(wallMaterial === undefined ? {} : { wallMaterial }),
            ...(roofMaterial === undefined ? {} : { roofMaterial }),
          })),
        };
  const land = landClassMask(corridor);
  const { plans } = footprintPlans(
    corridor,
    land,
    street.profile,
    street.origin,
    undefined,
    urbanClassMap(corridor, land, street.profile),
    options,
  );
  expect(plans).toHaveLength(CIVIC_FOOTPRINTS.length);
  return new Map(plans.map((plan, index) => [street.rows[index]?.[0] ?? 'hall', plan]));
}

const civic = planStreet();
const before = planStreet({ landmarkCivic: false });
const BLOCKS = ['hall', 'flat-hall', 'school'] as const;
const HALLS = ['hall', 'flat-hall'] as const;

/** One vertex of a role, as the belt uploads it: position, and its facade and style floats. */
interface Vertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly u: number;
  readonly v: number;
  readonly top: number;
  readonly skip: number;
  readonly width: number;
}

function verticesOf(plan: FootprintPlan, role: FootprintRole): Vertex[] {
  const floats = plan.triangles[role];
  const out: Vertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    out.push({
      x: floats[at] as number,
      y: floats[at + 1] as number,
      z: floats[at + 2] as number,
      u: floats[at + FACADE_OFFSET] as number,
      v: floats[at + FACADE_OFFSET + 1] as number,
      top: floats[at + FACADE_OFFSET + 2] as number,
      skip: floats[at + FACADE_OFFSET + 3] as number,
      width: floats[at + STYLE_OFFSET + 2] as number,
    });
  }
  return out;
}

/** How far `(x, z)` stands out from the drawn road, on its normal's side when positive. */
function lateralOf(x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  let lateral = 0;
  for (let along = 950; along <= 1_400; along += 1) {
    const frame = drawnRoadFrame(street.profile, street.origin, along);
    if (frame === undefined) continue;
    const distance = Math.hypot(x - frame.x, z - frame.z);
    if (distance < best) {
      best = distance;
      lateral = (x - frame.x) * frame.normalX + (z - frame.z) * frame.normalZ;
    }
  }
  return lateral;
}

/**
 * The wall faces of a plan, each one quad's two triangles grouped by its `width` and
 * `skip`, with how many bays its facade spans and how long it is: the windowed walls.
 */
function windowedFaces(plan: FootprintPlan): { bays: number; skip: number; length: number }[] {
  const wall = verticesOf(plan, 'wall').filter((vertex) => vertex.top > 0 && vertex.width > 0);
  const faces: { bays: number; skip: number; length: number }[] = [];
  for (let at = 0; at + 5 < wall.length; at += 6) {
    const quad = wall.slice(at, at + 6);
    const bays = Math.max(...quad.map((vertex) => vertex.u));
    const xs = quad.map((vertex) => vertex.x);
    const zs = quad.map((vertex) => vertex.z);
    const length = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    faces.push({ bays, skip: quad[0]?.skip ?? -1, length });
  }
  return faces;
}

/** The front: the windowed face whose door bay is skipped, or none. */
const frontOf = (plan: FootprintPlan) => windowedFaces(plan).find((face) => face.skip >= 0);

/** The plan's highest roof vertex — a cupola's apex, where it has one. */
const apexOf = (plan: FootprintPlan): Vertex =>
  verticesOf(plan, 'roof').reduce((best, vertex) => (vertex.y > best.y ? vertex : best));

/** A cupola's drum: the wall vertices above the eaves, which a hip or a flat roof has none of. */
const drumOf = (plan: FootprintPlan): Vertex[] =>
  verticesOf(plan, 'wall').filter((vertex) => vertex.y > plan.eaves + 0.01);

/** The roof's top under any cupola — a flat roof's is its parapet's — or the roof's top. */
function roofTopOf(plan: FootprintPlan): number {
  const drum = drumOf(plan);
  const ceiling =
    drum.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...drum.map((vertex) => vertex.y));
  const under = [...verticesOf(plan, 'roof'), ...verticesOf(plan, 'parapet')].filter(
    (vertex) => vertex.y < ceiling - 0.01,
  );
  return Math.max(...under.map((vertex) => vertex.y));
}

/** A cupola's vertices: its drum's, and every roof vertex above the roof's top beneath it. */
const cupolaOf = (plan: FootprintPlan): Vertex[] => [
  ...drumOf(plan),
  ...verticesOf(plan, 'roof').filter((vertex) => vertex.y > roofTopOf(plan) + 0.01),
];

/** Whether `(x, z)` stands inside the plan's drawn footprint. */
function inside(plan: FootprintPlan, x: number, z: number): boolean {
  const ring = plan.footprint;
  const n = ring.length / 2;
  let within = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
}

describe('#1795: a town hall and a school, read back from the plan', () => {
  it('stands a town hall’s door in the middle bay of an odd front, its windows mirrored about it', () => {
    for (const name of HALLS) {
      const plan = civic.get(name) as FootprintPlan;
      const front = frontOf(plan);
      expect(front, name).toBeDefined();
      if (front === undefined) continue;
      expect(front.bays % 2, name).toBe(1);
      expect(front.skip, name).toBe((front.bays - 1) / 2);
      // The door's middle is the front's middle: the middle bay's.
      const doors = verticesOf(plan, 'door').filter((vertex) => vertex.y > plan.base);
      expect(doors.length, name).toBeGreaterThan(0);
      const mid = {
        x: doors.reduce((sum, vertex) => sum + vertex.x, 0) / doors.length,
        z: doors.reduce((sum, vertex) => sum + vertex.z, 0) / doors.length,
      };
      // The front face is the wall quad whose door bay is skipped; its middle is its corners'.
      const wall = verticesOf(plan, 'wall').filter((vertex) => vertex.top > 0 && vertex.width > 0);
      let faceMid: { x: number; z: number } | undefined;
      for (let at = 0; at + 5 < wall.length; at += 6) {
        const quad = wall.slice(at, at + 6);
        if ((quad[0]?.skip ?? -1) < 0) continue;
        const xs = quad.map((vertex) => vertex.x);
        const zs = quad.map((vertex) => vertex.z);
        faceMid = {
          x: (Math.max(...xs) + Math.min(...xs)) / 2,
          z: (Math.max(...zs) + Math.min(...zs)) / 2,
        };
      }
      expect(faceMid, name).toBeDefined();
      expect(Math.hypot(mid.x - (faceMid?.x ?? 0), mid.z - (faceMid?.z ?? 0)), name).toBeLessThan(
        0.5,
      );
    }
    // Control: the 21 m hall's front counts six bays before #1795, so no bay holds its door.
    const hall = frontOf(before.get('hall') as FootprintPlan);
    expect(hall).toBeUndefined();
    expect(windowedFaces(before.get('hall') as FootprintPlan).some((face) => face.bays === 6)).toBe(
      true,
    );
  });

  it('stands a cupola on a town hall’s ridge or flat roof, and its entry under a posted canopy', () => {
    for (const name of HALLS) {
      const plan = civic.get(name) as FootprintPlan;
      const cupola = cupolaOf(plan);
      expect(cupola.length, name).toBeGreaterThan(0);
      const apex = apexOf(plan);
      expect(apex.y - roofTopOf(plan), name).toBeCloseTo(CUPOLA.drum + CUPOLA.cap, 3);
      // Seated: the drum's foot is sunk into the roof, at or below its top and no further
      // than the drum's half-width, so no gap shows under it.
      // The drum is the only wall near the apex: the building's own walls stand at its edge.
      const foot = Math.min(
        ...verticesOf(plan, 'wall')
          .filter(
            (vertex) =>
              Math.hypot(vertex.x - apex.x, vertex.z - apex.z) <= Math.SQRT2 * CUPOLA.half + 1e-3,
          )
          .map((vertex) => vertex.y),
      );
      expect(foot, name).toBeLessThanOrEqual(roofTopOf(plan) + 1e-3);
      expect(foot, name).toBeGreaterThanOrEqual(roofTopOf(plan) - CUPOLA.half - 1e-3);
      // On the roof, at the footprint's middle, the drum no wider than the cupola's.
      for (const vertex of cupola) {
        expect(inside(plan, vertex.x, vertex.z), name).toBe(true);
        expect(Math.hypot(vertex.x - apex.x, vertex.z - apex.z), name).toBeLessThanOrEqual(
          Math.SQRT2 * CUPOLA.half + 1e-3,
        );
      }
      // The canopy: trim standing on posts from the floor in front of the door.
      const doors = verticesOf(plan, 'door');
      const floor = Math.min(...doors.map((vertex) => vertex.y));
      const mx = doors.reduce((sum, vertex) => sum + vertex.x, 0) / doors.length;
      const mz = doors.reduce((sum, vertex) => sum + vertex.z, 0) / doors.length;
      const posts = verticesOf(plan, 'trim').filter(
        (vertex) => vertex.y <= floor + 1e-3 && Math.hypot(vertex.x - mx, vertex.z - mz) < 3,
      );
      expect(posts.length, name).toBeGreaterThan(0);
    }
    // The hipped hall's cupola stands on its ridge: the hip's top, at the rectangle's middle.
    const hall = civic.get('hall') as FootprintPlan;
    expect(hall.roof).toBe('hip');
    expect(civic.get('flat-hall')?.roof).toBe('flat');
    // Control: before #1795, neither has a cupola.
    for (const name of HALLS)
      expect(cupolaOf(before.get(name) as FootprintPlan), name).toHaveLength(0);
  });

  it('gives a school a window in every bay of every storey but its door’s, and no cupola', () => {
    const school = civic.get('school') as FootprintPlan;
    const faces = windowedFaces(school);
    const front = frontOf(school);
    expect(front).toBeDefined();
    if (front === undefined) return;
    expect(front.bays % 2).toBe(1);
    expect(front.skip).toBe((front.bays - 1) / 2);
    // Every other face skips none, and every face is whole bays up to its eaves.
    expect(faces.filter((face) => face.skip >= 0)).toHaveLength(1);
    for (const face of faces) expect(face.bays).toBeGreaterThanOrEqual(1);
    const tops = verticesOf(school, 'wall').filter((vertex) => vertex.top > 0);
    // Its windows' facade reaches every storey: up to its eaves, at least its storeys.
    expect(Math.max(...tops.map((vertex) => vertex.top))).toBeGreaterThanOrEqual(school.storeys);
    expect(cupolaOf(school)).toHaveLength(0);
    expect(school.surfaces.wall).toBe('brick');
    // Control: before #1795 its 36 m front counts ten bays, and none holds the door.
    expect(frontOf(before.get('school') as FootprintPlan)).toBeUndefined();
  });

  it('keeps every cupola vertex on the footprint and off the road', () => {
    for (const name of HALLS) {
      const plan = civic.get(name) as FootprintPlan;
      for (const vertex of cupolaOf(plan)) {
        expect(inside(plan, vertex.x, vertex.z), name).toBe(true);
        expect(Math.abs(lateralOf(vertex.x, vertex.z)), name).toBeGreaterThanOrEqual(
          ROAD_CLEARANCE_METRES,
        );
      }
    }
  });

  it('walls every town hall and school in brick', () => {
    for (const name of BLOCKS) expect(civic.get(name)?.surfaces.wall, name).toBe('brick');
    // Not vacuous: before #1795 the hipped hall's seeded draw is render.
    expect(before.get('hall')?.surfaces.wall).toBe('render');
  });

  it('puts a mapped `building:material` ahead of the civic brick — #2206', () => {
    // #1795 asks it: a town hall tagged plaster is rendered; untagged, brick.
    const plastered = planStreet({}, 'plaster');
    for (const name of BLOCKS) {
      expect(plastered.get(name)?.surfaces.wall, name).toBe('render');
      expect(civic.get(name)?.surfaces.wall, name).toBe('brick');
    }
    // The halls still stand their cupolas, so the tag changed the walls and
    // the order is what is being read.
    for (const name of HALLS) {
      expect(cupolaOf(plastered.get(name) as FootprintPlan).length, name).toBeGreaterThan(0);
    }
    // With the mapped paint lever off the tag is not read, and the brick is back.
    const unread = planStreet({ mappedPaint: false }, 'plaster');
    for (const name of BLOCKS) expect(unread.get(name)?.surfaces.wall, name).toBe('brick');
  });

  it('keeps a cupola’s spire in slate under a tagged roof material — #2206', () => {
    const tagged = planStreet({}, undefined, 'metal');
    const hall = tagged.get('hall') as FootprintPlan;
    // The tag reaches the hipped hall's roof, and the cupola on it stays slate.
    expect(hall.surfaces.roof).toBe('corrugated');
    expect(hall.triangles.spire.length).toBeGreaterThan(0);
    expect(surfaceOfRole(hall, 'spire')).toBe('slate');
    // A flat roof reads no tag (#1792), so its cupola is its roof's, as before.
    const flat = tagged.get('flat-hall') as FootprintPlan;
    expect(flat.triangles.spire).toHaveLength(0);
    expect(cupolaOf(flat).length).toBe(cupolaOf(civic.get('flat-hall') as FootprintPlan).length);
  });

  it('keeps a footprint the block does not fit as #1791’s civic block', () => {
    for (const name of ['small-hall', 'thin-school'] as const) {
      expect(planFingerprint([civic.get(name) as FootprintPlan]), name).toBe(
        planFingerprint([before.get(name) as FootprintPlan]),
      );
    }
    expect(civicLandmarkFits({ area: 90, rectangularity: 1 })).toBe(false);
    expect(civicLandmarkFits({ area: 204, rectangularity: 0.51 })).toBe(false);
    expect(civicLandmarkFits({ area: CIVIC_LANDMARK.leastArea, rectangularity: 0.6 })).toBe(true);
  });

  it('reads a town hall and a school from the landmark, then the type, and nothing else', () => {
    expect(civicLandmarkOf('school', 'townhall')).toBe('townhall');
    expect(civicLandmarkOf('townhall', 'school')).toBe('school');
    expect(civicLandmarkOf('school', null)).toBe('school');
    for (const type of ['townhall', 'civic', 'government'] as const) {
      expect(civicLandmarkOf(type, null), type).toBe('townhall');
    }
    expect(civicLandmarkOf('church', null)).toBeUndefined();
    expect(civicLandmarkOf('townhall', 'worship')).toBeUndefined();
    // A place of worship by type is never a civic landmark, whatever its landmark says.
    for (const type of ['church', 'chapel', 'cathedral'] as const) {
      expect(civicLandmarkOf(type, 'townhall'), type).toBeUndefined();
      expect(civicLandmarkOf(type, 'school'), type).toBeUndefined();
    }
    expect(civicLandmarkOf(null, null)).toBeUndefined();
  });

  it('gives neither a decoration: no front step, and only a plain painted door', () => {
    for (const name of BLOCKS) {
      const plan = civic.get(name) as FootprintPlan;
      expect(plan.frontStep, name).toBeUndefined();
      expect(plan.porch, name).toBe(false);
      expect(
        verticesOf(plan, 'door').some((vertex) => vertex.top === FACADE_DOOR),
        name,
      ).toBe(false);
    }
  });

  it('holds every one inside 640 near and 200 far triangles, the cupola on the far level', () => {
    for (const name of BLOCKS) {
      const plan = civic.get(name) as FootprintPlan;
      expect(plan.triangleCount, name).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
      expect(plan.farTriangleCount, name).toBeLessThanOrEqual(FOOTPRINT_MAX_FAR_TRIANGLES);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.wall);
      expect(FOOTPRINT_SURFACES).toContain(plan.surfaces.roof);
    }
    // The cupola's drum and cap are wall and roof: 12 triangles more on the far level.
    const hall = civic.get('hall') as FootprintPlan;
    expect(hall.farTriangleCount - (before.get('hall') as FootprintPlan).farTriangleCount).toBe(12);
  });
});

/** The street planned with its first footprint (the hall) replaced by `patch` and `corners`. */
function planHallWith(
  patch: Partial<(typeof street.corridor.buildings)[number]>,
  corners?: readonly (readonly [number, number])[],
  options: FootprintPlanOptions = {},
): FootprintPlan {
  const land = landClassMask(street.corridor);
  const [hall, ...rest] = street.corridor.buildings;
  const replaced = {
    ...(hall as (typeof street.corridor.buildings)[number]),
    ...(corners === undefined
      ? {}
      : { rings: buildingBeside(street.profile, street.origin, [corners], 7).rings }),
    ...patch,
  };
  const corridor = { ...street.corridor, buildings: [replaced, ...rest] };
  const { plans } = footprintPlans(
    corridor,
    land,
    street.profile,
    street.origin,
    undefined,
    urbanClassMap(corridor, land, street.profile),
    options,
  );
  return plans[0] as FootprintPlan;
}

describe('#1795: where the block is not drawn', () => {
  it('draws a church-typed footprint tagged townhall as a church, never as a civic block', () => {
    const church = planHallWith({ buildingType: 'church', landmark: 'townhall' });
    const plain = planHallWith({ buildingType: 'church', landmark: null });
    expect(planFingerprint([church])).toBe(planFingerprint([plain]));
    expect(church.farTriangleCount).toBe(plain.farTriangleCount);
  });

  it('leaves a cupola off a roof whose ridge is off-centre', () => {
    for (const roofShape of ['skillion', 'saltbox'] as const) {
      const plan = planHallWith({ roofShape });
      // A cupola is 12 far triangles (drum and cap); the lever off draws none.
      const without = planHallWith({ roofShape }, undefined, { landmarkCivic: false });
      expect(plan.farTriangleCount, roofShape).toBe(without.farTriangleCount);
    }
  });

  it('leaves a cupola off a footprint too thin to hold its drum', () => {
    const thin = rectangleOf(60, 2);
    const plan = planHallWith({}, thin);
    const without = planHallWith({}, thin, { landmarkCivic: false });
    expect(plan.farTriangleCount).toBe(without.farTriangleCount);
    // Control: a footprint wide enough for the drum keeps it.
    const wide = planHallWith({}, rectangleOf(60, 10));
    const wideWithout = planHallWith({}, rectangleOf(60, 10), { landmarkCivic: false });
    expect(wide.farTriangleCount - wideWithout.farTriangleCount).toBe(12);
  });
});

/**
 * {@link civicStreetFixture}'s plans' fingerprint, paint included, planned with its urban
 * class, measured with #1794's `footprint-buildings.ts` (14e3dd72) — before #1795.
 */
const CIVIC_STREET_BEFORE_1795 = 'c53e22eb';

/** {@link mixedTownFixture}'s, likewise: it has no mapped town hall or school. */
const MIXED_TOWN_BEFORE_1795 = '2b5b40a1';

describe('#1795: the lever, and a town with no town hall', () => {
  it('plans every town hall and school as before #1795 with `landmarkCivic: false`', () => {
    expect(planFingerprint([...before.values()])).toBe(CIVIC_STREET_BEFORE_1795);
    expect(planFingerprint([...civic.values()])).not.toBe(CIVIC_STREET_BEFORE_1795);
  });

  it('plans the mixed town as before #1795', () => {
    const town = mixedTownFixture();
    const land = landClassMask(town.corridor);
    const { plans } = footprintPlans(
      town.corridor,
      land,
      town.profile,
      town.origin,
      undefined,
      urbanClassMap(town.corridor, land, town.profile),
    );
    expect(planFingerprint(plans)).toBe(MIXED_TOWN_BEFORE_1795);
  });
});
