// SPDX-License-Identifier: Apache-2.0

/**
 * A rolling route's real heights — #2899, ADR 0087 D-3, D-4 and D-7.
 *
 * Every ground here is a formula over a straight street running east: none is
 * terrain data. The route is read back the way the game reads it: its view's
 * elevations and grades, `gradeAt`, and {@link RollingRoute.gradeKnownAt}.
 */

import { describe, expect, it } from 'vitest';

import { metres, type GeographicPosition } from '../quantities';
import { MAX_SIMULATED_GRADE_PERCENT } from '../trainer/simulation';
import { gradeAt } from './profile';
import {
  ROLLING_MOST_STEP_METRES,
  ROLLING_RESOLUTION_METRES,
  RollingRoute,
  type RollingEdge,
  type RollingHeights,
} from './rolling';
import { graphOf, placeAt, streetThrough } from './rolling-testing';

const ORIGIN = placeAt(0, 0);
const PER_DEGREE_LONGITUDE = (placeAt(1_000, 0).longitude - ORIGIN.longitude) / 1_000;

/** How far east of the origin a place is, in metres: `placeAt` inverted along the street. */
const eastOf = (place: GeographicPosition): number =>
  (place.longitude - ORIGIN.longitude) / PER_DEGREE_LONGITUDE;

/** A height source over the street: the ground as a function of the distance east. */
const groundEast =
  (ground: (east: number) => number | undefined): RollingHeights =>
  (place) =>
    ground(eastOf(place));

/** A street east from `from` to `to`, its own elevations all 0: a source must be what is read. */
function street(id: string, from: number, to: number, span = false): RollingEdge {
  return {
    id,
    from: `n${String(from)}`,
    to: `n${String(to)}`,
    points: streetThrough(
      [
        [from, 0],
        [to, 0],
      ],
      () => 0,
    ),
    roadClass: 1,
    ...(span ? { span: true } : {}),
  };
}

/** One long street east, 0 to 3 km, with `heights` as its source. */
function routeOver(heights: RollingHeights | undefined, edges?: readonly RollingEdge[]) {
  const held = edges ?? [street('a', 0, 3_000)];
  return new RollingRoute(graphOf(held), held[0] as RollingEdge, { heights });
}

const sampleAt = (east: number): number => Math.round(east / ROLLING_RESOLUTION_METRES);

describe('the heights come from the source, on the 10 m grid', () => {
  it('reads a steady 5 % slope from the source, where the street’s own heights are all 0', () => {
    const route = routeOver(groundEast((east) => 200 + east * 0.05));
    const view = route.view();
    expect(view.elevations[0]).toBeCloseTo(200, 3);
    expect(view.elevations[sampleAt(1_000)]).toBeCloseTo(250, 3);
    for (const at of [200, 705, 1_500]) {
      expect(gradeAt(view, metres(at))).toBeCloseTo(5, 3);
      expect(route.gradeKnownAt(at)).toBe(true);
    }
  });

  it('reads the street’s own heights when it has no source, and every grade is known', () => {
    const route = routeOver(undefined);
    expect(new Set(route.view().elevations)).toStrictEqual(new Set([0]));
    expect(route.gradeKnownAt(0)).toBe(true);
    expect(route.gradeKnownAt(1_234)).toBe(true);
    // Off the road held there is no grade to know.
    expect(route.gradeKnownAt(-1)).toBe(false);
    expect(route.gradeKnownAt(route.end + 1)).toBe(false);
  });
});

describe('where the source has no height — ADR 0087 D-7', () => {
  /** A 6 % climb with no height between 495 m and 595 m: the samples at 500 m to 590 m. */
  const holed = groundEast((east) => (east > 495 && east < 595 ? undefined : 100 + east * 0.06));

  it('makes the grade unavailable wherever its windows reach the hole, and nowhere else', () => {
    const route = routeOver(holed);
    // The hole's samples are 500 m to 590 m. A grade reads heights 70 m either
    // side of its own sample, and the grade sent reads the next sample too.
    for (const known of [0, 300, 419, 670, 900])
      expect(route.gradeKnownAt(known), `${known}`).toBe(true);
    for (const unknown of [421, 430, 500, 550, 599, 669]) {
      expect(route.gradeKnownAt(unknown), `${unknown}`).toBe(false);
    }
  });

  it('reads 0 % there, and the road’s own grade either side', () => {
    const view = routeOver(holed).view();
    expect(gradeAt(view, metres(300))).toBeCloseTo(6, 3);
    expect(gradeAt(view, metres(550))).toBe(0);
    expect(gradeAt(view, metres(440))).toBe(0);
    expect(gradeAt(view, metres(900))).toBeCloseTo(6, 3);
  });

  it('holds the last known height across the hole, so the road is drawn level there', () => {
    const route = routeOver(
      groundEast((east) => (east > 495 && east < 595 ? undefined : 100 + east * 0.02)),
    );
    const view = route.view();
    const before = view.elevations[sampleAt(480)] as number;
    // Inside the hole, past the median's reach of its edge: the height at 490 m.
    expect(view.elevations[sampleAt(540)]).toBeCloseTo(100 + 490 * 0.02, 3);
    expect(view.elevations[sampleAt(540)]).toBeGreaterThan(before);
  });

  it('treats a height that is not a number as no height', () => {
    const route = routeOver(groundEast((east) => (east > 495 && east < 595 ? Number.NaN : 100)));
    expect(route.gradeKnownAt(550)).toBe(false);
    expect(route.gradeKnownAt(900)).toBe(true);
  });
});

