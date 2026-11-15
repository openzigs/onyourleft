// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic rider's eyes — #2495.
 *
 * Blender does not run in CI, so the committed `rider.glb` is read back here
 * and the eyes `blender/process_rider.py` puts in it are found WITHOUT the
 * numbers that drew them: a ball is recognised from its own vertices (each one
 * its normal times the radius from one centre), and its parts from their
 * colours. What is held is what a rider would see: two eyes, mirror images, a
 * human eye's size and spacing, looking forward, a dark pupil in front, a
 * brown iris round it and a white beyond, every triangle facing out — and
 * their cost: `sources.ts` §`RIDER_EYE_TRIANGLES`, inside the rider's own
 * triangles, with no texture and no draw call added.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readGlb, type GlbFile } from '../../src/game/model-bytes-testing';
import { REALISTIC_RIDER, REALISTIC_RIDER_MAP_NAMES } from '../../src/game/realistic-assets';
import { REALISTIC_TRIANGLES } from '../../src/game/realistic-budget';
import { modelFacts } from '../../src/game/realistic-bytes-testing';

import { RIDER_EYE_TRIANGLES } from './sources';

const at = (file: string): string =>
  fileURLToPath(new URL(`../../public/realistic/${file}`, import.meta.url));

type Vec3 = readonly [number, number, number];

interface Document {
  readonly accessors: readonly {
    readonly bufferView: number;
    readonly byteOffset?: number;
    readonly componentType: number;
    readonly count: number;
    readonly type: string;
    readonly normalized?: boolean;
  }[];
  readonly bufferViews: readonly { readonly byteOffset?: number; readonly byteStride?: number }[];
  readonly meshes: readonly {
    readonly primitives: readonly {
      readonly attributes: Readonly<Record<string, number>>;
      readonly indices?: number;
    }[];
  }[];
  readonly nodes: readonly { readonly name?: string; readonly mesh?: number }[];
}

const WIDTH: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Readonly<Record<number, number>> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

/** One accessor's values, flattened; a normalised integer read as 0 to 1. */
function values(file: GlbFile, index: number): number[] {
  const document = file.json as unknown as Document;
  const described = document.accessors[index];
  if (described === undefined) throw new Error(`no accessor ${String(index)}`);
  const width = WIDTH[described.type] as number;
  const size = BYTES[described.componentType] as number;
  const view = document.bufferViews[described.bufferView];
  const stride = view?.byteStride ?? width * size;
  const base = (view?.byteOffset ?? 0) + (described.byteOffset ?? 0);
  const data = new DataView(file.binary.buffer, file.binary.byteOffset, file.binary.byteLength);
  const out: number[] = [];
  for (let element = 0; element < described.count; element += 1) {
    for (let component = 0; component < width; component += 1) {
      const offset = base + element * stride + component * size;
      const raw =
        described.componentType === 5126
          ? data.getFloat32(offset, true)
          : described.componentType === 5125
            ? data.getUint32(offset, true)
            : described.componentType === 5123
              ? data.getUint16(offset, true)
              : data.getUint8(offset);
      out.push(
        described.normalized === true && described.componentType !== 5126
          ? raw / (2 ** (size * 8) - 1)
          : raw,
      );
    }
  }
  return out;
}

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
const scaled = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mean = (points: readonly Vec3[]): Vec3 =>
  scaled(
    points.reduce<Vec3>(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
      [0, 0, 0],
    ),
    1 / points.length,
  );

/** The helmet's one mesh: every vertex, its normal and colour, and its triangles. */
interface HelmetMesh {
  readonly positions: readonly Vec3[];
  readonly normals: readonly Vec3[];
  readonly colours: readonly Vec3[];
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly primitives: number;
  readonly textured: boolean;
}

