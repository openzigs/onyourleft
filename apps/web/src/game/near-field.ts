// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the camera's near plane would cut through, and the scenery the renderer
 * therefore does not draw — #545.
 *
 * ## The question
 *
 * On the owner's tablet, in the realistic world: a thin vertical sliver of
 * brick at the right edge of the frame standing on nothing, and a flat grey
 * wedge at the left. #545 asks whether that is scenery crossing the camera's
 * **near plane** (`camera.ts` §`NEAR_PLANE_METRES`) — nothing nearer the eye
 * than that is drawn, so a shape the camera passes close to is drawn as
 * whatever of it lies beyond the plane — now that the camera follows the rider
 * across the road (#499) and keeps right on a straight (#546), while scenery is
 * placed against the CENTRELINE.
 *
 * ## How it is answered
 *
 * The solid a near plane cuts through is the **near pyramid**: the eye, and
 * the plane's rectangle, as wide and as tall as `camera.ts`' lens makes it for
 * the frame's aspect. A shape is cut exactly when one of its triangles meets
 * that solid, so a frame is asked in two steps:
 *
 * 1. {@link intrudes} — each item's BOX, from {@link sceneryReach}, against the
 *    pyramid. A box is a bound: an item whose box stays clear cannot be cut,
 *    and nearly every item is let go here, on distance alone.
 * 2. {@link shapeMeets} — for an item whose box does not, the TRIANGLES of the
 *    shapes it may be drawn as. ⚠️ **Without making an object, and past most
 *    of them on a sphere**: a realistic tree is 24 000 to 28 000 triangles a
 *    shape, and the first version of this step placed every one as three new
 *    objects on every frame a tree's box reached the eye — up to 3 ms a frame
 *    at the tablet's aspect, where it drops nothing (#545's review). Each shape
 *    is prepared once, when the models load, into runs of nearby triangles
 *    under one bounding sphere ({@link prepareShape}).
 *
 * ⚠️ **Step 2 is not optional.** A realistic fir's box is a square seven metres
 * across around a sparse cone of cards. Over `near-field.test.ts`' rides the
 * realistic boxes meet the pyramid over a hundred times where not one triangle
 * does, and a cull on the box — the first thing #545's branch tried — drops a
 * visible tree at the edge of the frame each of those times, to prevent a cut
 * that is not there.
 *
 * ## What the rides found
 *
 * `near-field.test.ts` rides five fixture routes a metre at a time with the
 * camera on the racing line, in both worlds, at seven aspects:
 *
 * - **At every frame a device draws** — an upright phone to a landscape one,
 *   the owner's 16 : 10 among them — **nothing is cut.** Measured while
 *   building this, the nearest vertex of a realistic tree in view came 0.93 m
 *   from the eye in depth on a landscape phone and 1.12 m on the tablet, about
 *   twice the plane's distance.
 * - **At 6 : 1** (`camera.ts` §`WORST_CASE_ASPECT`, the widest the stylesheet
 *   lets the world be), the rectangle is 4.2 m across, and **conifers in both
 *   worlds are cut** on the hairpin and the circuit — nine item-frames over the
 *   five rides, a fir's lowest branches beside the eye. ⚠️ No corner of a cut
 *   triangle is inside the pyramid in any of them: the branch cards are longer
 *   than the pyramid is deep, so a test of vertices alone finds none of them.
 * - **No structure, anywhere**: a structure's whole footprint is held 4.1 m
 *   from every stretch of road, and its box never reached the pyramid.
 *
 * So the owner's sliver and wedge are NOT reproduced on the fixtures at the
 * tablet's aspect; the tablet re-check #545 asks for is what says what they
 * were. What this file does is make the cut impossible rather than rare:
 * {@link clearOfTheCamera} is what `three-renderer.ts` hands its scenery
 * belts, and it drops exactly the items whose geometry the plane would cut —
 * the conifers at 6 : 1, and whatever a real route brings that close.
 *
 * ⚠️ **Dropped, not moved and not faded.** Moving the placement would have to
 * know every line the camera can ride, and the placement is pinned to a digest
 * (`arrangement-unchanged.test.ts`), which this does not move: it decides what
 * a frame DRAWS, never where anything stands. A fade needs a transparent pass
 * per belt, which #240's draw-call budget does not have.
 *
 * ⚠️ **In the renderer and not in `scene.ts`**, because what decides the
 * answer is the renderer's: the frame's aspect, and the shapes the world being
 * drawn has loaded.
 *
 * Pure, and naming no rendering library — `three-seam.test.ts`.
 */

