// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { AA_LARGE_TEXT_OR_NON_TEXT } from '../design/contrast';
import {
  groundBlend,
  ROAD_EDGE_METRES,
  ROCK_SLOPE_DEGREES,
  SCREE_BAND_METRES,
  stoneBlend,
  treeLineHeight,
  VERGE_BLEND_METRES,
  VERGE_SLUSH,
} from './ground-blend';
import { glslFunction } from './glsl-testing';
import { NO_LAND_CLASS } from './land-class';
import { TERRAIN_MOTTLE, terrainCorridor, VERGE_METRES } from './landform';
import { REALISTIC_SURFACES } from './realistic-assets';
import { hillRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { corridorOrigin, MARKING_COLOUR, roadCorridor } from './terrain';
import { photographicGroundMaterial } from './three-renderer';
import { groundColourIn, snowCoverIn, treeLineMetres, vergeSlushIn, worldStyle } from './world';

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
    expect(
      terrainCorridor(route, origin, corridor, scatterSeed(route), NO_LAND_CLASS).treeLine,
    ).toBe(treeLineHeight(origin));
  });

  it('blends in the ground’s one shader, from attributes the ground already has', () => {
    const { shader, material } = compiledGround(ALL_SURFACES);
    // No new vertex attribute: the only one declared is the surface detail's
    // `fields`, which the ground has carried since #425.
    const attributes = shader.vertexShader.match(/^attribute .*$/gm) ?? [];
    expect(attributes).toEqual(['attribute vec2 fields;']);
    // The tree line is the one the belt writes, by reference.
    expect(shader.uniforms['treeLine']?.value).toBe(123);
    // Branched: each new surface is sampled only where it is.
    expect(shader.fragmentShader).toContain('if (oylVergeShare > 0.0)');
    expect(shader.fragmentShader).toContain('if (oylRockShare - oylCragShare > 0.0)');
    // The world's colour leads: each photograph over its own mean, times it.
    expect(shader.fragmentShader).toContain('/ max(textureLod(rockMap, vec2(0.5), 16.0).rgb');
    expect(shader.fragmentShader).toContain('vec3 oylSurfaces = vColor.rgb');
    expect(shader.fragmentShader).toContain('+ oylGroundWorld * (oylRockTexel');
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

type GroundTexture = Parameters<typeof photographicGroundMaterial>[0];
type GroundBlend = NonNullable<Parameters<typeof photographicGroundMaterial>[4]>;

/** A texture nothing reads, told from every other by identity. */
const texture = (): GroundTexture => ({}) as GroundTexture;

/** Every surface the blend takes, each map its own object. */
const ALL_SURFACES = {
  verge: { colour: texture(), normal: texture() },
  rock: { colour: texture(), normal: texture() },
  crag: { colour: texture(), normal: texture() },
  treeLine: { value: 123 },
} satisfies GroundBlend;

/** The ground's material, and its shader as `onBeforeCompile` leaves the chunks it edits. */
function compiledGround(
  blend: GroundBlend,
  bounded = true,
): {
  readonly shader: {
    vertexShader: string;
    fragmentShader: string;
    uniforms: Record<string, { value: unknown }>;
  };
  readonly material: ReturnType<typeof photographicGroundMaterial>;
} {
  const material = photographicGroundMaterial(
    texture(),
    texture(),
    { value: 90 },
    { value: 1 },
    blend,
    bounded,
  );
  {
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
    return { shader, material };
  }
}

describe('the bare rock a steep bank wears — #1274', () => {
  it('gives the slope’s share to the crag and what is left of the stone to the loose scree', () => {
    // A steep bank below the tree line: all crag, no loose stone.
    expect(stoneBlend(1, 0)).toEqual({ crag: 1, loose: 0 });
    // Level ground above the tree line: all loose stone, no crag.
    expect(stoneBlend(0, 1)).toEqual({ crag: 0, loose: 1 });
    // Steep AND above the tree line: rock that steep holds no loose stone.
    expect(stoneBlend(1, 1)).toEqual({ crag: 1, loose: 0 });
    // Grass: neither.
    expect(stoneBlend(0, 0)).toEqual({ crag: 0, loose: 0 });
    // And across both ranges the two are never more than the stone there is.
    for (const rock of [0, 0.25, 0.5, 0.75, 1]) {
      for (const scree of [0, 0.25, 0.5, 0.75, 1]) {
        const { crag, loose } = stoneBlend(rock, scree);
        expect(crag + loose).toBe(Math.max(rock, scree));
        expect(loose).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('runs that arithmetic in the ground’s shader, on the crag’s own two maps at its own size', () => {
    const { shader, material } = compiledGround(ALL_SURFACES);
    // Each sampler is handed the map it is named for: a colour map bound where
    // the normal map belongs lights a bank by a photograph's colours.
    expect(shader.uniforms['cragMap']?.value).toBe(ALL_SURFACES.crag.colour);
    expect(shader.uniforms['cragNormalMap']?.value).toBe(ALL_SURFACES.crag.normal);
    expect(shader.uniforms['rockMap']?.value).toBe(ALL_SURFACES.rock.colour);
    expect(shader.uniforms['rockNormalMap']?.value).toBe(ALL_SURFACES.rock.normal);
    const fragment = shader.fragmentShader;
    // The slope's share, times the browser gate's switch.
    expect(fragment).toContain('oylCragShare = oylRock * groundShares.w;');
    // Sampled only where it is, colour and normal alike, over its own mean.
    expect(fragment.match(/if \(oylCragShare > 0\.0\)/g)).toHaveLength(2);
    expect(fragment).toContain('textureGrad(cragMap, cragUv, cragDx, cragDy).rgb');
    expect(fragment).toContain('/ max(textureLod(cragMap, vec2(0.5), 16.0).rgb');
    expect(fragment).toContain('textureGrad(cragNormalMap, cragUv, cragDx, cragDy).xyz');
    // The loose stone keeps only what the crag leaves, in both places.
    expect(fragment).toContain('(oylRockTexel * (oylRockShare - oylCragShare)');
    expect(fragment).toContain('+ oylCragTexel * oylCragShare));');
    expect(fragment).toContain('float oylScreeShare = oylRockShare - oylCragShare;');
    // At 3 m a repeat: this repository's figure, the scan's page stating none.
    expect(REALISTIC_SURFACES.crag.tileMetres).toBe(3);
    expect(fragment).toContain('vec2 oylCragUv() { return vOylGround.xz / 3.0; }');
    material.dispose();
  });

  it('draws the grass everywhere, as before #627, in a world built without the crag', () => {
    // A sampler declared and never bound reads texture unit 0, which is the
    // grass: a bank would silently wear grass texels as rock.
    const { shader, material } = compiledGround({
      verge: ALL_SURFACES.verge,
      rock: ALL_SURFACES.rock,
      treeLine: ALL_SURFACES.treeLine,
    });
    expect(shader.fragmentShader).not.toContain('cragMap');
    expect(shader.fragmentShader).not.toContain('rockMap');
    expect(shader.uniforms['cragMap']).toBeUndefined();
    material.dispose();
  });
});

describe('the ground blend’s derivatives, taken once — #1523', () => {
  const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

  it('takes each surface’s pair once, outside every branch, by the same expression, and hands it to the normal', () => {
    const bounded = compiledGround(ALL_SURFACES);
    const before = compiledGround(ALL_SURFACES, false);
    const fragment = bounded.shader.fragmentShader;
    for (const name of ['verge', 'rock', 'crag']) {
      const dx = `vec2 ${name}Dx = dFdx(${name}Uv) * oylBias;`;
      const dy = `vec2 ${name}Dy = dFdy(${name}Uv) * oylBias;`;
      // The control: as #627 and #1274 took them, in each of the two readers.
      expect(before.shader.fragmentShader.split(dx), name).toHaveLength(3);
      expect(before.shader.fragmentShader.split(dy), name).toHaveLength(3);
      // Bounded: the same expression, once.
      expect(fragment.split(dx), name).toHaveLength(2);
      expect(fragment.split(dy), name).toHaveLength(2);
      // The normal reads the pair the shares took.
      const global = `oyl${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      expect(fragment, name).toContain(`${global}Dx = ${name}Dx;`);
      expect(fragment, name).toContain(`vec2 ${name}Dx = ${global}Dx;`);
      expect(fragment, name).toContain(`vec2 ${name}Dy = ${global}Dy;`);
      // Taken in `main`'s map block, which runs before the normal's chunk calls the reader.
      expect(fragment.indexOf(`${global}Dx = ${name}Dx;`)).toBeGreaterThan(
        fragment.indexOf('void main()'),
      );
    }
    // Six fewer derivatives in the whole program, whatever else takes one.
    expect(count(fragment, /dFdx\(/g)).toBe(count(before.shader.fragmentShader, /dFdx\(/g) - 3);
    expect(count(fragment, /dFdy\(/g)).toBe(count(before.shader.fragmentShader, /dFdy\(/g) - 3);
    // Before the first branch that samples a surface: a derivative inside
    // non-uniform control flow is undefined.
    const taken = fragment.indexOf('vec2 vergeDx = dFdx(');
    expect(taken).toBeGreaterThan(fragment.indexOf('void main()'));
    expect(taken).toBeLessThan(fragment.indexOf('if (oylVergeShare > 0.0)', taken));
    // And a program of its own, so three cannot hand one ground the other's.
    expect(bounded.material.customProgramCacheKey()).not.toBe(
      before.material.customProgramCacheKey(),
    );
    bounded.material.dispose();
    before.material.dispose();
  });
});

/**
 * The road's edge in snow — #1692. In a snowy winter the ground beside the
 * road is the snow, and the verge multiplied the snow by its photograph: white
 * beside the road's white edge line, and the edge of the road stopped reading.
 * The verge now mixes toward ploughed slush by `world.ts` §`vergeSlushIn`,
 * and this reads the verge's colour from the program three is handed
 * (`oylSlushedVerge`), at the edge line, under a full winter on a 61° N road
 * at sea level — `?place=nordic` on the owner's page.
 */
describe('the road’s edge line against a snowy verge — #1692', () => {
  const nordic = worldStyle(northRoute(1_000, () => 0, { latitude: 61 }));
  type Rgb = readonly [number, number, number];
  /** sRGB to linear, as three decodes a colour for the shader. */
  const linear = (packed: number): Rgb => {
    const decode = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return [decode((packed >> 16) & 0xff), decode((packed >> 8) & 0xff), decode(packed & 0xff)];
  };
  /** WCAG 2.2's relative luminance, of a colour already linear. */
  const luminance = ([r, g, b]: readonly number[]): number =>
    0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  const contrast = (a: number, b: number): number =>
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const slushed = (world: Rgb, slush: number): readonly number[] => {
    const { shader, material } = compiledGround(ALL_SURFACES);
    material.dispose();
    const drawn = glslFunction(shader.fragmentShader, 'oylSlushedVerge')(world, slush);
    if (typeof drawn === 'number') throw new Error('oylSlushedVerge returned a float');
    return drawn;
  };
  const line = luminance(linear(MARKING_COLOUR));

  it('draws the verge beside the edge line at 3:1 or more from the line in a full winter', () => {
    // Non-vacuity: the ground there is the snow, and the verge is all of the
    // ground at the road's edge, where the edge line's outer side is.
    expect(snowCoverIn(nordic, 1)).toBe(1);
    expect(groundBlend(ROAD_EDGE_METRES, 1, 0, 1e6).verge).toBe(1);
    const snow = linear(groundColourIn(nordic, 1));
    const verge = slushed(snow, vergeSlushIn(nordic, 1));
    // The landform's mottle at its brightest is the verge's worst case.
    expect(contrast(line, luminance(verge) * (1 + TERRAIN_MOTTLE))).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT_OR_NON_TEXT,
    );
    // And it is the slush, in the shader as in the constant.
    const slush = linear(VERGE_SLUSH);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(verge[channel]).toBeCloseTo(slush[channel] ?? 0, 5);
    }
    // The control: the verge as it was before #1692, the snow beside the line.
    expect(contrast(line, luminance(snow))).toBeLessThan(1.5);
  });

  it('mixes the slush into the verge’s term alone, by the season’s uniform', () => {
    const { shader, material } = compiledGround(ALL_SURFACES);
    material.dispose();
    const fragment = shader.fragmentShader;
    expect(fragment).toContain('uniform float oylVergeSlush;');
    expect(shader.uniforms['oylVergeSlush']).toEqual({ value: 0 });
    expect(fragment).toContain(
      'vec3 oylVergeWorld = oylSlushedVerge(oylGroundWorld, oylVergeSlush);',
    );
    expect(fragment).toContain('* (oylVergeWorld * oylVergeTexel * oylVergeShare');
    // Every ground shares the one uniform the view writes.
    expect(compiledGround(ALL_SURFACES).shader.uniforms['oylVergeSlush']).toBe(
      shader.uniforms['oylVergeSlush'],
    );
  });

  it('draws the verge exactly as before with no winter, and in a winter with no snow', () => {
    const grass: Rgb = [0.1, 0.2, 0.05];
    expect(slushed(grass, 0)).toEqual(grass);
    for (const latitude of [0, 46, 61, 75]) {
      for (const altitude of [0, 1_600, 3_000]) {
        const world = worldStyle(northRoute(1_000, () => altitude, { latitude }));
        expect(vergeSlushIn(world, 0)).toBe(0);
      }
    }
    // 50° N at sea level: a winter there lays no snow, and the verge stays earth.
    expect(vergeSlushIn(worldStyle(northRoute(1_000, () => 0, { latitude: 50 })), 1)).toBe(0);
  });
});
