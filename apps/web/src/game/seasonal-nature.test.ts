// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Autumn colour by the route's real season, in the realistic world — #1623.
 *
 * What is held here is the renderer's half: that `ThreeGameView.setSeason`
 * writes the route's autumn into the uniform a broadleaf's OWN program reads
 * (read off the material, by compiling it, not off `natureOn`), that a fir,
 * a shrub and a rock are never taught it, and what the shader does with it,
 * evaluated from the GLSL three is handed (`glsl-testing.ts`). The ground's
 * snow is `world.test.ts` §"#1623"; the roofs' is
 * `mapped-building-belt.test.ts` §"#1623".
 *
 * jsdom, for `threeGameRenderer.create`'s canvas; no WebGL, so nothing here
 * renders a frame — the realistic browser spec draws the dates.
 */

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  altitudeMetres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { glslFunction, type GlslValue } from './glsl-testing';
import { qualitySettings } from './quality';
import { seasonOn, type CalendarDay } from './season';
import {
  AUTUMN_HUE_DEGREES,
  prepareRealisticShape,
  RealisticVegetationBelt,
  ScatterBelt,
  threeGameRenderer,
  turnsInAutumn,
  type RealisticShape,
} from './three-renderer';
import { routeHemisphere, routeLatitudeMagnitude } from './world';

/** A geometry three built, taken off a belt so this file names no `three` type. */
function aGeometry(): NonNullable<ReturnType<ScatterBelt['meshesOf']>[number]>['geometry'] {
  const mesh = new ScatterBelt(new Map()).meshesOf('rock')[0];
  if (mesh === undefined) throw new Error('no rock primitive');
  return mesh.geometry.clone();
}

/** What `GLTFLoader` leaves on a mesh: the fields `prepareRealisticShape` reads. */
function loaderMaterial(name: string, transparent = false): Record<string, unknown> {
  return {
    name,
    transparent,
    alphaTest: 0,
    alphaHash: false,
    map: { image: { width: 512, height: 512 }, dispose: () => undefined },
    normalMap: null,
    dispose: () => undefined,
  };
}

const IDENTITY = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };

/** A loaded tree, bark and leaves, with its impostor's strip. */
function aTree(): RealisticShape {
  const extras = {
    oyl_scan_height: 8,
    oyl_scan_width: 4,
    oyl_impostor_scale: 8.2,
    oyl_impostor_frames: 8,
  };
  const scene = {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: false, userData: extras });
      for (const material of [loaderMaterial('bark'), loaderMaterial('leaves', true)]) {
        visit({
          isMesh: true,
          geometry: aGeometry(),
          material,
          matrixWorld: IDENTITY,
          userData: {},
        });
      }
    },
  } as unknown as Parameters<typeof prepareRealisticShape>[0];
  return prepareRealisticShape(scene, 'tree', {
    image: { width: 2048, height: 512 },
  } as unknown as Parameters<typeof prepareRealisticShape>[2]);
}

/** A shrub or a rock: one part, no impostor. */
function aPlant(): RealisticShape {
  const scene = {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({ isMesh: false, userData: { oyl_scan_height: 1, oyl_scan_width: 1 } });
      visit({
        isMesh: true,
        geometry: aGeometry(),
        material: loaderMaterial('plant'),
        matrixWorld: IDENTITY,
        userData: {},
      });
    },
  } as unknown as Parameters<typeof prepareRealisticShape>[0];
  return prepareRealisticShape(scene, 'plant');
}

/** A broadleaf, a fir, a shrub and a rock, each its own shape, in one belt. */
function aWood(): Record<'broadleaf' | 'conifer' | 'shrub' | 'rock', RealisticShape> {
  const wood = { broadleaf: aTree(), conifer: aTree(), shrub: aPlant(), rock: aPlant() };
  new RealisticVegetationBelt(
    new Map([
      ['tree-broadleaf', [wood.broadleaf]],
      ['tree-conifer', [wood.conifer]],
      ['shrub', [wood.shrub]],
      ['rock', [wood.rock]],
    ] as const),
  );
  return wood;
}

/** A material's program after its `onBeforeCompile`, and the uniforms it binds. */
function compiled(material: unknown): {
  readonly fragment: string;
  readonly uniforms: Record<string, { value: unknown } | undefined>;
} {
  const shader = {
    uniforms: {} as Record<string, { value: unknown } | undefined>,
    vertexShader:
      '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader:
      '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
  };
  (material as { onBeforeCompile: (shader: unknown, renderer: unknown) => void }).onBeforeCompile(
    shader,
    undefined,
  );
  return { fragment: shader.fragmentShader, uniforms: shader.uniforms };
}

/** An impostor's own `ShaderMaterial`, as this file reads it. */
function impostorOf(shape: RealisticShape): {
  readonly fragmentShader: string;
  readonly uniforms: Record<string, { value: unknown } | undefined>;
} {
  const material = shape.impostor?.material as unknown as
    | {
        vertexShader: string;
        fragmentShader: string;
        uniforms: Record<string, { value: unknown } | undefined>;
        onBeforeCompile: (shader: unknown, renderer: unknown) => void;
      }
    | undefined;
  if (material === undefined) throw new Error('the tree has no impostor');
  // As three compiles a `ShaderMaterial`: its own text and its own uniforms.
  const shader = {
    vertexShader: material.vertexShader,
    fragmentShader: material.fragmentShader,
    uniforms: material.uniforms,
  };
  material.onBeforeCompile(shader, undefined);
  return shader;
}

/** A route at a latitude, at sea level. */
function routeAt(latitude: number): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(degreesLatitude(latitude), degreesLongitude(index * 0.0002)),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

