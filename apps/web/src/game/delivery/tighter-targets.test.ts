// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A level's tighter targets — #2365, ADR 0065 D-4.2, D-10.3, D-10.5 and
 * D-10.10: mailboxes at the kerb and houses that must not get a parcel,
 * picked per ride from the in-memory seed, a parcel at a no-delivery house
 * costing points and never paying any, a round always left enough houses to
 * deliver to, the assist taking the cost away, and the house said in words
 * before the rider can throw at it.
 *
 * The town is `delivery-town-testing.ts`' synthetic one; the levels read are
 * the shipped files and the fixture, through the app's reader, for their
 * shares only (ADR 0065 D-7.5).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';
import {
  deliverySpoken,
  NOTHING_OWED,
  oweSkipHouse,
  SKIP_HOUSE_AHEAD_METRES,
  skipHouseSentence,
} from '../hud/delivery-announce';
import { drawnRoadPosition } from '../terrain';

import { DELIVERY_ASSIST_STORAGE_KEY, type DeliveryAssist } from './assist-preference';
import { DELIVERY_PROGRESS_STORAGE_KEY, readDeliveryProgress } from './delivery-progress';
import { deliveryTown } from './delivery-town-testing';
import { LEVEL_MOST_NO_DELIVERY_SHARE, parseLevelFile, type LevelFile } from './levels/level-file';
import {
  endDeliveryRide,
  keepDeliveryWeek,
  startDeliveryRide,
  stepDeliveryRide,
  type DeliveryRide,
} from './ride-round';
import { FEWEST_DELIVERY_HOUSES, roundTally, type WeekProgress } from './round';
import {
  MAILBOX_FROM_KERB_METRES,
  noDeliveryCount,
  pickRoundTargets,
  TARGET_SPACING_METRES,
} from './targets';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  DELIVERY_TICK_SECONDS,
  NO_DELIVERY_SCORE_DELTA,
  PARCEL_FLIGHT_TICKS,
  THROW_WINDOW_BEFORE_METRES,
  type ThrowTarget,
} from './throw';

const town = deliveryTown();
const LEVELS = fileURLToPath(new URL('./levels/', import.meta.url));
const read = (path: string, id: string): LevelFile =>
  parseLevelFile(JSON.parse(readFileSync(path, 'utf8')), id);
/** Every shipped level and the fixture, read through the app's reader. */
const ROUNDS: readonly LevelFile[] = [
  ...readdirSync(join(LEVELS, 'data'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => read(join(LEVELS, 'data', name), name.slice(0, -5))),
  read(join(LEVELS, 'fixtures', 'fixture-level.json'), 'fixture-level'),
];

/** A level round of eight houses, half of them mailboxes and half to get no parcel, with no hazard. */
const LEVEL = {
  houses: 8,
  hazardsPerKilometre: { static: 0, moving: 0 },
  lengthMetres: 2_000,
  mailboxShare: 0.5,
  noDeliveryShare: 0.5,
  // #2363: a level round names its level.
  id: 'test-level',
} as const;

function storageOf(entries: Record<string, unknown> = {}): PreferenceStorage {
  const items = new Map(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** The level the helper takes: `LEVEL`'s shape with its numbers widened. */
type LevelOf = {
  readonly [K in keyof typeof LEVEL]: (typeof LEVEL)[K] extends number ? number : (typeof LEVEL)[K];
};

let seed = 2_365;
beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  seed = 2_365;
});

function onLevel(storage = storageOf(), level: LevelOf = LEVEL): DeliveryRide {
  const ride = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    lineOffset: 0,
    storage,
    level,
  });
  if (ride === undefined) throw new Error('the town gave no round');
  return ride;
}

/**
 * Ride to `launch`, throw toward `target`'s side there at `speed`, and ride
 * on until the parcel has come down.
 */
function throwAt(
  ride: DeliveryRide,
  target: ThrowTarget,
  launch: number,
  speed: number,
): DeliveryRide {
  let now = stepDeliveryRide(ride, { ticks: 1, along: launch, speed }).ride;
  now = stepDeliveryRide(now, {
    ticks: 1,
    along: launch + speed * DELIVERY_TICK_SECONDS,
    speed,
    throwTo: target.side,
  }).ride;
  for (let tick = 0; tick <= PARCEL_FLIGHT_TICKS; tick += 1) {
    now = stepDeliveryRide(now, {
      ticks: 1,
      along: now.along + speed * DELIVERY_TICK_SECONDS,
      speed,
    }).ride;
  }
  return now;
}

