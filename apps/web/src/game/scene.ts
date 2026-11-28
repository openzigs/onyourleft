// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning a simulated ride into a frame the renderer can draw.
 *
 * Pure, and deliberately so: this is where the rider, the bot (#92) and the
 * ghost (#93) are placed on the road, and every one of those placements is
 * arithmetic that jsdom can check. What is left for `three-renderer.ts` is only
 * turning the result into pixels.
 *
 * ⚠️ **The three markers are placed here and told apart in the renderer.** This
 * file decides *where* each is; `three-renderer.ts` decides what each looks
 * like. #93's third criterion — that a rider glancing at a bar-mounted phone
 * can tell them apart instantly — needs both halves, and splitting them this
 * way means neither can be satisfied by accident.
 *
 * ⚠️ **This paragraph used to say the renderer gives each "a different shape as
 * well as a different colour", and since #368 it does not** — all three are
 * bicycles and colour is what tells them apart. `bicycle.ts` carries the
 * replaced argument and `three-renderer.ts` §`RIDER_TINTS` carries the
 * replacement.
 */

import type { RiderBody, UnitSystem } from '@onyourleft/store';

import { billboardsAt, clearOfBillboards, nearestBillboards, type Billboard } from './billboards';
import { lineStands, linesNear } from './gantry';
import { clearOfTheRoadOn, drawnPastTheFinish } from './past-the-finish';
import {
  distanceOnRoute,
  ghostDistanceAt,
  ghostHasFinished,
  gradeAt,
  metres,
  seconds,
  type GhostTrack,
} from '@onyourleft/domain';

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  RIDER_HALF_WIDTH_METRES,
  bicycleRoll,
  drawnCrankAngle,
  pedallingShare,
  simulatedCrankAngle,
  steerAngle,
  type RiderRoll,
} from './bicycle';
import { STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED } from '@onyourleft/physics';
import {
  countrysideWithout,
  NO_LAND_CLASS,
  type Countryside,
  type CountrysideLever,
  type LandClassMask,
} from './land-class';
import {
  ROAD_CLEARANCE_METRES,
  horizonRelief,
  standingOnGround,
  terrainCorridor,
  terrainHeightAt,
  type TerrainMesh,
} from './landform';
import { poolsInView } from './mapped-pools';
import { easedPlace, MAX_LAG_METRES, steadyTurnSpeed, type EasedPlace } from './bend-easing';
import {
  crashBodyShare,
  crashClipSeconds,
  crashedRoll,
  crashRebound,
  type CrashSide,
} from './delivery/crash-look';
import {
  BOT_TURN_SPEED_FLOOR,
  LANE_CHANGE_TURN_SPEED_FLOOR,
  laneChangeLean,
  laneChangeRate,
} from './lane-change-lean';
import { CAMERA_BEHIND_METRES, CAMERA_TARGET_AHEAD_METRES } from './camera';
import type {
  CameraPose,
  RaceHitLook,
  RiderMarker,
  RidingInputs,
  SceneFrame,
  WaterFrame,
} from './port';
import {
  SCATTER_MAX_ITEMS,
  SCATTER_WAY_REACH_METRES,
  scatterAt,
  scatterSeed,
  type ScatterItem,
  type ScatterWay,
  type StructureKind,
  type WaysOutPlacing,
} from './scatter';
import { FOLIAGE_SWAY_METRES } from './foliage-light';
import { sceneryPlanRadius } from './near-field';
import { drawnScale } from './scenery-plan';
import {
  gradeCrossingsAt,
  mappedGradeCrossings,
  NO_CROSSINGS_IN_VIEW,
  type CrossingsInView,
} from './overpasses';
import {
  LINE_LIMIT_METRES,
  MAXIMUM_LEAN_RADIANS,
  leanAt,
  lineOffsetAt,
  lineSlopeAt,
  racingLine,
  type RacingLine,
} from './racing-line';
import { ghostClock, type GameState } from './simulation';
import {
  drawnLine,
  drawnLineAt,
  drawnPlaceOf,
  isDrawnLine,
  type DrawnLine,
  type DrawnPoint,
} from './drawn-line';
import {
  ROAD_WIDTH_METRES,
  corridorOrigin,
  BEND_SMOOTHING_METRES,
  drawnRoadFrame,
  drawnRoadPosition,
  localGroundPosition,
  roadCorridor,
  VIEW_AHEAD_METRES,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import {
  BOUNDARY_KINDS,
  NO_MAPPED_TOWN,
  STRUCTURE_MAX_ITEMS,
  clearOfBuildings,
  clearOfSettlements,
  groundedFootprintOf,
  structureClearance,
  structuresAt,
  structuresOnWay,
  structuresWithin,
  urbanOfTown,
  type MappedTown,
  type SettlementFootprint,
} from './settlements';
import {
  boardsClearOfSideRoads,
  clearOfSideRoads,
  levelCrossings,
  mappedJunctions,
  mappedTracks,
  onSideRoad,
  SIDE_ROAD_SCENERY_MARGIN_METRES,
  sideRoadClearance,
  sideRoadsAt,
  joinedJunctions,
  type JunctionScan,
  type SideRoad,
} from './cross-streets';
import { footwaysInView, NO_FOOTWAYS } from './footway-surfaces';
import { NO_PAVEMENT_DATA, pavementSides, type PavementSides } from './footways';
import { riddenSpanParts, riddenSpans, sideDeckParts } from './mapped-spans';
import {
  NEARBY_STREET_LIFT_METRES,
  nearbyStreets,
  nearbyStreetsAt,
  NO_NEARBY_STREETS,
  routeGround,
  type NearbyStreets,
  type NearbyStreetScan,
} from './nearby-streets';
import { TURNED_OFF_REACH_METRES, wayRoads, type WayReached } from './way-roads';
import { junctionSurfacesAt, type JunctionSurface, type TurnedJunction } from './junction-surface';
import { streetNamesInView, type RouteLabelRoad, type StreetNameLabel } from './street-names';
import { BILLBOARD_FOOTPRINT } from './logo-board';
import {
  NO_PEOPLE,
  PEOPLE_FAR_METRES,
  besideSideRoads,
  clearOfPavements,
  footwayWalks,
  groundOf,
  peopleAt,
  streetWalks,
  type PeopleInView,
  type Person,
  type WalkKind,
} from './people';
import { parkDressingInView, type ParkDressingInView } from './park-dressing';
import {
  NO_PARKED_CARS,
  PARKED_CAR_AHEAD_METRES,
  PARKED_CAR_CELL_METRES,
  parkedCarsAt,
  parkedCarsSeenFrom,
  type ParkedCarsInView,
} from './parked-cars';
import { laidAlongTheGround } from './park-fields';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { roadsideInView } from './roadside-safety';
import { routeOf, sceneryAnchor } from './scenery-anchor';
import {
  CITY_PAVEMENT_WIDTH_METRES,
  cityPavementOn,
  streetsAt,
  type VillageStreet,
} from './streets';
import {
  bridgeParts,
  bridgeSpans,
  MAXIMUM_BRIDGE_PARTS,
  onOpenWater,
  waterSurface,
  waterways,
  type BridgePart,
  type Waterways,
} from './waterways';
import { worldStyle } from './world';
import type { WorldCorridor } from './world-data/corridor';
import {
  clearOfDriveways,
  clearOfMappedBuildings,
  MAPPED_AHEAD_STEP_METRES,
  mappedChunk,
  type MappedBuildings,
  type MappedBuildingsInView,
} from './mapped-buildings';
import { MAPPED_RANKED_AHEAD_METRES } from './realistic-budget';
import {
  clearLateral,
  cyclistLook,
  cyclistsInReach,
  townAt,
  type CyclistInReach,
  type SceneryCyclist,
} from './scenery-cyclists';
import { NO_URBAN_CLASS, type UrbanClassMap } from './urban-class';
import { positionAt, type GeographicPosition, type RouteProfile } from '@onyourleft/domain';

/** One junction of an open-world ride. @see SceneInput.junctionsSeen */
export interface JunctionSeen {
  /** Its ride distance. */
  readonly distance: number;
  /** Where it is. */
  readonly position: GeographicPosition;
}

/** A junction where an open-world ride's route turns off the road it came along. @see SceneInput.turnedOff */
export interface TurnedOffRoad {
  /** Its ride distance. */
  readonly junction: number;
  /** The way the route would have taken there: the road turned off, on past the junction. */
  readonly way: ScatterWay;
}

/** Everything a frame needs beyond the rider's own state. */
export interface SceneInput {
  readonly profile: RouteProfile;
  /**
   * The rider's units, for the board before a line — #679. Absent is metric,
   * for `riderDistance`'s reason (the harness and `atStartLine` build frames
   * with no rider behind them); `GameView` supplies the rider's own, and
   * `GameView.test.tsx` §"#679" reads that it does.
   */
  readonly units?: UnitSystem | undefined;
  readonly origin: CorridorOrigin;
  readonly state: GameState;
  /**
   * Where to draw the rider this frame, if not where the last step left them.
   *
   * ⚠️ **The whole of #323's seam on this side, and it is optional for one
   * reason only**: `atStartLine` and the browser harness build frames from a
   * state with no simulation behind it at all, and there is nothing for them
   * to interpolate. The ride screen supplies it on every frame, from
   * `GameSimulation.drawnAt`, and `GameView.test.tsx` fails if it stops —
   * `check-wiring.mjs` §Limits is explicit that an optional field nobody
   * supplies is a hole this repository's gates cannot see, so the guard is a
   * test that reads what the renderer was handed.
   *
   * Absent means "where the newest completed step left them", which is what
   * every frame drew before #323 and is what made the world step.
   */
  readonly riderDistance?: number | undefined;
  /**
   * Where to draw the bot — its odometer, from `@onyourleft/physics`'s
   * `advanceBot`, or a blend of its last two (#323). Optional; absent means
   * there is no bot.
   */
  readonly botDistance?: number | undefined;
  /** The rider's own previous attempt, when they chose to race one. Optional. */
  readonly ghost?: GhostTrack | undefined;
  /**
   * Which body the rider chose (#2839), undefaulted: the rider's own marker
   * and their ghost's — their own earlier ride — carry it, and a renderer
   * draws an absent one as the default. @see RiderMarker.body
   */
  readonly riderBody?: RiderBody | undefined;
  /** The pacer's body, seeded for the ride (#2839, `rider-body.ts`). @see RiderMarker.body */
  readonly botBody?: RiderBody | undefined;
  /**
   * The route's corridor of map features, fixed when the ride started — #1539,
   * ADR 0054. Absent on every ride with none: the stylised world, map tiles
   * off, no archive, offline with nothing kept, or a read still running at
   * the press.
   *
   * Read here twice since #1546 and #1551. #1546 reads it through
   * {@link landClass}, built from it once at the press; since #1551 the
   * village streets read its footways: a pavement stands on the side a
   * sidewalk is mapped on, where the corridor was read (`footways.ts`
   * §`pavementSides`). #1540 places buildings from it (ADR 0054 D-5).
   * `world-data/corridor-wiring.test.tsx` reads it back off the input
   * `sceneFrame` was handed, which is the guard an optional field nobody
   * supplies needs (`check-wiring.mjs` §Limits).
   */
  readonly worldCorridor?: WorldCorridor | undefined;
  /**
   * What the ground is where {@link worldCorridor} read map data — #1546,
   * `land-class.ts`, built from it ONCE, at the press, by `GameView`. Every
   * placement rule reads it: no procedural site on mapped land, and no tree,
   * shrub, rock or field boundary on mapped built-up land or water.
   *
   * Absent is {@link NO_LAND_CLASS}, today's world — every ride with no
   * corridor, and the browser gate's `-landclass` control.
   * `world-data/corridor-wiring.test.tsx` reads it back off the input.
   */
  readonly landClass?: LandClassMask | undefined;
  /**
   * The buildings planned from {@link worldCorridor}'s footprints — #1540's
   * plans, indexed by `mapped-buildings.ts` §`mappedBuildingsOf` — built ONCE,
   * at the press, by `GameView`, as {@link landClass} is. #1549: each frame
   * carries them on to the renderer with the rider's chunk
   * (`SceneFrame.mappedBuildings`), and no tree, shrub or rock stands on their
   * ground.
   *
   * Absent on every ride with no corridor, which is today's world.
   * `world-data/corridor-wiring.test.tsx` reads it back off the input.
   */
  readonly mappedBuildings?: MappedBuildings | undefined;
  /**
   * #2902: in an open-world ride, the ways on from the next junction the route
   * does not take (`open-world/road.ts` §`OpenWorldRoad.branchesAhead`), `x, z`
   * pairs with a `NaN` pair between ways. A refill ranks the mapped buildings
   * by the nearest of the road ahead AND these, so 60 m before a junction the
   * belt holds the buildings of the street the rider has not chosen as well as
   * those of the one they are on. Absent on every other ride: ranked by the
   * road ahead alone, as since #2429.
   */
  readonly mappedBranches?: Float32Array | undefined;
  /**
   * #3052, ADR 0096: an open-world ride's street names, where to paint each
   * (`street-names.ts` §`streetNameLabels`, from the session's street graph),
   * in the frame's local metres. The scene draws the nearest on their
   * streets' surfaces ({@link SceneFrame.streetNames}). Absent on every other
   * ride, which names no street.
   */
  readonly streetNames?: readonly StreetNameLabel[] | undefined;
  /**
   * #3051: in an open-world ride, the ways out of the junctions in view that
   * the route does not take (`open-world/road.ts` §`OpenWorldRoad.waysOut`),
   * each as the view the route would hand out were it taken. The scenery is
   * placed along each as it is along the road, under the same budgets, so a
   * junction choice replaces nothing that stands past the junction: it swaps
   * which view is the road and which a way out. Since #3095 so are the
   * villages' streets and crossroads, the billboards, the people on those
   * streets and the other cyclists ({@link waysReached}). Absent on every
   * other ride.
   *
   * ⚠️ Optional the unsafe way round, like {@link drawnPath}: a `GameView`
   * that stopped handing it over would compile, and every press would again
   * move the scenery past the junction from one street to another on that
   * frame. `open-world/junction-corner.test.tsx` reads it back off the frames
   * the renderer was handed.
   */
  readonly waysOut?: readonly ScatterWay[] | undefined;
  /**
   * #3095: in an open-world ride, every junction the ride has seen on the
   * road and along its ways out (`open-world/road.ts`
   * §`OpenWorldRoad.junctionsSeen`), at its ride distance. A village's street
   * that reaches across one is laid in pieces either side of it, so the
   * piece past it is the same along the road and along every way out
   * ({@link waysOut}). Seen 2 km ahead and kept 1 km behind, so the pieces of
   * a street in view never change as the ride goes. Absent on every other
   * ride, which cuts no street.
   *
   * ⚠️ Optional the unsafe way round, like {@link waysOut}: with it gone a
   * village's street past a junction is whole on the road and in pieces on
   * no way, and a press re-lays it. `open-world/junction-corner.test.tsx`
   * reads the pavements back off the renderer's frames through a press.
   */
  readonly junctionsSeen?: readonly JunctionSeen[] | undefined;
  /**
   * #3123: in an open-world ride, each junction near the rider where the
   * route turns off the road it came along (`open-world/road.ts`
   * §`OpenWorldRoad.turnedOff`), at its ride distance, with the way the
   * route would have taken there. Once the rider has passed one, the road
   * turned off is drawn on past the junction along that way and back from
   * it along the road, to `open-world/road.ts` §`TURNED_OFF_REACH_METRES`
   * each way, wherever nothing else draws it (`way-roads.ts`): the road
   * the frame draws stops `terrain.ts` §`VIEW_BEHIND_METRES` behind the
   * rider, and a way out is handed on no further behind. Absent on every
   * other ride.
   *
   * ⚠️ Optional the unsafe way round, like {@link waysOut}: with it gone the
   * road turned off is cut off at the junction again.
   * `open-world/turned-off-road.test.tsx` reads it back off the frames the
   * renderer was handed.
   */
  readonly turnedOff?: readonly TurnedOffRoad[] | undefined;
  /**
   * #3133: in an open-world ride, each junction near the rider that the
   * route turns through, chosen or not (`open-world/road.ts`
   * §`OpenWorldRoad.junctionsTurned`), with every way on from it the route
   * does not take. Each in view is drawn as the streets meeting there, each
   * arm to its own width, joined at a surface with rounded corners, and the
   * road's edge lines and centre line stop at its mouths
   * (`junction-surface.ts`). Absent on every other ride.
   *
   * ⚠️ Optional the unsafe way round, like {@link waysOut}: with it gone a
   * junction turned through is one road bending again.
   * `open-world/junction-surface.test.tsx` reads it back off the frames the
   * renderer was handed.
   */
  readonly junctionsTurned?: readonly TurnedJunction[] | undefined;
  /**
   * What #1550's procedural lots read of the corridor's footprints, built ONCE,
   * at the press, by `GameView`, from the SAME plans {@link mappedBuildings} is
   * indexed from — #1583. `sceneFrame` never plans: planning a dense corridor
   * can take its whole 400 ms budget, which a render frame cannot spend.
   * Absent is no mapped town, as on every ride with no corridor.
   */
  readonly mappedTown?: MappedTown | undefined;
  /**
   * Other real riders in a room, where to draw them — #783: the interest set's
   * riders (`net/interest.ts`), each at the distance `net/snapshots.ts`
   * interpolated. Absent, or empty, on every ride with no room.
   *
   * ⚠️ **A distance and a speed, and nothing else**, on purpose: no name, no
   * power, no mass. What a renderer is handed about another rider is where they
   * are, and `GameView.test.tsx` §"#783" walks every frame for a mass.
   */
  readonly remoteRiders?: readonly RemoteRiderInput[] | undefined;
  /**
   * The most scenery this frame may carry — the current quality rung's
   * `scatterItems`, #245.
   *
   * ⚠️ **Optional, and absent means the target rung** rather than "no budget":
   * `atStartLine` and the browser harness build frames with no quality state
   * behind them at all, exactly as they build frames with no interpolation
   * behind them, and {@link SCATTER_MAX_ITEMS} is what every frame carried
   * before #245.
   *
   * ⚠️ **This is where the reduction is actually saved**, and it is a different
   * saving from the one `three-renderer.ts` makes with the same number. Here it
   * stops the items being *placed* — a sort over three hundred candidates on
   * the thread GATT notifications arrive on — and there it stops them being
   * *submitted*. A rung applied only in the renderer would leave a throttling
   * phone doing all the arithmetic and then throwing the answer away.
   */
  readonly scatterItems?: number | undefined;
  /**
   * The most structures this frame may carry — the current rung's
   * `structureItems`, #460. Optional for {@link scatterItems}' reason, and
   * absent means the target rung.
   */
  readonly structureItems?: number | undefined;
  /**
   * How far the rider's cranks have turned, in radians — #349.
   *
   * Integrated from the cadence reading by `GameView`, which is where the
   * frame clock and the sensors both are; this file only carries it onto the
   * rider's own marker. Optional for the reason {@link riderDistance} is: the
   * start line and the browser harness build frames with no ride behind them.
   */
  readonly crankAngle?: number | undefined;
  /**
   * Whether the rider's cranks are being turned by a cadence reading this
   * frame — #625, `bicycle.ts` §`cadenceTurns`, supplied by `GameView` beside
   * {@link crankAngle}. The realistic body rocks only while it is.
   *
   * ⚠️ **Optional the safe way round**: absent is a rider who is NOT
   * pedalling, which is what the start line and a harness frame with no
   * cadence behind it are. A `GameView` that stopped supplying it would draw a
   * still rider, and `GameView.test.tsx` reads it off the frame for that
   * reason.
   */
  readonly pedalling?: boolean | undefined;
  /**
   * The cadence turning the rider's cranks, in rpm — #1999, `bicycle.ts`
   * §`turningCadence`, supplied by `GameView` beside {@link pedalling}. The
   * rider's drawn position is chosen from it with their power, grade and speed
   * (`posture.ts`). Absent is no cadence reading, which is what a rider with
   * no sensor has: the rules then go on what else there is.
   */
  readonly cadence?: number | undefined;
  /**
   * Draws every rider on the centreline, upright, as every frame did before
   * #499 — the control the browser gate measures the line against, and
   * nothing else. Absent, or `false`, is the line (`racing-line.ts`).
   *
   * ⚠️ **Optional the safe way round.** `check-wiring.mjs` §Limits is explicit
   * that an optional field nobody supplies is a hole no gate here can see; that
   * is a hole only when its absence switches something OFF. Absent here is the
   * feature, so a ride that forgot it rides the line.
   */
  readonly centreline?: boolean | undefined;
  /**
   * Draws every rider at their own odometer and speed, never eased off for a
   * bend, as every frame did before #1998 — the control the owner's frames
   * and a test of a lean past 25° are drawn with, and nothing else. Absent,
   * or `false`, is the easing (`bend-easing.ts`). Optional the safe way
   * round, for {@link centreline}'s reason.
   */
  readonly uneased?: boolean | undefined;
  /**
   * The path the riders are drawn along and the camera follows, where it is
   * not `drawn-line.ts` §`drawnLine` of {@link profile} — #2989. An
   * open-world ride's road eases a new view's line in from the one drawn
   * before it (`open-world/line-ease.ts`), so that a junction choice made
   * before the lock moves neither the drawn rider nor the camera (ADR 0089
   * C-6). Read only where the riders are drawn on a path at all
   * (@see easingLine). A path on {@link profile}, always: `road.ts`
   * §`drawnPath` builds it on the view the frame is handed.
   *
   * ⚠️ **Optional the UNSAFE way round**: absent is the view's own line, so a
   * `GameView` that stopped supplying it would draw the jump C-6 rules out,
   * and green. `open-world/ride-loop-wiring.test.tsx` reads it back off the
   * frames the renderer is handed.
   */
  readonly drawnPath?: DrawnLine | undefined;
  /**
   * Leaves the trees, shrubs and rocks standing on a settlement's ground, as
   * every frame did before #1534 — the browser gate's control, and nothing
   * else. Absent, or `false`, clears them (`settlements.ts`
   * §`clearOfSettlements`). Optional the safe way round, for
   * {@link centreline}'s reason.
   */
  readonly settlementsWooded?: boolean | undefined;
  /**
   * Builds no procedural lot in a mapped town, as every frame did before
   * #1550 — the browser gate's `-lots` control, and nothing else. Absent, or
   * `false`, fills mapped built-up land that has no footprints with lots
   * (`settlements.ts` §`lotsAt`). Optional the safe way round, for
   * {@link centreline}'s reason.
   */
  readonly lotsOff?: boolean | undefined;
  /**
   * How many people the rung draws as bodies — #1541 (`quality.ts`
   * §`QualitySettings.people`): `people.ts` §`PEOPLE_NEAR_MAX` at most.
   * Absent, or 0, places nobody.
   *
   * ⚠️ **Optional the UNSAFE way round**, which `check-wiring.mjs` §Limits
   * names: a ride that forgot it draws no people. `realistic-choice.test.tsx` §"#1541"
   * reads it back off the frame the renderer was handed, as it reads
   * `crankAngle`; the owner's page passes it in `browser/realistic/frame.ts`.
   */
  readonly people?: number | undefined;
  /**
   * Places people with #1541's rule OFF — on a line's every point and between,
   * carriageway or not (`people.ts` §`PeopleOptions.rule`): the browser gate's
   * control, and nothing else. Absent, or `false`, keeps everybody off the
   * carriageway. Optional the safe way round, for {@link centreline}'s reason.
   */
  readonly peopleOnTheRoad?: boolean | undefined;
  /**
   * Whether this ride may put other cyclists on the road — #2722
   * (`scenery-cyclists.ts`): `GameView` says so on a free ride or a workout,
   * and on nothing else, where another rider on the road means something — a
   * lap race, a room or a group ride, a Delivery round, the pacer or a ghost.
   * They are placed only at a rung that draws {@link people}, so they switch
   * off with the people when the tablet steps down, and never where any of
   * {@link botDistance}, {@link ghost}, {@link remoteRiders}, {@link raceBots}
   * or {@link steeredLateral} is given, whatever this says.
   *
   * ⚠️ **Optional the UNSAFE way round**, which `check-wiring.mjs` §Limits
   * names: a ride that forgot it draws nobody on the road.
   * `realistic-choice.test.tsx` §"#2722" reads it back off what `GameView`
   * asked `sceneFrame` for.
   */
  readonly sceneryCyclists?: boolean | undefined;
  /**
   * #1542's changes switched off, each restoring the countryside before it —
   * the realistic page's `-land-planting`, `-land-boundaries` and
   * `-ground-clutter` levers, and nothing else (`land-class.ts`
   * §`CountrysideLever`). Absent, or empty, is every change on. Optional the
   * safe way round, for {@link centreline}'s reason.
   */
  readonly countrysideOff?: readonly CountrysideLever[] | undefined;
  /**
   * #2685's golf courses and cemeteries drawn as their parks' planting alone:
   * no stripes, greens, bunkers or paths on the ground and nothing standing on
   * it (`park-dressing.ts`) — the realistic page's `-park-dressing` lever, and
   * nothing else. Optional the safe way round, for {@link centreline}'s reason.
   */
  readonly parkDressingOff?: boolean | undefined;
  /**
   * Whether this ride may stand parked cars on its mapped driveways, aprons
   * and side streets — #3278 (`parked-cars.ts`): `GameView` says so on every
   * ride but a Delivery round, whose parked cars are obstacles it places by
   * its own rules and must not be mistaken for scenery. The realistic page
   * says so unless its `-parked-cars` lever is off. Scenery only: no
   * simulation or trainer reads a car.
   *
   * ⚠️ **Optional the UNSAFE way round**, which `check-wiring.mjs` §Limits
   * names: a ride that forgot it has empty streets. `realistic-choice.test.tsx`
   * §"#3278" reads it back off what `GameView` asked `sceneFrame` for.
   */
  readonly parkedCars?: boolean | undefined;
  /**
   * #2973's nearby streets left undrawn: only the route, its junctions'
   * stubs and its overpasses' roads (`nearby-streets.ts`) — the realistic
   * page's `-nearby-streets` lever, and nothing else. Optional the safe way
   * round, for {@link centreline}'s reason.
   */
  readonly nearbyStreetsOff?: boolean | undefined;
  /**
   * #3107: where an open-world ride's streets are read a slice a frame —
   * its nearby streets and its junctions, each handed on as last read until
   * a new reading is whole (`nearby-streets.ts` §`NearbyStreetScan`,
   * `cross-streets.ts` §`JunctionScan`). One for the ride
   * (`open-world/road.ts` §`OpenWorldRoad.streetScans`), since what is read
   * is kept across the views and corridors the ride goes through. Absent,
   * every other ride's, the streets are read whole, once, as they were:
   * a route ride's road and corridor are fixed when it starts.
   *
   * #3119: and where the scenery along its ways out ({@link waysOut}) is
   * placed a few ways a frame (`scatter.ts` §`WaysOutPlacing`). Absent,
   * every way handed is placed on the frame it is handed.
   */
  readonly streetScans?: StreetScans | undefined;
  /**
   * #2972's mapped footways, cycleways, park paths, steps and zebras left
   * undrawn (`footway-surfaces.ts`) — the realistic page's `-footways` lever,
   * the tablet's cost pair, and nothing else. Optional the safe way round, for
   * {@link centreline}'s reason.
   */
  readonly footwaysOff?: boolean | undefined;
  /**
   * Where a Delivery round has steered the rider across the road, in metres
   * right of the centre line — #1820, `delivery/steer.ts`
   * §`steeredLateralFor`. It takes the racing line's place for the RIDER
   * only, in {@link lateralOf}; nobody else is steered. A drawing, never
   * physics: `simulation.ts` never reads it.
   *
   * The rider is drawn there exactly, the offset the obstacles meet, and a
   * bot or ghost level with them makes the room instead (#1853,
   * {@link lateralOf}) — or just behind them, until it is behind the camera
   * (#1863).
   *
   * ⚠️ **Optional the UNSAFE way round**, which `check-wiring.mjs` §Limits
   * names: a Delivery ride that forgot it draws the rider on the line while
   * the obstacles meet them in a lane. `delivery-wiring.test.tsx` reads it
   * back off the input every frame of a round was built from (#1853). Absent
   * on every other ride, a room ride included (DL9).
   */
  readonly steeredLateral?: number | undefined;
  /**
   * How fast the steered rider is DRAWN moving across the road, in metres a
   * second, positive to the right — #2456: `lane-change-lean.ts`
   * §`dampedSway` of `lanes.ts` §`sidewaysSpeedOf`, held by `GameView`'s frame
   * loop. It turns the rider's bicycle into a lane change and leans them the
   * way they are going ({@link lateralOf}, `lane-change-lean.ts`), and does
   * not move where they are drawn: that is still {@link steeredLateral}
   * exactly. Read only where {@link steeredLateral} is given.
   *
   * ⚠️ **Optional the UNSAFE way round**, as {@link steeredLateral} is: a ride
   * that forgot it draws a lane change as the slide #2456 was filed about.
   * `lap-race-wiring.test.tsx` and `delivery-wiring.test.tsx` read it back off
   * the frames a lane change was drawn from.
   */
  readonly steeredSway?: number | undefined;
  /**
   * How fast {@link steeredSway} is changing, in metres a second a second,
   * positive to the right — #2494: what `GameView`'s `dampedSway` moved it by
   * over the frame, divided by the frame's time. The drawn bicycle's heading
   * into a lane change turns at a rate in step with it, and the bars turn by
   * the steer that rate asks for (`bicycle.ts` §`steerAngle`). Read only
   * where {@link steeredSway} is given; absent, a lane change turns no bars.
   *
   * ⚠️ **Optional the UNSAFE way round**, as {@link steeredSway} is:
   * `delivery-wiring.test.tsx` and `lap-race-wiring.test.tsx` read the bars'
   * steer back off the markers a lane change was drawn with.
   */
  readonly steeredSwayRate?: number | undefined;
  /**
   * Where the chase camera's EYE stands across the road, in metres right of
   * the centre line, where it is not behind the rider — #2396,
   * `delivery/camera-clear.ts` §`eyeLateralBesideParkedCars`: a Delivery
   * round moves it off a parked car it is alongside, so the camera never
   * passes through one. The camera still looks at the road on the rider's
   * line ({@link cameraPose}). Absent, the eye is behind the rider, as on
   * every ride before #2396.
   *
   * ⚠️ **Optional the UNSAFE way round**, which `check-wiring.mjs` §Limits
   * names: a Delivery ride that forgot it drives the camera into a parked
   * car. `delivery-wiring.test.tsx` reads it back off the input every frame
   * of a round was built from.
   */
  readonly cameraLateral?: number | undefined;
  /**
   * A lap race's bots, where to draw them — #1902: each a `bot` marker, an
   * instance in the riders' own meshes (#368), so seven of them cost the
   * frame no draw call. Only those on the corridor this frame built are
   * drawn, for {@link remoteRiders}' reason. Absent on every other ride.
   */
  readonly raceBots?: readonly RaceBotInput[] | undefined;
  /**
   * The rider's own lap-race hit effect, while one runs on them — #1902
   * (`lap-race/in-view.ts` §`hitLook`). @see RiderMarker.hit
   */
  readonly riderHit?: RaceHitLook | undefined;
  /**
   * The rider's crash in a Delivery round, while one is drawn — #2454,
   * `delivery/crash-look.ts`: how far into the crash pose they are (0 on the
   * bike, 1 on the ground, §`crashShare`) and which side they fall to. Their
   * roll is drawn toward the fallen bicycle's (§`crashedRoll`) and their pedal
   * stroke stopped; where they are drawn is unchanged, so the camera does
   * nothing new. A drawing, never physics: `simulation.ts` never reads it.
   *
   * ⚠️ **Optional the UNSAFE way round**: a round that forgot it draws a crash
   * as nothing, which is what #2454 was filed about. `delivery-wiring.test.tsx`
   * reads the fallen rider back off the frames of a round with a crash in it.
   *
   * #2493: `seconds`, how long ago the crash was, while motion is not reduced:
   * the rider's marker then carries the crash (`RiderMarker.crash`) and the
   * realistic rider plays its crash clip. Absent under reduced motion, which
   * keeps #2475's still pose.
   */
  readonly riderCrash?:
    | { readonly share: number; readonly side: CrashSide; readonly seconds?: number | undefined }
    | undefined;
}

/**
 * A lap-race bot, where to draw it — #1902. @see SceneInput.raceBots
 *
 * ⚠️ **Its distance is the DRAWN one** (ADR 0060 D-3.3: `effortDistance +
 * raceOffset`), as an odometer on this ride's road; what it rode is never
 * read here. A race runs on a loop, and a bot a lap or more from the rider is
 * drawn on the lap of the road the frame built (#2516, `onTheCorridorsLap`).
 */
export interface RaceBotInput {
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  /**
   * Its lane's place across the road, metres, positive to the rider's right
   * (`lap-race/in-view.ts` §`laneLateral`). It is drawn there, and moved
   * aside only to make room for the rider when level with them ({@link lateralOf}).
   */
  readonly lateralMetres: number;
  /**
   * How fast that place is moving across the road, metres a second, positive
   * to the right (#2544, `lap-race/pack-layout.ts`): the bicycle turns and
   * leans into it as a steered rider's does (#2456). Absent or nought, it
   * rides straight.
   */
  readonly swayMetresPerSecond?: number | undefined;
  /**
   * Whether the race's pack layout placed it (#2544), which keeps it clear of
   * the rider already: then it is drawn at {@link lateralMetres} as it is,
   * never moved aside, which would put two bots beside the rider on one spot.
   */
  readonly laidOut?: boolean | undefined;
  /** Its hit effect, while one runs on it. @see RiderMarker.hit */
  readonly hit?: RaceHitLook | undefined;
  /** Which body it is drawn as, seeded for the race (#2839). @see RiderMarker.body */
  readonly body?: RiderBody | undefined;
  /** Which skin tone it is drawn with, seeded from its id (#3214). @see RiderMarker.skin */
  readonly skin?: number | undefined;
}

/** Another real rider, where to draw them — #783. @see SceneInput.remoteRiders */
export interface RemoteRiderInput {
  /** The room's id for them, which decides their side of the road when level with another. */
  readonly riderId: number;
  /**
   * Along the route, the room's odometer, in metres. On a loop, a rider a lap
   * or more from this one is drawn on the lap of the road the frame built
   * (#2529, `onTheCorridorsLap`).
   */
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  /** What to write over them on the road, if anything. @see RiderMarker.label */
  readonly label?: string | undefined;
  /** The one rider *Follow* chose. @see RiderMarker.followed */
  readonly followed?: boolean | undefined;
  /** Which body they are drawn as, where the ride knows one (#2839). @see RiderMarker.body */
  readonly body?: RiderBody | undefined;
}

/** One open-world ride's readings of its streets. @see SceneInput.streetScans */
export interface StreetScans {
  readonly nearby: NearbyStreetScan;
  readonly junctions: JunctionScan;
  /** #3119: and the ways out whose scenery a frame may place. */
  readonly ways: WaysOutPlacing;
}

/**
 * `input` with the ways out a frame may place the scenery along — #3119: of
 * an open-world ride's, those its {@link StreetScans.ways} hands on; every
 * other ride's as handed. The same object where that is every way.
 */
function withWaysPlaced(input: SceneInput): SceneInput {
  // Called on a frame with no ways too: that spends the ride's first call (PR #3125's review).
  if (input.streetScans === undefined) return input;
  const ways = input.waysOut ?? [];
  const placed = input.streetScans.ways.placing(
    ways,
    (input.state.ride.distance as number) + (sceneryAnchor(input.profile)?.origin ?? 0),
  );
  return placed === ways ? input : { ...input, waysOut: placed };
}

/**
 * `input` drawn on past its route's end where the view reaches it — #3336,
 * `past-the-finish.ts`: the same object everywhere else.
 */
function drawnOnPastTheEnd(input: SceneInput): SceneInput {
  const odometer = Math.max(input.state.ride.distance, input.riderDistance ?? 0);
  const profile = drawnPastTheFinish(input.profile, odometer);
  if (profile === input.profile) return input;
  // …and no mapped building stands on the road drawn on.
  return input.mappedBuildings === undefined
    ? { ...input, profile }
    : { ...input, profile, mappedBuildings: clearOfTheRoadOn(input.mappedBuildings, profile) };
}

/** Builds one frame. */
export function sceneFrame(given: SceneInput): SceneFrame {
  // #3336: past a route's end, the road and the world go on.
  const handed = drawnOnPastTheEnd(given);
  // #3119: the ways out whose scenery this frame may place, a few new ones a frame.
  const input = withWaysPlaced(handed);
  // #1998: where the rider is DRAWN — eased off for a sharp bend — which is
  // where the corridor, the camera and the scenery are built around.
  const riderDistance: number = drawnRider(input).distance;
  // #3133: the junctions the route turns through in view, drawn as the
  // streets meeting there, with the road's lines stopped at their mouths.
  const surfaces = junctionSurfacesInView(input, riderDistance);
  const corridor =
    surfaces.length === 0
      ? roadCorridor(input.profile, input.origin, riderDistance)
      : roadCorridor(input.profile, input.origin, riderDistance, {
          unpainted: surfaces.map((surface) => surface.mouths),
        });
  // O(1), and recomputed per frame for the reason `worldStyle` is: a cache
  // keyed on a profile is a second source of truth a route change has to
  // remember to clear. One seed for the scenery and the ground under it, so a
  // tree and the hillside it stands on are hashed from the same route.
  const seed = scatterSeed(input.profile);
  const riders = placedRiders(input, corridor);
  // #1565: the cross streets along exactly the stretch of road this frame drew
  // — mapped where the corridor has streets (found once a corridor), and a
  // crossroads at each procedural village — before the scenery, which is kept
  // off them.
  const junctions =
    input.worldCorridor === undefined
      ? undefined
      : input.streetScans === undefined
        ? mappedJunctions(
            input.worldCorridor,
            input.profile,
            input.origin,
            seed,
            input.landClass ?? NO_LAND_CLASS,
          )
        : // #3107: an open-world ride's, a slice a frame.
          input.streetScans.junctions.junctions(
            input.worldCorridor,
            input.profile,
            input.origin,
            seed,
            input.landClass ?? NO_LAND_CLASS,
            { rideOrigin: sceneryAnchor(input.profile)?.origin ?? 0, riderMetres: riderDistance },
          );
  // #3095: the ways out the route does not take that this frame's view
  // reaches, each as far along it as the view reaches through its junction.
  const reachesTo = (corridor.centre[corridor.centre.length - 1] as CorridorPoint).along;
  const reached = waysReached(input, reachesTo);
  // #3119: but every way handed is drawn as road where nothing else draws it,
  // placed or not: a way the junction prompt offers is never a turn into a
  // hedge, and the way roads keep to their own bound a frame.
  const reachedRoads = input === handed ? reached : waysReached(handed, reachesTo);
  const roadSideRoads = sideRoadsAt(
    input.profile,
    input.origin,
    seed,
    (corridor.centre[0] as CorridorPoint).along,
    (corridor.centre[corridor.centre.length - 1] as CorridorPoint).along,
    riderDistance,
    // #2660: and a level crossing wherever a mapped railway crosses at grade,
    // drawn with them and kept clear of the scenery as they are.
    input.worldCorridor === undefined
      ? []
      : joinedJunctions(
          joinedJunctions(
            junctions ?? [],
            levelCrossings(
              input.worldCorridor,
              input.profile,
              input.origin,
              seed,
              input.landClass ?? NO_LAND_CLASS,
            ),
          ),
          // #2695: and a mapped track or bridleway, drawn unpaved.
          mappedTracks(
            input.worldCorridor,
            input.profile,
            input.origin,
            seed,
            input.landClass ?? NO_LAND_CLASS,
          ),
        ),
    input.landClass ?? NO_LAND_CLASS,
  );
  // #3095: and each village's crossroads along every way out, as the way's own
  // view lays it, so a choice moves none of them from one street to another.
  const crossSideRoads = withVillageCrossroadsOnWays(
    roadSideRoads,
    reached,
    input,
    seed,
    riderDistance,
  );
  // #459, #2661: the streams' bridges and the mapped overpasses and
  // underpasses in view, before the scenery too — since #2699 an overpass's
  // road runs on off both ends of its deck, and is a side road: drawn in the
  // road's material by the same mesh and kept clear of the scenery.
  const ways = waterways(input.profile, seed, input.landClass ?? NO_LAND_CLASS);
  const waterBridges = bridgeParts(input.profile, input.origin, corridor, ways);
  // #3105: and, on an open-world view, the mapped bridges and tunnels the
  // ridden road itself is on (`mapped-spans.ts`): parapets along the whole
  // mapped span, a portal at each tunnel mouth, in the same belt's boxes.
  const spanParts =
    input.worldCorridor === undefined || sceneryAnchor(input.profile) === undefined
      ? NO_BRIDGE_PARTS
      : riddenSpanParts(
          input.profile,
          input.origin,
          corridor,
          riddenSpans(input.worldCorridor, input.profile, input.origin),
          ways,
          riderDistance,
          MAXIMUM_BRIDGE_PARTS - waterBridges.length,
        );
  const streamBridges = spanParts.length === 0 ? waterBridges : [...waterBridges, ...spanParts];
  const crossings = crossingsInView(input, corridor, seed, riderDistance, streamBridges.length);
  // #2973: and the mapped streets that never touch the route, out to the fog —
  // side roads too, so the same mesh draws them and the scenery keeps off them.
  const nearbyFound: NearbyStreets =
    input.worldCorridor === undefined || input.nearbyStreetsOff === true
      ? NO_NEARBY_STREETS
      : input.streetScans === undefined
        ? nearbyStreets(input.worldCorridor, input.profile, input.origin)
        : // #3107: an open-world ride's, a slice a frame.
          input.streetScans.nearby.streets(input.worldCorridor, input.profile, input.origin);
  const nearby =
    input.worldCorridor === undefined || input.nearbyStreetsOff === true
      ? NO_SIDE_ROADS
      : nearbyStreetsAt(
          nearbyFound,
          input.profile,
          input.origin,
          seed,
          riderDistance,
          input.landClass ?? NO_LAND_CLASS,
        );
  const streetRoads =
    crossings.roads.length === 0 && nearby.length === 0 && surfaces.length === 0
      ? crossSideRoads
      : [
          ...crossSideRoads,
          ...crossings.roads,
          ...nearby,
          ...surfaces.map((surface) => surface.road),
        ];
  // #3106: and every way out of an open-world junction, wherever none of the
  // above draws it — a fork, a street mapped on a bridge — so no way the
  // junction prompt offers is a turn into a hedge. Side roads too. Off with
  // the nearby streets, whose control would otherwise be drawn back in here.
  const onWays =
    input.nearbyStreetsOff === true
      ? NO_SIDE_ROADS
      : wayRoads(
          // #3123: and the road the rider turned off, each way from the junction.
          // #3119: on every way handed, placed or not (`reachedRoads`).
          withTurnedOff(reachedRoads, input, riderDistance),
          {
            profile: input.profile,
            origin: input.origin,
            seed,
            land: input.landClass ?? NO_LAND_CLASS,
            // The next junction's ways are read first, and those behind the rider last.
            riderMetres: riderDistance,
            drawnFromMetres: (corridor.centre[0] as CorridorPoint).along,
          },
          streetRoads,
        );
  const sideRoads = onWays.length === 0 ? streetRoads : [...streetRoads, ...onWays];
  const { scatter: items, billboards } = scenery(
    corridor,
    input,
    riderDistance,
    seed,
    sideRoads,
    reached,
  );
  // #1535: the village streets along exactly the stretch of road this frame
  // drew, for `scenery`'s reason — and outside the structures' budget,
  // because a street is one mesh rather than items a rung could thin.
  const roadStreets = streetsAt(
    input.profile,
    input.origin,
    seed,
    (corridor.centre[0] as CorridorPoint).along,
    (corridor.centre[corridor.centre.length - 1] as CorridorPoint).along,
    // #1551: built once a corridor, so this is a lookup on every later frame.
    input.worldCorridor === undefined
      ? NO_PAVEMENT_DATA
      : pavementSides(input.worldCorridor, input.profile, input.origin),
    input.landClass ?? NO_LAND_CLASS,
    // #1637: and a city centre's street wherever the ride's urban class says
    // so, broken over the mapped junctions' mouths — both fixed at the press,
    // so this too is a lookup on every later frame. #3131: an open-world
    // view's own class, kept for the view and the plans it was read from.
    urbanOfTown(input.mappedTown, input.profile),
    junctions,
    // #3095: in pieces either side of every junction of the road in view.
    junctionsOn(input.profile, input),
  );
  // #3095: and each village's street along every way out, so its pavements,
  // and the people on them, stay where they were through a choice.
  const streets = withVillageStreetsOnWays(roadStreets, reached, input, seed);
  const camera = cameraPose(
    corridor,
    riderDistance,
    (riders[0] as PlacedRider).lateral,
    // #2396: the eye moved off a parked car, where a Delivery round says so.
    input.cameraLateral,
    // #2422: on the path the rider is drawn along, where they are drawn on one.
    drawnPathOf(input),
  );
  // #458. Built from the corridor just built, so the ground's innermost
  // column is the road's outermost one — `landform.ts` says why that is the
  // whole of the no-crack guarantee. Every band, whatever the rung: the
  // renderer draws a prefix of them (`three-renderer.ts` §`TerrainBelt`), so
  // the rung moves no vertex and the scenery stands on the same ground.
  const ground = terrainCorridor(
    input.profile,
    input.origin,
    corridor,
    seed,
    input.landClass ?? NO_LAND_CLASS,
  );
  const footways =
    input.worldCorridor === undefined || input.footwaysOff === true
      ? NO_FOOTWAYS
      : footwaysInView(
          input.worldCorridor,
          input.profile,
          input.origin,
          seed,
          input.landClass ?? NO_LAND_CLASS,
          camera.x,
          camera.z,
          streets,
        );
  const roadside = roadsideInView({
    profile: input.profile,
    origin: input.origin,
    seed,
    land: input.landClass ?? NO_LAND_CLASS,
    corridor,
    riderDistance,
    bridges: bridgeSpans(input.profile, corridor, ways),
    sideRoads,
    footways,
    streets,
    scenery: items,
  });
  return {
    // #1549: the ride's mapped buildings, and where the rider is among them.
    ...(input.mappedBuildings === undefined
      ? {}
      : {
          mappedBuildings: mappedInView(
            input.mappedBuildings,
            corridor,
            riderDistance,
            input.mappedBranches,
          ),
        }),
    corridor,
    // The camera follows the rider sideways — their drawn place, not the line's
    // — so the rider stays where `camera.ts` §`riderFrameBox` says they are.
    camera,
    markers: riders.map((rider) => rider.marker),
    // Recomputed per frame rather than cached against the profile: it is two
    // bounded passes over at most `WORLD_SAMPLE_LIMIT` samples, and a cache
    // keyed on a profile is a second source of truth that a route change has
    // to remember to clear. `world.ts` says what the bound buys.
    // #3336: a route drawn past its end keeps the route's own.
    world: worldStyle(routeOf(input.profile)),
    // #2685: the golf courses' and cemeteries' ground and what stands on it,
    // round the camera, stood on this frame's ground as the scenery is.
    ...(input.worldCorridor === undefined || input.parkDressingOff === true
      ? {}
      : { parkDressing: parkDressing(input, input.worldCorridor, seed, camera, ground) }),
    // #3278: the cars parked on the mapped driveways, aprons and side streets
    // about the road ahead of the rider — scenery, and none in a Delivery round.
    ...(input.worldCorridor === undefined || input.parkedCars !== true
      ? {}
      : {
          parkedCars: parkedCars(input, input.worldCorridor, nearbyFound, seed, riderDistance),
        }),
    // #2099: and only where this frame's ground is drawn. The scenery is
    // placed from the route and the ground's reach is the frame's, which a
    // sharp bend tapers in before and after it. @see standingOnGround
    // #2761: and no building whose ground falls away under it further than its walls reach.
    scatter: standingOnGround(items, ground, groundedFootprintOf),
    // #966: the billboards in view, out of the structures' budget.
    billboards,
    sideRoads,
    streets,
    // #3052: an open-world ride's street names, on their streets' surfaces.
    // #3107: carried on EVERY frame of a ride that may name a street, the
    // ones with no name in sight too (an empty view), so the renderer knows
    // from the ride's first frame to make the names' belt ready
    // (`three-renderer.ts` §`StreetNameBelt`) and not on the frame the first
    // name comes into view.
    ...(input.streetNames === undefined
      ? {}
      : {
          streetNames: streetNamesInView(
            input.streetNames,
            (riders[0] as PlacedRider).marker,
            riderDistance,
            streetSurfaceAt(input, seed),
            // #3261's tablet checks: a route ride's labels drawn on the
            // rider's own pass only, on the road's own height at their route
            // distance, as a nearby street stands.
            routeLabelRoad(input, seed),
          ),
        }),
    // #2972: the corridor's mapped footways drawn as surfaces round the camera,
    // off those streets' pavements (#1620), and a zebra where one crosses the road.
    footways,
    // #3284: the guard rails and marker posts on the open road, broken at
    // every side road, footway and field gate, and none along a kerb.
    guardRails: roadside.rails,
    markerPosts: roadside.posts,
    // #1541: the people on those streets' pavements and the corridor's
    // footways, near the rider, at the ride's own clock.
    // #1619: and off the side roads, drawn or mapped, as off the road.
    // #2728: each on the ground drawn under them, and nobody on the drawn water.
    people: people(
      input,
      streets,
      camera,
      seed,
      nearby.length === 0
        ? sideRoads
        : [...crossSideRoads, ...crossings.roads, ...withinPeopleReach(nearby, camera)],
      ground,
    ),
    // #2722: and the other cyclists on the road, kept clear of the rider.
    // #3095: and along every way out, as the way's own view places them.
    ...cyclistsOf(withCyclistsOnWays(placedCyclists(input, corridor, riders), reached, input)),
    terrain: {
      mesh: ground,
      horizon: horizonRelief(input.profile, input.origin, seed),
      // #2699: and each overpass's embankment, in the ground's own material.
      embankments: crossings.embankments,
    },
    // #459. The waterways are found once per route (`waterways.ts` §`computed`)
    // and the surfaces and bridges built for this stretch of it, from the same
    // corridor the ground and the road are built from.
    // #2661: and the mapped streets crossing over or under the route, with them.
    // #2974: and the channels beside the road laid on this frame's ground,
    // and the mapped pools round the camera.
    water: water(input, corridor, ways, streamBridges, crossings, nearby, ground, camera, seed),
    // #679: what stands at the lines, in the rider's units, near the rider.
    // #3336: at the ROUTE's lines, on a route drawn past its end too.
    lines: linesNear(
      routeOf(input.profile),
      corridor,
      riderDistance,
      lineStands(routeOf(input.profile), input.units ?? 'metric'),
    ),
  };
}

/** No boxes: a frame on no mapped bridge. */
const NO_BRIDGE_PARTS: readonly BridgePart[] = [];

/** No side roads: a frame with no nearby street. */
const NO_SIDE_ROADS: readonly SideRoad[] = [];

/**
 * How far past {@link PEOPLE_FAR_METRES} of the camera a nearby street still
 * reaches the people, in metres: **64** — `people.ts` §`besideSideRoads` files
 * a segment in every 32 m cell within its half-width and a margin of it, and
 * reads only the cell a person stands in, so a segment farther than this
 * shares a cell with nobody drawn.
 */
const PEOPLE_STREET_SLACK_METRES = 64;

/**
 * The nearby streets within reach of anyone drawn — #2973: `people.ts`
 * §`besideSideRoads` files every segment it is handed every frame, and a
 * town's streets out to the fog are thousands; the people are all within
 * {@link PEOPLE_FAR_METRES} of the camera, so the rest change nobody's place.
 */
function withinPeopleReach(
  roads: readonly SideRoad[],
  camera: { readonly x: number; readonly z: number },
): readonly SideRoad[] {
  const reach = PEOPLE_FAR_METRES + PEOPLE_STREET_SLACK_METRES;
  return roads.filter((road) => {
    const s = road.segments;
    for (let at = 0; at + 1 < s.length; at += 2) {
      if (Math.hypot((s[at] as number) - camera.x, (s[at + 1] as number) - camera.z) <= reach) {
        return true;
      }
    }
    return false;
  });
}

/**
 * The people a frame draws — #1541 (`people.ts`): on the frame's village
 * streets and the corridor's footways, around the rider's drawn place, at the
 * ride's own clock — the one #625's breath runs on, which a held ride holds.
 * Nobody where the rung draws nobody.
 */
function people(
  input: SceneInput,
  streets: readonly VillageStreet[],
  camera: CameraPose,
  seed: number,
  sideRoads: readonly SideRoad[],
  ground: TerrainMesh,
): PeopleInView {
  const near = input.people ?? 0;
  if (near <= 0) return NO_PEOPLE;
  const { profile, origin } = input;
  const land = input.landClass ?? NO_LAND_CLASS;
  const rule = input.peopleOnTheRoad !== true;
  const road = (x: number, z: number, reach: number): number =>
    distanceToDrawnRoad(profile, origin, x, z, reach);
  const lines = streets.flatMap((street) => streetWalks(street, road, rule));
  if (input.worldCorridor !== undefined) {
    // #1620: and the mapped footways off those streets' pavements, which walk them already.
    lines.push(
      ...clearOfPavements(footwayWalks(input.worldCorridor, profile, origin, land, rule), streets),
    );
  }
  const placed = peopleAt(lines, {
    x: camera.x,
    z: camera.z,
    seconds: ghostClock(input.state),
    near,
    rule,
    // #1619: nobody on a side road this frame draws, either.
    road: besideSideRoads(road, sideRoads),
    ground: groundOf(profile, origin, seed, land),
  });
  // #2728: a person's `y` is `terrainHeightAt`'s at the stretch of road they are
  // nearest, read at their line's points and carried straight between them. The
  // drawn ground is neither: another leg's seam (#2101), a fold, a dip between two
  // points of a long straight footway. On the owner's coast people walked in the sky,
  // so each stands on the highest triangle drawn under them, as the scenery does
  // since #2101, and nobody stands where no ground is drawn or on the drawn water.
  // A village's pavement and front paths are drawn at their own tops, which their
  // walkers' `y` already is, so only a mapped footway's walkers are stood.
  if (placed.near.length + placed.far.length === 0) return placed;
  const ways = waterways(profile, seed, land);
  const dry = (person: Person): boolean => {
    if (ways.lakes.length + ways.crossings.length === 0) return true;
    const beside = nearestOnDrawnRoad(
      profile,
      origin,
      person.x,
      person.z,
      // Nobody is drawn beyond this of the camera, so nobody is farther from the road.
      PEOPLE_FAR_METRES,
    );
    return beside === undefined || !onOpenWater(ways, profile, beside.along, beside.lateral);
  };
  return { near: stood(placed.near, dry, ground), far: stood(placed.far, dry, ground) };
}

/** #2728: `people` kept off the drawn water, and a mapped footway's walkers stood on the drawn ground. @see people */
function stood(
  people: readonly Person[],
  dry: (person: Person) => boolean,
  ground: TerrainMesh,
): readonly Person[] {
  const kept = people.filter(dry);
  const onStreets = kept.filter((person) => STREET_WALKS.has(person.on));
  if (onStreets.length === kept.length) return kept;
  const footways = standingOnGround(
    kept.filter((person) => !STREET_WALKS.has(person.on)),
    ground,
  );
  // Back in the order `peopleAt` gave, nearest first.
  return [...onStreets, ...footways].sort((a, b) => a.distance - b.distance);
}

/** What a village's street draws its walkers on, at its own top. @see stood */
const STREET_WALKS: ReadonlySet<WalkKind> = new Set<WalkKind>(['pavement', 'door-path']);

/**
 * How far behind a city centre's kerb its pavement's back is, and a hand, in
 * metres: a parked car stands behind it. @see parkedCars
 */
const CITY_PAVEMENT_CLEAR_METRES = CITY_PAVEMENT_WIDTH_METRES + 0.2;

/** How much of a parked car's clearance from the road is verge, in metres: **1**. @see parkedCars */
const PARKED_VERGE_METRES = 1;

/**
 * How far a place is from the middle of ANY stretch of the ridden road, as a
 * parked car is kept off it — #3278: the drawn road's own distance, less a
 * city centre's pavement where one is laid on that side (`streets.ts`
 * §`cityPavementOn`, #1637), which is 3.5 m against the metre of verge a car
 * otherwise keeps. So a car stands behind a city's pavement and not on it.
 * With no urban class there is no city centre, and it is
 * `road-grid.ts` §`distanceToDrawnRoad` exactly; `sides` is read only with one.
 */
export function roadBehindPavements(
  profile: RouteProfile,
  origin: CorridorOrigin,
  urban: UrbanClassMap | undefined,
  sides: () => PavementSides,
): (x: number, z: number, reach: number) => number {
  if (urban === undefined) {
    return (x, z, reach) => distanceToDrawnRoad(profile, origin, x, z, reach);
  }
  const mapped = sides();
  return (x, z, reach) => {
    const beside = nearestOnDrawnRoad(profile, origin, x, z, reach + CITY_PAVEMENT_CLEAR_METRES);
    if (beside === undefined) return Number.POSITIVE_INFINITY;
    return cityPavementOn(profile, urban, mapped, beside.along, beside.lateral < 0 ? -1 : 1)
      ? beside.distance - (CITY_PAVEMENT_CLEAR_METRES - PARKED_VERGE_METRES)
      : beside.distance;
  };
}

/** The last answer {@link parkedCars} gave, and everything it was asked with. */
let lastParked:
  | {
      readonly profile: RouteProfile;
      readonly corridor: WorldCorridor;
      readonly buildings: MappedBuildings | undefined;
      readonly streets: NearbyStreets;
      readonly seed: number;
      readonly cellX: number;
      readonly cellZ: number;
      readonly view: ParkedCarsInView;
    }
  | undefined;

/**
 * The parked cars in reach — #3278 (`parked-cars.ts`), chosen about the road
 * {@link PARKED_CAR_AHEAD_METRES} ahead of the rider: the road and not the
 * camera, so a lane change, the eye's sway and a bend's look-ahead move
 * nothing. Asked again only when that place enters another
 * {@link PARKED_CAR_CELL_METRES} cell, or the road, the corridor, the
 * buildings or the streets read are not the ones it was last asked with;
 * every frame between is the last answer.
 *
 * WHICH of them have their wheels is said every frame, about the rider's own
 * place on the road (`parked-cars.ts` §`parkedCarsSeenFrom`): the place asked
 * about is 40 m up the road, and on a street with more cars than the near
 * cap the wheels went to the cars up there and not to the one beside the
 * rider. That is a distance a car and no planning; it hands back the list it
 * was handed until a car's level changes, so every frame between hands the
 * view the same object and its belt rebuilds nothing.
 * @see SceneFrame.parkedCars
 */
function parkedCars(
  input: SceneInput,
  corridor: WorldCorridor,
  streets: NearbyStreets,
  seed: number,
  riderDistance: number,
): ParkedCarsInView {
  const buildings = input.mappedBuildings;
  if ((buildings?.plans.length ?? 0) === 0 && streets.pieces.length === 0) return NO_PARKED_CARS;
  const about = drawnRoadPosition(
    input.profile,
    input.origin,
    riderDistance + PARKED_CAR_AHEAD_METRES,
  );
  const cellX = Math.floor(about.x / PARKED_CAR_CELL_METRES);
  const cellZ = Math.floor(about.z / PARKED_CAR_CELL_METRES);
  // The rider's place on the road, and not the camera's: a lane change moves no wheel.
  const rider = drawnRoadPosition(input.profile, input.origin, riderDistance);
  const last = lastParked;
  if (
    last !== undefined &&
    last.profile === input.profile &&
    last.corridor === corridor &&
    last.buildings === buildings &&
    last.streets === streets &&
    last.seed === seed &&
    last.cellX === cellX &&
    last.cellZ === cellZ
  ) {
    const seen = parkedCarsSeenFrom(last.view, rider.x, rider.z);
    if (seen !== last.view) lastParked = { ...last, view: seen };
    return seen;
  }
  const { profile, origin } = input;
  const land = input.landClass ?? NO_LAND_CLASS;
  const ground = routeGround(profile, origin, seed, land);
  const planned = parkedCarsAt(
    {
      seed,
      plots: buildings?.plans ?? [],
      radii: buildings?.radii ?? [],
      pieces: streets.pieces,
      streets: corridor.streets,
      paths: corridor.paths,
      // An open-world ride may ride any street next: no car at a kerb there.
      kerbs: sceneryAnchor(profile) === undefined,
      road: roadBehindPavements(
        profile,
        origin,
        // #1637: fixed at the press, so a lookup — as `streetsAt` is handed it.
        urbanOfTown(input.mappedTown, profile),
        (): PavementSides => pavementSides(corridor, profile, origin),
      ),
      ground: (x, z) => ground.about(x, z),
    },
    about.x,
    about.z,
  );
  const view = parkedCarsSeenFrom(planned, rider.x, rider.z);
  lastParked = { profile, corridor, buildings, streets, seed, cellX, cellZ, view };
  return view;
}

/** The golf courses and cemeteries in reach — #2685. @see SceneFrame.parkDressing */
function parkDressing(
  input: SceneInput,
  corridor: WorldCorridor,
  seed: number,
  camera: CameraPose,
  ground: TerrainMesh,
): ParkDressingInView {
  const view = parkDressingInView(
    corridor,
    input.profile,
    input.origin,
    seed,
    input.landClass ?? NO_LAND_CLASS,
    camera.x,
    camera.z,
  );
  if (view.pieces.length === 0) return view;
  // #2688: stood on the ground, and a pitch's lines laid along it in pieces.
  const stood = laidAlongTheGround(view.pieces, ground);
  // `standingOnGround` hands back a new array every call; the belt re-composes
  // and re-uploads its matrices whenever the array it is given changes. So keep
  // returning the last frame's pieces while the same view stands at the same
  // heights — the common case — and only a real change reaches the belt.
  const held = lastStood;
  if (held !== undefined && held.source === view.pieces && sameStanding(held.pieces, stood)) {
    return { pieces: held.pieces, ground: view.ground };
  }
  lastStood = { source: view.pieces, pieces: stood };
  return { pieces: stood, ground: view.ground };
}

/** The last frame's park pieces, stood on the ground. @see parkDressing */
let lastStood:
  | { readonly source: ParkDressingInView['pieces']; readonly pieces: ParkDressingInView['pieces'] }
  | undefined;

function sameStanding(
  before: ParkDressingInView['pieces'],
  after: ParkDressingInView['pieces'],
): boolean {
  if (before.length !== after.length) return false;
  for (let index = 0; index < after.length; index += 1) {
    const a = before[index]!;
    const b = after[index]!;
    if (a.x !== b.x || a.y !== b.y || a.z !== b.z || a.tilt !== b.tilt) return false;
  }
  return true;
}

/** The frame's cyclists, where there are any: a frame with none carries no key for them. */
function cyclistsOf(cyclists: readonly SceneryCyclist[]): { cyclists?: readonly SceneryCyclist[] } {
  return cyclists.length === 0 ? {} : { cyclists };
}

/**
 * Whether a frame may carry other cyclists — #2722: the ride says it is a
 * free ride or a workout, its rung draws people, and nothing on the road
 * means something. @see SceneInput.sceneryCyclists
 */
function sceneryCyclistsAllowed(input: SceneInput): boolean {
  return (
    input.sceneryCyclists === true &&
    (input.people ?? 0) > 0 &&
    input.botDistance === undefined &&
    input.ghost === undefined &&
    input.remoteRiders === undefined &&
    input.raceBots === undefined &&
    input.steeredLateral === undefined
  );
}

/**
 * The other cyclists a frame draws — #2722 (`scenery-cyclists.ts`): each
 * encounter's cyclist in reach of the rider's DRAWN place and on the corridor
 * this frame built, nearest first, put across the road clear of the rider and
 * of each one placed before it, and on the road as a rider's marker is
 * (`markerAt`, on the same line). An oncoming one faces against the road and
 * leans its own way. Only after the riders are placed, and from their places
 * (`riders`, {@link placedRiders}' on the same corridor), so a cyclist never
 * moves the rider.
 *
 * Its own export for {@link placedRiders}' reason: a test sweeping thousands
 * of rider positions places them without building the scenery.
 * `scenery-cyclists.test.ts` checks that it and `sceneFrame` agree.
 */
export function placedCyclists(
  input: SceneInput,
  corridor: RoadCorridor,
  riders: readonly PlacedRider[],
): readonly SceneryCyclist[] {
  if (!sceneryCyclistsAllowed(input)) return [];
  const riderDistance = drawnRider(input).distance;
  const seed = scatterSeed(input.profile);
  const first = corridor.centre[0];
  const last = corridor.centre[corridor.centre.length - 1];
  const rider = riders[0];
  if (first === undefined || last === undefined || rider === undefined) return [];
  const town = townAt(input.profile, seed, input.mappedTown?.urban ?? NO_URBAN_CLASS);
  const line =
    input.centreline === true ? undefined : (easingLine(input) ?? racingLine(input.profile));
  const placed: { readonly along: number; readonly lateral: number }[] = [
    { along: riderDistance, lateral: rider.lateral },
  ];
  const cyclists: SceneryCyclist[] = [];
  for (const each of cyclistsInReach(input.profile, seed, town, riderDistance)) {
    if (each.along < first.along || each.along > last.along) continue;
    const { encounter } = each;
    const lateral = clearLateral(
      encounter.lane,
      placed.map((other) => ({ gap: each.along - other.along, lateral: other.lateral })),
      BICYCLE_LENGTH_METRES,
    );
    placed.push({ along: each.along, lateral });
    cyclists.push(cyclistOn(corridor, line, each, lateral, input.state.ride.speed));
  }
  return cyclists;
}

/** One encounter's cyclist, drawn on `corridor` at `lateral` across it. @see placedCyclists */
function cyclistOn(
  corridor: RoadCorridor,
  line: RacingLine | undefined,
  each: CyclistInReach,
  lateral: number,
  rideSpeed: number,
): SceneryCyclist {
  const { encounter } = each;
  const oncoming = encounter.kind === 'oncoming';
  const speed = encounter.pace * rideSpeed;
  const bend = line === undefined ? 0 : leanAt(line, each.along, speed);
  const marker = markerAt(
    corridor,
    each.along,
    'bot',
    { metres: lateral, rate: 0 },
    { bicycle: 0, body: 0 },
    line,
    { pedalling: 0, rideSeconds: 0 },
  );
  return {
    kind: encounter.kind,
    x: marker.x,
    y: marker.y,
    z: marker.z,
    headingX: oncoming ? -marker.headingX : marker.headingX,
    headingZ: oncoming ? -marker.headingZ : marker.headingZ,
    // Into the bend on the road, which is the other way by an oncoming one's own right.
    lean: oncoming ? -bend : bend,
    crankAngle: simulatedCrankAngle(each.ridden),
    lateral,
    along: each.along,
    look: cyclistLook(encounter.key),
  };
}

/**
 * The mapped overpasses and underpasses in view — #2661 (`overpasses.ts`):
 * whole crossings, in the room the streams' `streamParts` bridges leave of
 * the one belt's {@link MAXIMUM_BRIDGE_PARTS}, and since #2699 each
 * overpass's road. None with no map data.
 */
function crossingsInView(
  input: SceneInput,
  corridor: RoadCorridor,
  seed: number,
  riderDistance: number,
  streamParts: number,
): CrossingsInView {
  if (input.worldCorridor === undefined) return NO_CROSSINGS_IN_VIEW;
  return gradeCrossingsAt(
    input.profile,
    input.origin,
    seed,
    (corridor.centre[0] as CorridorPoint).along,
    (corridor.centre[corridor.centre.length - 1] as CorridorPoint).along,
    riderDistance,
    mappedGradeCrossings(input.worldCorridor, input.profile, input.origin),
    input.landClass ?? NO_LAND_CLASS,
    MAXIMUM_BRIDGE_PARTS - streamParts,
  );
}

/**
 * The streams, lakes and bridges in view — the streams' (#459) and, since
 * #2661, the mapped overpasses' and underpasses' boxes, the streams' first.
 * @see SceneFrame.water
 */
function water(
  input: SceneInput,
  corridor: RoadCorridor,
  ways: Waterways,
  streams: readonly BridgePart[],
  crossings: CrossingsInView,
  nearby: readonly SideRoad[],
  ground: TerrainMesh,
  camera: CameraPose,
  seed: number,
): WaterFrame {
  const pools =
    input.worldCorridor === undefined
      ? []
      : poolsInView(
          input.worldCorridor,
          input.profile,
          input.origin,
          seed,
          input.landClass ?? NO_LAND_CLASS,
          camera.x,
          camera.z,
        );
  const bridges = crossings.parts.length === 0 ? streams : [...streams, ...crossings.parts];
  // #3105: and the parapets of the side streets' decks in view, in what room
  // the belt has left. None but on an open-world ride (`nearby-streets.ts`).
  const decks = sideDeckParts(nearby, MAXIMUM_BRIDGE_PARTS - bridges.length);
  return {
    surface: waterSurface(input.profile, input.origin, corridor, ways, ground, pools),
    bridges: decks.length === 0 ? bridges : [...bridges, ...decks],
    seconds: input.state.elapsed,
  };
}

/**
 * What every frame's scenery asks of the side roads in view, remembered —
 * #2439. Not a cache keyed on a route: its answers are keyed on the side
 * roads themselves, and each frame drops those of every road it no longer
 * sees, so a new route's first frame finds none to reuse.
 */
const SCENERY_CLEARANCE = sideRoadClearance(onSideRoad);

/**
 * How far off a side road's edge a tree, shrub or rock stands, in metres —
 * #2428: its whole drawn reach at its scale, the larger of the two worlds'
 * (`near-field.ts` §`sceneryReach`: one arrangement draws both, ADR 0026
 * D-3), with the realistic foliage's sway ({@link FOLIAGE_SWAY_METRES}), and
 * never less than `cross-streets.ts` §`SIDE_ROAD_SCENERY_MARGIN_METRES`.
 *
 * Measured as a point 1.5 m clear, a fir at the top of its scale reaches
 * 5.1 m, 3.6 m across the side road: more than a driveway's whole 3.5 m.
 * That is the likeliest of what the owner saw drawn across crossings and
 * driveways (2026-11-09); a shrub's reach is 1.54 m at its largest, so it
 * keeps the 1.5 m and a little more.
 */
export function sideRoadNaturalMargin(item: ScatterItem): number {
  // A radius, not the box's half-width: foliage at a diagonal of the box
  // stands up to √2 times that from the trunk (as `near-field.ts` §`intrudes`
  // reasons). A rock does not sway.
  const reach = Math.max(
    sceneryPlanRadius(item.kind, 'realistic'),
    sceneryPlanRadius(item.kind, 'stylised'),
  );
  const sway = item.kind === 'rock' ? 0 : FOLIAGE_SWAY_METRES;
  // #3252's review: by the size it is DRAWN at, as the renderer sizes it.
  return Math.max(SIDE_ROAD_SCENERY_MARGIN_METRES, reach * drawnScale(item).across + sway);
}

/**
 * The scenery for exactly the stretch of road this frame drew.
 *
 * ⚠️ **The span comes from the corridor rather than from `VIEW_AHEAD_METRES` and
 * `VIEW_BEHIND_METRES`.** Reading the two constants here would be a second
 * statement of how far the rider can see, and the day either moves — or the day
 * a caller passes `roadCorridor` an override, which its options already allow —
 * the scenery would stop where the road no longer does. Taking the first and
 * last centreline point's own `along` cannot drift, because it *is* what was
 * built.
 */
function scenery(
  corridor: RoadCorridor,
  input: SceneInput,
  riderDistance: number,
  seed: number,
  sideRoads: readonly SideRoad[],
  /** #3095: the ways out this frame reaches. @see waysReached */
  reached: readonly ReachedWay[],
): { readonly scatter: readonly ScatterItem[]; readonly billboards: readonly Billboard[] } {
  const first = corridor.centre[0] as CorridorPoint;
  const last = corridor.centre[corridor.centre.length - 1] as CorridorPoint;
  // #1546: what the ground is where map data was read; nothing, where it was not.
  const land = input.landClass ?? NO_LAND_CLASS;
  // #1542: what the countryside makes of it, lever by lever.
  const countryside = countrysideWithout(input.countrysideOff ?? []);
  const natural = scatterAt(
    input.profile,
    input.origin,
    seed,
    first.along,
    last.along,
    { maxItems: input.scatterItems ?? SCATTER_MAX_ITEMS, riderMetres: riderDistance },
    land,
    countryside,
    // #3051: and along every way out the route does not take, in the one budget.
    input.waysOut,
  );
  // #966. The billboards come out of the structures' budget FIRST: a rung that
  // takes structures away takes them too, and none is ever extra.
  const structureBudget = Math.max(0, input.structureItems ?? STRUCTURE_MAX_ITEMS);
  // #1565: and none on a side road.
  // #3095: and those along every way out, the nearest of all of them kept.
  const billboards = boardsClearOfSideRoads(
    nearestBillboards(
      withBillboardsOnWays(
        billboardsAt(input.profile, input.origin, seed, first.along, last.along, land),
        reached,
        input,
        seed,
        land,
      ),
      riderDistance,
      structureBudget,
    ),
    sideRoads,
    BILLBOARD_FOOTPRINT,
    SCENERY_CLEARANCE,
  );
  // #460. The villages, farmsteads and field boundaries, FIRST — so that a belt
  // spending its budget in frame order never loses a house to a far tree — and
  // the natural scenery kept clear of every building, and of every billboard.
  // #1534: and off every settlement's ground, so no house stands in a wood.
  const footprints: SettlementFootprint[] = [];
  const placed = structuresAt(
    input.profile,
    input.origin,
    seed,
    first.along,
    last.along,
    { maxItems: structureBudget - billboards.length, riderMetres: riderDistance },
    footprints,
    land,
    // #1550: the corridor's kept footprints and commercial land, built once a
    // corridor, which the procedural lots of a mapped town keep clear of.
    // `null` is the `-lots` control: no lots at all.
    input.lotsOff === true ? null : (input.mappedTown ?? NO_MAPPED_TOWN),
    countryside,
  );
  // #3051: and those along every way out the route does not take, under the
  // one budget: the road's and the ways' together, so what a frame carries
  // does not turn on which of them the route takes.
  const structures = withStructuresOnWays(
    placed,
    input,
    seed,
    placeOnCorridor(corridor, riderDistance),
    last.along,
    structureBudget - billboards.length,
    footprints,
    land,
    countryside,
  );
  // #1565: no wall, hedge, fence, signpost or building on a side road, and no
  // tree, shrub or rock either.
  // #2428: and none across a mapped building's driveway, a roadside hedge
  // row the likeliest. #3132: and no building on a mapped building's plot.
  const built = clearOfDriveways(
    clearOfSideRoads(structures, sideRoads, SCENERY_CLEARANCE, sideRoadNaturalMargin),
    input.mappedBuildings,
  );
  // #1549: and off every mapped building's ground, by #1534's rule — whose
  // control (`settlementsWooded`) leaves both standing.
  const cleared = clearOfSideRoads(
    input.settlementsWooded === true
      ? natural
      : clearOfMappedBuildings(
          clearOfSettlements(natural, footprints, land),
          input.mappedBuildings,
          // #2428: off a driveway by its drawn reach, as off a side road.
          sideRoadNaturalMargin,
        ),
    sideRoads,
    SCENERY_CLEARANCE,
    sideRoadNaturalMargin,
  );
  return {
    scatter: [...built, ...clearOfBillboards(clearOfBuildings(cleared, built), billboards)],
    billboards,
  };
}

/**
 * One way out of a junction that this frame's view reaches — #3095. @see waysReached
 */
interface ReachedWay {
  readonly way: ScatterWay;
  /** How far along the way's own view this frame's view reaches through its junction. */
  readonly toMetres: number;
  /** What a distance on the way's view is short of the same ride distance on the road's. */
  readonly shift: number;
}

const NO_REACHED: readonly ReachedWay[] = [];

/**
 * The ways out of an open-world ride's junctions that this frame's view
 * reaches (#3051, {@link SceneInput.waysOut}), each as far along it as the
 * view reaches through its junction, which is `toMetres` on the road — the
 * reach {@link withStructuresOnWays} reads the houses to. None on every
 * other ride.
 *
 * ⚠️ **What a way carries is what lies past its junction, and nothing short
 * of it.** Short of the junction a way's view is the road itself, which the
 * frame draws already. So a choice swaps which view carries what past the
 * junction, and the set the frame draws there is the same before and after.
 */
function waysReached(input: SceneInput, toMetres: number): readonly ReachedWay[] {
  const ways = input.waysOut;
  if (ways === undefined || ways.length === 0) return NO_REACHED;
  // Both views count ride distance from their own first sample.
  const rides = sceneryAnchor(input.profile)?.origin ?? 0;
  const reached: ReachedWay[] = [];
  for (const way of ways) {
    const shift = (sceneryAnchor(way.profile)?.origin ?? 0) - rides;
    const reach = toMetres - shift;
    if (reach > way.fromMetres) reached.push({ way, toMetres: reach, shift });
  }
  return reached;
}

const NO_JUNCTION_SURFACES: readonly JunctionSurface[] = [];

/**
 * The surfaces of the junctions of {@link SceneInput.junctionsTurned} that
 * are near a rider at `riderDistance` — #3133: from `way-roads.ts`
 * §`TURNED_OFF_REACH_METRES` behind them, as far as the road turned off is
 * drawn back (#3123), to the view's reach ahead.
 * ⚠️ Read off the constants, not the corridor: the corridor is built after,
 * since which of its stretches go unpainted is these surfaces' answer.
 */
function junctionSurfacesInView(
  input: SceneInput,
  riderDistance: number,
): readonly JunctionSurface[] {
  const junctions = input.junctionsTurned;
  if (junctions === undefined || junctions.length === 0) return NO_JUNCTION_SURFACES;
  return junctionSurfacesAt(
    input.profile,
    input.origin,
    junctions,
    // Both count ride distance from the view's first sample.
    sceneryAnchor(input.profile)?.origin ?? 0,
    riderDistance - TURNED_OFF_REACH_METRES,
    riderDistance + VIEW_AHEAD_METRES,
  );
}

/**
 * `reached`, with the road the rider turned off at each junction of
 * {@link SceneInput.turnedOff} they have passed — #3123: the way the route
 * would have taken, from the junction on, and the road itself from the
 * junction back, each to `way-roads.ts` §`TURNED_OFF_REACH_METRES`. A way
 * so handed is not handed again as a way out. `reached` itself where no
 * junction turned off at is behind the rider.
 */
function withTurnedOff(
  reached: readonly ReachedWay[],
  input: SceneInput,
  riderDistance: number,
): readonly WayReached[] {
  const turnedOff = input.turnedOff;
  if (turnedOff === undefined || turnedOff.length === 0) return reached;
  // Both views count ride distance from their own first sample.
  const rides = sceneryAnchor(input.profile)?.origin ?? 0;
  const passed = turnedOff.filter(({ junction }) => junction - rides <= riderDistance);
  if (passed.length === 0) return reached;
  const out: WayReached[] = reached.filter(
    ({ way }) => !passed.some((each) => each.way.profile === way.profile),
  );
  for (const { junction, way } of passed) {
    const junctionMetres = junction - rides;
    out.push(
      {
        way,
        toMetres: way.fromMetres + TURNED_OFF_REACH_METRES,
        shift: (sceneryAnchor(way.profile)?.origin ?? 0) - rides,
        turnedOff: { junctionMetres, back: false },
      },
      {
        way: { profile: input.profile, fromMetres: junctionMetres },
        toMetres: junctionMetres - TURNED_OFF_REACH_METRES,
        shift: 0,
        turnedOff: { junctionMetres, back: true },
      },
    );
  }
  return out;
}

/**
 * `road`'s side roads, with the crossroads of every village along each way
 * out `reached` past its junction — #3095: `cross-streets.ts`
 * §`sideRoadsAt` on the way's own view, with no mapped junction (the road's
 * mapped ones are the held streets', which the frame draws already).
 */
function withVillageCrossroadsOnWays(
  road: readonly SideRoad[],
  reached: readonly ReachedWay[],
  input: SceneInput,
  seed: number,
  riderDistance: number,
): readonly SideRoad[] {
  if (reached.length === 0) return road;
  const land = input.landClass ?? NO_LAND_CLASS;
  const onWays: SideRoad[] = [];
  for (const { way, toMetres, shift } of reached) {
    for (const each of sideRoadsAt(
      way.profile,
      input.origin,
      seed,
      way.fromMetres,
      toMetres,
      riderDistance - shift,
      [],
      land,
    )) {
      if (each.junction.along >= way.fromMetres && !onWays.includes(each)) onWays.push(each);
    }
  }
  return onWays.length === 0 ? road : [...road, ...onWays];
}

/**
 * Where the ride's junctions are on `profile`: each of
 * {@link SceneInput.junctionsSeen} that stands on its line, at its distance
 * there — #3095, the cuts `streets.ts` §`streetsAt` lays a village's street in
 * pieces at. The road's own junctions on the road, and on a way out its own
 * junction and those along it.
 *
 * ⚠️ **From the junctions the ride has seen, never from the ways out in
 * view.** The ways out change as a junction comes within the view's reach
 * ahead and drops out of it behind, and a cut made or dropped re-lays the
 * street it cuts: its pavements, lamp posts and walks, and the people on
 * them, moved on an ordinary frame with no press. The junctions seen are
 * seen 2 km ahead and kept 1 km behind (`open-world/road.ts`
 * §`junctionsSeen`), so the cuts on any street in view are the same on every
 * frame, and on every view through the junction.
 */
function junctionsOn(profile: RouteProfile, input: SceneInput): readonly number[] {
  const seen = input.junctionsSeen;
  if (seen === undefined || seen.length === 0) return NO_JUNCTION_CUTS;
  // The same while the junctions are: `road.ts` hands the same array until they change.
  let byProfile = cutsFound.get(seen);
  if (byProfile === undefined) {
    byProfile = new WeakMap();
    cutsFound.set(seen, byProfile);
  }
  const known = byProfile.get(profile);
  if (known !== undefined) return known;
  const { origin } = input;
  // Its distance on `profile`: the junction's is ride distance.
  const mine = sceneryAnchor(profile)?.origin ?? 0;
  const cuts: number[] = [];
  for (const junction of seen) {
    const at = junction.distance - mine;
    if (!(at >= 0 && at <= profile.totalDistance) || cuts.includes(at)) continue;
    // On the route's own line through the junction, not the drawn road,
    // which rounds the corner a different way on each view.
    const here = localGroundPosition(origin, positionAt(profile, at));
    const there = localGroundPosition(origin, junction.position);
    if (Math.hypot(here.x - there.x, here.z - there.z) > JUNCTION_ON_METRES) continue;
    cuts.push(at);
    // And short of it by the corner the drawn road rounds there, which is
    // another corner on every view: what lies short of that is the same.
    if (at - JUNCTION_CORNER_METRES >= 0) cuts.push(at - JUNCTION_CORNER_METRES);
  }
  const found = cuts.length === 0 ? NO_JUNCTION_CUTS : cuts;
  byProfile.set(profile, found);
  return found;
}

const NO_JUNCTION_CUTS: readonly number[] = [];

/** {@link junctionsOn}'s answers, by the junctions seen and the profile. */
const cutsFound = new WeakMap<readonly JunctionSeen[], WeakMap<RouteProfile, readonly number[]>>();

/**
 * How far short of a junction a village's street is cut a second time,
 * metres: **20** — twice `terrain.ts` §`BEND_SMOOTHING_METRES`, over which the
 * drawn road rounds a corner (and a normal's own step), so the street short
 * of it is laid alike on every view through the junction. Between the two
 * cuts it follows the corner the route takes: the stretch of a village a
 * press still redraws.
 */
const JUNCTION_CORNER_METRES = 2 * BEND_SMOOTHING_METRES;

/**
 * How near a way's junction must stand to a view's own line at the same ride
 * distance to be one of that view's junctions, metres: **3**, inside the
 * narrowest street's half-width.
 */
const JUNCTION_ON_METRES = 3;

/**
 * `road`'s village streets, with every village's street along each way out
 * `reached` that starts past its junction — #3095: `streets.ts` §`streetsAt`
 * on the way's own view, read as the road reads its own, so a street the
 * route takes and the same street as a way out are laid the same.
 *
 * ⚠️ **A street that starts short of the junction is the road's alone.** It
 * runs on from the approach along whichever way the route takes, so its
 * pavements past the junction follow the street a choice takes: the one part
 * of a village a press still moves, and only for a village whose street
 * reaches across a junction.
 */
function withVillageStreetsOnWays(
  road: readonly VillageStreet[],
  reached: readonly ReachedWay[],
  input: SceneInput,
  seed: number,
): readonly VillageStreet[] {
  if (reached.length === 0) return road;
  const land = input.landClass ?? NO_LAND_CLASS;
  const onWays: VillageStreet[] = [];
  for (const { way, toMetres } of reached) {
    for (const street of streetsAt(
      way.profile,
      input.origin,
      seed,
      way.fromMetres,
      toMetres,
      input.worldCorridor === undefined
        ? NO_PAVEMENT_DATA
        : pavementSides(input.worldCorridor, way.profile, input.origin),
      land,
      undefined,
      undefined,
      junctionsOn(way.profile, input),
    )) {
      if (street.from >= way.fromMetres && !onWays.includes(street)) onWays.push(street);
    }
  }
  return onWays.length === 0 ? road : [...road, ...onWays];
}

/**
 * `road`'s billboards, with every one along each way out `reached` past its
 * junction — #3095: `billboards.ts` §`billboardsAt` on the way's own view.
 * Each carries the road's odometer for the same ride distance, so the nearest
 * are kept of all of them, whichever is the road; and none stands on the road
 * itself, which a board beside a way may near its junction.
 */
function withBillboardsOnWays(
  road: readonly Billboard[],
  reached: readonly ReachedWay[],
  input: SceneInput,
  seed: number,
  land: LandClassMask,
): readonly Billboard[] {
  if (reached.length === 0) return road;
  const onWays: Billboard[] = [];
  for (const { way, toMetres, shift } of reached) {
    for (const board of boardsOnWay(way, input.origin, seed, land)) {
      if (board.along >= toMetres) break;
      if (
        distanceToDrawnRoad(
          input.profile,
          input.origin,
          board.x,
          board.z,
          BOARD_ROAD_CLEARANCE_METRES,
        ) < BOARD_ROAD_CLEARANCE_METRES
      ) {
        continue;
      }
      const along = board.along + shift;
      if (!onWays.some((other) => other.x === board.x && other.z === board.z)) {
        onWays.push({ ...board, along });
      }
    }
  }
  return onWays.length === 0 ? road : [...road, ...onWays];
}

/**
 * The billboards along `way` past its junction, for
 * `scatter.ts` §`SCATTER_WAY_REACH_METRES`, in order along it — #3095:
 * found once a way, and kept for as long as its view is, as
 * `settlements.ts` §`structuresOnWay` keeps its houses.
 */
function boardsOnWay(
  way: ScatterWay,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): readonly Billboard[] {
  const held = boardsAlongWays.get(way.profile);
  if (
    held?.origin === origin &&
    held.seed === seed &&
    held.land === land &&
    held.fromMetres === way.fromMetres
  ) {
    return held.boards;
  }
  const boards = billboardsAt(
    way.profile,
    origin,
    seed,
    way.fromMetres,
    way.fromMetres + SCATTER_WAY_REACH_METRES,
    land,
  ).filter((board) => board.along >= way.fromMetres);
  boardsAlongWays.set(way.profile, { origin, seed, land, fromMetres: way.fromMetres, boards });
  return boards;
}

/** {@link boardsOnWay}'s, by the way's view. */
const boardsAlongWays = new WeakMap<
  RouteProfile,
  {
    readonly origin: CorridorOrigin;
    readonly seed: number;
    readonly land: LandClassMask;
    readonly fromMetres: number;
    readonly boards: readonly Billboard[];
  }
>();

/**
 * How far from the road's centreline a board along a way out must stand,
 * metres — #3095: the road's half and its verge, and a board's own half-width
 * (`logo-board.ts` §`BILLBOARD_FOOTPRINT`), so none stands in the road.
 */
const BOARD_ROAD_CLEARANCE_METRES = ROAD_CLEARANCE_METRES + BILLBOARD_FOOTPRINT.x;

/**
 * `road`'s other cyclists, with those riding each way out `reached` past its
 * junction — #3095: `scenery-cyclists.ts` §`cyclistsInReach` on the way's own
 * view, for a rider as far along it as along the road, placed on the way's
 * own corridor and drawn line as the road's are on the road's. An encounter
 * is the ride's, so the one past the junction rides whichever street the
 * route takes and every other, and a choice moves none of them.
 */
function withCyclistsOnWays(
  road: readonly SceneryCyclist[],
  reached: readonly ReachedWay[],
  input: SceneInput,
): readonly SceneryCyclist[] {
  if (reached.length === 0 || !sceneryCyclistsAllowed(input)) return road;
  const riderDistance = drawnRider(input).distance;
  const seed = scatterSeed(input.profile);
  const onWays: SceneryCyclist[] = [];
  for (const { way, shift } of reached) {
    const rider = riderDistance - shift;
    const town = townAt(way.profile, seed, input.mappedTown?.urban ?? NO_URBAN_CLASS);
    const past = cyclistsInReach(way.profile, seed, town, rider).filter(
      (each) => each.along >= way.fromMetres,
    );
    if (past.length === 0) continue;
    const corridor = roadCorridor(way.profile, input.origin, rider);
    const last = corridor.centre[corridor.centre.length - 1];
    const line = input.centreline === true ? undefined : drawnLine(way.profile);
    for (const each of past) {
      if (last === undefined || each.along > last.along) continue;
      onWays.push(cyclistOn(corridor, line, each, each.encounter.lane, input.state.ride.speed));
    }
  }
  return onWays.length === 0 ? road : [...road, ...onWays];
}

/**
 * `placed`, the road's own structures, with those along an open-world ride's
 * ways out (#3051, {@link SceneInput.waysOut}) that a frame carries: the
 * ways' as far along each as the view reaches through its junction, which is
 * `toMetres` on the road, and off the road. Each way's ground is appended to
 * `footprints`, after the road's own, so the natural scenery keeps off both.
 *
 * **One budget, and no say in it for which is the road.** Where the road's
 * and the ways' together pass `most`, the buildings are kept before the field
 * boundaries (`settlements.ts` §`BOUNDARY_KINDS`), as `structuresAt` keeps a
 * house before a far wall, and within each the nearest the rider, wherever
 * they stand. Had the road's own been kept first, a junction choice would
 * take the houses off the street it left and stand them along the one it
 * took. `placed` itself where there is no way out: every ride but an
 * open-world one, and a frame of one with no junction in view.
 */
function withStructuresOnWays(
  placed: readonly ScatterItem[],
  input: SceneInput,
  seed: number,
  rider: { readonly x: number; readonly z: number },
  toMetres: number,
  most: number,
  footprints: SettlementFootprint[],
  land: LandClassMask,
  countryside: Countryside,
): readonly ScatterItem[] {
  const ways = input.waysOut;
  if (ways === undefined || ways.length === 0) return placed;
  const town = input.lotsOff === true ? null : (input.mappedTown ?? NO_MAPPED_TOWN);
  // Both views count ride distance from their own first sample.
  const rides = sceneryAnchor(input.profile)?.origin ?? 0;
  const onWays: ScatterItem[] = [];
  const boundaries: boolean[] = [];
  for (const way of ways) {
    const built = structuresOnWay(way, input.origin, seed, land, town, countryside);
    // As far along the way as this frame's view reaches through its junction.
    const reach = toMetres - ((sceneryAnchor(way.profile)?.origin ?? 0) - rides);
    const within = structuresWithin(built, reach);
    for (let index = 0; index < within.items; index += 1) {
      onWays.push(built.items[index] as ScatterItem);
      boundaries.push(built.boundaries[index] as boolean);
    }
    for (let index = 0; index < within.footprints; index += 1) {
      footprints.push(built.footprints[index] as SettlementFootprint);
    }
  }
  if (onWays.length === 0) return placed;
  // The budget first, and only then each of the ways' held off THIS road by
  // the clearance its own structures keep, since a way leaves the road at its
  // junction. `sceneFrame` stands them all on the frame's ground.
  const clear = (item: ScatterItem): boolean =>
    structureClearance(input.profile, input.origin, item) >= ROAD_CLEARANCE_METRES;
  if (placed.length + onWays.length <= most) return [...placed, ...onWays.filter(clear)];
  // A building before a field boundary, and the nearest the rider of each.
  const all = [...placed, ...onWays];
  const order = new Float64Array(all.length);
  for (let index = 0; index < all.length; index += 1) {
    const item = all[index] as ScatterItem;
    const boundary =
      index < placed.length
        ? BOUNDARY_KINDS.has(item.kind as StructureKind)
        : (boundaries[index - placed.length] as boolean);
    order[index] =
      Math.hypot(item.x - rider.x, item.z - rider.z) + (boundary ? FIELD_BOUNDARIES_AFTER : 0);
  }
  const kept: ScatterItem[] = [];
  for (const index of Array.from(order.keys())
    .sort((first, second) => (order[first] as number) - (order[second] as number))
    .slice(0, Math.max(0, most))) {
    const item = all[index] as ScatterItem;
    if (index < placed.length || clear(item)) kept.push(item);
  }
  return kept;
}

/**
 * What {@link withStructuresOnWays} adds to a field boundary's distance from
 * the rider to order it after every building: further than any frame reaches.
 */
const FIELD_BOUNDARIES_AFTER = 1e6;

/**
 * The mapped buildings, with the rider's chunk and drawn place, and since
 * #2429 the road ahead a refill ranks them by. @see SceneFrame.mappedBuildings
 */
function mappedInView(
  buildings: MappedBuildings,
  corridor: RoadCorridor,
  riderDistance: number,
  branches: Float32Array | undefined,
): MappedBuildingsInView {
  const here = placeOnCorridor(corridor, riderDistance);
  const road = routeAhead(corridor, riderDistance);
  // #2902: the ways on not taken after the road ahead, a `NaN` pair between,
  // which `rankFrom` measures no segment across.
  let ahead = road;
  if (branches !== undefined && branches.length >= 2) {
    ahead = new Float32Array(road.length + 2 + branches.length);
    ahead.set(road);
    ahead[road.length] = Number.NaN;
    ahead[road.length + 1] = Number.NaN;
    ahead.set(branches, road.length + 2);
  }
  return {
    buildings,
    chunk: mappedChunk(riderDistance),
    x: here.x,
    z: here.z,
    ahead,
  };
}

/**
 * The drawn road from `riderDistance` {@link MAPPED_RANKED_AHEAD_METRES} on,
 * a point every {@link MAPPED_AHEAD_STEP_METRES}, as `x, z` pairs — #2429.
 * Read off the corridor, so it is the road this frame drew; past the end of a
 * point-to-point route its points stand on the last one.
 */
function routeAhead(corridor: RoadCorridor, riderDistance: number): Float32Array {
  const steps = Math.round(MAPPED_RANKED_AHEAD_METRES / MAPPED_AHEAD_STEP_METRES);
  const ahead = new Float32Array((steps + 1) * 2);
  for (let step = 0; step <= steps; step += 1) {
    const at = placeOnCorridor(corridor, riderDistance + step * MAPPED_AHEAD_STEP_METRES);
    ahead[step * 2] = at.x;
    ahead[step * 2 + 1] = at.z;
  }
  return ahead;
}

/**
 * The nearest the camera's target is ever put, in metres: **10** — #1994.
 * @see cameraPose
 *
 * Both the nearest point up the ROUTE a tight bend draws the target in to,
 * and, past the end of a point-to-point route — where the corridor clamps on
 * its final point and there is no road to look at — the nearest it is put to
 * the point the camera stands behind, along the same line. Nearer, the camera
 * would tip down at its own rider's front wheel; at 10 m it is pitched 7.9°
 * down, against 3.9° on the flat.
 */
const CAMERA_TARGET_NEAREST_METRES = 10;

/**
 * The farthest off the middle of the frame, seen from the eye, a bend may put
 * the rider: **20°** — #1994. @see cameraPose
 *
 * Inside the 24.7° half-width an upright phone sees (`camera.ts`
 * §`verticalHalfTangent`), so the rider stays in every frame a device draws;
 * a leaning rider leans INTO the bend, toward the middle.
 */
const RIDER_OFF_AXIS_RADIANS = (20 * Math.PI) / 180;

/**
 * Where the chase camera looks from, and what it looks at.
 *
 * `lateralMetres` is how far across the road the rider is drawn, positive on
 * the road's own normal side (#499); the camera is moved across with them.
 *
 * Everything is read off the corridor's own centreline rather than a stored
 * bearing, so the camera and the road cannot disagree. A separately-computed
 * bearing is the kind of second source of truth that drifts by a frame and
 * reads as the camera lagging the corner.
 *
 * ⚠️ **The camera LOOKS AT THE ROAD ahead — #1994.** Until then the target was
 * {@link CAMERA_TARGET_AHEAD_METRES} straight on along the tangent of the
 * corridor piece under the rider, which in a tight bend is a field or a
 * junction. Now:
 *
 * - the **eye** is where it always was, {@link CAMERA_BEHIND_METRES} straight
 *   back from the rider along the road's tangent there;
 * - the **target** is ON the road, on the rider's line (moved across by the
 *   same `lateralMetres` along that point's own normal), the farthest up the
 *   ROUTE — up to {@link CAMERA_TARGET_AHEAD_METRES}, and no nearer than
 *   {@link CAMERA_TARGET_NEAREST_METRES} — that keeps the rider within
 *   {@link RIDER_OFF_AXIS_RADIANS} of the middle of the frame. On a straight,
 *   and through any bend gentler than about 30 m of radius, that is the full
 *   25 m; through a 20 m one it is about 18 m, through a 10 m hairpin 10 m;
 * - the **heading** is from the eye to the target, and the pose's `x`/`z` are
 *   the point on that line {@link CAMERA_BEHIND_METRES} past the eye — so
 *   `camera.ts` §`cameraRig`, and every cull in `three-renderer.ts` that puts
 *   the eye behind `x`/`z` along the heading, see the camera that is drawn. On
 *   a straight that point is the rider and nothing changes.
 *
 * ⚠️ **Why the eye does not swing round with the view.** An eye swung round
 * behind the rider on the line to the target keeps the rider in the middle of
 * the frame, and stands up to 5 m from the centreline in a 20 m hairpin, over
 * the pavement: `near-field-street.test.ts` (#545) measured its near plane
 * cutting mapped walls and people at every aspect up to a 21 : 9 phone. Kept
 * where it was, the eye is where #545 holds it, and the rider is drawn a little
 * toward the OUTSIDE of a bend instead; and kept where it was with the target
 * 25 m on regardless, a 10 m hairpin put the rider out of the frame altogether,
 * which is what the shortened look-ahead is for.
 *
 * Where even {@link CAMERA_TARGET_NEAREST_METRES} up the road is further off
 * the axis than that — a hairpin tighter than about 10 m, a turnaround where
 * the road comes back past the rider — the target is that nearest point, and
 * the damping turns the camera round with the road.
 *
 * Undamped: this is a function of one frame, and `GameView` damps the heading
 * across frames (`camera.ts` §`dampedHeading`, §`turnedPose`).
 *
 * `eyeLateralMetres`, since #2396, stands the eye that far across the road
 * instead of behind the rider: a Delivery round moves it off a parked car it
 * is alongside (`delivery/camera-clear.ts`). The target is still on the
 * rider's line. Absent, it is `lateralMetres`, and the pose is the one every
 * ride drew before.
 */
export function cameraPose(
  corridor: RoadCorridor,
  atDistance: number,
  lateralMetres: number,
  eyeLateralMetres: number = lateralMetres,
  path?: DrawnLine,
): CameraPose {
  const pose = roadPose(corridor, atDistance, lateralMetres, eyeLateralMetres, path);
  // #3122: through a one-point U-turn the camera pivots on the rider instead.
  const share = path === undefined ? 0 : uTurnPivotShare(path, atDistance);
  if (!(share > 0) || path === undefined) return pose;
  const rider = chaseRider(corridor, atDistance, lateralMetres, path);
  return pivotedOnRider(pose, rider, share);
}

/**
 * How much of the way the chase camera is pivoted on the drawn rider at
 * `atDistance`, nought to one — #3122: one through a recorded one-point
 * U-turn (`drawn-line.ts` §`uTurns`), eased in over
 * {@link U_TURN_CAMERA_METRES}' `easedIn` before the road the camera looks at
 * reaches the U-turn, and handed back over its `handedBack` once the road
 * behind the rider is straight again. Nought on a line with none.
 *
 * The U-turn is found where `drawn-line.ts` §`drawnLineAt` draws it, on the
 * route position the odometer wraps to, so on a loop it pivots on every lap
 * and not only the first.
 */
function uTurnPivotShare(path: DrawnLine, atDistance: number): number {
  const { profile } = path;
  const resolution: number = profile.resolution;
  const { easedIn, handedBack } = U_TURN_CAMERA_METRES;
  let most = 0;
  for (const sample of path.uTurns) {
    const turning = sample * resolution;
    const from = profile.loop ? distanceOnRoute(profile, atDistance) : atDistance;
    // The U-turn is ridden from one sample before the turning point to one
    // after it (`drawn-line.ts` §`uTurned`).
    const begins = turning - resolution - CAMERA_TARGET_AHEAD_METRES;
    const ends = turning + resolution + CAMERA_TARGET_AHEAD_METRES;
    const into = smoothstep01((from - (begins - easedIn)) / easedIn);
    const out = 1 - smoothstep01((from - ends) / handedBack);
    most = Math.max(most, Math.min(into, out));
  }
  return most;
}

/**
 * Over how much road the chase camera is brought onto the rider before a
 * one-point U-turn, and handed back after it, in metres: **10** and **15** —
 * #3122. @see uTurnPivotShare
 *
 * ⚠️ **What the pivot is for.** Through a recorded U-turn the frame's own pose
 * (`roadPose`) is the wrong camera twice over. Its eye stands on the drawn
 * path {@link CAMERA_BEHIND_METRES} back (#2422), which round a turn a few
 * metres across is on the other leg, BESIDE the rider; and it looks at the
 * nearest road ten metres up the route (#1994), which comes back past the
 * rider, so it looks across the road. On the synthetic 174° coast turnaround
 * (`turnaround-coast.test.ts`) the eye was 1.2 m behind the rider and 1.9 m
 * to the side, and stepped 0.3 m in one frame at 30 km/h: the owner's "camera
 * beside the rider, low, looking sideways". Pivoted on the rider, along the
 * rider's own heading, `camera.ts` §`turnedPose` swings the eye round behind
 * them at the damped rate, {@link CAMERA_BEHIND_METRES} back, and the rider's
 * heading turns no faster than that rate (#3045). 10 m is about a second at
 * 30 km/h; 15 m is #3066's hand-back after a pressed U-turn. Not measured
 * optima.
 */
const U_TURN_CAMERA_METRES = { easedIn: 10, handedBack: 15 } as const;

/** A smoothstep of `value`, clamped to nought and one. */
function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * `pose` moved `share` of the way to the camera that pivots on the drawn
 * `rider` and looking the way they ride — #3122. How far it looks is the
 * frame's own, which `GameView` damps (`camera.ts` §`dampedLookAhead`), at the
 * rider's own height: along the rider's heading at the tip of a U-turn there
 * is no road to read one off. @see U_TURN_CAMERA_METRES
 */
function pivotedOnRider(
  pose: CameraPose,
  rider: ReturnType<typeof chaseRider>,
  share: number,
): CameraPose {
  const keep = 1 - share;
  const headingX = pose.headingX * keep + rider.tangent.headingX * share;
  const headingZ = pose.headingZ * keep + rider.tangent.headingZ * share;
  const length = Math.hypot(headingX, headingZ);
  const look =
    length > 1e-6 ? { headingX: headingX / length, headingZ: headingZ / length } : rider.tangent;
  return {
    x: pose.x * keep + rider.x * share,
    y: pose.y,
    z: pose.z * keep + rider.z * share,
    ...look,
    targetAheadMetres: pose.targetAheadMetres,
    eyeRoadY: pose.eyeRoadY * keep + rider.y * share,
    targetRoadY: pose.targetRoadY * keep + rider.y * share,
  };
}

/** {@link cameraPose} as it is everywhere but round a one-point U-turn. */
function roadPose(
  corridor: RoadCorridor,
  atDistance: number,
  lateralMetres: number,
  eyeLateralMetres: number,
  path?: DrawnLine,
): CameraPose {
  const rider = chaseRider(corridor, atDistance, lateralMetres, path);
  const { tangent } = rider;
  // #2396: the eye stands behind the rider, or across the road from there
  // where a Delivery round moves it off a parked car (`SceneInput.cameraLateral`).
  // The target below stays on the rider's line either way.
  const behind =
    eyeLateralMetres === lateralMetres ? rider : chaseRider(corridor, atDistance, eyeLateralMetres);
  // #2422: on a drawn path the eye stands ON it, the chase distance back —
  // on the tarmac the rider has just ridden — held a little in from the kerb
  // (@see eyeOnDrawnPath).
  const eyeOnPath =
    path === undefined ? undefined : eyeOnDrawnPath(path, atDistance - CAMERA_BEHIND_METRES);
  const eyeX = eyeOnPath?.x ?? behind.x - tangent.headingX * CAMERA_BEHIND_METRES;
  const eyeZ = eyeOnPath?.z ?? behind.z - tangent.headingZ * CAMERA_BEHIND_METRES;
  // The axis the rider is kept near is the eye's line to them: the tangent,
  // except where the eye stands on a drawn path behind them.
  const toRider = Math.hypot(rider.x - eyeX, rider.z - eyeZ);
  const axis =
    eyeOnPath === undefined || !(toRider > 1e-6)
      ? tangent
      : { headingX: (rider.x - eyeX) / toRider, headingZ: (rider.z - eyeZ) / toRider };
  const target = roadTarget(corridor, atDistance, lateralMetres, axis, eyeX, eyeZ, path);
  const dx = target.x - eyeX;
  const dz = target.z - eyeZ;
  const range = Math.hypot(dx, dz);
  const look = range > 1e-6 ? { headingX: dx / range, headingZ: dz / range } : tangent;
  return {
    x: eyeX + look.headingX * CAMERA_BEHIND_METRES,
    y: rider.y,
    z: eyeZ + look.headingZ * CAMERA_BEHIND_METRES,
    ...look,
    targetAheadMetres: target.pastTheEnd
      ? Math.max(range - CAMERA_BEHIND_METRES, CAMERA_TARGET_NEAREST_METRES)
      : Math.max(range - CAMERA_BEHIND_METRES, 1),
    // #424 — the two heights the camera pitches by, read off the SAME corridor
    // the road is drawn from, so the gaze and the tarmac cannot disagree.
    // `camera.ts` §`cameraRig` says why these are the road's real heights and
    // not the local grade extrapolated: approaching a crest the grade is still
    // +8 % while the road 25 m on has already flattened.
    //
    // `placeOnCorridor` clamps at both ends, and the corridor reaches 60 m
    // behind the rider and 400 m ahead, so both reads are inside it everywhere
    // except the first 4.5 m and the last 25 m of a point-to-point route —
    // where they settle on the first or last point and the gaze goes level.
    // ⚠️ On a drawn path, the road's height under the eye where it stands
    // (@see drawnHeight) — #2470. `cameraRig` stands the eye 2 m over
    // `eyeRoadY`, so this sets the eye's HEIGHT as well as the pitch. Read
    // at the odometer's place, the eye stood up to 0.30 m off 2 m over the
    // road under it on an 8 % climb through a corner, because the pacing
    // draws the eye metres along the road from that place.
    // `drawn-line.test.ts` holds it to 7 cm. `landform.test.ts`' far-leg
    // tests were re-derived for this eye: its climb test's road-facing check
    // and its crease test's bound against the ground's own steps.
    eyeRoadY:
      path === undefined
        ? placeOnCorridor(corridor, atDistance - CAMERA_BEHIND_METRES).y
        : drawnHeight(corridor, path, atDistance - CAMERA_BEHIND_METRES, { x: eyeX, z: eyeZ }),
    targetRoadY: target.y,
  };
}

/**
 * Where the chase camera's rider is, and which way the road runs there — #1994.
 *
 * The corridor at `atDistance`, moved across by `lateralMetres` along the
 * road's own normal (#499), NOT rolled with the lean (out of scope, and a
 * rolling horizon on a phone is the fastest way to make somebody feel ill).
 * {@link cameraPose} stands its eye behind it along `tangent`; the demo's
 * tour (`demo/camera-tour.ts`) points its other shots at it, because since
 * #1994 the pose's own `x`/`z` are the rider only on a straight.
 */
export function chaseRider(
  corridor: RoadCorridor,
  atDistance: number,
  lateralMetres: number,
  path?: DrawnLine,
): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tangent: { readonly headingX: number; readonly headingZ: number };
} {
  const here = placeOnCorridor(corridor, atDistance);
  if (path !== undefined) {
    // #2422: the rider's own place on the drawn path, and the path's own
    // direction — continuous, where the corridor's steps at every point —
    // moved off it, along its normal, by whatever keeps level riders apart,
    // exactly as `markerAt` moves the rider's marker.
    const on = drawnLineAt(path, clampedTo(corridor, atDistance));
    const aside = lateralMetres - lineOffsetAt(path, atDistance);
    const x = on.x - on.headingZ * aside;
    const z = on.z + on.headingX * aside;
    return {
      x,
      // At the road's height where they are drawn, not at the odometer's.
      y: drawnHeight(corridor, path, atDistance, { x, z }),
      z,
      tangent: on,
    };
  }
  const tangent = headingAt(corridor, here.index);
  return {
    x: here.x - tangent.headingZ * lateralMetres,
    y: here.y,
    z: here.z + tangent.headingX * lateralMetres,
    tangent,
  };
}

interface RoadTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Whether this is the end of a point-to-point route, clamped onto, rather than road. */
  readonly pastTheEnd: boolean;
}