import {
  NEAR_PLANE_METRES,
  horizontalSpread,
  verticalHalfTangent,
  type CameraRig,
  type RigPoint,
} from './camera';
import type { QualitySettings } from './quality';
import type { SceneryKind, ScatterItem, StructureKind } from './scatter';
import { STRUCTURE_FOOTPRINTS } from './settlements';

/** Which world a frame is drawn in. @see QualitySettings.world */
export type DrawnWorld = QualitySettings['world'];

/**
 * How much room one scenery item may take up, in its own frame, in metres at a
 * `scale` of 1: how far it reaches across (`x`) and along (`back`, `front`) its
 * own axes, and from how far below its ground to how far above.
 */
export interface Reach {
  readonly x: number;
  readonly back: number;
  readonly front: number;
  readonly bottom: number;
  readonly top: number;
}

type NaturalKind = Exclude<SceneryKind, StructureKind>;

/** A natural item's reach: `across` is a RADIUS about its pivot, whichever way it turns. */
function natural(across: number, top: number): Reach {
  return { x: across, back: -across, front: across, bottom: -0.1, top };
}

/**
 * How far a natural item reaches from where it stands, in each world, at a
 * `scale` of 1 — each model's own bounding box, fitted as the renderer fits it,
 * and rounded UP. `near-field.test.ts` §"the bounds" holds every committed model
 * inside these.
 *
 * | kind | stylised across / top | set by | realistic across / top | set by |
 * |---|--:|---|--:|---|
 * | `tree-broadleaf` | 2.2 / 4.4 | the fallback sphere; `tree_oak`, 1.75 m | 3.0 / 4.5 | `island_tree_02`, 2.97 m; `tree_small_02`, 4.42 m |
 * | `tree-conifer` | 2.45 / 7 | `tree_pineRoundD`, 2.40 m | 3.65 / 7.1 | `fir_sapling_medium_a`, 3.55 m and 7.03 m |
 * | `shrub` | 1.15 / 1.6 | `plant_bush`, 1.13 m; the sphere, 1.4 m | 1.1 / 1.6 | `shrub_02_c`, 1.03 m; `shrub_02_a`, 1.54 m |
 * | `rock` | 1.3 / 1.8 | `stone_largeC`, 1.25 m; the octahedron | 1.15 / 1.0 | `boulder_01`, 1.10 m and 0.98 m |
 * | `post` | 0.1 / 1.1 | the five-sided post, radius 0.07 m | 0.1 / 1.1 | the same post, ADR 0022 D-3 |
 *
 * ⚠️ **Two tables, because the realistic trees are why one would not do.** A
 * stylised model is fitted inside a cube of `sceneryFitMetres`, centred; a
 * realistic scan keeps its own pivot, and its thinned cards grow past the scan
 * (`tools/realistic/blender/process_tree.py`), so a fir's branches reach half
 * its height.
 */
const NATURAL_REACH: Readonly<Record<DrawnWorld, Readonly<Record<NaturalKind, Reach>>>> = {
  stylised: {
    'tree-broadleaf': natural(2.2, 4.4),
    'tree-conifer': natural(2.45, 7),
    shrub: natural(1.15, 1.6),
    rock: natural(1.3, 1.8),
    post: natural(0.1, 1.1),
  },
  realistic: {
    'tree-broadleaf': natural(3, 4.5),
    'tree-conifer': natural(3.65, 7.1),
    shrub: natural(1.1, 1.6),
    rock: natural(1.15, 1),
    post: natural(0.1, 1.1),
  },
};

