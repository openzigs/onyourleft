// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A climb, or a descent, coming up on the road ahead — #399.
 *
 * ## No new engine
 *
 * `packages/domain/src/route/profile.ts` is already gradient as a function of
 * distance, built from its three windows and despiked. This module READS it —
 * `RouteProfile.grades`, on the profile's own grid — and re-derives nothing:
 * the windows are tuned and tested where they live, and a second smoothing
 * pass here would be a second answer to "how steep is it" that could disagree
 * with the one the trainer is sent.
 *
 * ## What counts as a change worth a sentence
 *
 * ⚠️ **Not every sample.** A profile built from real elevation data wanders by
 * a percent or two all the time, and a sentence per wander is the
 * continuous-speech failure #395 exists to prevent, in a new place. So a
 * **slope** is a stretch of at least {@link MINIMUM_SLOPE_METRES} whose grade
 * stays at or beyond {@link SLOPE_GRADE_PERCENT} in one direction; a gap under
 * that length between two slopes of the same kind does not split them; and
 * everything else is flat, which is never announced. Both numbers are this
 * project's own, chosen as "a hill a rider changes gear for" rather than read
 * off any product (ADR 0009).
 *
 * ## ⚠️ Where the rider IS is the WRAPPED position — the #287 lesson
 *
 * The lookahead starts from `plan.ts` §`planProgress`, the same function the
 * elevation strip, the plan view and "To go" read. It wraps on a loop and
 * clamps on a point-to-point route, and each is right for its shape: a rider on
 * lap two of a loop is somewhere on the loop — so lap two's climb is ahead of
 * them and lap one's is not — and a rider past the end of a one-way route has
 * nothing ahead at all. #287 was exactly one panel clamping while its
 * neighbour wrapped; a second position computed here would reopen it.
 *
 * ## What it does not say
 *
 * A position. ADR 0004 decision D binds every layer that formats a coordinate
 * into a string, and a sentence is such a layer — so a slope is named by how
 * far ahead it is and how steep, both distances along the road, never by where
 * it is on the map. Nothing about the scenery either: the canvas stays
 * `aria-hidden`, and a climb ahead is a fact about the route.
 */

import { FEET_PER_MILE, type RouteProfile } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import {
  formatSmallDistance,
  spokenDistanceUnit,
  spokenSmallDistanceUnit,
} from '../../units/format';

import { spokenNumber, type AnnouncementEvent } from './announce';
import type { Every } from './announce-preference';
import { planProgress } from './plan';
import { wholePercent, type Slope } from './slopes';

export {
  BODY_TRIM_METRES,
  MINIMUM_SLOPE_METRES,
  SLOPE_GRADE_PERCENT,
  slopesOf,
  wholePercent,
  type Slope,
  type SlopeKind,
} from './slopes';

/** A slope, as seen from where the rider is now. */
export interface SlopeAhead {
  readonly slope: Slope;
  /** How far ahead it starts, in metres along the road. Always > 0. */
  readonly metresAhead: number;
  /**
   * Which approach this is — the lap and the slope, as integers. The same on
   * every frame of one approach and different on the next lap, which is what
   * lets a caller say each approach exactly once. Integers rather than an
   * odometer reading, because a rounded float can flip between two frames.
   */
  readonly approach: string;
}

/**
 * The nearest slope starting within `leadMetres` of the rider, or `undefined`.
 *
 * Inclusive at the far end: a slope exactly `leadMetres` ahead IS within it, so
 * at `D − N` it is found and at `D − N − ε` it is not.
 */
export function slopeAhead(
  slopes: readonly Slope[],
  profile: RouteProfile,
  distance: number,
  leadMetres: number,
): SlopeAhead | undefined {
  const total = profile.totalDistance as number;
  if (!(total > 0) || !Number.isFinite(distance)) return undefined;
  // ⚠️ The shared, wrapped position — see the module note. Not `distance`, and
  // not a clamp of it.
  const on = planProgress(profile, distance) * total;
  const lap = profile.loop ? Math.floor(distance / total) : 0;
  let best: SlopeAhead | undefined;
  slopes.forEach((slope, index) => {
    let ahead = slope.start - on;
    let onLap = lap;
    if (profile.loop && ahead <= 0) {
      // Behind the rider on this lap, so the next one is a lap on — unless the
      // rider is inside it now, when there is nothing to warn about.
      if (on < slope.start + slope.length) return;
      ahead += total;
      onLap += 1;
    }
    if (!(ahead > 0) || ahead > leadMetres) return;
    if (best === undefined || ahead < best.metresAhead) {
      best = { slope, metresAhead: ahead, approach: `${String(onLap)}:${String(index)}` };
    }
  });
  return best;
}

/**
 * From how many feet an imperial rider hears miles — a quarter of a mile
 * (#1440's review). The 0.25 mi and 0.5 mi steps were heard as "Climb in 1320
 * feet" and "Climb in 2640 feet"; a rider who chose miles hears miles.
 */
const MILES_FROM_FEET = FEET_PER_MILE / 4;

/** The sentence. A climb and a descent are different WORDS, not a sign. */
export function slopeSentence(ahead: SlopeAhead, units: UnitSystem): string {
  const noun = ahead.slope.kind === 'climb' ? 'Climb' : 'Descent';
  // Rounded to tens of the rider's own unit: "in 250 metres", not "in 249".
  const measured = formatSmallDistance(ahead.metresAhead, units);
  const tens = Math.max(10, Math.round(Number(measured.value) / 10) * 10);
  const percent = wholePercent(ahead.slope.grade);
  // #1440's review: a quarter of a mile or more is said in miles, to one
  // decimal as the distance to go is ("0.5 miles to go"), from the same tens
  // of feet — so a climb first seen at the 0.25 mi step (1320 ft) is "0.3
  // miles" and at the 0.5 mi step (2640 ft) "0.5 miles".
  const distance =
    units === 'imperial' && tens >= MILES_FROM_FEET
      ? `${spokenNumber(Math.round((tens / FEET_PER_MILE) * 10) / 10)} ${spokenDistanceUnit(units)}`
      : `${String(tens)} ${spokenSmallDistanceUnit(units)}`;
  return `${noun} in ${distance}, ${String(percent)} percent`;
}

/** What the caller threads back in: the approach last announced. */
export type SlopeAnnounced = string | undefined;

/**
 * This frame's climb-ahead event, if any — at most one per approach.
 *
 * Pure: the caller keeps `announced` and hands it back, exactly as it does the
 * announcer's own state.
 */
export function slopeEvent(
  announced: SlopeAnnounced,
  input: {
    readonly slopes: readonly Slope[];
    readonly profile: RouteProfile;
    readonly distance: number;
    readonly lead: Every;
    readonly units: UnitSystem;
  },
): { readonly event: AnnouncementEvent | undefined; readonly announced: SlopeAnnounced } {
  if (input.lead === 'never') return { event: undefined, announced };
  const ahead = slopeAhead(input.slopes, input.profile, input.distance, input.lead);
  if (ahead === undefined || ahead.approach === announced) {
    return { event: undefined, announced };
  }
  return {
    event: { kind: 'climb-ahead', text: slopeSentence(ahead, input.units) },
    announced: ahead.approach,
  };
}
