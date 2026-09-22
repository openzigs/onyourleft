// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { configQuery, DEFAULT_CONFIG, parseConfig, percentiles } from './config';

describe('the realistic page’s configuration — ADR 0026 D-12', () => {
  it('rides the realistic world with the ladder running when given no query', () => {
    expect(parseConfig('')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.world).toBe('realistic');
    expect(DEFAULT_CONFIG.ladder).toBe(true);
  });

  it('reads every parameter', () => {
    expect(
      parseConfig('?world=stylised&rung=1&ladder=0&seconds=60&soak=20&at=900&panel=0'),
    ).toEqual({
      world: 'stylised',
      rung: 1,
      ladder: false,
      seconds: 60,
      soakMinutes: 20,
      at: 900,
      panel: false,
    });
  });

  it('refuses a parameter it does not know, rather than measuring the default under its name', () => {
    expect(() => parseConfig('?wrold=stylised')).toThrow(/unknown parameter "wrold"/);
  });

  it('refuses a value it does not know', () => {
    expect(() => parseConfig('?world=photoreal')).toThrow(/world is one of realistic, stylised/);
    expect(() => parseConfig('?rung=2')).toThrow(/rung is one of 0, 1/);
    expect(() => parseConfig('?ladder=yes')).toThrow(/ladder/);
    expect(() => parseConfig('?seconds=0')).toThrow(/seconds is a number of at least 1/);
    expect(() => parseConfig('?at=-5')).toThrow(/at is a number of at least 0/);
  });

  it('writes back a query that reads as the same configuration', () => {
    for (const search of ['', '?world=stylised', '?rung=1&ladder=0&soak=20', '?at=900&panel=0']) {
      const config = parseConfig(search);
      expect(parseConfig(configQuery(config))).toEqual(config);
    }
  });
});

describe('nearest-rank percentiles', () => {
  it('reads a sample as a person would', () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentiles(samples)).toEqual({ p50: 50, p90: 90, p99: 99, count: 100 });
  });

  it('says NaN for nothing timed, never zero', () => {
    expect(Number.isNaN(percentiles([]).p50)).toBe(true);
  });
});
