// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  configQuery,
  countrysideWithLevers,
  DEFAULT_CONFIG,
  firPrepassWithLevers,
  LAYERS,
  LEVERS,
  parseConfig,
  percentiles,
  rungWithLevers,
  seasonWithLevers,
  decorationsWithConfig,
  PROBE_DECORATIONS,
  surfacesWithLevers,
  treesWithLevers,
  splitRoofsWithLevers,
  urbanClassWithLevers,
  windowRevealsWithLevers,
  overhangShadowsWithLevers,
  weatheringWithLevers,
  windowRoomsWithLevers,
  lotRealismWithLevers,
} from './config';
import { ANCHOR_KINDS, HOLIDAY_DECORATIONS } from '../../src/game/decorations';
import { PLACES } from '../../src/demo/synthetic-road';
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
        '?world=stylised&rung=1&ladder=0&seconds=60&soak=20&at=900&panel=0&layers=-water,-sky&levers=-texture-bias&facing=sun&town=mixed',
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
      town: 'mixed',
      route: undefined,
      date: undefined,
      decorations: undefined,
      place: undefined,
    });
  });

  it('rides the village road only when asked, refuses any other, and never beside a town — #1559', () => {
    expect(parseConfig('').route).toBeUndefined();
    expect(parseConfig('?route=village').route).toBe('village');
    expect(configQuery(parseConfig('?route=village&at=820&panel=0&ladder=0'))).toBe(
      '?ladder=0&at=820&panel=0&route=village',
    );
    // A typo would otherwise ride the valley road under the village's name.
    expect(() => parseConfig('?route=villages')).toThrow(/route is one of village/);
    expect(() => parseConfig('?route=')).toThrow(/route is one of village/);
    // Two roads named at once would measure one under the other's name.
    expect(() => parseConfig('?route=village&town=mixed')).toThrow(/route and town/);
    expect(() => parseConfig('?town=richmond&route=village')).toThrow(/route and town/);
    // The village road turns to the sun as the default one does.
    expect(parseConfig('?route=village&facing=sun').facing).toBe('sun');
  });

  it('rides through the mixed town only when asked, and refuses any other — #1581', () => {
    expect(parseConfig('').town).toBeUndefined();
    expect(parseConfig('?town=mixed').town).toBe('mixed');
    expect(configQuery(parseConfig('?town=mixed&at=1200'))).toBe('?at=1200&town=mixed');
    expect(() => parseConfig('?town=rows')).toThrow(/town is one of mixed/);
    // #1585: the Richmond street, models beside extrusions.
    expect(parseConfig('?town=richmond').town).toBe('richmond');
    // #1542: the countryside, for its levers.
    expect(parseConfig('?town=countryside').town).toBe('countryside');
    // #1635: the terraced street, with `-urban-class` its control.
    expect(parseConfig('?town=terrace').town).toBe('terrace');
    expect(configQuery(parseConfig('?town=countryside&levers=-land-planting'))).toBe(
      '?levers=-land-planting&town=countryside',
    );
    // #1637: the city centre's street, whose before is its urban class off.
    expect(parseConfig('?town=city-street').town).toBe('city-street');
    expect(configQuery(parseConfig('?town=city-street&levers=-urban-class'))).toBe(
      '?levers=-urban-class&town=city-street',
    );
    // #1636: a city centre, for its shop fronts and its tower.
    expect(parseConfig('?town=city').town).toBe('city');
    expect(configQuery(parseConfig('?town=city&at=1430'))).toBe('?at=1430&town=city');
  });

  it('rides the city centre through #1636’s fixture, which is where it is wired', () => {
    const harness = readFileSync(
      fileURLToPath(new URL('../realistic-harness.ts', import.meta.url)),
      'utf8',
    );
    expect(harness).toContain("config.town === 'city'");
    expect(harness).toContain('? cityCentreFixture(latitude)');
    // #1637's own city centre, for its street and terraced blocks.
    expect(harness).toContain("config.town === 'city-street'");
    expect(harness).toContain('? cityStreetscapeFixture(latitude)');
  });

  it('switches #1542’s three changes off one by one, and none unless asked', () => {
    expect(countrysideWithLevers(parseConfig('').leversOff)).toEqual([]);
    expect(countrysideWithLevers(parseConfig('?levers=-air,-crag').leversOff)).toEqual([]);
    expect(countrysideWithLevers(parseConfig('?levers=-land-planting').leversOff)).toEqual([
      'planting',
    ]);
    expect(countrysideWithLevers(parseConfig('?levers=-land-boundaries').leversOff)).toEqual([
      'boundaries',
    ]);
    expect(countrysideWithLevers(parseConfig('?levers=-ground-clutter').leversOff)).toEqual([
      'clutter',
    ]);
    expect(
      countrysideWithLevers(
        parseConfig('?levers=-ground-clutter,-land-planting,-land-boundaries').leversOff,
      ),
    ).toEqual(['planting', 'boundaries', 'clutter']);
    // The owner's ruling of 2026-10-24: the broken roadside and the small stones.
    expect(countrysideWithLevers(parseConfig('?levers=-hedge-breaks').leversOff)).toEqual([
      'hedge-breaks',
    ]);
    expect(countrysideWithLevers(parseConfig('?levers=-small-stones').leversOff)).toEqual([
      'small-stones',
    ]);
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

  it('builds the mapped windows’ reveals, as the product does, unless #1659’s lever takes them out', () => {
    expect(LEVERS).toContain('window-reveals');
    expect(windowRevealsWithLevers([])).toBe(true);
    // No OTHER lever touches them.
    expect(windowRevealsWithLevers(LEVERS.filter((lever) => lever !== 'window-reveals'))).toBe(
      true,
    );
    expect(windowRevealsWithLevers(parseConfig('?levers=-window-reveals').leversOff)).toBe(false);
    expect(configQuery(parseConfig('?town=mixed&levers=-window-reveals'))).toBe(
      `?levers=${encodeURIComponent('-window-reveals')}&town=mixed`,
    );
  });

  it('hands the parsed lever to the owner’s page, which is where it is wired — #1659', () => {
    // Read as text, as early.test.ts reads the HTML: the harness is a page
    // entry that cannot be imported. Deleting the call leaves the parse green.
    const harness = readFileSync(
      fileURLToPath(new URL('../realistic-harness.ts', import.meta.url)),
      'utf8',
    );
    expect(harness).toContain('windowRevealsOf(view, windowRevealsWithLevers(config.leversOff));');
  });

  it('builds the mapped walls’ overhang shadows, as the product does, unless #1658’s lever takes them out', () => {
    expect(LEVERS).toContain('overhang-shadows');
    expect(overhangShadowsWithLevers([])).toBe(true);
    // No OTHER lever touches them.
    expect(overhangShadowsWithLevers(LEVERS.filter((lever) => lever !== 'overhang-shadows'))).toBe(
      true,
    );
    expect(overhangShadowsWithLevers(parseConfig('?levers=-overhang-shadows').leversOff)).toBe(
      false,
    );
    // And #1659's lever is not this one.
    expect(windowRevealsWithLevers(parseConfig('?levers=-overhang-shadows').leversOff)).toBe(true);
  });

  it('hands #1658’s parsed lever to the owner’s page, which is where it is wired', () => {
    const harness = readFileSync(
      fileURLToPath(new URL('../realistic-harness.ts', import.meta.url)),
      'utf8',
    );
    expect(harness).toContain(
      'overhangShadowsOf(view, overhangShadowsWithLevers(config.leversOff));',
    );
  });

  it('builds the mapped facades’ weathering, as the product does, unless #1661’s lever takes it out', () => {
    expect(LEVERS).toContain('weathering');
    expect(weatheringWithLevers([])).toBe(true);
    // No OTHER lever touches it.
    expect(weatheringWithLevers(LEVERS.filter((lever) => lever !== 'weathering'))).toBe(true);
    expect(weatheringWithLevers(parseConfig('?levers=-weathering').leversOff)).toBe(false);
    expect(configQuery(parseConfig('?town=mixed&levers=-weathering'))).toBe(
      `?levers=${encodeURIComponent('-weathering')}&town=mixed`,
    );
    // And #1658's and #1659's levers are not this one.
    expect(overhangShadowsWithLevers(parseConfig('?levers=-weathering').leversOff)).toBe(true);
    expect(windowRevealsWithLevers(parseConfig('?levers=-weathering').leversOff)).toBe(true);
  });

  it('hands #1661’s parsed lever to the owner’s page, which is where it is wired', () => {
    const harness = readFileSync(
      fileURLToPath(new URL('../realistic-harness.ts', import.meta.url)),
      'utf8',
    );
    expect(harness).toContain('weatheringOf(view, weatheringWithLevers(config.leversOff));');
  });

  it('builds the rooms behind mapped glass, as the product does, unless #1662’s lever takes them out', () => {
    expect(LEVERS).toContain('window-rooms');
    expect(windowRoomsWithLevers([])).toBe(true);
    // No OTHER lever touches it.
    expect(windowRoomsWithLevers(LEVERS.filter((lever) => lever !== 'window-rooms'))).toBe(true);
    expect(windowRoomsWithLevers(parseConfig('?levers=-window-rooms').leversOff)).toBe(false);
    expect(configQuery(parseConfig('?town=mixed&levers=-window-rooms'))).toBe(
      `?levers=${encodeURIComponent('-window-rooms')}&town=mixed`,
    );
    // And #1659's and #1661's levers are not this one.
    expect(windowRevealsWithLevers(parseConfig('?levers=-window-rooms').leversOff)).toBe(true);
    expect(weatheringWithLevers(parseConfig('?levers=-window-rooms').leversOff)).toBe(true);
  });

  it('hands #1662’s parsed lever to the owner’s page, which is where it is wired', () => {
    const harness = readFileSync(
      fileURLToPath(new URL('../realistic-harness.ts', import.meta.url)),
      'utf8',
    );
    expect(harness).toContain('windowRoomsOf(view, windowRoomsWithLevers(config.leversOff));');
  });

  it('builds the lots’ weathering and rooms, as the product does, unless #1665’s lever takes them out', () => {
    expect(LEVERS).toContain('lot-realism');
    expect(lotRealismWithLevers([])).toBe(true);
    // No OTHER lever touches it.
    expect(lotRealismWithLevers(LEVERS.filter((lever) => lever !== 'lot-realism'))).toBe(true);
    expect(lotRealismWithLevers(parseConfig('?levers=-lot-realism').leversOff)).toBe(false);
    expect(configQuery(parseConfig('?route=village&levers=-lot-realism'))).toBe(
      `?levers=${encodeURIComponent('-lot-realism')}&route=village`,
    );
    // And #1661's and #1662's levers, the mapped facades', are not this one.
    expect(weatheringWithLevers(parseConfig('?levers=-lot-realism').leversOff)).toBe(true);
    expect(windowRoomsWithLevers(parseConfig('?levers=-lot-realism').leversOff)).toBe(true);
  });

  it('hands #1665’s parsed lever to the owner’s page, which is where it is wired', () => {
    const harness = readFileSync(
      fileURLToPath(new URL('../realistic-harness.ts', import.meta.url)),
      'utf8',
    );
    expect(harness).toContain('lotRealismOf(view, lotRealismWithLevers(config.leversOff));');
  });

  it('plans the town with its urban class, as the press does, unless #1634’s lever takes it out', () => {
    expect(LEVERS).toContain('urban-class');
    expect(urbanClassWithLevers([])).toBe(true);
    // No OTHER lever touches it.
    expect(urbanClassWithLevers(LEVERS.filter((lever) => lever !== 'urban-class'))).toBe(true);
    expect(urbanClassWithLevers(parseConfig('?levers=-urban-class').leversOff)).toBe(false);
    expect(configQuery(parseConfig('?town=mixed&levers=-urban-class'))).toBe(
      `?levers=${encodeURIComponent('-urban-class')}&town=mixed`,
    );
    // Wired where the harness plans the town, read as text as #1659's lever is above. Since
    // #1660 the harness plans it in `town.ts`, which `town.test.ts` reads by its plans.
    const harness = readFileSync(
      fileURLToPath(new URL('../realistic-harness.ts', import.meta.url)),
      'utf8',
    );
    expect(harness).toContain('plannedTown(mixed, config.leversOff)');
    const town = readFileSync(fileURLToPath(new URL('./town.ts', import.meta.url)), 'utf8');
    expect(town).toContain('const urban = urbanClassWithLevers(leversOff)');
    expect(town).toMatch(/FOOTPRINT_MAX_VERTICES,\s+urban,/);
  });

  it('pitches the split houses, as the product does, unless #1660’s lever takes it out', () => {
    expect(LEVERS).toContain('split-roofs');
    expect(splitRoofsWithLevers([])).toBe(true);
    // No OTHER lever touches it.
    expect(splitRoofsWithLevers(LEVERS.filter((lever) => lever !== 'split-roofs'))).toBe(true);
    expect(splitRoofsWithLevers(parseConfig('?levers=-split-roofs').leversOff)).toBe(false);
    expect(configQuery(parseConfig('?town=mixed&levers=-split-roofs'))).toBe(
      `?levers=${encodeURIComponent('-split-roofs')}&town=mixed`,
    );
  });

  it('builds both surfaces’ shaders, bounded, as the product does, unless a #1523 lever takes one out', () => {
    expect(LEVERS).toContain('ground-blend');
    expect(LEVERS).toContain('road-wear');
    expect(LEVERS).toContain('surface-bounds');
    const drawn = { groundBlend: true, roadWear: true, bounded: true };
    // No lever is the product, and no OTHER lever touches either surface.
    expect(surfacesWithLevers([])).toEqual(drawn);
    expect(surfacesWithLevers(parseConfig('?levers=-air,-crag,-texture-bias').leversOff)).toEqual(
      drawn,
    );
    // Each lever its own setting, and only that one.
    expect(surfacesWithLevers(parseConfig('?levers=-ground-blend').leversOff)).toEqual({
      ...drawn,
      groundBlend: false,
    });
    expect(surfacesWithLevers(parseConfig('?levers=-road-wear').leversOff)).toEqual({
      ...drawn,
      roadWear: false,
    });
    expect(surfacesWithLevers(parseConfig('?levers=-surface-bounds').leversOff)).toEqual({
      ...drawn,
      bounded: false,
    });
    expect(surfacesWithLevers(parseConfig('?levers=-road-wear,-ground-blend').leversOff)).toEqual({
      ...drawn,
      groundBlend: false,
      roadWear: false,
    });
    // And the URL round-trips, so a tablet row names the program it measured.
    expect(configQuery(parseConfig('?levers=-road-wear,-ground-blend'))).toBe(
      `?levers=${encodeURIComponent('-ground-blend,-road-wear')}`,
    );
    expect(configQuery(parseConfig('?levers=-surface-bounds'))).toBe(
      `?levers=${encodeURIComponent('-surface-bounds')}`,
    );
  });

  it('draws the firs after their depth pre-pass, as the product does, unless its #1523 lever is off', () => {
    expect(LEVERS).toContain('fir-prepass');
    // No lever is the product, and no OTHER lever touches the pre-pass.
    expect(firPrepassWithLevers([])).toBe('drawn');
    expect(
      firPrepassWithLevers(
        parseConfig('?levers=-surface-bounds,-generated-conifers,-foliage-order').leversOff,
      ),
    ).toBe('drawn');
    expect(firPrepassWithLevers(parseConfig('?levers=-fir-prepass').leversOff)).toBe('off');
    // The gate's control is never a URL's to ask for.
    expect(() => parseConfig('?levers=-unprepared')).toThrow(/levers is a comma-separated list/);
    expect(configQuery(parseConfig('?levers=-fir-prepass'))).toBe(
      `?levers=${encodeURIComponent('-fir-prepass')}`,
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
      '?date=2026-10-31&levers=-decorations',
      '?world=stylised&date=0999-01-06',
      '?date=2026-10-31&decorations=probe&route=village',
    ]) {
      const config = parseConfig(search);
      expect(parseConfig(configQuery(config))).toEqual(config);
    }
  });

  it('writes `date` back as the zero-padded `YYYY-MM-DD` it was read from — #1622', () => {
    expect(configQuery(parseConfig('?date=2026-10-31'))).toBe('?date=2026-10-31');
    expect(configQuery(parseConfig('?date=0999-01-06'))).toBe('?date=0999-01-06');
  });
});

