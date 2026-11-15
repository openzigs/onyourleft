// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic rider's glasses, helmet, straps and shoes — #2504.
 *
 * Blender does not run in CI, so the committed `rider.glb` is read back here
 * and judged as three draws it: the helmet's material is single-sided
 * (`three-renderer.ts` §`RealisticRiderBelt`), so a face turned away from the
 * camera is not drawn at all. Each part is found by its colour
 * (`blender/process_rider.py` step 5) and never by the numbers that drew it:
 *
 * - each LENS turns its faces to a viewer in front, at three-quarter and at
 *   the side, so it is drawn there and the eyes behind it are hidden — it was
 *   wound towards the face and culled from the front;
 * - no line of sight from above the helmet's rim reaches the head without
 *   first meeting a face of the helmet turned towards it — a vent was a hole
 *   and the scalp showed through;
 * - every STRAP and glasses-ARM vertex clear of the shell and the lenses lies
 *   on the skin — they were straight bars that floated beside the jaw;
 * - each FOOT, cut across near its front, is one closed section and not one a
 *   toe — it was a bare foot, five toes painted dark.
 *
 * And the owner's ruling of 2026-11-12, from screenshots:
 *
 * - no point of the SCALP under the helmet is seen from any direction above —
 *   the top-centre vent's floor lay under the crown, and the scalp came up
 *   through it, a speck seen from the front;
 * - the helmet's BACK RIM covers the nape: it stopped at the skull's base;
 * - the LENS is a smoked grey, faintly blue — it was a blue-black that read as
 *   flat black.
 *
 * glTF's frame: +X the rider's left, +Y up, +Z the way they face. Metres.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readGlb, type GlbFile } from '../../src/game/model-bytes-testing';
import { REALISTIC_RIDER } from '../../src/game/realistic-assets';
import { accessorValues, type AccessorJson } from '../../src/game/realistic-bytes-testing';

const at = (file: string): string =>
  fileURLToPath(new URL(`../../public/realistic/${file}`, import.meta.url));

type Vec3 = readonly [number, number, number];
type Triangle = readonly [number, number, number];

interface Document {
  readonly accessors: readonly AccessorJson[];
  readonly bufferViews: readonly { readonly byteOffset?: number; readonly byteStride?: number }[];
  readonly meshes: readonly {
    readonly primitives: readonly {
      readonly attributes: Readonly<Record<string, number>>;
      readonly indices?: number;
    }[];
  }[];
  readonly nodes: readonly { readonly name?: string; readonly mesh?: number }[];
  readonly skins: readonly {
    readonly joints: readonly number[];
    readonly inverseBindMatrices: number;
  }[];
}

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaled = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));

/** One named mesh of the file: its vertices, triangles and the accessor reader. */
interface Mesh {
  readonly positions: readonly Vec3[];
  readonly triangles: readonly Triangle[];
  readonly attribute: (name: string) => { readonly values: Float64Array; readonly size: number };
}

function meshOf(file: GlbFile, name: string): Mesh {
  const document = file.json as unknown as Document;
  const node = document.nodes.find((each) => each.name === name);
  const primitive = document.meshes[node?.mesh ?? -1]?.primitives[0];
  if (primitive?.indices === undefined) throw new Error(`the rider holds no ${name} mesh`);
  const read = (index: number) => accessorValues(document, file.binary, index);
  const attribute = (key: string) => {
    const index = primitive.attributes[key];
    if (index === undefined) throw new Error(`the ${name} mesh has no ${key}`);
    return read(index);
  };
  const flat = attribute('POSITION').values;
  const positions: Vec3[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    positions.push([flat[i] as number, flat[i + 1] as number, flat[i + 2] as number]);
  }
  const indices = read(primitive.indices).values;
  const triangles: Triangle[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    triangles.push([indices[i] as number, indices[i + 1] as number, indices[i + 2] as number]);
  }
  return { positions, triangles, attribute };
}

/** A triangle's corners, and twice its area along the way its front faces. */
const corners = (mesh: Mesh, [a, b, c]: Triangle): readonly [Vec3, Vec3, Vec3] => [
  mesh.positions[a] as Vec3,
  mesh.positions[b] as Vec3,
  mesh.positions[c] as Vec3,
];
const facing = (mesh: Mesh, triangle: Triangle): Vec3 => {
  const [a, b, c] = corners(mesh, triangle);
  return cross(minus(b, a), minus(c, a));
};

