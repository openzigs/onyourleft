// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { geographicPosition, unixSeconds } from '../quantities';
import type { DegreesLatitude, DegreesLongitude } from '../quantities';

import {
  canonicalDefinition,
  MAXIMUM_PUBLISHED_POSITIONS,
  parsePublishedDefinition,
  PUBLISHED_SEGMENT_ID,
  publishedDefinitionOf,
  publishedSegmentId,
  segmentFromPublished,
  type PublishedSegmentDefinition,
} from './published';
import { createSegment } from './segment';

/** A sha256 stand-in with the seam's shape: deterministic, and different for different bytes. */
const fakeSha256 = (bytes: Uint8Array): Promise<Uint8Array> => {
  const out = new Uint8Array(32);
  let state = 2166136261;
  for (const [index, byte] of bytes.entries()) {
    state = Math.imul(state ^ byte, 16777619) >>> 0;
    out[index % 32] = (out[index % 32]! + (state & 0xff)) & 0xff;
  }
  return Promise.resolve(out);
};

/** Six positions a little over 110 m apart, heading north: about 555 m of road. */
const PATH: readonly (readonly [number, number])[] = Array.from(
  { length: 6 },
  (_, index) => [51.5 + index * 0.001, -0.12] as const,
);

const DEFINITION: PublishedSegmentDefinition = {
  name: 'Quarry climb',
  sport: 'ride',
  geometry: PATH,
  endpointRadiusMetres: 15,
  bearingToleranceDegrees: 60,
};

describe('a published segment definition (#68)', () => {
  it('is what a device’s own segment publishes, and parses back with the distance measured', () => {
    const own = createSegment({
      id: 'local-1',
      createdBy: 'local',
      name: 'Quarry climb',
      sport: 'ride',
      geometry: PATH.map(([latitude, longitude]) =>
        geographicPosition(latitude as DegreesLatitude, longitude as DegreesLongitude),
      ),
      elevationSource: 'device',
      altitudes: [10, 20, 30, 40, 50, 60],
      visibility: 'public',
      createdAt: unixSeconds(1_790_000_000),
    });
    const definition = publishedDefinitionOf(own);
    expect(definition).toEqual(DEFINITION);
    const parsed = parsePublishedDefinition(JSON.parse(JSON.stringify(definition)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.definition).toEqual(DEFINITION);
      expect(parsed.distance).toBeCloseTo(own.distance, 6);
      expect(parsed.distance).toBeGreaterThan(400);
    }
  });

  it('is named by a digest of itself: the same definition is one id, a different one another', async () => {
    const id = await publishedSegmentId(DEFINITION, fakeSha256);
    expect(id).toMatch(PUBLISHED_SEGMENT_ID);
    // Member order is not part of it: the canonical form sorts them.
    const reordered = JSON.parse(
      '{"sport":"ride","bearingToleranceDegrees":60,"name":"Quarry climb","endpointRadiusMetres":15,"geometry":' +
        JSON.stringify(PATH) +
        '}',
    ) as PublishedSegmentDefinition;
    expect(await publishedSegmentId(reordered, fakeSha256)).toBe(id);
    expect(canonicalDefinition(reordered)).toBe(canonicalDefinition(DEFINITION));
    expect(
      await publishedSegmentId({ ...DEFINITION, name: 'Quarry climb again' }, fakeSha256),
    ).not.toBe(id);
    // Nothing a caller's object carries beyond the five is digested.
    const extra = { ...DEFINITION, createdBy: 'somebody' } as PublishedSegmentDefinition;
    expect(await publishedSegmentId(extra, fakeSha256)).toBe(id);
  });

  it('derives the endpoints from the path when a device adds one', () => {
    const segment = segmentFromPublished(DEFINITION, {
      id: 'seg',
      createdBy: 'local',
      createdAt: 1_790_000_000,
    });
    expect(segment.visibility).toBe('public');
    expect(segment.elevationSource).toBe('none');
    expect(segment.start.position).toEqual({ latitude: 51.5, longitude: -0.12 });
    expect(segment.start.radius).toBe(15);
    expect(segment.bearingToleranceDegrees).toBe(60);
    // Heading north, so the bearing through the start is about 0°.
    expect(Math.min(segment.start.bearing, 360 - segment.start.bearing)).toBeLessThan(1);
  });

  const refusals: [string, unknown, string][] = [
    ['not an object', [DEFINITION], 'segment'],
    ['a member beyond the five', { ...DEFINITION, elevationGain: 12 }, 'segment'],
    [
      'a member missing',
      Object.fromEntries(Object.entries(DEFINITION).filter(([key]) => key !== 'name')),
      'segment',
    ],
    ['a blank name', { ...DEFINITION, name: '   ' }, 'name'],
    ['a name over 80', { ...DEFINITION, name: 'x'.repeat(81) }, 'name'],
    ['a control character in the name', { ...DEFINITION, name: 'Quarry\nclimb' }, 'name'],
    ['a sport there is no board for', { ...DEFINITION, sport: 'swim' }, 'sport'],
    [
      'a radius past the widest gate',
      { ...DEFINITION, endpointRadiusMetres: 101 },
      'endpointRadiusMetres',
    ],
    ['a radius of nothing', { ...DEFINITION, endpointRadiusMetres: 0 }, 'endpointRadiusMetres'],
    [
      'a tolerance past a half-turn',
      { ...DEFINITION, bearingToleranceDegrees: 181 },
      'bearingToleranceDegrees',
    ],
    ['two positions', { ...DEFINITION, geometry: PATH.slice(0, 2) }, 'geometry'],
    [
      'too many positions',
      {
        ...DEFINITION,
        geometry: Array.from({ length: MAXIMUM_PUBLISHED_POSITIONS + 1 }, () => PATH[0]),
      },
      'geometry',
    ],
    ['a position that is not a pair', { ...DEFINITION, geometry: [...PATH, [51.6]] }, 'geometry'],
    ['a path under 400 m', { ...DEFINITION, geometry: PATH.slice(0, 3) }, 'geometry'],
    [
      'a path that does not move',
      { ...DEFINITION, geometry: [PATH[0], PATH[0], PATH[0]] },
      'geometry',
    ],
  ];

  it.each(refusals)('refuses %s, naming the field', (_what, value, field) => {
    const parsed = parsePublishedDefinition(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.field).toBe(field);
  });

  it('names the constraint and never the coordinate it refused (ADR 0004 decision D)', () => {
    for (const bad of [
      [91.123457, -0.12],
      [51.5, -180.654321],
      [Number.NaN, -0.12],
    ]) {
      const parsed = parsePublishedDefinition({ ...DEFINITION, geometry: [...PATH, bad] });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.field).toBe('geometry');
        expect(parsed.problem).not.toMatch(/91\.12|180\.65|NaN|51\.5/);
      }
    }
  });
});
