// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A built-in lap-race circuit's file**, and the one reader of it — #2293,
 * [ADR 0064](../../../../../docs/adr/0064-built-in-lap-race-circuits-shipped-in-the-app-under-odbl.md).
 *
 * Per circuit, one plain JSON file under `data/` (D-2.1): its points (latitude,
 * longitude, height), closing on itself within `LOOP_CLOSURE_METRES`; its own
 * name and length; where its heights came from; and the licence it is offered
 * under, inside the file (D-3.2, ODbL §4.2 b). **No OSM identifier, no street
 * or place name, no address, no owner, no route id and no device time** — and
 * {@link parseCircuitFile} refuses any key it does not name, so one cannot be
 * added by accident and ship.
 *
 * The files are written by `tools/circuits/author-circuit.ts`, which a
 * developer runs by hand outside CI (D-7.1). This module reads them: it is
 * handed the parsed JSON and answers a checked {@link CircuitFile}, or throws
 * a {@link CircuitFileError} that **names the field and the constraint and
 * never the value** (ADR 0004 D, ADR 0064 D-9.3): a circuit's values are
 * coordinates.
 */

import { distanceBetween, LOOP_CLOSURE_METRES, type GeographicPosition } from '@onyourleft/domain';

import { ODBL_LICENCE_URL, ODBL_NOTICE } from '../../map/basemap';

/** What the file says it is. */
export const CIRCUIT_FILE_FORMAT = 'onyourleft-circuit';

/** The one version of the format there is. */
export const CIRCUIT_FILE_VERSION = 1;

/**
 * The licence every circuit file carries, field for field (D-3.2). The archive
 * a circuit was drawn through is the file's own `licence.through`.
 */
export const CIRCUIT_LICENCE = Object.freeze({
  id: 'ODbL-1.0',
  url: ODBL_LICENCE_URL,
  source: 'OpenStreetMap contributors',
  sourceUrl: 'https://www.openstreetmap.org/copyright',
  notice: ODBL_NOTICE,
});

/** The one height source a circuit may name (D-7.2, the owner's answer to Q3). */
export const CIRCUIT_HEIGHTS_DATASET = 'USGS 3DEP';

/** "About 3–8 km" (the owner's ruling on #2293). */
export const CIRCUIT_SHORTEST_METRES = 3000;
export const CIRCUIT_LONGEST_METRES = 8000;

/** The widest gap between two points the authoring script leaves. */
export const CIRCUIT_MOST_STEP_METRES = 50;

/** How far the stated length may be from the length the points measure. */
export const CIRCUIT_LENGTH_TOLERANCE_METRES = 25;

/** A circuit's id: lowercase, the file's name and the `circuit:` key's second half. */
const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** A circuit's name: our own words, letters and spaces (ADR 0060 D-1.5). */
const NAME_PATTERN = /^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*){0,3}$/;

/** One point: latitude and longitude in degrees, height in metres. */
export type CircuitPoint = readonly [latitude: number, longitude: number, height: number];

export interface CircuitFile {
  readonly format: typeof CIRCUIT_FILE_FORMAT;
  readonly version: typeof CIRCUIT_FILE_VERSION;
  readonly id: string;
  readonly name: string;
  /** Along the ground, closed: the last point back to the first included. */
  readonly lengthMetres: number;
  readonly heights: { readonly dataset: string; readonly resolutionMetres: number };
  readonly licence: typeof CIRCUIT_LICENCE & { readonly through: string };
  /** How the authoring script laid the loop out, so a redraw draws the same one. */
  readonly drawn: {
    readonly radiusMetres: number;
    readonly bearingDegrees: number;
    readonly corners: number;
  };
  readonly points: readonly CircuitPoint[];
}

/** A circuit file that is not one. The message names the field and the constraint, never the value. */
export class CircuitFileError extends Error {
  constructor(
    readonly field: string,
    constraint: string,
  ) {
    super(`circuit file: ${field} ${constraint}`);
    this.name = 'CircuitFileError';
  }
}

type Json = Readonly<Record<string, unknown>>;

function object(value: unknown, field: string, keys: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CircuitFileError(field, 'must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      // The key is the file's, not a value from it: naming it is the diagnostic.
      throw new CircuitFileError(
        field,
        `holds a key the format does not have (${key.slice(0, 40)})`,
      );
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw new CircuitFileError(field === 'file' ? key : `${field}.${key}`, 'is missing');
    }
  }
  return value as Json;
}

function finite(value: unknown, field: string, lowest: number, highest: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CircuitFileError(field, 'must be a finite number');
  }
  if (value < lowest || value > highest) {
    throw new CircuitFileError(field, `must be between ${String(lowest)} and ${String(highest)}`);
  }
  return value;
}

function exactly(value: unknown, field: string, expected: string | number): void {
  if (value !== expected) throw new CircuitFileError(field, `must be ${JSON.stringify(expected)}`);
}

function text(value: unknown, field: string, pattern: RegExp, rule: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new CircuitFileError(field, rule);
  }
  return value;
}

