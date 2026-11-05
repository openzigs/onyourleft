// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which position a rider is drawn in on the bicycle, chosen from what they are
 * doing — #1999, on the owner's ruling of 2026-11-02: *"the rider should take
 * different positions on the bike based on cadence"*.
 *
 * Five rules, in this order of precedence:
 *
 * 1. **Standing on a climb** — out of the saddle at a low cadence with high
 *    power ({@link STAND_BELOW_RPM}, {@link STAND_ABOVE_WATTS}), or on a steep
 *    grade ({@link STAND_ABOVE_GRADE_PERCENT}), while moving and pedalling.
 * 2. **The aero tuck for a hard seated effort** — the owner's ruling of
 *    2026-11-04, *"Yes, add aero"*: on flat or rolling ground
 *    ({@link AERO_WITHIN_GRADE_PERCENT}) at a high power
 *    ({@link AERO_ABOVE_WATTS}) and a high cadence ({@link AERO_ABOVE_RPM}),
 *    whatever the speed — even below the drops' 45 km/h.
 * 3. **The drops when fast** — at a high speed ({@link DROPS_ABOVE_METRES_PER_SECOND}),
 *    or descending fast ({@link DROPS_DESCENT_GRADE_PERCENT},
 *    {@link DROPS_DESCENT_METRES_PER_SECOND}).
 * 4. **The tops when easy** — sitting up, hands on the tops, at a low power
 *    ({@link TOPS_BELOW_WATTS}) or coasting.
 * 5. Otherwise **the hoods**, which is how every rider was drawn before.
 *
 * The fourth of the owner's rules, body motion that grows with effort and
 * cadence, is {@link ridingEffort} here and `bicycle.ts` §`riderMotion` there.
 *
 * ## Never a flicker
 *
 * Each rule has two thresholds, one to take the position and a gentler one to
 * keep it (hysteresis), and a new position is taken only once it has been
 * wanted for {@link POSTURE_DWELL_SECONDS} of riding. Then the body moves to it
 * over {@link POSTURE_TRANSITION_SECONDS}, from wherever it was drawn, so a
 * change part-way through another one is drawn without a jump.
 *
 * ⚠️ **On the RIDE's clock** (`RiderMarker.rideSeconds`), never a wall clock: a
 * held or paused ride holds its position and its transition. And **drawn
 * only**: nothing here reaches physics' drag or the trainer. The rider's chosen
 * `RidingPosition` (`rider.ts`) is what the drag area follows, and this file
 * never writes it.
 *
 * ## Whoever has no sensor
 *
 * The same rules on what each rider has (`port.ts` §`RidingInputs`): the bot
 * has a simulated power and no cadence; the ghost and a room's riders have
 * their speed and the grade under them. A rule whose reading is missing is
 * simply not met — a rider with no cadence sensor stands on a steep grade, but
 * never because of a cadence it does not have.
 */

import {
  type DrawnPosture,
  type RiderStance,
  blendStance,
  emptyRiderStance,
  stanceOf,
} from './bicycle';
import type { RidingInputs } from './port';

/**
 * Below this cadence, with {@link STAND_ABOVE_WATTS}, the rider stands:
 * **65 rpm**, the owner's figure — and the low cadence Li and Caldwell's
 * cadence study used (`bicycle.ts` §`STANDING_HIP_Y` cites it). Kept until the
 * cadence is back above {@link STAND_LEAVE_ABOVE_RPM}.
 */
export const STAND_BELOW_RPM = 65;
/** The cadence a standing rider sits back down above: **72 rpm**. @see STAND_BELOW_RPM */
export const STAND_LEAVE_ABOVE_RPM = 72;
/**
 * The power a low cadence must come with for the rider to stand: **300 W**.
 * ⚠️ **Chosen**: about the 295 W at which Caldwell et al. (1998) had riders
 * stand on an 8 % grade (`bicycle.ts` §`STANDING_HIP_Y`). An absolute figure,
 * because nothing the scene is handed knows the rider's own threshold.
 */
