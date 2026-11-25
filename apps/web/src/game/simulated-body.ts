// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The simulated rider's invented cadence and heart rate — #3210.
 *
 * The owner's ruling of 2026-11-25: *"For the preview I would like to see
 * made up numbers"*, and the same day *"make sure the made up numbers are
 * realistic"*. Until then the simulated rider (`simulated-rider.ts`, #1992)
 * reported power only, so the HUD showed a dash for cadence and heart rate
 * and the rider's legs did not turn: the crank angle is the integral of a
 * cadence reading (`bicycle.ts` §`advanceCrank`) and there was none.
 *
 * ⚠️ **Nothing here is a reading from a device, and nothing here is
 * recorded.** These numbers exist only on a simulated ride, which
 * `GameView.tsx` §`useSimulatedRide` builds with no trainer port, the game's
 * only way to the recording; `simulated-rider-wiring.test.tsx` holds that
 * a preview showing them records, saves and posts nothing.
 *
 * ## The model, and why each number is the one it is
 *
 * A fit amateur on an indoor ride. Every number below is a judgement from
 * what such a rider does, stated as one, never a measurement:
 *
 * - **Cadence** settles at {@link FLAT_CADENCE_LOW_RPM} rpm at an easy power,
 *   rising to {@link FLAT_CADENCE_HIGH_RPM} at a hard one: the 85–95 rpm a
 *   trained rider chooses on the flat. On a climb it falls
 *   {@link CLIMB_RPM_PER_PERCENT} rpm for each percent above
 *   {@link CLIMB_FROM_PERCENT} %, to at most {@link CLIMB_MOST_RPM} rpm less:
 *   about 77 rpm at 8 % and 70 rpm at 12 %, where the rider has run out of
 *   gears. On a surge — power above where it has been lately (a
 *   {@link SURGE_POWER_SECONDS} s average) — it spins up by as much as
 *   {@link SURGE_MOST_RPM} rpm, and eases back as the gears catch up. It
 *   follows that target with a {@link CADENCE_LAG_SECONDS} s lag, so it never
 *   steps, and a seeded wobble of at most ±2.6 rpm keeps it from being one
 *   fixed number. With no power it falls at {@link STOP_RPM_PER_SECOND} rpm a
 *   second to nought — under two seconds from any cadence above — and the
 *   legs stop.
 * - **Heart rate** starts at rest, {@link RESTING_BPM} bpm. Its target is a
 *   straight line from rest at no power to the rider's threshold heart rate at
 *   their threshold power — their own, when they have set them
 *   (`GamePort.ownThresholdPower`, `ownThresholdHeartRate`), else
 *   {@link DEFAULT_THRESHOLD_WATTS} W and {@link DEFAULT_THRESHOLD_BPM} bpm —
 *   and never more than {@link HEADROOM_BPM} bpm above that threshold. So
 *   endurance power (56–75 % of threshold) settles at about 126–145 bpm and
 *   threshold at 170. It approaches the target exponentially, over
 *   {@link HEART_RISE_SECONDS} s rising and {@link HEART_FALL_SECONDS} s
 *   falling, so it lags an effort by tens of seconds and recovers more slowly
 *   than it rose; a seeded wobble of at most ±1.2 bpm keeps it alive.
 *
 * No random jumps: the only noise is a sum of slow sines whose phases come
 * from the seed, so a test pins every curve and a frame rate cannot move one.
 * Both readings are whole numbers, as a sensor reports them.
 */

import { fmix32, uniformFrom } from './seeded';

/** Heart rate at rest, bpm. */
const RESTING_BPM = 70;
/** The threshold power assumed when the rider has set none: a fit amateur's, 3.3 W/kg at 75 kg. */
const DEFAULT_THRESHOLD_WATTS = 250;
/** The threshold heart rate assumed when the rider has set none. */
const DEFAULT_THRESHOLD_BPM = 170;
/** How far above threshold heart rate the rate may climb on any effort: a maximum. */
const HEADROOM_BPM = 15;
/** The time constant of a rising heart rate, seconds. */
const HEART_RISE_SECONDS = 30;
/** The time constant of a falling heart rate, seconds: recovery is slower. */
const HEART_FALL_SECONDS = 120;

