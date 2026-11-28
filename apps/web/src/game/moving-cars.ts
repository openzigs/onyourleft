// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Moving cars on an ordinary ride — #3283: cars coming the other way in the
 * other lane, and cars crossing ahead on a mapped cross street, clearing it
 * before the rider arrives. Where each one is, which way it faces, how far
 * its wheels have rolled and how hard its front wheels are turned. Draws
 * nothing: `three-renderer.ts` §`ParkedCarBelt` draws what `scene.ts`
 * §`placedMovingCars` places from here, in the parked cars' own call and
 * inside their caps.
 *
 * ## Scenery, never a hazard
 *
 * Nothing here is read by a simulation, a score, an announcer or the
 * trainer, and no game event follows from a car: a car is a place, a heading
 * and a look, handed to the view (`port.ts` §`SceneFrame.movingCars`). It
 * makes no sound. `scene.ts` places them only where `GameView` says so — a
 * free ride or a workout on a route ride with map data — and never in a lap
 * race, a room, a Delivery round, beside the pacer or a ghost, or on an
 * open-world ride (#2916 decides what one of those carries).
 *
 * ## ⚠️ A function of where the rider is drawn, never of a clock
 *
 * The scenery cyclists' rule (`scenery-cyclists.ts`), and for their reasons:
 * a car is at a place that follows from the rider's drawn distance alone, so
 * the same route, seed and ride give the same traffic on every replay and in
 * any frame order, and a crossing car is clear of its junction before the
 * rider arrives at ANY speed — a pure function of distance has no speed to
 * outrun. The cost is that a car's speed is a share of the rider's
 * ({@link ONCOMING_CAR_PACE}, {@link CROSSING_CAR_PACE}): a rider who stops
 * holds the traffic, as a held ride holds the people and the cyclists.
 *
 * ## Where a car is, by the setting
 *
 * The ridden road's {@link TrafficSetting} at each place ({@link trafficSettingAt}):
 * a mapped footway, cycleway, path or track the route runs along is a
 * `path`, and has no car; a mapped major road is `major`; any other road in a
 * town (`scenery-cyclists.ts` §`townAt`) is `town`, and out of one a `lane`.
 *
 * - **Oncoming** ({@link oncomingCarOf}): the route is cut into cells of
 *   {@link MOVING_CAR_CELL_METRES}, and each holds a car by a seeded draw at
 *   {@link ONCOMING_CARS_PER_KM} for its setting. A car meets the rider at its
 *   *meeting point* and is at `meeting − pace · (rider − meeting)`, its middle
 *   {@link MOVING_CAR_LANE_METRES} out in the other half.
 * - **Crossing** ({@link crossingCarOf}): at a mapped crossroads whose cross
 *   street runs straight over the route, at {@link CROSSING_CAR_SHARE} for the
 *   setting, a car drives along the cross street's two arms in its own lane.
 *   It is placed so that its box has left the carriageway, and
 *   {@link MOVING_CAR_CLEAR_METRES} beyond it, when the rider is still
 *   {@link JUNCTION_CLEAR_METRES} short of the junction.
 *
 * ## Never in the rider's lane, never near anybody — one rule for the oncoming half
 *
 * An oncoming car's box is wholly in the other half of the 7 m road
 * (`terrain.ts` §`ROAD_WIDTH_METRES`), which it shares with the oncoming
 * scenery cyclists. So a car is kept only where:
 *
 * - the rider's own drawn line, wherever the two are level, keeps the
 *   rider's middle at least {@link MOVING_CAR_CLEAR_METRES} from its box — the
 *   racing line crosses the centre at the apex of a left-hand bend, and a car
 *   that would meet the rider there is not placed at all;
 * - no oncoming cyclist and no car of an earlier cell comes within
 *   {@link MOVING_CAR_CLEAR_METRES} of it along the road while both are drawn
 *   ({@link nearestOnTheRoad}, the one rule both are placed by). The cyclist is
 *   kept and the car is not, so #2722's riders are where they were.
 *
 * A crossing car is kept only where no cyclist of any kind and no oncoming
 * car is at its junction while it is on the carriageway, and no other
 * crossing car's box comes within {@link MOVING_CAR_CLEAR_METRES} of its own;
 * `scene.ts` also drops one whose box would come that near a parked car the
 * frame draws. Each verdict is the car's own, from what is near it, never a
 * chain's: a car is dropped when one that ranks before it would meet it,
 * whether or not that one is itself drawn.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message.
 *
 * Pure, and names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { PathFeature, StreetFeature } from '@onyourleft/map-features';

import { BICYCLE_LENGTH_METRES } from './bicycle';
import { SIDE_ROAD_WIDTHS, widthClassOf, type Junction, type SideRoadArm } from './cross-streets';
import { PARKED_CAR_BOX } from './parked-cars';
import { sceneryGrid, wrappedCell } from './scenery-anchor';
import {
  CYCLIST_CELL_METRES,
  CYCLIST_DRAW_METRES,
  encounterOf,
  type Encounter,
  type TownAt,
} from './scenery-cyclists';
import type { MovingCar } from './moving-car-frame';
import { mixInto, slotHash, uniformFrom } from './seeded';
import { distanceToDrawnRoad } from './road-grid';
import {
  drawnRoadFrame,
  drawnRoadPosition,
  ROAD_WIDTH_METRES,
  type CorridorOrigin,
} from './terrain';

/** What the ridden road is at a place, as the traffic on it goes. @see the header */
export type TrafficSetting = 'path' | 'lane' | 'town' | 'major';

/** The ridden road's setting at a route distance. */
export type TrafficSettingAt = (along: number) => TrafficSetting;

/** How long a cell of the route that may hold an oncoming car is, in metres: **100**. */
export const MOVING_CAR_CELL_METRES = 100;

/**
 * How many oncoming cars a kilometre of each setting holds, on average:
 * **none** on a path or a cycleway, **0.5** on a rural lane (one in 2 km), **2.5**
 * on a town's road and **5** on a major road.
 */
export const ONCOMING_CARS_PER_KM: Readonly<Record<TrafficSetting, number>> = {
  path: 0,
  lane: 0.5,
  town: 2.5,
  major: 5,
};

/**
 * The chance a mapped crossroads has a car crossing it as the rider comes:
 * **none** on a path, **0.15** on a rural lane, **0.4** in a town and **0.5**
 * on a major road — by the ridden road's setting at the junction.
 */
export const CROSSING_CAR_SHARE: Readonly<Record<TrafficSetting, number>> = {
  path: 0,
  lane: 0.15,
  town: 0.4,
  major: 0.5,
};

/** An oncoming car's pace, as a share of the rider's: **1.3** to **1.8**. */
export const ONCOMING_CAR_PACE = [1.3, 1.8] as const;

/** A crossing car's pace, as a share of the rider's: **0.55** to **0.7**. */
export const CROSSING_CAR_PACE = [0.55, 0.7] as const;

/**
 * How far from the centreline an oncoming car's middle is, in metres:
 * **2.05**, in the other half — its box (`parked-cars.ts` §`PARKED_CAR_BOX`,
 * 1 m either side) runs from 1.05 m to 3.05 m out, inside the 3.5 m half-road.
 */
export const MOVING_CAR_LANE_METRES = 2.05;

/**
 * The gap no moving car's box comes within, in metres: **1**, of the rider's
 * middle, a scenery cyclist's middle, or another car's box.
 */
export const MOVING_CAR_CLEAR_METRES = 1;

/** How far from the rider a moving car is drawn at all, in metres: **150**, as a cyclist and a parked car. */
export const MOVING_CAR_DRAW_METRES = 150;

/**
 * The most moving cars one frame draws: **3**, the nearest. Each is drawn
 * with its wheels, inside the parked cars' caps (`parked-cars.ts`
 * §`PARKED_CARS_NEAR_MAX`): `realistic-budget.ts`
 * §`REALISTIC_MOVING_CAR_TRIANGLES`.
 */
export const MOVING_CARS_MAX = 3;

/**
 * How far short of a junction the rider still is when its crossing car's box
 * has left the carriageway and {@link MOVING_CAR_CLEAR_METRES} beyond it, in
 * metres: **40**.
 */
export const JUNCTION_CLEAR_METRES = 40;

/**
 * The fastest rider {@link JUNCTION_CLEAR_METRES} is asserted at, in metres a
 * second: **25** (90 km/h), faster than any ride. A crossing car's place is a
 * function of the rider's distance, so it holds at any speed; this is the
 * speed `moving-cars.test.ts` drives at.
 *
 * @test-facing the stated maximum `moving-cars.test.ts` rides at; nothing in
 * the product bounds the rider's speed for a car
 */
export const CROSSING_RIDER_SPEED_MAX = 25;

/** How far out along each arm of its cross street a crossing car is drawn, in metres: **40**. */
export const CROSSING_REACH_METRES = 40;

/** How far from the drawn road a mapped way may be and still be the one ridden, in metres. */
const MATCH_METRES = 8;

/** The least cosine between the road and a mapped way for it to be the one ridden: within 30°. */
const MATCH_COSINE = Math.cos((30 * Math.PI) / 180);

/** How long a stretch of road one setting is read for, in metres. */
const SETTING_STEP_METRES = 20;

/** Half the carriageway, in metres: **3.5**. */
const ROAD_HALF_METRES = ROAD_WIDTH_METRES / 2;

/** The seed streams of the cars, apart from every other user of the route's seed. */
const ONCOMING_KEY = 0x3283_0001;
const CROSSING_KEY = 0x3283_0002;

function lerp(range: readonly [number, number], share: number): number {
  return range[0] + (range[1] - range[0]) * share;
}

// --- The setting ---------------------------------------------------------

/** The mapped ways the ridden road may be: a corridor's streets and paths. */
export interface TrafficWays {
  readonly streets: readonly StreetFeature[];
  readonly paths: readonly PathFeature[];
}

/** A mapped line's box in plan, found once. */
const lineBoxes = new WeakMap<
  Float32Array,
  { minX: number; maxX: number; minZ: number; maxZ: number }
>();

function boxOf(line: Float32Array): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const known = lineBoxes.get(line);
  if (known !== undefined) return known;
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let at = 0; at + 1 < line.length; at += 2) {
    box.minX = Math.min(box.minX, line[at] as number);
    box.maxX = Math.max(box.maxX, line[at] as number);
    box.minZ = Math.min(box.minZ, line[at + 1] as number);
    box.maxZ = Math.max(box.maxZ, line[at + 1] as number);
  }
  lineBoxes.set(line, box);
  return box;
}

