// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a rider wants the menus' sounds, and how loud — #946.
 *
 * ## Off by default
 *
 * Nothing sounds until a rider turns it on (#935 D-3): a sound nobody asked
 * for is the audio form of the live region `StatusMessage.tsx` refuses to add
 * unasked. A stored value this build does not read — junk, a blocked store, a
 * private window — is the default, field by field, so it is off too.
 *
 * ## Its own switch and its own volume
 *
 * Separate from the ride's sounds (#400, `game/cue-preference.ts`), under its
 * own key: the Game Accessibility Guidelines ask for a separate volume or
 * mute per class of sound, and a rider who wants the workout tone need not
 * hear a click on every menu, nor the other way about.
 *
 * ## On the device
 *
 * `localStorage`, the `game/hud/announce-preference.ts` precedent and its
 * storage port: sound is a property of the machine a rider is sitting at.
 */

import type { PreferenceStorage } from '../game/hud/announce-preference';

export interface MenuSoundPreference {
  /** The switch. `false` until the rider turns it on. */
  readonly enabled: boolean;
  /** 0 to 1, in tenths. Multiplies `menu-sounds.ts` §`MENU_CUE_LEVEL`. */
  readonly volume: number;
}

export const DEFAULT_MENU_SOUNDS: MenuSoundPreference = { enabled: false, volume: 0.5 };

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const MENU_SOUNDS_STORAGE_KEY = 'oyl.menuSounds.v1';

/** A volume as a whole number of tenths, or `undefined` when it is not one. */
function tenths(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return undefined;
  }
  return Math.round(value * 10) / 10;
}

/** What this device has stored, or the default — field by field. Never throws. */
export function readMenuSoundPreference(
  storage: PreferenceStorage | undefined,
): MenuSoundPreference {
  let raw: unknown;
  try {
    const text = storage?.getItem(MENU_SOUNDS_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_MENU_SOUNDS;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_MENU_SOUNDS;
  const row = raw as Record<string, unknown>;
  return {
    enabled: row['enabled'] === true,
    volume: tenths(row['volume']) ?? DEFAULT_MENU_SOUNDS.volume,
  };
}

/** Keep it. `false` when the device refused, so the screen can say so. */
export function writeMenuSoundPreference(
  storage: PreferenceStorage | undefined,
  preference: MenuSoundPreference,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(MENU_SOUNDS_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

/** A slider's 0–100 as a stored volume, or `undefined` when it is not a tenth. */
export function menuVolumeFromSlider(value: number): number | undefined {
  return tenths(value / 100);
}
