// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1550: procedural lots in a mapped town with no footprints — `settlements.ts`
 * §`lotsAt`, read back through `structuresAt` and `sceneFrame`, the paths a
 * ride's frames take. Every rule is asserted with its control: the same call
 * with the rule's input taken away, which must produce what the rule forbids.
 *
 * The towns are arithmetic in local metres beside routes from
 * `route-fixtures-testing.ts`: nothing here is a real place, and no
 * OpenStreetMap data.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature, LandUseFeature } from '@onyourleft/map-features';

import { lotClad, lotPaintChannel, lotPaintEntry } from './building-paint';
import { footprintPlans, mappedTown } from './footprint-buildings';
import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { landClassMask, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { circuitRoute, hairpinRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed, type ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import {
  BUILDING_CLEARANCE_METRES,
  LOT_FLOATS,
  LOT_SHOP_EVERY,
  NO_MAPPED_TOWN,
  PLOT_BUILT_SHARE,
  SETBACK_METRES,
  STRUCTURE_FOOTPRINTS,
  footprintIndexOf,
  lotSpacing,
  placeLot,
  lotsAt,
  structureClearance,
  structuresAt,
  type MappedTown,
} from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, type CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const ALL = { maxItems: 1_000_000, riderMetres: 0 } as const;

/** A corridor of the given land use and footprints, every tile covered. */
function corridorOf(
  origin: CorridorOrigin,
  landUse: readonly LandUseFeature[],
  buildings: readonly BuildingFeature[] = [],
): WorldCorridor {
  return {
    routeId: 'lots-fixture',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -3_000, maxZ: 3_000 }],
    landUse,
    buildings,
    paths: [],
    streets: [],
  };
}

/** A residential square `half` metres either way of the origin's local frame: built-up everywhere. */
function residentialEverywhere(half: number): LandUseFeature {
  return {
    layer: 'landuse',
    kind: 'residential',
    rings: [Float32Array.of(-half, -half, half, -half, half, half, -half, half)],
  };
}

interface Town {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly corridor: WorldCorridor;
  readonly land: LandClassMask;
  readonly town: MappedTown;
}

function townOf(
  profile: RouteProfile,
  landUse: (origin: CorridorOrigin) => readonly LandUseFeature[],
  buildings: (origin: CorridorOrigin) => readonly BuildingFeature[] = () => [],
): Town {
  const origin = corridorOrigin(profile);
  const corridor = corridorOf(origin, landUse(origin), buildings(origin));
  const land = landClassMask(corridor);
  return {
    profile,
    origin,
    seed: scatterSeed(profile),
    corridor,
    land,
    town: mappedTown(corridor, footprintPlans(corridor, land, profile, origin).plans),
  };
}

function structuresOf(
  town: Town,
  from = 0,
  to: number = town.profile.totalDistance,
): readonly ScatterItem[] {
  return structuresAt(
    town.profile,
    town.origin,
    town.seed,
    from,
    to,
    ALL,
    undefined,
    town.land,
    town.town,
  );
}

function lotsOf(
  town: Town,
  from: number,
  to: number,
  mapped: MappedTown = town.town,
): ScatterItem[] {
  const found: ScatterItem[] = [];
  lotsAt(town.profile, town.origin, town.seed, from, to, town.land, mapped, found);
  return found;
}

/** The four corners of an item's footprint in plan — a yaw of `rotation`, as three applies it. */
function cornersOf(item: ScatterItem): readonly (readonly [number, number])[] {
  const footprint = STRUCTURE_FOOTPRINTS[item.kind as keyof typeof STRUCTURE_FOOTPRINTS];
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  return [
    [-footprint.x, footprint.back],
    [footprint.x, footprint.back],
    [footprint.x, footprint.front],
    [-footprint.x, footprint.front],
  ].map(
    ([lx, lz]) =>
      [
        item.x + (lx as number) * cos + (lz as number) * sin,
        item.z - (lx as number) * sin + (lz as number) * cos,
      ] as const,
  );
}

