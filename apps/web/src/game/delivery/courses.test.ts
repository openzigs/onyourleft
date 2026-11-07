// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2294: how many houses a round could take on each saved route, counted
 * before the rider chooses one — `courses.ts` and `targets.ts`
 * §`countRoundHouses`. Every town here is synthetic, and no test name or
 * message carries a coordinate.
 *
 * What is held: the count is the press's own planning of the same corridor
 * (the towns `delivery-wiring.test.tsx` rides, counted as the HUD then shows
 * them), it is never fewer than any seeded pick of the same houses (so a
 * route counted short of a round cannot hold one), and the walk over the
 * routes answers each one through the corridor port, in order, and stops when
 * it is told to.
 */

import { describe, expect, it, vi } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';

import { footprintPlans } from '../footprint-buildings';
import {
  buildingBeside,
  landBeside,
  rectangleBeside,
  rowTownFixture,
} from '../footprint-fixtures-testing';
import { landClassMask } from '../land-class';
import { mappedBuildingsOf } from '../mapped-buildings';
import { northRoute } from '../route-fixtures-testing';
import { corridorOrigin } from '../terrain';
import type { CorridorState, WorldCorridor } from '../world-data/corridor';

import type { DeliveryCourse } from '../StageChooser';

import { countCourses, roundHousesOn, type CourseCount, type CourseRoute } from './courses';
import { deliveryTown } from './delivery-town-testing';
import { MOST_HOUSES } from './round';
import { countRoundHouses, pickRoundTargets } from './targets';

/** Three houses 30 m apart: any two of the outer pair fit, and the middle one rules out both. */
function threeInARow(): { readonly profile: RouteProfile; readonly corridor: WorldCorridor } {
  const profile = northRoute(1_000, () => 10);
  const origin = corridorOrigin(profile);
  return {
    profile,
    corridor: {
      routeId: 'three-in-a-row',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 1_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 10, 990, -100, 100)],
      buildings: [150, 180, 210].map((along) =>
        buildingBeside(profile, origin, [rectangleBeside(along, 12, 8, 8)], 6),
      ),
      paths: [],
      streets: [],
    },
  };
}

describe('#2294 — the most houses a round can hold on a route', () => {
  it('counts the towns the chooser’s rides are ridden through, capped at the most a round holds', () => {
    const counted = (layout: Parameters<typeof deliveryTown>[1]): number => {
      const town = deliveryTown('a-route', layout);
      return roundHousesOn(town.corridor, town.profile);
    };
    // Two kilometres of houses both sides: far more than a round, so the cap.
    expect(counted({})).toBe(MOST_HOUSES);
    // `delivery-wiring.test.tsx`'s short towns: three in reach, and two.
    expect(counted({ lastAlong: 300 })).toBe(3);
    expect(counted({ lastAlong: 220 })).toBe(2);
    // #1856: every front step past a parcel's reach.
    expect(counted({ lateral: 30 })).toBe(0);
  });

  it('is never fewer than a seeded pick of the same houses, whatever the seed or the round', () => {
    const row = rowTownFixture(12);
    const rowBuildings = mappedBuildingsOf(
      footprintPlans(row.corridor, landClassMask(row.corridor), row.profile, row.origin).plans,
    );
    const short = deliveryTown('a-route', { lastAlong: 300 });
    const three = threeInARow();
    const threeBuildings = mappedBuildingsOf(
      footprintPlans(
        three.corridor,
        landClassMask(three.corridor),
        three.profile,
        corridorOrigin(three.profile),
      ).plans,
    );
    // A dense town is slow to pick, so it is asked fewer seeds than the small ones.
    const towns = [
      { buildings: rowBuildings, profile: row.profile, origin: row.origin, seeds: 3 },
      { ...short, seeds: 8 },
      {
        buildings: threeBuildings,
        profile: three.profile,
        origin: corridorOrigin(three.profile),
        seeds: 24,
      },
    ];
    let fewer = 0;
    for (const town of towns) {
      const count = countRoundHouses(town.buildings, town.profile, town.origin);
      for (const houses of [1, 3, MOST_HOUSES]) {
        for (let seed = 0; seed < town.seeds; seed += 1) {
          const pick = pickRoundTargets({ ...town, riderDistance: 0, houses }, seed);
          expect(pick.targets.length).toBeLessThanOrEqual(Math.min(count, houses));
          if (pick.targets.length < Math.min(count, houses)) fewer += 1;
        }
      }
    }
    // The ceiling is a ceiling, not the round: on the three in a row, a seed
    // that takes the middle house finds one where two fit.
    expect(countRoundHouses(threeBuildings, three.profile, corridorOrigin(three.profile))).toBe(2);
    expect(fewer).toBeGreaterThan(0);
  });

  it('counts only houses drawn throughout their window, as the pick takes them', () => {
    // A budget of two buildings: the drawn set is the two nearest the rider,
    // and a house drops out of it inside its own window, so fewer are taken.
    const short = deliveryTown('a-route', { lastAlong: 300 });
    const budget = 2 * (short.buildings.plans[0]?.triangleCount ?? 0);
    const few = countRoundHouses(short.buildings, short.profile, short.origin, budget);
    expect(few).toBeLessThan(countRoundHouses(short.buildings, short.profile, short.origin));
    for (const seed of [1, 2, 3]) {
      const pick = pickRoundTargets(
        { ...short, riderDistance: 0, houses: MOST_HOUSES, triangleBudget: budget },
        seed,
      );
      expect(pick.targets.length).toBeLessThanOrEqual(few);
    }
  });
});

