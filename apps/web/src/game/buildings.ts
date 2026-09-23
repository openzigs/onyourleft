// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The buildings as shapes: walls with their doors and windows cut into them,
 * roofs that overhang, and the detail a road user reads a building by — #500.
 *
 * ## Why this file exists
 *
 * Until #500 every building was a box under a gable. On the owner's tablet
 * (validation 0002 Part Z step Z9, 2026-09-23) the first farmstead read as a
 * brick box and a board box: the surfaces were right and the SHAPE was not. A
 * road user reads a building by its openings, and a brick box with no door is
 * a pumping station, not a farmhouse. Nobody had decided against openings;
 * nobody had considered them.
 *
 * ## What it is, and what it is not
 *
 * A pure function from a kind and a variant to **triangles in metres, sorted
 * by what each is made of** ({@link BuildingRole}), plus a record of every
 * opening it cut ({@link PlannedOpening}) so a test can hold the layout to
 * rules rather than to a picture. It names no rendering library — that is
 * `three-renderer.ts`'s job alone (`three-seam.test.ts`) — and it decides no
 * colour and no photograph: the stylised world paints a role
 * (`three-renderer.ts` §`STRUCTURE_STYLE`) and the realistic world dresses it
 * (`realistic-assets.ts` §`REALISTIC_BUILDING_SURFACES`). Both worlds draw the
 * SAME triangles, which is what lets `realistic-budget.ts` keep saying a
 * realistic structure is no heavier than the stylised one at the same place.
 *
 * ⚠️ **Built from numbers, and that is a finding rather than a shortcut.** No
 * source ADR 0026 D-4 admits publishes a window or a door that fits these
 * shapes — they publish surfaces — so an opening is geometry, the way the
 * walls already were. Nothing here was traced from or modelled on another
 * product (ADR 0009); the sizes are ordinary ones for a rural building.
 *
 * ## The conventions every shape here keeps
 *
 * - **+z is the front**, and faces the road: `settlements.ts` turns it there.
 *   Openings go on the front first, the long sides next and the gable ends
 *   last. The long side lies along x.
 * - **y = 0 is the ground**, and every wall is set {@link FOUNDATION_METRES}
 *   into it, under a plinth whose top is {@link PLINTH_TOP_METRES}.
 * - **Everything stays inside `settlements.ts` §`STRUCTURE_FOOTPRINTS`**, the
 *   eaves and the door steps included, so no shape here moves where anything
 *   may stand: `arrangement-unchanged.test.ts`' digest is untouched, and
 *   `buildings.test.ts` holds every vertex of every variant to the footprint.
 * - **Every triangle is wound to face outwards**, counter-clockwise seen from
 *   the side it is meant to be seen from, because the materials that draw it
 *   cull back faces. {@link Soup.tri} orders the corners from the direction a
 *   face is meant to face rather than trusting whoever typed them.
 *
 * ## Which windows a house has
 *
 * A kind has {@link BUILDING_VARIANTS} plans: two proportions, each with its
 * own arrangement of openings. Which one a building wears is its `variant`,
 * which `settlements.ts` draws from `seeded.ts` on a hash stream of its own —
 * so it is a function of where the building stands: the same every frame and
 * every ride, and moving nothing else. Openings cannot vary house by house
 * beyond that, because every house of one variant is one instanced mesh; that
 * is the price of drawing a village in a handful of draw calls, and the trade
 * the stylised world's scenery already made (#367).
 */

import type { StructureKind } from './scatter';

/** The structures with walls, a roof and a way in: the ones #500 details. */
export type BuiltKind = Extract<
  StructureKind,
  'building' | 'barn' | 'church' | 'shop-row' | 'shed'
>;

/** Every {@link BuiltKind}, in `scatter.ts` §`STRUCTURE_KINDS`' order. */
export const BUILT_KINDS: readonly BuiltKind[] = ['building', 'barn', 'church', 'shop-row', 'shed'];

/** Whether a structure is one of the {@link BUILT_KINDS}. */
export function isBuiltKind(kind: string): kind is BuiltKind {
  return (BUILT_KINDS as readonly string[]).includes(kind);
}

/**
 * What a triangle is made of, which is what decides how each world draws it.
 *
 * - `wall` — the walls, a church's tower included, and the gable ends.
 * - `plinth` — the course at the foot of the walls, darker, which is half of
 *   what grounds a building (the renderer's vertex shading is the other half).
 * - `roof` — the slopes, above and beneath, and a church's spire.
 * - `ridge` — the capping along a ridge.
 * - `chimney` — a stack.
 * - `joinery` — every frame, sill, fascia, barge board, shop sign and step.
 * - `door` — a door leaf.
 * - `glass` — a pane.
 */
export type BuildingRole =
  'wall' | 'plinth' | 'roof' | 'ridge' | 'chimney' | 'joinery' | 'door' | 'glass';

/** Every {@link BuildingRole}, in a fixed order. */
export const BUILDING_ROLES: readonly BuildingRole[] = [
  'wall',
  'plinth',
  'roof',
  'ridge',
  'chimney',
  'joinery',
  'door',
  'glass',
];

/**
 * How many shapes each built kind has: **2** — #500's *"at least two
 * proportions per kind"*, and no more, because each is a mesh per surface in
 * the realistic world (`realistic-budget.ts` §`REALISTIC_STRUCTURE_MESHES`).
 */
export const BUILDING_VARIANTS = 2;

/**
 * How deep every wall reaches below the ground, in metres: **0.6**, so a house
 * on a gentle slope is set into it rather than floating off its downhill
 * corner. The ground under a building is never steeper than `settlements.ts`
 * allows.
 */
