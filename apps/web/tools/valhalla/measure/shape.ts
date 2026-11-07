// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route shape Valhalla returns, and the dragged waypoint the page derives
 * from it (#2320).
 *
 * Spike 0035 moved the destination about 250 m and routed again. The SDK snaps
 * an end point only within 30 m of a road, so a point moved 250 m in a fixed
 * direction is often off every road and the "drag" fails to snap at all. The
 * page moves it **along the route it just drew** instead: the point
 * `dragMetres` back from the destination on the cold route's own shape, which
 * is on a road by construction, as a rider dragging the end of a line along
 * the street would.
 */

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
} from '@onyourleft/domain';

import type { Point } from './params';

/** Decodes an encoded polyline at six decimal places (Valhalla's `shape`). Throws on a truncated string. */
export function decodePolyline6(encoded: string): Point[] {
  const points: Point[] = [];
  let at = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (at >= encoded.length) throw new Error('decodePolyline6: the shape ends inside a number');
      const byte = encoded.charCodeAt(at) - 63;
      at += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (at < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / 1e6, lon: lon / 1e6 });
  }
  return points;
}

function metresBetween(a: Point, b: Point): number {
  return distanceBetween(
    geographicPosition(degreesLatitude(a.lat), degreesLongitude(a.lon)),
    geographicPosition(degreesLatitude(b.lat), degreesLongitude(b.lon)),
  );
}

/**
 * The point `metres` back from the end of `shape`, measured along it. A shape
 * shorter than that gives its first point. Throws on an empty shape.
 */
export function pointBackAlong(shape: readonly Point[], metres: number): Point {
  const last = shape.at(-1);
  if (last === undefined) throw new Error('pointBackAlong: the route has no shape');
  let left = metres;
  for (let at = shape.length - 1; at > 0; at -= 1) {
    const to = shape[at] as Point;
    const from = shape[at - 1] as Point;
    const step = metresBetween(from, to);
    if (step >= left && step > 0) {
      const fraction = left / step;
      return {
        lat: to.lat + (from.lat - to.lat) * fraction,
        lon: to.lon + (from.lon - to.lon) * fraction,
      };
    }
    left -= step;
  }
  return shape[0] as Point;
}
