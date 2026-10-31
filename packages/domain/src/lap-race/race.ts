// SPDX-License-Identifier: Apache-2.0

/**
 * The lap race's model — #1897, ADR 0060 D-3 and D-4.
 *
 * A racer, rider or bot, holds **two distances**, and this file is where they
 * are kept apart:
 *
 * - **`effortDistance`**: the metres the racer's own power has earned through
 *   the one physics (`@onyourleft/physics` §`advance`), or, in a room, the
 *   distance the room's re-simulation gives (ADR 0028 D-2). **This module
 *   never computes it**: it is handed in by {@link withEffortDistance}. It is
 *   the only distance the trainer's grade is read at and the only one a ride
 *   records (ADR 0060 D-2.1, D-2.4).
 * - **`raceOffset`**: a separate number of metres that only item effects move,
 *   **clamped to `[−B, +B]` after every change** ({@link applyOffset}), with
 *   B = {@link RACE_OFFSET_BOUND_METRES} = 10 m (D-3.3).
 *
 * A racer is drawn and ranked at **`effortDistance + raceOffset`**
 * ({@link racePosition}), and its laps and its finish are counted at that
 * drawn distance (D-3.3).
 *
 * ## ⚠️ Nothing moves the offset into the effort, or the effort into the offset
 *
 * D-3.4: nothing adds the offset to `effortDistance`, and nothing derives the
 * offset from it. {@link applyOffset} returns the racer it was given with one
 * field changed; {@link withEffortDistance} likewise. `race.test.ts` applies
 * ten thousand offsets and reads `effortDistance` back unchanged.
 *
 * ## The fairness rule this clamp buys (D-4.1)
 *
 * *If, at the instant the first of two racers X and Y reaches the race length
 * at their drawn distance, X's `effortDistance` exceeds Y's by more than 2B,
 * then X finishes ahead of Y, under any item sequence.* Y's drawn distance is
 * at most `eY + B`, which is less than `eX − B`, which is at most X's. The
 * clamp is the whole proof, which is why the property test in `race.test.ts`
 * goes red without it.
 *
 * ## Laps, by the odometer's arithmetic
 *
 * {@link lapsAt} is `floor(distance / length)` with the same guards as
 * `apps/web/src/game/course-laps.ts` §`courseLapsDone` on a loop, so the two
 * give the same count **for the same distance**; an `apps/web` test calls
 * both. They are not handed the same distance: the HUD counts at the rider's
 * effort distance and this model at the drawn distance (D-3.3), so within B of
 * a lap line the HUD's lap and the race's may differ by one, by design.
 *
 * ## The finish, and what it fixes
 *
 * {@link settle} counts a racer's laps at its drawn distance and, the first
 * time that count reaches the race's laps, stamps `finishedAtMs` with
 * the instant the caller passes in and `lineMetres` with the drawn distance
 * then. From then on the race result is final: `finishedAtMs`, `lineMetres`
 * and `lapsDone` never change again, and {@link applyOffset} returns the
 * racer unchanged, because no item reaches a finished racer. Without
 * `lineMetres`, two racers who crossed in the same tick would be ordered by
 * where they had got to since, and a finish order could change after the race.
 *
 * ⚠️ **`effortDistance` keeps following the physics after the finish.**
 * {@link withEffortDistance} still writes it, because it is the rider's own
 * ride and not the race's (D-2.4). Freezing it at the line would make a racer
 * whom items brought home sooner hold a different effort distance from the
 * same ride without items. That breaks #1899's "effort is untouched" test,
 * which is how this was found.
 *
 * ## Ties, stated
 *
 * {@link standings}: finished racers first, by `finishedAtMs`; those who
 * finished at the same instant by `lineMetres`, their drawn distance at the line, furthest
 * first (the one further past the line crossed it earlier in the tick); then
 * racers still riding by drawn distance, furthest first; and **every remaining
 * tie by `id`, in code-unit order** (not `localeCompare`, whose answer depends
 * on the platform's locale data). Ids are unique within a field.
 *
 * ## Pure
 *
 * No clock, no `Math.random`, no platform global (`docs/agents/lint-boundaries.md`
 * §4d; `eslint.config.js` refuses `Date` and `Math.random` under this
 * directory). Time arrives as `atMs`. Every racer, rider or bot, goes through
 * the same functions.
 */

import { LapRaceError } from './errors';

/**
 * B, the most items may move a racer's drawn distance from its effort
 * distance: **10 m** (ADR 0060 D-3.3, the owner's answer to D-14 Q1).
 *
 * About one second of road at a race pace of 36 km/h, which is the most the
 * trainer already holds a grade for between writes. Raising it needs a
 * superseding ADR, because D-4's rule and this module's tests are written
 * against it.
 */
export const RACE_OFFSET_BOUND_METRES = 10;

/** A race, as the model needs it: never its geometry (as `RoomCourse` in `apps/instance`). */
export interface RaceCourse {
  /** One lap, in metres. */
  readonly lapLengthMetres: number;
  /** How many laps the race is. */
  readonly laps: number;
}

/** One racer's race state. Rider or bot, the same shape. */
export interface RacerState {
  /** Unique within a field; the last tie-break in {@link standings}. */
  readonly id: string;
  /** Metres the racer's own power earned through the one physics. Handed in, never computed here. */
  readonly effortDistance: number;
  /** Metres items have moved the racer, within `[−B, +B]`. */
  readonly raceOffset: number;
  /** Laps completed at the drawn distance, at most the race's laps. */
  readonly lapsDone: number;
  /** The instant the laps at the drawn distance first reached the race's laps, or `null` while still riding. */
  readonly finishedAtMs: number | null;
  /** The drawn distance at that instant, or `null` while still riding: a same-instant finish's tie-break. */
  readonly lineMetres: number | null;
}

