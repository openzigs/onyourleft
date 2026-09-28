// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  FOLIAGE_TINT,
  instanceTint,
  MASONRY_TINT,
  NO_TINT,
  packedInstanceTint,
  packInstanceTint,
  TINT_CODEC_RANGE,
  tintedLinear,
  unpackInstanceTint,
  type InstanceTint,
  type TintBound,
} from './instance-tint';

/** Every place on a 1.3 m grid across a 400 m square: 95 000 items' worth. */
function places(): { x: number; z: number }[] {
  const found: { x: number; z: number }[] = [];
  for (let x = -200; x < 200; x += 1.3) {
    for (let z = -200; z < 200; z += 1.3) found.push({ x, z });
  }
  return found;
}

function within(tint: InstanceTint, bound: TintBound): boolean {
  return (
    Math.abs(tint.hueDegrees) <= bound.hueDegrees &&
    Math.abs(tint.saturation) <= bound.saturation &&
    Math.abs(tint.brightness) <= bound.brightness
  );
}

describe('the bounds a realistic instance’s tint is drawn inside — #621', () => {
  it('lands #621’s starting figures: ±12 % brightness, ±10 % saturation, ±8° foliage and ±4° masonry hue', () => {
    expect(FOLIAGE_TINT).toEqual({ hueDegrees: 8, saturation: 0.1, brightness: 0.12 });
    expect(MASONRY_TINT).toEqual({ hueDegrees: 4, saturation: 0.1, brightness: 0.12 });
    expect(NO_TINT).toEqual({ hueDegrees: 0, saturation: 0, brightness: 0 });
  });

  it('can carry both bounds, so the codec never clamps a product tint', () => {
    for (const bound of [FOLIAGE_TINT, MASONRY_TINT]) {
      expect(bound.hueDegrees).toBeLessThanOrEqual(TINT_CODEC_RANGE.hueDegrees);
      expect(bound.saturation).toBeLessThanOrEqual(TINT_CODEC_RANGE.saturation);
      expect(bound.brightness).toBeLessThanOrEqual(TINT_CODEC_RANGE.brightness);
    }
  });

  // ⚠️ **10 s, a hang guard rather than a budget — #682.** Vitest's default 5 s was nobody's choice
  // for this case: under coverage on CI it took 1.8 s to 3.1 s over thirteen green `main` runs on
  // 2026-09-28 (36370135206 to 36405580515), the slowest on 36395959573 (the slower of the two
  // runners, a job over 1 000 s) — 61 % of that default. 10 s is about three times the slowest, so
  // a hang is still red.
  it('keeps every tint inside its bound, and uses most of it', () => {
    for (const bound of [FOLIAGE_TINT, MASONRY_TINT]) {
      let widest = { hueDegrees: 0, saturation: 0, brightness: 0 };
      for (const { x, z } of places()) {
        const tint = instanceTint(x, z, bound);
        expect(within(tint, bound), `${String(x)}, ${String(z)}`).toBe(true);
        widest = {
          hueDegrees: Math.max(widest.hueDegrees, Math.abs(tint.hueDegrees)),
          saturation: Math.max(widest.saturation, Math.abs(tint.saturation)),
          brightness: Math.max(widest.brightness, Math.abs(tint.brightness)),
        };
      }
      // Non-vacuity: a tint of nothing is inside every bound.
      expect(widest.hueDegrees).toBeGreaterThan(0.9 * bound.hueDegrees);
      expect(widest.saturation).toBeGreaterThan(0.9 * bound.saturation);
      expect(widest.brightness).toBeGreaterThan(0.9 * bound.brightness);
    }
  }, 10_000);

  it('turns masonry’s hue half as far as foliage’s, at the same place', () => {
    const { x, z } = { x: 17.25, z: -3.5 };
    const foliage = instanceTint(x, z, FOLIAGE_TINT);
    const masonry = instanceTint(x, z, MASONRY_TINT);
    expect(Math.abs(masonry.hueDegrees - foliage.hueDegrees / 2)).toBeLessThan(0.2);
    expect(masonry.brightness).toBe(foliage.brightness);
  });

  it('draws no tint at all inside a bound of nothing, and packs it as nought', () => {
    for (const { x, z } of places().slice(0, 500)) {
      expect(packedInstanceTint(x, z, NO_TINT)).toBe(0);
    }
  });
});

