// SPDX-License-Identifier: Apache-2.0

/**
 * No field anywhere carries a latitude or a longitude — #768 — or, since #1908, a place name.
 *
 * A rider is placed by distance along the route (ADR 0028 D-7.3) and the route
 * is referenced by content hash, so no message needs a coordinate. This walks
 * **the schema the decoder and the encoder are driven by** — every key of
 * every object and every tuple slot's name, at any depth — and fails on a
 * coordinate-named one. A field the walk cannot see is a field the decoder
 * would refuse, because the two read one table.
 *
 * ⚠️ **Why `apps/web/src/privacy`'s `coordinatesIn` is not reused.** It
 * recognises a coordinate by its VALUE — an object carrying finite numeric
 * `latitude` and `longitude` — so it walks a payload, not a schema, and a
 * schema holds no values. Moving it into `packages/` would buy this test
 * nothing: a name walk over the table is the check that covers every message
 * the decoder can ever accept, rather than the samples a test happened to write.
 */

import { describe, expect, it } from 'vitest';

import { MESSAGE_FIELDS, type Field, type Shape } from './schema';

/** Words that name a place on the Earth. Matched against a key's camelCase words, whole. */
const COORDINATE_WORDS = new Set([
  'lat',
  'latitude',
  'lon',
  'lng',
  'long',
  'longitude',
  'coord',
  'coords',
  'coordinate',
  'coordinates',
  'geo',
  'geometry',
  'gps',
  'bbox',
  'polyline',
  'waypoint',
  'waypoints',
  // #1908: a place's NAME places a rider as surely as its coordinates do. An
  // item event or a lap names a rider and an item key, never where.
  'address',
  'street',
  'road',
  'city',
  'town',
  'village',
  'locality',
  'region',
  'country',
  'postcode',
  'zip',
  'location',
  'venue',
  'place',
  'placename',
]);

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function namesIn(fields: Readonly<Record<string, Field>>, path: string): string[] {
  return Object.entries(fields).flatMap(([key, field]) => [
    `${path}.${key}`,
    ...namesInShape(field.shape, `${path}.${key}`),
  ]);
}

function namesInShape(shape: Shape, path: string): string[] {
  switch (shape.kind) {
    case 'object':
      return namesIn(shape.fields, path);
    case 'array':
      return namesInShape(shape.items, `${path}[]`);
    case 'tuple':
      return [...shape.slots, ...(shape.tail ?? [])].flatMap((slot) => [
        `${path}.${slot.name}`,
        ...namesInShape(slot.shape, `${path}.${slot.name}`),
      ]);
    case 'rows':
      return namesInShape(shape.row, `${path}[]`);
    default:
      return [];
  }
}

function coordinateNamed(paths: readonly string[]): string[] {
  return paths.filter((path) => {
    const last = path.split('.').pop() ?? '';
    return words(last).some((word) => COORDINATE_WORDS.has(word));
  });
}

const EVERY_NAME = Object.entries(MESSAGE_FIELDS).flatMap(([type, fields]) =>
  namesIn(fields as Readonly<Record<string, Field>>, type),
);

describe('no message carries a coordinate or a place name — #768, #1908', () => {
  it('walks every field of every message, nested fields and tuple slots included', () => {
    // Non-vacuity: the walk reaches the depths it claims to.
    expect(EVERY_NAME).toContain('welcome.routeRef.sha256');
    expect(EVERY_NAME).toContain('welcome.roomConfig.ridingPosition');
    expect(EVERY_NAME).toContain('frame.riders[].decimetres');
    expect(EVERY_NAME).toContain('report.powerWatts');
    // #1908: a tuple's tail, an array of tuples, and an object two deep.
    expect(EVERY_NAME).toContain('frame.riders[].raceOffsetCentimetres');
    expect(EVERY_NAME).toContain('frame.riders[].held');
    expect(EVERY_NAME).toContain('frame.itemEvents[].item');
    expect(EVERY_NAME).toContain('welcome.roomConfig.lapRace.laps');
    expect(EVERY_NAME).toContain('lane.lane');
    expect(EVERY_NAME).toContain('item-use.sequence');
  });

  it('finds no coordinate-named field', () => {
    expect(coordinateNamed(EVERY_NAME)).toEqual([]);
  });

  it('would find one, at any depth — the control', () => {
    const planted: Readonly<Record<string, Field>> = {
      riders: {
        shape: {
          kind: 'rows',
          maximumLength: 1,
          row: {
            kind: 'tuple',
            slots: [{ name: 'startLatitude', shape: { kind: 'integer', minimum: 0, maximum: 1 } }],
          },
        },
      },
      where: {
        shape: {
          kind: 'object',
          fields: { lng: { shape: { kind: 'number', minimum: 0, maximum: 1 } } },
        },
      },
    };
    expect(coordinateNamed(namesIn(planted, 'planted'))).toEqual([
      'planted.riders[].startLatitude',
      'planted.where.lng',
    ]);
    // `ridingPosition` is where a rider's hands are, not where they are.
    expect(coordinateNamed(['x.ridingPosition', 'x.decimetres'])).toEqual([]);
  });

  it('would find a place name, in a tuple’s tail as in its slots — #1908', () => {
    const planted: Readonly<Record<string, Field>> = {
      events: {
        shape: {
          kind: 'array',
          maximumLength: 1,
          items: {
            kind: 'tuple',
            slots: [{ name: 'riderId', shape: { kind: 'integer', minimum: 0, maximum: 1 } }],
            tail: [{ name: 'hitTown', shape: { kind: 'integer', minimum: 0, maximum: 1 } }],
          },
        },
      },
      placeName: { shape: { kind: 'string', pattern: /^.+$/, maximumLength: 1 } },
    };
    expect(coordinateNamed(namesIn(planted, 'planted'))).toEqual([
      'planted.events[].hitTown',
      'planted.placeName',
    ]);
  });
});
