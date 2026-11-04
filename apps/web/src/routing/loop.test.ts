// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2102 phase 1: closing a drawn route into a loop, and its length against a
 * target. Synthetic positions only — a small triangle on no particular road.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  LOOP_CLOSURE_METRES,
  metres,
  type GeographicPosition,
  type RoutingProvider,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { addWaypoint, draftDistance, emptyDraft, resolveDraft, type RouteDraft } from './draft';
import { planElevation } from './elevation';
import {
  canCloseLoop,
  closeLoop,
  draftIsLoop,
  IS_A_LOOP_TEXT,
  LOOP_START_TEXT,
  loopFit,
  loopReadout,
  loopTargetText,
  nearerTarget,
  NOT_YET_A_LOOP_TEXT,
} from './loop';
import { RIDING_DEFAULTS } from './preferences';
import { scriptedProvider } from './testing';

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** A triangle of about 1.9 km round. */
const TRIANGLE = [at(40, -105), at(40.006, -105), at(40.003, -104.994)];

function drawn(points: readonly GeographicPosition[], mode: 'freehand' | 'snapped'): RouteDraft {
  let draft = emptyDraft();
  for (const point of points) draft = addWaypoint(draft, point, mode).draft;
  return draft;
}

describe('Close the loop', () => {
  it('is offered from three waypoints, and not before', () => {
    expect(canCloseLoop(emptyDraft())).toBe(false);
    expect(canCloseLoop(drawn(TRIANGLE.slice(0, 2), 'freehand'))).toBe(false);
    expect(canCloseLoop(drawn(TRIANGLE, 'freehand'))).toBe(true);
  });

  it('adds a last waypoint where the first is, and is then not offered again', () => {
    const closed = closeLoop(drawn(TRIANGLE, 'freehand'), 'freehand').draft;
    expect(closed.waypoints).toHaveLength(4);
    expect(closed.waypoints.at(-1)?.position).toEqual(TRIANGLE[0]);
    expect(closed.legs).toHaveLength(3);
    expect(canCloseLoop(closed)).toBe(false);
  });

  it('is not offered when the last waypoint is already back within the loop tolerance', () => {
    // About 11 m north of the start: inside LOOP_CLOSURE_METRES.
    const near = drawn([...TRIANGLE, at(40.0001, -105)], 'freehand');
    expect(distanceBetween(TRIANGLE[0]!, at(40.0001, -105))).toBeLessThan(LOOP_CLOSURE_METRES);
    expect(canCloseLoop(near)).toBe(false);
    expect(draftIsLoop(near)).toBe(true);
  });

  it('changes nothing when it cannot act', () => {
    const two = drawn(TRIANGLE.slice(0, 2), 'freehand');
    expect(closeLoop(two, 'freehand')).toEqual({ draft: two, stale: [] });
  });

  it('makes the leg back stale when legs follow roads, so it is routed like any other', () => {
    const edit = closeLoop(drawn(TRIANGLE, 'snapped'), 'snapped');
    expect(edit.stale).toEqual([2]);
    expect(edit.draft.legs[2]?.mode).toBe('snapped');
  });
});

describe('what counts as a loop', () => {
  it('is a closed line of three waypoints or more', () => {
    const open = drawn(TRIANGLE, 'freehand');
    expect(draftIsLoop(open)).toBe(false);
    expect(draftIsLoop(closeLoop(open, 'freehand').draft)).toBe(true);
  });

  it('is not two waypoints whose ends meet', () => {
    expect(draftIsLoop(drawn([TRIANGLE[0]!, at(40.0001, -105)], 'freehand'))).toBe(false);
  });

  it('waits for every leg to have a line', async () => {
    const closed = closeLoop(drawn(TRIANGLE, 'snapped'), 'snapped').draft;
    expect(draftIsLoop(closed)).toBe(false);
    // Both ends routed and meeting, with the middle leg still waiting: not yet.
    const ends = await resolveDraft(closed, [0, 2], scriptedProvider(), RIDING_DEFAULTS);
    expect(draftIsLoop(ends)).toBe(false);
    const routed = await resolveDraft(closed, [0, 1, 2], scriptedProvider(), RIDING_DEFAULTS);
    expect(draftIsLoop(routed)).toBe(true);
  });
});

