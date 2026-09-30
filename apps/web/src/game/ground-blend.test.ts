// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  groundBlend,
  ROAD_EDGE_METRES,
  ROCK_SLOPE_DEGREES,
  SCREE_BAND_METRES,
  treeLineHeight,
  VERGE_BLEND_METRES,
} from './ground-blend';
import { terrainCorridor, VERGE_METRES } from './landform';
import { hillRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { corridorOrigin, roadCorridor } from './terrain';
import { photographicGroundMaterial } from './three-renderer';
import { treeLineMetres } from './world';

const up = (degrees: number): number => Math.cos((degrees * Math.PI) / 180);

describe('the realistic ground’s blend — #627', () => {
  it('wears a verge along the road’s edge, soft over a stated band, and grass beyond it', () => {
    const at = (fromEdge: number): number =>
      groundBlend(ROAD_EDGE_METRES + fromEdge, 1, 0, 1e6).verge;
    expect(at(0)).toBe(1);
    expect(at(VERGE_BLEND_METRES[0])).toBe(1);
    expect(at((VERGE_BLEND_METRES[0] + VERGE_BLEND_METRES[1]) / 2)).toBeCloseTo(0.5, 6);
    expect(at(VERGE_BLEND_METRES[1])).toBe(0);
    expect(at(5)).toBe(0);
    // Either side of the road alike.
    expect(groundBlend(-(ROAD_EDGE_METRES + 0.2), 1, 0, 1e6).verge).toBe(1);
    // And inside the landform's first column, reaching a little past it.
    expect(VERGE_BLEND_METRES[0]).toBeLessThan(VERGE_METRES);
    expect(VERGE_BLEND_METRES[1]).toBeGreaterThan(VERGE_METRES);
  });

  it('turns to rock by slope, and not on level ground', () => {
    const rock = (degrees: number): number => groundBlend(20, up(degrees), 0, 1e6).rock;
    expect(rock(0)).toBe(0);
    expect(rock(ROCK_SLOPE_DEGREES[0] - 1)).toBe(0);
    expect(rock((ROCK_SLOPE_DEGREES[0] + ROCK_SLOPE_DEGREES[1]) / 2)).toBeCloseTo(0.5, 6);
    expect(rock(ROCK_SLOPE_DEGREES[1])).toBeCloseTo(1, 9);
    expect(rock(60)).toBe(1);
  });

  it('turns to scree above the tree line, softly, and never below it', () => {
    const scree = (height: number): number => groundBlend(20, 1, height, 500).scree;
    expect(scree(500 - SCREE_BAND_METRES - 1)).toBe(0);
    expect(scree(500)).toBeCloseTo(0.5, 6);
    expect(scree(500 + SCREE_BAND_METRES)).toBe(1);
  });

  it('reads the tree line in the corridor’s own frame, as scatter reads it', () => {
    const route = hillRoute();
    const origin = corridorOrigin(route);
    expect(treeLineHeight(origin)).toBeCloseTo(
      treeLineMetres(Math.abs(origin.latitude)) - origin.elevation,
      9,
    );
    // And the landform carries it to the renderer with every mesh.
    const corridor = roadCorridor(route, origin, 500);
    expect(terrainCorridor(route, origin, corridor, scatterSeed(route)).treeLine).toBe(
      treeLineHeight(origin),
    );
  });

  it('blends in the ground’s one shader, from attributes the ground already has', () => {
    const noTexture = {} as Parameters<typeof photographicGroundMaterial>[0];
    const material = photographicGroundMaterial(
      noTexture,
      noTexture,
      { value: 90 },
      { value: 1 },
      {
        verge: { colour: noTexture, normal: noTexture },
        rock: { colour: noTexture, normal: noTexture },
        treeLine: { value: 123 },
      },
    );
    const shader = {
      vertexShader: [
        '#include <common>',
        '#include <fog_pars_vertex>',
        'void main() {',
        '#include <begin_vertex>',
        '#include <uv_vertex>',
        '#include <fog_vertex>',
        '}',
      ].join('\n'),
      fragmentShader: [
        '#include <common>',
        '#include <normalmap_pars_fragment>',
        '#include <fog_pars_fragment>',
        'void main() {',
        '#include <map_fragment>',
        '#include <color_fragment>',
        '#include <alphamap_fragment>',
        '#include <normal_fragment_maps>',
        '#include <fog_fragment>',
        '}',
      ].join('\n'),
      uniforms: {} as Record<string, { value: unknown }>,
      defines: {},
    };
    (material.onBeforeCompile as (s: typeof shader) => void)(shader);
    // No new vertex attribute: the only one declared is the surface detail's
    // `fields`, which the ground has carried since #425.
    const attributes = shader.vertexShader.match(/^attribute .*$/gm) ?? [];
    expect(attributes).toEqual(['attribute vec2 fields;']);
    // The tree line is the one the belt writes, by reference.
    expect(shader.uniforms['treeLine']?.value).toBe(123);
    // Branched: each new surface is sampled only where it is.
    expect(shader.fragmentShader).toContain('if (oylVergeShare > 0.0)');
    expect(shader.fragmentShader).toContain('if (oylRockShare > 0.0)');
    // The world's colour leads: each photograph over its own mean, times it.
    expect(shader.fragmentShader).toContain('/ max(textureLod(rockMap, vec2(0.5), 16.0).rgb');
    expect(shader.fragmentShader).toContain('oylGroundWorld * vColor.rgb');
    // Mixed in after the patchwork, which the surface detail splices in after
    // `color_fragment`: #460's fields show where the grass does.
    const patchwork = shader.fragmentShader.indexOf('fieldTone');
    const mixedIn = shader.fragmentShader.indexOf('float oylOther = oylVergeShare + oylRockShare;');
    expect(patchwork).toBeGreaterThan(0);
    expect(mixedIn).toBeGreaterThan(patchwork);
    // The normal map is blended where the colour is.
    expect(shader.fragmentShader).toContain('vec3 mapN = oylGroundNormal( vNormalMapUv )');
    material.dispose();
  });
});
