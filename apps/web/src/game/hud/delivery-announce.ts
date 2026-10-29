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
 * ## The words are this project's own (DL1), for the owner's approval
 *
 * Every sentence below is new rider-facing wording, proposed in #1812's pull
 * request: "on the round", a house, a parcel; never a subscriber or a paper.
 */

import { roundTally, type Round, type RoundOutcome } from '../delivery/round';

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
}

/** Nothing owed: the start of a round. */
export const NOTHING_OWED: DeliveryOwed = Object.freeze({
  delivered: Object.freeze([]),
  missed: Object.freeze([]),
  crashes: 0,
  left: 0,
  roundOver: undefined,
});

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

/** The HUD notice's label for a ride that asked for a round and has none — #1818. */
export const NO_ROUND_LABEL = 'Delivery';

/**
 * What a rider who chose a Delivery round is told when the press finds too
 * few mapped houses for it — #1818, new rider-facing wording for the owner's
 * approval. On the HUD as a notice, and said once through the one region as
 * the round's last word (rank 5g, so only with announcements on: the owner's
 * ruling of 2026-10-28 on #1812). It names no place and no number of houses
 * the town has: only that there are too few, that the ride is an ordinary
 * one, and that the week has not moved (`ride-round.ts` §"A town with too
 * few houses for the round has no round").
 */
export const NO_ROUND_TEXT =
  'Too few mapped houses on this route for today’s Delivery round, so this is an ordinary ' +
  'ride. Your week is as it was.';

/**
 * Owe {@link NO_ROUND_TEXT}: a ride that asked for a round and has none. It
 * is the only thing a ride with no round says about Delivery, so it is owed
 * as the round's last word, and said once like any other (#1818).
 */
export function oweNoRound(): DeliveryOwed {
  return { ...NOTHING_OWED, roundOver: NO_ROUND_TEXT };
}

/** What to offer `announce.ts` on this call: one event per kind owed. */
export function deliveryEvents(owed: DeliveryOwed): readonly AnnouncementEvent[] {
  const events: AnnouncementEvent[] = [];
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
