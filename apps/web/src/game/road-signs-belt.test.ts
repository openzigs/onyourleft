// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road signs' belt — #3279 (`three-renderer.ts` §`RoadSignBelt`): one
 * instanced mesh, each sign's cells in its instance attributes, and the
 * shader's own text run on the CPU to say which texel of the atlas each part
 * of a sign reads.
 */

import { describe, expect, it } from 'vitest';

import { GlslProgram } from './glsl-program-testing';
import {
  BACK_CELLS,
  BLANK_CELL,
  DIGIT_CELLS,
  FACE_CELLS,
  METAL_CELL,
  PERCENT_CELL,
  SIGN_ATLAS_CELLS,
} from './road-sign-atlas';
import { SIGNS_PER_FRAME, type RoadSign } from './road-signs';
import {
  RoadSignBelt,
  roadSignGeometry,
  SIGN_CELL_GLSL,
  SIGN_NUMERALS_ATTRIBUTE,
  SIGN_PART_ATTRIBUTE,
  SIGN_PLATE_ATTRIBUTE,
  SIGN_SHIFT_GLSL,
} from './three-renderer';

/**
 * A stand-in for the loaded atlas: the belt only hands it to the material.
 *
 * ⚠️ Not `new Texture()` from `three`: `three-seam.test.ts` allows exactly one
 * file to import the rendering library, and a test is not that file.
 */
const ATLAS = { isTexture: true, name: 'the signs’ atlas' } as unknown as ConstructorParameters<
  typeof RoadSignBelt
>[0];

const climb: RoadSign = {
  kind: 'climb',
  face: 'climb',
  x: -4.7,
  y: 1.5,
  z: 491,
  rotation: Math.PI,
  along: 490,
  side: 1,
  percent: 8,
};
const chevron: RoadSign = {
  kind: 'chevron',
  face: 'chevron-right',
  x: 3,
  y: 47.75,
  z: 1_720,
  rotation: 2.4,
  along: 1_720,
  side: -1,
};

/** The part each vertex is, counted. */
function partsOf(): Map<number, number> {
  const geometry = roadSignGeometry();
  const parts = geometry.getAttribute(SIGN_PART_ATTRIBUTE);
  const counts = new Map<number, number>();
  for (let at = 0; at < parts.count; at += 1) {
    counts.set(parts.getX(at), (counts.get(parts.getX(at)) ?? 0) + 1);
  }
  geometry.dispose();
  return counts;
}

describe('one sign’s geometry — #3279', () => {
  it('is a post, a plate’s face and back and three numerals: 18 triangles', () => {
    const geometry = roadSignGeometry();
    expect(geometry.getAttribute('position').count / 3).toBe(18);
    geometry.dispose();
    // Two triangles a quad: the face, the back, each numeral; eight the post's sides.
    expect(partsOf()).toEqual(
      new Map([
        [0, 6],
        [1, 6],
        [2, 6],
        [3, 6],
        [4, 6],
        [5, 24],
      ]),
    );
  });
});

