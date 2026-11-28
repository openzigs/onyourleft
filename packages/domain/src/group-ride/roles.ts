// SPDX-License-Identifier: Apache-2.0

/**
 * **The line's phases and each rider's role in it** — #3299, epic #3296,
 * ADR 0101 (#3297, Proposed).
 *
 * A group ride's single paceline is in one {@link LinePhase} at a time, and
 * every member of it, bot or rider, holds one {@link RiderRole}. Both lists
 * are closed: every switch over them here is exhaustive, so a phase or a role
 * added to a list and not handled is a compile error, and a value from
 * outside the list that reaches one at run time throws, never falls to a
 * silent default.
 *
 * `waiting` and `regrouping`, and the roles `gapped`, `off-the-back` and
 * `off-the-front`, are declared here so the lists are whole; what moves a line
 * into and out of them is `no-drop.ts` (#3301).
 */

import { GroupRideError } from './errors';

/** The line's phases, in the order a ride first meets them. */
export const LINE_PHASES = [
  /** The start: riders roll out and close up. */
  'forming',
  /** One rider on the front, a pull timer running. */
  'steady',
  /** The old front rider is aside and drifting back; the next rider is the front. */
  'changing',
  /** The old front rider closes onto the last wheel. */
  'latching',
  /** The group waits for the rider (#3301). */
  'waiting',
  /** Over the top of a climb, the group eases until the rider is back (#3301). */
  'regrouping',
] as const;

/** One of {@link LINE_PHASES}. */
export type LinePhase = (typeof LINE_PHASES)[number];

/** Every role a member of the line can hold, one at a time. */
export const RIDER_ROLES = [
  'on-front',
  /** Next up: on the front rider's wheel. */
  'second-wheel',
  'in-line',
  'last-wheel',
  /** Aside after a pull, easing so the line passes. */
  'drifting-back',
  /** Closing onto the last wheel after drifting back. */
  'latching',
  /** Off the wheel, but inside the draft's 30 m reach (#3301). */
  'gapped',
  /** Beyond the draft's reach, behind (#3301). */
  'off-the-back',
  /** Ahead of the front rider when not on a pull (#3301). */
  'off-the-front',
  /** The rider who chose to sit in: the bot behind pulls through in their place. */
  'sitting-in',
] as const;

/** One of {@link RIDER_ROLES}. */
export type RiderRole = (typeof RIDER_ROLES)[number];

/** A phase or a role that is not one of the lists, at run time: refused, never defaulted. */
export function unknownValue(value: never): never {
  void value;
  throw new GroupRideError(
    'unknown-value',
    'a line phase or rider role must be one this module names',
  );
}

/**
 * Whether `role` is one of the line's own: on the front, on a wheel, rotating
 * back, or sitting in. `false` for a rider who has come off the line, which
 * only #3301's rules can make. A rider who holds a wheel and never presses
 * anything only ever holds these (#3299's criterion: "no fault state").
 */
export function isLineRole(role: RiderRole): boolean {
  switch (role) {
    case 'on-front':
    case 'second-wheel':
    case 'in-line':
    case 'last-wheel':
    case 'drifting-back':
    case 'latching':
    case 'sitting-in':
      return true;
    case 'gapped':
    case 'off-the-back':
    case 'off-the-front':
      return false;
    default:
      return unknownValue(role);
  }
}

/** The role of the member who is out of the line after a pull, by the line's phase. */
export function asideRole(phase: LinePhase): RiderRole {
  switch (phase) {
    case 'latching':
      return 'latching';
    // Forming and steady never hold a member aside; waiting and regrouping
    // keep one drifting until #3301 says otherwise.
    case 'forming':
    case 'steady':
    case 'changing':
    case 'waiting':
    case 'regrouping':
      return 'drifting-back';
    default:
      return unknownValue(phase);
  }
}

/** What {@link lineRoles} reads: the line as it stands. */
export interface LineSeats {
  /** The line, front first, without the member who is aside. */
  readonly order: readonly string[];
  /** The member out of the line after a pull, or `null`. */
  readonly aside: string | null;
  readonly phase: LinePhase;
  /** The rider's id, or `null` in a line of bots only. */
  readonly riderId: string | null;
  /** Whether the rider has chosen to sit in. */
  readonly sittingIn: boolean;
}

/**
 * Every member's role: the front `on-front`, the next `second-wheel`, the
 * back `last-wheel` (in a line of three or more), the rest `in-line`, and the
 * member aside {@link asideRole}. A rider who sits in holds `sitting-in` in
 * place of a wheel role; they are never at the front, which the rotation sees
 * to.
 */
export function lineRoles(seats: LineSeats): Readonly<Record<string, RiderRole>> {
  const roles: Record<string, RiderRole> = {};
  const last = seats.order.length - 1;
  seats.order.forEach((id, at) => {
    const seat: RiderRole =
      at === 0 ? 'on-front' : at === 1 ? 'second-wheel' : at === last ? 'last-wheel' : 'in-line';
    roles[id] = id === seats.riderId && seats.sittingIn && at > 0 ? 'sitting-in' : seat;
  });
  if (seats.aside !== null) roles[seats.aside] = asideRole(seats.phase);
  return roles;
}
