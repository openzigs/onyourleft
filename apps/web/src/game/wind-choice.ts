// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning "12 km/h from the north-west" into a wind, or into a refusal — #326.
 *
 * ## Where the wind comes from, named as #326's fifth criterion asks
 *
 * **The rider types it in.** No network, no dependency, no weather service and
 * no ADR. #326 lists three possible sources in increasing order of commitment
 * — a rider-set constant, a seeded synthetic breeze, and real weather for the
 * route and the date — and records that the third *"crosses ADR 0002 decision
 * A's line about the deployment unit and is #248's actual subject"*, carrying
 * a licence question per service and a privacy one on top, because a weather
 * lookup keyed to a route start is a location disclosure ADR 0004 governs.
 *
 * So this is the first option, and it is the whole of it. `route/wind.ts`
 * takes a speed and a bearing and does not care where they came from, so
 * whichever of the other two is ever ruled on arrives as a second builder of
 * the same `Wind` rather than as a change to anything downstream.
 *
 * ## Why this is a module and not four lines in the control
 *
 * The shape `pacer-choice.ts` established, and for its reason: `wind` throws,
 * a `try`/`catch` inside a React event handler is where a refusal goes to be
 * forgotten, and the branch a rider actually hits is then the one nothing can
 * test without a DOM. This is the pure core; `GameView.tsx` renders its answer.
 *
 * ## The units are the rider's own
 *
 * The speed is collected in whatever unit that rider's screens already show —
 * ADR 0020, and `units/format.ts` §`speedFrom` is the one place it is
 * converted. A wind box in metres per second beside a HUD in miles per hour
 * would be #238's half-converted client arriving by a new door.
 *
 * The bearing is in **degrees**, in both unit systems, because a compass has
 * no imperial variant.
 */

import {
  MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
  metresPerSecond,
  UnitError,
  wind,
  type Wind,
} from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatSpeed, measurementText, speedFrom } from '../units/format';

/**
 * The compass bearing the direction box starts on: **270°, a westerly**.
 *
 * A prevailing wind rather than a meaningful default — it is only ever read
 * once the rider has ticked the box, and the speed beside it starts empty, so
 * nothing rides on the number. North would do as well; a westerly is what most
 * of the temperate world gets most of the time.
 */
export const DEFAULT_WIND_FROM_BEARING = 270;

/** The most degrees a bearing box will accept, so `360` is refused as `0`'s twin. */
export const MAXIMUM_BEARING_DEGREES = 359;

/**
 * Which of the two boxes a refusal is about.
 *
 * ⚠️ **A second field on the answer rather than a second refusal**, and the
 * distinction is what keeps `windChoice`'s "one refusal at a time" rule: a
 * rider is told about the speed first and about the direction once the speed
 * is usable, exactly as before. What this adds is *which box* that one
 * sentence is talking about, which a screen needs and a sentence cannot carry.
 */
export type WindProblemField = 'speed' | 'fromBearing';

/** What the rider asked for, or what is wrong with it. Exactly one is defined. */
export interface WindChoice {
  /** The wind to ride in, or `undefined` when the ride is to be in still air. */
  readonly wind: Wind | undefined;
  /**
   * What to tell the rider, when they asked for a wind and the numbers cannot
   * make one.
   *
   * ⚠️ Present **only** when {@link wind} is absent *and* a wind was asked
   * for, which is `pacer-choice.ts`'s rule and is there for its reason: a
   * refusal about a control a rider is not using trains them to ignore
   * refusals.
   */
  readonly problem: string | undefined;
  /**
   * The box {@link problem} is about, so a screen can mark **that** one
   * invalid and leave the other alone.
   *
   * ⚠️ Defined exactly when {@link problem} is, which is what stops a control
   * marking a box invalid with nothing to describe it by. #255's single-box
   * pattern — one refusal, one `aria-invalid`, one `aria-describedby` — does
   * not generalise to two boxes on its own: applying the flag to both makes a
   * perfectly good direction report itself invalid and point at a sentence
   * about the speed, which WCAG 2.2 SC 3.3.1 is precisely about not doing.
   */
  readonly field: WindProblemField | undefined;
}

/**
 * The speed bound, **in the rider's own units**, as a sentence.
 *
 * Built from {@link MAXIMUM_WIND_SPEED_METRES_PER_SECOND} through
 * `units/format.ts` rather than typed out, so the number in the refusal is the
 * number the domain actually enforces and is in the unit the box is in.
 */
function speedRangeSentence(units: UnitSystem): string {
  const most = formatSpeed(metresPerSecond(MAXIMUM_WIND_SPEED_METRES_PER_SECOND), units);
  return `a wind speed must be between 0 and ${measurementText(most)}`;
}

/**
 * The bounds a bearing must be inside, as a sentence.
 *
 * `degreesBearing` normalises rather than refuses — 450° is 90° and −90° is
 * 270° — so nothing downstream would complain about a number outside the
 * circle. It is refused **here** anyway, because a rider who typed 3600 has
 * typed something they did not mean and being silently given a northerly is
 * worse than being asked again.
 */
function bearingRangeSentence(): string {
  return `a wind direction must be a compass bearing between 0 and ${String(MAXIMUM_BEARING_DEGREES)} degrees`;
}

/** Whatever is in a box, as a number, or `NaN` for a box with nothing usable in it. */
function typed(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/**
 * The rider's choice, as the ride screen needs it.
 *
 * @param wanted - whether the "ride in a wind" control is set.
 * @param speed - whatever is in the speed box, as typed, in `units`.
 * @param fromBearing - whatever is in the direction box, as typed, in degrees.
 * @param units - which speed unit the box's number is in. @see speedFrom
 */
export function windChoice(
  wanted: boolean,
  speed: string,
  fromBearing: string,
  units: UnitSystem,
): WindChoice {
  if (!wanted) {
    return { wind: undefined, problem: undefined, field: undefined };
  }
  const speedValue = typed(speed);
  if (!Number.isFinite(speedValue) || speedValue < 0) {
    return {
      wind: undefined,
      problem: `Choose a wind speed: ${speedRangeSentence(units)}.`,
      field: 'speed',
    };
  }
  const bearingValue = typed(fromBearing);
  if (
    !Number.isFinite(bearingValue) ||
    bearingValue < 0 ||
    bearingValue > MAXIMUM_BEARING_DEGREES
  ) {
    return {
      wind: undefined,
      problem: `Choose a wind direction: ${bearingRangeSentence()}.`,
      field: 'fromBearing',
    };
  }
  try {
    return {
      wind: wind(speedFrom(speedValue, units), bearingValue),
      problem: undefined,
      field: undefined,
    };
  } catch (error) {
    if (error instanceof UnitError) {
      // The bound restated in the rider's own units. `wind`'s own message names
      // metres per second, which is the canonical unit and not the one in the
      // box in front of them — the one case where the rule's own wording is
      // the wrong thing to show.
      return {
        wind: undefined,
        problem: `Choose a wind speed: ${speedRangeSentence(units)}.`,
        field: 'speed',
      };
    }
    throw error;
  }
}
