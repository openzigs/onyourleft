// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * More variety in the procedural villages — #1566: a layout by plot (the
 * commercial plots at the centre, houses toward the ends), no two
 * neighbouring plots alike in shape, model or colour, every house and shop
 * painted, and the house models (#1585's set) offered to the realistic world
 * only where their whole length stands clear — `settlements.ts`
 * §`everyVillagePlot` and §`settlementsAt`.
 *
 * Read back through `structuresAt` and `sceneFrame`, the paths the renderer
 * is handed, not off `everyVillagePlot` alone.
 */

import { describe, expect, it } from 'vitest';

import { distanceOnRoute, metres, type RouteProfile } from '@onyourleft/domain';

import { lotClad, lotPaintEntry } from './building-paint';
import {
  HOUSE_MODELS,
  MAIN_STREET_MODEL,
  plotModelFootprint,
  VILLAGE_HOUSE_MODELS,
} from './house-models';
import { ROAD_CLEARANCE_METRES } from './landform';
import { circuitRoute, levelHairpinRoute, northRoute, valleyRoute } from './route-fixtures-testing';
import { scatterSeed, type ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import {
  everyVillagePlot,
  footprintClearance,
  onSettlementGround,
  PLOT_METRES,
  settlementFootprintsAt,
  siteAt,
  siteSpacing,
  STRUCTURE_FOOTPRINTS,
  structuresAt,
  type Plot,
  type Site,
} from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame } from './terrain';

const ALL = { maxItems: 1_000_000, riderMetres: 0 } as const;

/** Every village a route has, with its seed. */
function villagesOf(profile: RouteProfile, seed = scatterSeed(profile)): readonly Site[] {
  const villages: Site[] = [];
  for (let index = 0; index < siteSpacing(profile).sites; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site?.kind === 'village') villages.push(site);
  }
  return villages;
}

/** Twenty kilometres of level valley road, and a seed beside its own. */
const FARMLAND = northRoute(20_000, () => 50);
const FIXTURES: readonly (readonly [string, RouteProfile, number])[] = [
  ['farmland', FARMLAND, scatterSeed(FARMLAND)],
  ['farmland, another seed', FARMLAND, scatterSeed(FARMLAND) ^ 0x5a5a],
  ['a circuit', circuitRoute(3_000), scatterSeed(circuitRoute(3_000))],
  ['a valley', valleyRoute(), scatterSeed(valleyRoute())],
];

/** The plot number and side a plot of `village` is. */
function placeOf(village: Site, plot: Plot): { readonly at: number; readonly s: 0 | 1 } {
  return {
    at: Math.round((plot.along - (village.centre - village.half)) / PLOT_METRES),
    s: plot.side === 1 ? 0 : 1,
  };
}

