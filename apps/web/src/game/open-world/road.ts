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
 * U-turn's is eased in too, and drawn round a half-turn of its own from where
 * the rider was drawn at the press (#3066, §`pressedTurn`): the road under
 * the rider changed, so the view's own line turns back within a sample of them.
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
 * ## The ground past a junction (#3094)
 *
 * A view's ground was its own road's, so a choice redrew the hills along every
 * way out. Every view of the ride is anchored with the same
 * `street-levels.ts` §`StreetLevels` over the streets the ride holds
 * ({@link OpenWorldRoadHooks.streets}), and `landform.ts` reads an anchored
 * view's relief at the place and levels it beside every one of them: the same
 * ground whichever street is the road.
 *
 * Nothing here reads a clock, writes to a trainer or names a place: the
 * position goes to the reader, which keeps only its block (ADR 0090 R-1).
 */

import {
  metres,
  positionAt,
  type GeographicPosition,
  type RollingJunction,
  type RollingRoute,
  type RouteProfile,
} from '@onyourleft/domain';

import { JunctionScan } from '../cross-streets';
import {
  drawnLine,
  drawnLineAt,
  type DrawnLine,
  type PathPoint,
  type PressedTurn,
} from '../drawn-line';
import type { LandClassMask } from '../land-class';
import type { MappedBuildings } from '../mapped-buildings';
import { NearbyStreetScan } from '../nearby-streets';
import { lineOffsetAt } from '../racing-line';
import { MAPPED_RANKED_AHEAD_METRES } from '../realistic-budget';
import { routeSeed } from '../scatter';
import type { StreetScans } from '../scene';
import { anchorScenery, elevationBand, type ElevationBand } from '../scenery-anchor';
import type { GameState } from '../simulation';
import type { StreetNameLabel } from '../street-names';
import { StreetLevels } from '../street-levels';
import type { WorldCorridor } from '../world-data/corridor';
import {
  ROAD_WIDTH_METRES,
  VIEW_AHEAD_METRES,
  VIEW_BEHIND_METRES,
  corridorOrigin,
  drawProfileIn,
  localGroundPosition,
  type CorridorOrigin,
} from '../terrain';
import { TURNED_OFF_REACH_METRES } from '../way-roads';
import { easeWeight, easedLine, heldLine, reframing, type HeldLine } from './line-ease';

/** No street names: what a road with no names hook paints. */
const NO_LABELS: readonly StreetNameLabel[] = [];

/**
 * How little road may be held ahead of the rider before the route is advanced:
 * **1 km**. *#2982's choice*, above.
 */
export const OPEN_WORLD_REACH_FLOOR_METRES = 1_000;

/**
 * How far across the road a pressed U-turn is drawn, at least, in metres:
 * **3**, `drawn-line.ts` §`U_TURN_LEAST_ACROSS_METRES` — #3066, *its
 * choice*. The half-turn ends across from where the rider was, on the new
 * view's line where that is far enough over, and otherwise this far over,
 * towards it where there is room: the new view's line can run back within a
 * metre of where the rider was, and a half-turn that narrow is a spin on the
 * spot.
 */
const PRESSED_TURN_ACROSS_METRES = 3;

/** How far in from the road's edge a pressed U-turn stays, metres: **0.75**. */
const PRESSED_TURN_KERB_METRES = 0.75;

/** Half the road's width, metres: `terrain.ts` §`ROAD_WIDTH_METRES` over two. */
const ROAD_HALF_METRES = ROAD_WIDTH_METRES / 2;

/**
 * How much odometer a pressed U-turn's half-turn is ridden over, in metres:
 * **15** — #3066's review, *its choice*. Each piece is a cubic in the
 * odometer (`drawn-line.ts` §`hermiteAt`), whose pull on the drawn rider is
 * largest at its ends, `12r/S²` across and `2/S` along for a radius `r` and a
 * span `S`: at 15 m under 0.25 a metre for the widest half-turn the road has
 * room for. The press was first drawn over `πr/0.5`, 9.4 m for the narrowest,
 * and the drawn rider's move changed by 0.06 to 0.1 m from one frame to the
 * next (`u-turn-press.test.tsx`). The rider slows into the half-turn, to a
 * third to a half of their pace midway, and picks up out of it. A fixed span
 * keeps the lag the merge gives back, and so the whole turn, inside 40 m,
 * short of `camera.ts` §`U_TURN_PIVOT_METRES`' 45.
 */
const PRESSED_TURN_SPAN_METRES = 15;

/**
 * How far along the road back the drawn rider is eased from the side of the
 * road the half-turn ends on to the new view's line, at least, in metres:
 * **10** — #3066. And for each metre the drawn rider is behind (or ahead of)
 * the new line's place when the half-turn ends, {@link PRESSED_TURN_MERGE_PER_LAG}
 * more (#3066's review): the half-turn makes no way along the road while the
 * odometer runs on, so the merge gives that back, and over a short one it
 * does so with a jerk.
 */
const PRESSED_TURN_MERGE_METRES = 10;

/** The merge's metres for each metre of lag it gives back: **1** — #3066's review. */
const PRESSED_TURN_MERGE_PER_LAG = 1;

/** The step the slope of a path is read over, metres of odometer either side. */
const SLOPE_STEP_METRES = 0.01;

/** The path at odometer `at`, and its slope per metre of odometer there. */
function pathPointAt(line: DrawnLine, at: number): PathPoint {
  const here = drawnLineAt(line, at);
  const before = drawnLineAt(line, at - SLOPE_STEP_METRES);
  const after = drawnLineAt(line, at + SLOPE_STEP_METRES);
  return {
    x: here.x,
    z: here.z,
    slopeX: (after.x - before.x) / (2 * SLOPE_STEP_METRES),
    slopeZ: (after.z - before.z) / (2 * SLOPE_STEP_METRES),
  };
}

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

/**
 * A junction where the route leaves the road it came along — #3123: it takes
 * a way that is not ADR 0088 D-1.4's default, so the road the rider came
 * along carries on past the junction as {@link way}, and runs back from it as
 * the road itself. `scene.ts` §`SceneInput.turnedOff`. @see OpenWorldRoad.turnedOff
 */
export interface OpenWorldTurnedOff {
  /** The junction's ride distance. */
  readonly junction: number;
  /** The way the route would have taken there: the road turned off, on past the junction. */
  readonly way: OpenWorldWayOut;
}

const NO_TURNED_OFF: readonly OpenWorldTurnedOff[] = [];

/**
 * One junction of the ride, as the scene cuts a village's street at it
 * (`scene.ts` §`SceneInput.junctionsSeen`). @see OpenWorldRoad.junctionsSeen
 */
export interface OpenWorldJunctionSeen {
  /** The junction's ride distance, on the route it was seen on. */
  readonly distance: number;
  /** Where it is: the node every way on from it leaves. */
  readonly position: GeographicPosition;
}

const NO_JUNCTIONS_SEEN: readonly OpenWorldJunctionSeen[] = [];

/**
 * How far behind the rider a junction seen is still handed on, metres:
 * **1 000** — #3095. A junction is a cut in a village's street, and a cut
 * dropped makes the street whole again, which re-lays it: so one is dropped
 * only once the whole of any street it cuts is behind the view. A village's
 * street is under 220 m (`settlements.ts` §`VILLAGE_METRES` and a plot either
 * end) and the view reaches 60 m behind.
 */
export const JUNCTIONS_SEEN_BEHIND_METRES = 1_000;

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
   * #3105: the real water of the tiles planned so far, in {@link frame}, as
   * the land mask the scene reads its water from (`water-mask.ts`);
   * `undefined` while no tile planned holds any.
   */
  readonly water?: (() => LandClassMask | undefined) | undefined;
  /**
   * #2903: the held blocks' streets as a corridor in {@link frame}
   * (`street-corridor.ts`), which the scene draws to the fog as road and
   * stubs at each junction; `undefined` until a block is held.
   */
  readonly streets?: (() => WorldCorridor | undefined) | undefined;
  /**
   * #3052, ADR 0096: where to paint the held streets' names, in {@link frame}
   * (`street-names.ts` §`streetNameLabels`, from the street graph); the same
   * array while the graph is unchanged, and empty while no street is named.
   */
  readonly streetNames?: (() => readonly StreetNameLabel[]) | undefined;
}

