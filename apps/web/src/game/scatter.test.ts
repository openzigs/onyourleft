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
  positionAt,
  routeProfile,
  type GeographicPosition,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import {
  CLUSTER_SPAN_METRES,
  DEGENERATE_TANGENT_METRES,
  MINIMUM_SCATTER_SEPARATION_METRES,
  SCATTER_KINDS,
  SCATTER_MAX_ITEMS,
  SCATTER_VERGE_METRES,
  SCATTER_BANDS_PER_SIDE,
  SCATTER_SCALE_HIGHEST,
  SCATTER_SCALE_LOWEST,
  cellSpanMetres,
  scatterAt,
  scatterSeed,
  type ScatterBudget,
  type ScatterItem,
  type ScatterKind,
} from './scatter';
import { ROAD_WIDTH_METRES, corridorOrigin, localGroundPosition, roadCorridor } from './terrain';

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

/**
 * Where along `profile` a window of `span` metres carries the most scenery.
 *
 * ⚠️ **#348 is why this exists.** Before it, the geography was the only thing
 * deciding how much was placed, so every stretch of one route at one altitude
 * carried the same amount and the first window was as good as any. The
 * clustering makes that false by design: on this fixture a 460 m window holds
 * anywhere between about a dozen items and rather more than the budget, and
 * which one you get depends on where you start.
 */
function plantedStretch(profile: RouteProfile, span: number): number {
  let best = 0;
  let most = -1;
  for (let at = 0; at + span <= profile.totalDistance; at += 20) {
    const here = place(profile, at, at + span).length;
    if (here > most) {
      most = here;
      best = at;
    }
  }
  return best;
}

/**
 * Where the centre of {@link circuit}'s turn is, in the same local frame the
 * items are placed in.
 *
 * ⚠️ **Computed from the fixture's own definition rather than measured off the
 * corridor**, which is what makes the bend assertions independent of the code
 * under test: the distance from a point to a circle is `| |P − C| − R |`, and
 * both `C` and `R` are numbers this file chose. The alternative — walking the
 * sampled centreline and taking the nearest vertex — overstates the distance by
 * up to the sagitta of a ten-metre chord, which on a 10 m radius is nearly a
 * metre and is exactly the scale being asserted.
 */
function circuitCentre(
  radiusMetres: number,
  profile: RouteProfile,
  latitude = 45,
): { readonly x: number; readonly z: number } {
  const metresPerDegreeLongitude = 111_320 * Math.cos((latitude * Math.PI) / 180);
  return localGroundPosition(
    corridorOrigin(profile),
    geographicPosition(
      degreesLatitude(latitude),
      degreesLongitude(-radiusMetres / metresPerDegreeLongitude),
    ),
  );
}

/**
 * The route distance an `x` on {@link eastRoute} stands at.
 *
 * ⚠️ **`x` is *proportional* to route distance on that fixture, not equal to
 * it**, and the difference matters here where it does not elsewhere. Route
 * distance is summed along the geodesic and `localGroundPosition` projects
 * equirectangularly, so the two differ by a constant factor of about one part
 * in a thousand — half a metre by 400 m, three by two kilometres. That is far
 * inside a band and far outside the 3 m margin a cell keeps at each end, so an
 * assertion about *where in its cell* something stands has to divide it out or
 * it is measuring the projection instead.
 */
function routeDistanceOf(profile: RouteProfile, x: number): number {
  const end = localGroundPosition(
    corridorOrigin(profile),
    positionAt(profile, profile.totalDistance),
  );
  return (x * profile.totalDistance) / end.x;
}

