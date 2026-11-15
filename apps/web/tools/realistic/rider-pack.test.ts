// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pack's rider, baked — #2485, the bake half of #681.
 *
 * Blender does not run in CI, so the committed LOD and its vertex-animation
 * texture are read back here and held to what they claim: about
 * `RIDER_PACK_TRIANGLES` triangles, one texture column a vertex of the file,
 * and — #681's criterion — **every baked foot on the pedal `bicycle.ts`
 * §`legBones` puts it on, at every phase**, with a VAT shifted by one phase
 * shown to fail the same measure.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CRANK_AXIS_Y,
  CRANK_AXIS_Z,
  CRANK_LENGTH_METRES,
  emptyRiderJoints,
  emptyRiderStance,
  legBones,
  riderJoints,
} from '../../src/game/bicycle';
import { readGlb, type GlbFile } from '../../src/game/model-bytes-testing';
import {
  REALISTIC_RIDER_PACK,
  RIDER_PACK_PHASES,
  RIDER_PACK_TRIANGLES,
} from '../../src/game/realistic-assets';
import { modelFacts } from '../../src/game/realistic-bytes-testing';

import {
  fromHalf,
  packAngle,
  packPose,
  readRiderPackVat,
  RIDER_PACK_HEADER_BYTES,
  riderPackTextureBytes,
  riderPackVatBytes,
  type RiderPackVat,
} from './rider-pack';
import { EXPECTED_REPORTS, OUTPUTS, RIDER_SCRIPT } from './sources';

const at = (file: string): string =>
  fileURLToPath(new URL(`../../public/realistic/${file}`, import.meta.url));

/**
 * How far a baked foot vertex may stray from where a foot held on its pedal
 * would put it: **5 mm**. Two parts, both measured: the leg's own clamp,
 * which leaves the ankle up to 3 mm short of the pedal over the bottom of the
 * stroke (`bicycle.ts` §`legBones`; the run reports 2.93 mm), and the half
 * floats, under a millimetre a coordinate at a rider's size.
 */
const FOOT_TOLERANCE_METRES = 0.005;

/** The pedal a foot is clipped to at a crank angle: the end of `legBones`' shin. Index 0 is `+X`. */
function pedalAt(angle: number, index: 0 | 1): readonly [number, number, number] {
  const shin = legBones(angle)[index * 2 + 1];
  if (shin === undefined) throw new Error('legBones returned no shin');
  const half = shin.length / 2;
  return [shin.x, shin.y + half * Math.cos(shin.pitch), shin.z + half * Math.sin(shin.pitch)];
}

interface SkinnedDocument {
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
    readonly primitives: readonly { readonly attributes: Readonly<Record<string, number>> }[];
  }[];
  readonly nodes: readonly {
    readonly name?: string;
    readonly mesh?: number;
    readonly skin?: number;
  }[];
  readonly skins: readonly { readonly joints: readonly number[] }[];
}

const WIDTH: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Readonly<Record<number, number>> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

