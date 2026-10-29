// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Delivery round, as pure logic — #1806, resting on the owner's rulings
 * DL2 and DL11 of 2026-10-27 (epic #1803).
 *
 * A game ride runs a round through `ride-round.ts` (#1816), which starts,
 * settles and ends it here, and the HUD (#1812) reads it through
 * {@link roundTally} and {@link DAYS_IN_WEEK}.
 *
 * ## What it decides
 *
 * Which houses are on today's round, what a delivery and a miss do to it, and
 * how the week moves on. DL2: **a missed house drops out of the next round,
 * and a perfect round adds one.** No drawing, no input, and nothing here
 * knows which house in the town a round position stands for: a house is a
 * **position on the round**, `0` to `n - 1`, and the pick that maps a
 * position to a mapped house is #1808's, held in memory for one ride.
 *
 * ## The numbers are this project's own, proposed for the owner's approval
 *
 * {@link FIRST_DAY_HOUSES}, {@link MOST_HOUSES} and {@link DAYS_IN_WEEK} are
 * the starting point #1806 offered to argue with. Nothing else in the module
 * hard-codes them, so an approved change is a change to three constants.
 *
 * ## A house's outcome is settled once
 *
 * The first delivery or miss recorded for a position stands. A late delivery
 * to a house already missed does not deliver it and does not score, and a
 * miss reported after a delivery does not take the delivery back.
 */

/** Houses on the round on the first day of a week. */
export const FIRST_DAY_HOUSES = 8;

/** The most houses a round can hold: a perfect round adds one, up to this. */
export const MOST_HOUSES = 12;

/** Rounds in a week. The week also ends early when no house is left. */
export const DAYS_IN_WEEK = 7;

/**
 * The most a week can score: one point a delivery, every house on every day.
 */
export const MOST_WEEK_SCORE = DAYS_IN_WEEK * MOST_HOUSES;

/** Where a house on the round stands. */
export type HouseOutcome = 'expecting' | 'delivered' | 'missed';

/** A round being ridden: one outcome per round position. */
export interface Round {
  /** Indexed by round position, `0` to `n - 1`. Never a map identifier. */
  readonly houses: readonly HouseOutcome[];
  /** The assist setting (#1813): a missed house stays on the next round. */
  readonly assisted: boolean;
}

/**
 * The week so far — and, by DL11, everything about it that may outlive a
 * ride: counts only, never a house, an index into the town or a seed.
 */
export interface WeekProgress {
  /** The day the next round is ridden on, `1` to {@link DAYS_IN_WEEK}. */
  readonly day: number;
  /** How many houses that round holds, `1` to {@link MOST_HOUSES}. */
  readonly houses: number;
  /** Deliveries so far this week, `0` to {@link MOST_WEEK_SCORE}. */
  readonly score: number;
}

/**
 * A week nobody has ridden yet.
 */
export const FRESH_WEEK: WeekProgress = Object.freeze({
  day: 1,
  houses: FIRST_DAY_HOUSES,
  score: 0,
});

/**
 * What ending a round decided.
 */
export interface RoundOutcome {
  readonly delivered: number;
  /** Houses missed. A house still expecting when the round ended was never reached, and is not one (#1857). */
  readonly missed: number;
  /** Every house on the round delivered. */
  readonly perfect: boolean;
  /** Houses on the next round; `0` when no house is left. */
  readonly nextHouses: number;
  /** The week's score with this round's deliveries added. */
  readonly weekScore: number;
  /** This was the last day, or no house is left. */
  readonly weekOver: boolean;
  /** What to keep for the next ride: tomorrow, or a fresh week when this one is over. */
  readonly next: WeekProgress;
}

/**
 * What starting a round may ask for.
 */
export interface RoundOptions {
  /** The assist setting (#1813). Off unless asked for. */
  readonly assisted?: boolean;
}

/**
 * Start a round of `houses` houses, every one of them expecting a parcel.
 */
export function startRound(houses: number, options: RoundOptions = {}): Round {
  if (!Number.isInteger(houses) || houses < 1 || houses > MOST_HOUSES) {
    throw new RangeError(
      `a Delivery round holds a whole number of houses from 1 to ${String(MOST_HOUSES)}`,
    );
  }
  return {
    houses: Array.from({ length: houses }, (): HouseOutcome => 'expecting'),
    assisted: options.assisted === true,
  };
}

/** Where a round being ridden stands, counted — #1812, for the HUD. */
export interface RoundTally {
  /** Houses still expecting a parcel. */
  readonly expecting: number;
  readonly delivered: number;
  readonly missed: number;
  /**
   * The round's score with no crash in it: one point a delivery, so never
   * below zero. The HUD's *Score* and the round's-end sentence read it here.
   *
   * ⚠️ Crashes (#1811, PR #1844) are not counted here. The owner's rulings of
   * 2026-10-28 on #1811 say a crash comes off the round's score, which never
   * goes below zero at any moment, and comes off nothing else: the week's
   * score, {@link endRound}'s `weekScore`, counts deliveries only. So since
   * #1816 the HUD and the round's end are handed the round's score with the
   * crashes in it, `ride-round.ts` §`DeliveryRide.score`, in place of this one.
   */
  readonly score: number;
}

/** Count a round as it stands. A house still expecting is neither delivered nor missed yet. */
export function roundTally(round: Round): RoundTally {
  let delivered = 0;
  let missed = 0;
  for (const outcome of round.houses) {
    if (outcome === 'delivered') delivered += 1;
    else if (outcome === 'missed') missed += 1;
  }
  return {
    expecting: round.houses.length - delivered - missed,
    delivered,
    missed,
    score: delivered,
  };
}

/**
 * A parcel landed on the house at this round position before the rider passed it.
 */
export function recordDelivery(round: Round, position: number): Round {
  return settle(round, position, 'delivered');
}

/**
 * The rider passed the throw window of the house at this round position with no delivery.
 */
export function recordMiss(round: Round, position: number): Round {
  return settle(round, position, 'missed');
}

/** The first outcome recorded for a position stands; a later one changes nothing. */
function settle(round: Round, position: number, outcome: HouseOutcome): Round {
  const count = round.houses.length;
  if (!Number.isInteger(position) || position < 0 || position >= count) {
    throw new RangeError(
      `a round position is a whole number from 0 to ${String(count - 1)} on a round of ${String(count)}`,
    );
  }
  if (round.houses[position] !== 'expecting') return round;
  const houses = [...round.houses];
  houses[position] = outcome;
  return { ...round, houses };
}

/**
 * End the round ridden on `week`'s day, and say what the next ride starts
 * from. The round's own length is the count that was ridden.
 *
 * A house still expecting when the round ends is one the rider never reached
 * (#1857, the owner's ruling of 2026-10-29): the ride ended before its throw
 * window closed, so it is neither delivered nor missed, and counts for
 * nothing. Which houses the rider had passed is `ride-round.ts`'
 * §`endDeliveryRide`, which records each as missed before it ends the round
 * here. So a round ended early keeps what was delivered and missed so far: a
 * perfect round is one with every house delivered, and a round with no house
 * reached at all leaves the week as it was, as a ride lost mid-round does.
 */
export function endRound(week: WeekProgress, round: Round): RoundOutcome {
  const count = round.houses.length;
  const { delivered, missed } = roundTally(round);
  if (delivered + missed === 0) {
    return {
      delivered,
      missed,
      perfect: false,
      nextHouses: week.houses,
      weekScore: week.score,
      weekOver: false,
      next: week,
    };
  }
  const perfect = delivered === count;
  const nextHouses = perfect
    ? Math.min(count + 1, MOST_HOUSES)
    : round.assisted
      ? count
      : count - missed;
  const weekScore = week.score + delivered;
  const weekOver = nextHouses === 0 || week.day >= DAYS_IN_WEEK;
  return {
    delivered,
    missed,
    perfect,
    nextHouses,
    weekScore,
    weekOver,
    next: weekOver ? FRESH_WEEK : { day: week.day + 1, houses: nextHouses, score: weekScore },
  };
}
