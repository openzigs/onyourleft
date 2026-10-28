// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1808's pick: each Delivery round's targets, from the mapped houses the
 * town draws, by a seed drawn fresh for the round (DL6, DL11; ADR 0059 D-3,
 * D-4). Every town here is synthetic (`footprint-fixtures-testing.ts`), and
 * no test name or message carries a coordinate.
 */

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import { importWalk, readFromDisk, specifiersIn } from '../../camera/import-walk-testing';
import { DOORSTEP_OUT_METRES, footprintPlans, type FootprintPlan } from '../footprint-buildings';
import {
  buildingBeside,
  landBeside,
  rectangleBeside,
  rowTownFixture,
} from '../footprint-fixtures-testing';
import { landClassMask } from '../land-class';
import {
  mappedBuildingsOf,
  mappedChunk,
  MappedSelection,
  selectMappedBuildings,
} from '../mapped-buildings';
import {
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_TRIANGLES,
  MAPPED_CHUNK_METRES,
} from '../realistic-budget';
import { nearestOnDrawnRoad } from '../road-grid';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import { corridorOrigin, drawnRoadPosition, type CorridorOrigin } from '../terrain';
import type { UrbanClass } from '../urban-class';
import type { WorldCorridor } from '../world-data/corridor';

import { FIRST_DAY_HOUSES, MOST_HOUSES } from './round';
import {
  drawRoundSeed,
  pickRoundTargets,
  TARGET_MOST_FROM_ROAD_METRES,
  TARGET_SPACING_METRES,
  TARGET_WINDOW_HALF_METRES,
  type DeliveryTarget,
  type TargetPick,
  type TargetPickInput,
} from './targets';

/** A corridor of `buildings` about `origin`, all of it covered and none of it classed. */
function corridorOf(origin: CorridorOrigin, buildings: readonly BuildingFeature[]): WorldCorridor {
  return {
    routeId: 'delivery-fixture',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -5_000, maxX: 5_000, minZ: -5_000, maxZ: 5_000 }],
    landUse: [],
    buildings,
    paths: [],
    streets: [],
  };
}

function plansOf(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): readonly FootprintPlan[] {
  return footprintPlans(corridor, landClassMask(corridor), profile, origin).plans;
}

const town = rowTownFixture();
const townPlans = plansOf(town.corridor, town.profile, town.origin);
const townBuildings = mappedBuildingsOf(townPlans);

/** The rider starts the round 300 m in: chunk 3, so the first window opens past 400 m. */
const RIDER = 300;

function townInput(overrides: Partial<TargetPickInput> = {}): TargetPickInput {
  return {
    buildings: townBuildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: RIDER,
    houses: FIRST_DAY_HOUSES,
    ...overrides,
  };
}

/** The plan a target was picked from: the one whose front step it is. */
function planOf(plans: readonly FootprintPlan[], target: DeliveryTarget): number {
  const index = plans.findIndex(
    (plan) => plan.frontStep?.x === target.x && plan.frontStep.z === target.z,
  );
  if (index < 0) throw new Error('a target matches no planned front step');
  return index;
}

/**
 * Every rider distance at which a target's window is open, as the pick's own
 * check is NOT trusted to name them: each whole metre of the window, and the
 * start of every refill chunk it touches.
 */
function windowDistances(target: DeliveryTarget): number[] {
  const from = target.distance - TARGET_WINDOW_HALF_METRES;
  const to = target.distance + TARGET_WINDOW_HALF_METRES;
  const at: number[] = [];
  for (let chunk = mappedChunk(from); chunk <= mappedChunk(to); chunk += 1) {
    at.push(chunk * MAPPED_CHUNK_METRES);
  }
  for (let metre = Math.ceil(from); metre <= to; metre += 1) at.push(metre);
  return at;
}

/** The plans drawn with the rider at `distance`, read through the renderer's own selection. */
function drawnWith(
  plans: readonly FootprintPlan[],
  profile: RouteProfile,
  origin: CorridorOrigin,
  distance: number,
  budget: number,
): Set<number> {
  const selection = new MappedSelection();
  const here = drawnRoadPosition(profile, origin, distance);
  selectMappedBuildings(mappedBuildingsOf(plans), here.x, here.z, budget, selection);
  return new Set(selection.plans.subarray(0, selection.count));
}

