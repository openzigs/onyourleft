// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2847: Delivery's parked cars in the realistic world are three of GGBotNet's
 * CC0 "PSX Style Cars" — a saloon, a hatchback and a station wagon — made by
 * `tools/realistic/blender/process_vehicle.py` into one GLB and one atlas,
 * drawn inside the obstacles' one instanced call, each car its body by its
 * place on the round, and posed per instance — its wheels rolling with the
 * distance it moves, its front wheels steering, its body pitching and
 * leaning, its indicators flashing — by `three-renderer.ts`
 * §`withDeliveryCarPose`, as #2540's one Kenney sedan was.
 *
 * Read back through the paths a consumer uses: the committed GLB through
 * glTF 2.0's own accessors (`realistic-bytes-testing.ts` §`deliveryCarFacts`)
 * and the atlas's KTX2 header; the belt's roster and its instance buffers,
 * which are what three uploads; and the pose's GLSL, run as the text the belt
 * splices into the shader (`glsl-program-testing.ts`). What jsdom cannot do —
 * draw it, count the frame's triangles and calls — `realistic-delivery.browser.spec.ts`
 * does.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OBSTACLE_KINDS } from './delivery/obstacles';
import { GlslProgram } from './glsl-program-testing';
import type { DeliveryCarMotion, DeliveryObstaclePiece } from './port';
import {
  REALISTIC_DELIVERY_CAR,
  REALISTIC_DELIVERY_CAR_ATLAS,
  REALISTIC_DELIVERY_CAR_BODIES,
} from './realistic-assets';
import {
  DELIVERY_CAR_TRIANGLES,
  DELIVERY_MOST_VERTEX_ATTRIBUTES,
  DELIVERY_VILLAGE_FRAME_TRIANGLES,
} from './realistic-budget';
import { deliveryCarFacts, fileKtx2Facts, type CarNodeFacts } from './realistic-bytes-testing';
import {
  BRAKING_DIP_RADIANS,
  DELIVERY_ATLAS_WHITE_UV,
  DELIVERY_CAR_ATLAS_GLSL,
  DELIVERY_CAR_POSE_GLSL,
  DELIVERY_OBSTACLE_TRIANGLES,
  DELIVERY_REALISTIC_OBSTACLE_TRIANGLES,
  DeliveryBelt,
  INDICATOR_FLASHES_PER_SECOND,
  MOST_LEAN_RADIANS,
  MOST_STEER_RADIANS,
  PARKED_CAR_PAINTS,
  deliveryCarBody,
  deliveryCarBodyVertexDrawn,
  deliveryCarGeometryOf,
  deliveryCarPose,
  deliveryPieceShape,
  indicatorLit,
  type DeliveryCarGeometry,
} from './three-renderer';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));
const CAR = deliveryCarFacts(join(SHIPPED, REALISTIC_DELIVERY_CAR));
const { halfLength, halfWidth } = OBSTACLE_KINDS['parked-car'];

/** A body's seven parts, as its nodes name them after `<body>-`. */
const PARTS = [
  'body',
  'indicator-left',
  'indicator-right',
  'wheel-back-left',
  'wheel-back-right',
  'wheel-front-left',
  'wheel-front-right',
];

/** Each body's triangles in the committed file — its body, four wheels and two indicators of 4. */
const BODY_TRIANGLES = { saloon: 320, hatchback: 456, wagon: 446 } as const;

/** How far past the footprint's side a door mirror may stand, metres — ADR 0085 D-2. */
const MIRROR_PAST_METRES = 0.1;