/** A race course, checked. @throws {LapRaceError} for a lap length or count that cannot be raced. */
export function raceCourse(lapLengthMetres: number, laps: number): RaceCourse {
  if (!Number.isFinite(lapLengthMetres) || lapLengthMetres <= 0) {
    throw new LapRaceError(
      'lap-length-out-of-range',
      'lapLengthMetres must be a finite number of metres above zero',
    );
  }
  if (!Number.isInteger(laps) || laps < 1) {
    throw new LapRaceError('laps-out-of-range', 'laps must be a whole number of at least one');
  }
  return { lapLengthMetres, laps };
}

/** A racer on the line: no effort, no offset, no laps, not finished. */
export function startingRacer(id: string): RacerState {
  return {
    id,
    effortDistance: 0,
    raceOffset: 0,
    lapsDone: 0,
    finishedAtMs: null,
    lineMetres: null,
  };
}

/** Where the racer is drawn and ranked: `effortDistance + raceOffset` (D-3.3). */
export function racePosition(racer: RacerState): number {
  return racer.effortDistance + racer.raceOffset;
}

/**
 * Laps completed at `distance` on a loop of `lapLengthMetres`: `floor(distance
 * / length)`, and 0 for a length or a distance that is not above zero — the
 * arithmetic and the guards of `course-laps.ts` §`courseLapsDone` on a loop.
 */
export function lapsAt(lapLengthMetres: number, distance: number): number {
  if (!(lapLengthMetres > 0) || !(distance > 0)) {
    return 0;
  }
  return Math.floor(distance / lapLengthMetres);
}

/**
 * The racer with the effort distance the physics gave it, before and after the
 * finish alike: the effort is the ride's, and the result is fixed by
 * `finishedAtMs` and `lineMetres`.
 *
 * @throws {LapRaceError} for a distance that is not finite.
 */
export function withEffortDistance(racer: RacerState, effortDistance: number): RacerState {
  if (!Number.isFinite(effortDistance)) {
    throw new LapRaceError(
      'effort-distance-not-finite',
      'effortDistance must be a finite number of metres',
    );
  }
  return { ...racer, effortDistance };
}

/**
 * Move the racer's race offset by `deltaMetres`, clamped to `[−bound, +bound]`.
 * `effortDistance` is never read or written here (D-3.4). A finished racer is
 * returned unchanged.
 *
 * `bound` may be smaller than B, never larger: raising B needs a superseding
 * ADR (ADR 0060), so a caller cannot raise it by passing a wider bound.
 *
 * @throws {LapRaceError} for a change that is not finite, or a bound that is
 * not a number of metres above zero and at most {@link RACE_OFFSET_BOUND_METRES}.
 */
export function applyOffset(
  racer: RacerState,
  deltaMetres: number,
  bound: number = RACE_OFFSET_BOUND_METRES,
): RacerState {
  if (!Number.isFinite(deltaMetres)) {
    throw new LapRaceError('offset-not-finite', 'deltaMetres must be a finite number of metres');
  }
  if (!Number.isFinite(bound) || bound <= 0) {
    throw new LapRaceError(
      'bound-out-of-range',
      'bound must be a finite number of metres above zero',
    );
  }
  if (bound > RACE_OFFSET_BOUND_METRES) {
    throw new LapRaceError(
      'bound-out-of-range',
      'bound must be at most RACE_OFFSET_BOUND_METRES, which only a superseding ADR raises',
    );
  }
  if (racer.finishedAtMs !== null) {
    return racer;
  }
  const raceOffset = Math.min(bound, Math.max(-bound, racer.raceOffset + deltaMetres));
  return { ...racer, raceOffset };
}

/**
 * Count the racer's laps at its drawn distance, and stamp the finish the first
 * time that count reaches the race's laps. The finish is derived from the lap
 * count and not from `at >= lapLength × laps`: the two disagree within an ulp
 * of the line (a lap of 2655.900242345683 m, 13 laps, at 34526.70315049388 m
 * is past the product and on lap 12 by `floor`), and a result frozen on a
 * disagreement would be wrong for good. Call it after every change to
 * either distance, with the instant the change belongs to.
 *
 * @throws {LapRaceError} for an instant that is not finite.
 */
export function settle(racer: RacerState, course: RaceCourse, atMs: number): RacerState {
  if (!Number.isFinite(atMs)) {
    throw new LapRaceError('instant-not-finite', 'atMs must be a finite number of milliseconds');
  }
  if (racer.finishedAtMs !== null) {
    return racer;
  }
  const at = racePosition(racer);
  const laps = lapsAt(course.lapLengthMetres, at);
  const finished = laps >= course.laps;
  return {
    ...racer,
    lapsDone: Math.min(course.laps, laps),
    finishedAtMs: finished ? atMs : null,
    lineMetres: finished ? at : null,
  };
}

/** Code-unit order, the same on every platform. */
function byId(a: RacerState, b: RacerState): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The racer ahead first, by the rule in the header. */
function ahead(a: RacerState, b: RacerState): number {
  if (a.finishedAtMs !== null && b.finishedAtMs !== null) {
    return (
      a.finishedAtMs - b.finishedAtMs || (b.lineMetres ?? 0) - (a.lineMetres ?? 0) || byId(a, b)
    );
  }
  if (a.finishedAtMs !== null) return -1;
  if (b.finishedAtMs !== null) return 1;
  return racePosition(b) - racePosition(a) || byId(a, b);
}

/** The field's ids, leader first: finished racers by `finishedAtMs`, then the rest by drawn distance. */
export function standings(field: readonly RacerState[]): readonly string[] {
  return [...field].sort(ahead).map((racer) => racer.id);
}