/**
 * How near `(x, z)` a mapped line runs ALONG `(fx, fz)`: the least distance
 * to a segment of it within 30° of that direction, either way, or infinity.
 */
function alongLine(line: Float32Array, x: number, z: number, fx: number, fz: number): number {
  const box = boxOf(line);
  if (
    x < box.minX - MATCH_METRES ||
    x > box.maxX + MATCH_METRES ||
    z < box.minZ - MATCH_METRES ||
    z > box.maxZ + MATCH_METRES
  ) {
    return Infinity;
  }
  let best = Infinity;
  for (let at = 0; at + 3 < line.length; at += 2) {
    const ax = line[at] as number;
    const az = line[at + 1] as number;
    const dx = (line[at + 2] as number) - ax;
    const dz = (line[at + 3] as number) - az;
    const span = Math.hypot(dx, dz);
    if (!(span > 0) || Math.abs((dx * fx + dz * fz) / span) < MATCH_COSINE) continue;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (span * span)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best <= MATCH_METRES ? best : Infinity;
}

/**
 * The ridden road's setting along a route — #3283, read off the map where it
 * was read, a stretch of {@link SETTING_STEP_METRES} at a time and kept: the
 * mapped way nearest the drawn road there that runs along it, a path before a
 * street only where the path is the nearer. With no way mapped there, the
 * town's road or the lane. @see the header
 */
export function trafficSettingAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  ways: TrafficWays | undefined,
  town: TownAt,
): TrafficSettingAt {
  const lap = profile.loop ? profile.totalDistance : 0;
  const known = new Map<number, TrafficSetting>();
  return (along) => {
    const wrapped = lap > 0 ? ((along % lap) + lap) % lap : along;
    const bucket = Math.floor(wrapped / SETTING_STEP_METRES);
    const kept = known.get(bucket);
    if (kept !== undefined) return kept;
    const middle = (bucket + 0.5) * SETTING_STEP_METRES;
    const setting = settingOf(profile, origin, ways, town, middle);
    known.set(bucket, setting);
    return setting;
  };
}

