// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The circuit file's reader — #2293, ADR 0064 D-2.1 and D-9.3. Every refusal
 * names the field and the constraint and **never the value**: a circuit's
 * values are coordinates, and ADR 0004 D binds every layer that formats one.
 *
 * The fixture is synthetic: a square of about 4 km at made-up coordinates.
 */

import { describe, expect, it } from 'vitest';

import {
  CIRCUIT_FILE_FORMAT,
  CIRCUIT_FILE_VERSION,
  CIRCUIT_HEIGHTS_DATASET,
  CIRCUIT_LICENCE,
  CircuitFileError,
  circuitLength,
  parseCircuitFile,
  type CircuitPoint,
} from './circuit-file';

const LATITUDE = 12.345678;
const LONGITUDE = -98.765432;
const METRES_PER_DEGREE = 111_320;

/** A square of `side` metres, a point every 10 m, not repeating the first. */
function square(side: number): CircuitPoint[] {
  const perLon = METRES_PER_DEGREE * Math.cos((LATITUDE * Math.PI) / 180);
  const points: CircuitPoint[] = [];
  const corners = [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
  ] as const;
  corners.forEach(([x0, z0], at) => {
    const [x1, z1] = corners[(at + 1) % 4] as readonly [number, number];
    for (let step = 0; step < side / 10; step += 1) {
      const t = step / (side / 10);
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      points.push([
        Number((LATITUDE + z / METRES_PER_DEGREE).toFixed(6)),
        Number((LONGITUDE + x / perLon).toFixed(6)),
        Number((200 + z / 100).toFixed(1)),
      ]);
    }
  });
  return points;
}

function file(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const points = square(1000);
  return {
    format: CIRCUIT_FILE_FORMAT,
    version: CIRCUIT_FILE_VERSION,
    id: 'fixture',
    name: 'Fixture Loop',
    lengthMetres: Math.round(circuitLength(points)),
    heights: { dataset: CIRCUIT_HEIGHTS_DATASET, resolutionMetres: 1 },
    licence: { ...CIRCUIT_LICENCE, through: 'https://tiles.example.org/basemap.pmtiles' },
    drawn: { radiusMetres: 500, bearingDegrees: 90, corners: 3 },
    points,
    ...overrides,
  };
}

/** The error, which must name no digit run of the fixture's coordinates. */
function refusal(value: unknown): CircuitFileError {
  try {
    parseCircuitFile(value, 'fixture');
  } catch (error) {
    expect(error).toBeInstanceOf(CircuitFileError);
    const message = (error as Error).message;
    for (const digits of ['12.34', '345678', '98.76', '765432', '2345', '7654']) {
      expect(message).not.toContain(digits);
    }
    return error as CircuitFileError;
  }
  throw new Error('expected a refusal');
}

describe('parseCircuitFile — #2293', () => {
  it('reads a good file back, field for field', () => {
    const given = file();
    const read = parseCircuitFile(given, 'fixture');
    expect(read).toStrictEqual(given);
  });

  it('refuses a key the format does not have, so nothing extra can ship', () => {
    expect(refusal(file({ osm_id: 12345 })).field).toBe('file');
    expect(refusal(file({ street: 'High Street' })).message).toContain('(street)');
    const licence = {
      ...CIRCUIT_LICENCE,
      through: 'https://tiles.example.org/a.pmtiles',
      owner: 'x',
    };
    expect(refusal(file({ licence })).field).toBe('licence');
  });

  it('refuses a missing key', () => {
    const given = file();
    delete given.heights;
    expect(refusal(given).field).toBe('heights');
  });

  it('refuses a file whose licence is not the circuits’ licence, field by field', () => {
    for (const key of Object.keys(CIRCUIT_LICENCE)) {
      const licence = {
        ...CIRCUIT_LICENCE,
        [key]: 'CC0-1.0',
        through: 'https://tiles.example.org/a.pmtiles',
      };
      expect(refusal(file({ licence })).field).toBe(`licence.${key}`);
    }
    const plain = { ...CIRCUIT_LICENCE, through: 'http://tiles.example.org/a.pmtiles' };
    expect(refusal(file({ licence: plain })).field).toBe('licence.through');
  });

  it('refuses heights from any source but USGS 3DEP', () => {
    const heights = { dataset: 'Copernicus DEM GLO-30', resolutionMetres: 30 };
    expect(refusal(file({ heights })).field).toBe('heights.dataset');
  });

  it('refuses a loop that does not close, naming the constraint and not where its ends are', () => {
    const points = square(1000).slice(0, -20);
    const error = refusal(file({ points, lengthMetres: Math.round(circuitLength(points)) }));
    expect(error.field).toBe('points');
    expect(error.message).toContain('must close');
  });

  it('refuses a gap between points wider than the authoring script leaves', () => {
    const points = square(1000);
    points.splice(10, 10);
    const error = refusal(file({ points, lengthMetres: Math.round(circuitLength(points)) }));
    expect(error.field).toBe('points[10]');
  });

  it('refuses a point that is not three finite numbers in range', () => {
    const points = square(1000);
    points[5] = [Number.NaN, 0, 0];
    expect(refusal(file({ points })).field).toBe('points[5] latitude');
    const out = square(1000);
    out[6] = [12, 200, 0];
    expect(refusal(file({ points: out })).field).toBe('points[6] longitude');
    const two = square(1000) as unknown[];
    two[7] = [12, 13];
    expect(refusal(file({ points: two })).field).toBe('points[7]');
  });

  it('refuses a stated length its points do not measure, or outside 3 to 8 km', () => {
    expect(refusal(file({ lengthMetres: 5000 })).field).toBe('lengthMetres');
    const small = square(500);
    expect(
      refusal(file({ points: small, lengthMetres: Math.round(circuitLength(small)) })).field,
    ).toBe('lengthMetres');
  });

  it('refuses an id that is not the file’s name, and a name that is not ours in plain words', () => {
    expect(refusal(file({ id: 'other' })).field).toBe('id');
    expect(refusal(file({ id: 'Bad Id' })).field).toBe('id');
    expect(refusal(file({ name: 'loop 7' })).field).toBe('name');
    expect(refusal(file({ name: '' })).field).toBe('name');
  });

  it('refuses another format or version, and anything that is not an object', () => {
    expect(refusal(file({ format: 'gpx' })).field).toBe('format');
    expect(refusal(file({ version: 2 })).field).toBe('version');
    expect(refusal([]).field).toBe('file');
    expect(refusal(null).field).toBe('file');
    expect(refusal(file({ points: 'none' })).field).toBe('points');
  });
});