function helmetOf(file: GlbFile): HelmetMesh {
  const document = file.json as unknown as Document;
  const node = document.nodes.find((each) => each.name === 'helmet');
  const mesh = document.meshes[node?.mesh ?? -1];
  if (mesh === undefined) throw new Error('the rider holds no helmet mesh');
  const primitive = mesh.primitives[0];
  if (primitive === undefined) throw new Error('the helmet has no primitive');
  const triples = (index: number | undefined, width: number): Vec3[] => {
    if (index === undefined) throw new Error('the helmet lacks an attribute');
    const flat = values(file, index);
    const out: Vec3[] = [];
    for (let at = 0; at < flat.length; at += width) {
      out.push([flat[at] as number, flat[at + 1] as number, flat[at + 2] as number]);
    }
    return out;
  };
  const indices = values(file, primitive.indices as number);
  const triangles: [number, number, number][] = [];
  for (let at = 0; at < indices.length; at += 3) {
    triangles.push([indices[at] as number, indices[at + 1] as number, indices[at + 2] as number]);
  }
  return {
    positions: triples(primitive.attributes['POSITION'], 3),
    normals: triples(primitive.attributes['NORMAL'], 3),
    colours: triples(primitive.attributes['COLOR_0'], 4),
    triangles,
    primitives: mesh.primitives.length,
    textured: primitive.attributes['TEXCOORD_0'] !== undefined,
  };
}

/** A brown: red leading green leading blue, and not a grey. */
const isIris = (colour: Vec3): boolean =>
  colour[0] > 0.02 && colour[0] > colour[1] && colour[1] > colour[2] && colour[0] > 2 * colour[2];
const isPupil = (colour: Vec3): boolean => Math.max(...colour) < 0.02;
/** A pale colour, nearly grey — the white of an eye. */
const isWhite = (colour: Vec3): boolean =>
  Math.min(...colour) > 0.2 && Math.max(...colour) - Math.min(...colour) < 0.15;

interface Eye {
  readonly centre: Vec3;
  readonly radius: number;
  /** Which way it looks: the mean of its iris's normals, a ring round the gaze. */
  readonly gaze: Vec3;
  /** The helmet's vertices on this ball, normal out from its centre. */
  readonly vertices: readonly number[];
}

/**
 * The ball an iris's vertices lie on: each is `centre + radius × normal`, so
 * the radius is the least-squares fit of their spread against their normals'.
 */
function eyeOf(helmet: HelmetMesh, iris: readonly number[]): Eye {
  const points = iris.map((index) => helmet.positions[index] as Vec3);
  const normals = iris.map((index) => helmet.normals[index] as Vec3);
  const pointMean = mean(points);
  const normalMean = mean(normals);
  let across = 0;
  let spread = 0;
  for (let at = 0; at < points.length; at += 1) {
    const p = minus(points[at] as Vec3, pointMean);
    const n = minus(normals[at] as Vec3, normalMean);
    across += dot(p, n);
    spread += dot(n, n);
  }
  const radius = across / spread;
  const centre = minus(pointMean, scaled(normalMean, radius));
  const gaze = scaled(normalMean, 1 / length(normalMean));
  const vertices = helmet.positions.flatMap((position, index) => {
    const out = minus(position, centre);
    const normal = helmet.normals[index] as Vec3;
    return Math.abs(length(out) - radius) < 3e-4 && dot(out, normal) / length(out) > 0.999
      ? [index]
      : [];
  });
  return { centre, radius, gaze, vertices };
}

/** Degrees between the gaze and a vertex of the ball. */
const offGaze = (eye: Eye, helmet: HelmetMesh, index: number): number => {
  const out = minus(helmet.positions[index] as Vec3, eye.centre);
  return (Math.acos(Math.min(1, dot(out, eye.gaze) / length(out))) * 180) / Math.PI;
};

const rider = readGlb(at(REALISTIC_RIDER));
const helmet = helmetOf(rider);
const irisVertices = helmet.colours.flatMap((colour, index) => (isIris(colour) ? [index] : []));
// glTF's frame: +X the rider's left, +Y up, +Z the way they face.
const eyes = [
  eyeOf(
    helmet,
    irisVertices.filter((index) => (helmet.positions[index] as Vec3)[0] > 0),
  ),
  eyeOf(
    helmet,
    irisVertices.filter((index) => (helmet.positions[index] as Vec3)[0] < 0),
  ),
] as const;