function settingOf(
  profile: RouteProfile,
  origin: CorridorOrigin,
  ways: TrafficWays | undefined,
  town: TownAt,
  along: number,
): TrafficSetting {
  const frame = ways === undefined ? undefined : drawnRoadFrame(profile, origin, along);
  if (ways !== undefined && frame !== undefined) {
    // The road's forward direction is its normal turned back a quarter (`terrain.ts`).
    const fx = frame.normalZ;
    const fz = -frame.normalX;
    let street = Infinity;
    let major = false;
    for (const each of ways.streets) {
      const near = alongLine(each.line, frame.x, frame.z, fx, fz);
      if (near < street) {
        street = near;
        const width = widthClassOf(each);
        major = width === 'major' || width === 'highway';
      }
    }
    let path = Infinity;
    for (const each of ways.paths)
      path = Math.min(path, alongLine(each.line, frame.x, frame.z, fx, fz));
    if (path < street) return 'path';
    if (major) return 'major';
  }
  return town(along) ? 'town' : 'lane';
}

// --- One road user against another, along the road -----------------------

/**
 * A road user whose place along the road is `base + rate · rider` while the
 * rider is drawn between `from` and `to`, `half` metres long either side of it.
 */
interface Mover {
  readonly base: number;
  readonly rate: number;
  readonly from: number;
  readonly to: number;
  readonly half: number;
}

/**
 * The least gap along the road between two road users' ends while both are
 * drawn, in metres — negative where they overlap; infinity where they are
 * never drawn together. Their places are linear in the rider's, so the least
 * is at an end of the common stretch, or nought where they cross.
 */
function nearestOnTheRoad(a: Mover, b: Mover): number {
  const from = Math.max(a.from, b.from);
  const to = Math.min(a.to, b.to);
  if (from > to) return Infinity;
  const apart = (rider: number): number => a.base - b.base + (a.rate - b.rate) * rider;
  const start = apart(from);
  const end = apart(to);
  const least = start * end <= 0 ? 0 : Math.min(Math.abs(start), Math.abs(end));
  return least - a.half - b.half;
}

/** A scenery cyclist's encounter as a {@link Mover}: its bicycle's length, while it is drawn. */
function cyclistMover(encounter: Encounter): Mover {
  const { meeting, pace } = encounter;
  const oncoming = encounter.kind === 'oncoming';
  // `scenery-cyclists.ts` §`cyclistAlong`, and drawn within its reach of the rider.
  const closing = oncoming ? 1 + pace : Math.abs(1 - pace);
  const reach = CYCLIST_DRAW_METRES / closing;
  return {
    base: oncoming ? meeting * (1 + pace) : meeting * (1 - pace),
    rate: oncoming ? -pace : pace,
    from: meeting - reach,
    to: meeting + reach,
    half: BICYCLE_LENGTH_METRES / 2,
  };
}

// --- Oncoming cars -------------------------------------------------------

/** One oncoming car, before it is placed. */
export interface OncomingCar {
  /** Where on the route the rider and this car meet, metres (unwrapped on a loop). */
  readonly meeting: number;
  /** Its pace, a share of the rider's. */
  readonly pace: number;
  /** Its seed: its body, its paint and its wheels' offset. */
  readonly key: number;
}

/** The oncoming car of one cell of the route, or none: before it is kept clear of anybody. */
export function oncomingCarOf(
  profile: RouteProfile,
  seed: number,
  setting: TrafficSettingAt,
  cell: number,
): OncomingCar | undefined {
  const grid = sceneryGrid(profile, MOVING_CAR_CELL_METRES);
  if (!profile.loop && (cell < grid.first || cell > grid.last)) return undefined;
  // Hashed by the cell on the route's first lap, so a loop's every lap shows the same cars.
  const key = slotHash(seed, wrappedCell(grid, cell), ONCOMING_KEY);
  const meeting = cell * grid.span - grid.shift + grid.span * uniformFrom(key, 0);
  const chance = (ONCOMING_CARS_PER_KM[setting(meeting)] * grid.span) / 1_000;
  if (uniformFrom(key, 1) >= chance) return undefined;
  return { meeting, pace: lerp(ONCOMING_CAR_PACE, uniformFrom(key, 2)), key };
}

