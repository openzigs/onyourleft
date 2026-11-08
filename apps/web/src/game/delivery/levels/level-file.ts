// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A built-in Delivery level's file**, and the one reader of it — #2361,
 * [ADR 0065](../../../../../../docs/adr/0065-built-in-delivery-levels-shipped-in-the-app-under-odbl.md).
 *
 * Per level, one plain JSON file under `data/` (D-2.1): its own id and name;
 * its line as points (latitude, longitude, height), a loop or point to point
 * (D-5.2); its length, 1.5 to 5 km (D-5.1); where its heights came from
 * (D-7.4); the round's parameters (D-4.1); the building footprints of the
 * corridor round its line (D-2.2); the archive build it was drawn from and the
 * digest of what was read (D-5.3); and the licence it is offered under, inside
 * the file (D-6.2), field for field the circuits' own.
 *
 * ⚠️ **No house list, no seed, no OSM id, no street or place name, no address,
 * no owner, no other route id, no device time and no tile list** (D-2.3).
 * {@link parseLevelFile} **fails closed**: a key the format does not name, at
 * any depth, is refused, so one added by a later authoring change is a red
 * test and not a silent publication. Which buildings a round uses is picked
 * per ride by a seed held in memory (D-4.2, ADR 0059 D-4), never here.
 *
 * The files are written by `tools/delivery-levels/author-level.ts`, which a
 * developer runs by hand outside CI (D-7.3). This module reads them: it is
 * handed the parsed JSON and answers a checked {@link LevelFile}, or throws a
 * {@link LevelFileError} that **names the field and the constraint and never
 * the value** (ADR 0004 D, D-13.3): a level's points and outlines are
 * coordinates, and the bounds of a latitude or a longitude are put in words,
 * so not even a digit of a refused coordinate can be read off the message.
 *
 * Since #2362 the app reads the shipped files through it: `levels.ts`
 * §`levelLibrary`, for the level a rider chose on the Delivery picker.
 */

import { distanceBetween, LOOP_CLOSURE_METRES, type GeographicPosition } from '@onyourleft/domain';
import {
  BUILDING_FIELD_NAMES,
  BUILDING_FIELD_RULES,
  BUILDING_KINDS,
  type BuildingFieldName,
} from '@onyourleft/map-features';

import { CIRCUIT_HEIGHTS_DATASET, CIRCUIT_LICENCE } from '../../circuits/circuit-file';
import { OBSTACLE_SPACING_METRES } from '../obstacles';
import { FEWEST_DELIVERY_HOUSES, MOST_HOUSES } from '../round';
import { THROW_WINDOW_AFTER_METRES, THROW_WINDOW_BEFORE_METRES } from '../throw';

/** What the file says it is. */
export const LEVEL_FILE_FORMAT = 'onyourleft-delivery-level';

/** The one version of the format there is. */
export const LEVEL_FILE_VERSION = 1;

/**
 * The licence every level file carries: **the circuits' fields, not a copy of
 * them** (D-6.2 names exactly ADR 0064 D-3.2's). The archive a level was drawn
 * through is the file's own `licence.through`.
 */
export const LEVEL_LICENCE = CIRCUIT_LICENCE;

/** The one height source a level may name (D-7.4): the circuits' own. */
export const LEVEL_HEIGHTS_DATASET = CIRCUIT_HEIGHTS_DATASET;

/** "1.5–5 km" (the owner's ruling, D-5.1). The circuits' 3 to 8 km stay theirs. */
export const LEVEL_SHORTEST_METRES = 1500;
export const LEVEL_LONGEST_METRES = 5000;

/** The widest gap between two points of the line. */
export const LEVEL_MOST_STEP_METRES = 50;

/** How far the stated length may be from the length the points measure. */
export const LEVEL_LENGTH_TOLERANCE_METRES = 25;

/** The most hazards of one kind a kilometre: one every `obstacles.ts` §`OBSTACLE_SPACING_METRES`. */
export const LEVEL_MOST_HAZARDS_PER_KILOMETRE = 1000 / OBSTACLE_SPACING_METRES;

/**
 * The most of a round's houses that may be ones that must not get a parcel
 * (D-10.3): half, so a round is always mostly deliveries.
 */
export const LEVEL_MOST_NO_DELIVERY_SHARE = 0.5;

/** How far from the first point an outline's corner may be, metres: well past any corridor. */
export const LEVEL_FARTHEST_OUTLINE_METRES = 10_000;