export const FOUNDATION_METRES = 0.6;

/** The top of the plinth course, and so the threshold of every door: **0.3 m**. */
export const PLINTH_TOP_METRES = 0.3;

/** How far the plinth stands proud of the wall: **0.04 m**. */
export const PLINTH_PROUD_METRES = 0.04;

/**
 * How far a pane or a door leaf sits BEHIND the wall's face: **0.09 m** — the
 * depth of a window's reveal. #500's *"recessed about 8–10 cm"*. A window at
 * zero would be a decal painted on the wall, and a decal is what #500 asks a
 * test to refuse.
 */
export const OPENING_RECESS_METRES = 0.09;

/** How far a frame stands proud of the wall's face: **0.03 m**. */
export const FRAME_PROJECTION_METRES = 0.03;

/** How wide a frame is, around its opening: **0.08 m**. */
export const FRAME_WIDTH_METRES = 0.08;

/** How far a window's sill projects from the wall: **0.05 m** — #500's "about 5 cm". */
export const SILL_PROJECTION_METRES = 0.05;

/** How far a sill runs past its opening at each end, and how thick it is. */
const SILL_OVERRUN_METRES = 0.06;
const SILL_DEPTH_METRES = 0.07;

/**
 * The one window every house and every shop's upper floor has, in metres:
 * **1.0 wide by 1.3 high**. One size, so a window is the same size on every
 * house, the way the photographs on the walls are the same scale on every
 * wall.
 */
export const WINDOW = { width: 1, height: 1.3 } as const;

/** A house's and a shop's door: **1.0 wide by 2.0 high**, its threshold on the plinth. */
export const DOOR = { width: 1, height: 2 } as const;

/** The first floor's line on the outside of a house, in metres: **2.7**. */
export const FIRST_FLOOR_METRES = 2.7;

/** How far a sill stands above its own floor, in metres: **0.9**. */
const SILL_ABOVE_FLOOR_METRES = 0.9;

/**
 * Where a sill is, in metres above the ground, storey by storey: **0.9** on
 * the ground floor and **3.6** on the first — #500's own figures, and one
 * rule: a sill stands {@link SILL_ABOVE_FLOOR_METRES} above its floor.
 */
export const SILL_HEIGHTS = [
  SILL_ABOVE_FLOOR_METRES,
  FIRST_FLOOR_METRES + SILL_ABOVE_FLOOR_METRES,
] as const;

/** How thick a roof reads at its edges, and so how far its underside is below it. */
const ROOF_THICKNESS_METRES = 0.15;

/** How deep a fascia board hangs below the eaves, and how far it stands out. */
const FASCIA_DEPTH_METRES = 0.22;
const FASCIA_THICKNESS_METRES = 0.04;

/** How deep a barge board hangs below the verge. */
const BARGE_DEPTH_METRES = 0.25;

/** How many straight pieces a round arch is drawn in: **4** — plenty at road distance. */
export const ARCH_SEGMENTS = 4;

/** A point, building-local, in metres. */
export type Point = readonly [number, number, number];

/** A point on a wall face: `u` along it, rightwards seen from outside; `v` up it. */
export type FacePoint = readonly [number, number];

/**
 * A wall's face: where `u = 0, v = 0` is, which way is right seen from outside,
 * and which way is out. `v` is height above the ground, so `origin[1]` is 0.
 */
export interface Face {
  readonly origin: Point;
  readonly right: Point;
  readonly normal: Point;
}

/** One door or window, as the plan cut it — what `buildings.test.ts` reads. */
export interface PlannedOpening {
  readonly kind: 'window' | 'door';
  readonly arched: boolean;
  /** The wall it is cut in. */
  readonly face: Face;
  /** Its outline on that face, counter-clockwise seen from outside. */
  readonly outline: readonly FacePoint[];
  /** Where on the face an opening may be: inside the wall, below its eaves. */
  readonly wall: {
    readonly uMin: number;
    readonly uMax: number;
    readonly vMin: number;
    readonly vMax: number;
  };
  /** The floor lines on that wall, in `v`; an opening may cross none of them. */
  readonly floors: readonly number[];
}

/** One built shape: its triangles by what they are made of, and its openings. */
export interface BuildingPlan {
  readonly kind: BuiltKind;
  readonly variant: number;
  /** Nine numbers a triangle — three corners — building-local, in metres. */
  readonly triangles: Readonly<Record<BuildingRole, readonly number[]>>;
  readonly openings: readonly PlannedOpening[];
}

/** Whether a plan cuts its openings, or is the same shape with none — the browser gate's control. */
export interface PlanOptions {
  readonly openings?: boolean;
}

const UP: Point = [0, 1, 0];