/** Cadence on the flat at {@link EASY_WATTS} and below. */
const FLAT_CADENCE_LOW_RPM = 86;
/** Cadence on the flat at {@link HARD_WATTS} and above. */
const FLAT_CADENCE_HIGH_RPM = 94;
const EASY_WATTS = 100;
const HARD_WATTS = 500;
/** The gradient a climb begins to slow the legs at, percent. */
const CLIMB_FROM_PERCENT = 2;
/** How much each percent above it slows them, rpm. */
const CLIMB_RPM_PER_PERCENT = 1.8;
/** The most a climb slows them, rpm: the rider is in the lowest gear. */
const CLIMB_MOST_RPM = 18;
/** How long the power a surge is measured against is averaged over, seconds. */
const SURGE_POWER_SECONDS = 20;
/** The most a surge spins the legs up, rpm, at twice the recent power or more. */
const SURGE_MOST_RPM = 10;
/** The time constant cadence follows its target with, seconds. */
const CADENCE_LAG_SECONDS = 1.5;
/** How fast the legs stop once the power is gone, rpm a second. */
const STOP_RPM_PER_SECOND = 50;
/** Below this the wobble fades, so a cadence falling to nought reaches it. */
const FULL_WOBBLE_RPM = 60;

/**
 * The longest step integrated at once, seconds. With constant inputs every
 * update is exact for any step; the surge's average moves the cadence target
 * within a frame, and short steps keep that the same at 60 fps and at 32×.
 */
const STEP_SECONDS = 0.1;
/**
 * The most ride time integrated in one call, seconds — after a background tab,
 * say. Every lag here has settled long before it.
 */
const MOST_CATCH_UP_SECONDS = 600;

/** One slow sine of a wobble: its size and its period. */
interface Sine {
  readonly size: number;
  readonly seconds: number;
}

/** Cadence's wobble: at most 2.6 rpm either way. */
const CADENCE_WOBBLE: readonly Sine[] = [
  { size: 1.4, seconds: 11.3 },
  { size: 0.8, seconds: 5.7 },
  { size: 0.4, seconds: 2.9 },
];
/** Heart rate's wobble: at most 1.2 bpm either way. */
const HEART_WOBBLE: readonly Sine[] = [
  { size: 0.8, seconds: 17.3 },
  { size: 0.4, seconds: 7.1 },
];

/** The rider's own thresholds, when they have set them. */
export interface OwnThresholds {
  readonly power?: number | undefined;
  readonly heartRate?: number | undefined;
}

/** A threshold the rider set, if it is a usable one, else the default. */
function thresholdOr(own: number | undefined, fallback: number): number {
  return own !== undefined && Number.isFinite(own) && own > 0 ? own : fallback;
}

/** `value` held to `[low, high]`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** How much of the way to a target a lag of `tau` seconds goes in `seconds`. */
function approach(seconds: number, tau: number): number {
  return 1 - Math.exp(-seconds / tau);
}

/**
 * A body ridden on a simulated ride: advanced to each second of the ride with
 * the power and gradient then, and read for the cadence and heart rate it has.
 */
export class InventedBody {
  readonly #thresholdWatts: number;
  readonly #thresholdBpm: number;
  readonly #cadencePhases: readonly number[];
  readonly #heartPhases: readonly number[];
  #second: number | undefined;
  #cadence = 0;
  #heartRate = RESTING_BPM;
  #recentWatts = 0;

