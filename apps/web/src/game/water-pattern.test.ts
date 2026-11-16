// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The water's pattern — #2701: that the ripples do not tile, that a lake has
 * calm and rough patches, and that water too far off for any ripple is still
 * shaded. Every figure is read off the material the water belt actually
 * mounts — the stylised one and the realistic one — and the shader text is
 * held to reading every wave it is handed. What jsdom cannot say, how it looks
 * from the bike, is the owner's screenshots and the moving-ride tablet check.
 */

import { describe, expect, it } from 'vitest';

import {
  WATER_CALM_SHARE,
  WATER_GUSTS,
  WATER_RIPPLES,
  WaterBelt,
  type WaterWave,
} from './three-renderer';

/** A stand-in for a PMREM map, as `realistic-water.test.ts` uses. */
const ENVIRONMENT = { image: { width: 768, height: 256 } } as unknown as Parameters<
  WaterBelt['setEnvironment']
>[0];

interface MountedWater {
  readonly fragmentShader: string;
  readonly uniforms: Record<string, { readonly value: unknown } | undefined>;
}

/** The stylised and the realistic water, each as the belt mounts it. */
function mountedMaterials(): { readonly name: string; readonly material: MountedWater }[] {
  const belt = new WaterBelt();
  const stylised = belt.mesh.material as unknown as MountedWater;
  belt.setEnvironment(ENVIRONMENT);
  const realistic = belt.mesh.material as unknown as MountedWater;
  expect(realistic).not.toBe(stylised);
  return [
    { name: 'stylised', material: stylised },
    { name: 'realistic', material: realistic },
  ];
}

/** A wave set as the shader reads it, off one of the material's `vec4[]` uniforms. */
function wavesOf(material: MountedWater, name: 'ripples' | 'gusts'): WaterWave[] {
  const value = material.uniforms[name]?.value as
    readonly { x: number; y: number; z: number; w: number }[] | undefined;
  return (value ?? []).map((v) => ({ kx: v.x, kz: v.y, speed: v.z, amplitude: v.w }));
}

/** A wave's slope at its steepest: `amplitude · |k|`. */
function slopeOf(wave: WaterWave): number {
  return wave.amplitude * Math.hypot(wave.kx, wave.kz);
}

/**
 * The share of shifts between 2 m and `radius` metres, on a 5 cm grid, that
 * take the ripples' slope field to within `threshold` correlation of itself.
 * For a sum of plane waves this is exact: the field's autocorrelation at a
 * shift `s` is `Σ slope² · cos(k·s) / Σ slope²`. A tiled pattern is a large
 * share — every lattice point is a perfect repeat; a non-repeating one a tiny
 * one. Half the disc is enough: the autocorrelation is even.
 */
function repeatShare(waves: readonly WaterWave[], radius: number, threshold: number): number {
  const weights = waves.map((wave) => slopeOf(wave) ** 2);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const step = 0.05;
  let shifts = 0;
  let repeats = 0;
  for (let x = -radius; x <= radius; x += step) {
    for (let z = 0; z <= radius; z += step) {
      const length = Math.hypot(x, z);
      if (length < 2 || length > radius) continue;
      shifts += 1;
      let correlation = 0;
      waves.forEach((wave, i) => {
        correlation += (weights[i] ?? 0) * Math.cos(wave.kx * x + wave.kz * z);
      });
      if (correlation / total >= threshold) repeats += 1;
    }
  }
  return repeats / shifts;
}

/** #459's two ripples, as its shader wrote them before #2701: the control. */
const RIPPLES_459: readonly WaterWave[] = [
  { kx: 0.83 * 1.7, kz: 0.56 * 1.7, speed: 1.3, amplitude: 0.06 / 1.7 },
  { kx: -0.47 * 2.9, kz: 0.88 * 2.9, speed: -1.9, amplitude: 0.058 / 2.9 },
];

/** Every point of a 240 m square lake on a 1 m grid. */
function acrossALake(visit: (x: number, z: number) => void): void {
  for (let x = 0; x <= 240; x += 1) for (let z = 0; z <= 240; z += 1) visit(x, z);
}

