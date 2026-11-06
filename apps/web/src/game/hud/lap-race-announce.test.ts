// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race through the HUD's one live region — #1904. Every case that says
 * what is HEARD drives the real core, `announce.ts`, on a fake clock, the way
 * `GameView` drives Delivery's (#1816): offer what is owed, call the core,
 * settle what it said. The race is the model's (`lap-race-testing.ts`).
 */

import type { ItemRaceState } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  ALWAYS_SPOKEN,
  INITIAL_ANNOUNCER,
  PRIORITY,
  announce,
  type AnnouncerState,
} from './announce';
import { DEFAULT_ANNOUNCEMENTS, type AnnouncementPreference } from './announce-preference';
import {
  PLACE_ANNOUNCE_SECONDS,
  lapRaceEvents,
  lapRaceOwedAtStart,
  lapRaceSpoken,
  oweRaceTick,
  type LapRaceOwed,
} from './lap-race-announce';
import { BOTS, RIDER, holding, startRace, tick } from './lap-race-testing';

const ON: AnnouncementPreference = {
  ...DEFAULT_ANNOUNCEMENTS,
  enabled: true,
  powerEverySeconds: 'never',
  distanceEvery: 'never',
};

const LAP_RACE_KINDS = [
  'lap-race-finish',
  'lap-race-hit',
  'lap-race-lap',
  'lap-race-item',
  'lap-race-place',
] as const;

/** The caller's loop: a race stepped through the model, and the core offered what is owed. */
class Caller {
  race: ItemRaceState;
  owed: LapRaceOwed;
  state: AnnouncerState = INITIAL_ANNOUNCER;
  readonly said: string[] = [];

  constructor(race: ItemRaceState) {
    this.race = race;
    this.owed = lapRaceOwedAtStart(race, RIDER);
  }

  /** One tick of the race at `seconds`, then one call of the core at the same instant. */
  step(
    seconds: number,
    rider: number,
    bots: readonly number[],
    extra: { readonly uses?: readonly string[]; readonly preference?: AnnouncementPreference } = {},
  ): string | undefined {
    const before = this.race;
    const effortDistances: Record<string, number> = { [RIDER]: rider };
    BOTS.forEach((id, index) => {
      effortDistances[id] = bots[index] ?? 0;
    });
    this.race = tick(before, {
      atMs: seconds * 1_000,
      effortDistances,
      ...(extra.uses === undefined ? {} : { uses: extra.uses }),
    });
    this.owed = oweRaceTick(
      this.owed,
      before,
      this.race,
      RIDER,
      extra.uses?.includes(RIDER) ?? false,
    );
    return this.hear(seconds, extra.preference);
  }

  hear(seconds: number, preference: AnnouncementPreference = ON): string | undefined {
    const result = announce(this.state, {
      now: seconds,
      readings: [],
      events: lapRaceEvents(this.owed, seconds),
      preference,
    });
    this.state = result.state;
    this.owed = lapRaceSpoken(this.owed, result.kind, seconds);
    if (result.sentence !== undefined) this.said.push(result.sentence);
    return result.sentence;
  }
}

describe('a lap race’s sentences, ranked (#1904)', () => {
  it('ranks the five below every other event and above every reading, none spoken with announcements off', () => {
    const first = PRIORITY.indexOf('lap-race-finish');
    expect(PRIORITY.slice(first, first + 5)).toEqual([...LAP_RACE_KINDS]);
    expect(first).toBe(PRIORITY.indexOf('delivery-delivered') + 1);
    expect(PRIORITY.indexOf('lap-race-place')).toBeLessThan(PRIORITY.indexOf('power-off-target'));
    for (const kind of LAP_RACE_KINDS) {
      expect(ALWAYS_SPOKEN).not.toContain(kind);
    }
  });

  it('says nothing at all with announcements off', () => {
    const caller = new Caller(holding(startRace({ laps: 3, lap: 200 }), RIDER, null));
    const off = { ...ON, enabled: false };
    for (let second = 1; second <= 60; second += 1) {
      caller.step(second, second * 12, [second * 11, second * 10, second * 13], {
        preference: off,
      });
    }
    expect(caller.said).toEqual([]);
  });
});