describe('#1808 — a mapped house’s front step, planned with the house', () => {
  const withStep = townPlans.filter((plan) => plan.frontStep !== undefined);

  it('gives the houses facing the road a doorstep or a porch step, by their porch', () => {
    expect(withStep.length).toBeGreaterThan(MAPPED_BUILDING_MAX);
    const kinds = new Set(withStep.map((plan) => plan.frontStep?.kind));
    expect(kinds).toEqual(new Set(['doorstep', 'porch-step']));
    for (const plan of withStep) {
      expect(plan.frontStep?.kind).toBe(plan.porch ? 'porch-step' : 'doorstep');
    }
  });

  it('stands each front step out from the house, toward the road, facing it', () => {
    for (const plan of withStep) {
      const step = plan.frontStep as NonNullable<FootprintPlan['frontStep']>;
      const stepFromRoad = nearestOnDrawnRoad(town.profile, town.origin, step.x, step.z, 500);
      const houseFromRoad = nearestOnDrawnRoad(
        town.profile,
        town.origin,
        plan.centroid.x,
        plan.centroid.z,
        500,
      );
      expect(stepFromRoad?.distance).toBeLessThan(houseFromRoad?.distance ?? 0);
      // The yaw turns an item's +z to face out of the wall: toward the road, here.
      const road = drawnRoadPosition(town.profile, town.origin, stepFromRoad?.along ?? 0);
      const facing =
        Math.sin(step.yaw) * (road.x - step.x) + Math.cos(step.yaw) * (road.z - step.z);
      expect(facing).toBeGreaterThan(0);
    }
    const doorstep = withStep.find((plan) => plan.frontStep?.kind === 'doorstep');
    expect(doorstep).toBeDefined();
  });

  it('gives a shop no front step', () => {
    const profile = northRoute(1_000, () => 10);
    const origin = corridorOrigin(profile);
    const corridor: WorldCorridor = {
      ...corridorOf(origin, [
        buildingBeside(profile, origin, [rectangleBeside(300, 15, 10, 8)], 6),
      ]),
      landUse: [landBeside(profile, origin, 'landuse', 'retail', 100, 900, -100, 100)],
    };
    const plans = plansOf(corridor, profile, origin);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.shop.front).toBe(true);
    expect(plans[0]?.frontStep).toBeUndefined();
  });

  it('gives a home with a shop front, as a city centre draws one, no front step', () => {
    const profile = northRoute(1_000, () => 10);
    const origin = corridorOrigin(profile);
    const corridor = corridorOf(
      origin,
      [300, 340, 380].map((along) =>
        buildingBeside(profile, origin, [rectangleBeside(along, 15, 12, 8)], 6),
      ),
    );
    const planned = (urban: UrbanClass): readonly FootprintPlan[] =>
      footprintPlans(corridor, landClassMask(corridor), profile, origin, undefined, {
        classAt: () => urban,
      }).plans;
    const city = planned('city-centre');
    expect(city.length).toBeGreaterThan(0);
    for (const plan of city) {
      expect(plan.shop.front).toBe(true);
      expect(plan.frontStep).toBeUndefined();
    }
    // The control: the same homes in a town have no shop front, and a front step each.
    for (const plan of planned('town')) {
      expect(plan.shop.front).toBe(false);
      expect(plan.frontStep).toBeDefined();
    }
  });

  it('puts a doorstep its own distance out from the front wall', () => {
    const profile = northRoute(1_000, () => 10);
    const origin = corridorOrigin(profile);
    // Seeded porches: of a few houses, one with none.
    const buildings = Array.from({ length: 12 }, (_, index) =>
      buildingBeside(profile, origin, [rectangleBeside(200 + index * 40, 15, 10, 8)], 6),
    );
    const plans = plansOf(corridorOf(origin, buildings), profile, origin);
    const plain = plans.find((plan) => plan.frontStep?.kind === 'doorstep');
    expect(plain).toBeDefined();
    const step = plain?.frontStep as NonNullable<FootprintPlan['frontStep']>;
    // The front wall is 11 m out (15 less half the 8 m depth); the step stands before it.
    const across = nearestOnDrawnRoad(profile, origin, step.x, step.z, 100);
    expect(Math.abs(across?.lateral ?? 0)).toBeCloseTo(11 - DOORSTEP_OUT_METRES, 1);
  });
});