describe('the water does not look flat and tiled — #2701', () => {
  it('mounts its ripples and gusts on both waters, and the shader reads every one', () => {
    for (const { name, material } of mountedMaterials()) {
      expect(wavesOf(material, 'ripples'), name).toEqual(WATER_RIPPLES);
      expect(wavesOf(material, 'gusts'), name).toEqual(WATER_GUSTS);
      const shader = material.fragmentShader;
      expect(shader, name).toContain(`uniform vec4 ripples[${String(WATER_RIPPLES.length)}];`);
      expect(shader, name).toContain(`uniform vec4 gusts[${String(WATER_GUSTS.length)}];`);
      WATER_RIPPLES.forEach((_, i) => {
        const a = `a${String(i + 1)}`;
        expect(shader, `${name} ripple ${String(i)}`).toContain(
          `float ${a} = dot(p, ripples[${String(i)}].xy) + time * ripples[${String(i)}].z;`,
        );
        // Each one band-limited, #501, in both waters.
        expect(shader, `${name} ripple ${String(i)}`).toContain(
          `ripples[${String(i)}].w * oylRippleWeight(${a}) * cos(${a}) * ripples[${String(i)}].xy`,
        );
      });
      WATER_GUSTS.forEach((_, i) => {
        const g = `g${String(i + 1)}`;
        expect(shader, `${name} gust ${String(i)}`).toContain(
          `float ${g} = dot(p, gusts[${String(i)}].xy) + time * gusts[${String(i)}].z;`,
        );
        expect(shader, `${name} gust ${String(i)}`).toContain(`sin(${g})`);
        expect(shader, `${name} gust ${String(i)}`).toContain(
          `gusts[${String(i)}].w * oylRippleWeight(${g}) * cos(${g}) * gusts[${String(i)}].xy`,
        );
      });
      // The gusts scale the ripples, and the sum is the normal's slope.
      expect(shader, name).toContain('vec2 slope = rough * (');
      expect(shader, name).toContain('vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));');
    }
  });

  it('does not repeat its ripples within 40 m, where #459’s pair repeated every 7.4 m', () => {
    // The control: two plane waves are a lattice, and the field comes back to
    // itself on a measurable share of every shift a lake in view spans.
    const control = repeatShare(RIPPLES_459, 40, 0.9);
    expect(control).toBeGreaterThan(0.02);
    for (const { name, material } of mountedMaterials()) {
      const ripples = wavesOf(material, 'ripples');
      // Non-vacuity: waves at the slope #459's water was tuned to, not a
      // still lake that trivially never repeats.
      expect(ripples.length, name).toBeGreaterThan(2);
      const steepest = ripples.reduce((sum, wave) => sum + slopeOf(wave), 0);
      expect(steepest, name).toBeGreaterThan(0.1);
      expect(steepest, name).toBeLessThan(0.2);
      const share = repeatShare(ripples, 40, 0.9);
      expect(share, name).toBeLessThan(0.002);
      expect(share, name).toBeLessThan(control / 10);
    }
  });

  it('has calm and rough patches across a lake, from the gusts', () => {
    for (const { name, material } of mountedMaterials()) {
      const gusts = wavesOf(material, 'gusts');
      expect(gusts.length, name).toBeGreaterThan(0);
      // The shader's own `rough`, at t = 0: the ripples' share of their slope.
      let calmest = Infinity;
      let roughest = -Infinity;
      acrossALake((x, z) => {
        const sum = gusts.reduce((total, gust) => total + Math.sin(gust.kx * x + gust.kz * z), 0);
        const rough = WATER_CALM_SHARE + (1 - WATER_CALM_SHARE) * (0.5 + sum / (2 * gusts.length));
        calmest = Math.min(calmest, rough);
        roughest = Math.max(roughest, rough);
      });
      expect(calmest, name).toBeLessThan(0.55);
      expect(calmest, name).toBeGreaterThanOrEqual(WATER_CALM_SHARE);
      expect(roughest, name).toBeGreaterThan(0.9);
      expect(roughest, name).toBeLessThanOrEqual(1);
      expect(material.fragmentShader, name).toContain(
        `float rough = mix(${String(WATER_CALM_SHARE)}, 1.0, 0.5 + (${gusts
          .map((_, i) => `sin(g${String(i + 1)})`)
          .join(' + ')}) / ${(2 * gusts.length).toFixed(1)});`,
      );
    }
  });

  it('still shades water too far off for any ripple, with a swell too long to alias', () => {
    for (const { name, material } of mountedMaterials()) {
      const gusts = wavesOf(material, 'gusts');
      const ripples = wavesOf(material, 'ripples');
      const longestRipple = Math.max(
        ...ripples.map((wave) => (2 * Math.PI) / Math.hypot(wave.kx, wave.kz)),
      );
      // Every gust is longer than any ripple, so it is the last thing to fade,
      // and every one tilts the surface: a gust too slight to see is a patch
      // pattern with nothing behind its shading.
      for (const gust of gusts) {
        expect((2 * Math.PI) / Math.hypot(gust.kx, gust.kz), name).toBeGreaterThan(
          2 * longestRipple,
        );
        expect(slopeOf(gust), name).toBeGreaterThan(0.01);
      }
      // Its slope, root mean square across a lake: a degree or so of tilt,
      // which at a grazing angle moves the Fresnel term and the reflected sky.
      let squares = 0;
      let points = 0;
      acrossALake((x, z) => {
        let sx = 0;
        let sz = 0;
        for (const gust of gusts) {
          const c = gust.amplitude * Math.cos(gust.kx * x + gust.kz * z);
          sx += c * gust.kx;
          sz += c * gust.kz;
        }
        squares += sx * sx + sz * sz;
        points += 1;
      });
      const rms = Math.sqrt(squares / points);
      expect(rms, name).toBeGreaterThan(0.01);
      expect(rms, name).toBeLessThan(0.05);
    }
  });
});
