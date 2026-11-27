// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The parked cars' belt — #3278 (`three-renderer.ts` §`ParkedCarBelt`), built
 * from the COMMITTED cars (`realistic-assets.ts` §`REALISTIC_DELIVERY_CAR`,
 * read off disk by `realistic-bytes-testing.ts`) and read back off the one
 * mesh it fills:
 *
 * - ONE mesh, so one draw call, whatever the cars and whichever bodies;
 * - each car submits its own body's triangles at its own level, and no other
 *   body's — the difference from the Delivery obstacles' roster;
 * - the frame's worst case is `realistic-budget.ts`
 *   §`REALISTIC_PARKED_CAR_TRIANGLES`, exactly;
 * - a car is drawn where the frame says, facing the way it says, inside the
 *   box the planner keeps clear (`parked-cars.ts` §`PARKED_CAR_BOX`), in its
 *   own paint;
 * - the mesh is rebuilt only when the frame's cars are not the last frame's.
 *
 * Nothing here may import three (`three-seam.test.ts`): the loader's scene is
 * made from the file's own nodes, as `delivery-car.test.ts` makes it.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PARKED_CAR_BOX,
  PARKED_CARS_MAX,
  PARKED_CARS_NEAR_MAX,
  parkedCarBody,
  parkedCarPaint,
  type ParkedCar,
  type ParkedCarLevel,
} from './parked-cars';
import { REALISTIC_DELIVERY_CAR, REALISTIC_DELIVERY_CAR_BODIES } from './realistic-assets';
import {
  REALISTIC_PARKED_CAR_DRAW_CALLS,
  REALISTIC_PARKED_CAR_TRIANGLES,
} from './realistic-budget';
import { deliveryCarFacts, type CarNodeFacts } from './realistic-bytes-testing';
import {
  DELIVERY_CAR_ATLAS_GLSL,
  DELIVERY_REALISTIC_OBSTACLE_TRIANGLES,
  PARKED_CAR_PAINT_GLSL,
  PARKED_CAR_PAINTS,
  ParkedCarBelt,
  deliveryCarGeometryOf,
  parkedCarWorstTriangles,
  type DeliveryCarGeometry,
} from './three-renderer';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));
const CAR = deliveryCarFacts(join(SHIPPED, REALISTIC_DELIVERY_CAR));

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

/** The loader's scene, made from the committed file's own nodes. @see delivery-car.test.ts */
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
const WORN: DeliveryCarGeometry = { ...GEOMETRY, atlas: ATLAS };

/** A node's triangles in the committed file. */
function trianglesOf(name: string): number {
  const node = CAR.nodes.find((each) => each.name === name);
  if (node === undefined) throw new Error(`the cars have no ${name}`);
  return node.geometry.position.length / 9;
}

/** A body's triangles at a level, counted off the committed file: its body, and near its four wheels. */
function committed(body: number, level: ParkedCarLevel): number {
  const name = REALISTIC_DELIVERY_CAR_BODIES[body] as string;
  const wheels = ['front-left', 'front-right', 'back-left', 'back-right'].reduce(
    (sum, wheel) => sum + trianglesOf(`${name}-wheel-${wheel}`),
    0,
  );
  return trianglesOf(`${name}-body`) + (level === 'near' ? wheels : 0);
}

/** A hash whose car is drawn as `body`, and in `paint` where one is asked for. */
function lookOf(body: number, paint?: number): number {
  for (let look = 1; look < 100_000; look += 1) {
    if (
      parkedCarBody({ look }, REALISTIC_DELIVERY_CAR_BODIES.length) === body &&
      (paint === undefined || parkedCarPaint({ look }, PARKED_CAR_PAINTS.length) === paint)
    ) {
      return look;
    }
  }
  throw new Error(`no hash is body ${String(body)}`);
}

function car(more: Partial<ParkedCar> = {}): ParkedCar {
  return {
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    pitch: 0,
    spot: 'driveway',
    level: 'near',
    look: lookOf(0),
    ...more,
  };
}

/** The mesh's corners, `x, y, z` each. */
function corners(belt: ParkedCarBelt): readonly (readonly [number, number, number])[] {
  const position = belt.mesh.geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, at) => [
    position.getX(at),
    position.getY(at),
    position.getZ(at),
  ]);
}

/** sRGB hex to the linear channels a material multiplies by. */
function linear(hex: number): readonly [number, number, number] {
  const channel = (value: number): number => {
    const share = value / 255;
    return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  };
  return [channel((hex >> 16) & 0xff), channel((hex >> 8) & 0xff), channel(hex & 0xff)];
}

