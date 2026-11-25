// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which drawn building faces fight for the same depth** — #3132.
 *
 * The owner's tablet ride of 2026-11-24 saw a building's side wall flicker
 * in stripes and patches between its facade and a lighter colour: two faces
 * on one plane, both drawn, each winning the depth test on alternate pixels
 * (z-fighting). This finds such pairs among the triangles a frame's mapped
 * buildings are drawn with (`footprint-buildings.ts` §`FootprintPlan.triangles`).
 *
 * ## What counts as a pair
 *
 * Two triangles of **different** plans that:
 *
 * - **face the same way** (their normals within {@link SAME_FACING_DOT}).
 *   The belt's materials are one-sided (`three-renderer.ts`
 *   §`mappedBuildingMaterial` sets no `side`, so the back face is culled): two
 *   walls on one plane facing opposite ways are each seen only from its own
 *   side, and neither can win a pixel from the other. A shared wall between
 *   two neighbours is that case — each faces into the other's mass — and is
 *   not a fight;
 * - **lie on one plane**: every vertex of each within `tolerance` of the
 *   other's plane (1 cm, the issue's); and
 * - **overlap** by more than {@link OVERLAP_MIN_SQUARE_METRES} once both are
 *   laid flat in that plane: a touching edge is no overlap.
 *
 * A `-testing.ts` file: nothing that ships imports it.
 */