/**
 * The least distance in plan between an item's footprint and a ring — by a
 * different method from `settlements.ts` §`footprintIndexOf`: the footprint's
 * outline sampled every 10 cm against the ring's edges, and 0 where either
 * holds a point of the other.
 */
function apart(item: ScatterItem, ring: Float32Array): number {
  const corners = cornersOf(item);
  const inside = (
    polygon: readonly (readonly [number, number])[],
    x: number,
    z: number,
  ): boolean => {
    let within = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const [xi, zi] = polygon[i] as readonly [number, number];
      const [xj, zj] = polygon[j] as readonly [number, number];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
    }
    return within;
  };
  const points: [number, number][] = [];
  for (let at = 0; at + 1 < ring.length; at += 2)
    points.push([ring[at] as number, ring[at + 1] as number]);
  if (points.some(([x, z]) => inside(corners, x, z))) return 0;
  let least = Number.POSITIVE_INFINITY;
  for (let side = 0; side < 4; side += 1) {
    const [ax, az] = corners[side] as readonly [number, number];
    const [bx, bz] = corners[(side + 1) % 4] as readonly [number, number];
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
    for (let step = 0; step <= steps; step += 1) {
      const x = ax + ((bx - ax) * step) / steps;
      const z = az + ((bz - az) * step) / steps;
      if (inside(points, x, z)) return 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const [px, pz] = points[j] as [number, number];
        const [qx, qz] = points[i] as [number, number];
        const dx = qx - px;
        const dz = qz - pz;
        const span = dx * dx + dz * dz;
        const t = span > 0 ? Math.min(1, Math.max(0, ((x - px) * dx + (z - pz) * dz) / span)) : 0;
        least = Math.min(least, Math.hypot(x - (px + dx * t), z - (pz + dz * t)));
      }
    }
  }
  return least;
}

/** Where an item stands against the drawn road at `along`: across (on the normal's side) and along. */
function besideAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  along: number,
  item: ScatterItem,
): { readonly across: number; readonly along: number } {
  const frame = drawnRoadFrame(profile, origin, along);
  if (frame === undefined) throw new Error('no road there');
  const dx = item.x - frame.x;
  const dz = item.z - frame.z;
  return {
    across: dx * frame.normalX + dz * frame.normalZ,
    along: along + dx * frame.normalZ - dz * frame.normalX,
  };
}

function keyOf(item: ScatterItem): string {
  return `${item.kind} ${item.x.toFixed(3)} ${item.z.toFixed(3)} ${item.rotation.toFixed(6)}`;
}

const BUILT = new Set(['building', 'shop-row']);

// Two level kilometres due north; a residential polygon from 500 m to 900 m
// along, 60 m either side of the road, and no footprints in it.
const straight = northRoute(2_000, () => 10);
const residential = townOf(straight, (origin) => [
  landBeside(straight, origin, 'landuse', 'residential', 500, 900, -60, 60),
]);

