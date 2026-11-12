// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2540: Delivery's parked car in the realistic world is Kenney's CC0 sedan,
 * made by `tools/realistic/blender/process_vehicle.py`, drawn inside the
 * obstacles' one instanced call, and posed per instance — its wheels rolling
 * with the distance it moves, its front wheels steering, its body pitching
 * and leaning, its indicators flashing — by `three-renderer.ts`
 * §`withDeliveryCarPose`.
 *
 * Read back through the paths a consumer uses: the committed GLB through
 * glTF 2.0's own accessors (`realistic-bytes-testing.ts` §`deliveryCarFacts`);
 * the belt's roster and its instance buffers, which are what three uploads;
 * and the pose's GLSL, run as the text the belt splices into the shader
 * (`glsl-program-testing.ts`). What jsdom cannot do — draw it, count the
 * frame's triangles and calls — `realistic-delivery.browser.spec.ts` does.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OBSTACLE_KINDS } from './delivery/obstacles';
import { GlslProgram } from './glsl-program-testing';
import type { DeliveryCarMotion, DeliveryObstaclePiece } from './port';
import { REALISTIC_DELIVERY_CAR } from './realistic-assets';
import {
  DELIVERY_CAR_TRIANGLES,
  DELIVERY_MOST_VERTEX_ATTRIBUTES,
  DELIVERY_VILLAGE_FRAME_TRIANGLES,
} from './realistic-budget';
import { deliveryCarFacts, type CarNodeFacts } from './realistic-bytes-testing';
import {
  BRAKING_DIP_RADIANS,
  DELIVERY_CAR_POSE_GLSL,
  DELIVERY_OBSTACLE_TRIANGLES,
  DELIVERY_REALISTIC_OBSTACLE_TRIANGLES,
  DeliveryBelt,
  INDICATOR_FLASHES_PER_SECOND,
  MOST_LEAN_RADIANS,
  MOST_STEER_RADIANS,
  deliveryCarGeometryOf,
  deliveryCarPose,
  indicatorLit,
  type DeliveryCarGeometry,
} from './three-renderer';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));
const CAR = deliveryCarFacts(join(SHIPPED, REALISTIC_DELIVERY_CAR));
const { halfLength, halfWidth } = OBSTACLE_KINDS['parked-car'];

const PARTS = [
  'body',
  'indicator-left',
  'indicator-right',
  'paint',
  'wheel-back-left',
  'wheel-back-right',
  'wheel-front-left',
  'wheel-front-right',
];

function node(name: string): CarNodeFacts {
  const found = CAR.nodes.find((each) => each.name === name);
  if (found === undefined) throw new Error(`the car has no ${name}`);
  return found;
}

/** A node's vertices carried by its own place into the car's frame: glTF's `T · R · v`. */
function placed(each: CarNodeFacts): readonly (readonly [number, number, number])[] {
  const [x, y, z, w] = each.rotation;
  const [tx, ty, tz] = each.translation;
  const out: [number, number, number][] = [];
  const p = each.geometry.position;
  for (let at = 0; at < p.length; at += 3) {
    const vx = p[at] as number;
    const vy = p[at + 1] as number;
    const vz = p[at + 2] as number;
    out.push([
      (1 - 2 * (y * y + z * z)) * vx + 2 * (x * y - z * w) * vy + 2 * (x * z + y * w) * vz + tx,
      2 * (x * y + z * w) * vx + (1 - 2 * (x * x + z * z)) * vy + 2 * (y * z - x * w) * vz + ty,
      2 * (x * z - y * w) * vx + 2 * (y * z + x * w) * vy + (1 - 2 * (x * x + y * y)) * vz + tz,
    ]);
  }
  return out;
}

/** A three-like attribute over a flat array, as `meshGeometryOf` reads one. */
function attribute(array: Float32Array, itemSize: number): unknown {
  return {
    array,
    itemSize,
    count: array.length / itemSize,
    getX: (at: number) => array[at * itemSize],
    getY: (at: number) => array[at * itemSize + 1],
    getZ: (at: number) => array[at * itemSize + 2],
  };
}

/**
 * The loader's scene, made from the committed file's own nodes: each a mesh
 * named as its node, its matrix its node's place (column-major, three's
 * order), its geometry unindexed. Nothing here may import three
 * (`three-seam.test.ts`), so this is what a loader hands, in shape.
 */
