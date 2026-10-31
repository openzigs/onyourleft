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

import type { UnitSystem } from '@onyourleft/store';

import { billboardsAt, clearOfBillboards, nearestBillboards, type Billboard } from './billboards';
import { lineStands, linesNear } from './gantry';
import { ghostDistanceAt, ghostHasFinished, seconds, type GhostTrack } from '@onyourleft/domain';

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  RIDER_HALF_WIDTH_METRES,
  bicycleRoll,
  drawnCrankAngle,
  pedallingShare,
  simulatedCrankAngle,
  type RiderRoll,
} from './bicycle';
import {
  countrysideWithout,
  NO_LAND_CLASS,
  type CountrysideLever,
  type LandClassMask,
} from './land-class';
import { horizonRelief, terrainCorridor } from './landform';
import { CAMERA_BEHIND_METRES, CAMERA_TARGET_AHEAD_METRES } from './camera';
import type { CameraPose, RaceHitLook, RiderMarker, SceneFrame, WaterFrame } from './port';
import { SCATTER_MAX_ITEMS, scatterAt, scatterSeed, type ScatterItem } from './scatter';
import {
  LINE_LIMIT_METRES,
  leanAt,
  lineOffsetAt,
  racingLine,
  type RacingLine,
} from './racing-line';
import { ghostClock, type GameState } from './simulation';
import {
  ROAD_WIDTH_METRES,
  roadCorridor,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import {
  NO_MAPPED_TOWN,
  STRUCTURE_MAX_ITEMS,
  clearOfBuildings,
  clearOfSettlements,
  structuresAt,
  type MappedTown,
  type SettlementFootprint,
} from './settlements';
import {
  boardsClearOfSideRoads,
  clearOfSideRoads,
  mappedJunctions,
  sideRoadsAt,
  type SideRoad,
} from './cross-streets';
import { NO_PAVEMENT_DATA, pavementSides } from './footways';
import { BILLBOARD_FOOTPRINT } from './logo-board';
import {
  NO_PEOPLE,
  besideSideRoads,
  clearOfPavements,
  footwayWalks,
  groundOf,
  peopleAt,
  streetWalks,
  type PeopleInView,
} from './people';
import { distanceToDrawnRoad } from './road-grid';
import { streetsAt, type VillageStreet } from './streets';
import { bridgeParts, waterSurface, waterways } from './waterways';
import { worldStyle } from './world';
import type { WorldCorridor } from './world-data/corridor';
import {
  clearOfMappedBuildings,
  mappedChunk,
  type MappedBuildings,
  type MappedBuildingsInView,
} from './mapped-buildings';
import type { RouteProfile } from '@onyourleft/domain';

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
   * #1542's changes switched off, each restoring the countryside before it —
   * the realistic page's `-land-planting`, `-land-boundaries` and
   * `-ground-clutter` levers, and nothing else (`land-class.ts`
   * §`CountrysideLever`). Absent, or empty, is every change on. Optional the
   * safe way round, for {@link centreline}'s reason.
   */
  readonly countrysideOff?: readonly CountrysideLever[] | undefined;
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
}

/**
 * A lap-race bot, where to draw it — #1902. @see SceneInput.raceBots
 *
 * ⚠️ **Its distance is the DRAWN one** (ADR 0060 D-3.3: `effortDistance +
 * raceOffset`), as an odometer on this ride's road; what it rode is never
 * read here.
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
  /** Its hit effect, while one runs on it. @see RiderMarker.hit */
  readonly hit?: RaceHitLook | undefined;
}

/** Another real rider, where to draw them — #783. @see SceneInput.remoteRiders */
export interface RemoteRiderInput {
  /** The room's id for them, which decides their side of the road when level with another. */
  readonly riderId: number;
  /** Along the route, the room's odometer, in metres. */
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  /** What to write over them on the road, if anything. @see RiderMarker.label */
  readonly label?: string | undefined;
  /** The one rider *Follow* chose. @see RiderMarker.followed */
  readonly followed?: boolean | undefined;
}

