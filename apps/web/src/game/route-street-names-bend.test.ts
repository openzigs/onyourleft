// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A route ride's street names round a sharp bend and a turnaround — the
 * tablet check of 2026-11-26 on PR #3261. On an out-and-back route, on the
 * sharp bend about 400 m before its one-point turnaround, a label was drawn as
 * long smeared streaks across both lanes, different on each frame: 83 of the
 * recording's 96 flash frames.
 *
 * Three things are held here, each read off what the renderer is handed
 * (`sceneFrame`'s `streetNames`):
 *
 * - no label is placed on a sharp bend, nor within
 *   {@link TURN_CLEAR_METRES} of a turn where the road comes
 *   back along itself (`route-street-names.ts`);
 * - every letter is a rigid rectangle, its painted size, flat across the road;
 * - and a label's letters are at the same place on every frame of a ride past
 *   it at 60 frames a second, as the corridor's points slide with the rider.
 *
 * The route is #3262's `bendThenReversal` (`turnaround-markings.test.ts` on
 * that PR): north, a bend, a leg to a one-point turnaround, and back a lane
 * over. Every name is invented; no coordinate of the owner's route.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { drawnRoadPoints } from './road-grid';
import { FIXTURE_LATITUDE } from './route-fixtures-testing';
import { routeStreetNameLabels } from './route-street-names';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { routeNameLayout, type RouteNameLayout, type StreetNameLabel } from './street-names';
import { corridorOrigin } from './terrain';

/** `name`'s layout across the lane (#3344), which every name here has. */
function layoutOf(name: string): RouteNameLayout {
  const layout = routeNameLayout(name);
  expect(layout).toBeDefined();
  return layout as RouteNameLayout;
}

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Where the bend is, metres north: so the route's second label falls on it. */
const BEND_NORTH_METRES = 1_030;

/** From the bend to the turnaround, metres: so the third label falls at the turn. */
const LEG_METRES = 1_000;

/** How far the way back is drawn from the way out, metres. */
const LANE_METRES = 3;

const NAME = 'Testa 3rd St.';

/** A route through `corners`, east and north in metres, a point every 5 m at most. */
function planRoute(corners: readonly (readonly [number, number])[]): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const push = (east: number, north: number): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(30 + 0.002 * points.length),
    });
  };
  push(...(corners[0] as readonly [number, number]));
  for (let corner = 1; corner < corners.length; corner += 1) {
    const [fromEast, fromNorth] = corners[corner - 1] as readonly [number, number];
    const [toEast, toNorth] = corners[corner] as readonly [number, number];
    const pieces = Math.max(1, Math.ceil(Math.hypot(toEast - fromEast, toNorth - fromNorth) / 5));
    for (let piece = 1; piece <= pieces; piece += 1) {
      push(
        fromEast + ((toEast - fromEast) * piece) / pieces,
        fromNorth + ((toNorth - fromNorth) * piece) / pieces,
      );
    }
  }
  return routeProfile(points, { loop: false });
}

/** North, a bend of `degrees` east, {@link LEG_METRES} to a turnaround, and back a lane over. */
function bendThenReversal(degrees: number): RouteProfile {
  const turn = (degrees * Math.PI) / 180;
  const bend = [0, BEND_NORTH_METRES] as const;
  const way = [Math.sin(turn), Math.cos(turn)] as const;
  const end = [bend[0] + way[0] * LEG_METRES, bend[1] + way[1] * LEG_METRES] as const;
  const across = LANE_METRES / Math.cos(turn / 2);
  const corner = [
    bend[0] + across * Math.cos(turn / 2),
    bend[1] - across * Math.sin(turn / 2),
  ] as const;
  return planRoute([
    [0, 0],
    bend,
    end,
    [end[0] + way[1] * LANE_METRES, end[1] - way[0] * LANE_METRES],
    corner,
    [LANE_METRES, 0],
  ]);
}

interface Ride {
  readonly profile: RouteProfile;
  readonly labels: readonly StreetNameLabel[];
  /** Each label's route distance, read off the drawn road: the pass it lies along, nearest it. */
  readonly alongs: readonly number[];
  /** The route distances of the bend's corner, on the way out and on the way back. */
  readonly bends: readonly number[];
  readonly turn: number;
}

