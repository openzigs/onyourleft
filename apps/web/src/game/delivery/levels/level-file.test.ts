// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The level format's reader — #2361, ADR 0065 D-2, D-4.1, D-5 and D-6.2.
 *
 * Every case starts from `fixtures/fixture-level.json`, a synthetic level made
 * up for these tests and drawn from no map (D-7.5): a straight 2 km line over
 * open sea with 8 m houses either side of it. A case changes one thing and
 * asserts the reader refuses it, naming the field and the constraint and
 * never the value (ADR 0004 D).
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LOOP_CLOSURE_METRES } from '@onyourleft/domain';

import { ODBL_LICENCE_URL, ODBL_NOTICE } from '../../../map/basemap';
import { CIRCUIT_LICENCE } from '../../circuits/circuit-file';
import { MOST_HOUSES } from '../round';
import { THROW_WINDOW_BEFORE_METRES } from '../throw';
import {
  LEVEL_LICENCE,
  LevelFileError,
  levelLength,
  parseLevelFile,
  type LevelPoint,
} from './level-file';

type Raw = Record<string, unknown> & {
  points: number[][];
  buildings: Record<string, unknown>[];
  round: Record<string, unknown>;
};

const FIXTURE_TEXT = readFileSync(
  new URL('./fixtures/fixture-level.json', import.meta.url),
  'utf8',
);

/** A fresh, deep copy of the fixture, to change one thing in. */
function fixture(): Raw {
  return JSON.parse(FIXTURE_TEXT) as Raw;
}

