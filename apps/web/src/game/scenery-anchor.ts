// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where an open-world ride's scenery is keyed** — #3055.
 *
 * Every procedural generator in `game/` places on a grid along its profile:
 * `scatter.ts`'s cells, `settlements.ts`'s sites and lots, `landform.ts`'s
 * fields and relief nodes. For a route that grid is stretched to divide the
 * route evenly, so a loop's seam is an ordinary cell boundary, and the seed
 * is the route's own (`scatter.ts` §`scatterSeed`). Both are read off the
 * profile, and an open-world ride's profile is a VIEW (`open-world/road.ts`):
 * a new one after every choice, U-turn, reopen or extension, a different
 * length each time, and from a first point the trim behind moves. So the seed
 * changed and every cell moved on each of them, and the whole world was
 * regenerated on that frame — the owner's "just flipping screens".
 *
 * An anchored profile is placed on a grid that is not the view's:
 *
 * 1. **The seed is the ride's**, fixed when it started (`road.ts` takes it
 *    from its first view), never the view's.
 * 2. **Cells are counted in ride distance**, `along + origin`, at the nominal
 *    spacing, never stretched: cell `i` is ride distance `[i·span, (i+1)·span)`
 *    on every view that holds it. An open-world view is never a loop, so
 *    nothing wraps and the seam stretching was for does not exist.
 *
 * So a view change keeps every cell short of the change, and with it every
 * item, which is #3055's whole criterion.
 *
 * ## Why a registry, keyed on the profile object
 *
 * The seed and the grid are read by thirty-odd functions, most of them a
 * call or two below `scene.ts` §`sceneFrame`, and all of them are handed the
 * profile. Keyed on the OBJECT in a `WeakMap`, as `waterways.ts` §`computed`
 * is and for its reason: a view is never changed once handed out
 * (`RollingRoute.view`), so the anchor is a fact about that object rather
 * than a cache a change has to clear, and it is collected with it.
 * **A profile nobody anchored is a route**, and reads exactly what it read
 * before #3055: `arrangement-unchanged.test.ts`' digest is what says so.
 */

import type { RouteProfile } from '@onyourleft/domain';

import type { CorridorOrigin } from './terrain';

/** What an open-world view's scenery is keyed on. */
export interface SceneryAnchor {
  /** The ride's scenery seed, fixed when it started. */
  readonly seed: number;
  /** The ride distance of the profile's distance zero (`RollingRoute.origin`). */
  readonly origin: number;
  /**
   * #3094: how far a place in the ride's frame is from the nearest street the
   * ride holds (`street-levels.ts`), which `landform.ts` levels the ground
   * beside; the same object for every view of the ride. Absent, the ground is
   * levelled beside the view's own road alone.
   */
  readonly levels?: PlaceLevels | undefined;
  /**
   * #3094: the frame the ride's places are read in — the session's start, or
   * the ride's first view's own — which {@link levels}' streets are in too.
   * A view drawn about another point is read in this one, so the ground at a
   * place is the same on every view. Absent, each view's own.
   */
  readonly frame?: CorridorOrigin | undefined;
  /**
   * The ride's elevation range, fixed when it started: the lowest and highest
   * of its first view, in metres above sea level — #3065. A route stands its
   * horizon's hills on the middle of its whole profile's range (`landform.ts`
   * §`horizonRelief`); an open-world view stands them on this, because a
   * view's own range moves as road is added ahead and dropped behind, and the
   * distant hills rose or sank with it. Distant hills do not move as a rider
   * climbs, so a ride that climbs above them looks down on them. Absent — a
   * worker's copy of a view keyed only to plan its buildings
   * (`open-world/tile-buildings.ts`), which draws no horizon — the view's own.
   */
  readonly band?: ElevationBand | undefined;
}

/** How far a place is from the nearest street held, metres: `Infinity` where none is held. */
export interface PlaceLevels {
  distance(x: number, z: number): number;
}

/** An elevation range, metres above sea level. */
export interface ElevationBand {
  readonly lowest: number;
  readonly highest: number;
}

/** The lowest and highest of `profile`'s elevations. */
export function elevationBand(profile: RouteProfile): ElevationBand {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const elevation of profile.elevations) {
    lowest = Math.min(lowest, elevation);
    highest = Math.max(highest, elevation);
  }
  return { lowest, highest };
}

