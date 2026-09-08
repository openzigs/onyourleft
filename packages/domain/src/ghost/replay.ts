// SPDX-License-Identifier: Apache-2.0

/**
 * Racing your own previous attempt — #93, minus its screen.
 *
 * ## What a ghost is here, and the line it must not cross
 *
 * ⚠️ Read this before extending anything in this file. Per ADR 0007 D-2 and
 * #59, the Peloton patent family (US 10,486,026, which survived IPR2020-01541;
 * US 11,170,886) was asserted against Echelon and iFIT over — in the complaint's
 * own words — *"live performance parameters … used in subsequent sessions … to
 * enable ghost participants"*, and **both defendants settled by removing the
 * on-demand leaderboard technology** rather than litigate. #93 draws the line
 * this file has to hold:
 *
 * - ✅ **Your own previous ride, on the same route, as a private pacing aid.**
 * - ❌ **A ghost of another rider.** Not now, not behind a setting, not later.
 * - ❌ **Any ranked leaderboard populated by ghost participants.**
 *
 * Nothing in this module takes an athlete id, so it cannot itself tell one
 * rider's ride from another's — the scoping is in the query that produced the
 * samples, `ActivityStore.listRouteAttempts`, whose whole design is that it
 * cannot run without an athlete. That split is deliberate: this file is the
 * arithmetic, and the arithmetic is not where a cross-rider ghost would be
 * introduced. It would be introduced by handing this function somebody else's
 * samples, which is why the store's scoping test is the one that guards the
 * patent line rather than this file's tests.
 *
 * If a future issue proposes cross-rider ghosts it reopens #59 first. That is
 * not a formality: it is the difference between this feature and the one two
 * companies removed under settlement.
 *
 * ## Replay what happened, do not re-simulate it
 *
 * #93's implementation note, and it is load-bearing:
 *
 * > *"The ghost replays position-versus-distance from a stored activity, not
 * > power. Replaying power and re-simulating would produce a different line than
 * > the rider actually achieved if the physics coefficients or rider weight have
 * > changed since — which is confusing rather than motivating. Store what
 * > happened, replay what happened."*
 *
 * So this module consumes **distance against elapsed time** and never touches
 * `@onyourleft/physics`. A ghost built by re-simulating a stored power series
 * would drift from the rider's actual result the moment they changed their mass
 * in settings — and would then show them losing to a ride they in fact beat.
 * That is also why {@link buildGhostTrack} refuses a non-monotonic distance
 * rather than repairing it: the repair would move the ghost somewhere the rider
 * never was.
 *
 * ## The gap is the bot's gap
 *
 * There is no gap arithmetic here. A ghost is a third odometer, and
 * `pacer/gap.ts`'s {@link pacerGap} already compares two of them without
 * wrapping — which is exactly the behaviour a ghost needs on a loop, where an
 * attempt a lap ahead must read as a lap ahead rather than as level. Writing a
 * second "distance ÷ speed" here is the one-liner that header warns about.
 */

import { GhostError } from './errors';
import type { Metres, Seconds } from '../quantities';
import { metres, seconds } from '../quantities';

/**
 * One recorded attempt, reduced to the two series a replay needs.
 *
 * Deliberately **not** a stream set and deliberately not a `RouteProfile`. It is
 * what the ghost is: how far the rider had gone, at each moment. Everything else
 * about the ride — power, heart rate, the route's geometry — is either irrelevant
 * to where the ghost is or is the thing this file refuses to re-derive.
 */
export interface GhostTrack {
  /**
   * Elapsed seconds from the start of the attempt, strictly increasing.
   *
   * Elapsed rather than absolute: two attempts made months apart start at the
   * same zero, which is the only way they can be raced against each other.
   */
  readonly elapsed: readonly Seconds[];
  /** The odometer at each entry in {@link elapsed}, never decreasing. */
  readonly distance: readonly Metres[];
  /** The attempt's total, i.e. the last entry of {@link distance}. */
  readonly totalDistance: Metres;
  /** The attempt's duration, i.e. the last entry of {@link elapsed}. */
  readonly totalTime: Seconds;
}

/** The samples a stored ride contributes. Plain numbers — see {@link buildGhostTrack}. */
export interface GhostSamples {
  /** Elapsed seconds per sample, from the ride's own time base. */
  readonly elapsedSeconds: readonly number[];
  /** Cumulative distance in metres per sample. */
  readonly distanceMetres: readonly number[];
}

/**
 * Builds a replayable track from one stored attempt.
 *
 * Takes plain numbers rather than branded quantities because its caller is a
 * decoded stream, where the numbers arrive untyped — branding them here, once,
 * at the point they are also validated, is cheaper than branding them at the
 * call site and validating them here anyway.
 *
 * @throws {GhostError} when the samples cannot describe a ride. Every refusal is
 * about the *recording*, so a screen can say which attempt it could not offer
 * and why, rather than silently listing one fewer.
 */
