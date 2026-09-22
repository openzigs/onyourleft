// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  ALL_ON,
  BASELINE,
  configQuery,
  MEASUREMENT_MATRIX,
  parseConfig,
  percentiles,
  textureBytes,
} from './config';

describe('the realism page’s configuration — #457', () => {
  it('is the product’s own scene with no query at all', () => {
    expect(parseConfig('')).toEqual(BASELINE);
  });

  it('reads every item', () => {
    expect(
      parseConfig(
        '?sky=1&tone=agx&surfaces=2k&trees=1&rider=1&haze=1&bloom=1&scale=0.5&seconds=60&soak=20&at=900&panel=0',
      ),
    ).toEqual({ ...ALL_ON, scale: 0.5, seconds: 60, soakMinutes: 20, at: 900, panel: false });
  });

  it('refuses a parameter it does not know, rather than measuring the baseline under its name', () => {
    expect(() => parseConfig('?tress=1')).toThrow(/unknown parameter "tress"/);
  });

  it('refuses a value it does not know', () => {
    expect(() => parseConfig('?sky=yes')).toThrow(/sky is 0 or 1/);
    expect(() => parseConfig('?tone=filmic')).toThrow(/tone is one of none, aces, agx/);
    expect(() => parseConfig('?scale=0.6')).toThrow(/scale is one of 1, 0.75, 0.5/);
    expect(() => parseConfig('?surfaces=4k')).toThrow(/surfaces/);
    expect(() => parseConfig('?renderer=webgpu')).toThrow(/renderer is one of webgl/);
    expect(() => parseConfig('?seconds=0')).toThrow(/seconds is a number of at least 1/);
    expect(() => parseConfig('?at=-5')).toThrow(/at is a number of at least 0/);
  });

  it('writes a query that reads back as the same configuration, for every row it measures', () => {
    for (const { config } of MEASUREMENT_MATRIX) {
      expect(parseConfig(configQuery(config))).toEqual(config);
    }
    expect(configQuery(BASELINE)).toBe('');
    const held = { ...ALL_ON, at: 42, panel: false, soakMinutes: 20, seconds: 5 };
    expect(parseConfig(configQuery(held))).toEqual(held);
  });

  it('measures the baseline, each item alone, all on, and all on at both lower scales', () => {
    const names = MEASUREMENT_MATRIX.map((row) => row.name);
    expect(names[0]).toMatch(/baseline/);
    expect(MEASUREMENT_MATRIX[0]?.config).toEqual(BASELINE);
    // Each "alone" row differs from the baseline in exactly one item (tone rides with the sky).
    for (const row of MEASUREMENT_MATRIX.filter((each) => /^\(\d\) (?!all)/.test(each.name))) {
      const changed = (Object.keys(BASELINE) as (keyof typeof BASELINE)[]).filter(
        (key) => row.config[key] !== BASELINE[key] && key !== 'tone',
      );
      expect(changed, row.name).toHaveLength(1);
    }
    expect(
      MEASUREMENT_MATRIX.map((row) => row.config.scale).filter((scale) => scale !== 1),
    ).toEqual([0.75, 0.5]);
    expect(MEASUREMENT_MATRIX.some((row) => row.config === ALL_ON)).toBe(true);
  });
});

describe('nearest-rank percentiles', () => {
  it('takes the smallest sample with at least p% at or below it', () => {
    const samples = Array.from({ length: 100 }, (_, index) => 100 - index);
    expect(percentiles(samples)).toEqual({ p50: 50, p90: 90, p99: 99, count: 100 });
  });

  it('does not reorder the caller’s samples', () => {
    const samples = [3, 1, 2];
    percentiles(samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it('says NaN for an empty sample rather than a frame time of zero', () => {
    const empty = percentiles([]);
    expect(empty.count).toBe(0);
    expect(empty.p50).toBeNaN();
  });

  it('is the one sample when there is one', () => {
    expect(percentiles([16.7])).toEqual({ p50: 16.7, p90: 16.7, p99: 16.7, count: 1 });
  });
});

describe('texture memory, estimated', () => {
  it('adds a third for a full mip chain', () => {
    expect(textureBytes(1024, 1024, 4, false)).toBe(4_194_304);
    expect(textureBytes(1024, 1024, 4, true)).toBe(5_592_405);
  });
});