/**
 * How tall each structure is, in either world.
 *
 * | kind | top | set by |
 * |---|--:|---|
 * | `building` | 9 | the stylised City Kit house, fitted to 9 m; `buildings.ts`' house, 8.7 m |
 * | `barn` | 9.1 | `buildings.ts`, 9.04 m |
 * | `church` | 19.5 | `buildings.ts`, the tower |
 * | `shop-row` | 9.8 | `buildings.ts` |
 * | `shed` | 3.8 | `buildings.ts`, 3.72 m |
 * | `wall`, `hedge`, `fence` | 1.1, 1.3, 1.3 | `three-renderer.ts` §`BOUNDARY_STYLE` |
 * | `signpost` | 2.6 | the pole, 3 m long and centred 1.1 m up |
 */
const STRUCTURE_TOPS: Readonly<Record<StructureKind, number>> = {
  building: 9,
  barn: 9.1,
  church: 19.5,
  'shop-row': 9.8,
  shed: 3.8,
  wall: 1.1,
  hedge: 1.3,
  fence: 1.3,
  signpost: 2.6,
};

/** How deep the deepest structure is set: `buildings.ts` §`FOUNDATION_METRES`. */
const STRUCTURE_FOUNDATION_METRES = 0.6;

/**
 * How far past its footprint a structure is taken to reach, in plan: **0.1 m**.
 *
 * ⚠️ **A reviewer who remembers this margin covering a fence that pokes out of
 * its footprint is reading the old file.** Until #602 a fence's end posts were
 * 0.12 m square and centred on the ends of its 8 m run, so they stood 6 cm past
 * the `±4` that `settlements.ts` §`STRUCTURE_FOOTPRINTS` records — found by
 * `near-field.test.ts` §"the bounds", which reads every shape both worlds build.
 * #602 moved the posts inward (`three-renderer.ts` §`FENCE_END_POST_Z`), and
 * `boundary-footprint.test.ts` now holds every wall, hedge, fence and signpost
 * inside its footprint, so today every structure fits its footprint exactly.
 *
 * The margin stays as belt and braces: this file only needs a box nothing pokes
 * out of, and a tenth of a metre means a shape that one day strays a few
 * centimetres is still inside it here while `boundary-footprint.test.ts` says
 * so. Taking it to nought, so the near-field bounds are exact, is a separate
 * change rather than part of #602.
 */
const STRUCTURE_PLAN_MARGIN_METRES = 0.1;

/** The box every item of a kind fits inside, in its own frame, at a scale of 1, in the world named. */
export function sceneryReach(kind: SceneryKind, world: DrawnWorld): Reach {
  const naturals = NATURAL_REACH[world];
  if (kind in naturals) return naturals[kind as NaturalKind];
  const footprint = STRUCTURE_FOOTPRINTS[kind as StructureKind];
  return {
    x: footprint.x + STRUCTURE_PLAN_MARGIN_METRES,
    back: footprint.back - STRUCTURE_PLAN_MARGIN_METRES,
    front: footprint.front + STRUCTURE_PLAN_MARGIN_METRES,
    bottom: -STRUCTURE_FOUNDATION_METRES,
    top: STRUCTURE_TOPS[kind as StructureKind],
  };
}

/** The solid between the eye and a near plane. @see nearPyramid */
export interface NearPyramid {
  /** The eye first, then the near rectangle's four corners. */
  readonly points: readonly RigPoint[];
  /** The pyramid's own face normals: the near face, then the four through the eye. */
  readonly normals: readonly RigPoint[];
  /** Its edge directions: the rectangle's two, and the four from the eye. */
  readonly edges: readonly RigPoint[];
  /** The farthest any of {@link points} is from the eye. */
  readonly radius: number;
  /**
   * {@link points}, {@link normals} and {@link edges} again as flat numbers,
   * three a vector, for {@link shapeMeets}' per-triangle test — which reads
   * these rather than the objects so that it makes no object per triangle.
   */
  readonly packed: {
    readonly points: Float64Array;
    readonly normals: Float64Array;
    readonly edges: Float64Array;
  };
}

function vector(x: number, y: number, z: number): RigPoint {
  return { x, y, z };
}

function minus(a: RigPoint, b: RigPoint): RigPoint {
  return vector(a.x - b.x, a.y - b.y, a.z - b.z);
}

