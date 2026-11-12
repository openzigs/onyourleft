// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2508: the realistic world's weathered sky, read back through the function
 * the renderer draws it with. Without this nothing in the PR-gated suites
 * drew a graded realistic sky: replacing it by the loaded one, or never
 * releasing it, left every other test green.
 */

import { DataTexture, FloatType, RGBAFormat } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { releaseWeatheredSkies, weatheredSkyOf, type RealisticSky } from './three-renderer';

function skyOf(): RealisticSky {
  const width = 128;
  const height = 64;
  const data = new Float32Array(width * height * 4);
  for (let at = 0; at < data.length; at += 4) {
    data[at] = 4;
    data[at + 1] = 5;
    data[at + 2] = 6;
    data[at + 3] = 1;
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  const flat = [1, 1, 1] as unknown as RealisticSky['zenith'];
  return {
    texture,
    upward: 3,
    sunU: 0.25,
    zenith: flat,
    horizon: flat,
    skyline: flat,
    directions: [],
    flatDirections: [],
  };
}

const texels = (sky: RealisticSky): number[] =>
  Array.from((sky.texture.image as { data: ArrayLike<number> }).data);

describe('weatheredSkyOf', () => {
  it('draws the loaded sky in clear weather', () => {
    const sky = skyOf();
    expect(weatheredSkyOf(sky, undefined)).toBe(sky);
    expect(weatheredSkyOf(sky, { dusk: false, rain: false })).toBe(sky);
  });

  it('draws a graded copy, built once a weather, in dusk and in rain', () => {
    const sky = skyOf();
    const dusk = weatheredSkyOf(sky, { dusk: true, rain: false });
    expect(dusk).not.toBe(sky);
    expect(dusk.texture).not.toBe(sky.texture);
    expect(texels(dusk)).not.toEqual(texels(sky));
    expect(weatheredSkyOf(sky, { dusk: true, rain: false })).toBe(dusk);
    const rain = weatheredSkyOf(sky, { dusk: false, rain: true });
    expect(rain).not.toBe(dusk);
    expect(texels(rain)).not.toEqual(texels(sky));
    expect(texels(rain)).not.toEqual(texels(dusk));
    // The daytime photograph is left as it was, for the next clear frame.
    expect(texels(sky)[0]).toBe(4);
    expect(dusk.upward).toBe(sky.upward);
  });

  it('lets go of every graded copy, and grades afresh after', () => {
    const sky = skyOf();
    const dusk = weatheredSkyOf(sky, { dusk: true, rain: false });
    const rain = weatheredSkyOf(sky, { dusk: false, rain: true });
    const spies = [dusk, rain].map((each) => vi.spyOn(each.texture, 'dispose'));
    releaseWeatheredSkies(sky);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(weatheredSkyOf(sky, { dusk: true, rain: false })).not.toBe(dusk);
  });
});