describe('#1808 — the pick', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the round size asked for, ahead of the rider, in route order, windows apart', () => {
    const pick = pickRoundTargets(townInput(), 7);
    expect(pick.complete).toBe(true);
    expect(pick.wanted).toBe(FIRST_DAY_HOUSES);
    expect(pick.targets).toHaveLength(FIRST_DAY_HOUSES);
    const firstOpen = (mappedChunk(RIDER) + 1) * MAPPED_CHUNK_METRES;
    pick.targets.forEach((target, position) => {
      expect(target.position).toBe(position);
      expect(target.distance - TARGET_WINDOW_HALF_METRES).toBeGreaterThanOrEqual(firstOpen);
      expect(target.fromRoad).toBeLessThanOrEqual(TARGET_MOST_FROM_ROAD_METRES);
      const before = pick.targets[position - 1];
      if (before !== undefined) {
        expect(target.distance - before.distance).toBeGreaterThanOrEqual(TARGET_SPACING_METRES);
      }
    });
  });

  it('reports each target on the side of the road its house stands', () => {
    const pick = pickRoundTargets(townInput({ houses: MOST_HOUSES }), 11);
    for (const target of pick.targets) {
      const across = nearestOnDrawnRoad(town.profile, town.origin, target.x, target.z, 100);
      expect(target.side).toBe((across?.lateral ?? 0) >= 0 ? 1 : -1);
    }
    expect(new Set(pick.targets.map((target) => target.side))).toEqual(new Set([1, -1]));
  });

  it('gives the same pick for the same seed and input', () => {
    expect(pickRoundTargets(townInput(), 42)).toEqual(pickRoundTargets(townInput(), 42));
  });

  it('gives different picks for different seeds on a town with enough houses', () => {
    const distances = (seed: number): number[] =>
      pickRoundTargets(townInput(), seed).targets.map((target) => target.distance);
    expect(distances(1)).not.toEqual(distances(2));
    expect(distances(2)).not.toEqual(distances(3));
  });

  it('does not simply take the next houses along: the seeded share skips some', () => {
    // Route order alone, spaced, would take a house every spacing from the first window.
    const pick = pickRoundTargets(townInput(), 5);
    const gaps = pick.targets.slice(1).map((target, at) => {
      return target.distance - (pick.targets[at] as DeliveryTarget).distance;
    });
    expect(Math.max(...gaps)).toBeGreaterThan(TARGET_SPACING_METRES + 12);
  });
});