describe('the belt — #3279', () => {
  it('draws every sign as one instance of one mesh, its cells in its instance attributes', () => {
    const belt = new RoadSignBelt(ATLAS);
    belt.update([climb, chevron]);
    const mesh = belt.mesh;
    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(2);
    const plates = mesh.geometry.getAttribute(SIGN_PLATE_ATTRIBUTE);
    const numerals = mesh.geometry.getAttribute(SIGN_NUMERALS_ATTRIBUTE);
    // The climb: its triangle, the triangle's back, "8 %" moved half a numeral right.
    expect([plates.getX(0), plates.getY(0)]).toEqual([FACE_CELLS.climb, BACK_CELLS.triangle]);
    expect([numerals.getX(0), numerals.getY(0), numerals.getZ(0), numerals.getW(0)]).toEqual([
      DIGIT_CELLS[8],
      PERCENT_CELL,
      BLANK_CELL,
      0.5,
    ]);
    // The chevron: its board, a rectangle's back, and no numerals.
    expect([plates.getX(1), plates.getY(1)]).toEqual([
      FACE_CELLS['chevron-right'],
      BACK_CELLS.rectangle,
    ]);
    expect([numerals.getX(1), numerals.getY(1), numerals.getZ(1)]).toEqual([
      BLANK_CELL,
      BLANK_CELL,
      BLANK_CELL,
    ]);
    // Stood at its post, turned to face the rider: its z axis is its face.
    const m = mesh.instanceMatrix.array;
    expect([m[12], m[13], m[14]]).toEqual([
      Math.fround(climb.x),
      Math.fround(climb.y),
      Math.fround(climb.z),
    ]);
    expect(m[8]).toBeCloseTo(Math.sin(climb.rotation), 6);
    expect(m[10]).toBeCloseTo(Math.cos(climb.rotation), 6);
    // A frame with none hides the mesh: no call.
    belt.update([]);
    expect(mesh.visible).toBe(false);
    expect(mesh.count).toBe(0);
    belt.dispose();
  });

  it('draws no more than its room, and none while hidden', () => {
    const belt = new RoadSignBelt(ATLAS);
    belt.update(Array.from({ length: SIGNS_PER_FRAME + 5 }, () => chevron));
    expect(belt.mesh.count).toBe(SIGNS_PER_FRAME);
    belt.setShown(false);
    belt.update([climb]);
    expect(belt.mesh.visible).toBe(false);
    expect(belt.mesh.count).toBe(0);
    belt.dispose();
  });

  it('splices its cells into the material’s vertex shader', () => {
    const belt = new RoadSignBelt(ATLAS);
    const material = belt.mesh.material as unknown as {
      onBeforeCompile: (shader: unknown, renderer: unknown) => void;
      customProgramCacheKey(): string;
      alphaTest: number;
    };
    // The plates and numerals are cut out by the atlas's alpha.
    expect(material.alphaTest).toBe(0.5);
    const shader = {
      uniforms: {},
      vertexShader:
        '#include <common>\n#include <uv_vertex>\n#include <begin_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material.onBeforeCompile(shader, undefined);
    expect(shader.vertexShader).toContain(`attribute vec4 ${SIGN_NUMERALS_ATTRIBUTE};`);
    expect(shader.vertexShader.indexOf(SIGN_CELL_GLSL)).toBeGreaterThan(
      shader.vertexShader.indexOf('#include <uv_vertex>'),
    );
    expect(shader.vertexShader.indexOf(SIGN_SHIFT_GLSL)).toBeGreaterThan(
      shader.vertexShader.indexOf('#include <begin_vertex>'),
    );
    expect(material.customProgramCacheKey()).toContain('oyl-road-signs');
    belt.dispose();
  });

  it('reads, for each part, its own cell of the atlas — the shader’s own text, run', () => {
    // `oylSignNumerals` is a vec4 on the GPU; its first three are all the
    // cell rule reads, so it is handed here as a vec3.
    const program = new GlslProgram(
      `vec2 cellUv(float ${SIGN_PART_ATTRIBUTE}, vec2 ${SIGN_PLATE_ATTRIBUTE}, vec3 ${SIGN_NUMERALS_ATTRIBUTE}, vec2 uv) { vec2 vMapUv = vec2(0.0); ${SIGN_CELL_GLSL} return vMapUv; }`,
    );
    const plate = [FACE_CELLS.summit, BACK_CELLS.rectangle];
    const numerals = [DIGIT_CELLS[1] as number, DIGIT_CELLS[2] as number, PERCENT_CELL];
    const corner = (cell: number) => [
      (cell % SIGN_ATLAS_CELLS) / SIGN_ATLAS_CELLS,
      Math.floor(cell / SIGN_ATLAS_CELLS) / SIGN_ATLAS_CELLS,
    ];
    // Each part's top-left texture coordinate is its cell's top-left corner.
    const cells = [
      FACE_CELLS.summit,
      BACK_CELLS.rectangle,
      DIGIT_CELLS[1] as number,
      DIGIT_CELLS[2] as number,
      PERCENT_CELL,
      METAL_CELL,
    ];
    cells.forEach((cell, part) => {
      expect(program.call('cellUv', part, plate, numerals, [0, 0]), String(part)).toEqual(
        corner(cell),
      );
    });
    // A plate's far corner is two cells on: it is two by two.
    const far = corner(FACE_CELLS.summit + SIGN_ATLAS_CELLS + 1);
    expect(program.call('cellUv', 0, plate, numerals, [2, 2])).toEqual([
      (far[0] as number) + 1 / SIGN_ATLAS_CELLS,
      (far[1] as number) + 1 / SIGN_ATLAS_CELLS,
    ]);
  });
});
