// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A route ride's street names on a real-shaped out-and-back — the second
 * tablet check on PR #3261 (84a16b96): a huge white ring, one glyph many
 * times its size, lay round the rider on the sharp bend before a one-point
 * turnaround, and changed on every frame: 153 flash frames.
 *
 * The cause: on an out-and-back the way back runs beside the way out, and
 * only one road is drawn there, the pass nearer where the camera looks
 * (`landform.ts` §"A road ridden twice"). The way back's label lay a lane
 * over from the rider, laid rigid on the way BACK's recorded height — and a
 * recorded way back is not at the way out's height (#3103). So it floated in
 * the air over the rider, close under the camera: many times its size on
 * the screen, and a different shape on every frame as the camera moved.
 *
 * The fixture is shaped as a recorded track is: points 2 to 13 m apart,
 * unevenly; a long bend of 100° over 120 m; a leg to a one-point turnaround;
 * and the way back a lane over, recorded {@link WAY_BACK_HIGHER_METRES}
 * higher, as a phone's altitude drifts. One mapped street, invented, runs
 * the whole way out. A 60 fps ride over the whole route reads every letter
 * the renderer is handed (`sceneFrame`'s `streetNames`) against the road the
 * same frame draws (its `corridor`).
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
import { circuitRoute, FIXTURE_LATITUDE } from './route-fixtures-testing';
import { routeStreetNameLabels } from './route-street-names';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  STREET_NAME_GLYPH_ADVANCE_METRES,
  STREET_NAME_GLYPH_HEIGHT_METRES,
  streetNamesInView,
  type StreetNameLabel,
} from './street-names';
import { corridorOrigin, drawnRoadFrame } from './terrain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** How much higher the way back was recorded than the way out at the same place, metres. */
const WAY_BACK_HIGHER_METRES = 2.5;

/** How far the way back runs from the way out, metres: one lane. */
const LANE_METRES = 2;

/** The way out, east and north in metres: 500 m north, a 100° bend over 120 m, 450 m on. */
function wayOut(): [number, number][] {
  const line: [number, number][] = [];
  for (let north = 0; north < 500; north += 5) line.push([0, north]);
  const radius = 120 / ((100 * Math.PI) / 180);
  for (let step = 0; step <= 24; step += 1) {
    const angle = ((100 * Math.PI) / 180) * (step / 24);
    line.push([radius - radius * Math.cos(angle), 500 + radius * Math.sin(angle)]);
  }
  const [endEast, endNorth] = line.at(-1) as [number, number];
  const heading = (100 * Math.PI) / 180;
  for (let along = 5; along <= 450; along += 5) {
    line.push([endEast + Math.sin(heading) * along, endNorth + Math.cos(heading) * along]);
  }
  return line;
}

/** Every `(east, north)` of `line` moved `lane` metres to its right. */
function rightOf(line: readonly [number, number][], lane: number): [number, number][] {
  return line.map(([east, north], index) => {
    const [aEast, aNorth] = line[Math.max(0, index - 1)] as [number, number];
    const [bEast, bNorth] = line[Math.min(line.length - 1, index + 1)] as [number, number];
    const length = Math.hypot(bEast - aEast, bNorth - aNorth);
    return [east + ((bNorth - aNorth) / length) * lane, north - ((bEast - aEast) / length) * lane];
  });
}

/** The out-and-back, its points kept unevenly: 2 to 13 m apart, as a phone records them. */
function realShapedOutAndBack(): RouteProfile {
  const out = wayOut();
  const back = rightOf(out, LANE_METRES).reverse();
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const all = [
    ...out.map((point) => [point, 0] as const),
    ...back.map((point) => [point, 1] as const),
  ];
  // A fixed pattern of gaps, so the fixture is the same on every run.
  const skips = [0, 2, 1, 0, 0, 1, 2, 0, 1];
  let travelled = 0;
  let previous: readonly [number, number] | undefined;
  for (let index = 0; index < all.length; index += 1 + (skips[index % skips.length] as number)) {
    const [[east, north], pass] = all[index] as readonly [readonly [number, number], 0 | 1];
    if (previous !== undefined) travelled += Math.hypot(east - previous[0], north - previous[1]);
    previous = [east, north];
    // A gentle climb out, the same ground back, and the way back recorded higher.
    const ground = 40 + 0.02 * Math.min(travelled, 1_070) - 0.02 * Math.max(0, travelled - 1_072);
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(ground + pass * WAY_BACK_HIGHER_METRES),
    });
  }
  return routeProfile(points, { loop: false });
}

const PROFILE = realShapedOutAndBack();
const ORIGIN = corridorOrigin(PROFILE);
const TURN = PROFILE.totalDistance / 2;

function labelsOf(profile: RouteProfile): StreetNameLabel[] {
  const road = drawnRoadPoints(profile, ORIGIN);
  const line: number[] = [];
  for (let index = 0; index <= road.points.length / 4; index += 3) {
    line.push(road.points[index * 2] as number, road.points[index * 2 + 1] as number);
  }
  return routeStreetNameLabels([{ line, name: 'Testo Loop 10' }], profile, ORIGIN);
}

const LABELS = labelsOf(PROFILE);

/** 36 km/h at 60 frames a second: metres a frame. */
const FRAME_METRES = 10 / 60;

/** The ride, cut in pieces so each case is short. */
const PIECES = 32;

/** What a painted letter is: its edges along and across the road, metres. */
const EDGES = [
  STREET_NAME_GLYPH_ADVANCE_METRES,
  STREET_NAME_GLYPH_HEIGHT_METRES,
  STREET_NAME_GLYPH_ADVANCE_METRES,
  STREET_NAME_GLYPH_HEIGHT_METRES,
] as const;