function node(name: string): CarNodeFacts {
  const found = CAR.nodes.find((each) => each.name === name);
  if (found === undefined) throw new Error(`the cars have no ${name}`);
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
      ...(each.uv.length === 0 ? {} : { uv: attribute(each.uv, 2) }),
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

/** A stand-in for the loaded atlas: the belt only hands it to the material. */
const ATLAS = { isTexture: true, name: 'the cars’ atlas' } as unknown as NonNullable<
  DeliveryCarGeometry['atlas']
>;

/** The cars as the realistic world hands them: with their atlas. */
const WORN: DeliveryCarGeometry = { ...GEOMETRY, atlas: ATLAS };

/** The first place on a round whose car is drawn as `body`. */
function placeOf(body: number): number {
  for (let index = 0; index < 1_000; index += 1) {
    if (deliveryCarBody({ index }, GEOMETRY.bodies.length) === body) return index;
  }
  throw new Error(`no place draws body ${String(body)}`);
}

/** A car standing at `z` on the road, moving as `car` says, if at all, at its place `index`. */
function carAt(z: number, car?: DeliveryCarMotion, index = 0): DeliveryObstaclePiece {
  return { x: 0, y: 0, z, yaw: 0, kind: 'parked-car', index, ...(car ? { car } : {}) };
}

/** A belt drawing the cars, handed `obstacles`; what it drew, read back off its instances. */
function drawnCars(obstacles: readonly DeliveryObstaclePiece[]) {
  const belt = new DeliveryBelt('realistic', WORN);
  belt.update({ parcels: [], markers: [], obstacles });
  const drawn = belt.drawn('obstacles');
  belt.dispose();
  return drawn;
}

function drawnPoses(obstacles: readonly DeliveryObstaclePiece[]) {
  return drawnCars(obstacles).map((each) => each.pose);
}

/** The radius of the wheels of the body a car at place 0 is drawn as. */
const FIRST = GEOMETRY.bodies[
  deliveryCarBody({ index: 0 }, 3)
] as DeliveryCarGeometry['bodies'][number];

const MOVING: DeliveryCarMotion = {
  travelledMetres: 0,
  speedMetresPerSecond: 1.5,
  steerRadians: 0,
  braking: 0,
};

describe('the committed cars, read back off their GLB — #2847', () => {
  it('holds three bodies of seven parts, one level of detail, at the triangles the roster draws', () => {
    expect(CAR.nodes.map((each) => each.name).sort()).toEqual(
      REALISTIC_DELIVERY_CAR_BODIES.flatMap((body) =>
        PARTS.map((part) => `${body}-${part}`),
      ).sort(),
    );
    for (const body of REALISTIC_DELIVERY_CAR_BODIES) {
      const triangles = CAR.nodes
        .filter((each) => each.name.startsWith(`${body}-`))
        .reduce((sum, each) => sum + each.geometry.triangles, 0);
      expect(triangles, body).toBe(BODY_TRIANGLES[body]);
    }
    // Every node's triangles, all three bodies': what each obstacle instance
    // submits. Under the owner's ruling of about 1 450 a car (#2540), for three.
    const triangles = CAR.nodes.reduce((sum, each) => sum + each.geometry.triangles, 0);
    expect(triangles).toBe(1_222);
    expect(triangles).toBeLessThanOrEqual(DELIVERY_CAR_TRIANGLES);
    // One level: no body has a second copy of itself at another detail.
    expect(CAR.nodes.filter((each) => each.name.endsWith('-body'))).toHaveLength(3);
    // No picture and no material: the atlas is its own file, drawn in the obstacles' call.
    expect([CAR.materials, CAR.images, CAR.textures]).toEqual([0, 0, 0]);
    for (const each of CAR.nodes) {
      expect(each.geometry.attributes, each.name).toEqual([
        'COLOR_0',
        'NORMAL',
        'POSITION',
        'TEXCOORD_0',
      ]);
    }
  });

  it('keeps each body’s four wheels apart from it, each node at its hub on the road', () => {
    for (const body of REALISTIC_DELIVERY_CAR_BODIES) {
      const wheels = PARTS.filter((part) => part.startsWith('wheel-')).map((part) =>
        node(`${body}-${part}`),
      );
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
    }
  });

  it('carries an amber indicator on each side of each body, front and back', () => {
    for (const body of REALISTIC_DELIVERY_CAR_BODIES) {
      const length = Math.max(
        ...PARTS.flatMap((part) => placed(node(`${body}-${part}`))).map(([, , z]) => Math.abs(z)),
      );
      for (const side of ['indicator-left', 'indicator-right']) {
        const lamp = node(`${body}-${side}`);
        const points = placed(lamp);
        const name = lamp.name;
        expect(
          points.every(([x]) => Math.sign(x) === (side.endsWith('left') ? 1 : -1)),
          name,
        ).toBe(true);
        expect(
          points.some(([, , z]) => z > length - 0.3),
          name,
        ).toBe(true);
        expect(
          points.some(([, , z]) => z < -(length - 0.3)),
          name,
        ).toBe(true);
        const c = lamp.geometry.colour;
        expect(c[0] as number, name).toBeGreaterThan(c[1] as number);
        expect(c[1] as number, name).toBeGreaterThan(c[2] as number);
      }
    }
  });

  it('stands each body on the road at a real car’s length, inside obstacles.ts’ parked car’s footprint but for its mirrors — ADR 0085 D-2', () => {
    for (const body of REALISTIC_DELIVERY_CAR_BODIES) {
      const points = PARTS.flatMap((part) => placed(node(`${body}-${part}`)));
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const zs = points.map(([, , z]) => z);
      const length = Math.max(...zs) - Math.min(...zs);
      expect(Math.min(...ys), body).toBeCloseTo(0, 3);
      // #2847: "real proportions (about 4.2–4.7 m long)", and no longer than
      // the footprint the rider hits.
      expect(length, body).toBeGreaterThanOrEqual(4.2 - 1e-3);
      expect(length, body).toBeLessThanOrEqual(2 * halfLength + 1e-3);
      // Its proportions are its own, scaled evenly: a car about a third as
      // tall as it is long, not stretched to the box as Kenney's was.
      const height = Math.max(...ys);
      expect(height / length, body).toBeGreaterThan(0.3);
      expect(height / length, body).toBeLessThan(0.4);
      // Its wheels and its body inside the footprint; a door mirror may stand
      // a little past it.
      const wheels = PARTS.filter((part) => part.startsWith('wheel-')).flatMap((part) =>
        placed(node(`${body}-${part}`)),
      );
      expect(Math.max(...wheels.map(([x]) => Math.abs(x))), body).toBeLessThanOrEqual(halfWidth);
      expect(Math.max(...xs.map(Math.abs)), body).toBeLessThanOrEqual(
        halfWidth + MIRROR_PAST_METRES,
      );
      // Centred on the footprint along the road.
      expect((Math.max(...zs) + Math.min(...zs)) / 2, body).toBeCloseTo(0, 3);
    }
  });

  it('draws each body from its own cell of the atlas, and its indicators from the white one', () => {
    REALISTIC_DELIVERY_CAR_BODIES.forEach((body, number) => {
      // Two cells by two, glTF's `v` down: the bodies in order, the white cell last.
      const column = number % 2;
      const row = Math.floor(number / 2);
      for (const part of PARTS) {
        const { uv, name } = node(`${body}-${part}`);
        expect(uv.length, name).toBeGreaterThan(0);
        for (let at = 0; at < uv.length; at += 2) {
          const [u, v] = [uv[at] as number, uv[at + 1] as number];
          if (part.startsWith('indicator-')) {
            expect([u, v], name).toEqual([...DELIVERY_ATLAS_WHITE_UV]);
            continue;
          }
          expect(u, name).toBeGreaterThanOrEqual(column / 2);
          expect(u, name).toBeLessThanOrEqual((column + 1) / 2);
          expect(v, name).toBeGreaterThanOrEqual(row / 2);
          expect(v, name).toBeLessThanOrEqual((row + 1) / 2);
        }
      }
    });
  });

  it('ships one atlas, 256 px square, with the paint in its alpha, in sRGB with its mipmaps', () => {
    expect(fileKtx2Facts(join(SHIPPED, REALISTIC_DELIVERY_CAR_ATLAS))).toEqual({
      width: 256,
      height: 256,
      levels: 9,
      scheme: 'etc1s',
      alpha: true,
      transfer: 'srgb',
    });
  });
});

describe('the cars in Delivery’s belt — #2847', () => {
  it('copies the loader’s scene into seven parts a body, each wheel turning about its own hub', () => {
    expect(GEOMETRY.parts).toHaveLength(21);
    expect(GEOMETRY.bodies.map((body) => body.name)).toEqual([...REALISTIC_DELIVERY_CAR_BODIES]);
    GEOMETRY.bodies.forEach((body, number) => {
      expect(
        GEOMETRY.parts
          .filter((part) => part.body === number)
          .map((part) => part.role)
          .sort(),
        body.name,
      ).toEqual([
        'back-wheel',
        'back-wheel',
        'body',
        'front-wheel',
        'front-wheel',
        'indicator-left',
        'indicator-right',
      ]);
      const front = node(`${body.name}-wheel-front-left`);
      const back = node(`${body.name}-wheel-back-left`);
      expect(body.wheelRadius, body.name).toBeCloseTo(front.translation[1], 5);
      expect(body.wheelbase, body.name).toBeCloseTo(front.translation[2] - back.translation[2], 5);
    });
    // The three are not one car three times: each body's wheels stand where its own do.
    expect(new Set(GEOMETRY.bodies.map((body) => body.wheelbase.toFixed(3))).size).toBe(3);
    expect(GEOMETRY.triangles).toBe(1_222);
    for (const part of GEOMETRY.parts.filter((each) => each.role.endsWith('wheel'))) {
      const xs = Array.from(part.position).filter((_, at) => at % 3 === 0);
      expect(Math.sign(Math.min(...xs))).toBe(Math.sign(Math.max(...xs)));
      expect(Math.sign(xs[0] as number)).toBe(Math.sign(part.pivot[0]));
    }
    // A scene without every part of every body is no cars, and nor is one without coordinates.
    expect(
      deliveryCarGeometryOf(sceneOf(CAR.nodes.filter((each) => each.name !== 'wagon-body'))),
    ).toBeUndefined();
    expect(
      deliveryCarGeometryOf(
        sceneOf(CAR.nodes.map((each) => ({ ...each, uv: new Float32Array(0) }))),
      ),
    ).toBeUndefined();
  });

  it('draws them in place of its own car in the realistic world only, at the roster’s stated triangles', () => {
    const triangles = (belt: DeliveryBelt): number =>
      belt.meshOf('obstacles').geometry.getAttribute('position').count / 3;
    const realistic = new DeliveryBelt('realistic', WORN);
    expect(triangles(realistic)).toBe(DELIVERY_REALISTIC_OBSTACLE_TRIANGLES);
    // The three bodies whole, in place of Kenney's 1 192, which stood in the
    // stylised car's place less the 26 its trim hides and #2506's two quads.
    expect(DELIVERY_REALISTIC_OBSTACLE_TRIANGLES - DELIVERY_OBSTACLE_TRIANGLES).toBe(
      1_222 - (1_172 - 26) - 4,
    );
    // The stylised world keeps its simple car, handed these or not.
    const stylised = new DeliveryBelt('stylised', WORN);
    expect(triangles(stylised)).toBe(DELIVERY_OBSTACLE_TRIANGLES);
    expect(stylised.meshOf('obstacles').geometry.getAttribute('oylCarPivot')).toBeUndefined();
    expect(stylised.meshOf('obstacles').geometry.getAttribute('uv')).toBeUndefined();
    const bare = new DeliveryBelt('realistic');
    expect(triangles(bare)).toBe(DELIVERY_OBSTACLE_TRIANGLES);
    realistic.dispose();
    stylised.dispose();
    bare.dispose();
    // The nightly gate's frame of twenty of each piece measured 202 663 on
    // #2844's branch with Kenney's car (2026-11-19); every instance submits
    // the roster, so the three bodies add twenty times their 30. Measured
    // after: 203 263, under the owner's limit (ADR 0085 D-4).
    expect(202_663 + 20 * (1_222 - 1_192)).toBe(203_263);
    expect(203_263).toBeLessThan(DELIVERY_VILLAGE_FRAME_TRIANGLES);
  });

  it('draws every face of every body that looks down, its underside too — the owner’s ruling of 2026-11-13 on PR #2518', () => {
    // Up a climb a parked car stands above the chase camera's eye, which then
    // sees its underside from in front (delivery-trim.test.ts).
    const downward = (trimmed: boolean): number => {
      const shape = deliveryPieceShape('obstacles', trimmed, WORN);
      const position = shape.getAttribute('position');
      const piece = shape.getAttribute('oylPiece');
      let count = 0;
      for (let at = 0; at < position.count; at += 3) {
        if (piece.getZ(at) === 0) continue;
        const [ax, ay, az] = [position.getX(at), position.getY(at), position.getZ(at)];
        const [ux, uy, uz] = [
          position.getX(at + 1) - ax,
          position.getY(at + 1) - ay,
          position.getZ(at + 1) - az,
        ];
        const [vx, vy, vz] = [
          position.getX(at + 2) - ax,
          position.getY(at + 2) - ay,
          position.getZ(at + 2) - az,
        ];
        const ny = uz * vx - ux * vz;
        if (ny / Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) < -0.99) count += 1;
      }
      return count;
    };
    expect(downward(false)).toBeGreaterThan(0);
    expect(downward(true)).toBe(downward(false));
  });

  it('marks each car vertex with its part, its indicator, its pivot, its body and its atlas coordinate, and paints the whole car per instance', () => {
    const belt = new DeliveryBelt('realistic', WORN);
    const geometry = belt.meshOf('obstacles').geometry;
    const piece = geometry.getAttribute('oylPiece');
    const also = geometry.getAttribute('oylPieceAlso');
    const pivot = geometry.getAttribute('oylCarPivot');
    const glow = geometry.getAttribute('oylGlow');
    const counts = new Map<string, number>();
    for (let at = 0; at < piece.count; at += 1) {
      const key = `${String(pivot.getW(at))}:${String(piece.getZ(at))}/${String(piece.getW(at))}/${String(piece.getY(at))}/${String(glow.getX(at))}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const body = pivot.getW(at);
      if (piece.getZ(at) >= 2) {
        // A wheel's pivot is a hub: at its body's wheels' radius, off the middle.
        const radius = GEOMETRY.bodies[body]?.wheelRadius ?? Number.NaN;
        expect(pivot.getY(at)).toBeCloseTo(radius, 5);
        expect(Math.abs(pivot.getZ(at))).toBeGreaterThan(1);
      }
      // Every vertex that is no car's, and every indicator, samples the white
      // cell; every other car vertex its own body's cell (also.zw, glTF's v down).
      const uv = [also.getZ(at), also.getW(at)];
      if (body < 0 || piece.getW(at) > 0) {
        expect(uv).toEqual([...DELIVERY_ATLAS_WHITE_UV]);
      } else {
        const cell = ((uv[0] as number) < 0.5 ? 0 : 1) + ((uv[1] as number) < 0.5 ? 0 : 2);
        expect(cell, `the cell of body ${String(body)}`).toBe(body);
      }
    }
    const expected: Record<string, number> = {};
    GEOMETRY.bodies.forEach((body, number) => {
      const parts = GEOMETRY.parts.filter((part) => part.body === number);
      const of = (role: string): number =>
        parts
          .filter((part) => part.role === role)
          .reduce((sum, part) => sum + part.position.length / 3, 0);
      // body / part / lamp / painted / glowing, in vertices.
      expected[`${String(number)}:1/0/1/0`] = of('body');
      expected[`${String(number)}:1/1/0/1`] = of('indicator-left');
      expected[`${String(number)}:1/2/0/1`] = of('indicator-right');
      expected[`${String(number)}:2/0/1/0`] = of('front-wheel');
      expected[`${String(number)}:3/0/1/0`] = of('back-wheel');
      expect(of('indicator-left') + of('indicator-right'), body.name).toBe(8 * 3);
    });
    // Everything else: the hazard markers glow, 6 each over #2396's three
    // kinds, #2364's dog and rider and #2506's car pulling out.
    expected['-1:0/0/0/0'] = (DELIVERY_REALISTIC_OBSTACLE_TRIANGLES - 1_222 - 36) * 3;
    expected['-1:0/0/0/1'] = 36 * 3;
    expect(Object.fromEntries(counts)).toEqual(expected);
    belt.dispose();
  });

  it('splices the pose and the body into its program before the kind collapse, and reads the atlas’s alpha as where the paint shows', () => {
    const belt = new DeliveryBelt('realistic', WORN);
    const material = belt.meshOf('obstacles').material as unknown as {
      onBeforeCompile(shader: unknown, renderer: unknown): void;
      customProgramCacheKey(): string;
      map: unknown;
    };
    expect(material.map).toBe(ATLAS);
    const shader = {
      vertexShader: [
        '#include <common>',
        '#include <fog_pars_vertex>',
        'void main() {',
        '#include <uv_vertex>',
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
        '#include <map_fragment>',
        '#include <color_fragment>',
        '#include <opaque_fragment>',
        '#include <tonemapping_fragment>',
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
    expect(text).toContain('attribute vec3 oylCarLamps;');
    expect(text).toContain('attribute vec4 oylCarPivot;');
    // #2847: the atlas read at the piece's packed coordinate, before three's own chunk.
    expect(text).toContain(
      '#ifdef USE_MAP\n#undef MAP_UV\n#define MAP_UV oylPieceAlso.zw\n#endif\n#include <uv_vertex>',
    );
    const pose = text.indexOf(
      'transformed = oylCarPivot.xyz + oylCarTurn( transformed - oylCarPivot.xyz, oylPiece.z, oylCarPose );',
    );
    const body = text.indexOf(
      'transformed *= 1.0 - step( -0.5, oylCarPivot.w ) * step( 0.5, abs( oylCarPivot.w - oylCarLamps.z ) );',
    );
    const collapse = text.indexOf(
      'transformed *= max( 1.0 - step( 0.5, abs( oylPiece.x - oylObstacle.w ) ), 1.0 - step( 0.5, abs( oylPieceAlso.x - oylObstacle.w ) ) );',
    );
    expect(pose).toBeGreaterThan(text.indexOf('#include <begin_vertex>'));
    expect(body).toBeGreaterThan(pose);
    expect(collapse).toBeGreaterThan(body);
    expect(text).toContain('objectNormal = oylCarTurn( objectNormal, oylPiece.z, oylCarPose );');
    expect(text).toContain('vColor.xyz *= oylCarLampLevel( oylPiece.w, oylCarLamps.xy );');
    // The paint mix reads the painted flag (y), not the car part (z): PR #2548 review.
    expect(text).toContain('vColor.xyz = mix( vColor.xyz, oylObstacle.xyz, oylPiece.y );');
    // #2847: three's map and colour chunks replaced, in that order, by the atlas's.
    const fragment = shader.fragmentShader;
    expect(fragment).not.toContain('#include <map_fragment>');
    expect(fragment).not.toContain('#include <color_fragment>');
    const read = fragment.indexOf(DELIVERY_CAR_ATLAS_GLSL);
    const tint = fragment.indexOf(
      'diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, oylAtlas.a );',
    );
    expect(read).toBeGreaterThan(-1);
    expect(tint).toBeGreaterThan(read);
    expect(material.customProgramCacheKey()).toContain('oyl-delivery-car-atlas');
    // And a realistic belt with no car is not taught it, and cars with no atlas read none.
    const bare = new DeliveryBelt('realistic');
    const plain = bare.meshOf('obstacles').material as unknown as typeof material;
    expect(plain.customProgramCacheKey()).not.toContain('oyl-delivery-car');
    const unworn = new DeliveryBelt('realistic', GEOMETRY);
    const unwornMaterial = unworn.meshOf('obstacles').material as unknown as typeof material;
    expect(unwornMaterial.customProgramCacheKey()).toMatch(/oyl-delivery-car$/);
    belt.dispose();
    bare.dispose();
    unworn.dispose();
  });
});

describe('each car’s body, by its place on the round — #2847', () => {
  it('collapses every vertex of a body but the instance’s, as the shader does', () => {
    expect(deliveryCarBodyVertexDrawn(-1, 0)).toBe(true);
    expect(deliveryCarBodyVertexDrawn(-1, 2)).toBe(true);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let instance = 0; instance < 3; instance += 1) {
        expect(deliveryCarBodyVertexDrawn(vertex, instance)).toBe(vertex === instance);
      }
    }
    // So an instance submits all three bodies and draws one: each body's
    // triangles are its own, never another's.
    const belt = new DeliveryBelt('realistic', WORN);
    const geometry = belt.meshOf('obstacles').geometry;
    const pivot = geometry.getAttribute('oylCarPivot');
    for (let instance = 0; instance < 3; instance += 1) {
      let drawn = 0;
      for (let at = 0; at < pivot.count; at += 1) {
        const vertex = pivot.getW(at);
        if (vertex >= 0 && deliveryCarBodyVertexDrawn(vertex, instance)) drawn += 1;
      }
      expect(drawn / 3).toBe(BODY_TRIANGLES[REALISTIC_DELIVERY_CAR_BODIES[instance] ?? 'saloon']);
    }
    belt.dispose();
  });

  it('chooses a car’s body by its place, the same every time, every body on a round and not in step with its paint', () => {
    const places = Array.from({ length: 48 }, (_, index) => index);
    const bodies = places.map((index) => deliveryCarBody({ index }, 3));
    expect(places.map((index) => deliveryCarBody({ index }, 3))).toEqual(bodies);
    expect(new Set(bodies)).toEqual(new Set([0, 1, 2]));
    // Not the place's remainder, which would walk the bodies round in order.
    expect(bodies).not.toEqual(places.map((index) => index % 3));
    // And not in step with the paint (`index % 8`): more than the eight
    // pairs a lock-step would give.
    const looks = new Set(places.map((index) => `${String(bodies[index])}/${String(index % 8)}`));
    expect(looks.size).toBeGreaterThan(PARKED_CAR_PAINTS.length);
    // Every body in [0, count), for any count.
    for (const count of [1, 2, 3]) {
      for (const index of places) {
        const body = deliveryCarBody({ index }, count);
        expect(body).toBeGreaterThanOrEqual(0);
        expect(body).toBeLessThan(count);
      }
    }
  });

  it('writes each car’s body into its instance, and poses it on that body’s wheels', () => {
    const cars = [0, 1, 2].map((body) =>
      carAt(10 * body, { ...MOVING, travelledMetres: 1 }, placeOf(body)),
    );
    const drawn = drawnCars([{ x: 0, y: 0, z: 30, yaw: 0, kind: 'bin' }, ...cars]);
    expect(drawn.map((each) => each.body)).toEqual([undefined, 0, 1, 2]);
    // A wheel rolls through the distance over ITS body's radius.
    drawn.slice(1).forEach((each, body) => {
      expect(each.pose?.roll).toBeCloseTo(1 / (GEOMETRY.bodies[body]?.wheelRadius ?? 1), 5);
    });
    // As uploaded: the instance's body is its lamps' third number.
    const belt = new DeliveryBelt('realistic', WORN);
    belt.update({ parcels: [], markers: [], obstacles: cars });
    const lamps = belt.meshOf('obstacles').geometry.getAttribute('oylCarLamps');
    expect(lamps.itemSize).toBe(3);
    expect([lamps.getZ(0), lamps.getZ(1), lamps.getZ(2)]).toEqual([0, 1, 2]);
    belt.dispose();
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
      '#include <uv_vertex>',
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
      '#include <map_fragment>',
      '#include <color_fragment>',
      '#include <opaque_fragment>',
      '#include <tonemapping_fragment>',
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
  it(`uses at most ${String(DELIVERY_MOST_VERTEX_ATTRIBUTES)} of WebGL’s ${String(WEBGL_VERTEX_ATTRIBUTES)} slots in every program, the cars’ obstacles at 14 — PR #2548, #2847`, () => {
    const realistic = new DeliveryBelt('realistic', WORN);
    const counted: Record<string, number> = {};
    for (const [name, belt] of [
      ['realistic, the cars', realistic],
      ['realistic, no car', new DeliveryBelt('realistic')],
      ['stylised', new DeliveryBelt('stylised', WORN)],
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
    // the piece, its second kind, untoned flag and atlas coordinate (#2506's,
    // #2507's and #2847's, one vec4) and the pivot and body (one vec4), and
    // the instance's obstacle, pose and indicators and body: 14, the ceiling.
    // #2847's atlas costs no slot: three's own `uv` is not on the geometry.
    // The markers carry the kinds since #2365: the matrix, the four, the
    // piece, the vec4 and the instance's obstacle, 11.
    expect(counted['realistic, the cars lit obstacles']).toBe(14);
    expect(counted['realistic, no car lit obstacles']).toBe(11);
    expect(counted['realistic, the cars lit markers']).toBe(11);
    // And none of them binds three's `uv`: the atlas is read through the piece.
    expect(realistic.meshOf('obstacles').geometry.getAttribute('uv')).toBeUndefined();
  });
});

describe('a car’s pose — #2540', () => {
  it('leaves a parked car still: no roll, no steer, no lean and no indicator', () => {
    const [parked] = drawnPoses([carAt(0)]);
    expect(parked).toEqual({ roll: 0, steer: 0, pitch: 0, lean: 0, left: 0, right: 0 });
    expect(deliveryCarPose(undefined, FIRST)).toEqual(parked);
  });

  it('draws a car pulling out as one of the cars with both its indicators lit, and a parked car with neither — #2506 with #2540', () => {
    // #2506's own car lights an amber quad each side of its tail on a car
    // pulling out; in the realistic world the car is one of the PSX cars (#2847;
    // Kenney's from #2540), so its two indicators are lit instead, as the frame
    // gives no motion of its own.
    const pullingOut: DeliveryObstaclePiece = { ...carAt(40), kind: 'car-pulling-out' };
    const [parked, pulling] = drawnPoses([carAt(0), pullingOut]);
    expect(parked).toMatchObject({ left: 0, right: 0 });
    expect(pulling).toMatchObject({ left: 1, right: 1 });
    // And the cars are what a car pulling out's instance draws, as a parked car's does.
    const belt = new DeliveryBelt('realistic', WORN);
    const geometry = belt.meshOf('obstacles').geometry;
    const piece = geometry.getAttribute('oylPiece');
    const also = geometry.getAttribute('oylPieceAlso');
    const carKinds = new Set<number>();
    for (let at = 0; at < piece.count; at += 1) {
      if (piece.getZ(at) >= 1) carKinds.add(also.getX(at));
    }
    expect([...carKinds]).toEqual([Object.keys(OBSTACLE_KINDS).indexOf('car-pulling-out')]);
    belt.dispose();
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
    expect(rolls[0]).toBeCloseTo(0.25 / FIRST.wheelRadius, 5);
    // Twice the speed, twice the turn in the same second.
    expect(rolls[1]).toBeCloseTo(2 * (rolls[0] as number), 5);
    expect(rolls[2]).toBeCloseTo(4 * (rolls[0] as number), 5);
    // Kept within a turn, so a long ride does not lose the float's precision.
    const far = deliveryCarPose({ ...MOVING, travelledMetres: 10_000 }, FIRST);
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
      FIRST,
    );
    expect(right.lean).toBeCloseTo(-MOST_LEAN_RADIANS, 6);
  });

  it('dips its nose as it brakes', () => {
    expect(deliveryCarPose({ ...MOVING, braking: 1 }, FIRST).pitch).toBeCloseTo(
      BRAKING_DIP_RADIANS,
      9,
    );
    expect(deliveryCarPose({ ...MOVING, braking: 0.5 }, FIRST).pitch).toBeCloseTo(
      BRAKING_DIP_RADIANS / 2,
      9,
    );
    expect(deliveryCarPose({ ...MOVING, braking: 3 }, FIRST).pitch).toBeCloseTo(
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
    expect(deliveryCarPose({ ...MOVING, indicator: 'left' }, FIRST)).toMatchObject({
      left: 1,
      right: 0,
    });
    expect(deliveryCarPose(MOVING, FIRST)).toMatchObject({ left: 0, right: 0 });
  });

  it('poses only the car: a bin beside it is handed nothing', () => {
    const belt = new DeliveryBelt('realistic', WORN);
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
    expect(poses.getX(1)).toBeCloseTo(2 / FIRST.wheelRadius, 5);
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