/** Where an oncoming car is along the route when the rider is drawn at `rider`, metres. */
export function oncomingCarAlong(car: OncomingCar, rider: number): number {
  return car.meeting - car.pace * (rider - car.meeting);
}

function oncomingMover(car: OncomingCar): Mover {
  const reach = MOVING_CAR_DRAW_METRES / (1 + car.pace);
  return {
    base: car.meeting * (1 + car.pace),
    rate: -car.pace,
    from: car.meeting - reach,
    to: car.meeting + reach,
    half: PARKED_CAR_BOX.halfLength,
  };
}

/** Across the road, where the rider's middle is drawn at a route distance, metres, positive on their right. */
export type RiderLateralAt = (rider: number) => number;

/** How many cells either way an oncoming car may meet another's in: two cells' reach, rounded up. */
const CAR_CELLS_NEAR = Math.ceil((2 * MOVING_CAR_DRAW_METRES) / MOVING_CAR_CELL_METRES);

/** How many cyclists' cells either way a car may meet one of theirs in. */
const CYCLIST_CELLS_NEAR = Math.ceil(
  (MOVING_CAR_DRAW_METRES + CYCLIST_DRAW_METRES) / CYCLIST_CELL_METRES + 1,
);

/** The most the rider's middle may come toward an oncoming car's lane, metres from the centreline. */
const RIDER_LEAST_LATERAL =
  -(MOVING_CAR_LANE_METRES - PARKED_CAR_BOX.halfWidth) + MOVING_CAR_CLEAR_METRES;

/**
 * The oncoming car of one cell, where it is kept — #3283: clear of the rider
 * wherever the two are level, and of every oncoming cyclist and every car of
 * an earlier cell along the road. @see the header
 */
export function oncomingCarKept(
  profile: RouteProfile,
  seed: number,
  setting: TrafficSettingAt,
  town: TownAt,
  riderLateralAt: RiderLateralAt,
  cell: number,
): OncomingCar | undefined {
  const car = oncomingCarOf(profile, seed, setting, cell);
  if (car === undefined) return undefined;
  // Level with the rider: where its box and the rider's bicycle are within the gap along the road.
  const level =
    (PARKED_CAR_BOX.halfLength + BICYCLE_LENGTH_METRES / 2 + MOVING_CAR_CLEAR_METRES) /
    (1 + car.pace);
  for (let step = 0; step <= 8; step += 1) {
    const rider = car.meeting - level + (2 * level * step) / 8;
    if (riderLateralAt(rider) < RIDER_LEAST_LATERAL) return undefined;
  }
  const own = oncomingMover(car);
  const cyclistCell = Math.floor(
    (car.meeting + sceneryGrid(profile, CYCLIST_CELL_METRES).shift) /
      sceneryGrid(profile, CYCLIST_CELL_METRES).span,
  );
  for (
    let near = cyclistCell - CYCLIST_CELLS_NEAR;
    near <= cyclistCell + CYCLIST_CELLS_NEAR;
    near += 1
  ) {
    const cyclist = encounterOf(profile, seed, town, near);
    if (cyclist?.kind !== 'oncoming') continue;
    if (nearestOnTheRoad(own, cyclistMover(cyclist)) < MOVING_CAR_CLEAR_METRES) return undefined;
  }
  for (let earlier = cell - CAR_CELLS_NEAR; earlier < cell; earlier += 1) {
    const other = oncomingCarOf(profile, seed, setting, earlier);
    if (other === undefined) continue;
    if (nearestOnTheRoad(own, oncomingMover(other)) < MOVING_CAR_CLEAR_METRES) return undefined;
  }
  return car;
}

/** An oncoming car in reach of the rider, before it is stood on the road. */
export interface OncomingInReach {
  readonly car: OncomingCar;
  /** Where it is along the route, metres. */
  readonly along: number;
  /** How far it has driven, metres: what rolls its wheels. */
  readonly travelled: number;
  /** How sharply its road bends for it, per metre: positive to its own left. */
  readonly curvature: number;
}

/** How far from the rider a cell can hold an oncoming car in reach, metres: its reach at the slowest closing, and a cell. */
const ONCOMING_REACH_METRES =
  MOVING_CAR_DRAW_METRES / (1 + ONCOMING_CAR_PACE[0]) + MOVING_CAR_CELL_METRES;

/** How far either side of a place the road's bend is read over, metres. */
const BEND_SPAN_METRES = 3;

/** How sharply the drawn road bends at `along`, for one riding the rider's way: per metre, positive to the left. */
function roadCurvature(profile: RouteProfile, origin: CorridorOrigin, along: number): number {
  const before = drawnRoadFrame(profile, origin, along - BEND_SPAN_METRES);
  const after = drawnRoadFrame(profile, origin, along + BEND_SPAN_METRES);
  if (before === undefined || after === undefined) return 0;
  // Forward is the normal turned back a quarter; the left is the normal's other side.
  const turned =
    (after.normalZ - before.normalZ) * -before.normalX +
    (-after.normalX + before.normalX) * -before.normalZ;
  return turned / (2 * BEND_SPAN_METRES);
}

/**
 * Every kept oncoming car within {@link MOVING_CAR_DRAW_METRES} of `rider`
 * along the route, nearest first; on a point-to-point route only those on it.
 */