function position(point: CircuitPoint): GeographicPosition {
  return { latitude: point[0], longitude: point[1] } as GeographicPosition;
}

/** The closed length of a circuit's points: every step, and the last point back to the first. */
export function circuitLength(points: readonly CircuitPoint[]): number {
  let total = 0;
  points.forEach((point, at) => {
    total += distanceBetween(
      position(point),
      position(points[(at + 1) % points.length] as CircuitPoint),
    );
  });
  return total;
}

/**
 * The file, checked. `expectedId` is the file's name without `.json`, which
 * must be its `id`.
 *
 * @throws {CircuitFileError} for every way the file can fail to be a circuit.
 */
export function parseCircuitFile(value: unknown, expectedId?: string): CircuitFile {
  const file = object(value, 'file', [
    'format',
    'version',
    'id',
    'name',
    'lengthMetres',
    'heights',
    'licence',
    'drawn',
    'points',
  ]);
  exactly(file.format, 'format', CIRCUIT_FILE_FORMAT);
  exactly(file.version, 'version', CIRCUIT_FILE_VERSION);
  const id = text(
    file.id,
    'id',
    ID_PATTERN,
    'must be 2 to 32 lowercase letters, digits and hyphens',
  );
  if (expectedId !== undefined && id !== expectedId) {
    throw new CircuitFileError('id', 'must be the file’s own name');
  }
  const name = text(
    file.name,
    'name',
    NAME_PATTERN,
    'must be one to four capitalised words of letters',
  );

  const heights = object(file.heights, 'heights', ['dataset', 'resolutionMetres']);
  exactly(heights.dataset, 'heights.dataset', CIRCUIT_HEIGHTS_DATASET);
  const resolutionMetres = finite(heights.resolutionMetres, 'heights.resolutionMetres', 0.1, 30);

  const licence = object(file.licence, 'licence', [...Object.keys(CIRCUIT_LICENCE), 'through']);
  for (const [key, expected] of Object.entries(CIRCUIT_LICENCE)) {
    exactly(licence[key], `licence.${key}`, expected);
  }
  const through = text(
    licence.through,
    'licence.through',
    /^https:\/\/[^\s]+\.pmtiles$/,
    'must be the https: URL of the archive it was drawn through',
  );

  const drawn = object(file.drawn, 'drawn', ['radiusMetres', 'bearingDegrees', 'corners']);
  const radiusMetres = finite(drawn.radiusMetres, 'drawn.radiusMetres', 1, 5000);
  const bearingDegrees = finite(drawn.bearingDegrees, 'drawn.bearingDegrees', 0, 359);
  const corners = finite(drawn.corners, 'drawn.corners', 2, 8);

  if (!Array.isArray(file.points) || file.points.length < 3) {
    throw new CircuitFileError('points', 'must be a list of at least three points');
  }
  const points: CircuitPoint[] = (file.points as unknown[]).map((raw, at) => {
    const field = `points[${String(at)}]`;
    if (!Array.isArray(raw) || raw.length !== 3) {
      throw new CircuitFileError(field, 'must be [latitude, longitude, height]');
    }
    return [
      finite(raw[0], `${field} latitude`, -90, 90),
      finite(raw[1], `${field} longitude`, -180, 180),
      finite(raw[2], `${field} height`, -500, 9000),
    ] as const;
  });
  points.forEach((point, at) => {
    const next = points[(at + 1) % points.length] as CircuitPoint;
    const step = distanceBetween(position(point), position(next));
    if (at === points.length - 1) {
      if (step > LOOP_CLOSURE_METRES) {
        throw new CircuitFileError(
          'points',
          `must close: the last must be within ${String(LOOP_CLOSURE_METRES)} metres of the first`,
        );
      }
    } else if (step > CIRCUIT_MOST_STEP_METRES) {
      throw new CircuitFileError(
        `points[${String(at + 1)}]`,
        `must be within ${String(CIRCUIT_MOST_STEP_METRES)} metres of the point before it`,
      );
    }
  });

  const lengthMetres = finite(
    file.lengthMetres,
    'lengthMetres',
    CIRCUIT_SHORTEST_METRES,
    CIRCUIT_LONGEST_METRES,
  );
  if (Math.abs(circuitLength(points) - lengthMetres) > CIRCUIT_LENGTH_TOLERANCE_METRES) {
    throw new CircuitFileError(
      'lengthMetres',
      `must be within ${String(CIRCUIT_LENGTH_TOLERANCE_METRES)} metres of the length its points measure`,
    );
  }

  return {
    format: CIRCUIT_FILE_FORMAT,
    version: CIRCUIT_FILE_VERSION,
    id,
    name,
    lengthMetres,
    heights: { dataset: CIRCUIT_HEIGHTS_DATASET, resolutionMetres },
    licence: { ...CIRCUIT_LICENCE, through },
    drawn: { radiusMetres, bearingDegrees, corners },
    points,
  };
}