/** The closest point of a triangle to `p` — Ericson, Real-Time Collision Detection §5.1.5. */
function distanceToTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = minus(b, a);
  const ac = minus(c, a);
  const ap = minus(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return length(ap);
  const bp = minus(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return length(minus(ap, scaled(ab, d1 / (d1 - d3))));
  const cp = minus(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return length(minus(ap, scaled(ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return length(minus(bp, scaled(minus(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)))));
  }
  const denominator = 1 / (va + vb + vc);
  const closest = plus(a, plus(scaled(ab, vb * denominator), scaled(ac, vc * denominator)));
  return length(minus(p, closest));
}

const distanceToAny = (p: Vec3, mesh: Mesh, triangles: readonly Triangle[]): number =>
  triangles.reduce((best, triangle) => {
    const [a, b, c] = corners(mesh, triangle);
    return Math.min(best, distanceToTriangle(p, a, b, c));
  }, Infinity);

/** How far along `direction` from `origin` the ray meets the triangle, or nothing. Möller–Trumbore. */
function rayHit(origin: Vec3, direction: Vec3, [a, b, c]: readonly [Vec3, Vec3, Vec3]) {
  const ab = minus(b, a);
  const ac = minus(c, a);
  const p = cross(direction, ac);
  const determinant = dot(ab, p);
  if (Math.abs(determinant) < 1e-14) return undefined;
  const t0 = minus(origin, a);
  const u = dot(t0, p) / determinant;
  if (u < 0 || u > 1) return undefined;
  const q = cross(t0, ab);
  const v = dot(direction, q) / determinant;
  if (v < 0 || u + v > 1) return undefined;
  const distance = dot(ac, q) / determinant;
  return distance > 0 ? distance : undefined;
}

const rider = readGlb(at(REALISTIC_RIDER));
const helmet = meshOf(rider, 'helmet');
const body = meshOf(rider, 'rider');

// The helmet's parts, by the colour `process_rider.py` paints each (linear).
const colourFlat = helmet.attribute('COLOR_0');
const colourOf = (vertex: number): Vec3 => {
  const at = vertex * colourFlat.size;
  const values = colourFlat.values;
  return [values[at] as number, values[at + 1] as number, values[at + 2] as number];
};
/** A smoked lens: a dark grey, its blue over its red. A strap's, a frame's and a vent's lead by a tenth. */
const isLens = ([r, , b]: Vec3): boolean => b < 0.2 && b > 1.3 * r;
/** A strap or a glasses frame: near black, and grey. */
const isStrap = (colour: Vec3): boolean => Math.max(...colour) < 0.05 && !isLens(colour);
/** The shell, and a vent's floor and walls — every part of the helmet itself. */
const isShell = (colour: Vec3): boolean => Math.min(...colour) > 0.05 && !isLens(colour);
const all = (triangle: Triangle, test: (colour: Vec3) => boolean): boolean =>
  triangle.every((vertex) => test(colourOf(vertex)));

const lensTriangles = helmet.triangles.filter((triangle) => all(triangle, isLens));
const shellTriangles = helmet.triangles.filter((triangle) => all(triangle, isShell));
const shellVertices = helmet.positions.filter((_, vertex) => isShell(colourOf(vertex)));
const span = (axis: 0 | 1 | 2) => {
  const values = shellVertices.map((p) => p[axis]);
  return [Math.min(...values), Math.max(...values)] as const;
};
// Inside the shell, at the height of its widest ring: its crown less its half-width.
const [left, right] = span(0);
const [, crown] = span(1);
const [back, front] = span(2);
const inside: Vec3 = [(left + right) / 2, crown - (right - left) / 2, (back + front) / 2];

describe('the realistic rider’s glasses, helmet, straps and shoes — #2504', () => {
  it('turns each lens to a viewer in front, at three-quarter and at the side', () => {
    const square = Math.SQRT1_2;
    for (const side of [1, -1] as const) {
      const lens = lensTriangles.filter((triangle) => {
        const [a, b, c] = corners(helmet, triangle);
        return (a[0] + b[0] + c[0]) * side > 0;
      });
      // Non-vacuity: a lens each side, every one of its faces wound forward.
      expect(lens.length).toBeGreaterThan(0);
      for (const triangle of lens) expect(facing(helmet, triangle)[2]).toBeGreaterThan(0);
      // The area a viewer sees of its faces turned towards them, in square
      // centimetres — a lens is about 5 cm by 3 cm, swept back at its outer edge.
      const seen = (view: Vec3): number =>
        (lens.reduce((sum, triangle) => sum + Math.max(0, dot(facing(helmet, triangle), view)), 0) /
          2) *
        1e4;
      expect(seen([0, 0, 1])).toBeGreaterThan(10);
      expect(seen([side * square, 0, square])).toBeGreaterThan(8);
      expect(seen([side, 0, 0])).toBeGreaterThan(2);
    }
  });

  it('shows no skin through the helmet: every line of sight from above meets a face turned to it', () => {
    // From every direction at least 20° above the widest ring, every 2°,
    // towards a point inside the shell: the first thing met must be a face of
    // the helmet's own turned towards the viewer. An open vent lets the line
    // through to the head, or to the far side's inside, which is culled.
    let lines = 0;
    for (let elevation = 20; elevation <= 90; elevation += 2) {
      for (let azimuth = 0; azimuth < (elevation === 90 ? 1 : 360); azimuth += 2) {
        const up = (elevation * Math.PI) / 180;
        const round = (azimuth * Math.PI) / 180;
        const out: Vec3 = [
          Math.cos(up) * Math.sin(round),
          Math.sin(up),
          Math.cos(up) * Math.cos(round),
        ];
        const origin = plus(inside, scaled(out, 0.4));
        const direction = scaled(out, -1);
        const hits = helmet.triangles.flatMap((triangle) => {
          const distance = rayHit(origin, direction, corners(helmet, triangle));
          return distance !== undefined && distance < 0.4 ? [{ distance, triangle }] : [];
        });
        const where = `from elevation ${String(elevation)}°, azimuth ${String(azimuth)}°`;
        expect(hits.length, where).toBeGreaterThan(0);
        // The first faces met — within a micrometre, as a line through an
        // edge meets both faces on it, a vent's wall seen edge-on among them.
        const first = Math.min(...hits.map((hit) => hit.distance));
        const met = hits.filter((hit) => hit.distance < first + 1e-6);
        expect(
          met.some((hit) => dot(facing(helmet, hit.triangle), out) > 0),
          where,
        ).toBe(true);
        lines += 1;
      }
    }
    expect(lines).toBeGreaterThan(6_000);
  });

  it('shows no scalp through any vent: no point of it under the helmet is seen from above', () => {
    // The rim: the edges of the shell's own faces that no other of them shares.
    const key = (p: Vec3): string => p.map((value) => Math.round(value * 1e5)).join(',');
    const edges = new Map<string, { count: number; height: number }>();
    for (const triangle of shellTriangles) {
      triangle.forEach((vertex, at) => {
        const a = helmet.positions[vertex] as Vec3;
        const b = helmet.positions[triangle[(at + 1) % 3] as number] as Vec3;
        const edge = [key(a), key(b)].sort().join('|');
        const seen = edges.get(edge) ?? { count: 0, height: Math.max(a[1], b[1]) };
        edges.set(edge, { ...seen, count: seen.count + 1 });
      });
    }
    const rim = [...edges.values()].filter((edge) => edge.count === 1);
    expect(rim.length).toBeGreaterThan(10);
    // Every point of the skin higher than the rim's highest point: the scalp
    // the shell is over, which a line of sight from above cannot reach but
    // through the shell — or through a vent.
    const rimTop = Math.max(...rim.map((edge) => edge.height));
    const scalp = body.positions.filter((p) => p[1] > rimTop);
    expect(scalp.length).toBeGreaterThan(50);
    // Every line here climbs (20° and up), so it can only meet a face with a
    // corner above where it starts: a face wholly below the lowest scalp point
    // (the eyes, the glasses, the lower straps) can hide none of it, and is
    // left out so the case stays cheap (owner ruling #1688).
    const lowest = Math.min(...scalp.map((p) => p[1]));
    const drawn = helmet.triangles
      .map((triangle) => ({
        corners: corners(helmet, triangle),
        facing: facing(helmet, triangle),
      }))
      .filter((face) => Math.max(...face.corners.map((corner) => corner[1])) > lowest);
    // A point is hidden from a viewer far off along `out` when the line to
    // them meets a face of the helmet turned towards them: the material is
    // single-sided, so a face turned away is not drawn and hides nothing.
    const seen: string[] = [];
    // The face that last hid each point, tried first: the next viewer round
    // is a few degrees away and is nearly always hidden by the same face.
    const lastHid: (typeof drawn)[number][] = [];
    for (let elevation = 20; elevation <= 90; elevation += 5) {
      for (let azimuth = 0; azimuth < (elevation === 90 ? 1 : 360); azimuth += 5) {
        const up = (elevation * Math.PI) / 180;
        const round = (azimuth * Math.PI) / 180;
        const out: Vec3 = [
          Math.cos(up) * Math.sin(round),
          Math.sin(up),
          Math.cos(up) * Math.cos(round),
        ];
        // The faces turned towards this viewer, found once for every point.
        const towards = drawn.filter((face) => dot(face.facing, out) > 0);
        for (const [at, point] of scalp.entries()) {
          const hides = (face: (typeof drawn)[number]): boolean =>
            dot(face.facing, out) > 0 && rayHit(point, out, face.corners) !== undefined;
          const last = lastHid[at];
          const hider = last !== undefined && hides(last) ? last : towards.find(hides);
          if (hider !== undefined) lastHid[at] = hider;
          else {
            seen.push(
              `${point.map((value) => value.toFixed(3)).join(', ')} from ${String(elevation)}°, ${String(azimuth)}°`,
            );
          }
        }
      }
    }
    expect(seen.slice(0, 5)).toEqual([]);
  });

  it('brings the helmet’s back rim down over the nape, clear of the neck', () => {
    // Where the skull meets the neck: the head bone's own origin, its inverse
    // bind matrix's translation carried back out.
    const document = rider.json as unknown as Document;
    const skin = document.skins[0];
    const at = (skin?.joints ?? []).findIndex((node) => document.nodes[node]?.name === 'head');
    expect(at).toBeGreaterThanOrEqual(0);
    const m = accessorValues(document, rider.binary, skin?.inverseBindMatrices ?? -1).values.slice(
      at * 16,
      at * 16 + 16,
    );
    const column = (c: number): Vec3 => [
      m[c * 4] as number,
      m[c * 4 + 1] as number,
      m[c * 4 + 2] as number,
    ];
    const translation = column(3);
    const skullBase: Vec3 = [
      -dot(column(0), translation),
      -dot(column(1), translation),
      -dot(column(2), translation),
    ];
    // The rim behind the head, within 3 cm either side of the middle.
    const behind = shellVertices.filter((p) => p[2] < skullBase[2] && Math.abs(p[0]) < 0.03);
    expect(behind.length).toBeGreaterThan(5);
    const lowest = Math.min(...behind.map((p) => p[1]));
    // A road helmet's tail comes down past the skull's base onto the top of
    // the neck: at least 2 cm below it, and no more than 6 cm — not onto the
    // shoulders.
    expect(skullBase[1] - lowest).toBeGreaterThan(0.02);
    expect(skullBase[1] - lowest).toBeLessThan(0.06);
    // And it stands off the neck rather than cutting into it.
    const neck = body.triangles.filter((triangle) =>
      triangle.some((vertex) => {
        const p = body.positions[vertex] as Vec3;
        return p[2] < skullBase[2] && Math.abs(p[1] - lowest) < 0.05;
      }),
    );
    expect(neck.length).toBeGreaterThan(50);
    const low = behind.filter((p) => p[1] < lowest + 0.01);
    for (const point of low) expect(distanceToAny(point, body, neck)).toBeGreaterThan(0.005);
  });

  it('smokes each lens: a dark grey, its blue a little over its red, and not black', () => {
    const srgb = (linear: number): number =>
      linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    const colours = new Set(
      lensTriangles.flat().map((vertex) =>
        colourOf(vertex)
          .map((value) => srgb(value).toFixed(3))
          .join(','),
      ),
    );
    // Non-vacuity, and one lens colour.
    expect([...colours]).toHaveLength(1);
    const [r, g, b] = [...colours][0]!.split(',').map(Number) as unknown as Vec3;
    // As the screen shows it, sRGB: every channel between 0.25 and 0.42 — a
    // smoked grey. 0.10 in red read as flat black, and so did 0.18 once the
    // renderer had lit and tone-mapped it under the helmet's brim; past 0.42
    // a pale lens would read as a mask.
    for (const channel of [r, g, b]) {
      expect(channel).toBeGreaterThan(0.25);
      expect(channel).toBeLessThan(0.42);
    }
    // Blue-led, faintly: blue over red by 10 % to 60 %, green between them.
    expect(b / r).toBeGreaterThan(1.1);
    expect(b / r).toBeLessThan(1.6);
    expect(g).toBeGreaterThanOrEqual(r);
    expect(g).toBeLessThanOrEqual(b);
  });

  it('lays the straps and the glasses’ arms on the head, with nothing floating beside it', () => {
    // The skin round the head, in the rest pose the helmet is built in.
    const head = body.triangles.filter((triangle) =>
      triangle.some((vertex) => length(minus(body.positions[vertex] as Vec3, inside)) < 0.2),
    );
    expect(head.length).toBeGreaterThan(500);
    let checked = 0;
    let worst = 0;
    helmet.positions.forEach((point, vertex) => {
      if (!isStrap(colourOf(vertex))) return;
      // Where a strap leaves the rim, or an arm leaves its lens, it is held
      // by them and not by the head.
      const held = 0.006;
      if (distanceToAny(point, helmet, shellTriangles) < held) return;
      if (distanceToAny(point, helmet, lensTriangles) < held) return;
      worst = Math.max(worst, distanceToAny(point, body, head));
      checked += 1;
    });
    expect(checked).toBeGreaterThan(100);
    // Each lies within 6 mm of the skin: the strap's own stand-off, half its
    // width round a curve, and the decimated skin's departure from the one
    // the strap was laid on.
    expect(worst).toBeLessThan(0.006);
  });

  it('wears shoes: the top of each foot across its toes is one smooth arch, with no toe standing up', () => {
    const document = rider.json as unknown as Document;
    const names = (document.skins[0]?.joints ?? []).map((node) => document.nodes[node]?.name);
    const joints = body.attribute('JOINTS_0');
    const weights = body.attribute('WEIGHTS_0');
    const dominant = body.positions.map((_, vertex) => {
      let best = 0;
      for (let slot = 1; slot < 4; slot += 1) {
        const weight = weights.values[vertex * 4 + slot] as number;
        if (weight > (weights.values[vertex * 4 + best] as number)) best = slot;
      }
      return names[joints.values[vertex * 4 + best] as number];
    });
    const CELL = 0.0005;
    for (const foot of ['foot.L', 'foot.R']) {
      const triangles = body.triangles.filter((triangle) =>
        triangle.every((vertex) => dominant[vertex] === foot),
      );
      expect(triangles.length).toBeGreaterThan(100);
      const tip = Math.max(
        ...triangles.flat().map((vertex) => (body.positions[vertex] as Vec3)[2]),
      );
      // The foot seen from above: the height of its top over every cell of a
      // half-millimetre grid, each triangle filled by its own plane.
      const top = new Map<string, number>();
      for (const triangle of triangles) {
        const [a, b, c] = corners(body, triangle);
        const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
        if (Math.abs(area) < 1e-12) continue;
        const columns = [a, b, c].map((p) => p[0] / CELL);
        const rows = [a, b, c].map((p) => p[2] / CELL);
        for (
          let column = Math.ceil(Math.min(...columns));
          column <= Math.max(...columns);
          column += 1
        ) {
          for (let row = Math.ceil(Math.min(...rows)); row <= Math.max(...rows); row += 1) {
            const x = column * CELL;
            const z = row * CELL;
            const u = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
            const v = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
            const w = 1 - u - v;
            if (u < 0 || v < 0 || w < 0) continue;
            const height = u * a[1] + v * b[1] + w * c[1];
            const key = `${String(column)},${String(row)}`;
            top.set(key, Math.max(top.get(key) ?? -Infinity, height));
          }
        }
      }
      // Across the toes, every 2 mm from 4 to 24 mm behind the tip: how far
      // the top dips below the arch over it (its upper hull). Between two
      // bare toes it dips millimetres; over a shoe's toe box, not at all.
      let deepest = 0;
      let profiles = 0;
      for (let behind = 0.004; behind <= 0.0241; behind += 0.002) {
        const row = Math.round((tip - behind) / CELL);
        const profile = [...top.entries()]
          .map(([key, height]) => [key.split(',').map(Number), height] as const)
          .filter(([[, r]]) => r === row)
          .map(([[column], height]) => [(column as number) * CELL, height] as const)
          .sort((p, q) => p[0] - q[0]);
        if (profile.length < 20) continue;
        profiles += 1;
        // The upper hull, by Andrew's monotone chain.
        const hull: (readonly [number, number])[] = [];
        for (const point of profile) {
          while (hull.length >= 2) {
            const [o, a] = [hull[hull.length - 2], hull[hull.length - 1]] as const;
            if ((a![0] - o![0]) * (point[1] - o![1]) - (a![1] - o![1]) * (point[0] - o![0]) >= 0)
              hull.pop();
            else break;
          }
          hull.push(point);
        }
        for (const [x, height] of profile) {
          const after = hull.findIndex((point) => point[0] >= x);
          const right = hull[after] as readonly [number, number];
          const left = hull[Math.max(0, after - 1)] as readonly [number, number];
          const over =
            right[0] === left[0]
              ? right[1]
              : left[1] + ((right[1] - left[1]) * (x - left[0])) / (right[0] - left[0]);
          deepest = Math.max(deepest, over - height);
        }
      }
      expect(profiles, foot).toBeGreaterThan(8);
      // A bare foot's toes stand 11 mm over the gaps between them; the shoe's
      // creases where the gaps were closed, a few millimetres at most.
      expect(deepest, foot).toBeLessThan(0.004);
    }
  });
});
