// SPDX-License-Identifier: AGPL-3.0-or-later

import { distanceOnRoute } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { circuitRoute, northRoute } from './route-fixtures-testing';
import {
  CARRIAGEWAY_HALF_METRES,
  DUST_LIGHTEN,
  MAXIMUM_ROAD_PATCHES,
  MAXIMUM_WEAR_SHARE,
  PATCH_CELL_METRES,
  PATCH_TONE,
  ROAD_PATCH_FLOATS,
  SURFACE_WEAR_ALLOWANCE,
  UNWORN_ROAD_CONTRAST,
  WHEEL_TRACK_LIGHTEN,
  WHEEL_TRACK_OFFSETS_METRES,
  WORN_ROAD_CONTRAST_FLOOR,
  patchInCell,
  roadPatchUniforms,
  writeRoadAcross,
} from './road-wear';
import { COLUMN_OFFSETS, ROAD_COLUMNS, corridorOrigin, roadCorridor } from './terrain';
import { photographicRoadMaterial } from './three-renderer';

describe('the road’s wear — #628', () => {
  it('cannot spend more of the gradient cue than the measured 3.889 : 1 down to 3.5 : 1', () => {
    // The worst the colour terms' 1 ± w and the surface's allowance 1 ± a do
    // together: the climb lightened by both, the descent darkened by both.
    const w = MAXIMUM_WEAR_SHARE;
    const a = SURFACE_WEAR_ALLOWANCE;
    const worst = (UNWORN_ROAD_CONTRAST * (1 - w) * (1 - a)) / ((1 + w) * (1 + a));
    expect(worst).toBeGreaterThanOrEqual(WORN_ROAD_CONTRAST_FLOOR);
    expect(worst).toBeCloseTo(3.519, 3);
    // The starting point is the browser gate's own read-back with the wear
    // off (3.889 on this tree, #879's review), not the 3.97 read before #626 —
    // from which the old 0.06 clamp's worst case was 3.449, under the floor.
    expect(UNWORN_ROAD_CONTRAST).toBe(3.889);
    expect((UNWORN_ROAD_CONTRAST * (1 - 0.06)) / (1 + 0.06)).toBeLessThan(WORN_ROAD_CONTRAST_FLOOR);
    // And no single term is already past the clamp on its own.
    for (const term of [WHEEL_TRACK_LIGHTEN, DUST_LIGHTEN, ...PATCH_TONE.map(Math.abs)]) {
      expect(term).toBeLessThanOrEqual(MAXIMUM_WEAR_SHARE);
    }
  });

  it('puts every wheel track inside the carriageway, one pair a lane', () => {
    expect(WHEEL_TRACK_OFFSETS_METRES).toHaveLength(4);
    for (const offset of WHEEL_TRACK_OFFSETS_METRES) {
      expect(Math.abs(offset)).toBeLessThan(CARRIAGEWAY_HALF_METRES);
    }
    expect(WHEEL_TRACK_OFFSETS_METRES.filter((offset) => offset > 0)).toHaveLength(2);
  });

  it('draws a patch from its cell alone: the same patch every time, inside the carriageway and its cell', () => {
    let patches = 0;
    for (let cell = 0; cell < 400; cell += 1) {
      const patch = patchInCell(cell);
      expect(patchInCell(cell)).toEqual(patch);
      if (patch === undefined) continue;
      patches += 1;
      expect(Math.abs(patch.across) + patch.width / 2).toBeLessThanOrEqual(
        CARRIAGEWAY_HALF_METRES + 1e-9,
      );
      expect(Math.floor(patch.distance / PATCH_CELL_METRES)).toBe(cell);
      expect(patch.tone).toBeGreaterThanOrEqual(PATCH_TONE[0]);
      expect(patch.tone).toBeLessThanOrEqual(PATCH_TONE[1]);
    }
    // Some cells have one and some do not: a road patched everywhere is not worn.
    expect(patches).toBeGreaterThan(100);
    expect(patches).toBeLessThan(300);
  });

  it('lays a patch where the road is, and leaves it there as the rider rides on', () => {
    const route = northRoute(3_000, () => 0);
    const origin = corridorOrigin(route);
    const read = (distance: number): Map<string, number[]> => {
      const into = new Float32Array(MAXIMUM_ROAD_PATCHES * ROAD_PATCH_FLOATS);
      const count = roadPatchUniforms(roadCorridor(route, origin, distance), into);
      const found = new Map<string, number[]>();
      for (let at = 0; at < count; at += 1) {
        const values = Array.from(into.slice(at * ROAD_PATCH_FLOATS, (at + 1) * ROAD_PATCH_FLOATS));
        found.set(`${values[1]?.toFixed(3) ?? ''}`, values);
      }
      return found;
    };
    const early = read(1_000);
    const later = read(1_040);
    expect(early.size).toBeGreaterThan(0);
    let shared = 0;
    for (const [key, values] of early) {
      const same = later.get(key);
      if (same === undefined) continue;
      shared += 1;
      expect(same.map((v) => v.toFixed(4))).toEqual(values.map((v) => v.toFixed(4)));
    }
    expect(shared).toBeGreaterThan(0);
    // On a road due north the patch's `z` is its route distance and its `x`
    // is minus its offset across (the road's normal, its right, is `−x`).
    for (const values of early.values()) {
      const [x = 0, z = 0, ux = 0, uz = 0] = values;
      expect(ux).toBeCloseTo(0, 5);
      expect(uz).toBeCloseTo(1, 5);
      const cell = Math.floor(z / PATCH_CELL_METRES);
      const patch = patchInCell(cell);
      expect(patch).toBeDefined();
      // Within the projection's own scale against the route's distances
      // (a tenth of a percent at this latitude), not a cell away.
      expect(Math.abs(z - (patch?.distance ?? Number.NaN))).toBeLessThan(
        (patch?.distance ?? 0) * 0.002,
      );
      expect(x).toBeCloseTo(-(patch?.across ?? Number.NaN), 2);
    }
  });

  it('lays lap two’s patches where lap one’s were, on a loop', () => {
    const route = circuitRoute(200);
    const origin = corridorOrigin(route);
    const read = (distance: number): number[] => {
      const into = new Float32Array(MAXIMUM_ROAD_PATCHES * ROAD_PATCH_FLOATS);
      roadPatchUniforms(roadCorridor(route, origin, distance), into);
      return Array.from(into).map((value) => Number(value.toFixed(3)));
    };
    const lap = route.totalDistance as number;
    expect(distanceOnRoute(route, 300 + lap)).toBeCloseTo(300, 6);
    expect(read(300 + lap)).toEqual(read(300));
  });

  it('writes each surface vertex’s offset across the road, and nought for the marks', () => {
    const route = northRoute(2_000, () => 0);
    const corridor = roadCorridor(route, corridorOrigin(route), 500);
    const into = new Float32Array(corridor.vertices.length / 3).fill(99);
    writeRoadAcross(corridor, into);
    const surface = corridor.centre.length * ROAD_COLUMNS;
    for (let vertex = 0; vertex < surface; vertex += 1) {
      expect(into[vertex]).toBe(Math.fround(COLUMN_OFFSETS[vertex % ROAD_COLUMNS] as number));
      // And that IS how far across the vertex is: the road runs due north, so
      // its right is −x.
      const x = corridor.vertices[vertex * 3] as number;
      const centre = corridor.centre[Math.floor(vertex / ROAD_COLUMNS)];
      expect(-(x - (centre?.x ?? 0))).toBeCloseTo(into[vertex] as number, 4);
    }
    expect(Array.from(into.slice(surface)).every((value) => value === 0)).toBe(true);
  });

  it('clamps every wear term together in the shader the road is drawn with', () => {
    // No texture is needed to compile the text, and this suite may not name
    // three (`three-seam.test.ts`); the includes are the ones the road's
    // injections replace.
    const noTexture = {} as Parameters<typeof photographicRoadMaterial>[0];
    const material = photographicRoadMaterial(noTexture, noTexture);
    const shader = {
      vertexShader: [
        '#include <common>',
        '#include <fog_pars_vertex>',
        'void main() {',
        '#include <uv_vertex>',
        '#include <fog_vertex>',
        '}',
      ].join('\n'),
      fragmentShader: [
        '#include <common>',
        '#include <fog_pars_fragment>',
        'void main() {',
        '#include <map_fragment>',
        '#include <color_fragment>',
        '#include <roughnessmap_fragment>',
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_maps>',
        '#include <lights_physical_fragment>',
        '#include <fog_fragment>',
        '}',
      ].join('\n'),
      uniforms: {} as Record<string, { value: unknown }>,
      defines: {},
    };
    (material.onBeforeCompile as (s: typeof shader) => void)(shader);
    expect(shader.fragmentShader).toContain(
      `clamp(oylWorn, -${String(MAXIMUM_WEAR_SHARE)}, ${String(MAXIMUM_WEAR_SHARE)})`,
    );
    expect(shader.vertexShader).toContain('attribute float oylAcross;');
    // The wear is on in the product, and the patches array is the one the
    // view writes into.
    expect(shader.uniforms['roadWear']?.value).toBe(1);
    expect((shader.uniforms['roadPatches']?.value as Float32Array).length).toBe(
      MAXIMUM_ROAD_PATCHES * ROAD_PATCH_FLOATS,
    );
    material.dispose();
  });
});
