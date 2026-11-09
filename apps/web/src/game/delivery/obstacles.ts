// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Delivery's obstacles and the crash penalty, as pure logic on the game's own
 * tick — #1811, resting on the owner's rulings DL1 and DL5 of 2026-10-27
 * (epic #1803), recorded as ADR 0059 D-1 and D-2.
 *
 * A game ride places the round's obstacles at its start and steps them once
 * for each simulation step, through `ride-round.ts` (#1816).
 *
 * ⚠️ **The obstacles are stepped only on a simulation step that actually
 * ran** — never while the ride is paused or stopped (`ride-round.ts` §"The
 * steps that ran"). A rolling obstacle still crosses a rider whose speed is
 * nought, so stepping on a tick the rider did not ride would cost a point for
 * not moving.
 *
 * ## A crash costs points, and nothing else (ADR 0059 D-2 item 4)
 *
 * A {@link Crash} is a score delta and nothing more. It does not slow the
 * virtual rider: the grade the trainer gets is read at the rider's simulated
 * distance, so a slow-down would change when every later grade is written,
 * which is a game event changing what the trainer is sent. Nothing here
 * imports the simulation, the gradient driver or a trainer port, and
 * `delivery-cannot-reach-trainer.test.ts` (#1807) holds that.
 *
 * ## Dodged by timing, because phase 0 has no steering
 *
 * The rider's lateral offset is a drawing (`scene.ts` §`lateralOf`), and in
 * phase 0 nothing the rider does moves it (lane steering is #1820). So an
 * obstacle that stood still in the road would be unavoidable, and none does:
 * every obstacle **crosses the carriageway**, from just off one kerb to just
 * off the other, and is a hazard only while it is in the rider's drawn line.
 * The rider avoids it by arriving earlier or later — by power.
 *
 * ## Standing in a lane, when the rider can steer (#1820)
 *
 * With lane steering (`steer.ts`), a static obstacle becomes allowed, provided
 * another lane is clear. {@link placeObstacles} asked for a round the rider
 * can steer makes {@link STANDING_OBSTACLE_SHARE} of its obstacles
 * {@link StandingObstacle}s, each standing still in one seeded lane of
 * `steer.ts` §`LANE_OFFSETS_METRES`; the rest cross as above. A placement
 * holds one obstacle in each stretch of road, so no distance has more than one
 * lane blocked, and the test sweeps that. A round the rider cannot steer — a
 * room ride (DL9), or any ride that does not ask — places none, exactly as
 * before.
 *
 * An obstacle is **set going** when the rider comes within
 * {@link OBSTACLE_SIGHT_METRES} of it, waits there off the kerb for its
 * `startAfter` seconds, then crosses at its kind's speed. Placement chooses
 * `startAfter` so that a rider holding the obstacle's seeded on-time speed,
 * from {@link ON_TIME_SLOWEST_METRES_PER_SECOND} to
 * {@link ON_TIME_FASTEST_METRES_PER_SECOND}, reaches it as its middle crosses
 * the road's centre line. Faster arrives first; slower arrives after it has
 * gone. Every placed obstacle is avoidable at some speed from
 * {@link AVOIDABLE_SLOWEST_METRES_PER_SECOND} to
 * {@link AVOIDABLE_FASTEST_METRES_PER_SECOND} at every drawn line, and the
 * test sweeps that.
 *
 * ## The round's score, and only the round's (owner's ruling of 2026-10-28)
 *
 * {@link scoreAfter} keeps the day's round score **never below nought at any
 * moment**: a crash at nought costs nothing, so two crashes and then three
 * deliveries score 3. A crash comes off the round's score only. The week's
 * score is `round.ts` §`endRound`'s, deliveries only, and nothing here
 * reaches it: this module imports nothing from `round.ts` or
 * `delivery-progress.ts`.
 *
 * ## Our own roster (DL1)
 *
 * A wheelie bin, a hand trolley and a traffic cone, each rolling loose across
 * the road. No animal and no person is an obstacle: people are `people.ts`'
 * and are never on the carriageway. Nothing here is taken from another game.
 *
 * ## A level's obstacles: parked cars and bins, standing (#2362, ADR 0065 D-10.1)
 *
 * A built-in level's round adds a **parked car**, which stands at the kerb
 * side of the road — in one of the two kerb lanes of `steer.ts`
 * §`LANE_OFFSETS_METRES`, never the middle one, its outer side
 * {@link PARKED_CAR_KERB_GAP_METRES} off the kerb rather than on the lane's
 * middle ({@link parkedCarStands}) — and never crosses. It still blocks its
 * lane: a rider on that lane's middle meets it. A level
 * hands {@link placeObstacles} its {@link ObstacleMix}: how many obstacles a
 * kilometre, from its `round.hazardsPerKilometre.static`, and what share of
 * them stand. Its standing obstacles are drawn from
 * {@link LEVEL_STANDING_KINDS}, a parked car or a bin. Since the owner's
 * ruling of 2026-11-08 a level round's count is held to a range
 * ({@link levelObstacleMix}: level 1 always 2 or 3), and its span is cut into
 * that many equal stretches, none shorter than
 * {@link LEVEL_SHORTEST_STRETCH_METRES}. The one-in-each-stretch rule is
 * unchanged, so no distance has more than one lane blocked, a car's whole length
 * counted: an obstacle stands at least {@link OBSTACLE_SIGHT_METRES} into its
 * stretch, far more than any obstacle's half length. A ride with no mix — a
 * rider's own route — places exactly what it placed before.
 *
 * A crash into a parked car is drawn as one, not as a ride through it: from
 * the tick the rider touches it, {@link clearOfParkedCars} moves the rider's
 * drawn place to the car's road side for as long as the rider is beside it,
 * and leaves the lane they steer to as they chose it. It is a sideways move
 * of the drawing only and never a slow-down (ADR 0065 D-11): the rider's
 * distance, speed and the trainer's grade are the simulation's, and no other
 * obstacle meets the moved place (`ride-round.ts`), so it scores nothing.
 *
 * ## The route's own frame, and the tick
 *
 * Positions are a distance along the route (the odometer, as the rider's) and
 * an offset across it from the centre line, **positive to the rider's right**
 * (`racing-line.ts` §`ROAD_SIDE`). {@link stepObstacles} runs one tick of
 * `throw.ts` §`DELIVERY_TICK_SECONDS`, the simulation's own step, and sweeps
 * the rider back over the road it covered on that tick at its speed, so no
 * speed carries it through an obstacle between two ticks. An obstacle moves
 * at most a tenth of a metre a tick, far less than its own width and the
 * rider's, so its own position is taken at the tick's end.
 *
 * ⚠️ **The bicycle's size is written here, not imported**, and the test pins
 * it to `bicycle.ts`: that module imports `@onyourleft/store` and the design
 * tokens, and this one may reach nothing it does not need (ADR 0059 D-2).
 *
 * ## The numbers are this project's own, approved by the owner on 2026-10-28
 *
 * {@link OBSTACLE_SIGHT_METRES}, {@link OBSTACLE_SPACING_METRES}, the on-time
 * and avoidable speed ranges, {@link OBSTACLE_KINDS} and
 * {@link CRASH_SCORE_DELTA}, as proposed in #1811's pull request; nothing
 * else here hard-codes them.
 *
 * ## Fewer or none, the assist setting (#1813, DL10)
 *
 * {@link placeObstacles} takes the assist's `ObstacleSetting`: `'normal'`,
 * `'fewer'`, which keeps one in {@link FEWER_OBSTACLES_KEEP_ONE_IN} of the
 * obstacles `'normal'` places, each where it would have been, and `'none'`.
 * DL10 asked for **slower** obstacles as the middle choice, and in phase 0
 * that would be harder, not easier: an obstacle is dodged by timing, and one
 * that crosses more slowly is in the rider's line for longer, so more arrival
 * speeds meet it. Fewer is what lowers the pressure while the rider cannot
 * steer. The setting itself is `assist-preference.ts`'.
 *
 * ## Nothing here leaves the ride
 *
 * Obstacles are placed from the round's in-memory seed (#1808, ADR 0059 D-4)
 * and held in memory for the ride. No error message here formats a position,
 * a distance, a speed or a seed (CLAUDE.md §6, ADR 0004 D): each names the
 * field and the constraint.
 */

import { fmix32, mixInto, uniformFrom } from '../seeded';

import type { ObstacleSetting } from './assist-preference';
import type { LevelRound } from './levels/level-file';
import { LANE_OFFSETS_METRES } from './steer';
import { CARRIAGEWAY_HALF_WIDTH_METRES, DELIVERY_TICK_SECONDS } from './throw';

/** How far ahead of the rider an obstacle is set going, in metres. */
export const OBSTACLE_SIGHT_METRES = 60;

/**
 * The stretch of road each obstacle is placed in, in metres. Two obstacles
 * are never closer than {@link OBSTACLE_SIGHT_METRES}, so the next is set
 * going no sooner than the rider reaches the last.
 */
export const OBSTACLE_SPACING_METRES = 250;

/** The slowest seeded on-time speed: 6 m/s, 21.6 km/h. */
export const ON_TIME_SLOWEST_METRES_PER_SECOND = 6;

/** The fastest seeded on-time speed: 9 m/s, 32.4 km/h. */
export const ON_TIME_FASTEST_METRES_PER_SECOND = 9;

/**
 * The slow end of the speeds every obstacle must be avoidable within: 3 m/s, 10.8 km/h.
 *
 * @test-facing the bound `obstacles.test.ts` sweeps every placed obstacle's
 * avoidability over; placement is built to meet it and does not read it
 */
export const AVOIDABLE_SLOWEST_METRES_PER_SECOND = 3;

/**
 * The fast end of the speeds every obstacle must be avoidable within: 12 m/s, 43.2 km/h.
 *
 * @test-facing the other bound of `obstacles.test.ts`' sweep, as above
 */
export const AVOIDABLE_FASTEST_METRES_PER_SECOND = 12;

/** What one crash does to the round's score: one point off, as one delivery is one point on. */
export const CRASH_SCORE_DELTA = -1;

/** How far the bicycle reaches ahead of its origin, in metres: `bicycle.ts` §`BICYCLE_FRONT_METRES`, pinned by the test. */
export const RIDER_AHEAD_METRES = 0.86;

/** How far the bicycle reaches behind its origin, in metres: `bicycle.ts`' length less its front, pinned by the test. */
export const RIDER_BEHIND_METRES = 0.84;

/** Half the rider's width across the road, in metres: `bicycle.ts` §`RIDER_HALF_WIDTH_METRES`, pinned by the test. */
export const RIDER_HALF_WIDTH_METRES = 0.2;

/** What an obstacle is. */
export type ObstacleKind = 'bin' | 'trolley' | 'cone' | 'parked-car';

export interface ObstacleShape {
  /** Half its size along the road, in metres. */
  readonly halfLength: number;
  /** Half its size across the road, in metres. */
  readonly halfWidth: number;
  /** How fast it crosses the road, in metres a second; `0` for one that never crosses. */
  readonly speed: number;
}

/**
 * The roster. A parked car (#2362) is 4.4 m long and 1.8 m wide, and never
 * crosses: it only ever stands, so its speed is nought and nothing divides by it.
 */
export const OBSTACLE_KINDS: Readonly<Record<ObstacleKind, ObstacleShape>> = Object.freeze({
  bin: Object.freeze({ halfLength: 0.37, halfWidth: 0.3, speed: 1 }),
  trolley: Object.freeze({ halfLength: 0.25, halfWidth: 0.3, speed: 1.5 }),
  cone: Object.freeze({ halfLength: 0.2, halfWidth: 0.2, speed: 2 }),
  'parked-car': Object.freeze({ halfLength: 2.2, halfWidth: 0.9, speed: 0 }),
});

/**
 * The kinds that cross the road, in the order placement draws from. Written
 * out, not read off {@link OBSTACLE_KINDS}, so a kind added there does not
 * move a single obstacle on a rider's own route.
 */
export const CROSSING_OBSTACLE_KINDS: readonly ObstacleKind[] = Object.freeze([
  'bin',
  'trolley',
  'cone',
]);

/**
 * How far a parked car's outer side stands off the kerb, in metres — #2362:
 * **0.2**, less than the bicycle's width, so no rider squeezes past it on the
 * kerb side. This project's own number.
 */
export const PARKED_CAR_KERB_GAP_METRES = 0.2;

/**
 * How far a rider moved clear of a parked car is drawn from its side, in
 * metres — **0.75**, #2396. It was a hand's breadth (0.05) in #2362, and the
 * owner's comment of 2026-11-09 on #2396 found an unsteered ride drawn passing
 * every right-hand car that close. Three-quarters of a metre is about a car
 * door's swing, the room a rider leaves a parked car; it puts the rider's
 * middle 0.55 m right of the centre line, still on the road's right half.
 * This project's own number, for the owner's screenshots.
 */
export const PARKED_CAR_CLEARANCE_METRES = 0.75;

/**
 * Where a parked car stands across the road, in metres right of the centre
 * line, at the kerb on `side`: its outer side {@link PARKED_CAR_KERB_GAP_METRES}
 * inside the carriageway's edge, so in the kerb lane but not on its middle.
 */
export function parkedCarStands(side: 'left' | 'right'): number {
  const offset =
    CARRIAGEWAY_HALF_WIDTH_METRES -
    OBSTACLE_KINDS['parked-car'].halfWidth -
    PARKED_CAR_KERB_GAP_METRES;
  return side === 'left' ? -offset : offset;
}

/** The kinds a level's round stands in a lane (#2362, ADR 0065 D-10.1), in the order placement draws from. */
export const LEVEL_STANDING_KINDS: readonly ObstacleKind[] = Object.freeze(['parked-car', 'bin']);

/** One obstacle on the round, in memory for the ride only: one that crosses the road, or one that stands in a lane. */
export type Obstacle = CrossingObstacle | StandingObstacle;

/** An obstacle that crosses the carriageway, and is dodged by timing. */
export interface CrossingObstacle {
  readonly kind: ObstacleKind;
  /** Its distance along the route, in metres: the odometer, as the rider's. */
  readonly along: number;
  /** The kerb it comes from, facing the way the rider rides. */
  readonly from: 'left' | 'right';
  /** Seconds it waits off the kerb after it is set going, before it crosses. */
  readonly startAfter: number;
  /** It does not stand still. @see StandingObstacle.stands */
  readonly stands?: undefined;
}

/** An obstacle that stands still in one lane, on a round the rider can steer, and is dodged by changing lane — #1820. */
export interface StandingObstacle {
  readonly kind: ObstacleKind;
  /** Its distance along the route, in metres: the odometer, as the rider's. */
  readonly along: number;
  /**
   * Where it stands across the road, in metres right of the centre line: one
   * of `steer.ts` §`LANE_OFFSETS_METRES`, or for a parked car (#2362) its
   * kerb lane's kerb side, {@link parkedCarStands}.
   */
  readonly stands: number;
  /** It comes from no kerb. @see CrossingObstacle.from */
  readonly from?: undefined;
  /** It waits for nothing. @see CrossingObstacle.startAfter */
  readonly startAfter?: undefined;
}

/** Points off the round's score. ⚠️ No other field: no grade, no power, no resistance (DL5). */
export interface Crash {
  readonly scoreDelta: number;
}

/** Where each obstacle stands, indexed as the round's obstacles. */
export interface ObstacleState {
  /** Ticks run since the round's start. */
  readonly tick: number;
  /** The tick each obstacle was set going on; `undefined` until the rider comes within sight of it. */
  readonly startedAt: readonly (number | undefined)[];
  /** Each obstacle has been crashed into: a second touch of it costs nothing. */
  readonly crashed: readonly boolean[];
}

export interface ObstacleInput {
  /**
   * The rider after this simulation step: its distance along the route, in
   * metres, its drawn lateral offset, in metres right of the centre line, and
   * its speed, in metres a second.
   */
  readonly rider: { readonly along: number; readonly lateral: number; readonly speed: number };
  readonly obstacles: readonly Obstacle[];
}

export interface ObstacleStep {
  readonly state: ObstacleState;
  /** One crash for each obstacle first touched on this tick; usually none. */
  readonly crashes: readonly Crash[];
}

function refuse(constraint: string): never {
  throw new RangeError(`Delivery obstacles: ${constraint}`);
}

/** The offset an obstacle crosses from and to: just off the carriageway, its whole width clear of it. */
function kerbOffset(shape: ObstacleShape): number {
  return CARRIAGEWAY_HALF_WIDTH_METRES + shape.halfWidth;
}

/**
 * Where the middle of `obstacle` is across the road, `seconds` after it was
 * set going, in metres right of the centre line. Off the near kerb until its
 * `startAfter`, then crossing, then off the far kerb for good. #1814 draws it
 * here. A {@link StandingObstacle} is where it stands, at every moment.
 */
export function obstacleAcross(obstacle: Obstacle, seconds: number): number {
  if (obstacle.stands !== undefined) return obstacle.stands;
  const shape = OBSTACLE_KINDS[obstacle.kind];
  const kerb = kerbOffset(shape);
  const travelled = Math.min(2 * kerb, Math.max(0, (seconds - obstacle.startAfter) * shape.speed));
  const towardRight = obstacle.from === 'left' ? 1 : -1;
  return -towardRight * kerb + towardRight * travelled;
}

/**
 * With the assist's obstacle setting `'fewer'`, one obstacle is kept in this many:
 * **2**, so half as many, about one in each 500 m. This project's own number,
 * for the owner's approval in #1813's pull request.
 */
export const FEWER_OBSTACLES_KEEP_ONE_IN = 2;

/**
 * On a round the rider can steer, the share of its obstacles that stand in a
 * lane rather than cross: **one in two**, seeded. This project's own number,
 * for the owner's approval in #1820's pull request.
 */
export const STANDING_OBSTACLE_SHARE = 0.5;

/** Folded into the round's seed for the obstacles' own stream: any constant the target pick does not use. */
const OBSTACLE_STREAM = 0x0b57_ac1e;

/**
 * The fewest obstacles a level round places on the normal setting — #2362,
 * the owner's ruling of 2026-11-08 on PR #2378 ("Level 1 always has 2 to 3
 * obstacles"): **2**. This project's own number.
 */
export const LEVEL_FEWEST_OBSTACLES = 2;

/**
 * The shortest stretch a level round's obstacle is placed in, metres — #2362:
 * twice {@link OBSTACLE_SIGHT_METRES}, so each still stands at least that far
 * into its stretch and from the one before. A span too short for
 * {@link LEVEL_FEWEST_OBSTACLES} such stretches places fewer; no level round
 * is that short (`levels/level-obstacles.test.ts` starts each shipped level's
 * real rounds over their real spans; `obstacles.test.ts` holds the cap on a
 * short span).
 */
export const LEVEL_SHORTEST_STRETCH_METRES = 2 * OBSTACLE_SIGHT_METRES;

/**
 * A level's obstacles (#2362): how many a kilometre, how many of them stand,
 * and the range the count is held to. A level round's count is its density
 * over the round's own span, rounded up, held to {@link fewest} and
 * {@link most}; the span is then cut into that many equal stretches, one
 * obstacle in each, so the one-in-each-stretch rule and the sight distance
 * hold as on a rider's own route.
 */
export interface ObstacleMix {
  /** Obstacles a kilometre; nought or less places none. */
  readonly perKilometre: number;
  /** The share of them that stand in a lane, from none to all. */
  readonly standingShare: number;
  /** The fewest a round places. */
  readonly fewest: number;
  /** The most a round places. */
  readonly most: number;
}

/**
 * A level round's mix (#2362): its static hazards a kilometre, every one of
 * them standing, held to between {@link LEVEL_FEWEST_OBSTACLES} and the
 * density over the whole level's length, rounded up, and never fewer than
 * the fewest: Morning Round's 1 a kilometre on 2.1 km is 2 to 3, Busy
 * Round's 2 on 3.0 km is 2 to 6. Its moving hazards are #2364's, and place
 * nothing yet.
 */
export function levelObstacleMix(
  round: Pick<LevelRound, 'hazardsPerKilometre'>,
  lengthMetres: number,
): ObstacleMix {
  const perKilometre = round.hazardsPerKilometre.static;
  return {
    perKilometre,
    standingShare: 1,
    fewest: LEVEL_FEWEST_OBSTACLES,
    most: Math.max(LEVEL_FEWEST_OBSTACLES, Math.ceil((lengthMetres / 1000) * perKilometre)),
  };
}

export interface ObstaclePlacementInput {
  /** The rider's odometer reading when the round starts, metres. */
  readonly from: number;
  /** The odometer reading the round ends at, metres. */
  readonly to: number;
}

/**
 * Place the round's obstacles between `from` and `to` from the round's `seed`
 * (#1808's,
 * drawn when the round starts and never stored), one in each stretch of the
 * span: on a rider's own route each whole {@link OBSTACLE_SPACING_METRES} of
 * road; on a level, the span cut into {@link levelObstacleMix}'s count, its
 * density over the span rounded up and held to its fewest and most, each
 * stretch at least {@link LEVEL_SHORTEST_STRETCH_METRES}. The same seed and
 * input give the same obstacles. The first stands at least
 * {@link OBSTACLE_SIGHT_METRES} past `from`, so none is in sight at the start.
 * `setting` is the assist's (#1813): `'fewer'` keeps one in
 * {@link FEWER_OBSTACLES_KEEP_ONE_IN} of these, and `'none'` places none.
 * `steering` is whether the rider can change lane (#1820): with it,
 * {@link STANDING_OBSTACLE_SHARE} of them stand in a seeded lane, each at the
 * distance and of the kind it would have been; without it, none does.
 * `mix` is a level's (#2362): its count and stretch as above, its share how
 * many stand, and a standing one is one of {@link LEVEL_STANDING_KINDS}, a
 * parked car always in a kerb lane. Without it, as before.
 */
export function placeObstacles(
  input: ObstaclePlacementInput,
  seed: number,
  setting: ObstacleSetting = 'normal',
  steering = false,
  mix?: ObstacleMix,
): readonly Obstacle[] {
  const { from, to } = input;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    refuse('the seed is a whole number from 0 to 2³² − 1');
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    refuse('the round runs from a finite distance to one no shorter');
  }
  if (mix !== undefined && !(mix.perKilometre > 0)) return [];
  // A level's count is held to its range (#2362), the span cut into that many stretches.
  const count =
    mix === undefined
      ? Math.floor((to - from) / OBSTACLE_SPACING_METRES)
      : Math.min(
          Math.floor((to - from) / LEVEL_SHORTEST_STRETCH_METRES),
          Math.max(
            mix.fewest,
            Math.min(mix.most, Math.ceil(((to - from) / 1000) * mix.perKilometre)),
          ),
        );
  const spacing = mix === undefined ? OBSTACLE_SPACING_METRES : (to - from) / Math.max(1, count);
  const standingShare = mix === undefined ? STANDING_OBSTACLE_SHARE : mix.standingShare;
  // Its own stream of the round's seed, so obstacles do not follow the target pick.
  const base = mixInto(fmix32(seed), OBSTACLE_STREAM);
  const obstacles: Obstacle[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const hash = mixInto(base, slot);
    const kind = CROSSING_OBSTACLE_KINDS[
      Math.floor(uniformFrom(hash, 1) * CROSSING_OBSTACLE_KINDS.length)
    ] as ObstacleKind;
    const along =
      from +
      slot * spacing +
      OBSTACLE_SIGHT_METRES +
      uniformFrom(hash, 0) * (spacing - OBSTACLE_SIGHT_METRES);
    if (steering && uniformFrom(hash, 4) < standingShare) {
      const stands =
        mix === undefined
          ? kind
          : (LEVEL_STANDING_KINDS[
              Math.floor(uniformFrom(hash, 6) * LEVEL_STANDING_KINDS.length)
            ] as ObstacleKind);
      // A parked car stands at the kerb: in the first lane or the last, never
      // the middle, and at its kerb side rather than on its middle.
      if (stands === 'parked-car') {
        const side = uniformFrom(hash, 5) < 0.5 ? 'left' : 'right';
        obstacles.push({ kind: stands, along, stands: parkedCarStands(side) });
        continue;
      }
      const lane = Math.floor(uniformFrom(hash, 5) * LANE_OFFSETS_METRES.length);
      obstacles.push({ kind: stands, along, stands: LANE_OFFSETS_METRES[lane] as number });
      continue;
    }
    const shape = OBSTACLE_KINDS[kind];
    const onTime =
      ON_TIME_SLOWEST_METRES_PER_SECOND +
      uniformFrom(hash, 3) *
        (ON_TIME_FASTEST_METRES_PER_SECOND - ON_TIME_SLOWEST_METRES_PER_SECOND);
    obstacles.push({
      kind,
      along,
      from: uniformFrom(hash, 2) < 0.5 ? 'left' : 'right',
      startAfter: OBSTACLE_SIGHT_METRES / onTime - kerbOffset(shape) / shape.speed,
    });
  }
  if (setting === 'none') return [];
  if (setting === 'fewer') {
    return obstacles.filter((_, slot) => slot % FEWER_OBSTACLES_KEEP_ONE_IN === 0);
  }
  return obstacles;
}

/** A round's obstacles, none set going and none crashed into. */
export function startObstacles(obstacles: readonly Obstacle[]): ObstacleState {
  return {
    tick: 0,
    startedAt: obstacles.map(() => undefined),
    crashed: obstacles.map(() => false),
  };
}

/** Two closed intervals overlap by more than a touch. */
function overlaps(lowA: number, highA: number, lowB: number, highB: number): boolean {
  return lowA < highB && lowB < highA;
}

/**
 * Run one tick: set going any obstacle the rider has come within sight of,
 * then report a crash for each obstacle the rider touched on it that it had
 * not touched before. A crash is counted once per obstacle.
 */
export function stepObstacles(state: ObstacleState, input: ObstacleInput): ObstacleStep {
  const { rider, obstacles } = input;
  if (
    !Number.isFinite(rider.along) ||
    !Number.isFinite(rider.lateral) ||
    !Number.isFinite(rider.speed) ||
    rider.speed < 0
  ) {
    refuse(
      'the rider needs a finite distance and lateral offset, and a finite speed not below zero',
    );
  }
  if (obstacles.length !== state.crashed.length || obstacles.length !== state.startedAt.length) {
    refuse('the state is for a different number of obstacles');
  }
  const tick = state.tick + 1;
  const startedAt = [...state.startedAt];
  const crashed = [...state.crashed];
  const crashes: Crash[] = [];
  const riderBack = rider.along - rider.speed * DELIVERY_TICK_SECONDS - RIDER_BEHIND_METRES;
  const riderFront = rider.along + RIDER_AHEAD_METRES;
  obstacles.forEach((obstacle, index) => {
    if (startedAt[index] === undefined && rider.along >= obstacle.along - OBSTACLE_SIGHT_METRES) {
      startedAt[index] = tick;
    }
    const started = startedAt[index];
    if (started === undefined || crashed[index] === true) return;
    const shape = OBSTACLE_KINDS[obstacle.kind];
    if (
      !overlaps(
        riderBack,
        riderFront,
        obstacle.along - shape.halfLength,
        obstacle.along + shape.halfLength,
      )
    ) {
      return;
    }
    const across = obstacleAcross(obstacle, (tick - started) * DELIVERY_TICK_SECONDS);
    if (
      !overlaps(
        rider.lateral - RIDER_HALF_WIDTH_METRES,
        rider.lateral + RIDER_HALF_WIDTH_METRES,
        across - shape.halfWidth,
        across + shape.halfWidth,
      )
    ) {
      return;
    }
    crashed[index] = true;
    crashes.push({ scoreDelta: CRASH_SCORE_DELTA });
  });
  return { state: { tick, startedAt, crashed }, crashes };
}

/** Where a steered rider is drawn, and the lane they steer to: `lanes.ts` §`SteerState`'s shape. */
export interface DrawnLane {
  readonly lane: number;
  readonly offset: number;
}

/**
 * #2362: the rider moved clear of every parked car they have crashed into
 * and are still beside, or `undefined` when they are inside none. A crash is
 * drawn as one, not as a ride through the car: the rider's drawn place is the
 * car's road side, {@link PARKED_CAR_CLEARANCE_METRES} from it. **Only the
 * drawn offset moves**: the lane the rider steers to is theirs, kept as it
 * was (round 3 of PR #2378's review), so once past the car they ease back to
 * it at the steering's own speed. Their distance and speed are the
 * simulation's (ADR 0065 D-11). ⚠️ **Held by the car's width plus the
 * clearance** since #2396: a rider at the clearance who steers back toward the
 * car by any amount is beside it again and held, so the clearance may be more
 * than one tick's lane step without the rider drifting out of the hold and
 * back, a sawtooth every few ticks. A car not yet touched is left to
 * {@link stepObstacles}, which counts it. While a rider is held clear,
 * `ride-round.ts` meets every other obstacle at the lane they steer to, not at
 * the moved offset, so the move-aside never scores a crash of its own.
 */
export function clearOfParkedCars(
  obstacles: readonly Obstacle[],
  state: ObstacleState,
  rider: { readonly along: number; readonly lane: number; readonly offset: number },
): DrawnLane | undefined {
  let moved: DrawnLane | undefined;
  obstacles.forEach((obstacle, index) => {
    if (obstacle.kind !== 'parked-car' || obstacle.stands === undefined) return;
    if (state.crashed[index] !== true) return;
    const shape = OBSTACLE_KINDS[obstacle.kind];
    const offset = moved?.offset ?? rider.offset;
    // #2396: the car widened by the clearance, so a rider held at it, who
    // steers back toward the car by any amount, is inside again and held.
    const held = shape.halfWidth + PARKED_CAR_CLEARANCE_METRES;
    if (
      !overlaps(
        rider.along - RIDER_BEHIND_METRES,
        rider.along + RIDER_AHEAD_METRES,
        obstacle.along - shape.halfLength,
        obstacle.along + shape.halfLength,
      ) ||
      !overlaps(
        offset - RIDER_HALF_WIDTH_METRES,
        offset + RIDER_HALF_WIDTH_METRES,
        obstacle.stands - held,
        obstacle.stands + held,
      )
    ) {
      return;
    }
    const reach = shape.halfWidth + RIDER_HALF_WIDTH_METRES;
    const side = obstacle.stands > 0 ? -1 : 1;
    moved = {
      lane: rider.lane,
      offset: obstacle.stands + side * (reach + PARKED_CAR_CLEARANCE_METRES),
    };
  });
  return moved;
}

/** One change to the round's score, in the order it happened: a delivery, a point on, or a crash. */
export type ScoreChange = 'delivery' | Crash;

/**
 * The round's score after `change`: a delivery is a point on, a crash its
 * {@link Crash.scoreDelta}, and the score is never below nought at any moment,
 * so a crash at nought costs nothing. `ride-round.ts` (#1816) reports a
 * delivery here only when `throw.ts` §`stepThrows` landed one on a house.
 */
export function scoreAfter(score: number, change: ScoreChange): number {
  return Math.max(0, score + (change === 'delivery' ? 1 : change.scoreDelta));
}

/** The round's score after `changes`, in order, from nought: {@link scoreAfter} at each. */
export function roundScore(changes: readonly ScoreChange[]): number {
  return changes.reduce(scoreAfter, 0);
}
