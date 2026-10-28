// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Delivery round through the HUD's one live region — #1812. Every case
 * that says what is HEARD drives the real core, `announce.ts`, on a fake
 * clock, the way `GameView` drives it: offer what is owed, call the core,
 * settle what it said. So "said once, in this order" is read off what the
 * core returned, never off the owed state alone.
 */

import { describe, expect, it } from 'vitest';

import {
  endRound,
  FRESH_WEEK,
  recordDelivery,
  recordMiss,
  startRound,
  type Round,
} from '../delivery/round';

import {
  ALWAYS_SPOKEN,
  ANNOUNCE_WINDOW_SECONDS,
  INITIAL_ANNOUNCER,
  PRIORITY,
  announce,
  type AnnouncementEvent,
  type AnnouncerState,
} from './announce';
import { DEFAULT_ANNOUNCEMENTS, type AnnouncementPreference } from './announce-preference';
import {
  NOTHING_OWED,
  deliveryEvents,
  deliverySpoken,
  ordinal,
  oweCrash,
  oweRoundChange,
  oweRoundOver,
  roundOverSentence,
  type DeliveryOwed,
} from './delivery-announce';

const QUIET: AnnouncementPreference = {
  ...DEFAULT_ANNOUNCEMENTS,
  enabled: true,
  powerEverySeconds: 'never',
  distanceEvery: 'never',
};

const DELIVERY_KINDS = [
  'delivery-round-over',
  'delivery-crash',
  'delivery-missed',
  'delivery-delivered',
] as const;

/** The caller's loop, as `GameView` runs it: offer what is owed, then settle what was said. */
class Caller {
  owed: DeliveryOwed = NOTHING_OWED;
  state: AnnouncerState = INITIAL_ANNOUNCER;
  readonly said: { readonly at: number; readonly kind: string; readonly text: string }[] = [];

  constructor(private readonly preference: AnnouncementPreference = QUIET) {}

  call(now: number, others: readonly AnnouncementEvent[] = []): void {
    const heard = announce(this.state, {
      now,
      readings: [],
      events: [...others, ...deliveryEvents(this.owed)],
      preference: this.preference,
    });
    this.state = heard.state;
    this.owed = deliverySpoken(this.owed, heard.kind);
    if (heard.sentence !== undefined && heard.kind !== undefined) {
      this.said.push({ at: now, kind: heard.kind, text: heard.sentence });
    }
  }

  /** Call once a second from `from` to `to`, inclusive. */
  ride(from: number, to: number): void {
    for (let now = from; now <= to; now += 1) this.call(now);
  }
}

describe('Delivery’s place in the announcer’s order — #1812, rank 5g', () => {
  it('ranks the round’s end, a crash, a miss and a delivery, in that order, below every other event and above every reading', () => {
    const at = (kind: (typeof PRIORITY)[number]): number => PRIORITY.indexOf(kind);
    expect(DELIVERY_KINDS.map(at)).toEqual(
      DELIVERY_KINDS.map((_, index) => at('room-draft') + 1 + index),
    );
    for (const reading of ['power-off-target', 'distance-tick', 'power'] as const) {
      expect(at('delivery-delivered')).toBeLessThan(at(reading));
    }
  });
});

/**
 * The owner's ruling of 2026-10-28 on #1812: Delivery's announcements follow
 * the rider's announcement setting ("Only when announcements on"). It decides
 * nothing about #1316's `lap-ended`.
 */