function sceneOf(nodes: readonly CarNodeFacts[]): never {
  const meshes = nodes.map((each) => {
    const [x, y, z, w] = each.rotation;
    const [tx, ty, tz] = each.translation;
    const elements = [
      1 - 2 * (y * y + z * z),
      2 * (x * y + z * w),
      2 * (x * z - y * w),
      0,
      2 * (x * y - z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z + x * w),
      0,
      2 * (x * z + y * w),
      2 * (y * z - x * w),
      1 - 2 * (x * x + y * y),
      0,
      tx,
      ty,
      tz,
      1,
    ];
    const attributes: Record<string, unknown> = {
      position: attribute(each.geometry.position, 3),
      normal: attribute(each.geometry.normal, 3),
      color: attribute(each.geometry.colour, 3),
    };
    return {
      isMesh: true,
      name: each.name,
      matrixWorld: { elements },
      geometry: { index: null, getAttribute: (name: string) => attributes[name] },
    };
  });
  return {
    traverse: (visit: (each: unknown) => void): void => {
      visit({ isMesh: false, name: 'scene' });
      for (const mesh of meshes) visit(mesh);
    },
    updateMatrixWorld: (): void => undefined,
  } as never;
}

const GEOMETRY = deliveryCarGeometryOf(sceneOf(CAR.nodes)) as DeliveryCarGeometry;

/** A car standing at `z` on the road, moving as `car` says, if at all. */
function carAt(z: number, car?: DeliveryCarMotion): DeliveryObstaclePiece {
  return { x: 0, y: 0, z, yaw: 0, kind: 'parked-car', index: 0, ...(car ? { car } : {}) };
}

/** A belt drawing Kenney's car, handed `obstacles`; what it drew, read back off its instances. */
function drawnPoses(obstacles: readonly DeliveryObstaclePiece[]) {
  const belt = new DeliveryBelt('realistic', GEOMETRY);
  belt.update({ parcels: [], markers: [], obstacles });
  const poses = belt.drawn('obstacles').map((each) => each.pose);
  belt.dispose();
  return poses;
}

const MOVING: DeliveryCarMotion = {
  travelledMetres: 0,
  speedMetresPerSecond: 1.5,
  steerRadians: 0,
  braking: 0,
};