describe('the step between two samples — ADR 0087 D-3’s last row', () => {
  it('is 4 m: the ±40 % a trainer is ever sent, over one 10 m sample', () => {
    expect(ROLLING_MOST_STEP_METRES).toBe(4);
    expect(ROLLING_MOST_STEP_METRES).toBe(
      (MAX_SIMULATED_GRADE_PERCENT / 100) * ROLLING_RESOLUTION_METRES,
    );
  });

  it('keeps a 3.9 m step and makes a 4.1 m one no-data on both sides', () => {
    const stepped = (rise: number): RollingRoute =>
      routeOver(groundEast((east) => (east < 795 ? 100 : 100 + rise)));
    const kept = stepped(3.9);
    expect(kept.gradeKnownAt(790)).toBe(true);
    const refused = stepped(4.1);
    // Samples 790 m and 800 m are no-data: the grade is unavailable from 70 m
    // (and the next sample) before the first to 70 m after the second.
    for (const unknown of [711, 790, 800, 879])
      expect(refused.gradeKnownAt(unknown), `${unknown}`).toBe(false);
    for (const known of [700, 709, 880, 1_000])
      expect(refused.gradeKnownAt(known), `${known}`).toBe(true);
    expect(gradeAt(refused.view(), metres(795))).toBe(0);
  });

  it('turns a cliff edge into no-data, never a grade at the clamp', () => {
    // 80 m straight down just short of 1 km.
    const route = routeOver(groundEast((east) => (east < 995 ? 500 : 420)));
    const view = route.view();
    for (let at = 0; at <= 2_000; at += 5) {
      // Level ground either side, and nothing in between but 0 %.
      expect(Math.abs(gradeAt(view, metres(at))), `${at}`).toBeLessThan(1e-9);
    }
    expect(route.gradeKnownAt(1_000)).toBe(false);
  });

  it('turns a plateau inside the valid range into no-data at both its edges', () => {
    // The hostile tile ADR 0087 D-3 names: every height is a plausible one,
    // and three or more samples of it would survive the median.
    const route = routeOver(groundEast((east) => (east > 995 && east < 1_295 ? 150 : 100)));
    const view = route.view();
    for (let at = 800; at <= 1_500; at += 5) {
      expect(Math.abs(gradeAt(view, metres(at))), `${at}`).toBeLessThan(1e-9);
    }
    for (const unknown of [930, 1_000, 1_060, 1_240, 1_300, 1_360]) {
      expect(route.gradeKnownAt(unknown), `${unknown}`).toBe(false);
    }
    // Mid-plateau and well clear of it, the heights are level and known.
    for (const known of [900, 1_150, 1_400])
      expect(route.gradeKnownAt(known), `${known}`).toBe(true);
  });

  it('does not hold a street’s own heights to it: a route file is the rider’s choice', () => {
    const steep: RollingEdge = {
      ...street('a', 0, 3_000),
      points: streetThrough(
        [
          [0, 0],
          [3_000, 0],
        ],
        (east) => east * 0.6,
      ),
    };
    const route = new RollingRoute(graphOf([steep]), steep);
    expect(gradeAt(route.view(), metres(500))).toBeCloseTo(60, 3);
    expect(route.gradeKnownAt(500)).toBe(true);
  });
});