describe('the realistic rider’s eyes — #2495', () => {
  it('has two, mirror images, MakeHuman’s eye’s size and a human eye’s spacing apart', () => {
    // Non-vacuity: an iris each side, and every vertex of each eye found.
    for (const eye of eyes) {
      expect(eye.vertices.length).toBeGreaterThan(40);
      // MakeHuman's own eye: a ball of about 15 mm, a little over a human
      // eyeball's 12 mm, because MakeHuman's socket is cut for it.
      expect(eye.radius).toBeGreaterThan(0.012);
      expect(eye.radius).toBeLessThan(0.017);
    }
    const [left, right] = eyes;
    expect(left.centre[0]).toBeCloseTo(-right.centre[0], 3);
    expect(left.centre[1]).toBeCloseTo(right.centre[1], 3);
    expect(left.centre[2]).toBeCloseTo(right.centre[2], 3);
    // An adult's eyes are 54 to 74 mm apart, centre to centre.
    expect(left.centre[0] - right.centre[0]).toBeGreaterThan(0.054);
    expect(left.centre[0] - right.centre[0]).toBeLessThan(0.074);
  });

  it('looks forward, with a dark pupil in front, a brown iris round it and a white beyond', () => {
    for (const eye of eyes) {
      expect(eye.gaze[2]).toBeGreaterThan(0.95);
      const front = eye.vertices.reduce((best, index) =>
        offGaze(eye, helmet, index) < offGaze(eye, helmet, best) ? index : best,
      );
      expect(offGaze(eye, helmet, front)).toBeLessThan(1);
      expect(isPupil(helmet.colours[front] as Vec3)).toBe(true);
      const kinds = { pupil: [] as number[], iris: [] as number[], white: [] as number[] };
      for (const index of eye.vertices) {
        const colour = helmet.colours[index] as Vec3;
        const angle = offGaze(eye, helmet, index);
        if (isPupil(colour)) kinds.pupil.push(angle);
        else if (isIris(colour)) kinds.iris.push(angle);
        else if (isWhite(colour)) kinds.white.push(angle);
        else throw new Error(`an eye's vertex ${String(index)} is neither pupil, iris nor white`);
      }
      // Each band ends on the ring the next begins on, to a hundredth of a degree.
      expect(Math.max(...kinds.pupil)).toBeLessThan(Math.min(...kinds.iris) + 0.01);
      expect(Math.max(...kinds.iris)).toBeLessThan(Math.min(...kinds.white) + 0.01);
      // The pupil a few degrees across, the iris a third of the way round to
      // the side — a human iris is about 12 mm wide on a 24 mm ball.
      expect(Math.max(...kinds.pupil)).toBeLessThan(12);
      expect(Math.max(...kinds.iris)).toBeGreaterThan(20);
      expect(Math.max(...kinds.iris)).toBeLessThan(35);
    }
  });

  it('faces every triangle out of the ball, so a culled back face never hides an eye', () => {
    for (const eye of eyes) {
      const on = new Set(eye.vertices);
      const own = helmet.triangles.filter((triangle) => triangle.every((index) => on.has(index)));
      expect(own.length).toBeGreaterThan(0);
      for (const [a, b, c] of own) {
        const pa = helmet.positions[a] as Vec3;
        const facing = cross(
          minus(helmet.positions[b] as Vec3, pa),
          minus(helmet.positions[c] as Vec3, pa),
        );
        expect(dot(facing, minus(pa, eye.centre))).toBeGreaterThan(0);
      }
    }
  });

  it('costs what it states, inside the rider’s own triangles, with no texture or draw call added', () => {
    const spent = eyes.reduce((sum, eye) => {
      const on = new Set(eye.vertices);
      return sum + helmet.triangles.filter((triangle) => triangle.every((i) => on.has(i))).length;
    }, 0);
    expect(spent).toBe(RIDER_EYE_TRIANGLES);
    expect(modelFacts(at(REALISTIC_RIDER)).triangles).toBeLessThanOrEqual(
      REALISTIC_TRIANGLES.rider,
    );
    // In the helmet's one primitive, untextured: the instanced mesh the
    // helmet already was, and the rider's three maps and no fourth.
    expect(helmet.primitives).toBe(1);
    expect(helmet.textured).toBe(false);
    expect((rider.json as unknown as Document).meshes).toHaveLength(2);
    expect(REALISTIC_RIDER_MAP_NAMES).toHaveLength(3);
  });
});
