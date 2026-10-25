// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1658: the sun's own shadow under a mapped wall's eaves — the twin
 * (`facade.ts` §`overhangShadowDepth`, `overhangShadowAt`, `eavesShadeAt`)
 * held to the issue's numbers, the shader's function run against it, and the
 * term and its lever read off the program three is handed. What needs a GPU
 * — that the shadow reaches the screen, and that the lever takes it off — is
 * `game.browser.spec.ts` §"#1658".
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  eavesShadeAt,
  FACADE_AO,
  OVERHANG_SHADOW,
  overhangShadowAt,
  overhangShadowDepth,
  REVEAL,
  type FaceDirection,
} from './facade';
import {
  EAVES_OVERHANG_METRES,
  footprintPlans,
  ROOF_PITCHES_DEGREES,
  ROOF_THICKNESS_METRES,
} from './footprint-buildings';
import { rowTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { MappedBuildingBelt, overhangShadowsOf, windowRevealsOf } from './three-renderer';
import { SUN_ELEVATION_AT_POLE_DEGREES, SUN_ELEVATION_AT_EQUATOR_DEGREES } from './world';

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The sun `elevation` degrees high and `round` degrees round the face's
 * normal, in the face's frame: along its `u`, up it, out of it.
 */
const sunAt = (elevation: number, round = 0): FaceDirection => [
  Math.cos(radians(elevation)) * Math.sin(radians(round)),
  Math.sin(radians(elevation)),
  Math.cos(radians(elevation)) * Math.cos(radians(round)),
];

/** The same sun read on the face opposite: its `u` and its normal both turned round. */
const opposite = (sun: FaceDirection): FaceDirection => [-sun[0], sun[1], -sun[2]];

describe('the overhang’s shadow, in the twin — #1658', () => {
  it('throws 0.4 · tan 60° down the wall from a 0.4 m eave, a sun 60° high and square to it', () => {
    expect(EAVES_OVERHANG_METRES).toBe(0.4);
    const depth = overhangShadowDepth(EAVES_OVERHANG_METRES, sunAt(60));
    expect(Math.abs(depth - 0.4 * Math.tan(radians(60)))).toBeLessThan(0.01);
    expect(depth).toBeCloseTo(0.69, 2);
  });

  it('throws it longer by 1 / cos 45° with the sun 45° round the face’s normal', () => {
    const square = overhangShadowDepth(EAVES_OVERHANG_METRES, sunAt(60));
    const round = overhangShadowDepth(EAVES_OVERHANG_METRES, sunAt(60, 45));
    expect(round / square).toBeCloseTo(1 / Math.cos(radians(45)), 6);
    // Either way round.
    expect(overhangShadowDepth(EAVES_OVERHANG_METRES, sunAt(60, -45))).toBeCloseTo(round, 9);
  });

  it('throws none with the sun behind the face', () => {
    const behind = opposite(sunAt(60));
    expect(overhangShadowDepth(EAVES_OVERHANG_METRES, behind)).toBe(0);
    for (const below of [-0.2, 0, 0.1, 0.5, 2]) {
      expect(overhangShadowAt(below, EAVES_OVERHANG_METRES, behind)).toBe(0);
    }
    // And the eaves keep #1588's band there, and nothing else.
    for (const below of [0, 0.2, 0.5, 0.8, 1.5]) {
      expect(eavesShadeAt(below, behind)).toBe(eavesShadeAt(below, behind, { shadows: false }));
    }
  });

  it('throws at least 0.57 m on a face square to the lowest sun the world has', () => {
    expect(SUN_ELEVATION_AT_POLE_DEGREES).toBe(55);
    const least = overhangShadowDepth(EAVES_OVERHANG_METRES, sunAt(SUN_ELEVATION_AT_POLE_DEGREES));
    expect(least).toBeGreaterThanOrEqual(0.57);
    // A higher sun throws it further, a lower one less.
    expect(
      overhangShadowDepth(EAVES_OVERHANG_METRES, sunAt(SUN_ELEVATION_AT_EQUATOR_DEGREES)),
    ).toBeGreaterThan(least);
  });

  it('clamps it to the wall’s height', () => {
    // A sun all but grazing the face throws a shadow longer than any wall.
    const grazing: FaceDirection = [0.999, Math.sin(radians(60)), 0.001];
    expect(overhangShadowDepth(EAVES_OVERHANG_METRES, grazing)).toBeGreaterThan(100);
    expect(overhangShadowDepth(EAVES_OVERHANG_METRES, grazing, 6)).toBe(6);
  });

  it('is all shadow inside the depth, none past it, and the footprint’s mean across its edge', () => {
    const sun = sunAt(60);
    const depth = overhangShadowDepth(EAVES_OVERHANG_METRES, sun);
    expect(overhangShadowAt(-0.1, EAVES_OVERHANG_METRES, sun)).toBe(1);
    expect(overhangShadowAt(depth - 0.01, EAVES_OVERHANG_METRES, sun)).toBe(1);
    expect(overhangShadowAt(depth + 0.01, EAVES_OVERHANG_METRES, sun)).toBe(0);
    // Softened over the fragment's footprint: half at the edge, the whole of
    // it a footprint inside, none a footprint past.
    expect(overhangShadowAt(depth, EAVES_OVERHANG_METRES, sun, 0.05)).toBeCloseTo(0.5, 9);
    expect(overhangShadowAt(depth - 0.05, EAVES_OVERHANG_METRES, sun, 0.05)).toBe(1);
    expect(overhangShadowAt(depth + 0.05, EAVES_OVERHANG_METRES, sun, 0.05)).toBe(0);
  });

  it('places the eaves’ edge for the middle pitch, under the fascia', () => {
    const middle = [...ROOF_PITCHES_DEGREES].sort((a, b) => a - b)[2] ?? Number.NaN;
    expect(middle).toBe(35);
    expect(OVERHANG_SHADOW.edge).toBeCloseTo(
      ROOF_THICKNESS_METRES + EAVES_OVERHANG_METRES * Math.tan(radians(middle)),
      12,
    );
    // Every pitch's real edge is within 12 cm of it.
    for (const pitch of ROOF_PITCHES_DEGREES) {
      const edge = ROOF_THICKNESS_METRES + EAVES_OVERHANG_METRES * Math.tan(radians(pitch));
      expect(Math.abs(edge - OVERHANG_SHADOW.edge)).toBeLessThan(0.12);
    }
    expect(OVERHANG_SHADOW.shade).toBe(REVEAL.shade);
  });
});

describe('the sunny side against the shaded side — #1658', () => {
  const sun = sunAt(60);
  const lit = sun;
  const shaded = opposite(sun);

  it('gives two opposite faces of one building under one sun different eaves shading', () => {
    // Below the soft band's 0.6 m and inside the sun's: the sun's band on the
    // lit face, none on the shaded one.
    const below = OVERHANG_SHADOW.edge + 0.3;
    expect(below).toBeGreaterThan(FACADE_AO.eavesMetres);
    const strength = (1 - OVERHANG_SHADOW.shade) * Math.min(1, sun[2] / OVERHANG_SHADOW.square);
    expect(eavesShadeAt(below, lit)).toBeCloseTo(1 - strength, 9);
    expect(eavesShadeAt(below, shaded)).toBe(1);
    // At the wall's top the shaded face has #1588's band at its darkest.
    expect(eavesShadeAt(0, shaded)).toBeCloseTo(FACADE_AO.eaves, 9);
    expect(eavesShadeAt(0, lit)).toBeLessThan(eavesShadeAt(0, shaded));
    // Past the sun's band both are lit alike.
    const past = OVERHANG_SHADOW.edge + overhangShadowDepth(EAVES_OVERHANG_METRES, sun) + 0.1;
    expect(eavesShadeAt(past, lit)).toBe(1);
    expect(eavesShadeAt(past, shaded)).toBe(1);
  });

  it('gives both the same band without the term, which is main before #1658', () => {
    for (const below of [0, 0.1, 0.3, 0.6, 0.8, 1.2, 2]) {
      const before = eavesShadeAt(below, lit, { shadows: false });
      expect(eavesShadeAt(below, shaded, { shadows: false })).toBe(before);
      expect(before).toBeCloseTo(
        1 - (1 - FACADE_AO.eaves) * (1 - smoothstepOf(0, FACADE_AO.eavesMetres, below)),
        12,
      );
    }
  });

  it('only darkens, and never past the darker of its two shades', () => {
    for (const elevation of [55, 60, 65, 70]) {
      for (const round of [-80, -45, 0, 30, 89, 120, 180]) {
        const s = sunAt(elevation, round);
        for (let below = -0.2; below <= 4; below += 0.05) {
          const shade = eavesShadeAt(below, s, { pw: 0.02, wall: 6 });
          expect(shade).toBeLessThanOrEqual(1);
          expect(shade).toBeGreaterThanOrEqual(
            Math.min(OVERHANG_SHADOW.shade, FACADE_AO.eaves) - 1e-12,
          );
          // Never lighter than #1588's band, which it only adds to.
          expect(shade).toBeLessThanOrEqual(eavesShadeAt(below, s, { shadows: false }) + 1e-12);
        }
      }
    }
  });

  it('fades as the sun comes round to graze the wall, so a grazed wall is not darker than a shaded one', () => {
    const below = OVERHANG_SHADOW.edge + 0.3;
    const grazing = sunAt(60, 89.9);
    expect(1 - eavesShadeAt(below, grazing, { wall: 6 })).toBeLessThan(0.001);
  });
});

/** GLSL's smoothstep, for the band before #1658. */
function smoothstepOf(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

const town = rowTownFixture();
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
  overhangShadowsOf({} as never, true);
  windowRevealsOf({} as never, true);
  for (const belt of belts.splice(0)) belt.dispose();
});

