// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic world's lamp posts and gantry barriers are Poly Haven's — #1274.
 *
 * `street_lamp_01` and `concrete_road_barrier`, cut down and coloured a vertex
 * at a time by `tools/realistic/blender/process_roadside_model.py`, are handed
 * here to the belts that draw them — read off the COMMITTED files by
 * `realistic-bytes-testing.ts` §`roadsideFacts`, which shares no code with the
 * renderer — and held to what the owner's ruling of 2026-11-04 asked: drawn
 * in the realistic world only, inside the draw calls their stylised shapes
 * already make, at the place `streets.ts` and `gantry.ts` already give them.
 * That the product's own loader hands the belts these same triangles is
 * `realistic-textures.test.ts` §"#1274", which loads the committed files.
 *
 * ⚠️ **No `three` is imported here**, for `three-seam.test.ts`.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BARRIER_HEIGHT_METRES,
  BARRIER_LENGTH_METRES,
  BARRIER_OFFSET_METRES,
  BARRIER_THICKNESS_METRES,
  boxPoint,
  standBoxes,
  type PlacedStand,
} from './gantry';
import {
  BULB_METRES,
  HOLIDAY_DECORATIONS,
  onRealisticLampPosts,
  REALISTIC_POST_FROM,
  REALISTIC_POST_TO,
  type DecorationKind,
} from './decorations';
import { GlslProgram } from './glsl-program-testing';
import { LITTER_CAPACITY, LITTER_KINDS } from './litter';
import { REALISTIC_ROADSIDE_MODELS } from './realistic-assets';
import { REALISTIC_STREET_TRIANGLES } from './realistic-budget';
import { roadsideFacts, type RoadsideFacts } from './realistic-bytes-testing';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import {
  DOOR_PATH_TRIANGLES_PER_VILLAGE,
  FURNITURE_DRAW_METRES,
  FURNITURE_KINDS,
  FURNITURE_SURFACES,
  LAMP_SETBACK_METRES,
  PAVEMENT_TRIANGLES_PER_VILLAGE,
  PAVEMENT_WIDTH_METRES,
  streetsAt,
  type FurnitureItem,
  type VillageStreet,
} from './streets';
import { corridorOrigin, ROAD_WIDTH_METRES } from './terrain';
import { CAMERA_TARGET_AHEAD_METRES } from './camera';
import { litterOf, type LitterItem } from './litter';
import type { CameraPose } from './port';
import { REALISTIC_CHAIN_LINK } from './realistic-assets';
import { chainLinkFacts } from './realistic-bytes-testing';
import type { ScatterItem } from './scatter';
import {
  CHAIN_LINK_CUT_GLSL,
  CHAIN_LINK_FOLD_GLSL,
  CHAIN_LINK_PART_ATTRIBUTE,
  CHAIN_LINK_SHAPE_ATTRIBUTE,
  CHAIN_LINK_SINK_METRES,
  chainLinkFenceGeometry,
  drawsChainLink,
  RealisticStructureBelts,
  realisticStructureGeometry,
} from './three-renderer';
import {
  FURNITURE_CAPACITY,
  FurnitureBelt,
  GANTRY_FOLD_GLSL,
  GANTRY_PART_ATTRIBUTE,
  GANTRY_SHAPE_ATTRIBUTE,
  GantryBelt,
  gantryBarrierAcross,
  roadsideGeometryOf,
} from './three-renderer';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));
const lamp: RoadsideFacts = roadsideFacts(join(SHIPPED, REALISTIC_ROADSIDE_MODELS.lamp));
const barrier: RoadsideFacts = roadsideFacts(join(SHIPPED, REALISTIC_ROADSIDE_MODELS.barrier));
const bag: RoadsideFacts = roadsideFacts(join(SHIPPED, REALISTIC_ROADSIDE_MODELS.bag));
const tyre: RoadsideFacts = roadsideFacts(join(SHIPPED, REALISTIC_ROADSIDE_MODELS.tyre));

/** A texture three would have loaded: the fields a material and a release read. */
function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

const planks = { colour: aTexture(), normal: aTexture() };

/** A belt geometry's triangles, indexed or not. */
function trianglesOf(geometry: {
  readonly index: { readonly count: number } | null;
  getAttribute(name: string): { readonly count: number };
}): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

/** The model's extent along one of its own axes. */
function extent(facts: RoadsideFacts, axis: 0 | 1 | 2): number {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let at = axis; at < facts.position.length; at += 3) {
    low = Math.min(low, facts.position[at] as number);
    high = Math.max(high, facts.position[at] as number);
  }
  return high - low;
}

