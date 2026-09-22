// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A placeholder realistic rider: MakeHuman's CC0 body, skinned, on a road bike
 * modelled from `bicycle.ts`'s own parts — #457 (4).
 *
 * ⚠️ **Spike code on a never-merged branch** (see `surfaces.ts`).
 *
 * ## The body is posed from `bicycle.ts`, every frame
 *
 * `process_rider.py` exports the body in MakeHuman's rest pose with a 24-bone
 * skeleton. Nothing is baked: this file aims each bone at a joint position
 * `bicycle.ts` already computes for the product's rider — the hips on the
 * saddle, the shoulders over the bars, the hands on the hoods, and each knee
 * and foot from `legBones(crankAngle)` — so the realistic rider pedals from
 * exactly the crank angle the HUD's cadence drives, and cannot drift from the
 * product's idea of where a leg is. The body is first scaled so its leg is as
 * long as `bicycle.ts`'s (thigh + shin): fitting the body to the bike.
 *
 * ## The bike is modelled here rather than downloaded
 *
 * No road bike whose OWN page states CC0 or CC-BY-4.0 was found on either
 * source #457 names that states a per-asset licence (Poly Haven has none;
 * ambientCG has none), and a marketplace's label is not a grant. So the bike is
 * `RIDER_BODY_PARTS` re-drawn with real proportions: round tubes of the
 * product's own radii, spoked wheels with rims and tyres, a saddle, bars and a
 * crankset turning at the same angle. It is ours, so it carries this file's
 * licence and needs no row anywhere.
 */

import {
  Bone,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Scene,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  CRANK_AXIS_Y,
  CRANK_AXIS_Z,
  legBones,
  RIDER_BODY_PARTS,
  RIDER_CRANK_PARTS,
  type RiderPart,
} from '../../src/game/bicycle';
import type { RiderMarker } from '../../src/game/port';

/** One segment's two ends, in the bicycle's own frame. */
export interface Segment {
  readonly from: Vector3;
  readonly to: Vector3;
}

/** A tube part's two ends: its centre ± half its length along its pitch. */
export function tubeEnds(part: RiderPart): Segment {
  if (part.solid.shape !== 'tube') throw new Error(`${part.name} is not a tube`);
  const half = part.solid.length / 2;
  const direction = new Vector3(0, Math.cos(part.pitch), Math.sin(part.pitch));
  const centre = new Vector3(part.x, part.y, part.z);
  return {
    from: centre.clone().addScaledVector(direction, -half),
    to: centre.clone().addScaledVector(direction, half),
  };
}

/** The torso's box, as a hip-to-shoulder segment. */
function torsoEnds(): Segment {
  const torso = RIDER_BODY_PARTS.find((part) => part.name === 'torso');
  if (torso?.solid.shape !== 'box') throw new Error('bicycle.ts has no torso box');
  const half = torso.solid.height / 2;
  const direction = new Vector3(0, Math.cos(torso.pitch), Math.sin(torso.pitch));
  const centre = new Vector3(torso.x, torso.y, torso.z);
  return {
    from: centre.clone().addScaledVector(direction, -half),
    to: centre.clone().addScaledVector(direction, half),
  };
}

/** Where the product's rider's joints are, for one crank angle, in the bicycle's frame. */
export interface RiderJoints {
  readonly hips: Vector3;
  readonly shoulders: Vector3;
  /** Side +1 (the rider's left, +X) then side −1. */
  readonly knee: readonly [Vector3, Vector3];
  readonly foot: readonly [Vector3, Vector3];
  readonly grip: readonly [Vector3, Vector3];
}

export function riderJoints(crankAngle: number): RiderJoints {
  const legs = legBones(crankAngle);
  const end = (index: number, sign: 1 | -1): Vector3 => {
    const bone = legs[index];
    if (bone === undefined) throw new Error('legBones returned too few bones');
    return new Vector3(
      bone.x,
      bone.y + (sign * bone.length * Math.cos(bone.pitch)) / 2,
      bone.z + (sign * bone.length * Math.sin(bone.pitch)) / 2,
    );
  };
  const arm = (side: 1 | -1): Vector3 => {
    const part = RIDER_BODY_PARTS.find((each) => each.name === `arm ${side}`);
    if (part === undefined) throw new Error(`bicycle.ts has no arm ${side}`);
    return tubeEnds(part).to;
  };
  const torso = torsoEnds();
  return {
    hips: torso.from,
    shoulders: torso.to,
    knee: [end(0, 1), end(2, 1)],
    foot: [end(1, 1), end(3, 1)],
    grip: [arm(1), arm(-1)],
  };
}