/**
 * The point on the road the camera looks at — #1994. @see cameraPose
 *
 * The farthest point from {@link CAMERA_TARGET_NEAREST_METRES} to
 * {@link CAMERA_TARGET_AHEAD_METRES} up the route that keeps the rider within
 * {@link RIDER_OFF_AXIS_RADIANS} of the axis: down from the full look-ahead a
 * metre at a time to the first that does, then halved six times between it
 * and the metre beyond, so the target slides along the road by centimetres
 * from one frame to the next rather than stepping a metre. Where none does,
 * the nearest. Since #2989 the full look-ahead is not a hard cap: the search
 * starts {@link CAMERA_TARGET_EASE_METRES} past it and the look-ahead is
 * eased onto it ({@link easedReach}), so the target's speed along the road
 * does not change at once where the bend stops binding.
 */
function roadTarget(
  corridor: RoadCorridor,
  atDistance: number,
  lateralMetres: number,
  tangent: { readonly headingX: number; readonly headingZ: number },
  eyeX: number,
  eyeZ: number,
  path?: DrawnLine,
): RoadTarget {
  const at = (reach: number): RoadTarget => {
    const placed = placeOnCorridor(corridor, atDistance + reach);
    // Past a point-to-point route's end the corridor's points all clamp onto
    // its last one, so the piece the target is on has no length and no
    // direction: the rider's own stands in for it.
    const from = corridor.centre[placed.index] as CorridorPoint;
    const to = corridor.centre[placed.index + 1];
    const pastTheEnd = to === undefined || Math.hypot(to.x - from.x, to.z - from.z) < 1e-6;
    if (path !== undefined) {
      // #2422: ON the drawn path, the line the rider will ride, which is
      // smooth where the road's own centreline wanders with the track.
      const ahead = drawnLineAt(path, clampedTo(corridor, atDistance + reach));
      return {
        x: ahead.x,
        y: drawnHeight(corridor, path, atDistance + reach, ahead),
        z: ahead.z,
        pastTheEnd,
      };
    }
    const across = pastTheEnd ? tangent : headingAt(corridor, placed.index);
    return {
      x: placed.x - across.headingZ * lateralMetres,
      y: placed.y,
      z: placed.z + across.headingX * lateralMetres,
      pastTheEnd,
    };
  };
  // The eye looks at the rider along the tangent, so the rider is within the
  // bound of an axis through `point` when the angle between them is.
  const keepsRider = (point: { readonly x: number; readonly z: number }): boolean => {
    const dx = point.x - eyeX;
    const dz = point.z - eyeZ;
    const along = dx * tangent.headingX + dz * tangent.headingZ;
    const across = dx * tangent.headingZ - dz * tangent.headingX;
    return Math.abs(Math.atan2(across, along)) <= RIDER_OFF_AXIS_RADIANS;
  };
  // The farthest that keeps the rider, looked for past the full look-ahead
  // by the ease's width, then eased onto it (@see easedReach).
  const farthest = (): number => {
    let reach = CAMERA_TARGET_AHEAD_METRES + CAMERA_TARGET_EASE_METRES;
    if (keepsRider(at(reach))) return reach;
    while (reach > CAMERA_TARGET_NEAREST_METRES) {
      const beyond = reach;
      reach = Math.max(CAMERA_TARGET_NEAREST_METRES, reach - 1);
      if (keepsRider(at(reach))) {
        let near = reach;
        let far = beyond;
        for (let halving = 0; halving < 6; halving += 1) {
          const middle = (near + far) / 2;
          if (keepsRider(at(middle))) near = middle;
          else far = middle;
        }
        return near;
      }
    }
    return reach;
  };
  return at(Math.max(CAMERA_TARGET_NEAREST_METRES, easedReach(farthest())));
}

