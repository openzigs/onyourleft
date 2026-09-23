// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `buildings.ts` — doors, windows, eaves, chimneys and a second proportion for
 * every building, #500.
 *
 * Every claim #500 makes a criterion of is asserted against the TRIANGLES the
 * plan builds, not against the table of openings it also returns: a table can
 * say a window is recessed while the geometry draws it flush with the wall,
 * and the geometry is what a rider sees. The table is read only to say WHERE
 * to look.
 */

import { describe, expect, it } from 'vitest';

import {
  BUILDING_ROLES,
  BUILDING_VARIANTS,
  BUILT_KINDS,
  DOOR,
  FIRST_FLOOR_METRES,
  FRAME_PROJECTION_METRES,
  FRAME_WIDTH_METRES,
  OPENING_RECESS_METRES,
  PLINTH_TOP_METRES,
  SILL_HEIGHTS,
  SILL_PROJECTION_METRES,
  WINDOW,
  buildingPlan,
  planTriangles,
  type BuildingPlan,
  type BuildingRole,
  type BuiltKind,
  type PlannedOpening,
  type Point,
} from './buildings';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed, type ScatterItem } from './scatter';
import { STRUCTURE_FOOTPRINTS, structuresAt } from './settlements';
import { corridorOrigin } from './terrain';

const VARIANTS = Array.from({ length: BUILDING_VARIANTS }, (_, variant) => variant);

/** Every plan there is: each built kind in each of its shapes. */
const PLANS: readonly BuildingPlan[] = BUILT_KINDS.flatMap((kind) =>
  VARIANTS.map((variant) => buildingPlan(kind, variant)),
);

/** A plan's triangles in one role, as corner triples. */
function trianglesOf(plan: BuildingPlan, role: BuildingRole): (readonly [Point, Point, Point])[] {
  const flat = plan.triangles[role];
  const found: (readonly [Point, Point, Point])[] = [];
  for (let at = 0; at + 8 < flat.length; at += 9) {
    const corner = (offset: number): Point => [
      flat[at + offset] as number,
      flat[at + offset + 1] as number,
      flat[at + offset + 2] as number,
    ];
    found.push([corner(0), corner(3), corner(6)]);
  }
  return found;
}

/** A triangle's normal, from its winding — the side a back-face-culling material draws. */
function normalOf([a, b, c]: readonly [Point, Point, Point]): Point {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  const n: Point = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...n);
  return [n[0] / length, n[1] / length, n[2] / length];
}

const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A point in an opening's face's own coordinates: along it, up it, and out from it. */
function inFace(opening: PlannedOpening, point: Point): { u: number; v: number; w: number } {
  const offset: Point = [
    point[0] - opening.face.origin[0],
    point[1] - opening.face.origin[1],
    point[2] - opening.face.origin[2],
  ];
  return { u: dot(offset, opening.face.right), v: offset[1], w: dot(offset, opening.face.normal) };
}