const anchors = new WeakMap<RouteProfile, SceneryAnchor>();

/** Keys `profile`'s scenery on `anchor`, for as long as the profile lives. */
export function anchorScenery(profile: RouteProfile, anchor: SceneryAnchor): void {
  anchors.set(profile, anchor);
}

/** `profile`'s anchor, or `undefined` for a route. */
export function sceneryAnchor(profile: RouteProfile): SceneryAnchor | undefined {
  return anchors.get(profile);
}

/**
 * The routes drawn on past their end — #3336, `past-the-finish.ts`: each
 * extension, keyed on its object as an anchor is and for the same reason, to
 * the route it carries on from.
 */
const extensions = new WeakMap<RouteProfile, RouteProfile>();

/**
 * Keys `extended`'s scenery on `route`, the route it is drawn on past the end
 * of — #3336. Its seed is the route's, its cells the route's own stretched
 * cells, counted on past its end, and everything read off a whole profile —
 * the waterways, the world's colours, the hills on the horizon, the relief —
 * is read off the route: so the world short of the route's end is the one the
 * route itself draws, to the item, and nothing moves when a frame starts
 * drawing the extension.
 */
export function extendScenery(extended: RouteProfile, route: RouteProfile): void {
  extensions.set(extended, route);
}

/** The route `profile` carries on from, when it is one drawn past its end (#3336). */
export function extendedRoute(profile: RouteProfile): RouteProfile | undefined {
  return extensions.get(profile);
}

/**
 * The profile whole-profile readings are taken from — #3336: the route an
 * extension carries on from, and every other profile itself.
 */
export function routeOf(profile: RouteProfile): RouteProfile {
  return extensions.get(profile) ?? profile;
}

/**
 * A grid of whole cells along a profile. Cell `i` covers profile distance
 * `[i·span − shift, (i+1)·span − shift)`.
 */
export interface SceneryGrid {
  /** Each cell's length. */
  readonly span: number;
  /** The ride distance of profile distance zero: 0 on a route. */
  readonly shift: number;
  /**
   * How many cells a lap of a loop has, which a cell index wraps by
   * ({@link wrappedCell}); on an anchored profile, how many reach it.
   */
  readonly count: number;
  /** The first cell that reaches the profile. */
  readonly first: number;
  /** The last cell that reaches the profile. */
  readonly last: number;
  /** Whether the profile is anchored, so nothing wraps. */
  readonly anchored: boolean;
}

/**
 * The grid of `nominal`-metre cells `profile`'s scenery is placed on: on a
 * route, stretched to divide it evenly, and at least one cell; on an anchored
 * profile, `nominal` itself, counted from the ride's start.
 *
 * #3336: on a route drawn past its end, the route's own cells, and on past its
 * end at the same span; `count` stays the route's, so what is counted in
 * cells across a whole route (a cluster's nodes) is the route's too.
 */
export function sceneryGrid(profile: RouteProfile, nominal: number): SceneryGrid {
  const total: number = profile.totalDistance;
  const anchor = anchors.get(profile);
  if (anchor === undefined) {
    const route = routeOf(profile);
    const lap: number = route.totalDistance;
    const count = Math.max(1, Math.round(lap / nominal));
    const span = lap / count;
    const last = route === profile ? count - 1 : Math.max(count - 1, Math.ceil(total / span) - 1);
    return { span, shift: 0, count, first: 0, last, anchored: false };
  }
  const shift = anchor.origin;
  const first = Math.floor(shift / nominal);
  const last = Math.max(first, Math.ceil((shift + total) / nominal) - 1);
  return { span: nominal, shift, count: last - first + 1, first, last, anchored: true };
}

/**
 * The cell a lap of a loop holds `cell` at: `cell` itself, but on a route that
 * loops. #3336: and itself on a route drawn past its end, whose cells there
 * are new ones, placed past the end rather than back at the start.
 */
export function wrappedCell(grid: SceneryGrid, cell: number): number {
  return grid.anchored || grid.last >= grid.count
    ? cell
    : ((cell % grid.count) + grid.count) % grid.count;
}
