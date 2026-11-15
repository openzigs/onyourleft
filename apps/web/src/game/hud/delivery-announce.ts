// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Delivery round, through the HUD's one live region — #1812 (epic #1803,
 * resting on the owner's rulings DL2 and DL10 of 2026-10-27).
 *
 * `GameView` feeds a round's events to `announce.ts` beside every other on a
 * ride that runs one (#1816).
 *
 * ## What it decides
 *
 * The four sentences a round says — a delivery, a miss, a crash and the
 * round's end — and which of them is still **owed**. `announce.ts` ranks them
 * (rank 5g) and drops a lower event behind a higher one in the same window;
 * a caller that offered each once would lose a delivery to the crash beside
 * it, and could lose the round's end to a fault. So, on #647's "owed" rule,
 * the caller offers {@link deliveryEvents} on every call and hands back what
 * the core said through {@link deliverySpoken}, and a sentence is owed until
 * it is said: **each delivery, miss and round's end is said once**, never
 * dropped and never twice.
 *
 * ## Owed is never a queue
 *
 * At most ONE sentence per kind is owed. Two deliveries before the first is
 * said become one sentence that names both houses ("the 3rd and 4th
 * houses"), with the houses left as they stand after the second, so what is
 * owed is bounded by four sentences however fast the parcels land: the
 * continuous-speech failure #396 exists to prevent cannot start here. The
 * round's end supersedes everything owed before it, because its sentence
 * carries the round's counts and is the round's last word — but a delivery or
 * a miss still waiting to be said is not lost to it: the round's end starts
 * with that house ("Delivered to the 12th house. Round over: …"), so every
 * house's result is said. A crash still owed is not: its point is already in
 * the round's score, which the round's end says.
 *
 * ## No place in words
 *
 * A house is its place on the round, said as an ordinal ("the 3rd house"),
 * **never an address, a name or a direction to a real place** (DL11,
 * ADR 0055). Nothing here is handed a target or a landing, only the round's
 * outcomes and positions (`delivery/round.ts`), so there is nothing a
 * sentence could name a place from.
 *
 * ## A standing obstacle ahead, on a level (#2362, ADR 0065 D-10.9)
 *
 * On a built-in level's round, a standing obstacle — a parked car or a bin —
 * is said before the rider reaches it: once it is within
 * {@link OBSTACLE_AHEAD_METRES}, "A parked car ahead, in the right lane.",
 * so the warning is in words and never in sight alone. One is owed at a time,
 * the nearest not yet said, and one the rider has passed before it was said
 * is dropped, because a warning behind the rider is noise. A round on a
 * rider's own route says none, as before (`ride-round.ts` §`DeliveryRide.onLevel`).
 * Where it stands is said as the rider sees it: in the left lane, in the right
 * lane, or in the middle of the road (the owner's ruling of 2026-11-09), never a
 * place.
 *
 * Since #2364 a level's **moving hazard** is said the same way, once it is
 * within {@link MOVING_HAZARD_AHEAD_METRES}, where it is set going: "A dog
 * ahead, from the left.", "A car pulling out ahead, on the right.", "A rider
 * coming the other way, in the left lane." — where it comes from, as the
 * rider faces it.
 *
 * ## A house ahead that must not get a parcel, on a level (#2365, ADR 0065 D-10.5)
 *
 * Said the same way, once it is within {@link SKIP_HOUSE_AHEAD_METRES}: "Skip
 * the next house, on the left. It gets no parcel." — before its throw window
 * opens, by its side, never a place. Always said, as the obstacle ahead is
 * (`announce.ts` §`ALWAYS_SPOKEN`): it is told apart in words, never by its
 * sign alone.
 *
 * ## The words are this project's own (DL1), for the owner's approval
 *
 * Every sentence below is new rider-facing wording, proposed in #1812's pull
 * request: "on the round", a house, a parcel; never a subscriber or a paper.
 */

import {
  MOVING_HAZARD_KINDS,
  MOVING_HAZARD_SIGHT_METRES,
  OBSTACLE_SIGHT_METRES,
  type Obstacle,
  type ObstacleKind,
} from '../delivery/obstacles';
import {
  FEWEST_DELIVERY_HOUSES,
  roundTally,
  type Round,
  type RoundOutcome,
} from '../delivery/round';

import type { AnnouncementEvent, AnnouncementKind } from './announce';

/** What is still to be said about the round. One sentence per kind at most. */
export interface DeliveryOwed {
  /** Round positions delivered since the last delivery sentence, in the order they landed. */
  readonly delivered: readonly number[];
  /** Round positions missed since the last miss sentence, in order. */
  readonly missed: readonly number[];
  /** Crashes since the last crash sentence. */
  readonly crashes: number;
  /** Houses still expecting a parcel after the latest delivery or miss. */
  readonly left: number;
  /** The round's end, once it has ended and until it is said. */
  readonly roundOver: string | undefined;
  /** A standing obstacle ahead (#2362), by its index on the round, and its sentence, until said or passed. */
  readonly ahead: { readonly index: number; readonly text: string } | undefined;
  /** The standing obstacles already said, by their index on the round. */
  readonly warned: readonly number[];
  /** A house ahead that must not get a parcel (#2365), by its place in the round's list, until said or passed. */
  readonly skip: { readonly index: number; readonly text: string } | undefined;
  /** The houses that must not get a parcel already said, by their place in the round's list. */
  readonly skipped: readonly number[];
}

/** Nothing owed: the start of a round. */
export const NOTHING_OWED: DeliveryOwed = Object.freeze({
  delivered: Object.freeze([]),
  missed: Object.freeze([]),
  crashes: 0,
  left: 0,
  roundOver: undefined,
  ahead: undefined,
  warned: Object.freeze([]),
  skip: undefined,
  skipped: Object.freeze([]),
});

/**
 * How far ahead a standing obstacle is said, metres — #2362: `obstacles.ts`
 * §`OBSTACLE_SIGHT_METRES`, 60 m, five seconds at the fastest speed every
 * obstacle is built to be avoidable at (`AVOIDABLE_FASTEST_METRES_PER_SECOND`,
 * 12 m/s), and a lane change takes under half a second. This project's own
 * number; #2364 sets the moving hazards' own.
 */
export const OBSTACLE_AHEAD_METRES = OBSTACLE_SIGHT_METRES;

/**
 * How far ahead a moving hazard is said, metres — #2364: `obstacles.ts`
 * §`MOVING_HAZARD_SIGHT_METRES`, 90 m, the distance it is set going at, so it
 * is said as it starts to move and at least `MOVING_HAZARD_WARNING_SECONDS`
 * before it can touch the rider at any avoidable speed (`moving-hazards.test.ts`).
 */
export const MOVING_HAZARD_AHEAD_METRES = MOVING_HAZARD_SIGHT_METRES;

/** What each kind is called aloud. */
const OBSTACLE_SAID: Readonly<Record<ObstacleKind, string>> = {
  'parked-car': 'A parked car',
  bin: 'A bin',
  trolley: 'A trolley',
  cone: 'A cone',
  dog: 'A dog',
  'car-pulling-out': 'A car pulling out',
  'oncoming-rider': 'A rider coming the other way',
};

/**
 * `A parked car ahead, in the left lane.`: the kind, and where it stands as the
 * rider faces it. The middle is said as "in the middle of the road", never
 * "the middle lane": the owner's ruling of 2026-11-09 on PR #2378.
 */
export function obstacleAheadSentence(obstacle: Obstacle): string {
  // #2364: a moving hazard is said by where it comes from, as the rider faces it.
  if (obstacle.from !== undefined && MOVING_HAZARD_KINDS.includes(obstacle.kind)) {
    if (obstacle.kind === 'oncoming-rider') {
      return `${OBSTACLE_SAID[obstacle.kind]}, in the ${obstacle.from} lane.`;
    }
    if (obstacle.kind === 'car-pulling-out') {
      return `${OBSTACLE_SAID[obstacle.kind]} ahead, on the ${obstacle.from}.`;
    }
    return `${OBSTACLE_SAID[obstacle.kind]} ahead, from the ${obstacle.from}.`;
  }
  const across = obstacle.stands ?? 0;
  const where =
    across < 0
      ? 'in the left lane'
      : across > 0
        ? 'in the right lane'
        : 'in the middle of the road';
  return `${OBSTACLE_SAID[obstacle.kind]} ahead, ${where}.`;
}

/**
 * Owe the nearest standing obstacle within {@link OBSTACLE_AHEAD_METRES}, or
 * moving hazard within {@link MOVING_HAZARD_AHEAD_METRES} (#2364), of the
 * rider at `along` that has not been said, and drop one still owed that
 * the rider has passed. After the round's end, nothing.
 */
export function oweObstacleAhead(
  owed: DeliveryOwed,
  obstacles: readonly Obstacle[],
  along: number,
): DeliveryOwed {
  if (owed.roundOver !== undefined) return owed;
  let ahead = owed.ahead;
  if (ahead !== undefined && !((obstacles[ahead.index]?.along ?? -Infinity) > along)) {
    ahead = undefined;
  }
  if (ahead === undefined) {
    let nearest: number | undefined;
    obstacles.forEach((obstacle, index) => {
      const moving = MOVING_HAZARD_KINDS.includes(obstacle.kind);
      if ((obstacle.stands === undefined && !moving) || owed.warned.includes(index)) return;
      const reach = moving ? MOVING_HAZARD_AHEAD_METRES : OBSTACLE_AHEAD_METRES;
      if (obstacle.along <= along || obstacle.along - along > reach) return;
      if (nearest === undefined || obstacle.along < (obstacles[nearest] as Obstacle).along) {
        nearest = index;
      }
    });
    if (nearest !== undefined) {
      ahead = { index: nearest, text: obstacleAheadSentence(obstacles[nearest] as Obstacle) };
    }
  }
  return ahead === owed.ahead ? owed : { ...owed, ahead };
}

/**
 * How far ahead a house that must not get a parcel is said, metres — #2365:
 * **45**, so it is said before its throw window opens `throw.ts`
 * §`THROW_WINDOW_BEFORE_METRES` (20 m) ahead of it, two seconds earlier at
 * 12 m/s, and after the house before it has gone by: the round's houses are
 * at least `targets.ts` §`TARGET_SPACING_METRES` (50 m) apart, so it is the
 * next house. This project's own number.
 */
export const SKIP_HOUSE_AHEAD_METRES = 45;

/** `Skip the next house, on the left. It gets no parcel.`: which side, never a place (#2365). */
export function skipHouseSentence(side: 'left' | 'right'): string {
  return `Skip the next house, on the ${side}. It gets no parcel.`;
}

/**
 * Owe the nearest house that must not get a parcel within
 * {@link SKIP_HOUSE_AHEAD_METRES} of the rider at `along` that has not been
 * said (#2365, ADR 0065 D-10.5), and drop one still owed that the rider has
 * passed. `houses` are each a distance and a side. After the round's end,
 * nothing.
 */
export function oweSkipHouse(
  owed: DeliveryOwed,
  houses: readonly { readonly distance: number; readonly side: 1 | -1 }[],
  along: number,
): DeliveryOwed {
  if (owed.roundOver !== undefined) return owed;
  let skip = owed.skip;
  if (skip !== undefined && !((houses[skip.index]?.distance ?? -Infinity) > along)) {
    skip = undefined;
  }
  if (skip === undefined) {
    let nearest: number | undefined;
    houses.forEach((house, index) => {
      if (owed.skipped.includes(index)) return;
      if (house.distance <= along || house.distance - along > SKIP_HOUSE_AHEAD_METRES) return;
      if (nearest === undefined || house.distance < (houses[nearest]?.distance ?? Infinity)) {
        nearest = index;
      }
    });
    if (nearest !== undefined) {
      const side = houses[nearest]?.side === 1 ? 'right' : 'left';
      skip = { index: nearest, text: skipHouseSentence(side) };
    }
  }
  return skip === owed.skip ? owed : { ...owed, skip };
}

/** `1st`, `2nd`, `3rd`, `4th` … `11th`, `12th`, `13th`, `21st`. */
export function ordinal(value: number): string {
  const tens = value % 100;
  const units = value % 10;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : units === 1
        ? 'st'
        : units === 2
          ? 'nd'
          : units === 3
            ? 'rd'
            : 'th';
  return `${String(value)}${suffix}`;
}

/** `the 3rd house`, `the 3rd and 4th houses`, `the 2nd, 3rd and 4th houses`. */
function theHouses(positions: readonly number[]): string {
  const said = positions.map((position) => ordinal(position + 1));
  const last = said.at(-1) ?? '';
  const listed = said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${last}` : last;
  return `the ${listed} ${said.length > 1 ? 'houses' : 'house'}`;
}

/** `No houses left.`, `1 house left.`, `5 houses left.` */
function housesLeft(left: number): string {
  if (left === 0) return 'No houses left.';
  return `${String(left)} ${left === 1 ? 'house' : 'houses'} left.`;
}

/** `1 house`, `8 houses`. */
function houses(count: number): string {
  return `${String(count)} ${count === 1 ? 'house' : 'houses'}`;
}

/**
 * What a round says at its end: what ending it decided, and the round's
 * `score` — #1816: the one with the crashes in it
 * (`delivery/ride-round.ts` §`DeliveryRide.score`), which the HUD's *Score*
 * field shows, so the two cannot disagree.
 */
export function roundOverSentence(outcome: RoundOutcome, score: number): string {
  const ridden = outcome.delivered + outcome.missed;
  const lead = `Round over: ${String(outcome.delivered)} of ${houses(ridden)} delivered, a score of ${String(score)}.`;
  if (!outcome.weekOver) {
    return `${lead} The round on day ${String(outcome.next.day)} has ${houses(outcome.nextHouses)}.`;
  }
  if (outcome.nextHouses === 0) {
    return `${lead} No houses are left on the round, so the week is over, with a score of ${String(outcome.weekScore)}.`;
  }
  return `${lead} That was the week's last round, and the week scored ${String(outcome.weekScore)}.`;
}

/**
 * Owe whatever changed between two states of the same round: each house that
 * went from expecting to delivered or to missed. After the round's end
 * nothing more is owed, because its sentence was the last word.
 */
export function oweRoundChange(owed: DeliveryOwed, before: Round, after: Round): DeliveryOwed {
  if (owed.roundOver !== undefined) return owed;
  const delivered = [...owed.delivered];
  const missed = [...owed.missed];
  after.houses.forEach((outcome, position) => {
    if (before.houses[position] !== 'expecting') return;
    if (outcome === 'delivered') delivered.push(position);
    else if (outcome === 'missed') missed.push(position);
  });
  if (delivered.length === owed.delivered.length && missed.length === owed.missed.length) {
    return owed;
  }
  return { ...owed, delivered, missed, left: roundTally(after).expecting };
}

/** Owe a crash (#1811's). After the round's end, nothing. */
export function oweCrash(owed: DeliveryOwed): DeliveryOwed {
  if (owed.roundOver !== undefined) return owed;
  return { ...owed, crashes: owed.crashes + 1 };
}

/**
 * Owe the round's end. It supersedes everything owed before it, and starts
 * with the misses and deliveries still owed, so no house's result goes
 * unsaid: "Missed the 7th house. Delivered to the 8th house. Round over: …".
 * Their houses-left count is dropped, because the round's end says the round.
 */
export function oweRoundOver(
  owed: DeliveryOwed,
  outcome: RoundOutcome,
  score: number,
): DeliveryOwed {
  const lead: string[] = [];
  if (owed.missed.length > 0) lead.push(`Missed ${theHouses(owed.missed)}.`);
  if (owed.delivered.length > 0) lead.push(`Delivered to ${theHouses(owed.delivered)}.`);
  const sentence = roundOverSentence(outcome, score);
  return { ...NOTHING_OWED, roundOver: [...lead, sentence].join(' ') };
}

/**
 * The HUD notice's label for a ride that asked for a round and has none —
 * #1818 — and for a round still waiting for the town (#2392,
 * {@link TOWN_LOADING_TEXT}).
 */
export const NO_ROUND_LABEL = 'Delivery';

/**
 * What a rider on a realistic Delivery ride is told while the round waits for
 * the realistic town — #2392, worded by the owner and approved on 2026-11-09.
 * On the HUD as a notice from the press until the round begins (the town
 * loaded, the load failed, or the arrival window lapsed), and said once
 * through the one region on {@link TOO_FEW_HOUSES_TEXT}'s rules
 * ({@link oweNoRound}: rank 5g, so only with announcements on). A sentence
 * still owed when the round begins is no longer offered.
 */
export const TOWN_LOADING_TEXT = 'Loading the town… your round starts when it arrives.';

/**
 * What a rider who chose a Delivery round is told when the press read the
 * route's mapped houses and fewer than `round.ts` §`FEWEST_DELIVERY_HOUSES`
 * are in reach — #1818, new rider-facing wording for the owner's approval.
 * On the HUD as a notice, and said once through the one region as the
 * round's last word (rank 5g, so only with announcements on: the owner's
 * ruling of 2026-10-28 on #1812). It names no place and no number of houses
 * the town has, only the floor every round is held to, that the ride is an
 * ordinary one, and that the week has not moved (`ride-round.ts` §"A route
 * with fewer houses than the day's rides a shorter round").
 */
export const TOO_FEW_HOUSES_TEXT =
  `Fewer than ${String(FEWEST_DELIVERY_HOUSES)} mapped houses on this route are in reach for ` +
  'today’s Delivery round, so this is an ordinary ride. Your week is as it was.';

/**
 * What the same rider is told when the press had no mapped houses to count
 * at all — #1818, the review of PR #1870: the route's map was still being
 * read, the read failed, the device was offline, the map tiles are off, or
 * the route is outside the map's coverage. The houses may well be there, so
 * this says only that they were not ready, never that there are too few.
 * New rider-facing wording for the owner's approval, on the same rules as
 * {@link TOO_FEW_HOUSES_TEXT}.
 */
export const HOUSES_NOT_READY_TEXT =
  'The map’s houses were not ready for today’s Delivery round, so this is an ordinary ride. ' +
  'Your week is as it was.';

/**
 * Owe the sentence for a ride that asked for a round and has none:
 * {@link TOO_FEW_HOUSES_TEXT} or {@link HOUSES_NOT_READY_TEXT}. It is the
 * only thing a ride with no round says about Delivery, so it is owed as the
 * round's last word, and said once like any other (#1818).
 */
export function oweNoRound(text: string): DeliveryOwed {
  return { ...NOTHING_OWED, roundOver: text };
}

/** What to offer `announce.ts` on this call: one event per kind owed. */
export function deliveryEvents(owed: DeliveryOwed): readonly AnnouncementEvent[] {
  const events: AnnouncementEvent[] = [];
  if (owed.ahead !== undefined) {
    events.push({ kind: 'delivery-obstacle-ahead', text: owed.ahead.text });
  }
  if (owed.skip !== undefined) {
    events.push({ kind: 'delivery-skip-house', text: owed.skip.text });
  }
  if (owed.roundOver !== undefined) {
    events.push({ kind: 'delivery-round-over', text: owed.roundOver });
  }
  if (owed.crashes > 0) {
    events.push({
      kind: 'delivery-crash',
      text:
        owed.crashes === 1
          ? 'Crashed into an obstacle.'
          : `Crashed into ${String(owed.crashes)} obstacles.`,
    });
  }
  if (owed.missed.length > 0) {
    events.push({
      kind: 'delivery-missed',
      text: `Missed ${theHouses(owed.missed)}. ${housesLeft(owed.left)}`,
    });
  }
  if (owed.delivered.length > 0) {
    events.push({
      kind: 'delivery-delivered',
      text: `Delivered to ${theHouses(owed.delivered)}. ${housesLeft(owed.left)}`,
    });
  }
  return events;
}

/**
 * What is still owed once the core has said `kind` — the `kind` its
 * `Announcement` came back with, `undefined` when it said nothing. Only the
 * kind said is settled; every other stays owed.
 */
export function deliverySpoken(
  owed: DeliveryOwed,
  kind: AnnouncementKind | undefined,
): DeliveryOwed {
  switch (kind) {
    case 'delivery-obstacle-ahead':
      return owed.ahead === undefined
        ? owed
        : { ...owed, ahead: undefined, warned: [...owed.warned, owed.ahead.index] };
    case 'delivery-skip-house':
      return owed.skip === undefined
        ? owed
        : { ...owed, skip: undefined, skipped: [...owed.skipped, owed.skip.index] };
    case 'delivery-round-over':
      return { ...owed, roundOver: undefined };
    case 'delivery-crash':
      return { ...owed, crashes: 0 };
    case 'delivery-missed':
      return { ...owed, missed: [] };
    case 'delivery-delivered':
      return { ...owed, delivered: [] };
    default:
      return owed;
  }
}
