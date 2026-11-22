// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The road an open-world ride follows past its first view** — #2982.
 *
 * The game reads a ride as "distance along a `RouteProfile`". An open-world
 * ride's profile is the rolling route's view (`@onyourleft/domain`
 * §`RollingRoute`), and that view is replaced as the route grows ahead, drops
 * the road far behind, takes a junction choice or turns round. This is the one
 * place the ride loop asks for the road, so every reader in it — the
 * simulation, the trainer's grade, the scene and the HUD — is handed the same
 * view at the same moment.
 *
 * ## Ride distance and the view's distance
 *
 * The ride keeps ONE odometer: the simulation's, in ride distance from the
 * start, which is what the recording, the moving time and every total read. A
 * view's distance zero is the route's {@link OpenWorldRoadView.origin}, so a
 * reader of a view reads ride distance `d` at `d − origin`
 * (`RollingRoute`'s header, item 5). {@link alongView} is that subtraction.
 *
 * ## When the view changes
 *
 * The route is advanced only once the road held ahead of the rider falls
 * below {@link OPEN_WORLD_REACH_FLOOR_METRES}, so most frames hand on the same
 * view and nothing is rebuilt. *#2982's choice*: every view is a new profile,
 * and a new profile is a new key to every cache the scene holds against one
 * (`drawn-line.ts`, `racing-line.ts`, `road-grid.ts` and the rest), so a view
 * a frame would rebuild them all every frame. Advanced at the floor, the view
 * changes about once a kilometre, and still reaches at least 1 km ahead: past
 * ADR 0087 D-6.3's 180 m by a wide margin, and past ADR 0088's 250 m prompt.
 * A junction choice or a U-turn changes the view at once, whenever it is made.
 *
 * ## What a change means for the trainer
 *
 * ADR 0087 D-6: a choice made before the lock, an extension and the trim
 * behind change no grade the rider can have been sent, so they are handed on
 * as they are. A **U-turn** changes the road under the rider at once, and its
 * view says so ({@link OpenWorldRoadView.turned}) for `gradient.ts` to walk
 * the grade there at 1 % a second (D-6.4). It is read from the route's own
 * count of U-turns, so a U-turn made by any caller — #2897's junction choice
 * calls the route directly — is told apart.
 *
 * Nothing here reads a clock, writes to a trainer or names a place.
 */

import { metres, type RollingRoute, type RouteProfile } from '@onyourleft/domain';

import type { GameState } from '../simulation';

/**
 * How little road may be held ahead of the rider before the route is advanced:
 * **1 km**. *#2982's choice*, above.
 */
export const OPEN_WORLD_REACH_FLOOR_METRES = 1_000;

/** The road, as every reader in the ride loop reads it. */
export interface OpenWorldRoadView {
  readonly profile: RouteProfile;
  /** The ride distance of the profile's distance zero. */
  readonly origin: number;
  /**
   * That the rider was turned round since the last view: the road under them
   * changed at once, so the grade sent walks to it (ADR 0087 D-6.4).
   */
  readonly turned: boolean;
}

/** Ride distance `rideDistance` on `view`'s profile. */
export function alongView(view: Pick<OpenWorldRoadView, 'origin'>, rideDistance: number): number {
  return rideDistance - view.origin;
}

/**
 * `state` as a reader of a view at `origin` reads it: the rider's odometer, and
 * the pacer's, at the view's own distance (#2982). Everything else is the
 * ride's own. At origin 0, every ride but an open-world one, `state` itself.
 */
export function alongRoad(state: GameState, origin: number): GameState {
  if (origin === 0) return state;
  const { bot } = state;
  return {
    ...state,
    ride: { ...state.ride, distance: metres(state.ride.distance - origin) },
    ...(bot === undefined
      ? {}
      : {
          bot: { ...bot, state: { ...bot.state, distance: metres(bot.state.distance - origin) } },
        }),
  };
}

/** One open-world ride's road, from its start. See the file's header. */
export class OpenWorldRoad {
  /** The rolling route itself: #2897's junction choice presses through it. */
  readonly route: RollingRoute;
  #view: OpenWorldRoadView;
  #uTurns: number;

  constructor(route: RollingRoute) {
    this.route = route;
    this.#uTurns = route.uTurns;
    this.#view = { profile: route.view(), origin: route.origin, turned: false };
  }

  /** The view last handed on. */
  get view(): OpenWorldRoadView {
    return this.#view;
  }

  /**
   * The road for a rider at ride distance `rider`: a new view when it changed
   * since the last call, and `undefined` when it did not. Advances the route
   * only when less than {@link OPEN_WORLD_REACH_FLOOR_METRES} is held ahead. A
   * rider distance that is not a finite number advances nothing (the route
   * refuses one), and still hands on a change made since by a choice or a
   * U-turn.
   */
  follow(rider: number): OpenWorldRoadView | undefined {
    const route = this.route;
    if (Number.isFinite(rider) && route.end - rider < OPEN_WORLD_REACH_FLOOR_METRES) {
      route.advance(rider);
    }
    const profile = route.view();
    if (profile === this.#view.profile) return undefined;
    const turned = route.uTurns !== this.#uTurns;
    this.#uTurns = route.uTurns;
    this.#view = { profile, origin: route.origin, turned };
    return this.#view;
  }
}