function cross(a: RigPoint, b: RigPoint): RigPoint {
  return vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function dot(a: RigPoint, b: RigPoint): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function unit(a: RigPoint): RigPoint {
  const length = Math.hypot(a.x, a.y, a.z);
  return length > 0 ? vector(a.x / length, a.y / length, a.z / length) : vector(0, 0, 0);
}

/**
 * The near pyramid for a camera rig and a frame of this aspect: the eye, and a
 * plane's rectangle `near` metres ahead of it — `camera.ts`' own, unless a
 * control asks for another — as wide and as tall as `camera.ts`' lens makes it.
 *
 * The camera's axes are three's `lookAt` with the world's up, which is how
 * `three-renderer.ts` §`#placeCamera` aims it: forward at the target, right
 * level, up square to both. The camera never rolls (#499).
 */
export function nearPyramid(
  rig: CameraRig,
  aspect: number,
  near: number = NEAR_PLANE_METRES,
): NearPyramid {
  const forward = unit(minus(rig.target, rig.eye));
  const right = unit(cross(forward, vector(0, 1, 0)));
  const up = cross(right, forward);
  const across = near * horizontalSpread(aspect);
  const rise = near * verticalHalfTangent(aspect);
  const corner = (side: number, height: number): RigPoint =>
    vector(
      rig.eye.x + forward.x * near + right.x * across * side + up.x * rise * height,
      rig.eye.y + forward.y * near + right.y * across * side + up.y * rise * height,
      rig.eye.z + forward.z * near + right.z * across * side + up.z * rise * height,
    );
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const [ea, eb, ec, ed] = corners.map((each) => minus(each, rig.eye)) as [
    RigPoint,
    RigPoint,
    RigPoint,
    RigPoint,
  ];
  const points = [rig.eye, ...corners];
  const normals = [forward, cross(ea, eb), cross(eb, ec), cross(ec, ed), cross(ed, ea)];
  const edges = [right, up, ea, eb, ec, ed];
  return {
    points,
    normals,
    edges,
    radius: Math.hypot(near, across, rise),
    packed: { points: packed(points), normals: packed(normals), edges: packed(edges) },
  };
}

function packed(vectors: readonly RigPoint[]): Float64Array {
  const out = new Float64Array(vectors.length * 3);
  vectors.forEach((each, at) => {
    out[at * 3] = each.x;
    out[at * 3 + 1] = each.y;
    out[at * 3 + 2] = each.z;
  });
  return out;
}

/** Where a set of points lies along an axis. */
function span(points: readonly RigPoint[], axis: RigPoint): readonly [number, number] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const at = dot(point, axis);
    low = Math.min(low, at);
    high = Math.max(high, at);
  }
  return [low, high];
}

/**
 * Whether two convex solids, given by their corners, lie apart along `axis`.
 * Two parallel edges cross to nothing, and nothing separates nothing.
 */
function apartAlong(
  axis: RigPoint,
  first: readonly RigPoint[],
  second: readonly RigPoint[],
): boolean {
  if (Math.hypot(axis.x, axis.y, axis.z) < 1e-9) return false;
  const [lowA, highA] = span(first, axis);
  const [lowB, highB] = span(second, axis);
  return highA < lowB || highB < lowA;
}

/**
 * Whether a convex solid meets the pyramid: the separating-axis test. Two
 * convex solids are apart exactly when some plane square to a face of either,
 * or to an edge of each, has them on opposite sides — so the face normals of
 * both and every edge of one crossed with every edge of the other decide it.
 */
function meetsPyramid(
  corners: readonly RigPoint[],
  normals: readonly RigPoint[],
  edges: readonly RigPoint[],
  pyramid: NearPyramid,
): boolean {
  for (const axis of normals) if (apartAlong(axis, corners, pyramid.points)) return false;
  for (const axis of pyramid.normals) if (apartAlong(axis, corners, pyramid.points)) return false;
  for (const edge of edges) {
    for (const other of pyramid.edges) {
      if (apartAlong(cross(edge, other), corners, pyramid.points)) return false;
    }
  }
  return true;
}

/**
 * Whether an item's BOX meets the pyramid. The yaw is `settlements.ts`
 * §`structureClearance`'s — the item's own `x` runs along `(cos, 0, −sin)` and
 * its own `z` along `(sin, 0, cos)` — which is three's rotation about +y.
 */
