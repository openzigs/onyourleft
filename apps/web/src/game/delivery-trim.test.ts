// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PR #2518's trim of Delivery's obstacles and markers, held to the owner's
 * ruling of 2026-11-13: **invisible**, and its triangles found where no rider
 * can see them.
 *
 * The review found the first trim visible. It left out every face looking
 * straight down from under the chase camera's 2 m eye, on the reasoning that
 * the eye sees such a face from behind. But an obstacle is turned about the
 * vertical only, so up a climb one stands above the eye: on `busy-round.json`
 * near 1 770 m a parked car 44 m ahead stands 3.18 m above the eye's road, the
 * eye sees its underside from in front, and with that face gone a band of
 * road about 2 px tall showed through the car.
 *
 * Two cases here:
 *
 * - **The review's own geometry**: from that eye, every obstacle kind with a
 *   face looking down above the road, and a mailbox, still draws a face
 *   looking down whose front the eye sees.
 * - **The tablet's pixels**: from eyes on the flat and up the steepest climb a
 *   shipped level makes, at 1280×800 through the chase camera's lens, every
 *   pixel the trimmed geometry draws is the pixel every triangle the parts
 *   were made with draws, the road an occluder. Only the pixels round the
 *   triangles that differ are cast, so the case is quick.
 *
 * Nothing here may import three (`three-seam.test.ts`): the rays and the
 * projection are this file's own arithmetic, over the belt's own buffers.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CAMERA_ABOVE_METRES, verticalFieldOfViewDegrees } from './camera';
import { OBSTACLE_KINDS, type ObstacleKind } from './delivery/obstacles';
import { parseLevelFile } from './delivery/levels/level-file';
import { LEVEL_CATALOGUE } from './delivery/levels/catalogue';
import { levelRoute } from './delivery/levels/levels';
import type { DeliveryInView, DeliveryMarkerKind, DeliveryObstacleKind } from './port';
import { DeliveryBelt, deliveryPieceShape } from './three-renderer';

type Vector = readonly [number, number, number];

/** The obstacle roster in the renderer's order (`three-renderer.ts` §`DELIVERY_OBSTACLE_ORDER`). */
const ROSTER = Object.keys(OBSTACLE_KINDS) as readonly ObstacleKind[];

/** The markers in the renderer's order (`three-renderer.ts` §`DELIVERY_MARKER_ORDER`). */
const MARKERS: readonly DeliveryMarkerKind[] = ['house', 'mailbox', 'no-delivery'];

/** The owner's tablet, 1280×800. */
const TABLET = { width: 1280, height: 800 } as const;

const LEVELS = fileURLToPath(new URL('./delivery/levels/data/', import.meta.url));

/**
 * The steepest a shipped level climbs, as a grade, over any stretch from 20 m
 * to 100 m of its drawn profile: how far up the road a piece can stand above
 * the eye.
 */
function steepestShippedClimb(): number {
  let steepest = 0;
  for (const { id } of LEVEL_CATALOGUE) {
    const file = parseLevelFile(JSON.parse(readFileSync(join(LEVELS, `${id}.json`), 'utf8')), id);
    const { elevations, resolution } = levelRoute(file).profile;
    for (let from = 0; from < elevations.length; from += 1) {
      for (let ahead = Math.ceil(20 / resolution); ahead * resolution <= 100; ahead += 1) {
        const to = elevations[from + ahead];
        if (to === undefined) break;
        steepest = Math.max(steepest, (to - (elevations[from] as number)) / (ahead * resolution));
      }
    }
  }
  return steepest;
}

/** One triangle as drawn: its corners in the world, its winding's normal and its paint. */
interface Drawn {
  readonly corners: readonly [Vector, Vector, Vector];
  readonly normal: Vector;
  readonly paint: string;
}

const minus = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vector): Vector => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** A geometry's attribute, as the belt's buffers hold it. */
interface Attribute {
  readonly count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}
interface Shape {
  getAttribute(name: string): Attribute;
}

/**
 * The triangles of `shape` that an instance of `kind` draws (its own, or a
 * second kind's it also draws, #2506), placed by `matrix` (16 floats,
 * column-major, as an instance matrix is held).
 */