export function oncomingCarsInReach(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  setting: TrafficSettingAt,
  town: TownAt,
  riderLateralAt: RiderLateralAt,
  rider: number,
): readonly OncomingInReach[] {
  const { span, shift } = sceneryGrid(profile, MOVING_CAR_CELL_METRES);
  if (!(span > 0)) return [];
  const from = Math.floor((rider - ONCOMING_REACH_METRES + shift) / span);
  const to = Math.floor((rider + ONCOMING_REACH_METRES + shift) / span);
  const found: OncomingInReach[] = [];
  for (let cell = from; cell <= to; cell += 1) {
    const car = oncomingCarKept(profile, seed, setting, town, riderLateralAt, cell);
    if (car === undefined) continue;
    const along = oncomingCarAlong(car, rider);
    if (Math.abs(along - rider) > MOVING_CAR_DRAW_METRES) continue;
    if (!profile.loop && (along < 0 || along > profile.totalDistance)) continue;
    found.push({
      car,
      along,
      travelled: car.pace * (rider - car.meeting) + 10 * uniformFrom(car.key, 3),
      // The other way along the road, so the road's bend is the other way for it.
      curvature: -roadCurvature(profile, origin, along),
    });
  }
  found.sort((a, b) => Math.abs(a.along - rider) - Math.abs(b.along - rider));
  return found;
}

// --- Crossing cars -------------------------------------------------------

/** One crossing car: its path over the cross street and when it is where. */
export interface CrossingCar {
  /** The junction's route distance, on the first lap. */
  readonly along: number;
  /** Its middle line, `x0, z0, x1, z1, …`, in the order it drives. */
  readonly path: Float32Array;
  /** How far along its path each of its points is, metres from the junction: negative before it. */
  readonly at: Float64Array;
  /** How far right of its path, looking along it, its middle is, metres: its own lane. */
  readonly lane: number;
  /** Where on its path it is drawn, metres from the junction. */
  readonly from: number;
  readonly to: number;
  /** Where on its path its box comes within the gap of the carriageway, and where it has left it. */
  readonly enter: number;
  readonly clear: number;
  /** How far along the ridden road, either way of the junction, its box reaches while on the carriageway. */
  readonly before: number;
  readonly after: number;
  readonly pace: number;
  readonly key: number;
}

/** Where a crossing car is, at a place on its path. */
export interface CrossingPose {
  readonly x: number;
  readonly z: number;
  /** Its nose's direction, unit. */
  readonly ux: number;
  readonly uz: number;
}

/** The ridden road a crossing car crosses: a route and where its corridor is. */
export interface RiddenRoad {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
}

/** An arm's direction out from the junction, unit, read over its first 10 m. */
function armDirection(arm: SideRoadArm): readonly [number, number] | undefined {
  const line = arm.line;
  const x0 = line[0] as number;
  const z0 = line[1] as number;
  for (let at = 2; at + 1 < line.length; at += 2) {
    const dx = (line[at] as number) - x0;
    const dz = (line[at + 1] as number) - z0;
    const span = Math.hypot(dx, dz);
    if (span >= 10 || at + 3 >= line.length) return span > 0 ? [dx / span, dz / span] : undefined;
  }
  return undefined;
}

/** The least cosine between a crossroads' two arms, the one turned back, for its street to run straight over: within 30°. */
const STRAIGHT_OVER_COSINE = Math.cos((30 * Math.PI) / 180);

/** Where on `car`'s path, `s` metres from the junction, it is. */
export function crossingPoseAt(
  car: Pick<CrossingCar, 'path' | 'at' | 'lane'>,
  s: number,
): CrossingPose {
  const { path, at } = car;
  const count = at.length;
  let index = 0;
  while (index < count - 2 && (at[index + 1] as number) < s) index += 1;
  const a0 = at[index] as number;
  const a1 = at[index + 1] as number;
  const ax = path[index * 2] as number;
  const az = path[index * 2 + 1] as number;
  const bx = path[index * 2 + 2] as number;
  const bz = path[index * 2 + 3] as number;
  const t = a1 > a0 ? Math.min(1, Math.max(0, (s - a0) / (a1 - a0))) : 0;
  // Its nose along the path a car's length either side, so a bend turns it smoothly.
  const behind = pointOn(car, s - PARKED_CAR_BOX.halfLength);
  const ahead = pointOn(car, s + PARKED_CAR_BOX.halfLength);
  let ux = ahead[0] - behind[0];
  let uz = ahead[1] - behind[1];
  const span = Math.hypot(ux, uz);
  if (span > 0) {
    ux /= span;
    uz /= span;
  } else {
    ux = bx - ax;
    uz = bz - az;
    const own = Math.hypot(ux, uz) || 1;
    ux /= own;
    uz /= own;
  }
  // Its right, looking along it, is `(−uz, ux)`, as `parked-cars.ts`' kerb cars'.
  return {
    x: ax + (bx - ax) * t - uz * car.lane,
    z: az + (bz - az) * t + ux * car.lane,
    ux,
    uz,
  };
}

function pointOn(car: Pick<CrossingCar, 'path' | 'at'>, s: number): readonly [number, number] {
  const { path, at } = car;
  const count = at.length;
  let index = 0;
  while (index < count - 2 && (at[index + 1] as number) < s) index += 1;
  const a0 = at[index] as number;
  const a1 = at[index + 1] as number;
  const t = a1 > a0 ? Math.min(1, Math.max(0, (s - a0) / (a1 - a0))) : 0;
  return [
    (path[index * 2] as number) +
      ((path[index * 2 + 2] as number) - (path[index * 2] as number)) * t,
    (path[index * 2 + 1] as number) +
      ((path[index * 2 + 3] as number) - (path[index * 2 + 1] as number)) * t,
  ];
}