export const STAND_ABOVE_WATTS = 300;
/** The power a standing rider sits back down below: **250 W**. */
export const STAND_LEAVE_BELOW_WATTS = 250;
/** The grade a rider stands on whatever the cadence: **7 %**, the owner's figure. */
export const STAND_ABOVE_GRADE_PERCENT = 7;
/** The grade a rider standing for the grade sits back down below: **5.5 %**. */
export const STAND_LEAVE_BELOW_GRADE_PERCENT = 5.5;

/**
 * The power a rider tucks into the aero position above: **280 W**, with
 * {@link AERO_ABOVE_RPM}, on ground within {@link AERO_WITHIN_GRADE_PERCENT}.
 * ⚠️ **Chosen, for the owner to tune**: a hard seated effort for an ordinary
 * rider, absolute for {@link STAND_ABOVE_WATTS}'s reason. Kept until the
 * power falls below {@link AERO_LEAVE_BELOW_WATTS}.
 */
export const AERO_ABOVE_WATTS = 280;
/** The power a tucked rider sits back up below: **240 W**. ⚠️ Chosen. */
export const AERO_LEAVE_BELOW_WATTS = 240;
/**
 * The cadence a rider tucks above, with {@link AERO_ABOVE_WATTS}: **90 rpm**.
 * ⚠️ Chosen: a high seated cadence, well clear of standing's 65.
 */
export const AERO_ABOVE_RPM = 90;
/** The cadence a tucked rider sits back up below: **84 rpm**. ⚠️ Chosen. */
export const AERO_LEAVE_BELOW_RPM = 84;
/**
 * Flat or rolling ground, for the tuck: a grade within **±3 %**. ⚠️ Chosen:
 * steeper uphill a hard effort is a climb, steeper downhill it is a descent,
 * whose drops rule is its own. Kept within {@link AERO_LEAVE_BEYOND_GRADE_PERCENT}.
 */
export const AERO_WITHIN_GRADE_PERCENT = 3;
/** The grade either way a tucked rider sits back up beyond: **±4.5 %**. ⚠️ Chosen. */
export const AERO_LEAVE_BEYOND_GRADE_PERCENT = 4.5;

/** The speed a rider goes to the drops at: **12.5 m/s, 45 km/h**. ⚠️ Chosen. */
export const DROPS_ABOVE_METRES_PER_SECOND = 12.5;
/** The speed a rider in the drops comes back up below: **11.1 m/s, 40 km/h**. */
export const DROPS_LEAVE_BELOW_METRES_PER_SECOND = 11.1;
/** A descent steep enough to go to the drops on: **−3 %**. ⚠️ Chosen. */
export const DROPS_DESCENT_GRADE_PERCENT = -3;
/** The grade a rider descending in the drops comes back up above: **−2 %**. */
export const DROPS_LEAVE_DESCENT_GRADE_PERCENT = -2;
/** How fast a descent must be ridden for the drops: **9.7 m/s, 35 km/h**. */
export const DROPS_DESCENT_METRES_PER_SECOND = 9.7;
/** The descending speed a rider in the drops comes back up below: **8.3 m/s, 30 km/h**. */
export const DROPS_LEAVE_DESCENT_METRES_PER_SECOND = 8.3;

/** Below this power the rider sits up on the tops: **100 W**. ⚠️ Chosen. */
export const TOPS_BELOW_WATTS = 100;
/** The power a rider on the tops goes back to the hoods above: **130 W**. */
export const TOPS_LEAVE_ABOVE_WATTS = 130;

/** Slower than this a rider is not riding, and does not stand: **0.5 m/s**. */
const MOVING_METRES_PER_SECOND = 0.5;

/**
 * How long a new position must be wanted before it is taken: **0.75 s** of
 * riding. ⚠️ Chosen: long enough that a reading wavering about a threshold
 * changes nothing, short enough that a rider who attacks a climb is seen to
 * stand within a pedal stroke or so of doing it.
 */
