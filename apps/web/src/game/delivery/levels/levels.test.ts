// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The built-in Delivery levels, read the way the game reads them — #2361,
 * ADR 0065 D-2.4, D-2.5, D-6.2, D-7 and D-8.2.
 *
 * Every drawn or counted case uses the synthetic `fixtures/fixture-level.json`
 * (D-7.5). The shipped files under `data/` are only read for their shape,
 * their licence fields, their sizes, their `ASSETS.toml` rows and their
 * catalogue entries, which D-7.5 allows.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILDING_FIELD_NAMES } from '@onyourleft/map-features';
import { circuitRouteId, isLevelRouteId, levelRouteId, routeId } from '@onyourleft/store';

import { ODBL_LICENCE_URL, ODBL_NOTICE } from '../../../map/basemap';
import { modulesUnder } from '../../cannot-reach-trainer-testing';
import { SHIPPED_LEVEL_FILES, SHIPPED_LEVELS } from '../../shipped-levels';
import { roundHousesOn } from '../courses';
import { LEVEL_HOUSE_MARGIN } from '../../../../tools/delivery-levels/author-level';
import { levelFileSizes, levelSizeFindings } from '../../../../tools/delivery-levels/level-sizes';
import { LEVEL_CATALOGUE, type LevelListing } from './catalogue';
import { LEVEL_LICENCE, parseLevelFile, type LevelFile } from './level-file';
import {
  levelBuildingFeature,
  levelCorridor,
  levelLibrary,
  levelOfRouteId,
  levelRoute,
} from './levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');
const WEB = join(HERE, '..', '..', '..', '..');
const REPOSITORY = join(WEB, '..', '..');

const FIXTURE_TEXT = readFileSync(join(HERE, 'fixtures', 'fixture-level.json'), 'utf8');

function fixtureJson(): Record<string, unknown> {
  return JSON.parse(FIXTURE_TEXT) as Record<string, unknown>;
}

function fixture(): LevelFile {
  return parseLevelFile(fixtureJson(), 'fixture-level');
}

const SHIPPED = readdirSync(DATA)
  .filter((name) => name.endsWith('.json'))
  .sort();

describe('the level: namespace — #2361, D-8.2', () => {
  it('names a level by its own id, and refuses a saved route’s id and a circuit’s as a level’s', () => {
    expect(levelOfRouteId(levelRouteId('fixture-level'))).toBe('fixture-level');
    const saved = routeId(globalThis.crypto.randomUUID());
    expect(levelOfRouteId(saved)).toBeUndefined();
    expect(levelOfRouteId(circuitRouteId('kestrel'))).toBeUndefined();
    expect(levelOfRouteId('kestrel')).toBeUndefined();
    // A level: key whose second half is not a level id names no level.
    expect(levelOfRouteId('level:')).toBeUndefined();
    expect(levelOfRouteId('level:Fixture Lane')).toBeUndefined();
  });

  it('is refused by routeId, so no saved route can carry it, and a circuit key is never one', () => {
    expect(() => routeId('level:fixture-level')).toThrow(
      /reserved for the built-in Delivery levels/,
    );
    expect(() => levelRouteId(circuitRouteId('kestrel'))).toThrow(/reserved namespace/);
    expect(isLevelRouteId(circuitRouteId('kestrel'))).toBe(false);
  });
});

describe('levelRoute — #2361', () => {
  it('is the file’s line as a ridable route keyed level:<id>, with no attempts', () => {
    const file = fixture();
    const route = levelRoute(file);
    expect(route.id).toBe('level:fixture-level');
    expect(route.name).toBe('Fixture Lane');
    expect(route.attempts).toBe(0);
    expect(route.profile.loop).toBe(false);
    expect(Math.abs(route.profile.totalDistance - file.lengthMetres)).toBeLessThan(1);
    expect(route.profile.elevations[0]).toBe(file.points[0]?.[2]);
  });

  it('rides a loop as a loop', () => {
    const file = fixture();
    const [first] = file.points;
    // Back to the start: a line north and the same line south, which closes.
    const back = [...file.points].reverse().slice(1);
    const loop: LevelFile = { ...file, shape: 'loop', points: [...file.points, ...back] };
    expect(first).toBeDefined();
    expect(levelRoute(loop).profile.loop).toBe(true);
  });
});

