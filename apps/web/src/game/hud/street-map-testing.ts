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
 *
 * {@link denseTown} and {@link denseTownRoute} are #2380's: a town denser
 * than a real corridor holds anywhere but a city centre, which the unit tests
 * bound the drawing over and `browser/street-map-harness.tsx` rides.
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

/**
 * 40 km due north from 0° N, 0° E, a sample every 100 m — #2380. On the
 * equator at the prime meridian, in the sea: no place a rider could ride, so
 * nothing here is of anywhere.
 */
export function denseTownRoute(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    points.push({
      position: geographicPosition(degreesLatitude((index * 100) / 111_320), degreesLongitude(0)),
      elevation: altitudeMetres(60 + 20 * Math.sin(index / 30)),
    });
  }
  return routeProfile(points);
}

/** A line from (x0, z0) to (x1, z1) with a vertex every 20 m. */
function denseLine(x0: number, z0: number, x1: number, z1: number): Float32Array {
  const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 20));
  const values: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    values.push(x0 + ((x1 - x0) * step) / steps, z0 + ((z1 - z0) * step) / steps);
  }
  return Float32Array.from(values);
}

/**
 * The dense synthetic town round {@link denseTownRoute} — #2290, #2380. A
 * street every 100 m both ways across 2 km either side of the route, a vertex
 * every 20 m, a footway between each pair of streets running north and a lake
 * every 4 km, cut into 1 km tiles as the archive's are. It is arithmetic, and
 * no map data from anywhere.
 */
export function denseTown(): WorldCorridor {
  const streets: WorldCorridor['streets'][number][] = [];
  const paths: WorldCorridor['paths'][number][] = [];
  const landUse: WorldCorridor['landUse'][number][] = [];
  const coveredBoxes: WorldCorridor['coveredBoxes'][number][] = [];
  for (let tileZ = 0; tileZ < 40_000; tileZ += 1000) {
    for (const tileX of [-2000, -1000, 0, 1000]) {
      coveredBoxes.push({ minX: tileX, minZ: tileZ, maxX: tileX + 1000, maxZ: tileZ + 1000 });
      for (let offset = 0; offset < 1000; offset += 100) {
        const street = { kind: 'minor_road', kindDetail: '', grade: 'ground' as const };
        streets.push({
          ...street,
          line: denseLine(tileX + offset, tileZ, tileX + offset, tileZ + 1000),
        });
        streets.push({
          ...street,
          line: denseLine(tileX, tileZ + offset, tileX + 1000, tileZ + offset),
        });
        paths.push({
          kind: 'path',
          kindDetail: 'footway',
          line: denseLine(tileX + offset + 50, tileZ, tileX + offset + 50, tileZ + 1000),
        });
      }
    }
    if (tileZ % 4000 === 0) {
      const ring: number[] = [];
      for (let corner = 0; corner < 48; corner += 1) {
        const angle = (corner / 48) * 2 * Math.PI;
        ring.push(600 + 250 * Math.cos(angle), tileZ + 500 + 180 * Math.sin(angle));
      }
      landUse.push({ layer: 'water', kind: 'lake', rings: [Float32Array.from(ring)] });
    }
  }
  return {
    routeId: 'dense-town',
    origin: { latitude: 0, longitude: 0, elevation: 60 },
    covered: () => true,
    coveredBoxes,
    landUse,
    buildings: [],
    paths,
    streets,
  };
}
