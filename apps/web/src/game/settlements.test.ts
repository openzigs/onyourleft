// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `settlements.ts` — villages, farmsteads and the boundaries between fields,
 * #460.
 *
 * The routes are arithmetic, as every route in this repository's tests is, and
 * the claim the issue makes a number of — that buildings are GROUPED rather than
 * scattered — is measured against the scatter they replaced.
 */

import { describe, expect, it } from 'vitest';

import { distanceOnRoute, metres, positionAt, type RouteProfile } from '@onyourleft/domain';

import {
  circuitRoute,
  hairpinRoute,
  lakeValleyRoute,
  northRoute,
  steadyClimb,
  valleyRoute,
} from './route-fixtures-testing';
import { SCATTER_KINDS, scatterAt, scatterSeed, type ScatterItem } from './scatter';
import { ROAD_CLEARANCE_METRES } from './landform';
import { sceneFrame } from './scene';
import {
  BUILDING_CLEARANCE_METRES,
  CHURCH_SETBACK_METRES,
  SETBACK_METRES,
  STRUCTURE_FOOTPRINTS,
  STRUCTURE_MAX_ITEMS,
  structureClearance,
  structuresAt,
} from './settlements';
import { atStartLine } from './simulation';
import { ROAD_WIDTH_METRES, corridorOrigin, localGroundPosition } from './terrain';
import { inWater, waterways } from './waterways';

const BUILDINGS = new Set(['building', 'barn', 'church', 'shop-row', 'shed']);
const BOUNDARIES = new Set(['wall', 'hedge', 'fence']);

function built(profile: RouteProfile, from: number, to: number): readonly ScatterItem[] {
  return structuresAt(profile, corridorOrigin(profile), scatterSeed(profile), from, to, {
    maxItems: 1_000_000,
    riderMetres: 0,
  });
}

/**
 * How clustered a set of points is: the mean distance from each to its
 * nearest neighbour, over what that mean would be if the same number were
 * spread evenly along the route — a Clark–Evans ratio in one dimension. About
 * one or more is spread out; well under one is grouped.
 */
function clustering(points: readonly ScatterItem[], length: number): number {
  const nearest = points.map((point, index) => {
    let best = Number.POSITIVE_INFINITY;
    points.forEach((other, at) => {
      if (at !== index) best = Math.min(best, Math.hypot(point.x - other.x, point.z - other.z));
    });
    return best;
  });
  const mean = nearest.reduce((sum, each) => sum + each, 0) / nearest.length;
  return mean / (length / (2 * points.length));
}

/** Twenty kilometres of level, low, dry valley road: somewhere people build. */
const LONG = 20_000;
const farmland = northRoute(LONG, () => 50);

