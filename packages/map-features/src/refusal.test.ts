// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { decodeTile } from './decode';
import { tileBounds } from './projection';
import { describeRefusal } from './refusal';
import { READ_LAYERS } from './schema';
import { FIXTURE_FRAME, FIXTURE_TILE, HOSTILE_FIXTURES } from './testing';
import type { DecodeLimits } from './limits';

const UNLIMITED: DecodeLimits = {
  maxBytes: Number.POSITIVE_INFINITY,
  maxFeaturesPerLayer: Number.POSITIVE_INFINITY,
  maxVerticesPerFeature: Number.POSITIVE_INFINITY,
  maxVerticesPerTile: Number.POSITIVE_INFINITY,
  maxRingsPerPolygon: Number.POSITIVE_INFINITY,
  maxPlacesPerTile: Number.POSITIVE_INFINITY,
};

/** Every maximal run of digits in a string. */
const digitRuns = (text: string): string[] => text.match(/\d+/g) ?? [];

/**
 * The digit runs a location could show up as: the tile's `x` and `y`, its
 * bounds in degrees to seven places, and — where the fixture decodes once its
 * limits are lifted — every coordinate of every feature, in metres, whole and
 * to a decimetre.
 */
function locationDigits(bytes: Uint8Array): Set<string> {
  const out = new Set<string>([String(FIXTURE_TILE.x), String(FIXTURE_TILE.y)]);
  for (const degrees of Object.values(tileBounds(FIXTURE_TILE))) {
    for (const run of digitRuns(degrees.toFixed(7))) out.add(run);
  }
  const lifted = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME, UNLIMITED);
  if (!('reason' in lifted)) {
    const arrays = [
      ...lifted.landUse.flatMap((f) => f.rings),
      ...lifted.buildings.flatMap((f) => f.rings),
      ...lifted.paths.map((p) => p.line),
      ...lifted.places.map((p) => Float32Array.of(p.x, p.z)),
    ];
    for (const array of arrays) {
      for (const value of array) {
        out.add(String(Math.trunc(Math.abs(value))));
        for (const run of digitRuns(Math.abs(value).toFixed(1))) out.add(run);
      }
    }
  }
  return out;
}

describe('describeRefusal carries no location (ADR 0004 D)', () => {
  for (const fixture of HOSTILE_FIXTURES) {
    it(`${fixture.name}`, () => {
      const bytes = fixture.bytes();
      const refusal = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
      if (!('reason' in refusal)) throw new Error('decoded');
      const message = describeRefusal(refusal);

      // It names the layer, when there is one, and the limit, when there is one.
      if ('layer' in refusal && refusal.layer !== null) {
        expect(message).toContain(`"${refusal.layer}"`);
        expect(READ_LAYERS as readonly string[]).toContain(refusal.layer);
      }
      const runs = digitRuns(message);
      if ('limit' in refusal) {
        expect(runs).toEqual([String(refusal.limit)]);
      } else {
        expect(runs).toEqual([]);
      }

      // And no run of digits in it is a location.
      const forbidden = locationDigits(bytes);
      for (const run of runs) expect(forbidden.has(run), `"${run}" is a location`).toBe(false);
      expect(message).not.toContain(String(FIXTURE_TILE.x));
      expect(message).not.toContain(String(FIXTURE_TILE.y));
    });
  }

  it('the walk is not vacuous: the location set holds the fixtures’ coordinates', () => {
    const overRings = HOSTILE_FIXTURES.find((f) => f.refusal.reason === 'too-many-rings');
    expect(
      locationDigits((overRings as (typeof HOSTILE_FIXTURES)[number]).bytes()).size,
    ).toBeGreaterThan(20);
  });
});
