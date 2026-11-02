// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { addWaypoint, emptyDraft, insertWaypoint, type RouteDraft } from './draft';
import { draftGeometry, legMidpoint, mapWaypoints, nearestLeg } from './map-edit';

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** Freehand, so every leg has its straight line at once. */
function drawn(...points: GeographicPosition[]): RouteDraft {
  return points.reduce((draft, point) => addWaypoint(draft, point, 'freehand').draft, emptyDraft());
}

// An L: north, then east, then north again.
const A = at(40, -105);
const B = at(40.01, -105);
const C = at(40.01, -104.99);
const D = at(40.02, -104.99);

describe('the line the planner draws — #2006', () => {
  it('has no line for fewer than two waypoints', () => {
    expect(draftGeometry(emptyDraft())).toBeUndefined();
    expect(draftGeometry(drawn(A))).toBeUndefined();
  });

  it('is one part per leg, longitude first, in the order the legs run', () => {
    expect(draftGeometry(drawn(A, B, C))?.coordinates).toEqual([
      [
        [-105, 40],
        [-105, 40.01],
      ],
      [
        [-105, 40.01],
        [-104.99, 40.01],
      ],
    ]);
  });

  it('draws a leg still waiting for a route as the straight line between its ends', () => {
    // Snapped, with no engine asked: pending, with no shape of its own.
    const pending = addWaypoint(addWaypoint(emptyDraft(), A).draft, B).draft;
    expect(pending.legs[0]?.state).toBe('pending');
    expect(draftGeometry(pending)?.coordinates).toEqual([
      [
        [-105, 40],
        [-105, 40.01],
      ],
    ]);
  });

  it('draws a routed leg along its own shape', () => {
    const bend = at(40.005, -104.995);
    const draft = drawn(A, B);
    const routed: RouteDraft = {
      ...draft,
      legs: [{ ...draft.legs[0]!, mode: 'snapped', state: 'routed', shape: [A, bend, B] }],
    };
    expect(draftGeometry(routed)?.coordinates[0]).toHaveLength(3);
  });

  it('hands the map each waypoint with its id, numbered as the list numbers it', () => {
    const draft = drawn(A, B);
    expect(mapWaypoints(draft)).toEqual([
      { id: 'w1', position: A, label: '1' },
      { id: 'w2', position: B, label: '2' },
    ]);
  });

  it('numbers by place in the route, not by id, so an insert renumbers the rest', () => {
    // w3 goes between w1 and w2: it is the second waypoint, and w2 the third.
    const draft = insertWaypoint(drawn(A, B), 0, C).draft;
    expect(mapWaypoints(draft).map(({ id, label }) => [id, label])).toEqual([
      ['w1', '1'],
      ['w3', '2'],
      ['w2', '3'],
    ]);
  });
});

describe('which leg a pull on the line was — #2006', () => {
  const draft = drawn(A, B, C, D);

  it('is the leg whose line passes closest to where it was grabbed', () => {
    // Just east of the first leg's middle, the second leg's middle, the third's.
    expect(nearestLeg(draft, at(40.005, -104.9999))).toBe(0);
    expect(nearestLeg(draft, at(40.0101, -104.995))).toBe(1);
    expect(nearestLeg(draft, at(40.015, -104.9899))).toBe(2);
  });

  it('is no leg at all when there is none', () => {
    expect(nearestLeg(drawn(A), A)).toBeUndefined();
  });
});

describe('the keyboard’s insert — #2006', () => {
  it('is halfway between the leg’s two waypoints', () => {
    const middle = legMidpoint(drawn(A, B, C), 1);
    expect(middle?.latitude).toBeCloseTo(40.01, 9);
    expect(middle?.longitude).toBeCloseTo(-104.995, 9);
  });

  it('is nowhere for a leg that does not exist', () => {
    expect(legMidpoint(drawn(A, B), 1)).toBeUndefined();
  });
});