describe('a lap race’s laps and its finish (#1904)', () => {
  it('says each lap with the place, the last lap as the last, then the finish as the last word', () => {
    const caller = new Caller(startRace({ laps: 3, lap: 100, itemsOn: false }));
    for (let second = 1; second <= 40; second += 1) {
      caller.step(second, second * 10, [second * 9, second * 8, second * 7]);
    }
    expect(caller.said).toEqual([
      // Off the line, where the field stood in id order, into the lead.
      'You are 1 of 4.',
      'Lap 1 of 3 done. You are 1 of 4.',
      'Lap 2 of 3 done. Last lap. You are 1 of 4.',
      'Finished, 1 of 4, in 30 seconds.',
    ]);
    // Nothing more after the finish, however long the ride goes on.
    for (let second = 41; second <= 80; second += 1) {
      caller.step(second, second * 10, [second * 12, second * 12, second * 12]);
    }
    expect(caller.said).toHaveLength(4);
  });

  it('says the place a rider took at the line in the finish, and never again after it', () => {
    const caller = new Caller(startRace({ laps: 1, lap: 1_000, itemsOn: false }));
    caller.step(1, 10, [11, 0, 0]);
    expect(caller.said).toEqual(['You are 2 of 4.']);
    // Second all the way, then past bot-1 in the tick that crosses the line.
    caller.step(99, 990, [995, 0, 0]);
    caller.step(100, 1_001, [1_000, 0, 0]);
    for (let second = 101; second <= 140; second += 1) {
      caller.step(second, second * 10, [second * 10 + 5, 0, 0]);
    }
    expect(caller.said).toEqual(['You are 2 of 4.', 'Finished, 1 of 4, in 1 minute 40 seconds.']);
  });

  it('says only the finish when the last lap and the line are in one tick', () => {
    const caller = new Caller(startRace({ laps: 1, lap: 100, itemsOn: false }));
    caller.step(20, 101, [50, 50, 50]);
    expect(caller.said).toEqual(['Finished, 1 of 4, in 20 seconds.']);
  });
});

describe('a lap race’s hits and items (#1904)', () => {
  it('says a gust that hit the rider, and the item the rider picked up', () => {
    let race = startRace({ laps: 3, lap: 1_000 });
    race = holding(race, 'bot-1', 'crosswind-gust');
    const caller = new Caller(race);
    caller.step(1, 20, [5, 0, 0]);
    caller.step(2, 30, [15, 0, 0], { uses: ['bot-1'] });
    // Through the first pick-up point at a quarter of the lap.
    for (let second = 3; second <= 30; second += 1) {
      caller.step(second, 30 + (second - 2) * 10, [15, 0, 0]);
    }
    const held = caller.race.racers.find((entry) => entry.racer.id === RIDER)?.held;
    expect(held).not.toBeNull();
    expect(caller.said.slice(0, 2)).toEqual(['You are 1 of 4.', 'Hit by a crosswind gust.']);
    expect(caller.said.filter((each) => each.startsWith('You have '))).toHaveLength(1);
  });

  it('says a puddle ridden through, and a cape that kept off a hit', () => {
    let race = startRace({ laps: 3, lap: 1_000 });
    // bot-1, ahead, lays a puddle at 250 m in the rider's lane.
    race = holding(race, 'bot-1', 'puddle');
    const caller = new Caller(race);
    caller.step(1, 200, [240, 0, 0], { uses: ['bot-1'] });
    caller.step(2, 260, [300, 0, 0]);
    caller.hear(4);
    expect(caller.said).toEqual(['You are 2 of 4.', 'Rode through a puddle.']);

    let caped = holding(startRace({ laps: 3, lap: 1_000 }), RIDER, 'rain-cape');
    caped = holding(caped, 'bot-1', 'crosswind-gust');
    const second = new Caller(caped);
    second.step(1, 20, [5, 0, 0], { uses: [RIDER] });
    second.step(5, 30, [15, 0, 0], { uses: ['bot-1'] });
    expect(second.said).toEqual(['You are 1 of 4.', 'Your rain cape kept off a hit.']);
  });

  it('does not say an item the rider used before it could be said', () => {
    const race = startRace({ laps: 3, lap: 100 });
    const caller = new Caller(race);
    caller.step(1, 5, [0, 0, 0]);
    // A sentence just said, so the window is shut for three seconds.
    caller.owed = { ...caller.owed, hit: 'puddle' };
    caller.hear(1.5);
    caller.step(2, 26, [0, 0, 0]);
    const held = caller.race.racers.find((entry) => entry.racer.id === RIDER)?.held ?? null;
    expect(held).not.toBeNull();
    expect(caller.owed.item).toBe(held);
    caller.step(3, 27, [0, 0, 0], { uses: [RIDER] });
    expect(caller.owed.item).toBeUndefined();
    for (let second = 4; second <= 10; second += 1) caller.step(second, 27 + second, [0, 0, 0]);
    expect(caller.said.filter((each) => each.startsWith('You have '))).toEqual([]);
  });
});

