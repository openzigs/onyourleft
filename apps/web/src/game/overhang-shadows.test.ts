// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1658: the sun's own shadow under a mapped wall's eaves — the twin
 * (`facade.ts` §`overhangShadowDepth`, `overhangShadowAt`, `eavesShadeAt`)
 * held to the issue's numbers, the shader's function run against it, and the
 * term and its lever read off the program three is handed. What needs a GPU
 * — that the shadow reaches the screen, and that the lever takes it off — is
 * `game.browser.spec.ts` §"#1658".
 *
 * #1679: the cornice's and the awning's — the twins (`corniceShadeAt`,
 * `awningShadeAt`, both `overhangShadeAt`) held to the issue's numbers, the
 * floats that say the overhang is there read back from the plans and from
 * the belt's buffer the shader is handed, the shader's `oylOverhangShadeOf`
 * run against the twin, and the splices and the lever. On screen:
 * `game.browser.spec.ts` §"#1679".
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import {
  awningShadeAt,
  corniceShadeAt,
  eavesShadeAt,
  FACADE_AO,
  OVERHANG_SHADOW,
  overhangShadeAt,
  overhangShadowAt,
  overhangShadowDepth,
  REVEAL,
  type FaceDirection,
} from './facade';
import {
  AWNING,
  CORNICE,
  EAVES_OVERHANG_METRES,
  FACADE_AWNING,
  FACADE_OFFSET,
  FACADE_PLAIN,
  FACADE_SHOPFRONT,
  FOOTPRINT_MAX_VERTICES,
  FOOTPRINT_VERTEX_FLOATS,
  footprintPlans,
  PARAPET_METRES,
  ROOF_PITCHES_DEGREES,
  ROOF_ROLES,
  ROOF_THICKNESS_METRES,
  STOREY_METRES,
  STYLE_COMMERCIAL,
  STYLE_CORNICE,
  STYLE_FLAT_ROOF,
  STYLE_OFFSET,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import {
  buildingBeside,
  landBeside,
  mixedTownFixture,
  polygonBeside,
  rectangleBeside,
  rowTownFixture,
  starBeside,
} from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { mappedBuildingsOf, NEAR_ROLES } from './mapped-buildings';
import { MAPPED_BUILDING_TRIANGLES } from './realistic-budget';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin, drawnRoadFrame, type CorridorOrigin } from './terrain';
import { MappedBuildingBelt, overhangShadowsOf, windowRevealsOf } from './three-renderer';
import { SUN_ELEVATION_AT_POLE_DEGREES, SUN_ELEVATION_AT_EQUATOR_DEGREES } from './world';
import type { WorldCorridor } from './world-data/corridor';

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
    const sorted = [...ROOF_PITCHES_DEGREES].sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
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
    // #1735: on a wall with eaves only, by the building's flag, a branch its pixels take together.
    expect(fragment).toContain(
      'if (oylFlag(oylFlags, oylEavesFlag) > 0.5) {\n        float oylBelowTop',
    );
    expect(fragment).toContain('oylEavesShade = min(oylEavesShade, oylSunShadow);');
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

