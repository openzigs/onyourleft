// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the scenery goes — #243.
 *
 * ⚠️ **These assertions are about properties, not about coordinates.** A test
 * that pinned an item to a literal `x` would go red the moment a weight moved
 * and would say nothing about the two claims #243 actually makes: that the
 * world is a function of the route, and that it is the *same* function every
 * time. So what is asserted here is determinism, independence of call order,
 * that each of the three named places reads as a different place, that the seam
 * of a loop is invisible, that nothing stands in the carriageway, and that the
 * budget thins rather than truncates.
 *
 * Two of the assertions read `scatter.ts`'s own **source**, which is unusual and
 * deliberate: #243's second and seventh criteria are about what the file may
 * *contain* — no clock, no `three` — and both are the kind of rule that a
 * reviewer enforces once and then stops enforcing. `three-seam.test.ts` makes
 * the same argument at repository scale.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type GeographicPosition,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import {
  DEGENERATE_TANGENT_METRES,
  MINIMUM_SCATTER_SEPARATION_METRES,
  SCATTER_KINDS,
  SCATTER_MAX_ITEMS,
  SCATTER_VERGE_METRES,
  SLOTS_PER_CELL_SIDE,
  SCATTER_SCALE_HIGHEST,
  SCATTER_SCALE_LOWEST,
  cellSpanMetres,
  scatterAt,
  scatterSeed,
  type ScatterBudget,
  type ScatterItem,
  type ScatterKind,
} from './scatter';
import { ROAD_WIDTH_METRES, corridorOrigin, roadCorridor } from './terrain';

/** Large enough that the budget never binds, so placement is what is measured. */
const UNBOUNDED: ScatterBudget = { maxItems: 100_000, riderMetres: 0 };

/**
 * A route running due east at one latitude, altitude and gradient.
 *
 * ⚠️ It runs **east** for the reason `world.test.ts`'s fixture does — every
 * point carries exactly the latitude asked for — and with one further payoff
 * here: the projection makes local `x` equal to route distance, so an assertion
 * about *where along the road* an item is can be written about `x` without
 * `ScatterItem` having to carry a route distance it has no other use for.
 */
function eastRoute(options: {
  readonly latitude: number;
  readonly altitude: number;
  readonly gradePercent?: number;
  readonly points?: number;
}): RouteProfile {
  const count = options.points ?? 200;
  const metresPerDegreeLongitude = 111_320 * Math.cos((options.latitude * Math.PI) / 180);
  const points: RoutePoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(options.latitude),
        degreesLongitude((index * 10) / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(
        options.altitude + ((options.gradePercent ?? 0) / 100) * index * 10,
      ),
    });
  }
  return routeProfile(points);
}