/** What `GameView` tells a view on a day, for a route — decorations on. */
const seasonFor = (profile: RouteProfile, day: CalendarDay) =>
  seasonOn(day, routeHemisphere(profile), routeLatitudeMagnitude(profile), true);

const OCTOBER_20: CalendarDay = { year: 2026, month: 10, day: 20 };
const NORTH = routeAt(51.5);
const SOUTH = routeAt(-51.5);

/** A linear colour's hue, degrees 0 to 360. */
function hueOf([r, g, b]: readonly [number, number, number]): number {
  const most = Math.max(r, g, b);
  const least = Math.min(r, g, b);
  if (most === least) return 0;
  const span = most - least;
  const hue =
    most === r ? ((g - b) / span) % 6 : most === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (hue * 60 + 360) % 360;
}

function rgb(value: GlslValue): readonly [number, number, number] {
  if (typeof value === 'number') throw new Error('wanted a vec3');
  return value;
}

describe('autumn turns the broadleaves and leaves the firs green — #1623', () => {
  it('teaches a broadleaf its autumn at every level, and a fir, a shrub and a rock never', () => {
    const wood = aWood();
    for (const part of wood.broadleaf.parts) {
      expect(turnsInAutumn(part.material)).toBe(true);
      expect(compiled(part.material).fragment).toContain(
        'diffuseColor.rgb = oylTinted(diffuseColor.rgb, vOylTint);\ndiffuseColor.rgb = oylAutumnOf(diffuseColor.rgb, oylAutumn);',
      );
    }
    expect(impostorOf(wood.broadleaf).fragmentShader).toContain(
      'gl_FragColor = vec4(oylAutumnOf(oylTinted(texel.rgb, vOylTint), oylAutumn), 1.0);',
    );
    for (const shape of [wood.conifer, wood.shrub, wood.rock]) {
      for (const part of shape.parts) {
        expect(turnsInAutumn(part.material)).toBe(false);
        const { fragment, uniforms } = compiled(part.material);
        // Still tinted by #621, and never turned.
        expect(fragment).toContain('oylTinted(diffuseColor.rgb, vOylTint)');
        expect(fragment).not.toContain('oylAutumn');
        expect(uniforms['oylAutumn']).toBeUndefined();
      }
    }
    expect(impostorOf(wood.conifer).fragmentShader).not.toContain('oylAutumn');
    expect(impostorOf(wood.conifer).uniforms['oylAutumn']).toBeUndefined();
  });

  it('sets the autumn of the route’s own hemisphere on the broadleaf’s own program', () => {
    const wood = aWood();
    const [leaves] = wood.broadleaf.parts;
    const program = compiled(leaves?.material);
    const impostor = impostorOf(wood.broadleaf);
    const view = threeGameRenderer.create(document.createElement('canvas'), qualitySettings(0));
    try {
      // 20 October: autumn on a northern route, spring on its southern mirror.
      view.setSeason(seasonFor(NORTH, OCTOBER_20));
      expect(program.uniforms['oylAutumn']?.value).toBeGreaterThan(0.8);
      expect(impostor.uniforms['oylAutumn']?.value).toBe(program.uniforms['oylAutumn']?.value);
      view.setSeason(seasonFor(SOUTH, OCTOBER_20));
      expect(program.uniforms['oylAutumn']?.value).toBe(0);
      expect(impostor.uniforms['oylAutumn']?.value).toBe(0);
      // A route with no positions has no hemisphere, and no season.
      view.setSeason(seasonFor({ ...NORTH, positions: [] }, OCTOBER_20));
      expect(program.uniforms['oylAutumn']?.value).toBe(0);
    } finally {
      view.destroy();
    }
  });

  describe('the autumn arithmetic, evaluated from the program three is handed', () => {
    const autumnOf = (): ((...args: readonly GlslValue[]) => GlslValue) =>
      glslFunction(compiled(aWood().broadleaf.parts[0]?.material).fragment, 'oylAutumnOf');
    const LEAF: readonly [number, number, number] = [0.08, 0.25, 0.04];
    const BARK: readonly [number, number, number] = [0.25, 0.15, 0.08];
    const GREY: readonly [number, number, number] = [0.4, 0.4, 0.4];

    it('returns every colour exactly as it came with no autumn — the season-free picture', () => {
      const autumn = autumnOf();
      for (const colour of [LEAF, BARK, GREY, [0, 0, 0], [1, 1, 1], [0.02, 0.6, 0.1]] as const) {
        expect(autumn(colour, 0)).toEqual(colour);
      }
    });

    it('turns a green leaf to the oranges in a full autumn, about the grey axis', () => {
      const turned = rgb(autumnOf()(LEAF, 1));
      const before = hueOf(LEAF);
      const after = hueOf(turned);
      expect(before).toBeGreaterThan(90);
      expect(after).toBeGreaterThan(15);
      expect(after).toBeLessThan(60);
      expect(before - after).toBeCloseTo(AUTUMN_HUE_DEGREES, -1);
      // Red leads the turned leaf, green the summer one.
      expect(turned[0]).toBeGreaterThan(turned[1]);
      // Half an autumn is half way there.
      const half = hueOf(rgb(autumnOf()(LEAF, 0.5)));
      expect(half).toBeLessThan(before);
      expect(half).toBeGreaterThan(after);
    });

    it('leaves the bark and a grey alone, so a merged tree turns its leaves only', () => {
      const autumn = autumnOf();
      expect(autumn(BARK, 1)).toEqual(BARK);
      expect(autumn(GREY, 1)).toEqual(GREY);
    });
  });
});