/** Builds one frame. */
export function sceneFrame(input: SceneInput): SceneFrame {
  const riderDistance: number = input.riderDistance ?? input.state.ride.distance;
  const corridor = roadCorridor(input.profile, input.origin, riderDistance);
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
      : mappedJunctions(input.worldCorridor, input.profile, input.origin, seed);
  const sideRoads = sideRoadsAt(
    input.profile,
    input.origin,
    seed,
    (corridor.centre[0] as CorridorPoint).along,
    (corridor.centre[corridor.centre.length - 1] as CorridorPoint).along,
    riderDistance,
    junctions ?? [],
    input.landClass ?? NO_LAND_CLASS,
  );
  const { scatter: items, billboards } = scenery(corridor, input, riderDistance, seed, sideRoads);
  // #1535: the village streets along exactly the stretch of road this frame
  // drew, for `scenery`'s reason — and outside the structures' budget,
  // because a street is one mesh rather than items a rung could thin.
  const streets = streetsAt(
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
    // so this too is a lookup on every later frame.
    input.mappedTown?.urban,
    junctions,
  );
  const camera = cameraPose(corridor, riderDistance, (riders[0] as PlacedRider).lateral);
  return {
    // #1549: the ride's mapped buildings, and where the rider is among them.
    ...(input.mappedBuildings === undefined
      ? {}
      : { mappedBuildings: mappedInView(input.mappedBuildings, corridor, riderDistance) }),
    corridor,
    // The camera follows the rider sideways — their drawn place, not the line's
    // — so the rider stays where `camera.ts` §`riderFrameBox` says they are.
    camera,
    markers: riders.map((rider) => rider.marker),
    // Recomputed per frame rather than cached against the profile: it is two
    // bounded passes over at most `WORLD_SAMPLE_LIMIT` samples, and a cache
    // keyed on a profile is a second source of truth that a route change has
    // to remember to clear. `world.ts` says what the bound buys.
    world: worldStyle(input.profile),
    scatter: items,
    // #966: the billboards in view, out of the structures' budget.
    billboards,
    sideRoads,
    streets,
    // #1541: the people on those streets' pavements and the corridor's
    // footways, near the rider, at the ride's own clock.
    // #1619: and off the side roads, drawn or mapped, as off the road.
    people: people(input, streets, camera, seed, sideRoads),
    // #458. Built from the corridor just built, so the ground's innermost
    // column is the road's outermost one — `landform.ts` says why that is the
    // whole of the no-crack guarantee. Every band, whatever the rung: the
    // renderer draws a prefix of them (`three-renderer.ts` §`TerrainBelt`), so
    // the rung moves no vertex and the scenery stands on the same ground.
    terrain: {
      mesh: terrainCorridor(
        input.profile,
        input.origin,
        corridor,
        seed,
        input.landClass ?? NO_LAND_CLASS,
      ),
      horizon: horizonRelief(input.profile, input.origin, seed),
    },
    // #459. The waterways are found once per route (`waterways.ts` §`computed`)
    // and the surfaces and bridges built for this stretch of it, from the same
    // corridor the ground and the road are built from.
    water: water(input, corridor, seed),
    // #679: what stands at the lines, in the rider's units, near the rider.
    lines: linesNear(
      input.profile,
      corridor,
      riderDistance,
      lineStands(input.profile, input.units ?? 'metric'),
    ),
  };
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
  return peopleAt(lines, {
    x: camera.x,
    z: camera.z,
    seconds: ghostClock(input.state),
    near,
    rule,
    // #1619: nobody on a side road this frame draws, either.
    road: besideSideRoads(road, sideRoads),
    ground: groundOf(profile, origin, seed, land),
  });
}