/** How high a letter stands over the road drawn under it, metres: the lift, and its tolerance. */
const OVER_ROAD_METRES = 0.08;
const OVER_ROAD_TOLERANCE_METRES = 0.15;

describe('a real-shaped out-and-back: every letter drawn at its painted size, on the road drawn — #3261', () => {
  it('names both passes, so the way back has labels of its own', () => {
    expect(LABELS.some((label) => (label.along as number) < TURN)).toBe(true);
    expect(LABELS.some((label) => (label.along as number) > TURN)).toBe(true);
  });

  const pieces = Array.from({ length: PIECES }, (_, piece) => piece);
  it.each(pieces)('piece %d of the 60 fps ride', (piece) => {
    const start = atStartLine(PROFILE);
    const from = (PROFILE.totalDistance * piece) / PIECES;
    const to = (PROFILE.totalDistance * (piece + 1)) / PIECES;
    for (let distance = from; distance < to; distance += FRAME_METRES) {
      const frame = sceneFrame({
        profile: PROFILE,
        origin: ORIGIN,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        streetNames: LABELS,
      });
      const corners = frame.streetNames?.corners ?? new Float32Array(0);
      if (corners.length === 0) continue;
      // The road this frame draws, on the rider's own pass.
      const outward = distance < TURN;
      const road = frame.corridor.centre.filter((point) => point.distance < TURN === outward);
      for (let at = 0; at + 11 < corners.length; at += 12) {
        for (let corner = 0; corner < 4; corner += 1) {
          const next = (corner + 1) % 4;
          const edge = Math.hypot(
            (corners[at + next * 3] as number) - (corners[at + corner * 3] as number),
            (corners[at + next * 3 + 1] as number) - (corners[at + corner * 3 + 1] as number),
            (corners[at + next * 3 + 2] as number) - (corners[at + corner * 3 + 2] as number),
          );
          const painted = EDGES[corner] as number;
          expect(Math.abs(edge - painted) / painted).toBeLessThan(0.01);
          const x = corners[at + corner * 3] as number;
          const y = corners[at + corner * 3 + 1] as number;
          const z = corners[at + corner * 3 + 2] as number;
          let under = -1;
          let least = Infinity;
          for (const [index, point] of road.entries()) {
            const gap = Math.hypot(point.x - x, point.z - z);
            if (gap < least) {
              least = gap;
              under = index;
            }
          }
          // Past either end of the road this frame draws, there is no road to stand on.
          if (under <= 0 || under >= road.length - 1) continue;
          // On the road drawn, a lane at most from its centreline…
          expect(least).toBeLessThan(LANE_METRES + 2);
          // …and standing on it, not in the air over it.
          expect(Math.abs(y - (road[under]?.y ?? Number.NaN) - OVER_ROAD_METRES)).toBeLessThan(
            OVER_ROAD_TOLERANCE_METRES,
          );
        }
      }
    }
  });
});

describe('a letter drawn much larger than it is painted is not drawn at all — #3261', () => {
  const label: StreetNameLabel = {
    key: 'route:0',
    text: 'Testo',
    x: 0,
    z: 100,
    alongX: 0,
    alongZ: 1,
    along: 100,
  };
  const flat = (): number => 0;

  it('on a route ride: the one letter across a 20 m step of the road is left out, the rest drawn', () => {
    // The step is inside the middle letter, which spans 99.25 to 100.75 m along the route.
    const view = streetNamesInView([label], { x: 0, z: 0 }, 0, flat, {
      heightAt: (metres) => (metres < 100.5 ? 0 : 20),
      gap: (from, to) => Math.abs(to - from),
    });
    expect(view.labels).toHaveLength(1);
    expect(view.cells).toHaveLength(4);
    const level = streetNamesInView([{ ...label, key: 'route:1' }], { x: 0, z: 0 }, 0, flat, {
      heightAt: flat,
      gap: (from, to) => Math.abs(to - from),
    });
    expect(level.cells).toHaveLength(5);
  });

  it('on an open-world street: a letter whose corners stand on a cliff is left out', () => {
    const open: StreetNameLabel = {
      key: 'open:0',
      text: 'Testo',
      x: 0,
      z: 100,
      alongX: 0,
      alongZ: 1,
    };
    const view = streetNamesInView([open], { x: 0, z: 0 }, 0, (_x, z) =>
      z > 100.5 && z < 100.8 ? 20 : 0,
    );
    expect(view.cells.length).toBeLessThan(5);
    expect(view.cells.length).toBeGreaterThan(0);
  });
});

describe('a loop’s label just past the line is on the rider’s pass coming up to it — #3261', () => {
  it.each([0, 2])('is drawn while the rider is still on the end of lap %d', (laps) => {
    const loop = circuitRoute(400);
    const origin = corridorOrigin(loop);
    const frame = drawnRoadFrame(loop, origin, 40);
    expect(frame).toBeDefined();
    const label: StreetNameLabel = {
      key: 'route:0',
      text: 'Testa Ring',
      x: frame?.x ?? 0,
      z: frame?.z ?? 0,
      // The road's way: its normal, the right, turned back a quarter.
      alongX: frame?.normalZ ?? 0,
      alongZ: -(frame?.normalX ?? 0),
      along: 40,
    };
    const start = atStartLine(loop);
    const view = sceneFrame({
      profile: loop,
      origin,
      state: {
        ...start,
        ride: { ...start.ride, distance: metres((laps + 1) * loop.totalDistance - 60) },
      },
      streetNames: [label],
    }).streetNames;
    expect(view?.labels.map((each) => each.key)).toStrictEqual(['route:0']);
  });
});
