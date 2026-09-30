// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic water reflecting the environment map — #629. What jsdom can
 * say: which material the belt wears in which world, the uniforms it writes
 * from a frame, and three's own cube-UV arithmetic. What it cannot — that the
 * reflection is Fresnel-shaped on a screen — is `game.browser.spec.ts`
 * §"#629".
 */

import { describe, expect, it } from 'vitest';

import { corridorOrigin } from './terrain';
import { lakeValleyRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { metres } from '@onyourleft/domain';
import { cubeUvDefines, WaterBelt } from './three-renderer';

/** A stand-in for a PMREM map: three reads only its image's height when it builds the material. */
const ENVIRONMENT = { image: { width: 768, height: 256 } } as unknown as Parameters<
  WaterBelt['setEnvironment']
>[0];

function lakeside(): ReturnType<typeof sceneFrame> {
  const profile = lakeValleyRoute();
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(1_400) } },
  });
}

interface Uniforms {
  readonly [name: string]: { readonly value: unknown } | undefined;
}

function uniformsOf(belt: WaterBelt): Uniforms {
  return (belt.mesh.material as unknown as { uniforms: Uniforms }).uniforms;
}

describe('the realistic water — #629', () => {
  it('writes three’s own cube-UV defines for a PMREM map of a given height', () => {
    // WebGLProgram.js §generateCubeUVSize, three 0.185.1: maxMip = log2(h) − 2,
    // texelHeight = 1 / h, texelWidth = 1 / (3 · max(2^maxMip, 7 · 16)).
    expect(cubeUvDefines(256)).toEqual({
      ENVMAP_TYPE_CUBE_UV: '',
      CUBEUV_TEXEL_WIDTH: String(1 / 336),
      CUBEUV_TEXEL_HEIGHT: String(1 / 256),
      CUBEUV_MAX_MIP: '6.0',
    });
    expect(cubeUvDefines(1024).CUBEUV_TEXEL_WIDTH).toBe(String(1 / 768));
  });

  it('reflects an environment only once handed one, and only while the water is shaded', () => {
    const belt = new WaterBelt();
    const stylised = belt.mesh.material;
    expect(belt.reflects).toBe(false);
    belt.setEnvironment(ENVIRONMENT);
    expect(belt.reflects).toBe(true);
    const reflecting = belt.mesh.material;
    expect(reflecting).not.toBe(stylised);
    expect(belt.wears(reflecting as never)).toBe(true);
    // The flat rung keeps its one colour in either world.
    belt.setDrawn('flat');
    expect(belt.reflects).toBe(false);
    belt.setDrawn('shaded');
    expect(belt.mesh.material).toBe(reflecting);
    // Leaving the realistic world puts #459's own shader back — the SAME one.
    belt.setEnvironment(undefined);
    expect(belt.mesh.material).toBe(stylised);
    belt.dispose();
  });

  it('samples the environment map it was handed, and the frame’s sun, ripples and Fresnel', () => {
    const belt = new WaterBelt();
    belt.setEnvironment(ENVIRONMENT);
    belt.setEnvironmentTurn(Math.PI / 2);
    const frame = lakeside();
    belt.update(frame.water.surface, frame.world, 3, {
      zenith: [0.4, 0.5, 0.7],
      horizon: [0.6, 0.6, 0.6],
    });
    const uniforms = uniformsOf(belt);
    // THE map, not the clone `UniformsUtils.merge` would have made of it.
    expect(uniforms['envMap']?.value).toBe(ENVIRONMENT);
    expect(uniforms['time']?.value).toBe(3);
    expect(uniforms['fresnelHeld']?.value).toBe(-1);
    const sun = uniforms['sunDirection']?.value as { x: number; y: number; z: number };
    const length = Math.hypot(frame.world.sun.x, frame.world.sun.y, frame.world.sun.z);
    expect(sun.x).toBeCloseTo(frame.world.sun.x / length, 6);
    expect(sun.y).toBeCloseTo(frame.world.sun.y / length, 6);
    // three's rotation of an environment turned a quarter about the vertical,
    // transposed: the matrix's third row's first element is sin(turn).
    const rotation = (uniforms['envMapRotation']?.value as { elements: number[] }).elements;
    expect(rotation[2]).toBeCloseTo(1, 6);
    expect(rotation[6]).toBeCloseTo(-1, 6);
    // The zenith band taken to the brightness #459's water was tuned against.
    expect(uniforms['environmentScale']?.value).toBeGreaterThan(0);
    belt.holdFresnel(0.5);
    belt.update(frame.water.surface, frame.world, 3, {
      zenith: [0.4, 0.5, 0.7],
      horizon: [0.6, 0.6, 0.6],
    });
    expect(uniforms['fresnelHeld']?.value).toBe(0.5);
    belt.dispose();
  });

  it('draws with the environment, Schlick’s Fresnel and a glint it cannot overflow', () => {
    const belt = new WaterBelt();
    belt.setEnvironment(ENVIRONMENT);
    const fragment = (belt.mesh.material as unknown as { fragmentShader: string }).fragmentShader;
    expect(fragment).toContain('textureCubeUV(envMap, envMapRotation *');
    expect(fragment).toContain('0.02 + 0.98 * pow(1.0 - facing, 5.0)');
    expect(fragment).toContain(
      'min(mix(body, sky, fresnel) + sunGlint * glint * fresnel, vec3(1.0))',
    );
    // The ripples are still band-limited — #501 — in the realistic water too.
    expect(fragment).toContain('oylRippleWeight(a1)');
    belt.dispose();
  });
});