/** The most buildings one file may hold; the byte ceilings bind long before it. */
export const LEVEL_MOST_BUILDINGS = 50_000;

/** The most corners one outline ring may have (a flat list holds two numbers a corner). */
export const LEVEL_MOST_RING_CORNERS = 1024;

/** The most rings one footprint may have: its outline and its courtyards. */
export const LEVEL_MOST_RINGS = 16;

/**
 * A level's id: lowercase, the file's name and the `level:` key's second half.
 * The one rule: `levels.ts` §`levelOfRouteId` reads a route id's second half
 * with it too.
 */
export const LEVEL_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** A level's name: our own words, letters and spaces (D-12; not a place name). */
const NAME_PATTERN = /^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*){0,3}$/;

/** The archive's build: its file's name, without `.pmtiles` (ADR 0062 D-2's dated names). */
const BUILD_PATTERN = /^[a-z][a-z0-9-]{0,62}-\d{8}$/;

/** One point: latitude and longitude in degrees, height in metres. */
export type LevelPoint = readonly [latitude: number, longitude: number, height: number];

/** A loop closes within `LOOP_CLOSURE_METRES`; a point-to-point round ends at its last point (D-5.2). */
export type LevelShape = 'loop' | 'point-to-point';

export const LEVEL_SHAPES: readonly LevelShape[] = ['loop', 'point-to-point'];

/** The kinds of hazard a round places (D-10.1, D-10.2), each at a density a kilometre; `0` places none. */
export const LEVEL_HAZARD_KINDS = ['static', 'moving'] as const;
export type LevelHazardKind = (typeof LEVEL_HAZARD_KINDS)[number];

export const LEVEL_WEATHERS = ['clear', 'rain'] as const;
export const LEVEL_LIGHTS = ['day', 'dusk'] as const;

/** The round's parameters (D-4.1). Never a house, a target or a seed. */
export interface LevelRound {
  /** Houses on the round: {@link FEWEST_DELIVERY_HOUSES} to {@link MOST_HOUSES}. */
  readonly houses: number;
  /** No wider than `throw.ts`' own window, which the assisted setting still scales. */
  readonly throwWindow: { readonly beforeMetres: number; readonly afterMetres: number };
  readonly hazardsPerKilometre: Readonly<Record<LevelHazardKind, number>>;
  /** The share of targets that are mailboxes, 0 to 1 (D-10.3). */
  readonly mailboxShare: number;
  /** The share of the round's houses that must not get a parcel (D-10.3). */
  readonly noDeliveryShare: number;
  readonly weather: (typeof LEVEL_WEATHERS)[number];
  readonly light: (typeof LEVEL_LIGHTS)[number];
}

/**
 * One building footprint (D-2.2): its kind, its heights, the building fields
 * the realistic world reads for drawing it — only those that are set, each to
 * `@onyourleft/map-features` §`BUILDING_FIELD_RULES` — and its rings as flat
 * `x0, z0, x1, z1, …` lists in local metres from the line's first point
 * (`x` is metres WEST, as `localMetres` has it).
 */
export interface LevelBuilding {
  readonly kind: (typeof BUILDING_KINDS)[number];
  readonly heightMetres: number | null;
  readonly minHeightMetres: number | null;
  readonly fields: Readonly<Partial<Record<BuildingFieldName, string | number>>>;
  readonly rings: readonly (readonly number[])[];
}

export interface LevelFile {
  readonly format: typeof LEVEL_FILE_FORMAT;
  readonly version: typeof LEVEL_FILE_VERSION;
  readonly id: string;
  readonly name: string;
  readonly shape: LevelShape;
  /** Along the ground; for a loop, the last point back to the first included. */
  readonly lengthMetres: number;
  readonly heights: { readonly dataset: string; readonly resolutionMetres: number };
  readonly round: LevelRound;
  /** The archive build drawn from, and the SHA-256 of every tile and height answer read (D-5.3). */
  readonly archive: { readonly build: string; readonly sha256: string };
  readonly licence: typeof LEVEL_LICENCE & { readonly through: string };
  readonly buildings: readonly LevelBuilding[];
  readonly points: readonly LevelPoint[];
}

/** A level file that is not one. The message names the field and the constraint, never the value. */
export class LevelFileError extends Error {
  constructor(
    readonly field: string,
    constraint: string,
  ) {
    super(`level file: ${field} ${constraint}`);
    this.name = 'LevelFileError';
  }
}

