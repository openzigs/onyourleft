// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What one room is configured with, checked whole before the room exists
 * (#779).
 *
 * A room is built once, from these, and a setting that is wrong refuses the
 * room rather than being clamped: an operator who typed 150 riders must hear
 * "at most 100", not get 100 and find out at the 101st hello.
 */

import {
  DEFAULT_PLAUSIBILITY_LIMITS,
  type PlausibilityLimits,
  type RidingPosition,
} from '@onyourleft/physics';
import {
  FRAME_INTERVAL_MS,
  MAXIMUM_REPORTED_POWER_WATTS,
  MAXIMUM_RIDERS,
  REPORT_INTERVAL_MS,
  type RoomKind,
} from '@onyourleft/protocol';

/** Ruling Q4, 2026-09-28: a room holds 50 riders unless the operator says otherwise. */
export const DEFAULT_ROOM_CAPACITY = 50;

/** Ruling Q4: and never more than 100 — the wire format's own bound (`MAXIMUM_RIDERS`). */
export const MAXIMUM_ROOM_CAPACITY = MAXIMUM_RIDERS;

/**
 * How long a dropped rider's seat is held, in the room's milliseconds. While it
 * is held the rider is coasted at 0 W; a hello for the same athlete inside it
 * gets the same seat and the same position. ⚠️ **The author's choice**: long
 * enough for a phone to change network or an app to be relaunched, short
 * enough that a race is not held open for somebody who has gone.
 */
export const DEFAULT_REJOIN_WINDOW_MS = 60_000;

/** A race's countdown, from `start` to the first tick. */
export const DEFAULT_COUNTDOWN_MS = 10_000;

/** How long an empty group ride stays open before it closes. */
export const DEFAULT_EMPTY_GRACE_MS = 60_000;

/**
 * How far a report's time, mapped onto the room's clock, may lag the room
 * (`lateMs`) or lead it (`earlyMs`) and still be admitted — rule 1's window.
 * See `clock.ts` for the mapping and why a late report needs more room than an
 * early one.
 */
export const DEFAULT_REPORT_SLACK = { lateMs: 5_000, earlyMs: 1_000 } as const;

/** The route a room rides, as the room needs it: never its geometry. */
export interface RoomCourse {
  /** The SHA-256 of the route's content, lower-case hex — `welcome.routeRef`. */
  readonly sha256: string;
  /** A race's finish line, in metres along the route. A group ride ignores it. */
  readonly lengthMetres: number;
  /** The gradient at a distance along the route, in percent. */
  readonly gradePercentAt: (metres: number) => number;
}

/** What an operator, or whoever opens a room, supplies. */
export interface RoomSettingsInput {
  readonly kind: RoomKind;
  readonly ridingPosition: RidingPosition;
  readonly course: RoomCourse;
  readonly capacity?: number;
  readonly rejoinWindowMs?: number;
  readonly countdownMs?: number;
  readonly emptyGraceMs?: number;
  readonly reportSlack?: { readonly lateMs: number; readonly earlyMs: number };
  readonly limits?: PlausibilityLimits;
}

/** A room's settings, every default filled and every value checked. */
export interface RoomSettings {
  readonly kind: RoomKind;
  readonly ridingPosition: RidingPosition;
  readonly course: RoomCourse;
  readonly capacity: number;
  readonly rejoinWindowMs: number;
  readonly countdownMs: number;
  readonly emptyGraceMs: number;
  readonly reportSlack: { readonly lateMs: number; readonly earlyMs: number };
  readonly limits: PlausibilityLimits;
  readonly reportIntervalMs: number;
  readonly frameIntervalMs: number;
}

/** A setting a room cannot be built with. The message names the setting and the rule, never the value. */
export class RoomSettingsError extends Error {
  override readonly name = 'RoomSettingsError';
}

function wholeAtLeast(value: number, minimum: number, what: string): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RoomSettingsError(`${what} must be a whole number of at least ${String(minimum)}`);
  }
  return value;
}

/**
 * Every default filled and every value checked.
 *
 * @throws RoomSettingsError for a capacity outside 1–100, a negative or
 * fractional duration, a course with no length or no SHA-256, or a power limit
 * above what the wire can carry (`MAXIMUM_REPORTED_POWER_WATTS` — a room may
 * lower rule 1's ceiling and never raise it; `@onyourleft/protocol`'s
 * `schema.ts` says why).
 */
export function roomSettings(input: RoomSettingsInput): RoomSettings {
  const capacity = wholeAtLeast(input.capacity ?? DEFAULT_ROOM_CAPACITY, 1, 'a room’s capacity');
  if (capacity > MAXIMUM_ROOM_CAPACITY) {
    throw new RoomSettingsError(
      `a room holds at most ${String(MAXIMUM_ROOM_CAPACITY)} riders (ruling Q4)`,
    );
  }
  const limits = input.limits ?? DEFAULT_PLAUSIBILITY_LIMITS;
  if (!(limits.maximumPowerWatts > 0) || limits.maximumPowerWatts > MAXIMUM_REPORTED_POWER_WATTS) {
    throw new RoomSettingsError(
      `the power limit must be above 0 W and at most the ${String(MAXIMUM_REPORTED_POWER_WATTS)} W a report can carry`,
    );
  }
  const { course } = input;
  if (!/^[0-9a-f]{64}$/.test(course.sha256)) {
    throw new RoomSettingsError('a course is named by a lower-case hex SHA-256');
  }
  if (!Number.isFinite(course.lengthMetres) || course.lengthMetres <= 0) {
    throw new RoomSettingsError('a course’s length must be a finite distance above 0 m');
  }
  const slack = input.reportSlack ?? DEFAULT_REPORT_SLACK;
  return {
    kind: input.kind,
    ridingPosition: input.ridingPosition,
    course,
    capacity,
    rejoinWindowMs: wholeAtLeast(
      input.rejoinWindowMs ?? DEFAULT_REJOIN_WINDOW_MS,
      0,
      'the rejoin window',
    ),
    countdownMs: wholeAtLeast(input.countdownMs ?? DEFAULT_COUNTDOWN_MS, 0, 'the countdown'),
    emptyGraceMs: wholeAtLeast(input.emptyGraceMs ?? DEFAULT_EMPTY_GRACE_MS, 0, 'the empty grace'),
    reportSlack: {
      lateMs: wholeAtLeast(slack.lateMs, 0, 'the late report slack'),
      earlyMs: wholeAtLeast(slack.earlyMs, 0, 'the early report slack'),
    },
    limits,
    reportIntervalMs: REPORT_INTERVAL_MS,
    frameIntervalMs: FRAME_INTERVAL_MS,
  };
}