/**
 * The half-turn a U-turn pressed is drawn round, on `line`'s view, whose
 * distance zero is ride distance `origin`, for a rider drawn at ride distance
 * `rider` — #3066. The road turns back at ride distance `turnedAt`, and
 * `before` is the path drawn on the view before the press, whose distance
 * zero is `beforeOrigin`.
 *
 * Two pieces: a half-turn from where `before` has the rider, across to
 * {@link PRESSED_TURN_ACROSS_METRES} over, towards the new line where the
 * road has that much room that way and otherwise on the side with more,
 * over {@link PRESSED_TURN_SPAN_METRES}; then, facing back, an ease onto
 * `line` over at least {@link PRESSED_TURN_MERGE_METRES} of the road back.
 * Undefined where the view ends before that, or the rider is past the turn.
 */
function pressedTurn(
  before: DrawnLine,
  beforeOrigin: number,
  line: DrawnLine,
  origin: number,
  rider: number,
  turnedAt: number,
): PressedTurn | undefined {
  const from = rider - origin;
  const ahead = turnedAt - rider;
  if (!(from >= 0 && ahead >= 0)) return undefined;
  const { shift, scaleX } = reframing(corridorOrigin(before.profile), corridorOrigin(line.profile));
  const was = pathPointAt(before, rider - beforeOrigin);
  const start: PathPoint = {
    x: was.x * scaleX + shift.x,
    z: was.z + shift.z,
    slopeX: was.slopeX * scaleX,
    slopeZ: was.slopeZ,
  };
  const pace = Math.hypot(start.slopeX, start.slopeZ);
  if (!(pace > 0)) return undefined;
  // Across, along the path's normal: `scene.ts` §`chaseRider`'s, (−z, x) of
  // its heading, the side its offsets are measured to.
  const normalX = -start.slopeZ / pace;
  const normalZ = start.slopeX / pace;
  const offset = lineOffsetAt(before, rider - beforeOrigin);
  const room = ROAD_HALF_METRES - PRESSED_TURN_KERB_METRES;
  // Where the new line runs back, across the road the same way: its own
  // normal faces the other way. Estimated where the rider will be once the
  // half-turn is ridden; read again at the merge's end, below.
  const back = -lineOffsetAt(line, from + 2 * ahead + PRESSED_TURN_MERGE_METRES);
  const wanted = back - offset;
  const towards = wanted >= 0 ? 1 : -1;
  const roomOn = (side: number): number => room - side * offset;
  // #3066's review: towards the new line only where that side has room for
  // the whole half-turn; a half-turn a metre across is a spin on the spot.
  const side =
    roomOn(towards) >= PRESSED_TURN_ACROSS_METRES || roomOn(towards) >= roomOn(-towards)
      ? towards
      : -towards;
  const across = Math.min(Math.max(PRESSED_TURN_ACROSS_METRES, Math.abs(wanted)), roomOn(side));
  const turnSpan = PRESSED_TURN_SPAN_METRES;
  // The half-turn ends about where along the road it began, `turnSpan` past
  // the press; the new line is then `turnSpan − 2·ahead` further back along
  // the road (it turns `ahead` past the press), which the merge gives back.
  const lag = turnSpan - 2 * ahead;
  const span = turnSpan + PRESSED_TURN_MERGE_METRES + PRESSED_TURN_MERGE_PER_LAG * Math.abs(lag);
  const to = from + span;
  if (!(across > 0) || !(to <= (line.profile.totalDistance as number))) return undefined;
  const across1: PathPoint = {
    x: start.x + normalX * side * across,
    z: start.z + normalZ * side * across,
    slopeX: -start.slopeX,
    slopeZ: -start.slopeZ,
  };
  return {
    pieces: [
      { from, to: from + turnSpan, start, end: across1 },
      { from: from + turnSpan, to, start: across1, end: pathPointAt({ ...line, uTurns: [] }, to) },
    ],
  };
}

