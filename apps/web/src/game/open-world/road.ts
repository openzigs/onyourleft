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
 * ## What it tells the session (#2990)
 *
 * Each follow hands the rider's position to {@link OpenWorldRoadHooks.at}, so
 * the session's reader reads the blocks round them as they go, and reads the
 * graph's version: when the graph has grown, the route takes a way on past any
 * turn-round more than the lock ahead (`RollingRoute.reopen`), which changes no
 * grade the rider can have been sent, so its view is handed on as an extension
 * is.
 *
 * ## What a change means for the drawn path
 *
 * Every view's line is solved over the whole view, so a new view's line can
 * differ from the last one's near the rider: by 0.74 m at the camera's target
 * for a junction choice made just before the lock. {@link OpenWorldRoad.drawnPath}
 * eases a new view's line in from the path last drawn over the next
 * `line-ease.ts` §`LINE_EASE_METRES` ridden, so a choice moves neither the
 * drawn rider nor the camera on the frame it is made (ADR 0089 C-6, #2989). A
 * U-turn's line is drawn at once: the road under the rider changed.
 *
 * ## What a change means for the scenery (#3055)
 *
 * Every view is anchored (`scenery-anchor.ts`): its scenery is seeded from
 * the ride's FIRST view, never its own, and placed on cells counted in ride
 * distance. So a view change keeps every tree, house and field short of the
 * change where it was, rather than regenerating the world on that frame.
 *
 * Nothing here reads a clock, writes to a trainer or names a place: the
 * position goes to the reader, which keeps only its block (ADR 0090 R-1).
 */

import {
  metres,
  positionAt,
  type GeographicPosition,
  type RollingRoute,
  type RouteProfile,
} from '@onyourleft/domain';

import { drawnLine, type DrawnLine } from '../drawn-line';
import { routeSeed } from '../scatter';
import { anchorScenery } from '../scenery-anchor';
import type { GameState } from '../simulation';
import { easeWeight, easedLine, heldLine, type HeldLine } from './line-ease';

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

/** What the road tells the session, and asks of it, as the ride goes — #2990. */
export interface OpenWorldRoadHooks {
  /** Where the rider is now, each {@link OpenWorldRoad.follow}: the map round them is read. */
  readonly at?: ((position: GeographicPosition) => void) | undefined;
  /**
   * The street graph's version: a change since the last follow may have given
   * a way on past a turn-round, which the route then takes
   * (`RollingRoute.reopen`).
   */
  readonly graphVersion?: (() => number) | undefined;
}

/** One open-world ride's road, from its start. See the file's header. */
export class OpenWorldRoad {
  /** The rolling route itself: #2897's junction choice presses through it. */
  readonly route: RollingRoute;
  readonly #hooks: OpenWorldRoadHooks;
  /** The ride's scenery seed, from its first view (#3055). */
  readonly #seed: number;
  #view: OpenWorldRoadView;
  #uTurns: number;
  #graphVersion: number | undefined;
  /** The path last handed out by {@link drawnPath}, on {@link view}: what the screen drew. */
  #drawn: DrawnLine | undefined;
  /** The path being eased from, and the ride distance the ease began at. @see drawnPath */
  #easing: { readonly from: HeldLine; readonly at: number } | undefined;

  constructor(route: RollingRoute, hooks: OpenWorldRoadHooks = {}) {
    this.route = route;
    this.#hooks = hooks;
    this.#uTurns = route.uTurns;
    this.#graphVersion = hooks.graphVersion?.();
    const profile = route.view();
    this.#seed = routeSeed(profile);
    this.#view = this.#anchored({ profile, origin: route.origin, turned: false });
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
    if (Number.isFinite(rider)) {
      // #2990: streets added since may go on past where the route turned round.
      const version = this.#hooks.graphVersion?.();
      if (version !== this.#graphVersion) {
        this.#graphVersion = version;
        route.reopen(rider);
      }
      if (route.end - rider < OPEN_WORLD_REACH_FLOOR_METRES) route.advance(rider);
      const at = alongView(route, rider);
      if (at >= 0 && at <= route.end - route.origin) this.#hooks.at?.(positionAt(route.view(), at));
    }
    const profile = route.view();
    if (profile === this.#view.profile) return undefined;
    const turned = route.uTurns !== this.#uTurns;
    this.#uTurns = route.uTurns;
    // #2989: the new view's line is eased in from the path last drawn, from
    // here; after a U-turn that path is on a road the rider has left.
    const drawn = this.#drawn;
    this.#easing =
      turned || drawn === undefined || !Number.isFinite(rider)
        ? undefined
        : { from: heldLine(drawn, this.#view.origin), at: rider };
    this.#drawn = undefined;
    this.#view = this.#anchored({ profile, origin: route.origin, turned });
    return this.#view;
  }

  /** `view`, its scenery keyed on the ride's seed and distance (#3055). */
  #anchored(view: OpenWorldRoadView): OpenWorldRoadView {
    anchorScenery(view.profile, { seed: this.#seed, origin: view.origin });
    return view;
  }

  /**
   * The path the riders are drawn along and the camera follows on
   * {@link view}, for a rider drawn at ride distance `rider` — #2989: the
   * view's own line (`drawn-line.ts` §`drawnLine`), or, for
   * `line-ease.ts` §`LINE_EASE_METRES` ridden after a view changed, that line
   * eased in from the path drawn before the change. `GameView` hands it to
   * the scene (`scene.ts` §`SceneInput.drawnPath`).
   */
  drawnPath(rider: number): DrawnLine {
    const view = this.#view;
    const line = drawnLine(view.profile);
    const easing = this.#easing;
    const weight = easing === undefined ? 1 : easeWeight(rider - easing.at);
    if (easing !== undefined && !(weight < 1)) this.#easing = undefined;
    const drawn = easing === undefined ? line : easedLine(easing.from, line, view.origin, weight);
    this.#drawn = drawn;
    return drawn;
  }
}
