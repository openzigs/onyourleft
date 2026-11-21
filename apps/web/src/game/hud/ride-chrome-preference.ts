// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the ride's controls hide until touched, and which HUD panels the
 * rider has collapsed to a tab — #2600, the owner's ruling of 2026-11-14 from
 * the tablet. Kept on this device, under its own key.
 *
 * ## Two choices, two places they are made
 *
 * - **The controls' auto-hide** is chosen in Settings (`SettingsView.tsx`
 *   §`RideControlsPanel`) and read as the HUD mounts. On by default: the
 *   owner's question was whether *Pause* and *End ride* should appear only
 *   once the screen is touched, so the default is the answer to it, and a
 *   rider who wants them always drawn turns it off.
 * - **Which panels are collapsed** is chosen on the HUD itself, mid-ride, one
 *   tap a panel (`HudCore.tsx` §`PanelTabs`), and written back here at once so
 *   the next ride opens with the same panels collapsed.
 *
 * ⚠️ **A separate key from `hud-layout-preference.ts`**, and the reason is
 * who writes it: that preference is read once as a ride starts and written
 * only by Settings, so a ride never changes it under itself. This one is
 * written by the ride, many times, and keeping the two apart keeps the HUD
 * from ever rewriting the rider's Settings choices.
 *
 * Never throws: a store that cannot be read is the defaults, and a write that
 * is refused answers `false`.
 */

import type { PreferenceStorage } from './announce-preference';

/**
 * The panels a rider may collapse mid-ride, in the order a screen reader meets
 * their tabs. `primary` and `secondary` are the two readings tiers (and the
 * focus readout is `primary`); `standings` is a race's standings or a loop's
 * lap splits, which share that place; `trainer` is the trainer's line at the
 * top of the actions panel. ⚠️ **Never the ride controls or the notices**: no
 * key here can name them.
 */
export const COLLAPSIBLE_PANELS = [
  'primary',
  'secondary',
  'route',
  'standings',
  'trainer',
] as const;

/** One of {@link COLLAPSIBLE_PANELS}. */
export type CollapsiblePanel = (typeof COLLAPSIBLE_PANELS)[number];

/** What the rider chose. */
export interface RideChromePreference {
  /** Whether the ride's controls fade out after a few seconds with no input. */
  readonly autoHide: boolean;
  /** The panels collapsed to a tab. Empty by default. */
  readonly collapsed: readonly CollapsiblePanel[];
}

export const DEFAULT_RIDE_CHROME: RideChromePreference = { autoHide: true, collapsed: [] };

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const RIDE_CHROME_STORAGE_KEY = 'oyl.rideChrome.v1';

function isCollapsible(value: unknown): value is CollapsiblePanel {
  return typeof value === 'string' && (COLLAPSIBLE_PANELS as readonly string[]).includes(value);
}

/**
 * What this device has stored, or the defaults — field by field. A panel name
 * it does not know is left out, and only a stored `false` turns auto-hide off.
 */
export function readRideChrome(storage: PreferenceStorage | undefined): RideChromePreference {
  let raw: unknown;
  try {
    const text = storage?.getItem(RIDE_CHROME_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return DEFAULT_RIDE_CHROME;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_RIDE_CHROME;
  const row = raw as Record<string, unknown>;
  return {
    autoHide: row['autoHide'] !== false,
    collapsed: Array.isArray(row['collapsed'])
      ? [...new Set(row['collapsed'].filter(isCollapsible))]
      : [],
  };
}

/**
 * Keep it. `false` when the device refused — a full or blocked store — so a
 * screen can say the choice will not survive a reload rather than pretend.
 */
export function writeRideChrome(
  storage: PreferenceStorage | undefined,
  preference: RideChromePreference,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(RIDE_CHROME_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

/** The preference with `panel` collapsed if it was not, and expanded if it was. */
export function toggleCollapsed(
  preference: RideChromePreference,
  panel: CollapsiblePanel,
): RideChromePreference {
  return {
    ...preference,
    collapsed: preference.collapsed.includes(panel)
      ? preference.collapsed.filter((each) => each !== panel)
      : [...preference.collapsed, panel],
  };
}
