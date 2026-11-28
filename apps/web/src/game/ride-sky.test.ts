// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An ordinary ride's light and weather, as a device keeps it and a ride
 * settles it — #3281 (`ride-sky.ts`). That the setup offers it and the ride
 * hands it to the view is `ride-sky-wiring.test.tsx`'s.
 */

import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from './hud/announce-preference';
import {
  DEFAULT_RIDE_SKY,
  readRideSkyChoice,
  RIDE_LOOKS,
  RIDE_SKY_CHOICES,
  RIDE_SKY_STORAGE_KEY,
  rideLookOf,
  rideSkySeed,
  rideWeatherOf,
  writeRideSkyChoice,
} from './ride-sky';

/** A device store, in memory. */
function memory(): PreferenceStorage & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value);
    },
  };
}

/** A store that refuses everything, as a blocked one does. */
const REFUSING: PreferenceStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('full');
  },
};

describe('the light and weather a device keeps — #3281', () => {
  it('offers clear, overcast, rain and dusk, then Surprise me', () => {
    expect(RIDE_LOOKS).toStrictEqual(['clear', 'overcast', 'rain', 'dusk']);
    expect(RIDE_SKY_CHOICES).toStrictEqual(['clear', 'overcast', 'rain', 'dusk', 'surprise']);
    expect(DEFAULT_RIDE_SKY).toBe('clear');
  });

  it('reads back each choice it was written', () => {
    const storage = memory();
    for (const choice of RIDE_SKY_CHOICES) {
      expect(writeRideSkyChoice(storage, choice)).toBe(true);
      expect(storage.kept.get(RIDE_SKY_STORAGE_KEY)).toBe(choice);
      expect(readRideSkyChoice(storage)).toBe(choice);
    }
  });

  it('reads nothing, an unknown value or a refusing store as clear, and says a write was refused', () => {
    expect(readRideSkyChoice(undefined)).toBe('clear');
    expect(readRideSkyChoice(memory())).toBe('clear');
    const odd = memory();
    odd.setItem(RIDE_SKY_STORAGE_KEY, 'thunder');
    expect(readRideSkyChoice(odd)).toBe('clear');
    expect(readRideSkyChoice(REFUSING)).toBe('clear');
    expect(writeRideSkyChoice(REFUSING, 'dusk')).toBe(false);
    expect(writeRideSkyChoice(undefined, 'dusk')).toBe(false);
  });
});

describe('the look a ride is drawn in — #3281', () => {
  it('is the chosen look, whatever the seed', () => {
    for (const look of RIDE_LOOKS) {
      for (const seed of [0, 1, 7, 0xffffffff]) expect(rideLookOf(look, seed)).toBe(look);
    }
  });

  it('is, for Surprise me, one of the four, the same for one seed, and every one over many rides', () => {
    const seen = new Set<string>();
    for (let start = 0; start < 200; start += 1) {
      const seed = rideSkySeed('route-a', 1_700_000_000_000 + start * 60_000);
      const look = rideLookOf('surprise', seed);
      expect(RIDE_LOOKS).toContain(look);
      expect(rideLookOf('surprise', seed)).toBe(look);
      seen.add(look);
    }
    expect([...seen].sort()).toStrictEqual([...RIDE_LOOKS].sort());
  });

  it('seeds a ride by its route and its start, and by nothing else', () => {
    expect(rideSkySeed('route-a', 1000)).toBe(rideSkySeed('route-a', 1000));
    expect(rideSkySeed('route-a', 1000)).not.toBe(rideSkySeed('route-b', 1000));
    expect(rideSkySeed('route-a', 1000)).not.toBe(rideSkySeed('route-a', 2000));
  });

  it('hands a frame no weather in clear daylight, and each other look’s own', () => {
    expect(rideWeatherOf('clear')).toBeUndefined();
    expect(rideWeatherOf('overcast')).toStrictEqual({ rain: false, dusk: false, overcast: true });
    expect(rideWeatherOf('rain')).toStrictEqual({ rain: true, dusk: false });
    expect(rideWeatherOf('dusk')).toStrictEqual({ rain: false, dusk: true });
  });
});