/** A route as the walk is handed it. */
function routeOf(id: string, profile: RouteProfile): CourseRoute {
  return { id, profile };
}

describe('#2294 — counting each saved route in turn', () => {
  const town = deliveryTown('with-houses', { lastAlong: 300 });
  const ready = (corridor: WorldCorridor): CorridorState => ({ kind: 'ready', corridor });

  it('answers each route through the corridor read, in order: counted, or why not', async () => {
    const elsewhere = deliveryTown('another-route');
    const routes = [
      routeOf('with-houses', town.profile),
      routeOf('tiles-off', deliveryTown('tiles-off').profile),
      routeOf('not-its-corridor', elsewhere.profile),
    ];
    const asked: string[] = [];
    const load = vi.fn((route: CourseRoute): Promise<CorridorState> => {
      asked.push(route.id);
      if (route.id === 'with-houses') return Promise.resolve(ready(town.corridor));
      if (route.id === 'tiles-off') return Promise.resolve({ kind: 'off', why: 'map-tiles-off' });
      // A corridor named for another route draws nothing on this one, at the press as here.
      return Promise.resolve(ready(elsewhere.corridor));
    });
    const answers: [string, CourseCount][] = [];
    await countCourses(
      routes,
      load,
      new AbortController().signal,
      (id, count) => answers.push([id, count]),
      new WeakMap(),
    );
    expect(asked).toEqual(['with-houses', 'tiles-off', 'not-its-corridor']);
    expect(answers).toEqual([
      ['with-houses', { kind: 'counted', houses: 3 }],
      ['tiles-off', { kind: 'unread', state: { kind: 'off', why: 'map-tiles-off' } }],
      [
        'not-its-corridor',
        { kind: 'unread', state: { kind: 'unavailable', why: 'outside-coverage' } },
      ],
    ]);
  });

  it('says a count failed, and goes on to the next route, when the planning throws', async () => {
    const broken: WorldCorridor = {
      ...town.corridor,
      routeId: 'broken',
      get buildings(): WorldCorridor['buildings'] {
        throw new TypeError('a corridor that cannot be read');
      },
    };
    const answers: [string, CourseCount][] = [];
    await countCourses(
      [routeOf('broken', town.profile), routeOf('with-houses', town.profile)],
      (route) => Promise.resolve(ready(route.id === 'broken' ? broken : town.corridor)),
      new AbortController().signal,
      (id, count) => answers.push([id, count]),
      new WeakMap(),
    );
    expect(answers).toEqual([
      ['broken', { kind: 'failed' }],
      ['with-houses', { kind: 'counted', houses: 3 }],
    ]);
  });

  it.each([
    // The rider presses Ride while the first route's corridor is being read.
    {
      when: 'while a corridor is read',
      read: (controller: AbortController): Promise<CorridorState> => {
        controller.abort();
        return Promise.resolve({ kind: 'unavailable', why: 'offline' });
      },
    },
    // ... or after it was read, before its houses are counted.
    {
      when: 'before a read corridor is counted',
      read: (controller: AbortController): Promise<CorridorState> => {
        setTimeout(() => {
          controller.abort();
        }, 0);
        return Promise.resolve(ready({ ...town.corridor, routeId: 'first' }));
      },
    },
  ])('stops once told to $when: nothing more is read or answered', async ({ read }) => {
    const controller = new AbortController();
    const asked: string[] = [];
    const answers: string[] = [];
    await countCourses(
      [routeOf('first', deliveryTown('first').profile), routeOf('second', town.profile)],
      (route) => {
        asked.push(route.id);
        return read(controller);
      },
      controller.signal,
      (id) => answers.push(id),
      new WeakMap(),
    );
    expect(asked).toEqual(['first']);
    expect(answers).toEqual([]);
  });

  it('keeps a count by its profile, and asks again for a corridor that was not ready', async () => {
    const known = new WeakMap<RouteProfile, number>();
    const offline = deliveryTown('offline-route').profile;
    const routes = [routeOf('with-houses', town.profile), routeOf('offline-route', offline)];
    const load = vi.fn((route: CourseRoute): Promise<CorridorState> =>
      Promise.resolve(
        route.id === 'with-houses' ? ready(town.corridor) : { kind: 'unavailable', why: 'offline' },
      ),
    );
    const run = async (): Promise<[string, CourseCount][]> => {
      const answers: [string, CourseCount][] = [];
      await countCourses(
        routes,
        load,
        new AbortController().signal,
        (id, count) => answers.push([id, count]),
        known,
      );
      return answers;
    };
    const first = await run();
    expect(load).toHaveBeenCalledTimes(2);
    const second = await run();
    // The counted route is answered from what was kept; the offline one is read again.
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls.at(-1)?.[0].id).toBe('offline-route');
    expect(second).toEqual(first);
  });
});

describe('the chooser’s restatement of a count', () => {
  it('is the same type as CourseCount, so the two cannot drift apart', () => {
    // Each assignment fails typecheck if the two types stop agreeing.
    const toChooser = (count: CourseCount): DeliveryCourse => count;
    const fromChooser = (course: DeliveryCourse): CourseCount => course;
    expect(toChooser({ kind: 'failed' })).toEqual(fromChooser({ kind: 'failed' }));
  });
});
