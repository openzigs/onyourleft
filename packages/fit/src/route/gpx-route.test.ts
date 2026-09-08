// SPDX-License-Identifier: Apache-2.0

/**
 * #89's fourth criterion, and the `<trk>`/`<rte>` precedence it rests on.
 *
 * > A malformed or empty GPX is rejected with an actionable message naming the
 * > problem, not a crash and not a silently empty route.
 *
 * Every document here is inline rather than committed, because each is a
 * *shape* rather than a route — three points is enough to be malformed in a
 * particular way. The one real route is the committed fixture, asserted in
 * `tools/fixture-corpus/route-corpus.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { RouteError } from '@onyourleft/domain';

import { ActivityXmlError } from '../xml/errors';
import { decodeGpxRoute } from './gpx-route';

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const OPEN = '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">';

function route(body: string): string {
  return `${HEAD}\n${OPEN}\n${body}\n</gpx>\n`;
}

/** Points on a straight line east, about 30 m apart, climbing 1 m each. */
function points(count: number, element: 'rtept' | 'trkpt', elevation = true): string {
  return Array.from({ length: count }, (_, index) => {
    const ele = elevation ? `<ele>${String(10 + index)}</ele>` : '';
    return `<${element} lat="0.5" lon="${String(0.5 + index * 0.0003)}">${ele}</${element}>`;
  }).join('\n');
}

function raised(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, and nothing was thrown');
}

describe('a document that is not a route', () => {
  it('an empty <gpx> says what was looked for and where', () => {
    const error = raised(() => decodeGpxRoute(route('')));
    expect(error).toBeInstanceOf(RouteError);
    expect((error as RouteError).code).toBe('too-few-points');
    expect((error as RouteError).message).toContain('<rte>');
    expect((error as RouteError).message).toContain('<trk>');
  });

  it('a route whose points carry no coordinates says how many it found', () => {
    const error = raised(() =>
      decodeGpxRoute(route('<rte><rtept><ele>10</ele></rtept><rtept><ele>11</ele></rtept></rte>')),
    );
    expect((error as RouteError).code).toBe('too-few-points');
    expect((error as RouteError).message).toContain('2 route points');
    expect((error as RouteError).message).toContain('lat');
  });

  it('a route with no elevation anywhere is refused rather than ridden flat', () => {
    const error = raised(() => decodeGpxRoute(route(`<rte>${points(5, 'rtept', false)}</rte>`)));
    expect((error as RouteError).code).toBe('no-elevation');
  });

  it('a single point is refused rather than becoming a route of length zero', () => {
    const error = raised(() => decodeGpxRoute(route(`<rte>${points(1, 'rtept')}</rte>`)));
    expect((error as RouteError).code).toBe('too-few-points');
  });
});

describe('a document that is not well-formed', () => {
  it('is an ActivityXmlError with an offset, not a crash', () => {
    const error = raised(() => decodeGpxRoute(`${HEAD}\n${OPEN}\n<rte><rtept lat="0.5"`));
    expect(error).toBeInstanceOf(ActivityXmlError);
  });

  it('a DOCTYPE is still refused, because the reader is the same one', () => {
    // #89 says reuse the #32 parser and not write a second one. This is what
    // that buys: the route importer inherits the XXE refusal rather than being
    // a second front door with no lock on it.
    const error = raised(() =>
      decodeGpxRoute(
        `${HEAD}\n<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n${OPEN}\n</gpx>`,
      ),
    );
    expect(error).toBeInstanceOf(ActivityXmlError);
  });

  it('a root element that is not <gpx> names what it found instead', () => {
    const error = raised(() => decodeGpxRoute(`${HEAD}\n<kml></kml>`));
    expect(error).toBeInstanceOf(ActivityXmlError);
    expect((error as ActivityXmlError).message).toContain('<gpx>');
  });
});

describe('<trk> and <rte>', () => {
  it('reads a route from <rte>, which nothing else in this codec does', () => {
    const decoded = decodeGpxRoute(
      route(`<rte><name>Hill loop</name>${points(20, 'rtept')}</rte>`),
    );
    expect(decoded.name).toBe('Hill loop');
    expect(decoded.profile.totalDistance).toBeGreaterThan(500);
    expect(decoded.faults).toEqual([]);
  });

  it('reads one from <trk> too, so a "GPX track" export is not a special case', () => {
    const decoded = decodeGpxRoute(
      route(`<trk><name>Recorded</name><trkseg>${points(20, 'trkpt')}</trkseg></trk>`),
    );
    expect(decoded.name).toBe('Recorded');
    expect(decoded.profile.totalDistance).toBeGreaterThan(500);
  });

  it('takes the <trk> when a document carries both, rather than concatenating them', () => {
    // Planners routinely export a track AND a coarse route describing the same
    // line. Concatenating them would double the ride and put a teleport in the
    // middle of it; this is the assertion that says which one wins.
    const both = route(
      `<trk><name>Recorded</name><trkseg>${points(20, 'trkpt')}</trkseg></trk>\n` +
        `<rte><name>Planned</name>${points(20, 'rtept')}</rte>`,
    );
    const decoded = decodeGpxRoute(both);
    const trackOnly = decodeGpxRoute(
      route(`<trk><name>Recorded</name><trkseg>${points(20, 'trkpt')}</trkseg></trk>`),
    );
    expect(decoded.profile.totalDistance).toBeCloseTo(trackOnly.profile.totalDistance, 9);
    expect(decoded.name).toBe('Recorded');
  });

  it('drops a point with no coordinates and keeps the rest of the route', () => {
    const decoded = decodeGpxRoute(
      route(
        `<rte>${points(10, 'rtept')}\n<rtept><ele>99</ele></rtept>\n${points(10, 'rtept')}</rte>`,
      ),
    );
    // A single unreadable point in a thousand must not cost the rider the route.
    expect(decoded.profile.totalDistance).toBeGreaterThan(0);
  });

  it('carries a document’s recoverable faults through rather than swallowing them', () => {
    const decoded = decodeGpxRoute(
      route(
        `<rte>${points(10, 'rtept')}\n<rtept lat="0.5" lon="nonsense"><ele>4</ele></rtept></rte>`,
      ),
    );
    expect(decoded.faults.length).toBeGreaterThan(0);
    expect(decoded.profile.totalDistance).toBeGreaterThan(0);
  });
});
