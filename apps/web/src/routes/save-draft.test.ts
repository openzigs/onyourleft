// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A drawn route becomes a saved one — #2006, the pure half. The store half,
 * read back through a fresh connection, is `save-draft.store.test.ts`.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  metres,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import { athleteId, routeId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { addWaypoint, emptyDraft, type RouteDraft } from '../routing/draft';
import { elevationFrom, resampleShape, plannedShape } from '../routing/elevation';
import { FLAT_DRAWN_ROUTE_TEXT, routeFromDraft, type DraftSaveOptions } from './save';

const OWNER = athleteId('athlete-a');
const NOW = unixSeconds(1_700_000_000);

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

function drawn(mode: 'freehand' | 'snapped', ...points: GeographicPosition[]): RouteDraft {
  return points.reduce((draft, point) => addWaypoint(draft, point, mode).draft, emptyDraft());
}

const A = at(40, -105);
const B = at(40.01, -105);
const C = at(40.01, -104.99);

function options(overrides: Partial<DraftSaveOptions> = {}): DraftSaveOptions {
  return { id: routeId('route-drawn'), owner: OWNER, name: 'Canal loop', now: NOW, ...overrides };
}

describe('saving a drawn route — #2006', () => {
  it('saves the drawn line, end to end, as a private route of the rider’s', () => {
    const outcome = routeFromDraft(drawn('freehand', A, B, C), options({ name: '  Canal loop ' }));
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);
    const { record } = outcome;
    expect(record.createdBy).toBe(OWNER);
    expect(record.name).toBe('Canal loop');
    expect(record.visibility).toBe('private');
    expect([record.createdAt, record.updatedAt]).toEqual([NOW, NOW]);
    expect(record.profile.loop).toBe(false);
    // The two straight legs, end to end — the distance the planner shows.
    expect(record.profile.totalDistance).toBeCloseTo(
      distanceBetween(A, B) + distanceBetween(B, C),
      3,
    );
    expect(record.profile.positions[0]).toEqual(A);
    expect(record.profile.positions.at(-1)).toEqual(C);
  });

  it('is flat with no elevation service, and claims no dataset', () => {
    const outcome = routeFromDraft(drawn('freehand', A, B), options());
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);
    expect(outcome.record.profile.totalAscent).toBe(0);
    expect(outcome.record.profile.elevations.every((height) => height === 0)).toBe(true);
    expect(outcome.record).not.toHaveProperty('elevation');
    expect(FLAT_DRAWN_ROUTE_TEXT).toContain('saved flat');
  });

  it('takes the planner’s heights when it has them, and records whose they are', () => {
    const draft = drawn('freehand', A, B);
    const interval = metres(30);
    const grid = resampleShape(plannedShape(draft), interval);
    const planned = elevationFrom(
      grid,
      {
        source: { name: 'Copernicus DEM GLO-30', resolution: metres(30) },
        samples: grid.map((_, index) => ({
          along: metres(index * 30),
          elevation: altitudeMetres(100 + index * 3),
        })),
      },
      interval,
      { resampled: true },
    );
    if (planned === undefined) throw new Error('no profile from the fixture');
    const outcome = routeFromDraft(draft, options({ elevation: planned }));
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);
    expect(outcome.record.profile).toBe(planned.profile);
    expect(outcome.record.profile.totalAscent).toBeGreaterThan(0);
    expect(outcome.record.elevation).toEqual({
      dataset: 'Copernicus DEM GLO-30',
      resolution: 30,
      interval: 30,
      missing: planned.coverage.missing,
    });
  });
});

describe('what is refused, and nothing is saved — #2006', () => {
  it('a route with no name', () => {
    const outcome = routeFromDraft(drawn('freehand', A, B), options({ name: '   ' }));
    expect(outcome.status === 'refused' && outcome.refusal.code).toBe('name-required');
  });

  it('a route of one waypoint', () => {
    const outcome = routeFromDraft(drawn('freehand', A), options());
    expect(outcome.status === 'refused' && outcome.refusal.message).toBe(
      'A route needs two waypoints before it can be saved.',
    );
  });

  it('a route with a leg that has no line, naming the leg', () => {
    // Snapped with no engine asked: both legs are still waiting.
    const outcome = routeFromDraft(drawn('snapped', A, B, C), options());
    if (outcome.status !== 'refused') throw new Error('saved a route with legs that have no line');
    expect(outcome.refusal.code).toBe('legs-without-a-line');
    expect(outcome.refusal.message).toBe(
      'Legs 1 and 2 have no line yet, so the route was not saved. Draw them freehand, or wait for ' +
        'them to be routed.',
    );
  });

  it('a route whose waypoints are all in one place, in words with no coordinate in them', () => {
    const outcome = routeFromDraft(drawn('freehand', A, A), options());
    if (outcome.status !== 'refused') throw new Error('saved a route with no length');
    expect(outcome.refusal.code).toBe('not-a-route');
    // ADR 0004 decision D: the message names the problem, never the place.
    expect(outcome.refusal.message).not.toMatch(/40|105/);
  });
});