/**
 * How wide the ease is between the look-ahead a bend allows and the full
 * {@link CAMERA_TARGET_AHEAD_METRES}, metres: **4** — #2989. @see easedReach
 *
 * ⚠️ **Why there is one.** Through a bend the look-ahead is the farthest
 * that keeps the rider near the frame's middle, and it grows fast as the
 * rider comes out: the target slides along the road several times the
 * rider's speed. Capped hard at 25 m, it stopped sliding in one frame where
 * the cap took over, and the target's step changed by 0.30 m from one 60 fps
 * frame to the next at 30 km/h and 0.45 m at 40, through a junction drawn
 * from map streets — over ADR 0089 C-4's 0.25 m (#2989,
 * `open-world/rolling-camera.test.ts`). Measured at 40 km/h against the width:
 * 0.136 m at 1 m, 0.122 m at 2 m, **0.095 m at 4 m**, 0.086 m at 6 m. Past
 * 4 m it buys little, and the look-ahead it gives up just short of the cap
 * is at most a quarter of the width: 1 m.
 */
const CAMERA_TARGET_EASE_METRES = 4;

/**
 * The look-ahead for a bend that allows `allowed`: the lesser of it and
 * {@link CAMERA_TARGET_AHEAD_METRES}, eased where the two are within
 * {@link CAMERA_TARGET_EASE_METRES} of each other — #2989. A quadratic smooth
 * minimum: exactly the lesser outside the ease, at most a quarter of the
 * width under it inside, and with a slope that runs from one to nought
 * across it, so the look-ahead's rate changes over the ease rather than at
 * once. On a straight, where the bend allows more than the full look-ahead
 * and the width, it is the full 25 m.
 */