describe('buildings stand in groups, not one by one — #460', () => {
  const buildings = built(farmland, 0, LONG).filter((item) => BUILDINGS.has(item.kind));

  it('clusters them, where the scatter they replaced spread them out', () => {
    // ⚠️ **The control, which the criterion asks for, is the scatter as it was
    // before #460**, measured with this function on `main` at 45178a0 over this
    // same route: 628 buildings, a ratio of **1.348** — spread out, which is
    // what one building in seventeen of a valley floor's items is. It cannot be
    // re-run here, because #460 is what took the buildings out of the scatter;
    // the number is recorded, and the LIVE control below is the scatter's own
    // natural items through the same function, which says the measure does not
    // call everything clustered.
    const ratio = clustering(buildings, LONG);
    const shrubs = scatterAt(farmland, corridorOrigin(farmland), scatterSeed(farmland), 0, LONG, {
      maxItems: 1_000_000,
      riderMetres: 0,
    }).filter((item) => item.kind === 'shrub');
    const control = clustering(shrubs, LONG);
    // Measured: 230 buildings at 0.441, against the shrubs' 2.234.

    expect(buildings.length).toBeGreaterThan(40);
    expect(ratio).toBeLessThan(0.5);
    expect(ratio).toBeLessThan(1.348 / 3);
    expect(control).toBeGreaterThan(1);
    // And in the terms a rider sees: nearly every building has a neighbour
    // within a plot or two of it.
    const close = buildings.filter((building) =>
      buildings.some(
        (other) =>
          other !== building &&
          Math.hypot(other.x - building.x, other.z - building.z) < 2 * SETBACK_METRES + 10,
      ),
    );
    expect(close.length / buildings.length).toBeGreaterThan(0.9);
  });

  it('builds all five kinds, each where it belongs', () => {
    const kinds = new Set(buildings.map((item) => item.kind));
    expect([...kinds].sort()).toEqual(['barn', 'building', 'church', 'shed', 'shop-row']);
    // A church a village, at most — a landmark is one of a kind.
    const churches = buildings.filter((item) => item.kind === 'church').length;
    const shops = buildings.filter((item) => item.kind === 'shop-row').length;
    expect(churches).toBeGreaterThan(0);
    expect(churches).toBeLessThanOrEqual(LONG / 700);
    expect(shops).toBeGreaterThan(0);
  });

  it('faces every building to the road, at one setback a street', () => {
    // The route runs due north from its origin, so the centreline is x = 0.
    for (const building of buildings) {
      const lateral = Math.abs(building.x);
      if (building.kind === 'building' || building.kind === 'shop-row') {
        // A village's houses and shops share the street's setback; a
        // farmhouse stands further back.
        expect(lateral === SETBACK_METRES || lateral === SETBACK_METRES - 1 || lateral >= 24).toBe(
          true,
        );
      }
      if (building.kind === 'church') {
        expect(lateral).toBeCloseTo(CHURCH_SETBACK_METRES, 6);
      }
      // Its front (+z, turned by its rotation) points at the road.
      const facingX = Math.sin(building.rotation);
      expect(facingX * -Math.sign(building.x)).toBeGreaterThan(0.999);
    }
  });

  it('builds nothing on a steep road, or where there is water', () => {
    expect(built(steadyClimb(), 0, 3_000).filter((item) => BUILDINGS.has(item.kind))).toEqual([]);
    // A long level valley floor, which carries lakes AND is where people build:
    // the two have to be kept apart rather than merely rarely meeting.
    const lakeside = northRoute(6_000, (along) => {
      if (along <= 500) return 30;
      if (along <= 800) return 30 - ((along - 500) / 300) * 30;
      if (along <= 5_200) return 0;
      if (along <= 5_500) return ((along - 5_200) / 300) * 30;
      return 30;
    });
    let buildingsBesideWater = 0;
    for (const profile of [valleyRoute(), lakeValleyRoute(), lakeside]) {
      const ways = waterways(profile, scatterSeed(profile));
      // ⚠️ `z` is NOT route distance, quite: the route's length is measured
      // along the ground and the projection is equirectangular, and the two
      // part by about a metre a kilometre — enough to put a fence the wrong
      // side of a lake's shore in this very assertion. So the route distance
      // is read back through the projection's own scale.
      const end = localGroundPosition(
        corridorOrigin(profile),
        positionAt(profile, profile.totalDistance),
      );
      const scale = profile.totalDistance / end.z;
      for (const item of built(profile, 0, profile.totalDistance)) {
        // Every structure stands where the route says; x is the lateral.
        const along = distanceOnRoute(profile, item.z * scale);
        expect(inWater(ways, profile, along, -item.x), item.kind).toBe(false);
        if (
          BUILDINGS.has(item.kind) &&
          ways.lakes.some((lake) => along > lake.from - 200 && along < lake.to + 200)
        ) {
          buildingsBesideWater += 1;
        }
      }
    }
    // Non-vacuity: somewhere a settlement stands by a lake — on the dry side.
    expect(waterways(lakeside, scatterSeed(lakeside)).lakes.length).toBeGreaterThan(2);
    expect(buildingsBesideWater).toBeGreaterThan(0);
  });
});

describe('the fields are divided — #460', () => {
  const items = built(farmland, 0, 5_000);

  it('walls, hedges and fences them along the verge and out from the road', () => {
    const boundaries = items.filter((item) => BOUNDARIES.has(item.kind));
    expect(new Set(boundaries.map((item) => item.kind)).size).toBeGreaterThanOrEqual(2);
    const alongTheVerge = boundaries.filter((item) => Math.abs(Math.abs(item.x) - 5.6) < 1e-6);
    const outFromTheRoad = boundaries.filter((item) => Math.abs(item.x) > 6);
    expect(alongTheVerge.length).toBeGreaterThan(50);
    expect(outFromTheRoad.length).toBeGreaterThan(20);
    // A verge run lies along the road; a run out from it lies across.
    for (const each of alongTheVerge) {
      expect(Math.abs(Math.cos(each.rotation))).toBeGreaterThan(0.999);
    }
    for (const each of outFromTheRoad) {
      expect(Math.abs(Math.sin(each.rotation))).toBeGreaterThan(0.999);
    }
  });

  it('walls high or steep ground, and hedges and fences the low flat land', () => {
    const low = new Set(items.filter((item) => BOUNDARIES.has(item.kind)).map((item) => item.kind));
    expect(low.has('wall')).toBe(false);
    const upland = northRoute(3_000, (along) => 250 + along * 0.05);
    const high = new Set(
      built(upland, 0, 3_000)
        .filter((item) => BOUNDARIES.has(item.kind))
        .map((item) => item.kind),
    );
    expect([...high]).toEqual(['wall']);
  });
});

