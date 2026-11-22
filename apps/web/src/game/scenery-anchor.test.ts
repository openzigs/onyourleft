// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where an open-world ride's scenery is keyed, and that a route's is not —
 * #3055 (`scenery-anchor.ts`).
 *
 * ⚠️ **The route seeds below were read on `main` before a line of #3055 was
 * written**, from the same three profiles, and committed unchanged: a route
 * ride's scenery is a function of its seed and its grid, so a seed that moved
 * would move every tree on every route. `arrangement-unchanged.test.ts`' digest
 * is the same guard one layer up, over everything a frame places.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RouteProfile,
} from '@onyourleft/domain';

import { billboardsAt } from './billboards';
import { sideRoadsAt } from './cross-streets';
import { NO_LAND_CLASS, type LandClassMask } from './land-class';
import { FIELD_SPAN_METRES, fieldSpanMetres } from './landform';
import {
  SCATTER_CELL_METRES,
  cellSpanMetres,
  routeSeed,
  scatterSeed,
  type ScatterItem,
} from './scatter';
import { anchorScenery, sceneryAnchor, sceneryGrid, wrappedCell } from './scenery-anchor';
import { townAt } from './scenery-cyclists';
import {
  NO_MAPPED_TOWN,
  SETTLEMENT_SPACING_METRES,
  lotsAt,
  siteAt,
  siteSpacing,
} from './settlements';
import { streetsAt } from './streets';
import { corridorOrigin, type CorridorOrigin } from './terrain';
import { NO_URBAN_CLASS } from './urban-class';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** A straight route north from `latitude`, `metres` long, a point every 10 m, climbing at 1 %. */
function northRoute(latitude: number, longitude: number, metres: number): RouteProfile {
  const points = [];
  for (let along = 0; along <= metres; along += 10) {
    points.push({
      position: geographicPosition(
        degreesLatitude(latitude + along / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(longitude),
      ),
      elevation: altitudeMetres(100 + along * 0.01),
    });
  }
  return routeProfile(points);
}

/**
 * A straight road east along 51.5° N, climbing at 1 %, from `from` to `to`
 * metres along it. East, so that every view's local metres are to one scale:
 * a view's projection is scaled by the cosine of its own first point's
 * latitude (`terrain.ts` §`localGroundPosition`), which a road north changes.
 */
function eastRoad(from: number, to: number): RouteProfile {
  const scale = METRES_PER_DEGREE_LATITUDE * Math.cos((51.5 * Math.PI) / 180);
  const points = [];
  for (let along = from; along <= to; along += 10) {
    points.push({
      position: geographicPosition(degreesLatitude(51.5), degreesLongitude(-1 + along / scale)),
      elevation: altitudeMetres(100 + along * 0.01),
    });
  }
  return routeProfile(points);
}

describe('a route is keyed as it was before #3055', () => {
  it('is seeded from its first point and its length, to the values main gave', () => {
    expect(scatterSeed(northRoute(51.5, -0.12, 3_000))).toBe(ROUTE_SEEDS[0]);
    expect(scatterSeed(northRoute(45, 7, 1_230))).toBe(ROUTE_SEEDS[1]);
    expect(scatterSeed(northRoute(-33.9, 151.2, 12_340))).toBe(ROUTE_SEEDS[2]);
  });

  it('is placed on grids stretched to divide it evenly, counted from its start', () => {
    const profile = northRoute(51.5, -0.12, 3_005);
    const total = profile.totalDistance as number;
    expect(sceneryAnchor(profile)).toBeUndefined();
    expect(cellSpanMetres(profile)).toBe(total / Math.round(total / SCATTER_CELL_METRES));
    expect(fieldSpanMetres(profile)).toBe(total / Math.round(total / FIELD_SPAN_METRES));
    const sites = siteSpacing(profile);
    expect(sites.sites).toBe(Math.round(total / SETTLEMENT_SPACING_METRES));
    expect(sites.span).toBe(total / sites.sites);
    expect(sites.shift).toBe(0);
    expect([sites.first, sites.last]).toEqual([0, sites.sites - 1]);
  });

  it('wraps a cell onto a lap of the route', () => {
    const grid = sceneryGrid(northRoute(51.5, -0.12, 1_200), 100);
    expect(grid.count).toBe(12);
    expect(wrappedCell(grid, 13)).toBe(1);
    expect(wrappedCell(grid, -1)).toBe(11);
  });
});

describe('an anchored view is keyed on its ride — #3055', () => {
  it('is seeded from the ride, whatever its own first point and length', () => {
    const profile = northRoute(51.5, -0.12, 3_000);
    anchorScenery(profile, { seed: 12_345, origin: 4_210 });
    expect(scatterSeed(profile)).toBe(12_345);
    // The route's own seed is still there for the ride to be seeded from.
    expect(routeSeed(profile)).toBe(ROUTE_SEEDS[0]);
  });

  it('is placed on the nominal grids, counted in ride distance', () => {
    const profile = northRoute(51.5, -0.12, 3_005);
    anchorScenery(profile, { seed: 1, origin: 4_210 });
    expect(cellSpanMetres(profile)).toBe(SCATTER_CELL_METRES);
    expect(fieldSpanMetres(profile)).toBe(FIELD_SPAN_METRES);
    const grid = sceneryGrid(profile, 100);
    // Ride distance 4 210 to 7 215: cells 42 to 72, which nothing wraps.
    expect(grid).toEqual({
      span: 100,
      shift: 4_210,
      count: 31,
      first: 42,
      last: 72,
      anchored: true,
    });
    expect(wrappedCell(grid, 72)).toBe(72);
    const sites = siteSpacing(profile);
    expect(sites.span).toBe(SETTLEMENT_SPACING_METRES);
    expect([sites.first, sites.last]).toEqual([6, 10]);
  });

  it('is the profile object that is anchored, not one like it', () => {
    const anchored = northRoute(51.5, -0.12, 3_000);
    anchorScenery(anchored, { seed: 1, origin: 10 });
    expect(sceneryAnchor(northRoute(51.5, -0.12, 3_000))).toBeUndefined();
  });
});

describe('every generator reads an anchored view in ride distance — #3055', () => {
  // One road, 12 km east, as two views of one ride: the whole of it, and the
  // last 5 km of it, after the trim behind moved the first point 7 km on.
  // The late view's origin is measured, not 7 000: the fixture's metres are
  // not quite the geodesy's.
  // A seed whose four billboards and three villages fall in the stretch compared.
  const seed = 2;
  const whole = eastRoad(0, 12_000);
  const late = eastRoad(7_000, 12_000);
  const trimmed = (whole.totalDistance as number) - (late.totalDistance as number);
  anchorScenery(whole, { seed, origin: 0 });
  anchorScenery(late, { seed, origin: trimmed });
  const views = [
    { profile: whole, shift: 0, origin: corridorOrigin(whole) },
    { profile: late, shift: trimmed, origin: corridorOrigin(late) },
  ] as const;
  // Ride distance, well clear of the late view's first point, whose grade window is cut short.
  const from = 7_600;
  const to = 11_400;
  const fixed = views[0].origin;

  /** Where an item stands, in metres east and north of `fixed`, and how high. */
  const placed = (origin: CorridorOrigin, item: { x: number; y: number; z: number }) => {
    const own = METRES_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
    const longitude = origin.longitude - item.x / own;
    const latitude = origin.latitude + item.z / METRES_PER_DEGREE_LATITUDE;
    const scale = METRES_PER_DEGREE_LATITUDE * Math.cos((fixed.latitude * Math.PI) / 180);
    return [
      Math.round((longitude - fixed.longitude) * scale * 1_000) / 1_000,
      Math.round((latitude - fixed.latitude) * METRES_PER_DEGREE_LATITUDE * 1_000) / 1_000,
      Math.round((item.y + origin.elevation - fixed.elevation) * 1_000) / 1_000,
    ];
  };

  it('puts every settlement at the same ride distance on both', () => {
    const grid = siteSpacing(late);
    const found = [];
    for (let site = Math.floor(from / grid.span); site <= Math.floor(to / grid.span); site += 1) {
      const [a, b] = views.map(({ profile, shift }) => {
        const each = siteAt(profile, seed, site);
        return each === undefined
          ? undefined
          : { kind: each.kind, centre: each.centre + shift, side: each.side };
      });
      expect(b, `site ${site}`).toEqual(a);
      if (a !== undefined) found.push(a);
    }
    expect(found.length).toBeGreaterThan(0);
  });

  it('puts every village street at the same ride distance on both', () => {
    const [a, b] = views.map(({ profile, shift, origin }) =>
      streetsAt(profile, origin, seed, from - shift, to - shift).map((street) => ({
        site: street.wrappedSite,
        from: Math.round((street.from + shift) * 1_000) / 1_000,
        to: Math.round((street.to + shift) * 1_000) / 1_000,
      })),
    );
    expect(a?.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('puts every village crossroads at the same ride distance on both', () => {
    const [a, b] = views.map(({ profile, shift, origin }) =>
      sideRoadsAt(profile, origin, seed, from - shift, to - shift, from - shift)
        .map((road) => Math.round((road.junction.along + shift) * 1_000) / 1_000)
        .sort((x, y) => x - y),
    );
    expect(a?.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('tells the cyclists where the villages are, the same on both', () => {
    const [a, b] = views.map(({ profile, shift }) => {
      const town = townAt(profile, seed, NO_URBAN_CLASS);
      const towns: number[] = [];
      for (let at = from; at < to; at += 10) if (town(at - shift)) towns.push(at);
      return towns;
    });
    expect(a?.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('puts every billboard at the same ride distance on both', () => {
    const [a, b] = views.map(({ profile, shift, origin }) =>
      billboardsAt(profile, origin, seed, from - shift, to - shift).map((board) => ({
        along: Math.round((board.along + shift) * 1_000) / 1_000,
        side: board.side,
      })),
    );
    expect(a?.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('builds every lot of a built-up road in the same place on both', () => {
    // Built-up everywhere: every lot whose share is drawn stands.
    const town: LandClassMask = {
      ...NO_LAND_CLASS,
      classAt: () => 'built-up',
      covered: () => true,
      bytes: 1,
    };
    const [a, b] = views.map(({ profile, shift, origin }) => {
      const found: ScatterItem[] = [];
      lotsAt(profile, origin, seed, from - shift, to - shift, town, NO_MAPPED_TOWN, found);
      return found.map((item) => [item.kind, ...placed(origin, item)]);
    });
    expect(a?.length).toBeGreaterThan(20);
    expect(b).toEqual(a);
  });
});

/** @see this file's header: read on `main`, before #3055. */
const ROUTE_SEEDS = [3_314_101_050, 1_744_695_870, 2_504_797_947] as const;