function easedReach(allowed: number): number {
  const full = CAMERA_TARGET_AHEAD_METRES;
  const width = CAMERA_TARGET_EASE_METRES;
  const near = Math.max(width - Math.abs(full - allowed), 0) / width;
  return Math.min(full, allowed) - (near * near * width) / 4;
}

/**
 * Which way the road runs at a corridor point.
 *
 * ⚠️ **One function, because since #349 two things need it**: the camera, and
 * every marker that has a front. A second copy would be the *"separately
 * computed value that can drift"* #94's third criterion forbids, arrived at
 * from the side — and it would drift by exactly the amount that puts a rider on
 * a bicycle at an angle to the road they are on.
 *
 * ⚠️ The heading is taken between the two corridor POINTS either side rather
 * than from the interpolated position to the next one, and that is not a
 * simplification: a camera sitting exactly on `ahead` would have a zero-length
 * direction and fall through to the arbitrary north below, which is a camera
 * that snaps sideways once per corridor point.
 */
function headingAt(
  corridor: RoadCorridor,
  index: number,
): { readonly headingX: number; readonly headingZ: number } {
  const from = corridor.centre[index] as CorridorPoint;
  const ahead = corridor.centre[Math.min(corridor.centre.length - 1, index + 1)];
  const dx = (ahead?.x ?? from.x + 1) - from.x;
  const dz = (ahead?.z ?? from.z) - from.z;
  const length = Math.hypot(dx, dz);
  // A stationary rider at the very end of a point-to-point route has no next
  // point, so the heading would be (0, 0) and the camera would look at itself.
  // Facing north is arbitrary and is better than a degenerate look-at, which
  // three resolves to NaN and renders as a black screen.
  return {
    headingX: length > 0 ? dx / length : 0,
    headingZ: length > 0 ? dz / length : 1,
  };
}