describe('the parked cars’ belt — #3278', () => {
  it('is one mesh, so one draw call, and hidden until a frame carries a car', () => {
    const belt = new ParkedCarBelt(WORN);
    const added: unknown[] = [];
    belt.addTo({ add: (mesh: unknown) => added.push(mesh) } as never);
    expect(added).toEqual([belt.mesh]);
    expect(added).toHaveLength(REALISTIC_PARKED_CAR_DRAW_CALLS);
    expect(belt.mesh.visible).toBe(false);
    belt.update(undefined);
    expect(belt.mesh.visible).toBe(false);
    belt.update({ cars: [] });
    expect(belt.mesh.visible).toBe(false);
    expect(belt.stats.triangles).toBe(0);
    belt.update({ cars: [car()] });
    expect(belt.mesh.visible).toBe(true);
    // Three bodies and both levels, still the one mesh.
    belt.update({
      cars: [0, 1, 2].flatMap((body) => [
        car({ look: lookOf(body), z: body * 10 }),
        car({ look: lookOf(body), z: body * 10 + 5, level: 'far' }),
      ]),
    });
    expect(belt.stats.cars).toBe(6);
    expect(belt.mesh.visible).toBe(true);
    // A frame with none hides it again.
    belt.update({ cars: [] });
    expect(belt.mesh.visible).toBe(false);
    belt.dispose();
  });

  it('draws each car as its own body’s triangles at its own level, and no other body’s', () => {
    const belt = new ParkedCarBelt(WORN);
    const seen = new Set<number>();
    for (const [body] of REALISTIC_DELIVERY_CAR_BODIES.entries()) {
      for (const level of ['near', 'far'] as const) {
        belt.update({ cars: [car({ look: lookOf(body), level })] });
        expect(belt.stats.triangles, `${String(body)} ${level}`).toBe(committed(body, level));
        expect(belt.mesh.geometry.getAttribute('position').count).toBe(committed(body, level) * 3);
        seen.add(committed(body, level));
        // Never the roster every Delivery obstacle instance submits.
        expect(belt.stats.triangles).toBeLessThan(DELIVERY_REALISTIC_OBSTACLE_TRIANGLES / 3);
      }
      // The far level is the body alone: its four wheels fewer.
      expect(committed(body, 'near') - committed(body, 'far')).toBe(4 * 28);
    }
    // The bodies differ, so a count that matched was that body's and not any body's.
    expect(seen.size).toBe(6);
    // Two cars are the sum of the two, and nothing more.
    belt.update({
      cars: [car({ look: lookOf(0) }), car({ look: lookOf(1), level: 'far', z: 8 })],
    });
    expect(belt.stats).toMatchObject({
      cars: 2,
      near: 1,
      triangles: committed(0, 'near') + committed(1, 'far'),
    });
    for (const name of ['position', 'normal', 'color']) {
      expect(belt.mesh.geometry.getAttribute(name).count).toBe(belt.stats.triangles * 3);
    }
    expect(belt.mesh.geometry.getAttribute('uv').count).toBe(belt.stats.triangles * 3);
    belt.dispose();
  });

  it('holds its worst frame to REALISTIC_PARKED_CAR_TRIANGLES exactly, whatever it is handed', () => {
    const heaviest = (level: ParkedCarLevel): number =>
      Math.max(...REALISTIC_DELIVERY_CAR_BODIES.map((_, body) => committed(body, level)));
    const worst =
      PARKED_CARS_NEAR_MAX * heaviest('near') +
      (PARKED_CARS_MAX - PARKED_CARS_NEAR_MAX) * heaviest('far');
    expect(parkedCarWorstTriangles(GEOMETRY)).toBe(worst);
    expect(worst).toBe(REALISTIC_PARKED_CAR_TRIANGLES);
    // The belt as built, handed the worst a frame may carry: every car the heaviest body.
    const heavy = REALISTIC_DELIVERY_CAR_BODIES.map((_, body) => body).sort(
      (a, b) => committed(b, 'near') - committed(a, 'near'),
    )[0] as number;
    const belt = new ParkedCarBelt(WORN);
    const full = Array.from({ length: PARKED_CARS_MAX }, (_, index) =>
      car({
        look: lookOf(heavy),
        z: index * 6,
        level: index < PARKED_CARS_NEAR_MAX ? 'near' : 'far',
      }),
    );
    belt.update({ cars: full });
    expect(belt.stats).toMatchObject({
      cars: PARKED_CARS_MAX,
      near: PARKED_CARS_NEAR_MAX,
      triangles: REALISTIC_PARKED_CAR_TRIANGLES,
    });
    // More cars than the cap, every one asking for its wheels: still the bound.
    belt.update({
      cars: Array.from({ length: PARKED_CARS_MAX + 20 }, (_, index) =>
        car({ look: lookOf(heavy), z: index * 6 }),
      ),
    });
    expect(belt.stats).toMatchObject({
      cars: PARKED_CARS_MAX,
      near: PARKED_CARS_NEAR_MAX,
      triangles: REALISTIC_PARKED_CAR_TRIANGLES,
    });
    // What the Delivery roster would have cost for the same street.
    expect(PARKED_CARS_MAX * DELIVERY_REALISTIC_OBSTACLE_TRIANGLES).toBeGreaterThan(
      4 * REALISTIC_PARKED_CAR_TRIANGLES,
    );
    belt.dispose();
  });

  it('stands each car where the frame says, facing its heading, inside the planner’s box', () => {
    const belt = new ParkedCarBelt(WORN);
    for (const [body] of REALISTIC_DELIVERY_CAR_BODIES.entries()) {
      for (const heading of [0, Math.PI / 2, 2.3, -1.1]) {
        const placed = car({ x: 40, y: 3, z: -120, heading, look: lookOf(body) });
        belt.update({ cars: [placed] });
        const nose = [Math.sin(heading), Math.cos(heading)] as const;
        let ahead = Number.NEGATIVE_INFINITY;
        let behind = Number.POSITIVE_INFINITY;
        let aside = 0;
        let low = Number.POSITIVE_INFINITY;
        let high = Number.NEGATIVE_INFINITY;
        for (const [x, y, z] of corners(belt)) {
          const along = (x - placed.x) * nose[0] + (z - placed.z) * nose[1];
          ahead = Math.max(ahead, along);
          behind = Math.min(behind, along);
          aside = Math.max(aside, Math.abs((x - placed.x) * nose[1] - (z - placed.z) * nose[0]));
          low = Math.min(low, y);
          high = Math.max(high, y);
        }
        // Inside the box the planner keeps clear of everything, and a real car's length.
        expect(ahead).toBeLessThanOrEqual(PARKED_CAR_BOX.halfLength);
        expect(-behind).toBeLessThanOrEqual(PARKED_CAR_BOX.halfLength);
        expect(aside).toBeLessThanOrEqual(PARKED_CAR_BOX.halfWidth);
        expect(ahead - behind).toBeGreaterThan(4);
        // Its tyres on the ground it was stood on, and its roof a car's height over it.
        expect(low - placed.y).toBeGreaterThanOrEqual(-0.01);
        expect(low - placed.y).toBeLessThan(0.05);
        expect(high - placed.y).toBeGreaterThan(1.3);
        expect(high - placed.y).toBeLessThan(1.8);
      }
    }
    // Which end is the nose: the saloon's bonnet is longer than its boot is behind its back axle,
    // so read it off the wheels' own places instead — the front axle is ahead of the middle.
    const saloon = car({ heading: 0, look: lookOf(0) });
    belt.update({ cars: [saloon] });
    const front = CAR.nodes.find((each) => each.name === 'saloon-wheel-front-left');
    if (front === undefined) throw new Error('the saloon has no front wheel');
    expect(front.translation[2]).toBeGreaterThan(1);
    const turned = car({ heading: Math.PI / 2, look: lookOf(0) });
    belt.update({ cars: [turned] });
    // Turned a quarter, what was along `+z` is along `+x`: the far level drops
    // the wheels, so the wheels' corners are those the near level adds.
    const near = corners(belt);
    belt.update({ cars: [{ ...turned, level: 'far' }] });
    const far = corners(belt);
    const wheels = near.slice(far.length);
    const frontWheels = wheels.filter(([x]) => x > 0);
    const backWheels = wheels.filter(([x]) => x < 0);
    expect(frontWheels.length).toBe(backWheels.length);
    const mean = (points: typeof wheels): number =>
      points.reduce((sum, [x]) => sum + x, 0) / points.length;
    expect(mean(frontWheels)).toBeCloseTo(front.translation[2], 1);
    belt.dispose();
  });

  it('tips a car up the slope it stands on', () => {
    const belt = new ParkedCarBelt(WORN);
    const level = car({ look: lookOf(0), level: 'far' });
    belt.update({ cars: [level] });
    const flat = corners(belt);
    const pitch = 0.1;
    belt.update({ cars: [{ ...level, pitch }] });
    const tipped = corners(belt);
    // A corner ahead of the middle is higher by its distance ahead times the slope, and one behind lower.
    let raised = 0;
    let lowered = 0;
    flat.forEach(([, y, z], at) => {
      const [, tippedY] = tipped[at] as readonly [number, number, number];
      const expected = y * Math.cos(pitch) + z * Math.sin(pitch);
      expect(tippedY).toBeCloseTo(expected, 5);
      if (z > 1) raised += tippedY > y ? 1 : 0;
      if (z < -1) lowered += tippedY < y ? 1 : 0;
    });
    expect(raised).toBeGreaterThan(10);
    expect(lowered).toBeGreaterThan(10);
    belt.dispose();
  });

  it('paints each car its own paint, baked into its corners', () => {
    const belt = new ParkedCarBelt(WORN);
    const body = GEOMETRY.parts.find((part) => part.body === 0 && part.role === 'body');
    if (body === undefined) throw new Error('the saloon has no body');
    const drawn = new Set<string>();
    for (const [paint, hex] of PARKED_CAR_PAINTS.entries()) {
      belt.update({ cars: [car({ look: lookOf(0, paint), level: 'far' })] });
      const colour = belt.mesh.geometry.getAttribute('color');
      const [r, g, b] = linear(hex);
      for (const at of [0, 30, 299, colour.count - 1]) {
        expect(colour.getX(at)).toBeCloseTo((body.colour[at * 3] as number) * r, 5);
        expect(colour.getY(at)).toBeCloseTo((body.colour[at * 3 + 1] as number) * g, 5);
        expect(colour.getZ(at)).toBeCloseTo((body.colour[at * 3 + 2] as number) * b, 5);
      }
      drawn.add(
        `${colour.getX(0).toFixed(4)},${colour.getY(0).toFixed(4)},${colour.getZ(0).toFixed(4)}`,
      );
      // Its atlas coordinates are the body's own, untouched.
      const uv = belt.mesh.geometry.getAttribute('uv');
      expect(uv.getX(7)).toBe(body.uv[14]);
      expect(uv.getY(7)).toBe(body.uv[15]);
    }
    expect(drawn.size).toBe(PARKED_CAR_PAINTS.length);
    belt.dispose();
  });

  it('rebuilds its mesh only when the frame’s cars are not the last frame’s', () => {
    const belt = new ParkedCarBelt(WORN);
    const view = { cars: [car(), car({ z: 9, level: 'far' })] };
    belt.update(view);
    const built = belt.mesh.geometry;
    expect(belt.stats.rebuilds).toBe(1);
    for (let frame = 0; frame < 5; frame += 1) belt.update(view);
    expect(belt.stats.rebuilds).toBe(1);
    expect(belt.mesh.geometry).toBe(built);
    // Another list is another mesh.
    belt.update({ cars: [car({ z: 20 })] });
    expect(belt.stats.rebuilds).toBe(2);
    expect(belt.mesh.geometry).not.toBe(built);
    belt.dispose();
  });

  it('wears the cars’ atlas, its alpha saying where the paint shows, in a program of its own', () => {
    const belt = new ParkedCarBelt(WORN);
    const material = belt.mesh.material as unknown as {
      onBeforeCompile(shader: unknown, renderer: unknown): void;
      customProgramCacheKey(): string;
      map: unknown;
      vertexColors: boolean;
    };
    expect(material.map).toBe(ATLAS);
    expect(material.vertexColors).toBe(true);
    const shader = {
      vertexShader: [
        '#include <common>',
        '#include <fog_pars_vertex>',
        'void main() {',
        '#include <uv_vertex>',
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
    const text = shader.fragmentShader;
    // three's map and colour chunks replaced, in that order, by the atlas's.
    expect(text).not.toContain('#include <map_fragment>');
    expect(text).not.toContain('#include <color_fragment>');
    const read = text.indexOf(DELIVERY_CAR_ATLAS_GLSL);
    const paint = text.indexOf(PARKED_CAR_PAINT_GLSL);
    expect(read).toBeGreaterThan(-1);
    expect(paint).toBeGreaterThan(read);
    expect(PARKED_CAR_PAINT_GLSL).toContain('mix( vec3( 1.0 ), vColor.rgb, oylAtlas.a )');
    expect(material.customProgramCacheKey()).toContain('oyl-parked-car');
    // A three bump that moved either chunk throws, and does not draw unpainted cars.
    const moved = {
      ...shader,
      vertexShader: shader.vertexShader,
      fragmentShader: [
        '#include <common>',
        '#include <fog_pars_fragment>',
        'void main() {',
        '#include <opaque_fragment>',
        '#include <tonemapping_fragment>',
        '#include <fog_fragment>',
        '}',
      ].join('\n'),
    };
    const other = new ParkedCarBelt(WORN);
    expect(() => {
      (other.mesh.material as unknown as typeof material).onBeforeCompile(moved, undefined);
    }).toThrow(/#3278's parked cars' paint/);
    other.dispose();
    belt.dispose();
  });
});
