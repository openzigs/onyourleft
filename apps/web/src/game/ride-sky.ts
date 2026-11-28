// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The light and weather an ordinary ride is drawn in — #3281. Until it every
 * ride was ridden under one sky at one hour, and only a Delivery level file
 * could ask for its dusk or its rain (#2366, #2508). Now the rider chooses
 * before the ride: clear (today's), overcast, rain, dusk, or *Surprise me*,
 * one of those four seeded by the ride.
 *
 * ## A drawing, and the rider's own
 *
 * The look is drawn through `weather-look.ts`, in both worlds, re-lighting
 * what is already there: no draw call, no triangle, no byte of download
 * (`port.ts` §`SceneFrame.weather`). Nothing here reaches the simulation,
 * the grade or the trainer. ⚠️ **It never reads the rider's location or the
 * real weather**: the choice is the rider's, and nothing is fetched
 * (`privacy/no-network.test.ts`).
 *
 * ## On the device, like the world it is drawn in
 *
 * Kept as a device preference (`world-preference.ts`' shape): written when
 * the rider chooses, read when the setup opens. Anything this module cannot
 * read is clear daylight, so a ride on a device that never chose is today's
 * ride to the bit — its frames carry no `weather` at all.
 *
 * ⚠️ Imported by `StageChooser.tsx`, so it reaches nothing but types
 * (`stage-chooser-imports.test.ts`).
 */

import type { PreferenceStorage } from './hud/announce-preference';
import type { DeliveryWeatherFrame } from './port';

/** Namespaced, because the origin is shared. The `v1` is the value's. */
export const RIDE_SKY_STORAGE_KEY = 'oyl.game.rideSky.v1';

/** The looks a ride can be drawn in, in the order the setup offers them. */
export const RIDE_LOOKS = ['clear', 'overcast', 'rain', 'dusk'] as const;

export type RideLook = (typeof RIDE_LOOKS)[number];

/** What the setup offers: a look, or *Surprise me*, last. */
export const RIDE_SKY_CHOICES = [...RIDE_LOOKS, 'surprise'] as const;

export type RideSkyChoice = (typeof RIDE_SKY_CHOICES)[number];

/** What a device that never chose rides in: today's clear day. */
export const DEFAULT_RIDE_SKY: RideSkyChoice = 'clear';

function isRideSkyChoice(value: string | null | undefined): value is RideSkyChoice {
  return (RIDE_SKY_CHOICES as readonly (string | null | undefined)[]).includes(value);
}

/** This device's choice. Never throws; anything unreadable or unknown is clear. */
export function readRideSkyChoice(storage: PreferenceStorage | undefined): RideSkyChoice {
  try {
    const stored = storage?.getItem(RIDE_SKY_STORAGE_KEY);
    return isRideSkyChoice(stored) ? stored : DEFAULT_RIDE_SKY;
  } catch {
    return DEFAULT_RIDE_SKY;
  }
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so the
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeRideSkyChoice(
  storage: PreferenceStorage | undefined,
  choice: RideSkyChoice,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(RIDE_SKY_STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/**
 * A ride's seed for *Surprise me*: FNV-1a over the route's id and the moment
 * the ride started, so two rides of one route usually differ and one ride
 * keeps its look from its first frame to its last.
 */
export function rideSkySeed(routeId: string, startedAtMs: number): number {
  let hash = 0x811c9dc5;
  for (const char of `${routeId}|${String(Math.floor(startedAtMs))}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The look a ride is drawn in: the chosen one, or for *Surprise me* the seed's. */
export function rideLookOf(choice: RideSkyChoice, seed: number): RideLook {
  if (choice !== 'surprise') return choice;
  return RIDE_LOOKS[(seed >>> 0) % RIDE_LOOKS.length] as RideLook;
}

/** Each look but clear, as the frame carries it. */
const WEATHER_OF: Readonly<Record<Exclude<RideLook, 'clear'>, DeliveryWeatherFrame>> = {
  overcast: Object.freeze({ rain: false, dusk: false, overcast: true }),
  rain: Object.freeze({ rain: true, dusk: false }),
  dusk: Object.freeze({ rain: false, dusk: true }),
};

/**
 * What a ride's frames carry for `look` (`port.ts` §`SceneFrame.weather`):
 * `undefined` in clear daylight, so the frame is the one it always was.
 */
export function rideWeatherOf(look: RideLook): DeliveryWeatherFrame | undefined {
  return look === 'clear' ? undefined : WEATHER_OF[look];
}
