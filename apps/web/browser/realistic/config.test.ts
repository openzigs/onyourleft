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
  surfacesWithLevers,
  treesWithLevers,
} from './config';
import { REALISTIC_TREE_SETS, REALISTIC_TREES_DEFAULT } from '../../src/game/realistic-assets';

describe('the realistic page’s configuration — ADR 0026 D-12', () => {
  it('rides the realistic world with the ladder running when given no query', () => {
    expect(parseConfig('')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.world).toBe('realistic');
    expect(DEFAULT_CONFIG.ladder).toBe(true);
  });

  it('reads every parameter', () => {
    expect(
      parseConfig(
        '?world=stylised&rung=1&ladder=0&seconds=60&soak=20&at=900&panel=0&layers=-water,-sky&levers=-texture-bias&facing=sun',
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
      facing: 'sun',
    });
  });

  it('turns the route towards the sun or away from it only when asked — #702', () => {
    expect(parseConfig('').facing).toBeUndefined();
    expect(parseConfig('?facing=sun').facing).toBe('sun');
    expect(parseConfig('?facing=away').facing).toBe('away');
    // A typo would otherwise hold the unturned route under the name of a turned one.
    expect(() => parseConfig('?facing=south-west')).toThrow(/facing is one of sun, away/);
    expect(() => parseConfig('?facing=')).toThrow(/facing is one of sun, away/);
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
    // #1274's, the steep bank's rock face against the scree it wore before.
    expect(LEVERS).toContain('crag');
    expect(parseConfig('?levers=-crag,-air').leversOff).toEqual(['air', 'crag']);
    // #1283's, the generated trees against the scans they replaced.
    expect(LEVERS).toContain('generated-trees');
    expect(parseConfig('?levers=-texture-bias,-generated-trees').leversOff).toEqual([
      'generated-trees',
      'texture-bias',
    ]);
    // #1534's, the villages' ground left wooded.
    expect(LEVERS).toContain('settlement-clearing');
    expect(parseConfig('?levers=-settlement-clearing').leversOff).toEqual(['settlement-clearing']);
    expect(parseConfig('').leversOff).toEqual([]);
    expect(() => parseConfig('?levers=-texture')).toThrow(/levers is a comma-separated list/);
    expect(() => parseConfig('?levers=texture-bias')).toThrow(/levers is a comma-separated list/);
  });

  it('builds both surfaces’ shaders, as the product does, unless a #1523 lever takes one out', () => {
    expect(LEVERS).toContain('ground-blend');
    expect(LEVERS).toContain('road-wear');
    // No lever is the product, and no OTHER lever touches either surface.
    expect(surfacesWithLevers([])).toEqual({ groundBlend: true, roadWear: true });
    expect(surfacesWithLevers(parseConfig('?levers=-air,-crag,-texture-bias').leversOff)).toEqual({
      groundBlend: true,
      roadWear: true,
    });
    // Each lever its own surface, and only that one.
    expect(surfacesWithLevers(parseConfig('?levers=-ground-blend').leversOff)).toEqual({
      groundBlend: false,
      roadWear: true,
    });
    expect(surfacesWithLevers(parseConfig('?levers=-road-wear').leversOff)).toEqual({
      groundBlend: true,
      roadWear: false,
    });
    expect(surfacesWithLevers(parseConfig('?levers=-road-wear,-ground-blend').leversOff)).toEqual({
      groundBlend: false,
      roadWear: false,
    });
    // And the URL round-trips, so a tablet row names the program it measured.
    expect(configQuery(parseConfig('?levers=-road-wear,-ground-blend'))).toBe(
      `?levers=${encodeURIComponent('-ground-blend,-road-wear')}`,
    );
  });

  it('loads the trees the product loads unless the generated ones are switched off — #1283', () => {
    // No lever is the product: the page must not draw a set a ride does not.
    expect(treesWithLevers([])).toBe(REALISTIC_TREES_DEFAULT);
    expect(treesWithLevers(parseConfig('?levers=-air,-crag').leversOff)).toBe(
      REALISTIC_TREES_DEFAULT,
    );
    // Off is the OTHER set, whichever the product's is, and not the same one.
    const off = treesWithLevers(parseConfig('?levers=-generated-trees').leversOff);
    expect(off).toBe('scanned');
    expect(off).not.toBe(REALISTIC_TREES_DEFAULT);
    expect(REALISTIC_TREE_SETS).toContain(off);
    // And the URL round-trips, so a soak's row names the set it measured.
    expect(configQuery(parseConfig('?levers=-generated-trees'))).toBe('?levers=-generated-trees');
  });

  it('loads the scanned firs beside the generated broadleaves with the fir’s own lever off — #1294', () => {
    expect(LEVERS).toContain('generated-conifers');
    const firs = treesWithLevers(parseConfig('?levers=-generated-conifers').leversOff);
    expect(firs).toBe('scanned-conifers');
    expect(firs).not.toBe(REALISTIC_TREES_DEFAULT);
    expect(REALISTIC_TREE_SETS).toContain(firs);
    // Every tree's scan with the trees' lever off, whether or not the fir's is
    // off too: scanned broadleaves beside generated firs is no set at all.
    for (const query of [
      '?levers=-generated-trees',
      '?levers=-generated-trees,-generated-conifers',
      '?levers=-generated-conifers,-generated-trees',
    ]) {
      expect(treesWithLevers(parseConfig(query).leversOff), query).toBe('scanned');
    }
    // Another lever beside it changes nothing about the trees.
    expect(treesWithLevers(parseConfig('?levers=-air,-generated-conifers').leversOff)).toBe(
      'scanned-conifers',
    );
    expect(configQuery(parseConfig('?levers=-generated-conifers'))).toBe(
      '?levers=-generated-conifers',
    );
    // Every set the renderer can load has a URL that loads it.
    expect(
      ['', '?levers=-generated-conifers', '?levers=-generated-trees'].map((query) =>
        treesWithLevers(parseConfig(query).leversOff),
      ),
    ).toEqual([...REALISTIC_TREE_SETS]);
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
      '?at=2550&facing=sun&levers=-air',
      '?facing=away',
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