describe('the same place on every lap, whoever asks — #460', () => {
  it('builds the same village a lap later', () => {
    const profile = circuitRoute(1_500, () => 20);
    const plan = (items: readonly ScatterItem[]) =>
      items.map((item) => `${item.kind} ${item.x.toFixed(3)} ${item.z.toFixed(3)}`).sort();
    const first = built(profile, 1_000, 3_000);
    const third = built(
      profile,
      1_000 + 2 * profile.totalDistance,
      3_000 + 2 * profile.totalDistance,
    );
    expect(first.length).toBeGreaterThan(20);
    expect(plan(third)).toEqual(plan(first));
  });

  it('places the same things whether asked for a stretch at once or in two halves', () => {
    const plan = (items: readonly ScatterItem[]) =>
      items.map((item) => `${item.kind} ${item.x.toFixed(3)} ${item.z.toFixed(3)}`).sort();
    const whole = built(farmland, 0, 4_000);
    const halves = [...built(farmland, 0, 2_000), ...built(farmland, 2_000, 4_000)];
    expect(plan(halves)).toEqual(plan(whole));
  });

  it('keeps the houses and drops the far boundaries when the budget binds', () => {
    const origin = corridorOrigin(farmland);
    const everything = built(farmland, 0, 3_000);
    const houses = everything.filter((item) => BUILDINGS.has(item.kind)).length;
    const lean = structuresAt(farmland, origin, scatterSeed(farmland), 0, 3_000, {
      maxItems: houses + 5,
      riderMetres: 1_500,
    });
    expect(lean.filter((item) => BUILDINGS.has(item.kind))).toHaveLength(houses);
    expect(lean.length).toBe(houses + 5);
    expect(STRUCTURE_MAX_ITEMS).toBeGreaterThan(0);
  });
});

describe('a hostile route costs no more than a real one — #460', () => {
  it('places each field and site of a loop a few metres round once, not once a lap', () => {
    // A loop nineteen metres round seen across a 460 m view is two dozen laps of
    // it. Without the bound every lap placed its one field's walls again, on
    // top of themselves — a frame's worth of work and of instances for each.
    const tiny = circuitRoute(3, () => 20);
    const items = built(tiny, 0, 460);
    const plan = new Set(
      items.map((item) => `${item.kind} ${item.x.toFixed(3)} ${item.z.toFixed(3)}`),
    );
    // Non-vacuity: this loop's one field IS enclosed — without the bound it
    // came back as 98 hedges, one lap's worth over and over.
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBe(plan.size);
    expect(items.length).toBeLessThan(40);
  });
});

describe('the scenery keeps out of the gardens — #460', () => {
  it('stands no tree within reach of a building', () => {
    const origin = corridorOrigin(farmland);
    const start = atStartLine(farmland);
    let buildings = 0;
    for (let at = 0; at < 8_000; at += 230) {
      const frame = sceneFrame({
        profile: farmland,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(at) } },
      });
      const houses = frame.scatter.filter((item) => BUILDINGS.has(item.kind));
      buildings += houses.length;
      for (const tree of frame.scatter.filter((item) =>
        (SCATTER_KINDS as readonly string[]).includes(item.kind),
      )) {
        for (const house of houses) {
          expect(Math.hypot(tree.x - house.x, tree.z - house.z)).toBeGreaterThanOrEqual(
            BUILDING_CLEARANCE_METRES,
          );
        }
      }
    }
    expect(buildings).toBeGreaterThan(20);
  });
});