/** The message the reader refuses `raw` with. */
function refusal(raw: unknown): string {
  try {
    parseLevelFile(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(LevelFileError);
    return (error as Error).message;
  }
  throw new Error('the reader read it');
}

/** The distance `distanceBetween` makes of a degree of latitude: 6 371 008.8 m × π / 180. */
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;

/** The fixture with its line replaced by one due north of its first point, `metres` long, stated as `stated`. */
function northLine(metres: number, stated: number = metres): Raw {
  const raw = fixture();
  const [latitude, longitude] = raw.points[0] as [number, number, number];
  const points: number[][] = [];
  for (let along = 0; along < metres; along += 10) {
    points.push([latitude + along / METRES_PER_DEGREE, longitude, 10]);
  }
  points.push([latitude + metres / METRES_PER_DEGREE, longitude, 10]);
  raw.points = points;
  raw.lengthMetres = stated;
  return raw;
}

describe('parseLevelFile — #2361', () => {
  it('reads the synthetic fixture, every field of it', () => {
    const file = parseLevelFile(fixture(), 'fixture-level');
    expect(file.id).toBe('fixture-level');
    expect(file.name).toBe('Fixture Lane');
    expect(file.shape).toBe('point-to-point');
    expect(file.lengthMetres).toBe(2000);
    expect(file.heights).toStrictEqual({ dataset: 'USGS 3DEP', resolutionMetres: 10 });
    expect(file.round).toStrictEqual({
      houses: 6,
      throwWindow: { beforeMetres: 20, afterMetres: 1 },
      hazardsPerKilometre: { static: 2, moving: 0 },
      mailboxShare: 0,
      noDeliveryShare: 0,
      weather: 'clear',
      light: 'day',
    });
    expect(file.archive.build).toBe('basemap-fixture-20261108');
    expect(file.archive.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.buildings.length).toBeGreaterThan(40);
    expect(file.buildings[0]).toStrictEqual({
      kind: 'building',
      heightMetres: 6,
      minHeightMetres: null,
      fields: { levels: 2, roofShape: 'gabled', wallColour: 3 },
      rings: [[8, 41.05, 16, 41.05, 16, 49.05, 8, 49.05]],
    });
    expect(file.points).toHaveLength(201);
  });

  it('holds exactly the fields ADR 0065 lists, and nothing of the fixture is lost on the way', () => {
    const raw = fixture();
    expect(Object.keys(raw).sort()).toStrictEqual([
      'archive',
      'buildings',
      'format',
      'heights',
      'id',
      'lengthMetres',
      'licence',
      'name',
      'points',
      'round',
      'shape',
      'version',
    ]);
    expect(JSON.parse(JSON.stringify(parseLevelFile(raw)))).toStrictEqual(raw);
  });

  it('carries the circuits’ licence fields, the same object and not a copy of its text', () => {
    expect(LEVEL_LICENCE).toBe(CIRCUIT_LICENCE);
    const { licence } = parseLevelFile(fixture());
    expect(licence.id).toBe('ODbL-1.0');
    expect(licence.url).toBe(ODBL_LICENCE_URL);
    expect(licence.notice).toBe(ODBL_NOTICE);
    expect(licence).toStrictEqual({ ...CIRCUIT_LICENCE, through: licence.through });
  });

  describe('fails closed: a key the format does not name is refused, at any depth (D-2.3)', () => {
    it.each(['osmId', 'street', 'seed', 'houses', 'address', 'owner', 'routeId', 'tiles'])(
      'a top-level %s',
      (key) => {
        const raw = fixture();
        raw[key] = key === 'houses' ? [0, 1, 2] : 'x';
        expect(refusal(raw)).toBe(`level file: file holds a key the format does not have (${key})`);
      },
    );

    it.each([
      ['round', (raw: Raw): unknown => (raw.round.seed = 7), 'round'],
      ['round', (raw: Raw): unknown => (raw.round.targets = [1, 2]), 'round'],
      ['a building', (raw: Raw): unknown => ((raw.buildings[0] as Raw).osmId = 1), 'buildings[0]'],
      [
        'a building’s fields',
        (raw: Raw): unknown =>
          (((raw.buildings[1] as Raw).fields as Record<string, unknown>).name = 'x'),
        'buildings[1].fields',
      ],
      ['the licence', (raw: Raw): unknown => ((raw.licence as Raw).place = 'x'), 'licence'],
      ['the archive', (raw: Raw): unknown => ((raw.archive as Raw).tiles = []), 'archive'],
      ['the heights', (raw: Raw): unknown => ((raw.heights as Raw).time = 1), 'heights'],
      [
        'the throw window',
        (raw: Raw): unknown => ((raw.round.throwWindow as Raw).house = 1),
        'round.throwWindow',
      ],
    ] as const)('a key added to %s', (_where, add, field) => {
      const raw = fixture();
      add(raw);
      expect(refusal(raw)).toMatch(
        new RegExp(`^level file: ${field.replace(/[[\].]/g, '\\$&')} holds a key the format`),
      );
    });

    it('a field missing', () => {
      const raw = fixture();
      delete raw.archive;
      expect(refusal(raw)).toBe('level file: archive is missing');
    });
  });

  describe('a message about a coordinate names the field and the constraint, never the value (ADR 0004 D)', () => {
    /** Every digit of `value` that the message must not hold. */
    function digitsOf(value: number): string[] {
      return [...new Set(String(value).replace(/[^0-9]/g, ''))];
    }

    it('an out-of-range latitude', () => {
      const raw = fixture();
      const value = 187.654_321;
      (raw.points[0] as number[])[0] = value;
      const message = refusal(raw);
      expect(message).toBe(
        'level file: points[0] latitude must be a latitude, from the south pole to the north',
      );
      expect(message).not.toContain(String(value));
      for (const digit of digitsOf(value)) expect(message).not.toContain(digit);
    });

    it('an out-of-range longitude, deep in the line, with no digit at all but the index', () => {
      const raw = fixture();
      (raw.points[0] as number[])[1] = -543.219_876;
      const message = refusal(raw);
      expect(message.replace('points[0]', '')).not.toMatch(/\d/);
    });

    it('a footprint corner far outside the corridor', () => {
      const raw = fixture();
      const rings = (raw.buildings[0] as { rings: number[][] }).rings;
      (rings[0] as number[])[1] = 87_654.321;
      const message = refusal(raw);
      expect(message).toBe(
        'level file: buildings[0].rings[0] must hold finite metres within the corridor of the first point',
      );
      for (const digit of digitsOf(87_654.321)) expect(message).not.toContain(digit);
    });
  });

  describe('its length is held to 1.5 to 5 km (D-5.1)', () => {
    // The numbers themselves, not the constants: a moved bound is then a red test.
    it.each([1499, 5001])('refuses %i m', (metres) => {
      expect(refusal(northLine(metres))).toBe(
        'level file: lengthMetres must be between 1500 and 5000',
      );
    });

    it.each([1500, 5000])('reads %i m', (metres) => {
      const file = parseLevelFile(northLine(metres));
      expect(file.lengthMetres).toBe(metres);
      expect(Math.abs(levelLength(file.points, file.shape) - metres)).toBeLessThan(1);
    });

    it('refuses a stated length its points do not measure', () => {
      expect(refusal(northLine(3000, 3100))).toBe(
        'level file: lengthMetres must be within 25 metres of the length its points measure',
      );
    });

    it('refuses a gap of more than 50 m between two points', () => {
      const raw = northLine(2000);
      raw.points.splice(5, 6);
      expect(refusal(raw)).toBe(
        'level file: points[5] must be within 50 metres of the point before it',
      );
    });
  });

  describe('a loop or point to point (D-5.2)', () => {
    /** A 500 m square from the fixture's first point, closed by its own last step. */
    function square(): Raw {
      const raw = fixture();
      const [latitude, longitude] = raw.points[0] as [number, number, number];
      const perLongitude = METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180);
      const corners = [
        [0, 0],
        [500, 0],
        [500, 500],
        [0, 500],
      ] as const;
      const points: number[][] = [];
      for (let side = 0; side < 4; side += 1) {
        const [n0, e0] = corners[side] as readonly [number, number];
        const [n1, e1] = corners[(side + 1) % 4] as readonly [number, number];
        for (let step = 0; step < 50; step += 1) {
          const t = step / 50;
          points.push([
            latitude + (n0 + (n1 - n0) * t) / METRES_PER_DEGREE,
            longitude + (e0 + (e1 - e0) * t) / perLongitude,
            10,
          ]);
        }
      }
      raw.points = points;
      raw.shape = 'loop';
      raw.lengthMetres = 2000;
      return raw;
    }

    it('reads a loop, measured back to its first point', () => {
      const file = parseLevelFile(square());
      expect(file.shape).toBe('loop');
      expect(levelLength(file.points, 'loop')).toBeCloseTo(2000, -1);
      expect(levelLength(file.points, 'point-to-point')).toBeCloseTo(1990, -1);
    });

    it('refuses a loop that does not close', () => {
      const raw = fixture();
      raw.shape = 'loop';
      expect(refusal(raw)).toBe(
        `level file: points must close, for a loop: the last must be within ${String(LOOP_CLOSURE_METRES)} metres of the first`,
      );
    });

    it('refuses a shape of neither kind', () => {
      const raw = fixture();
      raw.shape = 'figure-eight';
      expect(refusal(raw)).toBe('level file: shape must be one of loop, point-to-point');
    });

    it('measures a point-to-point line open, with no step back to its start', () => {
      const points: LevelPoint[] = fixture().points.map((point) => point as unknown as LevelPoint);
      expect(levelLength(points, 'point-to-point')).toBeCloseTo(2000, 0);
      expect(levelLength(points, 'loop')).toBeCloseTo(4000, 0);
    });
  });

  describe('the round’s parameters are range-checked (D-4.1)', () => {
    it.each([
      [
        'houses',
        (raw: Raw): unknown => (raw.round.houses = 2),
        'round.houses must be between 3 and 12',
      ],
      [
        'houses',
        (raw: Raw): unknown => (raw.round.houses = MOST_HOUSES + 1),
        'round.houses must be between 3 and 12',
      ],
      [
        'houses',
        (raw: Raw): unknown => (raw.round.houses = 6.5),
        'round.houses must be a whole number',
      ],
      [
        'a throw window wider than throw.ts’ own',
        (raw: Raw): unknown =>
          ((raw.round.throwWindow as Raw).beforeMetres = THROW_WINDOW_BEFORE_METRES + 1),
        'round.throwWindow.beforeMetres must be between 1 and 20',
      ],
      [
        'a throw window reaching past the house',
        (raw: Raw): unknown => ((raw.round.throwWindow as Raw).afterMetres = 2),
        'round.throwWindow.afterMetres must be between 0 and 1',
      ],
      [
        'more hazards than one every 250 m',
        (raw: Raw): unknown => ((raw.round.hazardsPerKilometre as Raw).moving = 5),
        'round.hazardsPerKilometre.moving must be between 0 and 4',
      ],
      [
        'a hazard kind the roster does not have',
        (raw: Raw): unknown => ((raw.round.hazardsPerKilometre as Raw).dragons = 1),
        'round.hazardsPerKilometre holds a key the format does not have (dragons)',
      ],
      [
        'a mailbox share over one',
        (raw: Raw): unknown => (raw.round.mailboxShare = 1.5),
        'round.mailboxShare must be between 0 and 1',
      ],
      [
        'most houses no-delivery',
        (raw: Raw): unknown => (raw.round.noDeliveryShare = 0.6),
        'round.noDeliveryShare must be a share from none to half of the round’s houses',
      ],
      [
        'a weather it does not draw',
        (raw: Raw): unknown => (raw.round.weather = 'snow'),
        'round.weather must be one of clear, rain',
      ],
      [
        'a light it does not draw',
        (raw: Raw): unknown => (raw.round.light = 'night'),
        'round.light must be one of day, dusk',
      ],
    ] as const)('refuses %s', (_what, change, message) => {
      const raw = fixture();
      change(raw);
      expect(refusal(raw)).toBe(`level file: ${message}`);
    });
  });

  describe('a footprint carries only the building fields map-features rules, each to its rule (D-2.2)', () => {
    it.each([
      ['an enum value off its list', 'buildingType', 'castle', 'must be one of'],
      ['a level count below one', 'levels', 0, 'must be between 1 and 100'],
      ['a palette index past the palette', 'wallColour', 20, 'must be between 0 and 19'],
      ['a roof direction off its step', 'roofDirectionDegrees', 7, 'must be a multiple of 15'],
      ['a field as text that is a number', 'levels', '2', 'must be a finite number'],
    ] as const)('refuses %s', (_what, name, value, rule) => {
      const raw = fixture();
      ((raw.buildings[2] as Raw).fields as Record<string, unknown>)[name] = value;
      expect(refusal(raw)).toContain(`level file: buildings[2].fields.${name} ${rule}`);
    });

    it('refuses a ring of fewer than three corners, or an odd list', () => {
      const raw = fixture();
      (raw.buildings[0] as { rings: number[][] }).rings = [[0, 0, 1, 1]];
      expect(refusal(raw)).toMatch(/^level file: buildings\[0\]\.rings\[0\] must be a flat list/);
      const odd = fixture();
      (odd.buildings[0] as { rings: number[][] }).rings = [[0, 0, 1, 1, 2]];
      expect(refusal(odd)).toMatch(/^level file: buildings\[0\]\.rings\[0\] must be a flat list/);
    });

    it('reads a level with no buildings at all as a level, which the build tool then refuses', () => {
      const raw = fixture();
      raw.buildings = [];
      expect(parseLevelFile(raw).buildings).toStrictEqual([]);
    });
  });

  describe('its id, name, provenance and licence', () => {
    it.each([
      ['a circuit’s route id', 'circuit:kestrel'],
      ['a level’s route id', 'level:fixture-level'],
      ['a saved route’s id as main.tsx mints them', '3f0c9a52-5b8e-4f8e-9a7d-2c1b0e6d4a11'],
      ['an id in capitals', 'Fixture'],
    ])('refuses %s as a level id', (_what, id) => {
      const raw = fixture();
      raw.id = id;
      expect(refusal(raw)).toBe(
        'level file: id must be 2 to 32 lowercase letters, digits and hyphens, starting with a letter',
      );
    });

    it('refuses an id that is not its file’s name', () => {
      expect(() => parseLevelFile(fixture(), 'another')).toThrow(
        'level file: id must be the file’s own name',
      );
    });

    it('refuses a name that is not our own capitalised words', () => {
      const raw = fixture();
      raw.name = '12 High Street';
      expect(refusal(raw)).toBe(
        'level file: name must be one to four capitalised words of letters',
      );
    });

    it('refuses a height source other than USGS 3DEP', () => {
      const raw = fixture();
      (raw.heights as Raw).dataset = 'SRTM';
      expect(refusal(raw)).toBe('level file: heights.dataset must be "USGS 3DEP"');
    });

    it('refuses an archive build the licence’s archive URL does not name, and a digest that is not one', () => {
      const raw = fixture();
      (raw.archive as Raw).build = 'basemap-other-20261108';
      expect(refusal(raw)).toBe(
        'level file: archive.build must be the build licence.through names',
      );
      const digest = fixture();
      (digest.archive as Raw).sha256 = 'abc';
      expect(refusal(digest)).toBe(
        'level file: archive.sha256 must be a SHA-256 digest in lowercase hexadecimal',
      );
    });

    it('refuses a licence field that is not the circuits’ own', () => {
      const raw = fixture();
      (raw.licence as Raw).id = 'CC-BY-4.0';
      expect(refusal(raw)).toBe('level file: licence.id must be "ODbL-1.0"');
    });

    it('refuses something that is not a level file at all', () => {
      expect(refusal([])).toBe('level file: file must be an object');
      expect(refusal({ ...fixture(), format: 'onyourleft-circuit' })).toBe(
        'level file: format must be "onyourleft-delivery-level"',
      );
    });
  });
});