  /**
   * @param seed where the wobble's phases come from: one seed, one ride.
   * @param own the rider's own thresholds, which scale the heart rate.
   */
  constructor(seed: number, own: OwnThresholds = {}) {
    this.#thresholdWatts = thresholdOr(own.power, DEFAULT_THRESHOLD_WATTS);
    this.#thresholdBpm = thresholdOr(own.heartRate, DEFAULT_THRESHOLD_BPM);
    const base = fmix32(seed);
    this.#cadencePhases = CADENCE_WOBBLE.map((_, index) => uniformFrom(base, index) * 2 * Math.PI);
    this.#heartPhases = HEART_WOBBLE.map(
      (_, index) => uniformFrom(base, CADENCE_WOBBLE.length + index) * 2 * Math.PI,
    );
  }

  /**
   * The body at `second` of the ride, having ridden at `watts` up a
   * `gradePercent` road since the last call. The first call sets the clock
   * and the recent power, so a ride does not open on a surge; a second that
   * is not after the last changes nothing.
   */
  advanceTo(second: number, watts: number, gradePercent: number): void {
    const power = Number.isFinite(watts) ? Math.max(0, watts) : 0;
    const grade = Number.isFinite(gradePercent) ? gradePercent : 0;
    if (this.#second === undefined) {
      this.#second = second;
      this.#recentWatts = power;
      return;
    }
    let left = Math.min(second - this.#second, MOST_CATCH_UP_SECONDS);
    this.#second = Math.max(this.#second, second);
    while (left > 0) {
      const step = Math.min(STEP_SECONDS, left);
      this.#step(step, power, grade);
      left -= step;
    }
  }

  /** The cadence, whole rpm: nought exactly when the legs have stopped. */
  get cadence(): number {
    if (this.#cadence <= 0) return 0;
    const fade = Math.min(1, this.#cadence / FULL_WOBBLE_RPM);
    const wobble = fade * this.#wobble(CADENCE_WOBBLE, this.#cadencePhases);
    return Math.max(0, Math.round(this.#cadence + wobble));
  }

  /** The heart rate, whole bpm. */
  get heartRate(): number {
    return Math.round(this.#heartRate + this.#wobble(HEART_WOBBLE, this.#heartPhases));
  }

  #step(seconds: number, power: number, grade: number): void {
    this.#recentWatts += (power - this.#recentWatts) * approach(seconds, SURGE_POWER_SECONDS);
    const target = this.#cadenceTarget(power, grade);
    this.#cadence =
      target === 0
        ? Math.max(0, this.#cadence - STOP_RPM_PER_SECOND * seconds)
        : this.#cadence + (target - this.#cadence) * approach(seconds, CADENCE_LAG_SECONDS);
    const heart = Math.min(
      this.#thresholdBpm + HEADROOM_BPM,
      RESTING_BPM + ((this.#thresholdBpm - RESTING_BPM) * power) / this.#thresholdWatts,
    );
    const tau = heart > this.#heartRate ? HEART_RISE_SECONDS : HEART_FALL_SECONDS;
    this.#heartRate += (heart - this.#heartRate) * approach(seconds, tau);
  }

  /** What the legs settle towards at `power` on a `grade` road: nought with no power. */
  #cadenceTarget(power: number, grade: number): number {
    if (power <= 0) return 0;
    const effort = clamp((power - EASY_WATTS) / (HARD_WATTS - EASY_WATTS), 0, 1);
    const flat = FLAT_CADENCE_LOW_RPM + (FLAT_CADENCE_HIGH_RPM - FLAT_CADENCE_LOW_RPM) * effort;
    const climb = Math.min(
      CLIMB_MOST_RPM,
      CLIMB_RPM_PER_PERCENT * Math.max(0, grade - CLIMB_FROM_PERCENT),
    );
    const recent = Math.max(this.#recentWatts, EASY_WATTS / 2);
    const surge = SURGE_MOST_RPM * clamp((power - this.#recentWatts) / recent, -0.5, 1);
    return flat - climb + surge;
  }

  #wobble(sines: readonly Sine[], phases: readonly number[]): number {
    const at = this.#second ?? 0;
    let sum = 0;
    for (const [index, sine] of sines.entries()) {
      sum += sine.size * Math.sin((2 * Math.PI * at) / sine.seconds + (phases[index] ?? 0));
    }
    return sum;
  }
}