/** The fragment shader a mapped building's material hands three, and the defines three keys it on. */
function compiled(): { readonly fragment: string; readonly defines: unknown } {
  const belt = new MappedBuildingBelt(buildings, textures);
  belts.push(belt);
  const material = belt.materialOf('brick');
  if (material === undefined) throw new Error('the belt has no brick material');
  // The includes `mapped-building-belt.test.ts` hands a lit material.
  const shader = {
    uniforms: {},
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return { fragment: shader.fragmentShader, defines: { ...material.defines } };
}

/** A `const float` the program declares, by name. */
function constantOf(fragment: string, name: string): number {
  const found = new RegExp(`const float ${name} = (-?[\\d.e-]+);`).exec(fragment);
  if (found?.[1] === undefined) throw new Error(`the program declares no ${name}`);
  return Number(found[1]);
}

/**
 * The program's own `oylOverhangShadow`, run: its body as the shader holds
 * it, with GLSL's built-ins, so that the test holds the text the GPU runs to
 * the twin and not a copy of it.
 */
function shaderOverhangShadow(
  fragment: string,
): (below: number, projection: number, s: FaceDirection, pw: number, wall: number) => number {
  const found =
    /float oylOverhangShadow\(float below, float projection, vec3 s, float pw, float wall\) \{([^}]*)\}/.exec(
      fragment,
    );
  if (found?.[1] === undefined) throw new Error('the program has no oylOverhangShadow');
  const body = found[1].replace(/\bfloat /g, 'const ');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shader's own function text
  const run = new Function(
    'below',
    'projection',
    's',
    'pw',
    'wall',
    'min',
    'max',
    'step',
    'smoothstep',
    body,
  ) as (...args: unknown[]) => number;
  const smoothstep = (lo: number, hi: number, x: number): number =>
    hi > lo ? smoothstepOf(lo, hi, x) : x < lo ? 0 : 1;
  return (below, projection, s, pw, wall) =>
    run(
      below,
      projection,
      { x: s[0], y: s[1], z: s[2] },
      pw,
      wall,
      Math.min,
      Math.max,
      (edge: number, x: number) => (x < edge ? 0 : 1),
      smoothstep,
    );
}