describe('#1550 lots fill a mapped town with no footprints', () => {
  it('stands houses on both sides of 400 m of residential road, at the plots’ spacing', () => {
    const { profile, origin } = residential;
    const houses = structuresOf(residential).filter((item) => BUILT.has(item.kind));
    expect(new Set(houses.map((item) => item.kind))).toStrictEqual(new Set(['building']));
    const { span } = lotSpacing(profile);
    // Every plot whose house would sit wholly inside the polygon is a candidate.
    const half = STRUCTURE_FOOTPRINTS.building.x;
    let candidates = 0;
    for (let plot = 0; (plot + 0.5) * span < profile.totalDistance; plot += 1) {
      const along = (plot + 0.5) * span;
      if (along - half > 500 && along + half < 900) candidates += 2;
    }
    const placed = houses.map((item) => besideAt(profile, origin, 700, item));
    for (const side of [1, -1]) {
      const row = placed
        .filter((at) => Math.sign(at.across) === side)
        .sort((a, b) => a.along - b.along);
      expect(row.length, `side ${String(side)}`).toBeGreaterThan(5);
      for (const at of row) {
        // At the setback, facing the road, and inside the polygon.
        expect(Math.abs(Math.abs(at.across) - SETBACK_METRES)).toBeLessThan(0.01);
        expect(at.along).toBeGreaterThan(500);
        expect(at.along).toBeLessThan(900);
      }
      for (let index = 1; index < row.length; index += 1) {
        const gap =
          ((row[index] as { along: number }).along - (row[index - 1] as { along: number }).along) /
          span;
        expect(Math.abs(gap - Math.round(gap))).toBeLessThan(0.01);
        expect(Math.round(gap)).toBeGreaterThanOrEqual(1);
      }
    }
    // PLOT_BUILT_SHARE (0.8) of the candidates, by a hash: the PR states the count.
    const share = houses.length / candidates;
    expect(candidates).toBe(44);
    expect(houses.length).toBe(34);
    expect(share).toBeGreaterThan(PLOT_BUILT_SHARE - 0.2);
    expect(share).toBeLessThan(PLOT_BUILT_SHARE + 0.15);
  });

  it('builds a row of shops on every fifth plot of commercial land, and no church or signpost', () => {
    const town = townOf(straight, (origin) => [
      landBeside(straight, origin, 'landuse', 'commercial', 500, 900, -60, 60),
    ]);
    const built = structuresOf(town);
    const shops = built.filter((item) => item.kind === 'shop-row');
    expect(shops.length).toBeGreaterThan(0);
    const { span } = lotSpacing(straight);
    for (const shop of shops) {
      const along = besideAt(straight, town.origin, 700, shop).along;
      expect(Math.round(along / span - 0.5) % LOT_SHOP_EVERY).toBe(0);
    }
    expect(
      built.filter((item) => item.kind === 'church' || item.kind === 'signpost'),
    ).toStrictEqual([]);
    // Control: residential land on the same plots builds houses there and no shops.
    expect(structuresOf(residential).filter((item) => item.kind === 'shop-row')).toStrictEqual([]);
  });
});

