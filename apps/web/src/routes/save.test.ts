// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #73 criteria 2, 4 and 5 — the edit decision, the private default, and the
 * refusals a rider can act on.
 *
 * Asserted against the pure core rather than through a rendered component,
 * because every interesting case here is a *refusal* and a refusal asserted
 * through three layers is a refusal that could be coming from any of them.
 */

import { unixSeconds, metres } from '@onyourleft/domain';
import {
  athleteId,
  privacyZoneId,
  routeId,
  type PrivacyZoneRecord,
  type RouteRecord,
} from '@onyourleft/store';
import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  checkName,
  editRoute,
  importedRouteName,
  MAXIMUM_ROUTE_NAME_LENGTH,
  routeFromGpx,
} from './save';

const ATHLETE = athleteId('athlete-a');
const NOW = unixSeconds(1_700_000_000);
const METRES_PER_DEGREE_LATITUDE = 111_194.93;
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

/** A GPX route running due north from `fromMetresNorth` of HOME. */
function gpx(lengthMetres: number, fromMetresNorth: number, name?: string): string {
  const points: string[] = [];
  for (let along = 0; along <= lengthMetres; along += 25) {
    const latitude = HOME.latitude + (fromMetresNorth + along) / METRES_PER_DEGREE_LATITUDE;
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

function imported(text: string, fileName = 'ride.gpx'): RouteRecord {
  const outcome = routeFromGpx(text, {
    id: routeId('route-1'),
    owner: ATHLETE,
    fileName,
    now: NOW,
  });
  if (outcome.status !== 'saved') throw new Error(`expected a route, got ${outcome.refusal.code}`);
  return outcome.record;
}

function zone(): PrivacyZoneRecord {
  return {
    id: privacyZoneId('home'),
    athleteId: ATHLETE,
    centre: HOME,
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(1),
  };
}

describe('importing a route — #73 criterion 4', () => {
  it('is private, with no way for a caller to ask for anything else', () => {
    // The strongest form the criterion can take: a default that cannot be
    // overridden at the point of creation cannot be got wrong by a caller.
    expect(imported(gpx(2000, 2000)).visibility).toBe('private');
  });

  it('takes the file’s own name when it has one', () => {
    expect(imported(gpx(2000, 2000, 'Box Hill loop')).name).toBe('Box Hill loop');
  });

  it('falls back to the file name, and only then to a generic', () => {
    expect(imported(gpx(2000, 2000), 'Sunday morning.gpx').name).toBe('Sunday morning');
    // A list of things all called "Imported route" is a list nobody can use,
    // which is why the generic is last rather than first.
    expect(importedRouteName(undefined, '')).toBe('Imported route');
    expect(importedRouteName('  ', 'x.gpx')).toBe('x');
  });

  it('stamps createdAt and updatedAt from the instant it was handed', () => {
    // Passed in rather than read: this module may not consult a clock.
    const record = imported(gpx(2000, 2000));
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
  });

  it('refuses a file that is not a route, passing the importer’s own words through', () => {
    const outcome = routeFromGpx('<?xml version="1.0"?>\n<gpx version="1.1"></gpx>', {
      id: routeId('route-1'),
      owner: ATHLETE,
      fileName: 'empty.gpx',
      now: NOW,
    });
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.code).toBe('not-a-route');
    expect(outcome.refusal.message).toContain('<rte>');
  });

  it('refuses a file that is not readable at all, and names the file', () => {
    const outcome = routeFromGpx('<gpx><rte><rtept lat="1"', {
      id: routeId('route-1'),
      owner: ATHLETE,
      fileName: 'broken.gpx',
      now: NOW,
    });
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.code).toBe('unreadable-file');
    expect(outcome.refusal.message).toContain('broken.gpx');
  });
});

describe('naming', () => {
  it('requires one', () => {
    expect(checkName('   ')?.code).toBe('name-required');
    expect(checkName('Box Hill')).toBeUndefined();
  });

  it('bounds it, and says the bound', () => {
    const fault = checkName('x'.repeat(MAXIMUM_ROUTE_NAME_LENGTH + 1));
    expect(fault?.code).toBe('name-too-long');
    expect(fault?.message).toContain(String(MAXIMUM_ROUTE_NAME_LENGTH));
  });
});

