// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The screen's half of #74: what a rider downloads, what they are told, and
 * what they cannot reach.
 *
 * The document itself is asserted in `packages/fit/src/route/course.test.ts` —
 * the round trip, the tolerances, the attribution and the escaping. What is
 * here is everything that is a property of *this screen*: the filename, the
 * media type, the athlete scoping, and the point-count warning that belongs to
 * a device rather than to a format.
 */

import { athleteId, type RouteRecord } from '@onyourleft/store';
import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  unixSeconds,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { routeFromGpx } from './save';
import { exportedFrom, exportRoute, LONG_ROUTE_SAMPLES, RouteExportError } from './export';
import { routeStub, stubRouteId } from './testing';

const ATHLETE = athleteId('athlete-a');
const OTHER = athleteId('athlete-b');
const NOW = unixSeconds(1_700_000_000);
const METRES_PER_DEGREE_LATITUDE = 111_194.93;
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

/** A GPX route running due north, the same shape `save.test.ts` uses. */
function gpx(lengthMetres: number, name?: string): string {
  const points: string[] = [];
  for (let along = 0; along <= lengthMetres; along += 25) {
    const latitude = HOME.latitude + along / METRES_PER_DEGREE_LATITUDE;
    points.push(
      `<rtept lat="${latitude.toFixed(7)}" lon="${HOME.longitude.toFixed(7)}"><ele>30</ele></rtept>`,
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
    '<rte>',
    ...(name === undefined ? [] : [`<name>${name}</name>`]),
    ...points,
    '</rte>',
    '</gpx>',
  ].join('\n');
}

function saved(lengthMetres = 2000, name = 'Regents Park'): RouteRecord {
  const outcome = routeFromGpx(gpx(lengthMetres, name), {
    fileName: 'route.gpx',
    owner: ATHLETE,
    id: stubRouteId(`route-${String(lengthMetres)}`),
    now: NOW,
  });
  if (outcome.status !== 'saved') {
    throw new Error(`the fixture did not import: ${outcome.refusal.code}`);
  }
  return outcome.record;
}

describe('the file a rider gets', () => {
  it('is named after the route, with the format’s extension', () => {
    expect(exportedFrom(saved(), 'gpx').file.fileName).toBe('Regents Park.gpx');
    expect(exportedFrom(saved(), 'tcx').file.fileName).toBe('Regents Park.tcx');
  });

  it('does not let a route name become a path', () => {
    // The one place a stored name reaches a filesystem API. `safeFileStem` is
    // shared with the activity exporter rather than reimplemented — a second
    // sanitiser would be a second place this could be got wrong, and only one
    // of them would have been read.
    const record = { ...saved(), name: '../../etc/passwd' };
    const { fileName } = exportedFrom(record, 'gpx').file;
    // Separators are REPLACED rather than stripped, so `a/b` and `a:b` do not
    // collapse onto one filename; the leading dots are then removed, because a
    // name beginning `..` is a path segment. `..` surviving mid-name is
    // harmless and is asserted rather than glossed: what makes this safe is the
    // absence of a separator, not the absence of a dot.
    expect(fileName).toBe('-..-etc-passwd.gpx');
    expect(fileName).not.toContain('/');
    expect(fileName.startsWith('.')).toBe(false);
  });

  it('falls back to the id when the name sanitises to nothing', () => {
    const record = { ...saved(), name: '...' };
    expect(exportedFrom(record, 'gpx').file.fileName).toBe(`route-${record.id}.gpx`);
  });

  it('carries the media type each format is served as', () => {
    expect(exportedFrom(saved(), 'gpx').file.mediaType).toBe('application/gpx+xml');
    expect(exportedFrom(saved(), 'tcx').file.mediaType).toBe('application/vnd.garmin.tcx+xml');
  });

  it('is UTF-8 bytes, with a surrogate pair intact', () => {
    const record = { ...saved(), name: 'Col du 🚵' };
    const text = new TextDecoder().decode(exportedFrom(record, 'gpx').file.bytes);
    expect(text).toContain('Col du 🚵');
  });
});

describe('what the rider is told it could not carry', () => {
  it('always mentions gradient, in both formats', () => {
    for (const format of ['gpx', 'tcx'] as const) {
      expect(exportedFrom(saved(), format).lost.join(' ')).toContain('Gradient');
    }
  });

  it('mentions the course time only for TCX, because only TCX asks for one', () => {
    expect(exportedFrom(saved(), 'tcx').lost.join(' ')).toContain('course time of zero');
    expect(exportedFrom(saved(), 'gpx').lost.join(' ')).not.toContain('course time');
  });

  it('says nothing about point counts for an ordinary route', () => {
    expect(exportedFrom(saved(), 'gpx').lost.join(' ')).not.toContain('points');
  });

  it('warns about point count on a long route, and still writes every point', () => {
    // ~120 km at the 10 m profile grid is well past LONG_ROUTE_SAMPLES.
    const long = saved(120_000, 'The long way round');
    expect(long.profile.positions.length).toBeGreaterThan(LONG_ROUTE_SAMPLES);
    const exported = exportedFrom(long, 'gpx');
    expect(exported.lost.join(' ')).toContain('head units cap');
    // A warning, never a truncation. The file is complete.
    const written = new TextDecoder().decode(exported.file.bytes).match(/<trkpt /g)?.length ?? 0;
    expect(written).toBe(long.profile.positions.length);
  });
});

describe('reading the route back out of the store', () => {
  it('exports a route this athlete owns', async () => {
    const record = saved();
    const port = routeStub(ATHLETE, [record]);
    const exported = await exportRoute(port, ATHLETE, record.id, 'gpx');
    expect(exported.file.fileName).toBe('Regents Park.gpx');
  });

  it('refuses another athlete’s route rather than exporting it', async () => {
    // CLAUDE.md §6's cross-athlete class. A single-athlete test would pass
    // whether or not the read were scoped, which is why the stub scopes on the
    // way out and why this asks for the route as somebody else.
    const record = saved();
    const port = routeStub(ATHLETE, [record]);
    await expect(exportRoute(port, OTHER, record.id, 'gpx')).rejects.toBeInstanceOf(
      RouteExportError,
    );
  });

  it('refuses an id that is not there', async () => {
    const port = routeStub(ATHLETE, []);
    await expect(exportRoute(port, ATHLETE, stubRouteId('nope'), 'tcx')).rejects.toMatchObject({
      code: 'no-such-route',
    });
  });
});