function drawnOf(shape: Shape, kind: number, matrix: ArrayLike<number>): readonly Drawn[] {
  const position = shape.getAttribute('position');
  const colour = shape.getAttribute('color');
  const kinds = shape.getAttribute('oylPieceKind');
  const also = shape.getAttribute('oylPieceAlso');
  const m = Array.from({ length: 16 }, (_, at) => matrix[at] as number);
  const placed = (at: number): Vector => {
    const [x, y, z] = [position.getX(at), position.getY(at), position.getZ(at)];
    return [
      m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
      m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
      m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    ];
  };
  const drawn: Drawn[] = [];
  for (let at = 0; at < position.count; at += 3) {
    if (kinds.getX(at) !== kind && also.getX(at) !== kind) continue;
    const corners = [placed(at), placed(at + 1), placed(at + 2)] as const;
    const normal = cross(minus(corners[1], corners[0]), minus(corners[2], corners[0]));
    if (Math.hypot(...normal) === 0) continue;
    const paint = [colour.getX(at), colour.getY(at), colour.getZ(at)]
      .map((each) => each.toFixed(4))
      .join(',');
    drawn.push({ corners, normal: unit(normal), paint });
  }
  return drawn;
}

/** The instance matrix `belt` gives its first `what` for `view`, seen from `eye`. */
function placedBy(
  belt: DeliveryBelt,
  what: 'obstacles' | 'markers',
  view: DeliveryInView,
  eye: Vector,
): readonly number[] {
  belt.update(view, { x: eye[0], y: eye[1], z: eye[2] });
  return Array.from(belt.meshOf(what).instanceMatrix.array.slice(0, 16));
}

