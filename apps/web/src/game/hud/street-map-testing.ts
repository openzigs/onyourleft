// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A route and a corridor for the street map's tests — #2290. Test support, never shipped.
 *
 * The route runs 1.5 km due north from 40° N, 75° W on the profile's 10 m
 * grid. The corridor is in the frame the product builds for it
 * (`terrain.ts` §`corridorOrigin`, the route's first point): `x` metres WEST
 * and `z` metres NORTH. It holds one covered tile round the route, a lake, a
 * street crossing the route, a footway beside it, and a street {@link FAR_EAST_METRES}
 * east, beyond anything the panel may draw while the rider is on this route.
 */

import { NO_BUILDING_FIELDS } from '@onyourleft/map-features';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RouteProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import type { WorldCorridor } from '../world-data/corridor';

/** How far east the far street is: 6 km. */
export const FAR_EAST_METRES = 6000;

/** The crossing street's metres north of the start. */
export const CROSSING_NORTH_METRES = 200;

/** 1.5 km due north. A loop when asked, by riding back south. */
export function northRoute(loop = false): RouteProfile {
  const points: RoutePoint[] = [];
  const out = 150;
  for (let index = 0; index <= out; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(40 + (index * 10) / 111_320),
        degreesLongitude(-75),
      ),
      elevation: altitudeMetres(10),
    });
  }
  if (loop) {
    // Back down a parallel street 100 m east, to the start.
    for (let index = out; index >= 0; index -= 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(40 + (index * 10) / 111_320),
          degreesLongitude(-75 + 100 / (111_320 * Math.cos((40 * Math.PI) / 180))),
        ),
        elevation: altitudeMetres(10),
      });
    }
    points.push(points[0] as RoutePoint);
  }
  return routeProfile(points, { loop });
}

/** The corridor round {@link northRoute}. */
export function northCorridor(routeId = 'north'): WorldCorridor {
  return {
    routeId,
    origin: { latitude: 40, longitude: -75, elevation: 10 },
    covered: () => true,
    coveredBoxes: [{ minX: -500, minZ: -200, maxX: 500, maxZ: 1700 }],
    landUse: [
      // A lake 300 m west, with an island in it.
      {
        layer: 'water',
        kind: 'lake',
        rings: [
          Float32Array.of(250, 400, 350, 400, 350, 600, 250, 600),
          Float32Array.of(290, 480, 290, 520, 310, 520, 310, 480),
        ],
      },
      // A park, which the map does not draw: the basemap style draws no landuse.
      { layer: 'landuse', kind: 'park', rings: [Float32Array.of(-50, 0, 50, 0, 50, 50)] },
    ],
    buildings: [
      {
        kind: 'building',
        heightMetres: 9,
        minHeightMetres: 0,
        ...NO_BUILDING_FIELDS,
        rings: [Float32Array.of(20, 20, 30, 20, 30, 30)],
      },
    ],
    paths: [{ kind: 'path', kindDetail: 'footway', line: Float32Array.of(-30, 0, -30, 800) }],
    streets: [
      {
        kind: 'minor_road',
        kindDetail: '',
        grade: 'ground',
        line: Float32Array.of(-200, CROSSING_NORTH_METRES, 200, CROSSING_NORTH_METRES),
      },
      {
        kind: 'major_road',
        kindDetail: '',
        grade: 'ground',
        line: Float32Array.of(-FAR_EAST_METRES, 0, -FAR_EAST_METRES, 400),
      },
    ],
  };
}