describe('Delivery follows the rider’s announcement setting — #1812, the owner’s ruling of 2026-10-28', () => {
  /** A delivery, a crash and a miss owed, then the round's end: all four kinds offered. */
  function rideARound(preference: AnnouncementPreference): readonly string[] {
    const caller = new Caller(preference);
    const round = startRound(3);
    const delivered = recordDelivery(round, 0);
    const missed = recordMiss(delivered, 1);
    caller.owed = oweCrash(
      oweRoundChange(oweRoundChange(NOTHING_OWED, round, delivered), delivered, missed),
    );
    caller.ride(0, 6);
    const ended = recordMiss(missed, 2);
    caller.owed = oweRoundOver(caller.owed, ended, endRound(FRESH_WEEK, ended));
    caller.ride(7, 12);
    return caller.said.map((each) => each.kind);
  }

  it('says no delivery, miss, crash or round’s end with announcements off, the default', () => {
    for (const kind of DELIVERY_KINDS) expect(ALWAYS_SPOKEN).not.toContain(kind);
    expect(DEFAULT_ANNOUNCEMENTS.enabled).toBe(false);
    expect(rideARound(DEFAULT_ANNOUNCEMENTS)).toEqual([]);
  });

  it('says each of the four with announcements on (every reading set to never)', () => {
    expect(QUIET.enabled).toBe(true);
    expect(rideARound(QUIET)).toEqual([
      'delivery-crash',
      'delivery-missed',
      'delivery-delivered',
      'delivery-round-over',
    ]);
  });
});

describe('the sentences — #1812, the words for the owner’s approval', () => {
  it('names a house by its place on the round', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });

  it('says a delivery and a miss with the houses left', () => {
    const round = startRound(6);
    const delivered = recordDelivery(round, 2);
    const owed = oweRoundChange(NOTHING_OWED, round, delivered);
    expect(deliveryEvents(owed)).toEqual([
      { kind: 'delivery-delivered', text: 'Delivered to the 3rd house. 5 houses left.' },
    ]);
    const missed = oweRoundChange(owed, delivered, recordMiss(delivered, 3));
    expect(deliveryEvents(missed)).toEqual([
      { kind: 'delivery-missed', text: 'Missed the 4th house. 4 houses left.' },
      { kind: 'delivery-delivered', text: 'Delivered to the 3rd house. 4 houses left.' },
    ]);
  });

  it('says one house left, and none', () => {
    const one = recordDelivery(startRound(2), 0);
    expect(deliveryEvents(oweRoundChange(NOTHING_OWED, startRound(2), one))[0]?.text).toBe(
      'Delivered to the 1st house. 1 house left.',
    );
    const none = recordMiss(one, 1);
    expect(deliveryEvents(oweRoundChange(NOTHING_OWED, one, none))[0]?.text).toBe(
      'Missed the 2nd house. No houses left.',
    );
  });

  it('folds deliveries not yet said into one sentence naming each house', () => {
    let round: Round = startRound(8);
    let owed = NOTHING_OWED;
    for (const position of [1, 2, 3]) {
      const next = recordDelivery(round, position);
      owed = oweRoundChange(owed, round, next);
      round = next;
      if (position === 2) {
        expect(deliveryEvents(owed)[0]?.text).toBe(
          'Delivered to the 2nd and 3rd houses. 6 houses left.',
        );
      }
    }
    expect(deliveryEvents(owed)).toEqual([
      {
        kind: 'delivery-delivered',
        text: 'Delivered to the 2nd, 3rd and 4th houses. 5 houses left.',
      },
    ]);
  });

  it('says a crash, and crashes not yet said as one', () => {
    expect(deliveryEvents(oweCrash(NOTHING_OWED))).toEqual([
      { kind: 'delivery-crash', text: 'Crashed into an obstacle.' },
    ]);
    expect(deliveryEvents(oweCrash(oweCrash(NOTHING_OWED)))[0]?.text).toBe(
      'Crashed into 2 obstacles.',
    );
  });

  it('says the round’s end, and what the next round holds', () => {
    const round = recordMiss(recordDelivery(recordDelivery(startRound(3), 0), 1), 2);
    expect(roundOverSentence(round, endRound(FRESH_WEEK, round))).toBe(
      'Round over: 2 of 3 houses delivered, a score of 2. The round on day 2 has 2 houses.',
    );
    const one = recordMiss(recordDelivery(startRound(2), 0), 1);
    expect(roundOverSentence(one, endRound(FRESH_WEEK, one))).toBe(
      'Round over: 1 of 2 houses delivered, a score of 1. The round on day 2 has 1 house.',
    );
  });

  it('says the week’s end on its last day, with the week’s score', () => {
    const round = recordDelivery(startRound(1), 0);
    const outcome = endRound({ day: 7, houses: 1, score: 30 }, round);
    expect(roundOverSentence(round, outcome)).toBe(
      "Round over: 1 of 1 house delivered, a score of 1. That was the week's last round, and the week scored 31.",
    );
  });

  it('says the week’s end when no house is left', () => {
    const round = recordMiss(startRound(1), 0);
    const outcome = endRound({ day: 4, houses: 1, score: 20 }, round);
    expect(roundOverSentence(round, outcome)).toBe(
      'Round over: 0 of 1 house delivered, a score of 0. No houses are left on the round, so the week is over, with a score of 20.',
    );
  });

  it('owes nothing for a change that settles no house', () => {
    const round = recordDelivery(startRound(4), 0);
    // A late delivery to a house already settled changes nothing (`round.ts`).
    expect(oweRoundChange(NOTHING_OWED, round, recordDelivery(round, 0))).toBe(NOTHING_OWED);
  });
});