describe('#1808 — only houses the town draws', () => {
  it('picks, in a town larger than MAPPED_BUILDING_MAX, only houses drawn wherever their window is open', () => {
    expect(townPlans.length).toBeGreaterThan(MAPPED_BUILDING_MAX);
    for (const seed of [1, 2, 3]) {
      const pick = pickRoundTargets(townInput({ houses: MOST_HOUSES }), seed);
      expect(pick.targets).toHaveLength(MOST_HOUSES);
      for (const target of pick.targets) {
        const index = planOf(townPlans, target);
        for (const at of windowDistances(target)) {
          const drawn = drawnWith(
            townPlans,
            town.profile,
            town.origin,
            at,
            MAPPED_BUILDING_TRIANGLES,
          );
          expect(drawn.has(index), `round position ${String(target.position)}`).toBe(true);
        }
      }
    }
  });

  it('passes over a house that falls out of the drawn set inside its window', () => {
    // A budget of a few buildings: the drawn set is the few nearest, and a house
    // beside the road drops out of it as the rider rides away from it.
    const budget = 6 * (townPlans[0]?.triangleCount ?? 0);
    const input = townInput({ houses: MOST_HOUSES, triangleBudget: budget });
    const pick = pickRoundTargets(input, 3);
    expect(pick.targets.length).toBeGreaterThan(0);
    for (const target of pick.targets) {
      const index = planOf(townPlans, target);
      for (const at of windowDistances(target)) {
        const drawn = drawnWith(townPlans, town.profile, town.origin, at, budget);
        expect(drawn.has(index), `round position ${String(target.position)}`).toBe(true);
      }
    }
    // The control: with that budget some house the pick could reach is not drawn
    // throughout its window, so the check above was asked something.
    const reachable = pickRoundTargets(townInput({ houses: MOST_HOUSES }), 3).targets;
    const notDrawn = reachable.filter((target) => {
      const index = planOf(townPlans, target);
      return windowDistances(target).some(
        (at) => !drawnWith(townPlans, town.profile, town.origin, at, budget).has(index),
      );
    });
    expect(notDrawn.length).toBeGreaterThan(0);
  });
});

describe('#1808 — only houses with a front step', () => {
  it('never picks a mapped house with no doorstep or porch step', () => {
    // Every other house loses its front step; nothing else about it changes.
    const stripped = townPlans.map((plan, index) =>
      index % 2 === 0 ? { ...plan, frontStep: undefined } : plan,
    );
    const input = townInput({ buildings: mappedBuildingsOf(stripped), houses: MOST_HOUSES });
    for (const seed of [1, 2, 3, 4]) {
      for (const target of pickRoundTargets(input, seed).targets) {
        expect(planOf(townPlans, target) % 2, `round position ${String(target.position)}`).toBe(1);
      }
    }
    // The control: unstripped, the same seeds pick houses that were stripped.
    const evenPicked = [1, 2, 3, 4].some((seed) =>
      pickRoundTargets(townInput({ houses: MOST_HOUSES }), seed).targets.some(
        (target) => planOf(townPlans, target) % 2 === 0,
      ),
    );
    expect(evenPicked).toBe(true);
  });

  it('never picks a house whose front step is beyond throwing reach of the road', () => {
    // The town's back rows stand 60 m out, their front steps past any reach.
    expect(TARGET_MOST_FROM_ROAD_METRES).toBeLessThan(50);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const target of pickRoundTargets(townInput({ houses: MOST_HOUSES }), seed).targets) {
        const plan = townPlans[planOf(townPlans, target)] as FootprintPlan;
        const across = nearestOnDrawnRoad(
          town.profile,
          town.origin,
          plan.centroid.x,
          plan.centroid.z,
          100,
        );
        expect(
          Math.abs(across?.lateral ?? 0),
          `round position ${String(target.position)}`,
        ).toBeLessThan(40);
      }
    }
  });
});

