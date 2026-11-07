// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which of the rider's saved routes can hold a Delivery round — #2294, the
 * owner's ruling of 2026-11-06 (epic #1803): when the round is chosen, the
 * chooser lists every saved route with the mapped houses a round could take
 * on it, and greys out, with the reason in words, the routes that cannot
 * hold one. Until this, a rider could choose a route that held no round and
 * learn so from the HUD only after the press (`hud/delivery-announce.ts`
 * §`TOO_FEW_HOUSES_TEXT`).
 *
 * ## The round planner's own read, on the device
 *
 * Each route's corridor comes through the same port the chosen route's does
 * (`GamePort.loadWorldCorridor`, `world-data/corridor-port.ts`): the store's
 * kept record where there is one, which asks nothing, or a read of the
 * configured basemap archive, less the athlete's privacy zones, which is no
 * new network origin; and nothing at all with the tiles off, no archive, or
 * a ride recording. The houses are then planned from it exactly as
 * `GameView` plans them at the press — the land mask, the urban class and
 * the footprints, at the same vertex limit — and counted by `targets.ts`
 * §`countRoundHouses`, which shares the pick's candidates and its drawn check.
 * That count is a ceiling on any round's pick, so a route counted short of
 * a round CANNOT hold one; a route counted enough almost always rides that
 * many, and the press still decides (the HUD's fallback stands).
 *
 * ## Nothing here leaves the device, or reaches the trainer
 *
 * One number a route, held in memory by the chooser's screen: no house, no
 * position, no seed. It imports no trainer port, gradient or simulation
 * (`delivery-cannot-reach-trainer.test.ts` walks this module with the rest
 * of `delivery/`, DL5), and writes nothing.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { FOOTPRINT_MAX_VERTICES, footprintPlans } from '../footprint-buildings';
import { landClassMask } from '../land-class';
import { mappedBuildingsOf } from '../mapped-buildings';
import { corridorOrigin } from '../terrain';
import { urbanClassMap } from '../urban-class';
import type { CorridorState, WorldCorridor } from '../world-data/corridor';

import { countRoundHouses } from './targets';

/** A saved route as the count needs it. */
export interface CourseRoute {
  readonly id: string;
  readonly profile: RouteProfile;
}

/** What one route came to: its houses counted, its corridor not ready, or a count that failed. */
export type CourseCount =
  | { readonly kind: 'counted'; readonly houses: number }
  | { readonly kind: 'unread'; readonly state: Exclude<CorridorState, { kind: 'ready' }> }
  | { readonly kind: 'failed' };

/**
 * The most houses a round from the start line could take on `profile`, from
 * its corridor: planned as `GameView` plans them at the press, counted by
 * `targets.ts` §`countRoundHouses`. @see the header
 */
export function roundHousesOn(corridor: WorldCorridor, profile: RouteProfile): number {
  const origin = corridorOrigin(profile);
  const land = landClassMask(corridor);
  const urban = urbanClassMap(corridor, land, profile);
  const { plans } = footprintPlans(corridor, land, profile, origin, FOOTPRINT_MAX_VERTICES, urban);
  return countRoundHouses(mappedBuildingsOf(plans), profile, origin);
}

/** A tick of the platform's own task queue, so a long count never holds a frame for every route. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Count each route in turn, one at a time, handing each answer to `counted`
 * as it comes; stops, handing nothing more, once `signal` is aborted.
 * `known` keeps a count by its profile, so a rider who switches the round
 * off and on again is not made to wait for the same count twice; a corridor
 * that was not ready is asked again next time.
 */
export async function countCourses<Route extends CourseRoute>(
  routes: readonly Route[],
  /** The corridor read, as `GamePort.loadWorldCorridor` is. Never rejects. */
  load: (
    route: Route,
    signal: AbortSignal,
    progress: (state: CorridorState) => void,
  ) => Promise<CorridorState>,
  signal: AbortSignal,
  counted: (routeId: string, count: CourseCount) => void,
  known: WeakMap<RouteProfile, number>,
): Promise<void> {
  for (const route of routes) {
    if (signal.aborted) return;
    const kept = known.get(route.profile);
    if (kept !== undefined) {
      counted(route.id, { kind: 'counted', houses: kept });
      continue;
    }
    const state = await load(route, signal, () => undefined);
    if (signal.aborted) return;
    if (state.kind !== 'ready') {
      counted(route.id, { kind: 'unread', state });
      continue;
    }
    // A corridor named for another route draws nothing on this one, at the
    // press as here (`GameView` §`worldCorridorRef`).
    if (state.corridor.routeId !== route.id) {
      counted(route.id, {
        kind: 'unread',
        state: { kind: 'unavailable', why: 'outside-coverage' },
      });
      continue;
    }
    await nextTask();
    if (signal.aborted) return;
    let houses: number;
    try {
      houses = roundHousesOn(state.corridor, route.profile);
    } catch {
      counted(route.id, { kind: 'failed' });
      continue;
    }
    known.set(route.profile, houses);
    counted(route.id, { kind: 'counted', houses });
  }
}