/**
 * The elbow or knee of a two-bone limb from `root` to `target`, bent towards
 * `pole`. The same law `bicycle.ts` §`kneeBetween` uses, in three dimensions.
 */
export function twoBoneJoint(
  root: Vector3,
  target: Vector3,
  upper: number,
  lower: number,
  pole: Vector3,
): Vector3 {
  const reach = target.clone().sub(root);
  const distance = Math.min(Math.max(reach.length(), 1e-6), upper + lower - 1e-4);
  const along = reach.normalize();
  const cosine = Math.min(
    1,
    Math.max(-1, (upper * upper + distance * distance - lower * lower) / (2 * upper * distance)),
  );
  const bend = pole.clone().addScaledVector(along, -pole.dot(along));
  if (bend.lengthSq() < 1e-12) bend.set(0, 0, 1);
  bend.normalize();
  return root
    .clone()
    .addScaledVector(along, upper * cosine)
    .addScaledVector(bend, upper * Math.sqrt(1 - cosine * cosine));
}

const FRAME = new MeshStandardMaterial({ color: 0x7a1020, metalness: 0.35, roughness: 0.32 });
const RUBBER = new MeshStandardMaterial({ color: 0x151515, metalness: 0, roughness: 0.85 });
const METAL = new MeshStandardMaterial({ color: 0xb8b8bc, metalness: 0.9, roughness: 0.3 });
const HELMET = new MeshStandardMaterial({ color: 0xf0f0f0, metalness: 0, roughness: 0.4 });

function placed(geometry: BufferGeometry, part: RiderPart): BufferGeometry {
  const holder = new Mesh(geometry);
  holder.position.set(part.x, part.y, part.z);
  holder.rotation.set(part.pitch, part.yaw, part.roll, 'XYZ');
  holder.updateMatrix();
  return geometry.applyMatrix4(holder.matrix);
}

/** A spoked wheel lying in the bicycle's YZ plane at a hub. */
function wheel(
  hubY: number,
  hubZ: number,
  radius: number,
  tyre: number,
): { rubber: BufferGeometry; metal: BufferGeometry } {
  const rubber = new TorusGeometry(radius - tyre, tyre, 10, 48)
    .rotateY(Math.PI / 2)
    .translate(0, hubY, hubZ);
  const parts: BufferGeometry[] = [
    new TorusGeometry(radius - tyre * 2.2, tyre * 0.45, 6, 48)
      .rotateY(Math.PI / 2)
      .translate(0, hubY, hubZ),
    new CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2).translate(0, hubY, hubZ),
  ];
  const spokes = 20;
  for (let spoke = 0; spoke < spokes; spoke += 1) {
    const angle = (spoke / spokes) * Math.PI * 2;
    const length = radius - tyre * 2.2;
    parts.push(
      new CylinderGeometry(0.0015, 0.0015, length, 3)
        .translate(0, length / 2, 0)
        .rotateX(angle)
        .translate(spoke % 2 === 0 ? 0.02 : -0.02, hubY, hubZ),
    );
  }
  return { rubber, metal: mergeGeometries(parts) };
}

/** The bike: frame, rubber and metal, merged into one geometry each — three draw calls. */
function bicycle(): Group {
  const frame: BufferGeometry[] = [];
  const rubber: BufferGeometry[] = [];
  const metal: BufferGeometry[] = [];
  for (const part of RIDER_BODY_PARTS) {
    if (part.name.startsWith('arm') || part.name === 'torso' || part.name === 'helmet') continue;
    if (part.solid.shape === 'ring') {
      const drawn = wheel(
        part.y,
        part.z,
        part.solid.radius + part.solid.thickness,
        part.solid.thickness,
      );
      rubber.push(drawn.rubber);
      metal.push(drawn.metal);
    } else if (part.solid.shape === 'tube') {
      const geometry = placed(
        new CylinderGeometry(part.solid.radius, part.solid.radius, part.solid.length, 12),
        part,
      );
      (part.name === 'handlebar' ? rubber : frame).push(geometry);
    } else if (part.solid.shape === 'box') {
      rubber.push(
        placed(new BoxGeometry(part.solid.width * 0.8, part.solid.height, part.solid.depth), part),
      );
    }
  }
  // Drops: a half-torus each side of the bar, curling down and back.
  for (const side of [-1, 1]) {
    rubber.push(
      new TorusGeometry(0.07, 0.012, 8, 16, Math.PI)
        .rotateY(Math.PI / 2)
        .rotateX(Math.PI / 2)
        .translate(side * 0.2, 0.91, 0.34),
    );
  }
  const group = new Group();
  group.add(new Mesh(mergeGeometries(frame), FRAME));
  group.add(new Mesh(mergeGeometries(rubber), RUBBER));
  group.add(new Mesh(mergeGeometries(metal), METAL));
  return group;
}