describe('#1550 none where a footprint stands', () => {
  // Three footprints beside the road inside the residential land, as #1544's
  // block puts three in its block.
  const block = townOf(
    straight,
    (origin) => [landBeside(straight, origin, 'landuse', 'residential', 500, 900, -60, 60)],
    (origin) => [
      buildingBeside(straight, origin, [rectangleBeside(600, 20, 14, 10)], 6),
      buildingBeside(straight, origin, [rectangleBeside(660, -22, 12, 12)], 9.5),
      buildingBeside(straight, origin, [rectangleBeside(740, 19, 20, 8)]),
    ],
  );
  const plans = footprintPlans(block.corridor, block.land, block.profile, block.origin).plans;

  /** Every lot that comes within the clearance of a kept plan. */
  const overlapping = (items: readonly ScatterItem[]): number =>
    items.filter(
      (item) =>
        BUILT.has(item.kind) &&
        plans.some((plan) => apart(item, plan.footprint) < BUILDING_CLEARANCE_METRES - 0.05),
    ).length;

  it('keeps every lot clear of a kept plan grown by the clearance', () => {
    expect(plans).toHaveLength(3);
    const built = structuresOf(block);
    expect(built.filter((item) => BUILT.has(item.kind)).length).toBeGreaterThan(10);
    expect(overlapping(built)).toBe(0);
  });

  it('control: with rule 2 off the same town stands at least one lot on a footprint', () => {
    expect(overlapping(lotsOf(block, 0, straight.totalDistance, NO_MAPPED_TOWN))).toBeGreaterThan(
      0,
    );
  });

  it('reads the footprints through the real scene, as a ride does', () => {
    const start = atStartLine(straight);
    const frame = sceneFrame({
      profile: straight,
      origin: block.origin,
      state: { ...start, ride: { ...start.ride, distance: metres(650) } },
      worldCorridor: block.corridor,
      landClass: block.land,
      mappedTown: block.town,
    });
    const houses = frame.scatter.filter((item) => BUILT.has(item.kind));
    expect(houses.length).toBeGreaterThan(5);
    expect(overlapping(houses)).toBe(0);
    // The `-lots` control: the same frame with none.
    const off = sceneFrame({
      profile: straight,
      origin: block.origin,
      state: { ...start, ride: { ...start.ride, distance: metres(650) } },
      worldCorridor: block.corridor,
      landClass: block.land,
      mappedTown: block.town,
      lotsOff: true,
    });
    expect(off.scatter.filter((item) => BUILT.has(item.kind))).toStrictEqual([]);
  });

  it('measures a footprint against a ring exactly, whatever way it is turned', () => {
    // The index's exact measure against the sampled one, at scattered places
    // and headings around one footprint.
    const ring = (plans[0] as (typeof plans)[number]).footprint;
    const index = footprintIndexOf([ring]);
    let near = 0;
    let far = 0;
    for (let step = 0; step < 400; step += 1) {
      const angle = step * 2.399;
      const reach = 4 + (step % 25);
      const item: ScatterItem = {
        kind: 'building',
        x: (ring[0] as number) + reach * Math.cos(angle),
        z: (ring[1] as number) + reach * Math.sin(angle),
        y: 0,
        rotation: step * 0.731,
        scale: 1,
        variant: 0,
      };
      const sampled = apart(item, ring);
      if (Math.abs(sampled - BUILDING_CLEARANCE_METRES) < 0.1) continue;
      const overlaps = index.overlaps(
        placeLot(
          new Float64Array(LOT_FLOATS),
          item.x,
          item.z,
          STRUCTURE_FOOTPRINTS.building,
          item.rotation,
        ),
      );
      expect(overlaps, `step ${String(step)}`).toBe(sampled < BUILDING_CLEARANCE_METRES);
      if (overlaps) near += 1;
      else far += 1;
    }
    expect(near).toBeGreaterThan(50);
    expect(far).toBeGreaterThan(50);
  });

  it('counts a lot standing wholly inside a footprint, far from all its edges', () => {
    // A 120 m square, and a house at its middle 55 m from every edge.
    const square = Float32Array.of(0, 0, 120, 0, 120, 120, 0, 120);
    const index = footprintIndexOf([square]);
    const lot = new Float64Array(LOT_FLOATS);
    expect(index.overlaps(placeLot(lot, 60, 60, STRUCTURE_FOOTPRINTS.building, 0.3))).toBe(true);
    // Control: the same house 30 m outside it.
    expect(index.overlaps(placeLot(lot, 60, 155, STRUCTURE_FOOTPRINTS.building, 0.3))).toBe(false);
  });
});