/** A circular loop of a given radius, which is a route that bends everywhere. */
function circuit(radiusMetres: number, latitude = 45): RouteProfile {
  const metresPerDegreeLongitude = 111_320 * Math.cos((latitude * Math.PI) / 180);
  const steps = Math.max(24, Math.round((2 * Math.PI * radiusMetres) / 10));
  const points: RoutePoint[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push({
      position: geographicPosition(
        degreesLatitude(latitude + (radiusMetres * Math.sin(angle)) / 111_320),
        degreesLongitude((radiusMetres * (Math.cos(angle) - 1)) / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(0),
    });
  }
  points.push(points[0] as RoutePoint);
  return routeProfile(points, { loop: true });
}

/** Everything a call to {@link scatterAt} needs but the span. */
function place(
  profile: RouteProfile,
  from: number,
  to: number,
  budget: ScatterBudget = UNBOUNDED,
): readonly ScatterItem[] {
  return scatterAt(profile, corridorOrigin(profile), scatterSeed(profile), from, to, budget);
}

/** How many of each kind, so a "dominant kind" can be named. */
function dominantKind(items: readonly ScatterItem[]): ScatterKind {
  const tally = new Map<ScatterKind, number>();
  for (const item of items) {
    tally.set(item.kind, (tally.get(item.kind) ?? 0) + 1);
  }
  let best: ScatterKind = 'rock';
  let most = -1;
  for (const kind of SCATTER_KINDS) {
    const count = tally.get(kind) ?? 0;
    if (count > most) {
      most = count;
      best = kind;
    }
  }
  return best;
}

/** The smallest distance from any item to any other, on the ground plane. */
function closestPair(items: readonly ScatterItem[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      const one = items[first] as ScatterItem;
      const other = items[second] as ScatterItem;
      closest = Math.min(closest, Math.hypot(one.x - other.x, one.z - other.z));
    }
  }
  return closest;
}

/** The source of the module under test, read from disk. */
function scatterSource(): string {
  return readFileSync(fileURLToPath(new URL('./scatter.ts', import.meta.url)), 'utf8');
}

describe('the seed is the route', () => {
  it('gives the same route the same seed every time it is built', () => {
    // #240 FR-3 at its root: two imports of one ride are one world. Rebuilding
    // the profile from the same points is the closest a unit test gets to a
    // fresh module in a fresh tab.
    expect(scatterSeed(eastRoute({ latitude: 45, altitude: 0 }))).toBe(
      scatterSeed(eastRoute({ latitude: 45, altitude: 0 })),
    );
  });

  it('gives a route that starts somewhere else a different seed', () => {
    expect(scatterSeed(eastRoute({ latitude: 45, altitude: 0 }))).not.toBe(
      scatterSeed(eastRoute({ latitude: 46, altitude: 0 })),
    );
  });

  it('gives a route of a different length a different seed', () => {
    // Same first coordinate, different route. A seed that read the coordinate
    // alone would give every ride out of one town the same world.
    expect(scatterSeed(eastRoute({ latitude: 45, altitude: 0, points: 200 }))).not.toBe(
      scatterSeed(eastRoute({ latitude: 45, altitude: 0, points: 400 })),
    );
  });
});

describe('placement is a stateless hash of where you are', () => {
  const profile = eastRoute({ latitude: 45, altitude: 0 });

  it('answers the same span with the same items twice', () => {
    expect(place(profile, 0, 400)).toEqual(place(profile, 0, 400));
  });

  it('answers a span the same way however it was reached', () => {
    // ⚠️ **The criterion that catches accumulated-state placement**, whose
    // symptom is scenery that shifts on lap two of a loop and on every rejoin
    // after a pause. A generator that walked forward would answer [200, 400)
    // differently depending on whether [0, 200) had been asked for first.
    //
    // The budget is deliberately not binding here: the budget is applied per
    // call, so two half-span calls are budgeted twice, and that is about
    // thinning rather than about placement. @see scatter.ts §thin
    const whole = place(profile, 0, 400);
    const halves = [...place(profile, 0, 200), ...place(profile, 200, 400)];

    expect(halves).toEqual(whole);
  });

  it('reaches nothing that could give two rides two worlds', () => {
    // #243's second criterion, in its literal form. A comment saying
    // "deterministic" is not a check; this is.
    expect(scatterSource()).not.toMatch(
      /Math\s*\.\s*random|Date\s*\.\s*now|new\s+Date|performance\s*\./,
    );
  });

  it('gives every item a finite position, rotation and scale', () => {
    for (const item of place(profile, 0, 460)) {
      expect(Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z)).toBe(
        true,
      );
      expect(item.rotation).toBeGreaterThanOrEqual(0);
      expect(item.rotation).toBeLessThan(Math.PI * 2);
      expect(item.scale).toBeGreaterThanOrEqual(SCATTER_SCALE_LOWEST);
      expect(item.scale).toBeLessThanOrEqual(SCATTER_SCALE_HIGHEST);
    }
  });
});