/** The route, with one mapped street named {@link NAME} along its way out. */
function ride(degrees: number): Ride {
  const profile = bendThenReversal(degrees);
  const origin = corridorOrigin(profile);
  const road = drawnRoadPoints(profile, origin);
  const count = road.points.length / 2;
  const line: number[] = [];
  for (let index = 0; index <= count / 2; index += 3) {
    line.push(road.points[index * 2] as number, road.points[index * 2 + 1] as number);
  }
  const labels = routeStreetNameLabels([{ line, name: NAME }], profile, origin);
  // The bend's corner in plan is the drawn road's point nearest it on each pass.
  const nearest = (from: number, to: number): number => {
    let best = from;
    let least = Infinity;
    for (let index = from; index < to; index += 1) {
      const north = Math.hypot(
        (road.points[index * 2] as number) - (road.points[0] as number),
        (road.points[index * 2 + 1] as number) - (road.points[1] as number) - BEND_NORTH_METRES,
      );
      if (north < least) {
        least = north;
        best = index;
      }
    }
    return best * road.step;
  };
  const half = Math.floor(count / 2);
  const alongs = labels.map((label) => {
    let best = 0;
    let least = Infinity;
    for (let index = 0; index + 1 < count; index += 1) {
      const x = road.points[index * 2] as number;
      const z = road.points[index * 2 + 1] as number;
      const dx = (road.points[index * 2 + 2] as number) - x;
      const dz = (road.points[index * 2 + 3] as number) - z;
      if ((dx * label.alongX + dz * label.alongZ) / Math.hypot(dx, dz) < 0.5) continue;
      const gap = Math.hypot(x - label.x, z - label.z);
      if (gap < least) {
        least = gap;
        best = index;
      }
    }
    return best * road.step;
  });
  return {
    profile,
    labels,
    alongs,
    bends: [nearest(0, half), nearest(half, count)],
    turn: profile.totalDistance / 2,
  };
}

const BENDS = [60, 90, 120] as const;

/**
 * How far from the turnaround no letter may be, metres: **100**,
 * `route-street-names.ts` §`ROUTE_STREET_NAME_TURN_CLEAR_METRES`, written
 * here as a number so the case reads the same against a module without it.
 */
const TURN_CLEAR_METRES = 100;

/** How far either side of each letter's edge the road must not be turning, metres: the bend's own rounding. */
const BEND_CLEAR_METRES = 15;

describe('no label on a sharp bend or near a turnaround — #3261’s tablet check', () => {
  it.each(BENDS)(
    'a %d° bend: every label clear of the bend’s corner, on both passes',
    (degrees) => {
      const { labels, alongs, bends } = ride(degrees);
      expect(labels.length).toBeGreaterThan(1);
      for (const [index, label] of labels.entries()) {
        const half = layoutOf(label.text).extent / 2;
        for (const bend of bends) {
          expect(Math.abs((alongs[index] as number) - bend)).toBeGreaterThan(
            half + BEND_CLEAR_METRES,
          );
        }
      }
    },
  );

  it.each(BENDS)('a %d° bend: no letter within the clearance of the turnaround', (degrees) => {
    const { labels, alongs, turn } = ride(degrees);
    // The way back is named too, so the route still has a label past the turn.
    expect(alongs.some((along) => along > turn)).toBe(true);
    for (const [index, label] of labels.entries()) {
      const half = layoutOf(label.text).extent / 2;
      expect(Math.abs((alongs[index] as number) - turn)).toBeGreaterThanOrEqual(
        half + TURN_CLEAR_METRES,
      );
    }
  });
});

/** 36 km/h at 60 frames a second: metres a frame. */
const FRAME_METRES = 10 / 60;