describe('the realistic lamp post is Poly Haven’s street lamp — #1274', () => {
  const farmland = northRoute(6_000, () => 40);
  const streets = streetsAt(
    farmland,
    corridorOrigin(farmland),
    scatterSeed(farmland),
    0,
    farmland.totalDistance,
  );
  const first = (streets[0] as VillageStreet).furniture[0] as FurnitureItem;
  const near = { x: first.x, z: first.z };

  it('stands the committed lamp, its own triangles and colours, where a lamp post stands', () => {
    const belt = new FurnitureBelt('realistic', planks, lamp);
    const shape = belt.shapeOf('lamp-post');
    expect(trianglesOf(shape)).toBe(lamp.triangles);
    // Non-vacuity: Poly Haven's lamp, not the 88 the stylised post is built from.
    expect(lamp.triangles).toBeGreaterThan(200);
    const position = shape.getAttribute('position');
    const colour = shape.getAttribute('color');
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      for (const [axis, get] of [
        [0, 'getX'],
        [1, 'getY'],
        [2, 'getZ'],
      ] as const) {
        expect(position[get](vertex), `${String(vertex)}.${String(axis)}`).toBeCloseTo(
          lamp.position[vertex * 3 + axis] as number,
          5,
        );
        expect(colour[get](vertex), `${String(vertex)}.${String(axis)}`).toBeCloseTo(
          lamp.colour[vertex * 3 + axis] as number,
          5,
        );
      }
    }
    // A cast-iron post: dark, as the photograph is, and not the white the
    // painted material leaves a shape with no colour of its own.
    const mean = [0, 1, 2].map(
      (axis) =>
        Array.from(lamp.colour)
          .filter((_, at) => at % 3 === axis)
          .reduce((sum, value) => sum + value, 0) /
        (lamp.colour.length / 3),
    );
    for (const channel of mean) expect(channel).toBeLessThan(0.2);
    belt.dispose();
  });

  it('merges it into the painted mesh with the bollards and bins: the same two calls', () => {
    const belt = new FurnitureBelt('realistic', planks, lamp);
    const added: unknown[] = [];
    belt.addTo({ add: (object: unknown) => added.push(object) } as never);
    expect(added).toEqual(FURNITURE_SURFACES.map((surface) => belt.meshOf(surface)));
    expect(FURNITURE_SURFACES).toHaveLength(2);
    // Every shape of the painted surface carries the same attributes, or
    // the merge would drop or misread one (`furnitureSurfaceGeometry`).
    const names = (kind: 'lamp-post' | 'bollard' | 'bin'): string[] =>
      Object.keys(belt.shapeOf(kind).attributes).sort();
    expect(names('lamp-post')).toEqual(names('bollard'));
    expect(names('lamp-post')).toEqual(names('bin'));
    belt.update(streets, near);
    const lampsInReach = streets
      .flatMap((street) => street.furniture)
      .filter(
        (item) =>
          item.kind === 'lamp-post' &&
          Math.hypot(item.x - near.x, item.z - near.z) <= FURNITURE_DRAW_METRES,
      ).length;
    expect(lampsInReach).toBeGreaterThan(1);
    expect(belt.drawnOf('lamp-post')).toBe(lampsInReach);
    const painted = belt.meshOf('painted');
    const expected = (['lamp-post', 'bollard', 'bin'] as const).reduce(
      (sum, kind) => sum + belt.drawnOf(kind) * trianglesOf(belt.shapeOf(kind)),
      0,
    );
    expect(trianglesOf(painted.geometry)).toBe(expected);
    expect(Array.isArray(painted.material)).toBe(false);
    expect((painted.material as unknown as { vertexColors: boolean }).vertexColors).toBe(true);
    belt.dispose();
  });

  it('keeps the stylised world’s own lamp post, whatever it is handed', () => {
    const stylised = new FurnitureBelt('stylised', undefined, lamp);
    const procedural = new FurnitureBelt('realistic', planks);
    const own = new FurnitureBelt('stylised');
    expect(trianglesOf(stylised.shapeOf('lamp-post'))).toBe(trianglesOf(own.shapeOf('lamp-post')));
    expect(trianglesOf(own.shapeOf('lamp-post'))).toBe(88);
    // And a realistic world loaded with no model (a test's) draws the shape it always did.
    expect(trianglesOf(procedural.shapeOf('lamp-post'))).toBe(88);
    for (const belt of [stylised, procedural, own]) belt.dispose();
  });

  it('holds the streets inside their stated triangles in each world', () => {
    const realistic = new FurnitureBelt('realistic', planks, lamp, { bag, tyre });
    const stylised = new FurnitureBelt('stylised');
    const streetsOf = (belt: FurnitureBelt): number =>
      2 * (PAVEMENT_TRIANGLES_PER_VILLAGE + DOOR_PATH_TRIANGLES_PER_VILLAGE) +
      FURNITURE_KINDS.reduce(
        (sum, kind) => sum + FURNITURE_CAPACITY * trianglesOf(belt.shapeOf(kind)),
        0,
      ) +
      // The owner's ruling of 2026-11-05: the litter, at its capacity and the heavier model.
      LITTER_CAPACITY *
        Math.max(
          0,
          ...LITTER_KINDS.map((kind) => {
            const shape = belt.litterShapeOf(kind);
            return shape === undefined ? 0 : trianglesOf(shape);
          }),
        );
    expect(streetsOf(realistic)).toBe(REALISTIC_STREET_TRIANGLES);
    // The stylised street is #1536's, unmoved.
    expect(streetsOf(stylised)).toBe(25_024);
    realistic.dispose();
    stylised.dispose();
  });

  it('stands on the pavement it is placed on, short of the kerb and of the back edge', () => {
    const belt = new FurnitureBelt('realistic', planks, lamp);
    const geometry = belt.shapeOf('lamp-post');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const fromKerb = PAVEMENT_WIDTH_METRES - LAMP_SETBACK_METRES;
    // +z is towards the road.
    expect(box?.max.z ?? Infinity).toBeLessThan(fromKerb);
    expect(-(box?.min.z ?? -Infinity)).toBeLessThan(PAVEMENT_WIDTH_METRES - fromKerb);
    expect(box?.min.y ?? -1).toBeCloseTo(0, 4);
    // Poly Haven's height, unscaled: 3.87 m.
    expect(box?.max.y ?? 0).toBeCloseTo(3.87, 1);
    belt.dispose();
  });
});

