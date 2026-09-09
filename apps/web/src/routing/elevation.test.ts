// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  type GeographicPosition,
  type HeightProfile,
  type HeightSample,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { addWaypoint, emptyDraft, resolveDraft, type RouteDraft } from './draft';
import {
  ELEVATION_INTERVAL_METRES,
  FLAT_GRADE_TOLERANCE_PERCENT,
  elevationFrom,
  planElevation,
  plannedShape,
  quantised,
  resampleShape,
} from './elevation';
import { RIDING_DEFAULTS } from './preferences';
import { GLO30, scriptedProvider } from './testing';

const INTERVAL = metres(ELEVATION_INTERVAL_METRES);

/** A straight line north, `metresLong` long. One degree of latitude is ~111 320 m. */
function line(metresLong: number, points = 2): readonly GeographicPosition[] {
  return Array.from({ length: points }, (_, index) =>
    geographicPosition(
      degreesLatitude(51.5 + (metresLong / 111_320) * (index / (points - 1))),
      degreesLongitude(-0.12),
    ),
  );
}

function profileOf(elevations: readonly (number | undefined)[]): HeightProfile {
  const samples: HeightSample[] = elevations.map((elevation, index) => ({
    along: metres(index * ELEVATION_INTERVAL_METRES),
    elevation: elevation === undefined ? undefined : altitudeMetres(elevation),
  }));
  return { source: GLO30, samples };
}

describe('the sampling grid is uniform, and stated', () => {
  it('resamples a shape onto the interval', () => {
    const grid = resampleShape(line(300), INTERVAL);
    // 300 m at 30 m is eleven points including both ends.
    expect(grid).toHaveLength(11);
  });

  it('lands its last sample on the route end rather than the last whole interval', () => {
    const shape = line(305);
    const grid = resampleShape(shape, INTERVAL);
    expect(grid.at(-1)).toStrictEqual(shape.at(-1));
  });

  it('is unmoved by how densely the source shape was drawn', () => {
    // ⚠️ The point of resampling: an engine that returns 200 vertices for the
    // same road as another that returns 20 must not produce a different ascent.
    const sparse = resampleShape(line(600, 3), INTERVAL);
    const dense = resampleShape(line(600, 200), INTERVAL);
    expect(dense).toHaveLength(sparse.length);
  });

  it('steps over a repeated point rather than dividing by a zero-length span', () => {
    const point = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));
    expect(() => resampleShape([point, point, ...line(300)], INTERVAL)).not.toThrow();
  });

  it('returns nothing for a shape that is not a path', () => {
    expect(resampleShape([], INTERVAL)).toStrictEqual([]);
    expect(elevationFrom(line(300).slice(0, 1), profileOf([10]), INTERVAL)).toBeUndefined();
  });
});

describe('what the numbers came from is carried, not assumed', () => {
  it('keeps the dataset name and resolution', () => {
    // ⚠️ #72's first criterion, and ADR 0010 D-5 makes it a licence requirement
    // too: the Copernicus notice travels with adapted data, and a name that
    // stops here never reaches the export.
    const shape = line(300);
    const planned = elevationFrom(shape, profileOf(Array(11).fill(100)), INTERVAL);
    expect(planned?.dataset.name).toBe('Copernicus DEM GLO-30');
    expect(planned?.dataset.resolution).toBe(30);
  });

  it('states the interval it sampled at', () => {
    const shape = line(300);
    expect(elevationFrom(shape, profileOf(Array(11).fill(100)), INTERVAL)?.interval).toBe(
      ELEVATION_INTERVAL_METRES,
    );
  });
});

describe('a data void is a gap, not a smooth climb', () => {
  it('reports the profile incomplete and says how much is missing', () => {
    // ⚠️ #72: "a route crossing a data void or a withheld DEM tile renders the
    // gap AS a gap, and total ascent reports as incomplete rather than silently
    // summing across it."
    const shape = line(300);
    const planned = elevationFrom(
      shape,
      profileOf([10, 12, 14, undefined, undefined, 30, 32, 34, 36, 38, 40]),
      INTERVAL,
    );
    expect(planned?.coverage.complete).toBe(false);
    expect(planned?.coverage.missing).toBe(60);
    expect(planned?.coverage.gaps).toStrictEqual([{ from: 90, to: 150 }]);
  });

  it('reports every hole, not only the first', () => {
    const shape = line(300);
    const planned = elevationFrom(
      shape,
      profileOf([10, undefined, 14, 16, 18, undefined, 22, 24, 26, 28, 30]),
      INTERVAL,
    );
    expect(planned?.coverage.gaps).toHaveLength(2);
  });

  it('closes a hole that runs to the end of the route', () => {
    const shape = line(300);
    const planned = elevationFrom(
      shape,
      profileOf([10, 12, 14, 16, 18, 20, 22, 24, undefined, undefined, undefined]),
      INTERVAL,
    );
    expect(planned?.coverage.gaps).toStrictEqual([{ from: 240, to: 300 }]);
  });

  it('is complete when every sample came back', () => {
    const shape = line(300);
    const planned = elevationFrom(shape, profileOf(Array(11).fill(100)), INTERVAL);
    expect(planned?.coverage.complete).toBe(true);
    expect(planned?.coverage.missing).toBe(0);
    expect(planned?.coverage.gaps).toStrictEqual([]);
  });

  it('still produces an ascent, which is what makes the flag load-bearing', () => {
    // The total is computed across interpolated ground because a chart needs
    // numbers. `complete: false` is the only thing that says so, which is why
    // the screen must read it — and why a test asserts the total is not zero.
    const shape = line(600);
    const heights = [
      0,
      10,
      20,
      undefined,
      undefined,
      50,
      60,
      70,
      80,
      90,
      100,
      110,
      120,
      130,
      140,
      150,
      160,
      170,
      180,
      190,
      200,
    ];
    const planned = elevationFrom(shape, profileOf(heights), INTERVAL);
    expect(planned?.profile.totalAscent).toBeGreaterThan(0);
    expect(planned?.coverage.complete).toBe(false);
  });
});