function crankset(): Group {
  const parts: BufferGeometry[] = [];
  for (const part of RIDER_CRANK_PARTS) {
    if (part.solid.shape === 'ring') {
      parts.push(
        new TorusGeometry(part.solid.radius, part.solid.thickness / 2, 6, 40)
          .rotateY(Math.PI / 2)
          .translate(part.x, part.y, part.z),
      );
    } else if (part.solid.shape === 'box') {
      parts.push(
        placed(new BoxGeometry(part.solid.width, part.solid.height, part.solid.depth), part),
      );
    }
  }
  const group = new Group();
  group.add(new Mesh(mergeGeometries(parts), METAL));
  group.position.set(0, CRANK_AXIS_Y, CRANK_AXIS_Z);
  return group;
}

/** The bones this file poses, by the names `process_rider.py` keeps. */
const SIDES = [
  { suffix: 'L', index: 0 },
  { suffix: 'R', index: 1 },
] as const;

export class RealisticRider {
  readonly #root = new Group();
  readonly #crank: Group;
  readonly #body: SkinnedMesh;
  readonly #bones = new Map<string, Bone>();
  readonly #scale: number;
  readonly triangles: number;
  readonly boneCount: number;
  readonly drawCalls: number;
  readonly #rest = new Map<Bone, Quaternion>();
  readonly #restPosition = new Map<Bone, Vector3>();

