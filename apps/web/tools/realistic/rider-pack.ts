// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pack's rider, baked — #2485, the bake half of #681.
 *
 * `blender/process_rider.py`, run with `lod`, cuts the MakeHuman body to about
 * `realistic-assets.ts` §`RIDER_PACK_TRIANGLES` triangles and poses it on the
 * bicycle at `RIDER_PACK_PHASES` crank angles, writing every vertex's place at
 * each into a vertex-animation texture (VAT). This file is the two halves of
 * that bake that are not Blender's:
 *
 * - {@link packPose}: where the joints are at each phase, written by
 *   `process-assets.ts` as a JSON file the script reads. ⚠️ **From
 *   `bicycle.ts` §`riderJoints`, never a second statement of it**: the hips on
 *   the saddle, the back to the shoulders, the hands on the hoods and each
 *   foot on its pedal are the runtime's own numbers, so the bake and the
 *   stylised and realistic riders cannot disagree about where a leg is. The
 *   script aims the bones at them as `three-renderer.ts` §`RealisticRiderBelt`
 *   does, with none of #625's motion — the pack does not get it (#681).
 * - {@link readRiderPackVat}: the committed VAT, read back. The belt that draws
 *   it is #681's second half; until then `rider-pack.test.ts` is its reader,
 *   and holds every baked foot to `legBones`' pedal.
 *
 * ## The VAT's layout
 *
 * Little-endian. A 16-byte header — `OYLV`, then the vertex count, the phase
 * count and the MOVING count, each a `uint32` — then:
 *
 * 1. every vertex at phase 0: its position and its normal, six IEEE half
 *    floats;
 * 2. the moving vertices' indices, one `uint16` each, ascending;
 * 3. for each phase, each moving vertex's position and normal, six halves.
 *
 * A vertex is MOVING when any phase's six halves differ from phase 0's. With
 * no #625 motion the hips, the back, the arms and the head are where the
 * stance puts them at every crank angle, so only the legs move, and the file
 * carries the rest once: {@link RIDER_PACK_HEADER_BYTES} plus 12 bytes a
 * vertex plus 12 bytes a moving vertex a phase, where a dense texture would be
 * 12 bytes a vertex a phase. The realistic set was 339 667 bytes under
 * `realistic-budget.ts` §`REALISTIC_BUILD_BYTES` before this, which a dense
 * file does not fit in (#2485's PR says by how much). Expanded, it is the
 * people's layout (`people-body.ts` §`ANIMATION_ROWS`): one column a vertex,
 * a position row a phase and a normal row a phase, half-float RGBA —
 * {@link riderPackTextureBytes}.
 *
 * Positions are metres in the bicycle's own frame — `+Y` up, `+Z` forward,
 * the rider's left `+X` (`bicycle.ts` §`RiderJoints`) — so the belt draws a
 * vertex at its instance's matrix times the texel and nothing else.
 *
 * Pure: no file and no rendering library.
 */

import {
  emptyRiderJoints,
  emptyRiderStance,
  legBones,
  riderJoints,
  type JointPoint,
} from '../../src/game/bicycle';

/** The four bytes a pack VAT opens with. */
export const RIDER_PACK_MAGIC = 'OYLV';

/** The header: the magic and three `uint32`s. */
export const RIDER_PACK_HEADER_BYTES = 16;

/** Half floats a vertex a phase: a position and a normal. */
const HALVES_PER_SAMPLE = 6;

/** One phase's joints, as `process_rider.py` reads them. */
export interface PackPhase {
  /** The crank angle, `bicycle.ts`' convention. */
  readonly angle: number;
  readonly hips: JointPoint;
  readonly shoulders: JointPoint;
  /** Index 0 the rider's `+X` side, as in `RiderJoints`. */
  readonly foot: readonly [JointPoint, JointPoint];
  readonly grip: readonly [JointPoint, JointPoint];
}

/** What `process_rider.py` poses the pack's rider from. */
export interface PackPose {
  readonly phases: readonly PackPhase[];
  /** The hoods' stance's angles — `bicycle.ts` §`RiderStance`. */
  readonly stance: {
    readonly elbowOut: number;
    readonly elbowBack: number;
    readonly handDown: number;
    readonly headPitch: number;
  };
  /**
   * Hip to knee plus knee to ankle on the bicycle, from `legBones` — what the
   * body is scaled to, as `RealisticRiderBelt` scales it.
   */
  readonly leg: number;
}

/** The crank angle phase `phase` of `phases` is baked at. */
export function packAngle(phase: number, phases: number): number {
  return (2 * Math.PI * phase) / phases;
}

/**
 * The joints at each of `phases` crank angles, seated on the hoods with no
 * body lean — `riderJoints`' own defaults, which a pack rider on a straight
 * road is drawn with.
 */
export function packPose(phases: number): PackPose {
  if (!Number.isInteger(phases) || phases < 2) throw new Error(`${String(phases)} phases`);
  const copy = (point: JointPoint): JointPoint => ({ x: point.x, y: point.y, z: point.z });
  const stance = emptyRiderStance();
  const [thigh, shin] = legBones(0);
  if (thigh === undefined || shin === undefined) throw new Error('legBones returned no leg');
  return {
    phases: Array.from({ length: phases }, (_, phase): PackPhase => {
      const angle = packAngle(phase, phases);
      const joints = riderJoints(angle, emptyRiderJoints(), 0, stance);
      return {
        angle,
        hips: copy(joints.hips),
        shoulders: copy(joints.shoulders),
        foot: [copy(joints.foot[0]), copy(joints.foot[1])],
        grip: [copy(joints.grip[0]), copy(joints.grip[1])],
      };
    }),
    stance: {
      elbowOut: stance.elbowOut,
      elbowBack: stance.elbowBack,
      handDown: stance.handDown,
      headPitch: stance.headPitch,
    },
    leg: thigh.length + shin.length,
  };
}

/** The pack's VAT, read: every vertex at every phase. */
export interface RiderPackVat {
  readonly vertices: number;
  readonly phases: number;
  /** How many vertices move with the crank. */
  readonly moving: number;
  /** `phases × vertices × 3`: phase-major, then vertex, then x, y and z. */
  readonly positions: Float32Array;
  /** The same shape as {@link positions}. */
  readonly normals: Float32Array;
}

/** The byte count a VAT of this shape has. */
export function riderPackVatBytes(vertices: number, phases: number, moving: number): number {
  return RIDER_PACK_HEADER_BYTES + vertices * 12 + moving * 2 + phases * moving * 12;
}

/**
 * The texture the belt would upload, in bytes: one half-float RGBA column a
 * vertex, a position row and a normal row a phase — the people's layout.
 * #681's ceiling for it is 1 MiB.
 */
export function riderPackTextureBytes(vertices: number, phases: number): number {
  return vertices * 2 * phases * 8;
}

/** An IEEE 754 half float, from its 16 bits. */
export function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

/**
 * The committed VAT, expanded to every vertex at every phase. Refuses a file
 * whose magic, length or moving indices are not the layout's.
 * @see the header
 */
export function readRiderPackVat(bytes: Uint8Array): RiderPackVat {
  if (bytes.byteLength < RIDER_PACK_HEADER_BYTES) throw new Error('not a pack VAT: too short');
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== RIDER_PACK_MAGIC) throw new Error(`not a pack VAT: it opens ${magic}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertices = view.getUint32(4, true);
  const phases = view.getUint32(8, true);
  const moving = view.getUint32(12, true);
  const expected = riderPackVatBytes(vertices, phases, moving);
  if (bytes.byteLength !== expected) {
    throw new Error(
      `a pack VAT of this shape is ${String(expected)} bytes, not ${String(bytes.byteLength)}`,
    );
  }
  const half = (at: number): number => fromHalf(view.getUint16(at, true));
  const positions = new Float32Array(phases * vertices * 3);
  const normals = new Float32Array(phases * vertices * 3);
  const sample = (at: number, phase: number, vertex: number): void => {
    const into = (phase * vertices + vertex) * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      positions[into + axis] = half(at + axis * 2);
      normals[into + axis] = half(at + (3 + axis) * 2);
    }
  };
  let at = RIDER_PACK_HEADER_BYTES;
  const rest = at;
  for (let phase = 0; phase < phases; phase += 1) {
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      sample(rest + vertex * HALVES_PER_SAMPLE * 2, phase, vertex);
    }
  }
  at += vertices * HALVES_PER_SAMPLE * 2;
  const indices: number[] = [];
  for (let each = 0; each < moving; each += 1) {
    const vertex = view.getUint16(at + each * 2, true);
    if (vertex >= vertices || (each > 0 && vertex <= (indices[each - 1] as number))) {
      throw new Error(`a pack VAT's moving vertex ${String(vertex)} is out of order or range`);
    }
    indices.push(vertex);
  }
  at += moving * 2;
  for (let phase = 0; phase < phases; phase += 1) {
    indices.forEach((vertex, each) => {
      sample(at + (phase * moving + each) * HALVES_PER_SAMPLE * 2, phase, vertex);
    });
  }
  return { vertices, phases, moving, positions, normals };
}
