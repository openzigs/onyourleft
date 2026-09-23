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

import { ghostDistanceAt, ghostHasFinished, seconds, type GhostTrack } from '@onyourleft/domain';

import { BICYCLE_LENGTH_METRES, RIDER_HALF_WIDTH_METRES, simulatedCrankAngle } from './bicycle';
import { horizonRelief, terrainCorridor } from './landform';
import { CAMERA_BEHIND_METRES, CAMERA_TARGET_AHEAD_METRES } from './camera';
import type { CameraPose, RiderMarker, SceneFrame, WaterFrame } from './port';
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
import { STRUCTURE_MAX_ITEMS, clearOfBuildings, structuresAt } from './settlements';
import { bridgeParts, waterSurface, waterways } from './waterways';
import { worldStyle } from './world';
import type { RouteProfile } from '@onyourleft/domain';

/** Everything a frame needs beyond the rider's own state. */
export interface SceneInput {
  readonly profile: RouteProfile;
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
  // #499. Computed once per route and cached against the profile object
  // (`racing-line.ts` §`racingLine`), so this is the first frame's cost only.
  const line = input.centreline === true ? undefined : racingLine(input.profile);
  const riders = ridersOnTheRoad(corridor, input, riderDistance, line);
  return {
    corridor,
    // The camera follows the rider sideways — their drawn place, not the line's
    // — so the rider stays where `camera.ts` §`riderFrameBox` says they are.
    camera: cameraPose(corridor, riderDistance, (riders[0] as PlacedRider).lateral),
    markers: riders.map((rider) => rider.marker),
    // Recomputed per frame rather than cached against the profile: it is two
    // bounded passes over at most `WORLD_SAMPLE_LIMIT` samples, and a cache
    // keyed on a profile is a second source of truth that a route change has
    // to remember to clear. `world.ts` says what the bound buys.
    world: worldStyle(input.profile),
    scatter: scatter(corridor, input, riderDistance, seed),
    // #458. Built from the corridor just built, so the ground's innermost
    // column is the road's outermost one — `landform.ts` says why that is the
    // whole of the no-crack guarantee. Every band, whatever the rung: the
    // renderer draws a prefix of them (`three-renderer.ts` §`TerrainBelt`), so
    // the rung moves no vertex and the scenery stands on the same ground.
    terrain: {
      mesh: terrainCorridor(input.profile, input.origin, corridor, seed),
      horizon: horizonRelief(input.profile, input.origin, seed),
    },
    // #459. The waterways are found once per route (`waterways.ts` §`computed`)
    // and the surfaces and bridges built for this stretch of it, from the same
    // corridor the ground and the road are built from.
    water: water(input, corridor, seed),
  };
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
function scatter(
  corridor: RoadCorridor,
  input: SceneInput,
  riderDistance: number,
  seed: number,
): readonly ScatterItem[] {
  const first = corridor.centre[0] as CorridorPoint;
  const last = corridor.centre[corridor.centre.length - 1] as CorridorPoint;
  const natural = scatterAt(input.profile, input.origin, seed, first.along, last.along, {
    maxItems: input.scatterItems ?? SCATTER_MAX_ITEMS,
    riderMetres: riderDistance,
  });
  // #460. The villages, farmsteads and field boundaries, FIRST — so that a belt
  // spending its budget in frame order never loses a house to a far tree — and
  // the natural scenery kept clear of every building.
  const built = structuresAt(input.profile, input.origin, seed, first.along, last.along, {
    maxItems: input.structureItems ?? STRUCTURE_MAX_ITEMS,
    riderMetres: riderDistance,
  });
  return [...built, ...clearOfBuildings(natural, built)];
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
const LEVEL_LANES: Readonly<Record<RiderMarker['kind'], number>> = { rider: 0, bot: -1, ghost: 1 };

/** A rider on the road, and how far across it they were drawn. */
interface PlacedRider {
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
    riders.push({
      kind: 'ghost',
      distance: at,
      speed: ghostSpeed(input.ghost, clock),
      crankAngle: pedalling(at),
    });
  }
  return riders.map((rider) => {
    const lateral = line === undefined ? 0 : lateralOf(rider, riders, line);
    const lean = line === undefined ? 0 : leanAt(line, rider.distance, rider.speed);
    const marker = markerAt(corridor, rider.distance, rider.kind, lateral, lean);
    return {
      marker: rider.crankAngle === undefined ? marker : { ...marker, crankAngle: rider.crankAngle },
      lateral,
    };
  });
}

/**
 * How far across the road one rider is drawn: the line, eased toward
 * {@link LEVEL_LANES} by how level they are with the nearest other rider.
 *
 * `line·(1 − g·w) + lane·side·w`, where `w` runs from 1 within a bicycle's
 * length of another rider to 0 at {@link LEVEL_FADE_METRES} beyond it, and `g`
 * is {@link LINE_GIVEN_UP}. At `w = 1` that is at most
 * `2.9·0.69 + 1.2 = 3.2 m` from the centre, which is {@link DRAWN_LIMIT_METRES}.
 */
function lateralOf(rider: Rider, riders: readonly Rider[], line: RacingLine): number {
  let level = 0;
  for (const other of riders) {
    if (other === rider) continue;
    const gap = Math.abs(other.distance - rider.distance);
    level = Math.max(
      level,
      Math.min(
        1,
        Math.max(0, (BICYCLE_LENGTH_METRES + LEVEL_FADE_METRES - gap) / LEVEL_FADE_METRES),
      ),
    );
  }
  const onLine = lineOffsetAt(line, rider.distance);
  return (
    onLine * (1 - LINE_GIVEN_UP * level) + LEVEL_LANES[rider.kind] * SIDE_BY_SIDE_METRES * level
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
 * A simulated rider's crank angle, where its own odometer puts it — #368.
 *
 * ⚠️ **The rider's odometer, not the position its marker was clamped to.**
 * {@link markerAt} clamps a bot or a ghost far up the road to the corridor's
 * far end, so its drawn position stops moving while the rider it belongs to
 * keeps riding — and cranks taken from that position would freeze with it,
 * which is a claim that a bot beyond the horizon has stopped pedalling. The
 * unwrapped distance is what actually moved.
 *
 * `bicycle.ts` §`simulatedCrankAngle` is where the one thing this asserts — a
 * fixed gear, and no invented rate — is argued.
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
  lean: number,
): RiderMarker {
  const at = placeOnCorridor(corridor, atDistance);
  // ⚠️ The heading is the road's at **this** marker's own distance, not the
  // camera's — #349. @see RiderMarker.headingX
  const heading = headingAt(corridor, at.index);
  // #499: across the road along its own normal, `(−headingZ, headingX)` —
  // the side `terrain.ts` §`ribbonNormals` calls left — and at the road's
  // height, which is flat across its width (`ribbonNormals` says why).
  return {
    kind,
    x: at.x - heading.headingZ * lateral,
    y: at.y,
    z: at.z + heading.headingX * lateral,
    ...heading,
    lean,
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