describe('a bridge over a valley — ADR 0087 D-4.3', () => {
  /** A plateau at 300 m with a valley 12 m deep between 400 m and 480 m. */
  const valley = (east: number): number => {
    const from = Math.abs(east - 440);
    return from >= 40 ? 300 : 288 + (12 * from) / 40;
  };
  const edges = (span: boolean): RollingEdge[] => [
    street('west', 0, 400),
    street('bridge', 400, 480, span),
    street('east', 480, 3_000),
  ];

  it('gives the deck’s grade where the street is marked a bridge: level, and known', () => {
    const route = routeOver(groundEast(valley), edges(true));
    const view = route.view();
    for (let at = 300; at <= 580; at += 5) {
      expect(Math.abs(gradeAt(view, metres(at))), `${at}`).toBeLessThan(1e-9);
      expect(route.gradeKnownAt(at), `${at}`).toBe(true);
    }
    expect(view.elevations[sampleAt(440)]).toBeCloseTo(300, 9);
  });

  it('gives the valley floor’s without the mark: the terrain knows no bridge', () => {
    const view = routeOver(groundEast(valley), edges(false)).view();
    expect(view.elevations[sampleAt(440)]).toBeLessThan(292);
    expect(gradeAt(view, metres(410))).toBeLessThan(-10);
    expect(gradeAt(view, metres(470))).toBeGreaterThan(10);
  });

  it('is a straight line between two ends at different heights', () => {
    // 300 m at the west end, 310 m at the east, and a valley between.
    const ground = (east: number): number => (east <= 400 ? 300 : east >= 600 ? 310 : 250);
    const route = routeOver(groundEast(ground), [
      street('west', 0, 400),
      street('bridge', 400, 600, true),
      street('east', 600, 3_000),
    ]);
    const view = route.view();
    // Past the median's reach of either end, the deck's own line: 5 %.
    for (const at of [440, 500, 560]) {
      expect(view.elevations[sampleAt(at)]).toBeCloseTo(300 + ((at - 400) * 10) / 200, 3);
    }
    expect(route.gradeKnownAt(500)).toBe(true);
  });

  it('carries one bridge across two streets: the node between them is over the valley', () => {
    const route = routeOver(groundEast(valley), [
      street('west', 0, 400),
      street('bridge-a', 400, 440, true),
      street('bridge-b', 440, 480, true),
      street('east', 480, 3_000),
    ]);
    const view = route.view();
    expect(view.elevations[sampleAt(440)]).toBeCloseTo(300, 9);
    expect(Math.abs(gradeAt(view, metres(440)))).toBeLessThan(1e-9);
    // On the second street too, and as known heights: a 0 % that is merely
    // "unavailable" would pass the line above.
    expect(view.elevations[sampleAt(460)]).toBeCloseTo(300, 9);
    for (const at of [420, 440, 460]) expect(route.gradeKnownAt(at), `${at}`).toBe(true);
  });

  it('has no height on a bridge whose far end the terrain does not know', () => {
    const route = routeOver(
      groundEast((east) => (east > 470 && east < 700 ? undefined : valley(east))),
      edges(true),
    );
    expect(route.gradeKnownAt(440)).toBe(false);
    // Not the valley floor: the height before the bridge, held level.
    expect(route.view().elevations[sampleAt(440)]).toBeCloseTo(300, 9);
  });

  it('keeps the mark when the route turns round on the bridge’s far side', () => {
    // The road ends at the bridge's far end, so the route turns round there
    // and rides the bridge back: both ways it is the deck.
    const route = routeOver(groundEast(valley), [
      street('west', 0, 400),
      street('bridge', 400, 480, true),
    ]);
    const view = route.view();
    for (const at of [440, 520, 560]) {
      expect(view.elevations[sampleAt(at)], `${at}`).toBeCloseTo(300, 9);
      expect(route.gradeKnownAt(at), `${at}`).toBe(true);
    }
  });
});

describe('a height tile that arrives late — refill', () => {
  it('fills the samples that had no height, and says a new view was made', () => {
    let arrived = false;
    const route = routeOver(
      groundEast((east) => (east > 495 && !arrived ? undefined : 100 + east * 0.04)),
    );
    const before = route.view();
    expect(route.gradeKnownAt(800)).toBe(false);
    expect(gradeAt(before, metres(800))).toBe(0);
    // Nothing arrived: nothing changes, and the view is the same object.
    expect(route.refill()).toBe(false);
    expect(route.view()).toBe(before);

    arrived = true;
    expect(route.refill()).toBe(true);
    const after = route.view();
    expect(after).not.toBe(before);
    expect(route.gradeKnownAt(800)).toBe(true);
    expect(gradeAt(after, metres(800))).toBeCloseTo(4, 3);
    expect(after.elevations[sampleAt(1_000)]).toBeCloseTo(140, 3);
    // The road before the hole's reach is as it was.
    expect(after.elevations.slice(0, sampleAt(400))).toStrictEqual(
      before.elevations.slice(0, sampleAt(400)),
    );
    // And a second ask finds nothing left to fill.
    expect(route.refill()).toBe(false);
    expect(route.view()).toBe(after);
  });

  it('holds what arrives to the step rule: a late cliff is no-data, not a grade', () => {
    let arrived = false;
    const route = routeOver(
      groundEast((east) => (east > 495 && !arrived ? undefined : east > 495 ? 400 : 100)),
    );
    arrived = true;
    expect(route.refill()).toBe(true);
    expect(route.gradeKnownAt(500)).toBe(false);
    expect(gradeAt(route.view(), metres(500))).toBe(0);
    expect(route.gradeKnownAt(700)).toBe(true);
    // The refused pair is not asked for again.
    expect(route.refill()).toBe(false);
  });

  it('does nothing for a route with no source', () => {
    const route = routeOver(undefined);
    const view = route.view();
    expect(route.refill()).toBe(false);
    expect(route.view()).toBe(view);
  });

  it('fills as the route extends, with no call of its own', () => {
    let arrived = false;
    const route = routeOver(
      groundEast((east) => (east > 495 && !arrived ? undefined : 100 + east * 0.04)),
      [street('a', 0, 9_000)],
    );
    expect(route.gradeKnownAt(800)).toBe(false);
    arrived = true;
    route.advance(100);
    expect(route.gradeKnownAt(800)).toBe(true);
  });
});