describe('a village laid out by plot — #1566', () => {
  it('builds a row of shops and a main-street block either side of the crossroads, crossed over, and houses toward the ends', () => {
    let villages = 0;
    for (const [name, profile, seed] of FIXTURES) {
      for (const village of villagesOf(profile, seed)) {
        villages += 1;
        const plots = everyVillagePlot(seed, village);
        const middle = Math.max(...plots.map((plot) => placeOf(village, plot).at)) / 2;
        for (const plot of plots) {
          const { at } = placeOf(village, plot);
          if (at === middle) {
            expect(plot.built, `${name}: the crossroads`).toBe(false);
          } else if (Math.abs(at - middle) === 1) {
            // Always built, and commercial.
            expect(plot.built, `${name}: plot ${String(at)}`).toBe(true);
            expect(plot.kind).toBe('shop-row');
            // The block across the road from a row of shops, and beside it
            // across the crossroads.
            const across = plots.find(
              (other) => other.along === plot.along && other.side === -plot.side,
            );
            expect(across?.kind).toBe('shop-row');
            expect(
              (across?.house === MAIN_STREET_MODEL) !== (plot.house === MAIN_STREET_MODEL),
            ).toBe(true);
            // The row of shops #460 had stays where it was: past the middle, across from the church.
            if (at === middle + 1 && plot.side === -village.side) {
              expect(plot.house).toBeUndefined();
            }
          } else if (plot.kind !== 'church') {
            expect(plot.kind, `${name}: plot ${String(at)}`).toBe('building');
            expect(VILLAGE_HOUSE_MODELS).toContain(plot.house);
          } else {
            expect(at).toBe(2 * middle);
            expect(plot.side).toBe(village.side);
            expect(plot.house).toBeUndefined();
          }
        }
      }
    }
    expect(villages).toBeGreaterThan(10);
  });

  it('builds no two neighbouring plots alike: not in shape, not in model, not in colour', () => {
    let pairs = 0;
    for (const [name, profile, seed] of FIXTURES) {
      for (const village of villagesOf(profile, seed)) {
        const plots = everyVillagePlot(seed, village);
        for (const plot of plots) {
          const here = placeOf(village, plot);
          for (const other of plots) {
            const there = placeOf(village, other);
            const along = Math.abs(there.at - here.at);
            const across = there.s !== here.s;
            // The next plot along on its side, the plot across, and the two
            // diagonally across.
            if (!((along === 1 && !across) || (along <= 1 && across))) continue;
            const label = `${name}: ${String(here.at)}/${String(here.s)} beside ${String(there.at)}/${String(there.s)}`;
            if (plot.kind === 'building' && other.kind === 'building') {
              expect(other.house, label).not.toBe(plot.house);
            }
            if (plot.paint !== undefined && other.paint !== undefined) {
              expect(lotPaintEntry(other.paint, 'wall'), label).not.toBe(
                lotPaintEntry(plot.paint, 'wall'),
              );
              expect(lotPaintEntry(other.paint, 'roof'), label).not.toBe(
                lotPaintEntry(plot.paint, 'roof'),
              );
            }
            if (
              along + (across ? 1 : 0) === 1 &&
              plot.kind === 'building' &&
              other.kind === 'building'
            ) {
              // A building's two shapes (`buildings.ts`) and the stylised pack's three.
              expect(other.variant % 2, label).not.toBe(plot.variant % 2);
              expect(other.variant % 3, label).not.toBe(plot.variant % 3);
            }
            pairs += 1;
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(500);
  });

  it('builds a village’s rows of shops in one shape, and tells its centre apart by model and paint', () => {
    for (const [name, profile, seed] of FIXTURES) {
      for (const village of villagesOf(profile, seed)) {
        const shops = everyVillagePlot(seed, village).filter((plot) => plot.kind === 'shop-row');
        expect(shops, name).toHaveLength(4);
        expect(new Set(shops.map((plot) => plot.variant)).size, name).toBe(1);
        expect(
          shops.filter((plot) => plot.house === MAIN_STREET_MODEL),
          name,
        ).toHaveLength(2);
      }
    }
  });

  it('turns each village through the models and the shapes by its own seed, so two villages are not one street', () => {
    const streets = new Set<string>();
    const villages = villagesOf(FARMLAND);
    for (const village of villages) {
      const houses = everyVillagePlot(scatterSeed(FARMLAND), village)
        .filter((plot) => plot.kind === 'building')
        .map((plot) => `${String(plot.house)}:${String(plot.variant)}`);
      streets.add(houses.join(' '));
    }
    expect(villages.length).toBeGreaterThan(5);
    expect(streets.size).toBeGreaterThan(villages.length / 2);
    // And every model of the set is used somewhere along the road.
    const used = new Set(
      villages.flatMap((village) =>
        everyVillagePlot(scatterSeed(FARMLAND), village).map((plot) => plot.house),
      ),
    );
    for (const model of [...VILLAGE_HOUSE_MODELS, MAIN_STREET_MODEL]) {
      expect(used.has(model), HOUSE_MODELS[model]?.id).toBe(true);
    }
  });

  it('paints every house and row of shops it builds, clads only the houses, and leaves the church as it was', () => {
    const items = structuresAt(
      FARMLAND,
      corridorOrigin(FARMLAND),
      scatterSeed(FARMLAND),
      0,
      FARMLAND.totalDistance,
      ALL,
    );
    const villageHouses = items.filter(
      (item) => item.kind === 'building' && item.house !== undefined,
    );
    expect(villageHouses.length).toBeGreaterThan(50);
    for (const house of villageHouses) {
      expect(lotPaintEntry(house.paint, 'wall')).toBeGreaterThanOrEqual(0);
      expect(lotPaintEntry(house.paint, 'roof')).toBeGreaterThanOrEqual(0);
    }
    expect(villageHouses.filter((house) => lotClad(house.paint, 'wall')).length).toBeGreaterThan(
      villageHouses.length / 2,
    );
    const shops = items.filter((item) => item.kind === 'shop-row');
    expect(shops.length).toBeGreaterThan(20);
    for (const shop of shops) {
      expect(lotPaintEntry(shop.paint, 'wall')).toBeGreaterThanOrEqual(0);
      expect(lotClad(shop.paint, 'wall')).toBe(false);
    }
    expect(shops.filter((shop) => shop.house === MAIN_STREET_MODEL).length).toBe(shops.length / 2);
    const churches = items.filter((item) => item.kind === 'church');
    expect(churches.length).toBeGreaterThan(0);
    for (const church of churches) {
      expect(church.paint).toBeUndefined();
      expect(church.house).toBeUndefined();
    }
  });
});

describe('a model only where its whole length stands — #1566', () => {
  /** A plot item's model's ground, as `settlements.ts` measures it. */
  const groundOf = (item: ScatterItem, house: number): ReturnType<typeof plotModelFootprint> =>
    plotModelFootprint(house, STRUCTURE_FOOTPRINTS[item.kind as 'building' | 'shop-row'].front);

  it('drops the model, and keeps the house, where its back would stand within the clearance of the other leg', () => {
    // Legs 36 m apart: a house's own 9 m stands clear of the far leg, and a
    // model's 18 to 24 m on the inside of a leg does not.
    const profile = levelHairpinRoute(18, 2_500);
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    const villages = villagesOf(profile, seed);
    expect(villages.length).toBeGreaterThan(0);
    const items = structuresAt(profile, origin, seed, 0, profile.totalDistance, ALL);
    let kept = 0;
    let dropped = 0;
    for (const village of villages) {
      for (const plot of everyVillagePlot(seed, village).filter((each) => each.built)) {
        if (plot.house === undefined) continue;
        const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, plot.along));
        if (frame === undefined) continue;
        const x = frame.x + frame.normalX * plot.lateral * plot.side;
        const z = frame.z + frame.normalZ * plot.lateral * plot.side;
        const standing = items.find(
          (each) =>
            each.kind === plot.kind && Math.abs(each.x - x) < 1e-6 && Math.abs(each.z - z) < 1e-6,
        );
        if (standing === undefined) continue;
        const item = standing.house === plot.house ? standing : undefined;
        const house = standing.house === undefined ? standing : undefined;
        if (item !== undefined) {
          kept += 1;
          expect(
            footprintClearance(profile, origin, item, groundOf(item, plot.house)),
          ).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES);
        } else if (house !== undefined) {
          dropped += 1;
          // The control: its model WOULD have stood on the road's clearance.
          expect(
            footprintClearance(profile, origin, house, groundOf(house, plot.house)),
          ).toBeLessThan(ROAD_CLEARANCE_METRES);
        }
      }
    }
    expect(kept).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
  });

  it('clears the trees off every model’s whole length, in either world', () => {
    const origin = corridorOrigin(FARMLAND);
    const seed = scatterSeed(FARMLAND);
    const footprints = settlementFootprintsAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance);
    const items = structuresAt(FARMLAND, origin, seed, 0, FARMLAND.totalDistance, ALL);
    let checked = 0;
    for (const item of items) {
      if (item.house === undefined) continue;
      const ground = groundOf(item, item.house);
      const cos = Math.cos(item.rotation);
      const sin = Math.sin(item.rotation);
      // Its four corners, a centimetre in, and its back's middle.
      for (const [across, ahead] of [
        [-ground.x + 0.01, ground.back + 0.01],
        [ground.x - 0.01, ground.back + 0.01],
        [-ground.x + 0.01, ground.front - 0.01],
        [ground.x - 0.01, ground.front - 0.01],
        [0, ground.back + 0.01],
      ] as const) {
        const point = {
          x: item.x + across * cos + ahead * sin,
          z: item.z - across * sin + ahead * cos,
        };
        expect(footprints.some((piece) => onSettlementGround(point, piece))).toBe(true);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('hands the models to the renderer through the real scene', () => {
    const village = villagesOf(FARMLAND)[0] as Site;
    const start = atStartLine(FARMLAND);
    const frame = sceneFrame({
      profile: FARMLAND,
      origin: corridorOrigin(FARMLAND),
      state: {
        ...start,
        ride: { ...start.ride, distance: metres(village.centre - village.half - 40) },
      },
    });
    const modelled = frame.scatter.filter((item) => item.house !== undefined);
    expect(modelled.length).toBeGreaterThan(3);
    expect(modelled.some((item) => item.house === MAIN_STREET_MODEL)).toBe(true);
    for (const item of modelled) expect(item.paint).toBeDefined();
  });
});
