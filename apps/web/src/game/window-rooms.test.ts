// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1662: the rooms behind mapped glass, in the shader — the program three is
 * handed read for the interior (`three-renderer.ts` §`INTERIOR_GLSL`), its
 * numbers generated from the twin's (`facade.ts` §`INTERIOR`), its ray run
 * against the twin's (`interiorAt`), every pane calling it, the glass's
 * Fresnel in place of #1581's constant metalness, the far mean unmoved, no
 * texture added, and the `window-rooms` lever building all of it out. The
 * twin itself is held in `facade.test.ts` §"#1662"; what needs a GPU — two
 * neighbouring panes that differ on screen, and match with the lever off —
 * is `game.browser.spec.ts` §"#1662".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  INTERIOR,
  INTERIOR_PALETTE_ORDER,
  INTERIOR_PALETTES,
  INTERIOR_SALT,
  interiorAt,
  interiorLinear,
  glassWeightsAt,
  type FaceDirection,
  type InteriorSurface,
} from './facade';
import { footprintPlans } from './footprint-buildings';
import { mixedTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { LIT_COLOURS, MappedBuildingBelt, windowRoomsOf } from './three-renderer';

const town = mixedTownFixture();
const buildings = mappedBuildingsOf(
  footprintPlans(town.corridor, landClassMask(town.corridor), town.profile, town.origin).plans,
);
const textures = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    {
      colour: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
      normal: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
    },
  ]),
);
const belts: MappedBuildingBelt[] = [];

afterEach(() => {
  windowRoomsOf({} as never, true);
  for (const belt of belts.splice(0)) belt.dispose();
});

/** Three's own source, read as text: the seam admits one importer of three, so it is not imported. */
function threeSource(path: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../node_modules/three/src/renderers/shaders/${path}`, import.meta.url),
    ),
    'utf8',
  );
}

/** A chunk of three's, its text. */
function chunk(name: string): string {
  const text = /export default \/\* glsl \*\/`([\s\S]*?)`;/.exec(
    threeSource(`ShaderChunk/${name}.glsl.js`),
  );
  if (text?.[1] === undefined) throw new Error(`three has no chunk ${name}`);
  return text[1];
}

/** One of the lit program's two stages, as `meshphysical.glsl.js` writes it, its includes unresolved. */
function physical(stage: 'vertex' | 'fragment'): string {
  const found = new RegExp(`export const ${stage} = /\\* glsl \\*/\`([\\s\\S]*?)\`;`).exec(
    threeSource('ShaderLib/meshphysical.glsl.js'),
  );
  if (found?.[1] === undefined) throw new Error(`three’s lit program has no ${stage} stage`);
  return found[1];
}

/** The material of `surface` a belt over the mixed town makes, the program it hands three, and its defines. */
function compiled(surface: 'brick' | 'render' = 'brick'): {
  readonly fragment: string;
  readonly defines: Record<string, unknown>;
  readonly textures: number;
} {
  const belt = new MappedBuildingBelt(buildings, textures);
  belts.push(belt);
  const material = belt.materialOf(surface);
  if (material === undefined) throw new Error(`the belt has no ${surface} material`);
  const shader = {
    uniforms: {},
    vertexShader: physical('vertex'),
    fragmentShader: physical('fragment'),
  };
  material.onBeforeCompile(shader as never, undefined as never);
  // Every texture the material binds: a property of three's Texture kind.
  const bound = Object.values(material).filter(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      ('isTexture' in value || ('image' in value && 'dispose' in value)),
  ).length;
  return {
    fragment: shader.fragmentShader,
    defines: { ...(material.defines as Record<string, unknown>) },
    textures: bound,
  };
}

/** A `const float` the program declares, by name. */
function constantOf(source: string, name: string): number {
  const found = new RegExp(`const float ${name} = (-?[\\d.e-]+);`).exec(source);
  if (found?.[1] === undefined) throw new Error(`the program declares no ${name}`);
  return Number(found[1]);
}

/** The body of the program's function `name`, from its opening brace to its closing one. */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`the program has no ${signature}`);
  let depth = 0;
  let end = source.indexOf('{', start);
  const open = end;
  for (; end < source.length; end += 1) {
    depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
    if (depth === 0) break;
  }
  return source.slice(open + 1, end);
}

/**
 * The program's own `oylRoomHit` and `oylFresnelOf`, run: their text as the
 * shader holds it, every `const float` it declares, GLSL's built-ins, a
 * `float` local a `let` and the `vec2` it answers an array — so that the
 * test holds what the GPU runs to the twin and not a copy of it.
 */
