// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shapes of field life — #3286 (`field-life.ts`): a cow, a sheep and a
 * round bale, generated in code from boxes and one low prism, as the park's
 * play structures are (`park-fields.ts`). No file, no texture and no byte of
 * the build: each corner carries its own colour, and the view bakes them into
 * one mesh (`three-renderer.ts` §`FieldLifeBelt`).
 *
 * An animal faces `+z` in its own frame, standing on `y = 0`, and is still: a
 * pose moves its head and its body, never a leg in a stride.
 *
 * | Shape | Near | Far |
 * |---|--:|--:|
 * | A cow standing, grazing or head up | 7 boxes, 70 triangles | 4 boxes, 40 |
 * | A cow lying | 5 boxes, 50 | 2 boxes, 20 |
 * | A sheep standing | 6 boxes, 60 | 4 boxes, 40 |
 * | A sheep lying | 2 boxes, 20 | 2 boxes, 20 |
 * | A round bale | an eight-sided prism, 28 | the same |
 *
 * A box is drawn without its floor, which nothing sees: ten triangles.
 * `realistic-budget.ts` §`REALISTIC_TRIANGLES`' `animal`, `animal-far` and
 * `bale` are the ceilings these are held to.
 */

import type { FieldLifeKind, FieldLifeLevel, FieldLifePose } from './field-life';

/** One shape, in its own frame: its triangles, unindexed, each corner with its own colour. */
export interface FieldLifeShape {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** Each corner's colour, packed sRGB. */
  readonly colour: Uint32Array;
  readonly triangles: number;
}

/** The coats a cow wears: black, brown, red and cream, packed sRGB. */
export const COW_COATS: readonly number[] = [0x1f1c1a, 0x5e3a22, 0x8a4b2c, 0xc8b08a];

/** A sheep's fleece, and its face and legs, packed sRGB. */
export const SHEEP_COLOURS = { fleece: 0xded7c4, face: 0x2b2723 } as const;

/** A round bale's straw: its rolled side, and its ends, packed sRGB. */
export const BALE_COLOURS = { side: 0xbf9d52, end: 0xd4b872 } as const;

/** A bale's radius and its half-width along its axis, metres: 1.5 m across, 1.2 m wide. */
export const BALE_SIZE = { radius: 0.75, halfWidth: 0.6 } as const;

/** A box: its middle, its full size along each axis, and its colour. */
interface Box {
  readonly at: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly colour: number;
}

/** Corners being written. */
interface Writer {
  readonly position: number[];
  readonly normal: number[];
  readonly colour: number[];
}

type Vec = readonly [number, number, number];

/** One triangle, wound counter-clockwise seen from `normal`'s side. */
function triangle(into: Writer, a: Vec, b: Vec, c: Vec, normal: Vec, colour: number): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const facing =
    (uy * vz - uz * vy) * normal[0] +
    (uz * vx - ux * vz) * normal[1] +
    (ux * vy - uy * vx) * normal[2];
  const corners = facing >= 0 ? [a, b, c] : [a, c, b];
  for (const corner of corners) {
    into.position.push(corner[0], corner[1], corner[2]);
    into.normal.push(normal[0], normal[1], normal[2]);
    into.colour.push(colour);
  }
}

/** A quad from four corners in order round it. */
function quad(into: Writer, a: Vec, b: Vec, c: Vec, d: Vec, normal: Vec, colour: number): void {
  triangle(into, a, b, c, normal, colour);
  triangle(into, a, c, d, normal, colour);
}

/** A box's five faces that are ever seen: every one but its floor. */
function box(into: Writer, { at, size, colour }: Box): void {
  const [x, y, z] = at;
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  const x0 = x - hx;
  const x1 = x + hx;
  const y0 = y - hy;
  const y1 = y + hy;
  const z0 = z - hz;
  const z1 = z + hz;
  quad(into, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], colour);
  quad(into, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], colour);
  quad(into, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], colour);
  quad(into, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], colour);
  quad(into, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], colour);
}

/** A cow's boxes. Grazing, its head is down at the grass in front of it. */
function cowBoxes(pose: FieldLifePose, level: FieldLifeLevel, coat: number): readonly Box[] {
  if (pose === 'lying') {
    const body: Box = { at: [0, 0.35, 0], size: [0.85, 0.7, 1.6], colour: coat };
    const head: Box = { at: [0, 0.85, 1.02], size: [0.3, 0.32, 0.48], colour: coat };
    if (level === 'far') return [body, head];
    return [
      body,
      { at: [0, 0.65, 0.82], size: [0.32, 0.36, 0.36], colour: coat },
      head,
      // The folded legs either side.
      { at: [0.48, 0.1, 0.3], size: [0.2, 0.2, 0.6], colour: coat },
      { at: [-0.48, 0.1, -0.2], size: [0.2, 0.2, 0.6], colour: coat },
    ];
  }
  const grazing = pose === 'grazing';
  const body: Box = { at: [0, 1.05, 0], size: [0.8, 0.7, 1.7], colour: coat };
  const head: Box = grazing
    ? { at: [0, 0.36, 1.18], size: [0.3, 0.32, 0.5], colour: coat }
    : { at: [0, 1.46, 1.2], size: [0.3, 0.34, 0.5], colour: coat };
  if (level === 'far') {
    return [
      body,
      // Each pair of legs as one slab.
      { at: [0, 0.36, 0.62], size: [0.7, 0.72, 0.16], colour: coat },
      { at: [0, 0.36, -0.62], size: [0.7, 0.72, 0.16], colour: coat },
      head,
    ];
  }
  const legs: Box[] = [];
  for (const x of [0.27, -0.27]) {
    for (const z of [0.62, -0.62]) {
      legs.push({ at: [x, 0.36, z], size: [0.16, 0.72, 0.16], colour: coat });
    }
  }
  return [
    body,
    ...legs,
    grazing
      ? { at: [0, 0.82, 0.98], size: [0.34, 0.46, 0.42], colour: coat }
      : { at: [0, 1.3, 0.95], size: [0.34, 0.45, 0.4], colour: coat },
    head,
  ];
}

