// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { Point } from './params';
import { decodePolyline6, pointBackAlong } from './shape';

/** Encodes at six decimal places, the reference algorithm, so the decoder is checked against its inverse. */
function encode(points: readonly Point[]): string {
  let out = '';
  let lat = 0;
  let lon = 0;
  const one = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const point of points) {
    const nextLat = Math.round(point.lat * 1e6);
    const nextLon = Math.round(point.lon * 1e6);
    one(nextLat - lat);
    one(nextLon - lon);
    lat = nextLat;
    lon = nextLon;
  }
  return out;
}

const metres = (a: Point, b: Point): number =>
  distanceBetween(
    geographicPosition(degreesLatitude(a.lat), degreesLongitude(a.lon)),
    geographicPosition(degreesLatitude(b.lat), degreesLongitude(b.lon)),
  );

// A synthetic line off Null Island, on no road anywhere.
const LINE: Point[] = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.01 },
  { lat: 0.005, lon: 0.01 },
  { lat: -0.000123, lon: -0.004567 },
];

describe('decodePolyline6', () => {
  it('decodes what the reference encoder writes, signs and all', () => {
    expect(decodePolyline6(encode(LINE))).toEqual(LINE);
  });

  it('decodes an empty shape to no points', () => {
    expect(decodePolyline6('')).toEqual([]);
  });

  it('refuses a shape cut inside a number', () => {
    expect(() => decodePolyline6(encode(LINE).slice(0, -1))).toThrow('ends inside a number');
  });
});

describe('pointBackAlong', () => {
  const route = LINE.slice(0, 3);

  it('walks back along the last segment', () => {
    const point = pointBackAlong(route, 250);
    expect(point.lon).toBeCloseTo(0.01, 9);
    expect(metres(point, route[2] as Point)).toBeCloseTo(250, 3);
  });

  it('carries on into an earlier segment, staying on the line', () => {
    const last = metres(route[1] as Point, route[2] as Point);
    const point = pointBackAlong(route, last + 100);
    expect(point.lat).toBeCloseTo(0, 9);
    expect(metres(point, route[1] as Point)).toBeCloseTo(100, 3);
  });

  it('stops at the start of a route shorter than the drag', () => {
    expect(pointBackAlong(route, 1e7)).toEqual(route[0]);
  });

  it('refuses a route with no shape', () => {
    expect(() => pointBackAlong([], 250)).toThrow('no shape');
  });
});
