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
  roundTally,
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

  it('counts a house still expecting when the round ends as never reached: neither delivered nor missed (#1857)', () => {
    const outcome = endRound(FRESH_WEEK, recordMiss(recordDelivery(startRound(4), 0), 1));
    expect(outcome).toMatchObject({ delivered: 1, missed: 1, perfect: false, nextHouses: 3 });
    expect(outcome.next).toEqual({ day: 2, houses: 3, score: 1 });
    // Every house reached delivered is still not a perfect round while some were never reached.
    const unmissed = endRound(FRESH_WEEK, recordDelivery(startRound(3), 0));
    expect(unmissed).toMatchObject({ delivered: 1, missed: 0, perfect: false, nextHouses: 3 });
  });

  it('leaves the week as it was when a round ends with no house reached (#1857)', () => {
    const week: WeekProgress = { day: DAYS_IN_WEEK, houses: 5, score: 22 };
    const outcome = endRound(week, startRound(4));
    expect(outcome).toEqual({
      delivered: 0,
      missed: 0,
      perfect: false,
      nextHouses: 5,
      weekScore: 22,
      weekOver: false,
      next: week,
    });
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

describe('the round, counted — #1812, for the HUD', () => {
  it('counts each outcome, and scores one point a delivery', () => {
    const round = recordMiss(recordDelivery(recordDelivery(startRound(5), 0), 3), 1);
    expect(roundTally(round)).toEqual({ expecting: 2, delivered: 2, missed: 1, score: 2 });
  });

  it('scores what endRound adds to the week', () => {
    const round = recordMiss(recordDelivery(startRound(4), 2), 0);
    expect(endRound(FRESH_WEEK, round).weekScore - FRESH_WEEK.score).toBe(roundTally(round).score);
  });

  it('counts a fresh round as every house expecting', () => {
    expect(roundTally(startRound(FIRST_DAY_HOUSES))).toEqual({
      expecting: FIRST_DAY_HOUSES,
      delivered: 0,
      missed: 0,
      score: 0,
    });
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

  it('keeps the round length when only some houses are missed', () => {
    let round = startRound(5, { assisted: true });
    round = recordDelivery(round, 0);
    round = recordDelivery(round, 1);
    round = recordDelivery(round, 2);
    round = recordMiss(round, 3);
    round = recordMiss(round, 4);
    const outcome = endRound({ day: 1, houses: 5, score: 0 }, round);
    expect(outcome).toMatchObject({ delivered: 3, missed: 2, nextHouses: 5 });
    expect(outcome.next).toEqual({ day: 2, houses: 5, score: 3 });
  });

  it('carries the assist through a recorded outcome, and still adds one for a perfect round', () => {
    const round = deliverAll(startRound(5, { assisted: true }));
    expect(round.assisted).toBe(true);
    expect(endRound(FRESH_WEEK, round).nextHouses).toBe(6);
  });
});

describe('a short round, on a route with fewer houses than the day’s count — #1818', () => {
  const week: WeekProgress = { day: 2, houses: FIRST_DAY_HOUSES, score: 5 };

  it('stands for its own length unless told the day’s count', () => {
    expect(startRound(3).dayHouses).toBe(3);
    expect(startRound(3, { dayHouses: FIRST_DAY_HOUSES }).dayHouses).toBe(FIRST_DAY_HOUSES);
  });

  it.each([2, MOST_HOUSES + 1, 4.5, Number.NaN])('refuses a round of 3 standing for %s', (day) => {
    expect(() => startRound(3, { dayHouses: day })).toThrow(RangeError);
  });

  it('adds one to the day’s count after a perfect short round, as a full round does', () => {
    const outcome = endRound(week, deliverAll(startRound(3, { dayHouses: week.houses })));
    expect(outcome).toMatchObject({ perfect: true, nextHouses: FIRST_DAY_HOUSES + 1 });
    expect(outcome.next).toEqual({ day: 3, houses: FIRST_DAY_HOUSES + 1, score: 8 });
    // The control: the same round standing for itself would leave tomorrow at 4.
    expect(endRound(week, deliverAll(startRound(3))).nextHouses).toBe(4);
  });

  it('takes only the houses missed off the day’s count, and none with the assist', () => {
    const missed = recordDelivery(recordMiss(recordMiss(startRound(3, { dayHouses: 8 }), 0), 1), 2);
    expect(endRound(week, missed)).toMatchObject({ delivered: 1, missed: 2, nextHouses: 6 });
    const assisted = missAll(startRound(3, { dayHouses: 8, assisted: true }));
    expect(endRound(week, assisted).next).toEqual({ day: 3, houses: 8, score: 5 });
  });

  it('ends the week on its last day as a full round does', () => {
    const last: WeekProgress = { day: DAYS_IN_WEEK, houses: FIRST_DAY_HOUSES, score: 30 };
    const outcome = endRound(last, deliverAll(startRound(3, { dayHouses: 8 })));
    expect(outcome).toMatchObject({ weekOver: true, weekScore: 33, next: FRESH_WEEK });
  });
});

describe('FRESH_WEEK is shared, so it cannot be changed at runtime', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(FRESH_WEEK)).toBe(true);
  });
});