export const POSTURE_DWELL_SECONDS = 0.75;

/**
 * How long the body takes to move from one position to the next: **0.8 s**,
 * eased at both ends. ⚠️ Chosen: about a pedal stroke at 75 rpm, which is how
 * long a rider takes to come out of the saddle.
 */
export const POSTURE_TRANSITION_SECONDS = 0.8;

/**
 * The position {@link RidingInputs} ask for, given the one being drawn — the
 * five rules with their hysteresis. A pure function.
 */
export function wantedPosture(
  inputs: RidingInputs | undefined,
  current: DrawnPosture,
): DrawnPosture {
  if (inputs === undefined) return 'hoods';
  const { cadence, power, grade, speed } = inputs;
  const moving = Number.isFinite(speed) && speed > MOVING_METRES_PER_SECOND;
  // A reading of nought on either is a rider not pedalling: they sit.
  const coasting = (cadence !== undefined && cadence < 1) || (power !== undefined && power < 1);
  const stood = current === 'standing';
  const steep =
    Number.isFinite(grade) &&
    grade > (stood ? STAND_LEAVE_BELOW_GRADE_PERCENT : STAND_ABOVE_GRADE_PERCENT);
  const grinding =
    cadence !== undefined &&
    power !== undefined &&
    cadence < (stood ? STAND_LEAVE_ABOVE_RPM : STAND_BELOW_RPM) &&
    power > (stood ? STAND_LEAVE_BELOW_WATTS : STAND_ABOVE_WATTS);
  if (moving && !coasting && (steep || grinding)) return 'standing';
  const tucked = current === 'aero';
  const rolling =
    Number.isFinite(grade) &&
    Math.abs(grade) <= (tucked ? AERO_LEAVE_BEYOND_GRADE_PERCENT : AERO_WITHIN_GRADE_PERCENT);
  const hard =
    cadence !== undefined &&
    power !== undefined &&
    cadence > (tucked ? AERO_LEAVE_BELOW_RPM : AERO_ABOVE_RPM) &&
    power > (tucked ? AERO_LEAVE_BELOW_WATTS : AERO_ABOVE_WATTS);
  if (moving && rolling && hard) return 'aero';
  const inDrops = current === 'drops';
  const fast =
    Number.isFinite(speed) &&
    speed >= (inDrops ? DROPS_LEAVE_BELOW_METRES_PER_SECOND : DROPS_ABOVE_METRES_PER_SECOND);
  const descending =
    Number.isFinite(grade) &&
    Number.isFinite(speed) &&
    grade <= (inDrops ? DROPS_LEAVE_DESCENT_GRADE_PERCENT : DROPS_DESCENT_GRADE_PERCENT) &&
    speed >= (inDrops ? DROPS_LEAVE_DESCENT_METRES_PER_SECOND : DROPS_DESCENT_METRES_PER_SECOND);
  if (fast || descending) return 'drops';
  const easy =
    power !== undefined &&
    power < (current === 'upright' ? TOPS_LEAVE_ABOVE_WATTS : TOPS_BELOW_WATTS);
  if (easy || coasting) return 'upright';
  return 'hoods';
}

/**
 * How hard a rider is working, 0 to 1 — #1999's fourth rule, which
 * `bicycle.ts` §`riderMotion` scales the body's rock by. The mean of what the
 * rider has: power from 75 W (0) to 375 W (1), and cadence from 50 rpm (0) to
 * 110 rpm (1). With neither it is 0.5, the rock #625 drew before.
 *
 * ⚠️ **Chosen ranges**: an easy spin to a hard effort for an ordinary rider. A
 * rider's own threshold would be better, and nothing the scene is handed has
 * it.
 */