describe('the committed car, read back off its GLB — #2540', () => {
  it('is one level of detail under the owner’s budget a car, its triangles counted as the roster draws them', () => {
    expect(CAR.nodes.map((each) => each.name).sort()).toEqual(PARTS);
    // Every node's triangles, a shared wheel's four times: what each obstacle
    // instance submits. The owner's ruling: about 1 450 a car, trimmed to fit.
    const triangles = CAR.nodes.reduce((sum, each) => sum + each.geometry.triangles, 0);
    expect(triangles).toBe(1_376);
    expect(triangles).toBeLessThanOrEqual(DELIVERY_CAR_TRIANGLES);
    // One level: no node is a second copy of the body at another detail.
    expect(CAR.nodes.filter((each) => each.name.startsWith('body'))).toHaveLength(1);
    // No picture and no material: a colour a corner, drawn in the obstacles' call.
    expect([CAR.materials, CAR.images, CAR.textures]).toEqual([0, 0, 0]);
    for (const each of CAR.nodes) {
      expect(each.geometry.attributes, each.name).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
    }
  });

  it('keeps its four wheels apart from the body, one mesh under four nodes, each node at its hub on the road', () => {
    const wheels = PARTS.filter((name) => name.startsWith('wheel-')).map(node);
    expect(new Set(wheels.map((each) => each.mesh)).size).toBe(1);
    expect(CAR.meshes).toBe(5);
    expect(new Set([node('body').mesh, node('paint').mesh, wheels[0]?.mesh]).size).toBe(3);
    for (const wheel of wheels) {
      const [x, y, z] = wheel.translation;
      expect(Math.sign(x), wheel.name).toBe(wheel.name.endsWith('-left') ? 1 : -1);
      expect(Math.sign(z), wheel.name).toBe(wheel.name.includes('-front-') ? 1 : -1);
      // Its hub: the wheel's own middle is its node's origin ...
      const ys = Array.from(wheel.geometry.position).filter((_, at) => at % 3 === 1);
      expect((Math.max(...ys) + Math.min(...ys)) / 2, wheel.name).toBeCloseTo(0, 3);
      // ... at its radius above the road, so the tyre touches it.
      expect(y + Math.min(...ys), wheel.name).toBeCloseTo(0, 3);
    }
  });

  it('carries an amber indicator on each side, front and back', () => {
    for (const name of ['indicator-left', 'indicator-right']) {
      const lamp = node(name);
      const points = placed(lamp);
      expect(
        points.every(([x]) => Math.sign(x) === (name.endsWith('left') ? 1 : -1)),
        name,
      ).toBe(true);
      expect(
        points.some(([, , z]) => z > halfLength - 0.3),
        name,
      ).toBe(true);
      expect(
        points.some(([, , z]) => z < -(halfLength - 0.3)),
        name,
      ).toBe(true);
      const c = lamp.geometry.colour;
      expect(c[0] as number).toBeGreaterThan(c[1] as number);
      expect(c[1] as number).toBeGreaterThan(c[2] as number);
    }
  });

  it('glazes its windows a dark tint, not the kit’s near-white swatch — PR #2548', () => {
    // `process_vehicle.py` §GLASS_SRGB, #2b3642, as linear RGB.
    const linear = (srgb: number): number => {
      const c = srgb / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const glass = [0x2b, 0x36, 0x42].map(linear);
    const { colour } = node('body').geometry;
    let glazed = 0;
    for (let at = 0; at < colour.length; at += 3) {
      const corner = [0, 1, 2].map((axis) => colour[at + axis] as number);
      if (corner.every((value, axis) => Math.abs(value - (glass[axis] as number)) < 1e-3)) {
        glazed += 1;
      }
    }
    // The kit's ten glass triangles: windscreen, rear screen and a side window each side.
    expect(glazed).toBe(10 * 3);
    // Dark, and a blue-grey: not the pale swatch the kit drew them in.
    expect(Math.max(...glass)).toBeLessThan(0.06);
    expect(glass[2] as number).toBeGreaterThan(glass[0] as number);
  });

  it('fills obstacles.ts’ parked car’s footprint, standing on the road', () => {
    const points = PARTS.flatMap((name) => placed(node(name)));
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const zs = points.map(([, , z]) => z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * halfWidth, 3);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2 * halfLength, 3);
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
  });
});

