// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1627's village-square tree: what it is made of, and where the product's
 * own table (`decorations.ts` §`HOLIDAY_DECORATIONS`) stands it, on the
 * anchors the real `streetsAt` builds. Every plot is enumerated from
 * `settlements.ts` §`everyVillagePlot`, every building is read off the real
 * `structuresAt`, every side road off `cross-streets.ts` §`villageSideRoad`,
 * and the ground off `landform.ts` §`terrainHeightAt`, the terrain mesh's
 * own — never a hand-written list.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { distanceToSideRoads, VILLAGE_MOUTH_HALF_METRES, villageSideRoad } from './cross-streets';
import {
  BAUBLE_METRES,
  decorationsFor,
  GREEN_CLEAR_METRES,
  HOLIDAY_DECORATIONS,
  TREE_GREEN,
  TREE_HEIGHT_METRES,
  VILLAGE_TREE,
  type DecorationItem,
  type DecorationKind,
} from './decorations';
import { plotModelFootprint } from './house-models';
import { NO_LAND_CLASS } from './land-class';
import { terrainHeightAt } from './landform';
import { distanceToDrawnRoad } from './road-grid';
import { circuitRoute, northRoute, plannerCornerRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { uniformFrom } from './seeded';
import {
  everyVillagePlot,
  PLOT_METRES,
  siteAt,
  siteSpacing,
  STRUCTURE_FOOTPRINTS,
  structuresAt,
  type Plot,
  type Site,
} from './settlements';
import {
  KERB_LATERAL_METRES,
  PAVEMENT_WIDTH_METRES,
  streetsAt,
  type VillageStreet,
} from './streets';
import { corridorOrigin, drawnRoadFrame, ROAD_WIDTH_METRES } from './terrain';
import { decorationKindTriangles, decorationShapeTriangles } from './three-renderer';

const TREE = (HOLIDAY_DECORATIONS['winter-lights'] ?? []).find(
  (kind) => kind.item === VILLAGE_TREE,
) as DecorationKind;

const FIXTURES: readonly (readonly [string, RouteProfile, number])[] = [
  [
    'a straight farmland road',
    northRoute(6_000, () => 40),
    scatterSeed(northRoute(6_000, () => 40)),
  ],
  ['a circuit', circuitRoute(1_000), scatterSeed(circuitRoute(1_000))],
  ['the corner two villages share', plannerCornerRoute(150), 2],
];

/** Every village of a fixture, from the same decision its streets are laid from. */
function villagesOf(profile: RouteProfile, seed: number): readonly Site[] {
  const { sites } = siteSpacing(profile);
  const found: Site[] = [];
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site?.kind === 'village') found.push(site);
  }
  return found;
}

/** Where a point is in a plot's frame: along the road from its middle, and out from the centreline on its side. */
function inPlot(
  profile: RouteProfile,
  plot: Plot,
  at: { readonly x: number; readonly z: number },
): { along: number; across: number } {
  const frame = drawnRoadFrame(
    profile,
    corridorOrigin(profile),
    distanceOnRoute(profile, plot.along),
  );
  if (frame === undefined) throw new Error('no frame at the plot');
  const dx = at.x - frame.x;
  const dz = at.z - frame.z;
  return {
    along: dx * frame.normalZ - dz * frame.normalX,
    across: (dx * frame.normalX + dz * frame.normalZ) * plot.side,
  };
}

/** Whether a point is on a plot's own ground: its length, from behind the pavement out past its building. */
function onPlot(
  profile: RouteProfile,
  plot: Plot,
  at: { readonly x: number; readonly z: number },
): boolean {
  const { along, across } = inPlot(profile, plot, at);
  return (
    Math.abs(along) <= PLOT_METRES / 2 &&
    across >= KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES &&
    across <= plot.lateral + PLOT_METRES
  );
}

/**
 * How far a point is from a building's footprint, restated here from its
 * definition rather than imported: the footprint (`settlements.ts`
 * §`STRUCTURE_FOOTPRINTS`, or a house model's where the building is one) in
 * the building's own frame, turned by its yaw.
 */
function fromBuilding(
  building: { x: number; z: number; rotation: number; kind: string; house?: number },
  at: { readonly x: number; readonly z: number },
): number {
  const shape = STRUCTURE_FOOTPRINTS[building.kind as keyof typeof STRUCTURE_FOOTPRINTS];
  const model =
    building.house === undefined ? undefined : plotModelFootprint(building.house, shape.front);
  const half = Math.max(shape.x, model?.x ?? 0);
  const back = Math.min(shape.back, model?.back ?? 0);
  const front = Math.max(shape.front, model?.front ?? 0);
  const dx = at.x - building.x;
  const dz = at.z - building.z;
  const cos = Math.cos(building.rotation);
  const sin = Math.sin(building.rotation);
  const across = dx * cos - dz * sin;
  const ahead = dx * sin + dz * cos;
  return Math.hypot(Math.max(0, Math.abs(across) - half), Math.max(0, back - ahead, ahead - front));
}