describe('the winter lights wind the realistic lamp’s shaft — #1274', () => {
  const postLights = (kinds: readonly DecorationKind[] | undefined): DecorationKind => {
    const found = kinds?.find((kind) => kind.item === 'post-lights');
    if (found === undefined) throw new Error('no post lights');
    return found;
  };
  const realistic = onRealisticLampPosts(HOLIDAY_DECORATIONS);

  /**
   * How far the committed lamp reaches out from its axis at `height`: the
   * furthest point of any triangle the plane at that height cuts.
   */
  function reachAt(height: number): number {
    let reach = 0;
    const p = lamp.position;
    for (let first = 0; first < p.length; first += 9) {
      for (const [a, b] of [
        [0, 3],
        [3, 6],
        [6, 0],
      ] as const) {
        const ya = p[first + a + 1] as number;
        const yb = p[first + b + 1] as number;
        if ((ya - height) * (yb - height) > 0 || ya === yb) continue;
        const share = (height - ya) / (yb - ya);
        const x =
          (p[first + a] as number) + share * ((p[first + b] as number) - (p[first + a] as number));
        const z =
          (p[first + a + 2] as number) +
          share * ((p[first + b + 2] as number) - (p[first + a + 2] as number));
        reach = Math.max(reach, Math.hypot(x, z));
      }
    }
    return reach;
  }

  it('winds every bulb clear of the lamp, round its shaft and under its ladder bar', () => {
    const bulbs = postLights(realistic['winter-lights']).parts;
    expect(bulbs).toHaveLength(12);
    for (const bulb of bulbs) {
      const [x, y, z] = bulb.at;
      const out = Math.hypot(x, z);
      // The bulb's whole height clears the lamp: nothing of it reaches the
      // bulb's inner face, and something of it — the shaft — is there to wind.
      for (const height of [y - BULB_METRES / 2, y, y + BULB_METRES / 2]) {
        const reach = reachAt(height);
        expect(reach, `at ${height.toFixed(2)} m`).toBeLessThan(out - BULB_METRES / 2);
        expect(reach, `at ${height.toFixed(2)} m`).toBeGreaterThan(0.02);
      }
    }
    // The first and the last where the constants put them.
    expect(bulbs[0]?.at[1] ?? 0).toBeCloseTo(REALISTIC_POST_FROM, 5);
    expect(bulbs.at(-1)?.at[1] ?? 0).toBeCloseTo(REALISTIC_POST_TO, 5);
  });

  it('CONTROL: the stylised winding would cut through the lamp, and float over it', () => {
    const bulbs = postLights(HOLIDAY_DECORATIONS['winter-lights']).parts;
    const tops = bulbs.map((bulb) => bulb.at[1]);
    // Above the lamp's 3.87 m: in the air.
    expect(Math.max(...tops)).toBeGreaterThan(extent(lamp, 1));
    // And somewhere on the way, through the lamp's bar or lantern.
    expect(
      bulbs.some(
        (bulb) => reachAt(bulb.at[1]) >= Math.hypot(bulb.at[0], bulb.at[2]) - BULB_METRES / 2,
      ),
    ).toBe(true);
  });

  it('changes nothing else of any holiday, and is the same table for the same table', () => {
    expect(onRealisticLampPosts(HOLIDAY_DECORATIONS)).toBe(realistic);
    for (const [holiday, kinds] of Object.entries(HOLIDAY_DECORATIONS)) {
      const fitted = realistic[holiday as keyof typeof realistic] ?? [];
      expect(
        fitted.map((kind) => kind.item),
        holiday,
      ).toEqual(kinds.map((kind) => kind.item));
      kinds.forEach((kind, at) => {
        if (kind.item === 'post-lights') {
          expect(fitted[at]?.parts, holiday).not.toEqual(kind.parts);
          expect({ ...fitted[at], parts: [], radius: 0 }).toEqual({
            ...kind,
            parts: [],
            radius: 0,
          });
          // Its footprint holds every bulb, as the stylised one holds its own.
          for (const part of fitted[at]?.parts ?? []) {
            expect(Math.hypot(part.at[0], part.at[2]) + BULB_METRES / 2).toBeLessThanOrEqual(
              (fitted[at]?.radius ?? 0) + 1e-9,
            );
          }
        } else {
          expect(fitted[at], `${holiday} ${kind.item}`).toBe(kind);
        }
      });
    }
  });
});