describe('Kenney’s car in Delivery’s belt — #2540', () => {
  it('copies the loader’s scene into eight parts, each wheel turning about its own hub', () => {
    expect(GEOMETRY.parts.map((part) => part.role).sort()).toEqual([
      'back-wheel',
      'back-wheel',
      'body',
      'front-wheel',
      'front-wheel',
      'indicator-left',
      'indicator-right',
      'paint',
    ]);
    expect(GEOMETRY.triangles).toBe(1_376);
    expect(GEOMETRY.wheelRadius).toBeCloseTo(node('wheel-front-left').translation[1], 5);
    expect(GEOMETRY.wheelbase).toBeCloseTo(
      node('wheel-front-left').translation[2] - node('wheel-back-left').translation[2],
      5,
    );
    // The right-hand wheels are the left-hand mesh turned about: copied into
    // the car's frame, they stand on the car's right.
    for (const part of GEOMETRY.parts.filter((each) => each.role.endsWith('wheel'))) {
      const xs = Array.from(part.position).filter((_, at) => at % 3 === 0);
      expect(Math.sign(Math.min(...xs))).toBe(Math.sign(Math.max(...xs)));
      expect(Math.sign(xs[0] as number)).toBe(Math.sign(part.pivot[0]));
    }
    // A scene without every part is no car.
    expect(
      deliveryCarGeometryOf(sceneOf(CAR.nodes.filter((each) => each.name !== 'paint'))),
    ).toBeUndefined();
  });

  it('draws it in place of its own car in the realistic world only, at the roster’s stated triangles', () => {
    const triangles = (belt: DeliveryBelt): number =>
      belt.meshOf('obstacles').geometry.getAttribute('position').count / 3;
    const realistic = new DeliveryBelt('realistic', GEOMETRY);
    expect(triangles(realistic)).toBe(DELIVERY_REALISTIC_OBSTACLE_TRIANGLES);
    expect(DELIVERY_REALISTIC_OBSTACLE_TRIANGLES - DELIVERY_OBSTACLE_TRIANGLES).toBe(1_376 - 1_268);
    // The stylised world keeps its simple car, handed Kenney's or not.
    const stylised = new DeliveryBelt('stylised', GEOMETRY);
    expect(triangles(stylised)).toBe(DELIVERY_OBSTACLE_TRIANGLES);
    expect(stylised.meshOf('obstacles').geometry.getAttribute('oylCarPivot')).toBeUndefined();
    const bare = new DeliveryBelt('realistic');
    expect(triangles(bare)).toBe(DELIVERY_OBSTACLE_TRIANGLES);
    realistic.dispose();
    stylised.dispose();
    bare.dispose();
    // The browser gate's frame of twenty obstacles measured 201 356 with the
    // stylised car; every instance submits the roster, so twenty of Kenney's
    // add 20 × 108, and the frame is still under the owner's limit.
    expect(
      201_356 + 20 * (DELIVERY_REALISTIC_OBSTACLE_TRIANGLES - DELIVERY_OBSTACLE_TRIANGLES),
    ).toBeLessThan(DELIVERY_VILLAGE_FRAME_TRIANGLES);
  });

  it('marks each car vertex with its part, its indicator and its pivot, and paints only its paint per instance', () => {
    const belt = new DeliveryBelt('realistic', GEOMETRY);
    const geometry = belt.meshOf('obstacles').geometry;
    const piece = geometry.getAttribute('oylPiece');
    const pivot = geometry.getAttribute('oylCarPivot');
    const glow = geometry.getAttribute('oylGlow');
    const counts = new Map<string, number>();
    for (let at = 0; at < piece.count; at += 1) {
      const key = `${String(piece.getZ(at))}/${String(piece.getW(at))}/${String(piece.getY(at))}/${String(glow.getX(at))}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (piece.getZ(at) >= 2) {
        // A wheel's pivot is a hub: at the wheels' radius, off the middle.
        expect(pivot.getY(at)).toBeCloseTo(GEOMETRY.wheelRadius, 5);
        expect(Math.abs(pivot.getZ(at))).toBeGreaterThan(1);
      }
    }
    // part / lamp / painted / glowing, in vertices: the body, the paint, the
    // two indicators and the wheels; and everything that is not the car.
    expect(Object.fromEntries(counts)).toEqual({
      '1/0/0/0': 570 * 3,
      '1/0/1/0': 134 * 3,
      '1/1/0/1': 4 * 3,
      '1/2/0/1': 4 * 3,
      '2/0/0/0': 2 * 166 * 3,
      '3/0/0/0': 2 * 166 * 3,
      '0/0/0/0': (DELIVERY_REALISTIC_OBSTACLE_TRIANGLES - 1_376 - 24) * 3,
      '0/0/0/1': 24 * 3,
    });
    belt.dispose();
  });

  it('splices the pose into its program before the kind collapse, the normal turned with the vertex', () => {
    const belt = new DeliveryBelt('realistic', GEOMETRY);
    const material = belt.meshOf('obstacles').material as unknown as {
      onBeforeCompile(shader: unknown, renderer: unknown): void;
      customProgramCacheKey(): string;
    };
    const shader = {
      vertexShader: [
        '#include <common>',
        '#include <fog_pars_vertex>',
        'void main() {',
        '#include <beginnormal_vertex>',
        '#include <begin_vertex>',
        '#include <color_vertex>',
        '#include <fog_vertex>',
        '}',
      ].join('\n'),
      fragmentShader: [
        '#include <common>',
        '#include <fog_pars_fragment>',
        'void main() {',
        '#include <opaque_fragment>',
        '#include <fog_fragment>',
        '}',
      ].join('\n'),
      uniforms: {} as Record<string, { value: unknown }>,
      defines: {},
    };
    material.onBeforeCompile(shader, undefined);
    const text = shader.vertexShader;
    expect(text).toContain(DELIVERY_CAR_POSE_GLSL);
    expect(text).toContain('attribute vec4 oylCarPose;');
    const pose = text.indexOf(
      'transformed = oylCarPivot + oylCarTurn( transformed - oylCarPivot, oylPiece.z, oylCarPose );',
    );
    const collapse = text.indexOf(
      'transformed *= 1.0 - step( 0.5, abs( oylPiece.x - oylObstacle.w ) );',
    );
    expect(pose).toBeGreaterThan(text.indexOf('#include <begin_vertex>'));
    expect(collapse).toBeGreaterThan(pose);
    expect(text).toContain('objectNormal = oylCarTurn( objectNormal, oylPiece.z, oylCarPose );');
    expect(text).toContain('vColor.xyz *= oylCarLampLevel( oylPiece.w, oylCarLamps );');
    expect(material.customProgramCacheKey()).toContain('oyl-delivery-car');
    // And a realistic belt with no car of Kenney's is not taught it.
    const bare = new DeliveryBelt('realistic');
    const plain = bare.meshOf('obstacles').material as unknown as typeof material;
    expect(plain.customProgramCacheKey()).not.toContain('oyl-delivery-car');
    belt.dispose();
    bare.dispose();
  });
});

/** WebGL's own floor for `MAX_VERTEX_ATTRIBS`, and what the pinned Chromium, the Mac and tablet Mali GPUs report. */
const WEBGL_VERTEX_ATTRIBUTES = 16;

/** The slots a GLSL attribute of `type` takes. */
const SLOTS: Readonly<Record<string, number>> = { float: 1, vec2: 1, vec3: 1, vec4: 1, mat4: 4 };

/** The attributes three declares itself for these programs and the geometry may carry. */
const THREE_ATTRIBUTES = new Set(['position', 'normal', 'color']);

interface SlotMesh {
  readonly isInstancedMesh?: boolean;
  readonly geometry: { readonly attributes: Record<string, unknown> };
  readonly material: unknown;
}

/**
 * The vertex attribute slots a belt mesh's program uses — PR #2548. Its
 * material's `onBeforeCompile` is run over the chunks it splices, as three
 * runs it, and every `attribute` it declares is read off the text; three's
 * own are what the geometry carries of {@link THREE_ATTRIBUTES} and, for an
 * instanced mesh, `instanceMatrix`'s four. Every attribute a splice
 * declares must be on the geometry, so none is counted that is not bound.
 */
function vertexSlots(mesh: SlotMesh): number {
  const material = mesh.material as {
    onBeforeCompile(shader: unknown, renderer: unknown): void;
  };
  const shader = {
    vertexShader: [
      '#include <common>',
      '#include <fog_pars_vertex>',
      'void main() {',
      '#include <beginnormal_vertex>',
      '#include <begin_vertex>',
      '#include <color_vertex>',
      '#include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <fog_pars_fragment>',
      'void main() {',
      '#include <opaque_fragment>',
      '#include <fog_fragment>',
      '}',
    ].join('\n'),
    uniforms: {} as Record<string, { value: unknown }>,
    defines: {},
  };
  material.onBeforeCompile(shader, undefined);
  const declared = new Map<string, number>();
  for (const [, type, name] of shader.vertexShader.matchAll(/attribute (\w+) (\w+);/g)) {
    const slots = SLOTS[type as string];
    if (slots === undefined) throw new Error(`no slot count for ${String(type)}`);
    declared.set(name as string, slots);
  }
  const carried = Object.keys(mesh.geometry.attributes);
  for (const name of declared.keys()) expect(carried, `${name} declared`).toContain(name);
  let slots = mesh.isInstancedMesh === true ? 4 : 0;
  // One the geometry carries and no splice declares is read by nothing, so it takes no slot.
  for (const name of carried) slots += THREE_ATTRIBUTES.has(name) ? 1 : (declared.get(name) ?? 0);
  return slots;
}

describe('the belt’s programs fit WebGL’s vertex attributes — PR #2548', () => {
  it(`uses at most ${String(DELIVERY_MOST_VERTEX_ATTRIBUTES)} of WebGL’s ${String(WEBGL_VERTEX_ATTRIBUTES)} slots in every program, Kenney’s car’s obstacles at 13`, () => {
    const realistic = new DeliveryBelt('realistic', GEOMETRY);
    const counted: Record<string, number> = {};
    for (const [name, belt] of [
      ['realistic, Kenney’s car', realistic],
      ['realistic, no car', new DeliveryBelt('realistic')],
      ['stylised', new DeliveryBelt('stylised', GEOMETRY)],
    ] as const) {
      for (const shading of ['lit', 'flat'] as const) {
        belt.setShading(shading);
        for (const what of ['parcels', 'markers', 'obstacles'] as const) {
          counted[`${name} ${shading} ${what}`] = vertexSlots(belt.meshOf(what));
        }
      }
      belt.dispose();
    }
    for (const [program, slots] of Object.entries(counted)) {
      expect(slots, program).toBeLessThanOrEqual(DELIVERY_MOST_VERTEX_ATTRIBUTES);
    }
    expect(DELIVERY_MOST_VERTEX_ATTRIBUTES).toBeLessThan(WEBGL_VERTEX_ATTRIBUTES);
    // Measured: the instance matrix's 4, position, normal, colour and glow,
    // the piece and the pivot, and the instance's obstacle, pose and indicators.
    expect(counted['realistic, Kenney’s car lit obstacles']).toBe(13);
    expect(counted['realistic, no car lit obstacles']).toBe(10);
    expect(counted['realistic, Kenney’s car lit markers']).toBe(8);
  });
});

describe('a car’s pose — #2540', () => {
  it('leaves a parked car still: no roll, no steer, no lean and no indicator', () => {
    const [parked] = drawnPoses([carAt(0)]);
    expect(parked).toEqual({ roll: 0, steer: 0, pitch: 0, lean: 0, left: 0, right: 0 });
    expect(deliveryCarPose(undefined, GEOMETRY)).toEqual(parked);
  });

  it('rolls its wheels through the distance it moves, so they turn with its speed', () => {
    // A quarter of a second at each speed: short of a whole turn at the fastest.
    const seconds = 0.25;
    const poses = drawnPoses(
      [1, 2, 4].map((speed) =>
        carAt(0, { ...MOVING, speedMetresPerSecond: speed, travelledMetres: speed * seconds }),
      ),
    );
    const rolls = poses.map((pose) => pose?.roll ?? Number.NaN);
    expect(rolls[0]).toBeCloseTo(0.25 / GEOMETRY.wheelRadius, 5);
    // Twice the speed, twice the turn in the same second.
    expect(rolls[1]).toBeCloseTo(2 * (rolls[0] as number), 5);
    expect(rolls[2]).toBeCloseTo(4 * (rolls[0] as number), 5);
    // Kept within a turn, so a long ride does not lose the float's precision.
    const far = deliveryCarPose({ ...MOVING, travelledMetres: 10_000 }, GEOMETRY);
    expect(far.roll).toBeGreaterThanOrEqual(0);
    expect(far.roll).toBeLessThan(2 * Math.PI);
  });

  it('steers its front wheels as a car pulling out does, to full lock and no further, and leans its body out of the turn', () => {
    const [pulling, past] = drawnPoses([
      carAt(0, { ...MOVING, steerRadians: 0.35 }),
      carAt(10, { ...MOVING, steerRadians: 1.2 }),
    ]);
    expect(pulling?.steer).toBeCloseTo(0.35, 6);
    expect(past?.steer).toBeCloseTo(MOST_STEER_RADIANS, 6);
    // Turning left at 1.5 m/s, the body leans its left side up, a little.
    expect(pulling?.lean).toBeGreaterThan(0);
    expect(pulling?.lean).toBeLessThan(MOST_LEAN_RADIANS);
    const right = deliveryCarPose(
      { ...MOVING, speedMetresPerSecond: 12, steerRadians: -0.5 },
      GEOMETRY,
    );
    expect(right.lean).toBeCloseTo(-MOST_LEAN_RADIANS, 6);
  });

  it('dips its nose as it brakes', () => {
    expect(deliveryCarPose({ ...MOVING, braking: 1 }, GEOMETRY).pitch).toBeCloseTo(
      BRAKING_DIP_RADIANS,
      9,
    );
    expect(deliveryCarPose({ ...MOVING, braking: 0.5 }, GEOMETRY).pitch).toBeCloseTo(
      BRAKING_DIP_RADIANS / 2,
      9,
    );
    expect(deliveryCarPose({ ...MOVING, braking: 3 }, GEOMETRY).pitch).toBeCloseTo(
      BRAKING_DIP_RADIANS,
      9,
    );
  });

  it('flashes the indicator it is given, 1.5 times a second, and only that one', () => {
    const period = 1 / INDICATOR_FLASHES_PER_SECOND;
    const times = [0, 0.25 * period, 0.6 * period, 0.9 * period, 1.1 * period, 1.7 * period];
    const poses = drawnPoses(
      times.map((seconds, at) =>
        carAt(10 * at, { ...MOVING, indicator: 'right', indicatorSeconds: seconds }),
      ),
    );
    expect(poses.map((pose) => pose?.right)).toEqual([1, 1, 0, 0, 1, 0]);
    expect(poses.every((pose) => pose?.left === 0)).toBe(true);
    expect(times.map(indicatorLit)).toEqual([1, 1, 0, 0, 1, 0]);
    // Steady where no time is given: the reduced-motion frame's.
    expect(deliveryCarPose({ ...MOVING, indicator: 'left' }, GEOMETRY)).toMatchObject({
      left: 1,
      right: 0,
    });
    expect(deliveryCarPose(MOVING, GEOMETRY)).toMatchObject({ left: 0, right: 0 });
  });

  it('poses only the car: a bin beside it is handed nothing', () => {
    const belt = new DeliveryBelt('realistic', GEOMETRY);
    belt.update({
      parcels: [],
      markers: [],
      obstacles: [
        { x: 0, y: 0, z: 0, yaw: 0, kind: 'bin' },
        carAt(5, { ...MOVING, travelledMetres: 2 }),
      ],
    });
    const [bin, car] = belt.drawn('obstacles');
    expect(bin?.pose).toBeUndefined();
    expect(car?.pose?.roll).toBeGreaterThan(0);
    // As uploaded: the bin's instance at rest, the car's rolled.
    const poses = belt.meshOf('obstacles').geometry.getAttribute('oylCarPose');
    expect([poses.getX(0), poses.getY(0), poses.getZ(0), poses.getW(0)]).toEqual([0, 0, 0, 0]);
    expect(poses.getX(1)).toBeCloseTo(2 / GEOMETRY.wheelRadius, 5);
    belt.dispose();
  });
});

describe('the pose’s shader text, run — #2540', () => {
  const program = new GlslProgram(DELIVERY_CAR_POSE_GLSL);
  const turn = (v: readonly number[], part: number, pose: readonly number[]): number[] =>
    program.call('oylCarTurn', v, part, pose) as number[];

  it('rolls a wheel forward about its axle: its top moves toward the nose', () => {
    const [x, y, z] = turn([0, 0.3, 0], 2, [0.4, 0, 0, 0]);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0.3 * Math.cos(0.4), 9);
    expect(z).toBeCloseTo(0.3 * Math.sin(0.4), 9);
    // A back wheel rolls the same, and the axle itself does not move.
    expect(turn([0, 0.3, 0], 3, [0.4, 0, 0, 0])).toEqual(turn([0, 0.3, 0], 2, [0.4, 0, 0, 0]));
    expect(turn([0.1, 0, 0], 2, [0.4, 0, 0, 0])).toEqual([0.1, 0, 0]);
  });

  it('steers a front wheel to the car’s left for a positive steer, and never a back wheel', () => {
    const [x, , z] = turn([0, 0, 0.3], 2, [0, 0.35, 0, 0]);
    expect(x).toBeCloseTo(0.3 * Math.sin(0.35), 9);
    expect(z).toBeCloseTo(0.3 * Math.cos(0.35), 9);
    expect(turn([0, 0, 0.3], 3, [0, 0.35, 0, 0])).toEqual([0, 0, 0.3]);
  });

  it('dips the body’s nose and leans its left side up, and moves nothing that is not the car', () => {
    const [, nose] = turn([0, 0, 2], 1, [0, 0, BRAKING_DIP_RADIANS, 0]);
    expect(nose).toBeLessThan(0);
    const [, left] = turn([0.9, 0, 0], 1, [0, 0, 0, 0.03]);
    expect(left).toBeGreaterThan(0);
    // The body takes no roll or steer: those are the wheels'.
    expect(turn([0, 0, 2], 1, [1, 0.5, 0, 0])).toEqual([0, 0, 2]);
    expect(turn([0.3, 0.8, -1.2], 0, [1, 0.5, 0.03, 0.03])).toEqual([0.3, 0.8, -1.2]);
  });

  it('draws an indicator bright while lit and dark while not, and leaves every other vertex as it is', () => {
    expect(program.call('oylCarLampLevel', 0, [0, 0])).toBe(1);
    // PR #2548: lit past its own amber, for the AgX tone mapping; off a dark lens.
    expect(program.call('oylCarLampLevel', 1, [1, 0])).toBeCloseTo(1.25, 9);
    expect(program.call('oylCarLampLevel', 1, [0, 1])).toBeCloseTo(0.08, 9);
    expect(program.call('oylCarLampLevel', 2, [0, 1])).toBeCloseTo(1.25, 9);
    expect(program.call('oylCarLampLevel', 2, [1, 0])).toBeCloseTo(0.08, 9);
  });
});