/**
 * The most a drawn rider is turned off the road's heading toward the way its
 * place on the line moves: **12°** — #1995.
 *
 * A judgement, not a measurement, and the reason is the camera. A rider moving
 * across the road by the width of a lane over a few bicycle lengths, the most
 * the line does outside a hairpin, points about 10° off it; in a hairpin the
 * drawn line can cross the road far faster, and facing all of that stood the
 * bicycle side-on to the road (#1995's review on the owner's course). 12° keeps
 * every ordinary change of line drawn as it is and reads, from the chase
 * camera, as a bicycle pointing along the road.
 */
export const FACING_TURN_LIMIT_RADIANS = (12 * Math.PI) / 180;

/**
 * How far a rider is drawn turned off the road, given the angle its drawn
 * place moves at off the road — #1995: that angle where it is small, and never
 * more than {@link FACING_TURN_LIMIT_RADIANS}, by a smooth saturation
 * (`limit · tanh(angle / limit)`), so the turn has no kink where it starts to
 * be held back.
 */
export function facingTurn(motion: number): number {
  return FACING_TURN_LIMIT_RADIANS * Math.tanh(motion / FACING_TURN_LIMIT_RADIANS);
}

/**
 * How far apart, side to side, two riders level on the road are drawn: **1.2 m**
 * between their middles — two handlebars 0.4 m wide and 0.8 m of air between
 * them. #499: every rider used to be on the centreline, so two level riders
 * were drawn inside each other.
 */
