// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Is anybody on the bike — the pure three-state decision and the interval
 * absence has to last** ([#390](https://github.com/openzigs/onyourleft/issues/390)).
 *
 * Nothing here touches a camera, a canvas, a clock or a timer. It is handed
 * numbers and instants and returns one of three words, so every rule below is
 * tested with fixtures and no camera — the shape `consent.ts` and
 * `game/wind-choice.ts` already have.
 *
 * ## What it answers, and the one way it answers it
 *
 * **Did anything in the picture move in the last fraction of a second.** A
 * rider on a trainer pedals, and a pair of legs going round is the largest,
 * most regular movement in a side-on picture of a room; an empty bike on a
 * trainer whose ERG target is spinning the flywheel is a picture in which
 * nothing moves at all. So two coarse brightness grids are taken
 * {@link PRESENCE_PAIR_GAP_MILLISECONDS} apart and compared cell by cell —
 * frame differencing, and nothing else.
 *
 * ⚠️ **No pose model, no person detector, no model of any kind.** #390's own
 * note: *"every model added is a licence question, a size question, and CPU on
 * the thread already spending 24 ms per frame"*. Nothing here is committed as a
 * binary, so `ASSET001`–`ASSET006` have nothing to say, and nothing here can
 * tell a person from a curtain, which is the point: it derives **one of three
 * words** and nothing identifying, no pose, no count and no picture.
 *
 * ## Three answers, not two
 *
 * - `present` — something moved.
 * - `absent` — nothing has moved, in a picture the camera could read, for
 *   {@link PRESENCE_ABSENCE_MILLISECONDS} without a break.
 * - `unknown` — everything else: too dark, washed out, a featureless wall, a
 *   camera that is off, refused, throttled or has not answered lately.
 *
 * ⚠️ **`unknown` is the answer that changes nothing**, and every failure here
 * lands on it rather than on `absent`: a rider mid-interval must not be paused
 * because somebody switched a light off. `recording/channels.ts`
 * §`presenceAwareMovement` is where that becomes behaviour.
 *
 * ## ⚠️ What is NOT measured, said before anybody quotes a threshold
 *
 * The thresholds below are **argued, not tuned**. There is no committed footage
 * of a rider on a trainer to tune against — ADR 0029 D-2 discards frames by
 * default and a fixture of somebody's living room is exactly what D-11 keeps
 * off screens — and headless Chromium's synthetic camera is a rolling colour
 * pattern that moves every cell of every grid. Each constant carries its
 * reason at the declaration so that the device run can move it with the
 * argument in front of it, and the direction every one of them errs in is
 * `present` or `unknown`, which pause nothing.
 */

import type { LuminanceGrid } from './camera-port';
import type { RiderPresence } from '../recording/channels';

/**
 * The grid's width, in cells.
 *
 * 32 × 24 is 4:3 — what the synthetic camera and most webcams hand back — and
 * 768 cells. A side-on rider fills something like a third of the picture's
 * height, so a leg crosses several cells in any position, while a grid this
 * small is a few hundred numbers to read back rather than a frame.
 */
export const PRESENCE_GRID_COLUMNS = 32;

/** The grid's height, in cells. @see PRESENCE_GRID_COLUMNS */
export const PRESENCE_GRID_ROWS = 24;

/**
 * How often presence is checked — #390's *"stated, low rate"*.
 *
 * Presence changes on the scale of seconds, and nothing acts on an absence
 * until it has lasted {@link PRESENCE_ABSENCE_MILLISECONDS}; a check every two
 * seconds gives seven chances inside that window to see the rider move, and
 * costs two coarse samples every sixty frames at 30 fps rather than one a
 * frame. It is a rate a renderer does not notice — `game.browser.spec.ts`
 * §"what a presence check costs" is the measurement.
 */
export const PRESENCE_CHECK_MILLISECONDS = 2000;

/**
 * How far apart the two grids of one check are.
 *
 * ⚠️ **A pair taken close together, rather than one grid per check compared
 * with the last check's, and the reason is aliasing.** Two seconds apart, a
 * rider at 60, 90 or 120 rpm has turned the cranks a whole number of times and
 * the legs are exactly where they were — every common cadence would read as
 * "nothing moved". 150 ms is under a quarter of a revolution at 90 rpm and
 * would only alias at 400 rpm, which nobody pedals; at 40 rpm it is still more
 * than a tenth of a turn, which moves a foot across several cells.
 */
export const PRESENCE_PAIR_GAP_MILLISECONDS = 150;

/**
 * How long nothing may move before it counts as nobody being there.
 *
 * #390: *"A rider reaching for a bottle leaves frame for a second."* A rider
 * who stops to drink, towel off or read a phone is still for longer than that
 * and is still on the bike, so the window is fifteen seconds of unbroken
 * stillness — and the engine's own
 * `channels.ts` §`DEFAULT_AUTO_PAUSE_AFTER_SECONDS` is added on top before
 * anything is paused, so a ride stops accumulating about twenty-five seconds
 * after the rider walks away. An ERG block a rider is not on costs those
 * seconds; a rider paused while sitting on the bike costs trust, and this
 * errs towards the first.
 */
export const PRESENCE_ABSENCE_MILLISECONDS = 15_000;

/**
 * How old the last answer may be before it is no answer at all.
 *
 * Three missed checks. ⚠️ **This is what stops a stale `absent` pausing a ride
 * for ever**: a camera that stops being sampled — turned off, throttled by the
 * quality ladder, a tab in the background — leaves its last observation
 * behind, and a reading of that observation a minute later would be the
 * camera's opinion of a room it is no longer looking at.
 */
export const PRESENCE_STALE_MILLISECONDS = 3 * PRESENCE_CHECK_MILLISECONDS;

/**
 * Below this mean brightness the picture is too dark to say anything.
 *
 * Out of 255. A room with the light off, a lens covered by a hand. Stillness
 * in a picture this dark is the camera failing to see, not the room being
 * empty — which is precisely #390's *"paused because the room went dark"*.
 */
export const PRESENCE_DARK_MEAN = 20;

/** Above this mean brightness the picture is washed out. @see PRESENCE_DARK_MEAN */
export const PRESENCE_BRIGHT_MEAN = 245;

/**
 * Below this spread of brightness the picture has nothing in it to move.
 *
 * A standard deviation, out of 255, across the grid. A camera pointing at a
 * blank wall, or knocked face down on a towel, sees a uniform field in which a
 * rider could not be seen moving even if one were there.
 */
export const PRESENCE_FLAT_SPREAD = 4;

/**
 * How much one cell must change between the pair to count as having moved.
 *
 * Out of 255. A cell is the mean of a few hundred pixels, so sensor noise is
 * averaged down to about a level; sixteen is far above that and far below the
 * change a leg makes crossing a background.
 */
export const PRESENCE_CELL_CHANGE = 16;

/**
 * How many cells must move for the pair to count as movement.
 *
 * Four of 768: one cell can flicker for reasons nobody can name, four in a
 * hundred and fifty milliseconds is a thing moving. ⚠️ Deliberately a low bar
 * — too low is a curtain read as a rider, which pauses nothing; too high is a
 * rider read as an empty room, which does.
 */
export const PRESENCE_MOTION_CELLS = 4;

/** What one pair of grids shows. */
export type PresenceObservation = 'motion' | 'still' | 'unreadable';

/**
 * A brightness grid from raw RGBA pixels — the one conversion a platform
 * sampler needs, written here so it is tested with no canvas.
 *
 * Rec. 709 weights over the sRGB-encoded bytes, which is luma rather than
 * linear luminance; nothing here needs photometry, only a consistent number
 * for "brighter" that two samples of one camera agree on.
 *
 * @throws {RangeError} when the buffer is not `columns × rows × 4` bytes — a
 * canvas that answered with some other size is a fault, and a grid read from
 * the wrong stride would be noise that looks like motion.
 */
export function lumaGrid(rgba: ArrayLike<number>, columns: number, rows: number): LuminanceGrid {
  const cells = columns * rows;
  if (!Number.isInteger(cells) || cells <= 0 || rgba.length !== cells * 4) {
    throw new RangeError('a presence sample is not the size it was asked for');
  }
  const values = new Uint8Array(cells);
  for (let cell = 0; cell < cells; cell += 1) {
    const at = cell * 4;
    values[cell] = Math.round(
      0.2126 * (rgba[at] ?? 0) + 0.7152 * (rgba[at + 1] ?? 0) + 0.0722 * (rgba[at + 2] ?? 0),
    );
  }
  return { columns, rows, values };
}

/**
 * What a pair of grids taken {@link PRESENCE_PAIR_GAP_MILLISECONDS} apart
 * shows.
 *
 * ⚠️ **`unreadable` is checked before anything moves**, and on BOTH grids: a
 * light switched off between the two samples changes every cell and would
 * otherwise read as the biggest movement of the ride. The order is what makes
 * "the room went dark" `unknown` rather than `present` or `absent`.
 */
export function observePair(first: LuminanceGrid, second: LuminanceGrid): PresenceObservation {
  if (
    first.columns !== second.columns ||
    first.rows !== second.rows ||
    first.values.length !== second.values.length ||
    first.values.length === 0
  ) {
    return 'unreadable';
  }
  if (!readable(first) || !readable(second)) {
    return 'unreadable';
  }
  let moved = 0;
  for (let cell = 0; cell < first.values.length; cell += 1) {
    if (Math.abs((first.values[cell] ?? 0) - (second.values[cell] ?? 0)) >= PRESENCE_CELL_CHANGE) {
      moved += 1;
    }
  }
  return moved >= PRESENCE_MOTION_CELLS ? 'motion' : 'still';
}

function readable(grid: LuminanceGrid): boolean {
  const count = grid.values.length;
  let sum = 0;
  for (const value of grid.values) {
    sum += value;
  }
  const mean = sum / count;
  if (mean < PRESENCE_DARK_MEAN || mean > PRESENCE_BRIGHT_MEAN) {
    return false;
  }
  let squares = 0;
  for (const value of grid.values) {
    squares += (value - mean) ** 2;
  }
  return Math.sqrt(squares / count) >= PRESENCE_FLAT_SPREAD;
}

/**
 * Everything the decision carries between checks — and, ⚠️ deliberately, the
 * whole of what presence derives.
 *
 * Three primitives. No grid, no frame, no count of anything but milliseconds.
 * `presence.test.ts` §"all that is derived" asserts the shape.
 */
export interface PresenceTracker {
  readonly presence: RiderPresence;
  /** When the current unbroken run of stillness began, or `undefined`. */
  readonly stillSince: number | undefined;
  /** When the last observation was made, or `undefined` before the first. */
  readonly observedAt: number | undefined;
}

/** Before any check has run. */
export const PRESENCE_NOT_OBSERVED: PresenceTracker = {
  presence: 'unknown',
  stillSince: undefined,
  observedAt: undefined,
};

/**
 * The decision after one more observation, at `at` milliseconds.
 *
 * - `unreadable` → `unknown`, and the stillness run is **broken**: a dark
 *   minute in the middle of a still one is not a still minute.
 * - `motion` → `present`, and the run is broken.
 * - `still` → the run continues when the last observation was recent enough
 *   ({@link PRESENCE_STALE_MILLISECONDS}) and starts again otherwise. It is
 *   `absent` once the run has lasted {@link PRESENCE_ABSENCE_MILLISECONDS};
 *   until then the answer is what it was — `present` stays `present` through a
 *   rider's few still seconds — or `unknown` after a gap, because after a gap
 *   there is nothing to carry forward.
 */
export function nextPresence(
  tracker: PresenceTracker,
  observation: PresenceObservation,
  at: number,
): PresenceTracker {
  if (observation === 'unreadable') {
    return { presence: 'unknown', stillSince: undefined, observedAt: at };
  }
  if (observation === 'motion') {
    return { presence: 'present', stillSince: undefined, observedAt: at };
  }
  const fresh =
    tracker.observedAt !== undefined && at - tracker.observedAt <= PRESENCE_STALE_MILLISECONDS;
  const stillSince = fresh && tracker.stillSince !== undefined ? tracker.stillSince : at;
  const presence: RiderPresence =
    at - stillSince >= PRESENCE_ABSENCE_MILLISECONDS
      ? 'absent'
      : fresh
        ? tracker.presence
        : 'unknown';
  return { presence, stillSince, observedAt: at };
}

/**
 * The answer at `now`: the tracker's, unless it is stale, when it is
 * `unknown`. @see PRESENCE_STALE_MILLISECONDS
 */
export function presenceAt(tracker: PresenceTracker, now: number): RiderPresence {
  if (tracker.observedAt === undefined || now - tracker.observedAt > PRESENCE_STALE_MILLISECONDS) {
    return 'unknown';
  }
  return tracker.presence;
}

/**
 * What the Camera screen says about the presence check — #390.
 *
 * ⚠️ **`unknown` says what it does NOT do**, because that is the thing a rider
 * would otherwise worry about: a dark room does not pause their ride.
 */
export function presenceSentence(presence: RiderPresence): string {
  switch (presence) {
    case 'present':
      return 'Somebody is on the bike.';
    case 'absent':
      return 'Nobody has moved on the bike for a while, so your ride will pause shortly.';
    case 'unknown':
      return 'The camera cannot tell yet whether anybody is on the bike, so it will not pause your ride.';
  }
}
