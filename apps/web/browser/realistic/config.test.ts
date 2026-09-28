// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  configQuery,
  DEFAULT_CONFIG,
  LAYERS,
  LEVERS,
  parseConfig,
  percentiles,
  rungWithLevers,
} from './config';

describe('the realistic page’s configuration — ADR 0026 D-12', () => {
  it('rides the realistic world with the ladder running when given no query', () => {
    expect(parseConfig('')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.world).toBe('realistic');
    expect(DEFAULT_CONFIG.ladder).toBe(true);
  });

  it('reads every parameter', () => {
    expect(
      parseConfig(
        '?world=stylised&rung=1&ladder=0&seconds=60&soak=20&at=900&panel=0&layers=-water,-sky&levers=-texture-bias',
      ),
    ).toEqual({
      world: 'stylised',
      rung: 1,
      ladder: false,
      seconds: 60,
      soakMinutes: 20,
      at: 900,
      panel: false,
      layersOff: ['sky', 'water'],
      leversOff: ['texture-bias'],
    });
  });

  it('switches off each of #619’s levers by name, once, in a fixed order, and refuses any other', () => {
    for (const lever of LEVERS) {
      expect(parseConfig(`?levers=-${lever}`).leversOff).toEqual([lever]);
    }
    expect(parseConfig('?levers=-texture-bias,-foliage-order,-texture-bias').leversOff).toEqual([
      'foliage-order',
      'texture-bias',
    ]);
    // #622's by-eye lever, in the same list.
    expect(parseConfig('?levers=-texture-bias,-air').leversOff).toEqual(['air', 'texture-bias']);
    expect(parseConfig('').leversOff).toEqual([]);
    expect(() => parseConfig('?levers=-texture')).toThrow(/levers is a comma-separated list/);
    expect(() => parseConfig('?levers=texture-bias')).toThrow(/levers is a comma-separated list/);
  });

  it('takes the rung’s texture bias out when that lever is off, and leaves the rung alone otherwise — #619', () => {
    const rung = { label: 'realistic, reduced', textureLodBias: 1 };
    expect(rungWithLevers(rung, [])).toBe(rung);
    expect(rungWithLevers(rung, ['foliage-order'])).toBe(rung);
    expect(rungWithLevers(rung, ['air'])).toBe(rung);
    expect(rungWithLevers(rung, ['texture-bias'])).toEqual({ ...rung, textureLodBias: 0 });
  });

  it('switches off each layer by name, once, in a fixed order — #616', () => {
    for (const layer of LAYERS) {
      expect(parseConfig(`?layers=-${layer}`).layersOff).toEqual([layer]);
    }
    expect(parseConfig('?layers=-riders,-sky,-riders').layersOff).toEqual(['sky', 'riders']);
    expect(parseConfig('').layersOff).toEqual([]);
  });

  it('refuses a layer it does not know, or one not written as switched off — #616', () => {
    // A typo would otherwise measure every layer ON under the name of one that was off.
    expect(() => parseConfig('?layers=-vegtation')).toThrow(/layers is a comma-separated list/);
    expect(() => parseConfig('?layers=vegetation')).toThrow(/layers is a comma-separated list/);
    expect(() => parseConfig('?layers=')).toThrow(/layers is a comma-separated list/);
    expect(() => parseConfig('?layers=-water,')).toThrow(/layers is a comma-separated list/);
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
    for (const search of [
      '',
      '?world=stylised',
      '?rung=1&ladder=0&soak=20',
      '?at=900&panel=0',
      '?layers=-impostors,-vegetation',
      '?rung=1&ladder=0&levers=-foliage-order,-texture-bias',
    ]) {
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
