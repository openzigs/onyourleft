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
 * is. #2901: and it hands the route and the rider to
 * {@link OpenWorldRoadHooks.ahead}, so the tiles ahead and on every way on
 * from the next junction are planned before the rider reaches them.
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
 * ## The ways out of a junction that the route does not take (#3051)
 *
 * A view's scenery is placed along the view's own road, so the road past a
 * junction carried scenery on the way the route took and none on any other:
 * a choice moved every tree and house past the junction from the old way to
 * the new one, on the frame of the press, in plain view 100 m and more ahead
 * of the rider. {@link OpenWorldRoad.waysOut} hands the scene each way out
 * not taken, of every junction in view, as the view the route would hand out
 * were it taken (`RollingRoute.taking`), framed and anchored as every view
 * is. So the scenery along a way is the same whether the route takes it or
 * not: a choice swaps which view is the road and which a way out, and what
 * stands along them stays where it was. And the ways out of the junctions
 * along each of those ways too ({@link WAYS_OUT_DEPTH}): the road has its
 * junctions' ways, so the street a choice makes the road must already have
 * its own, or they would all appear on the frame of the press.
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
import type { MappedBuildings } from '../mapped-buildings';
import { MAPPED_RANKED_AHEAD_METRES } from '../realistic-budget';
import { routeSeed } from '../scatter';
import { anchorScenery } from '../scenery-anchor';
import type { GameState } from '../simulation';
import type { WorldCorridor } from '../world-data/corridor';
import {
  VIEW_AHEAD_METRES,
  VIEW_BEHIND_METRES,
  corridorOrigin,
  drawProfileIn,
  localGroundPosition,
  type CorridorOrigin,
} from '../terrain';
import { easeWeight, easedLine, heldLine, type HeldLine } from './line-ease';

/**
 * How little road may be held ahead of the rider before the route is advanced:
 * **1 km**. *#2982's choice*, above.
 */
export const OPEN_WORLD_REACH_FLOOR_METRES = 1_000;

/**
 * How far ahead of the rider a junction's ways out are handed to the scene:
 * the view's own reach ahead, so a way's scenery comes into view in the fog
 * as the road's own does.
 */
export const WAYS_OUT_AHEAD_METRES = VIEW_AHEAD_METRES;

/**
 * How far behind the rider a junction's ways out are still handed on: the
 * view's own reach behind, so what stood along the way not taken is dropped
 * only once the road beside it is.
 */
export const WAYS_OUT_BEHIND_METRES = VIEW_BEHIND_METRES;

/**
 * How far the rider rides between two looks for the junctions in view,
 * metres: **20**. A look walks the graph at every junction of the 2 km held
 * (`RollingRoute.junctionsAfter`), which is not a frame's work; a view change
 * is looked at at once. So a junction's ways come into reach, and fall out of
 * it behind, up to this much late: both where the view shows neither.
 */
export const WAYS_OUT_LOOK_METRES = 20;

/**
 * How many junctions from the road a way out is handed on: **2**. The ways
 * out of the road's junctions, and the ways out of the junctions along those.
 * A junction three from the road is two streets' length past the first, which
 * on the shortest town block is past where the fog has taken most of a view.
 */
export const WAYS_OUT_DEPTH = 2;

/**
 * One way out of a junction that the route does not take, as the scene reads
 * it (`scene.ts` §`SceneInput.waysOut`). @see OpenWorldRoad.waysOut
 */
export interface OpenWorldWayOut {
  /**
   * The view the route would hand out were this way taken, in the ride's
   * frame and keyed on the ride as every view is. The same object for as long
   * as the way is handed on.
   */
  readonly profile: RouteProfile;
  /** The junction's distance on {@link profile}. */
  readonly fromMetres: number;
}

interface HeldWayOut extends OpenWorldWayOut {
  /** The junction's ride distance. */
  readonly junction: number;
  /** The ride distance of the profile's distance zero. */
  readonly origin: number;
  /** The route that takes the way, which {@link profile} is the view of: its junctions' ways are read off it. */
  readonly route: RollingRoute;
  /**
   * How many junctions from the road it is: 1 for a way out of the road
   * itself. A choice changes it, and nothing a reader is handed.
   */
  depth: number;
}