/** A box's outline, every half metre or so: what its distances are measured from. */
export function movingCarOutline(
  pose: Pick<CrossingPose, 'x' | 'z' | 'ux' | 'uz'>,
  halfLength: number = PARKED_CAR_BOX.halfLength,
  halfWidth: number = PARKED_CAR_BOX.halfWidth,
): readonly (readonly [number, number])[] {
  const points: (readonly [number, number])[] = [];
  const lx = pose.uz;
  const lz = -pose.ux;
  const along = Math.ceil((2 * halfLength) / 0.5);
  const across = Math.ceil((2 * halfWidth) / 0.5);
  for (let step = 0; step <= along; step += 1) {
    const f = -halfLength + (2 * halfLength * step) / along;
    for (const side of [-1, 1]) {
      points.push([
        pose.x + pose.ux * f + lx * halfWidth * side,
        pose.z + pose.uz * f + lz * halfWidth * side,
      ]);
    }
  }
  for (let step = 1; step < across; step += 1) {
    const w = -halfWidth + (2 * halfWidth * step) / across;
    for (const end of [-1, 1]) {
      points.push([
        pose.x + pose.ux * halfLength * end + lx * w,
        pose.z + pose.uz * halfLength * end + lz * w,
      ]);
    }
  }
  points.push([pose.x, pose.z]);
  return points;
}

/** How far `(x, z)` is outside a car's box: nought inside it. */
export function outsideMovingCar(
  pose: Pick<CrossingPose, 'x' | 'z' | 'ux' | 'uz'>,
  x: number,
  z: number,
  halfLength: number = PARKED_CAR_BOX.halfLength,
  halfWidth: number = PARKED_CAR_BOX.halfWidth,
): number {
  const f = (x - pose.x) * pose.ux + (z - pose.z) * pose.uz;
  const l = (x - pose.x) * pose.uz - (z - pose.z) * pose.ux;
  return Math.hypot(Math.max(Math.abs(f) - halfLength, 0), Math.max(Math.abs(l) - halfWidth, 0));
}

/** How near two boxes come, metres: nought where they touch. */
function boxesApart(a: CrossingPose, b: CrossingPose): number {
  let least = Infinity;
  for (const [x, z] of movingCarOutline(a)) least = Math.min(least, outsideMovingCar(b, x, z));
  for (const [x, z] of movingCarOutline(b)) least = Math.min(least, outsideMovingCar(a, x, z));
  return least;
}

/** The step a crossing car's path is walked at to find where its box is on the carriageway, metres. */
const CROSSING_STEP_METRES = 0.25;

/** A junction's crossing car, by seed. */
const crossingFound = new WeakMap<Junction, { seed: number; car: CrossingCar | undefined }>();

/**
 * The car crossing one junction, or none: a mapped crossroads whose street
 * runs straight over the route, a minor or a major one either side, and whose
 * hash says so at its setting's {@link CROSSING_CAR_SHARE}. Before it is kept
 * clear of anybody. Found once a junction and seed.
 */
export function crossingCarOf(
  junction: Junction,
  seed: number,
  setting: TrafficSettingAt,
  road: RiddenRoad,
): CrossingCar | undefined {
  const known = crossingFound.get(junction);
  if (known?.seed === seed) return known.car;
  const car = crossingCarFound(junction, seed, setting, road);
  crossingFound.set(junction, { seed, car });
  return car;
}

function crossingCarFound(
  junction: Junction,
  seed: number,
  setting: TrafficSettingAt,
  road: RiddenRoad,
): CrossingCar | undefined {
  if (junction.source !== 'mapped') return undefined;
  const streets = junction.arms.filter(
    (arm) => (arm.widthClass === 'minor' || arm.widthClass === 'major') && arm.line.length >= 4,
  );
  // The pair of arms, one each side, that runs most straight over the road.
  let pair: readonly [SideRoadArm, SideRoadArm] | undefined;
  let straightest = -STRAIGHT_OVER_COSINE;
  for (const left of streets) {
    if (left.side !== -1) continue;
    const a = armDirection(left);
    for (const right of streets) {
      if (right.side !== 1 || a === undefined) continue;
      const b = armDirection(right);
      if (b === undefined) continue;
      const dot = a[0] * b[0] + a[1] * b[1];
      if (dot <= straightest) {
        straightest = dot;
        pair = [left, right];
      }
    }
  }
  if (pair === undefined) return undefined;
  const key = mixInto(
    mixInto(seed ^ CROSSING_KEY, Math.round((pair[0].line[0] as number) * 100)),
    Math.round((pair[0].line[1] as number) * 100),
  );
  if (uniformFrom(key, 0) >= CROSSING_CAR_SHARE[setting(junction.along)]) return undefined;
  const [start, end] = uniformFrom(key, 1) < 0.5 ? pair : [pair[1], pair[0]];
  // Its path: in along the first arm, through the junction's middle, out along the other.
  const points: number[] = [];
  for (let at = start.line.length - 2; at >= 2; at -= 2) {
    points.push(start.line[at] as number, start.line[at + 1] as number);
  }
  const middle = points.length / 2;
  points.push(
    ((start.line[0] as number) + (end.line[0] as number)) / 2,
    ((start.line[1] as number) + (end.line[1] as number)) / 2,
  );
  for (let at = 2; at + 1 < end.line.length; at += 2) {
    points.push(end.line[at] as number, end.line[at + 1] as number);
  }
  const path = Float32Array.from(points);
  const count = points.length / 2;
  const at = new Float64Array(count);
  for (let index = 1; index < count; index += 1) {
    at[index] =
      (at[index - 1] as number) +
      Math.hypot(
        (path[index * 2] as number) - (path[index * 2 - 2] as number),
        (path[index * 2 + 1] as number) - (path[index * 2 - 1] as number),
      );
  }
  const zero = at[middle] as number;
  for (let index = 0; index < count; index += 1) at[index] = (at[index] as number) - zero;
  const lane = Math.min(SIDE_ROAD_WIDTHS[start.widthClass], SIDE_ROAD_WIDTHS[end.widthClass]) / 4;
  const from = Math.max((at[0] as number) + 1, -CROSSING_REACH_METRES);
  const to = Math.min((at[count - 1] as number) - 1, CROSSING_REACH_METRES);
  const shape = { path, at, lane };
  // Where its box is on the carriageway, or within the gap of it.
  const near = ROAD_HALF_METRES + MOVING_CAR_CLEAR_METRES;
  const middleX = path[middle * 2] as number;
  const middleZ = path[middle * 2 + 1] as number;
  const frame = drawnRoadFrame(road.profile, road.origin, junction.along);
  if (frame === undefined) return undefined;
  // The road's forward direction is its normal turned back a quarter (`terrain.ts`).
  const fx = frame.normalZ;
  const fz = -frame.normalX;
  let enter: number | undefined;
  let clear: number | undefined;
  let before = 0;
  let after = 0;
  for (let s = from; s <= to; s += CROSSING_STEP_METRES) {
    const pose = crossingPoseAt(shape, s);
    const outline = movingCarOutline(pose);
    if (
      !outline.some(
        ([x, z]) => distanceToDrawnRoad(road.profile, road.origin, x, z, near + 1) < near,
      )
    ) {
      continue;
    }
    enter ??= s;
    clear = s + CROSSING_STEP_METRES;
    for (const [x, z] of outline) {
      const ahead = (x - middleX) * fx + (z - middleZ) * fz;
      before = Math.min(before, ahead);
      after = Math.max(after, ahead);
    }
  }
  // None that starts on the road, or is not clear of it before its path ends.
  if (enter === undefined || clear === undefined || enter - from < 1 || to - clear < 2) {
    return undefined;
  }
  return {
    along: junction.along,
    path,
    at,
    lane,
    from,
    to,
    enter,
    clear,
    before,
    after,
    pace: lerp(CROSSING_CAR_PACE, uniformFrom(key, 2)),
    key,
  };
}

