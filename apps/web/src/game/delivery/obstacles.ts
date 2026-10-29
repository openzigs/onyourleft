// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Delivery's obstacles and the crash penalty, as pure logic on the game's own
 * tick — #1811, resting on the owner's rulings DL1 and DL5 of 2026-10-27
 * (epic #1803), recorded as ADR 0059 D-1 and D-2.
 *
 * @unwired Nothing runs a Delivery round yet. #1816 gives this module its
 * production caller when it runs a round inside a game ride, placing the
 * round's obstacles at its start and stepping them once for each simulation
 * step; until then only its tests reach it.
 *
 * ⚠️ **For #1816: step the obstacles only on a simulation step that actually
 * ran** — never while the ride is paused or stopped. A rolling obstacle still
 * crosses a rider whose speed is nought, so stepping on a tick the rider did
 * not ride would cost a point for not moving.
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

/** The slow end of the speeds every obstacle must be avoidable within: 3 m/s, 10.8 km/h. */
export const AVOIDABLE_SLOWEST_METRES_PER_SECOND = 3;

/** The fast end of the speeds every obstacle must be avoidable within: 12 m/s, 43.2 km/h. */
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
export type ObstacleKind = 'bin' | 'trolley' | 'cone';

export interface ObstacleShape {
  /** Half its size along the road, in metres. */
  readonly halfLength: number;
  /** Half its size across the road, in metres. */
  readonly halfWidth: number;
  /** How fast it crosses the road, in metres a second. */
  readonly speed: number;
}

/** The roster, in the order placement draws from. */
export const OBSTACLE_KINDS: Readonly<Record<ObstacleKind, ObstacleShape>> = Object.freeze({
  bin: Object.freeze({ halfLength: 0.37, halfWidth: 0.3, speed: 1 }),
  trolley: Object.freeze({ halfLength: 0.25, halfWidth: 0.3, speed: 1.5 }),
  cone: Object.freeze({ halfLength: 0.2, halfWidth: 0.2, speed: 2 }),
});

const KIND_ORDER = Object.keys(OBSTACLE_KINDS) as readonly ObstacleKind[];

/** One obstacle on the round, in memory for the ride only. */
export interface Obstacle {
  readonly kind: ObstacleKind;
  /** Its distance along the route, in metres: the odometer, as the rider's. */
  readonly along: number;
  /** The kerb it comes from, facing the way the rider rides. */
  readonly from: 'left' | 'right';
  /** Seconds it waits off the kerb after it is set going, before it crosses. */
  readonly startAfter: number;
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
 * here.
 */
export function obstacleAcross(obstacle: Obstacle, seconds: number): number {
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

/** Folded into the round's seed for the obstacles' own stream: any constant the target pick does not use. */
const OBSTACLE_STREAM = 0x0b57_ac1e;

export interface ObstaclePlacementInput {
  /** The rider's odometer reading when the round starts, metres. */
  readonly from: number;
  /** The odometer reading the round ends at, metres. */
  readonly to: number;
}

/**
 * Place the round's obstacles between `from` and `to`, one in each whole
 * {@link OBSTACLE_SPACING_METRES} of road, from the round's `seed` (#1808's,
 * drawn when the round starts and never stored). The same seed and input
 * give the same obstacles. The first stands at least
 * {@link OBSTACLE_SIGHT_METRES} past `from`, so none is in sight at the start.
 * `setting` is the assist's (#1813): `'fewer'` keeps one in
 * {@link FEWER_OBSTACLES_KEEP_ONE_IN} of these, and `'none'` places none.
 */
export function placeObstacles(
  input: ObstaclePlacementInput,
  seed: number,
  setting: ObstacleSetting = 'normal',
): readonly Obstacle[] {
  const { from, to } = input;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    refuse('the seed is a whole number from 0 to 2³² − 1');
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    refuse('the round runs from a finite distance to one no shorter');
  }
  const count = Math.floor((to - from) / OBSTACLE_SPACING_METRES);
  // Its own stream of the round's seed, so obstacles do not follow the target pick.
  const base = mixInto(fmix32(seed), OBSTACLE_STREAM);
  const obstacles: Obstacle[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const hash = mixInto(base, slot);
    const kind = KIND_ORDER[Math.floor(uniformFrom(hash, 1) * KIND_ORDER.length)] as ObstacleKind;
    const shape = OBSTACLE_KINDS[kind];
    const onTime =
      ON_TIME_SLOWEST_METRES_PER_SECOND +
      uniformFrom(hash, 3) *
        (ON_TIME_FASTEST_METRES_PER_SECOND - ON_TIME_SLOWEST_METRES_PER_SECOND);
    obstacles.push({
      kind,
      along:
        from +
        slot * OBSTACLE_SPACING_METRES +
        OBSTACLE_SIGHT_METRES +
        uniformFrom(hash, 0) * (OBSTACLE_SPACING_METRES - OBSTACLE_SIGHT_METRES),
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

/** One change to the round's score, in the order it happened: a delivery, a point on, or a crash. */
export type ScoreChange = 'delivery' | Crash;

/**
 * The round's score after `change`: a delivery is a point on, a crash its
 * {@link Crash.scoreDelta}, and the score is never below nought at any moment,
 * so a crash at nought costs nothing. #1816 reports a delivery here only when
 * `round.ts` §`recordDelivery` settled a house.
 */
export function scoreAfter(score: number, change: ScoreChange): number {
  return Math.max(0, score + (change === 'delivery' ? 1 : change.scoreDelta));
}

/** The round's score after `changes`, in order, from nought: {@link scoreAfter} at each. */
export function roundScore(changes: readonly ScoreChange[]): number {
  return changes.reduce(scoreAfter, 0);
}
