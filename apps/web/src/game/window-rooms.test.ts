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
import { GlslProgram } from './glsl-program-testing';
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
 * The text of the function `signature` opens, from its signature through its
 * closing brace.
 */
function functionOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  return `${source.slice(start, start + signature.length)} {${bodyOf(source, signature)}}`;
}

/**
 * The shader's room, run: its hash, its constants and `INTERIOR_GLSL` through
 * the end of `oylInterior`, as the program holds them, evaluated on the CPU
 * ({@link GlslProgram}) — so that the test holds what the GPU runs to the
 * twin and not a copy of it.
 */
function shaderRoom(fragment: string): GlslProgram {
  const start = fragment.indexOf('const float oylRoomDepth');
  const last =
    'vec3 oylInterior(vec2 pane, vec2 paneSize, vec3 eyeFace, float seed, float palette, float lit)';
  const end = fragment.indexOf(last) + last.length + bodyOf(fragment, last).length + 3;
  if (start < 0 || end < start) throw new Error('the program holds no room');
  return new GlslProgram(
    `${functionOf(fragment, 'float oylWindowHash(vec2 cell)')}\n${fragment.slice(start, end)}`,
  );
}

/**
 * Every `oylInterior(` call in the program but its definition: the pane
 * centre and the pane size each hands the room, as text, in the order the
 * program lays them down.
 */