  private constructor(body: SkinnedMesh, holder: Object3D) {
    this.#body = body;
    body.frustumCulled = false;
    for (const bone of body.skeleton.bones) {
      this.#bones.set(bone.name, bone);
      this.#rest.set(bone, bone.quaternion.clone());
      this.#restPosition.set(bone, bone.position.clone());
    }
    holder.updateMatrixWorld(true);
    const at = (name: string): Vector3 => this.#bone(name).getWorldPosition(new Vector3());
    const restLeg =
      at('upperleg01.L').distanceTo(at('lowerleg01.L')) +
      at('lowerleg01.L').distanceTo(at('foot.L'));
    // bicycle.ts's leg: THIGH + SHIN, read back off `legBones` rather than copied.
    const bikeLeg = legBones(0)
      .slice(0, 2)
      .reduce((sum, bone) => sum + bone.length, 0);
    this.#scale = bikeLeg / restLeg;
    holder.scale.setScalar(this.#scale);
    this.#root.add(holder);
    this.#root.add(bicycle());
    this.#crank = crankset();
    this.#root.add(this.#crank);
    const helmet = new Mesh(
      new SphereGeometry(0.13, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.8),
      HELMET,
    );
    helmet.position.set(0, 0.06 / this.#scale, 0.01 / this.#scale);
    helmet.scale.setScalar(1 / this.#scale);
    this.#bone('head').add(helmet);
    const index = body.geometry.index;
    this.triangles = (index?.count ?? body.geometry.getAttribute('position').count) / 3;
    this.boneCount = body.skeleton.bones.length;
    this.drawCalls = 1 + 3 + 1 + 1;
  }

  static async load(base: string): Promise<RealisticRider> {
    const gltf = await new GLTFLoader().loadAsync(`${base}rider.glb`);
    let body: SkinnedMesh | undefined;
    gltf.scene.traverse((node) => {
      if (node instanceof SkinnedMesh) body = node;
    });
    if (body === undefined) throw new Error('rider.glb holds no skinned mesh');
    return new RealisticRider(body, gltf.scene);
  }

  /**
   * A bone by its MakeHuman name. three's loader strips the `.` from a node
   * name (`PropertyBinding.sanitizeNodeName`), so `upperleg01.L` arrives as
   * `upperleg01L`.
   */
  #bone(name: string): Bone {
    const bone = this.#bones.get(name.replace(/\./g, ''));
    if (bone === undefined) throw new Error(`rider.glb has no bone ${name}`);
    return bone;
  }

  addTo(scene: Scene): void {
    scene.add(this.#root);
  }

  materials(): readonly Material[] {
    return [this.#body.material as Material, FRAME, RUBBER, METAL, HELMET];
  }

  /** Places and poses the rider on its marker. Hidden when the frame has none. */
  place(marker: RiderMarker | undefined): void {
    this.#root.visible = marker !== undefined;
    if (marker === undefined) return;
    this.#root.position.set(marker.x, marker.y, marker.z);
    this.#root.rotation.set(0, Math.atan2(marker.headingX, marker.headingZ), 0);
    const angle = marker.crankAngle ?? 0;
    this.#crank.rotation.x = angle;
    this.#pose(angle);
  }

  #pose(crankAngle: number): void {
    for (const [bone, rest] of this.#rest) bone.quaternion.copy(rest);
    for (const [bone, rest] of this.#restPosition) bone.position.copy(rest);
    this.#root.updateMatrixWorld(true);
    const joints = riderJoints(crankAngle);
    const toWorld = (local: Vector3): Vector3 => this.#root.localToWorld(local.clone());
    // The whole body, moved so its hips sit on the saddle.
    const hips = this.#bone('upperleg01.L')
      .getWorldPosition(new Vector3())
      .add(this.#bone('upperleg01.R').getWorldPosition(new Vector3()))
      .multiplyScalar(0.5);
    const shift = toWorld(joints.hips).sub(hips);
    const skeletonRoot = this.#bone('root');
    const parentInverse = new Quaternion();
    skeletonRoot.parent?.getWorldQuaternion(parentInverse);
    const shiftLocal = shift
      .clone()
      .applyQuaternion(parentInverse.invert())
      .divideScalar(this.#scale);
    skeletonRoot.position.add(shiftLocal);
    this.#root.updateMatrixWorld(true);
    // The spine leans from the hips to the shoulders.
    this.#aim('spine05', 'neck01', toWorld(joints.shoulders).sub(toWorld(joints.hips)));
    for (const { suffix, index } of SIDES) {
      const across = new Vector3(index === 0 ? 1 : -1, 0, 0).transformDirection(
        this.#root.matrixWorld,
      );
      // Arms: shoulder to grip, elbows out and down.
      const shoulder = this.#bone(`upperarm01.${suffix}`).getWorldPosition(new Vector3());
      const grip = toWorld(joints.grip[index]);
      const upper = this.#length(`upperarm01.${suffix}`, `lowerarm01.${suffix}`);
      const fore = this.#length(`lowerarm01.${suffix}`, `wrist.${suffix}`);
      const down = new Vector3(0, -1, 0);
      const elbow = twoBoneJoint(shoulder, grip, upper, fore, across.clone().add(down));
      this.#aim(`upperarm01.${suffix}`, `lowerarm01.${suffix}`, elbow.clone().sub(shoulder));
      this.#aim(`lowerarm01.${suffix}`, `wrist.${suffix}`, grip.clone().sub(elbow));
      // Legs: hip to pedal, knees forward — `bicycle.ts`'s rule.
      const hip = this.#bone(`upperleg01.${suffix}`).getWorldPosition(new Vector3());
      const foot = toWorld(joints.foot[index]);
      const thigh = this.#length(`upperleg01.${suffix}`, `lowerleg01.${suffix}`);
      const shin = this.#length(`lowerleg01.${suffix}`, `foot.${suffix}`);
      const forward = new Vector3(0, 0, 1).transformDirection(this.#root.matrixWorld);
      const knee = twoBoneJoint(hip, foot, thigh, shin, forward);
      this.#aim(`upperleg01.${suffix}`, `lowerleg01.${suffix}`, knee.clone().sub(hip));
      this.#aim(`lowerleg01.${suffix}`, `foot.${suffix}`, foot.clone().sub(knee));
    }
  }

  #length(from: string, to: string): number {
    return this.#bone(from)
      .getWorldPosition(new Vector3())
      .distanceTo(this.#bone(to).getWorldPosition(new Vector3()));
  }

  /** Rotates `bone` so the direction to `child`'s head is `direction`, in world space. */
  #aim(boneName: string, childName: string, direction: Vector3): void {
    const bone = this.#bone(boneName);
    const child = this.#bone(childName);
    const head = bone.getWorldPosition(new Vector3());
    const current = child.getWorldPosition(new Vector3()).sub(head).normalize();
    const turn = new Quaternion().setFromUnitVectors(current, direction.clone().normalize());
    const world = bone.getWorldQuaternion(new Quaternion());
    const parent = new Quaternion();
    bone.parent?.getWorldQuaternion(parent);
    bone.quaternion.copy(parent.invert().multiply(turn.multiply(world)));
    bone.updateMatrixWorld(true);
  }
}