/** A sheep's boxes: a fleece on four dark legs, and a dark face. */
function sheepBoxes(pose: FieldLifePose, level: FieldLifeLevel): readonly Box[] {
  const { fleece, face } = SHEEP_COLOURS;
  if (pose === 'lying') {
    return [
      { at: [0, 0.25, 0], size: [0.62, 0.5, 0.9], colour: fleece },
      { at: [0, 0.5, 0.52], size: [0.2, 0.24, 0.3], colour: face },
    ];
  }
  const body: Box = { at: [0, 0.62, 0], size: [0.6, 0.5, 0.95], colour: fleece };
  const head: Box =
    pose === 'grazing'
      ? { at: [0, 0.3, 0.6], size: [0.2, 0.24, 0.32], colour: face }
      : { at: [0, 0.88, 0.58], size: [0.2, 0.26, 0.3], colour: face };
  if (level === 'far') {
    return [
      body,
      { at: [0, 0.2, 0.32], size: [0.45, 0.4, 0.09], colour: face },
      { at: [0, 0.2, -0.32], size: [0.45, 0.4, 0.09], colour: face },
      head,
    ];
  }
  const legs: Box[] = [];
  for (const x of [0.18, -0.18]) {
    for (const z of [0.32, -0.32]) {
      legs.push({ at: [x, 0.2, z], size: [0.09, 0.4, 0.09], colour: face });
    }
  }
  return [body, ...legs, head];
}

/** How many sides a bale's prism has: **8**. */
const BALE_SIDES = 8;

/**
 * A round bale lying on its rolled side, its axis along `x`: eight sides and
 * its two ends, with a flat side down on the ground.
 */
function bale(into: Writer): void {
  const { radius, halfWidth } = BALE_SIZE;
  // Corners at a half-step, so two of them are lowest and a side lies flat.
  const lowest = Math.sin(((BALE_SIDES / 2 + BALE_SIDES / 4 - 0.5) * 2 * Math.PI) / BALE_SIDES);
  const middle = -lowest * radius;
  const corner = (k: number): readonly [number, number] => {
    const turn = ((k + 0.5) * 2 * Math.PI) / BALE_SIDES;
    return [middle + radius * Math.sin(turn), radius * Math.cos(turn)];
  };
  for (let k = 0; k < BALE_SIDES; k += 1) {
    const [ya, za] = corner(k);
    const [yb, zb] = corner(k + 1);
    const turn = ((k + 1) * 2 * Math.PI) / BALE_SIDES;
    quad(
      into,
      [-halfWidth, ya, za],
      [halfWidth, ya, za],
      [halfWidth, yb, zb],
      [-halfWidth, yb, zb],
      [0, Math.sin(turn), Math.cos(turn)],
      BALE_COLOURS.side,
    );
  }
  for (const end of [1, -1] as const) {
    const [y0, z0] = corner(0);
    for (let k = 1; k + 1 < BALE_SIDES; k += 1) {
      const [ya, za] = corner(k);
      const [yb, zb] = corner(k + 1);
      triangle(
        into,
        [end * halfWidth, y0, z0],
        [end * halfWidth, ya, za],
        [end * halfWidth, yb, zb],
        [end, 0, 0],
        BALE_COLOURS.end,
      );
    }
  }
}

/** Each shape built, by its key. */
const built = new Map<string, FieldLifeShape>();

/**
 * The shape a piece of `kind` in `pose` is drawn as at `level`, in coat
 * `coat` of {@link COW_COATS} (read for a cow only). Built once a key and kept.
 */
export function fieldLifeShape(
  kind: FieldLifeKind,
  pose: FieldLifePose,
  level: FieldLifeLevel,
  coat: number,
): FieldLifeShape {
  const key = `${kind}|${pose}|${level}|${String(kind === 'cow' ? coat : 0)}`;
  let shape = built.get(key);
  if (shape === undefined) {
    const into: Writer = { position: [], normal: [], colour: [] };
    if (kind === 'bale') {
      bale(into);
    } else {
      const boxes =
        kind === 'cow'
          ? cowBoxes(pose, level, COW_COATS[coat % COW_COATS.length] as number)
          : sheepBoxes(pose, level);
      for (const each of boxes) box(into, each);
    }
    shape = {
      position: Float32Array.from(into.position),
      normal: Float32Array.from(into.normal),
      colour: Uint32Array.from(into.colour),
      triangles: into.colour.length / 3,
    };
    built.set(key, shape);
  }
  return shape;
}