describe('#1808 — fewer houses than the round wants', () => {
  it('returns every house there is, and says the round is short', () => {
    const profile = northRoute(2_000, () => 10);
    const origin = corridorOrigin(profile);
    const buildings = [600, 900].map((along) =>
      buildingBeside(profile, origin, [rectangleBeside(along, 15, 10, 8)], 6),
    );
    const plans = plansOf(corridorOf(origin, buildings), profile, origin);
    expect(plans.filter((plan) => plan.frontStep !== undefined)).toHaveLength(2);
    const pick = pickRoundTargets(
      { buildings: mappedBuildingsOf(plans), profile, origin, riderDistance: 0, houses: 8 },
      1,
    );
    expect(pick).toMatchObject({ wanted: 8, complete: false });
    expect(pick.targets).toHaveLength(2);
    // Whichever pass took which house, the round is in route order.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { targets } = pickRoundTargets(
        { buildings: mappedBuildingsOf(plans), profile, origin, riderDistance: 0, houses: 8 },
        seed,
      );
      expect(targets.map((target) => target.position)).toEqual([0, 1]);
      expect((targets[1]?.distance ?? 0) - (targets[0]?.distance ?? 0)).toBeGreaterThan(0);
    }
  });

  it('returns none for a town with no house to deliver to', () => {
    const profile = northRoute(2_000, () => 10);
    const origin = corridorOrigin(profile);
    const pick = pickRoundTargets(
      { buildings: mappedBuildingsOf([]), profile, origin, riderDistance: 0, houses: 8 },
      1,
    );
    expect(pick).toEqual({ targets: [], wanted: 8, complete: false });
  });

  it('takes none behind the rider, nor any whose window would open in the rider’s chunk', () => {
    const pick = pickRoundTargets(townInput({ riderDistance: 2_800 }), 1);
    // The town ends before 2 950 m, and windows may open from 2 900 m only.
    for (const target of pick.targets) {
      expect(target.distance - TARGET_WINDOW_HALF_METRES).toBeGreaterThanOrEqual(2_900);
      expect(target.distance + TARGET_WINDOW_HALF_METRES).toBeLessThanOrEqual(
        town.profile.totalDistance,
      );
    }
    expect(pick.complete).toBe(false);
  });

  it('on a loop, picks the next lap’s houses past the rider', () => {
    const profile = circuitRoute(160);
    const origin = corridorOrigin(profile);
    const total = profile.totalDistance;
    const buildings = Array.from({ length: 16 }, (_, index) =>
      buildingBeside(profile, origin, [rectangleBeside(30 + index * 60, -16, 9, 7)], 6),
    );
    const plans = plansOf(corridorOf(origin, buildings), profile, origin);
    const rider = total - 50;
    const pick = pickRoundTargets(
      { buildings: mappedBuildingsOf(plans), profile, origin, riderDistance: rider, houses: 4 },
      2,
    );
    expect(pick.targets.length).toBeGreaterThan(0);
    for (const target of pick.targets) {
      expect(target.distance).toBeGreaterThan(total);
      expect(target.distance + TARGET_WINDOW_HALF_METRES).toBeLessThanOrEqual(rider + total);
    }
  });
});

describe('#1808 — the seed is drawn at the round’s start, and from nothing stored', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws one seed from the cryptographic source for each round', () => {
    const source = vi.spyOn(globalThis.crypto, 'getRandomValues');
    pickRoundTargets(townInput());
    expect(source).toHaveBeenCalledTimes(1);
    pickRoundTargets(townInput());
    expect(source).toHaveBeenCalledTimes(2);
    // A round handed its seed (a test) draws none.
    pickRoundTargets(townInput(), 4);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('picks with the seed it drew', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint32Array).fill(123_456_789);
      return array;
    });
    expect(drawRoundSeed()).toBe(123_456_789);
    expect(pickRoundTargets(townInput())).toEqual(pickRoundTargets(townInput(), 123_456_789));
  });

  it('imports nothing from the store, a transfer, a recording or the instance', () => {
    const source = readFileSync(new URL('./targets.ts', import.meta.url), 'utf8');
    for (const specifier of specifiersIn(source, 'targets.ts')) {
      expect(specifier).not.toMatch(/^@onyourleft\/store|(^|\/)(transfer|recording|instance)\//);
    }
    // And nothing it reaches does either.
    const walk = importWalk();
    const closure = walk.closure(['game/delivery/targets.ts']);
    expect(closure.modules).toContain('game/mapped-buildings.ts');
    for (const path of closure.modules) {
      expect(path, (closure.chainTo(path) ?? []).join(' → ')).not.toMatch(
        /^(transfer|recording|instance)\//,
      );
    }
    // The store is reached by `import type` only (`world-data/corridor.ts`' tile
    // state, through the corridor type the planner takes), which the build erases.
    const storeImporters = [...closure.modules].filter((path) =>
      walk.importsOf(path).bare.some((bare) => /^@onyourleft\/store/.test(bare)),
    );
    for (const path of storeImporters) {
      const code = readFromDisk(path) ?? '';
      const statements = code.match(/import\s[^;]*?from\s+'@onyourleft\/store[^']*'/g) ?? [];
      expect(statements.length, path).toBeGreaterThan(0);
      for (const statement of statements) expect(statement, path).toMatch(/^import\s+type\s/);
    }
  });
});