describe('a lap race’s place, rate-limited (#1904)', () => {
  /** A bot and the rider swapping the lead every `every` seconds, for `seconds`. */
  function swapping(every: number, seconds: number): Caller {
    const caller = new Caller(startRace({ laps: 50, lap: 10_000, itemsOn: false }));
    let swap = 0;
    for (let at = every; at <= seconds + 1e-9; at += every) {
      swap += 1;
      const rider = at * 10;
      caller.step(at, rider, [rider + (swap % 2 === 1 ? 1 : -1), 0, 0]);
    }
    return caller;
  }

  it(`says a change of place at most once every ${String(PLACE_ANNOUNCE_SECONDS)} seconds`, () => {
    expect(PLACE_ANNOUNCE_SECONDS).toBe(10);
    const caller = swapping(0.5, 30);
    const places = caller.said.filter((each) => each.startsWith('You are '));
    expect(places.length).toBeGreaterThan(0);
    expect(places.length).toBeLessThanOrEqual(3);
  });

  it('says nothing when the place is back to the one last said', () => {
    const caller = new Caller(startRace({ laps: 50, lap: 10_000, itemsOn: false }));
    // On the line the field stands in id order, so the rider is last.
    expect(caller.owed.saidPlace).toBe(4);
    caller.step(1, 10, [11, 0, 0]);
    expect(caller.said).toEqual(['You are 2 of 4.']);
    // Into the lead and back inside the interval, then long after it: the
    // place now is the place last said, so there is nothing to say.
    caller.step(5, 50, [49, 0, 0]);
    caller.step(6, 60, [61, 0, 0]);
    caller.step(20, 200, [201, 0, 0]);
    expect(caller.said).toEqual(['You are 2 of 4.']);
  });
});

describe('what a tick owes, read off the race (#1904)', () => {
  /** Rider holding `kind` at 20 m of a 100 m lap; one tick takes them through the pick-up at 25 m. */
  function throughPickUp(used: boolean): LapRaceOwed {
    const start = holding(startRace({ laps: 3, lap: 100 }), RIDER, 'puddle');
    const before = tick(start, { atMs: 1_000, effortDistances: { [RIDER]: 20 } });
    const after = tick(before, {
      atMs: 2_000,
      effortDistances: { [RIDER]: 30 },
      ...(used ? { uses: [RIDER] } : {}),
    });
    return oweRaceTick(lapRaceOwedAtStart(start, RIDER), before, after, RIDER, used);
  }

  it('does not say an item again at a pick-up passed while still holding one', () => {
    const owed = throughPickUp(false);
    expect(owed.item).toBeUndefined();
  });

  it('says the item drawn in the tick the rider used the one they held', () => {
    const owed = throughPickUp(true);
    expect(owed.item).toBeDefined();
  });

  it('lets the finish supersede a hit, a lap and an item still owed', () => {
    const start = startRace({ laps: 1, lap: 100, itemsOn: false });
    const done = tick(start, { atMs: 20_000, effortDistances: { [RIDER]: 101 } });
    const owed: LapRaceOwed = {
      ...lapRaceOwedAtStart(start, RIDER),
      hit: 'puddle',
      lap: 1,
      item: 'puddle',
    };
    const after = oweRaceTick(owed, start, done, RIDER, false);
    expect([after.hit, after.lap, after.item]).toEqual([undefined, undefined, undefined]);
    expect(lapRaceEvents(after, 20).map((event) => event.kind)).toEqual(['lap-race-finish']);
  });

  it('counts a lap’s sentence as the place sentence', () => {
    const owed: LapRaceOwed = { ...lapRaceOwedAtStart(startRace({}), RIDER), lap: 1, place: 2 };
    const said = lapRaceSpoken(owed, 'lap-race-lap', 5);
    expect([said.saidPlace, said.placeSaidAt]).toEqual([2, 5]);
    expect(lapRaceEvents(said, 60)).toEqual([]);
  });
});