describe('where a tint comes from — #621', () => {
  it('is the same for the same place, every time it is asked', () => {
    for (const { x, z } of places().slice(0, 500)) {
      expect(packedInstanceTint(x, z, FOLIAGE_TINT)).toBe(packedInstanceTint(x, z, FOLIAGE_TINT));
    }
  });

  it('varies from item to item: no two neighbours share one, and each part is spread across its bound', () => {
    const tints = places().map(({ x, z }) => packedInstanceTint(x, z, FOLIAGE_TINT));
    // Neighbours in the list are 1.3 m apart: hardly ever one tint.
    let shared = 0;
    for (let at = 1; at < tints.length; at += 1) if (tints[at] === tints[at - 1]) shared += 1;
    expect(shared).toBeLessThan(0.001 * tints.length);
    expect(new Set(tints).size).toBeGreaterThan(0.95 * tints.length);
    // Each part's mean is near nought and its spread near a uniform's (bound / √3).
    const parts = tints.map(unpackInstanceTint);
    for (const [part, bound] of [
      ['hueDegrees', FOLIAGE_TINT.hueDegrees],
      ['saturation', FOLIAGE_TINT.saturation],
      ['brightness', FOLIAGE_TINT.brightness],
    ] as const) {
      const values = parts.map((tint) => tint[part]);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const spread = Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
      );
      expect(Math.abs(mean), part).toBeLessThan(0.02 * bound);
      expect(spread / (bound / Math.sqrt(3)), part).toBeCloseTo(1, 1);
    }
  });

  it('does not tie one part to another', () => {
    const parts = places().map(({ x, z }) => instanceTint(x, z, FOLIAGE_TINT));
    const correlation = (a: readonly number[], b: readonly number[]): number => {
      const mean = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
      const [ma, mb] = [mean(a), mean(b)];
      let [ab, aa, bb] = [0, 0, 0];
      for (let at = 0; at < a.length; at += 1) {
        const [da, db] = [(a[at] ?? 0) - ma, (b[at] ?? 0) - mb];
        ab += da * db;
        aa += da * da;
        bb += db * db;
      }
      return ab / Math.sqrt(aa * bb);
    };
    const hue = parts.map((tint) => tint.hueDegrees);
    const saturation = parts.map((tint) => tint.saturation);
    const brightness = parts.map((tint) => tint.brightness);
    expect(Math.abs(correlation(hue, saturation))).toBeLessThan(0.02);
    expect(Math.abs(correlation(hue, brightness))).toBeLessThan(0.02);
    expect(Math.abs(correlation(saturation, brightness))).toBeLessThan(0.02);
  });

  it('keys by where an item stands to a sixteenth of a metre, not by its exact float', () => {
    // The same place recomputed with a rounding error is the same item.
    expect(packedInstanceTint(12.3 + 1e-9, 40.1 - 1e-9, FOLIAGE_TINT)).toBe(
      packedInstanceTint(12.3, 40.1, FOLIAGE_TINT),
    );
  });
});