describe('the cornice’s and the awning’s shadows, in the twin — #1679', () => {
  /** How dark a face's shadow is under `sun`: #1658's, faded as the sun grazes it. */
  const darkest = (sun: FaceDirection): number =>
    1 - (1 - OVERHANG_SHADOW.shade) * Math.min(1, sun[2] / OVERHANG_SHADOW.square);

  it('places each overhang’s edge where the plan draws it', () => {
    // The cornice's band hangs from the parapet's top, so its edge is above the wall's.
    expect(OVERHANG_SHADOW.corniceRise).toBeCloseTo(PARAPET_METRES - CORNICE.depth, 12);
    expect(OVERHANG_SHADOW.corniceRise).toBeCloseTo(0.2, 12);
    // An awning's lowest edge is its valance's foot, under its own drop.
    expect(OVERHANG_SHADOW.awningEdge).toBeCloseTo(AWNING.drop + AWNING.valance, 12);
  });

  it('throws the awning’s shadow AWNING.depth · s.y / s.z down the shop front from its edge', () => {
    for (const depth of [AWNING.depth.least, AWNING.depth.most]) {
      for (const [elevation, round] of [
        [55, 0],
        [60, 0],
        [60, 40],
      ] as const) {
        const sun = sunAt(elevation, round);
        const reach = (depth * sun[1]) / sun[2];
        const end = OVERHANG_SHADOW.awningEdge + reach;
        expect(awningShadeAt(end - 0.01, depth, sun)).toBeCloseTo(darkest(sun), 12);
        expect(awningShadeAt(end + 0.01, depth, sun)).toBe(1);
        // Right under the awning, behind its valance, too.
        expect(awningShadeAt(0.1, depth, sun)).toBeCloseTo(darkest(sun), 12);
      }
    }
    // A 1 m awning under the lowest sun leaves the foot of a 2.7 m shop front lit.
    const low = sunAt(SUN_ELEVATION_AT_POLE_DEGREES);
    expect(OVERHANG_SHADOW.awningEdge + overhangShadowDepth(1, low)).toBeLessThan(2.2);
    expect(awningShadeAt(2.0, 1, low)).toBeLessThan(1);
    expect(awningShadeAt(2.3, 1, low)).toBe(1);
  });

  it('throws none from no awning, and none with the sun behind the shop front', () => {
    const sun = sunAt(60);
    for (const below of [0, 0.3, 1, 2]) {
      expect(awningShadeAt(below, 0, sun)).toBe(1);
      expect(awningShadeAt(below, AWNING.depth.most, opposite(sun))).toBe(1);
    }
  });

  it('throws the cornice’s shadow CORNICE.projection · s.y / s.z from its edge, over the parapet and down the wall', () => {
    expect(CORNICE.projection).toBe(0.25);
    for (const [elevation, round] of [
      [55, 0],
      [60, 0],
      [70, 0],
      [60, -45],
    ] as const) {
      const sun = sunAt(elevation, round);
      const reach = (CORNICE.projection * sun[1]) / sun[2];
      // On the wall: from the wall's top down to the shadow's end under the edge.
      const end = reach - OVERHANG_SHADOW.corniceRise;
      expect(end).toBeGreaterThan(0.15);
      expect(corniceShadeAt(end - 0.01, sun)).toBeCloseTo(darkest(sun), 12);
      expect(corniceShadeAt(end + 0.01, sun)).toBe(1);
      expect(corniceShadeAt(0.05, sun)).toBeCloseTo(darkest(sun), 12);
      // On the parapet's face between the wall's top and the cornice: every sun the world has.
      for (const below of [-0.19, -0.1, -0.01]) {
        expect(corniceShadeAt(below, sun)).toBeCloseTo(darkest(sun), 12);
      }
      // None with the sun behind the face.
      expect(corniceShadeAt(0.05, opposite(sun))).toBe(1);
    }
  });

  it('is #1658’s rule for every overhang: the eaves’ shade is it, past #1588’s band', () => {
    for (const elevation of [55, 65]) {
      for (const round of [-60, 0, 30, 150]) {
        const sun = sunAt(elevation, round);
        for (let below = 0.6; below <= 3; below += 0.1) {
          expect(eavesShadeAt(below, sun, { pw: 0.02, wall: 6 })).toBeCloseTo(
            overhangShadeAt(below - OVERHANG_SHADOW.edge, EAVES_OVERHANG_METRES, sun, {
              pw: 0.02,
              wall: 6,
            }),
            12,
          );
        }
      }
    }
  });
});

/** One vertex's facade and style, read from a plan's triangles. */
interface Floats {
  readonly u: number;
  readonly v: number;
  readonly top: number;
  readonly skip: number;
  readonly flags: number;
}

function floatsOf(plan: FootprintPlan, role: FootprintRole): Floats[] {
  const floats = plan.triangles[role];
  const out: Floats[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const f = (k: number): number => floats[at + k] as number;
    out.push({
      u: f(FACADE_OFFSET),
      v: f(FACADE_OFFSET + 1),
      top: f(FACADE_OFFSET + 2),
      skip: f(FACADE_OFFSET + 3),
      flags: f(STYLE_OFFSET + 1),
    });
  }
  return out;
}

