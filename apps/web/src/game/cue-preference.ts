// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a rider wants the ride's sounds, how loud, and whether they are muted
 * — #400, kept where #395 decided the announcements are kept.
 *
 * ## Off by default
 *
 * Nothing sounds until a rider turns it on: sound nobody asked for is the
 * audio form of the live region `StatusMessage.tsx` refuses to add unasked.
 *
 * ## ⚠️ The mute and the volume are WCAG 2.2 SC 1.4.2 (Audio Control, Level A)
 *
 * *"If any audio on a web page plays automatically for more than 3 seconds,
 * either a mechanism is available to pause or stop the audio, or a mechanism
 * is available to control audio volume independently from the overall system
 * volume level."* A continuous tone is exactly that, so both are conformance
 * rather than polish — and both are reachable DURING a ride
 * (`SoundControls.tsx`), not only from Settings, because a rider who cannot
 * stop the sound has no way out.
 *
 * ## On the device, like the announcements
 *
 * `localStorage`, wrapped, on `announce-preference.ts`'s reasoning and with its
 * storage port: a blocked or junk store renders the defaults, field by field.
 */

import type { PreferenceStorage } from './hud/announce-preference';

export interface CuePreference {
  /** The master switch. `false` until the rider turns it on. */
  readonly enabled: boolean;
  /** 0 to 1, in tenths. Multiplies every level `audio-cues.ts` sets. */
  readonly volume: number;
  /** Silence everything, without losing the volume. */
  readonly muted: boolean;
}

export const DEFAULT_CUES: CuePreference = { enabled: false, volume: 0.5, muted: false };

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const CUES_STORAGE_KEY = 'oyl.cues.v1';

/** A volume as a whole number of tenths, so a slider and a store agree exactly. */
export function steppedVolume(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return Math.round(value * 10) / 10;
}

/** What this device has stored, or the defaults — field by field. Never throws. */
export function readCuePreference(storage: PreferenceStorage | undefined): CuePreference {
  let raw: unknown;
  try {
    const text = storage?.getItem(CUES_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_CUES;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_CUES;
  const row = raw as Record<string, unknown>;
  return {
    enabled: row['enabled'] === true,
    volume: steppedVolume(row['volume']) ?? DEFAULT_CUES.volume,
    muted: row['muted'] === true,
  };
}

/** Keep it. `false` when the device refused, so a screen can say so. */
export function writeCuePreference(
  storage: PreferenceStorage | undefined,
  preference: CuePreference,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(CUES_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}