describe('a flat road reads flat', () => {
  it('shows no gradient worth the name on a genuinely flat fixture', () => {
    // #72's third criterion, with its threshold stated.
    const shape = line(1_200);
    const flat = Array.from({ length: 41 }, () => 42.4);
    const planned = elevationFrom(shape, profileOf(flat), INTERVAL);
    for (const grade of planned?.profile.grades ?? []) {
      expect(Math.abs(grade)).toBeLessThan(FLAT_GRADE_TOLERANCE_PERCENT);
    }
  });

  it('shows a stair step when the heights arrive as whole metres', () => {
    // ⚠️ The pair that makes the threshold above mean something. ADR 0010 D-5
    // records the engine's own warning that integer `height_precision` causes
    // "stair step" artefacts on flat roads; this is that artefact, produced on
    // purpose. An adapter that asks for integer heights fails the test above.
    const shape = line(1_200);
    const creeping = Array.from({ length: 41 }, (_, index) => quantised(42 + index * 0.05));
    const planned = elevationFrom(
      shape,
      {
        source: GLO30,
        samples: creeping.map((elevation, index) => ({
          along: metres(index * ELEVATION_INTERVAL_METRES),
          elevation,
        })),
      },
      INTERVAL,
    );
    const worst = Math.max(...(planned?.profile.grades ?? []).map((grade) => Math.abs(grade)));
    expect(worst).toBeGreaterThan(FLAT_GRADE_TOLERANCE_PERCENT);
  });
});

describe('the shape a profile is built from', () => {
  it('stops at the first leg that has no geometry', async () => {
    // ⚠️ Concatenating across a hole would draw a straight line over it and
    // then measure it as ridden distance.
    const provider = scriptedProvider();
    let draft = drawn(4);
    draft = await resolveDraft(draft, [0, 1], provider, RIDING_DEFAULTS);
    const shape = plannedShape(draft);
    expect(shape.length).toBeGreaterThan(0);
    // Two legs of eight scripted vertices, meeting at a shared waypoint.
    expect(shape).toHaveLength(15);
  });

  it('does not repeat the waypoint two legs meet at', async () => {
    const provider = scriptedProvider({ vertices: 3 });
    let draft = drawn(3);
    draft = await resolveDraft(draft, [0, 1], provider, RIDING_DEFAULTS);
    const shape = plannedShape(draft);
    expect(shape).toHaveLength(5);
    for (let index = 0; index + 1 < shape.length; index += 1) {
      expect(shape[index]).not.toStrictEqual(shape[index + 1]);
    }
  });

  it('returns nothing to plan for a route with no routed legs', async () => {
    expect(await planElevation(drawn(3), scriptedProvider())).toBeUndefined();
  });

  it('asks the provider for the interval it was given', async () => {
    const provider = scriptedProvider();
    const draft = await resolveDraft(drawn(3), [0, 1], provider, RIDING_DEFAULTS);
    await planElevation(draft, provider);
    expect(provider.heightCalls[0]?.interval).toBe(ELEVATION_INTERVAL_METRES);
  });
});

describe('reversing a route swaps its climbing for its descending', () => {
  it('turns the ascent into the descent and back', () => {
    // ⚠️ #71's sixth criterion: "reversing a route reverses the geometry AND
    // the elevation profile, and a test asserts total ascent and total descent
    // swap. A reversed route whose ascent did not change is a bug users will
    // notice on the first climb."
    const shape = line(1_200);
    // Up 60 m over the first half, down 20 m over the second.
    const climb = Array.from({ length: 41 }, (_, index) =>
      index <= 20 ? 100 + index * 3 : 160 - (index - 20) * 1,
    );
    const forward = elevationFrom(shape, profileOf(climb), INTERVAL);
    const backward = elevationFrom([...shape].reverse(), profileOf([...climb].reverse()), INTERVAL);
    expect(forward?.profile.totalAscent).toBeGreaterThan(0);
    expect(forward?.profile.totalDescent).toBeGreaterThan(0);
    // ⚠️ A tenth of a metre rather than to the bit, and the reason is stated
    // because an exact-equality version of this test would be flaky rather than
    // strict: `routeProfile` stretches its 10 m grid to land its last sample on
    // the route's end, so reversing moves every interior sample by up to half a
    // step, and ascent is accumulated in runs over a 3 m threshold. Measured
    // difference on this fixture: 0.045 m out of 19.3 m.
    expect(swap(backward?.profile.totalAscent, forward?.profile.totalDescent)).toBeLessThan(0.1);
    expect(swap(backward?.profile.totalDescent, forward?.profile.totalAscent)).toBeLessThan(0.1);
  });
});

function swap(left: number | undefined, right: number | undefined): number {
  return Math.abs((left ?? Number.NaN) - (right ?? Number.NaN));
}

function drawn(count: number): RouteDraft {
  let draft = emptyDraft();
  for (let index = 0; index < count; index += 1) {
    draft = addWaypoint(
      draft,
      geographicPosition(degreesLatitude(51.5 + index * 0.005), degreesLongitude(-0.12)),
    ).draft;
  }
  return draft;
}