describe('each said once, in the order chosen, through the real core — #1812', () => {
  it('says a crash and a delivery in the same window crash first, then the delivery in the next window', () => {
    const caller = new Caller();
    const round = startRound(5);
    caller.owed = oweCrash(oweRoundChange(NOTHING_OWED, round, recordDelivery(round, 0)));
    caller.ride(0, 10);
    expect(caller.said).toEqual([
      { at: 0, kind: 'delivery-crash', text: 'Crashed into an obstacle.' },
      {
        at: ANNOUNCE_WINDOW_SECONDS,
        kind: 'delivery-delivered',
        text: 'Delivered to the 1st house. 4 houses left.',
      },
    ]);
  });

  it('says a delivery that landed while a crash was being said, after it and once', () => {
    const caller = new Caller();
    const round = startRound(5);
    caller.owed = oweCrash(NOTHING_OWED);
    caller.call(0);
    caller.owed = oweRoundChange(caller.owed, round, recordDelivery(round, 1));
    caller.ride(1, 12);
    expect(caller.said.map((each) => each.kind)).toEqual(['delivery-crash', 'delivery-delivered']);
  });

  it('never drops the round’s end: a fault in the same window goes first, and the end is said after it, once', () => {
    const caller = new Caller();
    const round = recordMiss(recordDelivery(startRound(2), 0), 1);
    caller.owed = oweRoundOver(caller.owed, round, endRound(FRESH_WEEK, round));
    const fault = { kind: 'trainer-lost', text: 'Control lost.' } as const;
    caller.call(0, [fault]);
    caller.ride(1, 20);
    expect(caller.said.map((each) => each.kind)).toEqual(['trainer-lost', 'delivery-round-over']);
    expect(caller.said[1]?.text).toMatch(/^Round over: 1 of 2 houses delivered/);
  });

  it('never drops the round’s end behind a crash, a miss or a delivery offered after it', () => {
    const caller = new Caller();
    const round = recordDelivery(startRound(3), 0);
    caller.owed = oweRoundOver(caller.owed, round, endRound(FRESH_WEEK, round));
    // Whatever the round's own events try to add later, nothing displaces it.
    caller.owed = oweCrash(caller.owed);
    caller.owed = oweRoundChange(caller.owed, round, recordDelivery(round, 1));
    caller.ride(0, 20);
    expect(caller.said.map((each) => each.kind)).toEqual(['delivery-round-over']);
  });

  it('lets the round’s end supersede what was owed before it, and start with the house still owed', () => {
    const caller = new Caller();
    const round = startRound(3);
    const delivered = recordDelivery(round, 0);
    caller.owed = oweCrash(oweRoundChange(NOTHING_OWED, round, delivered));
    caller.owed = oweRoundOver(caller.owed, delivered, endRound(FRESH_WEEK, delivered));
    caller.ride(0, 20);
    expect(caller.said).toEqual([
      {
        at: 0,
        kind: 'delivery-round-over',
        text: 'Delivered to the 1st house. Round over: 1 of 3 houses delivered, a score of 1. The round on day 2 has 1 house.',
      },
    ]);
  });

  it('never loses the last house to the round’s end: still waiting on the window, it starts the round’s end', () => {
    const caller = new Caller();
    let round: Round = startRound(2);
    caller.owed = oweRoundChange(caller.owed, round, recordDelivery(round, 0));
    round = recordDelivery(round, 0);
    caller.call(0);
    // The last house lands inside the window of the first, and the round
    // ends before that window closes, so its own sentence never had a turn.
    const last = recordMiss(round, 1);
    caller.owed = oweRoundChange(caller.owed, round, last);
    caller.call(1);
    caller.owed = oweRoundOver(caller.owed, last, endRound(FRESH_WEEK, last));
    caller.ride(2, 20);
    expect(caller.said.map((each) => each.text)).toEqual([
      'Delivered to the 1st house. 1 house left.',
      'Missed the 2nd house. Round over: 1 of 2 houses delivered, a score of 1. The round on day 2 has 1 house.',
    ]);
  });

  it('starts the round’s end with a miss and a delivery both still owed, the miss first', () => {
    const round = startRound(3);
    const settled = recordMiss(recordDelivery(recordDelivery(round, 0), 1), 2);
    const owed = oweRoundOver(
      oweRoundChange(NOTHING_OWED, round, settled),
      settled,
      endRound(FRESH_WEEK, settled),
    );
    expect(deliveryEvents(owed)).toEqual([
      {
        kind: 'delivery-round-over',
        text: 'Missed the 3rd house. Delivered to the 1st and 2nd houses. Round over: 2 of 3 houses delivered, a score of 2. The round on day 2 has 2 houses.',
      },
    ]);
  });

  it('says a whole round once each: every delivery, every miss, then the end', () => {
    const caller = new Caller();
    let round: Round = startRound(4);
    const step = (next: Round): void => {
      caller.owed = oweRoundChange(caller.owed, round, next);
      round = next;
    };
    // A house every five seconds — wider than the window, so nothing folds.
    step(recordDelivery(round, 0));
    caller.ride(0, 4);
    step(recordMiss(round, 1));
    caller.ride(5, 9);
    step(recordDelivery(round, 2));
    caller.ride(10, 14);
    step(recordDelivery(round, 3));
    caller.ride(15, 19);
    caller.owed = oweRoundOver(caller.owed, round, endRound(FRESH_WEEK, round));
    caller.ride(20, 40);
    expect(caller.said.map((each) => each.text)).toEqual([
      'Delivered to the 1st house. 3 houses left.',
      'Missed the 2nd house. 2 houses left.',
      'Delivered to the 3rd house. 1 house left.',
      'Delivered to the 4th house. No houses left.',
      'Round over: 3 of 4 houses delivered, a score of 3. The round on day 2 has 3 houses.',
    ]);
  });

  it('settles only the kind the core said', () => {
    const owed = oweCrash(
      oweRoundChange(
        oweRoundChange(NOTHING_OWED, startRound(3), recordDelivery(startRound(3), 0)),
        recordDelivery(startRound(3), 0),
        recordMiss(recordDelivery(startRound(3), 0), 1),
      ),
    );
    const kinds = (each: DeliveryOwed): string[] => deliveryEvents(each).map((event) => event.kind);
    expect(kinds(owed)).toEqual(['delivery-crash', 'delivery-missed', 'delivery-delivered']);
    expect(kinds(deliverySpoken(owed, 'delivery-crash'))).toEqual([
      'delivery-missed',
      'delivery-delivered',
    ]);
    expect(kinds(deliverySpoken(owed, 'delivery-missed'))).toEqual([
      'delivery-crash',
      'delivery-delivered',
    ]);
    expect(kinds(deliverySpoken(owed, 'delivery-delivered'))).toEqual([
      'delivery-crash',
      'delivery-missed',
    ]);
    expect(deliverySpoken(owed, 'power')).toBe(owed);
    expect(deliverySpoken(owed, undefined)).toBe(owed);
  });
});