function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaled(a: Point, by: number): Point {
  return [a[0] * by, a[1] * by, a[2] * by];
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** A point on a face at `(u, v)`, `w` out from it. */
export function onFace(face: Face, u: number, v: number, w = 0): Point {
  return add(add(add(face.origin, scaled(face.right, u)), scaled(UP, v)), scaled(face.normal, w));
}

/** A face, out along `normal` from the building's centre line, `distance` away. */
function faceOut(normal: Point, distance: number): Face {
  return { origin: scaled(normal, distance), right: cross(UP, normal), normal };
}

/**
 * Where a triangle soup goes, by role, and the transform each body is built
 * under — so the same code builds a nave along x and turns it along z.
 */
class Soup {
  readonly triangles: Record<BuildingRole, number[]> = {
    wall: [],
    plinth: [],
    roof: [],
    ridge: [],
    chimney: [],
    joinery: [],
    door: [],
    glass: [],
  };

  readonly openings: PlannedOpening[] = [];

  /** Quarter turns about y, then an offset: the body now being built. */
  #turns = 0;
  #offset: Point = [0, 0, 0];

  place(turns: number, offset: Point): void {
    this.#turns = ((turns % 4) + 4) % 4;
    this.#offset = offset;
  }

  /** A body-local direction, turned into the building's frame. */
  direction(point: Point): Point {
    let [x, , z] = point;
    for (let turn = 0; turn < this.#turns; turn += 1) {
      [x, z] = [z, -x];
    }
    return [x, point[1], z];
  }

  /** A body-local point, into the building's frame. */
  point(point: Point): Point {
    return add(this.direction(point), this.#offset);
  }

  /** A body-local face, into the building's frame. */
  face(face: Face): Face {
    return {
      origin: this.point(face.origin),
      right: this.direction(face.right),
      normal: this.direction(face.normal),
    };
  }

  /**
   * One triangle, body-local, wound so that its normal agrees with `facing`.
   * A degenerate one is dropped rather than drawn as nothing.
   */
  tri(role: BuildingRole, a: Point, b: Point, c: Point, facing: Point): void {
    const normal = cross(sub(b, a), sub(c, a));
    if (Math.hypot(...normal) < 1e-9) return;
    const [first, second] = dot(normal, facing) >= 0 ? [b, c] : [c, b];
    this.triangles[role].push(...this.point(a), ...this.point(first), ...this.point(second));
  }

  /** A convex quad, its corners in order around it. */
  quad(role: BuildingRole, a: Point, b: Point, c: Point, d: Point, facing: Point): void {
    this.tri(role, a, b, c, facing);
    this.tri(role, a, c, d, facing);
  }

  /** A convex polygon, as a fan. */
  polygon(role: BuildingRole, corners: readonly Point[], facing: Point): void {
    const [first] = corners;
    if (first === undefined) return;
    for (let at = 1; at + 1 < corners.length; at += 1) {
      this.tri(role, first, corners[at] as Point, corners[at + 1] as Point, facing);
    }
  }

  /** An axis-aligned box, less the faces nobody can see. */
  box(role: BuildingRole, min: Point, max: Point, omit: readonly BoxSide[] = []): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const sides: Record<BoxSide, readonly [Point, Point, Point, Point, Point]> = {
      '+x': [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
        [1, 0, 0],
      ],
      '-x': [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
        [-1, 0, 0],
      ],
      '+y': [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [0, 1, 0],
      ],
      '-y': [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
        [0, -1, 0],
      ],
      '+z': [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [0, 0, 1],
      ],
      '-z': [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
        [0, 0, -1],
      ],
    };
    for (const [side, [a, b, c, d, facing]] of Object.entries(sides) as [
      BoxSide,
      readonly [Point, Point, Point, Point, Point],
    ][]) {
      if (!omit.includes(side)) this.quad(role, a, b, c, d, facing);
    }
  }
}

type BoxSide = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** One opening a wall is asked for, in its face's own coordinates. */
interface OpeningSpec {
  readonly kind: 'window' | 'door';
  /** Its centre along the wall. */
  readonly u: number;
  /** Its sill, or a door's threshold. */
  readonly v: number;
  readonly width: number;
  /** To the top of its straight sides; an arch adds half its width above. */
  readonly height: number;
  readonly arched?: boolean;
}

/** One wall: where it is, how wide and high, and what is cut in it. */
interface WallSpec {
  readonly face: Face;
  /** Half its width, so the wall runs `u ∈ [-half, half]`. */
  readonly half: number;
  /** The height of its eaves: the top of the rectangle openings may be cut in. */
  readonly top: number;
  /**
   * What stands above the rectangle, as heights at its two ends and — for a
   * gable end — its middle. A wall with none is flat-topped.
   */
  readonly above?:
    | { readonly shape: 'gable'; readonly rise: number }
    | { readonly shape: 'slope'; readonly left: number; readonly right: number };
  readonly openings: readonly OpeningSpec[];
  readonly floors?: readonly number[];
}

/** An opening's outline, counter-clockwise seen from outside, from the sill round. */
function outlineOf(spec: OpeningSpec): FacePoint[] {
  const left = spec.u - spec.width / 2;
  const right = spec.u + spec.width / 2;
  const spring = spec.v + spec.height;
  const corners: FacePoint[] = [
    [left, spec.v],
    [right, spec.v],
    [right, spring],
  ];
  if (spec.arched === true) {
    const radius = spec.width / 2;
    for (let step = 1; step < ARCH_SEGMENTS; step += 1) {
      const angle = (Math.PI * step) / ARCH_SEGMENTS;
      corners.push([spec.u + radius * Math.cos(angle), spring + radius * Math.sin(angle)]);
    }
  }
  corners.push([left, spring]);
  return corners;
}

/** The rectangle an outline stands in: what is cut out of the wall's face. */
function boundsOf(outline: readonly FacePoint[]): {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
} {
  const us = outline.map(([u]) => u);
  const vs = outline.map(([, v]) => v);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** An edge's outward normal on the face, for a counter-clockwise outline. */
function outwardOf(from: FacePoint, to: FacePoint): FacePoint {
  const du = to[0] - from[0];
  const dv = to[1] - from[1];
  const length = Math.hypot(du, dv);
  return [dv / length, -du / length];
}

/**
 * One wall, its openings cut, framed, glazed or hung, and the wall around them.
 *
 * The face is cut in horizontal bands at every opening's top and bottom, and
 * each band is drawn as the runs of wall between the openings in it — a
 * handful of quads a wall rather than a grid of cells. An arched opening is
 * cut as its rectangle, and the two corners above its arch are filled back in.
 */
function buildWall(soup: Soup, spec: WallSpec, withOpenings: boolean): void {
  const { face, half, top } = spec;
  const bottom = PLINTH_TOP_METRES;
  const openings = withOpenings ? spec.openings : [];
  const outlines = openings.map(outlineOf);
  const holes = outlines.map(boundsOf);
  const facing = face.normal;
  const at = (u: number, v: number, w = 0): Point => onFace(face, u, v, w);

  const edges = [...new Set([bottom, top, ...holes.flatMap((hole) => [hole.v0, hole.v1])])]
    .filter((v) => v >= bottom && v <= top)
    .sort((a, b) => a - b);
  for (let band = 0; band + 1 < edges.length; band += 1) {
    const low = edges[band] as number;
    const high = edges[band + 1] as number;
    const across = holes
      .filter((hole) => hole.v0 < high && hole.v1 > low)
      .sort((a, b) => a.u0 - b.u0);
    let from = -half;
    for (const hole of [...across, { u0: half, u1: half }]) {
      if (hole.u0 > from) {
        soup.quad(
          'wall',
          at(from, low),
          at(hole.u0, low),
          at(hole.u0, high),
          at(from, high),
          facing,
        );
      }
      from = Math.max(from, hole.u1);
    }
  }
  const above = spec.above;
  if (above?.shape === 'gable') {
    soup.tri('wall', at(-half, top), at(half, top), at(0, top + above.rise), facing);
  } else if (above !== undefined) {
    soup.quad(
      'wall',
      at(-half, top),
      at(half, top),
      at(half, top + above.right),
      at(-half, top + above.left),
      facing,
    );
  }

  outlines.forEach((outline, index) => {
    const opening = openings[index] as OpeningSpec;
    const hole = holes[index] as (typeof holes)[number];
    buildOpening(soup, face, opening, outline, hole);
    soup.openings.push({
      kind: opening.kind,
      arched: opening.arched === true,
      face: soup.face(face),
      outline,
      wall: { uMin: -half, uMax: half, vMin: bottom, vMax: top },
      floors: spec.floors ?? [],
    });
  });
}

/**
 * One opening: the corners of the wall above an arch, the reveal from the
 * frame back to the pane, the frame's face and its outer edge, the pane or the
 * leaf, and a sill under a window or a step before a door.
 */
function buildOpening(
  soup: Soup,
  face: Face,
  spec: OpeningSpec,
  outline: readonly FacePoint[],
  hole: ReturnType<typeof boundsOf>,
): void {
  const at = (u: number, v: number, w = 0): Point => onFace(face, u, v, w);
  const facing = face.normal;
  const count = outline.length;

  // The wall back over an arch's two corners, at the wall's own face.
  if (spec.arched === true) {
    const apex = Math.floor(count / 2) + 1;
    for (let edge = 2; edge < count - 1; edge += 1) {
      const [u0, v0] = outline[edge] as FacePoint;
      const [u1, v1] = outline[edge + 1] as FacePoint;
      const corner: FacePoint = edge + 1 <= apex ? [hole.u1, hole.v1] : [hole.u0, hole.v1];
      soup.tri('wall', at(corner[0], corner[1]), at(u0, v0), at(u1, v1), facing);
    }
  }

  // Edge 0 is the bottom. Under a window a sill takes the frame's place; a
  // door's threshold has neither frame nor reveal.
  const framed = (edge: number): boolean => edge !== 0;
  const normals = outline.map((point, edge) =>
    outwardOf(point, outline[(edge + 1) % count] as FacePoint),
  );
  const outer = outline.map((point, index): FacePoint => {
    const before = normals[(index + count - 1) % count] as FacePoint;
    const after = normals[index] as FacePoint;
    const beforeFramed = framed((index + count - 1) % count);
    const afterFramed = framed(index);
    if (beforeFramed && afterFramed) {
      const scale = FRAME_WIDTH_METRES / (1 + before[0] * after[0] + before[1] * after[1]);
      return [point[0] + (before[0] + after[0]) * scale, point[1] + (before[1] + after[1]) * scale];
    }
    const only = beforeFramed ? before : after;
    return [point[0] + only[0] * FRAME_WIDTH_METRES, point[1] + only[1] * FRAME_WIDTH_METRES];
  });

  for (let edge = 0; edge < count; edge += 1) {
    const [pu, pv] = outline[edge] as FacePoint;
    const [qu, qv] = outline[(edge + 1) % count] as FacePoint;
    const [nu, nv] = normals[edge] as FacePoint;
    const inward = scaled(add(scaled(face.right, nu), scaled(UP, nv)), -1);
    if (spec.kind === 'door' && edge === 0) continue;
    // The reveal: from the frame's face — or the wall's, over a sill — back to the pane.
    const front = framed(edge) ? FRAME_PROJECTION_METRES : 0;
    soup.quad(
      'wall',
      at(pu, pv, front),
      at(qu, qv, front),
      at(qu, qv, -OPENING_RECESS_METRES),
      at(pu, pv, -OPENING_RECESS_METRES),
      inward,
    );
    if (!framed(edge)) continue;
    const [ou, ov] = outer[edge] as FacePoint;
    const [ru, rv] = outer[(edge + 1) % count] as FacePoint;
    soup.quad(
      'joinery',
      at(pu, pv, FRAME_PROJECTION_METRES),
      at(qu, qv, FRAME_PROJECTION_METRES),
      at(ru, rv, FRAME_PROJECTION_METRES),
      at(ou, ov, FRAME_PROJECTION_METRES),
      facing,
    );
    soup.quad(
      'joinery',
      at(ou, ov, 0),
      at(ru, rv, 0),
      at(ru, rv, FRAME_PROJECTION_METRES),
      at(ou, ov, FRAME_PROJECTION_METRES),
      scaled(inward, -1),
    );
  }

  soup.polygon(
    spec.kind === 'window' ? 'glass' : 'door',
    outline.map(([u, v]) => at(u, v, -OPENING_RECESS_METRES)),
    facing,
  );

  if (spec.kind === 'window') {
    sillOrStep(soup, face, {
      u0: hole.u0 - SILL_OVERRUN_METRES,
      u1: hole.u1 + SILL_OVERRUN_METRES,
      v0: hole.v0 - SILL_DEPTH_METRES,
      v1: hole.v0,
      w: SILL_PROJECTION_METRES,
    });
  } else {
    sillOrStep(soup, face, {
      u0: hole.u0 - 0.15,
      u1: hole.u1 + 0.15,
      v0: 0,
      v1: hole.v0,
      w: 0.35,
    });
  }
}

/** A block standing out from a face: a sill, a step, a shop's sign. */
function sillOrStep(
  soup: Soup,
  face: Face,
  block: {
    readonly u0: number;
    readonly u1: number;
    readonly v0: number;
    readonly v1: number;
    readonly w: number;
  },
  role: BuildingRole = 'joinery',
): void {
  const at = (u: number, v: number, w: number): Point => onFace(face, u, v, w);
  const { u0, u1, v0, v1, w } = block;
  const out = face.normal;
  const right = face.right;
  soup.quad(role, at(u0, v0, w), at(u1, v0, w), at(u1, v1, w), at(u0, v1, w), out);
  soup.quad(role, at(u0, v1, 0), at(u0, v1, w), at(u1, v1, w), at(u1, v1, 0), UP);
  soup.quad(role, at(u0, v0, 0), at(u1, v0, 0), at(u1, v0, w), at(u0, v0, w), [0, -1, 0]);
  soup.quad(role, at(u1, v0, 0), at(u1, v1, 0), at(u1, v1, w), at(u1, v0, w), right);
  soup.quad(role, at(u0, v0, 0), at(u0, v0, w), at(u0, v1, w), at(u0, v1, 0), scaled(right, -1));
}

/** A body's roof. */
type RoofSpec =
  | {
      readonly shape: 'gable';
      /** From the eaves to the ridge. */
      readonly rise: number;
      /** How far past the long walls the eaves reach, and past the gable ends the verge. */
      readonly eaves: number;
      readonly verge: number;
    }
  | {
      readonly shape: 'lean';
      /** The height of the roof over the -z wall and over the +z wall. */
      readonly back: number;
      readonly front: number;
      readonly eaves: number;
      readonly verge: number;
    };

/** One rectangular body: walls on four sides, a plinth, a roof. Its long side along x. */
interface BodySpec {
  /** Half its extent along x, and along z. */
  readonly halfX: number;
  readonly halfZ: number;
  /** The height of its eaves — for a lean-to, the lower wall's. */
  readonly eaves: number;
  readonly roof: RoofSpec | { readonly shape: 'flat' };
  readonly openings?: Partial<Record<'+z' | '-z' | '+x' | '-x', readonly OpeningSpec[]>>;
  readonly floors?: readonly number[];
  readonly ridge?: boolean;
  /** Where a chimney stands along x, if the body has one. */
  readonly chimneys?: readonly number[];
}

/**
 * One body, built body-local: centred on x = z = 0, its front +z.
 * {@link Soup.place} says where it goes.
 */
function buildBody(soup: Soup, body: BodySpec, withOpenings: boolean): void {
  const { halfX, halfZ, eaves, roof } = body;
  const openings = body.openings ?? {};
  const floors = body.floors ?? [];

  // Walls. Along a gable roof's long sides the wall stops at the eaves; its
  // ends carry the gable. A lean-to's walls follow its slope.
  const frontTop = roof.shape === 'lean' ? Math.min(roof.front, roof.back) : eaves;
  const gable = roof.shape === 'gable' ? { shape: 'gable' as const, rise: roof.rise } : undefined;
  const leanRise =
    roof.shape === 'lean'
      ? { back: roof.back - frontTop, front: roof.front - frontTop }
      : undefined;
  const walls: readonly WallSpec[] = [
    {
      face: faceOut([0, 0, 1], halfZ),
      half: halfX,
      top: roof.shape === 'lean' ? roof.front : eaves,
      openings: openings['+z'] ?? [],
      floors,
    },
    {
      face: faceOut([0, 0, -1], halfZ),
      half: halfX,
      top: roof.shape === 'lean' ? roof.back : eaves,
      openings: openings['-z'] ?? [],
      floors,
    },
    ...([1, -1] as const).map((sign): WallSpec => ({
      face: faceOut([sign, 0, 0], halfX),
      half: halfZ,
      top: frontTop,
      ...(gable !== undefined
        ? { above: gable }
        : leanRise !== undefined && (leanRise.back > 0 || leanRise.front > 0)
          ? {
              above: {
                shape: 'slope' as const,
                // Seen from +x, right is -z: the back is on the right.
                left: sign > 0 ? leanRise.front : leanRise.back,
                right: sign > 0 ? leanRise.back : leanRise.front,
              },
            }
          : {}),
      openings: openings[sign > 0 ? '+x' : '-x'] ?? [],
      floors,
    })),
  ];
  for (const wall of walls) buildWall(soup, wall, withOpenings);

  // The plinth: proud of the walls, from the foundation to the threshold.
  soup.box(
    'plinth',
    [-halfX - PLINTH_PROUD_METRES, -FOUNDATION_METRES, -halfZ - PLINTH_PROUD_METRES],
    [halfX + PLINTH_PROUD_METRES, PLINTH_TOP_METRES, halfZ + PLINTH_PROUD_METRES],
    ['-y'],
  );

  if (roof.shape === 'gable') buildGable(soup, body, roof);
  else if (roof.shape === 'lean') buildLean(soup, body, roof);
  else {
    // A flat roof is a cornice slab over the walls' tops.
    soup.box(
      'roof',
      [-halfX - 0.2, eaves, -halfZ - 0.2],
      [halfX + 0.2, eaves + 0.5, halfZ + 0.2],
      ['-y'],
    );
  }
}

/** A roof slab: its top, and its underside a thickness below, each facing its own way. */
function slab(soup: Soup, corners: readonly [Point, Point, Point, Point], up: Point): void {
  soup.quad('roof', ...corners, up);
  const [a, b, c, d] = corners.map((corner) => add(corner, [0, -ROOF_THICKNESS_METRES, 0]));
  soup.quad('roof', a as Point, b as Point, c as Point, d as Point, scaled(up, -1));
}

/**
 * A pitched roof with its ridge along x: two slabs past the walls by the
 * eaves and the verge, fascia boards under the eaves, barge boards along the
 * verges, and a ridge along the top.
 */
function buildGable(soup: Soup, body: BodySpec, roof: Extract<RoofSpec, { shape: 'gable' }>): void {
  const { halfX, halfZ, eaves } = body;
  const pitch = roof.rise / halfZ;
  const ridgeY = eaves + roof.rise;
  const x = halfX + roof.verge;
  const z = halfZ + roof.eaves;
  const low = eaves - pitch * roof.eaves;
  for (const sign of [1, -1] as const) {
    slab(
      soup,
      [
        [-x, low, sign * z],
        [x, low, sign * z],
        [x, ridgeY, 0],
        [-x, ridgeY, 0],
      ],
      [0, halfZ, sign * roof.rise],
    );
    // The fascia, hiding the slab's edge under the eaves.
    const zOut = sign * (z + FASCIA_THICKNESS_METRES / 2);
    const zIn = sign * (z - FASCIA_THICKNESS_METRES / 2);
    soup.box(
      'joinery',
      [-x, low - FASCIA_DEPTH_METRES, Math.min(zOut, zIn)],
      [x, low + 0.02, Math.max(zOut, zIn)],
      [sign > 0 ? '-z' : '+z', '+y'],
    );
    // The barge boards, one down each verge's slope at each gable end.
    for (const end of [1, -1] as const) {
      const bx = end * (x + 0.02);
      soup.quad(
        'joinery',
        [bx, low, sign * z],
        [bx, ridgeY, 0],
        [bx, ridgeY - BARGE_DEPTH_METRES, 0],
        [bx, low - BARGE_DEPTH_METRES, sign * z],
        [end, 0, 0],
      );
    }
  }
  if (body.ridge !== false) {
    soup.box('ridge', [-x, ridgeY - 0.06, -0.16], [x, ridgeY + 0.14, 0.16], ['-y']);
  }
  for (const along of body.chimneys ?? []) {
    soup.box(
      'chimney',
      [along - 0.35, ridgeY - 1.2, -0.35],
      [along + 0.35, ridgeY + 0.9, 0.35],
      ['-y'],
    );
  }
}

/** A single-pitched roof, falling from one long wall to the other. */
function buildLean(soup: Soup, body: BodySpec, roof: Extract<RoofSpec, { shape: 'lean' }>): void {
  const { halfX, halfZ } = body;
  const pitch = (roof.back - roof.front) / (2 * halfZ);
  const x = halfX + roof.verge;
  const z = halfZ + roof.eaves;
  const atFront = roof.front - pitch * roof.eaves;
  const atBack = roof.back + pitch * roof.eaves;
  slab(
    soup,
    [
      [-x, atFront, z],
      [x, atFront, z],
      [x, atBack, -z],
      [-x, atBack, -z],
    ],
    [0, 2 * halfZ, roof.back - roof.front],
  );
  const [lowZ, lowY] = atFront <= atBack ? [z, atFront] : [-z, atBack];
  const lowSign = lowZ > 0 ? 1 : -1;
  soup.box(
    'joinery',
    [-x, lowY - FASCIA_DEPTH_METRES, Math.min(lowZ, lowZ + lowSign * FASCIA_THICKNESS_METRES)],
    [x, lowY + 0.02, Math.max(lowZ, lowZ + lowSign * FASCIA_THICKNESS_METRES)],
    [lowSign > 0 ? '-z' : '+z', '+y'],
  );
  for (const end of [1, -1] as const) {
    const bx = end * (x + 0.02);
    soup.quad(
      'joinery',
      [bx, atFront, z],
      [bx, atBack, -z],
      [bx, atBack - BARGE_DEPTH_METRES, -z],
      [bx, atFront - BARGE_DEPTH_METRES, z],
      [end, 0, 0],
    );
  }
}

/** A square spire over a tower: four faces to a point, and a soffit under its overhang. */
function buildSpire(soup: Soup, half: number, base: number, height: number): void {
  const apex: Point = [0, base + height, 0];
  const corners: Point[] = [
    [-half, base, half],
    [half, base, half],
    [half, base, -half],
    [-half, base, -half],
  ];
  for (let side = 0; side < 4; side += 1) {
    const a = corners[side] as Point;
    const b = corners[(side + 1) % 4] as Point;
    const out = cross(sub(b, a), sub(apex, a));
    soup.tri('roof', a, b, apex, out);
  }
  soup.polygon('roof', corners, [0, -1, 0]);
}

/** A little pitched hood over a door, its ridge running out from the wall. */
function buildCanopy(soup: Soup, u: number, wallZ: number, springY: number): void {
  const half = 0.9;
  const depth = 0.9;
  const rise = 0.5;
  const top = springY + rise;
  for (const sign of [1, -1] as const) {
    slab(
      soup,
      [
        [u + sign * half, springY, wallZ],
        [u + sign * half, springY, wallZ + depth],
        [u, top, wallZ + depth],
        [u, top, wallZ],
      ],
      [sign * rise, half, 0],
    );
  }
  soup.tri(
    'joinery',
    [u - half, springY, wallZ + depth],
    [u + half, springY, wallZ + depth],
    [u, top, wallZ + depth],
    [0, 0, 1],
  );
}

/** A window on a storey: its centre along the wall and which storey. */
function window(u: number, storey: 0 | 1): OpeningSpec {
  return { kind: 'window', u, v: SILL_HEIGHTS[storey], ...WINDOW };
}

/** A house's or a shop's door, its threshold on the plinth. */
function door(u: number): OpeningSpec {
  return { kind: 'door', u, v: PLINTH_TOP_METRES, ...DOOR };
}

/** The house: a two-storey farmhouse, or a cottage under a steeper roof with a hood over its door. */
function house(soup: Soup, variant: number, withOpenings: boolean): void {
  if (variant === 0) {
    buildBody(
      soup,
      {
        halfX: 4,
        halfZ: 3.3,
        eaves: 5.4,
        roof: { shape: 'gable', rise: 2.4, eaves: 0.5, verge: 0.44 },
        floors: [FIRST_FLOOR_METRES],
        chimneys: [2.9],
        openings: {
          '+z': [
            door(0),
            window(-2.4, 0),
            window(2.4, 0),
            window(-2.4, 1),
            window(0, 1),
            window(2.4, 1),
          ],
          '-z': [window(-1.6, 0), window(1.6, 0), window(-1.6, 1), window(1.6, 1)],
          '+x': [window(0, 0), window(0, 1)],
          '-x': [window(0, 0)],
        },
      },
      withOpenings,
    );
    return;
  }
  buildBody(
    soup,
    {
      halfX: 3.8,
      halfZ: 3,
      eaves: 3.1,
      roof: { shape: 'gable', rise: 3, eaves: 0.5, verge: 0.4 },
      chimneys: [-2.8, 2.8],
      openings: {
        '+z': [door(-0.8), window(-2.6, 0), window(1.2, 0), window(2.8, 0)],
        '-z': [window(-1.4, 0), window(1.4, 0)],
        '+x': [window(0, 0)],
        '-x': [window(0, 0)],
      },
    },
    withOpenings,
  );
  if (withOpenings) buildCanopy(soup, -0.8, 3, 2.5);
}

/** The barn: a long one with a pair of great doors, or a shorter, taller one with a lean-to. */
function barn(soup: Soup, variant: number, withOpenings: boolean): void {
  const greatDoors = (u: number): OpeningSpec => ({
    kind: 'door',
    u,
    v: PLINTH_TOP_METRES,
    width: 3.8,
    height: 3.4,
  });
  if (variant === 0) {
    buildBody(
      soup,
      {
        halfX: 6.8,
        halfZ: 3.8,
        eaves: 4.5,
        roof: { shape: 'gable', rise: 3.2, eaves: 0.35, verge: 0.45 },
        openings: {
          '+z': [greatDoors(0)],
          '-z': [{ kind: 'door', u: 3, v: PLINTH_TOP_METRES, width: 1.2, height: 2.2 }],
        },
      },
      withOpenings,
    );
    if (withOpenings) greatDoorBatten(soup, 0, 3.8);
    return;
  }
  soup.place(0, [-1.6, 0, 0]);
  buildBody(
    soup,
    {
      halfX: 5.2,
      halfZ: 3.8,
      eaves: 5.2,
      roof: { shape: 'gable', rise: 3.7, eaves: 0.35, verge: 0.45 },
      openings: { '+z': [greatDoors(0)] },
    },
    withOpenings,
  );
  if (withOpenings) greatDoorBatten(soup, 0, 3.8);
  soup.place(0, [5.3, 0, -0.4]);
  buildBody(
    soup,
    {
      halfX: 1.7,
      halfZ: 3.2,
      eaves: 2.6,
      roof: { shape: 'lean', back: 3.5, front: 2.6, eaves: 0.25, verge: 0.2 },
      openings: { '+z': [{ kind: 'door', u: 0, v: PLINTH_TOP_METRES, width: 1.2, height: 2 }] },
    },
    withOpenings,
  );
  soup.place(0, [0, 0, 0]);
}

/** The batten down the middle of a pair of great doors, so they read as two leaves. */
function greatDoorBatten(soup: Soup, u: number, halfZ: number): void {
  const z = halfZ - OPENING_RECESS_METRES;
  soup.box(
    'joinery',
    [u - 0.06, PLINTH_TOP_METRES, z],
    [u + 0.06, PLINTH_TOP_METRES + 3.4, z + 0.05],
    ['-z'],
  );
}

/** The church: a nave along z behind a tower that faces the road, under a spire. */
function church(soup: Soup, variant: number, withOpenings: boolean): void {
  const tall = (u: number): OpeningSpec => ({
    kind: 'window',
    u,
    v: 1.8,
    width: 0.9,
    height: 2.2,
    arched: true,
  });
  const nave =
    variant === 0
      ? { length: 14, half: 3.5, z: -2, eaves: 6, rise: 3.8 }
      : { length: 12, half: 3.3, z: -2.5, eaves: 5.4, rise: 3.5 };
  const tower =
    variant === 0
      ? { half: 2, z: 6.5, height: 13, spire: 6 }
      : { half: 1.8, z: 5.2, height: 11, spire: 7 };
  const windows = variant === 0 ? [-4, 0, 4] : [-3.4, 0, 3.4];

  // The nave, built with its ridge along x and turned a quarter so it runs along z.
  // A quarter turn takes the body's +x to -z and its +z to +x.
  soup.place(1, [0, 0, nave.z]);
  buildBody(
    soup,
    {
      halfX: nave.length / 2,
      halfZ: nave.half,
      eaves: nave.eaves,
      roof: { shape: 'gable', rise: nave.rise, eaves: 0.27, verge: 0.26 },
      openings: { '+z': windows.map(tall), '-z': windows.map(tall) },
    },
    withOpenings,
  );

  // The tower, flat-topped under its spire, with an arched door and a tall window over it.
  soup.place(0, [0, 0, tower.z]);
  buildBody(
    soup,
    {
      halfX: tower.half,
      halfZ: tower.half,
      eaves: tower.height,
      roof: { shape: 'flat' },
      ridge: false,
      openings: {
        '+z': [
          { kind: 'door', u: 0, v: PLINTH_TOP_METRES, width: 1.4, height: 2.4, arched: true },
          { kind: 'window', u: 0, v: 5, width: 0.9, height: 2.2, arched: true },
        ],
      },
    },
    withOpenings,
  );
  buildSpire(soup, tower.half + 0.12, tower.height + 0.5, tower.spire);
  soup.place(0, [0, 0, 0]);
}

/** The row of shops: three shopfronts under a slate roof, or two under a steeper one. */
function shopRow(soup: Soup, variant: number, withOpenings: boolean): void {
  const units = variant === 0 ? [-6.6, 0, 6.6] : [-4, 4];
  const halfX = variant === 0 ? 9.9 : 7.9;
  const openings: OpeningSpec[] = [];
  for (const centre of units) {
    openings.push(
      { kind: 'window', u: centre - 0.9, v: 0.8, width: 3.4, height: 2 },
      door(centre + 1.8),
    );
    for (const offset of variant === 0 ? [-1.6, 1.6] : [-2.2, 0, 2.2]) {
      openings.push({ kind: 'window', u: centre + offset, v: 4.2, ...WINDOW });
    }
  }
  buildBody(
    soup,
    {
      halfX,
      halfZ: 3.3,
      eaves: variant === 0 ? 6.4 : 6.1,
      roof: { shape: 'gable', rise: variant === 0 ? 2.2 : 2.8, eaves: 0.3, verge: 0.25 },
      floors: [3.8],
      chimneys: variant === 0 ? [-3.3, 3.3] : [0],
      openings: { '+z': openings },
    },
    withOpenings,
  );
  // Each shop's sign: a board across its frontage over the window and the door.
  if (withOpenings) {
    const front = faceOut([0, 0, 1], 3.3);
    for (const centre of units) {
      sillOrStep(soup, front, { u0: centre - 3, u1: centre + 3, v0: 3.05, v1: 3.65, w: 0.08 });
    }
  }
}

/**
 * The shed: galvanised sheet on a low plinth under a single pitch, in two
 * sizes. ⚠️ **No openings, decided rather than overlooked** — #500 allows it:
 * a field shed is open on the side away from the road, and one blank face
 * among a farmstead's doors reads as a shed.
 */
function shed(soup: Soup, variant: number): void {
  buildBody(
    soup,
    variant === 0
      ? {
          halfX: 5,
          halfZ: 4,
          eaves: 3.2,
          roof: { shape: 'lean', back: 3.2, front: 3.7, eaves: 0.35, verge: 0.18 },
        }
      : {
          halfX: 3.8,
          halfZ: 3.2,
          eaves: 2.8,
          roof: { shape: 'lean', back: 3.3, front: 2.8, eaves: 0.35, verge: 0.2 },
        },
    false,
  );
}

/**
 * One built kind's shape, as {@link BuildingPlan}. A variant outside
 * `[0, BUILDING_VARIANTS)` is taken modulo it, as a belt takes an item's.
 *
 * Pure: the same arguments give the same numbers every time, which is half of
 * #500's *"the same house shows the same windows every frame and every ride"*.
 */
export function buildingPlan(
  kind: BuiltKind,
  variant: number,
  options: PlanOptions = {},
): BuildingPlan {
  const which = ((Math.floor(variant) % BUILDING_VARIANTS) + BUILDING_VARIANTS) % BUILDING_VARIANTS;
  const withOpenings = options.openings !== false;
  const soup = new Soup();
  if (kind === 'building') house(soup, which, withOpenings);
  else if (kind === 'barn') barn(soup, which, withOpenings);
  else if (kind === 'church') church(soup, which, withOpenings);
  else if (kind === 'shop-row') shopRow(soup, which, withOpenings);
  else shed(soup, which);
  return { kind, variant: which, triangles: soup.triangles, openings: soup.openings };
}

/**
 * How many triangles a plan draws, every role together.
 *
 * @test-facing `buildings.test.ts` holds it to the triangles themselves; the
 * renderer counts what it builds (`three-renderer.ts`
 * §`realisticStructureTrianglesOf`), so the budget is held to the geometry
 */
export function planTriangles(plan: BuildingPlan): number {
  return BUILDING_ROLES.reduce((sum, role) => sum + plan.triangles[role].length / 9, 0);
}