export function intrudes(item: ScatterItem, pyramid: NearPyramid, world: DrawnWorld): boolean {
  const reach = sceneryReach(item.kind, world);
  const s = item.scale;
  const eye = pyramid.points[0] as RigPoint;
  // Let go on distance first: nearly every item is metres away.
  const plan = Math.hypot(reach.x, Math.max(-reach.back, reach.front)) * s;
  if (Math.hypot(eye.x - item.x, eye.z - item.z) > plan + pyramid.radius) return false;
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  const across = vector(cos, 0, -sin);
  const along = vector(sin, 0, cos);
  const corners: RigPoint[] = [];
  for (const x of [-reach.x, reach.x]) {
    for (const z of [reach.back, reach.front]) {
      for (const y of [reach.bottom, reach.top]) {
        corners.push(
          vector(
            item.x + (across.x * x + along.x * z) * s,
            item.y + y * s,
            item.z + (across.z * x + along.z * z) * s,
          ),
        );
      }
    }
  }
  const axes = [across, vector(0, 1, 0), along];
  return meetsPyramid(corners, axes, axes, pyramid);
}

/**
 * The one triangle {@link triangleMeets} and {@link shapeMeets} test, three
 * corners of x, y and z in the world. ⚠️ **One array for the whole program, on
 * purpose**: the test runs per triangle on the render loop's thread, and the
 * first version made three corner objects and eighteen crossed axes for each —
 * about 150 000 short-lived objects on a frame a realistic tree passed the eye,
 * on which nothing was dropped (#545's review; #240's NFR-3).
 */
const TRIANGLE = new Float64Array(9);

/**
 * Whether {@link TRIANGLE} and the pyramid lie apart along the axis
 * `(ax, ay, az)`. Two parallel edges cross to nothing, and nothing separates
 * nothing.
 */
function triangleApartAlong(ax: number, ay: number, az: number, points: Float64Array): boolean {
  if (ax * ax + ay * ay + az * az < 1e-18) return false;
  let lowT = Number.POSITIVE_INFINITY;
  let highT = Number.NEGATIVE_INFINITY;
  for (let at = 0; at < 9; at += 3) {
    const along =
      (TRIANGLE[at] as number) * ax +
      (TRIANGLE[at + 1] as number) * ay +
      (TRIANGLE[at + 2] as number) * az;
    if (along < lowT) lowT = along;
    if (along > highT) highT = along;
  }
  let lowP = Number.POSITIVE_INFINITY;
  let highP = Number.NEGATIVE_INFINITY;
  for (let at = 0; at < points.length; at += 3) {
    const along =
      (points[at] as number) * ax +
      (points[at + 1] as number) * ay +
      (points[at + 2] as number) * az;
    if (along < lowP) lowP = along;
    if (along > highP) highP = along;
  }
  return highT < lowP || highP < lowT;
}

/**
 * Whether {@link TRIANGLE} meets the pyramid: {@link meetsPyramid}'s
 * separating-axis test — the triangle's normal, the pyramid's five, and each
 * of the triangle's three edges crossed with each of the pyramid's six — on
 * numbers rather than objects.
 */