describe('#1808 — never a name', () => {
  it('carries no name or address a building was given into any output', () => {
    const profile = northRoute(2_000, () => 10);
    const origin = corridorOrigin(profile);
    const NAME = 'Fixturename Cottage';
    const ADDRESS = 'Nowhere Fixture Lane';
    const buildings = [500, 600, 700, 800].map(
      (along) =>
        ({
          ...buildingBeside(profile, origin, [rectangleBeside(along, 15, 10, 8)], 6),
          name: NAME,
          'addr:street': ADDRESS,
        }) as BuildingFeature,
    );
    const plans = plansOf(corridorOf(origin, buildings), profile, origin).map(
      (plan) => ({ ...plan, name: NAME, address: ADDRESS }) as FootprintPlan,
    );
    const pick: TargetPick = pickRoundTargets(
      { buildings: mappedBuildingsOf(plans), profile, origin, riderDistance: 0, houses: 4 },
      1,
    );
    expect(pick.targets.length).toBeGreaterThan(0);
    const said = JSON.stringify(pick);
    expect(said).not.toContain(NAME);
    expect(said).not.toContain(ADDRESS);
    for (const target of pick.targets) {
      expect(Object.keys(target).sort()).toEqual(
        ['distance', 'fromRoad', 'kind', 'position', 'side', 'x', 'y', 'yaw', 'z'].sort(),
      );
    }
  });
});

describe('#1808 — errors name the field and the constraint, never a coordinate', () => {
  it('refuses a malformed plan without its coordinates', () => {
    const plan = townPlans.find((each) => each.frontStep !== undefined) as FootprintPlan;
    const step = plan.frontStep as NonNullable<FootprintPlan['frontStep']>;
    const malformed = { ...plan, frontStep: { ...step, x: Number.NaN } };
    const input = townInput({ buildings: mappedBuildingsOf([malformed]) });
    expect(() => pickRoundTargets(input, 1)).toThrow(RangeError);
    let message = '';
    try {
      pickRoundTargets(input, 1);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/front step/);
    // None of the fixture's coordinate digits: no digit at all.
    expect(message).not.toMatch(/\d/);
    for (const value of [step.z, step.y, plan.centroid.x, plan.centroid.z]) {
      expect(message).not.toContain(String(Math.trunc(Math.abs(value))));
    }
  });

  it('refuses a plan with no finite centroid without its coordinates', () => {
    const plan = townPlans[0] as FootprintPlan;
    // NaN, not an infinity: `mappedBuildingsOf`'s cell loop never ends on an infinite centroid.
    const malformed = { ...plan, centroid: { x: plan.centroid.x, z: Number.NaN } };
    const input = townInput({ buildings: mappedBuildingsOf([malformed]) });
    expect(() => pickRoundTargets(input, 1)).toThrow(/centroid/);
    expect(() => pickRoundTargets(input, 1)).not.toThrow(/\d/);
  });

  it.each([0, MOST_HOUSES + 1, 2.5, Number.NaN])('refuses a round of %s houses', (houses) => {
    expect(() => pickRoundTargets(townInput({ houses }), 1)).toThrow(/round size/);
  });

  it.each([-1, 2.5, 2 ** 32, Number.NaN])('refuses a seed of %s', (seed) => {
    expect(() => pickRoundTargets(townInput(), seed)).toThrow(/seed/);
  });

  it('refuses a rider distance that is not a distance, without it', () => {
    for (const riderDistance of [-12.75, Number.NaN]) {
      expect(() => pickRoundTargets(townInput({ riderDistance }), 1)).toThrow(/rider’s distance/);
      expect(() => pickRoundTargets(townInput({ riderDistance }), 1)).not.toThrow(/12/);
    }
  });

  it('refuses a triangle budget below zero', () => {
    expect(() => pickRoundTargets(townInput({ triangleBudget: -1 }), 1)).toThrow(/budget/);
  });
});
