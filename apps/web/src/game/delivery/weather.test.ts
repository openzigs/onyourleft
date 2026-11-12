// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A level's rain and dusk — #2366, ADR 0065 D-10.4, D-10.9 and D-10.10: a
 * house's marker shows only once the rider is closer, early enough to throw
 * at it at the fastest avoidable speed; the assist shows it from as far as
 * clear weather does; and the weather changes nothing of the round itself.
 *
 * The town is `delivery-town-testing.ts`' synthetic one, ridden through the
 * real `ride-round.ts` and drawn by the real `in-view.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../hud/announce-preference';
import { roadCorridor } from '../terrain';

import { DELIVERY_ASSIST_STORAGE_KEY, type DeliveryAssist } from './assist-preference';
import { deliveryTown } from './delivery-town-testing';
import { deliveryInView, LOW_LIGHT_REVEAL_METRES } from './in-view';
import { AVOIDABLE_FASTEST_METRES_PER_SECOND } from './obstacles';
import { startDeliveryRide, stepDeliveryRide, type DeliveryRide } from './ride-round';
import { DELIVERY_TICK_SECONDS, THROW_WINDOW_AFTER_METRES } from './throw';

/**
 * The least time a marker shown in rain or at dusk leaves to throw at its
 * house at the fastest avoidable speed, seconds — #2366's stated number:
 * **3**, from the marker showing to the house's throw window closing.
 */
const LEAST_SECONDS_TO_THROW = 3;

const town = deliveryTown();
const corridor = roadCorridor(town.profile, town.origin, 0, {
  aheadMetres: 2_100,
  behindMetres: 10,
});

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

let seed = 2_366;
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
  seed = 2_366;
});

type Weather = { readonly weather: 'clear' | 'rain'; readonly light: 'day' | 'dusk' };

function onLevel(sky: Weather, storage = storageOf()): DeliveryRide {
  const ride = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    lineOffset: 0,
    storage,
    level: {
      houses: 8,
      hazardsPerKilometre: { static: 0, moving: 0 },
      lengthMetres: 2_000,
      // #2363: a level round names its level.
      id: 'test-level',
      ...sky,
    },
  });
  if (ride === undefined) throw new Error('the town gave no round');
  return ride;
}

/** The distance each house's marker was first drawn from, riding at `speed` from the start. */
function firstSeen(ride: DeliveryRide, speed: number): ReadonlyMap<number, number> {
  const seen = new Map<number, number>();
  const last = Math.max(...ride.targets.map((target) => target.distance));
  let now = ride;
  while (now.along < last + 5) {
    now = stepDeliveryRide(now, {
      ticks: 1,
      along: now.along + speed * DELIVERY_TICK_SECONDS,
      speed,
    }).ride;
    // The frame's corridor runs from the rider: the whole road here, so only the reveal hides a marker.
    const view = deliveryInView({
      corridor,
      targets: now.targets,
      round: { ...now.round, houses: now.round.houses.map(() => 'expecting' as const) },
      throws: now.throws,
      obstacles: [],
      obstacleState: { tick: 0, startedAt: [], crashed: [] },
      riderAlong: now.along,
      revealMetres: now.revealMetres,
    });
    for (const marker of view.markers) {
      const target = now.targets.find((each) => each.x === marker.x && each.z === marker.z);
      if (target !== undefined && !seen.has(target.position)) seen.set(target.position, now.along);
    }
  }
  return seen;
}

describe('in rain or at dusk a marker shows once the rider is closer — #2366, ADR 0065 D-10.4', () => {
  for (const sky of [
    { weather: 'clear', light: 'dusk' },
    { weather: 'rain', light: 'day' },
    { weather: 'rain', light: 'dusk' },
  ] as const) {
    it(`reveals each house within LOW_LIGHT_REVEAL_METRES, ${sky.weather} and ${sky.light}`, () => {
      const ride = onLevel(sky);
      expect(ride.revealMetres).toBe(LOW_LIGHT_REVEAL_METRES);
      expect(ride.weather).toStrictEqual({
        rain: sky.weather === 'rain',
        dusk: sky.light === 'dusk',
      });
    });
  }

  it('reveals at today’s distance in clear daylight, and on a rider’s own route', () => {
    expect(onLevel({ weather: 'clear', light: 'day' }).revealMetres).toBeUndefined();
    const own = startDeliveryRide({
      buildings: town.buildings,
      profile: town.profile,
      origin: town.origin,
      riderDistance: 0,
      lineOffset: 0,
      storage: storageOf(),
    });
    expect(own?.revealMetres).toBeUndefined();
    expect(own?.weather).toStrictEqual({ rain: false, dusk: false });
  });

  it('reveals at the clear-weather distance with the assist’s wider windows, at dusk and in rain', () => {
    const assist: DeliveryAssist = { obstacles: 'normal', widerWindows: true, noFail: false };
    const ride = onLevel(
      { weather: 'rain', light: 'dusk' },
      storageOf({ [DELIVERY_ASSIST_STORAGE_KEY]: assist }),
    );
    expect(ride.revealMetres).toBeUndefined();
    // Every house is drawn from the start, as in clear weather.
    const seen = firstSeen(ride, AVOIDABLE_FASTEST_METRES_PER_SECOND);
    for (const target of ride.targets) {
      expect(target.distance - (seen.get(target.position) ?? 0)).toBeGreaterThan(
        LOW_LIGHT_REVEAL_METRES,
      );
    }
  });

  it(`leaves at least ${String(LEAST_SECONDS_TO_THROW)} s to throw once a marker shows, at the fastest avoidable speed, on every house at every seed`, () => {
    const speed = AVOIDABLE_FASTEST_METRES_PER_SECOND;
    let houses = 0;
    for (let from = 0; from < 12; from += 1) {
      seed = (from * 2_654_435_761) >>> 0;
      const ride = onLevel({ weather: 'rain', light: 'dusk' });
      const seen = firstSeen(ride, speed);
      for (const target of ride.targets) {
        const shown = seen.get(target.position);
        expect(shown, 'a house never shown').toBeDefined();
        // Hidden until within the reveal distance, a tick's ride of it.
        expect(target.distance - (shown ?? 0)).toBeLessThanOrEqual(LOW_LIGHT_REVEAL_METRES);
        expect(target.distance - (shown ?? 0)).toBeGreaterThan(
          LOW_LIGHT_REVEAL_METRES - speed * DELIVERY_TICK_SECONDS,
        );
        // From then until its window closes behind the rider.
        const seconds = (target.distance + THROW_WINDOW_AFTER_METRES - (shown ?? 0)) / speed;
        expect(seconds).toBeGreaterThanOrEqual(LEAST_SECONDS_TO_THROW);
        houses += 1;
      }
    }
    expect(houses).toBeGreaterThan(50);
  });

  it('picks the same round, the same houses in the same order, in rain and at dusk as in clear daylight', () => {
    const clear = onLevel({ weather: 'clear', light: 'day' });
    const wet = onLevel({ weather: 'rain', light: 'dusk' });
    expect(wet.targets).toStrictEqual(clear.targets);
    expect(wet.throwTargets).toStrictEqual(clear.throwTargets);
    expect(wet.obstacles).toStrictEqual(clear.obstacles);
    expect(wet.round).toStrictEqual(clear.round);
  });
});