describe('nothing stands on the road, whichever stretch of it — #468 review B1', () => {
  /**
   * The least distance, in plan, from any point of an item's footprint to the
   * road's centreline — the route resampled every metre through
   * `positionAt`, and the footprint sampled every half metre. Deliberately a
   * different method from `settlements.ts` §`offTheRoad`, which is exact.
   */
  function centreline(profile: RouteProfile): readonly { x: number; z: number }[] {
    const origin = corridorOrigin(profile);
    const line: { x: number; z: number }[] = [];
    for (let along = 0; along <= profile.totalDistance; along += 1) {
      line.push(localGroundPosition(origin, positionAt(profile, metres(along))));
    }
    return line;
  }

  function clearance(line: readonly { x: number; z: number }[], item: ScatterItem): number {
    const footprint = STRUCTURE_FOOTPRINTS[item.kind as keyof typeof STRUCTURE_FOOTPRINTS];
    const cos = Math.cos(item.rotation);
    const sin = Math.sin(item.rotation);
    let least = Number.POSITIVE_INFINITY;
    // Only the stretches that could come within ten metres of the footprint —
    // anything a point of it is nearer than that to passes within its bounding
    // radius and ten metres of its centre. Further than that the answer is
    // `+Infinity`, which every assertion here reads as clear. Measuring every
    // stretch took six seconds on CI's first run of this under coverage.
    const radius = Math.hypot(footprint.x, Math.max(-footprint.back, footprint.front)) + 10;
    const near: [{ x: number; z: number }, { x: number; z: number }][] = [];
    for (let at = 0; at + 1 < line.length; at += 1) {
      const a = line[at] as { x: number; z: number };
      const b = line[at + 1] as { x: number; z: number };
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const span = dx * dx + dz * dz;
      const t =
        span > 0 ? Math.min(1, Math.max(0, ((item.x - a.x) * dx + (item.z - a.z) * dz) / span)) : 0;
      if (Math.hypot(item.x - (a.x + dx * t), item.z - (a.z + dz * t)) <= radius) near.push([a, b]);
    }
    const across = Math.max(1, Math.ceil((2 * footprint.x) / 0.5));
    const deep = Math.max(1, Math.ceil((footprint.front - footprint.back) / 0.5));
    for (let i = 0; i <= across; i += 1) {
      for (let j = 0; j <= deep; j += 1) {
        const lx = -footprint.x + (2 * footprint.x * i) / across;
        const lz = footprint.back + ((footprint.front - footprint.back) * j) / deep;
        // A yaw of `rotation`, as three applies it.
        const x = item.x + lx * cos + lz * sin;
        const z = item.z - lx * sin + lz * cos;
        for (const [a, b] of near) {
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const span = dx * dx + dz * dz;
          const t =
            span > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / span)) : 0;
          least = Math.min(least, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
        }
      }
    }
    return least;
  }

  it('measures a footprint against the road exactly, whatever way it is turned', () => {
    // The exact measure against the sampled one, over every kind at scattered
    // places and headings around a hairpin — its two legs and its bend — so a
    // footprint that straddles the road, one turned the wrong way, and one
    // measured from its centre alone all disagree with the samples.
    const profile = hairpinRoute(20);
    const origin = corridorOrigin(profile);
    const line = centreline(profile);
    let state = 12_345;
    const next = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    let near = 0;
    let straddling = 0;
    for (const kind of Object.keys(STRUCTURE_FOOTPRINTS)) {
      for (let trial = 0; trial < 40; trial += 1) {
        const item: ScatterItem = {
          kind: kind as ScatterItem['kind'],
          x: -25 + 70 * next(),
          y: 0,
          z: 300 + 200 * next(),
          rotation: 2 * Math.PI * next(),
          scale: 1,
          variant: 0,
        };
        const exact = structureClearance(profile, origin, item);
        const sampled = clearance(line, item);
        // Within the reach that matters — past it the grid is not searched
        // and the answer is only a bound — the samples can only ever be
        // further than the truth, and by no more than half a sample.
        if (sampled < ROAD_CLEARANCE_METRES) {
          near += 1;
          if (sampled < 0.5) straddling += 1;
          expect(exact).toBeLessThanOrEqual(sampled + 1e-9);
          expect(sampled - exact, `${kind} at trial ${String(trial)}`).toBeLessThan(0.45);
        }
      }
    }
    // Non-vacuity: plenty of the trials came close, and many stood on the road
    // — 118 and 82 of 360, measured.
    expect(near).toBeGreaterThan(60);
    expect(straddling).toBeGreaterThan(40);
  });

  it('keeps every wall, hedge, fence and building off the far leg of a hairpin', () => {
    // #468's review measured, on this PR's first head, a wall 1.61 m from the
    // centreline of a 20 m hairpin and 2.40 m on a 10 m one: on the tarmac,
    // which is 3.5 m either side of it. A boundary runs 48 m straight out from
    // the road, and nothing asked what else was there.
    let between = 0;
    for (const radius of [10, 20, 40]) {
      const profile = hairpinRoute(radius);
      const line = centreline(profile);
      for (const item of built(profile, 0, profile.totalDistance)) {
        expect(
          clearance(line, item),
          `${item.kind} at (${item.x.toFixed(1)}, ${item.z.toFixed(1)}) on a ${String(radius)} m hairpin`,
        ).toBeGreaterThanOrEqual(ROAD_WIDTH_METRES / 2);
        // The hairpin's two legs run north at x = 0 and x = 2r: count what
        // stands in the gap between them, along the straights.
        if (item.x > 0 && item.x < 2 * radius && item.z < 350) between += 1;
      }
    }
    // Non-vacuity: the fixture really does enclose the fields between the
    // two legs, so the assertion above had boundaries there to judge.
    expect(between).toBeGreaterThan(50);
  });
});