describe('#1550 never on wood, water or park', () => {
  // Residential land on the right from 500 m to 900 m wrapping a park, and on
  // the left wrapping a pond; each reaches to 17 m out, inside a house's back
  // corners (19.5 m) and outside its centre (15 m).
  const wrapped = townOf(straight, (origin) => [
    landBeside(straight, origin, 'landuse', 'residential', 500, 900, -80, 80),
    landBeside(straight, origin, 'landuse', 'park', 600, 660, 17, 50),
    landBeside(straight, origin, 'water', 'lake', 740, 800, -50, -17),
  ]);
  const excluded = (item: ScatterItem): boolean =>
    cornersOf(item).some(([x, z]) => {
      const here = wrapped.land.classAt(x, z);
      return here === 'park' || here === 'water' || here === 'wood';
    });

  it('stands no lot with a corner in the park or the pond', () => {
    const houses = structuresOf(wrapped).filter((item) => BUILT.has(item.kind));
    expect(houses.length).toBeGreaterThan(10);
    expect(houses.filter(excluded)).toStrictEqual([]);
    for (const item of houses) {
      expect(['park', 'water', 'wood']).not.toContain(wrapped.land.classAt(item.x, item.z));
    }
  });

  it('control: a centre-only rule 1 would stand a lot with a corner in the park', () => {
    // Rule 1 without its corners, by hand, over the same plots and the same share.
    const { profile, origin, seed, land } = wrapped;
    const centreOnly: MappedTown = {
      ...NO_MAPPED_TOWN,
      overlaps: () => false,
    };
    const centreMask: LandClassMask = {
      ...land,
      // Every query but a lot's centre reads built-up, which takes the corners out of rule 1.
      classAt: (x, z) => {
        const here = land.classAt(x, z);
        const centre =
          Math.abs(
            Math.abs(besideAt(profile, origin, 700, { x, z } as ScatterItem).across) -
              SETBACK_METRES,
          ) < 1e-3;
        return centre ? here : 'built-up';
      },
    };
    const found: ScatterItem[] = [];
    lotsAt(profile, origin, seed, 0, profile.totalDistance, centreMask, centreOnly, found);
    expect(found.filter(excluded).length).toBeGreaterThan(0);
  });
});