/** The streams, lakes and bridges in view. @see SceneFrame.water */
function water(input: SceneInput, corridor: RoadCorridor, seed: number): WaterFrame {
  const ways = waterways(input.profile, seed);
  return {
    surface: waterSurface(input.profile, input.origin, corridor, ways),
    bridges: bridgeParts(input.profile, input.origin, corridor, ways),
    seconds: input.state.elapsed,
  };
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
  );
  // #966. The billboards come out of the structures' budget FIRST: a rung that
  // takes structures away takes them too, and none is ever extra.
  const structureBudget = Math.max(0, input.structureItems ?? STRUCTURE_MAX_ITEMS);
  // #1565: and none on a side road.
  const billboards = boardsClearOfSideRoads(
    nearestBillboards(
      billboardsAt(input.profile, input.origin, seed, first.along, last.along),
      riderDistance,
      structureBudget,
    ),
    sideRoads,
    BILLBOARD_FOOTPRINT,
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
  // #1565: no wall, hedge, fence, signpost or building on a side road, and no
  // tree, shrub or rock either.
  const built = clearOfSideRoads(placed, sideRoads);
  // #1549: and off every mapped building's ground, by #1534's rule — whose
  // control (`settlementsWooded`) leaves both standing.
  const cleared = clearOfSideRoads(
    input.settlementsWooded === true
      ? natural
      : clearOfMappedBuildings(
          clearOfSettlements(natural, footprints, land),
          input.mappedBuildings,
        ),
    sideRoads,
  );
  return {
    scatter: [...built, ...clearOfBillboards(clearOfBuildings(cleared, built), billboards)],
    billboards,
  };
}

/** The mapped buildings, with the rider's chunk and drawn place. @see SceneFrame.mappedBuildings */
function mappedInView(
  buildings: MappedBuildings,
  corridor: RoadCorridor,
  riderDistance: number,
): MappedBuildingsInView {
  const here = placeOnCorridor(corridor, riderDistance);
  return { buildings, chunk: mappedChunk(riderDistance), x: here.x, z: here.z };
}

/**
 * Where the chase camera looks from.
 *
 * `lateralMetres` is how far across the road the rider is drawn, positive on
 * the road's own normal side (#499); the camera is moved across with them.
 *
 * The heading is taken from the corridor's own centreline rather than from a
 * stored bearing, so the camera and the road cannot disagree: if the corridor
 * turns, the camera turns with it by construction. A separately-computed bearing
 * is the kind of second source of truth that drifts by a frame and reads as the
 * camera lagging the corner.
 */
export function cameraPose(
  corridor: RoadCorridor,
  atDistance: number,
  lateralMetres: number,
): CameraPose {
  const here = placeOnCorridor(corridor, atDistance);
  const heading = headingAt(corridor, here.index);
  return {
    // #499: moved across the road by as much as the rider is, along the road's
    // own normal, and NOT turned: the camera still looks down the road, and it
    // does not roll with the lean (out of scope, and a rolling horizon on a
    // phone is the fastest way to make somebody feel ill).
    x: here.x - heading.headingZ * lateralMetres,
    y: here.y,
    z: here.z + heading.headingX * lateralMetres,
    ...heading,
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
    eyeRoadY: placeOnCorridor(corridor, atDistance - CAMERA_BEHIND_METRES).y,
    targetRoadY: placeOnCorridor(corridor, atDistance + CAMERA_TARGET_AHEAD_METRES).y,
  };
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
  const riderDistance: number = input.riderDistance ?? input.state.ride.distance;
  // #499. Computed once per route and cached against the profile object
  // (`racing-line.ts` §`racingLine`), so this is the first frame's cost only.
  const line = input.centreline === true ? undefined : racingLine(input.profile);
  return ridersOnTheRoad(corridor, input, riderDistance, line);
}

/** A rider on the road, and how far across it they were drawn. */
export interface PlacedRider {
  readonly marker: RiderMarker;
  /** Metres across the road from the centreline, positive on the normal's side. */
  readonly lateral: number;
}