import {
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';

/** Two normals face the same way above this cosine: about 0.8°. */
export const SAME_FACING_DOT = 0.9999;

/** Two flattened triangles overlap above this area: **10 cm²**, far above rounding. */
export const OVERLAP_MIN_SQUARE_METRES = 1e-3;

/** One pair of plans with a face each on one plane, and the area they share there. */
export interface CoplanarFaces {
  /** The two plans' indices, the lower first. */
  readonly plans: readonly [number, number];
  /** The summed area, square metres, of every overlapping pair of their triangles. */
  readonly area: number;
  /** A point on the plane they share, for the reader of a failure. */
  readonly at: readonly [number, number, number];
  /** The roles of the triangles that fight, `first/second` by plan, each once. */
  readonly roles: readonly string[];
}

interface Face {
  readonly plan: number;
  readonly role: FootprintRole;
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly c: readonly [number, number, number];
  readonly n: readonly [number, number, number];
  readonly d: number;
}

type Vec3 = readonly [number, number, number];

function sub(p: Vec3, q: Vec3): Vec3 {
  return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
}

function dot(p: Vec3, q: Vec3): number {
  return p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
}

function cross(p: Vec3, q: Vec3): Vec3 {
  return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
}

/** Every triangle of `plan` with an area, its normal from its winding. */
function facesOf(plan: FootprintPlan, index: number, into: Face[]): void {
  for (const role of FOOTPRINT_ROLES) {
    const floats = plan.triangles[role];
    const stride = FOOTPRINT_VERTEX_FLOATS;
    for (let at = 0; at + stride * 3 <= floats.length; at += stride * 3) {
      const vertex = (k: number): Vec3 => [
        floats[at + k * stride] as number,
        floats[at + k * stride + 1] as number,
        floats[at + k * stride + 2] as number,
      ];
      const a = vertex(0);
      const b = vertex(1);
      const c = vertex(2);
      const normal = cross(sub(b, a), sub(c, a));
      const length = Math.hypot(...normal);
      // Below a square centimetre: no area to fight over.
      if (!(length / 2 > 1e-4)) continue;
      const n: Vec3 = [normal[0] / length, normal[1] / length, normal[2] / length];
      into.push({ plan: index, role, a, b, c, n, d: dot(n, a) });
    }
  }
}

/** The area of `subject` (a convex polygon, 2-D) inside `clip` (a counter-clockwise triangle). */
function overlapArea(
  subject: readonly (readonly [number, number])[],
  clip: readonly (readonly [number, number])[],
): number {
  let polygon = subject.slice();
  for (let edge = 0; edge < clip.length && polygon.length > 0; edge += 1) {
    const [px, pz] = clip[edge] as readonly [number, number];
    const [qx, qz] = clip[(edge + 1) % clip.length] as readonly [number, number];
    const inside = (point: readonly [number, number]): number =>
      (qx - px) * (point[1] - pz) - (qz - pz) * (point[0] - px);
    const next: (readonly [number, number])[] = [];
    for (let at = 0; at < polygon.length; at += 1) {
      const current = polygon[at] as readonly [number, number];
      const previous = polygon[(at + polygon.length - 1) % polygon.length] as readonly [
        number,
        number,
      ];
      const now = inside(current);
      const before = inside(previous);
      if (now >= 0) {
        if (before < 0) {
          const t = before / (before - now);
          next.push([
            previous[0] + (current[0] - previous[0]) * t,
            previous[1] + (current[1] - previous[1]) * t,
          ]);
        }
        next.push(current);
      } else if (before >= 0) {
        const t = before / (before - now);
        next.push([
          previous[0] + (current[0] - previous[0]) * t,
          previous[1] + (current[1] - previous[1]) * t,
        ]);
      }
    }
    polygon = next;
  }
  let twice = 0;
  for (let at = 0; at < polygon.length; at += 1) {
    const p = polygon[at] as readonly [number, number];
    const q = polygon[(at + 1) % polygon.length] as readonly [number, number];
    twice += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(twice) / 2;
}

/** `face` laid flat in the plane through it, on axes `u` and `v`, counter-clockwise. */
function flat(face: Face, u: Vec3, v: Vec3): (readonly [number, number])[] {
  const points = [face.a, face.b, face.c].map((p): readonly [number, number] => [
    dot(p, u),
    dot(p, v),
  ]);
  const [p, q, r] = points as [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  const turn = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return turn >= 0 ? points : [p, r, q];
}

/**
 * Every pair of `plans` (of those `drawn`, by index; all of them without it)
 * with a same-facing face on one plane, within `tolerance` metres, that
 * overlaps the other's. See the file's header.
 */
export function coplanarFaces(
  plans: readonly FootprintPlan[],
  drawn: readonly number[] = plans.map((_, index) => index),
  tolerance = 0.01,
): readonly CoplanarFaces[] {
  const faces: Face[] = [];
  for (const index of drawn) {
    const plan = plans[index];
    if (plan !== undefined) facesOf(plan, index, faces);
  }
  // Bucketed by the plane's distance from the origin, in cells twice the tolerance: a
  // face's partner is in its own cell or one either side.
  const cell = tolerance * 2;
  const buckets = new Map<number, number[]>();
  faces.forEach((face, at) => {
    const key = Math.floor(face.d / cell);
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [at]);
    else list.push(at);
  });
  const pairs = new Map<
    string,
    { plans: [number, number]; area: number; at: Vec3; roles: string[] }
  >();
  faces.forEach((face, at) => {
    const key = Math.floor(face.d / cell);
    for (const near of [key - 1, key, key + 1]) {
      for (const other of buckets.get(near) ?? []) {
        if (other <= at) continue;
        const them = faces[other] as Face;
        if (them.plan === face.plan) continue;
        if (dot(face.n, them.n) < SAME_FACING_DOT) continue;
        const off = (p: Vec3, of: Face): number => Math.abs(dot(of.n, p) - of.d);
        if (
          off(them.a, face) > tolerance ||
          off(them.b, face) > tolerance ||
          off(them.c, face) > tolerance ||
          off(face.a, them) > tolerance ||
          off(face.b, them) > tolerance ||
          off(face.c, them) > tolerance
        ) {
          continue;
        }
        // Axes in the plane: any direction across the normal, and the normal across that.
        const helper: Vec3 = Math.abs(face.n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const crossed = cross(helper, face.n);
        const length = Math.hypot(...crossed);
        const u: Vec3 = [crossed[0] / length, crossed[1] / length, crossed[2] / length];
        const v = cross(face.n, u);
        const area = overlapArea(flat(face, u, v), flat(them, u, v));
        if (!(area > OVERLAP_MIN_SQUARE_METRES)) continue;
        const low = Math.min(face.plan, them.plan);
        const high = Math.max(face.plan, them.plan);
        const pairKey = `${String(low)}:${String(high)}`;
        const roles = face.plan === low ? `${face.role}/${them.role}` : `${them.role}/${face.role}`;
        const known = pairs.get(pairKey);
        if (known === undefined) {
          pairs.set(pairKey, { plans: [low, high], area, at: face.a, roles: [roles] });
        } else {
          known.area += area;
          if (!known.roles.includes(roles)) known.roles.push(roles);
        }
      }
    }
  });
  return [...pairs.values()];
}
