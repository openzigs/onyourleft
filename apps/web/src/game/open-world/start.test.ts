// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The start's one shape, its coverage refusal and the words it is refused in
 * — #2889. The refusal is ADR 0004 D's: a message about a coordinate names the
 * constraint and never the value, so no digit of the coordinate is in it.
 */

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { OSM_ATTRIBUTION, PUBLISHED_BASEMAP_URL, readBasemapConfig } from '../../map/basemap';

import {
  describeStartRefusal,
  insideCoverage,
  nudgePin,
  openWorldStart,
  startCoverage,
  US_BASEMAP_COVERAGE,
  type OpenWorldStartRefusal,
  type OpenWorldStartSource,
} from './start';

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

const DENVER = at(39.7392, -104.9903);
/** London, with digits that would show in a careless message. */
const LONDON = at(51.5074, -0.1278);
const SOURCES: readonly OpenWorldStartSource[] = ['pin', 'route', 'ride'];

describe('openWorldStart — #2889', () => {
  it('makes the same shape from every source: a position and where it came from, nothing else', () => {
    for (const source of SOURCES) {
      const outcome = openWorldStart(DENVER, source);
      expect(outcome).toEqual({ kind: 'start', start: { position: DENVER, source } });
      if (outcome.kind === 'start')
        expect(Object.keys(outcome.start).sort()).toEqual(['position', 'source']);
    }
  });

  it('refuses a start outside the US basemap, from every source', () => {
    for (const source of SOURCES) {
      expect(openWorldStart(LONDON, source)).toEqual({
        kind: 'refused',
        refusal: 'outside-coverage',
      });
    }
  });

  it('refuses no position at all, and a position that is not a number', () => {
    expect(openWorldStart(undefined, 'ride')).toEqual({ kind: 'refused', refusal: 'no-position' });
    const broken = { latitude: Number.NaN, longitude: -105 } as unknown as GeographicPosition;
    expect(openWorldStart(broken, 'pin')).toEqual({ kind: 'refused', refusal: 'no-position' });
  });

  it('takes Alaska, Hawaii and the Aleutians west of the antimeridian as covered', () => {
    expect(insideCoverage(at(61.2181, -149.9003))).toBe(true); // Anchorage
    expect(insideCoverage(at(21.3069, -157.8583))).toBe(true); // Honolulu
    expect(insideCoverage(at(52.9, 173.1))).toBe(true); // Attu
    expect(insideCoverage(at(-33.87, 151.21))).toBe(false); // Sydney
    expect(insideCoverage(at(19.43, -99.13))).toBe(false); // Mexico City
  });
});

describe('startCoverage — the build’s own archive, #2985', () => {
  it('is the US boxes for the published archive, as the build reads it with nothing configured', () => {
    expect(startCoverage(readBasemapConfig({}))).toBe(US_BASEMAP_COVERAGE);
    expect(startCoverage({ archiveUrl: PUBLISHED_BASEMAP_URL, attribution: OSM_ATTRIBUTION })).toBe(
      US_BASEMAP_COVERAGE,
    );
  });

  it('is unknown for a self-hoster’s own archive, and with no archive at all', () => {
    const theirs = readBasemapConfig({
      VITE_BASEMAP_PMTILES_URL: 'https://tiles.example.org/europe.pmtiles',
    });
    expect(startCoverage(theirs)).toBe('unknown');
    expect(startCoverage(readBasemapConfig({ VITE_BASEMAP_PMTILES_URL: 'none' }))).toBe('unknown');
  });

  it('refuses no place where the coverage is unknown, and still refuses no position', () => {
    for (const source of SOURCES) {
      expect(openWorldStart(LONDON, source, 'unknown')).toEqual({
        kind: 'start',
        start: { position: LONDON, source },
      });
    }
    expect(insideCoverage(at(-33.87, 151.21), 'unknown')).toBe(true);
    expect(openWorldStart(undefined, 'ride', 'unknown')).toEqual({
      kind: 'refused',
      refusal: 'no-position',
    });
  });

  it('refuses outside the boxes it is handed', () => {
    const london = [{ west: -1, south: 51, east: 1, north: 52 }];
    expect(openWorldStart(LONDON, 'pin', london).kind).toBe('start');
    expect(openWorldStart(DENVER, 'pin', london)).toEqual({
      kind: 'refused',
      refusal: 'outside-coverage',
    });
  });
});

describe('describeStartRefusal — ADR 0004 D', () => {
  const refusals: readonly OpenWorldStartRefusal[] = ['outside-coverage', 'no-position'];

  it('names the constraint and no digit of the coordinate, for every refusal and source', () => {
    const outcome = openWorldStart(LONDON, 'pin');
    expect(outcome.kind).toBe('refused');
    for (const refusal of refusals) {
      for (const source of SOURCES) {
        const words = describeStartRefusal(refusal, source);
        expect(words, `${refusal} from ${source}`).not.toMatch(/\d/u);
        expect(words.length).toBeGreaterThan(0);
      }
    }
    expect(describeStartRefusal('outside-coverage', 'pin')).toContain('United States');
  });
});

describe('nudgePin — the keyboard’s way to move the pin', () => {
  it('moves about 55 m each way, and back again', () => {
    for (const direction of ['north', 'south', 'east', 'west'] as const) {
      const moved = nudgePin(DENVER, direction);
      const metres = distanceBetween(DENVER, moved);
      expect(metres, direction).toBeGreaterThan(40);
      expect(metres, direction).toBeLessThan(70);
    }
    expect(nudgePin(DENVER, 'north').latitude).toBeGreaterThan(DENVER.latitude);
    expect(nudgePin(DENVER, 'south').latitude).toBeLessThan(DENVER.latitude);
    expect(nudgePin(DENVER, 'east').longitude).toBeGreaterThan(DENVER.longitude);
    expect(nudgePin(DENVER, 'west').longitude).toBeLessThan(DENVER.longitude);
  });

  it('wraps across the antimeridian rather than leaving the globe', () => {
    const moved = nudgePin(at(52, 179.9999), 'east');
    expect(moved.longitude).toBeLessThan(-179);
  });
});
