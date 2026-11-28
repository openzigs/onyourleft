// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The group ride's setup** — #3303, epic #3296,
 * [ADR 0101](../../../../../docs/adr/0101-the-ai-group-ride.md) D-1, D-2 and
 * D-3.4: turning "ride with a group at 30 km/h, five riders" into a ride, or
 * into a refusal a rider can act on. `pacer-choice.ts` is the pattern: the
 * pure core, with the screen (`StageChooser.tsx`) drawing its answer.
 *
 * ## What it holds
 *
 * - **The average speed** the rider chose, in metres a second, typed in their
 *   own display units (ADR 0020). It is the group's average over the whole
 *   route (D-2.1), and the plan (`@onyourleft/domain` §`planGroupRide`) is
 *   solved for it on the route chosen. **A target the group cannot make there
 *   is refused with the most, or the least, it can average, never
 *   approximated** (D-2.2): {@link groupRideAsked} says so and the chooser
 *   blocks *Ride*, so no ride starts without the group the rider asked for.
 * - **The size of the group**: {@link GROUP_RIDE_LEAST_BOTS} to
 *   {@link GROUP_RIDE_MOST_BOTS} bots, {@link GROUP_RIDE_DEFAULT_BOTS} unless
 *   chosen (D-3.4).
 *
 * ## Remembered on the device
 *
 * {@link readGroupRideKept} and {@link writeGroupRideKept}: one key, plain
 * JSON, and anything that does not read is the default, as every device
 * preference here. The chooser's first render reads it, so the switch, the
 * speed and the size are as the rider left them after a reload.
 *
 * ## What it is not offered beside
 *
 * {@link groupRideUnavailable}: a workout holding the trainer at a set power
 * (D-1.5, Q7), the draft switched off on this device (Q8), and a loop route
 * (the review of PR #3364): the plan is one pass of the route
 * (`@onyourleft/domain` §`planGroupRide` clamps the odometer to it), so from
 * the second lap the group would ride the last cell's speed and its ledger
 * would stop. Laps of a loop are #3369's. Each has one sentence, shown beside
 * the switch, which is then disabled.
 *
 * Nothing here is a trainer target, and nothing here reaches a trainer.
 */

import {
  GroupRideError,
  metresPerSecond,
  planGroupRide,
  type GroupPlan,
  type GroupPlanRefusal,
  type RouteProfile,
} from '@onyourleft/domain';
import { groupRidePhysics } from '@onyourleft/physics';
import type { UnitSystem } from '@onyourleft/store';

import { speedFrom, speedIn, speedUnit } from '../../units/format';
import type { PreferenceStorage } from '../hud/announce-preference';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const GROUP_RIDE_STORAGE_KEY = 'oyl.game.groupRide.v1';

/** The fewest bots a group holds — ADR 0101 D-3.4. */
export const GROUP_RIDE_LEAST_BOTS = 3;

/** The most bots a group holds — ADR 0101 D-3.4: a line of eight with the rider. */
export const GROUP_RIDE_MOST_BOTS = 7;

/** The bots a group holds unless the rider chose: a line of six with the rider. */
export const GROUP_RIDE_DEFAULT_BOTS = 5;

/**
 * The average the speed box starts on, metres a second: **30 km/h**, the
 * epic's own example. Through `units/format.ts`, the one place a unit is
 * converted (#238).
 */
export const GROUP_RIDE_DEFAULT_SPEED: number = speedFrom(30, 'metric');

/** A group ride as it is ridden: what the rider chose, and nothing else. */
export interface GroupRideChoice {
  /** The average speed for the whole ride, metres a second. */
  readonly targetSpeed: number;
  /** How many bots ride in the line beside the rider. */
  readonly bots: number;
}

/** What the device remembers of the setup. */
export interface GroupRideKept extends GroupRideChoice {
  /** Whether the switch was on. */
  readonly on: boolean;
}

/** The setup on a device that has kept none. */
export const DEFAULT_GROUP_RIDE: GroupRideKept = {
  on: false,
  targetSpeed: GROUP_RIDE_DEFAULT_SPEED,
  bots: GROUP_RIDE_DEFAULT_BOTS,
};

/** Whether `bots` is a size a group may have. */
export function groupRideSized(bots: unknown): bots is number {
  return (
    typeof bots === 'number' &&
    Number.isInteger(bots) &&
    bots >= GROUP_RIDE_LEAST_BOTS &&
    bots <= GROUP_RIDE_MOST_BOTS
  );
}

/**
 * The setup this device kept. Never throws; each part that does not read is
 * the default's, so a size from a build with other bounds does not lose the
 * speed beside it.
 */
export function readGroupRideKept(storage: PreferenceStorage | undefined): GroupRideKept {
  let raw: unknown;
  try {
    const text = storage?.getItem(GROUP_RIDE_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_GROUP_RIDE;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_GROUP_RIDE;
  const { on, targetSpeed, bots } = raw as {
    on?: unknown;
    targetSpeed?: unknown;
    bots?: unknown;
  };
  return {
    on: on === true,
    targetSpeed:
      typeof targetSpeed === 'number' && Number.isFinite(targetSpeed) && targetSpeed > 0
        ? targetSpeed
        : DEFAULT_GROUP_RIDE.targetSpeed,
    bots: groupRideSized(bots) ? bots : DEFAULT_GROUP_RIDE.bots,
  };
}

/**
 * Keep the setup. `false` when the device refused — a full or blocked store —
 * as `solo-draft-preference.ts` §`writeSoloDraftChoice` answers.
 */
export function writeGroupRideKept(
  storage: PreferenceStorage | undefined,
  kept: GroupRideKept,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(
      GROUP_RIDE_STORAGE_KEY,
      JSON.stringify({ on: kept.on, targetSpeed: kept.targetSpeed, bots: kept.bots }),
    );
    return true;
  } catch {
    return false;
  }
}

/** A speed as the speed box holds it: the rider's units, to one decimal, with no trailing `.0`. */
export function groupSpeedText(targetSpeed: number, units: UnitSystem): string {
  return String(Math.round(speedIn(metresPerSecond(targetSpeed), units) * 10) / 10);
}

/**
 * The speed in the box, metres a second, or `undefined` for a box that holds
 * no speed above zero: an empty one, or one with words in it.
 */
export function groupSpeedTyped(text: string, units: UnitSystem): number | undefined {
  const trimmed = text.trim();
  const value = trimmed === '' ? Number.NaN : Number(trimmed);
  return Number.isFinite(value) && value > 0 ? speedFrom(value, units) : undefined;
}

/** Why a group ride is not offered now. A closed list: each has one sentence. */
export type GroupRideUnavailable = 'workout' | 'draft-off' | 'loop';

/**
 * The one sentence for each reason, shown beside the switch — drafts for the
 * owner's approval, as every new sentence is (ADR 0101 Q16). Plain words, no
 * place and no number.
 */
export const GROUP_RIDE_UNAVAILABLE_TEXT: Readonly<Record<GroupRideUnavailable, string>> = {
  workout:
    'A group ride is not offered while a workout holds your trainer at a set power: taking a turn on the front needs you to change your effort freely.',
  'draft-off':
    'A group ride is not offered with the draft switched off: riding in a line teaches nothing without it.',
  loop: 'A group ride is not offered on a loop yet: choose a route with a start and a finish.',
};

/**
 * Why a group ride is not offered, or `undefined` where it is — ADR 0101
 * D-1.5. A workout comes first: it is the one the rider cannot change from
 * this screen; then the draft, changed in Settings; then the route, changed
 * on this screen.
 *
 * @param workout - whether a workout holds the trainer (`trainer-port.ts`
 *   §`GameTrainerKind` `workout`).
 * @param drafted - whether this device drafts a solo ride
 *   (`solo-draft-preference.ts` §`readSoloDraftChoice`).
 * @param loop - whether the route chosen is a loop (`RouteProfile.loop`).
 */
export function groupRideUnavailable(
  workout: boolean,
  drafted: boolean,
  loop: boolean,
): GroupRideUnavailable | undefined {
  if (workout) return 'workout';
  if (!drafted) return 'draft-off';
  return loop ? 'loop' : undefined;
}

/**
 * The plan for `choice` on `course`, on the group's own physics: the one call
 * the chooser refuses by and the ride is ridden by, so the two cannot differ.
 */
export function groupRidePlan(
  choice: GroupRideChoice,
  course: RouteProfile,
): GroupPlan | GroupPlanRefusal {
  return planGroupRide({
    course,
    targetSpeed: metresPerSecond(choice.targetSpeed),
    frontSpeed: groupRidePhysics().frontSpeed,
  });
}

/** What the rider asked for, or what is wrong with it. At most one is defined. */
export interface GroupRideAsked {
  /** The group to ride with, or `undefined` when there is to be none. */
  readonly ride: GroupRideChoice | undefined;
  /**
   * What to tell the rider, when they asked for a group and the setup cannot
   * make one. Present **only** when {@link ride} is absent *and* a group was
   * asked for, as `pacer-choice.ts` §`PacerChoice.problem` is.
   */
  readonly problem: string | undefined;
}

const NO_GROUP: GroupRideAsked = { ride: undefined, problem: undefined };

/** A speed the group can make, in the rider's units, rounded toward what it can make. */
function reachable(speed: number, units: UnitSystem, round: (value: number) => number): string {
  const shown = round(speedIn(metresPerSecond(speed), units) * 10) / 10;
  return `${String(shown)} ${speedUnit(units)}`;
}

/**
 * The rider's choice, as the chooser needs it.
 *
 * @param wanted - whether the switch is on, and the mode offered.
 * @param speedText - whatever is in the speed box, as typed, in `units`.
 * @param bots - the size chosen.
 * @param course - the route chosen, or `undefined` before one is: no group
 *   and no complaint.
 */
export function groupRideAsked(
  wanted: boolean,
  speedText: string,
  bots: number,
  units: UnitSystem,
  course: RouteProfile | undefined,
): GroupRideAsked {
  if (!wanted || course === undefined) return NO_GROUP;
  const targetSpeed = groupSpeedTyped(speedText, units);
  if (targetSpeed === undefined) {
    return { ride: undefined, problem: 'Choose an average speed for the group.' };
  }
  if (!groupRideSized(bots)) {
    return {
      ride: undefined,
      problem:
        `Choose a group of ${String(GROUP_RIDE_LEAST_BOTS)} to ` +
        `${String(GROUP_RIDE_MOST_BOTS)} riders.`,
    };
  }
  const choice: GroupRideChoice = { targetSpeed, bots };
  let plan: GroupPlan | GroupPlanRefusal;
  try {
    plan = groupRidePlan(choice, course);
  } catch (error) {
    if (!(error instanceof GroupRideError)) throw error;
    // A speed the plan will not take at all: an overflowed figure.
    return { ride: undefined, problem: 'Choose an average speed for the group.' };
  }
  if (!('error' in plan)) return { ride: choice, problem: undefined };
  const within = plan.error.reachableAverageMetresPerSecond;
  const asked = `${speedText.trim()} ${speedUnit(units)}`;
  if (within === undefined) {
    return { ride: undefined, problem: `The group cannot average ${asked} on this route.` };
  }
  // Rounded toward what the group can make, so the figure shown is one it takes.
  return plan.error.code === 'target-too-slow'
    ? {
        ride: undefined,
        problem:
          `The group cannot average as little as ${asked} on this route. ` +
          `The least it can average here is ${reachable(within, units, Math.ceil)}.`,
      }
    : {
        ride: undefined,
        problem:
          `The group cannot average ${asked} on this route. ` +
          `The most it can average here is ${reachable(within, units, Math.floor)}.`,
      };
}