/**
 * Where on its path a crossing car is when the rider is drawn at `rider`,
 * metres from the junction, with the junction at route distance `junction`
 * (the lap's own, on a loop): its box leaves the carriageway when the rider
 * is {@link JUNCTION_CLEAR_METRES} short of it.
 */
export function crossingCarAt(car: CrossingCar, junction: number, rider: number): number {
  return car.clear + car.pace * (rider - (junction - JUNCTION_CLEAR_METRES));
}

/** Where the rider is drawn while `car` is at `s` on its path, with its junction at `junction`. */
function riderWhenAt(car: CrossingCar, junction: number, s: number): number {
  return junction - JUNCTION_CLEAR_METRES + (s - car.clear) / car.pace;
}

/** How many junctions either way along the list a crossing car may meet another's in. */
const CROSSING_NEAR_METRES =
  2 * (CROSSING_REACH_METRES / CROSSING_CAR_PACE[0]) + JUNCTION_CLEAR_METRES;

/** The step the rider is moved at when two crossing cars are measured against each other, metres. */
const RIDER_STEP_METRES = 0.5;

/** A junction's kept crossing car, by everything it was kept against. */
const crossingKept = new WeakMap<
  Junction,
  { seed: number; setting: TrafficSettingAt; car: CrossingCar | undefined }
>();

/**
 * One junction's crossing car, where it is kept — #3283: no cyclist of any
 * kind and no oncoming car is within {@link MOVING_CAR_CLEAR_METRES} of its
 * junction's reach along the road while it is on the carriageway, and no
 * crossing car of an earlier junction in `junctions` comes within it while
 * both are drawn. `index` is the junction's place in `junctions`.
 */
export function crossingCarKept(
  road: RiddenRoad,
  seed: number,
  setting: TrafficSettingAt,
  town: TownAt,
  junctions: readonly Junction[],
  index: number,
): CrossingCar | undefined {
  const junction = junctions[index] as Junction;
  const known = crossingKept.get(junction);
  if (known?.seed === seed && known.setting === setting) return known.car;
  let car = crossingCarOf(junction, seed, setting, road);
  if (car !== undefined && !crossingClear(road, seed, setting, town, junctions, index, car)) {
    car = undefined;
  }
  crossingKept.set(junction, { seed, setting, car });
  return car;
}

function crossingClear(
  road: RiddenRoad,
  seed: number,
  setting: TrafficSettingAt,
  town: TownAt,
  junctions: readonly Junction[],
  index: number,
  car: CrossingCar,
): boolean {
  const { profile } = road;
  const junction = car.along;
  // While its box is on the carriageway: the rider's stretch, and the road's.
  const onFrom = riderWhenAt(car, junction, car.enter);
  const onTo = riderWhenAt(car, junction, car.clear);
  const box: Mover = {
    base: junction + (car.before + car.after) / 2,
    rate: 0,
    from: onFrom,
    to: onTo,
    half: (car.after - car.before) / 2,
  };
  const cyclists = sceneryGrid(profile, CYCLIST_CELL_METRES);
  const cyclistCell = Math.floor((junction + cyclists.shift) / cyclists.span);
  for (
    let near = cyclistCell - CYCLIST_CELLS_NEAR;
    near <= cyclistCell + CYCLIST_CELLS_NEAR;
    near += 1
  ) {
    const cyclist = encounterOf(profile, seed, town, near);
    if (cyclist === undefined) continue;
    if (nearestOnTheRoad(box, cyclistMover(cyclist)) < MOVING_CAR_CLEAR_METRES) return false;
  }
  const cars = sceneryGrid(profile, MOVING_CAR_CELL_METRES);
  const carCell = Math.floor((junction + cars.shift) / cars.span);
  for (let near = carCell - CAR_CELLS_NEAR - 1; near <= carCell + CAR_CELLS_NEAR + 1; near += 1) {
    const other = oncomingCarOf(profile, seed, setting, near);
    if (other === undefined) continue;
    if (nearestOnTheRoad(box, oncomingMover(other)) < MOVING_CAR_CLEAR_METRES) return false;
  }
  // Every earlier junction's crossing car near enough to be drawn with it.
  const drawnFrom = riderWhenAt(car, junction, car.from);
  const drawnTo = riderWhenAt(car, junction, car.to);
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    const other = junctions[earlier] as Junction;
    if (Math.abs(other.along - junction) > CROSSING_NEAR_METRES) {
      if (other.along < junction) break;
      continue;
    }
    const theirs = crossingCarOf(other, seed, setting, road);
    if (theirs === undefined) continue;
    const from = Math.max(drawnFrom, riderWhenAt(theirs, other.along, theirs.from));
    const to = Math.min(drawnTo, riderWhenAt(theirs, other.along, theirs.to));
    for (let rider = from; rider <= to; rider += RIDER_STEP_METRES) {
      const mine = crossingPoseAt(car, crossingCarAt(car, junction, rider));
      const yours = crossingPoseAt(theirs, crossingCarAt(theirs, other.along, rider));
      if (boxesApart(mine, yours) < MOVING_CAR_CLEAR_METRES) return false;
    }
  }
  return true;
}