type Json = Readonly<Record<string, unknown>>;

/**
 * An object holding every one of `keys` and nothing else; with `optional`,
 * any of those as well. The refusal names the key, which is the format's
 * word or a key the file added — never a value from it.
 */
function object(
  value: unknown,
  field: string,
  keys: readonly string[],
  optional: readonly string[] = [],
): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LevelFileError(field, 'must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optional.includes(key)) {
      throw new LevelFileError(field, `holds a key the format does not have (${key.slice(0, 40)})`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw new LevelFileError(field === 'file' ? key : `${field}.${key}`, 'is missing');
    }
  }
  return value as Json;
}

/**
 * A finite number in `[lowest, highest]`. `rule` puts a bound that is not a
 * whole number in words: no message Delivery raises carries a decimal number
 * (`privacy/delivery-targets-never-sent.test.ts`, ADR 0004 D).
 */
function finite(
  value: unknown,
  field: string,
  lowest: number,
  highest: number,
  rule = `must be between ${String(lowest)} and ${String(highest)}`,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LevelFileError(field, 'must be a finite number');
  }
  if (value < lowest || value > highest) {
    throw new LevelFileError(field, rule);
  }
  return value;
}

function whole(value: unknown, field: string, lowest: number, highest: number): number {
  const number = finite(value, field, lowest, highest);
  if (!Number.isInteger(number)) throw new LevelFileError(field, 'must be a whole number');
  return number;
}

/** A coordinate, checked with its bounds in words: the message holds no digit of the value or of a bound. */
function coordinate(value: unknown, field: string, limit: 90 | 180): number {
  const rule =
    limit === 90
      ? 'must be a latitude, from the south pole to the north'
      : 'must be a longitude, from the antimeridian west to east';
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new LevelFileError(field, rule);
  }
  return value;
}

function exactly(value: unknown, field: string, expected: string | number): void {
  if (value !== expected) throw new LevelFileError(field, `must be ${JSON.stringify(expected)}`);
}

function text(value: unknown, field: string, pattern: RegExp, rule: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new LevelFileError(field, rule);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new LevelFileError(field, `must be one of ${values.join(', ')}`);
  }
  return value as T;
}

function heightOrNull(value: unknown, field: string): number | null {
  return value === null ? null : finite(value, field, 0, 1000);
}

function position(point: LevelPoint): GeographicPosition {
  return { latitude: point[0], longitude: point[1] } as GeographicPosition;
}

/** The length of a level's points: every step, and for a loop the last point back to the first. */
export function levelLength(points: readonly LevelPoint[], shape: LevelShape): number {
  let total = 0;
  const steps = shape === 'loop' ? points.length : points.length - 1;
  for (let at = 0; at < steps; at += 1) {
    total += distanceBetween(
      position(points[at] as LevelPoint),
      position(points[(at + 1) % points.length] as LevelPoint),
    );
  }
  return total;
}

/** One building field, held to its map-features rule. */
function buildingField(name: BuildingFieldName, value: unknown, field: string): string | number {
  const rule = BUILDING_FIELD_RULES[name];
  switch (rule.kind) {
    case 'enum':
      return oneOf(value, field, rule.values);
    case 'clamped':
      return whole(value, field, rule.min, rule.max);
    case 'index':
      return whole(value, field, 0, rule.size - 1);
    case 'direction': {
      const degrees = whole(value, field, 0, 360 - rule.step);
      if (degrees % rule.step !== 0) {
        throw new LevelFileError(field, `must be a multiple of ${String(rule.step)}`);
      }
      return degrees;
    }
  }
}