function packedTriangleMeets(pyramid: NearPyramid): boolean {
  const { points, normals, edges } = pyramid.packed;
  const t = TRIANGLE;
  const abx = (t[3] as number) - (t[0] as number);
  const aby = (t[4] as number) - (t[1] as number);
  const abz = (t[5] as number) - (t[2] as number);
  const bcx = (t[6] as number) - (t[3] as number);
  const bcy = (t[7] as number) - (t[4] as number);
  const bcz = (t[8] as number) - (t[5] as number);
  const cax = (t[0] as number) - (t[6] as number);
  const cay = (t[1] as number) - (t[7] as number);
  const caz = (t[2] as number) - (t[8] as number);
  if (
    triangleApartAlong(aby * bcz - abz * bcy, abz * bcx - abx * bcz, abx * bcy - aby * bcx, points)
  ) {
    return false;
  }
  for (let at = 0; at < normals.length; at += 3) {
    if (
      triangleApartAlong(
        normals[at] as number,
        normals[at + 1] as number,
        normals[at + 2] as number,
        points,
      )
    ) {
      return false;
    }
  }
  for (let edge = 0; edge < 3; edge += 1) {
    const ex = edge === 0 ? abx : edge === 1 ? bcx : cax;
    const ey = edge === 0 ? aby : edge === 1 ? bcy : cay;
    const ez = edge === 0 ? abz : edge === 1 ? bcz : caz;
    for (let at = 0; at < edges.length; at += 3) {
      const ox = edges[at] as number;
      const oy = edges[at + 1] as number;
      const oz = edges[at + 2] as number;
      if (triangleApartAlong(ey * oz - ez * oy, ez * ox - ex * oz, ex * oy - ey * ox, points)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Whether one triangle, three corners in the world, meets the pyramid.
 *
 * @test-facing the separating-axis test on one triangle, which
 * `near-field.test.ts` holds to cases worked by hand; `shapeMeets` runs the
 * same test on its own survivors without making the three corners this takes.
 */
export function triangleMeets(
  a: RigPoint,
  b: RigPoint,
  c: RigPoint,
  pyramid: NearPyramid,
): boolean {
  const eye = pyramid.points[0] as RigPoint;
  const reach = pyramid.radius;
  // Let go on distance first: a triangle wholly beyond the pyramid's reach on
  // one side of the eye cannot meet it.
  for (const axis of ['x', 'y', 'z'] as const) {
    if (a[axis] - eye[axis] > reach && b[axis] - eye[axis] > reach && c[axis] - eye[axis] > reach) {
      return false;
    }
    if (eye[axis] - a[axis] > reach && eye[axis] - b[axis] > reach && eye[axis] - c[axis] > reach) {
      return false;
    }
  }
  TRIANGLE[0] = a.x;
  TRIANGLE[1] = a.y;
  TRIANGLE[2] = a.z;
  TRIANGLE[3] = b.x;
  TRIANGLE[4] = b.y;
  TRIANGLE[5] = b.z;
  TRIANGLE[6] = c.x;
  TRIANGLE[7] = c.y;
  TRIANGLE[8] = c.z;
  return packedTriangleMeets(pyramid);
}

/**
 * One shape's triangles, in the item's own frame at a scale of 1: nine numbers
 * a triangle, three corners of x, y and z.
 */
export type ShapeTriangles = Float32Array;

/**
 * How many triangles share one bounding sphere in a {@link PreparedShape}.
 * Measured on the realistic trees at 16 : 10 (#545's review): 32 lets all but
 * a handful of a 56 000-triangle broadleaf go on one sphere test per chunk,
 * and a smaller chunk only adds spheres to test.
 */
const CHUNK_TRIANGLES = 32;

/** The cell a triangle is sorted into, in metres, so that a chunk is a place and not a run of the file. */
const CHUNK_CELL_METRES = 0.5;

/**
 * A shape made ready for {@link shapeMeets}: its triangles re-ordered so that
 * neighbours in space are neighbours in the array, and a bounding sphere per
 * {@link CHUNK_TRIANGLES} of them — four numbers a chunk, centre and radius.
 */
interface PreparedShape {
  readonly triangles: Float32Array;
  readonly spheres: Float32Array;
}

/** Each shape's preparation, kept against the array it was made from. */
const PREPARED = new WeakMap<ShapeTriangles, PreparedShape>();

/**
 * Prepares a shape for {@link shapeMeets}, once: sorts its triangles by the
 * {@link CHUNK_CELL_METRES} cell their centroid is in, and bounds each run of
 * {@link CHUNK_TRIANGLES}. `three-renderer.ts` calls this when the models LOAD,
 * so the one-off cost lands before a ride rather than on the frame a tree first
 * comes near the eye; a shape nobody prepared is prepared on first ask.
 */
export function prepareShape(shape: ShapeTriangles): void {
  preparedOf(shape);
}

function preparedOf(shape: ShapeTriangles): PreparedShape {
  const cached = PREPARED.get(shape);
  if (cached !== undefined) return cached;
  const count = Math.floor(shape.length / 9);
  const cells = new Float64Array(count * 3);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  for (let triangle = 0; triangle < count; triangle += 1) {
    const at = triangle * 9;
    for (let axis = 0; axis < 3; axis += 1) {
      const centroid =
        ((shape[at + axis] as number) +
          (shape[at + 3 + axis] as number) +
          (shape[at + 6 + axis] as number)) /
        3;
      cells[triangle * 3 + axis] = centroid;
    }
    minX = Math.min(minX, cells[triangle * 3] as number);
    minY = Math.min(minY, cells[triangle * 3 + 1] as number);
    minZ = Math.min(minZ, cells[triangle * 3 + 2] as number);
  }
  const cellOf = (triangle: number, axis: number, min: number): number =>
    Math.floor(((cells[triangle * 3 + axis] as number) - min) / CHUNK_CELL_METRES);
  const order = Array.from({ length: count }, (_, triangle) => triangle);
  order.sort(
    (p, q) =>
      cellOf(p, 1, minY) - cellOf(q, 1, minY) ||
      cellOf(p, 2, minZ) - cellOf(q, 2, minZ) ||
      cellOf(p, 0, minX) - cellOf(q, 0, minX) ||
      p - q,
  );
  const triangles = new Float32Array(count * 9);
  order.forEach((from, to) => {
    triangles.set(shape.subarray(from * 9, from * 9 + 9), to * 9);
  });
  const chunks = Math.ceil(count / CHUNK_TRIANGLES);
  const spheres = new Float32Array(chunks * 4);
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const from = chunk * CHUNK_TRIANGLES * 9;
    const to = Math.min(count, (chunk + 1) * CHUNK_TRIANGLES) * 9;
    const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let at = from; at < to; at += 1) {
      const axis = at % 3;
      low[axis] = Math.min(low[axis] as number, triangles[at] as number);
      high[axis] = Math.max(high[axis] as number, triangles[at] as number);
    }
    const centre = [0, 1, 2].map((axis) => ((low[axis] as number) + (high[axis] as number)) / 2);
    let radius = 0;
    for (let at = from; at < to; at += 3) {
      radius = Math.max(
        radius,
        Math.hypot(
          (triangles[at] as number) - (centre[0] as number),
          (triangles[at + 1] as number) - (centre[1] as number),
          (triangles[at + 2] as number) - (centre[2] as number),
        ),
      );
    }
    spheres[chunk * 4] = centre[0] as number;
    spheres[chunk * 4 + 1] = centre[1] as number;
    spheres[chunk * 4 + 2] = centre[2] as number;
    // Rounded outwards: a Float32 radius a hair short would let a chunk go that
    // touches the pyramid by that hair.
    spheres[chunk * 4 + 3] = radius * (1 + 1e-6) + 1e-6;
  }
  const prepared = { triangles, spheres };
  PREPARED.set(shape, prepared);
  return prepared;
}

/**
 * Whether any triangle of `shape`, drawn for `item`, meets the pyramid — the
 * question the near plane actually asks. Placed as `three-renderer.ts`' belts
 * place an instance: scaled by `item.scale`, turned by `item.rotation` about
 * +y, stood at the item.
 *
 * ⚠️ **It makes no object, and it tests few triangles.** The pyramid lies
 * inside a sphere of `pyramid.radius` about the eye, so the eye is taken into
 * the SHAPE's frame once, and a chunk whose sphere, or a triangle whose three
 * corners on one side, lie beyond that radius is let go before anything is
 * placed. Only what survives — on the rides, a few triangles of a tree beside
 * the eye — is placed in the world and given the full test. #545's review
 * measured the first version, which placed every triangle as three new
 * objects, at up to 3 ms a frame on this path at the tablet's aspect, where it
 * drops nothing.
 */
export function shapeMeets(
  item: ScatterItem,
  shape: ShapeTriangles,
  pyramid: NearPyramid,
): boolean {
  const s = item.scale;
  // An item drawn at no size has no triangle to cut.
  if (!(s > 0)) return false;
  const { triangles, spheres } = preparedOf(shape);
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  const eye = pyramid.points[0] as RigPoint;
  // The eye in the shape's own frame: the placement below, undone.
  const dx = eye.x - item.x;
  const dz = eye.z - item.z;
  const ex = (dx * cos - dz * sin) / s;
  const ey = (eye.y - item.y) / s;
  const ez = (dx * sin + dz * cos) / s;
  const reach = pyramid.radius / s;
  const count = Math.floor(triangles.length / 9);
  for (let chunk = 0; chunk * 4 < spheres.length; chunk += 1) {
    const cx = (spheres[chunk * 4] as number) - ex;
    const cy = (spheres[chunk * 4 + 1] as number) - ey;
    const cz = (spheres[chunk * 4 + 2] as number) - ez;
    const within = (spheres[chunk * 4 + 3] as number) + reach;
    if (cx * cx + cy * cy + cz * cz > within * within) continue;
    const last = Math.min(count, (chunk + 1) * CHUNK_TRIANGLES);
    for (let triangle = chunk * CHUNK_TRIANGLES; triangle < last; triangle += 1) {
      const at = triangle * 9;
      if (beyondOnAnAxis(triangles, at, ex, ey, ez, reach)) continue;
      for (let corner = 0; corner < 9; corner += 3) {
        const x = (triangles[at + corner] as number) * s;
        const y = (triangles[at + corner + 1] as number) * s;
        const z = (triangles[at + corner + 2] as number) * s;
        TRIANGLE[corner] = item.x + x * cos + z * sin;
        TRIANGLE[corner + 1] = item.y + y;
        TRIANGLE[corner + 2] = item.z - x * sin + z * cos;
      }
      if (packedTriangleMeets(pyramid)) return true;
    }
  }
  return false;
}

/**
 * Whether all three corners of the triangle at `at` lie more than `reach` from
 * `(ex, ey, ez)` on the same side along one axis — so it is outside the sphere
 * of that radius, whichever way the shape is turned.
 */
function beyondOnAnAxis(
  triangles: Float32Array,
  at: number,
  ex: number,
  ey: number,
  ez: number,
  reach: number,
): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    const centre = axis === 0 ? ex : axis === 1 ? ey : ez;
    const a = (triangles[at + axis] as number) - centre;
    const b = (triangles[at + 3 + axis] as number) - centre;
    const c = (triangles[at + 6 + axis] as number) - centre;
    if (a > reach && b > reach && c > reach) return true;
    if (a < -reach && b < -reach && c < -reach) return true;
  }
  return false;
}

