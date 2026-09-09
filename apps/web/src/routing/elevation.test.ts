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

import { RoutingError } from '@onyourleft/domain';

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

describe('a height lands where the provider said it was', () => {
  it('places each height by its own distance rather than by its position in the array', () => {
    // ⚠️ `HeightSample.along` exists and was being thrown away. A provider that
    // omits one sample used to shift every later height along the route; now
    // the hole appears where the hole actually is.
    const shape = line(300);
    const missingMiddle: HeightProfile = {
      source: GLO30,
      samples: [0, 1, 2, 4, 5, 6, 7, 8, 9, 10].map((step) => ({
        along: metres(step * ELEVATION_INTERVAL_METRES),
        elevation: altitudeMetres(100),
      })),
    };
    const planned = elevationFrom(shape, missingMiddle, INTERVAL);
    expect(planned?.coverage.gaps).toStrictEqual([{ from: 90, to: 120 }]);
  });

  it('drops a sample that does not sit on the grid rather than snapping it', () => {
    // Moving a height to a distance the source did not report it at is
    // inventing terrain, on the series ascent is summed over. One on-grid
    // height keeps this about the dropping rather than about the empty case
    // below.
    const shape = line(300);
    const offGrid: HeightProfile = {
      source: GLO30,
      samples: [
        { along: metres(0), elevation: altitudeMetres(100) },
        { along: metres(17), elevation: altitudeMetres(100) },
      ],
    };
    const planned = elevationFrom(shape, offGrid, INTERVAL);
    // The 17 m sample landed nowhere, so everything past the start is a hole.
    expect(planned?.coverage.gaps).toStrictEqual([{ from: 30, to: 300 }]);
  });

  it('refuses a route the dataset has no height for anywhere, in words', () => {
    // ⚠️ Reachable rather than theoretical: ADR 0010 D-5 records that the DEM
    // withholds some country tiles and has none over ocean. `routeProfile`
    // raises `RouteError('no-elevation')` for it — correctly — and letting that
    // escape put a domain error's wording in front of a rider.
    const shape = line(300);
    let thrown: unknown;
    try {
      elevationFrom(shape, profileOf(Array<undefined>(11).fill(undefined)), INTERVAL);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RoutingError);
    expect((thrown as RoutingError).message).toContain('no height anywhere along this route');
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
    // ⚠️ **60 m, not 90.** Two missing samples span ONE interval on each side
    // of the readings that bound them — N missing samples span N+1 intervals
    // between known heights, and the old count of one interval per missing
    // sample over-reported every hole and could claim more missing than the
    // route is long, in the sentence a rider reads. The gap is `to - from`.
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
    // ⚠️ **60, not 90.** A gap at the END is the one place the per-sample count
    // and the gap sum disagree: three missing samples, but the last of them IS
    // the route's end, so there are two intervals of route beyond the last
    // known height and not three. This assertion is what makes the fix
    // load-bearing — an interior-gap fixture agrees with the old arithmetic.
    expect(planned?.coverage.missing).toBe(60);
  });

  it('never claims more missing than the route is long', () => {
    // A 120 m route is five samples on this grid. With only the first height
    // known, the unbacked ground runs 30 m → 120 m, so 90 — the reading at 0 m
    // anchors the start. Counting one interval per missing sample gives 120,
    // the whole route, for a route that has a measured height on it.
    //
    // ⚠️ The review's own example — *every* height missing, reporting 150 m on
    // a 120 m route — is no longer reachable through this function at all: a
    // route the dataset has nothing for now raises a `RoutingError` before any
    // arithmetic, which the test above pins. The bound is asserted here anyway,
    // because it is the property that must hold rather than the one path that
    // once broke it.
    const shape = line(120);
    const planned = elevationFrom(
      shape,
      profileOf([10, undefined, undefined, undefined, undefined]),
      INTERVAL,
    );
    expect(planned?.coverage.missing).toBe(90);
    expect(planned?.coverage.missing).toBeLessThanOrEqual(planned?.profile.totalDistance ?? 0);
  });

  it('never reports more missing than the route is long', () => {
    // The bound review's off-by-one broke: a 300 m route missing nine of its
    // eleven heights used to report 270 m missing on a 300 m route, and a
    // longer hole could exceed the route outright.
    const shape = line(300);
    const heights = [10, ...Array<undefined>(9).fill(undefined), 20];
    const planned = elevationFrom(shape, profileOf(heights), INTERVAL);
    // 270, not 300: the gap runs from the first sample with no height (30 m) to
    // the first that has one again (300 m). `coverageOf` states the choice.
    expect(planned?.coverage.missing).toBe(270);
    expect(planned?.coverage.missing).toBeLessThanOrEqual(planned?.profile.totalDistance ?? 0);
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
  it('takes the routed legs from the start', async () => {
    const provider = scriptedProvider();
    let draft = drawn(4);
    draft = await resolveDraft(draft, [0, 1], provider, RIDING_DEFAULTS);
    // Two legs of eight scripted vertices, meeting at a shared waypoint.
    expect(plannedShape(draft)).toHaveLength(15);
  });

  it('stops at the first leg with no geometry rather than skipping it', async () => {
    // ⚠️ **The case that makes the stop load-bearing**: a routed leg AFTER an
    // unrouted one. Skipping the hole and carrying on would join two ends that
    // are not connected — a straight line drawn across the gap, then measured
    // as ridden distance and sampled for elevation as if it were road. A test
    // that only left the LAST leg unrouted cannot tell `break` from `continue`,
    // and this one was green under both until it was written this way.
    const provider = scriptedProvider();
    let draft = drawn(4);
    draft = await resolveDraft(draft, [0, 2], provider, RIDING_DEFAULTS);
    expect(draft.legs.map((leg) => leg.state)).toStrictEqual(['routed', 'pending', 'routed']);
    // Leg 0 alone: eight vertices, and nothing from leg 2 across the hole.
    expect(plannedShape(draft)).toHaveLength(8);
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

  it('hands the provider the resampled grid, not the raw geometry', async () => {
    // ⚠️ **Found by review.** This used to send the raw shape while
    // `elevationFrom` resampled independently and matched heights to positions
    // by array index — so two resamplings that disagreed by one sample gave a
    // silently shifted profile, and `resampleShape`'s own comment claiming the
    // provider got the grid it answers on was simply untrue.
    const provider = scriptedProvider();
    const draft = await resolveDraft(drawn(3), [0, 1], provider, RIDING_DEFAULTS);
    await planElevation(draft, provider);
    const asked = provider.heightCalls[0]?.shape ?? [];
    expect(asked).toStrictEqual(resampleShape(plannedShape(draft), INTERVAL));
    expect(asked.length).not.toBe(plannedShape(draft).length);
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