describe('levelCorridor — #2361, D-2.2 and D-2.4', () => {
  it('holds the file’s footprints and no other layer, keyed by the level’s route id', () => {
    const file = fixture();
    const corridor = levelCorridor(file);
    expect(corridor.routeId).toBe('level:fixture-level');
    expect(corridor.buildings).toHaveLength(file.buildings.length);
    expect(corridor.landUse).toStrictEqual([]);
    expect(corridor.paths).toStrictEqual([]);
    expect(corridor.streets).toStrictEqual([]);
    expect(corridor.places).toStrictEqual([]);
    expect(corridor.origin).toStrictEqual({
      latitude: file.points[0]?.[0],
      longitude: file.points[0]?.[1],
      elevation: file.points[0]?.[2],
    });
  });

  it('is covered along the whole line, as a read of it would be, and not far from it', () => {
    const corridor = levelCorridor(fixture());
    expect(corridor.coveredBoxes.length).toBeGreaterThan(0);
    expect(corridor.covered(0, 0)).toBe(true);
    expect(corridor.covered(12, 1_000)).toBe(true);
    expect(corridor.covered(0, 1_998)).toBe(true);
    expect(corridor.covered(50_000, 0)).toBe(false);
  });

  it('turns a footprint into what the realistic world reads: its fields set, every other one null', () => {
    const file = fixture();
    const first = levelBuildingFeature(file.buildings[0] as LevelFile['buildings'][number]);
    expect(first.kind).toBe('building');
    expect(first.heightMetres).toBe(6);
    expect(first.levels).toBe(2);
    expect(first.roofShape).toBe('gabled');
    expect(first.wallColour).toBe(3);
    expect(first.buildingType).toBeNull();
    expect(first.landmark).toBeNull();
    for (const name of BUILDING_FIELD_NAMES) expect(name in first).toBe(true);
    expect(first.rings[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(first.rings[0] ?? [])).toStrictEqual(
      [8, 41.05, 16, 41.05, 16, 49.05, 8, 49.05].map((n) => Math.fround(n)),
    );
  });

  it('holds the round houses the fixture’s round asks for, with the build tool’s margin', () => {
    const file = fixture();
    const houses = roundHousesOn(levelCorridor(file), levelRoute(file).profile);
    expect(houses).toBeGreaterThanOrEqual(file.round.houses + LEVEL_HOUSE_MARGIN);
    // And from the file's own buildings: with none, there is no round.
    const bare: LevelFile = { ...file, buildings: [] };
    expect(roundHousesOn(levelCorridor(bare), levelRoute(bare).profile)).toBe(0);
  });
});

describe('levelLibrary reads a level’s own file — #2361, D-2.5', () => {
  it('reads a good file under its own name, and refuses one under another or that is not a level', async () => {
    const listed = ['fixture-level', 'broken', 'failing', 'renamed'].map((id) => ({
      id,
      name: 'Fixture Lane',
      lengthMetres: 2000,
      houses: 6,
    }));
    const library = levelLibrary(
      {
        './data/fixture-level.json': () => Promise.resolve(fixtureJson()),
        './data/broken.json': () => Promise.resolve({ format: 'something else' }),
        './data/failing.json': () => Promise.reject(new Error('chunk failed to load')),
        // A good file under another name: its id is not its file's.
        './data/renamed.json': () => Promise.resolve(fixtureJson()),
      },
      listed,
    );
    await expect(library.load('fixture-level')).resolves.toStrictEqual(fixture());
    for (const id of ['broken', 'failing', 'renamed']) {
      await expect(library.load(id), id).resolves.toBeUndefined();
    }
  });

  it('lists the levels in unlock order, fewest houses first (D-4.3)', () => {
    const level = (id: string, houses: number) => ({
      id,
      name: 'Fixture Lane',
      lengthMetres: 2000,
      houses,
    });
    const library = levelLibrary(
      {
        './data/third.json': () => Promise.resolve(undefined),
        './data/first.json': () => Promise.resolve(undefined),
        './data/second.json': () => Promise.resolve(undefined),
      },
      [level('third', 9), level('first', 4), level('second', 6)],
    );
    expect(library.list().map((each) => each.id)).toStrictEqual(['first', 'second', 'third']);
  });

  it('loads every file the app ships, and the app ships no fixture', async () => {
    const levels = await Promise.all(
      SHIPPED_LEVELS.list().map((listed) => SHIPPED_LEVELS.load(listed.id)),
    );
    expect(levels.map((level) => `${String(level?.id)}.json`).sort()).toStrictEqual(SHIPPED);
    expect(Object.keys(SHIPPED_LEVEL_FILES).length).toBe(SHIPPED.length);
    expect(SHIPPED).not.toContain('fixture-level.json');
  });
});

describe('levelLibrary: the listing is not the level — #2362, D-2.5', () => {
  /** Loaders that count what they were asked for. */
  function counted(paths: readonly string[]): {
    readonly loaders: Record<string, () => Promise<unknown>>;
    readonly read: string[];
  } {
    const read: string[] = [];
    const loaders = Object.fromEntries(
      paths.map((path) => [
        path,
        () => {
          read.push(path);
          const id = path.replace(/^.*\//, '').replace(/\.json$/, '');
          return Promise.resolve({ ...fixtureJson(), id });
        },
      ]),
    );
    return { loaders, read };
  }

  const LISTED: readonly LevelListing[] = [
    { id: 'second', name: 'Second Lane', lengthMetres: 2000, houses: 6 },
    { id: 'first', name: 'First Lane', lengthMetres: 2000, houses: 4 },
    // Listed, and shipped by no file: never offered.
    { id: 'missing', name: 'Missing Lane', lengthMetres: 2000, houses: 5 },
  ];

  it('lists from the catalogue alone, in unlock order, and reads no file to do it', () => {
    const { loaders, read } = counted(['./data/first.json', './data/second.json']);
    const library = levelLibrary(loaders, LISTED);
    expect(library.list().map((level) => level.id)).toStrictEqual(['first', 'second']);
    expect(library.list()[0]?.routeId).toBe(levelRouteId('first'));
    expect(read).toStrictEqual([]);
  });

  it('reads only the chosen level’s file, in full', async () => {
    const { loaders, read } = counted(['./data/first.json', './data/second.json']);
    const library = levelLibrary(loaders, LISTED);
    const chosen = await library.load('second');
    expect(read).toStrictEqual(['./data/second.json']);
    expect(chosen?.id).toBe('second');
    expect(chosen?.buildings.length).toBe(fixture().buildings.length);
  });

  it('loads nothing for an id it does not ship, and nothing for a file that is not a level', async () => {
    const library = levelLibrary(
      {
        './data/first.json': () => Promise.resolve({ format: 'something else' }),
        './data/second.json': () => Promise.reject(new Error('chunk failed to load')),
      },
      LISTED,
    );
    await expect(library.load('missing')).resolves.toBeUndefined();
    await expect(library.load('first')).resolves.toBeUndefined();
    await expect(library.load('second')).resolves.toBeUndefined();
  });
});

describe('the shipped level files — #2361, D-3.2, D-6.2 and D-7', () => {
  it('are each in the catalogue the picker lists, field for field, and nothing else is (#2362)', () => {
    const files = SHIPPED.map((name) =>
      parseLevelFile(JSON.parse(readFileSync(join(DATA, name), 'utf8')), name.slice(0, -5)),
    );
    expect(SHIPPED.length).toBeGreaterThanOrEqual(2);
    expect([...LEVEL_CATALOGUE].sort((a, b) => a.id.localeCompare(b.id))).toStrictEqual(
      files
        .map((file) => ({
          id: file.id,
          name: file.name,
          lengthMetres: file.lengthMetres,
          houses: file.round.houses,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('are listed by the app’s own library, in unlock order, without reading one (#2362)', () => {
    expect(
      SHIPPED_LEVELS.list()
        .map((level) => `${level.id}.json`)
        .sort(),
    ).toStrictEqual(SHIPPED);
    const houses = SHIPPED_LEVELS.list().map((level) => level.houses);
    expect(houses).toStrictEqual([...houses].sort((a, b) => a - b));
  });

  it('each read as a level, carry the licence inside, and are named in ASSETS.toml under ODbL-1.0', () => {
    const manifest = readFileSync(join(REPOSITORY, 'ASSETS.toml'), 'utf8');
    for (const name of SHIPPED) {
      const file = parseLevelFile(
        JSON.parse(readFileSync(join(DATA, name), 'utf8')),
        name.slice(0, -5),
      );
      expect(file.licence, name).toStrictEqual({ ...LEVEL_LICENCE, through: file.licence.through });
      const path = `apps/web/src/game/delivery/levels/data/${name}`;
      const entry = manifest.split('[[asset]]').find((block) => block.includes(`path = "${path}"`));
      expect(entry, path).toContain('licence = "ODbL-1.0"');
      expect(entry, path).toContain('script = "apps/web/tools/delivery-levels/author-level.ts"');
    }
  });

  it('are within the owner’s ceilings, which the build and the tool both hold', () => {
    expect(levelSizeFindings(levelFileSizes(DATA))).toStrictEqual([]);
  });

  it('have the notice beside them, naming where the whole database is offered (§4.6 a)', () => {
    const beside = readFileSync(join(DATA, 'LICENCE-ODbL.txt'), 'utf8');
    // #2362: and the same bytes in the app's public licences, which the credits screen reads.
    expect(readFileSync(join(WEB, 'public', 'licences', 'levels-ODbL.txt'), 'utf8')).toBe(beside);
    expect(beside).toContain(ODBL_NOTICE.replace('here under the Open', 'here under the\nOpen'));
    expect(beside).toContain(ODBL_LICENCE_URL);
    expect(beside).toContain('https://www.openstreetmap.org/copyright');
    expect(beside).toContain(
      'https://github.com/openzigs/onyourleft/tree/main/apps/web/src/game/delivery/levels/data',
    );
  });

  it('are inside the walk delivery-cannot-reach-trainer.test.ts makes (D-11)', () => {
    const walked = modulesUnder('apps/web/src/game/delivery');
    expect(walked).toContain('apps/web/src/game/delivery/levels/level-file.ts');
    expect(walked).toContain('apps/web/src/game/delivery/levels/levels.ts');
    expect(walked).not.toContain('apps/web/src/game/shipped-levels.ts');
  });
});