const BUILDING_KINDS = new Set(['building', 'barn', 'church', 'shop-row', 'shed']);

describe('the village-square tree — #1627', () => {
  it('is a trunk and four stacked cones, 6 m tall, with 20 steady baubles and nothing on top', () => {
    expect(decorationShapeTriangles('cone')).toBe(20);
    expect(decorationShapeTriangles('trunk')).toBe(32);
    const cones = TREE.parts.filter((part) => part.shape === 'cone');
    const trunks = TREE.parts.filter((part) => part.shape === 'trunk');
    const baubles = TREE.parts.filter((part) => part.shape === 'bulb');
    expect(cones).toHaveLength(4);
    expect(trunks).toHaveLength(1);
    expect(baubles).toHaveLength(20);
    expect(cones.length + trunks.length + baubles.length).toBe(TREE.parts.length);
    // 4 × 20 + 32 + 20 × 8: inside the issue's 200 to 400.
    expect(decorationKindTriangles(TREE)).toBe(272);
    // Its top is the top cone's point, 6 m up: no star, no angel, nothing above it.
    const tops = TREE.parts.map((part) => part.at[1] + part.size[1] / 2);
    expect(Math.max(...tops)).toBeCloseTo(TREE_HEIGHT_METRES, 9);
    const highest = TREE.parts[tops.indexOf(Math.max(...tops))];
    expect(highest?.shape).toBe('cone');
    expect(TREE_HEIGHT_METRES).toBeGreaterThanOrEqual(5);
    expect(TREE_HEIGHT_METRES).toBeLessThanOrEqual(7);
    // The trunk stands on the ground: its foot is the item's own y = 0.
    const [trunk] = trunks;
    expect((trunk?.at[1] ?? 1) - (trunk?.size[1] ?? 0) / 2).toBe(0);
    // Its baubles glow, steady, and none is red; nothing else of it glows.
    for (const bauble of baubles) {
      expect(bauble.glows).toBe(true);
      const [r, g] = [(bauble.colour >> 16) & 0xff, (bauble.colour >> 8) & 0xff];
      expect(g / r, bauble.colour.toString(16)).toBeGreaterThan(0.6);
      expect(bauble.size).toEqual([BAUBLE_METRES, BAUBLE_METRES, BAUBLE_METRES]);
    }
    for (const part of [...cones, ...trunks]) expect(part.glows).toBe(false);
    for (const cone of cones) expect(cone.colour).toBe(TREE_GREEN);
  });

  it('hangs every bauble on its tier: proud of the faces, touching the tree, inside the footprint', () => {
    for (const bauble of TREE.parts.filter((part) => part.shape === 'bulb')) {
      const [x, y, z] = bauble.at;
      const out = Math.hypot(x, z);
      // The tier whose skirt it hangs from: the highest whose base is below it.
      const tier = TREE.parts
        .filter((part) => part.shape === 'cone' && part.at[1] - part.size[1] / 2 <= y)
        .at(-1);
      if (tier === undefined) throw new Error('a bauble below every tier');
      const base = tier.at[1] - tier.size[1] / 2;
      const corners = (tier.size[0] / 2) * (1 - (y - base) / tier.size[1]);
      // A ten-sided cone's faces are cos(18°) of its corners' circle.
      expect(out).toBeGreaterThan(corners * Math.cos(Math.PI / 10));
      expect(out - BAUBLE_METRES / 2).toBeLessThan(corners);
      expect(out + BAUBLE_METRES / 2).toBeLessThanOrEqual(TREE.radius);
    }
    for (const part of TREE.parts) {
      expect(Math.hypot(part.at[0], part.at[2]) + part.size[0] / 2).toBeLessThanOrEqual(
        TREE.radius + 1e-9,
      );
    }
    // A green anchor is past the pavement by GREEN_CLEAR_METRES less its width,
    // so a footprint no wider than that never reaches it.
    expect(TREE.radius).toBeLessThanOrEqual(GREEN_CLEAR_METRES - PAVEMENT_WIDTH_METRES);
  });

  for (const [name, profile, seed] of FIXTURES) {
    const origin = corridorOrigin(profile);
    const streets = streetsAt(profile, origin, seed, 0, profile.totalDistance);
    const items = decorationsFor(streets, 'winter-lights', HOLIDAY_DECORATIONS);
    const trees = items.filter((item) => item.item === VILLAGE_TREE);
    const villages = villagesOf(profile, seed);
    const siteOf = (street: VillageStreet): Site => {
      const site = villages.find((each) => each.wrappedSite === street.wrappedSite);
      if (site === undefined) throw new Error('a street with no village');
      return site;
    };
    const treesOf = (street: VillageStreet): readonly DecorationItem[] =>
      trees.filter((tree) => street.anchors.includes(tree.anchor));

    it(`stands exactly one a village, on its crossroads green, on ${name}`, () => {
      expect(streets.length).toBeGreaterThanOrEqual(2);
      expect(trees).toHaveLength(streets.length);
      for (const street of streets) {
        const mine = treesOf(street);
        expect(mine).toHaveLength(1);
        const [tree] = mine as [DecorationItem];
        expect(tree.anchor.kind).toBe('green');
        // On the middle plot, the crossroads, on one side or the other.
        const site = siteOf(street);
        const plots = everyVillagePlot(seed, site);
        const middles = plots.filter(
          (plot) => !plot.built && Math.abs(plot.along - site.centre) < 1e-6,
        );
        expect(middles).toHaveLength(2);
        expect(middles.some((plot) => onPlot(profile, plot, tree.anchor))).toBe(true);
        // And on no other plot: never the church's, never a built one's.
        for (const plot of plots) {
          if (middles.includes(plot)) continue;
          expect(onPlot(profile, plot, tree.anchor), plot.kind).toBe(false);
        }
      }
    });

    it(`keeps its footprint off the carriageway, the pavement, the side road and every building, on ${name}`, () => {
      const buildings = structuresAt(profile, origin, seed, 0, profile.totalDistance, {
        maxItems: 100_000,
        riderMetres: 0,
      }).filter((item) => BUILDING_KINDS.has(item.kind));
      expect(buildings.length).toBeGreaterThan(streets.length * 4);
      expect(trees.length).toBeGreaterThan(0);
      for (const tree of trees) {
        const { x, z } = tree.anchor;
        const fromCentreline = distanceToDrawnRoad(profile, origin, x, z, 60);
        expect(fromCentreline - TREE.radius).toBeGreaterThan(ROAD_WIDTH_METRES / 2);
        expect(fromCentreline - TREE.radius).toBeGreaterThan(
          KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES,
        );
        const street = streets.find((each) => each.anchors.includes(tree.anchor));
        if (street === undefined) throw new Error('a tree on no street');
        const crossroads = villageSideRoad(profile, origin, seed, siteOf(street));
        expect(distanceToSideRoads([crossroads], x, z)).toBeGreaterThan(TREE.radius);
        for (const building of buildings) {
          expect(fromBuilding(building, tree.anchor), building.kind).toBeGreaterThan(TREE.radius);
        }
      }
    });

    it(`stands its trunk on the terrain mesh’s ground, to the centimetre, on ${name}`, () => {
      const offset = (VILLAGE_MOUTH_HALF_METRES + PLOT_METRES / 2) / 2;
      expect(trees.length).toBeGreaterThan(0);
      for (const tree of trees) {
        const street = streets.find((each) => each.anchors.includes(tree.anchor));
        if (street === undefined) throw new Error('a tree on no street');
        const site = siteOf(street);
        // Where on the route it is beside, and how far out: found as the
        // green is, either side of the mouth on either side of the road.
        const places = everyVillagePlot(seed, site)
          .filter((plot) => !plot.built && Math.abs(plot.along - site.centre) < 1e-6)
          .flatMap((plot) =>
            [plot.along - offset, plot.along + offset].map((along) => {
              const wrapped = distanceOnRoute(profile, along);
              const frame = drawnRoadFrame(profile, origin, wrapped);
              const lateral = plot.lateral * plot.side;
              return {
                wrapped,
                lateral,
                x: (frame?.x ?? NaN) + (frame?.normalX ?? NaN) * lateral,
                z: (frame?.z ?? NaN) + (frame?.normalZ ?? NaN) * lateral,
              };
            }),
          );
        const place = places.find(
          (each) =>
            Math.abs(each.x - tree.anchor.x) < 1e-6 && Math.abs(each.z - tree.anchor.z) < 1e-6,
        );
        if (place === undefined) throw new Error('a tree at no green');
        const ground = terrainHeightAt(
          profile,
          origin,
          seed,
          place.wrapped,
          place.lateral,
          NO_LAND_CLASS,
        );
        const trunk = TREE.parts.find((part) => part.shape === 'trunk');
        const foot = tree.base + (trunk?.at[1] ?? NaN) - (trunk?.size[1] ?? NaN) / 2;
        expect(Math.abs(foot - ground)).toBeLessThanOrEqual(0.01);
      }
    });
  }

  it('is offered to one anchor a village only, so a table that takes every green still stands one', () => {
    const [, profile, seed] = FIXTURES[0] as (typeof FIXTURES)[number];
    const streets = streetsAt(profile, corridorOrigin(profile), seed, 0, profile.totalDistance);
    // The control: every village has four greens a tree fits on.
    for (const street of streets) {
      const greens = street.anchors.filter(
        (anchor) => anchor.kind === 'green' && anchor.clear >= TREE.radius,
      );
      expect(greens).toHaveLength(4);
    }
    const once = decorationsFor(streets, 'winter-lights', { 'winter-lights': [TREE] });
    expect(once).toHaveLength(streets.length);
    const everywhere = decorationsFor(streets, 'winter-lights', {
      'winter-lights': [{ ...TREE, perVillage: undefined }],
    });
    expect(everywhere).toHaveLength(streets.length * 4);
    // And at chance nought, none at all: the one anchor still rolls.
    expect(
      decorationsFor(streets, 'winter-lights', { 'winter-lights': [{ ...TREE, chance: 0 }] }),
    ).toEqual([]);
  });

  it('stands nothing on a green wider than its room between the buildings either side', () => {
    // On a straight road a green is 11.5 m from the carriageway and about
    // 3.4 m from its side road, but only about 1.7 m from the row of shops
    // beside it: a 2.5 m footprint fits the roads and not the shops.
    const [, profile, seed] = FIXTURES[0] as (typeof FIXTURES)[number];
    const origin = corridorOrigin(profile);
    const streets = streetsAt(profile, origin, seed, 0, profile.totalDistance);
    const buildings = structuresAt(profile, origin, seed, 0, profile.totalDistance, {
      maxItems: 100_000,
      riderMetres: 0,
    }).filter((item) => BUILDING_KINDS.has(item.kind));
    const greens = streets.flatMap((street) =>
      street.anchors.filter((anchor) => anchor.kind === 'green'),
    );
    expect(greens.length).toBeGreaterThanOrEqual(8);
    for (const green of greens) {
      expect(distanceToDrawnRoad(profile, origin, green.x, green.z, 60)).toBeGreaterThan(
        ROAD_WIDTH_METRES / 2 + 2.5,
      );
      const nearest = Math.min(...buildings.map((building) => fromBuilding(building, green)));
      expect(nearest).toBeLessThan(2.5);
      expect(green.clear).toBeLessThanOrEqual(nearest + 1e-9);
    }
    const wide = { ...TREE, radius: 2.5, perVillage: undefined };
    expect(decorationsFor(streets, 'winter-lights', { 'winter-lights': [wide] })).toEqual([]);
  });

  it('takes, of the greens a village’s tree fits on, the one whose roll is lowest', () => {
    const winter = HOLIDAY_DECORATIONS['winter-lights'] ?? [];
    const which = winter.indexOf(TREE);
    expect(which).toBeGreaterThanOrEqual(0);
    let differs = 0;
    for (const [, profile, seed] of FIXTURES) {
      const streets = streetsAt(profile, corridorOrigin(profile), seed, 0, profile.totalDistance);
      const trees = decorationsFor(streets, 'winter-lights', HOLIDAY_DECORATIONS).filter(
        (item) => item.item === VILLAGE_TREE,
      );
      for (const street of streets) {
        const fits = street.anchors.filter(
          (anchor) => anchor.kind === 'green' && anchor.clear >= TREE.radius,
        );
        const rolls = fits.map((anchor) => uniformFrom(anchor.hash, which * 2));
        const lowest = fits[rolls.indexOf(Math.min(...rolls))];
        const tree = trees.find((item) => street.anchors.includes(item.anchor));
        expect(tree?.anchor).toBe(lowest);
        if (lowest !== fits[0]) differs += 1;
      }
    }
    // Not merely the first green each time.
    expect(differs).toBeGreaterThan(0);
  });

  it('is in no other holiday', () => {
    for (const [holiday, kinds] of Object.entries(HOLIDAY_DECORATIONS)) {
      if (holiday === 'winter-lights') continue;
      expect((kinds ?? []).map((kind) => kind.item)).not.toContain(VILLAGE_TREE);
    }
  });
});