/**
 * `line` with `turn` drawn on it — #3066. The view's own U-turn at the press
 * is the half-turn's to draw, so it is not drawn as well; and over the
 * half-turn, and the samples either side of it, the line's curvature is
 * nought. `scene.ts` §`drawnRider` eases the drawn rider off for a sharp bend
 * read from that curvature, and the view's own was its U-turn's, a bend the
 * half-turn is not: read there, the drawn place moved with every step of the
 * rider's speed, by up to 17 cm from one frame's move to the next. So the
 * drawn rider does not lean round the half-turn, either.
 */
function withPressedTurn(line: DrawnLine, turn: PressedTurn): DrawnLine {
  const first = turn.pieces[0];
  const last = turn.pieces[turn.pieces.length - 1];
  if (first === undefined || last === undefined) return line;
  const resolution = line.profile.resolution as number;
  const low = Math.max(0, Math.floor(first.from / resolution) - 1);
  const high = Math.min(line.curvatures.length - 1, Math.ceil(last.to / resolution) + 1);
  const curvatures = new Float64Array(line.curvatures);
  curvatures.fill(0, low, high + 1);
  return {
    ...line,
    curvatures,
    pressed: turn,
    uTurns: line.uTurns.filter((sample) => !(sample + 1 >= low && sample - 1 <= high)),
  };
}