describe('the page’s decoration probe — #1624', () => {
  it('decorates with the product’s table unless the URL asks for the probe, and refuses any other', () => {
    expect(parseConfig('').decorations).toBeUndefined();
    expect(decorationsWithConfig(parseConfig(''))).toBe(HOLIDAY_DECORATIONS);
    const probe = decorationsWithConfig(parseConfig('?decorations=probe'));
    expect(probe).toBe(PROBE_DECORATIONS);
    // Both holidays, every anchor kind, every anchor taken: a probe that
    // placed nothing would let the browser gate's one call pass vacuously.
    for (const holiday of ['halloween', 'winter-lights'] as const) {
      const [kind] = probe[holiday] ?? [];
      expect(kind?.anchors).toEqual(ANCHOR_KINDS);
      expect(kind?.chance).toBe(1);
      expect(kind?.parts).toHaveLength(1);
    }
    expect(() => parseConfig('?decorations=pumpkins')).toThrow(/decorations is one of probe/);
  });
});

describe('the page’s day and its decorations — #1622', () => {
  const NORTH = { hemisphere: 'north', absLatitude: 50 } as const;
  /** "Today" for the page: never Halloween, so a date that is ignored shows. */
  const MID_JULY = () => ({ year: 2026, month: 7, day: 15 });

  it('is this device’s day when the URL names none', () => {
    expect(parseConfig('').date).toBeUndefined();
    expect(DEFAULT_CONFIG.date).toBeUndefined();
    expect(seasonWithLevers(parseConfig(''), NORTH, MID_JULY).holiday).toBeUndefined();
  });

  it('overrides the day in either world', () => {
    for (const world of ['realistic', 'stylised']) {
      const config = parseConfig(`?world=${world}&date=2026-10-31`);
      expect(config.date).toEqual({ year: 2026, month: 10, day: 31 });
      expect(seasonWithLevers(config, NORTH, MID_JULY).holiday).toBe('halloween');
    }
    expect(seasonWithLevers(parseConfig('?date=2027-01-06'), NORTH, MID_JULY).holiday).toBe(
      'winter-lights',
    );
  });

  it('refuses a malformed or impossible day, as it refuses an unknown lever', () => {
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '2026-1-5',
      '26-10-31',
      '2026-10-31T00:00',
      '',
      '2026-10-31x',
      'today',
    ]) {
      expect(() => parseConfig(`?date=${encodeURIComponent(bad)}`)).toThrow(
        /date is a real day written YYYY-MM-DD/,
      );
    }
    expect(() => parseConfig('?levers=-decoration')).toThrow(/levers is a comma-separated list/);
  });

  it('drops the holiday on any date with -decorations, and leaves the nature alone', () => {
    expect(LEVERS).toContain('decorations');
    for (const date of ['2026-10-24', '2026-10-31', '2026-11-01', '2026-12-25', '2027-01-06']) {
      const shown = seasonWithLevers(parseConfig(`?date=${date}`), NORTH, MID_JULY);
      const hidden = seasonWithLevers(
        parseConfig(`?date=${date}&levers=-decorations`),
        NORTH,
        MID_JULY,
      );
      expect(shown.holiday).toBeDefined();
      expect(hidden.holiday).toBeUndefined();
      expect(hidden.nature).toEqual(shown.nature);
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

describe('where the page’s roads are ridden, for the route’s own season — #1623', () => {
  it('rides every road where it was when the URL names no place', () => {
    expect(parseConfig('').place).toBeUndefined();
    expect(DEFAULT_CONFIG.place).toBeUndefined();
  });

  it('reads each place, and writes it back as the same configuration', () => {
    for (const place of PLACES) {
      const config = parseConfig(`?place=${place}&date=2026-01-15&town=mixed`);
      expect(config.place).toBe(place);
      expect(parseConfig(configQuery(config))).toEqual(config);
    }
  });

  it('refuses a place it does not know, as it refuses an unknown lever', () => {
    for (const bad of ['north', 'South', '', 'far']) {
      expect(() => parseConfig(`?place=${encodeURIComponent(bad)}`)).toThrow(
        /place is one of south, nordic/,
      );
    }
  });
});
