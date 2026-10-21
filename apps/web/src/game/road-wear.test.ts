// SPDX-License-Identifier: AGPL-3.0-or-later

import { distanceOnRoute } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { bentValleyRoute, circuitRoute, northRoute } from './route-fixtures-testing';
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
  writeRoadPatchReach,
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

  it('builds the road with none of the wear for the owner’s cost lever — #1523', () => {
    const noTexture = {} as Parameters<typeof photographicRoadMaterial>[0];
    const compiled = (worn: boolean) => {
      const material = photographicRoadMaterial(noTexture, noTexture, worn);
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
      const key = material.customProgramCacheKey();
      material.dispose();
      return { shader, key };
    };
    const worn = compiled(true);
    const bare = compiled(false);
    // The control: the product's road holds every part of the wear.
    for (const part of ['roadPatches', 'oylTrackShare', 'oylWorn', 'roughnessFactor *=']) {
      expect(worn.shader.fragmentShader, part).toContain(part);
    }
    expect(worn.shader.vertexShader).toContain('attribute float oylAcross;');
    // Without it: not one of them, in either stage or in the uniforms.
    for (const part of ['roadPatches', 'oylTrackShare', 'oylWorn', 'roughnessFactor *=']) {
      expect(bare.shader.fragmentShader, part).not.toContain(part);
    }
    expect(bare.shader.vertexShader).not.toContain('oylAcross');
    expect(Object.keys(bare.shader.uniforms)).not.toContain('roadPatches');
    expect(Object.keys(bare.shader.uniforms)).not.toContain('roadWear');
    // Still the photographic road: its grain and its sheen are not the wear's.
    expect(bare.shader.fragmentShader).toContain('oylMean');
    expect(bare.shader.fragmentShader).toContain('material.specularF90 *=');
    // And a program of its own: three must not hand one road the other's.
    expect(bare.key).not.toBe(worn.key);
  });
});