/** Each frame's names on a ride past every label, from 60 m before it to 20 m past. */
function framesPast(at: Ride): ReturnType<typeof sceneFrame>['streetNames'][] {
  const origin = corridorOrigin(at.profile);
  const start = atStartLine(at.profile);
  const views: ReturnType<typeof sceneFrame>['streetNames'][] = [];
  for (const along of at.alongs) {
    for (let distance = Math.max(0, along - 60); distance < along + 20; distance += FRAME_METRES) {
      const frame = sceneFrame({
        profile: at.profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        streetNames: at.labels,
      });
      views.push(frame.streetNames);
    }
  }
  return views;
}

/** Holds every letter of `views` to a flat rectangle of the painted size; how many there were. */
function rigidLetters(views: readonly ReturnType<typeof sceneFrame>['streetNames'][]): number {
  // Every label here is {@link NAME}, laid across the lane (#3344).
  const { width, length } = layoutOf(NAME);
  let letters = 0;
  for (const view of views) {
    const corners = view?.corners ?? new Float32Array(0);
    for (let at = 0; at + 11 < corners.length; at += 12) {
      const corner = (index: number): readonly [number, number, number] => [
        corners[at + index * 3] as number,
        corners[at + index * 3 + 1] as number,
        corners[at + index * 3 + 2] as number,
      ];
      const [a, b, c, d] = [corner(0), corner(1), corner(2), corner(3)];
      const plan = (p: readonly number[], q: readonly number[]): number =>
        Math.hypot((q[0] as number) - (p[0] as number), (q[2] as number) - (p[2] as number));
      // #3344: its bottom and top edges across the lane, its sides along the road.
      expect(plan(a, b)).toBeCloseTo(width, 3);
      expect(plan(d, c)).toBeCloseTo(width, 3);
      expect(plan(a, d)).toBeCloseTo(length, 3);
      expect(plan(b, c)).toBeCloseTo(length, 3);
      // Square in plan, and flat across the road: each edge across it at one height.
      expect(plan(a, c)).toBeCloseTo(Math.hypot(width, length), 3);
      expect(b[1]).toBeCloseTo(a[1], 4);
      expect(c[1]).toBeCloseTo(d[1], 4);
      letters += 1;
    }
  }
  return letters;
}

describe('every letter rigid, and steady from frame to frame — #3261’s tablet check', () => {
  const at = ride(90);
  const views = framesPast(at);

  it('lays each letter as a flat rectangle of the painted size', () => {
    expect(rigidLetters(views)).toBeGreaterThan(1_000);
  });

  it('lays them so even where the two passes meet, for a label handed there', () => {
    // Placement never puts one there; the scene must not depend on that.
    const road = drawnRoadPoints(at.profile, corridorOrigin(at.profile));
    const along = at.turn - 15;
    const index = Math.round(along / road.step);
    const x = road.points[index * 2] as number;
    const z = road.points[index * 2 + 1] as number;
    const dx = (road.points[index * 2 + 2] as number) - x;
    const dz = (road.points[index * 2 + 3] as number) - z;
    const length = Math.hypot(dx, dz);
    const near: StreetNameLabel = {
      key: 'route:turn',
      text: NAME,
      x,
      z,
      alongX: dx / length,
      alongZ: dz / length,
      along,
    };
    const origin = corridorOrigin(at.profile);
    const start = atStartLine(at.profile);
    const handed: ReturnType<typeof sceneFrame>['streetNames'][] = [];
    for (let distance = along - 60; distance < along + 20; distance += FRAME_METRES * 6) {
      handed.push(
        sceneFrame({
          profile: at.profile,
          origin,
          state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
          streetNames: [near],
        }).streetNames,
      );
    }
    expect(rigidLetters(handed)).toBeGreaterThan(100);
  });

  it('draws each label’s letters at the same place on every frame', () => {
    const seen = new Map<string, Float32Array>();
    let compared = 0;
    for (const view of views) {
      if (view === undefined) continue;
      let letter = 0;
      for (const label of view.labels) {
        const count = layoutOf(label.text).letters;
        const corners = view.corners.slice(letter * 12, (letter + count) * 12);
        letter += count;
        const before = seen.get(label.key);
        if (before !== undefined) {
          expect(Array.from(corners)).toStrictEqual(Array.from(before));
          compared += 1;
        }
        seen.set(label.key, corners);
      }
    }
    expect(compared).toBeGreaterThan(1_000);
  });
});