const SIDE_BY_SIDE_METRES = 1.2;

/**
 * Over how much road a pair stops being level: from {@link BICYCLE_LENGTH_METRES}
 * apart, where a bicycle could first overlap another, to **2 m** beyond that.
 * Inside the length they are {@link SIDE_BY_SIDE_METRES} apart; beyond the
 * fade they ride the line; between, they ease across, so no rider jumps
 * sideways as another passes. At every gap either the bicycles are a length
 * apart along the road or they are a handlebar clear of each other across it.
 */
const LEVEL_FADE_METRES = 2;

/**
 * How far behind a rider a Delivery round steered (#1820) another rider is held
 * aside of them: until its front wheel is level with the chase camera's eye,
 * {@link CAMERA_BEHIND_METRES} + {@link BICYCLE_FRONT_METRES} = **5.36 m** —
 * #1863. Nearer than that, some of it is between the camera and the rider,
 * large in the foreground; beyond it, it eases back to its own line over
 * {@link LEVEL_FADE_METRES}, wholly behind the eye, where no frame shows it.
 * At 30 km/h the hold and the fade are 0.9 s of road.
 *
 * Exact on a straight. `behind` is measured along the road, while the eye sits
 * {@link CAMERA_BEHIND_METRES} straight back along the rider's heading, so on a
 * bend the front wheel is level with the eye only to within a fraction of a
 * metre (about 0.5 m sideways on a 20 m hairpin, outside the frustum).
 */
const HELD_BEHIND_METRES = CAMERA_BEHIND_METRES + BICYCLE_FRONT_METRES;

/**
 * How far from the centre a rider is ever drawn: **3.2 m** — half a handlebar
 * and 0.1 m inside the 7 m road's edge. Wider than the line's own
 * {@link LINE_LIMIT_METRES}, because a rider moved aside for another has to go
 * somewhere.
 */
const DRAWN_LIMIT_METRES = ROAD_WIDTH_METRES / 2 - RIDER_HALF_WIDTH_METRES - 0.1;

/**
 * How much of the line a level rider gives up to make room: the share that
 * keeps a rider {@link SIDE_BY_SIDE_METRES} off the line on the road —
 * `1 − (3.2 − 1.2) / 2.9 ≈ 0.31`. Derived, so the three constants above cannot
 * disagree about whether a pair fits.
 */
const LINE_GIVEN_UP = 1 - (DRAWN_LIMIT_METRES - SIDE_BY_SIDE_METRES) / LINE_LIMIT_METRES;

/**
 * Which side of the line each kind moves to when it is level with another:
 * the rider keeps to the line (brought toward the centre only by
 * {@link LINE_GIVEN_UP}, to leave the others room), the bot moves to the
 * normal's negative side and the ghost to its positive side, so all three level
 * at once are three abreast.
 */
const LEVEL_LANES: Readonly<Record<RiderMarker['kind'], number>> = {
  rider: 0,
  bot: -1,
  ghost: 1,
  // #783: a remote rider's side is its own (`Rider.lane`, by rider id), so two
  // of them level with each other are not drawn in one place.
  remote: 1,
};

/**
 * The riders of one frame on `corridor` — what {@link sceneFrame} draws as its
 * markers, rider first, and the one place it gets them.
 *
 * Its own export so that a test sweeping hundreds of rider positions can place
 * the riders without building the scenery, the ground and the water beside
 * them each time — nine tenths of a frame, none of which a marker reads (#588).
 * `line-on-the-road.test.ts` checks that it and `sceneFrame` agree.
 */
export function placedRiders(input: SceneInput, corridor: RoadCorridor): readonly PlacedRider[] {
  // #499. Computed once per route and cached against the profile object
  // (`racing-line.ts` §`racingLine`), so this is the first frame's cost only.
  // #2422: the drawn path's line wherever the riders are eased, which is the
  // line they are drawn on; `racingLine` where they are not.
  const line =
    input.centreline === true ? undefined : (easingLine(input) ?? racingLine(input.profile));
  return ridersOnTheRoad(corridor, input, drawnRider(input), line);
}

/**
 * The line a frame's riders are eased off for sharp bends on — #1998
 * (`bend-easing.ts`) — or none.
 *
 * ⚠️ **None in a Delivery round or a lap race**, where the drawn place is the
 * place the game's own events meet the rider: a round's obstacles meet them at
 * their odometer and a crash is drawn as one (#1853), and a race draws its
 * racers at their race positions (ADR 0060 D-3.3). Eased there, a crash would
 * be drawn metres short of what it hit. None with the line switched off, the
 * browser gate's control, which draws the riders as they were before #499,
 * and none when {@link SceneInput.uneased} asks for the riders as they were
 * before #1998.
 */
function easingLine(input: SceneInput): DrawnLine | undefined {
  if (input.centreline === true || input.uneased === true) return undefined;
  if (input.steeredLateral !== undefined || input.raceBots !== undefined) return undefined;
  return input.drawnPath ?? drawnLine(input.profile);
}

/**
 * The path the riders are drawn along and the camera follows — #2422
 * (`drawn-line.ts`) — wherever they are eased, and none where they are drawn
 * beside the road as before. @see easingLine
 */
export function drawnPathOf(input: SceneInput): DrawnLine | undefined {
  return easingLine(input);
}

/**
 * Where along the road {@link sceneFrame} draws the rider, and builds the
 * corridor and stands the chase camera — #1998. For a caller that places a
 * camera of its own on the frame's road (`demo/player.ts`, the demo's tour):
 * the odometer is NOT that place in a sharp bend, and a camera stood on it
 * there stands metres ahead of the rider it is following.
 */
export function drawnRiderDistance(input: SceneInput): number {
  return drawnRider(input).distance;
}

/**
 * Where, and how fast, the rider is drawn — their odometer (#323's blend of
 * the last two steps, when given) eased off for a sharp bend (#1998). One
 * function, because the corridor and the camera are built around this place
 * and the rider's marker is put at it: two would be a camera off its rider.
 */
function drawnRider(input: SceneInput): EasedPlace {
  const odometer: number = input.riderDistance ?? input.state.ride.distance;
  const speed: number = input.state.ride.speed;
  const easing = easingLine(input);
  return easing === undefined ? { distance: odometer, speed } : easedPlace(easing, odometer, speed);
}

/** A rider on the road, and how far across it they were drawn. */
/**
 * The height of a street's surface at `(x, z)`, as the side streets stand
 * (`nearby-streets.ts` §`routeGround`) — #3052's names are painted on it —
 * or `undefined` off the drawn ground.
 */
/** A route ride's road as its street names are laid on it — #3261. @see RouteLabelRoad */
function routeLabelRoad(input: SceneInput, seed: number): RouteLabelRoad {
  const profile = input.profile;
  const land = input.landClass ?? NO_LAND_CLASS;
  return {
    heightAt: (metres) =>
      terrainHeightAt(profile, input.origin, seed, metres, 0, land) + NEARBY_STREET_LIFT_METRES,
    // The rider's distance is an odometer, so on a loop it is read round the lap.
    gap: (from, to) => {
      if (!profile.loop || !(profile.totalDistance > 0)) return Math.abs(to - from);
      const apart = Math.abs(to - from) % profile.totalDistance;
      return Math.min(apart, profile.totalDistance - apart);
    },
  };
}

function streetSurfaceAt(
  input: SceneInput,
  seed: number,
): (x: number, z: number) => number | undefined {
  const ground = routeGround(input.profile, input.origin, seed, input.landClass ?? NO_LAND_CLASS);
  return (x, z) => ground.about(x, z)?.(x, z);
}

export interface PlacedRider {
  readonly marker: RiderMarker;
  /** Metres across the road from the centreline, positive on the normal's side. */
  readonly lateral: number;
}

/** One rider before it is placed: who, how far, and how fast. */
interface Rider {
  readonly kind: RiderMarker['kind'];
  readonly distance: number;
  /**
   * Its own odometer — #2427: where the room and the solo draft hold it, which
   * {@link distance} is eased from and the drawn order is kept to
   * (§`inOdometerOrder`).
   */
  readonly odometer: number;
  /** How fast it is DRAWN — eased for a bend, and above its own speed while it gives the lag back (#1998). */
  readonly speed: number;
  /**
   * How fast it is actually going — its own odometer's speed, never the drawn
   * one — #1999: what its position on the bicycle is chosen from. ⚠️ The
   * owner fed 55 km/h in and the marker said about 63: that was the drawn
   * speed giving back a bend's lag, `bend-easing.ts` §`GIVE_BACK_SHARE`'s
   * 15 % over the rider's own.
   */
  readonly ownSpeed: number;
  readonly crankAngle: number | undefined;
  /** Whether a reading turns this rider's cranks, before a bend parks them. @see RiderMarker.pedalling */
  readonly pedalling: boolean;
  /** The side of the line it moves to when level, where the kind's is not enough. @see LEVEL_LANES */
  readonly lane?: number | undefined;
  /** Where a Delivery round steered it, in place of the line — the rider's only. @see SceneInput.steeredLateral */
  readonly steered?: number | undefined;
  /**
   * How fast it is drawn moving across the road while steered — the rider's —
   * or while a lap race's pack moves it — a race bot's (#2544).
   * @see SceneInput.steeredSway @see RaceBotInput.swayMetresPerSecond
   */
  readonly sway?: number | undefined;
  /** How fast that is changing — the rider's only. @see SceneInput.steeredSwayRate */
  readonly swayRate?: number | undefined;
  /** A remote rider's name on the road. @see RiderMarker.label */
  readonly label?: string | undefined;
  /** @see RiderMarker.followed */
  readonly followed?: boolean | undefined;
  /** @see RiderMarker.body */
  readonly body?: RiderBody | undefined;
  /** @see RiderMarker.skin */
  readonly skin?: number | undefined;
  /** A lap-race bot's lane, across the road, in place of the line. @see RaceBotInput.lateralMetres */
  readonly laned?: number | undefined;
  /** @see RaceBotInput.laidOut */
  readonly laidOut?: boolean | undefined;
  /** @see RiderMarker.hit */
  readonly hit?: RaceHitLook | undefined;
  /** The cadence turning its cranks, the rider's only. @see RidingInputs.cadence */
  readonly cadence?: number | undefined;
  /** Its live power, the rider's and the pacer's. @see RidingInputs.power */
  readonly power?: number | undefined;
  /** The grade under it, where the caller has one; otherwise the route's at its distance. */
  readonly grade?: number | undefined;
}

/**
 * The rider, and whichever of the bot and the ghost are in play — on their
 * line, leaning at their own speeds, and never drawn inside each other (#499).
 * The rider is always first.
 */