describe('which patches can reach each triangle of the road — #1523', () => {
  /** The shader's own patch term at a point: `oylInside` times the tone. */
  const term = (patches: Float32Array, patch: number, x: number, z: number): number => {
    const at = patch * ROAD_PATCH_FLOATS;
    const [px = 0, pz = 0, ux = 0, uz = 0, halfLength = 0, halfWidth = 0, tone = 0] = patches.slice(
      at,
      at + ROAD_PATCH_FLOATS,
    );
    const fromX = x - px;
    const fromZ = z - pz;
    const along = Math.abs(fromX * ux + fromZ * uz);
    const across = Math.abs(fromX * -uz + fromZ * ux);
    const smoothstep = (low: number, high: number, value: number): number => {
      const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
      return t * t * (3 - 2 * t);
    };
    const inside =
      (1 - smoothstep(halfLength - 0.08, halfLength, along)) *
      (1 - smoothstep(halfWidth - 0.08, halfWidth, across));
    return tone * inside * (halfLength > 0.0001 ? 1 : 0);
  };

  /** A corridor, its patches, and their reach — on a straight road or round #543's bend. */
  const reached = (
    distance: number,
    route = northRoute(4_000, (along) => 40 * Math.sin(along / 90)),
  ) => {
    const corridor = roadCorridor(route, corridorOrigin(route), distance);
    const patches = new Float32Array(MAXIMUM_ROAD_PATCHES * ROAD_PATCH_FLOATS);
    const count = roadPatchUniforms(corridor, patches);
    const reach = new Float32Array(corridor.vertices.length / 3).fill(99);
    writeRoadPatchReach(corridor, patches, count, reach);
    return { corridor, patches, count, reach };
  };

  it('names, on every vertex of a triangle, every patch that changes any point of it', () => {
    let checked = 0;
    let touched = 0;
    const bent = bentValleyRoute(60);
    for (const [distance, route] of [
      [600, undefined],
      [1_750, undefined],
      [960, bent],
      [1_000, bent],
      [1_040, bent],
    ] as const) {
      const { corridor, patches, count, reach } = reached(distance, route);
      expect(count).toBeGreaterThan(0);
      const { vertices, indices } = corridor;
      for (let at = 0; at + 2 < indices.length; at += 3) {
        const corners = [indices[at], indices[at + 1], indices[at + 2]] as number[];
        const steps = 12;
        for (let i = 0; i <= steps; i += 1) {
          for (let j = 0; i + j <= steps; j += 1) {
            const weights = [i / steps, j / steps, (steps - i - j) / steps];
            let x = 0;
            let z = 0;
            corners.forEach((corner, k) => {
              x += (weights[k] as number) * (vertices[corner * 3] as number);
              z += (weights[k] as number) * (vertices[corner * 3 + 2] as number);
            });
            for (let patch = 0; patch < count; patch += 1) {
              checked += 1;
              if (term(patches, patch, x, z) === 0) continue;
              touched += 1;
              for (const corner of corners) {
                expect(((reach[corner] as number) >> patch) & 1, `patch ${String(patch)}`).toBe(1);
              }
            }
          }
        }
      }
    }
    // The control: the points read did land on patches.
    expect(checked).toBeGreaterThan(0);
    expect(touched).toBeGreaterThan(100);
  });

  it('reaches a patch’s corner and stops at its edge, for a triangle smaller than the patch', () => {
    // One patch at the origin along +z, 4 m by 2 m (half 2 by 1), tone −0.04.
    const patches = new Float32Array(MAXIMUM_ROAD_PATCHES * ROAD_PATCH_FLOATS);
    patches.set([0, 0, 0, 1, 2, 1, -0.04, 0]);
    const tiny = (x: number, z: number): number[] => [x, 0, z, x + 0.01, 0, z, x, 0, z + 0.01];
    const corridor = {
      centre: [],
      colours: new Float32Array(0),
      quadCount: 0,
      // Inside the corner, 2.1 m from the centre — past the half length,
      // inside the half diagonal; then past the end and past the side, each
      // beyond the half diagonal and the margin. (A point inside the circle
      // and outside the patch is counted: the bound is conservative.)
      vertices: new Float32Array([...tiny(0.9, 1.9), ...tiny(0, 2.4), ...tiny(2.4, 0)]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    };
    const reach = new Float32Array(9);
    writeRoadPatchReach(corridor, patches, 1, reach);
    expect(term(patches, 0, 0.9, 1.9)).not.toBe(0);
    expect(Array.from(reach.slice(0, 3))).toEqual([1, 1, 1]);
    expect(Math.abs(term(patches, 0, 0, 2.4)) + Math.abs(term(patches, 0, 2.4, 0))).toBe(0);
    expect(Array.from(reach.slice(3))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('leaves most of the road with no patch to test, and writes nothing where there are none', () => {
    const { corridor, reach, patches } = reached(1_000);
    const vertexCount = corridor.vertices.length / 3;
    const none = Array.from(reach.slice(0, vertexCount)).filter((mask) => mask === 0).length;
    // A patch is a few metres of a 460 m corridor: nearly every vertex is clear.
    expect(none / vertexCount).toBeGreaterThan(0.8);
    // Each mask is whole bits of real slots.
    for (const mask of reach.slice(0, vertexCount)) {
      expect(Number.isInteger(mask)).toBe(true);
      expect(mask).toBeLessThan(1 << MAXIMUM_ROAD_PATCHES);
    }
    // No patches: every vertex nought, the ones a stale frame wrote too.
    const stale = new Float32Array(reach);
    writeRoadPatchReach(corridor, patches, 0, stale);
    expect(Array.from(stale.slice(0, vertexCount)).every((mask) => mask === 0)).toBe(true);
  });
});

describe('the wear’s patch loop, bounded — #1523', () => {
  const compiled = (bounded: boolean) => {
    const noTexture = {} as Parameters<typeof photographicRoadMaterial>[0];
    const material = photographicRoadMaterial(noTexture, noTexture, true, bounded);
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
    const key = material.customProgramCacheKey();
    material.dispose();
    return { shader, key };
  };

  it('runs the loop only on a triangle a patch reaches, the noise only on paint, and each term as before', () => {
    const bounded = compiled(true);
    const before = compiled(false);
    // The reach is the vertex's, handed on flat: one triangle, one mask.
    expect(bounded.shader.vertexShader).toContain('attribute float oylPatchReach;');
    expect(bounded.shader.vertexShader).toContain('vRoadReach = oylPatchReach;');
    expect(bounded.shader.fragmentShader).toContain('flat varying float vRoadReach;');
    const fragment = bounded.shader.fragmentShader;
    expect(fragment).toContain('if (oylReach != 0) {');
    expect(fragment).toContain('if ((oylReach & (1 << oylAt)) == 0) continue;');
    expect(fragment).toContain('if (oylPaint > 0.0) oylFaded = ');
    // The control: the wear as #628 and #879 drew it reads no reach.
    expect(before.shader.vertexShader).not.toContain('oylPatchReach');
    expect(before.shader.fragmentShader).not.toContain('oylReach');
    expect(before.shader.fragmentShader).not.toContain('if (oylPaint > 0.0)');
    // A patch the bound keeps is added by the same text as before, and the
    // noise is the same noise.
    const body = (text: string): string =>
      text.slice(
        text.indexOf('vec4 oylPlace'),
        text.indexOf('* roadWear;', text.indexOf('oylWorn += oylSize.z')),
      );
    expect(body(fragment)).toBe(body(before.shader.fragmentShader));
    expect(body(fragment)).toContain('oylInside');
    const noise = 'oylNoise(vRoadWorld * 0.13) * 0.7 + oylNoise(vRoadWorld * 1.7) * 0.3';
    expect(fragment).toContain(noise);
    expect(before.shader.fragmentShader).toContain(noise);
    expect(bounded.key).not.toBe(before.key);
  });
});
