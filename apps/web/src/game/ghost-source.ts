// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Building a ghost out of a stored ride — and the two things #93 left open.
 *
 * ## Open question 1: which attempt do you race?
 *
 * #93 says *"the rider's previous attempt"*, singular, and never says which one
 * when there are several. It also says, in the same body, that this is *"the
 * solo equivalent of a segment PR"* and that it *"converts a route from
 * something you ride into something you improve at"*.
 *
 * **Decided here: the fastest.** Racing the most recent would mean racing a
 * recovery ride about a third of the time, which is a ghost you beat without
 * trying — motivating in neither direction. Racing your best is the thing a
 * segment personal record already is, and it is the comparison the issue's own
 * framing describes.
 *
 * ⚠️ Recorded as a decision rather than left in the code, because the
 * alternative is defensible and somebody will want it. {@link fastestAttempt}
 * is one function and a screen offering a choice would call it differently; what
 * must not happen is two screens quietly picking differently.
 *
 * ## Open question 2: there is no distance channel
 *
 * `packages/store`'s `STREAM_CHANNELS` are power, heart rate, cadence, speed,
 * latitude, longitude, altitude and temperature. **There is no cumulative
 * distance**, so a ghost's position-versus-time has to be integrated from the
 * recorded **speed**.
 *
 * That is still "replay what happened" in #93's sense, and it is worth being
 * precise about why: the recorded speed is a measurement of what the rider did,
 * not a re-simulation of what they might have done. Integrating it reconstructs
 * their odometer; re-running the physics over their recorded power would
 * produce a different ride, which is the thing #93's implementation note
 * forbids.
 *
 * ⚠️ **A gap in the speed channel is a gap in the ghost's knowledge**, and it is
 * not filled in beyond {@link GHOST_GAP_TOLERANCE_SECONDS}. Carrying the last
 * known speed across a two-minute dropout would invent a distance the rider may
 * never have covered — the same fabrication `analysis/load.ts`'s gap rule
 * refuses, arrived at from a different direction. Short gaps are bridged because
 * a sample or two missing at 1 Hz is ordinary jitter on a healthy link, which is
 * the same reasoning `ride/metrics.ts` uses for its own three seconds.
 */

import { buildGhostTrack, type GhostTrack } from '@onyourleft/domain';

import { GameError } from './errors';

/**
 * How long a hole in the speed channel may be before the ride is refused as a
 * ghost, in seconds.
 *
 * Three, and the number is borrowed rather than invented: `ride/metrics.ts`
 * picks three for "how long a channel may be silent before the screen says so",
 * on the reasoning that every profile here notifies at about 1 Hz so one second
 * is inside ordinary jitter and five is long enough for a rider to have acted on
 * a stale number. The same argument applies to a recording after the fact.
 */
export const GHOST_GAP_TOLERANCE_SECONDS = 3;

/** The part of a stored ride a ghost is built from. */
export interface StoredAttempt {
  /** Seconds between samples, from the stream set's own time base. */
  readonly sampleIntervalSeconds: number;
  /** Metres per second per sample slot; `undefined` where the sensor gave nothing. */
  readonly speed: readonly (number | undefined)[];
}

/** A ride summary, reduced to what choosing between attempts needs. */
export interface AttemptSummary {
  readonly id: string;
  /** Excluding pauses — the basis this comparison ranks on. */
  readonly movingSeconds: number;
}

/**
 * The fastest of several attempts, or `undefined` when there are none.
 *
 * Ranks on **moving time**, not elapsed. A rider who stopped for a level
 * crossing on their quickest lap did not ride a slower lap, and elapsed time
 * would say they did. ⚠️ This is the opposite of the choice
 * `segment/effort.ts` makes for a segment board, and deliberately so: a
 * leaderboard ranks people against each other, where excluding pauses is a
 * cheat surface; this ranks a rider against themselves, where there is nobody to
 * cheat and the pause is genuinely not part of the effort.
 *
 * Ties break on the earlier entry, so the choice is stable across calls.
 */
export function fastestAttempt(attempts: readonly AttemptSummary[]): AttemptSummary | undefined {
  let best: AttemptSummary | undefined;
  for (const attempt of attempts) {
    if (best === undefined || attempt.movingSeconds < best.movingSeconds) {
      best = attempt;
    }
  }
  return best;
}

/**
 * Integrates a recorded speed channel into the distance-versus-time a ghost
 * replays.
 *
 * @throws {GameError} when the recording cannot honestly describe a ride — too
 * short, or holed beyond {@link GHOST_GAP_TOLERANCE_SECONDS}. The caller offers
 * one fewer ghost and says why; it does not get a ghost built on a guess.
 */
export function ghostFromSpeed(attempt: StoredAttempt): GhostTrack {
  const interval = attempt.sampleIntervalSeconds;
  if (!(interval > 0)) {
    throw new GameError('ghost-unusable', 'the stored ride has no sample interval');
  }
  const tolerance = Math.max(1, Math.round(GHOST_GAP_TOLERANCE_SECONDS / interval));

  const elapsedSeconds: number[] = [];
  const distanceMetres: number[] = [];
  let covered = 0;
  let lastKnown: number | undefined;
  let gap = 0;

  for (let index = 0; index < attempt.speed.length; index += 1) {
    const sample = attempt.speed[index];
    if (sample === undefined || !Number.isFinite(sample) || sample < 0) {
      gap += 1;
      if (gap > tolerance) {
        throw new GameError(
          'ghost-unusable',
          `the stored ride is missing more than ${String(GHOST_GAP_TOLERANCE_SECONDS)} s of speed in one stretch, so how far the rider got is not known`,
        );
      }
      // Bridged with the last known speed — ordinary jitter, see the header.
      covered += (lastKnown ?? 0) * interval;
    } else {
      gap = 0;
      lastKnown = sample;
      covered += sample * interval;
    }
    elapsedSeconds.push(index * interval);
    distanceMetres.push(covered);
  }

  if (elapsedSeconds.length < 2) {
    throw new GameError('ghost-unusable', 'the stored ride is too short to replay');
  }
  // `buildGhostTrack` re-validates rather than trusting this: monotonic
  // distance, strictly increasing time, finite everywhere. Two checks of the
  // same thing is the cost of the model not trusting its caller, which is the
  // posture `packages/store`'s decoders take for the same reason.
  return buildGhostTrack({ elapsedSeconds, distanceMetres });
}