const corniceOn = (vertex: Floats): boolean => (vertex.flags & STYLE_CORNICE) !== 0;

const mixed = mixedTownFixture();
const { plans: mixedPlans } = footprintPlans(
  mixed.corridor,
  landClassMask(mixed.corridor),
  mixed.profile,
  mixed.origin,
);

/** The awning a plan drew, from its own faces: how far out its valance hangs, or 0. */
function awningDepthOf(plan: FootprintPlan): number {
  const awning = plan.triangles.shopfront;
  let most = 0;
  for (let at = 0; at < awning.length; at += FOOTPRINT_VERTEX_FLOATS) {
    if (awning[at + FACADE_OFFSET + 2] !== FACADE_AWNING) continue;
    most = Math.max(most, awning[at + FACADE_OFFSET + 1] as number);
  }
  // Down the canvas's slope and its valance, in metres: back to the depth out.
  return most === 0 ? 0 : Math.sqrt((most - AWNING.valance) ** 2 - AWNING.drop ** 2);
}

/** Buildings on commercial land beside a straight road, planned together. */
function plannedOnRetail(
  routeId: string,
  buildings: (profile: RouteProfile, origin: CorridorOrigin) => BuildingFeature[],
): readonly FootprintPlan[] {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const corridor: WorldCorridor = {
    routeId,
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [landBeside(profile, origin, 'landuse', 'commercial', 900, 1_200, -80, 80)],
    buildings: buildings(profile, origin),
    paths: [],
    streets: [],
  };
  return footprintPlans(corridor, landClassMask(corridor), profile, origin).plans;
}