describe('picked per ride from the in-memory seed, and stored nowhere — #2365, ADR 0065 D-4.2', () => {
  const pick = (from: number) =>
    pickRoundTargets(
      {
        buildings: town.buildings,
        profile: town.profile,
        origin: town.origin,
        riderDistance: 0,
        houses: 8,
        shares: { mailbox: 0.5, noDelivery: 0.5 },
      },
      from,
    );

  it('gives the same mailboxes and no-delivery houses for the same seed, and others for others', () => {
    const roles = (from: number) => {
      const picked = pick(from);
      return {
        mailboxes: picked.targets
          .filter((each) => each.mailbox === true)
          .map((each) => each.distance),
        noDelivery: picked.noDelivery.map((each) => each.distance),
      };
    };
    expect(roles(7)).toStrictEqual(roles(7));
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((from) => JSON.stringify(roles(from))));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('takes the no-delivery houses from the round’s picked houses, numbering the rest as the round', () => {
    const picked = pick(7);
    expect(picked.complete).toBe(true);
    expect(picked.targets).toHaveLength(8 - noDeliveryCount(8, 0.5));
    expect(picked.noDelivery).toHaveLength(noDeliveryCount(8, 0.5));
    expect(picked.targets.map((each) => each.position)).toStrictEqual(
      picked.targets.map((_, index) => index),
    );
    // Every house, of either kind, keeps the round's spacing.
    const all = [...picked.targets, ...picked.noDelivery]
      .map((each) => each.distance)
      .sort((a, b) => a - b);
    for (let at = 1; at < all.length; at += 1) {
      expect((all[at] as number) - (all[at - 1] as number)).toBeGreaterThanOrEqual(
        TARGET_SPACING_METRES,
      );
    }
    // Half of the houses to deliver to are mailboxes, at the kerb.
    const mailboxes = picked.targets.filter((each) => each.mailbox === true);
    expect(mailboxes).toHaveLength(Math.round(0.5 * picked.targets.length));
    for (const mailbox of mailboxes) {
      expect(mailbox.fromRoad).toBeCloseTo(
        CARRIAGEWAY_HALF_WIDTH_METRES + MAILBOX_FROM_KERB_METRES,
        9,
      );
    }
  });

  it('draws a mailbox at the kerb, on the line from the road to its house’s front step', () => {
    // The same seed with no shares picks the same houses, each at its front step.
    const own = pickRoundTargets(
      {
        buildings: town.buildings,
        profile: town.profile,
        origin: town.origin,
        riderDistance: 0,
        houses: 8,
      },
      7,
    );
    const mailboxes = pick(7).targets.filter((each) => each.mailbox === true);
    expect(mailboxes.length).toBeGreaterThan(0);
    for (const mailbox of mailboxes) {
      const step = own.targets.find((each) => each.distance === mailbox.distance);
      if (step === undefined) throw new Error('the mailbox house is not in the own pick');
      const road = drawnRoadPosition(town.profile, town.origin, mailbox.distance);
      // Where it is drawn: off the kerb by the mailbox distance, not on the doorstep.
      expect(Math.hypot(mailbox.x - road.x, mailbox.z - road.z)).toBeCloseTo(mailbox.fromRoad, 6);
      expect(mailbox.x === step.x && mailbox.z === step.z).toBe(false);
      // On the road-to-step line: the cross product of the two offsets is nil.
      const cross =
        (mailbox.x - road.x) * (step.z - road.z) - (mailbox.z - road.z) * (step.x - road.x);
      expect(Math.abs(cross)).toBeLessThan(1e-6);
      expect(
        (mailbox.x - road.x) * (step.x - road.x) + (mailbox.z - road.z) * (step.z - road.z),
      ).toBeGreaterThan(0);
    }
  });

  it('makes none of either without a level’s shares: a rider’s own route is as before', () => {
    const own = pickRoundTargets(
      {
        buildings: town.buildings,
        profile: town.profile,
        origin: town.origin,
        riderDistance: 0,
        houses: 8,
      },
      7,
    );
    expect(own.noDelivery).toStrictEqual([]);
    expect(own.targets.some((each) => each.mailbox === true)).toBe(false);
    expect(own.targets).toHaveLength(8);
  });
});

describe('a round always holds enough houses to deliver to — #2365', () => {
  it('leaves at least FEWEST_DELIVERY_HOUSES on every shipped level and the fixture, at its share and the most', () => {
    expect(ROUNDS.length).toBeGreaterThanOrEqual(3);
    for (const level of ROUNDS) {
      for (const share of [level.round.noDeliveryShare, LEVEL_MOST_NO_DELIVERY_SHARE]) {
        const { houses } = level.round;
        expect(houses - noDeliveryCount(houses, share), level.id).toBeGreaterThanOrEqual(
          FEWEST_DELIVERY_HOUSES,
        );
      }
    }
    // And for any round the format allows.
    for (let houses = FEWEST_DELIVERY_HOUSES; houses <= 12; houses += 1) {
      for (let share = 0; share <= 1; share += 0.05) {
        expect(houses - noDeliveryCount(houses, share)).toBeGreaterThanOrEqual(
          FEWEST_DELIVERY_HOUSES,
        );
      }
    }
  });

  it('starts a level round with no fewer than that many, at the most no-delivery share', () => {
    for (let from = 0; from < 40; from += 1) {
      seed = (from * 2_654_435_761) >>> 0;
      for (const houses of [3, 4, 5, 6]) {
        const ride = onLevel(storageOf(), {
          ...LEVEL,
          houses,
          noDeliveryShare: LEVEL_MOST_NO_DELIVERY_SHARE,
        });
        expect(ride.round.houses.length).toBeGreaterThanOrEqual(FEWEST_DELIVERY_HOUSES);
      }
    }
  });
});

describe('a parcel at a house that must not get one costs, and never pays — #2365, ADR 0059 D-1.4', () => {
  it('takes NO_DELIVERY_SCORE_DELTA off the round’s score, and leaves the week as it was', () => {
    const week: WeekProgress = { day: 3, houses: 8, score: 9 };
    const storage = storageOf({ [DELIVERY_PROGRESS_STORAGE_KEY]: week });
    const ride = onLevel(storage);
    const [first] = ride.throwTargets;
    const house = ride.throwNoDelivery.find((each) => each.along > (first?.along ?? 0));
    if (first === undefined || house === undefined) throw new Error('no house after the first');
    // A delivery first, so the score has a point to lose.
    const delivered = throwAt(ride, first, first.along - 0.2, 0.01);
    expect(delivered.score).toBe(1);
    const thrown = throwAt(delivered, house, house.along - 0.2, 0.01);
    expect(thrown.score).toBe(1 + NO_DELIVERY_SCORE_DELTA);
    expect(roundTally(thrown.round).delivered).toBe(1);
    // The week's score counts deliveries only, and a level round keeps none of it.
    expect(endDeliveryRide(thrown).next.score).toBe(endDeliveryRide(delivered).next.score);
    expect(keepDeliveryWeek(storage, endDeliveryRide(thrown), thrown)).toBe(false);
    expect(readDeliveryProgress(storage)).toStrictEqual(week);
  });

  it('raises no score of any kind, whatever is thrown at one from wherever, at any speed', () => {
    const ride = onLevel();
    let swept = 0;
    let caught = 0;
    for (const house of ride.throwNoDelivery) {
      for (const speed of [0.01, 3, 7, 12]) {
        for (let offset = -THROW_WINDOW_BEFORE_METRES - 2; offset <= 2; offset += 1) {
          const thrown = throwAt(ride, house, house.along + offset, speed);
          swept += 1;
          expect(thrown.score).toBeLessThanOrEqual(ride.score);
          expect(roundTally(thrown.round).delivered).toBe(0);
          expect(endDeliveryRide(thrown).next.score).toBeLessThanOrEqual(
            endDeliveryRide(ride).next.score,
          );
          if (thrown.changes.length > 0) caught += 1;
        }
      }
    }
    expect(swept).toBeGreaterThan(50);
    expect(caught).toBeGreaterThan(0);
  });

  it('costs nothing with the assist’s no fail on', () => {
    const assist: DeliveryAssist = { obstacles: 'normal', widerWindows: false, noFail: true };
    const ride = onLevel(storageOf({ [DELIVERY_ASSIST_STORAGE_KEY]: assist }));
    expect(ride.noDeliveryCosts).toBe(false);
    const [first] = ride.throwTargets;
    const house = ride.throwNoDelivery.find((each) => each.along > (first?.along ?? 0));
    if (first === undefined || house === undefined) throw new Error('no house after the first');
    const delivered = throwAt(ride, first, first.along - 0.2, 0.01);
    expect(throwAt(delivered, house, house.along - 0.2, 0.01).score).toBe(1);
    // And costs its point without it.
    expect(onLevel().noDeliveryCosts).toBe(true);
  });
});

describe('a house that must not get a parcel is said before the rider can throw at it — #2365, ADR 0065 D-10.5', () => {
  it('owes its warning before its throw window opens, once, by its side', () => {
    const ride = onLevel();
    expect(ride.noDeliveryTargets.length).toBeGreaterThan(0);
    expect(SKIP_HOUSE_AHEAD_METRES).toBeGreaterThan(THROW_WINDOW_BEFORE_METRES);
    let owed = NOTHING_OWED;
    const saidAt = new Map<number, number>();
    for (let along = 0; along < town.profile.totalDistance; along += 0.5) {
      owed = oweSkipHouse(owed, ride.noDeliveryTargets, along);
      if (owed.skip !== undefined) {
        expect(saidAt.has(owed.skip.index)).toBe(false);
        saidAt.set(owed.skip.index, along);
        const house = ride.noDeliveryTargets[owed.skip.index];
        expect(owed.skip.text).toBe(skipHouseSentence(house?.side === 1 ? 'right' : 'left'));
        owed = deliverySpoken(owed, 'delivery-skip-house');
      }
    }
    ride.noDeliveryTargets.forEach((house, index) => {
      const said = saidAt.get(index);
      expect(said).toBeDefined();
      expect(house.distance - (said ?? Infinity)).toBeGreaterThan(THROW_WINDOW_BEFORE_METRES);
    });
  });
});