export function buildGhostTrack(samples: GhostSamples): GhostTrack {
  const { elapsedSeconds, distanceMetres } = samples;
  if (elapsedSeconds.length !== distanceMetres.length) {
    throw new GhostError(
      'length-mismatch',
      `a ghost needs one distance per time, received ${String(elapsedSeconds.length)} times and ${String(distanceMetres.length)} distances`,
    );
  }
  if (elapsedSeconds.length < 2) {
    throw new GhostError(
      'too-few-samples',
      `a ghost needs at least 2 samples to interpolate between, received ${String(elapsedSeconds.length)}`,
    );
  }

  const elapsed: Seconds[] = [];
  const distance: Metres[] = [];
  for (let index = 0; index < elapsedSeconds.length; index += 1) {
    const time = elapsedSeconds[index] as number;
    const covered = distanceMetres[index] as number;
    if (!Number.isFinite(time) || !Number.isFinite(covered)) {
      throw new GhostError('sample-not-finite', `sample ${String(index)} is not a finite number`);
    }
    if (index > 0) {
      // Strictly increasing, not merely non-decreasing: two samples sharing an
      // elapsed time make the lookup ambiguous, and a recorder that emitted
      // them has a clock problem worth surfacing rather than averaging over.
      const previousTime = elapsedSeconds[index - 1] as number;
      if (time <= previousTime) {
        throw new GhostError(
          'time-not-increasing',
          `elapsed time must increase strictly; sample ${String(index)} does not follow sample ${String(index - 1)}`,
        );
      }
      const previousDistance = distanceMetres[index - 1] as number;
      if (covered < previousDistance) {
        // Refused, not clamped — see `errors.ts` §`distance-not-monotonic`.
        throw new GhostError(
          'distance-not-monotonic',
          `distance must never decrease; sample ${String(index)} goes backwards`,
        );
      }
    }
    elapsed.push(seconds(time));
    distance.push(metres(covered));
  }

  return {
    elapsed,
    distance,
    totalDistance: distance[distance.length - 1] as Metres,
    totalTime: elapsed[elapsed.length - 1] as Seconds,
  };
}

/**
 * How far the ghost had ridden at `atElapsed` seconds into its attempt.
 *
 * Linear between samples. A recorded ride is samples of a continuous thing, so
 * interpolating is a better model of where the rider was than holding the last
 * sample would be — and holding would make the ghost visibly stair-step at any
 * sample rate below the frame rate, which is every sample rate.
 *
 * ## The two ends, which are different questions
 *
 * **Before the start** (`atElapsed <= 0`) the ghost is at zero, on the line.
 *
 * **After the finish** the ghost stays at {@link GhostTrack.totalDistance} and
 * does not keep moving. It finished; it is not still riding. A caller that
 * renders a gap after that point is comparing against a rider who has stopped,
 * which is the truth — and {@link ghostHasFinished} is how a screen says so
 * rather than showing a gap that grows forever.
 */
export function ghostDistanceAt(track: GhostTrack, atElapsed: Seconds): Metres {
  const time: number = atElapsed;
  if (time <= 0) {
    return track.distance[0] as Metres;
  }
  if (time >= track.totalTime) {
    return track.totalDistance;
  }
  const upper = upperBound(track.elapsed, time);
  const lower = upper - 1;
  const t0: number = track.elapsed[lower] as Seconds;
  const t1: number = track.elapsed[upper] as Seconds;
  const d0: number = track.distance[lower] as Metres;
  const d1: number = track.distance[upper] as Metres;
  const span = t1 - t0;
  // `span` cannot be zero: `buildGhostTrack` requires strictly increasing time.
  const fraction = (time - t0) / span;
  return metres(d0 + (d1 - d0) * fraction);
}

/** Whether the attempt has already ended by `atElapsed`. @see ghostDistanceAt */
export function ghostHasFinished(track: GhostTrack, atElapsed: Seconds): boolean {
  return atElapsed >= track.totalTime;
}

/**
 * When the ghost reached `atDistance` — the inverse lookup, for "how far ahead
 * in *time*" without needing a speed.
 *
 * `undefined` past the end of the attempt, because the ghost never reached that
 * distance and there is no honest answer. Extrapolating at its average speed
 * would invent a result on a route it never finished, which is the same
 * fabrication {@link buildGhostTrack} refuses.
 */
export function ghostElapsedAt(track: GhostTrack, atDistance: Metres): Seconds | undefined {
  const covered: number = atDistance;
  if (covered <= 0) {
    return track.elapsed[0];
  }
  if (covered > track.totalDistance) {
    return undefined;
  }
  // ⚠️ A **lower** bound here, where {@link ghostDistanceAt} uses an upper one,
  // and the difference is the stopped rider. Distance may be flat across several
  // samples — time may not, because `buildGhostTrack` requires it to increase
  // strictly — so a distance can match a whole run of samples. "When was the
  // ghost here" wants the *first* of them: a rider who arrived at the junction
  // at 50 s and left at 60 s was there from 50. An upper bound answers 60, which
  // is when they left, and it is wrong by exactly the length of the stop.
  const index = lowerBound(track.distance, covered);
  if ((track.distance[index] as Metres) === covered) {
    return track.elapsed[index];
  }
  // Otherwise `index` is the first sample past `covered`, so the pair brackets
  // it strictly and the span cannot be zero.
  const d0: number = track.distance[index - 1] as Metres;
  const d1: number = track.distance[index] as Metres;
  const t0: number = track.elapsed[index - 1] as Seconds;
  const t1: number = track.elapsed[index] as Seconds;
  return seconds(t0 + (t1 - t0) * ((covered - d0) / (d1 - d0)));
}

/**
 * The index of the first entry **greater than or equal to** `value`, by binary
 * search. @see ghostElapsedAt for why this and not {@link upperBound}.
 */
function lowerBound(series: readonly number[], value: number): number {
  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((series[middle] as number) >= value) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * The index of the first entry **strictly greater than** `value`, by binary
 * search.
 *
 * Never returns 0 or `series.length` for its caller: {@link ghostDistanceAt} has
 * already handled both out-of-range cases, so the result always brackets a real
 * pair.
 */
function upperBound(series: readonly number[], value: number): number {
  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((series[middle] as number) > value) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}