/** The rectangle an opening's outline stands in. */
function boundsOf(opening: PlannedOpening): { u0: number; u1: number; v0: number; v1: number } {
  const us = opening.outline.map(([u]) => u);
  const vs = opening.outline.map(([, v]) => v);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** Every vertex of a role that lies over an opening — inside its outline's rectangle, near its wall. */
function verticesOver(
  plan: BuildingPlan,
  role: BuildingRole,
  opening: PlannedOpening,
  margin = 0,
): { u: number; v: number; w: number }[] {
  const bounds = boundsOf(opening);
  const eps = 1e-6;
  return trianglesOf(plan, role)
    .flat()
    .map((point) => inFace(opening, point))
    .filter(
      ({ u, v, w }) =>
        u >= bounds.u0 - margin - eps &&
        u <= bounds.u1 + margin + eps &&
        v >= bounds.v0 - margin - eps &&
        v <= bounds.v1 + margin + eps &&
        Math.abs(w) < 0.4,
    );
}

const FRONT: Point = [0, 0, 1];
const facesFront = (opening: PlannedOpening): boolean => dot(opening.face.normal, FRONT) > 0.999;

describe('every building has openings on its road-facing side — #500', () => {
  const front = (kind: BuiltKind, variant: number): readonly PlannedOpening[] =>
    buildingPlan(kind, variant).openings.filter(facesFront);

  it('gives a house a door and windows on its front, in both its shapes', () => {
    for (const variant of VARIANTS) {
      const openings = front('building', variant);
      expect(
        openings.filter((each) => each.kind === 'door'),
        String(variant),
      ).toHaveLength(1);
      expect(
        openings.filter((each) => each.kind === 'window').length,
        String(variant),
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives a barn a pair of great doors on its front', () => {
    for (const variant of VARIANTS) {
      const doors = front('barn', variant).filter((each) => each.kind === 'door');
      const widest = Math.max(...doors.map((each) => boundsOf(each).u1 - boundsOf(each).u0));
      expect(widest, String(variant)).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives a church a tall arched window on its front', () => {
    for (const variant of VARIANTS) {
      const tall = front('church', variant).filter((each) => {
        const bounds = boundsOf(each);
        return (
          each.kind === 'window' &&
          each.arched &&
          bounds.v1 - bounds.v0 >= 2 * (bounds.u1 - bounds.u0)
        );
      });
      expect(tall.length, String(variant)).toBeGreaterThan(0);
    }
  });

  it('gives a row of shops a shopfront: a wide pane at ground level', () => {
    for (const variant of VARIANTS) {
      const shopfronts = front('shop-row', variant).filter((each) => {
        const bounds = boundsOf(each);
        return each.kind === 'window' && bounds.v0 < 1.2 && bounds.u1 - bounds.u0 >= 3;
      });
      expect(shopfronts.length, String(variant)).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaves the shed plain, as decided', () => {
    // #500 allows it, stated as a decision in `buildings.ts` §`shed`: a field
    // shed is open on the side away from the road. Pinned, so a door that
    // arrives on one arrives on purpose.
    for (const variant of VARIANTS) {
      expect(buildingPlan('shed', variant).openings).toEqual([]);
    }
  });

  it('draws that glass and those doors facing the road, in the triangles themselves', () => {
    // The table above says an opening is there; this says something is DRAWN
    // there, facing +z, so a culling material shows it to the road.
    for (const kind of ['building', 'church', 'shop-row'] as const) {
      for (const variant of VARIANTS) {
        const plan = buildingPlan(kind, variant);
        const facing = trianglesOf(plan, 'glass').filter(
          (triangle) => dot(normalOf(triangle), FRONT) > 0.999,
        );
        expect(facing.length, `${kind} ${String(variant)}`).toBeGreaterThan(0);
      }
    }
    for (const variant of VARIANTS) {
      const doors = trianglesOf(buildingPlan('barn', variant), 'door').filter(
        (triangle) => dot(normalOf(triangle), FRONT) > 0.999,
      );
      expect(doors.length, String(variant)).toBeGreaterThan(0);
    }
  });
});

describe('openings are recessed and framed — #500', () => {
  it('sets every pane and every door leaf behind its wall, by the recess, facing out', () => {
    let checked = 0;
    for (const plan of PLANS) {
      for (const opening of plan.openings) {
        const role = opening.kind === 'window' ? 'glass' : 'door';
        const leaf = verticesOver(plan, role, opening).filter(({ w }) => w < 0.2);
        expect(leaf.length, `${plan.kind} ${opening.kind}`).toBeGreaterThanOrEqual(3);
        for (const { w } of leaf) {
          expect(w, `${plan.kind} ${opening.kind}`).toBeCloseTo(-OPENING_RECESS_METRES, 6);
        }
        checked += 1;
      }
      for (const triangle of [...trianglesOf(plan, 'glass'), ...trianglesOf(plan, 'door')]) {
        // Facing out of its wall, so a culling material draws it to the road.
        expect(
          plan.openings.some((opening) => dot(normalOf(triangle), opening.face.normal) > 0.999),
          plan.kind,
        ).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(40);
    // #500: "recessed about 8–10 cm". A pane at zero is a decal.
    expect(OPENING_RECESS_METRES).toBeGreaterThanOrEqual(0.08);
    expect(OPENING_RECESS_METRES).toBeLessThanOrEqual(0.1);
  });

  it('lines every opening with a reveal from the frame back to the pane', () => {
    for (const plan of PLANS) {
      for (const opening of plan.openings) {
        const reveal = verticesOver(plan, 'wall', opening).filter(
          ({ w }) => w < -OPENING_RECESS_METRES / 2,
        );
        expect(reveal.length, `${plan.kind} ${opening.kind}`).toBeGreaterThan(0);
      }
    }
  });

  it('stands every frame proud of its wall, and every window’s sill further', () => {
    for (const plan of PLANS) {
      for (const opening of plan.openings) {
        const bounds = boundsOf(opening);
        const label = `${plan.kind} ${String(plan.variant)} ${opening.kind}`;
        const near = (point: Point): boolean => {
          const { u, v } = inFace(opening, point);
          const reach = FRAME_WIDTH_METRES + 0.1;
          return (
            u > bounds.u0 - reach &&
            u < bounds.u1 + reach &&
            v > bounds.v0 - reach &&
            v < bounds.v1 + reach
          );
        };
        const joinery = trianglesOf(plan, 'joinery').filter((triangle) => triangle.every(near));
        // The frame's FACE: joinery facing out of the wall, every corner at the
        // projection, around the sides and the head — at least two triangles an edge.
        const face = joinery.filter(
          (triangle) =>
            dot(normalOf(triangle), opening.face.normal) > 0.999 &&
            triangle.every(
              (point) =>
                Math.abs(inFace(opening, point).w - FRAME_PROJECTION_METRES) < 1e-6 &&
                inFace(opening, point).v > bounds.v0 - 1e-6,
            ),
        );
        expect(face.length, label).toBeGreaterThanOrEqual(2 * 3);
        if (opening.kind === 'window') {
          // The sill: a face below the opening, facing out, further out than the frame.
          const sill = joinery.filter(
            (triangle) =>
              dot(normalOf(triangle), opening.face.normal) > 0.999 &&
              triangle.every(
                (point) =>
                  Math.abs(inFace(opening, point).w - SILL_PROJECTION_METRES) < 1e-6 &&
                  inFace(opening, point).v <= bounds.v0 + 1e-6,
              ),
          );
          expect(sill.length, label).toBeGreaterThanOrEqual(2);
        }
      }
    }
    expect(FRAME_PROJECTION_METRES).toBeGreaterThan(0);
    expect(SILL_PROJECTION_METRES).toBeGreaterThan(FRAME_PROJECTION_METRES);
    expect(SILL_PROJECTION_METRES).toBeCloseTo(0.05, 6);
  });

  it('cuts the wall where the opening is, rather than drawing a window over it', () => {
    // A decal in its other form: the pane recessed, and the wall still drawn
    // across its front. No wall triangle in the wall's own face may cover the
    // middle of an opening.
    for (const plan of PLANS) {
      for (const opening of plan.openings) {
        const bounds = boundsOf(opening);
        const middle = { u: (bounds.u0 + bounds.u1) / 2, v: (bounds.v0 + bounds.v1) / 2 };
        expect(coveredBy(plan, opening, middle), `${plan.kind} ${opening.kind}`).toBe(false);
      }
    }
  });
});

/** Whether a wall triangle in an opening's own face covers a point of that face. */
function coveredBy(
  plan: BuildingPlan,
  opening: PlannedOpening,
  at: { readonly u: number; readonly v: number },
): boolean {
  return trianglesOf(plan, 'wall').some((triangle) => {
    const [a, b, c] = triangle.map((point) => inFace(opening, point)) as [
      ReturnType<typeof inFace>,
      ReturnType<typeof inFace>,
      ReturnType<typeof inFace>,
    ];
    if (![a, b, c].every(({ w }) => Math.abs(w) < 1e-6)) return false;
    const side = (p: typeof a, q: typeof a): number =>
      (q.u - p.u) * (at.v - p.v) - (q.v - p.v) * (at.u - p.u);
    const [ab, bc, ca] = [side(a, b), side(b, c), side(c, a)];
    return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
  });
}

describe('openings are laid out in metres — #500', () => {
  it('gives every house window the same size, and one sill height a storey', () => {
    const windows = VARIANTS.flatMap((variant) =>
      buildingPlan('building', variant).openings.filter((each) => each.kind === 'window'),
    );
    expect(windows.length).toBeGreaterThan(10);
    for (const opening of windows) {
      const bounds = boundsOf(opening);
      expect(bounds.u1 - bounds.u0).toBeCloseTo(WINDOW.width, 6);
      expect(bounds.v1 - bounds.v0).toBeCloseTo(WINDOW.height, 6);
      expect(
        SILL_HEIGHTS.some((sill) => Math.abs(bounds.v0 - sill) < 1e-6),
        String(bounds.v0),
      ).toBe(true);
    }
    // Both storeys are used, so "one sill height a storey" is not one storey.
    expect(new Set(windows.map((each) => boundsOf(each).v0.toFixed(3))).size).toBe(2);
    for (const opening of VARIANTS.flatMap((variant) =>
      buildingPlan('building', variant).openings.filter((each) => each.kind === 'door'),
    )) {
      const bounds = boundsOf(opening);
      expect(bounds.u1 - bounds.u0).toBeCloseTo(DOOR.width, 6);
      expect(bounds.v0).toBeCloseTo(PLINTH_TOP_METRES, 6);
    }
    expect(FIRST_FLOOR_METRES).toBeGreaterThan(SILL_HEIGHTS[0] + WINDOW.height);
    expect(FIRST_FLOOR_METRES).toBeLessThan(SILL_HEIGHTS[1]);
  });

  it('keeps every opening and its frame inside its wall, off the ground and clear of every floor', () => {
    let checked = 0;
    for (const plan of PLANS) {
      for (const opening of plan.openings) {
        const bounds = boundsOf(opening);
        const label = `${plan.kind} ${String(plan.variant)} ${opening.kind} at ${bounds.u0.toFixed(2)}`;
        const below = opening.kind === 'window' ? 0.07 : 0;
        expect(bounds.u0 - FRAME_WIDTH_METRES, label).toBeGreaterThanOrEqual(opening.wall.uMin);
        expect(bounds.u1 + FRAME_WIDTH_METRES, label).toBeLessThanOrEqual(opening.wall.uMax);
        expect(bounds.v1 + FRAME_WIDTH_METRES, label).toBeLessThanOrEqual(opening.wall.vMax);
        expect(bounds.v0 - below, label).toBeGreaterThanOrEqual(opening.wall.vMin);
        expect(bounds.v0, label).toBeGreaterThanOrEqual(PLINTH_TOP_METRES);
        for (const floor of opening.floors) {
          const crosses = bounds.v0 - below < floor && bounds.v1 + FRAME_WIDTH_METRES > floor;
          expect(crosses, `${label} crosses the floor at ${String(floor)}`).toBe(false);
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('never lets two openings on one wall run into each other, frames included', () => {
    for (const plan of PLANS) {
      plan.openings.forEach((first, index) => {
        for (const second of plan.openings.slice(index + 1)) {
          if (dot(first.face.normal, second.face.normal) < 0.999) continue;
          if (
            Math.abs(
              dot(first.face.origin, first.face.normal) -
                dot(second.face.origin, second.face.normal),
            ) > 1e-6
          )
            continue;
          const a = boundsOf(first);
          const b = boundsOf(second);
          const shift = inFace(first, second.face.origin).u;
          const gap = FRAME_WIDTH_METRES * 2;
          const apart =
            a.u1 + gap <= b.u0 + shift ||
            b.u1 + shift + gap <= a.u0 ||
            a.v1 + gap <= b.v0 ||
            b.v1 + gap <= a.v0;
          expect(apart, `${plan.kind} ${String(plan.variant)}`).toBe(true);
        }
      });
    }
  });
});

describe('which windows a house has is seeded and stateless — #500', () => {
  it('builds the same shape every time it is asked', () => {
    for (const kind of BUILT_KINDS) {
      for (const variant of VARIANTS) {
        expect(buildingPlan(kind, variant)).toEqual(buildingPlan(kind, variant));
      }
    }
  });

  it('reads a variant past its shapes as a belt does, modulo them', () => {
    // `settlements.ts` draws a variant from six slots; a belt folds it onto the
    // shapes it has, and so does the plan.
    for (let slot = 0; slot < 6; slot += 1) {
      expect(buildingPlan('building', slot)).toEqual({
        ...buildingPlan('building', slot % BUILDING_VARIANTS),
        variant: slot % BUILDING_VARIANTS,
      });
    }
  });

  it('gives a house the same shape on every build of the world, and both shapes across a village', () => {
    // The variant is `settlements.ts`' own, drawn from `seeded.ts` on a stream
    // of its own; the shape a house wears is that variant, so it is a function
    // of where the house stands.
    const LONG = 20_000;
    const farmland = northRoute(LONG, () => 50);
    const houses = (): readonly ScatterItem[] =>
      structuresAt(farmland, corridorOrigin(farmland), scatterSeed(farmland), 0, LONG, {
        maxItems: 1_000_000,
        riderMetres: 0,
      }).filter((item) => item.kind === 'building');
    const first = houses();
    const again = houses();
    expect(first.length).toBeGreaterThan(20);
    expect(again.map((item) => item.variant)).toEqual(first.map((item) => item.variant));
    const shapes = new Set(first.map((item) => item.variant % BUILDING_VARIANTS));
    expect(shapes.size).toBe(BUILDING_VARIANTS);
  });
});

describe('detail beyond the openings — #500', () => {
  /** A role's extent, building-local. */
  const extentOf = (plan: BuildingPlan, roles: readonly BuildingRole[]) => {
    const points = roles.flatMap((role) => trianglesOf(plan, role).flat());
    const along = (axis: 0 | 1 | 2) => points.map((point) => point[axis]);
    return {
      x: [Math.min(...along(0)), Math.max(...along(0))] as const,
      y: [Math.min(...along(1)), Math.max(...along(1))] as const,
      z: [Math.min(...along(2)), Math.max(...along(2))] as const,
    };
  };

  it('overhangs the walls with the roof, by more than the lid it used to be', () => {
    // #500: "The roof currently overhangs the walls by only 0.3 m, which reads
    // as a lid on a box." Measured at the eaves along z, where the rain runs
    // off, on every pitched roof.
    for (const plan of PLANS) {
      const walls = extentOf(plan, ['wall']);
      const roof = extentOf(plan, ['roof']);
      const over = Math.max(walls.z[0] - roof.z[0], roof.z[1] - walls.z[1]);
      expect(over, `${plan.kind} ${String(plan.variant)}`).toBeGreaterThanOrEqual(0.2);
    }
    for (const variant of VARIANTS) {
      const house = buildingPlan('building', variant);
      const walls = extentOf(house, ['wall']);
      const roof = extentOf(house, ['roof']);
      expect(roof.z[1] - walls.z[1]).toBeGreaterThanOrEqual(0.45);
      // At the verge, less the 3 cm a side window's reveal stands out with its frame.
      expect(roof.x[1] - walls.x[1]).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('puts a chimney on every house, standing above its ridge', () => {
    for (const variant of VARIANTS) {
      const house = buildingPlan('building', variant);
      expect(house.triangles.chimney.length).toBeGreaterThan(0);
      expect(extentOf(house, ['chimney']).y[1]).toBeGreaterThan(extentOf(house, ['ridge']).y[1]);
    }
  });

  it('caps every pitched roof with a ridge, and stands every building on a plinth', () => {
    for (const plan of PLANS) {
      const label = `${plan.kind} ${String(plan.variant)}`;
      expect(plan.triangles.plinth.length, label).toBeGreaterThan(0);
      const plinth = extentOf(plan, ['plinth']);
      expect(plinth.y[1], label).toBeCloseTo(PLINTH_TOP_METRES, 6);
      // A shed's roof is a single pitch, which has no ridge to cap.
      if (plan.kind !== 'shed') expect(plan.triangles.ridge.length, label).toBeGreaterThan(0);
    }
  });

  it('gives every kind two proportions, so a farmstead is not one house repeated', () => {
    for (const kind of BUILT_KINDS) {
      const [first, second] = VARIANTS.map((variant) =>
        extentOf(buildingPlan(kind, variant), BUILDING_ROLES),
      );
      const differs = (['x', 'y', 'z'] as const).some(
        (axis) =>
          Math.abs(
            (first?.[axis][1] ?? 0) -
              (first?.[axis][0] ?? 0) -
              ((second?.[axis][1] ?? 0) - (second?.[axis][0] ?? 0)),
          ) >= 0.5,
      );
      expect(differs, kind).toBe(true);
    }
  });
});

describe('what the detail may cost, and where it may stand — #500', () => {
  it('keeps every vertex of every shape inside the footprint `settlements.ts` keeps clear', () => {
    // Which is why the arrangement does not move: a shape that outgrew its
    // footprint would stand its eaves over ground the placement never checked.
    for (const plan of PLANS) {
      const footprint = STRUCTURE_FOOTPRINTS[plan.kind];
      for (const role of BUILDING_ROLES) {
        for (const [x, , z] of trianglesOf(plan, role).flat()) {
          const label = `${plan.kind} ${String(plan.variant)} ${role}`;
          expect(Math.abs(x), label).toBeLessThanOrEqual(footprint.x + 1e-9);
          expect(z, label).toBeGreaterThanOrEqual(footprint.back - 1e-9);
          expect(z, label).toBeLessThanOrEqual(footprint.front + 1e-9);
        }
      }
    }
  });

  it('draws no triangle with no area', () => {
    for (const plan of PLANS) {
      for (const role of BUILDING_ROLES) {
        for (const triangle of trianglesOf(plan, role)) {
          expect(Number.isFinite(normalOf(triangle)[0]), `${plan.kind} ${role}`).toBe(true);
        }
      }
    }
  });

  it('counts its own triangles', () => {
    for (const plan of PLANS) {
      expect(planTriangles(plan)).toBe(
        BUILDING_ROLES.reduce((sum, role) => sum + trianglesOf(plan, role).length, 0),
      );
    }
  });
});

describe('the same shapes with no openings — the browser gate’s control', () => {
  it('draws no pane, no door and no opening, and a whole wall where the windows were', () => {
    for (const kind of BUILT_KINDS) {
      for (const variant of VARIANTS) {
        const plain = buildingPlan(kind, variant, { openings: false });
        expect(plain.openings).toEqual([]);
        expect(plain.triangles.glass).toEqual([]);
        expect(plain.triangles.door).toEqual([]);
        // Where the first opening was, the plain wall is drawn.
        const cut = buildingPlan(kind, variant).openings[0];
        if (cut === undefined) continue;
        const bounds = boundsOf(cut);
        const covered = coveredBy(plain, cut, {
          u: (bounds.u0 + bounds.u1) / 2,
          v: (bounds.v0 + bounds.v1) / 2,
        });
        expect(covered, `${kind} ${String(variant)}`).toBe(true);
      }
    }
  });
});
