// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Delivery parcel throw, as pure logic on the game's own tick — #1809,
 * resting on the owner's rulings DL1 and DL2 of 2026-10-27 (epic #1803).
 *
 * A game ride steps it once for each simulation step, through
 * `ride-round.ts` (#1816).
 *
 * ## What it decides
 *
 * A parcel leaves the rider to the left or the right, flies, and lands. It is
 * a **delivery** to round position *k* if it reaches the doorstep or
 * porch-step of the house at *k* while that house can still take it, and a
 * **wasted throw** otherwise. A parcel that lands anywhere else is simply
 * wasted: nothing scores for hitting a window, a car or a person, and there
 * is no damage model (DL1). What a delivery does to the round is
 * `round.ts`'s, and {@link stepThrows} records it there, so the round the
 * step returns is the one the next step and `endRound` read.
 *
 * ## The flight, in the route's own frame
 *
 * Distance along the route is the only coordinate the game simulates
 * (`simulation.ts`); the rider's lateral offset is a drawing (`scene.ts`
 * §`lateralOf`, and DL12). So a parcel is thrown from the road's centre line
 * at the rider's simulated distance, and flies in two numbers: `along`, which
 * it carries forward at the rider's speed at the throw, and `across`, which it
 * covers sideways at {@link PARCEL_THROW_SPEED_METRES_PER_SECOND}. The parcel
 * carries the rider's speed, so a fast rider must throw earlier; that is the
 * skill.
 *
 * A target is a doorstep or porch-step (`decorations.ts`, picked by #1808): a
 * round position, a distance along the route, a side and how far it stands
 * off the carriageway's edge. The parcel reaches its depth at one instant,
 * worked out exactly rather than sampled, and it is caught there when it is
 * within {@link TARGET_CATCH_RADIUS_METRES} of the target. A parcel no target
 * catches lands at the end of its flight, {@link PARCEL_FLIGHT_SECONDS} after
 * the throw.
 *
 * ## Why the tick, and why its own constant
 *
 * The step advances whole ticks of {@link DELIVERY_TICK_SECONDS}, the
 * simulation's own `SIMULATION_STEP_SECONDS`, and never a frame's time. Where
 * a parcel is after *n* ticks is a function of *n* and of the throw, so a slow
 * frame on the tablet, which runs four ticks in one call, lands every parcel
 * exactly where one tick a call would.
 *
 * ⚠️ **The tick and the road's half width are written here, not imported**,
 * and the test pins each to its source (`simulation.ts`, `terrain.ts`). Both
 * of those modules import `@onyourleft/domain`, whose barrel re-exports
 * `trainer/simulation.ts`, one of the trainer-command seam modules ADR 0059
 * D-2 forbids Delivery's code to reach through any chain of static imports.
 *
 * ## The numbers are this project's own, proposed for the owner's approval
 *
 * {@link PARCEL_THROW_SPEED_METRES_PER_SECOND},
 * {@link PARCEL_FLIGHT_SECONDS}, {@link TARGET_CATCH_RADIUS_METRES},
 * {@link THROW_WINDOW_BEFORE_METRES}, {@link THROW_WINDOW_AFTER_METRES} and
 * {@link THROW_COOLDOWN_SECONDS} are none of them taken from another game;
 * #1809 asked for them to be proposed in its pull request. Nothing else here
 * hard-codes them, so an approved change is a change to a constant.
 *
 * ## Which side *the next house* is on — #1810
 *
 * A key or a press asks for a throw left, right, or toward the next house
 * (`throw-input.ts`); {@link throwSideFor} turns the last into a side here,
 * where the round and its targets are, so the HUD's input module imports
 * nothing of a round.
 *
 * ## Wider windows, the assist setting (#1813, DL10)
 *
 * With {@link ThrowInput.widerWindows} set, the catch radius and the
 * window's closing edge are both {@link ASSISTED_THROW_SCALE} times their
 * usual size, so the moment a throw counts lasts that much longer. The
 * window's opening edge is not widened: {@link THROW_WINDOW_BEFORE_METRES}
 * already fills the 20 m `targets.ts` §`TARGET_WINDOW_HALF_METRES` keeps
 * clear before each house, so a wider one would reach into the window of the
 * house before. The setting itself is `assist-preference.ts`'.
 *
 * ## A mailbox, and a house that must not get a parcel (#2365, ADR 0065 D-10.3)
 *
 * A mailbox ({@link ThrowTarget.mailbox}) catches a parcel only within
 * {@link MAILBOX_CATCH_RADIUS_METRES} of it, smaller than a doorstep's
 * {@link TARGET_CATCH_RADIUS_METRES}, and a delivery to it is a delivery like
 * any other. With the assist's wider windows it catches as a doorstep does.
 *
 * A house that must not get a parcel ({@link ThrowInput.noDelivery}) is no
 * round position. A parcel it catches, by a doorstep's rule, is a
 * `'no-delivery'` landing: it records nothing on the round, so it raises no
 * score, and `ride-round.ts` takes {@link NO_DELIVERY_SCORE_DELTA} off the
 * round's score for it (ADR 0059 D-1.4: never a reward). It catches every
 * parcel that reaches it, however many.
 *
 * ## Nothing here leaves the ride
 *
 * Parcels, landings and targets are held in memory for the ride only (DL11),
 * and nothing here formats a position into a string.
 */

import { recordDelivery, type Round } from './round';
import type { ThrowIntent } from './throw-input';

/** The game's tick, in seconds: `simulation.ts` §`SIMULATION_STEP_SECONDS`, pinned by the test. */
export const DELIVERY_TICK_SECONDS = 0.05;

/** Half the drawn road, in metres: `terrain.ts` §`ROAD_WIDTH_METRES` / 2, pinned by the test. */
export const CARRIAGEWAY_HALF_WIDTH_METRES = 3.5;

/**
 * How fast a parcel flies sideways from the rider, in metres a second. This
 * project's own number, for the owner's approval in #1809's pull request.
 */
export const PARCEL_THROW_SPEED_METRES_PER_SECOND = 10;

/**
 * How long a parcel flies before it lands, in seconds, when no target catches
 * it first. With the throw speed that is a reach of 12 m from the road's
 * centre, 8.5 m past the carriageway's edge: a doorstep deeper than that
 * cannot be reached. This project's own number, for the owner's approval in
 * #1809's pull request.
 */
export const PARCEL_FLIGHT_SECONDS = 1.2;

/** {@link PARCEL_FLIGHT_SECONDS} in whole ticks. */
export const PARCEL_FLIGHT_TICKS = Math.round(PARCEL_FLIGHT_SECONDS / DELIVERY_TICK_SECONDS);

/**
 * The deepest a parcel reaches from the road's centre line, in metres: how far
 * it has flown sideways on the last tick of its flight, **12 m**. Worked out
 * as `acrossAfter` works it out on that tick, so a target exactly this deep is
 * caught on it. `targets.ts` §`TARGET_MOST_FROM_ROAD_METRES` is this (#1856).
 */
export const PARCEL_REACH_METRES =
  PARCEL_THROW_SPEED_METRES_PER_SECOND * PARCEL_FLIGHT_TICKS * DELIVERY_TICK_SECONDS;

/**
 * How near a target a parcel must be when it reaches the target's depth, in
 * metres along the route, to be caught there. This project's own number, for
 * the owner's approval in #1809's pull request.
 */
export const TARGET_CATCH_RADIUS_METRES = 1.5;

/**
 * How near a mailbox a parcel must be when it reaches the mailbox's depth, in
 * metres along the route, to be caught there — #2365: **0.6**, under half a
 * doorstep's {@link TARGET_CATCH_RADIUS_METRES}. This project's own number,
 * for the owner's approval in #2365's pull request.
 */
export const MAILBOX_CATCH_RADIUS_METRES = 0.6;

/**
 * What a parcel at a house that must not get one does to the round's score —
 * #2365: **one point off**, as a crash is (`obstacles.ts` §`CRASH_SCORE_DELTA`).
 * Never a reward (ADR 0059 D-1.4). This project's own number, for the owner's
 * approval in #2365's pull request.
 */
export const NO_DELIVERY_SCORE_DELTA = -1;

/**
 * How far before a house the rider may be when it throws, in metres, for the
 * parcel to be a delivery there. This project's own number, for the owner's
 * approval in #1809's pull request.
 */
export const THROW_WINDOW_BEFORE_METRES = 20;

/**
 * How far past a house the rider may be when it throws, in metres, for the
 * parcel to be a delivery there. The house's window closes here, which is
 * where `round.ts` counts a house not delivered as missed. Smaller than
 * {@link TARGET_CATCH_RADIUS_METRES}, so a rider who has passed the house
 * cannot turn round on it at a crawl. This project's own number, for the
 * owner's approval in #1809's pull request.
 */
export const THROW_WINDOW_AFTER_METRES = 1;

/**
 * How many times wider the catch radius and the window's closing edge are
 * with the assist setting's wider windows (#1813): 4.5 m and 3 m. The closing
 * edge stays inside the catch radius, as at the default. This project's own
 * number, for the owner's approval in #1813's pull request.
 */
export const ASSISTED_THROW_SCALE = 3;

/**
 * How long after a throw the next one is refused, in seconds. This project's
 * own number, for the owner's approval in #1809's pull request.
 */
export const THROW_COOLDOWN_SECONDS = 0.5;

/** {@link THROW_COOLDOWN_SECONDS} in whole ticks. */
export const THROW_COOLDOWN_TICKS = Math.round(THROW_COOLDOWN_SECONDS / DELIVERY_TICK_SECONDS);

/** Which way a parcel is thrown, and which side of the road a house stands on, facing the way the rider rides. */
export type ThrowSide = 'left' | 'right';

/** A house's doorstep or porch-step, as the round's pick (#1808) hands it over. */
export interface ThrowTarget {
  /** The house's round position, `0` to `n - 1`. Never a map identifier. */
  readonly position: number;
  /** Its distance along the route, in metres. */
  readonly along: number;
  readonly side: ThrowSide;
  /** How far it stands off the carriageway's edge, in metres. */
  readonly clear: number;
  /** A mailbox at the kerb (#2365): {@link MAILBOX_CATCH_RADIUS_METRES}. Absent, a doorstep. */
  readonly mailbox?: boolean;
}

/** A parcel between the throw and its landing. */
export interface ParcelInFlight {
  readonly side: ThrowSide;
  /** The rider's distance along the route at the throw, in metres. */
  readonly launchAlong: number;
  /** The rider's speed at the throw, in metres a second, which the parcel carries forward. */
  readonly speed: number;
  /** The tick the parcel was thrown on. */
  readonly launchTick: number;
}

/** Every parcel in flight, and the throw clock. */
export interface ThrowState {
  /** Ticks run since the round's start. */
  readonly tick: number;
  /** The first tick a throw is taken on: the cool-down's end. */
  readonly readyAt: number;
  readonly inFlight: readonly ParcelInFlight[];
}

/** A round with nothing thrown yet. */
export const NO_PARCELS: ThrowState = Object.freeze({
  tick: 0,
  readyAt: 0,
  inFlight: Object.freeze([]),
});

interface LandingAt {
  readonly side: ThrowSide;
  /** Where the parcel came down, in metres along the route. Held in memory only. */
  readonly along: number;
  /** How far from the road's centre it came down, in metres. Held in memory only. */
  readonly across: number;
  /** The tick it came down on. */
  readonly tick: number;
}

/** A parcel that came down: on a house that could take it, or anywhere else. */
export type Landing =
  | (LandingAt & { readonly kind: 'delivery'; readonly position: number })
  | (LandingAt & { readonly kind: 'wasted' })
  | (LandingAt & {
      readonly kind: 'no-delivery';
      /** Which house that must not get a parcel caught it: its place in {@link ThrowInput.noDelivery}. */
      readonly house: number;
    });

export interface ThrowInput {
  /** The rider's simulated distance along the route, in metres, and speed, in metres a second. */
  readonly rider: { readonly along: number; readonly speed: number };
  /** The round's targets. */
  readonly targets: readonly ThrowTarget[];
  /** The round as it stands; a delivery is recorded on it. */
  readonly round: Round;
  /** A throw asked for since the last step, taken before the step's first tick unless the cool-down refuses it. */
  readonly throwTo?: ThrowSide;
  /** Ticks to run, a whole number, `0` or more. One unless given. */
  readonly ticks?: number;
  /** The assist setting's wider windows (#1813): {@link ASSISTED_THROW_SCALE}. Off unless asked for. */
  readonly widerWindows?: boolean;
  /**
   * The houses on a level that must not get a parcel (#2365), each `position`
   * its place in this list, not a round position. None unless given.
   */
  readonly noDelivery?: readonly ThrowTarget[];
}

export interface ThrowStep {
  readonly state: ThrowState;
  /** The round with this step's deliveries recorded. */
  readonly round: Round;
  /** Every parcel that came down in this step, in the order it did. */
  readonly landings: readonly Landing[];
  /** A throw was asked for and taken; `false` when none was asked for or the cool-down refused it. */
  readonly thrown: boolean;
}

/** How far a parcel has flown sideways, `ticks` after its throw. */
function acrossAfter(ticks: number): number {
  return PARCEL_THROW_SPEED_METRES_PER_SECOND * ticks * DELIVERY_TICK_SECONDS;
}

/** How much the catch radius and the window's closing edge are widened: `1`, or the assist's. */
function scaleFor(widerWindows: boolean | undefined): number {
  return widerWindows === true ? ASSISTED_THROW_SCALE : 1;
}

/** The throw left the rider inside the target's window. */
function windowOpen(parcel: ParcelInFlight, target: ThrowTarget, scale: number): boolean {
  return (
    parcel.launchAlong >= target.along - THROW_WINDOW_BEFORE_METRES &&
    parcel.launchAlong <= target.along + THROW_WINDOW_AFTER_METRES * scale
  );
}

/**
 * Where `parcel` comes down on the tick that ends at `tick`, or `undefined`
 * while it is still flying. Only a house still expecting a parcel, on the
 * side it was thrown to, with its window open at the throw, catches it.
 */
function landingOn(
  parcel: ParcelInFlight,
  tick: number,
  targets: readonly ThrowTarget[],
  round: Round,
  scale: number,
  noDelivery: readonly ThrowTarget[],
): Landing | undefined {
  const flown = tick - parcel.launchTick;
  const from = acrossAfter(flown - 1);
  const to = acrossAfter(flown);
  let caught: Landing | undefined;
  /** Where `parcel` meets `target` on this tick, or `undefined` if it does not. */
  const meets = (
    target: ThrowTarget,
  ): { readonly along: number; readonly across: number } | undefined => {
    if (target.side !== parcel.side || !windowOpen(parcel, target, scale)) return undefined;
    const across = CARRIAGEWAY_HALF_WIDTH_METRES + target.clear;
    if (across <= from || across > to) return undefined;
    if (caught !== undefined && across >= caught.across) return undefined;
    const along =
      parcel.launchAlong + parcel.speed * (across / PARCEL_THROW_SPEED_METRES_PER_SECOND);
    // #2365: a mailbox's catch is smaller, unless the assist widens it to a doorstep's.
    const radius =
      target.mailbox === true && scale === 1
        ? MAILBOX_CATCH_RADIUS_METRES
        : TARGET_CATCH_RADIUS_METRES * scale;
    return Math.abs(along - target.along) > radius ? undefined : { along, across };
  };
  for (const target of targets) {
    if (round.houses[target.position] !== 'expecting') continue;
    const met = meets(target);
    if (met === undefined) continue;
    caught = { kind: 'delivery', position: target.position, side: parcel.side, ...met, tick };
  }
  for (const house of noDelivery) {
    const met = meets(house);
    if (met === undefined) continue;
    caught = { kind: 'no-delivery', house: house.position, side: parcel.side, ...met, tick };
  }
  if (caught !== undefined || flown < PARCEL_FLIGHT_TICKS) return caught;
  return {
    kind: 'wasted',
    side: parcel.side,
    along: parcel.launchAlong + parcel.speed * flown * DELIVERY_TICK_SECONDS,
    across: to,
    tick,
  };
}

/**
 * Take the throw asked for, if the cool-down allows it, then advance every
 * parcel in flight by `ticks` ticks and report each that came down.
 */
export function stepThrows(state: ThrowState, input: ThrowInput): ThrowStep {
  const ticks = input.ticks ?? 1;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('a Delivery throw step runs a whole number of ticks, 0 or more');
  }
  let inFlight = state.inFlight;
  let readyAt = state.readyAt;
  const thrown = input.throwTo !== undefined && state.tick >= readyAt;
  if (thrown) {
    inFlight = [
      ...inFlight,
      {
        side: input.throwTo,
        launchAlong: input.rider.along,
        speed: input.rider.speed,
        launchTick: state.tick,
      },
    ];
    readyAt = state.tick + THROW_COOLDOWN_TICKS;
  }
  const scale = scaleFor(input.widerWindows);
  let round = input.round;
  let tick = state.tick;
  const landings: Landing[] = [];
  for (let run = 0; run < ticks; run += 1) {
    tick += 1;
    const flying: ParcelInFlight[] = [];
    for (const parcel of inFlight) {
      const landing = landingOn(parcel, tick, input.targets, round, scale, input.noDelivery ?? []);
      if (landing === undefined) {
        flying.push(parcel);
        continue;
      }
      if (landing.kind === 'delivery') round = recordDelivery(round, landing.position);
      landings.push(landing);
    }
    inFlight = flying;
  }
  return { state: { tick, readyAt, inFlight }, round, landings, thrown };
}

/** What {@link throwSideFor} needs of the round being ridden. */
export interface ThrowSideInput {
  readonly targets: readonly ThrowTarget[];
  readonly round: Round;
  /** The rider's simulated distance along the route, in metres. */
  readonly along: number;
}

/**
 * The side a throw the rider asked for (`throw-input.ts`, #1810) goes to, or
 * `undefined` for *the next house* when no house is left to deliver to. The
 * next house is the nearest one still expecting a parcel whose throw window
 * has not closed behind the rider: a house passed and not yet counted missed
 * is behind, not next. `GameView` calls it when it takes the intent the HUD's
 * throw control hands it (#1816), and `ride-round.ts` hands the side to
 * {@link stepThrows} as `throwTo`.
 */
export function throwSideFor(intent: ThrowIntent, input: ThrowSideInput): ThrowSide | undefined {
  if (intent !== 'next-house') return intent;
  let next: ThrowTarget | undefined;
  for (const target of input.targets) {
    if (input.round.houses[target.position] !== 'expecting') continue;
    if (target.along + THROW_WINDOW_AFTER_METRES < input.along) continue;
    if (next === undefined || target.along < next.along) next = target;
  }
  return next?.side;
}
