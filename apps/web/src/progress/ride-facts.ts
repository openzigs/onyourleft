// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The facts a ride's badges are earned from (#947), worked out from its
 * samples — at save, at import, and for a ride saved before #947 when the
 * rider asks Home to look at older rides.
 *
 * ## Three writers, one rule
 *
 * `recording/finish.ts` and `transfer/import-batch.ts` have the samples in
 * hand and call {@link rideFactsOf} as they write the ride, which is the load
 * summary's reason (`analysis/summary.ts`): Home's one store read must never
 * decode a stream. {@link lookAtOlderRides} is the third, for history, and it
 * is **called from a control, never from a render** — the Analysis backfill's
 * rule, for its reason: a decode per ride on every launch is the read Home
 * exists to bound.
 *
 * ⚠️ **What only a ride knows is never invented.** Whether a workout was
 * finished, or the rider's ghost raced, is known while riding and nowhere
 * else, so a recorded ride says it and an imported or backfilled one does not:
 * {@link lookAtOlderRides} reads only a ride that says nothing yet, so it
 * never replaces what a ride said.
 */

import {
  bestMeanPower,
  recordedAscent,
  seconds,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';
import type { ActivityId, ActivitySummary, RideFacts } from '@onyourleft/store';

import type { AnalysisPort } from '../analysis/store-port';

import { BEST_POWER_DURATIONS, countsAsRide } from './progress';

/** What a ride's facts are worked out from, and what only the ride itself knew. */
export interface RideFactsInput {
  readonly power?: readonly (Watts | undefined)[] | undefined;
  readonly altitude?: readonly (number | undefined)[] | undefined;
  /** Seconds one sample is worth. A best is a window of whole seconds. */
  readonly sampleInterval: Seconds;
  readonly workoutFinished?: boolean | undefined;
  readonly ghostRaced?: boolean | undefined;
}

/**
 * The facts for one ride. Always an object — `{}` for a ride with nothing to
 * say — because present means "worked out" (`packages/store` §`RideFacts`).
 */
export function rideFactsOf(input: RideFactsInput): RideFacts {
  const ascent = input.altitude === undefined ? undefined : recordedAscent(input.altitude);
  const bestPower: { duration: Seconds; power: Watts }[] = [];
  // A best is over a window of whole seconds, which a 1 Hz grid (ADR 0011) is
  // sample for sample; another interval is not read, rather than misread.
  if (input.power !== undefined && input.sampleInterval === 1) {
    for (const duration of BEST_POWER_DURATIONS) {
      const power = bestMeanPower(input.power, duration);
      if (power !== undefined) bestPower.push({ duration: seconds(duration), power });
    }
  }
  return {
    ...(ascent === undefined ? {} : { ascent }),
    ...(bestPower.length === 0 ? {} : { bestPower }),
    ...(input.workoutFinished === true ? { workoutFinished: true } : {}),
    ...(input.ghostRaced === true ? { ghostRaced: true } : {}),
  };
}

/** How many rides one press of *Look at older rides* reads. The Analysis backfill's bound. */
export const LOOK_BATCH = 50;

/** What one pass did. */
export interface LookOutcome {
  /** Rides read by this pass. */
  readonly read: number;
  /** Counted rides still unread afterwards, so the control can offer another pass. */
  readonly remaining: number;
}

/**
 * Work out the facts for up to {@link LOOK_BATCH} counted rides that have
 * none, oldest first — a best is only claimed over every earlier ride, so the
 * oldest unread ride is the one holding the most back.
 *
 * ⚠️ **Called from a control, never from a render.** @see the module note
 */
export async function lookAtOlderRides(
  port: AnalysisPort,
  summaries: readonly ActivitySummary[],
  batch: number = LOOK_BATCH,
): Promise<LookOutcome> {
  const unread = summaries
    .filter((summary) => countsAsRide(summary) && summary.rideFacts === undefined)
    .sort((left, right) => left.startedAt - right.startedAt);
  let read = 0;
  for (const summary of unread.slice(0, batch)) {
    if (await readOne(port, summary.id)) read += 1;
  }
  return { read, remaining: unread.length - read };
}

async function readOne(port: AnalysisPort, id: ActivityId): Promise<boolean> {
  const streams = await port.store.getStreamSetSummary(port.athleteId, id);
  const power =
    streams?.channels.includes('power') === true
      ? await port.store.getStreamChannel(port.athleteId, id, 'power')
      : undefined;
  const altitude =
    streams?.channels.includes('altitude') === true
      ? await port.store.getStreamChannel(port.athleteId, id, 'altitude')
      : undefined;
  // A ride with no stream set is read as one with nothing to say: it is
  // marked read, so it is not offered again, and it earns only what its row
  // already shows.
  const facts = rideFactsOf({
    power,
    altitude,
    sampleInterval: streams?.sampleInterval ?? seconds(1),
  });
  return port.store.setActivityRideFacts(port.athleteId, id, facts);
}