function shaderRoom(source: string): {
  readonly hit: (...args: readonly number[]) => readonly [number, number];
  readonly fresnel: (cosine: number) => number;
} {
  const constants = [...source.matchAll(/const float (oyl\w+) = (-?[\d.e-]+);/g)].map(
    (match) => `const ${match[1] ?? ''} = ${match[2] ?? ''};`,
  );
  const js = (body: string): string =>
    body.replace(/\bfloat\s+(\w+)\s*=/g, 'let $1 =').replace(/return vec2\(/g, 'return (');
  const hitBody = js(
    bodyOf(
      source,
      'vec2 oylRoomHit(float px, float py, float w, float h, float ex, float ey, float ez)',
    ),
  ).replace(/return \((oyl\w+), (oyl\w+)\);/, 'return [$1, $2];');
  const fresnelBody = js(bodyOf(source, 'float oylFresnelOf(float cosine)'));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shader's own function text
  const make = new Function(
    'abs',
    'min',
    'max',
    'clamp',
    `${constants.join('\n')}
function oylRoomHit(px, py, w, h, ex, ey, ez) {${hitBody}}
function oylFresnelOf(cosine) {${fresnelBody}}
return { hit: oylRoomHit, fresnel: oylFresnelOf };`,
  ) as (...builtIns: unknown[]) => ReturnType<typeof shaderRoom>;
  return make(Math.abs, Math.min, Math.max, (x: number, lo: number, hi: number) =>
    Math.min(Math.max(x, lo), hi),
  );
}

/** The shader's plane codes, as `oylRoomHit` numbers them. */
const PLANES: readonly InteriorSurface[] = ['back', 'floor', 'ceiling', 'left', 'right'];

describe('the room behind the glass, in the shader — #1662', () => {
  it('declares oylInterior with the signature #1636 and #1665 call', () => {
    expect(compiled().fragment).toContain(
      'vec3 oylInterior(vec2 pane, vec2 paneSize, vec3 eyeFace, float seed, float palette, float lit) {',
    );
  });

  it('generates every number from the twin’s, so none is written twice', () => {
    const { fragment } = compiled();
    expect(constantOf(fragment, 'oylRoomDepth')).toBe(INTERIOR.depth);
    expect(constantOf(fragment, 'oylRoomSide')).toBe(INTERIOR.side);
    expect(constantOf(fragment, 'oylRoomBelow')).toBe(INTERIOR.below);
    expect(constantOf(fragment, 'oylRoomAbove')).toBe(INTERIOR.above);
    expect(constantOf(fragment, 'oylRoomGraze')).toBe(INTERIOR.graze);
    expect(constantOf(fragment, 'oylRoomBack')).toBe(INTERIOR.backShade);
    expect(constantOf(fragment, 'oylRoomSideWall')).toBe(INTERIOR.sideWall);
    expect(constantOf(fragment, 'oylBlindShare')).toBe(INTERIOR.blind.share);
    expect(constantOf(fragment, 'oylFigureShare')).toBe(INTERIOR.silhouette.share);
    expect(constantOf(fragment, 'oylGlassF0')).toBe(INTERIOR.fresnel);
    expect(fragment).toContain(
      `const vec2 oylRoomSalt = vec2(${INTERIOR_SALT.room.map((n) => `${String(n)}.0`).join(', ')});`,
    );
    // Every palette's every paint, linear, in order: home, shop, office.
    const walls = INTERIOR_PALETTE_ORDER.flatMap((palette) =>
      INTERIOR_PALETTES[palette].walls.map(interiorLinear),
    );
    const declared = /const vec3 oylRoomWalls\[(\d+)\] = vec3\[\d+\]\(([^;]*)\);/.exec(fragment);
    expect(Number(declared?.[1])).toBe(walls.length);
    const numbers = [...(declared?.[2] ?? '').matchAll(/-?[\d.]+(?:e-?\d+)?/g)].map((m) =>
      Number(m[0]),
    );
    // vec3(r, g, b): a "3" of each constructor's name, then its three numbers.
    const channels = numbers.filter((_, at) => at % 4 !== 0);
    expect(channels).toEqual(walls.flat());
  });

  it('runs its ray as the twin does: the plane met, and how deep, for every eye and point', () => {
    const room = shaderRoom(compiled().fragment);
    const sizes: readonly (readonly [number, number])[] = [
      [0.71, 1.31],
      [1.6, 1.1],
      [0.4, 0.3],
    ];
    let compared = 0;
    const seen = new Set<InteriorSurface>();
    for (const size of sizes) {
      for (let a = -80; a <= 80; a += 10) {
        for (let b = -80; b <= 80; b += 10) {
          const ax = (a * Math.PI) / 180;
          const by = (b * Math.PI) / 180;
          const raw = [Math.sin(ax), Math.sin(by), Math.cos(ax) * Math.cos(by)];
          const length = Math.hypot(raw[0] ?? 0, raw[1] ?? 0, raw[2] ?? 0);
          const eye = raw.map((c) => c / length) as unknown as FaceDirection;
          for (const [fx, fy] of [
            [0, 0],
            [0.3, -0.2],
            [-0.45, 0.4],
          ] as const) {
            const pane: readonly [number, number] = [(fx * size[0]) / 1, (fy * size[1]) / 1];
            // A seed whose room has no blind: the twin's blind is drawn on the glass, not met by the ray.
            const twin = interiorAt(pane, size, eye, 0.97, 'home', false);
            if (twin.surface === 'blind') continue;
            const [plane, t] = room.hit(pane[0], pane[1], size[0], size[1], eye[0], eye[1], eye[2]);
            expect(PLANES[plane], `${String(a)}° ${String(b)}°`).toBe(twin.surface);
            expect(t * Math.max(eye[2], INTERIOR.graze)).toBeCloseTo(twin.deep, 9);
            seen.add(twin.surface);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
    // Every plane of the box is met somewhere in the sweep.
    expect([...seen].sort()).toEqual(['back', 'ceiling', 'floor', 'left', 'right']);
  });

  it('weights the room by 1 − F of the twin’s Schlick term at every pane it draws', () => {
    const { fragment } = compiled();
    const room = shaderRoom(fragment);
    for (let degrees = 0; degrees <= 90; degrees += 5) {
      const cosine = Math.cos((degrees * Math.PI) / 180);
      expect(room.fresnel(cosine)).toBeCloseTo(glassWeightsAt(cosine).environment, 12);
    }
    // Read once from the eye's slant in the face's frame, outside every branch.
    expect(fragment).toContain('float oylGlassF = oylGlassF0;');
    expect(fragment).toContain('oylGlassF = oylFresnelOf(oylEyeF.z);');
    // The sash's, the casement's and commercial window's, the curtain wall's, the
    // dormer's, the fanlight's, the shop door's and the shop front's: seven panes,
    // each the room under 1 − F, and the definition.
    expect(fragment.match(/oylInterior\(/g)?.length).toBe(8);
    const weighted = fragment.match(/\) \* \(1\.0 - oylGlassF\)/g)?.length;
    expect(weighted).toBe(7);
    // With the palettes they name: an office behind a curtain wall, a shop
    // behind a shop front and a shop door, a home behind the rest.
    expect(fragment).toContain('oylEyeF, oylRoomSeed, 2.0, oylLit)');
    expect(fragment).toContain('oylEyeF, oylHallSeed, 1.0, step(0.5,');
    expect(fragment).toContain('oylLitShop\n      ) * (1.0 - oylGlassF)');
    expect(fragment.split('oylEyeF, oylRoomSeed, 0.0, oylLit)').length - 1).toBe(2);
  });

  it('gives back the environment by three’s Fresnel at F0 0.04, not by a constant metalness', () => {
    const { fragment } = compiled();
    // The pane is a dielectric: no metalness on glass.
    expect(fragment).toContain('metalnessFactor = mix(metalnessFactor, 0.0, oylGlass);');
    expect(fragment).not.toContain('metalnessFactor = mix(metalnessFactor, 0.35, oylGlass);');
    // And at metalness 0 three's own Fresnel is Schlick's from F0 0.04 to 1:
    // the reflection's term is `specularColorBlended`, the dielectric's F0
    // mixed toward the paint by the metalness this splice set, and F90 1.
    const physical = chunk('lights_physical_fragment');
    expect(physical).toContain('material.specularColor = vec3( 0.04 );');
    expect(physical).toContain(
      'material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );',
    );
    expect(physical).toContain('material.specularF90 = 1.0;');
    expect(INTERIOR.fresnel).toBe(0.04);
    // The splice is read before three's lighting reads it.
    expect(fragment.indexOf('metalnessFactor = mix(metalnessFactor, 0.0, oylGlass);')).toBeLessThan(
      fragment.indexOf('#include <lights_physical_fragment>'),
    );
    // The environment's term reaches the reflection: three's Schlick, weighted by the dielectric's F0.
    const pars = chunk('lights_physical_pars_fragment');
    expect(pars).toContain('vec3 FssEss = Fr * fab.x + specularF90 * fab.y;');
    expect(pars).toContain('vec3 indirectSpecular = radiance * singleScattering;');
  });

  it('keeps the far mean every pane fades to, so the far picture does not move', () => {
    const on = compiled().fragment;
    windowRoomsOf({} as never, false);
    const off = compiled().fragment;
    // The sash's mean, and the casement's flat pane its mean reads, the same text both ways.
    const sashMean = 'vec3 oylMean = mix(oylWall, mix(vOylTrim, oylRoom, 0.75), oylArea);';
    expect(on).toContain(sashMean);
    expect(off).toContain(sashMean);
    const flat =
      'vec3 oylFlatPane = oylRoom + vec3(0.03, 0.04, 0.05) * smoothstep(oylWB, oylWT, oylAt.y);';
    expect(on).toContain(flat);
    expect(off).toContain(flat);
    expect(on).toContain('vec3 oylMean = mix(oylWall, mix(vOylTrim, oylFlatPane, 0.75), oylArea);');
    // The curtain wall's mean is its glass's colour, both ways.
    expect(on).toContain('+ oylCurtainGlassC * max(0.0, 1.0 - oylBarShare - oylSpandrelShare);');
    // And a pane's Fresnel is a pane's only: its glass share fades to nought far off.
    expect(on).toContain('oylGlass = oylPaneOn * (1.0 - oylFade);');
  });

  it('puts every paint a room is drawn in inside `three-renderer.test.ts`’ sweep of lit colours', () => {
    // A room's colour is a paint times a light below 1, so its paints bound
    // it; "lights no colour past white" then holds the lit rooms too.
    const paints = [
      ...INTERIOR_PALETTE_ORDER.flatMap((palette) => {
        const { walls, floors, ceilings } = INTERIOR_PALETTES[palette];
        return [...walls, ...floors, ...ceilings];
      }),
      ...INTERIOR.blind.paints,
      INTERIOR.silhouette.paint,
    ];
    for (const paint of paints) expect(LIT_COLOURS, paint.toString(16)).toContain(paint);
    for (const channel of [...INTERIOR.lit, ...INTERIOR.unlit]) expect(channel).toBeLessThan(1);
  });

  it('adds no texture, no cubemap and no atlas: zero bytes', () => {
    const on = compiled();
    windowRoomsOf({} as never, false);
    const off = compiled();
    expect(on.textures).toBe(off.textures);
    expect(on.textures).toBeGreaterThan(0);
    const count = (source: string, word: RegExp): number => source.match(word)?.length ?? 0;
    for (const word of [/texture\w*\(/g, /sampler\w*/g, /textureCube/g]) {
      expect(count(on.fragment, word)).toBe(count(off.fragment, word));
    }
    const interior = bodyOf(
      on.fragment,
      'vec3 oylInterior(vec2 pane, vec2 paneSize, vec3 eyeFace, float seed, float palette, float lit)',
    );
    expect(interior).not.toMatch(/texture|sampler/);
  });

  it('builds the program without the term with `-window-rooms`, and with it otherwise', () => {
    const on = compiled();
    expect(on.fragment).toContain('vec3 oylInterior(');
    expect(on.defines).toMatchObject({ OYL_WINDOW_ROOMS: 1 });
    windowRoomsOf({} as never, false);
    const off = compiled();
    expect(off.fragment).not.toContain('oylInterior');
    expect(off.fragment).not.toContain('oylGlassF');
    expect(off.fragment).not.toContain('oylFresnelOf');
    // #1581's constant pane, and its metalness, as on main.
    expect(off.fragment).toContain('metalnessFactor = mix(metalnessFactor, 0.35, oylGlass);');
    expect(off.fragment).toContain('vec3 oylPane = oylFlatPane;');
    expect(off.fragment).toContain('vec3 oylFanPane = vec3(0.02, 0.025, 0.03);');
    expect(off.fragment).toContain(
      'vec3 oylPaneC = oylCurtainGlassC * (1.0 - oylRevealShade * oylShadeOn);',
    );
    // A different program, so three compiles it: three keys a program on its material's defines.
    expect(off.defines).toMatchObject({ OYL_WINDOW_ROOMS: 0 });
    windowRoomsOf({} as never, true);
    expect(compiled().fragment).toContain('vec3 oylInterior(');
  });
});