describe('the realistic gantry’s barriers are Poly Haven’s barrier, in the same two calls — #1274', () => {
  const heading = { headingX: 0.6, headingZ: 0.8 };
  const line: PlacedStand = {
    stand: { kind: 'gantry', distance: 0, text: 'START' },
    x: 10,
    y: 2,
    z: -5,
    ...heading,
    // Each box on the road at its own distance, as `linesNear` stands it.
    boxes: standBoxes('gantry').map((box) => ({
      box,
      x: 10 + heading.headingX * box.along,
      y: 2,
      z: -5 + heading.headingZ * box.along,
      ...heading,
    })),
  };
  const barriers = standBoxes('gantry').filter((box) => box.role === 'barrier').length;

  it('draws the boxes and the barrier as one instanced mesh, and the banners as the other', () => {
    const belt = new GantryBelt(undefined, 'realistic', barrier);
    const added: unknown[] = [];
    belt.addTo({ add: (object: unknown) => added.push(object) } as never);
    expect(added).toEqual([belt.meshes.boxes, belt.meshes.banners]);
    const geometry = belt.meshes.boxes.geometry;
    // The unit box's twelve and the barrier's own, every instance.
    expect(trianglesOf(geometry)).toBe(12 + barrier.triangles);
    const part = geometry.getAttribute(GANTRY_PART_ATTRIBUTE);
    expect(part.count).toBe(36 + barrier.triangles * 3);
    for (let vertex = 0; vertex < part.count; vertex += 1) {
      expect(part.getX(vertex), String(vertex)).toBe(vertex < 36 ? 0 : 1);
    }
    belt.update([line]);
    const shapes = geometry.getAttribute(GANTRY_SHAPE_ATTRIBUTE);
    const mesh = belt.meshes.boxes;
    expect(mesh.count).toBe(line.boxes.length);
    expect(barriers).toBe(32);
    line.boxes.forEach((placed, slot) => {
      expect(shapes.getX(slot), String(slot)).toBe(placed.box.role === 'barrier' ? 1 : 0);
      const colour = Array.from(mesh.instanceColor?.array.slice(slot * 3, slot * 3 + 3) ?? []);
      // The barrier wears its own vertices' colour; a leg or the beam its metal.
      if (placed.box.role === 'barrier') expect(colour, String(slot)).toEqual([1, 1, 1]);
      else expect(colour, String(slot)).not.toEqual([1, 1, 1]);
    });
    belt.dispose();
  });

  it('stands each barrier on the road, its face to the road where the stylised box’s is, the piece’s length long', () => {
    const belt = new GantryBelt(undefined, 'realistic', barrier);
    belt.update([line]);
    const mesh = belt.meshes.boxes;
    const position = mesh.geometry.getAttribute('position');
    const right = { x: -heading.headingZ, z: heading.headingX };
    const half = ROAD_WIDTH_METRES / 2;
    let checked = 0;
    line.boxes.forEach((placed, slot) => {
      if (placed.box.role !== 'barrier') return;
      const m = Array.from(mesh.instanceMatrix.array.slice(slot * 16, slot * 16 + 16));
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      let bottom = Number.POSITIVE_INFINITY;
      let top = Number.NEGATIVE_INFINITY;
      let first = Number.POSITIVE_INFINITY;
      let last = Number.NEGATIVE_INFINITY;
      for (let vertex = 36; vertex < position.count; vertex += 1) {
        const [x, y, z] = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
        const wx =
          (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
        const wy =
          (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
        const wz =
          (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
        const across = (wx - line.x) * right.x + (wz - line.z) * right.z;
        const along = (wx - line.x) * heading.headingX + (wz - line.z) * heading.headingZ;
        low = Math.min(low, across);
        high = Math.max(high, across);
        bottom = Math.min(bottom, wy);
        top = Math.max(top, wy);
        first = Math.min(first, along);
        last = Math.max(last, along);
      }
      const side = Math.sign(placed.box.across);
      const inner = side > 0 ? low : -high;
      // Its face to the road where the stylised box's is: 0.31 m off the edge.
      expect(inner, String(slot)).toBeCloseTo(
        half + BARRIER_OFFSET_METRES - BARRIER_THICKNESS_METRES / 2,
        3,
      );
      // Its own thickness, all of the rest out on the verge.
      expect(high - low, String(slot)).toBeCloseTo(extent(barrier, 2), 3);
      // On the road's surface, its own height, under the stylised box's.
      expect(bottom, String(slot)).toBeCloseTo(line.y, 3);
      expect(top - bottom, String(slot)).toBeCloseTo(extent(barrier, 1), 3);
      expect(top - bottom).toBeLessThan(BARRIER_HEIGHT_METRES);
      // The piece's length along the road, about its own place.
      expect(last - first, String(slot)).toBeCloseTo(placed.box.depth, 3);
      expect((first + last) / 2, String(slot)).toBeCloseTo(placed.box.along, 3);
      checked += 1;
    });
    expect(checked).toBe(barriers);
    // Non-vacuity: it IS stretched — Poly Haven's barrier is shorter than a piece.
    expect(extent(barrier, 0)).toBeLessThan(BARRIER_LENGTH_METRES * 0.96);
    expect(gantryBarrierAcross(5, 0.08, 0.67)).toBeCloseTo(5.295, 6);
    expect(gantryBarrierAcross(-5, 0.08, 0.67)).toBeCloseTo(-5.295, 6);
    belt.dispose();
  });

  it('folds away, in the vertex shader, the shape an instance is not', () => {
    const belt = new GantryBelt(undefined, 'realistic', barrier);
    const material = belt.meshes.boxes.material as unknown as {
      onBeforeCompile: (shader: unknown, renderer: unknown) => void;
      customProgramCacheKey(): string;
      vertexColors: boolean;
    };
    expect(material.vertexColors).toBe(true);
    const shader = {
      uniforms: {},
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material.onBeforeCompile(shader, undefined);
    expect(shader.vertexShader).toContain(`attribute float ${GANTRY_PART_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`attribute float ${GANTRY_SHAPE_ATTRIBUTE};`);
    expect(shader.vertexShader.indexOf(GANTRY_FOLD_GLSL)).toBeGreaterThan(
      shader.vertexShader.indexOf('#include <begin_vertex>'),
    );
    expect(material.customProgramCacheKey()).toContain('oyl-gantry-fold');
    // The rule itself, run: a vertex of the instance's own shape is kept, and
    // the other shape's every vertex goes to one point.
    const program = new GlslProgram(
      `vec3 fold(float ${GANTRY_PART_ATTRIBUTE}, float ${GANTRY_SHAPE_ATTRIBUTE}, vec3 transformed) { ${GANTRY_FOLD_GLSL} return transformed; }`,
    );
    const at = [0.3, 0.8, -1.2];
    expect(program.call('fold', 0, 0, at)).toEqual(at);
    expect(program.call('fold', 1, 1, at)).toEqual(at);
    expect(program.call('fold', 1, 0, at)).toEqual([0, 0, 0]);
    expect(program.call('fold', 0, 1, at)).toEqual([0, 0, 0]);
    belt.dispose();
  });

  it('CONTROL: the stylised gantry, handed the same barrier, is the unit box it always was', () => {
    const belt = new GantryBelt(undefined, 'stylised', barrier);
    const geometry = belt.meshes.boxes.geometry;
    expect(trianglesOf(geometry)).toBe(12);
    expect(geometry.getAttribute(GANTRY_PART_ATTRIBUTE)).toBeUndefined();
    belt.update([line]);
    // Its barrier pieces are its white boxes, at the box's own size.
    const mesh = belt.meshes.boxes;
    const slot = line.boxes.findIndex((placed) => placed.box.role === 'barrier');
    const placed = line.boxes[slot];
    if (placed === undefined) throw new Error('a gantry with no barrier');
    const m = Array.from(mesh.instanceMatrix.array.slice(slot * 16, slot * 16 + 16));
    expect(Math.hypot(m[0] as number, m[2] as number)).toBeCloseTo(BARRIER_THICKNESS_METRES, 5);
    expect(m[13]).toBeCloseTo(boxPoint(placed, placed.box.across, placed.box.up).y, 5);
    belt.dispose();
    // And a realistic world loaded with no model draws the boxes too.
    const bare = new GantryBelt(undefined, 'realistic');
    expect(trianglesOf(bare.meshes.boxes.geometry)).toBe(12);
    bare.dispose();
  });
});

describe('reading a roadside model out of the loader’s scene — #1274', () => {
  it('copies one coloured mesh’s triangles, unindexed, and refuses a scene with none', () => {
    const source = new FurnitureBelt('stylised').shapeOf('bin');
    const scene = {
      traverse: (visit: (node: unknown) => void): void => {
        visit({ isMesh: false });
        visit({ isMesh: true, geometry: source });
      },
    };
    const copied = roadsideGeometryOf(scene as never);
    expect(copied?.triangles).toBe(trianglesOf(source));
    expect(copied?.position).toEqual(Float32Array.from(source.getAttribute('position').array));
    expect(copied?.colour).toEqual(Float32Array.from(source.getAttribute('color').array));
    // A copy, so the loader's scene can go.
    expect(copied?.position.buffer).not.toBe(source.getAttribute('position').array.buffer);
    const bare = { traverse: (visit: (node: unknown) => void): void => visit({ isMesh: false }) };
    expect(roadsideGeometryOf(bare as never)).toBeUndefined();
  });
});

describe('a village’s litter is Poly Haven’s, in the painted mesh — #1274, the ruling of 2026-11-05', () => {
  const route = northRoute(6_000, () => 40);
  const streets = streetsAt(
    route,
    corridorOrigin(route),
    scatterSeed(route),
    0,
    route.totalDistance,
  );
  const litter = { bag, tyre };
  /** A street with litter, and its first piece. */
  const littered = streets.find((street) => litterOf(street).length > 0) as VillageStreet;
  const piece = litterOf(littered)[0] as LitterItem;

  it('lays it in the painted mesh beside the anchor it was placed from: still two meshes', () => {
    const belt = new FurnitureBelt('realistic', planks, lamp, litter);
    const added: unknown[] = [];
    belt.addTo({ add: (object: unknown) => added.push(object) } as never);
    expect(added).toHaveLength(FURNITURE_SURFACES.length);
    belt.update(streets, { x: piece.x, z: piece.z });
    const drawn = belt.litterDrawnOf('bag') + belt.litterDrawnOf('tyre');
    // Non-vacuity: this village has litter, and the frame draws it.
    expect(drawn).toBeGreaterThan(0);
    const painted = belt.meshOf('painted');
    const furniture = (['lamp-post', 'bollard', 'bin'] as const).reduce(
      (sum, kind) => sum + belt.drawnOf(kind) * trianglesOf(belt.shapeOf(kind)),
      0,
    );
    const pieces = LITTER_KINDS.reduce(
      (sum, kind) =>
        sum + belt.litterDrawnOf(kind) * trianglesOf(belt.litterShapeOf(kind) as never),
      0,
    );
    expect(trianglesOf(painted.geometry)).toBe(furniture + pieces);
    expect(pieces).toBeGreaterThan(0);
    belt.dispose();
  });

  it('draws a piece only on a frame that draws its anchor, so it never draws the painted mesh alone', () => {
    const belt = new FurnitureBelt('realistic', planks, lamp, litter);
    // The camera further out along the line from the anchor through the piece:
    // the piece is in reach and its anchor just past it.
    const dx = piece.x - piece.anchor.x;
    const dz = piece.z - piece.anchor.z;
    const length = Math.hypot(dx, dz);
    const beyond = (metres: number): { x: number; z: number } => ({
      x: piece.anchor.x + (dx / length) * metres,
      z: piece.anchor.z + (dz / length) * metres,
    });
    const reach = (camera: { x: number; z: number }, x: number, z: number): boolean =>
      Math.hypot(x - camera.x, z - camera.z) <= FURNITURE_DRAW_METRES;
    const drawnAt = (camera: { x: number; z: number }): number => {
      belt.update([littered], camera);
      return belt.litterDrawnOf('bag') + belt.litterDrawnOf('tyre');
    };
    const out = beyond(FURNITURE_DRAW_METRES + length / 2);
    // The piece is in reach and its anchor is not.
    expect(reach(out, piece.x, piece.z)).toBe(true);
    expect(reach(out, piece.anchor.x, piece.anchor.z)).toBe(false);
    const pieces = litterOf(littered);
    const byAnchor = (camera: { x: number; z: number }): number =>
      pieces.filter((each) => reach(camera, each.anchor.x, each.anchor.z)).length;
    const byPlace = (camera: { x: number; z: number }): number =>
      pieces.filter((each) => reach(camera, each.x, each.z)).length;
    // What is drawn is what has its anchor drawn, which leaves this piece out.
    expect(drawnAt(out)).toBe(byAnchor(out));
    expect(byPlace(out)).toBe(byAnchor(out) + 1);
    const back = beyond(FURNITURE_DRAW_METRES - length / 2);
    expect(drawnAt(back)).toBe(byAnchor(back));
    expect(byAnchor(back)).toBe(byAnchor(out) + 1);
    belt.dispose();
  });

  it('draws no more than its capacity, however many villages are in reach', () => {
    const belt = new FurnitureBelt('realistic', planks, lamp, litter);
    // The littered village, laid again and again in one place: each copy is a
    // street of its own, with this piece's anchor in reach in every one.
    const crowded = Array.from({ length: LITTER_CAPACITY + 1 }, () => ({ ...littered }));
    belt.update(crowded, { x: piece.x, z: piece.z });
    const drawn = LITTER_KINDS.reduce((sum, kind) => sum + belt.litterDrawnOf(kind), 0);
    expect(drawn).toBe(LITTER_CAPACITY);
    belt.dispose();
  });

  it('lays the tyre flat and stands the bag, each the committed model’s triangles and colours', () => {
    const belt = new FurnitureBelt('realistic', planks, lamp, litter);
    const box = (kind: 'bag' | 'tyre'): { min: number[]; max: number[] } => {
      const position = (
        belt.litterShapeOf(kind) as never as {
          getAttribute(name: string): {
            count: number;
            getX(i: number): number;
            getY(i: number): number;
            getZ(i: number): number;
          };
        }
      ).getAttribute('position');
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let at = 0; at < position.count; at += 1) {
        const v = [position.getX(at), position.getY(at), position.getZ(at)];
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis] as number, v[axis] as number);
          max[axis] = Math.max(max[axis] as number, v[axis] as number);
        }
      }
      return { min, max };
    };
    const lying = box('tyre');
    // Flat: as tall as the tyre is deep, its 0.6 m across the ground.
    expect((lying.max[1] as number) - (lying.min[1] as number)).toBeCloseTo(extent(tyre, 2), 3);
    expect((lying.max[2] as number) - (lying.min[2] as number)).toBeCloseTo(extent(tyre, 1), 3);
    expect(lying.min[1]).toBeCloseTo(0, 5);
    const standing = box('bag');
    expect((standing.max[1] as number) - (standing.min[1] as number)).toBeCloseTo(
      extent(bag, 1),
      3,
    );
    expect(trianglesOf(belt.litterShapeOf('bag') as never)).toBe(bag.triangles);
    expect(trianglesOf(belt.litterShapeOf('tyre') as never)).toBe(tyre.triangles);
    // Its own colour: a black bag, not the white the painted mesh leaves a
    // shape with none.
    const colour = (
      belt.litterShapeOf('bag') as never as {
        getAttribute(name: string): { getX(i: number): number };
      }
    ).getAttribute('color');
    expect(colour.getX(0)).toBeCloseTo(bag.colour[0] as number, 5);
    expect(bag.colour[0]).toBeLessThan(0.1);
    belt.dispose();
  });

  it('CONTROL: the stylised world, handed the same litter, lays none', () => {
    const belt = new FurnitureBelt('stylised', undefined, lamp, litter);
    expect(belt.litterShapeOf('bag')).toBeUndefined();
    belt.update(streets, { x: piece.x, z: piece.z });
    expect(belt.litterDrawnOf('bag') + belt.litterDrawnOf('tyre')).toBe(0);
    belt.dispose();
  });
});

describe('the chain-link fence is drawn inside the field fence’s own draw — #1274, the ruling of 2026-11-05', () => {
  const facts = chainLinkFacts(join(SHIPPED, REALISTIC_CHAIN_LINK.model));
  const chainLink = { geometry: facts, wire: aTexture() };
  const POSE: CameraPose = {
    x: 0,
    y: 0,
    z: 0,
    headingX: 0,
    headingZ: 1,
    eyeRoadY: 0,
    targetRoadY: 0,
    targetAheadMetres: CAMERA_TARGET_AHEAD_METRES,
  };
  const fence = (z: number, chain: boolean): ScatterItem => ({
    kind: 'fence',
    x: 8,
    y: 0,
    z,
    rotation: 0,
    scale: 1,
    variant: 0,
    ...(chain ? { chainLink: true as const } : {}),
  });

  it('folds the piece into the field fence’s one shape, each vertex marked with its part', () => {
    const plain = realisticStructureGeometry('fence', 'planks');
    if (plain === undefined) throw new Error('a realistic fence wears planks');
    const folded = chainLinkFenceGeometry(plain, facts);
    const plainVertices = plain.getAttribute('position').count;
    const parts = Array.from(folded.getAttribute(CHAIN_LINK_PART_ATTRIBUTE).array as Float32Array);
    expect(parts.filter((part) => part === 0)).toHaveLength(plainVertices);
    expect(parts.filter((part) => part === 1)).toHaveLength(facts.frame.triangles * 3);
    expect(parts.filter((part) => part === 2)).toHaveLength(facts.wire.triangles * 3);
    // Every attribute the field fence carries, the same size on both shapes.
    expect(Object.keys(folded.attributes).sort()).toEqual(
      [...Object.keys(plain.attributes), CHAIN_LINK_PART_ATTRIBUTE].sort(),
    );
    const position = folded.getAttribute('position');
    // The piece's length along z, as a field boundary's, and set into the ground.
    let zLow = Infinity;
    let zHigh = -Infinity;
    let xLow = Infinity;
    let xHigh = -Infinity;
    let yLow = Infinity;
    for (let at = plainVertices; at < position.count; at += 1) {
      zLow = Math.min(zLow, position.getZ(at));
      zHigh = Math.max(zHigh, position.getZ(at));
      xLow = Math.min(xLow, position.getX(at));
      xHigh = Math.max(xHigh, position.getX(at));
      yLow = Math.min(yLow, position.getY(at));
    }
    expect(zHigh - zLow).toBeCloseTo(extent(facts.frame, 0), 3);
    // Across it, only the posts' own depth: the field fence's line.
    expect(xHigh - xLow).toBeCloseTo(Math.max(extent(facts.frame, 2), extent(facts.wire, 2)), 3);
    expect(xHigh - xLow).toBeLessThan(0.2);
    expect(yLow).toBeCloseTo(
      -CHAIN_LINK_SINK_METRES +
        Math.min(
          ...Array.from(facts.frame.position).filter((_, at) => at % 3 === 1),
          ...Array.from(facts.wire.position).filter((_, at) => at % 3 === 1),
        ),
      4,
    );
    // The wire's coordinates are its own; the frame's colour is its own.
    const uv = folded.getAttribute('uv');
    const firstWire = plainVertices + facts.frame.triangles * 3;
    expect(uv.getX(firstWire)).toBeCloseTo(facts.wire.uv[0] as number, 5);
    expect(uv.getY(firstWire)).toBeCloseTo(facts.wire.uv[1] as number, 5);
    expect(folded.getAttribute('color').getX(plainVertices)).toBeCloseTo(
      facts.frame.colour[0] as number,
      5,
    );
    plain.dispose();
    folded.dispose();
  });

  it('draws both fences in the planks’ ONE fence mesh, each instance its own shape', () => {
    const belts = new RealisticStructureBelts(new Map(), chainLink);
    const plainBelts = new RealisticStructureBelts(new Map());
    const meshes = belts.beltOf('planks')?.meshesOf('fence') ?? [];
    expect(meshes).toHaveLength(1);
    // The same meshes, so the same calls, as a world with no chain-link.
    expect(meshes).toHaveLength(plainBelts.beltOf('planks')?.meshesOf('fence').length ?? -1);
    belts.update([fence(20, false), fence(30, true), fence(40, false)], POSE);
    const mesh = meshes[0] as (typeof meshes)[number];
    expect(mesh.count).toBe(3);
    const shapes = mesh.geometry.getAttribute(CHAIN_LINK_SHAPE_ATTRIBUTE);
    expect([shapes.getX(0), shapes.getX(1), shapes.getX(2)]).toEqual([0, 1, 0]);
    expect(drawsChainLink(mesh.material as never)).toBe(true);
    // Its one shape carries both fences: the chain-link's every vertex is in it.
    const parts = Array.from(
      mesh.geometry.getAttribute(CHAIN_LINK_PART_ATTRIBUTE).array as Float32Array,
    );
    expect(parts.filter((part) => part > 0)).toHaveLength(
      (facts.frame.triangles + facts.wire.triangles) * 3,
    );
    // It shades as every belt does, with its own pair.
    belts.beltOf('planks')?.setShading('flat');
    expect(drawsChainLink(mesh.material as never)).toBe(true);
    belts.dispose();
    plainBelts.dispose();
  });

  it('folds away, in the vertex shader, the fence an instance is not', () => {
    const program = new GlslProgram(
      `vec3 fold(float ${CHAIN_LINK_PART_ATTRIBUTE}, float ${CHAIN_LINK_SHAPE_ATTRIBUTE}, vec3 transformed) { float vOylChain = 0.0; ${CHAIN_LINK_FOLD_GLSL} return transformed; }`,
    );
    const at = [0.3, 0.8, -1.2];
    expect(program.call('fold', 0, 0, at)).toEqual(at);
    expect(program.call('fold', 1, 1, at)).toEqual(at);
    expect(program.call('fold', 2, 1, at)).toEqual(at);
    expect(program.call('fold', 1, 0, at)).toEqual([0, 0, 0]);
    expect(program.call('fold', 2, 0, at)).toEqual([0, 0, 0]);
    expect(program.call('fold', 0, 1, at)).toEqual([0, 0, 0]);
  });

  it('cuts the wire out where its opacity says there is none, and keeps the planks and the frame', () => {
    const program = new GlslProgram(CHAIN_LINK_CUT_GLSL);
    // Near, where a texel covers a pixel: a fixed half, whatever the noise.
    expect(program.call('oylChainCut', 0.5, 0.9)).toBe(0.5);
    expect(program.call('oylChainCut', 1, 0.1)).toBe(0.5);
    // Far, where the mipmap's mean is the wire's share: the noise.
    expect(program.call('oylChainCut', 3, 0.1)).toBeCloseTo(0.1, 9);
    expect(program.call('oylChainKeeps', 2, 0.4, 0.5)).toBe(0);
    expect(program.call('oylChainKeeps', 2, 0.6, 0.5)).toBe(1);
    // The planks and the frame are kept whatever the wire's map says there.
    expect(program.call('oylChainKeeps', 0, 0, 0.5)).toBe(1);
    expect(program.call('oylChainKeeps', 1, 0, 0.5)).toBe(1);
  });

  it('CONTROL: with no chain-link, the fence mesh is the field fence alone, untaught', () => {
    const belts = new RealisticStructureBelts(new Map());
    const mesh = belts.beltOf('planks')?.meshesOf('fence')[0];
    if (mesh === undefined) throw new Error('a realistic fence wears planks');
    expect(mesh.geometry.getAttribute(CHAIN_LINK_SHAPE_ATTRIBUTE)).toBeUndefined();
    expect(mesh.geometry.getAttribute(CHAIN_LINK_PART_ATTRIBUTE)).toBeUndefined();
    expect(drawsChainLink(mesh.material as never)).toBe(false);
    // And a chain-link piece is drawn there as the field fence it is placed as.
    belts.update([fence(30, true)], POSE);
    expect(mesh.count).toBe(1);
    belts.dispose();
  });
});