function building(raw: unknown, at: number): LevelBuilding {
  const field = `buildings[${String(at)}]`;
  const value = object(raw, field, ['kind', 'heightMetres', 'minHeightMetres', 'fields', 'rings']);
  const kind = oneOf(value.kind, `${field}.kind`, BUILDING_KINDS);
  const heightMetres = heightOrNull(value.heightMetres, `${field}.heightMetres`);
  const minHeightMetres = heightOrNull(value.minHeightMetres, `${field}.minHeightMetres`);
  const rawFields = object(value.fields, `${field}.fields`, [], BUILDING_FIELD_NAMES);
  const fields: Partial<Record<BuildingFieldName, string | number>> = {};
  for (const name of BUILDING_FIELD_NAMES) {
    if (name in rawFields) {
      fields[name] = buildingField(name, rawFields[name], `${field}.fields.${name}`);
    }
  }
  if (!Array.isArray(value.rings) || value.rings.length < 1) {
    throw new LevelFileError(`${field}.rings`, 'must be a list of at least one ring');
  }
  if (value.rings.length > LEVEL_MOST_RINGS) {
    throw new LevelFileError(`${field}.rings`, `must hold at most ${String(LEVEL_MOST_RINGS)}`);
  }
  const rings = (value.rings as unknown[]).map((ring, index) => {
    const ringField = `${field}.rings[${String(index)}]`;
    if (
      !Array.isArray(ring) ||
      ring.length < 6 ||
      ring.length % 2 !== 0 ||
      ring.length > 2 * LEVEL_MOST_RING_CORNERS
    ) {
      throw new LevelFileError(
        ringField,
        `must be a flat list of x and z for three to ${String(LEVEL_MOST_RING_CORNERS)} corners`,
      );
    }
    return (ring as unknown[]).map((number) => {
      if (
        typeof number !== 'number' ||
        !Number.isFinite(number) ||
        Math.abs(number) > LEVEL_FARTHEST_OUTLINE_METRES
      ) {
        throw new LevelFileError(
          ringField,
          'must hold finite metres within the corridor of the first point',
        );
      }
      return number;
    });
  });
  return { kind, heightMetres, minHeightMetres, fields, rings };
}

function round(raw: unknown): LevelRound {
  const value = object(raw, 'round', [
    'houses',
    'throwWindow',
    'hazardsPerKilometre',
    'mailboxShare',
    'noDeliveryShare',
    'weather',
    'light',
  ]);
  const houses = whole(value.houses, 'round.houses', FEWEST_DELIVERY_HOUSES, MOST_HOUSES);
  const window = object(value.throwWindow, 'round.throwWindow', ['beforeMetres', 'afterMetres']);
  const beforeMetres = finite(
    window.beforeMetres,
    'round.throwWindow.beforeMetres',
    1,
    THROW_WINDOW_BEFORE_METRES,
  );
  const afterMetres = finite(
    window.afterMetres,
    'round.throwWindow.afterMetres',
    0,
    THROW_WINDOW_AFTER_METRES,
  );
  const rawHazards = object(value.hazardsPerKilometre, 'round.hazardsPerKilometre', [
    ...LEVEL_HAZARD_KINDS,
  ]);
  const hazardsPerKilometre = Object.fromEntries(
    LEVEL_HAZARD_KINDS.map((kind) => [
      kind,
      finite(
        rawHazards[kind],
        `round.hazardsPerKilometre.${kind}`,
        0,
        LEVEL_MOST_HAZARDS_PER_KILOMETRE,
      ),
    ]),
  ) as Record<LevelHazardKind, number>;
  return {
    houses,
    throwWindow: { beforeMetres, afterMetres },
    hazardsPerKilometre,
    mailboxShare: finite(value.mailboxShare, 'round.mailboxShare', 0, 1),
    noDeliveryShare: finite(
      value.noDeliveryShare,
      'round.noDeliveryShare',
      0,
      LEVEL_MOST_NO_DELIVERY_SHARE,
      'must be a share from none to half of the round’s houses',
    ),
    weather: oneOf(value.weather, 'round.weather', LEVEL_WEATHERS),
    light: oneOf(value.light, 'round.light', LEVEL_LIGHTS),
  };
}

/**
 * The file, checked. `expectedId` is the file's name without `.json`, which
 * must be its `id`.
 *
 * @throws {LevelFileError} for every way the file can fail to be a level.
 */