/** Pearson's r, for saying that two of an item's properties are unrelated. */
function correlation(pairs: readonly (readonly [number, number])[]): number {
  const count = pairs.length;
  const meanOf = (at: 0 | 1): number => pairs.reduce((total, pair) => total + pair[at], 0) / count;
  const meanFirst = meanOf(0);
  const meanSecond = meanOf(1);
  let covariance = 0;
  let firstSpread = 0;
  let secondSpread = 0;
  for (const [first, second] of pairs) {
    covariance += (first - meanFirst) * (second - meanSecond);
    firstSpread += (first - meanFirst) ** 2;
    secondSpread += (second - meanSecond) ** 2;
  }
  return covariance / Math.sqrt(firstSpread * secondSpread);
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
    //
    // ⚠️ **Compared as a SET since #351, and the ordered version of this was
    // green by luck.** `scatterAt` emits cell by cell and, within a cell, band
    // by band — and a band's position along its cell is now drawn from a stream
    // of its own, so one cell's items are not in order along the road. When the
    // split at 200 m falls *inside* a cell, the whole call interleaves that
    // cell's near and far items where the two half-calls separate them: the
    // same items, a different order. The split only ever fell on a cell
    // boundary because the fixture is 2 000 m and the nominal cell was 20 m;
    // at 12 m the span is 11.98 m and it does not. The property #243 states is
    // that two adjacent queries **partition** the world, which is about which
    // items come back and not about the order an array happens to carry.
    const key = (item: ScatterItem): string =>
      `${item.kind} ${item.x.toFixed(6)} ${item.y.toFixed(6)} ${item.z.toFixed(6)}`;
    const whole = place(profile, 0, 400).map(key).sort();
    const halves = [...place(profile, 0, 200), ...place(profile, 200, 400)].map(key).sort();

    // Non-vacuity: two empty arrays are equal as sets.
    expect(whole.length).toBeGreaterThan(100);
    expect(new Set(whole).size).toBe(whole.length);
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

/**
 * #348 — the scenery read as a continuous village, and what was done about it.
 *
 * ⚠️ **Every assertion here is written against a distance or a shape, never
 * against the constant it is computed from.** `SCATTER_VERGE_METRES` moving
 * back to 1.5 m is the defect this issue was filed for, and an assertion
 * spelled `ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES` follows it there in
 * silence. The numbers below are the issue's own requirements, and they are
 * what go red if somebody tunes the constants back.
 */
describe('the scenery is not a hedge — #348', () => {
  // Six kilometres, so the clustering is measured over many stretches rather
  // than over whichever one the start line happens to be in.
  const profile = eastRoute({ latitude: 45, altitude: 0, points: 600 });
  const sweep = place(profile, 0, 2000);
  const lateral = sweep.map((item) => Math.abs(item.z)).sort((one, other) => one - other);

  it('places enough to measure, so nothing below is green over an empty world', () => {
    expect(sweep.length).toBeGreaterThan(400);
    // ⚠️ 20 m until #351, which brought the grid back to 12 m. @see
    // SCATTER_CELL_METRES — the cell is what sets the density of the
    // foreground, and doubling it is what emptied it.
    expect(cellSpanMetres(profile)).toBeCloseTo(12, 1);
  });

  it('leaves open ground between the road and the nearest thing standing on it', () => {
    // #348's first bullet: *"1.5 m is a hedge, not a verge. A rider should see
    // open ground before the trees start."* Five metres from the centreline is
    // what that produced; nine is the floor this issue asks for.
    expect(lateral[0] as number).toBeGreaterThan(9);
  });

  it('stands things at many different removes rather than all at one', () => {
    // #348's second bullet. Sixteen metres shared between four depths put the
    // middle half of everything inside a 9 m spread and almost nothing beyond
    // 20 m, which is what made the scenery read as a wall at a fixed distance.
    //
    // ⚠️ **The two figures moved for #351 and the claim did not.** That issue
    // narrowed the band from 35 m to 25 m, because 35 m put the median item
    // 27 m from the centreline — the far field — and the bound has to follow
    // the band or it pins a number the change was filed to move. What it still
    // excludes is the shape it was written against: measured, the pre-#348
    // arrangement has an interquartile spread of 8.9 m and reaches 19.3 m, so
    // both assertions go red on it with room to spare.
    const quarter = lateral[Math.floor(lateral.length * 0.25)] as number;
    const threeQuarters = lateral[Math.floor(lateral.length * 0.75)] as number;

    expect(threeQuarters - quarter).toBeGreaterThan(10);
    expect(lateral[lateral.length - 1] as number).toBeGreaterThan(30);
  });

  it('leaves whole stretches of road with nothing beside them', () => {
    // #348's third bullet — *"a stretch of open road between clusters is what
    // makes the clusters read as clusters"*. A hundred metres is about twelve
    // seconds of riding, and before this the geography alone decided density,
    // so a route at one altitude on one gradient carried the same amount of
    // scenery from end to end and no stretch was ever bare.
    const stretches: number[] = [];
    for (let at = 0; at + 100 <= 2000; at += 100) {
      stretches.push(place(profile, at, at + 100).length);
    }

    expect(Math.min(...stretches)).toBe(0);
    expect(Math.max(...stretches)).toBeGreaterThan(40);
  });

  it('never leaves a short route uniformly bare, however the clustering falls', () => {
    // ⚠️ **What a route shorter than two clustering spans nearly shipped as.**
    // The field is interpolated between hashed nodes, and a first draft rounded
    // the node count down to as few as one — at which point `(0 + 1) % 1` is
    // `0`, the field interpolates a value against itself, and a whole route
    // takes a single openness. Roughly a third of seeds then come out with
    // nothing beside the road from end to end, which is not a thinner world but
    // an empty one.
    //
    // Eight different short routes rather than one, because a single seed that
    // happened to land above the threshold would be green on exactly the bug
    // this is about.
    const shortRoutes = [40, 41, 42, 43, 44, 45, 46, 47].map((latitude) =>
      eastRoute({ latitude, altitude: 0, points: 20 }),
    );

    for (const short of shortRoutes) {
      expect(short.totalDistance).toBeLessThan(2 * CLUSTER_SPAN_METRES);
      expect(place(short, 0, short.totalDistance).length).toBeGreaterThan(0);
    }
  });

  it('puts a thing anywhere along its cell rather than at one of four stations', () => {
    // ⚠️ #348's fourth bullet, and the assertion that names the rhythm. An item
    // used to move within the middle half of one of four fixed sub-intervals,
    // so its position within a cell fell in `[0.06, 0.19] ∪ [0.31, 0.44] ∪
    // [0.56, 0.69] ∪ [0.81, 0.94]` — four bands with three visible gaps between
    // them and nothing kept clear at the cell boundary. It now falls anywhere
    // in the middle 70 %, which is both a wider range and a *connected* one.
    //
    // Twenty bins rather than a range, because a range is satisfied by two
    // extremes with a hole between them — which is precisely the old shape.
    //
    // ⚠️ **Written against the shape rather than against the bin indices since
    // #351**, which moved `CELL_FILL` from 0.7 to 0.55 to pay for a smaller
    // cell. Bins 1 to 8 of ten were the occupied range at 0.7 and are not at
    // 0.55, so spelling them out pinned a constant instead of the property. The
    // three claims below are the property: the occupied stretch is **one run**
    // with no hole in it, it covers **half the cell or more**, and there is a
    // clear **margin in metres** at each end.
    const span = cellSpanMetres(profile);
    const bins = Array.from({ length: 20 }, () => 0);
    for (const item of sweep) {
      const along = routeDistanceOf(profile, item.x);
      const at = Math.floor(((((along % span) + span) % span) / span) * 20);
      bins[Math.min(19, at)] = (bins[Math.min(19, at)] as number) + 1;
    }

    const occupied = bins.map((count) => count > 0);
    const first = occupied.indexOf(true);
    const last = occupied.lastIndexOf(true);

    // ⚠️ **The connectedness is the assertion that excludes the old shape**,
    // and the width below is not: four stations spanning `[0.06, 0.94]` are
    // 0.88 of the cell wide and would pass a width test comfortably. What they
    // cannot do is fill the bins between them.
    expect(occupied.slice(first, last + 1).filter((full) => !full)).toEqual([]);
    // Wide as well as connected, so a fill that collapsed to a single bin in
    // the middle of the cell — a rhythm again, with a shorter period — is not
    // a pass.
    expect((last + 1 - first) / 20).toBeGreaterThan(0.5);

    // The margin at each end of the cell, which is what separates two items in
    // one band in adjacent cells. @see MINIMUM_SCATTER_SEPARATION_METRES: the
    // bend compression takes 60 % of it, so 5 m is the floor that keeps 2 m.
    // Measured off the items rather than off the bins, because a bin is 0.6 m
    // wide here and the margin is 2.7 m at each end.
    const fractions = sweep.map((item) => {
      const along = routeDistanceOf(profile, item.x);
      return (((along % span) + span) % span) / span;
    });
    const gap = (Math.min(...fractions) + (1 - Math.max(...fractions))) * span;

    expect(gap).toBeGreaterThan(5);
  });

  it('does not tie how deep a thing stands to where it stands along the road', () => {
    // ⚠️ **The rhythm #348 is really about.** A band used to be both a depth
    // and a position: band 0 was the nearest to the road *and* the first along
    // the cell, band 3 the furthest *and* the last, so every ten metres drew the
    // same receding staircase. The two are now drawn from streams of their own,
    // and that is a property of the arrangement rather than of the diff.
    const span = cellSpanMetres(profile);
    const pairs = sweep.map((item) => {
      const along = routeDistanceOf(profile, item.x);
      return [(((along % span) + span) % span) / span, Math.abs(item.z)] as const;
    });

    expect(Math.abs(correlation(pairs))).toBeLessThan(0.1);
  });
});

/**
 * #351 — #348's direction was right and its magnitude was not, and the world
 * came out as an empty plain.
 *
 * ⚠️ **This is the gate that did not exist**, and its absence is the whole
 * reason #348 could ship a reasonable set of changes and empty the world.
 * Every assertion the previous issue left behind is about the *shape* of the
 * arrangement — the verge, the spread of removes, the absence of a rhythm —
 * and an arrangement with almost nothing in it satisfies all of them. #348's
 * own criterion was *"judged by eye, on the device"*, and nobody looked after
 * the merge.
 *
 * ⚠️ **What is measured here is a PROXY and not the device.** It is how much
 * scenery stands in the part of the view a rider actually looks at — the
 * nearest 60 m of road, about seven seconds at 30 km/h — and how often that is
 * none at all. A number cannot say the world looks right. It can say the world
 * is not empty, which is the failure that got through.
 *
 * The frames are the ones `scene.ts` asks for: the corridor's own span behind
 * and ahead of the rider, at {@link SCATTER_MAX_ITEMS}. Asking `scatterAt` for
 * an unbounded span instead would measure a world no renderer is ever handed.
 */
describe('the scenery is not an empty plain — #351', () => {
  /**
   * Twelve kilometres of level valley floor: the densest thing a route can be.
   *
   * ⚠️ **Long enough that every frame below is inside it**, which a 6 km one is
   * not. A non-loop route is clamped to its own cells, so a frame past the end
   * is legitimately empty — and a ride that ran off the end would measure that
   * clamp instead of the density, at a 51-in-100 bare rate that looks exactly
   * like the defect. Found by writing it that way first.
   */
  const profile = eastRoute({ latitude: 45, altitude: 0, points: 1200 });

  interface Frame {
    /** Items standing in the nearest {@link NEAR_FIELD_METRES} of road. */
    readonly near: number;
    /** How many the placement offered before the budget was applied. */
    readonly supply: number;
  }

  /** How far ahead of the rider counts as the foreground. */
  const NEAR_FIELD_METRES = 60;
  /** What `terrain.ts` builds and `scene.ts` therefore asks for. */
  const VIEW_BEHIND = 60;
  const VIEW_AHEAD = 400;

  const ride = (): readonly Frame[] => {
    const frames: Frame[] = [];
    for (let step = 0; step < 100; step += 1) {
      const rider = 500 + step * 100;
      const budget: ScatterBudget = { maxItems: SCATTER_MAX_ITEMS, riderMetres: rider };
      const drawn = place(profile, rider - VIEW_BEHIND, rider + VIEW_AHEAD, budget);
      frames.push({
        near: drawn.filter((item) => {
          const along = routeDistanceOf(profile, item.x);
          return along >= rider && along < rider + NEAR_FIELD_METRES;
        }).length,
        supply: place(profile, rider - VIEW_BEHIND, rider + VIEW_AHEAD).length,
      });
    }
    return frames;
  };

  const frames = ride();

  it('keeps the foreground populated rather than putting everything on the horizon', () => {
    // ⚠️ **The measurement #351 was filed on.** With #348's constants this
    // averages **21.3** items in the nearest 60 m; before #348 it was 42.9,
    // which is the density the issue reports as "a continuous village". The
    // floor is set between the two and nearer the low end, because the fix for
    // an overcorrection is not the thing that was overcorrected from.
    const mean = frames.reduce((total, frame) => total + frame.near, 0) / frames.length;

    expect(mean).toBeGreaterThan(28);
  });

  it('leaves the near field empty only occasionally, not one ride in seven', () => {
    // ⚠️ **The literal "empty plain".** A frame with nothing at all in the
    // nearest 60 m is a rider looking at bare ground with a house on the
    // horizon. #348's clustering is *meant* to produce some of these — see
    // OPEN_GROUND_SHARE — and at its own values it produced 15 in 100, on top
    // of a world that was half as dense everywhere else.
    const bare = frames.filter((frame) => frame.near === 0).length;

    // Non-vacuity in the other direction: a world that never opens out at all
    // has lost what #348's third bullet asked for, and this is the assertion
    // that would go red if the clustering were simply deleted.
    expect(bare).toBeGreaterThan(0);
    expect(bare).toBeLessThan(10);
  });

  it('offers the budget more than it will take on most frames, so the thinning is live', () => {
    // ⚠️ **The quiet half of #348, and it is not in that issue's table.**
    // `thin` returns its input untouched when the supply is inside the budget,
    // so SCATTER_NEAR_BIAS — the whole of #243's sixth criterion — does nothing
    // at all below it. Measured with #348's constants, this ride supplied
    // **161.9** items a frame on average against a budget of 240 and
    // oversubscribed on **11** frames in 100: the near bias was doing nothing
    // on the other 89, and no test could tell.
    //
    // ⚠️ **Counted over the ride rather than taken at its busiest frame, and
    // the difference is the whole assertion.** #348's world still had a
    // 299-item frame in it — one stretch of valley floor at the top of the
    // clustering field — so a `max` comparison is green on the arrangement this
    // issue exists to replace. Measured: 62 frames in 100 oversubscribe now, 11
    // did then.
    const oversubscribed = frames.filter((frame) => frame.supply > SCATTER_MAX_ITEMS).length;

    expect(oversubscribed).toBeGreaterThan(40);
  });
});

/**
 * #348's second ⚠️ — *"making placement more random must not put one in the
 * road"* — and a defect older than the issue.
 *
 * An item is placed by the road's **local normal**, so on the inside of a bend
 * of radius `R` an offset of `d` stands `R − d` from the centre of the turn:
 * the band folds inward, and past `d = R` it comes out the far side. Measured
 * against the committed code before #348, a 10 m radius put scenery **1.0 m**
 * from the centreline and a 12 m radius put it 1.3 m — inside a 3.5 m
 * half-carriageway, on the one geometry a rider cannot avoid looking at.
 */
describe('a bend does not fold the scenery into the road — #348', () => {
  /** How far the nearest item stands from the road itself. */
  const nearestToTheRoad = (radiusMetres: number): number => {
    const profile = circuit(radiusMetres);
    const centre = circuitCentre(radiusMetres, profile);
    const items = place(profile, 0, profile.totalDistance);
    return items.reduce(
      (nearest, item) =>
        Math.min(
          nearest,
          Math.abs(Math.hypot(item.x - centre.x, item.z - centre.z) - radiusMetres),
        ),
      Number.POSITIVE_INFINITY,
    );
  };

  /** Every item a circuit of this radius carries. */
  const itemsOn = (radiusMetres: number): readonly ScatterItem[] => {
    const profile = circuit(radiusMetres);
    return place(profile, 0, profile.totalDistance);
  };

  // ⚠️ **Split in two, and the split is the whole of the assertion.** Every
  // radius under about 24 m is refused outright, so a single sweep across both
  // halves reads `Infinity` for the tight ones and passes over an empty set —
  // which is a case that stays green if a later change empties every radius
  // there is. Under the mutation that removes the bend cap entirely, 15 m was
  // the one radius of nine that did **not** go red for exactly that reason.
  // Each half now says which claim it is making.
  it.each([25, 40, 80, 200, 600])(
    'stands nothing inside the verge on a bend of %d m radius, and stands something',
    (radiusMetres) => {
      expect(itemsOn(radiusMetres).length).toBeGreaterThan(0);
      expect(nearestToTheRoad(radiusMetres)).toBeGreaterThan(9);
    },
  );

  /** Every radius in `[from, to)`, a quarter of a metre apart. */
  const radiiFrom = (from: number, to: number): readonly number[] => {
    const radii: number[] = [];
    for (let radiusMetres = from; radiusMetres < to; radiusMetres += 0.25) {
      radii.push(radiusMetres);
    }
    return radii;
  };

  // ⚠️ **Swept rather than sampled at four round radii, and that is the
  // difference between this assertion and a vacuous one.** A circuit of 15 m is
  // a 94 m loop, and the clustering can leave the whole of one bare on its own
  // — so a single radius asserted to be empty may be empty for a reason that
  // has nothing to do with the bend. Measured: with the cap removed altogether,
  // 10, 12 and 20 go red and **15 does not**. Over the whole range no such
  // accident can carry it, because the uncapped code plants somewhere in it.
  it('carries nothing at any radius too tight for the first band', () => {
    for (const radiusMetres of radiiFrom(9.75, 24)) {
      expect({ radiusMetres, items: itemsOn(radiusMetres) }).toEqual({ radiusMetres, items: [] });
    }
  });

  // ⚠️ **Below 9.55 m, and this is where the guard used to stop being
  // absolute.** @see AMBIGUOUS_TURN_RADIUS_METRES. `curvatureAt` wraps its turn
  // into `(-π, π]`, and a 30 m chord subtends more than π once the radius falls
  // under `30 / π`; the wrap then reported a *small* curvature, `bandsAt` read
  // the road as open, and every band was placed on a road folding hard.
  // Measured on this fixture before the chord reading was added: 4.75 m stood
  // three things, the nearest **5.00 m** from the centreline, and 5.25 m stood
  // thirteen with the nearest at **4.66 m** — outside the 3.5 m carriageway, so
  // #243's hard rule held, and well inside the 9.5 m verge #348 promises.
  //
  // The step is a quarter of a metre rather than a round metre because the
  // failure was not a band of radii: it was 4.00, 4.50, 4.75, 5.00, 5.25 and
  // 5.50 and nothing in between, since which multiple of the sampling step the
  // turn lands on is what decides whether the wrapped angle comes out small.
  it('carries nothing on a bend too tight for its own turn to be measured', () => {
    for (const radiusMetres of radiiFrom(1, 9.75)) {
      expect({ radiusMetres, items: itemsOn(radiusMetres) }).toEqual({ radiusMetres, items: [] });
    }
  });

  // ⚠️ **A `NaN` here is invisible rather than loud**, which is why it is
  // asserted over the sweep rather than left to the eye: `three-renderer.ts`
  // makes the same argument about a degenerate look-at — a `NaN` in a vertex
  // buffer draws a black screen, not a visible fault. Circuits of 1.25 m to
  // 2.25 m radius — loops of eight to fourteen metres, which is a broken import
  // rather than a road — emitted twelve such items at 2 m before the chord
  // reading refused them, and six on the code this issue started from.
  it('never emits a coordinate that is not a number, however short the loop', () => {
    for (let radiusMetres = 1; radiusMetres <= 40; radiusMetres += 0.25) {
      const rogue = itemsOn(radiusMetres).filter(
        (item) => !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.z),
      );
      expect({ radiusMetres, rogue }).toEqual({ radiusMetres, rogue: [] });
    }
  });

  it('places nothing where a bend is too tight to hold a verge, rather than placing it in the road', () => {
    // ⚠️ **The non-vacuity for the sweep above**, and the assertion that goes
    // red against the code as it was: a 12 m circuit carried 56 items then, and
    // the nearest of them was 1.3 m from the centre of the carriageway.
    //
    // The pair either side of it says the refusal is a threshold rather than a
    // rule that swallowed every bend: a 40 m radius keeps its scenery.
    // ⚠️ **18 m as well as 12, and it is the one that catches a curvature read
    // at half its true value** — which is what this file did until #348. A 12 m
    // circuit is refused either way; an 18 m one reads as 36 m under the old
    // baseline, which is open enough to carry two bands of scenery folded
    // through the inside of a bend a rider would have to lean into.
    const tight = circuit(12);
    const hairpin = circuit(18);
    const open = circuit(40);

    expect(place(tight, 0, tight.totalDistance)).toEqual([]);
    expect(place(hairpin, 0, hairpin.totalDistance)).toEqual([]);
    expect(place(open, 0, open.totalDistance).length).toBeGreaterThan(0);
  });
});

