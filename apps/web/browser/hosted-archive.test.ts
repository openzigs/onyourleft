// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the hosted measurement can decide without a network.
 *
 * The hosted block in `map.browser.spec.ts` is skipped unless
 * `OYL_HOSTED_BASEMAP_URL` is set, and CI sets nothing — so a defect in it would
 * ordinarily sit unreported behind a skip. This file is the answer to that:
 * every decision the hosted run makes that does **not** need a host is made by
 * `hosted-archive.ts` and asserted here, in the fast suite that runs on every
 * save. What is left behind the skip is the part that genuinely needs a host.
 *
 * `vitest.config.ts` includes `browser/**` for this, the same line and the same
 * reason as `pmtiles-fixture.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  centreTrack,
  coldLoadReport,
  foreignRequests,
  HOSTED_ARCHIVE_VARIABLE,
  HOSTED_TRACK_METRES,
  parseTrackParameter,
  permittedOrigins,
  readHostedArchive,
  requireCoverage,
  trackParameter,
  type ColdLoadFacts,
} from './hosted-archive';

const ARCHIVE = 'https://tiles.example.org/basemap-us.pmtiles';

describe('reading the hosted archive from the environment', () => {
  it('measures nothing when nothing is configured', () => {
    expect(readHostedArchive({})).toBeUndefined();
    expect(readHostedArchive({ OYL_HOSTED_BASEMAP_URL: undefined })).toBeUndefined();
    expect(readHostedArchive({ OYL_HOSTED_BASEMAP_URL: '' })).toBeUndefined();
    expect(readHostedArchive({ OYL_HOSTED_BASEMAP_URL: '   ' })).toBeUndefined();
  });

  it('refuses a value that is set but is not a URL, rather than skipping', () => {
    // ⚠️ The distinction this module exists to keep. "Nothing configured" is a
    // reason to measure nothing; "configured wrongly" is not, and a skip there
    // would report a run nobody took as a clean one.
    expect(() => readHostedArchive({ OYL_HOSTED_BASEMAP_URL: 'tiles.example.org' })).toThrow(
      HOSTED_ARCHIVE_VARIABLE,
    );
  });

  it('refuses a plain-HTTP archive, which no real deployment could load', () => {
    expect(() =>
      readHostedArchive({ OYL_HOSTED_BASEMAP_URL: 'http://tiles.example.org/b.pmtiles' }),
    ).toThrow(HOSTED_ARCHIVE_VARIABLE);
  });

  it('reads the archive and its origin, and trims what a shell pastes in', () => {
    expect(readHostedArchive({ OYL_HOSTED_BASEMAP_URL: `  ${ARCHIVE}\n` })).toEqual({
      archiveUrl: ARCHIVE,
      origin: 'https://tiles.example.org',
    });
  });
});

describe('which origins a hosted render may reach', () => {
  it('permits the page and the archive, and nothing else', () => {
    expect(
      permittedOrigins('http://127.0.0.1:4319', {
        archiveUrl: ARCHIVE,
        origin: 'https://tiles.example.org',
      }),
    ).toEqual(['http://127.0.0.1:4319', 'https://tiles.example.org']);
  });

  it('is one origin when the archive is served by the harness itself', () => {
    expect(
      permittedOrigins('http://127.0.0.1:4319', {
        archiveUrl: 'http://127.0.0.1:4319/b.pmtiles',
        origin: 'http://127.0.0.1:4319',
      }),
    ).toEqual(['http://127.0.0.1:4319']);
  });

  it('reports a request that left the permitted set', () => {
    expect(
      foreignRequests(
        [
          'http://127.0.0.1:4319/index.html',
          'https://tiles.example.org/basemap-us.pmtiles',
          'https://api.metered-tiles.example/v1/tiles.json',
        ],
        ['http://127.0.0.1:4319', 'https://tiles.example.org'],
      ),
    ).toEqual(['https://api.metered-tiles.example/v1/tiles.json']);
  });

  it('does not count a blob or a data URL as a host', () => {
    expect(
      foreignRequests(
        ['blob:http://127.0.0.1:4319/abc', 'data:text/plain,x'],
        ['http://127.0.0.1:4319'],
      ),
    ).toEqual([]);
  });

  it('reports a request URL it cannot parse rather than passing it', () => {
    // A URL this cannot read is not evidence of good behaviour. Swallowing it is
    // how a check of this shape goes quiet without anybody editing it.
    expect(foreignRequests(['not a url at all'], ['http://127.0.0.1:4319'])).toEqual([
      'not a url at all',
    ]);
  });
});

describe('placing the ride inside whatever the archive covers', () => {
  const US = { west: -125, south: 24, east: -66, north: 50 };

  it('puts the ride at the centre of the declared coverage', () => {
    const track = centreTrack(US, HOSTED_TRACK_METRES);
    const [run] = track.coordinates;
    const [start, end] = run ?? [];
    expect(start?.[1]).toBeCloseTo(37, 10);
    expect(end?.[1]).toBeCloseTo(37, 10);
    expect(((start?.[0] ?? 0) + (end?.[0] ?? 0)) / 2).toBeCloseTo(-95.5, 10);
  });

  it('is a line of about the length asked for, corrected for the latitude', () => {
    // Without the 1/cos correction this line is 1200 m at the equator and about
    // 960 m at latitude 37 — enough to move the fitted zoom, which is the one
    // thing the length is chosen for.
    const track = centreTrack(US, HOSTED_TRACK_METRES);
    const [run] = track.coordinates;
    const span = Math.abs((run?.[1]?.[0] ?? 0) - (run?.[0]?.[0] ?? 0));
    const metres = span * 111_320 * Math.cos((37 * Math.PI) / 180);
    expect(metres).toBeCloseTo(HOSTED_TRACK_METRES, 0);
  });

  it('is two positions in longitude, latitude order', () => {
    // GeoJSON order, which `track.ts` warns is the opposite of how anybody says
    // it. Transposed, this ride is drawn on another continent and throws nothing.
    const [run] = centreTrack(US, HOSTED_TRACK_METRES).coordinates;
    expect(run).toHaveLength(2);
    for (const position of run ?? []) {
      expect(position[0]).toBeLessThan(-90);
      expect(position[1]).toBeGreaterThan(30);
    }
  });

  it('refuses bounds that are inside out, and names no coordinate', () => {
    // ADR 0004 decision D: a message about a coordinate names the field and the
    // constraint, never the value.
    for (const bad of [
      { west: 10, south: 0, east: -10, north: 20 },
      { west: -10, south: 20, east: 10, north: 0 },
    ]) {
      let message = '';
      expect(() => {
        try {
          centreTrack(bad, HOSTED_TRACK_METRES);
        } catch (error: unknown) {
          message = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }).toThrow('archive bounds');
      expect(message).not.toMatch(/\d/);
    }
  });

  it('refuses a length that is not a positive number of metres', () => {
    expect(() => centreTrack(US, 0)).toThrow('positive');
    expect(() => centreTrack(US, Number.NaN)).toThrow('positive');
  });

  it('still returns a line for an archive at the pole', () => {
    const [run] = centreTrack({ west: -180, south: 89, east: 180, north: 90 }, 1200).coordinates;
    const span = Math.abs((run?.[1]?.[0] ?? 0) - (run?.[0]?.[0] ?? 0));
    expect(Number.isFinite(span)).toBe(true);
    expect(span).toBeGreaterThan(0);
  });
});

describe('an archive that declares where it is', () => {
  it('passes bounds that describe somewhere', () => {
    const bounds = { west: -125, south: 24, east: -66, north: 50 };
    expect(requireCoverage(bounds)).toBe(bounds);
  });

  it('refuses an empty box rather than centring a ride at 0, 0', () => {
    // ⚠️ The failure this prevents reads as "the hosted basemap did not paint",
    // which is true of an empty header and equally true of a broken engine, a
    // broken protocol handler and a machine with no GL. Naming it is the whole
    // value.
    expect(() => requireCoverage({ west: 0, south: 0, east: 0, north: 0 })).toThrow('no coverage');
  });

  it('still passes an archive covering a single thin strip', () => {
    // A one-tile archive is a thing that can exist and should still get a ride.
    expect(() => requireCoverage({ west: 0, south: 0, east: 0.02, north: 0 })).not.toThrow();
    expect(() => requireCoverage({ west: 0, south: 0, east: 0, north: 0.02 })).not.toThrow();
  });
});

describe('the track the harness page is handed', () => {
  it('round-trips through the query parameter', () => {
    const track = centreTrack({ west: -125, south: 24, east: -66, north: 50 }, HOSTED_TRACK_METRES);
    expect(parseTrackParameter(trackParameter(track))).toEqual(track);
  });

  it('writes longitude first', () => {
    expect(
      trackParameter({
        type: 'MultiLineString',
        coordinates: [
          [
            [-0.1278, 51.5074],
            [-0.1268, 51.5084],
          ],
        ],
      }),
    ).toBe('-0.1278,51.5074;-0.1268,51.5084');
  });

  it('carries more than one run', () => {
    const two = parseTrackParameter('1,2;3,4|5,6;7,8');
    expect(two.coordinates).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ],
    ]);
  });

  it('refuses a malformed parameter rather than falling back to the built-in track', () => {
    // ⚠️ The failure this prevents is the expensive one: a silently ignored
    // `?track=` renders London against a United States archive, paints nothing,
    // and the hosted measurement reports a failure caused by a typo.
    expect(() => parseTrackParameter('1,2')).toThrow('at least two positions');
    expect(() => parseTrackParameter('1,2,3;4,5')).toThrow('longitude,latitude');
    expect(() => parseTrackParameter('north,2;3,4')).toThrow('longitude');
    expect(() => parseTrackParameter('200,2;3,4')).toThrow('longitude');
    expect(() => parseTrackParameter('1,200;3,4')).toThrow('latitude');
    expect(() => parseTrackParameter('')).toThrow();
  });
});

describe('the measurement, as it is written down', () => {
  const facts: ColdLoadFacts = {
    archiveUrl: ARCHIVE,
    firstPaintMs: 412.34,
    firstPaintSinceNavigationMs: 501.67,
    requestCount: 7,
    wireMs: 254.5,
    timingOpaque: true,
    frames: 21,
    responses: [
      { status: 206, cacheStatus: 'HIT' },
      { status: 206, cacheStatus: 'HIT' },
      { status: 206, cacheStatus: 'MISS' },
    ],
  };

  it('names the host it measured, so the number cannot be read as a localhost one', () => {
    expect(coldLoadReport(facts)).toContain('tiles.example.org');
  });

  it('carries both clocks and the request count', () => {
    const report = coldLoadReport(facts);
    expect(report).toContain('412.3 ms');
    expect(report).toContain('501.7 ms');
    expect(report).toContain('7 archive range request(s)');
    expect(report).toContain('21 frames');
  });

  it('says how the CDN answered, so a warm edge is not read as a cold one', () => {
    const report = coldLoadReport(facts);
    expect(report).toContain('HIT×2');
    expect(report).toContain('MISS×1');
  });

  it('says so when no archive response was seen at all', () => {
    expect(coldLoadReport({ ...facts, responses: [] })).toContain('no archive response');
  });

  it('says when the wire timings are opaque, and when they are not', () => {
    // ⚠️ The half a reader would otherwise get wrong. A cross-origin archive with
    // no `Timing-Allow-Origin` reports zero bytes and zero phases — identical to
    // what a cache hit reports on the loopback measurement, and meaning the
    // opposite.
    expect(coldLoadReport(facts)).toContain('opaque');
    expect(coldLoadReport({ ...facts, timingOpaque: false })).not.toContain('opaque');
    expect(coldLoadReport({ ...facts, timingOpaque: false })).toContain('visible');
  });
});