export function ridingEffort(inputs: RidingInputs | undefined): number {
  if (inputs === undefined) return 0.5;
  let sum = 0;
  let count = 0;
  if (inputs.power !== undefined && Number.isFinite(inputs.power)) {
    sum += Math.min(1, Math.max(0, (inputs.power - 75) / 300));
    count += 1;
  }
  if (inputs.cadence !== undefined && Number.isFinite(inputs.cadence)) {
    sum += Math.min(1, Math.max(0, (inputs.cadence - 50) / 60));
    count += 1;
  }
  return count === 0 ? 0.5 : sum / count;
}

/**
 * One rider's drawn position over time — #1999. Mutable and advanced in place
 * by {@link trackPosture}, once per rider per frame; made once by
 * {@link emptyPostureTracker}.
 */
export interface PostureTracker {
  /** The position being drawn, or moved toward. */
  posture: DrawnPosture;
  /** A different position the inputs ask for, not yet held long enough. */
  wanted: DrawnPosture;
  /** The ride time {@link wanted} was first asked for. */
  wantedSince: number;
  /** The ride time {@link posture} was taken. */
  changedAt: number;
  /** The ride time last tracked; a ride clock that goes back starts afresh. */
  lastSeconds: number;
  /** Whether anything has been tracked yet. */
  started: boolean;
  /** Where the body was drawn when {@link posture} was taken. */
  readonly from: RiderStance;
}

/** A tracker to advance, made once. @see trackPosture */
export function emptyPostureTracker(): PostureTracker {
  return {
    posture: 'hoods',
    wanted: 'hoods',
    wantedSince: 0,
    changedAt: Number.NEGATIVE_INFINITY,
    lastSeconds: 0,
    started: false,
    from: emptyRiderStance(),
  };
}

/**
 * Advances `tracker` to `rideSeconds` with this frame's inputs — the dwell and
 * the hysteresis. The first frame, and the first after the ride clock goes
 * back (a new ride), takes the wanted position at once, with no transition.
 * Allocates nothing.
 */
export function trackPosture(
  tracker: PostureTracker,
  inputs: RidingInputs | undefined,
  rideSeconds: number,
): PostureTracker {
  const now = Number.isFinite(rideSeconds) ? rideSeconds : tracker.lastSeconds;
  if (!tracker.started || now < tracker.lastSeconds) {
    const first = wantedPosture(inputs, 'hoods');
    tracker.posture = first;
    tracker.wanted = first;
    tracker.wantedSince = now;
    tracker.changedAt = Number.NEGATIVE_INFINITY;
    tracker.started = true;
    tracker.lastSeconds = now;
    stanceOf(first, tracker.from);
    return tracker;
  }
  tracker.lastSeconds = now;
  const want = wantedPosture(inputs, tracker.posture);
  if (want === tracker.posture) {
    tracker.wanted = want;
    return tracker;
  }
  if (want !== tracker.wanted) {
    tracker.wanted = want;
    tracker.wantedSince = now;
    return tracker;
  }
  if (now - tracker.wantedSince >= POSTURE_DWELL_SECONDS) {
    // From wherever the body is drawn now, which is part-way through the last
    // change if that has not finished.
    drawnStance(tracker, now, tracker.from);
    tracker.posture = want;
    tracker.changedAt = now;
  }
  return tracker;
}

/**
 * Where the tracked rider's body is drawn at `rideSeconds`, written into
 * `into`: eased from where it was when the position changed to the position's
 * own stance over {@link POSTURE_TRANSITION_SECONDS}. `into` may be
 * `tracker.from`. Allocates nothing.
 */
export function drawnStance(
  tracker: PostureTracker,
  rideSeconds: number,
  into: RiderStance,
): RiderStance {
  const elapsed = (rideSeconds - tracker.changedAt) / POSTURE_TRANSITION_SECONDS;
  const t = Number.isFinite(elapsed) ? Math.min(1, Math.max(0, elapsed)) : 1;
  const eased = t * t * (3 - 2 * t);
  const to = stanceOf(tracker.posture, TARGET);
  return blendStance(tracker.from, to, eased, into);
}

/** The target stance, written into by {@link drawnStance} and read at once. */
const TARGET = emptyRiderStance();