describe('the length against a target', () => {
  it('is near within 15 %, and under or over by the difference past it', () => {
    expect(loopFit(metres(1_700), 2)).toEqual({ kind: 'near', by: 0 });
    expect(loopFit(metres(2_300), 2)).toEqual({ kind: 'near', by: 0 });
    expect(loopFit(metres(1_600), 2)).toEqual({ kind: 'under', by: 400 });
    expect(loopFit(metres(2_500), 2)).toEqual({ kind: 'over', by: 500 });
  });

  it('names each target in the rider’s units', () => {
    expect(loopTargetText(2, 'metric')).toBe('2 km');
    expect(loopTargetText(1, 'imperial')).toBe('0.6 mi');
  });

  it('says what a loop still needs, then its length and a note against the target', () => {
    expect(loopReadout(drawn(TRIANGLE.slice(0, 2), 'freehand'), 2, 'metric').state).toBe(
      LOOP_START_TEXT,
    );
    const open = drawn(TRIANGLE, 'freehand');
    const drawing = loopReadout(open, 2, 'metric');
    expect(drawing.state).toBe(NOT_YET_A_LOOP_TEXT);
    expect(drawing.note).toBeUndefined();

    const closed = closeLoop(open, 'freehand').draft;
    const length = draftDistance(closed);
    expect(length).toBeGreaterThan(1_850);
    expect(length).toBeLessThan(1_950);
    const near = loopReadout(closed, 2, 'metric');
    expect(near.state).toBe(IS_A_LOOP_TEXT);
    expect(near.length).toBe('Loop length 1.9 km, against a target of 2 km.');
    expect(near.note).toBe('It is within 15% of the target.');
    expect(loopReadout(closed, 1, 'metric').note).toMatch(/^It is 0\.9 km over the target/);
    expect(loopReadout(closed, 3, 'metric').note).toMatch(/^It is 1\.1 km under the target/);
  });

  it('advises moving a middle waypoint, and no other target when none is nearer', () => {
    // A smaller triangle, about 1.6 km round: 0.4 km under 2 km, and the 1 km
    // target would be 0.6 km off, so it is not offered.
    const small = closeLoop(
      drawn([at(40, -105), at(40.00504, -105), at(40.00252, -104.99496)], 'freehand'),
      'freehand',
    ).draft;
    expect(draftDistance(small)).toBeGreaterThan(1_550);
    expect(draftDistance(small)).toBeLessThan(1_650);
    expect(loopReadout(small, 2, 'metric').note).toBe(
      'It is 0.4 km under the target, more than 15% short. Move one of the middle waypoints further out: moving the first or the last opens the loop again.',
    );
  });

  it('offers the next target only when the loop is nearer it than the chosen one', () => {
    // 1.6 km against 2 km: the 1 km target would be 0.6 km off, worse than 0.4 km.
    expect(nearerTarget(metres(1_600), 2, 'under')).toBeUndefined();
    // 2.2 km against 3 km: the 2 km target is 0.2 km off, better than 0.8 km.
    expect(nearerTarget(metres(2_200), 3, 'under')).toBe(2);
    // 2.6 km against 2 km: 3 km is 0.4 km off, better than 0.6 km.
    expect(nearerTarget(metres(2_600), 2, 'over')).toBe(3);
    // 1.2 km against 1 km: 2 km would be 0.8 km off, worse than 0.2 km.
    expect(nearerTarget(metres(1_200), 1, 'over')).toBeUndefined();
    // A tie keeps the chosen target: 1.5 km is 0.5 km from both 1 km and 2 km,
    // and 2.5 km is 0.5 km from both 2 km and 3 km.
    expect(nearerTarget(metres(1_500), 2, 'under')).toBeUndefined();
    expect(nearerTarget(metres(2_500), 2, 'over')).toBeUndefined();
    // Nothing shorter than the shortest, nothing longer than the longest.
    expect(nearerTarget(metres(100), 1, 'under')).toBeUndefined();
    expect(nearerTarget(metres(20_000), 8, 'over')).toBeUndefined();
  });

  it('names the nearer target in the note, and the middle waypoints either way', () => {
    const closed = closeLoop(drawn(TRIANGLE, 'freehand'), 'freehand').draft; // about 1.9 km
    expect(loopReadout(closed, 3, 'metric').note).toBe(
      'It is 1.1 km under the target, more than 15% short. Move one of the middle waypoints further out: moving the first or the last opens the loop again. Or choose the 2 km target, which is nearer this length.',
    );
    expect(loopReadout(closed, 1, 'metric').note).toBe(
      'It is 0.9 km over the target, more than 15% long. Bring one of the middle waypoints in: moving the first or the last opens the loop again. Or choose the 2 km target, which is nearer this length.',
    );
  });

  it('says a line still being routed becomes a loop once every leg has one', () => {
    const closed = closeLoop(drawn(TRIANGLE, 'snapped'), 'snapped').draft;
    expect(loopReadout(closed, 2, 'metric').state).toBe(
      'It becomes a loop once every leg has a line.',
    );
  });

  it('names no coordinate in anything it says (ADR 0004 decision D)', () => {
    const closed = closeLoop(drawn(TRIANGLE, 'freehand'), 'freehand').draft;
    for (const target of [1, 2, 3, 5, 8] as const) {
      const said = Object.values(loopReadout(closed, target, 'metric'))
        .filter((value) => typeof value === 'string')
        .join(' ');
      expect(said).not.toMatch(/40\.0|-?105|104\.99/);
    }
  });
});

describe('the profile the planner works out for a loop', () => {
  it('is a loop when the line closes, and a line when it does not', async () => {
    const flatEverywhere: RoutingProvider = {
      route: () => Promise.reject(new Error('freehand legs ask no engine')),
      heights: (request) =>
        Promise.resolve({
          source: { name: 'Synthetic', resolution: metres(30) },
          samples: request.shape.map((_, index) => ({
            along: metres(index * request.interval),
            elevation: altitudeMetres(100),
          })),
        }),
    };
    const open = drawn(TRIANGLE, 'freehand');
    const closed = closeLoop(open, 'freehand').draft;
    expect((await planElevation(closed, flatEverywhere))?.profile.loop).toBe(true);
    expect((await planElevation(open, flatEverywhere))?.profile.loop).toBe(false);
  });
});