/** One open-world ride's road, from its start. See the file's header. */
export class OpenWorldRoad {
  /** The rolling route itself: #2897's junction choice presses through it. */
  readonly route: RollingRoute;
  readonly #hooks: OpenWorldRoadHooks;
  /** The ride's scenery seed, from its first view (#3055). */
  readonly #seed: number;
  /** The ride's elevation range, from its first view (#3065). */
  readonly #band: ElevationBand;
  /**
   * #3094: the streets the ride holds, which every view's ground is levelled
   * beside — one for the ride, so every view reads the same ground.
   */
  readonly #levels: StreetLevels;
  /** #3094: the frame the ride's places are read in: the session's, or the first view's. */
  readonly #placeFrame: CorridorOrigin;
  /**
   * #3107: the ride's readings of its streets, a slice a frame
   * (`scene.ts` §`SceneInput.streetScans`). One for the ride: a reading is
   * handed on as last read through every view and corridor change.
   */
  readonly streetScans: StreetScans = {
    nearby: new NearbyStreetScan(),
    junctions: new JunctionScan(),
  };
  #view: OpenWorldRoadView;
  #uTurns: number;
  #graphVersion: number | undefined;
  /** The path last handed out by {@link drawnPath}, on {@link view}: what the screen drew. */
  #drawn: DrawnLine | undefined;
  /** The path being eased from, and the ride distance the ease began at. @see drawnPath */
  #easing: { readonly from: HeldLine; readonly at: number } | undefined;
  /**
   * #3066: a U-turn pressed since the last path was drawn, and the path drawn
   * before it with its view's origin, which the half-turn starts from.
   */
  #press:
    { readonly from: DrawnLine; readonly origin: number; readonly turnedAt: number } | undefined;
  /** The pressed U-turn drawn on {@link view}, kept for the view. @see drawnPath */
  #turn: PressedTurn | undefined;
  /** The last line {@link drawnPath} drew {@link #turn} on, and that line with it. */
  #turned: { readonly base: DrawnLine; readonly line: DrawnLine } | undefined;

