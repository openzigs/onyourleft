// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a live number on the ride screen is allowed to say.
 *
 * ## A frozen number is the dangerous one
 *
 * #49's third acceptance criterion: a sensor disconnect must be visible within
 * a stated number of seconds, and *"the metric shows as unavailable rather than
 * freezing on its last value — a frozen number is indistinguishable from a live
 * one and is the more dangerous display"*.
 *
 * So {@link MetricState} has no variant that carries a value the sensor is no
 * longer producing. A stale metric carries **how long it has been silent** and
 * nothing else; there is no `lastValue` field for a component to reach for,
 * because a field that exists is a field somebody renders. #46's recorder made
 * the same choice on the other side of the boundary — a coasting rider reads
 * zero rather than a stale value — and a screen that held the last number would
 * undo it in the one place the rider is looking.
 *
 * ## Why staleness is computed here and not in the controller
 *
 * It is a pure function of the last reading, the clock and one threshold, and
 * that makes it the only part of the live screen that can be tested without a
 * transport, a recorder or a DOM. The controller supplies the clock; nothing
 * here reads one.
 */

import type { UnixSeconds } from '@onyourleft/domain';

/** The four channels this screen shows, in reading order. */
export type RideMetricId = 'power' | 'cadence' | 'heartRate' | 'speed';

/**
 * How long a channel may be silent before the screen says so, in seconds.
 *
 * Three, and the number is a product decision rather than a protocol one. Every
 * profile this program reads notifies at about 1 Hz, so one second is inside
 * the ordinary jitter of a healthy link and would flicker; five is long enough
 * for a rider to have made a decision on a number that is no longer true. Three
 * is two missed notifications.
 *
 * `controller.test.ts` asserts the transition happens within this many seconds
 * and not later, so changing it changes a test rather than only a constant.
 */
export const METRIC_STALE_AFTER_SECONDS = 3;

/** What the screen may say about one channel. */
export type MetricState =
  /** No sensor for this channel is paired. */
  | { readonly kind: 'unpaired' }
  /** A sensor is paired and has produced nothing yet. */
  | { readonly kind: 'waiting' }
  /** A reading arrived recently enough to still be true. */
  | { readonly kind: 'live'; readonly value: number; readonly at: UnixSeconds }
  /**
   * The sensor has gone quiet. **Carries no value**, deliberately — see the
   * module note.
   */
  | { readonly kind: 'stale'; readonly silentForSeconds: number };

/** The most recent reading on a channel, as the controller keeps it. */
export interface LatestReading {
  readonly value: number;
  readonly at: UnixSeconds;
}

/**
 * What the screen should say about one channel right now.
 *
 * @param paired whether any connected sensor supplies this channel at all. A
 * channel nobody is paired for is not "unavailable" — it was never available,
 * and telling a rider with no heart rate strap that their heart rate has been
 * lost is a false alarm on every ride.
 */
export function metricStateFor(
  latest: LatestReading | undefined,
  paired: boolean,
  now: UnixSeconds,
  staleAfterSeconds: number = METRIC_STALE_AFTER_SECONDS,
): MetricState {
  if (!paired) {
    return { kind: 'unpaired' };
  }
  if (latest === undefined) {
    return { kind: 'waiting' };
  }
  const silentFor = now - latest.at;
  if (silentFor > staleAfterSeconds) {
    return { kind: 'stale', silentForSeconds: Math.floor(silentFor) };
  }
  return { kind: 'live', value: latest.value, at: latest.at };
}

/** Whether a state is one a rider may read a number off. */
export function isReadable(state: MetricState): state is Extract<MetricState, { kind: 'live' }> {
  return state.kind === 'live';
}