export function parseLevelFile(value: unknown, expectedId?: string): LevelFile {
  const file = object(value, 'file', [
    'format',
    'version',
    'id',
    'name',
    'shape',
    'lengthMetres',
    'heights',
    'round',
    'archive',
    'licence',
    'buildings',
    'points',
  ]);
  exactly(file.format, 'format', LEVEL_FILE_FORMAT);
  exactly(file.version, 'version', LEVEL_FILE_VERSION);
  const id = text(
    file.id,
    'id',
    LEVEL_ID_PATTERN,
    'must be 2 to 32 lowercase letters, digits and hyphens, starting with a letter',
  );
  if (expectedId !== undefined && id !== expectedId) {
    throw new LevelFileError('id', 'must be the file’s own name');
  }
  const name = text(
    file.name,
    'name',
    NAME_PATTERN,
    'must be one to four capitalised words of letters',
  );
  const shape = oneOf(file.shape, 'shape', LEVEL_SHAPES);

  const heights = object(file.heights, 'heights', ['dataset', 'resolutionMetres']);
  exactly(heights.dataset, 'heights.dataset', LEVEL_HEIGHTS_DATASET);
  const resolutionMetres = finite(
    heights.resolutionMetres,
    'heights.resolutionMetres',
    0.1,
    30,
    'must be between a tenth of a metre and 30 metres',
  );

  const parameters = round(file.round);

  const licence = object(file.licence, 'licence', [...Object.keys(LEVEL_LICENCE), 'through']);
  for (const [key, expected] of Object.entries(LEVEL_LICENCE)) {
    exactly(licence[key], `licence.${key}`, expected);
  }
  const through = text(
    licence.through,
    'licence.through',
    /^https:\/\/[^\s]+\.pmtiles$/,
    'must be the https: URL of the archive it was drawn through',
  );

  const archive = object(file.archive, 'archive', ['build', 'sha256']);
  const build = text(
    archive.build,
    'archive.build',
    BUILD_PATTERN,
    'must be the dated name of the archive build',
  );
  if (!through.endsWith(`/${build}.pmtiles`)) {
    throw new LevelFileError('archive.build', 'must be the build licence.through names');
  }
  const sha256 = text(
    archive.sha256,
    'archive.sha256',
    /^[0-9a-f]{64}$/,
    'must be a SHA-256 digest in lowercase hexadecimal',
  );

  if (!Array.isArray(file.buildings)) {
    throw new LevelFileError('buildings', 'must be a list');
  }
  if (file.buildings.length > LEVEL_MOST_BUILDINGS) {
    throw new LevelFileError('buildings', `must hold at most ${String(LEVEL_MOST_BUILDINGS)}`);
  }
  const buildings = (file.buildings as unknown[]).map(building);

  if (!Array.isArray(file.points) || file.points.length < 3) {
    throw new LevelFileError('points', 'must be a list of at least three points');
  }
  const points: LevelPoint[] = (file.points as unknown[]).map((raw, at) => {
    const field = `points[${String(at)}]`;
    if (!Array.isArray(raw) || raw.length !== 3) {
      throw new LevelFileError(field, 'must be [latitude, longitude, height]');
    }
    return [
      coordinate(raw[0], `${field} latitude`, 90),
      coordinate(raw[1], `${field} longitude`, 180),
      finite(raw[2], `${field} height`, -500, 9000),
    ] as const;
  });
  for (let at = 0; at + 1 < points.length; at += 1) {
    const step = distanceBetween(
      position(points[at] as LevelPoint),
      position(points[at + 1] as LevelPoint),
    );
    if (step > LEVEL_MOST_STEP_METRES) {
      throw new LevelFileError(
        `points[${String(at + 1)}]`,
        `must be within ${String(LEVEL_MOST_STEP_METRES)} metres of the point before it`,
      );
    }
  }
  if (shape === 'loop') {
    const closing = distanceBetween(
      position(points[points.length - 1] as LevelPoint),
      position(points[0] as LevelPoint),
    );
    if (closing > LOOP_CLOSURE_METRES) {
      throw new LevelFileError(
        'points',
        `must close, for a loop: the last must be within ${String(LOOP_CLOSURE_METRES)} metres of the first`,
      );
    }
  }

  const lengthMetres = finite(
    file.lengthMetres,
    'lengthMetres',
    LEVEL_SHORTEST_METRES,
    LEVEL_LONGEST_METRES,
  );
  if (Math.abs(levelLength(points, shape) - lengthMetres) > LEVEL_LENGTH_TOLERANCE_METRES) {
    throw new LevelFileError(
      'lengthMetres',
      `must be within ${String(LEVEL_LENGTH_TOLERANCE_METRES)} metres of the length its points measure`,
    );
  }

  return {
    format: LEVEL_FILE_FORMAT,
    version: LEVEL_FILE_VERSION,
    id,
    name,
    shape,
    lengthMetres,
    heights: { dataset: LEVEL_HEIGHTS_DATASET, resolutionMetres },
    round: parameters,
    archive: { build, sha256 },
    licence: { ...LEVEL_LICENCE, through },
    buildings,
    points,
  };
}