/** One rider before it is placed: who, how far, and how fast. */
interface Rider {
  readonly kind: RiderMarker['kind'];
  readonly distance: number;
  readonly speed: number;
  readonly crankAngle: number | undefined;
  /** Whether a reading turns this rider's cranks, before a bend parks them. @see RiderMarker.pedalling */
  readonly pedalling: boolean;
  /** The side of the line it moves to when level, where the kind's is not enough. @see LEVEL_LANES */
  readonly lane?: number | undefined;
  /** Where a Delivery round steered it, in place of the line — the rider's only. @see SceneInput.steeredLateral */
  readonly steered?: number | undefined;
  /** A remote rider's name on the road. @see RiderMarker.label */
  readonly label?: string | undefined;
  /** @see RiderMarker.followed */
  readonly followed?: boolean | undefined;
  /** A lap-race bot's lane, across the road, in place of the line. @see RaceBotInput.lateralMetres */
  readonly laned?: number | undefined;
  /** @see RiderMarker.hit */
  readonly hit?: RaceHitLook | undefined;
}

/**
 * The rider, and whichever of the bot and the ghost are in play — on their
 * line, leaning at their own speeds, and never drawn inside each other (#499).
 * The rider is always first.
 */
function ridersOnTheRoad(
  corridor: RoadCorridor,
  input: SceneInput,
  riderDistance: number,
  line: RacingLine | undefined,
): readonly PlacedRider[] {
  // ⚠️ **The rider's crank angle is the only one that comes from outside this
  // file — #349, #368.** It is the integral of a cadence *reading*, which needs
  // a clock and the sensors, and `GameView` is where both are. The other two
  // are derived from their own odometers, which this file already has, because
  // a simulated rider has no cadence to read.
  const riders: Rider[] = [
    {
      kind: 'rider',
      distance: riderDistance,
      speed: input.state.ride.speed,
      crankAngle: input.crankAngle,
      pedalling: input.pedalling === true,
      steered: input.steeredLateral,
      hit: input.riderHit,
    },
  ];
  const bot = input.state.bot;
  if (input.botDistance !== undefined) {
    riders.push({
      kind: 'bot',
      distance: input.botDistance,
      // The bot's own simulated speed, from the same step as its odometer.
      speed: bot?.state.speed ?? 0,
      crankAngle: pedalling(input.botDistance),
      // #625: a simulated rider pedals while it moves — its cranks turn from
      // its odometer, so a stopped one's are still.
      pedalling: (bot?.state.speed ?? 0) > 0,
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
    riders.push({
      kind: 'ghost',
      distance: at,
      speed,
      crankAngle: pedalling(at),
      pedalling: speed > 0,
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
    if (remote.distanceMetres < first.along || remote.distanceMetres > last.along) continue;
    riders.push({
      kind: 'remote',
      distance: remote.distanceMetres,
      speed: remote.speedMetresPerSecond,
      // ⚠️ From their own odometer at a fixed gear, never an invented rate: a
      // frame carries no cadence (`@onyourleft/protocol` §`FrameRider`), and
      // `bicycle.ts` §`simulatedCrankAngle` is the rule for a rider with none.
      crankAngle: pedalling(remote.distanceMetres),
      pedalling: remote.speedMetresPerSecond > 0,
      lane: remote.riderId % 2 === 0 ? -1 : 1,
      label: remote.label,
      followed: remote.followed,
    });
  }
  // #1902: a lap race's bots, on the corridor this frame built, for the
  // remote riders' reason.
  for (const bot of input.raceBots ?? []) {
    if (first === undefined || last === undefined) break;
    if (bot.distanceMetres < first.along || bot.distanceMetres > last.along) continue;
    riders.push({
      kind: 'bot',
      distance: bot.distanceMetres,
      speed: bot.speedMetresPerSecond,
      crankAngle: pedalling(bot.distanceMetres),
      pedalling: bot.speedMetresPerSecond > 0,
      laned: bot.lateralMetres,
      hit: bot.hit,
    });
  }
  // #625: the ride's own clock, which a held or paused ride holds — never a
  // wall clock. @see RiderMarker.rideSeconds
  const rideClock: number = ghostClock(input.state);
  return riders.map((rider) => {
    const lateral = line === undefined ? 0 : lateralOf(rider, riders, line);
    // The COMBINED lean the physics asks for, split into the bicycle's and the
    // body's — #546. @see RiderMarker.lean
    const roll = bicycleRoll(line === undefined ? 0 : leanAt(line, rider.distance, rider.speed));
    const marker = markerAt(corridor, rider.distance, rider.kind, lateral, roll, {
      // #625: the stroke's motion, faded out as a bend parks the cranks.
      pedalling: rider.pedalling ? pedallingShare(roll.bicycle) : 0,
      rideSeconds: rideClock,
    });
    // #546: in a bend tight enough for the inside pedal to strike, every
    // rider's cranks — the rider's own included, by the owner's ruling — are
    // DRAWN parked with the outside pedal down. @see drawnCrankAngle
    const crankAngle = drawnCrankAngle(rider.crankAngle, roll.bicycle);
    const turned = crankAngle === undefined ? marker : { ...marker, crankAngle };
    // #1902: a lap-race hit effect rides on the marker, so it is drawn where the rider is.
    const cranked = rider.hit === undefined ? turned : { ...turned, hit: rider.hit };
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
function lateralOf(rider: Rider, riders: readonly Rider[], line: RacingLine): number {
  if (rider.steered !== undefined) return rider.steered;
  if (rider.laned !== undefined) return lanedLateral(rider, rider.laned, riders, line);
  let level = 0;
  for (const other of riders) {
    if (other === rider) continue;
    level = Math.max(level, levelness(rider, other));
  }
  const side = rider.lane ?? LEVEL_LANES[rider.kind];
  const drawn =
    lineOffsetAt(line, rider.distance) * (1 - LINE_GIVEN_UP * level) +
    side * SIDE_BY_SIDE_METRES * level;
  const steered = riders.find((other) => other.steered !== undefined);
  if (steered?.steered === undefined) return drawn;
  const clear = steered.steered + side * SIDE_BY_SIDE_METRES;
  const aside = side < 0 ? Math.min(drawn, clear) : Math.max(drawn, clear);
  return drawn + (aside - drawn) * Math.max(levelness(rider, steered), heldBehind(rider, steered));
}

/**
 * Where a lap-race bot is drawn across the road — #1902: in its lane
 * (`laned`), and moved aside only to make room for the rider, by
 * {@link lateralOf}'s rule for a steered rider: eased by levelness, and held
 * aside while just behind them ({@link heldBehind}), to the side of the rider
 * its lane is on (toward the centre when it is in the rider's own place).
 * Never past {@link DRAWN_LIMIT_METRES}: a lane is at most 1.75 m out and the
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
  const ownLateral = lateralOf(own, riders, line);
  const side = laned > ownLateral ? 1 : -1;
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
  lateral: number,
  roll: RiderRoll,
  motion: Pick<RiderMarker, 'pedalling' | 'rideSeconds'>,
): RiderMarker {
  const at = placeOnCorridor(corridor, atDistance);
  // ⚠️ The heading is the road's at **this** marker's own distance, not the
  // camera's — #349. @see RiderMarker.headingX
  const heading = headingAt(corridor, at.index);
  // #499: across the road along its own normal, `(−headingZ, headingX)` —
  // the rider's right, on the screen and since #583 on the map (it was called
  // the left until then) — and at the road's
  // height, which is flat across its width (`ribbonNormals` says why).
  return {
    kind,
    x: at.x - heading.headingZ * lateral,
    y: at.y,
    z: at.z + heading.headingX * lateral,
    ...heading,
    lean: roll.bicycle,
    bodyLean: roll.body,
    pedalling: motion.pedalling,
    rideSeconds: motion.rideSeconds,
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
  const centre = corridor.centre;
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