describe('the rendering seam holds for this file too', () => {
  it('imports nothing from three, including three/addons', () => {
    // #243's seventh criterion. `three-seam.test.ts` already asserts this over
    // the whole repository; this one names the file, so a violation here says
    // which file rather than only that there are two.
    expect(scatterSource()).not.toMatch(/\b(?:from|import|require\()\s*['"]three(?:\/[^'"]*)?['"]/);
  });
});

describe('the kind comes from the geography', () => {
  // One latitude for all three, so the only thing that differs between them is
  // the thing being named. At 45° the local tree line is a little under 1 400 m.
  const latitude = 45;

  it('reads a valley floor, the ground above the trees and a steep pitch as three different places', () => {
    const valley = place(eastRoute({ latitude, altitude: 0 }), 0, 460);
    const alpine = place(eastRoute({ latitude, altitude: 1800 }), 0, 460);
    const pitch = place(eastRoute({ latitude, altitude: 0, gradePercent: 12 }), 0, 460);

    const dominant = [dominantKind(valley), dominantKind(alpine), dominantKind(pitch)];

    expect(dominant).toEqual(['tree-conifer', 'rock', 'shrub']);
    expect(new Set(dominant).size).toBe(3);
  });

  it('puts less beside the road where less grows', () => {
    // The geography decides *how much* as well as *what*, and the two are
    // separate decisions: a pitch is cleared and only partly regrown, and above
    // the trees there is very little of anything. Without this, a placement that
    // filled every slot everywhere would still produce the right kinds in the
    // right places and would draw a dense forest on a scree slope.
    const valley = place(eastRoute({ latitude, altitude: 0 }), 0, 460).length;
    const pitch = place(eastRoute({ latitude, altitude: 0, gradePercent: 12 }), 0, 460).length;
    const alpine = place(eastRoute({ latitude, altitude: 1800 }), 0, 460).length;

    expect(alpine).toBeLessThan(pitch);
    expect(pitch).toBeLessThan(valley);
  });

  it('produces every kind it declares', () => {
    // A kind no profile can produce is dead code the renderer would carry a
    // mesh for. The list is derived from SCATTER_KINDS rather than written out,
    // so a seventh kind added without a place to put it fails this.
    const everywhere = new Set<ScatterKind>();
    for (const profile of [
      eastRoute({ latitude: 5, altitude: 0 }), // broadleaf, and a valley floor to build on
      eastRoute({ latitude: 55, altitude: 0 }), // conifer
      eastRoute({ latitude, altitude: 1800 }), // rock and shrub above the trees
      circuit(40), // a bend tight enough to be posted
    ]) {
      for (const item of place(profile, 0, Math.min(460, profile.totalDistance))) {
        everywhere.add(item.kind);
      }
    }

    expect([...everywhere].sort()).toEqual([...SCATTER_KINDS].sort());
  });
});

describe('the loop seam', () => {
  const profile = circuit(600);
  const total = profile.totalDistance;

  it('places the same world either side of it', () => {
    // On a loop, `totalDistance ± 200` and `0 ± 200` are the same places, so a
    // seam that doubled up or left a gap would make these two disagree. This is
    // a stronger statement than "no duplicates": it says the seam is not there.
    const across = [...place(profile, total - 200, total + 200)];
    const equivalent = [...place(profile, -200, 200)];
    const order = (one: ScatterItem, other: ScatterItem): number =>
      one.x - other.x || one.z - other.z;

    expect(across.sort(order)).toEqual(equivalent.sort(order));
  });

  it('leaves no bare gap where the lap closes', () => {
    const before = place(profile, total - 50, total);
    const after = place(profile, total, total + 50);

    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    // The two halves are exactly the whole: nothing is lost at the join and
    // nothing is counted twice.
    expect([...before, ...after]).toEqual(place(profile, total - 50, total + 50));
  });

  it('never puts two things in the same place', () => {
    // #243's fourth criterion, with the tolerance stated rather than implied.
    // @see MINIMUM_SCATTER_SEPARATION_METRES for where the bound comes from.
    expect(closestPair(place(profile, total - 200, total + 200))).toBeGreaterThan(
      MINIMUM_SCATTER_SEPARATION_METRES,
    );
  });

  it('does not place a short lap twice when the view is longer than the loop', () => {
    // A 250 m circuit inside a 460 m view: the span reaches every cell twice.
    // Drawing it twice would be the doubling the seam criterion is about, and
    // it is the case a straight route cannot reach at all.
    const shortLap = circuit(40);
    const items = place(shortLap, 0, 460);

    expect(shortLap.totalDistance).toBeLessThan(460);
    expect(closestPair(items)).toBeGreaterThan(MINIMUM_SCATTER_SEPARATION_METRES);
    expect(items).toEqual(place(shortLap, 0, shortLap.totalDistance));
  });
});

describe('nothing is placed on the road', () => {
  it.each([
    ['a straight road', eastRoute({ latitude: 45, altitude: 0 })],
    ['a road that bends the whole way round', circuit(80)],
  ])('keeps every item off the carriageway on %s', (_name, profile) => {
    const origin = corridorOrigin(profile);
    const span = Math.min(400, profile.totalDistance);
    const items = scatterAt(profile, origin, scatterSeed(profile), 0, span, UNBOUNDED);
    // The corridor the renderer actually draws, so "the centreline" is the one
    // the road is built along rather than one this test computed for itself.
    const corridor = roadCorridor(profile, origin, span / 2, {
      aheadMetres: span,
      behindMetres: span,
    });

    let nearest = Number.POSITIVE_INFINITY;
    for (const item of items) {
      for (const point of corridor.centre) {
        nearest = Math.min(nearest, Math.hypot(item.x - point.x, item.z - point.z));
      }
    }

    expect(items.length).toBeGreaterThan(0);
    expect(nearest).toBeGreaterThan(ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES);
  });
});

describe('the budget', () => {
  // Sea level at a temperate latitude: the geography argues for dense forest,
  // which is what makes the budget bind at all.
  const profile = eastRoute({ latitude: 45, altitude: 0 });
  const span = 460;

  it('is the only thing that bounds the count', () => {
    const unbounded = place(profile, 0, span);

    expect(unbounded.length).toBeGreaterThan(SCATTER_MAX_ITEMS);
  });

  it('is never exceeded', () => {
    const bounded = place(profile, 0, span, { maxItems: SCATTER_MAX_ITEMS, riderMetres: 60 });

    expect(bounded.length).toBe(SCATTER_MAX_ITEMS);
  });

  it('thins the far view rather than truncating it', () => {
    // ⚠️ #243's sixth criterion, and the assertion that goes red for
    // `found.slice(0, maxItems)`: taking the first N in cell order keeps
    // everything behind the rider and stops dead at whatever distance the
    // budget ran out, which reads as a wall across the road. On this fixture
    // `x` is the route distance, so the far end of the view is simply large `x`.
    const unbounded = place(profile, 0, span);
    const bounded = place(profile, 0, span, { maxItems: SCATTER_MAX_ITEMS, riderMetres: 60 });
    const furthest = (items: readonly ScatterItem[]): number =>
      items.reduce((widest, item) => Math.max(widest, item.x), 0);

    expect(furthest(bounded)).toBeGreaterThan(furthest(unbounded) - 20);
    expect(bounded.filter((item) => item.x > span * 0.75).length).toBeGreaterThan(10);
  });

  it('draws nothing at all when there is no budget to draw with', () => {
    expect(place(profile, 0, span, { maxItems: 0, riderMetres: 60 })).toEqual([]);
  });

  it('draws nothing rather than everything when the budget is nonsense', () => {
    // ⚠️ `Array.prototype.slice` reads a negative end as an offset from the
    // end, so an unclamped budget of −1 returns every item but the last. A
    // caller asking for no scenery and getting three hundred pieces of it is
    // the opposite of a budget.
    expect(place(profile, 0, span, { maxItems: -1, riderMetres: 60 })).toEqual([]);
  });
});

describe('a degenerate profile does not stop the ride', () => {
  it('survives a two-point route', () => {
    const profile = eastRoute({ latitude: 45, altitude: 0, points: 1 });

    expect(() => place(profile, 0, 460)).not.toThrow();
    expect(place(profile, 0, 460).length).toBeLessThan(SCATTER_MAX_ITEMS);
  });

  it('survives a route with no relief at all', () => {
    const profile = eastRoute({ latitude: 45, altitude: 0 });

    expect(new Set(profile.elevations).size).toBe(1);
    expect(place(profile, 0, 460).length).toBeGreaterThan(0);
  });

  it('never sees a route with no length, because the profile refuses one', () => {
    // ⚠️ This is what `scatter.ts` rests on when it carries no guard for a cell
    // span of zero. If this ever stops throwing, the division in
    // `cellSpanMetres` starts producing `Infinity` cell indices and the loop
    // that walks them does not terminate — so the assertion belongs here,
    // against the function that actually makes the promise.
    const here = geographicPosition(degreesLatitude(45), degreesLongitude(0));

    expect(() =>
      routeProfile([
        { position: here, elevation: altitudeMetres(0) },
        { position: here, elevation: altitudeMetres(0) },
      ]),
    ).toThrow(/no length/);
    expect(cellSpanMetres(eastRoute({ latitude: 45, altitude: 0 }))).toBeGreaterThan(0);
  });

  it('draws nothing for a span of no length', () => {
    const profile = eastRoute({ latitude: 45, altitude: 0 });

    expect(place(profile, 200, 200)).toEqual([]);
    expect(place(profile, 200, 100)).toEqual([]);
  });

  it.each([true, false])(
    'does not let a few centimetres of route cost a frame (loop: %s)',
    (loop) => {
      // ⚠️ **A `RouteProfile` is built from a file the rider supplied**, and
      // `SECURITY.md` puts resource exhaustion from a parsed activity file in
      // scope. A route half a metre long has a cell span to match, so a walk
      // over the 460 m the corridor covers is nearly a thousand cells — every
      // frame, on the thread GATT notifications arrive on. The route's own cell
      // count is what bounds it.
      const metresPerDegreeLongitude = 111_320 * Math.cos((45 * Math.PI) / 180);
      const tiny = routeProfile(
        [0, 0.5].map((offset) => ({
          position: geographicPosition(
            degreesLatitude(45),
            degreesLongitude(offset / metresPerDegreeLongitude),
          ),
          elevation: altitudeMetres(0),
        })),
        { loop },
      );

      expect(tiny.totalDistance).toBeLessThan(1);
      expect(place(tiny, -60, 400).length).toBeLessThanOrEqual(SLOTS_PER_CELL_SIDE * 2);
    },
  );

  it('stops at the end of a route that does not loop', () => {
    // A point-to-point route has no terrain past its end, the same reason
    // `distanceOnRoute` clamps rather than extrapolating. Asking beyond it is
    // an empty answer and not an extrapolated one.
    const profile = eastRoute({ latitude: 45, altitude: 0 });

    expect(place(profile, profile.totalDistance + 100, profile.totalDistance + 500)).toEqual([]);
    expect(place(profile, -500, -100)).toEqual([]);
  });

  it('places scenery at the very end of a road that stops', () => {
    // ⚠️ **The one place the road ahead is not there to be measured.** At the
    // last grid point of a point-to-point route `distanceOnRoute` clamps the
    // forward sample onto the point itself, so the forward difference is
    // exactly zero — the same lookup twice, not two lookups that nearly agree —
    // and the direction has to come from the road behind instead. Without that
    // fallback this is `0 / 0`, and a NaN coordinate reaches a vertex buffer.
    const profile = eastRoute({ latitude: 45, altitude: 0 });
    const items = place(profile, profile.totalDistance - 20, profile.totalDistance);

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Number.isFinite(item.x) && Number.isFinite(item.z)).toBe(true);
    }
    // And the fallback is a real road direction rather than a compass point, so
    // the verge still holds where it is used.
    expect(Math.min(...items.map((item) => Math.abs(item.z)))).toBeGreaterThan(
      ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES,
    );
  });

  it('survives a road that doubles back on itself', () => {
    // ⚠️ **An out-and-back's turning point has the road before it and the road
    // after it in the same place**, which is why `normalAt` takes a forward
    // difference rather than a centred one: a centred difference here measures
    // the distance between two coordinates that *are* the same point and comes
    // back with floating-point noise, which normalises into an arbitrary
    // bearing and puts the scenery across the carriageway.
    //
    // The fixture is built so that the turn lands **exactly on a grid point**:
    // 200 m out and 200 m back is 400 m at a 10 m grid, so the apex is grid
    // index 20 and the samples either side of it are indices 19 and 21. A turn
    // between grid points would leave a small tangent instead of none and this
    // would pass without ever reaching the case it is named for.
    const metresPerDegreeLongitude = 111_320 * Math.cos((45 * Math.PI) / 180);
    const outAndBack = [
      ...Array.from({ length: 21 }, (_unused, at) => at),
      ...Array.from({ length: 20 }, (_unused, at) => 19 - at),
    ];
    const profile = routeProfile(
      outAndBack.map((index) => ({
        position: geographicPosition(
          degreesLatitude(45),
          degreesLongitude((index * 10) / metresPerDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      })),
    );

    // ⚠️ The assertion that says the fixture reaches the case it is named for.
    // Without it this test passes against a route that merely bends sharply,
    // and the degenerate branch is never executed at all. The two grid points
    // either side of the apex are the same place reached by two different sums
    // of the same floats, which is why this is a bound and not an equality —
    // and is exactly why `DEGENERATE_TANGENT_METRES` is not zero.
    const apex = (profile.positions.length - 1) / 2;
    const before = profile.positions[apex - 1] as GeographicPosition;
    const after = profile.positions[apex + 1] as GeographicPosition;
    expect(Math.abs(before.longitude - after.longitude) * 111_320).toBeLessThan(
      DEGENERATE_TANGENT_METRES,
    );

    const items = place(profile, 0, profile.totalDistance);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Number.isFinite(item.x) && Number.isFinite(item.z)).toBe(true);
    }
  });
});