  constructor(route: RollingRoute, hooks: OpenWorldRoadHooks = {}) {
    this.route = route;
    this.#hooks = hooks;
    this.#uTurns = route.uTurns;
    this.#graphVersion = hooks.graphVersion?.();
    this.#levels = new StreetLevels(() => hooks.streets?.()?.streets);
    const profile = this.#framed(route.view());
    this.#seed = routeSeed(profile);
    this.#band = elevationBand(profile);
    this.#placeFrame = corridorOrigin(profile);
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

  /** The real water round the rider as a land mask (#3105), or `undefined` while none is planned. */
  water(): LandClassMask | undefined {
    return this.#hooks.water?.();
  }

  /** The streets round the rider as a corridor (#2903), or `undefined` while none are held. */
  streets(): WorldCorridor | undefined {
    return this.#hooks.streets?.();
  }

  /** The held streets' names, where to paint each (#3052), or none. */
  streetNames(): readonly StreetNameLabel[] {
    return this.#hooks.streetNames?.() ?? NO_LABELS;
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

  /** Each junction where the route turns off the road it came along, by ride distance. @see turnedOff */
  #turnedOff = new Map<number, HeldWayOut>();
  /** What {@link turnedOff} last handed on: the same array until a junction is added, changed or dropped. */
  #turnedOffList: readonly OpenWorldTurnedOff[] = NO_TURNED_OFF;

  /** Every junction seen, by ride distance and node. @see junctionsSeen */
  #junctionsSeen = new Map<string, OpenWorldJunctionSeen>();
  /** What {@link junctionsSeen} last handed on: the same array until a junction is seen or dropped. */
  #junctionsSeenList: readonly OpenWorldJunctionSeen[] = NO_JUNCTIONS_SEEN;

  /**
   * Every junction {@link waysOut} has seen on the road and along its ways
   * out — #3095: each of the whole route held ahead (`RollingRoute`
   * §`junctionsAfter`, 2 km, so a junction is seen long before the view
   * reaches it), kept as the rider passes it until
   * {@link JUNCTIONS_SEEN_BEHIND_METRES} behind, and dropped at a U-turn.
   * The scene cuts a village's street at each that stands on the street, so
   * the piece past one is laid alike along the road and every way out
   * (`streets.ts` §`streetsAt`); and since the set does not change as a
   * junction comes into the view or leaves it, no street is re-laid on an
   * ordinary frame. The same array until a junction is seen or dropped.
   */
  junctionsSeen(): readonly OpenWorldJunctionSeen[] {
    return this.#junctionsSeenList;
  }

  /** Notes `junction` as seen, at its ride distance. @see junctionsSeen */
  #seen(junction: RollingJunction): void {
    const node = junction.ways[0]?.edge;
    const at = node?.points[0];
    if (node === undefined || at === undefined) return;
    const key = `${String(junction.distance)}:${node.from}`;
    if (this.#junctionsSeen.has(key)) return;
    this.#junctionsSeen.set(key, { distance: junction.distance, position: at.position });
    this.#junctionsSeenList = NO_JUNCTIONS_SEEN;
  }

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
        // #3095: every junction of the route held, in view or not.
        this.#seen(junction);
        if (junction.distance - rider > WAYS_OUT_AHEAD_METRES) continue;
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
            this.#keyed(profile, taking.origin);
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
        // #3123: where the road's own route turns off the road it came along,
        // the way it would have taken is that road on past the junction. As
        // last looked at before the rider passes it: a choice can change it
        // until then.
        if (route === this.route) {
          const onward =
            junction.taken === junction.defaultWay
              ? undefined
              : held.get(`${String(junction.distance)}:${junction.defaultWay}`);
          if (onward === undefined) this.#turnedOff.delete(junction.distance);
          else this.#turnedOff.set(junction.distance, onward);
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
    for (const [key, junction] of this.#junctionsSeen) {
      if (junction.distance < rider - JUNCTIONS_SEEN_BEHIND_METRES) {
        this.#junctionsSeen.delete(key);
        this.#junctionsSeenList = NO_JUNCTIONS_SEEN;
      }
    }
    if (this.#junctionsSeenList === NO_JUNCTIONS_SEEN && this.#junctionsSeen.size > 0) {
      this.#junctionsSeenList = [...this.#junctionsSeen.values()];
    }
    // #3123: a junction turned off at is handed on until it is past the fog behind.
    for (const [junction, way] of this.#turnedOff) {
      if (junction < rider - TURNED_OFF_REACH_METRES || !(fixed || way.origin === origin)) {
        this.#turnedOff.delete(junction);
      }
    }
    const listed = this.#turnedOffList;
    if (
      listed.length !== this.#turnedOff.size ||
      listed.some((each) => this.#turnedOff.get(each.junction) !== each.way)
    ) {
      this.#turnedOffList =
        this.#turnedOff.size === 0
          ? NO_TURNED_OFF
          : [...this.#turnedOff].map(([junction, way]) => ({ junction, way }));
    }
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

  /**
   * Every junction within {@link TURNED_OFF_REACH_METRES} of a rider at ride
   * distance `rider` where the route turns off the road it came along — #3123,
   * the owner's tablet ride of 2026-11-24: after a turn, the road turned off
   * stopped at the junction although it carries on.
   *
   * After a turn the road the rider came along is neither the road the scene
   * draws (it draws the view's road from `terrain.ts` §`VIEW_BEHIND_METRES`
   * behind the rider) nor a street the streets' own drawing reads (it is the
   * route, so `nearby-streets.ts` keeps off it, and the way on past the
   * junction was the route until the choice), and a way out is handed on only
   * to {@link WAYS_OUT_BEHIND_METRES} behind the rider. So each is handed on
   * here, with the way the route would have taken, until the rider is past
   * the fog from it: `scene.ts` draws the road on past the junction and back
   * from it (`way-roads.ts` §`WayReached.turnedOff`) once the rider has passed
   * it. Junctions ahead are handed on too, as the route stands now, so the
   * scene starts drawing on the frame the rider passes one. A U-turn drops
   * them all, as it drops the ways out. The same array until one is added,
   * changed or dropped; none for a rider distance that is not a number.
   */
  turnedOff(rider: number): readonly OpenWorldTurnedOff[] {
    if (!Number.isFinite(rider)) return NO_TURNED_OFF;
    this.waysOut(rider);
    return this.#turnedOffList;
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
      // #3094: the view keyed before the session plans buildings against it,
      // so they are planned on the ground the scene will draw under them.
      this.#keyed(this.#framed(route.view()), route.origin);
      this.#hooks.ahead?.(route, rider);
    }
    const profile = route.view();
    if (profile === this.#view.profile) return undefined;
    this.#framed(profile);
    const turned = route.uTurns !== this.#uTurns;
    this.#uTurns = route.uTurns;
    // #2989: the new view's line is eased in from the path last drawn, from
    // here. #3066: after a U-turn too, where the road up to the rider is the
    // road they came along, and the half-turn starts from that path.
    const drawn = this.#drawn;
    this.#easing =
      drawn === undefined || !Number.isFinite(rider)
        ? undefined
        : { from: heldLine(drawn, this.#view.origin), at: rider };
    // `RollingRoute.uTurn` turns the road round on the first sample at or
    // after the rider.
    const resolution = profile.resolution as number;
    this.#press =
      turned && drawn !== undefined && Number.isFinite(rider)
        ? {
            from: drawn,
            origin: this.#view.origin,
            turnedAt: Math.ceil(rider / resolution) * resolution,
          }
        : undefined;
    this.#turn = undefined;
    this.#turned = undefined;
    this.#drawn = undefined;
    // #3051: after a U-turn no junction behind is one the rider passed on this road.
    if (turned) {
      this.#waysOut.clear();
      this.#junctionsSeen.clear();
      this.#junctionsSeenList = NO_JUNCTIONS_SEEN;
      this.#turnedOff.clear();
      this.#turnedOffList = NO_TURNED_OFF;
    }
    this.#view = this.#anchored({ profile, origin: route.origin, turned });
    return this.#view;
  }

  /** `view`, its scenery keyed on the ride's seed, distance (#3055) and elevation range (#3065). */
  #anchored(view: OpenWorldRoadView): OpenWorldRoadView {
    this.#keyed(view.profile, view.origin);
    return view;
  }

  /** Keys `profile`, at ride distance `origin`, on the ride (#3055) and its places (#3094). */
  #keyed(profile: RouteProfile, origin: number): void {
    anchorScenery(profile, {
      seed: this.#seed,
      origin,
      levels: this.#levels,
      frame: this.#placeFrame,
      band: this.#band,
    });
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
    const eased = easing === undefined ? line : easedLine(easing.from, line, view.origin, weight);
    // #3066: a U-turn pressed since the last path, drawn from where that path
    // had the rider on this frame.
    const press = this.#press;
    this.#press = undefined;
    if (press !== undefined && Number.isFinite(rider)) {
      this.#turn = pressedTurn(press.from, press.origin, line, view.origin, rider, press.turnedAt);
    }
    const turn = this.#turn;
    const known = this.#turned;
    const drawn =
      turn === undefined
        ? eased
        : known?.base === eased
          ? known.line
          : withPressedTurn(eased, turn);
    // Kept while the ease runs, the eased line being a new one each frame;
    // once it is over the line is the view's own, and so is this.
    if (turn !== undefined) this.#turned = { base: eased, line: drawn };
    this.#drawn = drawn;
    return drawn;
  }
}