/** One accessor's values, flattened; a normalised integer read as 0 to 1. */
function values(file: GlbFile, index: number): number[] {
  const document = file.json as unknown as SkinnedDocument;
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

/** The LOD's vertices in the VAT's column order, each with its weights by bone name. */
interface PackVertex {
  readonly weights: ReadonlyMap<string, number>;
  readonly uv?: readonly [number, number];
}

function packVertices(file: GlbFile): readonly PackVertex[] {
  const document = file.json as unknown as SkinnedDocument;
  const out: PackVertex[] = [];
  document.meshes.forEach((mesh, meshIndex) => {
    const node = document.nodes.find((each) => each.mesh === meshIndex);
    const skin = document.skins[node?.skin ?? -1];
    if (skin === undefined) throw new Error(`mesh ${String(meshIndex)} is not skinned`);
    const names = skin.joints.map((joint) => document.nodes[joint]?.name ?? '');
    for (const primitive of mesh.primitives) {
      const joints = values(file, primitive.attributes['JOINTS_0'] as number);
      const weights = values(file, primitive.attributes['WEIGHTS_0'] as number);
      const uv =
        primitive.attributes['TEXCOORD_0'] === undefined
          ? undefined
          : values(file, primitive.attributes['TEXCOORD_0']);
      for (let vertex = 0; vertex < joints.length / 4; vertex += 1) {
        const byBone = new Map<string, number>();
        for (let slot = 0; slot < 4; slot += 1) {
          const weight = weights[vertex * 4 + slot] as number;
          if (weight === 0) continue;
          const name = names[joints[vertex * 4 + slot] as number] ?? '';
          byBone.set(name, (byBone.get(name) ?? 0) + weight);
        }
        out.push({
          weights: byBone,
          ...(uv === undefined
            ? {}
            : { uv: [uv[vertex * 2] as number, uv[vertex * 2 + 1] as number] as const }),
        });
      }
    }
  });
  return out;
}

const lod = readGlb(at(REALISTIC_RIDER_PACK.lod));
const vertices = packVertices(lod);
const vat = readRiderPackVat(new Uint8Array(readFileSync(at(REALISTIC_RIDER_PACK.vat))));

/** The vertices wholly on each foot's bone — the shoe — index 0 the `+X` (`.L`) foot. */
const feet = (['L', 'R'] as const).map((side) =>
  vertices.flatMap((vertex, index) =>
    (vertex.weights.get(`foot.${side}`) ?? 0) >= 0.999 ? [index] : [],
  ),
) as [number[], number[]];

function position(baked: RiderPackVat, phase: number, vertex: number): [number, number, number] {
  const offset = (phase * baked.vertices + vertex) * 3;
  return [
    baked.positions[offset] as number,
    baked.positions[offset + 1] as number,
    baked.positions[offset + 2] as number,
  ];
}

/**
 * Each foot vertex's distance from its pedal at every phase, against the same
 * at phase 0, worst over both feet: a foot clipped to its pedal turns ABOUT
 * the pedal, so every one of its points keeps its distance from it. `shift`
 * pairs phase `k` of the bake with the pedal of phase `k + shift` — the
 * control. Also returns how far the pedal ever is from its foot's nearest
 * vertex, which says the point every distance is kept from is in the shoe.
 */
function footDrift(baked: RiderPackVat, shift: number): { drift: number; reach: number } {
  let drift = 0;
  let reach = 0;
  for (const index of [0, 1] as const) {
    const distances = (phase: number): number[] => {
      const pedal = pedalAt(packAngle((phase + shift) % baked.phases, baked.phases), index);
      return feet[index].map((vertex) => {
        const [x, y, z] = position(baked, phase, vertex);
        return Math.hypot(x - pedal[0], y - pedal[1], z - pedal[2]);
      });
    };
    const first = distances(0);
    for (let phase = 0; phase < baked.phases; phase += 1) {
      const now = distances(phase);
      now.forEach((distance, each) => {
        drift = Math.max(drift, Math.abs(distance - (first[each] as number)));
      });
      reach = Math.max(reach, Math.min(...now));
    }
  }
  return { drift, reach };
}

describe('the pack’s bake matches the runtime’s own IK — #2485, #681', () => {
  it('finds a shoe on each foot to measure', () => {
    // Non-vacuity: a foot with no vertex wholly on it would pass anything.
    expect(feet[0].length).toBeGreaterThanOrEqual(20);
    expect(feet[1].length).toBe(feet[0].length);
  });

  it('keeps every baked foot on legBones’ pedal at every phase, within 5 mm', () => {
    const { drift, reach } = footDrift(vat, 0);
    console.log(
      `#2485: the baked feet keep their distance from legBones' pedal to ${(drift * 1000).toFixed(2)} mm; ` +
        `the pedal is at most ${(reach * 1000).toFixed(1)} mm from its shoe's nearest vertex`,
    );
    expect(drift).toBeLessThanOrEqual(FOOT_TOLERANCE_METRES);
    // And the point they keep it from is the ankle, not somewhere beside the
    // bicycle: within 8 cm of the shoe's nearest vertex (74 mm measured: the
    // vertices round the ankle itself are shared with the shin, so not here;
    // 62 mm before #2504's shoe, whose smooth last the decimator cuts to fewer
    // vertices round the heel).
    expect(reach).toBeLessThan(0.08);
  });

  it('fails the same measure with the VAT shifted by one phase either way — the control', () => {
    for (const shift of [1, RIDER_PACK_PHASES - 1]) {
      const { drift } = footDrift(vat, shift);
      console.log(
        `#2485's control: shifted by ${String(shift)}, the drift is ${(drift * 1000).toFixed(1)} mm`,
      );
      expect(drift, `shifted ${String(shift)}`).toBeGreaterThan(2 * FOOT_TOLERANCE_METRES);
    }
  });

  it('moves the feet: a shoe at phase 0 and at the half turn is a crank’s length and more apart', () => {
    // Non-vacuity for the drift: the pedals it measures from are 34 cm apart
    // at these two phases, and a bake whose feet followed them moved too.
    const middle = (phase: number): number[] =>
      [0, 1, 2].map(
        (axis) =>
          feet[0].reduce((sum, vertex) => sum + (position(vat, phase, vertex)[axis] as number), 0) /
          feet[0].length,
      );
    const [ax, ay, az] = middle(0) as [number, number, number];
    const [bx, by, bz] = middle(RIDER_PACK_PHASES / 2) as [number, number, number];
    expect(Math.hypot(ax - bx, ay - by, az - bz)).toBeGreaterThan(CRANK_LENGTH_METRES);
  });
});

describe('the pack’s LOD and its texture — #2485', () => {
  it('is about RIDER_PACK_TRIANGLES triangles, skinned, wearing the rider’s texture coordinates', () => {
    const facts = modelFacts(at(REALISTIC_RIDER_PACK.lod));
    expect(facts.triangles).toBeLessThanOrEqual(RIDER_PACK_TRIANGLES);
    expect(facts.triangles).toBeGreaterThan(RIDER_PACK_TRIANGLES * 0.95);
    expect(facts.skinned).toBe(true);
    // No picture of its own: the pack wears the rider's three maps.
    expect(facts.images).toEqual([]);
    const textured = vertices.flatMap((vertex) => (vertex.uv === undefined ? [] : [vertex.uv]));
    expect(textured.length).toBeGreaterThan(vertices.length / 2);
    for (const [u, v] of textured) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('has one texture column a vertex of the file, and every phase', () => {
    expect(vat.vertices).toBe(vertices.length);
    expect(vat.phases).toBe(RIDER_PACK_PHASES);
    for (const value of [...vat.positions, ...vat.normals])
      expect(Number.isFinite(value)).toBe(true);
    // Every normal a unit, to the half floats' precision.
    for (let at = 0; at < vat.normals.length; at += 3) {
      const length = Math.hypot(
        vat.normals[at] as number,
        vat.normals[at + 1] as number,
        vat.normals[at + 2] as number,
      );
      expect(Math.abs(length - 1)).toBeLessThan(0.003);
    }
  });

  it('moves the legs and nothing else: the helmet is still, and so are most of the vertices', () => {
    // No #625 motion: the upper body is where the stance puts it at every
    // crank angle, and the file carries it once.
    expect(vat.moving).toBeGreaterThan(0);
    expect(vat.moving).toBeLessThan(vat.vertices / 2);
    const helmet = vertices.flatMap((vertex, index) =>
      (vertex.weights.get('head') ?? 0) >= 0.999 && vertex.uv === undefined ? [index] : [],
    );
    expect(helmet.length).toBeGreaterThan(0);
    for (const vertex of helmet) {
      for (let phase = 1; phase < vat.phases; phase += 1) {
        expect(position(vat, phase, vertex)).toEqual(position(vat, 0, vertex));
      }
    }
  });

  it('fits #681’s ceilings: under 1 MiB of texture expanded', () => {
    expect(riderPackTextureBytes(vat.vertices, vat.phases)).toBeLessThanOrEqual(1024 * 1024);
  });

  it('is the run on record: its report’s counts are the committed files’', () => {
    const expected = EXPECTED_REPORTS[REALISTIC_RIDER_PACK.lod];
    expect(expected).toEqual({
      triangles: modelFacts(at(REALISTIC_RIDER_PACK.lod)).triangles,
      vertices: vat.vertices,
      moving: vat.moving,
      phases: RIDER_PACK_PHASES,
    });
    const output = OUTPUTS.find((each) => each.file === REALISTIC_RIDER_PACK.lod);
    expect(output?.recipe.how === 'blender' && output.recipe.script).toBe(RIDER_SCRIPT);
    expect(output?.recipe.how === 'blender' && output.recipe.pose).toBe(RIDER_PACK_PHASES);
  });
});

describe('packPose — the joints the bake is posed onto', () => {
  it('is bicycle.ts’ riderJoints at each phase’s crank angle, seated on the hoods', () => {
    const pose = packPose(8);
    expect(pose.phases).toHaveLength(8);
    pose.phases.forEach((phase, index) => {
      expect(phase.angle).toBe((2 * Math.PI * index) / 8);
      const joints = riderJoints(phase.angle, emptyRiderJoints(), 0);
      expect(phase.hips).toEqual(joints.hips);
      expect(phase.shoulders).toEqual(joints.shoulders);
      expect(phase.foot).toEqual(joints.foot);
      expect(phase.grip).toEqual(joints.grip);
      // The foot is on the pedal legBones draws.
      const pedal = pedalAt(phase.angle, 0);
      expect(phase.foot[0].x).toBeCloseTo(pedal[0], 12);
      expect(phase.foot[0].y).toBeCloseTo(pedal[1], 12);
      expect(phase.foot[0].z).toBeCloseTo(pedal[2], 12);
    });
    const stance = emptyRiderStance();
    expect(pose.stance).toEqual({
      elbowOut: stance.elbowOut,
      elbowBack: stance.elbowBack,
      handDown: stance.handDown,
      headPitch: stance.headPitch,
    });
    expect(pose.leg).toBeCloseTo(0.895, 12);
  });

  it('puts phase k at 2πk / phases, from bicycle.ts’ zero', () => {
    expect(packAngle(0, 32)).toBe(0);
    expect(packAngle(8, 32)).toBeCloseTo(Math.PI / 2, 12);
    // A crank at zero has the `+X` pedal ahead of the axle, level with it.
    expect(pedalAt(0, 0)[1]).toBeCloseTo(CRANK_AXIS_Y + CRANK_LENGTH_METRES, 12);
    expect(pedalAt(0, 0)[2]).toBeCloseTo(CRANK_AXIS_Z, 12);
  });

  it('refuses fewer than two phases or a fraction of one', () => {
    expect(() => packPose(1)).toThrow();
    expect(() => packPose(2.5)).toThrow();
  });
});

describe('readRiderPackVat — the layout', () => {
  const HALF_ONE = 0x3c00;
  const HALF_TWO = 0x4000;
  const HALF_THREE = 0x4200;

  /** A file of two vertices at three phases, vertex 1 moving: its x is the phase + 1. */
  function sample(
    overrides: { magic?: string; moving?: readonly number[]; trim?: number } = {},
  ): Uint8Array {
    const moving = overrides.moving ?? [1];
    const bytes = new Uint8Array(riderPackVatBytes(2, 3, moving.length) - (overrides.trim ?? 0));
    const view = new DataView(bytes.buffer);
    const magic = overrides.magic ?? 'OYLV';
    for (let at = 0; at < 4; at += 1) bytes[at] = magic.charCodeAt(at);
    view.setUint32(4, 2, true);
    view.setUint32(8, 3, true);
    view.setUint32(12, moving.length, true);
    let at = RIDER_PACK_HEADER_BYTES;
    // Phase 0: vertex 0 at (1, 1, 1) facing +Y; vertex 1 at (1, 0, 0) facing +Y.
    for (const [x, y, z] of [
      [HALF_ONE, HALF_ONE, HALF_ONE],
      [HALF_ONE, 0, 0],
    ] as const) {
      for (const half of [x, y, z, 0, HALF_ONE, 0]) {
        if (at + 2 <= bytes.byteLength) view.setUint16(at, half, true);
        at += 2;
      }
    }
    for (const vertex of moving) {
      if (at + 2 <= bytes.byteLength) view.setUint16(at, vertex, true);
      at += 2;
    }
    for (const x of [HALF_ONE, HALF_TWO, HALF_THREE]) {
      for (const half of [x, 0, 0, 0, HALF_ONE, 0]) {
        if (at + 2 <= bytes.byteLength) view.setUint16(at, half, true);
        at += 2;
      }
    }
    return bytes;
  }

  it('expands the still vertices to every phase and the moving ones phase by phase', () => {
    const read = readRiderPackVat(sample());
    expect([read.vertices, read.phases, read.moving]).toEqual([2, 3, 1]);
    for (let phase = 0; phase < 3; phase += 1) {
      expect(position(read, phase, 0)).toEqual([1, 1, 1]);
      expect(position(read, phase, 1)).toEqual([phase + 1, 0, 0]);
      expect([...read.normals.subarray((phase * 2 + 1) * 3, (phase * 2 + 2) * 3)]).toEqual([
        0, 1, 0,
      ]);
    }
  });

  it('refuses another magic, a short file and a moving list out of order or range', () => {
    expect(() => readRiderPackVat(sample({ magic: 'GLTF' }))).toThrow(/opens GLTF/);
    expect(() => readRiderPackVat(sample({ trim: 2 }))).toThrow(/bytes/);
    expect(() => readRiderPackVat(new Uint8Array(4))).toThrow(/too short/);
    expect(() => readRiderPackVat(sample({ moving: [2] }))).toThrow(/out of order or range/);
    expect(() => readRiderPackVat(sample({ moving: [1, 0] }))).toThrow(/out of order or range/);
  });

  it('reads IEEE half floats, the subnormal and the infinite ones too', () => {
    expect(fromHalf(0x3c00)).toBe(1);
    expect(fromHalf(0xc000)).toBe(-2);
    expect(fromHalf(0x3555)).toBeCloseTo(1 / 3, 3);
    expect(fromHalf(0x0001)).toBe(2 ** -24);
    expect(fromHalf(0x7c00)).toBe(Number.POSITIVE_INFINITY);
    expect(fromHalf(0xfc00)).toBe(Number.NEGATIVE_INFINITY);
    expect(fromHalf(0x7e00)).toBeNaN();
    expect(fromHalf(0x8000)).toBe(-0);
  });
});