/** A crossing car in reach of the rider, before it is stood on the ground. */
export interface CrossingInReach extends CrossingPose {
  readonly car: CrossingCar;
  /** Its junction's route distance on this lap. */
  readonly junction: number;
  /** Where on its path it is, metres from the junction. */
  readonly s: number;
  /** How far it is from the rider's drawn place, metres. */
  readonly distance: number;
  /** How far it has driven, metres: what rolls its wheels. */
  readonly travelled: number;
  /** How sharply its path bends, per metre: positive to its own left. */
  readonly curvature: number;
}

/**
 * Every kept crossing car within {@link MOVING_CAR_DRAW_METRES} of the
 * rider's drawn place and on its path's drawn stretch, nearest first.
 * `junctions` is the route's mapped junctions in route order (`cross-streets.ts`
 * §`mappedJunctions`).
 */
export function crossingCarsInReach(
  road: RiddenRoad,
  seed: number,
  setting: TrafficSettingAt,
  town: TownAt,
  junctions: readonly Junction[],
  rider: number,
): readonly CrossingInReach[] {
  if (junctions.length === 0) return [];
  const { profile, origin } = road;
  const lap = profile.loop ? profile.totalDistance : 0;
  const here = drawnRoadPosition(profile, origin, rider);
  const found: CrossingInReach[] = [];
  const reach =
    MOVING_CAR_DRAW_METRES + JUNCTION_CLEAR_METRES + CROSSING_REACH_METRES / CROSSING_CAR_PACE[0];
  junctions.forEach((each, index) => {
    // The junction on the lap nearest the rider, on a loop.
    const laps = lap > 0 ? Math.round((rider - each.along) / lap) : 0;
    const junction = each.along + laps * lap;
    if (Math.abs(junction - rider) > reach) return;
    const car = crossingCarKept(road, seed, setting, town, junctions, index);
    if (car === undefined) return;
    const s = crossingCarAt(car, junction, rider);
    if (s < car.from || s > car.to) return;
    const pose = crossingPoseAt(car, s);
    const distance = Math.hypot(pose.x - here.x, pose.z - here.z);
    if (distance > MOVING_CAR_DRAW_METRES) return;
    const behind = crossingPoseAt(car, s - BEND_SPAN_METRES);
    const ahead = crossingPoseAt(car, s + BEND_SPAN_METRES);
    // Its left is `(uz, −ux)`.
    const turned = (ahead.ux - behind.ux) * behind.uz - (ahead.uz - behind.uz) * behind.ux;
    found.push({
      ...pose,
      car,
      junction,
      s,
      distance,
      travelled: s - car.from + 10 * uniformFrom(car.key, 3),
      curvature: turned / (2 * BEND_SPAN_METRES),
    });
  });
  found.sort((a, b) => a.distance - b.distance);
  return found;
}

// --- What a frame carries ------------------------------------------------

/** A car's box as `parked-cars.ts` places one: its middle and its yaw. */
export interface CarInPlan {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/** A car in plan as the box {@link outsideMovingCar} measures. */
export function poseOfCar(car: CarInPlan): CrossingPose {
  return { x: car.x, z: car.z, ux: Math.sin(car.heading), uz: Math.cos(car.heading) };
}

/**
 * `cars` without any whose box comes within {@link MOVING_CAR_CLEAR_METRES}
 * of a box of `parked` — #3283: a crossing car drives its street's lane, and
 * a car parked at that street's kerb (`parked-cars.ts`) may stand in it. The
 * same list where none does, so a frame allocates nothing then.
 */
export function movingCarsClearOf(
  cars: readonly MovingCar[],
  parked: readonly CarInPlan[],
): readonly MovingCar[] {
  if (cars.length === 0 || parked.length === 0) return cars;
  const reach =
    2 * Math.hypot(PARKED_CAR_BOX.halfLength, PARKED_CAR_BOX.halfWidth) + MOVING_CAR_CLEAR_METRES;
  const clear = (car: MovingCar): boolean =>
    parked.every(
      (other) =>
        Math.hypot(other.x - car.x, other.z - car.z) > reach ||
        boxesApart(poseOfCar(car), poseOfCar(other)) >= MOVING_CAR_CLEAR_METRES,
    );
  return cars.every(clear) ? cars : cars.filter(clear);
}
