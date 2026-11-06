// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How loud each class of sound is, and which are muted — #2055: one stored
 * preference for the three buses of `web-audio.ts`'s graph and its master.
 *
 * ## Three buses, because the Game Accessibility Guidelines ask for them
 *
 * Music, the menus' effects (#946) and the ride's cues (#400) each have a
 * volume and a mute of their own, and the master mute silences all three
 * (epic #2033, owner ruling 2). Each bus is a gain node in `web-audio.ts`; this
 * module is what those gains are set from.
 *
 * ## Defaults, and what a rider already chose
 *
 * - **music: on** (owner ruling 2 of 2026-11-03), at half volume. Nothing
 *   plays it yet: the music itself is #2057 and #2058.
 * - **effects and cues: what `oyl.menuSounds.v1` and `oyl.cues.v1` hold** —
 *   so off unless the rider turned them on, at the volume they chose. The
 *   first read takes each from its old key and KEEPS it here; a bus already
 *   stored is never read from the old key again.
 * - **master: unmuted.**
 *
 * A bus that is missing from what is stored, or that this build does not read,
 * is taken as if nothing were stored for it, bus by bus, so a junk value costs
 * that bus and nothing else.
 *
 * ## ⚠️ The old switches write their bus here
 *
 * Settings and the ride's `SoundControls.tsx` write the old keys, which still
 * hold each class's switch, and a mix copied from them once would go stale the
 * moment a rider moved one: menu sounds turned on in Settings would land on an
 * effects bus still muted, and play silently. So `writeCuePreference` and
 * `writeMenuSoundPreference` also write their bus through {@link writeAudioBus}.
 * Since #2056 that is how the effects and cue rows on Settings write this
 * preference; music, which has no old key, is written here directly, and so is
 * the header's master mute ({@link writeMasterMuted}).
 *
 * ## On the device
 *
 * `localStorage`, through `hud/announce-preference.ts`'s storage port, like
 * every other sound preference: sound is a property of the machine.
 */

import type { PreferenceStorage } from './hud/announce-preference';

/** The graph's three buses. */
export type BusName = 'music' | 'effects' | 'cues';

export interface BusSetting {
  /** 0 to 1, in tenths. The bus's gain when it is not muted. */
  readonly volume: number;
  /** Silence the bus, without losing the volume. */
  readonly muted: boolean;
}

export interface AudioMix {
  /** Silences every bus at once. */
  readonly masterMuted: boolean;
  readonly music: BusSetting;
  readonly effects: BusSetting;
  readonly cues: BusSetting;
}

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const AUDIO_MIX_STORAGE_KEY = 'oyl.audioMix.v1';

/** Music is on by default — owner ruling 2 of 2026-11-03, on #2033. */
const DEFAULT_MUSIC: BusSetting = { volume: 0.5, muted: false };

/** A volume as a whole number of tenths, or `undefined` when it is not one. */
function tenths(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return undefined;
  }
  return Math.round(value * 10) / 10;
}

/** One stored bus, or `undefined` when this build cannot read it. */
function storedBus(value: unknown): BusSetting | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const volume = tenths(row['volume']);
  if (volume === undefined || typeof row['muted'] !== 'boolean') return undefined;
  return { volume, muted: row['muted'] };
}

/** What is stored, as a plain object — `{}` where nothing readable is. Never throws. */
function stored(storage: PreferenceStorage | undefined): Record<string, unknown> {
  try {
    const text = storage?.getItem(AUDIO_MIX_STORAGE_KEY) ?? null;
    const raw = text === null ? undefined : (JSON.parse(text) as unknown);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function keep(storage: PreferenceStorage | undefined, row: Record<string, unknown>): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(AUDIO_MIX_STORAGE_KEY, JSON.stringify(row));
    return true;
  } catch {
    return false;
  }
}

/**
 * The rider's mix. A bus not stored yet is taken from `legacy` — the old keys,
 * read only when one is needed — or, for music, from the default; and what was
 * taken is kept, so the old keys are read the first time and not again.
 * Never throws.
 */
export function readAudioMix(
  storage: PreferenceStorage | undefined,
  legacy: () => Pick<AudioMix, 'effects' | 'cues'>,
): AudioMix {
  const row = stored(storage);
  const music = storedBus(row['music']);
  const effects = storedBus(row['effects']);
  const cues = storedBus(row['cues']);
  const masterMuted = row['masterMuted'] === true;
  if (music !== undefined && effects !== undefined && cues !== undefined) {
    return { masterMuted, music, effects, cues };
  }
  let taken: Pick<AudioMix, 'effects' | 'cues'> | undefined;
  const fromOldKey = (): Pick<AudioMix, 'effects' | 'cues'> => (taken ??= legacy());
  const mix: AudioMix = {
    masterMuted,
    music: music ?? DEFAULT_MUSIC,
    effects: effects ?? fromOldKey().effects,
    cues: cues ?? fromOldKey().cues,
  };
  keep(storage, { ...row, ...mix });
  return mix;
}

/**
 * The music bus and the master mute as they are stored, or their defaults —
 * #2056's Settings panel and header mute. ⚠️ Reads only: unlike
 * {@link readAudioMix} it keeps nothing, so opening a screen writes nothing to
 * the device. Music and the master have no old key, so nothing is lost by not
 * taking the other buses from theirs here.
 */
export function readMusicAndMaster(
  storage: PreferenceStorage | undefined,
): Pick<AudioMix, 'music' | 'masterMuted'> {
  const row = stored(storage);
  return {
    music: storedBus(row['music']) ?? DEFAULT_MUSIC,
    masterMuted: row['masterMuted'] === true,
  };
}

/**
 * Keep one bus, leaving the rest as they are stored: a bus not stored yet
 * stays unstored, so the next {@link readAudioMix} still takes it from its old
 * key. `false` when the device refused, so a screen can say so.
 */
export function writeAudioBus(
  storage: PreferenceStorage | undefined,
  bus: BusName,
  setting: BusSetting,
): boolean {
  return keep(storage, { ...stored(storage), [bus]: setting });
}

/**
 * Keep the master mute — #2056's one-press mute in the header — leaving every
 * bus as it is stored. `false` when the device refused.
 */
export function writeMasterMuted(storage: PreferenceStorage | undefined, muted: boolean): boolean {
  return keep(storage, { ...stored(storage), masterMuted: muted });
}