/** A pinhole camera at `eye` looking at `target`, the chase camera's lens on the tablet. */
function lens(eye: Vector, target: Vector) {
  const forward = unit(minus(target, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tall = Math.tan(
    ((verticalFieldOfViewDegrees(TABLET.width / TABLET.height) / 2) * Math.PI) / 180,
  );
  const wide = tall * (TABLET.width / TABLET.height);
  return {
    /** Where `point` falls on the screen, in pixels from the top left. */
    pixel(point: Vector): readonly [number, number] {
      const to = minus(point, eye);
      const depth = dot(to, forward);
      return [
        ((dot(to, right) / depth / wide + 1) / 2) * TABLET.width,
        ((1 - dot(to, up) / depth / tall) / 2) * TABLET.height,
      ];
    },
    /** The ray through the middle of pixel `(column, row)`. */
    ray(column: number, row: number): Vector {
      const across = (((column + 0.5) / TABLET.width) * 2 - 1) * wide;
      const down = (1 - ((row + 0.5) / TABLET.height) * 2) * tall;
      return unit([
        forward[0] + right[0] * across + up[0] * down,
        forward[1] + right[1] * across + up[1] * down,
        forward[2] + right[2] * across + up[2] * down,
      ]);
    },
  };
}

/** How far along `ray` from `eye` it meets `triangle`'s front face (Möller–Trumbore), or `Infinity`. */
function meets(eye: Vector, ray: Vector, triangle: Drawn): number {
  if (dot(triangle.normal, ray) >= 0) return Infinity;
  const [a, b, c] = triangle.corners;
  const ab = minus(b, a);
  const ac = minus(c, a);
  const p = cross(ray, ac);
  const determinant = dot(ab, p);
  if (Math.abs(determinant) < 1e-12) return Infinity;
  const toEye = minus(eye, a);
  const u = dot(toEye, p) / determinant;
  if (u < 0 || u > 1) return Infinity;
  const q = cross(toEye, ab);
  const v = dot(ray, q) / determinant;
  if (v < 0 || u + v > 1) return Infinity;
  const distance = dot(ac, q) / determinant;
  return distance > 0 ? distance : Infinity;
}

/** A sloping road through the origin, rising `grade` along `+z`: its front face, up. */
function roadMet(eye: Vector, ray: Vector, grade: number): number {
  const normal = unit([0, 1, -grade]);
  const facing = dot(normal, ray);
  if (facing >= 0) return Infinity;
  const distance = -dot(normal, eye) / facing;
  return distance > 0 ? distance : Infinity;
}

/** A triangle as a key of its corners, whatever the order it was listed in. */
function keyOf(triangle: Drawn): string {
  return triangle.corners
    .map((corner) => corner.map((each) => each.toFixed(5)).join(','))
    .sort()
    .join('|');
}

/** Triangles bucketed by the 16-pixel tiles their screen boxes touch. */
function tiled(triangles: readonly Drawn[], view: ReturnType<typeof lens>) {
  const tiles = new Map<number, Drawn[]>();
  for (const triangle of triangles) {
    const pixels = triangle.corners.map((corner) => view.pixel(corner));
    const [left, right] = [
      Math.min(...pixels.map((p) => p[0])),
      Math.max(...pixels.map((p) => p[0])),
    ];
    const [top, bottom] = [
      Math.min(...pixels.map((p) => p[1])),
      Math.max(...pixels.map((p) => p[1])),
    ];
    for (let x = Math.floor(left / 16); x <= Math.floor(right / 16); x += 1) {
      for (let y = Math.floor(top / 16); y <= Math.floor(bottom / 16); y += 1) {
        const tile = y * 1000 + x;
        tiles.set(tile, [...(tiles.get(tile) ?? []), triangle]);
      }
    }
  }
  return (column: number, row: number): readonly Drawn[] =>
    tiles.get(Math.floor(row / 16) * 1000 + Math.floor(column / 16)) ?? [];
}

/** What a pixel shows: a triangle's paint, the road or the sky, and how far. */
function firstHit(
  eye: Vector,
  ray: Vector,
  candidates: readonly Drawn[],
  grade: number,
): { readonly what: string; readonly distance: number } {
  let what = 'sky';
  let distance = roadMet(eye, ray, grade);
  if (distance < Infinity) what = 'road';
  for (const triangle of candidates) {
    const met = meets(eye, ray, triangle);
    if (met < distance) {
      distance = met;
      what = triangle.paint;
    }
  }
  return { what, distance };
}

/**
 * Every pixel round the triangles in which `trimmed` and `whole` differ, from
 * `eye` on a road of `grade`: the pixels where the two show different things.
 */
function pixelsChanged(
  trimmed: readonly Drawn[],
  whole: readonly Drawn[],
  eye: Vector,
  target: Vector,
  grade: number,
): readonly string[] {
  const view = lens(eye, target);
  const trimmedKeys = new Set(trimmed.map(keyOf));
  const wholeKeys = new Set(whole.map(keyOf));
  const differing = [
    ...trimmed.filter((each) => !wholeKeys.has(keyOf(each))),
    ...whole.filter((each) => !trimmedKeys.has(keyOf(each))),
  ];
  const pixels = new Set<number>();
  for (const triangle of differing) {
    const corners = triangle.corners.map((corner) => view.pixel(corner));
    const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))) - 1);
    const right = Math.min(TABLET.width - 1, Math.ceil(Math.max(...corners.map((p) => p[0]))) + 1);
    const top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))) - 1);
    const bottom = Math.min(
      TABLET.height - 1,
      Math.ceil(Math.max(...corners.map((p) => p[1]))) + 1,
    );
    for (let column = left; column <= right; column += 1) {
      for (let row = top; row <= bottom; row += 1) pixels.add(row * TABLET.width + column);
    }
  }
  const trimmedAt = tiled(trimmed, view);
  const wholeAt = tiled(whole, view);
  const changed: string[] = [];
  for (const pixel of pixels) {
    const [column, row] = [pixel % TABLET.width, Math.floor(pixel / TABLET.width)];
    const ray = view.ray(column, row);
    const now = firstHit(eye, ray, trimmedAt(column, row), grade);
    const was = firstHit(eye, ray, wholeAt(column, row), grade);
    const same =
      now.what === was.what &&
      (now.distance === was.distance ||
        Math.abs(now.distance - was.distance) < 1e-4 * was.distance);
    if (!same) changed.push(`(${String(column)}, ${String(row)}): ${was.what} → ${now.what}`);
  }
  return changed;
}