describe('the floats say the overhang is there — #1679, footprint-buildings.ts', () => {
  it('gives a shop front its awning’s depth as its skip, and 0 where it has none', () => {
    const shops = mixedPlans.filter((plan) => plan.shop.front);
    const awned = shops.filter((plan) => plan.shop.awning);
    expect(awned.length).toBeGreaterThan(5);
    expect(shops.length - awned.length).toBeGreaterThan(5);
    for (const plan of shops) {
      const front = floatsOf(plan, 'shopfront').filter((v) => v.top === FACADE_SHOPFRONT);
      expect(front).toHaveLength(6);
      const depth = awningDepthOf(plan);
      expect(depth > 0).toBe(plan.shop.awning);
      for (const vertex of front) expect(vertex.skip).toBeCloseTo(depth, 4);
      if (plan.shop.awning) {
        expect(depth).toBeGreaterThanOrEqual(AWNING.leastDepth - 1e-6);
        expect(depth).toBeLessThanOrEqual(AWNING.depth.most + 1e-6);
      }
    }
  });

  it('flags every wall under a cornice, and no other wall', () => {
    let flagged = 0;
    let unflagged = 0;
    for (const plan of mixedPlans) {
      const walls = floatsOf(plan, 'wall');
      if (plan.shop.cornice) {
        // Every wall's face, for a cornice runs round the whole roof.
        expect(walls.length).toBeGreaterThan(0);
        expect(walls.every(corniceOn)).toBe(true);
        flagged += 1;
      } else {
        expect(walls.some(corniceOn)).toBe(false);
        unflagged += 1;
      }
    }
    expect(flagged).toBeGreaterThan(5);
    expect(unflagged).toBeGreaterThan(5);
  });

  it('gives a parapet’s outer face under a cornice the cornice’s edge as its skip, and its back none', () => {
    const corniced = mixedPlans.filter((plan) => plan.shop.cornice);
    let checked = 0;
    for (const plan of corniced) {
      const parapet = floatsOf(plan, 'parapet');
      const outer = parapet.filter((vertex) => vertex.skip > 0);
      // The outer ring's faces, and not their backs (the roof's side): half of them.
      expect(outer.length * 2).toBe(parapet.length);
      const top = floatsOf(plan, 'wall').find((vertex) => vertex.top > 0)?.top;
      for (const vertex of outer) {
        expect(vertex.top).toBe(FACADE_PLAIN);
        // In storeys above the floor, as the face's `v` is: the walls' top and the rise.
        if (top !== undefined) {
          expect(vertex.skip).toBeCloseTo(top + OVERHANG_SHADOW.corniceRise / STOREY_METRES, 5);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(5 * 6);
    // Each such face has a `u` along it, as a wall's: the shader finds the
    // face's frame from it, and with none its sun has no slant down the face.
    for (const plan of corniced) {
      const outer = floatsOf(plan, 'parapet').filter((vertex) => vertex.skip > 0);
      for (let at = 0; at < outer.length; at += 6) {
        const us = outer.slice(at, at + 6).map((vertex) => vertex.u);
        expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.5);
      }
    }
    // No parapet without a cornice says one is over it.
    for (const plan of mixedPlans.filter((each) => !each.shop.cornice)) {
      expect(floatsOf(plan, 'parapet').some((vertex) => vertex.skip > 0)).toBe(false);
    }
  });

  it('flags no wall of a commercial plan that did without its cornice to fit', () => {
    const plans = plannedOnRetail('cornice-shadow-budget', (profile, origin) => [
      buildingBeside(profile, origin, [starBeside(1_000, 40, 12, 9, FOOTPRINT_MAX_VERTICES)], 6),
      buildingBeside(profile, origin, [polygonBeside(1_100, 40, 12, 4)], 6),
    ]);
    const many = plans.find((plan) => plan.footprint.length / 2 === FOOTPRINT_MAX_VERTICES);
    const few = plans.find((plan) => plan.footprint.length / 2 === 4);
    if (many === undefined || few === undefined) throw new Error('the two plans were not kept');
    const walls = floatsOf(many, 'wall');
    expect(many.roof).toBe('flat');
    expect(walls.every((vertex) => (vertex.flags & STYLE_COMMERCIAL) !== 0)).toBe(true);
    expect(walls.every((vertex) => (vertex.flags & STYLE_FLAT_ROOF) !== 0)).toBe(true);
    expect(many.shop.cornice).toBe(false);
    expect(walls.some(corniceOn)).toBe(false);
    expect(floatsOf(many, 'parapet').some((vertex) => vertex.skip > 0)).toBe(false);
    // Control: four walls take one, and say so.
    expect(few.shop.cornice).toBe(true);
    expect(floatsOf(few, 'wall').every(corniceOn)).toBe(true);
  });

  it('flags no courtyard’s wall, which the cornice round the outer ring does not cross', () => {
    const outer = rectangleBeside(1_000, 40, 24, 20);
    const [plan] = plannedOnRetail('cornice-shadow-courtyard', (profile, origin) => [
      buildingBeside(profile, origin, [outer, polygonBeside(1_000, 40, 4, 6)], 6),
    ]);
    if (plan === undefined) throw new Error('the plan was not kept');
    expect(plan.shop.cornice).toBe(true);
    // The outer ring's four walls are flagged; the courtyard's six are not.
    const faces = new Map<string, boolean>();
    const walls = plan.triangles.wall;
    for (let at = 0; at < walls.length; at += 6 * FOOTPRINT_VERTEX_FLOATS) {
      const normal = `${(walls[at + 3] as number).toFixed(3)},${(walls[at + 5] as number).toFixed(3)}`;
      const flagged = ((walls[at + STYLE_OFFSET + 1] as number) & STYLE_CORNICE) !== 0;
      faces.set(normal, flagged || (faces.get(normal) ?? false));
    }
    const flagged = [...faces.values()].filter(Boolean).length;
    expect(faces.size).toBe(4 + 6);
    expect(flagged).toBe(4);
    // And the parapet's: the outer ring's outer faces alone.
    const parapet = floatsOf(plan, 'parapet');
    expect(parapet.filter((vertex) => vertex.skip > 0)).toHaveLength(4 * 6);
  });

  it('flags no wall of a building part, which has no cornice', () => {
    const planned = (part: boolean): FootprintPlan => {
      const [plan] = plannedOnRetail('cornice-shadow-part', (profile, origin) => [
        buildingBeside(
          profile,
          origin,
          [rectangleBeside(1_000, 40, 14, 12)],
          12,
          part ? { minHeightMetres: 4 } : undefined,
        ),
      ]);
      if (plan === undefined) throw new Error('the plan was not kept');
      return plan;
    };
    const part = planned(true);
    const whole = planned(false);
    expect(part.roof).toBe('flat');
    expect(part.shop.cornice).toBe(false);
    expect(floatsOf(part, 'wall').some(corniceOn)).toBe(false);
    // Control: the whole building takes one, and says so.
    expect(whole.shop.cornice).toBe(true);
    expect(floatsOf(whole, 'wall').every(corniceOn)).toBe(true);
  });

  it('hands the shader both, through the belt’s own buffer', () => {
    const belt = new MappedBuildingBelt(mappedBuildingsOf(mixedPlans), textures);
    belts.push(belt);
    let awnings = 0;
    let cornices = 0;
    for (let along = 1_600; along <= 2_050; along += 50) {
      const frame = drawnRoadFrame(mixed.profile, mixed.origin, along);
      if (frame === undefined) throw new Error('no road');
      const stats = belt.refill(frame.x, frame.z, MAPPED_BUILDING_TRIANGLES);
      const facade = belt.mesh.geometry.getAttribute('oylFacade');
      const style = belt.mesh.geometry.getAttribute('oylStyle');
      for (let place = 0; place < stats.buildings; place += 1) {
        const drawn = belt.drawnAt(place);
        if (drawn === undefined || drawn.far || drawn.wallAt < 0) continue;
        const plan = mixedPlans[drawn.plan] as FootprintPlan;
        // Where each of the wall surface's roles starts in its range.
        const starts = new Map<FootprintRole, number>();
        let at = drawn.wallAt;
        for (const role of NEAR_ROLES) {
          if (ROOF_ROLES.has(role)) continue;
          starts.set(role, at);
          at += plan.triangles[role].length / FOOTPRINT_VERTEX_FLOATS;
        }
        const wallAt = starts.get('wall') ?? -1;
        floatsOf(plan, 'wall').forEach((_, index) => {
          expect((style.getY(wallAt + index) & STYLE_CORNICE) !== 0).toBe(plan.shop.cornice);
        });
        if (plan.shop.cornice) cornices += 1;
        const shopAt = starts.get('shopfront') ?? -1;
        floatsOf(plan, 'shopfront').forEach((vertex, index) => {
          if (vertex.top !== FACADE_SHOPFRONT) return;
          expect(facade.getZ(shopAt + index)).toBe(FACADE_SHOPFRONT);
          expect(facade.getW(shopAt + index)).toBeCloseTo(awningDepthOf(plan), 4);
          if (plan.shop.awning) awnings += 1;
        });
      }
    }
    expect(cornices).toBeGreaterThan(5);
    expect(awnings).toBeGreaterThan(5 * 6);
  });
});

/**
 * The program's own `oylOverhangShadeOf`, run: its body as the shader holds
 * it, calling the program's own `oylOverhangShadow` with its own constants.
 */
function shaderOverhangShade(
  fragment: string,
): (below: number, projection: number, s: FaceDirection, pw: number, wall: number) => number {
  const found =
    /float oylOverhangShadeOf\(float below, float projection, vec3 s, float pw, float wall\) \{([^}]*)\}/.exec(
      fragment,
    );
  if (found?.[1] === undefined) throw new Error('the program has no oylOverhangShadeOf');
  const shadow = shaderOverhangShadow(fragment);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shader's own function text
  const run = new Function(
    'below',
    'projection',
    's',
    'pw',
    'wall',
    'clamp',
    'oylOverhangShadow',
    'oylOverhangShade',
    'oylOverhangSquare',
    found[1],
  ) as (...args: unknown[]) => number;
  const shade = constantOf(fragment, 'oylOverhangShade');
  const square = constantOf(fragment, 'oylOverhangSquare');
  return (below, projection, s, pw, wall) =>
    run(
      below,
      projection,
      { x: s[0], y: s[1], z: s[2] },
      pw,
      wall,
      (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
      (b: number, p: number, v: { x: number; y: number; z: number }, w: number, h: number) =>
        shadow(b, p, [v.x, v.y, v.z], w, h),
      shade,
      square,
    );
}

describe('the cornice’s and the awning’s shadows, in the shader — #1679', () => {
  it('runs the twin’s rule: the program’s own shade gives the twin’s', () => {
    const { fragment } = compiled();
    const shade = shaderOverhangShade(fragment);
    for (const [elevation, round] of [
      [55, 0],
      [60, 30],
      [70, -60],
      [60, 180],
    ] as const) {
      const s = sunAt(elevation, round);
      for (const projection of [CORNICE.projection, AWNING.depth.least, AWNING.depth.most]) {
        for (let below = -0.3; below <= 3; below += 0.09) {
          expect(shade(below, projection, s, 0.02, 4)).toBeCloseTo(
            overhangShadeAt(below, projection, s, { pw: 0.02, wall: 4 }),
            5,
          );
        }
      }
    }
  });

  it('generates its numbers from the twin’s and the plan’s', () => {
    const { fragment } = compiled();
    expect(constantOf(fragment, 'oylCorniceFlag')).toBe(STYLE_CORNICE);
    expect(constantOf(fragment, 'oylCorniceRise')).toBeCloseTo(OVERHANG_SHADOW.corniceRise, 5);
    expect(constantOf(fragment, 'oylCorniceProjection')).toBeCloseTo(CORNICE.projection, 5);
    expect(constantOf(fragment, 'oylAwningEdge')).toBeCloseTo(OVERHANG_SHADOW.awningEdge, 5);
  });

  it('splices the cornice’s under the wall’s flag, the parapet’s by its skip, and the awning’s by the shop front’s', () => {
    const { fragment } = compiled();
    // The wall: under the cornice's edge, the rise above its top, into the shade #1658 applies.
    expect(fragment).toContain(
      'if (oylFlag(oylFlags, oylCorniceFlag) > 0.5) {\n        float oylCorniceAt = oylTop * oylStoreyM + oylCorniceRise;',
    );
    expect(fragment).toContain(
      'oylCorniceAt - vOylFacade.y * oylStoreyM, oylCorniceProjection, oylSunF, oylMw.y, oylCorniceAt',
    );
    const shade = fragment.indexOf('oylCorniceAt - vOylFacade.y');
    expect(shade).toBeLessThan(
      fragment.indexOf(
        'diffuseColor.rgb *= oylEavesShade * (1.0 - (1.0 - oylAoBase) * oylAtFoot);',
      ),
    );
    // The parapet: a plain face whose skip is the edge, the chain's last branch.
    expect(fragment).toContain('} else if (abs(oylTop) < 0.5 && vOylFacade.w > 0.0) {');
    expect(fragment).toContain(
      '(vOylFacade.w - vOylFacade.y) * oylStoreyM, oylCorniceProjection, oylSunF, oylMw.y, vOylFacade.w * oylStoreyM',
    );
    // The shop front: its skip the awning's depth, after the shop front is drawn.
    const shop = fragment.slice(fragment.indexOf('} else if (abs(oylTop - oylShopTop) < 0.5) {'));
    const branch = shop.slice(0, shop.indexOf('} else if (abs(oylTop - oylSignTop) < 0.5) {'));
    expect(branch).toContain(
      'if (vOylFacade.w > 0.0) {\n        float oylAwningAt = oylShopH - oylAwningEdge;',
    );
    expect(branch).toContain('oylAwningAt - oylS.y, vOylFacade.w, oylSunF, oylMw.y, oylAwningAt');
    expect(branch.indexOf('diffuseColor.rgb = vColor.rgb * mix(oylDrawn')).toBeLessThan(
      branch.indexOf('if (vOylFacade.w > 0.0)'),
    );
  });

  it('builds none of it with `-overhang-shadows`', () => {
    overhangShadowsOf({} as never, false);
    const { fragment } = compiled();
    expect(fragment).not.toContain('oylOverhangShadeOf');
    expect(fragment).not.toContain('oylCorniceFlag');
    expect(fragment).not.toContain('oylAwningEdge');
    expect(fragment).not.toContain('abs(oylTop) < 0.5 && vOylFacade.w > 0.0');
    // The chain still closes: the railing's branch is its last.
    expect(fragment).toContain('oylTilt = 0.0;\n    }\n  }');
  });
});