describe('the overhang’s shadow, in the shader — #1658', () => {
  it('runs the twin’s rule: the program’s own function gives the twin’s shadow', () => {
    const { fragment } = compiled();
    const shadow = shaderOverhangShadow(fragment);
    for (const [elevation, round] of [
      [55, 0],
      [60, 0],
      [60, 45],
      [70, -30],
      [60, 180],
    ] as const) {
      const s = sunAt(elevation, round);
      for (let below = -0.3; below <= 3; below += 0.07) {
        for (const pw of [0.005, 0.05]) {
          expect(shadow(below, EAVES_OVERHANG_METRES, s, pw, 6)).toBeCloseTo(
            overhangShadowAt(below, EAVES_OVERHANG_METRES, s, pw, 6),
            5,
          );
        }
      }
    }
  });

  it('generates its numbers from the twin’s, so that none is written twice', () => {
    const { fragment } = compiled();
    expect(constantOf(fragment, 'oylOverhangShade')).toBeCloseTo(OVERHANG_SHADOW.shade, 5);
    expect(constantOf(fragment, 'oylOverhangSquare')).toBeCloseTo(OVERHANG_SHADOW.square, 5);
    expect(constantOf(fragment, 'oylEavesEdge')).toBeCloseTo(OVERHANG_SHADOW.edge, 5);
    expect(constantOf(fragment, 'oylEavesOverhang')).toBeCloseTo(EAVES_OVERHANG_METRES, 5);
  });

  it('splices it into the shade under the eaves, on walls with eaves, reading #1659’s face frame', () => {
    const { fragment } = compiled();
    expect(fragment).toContain('float oylEavesShade = 1.0 - (1.0 - oylAoEaves) * oylUnderEaves;');
    expect(fragment).toContain(
      'oylOverhangShadow(oylBelowTop - oylEavesEdge, oylEavesOverhang, oylSunF, oylMw.y, oylTop * oylStoreyM)',
    );
    expect(fragment).toContain('clamp(oylSunF.z / oylOverhangSquare, 0.0, 1.0)');
    expect(fragment).toContain(
      'oylEavesShade = mix(oylEavesShade, min(oylEavesShade, oylSunShadow), oylFlag(oylFlags, oylEavesFlag));',
    );
    expect(fragment).toContain(
      'diffuseColor.rgb *= oylEavesShade * (1.0 - (1.0 - oylAoBase) * oylAtFoot);',
    );
    // #1659's sun in the face's frame, declared once, by #1659.
    expect(fragment.split('vec3 oylSunF = ').length - 1).toBe(1);
    // The wall's foot is #1661's: untouched.
    expect(fragment).toContain(
      'float oylAtFoot = 1.0 - smoothstep(0.0, oylAoBaseM, vOylFacade.y * oylStoreyM);',
    );
  });

  it('builds the program without the term with `-overhang-shadows`, and with it otherwise', () => {
    const on = compiled();
    expect(on.fragment).toContain('float oylOverhangShadow(');
    expect(on.fragment).toContain('oylSunShadow');
    overhangShadowsOf({} as never, false);
    const off = compiled();
    expect(off.fragment).not.toContain('oylOverhangShadow');
    expect(off.fragment).not.toContain('oylSunShadow');
    expect(off.fragment).not.toContain('oylEavesEdge');
    // #1588's band alone, as main drew it.
    expect(off.fragment).toContain(
      'float oylEavesShade = 1.0 - (1.0 - oylAoEaves) * oylUnderEaves;',
    );
    expect(off.fragment).toContain(
      'diffuseColor.rgb *= oylEavesShade * (1.0 - (1.0 - oylAoBase) * oylAtFoot);',
    );
    // A different program, so three compiles it rather than reusing the product's.
    expect(on.defines).toMatchObject({ OYL_OVERHANG_SHADOWS: 1 });
    expect(off.defines).toMatchObject({ OYL_OVERHANG_SHADOWS: 0 });
    // And #1659's reveals are not this lever's.
    expect(off.fragment).toContain('vec2 oylShift = oylRecess * e.xy / max(e.z, oylGraze);');
    overhangShadowsOf({} as never, true);
    expect(compiled().fragment).toContain('float oylOverhangShadow(');
  });

  it('leaves the shadows built with #1659’s lever off', () => {
    windowRevealsOf({} as never, false);
    const { fragment, defines } = compiled();
    expect(fragment).toContain('float oylOverhangShadow(');
    expect(defines).toMatchObject({ OYL_WINDOW_REVEALS: 0, OYL_OVERHANG_SHADOWS: 1 });
  });
});