describe('PR #2518’s trim is invisible — the owner’s ruling of 2026-11-13', () => {
  it('draws, from the review’s eye up busy-round’s climb, a face looking down under every piece', () => {
    // The review's geometry: a piece 44 m up the road, standing 3.18 m above
    // the eye's road, so 1.18 m above the eye. Turned about the vertical only,
    // each piece's faces that look down face the eye: the car's underside, the
    // bin's bottom and its lid's rim, the trolley's plate and crossbars, the
    // cone's foot, the dog's belly and paws, the rider's frame and jacket, and
    // each marker's foot (a mailbox's box too, drawn enlarged at 44 m, #2453).
    const eye: Vector = [0, CAMERA_ABOVE_METRES, -44];
    const at = { x: 0, y: 3.18, z: 0, yaw: 0 };
    const belt = new DeliveryBelt('stylised');
    const seenFromBelow = (triangles: readonly Drawn[]): number =>
      triangles.filter(
        (each) => each.normal[1] < -0.99 && dot(each.normal, minus(eye, each.corners[0])) > 0,
      ).length;
    for (const kind of ROSTER) {
      const view: DeliveryInView = { parcels: [], markers: [], obstacles: [{ ...at, kind }] };
      const triangles = drawnOf(
        deliveryPieceShape('obstacles', true),
        ROSTER.indexOf(kind),
        placedBy(belt, 'obstacles', view, eye),
      );
      expect(seenFromBelow(triangles), kind).toBeGreaterThan(0);
    }
    for (const kind of MARKERS) {
      const view: DeliveryInView = { parcels: [], markers: [{ ...at, kind }], obstacles: [] };
      const triangles = drawnOf(
        deliveryPieceShape('markers', true),
        MARKERS.indexOf(kind),
        placedBy(belt, 'markers', view, eye),
      );
      expect(seenFromBelow(triangles), kind).toBeGreaterThan(0);
    }
    belt.dispose();
  });

  const steepest = steepestShippedClimb();

  it('finds the steepest shipped climb, busy-round’s, in the drawn profile', () => {
    // 7.1 % on the profile's despiked 10 m grid, which the corridor is drawn
    // from; the review's 3.18 m in 44 m (7.2 %) read the file's own points.
    expect(steepest).toBeGreaterThan(0.07);
    expect(steepest).toBeLessThan(0.1);
  });

  /** Eyes on a road of `grade` rising along `+z` to a piece at the origin: 2 m above the road, behind it and to its side. */
  const eyes = (grade: number): readonly Vector[] =>
    [8, 20, 44, 80].flatMap((behind) =>
      [0, 3.5].map((side): Vector => [side, -grade * behind + CAMERA_ABOVE_METRES, -behind]),
    );

  const cases: readonly { readonly what: 'obstacles' | 'markers'; readonly kind: string }[] = [
    ...ROSTER.map((kind) => ({ what: 'obstacles' as const, kind })),
    ...MARKERS.map((kind) => ({ what: 'markers' as const, kind })),
  ];

  it.each(cases)(
    'draws a $kind in the same pixels as every triangle it was made with, on the flat and up the steepest shipped climb',
    ({ what, kind }) => {
      const order: readonly string[] = what === 'obstacles' ? ROSTER : MARKERS;
      const trimmedShape = deliveryPieceShape(what, true);
      const wholeShape = deliveryPieceShape(what, false);
      const belt = new DeliveryBelt('stylised');
      const changed: string[] = [];
      let trimmedSomewhere = false;
      for (const grade of [0, steepest]) {
        // From behind the piece, its left, ahead of it and its right.
        for (const [eye, yaw] of eyes(grade).flatMap((each) =>
          [0, 1, 2, 3].map((quarter) => [each, (quarter * Math.PI) / 2] as const),
        )) {
          const piece = { x: 0, y: 0, z: 0, yaw };
          const view: DeliveryInView =
            what === 'obstacles'
              ? {
                  parcels: [],
                  markers: [],
                  obstacles: [{ ...piece, kind: kind as DeliveryObstacleKind }],
                }
              : {
                  parcels: [],
                  markers: [{ ...piece, kind: kind as DeliveryMarkerKind }],
                  obstacles: [],
                };
          const matrix = placedBy(belt, what, view, eye);
          const trimmed = drawnOf(trimmedShape, order.indexOf(kind), matrix);
          const whole = drawnOf(wholeShape, order.indexOf(kind), matrix);
          // The trim only ever leaves triangles out, or draws a cap in fewer.
          expect(trimmed.length, kind).toBeLessThanOrEqual(whole.length);
          trimmedSomewhere ||= trimmed.length < whole.length;
          const target: Vector = [0, matrix[13]! + 0.5 * matrix[5]!, 0];
          for (const pixel of pixelsChanged(trimmed, whole, eye, target, grade)) {
            changed.push(
              `grade ${grade.toFixed(3)}, eye ${eye.map((each) => each.toFixed(1)).join(' ')}: ${pixel}`,
            );
          }
        }
      }
      belt.dispose();
      expect(changed.slice(0, 10), `${String(changed.length)} pixels changed`).toEqual([]);
      // Not vacuous where the trim reaches: a doorstep's marker and a no-delivery
      // sign have nothing hidden and no fanned cap, so are drawn whole.
      expect(trimmedSomewhere, kind).toBe(kind !== 'house' && kind !== 'no-delivery');
    },
  );
});