describe('the one float a tint travels in — #621', () => {
  it('reads back what was packed, to one step of its codec, never past it', () => {
    const tint = { hueDegrees: 5.5, saturation: -0.07, brightness: 0.11 };
    const back = unpackInstanceTint(packInstanceTint(tint));
    expect(Math.abs(back.hueDegrees - tint.hueDegrees)).toBeLessThanOrEqual(
      TINT_CODEC_RANGE.hueDegrees / 127,
    );
    expect(Math.abs(back.saturation - tint.saturation)).toBeLessThanOrEqual(
      TINT_CODEC_RANGE.saturation / 127,
    );
    expect(Math.abs(back.brightness - tint.brightness)).toBeLessThanOrEqual(
      TINT_CODEC_RANGE.brightness / 127,
    );
    expect(Math.abs(back.hueDegrees)).toBeLessThanOrEqual(Math.abs(tint.hueDegrees));
  });

  it('stores no tint as nought, so an instance colour three left at nought draws the model untinted', () => {
    expect(packInstanceTint(NO_TINT)).toBe(0);
    expect(unpackInstanceTint(0)).toEqual({ hueDegrees: 0, saturation: 0, brightness: 0 });
  });

  it('keeps every packed value an integer a float carries exactly, and each part apart', () => {
    const extremes = [-1, 0, 1].flatMap((h) =>
      [-1, 0, 1].flatMap((s) =>
        [-1, 0, 1].map((b) => ({
          hueDegrees: h * TINT_CODEC_RANGE.hueDegrees,
          saturation: s * TINT_CODEC_RANGE.saturation,
          brightness: b * TINT_CODEC_RANGE.brightness,
        })),
      ),
    );
    for (const tint of extremes) {
      const packed = packInstanceTint(tint);
      expect(Number.isInteger(packed)).toBe(true);
      expect(Math.fround(packed)).toBe(packed);
      const back = unpackInstanceTint(Math.fround(packed));
      expect(back.hueDegrees).toBeCloseTo(tint.hueDegrees, 9);
      expect(back.saturation).toBeCloseTo(tint.saturation, 9);
      expect(back.brightness).toBeCloseTo(tint.brightness, 9);
    }
  });

  it('clamps a tint past the codec’s range rather than wrapping it into another part', () => {
    const back = unpackInstanceTint(
      packInstanceTint({ hueDegrees: 90, saturation: -3, brightness: 0 }),
    );
    expect(back).toEqual({
      hueDegrees: TINT_CODEC_RANGE.hueDegrees,
      saturation: -TINT_CODEC_RANGE.saturation,
      brightness: 0,
    });
  });
});

describe('what a tint does to a colour — #621', () => {
  const leaf: [number, number, number] = [0.05, 0.12, 0.03];
  const luminance = ([r, g, b]: readonly number[]): number =>
    0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);

  it('leaves a colour alone at no tint', () => {
    const back = tintedLinear(leaf, NO_TINT);
    for (let at = 0; at < 3; at += 1) expect(back[at]).toBeCloseTo(leaf[at] ?? 0, 12);
  });

  it('scales the brightness by the brightness part, and nothing else', () => {
    const back = tintedLinear(leaf, { hueDegrees: 0, saturation: 0, brightness: 0.12 });
    for (let at = 0; at < 3; at += 1) expect(back[at]).toBeCloseTo((leaf[at] ?? 0) * 1.12, 12);
  });

  it('moves the saturation about the luminance, keeping the luminance', () => {
    const back = tintedLinear(leaf, { hueDegrees: 0, saturation: -0.1, brightness: 0 });
    expect(luminance(back)).toBeCloseTo(luminance(leaf), 12);
    // Nearer grey: every channel moved toward the luminance.
    for (let at = 0; at < 3; at += 1) {
      expect(Math.abs((back[at] ?? 0) - luminance(leaf))).toBeLessThan(
        Math.abs((leaf[at] ?? 0) - luminance(leaf)),
      );
    }
  });

  it('turns the hue about grey, leaving a grey alone and a colour’s sum unchanged', () => {
    const grey: [number, number, number] = [0.3, 0.3, 0.3];
    const turnedGrey = tintedLinear(grey, { hueDegrees: 8, saturation: 0, brightness: 0 });
    for (let at = 0; at < 3; at += 1) expect(turnedGrey[at]).toBeCloseTo(0.3, 12);
    const turned = tintedLinear(leaf, { hueDegrees: 8, saturation: 0, brightness: 0 });
    expect(turned.reduce((s, c) => s + c, 0)).toBeCloseTo(
      leaf.reduce((s, c) => s + c, 0),
      12,
    );
    // …and it did turn: green toward blue for a positive turn.
    expect(turned[2]).toBeGreaterThan(leaf[2]);
  });
});