const NO_WAYS_OUT: readonly OpenWorldWayOut[] = [];

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
  /**
   * #2901: the route and the rider, after each follow has advanced it, so the
   * session can ask for the map tiles ahead and on every way on from the next
   * junction to be planned (`tiles-ahead.ts`).
   */
  readonly ahead?: ((route: RollingRoute, rider: number) => void) | undefined;
  /**
   * #2902: the frame the whole ride is drawn in, the session's start: every
   * view is handed to `terrain.ts` §`drawProfileIn` with it, so a trim behind
   * the rider moves nothing drawn. Absent, a view is drawn about its own
   * first point, as before.
   */
  readonly frame?: CorridorOrigin | undefined;
  /** #2902: the mapped buildings planned round the rider, in {@link frame}, once there are any. */
  readonly buildings?: (() => MappedBuildings | undefined) | undefined;
  /**
   * #2903: the held blocks' streets as a corridor in {@link frame}
   * (`street-corridor.ts`), which the scene draws to the fog as road and
   * stubs at each junction; `undefined` until a block is held.
   */
  readonly streets?: (() => WorldCorridor | undefined) | undefined;
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
    const profile = this.#framed(route.view());
    this.#seed = routeSeed(profile);
    this.#view = this.#anchored({ profile, origin: route.origin, turned: false });
  }

  /** `profile`, drawn in the ride's frame where it has one. @see OpenWorldRoadHooks.frame */
  #framed(profile: RouteProfile): RouteProfile {
    if (this.#hooks.frame !== undefined) drawProfileIn(profile, this.#hooks.frame);
    return profile;
  }

  /** The mapped buildings planned round the rider (#2902), or `undefined` while none are. */
  buildings(): MappedBuildings | undefined {
    return this.#hooks.buildings?.();
  }

  /** The streets round the rider as a corridor (#2903), or `undefined` while none are held. */
  streets(): WorldCorridor | undefined {
    return this.#hooks.streets?.();
  }

  /** @see branchesAhead */
  #branches:
    | { readonly key: string; readonly of: RouteProfile; readonly line: Float32Array | undefined }
    | undefined;

  /**
   * The ways on from the next junction that the route does not take, as the
   * mapped buildings are ranked by them (#2902): each from the junction out to
   * `realistic-budget.ts` §`MAPPED_RANKED_AHEAD_METRES`, `x, z` pairs in the
   * view's frame, one way after another with a `NaN` pair between, which
   * `mapped-buildings.ts` §`rankFrom` measures no segment across. `undefined`
   * while the next junction is farther ahead than that reach, or there is
   * none. The same array while the view and the junction stay.
   */
  branchesAhead(rider: number): Float32Array | undefined {
    const junction = Number.isFinite(rider) ? this.route.nextJunctionAfter(rider) : undefined;
    if (junction === undefined || junction.distance - rider > MAPPED_RANKED_AHEAD_METRES) {
      return undefined;
    }
    const profile = this.#view.profile;
    const key = `${String(junction.distance)}:${junction.taken}`;
    if (this.#branches?.key === key && this.#branches.of === profile) return this.#branches.line;
    const frame = corridorOrigin(profile);
    const out: number[] = [];
    for (const way of junction.ways) {
      if (way.edge.id === junction.taken) continue;
      if (out.length > 0) out.push(Number.NaN, Number.NaN);
      let travelled = 0;
      let last: { readonly x: number; readonly z: number } | undefined;
      for (const point of way.edge.points) {
        const here = localGroundPosition(frame, point.position);
        if (last !== undefined) travelled += Math.hypot(here.x - last.x, here.z - last.z);
        out.push(here.x, here.z);
        last = here;
        if (travelled >= MAPPED_RANKED_AHEAD_METRES) break;
      }
    }
    const line = out.length === 0 ? undefined : Float32Array.from(out);
    this.#branches = { key, of: profile, line };
    return line;
  }

  /** The ways out held, by junction and way. @see waysOut */
  #waysOut = new Map<string, HeldWayOut>();
  /** What {@link waysOut} last handed on, and the view and rider it was for. */
  #waysOutFor:
    | {
        readonly of: RouteProfile;
        readonly at: number;
        readonly ways: readonly OpenWorldWayOut[];
      }
    | undefined;

  /**
   * The ways out not taken, of every junction from
   * {@link WAYS_OUT_BEHIND_METRES} behind a rider at ride distance `rider` to
   * {@link WAYS_OUT_AHEAD_METRES} ahead, and of the junctions along each of
   * those ways within the same reach of the rider, to
   * {@link WAYS_OUT_DEPTH} junctions from the road — #3051, the file's
   * header. Each way keeps its profile for as long as it is handed on,
   * through a choice that makes another view the road, and the array is the
   * same one until the ways change, so a reader may key what it builds on
   * either. A junction behind the rider keeps the ways it had as the rider
   * passed it; a U-turn drops them all, since the road under the rider
   * changed. None for a rider distance that is not a finite number.
   */
  waysOut(rider: number): readonly OpenWorldWayOut[] {
    if (!Number.isFinite(rider)) return NO_WAYS_OUT;
    const view = this.#view;
    const last = this.#waysOutFor;
    if (last?.of === view.profile && Math.abs(rider - last.at) < WAYS_OUT_LOOK_METRES) {
      return last.ways;
    }
    const origin = this.route.origin;
    // Without a frame a view is drawn about its own first point, which a trim
    // moves: a way is kept only while it is drawn about the same one.
    const fixed = this.#hooks.frame !== undefined;
    const held = new Map<string, HeldWayOut>();
    /** The ways out of `route`'s junctions past ride distance `after`, `depth` junctions from the road. */
    const look = (route: RollingRoute, after: number, depth: number): void => {
      for (const junction of route.junctionsAfter(after)) {
        if (junction.distance - rider > WAYS_OUT_AHEAD_METRES) break;
        for (const way of junction.ways) {
          if (way.edge.id === junction.taken) continue;
          // A way is where it leaves and along which street: the same way
          // through every choice that keeps it in reach, whichever road it
          // is counted from.
          const key = `${String(junction.distance)}:${way.edge.id}`;
          if (held.has(key)) continue;
          let out = this.#waysOut.get(key);
          if (out === undefined || !(fixed || out.origin === origin)) {
            const taking = route.taking(junction.distance, way.edge.id);
            if (taking === undefined) continue;
            const profile = this.#framed(taking.view());
            anchorScenery(profile, { seed: this.#seed, origin: taking.origin });
            out = {
              profile,
              fromMetres: junction.distance - taking.origin,
              junction: junction.distance,
              origin: taking.origin,
              route: taking,
              depth,
            };
          } else {
            out.depth = depth;
          }
          held.set(key, out);
          if (depth < WAYS_OUT_DEPTH) look(out.route, junction.distance, depth + 1);
        }
      }
    };
    // Behind the rider: what each junction of the road had as the rider
    // passed it, and the ways out along those.
    for (const [key, way] of this.#waysOut) {
      if (
        way.depth === 1 &&
        way.junction <= rider &&
        way.junction >= rider - WAYS_OUT_BEHIND_METRES &&
        (fixed || way.origin === origin)
      ) {
        held.set(key, way);
        look(way.route, way.junction, 2);
      }
    }
    look(this.route, rider, 1);
    const ways: readonly OpenWorldWayOut[] = [...held.values()];
    const same =
      last !== undefined &&
      last.ways.length === ways.length &&
      ways.every((way, index) => way === last.ways[index]);
    this.#waysOut = held;
    this.#waysOutFor = {
      of: view.profile,
      at: rider,
      ways: same ? last.ways : ways.length === 0 ? NO_WAYS_OUT : ways,
    };
    return this.#waysOutFor.ways;
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
      this.#hooks.ahead?.(route, rider);
    }
    const profile = route.view();
    if (profile === this.#view.profile) return undefined;
    this.#framed(profile);
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
    // #3051: after a U-turn no junction behind is one the rider passed on this road.
    if (turned) this.#waysOut.clear();
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