function ridersOnTheRoad(
  corridor: RoadCorridor,
  input: SceneInput,
  drawn: EasedPlace,
  line: RacingLine | undefined,
): readonly PlacedRider[] {
  // #1998: every rider is eased by the one rule the rider is, from their own
  // odometer and speed, so a pacer or a ghost level with the rider AND AT THEIR
  // SPEED is drawn level with them. #2427: at different speeds their lags
  // differ, and the drawn order is then kept to the odometers' by
  // `inOdometerOrder` below. Each one's cranks still turn from their own odometer.
  const easing = easingLine(input);
  const ease = (distance: number, speed: number): EasedPlace =>
    easing === undefined ? { distance, speed } : easedPlace(easing, distance, speed);
  // ⚠️ **The rider's crank angle is the only one that comes from outside this
  // file — #349, #368.** It is the integral of a cadence *reading*, which needs
  // a clock and the sensors, and `GameView` is where both are. The other two
  // are derived from their own odometers, which this file already has, because
  // a simulated rider has no cadence to read.
  const riders: Rider[] = [
    {
      kind: 'rider',
      distance: drawn.distance,
      odometer: input.riderDistance ?? input.state.ride.distance,
      speed: drawn.speed,
      ownSpeed: input.state.ride.speed,
      crankAngle: input.crankAngle,
      pedalling: input.pedalling === true,
      steered: input.steeredLateral,
      sway: input.steeredSway,
      swayRate: input.steeredSwayRate,
      hit: input.riderHit,
      // #1999: what the rider's drawn position is chosen from.
      cadence: input.cadence,
      power: input.state.input.live ? input.state.input.power : undefined,
      grade: input.state.grade,
      body: input.riderBody,
    },
  ];
  const bot = input.state.bot;
  if (input.botDistance !== undefined) {
    // The bot's own simulated speed, from the same step as its odometer.
    const place = ease(input.botDistance, bot?.state.speed ?? 0);
    riders.push({
      kind: 'bot',
      distance: place.distance,
      odometer: input.botDistance,
      speed: place.speed,
      ownSpeed: bot?.state.speed ?? 0,
      crankAngle: pedalling(input.botDistance),
      // #625: a simulated rider pedals while it moves — its cranks turn from
      // its odometer, so a stopped one's are still.
      pedalling: (bot?.state.speed ?? 0) > 0,
      // #1999: the pacer's simulated power and grade; it has no cadence.
      power: bot?.power,
      grade: bot?.grade,
      body: input.botBody,
    });
  }
  if (input.ghost !== undefined) {
    // ⚠️ The ghost is placed at where it had ridden **at this point in the
    // race**, which is what makes it a race rather than a replay running beside
    // you. After it finishes it stays at its finishing distance rather than
    // disappearing — a rider who beat it wants to see it behind them.
    //
    // ⚠️ **`ghostClock`, never `state.elapsed` — #254.** The two differ by
    // exactly the time a backgrounded phone stalled for, and reading the wall
    // clock here handed the ghost five minutes of road while the rider and the
    // bot covered ten seconds of it. `simulation.ts` §`ghostClock` states the
    // rule beside the bound that creates the difference.
    const clock: number = ghostClock(input.state);
    const at = ghostDistanceAt(input.ghost, seconds(clock));
    const speed = ghostSpeed(input.ghost, clock);
    const place = ease(at, speed);
    riders.push({
      kind: 'ghost',
      distance: place.distance,
      odometer: at,
      speed: place.speed,
      ownSpeed: speed,
      crankAngle: pedalling(at),
      pedalling: speed > 0,
      // #2839: the ghost is the rider's own earlier ride, so it is their body.
      body: input.riderBody,
    });
  }
  // #783: every other real rider in the room's drawn set — but only those on
  // the corridor this frame built. `markerAt` clamps a rider beyond it to its
  // far end, which is right for ONE pacer "somewhere up there" and would stack
  // a room's worth of riders on one spot on the horizon.
  const first = corridor.centre[0];
  const last = corridor.centre[corridor.centre.length - 1];
  for (const remote of input.remoteRiders ?? []) {
    if (first === undefined || last === undefined) break;
    // #2529: on the lap of the corridor they stand on, as a race's bots are
    // (#2516), so a rider a lap down or a lap up is drawn where they are on
    // the road. Ordered by it too (#2427), for the bots' reason.
    const odometer = onTheCorridorsLap(input.profile, remote.distanceMetres, first.along);
    // #1998: on the corridor by where they are DRAWN, which is where `markerAt` puts them.
    // The drawn place is never ahead of the odometer, so a rider whose odometer
    // is behind the corridor is behind it drawn too: skipped before the easing,
    // which is the cost of a frame in a crowded room.
    if (odometer < first.along) continue;
    const place = ease(odometer, remote.speedMetresPerSecond);
    // #2427: whether it is on the corridor is decided where it is drawn IN
    // ORDER, below, which may be a little further back or on than `place`.
    riders.push({
      kind: 'remote',
      distance: place.distance,
      odometer,
      speed: place.speed,
      ownSpeed: remote.speedMetresPerSecond,
      // ⚠️ From their own odometer at a fixed gear, never an invented rate: a
      // frame carries no cadence (`@onyourleft/protocol` §`FrameRider`), and
      // `bicycle.ts` §`simulatedCrankAngle` is the rule for a rider with none.
      crankAngle: pedalling(remote.distanceMetres),
      pedalling: remote.speedMetresPerSecond > 0,
      lane: remote.riderId % 2 === 0 ? -1 : 1,
      label: remote.label,
      followed: remote.followed,
      body: remote.body,
    });
  }
  // #1902: a lap race's bots, on the corridor this frame built, for the
  // remote riders' reason. #2516: each on the lap of the corridor it stands
  // on, so a bot a lap down or a lap up is drawn where it is on the road.
  for (const bot of input.raceBots ?? []) {
    if (first === undefined || last === undefined) break;
    const distance = onTheCorridorsLap(input.profile, bot.distanceMetres, first.along);
    if (distance < first.along || distance > last.along) continue;
    riders.push({
      kind: 'bot',
      distance,
      // #2427 orders the drawn riders by odometer: the one on the corridor's
      // lap (#2516), so a lapped bot is ordered where it is drawn, not a lap off.
      odometer: distance,
      speed: bot.speedMetresPerSecond,
      ownSpeed: bot.speedMetresPerSecond,
      crankAngle: pedalling(bot.distanceMetres),
      pedalling: bot.speedMetresPerSecond > 0,
      laned: bot.lateralMetres,
      // #2544: how fast the pack's layout is moving it across, which turns and leans it.
      sway: bot.swayMetresPerSecond,
      laidOut: bot.laidOut,
      hit: bot.hit,
      body: bot.body,
      skin: bot.skin,
    });
  }
  // #625: the ride's own clock, which a held or paused ride holds — never a
  // wall clock. @see RiderMarker.rideSeconds
  const rideClock: number = ghostClock(input.state);
  // #2427: eased, the drawn order is the odometers' order; and a room's rider
  // is on the corridor where it is drawn in that order (#1998's rule).
  const ordered = (easing === undefined ? riders : inOdometerOrder(riders, easing)).filter(
    (rider) =>
      rider.kind !== 'remote' ||
      first === undefined ||
      last === undefined ||
      (rider.distance >= first.along && rider.distance <= last.along),
  );
  return ordered.map((rider) => {
    const across = line === undefined ? STRAIGHT_DOWN_THE_MIDDLE : lateralOf(rider, ordered, line);
    const lateral = across.metres;
    // The COMBINED lean the physics asks for, split into the bicycle's and the
    // body's — #546. @see RiderMarker.lean
    // #2456: and a steered rider's lean into a lane change, on top of the bend's.
    const bend = line === undefined ? 0 : leanAt(line, rider.distance, rider.speed);
    const ridden = bicycleRoll(line === undefined ? 0 : withSteeringLean(rider, bend));
    // #2454: the rider's own crash in a Delivery round, drawn as a fall and a
    // getting back up, on top of the lean the ride asks for.
    const crash = rider.kind === 'rider' ? input.riderCrash : undefined;
    // The bicycle lands with weight, where motion is not reduced. @see crashRebound
    const roll =
      crash === undefined
        ? ridden
        : crashedRoll(
            ridden,
            crash.share,
            crash.side,
            crash.seconds === undefined ? 0 : crashRebound(crash.seconds),
          );
    // #2494: the bars turned by the steer the drawn path's turn asks for —
    // #2493: and let go of as the rider falls, straight on the ground and back
    // as they rise, as the stroke is.
    const steer = drawnSteer(rider, bend) * (1 - (crash?.share ?? 0));
    const placed = markerAt(corridor, rider.distance, rider.kind, across, roll, line, {
      // #625: the stroke's motion, faded out as a bend parks the cranks.
      pedalling: rider.pedalling ? pedallingShare(roll.bicycle) * (1 - (crash?.share ?? 0)) : 0,
      rideSeconds: rideClock,
      riding: ridingOf(rider, input.profile),
    });
    // Under a millionth of a radian is straight: `leanAt` leaves 10⁻¹⁹ on a straight.
    const steered = Math.abs(steer) < 1e-6 ? placed : { ...placed, steer };
    // #2493: and the body's own part of it, where motion is not reduced.
    // The clip on its own times, and the body's own share of it, which is not
    // the roll's. @see crashBodyShare
    const marker =
      crash?.seconds === undefined
        ? steered
        : {
            ...steered,
            crash: {
              seconds: crashClipSeconds(crash.seconds),
              side: crash.side,
              share: crashBodyShare(crash.seconds) ?? crash.share,
            },
          };
    // #546: in a bend tight enough for the inside pedal to strike, every
    // rider's cranks — the rider's own included, by the owner's ruling — are
    // DRAWN parked with the outside pedal down. @see drawnCrankAngle
    const crankAngle = drawnCrankAngle(rider.crankAngle, roll.bicycle);
    const turned = crankAngle === undefined ? marker : { ...marker, crankAngle };
    // #1902: a lap-race hit effect rides on the marker, so it is drawn where the rider is.
    const hit = rider.hit === undefined ? turned : { ...turned, hit: rider.hit };
    // #1971: a lap race's bot says so, apart from the one pacer, for the
    // realistic world's split. Only a race's bots are laned.
    const raced = rider.laned === undefined ? hit : { ...hit, racer: true as const };
    // #2839: which body, where one was given; absent draws the default.
    const bodied = rider.body === undefined ? raced : { ...raced, body: rider.body };
    // #3214: which skin tone, where one was given; absent draws the first.
    const cranked = rider.skin === undefined ? bodied : { ...bodied, skin: rider.skin };
    return {
      // #783: the name the room gave them, carried to the frame as words only.
      marker:
        rider.label === undefined
          ? cranked
          : {
              ...cranked,
              label: rider.label,
              ...(rider.followed === true ? { followed: true } : {}),
            },
      lateral,
    };
  });
}

/**
 * A race bot's drawn odometer moved by whole laps onto the lap that starts at
 * `from`, the corridor's first point — #2516. On a loop a race position is an
 * odometer on the rider's road, so a bot a lap down (or up) is a lap of
 * odometer from the rider while it stands on the same stretch of road: with
 * no move it is never on the corridor, and the rider lapping the field rode
 * up to an empty road. On a loop longer than the corridor a bot stands on it
 * once at most; on a shorter one it is drawn once, at its first place on it.
 * #2529: a room's riders are moved by the same rule, for the same reason.
 *
 * Its cranks still turn from its own odometer (`ridersOnTheRoad`), so a move
 * by a lap never jumps them. Unmoved on a road that is not a loop, and when
 * already on that lap, so the number is the one it was handed.
 */
function onTheCorridorsLap(profile: RouteProfile, distance: number, from: number): number {
  const lap: number = profile.totalDistance;
  if (!profile.loop || !(lap > 0) || !Number.isFinite(distance)) return distance;
  const laps = Math.floor((distance - from) / lap);
  return laps === 0 ? distance : distance - laps * lap;
}

/**
 * The least share of their odometer gap two riders are drawn apart by where
 * keeping their drawn order holds one of them — #2427: **a quarter**. Chosen,
 * and stated as a choice: more than nought, so a rider behind is drawn behind
 * (ADR 0038 D-3.4) and not level; small enough that riders at one speed are
 * never held by it: their drawn gap is at least 0.499 of their odometer gap on
 * a 10 m hairpin and 0.559 on a 120° corner drawn at one sample, at 20 to
 * 50 km/h and gaps to 30 m (measured for #2427); and a quarter of the draft's 30 m
 * reach (7.5 m) is still three bicycle lengths. ⚠️ With the lag bounded at
 * `MAX_LAG_METRES` (30 m) the drawn gap is never less than the odometer gap
 * less 30 m, so this holds nobody more than 40 m (30 / 0.75) from another.
 */
export const DRAWN_ORDER_SHARE = 0.25;

/**
 * The odometer gap past which a rider's drawn place is its own easing's and
 * nothing else — #2427: `MAX_LAG_METRES / (1 - DRAWN_ORDER_SHARE)`, 40 m. At
 * that gap the least drawn gap the order asks for (the share of the gap) is
 * what the bounded lags leave anyway.
 */
const ORDER_REACH_METRES = MAX_LAG_METRES / (1 - DRAWN_ORDER_SHARE);

/**
 * The riders of one eased frame, each drawn in its odometer's order — #2427.
 *
 * Each rider is eased by its own odometer and speed (`bend-easing.ts`), and
 * the lag grows with the speed, so through a bend a rider a few metres ahead
 * and faster can lag the one behind by more than the gap between them: drawn
 * BEHIND the rider whose draft they give, which ADR 0038 D-3.4's *"a rider
 * drawn behind another is behind them"* forbids. So, from the rider out:
 *
 * - **The rider is never moved.** The corridor and the chase camera are built
 *   round the rider's eased place (`drawnRider`), and a lone rider is exactly
 *   as before.
 * - **Each other rider**, nearest the rider first, takes on the lag of the one
 *   before it (the rider's, for the first) by a weight of 1 level with it,
 *   fading to 0 at {@link ORDER_REACH_METRES}; the lag it is drawn by is the
 *   blend of that and its own. With the lags at most `MAX_LAG_METRES` apart
 *   that leaves each at least {@link DRAWN_ORDER_SHARE} of its odometer gap
 *   ahead of (or behind) the one before it. Not a `min`/`max` with its own
 *   easing: that switches from one rider's lag to the other's at the instant
 *   their odometers cross, a 30 m jump in one frame.
 *
 * A rider is drawn no faster than its own drawn speed or the
 * steady-turn speed where it is drawn (`bend-easing.ts` §`steadyTurnSpeed`),
 * so it never leans past the easing's 25° (without that, held deeper into a
 * bend than its own easing put it, it leant 27.5° in `drawn-order.test.ts`).
 * Its place is continuous in every odometer, overtakes included, because the
 * blend's weight is, and so is the lean, which is read off that place and the
 * speed capped there. Draws only: no
 * odometer, no `k` and no trainer write reads this.
 */
function inOdometerOrder(riders: readonly Rider[], line: RacingLine): readonly Rider[] {
  const [anchor] = riders;
  if (anchor === undefined || riders.length < 2) return riders;
  const kept = [...riders];
  const others = kept.map((rider, index) => ({ rider, index })).slice(1);
  const ahead = others
    .filter((each) => each.rider.odometer >= anchor.odometer)
    .sort((one, other) => one.rider.odometer - other.rider.odometer);
  const behind = others
    .filter((each) => each.rider.odometer < anchor.odometer)
    .sort((one, other) => other.rider.odometer - one.rider.odometer);
  for (const run of [ahead, behind]) {
    let before: Rider = anchor;
    for (const { rider, index } of run) {
      const gap = Math.abs(rider.odometer - before.odometer);
      // The one before's lag, taken on by this rider by a weight of 1 level
      // with it, fading to 0 at ORDER_REACH_METRES: continuous in both
      // odometers, so no overtake jumps a place.
      const weight = Math.max(0, 1 - gap / ORDER_REACH_METRES);
      const lag =
        (1 - weight) * (rider.odometer - rider.distance) +
        weight * (before.odometer - before.distance);
      const distance = rider.odometer - lag;
      // Drawn no faster than the steady turn where it is drawn, so the lag it
      // took on never leans it past the easing's 25°.
      const placed: Rider = {
        ...rider,
        distance,
        speed: Math.min(rider.speed, steadyTurnSpeed(line, distance)),
      };
      kept[index] = placed;
      before = placed;
    }
  }
  return kept;
}

/**
 * What a rider is doing, for `posture.ts` — #1999: what it has of a cadence
 * and a power, the grade under it (the simulation's for the rider and the
 * pacer, the route's at its drawn distance for everyone else), and its own
 * speed — never the drawn one, which a bend eases and its exit hurries.
 */
function ridingOf(rider: Rider, profile: RouteProfile): RidingInputs {
  return {
    cadence: rider.cadence,
    power: rider.power,
    // #2516: wrapped first, as `gradeAt` wraps it anyway, so a negative drawn
    // distance on a loop never throws out of the frame (`metres` refuses one).
    // `lapRaceDrawing` holds its bots at nought or more since #2544, so a race
    // no longer hands one in; this keeps the frame safe for any that does.
    grade: rider.grade ?? gradeAt(profile, metres(distanceOnRoute(profile, rider.distance))),
    speed: rider.ownSpeed,
  };
}

/**
 * How level two riders are: 1 within a bicycle's length of each other, 0 at
 * {@link LEVEL_FADE_METRES} beyond it, and eased between.
 */
function levelness(one: Rider, other: Rider): number {
  const gap = Math.abs(other.distance - one.distance);
  return Math.min(
    1,
    Math.max(0, (BICYCLE_LENGTH_METRES + LEVEL_FADE_METRES - gap) / LEVEL_FADE_METRES),
  );
}

/**
 * How far across the road one rider is drawn: the line, eased toward
 * {@link LEVEL_LANES} by how level they are with the nearest other rider.
 *
 * `line·(1 − g·w) + lane·side·w`, where `w` is {@link levelness} with the
 * nearest other rider and `g` is {@link LINE_GIVEN_UP}. At `w = 1` that is at
 * most `2.9·0.69 + 1.2 = 3.2 m` from the centre, which is
 * {@link DRAWN_LIMIT_METRES}.
 *
 * A rider a Delivery round steered (#1820) is drawn in its steered place
 * exactly and gives up nothing, because that is the place the obstacles meet
 * it (`delivery/ride-round.ts`), so a crash is drawn as one (#1853). The others
 * make the room instead: each is eased, by its levelness with the steered
 * rider, toward a place at least {@link SIDE_BY_SIDE_METRES} from them on its
 * own side of them — the bot to the negative side, the ghost to the positive.
 * Within a bicycle's length, where the levelness is 1, it is there, so nobody
 * is drawn inside the rider; beyond, the bicycles are a length apart along the
 * road, #499's own rule — ahead of the rider. BEHIND them it is held there
 * until its front wheel is behind the camera's eye ({@link heldBehind}, #1863),
 * because nearer it is between the camera and the rider: let go at #499's fade,
 * it was drawn large in the foreground and swept across it to its own line.
 * Nobody jumps across the rider as they steer, because a side never changes
 * and every term is continuous. A lane is at most 1.75 m from the centre, so
 * that place is at most `1.75 + 1.2 = 2.95 m` out, inside
 * {@link DRAWN_LIMIT_METRES}.
 */
function lateralOf(rider: Rider, riders: readonly Rider[], line: RacingLine): Across {
  // #2456: a steered rider's place moves across the road as fast as it is
  // drawn swaying, so its bicycle turns into a lane change rather than sliding.
  if (rider.steered !== undefined) {
    return { metres: rider.steered, rate: laneChangeRate(rider.sway ?? 0, rider.speed) };
  }
  if (rider.laned !== undefined) {
    // #2544: a laned bot moving across the pack turns into the move; #2665: at
    // its own speed, so its heading follows the path it rides.
    return {
      metres: rider.laidOut === true ? rider.laned : lanedLateral(rider, rider.laned, riders, line),
      rate: laneChangeRate(rider.sway ?? 0, rider.speed, BOT_TURN_SPEED_FLOOR),
    };
  }
  let level = 0;
  for (const other of riders) {
    if (other === rider) continue;
    level = Math.max(level, levelness(rider, other));
  }
  const side = rider.lane ?? LEVEL_LANES[rider.kind];
  const kept = 1 - LINE_GIVEN_UP * level;
  const drawn = lineOffsetAt(line, rider.distance) * kept + side * SIDE_BY_SIDE_METRES * level;
  // #1995: the share of the line this rider keeps moves at that share of the
  // line's own rate.
  const drawnRate = lineSlopeAt(line, rider.distance) * kept;
  const steered = riders.find((other) => other.steered !== undefined);
  if (steered?.steered === undefined) return { metres: drawn, rate: drawnRate };
  const clear = steered.steered + side * SIDE_BY_SIDE_METRES;
  const aside = side < 0 ? Math.min(drawn, clear) : Math.max(drawn, clear);
  const held = Math.max(levelness(rider, steered), heldBehind(rider, steered));
  // A place held clear of the steered rider is theirs, and does not move as
  // this one rides on.
  const asideRate = aside === drawn ? drawnRate : 0;
  return {
    metres: drawn + (aside - drawn) * held,
    rate: drawnRate + (asideRate - drawnRate) * held,
  };
}

/**
 * `bend`, the combined lean a bend asks of `rider`, with what a steered
 * rider's lane change adds to it — #2456,
 * `lane-change-lean.ts` §`laneChangeLean` — held with the bend's inside
 * `racing-line.ts` §`MAXIMUM_LEAN_RADIANS`'s reach, so the two together never
 * lean past the tyres' grip. The bend's alone for every rider nobody steered.
 */
function withSteeringLean(rider: Rider, bend: number): number {
  // #2544: and a lap-race bot moving across the pack, as a steered rider does.
  if ((rider.steered === undefined && rider.laned === undefined) || rider.sway === undefined) {
    return bend;
  }
  const lean = bend + laneChangeLean(rider.sway, rider.speed);
  return Math.max(-MAXIMUM_LEAN_RADIANS, Math.min(MAXIMUM_LEAN_RADIANS, lean));
}