describe('#1550 nothing on any stretch of the road', () => {
  it('keeps no lot within the road’s clearance of either leg of a built-up hairpin', () => {
    for (const radius of [10, 20]) {
      const town = townOf(hairpinRoute(radius), () => [residentialEverywhere(1_500)]);
      const lots = structuresOf(town).filter((item) => BUILT.has(item.kind));
      expect(lots.length).toBeGreaterThan(20);
      for (const item of lots) {
        expect(structureClearance(town.profile, town.origin, item)).toBeGreaterThanOrEqual(
          ROAD_CLEARANCE_METRES,
        );
      }
    }
  });

  it('control: the inside of a 10 m hairpin offers lots that reach the other leg', () => {
    const town = townOf(hairpinRoute(10), () => [residentialEverywhere(1_500)]);
    const raw = lotsOf(town, 0, town.profile.totalDistance);
    expect(
      raw.filter(
        (item) => structureClearance(town.profile, town.origin, item) < ROAD_CLEARANCE_METRES,
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('#1550 lap two is lap one', () => {
  const circuit = circuitRoute(300);
  const town = townOf(circuit, () => [residentialEverywhere(1_500)]);
  const length: number = circuit.totalDistance;

  it('partitions the lots between two adjacent spans', () => {
    const whole = lotsOf(town, 0, length).map(keyOf);
    expect(whole.length).toBeGreaterThan(20);
    // Cut exactly at a plot's centre where a lot stands, so a span closed at
    // its far end would hold that lot twice.
    const { plots, span } = lotSpacing(circuit);
    let plot = Math.floor(plots * 0.37);
    while (lotsOf(town, (plot + 0.5) * span, (plot + 0.5) * span + 1).length === 0) plot += 1;
    const cut = (plot + 0.5) * span;
    const halves = [...lotsOf(town, 0, cut), ...lotsOf(town, cut, length)].map(keyOf);
    expect(halves).toStrictEqual(whole);
    expect(new Set(whole).size).toBe(whole.length);
  });

  it('stands the same lots on the second lap as on the first', () => {
    const first = structuresOf(town, 0, length).map(keyOf);
    const second = structuresOf(town, length, 2 * length).map(keyOf);
    expect(first.filter((key) => key.startsWith('building')).length).toBeGreaterThan(20);
    expect(second).toStrictEqual(first);
    // And a view that spans the seam holds each place once (`distinctPlaces`).
    const seam = structuresOf(town, length - 200, length + 200).map(keyOf);
    expect(new Set(seam).size).toBe(seam.length);
  });
});

describe('#1550 uncovered land is today’s', () => {
  /** A mask that read something somewhere, and answers `here` everywhere. */
  const everywhere = (here: 'unknown' | 'built-up'): LandClassMask => ({
    ...residential.land,
    classAt: () => here,
  });

  it('adds nothing on land no tile covered, where the ride did read some', () => {
    expect(lotsOf({ ...residential, land: everywhere('unknown') }, 0, 2_000)).toStrictEqual([]);
  });

  it('control: the same mask answering built-up adds lots', () => {
    expect(
      lotsOf({ ...residential, land: everywhere('built-up') }, 0, 2_000).length,
    ).toBeGreaterThan(50);
  });

  it('adds nothing with NO_LAND_CLASS, whatever the town', () => {
    expect(
      lotsOf({ ...residential, land: NO_LAND_CLASS }, 0, straight.totalDistance),
    ).toStrictEqual([]);
    // And structuresAt over the same route is what it was with no town at all.
    const today = structuresAt(straight, residential.origin, residential.seed, 0, 2_000, ALL);
    expect(
      structuresAt(
        straight,
        residential.origin,
        residential.seed,
        0,
        2_000,
        ALL,
        undefined,
        NO_LAND_CLASS,
        residential.town,
      ),
    ).toStrictEqual(today);
  });

  it('control: the same call with the town’s own mask adds lots', () => {
    expect(lotsOf(residential, 0, straight.totalDistance).length).toBeGreaterThan(0);
  });
});

describe('#1581 a lot is painted unlike the lots beside it', () => {
  it('paints every lot, and no two a plot apart or across the road alike, through the real scene', () => {
    const start = atStartLine(straight);
    const frame = sceneFrame({
      profile: straight,
      origin: residential.origin,
      state: { ...start, ride: { ...start.ride, distance: metres(700) } },
      worldCorridor: residential.corridor,
      landClass: residential.land,
    });
    const lots = frame.scatter.filter((item) => BUILT.has(item.kind));
    expect(lots.length).toBeGreaterThan(10);
    const { span } = lotSpacing(straight);
    let neighbours = 0;
    for (const lot of lots) {
      expect(lotPaintChannel(lot.paint, 'wall'), 'a lot wears a wall paint').toBeGreaterThan(0);
      const here = besideAt(straight, residential.origin, 700, lot);
      for (const other of lots) {
        if (other === lot) continue;
        const there = besideAt(straight, residential.origin, 700, other);
        const plots = Math.round(Math.abs(there.along - here.along) / span);
        const across = Math.sign(there.across) !== Math.sign(here.across);
        // The next lot along on its side, and the three across the road from it.
        if ((plots === 1 && !across) || (plots <= 1 && across)) {
          // Since #1588 a channel carries the cladding too: the colouring is the entry's.
          expect(lotPaintEntry(other.paint, 'wall')).not.toBe(lotPaintEntry(lot.paint, 'wall'));
          expect(lotPaintEntry(other.paint, 'roof')).not.toBe(lotPaintEntry(lot.paint, 'roof'));
          neighbours += 1;
        }
      }
    }
    expect(neighbours).toBeGreaterThan(lots.length);
    // #1588: most house lots are clad, in clapboard and under shingles; a shop never.
    const houses = lots.filter((lot) => lot.kind === 'building');
    expect(houses.filter((lot) => lotClad(lot.paint, 'wall')).length).toBeGreaterThan(
      houses.length / 2,
    );
    expect(houses.filter((lot) => lotClad(lot.paint, 'roof')).length).toBeGreaterThan(
      houses.length / 2,
    );
    for (const shop of lots.filter((lot) => lot.kind === 'shop-row')) {
      expect(lotClad(shop.paint, 'wall')).toBe(false);
    }
  });

  it('control: a village’s houses, on land no map covered, carry no paint', () => {
    const today = structuresAt(straight, residential.origin, residential.seed, 0, 2_000, ALL);
    const houses = today.filter((item) => BUILT.has(item.kind));
    expect(houses.length).toBeGreaterThan(0);
    for (const house of houses) expect(house.paint).toBeUndefined();
  });
});
