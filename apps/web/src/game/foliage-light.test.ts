// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FOLIAGE_WAVES,
  FOLIAGE_WIND_BEARING_DEGREES,
  foliageWindDirection,
  IMPOSTOR_RELIGHT_RANGE,
  normalisedShade,
  relight,
  scriptSunToward,
  swayAt,
  WOOD_SWAY_SHARE,
} from './foliage-light';
import { REALISTIC_VEGETATION, realisticFiles } from './realistic-assets';

describe('the far band’s light and the breeze — #630', () => {
  it('knows where the script’s sun was: high in the south-east of the plant’s own frame', () => {
    const [x, y, z] = scriptSunToward();
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    // Rotated 35° from straight down about x, then 135° about z, in Blender;
    // so 55° up, and toward Blender's (+x, +y) — three's (+x, −z).
    expect(y).toBeCloseTo(Math.cos((35 * Math.PI) / 180), 6);
    expect(x).toBeCloseTo(0.4056, 3);
    expect(z).toBeCloseTo(-0.4056, 3);
  });

  it('lights a texel the world’s sun faces, and shades one it does not, inside the clamp', () => {
    const world = { ambient: 0.4, direct: 0.68 };
    const facing = relight({ ...world, cosine: 1 }, 0.5);
    const away = relight({ ...world, cosine: -1 }, 0.5);
    expect(facing).toBeGreaterThan(1);
    expect(away).toBeLessThan(1);
    // The same light the script baked, the same shade: the relighting is 1.
    expect(relight({ ambient: 0.45, direct: 1, cosine: 0.3 }, 0.3)).toBeCloseTo(1, 9);
    for (const cosine of [-1, -0.5, 0, 0.5, 1]) {
      for (const script of [-1, 0, 1]) {
        const factor = relight({ ...world, cosine }, script);
        expect(factor).toBeGreaterThanOrEqual(IMPOSTOR_RELIGHT_RANGE[0]);
        expect(factor).toBeLessThanOrEqual(IMPOSTOR_RELIGHT_RANGE[1]);
      }
    }
    // Normalised by the hemisphere's mean cosine, a half.
    expect(normalisedShade(0.4, 0.6, 0.5)).toBeCloseTo(1, 9);
  });

  it('bakes a normal strip for every tree that has an impostor, and ships it', () => {
    for (const models of Object.values(REALISTIC_VEGETATION)) {
      for (const model of models) {
        expect(model.impostorNormals === undefined).toBe(model.impostor === undefined);
        if (model.impostorNormals !== undefined) {
          expect(realisticFiles()).toContain(model.impostorNormals);
        }
      }
    }
  });

  it('sways with the ride’s clock, is still when the clock is, and no two phases move alike', () => {
    expect(swayAt(12.5, 1)).toBe(swayAt(12.5, 1));
    expect(swayAt(12.5, 1)).not.toBe(swayAt(13.8, 1));
    expect(swayAt(12.5, 1)).not.toBe(swayAt(12.5, 2));
    // The waves' weights sum to one: the peak is FOLIAGE_SWAY_METRES.
    expect(FOLIAGE_WAVES.reduce((sum, [, weight]) => sum + weight, 0)).toBeCloseTo(1, 9);
    for (let seconds = 0; seconds < 60; seconds += 0.37) {
      expect(Math.abs(swayAt(seconds, 0.7))).toBeLessThanOrEqual(1);
    }
    expect(WOOD_SWAY_SHARE).toBeLessThan(0.5);
  });

  it('pushes the leaves downwind of its own bearing, and nothing reads the rider’s wind', () => {
    const [west, north] = foliageWindDirection();
    // From 240° (west-south-west of south), so toward 60°: north and EAST,
    // and east is −x in the corridor's frame.
    const toward = ((FOLIAGE_WIND_BEARING_DEGREES + 180) * Math.PI) / 180;
    expect(north).toBeCloseTo(Math.cos(toward), 9);
    expect(west).toBeCloseTo(-Math.sin(toward), 9);
    expect(north).toBeGreaterThan(0);
    expect(west).toBeLessThan(0);
    // A visual breeze: this file names neither the simulation nor its wind.
    const source = readFileSync(new URL('./foliage-light.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/(simulation|wind-choice)'/);
    expect(source).not.toMatch(/@onyourleft\/domain/);
  });
});