describe('the budget', () => {
  // Sea level at a temperate latitude: the geography argues for dense forest,
  // which is what lets the budget bind at all. ⚠️ **Six kilometres of it since
  // #348**, and the length is doing work rather than being generous: the
  // clustering plants a stretch at a time, so the budget binds where a stretch
  // happens to be fully planted and a two-kilometre route can run out of road
  // before one is.
  const profile = eastRoute({ latitude: 45, altitude: 0, points: 600 });
  const span = 460;
  // ⚠️ **Not the first 460 m of the route, and since #348 it cannot be.** The
  // clustering means an arbitrary stretch of road may be open ground — that is
  // the whole point of it — so a window pinned at zero would measure a thinning
  // that never had to happen and this whole block would be green over an empty
  // world. The window is *found* rather than written down, so the constants can
  // move without leaving a literal here describing where the trees used to be.
  const from = plantedStretch(profile, span);

  it('is the only thing that bounds the count', () => {
    const unbounded = place(profile, from, from + span);

    expect(unbounded.length).toBeGreaterThan(SCATTER_MAX_ITEMS);
  });

  it('is never exceeded', () => {
    const bounded = place(profile, from, from + span, {
      maxItems: SCATTER_MAX_ITEMS,
      riderMetres: from + 60,
    });

    expect(bounded.length).toBe(SCATTER_MAX_ITEMS);
  });

  it('thins the far view rather than truncating it', () => {
    // ⚠️ #243's sixth criterion, and the assertion that goes red for
    // `found.slice(0, maxItems)`: taking the first N in cell order keeps
    // everything behind the rider and stops dead at whatever distance the
    // budget ran out, which reads as a wall across the road. On this fixture
    // `x` is the route distance, so the far end of the view is simply large `x`.
    const unbounded = place(profile, from, from + span);
    const bounded = place(profile, from, from + span, {
      maxItems: SCATTER_MAX_ITEMS,
      riderMetres: from + 60,
    });
    const furthest = (items: readonly ScatterItem[]): number =>
      items.reduce((widest, item) => Math.max(widest, item.x), 0);

    expect(furthest(bounded)).toBeGreaterThan(furthest(unbounded) - 20);
    expect(bounded.filter((item) => item.x > from + span * 0.75).length).toBeGreaterThan(10);
  });

  it('draws nothing at all when there is no budget to draw with', () => {
    expect(place(profile, from, from + span, { maxItems: 0, riderMetres: from + 60 })).toEqual([]);
  });

  it('draws nothing rather than everything when the budget is nonsense', () => {
    // ⚠️ `Array.prototype.slice` reads a negative end as an offset from the
    // end, so an unclamped budget of −1 returns every item but the last. A
    // caller asking for no scenery and getting three hundred pieces of it is
    // the opposite of a budget.
    expect(place(profile, from, from + span, { maxItems: -1, riderMetres: from + 60 })).toEqual([]);
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
      expect(place(tiny, -60, 400).length).toBeLessThanOrEqual(SCATTER_BANDS_PER_SIDE * 2);
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
