// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The athlete's thresholds, and the **one** place a default is substituted for
 * a missing one.
 *
 * #78's first criterion is that zone boundaries come from *"a single athlete
 * threshold setting"*. That is a claim about the program, not about a record
 * field, and it is false the moment two callers each write
 * `athlete.thresholdPower ?? 200`: a screen that read the default from one
 * place and a chart that read it from another would agree until somebody
 * changed one of them, and then they would disagree silently, which is the only
 * way a zone boundary goes wrong without anyone noticing.
 *
 * So `packages/store` reads the field **faithfully** — absent stays absent,
 * because that is what is on disk and a decoder that invented a value would be
 * lying about the database — and this function is the only substitution. The
 * `??` below appears once in the program.
 *
 * ⚠️ **A default is not a measurement, and the view says so.** 200 W and
 * 160 bpm are plausible for an adult recreational cyclist and are wrong for
 * almost every individual one; zones derived from them are a shape, not a
 * prescription. {@link AthleteThresholds.assumed} carries that distinction up
 * to the renderer so the screen can mark the numbers as assumed rather than
 * presenting a guess in the same typeface as a measurement.
 */

import {
  beatsPerMinute,
  DEFAULT_THRESHOLD_HEART_RATE,
  DEFAULT_THRESHOLD_POWER,
  watts,
  type BeatsPerMinute,
  type Watts,
} from '@onyourleft/domain';
import type { AthleteRecord } from '@onyourleft/store';

export interface AthleteThresholds {
  readonly thresholdPower: Watts;
  readonly thresholdHeartRate: BeatsPerMinute;
  /**
   * Which of the two were not set by the athlete.
   *
   * Per basis rather than one flag, because an athlete who has tested their FTP
   * and never measured a maximum heart rate is the ordinary case, and telling
   * them their power zones are assumed when they are not would teach them to
   * ignore the notice on the zones that really are.
   */
  readonly assumed: { readonly power: boolean; readonly heartRate: boolean };
}

/**
 * The thresholds to derive zones from, defaults filled in.
 *
 * Takes the record or `undefined`, because "this device has no athlete row yet"
 * is a real state — a browser that has never recorded a ride — and it means
 * exactly what an athlete row with neither field set means. Handling it here
 * rather than at each call site is the same argument as the paragraph above.
 */
export function thresholdsFor(athlete: AthleteRecord | undefined): AthleteThresholds {
  const power = athlete?.thresholdPower;
  const heartRate = athlete?.thresholdHeartRate;
  return {
    thresholdPower: power ?? DEFAULT_THRESHOLD_POWER,
    thresholdHeartRate: heartRate ?? DEFAULT_THRESHOLD_HEART_RATE,
    assumed: { power: power === undefined, heartRate: heartRate === undefined },
  };
}

/** What a typed threshold form should do. @see thresholdsToSave */
export type ThresholdSave =
  | { readonly kind: 'refused'; readonly reason: string }
  | {
      readonly kind: 'save';
      readonly thresholdPower: Watts | undefined;
      readonly thresholdHeartRate: BeatsPerMinute | undefined;
    };

/** Said when a box holds something that is not a threshold. */
export const THRESHOLD_REFUSAL =
  'Thresholds must be a positive number of watts and beats per minute, or blank.';

/**
 * Turn what the rider typed into either a write or a refusal.
 *
 * ⚠️ **A pure function rather than a branch inside the click handler, and that
 * is the point.** In the handler the guard was untestable: a mutation deleting
 * its `return` left the suite green, because the fall-through hit `watts()`,
 * which throws on a non-number, so the write never happened *anyway* and the
 * only outward tell was an unhandled rejection. The guard was load-bearing and
 * nothing proved it. Here the refusal is a value, and a test can hold it.
 *
 * **Blank is a save, not a refusal.** It clears the setting and returns the
 * screen to the assumed default, which is the only way a rider who typed a
 * threshold by mistake can undo it — `packages/store`'s `setAthleteThresholds`
 * replaces both fields for the same reason.
 */
export function thresholdsToSave(powerText: string, heartRateText: string): ThresholdSave {
  const power = parseThreshold(powerText);
  const heartRate = parseThreshold(heartRateText);
  if (power === 'invalid' || heartRate === 'invalid') {
    return { kind: 'refused', reason: THRESHOLD_REFUSAL };
  }
  return {
    kind: 'save',
    thresholdPower: power === undefined ? undefined : watts(power),
    thresholdHeartRate: heartRate === undefined ? undefined : beatsPerMinute(heartRate),
  };
}

/**
 * A typed threshold: a positive number, nothing at all, or a refusal.
 *
 * Blank is a real answer, so it cannot share a return value with "that is not a
 * number" — which is why this is a three-way result rather than
 * `number | undefined`.
 */
function parseThreshold(text: string): number | undefined | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return 'invalid';
  }
  return value;
}
