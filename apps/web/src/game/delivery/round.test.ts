// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DAYS_IN_WEEK,
  endRound,
  FIRST_DAY_HOUSES,
  FRESH_WEEK,
  MOST_HOUSES,
  recordDelivery,
  recordMiss,
  type Round,
  startRound,
  type WeekProgress,
} from './round';

/** Record a delivery at every position, in order. */
function deliverAll(round: Round): Round {
  return round.houses.reduce((so, _, position) => recordDelivery(so, position), round);
}

/** Record a miss at every position, in order. */
function missAll(round: Round): Round {
  return round.houses.reduce((so, _, position) => recordMiss(so, position), round);
}

describe('the Delivery round — #1806, DL2', () => {
  it('starts with every house on the round expecting a parcel, unassisted', () => {
    const round = startRound(FIRST_DAY_HOUSES);
    expect(round.houses).toEqual(Array.from({ length: FIRST_DAY_HOUSES }, () => 'expecting'));
    expect(round.assisted).toBe(false);
  });

  it.each([0, -1, MOST_HOUSES + 1, 2.5, Number.NaN])('refuses a round of %s houses', (houses) => {
    expect(() => startRound(houses)).toThrow(RangeError);
  });

  it('adds one house after a perfect round', () => {
    const outcome = endRound(FRESH_WEEK, deliverAll(startRound(FIRST_DAY_HOUSES)));
    expect(outcome).toMatchObject({
      delivered: FIRST_DAY_HOUSES,
      missed: 0,
      perfect: true,
      nextHouses: FIRST_DAY_HOUSES + 1,
      weekScore: FIRST_DAY_HOUSES,
      weekOver: false,
    });
    expect(outcome.next).toEqual({ day: 2, houses: FIRST_DAY_HOUSES + 1, score: FIRST_DAY_HOUSES });
  });

  it('adds none past the most a round holds', () => {
    const week: WeekProgress = { day: 3, houses: MOST_HOUSES, score: 10 };
    const outcome = endRound(week, deliverAll(startRound(MOST_HOUSES)));
    expect(outcome.perfect).toBe(true);
    expect(outcome.nextHouses).toBe(MOST_HOUSES);
  });

  it('drops one house from the next round for each miss', () => {
    let round = startRound(FIRST_DAY_HOUSES);
    round = recordMiss(round, 1);
    round = recordMiss(round, 4);
    round = recordMiss(round, 6);
    for (const position of [0, 2, 3, 5, 7]) round = recordDelivery(round, position);
    const outcome = endRound(FRESH_WEEK, round);
    expect(outcome).toMatchObject({
      delivered: 5,
      missed: 3,
      perfect: false,
      nextHouses: FIRST_DAY_HOUSES - 3,
      weekScore: 5,
      weekOver: false,
    });
    expect(outcome.next).toEqual({ day: 2, houses: FIRST_DAY_HOUSES - 3, score: 5 });
  });

  it('ends the week when every house on the round is missed', () => {
    const week: WeekProgress = { day: 2, houses: 4, score: 9 };
    const outcome = endRound(week, missAll(startRound(4)));
    expect(outcome).toMatchObject({
      delivered: 0,
      missed: 4,
      nextHouses: 0,
      weekScore: 9,
      weekOver: true,
    });
    expect(outcome.next).toEqual(FRESH_WEEK);
  });

  it('ends the week on the seventh day, and not before', () => {
    const sixth: WeekProgress = { day: DAYS_IN_WEEK - 1, houses: 8, score: 30 };
    const before = endRound(sixth, deliverAll(startRound(8)));
    expect(before.weekOver).toBe(false);
    expect(before.next).toEqual({ day: DAYS_IN_WEEK, houses: 9, score: 38 });

    const seventh: WeekProgress = { day: DAYS_IN_WEEK, houses: 9, score: 38 };
    const last = endRound(seventh, deliverAll(startRound(9)));
    expect(last.weekOver).toBe(true);
    expect(last.weekScore).toBe(47);
    expect(last.next).toEqual(FRESH_WEEK);
  });

  it('counts a miss once: a late delivery to a missed house neither delivers it nor scores', () => {
    const missed = recordMiss(startRound(3), 1);
    const late = recordDelivery(missed, 1);
    expect(late.houses[1]).toBe('missed');
    const withLate = endRound(FRESH_WEEK, recordDelivery(recordDelivery(late, 0), 2));
    const withoutLate = endRound(FRESH_WEEK, recordDelivery(recordDelivery(missed, 0), 2));
    expect(withLate).toEqual(withoutLate);
    expect(withLate).toMatchObject({ delivered: 2, missed: 1, weekScore: 2, nextHouses: 2 });
  });

  it('keeps a delivery when a miss is reported for the same house afterwards', () => {
    const delivered = recordMiss(recordDelivery(startRound(2), 0), 0);
    expect(delivered.houses[0]).toBe('delivered');
  });

  it('counts a house still expecting when the round ends as missed', () => {
    const outcome = endRound(FRESH_WEEK, recordDelivery(startRound(3), 0));
    expect(outcome).toMatchObject({ delivered: 1, missed: 2, perfect: false, nextHouses: 1 });
  });

  it('records by round position only, refusing one off the round', () => {
    const round = startRound(4);
    for (const position of [-1, 4, 1.5, Number.NaN]) {
      expect(() => recordDelivery(round, position)).toThrow(RangeError);
      expect(() => recordMiss(round, position)).toThrow(RangeError);
    }
  });

  it('leaves the round it was handed unchanged', () => {
    const round = startRound(2);
    const next = recordDelivery(round, 0);
    expect(round.houses).toEqual(['expecting', 'expecting']);
    expect(next.houses).toEqual(['delivered', 'expecting']);
  });
});

describe('the assist setting keeps a missed house on the round — #1806 for #1813', () => {
  it('leaves the next count unchanged after a round full of misses', () => {
    const round = startRound(FIRST_DAY_HOUSES, { assisted: true });
    expect(round.assisted).toBe(true);
    const outcome = endRound(FRESH_WEEK, missAll(round));
    expect(outcome).toMatchObject({
      delivered: 0,
      missed: FIRST_DAY_HOUSES,
      nextHouses: FIRST_DAY_HOUSES,
      weekOver: false,
    });
    expect(outcome.next).toEqual({ day: 2, houses: FIRST_DAY_HOUSES, score: 0 });
  });

  it('carries the assist through a recorded outcome, and still adds one for a perfect round', () => {
    const round = deliverAll(startRound(5, { assisted: true }));
    expect(round.assisted).toBe(true);
    expect(endRound(FRESH_WEEK, round).nextHouses).toBe(6);
  });
});