/**
 * The steer a rider's bars are drawn turned by, in radians, positive to the
 * right — #2494: `bicycle.ts` §`steerAngle` of the rate the drawn bicycle is
 * turning at, at the rider's own speed:
 *
 * - **through a bend**, the turn that holds `bend`, its combined lean
 *   (`racing-line.ts` §`leanAt`): `tan φ = v · ω / g`, so `ω = g tan φ / v`
 *   — a degree or two through an ordinary bend;
 * - **into a lane change**, a steered rider's, the rate its drawn heading
 *   turns at: the heading is `facingTurn(atan(laneChangeRate(sway, v)))`
 *   (#2456), so by the chain rule it turns at `facingTurn′ · (dsway/dt ÷ V) ÷
 *   (1 + rate²)`, with `V` the speed `laneChangeRate` divides by — about
 *   2.2 rad/s while the sway builds, nought while it holds, and back the
 *   other way as it settles, which is a bicycle steering into a move and out.
 *
 * Nought at a standstill. A drawing only.
 */
function drawnSteer(rider: Rider, bend: number): number {
  const speed = rider.speed;
  if (!(speed > 0)) return 0;
  let yawRate = (STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED * Math.tan(bend)) / speed;
  if (rider.steered !== undefined && rider.sway !== undefined && rider.swayRate !== undefined) {
    const drawnSpeed = Math.max(speed, LANE_CHANGE_TURN_SPEED_FLOOR);
    const rate = laneChangeRate(rider.sway, speed);
    const saturation = 1 / Math.cosh(Math.atan(rate) / FACING_TURN_LIMIT_RADIANS);
    yawRate += (saturation * saturation * (rider.swayRate / drawnSpeed)) / (1 + rate * rate);
  }
  return steerAngle(yawRate, speed);
}

/**
 * Where a rider is drawn across the road, and how fast that place moves —
 * #1995. @see lateralOf
 */
interface Across {
  /** Metres from the centreline, positive on the road's normal side. */
  readonly metres: number;
  /**
   * Metres sideways per metre ridden, the same sign: the line's own rate
   * ({@link lineSlopeAt}) for a rider on it, scaled by the share of it they
   * keep. Nought for a lap race's laned bot, whose place is not the line's.
   * A steered rider's (#2456) is its drawn sway over its speed,
   * `lane-change-lean.ts` §`laneChangeRate`: nought in a lane, toward the
   * move in a lane change.
   */
  readonly rate: number;
}

/** Every rider's place with the line switched off: on the centreline, not moving across it. */
const STRAIGHT_DOWN_THE_MIDDLE: Across = { metres: 0, rate: 0 };

/**
 * Where a lap-race bot is drawn across the road — #1902: in its lane
 * (`laned`), and moved aside only to make room for the rider, by
 * {@link lateralOf}'s rule for a steered rider: eased by levelness, and held
 * aside while just behind them ({@link heldBehind}), to the side of the rider
 * its LANE is on: a lane right of the centre is the positive side, any other the
 * negative, wherever the rider is, so a bot level with the rider never jumps
 * across them as they steer (the side is the lane's, not a comparison with the
 * rider's continuous place). A bot in the rider's own place goes outward from
 * it, not toward the centre. Never past {@link DRAWN_LIMIT_METRES}: a lane is at most 1.75 m out and the
 * rider at most {@link LINE_LIMIT_METRES}, and the bot is only ever moved
 * away from the rider toward its own side of them, which is at most
 * `1.75 + 1.2 = 2.95 m` out.
 *
 * ⚠️ Two bots level in ONE lane are drawn in one place: a lane is a race's
 * state (ADR 0060 D-6), and where they are drawn is where an item meets them.
 */
function lanedLateral(
  rider: Rider,
  laned: number,
  riders: readonly Rider[],
  line: RacingLine,
): number {
  const own = riders[0] as Rider;
  const ownLateral = lateralOf(own, riders, line).metres;
  const side = laned > 0 ? 1 : -1;
  const clear = ownLateral + side * SIDE_BY_SIDE_METRES;
  const aside = side < 0 ? Math.min(laned, clear) : Math.max(laned, clear);
  return laned + (aside - laned) * Math.max(levelness(rider, own), heldBehind(rider, own));
}

/**
 * How much of its place aside a rider behind a steered one keeps — #1863: 1 from
 * level with them back to {@link HELD_BEHIND_METRES}, 0 at
 * {@link LEVEL_FADE_METRES} beyond, eased between, and 0 for a rider ahead.
 */
function heldBehind(rider: Rider, steered: Rider): number {
  const behind = steered.distance - rider.distance;
  if (behind <= 0) return 0;
  return Math.min(
    1,
    Math.max(0, (HELD_BEHIND_METRES + LEVEL_FADE_METRES - behind) / LEVEL_FADE_METRES),
  );
}

/**
 * How fast the ghost was going at this point of its attempt, in metres a
 * second: the replayed distance across a second either side. #499 asks for
 * exactly this — a recording carries distance against time, and the lean needs
 * a speed; a replay is not re-simulated (`packages/domain/src/ghost/replay.ts`).
 * At the attempt's start and finish the window is one-sided, and at rest it is
 * nought, which is no lean.
 */
function ghostSpeed(ghost: GhostTrack, clock: number): number {
  const before = Math.max(0, clock - GHOST_SPEED_HALF_WINDOW_SECONDS);
  const after = clock + GHOST_SPEED_HALF_WINDOW_SECONDS;
  const covered =
    (ghostDistanceAt(ghost, seconds(after)) as number) -
    (ghostDistanceAt(ghost, seconds(before)) as number);
  return after > before ? Math.max(0, covered / (after - before)) : 0;
}

/**
 * A simulated rider's crank angle, from its own odometer — #368. A named
 * wrapper for `bicycle.ts` §`simulatedCrankAngle`, which is where the fixed
 * gear, and no invented rate, is argued.
 *
 * ⚠️ **Handed the rider's unwrapped distance, never where its marker ends up.**
 * {@link markerAt} clamps a bot or a ghost far up the road to the corridor's
 * far end, and since #499 moves it across the road too; cranks taken from the
 * drawn place would freeze while the rider it belongs to kept riding, which is
 * a claim that a bot beyond the horizon has stopped pedalling. Until #499 this
 * took the marker and returned it with its cranks set; it takes the distance
 * alone now, so the clamped position is not even in reach.
 */
function pedalling(atDistance: number): number {
  return simulatedCrankAngle(atDistance);
}

/** Half the window {@link ghostSpeed} differences the replay over: half a second. */
const GHOST_SPEED_HALF_WINDOW_SECONDS = 0.5;

/**
 * Which way a rider faces at `atDistance` — #1995, #2017: the road's own
 * direction under its bicycle, turned by {@link facingTurn} of the angle its
 * place across the road moves at off that direction.
 *
 * The road's direction is the centreline's chord from half of
 * {@link BICYCLE_LENGTH_METRES} behind `atDistance` to half of it ahead — where
 * the rear and front wheels are along the road. The angle is `atan(rate)`: the
 * rear wheel to the front moves `rate` across the road per metre along it
 * (`racing-line.ts` §`lineSlopeAt`, the line's chord over the same bicycle).
 *
 * ⚠️ **The chord is continuous in distance, and the corridor segment's heading
 * is not.** The corridor is rebuilt around the rider every frame
 * (`terrain.ts` §`roadCorridor`), and a segment's heading turns by a whole
 * segment's worth at each of its points — 14° in a radius-8 hairpin. The rider
 * sits on a point by construction and never crosses one, but a bot or a ghost a
 * metre or more away does. Until #2017 the hold was taken off that heading, so
 * near the hold, where the hold's own turn no longer cancels the step, such a
 * marker turned by up to 7° in a single 2 cm step. A chord between two places
 * interpolated along the corridor slides past a point without a step.
 *
 * ⚠️ One normal for both wheels, the chord's — #2001's review left open whether
 * each wheel should sit on its own segment's normal. Only where a corridor
 * point falls between the wheels do the two differ, and there a per-segment
 * normal is exactly what steps.
 *
 * Where the chord has no length — a one-point corridor, or both wheels clamped
 * past its far end — it is `fallback`, the segment's heading, unturned.
 */
function facingAt(
  corridor: RoadCorridor,
  atDistance: number,
  across: Across,
  fallback: { readonly headingX: number; readonly headingZ: number },
): { readonly headingX: number; readonly headingZ: number } {
  const half = BICYCLE_LENGTH_METRES / 2;
  const rear = placeOnCorridor(corridor, atDistance - half);
  const front = placeOnCorridor(corridor, atDistance + half);
  const dx = front.x - rear.x;
  const dz = front.z - rear.z;
  const chord = Math.hypot(dx, dz);
  if (chord < 1e-9) return fallback;
  const roadX = dx / chord;
  const roadZ = dz / chord;
  // ⚠️ The turn is positive toward the road's normal `(−headingZ, headingX)`,
  // the side `across.metres` and `across.rate` count positive on.
  const turn = facingTurn(Math.atan(across.rate));
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { headingX: roadX * cos - roadZ * sin, headingZ: roadZ * cos + roadX * sin };
}

/**
 * A marker on the road at a distance.
 *
 * ⚠️ Clamped to the corridor rather than extrapolated. A bot or ghost far enough
 * ahead to be outside the built corridor is drawn at its far end rather than
 * floating in space beyond it — the rider learns "it is somewhere up there",
 * which is true, and the exact gap is the HUD's job (#94) and is a number rather
 * than a position.
 */
function markerAt(
  corridor: RoadCorridor,
  atDistance: number,
  kind: RiderMarker['kind'],
  across: Across,
  roll: RiderRoll,
  line: RacingLine | undefined,
  motion: Pick<RiderMarker, 'pedalling' | 'rideSeconds' | 'riding'>,
): RiderMarker {
  const at = placeOnCorridor(corridor, atDistance);
  if (line !== undefined && isDrawnLine(line)) {
    // #2422: ON the drawn path, facing along it, and moved off it only by
    // what keeps level riders apart (@see lateralOf), along the path's own
    // normal. The rider alone is exactly on it.
    // Clamped to the corridor, as `placeOnCorridor` clamps: a bot far up the
    // road is drawn at its far end, "somewhere up there".
    const on = drawnLineAt(line, clampedTo(corridor, atDistance));
    const aside = across.metres - lineOffsetAt(line, atDistance);
    const facing = turnedBy(on, facingTurn(Math.atan(across.rate - lineSlopeAt(line, atDistance))));
    // #3061's review: moved with the road where the road was moved, so a bot
    // already round a turnaround is drawn on the road laid along the rider's
    // pass, not on its own pass's place beside it.
    const shift = movedBy(corridor, atDistance);
    const x = on.x - on.headingZ * aside + shift.x;
    const z = on.z + on.headingX * aside + shift.z;
    return {
      kind,
      x,
      // #2422's review: at the road's height WHERE it is drawn. The pacing
      // puts it a few metres along the road from its odometer in a corner,
      // and read at the odometer it floated 0.3 m over a climbing junction.
      y: drawnHeight(corridor, line, atDistance, { x, z }),
      z,
      headingX: facing.headingX,
      headingZ: facing.headingZ,
      lean: roll.bicycle,
      bodyLean: roll.body,
      pedalling: motion.pedalling,
      rideSeconds: motion.rideSeconds,
      riding: motion.riding,
    };
  }
  // ⚠️ The road's heading at **this** marker's own distance, not the
  // camera's — #349. @see RiderMarker.headingX
  const road = headingAt(corridor, at.index);
  const lateral = across.metres;
  // ⚠️ #1995: the marker FACES the way its bicycle points, from where its
  // rear wheel is to where its front wheel is, half a bicycle behind and
  // ahead on the road, each across the road by the line's chord rate
  // (`racing-line.ts` §`lineSlopeAt`) — not the road's heading, which slid a
  // rider crossing the road sideways. No step where the line reaches the
  // road's edge, and since #2017 none where a marker crosses a corridor
  // point: `facingAt` says why that needs the road's chord, not `road`.
  // ⚠️ But turned at most FACING_TURN_LIMIT_RADIANS off the road, by a smooth
  // saturation: where a hairpin's line swings across the road within a few
  // metres that direction is 40°+ off the road, and was drawn side-on to it
  // (#1995's review on the owner's course). A pure function of distance, so
  // frame-rate independent, and every rider's marker is placed here, bots
  // included.
  const facing = facingAt(corridor, atDistance, across, road);
  // #499: across the road along its own normal, `(−headingZ, headingX)` —
  // the rider's right, on the screen and since #583 on the map (it was called
  // the left until then) — and at the road's
  // height, which is flat across its width (`ribbonNormals` says why).
  return {
    kind,
    x: at.x - road.headingZ * lateral,
    y: at.y,
    z: at.z + road.headingX * lateral,
    headingX: facing.headingX,
    headingZ: facing.headingZ,
    lean: roll.bicycle,
    bodyLean: roll.body,
    pedalling: motion.pedalling,
    rideSeconds: motion.rideSeconds,
    riding: motion.riding,
  };
}

/**
 * How far from the drawn road's centreline the chase camera's eye stands
 * unheld on a drawn path, and how much further it may go, in metres: **2.0**
 * and **0.5** — #2422. @see eyeOnDrawnPath
 */
const EYE_HELD_FROM_METRES = 2;
const EYE_HELD_ROOM_METRES = 0.5;

/**
 * Where the chase camera's eye stands on a drawn path — #2422: the path's own
 * place at `atDistance`, which is the chase distance behind the rider, moved
 * in toward the centreline where the path is near the kerb, by a smooth
 * saturation `from + room · tanh((|offset| − from) / room)` beyond
 * {@link EYE_HELD_FROM_METRES}, so it is never more than 2.5 m out and has no
 * kink where it starts to be held. Before the start of a point-to-point route
 * — the first few metres of a ride — it stands straight back from the path's
 * first place, as it stood straight back from the rider before.
 *
 * ⚠️ **Why on the path, and why held.** Before #2422 the eye stood straight
 * back along the ROAD from the rider, and stepped sideways at every corridor
 * point the road turns at: through a jittered junction the camera turned at
 * its 90°/s cap (`drawn-line.test.ts`). On the path it turns with the rider.
 * But the line takes the rider to 2.9 m from the centre at a bend's apex, and
 * an eye there, 0.6 m from the edge of the carriageway, put a lamp post on the
 * pavement of a planner's bend inside a 6 : 1 frame's near plane
 * (`near-field-street.test.ts`). Wherever the line is nearer the centre than
 * 2 m — every straight, where it holds 1.75 m — the eye is exactly on the path.
 */
function eyeOnDrawnPath(path: DrawnLine, atDistance: number): DrawnPoint {
  const before = path.profile.loop ? 0 : Math.min(0, atDistance);
  const start = drawnLineAt(path, atDistance - before);
  const on = {
    ...start,
    x: start.x + start.headingX * before,
    z: start.z + start.headingZ * before,
  };
  const road = drawnRoadFrame(path.profile, corridorOrigin(path.profile), atDistance - before);
  if (road === undefined) return on;
  const offset = (on.x - road.x) * road.normalX + (on.z - road.z) * road.normalZ;
  const out = Math.abs(offset) - EYE_HELD_FROM_METRES;
  if (!(out > 0)) return on;
  const held =
    Math.sign(offset) *
    (EYE_HELD_FROM_METRES + EYE_HELD_ROOM_METRES * Math.tanh(out / EYE_HELD_ROOM_METRES));
  return {
    ...on,
    x: on.x + (held - offset) * road.normalX,
    z: on.z + (held - offset) * road.normalZ,
  };
}

/**
 * The road's height directly under a point drawn on `path` for drawn odometer
 * `atDistance` — #2422's review. From where along the road the path says it is
 * (@see drawnPlaceOf), the place is moved along the corridor by how far the
 * point is ahead of the corridor's point there, {@link HEIGHT_STEPS} times, so
 * the height is the corridor's at the point nearest it in plan: the pacing
 * moves a rider metres along the road within one profile sample at a corner,
 * which no table of samples follows closely enough.
 */
function drawnHeight(
  corridor: RoadCorridor,
  path: DrawnLine,
  atDistance: number,
  point: { readonly x: number; readonly z: number },
): number {
  const estimate = drawnPlaceOf(path, atDistance);
  let along = clampedTo(corridor, estimate);
  for (let step = 0; step < HEIGHT_STEPS; step += 1) {
    const here = placeOnCorridor(corridor, along);
    const road = headingAt(corridor, here.index);
    const moved = along + (point.x - here.x) * road.headingX + (point.z - here.z) * road.headingZ;
    // Never far from where the path says it is, so a sharp bend's other leg,
    // nearer in plan, is never the road read.
    along = clampedTo(
      corridor,
      Math.min(estimate + HEIGHT_REACH_METRES, Math.max(estimate - HEIGHT_REACH_METRES, moved)),
    );
  }
  return placeOnCorridor(corridor, along).y;
}

/** How many steps along the corridor {@link drawnHeight} takes: **4**. */
const HEIGHT_STEPS = 4;

/**
 * The most {@link drawnHeight} moves from the path's own place, in metres:
 * **4**. The pacing's shift between two samples is a few metres through a
 * corner, which a table of samples cannot follow closely enough, and more
 * than that is the other leg of a sharp bend.
 */
const HEIGHT_REACH_METRES = 4;

/** An odometer reading held inside the corridor's first and last points, as {@link placeOnCorridor} holds a place. */
function clampedTo(corridor: RoadCorridor, atDistance: number): number {
  const first = corridor.centre[0];
  const last = corridor.centre[corridor.centre.length - 1];
  if (first === undefined || last === undefined) return atDistance;
  return Math.min(last.along, Math.max(first.along, atDistance));
}

/** A heading turned by `turn` radians toward its normal `(−headingZ, headingX)`. */
function turnedBy(
  heading: Pick<DrawnPoint, 'headingX' | 'headingZ'>,
  turn: number,
): { readonly headingX: number; readonly headingZ: number } {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return {
    headingX: heading.headingX * cos - heading.headingZ * sin,
    headingZ: heading.headingZ * cos + heading.headingX * sin,
  };
}

/** A position on the corridor, and the centreline point it follows. */
interface CorridorPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * The index of the point at or before it, for a caller that needs the road's
   * direction there. Never the last index, so `index + 1` is always a point.
   */
  readonly index: number;
}

/**
 * Where an odometer reading falls on the corridor, **between** its points.
 *
 * ⚠️ **Matched on `CorridorPoint.along`, which is unwrapped, and never on
 * `CorridorPoint.distance`, which is not — #253.** Every distance that reaches
 * this file is an odometer: the rider's from the simulation, the bot's from
 * `advanceBot`, the ghost's from a replay of recorded distance. `distance`
 * wraps into `[0, totalDistance]`, so on a loop every corridor point compared
 * smaller than an odometer past the wrap and the search returned the far end
 * for **every** rider — the bot and the rider drawn at one point from lap two
 * onward, which is the case the pacer exists for.
 *
 * The fix is on this side deliberately. Wrapping the odometer instead would
 * place the markers correctly and break the HUD gap in the same motion, because
 * `pacer/gap.ts` is right that a bot a lap ahead must read as a lap ahead.
 *
 * ⚠️ **It interpolates, where until #323 it returned the NEAREST point.** The
 * corridor samples the road about every ten metres, so a nearest-point lookup
 * quantised every marker to that grid: a bot that gained two metres gained
 * nothing on screen, and then jumped ten. The rider's own marker hid it — the
 * corridor is built *from* the rider's distance, so a point lands on the rider
 * by construction — and that is exactly why the bot and the ghost were the
 * riders that stepped. It is also what would have thrown away #323's other
 * half: a distance interpolated between two simulation steps is a centimetre
 * at a time, and the next function down was rounding it to ten metres.
 *
 * Clamped rather than extrapolated at both ends, which is what
 * {@link markerAt} promises and what keeps a bot far up the road on the road.
 */
function placeOnCorridor(corridor: RoadCorridor, atDistance: number): CorridorPlacement {
  return placeAlong(corridor.centre, atDistance);
}

/**
 * How far the road at a distance was moved in plan from its own place, metres
 * — #3061's review: none unless {@link RoadCorridor.unmoved} is given, where
 * `terrain.ts` §`towardTheRidersPass` laid the far pass along the rider's.
 */
function movedBy(
  corridor: RoadCorridor,
  atDistance: number,
): { readonly x: number; readonly z: number } {
  if (corridor.unmoved === undefined) return NOT_MOVED;
  const drawn = placeAlong(corridor.centre, atDistance);
  const own = placeAlong(corridor.unmoved, atDistance);
  return { x: drawn.x - own.x, z: drawn.z - own.z };
}

const NOT_MOVED = { x: 0, z: 0 } as const;

/** {@link placeOnCorridor} on a list of corridor points. */
function placeAlong(centre: readonly CorridorPoint[], atDistance: number): CorridorPlacement {
  const last = centre.length - 1;
  if (last <= 0) {
    // A one-point corridor has nothing to interpolate along. `cameraPose`'s own
    // degenerate-heading case, and it must not divide by a zero span.
    const only = centre[0] as CorridorPoint;
    return { x: only.x, y: only.y, z: only.z, index: 0 };
  }
  let index = 0;
  for (let candidate = 0; candidate < last; candidate += 1) {
    if ((centre[candidate] as CorridorPoint).along > atDistance) {
      break;
    }
    index = candidate;
  }
  const from = centre[index] as CorridorPoint;
  const to = centre[index + 1] as CorridorPoint;
  const span = to.along - from.along;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (atDistance - from.along) / span)) : 0;
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + (to.z - from.z) * fraction,
    index,
  };
}

/**
 * Whether the ghost has already finished, for a HUD that wants to say so.
 *
 * ⚠️ Against {@link ghostClock} like every other ghost question (#254), so a
 * stalled ride cannot declare the attempt finished while its marker is still
 * halfway up the road.
 *
 * Its consumer is `game/ghost-outcome.ts`, and it did not have one until #259:
 * this function was exported, unit-tested and green while the HUD went on
 * quoting a gap against an attempt that had stopped. That header says why the
 * answer is latched there rather than read afresh here.
 */
export function ghostFinished(ghost: GhostTrack, state: GameState): boolean {
  return ghostHasFinished(ghost, ghostClock(state));
}