/**
 * The shapes a kind may be drawn as in the world being drawn, as triangles in
 * the item's own frame at a scale of 1 — or `undefined` for a kind whose
 * shape is not known here, which is then judged by its box alone.
 */
export type ShapesOf = (kind: SceneryKind) => readonly ShapeTriangles[] | undefined;

/**
 * The items of one frame the near plane would not cut, for a frame of this
 * aspect in this world — what `three-renderer.ts` hands its scenery belts.
 *
 * An item is dropped when its box meets the pyramid AND a triangle of any shape
 * its kind may be drawn as does — every shape rather than the one its variant
 * picks, because which that is depends on the rung. A kind `shapesOf` knows no
 * shape for is dropped on its box, the safe way round.
 *
 * Order is kept, so a belt that spends its budget in frame order spends it on
 * the same items. ⚠️ **The same array when nothing is dropped**, which is
 * nearly every frame: the render loop runs on the thread GATT notifications
 * arrive on, and a copy of three hundred items a frame is garbage for nothing
 * (#240's NFR-3).
 */
export function clearOfTheCamera(
  items: readonly ScatterItem[],
  rig: CameraRig,
  aspect: number,
  world: DrawnWorld,
  shapesOf: ShapesOf,
): readonly ScatterItem[] {
  const pyramid = nearPyramid(rig, aspect);
  let kept: ScatterItem[] | undefined;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as ScatterItem;
    let cut = false;
    if (intrudes(item, pyramid, world)) {
      const shapes = shapesOf(item.kind);
      cut = shapes === undefined;
      // A loop rather than `some`, which would make a closure per item.
      for (let shape = 0; !cut && shapes !== undefined && shape < shapes.length; shape += 1) {
        cut = shapeMeets(item, shapes[shape] as ShapeTriangles, pyramid);
      }
    }
    if (cut) {
      kept ??= items.slice(0, index);
    } else {
      kept?.push(item);
    }
  }
  return kept ?? items;
}