function interiorCalls(
  fragment: string,
): readonly { readonly name: string; readonly pane: string; readonly size: string }[] {
  const names = [
    'curtain wall',
    'sash',
    'casement',
    'fanlight',
    'shop door',
    'dormer',
    'shop front',
  ];
  const found: { name: string; pane: string; size: string }[] = [];
  for (const match of fragment.matchAll(/oylInterior\(/g)) {
    const open = match.index + match[0].length;
    if (fragment.startsWith('vec2 pane,', open)) continue;
    const args: string[] = [];
    let depth = 0;
    let from = open;
    for (let at = open; at < fragment.length; at += 1) {
      const c = fragment[at];
      if (c === '(') depth += 1;
      else if (c === ')' && depth > 0) depth -= 1;
      else if (c === ')' || (c === ',' && depth === 0)) {
        args.push(fragment.slice(from, at).trim());
        from = at + 1;
        if (c === ')') break;
      }
    }
    found.push({
      name: names[found.length] ?? `call ${String(found.length)}`,
      pane: args[0] ?? '',
      size: args[1] ?? '',
    });
  }
  return found;
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
            const [plane, t] = room.call(
              'oylRoomHit',
              pane[0],
              pane[1],
              size[0],
              size[1],
              eye[0],
              eye[1],
              eye[2],
            ) as [number, number];
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

  it('colours every point of every pane as the twin does: paint, fall, blind, figure and light', () => {
    const room = shaderRoom(compiled().fragment);
    const sizes: readonly (readonly [number, number])[] = [
      [0.71, 1.31],
      [1.6, 1.1],
    ];
    const seeds = Array.from({ length: 48 }, (_, i) => (i * 0.618033 + 0.05) % 1);
    const angles = [-60, -12, 0, 7, 20, 50];
    // Where on the glass, as a share of its size from its middle: head, sill and between.
    const SPREAD = [-0.45, -0.2, 0.05, 0.28, 0.46];
    const seen = { blind: 0, figure: 0, wall: 0, side: 0, ceiling: 0, floor: 0, lit: 0, unlit: 0 };
    let compared = 0;
    for (const [at, seed] of seeds.entries()) {
      for (const [paletteAt, palette] of INTERIOR_PALETTE_ORDER.entries()) {
        for (const lit of [false, true]) {
          for (const size of sizes) {
            for (const a of angles) {
              for (const b of angles) {
                const [ax, by] = [(a * Math.PI) / 180, (b * Math.PI) / 180];
                const raw = [Math.sin(ax), Math.sin(by), Math.cos(ax) * Math.cos(by)] as const;
                const length = Math.hypot(...raw);
                const eye = raw.map((c) => c / length) as unknown as FaceDirection;
                const pane: readonly [number, number] = [
                  (SPREAD[(at + angles.indexOf(a)) % SPREAD.length] ?? 0) * size[0],
                  (SPREAD[(2 * at + angles.indexOf(b)) % SPREAD.length] ?? 0) * size[1],
                ];
                const twin = interiorAt(pane, size, eye, seed, palette, lit);
                const colour = room.call(
                  'oylInterior',
                  [...pane],
                  [...size],
                  [...eye],
                  seed,
                  paletteAt,
                  lit ? 1 : 0,
                ) as number[];
                const label = `seed ${String(seed)} ${palette} ${lit ? 'lit' : 'unlit'} ${String(a)}° ${String(b)}°`;
                twin.colour.forEach((channel, i) => {
                  expect(colour[i], label).toBeCloseTo(channel, 9);
                });
                compared += 1;
                seen[lit ? 'lit' : 'unlit'] += 1;
                if (twin.surface === 'blind') seen.blind += 1;
                else if (twin.surface === 'left' || twin.surface === 'right') seen.side += 1;
                else if (twin.surface === 'ceiling') seen.ceiling += 1;
                else if (twin.surface === 'floor') seen.floor += 1;
                else {
                  // The back wall: the figure's dark paint, or the wall's own.
                  const light = lit ? INTERIOR.lit : INTERIOR.unlit;
                  const fall =
                    1 + (INTERIOR.backShade - 1) * Math.min(twin.deep / INTERIOR.depth, 1);
                  const figure = interiorLinear(INTERIOR.silhouette.paint)[0] * light[0] * fall;
                  seen[Math.abs(twin.colour[0] - figure) < 1e-12 ? 'figure' : 'wall'] += 1;
                }
              }
            }
          }
        }
      }
    }
    expect(compared).toBe(seeds.length * 3 * 2 * sizes.length * angles.length ** 2);
    // Every branch of the colour is met, many times, by both lights.
    for (const [branch, count] of Object.entries(seen)) {
      expect(count, branch).toBeGreaterThan(20);
    }
  });

  it('asks every pane’s room for the glass it draws: the centre and size at each call site', () => {
    const { fragment } = compiled();
    const calls = interiorCalls(fragment);
    expect(calls.map((call) => call.name)).toEqual([
      'curtain wall',
      'sash',
      'casement',
      'fanlight',
      'shop door',
      'dormer',
      'shop front',
    ]);
    const constants = new GlslProgram(
      [...fragment.matchAll(/const float (oyl\w+) = (-?[\d.e-]+);/g)]
        .map((match) => `const float ${match[1] ?? ''} = ${match[2] ?? ''};`)
        .join('\n'),
    );
    const k = (name: string): number => constants.constant(name) as number;
    const at = (name: string): { pane: string; size: string } => {
      const call = calls.find((c) => c.name === name);
      if (call === undefined) throw new Error(`no call site ${name}`);
      return { pane: call.pane, size: call.size };
    };
    /** The call's pane centre and size, against the glass `lo` to `hi`, in its own frame, taken from `bindingsAt`. */
    const holds = (
      name: string,
      lo: readonly [number, number],
      hi: readonly [number, number],
      bindingsAt: (point: readonly [number, number]) => Record<string, number | number[]>,
      scale: readonly [number, number] = [1, 1],
    ): void => {
      const { pane, size } = at(name);
      const glass = [(hi[0] - lo[0]) * scale[0], (hi[1] - lo[1]) * scale[1]];
      const sizeBound = constants.evaluate(size, bindingsAt(lo)) as number[];
      expect(sizeBound[0], `${name} width`).toBeCloseTo(glass[0] as number, 9);
      expect(sizeBound[1], `${name} height`).toBeCloseTo(glass[1] as number, 9);
      // The glass's corners and middle, as the point of the glass the pane is asked at.
      for (const [fx, fy] of [
        [0, 0],
        [1, 1],
        [0.5, 0.5],
        [0.25, 0.8],
      ] as const) {
        const point: readonly [number, number] = [
          lo[0] + (hi[0] - lo[0]) * fx,
          lo[1] + (hi[1] - lo[1]) * fy,
        ];
        const value = constants.evaluate(pane, bindingsAt(point)) as number[];
        expect(value[0], `${name} x at ${String(fx)}`).toBeCloseTo(
          (fx - 0.5) * (glass[0] as number),
          9,
        );
        expect(value[1], `${name} y at ${String(fy)}`).toBeCloseTo(
          (fy - 0.5) * (glass[1] as number),
          9,
        );
      }
    };

    // Metres, the glass an arbitrary rectangle.
    const curtainLo = [0.4, 0.9] as const;
    const curtainHi = [1.9, 3.1] as const;
    holds('curtain wall', curtainLo, curtainHi, (q) => ({
      oylQ: [...q],
      oylLo: [...curtainLo],
      oylHi: [...curtainHi],
    }));
    // The sash's and the dormer's panes are the sash's own, passed through.
    expect(at('sash')).toEqual({ pane: 'oylPaneAt', size: 'oylPaneSize' });
    expect(at('dormer')).toEqual({ pane: 'oylPaneAt', size: 'oylPaneSize' });
    const sashPane = /\n\s+pane = ([^;]+);/.exec(fragment);
    const sashSize = /\n\s+paneSize = ([^;]+);/.exec(fragment);
    expect(sashPane?.[1]).toBeDefined();
    expect(sashSize?.[1]).toBeDefined();
    const sashLo = [-0.25, 0.8] as const;
    const sashHi = [0.25, 1.9] as const;
    const sashBound = (q: readonly [number, number]): Record<string, number[]> => ({
      oylQ: [...q],
      oylLo: [...sashLo],
      oylHi: [...sashHi],
    });
    for (const [fx, fy] of [
      [0, 0],
      [1, 1],
      [0.5, 0.5],
    ] as const) {
      const q: readonly [number, number] = [
        sashLo[0] + (sashHi[0] - sashLo[0]) * fx,
        sashLo[1] + (sashHi[1] - sashLo[1]) * fy,
      ];
      const pane = constants.evaluate(sashPane?.[1] ?? '', sashBound(q)) as number[];
      expect(pane[0], `sash x at ${String(fx)}`).toBeCloseTo(
        (fx - 0.5) * (sashHi[0] - sashLo[0]),
        9,
      );
      expect(pane[1], `sash y at ${String(fy)}`).toBeCloseTo(
        (fy - 0.5) * (sashHi[1] - sashLo[1]),
        9,
      );
    }
    const sashSized = constants.evaluate(sashSize?.[1] ?? '', sashBound(sashLo)) as number[];
    expect(sashSized).toEqual([sashHi[0] - sashLo[0], sashHi[1] - sashLo[1]]);

    // The casement: the bay's units for the glass, the point in metres.
    const toM = [4.2, 3.1] as const;
    const caseLo = [0.2, 0.3] as const;
    const caseHi = [0.6, 0.8] as const;
    holds(
      'casement',
      [caseLo[0] * toM[0], caseLo[1] * toM[1]],
      [caseHi[0] * toM[0], caseHi[1] * toM[1]],
      (q) => ({
        oylQ: [...q],
        oylLo: [...caseLo],
        oylHi: [...caseHi],
        oylToM: [...toM],
      }),
    );

    // The fanlight, in the door's face units: the glass the fanlight's own rect lays down.
    const doorM = [k('oylDoorW'), k('oylDoorH')] as const;
    holds(
      'fanlight',
      [k('oylDoorA') + 0.04, k('oylFan')],
      [1 - k('oylDoorA') - 0.04, 1 - k('oylDoorU') - 0.02],
      (point) => ({ oylAt: [...point], oylDoorM: [...doorM] }),
      doorM,
    );

    // The shop door, in metres: the glass the door's pane rect lays down.
    holds(
      'shop door',
      [k('oylDoorSurround') + k('oylShopDoorFrame'), k('oylShopDoorRail')],
      [
        k('oylDoorW') - k('oylDoorSurround') - k('oylShopDoorFrame'),
        k('oylDoorH') - k('oylDoorSurround') - k('oylShopDoorFrame'),
      ],
      (point) => ({ oylD: [...point] }),
    );

    // The shop front, in metres: one pane of the span, riser and sill below it, the frame above.
    const shopH = 3.4;
    const fromX = 0.7;
    const span = 2.2;
    holds(
      'shop front',
      [fromX, k('oylShopRiser') + k('oylShopSill')],
      [fromX + span, shopH - k('oylShopFrame')],
      (point) => ({ oylS: [...point], oylFromX: fromX, oylSpan: span, oylShopH: shopH }),
    );
  });

  it('weights the room by 1 − F of the twin’s Schlick term at every pane it draws', () => {
    const { fragment } = compiled();
    const room = shaderRoom(fragment);
    for (let degrees = 0; degrees <= 90; degrees += 5) {
      const cosine = Math.cos((degrees * Math.PI) / 180);
      expect(room.call('oylFresnelOf', cosine)).toBeCloseTo(glassWeightsAt(cosine).environment, 12);
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