describe('editing — #73 criterion 2', () => {
  it('updates in place rather than versioning, keeping the id and the geometry', () => {
    const stored = imported(gpx(2000, 2000));
    const outcome = editRoute(
      stored,
      { name: 'Renamed', visibility: 'private', readAt: stored.updatedAt },
      unixSeconds(NOW + 60),
    );
    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.record.id).toBe(stored.id);
    expect(outcome.record.profile).toBe(stored.profile);
    expect(outcome.record.name).toBe('Renamed');
    expect(outcome.record.createdAt).toBe(stored.createdAt);
    expect(outcome.record.updatedAt).toBe(unixSeconds(NOW + 60));
  });

  it('refuses when the stored route moved under the editor', () => {
    // The whole of the concurrency story with no server: the editor hands back
    // the updatedAt it READ, and a mismatch means a second tab got there first.
    const stored = { ...imported(gpx(2000, 2000)), updatedAt: unixSeconds(NOW + 500) };
    const outcome = editRoute(
      stored,
      { name: 'Renamed', visibility: 'private', readAt: NOW },
      unixSeconds(NOW + 600),
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.code).toBe('edited-elsewhere');
    expect(outcome.refusal.message).toContain('nothing here has been saved');
  });

  it('compares the value read, not which timestamp is newer', () => {
    // Two saves inside the same second is exactly the case a second tab
    // produces, and a "is the stored one newer" test would let them overwrite
    // each other silently.
    const stored = { ...imported(gpx(2000, 2000)), updatedAt: unixSeconds(NOW + 5) };
    const sameSecond = editRoute(
      stored,
      { name: 'Renamed', visibility: 'private', readAt: NOW },
      unixSeconds(NOW + 5),
    );
    expect(sameSecond.status).toBe('refused');
  });

  it('always advances updatedAt, so two saves in one second do not look identical', () => {
    const stored = imported(gpx(2000, 2000));
    const outcome = editRoute(
      stored,
      { name: 'Renamed', visibility: 'private', readAt: stored.updatedAt },
      stored.updatedAt,
    );
    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    // Otherwise the next editor's token would match a route that HAD changed.
    expect(outcome.record.updatedAt).toBeGreaterThan(stored.updatedAt);
  });

  it('still refuses a blank name', () => {
    const stored = imported(gpx(2000, 2000));
    const outcome = editRoute(
      stored,
      { name: '  ', visibility: 'private', readAt: stored.updatedAt },
      unixSeconds(NOW + 60),
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.code).toBe('name-required');
  });
});

describe('publishing — #73 criteria 5 and 6', () => {
  it('refuses to widen a route whose start is inside a privacy zone', () => {
    // The route begins at home. Trimming would move its start, and a route with
    // a different start is not the route.
    const stored = imported(gpx(3000, 0));
    const outcome = editRoute(
      stored,
      { name: stored.name, visibility: 'public', readAt: stored.updatedAt },
      unixSeconds(NOW + 60),
      [zone()],
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.refusal.code).toBe('cannot-be-shared');
    expect(outcome.refusal.message).toContain('would not be this route');
  });

  it('allows widening a route that never goes near a zone', () => {
    const stored = imported(gpx(2000, 2000));
    const outcome = editRoute(
      stored,
      { name: stored.name, visibility: 'public', readAt: stored.updatedAt },
      unixSeconds(NOW + 60),
      [zone()],
    );
    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.record.visibility).toBe('public');
  });

  it('does not re-ask the question when an already-shared route is renamed', () => {
    // Asking on every save would train a rider to click past it. The check is
    // at the moment of WIDENING, which is the moment the risk is taken.
    const shared: RouteRecord = { ...imported(gpx(3000, 0)), visibility: 'public' };
    const outcome = editRoute(
      shared,
      { name: 'Renamed', visibility: 'public', readAt: shared.updatedAt },
      unixSeconds(NOW + 60),
      [zone()],
    );
    expect(outcome.status).toBe('saved');
  });

  it('narrowing back to private is never refused', () => {
    const shared: RouteRecord = { ...imported(gpx(3000, 0)), visibility: 'public' };
    const outcome = editRoute(
      shared,
      { name: shared.name, visibility: 'private', readAt: shared.updatedAt },
      unixSeconds(NOW + 60),
      [zone()],
    );
    expect(outcome.status).toBe('saved');
  });
});
